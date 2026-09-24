import { OffsetRuns } from './offset-runs.js'
// Blink (Chrome 153.0.8010.48). prepare builds text_content, items, bidi levels, script runs and shaping groups from the
// inline tree and measures the groups; fillLine runs LineBreaker::NextLine for one line in one layout opportunity and keeps
// its item results as the decided line. What LogicalLineBuilder and InlineLayoutAlgorithm make of them is read from the
// decided line on request: the fragments in logical order (pieces.ts), and on an inspected paragraph the fragment items in
// visual order at their LayoutUnit positions, with glyph clusters and the offset mapping (inspect.ts, DESIGN.md §2.3), and
// the gaps (gaps.ts). The exports are the function set index.ts dispatches to (DESIGN.md §2.9).
import { indexContent } from '../../content.js'
import type { BlinkEnvironment } from '../../env.js'
import type { ContextPool } from '../../measure/canvas.js'
import type { FillResultOf, Gap, LineInspectionOf, LinePieces, LineSlot, Paragraph, RangeFillResultOf } from '../../model.js'
import { graphemeBoundaries } from '../../unicode/grapheme.js'
import { breaksShapingAfter, breaksShapingBefore, buildContent, lengthLU, sameFont, segmentBidiRuns, stylesOf, wrapsLines } from './content.js'
import { blinkGraphemeRules } from './data.js'
import { styleContexts } from './contexts.js'
import { emojiPriorities, isSegmentEdge, ShapingSegments } from './emoji.js'
import { GapAccumulator } from './gap-accumulator.js'
import { canonicalGaps, lineGaps, preparedContent, type GapSink } from './gaps.js'
import type { BlinkLineGeometry, BlinkLineStart } from './geometry.js'
import { hanKerningCandidates, hanKerningMayApply, measureHanKerningFontData } from './hankerning.js'
import { geometryOf } from './inspect.js'
import { fontFactsOfText } from './ligatures.js'
import { LineBreaker, type LineInfo } from './line-breaker.js'
import { lineSourceRange, piecesOf, type BlinkPaintFacts } from './pieces.js'
import { isExtendedPictographic, isMark } from './props.js'
import { scriptsPerUnit } from './script.js'
import { isClusterBoundary, measureGroups, type Shaper } from './shape.js'
import type { BlinkGroup, BlinkPrepared, BlinkStyle, InlineItem } from './types.js'

export { paragraphGaps } from './gaps.js'
export type { BlinkPaintFacts } from './pieces.js'

// InlineNode::ShapeText's grouping (inline_node.cc:1625-1680): equal Font, equal direction, no control item or atomic
// inline between, no ZWNJ at an item start, and no open or close tag whose box edges or vertical-align break shaping
// (ShouldBreakShapingBeforeBox, ShouldBreakShapingAfterBox, :494-527). EqualsRunSegment compares segment data that items
// only get in a paragraph with one segment (inline_item.cc:187-196, inline_node.cc:1256-1290), so it never splits a group
// here; each segment is its own HarfBuzz call inside the group (harfbuzz_shaper.cc:1080-1101), which Canvas repeats for the
// strings it measures.
function shapingGroups(items: readonly InlineItem[], styles: readonly BlinkStyle[], text: string, groupOfUnit: Int32Array): BlinkGroup[] {
  const groups: BlinkGroup[] = []
  for (let index = 0; index < items.length; index++) {
    const s = items[index]!
    if (s.type !== 'text' || s.start === s.end) continue
    let end = s.end
    // The group's last text item.
    let last = index
    for (let j = index + 1; j < items.length; j++) {
      const it = items[j]!
      if (it.type === 'control' || it.type === 'atomic') break
      if (it.type === 'open-tag') {
        if (breaksShapingBefore(styles[it.style]!)) break
        continue
      }
      if (it.type === 'close-tag') {
        if (breaksShapingAfter(styles[it.style]!)) break
        continue
      }
      if (it.start === it.end) continue
      if (!sameFont(styles[it.style]!, styles[s.style]!)) break
      if ((it.bidiLevel & 1) !== (s.bidiLevel & 1)) break
      if (text.charCodeAt(it.start) === 0x200c) break
      end = it.end
      last = j
    }
    const length = end - s.start
    const group: BlinkGroup = {
      start: s.start, end, style: s.style, rtl: (s.bidiLevel & 1) === 1, cuts: [], prefixAtCut: [], startTrim16: 0, endTrim16: 0,
      prefix16: new Float64Array(length).fill(NaN), pair16: new Float64Array(length).fill(NaN), wide16: new Float64Array(length).fill(NaN), words: false,
    }
    groupOfUnit.fill(groups.length, group.start, group.end)
    groups.push(group)
    index = last
  }
  return groups
}

// HarfBuzz's continuation flags per shaping call's buffer, from the call's start (hb_set_unicode_props,
// hb-ot-shape.cc:470-546 at harfbuzz dfdc088c): marks (hb-ot-layout.hh:247), emoji modifiers, the second of a regional indicator pair, ZWJ
// and the Extended_Pictographic character after it, halfwidth voiced sound marks and tag characters. hb_form_clusters
// merges each continuation into the glyph cluster before it (:578-586).
function markContinuations(p: BlinkPrepared): void {
  const text = p.text
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    let previousRegionalBase = false
    for (let i = group.start; i < group.end;) {
      const cp = text.codePointAt(i)!
      const size = cp > 0xffff ? 2 : 1
      if (size === 2) p.continuations[i + 1] = 1
      let continuation = false
      let regional = false
      let next = i + size
      if (cp >= 0x80) {
        if (isMark(cp)) continuation = true
        else if (cp >= 0x1f3fb && cp <= 0x1f3ff) continuation = true
        else if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
          continuation = i > group.start && previousRegionalBase
          regional = !continuation
        } else if (cp === 0x200d) {
          continuation = true
          if (next < group.end && isExtendedPictographic(text.codePointAt(next)!) && !isSegmentEdge(p, next)) {
            const nextSize = text.codePointAt(next)! > 0xffff ? 2 : 1
            for (let u = next; u < next + nextSize; u++) p.continuations[u] = 1
            next += nextSize
          }
        } else if ((cp >= 0xff9e && cp <= 0xff9f) || (cp >= 0xe0020 && cp <= 0xe007f)) {
          continuation = true
        }
      }
      // A continuation merges into a cluster of its own shaping call; a segment starts another one (emoji.ts).
      if (continuation && !isSegmentEdge(p, i)) p.continuations[i] = 1
      previousRegionalBase = regional
      i = next
    }
  }
}

// `inspect` prepares the paragraph for inspectLine and paragraphGaps; a plain paragraph gives lines and pieces alone
// (types.ts BlinkPrepared.inspect).
export function prepare(paragraph: Paragraph, env: BlinkEnvironment, inspect: boolean, canvases: ContextPool): BlinkPrepared {
  const zoom = env.devicePixelRatio
  const index = indexContent(paragraph)
  const computed = stylesOf(paragraph, index, zoom)
  const content = buildContent(index, computed.styles, computed.styleOfLeaf, computed.styleOfElement)
  const bidi = segmentBidiRuns(paragraph, content)
  const text = content.text
  let is8Bit = true
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) { is8Bit = false; break }
  // SegmentScriptRuns (inline_node.cc:1256-1290): one Latin segment unless 16-bit text with a character other than
  // U+FFFC, or bidi.
  const segmented = !((is8Bit || !content.hasNonOrc16Bit) && !bidi.enabled)
  const contentOffsets = new Int32Array(index.text.length).fill(-1)
  // Build the source-to-content map and fixed generated extents in one ascending content pass.
  const sourceRuns = new OffsetRuns(text.length, k => {
    const source = content.sourceOffsets[k]!
    if (source >= 0) contentOffsets[source] = k
    return source < 0
  })
  const graphemeStarts = new Uint8Array(text.length + 1)
  if (is8Bit) {
    for (let i = 0; i <= text.length; i++) if (!(i > 0 && text.charCodeAt(i - 1) === 0x0d && text.charCodeAt(i) === 0x0a)) graphemeStarts[i] = 1
  } else {
    const boundaries = graphemeBoundaries(text, blinkGraphemeRules)
    for (let i = 0; i < boundaries.length; i++) graphemeStarts[boundaries[i]!] = 1
  }
  const styles: BlinkStyle[] = []
  const fragmentAncestors = inspect ? new Int32Array(computed.styles.length) : null
  for (let s = 0; s < computed.styles.length; s++) {
    const style = computed.styles[s]!
    if (fragmentAncestors !== null && s > 0) fragmentAncestors[s] = style.shouldCreateBoxFragment ? s : fragmentAncestors[style.parent]!
    styles.push({ ...style, contexts: styleContexts(canvases, style, zoom, segmented ? '16bit' : '8bit'), oneByteContexts: null, canvasSplitsWords: null, spaceTakesScript: null, hanKerning: null })
  }
  const rtl = paragraph.direction === 'rtl'
  // Where the gaps of preparation go: the ones its measuring raises, then the content's (gaps.ts).
  const gaps: GapSink = inspect ? new GapAccumulator(index.text.length) : null
  let canvasText: BlinkPrepared['canvasText'] = null
  if (!inspect && is8Bit && !segmented && !text.includes('\u00ad') && styles.some(style => style.letterSpacing === 0)) {
    const narrow = text.replace(/[\v\f]/g, '\u0001')
    canvasText = { narrow, spaced: narrow.replaceAll(' ', '\u2028') }
  }
  const groupOfUnit = new Int32Array(text.length).fill(-1)
  const groups = shapingGroups(bidi.items, styles, text, groupOfUnit)
  const segments = segmented ? new ShapingSegments(text, scriptsPerUnit(text), emojiPriorities(text), groups, groupOfUnit) : null
  const p: BlinkPrepared = {
    clusterRuns: null, paragraph, env, index, layoutZoom: zoom, text, canvasText, is8Bit, segments, sourceOffsets: content.sourceOffsets, sourceRuns, contentOffsets,
    items: bidi.items, styles, groups, bidiEnabled: bidi.enabled,
    baseLevel: rtl ? 1 : 0, graphemeStarts, hanKerningCandidates: hanKerningCandidates(text),
    continuations: new Uint8Array(text.length),
    ligature: new Uint8Array(text.length + 1),
    fontRun: new Int16Array(text.length).fill(-1),
    groupOfUnit,
    canvases, inspect: gaps === null ? null : { gaps: [], paragraphIndex: null, graphemeRuns: null, collapsedSourceRuns: new OffsetRuns(contentOffsets.length, k => contentOffsets[k]! < 0), fragmentAncestors: fragmentAncestors!, searched: [] },
  }
  const sh: Shaper = { p, gaps }
  markContinuations(p)
  fontFactsOfText(p)
  p.clusterRuns = new OffsetRuns(text.length + 1, k => !isClusterBoundary(p, k))
  if (p.inspect !== null) {
    p.inspect.graphemeRuns = new OffsetRuns(text.length + 1, k => p.graphemeStarts[k] !== 1)
  }
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    if (hanKerningMayApply(p.hanKerningCandidates, group.start, group.end)) measureHanKerningFontData(p, group.style)
  }
  measureGroups(sh)
  preparedContent(p, gaps)
  return p
}

// A paragraph without inline items lays out no line; every other paragraph makes at least one line, with or without a
// line box (line_breaker.cc:945-975).
export function firstLine(p: BlinkPrepared): BlinkLineStart | null {
  if (p.items.length === 0) return null
  return { engine: 'blink', itemIndex: 0, textOffset: 0, style: 0, afterForcedBreak: false, isPastFirstFormattedLine: false, afterLeadingFloats: false }
}

// The decided line: what LineBreaker::NextLine made of one layout opportunity from `start`, its item results with their
// views and what the port noted beside them (line-breaker.ts LineInfo), and on an inspected paragraph the gaps its filling
// raised, in order, across every pass of the fill; null on a plain one. linePieces and inspectLine read it and nothing
// writes to it. A refused slot keeps the same record: the gaps its refusal rests on are read from the line that overflowed.
type Decided = { engine: 'blink'; info: LineInfo; start: BlinkLineStart; gaps: Gap[] | null }
export type BlinkFilledLine = Decided & { kind: 'line' }
export type BlinkRefusedSlot = Decided & { kind: 'below-floats' }
export type BlinkFillResult = FillResultOf<BlinkLineStart, BlinkFilledLine, BlinkRefusedSlot>
export type BlinkRangeFillResult = RangeFillResultOf<BlinkLineStart>

// Where the line breaks is known from the item results alone: the source range comes from the two line starts, and no
// fragment or item is made here.
export function fillLine(p: BlinkPrepared, start: BlinkLineStart, slot: LineSlot): BlinkFillResult {
  return fillLineDecision(p, start, slot, 'full')
}

export function fillLineRange(p: BlinkPrepared, start: BlinkLineStart, slot: LineSlot): BlinkRangeFillResult {
  return fillLineDecision(p, start, slot, 'range')
}

// Item results participate in rewinding/trimming in both outputs. A range does not retain the final line record.
function fillLineDecision(p: BlinkPrepared, start: BlinkLineStart, slot: LineSlot, output: 'full'): BlinkFillResult
function fillLineDecision(p: BlinkPrepared, start: BlinkLineStart, slot: LineSlot, output: 'range'): BlinkRangeFillResult
function fillLineDecision(p: BlinkPrepared, start: BlinkLineStart, slot: LineSlot, output: 'full' | 'range'): BlinkFillResult | BlinkRangeFillResult {
  const gaps: GapSink = p.inspect === null ? null : new GapAccumulator(p.index.text.length)
  const info = new LineBreaker({ p, gaps }, start, slot).nextLine()
  // A line that overflows a layout opportunity narrower than the container, in a block that wraps, moves to the next
  // opportunity (inline_layout_algorithm.cc:1341-1367), which lays the same line out again.
  if (info.hasOverflow && info.availableWidth !== lengthLU(slot.width, p.layoutZoom) && wrapsLines(p.paragraph.whiteSpace)) {
    if (output === 'range') return { kind: 'below-floats', next: start }
    return { kind: 'below-floats', line: { engine: 'blink', kind: 'below-floats', info, start, gaps: gaps?.snapshot() ?? null }, next: start }
  }
  const range = lineSourceRange(p, start, info.token)
  if (output === 'range') return { kind: 'line', start: range.start, end: range.end, next: info.token, hasLineBox: info.shouldCreateLineBox }
  return { kind: 'line', line: { engine: 'blink', kind: 'line', info, start, gaps: gaps?.snapshot() ?? null }, start: range.start, end: range.end, next: info.token, hasLineBox: info.shouldCreateLineBox }
}

export function linePieces(p: BlinkPrepared, line: BlinkFilledLine): LinePieces<BlinkPaintFacts> {
  return piecesOf(p, line.info, line.start)
}

// The gaps first, in the order they have been raised since the rows were first recorded: the filling's, the line edges',
// the item edges', then the ones measuring the geometry raises.
export function inspectLine(p: BlinkPrepared, line: BlinkFilledLine | BlinkRefusedSlot): LineInspectionOf<BlinkLineGeometry> {
  const gaps = lineGaps(p, line)
  switch (line.kind) {
    case 'line': {
      const geometry = geometryOf({ p, gaps }, line.info, line.start)
      return { geometry, gaps: canonicalGaps(gaps.snapshot()) }
    }
    case 'below-floats': return { geometry: null, gaps: canonicalGaps(gaps.snapshot()) }
  }
}
