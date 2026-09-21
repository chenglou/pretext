// The page side of tools/contexts-heal-attack-probe.ts: a paragraph prepared once and kept, its lines at any width later,
// and how many Canvas contexts it holds. The environment is detected again at every call.
import { detectEnvironment, fillLine, firstLine, prepare, createContextPool, type ContextPool, type Environment, type GivenFacts, type Prepared } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type OverflowWrap, type Paragraph } from '../src/model.ts'

function environment(): Environment {
  const ua = navigator.userAgent
  const given: GivenFacts = /\bFirefox\//.test(ua) ? { engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null }
    : /\bChrome\//.test(ua) ? { engine: 'blink', build: null, contentLanguage: null, uiLanguage: null }
    : { engine: 'webkit', build: null, contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
  const detected = detectEnvironment(given)
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

function prepared(text: string, family: string, size: number, lang: string, overflowWrap: OverflowWrap, contexts: ContextPool): Prepared {
  const paragraph: Paragraph = {
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap, lineBreak: 'auto', tabSize: 8,
    font: { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, content: [{ kind: 'text', text }], lineHeight: 40, direction: 'ltr', lang,
    textIndent: 0, textAlign: 'start',
  }
  return prepare(paragraph, environment(), false, contexts)
}

function linesOf(kept: Prepared, width: number): number {
  let lines = 0
  for (let start = firstLine(kept); start !== null;) {
    const filled = fillLine(kept, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    lines++
    start = filled.next
  }
  return lines
}

// Where the kept paragraph's lines end at `width`, as source offsets: finer than their count.
function lineEnds(kept: Prepared, width: number): string {
  const ends: number[] = []
  for (let start = firstLine(kept); start !== null;) {
    const filled = fillLine(kept, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    ends.push(filled.end)
    start = filled.next
  }
  return ends.join(' ')
}

// The Canvas contexts a Gecko paragraph holds, which grows where a fill makes one (engines/gecko/measure.ts
// noLigaturesContext, advance.ts largeContext); -1 for the other engines, whose probes don't read it.
function contextsHeld(kept: Prepared): number {
  switch (kept.engine) {
    case 'gecko': return kept.state.contexts.size
    case 'blink': return -1
    case 'webkit': return -1
  }
}

;(globalThis as unknown as { contextsHealAttack: unknown }).contextsHealAttack = { prepared, linesOf, lineEnds, contextsHeld, createContextPool }
