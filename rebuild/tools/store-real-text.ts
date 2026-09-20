// A check on the store study's hit rates, not a test: the study's messages are 10,000 random slices of a few texts, so
// slices overlap and long strings repeat across messages. Here every unit of a source text is used once: consecutive
// slices of the checked-in long-form corpora (corpora/*.txt), with the bench's chat lengths, under the stand-in Canvas.
//
//   bun rebuild/tools/store-real-text.ts --engine=blink|webkit|gecko --set=ascii-once|languages-once|bench-latin|bench-mix
//     [--count=N] [--out=<report.json>]
//
// - ascii-once: the bench's ASCII source (en-gatsby-opening, made printable ASCII as bench/cases.ts does), cut once from
//   start to end: about 2,600 messages, no unit of text in two messages.
// - languages-once: the other corpora (Arabic, Hebrew, Hindi, Japanese, Khmer, Korean, Burmese, Thai, Urdu, Chinese,
//   and the English text with its curly quotes), cut the same way and dealt in turn, so the page's languages mix as the
//   messages accumulate. The Arabic text the bench uses is left out; ar-al-bukhala stands for Arabic.
// - bench-latin, bench-mix: the bench's own generator, for the same tallies over the same number of messages.
// A question is a context's assigned settings and a string, as in tools/store-study.ts. Per block of messages it counts
// the asks and the ones new to the page, split by the string's length (1 or 2 units, 3 to 16, over 16), since the
// study's claim is that short strings repeat across messages and long ones don't.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { blinkFontChecks } from '../src/engines/blink/checks.ts'
import * as blink from '../src/engines/blink/index.ts'
import { geckoFontChecks } from '../src/engines/gecko/checks.ts'
import * as gecko from '../src/engines/gecko/index.ts'
import { webkitFontChecks } from '../src/engines/webkit/checks.ts'
import * as webkit from '../src/engines/webkit/index.ts'
import { detectEnvironment, fillLine, firstLine, type Environment, type EngineName, type GivenFacts, type Prepared } from '../src/index.ts'
import { withLearnedFontFacts } from '../src/measure/font-checks.ts'
import { UNKNOWN_FONT_FACTS, type FontDecl, type Paragraph } from '../src/model.ts'
import { CHAT_LENGTH_CLASSES, CHAT_STYLE, CHAT_WIDTH, buildChat, chatText } from '../bench/cases.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const USER_AGENTS: Record<EngineName, string> = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15 webkit-host/22625.1.29.11.27',
}

function givenFacts(engine: EngineName): GivenFacts {
  switch (engine) {
    case 'blink': return { engine, build: '153.0.8010.50', contentLanguage: null, uiLanguage: null }
    case 'webkit': return { engine, build: '22625.1.29.11.27', contentLanguage: null, pageZoom: 1, preferredLanguages: null, icuDefaultLocale: null }
    case 'gecko': return { engine, build: '156.0', contentLanguage: null, regionalPrefsLocale: null }
  }
}

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const engine = (options.get('engine') ?? 'blink') as EngineName
const set = options.get('set') ?? 'ascii-once'

// ---- The messages ----

const CORPORA = resolve(import.meta.dir, '../../corpora')
const NO_SPACES = ['zh', 'ja']

// bench/cases.ts flow: a text's paragraphs as one flow, rules and wiki templates left out.
function flow(id: string): string {
  const parts = readFileSync(join(CORPORA, `${id}.txt`), 'utf8').split(/\n\s*\n/)
  const kept: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.replace(/\s+/g, ' ').trim()
    if (part !== '' && !/^[-{]/.test(part)) kept.push(part)
  }
  return kept.join(NO_SPACES.includes(id.slice(0, 2)) ? '' : ' ')
}

// bench/cases.ts toAscii.
function toAscii(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, ' - ').replace(/–/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[^ -~]/g, '')
}

// A small generator of its own, so the lengths are the bench's classes without the bench's random starts.
let state = 12345
const random = (): number => {
  state = (Math.imul(state, 1103515245) + 12345) >>> 0
  return state / 4294967296
}

function nextLength(): number {
  const r = random()
  let lengths = CHAT_LENGTH_CLASSES[CHAT_LENGTH_CLASSES.length - 1]!
  for (let i = 0, edge = 0; i < CHAT_LENGTH_CLASSES.length; i++) {
    edge += CHAT_LENGTH_CLASSES[i]!.share
    if (r < edge) {
      lengths = CHAT_LENGTH_CLASSES[i]!
      break
    }
  }
  return lengths.min + Math.floor(random() * (lengths.max - lengths.min + 1))
}

// Consecutive slices from start to end. A slice ends at the last space at or before its length where the text has
// spaces, and never inside a surrogate pair.
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
    case 'bench-latin': return buildChat('latin', Number(options.get('count') ?? 2600)).map(chatText)
    case 'bench-mix': return buildChat('mix', Number(options.get('count') ?? 2600)).map(chatText)
    default: throw new Error(`Unknown set ${name}`)
  }
}

const all = messagesOf(set)
const messages = options.get('count') === undefined ? all : all.slice(0, Number(options.get('count')))

// ---- The log (tools/store-study.ts installLog, without stacks) ----

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const
let onCall: (settings: string, text: string) => void = () => {}

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
      onCall(this.key, text)
      return this.inner.measureText(text)
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

installStandInCanvas({ userAgent: USER_AGENTS[engine], devicePixelRatio: 2, pageLang: CHAT_STYLE.lang })
installLog()
const detected = detectEnvironment(givenFacts(engine))
if (detected.kind === 'unsupported') throw new Error(detected.reason)
const env: Environment = detected.env

function paragraphOf(text: string): Paragraph {
  const s = CHAT_STYLE
  const font: FontDecl = { ...s.font, facts: UNKNOWN_FONT_FACTS }
  return {
    letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
    font, content: [{ kind: 'text', text }], lineHeight: s.lineHeight, direction: s.direction, lang: s.lang, textIndent: 0, textAlign: 'start',
  }
}

function prepareMessage(text: string): Prepared {
  const paragraph = paragraphOf(text)
  switch (env.engine) {
    case 'blink': return { engine: 'blink', state: blink.prepare(withLearnedFontFacts(paragraph, blinkFontChecks(env)), env, false) }
    case 'webkit': return { engine: 'webkit', state: webkit.prepare(withLearnedFontFacts(paragraph, webkitFontChecks), env, false) }
    case 'gecko': return { engine: 'gecko', state: gecko.prepare(withLearnedFontFacts(paragraph, geckoFontChecks), env, false) }
  }
}

function fillAll(prepared: Prepared, width: number): void {
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    start = filled.next
  }
}

// ---- The tallies ----

const LENGTHS = ['1 or 2 units', '3 to 16 units', 'over 16 units'] as const
const lengthClass = (text: string): number => text.length <= 2 ? 0 : text.length <= 16 ? 1 : 2
type Block = { from: number; to: number; asks: number[]; fresh: number[]; freshUnits: number[] }
const newBlock = (from: number): Block => ({ from, to: from, asks: [0, 0, 0], fresh: [0, 0, 0], freshUnits: [0, 0, 0] })

const page = new Map<string, Set<string>>()
const EDGES = [100, 500, 1000, 1500, 2000, 2500, 5000, 10000]
const blocks: Block[] = []
let block = newBlock(0)
onCall = (settings, text) => {
  let strings = page.get(settings)
  if (strings === undefined) {
    strings = new Set()
    page.set(settings, strings)
  }
  const kind = lengthClass(text)
  block.asks[kind]!++
  if (strings.has(text)) return
  strings.add(text)
  block.fresh[kind]!++
  block.freshUnits[kind]! += text.length
}
let units = 0
for (let i = 0; i < messages.length; i++) {
  units += messages[i]!.length
  fillAll(prepareMessage(messages[i]!), CHAT_WIDTH)
  if (EDGES.includes(i + 1) || i + 1 === messages.length) {
    block.to = i + 1
    blocks.push(block)
    block = newBlock(i + 1)
  }
}

const report = {
  engine, set, messages: messages.length, unitsOfText: units,
  blocks: blocks.map(b => {
    const over = b.to - b.from
    const asks = b.asks[0]! + b.asks[1]! + b.asks[2]!
    const fresh = b.fresh[0]! + b.fresh[1]! + b.fresh[2]!
    return {
      messages: `${b.from + 1} to ${b.to}`, asksPerMessage: asks / over, newToThePagePerMessage: fresh / over, hitRate: 1 - fresh / asks,
      newUnitsPerMessage: (b.freshUnits[0]! + b.freshUnits[1]! + b.freshUnits[2]!) / over,
      byLength: LENGTHS.map((name, k) => ({ length: name, asksPerMessage: b.asks[k]! / over, newPerMessage: b.fresh[k]! / over, hitRate: b.asks[k] === 0 ? null : 1 - b.fresh[k]! / b.asks[k]! })),
    }
  }),
}
const text = `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
