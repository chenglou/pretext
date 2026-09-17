// The library's data: the styled paragraph it takes, with the facts about its fonts that Canvas can't show, and the lines
// each engine computes, in that engine's own geometry and units. DESIGN.md §1 and §2 explain every field with examples.
// The observation contract at the end (DESIGN.md §9) is what the lab computes from a layout; the library never does.
import type { BlinkLineStart } from './engines/blink/types.js'
import type { GeckoLineStart } from './engines/gecko/types.js'
import type { WebKitLineStart } from './engines/webkit/types.js'
import type { BlinkEnvironment, GeckoEnvironment, WebKitEnvironment } from './env.js'
import type { CanvasSettings } from './measure/canvas.js'
import type { MeasureLog } from './measure/log.js'

// ---- Input ----

// A font as CSS declares it: what the page sets and the painter writes.
export type CssFont = {
  // CSS font-family list, e.g. '"Helvetica Neue", Arial'.
  family: string
  // CSS px.
  size: number
  weight: number
  style: 'normal' | 'italic'
}

// Facts about the fonts a declaration realizes that engines read and Canvas can't show (DESIGN.md §1.2). Each is null
// when the caller doesn't know it. The engine then uses the default documented here, which Canvas measurement alone
// gives, and reports the named gap wherever the fact decides a result.
export type FontFacts = {
  // The family the browser realizes first: Blink's primary font, the first listed family that exists (PrimaryFont with should_contain_glyph false, font_fallback_list.h:141-145); WebKit's
  // index-0 family (FontCascadeFonts.cpp:200-218); Gecko's first font of the font group. A generic keyword stands for
  // itself ('system-ui'). Default: the first family in the list. Blink and Gecko compare it with their system-font
  // keywords; WebKit compares it with Courier New, which gets no width shortcut (FontCoreText.cpp:776-782).
  primaryFamily: string | null
  // The primary font maps U+2010, so a chosen soft hyphen is U+2010, else U+002D (Blink computed_style.cc:1804-1820,
  // WebKit StyleComputedStyle.cpp:419-435). Default: U+2010, measured in the run's context. Gap hyphen-glyph where
  // Canvas gives U+2010 and U+002D different widths there. Gecko doesn't read it: its Canvas substitutes U+002D the way
  // the DOM does (gfxHarfBuzzShaper.cpp:119-124; specs/PROBES.md, Firefox corrections).
  mapsHyphen: boolean | null
  // The primary font has kCTFontMonoSpaceTrait or kCTFontFixedAdvanceAttribute, so WebKit's Font::determinePitch treats
  // it as fixed pitch (FontCoreText.cpp:753-785) and its boxes take the width and breakWord shortcuts
  // (specs/webkit-gaps.md §2.3). Default: variable pitch. Gap fixed-pitch-path where a text item of a box that allows
  // simplified measuring doesn't measure f32(length × W(' ')) (webkit-gaps §2.5 test T1).
  monospace: boolean | null
  // The fonts drawing the declaration have an opsz axis. Blink's DOM shapes at the zoomed size with opsz at the CSS size,
  // which Canvas reproduces at the CSS size (probes-chrome correction 7). Gecko's OffscreenCanvas uses the axis default
  // (specs/gecko-canvas.md §1.2 C1a). Default: true when primaryFamily is the engine's system-font keyword (Blink:
  // system-ui, BlinkMacSystemFont; Gecko: system-ui, -apple-system; the macOS system font has the axis), else false.
  // Gap optical-size wherever the fact decides a width.
  opticalSizeAxis: boolean | null
  // How the font that draws joining-script text shapes: 'opentype' through GSUB and GPOS, where HarfBuzz reads the
  // shaping call's context, or 'aat' through morx, which doesn't (hb-ot-shape.cc:60-66, 100-101). Blink reads it at
  // shaping-call edges between joining letters (group edges and line-edge reshapes). Default: the call's text measured
  // alone, which is what an AAT font gives. Gap joining-technology at such an edge.
  joining: 'opentype' | 'aat' | null
}

export const UNKNOWN_FONT_FACTS: FontFacts = { primaryFamily: null, mapsHyphen: null, monospace: null, opticalSizeAxis: null, joining: null }

// A font declaration the library lays out with.
export type FontDecl = CssFont & { facts: FontFacts }

export type WhiteSpace = 'normal' | 'pre' | 'pre-wrap' | 'pre-line' | 'nowrap' | 'break-spaces'
export type WordBreak = 'normal' | 'break-all' | 'keep-all' | 'break-word'
export type OverflowWrap = 'normal' | 'break-word' | 'anywhere'
export type LineBreak = 'auto' | 'loose' | 'normal' | 'strict' | 'anywhere'
export type Direction = 'ltr' | 'rtl'

export type TextRunOf<Font> = {
  text: string
  // 'span': the text in its own <span> carrying this run's styles.
  // 'text': a bare text node inheriting the paragraph's styles (for example white space between spans);
  // its font, letterSpacing, wordSpacing and lang must equal the paragraph's.
  node: 'span' | 'text'
  font: Font
  letterSpacing: number
  wordSpacing: number
  // The span's lang attribute; null inherits the paragraph's.
  lang: string | null
}

// The paragraph with fonts of one kind: CSS fonts as a page declares them (the lab's cases), or declarations with
// facts (the library's input).
export type ParagraphOf<Font> = {
  runs: TextRunOf<Font>[]
  // The block's own styles, inherited by bare text nodes.
  font: Font
  letterSpacing: number
  wordSpacing: number
  // Content-box width in CSS px.
  width: number
  // Fixed line height in CSS px.
  lineHeight: number
  whiteSpace: WhiteSpace
  wordBreak: WordBreak
  overflowWrap: OverflowWrap
  lineBreak: LineBreak
  tabSize: number
  direction: Direction
  // The paragraph element's lang attribute.
  lang: string
}

export type TextRun = TextRunOf<FontDecl>
export type Paragraph = ParagraphOf<FontDecl>

// ---- Output: shared by every engine ----

// A piece of a line in logical order, as the engine classifies its content. `run` indexes paragraph.runs; offsets are
// UTF-16 offsets into the concatenation of all run texts. Fragments carry no widths: widths and positions are in the
// line's geometry, in the engine's units.
//
// `level` is the bidi embedding level the engine reorders the piece with, after its own line-end rule for trailing white
// space (Blink compares levels, WebKit parity, Gecko has none; specs/bidi.md §6). Engines split pieces where the level
// changes, as they split items and frames, so the painter can rebuild the paragraph's levels (specs/painter.md §4.4).
export type Fragment =
  // Content the engine lays out on this line: the source range as it is in the engine's content (collapsed white space
  // is one space, a newline in normal is a space). It includes controls the engine keeps in its content without placing
  // them, such as Blink's CR and FF in preserve modes (line_breaker.cc:2988-2994).
  | { kind: 'text'; run: number; start: number; end: number; painted: string; level: number }
  // Collapsible white space that stays in the engine's content but that the line end removed from the geometry after
  // the break was chosen (Blink RemoveTrailingCollapsibleSpace, WebKit trimmable trailing content, Gecko trimmed
  // trailing white space). It is painted, so the browser trims it again and shapes the text before it the same way
  // (specs/painter.md §3.1 c, §3.2 a, R3).
  | { kind: 'trimmed'; run: number; start: number; end: number; painted: string; level: number }
  // Source text the engine never places on this line: white space collapsed while its content was built, a removed
  // segment break, collapsible white space skipped at a line start, a text node without a layout object. Not painted.
  | { kind: 'collapsed'; run: number; start: number; end: number }
  // Preserved trailing white space that stays in the geometry but doesn't count against the available width.
  | { kind: 'hanging'; run: number; start: number; end: number; painted: string; level: number }
  // The hyphen drawn at a soft-hyphen break, after source offset `at`: U+2010 or U+002D as the engine chose it, with the
  // letter spacing the engine applies to it.
  | { kind: 'hyphen'; run: number; at: number; painted: string; letterSpacing: number; level: number }
  // A preserved newline, U+2028 or U+2029 that ended the line. Not painted.
  | { kind: 'forced-break'; run: number; start: number; end: number }

// The state the next line starts from, per engine (DESIGN.md §2.7).
export type LineStart = BlinkLineStart | WebKitLineStart | GeckoLineStart

export type LineOf<Start, Geometry> = {
  // [start, end) covers every source unit the line consumed; consecutive lines tile the text.
  start: number
  end: number
  fragments: Fragment[]
  // Whether the engine gives the line a line box that holds content: false for Blink's empty lines
  // (LineInfo::ShouldCreateLineBox, line_breaker.cc:945-975), WebKit lines without contentful inline content
  // (LineLayoutResult.h:94-105) and Gecko line boxes of block size 0 (nsLineLayout.cpp:1690-1712). Such a line is still a
  // line of the engine and is returned; it paints nothing, and the lab and the painter skip it.
  hasLineBox: boolean
  // The paragraph's shaping joined the letters on both sides of this line's end: Blink reshaped the edge with HarfBuzz
  // context under an OpenType joining font (FontFacts.joining), Gecko broke inside one shaped word. The painter puts
  // U+200D on both sides of the edge (specs/painter.md R7). Always false in WebKit, which never shapes across a line
  // edge (specs/painter.md §3.2 c).
  joinsNextLine: boolean
  geometry: Geometry
  // Gaps that depend on this line's breaks (DESIGN.md §2.8).
  gaps: Gap[]
  // null after the paragraph's last line.
  next: Start | null
}

// ---- Output: Blink geometry (Chrome 153). Raw LayoutUnits count 1/64 of a zoomed px (specs/blink-lines.md §1.1) ----

// One unit of Blink's OffsetMapping over the line's source units (offset_mapping.cc:278-299, 405-459): source [start,
// end) maps to text_content [textStart, textEnd). A collapsed unit maps to an empty range; a unit Blink generated, such
// as U+200B after leading preserved spaces, has an empty source range.
export type BlinkMappingUnit = { run: number; start: number; end: number; textStart: number; textEnd: number; collapsed: boolean }

// A HarfBuzz cluster of a shape result: consecutive glyphs sharing one character index, at
// HB_BUFFER_CLUSTER_LEVEL_MONOTONE_GRAPHEMES (hb-ot-shape.cc:466-522, 578-586).
export type BlinkGlyphCluster = {
  // [textStart, textEnd) in text_content.
  textStart: number
  textEnd: number
  // Where graphemes start inside the cluster, textStart included (CharacterBreakIterator: ICU char.brk for 16-bit text,
  // one grapheme per code unit except CR LF for 8-bit, character_break_iterator.cc:76-87, 180-198). ShapeResult splits a
  // cluster's advance equally among its graphemes (shape_result.cc:310-329).
  graphemeStarts: number[]
  // The cluster's advance in 16.16 fixed point of zoomed px (TextRunLayoutUnit).
  advance: number
}

// A FragmentItem of a line (logical_line_builder.cc:200-464), positioned by ComputeInlinePositions and ApplyTextAlign
// (inline_box_state.cc:845-856, inline_layout_algorithm.cc:303-311, 361-389). x and inlineSize are raw LayoutUnits from
// the content box's left edge; level is the item's bidi level, whose parity is its direction.
export type BlinkItem =
  // Text with a ShapeResultView over [textStart, textEnd).
  | { kind: 'text'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[] }
  // A tab run: flow control with a shape result of one space glyph per tab carrying its tab-stop advance
  // (shape_result.cc:1898-1938).
  | { kind: 'tab'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number; clusters: BlinkGlyphCluster[] }
  // A preserved newline: flow control without a shape result (logical_line_builder.cc:404-445).
  | { kind: 'forced-break'; run: number; textStart: number; textEnd: number; level: number; x: number; inlineSize: number }
  // The generated hyphen of a chosen soft hyphen, after the text item it ends at an even level and before it at an odd
  // level (PlaceHyphen, logical_line_builder.cc:447-464).
  | { kind: 'hyphen'; run: number; level: number; x: number; inlineSize: number }

export type BlinkLineGeometry = {
  // Device scale factor times browser zoom. raw / 64 / layoutZoom is CSS px.
  layoutZoom: number
  // LineInfo::AvailableWidth: trunc(f32(f32(width × layoutZoom) × 64)) raw.
  availableWidth: number
  // LineInfo::Width (line_breaker.cc:1149-1161): the sum of the line's item results, hanging spaces included.
  width: number
  // The part of width that hangs: preserved trailing spaces that don't count against availableWidth
  // (LineInfo::ComputeTrailingSpaceWidth, line_info.cc:289-400).
  hangWidth: number
  mapping: BlinkMappingUnit[]
  // In visual order (logical_line_builder.cc:688-760).
  items: BlinkItem[]
}

// ---- Output: WebKit geometry (Safari 27.0). float32 CSS px (specs/webkit-lines.md §1.1) ----

// An InlineDisplay::Box of type Text, WordSeparator or SoftLineBreak, one per text or soft-line-break Line::Run after
// close() (InlineDisplayContentBuilder.cpp:118-144, 196-325).
export type WebKitDisplayBox = {
  kind: 'text' | 'soft-line-break'
  run: number
  // [start, end): the box's content as offsets into the run's text (InlineDisplay::Box::Text start and length).
  start: number
  end: number
  // After resetBidiLevelForTrailingWhitespace (InlineLine.cpp:243-287).
  level: number
  isWordSeparator: boolean
  // The visual rect's left edge from the content box and its width (processNonBidiContent, processBidiContent,
  // InlineDisplayContentBuilder.cpp:505-600, 862-940). A soft line break has width 0.
  x: number
  width: number
  // needsHyphen: the rendered content is the box text followed by this string (InlineDisplayContentBuilder.cpp:279-281).
  hyphen: string | null
}

export type WebKitLineGeometry = {
  // The line's available width: trunc64(f32(width × pageZoom)) as float32 (StylePrimitiveData.h:341-360).
  lineBoxWidth: number
  // Line::contentLogicalWidth after close(): trimmed content removed, hanging content and the hyphen included
  // (InlineLine.cpp:745-778).
  contentWidth: number
  // HangingContent's trailing white-space width, which doesn't count against the available width (InlineLine.h:370-376).
  hangingWidth: number
  // contentGeometry.logicalRightIncludingNegativeMargin, where an RTL line's content edge is computed from
  // (InlineDisplayLineBuilder.cpp:136-138).
  contentLogicalRight: number
  // In box index order: visual order (InlineIteratorTextBox.cpp:71-102).
  boxes: WebKitDisplayBox[]
}

// ---- Output: Gecko geometry (Firefox 156). Integer app units, 60 per CSS px (specs/gecko-lines.md §2) ----

// One source unit of a frame, from measuredStart on.
export type GeckoCharacter = {
  // TransformText removed it: collapsed white space, an unused soft hyphen, a bidi control (gfxSkipChars).
  skipped: boolean
  // The text run's IsClusterStart flag at the unit's transformed index (gfxFont.cpp:708-769); false when skipped.
  clusterStart: boolean
  // What GetAdvanceWidth adds for the unit: its glyph advance or ligature share and the letter spacing, word spacing and
  // tab width after it (gfxTextRun.cpp:1214-1256, nsTextFrame.cpp:4089-4295).
  advance: number
}

// An nsTextFrame continuation placed on the line (nsTextFrame::ReflowText, nsTextFrame.cpp:10847-11532).
export type GeckoFrameGeometry = {
  run: number
  // GetContentOffset and GetContentEnd, as source offsets.
  contentStart: number
  contentEnd: number
  // Where measurement starts after the line-start skip of trimmable white space (nsTextFrame.cpp:10935-10951).
  measuredStart: number
  level: number
  // mRect: the left edge from the content box after ReorderFrames (nsBidiPresUtils.cpp:1494-1533, 1769-1866), and
  // ceil(max(0, advance)) less the floored TrimTrailingWhiteSpace delta (nsTextFrame.cpp:11268-11273, 11605).
  x: number
  width: number
  // BSize > 0: characters fit or the hyphen was used (nsTextFrame.cpp:11279-11307).
  hasHeight: boolean
  // TEXT_HYPHEN_BREAK: the hyphen run's advance is inside the box after the text (AddHyphenToMetrics, :6829-6845).
  usedHyphen: boolean
  // [measuredStart, contentEnd), one per source unit.
  characters: GeckoCharacter[]
}

export type GeckoLineGeometry = {
  // max(1, round(60 / devicePixelRatio)) (nsDeviceContext.cpp:52-63).
  appUnitsPerDevPixel: number
  // The available inline size: NSToIntRound(f32(width) × 60).
  availableWidth: number
  // The line box inline size psd->mICoord after TrimTrailingWhiteSpaceIn (nsLineLayout.cpp:2851-2985).
  width: number
  // GetHangFrom (nsLineLayout.cpp:3420-3450): trailing white space hanging past the available width; TextAlignLine moves
  // a wrapped line by it when it hangs against the line's direction (:3503-3512, 3594-3602).
  hang: number
  // In logical order.
  frames: GeckoFrameGeometry[]
}

export type BlinkLine = LineOf<BlinkLineStart, BlinkLineGeometry>
export type WebKitLine = LineOf<WebKitLineStart, WebKitLineGeometry>
export type GeckoLine = LineOf<GeckoLineStart, GeckoLineGeometry>

// A Canvas-versus-DOM gap a paragraph or line runs into: the prediction can be wrong where it applies (DESIGN.md §5).
export type GapName =
  | 'control-character-width'
  | 'soft-hyphen-shaping'
  | 'hyphen-glyph'
  | 'letter-spacing-ligatures'
  | 'canvas-language'
  | 'optical-size'
  | 'font-size-quantization'
  | 'bitmap-emoji-size'
  | 'unsafe-to-break'
  | 'script-context'
  | 'space-in-shaping'
  | 'in-word-prefix'
  | 'glyph-clusters'
  | 'joining-technology'
  | 'fixed-pitch-path'
  | 'simplified-measuring'
  | 'rtl-shaping-across-inline-boxes'
  | 'page-zoom'
  | 'dictionary-breaks-unavailable'
  | 'dictionary-breaks-stand-in'
  | 'font-fallback'
  | 'float32-precision'
  | 'string-storage'
  | 'ui-language'
  | 'han-kerning'
  | 'tab-stops'
  | 'page-history'
  | 'engine-build'

export type Gap = { gap: GapName; run: number | null; detail: string }

// `engine` is the environment's engine, the union's tag. `gaps` holds the conditions of the paragraph's content, fonts
// and environment; lines hold the ones their breaks decide.
export type ParagraphLayout =
  | { engine: 'blink'; env: BlinkEnvironment; lines: BlinkLine[]; measure: MeasureLog; gaps: Gap[] }
  | { engine: 'webkit'; env: WebKitEnvironment; lines: WebKitLine[]; measure: MeasureLog; gaps: Gap[] }
  | { engine: 'gecko'; env: GeckoEnvironment; lines: GeckoLine[]; measure: MeasureLog; gaps: Gap[] }

export type BlinkLayout = Extract<ParagraphLayout, { engine: 'blink' }>
export type WebKitLayout = Extract<ParagraphLayout, { engine: 'webkit' }>
export type GeckoLayout = Extract<ParagraphLayout, { engine: 'gecko' }>

// ---- Observation contract (DESIGN.md §9) ----
// What rebuild/lab/observe/<engine>.ts derives from a layout by porting each engine's Range geometry code. The library
// never computes it; the types live here because the lab may import types from this file only.

// One observed number. There is no third state for a rect field: a reported rect is observable by definition.
export type Expected =
  // The ported geometry rule gives the value exactly from engine output. Compared exactly.
  | { state: 'predicted'; value: number }
  // The value rests on a Canvas stand-in for data the engine had, named by the gap: glyph advances inside a word, which
  // code points a glyph covers. Compared exactly; a mismatch is attributed to the gap, never to an engine rule.
  | { state: 'limited'; gap: GapName; value: number }

export type ExpectedRect = {
  // The engine line of the item, box or frame the rect comes from.
  line: number
  // CSS px relative to the paragraph's content box, as the DOMRect reports them after the engine's rounding.
  x: Expected
  width: Expected
}

// An engine output fact that no Range rect of either kind reflects, by the cited geometry rule: the rects are the same
// whatever its value. Listed, never compared, and never counted as coverage for the rule that computed it.
export type UnobservableFact = {
  line: number
  // A field path into the layout, e.g. 'lines[2].geometry.items[3].inlineSize'.
  fact: string
  // The geometry rule, with its source citation.
  rule: string
}

export type ExpectedObservation = {
  // Per code point of the concatenated run text, in order: the rects of a Range over it in its run's text node, in the
  // order the engine reports them.
  codePoints: { offset: number; length: number; rects: ExpectedRect[] }[]
  // Per run: the rects of a Range over its whole text node.
  nodes: ExpectedRect[][]
  unobservable: UnobservableFact[]
}

// Canvas measureText in a context with these settings: live in the page, or answered from a recorded call log.
export type CanvasMeasure = (settings: CanvasSettings, text: string) => number

export type ObservationPort<Layout extends ParagraphLayout> = (paragraph: Paragraph, layout: Layout, measure: CanvasMeasure) => ExpectedObservation
