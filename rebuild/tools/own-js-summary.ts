// Reads what tools/own-js-probe.ts recorded and prints: each library's median for 10,000 messages from scratch and for
// kept messages laid out again, the differences between the first library and each other one round by round (median,
// range, and how many rounds went each way), and the split between Canvas and the library's own JavaScript by both
// methods.
//
//   bun rebuild/tools/own-js-summary.ts <dir>/<browser>-probes.json
import { readFileSync } from 'node:fs'

type Timed = { label: string; set: string; ms: number; lines: number }
type Phases = { checks: number; prepare: number; fill: number }
type Split = {
  label: string; set: string; real: number[]; realPhases: Phases[]; map: number[]; mapPhases: Phases[]; mapAlone: number[]; calls: number
  timed: Array<{ ms: number; calls: number; measureTextMs: number; contexts: number; contextMs: number }>
}
type Out = {
  userAgent: string; devicePixelRatio: number; crossOriginIsolated: boolean; timerStepMs: number; messages: number; kept: number; emptyIntervalMs: number
  scratch: Timed[][]; relayout: Array<Timed & { round: number }>; split: Split[]
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 === 1 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}
const ms = (value: number): string => value.toFixed(1)

const file = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { results: Array<{ result: { observations: Array<{ kind: string; value?: Out }> } }> }
const out = file.results[0]!.result.observations.find(one => one.kind === 'script')!.value!
console.log(`${out.userAgent}\nratio ${out.devicePixelRatio}, isolated ${out.crossOriginIsolated}, timer step ${out.timerStepMs} ms, ${out.messages} messages, two timer reads around nothing ${(out.emptyIntervalMs * 1e6).toFixed(0)} ns`)

// Rounds: per set, per label, the times in round order.
function byLabel(rows: readonly Timed[], set: string): Map<string, number[]> {
  const found = new Map<string, number[]>()
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.set !== set) continue
    const list = found.get(rows[i]!.label) ?? []
    list.push(rows[i]!.ms)
    found.set(rows[i]!.label, list)
  }
  return found
}

function compare(title: string, rows: readonly Timed[], layouts: number): void {
  const sets = [...new Set(rows.map(row => row.set))]
  for (let s = 0; s < sets.length; s++) {
    const times = byLabel(rows, sets[s]!)
    const labels = [...times.keys()]
    const base = times.get(labels[0]!)!
    console.log(`\n${title}, ${sets[s]}: ${labels.map(label => `${label} ${ms(median(times.get(label)!))} ms (${ms(Math.min(...times.get(label)!))} to ${ms(Math.max(...times.get(label)!))})`).join('; ')}`)
    for (let k = 1; k < labels.length; k++) {
      const other = times.get(labels[k]!)!
      const differences = other.map((value, round) => value - base[round]!)
      const faster = differences.filter(d => d < 0).length
      console.log(`  ${labels[k]} less ${labels[0]}, round by round: median ${ms(median(differences))} ms (${ms(Math.min(...differences))} to ${ms(Math.max(...differences))}), ${faster} of ${differences.length} rounds faster; ${(median(differences) / layouts * 1000).toFixed(2)} µs a layout, ${(median(differences) / median(base) * 100).toFixed(1)}%`)
    }
  }
}

compare('from scratch', out.scratch.flat(), out.messages)
compare(`${out.kept} kept messages laid out again at 3 widths`, out.relayout, out.kept * 3)

console.log('\nThe split, ms per pass (medians)')
for (let i = 0; i < out.split.length; i++) {
  const one = out.split[i]!
  const real = median(one.real)
  const map = median(one.map)
  const mapAlone = median(one.mapAlone)
  const timedCalls = median(one.timed.map(pass => pass.calls))
  const inMeasureText = median(one.timed.map(pass => pass.measureTextMs - pass.calls * out.emptyIntervalMs))
  const inContexts = median(one.timed.map(pass => pass.contextMs))
  const ownJs = map - mapAlone
  const phase = (passes: readonly Phases[], name: keyof Phases): number => median(passes.map(pass => pass[name]))
  console.log(`${one.label} ${one.set}: real Canvas ${ms(real)}; ${timedCalls} measureText calls and ${median(one.timed.map(pass => pass.contexts))} contexts a pass`)
  console.log(`  timed: inside measureText ${ms(inMeasureText)} (${(inMeasureText / timedCalls * 1e6).toFixed(0)} ns a call), making contexts ${ms(inContexts)}, so own JS ${ms(real - inMeasureText - inContexts)} (${((real - inMeasureText - inContexts) / real * 100).toFixed(0)}%); the timed pass itself ${ms(median(one.timed.map(pass => pass.ms)))}`)
  console.log(`  map: a pass ${ms(map)}, the Map alone ${ms(mapAlone)}, so own JS ${ms(ownJs)} (${(ownJs / real * 100).toFixed(0)}%), ${(ownJs / out.messages * 1000).toFixed(2)} µs a message, and Canvas ${ms(real - ownJs)} (${((real - ownJs) / one.calls * 1e6).toFixed(0)} ns a call)`)
  console.log(`  phases, real Canvas: checks ${ms(phase(one.realPhases, 'checks'))}, prepare ${ms(phase(one.realPhases, 'prepare'))}, fill ${ms(phase(one.realPhases, 'fill'))}; under the Map: checks ${ms(phase(one.mapPhases, 'checks'))}, prepare ${ms(phase(one.mapPhases, 'prepare'))}, fill ${ms(phase(one.mapPhases, 'fill'))}`)
}
