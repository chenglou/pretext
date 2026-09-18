// Facts-free predictor: predictor.ts with no supplied font facts.
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/no-facts-predictor.ts ...
// Every font of the case gets UNKNOWN_FONT_FACTS, so each engine uses the defaults src/model.ts documents for FontFacts,
// which Canvas measurement alone gives, and reports the named gaps. font-facts.ts and its table aren't imported, so they
// aren't in this predictor's bundle. Everything else is predictor.ts: the environment, the given build and process
// languages, the paragraph as the library takes it, and the painter.
//
// predictor.ts exports only predict() and paint(), and the facts are attached inside its layoutInput(), so engineOf,
// givenFacts, environment, treeWithFacts (here treeWithoutFacts), layoutInput, predict and paint are copied from it, as of
// 4c17b90, with withFacts replaced by withoutFacts and nothing else changed (importing its paint() would pull the font
// table into the bundle). Keep the copies in step with predictor.ts, or export them from there and drop them here.
import { detectEnvironment, type EngineName, type Environment, type GivenFacts } from '../../src/env.ts'
import { layoutParagraph } from '../../src/index.ts'
import { NO_BOX_EDGE, UNKNOWN_FONT_FACTS, type FontDecl, type InlineNode, type Paragraph as LayoutParagraph, type TextStyle } from '../../src/model.ts'
import { paintLines } from '../../src/paint.ts'
import type { BrowserKind, Case, FontDecl as CaseFont, InlineNode as CaseInlineNode, LayoutPrediction, ProcessLanguages } from '../types.ts'

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

function withoutFacts(font: CaseFont): FontDecl {
  return { ...font, facts: UNKNOWN_FONT_FACTS }
}

function treeWithoutFacts(nodes: readonly CaseInlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    switch (node.kind) {
      case 'span': out.push({ ...node, font: withoutFacts(node.font), children: treeWithoutFacts(node.children) }); break
      case 'text':
      case 'atomic':
      case 'br':
      case 'wbr': out.push(node); break
    }
  }
  return out
}

function layoutInput(c: Case): LayoutParagraph {
  const paragraph = c.paragraph
  const style = (font: CaseFont, letterSpacing: number, wordSpacing: number): TextStyle => ({
    font: withoutFacts(font), letterSpacing, wordSpacing, whiteSpace: paragraph.whiteSpace, wordBreak: paragraph.wordBreak,
    overflowWrap: paragraph.overflowWrap, lineBreak: paragraph.lineBreak, tabSize: paragraph.tabSize,
  })
  if (c.inline !== undefined) {
    return {
      ...style(paragraph.font, paragraph.letterSpacing, paragraph.wordSpacing), content: treeWithoutFacts(c.inline.content), lang: paragraph.lang,
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
  const paragraph = layoutInput(c)
  return { paragraph, layout: layoutParagraph(paragraph, e, c.inline?.lineSlots ?? []) }
}

// One element per line with a line box.
export function paint(_c: Case, prediction: LayoutPrediction, host: HTMLElement): HTMLElement[] | null {
  return paintLines(prediction.paragraph, prediction.layout, host.ownerDocument)
}
