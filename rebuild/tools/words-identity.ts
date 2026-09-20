// A check for the word pieces study, not a test: in Chrome, is a run measured whole equal to its words each measured with
// its trailing space, plus the pair adjustment between each space and the cluster after it? That is what Blink's port adds
// up when a shaping group is cut after every space (shape.ts measureGroups): W(L s R) = W(L s) + W(R) + d, with
// d = W(s c) - W(s) - W(c) and c the first grapheme of R, in 16.16 units. Read from the recorded Canvas answers of the tier
// cases (tests/replay.ts inputs), like tools/store-space-identity.ts, whose identity W(L s R) = W(L s) + W(s R) - W(s) is
// tried beside it on the same positions where the record holds its strings. No browser.
//
//   bun rebuild/tools/words-identity.ts [--browser=chrome] [--config=no-facts|facts] [--examples=8] [--out=<report.json>]
//
// Per case and per recorded context (one canvas), every measured string below 256 px with a space inside (U+2028 as the
// port writes it, or U+0020 in a range kept 8-bit) is tried at each of its spaces where the context holds the five other
// strings. Tallied per font string, and per kind: letter spacing or not, the direction, whether the characters around the
// space are Latin-1, and whether each side holds a character with a script of its own (Canvas resolves a side without one
// under another script when it is measured alone).
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
const examples = Number(options.get('examples') ?? 8)

type Example = { case: string; font: string; letterSpacing: string; direction: string; whole: string; at: number; whole16: number; pieces16: number }
type Tally = { tried: number; exact: number; largest16: number; overlapTried: number; overlapExact: number; cases: number; lastCase: number; examples: Example[] }
const newTally = (): Tally => ({ tried: 0, exact: 0, largest16: 0, overlapTried: 0, overlapExact: 0, cases: 0, lastCase: -1, examples: [] })
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
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

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
            if (!isSpace(whole.charCodeAt(s)) || isSpace(whole.charCodeAt(s + 1))) continue
            const space = whole[s]!
            const left = whole.slice(0, s + 1)
            const right = whole.slice(s + 1)
            const first = graphemes.segment(right)[Symbol.iterator]().next().value!.segment
            const leftWidth = widths.get(left)
            const rightWidth = widths.get(right)
            const pairWidth = widths.get(space + first)
            const spaceWidth = widths.get(space)
            const firstWidth = widths.get(first)
            if (leftWidth === undefined || rightWidth === undefined || pairWidth === undefined || spaceWidth === undefined || firstWidth === undefined) continue
            const whole16 = to16(width)
            const pieces16 = to16(leftWidth) + to16(rightWidth) + to16(pairWidth) - to16(spaceWidth) - to16(firstWidth)
            const spaceRight = widths.get(space + right)
            const overlap16 = spaceRight === undefined ? null : to16(leftWidth) + to16(spaceRight) - to16(spaceWidth)
            const latin = whole.charCodeAt(s - 1) <= 0xff && whole.charCodeAt(s + 1) <= 0xff
            const spaced = (assigned.letterSpacing ?? '0px') === '0px' ? 'no letter spacing' : 'letter spacing'
            const sides = NO_SCRIPT.test(left) || NO_SCRIPT.test(right) ? 'a side without a script of its own' : 'a script on both sides'
            const firstHas = NO_SCRIPT.test(first) ? 'no script in the cluster after the space' : 'a script in the cluster after the space'
            const kind = `${spaced}, ${space === ' ' ? 'U+0020' : 'U+2028'}, ${latin ? 'Latin-1 on both sides' : 'another character beside the space'}, ${assigned.direction ?? ''}, ${sides}, ${firstHas}`
            const tallies = [total, tallyOf(byFont, `${font}, ${spaced}`), tallyOf(byKind, kind)]
            for (let t = 0; t < tallies.length; t++) {
              const tally = tallies[t]!
              tally.tried++
              if (tally.lastCase !== caseIndex) {
                tally.lastCase = caseIndex
                tally.cases++
              }
              const off = Math.abs(pieces16 - whole16)
              if (off === 0) tally.exact++
              else {
                if (off > tally.largest16) tally.largest16 = off
                if (tally.examples.length < examples) {
                  tally.examples.push({ case: `${sets[n]!}/${input.id}`, font, letterSpacing: assigned.letterSpacing ?? '', direction: assigned.direction ?? '', whole, at: s, whole16, pieces16 })
                }
              }
              if (overlap16 !== null) {
                tally.overlapTried++
                if (overlap16 === whole16) tally.overlapExact++
              }
            }
          }
        }
      }
    }
  }
  console.error(`[words-identity] ${browser}-${config} ${sets[n]!}: ${seenCases} cases, ${total.tried} tried, ${total.exact} exact`)
}

const row = (key: string, tally: Tally): unknown => ({
  key, cases: tally.cases, tried: tally.tried, exact: tally.exact, off: tally.tried - tally.exact, largestOffPx: tally.largest16 / 65536,
  overlapTried: tally.overlapTried, overlapExact: tally.overlapExact, examples: tally.examples,
})
const report = {
  browser, config, cases: seenCases, total: row('all', total),
  byKind: [...byKind].sort((a, b) => b[1].tried - a[1].tried).map(([key, tally]) => row(key, tally)),
  byFont: [...byFont].sort((a, b) => (b[1].tried - b[1].exact) - (a[1].tried - a[1].exact) || b[1].tried - a[1].tried).map(([key, tally]) => row(key, tally)),
}
const text = `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
