// Offline scorer: compares each row's native Range rects exactly with the rects lab/observe/<engine>.ts expects from the
// row's layout, and derives lineCount, breaks, widths and painter from those comparisons (DESIGN.md §9).
//   bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>]
//     [--native-compare=<other rows file>] [--native-rows=<rows file that observed natively>] [--sealed]
// Imported as a module it runs nothing. It exports the per-row score, the native line grouping and the comparison of two
// runs, so tools use the scorer's own rules instead of copying them.
import { closeSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs'
import type { Expected, ExpectedObservation, ExpectedRect, Gap, GapName } from '../src/model.ts'
import { describeGiven } from './languages.ts'
import { plainRows, readLines } from './rows.ts'
import type { BrowserKind, Case, EnginePrediction, FontDecl, LabRow, LinesPrediction, NativeObservation, PainterLine, Paragraph, Rect, RecordedLayout } from './types.ts'

// Part of every environment key, so rows scored by different scorers never meet in a baseline. Version 1 derived native
// lines and widths from visibility rules; version 2 grouped every rect into native lines by vertical centre; version 3
// placed code point rects by their own node's box (git history of this file, 2026-09-16 and 2026-09-17). Version 4 compares
// Element.getClientRects(), marks slot protocol rows and attributes failing lines to the gaps that concern them. Version 5
// counts a gap as covering a failing line only where its range touches what differs there ("Covered failures"), observes
// the widths of lines Blink and Gecko indented (observedWidth), and matches failing rows against the residual classes.
// Version 6 (ceiling round 4) leaves report-only rects out of the line a lineCount or breaks failure is attributed to
// (reportOnlyRects), doesn't take a WebKit box whose engine width reports as the native width at a moved x for a differing
// unit and gives a WebKit line where only the sum differs its stand-in addends as units (webkitReportedWidth,
// webkitStandInAddends), counts the library's painter limits as explanations of painter failures (LineAttribution.limits),
// and records per case where each gap fires (CaseScore.firing), from which lift is counted over prediction failures alone.
// No metric's status changes between versions 5 and 6.
export const SCORER_VERSION = 6

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

// The text-indent inside a line's engine width, in engine units. Blink's line position starts at the indent
// (`position_ = applied_text_indent_`, line_breaker.cc:877-879) and LineInfo::Width is that position after the last item
// (ComputeLineLocation, line_breaker.cc:1149-1156); Gecko adds mTextIndent to the root span's mICoord (nsLineLayout.cpp:197-199),
// which becomes the line's inline size. No box holds the indent, so the line's rects span the engine width less the indent,
// whichever side the indent is on. WebKit moves the line's rect by the indent before it places content (m_lineMarginStart,
// InlineLineBuilder.cpp:453, :474-476), so its content width starts after the indent and nothing comes off it.
function indentInWidth(layout: RecordedLayout, line: number): number {
  switch (layout.engine) {
    case 'blink': return layout.lines[line]!.geometry.textIndent
    case 'gecko': return layout.lines[line]!.geometry.textIndent
    case 'webkit': return 0
  }
}

// The width a line's rects span when the prediction is right: the engine width less the indent inside it.
function observedWidth(layout: RecordedLayout, line: number): number {
  return engineWidth(layout, line) - indentInWidth(layout, line)
}

function describeWidth(layout: RecordedLayout, line: number): string {
  const indent = indentInWidth(layout, line)
  return indent === 0 ? `width ${engineWidth(layout, line)}` : `width ${engineWidth(layout, line)} less text-indent ${indent}`
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
  // Per failing metric, the failing lines and the gaps that cover them (see "Covered failures" below).
  lineGaps: Partial<Record<MetricName, MetricAttribution>>
  // The residual class whose signature the row has (see "Residual classes"), or null. Absent counts as null.
  residual?: ResidualMembership | null
  // Where the layout's gaps fire (gapFiring); null without an engine layout. Absent counts as null.
  firing?: GapFiring | null
}

// Gap firing. A gap fires on a line box when the line's own gaps hold it, or a paragraph gap with a range meets the line's
// source range (a point at either end included). Per case: its line boxes, and per gap how many of them it fires on. Lift
// is counted from these over prediction failures alone: a gap's share of the failing lines of lineCount, breaks and widths
// failures against its share of the line boxes of cases whose three prediction metrics pass. Painter-only failures (the
// painter fails where the prediction passes) are counted apart, so a browser whose painter fails often doesn't make every
// condition read weak (research/ROUND3-EVALUATION.md, "Weak coverage"; the orchestrator's decision of 2026-09-18).
export type GapFiring = { lines: number; gaps: Partial<Record<GapName, number>> }

function firesOn(layout: RecordedLayout, line: number): GapName[] {
  const value = layout.lines[line]!
  const names: GapName[] = []
  for (let g = 0; g < value.gaps.length; g++) if (!names.includes(value.gaps[g]!.gap)) names.push(value.gaps[g]!.gap)
  for (let g = 0; g < layout.gaps.length; g++) {
    const gap = layout.gaps[g]!
    if (gap.at === undefined || names.includes(gap.gap)) continue
    if (gap.at.start === gap.at.end ? gap.at.start >= value.start && gap.at.start <= value.end : gap.at.start < value.end && gap.at.end > value.start) names.push(gap.gap)
  }
  return names.sort()
}

export function gapFiring(layout: RecordedLayout): GapFiring {
  const out: GapFiring = { lines: 0, gaps: {} }
  for (let l = 0; l < layout.lines.length; l++) {
    if (!layout.lines[l]!.hasLineBox) continue
    out.lines++
    const names = firesOn(layout, l)
    for (let i = 0; i < names.length; i++) out.gaps[names[i]!] = (out.gaps[names[i]!] ?? 0) + 1
  }
  return out
}

// ---- Covered failures ----

// A gap covers a failing line only where its range touches what differs there (research/ROUND2-CRITIC.md item 1). Round 2
// counted every gap that concerned the failing line or the line before it, so a `script-context` range on a quote covered a
// ligature 15 characters away. Two steps per failing line: the gaps that concern it (scorer 4's rule, below), then which of
// those touch the evidence.
//
// The gaps that concern a line, with the source range of each:
// - 'line': a gap in the failing engine line's own `gaps`. Its range is `at`, or the line's whole range without one
//   (src/model.ts: a line gap concerns its line and needs no range); such a gap is marked `unranged`.
// - 'previous-line': a gap in the `gaps` of the line box before it, or of a line without a line box between the two, with
//   `at` or that line's range.
// - 'next-line': a gap in the `gaps` of the line box after it, or of a line without a line box between the two, with `at`
//   or that line's range. Scorer 4 didn't look there. The decision text of a line that the prediction ends early lies on
//   the predicted next line, and a range reported there can reach back into the failing line.
// A gap reported on a neighbouring line ('previous-line', 'next-line') covers only with a range that reaches the evidence.
// A point there is that line's own edge: Blink reports a line's start edge and end edge on the line itself, so
// `unsafe-to-break` at the next line's start says nothing about the U+3000 that ends the failing line
// (`c-45d738663a9704be`). An engine that reports a break's gap only on the line that starts there (Gecko's
// `in-word-prefix` between joined letters in round 2's rows) leaves the line that ends there without it; the gap is then
// listed under `elsewhere` with its scope, which says where it was reported.
// - 'below-floats': a gap of a slot the engine refused between the two lines (`belowFloats`), with `at` or the range of the
//   failing line, the line the refusal moved.
// - 'paragraph-range': a paragraph gap whose `at` range meets the source range of those lines, [previous line start,
//   failing line end], a break offset at either end included; for lineCount and breaks the range reaches to the end of the
//   decision text, which can lie past the predicted line's end.
// A paragraph gap without `at` concerns the paragraph, not a line, and covers nothing; it is listed apart.
//
// The evidence:
// - Differing units: the source ranges on the failing engine line whose observed width differs from the expected one, in
//   engine units (rectUnits), whatever state the port gave the value. In Blink and Gecko a unit is the grapheme cluster
//   (UAX #29, Intl.Segmenter) of a code point whose rect differs: an engine reports a cluster's advance on one of its code
//   points (Gecko gives an RTL letter's advance to the mark after it), so a gap at the letter concerns the mark's rect too.
//   The unit also takes in the code points next to it that report no width on either side (ZWNJ, a collapsed space) or
//   are default ignorable (a soft hyphen, whose rect at a break is the hyphen the engine adds): the letters on both sides
//   of them shape and break as neighbours, so a gap at a break after a soft hyphen concerns the letter before it.
//   Where only a node rect shows the difference (no code point of the node on the line differs), the unit is the node's
//   part of the line.
//   In WebKit a unit is always a node's part of the line: its code point rects are selection rects snapped to whole px
//   (research/observe-webkit.md E3), so they don't say which code point differs. A range whose rect count differs is a unit
//   on each line both sides place it on. A rect the two sides place on different lines is moved text, not a unit. x alone
//   never makes a unit: every rect after a wider one moves, so x doesn't say where the difference is. Element rects make no
//   unit: a box edge or an atomic inline isn't text a gap's range could touch.
// - Runs: differing units that follow each other in source order without a break between them. Widths can move inside a run
//   and add up to the same (Blink reports joined letters' positions as exact where Canvas prefix widths can't give them),
//   and such a run changes neither the line's width nor where it breaks. A run contributes unless its widths add up to the
//   same natively as expected: in Gecko the sum of its rects' widths in app units; in Blink the extent of its rects, since a
//   code point rect's edges are the carets floored and ceiled relative to the item (FragmentItem::LocalRect,
//   fragment_item.cc:1201-1235; LayoutUnit::FromFloatFloor and FromFloatCeil, layout_unit.h:134-142), so widths don't add up
//   and an extent one LayoutUnit off whose left edge also moved is within that rounding. A run holding a node unit, an
//   unknown rect, or any WebKit unit always contributes.
// - The decision text, for lineCount and breaks: the text between the predicted and the native break of the first line
//   that differs, [m, M], from the first to the last code point that one side places on that line and the other doesn't,
//   and out to the predicted break where that lies before them, or after them past code points without width. Without
//   such a code point (a line box only one side has), it is the range of the engine lines after the previous line box up
//   to the failing one.
//
// Which lines are covered, and by which gaps:
// - widths: every run that contributes is touched by some gap (when none contributes, every run); a line without a unit is
//   not covered. A gap touches a run when its range touches one of the run's units: a range must overlap the unit, a point
//   touches the units on both sides of its offset. One touched unit is not enough: a gap at a line edge touches whatever
//   differs there, while the difference that makes the width sits elsewhere (round 2's U+3000 rows end in a U+3000 that
//   `unsafe-to-break` touches). The line before isn't evidence: its break agrees, and what its break carries into the
//   failing line (a reshaped line start, the rest of a split word) shows in the failing line's first units.
// - lineCount and breaks: the units are those of the first line that differs, before the decision text. A node that
//   reaches the decision text holds other text on that line natively than in the prediction, so its rect there says
//   nothing: in Blink and Gecko its code points before the decision text still compare; in WebKit its part of the line
//   before the decision text is a unit, since nothing finer is observed (in a one-node paragraph that is the line up to
//   the break, so there the rule only drops the gaps of other lines and of text after the decision). The run
//   that runs back from m belongs to the decision: the side that broke at m trims, hangs, hyphenates or reshapes what ends
//   its line, so those widths differ because the break does. With no other contributing run the failure is a pure break
//   decision, covered by a gap that touches the decision text (a range must meet [m, M); a point may sit at m or M; the
//   failing line's own gap without a range also counts when the decision text starts where the line ends, since such a
//   gap concerns the line's breaks) or that run. Otherwise observed geometry differs before the decision, and every other
//   contributing run must be touched.
// - The gaps listed as covering a covered line are those that take part: they touch a run that had to be touched, or the
//   decision. The rest, and every gap of a line that isn't covered, are listed under `elsewhere`.
// - painter: scorer 4's rule, every gap that concerns the line ('next-line' apart, which scorer 4 didn't have). Painted
//   rects aren't mapped to source offsets (CHARTER.md, tentpole 7's open item), so nothing says which painted unit differs.
// The scorer checks where a gap's range is, not what its source reading says: whether a condition's reading allows the
// prediction to be wrong at the unit it touches is for whoever reads the row.
//
// Which line fails:
// - lineCount and breaks: the first native line where the prediction and native layout disagree. Line boxes pair with
//   native lines from the top; for every code point, node and element whose native lines and expected lines differ, the
//   lowest line in one set and not the other. With no such difference and other line counts, the first line that only one
//   side has. Later lines follow from it, so only this one is attributed. When the decision text starts before that
//   line (a code point one side splits across two lines makes the second of them the first that differs), the line box
//   that holds the text before the decision text is attributed instead: the line whose end the two sides disagree about.
// - widths and painter: every line whose width or painted extent differs, each on its own.
export type GapScope = 'line' | 'previous-line' | 'next-line' | 'below-floats' | 'paragraph-range'
// What a covering gap's range touches: a differing unit, or the decision text.
export type GapTouch = 'unit' | 'decision'
export type SourceRange = { start: number; end: number }
export type LineEvidence = {
  // Differing units on the line, and how many of them are known only as a node's part of the line; the runs they form,
  // the runs a gap must touch (`deciding`), and how many of those some gap touches; the range of the first deciding run no
  // gap touches (else of the first deciding run, else of the first run) with its text (texts are cut at 40 UTF-16 units).
  units: number
  nodeUnits: number
  runs: number
  deciding: number
  touched: number
  first: SourceRange | null
  firstText?: string
  // lineCount and breaks: the decision text, and whether the units leave the failure a pure break decision.
  decision?: SourceRange
  decisionText?: string
  pureDecision?: boolean
}
export type LineAttribution = {
  // The native line index (the k-th line box from the top), and its engine line; null where the prediction has no k-th
  // line box.
  nativeLine: number
  engineLine: number | null
  // The gaps that cover the line. `touch` is absent on a painter line (every concerning gap counts there); `unranged`
  // marks a line gap without `at`, which has its whole line's range.
  gaps: Array<{ gap: GapName; scope: GapScope; touch?: GapTouch; unranged?: true }>
  // Gaps that concern the line and cover nothing: their range touches nothing that counts (scorer 4 counted them).
  elsewhere?: Array<{ gap: GapName; scope: GapScope }>
  evidence?: LineEvidence
  // Painter lines: the painter limits the library names for the line (src/paint.ts painterLimits, recorded per painted
  // line as EnginePrediction.painterLimits): conditions on the layout, read from engine source, under which a line painted
  // alone can differ. A limit explains a painter failure the way a gap explains a prediction failure. Absent without one,
  // and in rows that recorded no limits.
  limits?: string[]
  // The gaps that fire on the attributed engine line (gapFiring) whether or not they cover it, and the gaps that cover it
  // from a neighbouring line. Absent without an engine line.
  fires?: GapName[]
}
export type MetricAttribution = {
  lines: LineAttribution[]
  // Every failing line has a covering gap; a painter line may have a painter limit instead.
  covered: boolean
  // Paragraph gaps without a range, which cover no line.
  paragraphGaps: GapName[]
}

function paragraphGapNames(layout: RecordedLayout): GapName[] {
  const names: GapName[] = []
  for (let g = 0; g < layout.gaps.length; g++) if (layout.gaps[g]!.at === undefined && !names.includes(layout.gaps[g]!.gap)) names.push(layout.gaps[g]!.gap)
  return names.sort()
}

type Concern = { gap: GapName; scope: GapScope; range: SourceRange; ranged: boolean }

// The gaps that concern native line k, given the engine lines with a line box (boxes, top to bottom). `reach` is the end
// of the decision text, or 0.
function concerningGaps(layout: RecordedLayout, boxes: readonly number[], k: number, reach: number): { engineLine: number | null; concerns: Concern[] } {
  const lines = layout.lines
  const engineLine = k < boxes.length ? boxes[k]! : null
  const previous = k > 0 && k - 1 < boxes.length ? boxes[k - 1]! : -1
  // The engine lines after the previous line box up to and including the failing one (to the end without one).
  const last = engineLine ?? lines.length - 1
  const concerns: Concern[] = []
  const add = (gap: Gap, scope: GapScope, fallback: SourceRange): void => {
    concerns.push({ gap: gap.gap, scope, range: gap.at ?? fallback, ranged: gap.at !== undefined })
  }
  const rangeOf = (l: number): SourceRange => ({ start: lines[l]!.start, end: lines[l]!.end })
  if (engineLine !== null) for (const gap of lines[engineLine]!.gaps) add(gap, 'line', rangeOf(engineLine))
  for (let l = Math.max(previous, 0); l <= last && l < lines.length; l++) {
    if (l === engineLine) continue
    if (l === previous || !lines[l]!.hasLineBox) for (const gap of lines[l]!.gaps) add(gap, 'previous-line', rangeOf(l))
  }
  // The engine lines after the failing one up to and including the next line box.
  if (engineLine !== null) {
    for (let l = engineLine + 1; l < lines.length; l++) {
      for (const gap of lines[l]!.gaps) add(gap, 'next-line', rangeOf(l))
      if (lines[l]!.hasLineBox) break
    }
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
    const textEnd = lines.length === 0 ? 0 : lines[lines.length - 1]!.end
    const moved = engineLine === null ? { start: textEnd, end: textEnd } : rangeOf(engineLine)
    for (const value of layout.belowFloats) {
      if (value.row > previousRow && value.row <= failingRow) for (const gap of value.gaps) add(gap, 'below-floats', moved)
    }
  }
  const start = lines.length === 0 ? 0 : lines[Math.max(previous, 0)]!.start
  const end = Math.max(reach, lines.length === 0 ? 0 : lines[Math.min(last, lines.length - 1)]!.end)
  for (const gap of layout.gaps) {
    const at = gap.at
    if (at === undefined) continue
    if (at.start === at.end ? at.start >= start && at.start <= end : at.start < end && at.end > start) concerns.push({ gap: gap.gap, scope: 'paragraph-range', range: at, ranged: true })
  }
  return { engineLine, concerns }
}

// Whether a gap's range touches a unit: a range must overlap it, a point touches the units on both sides of its offset.
function touchesUnit(range: SourceRange, unit: SourceRange): boolean {
  return range.start === range.end ? range.start >= unit.start && range.start <= unit.end : range.start < unit.end && range.end > unit.start
}

// Whether a gap's range touches the decision text [m, M]: a range must meet [m, M) (or hold the offset when m = M), a
// point may sit at either end.
function touchesDecision(range: SourceRange, decision: SourceRange): boolean {
  if (range.start === range.end) return range.start >= decision.start && range.start <= decision.end
  if (decision.start === decision.end) return range.start <= decision.start && range.end >= decision.start
  return range.start < decision.end && range.end > decision.start
}

// What differs on a failing line: its differing units, and for lineCount and breaks the decision text.
type FailingLineEvidence = { units: readonly Unit[]; decision: SourceRange | null }
// A differing unit with what its rects say, in engine units: the sum of native minus expected widths over the rects that
// differ, and the extent of those rects natively and as expected. NaN where a rect count differs or a rect is off the
// engine's encoding. `node`: known only as a node's part of the line.
type Unit = SourceRange & { node: boolean; sum: number; nativeLeft: number; nativeRight: number; expectedLeft: number; expectedRight: number }
// Units that follow each other in source order without a break between them.
type Run = { start: number; end: number; units: number[]; contributes: boolean }

function runsOf(engine: RecordedLayout['engine'], units: readonly Unit[]): Run[] {
  const order: number[] = []
  for (let u = 0; u < units.length; u++) order.push(u)
  order.sort((a, b) => units[a]!.start - units[b]!.start || units[a]!.end - units[b]!.end)
  const runs: Run[] = []
  for (let i = 0; i < order.length; i++) {
    const unit = units[order[i]!]!
    const run = runs[runs.length - 1]
    if (run !== undefined && unit.start <= run.end) {
      run.end = Math.max(run.end, unit.end)
      run.units.push(order[i]!)
    } else {
      runs.push({ start: unit.start, end: unit.end, units: [order[i]!], contributes: true })
    }
  }
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]!
    let sum = 0
    let node = false
    let nativeLeft = Infinity
    let nativeRight = -Infinity
    let expectedLeft = Infinity
    let expectedRight = -Infinity
    for (let i = 0; i < run.units.length; i++) {
      const unit = units[run.units[i]!]!
      sum += unit.sum
      node ||= unit.node
      nativeLeft = Math.min(nativeLeft, unit.nativeLeft)
      nativeRight = Math.max(nativeRight, unit.nativeRight)
      expectedLeft = Math.min(expectedLeft, unit.expectedLeft)
      expectedRight = Math.max(expectedRight, unit.expectedRight)
    }
    if (node || Number.isNaN(sum)) continue
    switch (engine) {
      case 'gecko':
        // Integer app units: the widths moved inside the run and add up to the same.
        run.contributes = sum !== 0
        break
      case 'blink': {
        // A code point rect's edges are its carets floored and ceiled (see "Covered failures"), so widths don't add up; the
        // run's extent does, within one LayoutUnit when the run's left edge moved.
        const extent = (nativeRight - nativeLeft) - (expectedRight - expectedLeft)
        run.contributes = !(extent === 0 || (Math.abs(extent) === 1 && nativeLeft !== expectedLeft))
        break
      }
      case 'webkit': break
    }
  }
  return runs
}

// The attribution of native line k. Without evidence (a painter line), every gap that concerns the line covers it.
export function lineLocalGaps(layout: RecordedLayout, boxes: readonly number[], k: number, evidence: FailingLineEvidence | null = null): LineAttribution {
  const { engineLine, concerns } = concerningGaps(layout, boxes, k, evidence?.decision?.end ?? 0)
  const order = <T extends { gap: GapName; scope: GapScope }>(a: T, b: T): number => (a.gap < b.gap ? -1 : a.gap > b.gap ? 1 : a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0)
  const gaps: LineAttribution['gaps'] = []
  const add = (value: Concern, touch: GapTouch | undefined): void => {
    const known = gaps.find(other => other.gap === value.gap && other.scope === value.scope)
    if (known === undefined) {
      gaps.push({ gap: value.gap, scope: value.scope, ...(touch === undefined ? {} : { touch }), ...(value.ranged ? {} : { unranged: true as const }) })
    } else {
      // Several gaps of one name and scope: a touched unit says more than the decision text, a range more than a whole line.
      if (touch === 'unit') known.touch = 'unit'
      if (value.ranged) delete known.unranged
    }
  }
  if (evidence === null) {
    // Scorer 4's rule, which didn't look at the next line.
    for (let c = 0; c < concerns.length; c++) if (concerns[c]!.scope !== 'next-line') add(concerns[c]!, undefined)
    return { nativeLine: k, engineLine, gaps: gaps.sort(order) }
  }
  const units = evidence.units
  const runs = runsOf(layout.engine, units)
  // lineCount and breaks: the run that runs back from the decision text belongs to the decision.
  let edgeRun = -1
  if (evidence.decision !== null) {
    for (let r = 0; r < runs.length; r++) if (runs[r]!.start < evidence.decision.start && runs[r]!.end >= evidence.decision.start) edgeRun = r
  }
  // The runs a gap must touch: those that contribute, the edge run apart; every run when none contributes.
  const deciding: number[] = []
  for (let r = 0; r < runs.length; r++) if (r !== edgeRun && runs[r]!.contributes) deciding.push(r)
  if (deciding.length === 0 && evidence.decision === null) for (let r = 0; r < runs.length; r++) deciding.push(r)
  const pureDecision = evidence.decision !== null && deciding.length === 0
  // Per concern, the runs it touches, and whether it touches the decision text.
  const touchedRuns = new Set<number>()
  const touching: Array<{ value: Concern; runs: number[]; decision: boolean }> = []
  for (let c = 0; c < concerns.length; c++) {
    const value = concerns[c]!
    const hit: number[] = []
    // A point reported on a neighbouring line is that line's edge.
    if ((value.scope === 'previous-line' || value.scope === 'next-line') && value.ranged && value.range.start === value.range.end) {
      touching.push({ value, runs: hit, decision: false })
      continue
    }
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!
      for (let i = 0; i < run.units.length; i++) {
        if (!touchesUnit(value.range, units[run.units[i]!]!)) continue
        hit.push(r)
        touchedRuns.add(r)
        break
      }
    }
    // A line gap without a range concerns its line's breaks too: the decision text can start where the line ends.
    const ownBreak = evidence.decision !== null && value.scope === 'line' && !value.ranged && value.range.end === evidence.decision.start
    touching.push({ value, runs: hit, decision: evidence.decision !== null && (ownBreak || touchesDecision(value.range, evidence.decision)) })
  }
  const lineCovered = pureDecision
    ? touching.some(value => value.decision || value.runs.includes(edgeRun))
    : deciding.length > 0 && deciding.every(r => touchedRuns.has(r))
  const elsewhere: NonNullable<LineAttribution['elsewhere']> = []
  for (let c = 0; c < touching.length; c++) {
    const { value, runs: hit, decision } = touching[c]!
    // A gap covers when the line is covered and the gap takes part: it touches a deciding run, or the decision.
    const unit = pureDecision ? hit.includes(edgeRun) : hit.some(r => deciding.includes(r))
    if (lineCovered && (unit || (pureDecision && decision))) add(value, unit ? 'unit' : 'decision')
    else if (!elsewhere.some(other => other.gap === value.gap && other.scope === value.scope)) elsewhere.push({ gap: value.gap, scope: value.scope })
  }
  let nodeUnits = 0
  for (let u = 0; u < units.length; u++) if (units[u]!.node) nodeUnits++
  let touched = 0
  let firstRun = -1
  for (let i = 0; i < deciding.length; i++) {
    if (touchedRuns.has(deciding[i]!)) touched++
    else if (firstRun < 0) firstRun = deciding[i]!
  }
  if (firstRun < 0) firstRun = deciding.length > 0 ? deciding[0]! : runs.length > 0 ? 0 : -1
  const first = firstRun < 0 ? null : { start: runs[firstRun]!.start, end: runs[firstRun]!.end }
  return {
    nativeLine: k, engineLine, gaps: gaps.sort(order), ...(elsewhere.length === 0 ? {} : { elsewhere: elsewhere.sort(order) }),
    evidence: {
      units: units.length, nodeUnits, runs: runs.length, deciding: deciding.length, touched, first,
      ...(evidence.decision === null ? {} : { decision: evidence.decision, pureDecision }),
    },
  }
}

function attribution(layout: RecordedLayout, boxes: readonly number[], failing: readonly number[], text: string, evidence: ((k: number) => FailingLineEvidence) | null): MetricAttribution {
  const lines = failing.map(k => lineLocalGaps(layout, boxes, k, evidence === null ? null : evidence(k)))
  for (let i = 0; i < lines.length; i++) {
    // A gap that covers the line from a neighbouring line fires for it too.
    if (lines[i]!.engineLine !== null) lines[i]!.fires = [...new Set([...firesOn(layout, lines[i]!.engineLine!), ...lines[i]!.gaps.map(gap => gap.gap)])].sort()
    const value = lines[i]!.evidence
    if (value === undefined) continue
    if (value.first !== null) value.firstText = text.slice(value.first.start, Math.min(value.first.end, value.first.start + 40))
    if (value.decision !== undefined) value.decisionText = text.slice(value.decision.start, Math.min(value.decision.end, value.decision.start + 40))
  }
  return { lines, covered: lines.length > 0 && lines.every(line => line.gaps.length > 0), paragraphGaps: paragraphGapNames(layout) }
}

// Rects that report on a line without placing the code point's text there. Two rules of the engines' range geometry make a
// code point report on a line its text isn't on, and each moved the line the scorer attributed (ceiling round 3):
// - Blink reports a line's hyphen item to every range that holds the end of the item before it ("Hyphens. Include if the
//   last end was included", LayoutText::AbsoluteQuadsForRange, layout_text.cc:616-621). The code point after a chosen soft
//   hyphen starts where that item ends, so it reports the hyphen's rect on the hyphen's line beside its own rect on the
//   next line: a rect equal to a positive-width rect the soft hyphen before it reports on the same line is the hyphen's.
//   Where only one side breaks at the soft hyphen, that rect made the line after the hyphen's the first that differs
//   (`c-23e11e5c3a96497d`: U+FFFC, `a`, a soft hyphen, `b`; natively `b` sits on line 1 and reports on lines 0 and 1).
// - WebKit reports a range that starts where a text box ends on that box's line when the next box in box order starts
//   later: "trailing content on the current line" (selectionRectForTextBox, RenderText.cpp:373-380). The rect is a caret at
//   the box's end, with no width. A line's first character gets it on the line before whenever bidi reordering puts
//   another box of its line first, so it depends on the boxes of the character's own line, not on where the line before
//   ends (`c-4bb3746469073e4d`): a zero-width rect on a line above another rect of the same code point is that report.
// The metrics compare every rect as before; only the line a lineCount or breaks failure is attributed to, and its decision
// text, leave these rects out, on the native side and on the expected side alike.
type ReportOnly = { native: boolean[][]; expected: boolean[][] }

function reportOnlyRects(engine: RecordedLayout['engine'], text: string, observation: ExpectedObservation, nativeObservation: NativeObservation, native: NativeLines, nativeLineOf: Int32Array): ReportOnly | null {
  if (engine === 'gecko') return null
  const out: ReportOnly = { native: [], expected: [] }
  type Placed = { line: number; x: number; width: number }
  const mark = (own: Placed[], hyphen: Placed[] | null): boolean[] => {
    const flags: boolean[] = []
    for (let k = 0; k < own.length; k++) {
      const rect = own[k]!
      let reportOnly = false
      if (rect.line >= 0) {
        if (engine === 'blink' && hyphen !== null) {
          for (let h = 0; h < hyphen.length && !reportOnly; h++) reportOnly = hyphen[h]!.width > 0 && hyphen[h]!.line === rect.line && hyphen[h]!.x === rect.x && hyphen[h]!.width === rect.width
        } else if (engine === 'webkit' && rect.width === 0) {
          for (let o = 0; o < own.length && !reportOnly; o++) reportOnly = o !== k && own[o]!.line > rect.line
        }
      }
      flags.push(reportOnly)
    }
    return flags
  }
  const nativeRects = (i: number): Placed[] => nativeObservation.points[i]!.rects.map((rect, k) => ({ line: native.points[i]![k]!, x: rect.x, width: rect.width }))
  const expectedRects = (i: number): Placed[] => observation.codePoints[i]!.rects.map(rect => ({ line: rect.line >= 0 ? nativeLineOf[rect.line]! : -1, x: rect.x.value, width: rect.width.value }))
  for (let i = 0; i < observation.codePoints.length; i++) {
    const afterSoftHyphen = engine === 'blink' && i > 0 && text.charCodeAt(observation.codePoints[i - 1]!.offset) === 0xad && text.charCodeAt(observation.codePoints[i]!.offset) !== 0xad
    out.native.push(mark(nativeRects(i), afterSoftHyphen ? nativeRects(i - 1) : null))
    out.expected.push(mark(expectedRects(i), afterSoftHyphen ? expectedRects(i - 1) : null))
  }
  return out
}

// The native lines of a range's placed rects and the native lines its expected rects map to (see lineDifference for the
// pairing), or null where they can't be compared: the rect counts differ and a native rect sits on no line. Rects marked
// report-only (reportOnlyRects) place nothing.
function lineSets(expected: ExpectedRect[], placed: number[], nativeLineOf: Int32Array, skipNative: readonly boolean[] | null = null, skipExpected: readonly boolean[] | null = null): { native: Set<number>; expected: Set<number> } | null {
  const nativeSet = new Set<number>()
  const expectedSet = new Set<number>()
  const mapped = (rect: ExpectedRect): number => (rect.line >= 0 ? nativeLineOf[rect.line]! : -1)
  if (expected.length === placed.length) {
    for (let k = 0; k < expected.length; k++) {
      if (placed[k]! < 0) continue
      if (skipNative?.[k] !== true) nativeSet.add(placed[k]!)
      if (skipExpected?.[k] !== true && mapped(expected[k]!) >= 0) expectedSet.add(mapped(expected[k]!))
    }
  } else {
    for (let k = 0; k < placed.length; k++) {
      if (placed[k]! < 0) return null
      if (skipNative?.[k] !== true) nativeSet.add(placed[k]!)
    }
    for (let k = 0; k < expected.length; k++) if (skipExpected?.[k] !== true && mapped(expected[k]!) >= 0) expectedSet.add(mapped(expected[k]!))
  }
  return { native: nativeSet, expected: expectedSet }
}

// The lowest native line in one of a range's two line sets and not the other, or Infinity where the sets agree or can't
// be compared.
function divergence(expected: ExpectedRect[], placed: number[], nativeLineOf: Int32Array, skipNative: readonly boolean[] | null = null, skipExpected: readonly boolean[] | null = null): number {
  const sets = lineSets(expected, placed, nativeLineOf, skipNative, skipExpected)
  if (sets === null) return Infinity
  let lowest = Infinity
  for (const line of sets.native) if (!sets.expected.has(line)) lowest = Math.min(lowest, line)
  for (const line of sets.expected) if (!sets.native.has(line)) lowest = Math.min(lowest, line)
  return lowest
}

// An observed rect against the expected one in engine units: native minus expected width, and both rects' edges. WebKit
// compares the float32 width a box reports as it is (in px); Blink and Gecko compare decoded edges, so a Gecko width that
// encodes to other float bits at another x doesn't differ. NaN where a rect is off the engine's encoding.
type RectComparison = { width: number; nativeLeft: number; nativeRight: number; expectedLeft: number; expectedRight: number }

function compareRect(layout: RecordedLayout, line: number, expected: ExpectedRect, observed: Rect): RectComparison {
  if (layout.engine === 'webkit') {
    return { width: observed.width - expected.width.value, nativeLeft: observed.x, nativeRight: observed.x + observed.width, expectedLeft: expected.x.value, expectedRight: expected.x.value + expected.width.value }
  }
  const e = rectUnits(layout, line, { x: expected.x.value, width: expected.width.value })
  const n = rectUnits(layout, line, observed)
  if (e === null || n === null) return { width: NaN, nativeLeft: NaN, nativeRight: NaN, expectedLeft: NaN, expectedRight: NaN }
  return { width: (n.right - n.left) - (e.right - e.left), nativeLeft: n.left, nativeRight: n.right, expectedLeft: e.left, expectedRight: e.right }
}

const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u

// The width WebKit reports for a box of engine width w at x: the box's float rect goes through localToAbsoluteQuad and
// FloatQuad::boundingBox (platform/graphics/FloatQuad.cpp:90-99), the corners' min and max in float, so the width is
// f32(f32(x + w) - x), and one float32 step of x + w coarser than w itself. lab/observe/webkit.ts boundingBox is the port's copy.
function webkitReportedWidth(x: number, width: number): number {
  const right = f32(x + width)
  return f32(Math.max(x, right) - Math.min(x, right))
}

// Per node, the engine widths of its text boxes in box index order, line then visual order, which is the order of the
// node's whole-box rects (InlineIterator::textBoxesFor; lab/observe/webkit.ts `own`). null for other engines.
function webkitBoxWidths(layout: RecordedLayout): number[][] | null {
  if (layout.engine !== 'webkit') return null
  const widths: number[][] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const boxes = layout.lines[l]!.geometry.boxes
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b]!
      if (box.kind !== 'text' && box.kind !== 'soft-line-break') continue
      while (widths.length <= box.run) widths.push([])
      widths[box.run]!.push(box.width)
    }
  }
  return widths
}

// WebKit, a widths line on which no box is shown to differ (every reported width that differs is the predicted engine width
// at a moved x): what differs is the line's float32 sum, Line::contentLogicalWidth, whose addends are the line's runs. A
// reported width settles its box's engine width only to a float32 step of the box's right edge, so an addend the port
// computed from a Canvas stand-in (an expected width in state `limited`) can be a step off without its rect showing it
// (`c-9a66d090891a825d`: the sum of runs shaped across inline boxes is 224.06697px natively and 224.06696px predicted, and
// every box reports the predicted width at its native x). Those addends are the line's units then: the nodes' parts of the
// line whose expected width is limited. A line without one stays without units, and is never covered.
function webkitStandInAddends(layout: RecordedLayout, paragraph: Pick<Paragraph, 'runs'>, observation: ExpectedObservation, line: number): Unit[] {
  const units: Unit[] = []
  if (layout.engine !== 'webkit') return units
  for (let r = 0, start = 0; r < observation.nodes.length; r++) {
    const end = start + paragraph.runs[r]!.text.length
    const rects = observation.nodes[r]!
    for (let k = 0; k < rects.length; k++) {
      if (rects[k]!.line !== line || rects[k]!.width.state !== 'limited') continue
      const s = Math.max(start, layout.lines[line]!.start)
      const e = Math.min(end, layout.lines[line]!.end)
      if (e > s && !units.some(unit => unit.start === s && unit.end === e)) units.push({ start: s, end: e, node: true, sum: NaN, nativeLeft: NaN, nativeRight: NaN, expectedLeft: NaN, expectedRight: NaN })
    }
    start = end
  }
  return units
}

// Per engine line, the differing units (see "Covered failures"). `only` restricts them to one line, the first line that
// differs of a lineCount or breaks failure, and to text before the decision text.
function differingUnits(
  layout: RecordedLayout, paragraph: Pick<Paragraph, 'runs'>, text: string, observation: ExpectedObservation, nativeObservation: NativeObservation,
  native: NativeLines, nativeLineOf: Int32Array, only: { line: number; before: number } | null,
): Unit[][] {
  const lines = layout.lines
  const units: Unit[][] = []
  for (let l = 0; l < lines.length; l++) units.push([])
  // Where grapheme clusters start, found when the first code point differs.
  let clusterStarts: number[] | null = null
  const cluster = (offset: number): SourceRange => {
    if (clusterStarts === null) {
      clusterStarts = []
      for (const segment of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) clusterStarts.push(segment.index)
    }
    let low = 0
    let high = clusterStarts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (clusterStarts[middle]! <= offset) low = middle
      else high = middle - 1
    }
    return { start: clusterStarts[low] ?? 0, end: low + 1 < clusterStarts.length ? clusterStarts[low + 1]! : text.length }
  }
  // Whether the code point at index i is default ignorable, or reports no width natively and in the expected rects.
  const points = observation.codePoints
  const widthless = (i: number): boolean => {
    if (DEFAULT_IGNORABLE.test(text.slice(points[i]!.offset, points[i]!.offset + points[i]!.length))) return true
    const expected = points[i]!.rects
    const observed = nativeObservation.points[i]!.rects
    for (let k = 0; k < expected.length; k++) if (expected[k]!.width.value !== 0) return false
    for (let k = 0; k < observed.length; k++) if (observed[k]!.width !== 0) return false
    return true
  }
  // The index of the first code point at or after an offset.
  const indexAt = (offset: number): number => {
    let low = 0
    let high = points.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (points[middle]!.offset < offset) low = middle + 1
      else high = middle
    }
    return low
  }
  // Whether every code point of a range is widthless. An RTL letter whose mark reports the cluster's advance is not.
  const widthlessRange = (range: SourceRange): boolean => {
    for (let i = indexAt(range.start); i < points.length && points[i]!.offset < range.end; i++) if (!widthless(i)) return false
    return true
  }
  // A grapheme cluster with the widthless clusters on both sides of it.
  const withWidthless = (range: SourceRange): SourceRange => {
    let start = range.start
    let end = range.end
    for (let before = start > 0 ? cluster(start - 1) : null; before !== null && widthlessRange(before); before = start > 0 ? cluster(start - 1) : null) start = before.start
    for (let after = end < text.length ? cluster(end) : null; after !== null && widthlessRange(after); after = end < text.length ? cluster(end) : null) end = after.end
    return { start, end }
  }
  // A node's part of the line, or a code point's unit. Rects of one unit add up.
  const UNKNOWN: RectComparison = { width: NaN, nativeLeft: NaN, nativeRight: NaN, expectedLeft: NaN, expectedRight: NaN }
  const push = (l: number, start: number, end: number, node: boolean, value: RectComparison): void => {
    if (only !== null && l !== only.line) return
    if (only !== null && start >= only.before) return
    const range = node ? null : withWidthless(cluster(start))
    const s = range === null ? Math.max(start, lines[l]!.start) : range.start
    const e = range === null ? Math.min(end, lines[l]!.end) : range.end
    if (e <= s) return
    const list = units[l]!
    const known = list.find(unit => unit.start === s && unit.end === e && unit.node === node)
    if (known === undefined) {
      list.push({ start: s, end: e, node, sum: value.width, nativeLeft: value.nativeLeft, nativeRight: value.nativeRight, expectedLeft: value.expectedLeft, expectedRight: value.expectedRight })
    } else {
      known.sum += value.width
      known.nativeLeft = Math.min(known.nativeLeft, value.nativeLeft)
      known.nativeRight = Math.max(known.nativeRight, value.nativeRight)
      known.expectedLeft = Math.min(known.expectedLeft, value.expectedLeft)
      known.expectedRight = Math.max(known.expectedRight, value.expectedRight)
    }
  }
  // `boxWidths`: for a WebKit node, the engine width of the text box behind each rect (webkitBoxWidths).
  const compare = (expected: ExpectedRect[], observed: Rect[], placed: number[], start: number, end: number, node: boolean, boxWidths: readonly number[] | null = null): void => {
    if (expected.length !== observed.length) {
      // Other rect counts: a unit on each line both sides place the range on; with other lines it is moved text.
      const sets = lineSets(expected, placed, nativeLineOf)
      if (sets === null || sets.native.size !== sets.expected.size) return
      for (const line of sets.native) if (!sets.expected.has(line)) return
      for (let k = 0; k < expected.length; k++) if (expected[k]!.line >= 0 && nativeLineOf[expected[k]!.line]! >= 0) push(expected[k]!.line, start, end, node, UNKNOWN)
      return
    }
    for (let k = 0; k < expected.length; k++) {
      const l = expected[k]!.line
      if (l < 0 || placed[k]! < 0 || nativeLineOf[l] !== placed[k]) continue
      const value = compareRect(layout, l, expected[k]!, observed[k]!)
      if (value.width === 0) continue
      // WebKit reports a box's width through its float corners, f32(f32(x + w) - x) (webkitReportedWidth): where the box's
      // engine width reports as the native width at the native x, the box is as wide as predicted and only its x moved,
      // which is never a unit. What moved it differs elsewhere on the line.
      if (boxWidths !== null && k < boxWidths.length && webkitReportedWidth(observed[k]!.x, boxWidths[k]!) === observed[k]!.width) continue
      push(l, start, end, node, value)
    }
  }
  if (layout.engine !== 'webkit') {
    for (let i = 0; i < observation.codePoints.length; i++) {
      const point = observation.codePoints[i]!
      compare(point.rects, nativeObservation.points[i]!.rects, native.points[i]!, point.offset, point.offset + point.length, false)
    }
  }
  // Nodes: in WebKit every node rect that differs; in Blink and Gecko only where no code point of the node on the line does.
  const pointUnits = units.map(list => list.slice())
  const boxWidths = webkitBoxWidths(layout)
  for (let r = 0, start = 0; r < observation.nodes.length; r++) {
    const end = start + paragraph.runs[r]!.text.length
    const before = units.map(list => list.length)
    if (only === null || end <= only.before) {
      compare(observation.nodes[r]!, nativeObservation.runRects[r]!, native.nodes[r]!, start, end, true, boxWidths === null ? null : boxWidths[r] ?? [])
    } else if (layout.engine === 'webkit' && start < only.before && observation.nodes[r]!.some(rect => rect.line === only.line)) {
      // WebKit's node that reaches the decision text: its part of the line before the decision text. Nothing finer says
      // whether its text there measures as expected, and the node is what differs.
      push(only.line, start, only.before, true, UNKNOWN)
    }
    for (let l = 0; l < units.length; l++) {
      if (units[l]!.length === before[l]) continue
      if (pointUnits[l]!.some(unit => unit.start < end && unit.end > start)) units[l]!.length = before[l]!
    }
    start = end
  }
  return units
}

// The decision text of the first line that differs, native line k, and the native line it is attributed to (see "Covered
// failures").
function decisionText(
  layout: RecordedLayout, boxes: readonly number[], k: number, observation: ExpectedObservation, nativeObservation: NativeObservation, native: NativeLines,
  nativeLineOf: Int32Array, reportOnly: ReportOnly | null,
): { decision: SourceRange; failingLine: number } {
  const lines = layout.lines
  let start = Infinity
  let end = -Infinity
  for (let i = 0; i < observation.codePoints.length; i++) {
    const point = observation.codePoints[i]!
    const sets = lineSets(point.rects, native.points[i]!, nativeLineOf, reportOnly?.native[i] ?? null, reportOnly?.expected[i] ?? null)
    if (sets === null || sets.native.has(k) === sets.expected.has(k)) continue
    start = Math.min(start, point.offset)
    end = Math.max(end, point.offset + point.length)
  }
  if (start === Infinity) {
    // No code point sits on line k on one side only: a line box only one side has.
    if (lines.length === 0) return { decision: { start: 0, end: 0 }, failingLine: k }
    const first = (k > 0 && k - 1 < boxes.length ? boxes[k - 1]! : -1) + 1
    const last = k < boxes.length ? boxes[k]! : lines.length - 1
    const textEnd = lines[lines.length - 1]!.end
    return { decision: first <= last ? { start: lines[first]!.start, end: lines[last]!.end } : { start: textEnd, end: textEnd }, failingLine: k }
  }
  // The line whose end the two sides disagree about. A code point one side splits across two lines makes the second of
  // them the first that differs, while the text sits at the end of the line before: then that line is attributed.
  let failingLine = k
  if (k < boxes.length && start < lines[boxes[k]!]!.start) {
    while (failingLine > 0 && lines[boxes[failingLine]!]!.start >= start) failingLine--
  }
  if (failingLine >= boxes.length) return { decision: { start, end }, failingLine }
  // The predicted break belongs to the decision text. It can come before the first such code point (the code point after
  // it expects an empty rect at the end of the old line too), or after the last one, past code points without width on
  // either side (a collapsed space that natively sits on no line).
  const predictedBreak = lines[boxes[failingLine]!]!.end
  if (predictedBreak < start) {
    start = predictedBreak
  } else if (predictedBreak > end) {
    let widthless = true
    for (let i = 0; i < observation.codePoints.length && widthless; i++) {
      const point = observation.codePoints[i]!
      if (point.offset < end || point.offset >= predictedBreak) continue
      for (let r = 0; r < point.rects.length; r++) if (point.rects[r]!.width.value !== 0) widthless = false
      const observed = nativeObservation.points[i]!.rects
      for (let r = 0; r < observed.length; r++) if (observed[r]!.width !== 0) widthless = false
    }
    if (widthless) end = predictedBreak
  }
  return { decision: { start, end }, failingLine }
}

// ---- Residual classes ----

// A residual class is a failure class that a probe showed to be a Canvas-versus-DOM difference no Canvas measurement
// detects. It is not a gap: it has no Canvas-observable condition, so a layout can't report it and it covers nothing. The
// scorer matches every row that fails lineCount, breaks or widths against the registry by signature, and the summary
// counts the members without a covered explanation apart from open failures (`lineLocal.predictionRows`). A member whose
// differing text a probe measured in the DOM and in Canvas is `probed`; one that only has the signature is `signature`: a
// port bug that moves one node by the same amount has the signature too, so signature-only members stay suspects until
// probed. An entry needs its probe record in the repository or named in a research document, and says whether its
// mechanism is verified (by probe or a source trace that the probe confirms) or inferred.
export type ResidualMembership = { name: string; membership: 'probed' | 'signature'; detail: string }

// A string a probe measured both ways: the first family of the node's font list, its size and weight, the text, and the
// DOM width minus the Canvas width in engine units.
export type ProbedUnit = { family: string; size: number; weights: number[]; text: string; difference: number; probe: string }

// A node rect whose width differs: native minus expected in engine units (Blink LayoutUnits, Gecko app units, WebKit
// 1/64 px, unrounded), the node's text on the rect's engine line, and the text from the first to the last code point of it
// whose own rect width differs there (null in WebKit, or when no code point shows the difference).
export type NodeWidthDifference = { node: number; line: number; difference: number; font: FontDecl; lineText: string; differingText: string | null }

export type ResidualEvidence = {
  engine: RecordedLayout['engine']
  metrics: Record<MetricName, Status>
  // Every node rect whose width differs, or null when a node's rect count differs or a rect is off the engine's encoding.
  nodeWidths: NodeWidthDifference[] | null
  // Whether the painter, which draws the predicted lines with the DOM, drew every line whose width fails at the native
  // width: then the same text measures differently in the DOM than in Canvas, and the line's content isn't what differs.
  // null without a widths failure or without a painted observation of those lines.
  paintedAtNativeWidth: boolean | null
}

export type ResidualClass = {
  name: string
  engine: RecordedLayout['engine']
  description: string
  // Probe evidence: what was measured, in which build, and where the record is.
  probes: string[]
  // What causes the difference, and whether that is verified or inferred from the evidence.
  mechanism: { status: 'verified' | 'inferred'; reading: string }
  // The signature in words; `match` implements it.
  signature: string
  probed: ProbedUnit[]
  match: (evidence: ResidualEvidence, self: ResidualClass) => Omit<ResidualMembership, 'name'> | null
}

function firstFamily(family: string): string {
  return (family.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')
}

// Whether a probe measured the text that differs: a probed unit of the node's font whose text holds the differing text
// (or, when no code point shows the difference, sits in the node's text on the line) and whose difference has the same
// sign and size.
function probedUnitOf(value: NodeWidthDifference, probed: readonly ProbedUnit[]): ProbedUnit | null {
  for (let i = 0; i < probed.length; i++) {
    const unit = probed[i]!
    if (unit.family !== firstFamily(value.font.family) || unit.size !== value.font.size || !unit.weights.includes(value.font.weight) || value.font.style !== 'normal') continue
    if (unit.difference !== value.difference || !value.lineText.includes(unit.text)) continue
    if (value.differingText === null || unit.text.includes(value.differingText)) return unit
  }
  return null
}

export const RESIDUAL_CLASSES: ResidualClass[] = [
  {
    // The one registry: lab/fresh.ts and rebuild/tests/ledger.ts read the per-case `residual` this gives.
    name: 'gecko/one-shaping-unit-one-app-unit',
    engine: 'gecko',
    description: 'One shaping unit is 1 app unit wider or narrower in the DOM than OffscreenCanvas measures it at the CSS font size.',
    probes: [
      'F7, rebuild/probes/gecko-round2.ts (records in .artifacts/probes/gecko/round2; specs/gecko-RESULTS.md "Probes"), Firefox 156 at DPR 2: single shaping units in their own node, DOM box against OffscreenCanvas and canvas elements, all at the CSS font size.',
      'research/ROUND2-CRITIC.md item 4 (probe gecko-device-size, 94 units, Firefox 156 at DPR 2): an OffscreenCanvas at the device font size, halved, equals the DOM in 22 units only, so that recipe is refuted; 12 units differ by exactly 1 au at the CSS size, all in Geeza Pro, Thonburi or Helvetica Neue.',
      'F13, rebuild/probes/gecko-round3.ts (record .artifacts/probes/gecko/round3/firefox-probes.json; specs/gecko-RESULTS.md "Ceiling round 3"), Firefox 156 at DPR 2, 243 units in 15 font lists: a detached <canvas> element at the DOM\'s device font size gives the DOM\'s width on every unit, the ones an OffscreenCanvas at the CSS size measures 1 au off among them.',
    ],
    mechanism: {
      status: 'verified',
      reading: 'The DOM\'s text run shapes at the device font size and rounds each glyph at the page\'s app units per device pixel (gfxHarfBuzzShaper.cpp:1559, :1699-1702); an OffscreenCanvas shapes at the CSS size at 60 app units per px with a font group of its own (CanvasRenderingContext2D.cpp:4423-4492, :7135-7140), so a glyph\'s 16.16 rounding can fall on the other side. Verified by probe F13, where a <canvas> element that runs the DOM\'s arithmetic reproduces every member, and for `modern` by simulation from the font\'s units (the `n` after the kern split is 508.4999 au at the DOM\'s scale and 508.5004 au at Canvas\'s; specs/gecko-RESULTS.md "Ceiling round 3" item 1). The Geeza Pro and Thonburi members weren\'t simulated. The library measures on OffscreenCanvas only (the maintainer\'s decision of 2026-09-18), where no measurement shows the difference, so it stays a residual class.',
    },
    signature: 'lineCount and breaks pass and widths fail; every node has the expected number of rects; exactly one node rect differs in width, by exactly 1 app unit; and the painter drew every failing line at the native width.',
    probed: [
      { family: 'Geeza Pro', size: 10, weights: [300, 400, 500], text: 'ووفقك', difference: 1, probe: 'F7; ROUND2-CRITIC item 4' },
      { family: 'Geeza Pro', size: 10, weights: [300, 400, 500], text: 'وأعانك', difference: 1, probe: 'ROUND2-CRITIC item 4; F13' },
      { family: 'Geeza Pro', size: 10, weights: [300, 400, 500], text: 'وما', difference: 1, probe: 'F13' },
      { family: 'Thonburi', size: 32, weights: [500], text: 'รมชาติทำให้ผู้คนมีคว', difference: 1, probe: 'F7; ROUND2-CRITIC item 4' },
      { family: 'Thonburi', size: 32, weights: [500], text: 'รมชาติทำให้ผู้คนมี', difference: 1, probe: 'ROUND2-CRITIC item 4' },
      { family: 'Thonburi', size: 32, weights: [500], text: 'ทำให้', difference: 1, probe: 'ROUND2-CRITIC item 4' },
      { family: 'Helvetica Neue', size: 15, weights: [400], text: 'modern', difference: -1, probe: 'F7; ROUND2-CRITIC item 4' },
      { family: 'Helvetica Neue', size: 10, weights: [700], text: 'LT:', difference: -1, probe: 'ROUND2-CRITIC item 4' },
      { family: 'Helvetica Neue', size: 10, weights: [700], text: 'LT: kerning pairs', difference: -1, probe: 'ROUND2-CRITIC item 4' },
    ],
    match: (evidence, self) => {
      if (evidence.metrics.lineCount !== 'pass' || evidence.metrics.breaks !== 'pass' || evidence.metrics.widths !== 'fail') return null
      if (evidence.nodeWidths === null || evidence.nodeWidths.length !== 1 || evidence.paintedAtNativeWidth !== true) return null
      const value = evidence.nodeWidths[0]!
      if (Math.abs(value.difference) !== 1) return null
      const unit = probedUnitOf(value, self.probed)
      const where = `node ${value.node} on engine line ${value.line} is ${value.difference > 0 ? '+' : ''}${value.difference} au${value.differingText === null ? '' : ` at ${JSON.stringify(value.differingText)}`}`
      return unit === null ? { membership: 'signature', detail: `${where}; no probe measured this text in this font` } : { membership: 'probed', detail: `${where}; probed ${JSON.stringify(unit.text)} (${unit.probe})` }
    },
  },
]

export function residualMembership(evidence: ResidualEvidence, classes: readonly ResidualClass[] = RESIDUAL_CLASSES): ResidualMembership | null {
  for (let c = 0; c < classes.length; c++) {
    const value = classes[c]!
    if (value.engine !== evidence.engine) continue
    const match = value.match(evidence, value)
    if (match !== null) return { name: value.name, ...match }
  }
  return null
}

// Every node rect whose width differs (ResidualEvidence.nodeWidths). `units` are the row's differing units per engine line.
function nodeWidthDifferences(layout: RecordedLayout, paragraph: Pick<Paragraph, 'runs'>, text: string, observation: ExpectedObservation, nativeObservation: NativeObservation, units: Unit[][]): NodeWidthDifference[] | null {
  const out: NodeWidthDifference[] = []
  for (let r = 0, start = 0; r < observation.nodes.length; r++) {
    const end = start + paragraph.runs[r]!.text.length
    const expected = observation.nodes[r]!
    const observed = nativeObservation.runRects[r]!
    if (expected.length !== observed.length) return null
    for (let k = 0; k < expected.length; k++) {
      const l = expected[k]!.line
      let difference: number
      if (layout.engine === 'webkit') {
        difference = (observed[k]!.width - expected[k]!.width.value) * 64
      } else {
        if (l < 0) {
          if (expected[k]!.width.value !== observed[k]!.width) return null
          continue
        }
        const e = rectUnits(layout, l, { x: expected[k]!.x.value, width: expected[k]!.width.value })
        const n = rectUnits(layout, l, observed[k]!)
        if (e === null || n === null) return null
        difference = (n.right - n.left) - (e.right - e.left)
      }
      if (difference === 0) continue
      const from = l < 0 ? start : Math.max(start, layout.lines[l]!.start)
      const to = l < 0 ? end : Math.max(from, Math.min(end, layout.lines[l]!.end))
      let first = Infinity
      let last = -Infinity
      const onLine = l < 0 ? [] : units[l]!
      for (let u = 0; u < onLine.length; u++) {
        const unit = onLine[u]!
        if (unit.node || unit.start < from || unit.end > to) continue
        first = Math.min(first, unit.start)
        last = Math.max(last, unit.end)
      }
      out.push({ node: r, line: l, difference, font: paragraph.runs[r]!.font, lineText: text.slice(from, to), differingText: first === Infinity ? null : text.slice(first, last) })
    }
    start = end
  }
  return out
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
    // Rects that report on a line without placing text there don't say where the two sides first disagree.
    const reportOnly = reportOnlyRects(layout.engine, text, observation, nativeObservation, native, nativeLineOf)
    let k = Infinity
    for (let i = 0; i < observation.codePoints.length; i++) k = Math.min(k, divergence(observation.codePoints[i]!.rects, native.points[i]!, nativeLineOf, reportOnly?.native[i] ?? null, reportOnly?.expected[i] ?? null))
    for (let r = 0; r < observation.nodes.length; r++) k = Math.min(k, divergence(observation.nodes[r]!, native.nodes[r]!, nativeLineOf))
    for (let e = 0; e < elements.length; e++) k = Math.min(k, divergence(elements[e]!, native.elements[e]!, nativeLineOf))
    if (k === Infinity) k = Math.min(native.count, boxes.length)
    const { decision, failingLine } = decisionText(layout, boxes, k, observation, nativeObservation, native, nativeLineOf, reportOnly)
    const units = failingLine < boxes.length
      ? differingUnits(layout, row.case.paragraph, text, observation, nativeObservation, native, nativeLineOf, { line: boxes[failingLine]!, before: decision.start })[boxes[failingLine]!]!
      : []
    const value = attribution(layout, boxes, [failingLine], text, () => ({ units, decision }))
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
    if (spans(layout, expected, observedWidth(layout, l))) return null
    return { status: 'unobserved', reason: `the port's ${what} on the line don't span the engine width`, detail: `engine line ${l}: ${describeWidth(layout, l)}; expected ${what} span ${describeExtent(expected)}` }
  }

  const widthDiffs: number[] = []
  // For the residual classes: the lines whose width fails with their native extents, and the row's differing units.
  let failingWidthLines: number[] = []
  const nativeExtents: Extent[] = []
  let widthUnits: Unit[][] | null = null
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
      const width = observedWidth(layout, l)
      const extent = extentOf(layout, l, nativeAll[k]!)
      nativeExtents[k] = extent
      const difference = widthDifference(layout, extent, width)
      if (difference !== null) widthDiffs.push(difference)
      if (!spans(layout, extent, width)) {
        failing.push(k)
        if (widths.status === 'pass') {
          const gap = limitedBy[l]!
          widths = { status: 'fail', reason: gap === null ? 'width differs' : 'width differs under a named gap', detail: `engine line ${l}: ${describeWidth(layout, l)}; native ${what} span ${describeExtent(extent)}${gap === null ? '' : `; limited by ${gap}`}` }
        }
      }
    }
    if (widths.status === 'pass' && issue !== null) widths = issue
    if (widths.status === 'fail') {
      const units = differingUnits(layout, row.case.paragraph, text, observation, nativeObservation, native, nativeLineOf, null)
      // A WebKit line where only the sum differs takes its stand-in addends as units (webkitStandInAddends).
      for (let i = 0; i < failing.length; i++) {
        const l = boxes[failing[i]!]!
        if (units[l]!.length === 0) units[l] = webkitStandInAddends(layout, row.case.paragraph, observation, l)
      }
      lineGaps.widths = attribution(layout, boxes, failing, text, k => ({ units: units[boxes[k]!]!, decision: null }))
      failingWidthLines = failing
      widthUnits = units
    }
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
      const width = observedWidth(layout, l)
      const extent = extentOf(layout, l, line.rects)
      if (!spans(layout, extent, width)) {
        failing.push(k)
        if (painter.status === 'pass') painter = { status: 'fail', reason: 'painted extent differs', detail: `engine line ${l}: ${describeWidth(layout, l)}; painted node rects span ${describeExtent(extent)}` }
      }
    }
    if (painter.status === 'pass' && issue !== null) painter = issue
    if (painter.status === 'fail') {
      const value = attribution(layout, boxes, failing, text, null)
      // The library's painter limits, one list per painted line: a failing line one of them names is explained.
      const limits = prediction.painterLimits
      if (Array.isArray(limits) && limits.length === boxes.length) {
        for (let i = 0; i < value.lines.length; i++) {
          const names = [...new Set(limits[value.lines[i]!.nativeLine]!.map(limit => limit.limit))].sort()
          if (names.length > 0) value.lines[i]!.limits = names
        }
        value.covered = value.lines.length > 0 && value.lines.every(line => line.gaps.length > 0 || line.limits !== undefined)
      }
      lineGaps.painter = value
    }
  }
  let residual: ResidualMembership | null = null
  if (lineCount.status === 'fail' || breaks.status === 'fail' || widths.status === 'fail') {
    let paintedAtNativeWidth: boolean | null = null
    if (failingWidthLines.length > 0 && painted !== null && !('error' in painted) && painted.lines.length === boxes.length) {
      paintedAtNativeWidth = true
      for (let i = 0; i < failingWidthLines.length; i++) {
        const k = failingWidthLines[i]!
        const paintedExtent = paintedLineCount(painted.lines[k]!, row.case.paragraph.lineHeight) > 1 ? null : extentOf(layout, boxes[k]!, painted.lines[k]!.rects)
        const nativeExtent = nativeExtents[k]!
        if (paintedExtent === null || paintedExtent.kind !== 'extent' || nativeExtent.kind !== 'extent' || paintedExtent.right - paintedExtent.left !== nativeExtent.right - nativeExtent.left) paintedAtNativeWidth = false
      }
    }
    const units = widthUnits ?? layout.lines.map(() => [])
    residual = residualMembership({
      engine: layout.engine,
      metrics: { lineCount: lineCount.status, breaks: breaks.status, widths: widths.status, painter: painter.status },
      nodeWidths: nodeWidthDifferences(layout, row.case.paragraph, text, observation, nativeObservation, units),
      paintedAtNativeWidth,
    })
  }
  return { metrics: { lineCount, breaks, widths, painter }, facts, firstDifference: first.value, native, gaps, widthDiffs, diagnostics: null, protocol: null, lineGaps, residual, firing: gapFiring(layout) }
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
  // Covered failures (CaseScore.lineGaps), per metric: failing rows; failing rows without a covered explanation (a failing
  // line no gap covers; the name is scorer 4's); of those, rows whose layout reports a paragraph gap without a range, and
  // rows every failing line of which has a gap that concerns it and covers nothing (scorer 4 counted them covered); covered
  // rows with a failing line covered only by line gaps without a range, and only at the decision text; and per gap, the
  // failing rows it covers on some failing line.
  lineLocal: {
    failures: Record<MetricName, number>
    withoutLineGap: Record<MetricName, number>
    withoutLineGapButParagraphGap: Record<MetricName, number>
    withoutLineGapButGapElsewhere: Record<MetricName, number>
    coveredOnlyByUnrangedGap: Record<MetricName, number>
    coveredOnlyAtDecision: Record<MetricName, number>
    byGap: Partial<Record<GapName, Partial<Record<MetricName, number>>>>
    // Rows that fail lineCount, breaks or widths: all of them; those without a covered explanation on some failing
    // prediction metric; of those, members of a residual class, probed and by signature alone; and the rest, the open
    // failures.
    predictionRows: { failing: number; withoutCoveredExplanation: number; residualProbed: number; residualSignatureOnly: number; open: number }
    // Per residual class: members without a covered explanation (counted above), and members a gap covers.
    residual: Record<string, { probed: number; signatureOnly: number; coveredProbed: number; coveredSignatureOnly: number }>
    // Painter failures by what explains them: a gap on every failing line; else a gap or a painter limit on every failing
    // line; else nothing (these are `withoutLineGap.painter`). `byLimit`: failing rows a limit names on some failing line.
    painter: { failures: number; coveredByGap: number; coveredWithLimits: number; withoutExplanation: number; byLimit: Record<string, number> }
    // Gap firing (GapFiring), for lift over prediction failures alone: the line boxes of cases whose lineCount, breaks and
    // widths pass, the failing lines of prediction failures (the engine lines the scorer attributes, once per case), and
    // apart from both the failing lines of painter-only failures; then the same per gap, with the cases it fires in.
    firing: {
      passingCases: number; passingLines: number; failingLines: number; painterOnlyFailingLines: number
      byGap: Partial<Record<GapName, { passingCases: number; passingLines: number; failingLines: number; painterOnlyFailingLines: number }>>
    }
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
      withoutLineGapButParagraphGap: { lineCount: 0, breaks: 0, widths: 0, painter: 0 },
      withoutLineGapButGapElsewhere: { lineCount: 0, breaks: 0, widths: 0, painter: 0 },
      coveredOnlyByUnrangedGap: { lineCount: 0, breaks: 0, widths: 0, painter: 0 }, coveredOnlyAtDecision: { lineCount: 0, breaks: 0, widths: 0, painter: 0 },
      byGap: {},
      predictionRows: { failing: 0, withoutCoveredExplanation: 0, residualProbed: 0, residualSignatureOnly: 0, open: 0 },
      residual: {},
      painter: { failures: 0, coveredByGap: 0, coveredWithLimits: 0, withoutExplanation: 0, byLimit: {} },
      firing: { passingCases: 0, passingLines: 0, failingLines: 0, painterOnlyFailingLines: 0, byGap: {} },
    },
    protocolRows: 0, protocolIds: [],
    timingsMs: { native: 0, predict: 0, observe: 0, paint: 0, painterObserve: 0 },
    missingFontRows: 0, missingFonts: {},
    native: { lineCounts: {}, unplacedRects: 0, pointRectsByCentre: 0 },
    historyDependent: { compared: 0, rows: 0, missing: 0, caseDiffers: 0, geometryOnly: 0, geometryOnlyIds: [], cases: [] },
  }
}

// One scored row's part of the painter and firing counts (BrowserSummary.lineLocal). Protocol rows and rows without an
// engine layout have no firing.
function addFiring(local: BrowserSummary['lineLocal'], score: CaseScore): void {
  const painterAttribution = score.lineGaps.painter
  if (score.metrics.painter.status === 'fail') {
    const value = painterAttribution ?? UNATTRIBUTED
    local.painter.failures++
    if (value.lines.length > 0 && value.lines.every(line => line.gaps.length > 0)) local.painter.coveredByGap++
    else if (value.covered) local.painter.coveredWithLimits++
    else local.painter.withoutExplanation++
    const named = new Set<string>()
    for (const line of value.lines) for (const limit of line.limits ?? []) named.add(limit)
    for (const limit of named) local.painter.byLimit[limit] = (local.painter.byLimit[limit] ?? 0) + 1
  }
  const firing = score.firing ?? null
  if (firing === null) return
  const bucket = (gap: GapName): NonNullable<BrowserSummary['lineLocal']['firing']['byGap'][GapName]> => local.firing.byGap[gap] ??= { passingCases: 0, passingLines: 0, failingLines: 0, painterOnlyFailingLines: 0 }
  const prediction: MetricName[] = ['lineCount', 'breaks', 'widths']
  const failing = prediction.filter(name => score.metrics[name].status === 'fail')
  // The engine lines attributed to the given metrics, once each, with the gaps that fire on them.
  const attributed = (names: readonly MetricName[]): Map<number, GapName[]> => {
    const lines = new Map<number, GapName[]>()
    for (const name of names) for (const line of score.lineGaps[name]?.lines ?? []) if (line.engineLine !== null) lines.set(line.engineLine, line.fires ?? [])
    return lines
  }
  if (failing.length > 0) {
    for (const fires of attributed(failing).values()) {
      local.firing.failingLines++
      for (const gap of fires) bucket(gap).failingLines++
    }
    return
  }
  if (!prediction.every(name => score.metrics[name].status === 'pass')) return
  local.firing.passingCases++
  local.firing.passingLines += firing.lines
  for (const [gap, lines] of Object.entries(firing.gaps) as Array<[GapName, number]>) {
    bucket(gap).passingCases++
    bucket(gap).passingLines += lines
  }
  if (score.metrics.painter.status === 'fail') {
    for (const fires of attributed(['painter']).values()) {
      local.firing.painterOnlyFailingLines++
      for (const gap of fires) bucket(gap).painterOnlyFailingLines++
    }
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
    ...(score.residual === null || score.residual === undefined ? {} : { residual: score.residual }),
    ...(score.protocol === null ? {} : { protocol: score.protocol }),
    nativeLines: nativeLinesView(row, text, score.native),
    predictedLines: predictedLinesView(row, text),
    ...(score.diagnostics === null ? {} : { diagnostics: score.diagnostics }),
    ...(metric === 'painter' && row.painter !== null && !('error' in row.painter)
      ? { painterLines: row.painter.lines.map(line => ({ height: line.height, extent: line.extent, text: line.text })) }
      : {}),
  }
}

// Rows are read through rows.ts, plain or compressed; tools that import readLines from here keep working.
export { readLines }

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
  // Rows are indexed by byte offset, so a compressed file is read from a plain temporary copy (rows.ts plainRows).
  const comparePath = args.get('native-compare')
  let other: Map<string, { caseHash: bigint | number; viewHash: bigint | number; geometry: bigint | number; entry: { offset: number; length: number } }> | null = null
  const comparePlain = comparePath === undefined ? null : plainRows(comparePath)
  const compareFd = comparePlain === null ? null : openSync(comparePlain.path, 'r')
  if (comparePlain !== null) {
    other = new Map()
    const index = await indexRows(comparePlain.path)
    for (const [id, entry] of index) {
      const row = readRowAt(compareFd!, entry)
      other.set(compareKey(row.browser, id), { caseHash: Bun.hash(JSON.stringify(row.case)), viewHash: Bun.hash(JSON.stringify(nativeView(row))), geometry: Bun.hash(JSON.stringify(row.native)), entry })
    }
  }

  // --native-rows: rows from run.ts --predict-only take their native observation from another run's row for the same case
  // (withNativeRow). The scorer refuses rows it can't combine; a row with no native row stays unobserved and makes the
  // scorer exit nonzero.
  const nativeRowsPath = args.get('native-rows')
  const nativePlain = nativeRowsPath === undefined ? null : plainRows(nativeRowsPath)
  const nativeRows = nativePlain === null ? null : { fd: openSync(nativePlain.path, 'r'), index: await indexRows(nativePlain.path) }
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
        ...(score.residual === null || score.residual === undefined ? {} : { residual: score.residual }),
        ...(score.firing === null || score.firing === undefined ? {} : { firing: score.firing }),
        ...(score.protocol === null ? {} : { protocol: score.protocol }),
        ...(history === null ? {} : { historyDependent: history }),
      }) + '\n')
    }
    if (history !== null) continue

    if (score.protocol !== null) {
      summary.protocolRows++
      if (!sealed && summary.protocolIds.length < 200) summary.protocolIds.push(row.id)
    }
    let predictionFails = false
    let predictionUncovered = false
    for (let k = 0; k < METRICS.length; k++) {
      const name = METRICS[k]!
      if (score.metrics[name].status !== 'fail') continue
      const local = summary.lineLocal
      local.failures[name]++
      const value = score.lineGaps[name] ?? UNATTRIBUTED
      if (name !== 'painter') {
        predictionFails = true
        if (!value.covered) predictionUncovered = true
      }
      if (!value.covered) {
        local.withoutLineGap[name]++
        if (value.paragraphGaps.length > 0) local.withoutLineGapButParagraphGap[name]++
        if (value.lines.length > 0 && value.lines.every(line => line.gaps.length > 0 || (line.elsewhere ?? []).some(gap => gap.scope !== 'next-line'))) local.withoutLineGapButGapElsewhere[name]++
      } else {
        if (value.lines.some(line => line.gaps.every(gap => gap.unranged === true))) local.coveredOnlyByUnrangedGap[name]++
        if (value.lines.some(line => line.gaps.every(gap => gap.touch === 'decision'))) local.coveredOnlyAtDecision[name]++
      }
      const covering = new Set<GapName>()
      for (const line of value.lines) for (const gap of line.gaps) covering.add(gap.gap)
      for (const gap of covering) {
        const counts = local.byGap[gap] ??= {}
        counts[name] = (counts[name] ?? 0) + 1
      }
    }
    if (predictionFails) {
      const rows = summary.lineLocal.predictionRows
      const residual = score.residual ?? null
      rows.failing++
      if (predictionUncovered) rows.withoutCoveredExplanation++
      if (residual !== null) {
        const counts = summary.lineLocal.residual[residual.name] ??= { probed: 0, signatureOnly: 0, coveredProbed: 0, coveredSignatureOnly: 0 }
        if (predictionUncovered) {
          if (residual.membership === 'probed') { counts.probed++; rows.residualProbed++ } else { counts.signatureOnly++; rows.residualSignatureOnly++ }
        } else if (residual.membership === 'probed') {
          counts.coveredProbed++
        } else {
          counts.coveredSignatureOnly++
        }
      } else if (predictionUncovered) {
        rows.open++
      }
    }
    addFiring(summary.lineLocal, score)
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
  nativePlain?.release()
  comparePlain?.release()

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
