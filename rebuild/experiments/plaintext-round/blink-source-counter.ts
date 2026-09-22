// Test-only delegated source reads. This never changes a paragraph string or a global String/Array prototype.
export type ReadPhase = 'setup' | 'break' | 'finalize'
export type SourceCounts = {
  phase: ReadPhase
  charCodeCalls: Record<ReadPhase, number>
  sliceCalls: number
  slicedUtf16: number
  identitySearchCalls: number
  identityComparisons: number
}
export function sourceCounts(): SourceCounts {
  return { phase: 'setup', charCodeCalls: { setup: 0, break: 0, finalize: 0 }, sliceCalls: 0, slicedUtf16: 0,
    identitySearchCalls: 0, identityComparisons: 0 }
}
export function delegatedSource(text: string, counts: SourceCounts) {
  return Object.freeze({
    length: text.length,
    charCodeAt(index: number): number { counts.charCodeCalls[counts.phase]++; return text.charCodeAt(index) },
    slice(start?: number, end?: number): string {
      const result = text.slice(start, end)
      counts.sliceCalls++; counts.slicedUtf16 += result.length
      return result
    },
  })
}
type Iterator = { readonly text: string; setStartOffset(offset: number): void }
type Breaker = { results: unknown[]; breakLine(): void; addItem(endOffset: number): unknown }

// Hooks only two explicit modules' own prototypes, while a synchronous helper run owns them; restore in finally.
// Facades delegate each operation exactly once. Slice returns the original primitive spelling to ICU.
export function instrumentLineSources(iteratorPrototype: Iterator, breakerPrototype: Breaker, counts: SourceCounts): () => void {
  const startDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype, 'setStartOffset')!
  const breakDescriptor = Object.getOwnPropertyDescriptor(breakerPrototype, 'breakLine')!
  const addDescriptor = Object.getOwnPropertyDescriptor(breakerPrototype, 'addItem')!
  const originalStart = iteratorPrototype.setStartOffset
  const originalBreak = breakerPrototype.breakLine
  const originalAdd = breakerPrototype.addItem
  const sources = new Map<Iterator, PropertyDescriptor>()
  const arrays = new Map<unknown[], PropertyDescriptor | undefined>()
  Object.defineProperty(iteratorPrototype, 'setStartOffset', { ...startDescriptor, value: function(this: Iterator, offset: number): void {
    counts.phase = 'setup'
    originalStart.call(this, offset)
    if (!sources.has(this)) {
      sources.set(this, Object.getOwnPropertyDescriptor(this, 'text')!)
      Object.defineProperty(this, 'text', { value: delegatedSource(this.text, counts) })
    }
  } })
  Object.defineProperty(breakerPrototype, 'breakLine', { ...breakDescriptor, value: function(this: Breaker): void {
    counts.phase = 'break'
    try { originalBreak.call(this) } finally { counts.phase = 'finalize' }
  } })
  Object.defineProperty(breakerPrototype, 'addItem', { ...addDescriptor, value: function(this: Breaker, endOffset: number): unknown {
    const rows = this.results
    if (!arrays.has(rows)) {
      arrays.set(rows, Object.getOwnPropertyDescriptor(rows, 'indexOf'))
      const original = rows.indexOf
      Object.defineProperty(rows, 'indexOf', { configurable: true, value: function(this: unknown[], value: unknown, from = 0): number {
        if (from !== 0) throw new Error('growth counter only models result identity searches from zero')
        counts.identitySearchCalls++
        const found = original.call(this, value, from)
        counts.identityComparisons += found >= 0 ? found + 1 : this.length
        return found
      } })
    }
    return originalAdd.call(this, endOffset)
  } })
  return () => {
    Object.defineProperty(iteratorPrototype, 'setStartOffset', startDescriptor)
    Object.defineProperty(breakerPrototype, 'breakLine', breakDescriptor)
    Object.defineProperty(breakerPrototype, 'addItem', addDescriptor)
    for (const [iterator, descriptor] of sources) Object.defineProperty(iterator, 'text', descriptor)
    for (const [rows, descriptor] of arrays) {
      if (descriptor === undefined) delete (rows as unknown as { indexOf?: unknown }).indexOf
      else Object.defineProperty(rows, 'indexOf', descriptor)
    }
  }
}
