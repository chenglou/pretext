// Measurement-call accounting only. This is not browser correctness or timing
// evidence. A deterministic backend returns 10px per UTF-16 code unit. Main's
// real measurement helper and real per-font cache choose the submitted strings.
let queries: string[] = []
class AccountingCanvas {
  getContext() {
    return {
      font: '16px Test',
      measureText(text: string) {
        queries.push(text)
        return { width: text.length * 10 }
      },
    }
  }
}
Object.defineProperty(globalThis, 'OffscreenCanvas', {
  value: AccountingCanvas, configurable: true,
})
const measurement = await import('../../../../pretext/src/measurement.js')
const cases = [
  ['AV96', 'AV'.repeat(48)],
  ['AV1000', 'AV'.repeat(500)],
  ['Arabic96', 'ه'.repeat(96)],
  ['Arabic1000', 'ه'.repeat(1000)],
  ['LatinUnique96', Array.from({ length: 96 }, (_, i) => String.fromCodePoint(0x100 + i)).join('')],
] as const
for (const [label, text] of cases) {
  for (const mode of ['sum-graphemes', 'pair-context', 'segment-prefixes'] as const) {
    measurement.clearMeasurementCaches()
    queries = []
    const cache = measurement.getSegmentMetricCache('16px Test')
    const whole = measurement.getSegmentMetrics(text, cache)
    const advances = measurement.getSegmentBreakableFitAdvances(text, whole, cache, 0, mode)
    let submittedUtf16 = 0, maxQuery = 0
    for (const query of queries) {
      submittedUtf16 += query.length
      maxQuery = Math.max(maxQuery, query.length)
    }
    process.stdout.write(JSON.stringify({
      label, mode, utf16: text.length, graphemes: advances?.length,
      calls: queries.length, submittedUtf16, maxQuery,
    }) + '\n')
  }
}
