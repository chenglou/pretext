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
// - The line's pieces are painted in logical order inside the elements that hold them. Between two consecutive painted
//   pieces the painter replays the paragraph's element structure, so a span between them with nothing painted of its own
//   is painted empty and its neighbours keep the element between them. A span's start and end edges are painted on the
//   lines that hold its box-start and box-end fragments, and a span with such an edge on a line where none of its content
//   is painted is painted for the edge alone. Each leaf's slice of the line is one text node, split only where its bidi
//   level changes (R2). A bare slice of ASCII white space alone at the start of a line goes in a span, because a text
//   node of only such white space as a block's first child isn't laid out.
// - Trailing collapsible white space stays in its slice, so the engine trims it and shapes the text before it the same
//   way (R3). Preserved white space is painted as laid out, and in Blink hanging spaces are their own text node, as they
//   are their own item result, in a shaping group of their own where the paragraph reshaped the text before them.
//   Collapsed white space, forced breaks and <br> aren't painted; <wbr> is.
// - The text is painted as the engine laid it out (R5).
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
// - An atomic inline is painted as an empty inline-block of its declared border box and margins, aligned to the line top,
//   for the app to fill.
// - A line without a line box paints nothing and gets no block.
// Nothing sets a text width: the lab compares the painted rects with the rects the observation contract expects
// (DESIGN.md §7, §9).
import { indexContent, styleUnder } from './content.js'
import type { EngineName } from './env.js'
import type { AtomicInline, BelowFloats, BlinkLineGeometry, BoxEdge, CssFont, Fragment, GeckoLineGeometry, LineOf, Paragraph, TextStyle, WebKitLineGeometry } from './model.js'
import { B, BN, FSI, LRE, LRI, LRO, PDF, PDI, RLE, RLI, RLO, S, WS, bidiClassOf, bidiDataFor, type BidiData } from './unicode/bidi.js'
import { graphemeBoundaries, graphemeRulesFor } from './unicode/grapheme.js'

// U+0020 and U+0009..U+000D, the white space of Blink's IsASCIISpace: a text node holding only these as a block's first
// child gets no layout object in collapsing modes (Blink text.cc:319-364, the Blink port's layoutTextNeeded).
const ASCII_SPACE_ONLY = /^[\t-\r ]+$/
const SPACES_AND_TABS = /^[\t ]+$/
// R7's joiner.
const ZWJ = String.fromCharCode(0x200d)

// The shared fields of a line: all the painter reads.
export type PaintedLine = Pick<LineOf<unknown, unknown>, 'fragments' | 'hasLineBox' | 'joinsNextLine' | 'slot' | 'indented' | 'align'>
export type PaintableLayout = { belowFloats: readonly Pick<BelowFloats, 'row'>[] } & (
  | { engine: 'blink'; lines: readonly (PaintedLine & { geometry: Pick<BlinkLineGeometry, 'needsAccurateEndPosition' | 'width' | 'hangWidth' | 'availableWidth'> })[] }
  | { engine: 'webkit'; lines: readonly (PaintedLine & { geometry: Pick<WebKitLineGeometry, 'contentWidth' | 'hangingWidth' | 'lineBoxWidth'> })[] }
  | { engine: 'gecko'; lines: readonly (PaintedLine & { geometry: Pick<GeckoLineGeometry, 'width' | 'hang' | 'availableWidth'> })[] }
)

// How far the line's content reaches past its band by the engine's own widths, hanging white space left out, in the
// engine's units; 0 or less when it fits.
function overflow(layout: PaintableLayout, l: number): number {
  switch (layout.engine) {
    case 'blink': { const g = layout.lines[l]!.geometry; return g.width - g.hangWidth - g.availableWidth }
    case 'webkit': { const g = layout.lines[l]!.geometry; return g.contentWidth - g.hangingWidth - g.lineBoxWidth }
    case 'gecko': { const g = layout.lines[l]!.geometry; return g.width - g.hang - g.availableWidth }
  }
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

// R6: the hyphen, shaped the way the engine shapes it.
function hyphenSpan(doc: Document, engine: EngineName, fragment: Extract<Fragment, { kind: 'hyphen' }>): HTMLSpanElement {
  const span = doc.createElement('span')
  span.style.letterSpacing = `${fragment.letterSpacing}px`
  switch (engine) {
    case 'blink':
      // Blink shapes the hyphen alone, without spacing (hyphen_result.cc:12-16). A length vertical-align ends the
      // shaping group at the box edge (inline_node.cc:494-527) without moving the baseline.
      span.style.verticalAlign = '0px'
      break
    case 'webkit':
      // Layout measures the hyphen alone and paint shapes it with the word before it, so the width matches and the ink
      // keeps any kerning (specs/painter.md L3).
      break
    case 'gecko':
      // Gecko draws the hyphen from its own text run (nsTextFrame.cpp:7963-7984); an isolate ends the text run
      // (nsTextFrame.cpp:2091-2096).
      span.style.unicodeBidi = 'isolate'
      break
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

// A text node with the string storage the paragraph's node had. WebKit keeps a text node's string in 8 bits when it's
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
function textNode(doc: Document, engine: EngineName, text: string, wideLeaf: boolean): Text {
  if (engine !== 'webkit' || !wideLeaf || WIDE.test(text)) return doc.createTextNode(text)
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

// What the painter puts in a line block, in logical order, before it places the override spans.
type Token =
  | { t: 'open'; element: number }
  | { t: 'close'; element: number }
  // One text node. `wrap` says what holds it: nothing of its own, a span with the block's styles (a bare white-space
  // slice that starts the line), or a span that ends Blink's shaping group.
  // `wide` says the leaf's text holds a character above U+00FF.
  | { t: 'text'; level: number; text: string; wide: boolean; wrap: 'none' | 'block-style' | 'shaping-group' }
  // A node the painter made: the hyphen span, an atomic box, a <wbr>, the soft wrap box. A null level sits at any level.
  | { t: 'node'; level: number | null; node: HTMLElement }

export function paintLines(paragraph: Paragraph, layout: PaintableLayout, doc: Document): HTMLDivElement[] {
  const index = indexContent(paragraph)
  const bidi = bidiDataFor(layout.engine)
  const graphemes = graphemeRulesFor(layout.engine)
  const base = paragraph.direction === 'rtl' ? 1 : 0
  const collapses = paragraph.whiteSpace === 'normal' || paragraph.whiteSpace === 'nowrap'
  const out: HTMLDivElement[] = []
  // The last line with a line box before this one.
  let previousJoins = false
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    if (!line.hasLineBox) continue
    const joinsPreviousLine = previousJoins
    previousJoins = line.joinsNextLine
    const element = doc.createElement('div')
    const s = element.style
    s.display = 'block'
    s.margin = '0'
    s.padding = '0'
    s.border = '0'
    s.width = `${paragraph.width}px`
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
    if (paragraph.textAlign !== 'start') s.setProperty('text-align-last', line.align)
    s.textIndent = line.indented ? `${paragraph.textIndent}px` : '0'
    s.textTransform = 'none'
    element.lang = paragraph.lang
    if (line.slot.left < 0 || line.slot.right < 0) throw new Error(`the painter paints a slot as floats and can't paint negative insets (${line.slot.left}, ${line.slot.right})`)
    // The paragraph's slot floats come before its content (DESIGN.md §2.9), so only the paragraph's first line build
    // places them, and every later build, a retry after a refused slot included, finds them in the formatting context.
    // WebKit counts tab stops from the line rect's left after the floats it finds but before those the build places
    // itself (InlineLineBuilder.cpp:478, :1394-1396). A painted line block places floats it holds, so a line from a later
    // build gets its floats from a holder block around it instead, where they intrude on the line block's first line.
    const firstBuild = l === 0 && !layout.belowFloats.some(refused => refused.row === 0)
    const intruding = (line.slot.left > 0 || line.slot.right > 0) && !firstBuild
    let root = element
    if (intruding) {
      root = doc.createElement('div')
      const r = root.style
      r.display = 'block'
      r.margin = '0'
      r.padding = '0'
      r.border = '0'
      r.width = `${paragraph.width}px`
      r.height = `${paragraph.lineHeight}px`
    }
    if (line.slot.left > 0) root.append(floatInset(doc, 'left', line.slot.left, paragraph.lineHeight))
    if (line.slot.right > 0) root.append(floatInset(doc, 'right', line.slot.right, paragraph.lineHeight))
    if (intruding) root.append(element)

    // The line's trailing white space. A painted line is a bidi paragraph of its own, and all three browsers give white
    // space at a paragraph's end the paragraph level (resetAtParagraphEnd), so the level it's painted at only decides
    // node division. Painting it at the level of the text before it in the same leaf keeps that slice one text node, as
    // it was in the paragraph: WebKit measures a word together with the space after it in its text box
    // (TextUtil.cpp:76-77), and Blink keeps the space in the text item. Box edges, <br> and <wbr> don't end the trailing
    // white space.
    let trailing = line.fragments.length
    while (trailing > 0) {
      const fragment = line.fragments[trailing - 1]!
      const white = fragment.kind === 'collapsed' || fragment.kind === 'forced-break' || fragment.kind === 'trimmed' ||
        fragment.kind === 'hanging' || fragment.kind === 'box-start' || fragment.kind === 'box-end' || fragment.kind === 'br' ||
        fragment.kind === 'wbr' || (fragment.kind === 'text' && SPACES_AND_TABS.test(fragment.painted))
      if (!white) break
      trailing--
    }
    const beforeTrailing = trailing > 0 ? line.fragments[trailing - 1]! : null
    // A piece that continues the grapheme cluster of the piece before it in the same leaf takes that piece's level too.
    // The engines split pieces where the level changes, inside a cluster as well: at the paragraph's end a U+200C after
    // a letter of another direction gets the base level. Painted at its own level it would follow the override span's
    // closing control, which ends the letter's cluster (UAX #29 GB4), and an overflowing line that breaks at clusters
    // breaks there (Blink's break-anywhere retry, c-4793c60cfde7b77d). At the letter's level the browser splits the two
    // by level itself, as the paragraph did, with no control between them.
    const continuesCluster: boolean[] = []
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      const before = f > 0 ? line.fragments[f - 1]! : null
      let continues = false
      if (fragment.kind === 'text' && before !== null && before.kind === 'text' && before.run === fragment.run && before.end === fragment.start &&
        before.level !== fragment.level && before.painted.length > 0 && fragment.painted.length > 0) {
        const boundaries = graphemeBoundaries(before.painted + fragment.painted, graphemes)
        continues = !boundaries.includes(before.painted.length)
      }
      continuesCluster.push(continues)
    }
    const paintedLevels: number[] = []
    const levelOf = (f: number, fragment: Extract<Fragment, { kind: 'text' | 'trimmed' | 'hanging' }>): number => {
      if (continuesCluster[f]!) return paintedLevels[f - 1]!
      return f >= trailing && beforeTrailing !== null && beforeTrailing.kind === 'text' && beforeTrailing.run === fragment.run ? beforeTrailing.level : fragment.level
    }
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
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
    const startEdges = new Set<number>()
    const endEdges = new Set<number>()
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
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
    if (reorders) s.unicodeBidi = 'bidi-override'
    // In the paragraph the hyphen belongs to the line after the break was taken, and the letters around a joined edge
    // are one cluster run; painted, the hyphen span and the leading U+200D start new items and grapheme clusters, which
    // an overflowing line would break before (Blink HandleOverflow's break-anywhere retry, WebKit's soft wrap opportunity
    // after a soft hyphen at a text box end, InlineFormattingUtils.cpp:385-437, Gecko's word-wrap break before a frame).
    if (hyphenated || joinsPreviousLine) s.setProperty('text-wrap-mode', 'nowrap')
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
    for (let f = line.fragments.length - 1; f >= 0 && lastContent === null; f--) {
      const kind = line.fragments[f]!.kind
      if (kind !== 'box-start' && kind !== 'box-end' && kind !== 'collapsed' && kind !== 'wbr') lastContent = kind
    }
    let resetAboveBase = false
    if (lastPainted >= 0) {
      const fragment = line.fragments[lastPainted]!
      if ((fragment.kind === 'text' || fragment.kind === 'hanging') && fragment.level !== base) {
        const painted = fragment.painted
        let last = painted.length - 1
        if (last > 0 && painted.charCodeAt(last) >= 0xdc00 && painted.charCodeAt(last) <= 0xdfff) last--
        // Blink breaks before the box by UAX #14, which allows no break after U+200D (LB8a) or a word joiner (LB11; ICU
        // line.txt), so the box would take the character to the second line with it (c-abda075f770468f9). WebKit breaks
        // between any text and an atomic inline (isAtSoftWrapOpportunity, InlineFormattingUtils.cpp:385-437).
        const glued = layout.engine === 'blink' && /[\u200d\u2060\ufeff]$/.test(painted)
        resetAboveBase = !glued && resetAtParagraphEnd(bidi, painted.slice(last))
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
    for (let f = line.fragments.length - 1; f >= 0 && layout.engine === 'blink'; f--) {
      const fragment = line.fragments[f]!
      if ((fragment.kind === 'text' || fragment.kind === 'trimmed' || fragment.kind === 'hanging') && fragment.painted.length > 0) {
        endWraps = wraps(styleUnder(paragraph, index, index.leaves[fragment.run]!.parent).whiteSpace)
        break
      }
      if (fragment.kind === 'atomic' || fragment.kind === 'hyphen') break
    }
    let softWrap = l < layout.lines.length - 1 && endWraps && !hyphenated && !joinsPreviousLine && !line.joinsNextLine &&
      lastContent !== 'forced-break' && lastContent !== 'br'
    switch (layout.engine) {
      case 'blink': softWrap &&= resetAboveBase || lastContent === 'hanging' || (lastContent === 'trimmed' && !layout.lines[l]!.geometry.needsAccurateEndPosition); break
      case 'webkit':
      case 'gecko': softWrap &&= resetAboveBase || lastContent === 'hanging'; break
    }

    // A line whose content reaches past its band by the engine's own widths was kept whole by the paragraph: nothing
    // before its end could take the break, or the break was chosen with other widths than the line ended up with (Blink
    // reshapes a line's end after choosing it, and the reshaped end can be wider; ShapeLine, shaping_line_breaker.cc:500-600).
    // Painted alone, the browser sees the final widths first and breaks the line again wherever its own rules let it, so
    // such a line doesn't wrap. Three kinds of line keep wrapping: one that ends in white space, which hangs or trims as
    // it did because the line wraps; one with a single cluster, which nothing can break; and in Blink one that ends with
    // a character HanKerning may trim, which ShapeLine does only while it breaks lines (shaping_line_breaker.cc:344-376;
    // the candidates are Character::MaybeHanKerningOpenOrCloseFast's ranges, character.h:138-141).
    if (!softWrap && !trimmedAfter && lastPainted >= 0 && overflow(layout, l) > 0) {
      const last = line.fragments[lastPainted]!
      const endsInWhiteSpace = last.kind === 'hanging' || (last.kind === 'text' && /\s$/u.test(last.painted))
      const mayTrim = layout.engine === 'blink' && last.kind === 'text' && /[\u2018-\u301f\uff08-\uff60]$/.test(last.painted)
      if (!endsInWhiteSpace && !mayTrim) {
        let painted = ''
        for (let f = 0; f < line.fragments.length; f++) {
          const fragment = line.fragments[f]!
          if (fragment.kind === 'text' || fragment.kind === 'hyphen') painted += fragment.painted
          else if (fragment.kind === 'atomic') painted += 'x'
        }
        if (graphemeBoundaries(painted, graphemes).length > 2) s.setProperty('text-wrap-mode', 'nowrap')
      }
    }

    // Blink: how the line's hanging spaces are painted after text of the same leaf. They are an item result of their own,
    // rounded up alone (HandleTrailingSpaces, line_breaker.cc:2418-2534), and the text before them either keeps its pair
    // adjustment with the first space or lost it when the paragraph reshaped its end. ShapeLine reshapes the end of an
    // item's part unless the break sits after a space and the line needs no accurate end position
    // (dont_reshape_end_if_at_space_, shaping_line_breaker.cc:481-488, line_breaker.cc:1655-1659). The break before
    // hanging spaces sits after them (non_hangable_run_end moves the part's end back to the text, :492-497), except where
    // the text overflowed and HandleOverflow's retry broke it at a character (override_break_anywhere_,
    // line_breaker.cc:4258-4265, :4612-4623): that break sits at the text's end.
    // - 'own-node': the text kept the adjustment. Spaces in a text node of their own are an item of their own, still
    //   shaped with the text before them (ShapeText, inline_node.cc:1636-1673), and the text's end is its item's end,
    //   which ShapeLine never reshapes (:466-473). In one node a line that fits is one item result, rounded once (:283-299).
    // - 'same-node': the overflow break reshaped the text. In one node the painted line overflows and breaks the same way,
    //   so the text is reshaped and the spaces keep their part of a split pair adjustment, as in the paragraph.
    // - 'own-group': the line needs an accurate end position, so the text was reshaped whatever the break. A length
    //   vertical-align on a span around the spaces ends the shaping group (inline_node.cc:494-527), and the text is shaped
    //   without them. The spaces lose their part of a pair adjustment that HarfBuzz splits (FontFacts.pairKerning).
    const hangingForm = (run: number): 'own-node' | 'same-node' | 'own-group' => {
      if (layout.engine !== 'blink') return 'own-node'
      const geometry = layout.lines[l]!.geometry
      const style = styleUnder(paragraph, index, index.leaves[run]!.parent)
      const breaksAnywhere = style.overflowWrap !== 'normal' || style.wordBreak === 'break-word' || style.lineBreak === 'anywhere'
      if (breaksAnywhere && overflow(layout, l) > 0) return 'same-node'
      return geometry.needsAccurateEndPosition ? 'own-group' : 'own-node'
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
    if (layout.engine === 'gecko' && lastPainted >= 0 && !trimmedAfter && !line.joinsNextLine) {
      const fragment = line.fragments[lastPainted]!
      if (fragment.kind === 'text') {
        const style = styleUnder(paragraph, index, index.leaves[fragment.run]!.parent)
        if (style.letterSpacing !== 0 && /[\t\p{Cf}]$/u.test(fragment.painted)) {
          // The next piece the paragraph's text run holds, if the run reaches it: a collapsed piece isn't in the run,
          // and anything that isn't text ends it.
          let runGoesOn = false
          search: for (let q = l; q < layout.lines.length; q++) {
            const fragments = layout.lines[q]!.fragments
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
            else if (!softWrap) continuation = '\n'
          }
        }
      }
    }

    // ---- The line's tokens ----
    const tokens: Token[] = []
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
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      switch (fragment.kind) {
        case 'text':
          enterLeaf(fragment.run, paintedLevels[f]!)
          if (f === firstText && joinsPreviousLine) text += ZWJ
          text += fragment.painted
          if (f === lastText && line.joinsNextLine) text += ZWJ
          if (f === lastPainted) text += continuation
          break
        case 'trimmed':
        case 'hanging':
          enterLeaf(fragment.run, paintedLevels[f]!)
          if (layout.engine === 'blink' && fragment.kind === 'hanging' && f > 0 && line.fragments[f - 1]!.kind !== 'hanging') {
            const before = line.fragments[f - 1]!
            const form = before.kind === 'text' && before.run === fragment.run ? hangingForm(fragment.run) : 'own-node'
            if (form !== 'same-node') flush()
            if (form === 'own-group') wrap = 'shaping-group'
          }
          text += fragment.painted
          break
        case 'hyphen':
          enterLeaf(fragment.run, fragment.level)
          flush()
          tokens.push({ t: 'node', level: fragment.level, node: hyphenSpan(doc, layout.engine, fragment) })
          break
        case 'atomic': {
          const indexed = index.elements[fragment.element]!
          if (indexed.node.kind !== 'atomic') throw new Error(`fragment names element ${fragment.element}, a ${indexed.node.kind}, as atomic`)
          reach(indexed.parent, indexed.open)
          endPiece()
          tokens.push({ t: 'node', level: fragment.level, node: atomicBox(doc, indexed.node) })
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
          tokens.push({ t: 'node', level: null, node: doc.createElement('wbr') })
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
          tokens.push({ t: 'node', level: null, node: doc.createElement('br') })
          break
        }
        case 'collapsed':
          break
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
        tokens.push({ t: 'node', level: null, node: softWrapBox(doc) })
        continues = true
      }
    }
    while (open.length > 0) closeElement(open[open.length - 1]!)

    // ---- The line's DOM ----
    // The end of the unit that starts at token i: an element with everything in it, or one token.
    const unitEnd = (i: number): number => {
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
    const lowest = (from: number, to: number): number | null => {
      let min: number | null = null
      for (let k = from; k < to; k++) {
        const token = tokens[k]!
        if ((token.t === 'text' || token.t === 'node') && token.level !== null && (min === null || token.level < min)) min = token.level
      }
      return min
    }
    // Builds tokens [from, to) under `parent`, which sits inside `depth` override spans, so at level base + depth.
    // `bare` says text can't sit directly in `parent`: WebKit measures a text box with its parent's unicode-bidi and
    // direction (TextUtil.cpp:89-90), so under an override an RTL box is measured as an RTL override run, which sums
    // glyph advances in another order than the paragraph's LTR run and can move the width by a float32 step. A plain span
    // between keeps the override, which forces every character until the override ends, and the paragraph's measurement.
    const build = (from: number, to: number, depth: number, parent: HTMLElement, bare: boolean): void => {
      for (let i = from; i < to;) {
        const end = unitEnd(i)
        const min = lowest(i, end)
        if (min !== null && min - base > depth) {
          // An override span over the longest run of units above this level. Units without a level (an empty span, a
          // <wbr>) stay inside the run between two units above the level, and outside it at its end.
          let groupEnd = end
          for (let k = end; k < to;) {
            const next = unitEnd(k)
            const nextMin = lowest(k, next)
            if (nextMin !== null) {
              if (nextMin - base <= depth) break
              groupEnd = next
            }
            k = next
          }
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
            holder.append(textNode(doc, layout.engine, token.text, token.wide))
            break
          }
          case 'node':
            parent.append(token.node)
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
