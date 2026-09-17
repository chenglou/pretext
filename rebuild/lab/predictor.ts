// The prediction hook. page.ts imports this file and nothing else from the library side, so the rebuilt
// library plugs in by editing this file only (run.ts --predictor=<file> swaps it for experiments).
//
// predict() lays the paragraph out with rebuild/src for the running browser's engine and returns the library's input and
// layout; the page runs the observation port over them. paint() paints that layout.
//
// A case describes the page, so its fonts carry no font facts. The lab declares them the way an app that knows its fonts
// would: font-facts.ts gives the facts each engine reads for a declaration on this Mac, from a table generated offline
// from the installed fonts and the fixtures the case loads (DESIGN.md §1.2). Facts the table can't give stay unknown and
// report their gaps. The build comes from the driver, which reads it from the app bundle. The browser process's languages
// come from the driver too (types.ts ProcessLanguages): it launches Chrome with them, and reads the OS settings Safari,
// webkit-host and Firefox's layout take them from, as research tooling may (DESIGN.md §8.3, stage 0). A value the driver
// couldn't derive stays null and reports ui-language.
import { detectEnvironment, type EngineName, type Environment, type GivenFacts } from '../src/env.ts'
import { layoutParagraph } from '../src/index.ts'
import { NO_BOX_EDGE, type FontDecl, type InlineNode, type Paragraph as LayoutParagraph, type TextStyle } from '../src/model.ts'
import { paintLines } from '../src/paint.ts'
import { fontFactsFor } from './font-facts.ts'
import type { BrowserKind, Case, FontDecl as CaseFont, InlineNode as CaseInlineNode, LayoutPrediction, ProcessLanguages } from './types.ts'

function engineOf(browser: BrowserKind): EngineName {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'safari': return 'webkit'
    case 'webkit-host': return 'webkit'
    case 'firefox': return 'gecko'
  }
}

// The lab's pages send no Content-Language, and its sessions run at page zoom 1.
function givenFacts(engine: EngineName, build: string, languages: ProcessLanguages['given'] | null): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build, contentLanguage: null, uiLanguage: languages?.engine === 'blink' ? languages.uiLanguage : null }
    case 'webkit': return {
      engine, build, contentLanguage: null, pageZoom: 1,
      preferredLanguages: languages?.engine === 'webkit' ? languages.preferredLanguages : null,
      icuDefaultLocale: languages?.engine === 'webkit' ? languages.icuDefaultLocale : null,
    }
    case 'gecko': return { engine, build, contentLanguage: null, regionalPrefsLocale: languages?.engine === 'gecko' ? languages.regionalPrefsLocale : null }
  }
}

function environment(browser: BrowserKind, build: string, languages: ProcessLanguages['given'] | null): Environment | { error: string } {
  const engine = engineOf(browser)
  if (languages !== null && languages.engine !== engine) return { error: `The driver gave ${languages.engine} process languages for ${browser}` }
  const detected = detectEnvironment(givenFacts(engine, build, languages))
  if (detected.kind === 'unsupported') return { error: `Unsupported browser: ${detected.reason} (${detected.userAgent})` }
  return detected.env
}

function withFacts(font: CaseFont, engine: EngineName, fixtures: readonly string[]): FontDecl {
  return { ...font, facts: fontFactsFor(font, engine, fixtures) }
}

// A flat case paragraph as the tree the library takes (DESIGN.md §1.1, "Flat paragraphs"): a bare run is a text leaf, and
// a span run a span with the block's wrapping styles, no box edges and its text as its one leaf. A span run with empty
// text keeps an empty leaf, which makes no DOM node, so leaf indices stay run indices.
// A case's tree with the font facts the predictor gives on every span's font.
function treeWithFacts(nodes: readonly CaseInlineNode[], engine: EngineName, fixtures: readonly string[]): InlineNode[] {
  const out: InlineNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    switch (node.kind) {
      case 'span': out.push({ ...node, font: withFacts(node.font, engine, fixtures), children: treeWithFacts(node.children, engine, fixtures) }); break
      case 'text':
      case 'atomic':
      case 'br':
      case 'wbr': out.push(node); break
    }
  }
  return out
}

function layoutInput(c: Case, engine: EngineName): LayoutParagraph {
  const paragraph = c.paragraph
  const fixtures = c.fontFixtures ?? []
  const style = (font: CaseFont, letterSpacing: number, wordSpacing: number): TextStyle => ({
    font: withFacts(font, engine, fixtures), letterSpacing, wordSpacing, whiteSpace: paragraph.whiteSpace, wordBreak: paragraph.wordBreak,
    overflowWrap: paragraph.overflowWrap, lineBreak: paragraph.lineBreak, tabSize: paragraph.tabSize,
  })
  // A case with inline structure carries the tree itself (lab/types.ts InlineStructure).
  if (c.inline !== undefined) {
    return {
      ...style(paragraph.font, paragraph.letterSpacing, paragraph.wordSpacing), content: treeWithFacts(c.inline.content, engine, fixtures), lang: paragraph.lang,
      direction: paragraph.direction, width: paragraph.width, lineHeight: paragraph.lineHeight, textIndent: c.inline.textIndent, textAlign: c.inline.textAlign,
    }
  }
  const content: InlineNode[] = []
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    if (run.node === 'text') {
      content.push({ kind: 'text', text: run.text })
      continue
    }
    content.push({
      ...style(run.font, run.letterSpacing, run.wordSpacing), kind: 'span', lang: run.lang, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE,
      verticalAlign: 'baseline', children: [{ kind: 'text', text: run.text }],
    })
  }
  return {
    ...style(paragraph.font, paragraph.letterSpacing, paragraph.wordSpacing), content, lang: paragraph.lang, direction: paragraph.direction,
    width: paragraph.width, lineHeight: paragraph.lineHeight, textIndent: 0, textAlign: 'start',
  }
}

export function predict(c: Case, env: { browser: BrowserKind; build: string; languages: ProcessLanguages['given'] | null }): LayoutPrediction | { error: string } {
  const e = environment(env.browser, env.build, env.languages)
  if ('error' in e) return e
  if (c.pageLang !== e.pageLang) return { error: `Case ${c.id} needs <html lang="${c.pageLang}">; page has "${e.pageLang}"` }
  const paragraph = layoutInput(c, e.engine)
  return { paragraph, layout: layoutParagraph(paragraph, e, c.inline?.lineSlots ?? []) }
}

// One element per line with a line box.
export function paint(_c: Case, prediction: LayoutPrediction, host: HTMLElement): HTMLElement[] | null {
  return paintLines(prediction.paragraph, prediction.layout, host.ownerDocument)
}
