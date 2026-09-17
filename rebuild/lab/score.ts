// Offline scorer: derives native lines from lab rows and compares them with the predictions.
//   bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>]
//     [--native-compare=<other rows file>] [--native-rows=<rows file that observed natively>]
// Imported as a module it runs nothing. It exports the derivation, the per-row score and the comparison of two runs, so
// tools use the scorer's own rules instead of copying them.
import { closeSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs'
import type { BrowserKind, Case, CodePointObservation, LabRow, NativeObservation, PainterLine, PainterObservation, Paragraph, Prediction, PredictionLine, Rect } from './types.ts'

export type Status = 'pass' | 'fail' | 'unobserved' | 'not-applicable'
// `reason` is a fixed category (counted in the summary); `detail` names offsets and values for this case.
export type Metric = { status: Status; reason?: string; detail?: string }
export type MetricName = 'lineCount' | 'breaks' | 'widths' | 'painter'
export const METRICS: MetricName[] = ['lineCount', 'breaks', 'widths', 'painter']

// The layout grid, in units per CSS px, for a row's browser and devicePixelRatio:
// - Blink: a LayoutUnit is 1/64 of a zoomed px and client rects divide by the layout zoom, so 1/(64 × DPR) CSS px
//   (1/128 at DPR 2; specs/blink-gaps.md §6.4).
// - WebKit: LayoutUnit is 1/64 CSS px at any DPR (specs/webkit-lines.md §1.6).
// - Gecko: app units, 60 per CSS px at any DPR, without device-pixel snapping (specs/probes-firefox.md, CRITIC C8).
export function layoutGrid(browser: BrowserKind, dpr: number): number {
  switch (browser) {
    case 'chrome': return 64 * dpr
    case 'safari':
    case 'webkit-host': return 64
    case 'firefox': return 60
  }
}

// WebKit keeps inline positions as float32 CSS px, not LayoutUnits (specs/webkit-lines.md §1.4; 892 of 1,314 Safari smoke
// widths are off the 1/64 grid), so snapping both sides to 1/64 can hide or invent a difference. A line's end edge is the
// float32 sum of its start edge and its width, so compare that exactly: the start edge is the left edge of an LTR line
// and the right edge of an RTL one.
function usesFloat32Positions(browser: BrowserKind): boolean {
  switch (browser) {
    case 'safari':
    case 'webkit-host': return true
    case 'chrome':
    case 'firefox': return false
  }
}

function float32EdgesMatch(left: number, right: number, width: number, direction: 'ltr' | 'rtl'): boolean {
  switch (direction) {
    case 'ltr': return Math.fround(left + Math.fround(width)) === right
    case 'rtl': return Math.fround(right - Math.fround(width)) === left
  }
}

// Whether value is a multiple of 1/grid px, allowing `steps` float32 steps at `magnitude`: Safari and Firefox compute
// rect positions in float32 (Firefox reports x = 17150 au as 285.83331298828125, one step from the nearest float32).
function onGrid(value: number, grid: number, magnitude: number, steps: number): boolean {
  const scaled = value * grid
  const step = magnitude > 0 ? 2 ** (Math.floor(Math.log2(magnitude)) - 23) : 0
  return Math.abs(scaled - Math.round(scaled)) <= Math.max(1e-3, steps * step * grid)
}

const INVISIBLE = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]$/u
const WHITE_SPACE = /^\p{White_Space}$/u
const NO_BREAK_SPACE = /^[   ]$/
// Spaces whose hanging per white-space mode is established (CSS Text 3 §4.1.3).
const SPACE_OR_TAB = /^[ \t]$/
// Other space separators: CSS says they hang at line end, but no engine's behaviour is verified here.
const OTHER_SPACE = /^[  -  -  　]$/u
// Controls other than TAB, LF and CR. The engines keep them as characters, so white space before one isn't at the line's
// end: Firefox keeps the space of `aaaa ` + VT in the line's width (specs/probes-firefox.md, CRITIC W3).
const OTHER_CONTROL = /^[\0-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]$/
const TRAILING_WHITE_SPACE = /\p{White_Space}[\p{White_Space}\p{Cf}]*$/u
const HANGING_MODES = new Set(['normal', 'nowrap', 'pre-line', 'pre-wrap'])
const NEWLINE_MODES = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces'])
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function positive(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0
}

function inked(ch: string): boolean {
  return !WHITE_SPACE.test(ch) && !INVISIBLE.test(ch)
}

// The grapheme start of each UTF-16 offset, and text.length at text.length.
function graphemeStarts(text: string): Int32Array {
  const starts = new Int32Array(text.length + 1)
  for (const { segment, index } of graphemes.segment(text)) for (let k = 0; k < segment.length; k++) starts[index + k] = index
  starts[text.length] = text.length
  return starts
}

// Whether each code point carries its grapheme's ink: an inked code point does, and so does any other code point that
// isn't white space in a grapheme with an inked code point. The engines put a cluster's advance on whichever code point
// they like: Firefox gives an emoji + VS16 cluster's advance to the VS16 and a letter + ZWNJ's to the ZWNJ, with a
// zero-width base. Controls, line and paragraph separators, ZWSP and soft hyphens always form graphemes of their own.
function carriesInk(points: CodePointObservation[], chars: string[], graphemeStart: Int32Array): boolean[] {
  const ink: boolean[] = new Array(points.length).fill(false)
  for (let first = 0; first < points.length;) {
    const start = graphemeStart[points[first]!.offset]!
    let end = first
    let hasInk = false
    for (; end < points.length && graphemeStart[points[end]!.offset] === start; end++) hasInk ||= inked(chars[end]!)
    for (let k = first; k < end; k++) ink[k] = hasInk && !WHITE_SPACE.test(chars[k]!)
    first = end
  }
  return ink
}

export function rowText(c: Case): string {
  return c.paragraph.runs.map(run => run.text).join('')
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

export type NativeLine = {
  // Source range of the code points with positive rects on this line; start === end for an empty line.
  start: number
  end: number
  // Cluster start (Derived.clusterStart) of the first visible code point, and the last visible code point.
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

export type Derived = {
  lines: NativeLine[]
  // Offsets of visible code points, ascending.
  visible: number[]
  // The grapheme start of each UTF-16 offset under the lab's segmenter (Intl.Segmenter over the whole paragraph), and
  // the cluster start: the grapheme start, or a later start where native layout put the grapheme on several lines.
  graphemeStart: Int32Array
  clusterStart: Int32Array
  lineCountIssue: Metric | null
  breaksIssue: Metric | null
  // The row's layout grid (units per CSS px).
  grid: number
  rectValues: number
  offGridValues: number
  // Indices of lines with a visible code point whose width (right − left) isn't on the grid.
  offGridWidths: number[]
  // White-space code points with positive rects on several lines; they belong to no derived line.
  splitWhiteSpace: number
}

function describe(text: string, offset: number | null): string {
  return offset === null ? 'no visible code point' : `${offset} ${JSON.stringify(text.slice(offset, offset + 12))}`
}

// Marks the visible code points of one line; `list` holds the line's code points with positive rects, in source order,
// and `ink` says which code points carry their grapheme's ink. A visible code point carries ink, is a control other than
// TAB, LF and CR, or is white space other than hanging white space: SPACE or TAB in the line's trailing run under a mode
// where it hangs. CSS Text 3 renders such a control as a visible glyph, and a positive rect is its advance: Safari draws
// U+001C with Arial's 12px .notdef, Chrome U+009D 16px wide, Firefox U+0000 1px wide, each inside the text node's box.
// Where an engine gives a control no advance its rects have zero width, so it isn't in `list`. The trailing run is the
// white space and invisible code points at the line's end, back to a code point with ink, a no-break space or such a
// control. Returns why the line's width isn't established, if it isn't.
function markVisible(list: number[], chars: string[], ink: boolean[], hangs: boolean, visible: boolean[]): string | null {
  let trailingStart = list.length
  while (trailingStart > 0) {
    const i = list[trailingStart - 1]!
    if (ink[i] || NO_BREAK_SPACE.test(chars[i]!) || OTHER_CONTROL.test(chars[i]!)) break
    trailingStart--
  }
  let issue: string | null = null
  for (let k = 0; k < list.length; k++) {
    const i = list[k]!
    const ch = chars[i]!
    const trailing = k >= trailingStart
    if (ch === '­' && trailing) issue ??= 'positive soft hyphen rect at line end; hyphen selection is not established'
    if (INVISIBLE.test(ch) && ch !== '\t' && !ink[i] && !OTHER_CONTROL.test(ch)) continue
    if (hangs && trailing && SPACE_OR_TAB.test(ch)) continue
    if (hangs && trailing && OTHER_SPACE.test(ch)) {
      issue ??= 'other space separator at line end; hanging is not established'
      continue
    }
    visible[i] = true
  }
  return issue
}

type Extent = { left: number; right: number; source: NativeLine['widthSource']; issue: string | null }

// A whole-node rect's right edge. WebKit keeps a box's x and width as float32 and adds them in float32
// (FloatRect::maxX); their float64 sum can fall between float32 values, where no float32 prediction equals it.
function boxRight(rect: Rect, browser: BrowserKind): number {
  return usesFloat32Positions(browser) ? Math.fround(rect.x + rect.width) : rect.x + rect.width
}

// The union of a line's whole-node rects (positive ones), or source 'none' without any.
function boxesExtent(boxes: Rect[], browser: BrowserKind): Extent {
  if (boxes.length === 0) return { left: 0, right: 0, source: 'none', issue: null }
  let left = Infinity
  let right = -Infinity
  for (let b = 0; b < boxes.length; b++) {
    left = Math.min(left, boxes[b]!.x)
    right = Math.max(right, boxRight(boxes[b]!, browser))
  }
  return { left, right, source: 'nodes', issue: null }
}

// Safari reports a code point Range edge unsnapped only where it is a text box's edge: an edge inside a box snaps outward
// to whole CSS px, and a box's right end is floored to 1/64px (190.296875 where the box ends at 190.3046875). So an
// extent edge from code point rects is taken from the whole-node rect of the box that ends at the edge code point: the
// one box on the line whose edge equals the reported edge or, for a right edge that isn't a whole px, whose right end
// floors to it. A whole-px edge that no box edge equals may be a snapped edge inside a box, with white space after it.
function boxEdge(boxes: Rect[], edge: number, side: 'left' | 'right'): number | null {
  let found: number | null = null
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!
    const value = side === 'left' ? box.x : Math.fround(box.x + box.width)
    if (value !== edge && (side === 'left' || Number.isInteger(edge) || Math.floor(value * 64) / 64 !== edge)) continue
    if (found !== null) return null
    found = value
  }
  return found
}

// A line's horizontal extent over its visible code points; `list` holds the code points with positive rects on the line,
// `boxes` the positive whole-node rects on it. When no white space outside the visible set has a positive rect,
// everything on the line that isn't visible has zero width, so the whole-node boxes (`nodes`, their union) end exactly
// at the visible edges. Safari snaps partial Range rects and splits a cluster's advance between a letter and a following
// invisible control, but reports box edges exactly. Otherwise the extent comes from the visible code points' own rects,
// and in Safari each edge other than the line's start at the content edge comes from a box (boxEdge) or the width is
// unobserved.
function lineExtent(list: number[], chars: string[], rectsOf: (i: number) => Rect[], visible: boolean[],
  boxes: Rect[], p: Paragraph, browser: BrowserKind): Extent {
  let any = false
  let left = Infinity
  let right = -Infinity
  let hangingInk = false
  for (let k = 0; k < list.length; k++) {
    const i = list[k]!
    if (!visible[i]) {
      hangingInk ||= WHITE_SPACE.test(chars[i]!)
      continue
    }
    any = true
    const own = rectsOf(i)
    for (let r = 0; r < own.length; r++) {
      const rect = own[r]!
      if (!positive(rect)) continue
      left = Math.min(left, rect.x)
      right = Math.max(right, rect.x + rect.width)
    }
  }
  if (!any) return { left: 0, right: 0, source: 'none', issue: null }
  if (!hangingInk && boxes.length > 0) return boxesExtent(boxes, browser)
  if (!usesFloat32Positions(browser)) return { left, right, source: 'code points', issue: null }
  const boxLeft = p.direction === 'ltr' && left === 0 ? left : boxEdge(boxes, left, 'left')
  const boxRightEdge = p.direction === 'rtl' && right === p.width ? right : boxEdge(boxes, right, 'right')
  if (boxLeft !== null && boxRightEdge !== null) return { left: boxLeft, right: boxRightEdge, source: 'code points', issue: null }
  const issue = Number.isInteger(boxLeft === null ? left : right)
    ? 'Safari snaps partial Range rects to whole CSS px; hanging white space rules out whole-node geometry'
    : 'Safari floors a text box end in Range rects to 1/64px; no whole-node rect ends at the edge code point'
  return { left, right, source: 'code points', issue }
}

export function deriveNative(c: Case, native: NativeObservation, text: string, browser: BrowserKind, dpr: number): Derived | { error: string } {
  const p = c.paragraph
  const points = native.points
  const grid = layoutGrid(browser, dpr)
  let expected = 0
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const length = text.codePointAt(expected)! > 0xffff ? 2 : 1
    if (point.offset !== expected || point.length !== length) return { error: `Code point observation ${i} is [${point.offset}, +${point.length}); expected [${expected}, +${length})` }
    expected += length
  }
  if (expected !== text.length) return { error: `Observations cover ${expected} of ${text.length} UTF-16 units` }
  const graphemeStart = graphemeStarts(text)
  const chars = points.map(point => text.slice(point.offset, point.offset + point.length))
  const ink = carriesInk(points, chars, graphemeStart)

  // Cluster the code points' positive rects and the whole-node rects together; owner -1 marks a node rect.
  const centers: number[] = []
  const owners: number[] = []
  const rects: Rect[] = []
  const placed: boolean[] = new Array(points.length).fill(false)
  let rectValues = 0
  let offGridValues = 0
  // Chrome reports a chosen soft hyphen's box twice: as the SHY's own rect and as an extra rect of a neighbouring code
  // point (the letter after it; in RTL the letter before it). An exact copy of a positive SHY rect places nothing else.
  const hyphenBoxes = new Set<string>()
  for (let i = 0; i < points.length; i++) {
    if (chars[i] !== '­') continue
    for (const rect of points[i]!.rects) if (positive(rect)) hyphenBoxes.add(`${rect.x} ${rect.y} ${rect.width} ${rect.height}`)
  }
  for (let i = 0; i < points.length; i++) {
    const list = points[i]!.rects
    const hyphen = chars[i] === '­'
    for (let k = 0; k < list.length; k++) {
      const rect = list[k]!
      if (!positive(rect)) continue
      if (!hyphen && hyphenBoxes.has(`${rect.x} ${rect.y} ${rect.width} ${rect.height}`)) continue
      centers.push(rect.y + rect.height / 2)
      owners.push(i)
      rects.push(rect)
      placed[i] = true
      const magnitude = Math.max(Math.abs(rect.x), Math.abs(rect.x + rect.width))
      for (const value of [rect.x, rect.width]) {
        rectValues++
        if (!onGrid(value, grid, magnitude, 2)) offGridValues++
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
  // has no positive rect. A zero-area rect establishes such a line where it sits half a line height or more from every
  // positive rect, but only for a code point that no positive rect places and that isn't SPACE, TAB or LF. Positive rects
  // place a code point that has them, and collapsed white space can't make a line: WebKit reports the collapsed space
  // after an inline box end (`</span> foo`) as a zero-width rect on the next line (specs/probes-safari.md). Nearer
  // rects place nothing (Safari's extra zero-width rect on the previous line, a collapsed space at a line edge).
  const sortedCenters = centers.slice().sort((a, b) => a - b)
  const zeroCenters: number[] = []
  const zeroOwners: number[] = []
  for (let i = 0; i < points.length; i++) {
    if (placed[i] || chars[i] === '\n' || SPACE_OR_TAB.test(chars[i]!)) continue
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
  const nodeBoxes: Rect[][] = Array.from({ length: count }, () => [])
  // touching: per line, the code points with a positive rect on it, including those with rects on several lines. Lines
  // take their source range from these, so a line still counts when its only code point also has a rect elsewhere
  // (Chrome gives the letter after a chosen soft hyphen positive rects on both lines).
  const touching: number[][] = Array.from({ length: count }, () => [])
  for (let r = 0; r < owners.length; r++) {
    const i = owners[r]!
    const line = clusterOf[r]!
    if (i === -1) {
      nodeBoxes[line]!.push(rects[r]!)
      continue
    }
    pointLine[i] = pointLine[i] === -1 || pointLine[i] === line ? line : -2
    if (touching[line]![touching[line]!.length - 1] !== i) touching[line]!.push(i)
  }
  for (let r = 0; r < zeroOwners.length; r++) {
    const line = zeroLineOf[zeroLines.clusterOf[r]!]!
    if (touching[line]![touching[line]!.length - 1] !== zeroOwners[r]) touching[line]!.push(zeroOwners[r]!)
  }

  // Clusters as native layout drew them. The lab's segmenter sees the whole paragraph, and the engines segment less:
  // WebKit and Firefox never form a cluster across a text node edge (`nai` + span `̈ve` breaks between `i` and U+0308),
  // and Blink's break-all table breaks between two Thai characters inside a grapheme (`ท` | `ู`). So a code point with
  // positive rects on one line starts a cluster when an earlier code point of its grapheme has them on another line.
  // Code points without positive rects (a zero-width base or virama) follow the cluster before them.
  const clusterStart = graphemeStart.slice()
  for (let i = 0, grapheme = -1, start = 0, line = -1; i < points.length; i++) {
    const point = points[i]!
    if (graphemeStart[point.offset] !== grapheme) {
      grapheme = graphemeStart[point.offset]!
      start = grapheme
      line = -1
    }
    if (pointLine[i]! >= 0) {
      if (line >= 0 && pointLine[i] !== line) start = point.offset
      line = pointLine[i]!
    }
    for (let k = 0; k < point.length; k++) clusterStart[point.offset + k] = start
  }

  let breaksIssue: Metric | null = null
  let lineCountIssue: Metric | null = null
  let highest = -1
  let splitWhiteSpace = 0
  for (let i = 0; i < points.length; i++) {
    if (!ink[i]) {
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

  // Per line: its code points in source order (those with positive rects on it alone), and which are visible.
  const members: number[][] = Array.from({ length: count }, () => [])
  for (let i = 0; i < points.length; i++) if (pointLine[i]! >= 0) members[pointLine[i]!]!.push(i)
  const visibleFlags: boolean[] = new Array(points.length).fill(false)
  const widthIssues: Array<string | null> = new Array(count).fill(null)
  const hangs = HANGING_MODES.has(p.whiteSpace)
  for (let line = 0; line < count; line++) widthIssues[line] = markVisible(members[line]!, chars, ink, hangs, visibleFlags)

  // Lines in visual order, with empty lines from consecutive preserved newlines (CSS: a trailing newline adds no line).
  const lines: NativeLine[] = []
  const offGridWidths: number[] = []
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
    for (let k = 0; k < list.length; k++) {
      const i = list[k]!
      if (!visibleFlags[i]) continue
      firstVisible ??= clusterStart[points[i]!.offset]!
      lastVisible = points[i]!.offset
    }
    const extent = lineExtent(list, chars, i => points[i]!.rects, visibleFlags, nodeBoxes[line]!, p, browser)
    if (extent.source !== 'none' && !onGrid(extent.right - extent.left, grid, Math.max(Math.abs(extent.left), Math.abs(extent.right)), 4)) offGridWidths.push(lines.length)
    lines.push({ start, end: last.offset + last.length, firstVisible, lastVisible, left: extent.left, right: extent.right, widthSource: extent.source, widthIssue: widthIssues[line] ?? extent.issue })
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
  return { lines, visible, graphemeStart, clusterStart, lineCountIssue, breaksIssue, grid, rectValues, offGridValues, offGridWidths, splitWhiteSpace }
}

// A painted line's extent under the widths metric's rule: over its visible code points, without trimmed or hanging
// white space, from its whole-node rects wherever no excluded white space has width. Rows from before the page recorded
// painted code points carry only whole-node rects; those give the extent unless the predicted line ends in white space.
function paintedExtent(line: PainterLine, p: Paragraph, browser: BrowserKind, text: string, predicted: PredictionLine): Extent {
  const boxes = line.rects.filter(positive)
  if (line.points === undefined || line.text === undefined) {
    if (TRAILING_WHITE_SPACE.test(text.slice(predicted.start, predicted.end))) {
      return { left: 0, right: 0, source: 'none', issue: 'painter row has no code point rects; the line ends in white space' }
    }
    return boxesExtent(boxes, browser)
  }
  const painted = line.text
  const points = line.points
  const chars = points.map(point => painted.slice(point.offset, point.offset + point.length))
  // As for native lines: the code points with positive rects, without LF.
  const list: number[] = []
  for (let i = 0; i < points.length; i++) if (chars[i] !== '\n' && points[i]!.rects.some(positive)) list.push(i)
  const visible: boolean[] = new Array(points.length).fill(false)
  const issue = markVisible(list, chars, carriesInk(points, chars, graphemeStarts(painted)), HANGING_MODES.has(p.whiteSpace), visible)
  const extent = lineExtent(list, chars, i => points[i]!.rects, visible, boxes, p, browser)
  return { ...extent, issue: issue ?? extent.issue }
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

export type CaseScore = {
  metrics: Record<MetricName, Metric>
  derived: Derived | null
  widthDiffs: number[]
  painterDiffs: number[]
}

export function scoreRow(row: LabRow, text: string = rowText(row.case)): CaseScore {
  const grid = layoutGrid(row.browser, row.env.devicePixelRatio)
  const all = (metric: Metric): Record<MetricName, Metric> => ({ lineCount: metric, breaks: metric, widths: metric, painter: metric })
  if ('error' in row.native) return { metrics: all({ status: 'unobserved', reason: 'native observation error', detail: row.native.error }), derived: null, widthDiffs: [], painterDiffs: [] }
  if ('skipped' in row.native) return { metrics: all({ status: 'unobserved', reason: 'native observation skipped', detail: row.native.skipped }), derived: null, widthDiffs: [], painterDiffs: [] }
  const derived = deriveNative(row.case, row.native, text, row.browser, row.env.devicePixelRatio)
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
      const start = derived.clusterStart[offset]!
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
      const matches = usesFloat32Positions(row.browser)
        ? float32EdgesMatch(line.left, line.right, predicted[i]!.width, row.case.paragraph.direction)
        : diff === 0
      if (!matches && widths.status === 'pass') {
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
    let issue: Metric | null = null
    for (let i = 0; i < painted.lines.length; i++) {
      const line = painted.lines[i]!
      const own = line.rects.filter(positive)
      const { count } = clusterCenters(own.map(rect => rect.y + rect.height / 2), row.case.paragraph.lineHeight)
      if (count > 1) {
        if (painter.status === 'pass') painter = { status: 'fail', reason: 'painted line wraps', detail: `line ${i} painted on ${count} lines (height ${line.height})` }
        continue
      }
      const extent = paintedExtent(line, row.case.paragraph, row.browser, text, predicted[i]!)
      if (extent.issue !== null) {
        issue ??= { status: 'unobserved', reason: extent.issue.split(';')[0]!, detail: `line ${i}: ${extent.issue}` }
        continue
      }
      const extentUnits = Math.round((extent.right - extent.left) * grid)
      const diff = Math.round(predicted[i]!.width * grid) - extentUnits
      painterDiffs.push(diff)
      const matches = usesFloat32Positions(row.browser)
        ? float32EdgesMatch(extent.left, extent.right, predicted[i]!.width, row.case.paragraph.direction)
        : diff === 0
      if (!matches && painter.status === 'pass') {
        painter = { status: 'fail', reason: 'painted extent differs', detail: `line ${i}: painted ${extentUnits / grid}px, predicted ${predicted[i]!.width}px, ${diff} units of 1/${grid}px` }
      }
    }
    if (painter.status === 'pass' && issue !== null) painter = issue
  }
  return { metrics: { lineCount, breaks, widths, painter }, derived, widthDiffs, painterDiffs }
}

// ---- Comparing two runs ----

// What a comparison of two runs of the same case looks at: the derived lines, the widths as scored (grid units) and the
// derivation's unobserved reasons.
export type NativeView = {
  error: string | null
  grid: number
  lineCountIssue: string | null
  breaksIssue: string | null
  lines: Array<{ start: number; end: number; firstVisible: number | null; lastVisible: number | null; widthUnits: number; widthSource: NativeLine['widthSource']; widthIssue: string | null }>
}

function viewOf(derived: Derived | { error: string }, grid: number): NativeView {
  if ('error' in derived) return { error: derived.error, grid, lineCountIssue: null, breaksIssue: null, lines: [] }
  return {
    error: null, grid,
    lineCountIssue: derived.lineCountIssue?.reason ?? null,
    breaksIssue: derived.breaksIssue?.reason ?? null,
    lines: derived.lines.map(line => ({
      start: line.start, end: line.end, firstVisible: line.firstVisible, lastVisible: line.lastVisible,
      widthUnits: Math.round((line.right - line.left) * grid), widthSource: line.widthSource, widthIssue: line.widthIssue,
    })),
  }
}

export function nativeView(row: LabRow, text: string = rowText(row.case)): NativeView {
  const grid = layoutGrid(row.browser, row.env.devicePixelRatio)
  if ('error' in row.native) return viewOf({ error: row.native.error }, grid)
  if ('skipped' in row.native) return viewOf({ error: `native observation skipped: ${row.native.skipped}` }, grid)
  return viewOf(deriveNative(row.case, row.native, text, row.browser, row.env.devicePixelRatio), grid)
}

// The first difference between two runs' native derivations of one case, or null when they agree. Two observation
// errors agree (their messages carry stacks).
export function nativeDifference(a: NativeView, b: NativeView): string | null {
  if (a.error !== null || b.error !== null) return a.error !== null && b.error !== null ? null : `native observation error in one run: ${a.error ?? b.error}`
  if (a.lineCountIssue !== b.lineCountIssue) return `line count issue: ${a.lineCountIssue ?? 'none'} vs ${b.lineCountIssue ?? 'none'}`
  if (a.breaksIssue !== b.breaksIssue) return `breaks issue: ${a.breaksIssue ?? 'none'} vs ${b.breaksIssue ?? 'none'}`
  if (a.lines.length !== b.lines.length) return `${a.lines.length} derived lines vs ${b.lines.length}`
  for (let i = 0; i < a.lines.length; i++) {
    const x = a.lines[i]!
    const y = b.lines[i]!
    if (x.start !== y.start || x.end !== y.end || x.firstVisible !== y.firstVisible || x.lastVisible !== y.lastVisible) {
      return `line ${i}: [${x.start}, ${x.end}) first visible ${x.firstVisible} vs [${y.start}, ${y.end}) first visible ${y.firstVisible}`
    }
    if (x.widthSource !== y.widthSource || x.widthIssue !== y.widthIssue) return `line ${i}: width from ${x.widthSource} (${x.widthIssue ?? 'observed'}) vs ${y.widthSource} (${y.widthIssue ?? 'observed'})`
    if (x.widthIssue === null && (x.widthUnits !== y.widthUnits || a.grid !== b.grid)) return `line ${i}: width ${x.widthUnits / a.grid}px vs ${y.widthUnits / b.grid}px`
  }
  return null
}

// ---- Summary ----

type Counts = Record<Status, number>
const emptyCounts = (): Counts => ({ pass: 0, fail: 0, unobserved: 0, 'not-applicable': 0 })
type BrowserSummary = {
  // The first row's layout grid; `grids` counts rows per grid when the DPR varies.
  grid: number
  grids: Record<string, number>
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
  // Positive code point rect x/width values off the layout grid, beyond float32 rounding.
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
    // Lines with a visible code point, how many of their observed widths are off the layout grid, and examples.
    widthGrid: { lines: number; offGrid: number; bySource: Record<string, number>; examples: unknown[] }
  }
  // With --native-compare: rows of this run compared with the other run's row for the same case, and the cases whose
  // derived lines, widths or unobserved reasons differ. Those are left out of every count above that scores the
  // prediction (metrics, reasons, histograms, families, examples) and listed here.
  historyDependent: {
    compared: number
    rows: number
    // No row for the case in the other run, or a row that observed a different version of the case.
    missing: number
    caseDiffers: number
    // Same derivation, different raw geometry (float noise in positions that don't change lines or scored widths).
    geometryOnly: number
    geometryOnlyIds: string[]
    cases: unknown[]
  }
}

function newBrowserSummary(grid: number): BrowserSummary {
  return {
    grid, grids: {}, rows: 0, nativeErrors: 0, predictionErrors: 0, rejectedStyleRows: 0, environments: {},
    metrics: { lineCount: emptyCounts(), breaks: emptyCounts(), widths: emptyCounts(), painter: emptyCounts() },
    reasons: { lineCount: {}, breaks: {}, widths: {}, painter: {} },
    widthDiffUnits: {}, painterDiffUnits: {}, rectGrid: { values: 0, offGrid: 0 },
    timingsMs: { native: 0, predict: 0, paint: 0, painterObserve: 0 },
    missingFontRows: 0, missingFonts: {},
    native: {
      lineCounts: {}, lines: 0, widthSources: { nodes: 0, 'code points': 0, none: 0 },
      lineCountIssues: {}, breaksIssues: {}, widthIssueLines: {}, splitWhiteSpace: 0,
      widthGrid: { lines: 0, offGrid: 0, bySource: {}, examples: [] },
    },
    historyDependent: { compared: 0, rows: 0, missing: 0, caseDiffers: 0, geometryOnly: 0, geometryOnlyIds: [], cases: [] },
  }
}

function nativeLinesView(row: LabRow, text: string, derived: Derived | null): unknown {
  const p = row.case.paragraph
  return derived?.lines.map(line => ({
    text: text.slice(line.start, line.end), firstVisible: line.firstVisible, lastVisible: line.lastVisible,
    width: Math.round((line.right - line.left) * derived.grid) / derived.grid, widthSource: line.widthSource,
    inset: line.firstVisible === null ? null : p.direction === 'rtl' ? p.width - line.right : line.left,
    ...(line.widthIssue === null ? {} : { widthIssue: line.widthIssue }),
  })) ?? null
}

function example(row: LabRow, text: string, score: CaseScore, metric: MetricName): unknown {
  const p = row.case.paragraph
  const m = score.metrics[metric]
  const prediction = row.prediction
  return {
    id: row.id, family: row.family, browser: row.browser, metric, reason: m.reason, detail: m.detail,
    text,
    paragraph: {
      width: p.width, lineHeight: p.lineHeight, font: `${p.font.style} ${p.font.weight} ${p.font.size}px ${p.font.family}`,
      whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, direction: p.direction, lang: p.lang,
      runs: p.runs.map(run => ({ node: run.node, text: run.text, font: `${run.font.style} ${run.font.weight} ${run.font.size}px ${run.font.family}`, lang: run.lang })),
    },
    pageLang: row.case.pageLang,
    nativeHeight: 'error' in row.native || 'skipped' in row.native ? null : row.native.height,
    nativeLines: nativeLinesView(row, text, score.derived),
    predictedLines: 'error' in prediction ? prediction : prediction.lines.map(line => ({ ...line, text: text.slice(line.start, line.end) })),
    ...(metric === 'painter' && row.painter !== null && !('error' in row.painter) && !('error' in prediction)
      ? {
        painterLines: (row.painter as PainterObservation).lines.map((line, i) => {
          const scored = i < prediction.lines.length ? paintedExtent(line, p, row.browser, text, prediction.lines[i]!) : null
          return { height: line.height, extent: line.extent, text: line.text, scoredExtent: scored }
        }),
      }
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

// ---- Native observations from another run ----

// Where each row of a rows file sits: its UTF-8 byte offset and length, by case id.
export type RowIndex = Map<string, { offset: number; length: number }>

// Indexes a rows file by case id without parsing the rows. run.ts writes every row as JSON that starts with
// `{"id":"<id>"`; a line that doesn't is parsed whole to find its id. Throws on a row without an id or a duplicate id.
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
// different cases, or their environments differ: browser, user agent, devicePixelRatio, visual viewport scale, page
// language or fixture fonts.
export function withNativeRow(row: LabRow, other: LabRow): LabRow | { error: string } {
  if (!('skipped' in row.native)) return { error: `row ${row.id} has its own native observation; --native-rows takes rows from run.ts --predict-only` }
  if ('skipped' in other.native) return { error: `the native row for ${row.id} has no native observation either` }
  if (other.id !== row.id || JSON.stringify(other.case) !== JSON.stringify(row.case)) return { error: `the native row for ${row.id} observed a different case` }
  const differences: string[] = []
  const compare = (name: string, a: unknown, b: unknown): void => {
    if (a !== b) differences.push(`${name} ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  }
  compare('browser', row.browser, other.browser)
  compare('userAgent', row.env.userAgent, other.env.userAgent)
  compare('devicePixelRatio', row.env.devicePixelRatio, other.env.devicePixelRatio)
  compare('visualViewportScale', row.env.visualViewportScale, other.env.visualViewportScale)
  compare('pageLang', row.env.pageLang, other.env.pageLang)
  compare('fontFixtures', row.env.fontFixtures.join('|'), other.env.fontFixtures.join('|'))
  if (differences.length > 0) return { error: `the environments differ for ${row.id}: ${differences.join('; ')}` }
  return { ...row, env: other.env, native: other.native, timings: { ...row.timings, nativeMs: other.timings.nativeMs } }
}

// webkit-host runs installed Safari's engine, so its rows compare with Safari's.
function compareKey(browser: BrowserKind, id: string): string {
  return `${browser === 'webkit-host' ? 'safari' : browser}\n${id}`
}

async function main(): Promise<void> {
  const USAGE = 'Usage: bun rebuild/lab/score.ts --rows=<file> [--cases=<file>] --out=<summary.json> [--examples=K] [--per-case=<file>] [--native-compare=<other rows file>] [--native-rows=<rows file that observed natively>]'
  const args = new Map<string, string>()
  for (const raw of process.argv.slice(2)) {
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

  // --native-compare: the other run's derivation per case, and a hash of its raw native observation.
  const comparePath = args.get('native-compare')
  let other: Map<string, { caseJson: string; view: NativeView; geometry: bigint | number }> | null = null
  if (comparePath !== undefined) {
    other = new Map()
    for await (const line of readLines(comparePath)) {
      const row = JSON.parse(line) as LabRow
      other.set(compareKey(row.browser, row.id), { caseJson: JSON.stringify(row.case), view: nativeView(row), geometry: Bun.hash(JSON.stringify(row.native)) })
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
    const score = scoreRow(row, text)
    const grid = layoutGrid(row.browser, row.env.devicePixelRatio)
    const summary = browsers[row.browser] ??= newBrowserSummary(grid)
    if (!seen.has(row.browser)) seen.set(row.browser, new Set())
    seen.get(row.browser)!.add(row.id)
    summary.rows++
    bump(summary.grids, String(grid))
    if ('error' in row.native) summary.nativeErrors++
    else if (!('skipped' in row.native) && row.native.rejectedStyles.length > 0) summary.rejectedStyleRows++
    if ('error' in row.prediction) summary.predictionErrors++
    bump(summary.environments, `DPR ${row.env.devicePixelRatio}, scale ${row.env.visualViewportScale}, ${row.env.userAgent}`)
    summary.timingsMs.native += row.timings.nativeMs
    summary.timingsMs.predict += row.timings.predictMs
    summary.timingsMs.paint += row.timings.paintMs
    summary.timingsMs.painterObserve += row.timings.painterObserveMs
    if (!('error' in row.native) && !('skipped' in row.native) && (row.native.missingFonts ?? []).length > 0) {
      summary.missingFontRows++
      for (const family of row.native.missingFonts!) bump(summary.missingFonts, family)
    }
    if (score.derived !== null) {
      const derived = score.derived
      summary.rectGrid.values += derived.rectValues
      summary.rectGrid.offGrid += derived.offGridValues
      const native = summary.native
      bump(native.lineCounts, String(derived.lines.length))
      native.lines += derived.lines.length
      native.splitWhiteSpace += derived.splitWhiteSpace
      if (derived.lineCountIssue !== null) bump(native.lineCountIssues, derived.lineCountIssue.reason ?? '')
      if (derived.breaksIssue !== null) bump(native.breaksIssues, derived.breaksIssue.reason ?? '')
      for (let i = 0; i < derived.lines.length; i++) {
        const nativeLine = derived.lines[i]!
        native.widthSources[nativeLine.widthSource]++
        if (nativeLine.widthIssue !== null) bump(native.widthIssueLines, nativeLine.widthIssue.split(';')[0]!)
        if (nativeLine.widthSource !== 'none') native.widthGrid.lines++
      }
      for (let k = 0; k < derived.offGridWidths.length; k++) {
        const nativeLine = derived.lines[derived.offGridWidths[k]!]!
        native.widthGrid.offGrid++
        bump(native.widthGrid.bySource, nativeLine.widthSource)
        if (native.widthGrid.examples.length < examplesPerMetric) {
          const width = nativeLine.right - nativeLine.left
          native.widthGrid.examples.push({ id: row.id, line: derived.offGridWidths[k], text: text.slice(nativeLine.start, nativeLine.end), widthSource: nativeLine.widthSource, left: nativeLine.left, right: nativeLine.right, width, units: width * grid })
        }
      }
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
        const view = score.derived !== null ? viewOf(score.derived, grid) : nativeView(row, text)
        history = nativeDifference(view, entry.view)
        if (history !== null) {
          hd.rows++
          hd.cases.push({
            id: row.id, family: row.family, detail: history, text, metrics: score.metrics,
            nativeLines: view.lines.map(l => ({ ...l, text: text.slice(l.start, l.end) })),
            otherNativeLines: entry.view.lines.map(l => ({ ...l, text: text.slice(l.start, l.end) })),
          })
        } else if (entry.geometry !== Bun.hash(JSON.stringify(row.native))) {
          hd.geometryOnly++
          if (hd.geometryOnlyIds.length < 20) hd.geometryOnlyIds.push(row.id)
        }
      }
    }
    if (perCaseFd !== null) {
      writeSync(perCaseFd, JSON.stringify({ id: row.id, family: row.family, browser: row.browser, ...score.metrics, ...(history === null ? {} : { historyDependent: history }) }) + '\n')
    }
    if (history !== null) continue

    for (let i = 0; i < score.widthDiffs.length; i++) bump(summary.widthDiffUnits, String(score.widthDiffs[i]!))
    for (let i = 0; i < score.painterDiffs.length; i++) bump(summary.painterDiffUnits, String(score.painterDiffs[i]!))
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
  if (nativeRows !== null) closeSync(nativeRows.fd)

  const missingRows: Partial<Record<BrowserKind, number>> = {}
  if (casesById !== null) for (const [browser, ids] of seen) missingRows[browser] = [...casesById.keys()].filter(id => !ids.has(id)).length
  const summary = {
    generatedAt: new Date().toISOString(),
    rowsFile: rowsPath, casesFile: casesPath ?? null, nativeCompareFile: comparePath ?? null,
    ...(nativeRowsPath === undefined ? {} : { nativeRowsFile: nativeRowsPath, nativeRows: nativeRowCounts }),
    note:'unobserved and not-applicable are never passes; widths are compared only on cases whose breaks pass; with --native-compare, history-dependent cases are excluded from the metric counts',
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
