import { getSegmentMetricCache } from '../src/measurement.js'
import { clearCache, createIncrementalPreparer, layout, prepare, prepareWithSegments, type PreparedText } from '../src/layout.js'

export const PREPARE_WORKLOAD_FONT = '16px Arial'

export function makeUniqueText(index: number): string {
  // Every sentence is distinct; vocabulary repeats as it does in app records.
  const subjects = ['Avery', 'Blair', 'Casey', 'Drew', 'Emery', 'Frankie', 'Gray', 'Harper']
  const verbs = ['opened', 'reviewed', 'updated', 'archived', 'shared', 'restored', 'created', 'saved']
  return `${subjects[index % 8]} ${verbs[Math.floor(index / 8) % 8]} document ${index.toString(36)} for workspace ${Math.floor(index / 64).toString(36)} at revision ${index}.`
}

export function makeStreamPackets(count: number): string[] {
  const parts = ['A new message ', 'with a link https://example.com/', 'route?q=hello&n=42 ', 'and emoji 👩‍💻 ', 'is ready.\n']
  return Array.from({ length: count }, (_, i) => parts[i % parts.length]!)
}

export function runPrepareWorkloads(uniqueCount = 100_000, streamSteps = 1_000) {
  const sentences = Array.from({ length: uniqueCount }, (_, i) => makeUniqueText(i))
  const packets = makeStreamPackets(streamSteps)
  const results: Array<{ label: string, count: number, ms: number, checksum: number, p50Ms?: number, p95Ms?: number, maxMs?: number }> = []

  clearCache()
  let last: PreparedText | null = null
  let start = performance.now()
  for (const text of sentences) last = prepare(text, PREPARE_WORKLOAD_FONT)
  results.push({ label: '100k unique-text prepare; cold shared cache at start', count: uniqueCount, ms: performance.now() - start, checksum: layout(last!, 320, 20).height })

  const uniqueCache = getSegmentMetricCache(PREPARE_WORKLOAD_FONT)
  let uniqueCachedTextUnits = 0
  for (const text of uniqueCache.keys()) uniqueCachedTextUnits += text.length
  const uniqueCacheEntries = uniqueCache.size

  const stable = prepare(sentences[0]!, PREPARE_WORKLOAD_FONT)
  let checksum = 0
  start = performance.now()
  for (let i = 0; i < uniqueCount; i++) checksum += layout(stable, 240 + i % 100, 20).height
  results.push({ label: 'Repeated layout of one prepared paragraph', count: uniqueCount, ms: performance.now() - start, checksum })

  const growingCases = [
    { label: 'Newline stream', packets, whiteSpace: 'pre-wrap' as const },
    { label: 'Live paragraph', packets: packets.map(packet => packet.replace(/\n/g, ' ')), whiteSpace: 'normal' as const },
    { label: 'Unbroken-run fallback', packets: Array.from({ length: Math.min(streamSteps, 300) }, () => 'abcdefgh'), whiteSpace: 'normal' as const },
  ]
  for (const scenario of growingCases) {
    clearCache()
    let source = ''
    checksum = 0
    const fullDurations: number[] = []
    start = performance.now()
    for (const packet of scenario.packets) {
      const updateStart = performance.now()
      source += packet
      checksum += layout(prepareWithSegments(source, PREPARE_WORKLOAD_FONT, { whiteSpace: scenario.whiteSpace }), 320, 20).height
      fullDurations.push(performance.now() - updateStart)
    }
    results.push({ label: `${scenario.label}; full prepare each update`, count: scenario.packets.length, ms: performance.now() - start, checksum, ...latency(fullDurations) })

    clearCache()
    const owner = createIncrementalPreparer(PREPARE_WORKLOAD_FONT, { whiteSpace: scenario.whiteSpace })
    let incrementalChecksum = 0
    const incrementalDurations: number[] = []
    start = performance.now()
    for (const packet of scenario.packets) {
      const updateStart = performance.now()
      incrementalChecksum += layout(owner.append(packet), 320, 20).height
      incrementalDurations.push(performance.now() - updateStart)
    }
    results.push({ label: `${scenario.label}; incremental analysis owner`, count: scenario.packets.length, ms: performance.now() - start, checksum: incrementalChecksum, ...latency(incrementalDurations) })
    if (incrementalChecksum !== checksum) throw new Error(`Mismatching output for ${scenario.label}`)
    owner.clear()
  }

  return { font: PREPARE_WORKLOAD_FONT, uniqueCount, uniqueCacheEntries, uniqueCachedTextUnits, streamSteps, streamChars: packets.join('').length, results }
}

function latency(durations: number[]): { p50Ms: number, p95Ms: number, maxMs: number } {
  durations.sort((a, b) => a - b)
  return { p50Ms: durations[Math.floor(durations.length / 2)]!, p95Ms: durations[Math.floor(durations.length * 0.95)]!, maxMs: durations[durations.length - 1]! }
}
