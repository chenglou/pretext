// Gecko's prepared paragraph (Firefox 156.0). The Gecko port owns this file. What a fill leaves of a line is in lines.ts.
import type { GeckoEnvironment } from '../../env.js'
import type { Context } from '../../measure/canvas.js'
import type { FontDecl, Gap, Paragraph, TextStyle } from '../../model.js'

// white-space as its two longhands and the predicates Gecko derives from them (nsStyleStruct.h:1303-1367,
// specs/gecko-text.md §2.1), plus the other inherited text properties a frame reads from its own style.
export type GeckoStyle = {
  collapse: 'collapse' | 'preserve' | 'preserve-breaks' | 'break-spaces'
  wrap: boolean
  whiteSpaceIsSignificant: boolean
  newlineIsSignificant: boolean
  whitespaceCanHang: boolean
  wordCanWrap: boolean
  isBreakSpaces: boolean
  // EffectiveWordBreak: break-word is normal plus overflow-wrap anywhere.
  wordBreak: 'normal' | 'break-all' | 'keep-all'
  lineBreak: TextStyle['lineBreak']
  // tab-size as a number of spaces, the one style value ComputeTabWidthAppUnits reads from the text frame itself.
  tabSize: number
}

// A text leaf of the paragraph, a DOM text node, with what its frames read from their parent element's computed style: a
// text node inherits every property the model has. `run` indices name leaves.
export type GeckoLeaf = {
  // Source offsets [start, end); leaves tile the text.
  start: number
  end: number
  // The span holding it, -1 for the block.
  parent: number
  style: GeckoStyle
  font: FontDecl
  // The style language, canonicalized (MapLangAttributeInto, nsGenericHTMLElement.cpp:1337-1375).
  lang: string
  // The node is stored 8-bit: every code unit is below U+0100 (CharacterDataBuffer.cpp:285-288, gap string-storage).
  is8bit: boolean
  // Resolved in au (nsTextFrame.cpp:1949-1980).
  letterSpacingAu: number
  wordSpacingAu: number
}

// The leaf holding source offset s: the last one that starts at or before it, which an empty leaf never is for a character.
export function leafOfSource(leaves: GeckoLeaf[], s: number): number {
  let lo = 0
  let hi = leaves.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (leaves[mid]!.start <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

// A text frame: one text node, or the piece of it bidi resolution split off as a non-fluid continuation
// (nsBidiPresUtils.cpp:1039-1057). Line breaking later makes fluid continuations, which are line state, not frames.
export type GeckoFrame = {
  run: number
  // Source offsets [start, end).
  start: number
  end: number
  level: number
  textRun: number
  // The frame's transformed range [tStart, tEnd).
  tStart: number
  tEnd: number
  // Index of this frame's item in GeckoPrepared.items: with frameOfSource, what makes a line start from a source offset.
  item: number
}

// The frame holding source offset s: the last one that starts at or before it.
export function frameOfSource(frames: GeckoFrame[], s: number): number {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid]!.start <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

// A span's inline box edges in au as Gecko computes them: margins and padding through StyleCSSPixelLength::ToAppUnits
// (NSToIntRound(px × 60), ServoStyleConstsInlines.h:584-595), border widths snapped down to whole device pixels but at
// least one (snap_as_border_width, servo/components/style/values/specified/border.rs:235-246).
export type GeckoSpanEdges = {
  startMargin: number
  // Border plus padding on each side (ComputedLogicalBorderPadding, nsInlineFrame.cpp:500-521).
  startBorderPadding: number
  endBorderPadding: number
  endMargin: number
}

export type GeckoSpan = {
  // `open` and `close`: the element's own start and end items; `closes`: every close item of its continuations in order,
  // the bidi splits' and then `close`.
  kind: 'span'; parent: number; open: number; close: number; closes: number[]; style: GeckoStyle; edges: GeckoSpanEdges
  // PreventCrossBoundaryShaping's test on each logical side: a nonzero margin, border or padding, or a vertical-align
  // other than baseline (nsTextFrame.cpp:2054-2098).
  breaksShapingAtStart: boolean
  breaksShapingAtEnd: boolean
  // nsInlineFrame::IsSelfEmpty: no border, padding or margin on either inline side (nsInlineFrame.cpp:87-154).
  selfEmpty: boolean
}

// An inline-block of declared border box: its inline size and margins in au. `level` is the embedding level of the
// character bidi resolution stands it for: U+FFFC for an atomic inline, U+2028 for a <br>, U+200B for a <wbr>
// (TraverseFrames, nsBidiPresUtils.cpp:1381-1400; ResolveParagraph :975-982); 0 without bidi.
export type GeckoObject =
  | { kind: 'atomic'; parent: number; item: number; iSize: number; startMargin: number; endMargin: number; level: number }
  | { kind: 'br' | 'wbr'; parent: number; item: number; level: number }

// The paragraph's elements by the model's element index, which items and fragments name.
export type GeckoElement = GeckoSpan | GeckoObject

// The element an item names, by the item's kind: an open or a close item names a span, the others an object.
export function spanAt(elements: GeckoElement[], e: number): GeckoSpan {
  const el = elements[e]!
  if (el.kind !== 'span') throw new Error(`gecko: element ${e} is a ${el.kind}, not a span`)
  return el
}

export function objectAt(elements: GeckoElement[], e: number): GeckoObject {
  const el = elements[e]!
  if (el.kind === 'span') throw new Error(`gecko: element ${e} is a span`)
  return el
}

// The frames and element events of the paragraph in document order: what nsBlockFrame and nsInlineFrame reflow. `at` is the
// source offset where the item sits: a text frame's start, the offset of the content after an element event.
// `split`: where bidi resolution splits the span into another continuation at a level change (SplitInlineAncestors,
// nsBidiPresUtils.cpp:612-660), not the element's own start or end.
export type GeckoEdgeItem = { kind: 'open' | 'close'; element: number; at: number; split: boolean }
export type GeckoObjectItem = { kind: 'atomic' | 'br' | 'wbr'; element: number; at: number }
export type GeckoItem = { kind: 'text'; frame: number; at: number } | GeckoEdgeItem | GeckoObjectItem

// A script run gfxFontGroup::InitTextRun shapes (gfxScriptItemizer.cpp:60-243): it ends before `limit`, a transformed
// index. 'Zyyy' stands for Common resolved from the language.
export type ScriptRun = { limit: number; script: string }

// A gfxTextRun: the transformed characters of consecutive frames that ContinueTextRunAcrossFrames joins
// (nsTextFrame.cpp:2015-2174). [tStart, tEnd) index the paragraph's transformed arrays.
export type GeckoTextRun = {
  tStart: number
  tEnd: number
  level: number
  // Measure context: the first flow's font and language, ligatures off when its letter spacing isn't 0 au. The contexts a
  // recipe needs beside it are made from its settings (advance.ts, gaps.ts).
  context: Context
  // The first flow's font declaration, for its facts: about the listed families (advance.ts, ligature rows), which glyph of
  // a pair carries HarfBuzz's pair adjustment (FontFacts.pairKerning, advance.ts pairKerningAt), and whether HarfBuzz shapes
  // the font through GSUB and GPOS or through morx, kerx and kern state machines, where marks keep their advances
  // (FontFacts.joining, advance.ts, ligature groups).
  font: FontDecl
  // The run's script runs, which decide the script context a measured piece of a unit needs (measure.ts rangeAu).
  scriptRuns: ScriptRun[]
  // TEXT_ENABLE_HYPHEN_BREAKS from a removed soft hyphen (nsTextFrame.cpp:2584-2586).
  hasShy: boolean
  // Flags::HasTrailingBreak (nsTextFrame.cpp:1835-1848): the line breaker ended on a break opportunity when this run was
  // flushed with line breaks, at a frame text can't cross other than <br> or at the block's end.
  trailingBreak: boolean
  // 0.5 × NS_round(ZeroOrAveCharWidth × apd) (nsTextFrame.cpp:1931-1937); measured only for runs with tabs.
  minTabAdvance: number
  // The hyphen text run's advance, U+2010 or '-' in the first font (gfxTextRun.cpp:2458-2488); 0 without soft hyphens.
  hyphenAu: number
  hasTab: boolean
  // Glyph advance of the whole run.
  totalAdvance: number
  // The condition under which every Canvas width of the run is a stand-in, or null (GeckoTextFrame.advancesStandIn).
  advancesStandIn: 'font-size-quantization' | 'optical-size' | null
}

// A shaping unit (gfxFont::SplitAndInitTextRun, gfxFont.cpp:3708-3900): a word between boundary spaces and invalid
// characters, a boundary U+0020 or U+00A0, or an invalid character (zero width).
export type GeckoUnit = {
  kind: 'word' | 'space' | 'nbsp' | 'invalid'
  tStart: number
  tEnd: number
  // measureText of the unit in its text run's context and its DOM script (rangeAu), in the context's au.
  canvasAu: number
  // The DOM advance: canvasAu, plus on an OffscreenCanvas the color emoji, synthesized space and synthetic bold corrections
  // at the page's apd (specs/gecko-canvas.md §2 A12).
  au: number
  // Glyph advance of the text run before this unit.
  startAdvance: number
  // What measuring found inside the unit (advance.ts): null until an offset inside it asks, so for ever in a unit of one
  // character. The one part of a prepared paragraph that is written after preparation: a fill, a line's placement or its
  // inspection fills it where it reads, at whatever width, so an offset is measured once. It holds facts of the unit's text in
  // its text run, which no width and no line changes, and it goes with the paragraph.
  inWord: InWord | null
}

export type InWord = {
  // The ligature groups Canvas counts in the unit, beside its clusters (advance.ts groupAcross); null until an offset asks.
  groups: { counted: number; clusters: number } | null
  // Per code unit of the unit: what measuring found about the offset before it, null until something asks. A line consults
  // an offset several times (the scan, the measured edges, the redo, its placement and its inspection), and the next line
  // and another width consult it again.
  offsets: (InWordEntry | null)[]
}

// What measuring found about one offset inside a shaping unit, each part null until something asks for it.
export type InWordEntry = {
  // Whether Canvas shows an optional ligature over this cluster boundary (ligatureAcross), and whether it shows a group that
  // required shaping forms (groupAcross), which a boundary under an optional ligature is asked only by its row (rowAround).
  ligature: boolean | null
  group: boolean | null
  // The row of ligature candidates that starts here (rowAround).
  row: LigatureRow | null
  // The advance before the offset (advanceBefore).
  advance: InWordAdvance | null
  // W(suffix): the unit from this offset on, measured with nothing put before it (suffixAlone).
  suffixAu: number | null
}

// A row of ligature candidates: `edges` are the ends of its ligature groups, the row's own two included (advance.ts rowAround).
export type LigatureRow = { edges: number[]; unconfirmed: boolean }

// The glyph advance before an offset, and why it is a stand-in where Canvas can't confirm it (advance.ts advanceBefore).
export type InWordAdvance = { au: number; standIn: InWordReason | null }

// Why Canvas can't confirm the advance before an in-word offset, with the numbers the gap's prose prints (gaps.ts
// inWordDetail). `at` is the source offset.
export type InWordReason =
  | { kind: 'inside-cluster'; at: number; betweenMarks: boolean }
  | { kind: 'mark-starts-cluster'; at: number }
  | { kind: 'unit-starts-inside-cluster'; at: number }
  | { kind: 'group-mark-advances'; at: number }
  // Several ligature candidates in a row, which the facts don't settle (rowAround): the offset is inside the row, which
  // stands in as one group, or it ends a part of one.
  | { kind: 'inside-ligature-row'; at: number }
  | { kind: 'between-ligatures'; at: number }
  | { kind: 'group-ends'; at: number; end: InWordReason }
  // The two sides don't add up to the unit. `sides` is how they were measured (inWordAdvance), `au` their sum, or what the
  // cluster before the offset and the suffix gain from each other.
  | { kind: 'sides'; at: number; sides: 'joined' | 'apart' | 'cluster'; au: number; unitAu: number }

// gfxBreakPriority (gfxTypes.h:48).
export const NO_BREAK = 0
export const WORD_WRAP_BREAK = 1
export const NORMAL_BREAK = 2

// Character kinds a text run records (gfxFont.cpp:3872-3897).
export const KIND_GLYPH = 0
export const KIND_TAB = 1
export const KIND_NEWLINE = 2
export const KIND_FORMAT = 3
export const KIND_INVISIBLE = 4

export type GeckoPrepared = {
  paragraph: Paragraph
  env: GeckoEnvironment
  // max(1, round(60 / devicePixelRatio)) (specs/gecko-lines.md §2.1).
  appUnitsPerDevPixel: number
  // The block's own style (the line container's), which the root span and tab widths read.
  blockStyle: GeckoStyle
  text: string
  leaves: GeckoLeaf[]
  // Frames in logical order; leaves without a frame (white space at a line boundary) have none.
  frames: GeckoFrame[]
  items: GeckoItem[]
  elements: GeckoElement[]
  textRuns: GeckoTextRun[]
  // Per transformed code unit.
  tUnits: Uint16Array
  tSource: Int32Array
  breakFlags: Uint8Array
  clusterStart: Uint8Array
  isSpace: Uint8Array
  kind: Uint8Array
  // spacingPrefix[t]: letter and word spacing after the characters before t, in au (nsTextFrame.cpp:4089-4295).
  spacingPrefix: Int32Array
  // The same as the break scan gets it: without the letter spacing a cursive cluster takes only where spacing is asked for
  // one glyph run at a time (prepare.ts step 6; gfxTextRun.cpp:946-958, :1011-1018).
  scanSpacingPrefix: Int32Array
  // correctionPrefix[t]: color emoji and synthesized space corrections of the clusters before t, in au.
  correctionPrefix: Int32Array
  unitOf: Int32Array
  units: GeckoUnit[]
  // Per source offset: the transformed index of that character, or -1 when TransformText skipped it.
  sourceT: Int32Array
  // Per source offset (length + 1): the first transformed index at or after it (gfxSkipCharsIterator).
  nextT: Int32Array
  // What tab widths read, null in a paragraph without a tab.
  // - `unit`: what ComputeTabWidthAppUnits (nsTextFrame.cpp:3875-3906) multiplies a text frame's tab-size by: the containing
  //   block's space plus its letter and word spacing, au.
  // - `spacingPrefix`: spacingPrefix as CalcTabWidths gets it, one character at a time, so each character is its own base
  //   (prepare.ts step 6; nsTextFrame.cpp:4345-4347).
  tabs: { unit: number; spacingPrefix: Int32Array } | null
  // pxToAu of the block's text-indent (nsLineLayout.cpp:178-201).
  textIndentAu: number
  // The paragraph resolved bidi, so lines are reordered by frame levels (nsLineLayout.cpp:3646-3652): the port's stand-in
  // for the document's BidiEnabled flag (gecko audit F3).
  bidi: boolean
  // The paragraph's Canvas contexts, one per distinct settings (measure/canvas.ts contextFor): the text runs' own, and
  // those the recipes make from them.
  contexts: Context[]
  // What an inspected paragraph keeps for inspectLine and paragraphGaps; null on a plain one, which computes no gap and asks
  // Canvas nothing that only a gap or an inspected value needs (gaps.ts). Nothing else says which of the two a paragraph is.
  inspect: GeckoInspect | null
}

export type GeckoInspect = {
  // The gaps of the paragraph's content, fonts and environment. Line filling never writes here; gaps its breaks decide go
  // on the line (DESIGN.md §2.8).
  gaps: Gap[]
  // Transformed indices of the emergency breaks after a hyphen that the coverage facts couldn't confirm, in text order:
  // whether the letters around the hyphen are one font's isn't known (prepare.ts step 4). Only the line's font-fallback
  // gap reads it, once for a line that such a break decides.
  emergencyUnconfirmed: number[]
}
