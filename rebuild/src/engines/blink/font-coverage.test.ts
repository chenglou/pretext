import { expect, test } from 'bun:test'
import type { ListedFontFacts } from '../../model.js'
import { FontCoverage } from './font-coverage.js'

function font(coverage: readonly number[] | null, realizes: boolean | null = true): ListedFontFacts {
  return { family: 'Family', realizes, coverage, ligatures: null, scriptLookups: null }
}
function counted(coverage: number[], read: () => void): readonly number[] {
  return new Proxy(coverage, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) read()
    return Reflect.get(target, key, receiver)
  } })
}

test('the earliest family must cover every decisive codepoint of the whole cluster', () => {
  const sources = [font([97, 97]), font([769, 769]), font([97, 97, 769, 769])]
  const coverage = new FontCoverage(sources)
  expect(coverage.font('a\u0301', 0, 2)).toBe(2)
  expect(coverage.font('a\u200d\u0301', 0, 3)).toBe(2)
  expect(coverage.font('a', 0, 1)).toBe(0)
  expect(coverage.font('\u0301', 0, 1)).toBe(1)
  expect(new FontCoverage([font([], false), font([]), font([97, 97])]).font('\u00ad\u200d', 0, 2)).toBe(1)
  expect(new FontCoverage([font([], null), ...sources]).font('a\u0301', 0, 2)).toBe(-1)
  expect(new FontCoverage([font(null), ...sources]).font('\u00ad', 0, 1)).toBe(-1)
  expect(new FontCoverage([font([0x1f469, 0x1f469])]).font('\ud83d\udc69', 0, 1)).toBe(0)
  expect(new FontCoverage([font([45, 45])]).font('\u2010', 0, 1)).toBe(-1)
})

test('early small hits do not compile unused giant source maps', () => {
  let reads = 0, laterReads = 0
  const large: number[] = []
  for (let cp = 0; cp < 65537; cp++) large.push(cp * 2, cp * 2)
  const coverage = new FontCoverage([
    font(counted([98, 98], () => reads++)), font(counted([97, 97], () => reads++)),
    font(counted(large, () => laterReads++)),
  ])
  for (let i = 0; i < 3; i++) expect(coverage.font('a', 0, 1)).toBe(1)
  expect(reads).toBe(9)
  expect(laterReads).toBe(0)
})

test('repeated whole-cluster conjunction uses compact source sets instead of scanning every family', () => {
  let reads = 0
  const sources = Array.from({ length: 8192 }, (_, i) => font(counted(i % 2 ? [769, 769] : [97, 97], () => reads++)))
  sources.push(font(counted([97, 97, 769, 769], () => reads++)))
  const coverage = new FontCoverage(sources)
  // A long grapheme still has only two distinct decisive source predicates.
  const text = 'a' + '\u0301'.repeat(4096)
  for (let i = 0; i < 512; i++) expect(coverage.font(text, 0, text.length)).toBe(8192)
  expect(reads).toBeLessThan(900000)
})

test('consumed prefix grows in source order and preserves earlier winners after compilation', () => {
  const sources = Array.from({ length: 512 }, (_, i) => font([0x4000 + i, 0x4000 + i]))
  const coverage = new FontCoverage(sources)
  for (let f = 0; f < sources.length; f++) {
    const text = String.fromCodePoint(0x4000 + f)
    for (let i = 0; i < 8; i++) expect(coverage.font(text, 0, text.length)).toBe(f)
  }
  for (let f = sources.length - 1; f >= 0; f--) {
    const text = String.fromCodePoint(0x4000 + f)
    expect(coverage.font(text, 0, text.length)).toBe(f)
  }
  expect(coverage.font('z', 0, 1)).toBe(-1)
})

test('a compiled long repeated-mark cluster asks each distinct source set once', () => {
  const sources = Array.from({ length: 8192 }, (_, i) => font(i % 2 ? [769, 769] : [97, 97]))
  sources.push(font([97, 97, 769, 769]))
  const coverage = new FontCoverage(sources)
  for (let i = 0; i < 128; i++) expect(coverage.font('a\u0301', 0, 2)).toBe(8192)
  // Observe source-version reads without a production counter or measurement hook.
  const blocks = (coverage as unknown as { blocks: { roots: unknown[] }[] }).blocks
  let reads = 0
  for (const block of blocks) block.roots = new Proxy(block.roots, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++
    return Reflect.get(target, key, receiver)
  } })
  const text = 'a' + '\u0301'.repeat(8192)
  expect(coverage.font(text, 0, text.length)).toBe(8192)
  expect(blocks.length).toBeGreaterThan(0)
  expect(reads).toBeLessThanOrEqual(2 * blocks.length)
})
