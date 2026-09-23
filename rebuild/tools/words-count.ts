// Counts for words first in Blink's port (shape.ts addWordPieces, line-breaker.ts wordCandidate), under the stand-in
// Canvas, which is no font: what a chat message asks of Canvas from scratch and at other widths, and how each plain line
// found its candidate. Not a test.
//
//   bun rebuild/tools/words-count.ts [--tree=<checkout>] --set=bench-latin|bench-mix|bench-real|ascii-once|languages-once
//     [--count=N] [--widths=320,260,380,440] [--device-pixel-ratio=2] [--pool=message|page] [--out=<report.json>]
//
// Every message is prepared plain from scratch with its font checks and filled at the first width, then the kept
// paragraph is filled at the other widths, then at every width once more (widths it has met). Per step: questions,
// UTF-16 units sent, the questions new to the page (a context's assigned settings and a string), which is what a canvas
// kept by the page would not have met, and the questions whose answer is 256 px or more. `--pool` hands every message a
// list of contexts of its own (the default) or the page's one list. `--tree` counts another checkout with the same
// messages. Lines are tallied by how they found their candidate: `cuts` (from the cuts' positions), `no search` (no
// position was read) and `searched`, with the reason by the negative number wordCandidate returned. The sets are
// tools/store-real-text.ts's.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Paragraph, FontDecl } from '../src/model.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const tree = resolve(options.get('tree') ?? resolve(import.meta.dir, '../..'))
const set = options.get('set') ?? 'bench-latin'
const widths = (options.get('widths') ?? '320,260,380,440').split(',').map(Number)
const pagePool = options.get('pool') === 'page'

const REASONS: Record<string, string> = {
  '-5': 'negative spacing', '-6': 'positions at the cuts run backwards, or the word end lies outside its cuts', '-7': 'the unit starts at a cut that is not after a space',
  '-8': 'a soft hyphen or a HanKerning close mark in the word', '-9': 'white space starts the unit', '-10': 'more than a word and one space between two cuts',
  '-11': 'the unit ends at a cut that is not after a space', '-12': 'the line\'s first word overflows',
  '-13': 'a break opportunity inside the overflowing word', '-3': 'a tab run', '-4': 'a right-to-left item', 'before': 'a search kept below an offset',
}

const bench = await import(join(tree, 'rebuild/bench/cases.ts')) as { CHAT_LENGTH_CLASSES: Array<{ share: number; min: number; max: number }>; CHAT_STYLE: { font: FontDecl; lineHeight: number; direction: 'ltr' | 'rtl'; lang: string }; buildChat: (kind: string, count: number) => unknown[]; chatText: (message: unknown) => string }
const library = await import(join(tree, 'rebuild/src/index.ts')) as { detectEnvironment: (given: unknown) => { kind: string; env: unknown; reason: string }; prepare: (paragraph: Paragraph, env: unknown, inspect: boolean, contexts: unknown) => unknown; fillLine: (prepared: unknown, start: unknown, slot: { width: number; left: number; right: number }) => { kind: string; next: unknown }; firstLine: (prepared: unknown) => unknown }
const model = await import(join(tree, 'rebuild/src/model.ts')) as { UNKNOWN_FONT_FACTS: FontDecl['facts'] }
const canvas = await import(join(tree, 'rebuild/src/measure/canvas.ts')) as { createContextPool: () => unknown }
const breaker = await import(join(tree, 'rebuild/src/engines/blink/line-breaker.ts')) as { LineBreaker: { prototype: { wordCandidate?: (...args: unknown[]) => number } } }

const CORPORA = resolve(import.meta.dir, '../../corpora')

function flow(id: string): string {
  const parts = readFileSync(join(CORPORA, `${id}.txt`), 'utf8').split(/\n\s*\n/)
  const kept: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.replace(/\s+/g, ' ').trim()
    if (part !== '' && !/^[-{]/.test(part)) kept.push(part)
  }
  return kept.join(['zh', 'ja'].includes(id.slice(0, 2)) ? '' : ' ')
}

function toAscii(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, ' - ').replace(/–/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[^ -~]/g, '')
}

let state = 12345
const random = (): number => {
  state = (Math.imul(state, 1103515245) + 12345) >>> 0
  return state / 4294967296
}

function nextLength(): number {
  const classes = bench.CHAT_LENGTH_CLASSES
  const r = random()
  let lengths = classes[classes.length - 1]!
  for (let i = 0, edge = 0; i < classes.length; i++) {
    edge += classes[i]!.share
    if (r < edge) {
      lengths = classes[i]!
      break
    }
  }
  return lengths.min + Math.floor(random() * (lengths.max - lengths.min + 1))
}

function cutOnce(source: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < source.length) {
    let end = Math.min(source.length, at + nextLength())
    if (end < source.length) {
      const space = source.lastIndexOf(' ', end)
      if (space > at + 4) end = space
      else if (source.charCodeAt(end - 1) >= 0xd800 && source.charCodeAt(end - 1) < 0xdc00) end++
    }
    const text = source.slice(at, end).trim()
    if (text !== '') out.push(text)
    at = end
  }
  return out
}

function messagesOf(name: string): string[] {
  switch (name) {
    case 'ascii-once': return cutOnce(toAscii(flow('en-gatsby-opening')))
    case 'languages-once': {
      const ids = readdirSync(CORPORA).filter(file => file.endsWith('.txt') && file !== 'mixed-app-text.txt' && file !== 'ar-risalat-al-ghufran-part-1.txt').map(file => file.slice(0, -4)).sort()
      const lists = ids.map(id => cutOnce(flow(id)))
      const out: string[] = []
      for (let round = 0, more = true; more; round++) {
        more = false
        for (let i = 0; i < lists.length; i++) {
          if (round >= lists[i]!.length) continue
          out.push(lists[i]![round]!)
          more = true
        }
      }
      return out
    }
    case 'bench-latin': return bench.buildChat('latin', Number(options.get('count') ?? 2600)).map(bench.chatText)
    case 'bench-mix': return bench.buildChat('mix', Number(options.get('count') ?? 2600)).map(bench.chatText)
    case 'bench-real': return bench.buildChat('real', Number(options.get('count') ?? 2600)).map(bench.chatText)
    default: throw new Error(`Unknown set ${name}`)
  }
}

const all = messagesOf(set)
const messages = options.get('count') === undefined ? all : all.slice(0, Number(options.get('count')))

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const
type Tally = { asks: number; units: number; newAsks: number; newUnits: number; wideAsks: number; wideUnits: number }
const newTally = (): Tally => ({ asks: 0, units: 0, newAsks: 0, newUnits: 0, wideAsks: 0, wideUnits: 0 })
let current = newTally()
const met = new Set<string>()

function installLog(): void {
  const globals = globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Record<string, unknown> & { measureText(text: string): unknown } } }
  const Inner = globals.OffscreenCanvas
  class Logged {
    inner = new Inner(1, 1).getContext('2d')
    assigned: Record<string, string> = {}
    key: string | null = null
    measureText(text: string): unknown {
      if (this.key === null) {
        let key = ''
        for (let i = 0; i < SETTINGS.length; i++) key += `${this.assigned[SETTINGS[i]!] ?? ''}|`
        this.key = key
      }
      current.asks++
      current.units += text.length
      const question = this.key + text
      if (!met.has(question)) {
        met.add(question)
        current.newAsks++
        current.newUnits += text.length
      }
      // An answer of 256 px or more is no exact total (shape.ts EXACT16): it says that a range is cut further or a window shrinks.
      const answer = this.inner.measureText(text) as { width: number }
      if (answer.width >= 256) {
        current.wideAsks++
        current.wideUnits += text.length
      }
      return answer
    }
  }
  for (let i = 0; i < SETTINGS.length; i++) {
    const name = SETTINGS[i]!
    Object.defineProperty(Logged.prototype, name, {
      get(this: Logged): unknown { return this.inner[name] },
      set(this: Logged, value: unknown): void {
        this.assigned[name] = String(value)
        this.key = null
        this.inner[name] = value
      },
    })
  }
  globals.OffscreenCanvas = class { getContext(): Logged { return new Logged() } } as never
}

installStandInCanvas({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', devicePixelRatio: Number(options.get('device-pixel-ratio') ?? 2), pageLang: bench.CHAT_STYLE.lang })
installLog()
const detected = library.detectEnvironment({ engine: 'blink', build: '153.0.8010.50', contentLanguage: null, uiLanguage: null })
if (detected.kind === 'unsupported') throw new Error(detected.reason)

// How the line being filled found its candidates: the results of wordCandidate, by the tree's own method wrapped.
let outcomes: number[] = []
const fromCuts = breaker.LineBreaker.prototype.wordCandidate
if (fromCuts !== undefined) {
  breaker.LineBreaker.prototype.wordCandidate = function (this: unknown, ...args: unknown[]): number {
    const found = fromCuts.apply(this, args)
    outcomes.push(found)
    return found
  }
}

const lines = { total: 0, cuts: 0, noSearch: 0, searched: 0 }
const reasons = new Map<string, number>()
let neverSearched = 0
let throws = 0
const thrown: string[] = []

function fill(prepared: unknown, width: number): boolean {
  let searched = false
  for (let start = library.firstLine(prepared); start !== null;) {
    outcomes = []
    const filled = library.fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind !== 'line') throw new Error('a slot without insets never refuses a line')
    lines.total++
    let reason: number | null = null
    let found = false
    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i]! >= 0) found = true
      else if (outcomes[i]! < -1 && reason === null) reason = outcomes[i]!
    }
    if (reason !== null) {
      lines.searched++
      searched = true
      const name = REASONS[String(reason)] ?? String(reason)
      reasons.set(name, (reasons.get(name) ?? 0) + 1)
    } else if (found) lines.cuts++
    else lines.noSearch++
    start = filled.next
  }
  return searched
}

const scratch = newTally()
const prepareOnly = newTally()
const later: Tally[] = widths.slice(1).map(newTally)
const again = newTally()
const s = bench.CHAT_STYLE
const page = canvas.createContextPool()
for (let m = 0; m < messages.length; m++) {
  const paragraph: Paragraph = {
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
    font: { ...s.font, facts: model.UNKNOWN_FONT_FACTS }, content: [{ kind: 'text', text: messages[m]! }], lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start',
  }
  try {
    current = scratch
    const before = scratch.asks
    const beforeUnits = scratch.units
    const prepared = library.prepare(paragraph, detected.env, false, pagePool ? page : canvas.createContextPool())
    prepareOnly.asks += scratch.asks - before
    prepareOnly.units += scratch.units - beforeUnits
    let searched = fill(prepared, widths[0]!)
    for (let w = 1; w < widths.length; w++) {
      current = later[w - 1]!
      if (fill(prepared, widths[w]!)) searched = true
    }
    current = again
    const kept = { ...lines }
    const keptReasons = new Map(reasons)
    for (let w = 0; w < widths.length; w++) fill(prepared, widths[w]!)
    Object.assign(lines, kept)
    reasons.clear()
    for (const [name, count] of keptReasons) reasons.set(name, count)
    if (!searched) neverSearched++
  } catch (error) {
    throws++
    if (thrown.length < 10) thrown.push(`${m}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400))
  }
}

const per = (t: Tally): Record<string, number> => ({ asks: +(t.asks / messages.length).toFixed(2), units: +(t.units / messages.length).toFixed(1), newAsks: +(t.newAsks / messages.length).toFixed(2), newUnits: +(t.newUnits / messages.length).toFixed(1), wideAsks: +(t.wideAsks / messages.length).toFixed(2), wideUnits: +(t.wideUnits / messages.length).toFixed(1) })
const report = {
  tree, set, messages: messages.length, widths, devicePixelRatio: Number(options.get('device-pixel-ratio') ?? 2), pool: pagePool ? 'page' : 'message',
  aMessage: { fromScratch: per(scratch), ofItPrepare: { asks: +(prepareOnly.asks / messages.length).toFixed(2), units: +(prepareOnly.units / messages.length).toFixed(1) }, laterWidths: later.map(per), everyWidthAgain: per(again) },
  lines: fromCuts === undefined ? null : { ...lines, reasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])) }, messagesNeverSearched: fromCuts === undefined ? null : neverSearched,
  throws, thrown,
}
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
