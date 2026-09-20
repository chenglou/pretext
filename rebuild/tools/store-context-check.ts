// The store prototype's key, checked against every recorded Canvas answer (x-perf-store; the second reading's tool). The
// store study's tools/store-key-check.ts asked whether a context's seven assigned settings and a string decide the
// answer, and read the records' calls. The prototype's key is another: the context a question finds through ALL of its
// settings, the partition too (src/measure/canvas.ts sameSettings), and the key the engine hands `width`, which for
// Blink's forced slice is not the measured string (engines/blink/shape.ts canvasString). A record holds no partition
// (tests/replay.ts: two contexts with equal assigned settings are told apart only by order), so this check lets the
// library say it: every tier case is replayed from its record through the usual predictor (a list of contexts a case, so
// a store a case), on a scratch copy of rebuild/src and rebuild/lab with one line added after each of the two
// measureText calls of measure/canvas.ts. The line hands this tool the context record, the key and the answer of every
// question that reached Canvas, which is what the case's store keeps.
//
// A counterexample is one key of one context's settings with two recorded answers anywhere: a page whose list had met
// the first case would have answered the second from its store, where the second case's own Canvas said otherwise.
// Classed by where the two were met, as the study's tool does: the same page facts, another page language, another
// device pixel ratio, other given process languages. No browser.
//
//   bun rebuild/tools/store-context-check.ts --browser=chrome|firefox|webkit-host --config=no-facts|facts [--examples=40] [--out=<report.json>]
//
// Keys are held as two 32-bit hashes in flat tables, as in the study's tool. A case that asks a question its record
// lacks (a changed recipe: B1b's cut) stops there; what it asked before counts, and the report says how many stopped.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installReplay, NewQuestion } from '../lab/measurements.ts'
import type { Predictor } from '../lab/predictor-core.ts'
import { readInputs, readShard, referenceDir, type InputCase } from '../tests/replay.ts'
import { PREDICTORS, type Config, type TierBrowser } from '../tests/sets.ts'

const REPO = resolve(import.meta.dir, '../..')
const CANVAS = 'rebuild/src/measure/canvas.ts'
const WIDTH_ANCHOR = '  const w = context.ctx.measureText(text).width'
const BOX_ANCHOR = '  context.inkBoxes.set(text, box)'
const WIDTH_TAP = '  ;(globalThis as { storeTap?: (context: Context, kind: string, key: string, width: number, left: number, right: number) => void }).storeTap?.(context, \'w\', key, w, 0, 0)'
const BOX_TAP = '  ;(globalThis as { storeTap?: (context: Context, kind: string, key: string, width: number, left: number, right: number) => void }).storeTap?.(context, \'b\', text, box.width, box.left, box.right)'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const browser = (options.get('browser') ?? 'chrome') as TierBrowser
const config = (options.get('config') ?? 'no-facts') as Config
const examples = Number(options.get('examples') ?? 40)

const scratch = mkdtempSync(join(tmpdir(), 'store-context-check-'))
execFileSync('mkdir', ['-p', join(scratch, 'rebuild')])
for (const folder of ['src', 'lab', 'facts', 'data']) execFileSync('cp', ['-cR', join(REPO, 'rebuild', folder), join(scratch, 'rebuild', folder)])
const source = readFileSync(join(scratch, CANVAS), 'utf8')
if (source.split(WIDTH_ANCHOR).length !== 2 || source.split(BOX_ANCHOR).length !== 2) {
  execFileSync('trash', [scratch])
  throw new Error(`${CANVAS} doesn't hold each of the check's two anchors once`)
}
writeFileSync(join(scratch, CANVAS), source.replace(WIDTH_ANCHOR, `${WIDTH_ANCHOR}\n${WIDTH_TAP}`).replace(BOX_ANCHOR, `${BOX_ANCHOR}\n${BOX_TAP}`))
const predictor = await import(join(scratch, PREDICTORS[config])) as Predictor

const BITS = browser === 'chrome' ? 24 : 23
const SIZE = 1 << BITS
const MASK = SIZE - 1
const hashA = new Uint32Array(SIZE)
const hashB = new Uint32Array(SIZE)
// 0: free; 1: one answer so far; 2: two answers, already listed.
const used = new Uint8Array(SIZE)
const answer = new Float64Array(SIZE)
const firstCase = new Int32Array(SIZE)

type Met = { caseId: string; set: string; pageLang: string; devicePixelRatio: number; languages: string }
type Settings = { font: string; lang: string; letterSpacing: string; wordSpacing: string; fontKerning: string; textRendering: string; direction: string; partition: string }
type Example = { settings: string; kind: string; key: string; units: number; first: { case: string; pageLang: string; answer: number }; second: { case: string; pageLang: string; answer: number } }
type Class = { keys: number; examples: Example[]; bySet: Record<string, number> }
const cases: Met[] = []
const classes = new Map<string, Class>()
let asked = 0
let distinctKeys = 0
let stoppedAtNewQuestion = 0
let predictionErrors = 0
let current = -1
let currentSet = ''

function latin1Only(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) return false
  return true
}

// A context record's settings are one object for its life, so their spelling is made once per object.
const spelled = new WeakMap<object, string>()
function settingsOf(context: { settings: Settings }): string {
  let text = spelled.get(context.settings)
  if (text === undefined) {
    const s = context.settings
    text = `${s.font}|${s.lang}|${s.letterSpacing}|${s.wordSpacing}|${s.fontKerning}|${s.textRendering}|${s.direction}|${s.partition}`
    spelled.set(context.settings, text)
  }
  return text
}

;(globalThis as unknown as { storeTap: (context: { settings: Settings }, kind: string, key: string, width: number, left: number, right: number) => void }).storeTap = (context, kind, key, width, left, right) => {
  asked++
  const settings = settingsOf(context)
  const full = `${kind}|${settings}\n${key}`
  const a = Number(Bun.hash.xxHash32(full, 1))
  const b = Number(Bun.hash.xxHash32(full, 2))
  const value = kind === 'w' ? width : width * 3 + left * 5 + right * 7
  let slot = a & MASK
  while (used[slot] !== 0 && (hashA[slot] !== a || hashB[slot] !== b)) slot = (slot + 1) & MASK
  if (used[slot] === 0) {
    used[slot] = 1
    hashA[slot] = a
    hashB[slot] = b
    answer[slot] = value
    firstCase[slot] = current
    distinctKeys++
    return
  }
  if (used[slot] === 2 || answer[slot] === value) return
  used[slot] = 2
  const first = cases[firstCase[slot]!]!
  const second = cases[current]!
  const where = firstCase[slot] === current ? 'one case'
    : first.pageLang !== second.pageLang ? 'two cases, another page language'
    : first.devicePixelRatio !== second.devicePixelRatio ? 'two cases, another device pixel ratio'
    : first.languages !== second.languages ? 'two cases, other given process languages'
    : 'two cases, the same page facts'
  const name = `${where}; ${kind === 'w' ? 'width' : 'ink box'}; ${latin1Only(key) ? 'Latin-1 only' : 'holds a unit above U+00FF'}`
  let entry = classes.get(name)
  if (entry === undefined) {
    entry = { keys: 0, examples: [], bySet: {} }
    classes.set(name, entry)
  }
  entry.keys++
  entry.bySet[currentSet] = (entry.bySet[currentSet] ?? 0) + 1
  if (entry.examples.length < examples) entry.examples.push({
    settings, kind, key, units: key.length,
    first: { case: `${first.set}/${first.caseId}`, pageLang: first.pageLang, answer: answer[slot]! },
    second: { case: `${second.set}/${second.caseId}`, pageLang: second.pageLang, answer: value },
  })
}

const dir = referenceDir(browser, config)
const manifest = readInputs(dir)
const sets = Object.keys(manifest.sets)
for (let n = 0; n < sets.length; n++) {
  currentSet = sets[n]!
  const shards = manifest.sets[currentSet]!.shards
  for (let k = 0; k < shards.length; k++) {
    const inputs = readShard<InputCase>(join(dir, 'inputs', shards[k]!.file))
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!
      current = cases.length
      cases.push({ caseId: input.id, set: currentSet, pageLang: input.env.pageLang, devicePixelRatio: input.env.devicePixelRatio, languages: JSON.stringify(input.languages) })
      const replay = installReplay(input.record, input.env, 'predict')
      try {
        const hook = predictor.predict(input.case, { browser: input.browser, build: input.build.engine, languages: input.languages })
        if ('error' in hook) predictionErrors++
      } catch (error) {
        if (error instanceof NewQuestion) stoppedAtNewQuestion++
        else predictionErrors++
      } finally {
        replay.restore()
      }
    }
  }
  console.error(`[store-context-check] ${browser}-${config} ${currentSet}: ${cases.length} cases, ${asked} questions reached Canvas, ${distinctKeys} keys`)
}
execFileSync('trash', [scratch])

const report = {
  browser, config, cases: cases.length, questionsThatReachedCanvas: asked, distinctKeys, tableSlots: SIZE, stoppedAtNewQuestion, predictionErrors,
  keysWithTwoAnswers: [...classes].map(([name, entry]) => ({ class: name, keys: entry.keys, bySet: entry.bySet, examples: entry.examples })),
}
const text = `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
