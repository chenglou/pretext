// Gecko's line geometry (Firefox 156) and the state its next line starts from: what the lab's rows keep of a Gecko line, so
// these types are as frozen as the row (DESIGN.md §2.5, §2.7). Types only. Integer app units, 60 per CSS px
// (specs/gecko-lines.md §2).
import type { GapName } from '../../model.js'

// One source unit of a frame, from measuredStart on.
export type GeckoCharacter = {
  // TransformText removed it: collapsed white space, an unused soft hyphen, a bidi control (gfxSkipChars).
  skipped: boolean
  // The text run's IsClusterStart flag at the unit's transformed index (gfxFont.cpp:708-769); false when skipped.
  clusterStart: boolean
  // The unit begins a shaping unit: gfxFont::SplitAndInitTextRun shapes words between boundary spaces and invalid
  // characters on their own (gfxFont.cpp:3708-3900), and the text run's script runs apart (gfxTextRun.cpp:2779-2809), so
  // the glyph records before it don't depend on it. false when skipped.
  unitStart: boolean
  // What GetAdvanceWidth adds for the unit: its glyph advance or ligature share and the letter spacing, word spacing,
  // justification spacing and tab width after it (gfxTextRun.cpp:1214-1256, nsTextFrame.cpp:4089-4295).
  advance: number
  // The position before the unit is a stand-in: it lies inside a shaping unit, whose glyph records come from one shaping
  // of the whole unit, and Canvas couldn't confirm it (`in-word-prefix`; engines/gecko/lines.ts advanceBefore). The
  // advances on both sides of such a position are stand-ins; their sum isn't. false when skipped.
  standInBefore: boolean
}

// An nsTextFrame continuation placed on the line (nsTextFrame::ReflowText, nsTextFrame.cpp:10847-11532).
export type GeckoTextFrame = {
  kind: 'text'
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
  // The position after the last unit is a stand-in (GeckoCharacter.standInBefore): the frame ends inside a shaping unit.
  standInAtEnd: boolean
  // Every advance of the frame is a Canvas stand-in under this condition, or null: no Canvas font size gives the DOM's
  // (`font-size-quantization`), or an OffscreenCanvas can't take the DOM's optical size (`optical-size`).
  advancesStandIn: GapName | null
}

export type GeckoFrameGeometry =
  | GeckoTextFrame
  // An nsInlineFrame continuation: a span's border box on this line, x from the content box. It has its start edge only
  // without a previous continuation, and its end margin, border and padding only as the last one
  // (nsInlineFrame.cpp:505-522, nsLineLayout.cpp:1199-1228); its children follow it in the list.
  | { kind: 'inline'; element: number; x: number; width: number; hasStartEdge: boolean; hasEndEdge: boolean }
  // The frame of an atomic inline: its border box.
  | { kind: 'atomic'; element: number; level: number; x: number; width: number }
  // A BRFrame.
  | { kind: 'br'; element: number; x: number; width: number }
  // A WBRFrame: 0 × 0 at its place on the line (WBRFrame.cpp; nsIFrame::IsEmpty is false, nsIFrame.cpp:9380-9382).
  | { kind: 'wbr'; element: number; level: number; x: number; width: number }

export type GeckoLineGeometry = {
  // max(1, round(60 / devicePixelRatio)) (nsDeviceContext.cpp:52-63).
  appUnitsPerDevPixel: number
  // The float available space of the line's band: its physical left edge from the content box and its inline size,
  // BeginLineReflow's iStart and availISize (nsBlockFrame.cpp:5252-5273).
  lineLeft: number
  availableWidth: number
  // aFloatAvailableSpace.HasFloats(), nsLineLayout's mImpactedByFloats: the band is narrowed by floats, so a first frame
  // that doesn't fit breaks before and the line moves down (nsLineLayout.cpp:785, nsBlockFrame.cpp:5289-5299).
  impactedByFloats: boolean
  // mTextIndent added to the root span's position (nsLineLayout.cpp:178-201); 0 on lines it doesn't apply to.
  textIndent: number
  // The line box inline size psd->mICoord after TrimTrailingWhiteSpaceIn (nsLineLayout.cpp:2851-2985).
  width: number
  // GetHangFrom (nsLineLayout.cpp:3416-3450): trailing white space hanging past the available width; TextAlignLine moves
  // a wrapped line by it when it hangs against the line's direction (:3503-3512, 3594-3602).
  hang: number
  // The inline offset TextAlignLine added to the line's frames, au (nsLineLayout.cpp:3482-3670); 0 under start in LTR.
  alignOffset: number
  // In logical order; an inline frame comes before the frames of its children.
  frames: GeckoFrameGeometry[]
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
