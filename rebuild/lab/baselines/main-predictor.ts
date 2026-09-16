// Baseline predictor: the current library in src/ (main's public API), used the way an app developer uses it.
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/main-predictor.ts ...
// One font string from the paragraph's one run style, maxWidth = paragraph.width, and main's prepare options (whiteSpace
// normal/pre-wrap, wordBreak normal/keep-all, letterSpacing). Cases main can't express return { error: 'unsupported by
// main: ...' }. Lines come from walkLineRanges(); their cursors index main's segment stream, which is the source text after
// main's white-space normalization, so the adapter aligns that stream with the source once and converts each cursor to a
// UTF-16 source offset. Widths are main's. paint returns null.
import { prepareWithSegments, setLocale, walkLineRanges, type LayoutCursor, type PrepareOptions } from '../../../src/layout.ts'
import type { BrowserKind, Case, FontDecl, Prediction, TextRun } from '../types.ts'

function sameFont(a: FontDecl, b: FontDecl): boolean {
  return a.family === b.family && a.size === b.size && a.weight === b.weight && a.style === b.style
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return sameFont(a.font, b.font) && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing
}

// Every reason main can't express the case, in a fixed order; empty when it can.
export function unsupportedReasons(c: Case): string[] {
  const p = c.paragraph
  const reasons: string[] = []
  if (p.whiteSpace !== 'normal' && p.whiteSpace !== 'pre-wrap') reasons.push(`white-space ${p.whiteSpace}`)
  if (p.wordBreak !== 'normal' && p.wordBreak !== 'keep-all') reasons.push(`word-break ${p.wordBreak}`)
  if (p.overflowWrap !== 'break-word') reasons.push(`overflow-wrap ${p.overflowWrap}`)
  if (p.lineBreak !== 'auto') reasons.push(`line-break ${p.lineBreak}`)
  if (p.wordSpacing !== 0 || p.runs.some(run => run.wordSpacing !== 0)) reasons.push('word-spacing')
  if (p.runs.some(run => !sameStyle(run, p.runs[0]!))) reasons.push('several runs with different styles')
  if (p.runs.some(run => run.lang !== null && run.lang !== p.lang)) reasons.push('span lang differs from the paragraph')
  if (p.tabSize !== 8 && p.whiteSpace === 'pre-wrap' && p.runs.some(run => run.text.includes('\t'))) reasons.push(`tab-size ${p.tabSize}`)
  return reasons
}

// Canvas font shorthand, as an app writes it: '16px Arial', 'italic 700 16px "Helvetica Neue"'.
export function canvasFont(font: FontDecl): string {
  return `${font.style === 'italic' ? 'italic ' : ''}${font.weight === 400 ? '' : `${font.weight} `}${font.size}px ${font.family}`
}

// main doesn't report measureText calls, so the adapter counts calls on the Canvas prototypes while predict() runs.
let measuring = false
let measureCalls = 0
function countMeasureText(proto: { measureText(text: string): TextMetrics } | undefined): void {
  if (proto === undefined) return
  const original = proto.measureText
  proto.measureText = function (this: unknown, text: string): TextMetrics {
    if (measuring) measureCalls++
    return original.call(this, text)
  }
}
countMeasureText(typeof CanvasRenderingContext2D === 'undefined' ? undefined : CanvasRenderingContext2D.prototype)
countMeasureText(typeof OffscreenCanvasRenderingContext2D === 'undefined' ? undefined : OffscreenCanvasRenderingContext2D.prototype)

const COLLAPSIBLE = /^[ \t\n\r\f]$/

// For each UTF-16 unit of main's segment stream, the source range it stands for. main's normalization (white-space
// normal: a run of SPACE, TAB, LF, CR and FF becomes one SPACE, a leading and a trailing one are dropped, and some engines
// remove a run with LF next to a ZWSP; pre-wrap: CRLF, CR and FF become LF) only rewrites or removes those characters, so
// a greedy walk aligns the two. Returns null when the stream doesn't align with the source.
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
      // Source white space main removed.
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

export function predict(c: Case, _env: { browser: BrowserKind; dpr: number }): Prediction | { error: string } {
  const reasons = unsupportedReasons(c)
  if (reasons.length > 0) return { error: `unsupported by main: ${reasons.join('; ')}` }
  const p = c.paragraph
  const run = p.runs[0]
  const source = p.runs.map(r => r.text).join('')
  if (run === undefined) return { lines: [], measureLog: 0 }
  const whiteSpace = p.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal'
  const options: PrepareOptions = {}
  if (whiteSpace === 'pre-wrap') options.whiteSpace = 'pre-wrap'
  if (p.wordBreak === 'keep-all') options.wordBreak = 'keep-all'
  if (run.letterSpacing !== 0) options.letterSpacing = run.letterSpacing

  // setLocale() clears main's caches, so every case prepares cold and measureLog counts one fresh prepare. main takes
  // break rules and font resolution from <html lang> only; the paragraph's lang reaches it through setLocale's word
  // segmenter.
  setLocale(p.lang === '' ? undefined : p.lang)
  measureCalls = 0
  measuring = true
  const lines: Prediction['lines'] = []
  try {
    const prepared = prepareWithSegments(source, canvasFont(run.font), options)
    const stream = prepared.segments.join('')
    const segmentStarts: number[] = []
    for (let i = 0, offset = 0; i < prepared.segments.length; i++) {
      segmentStarts.push(offset)
      offset += prepared.segments[i]!.length
    }
    const graphemeOffsets = new Map<number, number[]>()
    const streamOffset = (cursor: LayoutCursor): number => {
      if (cursor.segmentIndex >= prepared.segments.length) return stream.length
      const base = segmentStarts[cursor.segmentIndex]!
      if (cursor.graphemeIndex === 0) return base
      let offsets = graphemeOffsets.get(cursor.segmentIndex)
      if (offsets === undefined) {
        offsets = []
        for (const g of graphemes.segment(prepared.segments[cursor.segmentIndex]!)) offsets.push(g.index)
        offsets.push(prepared.segments[cursor.segmentIndex]!.length)
        graphemeOffsets.set(cursor.segmentIndex, offsets)
      }
      return base + offsets[cursor.graphemeIndex]!
    }
    const ranges: Array<{ start: number; end: number; width: number }> = []
    walkLineRanges(prepared, p.width, line => {
      ranges.push({ start: streamOffset(line.start), end: streamOffset(line.end), width: line.width })
    })
    const aligned = alignStream(source, stream, whiteSpace)
    if (aligned === null) return { error: 'adapter: main\'s segment stream does not align with the source text' }
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]!
      const start = range.start < stream.length ? aligned.starts[range.start]! : source.length
      const end = range.end > range.start ? aligned.ends[range.end - 1]! : start
      lines.push({ start, end, width: range.width })
    }
  } finally {
    measuring = false
  }
  return { lines, measureLog: measureCalls }
}

export function paint(_c: Case, _prediction: Prediction, _host: HTMLElement): HTMLElement[] | null {
  return null
}
