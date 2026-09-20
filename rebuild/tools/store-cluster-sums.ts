// A check on the store study's claim for Gecko, not a test: inside a run without spaces, is the advance of the first
// cluster of a measured string what the cluster measures alone? au(S) - au(S less its first cluster) = au(cluster), in
// Gecko's app units (round(W x 60)). The study showed it in Firefox on Chinese text in one font list. This reads it from
// the recorded Canvas answers of the tier cases (tests/replay.ts inputs): the Gecko port measures the suffix from every
// break candidate it consults and the cluster before it alone, so many records hold all three strings on one context.
// No browser.
//
//   bun rebuild/tools/store-cluster-sums.ts [--browser=firefox] [--config=no-facts|facts] [--examples=8] [--out=<report.json>]
//
// Per case and per recorded context, every measured string of two clusters or more is tried where the record holds the
// string less its first cluster and that cluster alone. Where it also holds the first two clusters together, the pair's
// own adjustment is added and tried too: au(ab) - au(a) - au(b). Clusters are Intl.Segmenter's graphemes, which is near
// enough to Gecko's for a tally. Tallied by the script of the two clusters at the cut, and by font string within a script.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readInputs, readShard, referenceDir, type InputCase } from '../tests/replay.ts'
import type { Config, TierBrowser } from '../tests/sets.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const browser = (options.get('browser') ?? 'firefox') as TierBrowser
const config = (options.get('config') ?? 'no-facts') as Config
const examples = Number(options.get('examples') ?? 8)

type Example = { case: string; font: string; letterSpacing: string; text: string; measured: number; clusterAlone: number; withPair: number | null }
type Tally = { tried: number; exact: number; largest: number; pairTried: number; pairExact: number; pairLargest: number; fonts: Set<string>; examples: Example[] }
const newTally = (): Tally => ({ tried: 0, exact: 0, largest: 0, pairTried: 0, pairExact: 0, pairLargest: 0, fonts: new Set(), examples: [] })
const byScript = new Map<string, Tally>()
const byScriptAndFont = new Map<string, Tally>()
const total = newTally()

function tallyOf(map: Map<string, Tally>, key: string): Tally {
  let tally = map.get(key)
  if (tally === undefined) {
    tally = newTally()
    map.set(key, tally)
  }
  return tally
}

const SCRIPTS: Array<[string, RegExp]> = [
  ['Han, kana or Hangul', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u],
  ['Arabic or Syriac (joining)', /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Mongolian}\p{Script=Nko}]/u],
  ['Latin, Greek or Cyrillic', /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u],
  ['Indic or South-East Asian', /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Thai}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Lao}]/u],
  ['emoji', /\p{Extended_Pictographic}/u],
]
function scriptOf(cluster: string): string {
  for (let i = 0; i < SCRIPTS.length; i++) if (SCRIPTS[i]![1].test(cluster)) return SCRIPTS[i]![0]
  return 'other (digits, punctuation, other scripts)'
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const au = (width: number): number => Math.round(width * 60)

const dir = referenceDir(browser, config)
const manifest = readInputs(dir)
const sets = Object.keys(manifest.sets)
const seenIds = new Set<string>()
for (let n = 0; n < sets.length; n++) {
  const shards = manifest.sets[sets[n]!]!.shards
  for (let k = 0; k < shards.length; k++) {
    const inputs = readShard<InputCase>(join(dir, 'inputs', shards[k]!.file))
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
      // A case recorded in two sets holds the same strings twice.
      if (seenIds.has(input.id)) continue
      seenIds.add(input.id)
      const record = input.record
      const perContext: Array<Map<string, number>> = record.contexts.map(() => new Map())
      for (let at = record.phases.predict[0]; at < record.phases.predict[1]; at++) {
        const call = record.calls[at]!
        perContext[call[0]]!.set(call[1], call[2])
      }
      for (let c = 0; c < perContext.length; c++) {
        const widths = perContext[c]!
        const assigned = record.contexts[c]!.assigned
        for (const [text, width] of widths) {
          if (text.length < 2 || text.includes(' ')) continue
          let first = ''
          let second = ''
          let count = 0
          for (const g of graphemes.segment(text.slice(0, 24))) {
            if (count === 0) first = g.segment
            else if (count === 1) second = g.segment
            else break
            count++
          }
          if (count < 2) continue
          const rest = widths.get(text.slice(first.length))
          const alone = widths.get(first)
          if (rest === undefined || alone === undefined) continue
          const measured = au(width) - au(rest)
          const pair = widths.get(first + second)
          const secondAlone = widths.get(second)
          // The cluster alone plus the pair's adjustment, au(a) + (au(ab) - au(a) - au(b)).
          const withPair = pair === undefined || secondAlone === undefined ? null : au(pair) - au(secondAlone)
          const a = scriptOf(first)
          const b = scriptOf(second)
          const script = a === b ? a : `${a} before ${b}`
          const spaced = (assigned.letterSpacing ?? '0px') === '0px' ? '' : ', letter spacing'
          const tallies = [total, tallyOf(byScript, `${script}${spaced}`), tallyOf(byScriptAndFont, `${script}${spaced}: ${assigned.font ?? ''}`)]
          for (let t = 0; t < tallies.length; t++) {
            const tally = tallies[t]!
            tally.tried++
            tally.fonts.add(assigned.font ?? '')
            const off = Math.abs(au(alone) - measured)
            if (off === 0) tally.exact++
            else {
              if (off > tally.largest) tally.largest = off
              if (tally.examples.length < examples) tally.examples.push({ case: `${sets[n]!}/${input.id}`, font: assigned.font ?? '', letterSpacing: assigned.letterSpacing ?? '', text: text.slice(0, 40), measured, clusterAlone: au(alone), withPair })
            }
            if (withPair !== null) {
              tally.pairTried++
              const pairOff = Math.abs(withPair - measured)
              if (pairOff === 0) tally.pairExact++
              else if (pairOff > tally.pairLargest) tally.pairLargest = pairOff
            }
          }
        }
      }
    }
  }
  console.error(`[store-cluster-sums] ${browser}-${config} ${sets[n]!}: ${seenIds.size} cases, ${total.tried} tried, ${total.exact} exact`)
}

const row = (key: string, tally: Tally): unknown => ({
  key, fontStrings: tally.fonts.size, tried: tally.tried, exact: tally.exact, off: tally.tried - tally.exact, largestOffAu: tally.largest,
  withPairTried: tally.pairTried, withPairExact: tally.pairExact, withPairLargestOffAu: tally.pairLargest, examples: tally.examples,
})
const report = {
  browser, config, cases: seenIds.size, total: row('all', total),
  byScript: [...byScript].sort((a, b) => b[1].tried - a[1].tried).map(([key, tally]) => row(key, tally)),
  byScriptAndFont: [...byScriptAndFont].filter(entry => entry[1].tried > entry[1].exact).sort((a, b) => (b[1].tried - b[1].exact) - (a[1].tried - a[1].exact)).slice(0, 60).map(([key, tally]) => row(key, tally)),
}
const text = `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
