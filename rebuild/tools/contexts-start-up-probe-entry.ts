// The page side of tools/contexts-start-up-probe.ts: the library as a page with one list of contexts runs it, for a text in
// a font and a language the probe names. The environment is detected again at every call.
import { detectEnvironment, fillLine, firstLine, prepare, type Context, type Environment, type GivenFacts } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../src/model.ts'

function environment(): Environment {
  const ua = navigator.userAgent
  const given: GivenFacts = /\bFirefox\//.test(ua) ? { engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null }
    : /\bChrome\//.test(ua) ? { engine: 'blink', build: null, contentLanguage: null, uiLanguage: null }
    : { engine: 'webkit', build: null, contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
  const detected = detectEnvironment(given)
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

// How many lines the text takes at `width`, prepared plain with `contexts` as the page's list.
function lineCount(text: string, family: string, size: number, lang: string, width: number, contexts: Context[]): number {
  const paragraph: Paragraph = {
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    font: { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, content: [{ kind: 'text', text }], lineHeight: 40, direction: 'ltr', lang,
    textIndent: 0, textAlign: 'start',
  }
  const prepared = prepare(paragraph, environment(), false, contexts)
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    lines++
    start = filled.next
  }
  return lines
}

;(globalThis as unknown as { contextsStartUp: unknown }).contextsStartUp = { lineCount }
