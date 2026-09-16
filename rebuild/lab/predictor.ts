// The prediction hook. page.ts imports this file and nothing else from the library side, so the rebuilt
// library plugs in by editing this file only (run.ts --predictor=<file> swaps it for experiments).
//
// predict() lays the paragraph out with rebuild/src for the running browser's engine. paint() lays it out again (with a
// fresh measurer, so the same Canvas results) and paints the lines, because the hook passes only the lab's Prediction.
import { detectEnvironment, type EngineName, type Environment } from '../src/env.ts'
import { layoutParagraph } from '../src/index.ts'
import { paintLines } from '../src/paint.ts'
import type { BrowserKind, Case, Prediction } from './types.ts'

function engineOf(browser: BrowserKind): EngineName {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'safari': return 'webkit'
    case 'webkit-host': return 'webkit'
    case 'firefox': return 'gecko'
  }
}

function environment(browser: BrowserKind | null): Environment | { error: string } {
  const detected = detectEnvironment()
  if (detected.kind === 'unsupported') return { error: `Unsupported browser: ${detected.reason} (${detected.userAgent})` }
  if (browser !== null && detected.env.engine.name !== engineOf(browser)) {
    return { error: `The driver says ${browser}, the page runs ${detected.env.engine.browser}` }
  }
  return detected.env
}

export function predict(c: Case, env: { browser: BrowserKind; dpr: number }): Prediction | { error: string } {
  const e = environment(env.browser)
  if ('error' in e) return e
  if (c.pageLang !== e.pageLang) return { error: `Case ${c.id} needs <html lang="${c.pageLang}">; page has "${e.pageLang}"` }
  const layout = layoutParagraph(c.paragraph, e)
  const lines: Prediction['lines'] = []
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]!
    lines.push({ start: line.start, end: line.end, width: line.width })
  }
  return { lines, measureLog: layout.measure.calls.length }
}

// One element per predicted line, or null when the predictor doesn't paint.
export function paint(c: Case, _prediction: Prediction, host: HTMLElement): HTMLElement[] | null {
  const e = environment(null)
  if ('error' in e) return null
  return paintLines(c.paragraph, layoutParagraph(c.paragraph, e), host.ownerDocument)
}
