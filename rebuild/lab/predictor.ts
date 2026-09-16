// The prediction hook. page.ts imports this file and nothing else from the library side, so the rebuilt
// library plugs in by editing this file only (run.ts --predictor=<file> swaps it for experiments).
//
// Until rebuild/src exists this is a stand-in: one line holding all the text, whose width is the sum of
// each run's Canvas measureText width. paint returns null, so painter observations are skipped.
import type { BrowserKind, Case, Prediction } from './types.ts'

export function predict(c: Case, _env: { browser: BrowserKind; dpr: number }): Prediction | { error: string } {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')
  if (ctx === null) return { error: 'No OffscreenCanvas 2d context' }
  let width = 0
  let length = 0
  let measureLog = 0
  const runs = c.paragraph.runs
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    ctx.font = `${run.font.style} ${run.font.weight} ${run.font.size}px ${run.font.family}`
    ctx.letterSpacing = `${run.letterSpacing}px`
    ctx.wordSpacing = `${run.wordSpacing}px`
    width += ctx.measureText(run.text).width
    measureLog++
    length += run.text.length
  }
  return { lines: [{ start: 0, end: length, width }], measureLog }
}

// One element per predicted line, or null when the predictor doesn't paint.
export function paint(_c: Case, _prediction: Prediction, _host: HTMLElement): HTMLElement[] | null {
  return null
}
