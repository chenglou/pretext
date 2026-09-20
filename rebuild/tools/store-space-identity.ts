// A check on the store study's exactness claim, not a test: in Chrome, is a run measured whole equal to its two sides each
// measured with the space between them, less the space once? W(L s R) = W(L s) + W(s R) - W(s), in 16.16 units. The study
// showed it in a browser on ASCII text in 10 system fonts. This reads it from the recorded Canvas answers of the tier
// cases (tests/replay.ts inputs), which hold other scripts and the corpus' fonts: the Blink port's cut search measures a
// window whole and both of its sides at the offsets before and after a space, so many records hold all four strings on
// one canvas. No browser.
//
//   bun rebuild/tools/store-space-identity.ts [--browser=chrome] [--config=no-facts|facts] [--examples=12] [--out=<report.json>]
//
// Per case and per recorded context (one canvas), every measured string with a space inside (U+2028 as the port writes
// it, or U+0020 in a range kept 8-bit) is tried at each of its spaces, where the record holds the three other strings on
// the same canvas. Only wholes below 256 px are tried: Canvas totals are exact 16.16 sums below that. Main's sum is tried
// beside it where the record holds both sides alone: W(L) + W(s) + W(R).
// Tallied per font string and per what the two characters around the space are (Latin-1 on both sides, or not), with
// letter-spaced contexts apart, and apart again where one side holds no character with a script of its own (brackets,
// digits, punctuation): Canvas gives such a side measured alone another script than it has in the whole.
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
const browser = (options.get('browser') ?? 'chrome') as TierBrowser
const config = (options.get('config') ?? 'no-facts') as Config
const examples = Number(options.get('examples') ?? 12)

type Example = { case: string; font: string; letterSpacing: string; direction: string; whole: string; at: number; whole16: number; withSpaces16: number; wordsAlone16: number | null }
type Tally = { tried: number; exact: number; largest16: number; aloneTried: number; aloneExact: number; aloneLargest16: number; cases: number; lastCase: number; examples: Example[] }
const newTally = (): Tally => ({ tried: 0, exact: 0, largest16: 0, aloneTried: 0, aloneExact: 0, aloneLargest16: 0, cases: 0, lastCase: -1, examples: [] })
const byFont = new Map<string, Tally>()
const byKind = new Map<string, Tally>()
const total = newTally()

function tallyOf(map: Map<string, Tally>, key: string): Tally {
  let tally = map.get(key)
  if (tally === undefined) {
    tally = newTally()
    map.set(key, tally)
  }
  return tally
}

const to16 = (width: number): number => Math.round(width * 65536)
const NO_SCRIPT = /^[\p{Script=Common}\p{Script=Inherited}]*$/u
const isSpace = (unit: number): boolean => unit === 0x2028 || unit === 0x20

const dir = referenceDir(browser, config)
const manifest = readInputs(dir)
const sets = Object.keys(manifest.sets)
let caseIndex = 0
let seenCases = 0
const seenIds = new Set<string>()
for (let n = 0; n < sets.length; n++) {
  const shards = manifest.sets[sets[n]!]!.shards
  for (let k = 0; k < shards.length; k++) {
    const inputs = readShard<InputCase>(join(dir, 'inputs', shards[k]!.file))
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
      caseIndex++
      // A case recorded in two sets holds the same strings twice.
      if (seenIds.has(input.id)) continue
      seenIds.add(input.id)
      seenCases++
      const record = input.record
      const perContext: Array<Map<string, number>> = record.contexts.map(() => new Map())
      for (let at = record.phases.predict[0]; at < record.phases.predict[1]; at++) {
        const call = record.calls[at]!
        perContext[call[0]]!.set(call[1], call[2])
      }
      for (let c = 0; c < perContext.length; c++) {
        const widths = perContext[c]!
        const assigned = record.contexts[c]!.assigned
        const font = assigned.font ?? ''
        for (const [whole, width] of widths) {
          if (width >= 256 || whole.length < 3) continue
          for (let s = 1; s + 1 < whole.length; s++) {
            if (!isSpace(whole.charCodeAt(s))) continue
            const space = whole[s]!
            const left = whole.slice(0, s)
            const right = whole.slice(s + 1)
            const leftSpace = widths.get(left + space)
            const spaceRight = widths.get(space + right)
            const spaceAlone = widths.get(space)
            if (leftSpace === undefined || spaceRight === undefined || spaceAlone === undefined) continue
            const whole16 = to16(width)
            const withSpaces16 = to16(leftSpace) + to16(spaceRight) - to16(spaceAlone)
            const leftAlone = widths.get(left)
            const rightAlone = widths.get(right)
            const wordsAlone16 = leftAlone === undefined || rightAlone === undefined ? null : to16(leftAlone) + to16(spaceAlone) + to16(rightAlone)
            const latin = whole.charCodeAt(s - 1) <= 0xff && whole.charCodeAt(s + 1) <= 0xff
            // Under letter spacing Canvas gives a character spacing by the script its own segmenter gives the string, which
            // the port corrects in JS (shape.ts letterSpacingDifference16): a miss there is that correction, a whole number
            // of spacings, so those contexts are tallied apart.
            const spaced = (assigned.letterSpacing ?? '0px') === '0px' ? 'no letter spacing' : 'letter spacing'
            const sides = NO_SCRIPT.test(left) || NO_SCRIPT.test(right) ? 'a side without a script of its own' : 'a script on both sides'
            const kind = `${spaced}, ${space === ' ' ? 'U+0020' : 'U+2028'}, ${latin ? 'Latin-1 on both sides' : 'another character beside the space'}, ${assigned.direction ?? ''}, ${sides}`
            const tallies = [total, tallyOf(byFont, `${font}, ${spaced}`), tallyOf(byKind, kind)]
            for (let t = 0; t < tallies.length; t++) {
              const tally = tallies[t]!
              tally.tried++
              if (tally.lastCase !== caseIndex) {
                tally.lastCase = caseIndex
                tally.cases++
              }
              const off = Math.abs(withSpaces16 - whole16)
              if (off === 0) tally.exact++
              else {
                if (off > tally.largest16) tally.largest16 = off
                if (tally.examples.length < examples) {
                  tally.examples.push({ case: `${sets[n]!}/${input.id}`, font, letterSpacing: assigned.letterSpacing ?? '', direction: assigned.direction ?? '', whole, at: s, whole16, withSpaces16, wordsAlone16 })
                }
              }
              if (wordsAlone16 !== null) {
                tally.aloneTried++
                const aloneOff = Math.abs(wordsAlone16 - whole16)
                if (aloneOff === 0) tally.aloneExact++
                else if (aloneOff > tally.aloneLargest16) tally.aloneLargest16 = aloneOff
              }
            }
          }
        }
      }
    }
  }
  console.error(`[store-space-identity] ${browser}-${config} ${sets[n]!}: ${seenCases} cases, ${total.tried} tried, ${total.exact} exact`)
}

const row = (key: string, tally: Tally): unknown => ({
  key, cases: tally.cases, tried: tally.tried, exact: tally.exact, off: tally.tried - tally.exact, largestOffPx: tally.largest16 / 65536,
  wordsAloneTried: tally.aloneTried, wordsAloneExact: tally.aloneExact, wordsAloneLargestOffPx: tally.aloneLargest16 / 65536, examples: tally.examples,
})
const report = {
  browser, config, cases: seenCases, total: row('all', total),
  byKind: [...byKind].sort((a, b) => b[1].tried - a[1].tried).map(([key, tally]) => row(key, tally)),
  byFont: [...byFont].sort((a, b) => (b[1].tried - b[1].exact) - (a[1].tried - a[1].exact) || b[1].tried - a[1].tried).map(([key, tally]) => row(key, tally)),
}
const text = `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
