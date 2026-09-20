// The identity Gecko's word scan stands on, read from Firefox's recorded Canvas answers with no browser: a string with
// boundary spaces measures as the sum of its words and its spaces, each measured alone in the same context, in app units:
// au(a b) = au(a) + au(' ') + au(b). Gecko shapes a text run word by word and a boundary space is a glyph of its own
// (gfxFont::SplitAndInitTextRun, gfxFont.cpp:3708-3900), and Canvas shapes through the same function. The port's recipes
// measure words alone; the strings with spaces in a record are the ones an inspected paragraph measures for its
// space-in-shaping gap (src/engines/gecko/gaps.ts spaceTest), so every record with such a string is tried where it also
// holds every part.
//
//   bun rebuild/tools/word-scan-space-identity.ts [--config=no-facts|facts] [--examples=12] [--out=<report.json>]
//
// A space before a cluster extender is no boundary (IsBoundarySpace, gfxFont.cpp:3317-3323), so a string with one is
// left out. Tallied by the scripts around the space and by font string.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readInputs, readShard, referenceDir, type InputCase } from '../tests/replay.ts'
import type { Config } from '../tests/sets.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const config = (options.get('config') ?? 'no-facts') as Config
const examples = Number(options.get('examples') ?? 12)

type Example = { case: string; font: string; whole: string; wholeAu: number; sumAu: number }
type Tally = { tried: number; exact: number; largestAu: number; examples: Example[] }
const total: Tally = { tried: 0, exact: 0, largestAu: 0, examples: [] }
const byFont = new Map<string, Tally>()
const byKind = new Map<string, Tally>()
const au = (width: number): number => Math.round(width * 60)
const EXTENDER = /^\p{M}/u
const NO_SCRIPT = /^[\p{Script=Common}\p{Script=Inherited}]*$/u

function tallyOf(map: Map<string, Tally>, key: string): Tally {
  let tally = map.get(key)
  if (tally === undefined) {
    tally = { tried: 0, exact: 0, largestAu: 0, examples: [] }
    map.set(key, tally)
  }
  return tally
}

const dir = referenceDir('firefox', config)
const manifest = readInputs(dir)
const sets = Object.keys(manifest.sets)
const seenIds = new Set<string>()
let withSpaces = 0
for (let n = 0; n < sets.length; n++) {
  const shards = manifest.sets[sets[n]!]!.shards
  for (let k = 0; k < shards.length; k++) {
    const inputs = readShard<InputCase>(join(dir, 'inputs', shards[k]!.file))
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
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
        if ((assigned.letterSpacing ?? '0px') !== '0px' && assigned.letterSpacing !== '0.001px') continue
        for (const [whole, width] of widths) {
          if (whole.length < 3 || !/[  ]/.test(whole.slice(1, -1))) continue
          withSpaces++
          let sum = 0
          let known = true
          let from = 0
          let scripts = true
          for (let s = 0; s <= whole.length && known; s++) {
            const unit = s < whole.length ? whole.charCodeAt(s) : 0x20
            if (unit !== 0x20 && unit !== 0xa0) continue
            if (s < whole.length && EXTENDER.test(whole.slice(s + 1))) known = false
            const part = whole.slice(from, s)
            if (part !== '') {
              const partWidth = widths.get(part)
              if (partWidth === undefined) known = false
              else sum += au(partWidth)
              if (NO_SCRIPT.test(part)) scripts = false
            }
            if (s < whole.length) {
              const spaceWidth = widths.get(whole[s]!)
              if (spaceWidth === undefined) known = false
              else sum += au(spaceWidth)
            }
            from = s + 1
          }
          if (!known) continue
          const tallies = [total, tallyOf(byFont, assigned.font ?? ''), tallyOf(byKind, `${assigned.direction ?? ''}, ${scripts ? 'every word has a script of its own' : 'a word without a script of its own'}`)]
          for (let t = 0; t < tallies.length; t++) {
            const tally = tallies[t]!
            tally.tried++
            const off = Math.abs(au(width) - sum)
            if (off === 0) tally.exact++
            else {
              if (off > tally.largestAu) tally.largestAu = off
              if (tally.examples.length < examples) tally.examples.push({ case: `${sets[n]!}/${input.id}`, font: assigned.font ?? '', whole, wholeAu: au(width), sumAu: sum })
            }
          }
        }
      }
    }
  }
  console.error(`[word-scan-space-identity] firefox-${config} ${sets[n]!}: ${seenIds.size} cases, ${withSpaces} strings with a space inside, ${total.tried} tried, ${total.exact} exact`)
}
const row = (key: string, tally: Tally): unknown => ({ key, tried: tally.tried, exact: tally.exact, off: tally.tried - tally.exact, largestOffAu: tally.largestAu, examples: tally.examples })
const report = {
  config, cases: seenIds.size, stringsWithASpaceInside: withSpaces, total: row('all', total),
  byKind: [...byKind].sort((a, b) => b[1].tried - a[1].tried).map(([key, tally]) => row(key, tally)),
  byFont: [...byFont].sort((a, b) => (b[1].tried - b[1].exact) - (a[1].tried - a[1].exact) || b[1].tried - a[1].tried).map(([key, tally]) => row(key, tally)),
}
const out = options.get('out')
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`)
console.log(`[word-scan-space-identity] firefox-${config}: ${report.cases} cases, ${withSpaces} recorded strings with a space inside, ${total.tried} with every part recorded in the same context, ${total.exact} exact, largest miss ${total.largestAu} au`)
for (const [key, tally] of byKind) console.log(`  ${key}: ${tally.exact} of ${tally.tried}`)
