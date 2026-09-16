// Offline scorer: derives native lines from lab rows and compares them with the predictions.
//   bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>]
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import type { BrowserKind, Case, LabRow, NativeObservation, PainterObservation, Prediction, Rect } from './types.ts'

type Status = 'pass' | 'fail' | 'unobserved' | 'not-applicable'
// `reason` is a fixed category (counted in the summary); `detail` names offsets and values for this case.
type Metric = { status: Status; reason?: string; detail?: string }
type MetricName = 'lineCount' | 'breaks' | 'widths' | 'painter'
const METRICS: MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']

// Layout coordinates: Blink and WebKit LayoutUnit is 1/64px, Gecko app units are 1/60px.
const GRID: Record<BrowserKind, number> = { chrome: 64, safari: 64, firefox: 60, 'webkit-host': 64 }

const INVISIBLE = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]$/u
const WHITE_SPACE = /^\p{White_Space}$/u
const NO_BREAK_SPACE = /^[   ]$/
// Spaces whose hanging per white-space mode is established (CSS Text 3 §4.1.3).
const SPACE_OR_TAB = /^[ \t]$/
// Other space separators: CSS says they hang at line end, but no engine's behaviour is verified here.
const OTHER_SPACE = /^[  -  -  　]$/u
const HANGING_MODES = new Set(['normal', 'nowrap', 'pre-line', 'pre-wrap'])
const NEWLINE_MODES = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces'])
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function positive(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0
}

// Line boxes from rects: sort positive-area rects by vertical centre and start a new line where consecutive centres
// are half a line height or more apart. Every inline box carries the paragraph's px line-height and sits on the line's
// baseline, so centres on different lines are about a line height apart (Safari rounds half-leading per line, Firefox
// sizes a text frame by the fonts it uses), while centres on one line differ only by font metrics.
function clusterCenters(centers: number[], lineHeight: number): { clusterOf: number[]; count: number } {
  const order = centers.map((_, i) => i).sort((a, b) => centers[a]! - centers[b]!)
  const clusterOf: number[] = new Array(centers.length)
  let previous = 0
  let count = 0
  for (let k = 0; k < order.length; k++) {
    const index = order[k]!
    if (count === 0 || centers[index]! - previous >= lineHeight / 2) count++
    previous = centers[index]!
    clusterOf[index] = count - 1
  }
  return { clusterOf, count }
}

// Distance from value to the nearest entry of an ascending array; Infinity when it's empty.
function nearestDistance(sorted: number[], value: number): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (sorted[mid]! < value) low = mid + 1
    else high = mid
  }
  let best = Infinity
  if (low < sorted.length) best = sorted[low]! - value
  if (low > 0) best = Math.min(best, value - sorted[low - 1]!)
  return best
}

type NativeLine = {
  // Source range of the code points with positive rects on this line; start === end for an empty line.
  start: number
  end: number
  // Grapheme start of the first visible code point, and the last visible code point.
  firstVisible: number | null
  lastVisible: number | null
  left: number
  right: number
  // 'nodes': the extent of the whole-node Range rects on the line (no hanging white space has width there).
  // 'code points': the extent of the visible code points' own rects. 'none': no visible code point.
  widthSource: 'nodes' | 'code points' | 'none'
  // Why this line's width isn't established, if it isn't.
  widthIssue: string | null
}

type Derived = {
  lines: NativeLine[]
  // Offsets of visible code points, ascending.
  visible: number[]
  graphemeStart: Int32Array
  lineCountIssue: Metric | null
  breaksIssue: Metric | null
  rectValues: number
  offGridValues: number
  // White-space code points with positive rects on several lines; they belong to no derived line.
  splitWhiteSpace: number
}

function describe(text: string, offset: number | null): string {
  return offset === null ? 'no visible code point' : `${offset} ${JSON.stringify(text.slice(offset, offset + 12))}`
}

function deriveNative(c: Case, native: NativeObservation, text: string, browser: BrowserKind): Derived | { error: string } {
  const p = c.paragraph
  const points = native.points
  const grid = GRID[browser]
  let expected = 0
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const length = text.codePointAt(expected)! > 0xffff ? 2 : 1
    if (point.offset !== expected || point.length !== length) return { error: `Code point observation ${i} is [${point.offset}, +${point.length}); expected [${expected}, +${length})` }
    expected += length
  }
  if (expected !== text.length) return { error: `Observations cover ${expected} of ${text.length} UTF-16 units` }
  const graphemeStart = new Int32Array(text.length + 1)
  for (const { segment, index } of graphemes.segment(text)) for (let k = 0; k < segment.length; k++) graphemeStart[index + k] = index
  graphemeStart[text.length] = text.length

  // Cluster the code points' positive rects and the whole-node rects together; owner -1 marks a node rect.
  const centers: number[] = []
  const owners: number[] = []
  const rects: Rect[] = []
  let rectValues = 0
  let offGridValues = 0
  // Chrome reports a chosen soft hyphen's box twice: as the SHY's own rect and as an extra rect of a neighbouring code
  // point (the letter after it; in RTL the letter before it). An exact copy of a positive SHY rect places nothing else.
  const hyphenBoxes = new Set<string>()
  for (let i = 0; i < points.length; i++) {
    if (text[points[i]!.offset] !== '­') continue
    for (const rect of points[i]!.rects) if (positive(rect)) hyphenBoxes.add(`${rect.x} ${rect.y} ${rect.width} ${rect.height}`)
  }
  for (let i = 0; i < points.length; i++) {
    const list = points[i]!.rects
    const hyphen = text[points[i]!.offset] === '­'
    for (let k = 0; k < list.length; k++) {
      const rect = list[k]!
      if (!positive(rect)) continue
      if (!hyphen && hyphenBoxes.has(`${rect.x} ${rect.y} ${rect.width} ${rect.height}`)) continue
      centers.push(rect.y + rect.height / 2)
      owners.push(i)
      rects.push(rect)
      for (const value of [rect.x, rect.width]) {
        rectValues++
        // Firefox reports app units through float32, so allow that much noise.
        if (Math.abs(value * grid - Math.round(value * grid)) > 1e-3) offGridValues++
      }
    }
  }
  for (let r = 0; r < native.runRects.length; r++) {
    const list = native.runRects[r]!
    for (let k = 0; k < list.length; k++) {
      const rect = list[k]!
      if (!positive(rect)) continue
      centers.push(rect.y + rect.height / 2)
      owners.push(-1)
      rects.push(rect)
    }
  }
  // A line can hold only zero-width content (a ZWSP, joiner or soft hyphen alone on a line at a narrow width), so it
  // has no positive rect. Zero-area rects of code points other than LF establish such a line where they sit half a
  // line height or more from every positive rect. Nearer, they sit on a line positive rects already place (Safari's
  // extra zero-width rect on the previous line, a collapsed space at a line edge).
  const sortedCenters = centers.slice().sort((a, b) => a - b)
  const zeroCenters: number[] = []
  const zeroOwners: number[] = []
  for (let i = 0; i < points.length; i++) {
    if (text[points[i]!.offset] === '\n') continue
    const list = points[i]!.rects
    for (let k = 0; k < list.length; k++) {
      const rect = list[k]!
      if (rect.width !== 0 || !(rect.height > 0)) continue
      const center = rect.y + rect.height / 2
      if (nearestDistance(sortedCenters, center) < p.lineHeight / 2) continue
      zeroCenters.push(center)
      zeroOwners.push(i)
    }
  }
  const positiveLines = clusterCenters(centers, p.lineHeight)
  const zeroLines = clusterCenters(zeroCenters, p.lineHeight)
  // Both kinds of cluster in vertical order; lineOf and zeroLineOf map a cluster to its line index.
  const order: Array<{ y: number; zero: boolean; cluster: number }> = []
  const addClusters = (values: number[], clusterOf: number[], clusters: number, zero: boolean): void => {
    const top: number[] = new Array(clusters).fill(Infinity)
    for (let i = 0; i < values.length; i++) top[clusterOf[i]!] = Math.min(top[clusterOf[i]!]!, values[i]!)
    for (let c = 0; c < clusters; c++) order.push({ y: top[c]!, zero, cluster: c })
  }
  addClusters(centers, positiveLines.clusterOf, positiveLines.count, false)
  addClusters(zeroCenters, zeroLines.clusterOf, zeroLines.count, true)
  order.sort((a, b) => a.y - b.y)
  const lineOf: number[] = new Array(positiveLines.count)
  const zeroLineOf: number[] = new Array(zeroLines.count)
  for (let k = 0; k < order.length; k++) (order[k]!.zero ? zeroLineOf : lineOf)[order[k]!.cluster] = k
  const count = order.length
  const clusterOf = positiveLines.clusterOf.map(c => lineOf[c]!)
  // pointLine: line index, -1 without positive rects, -2 with positive rects on several lines.
  const pointLine: number[] = new Array(points.length).fill(-1)
  const nodeExtent: Array<{ left: number; right: number } | null> = new Array(count).fill(null)
  // touching: per line, the code points with a positive rect on it, including those with rects on several lines. Lines
  // take their source range from these, so a line still counts when its only code point also has a rect elsewhere
  // (Chrome gives the letter after a chosen soft hyphen positive rects on both lines).
  const touching: number[][] = Array.from({ length: count }, () => [])
  for (let r = 0; r < owners.length; r++) {
    const i = owners[r]!
    const line = clusterOf[r]!
    if (i === -1) {
      const rect = rects[r]!
      const extent = nodeExtent[line]!
      nodeExtent[line] = extent === null
        ? { left: rect.x, right: rect.x + rect.width }
        : { left: Math.min(extent.left, rect.x), right: Math.max(extent.right, rect.x + rect.width) }
      continue
    }
    pointLine[i] = pointLine[i] === -1 || pointLine[i] === line ? line : -2
    if (touching[line]![touching[line]!.length - 1] !== i) touching[line]!.push(i)
  }
  for (let r = 0; r < zeroOwners.length; r++) {
    const line = zeroLineOf[zeroLines.clusterOf[r]!]!
    if (touching[line]![touching[line]!.length - 1] !== zeroOwners[r]) touching[line]!.push(zeroOwners[r]!)
  }

  let breaksIssue: Metric | null = null
  let lineCountIssue: Metric | null = null
  const chars = points.map(point => text.slice(point.offset, point.offset + point.length))
  const inked = (ch: string): boolean => !WHITE_SPACE.test(ch) && !INVISIBLE.test(ch)
  let highest = -1
  let splitWhiteSpace = 0
  for (let i = 0; i < points.length; i++) {
    if (!inked(chars[i]!)) {
      if (pointLine[i] === -2 && WHITE_SPACE.test(chars[i]!)) splitWhiteSpace++
      continue
    }
    if (pointLine[i] === -2 && breaksIssue === null) {
      breaksIssue = { status: 'unobserved', reason: 'visible code point has positive rects on several lines', detail: describe(text, points[i]!.offset) }
    }
    if (pointLine[i]! >= 0) {
      if (pointLine[i]! < highest) {
        const issue = { status: 'unobserved' as const, reason: 'visible code points interleave between derived lines', detail: describe(text, points[i]!.offset) }
        breaksIssue ??= issue
        lineCountIssue ??= issue
      }
      highest = Math.max(highest, pointLine[i]!)
    }
  }
  // A grapheme with inked code points must have a positive rect somewhere (a mark inside a cluster may not, and
  // Firefox can give a precomposed base letter zero width and its mark the width).
  if (breaksIssue === null) {
    let index = 0
    for (const { segment, index: start } of graphemes.segment(text)) {
      let hasInk = false
      let hasRect = false
      for (; index < points.length && points[index]!.offset < start + segment.length; index++) {
        hasInk ||= inked(chars[index]!)
        hasRect ||= pointLine[index] !== -1
      }
      if (hasInk && !hasRect) {
        breaksIssue = { status: 'unobserved', reason: 'visible text has no positive rect', detail: describe(text, start) }
        break
      }
    }
  }

  // Per line: its code points in source order, the trailing run of white space and controls, and visible code points.
  const members: number[][] = Array.from({ length: count }, () => [])
  for (let i = 0; i < points.length; i++) if (pointLine[i]! >= 0) members[pointLine[i]!]!.push(i)
  const visibleFlags: boolean[] = new Array(points.length).fill(false)
  const widthIssues: Array<string | null> = new Array(count).fill(null)
  const hangs = HANGING_MODES.has(p.whiteSpace)
  for (let line = 0; line < count; line++) {
    const list = members[line]!
    let trailingStart = list.length
    while (trailingStart > 0) {
      const ch = chars[list[trailingStart - 1]!]!
      if (inked(ch) || NO_BREAK_SPACE.test(ch)) break
      trailingStart--
    }
    for (let k = 0; k < list.length; k++) {
      const i = list[k]!
      const ch = chars[i]!
      const trailing = k >= trailingStart
      if (ch === '­' && trailing) widthIssues[line] ??= 'positive soft hyphen rect at line end; hyphen selection is not established'
      if (INVISIBLE.test(ch) && ch !== '\t') continue
      if (hangs && trailing && SPACE_OR_TAB.test(ch)) continue
      if (hangs && trailing && OTHER_SPACE.test(ch)) {
        widthIssues[line] ??= 'other space separator at line end; hanging is not established'
        continue
      }
      visibleFlags[i] = true
    }
  }

  // Lines in visual order, with empty lines from consecutive preserved newlines (CSS: a trailing newline adds no line).
  const lines: NativeLine[] = []
  const newlines: number[] = []
  if (NEWLINE_MODES.has(p.whiteSpace)) for (let i = 0; i < text.length; i++) if (text[i] === '\n') newlines.push(i)
  let newlineIndex = 0
  let previousEnd = 0
  const pushEmpty = (howMany: number, at: number): void => {
    for (let k = 0; k < howMany; k++) lines.push({ start: at, end: at, firstVisible: null, lastVisible: null, left: 0, right: 0, widthSource: 'none', widthIssue: null })
  }
  for (let line = 0; line < count; line++) {
    const list = touching[line]!.filter(i => chars[i] !== '\n')
    if (list.length === 0) continue
    const start = points[list[0]!]!.offset
    const last = points[list[list.length - 1]!]!
    // Lines must partition the source in order. The interleave check above only covers inked code points; this also
    // catches white space or controls whose rects sit on a line out of source order.
    if (start < previousEnd) breaksIssue ??= { status: 'unobserved', reason: 'derived lines overlap in source order', detail: describe(text, start) }
    let between = 0
    for (; newlineIndex < newlines.length && newlines[newlineIndex]! < start; newlineIndex++) if (newlines[newlineIndex]! >= previousEnd) between++
    pushEmpty(lines.length === 0 ? between : Math.max(0, between - 1), start)
    let firstVisible: number | null = null
    let lastVisible: number | null = null
    let left = Infinity
    let right = -Infinity
    let hangingInk = false
    for (let k = 0; k < list.length; k++) {
      const i = list[k]!
      if (!visibleFlags[i]) {
        hangingInk ||= WHITE_SPACE.test(chars[i]!)
        continue
      }
      firstVisible ??= graphemeStart[points[i]!.offset]!
      lastVisible = points[i]!.offset
      const own = points[i]!.rects
      for (let r = 0; r < own.length; r++) {
        const rect = own[r]!
        if (!positive(rect)) continue
        left = Math.min(left, rect.x)
        right = Math.max(right, rect.x + rect.width)
      }
    }
    let widthIssue = widthIssues[line]!
    let widthSource: NativeLine['widthSource'] = 'none'
    const nodes = nodeExtent[line]!
    if (firstVisible === null) {
      left = 0
      right = 0
    } else if (!hangingInk && nodes !== null) {
      // Everything on the line that isn't visible has zero width, so the whole-node boxes end exactly at the visible
      // edges. Safari snaps partial Range rects to whole px and splits a cluster's advance between a letter and a
      // following invisible control, but reports box edges exactly.
      left = nodes.left
      right = nodes.right
      widthSource = 'nodes'
    } else {
      widthSource = 'code points'
      const startEdge = p.direction === 'ltr' ? left === 0 : right === p.width
      if ((browser === 'safari' || browser === 'webkit-host') && (Number.isInteger(p.direction === 'ltr' ? right : left) || (!startEdge && Number.isInteger(p.direction === 'ltr' ? left : right)))) {
        widthIssue ??= 'Safari snaps partial Range rects to whole CSS px; hanging white space rules out whole-node geometry'
      }
    }
    lines.push({ start, end: last.offset + last.length, firstVisible, lastVisible, left, right, widthSource, widthIssue })
    previousEnd = last.offset + last.length
  }
  let after = 0
  for (; newlineIndex < newlines.length; newlineIndex++) if (newlines[newlineIndex]! >= previousEnd) after++
  pushEmpty(lines.length === 0 ? after : Math.max(0, after - 1), text.length)

  // With one font family, size and language, every line box is one line height (Safari may round fractional heights per
  // line). A span with its own lang can resolve a generic family to another primary font, whose different ascent and
  // descent grow the line box (Chrome: a 16px serif ja paragraph with a ko span at line height 32 is 195px for 6 lines).
  if (lineCountIssue === null && p.runs.every(run => run.font.family === p.font.family && run.font.size === p.font.size && (run.lang === null || run.lang === p.lang))) {
    const tolerance = Number.isInteger(p.lineHeight) ? 0.5 : Math.max(0.5, lines.length)
    if (Math.abs(native.height - lines.length * p.lineHeight) > tolerance) {
      lineCountIssue = { status: 'unobserved', reason: 'paragraph height disagrees with derived lines', detail: `height ${native.height}, ${lines.length} derived lines of ${p.lineHeight}px` }
      breaksIssue ??= lineCountIssue
    }
  }
  const visible: number[] = []
  for (let i = 0; i < points.length; i++) if (visibleFlags[i]) visible.push(points[i]!.offset)
  return { lines, visible, graphemeStart, lineCountIssue, breaksIssue, rectValues, offGridValues, splitWhiteSpace }
}

function predictionProblem(prediction: Prediction, length: number): string | null {
  if (!Array.isArray(prediction.lines)) return 'lines is not an array'
  let previous = 0
  for (let i = 0; i < prediction.lines.length; i++) {
    const line = prediction.lines[i]!
    if (!Number.isInteger(line.start) || !Number.isInteger(line.end) || line.start < previous || line.end < line.start || line.end > length) {
      return `line ${i} range [${line.start}, ${line.end}) is not forward, disjoint and inside the text`
    }
    if (!Number.isFinite(line.width)) return `line ${i} width is not finite`
    previous = line.end
  }
  return null
}

type CaseScore = {
  metrics: Record<MetricName, Metric>
  derived: Derived | null
  widthDiffs: number[]
  painterDiffs: number[]
}

function scoreRow(row: LabRow, text: string): CaseScore {
  const grid = GRID[row.browser]
  const all = (metric: Metric): Record<MetricName, Metric> => ({ lineCount: metric, breaks: metric, widths: metric, painter: metric })
  if ('error' in row.native) return { metrics: all({ status: 'unobserved', reason: 'native observation error', detail: row.native.error }), derived: null, widthDiffs: [], painterDiffs: [] }
  const derived = deriveNative(row.case, row.native, text, row.browser)
  if ('error' in derived) return { metrics: all({ status: 'unobserved', reason: 'malformed native observation', detail: derived.error }), derived: null, widthDiffs: [], painterDiffs: [] }
  const prediction = row.prediction
  if ('error' in prediction) {
    const metric: Metric = { status: 'fail', reason: 'prediction error', detail: prediction.error }
    return { metrics: { ...all(metric), painter: { status: 'not-applicable', reason: 'no prediction' } }, derived, widthDiffs: [], painterDiffs: [] }
  }
  const problem = predictionProblem(prediction, text.length)
  if (problem !== null) {
    const metric: Metric = { status: 'fail', reason: 'invalid prediction', detail: problem }
    return { metrics: all(metric), derived, widthDiffs: [], painterDiffs: [] }
  }
  const native = derived.lines
  const predicted = prediction.lines

  const lineCount: Metric = derived.lineCountIssue ?? (native.length === predicted.length
    ? { status: 'pass' }
    : { status: 'fail', reason: 'line count differs', detail: `native ${native.length}, predicted ${predicted.length}` })

  // The same visible code points, mapped onto the predicted lines.
  const predictedFirst: Array<number | null> = predicted.map(() => null)
  let uncovered: number | null = null
  let splits: number | null = null
  for (let v = 0, j = 0; v < derived.visible.length; v++) {
    const offset = derived.visible[v]!
    while (j < predicted.length && predicted[j]!.end <= offset) j++
    if (j === predicted.length || predicted[j]!.start > offset) {
      uncovered ??= offset
      continue
    }
    if (predictedFirst[j] === null) {
      const start = derived.graphemeStart[offset]!
      predictedFirst[j] = start
      if (predicted[j]!.start > start) splits ??= start
    }
  }
  let breaks: Metric
  if (derived.breaksIssue !== null) {
    breaks = derived.breaksIssue
  } else if (uncovered !== null) {
    breaks = { status: 'fail', reason: 'visible code point outside predicted lines', detail: describe(text, uncovered) }
  } else if (splits !== null) {
    breaks = { status: 'fail', reason: 'predicted line splits a grapheme', detail: describe(text, splits) }
  } else {
    breaks = { status: 'pass' }
    for (let i = 0; i < Math.max(native.length, predicted.length); i++) {
      const nativeFirst = native[i]?.firstVisible ?? null
      const predictedStart = predictedFirst[i] ?? null
      if (i >= native.length || i >= predicted.length || nativeFirst !== predictedStart) {
        breaks = {
          status: 'fail', reason: native.length === predicted.length ? 'first visible code point differs' : 'line count differs',
          detail: `line ${i}: native starts at ${i < native.length ? describe(text, nativeFirst) : '(no line)'}; predicted at ${i < predicted.length ? describe(text, predictedStart) : '(no line)'}`,
        }
        break
      }
    }
  }

  let widths: Metric
  const widthDiffs: number[] = []
  if (breaks.status !== 'pass') {
    widths = { status: 'not-applicable', reason: breaks.status === 'unobserved' ? 'breaks unobserved' : 'breaks differ' }
  } else {
    widths = { status: 'pass' }
    let issue: Metric | null = null
    for (let i = 0; i < native.length; i++) {
      const line = native[i]!
      if (line.widthIssue !== null) {
        issue ??= { status: 'unobserved', reason: line.widthIssue.split(';')[0]!, detail: `line ${i}: ${line.widthIssue}` }
        continue
      }
      const observedUnits = Math.round((line.right - line.left) * grid)
      const predictedUnits = Math.round(predicted[i]!.width * grid)
      const diff = predictedUnits - observedUnits
      widthDiffs.push(diff)
      if (diff !== 0 && widths.status === 'pass') {
        widths = { status: 'fail', reason: 'width differs', detail: `line ${i}: native ${observedUnits / grid}px, predicted ${predicted[i]!.width}px, ${diff} units of 1/${grid}px` }
      }
    }
    if (widths.status === 'pass' && issue !== null) widths = issue
  }

  const painterDiffs: number[] = []
  let painter: Metric
  const painted = row.painter
  if (painted === null) {
    painter = { status: 'not-applicable', reason: 'paint returned null' }
  } else if ('error' in painted) {
    painter = { status: 'fail', reason: 'painter error', detail: painted.error }
  } else if (painted.lines.length !== predicted.length) {
    painter = { status: 'fail', reason: 'painted line count differs', detail: `painted ${painted.lines.length} elements for ${predicted.length} lines` }
  } else {
    painter = { status: 'pass' }
    for (let i = 0; i < painted.lines.length; i++) {
      const line = painted.lines[i]!
      const own = line.rects.filter(positive)
      const { count } = clusterCenters(own.map(rect => rect.y + rect.height / 2), row.case.paragraph.lineHeight)
      if (count > 1) {
        if (painter.status === 'pass') painter = { status: 'fail', reason: 'painted line wraps', detail: `line ${i} painted on ${count} lines (height ${line.height})` }
        continue
      }
      const extentUnits = line.extent === null ? 0 : Math.round((line.extent.right - line.extent.left) * grid)
      const diff = Math.round(predicted[i]!.width * grid) - extentUnits
      painterDiffs.push(diff)
      if (diff !== 0 && painter.status === 'pass') {
        painter = { status: 'fail', reason: 'painted extent differs', detail: `line ${i}: painted ${extentUnits / grid}px, predicted ${predicted[i]!.width}px, ${diff} units of 1/${grid}px` }
      }
    }
  }
  return { metrics: { lineCount, breaks, widths, painter }, derived, widthDiffs, painterDiffs }
}

// ---- Summary ----

type Counts = Record<Status, number>
const emptyCounts = (): Counts => ({ pass: 0, fail: 0, unobserved: 0, 'not-applicable': 0 })
type BrowserSummary = {
  grid: number
  rows: number
  nativeErrors: number
  predictionErrors: number
  rejectedStyleRows: number
  environments: Record<string, number>
  metrics: Record<MetricName, Counts>
  reasons: Record<MetricName, Record<string, number>>
  // Predicted minus observed width, in grid units, over lines whose breaks pass.
  widthDiffUnits: Record<string, number>
  painterDiffUnits: Record<string, number>
  // Positive code point rect x/width values off the layout grid (Chrome reports glyph positions finer than 1/64px).
  rectGrid: { values: number; offGrid: number }
  timingsMs: { native: number; predict: number; paint: number; painterObserve: number }
  // Rows whose page couldn't resolve a named family, by family.
  missingFontRows: number
  missingFonts: Record<string, number>
  // The native derivation alone, whatever the predictor: how many lines, where their widths come from, and why
  // line counts, breaks or line widths are unobserved (counted even when a metric fails for another reason first).
  native: {
    lineCounts: Record<string, number>
    lines: number
    widthSources: Record<NativeLine['widthSource'], number>
    lineCountIssues: Record<string, number>
    breaksIssues: Record<string, number>
    widthIssueLines: Record<string, number>
    splitWhiteSpace: number
  }
}

function newBrowserSummary(browser: BrowserKind): BrowserSummary {
  return {
    grid: GRID[browser], rows: 0, nativeErrors: 0, predictionErrors: 0, rejectedStyleRows: 0, environments: {},
    metrics: { lineCount: emptyCounts(), breaks: emptyCounts(), widths: emptyCounts(), painter: emptyCounts() },
    reasons: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
    widthDiffUnits: {}, painterDiffUnits: {}, rectGrid: { values: 0, offGrid: 0 },
    timingsMs: { native: 0, predict: 0, paint: 0, painterObserve: 0 },
    missingFontRows: 0, missingFonts: {},
    native: {
      lineCounts: {}, lines: 0, widthSources: { nodes: 0, 'code points': 0, none: 0 },
      lineCountIssues: {}, breaksIssues: {}, widthIssueLines: {}, splitWhiteSpace: 0,
    },
  }
}

function example(row: LabRow, text: string, score: CaseScore, metric: MetricName): unknown {
  const p = row.case.paragraph
  const grid = GRID[row.browser]
  const m = score.metrics[metric]
  return {
    id: row.id, family: row.family, browser: row.browser, metric, reason: m.reason, detail: m.detail,
    text,
    paragraph: {
      width: p.width, lineHeight: p.lineHeight, font: `${p.font.style} ${p.font.weight} ${p.font.size}px ${p.font.family}`,
      whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, direction: p.direction, lang: p.lang,
      runs: p.runs.map(run => ({ node: run.node, text: run.text, font: `${run.font.style} ${run.font.weight} ${run.font.size}px ${run.font.family}`, lang: run.lang })),
    },
    pageLang: row.case.pageLang,
    nativeHeight: 'error' in row.native ? null : row.native.height,
    nativeLines: score.derived?.lines.map(line => ({
      text: text.slice(line.start, line.end), firstVisible: line.firstVisible, lastVisible: line.lastVisible,
      width: Math.round((line.right - line.left) * grid) / grid, widthSource: line.widthSource,
      inset: line.firstVisible === null ? null : p.direction === 'rtl' ? p.width - line.right : line.left,
      ...(line.widthIssue === null ? {} : { widthIssue: line.widthIssue }),
    })) ?? null,
    predictedLines: 'error' in row.prediction ? row.prediction : row.prediction.lines.map(line => ({ ...line, text: text.slice(line.start, line.end) })),
    ...(metric === 'painter' && row.painter !== null && !('error' in row.painter)
      ? { painterLines: (row.painter as PainterObservation).lines.map(line => ({ height: line.height, extent: line.extent })) }
      : {}),
  }
}

async function* readLines(path: string): AsyncGenerator<string> {
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

const args = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null || !['rows', 'cases', 'out', 'examples', 'per-case'].includes(match[1]!)) {
    console.error(`Unknown argument ${raw}. Usage: bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>]`)
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

const browsers: Partial<Record<BrowserKind, BrowserSummary>> = {}
const families: Record<string, Partial<Record<BrowserKind, Record<MetricName, Counts>>>> = {}
const failExamples: Partial<Record<BrowserKind, Record<MetricName, unknown[]>>> = {}
const unobservedExamples: Partial<Record<BrowserKind, Record<MetricName, unknown[]>>> = {}
const seen = new Map<BrowserKind, Set<string>>()
let skippedRows = 0
let mismatchedCases = 0
const perCaseFd = perCasePath === undefined ? null : openSync(perCasePath, 'w')

for await (const line of readLines(rowsPath)) {
  const row = JSON.parse(line) as LabRow
  if (casesById !== null) {
    const expected = casesById.get(row.id)
    if (expected === undefined) {
      skippedRows++
      continue
    }
    if (expected !== JSON.stringify(row.case)) {
      mismatchedCases++
      continue
    }
  }
  const text = row.case.paragraph.runs.map(run => run.text).join('')
  const score = scoreRow(row, text)
  const summary = browsers[row.browser] ??= newBrowserSummary(row.browser)
  if (!seen.has(row.browser)) seen.set(row.browser, new Set())
  seen.get(row.browser)!.add(row.id)
  summary.rows++
  if ('error' in row.native) summary.nativeErrors++
  else if (row.native.rejectedStyles.length > 0) summary.rejectedStyleRows++
  if ('error' in row.prediction) summary.predictionErrors++
  const envKey = `DPR ${row.env.devicePixelRatio}, scale ${row.env.visualViewportScale}, ${row.env.userAgent}`
  summary.environments[envKey] = (summary.environments[envKey] ?? 0) + 1
  summary.timingsMs.native += row.timings.nativeMs
  summary.timingsMs.predict += row.timings.predictMs
  summary.timingsMs.paint += row.timings.paintMs
  summary.timingsMs.painterObserve += row.timings.painterObserveMs
  if (!('error' in row.native) && (row.native.missingFonts ?? []).length > 0) {
    summary.missingFontRows++
    for (const family of row.native.missingFonts!) summary.missingFonts[family] = (summary.missingFonts[family] ?? 0) + 1
  }
  if (score.derived !== null) {
    const derived = score.derived
    summary.rectGrid.values += derived.rectValues
    summary.rectGrid.offGrid += derived.offGridValues
    const native = summary.native
    const bump = (counts: Record<string, number>, key: string): void => { counts[key] = (counts[key] ?? 0) + 1 }
    bump(native.lineCounts, String(derived.lines.length))
    native.lines += derived.lines.length
    native.splitWhiteSpace += derived.splitWhiteSpace
    if (derived.lineCountIssue !== null) bump(native.lineCountIssues, derived.lineCountIssue.reason ?? '')
    if (derived.breaksIssue !== null) bump(native.breaksIssues, derived.breaksIssue.reason ?? '')
    for (let i = 0; i < derived.lines.length; i++) {
      const line = derived.lines[i]!
      native.widthSources[line.widthSource]++
      if (line.widthIssue !== null) bump(native.widthIssueLines, line.widthIssue.split(';')[0]!)
    }
  }
  for (let i = 0; i < score.widthDiffs.length; i++) summary.widthDiffUnits[score.widthDiffs[i]!] = (summary.widthDiffUnits[score.widthDiffs[i]!] ?? 0) + 1
  for (let i = 0; i < score.painterDiffs.length; i++) summary.painterDiffUnits[score.painterDiffs[i]!] = (summary.painterDiffUnits[score.painterDiffs[i]!] ?? 0) + 1
  const familyCounts = (families[row.family] ??= {})[row.browser] ??= { lineCount: emptyCounts(), breaks: emptyCounts(), widths: emptyCounts(), painter: emptyCounts() }
  const fails = failExamples[row.browser] ??= { lineCount: [], breaks: [], widths: [], painter: [] }
  const unobserved = unobservedExamples[row.browser] ??= { lineCount: [], breaks: [], widths: [], painter: [] }
  for (let k = 0; k < METRICS.length; k++) {
    const name = METRICS[k]!
    const metric = score.metrics[name]
    summary.metrics[name][metric.status]++
    familyCounts[name][metric.status]++
    if (metric.reason !== undefined) {
      const key = `${metric.status}: ${metric.reason}`
      summary.reasons[name][key] = (summary.reasons[name][key] ?? 0) + 1
    }
    const bucket = metric.status === 'fail' ? fails[name] : metric.status === 'unobserved' ? unobserved[name] : null
    if (bucket !== null && bucket.length < examplesPerMetric) bucket.push(example(row, text, score, name))
  }
  if (perCaseFd !== null) {
    writeSync(perCaseFd, JSON.stringify({ id: row.id, family: row.family, browser: row.browser, ...score.metrics }) + '\n')
  }
}
if (perCaseFd !== null) closeSync(perCaseFd)

const missingRows: Partial<Record<BrowserKind, number>> = {}
if (casesById !== null) for (const [browser, ids] of seen) missingRows[browser] = [...casesById.keys()].filter(id => !ids.has(id)).length
const summary = {
  generatedAt: new Date().toISOString(),
  rowsFile: rowsPath, casesFile: casesPath ?? null,
  note: 'unobserved and not-applicable are never passes; widths are compared only on cases whose breaks pass',
  skippedRows, mismatchedCases, missingRows,
  browsers, families, failExamples, unobservedExamples,
}
writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n')
for (const [browser, s] of Object.entries(browsers)) {
  const line = METRICS.map(name => `${name} ${s.metrics[name].pass}/${s.metrics[name].fail}/${s.metrics[name].unobserved}/${s.metrics[name]['not-applicable']}`).join(' | ')
  console.log(`${browser}: ${s.rows} rows; pass/fail/unobserved/n-a: ${line}`)
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
