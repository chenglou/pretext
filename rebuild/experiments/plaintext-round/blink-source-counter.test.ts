import { expect, test } from 'bun:test'
import { delegatedSource, instrumentLineSources, sourceCounts } from './blink-source-counter.ts'

test('delegated iterator source is immutable and preserves primitive character/slice results', () => {
  const text = 'a\ud83d\ude00\udc00\n', counts = sourceCounts(), source = delegatedSource(text, counts)
  expect(Object.isFrozen(source)).toBe(true)
  expect(source.length).toBe(text.length)
  for (let i = -1; i <= text.length; i++) expect(source.charCodeAt(i)).toBe(text.charCodeAt(i))
  expect(source.slice(1, -1)).toBe(text.slice(1, -1))
  expect(typeof source.slice()).toBe('string')
  expect(counts.charCodeCalls.setup).toBe(text.length + 2)
  expect(Reflect.set(source, 'length', 42)).toBe(false)
})

test('scoped counter reads only owned iterator sources and result arrays, then restores them', () => {
  class Iterator {
    readonly text = 'abc'
    offset = 0
    setStartOffset(offset: number): void { this.offset = offset }
  }
  class Breaker {
    results: unknown[] = []
    constructor(readonly iterator: Iterator) {}
    addItem(end: number): unknown { const row = { end }; this.results.push(row); return row }
    breakLine(): void { this.iterator.text.charCodeAt(0) }
  }
  const counts = sourceCounts(), originalStart = Iterator.prototype.setStartOffset, originalBreak = Breaker.prototype.breakLine
  const originalStringCharCode = String.prototype.charCodeAt, originalArrayIndexOf = Array.prototype.indexOf
  const restore = instrumentLineSources(Iterator.prototype, Breaker.prototype, counts)
  const iterator = new Iterator(), breaker = new Breaker(iterator)
  try {
    iterator.setStartOffset(1)
    breaker.breakLine()
    iterator.text.charCodeAt(1)
    breaker.addItem(1)
    const second = breaker.addItem(2)
    expect(breaker.results.indexOf(second)).toBe(1)
    expect(counts.charCodeCalls).toEqual({ setup: 0, break: 1, finalize: 1 })
    expect(counts.identitySearchCalls).toBe(1)
    expect(counts.identityComparisons).toBe(2)
    expect(String.prototype.charCodeAt).toBe(originalStringCharCode)
    expect(Array.prototype.indexOf).toBe(originalArrayIndexOf)
  } finally { restore() }
  expect(Iterator.prototype.setStartOffset).toBe(originalStart)
  expect(Breaker.prototype.breakLine).toBe(originalBreak)
  expect(iterator.text).toBe('abc')
  expect(Object.hasOwn(breaker.results, 'indexOf')).toBe(false)
})
