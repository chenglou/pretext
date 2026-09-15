// #233 research rows (r0912/ptlg), transcribed from a throwaway 2026-09-12 research harness
// (its tests/wrapping/fixtures/research-0912.ts)
// for the rule-233 ablation. Opt-in with --family=r0912/ptlg; research scope, lineHeight 47.

type ResearchOptions = {
  letterSpacing?: number
  // Both page directions unless a recipe or its section header names one.
  directions?: ReadonlyArray<'ltr' | 'rtl'>
  // Element language; absent means the paragraph inherits the page language.
  lang?: string
  // Absent runs on the fixture page (lang en, fixture fonts). Set, the row runs
  // on an installed-font page with this <html lang>, like maintained witnesses.
  pageLang?: string
  wordBreak?: 'normal' | 'keep-all'
  // Same-font normal inline items, observed with the native item protocol.
  parts?: readonly string[]
}
type Research = (origin: string, text: string, font: string, whiteSpace: 'normal' | 'pre-wrap', widths: readonly number[], options?: ResearchOptions) => void

// Inclusive. Integer stepping and six decimals keep 1/64 px steps exact.
function sweep(from: number, to: number, step: number): number[] {
  const widths: number[] = []
  for (let index = 0; from + index * step <= to + 1e-9; index++) widths.push(Math.round((from + index * step) * 1e6) / 1e6)
  return widths
}

const ARIAL = '16px Arial'
const AMIRI_24 = '24px Amiri'
const NASKH = '16px "Noto Naskh Arabic"'
const HIRAGINO = '16px "Hiragino Sans"'
const MODES = ['normal', 'pre-wrap'] as const
const LTR = ['ltr'] as const
const RTL = ['rtl'] as const
const ltr = { directions: LTR }

// pair-table-and-lb-gaps A-D (header: LTR), engine review checks 1-5 plus the
// normal-mode TAB, and suite review R3-R8. Following suite review R7, A, C and D
// also run in RTL at letter spacing 0 and in LTR at -1 and 1.5.
function ptlg(research: Research): void {
  const widths = sweep(1, 40, 0.5)
  const wide = sweep(1, 60, 0.5)
  const rows: Array<{ origin: string; text: string; font: string; modes: ReadonlyArray<'normal' | 'pre-wrap'>; widths: readonly number[]; language: ResearchOptions }> = []
  const row = (origin: string, texts: readonly string[], modes: ReadonlyArray<'normal' | 'pre-wrap'> = MODES, font = ARIAL, rowWidths: readonly number[] = widths, language: ResearchOptions = {}): void => {
    for (const text of texts) rows.push({ origin, text, font, modes, widths: rowWidths, language })
  }
  row('ptlg/A', ['x?$b', 'x?%b', 'x?+b', 'x?\\b', 'x?|b', 'x!\u00A9b', 'x!\u00BFb', 'x!\u00B0b', 'x!\u00B1b', 'x!<b', 'x!\u00B5b', '$5?$6',
    'x?-b', 'x!\u00ABb', 'x!\u00BBb', 'x!ab', 'x?"b', 'x?)b', 'x!\u20ACb', 'x!\u2211b', 'x?\u20B9b', 'x!\u2019b', 'x!\u2026b', 'x!\u2013b'])
  row('ptlg/C', ['a \u2010b', '\u200B\u2010ab', '\u2010ab', 'a -\u0430b', '-\u0430b', 'a \u2010\u2010b', 'a \u20101', 'a \u2010\u65E5', '(\u2010ab', 'a -b',
    'a -\u00E9b', 'a \u2010\u05D1b', 'a \u2012b', 'a \u2013b'])
  row('ptlg/C', ['a\n\u2010b'], ['pre-wrap'])
  row('ptlg/C', ['a\t\u2010b'], ['normal'])
  row('ptlg/D', ['\u200Dab', '\u200B\u200Dab', 'a \u200Db'])
  row('ptlg/D', ['x\n\u200Dab'], ['pre-wrap'])
  row('ptlg/D', ['\u65E5\u200D\u672C', 'x\u200D\u65E5'], MODES, '16px "Noto Sans CJK JP", "Hiragino Sans", sans-serif', widths, { lang: 'ja' })
  for (const font of [ARIAL, AMIRI_24]) row('ptlg/D', ['a\u3000\u200Db'], MODES, font, wide)
  for (const variant of [{}, { ...ltr, letterSpacing: -1 }, { ...ltr, letterSpacing: 1.5 }]) {
    for (const input of rows) for (const whiteSpace of input.modes) research(input.origin, input.text, input.font, whiteSpace, input.widths, { ...input.language, ...variant })
  }
  for (const whiteSpace of MODES) {
    for (const text of ['\u0628\u061B\u0628\u0628', '\u0628:\u0628\u0628', '\u0628\u060C\u0628\u0628', '\u0628\u061F|\u0628\u0628']) {
      research('ptlg/B', text, NASKH, whiteSpace, widths, { directions: RTL, lang: 'ar' })
    }
    // Engine review section 5 (header: LTR). Check 3, CJ after EX, is not in the
    // roadmap's list; it decides how revision (a) treats CJ per engine.
    for (const text of ['a \u2013b', 'a \u2012b', 'a \u058A\u0561b', 'a \u2E17b', 'a \u05BE\u05D1b', 'a \u2010\u05D1b']) research('ptlg/engine-HH', text, ARIAL, whiteSpace, widths, ltr)
    for (const language of [{}, { lang: 'ja' }]) {
      for (const text of ['\u4EBA\u3005\uFF01\u3005', '\u65E5\uFF01\u309D', '\u65E5\uFF1F\u30FD', '\u65E5!\u303B']) research('ptlg/engine-NS', text, HIRAGINO, whiteSpace, sweep(10, 60, 0.5), { ...ltr, ...language })
      for (const text of ['\u3084\u3063\u305F\u30FC\uFF01\u30FC\u30FC', '\u65E5\uFF1F\u30FC']) research('ptlg/engine-CJ', text, ARIAL, whiteSpace, widths, { ...ltr, ...language })
    }
    for (const text of ['a \u2010\u3105b', 'a \u2010\u1100b', 'a \u2010\uA000b', 'a \u2010\u02C8b', 'a \u2010\u1B05b']) research('ptlg/engine-over-join', text, ARIAL, whiteSpace, widths, ltr)
    for (const text of ['a\u00A0\u2010b', 'a\u00A0-\u0430b']) research('ptlg/engine-GL', text, ARIAL, whiteSpace, widths, ltr)
    // Suite review R3-R8 name directions only where listed.
    for (const text of ['a -\u05D1b', 'a \u2010\u05D1b']) research('ptlg/suite-R3', text, ARIAL, whiteSpace, wide, { lang: 'he' })
    for (const text of ['a -\u0628\u0628', 'a \u2010\u0628\u0628']) research('ptlg/suite-R3', text, NASKH, whiteSpace, wide, { directions: RTL, lang: 'ar' })
    research('ptlg/suite-R3', 'a \u2010\u0E01\u0E32b', ARIAL, whiteSpace, wide, { lang: 'th' })
    research('ptlg/suite-R3', 'a \u2010\u0915b', ARIAL, whiteSpace, wide, { lang: 'hi' })
    for (const text of ['x?-1', '$5?-6', 'https://a.com/?%20x', 'https://x.com/p?-a', '\u00BFQu\u00E9?\u00A1S\u00ED!', 'x?\u300Cx\u300D']) research('ptlg/suite-R6', text, ARIAL, whiteSpace, wide)
    research('ptlg/suite-R6', '\u0628\u061B(\u0628\u0628', NASKH, whiteSpace, wide, { directions: RTL, lang: 'ar' })
    for (const text of ['x?$b', 'x!\u00A9b', '\u65E5\u672C?$5']) research('ptlg/suite-R7', text, ARIAL, whiteSpace, widths, { ...ltr, wordBreak: 'keep-all' })
    for (const text of ['\u200D1', 'x \u200D\u2010abc']) research('ptlg/suite-R8', text, ARIAL, whiteSpace, widths)
    research('ptlg/suite-R8', 'a\u200B\u200D\u65E5\u672C', HIRAGINO, whiteSpace, widths, { lang: 'ja' })
  }
  research('ptlg/engine-TAB', 'a\t\u2010b', ARIAL, 'normal', widths, ltr)
  for (const text of ['a\t\u2010b', 'a\t-\u0430b']) research('ptlg/suite-R4', text, ARIAL, 'pre-wrap', wide)
  for (const text of ['x\u00A0\u2010ab', 'x\u00A0-\u0430b']) research('ptlg/suite-R5', text, ARIAL, 'normal', wide)
  // The revised report's recipe P1 (Chromium HH and HL scope) lists texts the rows
  // above miss. engine-HH-P1 adds them in LTR with the page language, as engine-HH
  // runs; engine-HH-P1-he runs P1's four Hebrew followers with element lang he in
  // both directions, as P1 does. Rows equal to suite-R3's merge with them.
  for (const whiteSpace of MODES) {
    for (const text of ['a \u1400b', 'a -\u05D1b', 'a \u2013\u05D1b']) research('ptlg/engine-HH-P1', text, ARIAL, whiteSpace, widths, ltr)
    for (const text of ['a \u2010\u05D1b', 'a -\u05D1b', 'a \u2013\u05D1b', 'a \u05BE\u05D1b']) research('ptlg/engine-HH-P1-he', text, ARIAL, whiteSpace, widths, { lang: 'he' })
  }
}

export function researchRecipes233(research: Research): void {
  ptlg(research)
}
