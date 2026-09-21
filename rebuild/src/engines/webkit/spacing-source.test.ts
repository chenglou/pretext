import { expect, test } from 'bun:test'
import { SpacingSource } from './spacing-source.js'
import { inRanges } from './data.js'

type Family = { coverage: readonly number[]; inputs: readonly number[] }
const literal = (families: readonly Family[], cp: number): boolean | null => {
  for (const family of families) if (inRanges(family.coverage, cp)) return inRanges(family.inputs, cp)
  return null
}

test('the first covering family decides spacing, including identical cmap sources', () => {
  const shared = [97, 100]
  const source = new SpacingSource([
    { coverage: [97, 98], inputs: [] },
    { coverage: shared, inputs: [99, 99] },
    { coverage: shared, inputs: [100, 100] },
  ])
  expect(source.canChange('ab')).toBe(false)
  expect(source.canChange('ac')).toBe(true)
  expect(source.canChange('ad')).toBe(false)
  expect(source.canChange('za')).toBeNull()
  expect(source.canChange('zc')).toBeNull()
  expect(source.canChange('cz')).toBe(true)
  expect(source.canChange('')).toBe(false)
})

test('codepoint decoding keeps controls, extenders, supplementary characters and lone surrogates', () => {
  const source = new SpacingSource([{ coverage: [0, 0x10ffff], inputs: [0x0b, 0x0c, 0x301, 0x301, 0x1f600, 0x1f600] }])
  expect(source.canChange('a\u00ad\u200d')).toBe(false)
  expect(source.canChange('a\u0301')).toBe(true)
  expect(source.canChange('a\u000b')).toBe(true)
  expect(source.canChange('a😀')).toBe(true)
  expect(source.canChange('\ud800\udc00\ud800')).toBe(false)
})

test('sorted source endpoints and the bounded partition preserve literal first-family decisions', () => {
  let state = 271828
  const random = (n: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n }
  for (let trial = 0; trial < 30; trial++) {
    const families: Family[] = []
    for (let f = 0; f < 12; f++) {
      const coverage: number[] = [], inputs: number[] = []
      for (let cp = 0; cp < 256; cp++) {
        if (random(8) === 0) coverage.push(cp, cp)
        if (random(12) === 0) inputs.push(cp, cp)
      }
      families.push({ coverage, inputs })
    }
    const source = new SpacingSource(families)
    for (let q = 0; q < 1024; q++) {
      const cp = random(320)
      expect(source.at(cp)).toBe(literal(families, cp))
    }
  }
})

test('bounded source decoding replaces growing partial cells instead of repeatedly scanning every family', () => {
  let reads = 0
  const watched = (a: number[]): readonly number[] => new Proxy(a, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target, key, receiver)
  } })
  const families: Family[] = Array.from({ length: 256 }, (_, i) => ({ coverage: watched([0x4000 + i, 0x4000 + i]), inputs: [] }))
  const inputs: number[] = []
  for (let i = 0; i < 512; i += 2) inputs.push(i, i)
  families.push({ coverage: watched([0, 0x10ffff]), inputs: watched(inputs) })
  const source = new SpacingSource(families)
  for (let cp = 0; cp < 512; cp++) expect(source.at(cp)).toBe(cp % 2 === 0)
  expect(reads).toBeLessThan(16384)
  reads = 0
  for (let cp = 0; cp < 512; cp++) expect(source.at(cp)).toBe(cp % 2 === 0)
  expect(reads).toBe(0)
})

test('inclusive adjacent ranges, domain endpoints and independent preparations preserve decisions', () => {
  const families = [{ coverage: [0, 0, 97, 97, 98, 98, 0x10ffff, 0x10ffff], inputs: [0, 0, 98, 98, 0x10ffff, 0x10ffff] }, { coverage: [0, 0x10ffff], inputs: [] }]
  for (let p = 0; p < 2; p++) {
    const source = new SpacingSource(families)
    for (let q = 0; q < 64; q++) for (const cp of [0, 1, 96, 97, 98, 99, 0x10fffe, 0x10ffff]) expect(source.at(cp)).toBe(literal(families, cp))
  }
})

test('first-demand source errors propagate before a source cell is published', () => {
  let refuse = true, laterReads = 0
  const first = new Proxy([97, 97], { get(target, key, receiver) {
    if (refuse && typeof key === 'string' && /^\d+$/.test(key)) throw new Error('source interval read')
    return Reflect.get(target, key, receiver)
  } })
  const later = new Proxy([98, 98], { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) laterReads++
    return Reflect.get(target, key, receiver)
  } })
  const source = new SpacingSource([{ coverage: first, inputs: [] }, { coverage: later, inputs: [] }])
  expect(() => source.canChange('aa')).toThrow('source interval read')
  expect(laterReads).toBe(0)
  refuse = false
  expect(source.canChange('aa')).toBe(false)
  expect(laterReads).toBe(0)
})
