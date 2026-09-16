import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stratifiedSample, type SampleOptions } from './sample.ts'
import { convertSuiteInput, parseSuiteInput, streamRowInputs, SuiteImport } from './suite.ts'

const base = {
  id: 'wrap-0000000000000001', family: 'space', scope: 'supported', origins: ['x'], text: 'hello world', font: '16px Arial',
  width: 40, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
}

describe('convertSuiteInput', () => {
  test('a fixture-page input runs under en with its fixture font loaded', () => {
    const [converted, ...rest] = convertSuiteInput(parseSuiteInput({
      ...base, text: 'بِبِ', font: '24px Amiri', fontFixture: 'Amiri', whiteSpace: 'pre-wrap', letterSpacing: 1.5, direction: 'rtl', lineHeight: 48, locale: 'ar',
    }))
    expect(rest).toEqual([])
    expect(converted!.pageLang).toBe('en')
    expect(converted!.fontFixtures).toEqual(['Amiri'])
    const p = converted!.paragraph
    expect(p.lang).toBe('en')
    expect(p.overflowWrap).toBe('break-word')
    expect(p.lineBreak).toBe('auto')
    expect(p.tabSize).toBe(8)
    expect(p.whiteSpace).toBe('pre-wrap')
    expect(p.runs).toEqual([{ text: 'بِبِ', node: 'text', font: { family: 'Amiri', size: 24, weight: 400, style: 'normal' }, letterSpacing: 1.5, wordSpacing: 0, lang: null }])
  })

  test('an installed-context input runs in its context language without fixture fonts', () => {
    const [converted] = convertSuiteInput(parseSuiteInput({
      ...base, font: '20px "Noto Nastaliq Urdu", "Geeza Pro", serif', context: { kind: 'installed', lang: 'ur' },
    }))
    expect(converted!.pageLang).toBe('ur')
    expect(converted!.paragraph.lang).toBe('ur')
    expect(converted!.fontFixtures).toEqual([])
  })

  test('an explicit paragraph language wins, including the empty language', () => {
    expect(convertSuiteInput(parseSuiteInput({ ...base, lang: 'zh' }))[0]!.paragraph.lang).toBe('zh')
    expect(convertSuiteInput(parseSuiteInput({ ...base, lang: '' }))[0]!.paragraph.lang).toBe('')
  })

  test('native inline items add a span-per-part variant', () => {
    const converted = convertSuiteInput(parseSuiteInput({ ...base, text: '​hello', parts: ['​', '', 'hello'], nativeItems: true }))
    expect(converted.map(entry => entry.variant)).toEqual(['text', 'items'])
    expect(converted[1]!.paragraph.runs.map(run => [run.node, run.text])).toEqual([['span', '​'], ['span', ''], ['span', 'hello']])
    expect(() => convertSuiteInput(parseSuiteInput({ ...base, parts: ['hello'], nativeItems: true }))).toThrow()
  })

  test('parts without native items stay one text node', () => {
    expect(convertSuiteInput(parseSuiteInput({ ...base, parts: ['hello ', 'world'] }))).toHaveLength(1)
  })

  test('fails loudly on unknown shapes', () => {
    expect(() => parseSuiteInput({ ...base, whiteSpace: 'pre' })).toThrow()
    expect(() => parseSuiteInput({ ...base, width: '40' })).toThrow()
    expect(() => parseSuiteInput({ ...base, browsers: ['edge'] })).toThrow()
    expect(() => convertSuiteInput(parseSuiteInput({ ...base, font: 'oblique 16px Arial' }))).toThrow()
    expect(() => convertSuiteInput(parseSuiteInput({ ...base, font: '16px Arial', fontFixture: 'Amiri' }))).toThrow()
  })
})

describe('SuiteImport', () => {
  test('merges semantic duplicates across browsers and library-only options', () => {
    const suite = new SuiteImport()
    suite.add({ ...base, id: 'wrap-a', family: 'zeta', browsers: ['firefox'], locale: 'en' })
    suite.add({ ...base, id: 'wrap-b', family: 'alpha', browsers: ['chrome'], detail: 'height', heightMode: 'exact' })
    suite.add({ ...base, id: 'wrap-a', family: 'zeta', browsers: ['firefox'] })
    const entries = suite.entries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ family: 'suite/alpha', pageLang: 'en', required: false, oldFamilies: ['alpha', 'zeta'] })
    const value = suite.materialize(entries[0]!.id)
    expect(value.browsers).toEqual(['chrome', 'firefox'])
    expect(value.family).toBe('suite/alpha')
    expect(value.origin).toBe('suite alpha wrap-b; zeta wrap-a')
    expect(Object.keys(value.paragraph)[0]).toBe('runs')
  })

  test('an input without a browser scope applies everywhere; required families are preferred', () => {
    const suite = new SuiteImport()
    suite.add({ ...base, id: 'wrap-a', family: 'alpha', browsers: ['safari'] })
    suite.add({ ...base, id: 'wrap-c', family: 'maintained/zzz', required: ['height'] })
    const [entry] = suite.entries()
    expect(entry!.family).toBe('suite/maintained/zzz')
    expect(entry!.required).toBe(true)
    expect(suite.materialize(entry!.id).browsers).toBeUndefined()
  })

  test('fixture fonts are part of the identity and come out sorted', () => {
    const suite = new SuiteImport()
    suite.add({ ...base, font: '16px "Noto Naskh Arabic", Amiri, serif' })
    const [entry] = suite.entries()
    expect(entry!.fontFixtures).toEqual(['Amiri', 'Noto Naskh Arabic'])
    expect(suite.materialize(entry!.id).fontFixtures).toEqual(['Amiri', 'Noto Naskh Arabic'])
  })

  test('different content stays separate', () => {
    const suite = new SuiteImport()
    suite.add(base)
    suite.add({ ...base, width: 41 })
    suite.add({ ...base, context: { kind: 'installed', lang: 'ja' } })
    expect(suite.entries()).toHaveLength(3)
  })
})

describe('streamRowInputs', () => {
  test('reads inputs from rows, including texts that mention the native marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lab-cases-'))
    const path = join(dir, 'rows.ndjson')
    const inputs = [base, { ...base, text: 'a,"native":b' }, { ...base, text: 'é'.repeat(70000) }]
    const lines = [
      JSON.stringify({ input: inputs[0], native: { height: 20 }, predictions: [] }),
      JSON.stringify({ input: inputs[1], native: { height: 20 }, predictions: [] }),
      JSON.stringify({ native: { height: 20 }, input: inputs[2] }),
    ]
    writeFileSync(path, `${lines.join('\n')}\n`)
    const seen: unknown[] = []
    expect(await streamRowInputs(path, input => seen.push(input))).toBe(3)
    expect(seen).toEqual(inputs)
  })
})

describe('stratifiedSample', () => {
  type Item = { family: string; id: string; required: boolean }
  const items: Item[] = []
  for (let f = 0; f < 5; f++) {
    const size = [50, 300, 1000, 5000, 12][f]!
    for (let i = 0; i < size; i++) items.push({ family: `f${f}`, id: `f${f}-${i}`, required: f === 3 && i < 20 })
  }
  const options: SampleOptions<Item> = { family: item => item.family, id: item => item.id, keepFamiliesUpTo: 200, keep: item => item.required }

  test('keeps small families and required items, then water-fills the rest', () => {
    const result = stratifiedSample(items, 1000, 'seed', options)
    expect(result.selected).toHaveLength(1000)
    const counts = new Map<string, number>()
    for (const item of result.selected) counts.set(item.family, (counts.get(item.family) ?? 0) + 1)
    expect(counts.get('f0')).toBe(50)
    expect(counts.get('f4')).toBe(12)
    expect(result.selected.filter(item => item.required)).toHaveLength(20)
    // 1000 - 82 kept = 918 over three large families: quota 306, f1 has only 300.
    expect(counts.get('f1')).toBe(300)
    expect(Math.abs(counts.get('f2')! - (counts.get('f3')! - 20))).toBeLessThanOrEqual(1)
  })

  test('does not depend on input order', () => {
    const forward = stratifiedSample(items, 700, 'seed', options).selected.map(item => item.id).sort()
    const backward = stratifiedSample(items.slice().reverse(), 700, 'seed', options).selected.map(item => item.id).sort()
    expect(backward).toEqual(forward)
  })

  test('keeps everything it must even over budget', () => {
    const result = stratifiedSample(items, 10, 'seed', options)
    expect(result.overBudget).toBe(true)
    expect(result.selected).toHaveLength(82)
  })
})
