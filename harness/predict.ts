// The library used the way an app uses it, in the page: one Canvas font string per run style, maxWidth = the case's
// width, and the prepare options main documents. A case an app would write with inline elements (spans among other runs,
// several styles, a chip or padding) goes through rich-inline, one item per run: a chip is `break: 'never'`, padding is
// `extraWidth`. Line cursors index the library's segments, which are the source after white-space normalization, so the adapter
// aligns them with the source and returns UTF-16 source offsets. `run.ts --lib` bundles another build in place of src/.
//
// The prediction is walkLineRanges' lines (walkRichInlineLineRanges' for a rich case). Every other line API runs on the
// same case too, and the first way one disagrees with the walk is kept: layout() on prepare()'s handle (the resize path,
// with its own line counter), measureLineStats, layoutNextLineRange, layoutNextLine, layoutWithLines and
// materializeLineRange; for rich cases measureRichInlineStats, layoutNextRichInlineLineRange and
// materializeRichInlineLineRange, whose fragments' text is checked against their items' own text. measureText calls are
// counted apart while preparing and while the line APIs run.
import {
  layout, layoutNextLine, layoutNextLineRange, layoutWithLines, materializeLineRange, measureLineStats, prepare, prepareWithSegments, setLocale,
  walkLineRanges, type LayoutCursor, type LayoutLineRange, type PrepareOptions, type PreparedTextWithSegments,
} from '../src/layout.ts'
import {
  layoutNextRichInlineLineRange, materializeRichInlineLineRange, measureRichInlineStats, prepareRichInline, walkRichInlineLineRanges,
  type RichInlineCursor, type RichInlineFragmentRange, type RichInlineItem, type RichInlineLineRange,
} from '../src/rich-inline.ts'
import type { Case, CssFont, Prediction, PredictedLine, TextRun } from './types.ts'

function sameStyle(a: TextRun, b: TextRun): boolean {
  return a.font.family === b.font.family && a.font.size === b.font.size && a.font.weight === b.font.weight
    && a.font.style === b.font.style && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing
}

function isRich(runs: readonly TextRun[]): boolean {
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if ((runs.length > 1 && run.node === 'span') || !sameStyle(run, runs[0]!) || run.atomic === true || run.padding !== undefined) return true
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
  if (isRich(p.runs) && (p.whiteSpace !== 'normal' || p.wordBreak !== 'normal')) reasons.push('rich-inline takes white-space: normal and word-break: normal only')
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

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

// Maps the library's cursors in one prepared text to UTF-16 source ranges: `range(start, end)` for the cursors of a line
// or a fragment.
function sourceRanges(source: string, prepared: PreparedTextWithSegments, whiteSpace: 'normal' | 'pre-wrap'): (start: LayoutCursor, end: LayoutCursor) => { start: number; end: number } {
  const segments = prepared.segments
  const stream = segments.join('')
  const aligned = alignStream(source, stream, whiteSpace)
  if (aligned === null) throw new Error('adapter: the library\'s segments don\'t align with the source text')
  const segmentStarts: number[] = []
  for (let i = 0, offset = 0; i < segments.length; i++) {
    segmentStarts.push(offset)
    offset += segments[i]!.length
  }
  const unit = (cursor: LayoutCursor): number => {
    if (cursor.segmentIndex >= segments.length) return stream.length
    let at = segmentStarts[cursor.segmentIndex]!
    if (cursor.graphemeIndex > 0) {
      let k = 0
      for (const g of graphemes.segment(segments[cursor.segmentIndex]!)) if (k++ === cursor.graphemeIndex) at += g.index
    }
    return at
  }
  return (startCursor, endCursor) => {
    const from = unit(startCursor)
    const to = unit(endCursor)
    const start = from < stream.length ? aligned.starts[from]! : source.length
    return { start, end: to > from ? aligned.ends[to - 1]! : start }
  }
}

// measureText calls, counted on the Canvas prototypes while a prediction prepares and while its line APIs run.
let counting: 'prepare' | 'lines' | null = null
const calls = { prepare: 0, lines: 0 }
function countCalls(proto: { measureText: (this: unknown, text: string) => TextMetrics } | undefined): void {
  if (proto === undefined) return
  const original = proto.measureText
  proto.measureText = function (this: unknown, text: string): TextMetrics {
    if (counting !== null) calls[counting]++
    return original.call(this, text)
  }
}
countCalls(typeof CanvasRenderingContext2D === 'undefined' ? undefined : CanvasRenderingContext2D.prototype)
countCalls(typeof OffscreenCanvasRenderingContext2D === 'undefined' ? undefined : OffscreenCanvasRenderingContext2D.prototype)

// The line APIs' widths are sums of the same advances in other orders.
function sameWidth(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6
}

function sameCursor(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex
}

function showCursor(c: LayoutCursor): string {
  return `${c.segmentIndex}.${c.graphemeIndex}`
}

function showRange(line: { start: LayoutCursor; end: LayoutCursor; width: number }): string {
  return `${showCursor(line.start)}-${showCursor(line.end)} width ${line.width}`
}

// The first way the other text line APIs disagree with walkLineRanges' `walked` lines, or null. A stream that doesn't end
// within a step per source unit, plus one, disagrees.
function plainDisagreement(prepared: PreparedTextWithSegments, fastLines: { lineCount: number; height: number }, walked: LayoutLineRange[], walkedCount: number, width: number, lineHeight: number, steps: number): string | null {
  const n = walked.length
  if (walkedCount !== n) return `walkLineRanges returns ${walkedCount} for ${n} lines`
  if (fastLines.lineCount !== n || fastLines.height !== n * lineHeight) return `layout() gives ${fastLines.lineCount} lines, height ${fastLines.height}; walkLineRanges ${n} lines`
  let widest = 0
  for (let i = 0; i < n; i++) widest = Math.max(widest, walked[i]!.width)
  const stats = measureLineStats(prepared, width)
  if (stats.lineCount !== n || !sameWidth(stats.maxLineWidth, widest)) return `measureLineStats gives ${stats.lineCount} lines, widest ${stats.maxLineWidth}; walkLineRanges ${n}, widest ${widest}`
  const texts: string[] = []
  for (let i = 0; i < n; i++) {
    const line = materializeLineRange(prepared, walked[i]!)
    if (!sameCursor(line.start, walked[i]!.start) || !sameCursor(line.end, walked[i]!.end) || !sameWidth(line.width, walked[i]!.width)) return `materializeLineRange of line ${i} gives ${showRange(line)}; walkLineRanges ${showRange(walked[i]!)}`
    texts.push(line.text)
  }
  const batch = layoutWithLines(prepared, width, lineHeight)
  if (batch.lineCount !== n || batch.lines.length !== n || batch.height !== n * lineHeight) return `layoutWithLines gives ${batch.lineCount} lines (${batch.lines.length} listed), height ${batch.height}; walkLineRanges ${n}`
  for (let i = 0; i < n; i++) {
    const line = batch.lines[i]!
    if (!sameCursor(line.start, walked[i]!.start) || !sameCursor(line.end, walked[i]!.end) || !sameWidth(line.width, walked[i]!.width) || line.text !== texts[i]) return `layoutWithLines line ${i} is ${showRange(line)} ${JSON.stringify(line.text)}; walkLineRanges ${showRange(walked[i]!)} ${JSON.stringify(texts[i])}`
  }
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  for (let i = 0; ; i++) {
    const range = layoutNextLineRange(prepared, cursor, width)
    const line = layoutNextLine(prepared, cursor, width)
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
function richDisagreement(prepared: ReturnType<typeof prepareRichInline>, walked: RichInlineLineRange[], walkedCount: number, width: number, steps: number): string | null {
  const n = walked.length
  if (walkedCount !== n) return `walkRichInlineLineRanges returns ${walkedCount} for ${n} lines`
  let widest = 0
  for (let i = 0; i < n; i++) widest = Math.max(widest, walked[i]!.width)
  const stats = measureRichInlineStats(prepared, width)
  if (stats.lineCount !== n || !sameWidth(stats.maxLineWidth, widest)) return `measureRichInlineStats gives ${stats.lineCount} lines, widest ${stats.maxLineWidth}; walkRichInlineLineRanges ${n}, widest ${widest}`
  let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }
  for (let i = 0; ; i++) {
    const range = layoutNextRichInlineLineRange(prepared, width, cursor)
    if (range === null) return i === n ? null : `layoutNextRichInlineLineRange gives ${i} lines; walkRichInlineLineRanges ${n}`
    if (i >= n || i > steps) return `layoutNextRichInlineLineRange gives more than ${Math.min(n, steps)} lines; walkRichInlineLineRanges ${n}`
    const line = walked[i]!
    if (!sameFragments(range.fragments, line.fragments) || !sameWidth(range.width, line.width) || range.end.itemIndex !== line.end.itemIndex || !sameCursor(range.end, line.end)) return `layoutNextRichInlineLineRange line ${i} differs from walkRichInlineLineRanges'`
    const materialized = materializeRichInlineLineRange(prepared, line)
    if (!sameFragments(materialized.fragments, line.fragments) || materialized.width !== line.width) return `materializeRichInlineLineRange of line ${i} changes its fragments`
    cursor = range.end
  }
}

let locale: string | null = null

export function predict(c: Case): Prediction {
  const problem = unsupported(c)
  if (problem !== null) return { unsupported: problem }
  const p = c.paragraph
  // An app sets the locale when its content language changes; setLocale() also clears the library's caches.
  if (locale !== p.lang) {
    locale = p.lang
    setLocale(p.lang === '' ? undefined : p.lang)
  }
  const whiteSpace = p.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal'
  const runs = p.runs
  const lines: PredictedLine[] = []
  let disagreement: string | null
  calls.prepare = 0
  calls.lines = 0
  let source = ''
  for (let i = 0; i < runs.length; i++) source += runs[i]!.text
  try {
    if (!isRich(runs)) {
      const options: PrepareOptions = {}
      if (whiteSpace === 'pre-wrap') options.whiteSpace = 'pre-wrap'
      if (p.wordBreak === 'keep-all') options.wordBreak = 'keep-all'
      if (runs[0]!.letterSpacing !== 0) options.letterSpacing = runs[0]!.letterSpacing
      const font = canvasFont(runs[0]!.font)
      counting = 'prepare'
      const prepared = prepareWithSegments(source, font, options)
      const fast = prepare(source, font, options)
      counting = 'lines'
      const walked: LayoutLineRange[] = []
      const walkedCount = walkLineRanges(prepared, p.width, line => { walked.push(line) })
      disagreement = plainDisagreement(prepared, layout(fast, p.width, p.lineHeight), walked, walkedCount, p.width, p.lineHeight, source.length + 1)
      counting = null
      const range = sourceRanges(source, prepared, whiteSpace)
      for (let i = 0; i < walked.length; i++) lines.push({ ...range(walked[i]!.start, walked[i]!.end), width: walked[i]!.width })
    } else {
      const items: RichInlineItem[] = []
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i]!
        items.push({
          text: run.text, font: canvasFont(run.font), ...(run.letterSpacing === 0 ? {} : { letterSpacing: run.letterSpacing }),
          ...(run.atomic === true ? { break: 'never' as const } : {}), ...(run.padding === undefined ? {} : { extraWidth: 2 * run.padding }),
        })
      }
      counting = 'prepare'
      const prepared = prepareRichInline(items)
      counting = 'lines'
      const walked: RichInlineLineRange[] = []
      const walkedCount = walkRichInlineLineRanges(prepared, p.width, line => { walked.push(line) })
      disagreement = richDisagreement(prepared, walked, walkedCount, p.width, source.length + 1)
      counting = null
      // Fragment cursors index prepareWithSegments(item.text) of the item's font and letter spacing. So each fragment's
      // text is materializeLineRange's over those cursors; the text builder both share is src/layout.test.ts's to check.
      const handles: Array<PreparedTextWithSegments | undefined> = []
      const handle = (i: number): PreparedTextWithSegments => handles[i] ??= prepareWithSegments(runs[i]!.text, items[i]!.font, runs[i]!.letterSpacing === 0 ? {} : { letterSpacing: runs[i]!.letterSpacing })
      for (let i = 0; i < walked.length && disagreement === null; i++) {
        const fragments = materializeRichInlineLineRange(prepared, walked[i]!).fragments
        for (let k = 0; k < fragments.length; k++) {
          const f = fragments[k]!
          const text = materializeLineRange(handle(f.itemIndex), { start: f.start, end: f.end, width: 0 }).text
          if (f.text !== text) disagreement ??= `materializeRichInlineLineRange line ${i} fragment ${k} is ${JSON.stringify(f.text)}; its item's text there ${JSON.stringify(text)}`
        }
      }
      const maps: Array<ReturnType<typeof sourceRanges> | undefined> = []
      const bases: number[] = []
      for (let i = 0, base = 0; i < items.length; i++) {
        bases.push(base)
        base += items[i]!.text.length
      }
      const fragment = (f: RichInlineFragmentRange): { start: number; end: number } => {
        const map = maps[f.itemIndex] ??= sourceRanges(runs[f.itemIndex]!.text, handle(f.itemIndex), 'normal')
        const range = map(f.start, f.end)
        return { start: bases[f.itemIndex]! + range.start, end: bases[f.itemIndex]! + range.end }
      }
      let previousEnd = 0
      for (let i = 0; i < walked.length; i++) {
        const fragments = walked[i]!.fragments
        const first = fragments[0]
        const last = fragments[fragments.length - 1]
        const start = first === undefined ? previousEnd : fragment(first).start
        const end = last === undefined ? previousEnd : fragment(last).end
        lines.push({ start, end, width: walked[i]!.width })
        previousEnd = end
      }
    }
  } catch (error) {
    return { error: `threw: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    counting = null
  }
  return { lines, prepareCalls: calls.prepare, lineCalls: calls.lines, disagreement }
}
