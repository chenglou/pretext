// The prediction hook. page.ts imports this file and nothing else from the library side, so the rebuilt
// library plugs in by editing this file only (run.ts --predictor=<file> swaps it for experiments).
//
// predict() lays the paragraph out with rebuild/src for the running browser's engine and returns the library's input and
// layout; the page runs the observation port over them. paint() paints that layout.
//
// A case describes the page, so its fonts carry no font facts. The lab declares them the way an app that knows its fonts
// would: font-facts.ts gives the facts each engine reads for a declaration on this Mac, from a table generated offline
// from the installed fonts and the fixtures the case loads (DESIGN.md §1.2). Facts the table can't give stay unknown and
// report their gaps. The build comes from the driver, which reads it from the app bundle. The browser-process languages
// aren't recorded yet (DESIGN.md §8.3, stage 0), so they are given as unknown and report ui-language.
import { detectEnvironment, type EngineName, type Environment, type GivenFacts } from '../src/env.ts'
import { layoutParagraph } from '../src/index.ts'
import type { FontDecl, Paragraph as LayoutParagraph } from '../src/model.ts'
import { paintLines } from '../src/paint.ts'
import { fontFactsFor } from './font-facts.ts'
import type { BrowserKind, Case, FontDecl as CaseFont, LayoutPrediction } from './types.ts'

function engineOf(browser: BrowserKind): EngineName {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'safari': return 'webkit'
    case 'webkit-host': return 'webkit'
    case 'firefox': return 'gecko'
  }
}

// The lab's pages send no Content-Language, and its sessions run at page zoom 1.
function givenFacts(engine: EngineName, build: string): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build, contentLanguage: null, uiLanguage: null }
    case 'webkit': return { engine, build, contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
    case 'gecko': return { engine, build, contentLanguage: null, regionalPrefsLocale: null }
  }
}

function environment(browser: BrowserKind, build: string): Environment | { error: string } {
  const detected = detectEnvironment(givenFacts(engineOf(browser), build))
  if (detected.kind === 'unsupported') return { error: `Unsupported browser: ${detected.reason} (${detected.userAgent})` }
  return detected.env
}

function withFacts(font: CaseFont, engine: EngineName, fixtures: readonly string[]): FontDecl {
  return { ...font, facts: fontFactsFor(font, engine, fixtures) }
}

function layoutInput(c: Case, engine: EngineName): LayoutParagraph {
  const paragraph = c.paragraph
  const fixtures = c.fontFixtures ?? []
  const runs: LayoutParagraph['runs'] = []
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    runs.push({ ...run, font: withFacts(run.font, engine, fixtures) })
  }
  return { ...paragraph, font: withFacts(paragraph.font, engine, fixtures), runs }
}

export function predict(c: Case, env: { browser: BrowserKind; build: string }): LayoutPrediction | { error: string } {
  const e = environment(env.browser, env.build)
  if ('error' in e) return e
  if (c.pageLang !== e.pageLang) return { error: `Case ${c.id} needs <html lang="${c.pageLang}">; page has "${e.pageLang}"` }
  const paragraph = layoutInput(c, e.engine)
  return { paragraph, layout: layoutParagraph(paragraph, e) }
}

// One element per line with a line box.
export function paint(_c: Case, prediction: LayoutPrediction, host: HTMLElement): HTMLElement[] | null {
  return paintLines(prediction.paragraph, prediction.layout, host.ownerDocument)
}
