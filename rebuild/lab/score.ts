// Offline scorer: compares each row's native Range rects exactly with the rects lab/observe/<engine>.ts expects from the
// row's layout, and derives lineCount, breaks, widths and painter from those comparisons (DESIGN.md §9).
//   bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>]
//     [--native-compare=<other rows file>]
// Imported as a module it runs nothing. It exports the per-row score, the native line grouping and the comparison of two
// runs, so tools use the scorer's own rules instead of copying them.
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import type { Expected, ExpectedObservation, ExpectedRect, GapName } from '../src/model.ts'
import type { BrowserKind, Case, EnginePrediction, LabRow, LinesPrediction, NativeObservation, PainterLine, Rect, RecordedLayout } from './types.ts'

// Part of every environment key, so rows scored by different scorers never meet in a baseline. Version 1 derived native
// lines and widths from visibility rules (git history of this file, 2026-09-16).
export const SCORER_VERSION = 2

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

// Observer assumption, vertical-centre grouping: rect centres on one line differ by less than half the paragraph's px line
// height, and centres on different lines by half a line height or more. Every inline box carries the line height and sits
// on its line's baseline, so only font metrics move centres within a line (Safari rounds half-leading per line; Firefox
// sizes a text frame by the fonts it uses). Vertical metrics aren't ported (DESIGN.md §9), so this stays an assumption, and
// a rect without positive height is placed on no line: Firefox reports one for a frame without height.
export type NativeLines = {
  count: number
  // Per code point and per node, the native line of each rect in order, top to bottom from 0; -1 without positive height.
  points: number[][]
  nodes: number[][]
  unplaced: number
}

function addCentres(rects: Rect[], into: number[]): void {
  for (let k = 0; k < rects.length; k++) {
    const rect = rects[k]!
    if (rect.height > 0) into.push(rect.y + rect.height / 2)
  }
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

export function nativeLines(native: NativeObservation, lineHeight: number): NativeLines {
  const centres: number[] = []
  for (let i = 0; i < native.points.length; i++) addCentres(native.points[i]!.rects, centres)
  for (let r = 0; r < native.runRects.length; r++) addCentres(native.runRects[r]!, centres)
  const { lineOf, count } = groupCentres(centres, lineHeight)
  let next = 0
  let unplaced = 0
  const assign = (rects: Rect[]): number[] => {
    const out: number[] = []
    for (let k = 0; k < rects.length; k++) {
      if (rects[k]!.height > 0) {
        out.push(lineOf[next]!)
        next++
      } else {
        out.push(-1)
        unplaced++
      }
    }
    return out
  }
  const points: number[][] = []
  for (let i = 0; i < native.points.length; i++) points.push(assign(native.points[i]!.rects))
  const nodes: number[][] = []
  for (let r = 0; r < native.runRects.length; r++) nodes.push(assign(native.runRects[r]!))
  return { count, points, nodes, unplaced }
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
}

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

// The painted rects of one line, node rects and code point rects, grouped by the same assumption as native lines.
function paintedLineCount(line: PainterLine, lineHeight: number): number {
  const centres: number[] = []
  addCentres(line.rects, centres)
  const points = line.points ?? []
  for (let i = 0; i < points.length; i++) addCentres(points[i]!.rects, centres)
  return groupCentres(centres, lineHeight).count
}

export function scoreRow(row: LabRow): CaseScore {
  if ('error' in row.native) return { metrics: allMetrics({ status: 'unobserved', reason: 'native observation error', detail: row.native.error }), facts: null, firstDifference: null, native: null, gaps: [], widthDiffs: [] }
  const text = rowText(row.case)
  const problem = nativeProblem(row.native, text)
  if (problem !== null) return { metrics: allMetrics({ status: 'unobserved', reason: 'malformed native observation', detail: problem }), facts: null, firstDifference: null, native: null, gaps: [], widthDiffs: [] }
  const native = nativeLines(row.native, row.case.paragraph.lineHeight)
  const prediction = row.prediction
  if ('error' in prediction) {
    const metric: Metric = { status: 'fail', reason: 'prediction error', detail: prediction.error }
    return { metrics: { ...allMetrics(metric), painter: { status: 'not-applicable', reason: 'no prediction' } }, facts: null, firstDifference: null, native, gaps: [], widthDiffs: [] }
  }
  if ('layout' in prediction) return scoreEngine(row, row.native, prediction, native, text)
  return scoreLines(row, prediction, native)
}

// A prediction without an engine layout has no expected rects: only its line count can be compared.
function scoreLines(row: LabRow, prediction: LinesPrediction, native: NativeLines): CaseScore {
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
  }
}

function observationProblem(observation: ExpectedObservation, nativeObservation: NativeObservation): string | null {
  if (observation.nodes.length !== nativeObservation.runRects.length) return `${observation.nodes.length} nodes expected; ${nativeObservation.runRects.length} observed`
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
  if ('error' in observation) return { metrics: allMetrics({ status: 'unobserved', reason: 'observation port error', detail: observation.error }), facts: null, firstDifference: null, native, gaps, widthDiffs: [] }
  const shape = observationProblem(observation, nativeObservation)
  if (shape !== null) return { metrics: allMetrics({ status: 'unobserved', reason: 'the observation covers other ranges than the row', detail: shape }), facts: null, firstDifference: null, native, gaps, widthDiffs: [] }

  const facts = newFacts()
  const first: FirstDifference = { value: null }
  for (let i = 0; i < observation.codePoints.length; i++) {
    const point = observation.codePoints[i]!
    compareRects(describeCodePoint(text, point.offset, point.length), point.rects, nativeObservation.points[i]!.rects, facts, first)
  }
  for (let r = 0; r < observation.nodes.length; r++) compareRects(`node ${r}`, observation.nodes[r]!, nativeObservation.runRects[r]!, facts, first)
  for (let u = 0; u < observation.unobservable.length; u++) {
    const rule = observation.unobservable[u]!.rule
    facts.unobservable[rule] = (facts.unobservable[rule] ?? 0) + 1
  }
  facts.unplaced = native.unplaced

  // Engine lines with a line box, and the engine lines expected rects are placed on. A line box no Range reports can't be
  // seen.
  const boxes: number[] = []
  const placed = new Uint8Array(layout.lines.length)
  for (let l = 0; l < layout.lines.length; l++) if (layout.lines[l]!.hasLineBox) boxes.push(l)
  const mark = (rects: ExpectedRect[]): void => {
    for (let k = 0; k < rects.length; k++) placed[rects[k]!.line] = 1
  }
  for (let i = 0; i < observation.codePoints.length; i++) mark(observation.codePoints[i]!.rects)
  for (let r = 0; r < observation.nodes.length; r++) mark(observation.nodes[r]!)
  let lineIssue: Metric | null = null
  for (let k = 0; k < boxes.length && lineIssue === null; k++) {
    if (placed[boxes[k]!] === 0) lineIssue = { status: 'unobserved', reason: 'a line box no Range reports', detail: `engine line ${boxes[k]}` }
  }
  const lineCount: Metric = lineIssue ?? (native.count === boxes.length
    ? { status: 'pass' }
    : { status: 'fail', reason: 'line count differs', detail: `native ${native.count}, predicted ${boxes.length}` })

  let breaks: Metric
  switch (lineCount.status) {
    case 'pass': {
      // The k-th line box from the top is native line k.
      const nativeLineOf = new Int32Array(layout.lines.length).fill(-1)
      for (let k = 0; k < boxes.length; k++) nativeLineOf[boxes[k]!] = k
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
      break
    }
    case 'fail': breaks = { status: 'fail', reason: 'line count differs', detail: lineCount.detail! }; break
    case 'unobserved':
    case 'not-applicable': breaks = lineCount; break
  }

  // Per line box: the expected node rects on it decide whether its node rects show the engine width at all.
  const expectedNodes: Rect[][] = []
  const limitedBy: Array<GapName | null> = []
  for (let l = 0; l < layout.lines.length; l++) {
    expectedNodes.push([])
    limitedBy.push(null)
  }
  for (let r = 0; r < observation.nodes.length; r++) {
    const rects = observation.nodes[r]!
    for (let k = 0; k < rects.length; k++) {
      const rect = rects[k]!
      expectedNodes[rect.line]!.push({ x: rect.x.value, y: 0, width: rect.width.value, height: 1 })
      for (const value of [rect.x, rect.width]) if (value.state === 'limited') limitedBy[rect.line] ??= value.gap
    }
  }
  const observable = (l: number): Metric | null => {
    const expected = extentOf(layout, l, expectedNodes[l]!)
    if (spans(layout, expected, engineWidth(layout, l))) return null
    return { status: 'unobserved', reason: 'the port\'s node rects on the line don\'t span the engine width', detail: `engine line ${l}: width ${engineWidth(layout, l)}; expected node rects span ${describeExtent(expected)}` }
  }

  const widthDiffs: number[] = []
  let widths: Metric
  if (breaks.status !== 'pass') {
    widths = { status: 'not-applicable', reason: breaks.status === 'fail' ? 'breaks differ' : 'breaks unobserved' }
  } else {
    const nativeNodes: Rect[][] = []
    for (let k = 0; k < boxes.length; k++) nativeNodes.push([])
    for (let r = 0; r < nativeObservation.runRects.length; r++) {
      const rects = nativeObservation.runRects[r]!
      for (let k = 0; k < rects.length; k++) if (native.nodes[r]![k]! >= 0) nativeNodes[native.nodes[r]![k]!]!.push(rects[k]!)
    }
    widths = { status: 'pass' }
    let issue: Metric | null = null
    for (let k = 0; k < boxes.length; k++) {
      const l = boxes[k]!
      const unobservable = observable(l)
      if (unobservable !== null) {
        issue ??= unobservable
        continue
      }
      const width = engineWidth(layout, l)
      const extent = extentOf(layout, l, nativeNodes[k]!)
      const difference = widthDifference(layout, extent, width)
      if (difference !== null) widthDiffs.push(difference)
      if (!spans(layout, extent, width) && widths.status === 'pass') {
        const gap = limitedBy[l]!
        widths = { status: 'fail', reason: gap === null ? 'width differs' : 'width differs under a named gap', detail: `engine line ${l}: width ${width}; native node rects span ${describeExtent(extent)}${gap === null ? '' : `; limited by ${gap}`}` }
      }
    }
    if (widths.status === 'pass' && issue !== null) widths = issue
  }

  let painter: Metric
  const painted = row.painter
  if (painted === null) {
    painter = { status: 'not-applicable', reason: 'paint returned null' }
  } else if ('error' in painted) {
    painter = { status: 'fail', reason: 'painter error', detail: painted.error }
  } else if (painted.lines.length !== boxes.length) {
    painter = { status: 'fail', reason: 'painted line count differs', detail: `painted ${painted.lines.length} elements for ${boxes.length} line boxes` }
  } else {
    painter = { status: 'pass' }
    let issue: Metric | null = null
    for (let k = 0; k < painted.lines.length; k++) {
      const line = painted.lines[k]!
      const l = boxes[k]!
      const count = paintedLineCount(line, row.case.paragraph.lineHeight)
      if (count > 1) {
        if (painter.status === 'pass') painter = { status: 'fail', reason: 'painted line wraps', detail: `engine line ${l} painted on ${count} lines` }
        continue
      }
      const unobservable = observable(l)
      if (unobservable !== null) {
        issue ??= unobservable
        continue
      }
      const width = engineWidth(layout, l)
      const extent = extentOf(layout, l, line.rects)
      if (!spans(layout, extent, width) && painter.status === 'pass') {
        painter = { status: 'fail', reason: 'painted extent differs', detail: `engine line ${l}: width ${width}; painted node rects span ${describeExtent(extent)}` }
      }
    }
    if (painter.status === 'pass' && issue !== null) painter = issue
  }
  return { metrics: { lineCount, breaks, widths, painter }, facts, firstDifference: first.value, native, gaps, widthDiffs }
}

// ---- Comparing two runs ----

// What a comparison of two runs of the same case looks at: every rect's x, width and native line, per code point and per
// node. y and height outside the grouping aren't compared (DESIGN.md §9).
export type NativeView = { error: string | null; lines: number; points: number[][]; nodes: number[][] }

function flatten(rects: Rect[], lines: number[]): number[] {
  const out: number[] = []
  for (let k = 0; k < rects.length; k++) out.push(rects[k]!.x, rects[k]!.width, lines[k]!)
  return out
}

export function nativeView(row: LabRow): NativeView {
  if ('error' in row.native) return { error: row.native.error, lines: 0, points: [], nodes: [] }
  const lines = nativeLines(row.native, row.case.paragraph.lineHeight)
  const points: number[][] = []
  for (let i = 0; i < row.native.points.length; i++) points.push(flatten(row.native.points[i]!.rects, lines.points[i]!))
  const nodes: number[][] = []
  for (let r = 0; r < row.native.runRects.length; r++) nodes.push(flatten(row.native.runRects[r]!, lines.nodes[r]!))
  return { error: null, lines: lines.count, points, nodes }
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

// ---- Summary ----

// The environment a row was observed under: the browser build from the driver, the device and the scorer version. Rows
// from before the driver recorded builds fall back to the user agent, which can't tell builds apart.
export function environmentKey(row: LabRow): string {
  const e = row.env
  const build = row.build === undefined ? `build not recorded, ${e.userAgent}` : `${row.build.app} ${row.build.appVersion}, engine build ${row.build.engine}, macOS ${row.build.os}`
  return `${row.browser}: ${build}; DPR ${e.devicePixelRatio}, scale ${e.visualViewportScale}; scorer ${SCORER_VERSION}`
}

type Counts = Record<Status, number>
const emptyCounts = (): Counts => ({ pass: 0, fail: 0, unobserved: 0, 'not-applicable': 0 })
type BrowserSummary = {
  rows: number
  nativeErrors: number
  predictionErrors: number
  // Rows whose prediction has no engine layout (external predictors, rows from before the observation port).
  linesOnly: number
  observationErrors: number
  rejectedStyleRows: number
  environments: Record<string, number>
  metrics: Record<MetricName, Counts>
  reasons: Record<MetricName, Record<string, number>>
  facts: Facts
  // Per gap: rows reporting it, and how many of those fail lineCount or breaks.
  gaps: Partial<Record<GapName, { rows: number; failingLinesOrBreaks: number }>>
  // Engine width minus native extent over compared lines: LayoutUnits in Chrome, app units in Firefox, 1/64 px in WebKit.
  widthDiffs: Record<string, number>
  timingsMs: { native: number; predict: number; observe: number; paint: number; painterObserve: number }
  // Rows whose page couldn't resolve a named family, by family.
  missingFontRows: number
  missingFonts: Record<string, number>
  native: { lineCounts: Record<string, number>; unplacedRects: number }
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
    rows: 0, nativeErrors: 0, predictionErrors: 0, linesOnly: 0, observationErrors: 0, rejectedStyleRows: 0, environments: {},
    metrics: { lineCount: emptyCounts(), breaks: emptyCounts(), widths: emptyCounts(), painter: emptyCounts() },
    reasons: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
    facts: newFacts(), gaps: {}, widthDiffs: {},
    timingsMs: { native: 0, predict: 0, observe: 0, paint: 0, painterObserve: 0 },
    missingFontRows: 0, missingFonts: {},
    native: { lineCounts: {}, unplacedRects: 0 },
    historyDependent: { compared: 0, rows: 0, missing: 0, caseDiffers: 0, geometryOnly: 0, geometryOnlyIds: [], cases: [] },
  }
}

// Per native line, the text of the code points with a rect on it.
function nativeLinesView(row: LabRow, text: string, native: NativeLines | null): string[] | null {
  if (native === null || 'error' in row.native) return null
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
    nativeLines: nativeLinesView(row, text, score.native),
    predictedLines: predictedLinesView(row, text),
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

async function main(): Promise<void> {
  const USAGE = 'Usage: bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>] [--native-compare=<other rows file>]'
  const args = new Map<string, string>()
  for (const raw of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
    if (match === null || !['rows', 'cases', 'out', 'examples', 'per-case', 'native-compare'].includes(match[1]!)) {
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
  const examplesPerMetric = Number(args.get('examples') ?? 5)
  const perCasePath = args.get('per-case')

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

  // --native-compare: the other run's view per case, and a hash of its raw native observation.
  const comparePath = args.get('native-compare')
  let other: Map<string, { caseJson: string; view: NativeView; geometry: bigint | number }> | null = null
  if (comparePath !== undefined) {
    other = new Map()
    for await (const line of readLines(comparePath)) {
      const row = JSON.parse(line) as LabRow
      other.set(compareKey(row.browser, row.id), { caseJson: JSON.stringify(row.case), view: nativeView(row), geometry: Bun.hash(JSON.stringify(row.native)) })
    }
  }

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
    const row = JSON.parse(line) as LabRow
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
    const text = rowText(row.case)
    const score = scoreRow(row)
    const summary = browsers[row.browser] ??= newBrowserSummary()
    if (!seen.has(row.browser)) seen.set(row.browser, new Set())
    seen.get(row.browser)!.add(row.id)
    summary.rows++
    if ('error' in row.native) summary.nativeErrors++
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
    if (!('error' in row.native) && (row.native.missingFonts ?? []).length > 0) {
      summary.missingFontRows++
      for (const family of row.native.missingFonts!) bump(summary.missingFonts, family)
    }
    if (score.native !== null) {
      bump(summary.native.lineCounts, String(score.native.count))
      summary.native.unplacedRects += score.native.unplaced
    }

    let history: string | null = null
    if (other !== null) {
      const hd = summary.historyDependent
      const entry = other.get(compareKey(row.browser, row.id))
      if (entry === undefined) {
        hd.missing++
      } else if (entry.caseJson !== caseJson) {
        hd.caseDiffers++
      } else {
        hd.compared++
        const view = nativeView(row)
        history = nativeDifference(view, entry.view)
        if (history !== null) {
          hd.rows++
          hd.cases.push({ id: row.id, family: row.family, detail: history, text, metrics: score.metrics, nativeLines: nativeLinesView(row, text, score.native) })
        } else if (entry.geometry !== Bun.hash(JSON.stringify(row.native))) {
          hd.geometryOnly++
          if (hd.geometryOnlyIds.length < 20) hd.geometryOnlyIds.push(row.id)
        }
      }
    }
    if (perCaseFd !== null) {
      writeSync(perCaseFd, JSON.stringify({
        id: row.id, family: row.family, browser: row.browser, ...score.metrics,
        ...(score.facts === null ? {} : { facts: compactFacts(score.facts) }),
        gaps: score.gaps,
        ...(history === null ? {} : { historyDependent: history }),
      }) + '\n')
    }
    if (history !== null) continue

    if (score.facts !== null) addFacts(summary.facts, score.facts)
    for (let i = 0; i < score.widthDiffs.length; i++) bump(summary.widthDiffs, String(score.widthDiffs[i]!))
    const failing = score.metrics.lineCount.status === 'fail' || score.metrics.breaks.status === 'fail'
    for (let g = 0; g < score.gaps.length; g++) {
      const entry = summary.gaps[score.gaps[g]!] ??= { rows: 0, failingLinesOrBreaks: 0 }
      entry.rows++
      if (failing) entry.failingLinesOrBreaks++
    }
    const familyCounts = (families[row.family] ??= {})[row.browser] ??= { lineCount: emptyCounts(), breaks: emptyCounts(), widths: emptyCounts(), painter: emptyCounts() }
    const fails = failExamples[row.browser] ??= { lineCount: [], breaks: [], widths: [], painter: [] }
    const unobserved = unobservedExamples[row.browser] ??= { lineCount: [], breaks: [], widths: [], painter: [] }
    for (let k = 0; k < METRICS.length; k++) {
      const name = METRICS[k]!
      const metric = score.metrics[name]
      summary.metrics[name][metric.status]++
      familyCounts[name][metric.status]++
      if (metric.reason !== undefined) bump(summary.reasons[name], `${metric.status}: ${metric.reason}`)
      const bucket = metric.status === 'fail' ? fails[name] : metric.status === 'unobserved' ? unobserved[name] : null
      if (bucket !== null && bucket.length < examplesPerMetric) bucket.push(example(row, text, score, name))
    }
  }
  if (perCaseFd !== null) closeSync(perCaseFd)

  const missingRows: Partial<Record<BrowserKind, number>> = {}
  if (casesById !== null) for (const [browser, ids] of seen) missingRows[browser] = [...casesById.keys()].filter(id => !ids.has(id)).length
  const summary = {
    generatedAt: new Date().toISOString(), scorer: SCORER_VERSION,
    rowsFile: rowsPath, casesFile: casesPath ?? null, nativeCompareFile: comparePath ?? null,
    note: 'unobserved and not-applicable are never passes; widths are compared only on cases whose breaks pass; with --native-compare, history-dependent cases are excluded from the metric counts',
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
