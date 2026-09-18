// Gecko's prepared paragraph and line state (Firefox 156.0). The Gecko port owns this file.
import type { GeckoEnvironment } from '../../env.js'
import type { FontDecl, Gap, GeckoLineGeometry, Paragraph, TextStyle } from '../../model.js'
import type { LineOf, LineResultOf } from '../engine.js'

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
  // The node is stored 8-bit: every code unit is below U+0100 (CharacterDataBuffer.cpp:285-288, gap string-storage).
  is8bit: boolean
  // Index of this frame's item in GeckoPrepared.items.
  item: number
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

export type GeckoElement =
  | {
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
  | { kind: 'atomic'; parent: number; item: number; iSize: number; startMargin: number; endMargin: number; level: number }
  | { kind: 'br' | 'wbr'; parent: number; item: number; level: number }

// The frames and element events of the paragraph in document order: what nsBlockFrame and nsInlineFrame reflow. `at` is the
// source offset where the item sits: a text frame's start, the offset of the content after an element event.
export type GeckoItem =
  | { kind: 'text'; frame: number; at: number }
  // `split`: where bidi resolution splits the span into another continuation at a level change (SplitInlineAncestors,
  // nsBidiPresUtils.cpp:612-660), not the element's own start or end.
  | { kind: 'open' | 'close'; element: number; at: number; split: boolean }
  | { kind: 'atomic' | 'br' | 'wbr'; element: number; at: number }

// A script run gfxFontGroup::InitTextRun shapes (gfxScriptItemizer.cpp:60-243): it ends before `limit`, a transformed
// index. 'Zyyy' stands for Common resolved from the language.
export type ScriptRun = { limit: number; script: string }

// A gfxTextRun: the transformed characters of consecutive frames that ContinueTextRunAcrossFrames joins
// (nsTextFrame.cpp:2015-2174). [tStart, tEnd) index the paragraph's transformed arrays.
export type GeckoTextRun = {
  tStart: number
  tEnd: number
  is8bit: boolean
  level: number
  // Measure context: the first flow's font and language, ligatures off when its letter spacing isn't 0 au.
  context: number
  // The first flow's font declaration, for its facts about the listed families (lines.ts, ligature rows).
  font: FontDecl
  // The run's script runs, which decide the script context a measured piece of a unit needs (rangeAu in prepare.ts).
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
  // FontFacts.pairKerning of the run's font: which glyph of a pair carries HarfBuzz's pair adjustment.
  pairKerning: 'first-advance' | 'split' | null
  // ListedFontFacts.scriptLookups of the first listed family that gives a font, or null where it isn't known: the scripts
  // that select other lookups than Latin text, which pairKerning describes (lines.ts, pairKerningAt).
  scriptLookups: readonly (readonly string[])[] | null
  // FontFacts.joining of the run's font: whether HarfBuzz shapes it through GSUB and GPOS or through morx, kerx and kern
  // state machines, where marks keep their advances (lines.ts, ligature groups).
  joining: 'opentype' | 'aat' | null
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
}

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
  // Per text leaf: its start offset (length leaves + 1), its style, and the span holding it (-1 for the block).
  runStarts: number[]
  runStyles: GeckoStyle[]
  runParents: number[]
  // The style language of each leaf, canonicalized (MapLangAttributeInto, nsGenericHTMLElement.cpp:1337-1375).
  runLangs: string[]
  // Resolved per run in au (nsTextFrame.cpp:1949-1980).
  letterSpacingAu: number[]
  // Frames in logical order; runs without a frame (white space at a line boundary) have none.
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
  // The same as CalcTabWidths gets it, one character at a time, so each character is its own base (prepare.ts step 6;
  // nsTextFrame.cpp:4345-4347). Null in a paragraph without a tab.
  tabSpacingPrefix: Int32Array | null
  // correctionPrefix[t]: color emoji and synthesized space corrections of the clusters before t, in au.
  correctionPrefix: Int32Array
  unitOf: Int32Array
  units: GeckoUnit[]
  // Per source offset: the transformed index of that character, or -1 when TransformText skipped it.
  sourceT: Int32Array
  // Per source offset (length + 1): the first transformed index at or after it (gfxSkipCharsIterator).
  nextT: Int32Array
  // What ComputeTabWidthAppUnits (nsTextFrame.cpp:3875-3906) multiplies a text frame's tab-size by: the containing
  // block's space plus its letter and word spacing, au. 0 when nothing measured it.
  tabUnit: number
  // Transformed indices of the emergency breaks after a hyphen that the coverage facts couldn't confirm: whether the
  // letters around the hyphen are one font's isn't known (prepare.ts step 4).
  emergencyUnconfirmed: Set<number>
  // pxToAu of the block's text-indent (nsLineLayout.cpp:178-201).
  textIndentAu: number
  // The paragraph resolved bidi, so lines are reordered by frame levels (nsLineLayout.cpp:3646-3652): the port's stand-in
  // for the document's BidiEnabled flag (gecko audit F3).
  bidi: boolean
  // The gaps of the paragraph's content, fonts and environment. Line filling never writes here; gaps its breaks decide go
  // on the line (DESIGN.md §2.8).
  gaps: Gap[]
}

// Where the next line starts (DESIGN.md §2.7): the item the line's first frame comes from, the content offset inside a text
// frame (the item's `at` otherwise), and whether no earlier line of the block had content, so text-indent still applies:
// BlockReflowState::AdvanceToNextLine counts only lines whose line layout wasn't empty (BlockReflowState.h:251-257), and
// BeginLineReflow indents line number 0 (nsLineLayout.cpp:178-201). No measured remainder carries over; a line's single redo
// with a forced break happens inside nextLine (specs/gecko-lines.md §4.1, §4.7).
export type GeckoLineStart = {
  engine: 'gecko'
  frame: number
  contentOffset: number
  isFirstLine: boolean
}

// The line nextLine fills, and what it returns for a slot.
export type GeckoLine = LineOf<GeckoLineStart, GeckoLineGeometry>
export type GeckoLineResult = LineResultOf<GeckoLineStart, GeckoLineGeometry>
