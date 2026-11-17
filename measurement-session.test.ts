import { expect, test } from 'bun:test'
import { createMeasurementSession, clearMeasurementSession, prepareWithSegments, layoutWithLines } from './src/layout.js'
import { prepareRichInline, measureRichInlineStats, layoutNextRichInlineLineRange } from './src/rich-inline.js'
import type { MeasurementContext } from './src/measurement.js'

function provider(advance: number, language: string | null = null) {
  let calls = 0
  const languages: (string | null)[] = []
  const session = createMeasurementSession((requestedLanguage) => {
    languages.push(requestedLanguage)
    return {
      font: '10px sans-serif',
      measureText(text) {
        calls += 1
        const width = [...text].length * advance
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
      },
    }
  }, { language })
  return { session, languages, calls: () => calls }
}

const font = '20px sans-serif'

function richWidth(session: ReturnType<typeof createMeasurementSession>): number {
  return measureRichInlineStats(prepareRichInline([
    { text: 'alpha', font }, { text: ' ', font }, { text: 'beta', font },
  ], { measurement: session }), 1e6).maxLineWidth
}

test('plain and rich preparation use supplied contexts without a canvas global', () => {
  const source = provider(10)
  const prepared = prepareWithSegments('alpha beta', font, { measurement: source.session })
  expect(layoutWithLines(prepared, 1e6, 24).lines[0]?.width).toBe(100)
  expect(richWidth(source.session)).toBe(100)
  expect(source.calls()).toBeGreaterThan(0)
  expect(source.languages).toEqual([null])
})

test('same-font caches belong to a session and clearing one leaves another intact', () => {
  const narrow = provider(5)
  const wide = provider(15)
  expect(richWidth(narrow.session)).toBe(50)
  expect(richWidth(wide.session)).toBe(150)
  const narrowCalls = narrow.calls()
  const wideCalls = wide.calls()
  expect(richWidth(narrow.session)).toBe(50)
  expect(narrow.calls()).toBe(narrowCalls)
  clearMeasurementSession(narrow.session)
  expect(richWidth(narrow.session)).toBe(50)
  expect(narrow.calls()).toBeGreaterThan(narrowCalls)
  expect(richWidth(wide.session)).toBe(150)
  expect(wide.calls()).toBe(wideCalls)
})

test('rich atomic items and whitespace share the selected measurement session', () => {
  const source = provider(10, 'en')
  const prepared = prepareRichInline([
    { text: 'alpha', font, break: 'never' }, { text: ' ', font },
    { width: 20 }, { text: 'beta', font },
  ], { measurement: source.session })
  expect(measureRichInlineStats(prepared, 1e6).maxLineWidth).toBe(120)
  expect(layoutNextRichInlineLineRange(prepared, 60)?.width).toBe(50)
  expect(source.languages).toEqual(['en'])
})

test('preparing through another provider inside measurement does not change the active provider', () => {
  const other = provider(15)
  let nested = false
  const session = createMeasurementSession((): MeasurementContext => ({
    font: '20px sans-serif',
    measureText(text) {
      if (!nested) {
        nested = true
        expect(richWidth(other.session)).toBe(150)
      }
      const width = [...text].length * 5
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
    },
  }), { language: null })
  expect(richWidth(session)).toBe(50)
  expect(richWidth(other.session)).toBe(150)
})

test('supplied contexts support non-Latin and emoji preparation without drawing methods', () => {
  const source = provider(10, 'ja')
  for (const text of ['Привет мир', 'かな。中文', 'hello 😀']) {
    const prepared = prepareWithSegments(text, font, { measurement: source.session })
    expect(layoutWithLines(prepared, 500, 24).lineCount).toBeGreaterThan(0)
  }
  expect(source.languages.every(language => language === 'ja')).toBe(true)
})

test('explicit sessions never inspect the page canvas globals, including for emoji', () => {
  const module = new URL('./src/layout.ts', import.meta.url).href
  const source = `
    for (const key of ['OffscreenCanvas', 'document']) {
      Object.defineProperty(globalThis, key, { get() { throw new Error('unexpected global: ' + key) } })
    }
    const { createMeasurementSession, prepareWithSegments, layoutWithLines } = await import(${JSON.stringify(module)})
    const measurement = createMeasurementSession(() => ({
      font: '20px sans-serif',
      measureText(text) { const width = [...text].length * 30; return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width } },
    }), { language: null })
    const prepared = prepareWithSegments('hello 😀', '20px sans-serif', { measurement })
    if (layoutWithLines(prepared, 500, 24).lines.length === 0) throw new Error('no lines')
    console.log('no globals used')
  `
  const result = Bun.spawnSync([process.execPath, '--eval', source])
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toContain('no globals used')
})
