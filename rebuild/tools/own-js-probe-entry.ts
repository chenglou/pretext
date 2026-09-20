// The page side of tools/own-js-probe.ts: the library as a chat application runs it, with one list of Canvas contexts a
// pass, behind a few functions the probe's script calls. Bundled by the probe module from each checkout it compares.
import { blinkFontChecks } from '../src/engines/blink/checks.ts'
import * as blink from '../src/engines/blink/index.ts'
import { geckoFontChecks } from '../src/engines/gecko/checks.ts'
import * as gecko from '../src/engines/gecko/index.ts'
import { webkitFontChecks } from '../src/engines/webkit/checks.ts'
import * as webkit from '../src/engines/webkit/index.ts'
import { detectEnvironment, fillLine, firstLine, prepare, type Context, type Environment, type GivenFacts, type Prepared } from '../src/index.ts'
import { withLearnedFontFacts } from '../src/measure/font-checks.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'

type Part = { code: boolean; text: string }

function environment(): Environment {
  const ua = navigator.userAgent
  const given: GivenFacts = /\bFirefox\//.test(ua) ? { engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null }
    : /\bChrome\//.test(ua) ? { engine: 'blink', build: null, contentLanguage: null, uiLanguage: null }
    : { engine: 'webkit', build: null, contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
  const detected = detectEnvironment(given)
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

// bench/page.ts chatInputs: no font facts supplied.
function paragraphOf(parts: readonly Part[]): Paragraph {
  const font: FontDecl = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: 6 }
  const content: InlineNode[] = []
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}

function fillAll(prepared: Prepared, width: number): number {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

// Every message from scratch with one list of contexts for the pass, started here.
function scratch(paragraphs: readonly Paragraph[], env: Environment, width: number): number {
  const contexts: Context[] = []
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) lines += fillAll(prepare(paragraphs[i]!, env, false, contexts), width)
  return lines
}

// The same with prepare() as the two halves src/index.ts joins and a timer around each and around the fill
// (bench/page.ts chatPhases). `into` gets the milliseconds added.
function scratchPhases(paragraphs: readonly Paragraph[], env: Environment, width: number, into: { checks: number; prepare: number; fill: number }): number {
  const contexts: Context[] = []
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const t0 = performance.now()
    let prepared: Prepared
    let t1: number
    switch (env.engine) {
      case 'blink': {
        const checked = withLearnedFontFacts(paragraphs[i]!, blinkFontChecks(env), contexts)
        t1 = performance.now()
        prepared = { engine: 'blink', state: blink.prepare(checked, env, false, contexts) }
        break
      }
      case 'webkit': {
        const checked = withLearnedFontFacts(paragraphs[i]!, webkitFontChecks, contexts)
        t1 = performance.now()
        prepared = { engine: 'webkit', state: webkit.prepare(checked, env, false, contexts) }
        break
      }
      case 'gecko': {
        const checked = withLearnedFontFacts(paragraphs[i]!, geckoFontChecks, contexts)
        t1 = performance.now()
        prepared = { engine: 'gecko', state: gecko.prepare(checked, env, false, contexts) }
        break
      }
    }
    const t2 = performance.now()
    lines += fillAll(prepared, width)
    const t3 = performance.now()
    into.checks += t1 - t0
    into.prepare += t2 - t1
    into.fill += t3 - t2
  }
  return lines
}

function prepareAll(paragraphs: readonly Paragraph[], env: Environment, width: number): Prepared[] {
  const contexts: Context[] = []
  const out: Prepared[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    out.push(prepare(paragraphs[i]!, env, false, contexts))
    fillAll(out[i]!, width)
  }
  return out
}

function relayout(prepared: readonly Prepared[], widths: readonly number[]): number {
  let lines = 0
  for (let w = 0; w < widths.length; w++) for (let i = 0; i < prepared.length; i++) lines += fillAll(prepared[i]!, widths[w]!)
  return lines
}

(globalThis as unknown as { ownJs: unknown }).ownJs = { environment, paragraphOf, scratch, scratchPhases, prepareAll, relayout }
