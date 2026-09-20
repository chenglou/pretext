// The page side of tools/store-attack-probe.ts: the library as a page with one list of contexts runs it, for a text in a
// language and a font the probe names. The environment is detected again at every call, as a page that lays out again
// after its document changed would.
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

// The source ranges of the text's lines at `width`, prepared plain with `contexts` as the page's list.
function lines(text: string, family: string, size: number, lang: string, width: number, contexts: Context[]): number[][] {
  const paragraph: Paragraph = {
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    font: { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, content: [{ kind: 'text', text }], lineHeight: 60, direction: 'ltr', lang,
    textIndent: 0, textAlign: 'start',
  }
  const prepared = prepare(paragraph, environment(), false, contexts)
  const out: number[][] = []
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    out.push([filled.start, filled.end])
    start = filled.next
  }
  return out
}

;(globalThis as unknown as { storeAttack: unknown }).storeAttack = { lines }
