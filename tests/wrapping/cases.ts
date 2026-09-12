import {
  ACCURACY_FONTS,
  TEXTS,
  SIZES,
  WIDTHS,
  PRE_WRAP_ORACLE_CASES,
  KEEP_ALL_ORACLE_CASES,
  SYMBOL_ORACLE_CASES,
  LETTER_SPACING_ORACLE_CASES,
  DISCRETIONARY_ORACLE_CASES,
  type ProbeOracleCase,
} from '../../src/test-data.ts'
import { visitRetained } from './fixtures/retained.ts'
import { ordinaryReasons } from './fixtures/ordinary.ts'
import { sourceViewCases } from './fixtures/source-views.ts'
import directionData from './fixtures/direction-conflicts.json' with { type: 'json' }
import { corpusSources, corpusTexts } from './fixtures/corpora.ts'
import {
  generateCases as policyCases,
  generateLanguageCases,
  generateSeamCases,
  generateAcceptanceCases,
} from './fixtures/policy.ts'
import type { BrowserKind, WrappingCase } from './types.ts'

export type { BrowserKind, WrappingCase } from './types.ts'

export type CaseSelection = {
  schedule: 'ordinary' | 'full'
  browser: BrowserKind
  direction?: 'ltr' | 'rtl'
  family?: string
}

type Measure = (text: string, font: string, letterSpacing: number) => number

const compactOracles = [
  ['pre-wrap', PRE_WRAP_ORACLE_CASES], ['keep-all', KEEP_ALL_ORACLE_CASES],
  ['symbols', SYMBOL_ORACLE_CASES], ['letter-spacing', LETTER_SPACING_ORACLE_CASES],
] as const

// Two independent 32-bit accumulators give short content-derived IDs. The full
// semantic key remains the deduplication key; IDs are checked for collisions.
function fingerprint(text: string): string {
  let a = 2166136261
  let b = 5381
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 16777619)
    b = Math.imul(b, 33) ^ code
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

function semanticKey(input: Omit<WrappingCase, 'id'>): string {
  return JSON.stringify([
    input.text, input.parts ?? null, input.font, input.fontFixture ?? null,
    input.width, input.lineHeight, input.whiteSpace, input.wordBreak,
    input.letterSpacing, input.direction, input.lang ?? null, input.locale ?? null,
    ...(input.lineMethod === undefined && input.heightMode === undefined && input.nativeSource === undefined && input.heightSource === undefined && input.context === undefined
      ? [] : [[input.lineMethod ?? null, input.heightMode ?? null, input.nativeSource ?? null, input.heightSource ?? null, input.context ?? null]]),
    ...(input.nativeItems === undefined ? [] : [input.nativeItems]),
  ])
}

const defaults = {
  font: '16px Arial', lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
  letterSpacing: 0, direction: 'ltr', scope: 'supported',
} as const

export function generateCases(measure: Measure, selection: CaseSelection): WrappingCase[] {
  const cases = new Map<string, WrappingCase>()
  const ids = new Map<string, string>()
  const family = selection.family
  const matchingFamilies = new Set<string>()
  const ordinaryKeys = new Set<string>()
  const add = (input: Omit<WrappingCase, 'id'>, ordinary = true): void => {
    if (input.browsers !== undefined && !input.browsers.includes(selection.browser)) return
    if (selection.direction !== undefined && input.direction !== selection.direction) return
    const key = semanticKey(input)
    if (ordinary) ordinaryKeys.add(key)
    if (family !== undefined && (input.family.includes(family) || input.origins.some(origin => origin.includes(family)))) matchingFamilies.add(key)
    const previous = cases.get(key)
    if (previous !== undefined) {
      for (const origin of input.origins) if (!previous.origins.includes(origin)) previous.origins.push(origin)
      if (input.detail !== 'height') previous.detail = 'full'
      if (input.scope === 'research') {
        previous.scope = 'research'
        previous.family = input.family
      }
      if (input.note !== undefined && previous.note !== input.note) {
        previous.note = previous.note === undefined ? input.note : `${previous.note} ${input.note}`
      }
      if (input.discretionary !== undefined) previous.discretionary = input.discretionary
      if (input.emergencyGraphemes === true) previous.emergencyGraphemes = true
      if (input.required !== undefined) previous.required = [...new Set([...(previous.required ?? []), ...input.required])]
      return
    }
    const id = `wrap-${fingerprint(key)}`
    const previousKey = ids.get(id)
    if (previousKey !== undefined && previousKey !== key) throw new Error(`Fixture ID collision: ${id}`)
    ids.set(id, key)
    cases.set(key, { id, ...input })
  }

  visitRetained((input, widths) => {
    if (selection.direction !== undefined && input.direction !== selection.direction) return
    const selectedReasons = ordinaryReasons(input, widths)
    for (let index = 0; index < widths.length; index++) {
      const width = widths[index]!
      const reasons = selectedReasons[index]!
      add({ ...input, origins: input.origins.concat(reasons.map(reason => `behavior/${reason}`)), width }, reasons.length > 0)
    }
  })

  // Promote existing observations without growing the full matrix. The last
  // witness requires different native line counts in Chromium and Gecko.
  for (const input of [
    { text: 'a\u2060\u0301b', font: '16px Courier New', width: 1, letterSpacing: -4,
      whiteSpace: 'pre-wrap', browsers: ['chrome'] },
    { text: 'a\u2060\u2060\u0301b', font: '16px Courier New', width: 12, letterSpacing: 1,
      whiteSpace: 'pre-wrap', browsers: ['chrome', 'firefox'] },
    { text: 'a\u200e\u0301b', font: '16px Arial', width: 6.229999732971191, letterSpacing: -1,
      lineHeight: 48, whiteSpace: 'normal', browsers: ['chrome', 'firefox'] },
  ] as const) {
    add({ ...defaults, ...input, browsers: [...input.browsers], family: 'entry-geometry',
      origins: ['maintained/entry-geometry'], required: ['height', 'lineCount', 'api'] })
  }

  add({ ...defaults, text: '\u200B', width: 1, letterSpacing: 1,
    family: 'standalone-zwsp', origins: ['maintained/standalone-zwsp'],
    heightSource: 'layout', heightMode: 'exact', required: ['height', 'lineCount', 'api'] })

  // Same-font inline items break where their joined text breaks in Chromium;
  // WebKit breaks inside each item from its own text. Pretext still breaks at
  // every item boundary in Firefox, so the two rows required in Chrome and Safari
  // only observe Firefox. They sit inside wide native bands where all three
  // browsers agree. The others observe engine-sensitive shapes, including the
  // fitting control after the comma row.
  const richBoundary = (label: string, parts: string[], width: number, options: Partial<Omit<WrappingCase, 'id' | 'text' | 'parts' | 'width'>> = {}): void => {
    add({ ...defaults, family: 'maintained/rich-boundaries', origins: [`maintained/rich-boundaries/${label}`],
      context: { kind: 'installed', lang: 'en' }, lang: 'en', ...options, text: parts.join(''), parts, width, nativeItems: true })
  }
  const community = ['prioritized by our ', 'community', ', projects are led by engineers']
  const zh = { context: { kind: 'installed', lang: 'zh' }, lang: 'zh' } as const
  const th = { context: { kind: 'installed', lang: 'th' }, lang: 'th' } as const
  const perItem = 'WebKit finds breaks inside each inline box from its own text, so spans and one text node wrap differently at this width.'
  const everyBoundary = 'Pretext breaks at every item boundary in Firefox, where Gecko keeps a word together across text frames.'
  for (const [label, parts, width] of [
    ['parenthesized-item', ['see (', 'docs', ') now please'], 64],
    ['split-word', ['Hello wor', 'ld again and again'], 75],
  ] as const) {
    richBoundary(label, [...parts], width, { required: ['richHeight'], browsers: ['chrome', 'safari'] })
    richBoundary(label, [...parts], width, { browsers: ['firefox'], note: everyBoundary })
  }
  richBoundary('leading-comma', community, 106)
  richBoundary('leading-comma-fits', community, 112)
  richBoundary('after-hyphen', ['A long line with state-', 'of-the-art tools and more words'], 55)
  richBoundary('kinsoku', ['\u4E2D\u6587\u4E2D\u6587\u4E2D\u6587', '\u3002\u65E5\u672C\u8A9E\u3067\u3059'], 130, { ...zh, font: '20px Arial', lineHeight: 24 })
  richBoundary('closing-bracket', ['\u4E2D\u6587\u4E2D\u6587\u4E2D\u6587', '\uFF09\u4E2D\u6587\u4E2D\u6587\u4E2D\u6587'], 50, { ...zh, font: '20px "Songti SC", "PingFang SC", serif', lineHeight: 24 })
  richBoundary('thai-split-word', ['\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E27\u0E22\u0E07', '\u0E32\u0E21\u0E02\u0E2D\u0E07\u0E18\u0E23\u0E23\u0E21\u0E0A\u0E32\u0E15\u0E34\u0E17\u0E33\u0E43\u0E2B\u0E49\u0E1C\u0E39\u0E49\u0E04\u0E19\u0E21\u0E35\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E38\u0E02\u0E21\u0E32\u0E01\u0E02\u0E36\u0E49\u0E19\u0E17\u0E38\u0E01\u0E27\u0E31\u0E19'], 70, {
    ...th, font: '16px Thonburi', lineHeight: 24, note: perItem,
  })
  richBoundary('thai-split-word-20px', ['\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E27\u0E22\u0E07', '\u0E32\u0E21\u0E02\u0E2D\u0E07\u0E18\u0E23\u0E23\u0E21\u0E0A\u0E32\u0E15\u0E34\u0E17\u0E33\u0E43\u0E2B\u0E49\u0E1C\u0E39\u0E49\u0E04\u0E19\u0E21\u0E35\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E38\u0E02'], 90, {
    ...th, font: '20px "Thonburi", "Noto Sans Thai", sans-serif', lineHeight: 32, note: perItem,
  })
  richBoundary('myanmar-split-word', ['\u1019\u103C\u1014\u103A\u1019\u102C\u1018\u102C\u101E', '\u102C\u101E\u100A\u103A\u101C\u103E\u1015\u101E\u1031\u102C\u1018\u102C\u101E\u102C\u1016\u103C\u1005\u103A\u101E\u100A\u103A'], 88, {
    context: { kind: 'installed', lang: 'my' }, lang: 'my', font: '16px "Myanmar Sangam MN"', lineHeight: 24,
    note: `${perItem} Gecko segments this joined text differently from Chromium, so Pretext breaks at every item boundary in Firefox.`,
  })

  const recipeMeasure = (text: string, font: string): number => measure(text, font, 0)
  for (const recipe of [policyCases, generateLanguageCases, generateSeamCases, generateAcceptanceCases]) {
    for (const input of recipe(recipeMeasure)) {
      add({
        ...defaults, family: `policy/${input.family}`, origins: [`policy-matrix/${input.split}`, `policy-matrix/${input.widthRule}`],
        text: input.parts.join(''), ...(input.parts.length > 1 ? { parts: input.parts } : {}),
        font: input.font, width: input.width, lineHeight: input.lineHeight,
        whiteSpace: input.whiteSpace, wordBreak: input.wordBreak, letterSpacing: input.letterSpacing,
        direction: input.direction, ...(input.lang === undefined ? {} : { lang: input.lang, locale: input.lang }),
      }, recipe === generateAcceptanceCases)
    }
  }

  const addOracle = (family: string, input: ProbeOracleCase): void => {
    const direction = input.dir ?? 'ltr'
    add({ ...defaults, family, origins: [`maintained/${family}/${input.label}`],
      text: input.text, font: input.font, width: input.width - 80, lineHeight: input.lineHeight,
      whiteSpace: input.whiteSpace ?? (family === 'pre-wrap' ? 'pre-wrap' : 'normal'),
      wordBreak: input.wordBreak ?? (family === 'keep-all' ? 'keep-all' : 'normal'),
      letterSpacing: input.letterSpacing ?? 0, direction,
      lang: input.lang ?? (direction === 'rtl' ? 'ar' : 'en'),
      context: { kind: 'installed', lang: input.lang ?? (direction === 'rtl' ? 'ar' : 'en') },
      browsers: input.browsers === undefined ? ['chrome', 'safari'] : [...input.browsers],
      lineMethod: input.method ?? (family === 'pre-wrap' || family === 'keep-all' ? 'span' : 'range'),
      heightMode: 'exact', heightSource: 'layout', required: family === 'keep-all' || family === 'symbols' ? ['height', 'lineCount', 'breaks'] : ['height', 'lineCount'],
    })
  }
  for (const [family, inputs] of compactOracles) for (const input of inputs) addOracle(family, input)
  for (const input of DISCRETIONARY_ORACLE_CASES) {
    add({ ...defaults, family: 'maintained/discretionary', origins: [`maintained/discretionary/${input.label}`],
      text: input.text, font: input.font, width: input.width, lineHeight: input.lineHeight,
      whiteSpace: input.whiteSpace ?? 'normal', letterSpacing: input.letterSpacing ?? 0,
      heightMode: 'exact', heightSource: 'lines', context: { kind: 'installed', lang: 'en' },
      ...(input.expectedText === undefined ? {} : { discretionary: { expectedText: [...input.expectedText] }, required: ['height', 'lineCount', 'widths', 'hyphen'] }) })
  }

  // The canonical dashboard historically measures height, not source placement.
  for (const family of ACCURACY_FONTS) for (const size of SIZES) for (const width of WIDTHS) for (const sample of TEXTS) {
    add({ ...defaults, family: 'maintained/accuracy', origins: [`accuracy/${sample.label}`],
      text: sample.text, font: `${size}px ${family}`, width, lineHeight: Math.round(size * 1.2), lang: 'en', context: { kind: 'installed', lang: 'en' },
      detail: 'height', heightMode: 'accuracy', heightSource: 'layout', required: ['height'] })
  }
  for (const meta of corpusSources) {
    const text = corpusTexts[meta.id]
    if (text === undefined) throw new Error(`Missing maintained corpus ${meta.id}`)
    const size = meta.font_size_px ?? 18
    for (let width = meta.min_width ?? 300; width <= (meta.max_width ?? 900); width += 10) {
      add({ ...defaults, family: 'maintained/corpus', origins: [`corpora/${meta.id}`], text, nativeSource: 'normalized',
        font: `${size}px ${meta.font_family ?? 'serif'}`, width: width - 80, lineHeight: meta.line_height_px ?? Math.round(size * 1.6),
        direction: meta.direction === 'rtl' ? 'rtl' : 'ltr', lang: meta.language, context: { kind: 'installed', lang: meta.language },
        detail: 'height', heightMode: 'corpus', heightSource: 'layout' })
    }
  }

  // Native direction changes observable results despite identical public prepare arguments.
  // Keep both observations and the limitation; do not exempt unrelated RTL cases.
  for (const row of directionData) {
    const input = row.input
    add({ ...defaults, family: 'unprovided-direction', origins: [row.origin], scope: 'research',
      browsers: row.origin.endsWith('/chrome-direction.json') ? ['chrome'] : ['firefox'],
      text: input.parts.join(''), font: input.font, width: input.width, lineHeight: input.lineHeight,
      whiteSpace: input.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal',
      wordBreak: input.wordBreak === 'keep-all' ? 'keep-all' : 'normal', letterSpacing: input.letterSpacing,
      direction: input.direction === 'rtl' ? 'rtl' : 'ltr',
      note: 'Paired native LTR/RTL outcomes conflict for the same public preparation arguments. Retained as an input-contract decision, not a blanket RTL waiver.' })
  }

  addReportedCases(add, measure)
  for (const input of sourceViewCases) add(input)
  for (const [text, width, whiteSpace] of [
    ['a\u00adb', 8, 'normal'], ['a\u00adb', 10, 'normal'], ['a\u00adb', 14, 'normal'], ['a\u00adb', 100, 'normal'],
    ['a\u00ad\u00adb', 10, 'normal'], ['\u200babcd', 10, 'normal'], ['  ab\t cd  ', 20, 'pre-wrap'],
  ] as const) add({ ...defaults, family: 'observer-controls', origins: ['observer-controls'], text, width, whiteSpace })
  // Exact Safari paint contracts corroborated by engine traces and screenshots.
  add({ ...defaults, text: 'a\u00ad\u201cb', width: 14.25, whiteSpace: 'pre-wrap',
    lineHeight: 48, heightMode: 'exact', heightSource: 'layout', browsers: ['safari'],
    family: 'observer-controls', origins: ['observer-controls/quote-marker'],
    discretionary: { expectedText: ['a-', '\u201cb'] }, required: ['height', 'hyphen', 'widths', 'api'] })
  add({ ...defaults, text: 'a\u00adb', width: 10, whiteSpace: 'pre-wrap', wordBreak: 'keep-all',
    lineHeight: 48, heightMode: 'exact', heightSource: 'layout', browsers: ['safari'],
    family: 'observer-controls', origins: ['observer-controls/keep-all-hidden-marker'],
    discretionary: { expectedText: ['a', 'b'] }, required: ['height', 'api'],
    note: 'Known main marker/width failure: native paints a / b. A positive SHY Range is source allocation, not a hyphen.' })
  for (const cluster of ['e\u0301', '👩‍💻', '👍🏽', 'क्ष']) for (const text of [cluster, `a${cluster}b`]) {
    add({ ...defaults, family: 'emergency-graphemes', origins: ['emergency-graphemes'], text, width: 1, emergencyGraphemes: true })
  }
  // A family selects inputs, not a different assertion contract. Merge every
  // alias first so filtered replays retain the same scope and observation detail.
  const all: WrappingCase[] = []
  for (const [key, input] of cases) {
    if ((family === undefined || matchingFamilies.has(key)) && (selection.schedule === 'full' || ordinaryKeys.has(key))) all.push(input)
  }
  return all
}

function addReportedCases(add: (input: Omit<WrappingCase, 'id'>) => void, measure: Measure): void {
  const report = (issue: string, text: string, width: number, options: Partial<Omit<WrappingCase, 'id' | 'text' | 'width'>> = {}): void => {
    add({ ...defaults, family: `reported/${issue}`, origins: [`issue/${issue}`], text, width, ...options })
  }
  // Keep the filed CSS and independent Canvas thresholds alongside the older
  // neighboring probes. Boundary, rich and flat #210 reproductions are required.
  const installed = { context: { kind: 'installed', lang: 'en' }, lang: 'en' } as const
  const zwsp = { ...installed, font: '12px Calibri, sans-serif', lineHeight: 20.96,
    whiteSpace: 'pre-wrap', origins: ['issue/#210-#211', 'reported-reproduction/#210'] } as const
  report('#210-#211', '\u200B≤100nA\u200B', 25, { ...zwsp, origins: [...zwsp.origins], required: ['height', 'lineCount', 'source', 'api'] })
  report('#210-#211', '\u200B', 25, { ...zwsp, origins: [...zwsp.origins], required: ['height', 'lineCount', 'api'] })
  const numericFont = '16px Arial, sans-serif'
  for (const [text, prefix] of [['-0.475', '-0.47'], ['≥-100nA', '≥-100n']] as const) {
    report('#212-#213', text, measure(prefix, numericFont, 0) + 0.1, {
      ...installed, font: numericFont, origins: ['issue/#212-#213', 'reported-reproduction/#212'],
      required: ['height', 'lineCount', 'source', 'api'],
    })
  }
  report('#214-#215', '(试验前-试验后)/试验前', measure('前-试验', '20px Arial', 0) + 0.1, {
    ...installed, font: '20px Arial', lineHeight: 28, whiteSpace: 'pre-wrap',
    origins: ['issue/#214-#215', 'reported-reproduction/#214'], required: ['height', 'lineCount', 'source', 'api'],
  })
  const richWitness = (parts: string[], width: number, letterSpacing = 0): void => {
    report('#210-#211', parts.join(''), width, { ...installed, parts, letterSpacing, nativeItems: true,
      origins: ['issue/#210-#211', 'reported-reproduction/#210-rich'], required: ['richHeight'] })
  }
  for (const parts of [['\u200B', 'hello'], ['\u200B', '', 'hello'], ['a', '\u200B', 'hello']]) {
    for (const width of [1, 30, 60]) richWitness(parts, width)
  }
  richWitness(['', '\u200B', 'hello'], 30)
  for (const letterSpacing of [-1, 1]) richWitness(['\u200B', 'hello'], 30, letterSpacing)
  for (const [control, width, letterSpacing] of [['\u200B', 10.671875, 0], ['\u2060', 9.651875, -1]] as const) {
    report('#210-#211', `A${control}`, width, {
      ...installed, font: '16px Arial', lineHeight: 24, parts: ['A', control], letterSpacing, nativeItems: true,
      origins: ['issue/#210-#211', 'rich-admission/exact-fit'], required: ['richHeight'],
    })
  }
  for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
    report('#210-#211', '\u200B≤100nA\u200B', 105, { font: '12px Arial', whiteSpace })
    report('#210-#211', '\u200B', 105, { font: '12px Arial', whiteSpace })
    for (const parts of [['\u200B', 'hello'], ['', '\u200B', 'hello'], ['a', '\u200B', 'hello']]) {
      for (const width of [1, 30, 60]) for (const letterSpacing of [-1, 0, 1]) {
        report('#210-#211', parts.join(''), width, { parts, whiteSpace, letterSpacing })
      }
    }
  }
  for (const text of ['-0.475', '≥-100nA', 'well-known', 'x-100']) {
    for (const width of [measure(text.slice(0, 2), '16px Arial', 0) + 0.1, measure(text, '16px Arial', 0) * 0.65]) report('#212-#213', text, width)
  }
  for (const text of ['(试验前-试验后)/试验前', '温度-5度', '温度-100nA', '日本語foo-5', 'foo -bar']) {
    for (const wordBreak of ['normal', 'keep-all'] as const) for (const width of [28, 60, 108, 147]) {
      report('#214-#215', text, width, { font: '20px Arial', lineHeight: 28, wordBreak, lang: 'zh' })
    }
  }
  const text = ('{'.repeat(13) + ']'.repeat(13) + '\\'.repeat(13) + '|'.repeat(20) + '\\').repeat(5)
  for (const width of [50, 160, 320]) for (const letterSpacing of [0, 1]) report('#208', text, width, { letterSpacing, required: ['height', 'source', 'api'] })
}
