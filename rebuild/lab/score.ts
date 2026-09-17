// Offline scorer: compares each row's native Range rects exactly with the rects lab/observe/<engine>.ts expects from the
// row's layout, and derives lineCount, breaks, widths and painter from those comparisons (DESIGN.md §9).
//   bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>]
//     [--native-compare=<other rows file>] [--native-rows=<rows file that observed natively>] [--sealed]
// Imported as a module it runs nothing. It exports the per-row score, the native line grouping and the comparison of two
// runs, so tools use the scorer's own rules instead of copying them.
import { closeSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs'
import type { Expected, ExpectedObservation, ExpectedRect, GapName } from '../src/model.ts'
import { describeGiven } from './languages.ts'
import type { BrowserKind, Case, EnginePrediction, LabRow, LinesPrediction, NativeObservation, PainterLine, Paragraph, Rect, RecordedLayout } from './types.ts'

// Part of every environment key, so rows scored by different scorers never meet in a baseline. Version 1 derived native
// lines and widths from visibility rules; version 2 grouped every rect into native lines by vertical centre; version 3
// placed code point rects by their own node's box (git history of this file, 2026-09-16 and 2026-09-17). Version 4 compares
// Element.getClientRects(), marks slot protocol rows and attributes failing lines to the gaps that concern them.
export const SCORER_VERSION = 4

export type Status = 'pass' | 'fail' | 'unobserved' | 'not-applicable'
// `reason` is a fixed category (counted in the summary); `detail` names offsets and values for this case.
export type Metric = { status: Status; reason?: string; detail?: string }
export type MetricName = 'lineCount' | 'breaks' | 'widths' | 'painter'
export const METRICS: MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']

const f32 = Math.fround

export function rowText(c: Case): string {
  let text = ''
  for (let r = 0; r < c.paragraph.runs.length; r++) text += c.paragraph.runs[r]!.text
  return text
}

// ---- Native lines ----

// Which native line each rect is on. Rects without positive height are placed on no line: Firefox reports them for a frame
// without height. The rest follow three rules:
//
// 1. A code point rect is on the line of the whole-node rect of its own node that reports the same box. A Range over part
//    of a text box reports a cut of the box's rect: Blink slices the fragment item's rect (LayoutText::
//    AbsoluteQuadsForRange, research/observe-blink.md §4.6), Gecko cuts the continuation frame's rect
//    (GetPartialTextRect, observe-gecko.md §2), so y and height equal the box's; WebKit reports a whole box's rect, or a
//    snapped selection rect whose y is the box's y truncated to a LayoutUnit (observe-webkit.md E3). Over the 2026-09-17
//    development rows every positive code point rect matched such a node rect (Chrome 245,005, Firefox 241,735,
//    webkit-host 241,219). A code point rect no node rect holds falls back to rule 3 and is counted (`byCentre`).
// 2. Rects of one node on one line share their top in Blink and WebKit: the node's boxes have one style, so one ascent on
//    the line's baseline. A node rect whose y equals the previous positive rect's y continues that rect's line; rects come
//    in line order (InlineCursor; InlineIterator::textBoxesFor, observe-webkit.md E1). Gecko sizes each text frame by the
//    fonts it uses, so there each node rect stands alone.
// 3. Observer assumption, across nodes: vertical metrics aren't ported (DESIGN.md §9), so the node lines of rule 2 group by
//    vertical centre. Centres on one line differ by less than half the paragraph's px line height, and centres on
//    different lines by half a line height or more; every inline box carries the line height and sits on its line's
//    baseline, so only font metrics move centres within a line (Safari rounds half-leading per line; Firefox sizes a text
//    frame by the fonts it uses).
//
// Element rects (Element.getClientRects() of spans, atomic inlines, <br> and <wbr>, recorded for cases with inline
// structure) group by centre with the rest, each rect on its own: a span's boxes can come from items of other layout
// objects (Blink's culled spans), and an atomic inline is top-aligned, so its centre sits above the text's by at most half a
// line height less half its own height (DESIGN.md §2.9, "The lab protocol": atomics are no taller than a line).
export type NativeLines = {
  count: number
  // Per code point, per node and per element, the native line of each rect in order, top to bottom from 0; -1 without
  // positive height.
  points: number[][]
  nodes: number[][]
  elements: number[][]
  unplaced: number
  // Code point rects placed by centre because no node rect of their node reports their box (rule 1's fallback).
  byCentre: number
}

function groupCentres(centres: number[], lineHeight: number): { lineOf: Int32Array; count: number } {
  const order: number[] = []
  for (let i = 0; i < centres.length; i++) order.push(i)
  order.sort((a, b) => centres[a]! - centres[b]!)
  const lineOf = new Int32Array(centres.length)
  let count = 0
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!
    if (k === 0 || centres[i]! - centres[order[k - 1]!]! >= lineHeight / 2) count++
    lineOf[i] = count - 1
  }
  return { lineOf, count }
}

function webkitBrowser(browser: BrowserKind): boolean {
  return browser === 'safari' || browser === 'webkit-host'
}

// Whether a code point rect reports the box of a whole-node rect (rule 1).
function reportsBox(browser: BrowserKind, point: Rect, node: Rect): boolean {
  if (webkitBrowser(browser)) return point.y === node.y || point.y === Math.trunc(f32(node.y * 64)) / 64
  return point.y === node.y && point.height === node.height
}

export function nativeLines(native: NativeObservation, paragraph: Pick<Paragraph, 'lineHeight' | 'runs'>, browser: BrowserKind): NativeLines {
  const centres: number[] = []
  const shareTops = browser !== 'firefox'
  // Per node, per rect: its centre index, or -1 without positive height.
  const nodeCentre: number[][] = []
  for (let r = 0; r < native.runRects.length; r++) {
    const rects = native.runRects[r]!
    const indices: number[] = []
    let previous = -1
    for (let k = 0; k < rects.length; k++) {
      const rect = rects[k]!
      if (!(rect.height > 0)) {
        indices.push(-1)
        continue
      }
      if (shareTops && previous >= 0 && rects[previous]!.y === rect.y) {
        indices.push(indices[previous]!)
      } else {
        centres.push(rect.y + rect.height / 2)
        indices.push(centres.length - 1)
      }
      previous = k
    }
    nodeCentre.push(indices)
  }
  // Code point rects: the centre index of the node rect reporting their box, or their own centre.
  const runEnds: number[] = []
  for (let r = 0, end = 0; r < paragraph.runs.length; r++) {
    end += paragraph.runs[r]!.text.length
    runEnds.push(end)
  }
  const pointCentre: number[][] = []
  let byCentre = 0
  let run = 0
  for (let i = 0; i < native.points.length; i++) {
    const point = native.points[i]!
    while (run < runEnds.length - 1 && point.offset >= runEnds[run]!) run++
    const nodes = native.runRects[run] ?? []
    const indices: number[] = []
    for (let k = 0; k < point.rects.length; k++) {
      const rect = point.rects[k]!
      if (!(rect.height > 0)) {
        indices.push(-1)
        continue
      }
      // The first node rect reporting the box. Several can: bidi continuations of one frame, or a node's boxes on one line.
      // They share their y, so they sit on one line.
      let index = -1
      for (let n = 0; n < nodes.length && index < 0; n++) {
        const centre = nodeCentre[run]![n]!
        if (centre >= 0 && reportsBox(browser, rect, nodes[n]!)) index = centre
      }
      if (index < 0) {
        centres.push(rect.y + rect.height / 2)
        index = centres.length - 1
        byCentre++
      }
      indices.push(index)
    }
    pointCentre.push(indices)
  }
  const elementCentre: number[][] = []
  const elementRects = native.elements ?? []
  for (let e = 0; e < elementRects.length; e++) {
    const indices: number[] = []
    for (let k = 0; k < elementRects[e]!.length; k++) {
      const rect = elementRects[e]![k]!
      if (!(rect.height > 0)) {
        indices.push(-1)
        continue
      }
      centres.push(rect.y + rect.height / 2)
      indices.push(centres.length - 1)
    }
    elementCentre.push(indices)
  }
  const { lineOf, count } = groupCentres(centres, paragraph.lineHeight)
  let unplaced = 0
  const place = (indices: number[][]): number[][] => indices.map(list => list.map(index => {
    if (index >= 0) return lineOf[index]!
    unplaced++
    return -1
  }))
  const points = place(pointCentre)
  const nodes = place(nodeCentre)
  const elements = place(elementCentre)
  return { count, points, nodes, elements, unplaced, byCentre }
}

// ---- Protocol rows ----

// The lab protocol for line slots (DESIGN.md §2.9): before its content the page builds, for every slot row r and every side
// that has a positive inset in some row, a `float: left; clear: left` or `float: right; clear: right` block of the row's
// inset and one line height, left before right (page.ts buildParagraph). The declared slots describe the page only when
// every float sits in its row on its side: its border box's top is r × lineHeight and its height lineHeight, a left float's
// left edge is the content box's left edge, and a right float's right edge is the content box's right edge, in the engine's
// units (Blink LayoutUnits of zoomed px, WebKit LayoutUnits, Gecko app units). A float that doesn't fit where CSS 2.1 §9.5.1
// would put it moves down instead: Gecko places a float after the first on the first line only when it fits beside the
// line's content, text-indent included (nsLineLayout::TryToPlaceFloat, nsLineLayout.cpp:1485-1492; FlowAndPlaceFloat,
// BlockReflowState.cpp:793-798), and WebKit refuses a float with clear that leaves the indented line no room
// (LineBuilder::tryPlacingFloatBox, haveEnoughSpaceForFloatWithClear, InlineLineBuilder.cpp:1317-1328, :1368-1380). Then the
// rows the library lays lines out in aren't the page's, and the row is a protocol row: every metric is unobserved, never a
// pass or a fail. Returns why, or null when the case has no slots or the floats match. The widths of the floats aren't
// checked: each engine converts the declared inset with its own arithmetic, which the library ports.
export function slotProtocol(c: Case, native: NativeObservation, browser: BrowserKind, devicePixelRatio: number): string | null {
  const slots = c.inline?.lineSlots ?? []
  if (slots.length === 0) return null
  const sides = (['left', 'right'] as const).filter(side => slots.some(slot => slot[side] > 0))
  const floats = native.floats
  if (floats === undefined) return 'the row recorded no slot floats'
  if (floats.length !== slots.length * sides.length) return `${floats.length} slot floats; the slots declare ${slots.length * sides.length}`
  const units = (value: number): number => {
    switch (browser) {
      case 'chrome': return Math.round(value * 64 * devicePixelRatio)
      case 'safari': case 'webkit-host': return Math.round(value * 64)
      case 'firefox': return Math.round(value * 60)
    }
  }
  const lineHeight = c.paragraph.lineHeight
  const right = units(native.width)
  for (let row = 0, k = 0; row < slots.length; row++) {
    for (let s = 0; s < sides.length; s++, k++) {
      const side = sides[s]!
      const float = floats[k]!
      const where = `row ${row}'s ${side} float (inset ${slots[row]![side]})`
      if (float.y !== row * lineHeight || float.height !== lineHeight) return `${where} is at y ${float.y}, height ${float.height}; the row is at y ${row * lineHeight}`
      if (side === 'left' && float.x !== 0) return `${where} starts at x ${float.x}`
      if (side === 'right' && units(float.x) + units(float.width) !== right) return `${where} ends at x ${float.x + float.width}; the content box ends at ${native.width}`
    }
  }
  return null
}

// The rows' code point observations must walk the concatenated text code point by code point.
function nativeProblem(native: NativeObservation, text: string): string | null {
  let expected = 0
  for (let i = 0; i < native.points.length; i++) {
    const point = native.points[i]!
    const length = text.codePointAt(expected)! > 0xffff ? 2 : 1
    if (point.offset !== expected || point.length !== length) return `Code point observation ${i} is [${point.offset}, +${point.length}); expected [${expected}, +${length})`
    expected += length
  }
  return expected === text.length ? null : `Observations cover ${expected} of ${text.length} UTF-16 units`
}

// ---- Engine units ----

// A line's width as its engine computes it (DESIGN.md §2.6): Blink's LineInfo::Width in LayoutUnits with hanging spaces,
// WebKit's float32 content width, Gecko's line box in app units.
function engineWidth(layout: RecordedLayout, line: number): number {
  switch (layout.engine) {
    case 'blink': return layout.lines[line]!.geometry.width
    case 'webkit': return layout.lines[line]!.geometry.contentWidth
    case 'gecko': return layout.lines[line]!.geometry.width
  }
}

// The horizontal extent of a line's node rects in engine units: 'none' without a positive rect, 'off-encoding' when a
// rect's edges aren't what any engine value reports as.
type Extent = { kind: 'none' } | { kind: 'off-encoding'; rect: Rect } | { kind: 'extent'; left: number; right: number }

// A reported rect's edges in engine units, inverting each engine's encoding exactly, or null where no engine value
// reports as the rect does.
function rectUnits(layout: RecordedLayout, line: number, rect: { x: number; width: number }): { left: number; right: number } | null {
  switch (layout.engine) {
    case 'blink': {
      // LayoutUnit::ToFloat scaled by 1 / layout zoom as a float, and the DOMRect width as the float difference of the
      // edges (layout_unit.h:244-246, adjust_for_absolute_zoom.h:109-115; research/observe-blink.md §4.1).
      const zoom = layout.lines[line]!.geometry.layoutZoom
      const css = (raw: number): number => f32(f32(raw / 64) * f32(1 / zoom))
      const left = Math.round(rect.x * 64 * zoom)
      const right = Math.round((rect.x + rect.width) * 64 * zoom)
      return css(left) === rect.x && f32(css(right) - css(left)) === rect.width ? { left, right } : null
    }
    case 'webkit':
      // float32 CSS px; a box's right edge is FloatRect::maxX, the float32 sum (research/observe-webkit.md E2).
      return { left: rect.x, right: f32(rect.x + rect.width) }
    case 'gecko': {
      // DOMRect::SetLayoutRect rounds each app-unit edge to 1/65536 px and narrows each field to float32
      // (DOMRect.cpp:152-164; research/observe-gecko.md §3).
      const R = (au: number): number => Math.floor(au * (65536 / 60) + 0.5) / 65536
      const left = Math.round(rect.x * 60)
      const right = Math.round((rect.x + rect.width) * 60)
      return f32(R(left)) === rect.x && f32(R(right) - R(left)) === rect.width ? { left, right } : null
    }
  }
}

function extentOf(layout: RecordedLayout, line: number, rects: Rect[]): Extent {
  let left = Infinity
  let right = -Infinity
  for (let k = 0; k < rects.length; k++) {
    const rect = rects[k]!
    if (!(rect.width > 0)) continue
    const units = rectUnits(layout, line, rect)
    if (units === null) return { kind: 'off-encoding', rect }
    left = Math.min(left, units.left)
    right = Math.max(right, units.right)
  }
  return left === Infinity ? { kind: 'none' } : { kind: 'extent', left, right }
}

// Whether an extent spans the engine width: Blink and Gecko integers, and in WebKit a right edge that is the float32 sum
// of the left edge and the width, as box positions are summed (research/observe-webkit.md §5).
function spans(layout: RecordedLayout, extent: Extent, width: number): boolean {
  switch (extent.kind) {
    case 'none': return width === 0
    case 'off-encoding': return false
    case 'extent':
      switch (layout.engine) {
        case 'blink':
        case 'gecko': return extent.right - extent.left === width
        case 'webkit': return f32(extent.left + width) === extent.right
      }
  }
}

function describeExtent(extent: Extent): string {
  switch (extent.kind) {
    case 'none': return 'no positive rect'
    case 'off-encoding': return `a rect off the engine's encoding (x ${extent.rect.x}, width ${extent.rect.width})`
    case 'extent': return `[${extent.left}, ${extent.right}]`
  }
}

// The engine width minus an extent's width: in engine units for Blink and Gecko, in 1/64 px for WebKit.
function widthDifference(layout: RecordedLayout, extent: Extent, width: number): number | null {
  if (extent.kind !== 'extent') return null
  switch (layout.engine) {
    case 'blink':
    case 'gecko': return width - (extent.right - extent.left)
    case 'webkit': return Math.round((width - (extent.right - extent.left)) * 64)
  }
}

// ---- Facts ----

export type Tally = { equal: number; differ: number }
export type Facts = {
  // Rect counts per code point and per node, predicted by definition.
  counts: Tally
  // x and width of rects whose counts agree, by state.
  predicted: Tally
  limited: Partial<Record<GapName, Tally>>
  // Line membership of those rects, where native lines map to engine lines.
  lines: Tally
  // Engine facts no rect reflects, by the port's rule.
  unobservable: Record<string, number>
  // Native rects without positive height, which the grouping places on no line.
  unplaced: number
}

function newFacts(): Facts {
  return { counts: { equal: 0, differ: 0 }, predicted: { equal: 0, differ: 0 }, limited: {}, lines: { equal: 0, differ: 0 }, unobservable: {}, unplaced: 0 }
}

function addTally(into: Tally, from: Tally): void {
  into.equal += from.equal
  into.differ += from.differ
}

function addFacts(into: Facts, from: Facts): void {
  addTally(into.counts, from.counts)
  addTally(into.predicted, from.predicted)
  for (const [gap, tally] of Object.entries(from.limited) as Array<[GapName, Tally]>) addTally(into.limited[gap] ??= { equal: 0, differ: 0 }, tally)
  addTally(into.lines, from.lines)
  for (const [rule, count] of Object.entries(from.unobservable)) into.unobservable[rule] = (into.unobservable[rule] ?? 0) + count
  into.unplaced += from.unplaced
}

type FirstDifference = { value: string | null }

function compareValue(where: string, expected: Expected, value: number, facts: Facts, first: FirstDifference): void {
  const equal = expected.value === value
  switch (expected.state) {
    case 'predicted':
      if (equal) {
        facts.predicted.equal++
      } else {
        facts.predicted.differ++
        first.value ??= `${where}: native ${value}, expected ${expected.value}`
      }
      break
    case 'limited': {
      const tally = facts.limited[expected.gap] ??= { equal: 0, differ: 0 }
      if (equal) tally.equal++
      else tally.differ++
      break
    }
  }
}

// Per range: the same number of rects, and each x and width equal after the engine's rounding.
function compareRects(where: string, expected: ExpectedRect[], native: Rect[], facts: Facts, first: FirstDifference): void {
  if (expected.length !== native.length) {
    facts.counts.differ++
    first.value ??= `${where}: native ${native.length} rects, expected ${expected.length}`
    return
  }
  facts.counts.equal++
  for (let k = 0; k < expected.length; k++) {
    compareValue(`${where} rect ${k} x`, expected[k]!.x, native[k]!.x, facts, first)
    compareValue(`${where} rect ${k} width`, expected[k]!.width, native[k]!.width, facts, first)
  }
}

function addUnique(list: number[], value: number): void {
  if (!list.includes(value)) list.push(value)
}

// Whether a range reports on the lines the layout places it: the native lines of its placed rects against the mapped lines
// of the expected rects. An expected rect on an engine line without a line box maps to no native line: that line has no
// block size, so its rects have none either (Firefox reports height 0 for them). Where the counts agree, rects pair by
// index, so a native rect without positive height drops its expected partner; otherwise the lines compare only when every
// native rect is placed. Returns the difference, or null.
function lineDifference(expected: ExpectedRect[], native: number[], nativeLineOf: Int32Array, facts: Facts): string | null {
  const nativeSet: number[] = []
  const expectedSet: number[] = []
  if (expected.length === native.length) {
    for (let k = 0; k < expected.length; k++) {
      if (native[k]! < 0) continue
      const mapped = nativeLineOf[expected[k]!.line]!
      if (mapped === native[k]) facts.lines.equal++
      else facts.lines.differ++
      addUnique(nativeSet, native[k]!)
      if (mapped >= 0) addUnique(expectedSet, mapped)
    }
  } else {
    for (let k = 0; k < native.length; k++) {
      if (native[k]! < 0) return null
      addUnique(nativeSet, native[k]!)
    }
    for (let k = 0; k < expected.length; k++) {
      const mapped = nativeLineOf[expected[k]!.line]!
      if (mapped >= 0) addUnique(expectedSet, mapped)
    }
  }
  nativeSet.sort((a, b) => a - b)
  expectedSet.sort((a, b) => a - b)
  if (nativeSet.length === expectedSet.length && nativeSet.every((line, i) => line === expectedSet[i])) return null
  return `native lines ${nativeSet.join(',') || 'none'}; expected ${expectedSet.join(',') || 'none'}`
}

// ---- Scoring a row ----

export type CaseScore = {
  metrics: Record<MetricName, Metric>
  // null when nothing was compared: a native or prediction error, a lines-only prediction, an observation error.
  facts: Facts | null
  // The first predicted value or rect count that differs.
  firstDifference: string | null
  native: NativeLines | null
  // Every gap the layout reports, on the paragraph or a line, sorted.
  gaps: GapName[]
  // Per line whose widths compared: the engine width minus the native extent (widthDifference).
  widthDiffs: number[]
  // For a prediction of line ranges alone (lineRangeDiagnostics); null otherwise.
  diagnostics: LineRangeDiagnostics | null
  // Why the page doesn't describe the case's declared input (slotProtocol), or null. Every metric is then unobserved.
  protocol: string | null
  // Per failing metric, the failing lines and the gaps that concern them (see "Line-local gaps" below).
  lineGaps: Partial<Record<MetricName, MetricAttribution>>
}

// ---- Line-local gaps ----

// A failing row is covered by a gap only where a gap condition concerns the failing line itself or the break decision that
// ended the line before it, the decision the failing line starts from. The scorer names, per failing line:
// - 'line': a gap in the failing engine line's own `gaps`;
// - 'previous-line': a gap in the `gaps` of the engine line before it, or of a line without a line box between the two;
// - 'below-floats': a gap of a slot the engine refused between the two lines (`belowFloats`);
// - 'paragraph-range': a paragraph gap whose `at` range meets the source range of those lines, [previous line start,
//   failing line end], a break offset at either end included.
// A paragraph gap without `at` concerns the paragraph, not a line, and covers nothing; it is listed apart.
// Which line fails:
// - lineCount and breaks: the first native line where the prediction and native layout disagree. Line boxes pair with
//   native lines from the top; for every code point, node and element whose native lines and expected lines differ, the
//   lowest line in one set and not the other. With no such difference and other line counts, the first line that only one
//   side has. Later lines follow from it, so only this one is attributed.
// - widths and painter: every line whose width or painted extent differs, each on its own.
export type GapScope = 'line' | 'previous-line' | 'below-floats' | 'paragraph-range'
export type LineAttribution = {
  // The native line index (the k-th line box from the top), and its engine line; null where the prediction has no k-th
  // line box.
  nativeLine: number
  engineLine: number | null
  gaps: Array<{ gap: GapName; scope: GapScope }>
}
export type MetricAttribution = {
  lines: LineAttribution[]
  // Every failing line has a line-local gap.
  covered: boolean
  // Paragraph gaps without a range, which cover no line.
  paragraphGaps: GapName[]
}

function paragraphGapNames(layout: RecordedLayout): GapName[] {
  const names: GapName[] = []
  for (let g = 0; g < layout.gaps.length; g++) if (layout.gaps[g]!.at === undefined && !names.includes(layout.gaps[g]!.gap)) names.push(layout.gaps[g]!.gap)
  return names.sort()
}

// The gaps that concern native line k, given the engine lines with a line box (boxes, top to bottom).
export function lineLocalGaps(layout: RecordedLayout, boxes: readonly number[], k: number): LineAttribution {
  const lines = layout.lines
  const engineLine = k < boxes.length ? boxes[k]! : null
  const previous = k > 0 && k - 1 < boxes.length ? boxes[k - 1]! : -1
  // The engine lines after the previous line box up to and including the failing one (to the end without one).
  const last = engineLine ?? lines.length - 1
  const gaps: LineAttribution['gaps'] = []
  const add = (gap: GapName, scope: GapScope): void => {
    if (!gaps.some(value => value.gap === gap && value.scope === scope)) gaps.push({ gap, scope })
  }
  if (engineLine !== null) for (const gap of lines[engineLine]!.gaps) add(gap.gap, 'line')
  for (let l = Math.max(previous, 0); l <= last && l < lines.length; l++) {
    if (l === engineLine) continue
    if (l === previous || !lines[l]!.hasLineBox) for (const gap of lines[l]!.gaps) add(gap.gap, 'previous-line')
  }
  // Slot rows: a line box takes the next row, a refused slot records its row and takes the next one (index.ts fillLines).
  // The refusals between the previous line box and the failing line are those whose row is past the previous box's row
  // and up to the failing line's row.
  if (layout.belowFloats.length > 0) {
    let row = 0
    let previousRow = -1
    let failingRow = Number.MAX_SAFE_INTEGER
    let refusal = 0
    for (let l = 0; l < lines.length; l++) {
      while (refusal < layout.belowFloats.length && layout.belowFloats[refusal]!.row === row) {
        refusal++
        row++
      }
      if (l === previous) previousRow = row
      if (l === engineLine) failingRow = row
      if (lines[l]!.hasLineBox) row++
    }
    for (const value of layout.belowFloats) {
      if (value.row > previousRow && value.row <= failingRow) for (const gap of value.gaps) add(gap.gap, 'below-floats')
    }
  }
  const start = lines.length === 0 ? 0 : lines[Math.max(previous, 0)]!.start
  const end = lines.length === 0 ? 0 : lines[Math.min(last, lines.length - 1)]!.end
  for (const gap of layout.gaps) {
    const at = gap.at
    if (at === undefined) continue
    if (at.start === at.end ? at.start >= start && at.start <= end : at.start < end && at.end > start) add(gap.gap, 'paragraph-range')
  }
  gaps.sort((a, b) => (a.gap < b.gap ? -1 : a.gap > b.gap ? 1 : a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0))
  return { nativeLine: k, engineLine, gaps }
}

function attribution(layout: RecordedLayout, boxes: readonly number[], failing: readonly number[]): MetricAttribution {
  const lines = failing.map(k => lineLocalGaps(layout, boxes, k))
  return { lines, covered: lines.length > 0 && lines.every(line => line.gaps.length > 0), paragraphGaps: paragraphGapNames(layout) }
}

const UNATTRIBUTED: MetricAttribution = { lines: [], covered: false, paragraphGaps: [] }

function allMetrics(metric: Metric): Record<MetricName, Metric> {
  return { lineCount: metric, breaks: metric, widths: metric, painter: metric }
}

function gapNames(layout: RecordedLayout): GapName[] {
  const names: GapName[] = []
  for (let g = 0; g < layout.gaps.length; g++) if (!names.includes(layout.gaps[g]!.gap)) names.push(layout.gaps[g]!.gap)
  for (let l = 0; l < layout.lines.length; l++) {
    const gaps = layout.lines[l]!.gaps
    for (let g = 0; g < gaps.length; g++) if (!names.includes(gaps[g]!.gap)) names.push(gaps[g]!.gap)
  }
  return names.sort()
}

function describeCodePoint(text: string, offset: number, length: number): string {
  return `code point ${offset} ${JSON.stringify(text.slice(offset, offset + length))}`
}

// The painted rects of one line, node rects and code point rects, grouped by vertical centre alone (rule 3 of
// nativeLines). Painted code points aren't mapped to their nodes, so rules 1 and 2 don't apply here.
function paintedLineCount(line: PainterLine, lineHeight: number): number {
  const centres: number[] = []
  const add = (rects: Rect[]): void => {
    for (let k = 0; k < rects.length; k++) if (rects[k]!.height > 0) centres.push(rects[k]!.y + rects[k]!.height / 2)
  }
  add(line.rects)
  const points = line.points ?? []
  for (let i = 0; i < points.length; i++) add(points[i]!.rects)
  return groupCentres(centres, lineHeight).count
}

function noNative(metric: Metric): CaseScore {
  return { metrics: allMetrics(metric), facts: null, firstDifference: null, native: null, gaps: [], widthDiffs: [], diagnostics: null, protocol: null, lineGaps: {} }
}

export function scoreRow(row: LabRow): CaseScore {
  if ('skipped' in row.native) return noNative({ status: 'unobserved', reason: 'native observation skipped', detail: row.native.skipped })
  if ('error' in row.native) return noNative({ status: 'unobserved', reason: 'native observation error', detail: row.native.error })
  const text = rowText(row.case)
  const problem = nativeProblem(row.native, text)
  if (problem !== null) return noNative({ status: 'unobserved', reason: 'malformed native observation', detail: problem })
  const native = nativeLines(row.native, row.case.paragraph, row.browser)
  const prediction = row.prediction
  const protocol = slotProtocol(row.case, row.native, row.browser, row.env.devicePixelRatio)
  if (protocol !== null) {
    const gaps = 'layout' in prediction ? gapNames(prediction.layout) : []
    return { metrics: allMetrics({ status: 'unobserved', reason: 'protocol row: the slot floats don\'t describe the declared slots', detail: protocol }), facts: null, firstDifference: null, native, gaps, widthDiffs: [], diagnostics: null, protocol, lineGaps: {} }
  }
  if ('error' in prediction) {
    const metric: Metric = { status: 'fail', reason: 'prediction error', detail: prediction.error }
    return { metrics: { ...allMetrics(metric), painter: { status: 'not-applicable', reason: 'no prediction' } }, facts: null, firstDifference: null, native, gaps: [], widthDiffs: [], diagnostics: null, protocol: null, lineGaps: { lineCount: UNATTRIBUTED, breaks: UNATTRIBUTED, widths: UNATTRIBUTED } }
  }
  if ('layout' in prediction) return scoreEngine(row, row.native, prediction, native, text)
  return scoreLines(row, row.native, prediction, native, text)
}

// ---- Predictions of line ranges alone ----

// What can be said about a prediction that carries line ranges and nothing an observation port could read (main's
// predictor rows). lineCount is a metric: the number of native lines against the number of predicted lines. Breaks can't be
// scored as a metric, because no port derives the rects such a prediction implies, and widths aren't comparable, because
// its widths are its own observer's visible extents. Two diagnostics, never metrics and never passes in a gate
// (research/MAIN-TRIAGE.md §2):
// - visibleBreaks: every code point whose positive-width rects all sit on one native line lies in the predicted line of that
//   index. Unobserved when no code point has such rects, or when the line counts differ.
// - zeroWidthPlacement: every code point outside white space whose placed rects all have zero width and sit on one native
//   line lies in the predicted line of that index. Where collapsed or hanging white space reports is engine geometry, so
//   white space is left out. Unobserved when there's no such code point, or when the line counts differ.
export type LineRangeDiagnostics = { visibleBreaks: Metric; zeroWidthPlacement: Metric }

const DIAGNOSTIC_WHITE_SPACE = /^[ \t\n\r\f　]$/

export function lineRangeDiagnostics(native: NativeObservation, lines: NativeLines, prediction: LinesPrediction, text: string): LineRangeDiagnostics {
  if (lines.count !== prediction.lines.length) {
    const metric: Metric = { status: 'unobserved', reason: 'line count differs', detail: `native ${lines.count}, predicted ${prediction.lines.length}` }
    return { visibleBreaks: metric, zeroWidthPlacement: metric }
  }
  const predictedLine = (offset: number): number => {
    for (let l = 0; l < prediction.lines.length; l++) if (offset >= prediction.lines[l]!.start && offset < prediction.lines[l]!.end) return l
    return -1
  }
  let visible: Metric = { status: 'unobserved', reason: 'no code point has positive-width rects on one native line' }
  let zeroWidth: Metric = { status: 'unobserved', reason: 'no zero-width code point to place' }
  for (let i = 0; i < native.points.length; i++) {
    const point = native.points[i]!
    // The one native line of its positive-width placed rects (-1: several), and of all its placed rects.
    let positiveLine = -2
    let placedLine = -2
    for (let k = 0; k < point.rects.length; k++) {
      const line = lines.points[i]![k]!
      if (line < 0) continue
      placedLine = placedLine === -2 || placedLine === line ? line : -1
      if (point.rects[k]!.width > 0) positiveLine = positiveLine === -2 || positiveLine === line ? line : -1
    }
    const where = describeCodePoint(text, point.offset, point.length)
    // A code point no predicted line covers says nothing about where the predicted lines start (main's line ranges leave
    // out zero-width content at a line edge; research/ROUND1-CRITIC.md item 3): it is left out.
    const l = predictedLine(point.offset)
    if (l < 0) continue
    if (positiveLine >= 0) {
      if (visible.status !== 'fail') visible = l === positiveLine ? { status: 'pass' } : { status: 'fail', reason: 'code point on other lines', detail: `${where}: native line ${positiveLine}, predicted line ${l}` }
    } else if (positiveLine === -2 && placedLine >= 0 && !DIAGNOSTIC_WHITE_SPACE.test(text.slice(point.offset, point.offset + point.length))) {
      if (zeroWidth.status !== 'fail') zeroWidth = l === placedLine ? { status: 'pass' } : { status: 'fail', reason: 'zero-width code point on other lines', detail: `${where}: native line ${placedLine}, predicted line ${l}` }
    }
  }
  return { visibleBreaks: visible, zeroWidthPlacement: zeroWidth }
}

function scoreLines(row: LabRow, nativeObservation: NativeObservation, prediction: LinesPrediction, native: NativeLines, text: string): CaseScore {
  const lineCount: Metric = native.count === prediction.lines.length
    ? { status: 'pass' }
    : { status: 'fail', reason: 'line count differs', detail: `native ${native.count}, predicted ${prediction.lines.length}` }
  const noLayout: Metric = { status: 'unobserved', reason: 'the prediction has no engine layout' }
  let painter: Metric = noLayout
  const painted = row.painter
  if (painted === null) {
    painter = { status: 'not-applicable', reason: 'paint returned null' }
  } else if ('error' in painted) {
    painter = { status: 'fail', reason: 'painter error', detail: painted.error }
  } else if (painted.lines.length !== prediction.lines.length) {
    painter = { status: 'fail', reason: 'painted line count differs', detail: `painted ${painted.lines.length} elements for ${prediction.lines.length} lines` }
  } else {
    for (let i = 0; i < painted.lines.length; i++) {
      const count = paintedLineCount(painted.lines[i]!, row.case.paragraph.lineHeight)
      if (count > 1) {
        painter = { status: 'fail', reason: 'painted line wraps', detail: `line ${i} painted on ${count} lines` }
        break
      }
    }
  }
  return {
    metrics: { lineCount, breaks: noLayout, widths: { status: 'not-applicable', reason: 'breaks unobserved' }, painter },
    facts: null, firstDifference: null, native, gaps: [], widthDiffs: [],
    diagnostics: lineRangeDiagnostics(nativeObservation, native, prediction, text),
    protocol: null, lineGaps: lineCount.status === 'fail' ? { lineCount: UNATTRIBUTED } : {},
  }
}

function observationProblem(observation: ExpectedObservation, nativeObservation: NativeObservation): string | null {
  if (observation.nodes.length !== nativeObservation.runRects.length) return `${observation.nodes.length} nodes expected; ${nativeObservation.runRects.length} observed`
  if (nativeObservation.elements !== undefined && observation.elements.length !== nativeObservation.elements.length) return `${observation.elements.length} elements expected; ${nativeObservation.elements.length} observed`
  if (observation.codePoints.length !== nativeObservation.points.length) return `${observation.codePoints.length} code points expected; ${nativeObservation.points.length} observed`
  for (let i = 0; i < observation.codePoints.length; i++) {
    if (observation.codePoints[i]!.offset !== nativeObservation.points[i]!.offset) return `code point ${i} expected at ${observation.codePoints[i]!.offset}; observed at ${nativeObservation.points[i]!.offset}`
  }
  return null
}

function scoreEngine(row: LabRow, nativeObservation: NativeObservation, prediction: EnginePrediction, native: NativeLines, text: string): CaseScore {
  const layout = prediction.layout
  const gaps = gapNames(layout)
  const observation = prediction.observation
  const unobservedAll = (metric: Metric): CaseScore => ({ metrics: allMetrics(metric), facts: null, firstDifference: null, native, gaps, widthDiffs: [], diagnostics: null, protocol: null, lineGaps: {} })
  if ('error' in observation) return unobservedAll({ status: 'unobserved', reason: 'observation port error', detail: observation.error })
  const shape = observationProblem(observation, nativeObservation)
  if (shape !== null) return unobservedAll({ status: 'unobserved', reason: 'the observation covers other ranges than the row', detail: shape })
  // Element rects are recorded for cases with inline structure only; a flat case's spans aren't compared as elements.
  const nativeElements = nativeObservation.elements ?? []
  const elements = nativeObservation.elements === undefined ? [] : observation.elements

  const facts = newFacts()
  const first: FirstDifference = { value: null }
  for (let i = 0; i < observation.codePoints.length; i++) {
    const point = observation.codePoints[i]!
    compareRects(describeCodePoint(text, point.offset, point.length), point.rects, nativeObservation.points[i]!.rects, facts, first)
  }
  for (let r = 0; r < observation.nodes.length; r++) compareRects(`node ${r}`, observation.nodes[r]!, nativeObservation.runRects[r]!, facts, first)
  for (let e = 0; e < elements.length; e++) compareRects(`element ${e}`, elements[e]!, nativeElements[e]!, facts, first)
  for (let u = 0; u < observation.unobservable.length; u++) {
    const rule = observation.unobservable[u]!.rule
    facts.unobservable[rule] = (facts.unobservable[rule] ?? 0) + 1
  }
  facts.unplaced = native.unplaced

  // Engine lines with a line box, and the engine lines expected rects are placed on. A line box no Range and no element
  // reports can't be seen. An element with nothing to report expects one empty rect on no line (line -1).
  const boxes: number[] = []
  const placed = new Uint8Array(layout.lines.length)
  for (let l = 0; l < layout.lines.length; l++) if (layout.lines[l]!.hasLineBox) boxes.push(l)
  const mark = (rects: ExpectedRect[]): void => {
    for (let k = 0; k < rects.length; k++) if (rects[k]!.line >= 0) placed[rects[k]!.line] = 1
  }
  for (let i = 0; i < observation.codePoints.length; i++) mark(observation.codePoints[i]!.rects)
  for (let r = 0; r < observation.nodes.length; r++) mark(observation.nodes[r]!)
  for (let e = 0; e < elements.length; e++) mark(elements[e]!)
  let lineIssue: Metric | null = null
  for (let k = 0; k < boxes.length && lineIssue === null; k++) {
    if (placed[boxes[k]!] === 0) lineIssue = { status: 'unobserved', reason: 'a line box no Range or element reports', detail: `engine line ${boxes[k]}` }
  }
  const lineCount: Metric = lineIssue ?? (native.count === boxes.length
    ? { status: 'pass' }
    : { status: 'fail', reason: 'line count differs', detail: `native ${native.count}, predicted ${boxes.length}` })

  // The k-th line box from the top is native line k.
  const nativeLineOf = new Int32Array(layout.lines.length).fill(-1)
  for (let k = 0; k < boxes.length; k++) nativeLineOf[boxes[k]!] = k
  let breaks: Metric
  switch (lineCount.status) {
    case 'pass': {
      breaks = { status: 'pass' }
      for (let i = 0; i < observation.codePoints.length; i++) {
        const point = observation.codePoints[i]!
        const difference = lineDifference(point.rects, native.points[i]!, nativeLineOf, facts)
        if (difference !== null && breaks.status === 'pass') breaks = { status: 'fail', reason: 'code point on other lines', detail: `${describeCodePoint(text, point.offset, point.length)}: ${difference}` }
      }
      for (let r = 0; r < observation.nodes.length; r++) {
        const difference = lineDifference(observation.nodes[r]!, native.nodes[r]!, nativeLineOf, facts)
        if (difference !== null && breaks.status === 'pass') breaks = { status: 'fail', reason: 'text node on other lines', detail: `node ${r}: ${difference}` }
      }
      for (let e = 0; e < elements.length; e++) {
        const difference = lineDifference(elements[e]!, native.elements[e]!, nativeLineOf, facts)
        if (difference !== null && breaks.status === 'pass') breaks = { status: 'fail', reason: 'element on other lines', detail: `element ${e}: ${difference}` }
      }
      break
    }
    case 'fail': breaks = { status: 'fail', reason: 'line count differs', detail: lineCount.detail! }; break
    case 'unobserved':
    case 'not-applicable': breaks = lineCount; break
  }
  const lineGaps: CaseScore['lineGaps'] = {}
  if (lineCount.status === 'fail' || breaks.status === 'fail') {
    let k = Infinity
    for (let i = 0; i < observation.codePoints.length; i++) k = Math.min(k, divergence(observation.codePoints[i]!.rects, native.points[i]!, nativeLineOf))
    for (let r = 0; r < observation.nodes.length; r++) k = Math.min(k, divergence(observation.nodes[r]!, native.nodes[r]!, nativeLineOf))
    for (let e = 0; e < elements.length; e++) k = Math.min(k, divergence(elements[e]!, native.elements[e]!, nativeLineOf))
    if (k === Infinity) k = Math.min(native.count, boxes.length)
    const value = attribution(layout, boxes, [k])
    if (lineCount.status === 'fail') lineGaps.lineCount = value
    if (breaks.status === 'fail') lineGaps.breaks = value
  }

  // Per line box: the expected rects on it decide whether the observed rects show the engine width at all. Widths take the
  // union of the line's whole-node rects and element rects (a span's border box holds its box edges, an atomic inline its
  // border box; DESIGN.md §9); painted lines record text node rects alone, so the painter's extents take node rects.
  const expectedNodes: Rect[][] = []
  const expectedAll: Rect[][] = []
  const limitedBy: Array<GapName | null> = []
  for (let l = 0; l < layout.lines.length; l++) {
    expectedNodes.push([])
    expectedAll.push([])
    limitedBy.push(null)
  }
  const collect = (rects: ExpectedRect[], into: Rect[][][]): void => {
    for (let k = 0; k < rects.length; k++) {
      const rect = rects[k]!
      if (rect.line < 0) continue
      for (let i = 0; i < into.length; i++) into[i]![rect.line]!.push({ x: rect.x.value, y: 0, width: rect.width.value, height: 1 })
      for (const value of [rect.x, rect.width]) if (value.state === 'limited') limitedBy[rect.line] ??= value.gap
    }
  }
  for (let r = 0; r < observation.nodes.length; r++) collect(observation.nodes[r]!, [expectedNodes, expectedAll])
  for (let e = 0; e < elements.length; e++) collect(elements[e]!, [expectedAll])
  const observable = (l: number, expectedRects: Rect[][], what: string): Metric | null => {
    const expected = extentOf(layout, l, expectedRects[l]!)
    if (spans(layout, expected, engineWidth(layout, l))) return null
    return { status: 'unobserved', reason: `the port's ${what} on the line don't span the engine width`, detail: `engine line ${l}: width ${engineWidth(layout, l)}; expected ${what} span ${describeExtent(expected)}` }
  }

  const widthDiffs: number[] = []
  let widths: Metric
  if (breaks.status !== 'pass') {
    widths = { status: 'not-applicable', reason: breaks.status === 'fail' ? 'breaks differ' : 'breaks unobserved' }
  } else {
    const nativeAll: Rect[][] = []
    for (let k = 0; k < boxes.length; k++) nativeAll.push([])
    const place = (rects: Rect[], lines: number[]): void => {
      for (let k = 0; k < rects.length; k++) if (lines[k]! >= 0) nativeAll[lines[k]!]!.push(rects[k]!)
    }
    for (let r = 0; r < nativeObservation.runRects.length; r++) place(nativeObservation.runRects[r]!, native.nodes[r]!)
    for (let e = 0; e < elements.length; e++) place(nativeElements[e]!, native.elements[e]!)
    const what = elements.length === 0 ? 'node rects' : 'node and element rects'
    widths = { status: 'pass' }
    let issue: Metric | null = null
    const failing: number[] = []
    for (let k = 0; k < boxes.length; k++) {
      const l = boxes[k]!
      const unobservable = observable(l, expectedAll, what)
      if (unobservable !== null) {
        issue ??= unobservable
        continue
      }
      const width = engineWidth(layout, l)
      const extent = extentOf(layout, l, nativeAll[k]!)
      const difference = widthDifference(layout, extent, width)
      if (difference !== null) widthDiffs.push(difference)
      if (!spans(layout, extent, width)) {
        failing.push(k)
        if (widths.status === 'pass') {
          const gap = limitedBy[l]!
          widths = { status: 'fail', reason: gap === null ? 'width differs' : 'width differs under a named gap', detail: `engine line ${l}: width ${width}; native ${what} span ${describeExtent(extent)}${gap === null ? '' : `; limited by ${gap}`}` }
        }
      }
    }
    if (widths.status === 'pass' && issue !== null) widths = issue
    if (widths.status === 'fail') lineGaps.widths = attribution(layout, boxes, failing)
  }

  let painter: Metric
  const painted = row.painter
  if (painted === null) {
    painter = { status: 'not-applicable', reason: 'paint returned null' }
  } else if ('error' in painted) {
    painter = { status: 'fail', reason: 'painter error', detail: painted.error }
    lineGaps.painter = UNATTRIBUTED
  } else if (painted.lines.length !== boxes.length) {
    painter = { status: 'fail', reason: 'painted line count differs', detail: `painted ${painted.lines.length} elements for ${boxes.length} line boxes` }
    lineGaps.painter = UNATTRIBUTED
  } else {
    painter = { status: 'pass' }
    let issue: Metric | null = null
    const failing: number[] = []
    for (let k = 0; k < painted.lines.length; k++) {
      const line = painted.lines[k]!
      const l = boxes[k]!
      const count = paintedLineCount(line, row.case.paragraph.lineHeight)
      if (count > 1) {
        failing.push(k)
        if (painter.status === 'pass') painter = { status: 'fail', reason: 'painted line wraps', detail: `engine line ${l} painted on ${count} lines` }
        continue
      }
      const unobservable = observable(l, expectedNodes, 'node rects')
      if (unobservable !== null) {
        issue ??= unobservable
        continue
      }
      const width = engineWidth(layout, l)
      const extent = extentOf(layout, l, line.rects)
      if (!spans(layout, extent, width)) {
        failing.push(k)
        if (painter.status === 'pass') painter = { status: 'fail', reason: 'painted extent differs', detail: `engine line ${l}: width ${width}; painted node rects span ${describeExtent(extent)}` }
      }
    }
    if (painter.status === 'pass' && issue !== null) painter = issue
    if (painter.status === 'fail') lineGaps.painter = attribution(layout, boxes, failing)
  }
  return { metrics: { lineCount, breaks, widths, painter }, facts, firstDifference: first.value, native, gaps, widthDiffs, diagnostics: null, protocol: null, lineGaps }
}

// The lowest native line in one of a range's two line sets and not the other (see lineDifference for the pairing), or
// Infinity where the sets agree or can't be compared.
function divergence(expected: ExpectedRect[], placed: number[], nativeLineOf: Int32Array): number {
  const nativeSet = new Set<number>()
  const expectedSet = new Set<number>()
  const mapped = (rect: ExpectedRect): number => (rect.line >= 0 ? nativeLineOf[rect.line]! : -1)
  if (expected.length === placed.length) {
    for (let k = 0; k < expected.length; k++) {
      if (placed[k]! < 0) continue
      nativeSet.add(placed[k]!)
      if (mapped(expected[k]!) >= 0) expectedSet.add(mapped(expected[k]!))
    }
  } else {
    for (let k = 0; k < placed.length; k++) {
      if (placed[k]! < 0) return Infinity
      nativeSet.add(placed[k]!)
    }
    for (let k = 0; k < expected.length; k++) if (mapped(expected[k]!) >= 0) expectedSet.add(mapped(expected[k]!))
  }
  let lowest = Infinity
  for (const line of nativeSet) if (!expectedSet.has(line)) lowest = Math.min(lowest, line)
  for (const line of expectedSet) if (!nativeSet.has(line)) lowest = Math.min(lowest, line)
  return lowest
}

// ---- Comparing two runs ----

// What a comparison of two runs of the same case looks at: every rect's x, width and native line, per code point and per
// node. y and height outside the grouping aren't compared (DESIGN.md §9).
export type NativeView = { error: string | null; lines: number; points: number[][]; nodes: number[][]; elements: number[][]; floats: number[] }

function flatten(rects: Rect[], lines: number[]): number[] {
  const out: number[] = []
  for (let k = 0; k < rects.length; k++) out.push(rects[k]!.x, rects[k]!.width, lines[k]!)
  return out
}

export function nativeView(row: LabRow): NativeView {
  if ('skipped' in row.native) return { error: `native observation skipped: ${row.native.skipped}`, lines: 0, points: [], nodes: [], elements: [], floats: [] }
  if ('error' in row.native) return { error: row.native.error, lines: 0, points: [], nodes: [], elements: [], floats: [] }
  const lines = nativeLines(row.native, row.case.paragraph, row.browser)
  const points: number[][] = []
  for (let i = 0; i < row.native.points.length; i++) points.push(flatten(row.native.points[i]!.rects, lines.points[i]!))
  const nodes: number[][] = []
  for (let r = 0; r < row.native.runRects.length; r++) nodes.push(flatten(row.native.runRects[r]!, lines.nodes[r]!))
  const elements: number[][] = []
  const elementRects = row.native.elements ?? []
  for (let e = 0; e < elementRects.length; e++) elements.push(flatten(elementRects[e]!, lines.elements[e]!))
  // Slot floats decide whether a row is a protocol row: their x, y and width.
  const floats: number[] = []
  for (const float of row.native.floats ?? []) floats.push(float.x, float.y, float.width)
  return { error: null, lines: lines.count, points, nodes, elements, floats }
}

function sameValues(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// The first difference between two runs' native observations of one case, or null when they agree. Two observation
// errors agree (their messages carry stacks).
export function nativeDifference(a: NativeView, b: NativeView): string | null {
  if (a.error !== null || b.error !== null) return a.error !== null && b.error !== null ? null : `native observation error in one run: ${a.error ?? b.error}`
  if (a.lines !== b.lines) return `${a.lines} native lines vs ${b.lines}`
  for (let i = 0; i < a.points.length; i++) {
    if (!sameValues(a.points[i]!, b.points[i]!)) return `code point ${i}: [x, width, line] ${JSON.stringify(a.points[i])} vs ${JSON.stringify(b.points[i])}`
  }
  for (let r = 0; r < a.nodes.length; r++) {
    if (!sameValues(a.nodes[r]!, b.nodes[r]!)) return `node ${r}: [x, width, line] ${JSON.stringify(a.nodes[r])} vs ${JSON.stringify(b.nodes[r])}`
  }
  return null
}

// ---- Native observations from another run ----

// Where each row of a rows file sits: its UTF-8 byte offset and length, by case id.
export type RowIndex = Map<string, { offset: number; length: number }>

// Indexes a rows file by case id without parsing the rows. run.ts writes every row as JSON that starts with `{"id":"<id>"`;
// a line that doesn't is parsed whole to find its id. Throws on a row without an id or a duplicate id.
export async function indexRows(path: string): Promise<RowIndex> {
  // Start and end byte offsets of each non-empty line, in pairs.
  const bounds: number[] = []
  let base = 0
  let lineStart = 0
  for await (const chunk of Bun.file(path).stream()) {
    for (let newline = chunk.indexOf(10); newline !== -1; newline = chunk.indexOf(10, newline + 1)) {
      if (base + newline > lineStart) bounds.push(lineStart, base + newline)
      lineStart = base + newline + 1
    }
    base += chunk.length
  }
  if (base > lineStart) bounds.push(lineStart, base)
  const index: RowIndex = new Map()
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(256)
    for (let k = 0; k < bounds.length; k += 2) {
      const entry = { offset: bounds[k]!, length: bounds[k + 1]! - bounds[k]! }
      const read = readSync(fd, head, 0, Math.min(head.length, entry.length), entry.offset)
      const match = /^\{"id":("(?:[^"\\]|\\.)*")/.exec(head.toString('utf8', 0, read))
      const id: unknown = match !== null ? JSON.parse(match[1]!) : readRowAt(fd, entry).id
      if (typeof id !== 'string') throw new Error(`${path}: the row at byte ${entry.offset} has no id`)
      if (index.has(id)) throw new Error(`${path}: two rows for case ${id}`)
      index.set(id, entry)
    }
  } finally {
    closeSync(fd)
  }
  return index
}

// The row at an index entry of an open rows file.
export function readRowAt(fd: number, entry: { offset: number; length: number }): LabRow {
  const bytes = Buffer.alloc(entry.length)
  for (let done = 0; done < entry.length;) {
    const read = readSync(fd, bytes, done, entry.length - done, entry.offset + done)
    if (read === 0) throw new Error(`Short read at byte ${entry.offset + done}`)
    done += read
  }
  return JSON.parse(bytes.toString('utf8')) as LabRow
}

// A row from run.ts --predict-only with the native observation of another run's row for the same case: the other row's
// native observation, environment (so its document history) and native timing, with this row's prediction and painted
// lines. Returns why not instead when the row has its own native observation, the other row has none, the rows observed
// different cases, or they ran under other environments: browser, app bundle build, the browser process's given languages,
// user agent, devicePixelRatio, visual-viewport scale, page language or fixture fonts.
export function withNativeRow(row: LabRow, other: LabRow): LabRow | { error: string } {
  if (!('skipped' in row.native)) return { error: `row ${row.id} has its own native observation; --native-rows takes rows from run.ts --predict-only` }
  if ('skipped' in other.native) return { error: `the native row for ${row.id} has no native observation either` }
  if (other.id !== row.id || JSON.stringify(other.case) !== JSON.stringify(row.case)) return { error: `the native row for ${row.id} observed a different case` }
  const differences: string[] = []
  const compare = (name: string, a: unknown, b: unknown): void => {
    if (a !== b) differences.push(`${name} ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  }
  compare('browser', row.browser, other.browser)
  compare('build', JSON.stringify(row.build ?? null), JSON.stringify(other.build ?? null))
  compare('languages', JSON.stringify(row.languages?.given ?? null), JSON.stringify(other.languages?.given ?? null))
  compare('userAgent', row.env.userAgent, other.env.userAgent)
  compare('devicePixelRatio', row.env.devicePixelRatio, other.env.devicePixelRatio)
  compare('visualViewportScale', row.env.visualViewportScale, other.env.visualViewportScale)
  compare('pageLang', row.env.pageLang, other.env.pageLang)
  compare('fontFixtures', row.env.fontFixtures.join('|'), other.env.fontFixtures.join('|'))
  if (differences.length > 0) return { error: `the environments differ for ${row.id}: ${differences.join('; ')}` }
  return { ...row, env: other.env, native: other.native, timings: { ...row.timings, nativeMs: other.timings.nativeMs } }
}

// ---- Summary ----

// The environment a row was observed under: the browser build from the driver, the device, the browser process's given
// languages and the scorer version. Rows from before the driver recorded builds fall back to the user agent, which can't
// tell builds apart; rows from before it recorded languages have no language part.
export function environmentKey(row: LabRow): string {
  const e = row.env
  const build = row.build === undefined ? `build not recorded, ${e.userAgent}` : `${row.build.app} ${row.build.appVersion}, engine build ${row.build.engine}, macOS ${row.build.os}`
  const languages = row.languages === undefined ? '' : `; ${describeGiven(row.languages.given)}`
  return `${row.browser}: ${build}; DPR ${e.devicePixelRatio}, scale ${e.visualViewportScale}${languages}; scorer ${SCORER_VERSION}`
}

type Counts = Record<Status, number>
const emptyCounts = (): Counts => ({ pass: 0, fail: 0, unobserved: 0, 'not-applicable': 0 })
type BrowserSummary = {
  rows: number
  nativeErrors: number
  // Rows from run.ts --predict-only that no --native-rows row supplied.
  skippedNativeRows: number
  predictionErrors: number
  // Rows whose prediction has no engine layout (external predictors, rows from before the observation port).
  linesOnly: number
  observationErrors: number
  rejectedStyleRows: number
  environments: Record<string, number>
  metrics: Record<MetricName, Counts>
  reasons: Record<MetricName, Record<string, number>>
  // lineRangeDiagnostics over the lines-only rows.
  lineRangeDiagnostics: Record<keyof LineRangeDiagnostics, Counts>
  facts: Facts
  // Per gap: rows reporting it, and how many of those fail lineCount or breaks.
  gaps: Partial<Record<GapName, { rows: number; failingLinesOrBreaks: number }>>
  // Line-local gaps (CaseScore.lineGaps), per metric: failing rows; failing rows with a failing line no gap concerns; of
  // those, rows whose layout reports a paragraph gap without a range; and per gap, the failing rows it covers on some
  // failing line.
  lineLocal: {
    failures: Record<MetricName, number>
    withoutLineGap: Record<MetricName, number>
    withoutLineGapButParagraphGap: Record<MetricName, number>
    byGap: Partial<Record<GapName, Partial<Record<MetricName, number>>>>
  }
  // Protocol rows (slotProtocol): excluded from pass and fail; their metrics count as unobserved.
  protocolRows: number
  protocolIds: string[]
  // Engine width minus native extent over compared lines: LayoutUnits in Chrome, app units in Firefox, 1/64 px in WebKit.
  widthDiffs: Record<string, number>
  timingsMs: { native: number; predict: number; observe: number; paint: number; painterObserve: number }
  // Rows whose page couldn't resolve a named family, by family.
  missingFontRows: number
  missingFonts: Record<string, number>
  // Native line counts; rects without positive height; code point rects placed by centre (nativeLines rule 1 fallback).
  native: { lineCounts: Record<string, number>; unplacedRects: number; pointRectsByCentre: number }
  // With --native-compare: rows of this run compared with the other run's row for the same case, and the cases whose rect
  // x, width or native line differ. Those are left out of every count above that scores the prediction (metrics, reasons,
  // facts, gaps, histograms, families, examples) and listed here.
  historyDependent: {
    compared: number
    rows: number
    // No row for the case in the other run, or a row that observed a different version of the case.
    missing: number
    caseDiffers: number
    // Same rects as compared, different raw geometry (y or height).
    geometryOnly: number
    geometryOnlyIds: string[]
    cases: unknown[]
  }
}

function newBrowserSummary(): BrowserSummary {
  return {
    rows: 0, nativeErrors: 0, skippedNativeRows: 0, predictionErrors: 0, linesOnly: 0, observationErrors: 0, rejectedStyleRows: 0, environments: {},
    metrics: { lineCount: emptyCounts(), breaks: emptyCounts(), widths: emptyCounts(), painter: emptyCounts() },
    reasons: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
    lineRangeDiagnostics: { visibleBreaks: emptyCounts(), zeroWidthPlacement: emptyCounts() },
    facts: newFacts(), gaps: {}, widthDiffs: {},
    lineLocal: {
      failures: { lineCount: 0, breaks: 0, widths: 0, painter: 0 }, withoutLineGap: { lineCount: 0, breaks: 0, widths: 0, painter: 0 },
      withoutLineGapButParagraphGap: { lineCount: 0, breaks: 0, widths: 0, painter: 0 }, byGap: {},
    },
    protocolRows: 0, protocolIds: [],
    timingsMs: { native: 0, predict: 0, observe: 0, paint: 0, painterObserve: 0 },
    missingFontRows: 0, missingFonts: {},
    native: { lineCounts: {}, unplacedRects: 0, pointRectsByCentre: 0 },
    historyDependent: { compared: 0, rows: 0, missing: 0, caseDiffers: 0, geometryOnly: 0, geometryOnlyIds: [], cases: [] },
  }
}

// Per native line, the text of the code points with a rect on it.
function nativeLinesView(row: LabRow, text: string, native: NativeLines | null): string[] | null {
  if (native === null || 'error' in row.native || 'skipped' in row.native) return null
  const lines: string[] = []
  for (let k = 0; k < native.count; k++) lines.push('')
  for (let i = 0; i < row.native.points.length; i++) {
    const point = row.native.points[i]!
    const seen: number[] = []
    for (let k = 0; k < native.points[i]!.length; k++) {
      const line = native.points[i]![k]!
      if (line < 0 || seen.includes(line)) continue
      seen.push(line)
      lines[line] += text.slice(point.offset, point.offset + point.length)
    }
  }
  return lines
}

function predictedLinesView(row: LabRow, text: string): unknown {
  const prediction = row.prediction
  if ('error' in prediction) return prediction
  if (!('layout' in prediction)) return prediction.lines.map(line => ({ ...line, text: text.slice(line.start, line.end) }))
  const layout = prediction.layout
  const out: unknown[] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    out.push({ start: line.start, end: line.end, text: text.slice(line.start, line.end), hasLineBox: line.hasLineBox, width: engineWidth(layout, l), gaps: line.gaps.map(gap => gap.gap) })
  }
  return out
}

function example(row: LabRow, text: string, score: CaseScore, metric: MetricName): unknown {
  const p = row.case.paragraph
  const m = score.metrics[metric]
  return {
    id: row.id, family: row.family, browser: row.browser, metric, reason: m.reason, detail: m.detail, firstDifference: score.firstDifference,
    text,
    paragraph: {
      width: p.width, lineHeight: p.lineHeight, font: `${p.font.style} ${p.font.weight} ${p.font.size}px ${p.font.family}`,
      whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, direction: p.direction, lang: p.lang,
      runs: p.runs.map(run => ({ node: run.node, text: run.text, font: `${run.font.style} ${run.font.weight} ${run.font.size}px ${run.font.family}`, lang: run.lang })),
    },
    pageLang: row.case.pageLang,
    gaps: score.gaps,
    ...(score.lineGaps[metric] === undefined ? {} : { lineGaps: score.lineGaps[metric] }),
    ...(score.protocol === null ? {} : { protocol: score.protocol }),
    nativeLines: nativeLinesView(row, text, score.native),
    predictedLines: predictedLinesView(row, text),
    ...(score.diagnostics === null ? {} : { diagnostics: score.diagnostics }),
    ...(metric === 'painter' && row.painter !== null && !('error' in row.painter)
      ? { painterLines: row.painter.lines.map(line => ({ height: line.height, extent: line.extent, text: line.text })) }
      : {}),
  }
}

export async function* readLines(path: string): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of Bun.file(path).stream()) {
    buffer += decoder.decode(chunk, { stream: true })
    let start = 0
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n', start)) {
      if (index > start) yield buffer.slice(start, index)
      start = index + 1
    }
    buffer = buffer.slice(start)
  }
  buffer += decoder.decode()
  if (buffer.trim() !== '') yield buffer
}

// webkit-host runs installed Safari's engine, so its rows compare with Safari's.
function compareKey(browser: BrowserKind, id: string): string {
  return `${browser === 'webkit-host' ? 'safari' : browser}\n${id}`
}

// The facts of one row in a per-case file: [equal, differ] pairs, and the unobservable total.
function compactFacts(facts: Facts): unknown {
  const limited: Record<string, [number, number]> = {}
  for (const [gap, tally] of Object.entries(facts.limited) as Array<[GapName, Tally]>) limited[gap] = [tally.equal, tally.differ]
  let unobservable = 0
  for (const count of Object.values(facts.unobservable)) unobservable += count
  return { counts: [facts.counts.equal, facts.counts.differ], predicted: [facts.predicted.equal, facts.predicted.differ], limited, lines: [facts.lines.equal, facts.lines.differ], unobservable, unplaced: facts.unplaced }
}

// A summary for a sealed held-out set (research/TEST-ARCHITECTURE.md §3): counts per browser, metric, reason category and
// gap, with no case ids, texts, families or examples.
function sealedSummary(browsers: Partial<Record<BrowserKind, BrowserSummary>>): unknown {
  const out: Record<string, unknown> = {}
  for (const [browser, s] of Object.entries(browsers)) {
    out[browser] = {
      rows: s.rows, nativeErrors: s.nativeErrors, skippedNativeRows: s.skippedNativeRows, predictionErrors: s.predictionErrors, linesOnly: s.linesOnly,
      observationErrors: s.observationErrors, environments: s.environments, metrics: s.metrics, reasons: s.reasons, facts: s.facts, gaps: s.gaps,
      lineLocal: s.lineLocal, protocolRows: s.protocolRows,
      historyDependent: { compared: s.historyDependent.compared, rows: s.historyDependent.rows, missing: s.historyDependent.missing, caseDiffers: s.historyDependent.caseDiffers },
    }
  }
  return out
}

async function main(): Promise<void> {
  const USAGE = 'Usage: bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>] [--native-compare=<other rows file>] [--native-rows=<rows file that observed natively>] [--sealed]'
  const args = new Map<string, string>()
  let sealed = false
  for (const raw of process.argv.slice(2)) {
    if (raw === '--sealed') {
      sealed = true
      continue
    }
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null || !['rows', 'cases', 'out', 'examples', 'per-case', 'native-compare', 'native-rows'].includes(match[1]!)) {
      console.error(`Unknown argument ${raw}. ${USAGE}`)
      process.exit(1)
    }
    args.set(match[1]!, match[2]!)
  }
  const rowsPath = args.get('rows')
  const outPath = args.get('out')
  if (rowsPath === undefined || outPath === undefined) {
    console.error('--rows and --out are required')
    process.exit(1)
  }
  const examplesPerMetric = Number(args.get('examples') ?? (sealed ? 0 : 5))
  const perCasePath = args.get('per-case')
  if (sealed && (perCasePath !== undefined || examplesPerMetric !== 0)) {
    console.error('--sealed writes counts only; it takes no --per-case or --examples')
    process.exit(1)
  }

  // --cases restricts scoring to those ids and checks each row observed exactly that case.
  let casesById: Map<string, string> | null = null
  const casesPath = args.get('cases')
  if (casesPath !== undefined) {
    casesById = new Map()
    for (const line of readFileSync(casesPath, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      const c = JSON.parse(line) as Case
      casesById.set(c.id, JSON.stringify(c))
    }
  }

  // --native-compare: per case of the other run, hashes of its case, its native view and its raw native observation, and
  // where its row sits. Views of huge paragraphs don't fit in memory together; a view is read again only when its hash
  // differs, to name the difference.
  const comparePath = args.get('native-compare')
  let other: Map<string, { caseHash: bigint | number; viewHash: bigint | number; geometry: bigint | number; entry: { offset: number; length: number } }> | null = null
  const compareFd = comparePath === undefined ? null : openSync(comparePath, 'r')
  if (comparePath !== undefined) {
    other = new Map()
    const index = await indexRows(comparePath)
    for (const [id, entry] of index) {
      const row = readRowAt(compareFd!, entry)
      other.set(compareKey(row.browser, id), { caseHash: Bun.hash(JSON.stringify(row.case)), viewHash: Bun.hash(JSON.stringify(nativeView(row))), geometry: Bun.hash(JSON.stringify(row.native)), entry })
    }
  }

  // --native-rows: rows from run.ts --predict-only take their native observation from another run's row for the same case
  // (withNativeRow). The scorer refuses rows it can't combine; a row with no native row stays unobserved and makes the
  // scorer exit nonzero.
  const nativeRowsPath = args.get('native-rows')
  const nativeRows = nativeRowsPath === undefined ? null : { fd: openSync(nativeRowsPath, 'r'), index: await indexRows(nativeRowsPath) }
  const nativeRowCounts = { used: 0, missing: 0 }

  const browsers: Partial<Record<BrowserKind, BrowserSummary>> = {}
  const families: Record<string, Partial<Record<BrowserKind, Record<MetricName, Counts>>>> = {}
  const failExamples: Partial<Record<BrowserKind, Record<MetricName, unknown[]>>> = {}
  const unobservedExamples: Partial<Record<BrowserKind, Record<MetricName, unknown[]>>> = {}
  const seen = new Map<BrowserKind, Set<string>>()
  let skippedRows = 0
  let mismatchedCases = 0
  const perCaseFd = perCasePath === undefined ? null : openSync(perCasePath, 'w')
  const bump = (counts: Record<string, number>, key: string): void => { counts[key] = (counts[key] ?? 0) + 1 }

  for await (const line of readLines(rowsPath)) {
    let row = JSON.parse(line) as LabRow
    const caseJson = JSON.stringify(row.case)
    if (casesById !== null) {
      const expected = casesById.get(row.id)
      if (expected === undefined) {
        skippedRows++
        continue
      }
      if (expected !== caseJson) {
        mismatchedCases++
        continue
      }
    }
    if (nativeRows !== null) {
      const entry = nativeRows.index.get(row.id)
      if (entry === undefined) {
        nativeRowCounts.missing++
      } else {
        const combined = withNativeRow(row, readRowAt(nativeRows.fd, entry))
        if ('error' in combined) {
          console.error(`--native-rows=${nativeRowsPath}: ${combined.error}`)
          process.exit(1)
        }
        row = combined
        nativeRowCounts.used++
      }
    }
    const text = rowText(row.case)
    const score = scoreRow(row)
    const summary = browsers[row.browser] ??= newBrowserSummary()
    if (!seen.has(row.browser)) seen.set(row.browser, new Set())
    seen.get(row.browser)!.add(row.id)
    summary.rows++
    if ('skipped' in row.native) summary.skippedNativeRows++
    else if ('error' in row.native) summary.nativeErrors++
    else if (row.native.rejectedStyles.length > 0) summary.rejectedStyleRows++
    const prediction = row.prediction
    if ('error' in prediction) summary.predictionErrors++
    else if (!('layout' in prediction)) summary.linesOnly++
    else if ('error' in prediction.observation) summary.observationErrors++
    bump(summary.environments, environmentKey(row))
    summary.timingsMs.native += row.timings.nativeMs
    summary.timingsMs.predict += row.timings.predictMs
    summary.timingsMs.observe += row.timings.observeMs ?? 0
    summary.timingsMs.paint += row.timings.paintMs
    summary.timingsMs.painterObserve += row.timings.painterObserveMs
    if (!('error' in row.native) && !('skipped' in row.native) && (row.native.missingFonts ?? []).length > 0) {
      summary.missingFontRows++
      for (const family of row.native.missingFonts!) bump(summary.missingFonts, family)
    }
    if (score.native !== null) {
      bump(summary.native.lineCounts, String(score.native.count))
      summary.native.unplacedRects += score.native.unplaced
      summary.native.pointRectsByCentre += score.native.byCentre
    }

    let history: string | null = null
    if (other !== null) {
      const hd = summary.historyDependent
      const entry = other.get(compareKey(row.browser, row.id))
      if (entry === undefined) {
        hd.missing++
      } else if (entry.caseHash !== Bun.hash(caseJson)) {
        hd.caseDiffers++
      } else {
        hd.compared++
        const view = nativeView(row)
        // Equal hashes are equal views; otherwise the other row is read again to name the difference.
        history = Bun.hash(JSON.stringify(view)) === entry.viewHash ? null : nativeDifference(view, nativeView(readRowAt(compareFd!, entry.entry)))
        if (history !== null) {
          hd.rows++
          if (!sealed) hd.cases.push({ id: row.id, family: row.family, detail: history, text, metrics: score.metrics, nativeLines: nativeLinesView(row, text, score.native) })
        } else if (entry.geometry !== Bun.hash(JSON.stringify(row.native))) {
          hd.geometryOnly++
          if (!sealed && hd.geometryOnlyIds.length < 20) hd.geometryOnlyIds.push(row.id)
        }
      }
    }
    if (perCaseFd !== null) {
      writeSync(perCaseFd, JSON.stringify({
        id: row.id, family: row.family, browser: row.browser, ...score.metrics,
        ...(score.facts === null ? {} : { facts: compactFacts(score.facts) }),
        ...(score.diagnostics === null ? {} : { diagnostics: score.diagnostics }),
        gaps: score.gaps,
        ...(Object.keys(score.lineGaps).length === 0 ? {} : { lineGaps: score.lineGaps }),
        ...(score.protocol === null ? {} : { protocol: score.protocol }),
        ...(history === null ? {} : { historyDependent: history }),
      }) + '\n')
    }
    if (history !== null) continue

    if (score.protocol !== null) {
      summary.protocolRows++
      if (!sealed && summary.protocolIds.length < 200) summary.protocolIds.push(row.id)
    }
    for (let k = 0; k < METRICS.length; k++) {
      const name = METRICS[k]!
      if (score.metrics[name].status !== 'fail') continue
      const local = summary.lineLocal
      local.failures[name]++
      const value = score.lineGaps[name] ?? UNATTRIBUTED
      if (!value.covered) {
        local.withoutLineGap[name]++
        if (value.paragraphGaps.length > 0) local.withoutLineGapButParagraphGap[name]++
      }
      const covering = new Set<GapName>()
      for (const line of value.lines) for (const gap of line.gaps) covering.add(gap.gap)
      for (const gap of covering) {
        const counts = local.byGap[gap] ??= {}
        counts[name] = (counts[name] ?? 0) + 1
      }
    }
    if (score.facts !== null) addFacts(summary.facts, score.facts)
    if (score.diagnostics !== null) {
      summary.lineRangeDiagnostics.visibleBreaks[score.diagnostics.visibleBreaks.status]++
      summary.lineRangeDiagnostics.zeroWidthPlacement[score.diagnostics.zeroWidthPlacement.status]++
    }
    for (let i = 0; i < score.widthDiffs.length; i++) bump(summary.widthDiffs, String(score.widthDiffs[i]!))
    const failing = score.metrics.lineCount.status === 'fail' || score.metrics.breaks.status === 'fail'
    for (let g = 0; g < score.gaps.length; g++) {
      const entry = summary.gaps[score.gaps[g]!] ??= { rows: 0, failingLinesOrBreaks: 0 }
      entry.rows++
      if (failing) entry.failingLinesOrBreaks++
    }
    const familyCounts = sealed ? null : (families[row.family] ??= {})[row.browser] ??= { lineCount: emptyCounts(), breaks: emptyCounts(), widths: emptyCounts(), painter: emptyCounts() }
    const fails = failExamples[row.browser] ??= { lineCount: [], breaks: [], widths: [], painter: [] }
    const unobserved = unobservedExamples[row.browser] ??= { lineCount: [], breaks: [], widths: [], painter: [] }
    for (let k = 0; k < METRICS.length; k++) {
      const name = METRICS[k]!
      const metric = score.metrics[name]
      summary.metrics[name][metric.status]++
      if (familyCounts !== null) familyCounts[name][metric.status]++
      if (metric.reason !== undefined) bump(summary.reasons[name], `${metric.status}: ${metric.reason}`)
      const bucket = metric.status === 'fail' ? fails[name] : metric.status === 'unobserved' ? unobserved[name] : null
      if (bucket !== null && bucket.length < examplesPerMetric) bucket.push(example(row, text, score, name))
    }
  }
  if (perCaseFd !== null) closeSync(perCaseFd)
  if (nativeRows !== null) closeSync(nativeRows.fd)
  if (compareFd !== null) closeSync(compareFd)

  const missingRows: Partial<Record<BrowserKind, number>> = {}
  if (casesById !== null) for (const [browser, ids] of seen) missingRows[browser] = [...casesById.keys()].filter(id => !ids.has(id)).length
  const summary = sealed
    ? {
      generatedAt: new Date().toISOString(), scorer: SCORER_VERSION, sealed: true,
      note: 'counts only, for a sealed held-out set (research/TEST-ARCHITECTURE.md §3): no case ids, texts, families or examples',
      skippedRows, mismatchedCases, missingRows, ...(nativeRowsPath === undefined ? {} : { nativeRows: nativeRowCounts }),
      browsers: sealedSummary(browsers),
    }
    : {
      generatedAt: new Date().toISOString(), scorer: SCORER_VERSION,
      rowsFile: rowsPath, casesFile: casesPath ?? null, nativeCompareFile: comparePath ?? null,
      ...(nativeRowsPath === undefined ? {} : { nativeRowsFile: nativeRowsPath, nativeRows: nativeRowCounts }),
      note: 'unobserved and not-applicable are never passes; widths are compared only on cases whose breaks pass; with --native-compare, history-dependent cases are excluded from the metric counts; lineRangeDiagnostics are diagnostics, not metrics',
      skippedRows, mismatchedCases, missingRows,
      browsers, families, failExamples, unobservedExamples,
    }
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n')
  for (const [browser, s] of Object.entries(browsers)) {
    const line = METRICS.map(name => `${name} ${s.metrics[name].pass}/${s.metrics[name].fail}/${s.metrics[name].unobserved}/${s.metrics[name]['not-applicable']}`).join(' | ')
    const history = other === null ? '' : `; ${s.historyDependent.rows} history-dependent of ${s.historyDependent.compared} compared (excluded)`
    console.log(`${browser}: ${s.rows} rows; pass/fail/unobserved/n-a: ${line}${history}`)
  }
  console.log(`summary: ${outPath}`)
  if (mismatchedCases > 0) {
    console.error(`${mismatchedCases} rows observed a case that differs from --cases`)
    process.exit(1)
  }
  if (nativeRowCounts.missing > 0) {
    console.error(`${nativeRowCounts.missing} rows have no row for their case in --native-rows=${nativeRowsPath}; scored as unobserved`)
    process.exit(1)
  }
  if (Object.keys(browsers).length === 0) {
    console.error('No rows scored')
    process.exit(1)
  }
  if (other !== null && Object.values(browsers).every(s => s.historyDependent.compared === 0)) {
    console.error(`No row of ${rowsPath} has a row for the same case in ${comparePath}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
