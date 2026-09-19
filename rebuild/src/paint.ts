// Paints predicted lines so the browser draws each one as the paragraph's own layout did: form A-wrap of
// specs/painter.md §6. DESIGN.md §7 explains the choices and what painting a line alone still changes.
//
// - One block per line at the paragraph's content width, with the block's text style, direction, lang and text-align,
//   the text-indent where the engine indented the line, and the line's slot as floats of its insets, so the engine runs
//   its own line rules again (Blink's CJK punctuation trimming in ShapeLine, Gecko's pre-wrap hang width, a band's
//   arithmetic), and a line wider than predicted wraps visibly (R1). A paragraph that isn't start-aligned gives the block
//   the line's used alignment as text-align-last, since the painted line is its block's last line. A line from a later
//   line build than the paragraph's first gets its floats from a holder block around the line block, where they are
//   already in the formatting context, as in the paragraph.
// - Where an engine's handling of a line's end reads whether content follows, a line that ended at a soft wrap ends with
//   softWrapBox, which wraps to the painted block's second line (DESIGN.md §7, "Soft wraps").
// - A line that ends at a chosen soft hyphen or starts with the U+200D of R7 doesn't wrap: it holds a boundary the
//   paragraph never offered as a break (the hyphen, the joiner), which the browser would break at when the line overflows.
//   Neither does a line that reaches past its band by the engine's own widths, which the paragraph kept whole, unless it
//   ends in white space, holds one cluster or, in Blink, ends with a character HanKerning may trim.
// - The line's pieces are painted in logical order inside the elements that hold them. Between two consecutive painted
//   pieces the painter replays the paragraph's element structure, so a span between them with nothing painted of its own
//   is painted empty and its neighbours keep the element between them. A span's start and end edges are painted on the
//   lines that hold its box-start and box-end fragments, and a span with such an edge on a line where none of its content
//   is painted is painted for the edge alone. Each leaf's slice of the line is one text node, split only where its bidi
//   level changes (R2). A bare slice of ASCII white space alone at the start of a line goes in a span, because a text
//   node of only such white space as a block's first child isn't laid out.
// - Trailing collapsible white space stays in its slice, so the engine trims it and shapes the text before it the same
//   way (R3). Preserved white space is painted as laid out. In Blink hanging spaces after text take one of three forms
//   by how the paragraph shaped that text: a text node of their own, as they are their own item result; the text's node,
//   where an overflow break reshaped the text; a shaping group of their own, where the line needs an accurate end
//   position (hangingForm).
// - A forced break, <br> and <wbr> are painted as they were, so a line ends the way it did. White space the engine
//   collapsed between two pieces of one leaf is painted where it was, and so is collapsed text after a last space the
//   engine kept; other collapsed text isn't painted.
// - The text is painted as the engine laid it out (R5). In WebKit a text node gets the string storage, 8-bit or 16-bit,
//   that the paragraph's node had (textNode).
// - The hyphen at a soft-hyphen break is its own span, styled per engine so that it shapes alone where the engine
//   shapes it alone (R6).
// - Where the paragraph's shaping joined letters across a line edge, U+200D on both sides keeps the joining forms (R7).
// - A line with a piece at a level other than the paragraph's base level is drawn under bidi-override: the line block
//   overrides to the base direction and nested override spans add one level each, so the browser reorders the line with
//   the paragraph's levels instead of resolving the line alone (R8, specs/painter.md §4.4). An override span holds the
//   longest run of pieces above its level, whole elements included; an element whose pieces straddle the run holds its
//   own override spans. Elements and the spans that hold text keep the paragraph's direction. Text never sits directly
//   in an override element. The line's trailing white space takes the level of the text before it, and so does a piece
//   that continues the grapheme cluster of the piece before it.
// - In Gecko, where letter spacing is set and the line ends with a tab or a formatting character that the leaf's text
//   follows, a collapsible space or a preserved newline after it keeps it from being its text run's last character.
// - In Blink, a line that starts with characters of script Common or Inherited after Arabic text starts with U+061C, so
//   they continue an Arabic run as they did.
// - painterLimits names, per line, what painting the line alone can't reproduce (PainterLimitName).
// - An atomic inline is painted as an empty inline-block of its declared border box and margins, aligned to the line top,
//   for the app to fill.
// - A line without a line box paints nothing and gets no block.
// Nothing sets a text width: the lab compares the painted rects with the rects the observation contract expects
// (DESIGN.md §7, §9).
//
// The code here names no engine. What one engine's painted line needs and another's doesn't is a PaintRules value, which
// each engine exports from engines/<engine>/paint-rules.ts with the source readings behind it: data where the engines
// differ by a value, and a function where they differ by what they read of the line. The painter takes, per line, the
// pieces linePieces gives, the line's slot and whether it has a line box (PaintLine), and never looks inside the pieces'
// `facts`, which are the engine's own and go back to its rules.
import { indexContent, styleUnder, type ContentIndex } from './content.js'
import type { AtomicInline, BoxEdge, CssFont, Direction, FontDecl, Fragment, LinePieces, LineSlot, Paragraph, TextStyle } from './model.js'
import { B, BN, FSI, LRE, LRI, LRO, PDF, PDI, RLE, RLI, RLO, S, WS, bidiClassOf, type BidiData } from './unicode/bidi.js'
import { graphemeBoundaries, type GraphemeRules } from './unicode/grapheme.js'

// U+0020 and U+0009..U+000D, the white space of Blink's IsASCIISpace: a text node holding only these as a block's first
// child gets no layout object in collapsing modes (Blink text.cc:319-364, the Blink port's layoutTextNeeded).
const ASCII_SPACE_ONLY = /^[\t-\r ]+$/
const SPACES_AND_TABS = /^[\t ]+$/
// R7's joiner.
const ZWJ = String.fromCharCode(0x200d)
// U+061C ARABIC LETTER MARK: no width, script Arabic.
const ARABIC_LETTER_MARK = String.fromCharCode(0x061c)

// The scripts the painter tells apart when it compares the text before a line with the line's own. A character of
// another script counts as a script of its own kind, 'other'.
const SCRIPTS = ['Latin', 'Arabic', 'Hebrew', 'Cyrillic', 'Greek', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Thai', 'Lao', 'Khmer', 'Myanmar',
  'Devanagari', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Gujarati', 'Gurmukhi', 'Sinhala', 'Tibetan', 'Georgian', 'Armenian',
  'Ethiopic', 'Syriac', 'Thaana', 'Mongolian', 'Nko'] as const
const SCRIPT_TESTS = SCRIPTS.map(name => new RegExp(`^\\p{Script=${name}}`, 'u'))
const FIRST_WITH_SCRIPT = /[^\p{Script=Common}\p{Script=Inherited}]/u
const LAST_WITH_SCRIPT = /[^\p{Script=Common}\p{Script=Inherited}](?=[\p{Script=Common}\p{Script=Inherited}]*$)/u

function scriptOf(character: string): string {
  for (let k = 0; k < SCRIPTS.length; k++) if (SCRIPT_TESTS[k]!.test(character)) return SCRIPTS[k]!
  return 'other'
}

// What the painter takes of one line: the pieces linePieces gives of it, the slot it was filled in, whose width is the
// painted block's, and whether it has a line box, as fillLine says. The painter takes every line of the paragraph, the
// ones without a line box too: their pieces are text the paragraph held before the lines after them.
export type PaintLine<Facts> = { pieces: LinePieces<Facts>; slot: LineSlot; hasLineBox: boolean }

export type TextPiece = Extract<Fragment, { kind: 'text' | 'trimmed' | 'hanging' }>

// How a line's hanging spaces are painted after the fragment before them (lineTokens): in a text node of their own, in
// the node of the text before them, or in a span of their own that ends the shaping group.
export type HangingForm = 'own-node' | 'same-node' | 'own-group'

// The paragraph with its content index (content.ts), where an engine's limits find a leaf's style and source text.
export type PaintedContent = { paragraph: Paragraph; index: ContentIndex<FontDecl> }

// What the painter's plan of a line says about its two edges, for the engine's limits (PaintRules.limits).
export type LineEdges = {
  // The line's first and last fragment with painted characters, and the last one's place among the fragments.
  first: TextPiece
  last: TextPiece
  lastAt: number
  // The painted text the paragraph's content ran on from before the line and on to after it (neighbour), or null.
  before: TextPiece | null
  after: TextPiece | null
  // The edge lies between pieces the engines can shape as one (shapesWith), and between two characters of them that
  // aren't white space, or where the engine joined the two lines.
  startInLeaf: boolean
  endInLeaf: boolean
  startInWord: boolean
  endInWord: boolean
  // No forced break or <br> ended the line.
  softEnd: boolean
  joinsPreviousLine: boolean
  // The script of the text before the line, which characters at the line's start continued in the paragraph and don't
  // when painted alone (PaintRules.lineStartScript); null where they keep their scripts.
  leadingScript: string | null
  // U+061C would give the line's scripts back, and the line can't take it.
  scriptMarkUnpainted: boolean
  // The line's last character takes letter spacing as its text run's last, and no character could be painted after it
  // (PaintRules.spacingAfterRunEnd).
  spacingAtRunEnd: boolean
}

// What differs between the engines' painted lines, as each engine's paint-rules.ts gives it. `Facts` is what the engine's
// own rules read of a line beside the pieces (LinePieces.facts); the painter hands it back to them unread.
export type PaintRules<Facts> = {
  // The engine's Bidi_Class data, for the characters a bidi paragraph's end resets, and its grapheme cluster rules.
  bidi: BidiData
  graphemes: GraphemeRules
  // R6: what keeps the hyphen's span from shaping with the word before it: a length vertical-align, which ends a shaping
  // group at the box edge without moving the baseline; an isolate, which ends a text run; or nothing, where the hyphen
  // shapes with the word.
  hyphenSpan: 'ends-shaping-group' | 'isolated' | 'plain'
  // The engine's layout reads a text node's string storage, so a text node gets the storage its leaf's node had (textNode).
  textNodesKeepLeafStorage: boolean
  // The engine's text box holds the node's own characters and its measuring reads them, so a tab or newline that the
  // engine's content shows as a space is painted as itself (lineTokens' paintedText).
  paintsSourceWhiteSpace: boolean
  // The engine shapes a trailing space with the text before it only where the two had one direction in the paragraph, and
  // its fragments' levels come after its line-end rule, so the painter resolves the space's direction as the paragraph
  // did (planLine's spaceJoinsText). Elsewhere the line's trailing white space always joins the text before it in its leaf.
  resolvesTrailingSpaceDirection: boolean
  // A trimmed collapsible space at the end of a line that ended at a soft wrap. 'where-reset': a character like any
  // other to the soft wrap box, which the line takes where a bidi paragraph's end would reset the space to another level.
  // 'by-rule': the engine treats the space by a rule of its own, which says from the line's facts whether the line takes
  // the box; the reset test then reads the last character before the space.
  trimmedSpaceAtEnd: { takesBox: 'where-reset' } | { takesBox: 'by-rule'; rule: (facts: Facts) => boolean }
  // The line's end after which the engine allows no break before the soft wrap box, so that the box would take the
  // character to the second line with it and such a line gets none; null where the engine breaks between any text and
  // an atomic inline.
  noBreakBeforeBoxAfter: RegExp | null
  // Whose white-space decides whether the painted line can wrap before the soft wrap box: the block's, or that of the box
  // holding the line's last character.
  lineEndWrapping: 'block' | 'last-character-box'
  // The form of the hanging spaces that start at `hanging`, which `before` precedes among the line's fragments; `style` is
  // the hanging spaces' leaf's.
  hangingForm: (line: PaintLine<Facts>, before: Fragment, hanging: TextPiece, style: TextStyle) => HangingForm
  // The engine adds letter spacing after a text run's last character whatever it is, so a line whose last character took
  // none in the paragraph gets a character after it (planLine's continuation).
  spacingAfterRunEnd: boolean
  // How the painter learns that characters at a line's start had another script in the paragraph than the line painted
  // alone gives them. 'arabic-letter-mark': the port's script itemizer says so exactly (`scriptsOf`: the script run of
  // every unit of a text laid out alone; `sixteenBit` says the painted text holds characters above U+00FF beside the
  // text's own), and where U+061C at the line's start gives the scripts back without moving a level (`levelsOf`: the
  // resolved levels of a text as a paragraph of that direction) the line is painted with it. 'limit-only': the Script
  // property of the line's first characters against the text before the line, for the limit alone. 'none': the engine
  // has no such limit.
  lineStartScript:
    | { form: 'arabic-letter-mark'; scriptsOf: (text: string, sixteenBit: boolean) => Uint8Array; levelsOf: (text: string, direction: Direction) => Uint8Array }
    | { form: 'limit-only' }
    | { form: 'none' }
  // The line's end that the engine may trim only while it breaks lines, so that a line ending so keeps wrapping although
  // it reaches past its band; null where the engine trims no such character.
  trimsAtLineEnd: RegExp | null
  // The limit of a line where two consecutive text pieces of one direction sit in different override spans
  // (controlsBetweenPieces), where the spans' bidi controls end what the engine shaped as one; null where they don't.
  controlsBetweenPieces: PainterLimit | null
  // The engine's own limits of a line with painted characters, in the order the lab records them, between the painter's
  // edge-inside-cluster and overflowing-line-rebreaks.
  limits: (content: PaintedContent, line: PaintLine<Facts>, edges: LineEdges) => PainterLimit[]
}

function setFont(style: CSSStyleDeclaration, font: CssFont): void {
  style.fontFamily = font.family
  style.fontSize = `${font.size}px`
  style.fontWeight = String(font.weight)
  style.fontStyle = font.style
}

function hasEdge(edge: BoxEdge): boolean {
  return edge.margin !== 0 || edge.border !== 0 || edge.padding !== 0
}

// A span with an element's styles: its font, spacing and lang always, as flat runs painted them, and the inherited
// properties that decide lines where they differ from its parent's.
function styledSpan(doc: Document, style: TextStyle, parent: TextStyle, lang: string | null): HTMLSpanElement {
  const span = doc.createElement('span')
  const s = span.style
  setFont(s, style.font)
  s.letterSpacing = `${style.letterSpacing}px`
  s.wordSpacing = `${style.wordSpacing}px`
  if (lang !== null) span.lang = lang
  if (style.whiteSpace !== parent.whiteSpace) s.whiteSpace = style.whiteSpace
  if (style.wordBreak !== parent.wordBreak) s.wordBreak = style.wordBreak
  if (style.overflowWrap !== parent.overflowWrap) s.overflowWrap = style.overflowWrap
  if (style.lineBreak !== parent.lineBreak) s.setProperty('line-break', style.lineBreak)
  if (style.tabSize !== parent.tabSize) s.setProperty('tab-size', String(style.tabSize))
  return span
}

function paintEdge(style: CSSStyleDeclaration, side: 'start' | 'end', edge: BoxEdge): void {
  if (edge.margin !== 0) style.setProperty(`margin-inline-${side}`, `${edge.margin}px`)
  if (edge.border !== 0) style.setProperty(`border-inline-${side}`, `${edge.border}px solid`)
  if (edge.padding !== 0) style.setProperty(`padding-inline-${side}`, `${edge.padding}px`)
}

// R6: the hyphen, shaped the way the engine shapes it (PaintRules.hyphenSpan).
function hyphenSpan(doc: Document, form: PaintRules<unknown>['hyphenSpan'], fragment: Extract<Fragment, { kind: 'hyphen' }>): HTMLSpanElement {
  const span = doc.createElement('span')
  span.style.letterSpacing = `${fragment.letterSpacing}px`
  switch (form) {
    case 'ends-shaping-group': span.style.verticalAlign = '0px'; break
    case 'isolated': span.style.unicodeBidi = 'isolate'; break
    case 'plain': break
  }
  span.append(doc.createTextNode(fragment.painted))
  return span
}

// An atomic inline's border box and margins, empty. Top alignment keeps the line box at the line height while the box is
// no taller (CSS 2.1 §10.8).
function atomicBox(doc: Document, atomic: AtomicInline): HTMLSpanElement {
  const span = doc.createElement('span')
  const s = span.style
  s.display = 'inline-block'
  s.boxSizing = 'border-box'
  s.width = `${atomic.width}px`
  s.height = `${atomic.height}px`
  s.verticalAlign = 'top'
  if (atomic.marginInlineStart !== 0) s.setProperty('margin-inline-start', `${atomic.marginInlineStart}px`)
  if (atomic.marginInlineEnd !== 0) s.setProperty('margin-inline-end', `${atomic.marginInlineEnd}px`)
  return span
}

// A float of one line height that takes a slot's inset off one side of the painted block, as the paragraph's floats did.
function floatInset(doc: Document, side: 'left' | 'right', width: number, height: number): HTMLDivElement {
  const div = doc.createElement('div')
  const s = div.style
  s.cssFloat = side
  s.margin = '0'
  s.padding = '0'
  s.border = '0'
  s.width = `${width}px`
  s.height = `${height}px`
  return div
}

// An empty inline-block wider than any band, after a line that ended at a soft wrap: it can't share a line with anything,
// so the browser wraps the painted line before it, and the painted line is a wrapped line followed by more content, as
// it was in the paragraph, instead of its block's last line.
function softWrapBox(doc: Document): HTMLSpanElement {
  const span = doc.createElement('span')
  const s = span.style
  s.display = 'inline-block'
  s.width = 'calc(100% + 1px)'
  s.height = '0'
  s.margin = '0'
  s.padding = '0'
  s.border = '0'
  s.verticalAlign = 'top'
  return span
}

// A text node with the string storage the paragraph's node had, where the engine's layout reads it
// (PaintRules.textNodesKeepLeafStorage). WebKit keeps a text node's string in 8 bits when it's
// made from Latin-1 text and in 16 when the leaf held any character above U+00FF, and its layout reads the storage: an
// emergency break of 8-bit text keeps one code unit at the line start, where 16-bit text also keeps the characters after
// it that can't start a line (firstCharacterBreakRespectingLineStartProhibitions, InlineContentBreaker.cpp:139-158), and
// breaks, strong directionality and keep-all read it too (the WebKit port's is8Bit). A Latin-1 slice of a 16-bit leaf
// would make an 8-bit node (`a` and U+00A0 from `a`, U+00A0, U+3000, `b` broke after `a`, c-c2d1c62d0c2618c7). deleteData
// builds its string from views of the old one, which keep its 16 bits (CharacterData.cpp:148-156, WTFString.cpp:90-100),
// so the node is made with a wide character after the text and loses it again. Probe
// .artifacts/lab/painter-r3/tools/storage-probe.ts (webkit-host): every string a script builds from those characters
// gives the 8-bit break, and deleteData, replaceData and splitText give the paragraph's.
const WIDE = /[^\u0000-\u00ff]/
const WIDE_CHARACTER = String.fromCharCode(0x100)
function textNode(doc: Document, keepsLeafStorage: boolean, text: string, wideLeaf: boolean): Text {
  if (!keepsLeafStorage || !wideLeaf || WIDE.test(text)) return doc.createTextNode(text)
  const node = doc.createTextNode(text + WIDE_CHARACTER)
  node.deleteData(text.length, 1)
  return node
}

function wraps(whiteSpace: TextStyle['whiteSpace']): boolean {
  return whiteSpace !== 'nowrap' && whiteSpace !== 'pre'
}

// Every character of the text has a Bidi_Class that the end of a bidi paragraph resets to the paragraph level: white
// space, segment and paragraph separators, boundary neutrals and the explicit and isolate codes. ICU does it in
// adjustWSLevels for the run of MASK_WS characters before the end of the text (ubidi.cpp:2289-2324, ubidiimp.h:94-102;
// Blink and WebKit), and unicode-bidi in reorder_levels, which Gecko runs over its whole paragraph
// (unicode-bidi lib.rs:1146-1200, unicode-bidi-ffi lib.rs:54). A painted line is a bidi paragraph of its own.
function resetAtParagraphEnd(data: BidiData, text: string): boolean {
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    switch (bidiClassOf(data, cp)) {
      case WS: case S: case B: case BN: case LRE: case RLE: case LRO: case RLO: case PDF: case LRI: case RLI: case FSI: case PDI: break
      default: return false
    }
  }
  return true
}

// Why a painted line can differ from the paragraph's line although the prediction is right: what the paragraph's layout
// of the line read that the line painted alone doesn't hold, and no form the painter has reproduces (tentpole 7). Each
// limit is a condition on the layout, read from the engine's source (DESIGN.md §7, "Limits"); it says the painted line can
// differ, not that it does. painterLimits names the limits of every line.
export type PainterLimitName =
  // WebKit: the line starts with the rest of an item the overflow breaker split, which keeps the item's width less the
  // part left on the line before (overflowWidthAsLeadingForNextLine, AbstractLineBuilder.cpp:54-98). Painted alone the
  // rest is measured fresh: another float32 sum, and no pair adjustment or joining across the cut.
  | 'carried-width'
  // WebKit: the line's last word is followed in its leaf by a space that isn't on the line. The paragraph measured the
  // word together with that space and took the space's width off (TextUtil::width's extendedMeasuring, TextUtil.cpp:76-81,
  // :103-104), which keeps the word's pair adjustment with the space and sums in another order.
  | 'word-measured-with-next-space'
  // Every engine: a line edge between two characters that aren't white space, in one leaf or in leaves the engine shapes
  // as one (one font, no box edge with a size between them). Blink reshapes an edge that isn't safe to break with the
  // text around it as HarfBuzz context, which an OpenType font reads and an AAT font doesn't (ShapeLine,
  // shaping_line_breaker.cc:300-330, :500-600; FontFacts.joining), and doesn't reshape before a chosen soft hyphen's
  // neighbours the same way; Gecko keeps the glyphs of the word it shaped whole (BreakAndMeasureText over one text run);
  // WebKit measures a part of an item alone, as the painted box does, except an RTL run it shaped across inline boxes
  // (applyShapingOnRunRange, InlineLineBuilder.cpp:920-967). Painted alone the edge has no text around it, so pair
  // adjustments, ligatures and contextual forms across it differ; R7's joiner only keeps OpenType joining, and in Gecko
  // takes letter spacing itself.
  | 'edge-inside-shaped-text'
  // Every engine: a line edge inside a grapheme cluster, as after a soft hyphen or U+200B inside an emoji sequence. The
  // paragraph gave the cluster's glyph to one side, and painted alone the other side draws glyphs of its own.
  | 'edge-inside-cluster'
  // Blink: the line ends with a preserved space that the next line's first character follows in the same leaf. A line's
  // end at a space isn't reshaped (dont_reshape_end_if_at_space_, line_breaker.cc:1655-1659), and trailing spaces are a view
  // of the paragraph's shape result (HandleTrailingSpaces, :2418-2534), so the space keeps its pair adjustment with that
  // character.
  | 'space-shaped-with-next-line'
  // Blink: the line starts or ends with a character HanKerning may trim (character.h:138-141) next to another line of the
  // same leaf. The trim reads the neighbouring character's type (han_kerning.cc), and a painted line's start isn't the
  // start of a wrapped line, where ShapeLine trims an opening bracket (FirstSafeOffset, shaping_line_breaker.cc:92-108).
  | 'han-kerning-at-edge'
  // Blink and Gecko: characters of the line had another script in the paragraph than the line painted alone gives them:
  // characters of script Common or Inherited that continued a run of the text before the line, or took the script of the
  // text after it. The run's script decided their font, their shaping and in Blink their letter spacing. Blink's scripts
  // come from the port's ScriptRunIterator, and where U+061C gives the paragraph's scripts back the painted line starts
  // with it and has no such limit; Gecko's come from planLine's leadingScript.
  | 'script-at-line-start'
  // Blink: the line needs an accurate end position and ends in hanging spaces, which are painted in a shaping group of
  // their own; they lose their part of a pair adjustment that HarfBuzz splits between the two glyphs
  // (FontFacts.pairKerning isn't 'first-advance').
  | 'hanging-space-kern-share'
  // Gecko: letter spacing is set, the line ends with a tab or a formatting character that the paragraph's text run went on
  // after, and the painter couldn't add a character after it; as the run's last character it takes spacing
  // (CanAddSpacingAfter, nsTextFrame.cpp:3860-3873).
  | 'spacing-at-run-end'
  // Gecko: the line ends in trimmed white space inside a leaf, where the paragraph's text frame broke inside itself
  // (brokeText, nsTextFrame.cpp:11201-11213). Only such a frame trims a trailing U+3000, which the line's end doesn't trim
  // (IsTrimmableSpace, :904-919), and under justify it keeps the trimmed space among its justification opportunities
  // (:11513-11521). The painted frame ends with its text, and no character after it can overflow without showing.
  | 'frame-ended-at-break'
  // Blink: two consecutive text pieces of one direction sit in different override spans (controlsBetweenPieces).
  | 'controls-between-pieces'
  // Every engine: the line reaches past its band and still wraps when painted, because it ends in white space or, in
  // Blink, with a character HanKerning may trim. The browser can break it again where the paragraph didn't.
  | 'overflowing-line-rebreaks'

export type PainterLimit = { limit: PainterLimitName; detail: string }

// What the painter puts in a line block, in logical order, before it places the override spans.
type Token =
  | { t: 'open'; element: number }
  | { t: 'close'; element: number }
  // One text node. `wrap` says what holds it: nothing of its own, a span with the block's styles (a bare white-space
  // slice that starts the line), or a span that ends Blink's shaping group.
  // `wide` says the leaf's text holds a character above U+00FF.
  | { t: 'text'; level: number; text: string; wide: boolean; wrap: 'none' | 'block-style' | 'shaping-group' }
  // A node the painter makes: the hyphen span, an atomic box, a <wbr>, a <br>, the soft wrap box. A null level sits at
  // any level.
  | { t: 'node'; level: number | null; node: NodeSpec }

type NodeSpec =
  | { what: 'hyphen'; fragment: Extract<Fragment, { kind: 'hyphen' }> }
  | { what: 'atomic'; atomic: AtomicInline }
  | { what: 'wbr' | 'br' | 'soft-wrap-box' }


// What every line of a paragraph shares.
type Context<Facts> = {
  paragraph: Paragraph
  lines: readonly PaintLine<Facts>[]
  rules: PaintRules<Facts>
  index: ContentIndex<FontDecl>
  // The paragraph's base level.
  base: number
  // The block collapses white space.
  collapses: boolean
  // The rules' lineStartScript with what its form reads of the whole paragraph.
  // - `before`: per line, the script of the last character with a script of its own (not Common or Inherited) that the
  //   paragraph holds before the line, or null.
  // - 'arabic-letter-mark': the text of every line's pieces in order, where each line's starts, and the script run of
  //   every unit of it as the engine's itemizer gives it for the paragraph.
  scripts:
    | (Extract<PaintRules<Facts>['lineStartScript'], { form: 'arabic-letter-mark' }> & { before: (string | null)[]; text: string; lineStarts: number[]; scripts: Uint8Array })
    | { form: 'limit-only'; before: (string | null)[] }
    | { form: 'none' }
}

function scriptBeforeLines<Facts>(lines: readonly PaintLine<Facts>[]): (string | null)[] {
  const scriptBefore: (string | null)[] = []
  let script: string | null = null
  for (let l = 0; l < lines.length; l++) {
    scriptBefore.push(script)
    const fragments = lines[l]!.pieces.fragments
    for (let f = 0; f < fragments.length; f++) {
      const fragment = fragments[f]!
      if (fragment.kind !== 'text' && fragment.kind !== 'trimmed' && fragment.kind !== 'hanging') continue
      const match = LAST_WITH_SCRIPT.exec(fragment.painted)
      if (match !== null) script = scriptOf(match[0])
    }
  }
  return scriptBefore
}

function contextOf<Facts>(paragraph: Paragraph, lines: readonly PaintLine<Facts>[], rules: PaintRules<Facts>): Context<Facts> {
  let scripts: Context<Facts>['scripts']
  switch (rules.lineStartScript.form) {
    case 'arabic-letter-mark': {
      let text = ''
      const lineStarts: number[] = []
      for (let l = 0; l < lines.length; l++) {
        lineStarts.push(text.length)
        const fragments = lines[l]!.pieces.fragments
        for (let f = 0; f < fragments.length; f++) {
          const fragment = fragments[f]!
          if (fragment.kind === 'text' || fragment.kind === 'trimmed' || fragment.kind === 'hanging') text += fragment.painted
        }
      }
      lineStarts.push(text.length)
      scripts = { ...rules.lineStartScript, before: scriptBeforeLines(lines), text, lineStarts, scripts: rules.lineStartScript.scriptsOf(text, false) }
      break
    }
    case 'limit-only': scripts = { form: 'limit-only', before: scriptBeforeLines(lines) }; break
    case 'none': scripts = { form: 'none' }; break
  }
  return {
    paragraph, lines, rules, index: indexContent(paragraph),
    base: paragraph.direction === 'rtl' ? 1 : 0, collapses: paragraph.whiteSpace === 'normal' || paragraph.whiteSpace === 'nowrap', scripts,
  }
}

// The painted text piece next to fragment `from` of line `l` in document order (`step` -1 before, 1 after), where the
// paragraph's content ran on from one to the other: only collapsed text, a drawn hyphen, <wbr> and the edges of spans
// without margin, border or padding there lie between. null where a forced break, a <br>, an atomic inline, a box edge
// with a size, which ends shaping in every engine (CSS Text 3 §7.3; Blink ShouldBreakShapingBeforeBox,
// inline_node.cc:494-527; Gecko ContinueTextRunAcrossFrames, nsTextFrame.cpp:2057-2090), or the paragraph's edge comes first.
function neighbour<Facts>(c: Context<Facts>, l: number, from: number, step: -1 | 1): TextPiece | null {
  const lines = c.lines
  for (let q = l; q >= 0 && q < lines.length; q += step) {
    const fragments = lines[q]!.pieces.fragments
    for (let k = q === l ? from + step : step === 1 ? 0 : fragments.length - 1; k >= 0 && k < fragments.length; k += step) {
      const fragment = fragments[k]!
      switch (fragment.kind) {
        case 'text': case 'trimmed': case 'hanging':
          if (fragment.painted.length > 0) return fragment
          break
        case 'box-start': case 'box-end': {
          const node = c.index.elements[fragment.element]!.node
          if (node.kind === 'span' && hasEdge(fragment.kind === 'box-start' ? node.inlineStart : node.inlineEnd)) return null
          break
        }
        case 'collapsed': case 'hyphen': case 'wbr': break
        case 'forced-break': case 'br': case 'atomic': return null
      }
    }
  }
  return null
}

// Two leaves the engines can shape as one: the same leaf, or leaves with one font and spacing.
function shapesWith<Facts>(c: Context<Facts>, a: number, b: number): boolean {
  if (a === b) return true
  const x = styleUnder(c.paragraph, c.index, c.index.leaves[a]!.parent)
  const y = styleUnder(c.paragraph, c.index, c.index.leaves[b]!.parent)
  return x.font.family === y.font.family && x.font.size === y.font.size && x.font.weight === y.font.weight && x.font.style === y.font.style &&
    x.letterSpacing === y.letterSpacing && x.wordSpacing === y.wordSpacing
}

// What the painter decided for one line, and the limits it names.
type LinePlan = {
  paintedLevels: number[]
  // Per fragment, how many units at its start continue the grapheme cluster of the fragment before it, painted at that
  // fragment's level.
  clusterPrefix: number[]
  reorders: boolean
  firstText: number
  lastText: number
  firstRun: number
  firstInSpan: boolean
  lastPainted: number
  startEdges: Set<number>
  endEdges: Set<number>
  nowrap: boolean
  softWrap: boolean
  // The level the soft wrap box is painted at, or null for any.
  boxLevel: number | null
  continuation: string
  // The fragment after which the leaf's collapsed text is painted too, or -1.
  keptSpace: number
  // The line starts with U+061C.
  scriptMark: boolean
  limits: PainterLimit[]
}

function planLine<Facts>(c: Context<Facts>, l: number, joinsPreviousLine: boolean): LinePlan {
  const { paragraph, lines, rules, index, base, collapses } = c
  const { bidi, graphemes } = rules
  const { pieces } = lines[l]!
  // The line's trailing white space. A painted line is a bidi paragraph of its own, and all three browsers give white
  // space at a paragraph's end the paragraph level (resetAtParagraphEnd), so the level it's painted at only decides
  // node division. Painting it at the level of the text before it in the same leaf keeps that slice one text node, as
  // it was in the paragraph: WebKit measures a word together with the space after it in its text box
  // (TextUtil.cpp:76-77), and Blink keeps the space in the text item. Box edges, <br> and <wbr> don't end the trailing
  // white space.
  let trailing = pieces.fragments.length
  while (trailing > 0) {
    const fragment = pieces.fragments[trailing - 1]!
    const white = fragment.kind === 'collapsed' || fragment.kind === 'forced-break' || fragment.kind === 'trimmed' ||
      fragment.kind === 'hanging' || fragment.kind === 'box-start' || fragment.kind === 'box-end' || fragment.kind === 'br' ||
      fragment.kind === 'wbr' || (fragment.kind === 'text' && SPACES_AND_TABS.test(fragment.painted))
    if (!white) break
    trailing--
  }
  const beforeTrailing = trailing > 0 ? pieces.fragments[trailing - 1]! : null
  // Blink shapes a space with the text before it only where the two had one direction in the paragraph: items split
  // where the level changes, and a shaping group ends where the direction does (ShouldBreakShapingBeforeText,
  // inline_node.cc:470-490). The fragments' levels come after Blink's line-end rule, which moves trailing spaces to the
  // base level, so the painter resolves the space as the paragraph did (UAX #9 N1, N2): it takes the direction of the
  // text on both sides where they agree, a number counting as right-to-left, and the base direction otherwise. `A` before
  // a space and Hebrew in an RTL paragraph was shaped without the space, 10.67 px, and painted with it in one override
  // span 9.79 px (c-1235f5a7105d6155).
  let spaceJoinsText = true
  if (rules.resolvesTrailingSpaceDirection && beforeTrailing !== null && beforeTrailing.kind === 'text' && trailing < pieces.fragments.length) {
    let lastPiece = -1
    for (let f = pieces.fragments.length - 1; f >= trailing && lastPiece < 0; f--) {
      const fragment = pieces.fragments[f]!
      if ((fragment.kind === 'text' || fragment.kind === 'trimmed' || fragment.kind === 'hanging') && fragment.painted.length > 0) lastPiece = f
    }
    if (lastPiece >= 0) {
      const after = neighbour(c, l, lastPiece, 1)
      const textDirection = beforeTrailing.level & 1
      const afterDirection = after === null ? base & 1 : /^\p{Nd}/u.test(after.painted) ? 1 : after.level & 1
      spaceJoinsText = textDirection === afterDirection || textDirection === (base & 1)
    }
  }
  // A piece that continues the grapheme cluster of the piece before it in the same leaf takes that piece's level too.
  // The engines split pieces where the level changes, inside a cluster as well: at the paragraph's end a U+200C after
  // a letter of another direction gets the base level. Painted at its own level it would follow the override span's
  // closing control, which ends the letter's cluster (UAX #29 GB4), and an overflowing line that breaks at clusters
  // breaks there (Blink's break-anywhere retry, c-4793c60cfde7b77d). At the letter's level the browser splits the two
  // by level itself, as the paragraph did, with no control between them.
  // Only the units that continue the cluster move: a space after the U+200C keeps its own level (c-d0d9e12845327e52).
  const clusterPrefix: number[] = []
  for (let f = 0; f < pieces.fragments.length; f++) {
    const fragment = pieces.fragments[f]!
    const before = f > 0 ? pieces.fragments[f - 1]! : null
    let prefix = 0
    if (fragment.kind === 'text' && before !== null && before.kind === 'text' && before.run === fragment.run && before.end === fragment.start &&
      before.level !== fragment.level && before.painted.length > 0 && fragment.painted.length > 0) {
      const boundaries = graphemeBoundaries(before.painted + fragment.painted, graphemes)
      if (!boundaries.includes(before.painted.length)) {
        let next = before.painted.length + fragment.painted.length
        for (let k = 0; k < boundaries.length; k++) if (boundaries[k]! > before.painted.length) { next = boundaries[k]!; break }
        prefix = next - before.painted.length
      }
    }
    clusterPrefix.push(prefix)
  }
  const paintedLevels: number[] = []
  const levelOf = (f: number, fragment: Extract<Fragment, { kind: 'text' | 'trimmed' | 'hanging' }>): number => {
    if (clusterPrefix[f]! === fragment.painted.length && clusterPrefix[f]! > 0) return paintedLevels[f - 1]!
    return f >= trailing && spaceJoinsText && beforeTrailing !== null && beforeTrailing.kind === 'text' && beforeTrailing.run === fragment.run ? beforeTrailing.level : fragment.level
  }
  for (let f = 0; f < pieces.fragments.length; f++) {
    const fragment = pieces.fragments[f]!
    paintedLevels.push(fragment.kind === 'text' || fragment.kind === 'trimmed' || fragment.kind === 'hanging' ? levelOf(f, fragment) : base)
  }

  let reorders = false
  let hyphenated = false
  let firstText = -1
  let lastText = -1
  // The first painted leaf of the line and its painted text.
  let firstRun = -1
  let firstRunText = ''
  // The last fragment with painted characters that has a place in the line's geometry, which a trimmed space hasn't,
  // and whether a trimmed space follows it.
  let lastPainted = -1
  let trimmedAfter = false
  // The first and the last fragment with painted characters of any kind.
  let firstAny = -1
  let lastAny = -1
  const startEdges = new Set<number>()
  const endEdges = new Set<number>()
  for (let f = 0; f < pieces.fragments.length; f++) {
    const fragment = pieces.fragments[f]!
    switch (fragment.kind) {
      case 'text':
      case 'trimmed':
      case 'hanging':
        if (fragment.kind === 'text') {
          if (firstText < 0) firstText = f
          lastText = f
        }
        if (paintedLevels[f]! !== base) reorders = true
        if (firstRun < 0) firstRun = fragment.run
        if (fragment.run === firstRun) firstRunText += fragment.painted
        if (fragment.painted.length > 0) {
          if (firstAny < 0) firstAny = f
          lastAny = f
          if (fragment.kind === 'trimmed') trimmedAfter = true
          else {
            lastPainted = f
            trimmedAfter = false
          }
        }
        break
      case 'hyphen':
        hyphenated = true
        if (fragment.level !== base) reorders = true
        lastPainted = f
        trimmedAfter = false
        break
      case 'atomic':
        if (fragment.level !== base) reorders = true
        lastPainted = f
        trimmedAfter = false
        break
      case 'box-start':
        startEdges.add(fragment.element)
        break
      case 'box-end':
        endEdges.add(fragment.element)
        break
      case 'collapsed':
      case 'forced-break':
      case 'br':
      case 'wbr':
        break
    }
  }
  // In the paragraph the hyphen belongs to the line after the break was taken, and the letters around a joined edge
  // are one cluster run; painted, the hyphen span and the leading U+200D start new items and grapheme clusters, which
  // an overflowing line would break before (Blink HandleOverflow's break-anywhere retry, WebKit's soft wrap opportunity
  // after a soft hyphen at a text box end, InlineFormattingUtils.cpp:385-437, Gecko's word-wrap break before a frame).
  let nowrap = hyphenated || joinsPreviousLine
  const firstInSpan = firstRun >= 0 && index.leaves[firstRun]!.parent === -1 && collapses && ASCII_SPACE_ONLY.test(firstRunText)
  // The line ended at a soft wrap: another line follows and no forced break ended it. Painted alone it's its block's
  // last line and its bidi paragraph's end, so the painter ends the line with softWrapBox where the engine's rules for
  // the line's end read whether more content follows:
  // - Every engine, a last character that the end of a bidi paragraph resets and that the paragraph kept above or below
  //   the base level (a U+200C or U+200D after a letter of another direction, Gecko's trailing white space, which has
  //   no line-end rule): reset, it becomes an item, box or frame of its own, shaped apart from the letter before it
  //   and open to an overflow break before it. The box isn't such a character, so the run before it isn't at the
  //   paragraph's end.
  // - WebKit and Gecko, trailing white space that hangs: a pre-wrap sequence hangs unconditionally at a soft wrap and
  //   only conditionally at the end (WebKit horizontalAlignmentOffset, InlineFormattingUtils.cpp:198-217), Gecko's
  //   TextAlignLine hangs or trims it for alignment and justification only on a wrapped line (nsLineLayout.cpp:3505-3516),
  //   reserves a span's end border and padding on each of its lines (nsInlineFrame.cpp:512-513).
  // - Blink, trailing spaces that hang: they hang conditionally on a block's last line and unconditionally on a wrapped
  //   one (ComputeTrailingSpaceWidth, line_info.cc:353-366), and at the paragraph's end ICU gives them the base level,
  //   which splits them from the item of a text of another level, so the two are shaped apart and the text loses its
  //   pair adjustment with the space (c-0985b4f121df8555).
  // - Blink, a trimmed collapsible space where the line's end isn't reshaped: the paragraph shaped the text with the space
  //   after it and trimmed the space afterwards (line_breaker.cc:255-268), while a block's end removes the space from
  //   the text before shaping (ExitBlock, inline_items_builder.cc:1622-1629). Where the end is reshaped
  //   (needsAccurateEndPosition), the paragraph shaped the text without the space, as the block's end does.
  // A line block that doesn't wrap gets no box, and neither does a line ending with R7's U+200D, which allows no break
  // after it (UAX #14 LB8a, ICU line.txt:151-153).
  let lastContent: Fragment['kind'] | null = null
  for (let f = pieces.fragments.length - 1; f >= 0 && lastContent === null; f--) {
    const kind = pieces.fragments[f]!.kind
    if (kind !== 'box-start' && kind !== 'box-end' && kind !== 'collapsed' && kind !== 'wbr') lastContent = kind
  }
  // In Blink a trimmed space has its own rule below. In WebKit a space reset to the base level becomes a run of its own,
  // which the line's end removes whole with its plain width, where the paragraph took the space's width inside its run
  // (in an RTL box the width of the word with the space less the word's, Line::Run::removeTrailingWhitespace,
  // InlineLine.cpp:963-987; c-27daf54faef90b34).
  let resetAboveBase = false
  let boxLevel: number | null = null
  let endPiece: number
  switch (rules.trimmedSpaceAtEnd.takesBox) {
    case 'where-reset': endPiece = Math.max(lastPainted, lastAny); break
    case 'by-rule': endPiece = lastPainted; break
  }
  if (endPiece >= 0) {
    const fragment = pieces.fragments[endPiece]!
    if ((fragment.kind === 'text' || fragment.kind === 'hanging' || fragment.kind === 'trimmed') && fragment.level !== base) {
      const painted = fragment.painted
      let last = painted.length - 1
      if (last > 0 && painted.charCodeAt(last) >= 0xdc00 && painted.charCodeAt(last) <= 0xdfff) last--
      // Blink breaks before the box by UAX #14, which allows no break after U+200D (LB8a) or a word joiner (LB11; ICU
      // line.txt), so the box would take the character to the second line with it (c-abda075f770468f9). WebKit breaks
      // between any text and an atomic inline (isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:385-437).
      const glued = rules.noBreakBeforeBoxAfter !== null && rules.noBreakBeforeBoxAfter.test(painted)
      resetAboveBase = !glued && resetAtParagraphEnd(bidi, painted.slice(last))
      // ICU gives a boundary neutral the level of the character after it (adjustWSLevels' second loop, ubidi.cpp:2309-2321),
      // so the box goes inside the override span that holds the character: there the override forces the box to the
      // character's level too. After the span it would sit at the block's level and hand that to the character
      // (c-ede93b4ce64f1921).
      if (resetAboveBase) boxLevel = paintedLevels[endPiece]!
    }
  }
  // The break that ended the line is the business of the box holding the line's last character: for a soft wrap
  // opportunity made by a character that disappears at the break, such as a space, the properties of the box directly
  // containing it control the break (CSS Text 3 §5.1), so a wrapping span's trimmed space ends a line in a nowrap block.
  // Blink ends the painted line before the box there too: after trailing spaces the line is in its trailing state, which
  // ends at the first item that can't trail, whatever that item's own wrapping (BreakLine, line_breaker.cc:1100-1107;
  // c-1a3fdb57af71a97c). In WebKit the same box moved the fit decision of a line at its threshold
  // (c-a98e884c6f665a5d, not traced), so there and in Gecko the block's own white-space still decides.
  let endWraps = wraps(paragraph.whiteSpace)
  switch (rules.lineEndWrapping) {
    case 'block': break
    case 'last-character-box':
      for (let f = pieces.fragments.length - 1; f >= 0; f--) {
        const fragment = pieces.fragments[f]!
        if ((fragment.kind === 'text' || fragment.kind === 'trimmed' || fragment.kind === 'hanging') && fragment.painted.length > 0) {
          endWraps = wraps(styleUnder(paragraph, index, index.leaves[fragment.run]!.parent).whiteSpace)
          break
        }
        if (fragment.kind === 'atomic' || fragment.kind === 'hyphen') break
      }
      break
  }
  let softWrap = l < lines.length - 1 && endWraps && !hyphenated && !joinsPreviousLine && !pieces.joinsNextLine &&
    lastContent !== 'forced-break' && lastContent !== 'br'
  switch (rules.trimmedSpaceAtEnd.takesBox) {
    case 'where-reset': softWrap &&= resetAboveBase || lastContent === 'hanging'; break
    case 'by-rule': softWrap &&= resetAboveBase || lastContent === 'hanging' || (lastContent === 'trimmed' && rules.trimmedSpaceAtEnd.rule(pieces.facts)); break
  }

  // Gecko adds letter spacing after a text run's last character whatever it is, and after any other character only when
  // it isn't a tab or a formatting character and a cluster starts after it (CanAddSpacingAfter, nsTextFrame.cpp:3860-3873;
  // a formatting character has General_Category Cf, gfxFont.cpp:3661-3667). A painted line's text run ends with the
  // line. The paragraph's went on where the next character it kept was in the same leaf at the same level (a text run
  // ends between frames of different levels, ContinueTextRunAcrossFrames, nsTextFrame.cpp:2022-2030; a preserved newline
  // resolves to the base level), and there a tab or a formatting character at the line's end took no spacing. One
  // character after it keeps it from being last: a collapsible space, which the line's end trims with its spacing, or
  // where spaces are preserved a newline, which takes no spacing (:3864-3866) and ends the block's last line as the
  // block's end does. A newline is a paragraph separator for the bidi algorithm, so a line that needs the soft wrap box
  // for its levels gets none.
  let continuation = ''
  let spacingAtRunEnd = false
  if (rules.spacingAfterRunEnd && lastPainted >= 0 && !trimmedAfter && !pieces.joinsNextLine) {
    const fragment = pieces.fragments[lastPainted]!
    if (fragment.kind === 'text') {
      const style = styleUnder(paragraph, index, index.leaves[fragment.run]!.parent)
      if (style.letterSpacing !== 0 && /[\t\p{Cf}]$/u.test(fragment.painted)) {
        // The next piece the paragraph's text run holds, if the run reaches it: a collapsed piece isn't in the run,
        // and anything that isn't text ends it.
        let runGoesOn = false
        search: for (let q = l; q < lines.length; q++) {
          const fragments = lines[q]!.pieces.fragments
          for (let k = q === l ? lastPainted + 1 : 0; k < fragments.length; k++) {
            const next = fragments[k]!
            if (next.kind === 'collapsed') continue
            if (next.kind === 'text' || next.kind === 'trimmed' || next.kind === 'hanging') {
              if (next.painted.length === 0) continue
              runGoesOn = next.run === fragment.run && next.level === fragment.level
            } else if (next.kind === 'forced-break') {
              // This line's own forced break is painted after the character, so nothing needs adding.
              runGoesOn = q > l && next.run === fragment.run && fragment.level === base
            }
            break search
          }
        }
        if (runGoesOn) {
          const collapsesSpaces = style.whiteSpace === 'normal' || style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre-line'
          if (collapsesSpaces) continuation = ' '
          else if (!softWrap || lastContent !== 'hanging') {
            // The newline would reset the character before it to the base level, which the box is there to prevent. A
            // formatting character has no width, so its place among the line's pieces shows in no box, and its spacing
            // does: the newline wins, and the line gets no box.
            continuation = '\n'
            softWrap = false
            boxLevel = null
          } else spacingAtRunEnd = true
        }
      }
    }
  }


  // The script of the line's first characters. The engines give a character of script Common or Inherited the script of
  // the run it continues, so at a line's start that of the text before the line (Blink's ScriptRunIterator merges it
  // into the current set, script_run_iterator.cc:491-540; Gecko's gfxScriptItemizer), and painted alone it takes the
  // script of what follows on the line. `leadingScript` says the two differ: the text before the line has another
  // script than the first character with a script on the line, before which a character other than white space stands.
  let leadingScript: string | null = null
  // With the engine's script itemizer the painter asks it instead, which also follows a closing bracket to the script of
  // its opening bracket (CloseBracket, script_run_iterator.cc:443-470: `)` after Arabic paired with `(` after Latin is
  // Latin, c-ca3da1d5e7083f35): the line's scripts in the paragraph, alone, and after U+061C.
  let marksScript = false
  switch (c.scripts.form) {
    case 'arabic-letter-mark': {
      const { scriptsOf, levelsOf } = c.scripts
      const inParagraph = c.scripts.scripts
      const from = c.scripts.lineStarts[l]!
      const to = c.scripts.lineStarts[l + 1]!
      const lineText = c.scripts.text.slice(from, to)
      const same = (scripts: Uint8Array, offset: number): boolean => {
        for (let k = 0; k < lineText.length; k++) if (scripts[offset + k] !== inParagraph[from + k]) return false
        return true
      }
      // A line under override spans holds their bidi controls, so its text is 16-bit whatever its characters.
      if (!same(scriptsOf(lineText, reorders), 0)) {
        // The mark is a strong character of class AL, which turns the European numbers after it into Arabic numbers (UAX #9
        // W2) and neutrals its way. It changes nothing where override spans hold all the line's text; elsewhere the line
        // takes it only if every character after it still resolves to the base level (c-bef92f5d154ec2f9: digits at the
        // paragraph's start take script Arabic from the text after them, and with the mark they would reorder).
        let keepsLevels = reorders
        if (!keepsLevels) {
          const levels = levelsOf(ARABIC_LETTER_MARK + lineText, paragraph.direction)
          keepsLevels = true
          for (let k = 1; k < levels.length; k++) if (levels[k] !== base) keepsLevels = false
        }
        if (keepsLevels && same(scriptsOf(ARABIC_LETTER_MARK + lineText, true), 1)) marksScript = true
        else leadingScript = c.scripts.before[l] ?? 'other'
      }
      break
    }
    case 'limit-only': {
      let painted = ''
      for (let f = 0; f < pieces.fragments.length && painted.length < 64; f++) {
        const fragment = pieces.fragments[f]!
        if (fragment.kind === 'text' || fragment.kind === 'trimmed' || fragment.kind === 'hanging' || fragment.kind === 'hyphen') painted += fragment.painted
      }
      const own = FIRST_WITH_SCRIPT.exec(painted)
      const lead = own === null ? painted : painted.slice(0, own.index)
      const before = c.scripts.before[l]!
      if (before !== null && /\S/u.test(lead) && (own === null || scriptOf(painted.slice(own.index)) !== before)) leadingScript = before
      break
    }
    case 'none': break
  }
  // A line whose content reaches past its band by the engine's own widths was kept whole by the paragraph: nothing
  // before its end could take the break, or the break was chosen with other widths than the line ended up with (Blink
  // reshapes a line's end after choosing it, and the reshaped end can be wider; ShapeLine, shaping_line_breaker.cc:500-600).
  // Painted alone, the browser sees the final widths first and breaks the line again wherever its own rules let it, so
  // such a line doesn't wrap. Three kinds of line keep wrapping: one that ends in white space, which hangs or trims as
  // it did because the line wraps; one with a single cluster, which nothing can break; and one that ends with a
  // character the engine trims only while it breaks lines (PaintRules.trimsAtLineEnd: in Blink a character HanKerning
  // may trim, which ShapeLine does only while it breaks lines, shaping_line_breaker.cc:344-376; the candidates are
  // Character::MaybeHanKerningOpenOrCloseFast's ranges, character.h:138-141).
  const wantsScriptMark = marksScript && firstText >= 0 && firstText === firstAny
  if (!softWrap && !trimmedAfter && lastPainted >= 0 && pieces.overflows) {
    const last = pieces.fragments[lastPainted]!
    const endsInWhiteSpace = last.kind === 'hanging' || (last.kind === 'text' && /\s$/u.test(last.painted))
    const mayTrim = rules.trimsAtLineEnd !== null && last.kind === 'text' && rules.trimsAtLineEnd.test(last.painted)
    if (!endsInWhiteSpace && !mayTrim) {
      let painted = ''
      for (let f = 0; f < pieces.fragments.length; f++) {
        const fragment = pieces.fragments[f]!
        if (fragment.kind === 'text' || fragment.kind === 'hyphen') painted += fragment.painted
        else if (fragment.kind === 'atomic') painted += 'x'
      }
      // The script mark below is a cluster of its own, which an overflowing line would keep alone on its first line.
      if (graphemeBoundaries(painted, graphemes).length > 2 || wantsScriptMark) nowrap = true
    }
  }

  // The line's last piece ends in a collapsible space that the engine kept, because text it didn't place follows the
  // space in the leaf: Gecko counts a frame's trimmable white space back from its last character, and an unused soft
  // hyphen there stops the count (GetTrimmedOffsets, nsTextFrame.cpp:3319-3328; c-c3098254ada63761). Painted alone the
  // space would end the block and be trimmed, so the collapsed text after it is painted too, and the browser leaves it
  // out again as it did.
  let keptSpace = -1
  if (lastAny >= 0 && lastAny === lastPainted) {
    const fragment = pieces.fragments[lastAny]!
    if (fragment.kind === 'text' && /[ \t\n\r\f]$/.test(fragment.painted)) {
      const whiteSpace = styleUnder(paragraph, index, index.leaves[fragment.run]!.parent).whiteSpace
      if (whiteSpace === 'normal' || whiteSpace === 'nowrap' || whiteSpace === 'pre-line') {
        for (let f = lastAny + 1; f < pieces.fragments.length; f++) {
          const next = pieces.fragments[f]!
          if (next.kind === 'collapsed' && next.run === fragment.run && /[^ \t\n\r\f]/.test(index.text.slice(next.start, next.end))) keptSpace = lastAny
        }
      }
    }
  }

  // Blink reads a run's script where it applies letter spacing, which a cursive script's run doesn't take
  // (IsCursiveScript(run->script_), shape_result.cc:977-1024), and where it picks fonts and shapes. After Arabic text the
  // painter starts the line with U+061C ARABIC LETTER MARK, which has no width and script Arabic, so the characters after
  // it continue an Arabic run as they did (probe .artifacts/lab/painter-r3/probes/forms-l7.json, Chrome 153: a guillemet
  // after Arabic under -1px letter spacing is 17.797 px in the paragraph and with the mark, 16.797 px without). Unicode
  // has no such character for the other scripts. The mark is a strong right-to-left character, so it goes in the first
  // piece's text node, inside that piece's override span where the line has any. It is a grapheme cluster of its own,
  // which a line that reaches past its band and still wraps would keep alone on its first line, so such a line gets none.
  const scriptMark = wantsScriptMark && (nowrap || !pieces.overflows)

  // ---- What painting this line alone can't reproduce (PainterLimitName has the source readings) ----
  const limits: PainterLimit[] = []
  if (firstAny >= 0) {
    const first = pieces.fragments[firstAny] as TextPiece
    const last = pieces.fragments[lastAny] as TextPiece
    const before = neighbour(c, l, firstAny, -1)
    const after = neighbour(c, l, lastAny, 1)
    const startInLeaf = before !== null && shapesWith(c, before.run, first.run)
    const endInLeaf = after !== null && shapesWith(c, last.run, after.run)
    const cut = (left: string, right: string): boolean => {
      const a = left.slice(-16)
      return !graphemeBoundaries(a + right.slice(0, 16), graphemes).includes(a.length)
    }
    if ((startInLeaf && cut(before.painted, first.painted)) || (endInLeaf && cut(last.painted, after.painted))) {
      limits.push({ limit: 'edge-inside-cluster', detail: 'the line starts or ends inside a grapheme cluster' })
    }
    const startInWord = joinsPreviousLine || (startInLeaf && before.kind === 'text' && first.kind === 'text' && !/\s$/u.test(before.painted) && !/^\s/u.test(first.painted))
    const endInWord = pieces.joinsNextLine || (endInLeaf && last.kind === 'text' && after.kind === 'text' && !/\s$/u.test(last.painted) && !/^\s/u.test(after.painted))
    const softEnd = lastContent !== 'forced-break' && lastContent !== 'br'
    const edges: LineEdges = {
      first, last, lastAt: lastAny, before, after, startInLeaf, endInLeaf, startInWord, endInWord, softEnd, joinsPreviousLine,
      leadingScript, scriptMarkUnpainted: marksScript && !scriptMark, spacingAtRunEnd,
    }
    const own = rules.limits({ paragraph, index }, lines[l]!, edges)
    for (let k = 0; k < own.length; k++) limits.push(own[k]!)
  }
  if (!nowrap && pieces.overflows) {
    let painted = ''
    for (let f = 0; f < pieces.fragments.length; f++) {
      const fragment = pieces.fragments[f]!
      if (fragment.kind === 'text' || fragment.kind === 'hyphen' || fragment.kind === 'hanging' || fragment.kind === 'trimmed') painted += fragment.painted
      else if (fragment.kind === 'atomic') painted += 'x'
    }
    if (graphemeBoundaries(painted, graphemes).length > 2) limits.push({ limit: 'overflowing-line-rebreaks', detail: 'the line reaches past its band and wraps when painted' })
  }
  return { paintedLevels, clusterPrefix, reorders, firstText, lastText, firstRun, firstInSpan, lastPainted, startEdges, endEdges, nowrap, softWrap, boxLevel, continuation, keptSpace, scriptMark, limits }
}

// What goes in a line's block, in logical order, and whether the spans that continue past the line carry their end edges
// to the painted block's second line.
function lineTokens<Facts>(c: Context<Facts>, l: number, plan: LinePlan, joinsPreviousLine: boolean): { tokens: Token[]; continues: boolean } {
  const { paragraph, rules, index, base } = c
  const { pieces } = c.lines[l]!
  const { paintedLevels, clusterPrefix, firstText, lastText, firstRun, firstInSpan, lastPainted, endEdges, softWrap, boxLevel, continuation, keptSpace, scriptMark } = plan
  const tokens: Token[] = []
  // The last fragment with painted text of each leaf on the line.
  const lastPieceOfRun = new Map<number, number>()
  for (let f = 0; f < pieces.fragments.length; f++) {
    const fragment = pieces.fragments[f]!
    if ((fragment.kind === 'text' || fragment.kind === 'trimmed' || fragment.kind === 'hanging') && fragment.painted.length > 0) lastPieceOfRun.set(fragment.run, f)
  }
  // The elements open at this point of the walk, outermost first.
  const open: number[] = []
  // The event of the last painted piece, or -1 before the first.
  let cursor = -1
  // The leaf and level of the text node being collected; run -1 when none is.
  let run = -1
  let level = base
  let text = ''
  let wrap: Extract<Token, { t: 'text' }>['wrap'] = 'none'
  let forcedBreak: Extract<Fragment, { kind: 'forced-break' }> | null = null
  const flush = (): void => {
    if (text.length === 0) return
    tokens.push({ t: 'text', level, text, wide: WIDE.test(index.leaves[run]!.text), wrap })
    text = ''
  }
  const endPiece = (): void => {
    flush()
    run = -1
  }
  const openElement = (e: number): void => {
    endPiece()
    if (index.elements[e]!.node.kind !== 'span') throw new Error(`the painter can't open element ${e}, a ${index.elements[e]!.node.kind}`)
    tokens.push({ t: 'open', element: e })
    open.push(e)
  }
  const closeElement = (e: number): void => {
    endPiece()
    const top = open.pop()
    if (top === undefined || top !== e) throw new Error(`the painter closed element ${e} out of document order`)
    tokens.push({ t: 'close', element: e })
  }
  // Brings the walk to the event at `target`, the next painted piece. Before the first piece it opens the elements
  // holding the piece, outermost first; later it replays the opens and closes strictly between the last piece and this
  // one.
  const reach = (parent: number, target: number): void => {
    if (cursor < 0) {
      const chain: number[] = []
      for (let e = parent; e >= 0; e = index.elements[e]!.parent) chain.push(e)
      for (let k = chain.length - 1; k >= 0; k--) openElement(chain[k]!)
    } else {
      for (let k = cursor + 1; k < target; k++) {
        const event = index.events[k]!
        if (event.kind === 'open') openElement(event.element)
        else if (event.kind === 'close') closeElement(event.element)
      }
    }
    cursor = Math.max(cursor, target)
  }
  // A piece's text (PaintRules.paintsSourceWhiteSpace). WebKit's text box holds the node's own characters, and its measuring reads them: a word is
  // measured together with the character after it only where that is U+0020 (TextUtil::width's extendedMeasuring,
  // TextUtil.cpp:76-81), so a tab or newline that the engine's content shows as a space is painted as itself, and the
  // browser collapses it to the same space. `A` before a tab in `normal` is 10.67 px natively and 9.79 px before a painted
  // space (c-656822d19d89c4e8, found on the fresh set).
  const paintedText = (fragment: TextPiece): string => {
    const painted = fragment.painted
    if (!rules.paintsSourceWhiteSpace || fragment.end - fragment.start !== painted.length || !painted.includes(' ')) return painted
    let out = ''
    for (let i = 0; i < painted.length; i++) {
      const source = index.text.charCodeAt(fragment.start + i)
      out += painted.charCodeAt(i) === 0x20 && (source === 0x09 || source === 0x0a || source === 0x0c || source === 0x0d) ? index.text[fragment.start + i]! : painted[i]!
    }
    return out
  }
  const enterLeaf = (leaf: number, pieceLevel: number): void => {
    if (leaf !== run) {
      const indexed = index.leaves[leaf]!
      reach(indexed.parent, indexed.event)
      endPiece()
      run = leaf
    } else if (pieceLevel !== level) {
      flush()
    }
    level = pieceLevel
    wrap = leaf === firstRun && firstInSpan ? 'block-style' : 'none'
  }
  for (let f = 0; f < pieces.fragments.length; f++) {
    const fragment = pieces.fragments[f]!
    switch (fragment.kind) {
      case 'text': {
        const prefix = clusterPrefix[f]!
        if (prefix > 0 && prefix < fragment.painted.length) {
          // The start of the piece continues the cluster before it, at that piece's level; the rest follows at its own.
          enterLeaf(fragment.run, paintedLevels[f - 1]!)
          text += paintedText(fragment).slice(0, prefix)
          enterLeaf(fragment.run, paintedLevels[f]!)
          text += paintedText(fragment).slice(prefix)
          if (f === lastText && pieces.joinsNextLine) text += ZWJ
          if (f === lastPainted) text += continuation
          break
        }
        enterLeaf(fragment.run, paintedLevels[f]!)
        if (f === firstText && joinsPreviousLine) text += ZWJ
        if (f === firstText && scriptMark) text += ARABIC_LETTER_MARK
        text += paintedText(fragment)
        if (f === lastText && pieces.joinsNextLine) text += ZWJ
        if (f === lastPainted) text += continuation
        break
      }
      case 'trimmed':
      case 'hanging':
        enterLeaf(fragment.run, paintedLevels[f]!)
        if (fragment.kind === 'hanging' && f > 0 && pieces.fragments[f - 1]!.kind !== 'hanging') {
          const form = rules.hangingForm(c.lines[l]!, pieces.fragments[f - 1]!, fragment, styleUnder(paragraph, index, index.leaves[fragment.run]!.parent))
          if (form !== 'same-node') flush()
          if (form === 'own-group') wrap = 'shaping-group'
        }
        text += paintedText(fragment)
        break
      case 'hyphen':
        enterLeaf(fragment.run, fragment.level)
        flush()
        tokens.push({ t: 'node', level: fragment.level, node: { what: 'hyphen', fragment } })
        break
      case 'atomic': {
        const indexed = index.elements[fragment.element]!
        if (indexed.node.kind !== 'atomic') throw new Error(`fragment names element ${fragment.element}, a ${indexed.node.kind}, as atomic`)
        reach(indexed.parent, indexed.open)
        endPiece()
        tokens.push({ t: 'node', level: fragment.level, node: { what: 'atomic', atomic: indexed.node } })
        break
      }
      case 'box-start': {
        const indexed = index.elements[fragment.element]!
        if (indexed.node.kind !== 'span' || !hasEdge(indexed.node.inlineStart)) break
        reach(indexed.parent, indexed.open)
        openElement(fragment.element)
        break
      }
      case 'box-end': {
        const indexed = index.elements[fragment.element]!
        if (indexed.node.kind !== 'span' || !hasEdge(indexed.node.inlineEnd)) break
        // Before the first piece, the span itself is among the elements to open.
        reach(cursor < 0 ? fragment.element : indexed.parent, indexed.close)
        closeElement(fragment.element)
        break
      }
      case 'wbr': {
        // The paragraph's <wbr> between two leaves, painted as it was.
        const indexed = index.elements[fragment.element]!
        reach(indexed.parent, indexed.open)
        endPiece()
        tokens.push({ t: 'node', level: null, node: { what: 'wbr' } })
        break
      }
      case 'forced-break':
        // Painted after everything else on the line (below): Gecko's hyphen at a soft hyphen before a newline comes after
        // the newline among the fragments (c-6ed3f560105d1120).
        forcedBreak = fragment
        break
      case 'br': {
        // The paragraph's <br>, for the same reason.
        const indexed = index.elements[fragment.element]!
        reach(indexed.parent, indexed.open)
        endPiece()
        tokens.push({ t: 'node', level: null, node: { what: 'br' } })
        break
      }
      case 'collapsed': {
        // White space the engine collapsed between two painted pieces of one leaf is painted where it was, and the
        // browser collapses it again. In WebKit a run whose trailing white space was collapsed takes no more text
        // (Line::appendTextContent's needsNewRun, InlineLine.cpp:374-385), so the pieces on the two sides are two boxes,
        // whose float32 widths sum to another line width than one box's (a newline after a space in `normal`: 46.66 +
        // 500 px against one box of 546.66003 px, c-334d212830923ac4). Other collapsed text stays out: an unused soft
        // hyphen would offer the painted line a break.
        const source = index.text.slice(fragment.start, fragment.end)
        const between = fragment.run === run && text.length > 0 && (lastPieceOfRun.get(fragment.run) ?? -1) > f && /^[ \t\n\r\f]+$/.test(source)
        if (between || (keptSpace >= 0 && f > keptSpace && fragment.run === run)) text += source
        break
      }
    }
  }
  if (forcedBreak !== null) {
    // The preserved newline, U+2028 or U+2029 that ended the line, painted as it was: the painted line then ends at a
    // forced break as the paragraph's did, and not at its block's end, which the engines don't treat alike. Blink ends
    // a line at a forced break whatever hangs past the band, where at a block's end it handles the overflow and backs
    // up to an earlier break (BreakLine's IsAtEnd, line_breaker.cc:1030-1040; c-ac6b59190d0c4ac4, a <br>). A forced
    // break at a block's end makes no line of its own.
    const fragment: Extract<Fragment, { kind: 'forced-break' }> = forcedBreak
    enterLeaf(fragment.run, run === fragment.run ? level : base)
    text += index.text.slice(fragment.start, fragment.end)
  }
  endPiece()
  // Whether the spans that continue past the line carry their end edges to the painted block's second line.
  let continues = false
  if (softWrap) {
    // Spans whose box ends on this line close before the wrap.
    while (open.length > 0 && endEdges.has(open[open.length - 1]!)) closeElement(open[open.length - 1]!)
    // The white space of the box's parent decides the break before it (CSS Text §5.1: at the boundary of two inline
    // boxes the nearest common ancestor's white space applies), as the paragraph's break inside that span did. Where
    // the span holding the line's end doesn't wrap, nothing can wrap before the box: the line stays its block's last
    // line, without the end edges of the spans that continue.
    if (open.length === 0 || wraps(styleUnder(paragraph, index, open[open.length - 1]!).whiteSpace)) {
      tokens.push({ t: 'node', level: boxLevel, node: { what: 'soft-wrap-box' } })
      continues = true
    }
  }
  while (open.length > 0) closeElement(open[open.length - 1]!)

  return { tokens, continues }
}

// The end of the unit that starts at token i: an element with everything in it, or one token.
function unitEnd(tokens: readonly Token[], i: number): number {
  if (tokens[i]!.t !== 'open') return i + 1
  let depth = 0
  for (let k = i; k < tokens.length; k++) {
    const token = tokens[k]!
    if (token.t === 'open') depth++
    else if (token.t === 'close' && --depth === 0) return k + 1
  }
  throw new Error('the painter left an element open')
}

// The lowest level among tokens [from, to), or null when none has a level.
function lowest(tokens: readonly Token[], from: number, to: number): number | null {
  let min: number | null = null
  for (let k = from; k < to; k++) {
    const token = tokens[k]!
    if ((token.t === 'text' || token.t === 'node') && token.level !== null && (min === null || token.level < min)) min = token.level
  }
  return min
}

// Where the override span that starts with the unit [i, end) ends: it holds the longest run of units above `level`. Units
// without a level (an empty span, a <wbr>) stay inside the run between two units above the level, and outside it at its
// end.
function overrideEnd(tokens: readonly Token[], end: number, to: number, level: number): number {
  let groupEnd = end
  for (let k = end; k < to;) {
    const next = unitEnd(tokens, k)
    const nextMin = lowest(tokens, k, next)
    if (nextMin !== null) {
      if (nextMin <= level) break
      groupEnd = next
    }
    k = next
  }
  return groupEnd
}

// Whether two consecutive text pieces of one direction end up in different override spans (PaintRules.controlsBetweenPieces).
// In Blink an override span's bidi controls are items of their own, and any item that isn't text or a tag ends a shaping
// group (ShapeText, inline_node.cc:1636-1673), where the paragraph shaped the two pieces together: pieces of one level
// that an element with pieces of another level separates from their neighbours, and pieces two levels apart.
function controlsBetweenPieces(tokens: readonly Token[], base: number): boolean {
  let found = false
  let spans = 0
  let last: { level: number; span: number } | null = null
  const walk = (from: number, to: number, depth: number, span: number): void => {
    for (let i = from; i < to;) {
      const end = unitEnd(tokens, i)
      const min = lowest(tokens, i, end)
      if (min !== null && min - base > depth) {
        const groupEnd = overrideEnd(tokens, end, to, base + depth)
        walk(i, groupEnd, depth + 1, ++spans)
        i = groupEnd
        continue
      }
      const token = tokens[i]!
      if (token.t === 'open') walk(i + 1, end - 1, depth, span)
      else if (token.t === 'text') {
        if (last !== null && last.span !== span && (last.level - token.level) % 2 === 0) found = true
        last = { level: token.level, span }
      } else if (token.t === 'node' && token.node.what !== 'wbr' && token.node.what !== 'soft-wrap-box') last = null
      i = end
    }
  }
  walk(0, tokens.length, 0, 0)
  return found
}

// The limits of every line with a line box, in paintLines' order.
export function painterLimits<Facts>(paragraph: Paragraph, lines: readonly PaintLine<Facts>[], rules: PaintRules<Facts>): PainterLimit[][] {
  const c = contextOf(paragraph, lines, rules)
  const out: PainterLimit[][] = []
  let previousJoins = false
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!
    if (!line.hasLineBox) continue
    const plan = planLine(c, l, previousJoins)
    const limits = plan.limits
    if (rules.controlsBetweenPieces !== null && plan.reorders && controlsBetweenPieces(lineTokens(c, l, plan, previousJoins).tokens, c.base)) {
      limits.push({ limit: rules.controlsBetweenPieces.limit, detail: rules.controlsBetweenPieces.detail })
    }
    out.push(limits)
    previousJoins = line.pieces.joinsNextLine
  }
  return out
}

// One block per line with a line box. `refusedRows` are the rows of the slot list the engine refused because the line
// moved below their floats, which take no line (fillLine's below-floats).
export function paintLines<Facts>(paragraph: Paragraph, lines: readonly PaintLine<Facts>[], refusedRows: readonly number[], rules: PaintRules<Facts>, doc: Document): HTMLDivElement[] {
  const c = contextOf(paragraph, lines, rules)
  const { index, base } = c
  const out: HTMLDivElement[] = []
  // The last line with a line box before this one.
  let previousJoins = false
  for (let l = 0; l < lines.length; l++) {
    const { pieces, slot, hasLineBox } = lines[l]!
    if (!hasLineBox) continue
    const joinsPreviousLine = previousJoins
    previousJoins = pieces.joinsNextLine
    const plan = planLine(c, l, joinsPreviousLine)
    const { reorders, startEdges, endEdges, nowrap } = plan
    const element = doc.createElement('div')
    const s = element.style
    s.display = 'block'
    s.margin = '0'
    s.padding = '0'
    s.border = '0'
    s.width = `${slot.width}px`
    s.height = `${paragraph.lineHeight}px`
    s.lineHeight = `${paragraph.lineHeight}px`
    setFont(s, paragraph.font)
    s.letterSpacing = `${paragraph.letterSpacing}px`
    s.wordSpacing = `${paragraph.wordSpacing}px`
    s.whiteSpace = paragraph.whiteSpace
    s.wordBreak = paragraph.wordBreak
    s.overflowWrap = paragraph.overflowWrap
    s.setProperty('line-break', paragraph.lineBreak)
    s.setProperty('tab-size', String(paragraph.tabSize))
    s.direction = paragraph.direction
    s.textAlign = paragraph.textAlign
    if (paragraph.textAlign !== 'start') s.setProperty('text-align-last', pieces.align)
    s.textIndent = pieces.indented ? `${paragraph.textIndent}px` : '0'
    s.textTransform = 'none'
    element.lang = paragraph.lang
    if (reorders) s.unicodeBidi = 'bidi-override'
    if (nowrap) s.setProperty('text-wrap-mode', 'nowrap')
    if (slot.left < 0 || slot.right < 0) throw new Error(`the painter paints a slot as floats and can't paint negative insets (${slot.left}, ${slot.right})`)
    // The paragraph's slot floats come before its content (DESIGN.md §2.9), so only the paragraph's first line build
    // places them, and every later build, a retry after a refused slot included, finds them in the formatting context.
    // WebKit counts tab stops from the line rect's left after the floats it finds but before those the build places
    // itself (InlineLineBuilder.cpp:478, :1394-1396). A painted line block places floats it holds, so a line from a later
    // build gets its floats from a holder block around it instead, where they intrude on the line block's first line.
    const firstBuild = l === 0 && !refusedRows.includes(0)
    const intruding = (slot.left > 0 || slot.right > 0) && !firstBuild
    let root = element
    if (intruding) {
      root = doc.createElement('div')
      const r = root.style
      r.display = 'block'
      r.margin = '0'
      r.padding = '0'
      r.border = '0'
      r.width = `${slot.width}px`
      r.height = `${paragraph.lineHeight}px`
    }
    if (slot.left > 0) root.append(floatInset(doc, 'left', slot.left, paragraph.lineHeight))
    if (slot.right > 0) root.append(floatInset(doc, 'right', slot.right, paragraph.lineHeight))
    if (intruding) root.append(element)

    const { tokens, continues } = lineTokens(c, l, plan, joinsPreviousLine)

    // ---- The line's DOM ----
    // Builds tokens [from, to) under `parent`, which sits inside `depth` override spans, so at level base + depth.
    // `bare` says text can't sit directly in `parent`: WebKit measures a text box with its parent's unicode-bidi and
    // direction (TextUtil.cpp:89-90), so under an override an RTL box is measured as an RTL override run, which sums
    // glyph advances in another order than the paragraph's LTR run and can move the width by a float32 step. A plain span
    // between keeps the override, which forces every character until the override ends, and the paragraph's measurement.
    const build = (from: number, to: number, depth: number, parent: HTMLElement, bare: boolean): void => {
      for (let i = from; i < to;) {
        const end = unitEnd(tokens, i)
        const min = lowest(tokens, i, end)
        if (min !== null && min - base > depth) {
          // An override span over the longest run of units above this level.
          const groupEnd = overrideEnd(tokens, end, to, base + depth)
          const span = doc.createElement('span')
          span.style.unicodeBidi = 'bidi-override'
          // An override of the opposite parity adds exactly one level.
          span.style.direction = ((base + depth + 1) & 1) === 0 ? 'ltr' : 'rtl'
          parent.append(span)
          build(i, groupEnd, depth + 1, span, true)
          i = groupEnd
          continue
        }
        const token = tokens[i]!
        switch (token.t) {
          case 'open': {
            const indexed = index.elements[token.element]!
            const node = indexed.node
            if (node.kind !== 'span') throw new Error(`the painter can't open element ${token.element}, a ${node.kind}`)
            const span = styledSpan(doc, node, styleUnder(paragraph, index, indexed.parent), node.lang)
            if (startEdges.has(token.element)) paintEdge(span.style, 'start', node.inlineStart)
            // A span without its box end on the line continues past it; on a soft wrap its end edge goes to the painted next line.
            if (endEdges.has(token.element) || continues) paintEdge(span.style, 'end', node.inlineEnd)
            if (node.verticalAlign !== 'baseline') span.style.verticalAlign = node.verticalAlign
            // The paragraph's spans have its direction, which decides the side of their edges; inside an override span
            // they would inherit the override's.
            if (reorders) span.style.direction = paragraph.direction
            parent.append(span)
            build(i + 1, end - 1, depth, span, false)
            break
          }
          case 'close':
            throw new Error('the painter closed an element it never opened')
          case 'text': {
            let holder = parent
            if (token.wrap === 'block-style') holder = parent.appendChild(styledSpan(doc, paragraph, paragraph, null))
            else if (token.wrap === 'shaping-group') {
              holder = parent.appendChild(doc.createElement('span'))
              holder.style.verticalAlign = '0px'
            } else if (bare || (parent === element && reorders)) holder = parent.appendChild(doc.createElement('span'))
            // Every text frame of the paragraph has the paragraph's direction. Gecko ends a text run between two frames
            // whose writing modes differ, direction included (ContinueTextRunAcrossFrames, nsTextFrame.cpp:2033-2038), so
            // text under an override span, which would inherit the override's direction, says its own.
            if (holder !== parent && reorders) holder.style.direction = paragraph.direction
            holder.append(textNode(doc, rules.textNodesKeepLeafStorage, token.text, token.wide))
            break
          }
          case 'node':
            switch (token.node.what) {
              case 'hyphen': parent.append(hyphenSpan(doc, rules.hyphenSpan, token.node.fragment)); break
              case 'atomic': parent.append(atomicBox(doc, token.node.atomic)); break
              case 'soft-wrap-box': parent.append(softWrapBox(doc)); break
              case 'wbr':
              case 'br': parent.append(doc.createElement(token.node.what)); break
            }
            break
        }
        i = end
      }
    }
    build(0, tokens.length, 0, element, false)
    out.push(root)
  }
  return out
}
