// A check on the store study's proposed key, not a test: does a context's assigned settings and a string decide what
// Canvas answers? It reads every recorded Canvas call of every tier case (tests/replay.ts inputs, all sets, held-out sets
// and twins included, the lab's own `native` phase left out) and looks for one key with two answers. No browser.
//
//   bun rebuild/tools/store-key-check.ts --browser=chrome|firefox|webkit-host --config=no-facts|facts [--phase=predict|all]
//     [--examples=25] [--out=<report.json>]
//
// --phase=predict (the default) reads the library's own questions only; all adds the lab's observe and paint phases.

// A key is the seven settings the library assigns (as it spelled them) and the string. An answer is the width; the ink
// box is compared too and counted apart. A key with two answers is classed by where the two were met:
// - one context: the same recorded context of one case (one canvas, one run of assignments);
// - one case: two contexts of one case with equal assigned settings (Blink's partitions by string storage are such);
// - two cases, and then by what differs between their pages: the page language, the device pixel ratio, or nothing the
//   record holds.
// Each class is split by whether the string is Latin-1 only, since only such a string can reach Chrome in two storages.
// Keys are held as two 32-bit hashes in flat tables (the strings of 49 million calls don't fit a Map). Two keys with
// both hashes equal would show as a false conflict: with 20 million keys the chance of one such pair is about 1 in
// 100,000, and an example can be looked up in its two cases.
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
const examples = Number(options.get('examples') ?? 25)
const predictOnly = (options.get('phase') ?? 'predict') === 'predict'

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const
const BITS = browser === 'chrome' ? 25 : 24
const SIZE = 1 << BITS
const MASK = SIZE - 1
const hashA = new Uint32Array(SIZE)
const hashB = new Uint32Array(SIZE)
const used = new Uint8Array(SIZE)
const width = new Float64Array(SIZE)
const ink = new Float64Array(SIZE)
const firstCase = new Int32Array(SIZE)
const firstContext = new Int32Array(SIZE)

type Met = { caseId: string; set: string; pageLang: string; devicePixelRatio: number }
const cases: Met[] = []

type Example = { settings: string; text: string; units: number; first: { case: string; pageLang: string; width: number }; second: { case: string; pageLang: string; width: number } }
type Class = { keys: number; examples: Example[]; bySet: Record<string, number> }
const classes = new Map<string, Class>()
const inkClasses = new Map<string, number>()
let calls = 0
let distinctKeys = 0

function latin1Only(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) return false
  return true
}

function note(name: string, set: string, example: () => Example): void {
  let entry = classes.get(name)
  if (entry === undefined) {
    entry = { keys: 0, examples: [], bySet: {} }
    classes.set(name, entry)
  }
  entry.keys++
  entry.bySet[set] = (entry.bySet[set] ?? 0) + 1
  if (entry.examples.length < examples) entry.examples.push(example())
}

const dir = referenceDir(browser, config)
const manifest = readInputs(dir)
const sets = Object.keys(manifest.sets)
for (let n = 0; n < sets.length; n++) {
  const shards = manifest.sets[sets[n]!]!.shards
  for (let k = 0; k < shards.length; k++) {
    const inputs = readShard<InputCase>(join(dir, 'inputs', shards[k]!.file))
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
      const caseIndex = cases.length
      cases.push({ caseId: input.id, set: sets[n]!, pageLang: input.env.pageLang, devicePixelRatio: input.env.devicePixelRatio })
      const record = input.record
      const settingsOf: string[] = []
      for (let c = 0; c < record.contexts.length; c++) {
        const assigned = record.contexts[c]!.assigned
        let key = ''
        for (let s = 0; s < SETTINGS.length; s++) key += `${assigned[SETTINGS[s]!] ?? ''}|`
        settingsOf.push(key)
      }
      for (let at = 0; at < record.calls.length; at++) {
        if (at >= record.phases.native[0] && at < record.phases.native[1]) continue
        if (predictOnly && (at < record.phases.predict[0] || at >= record.phases.predict[1])) continue
        const call = record.calls[at]!
        calls++
        const key = `${settingsOf[call[0]]!}\n${call[1]}`
        const a = Number(Bun.hash.xxHash32(key, 1))
        const b = Number(Bun.hash.xxHash32(key, 2))
        const inkValue = call[3] * 3 + call[4] * 5 + call[5] * 7 + call[6] * 11
        let slot = a & MASK
        while (used[slot] !== 0 && (hashA[slot] !== a || hashB[slot] !== b)) slot = (slot + 1) & MASK
        if (used[slot] === 0) {
          used[slot] = 1
          hashA[slot] = a
          hashB[slot] = b
          width[slot] = call[2]
          ink[slot] = inkValue
          firstCase[slot] = caseIndex
          firstContext[slot] = call[0]
          distinctKeys++
          continue
        }
        // 1: one answer so far; 3: one width and two ink boxes; 2: two widths.
        if (used[slot] === 2) continue
        const sameWidth = width[slot] === call[2]
        if (sameWidth && (used[slot] === 3 || ink[slot] === inkValue)) continue
        const first = cases[firstCase[slot]!]!
        const where = firstCase[slot] === caseIndex
          ? (firstContext[slot] === call[0] ? 'one context' : 'one case, two contexts with equal settings')
          : first.pageLang !== input.env.pageLang ? 'two cases, another page language'
          : first.devicePixelRatio !== input.env.devicePixelRatio ? 'two cases, another device pixel ratio'
          : 'two cases, the same page facts'
        const name = `${where}; ${latin1Only(call[1]) ? 'Latin-1 only' : 'holds a unit above U+00FF'}`
        if (!sameWidth) {
          used[slot] = 2
          const firstWidth = width[slot]!
          note(name, sets[n]!, () => ({
            settings: settingsOf[call[0]]!, text: call[1], units: call[1].length,
            first: { case: `${first.set}/${first.caseId}`, pageLang: first.pageLang, width: firstWidth },
            second: { case: `${sets[n]!}/${input.id}`, pageLang: input.env.pageLang, width: call[2] },
          }))
        } else {
          used[slot] = 3
          inkClasses.set(name, (inkClasses.get(name) ?? 0) + 1)
        }
      }
    }
  }
  console.error(`[store-key-check] ${browser}-${config} ${sets[n]!}: ${cases.length} cases, ${calls} calls, ${distinctKeys} keys`)
}

const report = {
  browser, config, phase: predictOnly ? 'predict' : 'all', cases: cases.length, calls, distinctKeys, tableSlots: SIZE,
  keysWithTwoWidths: [...classes].map(([name, entry]) => ({ class: name, keys: entry.keys, bySet: entry.bySet, examples: entry.examples })),
  keysWithOneWidthAndTwoInkBoxes: [...inkClasses].map(([name, keys]) => ({ class: name, keys })),
}
const text = `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
