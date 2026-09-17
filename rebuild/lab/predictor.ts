// The prediction hook. page.ts imports this file and nothing else from the library side, so the rebuilt
// library plugs in by editing this file only (run.ts --predictor=<file> swaps it for experiments).
//
// predict() lays the paragraph out with rebuild/src for the running browser's engine. paint() lays it out again (with a
// fresh measurer, so the same Canvas results) and paints the lines, because the hook passes only the lab's Prediction.
//
// A case describes the page, so its fonts carry no font facts, and the hook passes no build or browser-process
// languages yet. Until the driver records them (DESIGN.md §8.3, stage 0), every such fact is given as unknown, and
// predictions report the engine-build, ui-language and font-fact gaps.
import { detectEngine, detectEnvironment, type EngineName, type Environment, type GivenFacts } from '../src/env.ts'
import { layoutParagraph } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph as LayoutParagraph, type ParagraphLayout } from '../src/model.ts'
import { paintLines } from '../src/paint.ts'
import type { BrowserKind, Case, FontDecl as CaseFont, Paragraph as CaseParagraph, Prediction } from './types.ts'

function engineOf(browser: BrowserKind): EngineName {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'safari': return 'webkit'
    case 'webkit-host': return 'webkit'
    case 'firefox': return 'gecko'
  }
}

// The lab's pages send no Content-Language, and its sessions run at page zoom 1.
function givenFacts(engine: EngineName): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build: null, contentLanguage: null, uiLanguage: null }
    case 'webkit': return { engine, build: null, contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
    case 'gecko': return { engine, build: null, contentLanguage: null, regionalPrefsLocale: null }
  }
}

function environment(engine: EngineName): Environment | { error: string } {
  const detected = detectEnvironment(givenFacts(engine))
  if (detected.kind === 'unsupported') return { error: `Unsupported browser: ${detected.reason} (${detected.userAgent})` }
  return detected.env
}

function withFacts(font: CaseFont): FontDecl {
  return { ...font, facts: UNKNOWN_FONT_FACTS }
}

function layoutInput(paragraph: CaseParagraph): LayoutParagraph {
  const runs: LayoutParagraph['runs'] = []
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    runs.push({ ...run, font: withFacts(run.font) })
  }
  return { ...paragraph, font: withFacts(paragraph.font), runs }
}

// A line's width as its engine computes it, in CSS px, hanging white space and a chosen hyphen included: the extent of
// the line's whole-node rects (research/observe-blink.md §8, observe-webkit.md E2, observe-gecko.md E3).
function lineWidth(layout: ParagraphLayout, l: number): number {
  switch (layout.engine) {
    case 'blink': {
      const g = layout.lines[l]!.geometry
      return g.width / 64 / g.layoutZoom
    }
    case 'webkit': return layout.lines[l]!.geometry.contentWidth / (layout.env.pageZoom ?? 1)
    case 'gecko': return layout.lines[l]!.geometry.width / 60
  }
}

export function predict(c: Case, env: { browser: BrowserKind; dpr: number }): Prediction | { error: string } {
  const e = environment(engineOf(env.browser))
  if ('error' in e) return e
  if (c.pageLang !== e.pageLang) return { error: `Case ${c.id} needs <html lang="${c.pageLang}">; page has "${e.pageLang}"` }
  const layout = layoutParagraph(layoutInput(c.paragraph), e)
  const lines: Prediction['lines'] = []
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]!
    if (line.hasLineBox) lines.push({ start: line.start, end: line.end, width: lineWidth(layout, i) })
  }
  return { lines, measureLog: layout.measure.calls.length }
}

// One element per predicted line, or null when the predictor doesn't paint.
export function paint(c: Case, _prediction: Prediction, host: HTMLElement): HTMLElement[] | null {
  const detected = detectEngine()
  if (detected.kind === 'unsupported') return null
  const e = environment(detected.engine)
  if ('error' in e) return null
  const input = layoutInput(c.paragraph)
  return paintLines(input, layoutParagraph(input, e), host.ownerDocument)
}
