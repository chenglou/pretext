// The library used the way an app uses it, in the page: one Canvas font string per run style, maxWidth = the case's
// width, and the prepare options main documents. A case an app would write with inline elements (spans among other runs,
// several styles, a chip, padding or a box) goes through rich-inline, one item per run: a chip is `break: 'never'`, padding
// is `extraWidth`, a box a RichInlineBox of its width, and the paragraph's white-space and word-break are
// prepareRichInline()'s options. A text's line cursors index the library's
// segments, which are the source after white-space normalization, so the adapter aligns them with the source and returns
// UTF-16 source offsets; a rich line's are its first fragment's sourceStart and its last one's sourceEnd, in their items'
// texts. `run.ts --lib` bundles another build in place of src/.
//
// The prediction is walkLineRanges' lines (walkRichInlineLineRanges' for a rich case). Every other line API runs on the
// same case too, and the first way one disagrees with the walk is kept: layout() on prepare()'s handle (the resize path,
// with its own line counter), measureLineStats, layoutNextLineRange, layoutNextLine, layoutWithLines and
// materializeLineRange; for rich cases measureRichInlineStats, layoutNextRichInlineLineRange and
// materializeRichInlineLineRange, whose fragments' text is checked against their items' text between sourceStart and
// sourceEnd. The lines' text (the
// fragments' for a rich case) goes out as a hash, for `equal` to compare builds by. measureText calls are
// counted apart while preparing and while the line APIs run. A walk that goes past a line per source unit, plus one,
// fails its case instead of stalling the page, and so does a range that names no place in its text,
// before its text is built, since builds before #353, which --lib can run, build the text of a range that ends at
// segment Infinity without end. A cursor's place is found with the library's own graphemes (cursorOffsets), so the
// adapter needs a build with src/graphemes.ts (from 2026-09-24). The offline invariants (invariants.ts) call the same
// agreement checks and the same cursor map.
import {
  layout, layoutNextLine, layoutNextLineRange, layoutWithLines, materializeLineRange, measureLineStats, prepare, prepareWithSegments,
  walkLineRanges, type LayoutCursor, type LayoutLineRange, type PrepareOptions, type PreparedTextWithSegments,
} from '../src/layout.ts'
import {
  layoutNextRichInlineLineRange, materializeRichInlineLineRange, measureRichInlineStats, prepareRichInline, walkRichInlineLineRanges,
  type RichInlineBox, type RichInlineCursor, type RichInlineFragment, type RichInlineFragmentRange, type RichInlineItem, type RichInlineLineRange, type RichInlineOptions,
} from '../src/rich-inline.ts'
import { findGraphemeEnds } from '../src/graphemes.ts'
import { getEngineProfile } from '../src/measurement.ts'
import type { Case, CssFont, Prediction, PredictedLine, TextRun } from './types.ts'

function sameStyle(a: TextRun, b: TextRun): boolean {
  return a.font.family === b.font.family && a.font.size === b.font.size && a.font.weight === b.font.weight
    && a.font.style === b.font.style && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing
}

export function isRich(runs: readonly TextRun[]): boolean {
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if ((runs.length > 1 && run.node === 'span') || !sameStyle(run, runs[0]!) || run.atomic === true || run.padding !== undefined || run.box !== undefined) return true
  }
  return false
}

// Why the library can't express the case, or null.
export function unsupported(c: Case): string | null {
  const p = c.paragraph
  const reasons: string[] = []
  if (p.whiteSpace !== 'normal' && p.whiteSpace !== 'pre-wrap') reasons.push(`white-space ${p.whiteSpace}`)
  if (p.wordBreak !== 'normal' && p.wordBreak !== 'keep-all') reasons.push(`word-break ${p.wordBreak}`)
  if (p.overflowWrap !== 'break-word') reasons.push(`overflow-wrap ${p.overflowWrap}`)
  if (p.lineBreak !== 'auto') reasons.push(`line-break ${p.lineBreak}`)
  for (let i = 0; i < p.runs.length; i++) {
    const run = p.runs[i]!
    if (run.wordSpacing !== 0) reasons.push('word-spacing')
    if (run.lang !== null && run.lang !== p.lang) reasons.push('a span lang differs from the paragraph\'s')
    if (run.text.includes('\t') && p.whiteSpace === 'pre-wrap' && p.tabSize !== 8) reasons.push(`tab-size ${p.tabSize}`)
  }
  return reasons.length === 0 ? null : [...new Set(reasons)].join('; ')
}

// Canvas font shorthand, as an app writes it: '16px Arial', 'italic 700 16px "Helvetica Neue"'.
export function canvasFont(font: CssFont): string {
  return `${font.style === 'italic' ? 'italic ' : ''}${font.weight === 400 ? '' : `${font.weight} `}${font.size}px ${font.family}`
}

const COLLAPSIBLE = /^[ \t\n\r\f]$/

// For each UTF-16 unit of the library's segment stream, the source range it stands for. Normalization only rewrites or
// removes white space (normal: a run of SPACE, TAB, LF, CR and FF becomes one SPACE, a leading and a trailing one go,
// and some engines remove a run with LF next to a ZWSP; pre-wrap: CRLF, CR and FF become LF), so a greedy walk aligns
// the two. null when they don't align.
export function alignStream(source: string, stream: string, whiteSpace: 'normal' | 'pre-wrap'): { starts: Int32Array; ends: Int32Array } | null {
  const starts = new Int32Array(stream.length)
  const ends = new Int32Array(stream.length)
  let s = 0
  for (let n = 0; n < stream.length; n++) {
    const unit = stream[n]!
    for (;;) {
      if (s >= source.length) return null
      const ch = source[s]!
      if (whiteSpace === 'normal' && unit === ' ' && COLLAPSIBLE.test(ch)) {
        starts[n] = s
        while (s < source.length && COLLAPSIBLE.test(source[s]!)) s++
        ends[n] = s
        break
      }
      if (whiteSpace === 'pre-wrap' && unit === '\n' && (ch === '\r' || ch === '\f')) {
        starts[n] = s
        s += ch === '\r' && source[s + 1] === '\n' ? 2 : 1
        ends[n] = s
        break
      }
      if (ch === unit) {
        starts[n] = s
        ends[n] = ++s
        break
      }
      if (whiteSpace === 'normal' && COLLAPSIBLE.test(ch)) {
        s++
        continue
      }
      return null
    }
  }
  for (; s < source.length; s++) if (whiteSpace === 'pre-wrap' || !COLLAPSIBLE.test(source[s]!)) return null
  return { starts, ends }
}

// A cursor's UTF-16 offset in the text its prepared `segments` hold, with a segment's graphemes, the library's own
// (src/graphemes.ts) under the engine's profile, found when a cursor first names a place inside it; -1 for a cursor that
// names no place there. A browser's Intl.Segmenter can move to another Unicode version, which the library's rules don't
// follow (RESEARCH.md, Decisions Log, 2026-09-24).
export function cursorOffsets(segments: readonly string[]): (cursor: LayoutCursor) => number {
  const starts: number[] = []
  let total = 0
  for (let i = 0; i < segments.length; i++) {
    starts.push(total)
    total += segments[i]!.length
  }
  const ends: Array<Int32Array | undefined> = []
  return ({ segmentIndex: s, graphemeIndex: g }) => {
    if (!Number.isInteger(s) || !Number.isInteger(g) || s < 0 || g < 0 || s > segments.length) return -1
    if (s === segments.length) return g === 0 ? total : -1
    if (g === 0) return starts[s]!
    let list = ends[s]
    if (list === undefined) {
      const segment = segments[s]!
      const buffer = new Int32Array(segment.length)
      ends[s] = list = buffer.subarray(0, findGraphemeEnds(getEngineProfile().graphemeTable, segment, 0, segment.length, buffer))
    }
    return g <= list.length ? starts[s]! + list[g - 1]! : -1
  }
}

// Maps the library's cursors in one prepared text to UTF-16 source ranges: `range(start, end)` for the cursors of a line
// or a fragment. A cursor that names no place in the text, which the agreement checks report, maps to its end.
function sourceRanges(source: string, prepared: PreparedTextWithSegments, whiteSpace: 'normal' | 'pre-wrap'): (start: LayoutCursor, end: LayoutCursor) => { start: number; end: number } {
  const stream = prepared.segments.join('')
  const aligned = alignStream(source, stream, whiteSpace)
  if (aligned === null) throw new Error('adapter: the library\'s segments don\'t align with the source text')
  const offsetOf = cursorOffsets(prepared.segments)
  const unit = (cursor: LayoutCursor): number => {
    const at = offsetOf(cursor)
    return at < 0 ? stream.length : at
  }
  return (startCursor, endCursor) => {
    const from = unit(startCursor)
    const to = unit(endCursor)
    const start = from < stream.length ? aligned.starts[from]! : source.length
    return { start, end: to > from ? aligned.ends[to - 1]! : start }
  }
}

// measureText calls, counted on the Canvas prototypes while a prediction prepares and while its line APIs run, and the
// UTF-16 units submitted while preparing.
let counting: 'prepare' | 'lines' | null = null
const calls = { prepare: 0, lines: 0, units: 0 }
function countCalls(proto: { measureText: (this: unknown, text: string) => TextMetrics } | undefined): void {
  if (proto === undefined) return
  const original = proto.measureText
  proto.measureText = function (this: unknown, text: string): TextMetrics {
    if (counting !== null) calls[counting]++
    if (counting === 'prepare') calls.units += text.length
    return original.call(this, text)
  }
}
countCalls(typeof CanvasRenderingContext2D === 'undefined' ? undefined : CanvasRenderingContext2D.prototype)
countCalls(typeof OffscreenCanvasRenderingContext2D === 'undefined' ? undefined : OffscreenCanvasRenderingContext2D.prototype)

// A 32-bit FNV-1a hash of line texts, each ended by a unit no text holds.
function hashText(hash: number, text: string): number {
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return Math.imul(hash ^ 0x10000, 16777619)
}

// The line APIs' widths are sums of the same advances in other orders.
function sameWidth(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6
}

function sameCursor(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex
}

// Whether a cursor's indices are whole and not negative, so that a JSON copy of it is the same cursor.
function isPlace(c: LayoutCursor): boolean {
  return Number.isInteger(c.segmentIndex) && Number.isInteger(c.graphemeIndex) && c.segmentIndex >= 0 && c.graphemeIndex >= 0
}

function showCursor(c: LayoutCursor): string {
  return `${c.segmentIndex}.${c.graphemeIndex}`
}

function showRange(line: { start: LayoutCursor; end: LayoutCursor; width: number }): string {
  return `${showCursor(line.start)}-${showCursor(line.end)} width ${line.width}`
}

// The line APIs the agreement checks call: this build's in the page, the build under test in the offline invariants
// (invariants.ts).
const LIBRARY = { layoutNextLine, layoutNextLineRange, layoutWithLines, materializeLineRange, measureLineStats, layoutNextRichInlineLineRange, materializeRichInlineLineRange, measureRichInlineStats }
export type LineApis = typeof LIBRARY

// The first way the other text line APIs disagree with walkLineRanges' `walked` lines, or null. A stream that doesn't end
// within a step per source unit, plus one, disagrees.
export function plainDisagreement(api: LineApis, prepared: PreparedTextWithSegments, fastLines: { lineCount: number; height: number }, walked: LayoutLineRange[], walkedCount: number, width: number, lineHeight: number, steps: number): string | null {
  const n = walked.length
  if (walkedCount !== n) return `walkLineRanges returns ${walkedCount} for ${n} lines`
  if (fastLines.lineCount !== n || fastLines.height !== n * lineHeight) return `layout() gives ${fastLines.lineCount} lines, height ${fastLines.height}; walkLineRanges ${n} lines`
  let widest = 0
  for (let i = 0; i < n; i++) widest = Math.max(widest, walked[i]!.width)
  const stats = api.measureLineStats(prepared, width)
  if (stats.lineCount !== n || !sameWidth(stats.maxLineWidth, widest)) return `measureLineStats gives ${stats.lineCount} lines, widest ${stats.maxLineWidth}; walkLineRanges ${n}, widest ${widest}`
  // The checks test each range before building its text: the text builders of builds before #353, given a range that
  // ends elsewhere, such as at segment Infinity, build its text without end.
  const offsetOf = cursorOffsets(prepared.segments)
  const segments = prepared.segments.length
  const texts: string[] = []
  for (let i = 0; i < n; i++) {
    if (offsetOf(walked[i]!.start) < 0 || offsetOf(walked[i]!.end) < 0) return `walkLineRanges line ${i} is ${showRange(walked[i]!)}, outside the text's ${segments} segments`
    const line = api.materializeLineRange(prepared, walked[i]!)
    if (!sameCursor(line.start, walked[i]!.start) || !sameCursor(line.end, walked[i]!.end) || !sameWidth(line.width, walked[i]!.width)) return `materializeLineRange of line ${i} gives ${showRange(line)}; walkLineRanges ${showRange(walked[i]!)}`
    texts.push(line.text)
  }
  const batch = api.layoutWithLines(prepared, width, lineHeight)
  if (batch.lineCount !== n || batch.lines.length !== n || batch.height !== n * lineHeight) return `layoutWithLines gives ${batch.lineCount} lines (${batch.lines.length} listed), height ${batch.height}; walkLineRanges ${n}`
  for (let i = 0; i < n; i++) {
    const line = batch.lines[i]!
    if (!sameCursor(line.start, walked[i]!.start) || !sameCursor(line.end, walked[i]!.end) || !sameWidth(line.width, walked[i]!.width) || line.text !== texts[i]) return `layoutWithLines line ${i} is ${showRange(line)} ${JSON.stringify(line.text)}; walkLineRanges ${showRange(walked[i]!)} ${JSON.stringify(texts[i])}`
  }
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  for (let i = 0; ; i++) {
    const range = api.layoutNextLineRange(prepared, cursor, width)
    // layoutNextLine builds the text of the same range.
    if (range !== null && offsetOf(range.end) < 0) return `layoutNextLineRange line ${i} is ${showRange(range)}, outside the text's ${segments} segments`
    const line = api.layoutNextLine(prepared, cursor, width)
    if (range === null || line === null) {
      if (range !== line) return `at line ${i}, layoutNextLineRange ${range === null ? 'ends' : 'goes on'} and layoutNextLine ${line === null ? 'ends' : 'goes on'}`
      return i === n ? null : `layoutNextLineRange gives ${i} lines; walkLineRanges ${n}`
    }
    if (i >= n || i > steps) return `layoutNextLineRange gives more than ${Math.min(n, steps)} lines; walkLineRanges ${n}`
    if (!sameCursor(range.start, walked[i]!.start) || !sameCursor(range.end, walked[i]!.end) || !sameWidth(range.width, walked[i]!.width)) return `layoutNextLineRange line ${i} is ${showRange(range)}; walkLineRanges ${showRange(walked[i]!)}`
    if (!sameCursor(line.start, range.start) || !sameCursor(line.end, range.end) || line.width !== range.width || line.text !== texts[i]) return `layoutNextLine line ${i} is ${showRange(line)} ${JSON.stringify(line.text)}; walkLineRanges ${showRange(walked[i]!)} ${JSON.stringify(texts[i])}`
    cursor = range.end
  }
}

function sameFragments(a: readonly RichInlineFragmentRange[], b: readonly RichInlineFragmentRange[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.itemIndex !== y.itemIndex || x.gapItemIndex !== y.gapItemIndex || !sameWidth(x.gapBefore, y.gapBefore) || !sameWidth(x.occupiedWidth, y.occupiedWidth)
      || !sameCursor(x.start, y.start) || !sameCursor(x.end, y.end)) return false
  }
  return true
}

// The same for rich-inline, against walkRichInlineLineRanges' lines.
export function richDisagreement(api: LineApis, prepared: ReturnType<typeof prepareRichInline>, walked: RichInlineLineRange[], walkedCount: number, width: number, steps: number): string | null {
  const n = walked.length
  if (walkedCount !== n) return `walkRichInlineLineRanges returns ${walkedCount} for ${n} lines`
  let widest = 0
  for (let i = 0; i < n; i++) widest = Math.max(widest, walked[i]!.width)
  const stats = api.measureRichInlineStats(prepared, width)
  if (stats.lineCount !== n || !sameWidth(stats.maxLineWidth, widest)) return `measureRichInlineStats gives ${stats.lineCount} lines, widest ${stats.maxLineWidth}; walkRichInlineLineRanges ${n}, widest ${widest}`
  let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }
  for (let i = 0; ; i++) {
    const range = api.layoutNextRichInlineLineRange(prepared, width, cursor)
    if (range === null) return i === n ? null : `layoutNextRichInlineLineRange gives ${i} lines; walkRichInlineLineRanges ${n}`
    if (i >= n || i > steps) return `layoutNextRichInlineLineRange gives more than ${Math.min(n, steps)} lines; walkRichInlineLineRanges ${n}`
    const line = walked[i]!
    if (!sameFragments(range.fragments, line.fragments) || !sameWidth(range.width, line.width) || range.end.itemIndex !== line.end.itemIndex || !sameCursor(range.end, line.end)) return `layoutNextRichInlineLineRange line ${i} differs from walkRichInlineLineRanges'`
    for (let k = 0; k < line.fragments.length; k++) {
      const f = line.fragments[k]!
      if (!isPlace(f.start) || !isPlace(f.end)) return `walkRichInlineLineRanges line ${i} fragment ${k} is item ${f.itemIndex}'s ${showCursor(f.start)}-${showCursor(f.end)}, which names no place`
    }
    const materialized = api.materializeRichInlineLineRange(prepared, line)
    if (!sameFragments(materialized.fragments, line.fragments) || materialized.width !== line.width) return `materializeRichInlineLineRange of line ${i} changes its fragments`
    cursor = range.end
  }
}

const UNPAINTED = /[\u00AD\u2028\u2029]/g
const DROPPED = /^[\u00AD\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]$/

// Whether `text` is `source`, a stretch of an item's text, as painted: without soft hyphens and what ends a line. In
// normal white space each run of white space is one space, or nothing where the engine removes it: at either end, where
// it can collapse into white space outside the stretch; where it holds a line feed, which the segment break
// transformation can remove, as Firefox does between two ideographs; and next to a soft hyphen or a bidi control, which
// Firefox's white-space run reads through. In pre-wrap the bidi controls that end the stretch after a line feed paint
// nothing either: the Gecko analysis keeps those that end a paragraph in its last line feed's segment.
function paints(source: string, text: string, whiteSpace: 'normal' | 'pre-wrap'): boolean {
  if (whiteSpace === 'pre-wrap') return text.replace(/[\u00AD\u2028\u2029\n\r\f]/g, '') === source.replace(/([\n\r\f\u2028\u2029])[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]+$/, '$1').replace(/[\u00AD\u2028\u2029\n\r\f]/g, '')
  const painted = text.replace(UNPAINTED, '')
  let t = 0
  for (let s = 0; s < source.length;) {
    const ch = source[s]!
    if (COLLAPSIBLE.test(ch)) {
      let end = s + 1
      while (end < source.length && COLLAPSIBLE.test(source[end]!)) end++
      if (painted[t] === ' ') t++
      else if (s > 0 && end < source.length && !source.slice(s, end).includes('\n') && !DROPPED.test(source[s - 1]!) && !DROPPED.test(source[end]!)) return false
      s = end
      continue
    }
    if (ch !== '\u00AD' && ch !== '\u2028' && ch !== '\u2029') {
      if (painted[t] !== ch) return false
      t++
    }
    s++
  }
  return t === painted.length
}

// How a materialized fragment disagrees with its item's text between its sourceStart and sourceEnd, or null: its text is
// that text as painted, but for the hyphen of a soft hyphen its line ends at. A box's fragment has no text, and an
// atomic item's is laid out in normal white space.
export function fragmentProblem(item: RichInlineItem | RichInlineBox, f: RichInlineFragment, whiteSpace: 'normal' | 'pre-wrap'): string | null {
  if (item.text === undefined) return f.text === '' ? null : `a box, is ${JSON.stringify(f.text)}`
  if (!(Number.isInteger(f.sourceStart) && Number.isInteger(f.sourceEnd) && 0 <= f.sourceStart && f.sourceStart <= f.sourceEnd && f.sourceEnd <= item.text.length)) return `is ${f.sourceStart}-${f.sourceEnd}, outside its item's text`
  const source = item.text.slice(f.sourceStart, f.sourceEnd)
  const mode = item.break === 'never' ? 'normal' : whiteSpace
  if (paints(source, f.text, mode) || (f.text.endsWith('-') && source.endsWith('\u00AD') && paints(source, f.text.slice(0, -1), mode))) return null
  return `is ${JSON.stringify(f.text)}; its item's text there ${JSON.stringify(source)}`
}

// The prepare options of a case without inline structure.
export function prepareOptions(c: Case): PrepareOptions {
  const p = c.paragraph
  const options: PrepareOptions = {}
  if (p.whiteSpace === 'pre-wrap') options.whiteSpace = 'pre-wrap'
  if (p.wordBreak === 'keep-all') options.wordBreak = 'keep-all'
  if (p.runs[0]!.letterSpacing !== 0) options.letterSpacing = p.runs[0]!.letterSpacing
  return options
}

// A rich case's options: the paragraph's white-space and word-break.
export function richOptions(c: Case): RichInlineOptions {
  const options: RichInlineOptions = {}
  if (c.paragraph.whiteSpace === 'pre-wrap') options.whiteSpace = 'pre-wrap'
  if (c.paragraph.wordBreak === 'keep-all') options.wordBreak = 'keep-all'
  return options
}

// A rich case's items, one per run.
export function richItems(runs: readonly TextRun[]): Array<RichInlineItem | RichInlineBox> {
  const items: Array<RichInlineItem | RichInlineBox> = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if (run.box !== undefined) {
      items.push({ width: run.box.width })
      continue
    }
    items.push({
      text: run.text, font: canvasFont(run.font), ...(run.letterSpacing === 0 ? {} : { letterSpacing: run.letterSpacing }),
      ...(run.atomic === true ? { break: 'never' as const } : {}), ...(run.padding === undefined ? {} : { extraWidth: 2 * run.padding }),
    })
  }
  return items
}

export function predict(c: Case): Prediction {
  const problem = unsupported(c)
  if (problem !== null) return { unsupported: problem }
  const p = c.paragraph
  const whiteSpace = p.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal'
  const runs = p.runs
  const lines: PredictedLine[] = []
  let disagreement: string | null
  let textHash = 0x811c9dc5
  calls.prepare = 0
  calls.lines = 0
  calls.units = 0
  let source = ''
  for (let i = 0; i < runs.length; i++) source += runs[i]!.text
  // A walker that doesn't end within a line per source unit, plus one, fails the case instead of stalling the page.
  const steps = source.length + 1
  try {
    if (!isRich(runs)) {
      const options = prepareOptions(c)
      const font = canvasFont(runs[0]!.font)
      counting = 'prepare'
      const prepared = prepareWithSegments(source, font, options)
      const fast = prepare(source, font, options)
      counting = 'lines'
      const walked: LayoutLineRange[] = []
      const walkedCount = walkLineRanges(prepared, p.width, line => { if (walked.push(line) > steps) throw new Error(`walkLineRanges gives more than ${steps} lines`) })
      disagreement = plainDisagreement(LIBRARY, prepared, layout(fast, p.width, p.lineHeight), walked, walkedCount, p.width, p.lineHeight, steps)
      // Every text API gave this text when none disagrees.
      for (let i = 0; i < walked.length && disagreement === null; i++) textHash = hashText(textHash, materializeLineRange(prepared, walked[i]!).text)
      counting = null
      const range = sourceRanges(source, prepared, whiteSpace)
      for (let i = 0; i < walked.length; i++) lines.push({ ...range(walked[i]!.start, walked[i]!.end), width: walked[i]!.width })
    } else {
      const items = richItems(runs)
      const options = richOptions(c)
      counting = 'prepare'
      const prepared = prepareRichInline(items, options)
      counting = 'lines'
      const walked: RichInlineLineRange[] = []
      const walkedCount = walkRichInlineLineRanges(prepared, p.width, line => { if (walked.push(line) > steps) throw new Error(`walkRichInlineLineRanges gives more than ${steps} lines`) })
      disagreement = richDisagreement(LIBRARY, prepared, walked, walkedCount, p.width, steps)
      counting = null
      const bases: number[] = []
      for (let i = 0, base = 0; i < runs.length; i++) {
        bases.push(base)
        base += runs[i]!.text.length
      }
      // A line runs from its first fragment's start in the source to its last one's end; a box's fragment is its
      // U+FFFC. The text builder the fragments' text shares with the text line APIs is src/layout.test.ts's to check.
      let previousEnd = 0
      for (let i = 0; i < walked.length; i++) {
        const fragments = materializeRichInlineLineRange(prepared, walked[i]!).fragments
        for (let k = 0; k < fragments.length; k++) {
          const f = fragments[k]!
          const problem = fragmentProblem(items[f.itemIndex]!, f, whiteSpace)
          if (problem !== null) disagreement ??= `materializeRichInlineLineRange line ${i} fragment ${k} ${problem}`
          if (disagreement === null) textHash = hashText(textHash, f.text)
        }
        const first = fragments[0]
        const last = fragments[fragments.length - 1]
        const start = first === undefined ? previousEnd : bases[first.itemIndex]! + first.sourceStart
        const end = last === undefined ? previousEnd : bases[last.itemIndex]! + (items[last.itemIndex]!.text === undefined ? 1 : last.sourceEnd)
        lines.push({ start, end, width: walked[i]!.width })
        previousEnd = end
      }
    }
  } catch (error) {
    return { error: `threw: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    counting = null
  }
  return { lines, textHash: textHash >>> 0, prepareCalls: calls.prepare, prepareUnits: calls.units, lineCalls: calls.lines, disagreement }
}
