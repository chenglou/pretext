// Blink (Chrome 153.0.8010.48). prepare builds text_content, items, bidi levels, script runs and shaping groups from the
// inline tree and measures the groups; fillLine runs LineBreaker::NextLine for one line in one layout opportunity and keeps
// its item results as the decided line. What LogicalLineBuilder and InlineLayoutAlgorithm make of them is read from the
// decided line on request: the fragments in logical order (pieces.ts), and on an inspected paragraph the fragment items in
// visual order at their LayoutUnit positions, with glyph clusters and the offset mapping (inspect.ts, DESIGN.md §2.3), and
// the gaps (gaps.ts). The exports are the function set index.ts dispatches to (DESIGN.md §2.9).
import { indexContent } from '../../content.js'
import type { BlinkEnvironment } from '../../env.js'
import type { Context } from '../../measure/canvas.js'
import type { FillResultOf, Gap, LineInspectionOf, LinePieces, LineSlot, Paragraph } from '../../model.js'
import { graphemeBoundaries } from '../../unicode/grapheme.js'
import { breaksShapingAfter, breaksShapingBefore, buildContent, lengthLU, sameFont, segmentBidiRuns, stylesOf, wrapsLines } from './content.js'
import { blinkGraphemeRules } from './data.js'
import { styleContexts } from './contexts.js'
import { emojiPriorities, isSegmentEdge } from './emoji.js'
import { canonicalGaps, lineGaps, preparedContent, type GapSink } from './gaps.js'
import type { BlinkLineGeometry, BlinkLineStart } from './geometry.js'
import { hanKerningCandidates, hanKerningMayApply, measureHanKerningFontData } from './hankerning.js'
import { geometryOf } from './inspect.js'
import { fontFactsOfText } from './ligatures.js'
import { LineBreaker, type LineInfo } from './line-breaker.js'
import { lineSourceRange, piecesOf, type BlinkPaintFacts } from './pieces.js'
import { USCRIPT_LATIN, isExtendedPictographic, isMark } from './props.js'
import { scriptsPerUnit } from './script.js'
import { measureGroups, type Shaper } from './shape.js'
import type { BlinkGroup, BlinkPrepared, BlinkStyle } from './types.js'

export { paragraphGaps } from './gaps.js'
export type { BlinkPaintFacts } from './pieces.js'

// InlineNode::ShapeText's grouping (inline_node.cc:1625-1680): equal Font, equal direction, no control item or atomic
// inline between, no ZWNJ at an item start, and no open or close tag whose box edges or vertical-align break shaping
// (ShouldBreakShapingBeforeBox, ShouldBreakShapingAfterBox, :494-527). EqualsRunSegment compares segment data that items
// only get in a paragraph with one segment (inline_item.cc:187-196, inline_node.cc:1256-1290), so it never splits a group
// here; each segment is its own HarfBuzz call inside the group (harfbuzz_shaper.cc:1080-1101), which Canvas repeats for the
// strings it measures.
function shapingGroups(p: BlinkPrepared): void {
  const items = p.items
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
        if (breaksShapingBefore(p.styles[it.style]!)) break
        continue
      }
      if (it.type === 'close-tag') {
        if (breaksShapingAfter(p.styles[it.style]!)) break
        continue
      }
      if (it.start === it.end) continue
      if (!sameFont(p.styles[it.style]!, p.styles[s.style]!)) break
      if ((it.bidiLevel & 1) !== (s.bidiLevel & 1)) break
      if (p.text.charCodeAt(it.start) === 0x200c) break
      end = it.end
      last = j
    }
    const group: BlinkGroup = {
      start: s.start, end, style: s.style, rtl: (s.bidiLevel & 1) === 1, cuts: [], prefixAtCut: [], startTrim16: 0, endTrim16: 0,
      prefix16: new Float64Array(end - s.start).fill(NaN), safe: new Uint8Array(end - s.start),
    }
    p.groupOfUnit.fill(p.groups.length, group.start, group.end)
    p.groups.push(group)
    index = last
  }
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
export function prepare(paragraph: Paragraph, env: BlinkEnvironment, inspect: boolean): BlinkPrepared {
  const canvases: Context[] = []
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
  const scripts = segmented ? scriptsPerUnit(text) : new Uint8Array(text.length).fill(USCRIPT_LATIN)
  const priorities = segmented ? emojiPriorities(text) : new Uint8Array(text.length)
  const contentOffsets = new Int32Array(index.text.length).fill(-1)
  for (let t = 0; t < text.length; t++) if (content.sourceOffsets[t]! >= 0) contentOffsets[content.sourceOffsets[t]!] = t
  const graphemeStarts = new Uint8Array(text.length + 1)
  if (is8Bit) {
    for (let i = 0; i <= text.length; i++) if (!(i > 0 && text.charCodeAt(i - 1) === 0x0d && text.charCodeAt(i) === 0x0a)) graphemeStarts[i] = 1
  } else {
    const boundaries = graphemeBoundaries(text, blinkGraphemeRules)
    for (let i = 0; i < boundaries.length; i++) graphemeStarts[boundaries[i]!] = 1
  }
  const styles: BlinkStyle[] = []
  for (let s = 0; s < computed.styles.length; s++) {
    const style = computed.styles[s]!
    styles.push({ ...style, contexts: styleContexts(canvases, style, zoom, segmented ? '16bit' : '8bit'), oneByteContexts: null, canvasSplitsWords: null, hanKerning: null })
  }
  const rtl = paragraph.direction === 'rtl'
  // Where the gaps of preparation go: the ones its measuring raises, then the content's (gaps.ts).
  const gaps: GapSink = inspect ? [] : null
  const p: BlinkPrepared = {
    paragraph, env, index, layoutZoom: zoom, text, is8Bit, segmented, scripts, priorities, sourceOffsets: content.sourceOffsets, contentOffsets,
    items: bidi.items, styles, groups: [], bidiEnabled: bidi.enabled,
    baseLevel: rtl ? 1 : 0, graphemeStarts, hanKerningCandidates: hanKerningCandidates(text),
    continuations: new Uint8Array(text.length),
    ligature: new Uint8Array(text.length + 1),
    fontRun: new Int16Array(text.length).fill(-1),
    groupOfUnit: new Int32Array(text.length).fill(-1),
    canvases, inspect: gaps === null ? null : { gaps },
  }
  const sh: Shaper = { p, gaps }
  shapingGroups(p)
  markContinuations(p)
  fontFactsOfText(p)
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    if (hanKerningMayApply(p.hanKerningCandidates, group.start, group.end)) measureHanKerningFontData(p, group.style)
  }
  measureGroups(sh)
  preparedContent(p)
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

// Where the line breaks is known from the item results alone: the source range comes from the two line starts, and no
// fragment or item is made here.
export function fillLine(p: BlinkPrepared, start: BlinkLineStart, slot: LineSlot): BlinkFillResult {
  const gaps: GapSink = p.inspect === null ? null : []
  const info = new LineBreaker({ p, gaps }, start, slot).nextLine()
  // A line that overflows a layout opportunity narrower than the container, in a block that wraps, moves to the next
  // opportunity (inline_layout_algorithm.cc:1341-1367), which lays the same line out again.
  if (info.hasOverflow && info.availableWidth !== lengthLU(slot.width, p.layoutZoom) && wrapsLines(p.paragraph.whiteSpace)) {
    return { kind: 'below-floats', line: { engine: 'blink', kind: 'below-floats', info, start, gaps }, next: start }
  }
  const range = lineSourceRange(p, start, info.token)
  return { kind: 'line', line: { engine: 'blink', kind: 'line', info, start, gaps }, start: range.start, end: range.end, next: info.token, hasLineBox: info.shouldCreateLineBox }
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
      return { geometry, gaps: canonicalGaps(gaps) }
    }
    case 'below-floats': return { geometry: null, gaps: canonicalGaps(gaps) }
  }
}
