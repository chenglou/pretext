// Reads what tools/own-js-fresh-pages.ts recorded. A page's time is the median of its passes. For each checkout: the
// median over its pages, and how far two pages of that one checkout in rounds next to each other lie apart (the median
// of the absolute differences: what a difference between two checkouts has to beat). For each checkout against the one
// before it in OWN_JS_TREES, and against the first: the differences round by round (median, the middle half,
// the range, how many rounds went the change's way). Then the split by the questions asked again, where the run has it.
//
//   bun rebuild/tools/own-js-fresh-summary.ts <dir>/<browser>-probes.json
import { readFileSync } from 'node:fs'

type Page = { label: string; round: number; crossOriginIsolated: boolean; messages: number; kept: number; cold: number; scratch: Record<string, number[]>; relayout: Record<string, number[]>; lines: Record<string, number> }
type Split = { label: string; split: Array<{ set: string; calls: number; contexts: number; real: number[]; asked: number[]; askedOfNew?: number[]; loop: number[] }> }

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (sorted.length - 1) * q
  const low = Math.floor(at)
  const high = Math.ceil(at)
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (at - low)
}
const median = (values: readonly number[]): number => quantile(values, 0.5)
const ms = (value: number): string => value.toFixed(2)

const file = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { results: Array<{ id: string; result: { errors: string[]; observations: Array<{ kind: string; value?: Page | Split; error?: string }> } | null }> }
const pages: Page[] = []
const splits: Split[] = []
for (let i = 0; i < file.results.length; i++) {
  const result = file.results[i]!.result
  const script = result === null ? undefined : result.observations.find(one => one.kind === 'script')
  if (script === undefined || script.value === undefined) {
    console.log(`${file.results[i]!.id}: no result (${result === null ? 'not run' : script?.error ?? result.errors.join('; ')})`)
    continue
  }
  if ('split' in script.value) splits.push(script.value)
  else pages.push(script.value)
}
const labels = [...new Set(pages.map(page => page.label))]
const rounds = [...new Set(pages.map(page => page.round))].filter(round => labels.every(label => pages.some(page => page.round === round && page.label === label)))
const sets = Object.keys(pages[0]!.scratch)
console.log(`${labels.length} checkouts (${labels.join(', ')}), ${rounds.length} whole rounds, ${pages[0]!.messages} messages from scratch, ${pages[0]!.kept} kept at 3 widths, isolated ${pages[0]!.crossOriginIsolated}`)

function table(title: string, per: number, time: (page: Page) => number): void {
  const at = (label: string, round: number): number => time(pages.find(page => page.label === label && page.round === round)!)
  console.log(`\n${title}`)
  for (let k = 0; k < labels.length; k++) {
    const times = rounds.map(round => at(labels[k]!, round))
    const neighbours: number[] = []
    for (let r = 1; r < times.length; r++) neighbours.push(Math.abs(times[r]! - times[r - 1]!))
    console.log(`  ${labels[k]}: median ${ms(median(times))} ms (${ms(Math.min(...times))} to ${ms(Math.max(...times))}); two of its pages in neighbouring rounds differ by ${ms(median(neighbours))} ms (median)`)
  }
  const compare = (from: string, to: string): void => {
    const differences = rounds.map(round => at(to, round) - at(from, round))
    const d = median(differences)
    const base = median(rounds.map(round => at(from, round)))
    const itsWay = differences.filter(one => (d < 0 ? one < 0 : one > 0)).length
    console.log(`  ${to} less ${from}: median ${ms(d)} ms (middle half ${ms(quantile(differences, 0.25))} to ${ms(quantile(differences, 0.75))}, range ${ms(Math.min(...differences))} to ${ms(Math.max(...differences))}), ${itsWay} of ${differences.length} rounds its way; ${(d / per * 1000).toFixed(3)} us each, ${(d / base * 100).toFixed(1)}%`)
  }
  for (let k = 1; k < labels.length; k++) compare(labels[k - 1]!, labels[k]!)
  for (let k = 2; k < labels.length; k++) compare(labels[0]!, labels[k]!)
}

for (let s = 0; s < sets.length; s++) {
  const set = sets[s]!
  table(`from scratch, ${set}`, pages[0]!.messages, page => median(page.scratch[set]!))
  table(`kept messages laid out again, ${set}`, pages[0]!.kept * 3, page => median(page.relayout[set]!))
}
table(`the page's first pass of ${sets[0]} (the library is compiled during it)`, pages[0]!.messages, page => page.cold)

for (let k = 0; k < splits.length; k++) {
  const split = splits[k]!
  console.log(`\nThe split by the questions asked again, ${split.label} (medians, ms a pass)`)
  for (let i = 0; i < split.split.length; i++) {
    const one = split.split[i]!
    const real = median(one.real)
    const canvas = median(one.asked) - median(one.loop)
    if (one.askedOfNew !== undefined) {
      const ofNew = median(one.askedOfNew) - median(one.loop)
      console.log(`  ${one.set}, the questions asked of contexts made anew: Canvas ${ms(ofNew)} (${(ofNew / one.calls * 1e6).toFixed(0)} ns a call, ${(ofNew / real * 100).toFixed(1)}% of the pass), own JS ${ms(real - ofNew)} (${((real - ofNew) / real * 100).toFixed(1)}%)`)
    }
    console.log(`  ${one.set}: a pass ${ms(real)}; its ${one.calls} questions (${one.contexts} contexts) asked again ${ms(median(one.asked))}, the loop alone ${ms(median(one.loop))}: Canvas ${ms(canvas)} (${(canvas / one.calls * 1e6).toFixed(0)} ns a call, ${(canvas / real * 100).toFixed(1)}% of the pass), own JS ${ms(real - canvas)} (${((real - canvas) / real * 100).toFixed(1)}%)`)
  }
}
