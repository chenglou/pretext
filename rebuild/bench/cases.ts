// The bench inputs: per script, one text in each size class and a set of chat-like messages, built deterministically from
// the checked-in corpora. Every input is one paragraph both libraries can express: one run in one font, white-space
// normal, word-break normal, overflow-wrap break-word (main's only wrapping mode), line-break auto, no letter or word
// spacing. The rebuild also takes the paragraph's direction, which main has no input for and doesn't need for breaks.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRng } from '../lab/cases/prng.ts'
import type { ChatKind, ChatMessage, ChatPart, ChatPlan, ChatSetId, RowSpec, Scenario, Script, ScriptStyle, SizeClass } from './protocol.ts'

export const SCRIPTS: readonly Script[] = ['latin', 'cjk', 'arabic', 'mixed']
export const SIZES: readonly SizeClass[] = ['tiny', 'sentence', 'paragraph', 'long', 'corpus']
export const SCENARIOS: readonly Scenario[] = ['cold', 'sweep', 'many', 'chat']

// UTF-16 units, inclusive.
export const SIZE_RANGES: Record<SizeClass, readonly [number, number]> = {
  tiny: [1, 19],
  sentence: [20, 100],
  paragraph: [101, 1000],
  long: [1001, 10000],
  corpus: [10001, Number.MAX_SAFE_INTEGER],
}

export const LINE_HEIGHT = 20
export const COLD_WIDTH = 320
// 160, 190, ..., 730.
export const SWEEP_WIDTHS: readonly number[] = Array.from({ length: 20 }, (_, i) => 160 + 30 * i)
export const MESSAGE_WIDTH = 320

function style(script: ScriptStyle['script'], lang: string, family: string, direction: ScriptStyle['direction']): ScriptStyle {
  return { script, lang, font: { family, size: 16, weight: 400, style: 'normal' }, mainFont: `16px ${family}`, direction, lineHeight: LINE_HEIGHT }
}

// Installed macOS families the lab's font-facts table covers.
export const STYLES: Record<Script, ScriptStyle> = {
  latin: style('latin', 'en', '"Helvetica Neue"', 'ltr'),
  cjk: style('cjk', 'zh-Hant', '"PingFang TC"', 'ltr'),
  arabic: style('arabic', 'ar', '"Geeza Pro"', 'rtl'),
  mixed: style('mixed', 'en', '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', 'ltr'),
}

const CORPORA_DIR = resolve(import.meta.dir, '../../corpora')

function corpus(id: string): string {
  return readFileSync(join(CORPORA_DIR, `${id}.txt`), 'utf8')
}

function paragraphs(text: string): string[] {
  const out: string[] = []
  const parts = text.split(/\n+/)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim()
    if (part !== '') out.push(part)
  }
  return out
}

type Sources = Record<Script, string>
let sources: Sources | null = null

// latin: The Great Gatsby's opening. cjk: 祝福 then 故鄉, joined, since neither story alone is over 10,000 units. arabic:
// رسالة الغفران, part 1. mixed: mixed-app-text's paragraphs round-robin with paragraphs of the other three.
function getSources(): Sources {
  if (sources !== null) return sources
  const latin = corpus('en-gatsby-opening')
  const cjk = `${corpus('zh-zhufu').trim()}\n\n${corpus('zh-guxiang').trim()}`
  const arabic = corpus('ar-risalat-al-ghufran-part-1')
  const pools = [paragraphs(corpus('mixed-app-text')), paragraphs(latin), paragraphs(cjk), paragraphs(arabic)]
  const parts: string[] = []
  let length = 0
  for (let round = 0; length < 40_000; round++) {
    for (let p = 0; p < pools.length; p++) {
      const pool = pools[p]!
      const part = pool[round % pool.length]!
      parts.push(part)
      length += part.length + 2
    }
  }
  sources = { latin, cjk, arabic, mixed: parts.join('\n\n') }
  return sources
}

const BOUNDARY = /[\s。，、！？；」』]/u

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

// From `start`, the longest slice of at most `max` units ending at a boundary, trimmed. When no boundary lies past
// start + min, the slice ends at start + min, moved off a surrogate pair.
function excerpt(source: string, start: number, min: number, max: number): string {
  let end = Math.min(source.length, start + max)
  while (end > start + min && !BOUNDARY.test(source[end - 1]!)) end--
  if (end < source.length && isHighSurrogate(source.charCodeAt(end - 1))) end++
  return source.slice(start, end).trim()
}

// The first unit after the next boundary at or after `offset`, past white space.
function alignStart(source: string, offset: number): number {
  let i = offset
  while (i > 0 && i < source.length && !BOUNDARY.test(source[i - 1]!)) i++
  while (i < source.length && /\s/u.test(source[i]!)) i++
  return i
}

const TINY: Record<Script, string> = {
  latin: 'Thanks, see you!',
  cjk: '「你好嗎？」她問道。',
  arabic: 'مرحبا بالعالم',
  mixed: 'ok 好的 👍 شكرا',
}

const SENTENCE: Record<Script, string> = {
  latin: 'Please update the release notes before Friday, then ping the whole team.',
  cjk: '舊曆的年底畢竟最像年底，村鎮上不必說，就在天空中也顯出將到新年的氣象來。',
  arabic: 'هذا جيد، ولكن لا تكسر العبارة «فيقول: وعليك السلام» داخل البطاقة.',
  mixed: 'Kenji answered 「了解です」 and هذا جيد 👩‍💻 before 7:00-9:00.',
}

const TARGET: Record<'paragraph' | 'long' | 'corpus', number> = { paragraph: 600, long: 5000, corpus: 15000 }

export function buildInput(script: Script, size: SizeClass): string {
  const text = size === 'tiny' ? TINY[script]
    : size === 'sentence' ? SENTENCE[script]
    : excerpt(getSources()[script], 0, TARGET[size] / 2, TARGET[size])
  const [min, max] = SIZE_RANGES[size]
  if (text.length < min || text.length > max) throw new Error(`Input ${script}/${size} has ${text.length} units; expected ${min}-${max}`)
  return text
}

const EMOJI = ['👍', '🎉', '👩‍💻', '❤️', '😂']

// Chat-like messages: a quarter tiny (5-19 units), half sentences (20-100), a quarter short paragraphs (101-400), each a
// slice of the script's source at a random boundary. A fifth of the mixed messages end with an emoji.
export function buildMessages(script: Script, count: number): string[] {
  const rng = createRng(`rebuild-bench-messages-${script}`)
  const source = getSources()[script]
  const out: string[] = []
  while (out.length < count) {
    const r = rng.next()
    const [min, max] = r < 0.25 ? [5, 19] : r < 0.75 ? [20, 100] : [101, 400]
    const start = alignStart(source, rng.int(source.length - 1000))
    let text = excerpt(source, start, min, max)
    if (script === 'mixed' && rng.chance(0.2)) text += ` ${rng.pick(EMOJI)}`
    if (text.length > 0) out.push(text)
  }
  return out
}

// ---- Chat: what an app with many short rich messages lays out (README.md, "Chat") ----

// One declaration for every message, as an app sets one font on its bubbles: the mixed rows' list, so CJK and Arabic
// messages have a listed family and emoji go to the system's fallback. Inline code is 14px Menlo with 6px of padding on
// each inline side, the Markdown chat demo's shape (pages/demos/markdown-chat.model.ts).
export const CHAT_STYLE: ScriptStyle = style('chat', 'en', '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', 'ltr')
export const CHAT_CODE_FONT: ChatPlan['codeFont'] = { family: 'Menlo', size: 14, weight: 400, style: 'normal' }
export const CHAT_CODE_PADDING = 6
export const CHAT_WIDTH = 320
export const CHAT_RESIZE_WIDTHS: readonly number[] = [260, 380, 440]
export const CHAT_SETS: readonly ChatSetId[] = ['mix', 'latin']

// The mix, by kind. Shares sum to 1.
export const CHAT_KIND_SHARES: readonly (readonly [ChatKind, number])[] = [
  ['latin', 0.55], ['latin-smart', 0.08], ['latin-emoji', 0.08], ['latin-url', 0.05], ['latin-code', 0.07], ['cjk', 0.07], ['arabic', 0.05], ['app-mixed', 0.05],
]

// A message's text before its kind adds an emoji, a URL or a code span, in UTF-16 units: a quarter short, half medium,
// 22% long, 3% very long, with the length uniform inside its class and the slice ending at a boundary at or before it.
export const CHAT_LENGTH_CLASSES: readonly { name: string; share: number; min: number; max: number }[] = [
  { name: 'short', share: 0.25, min: 5, max: 19 },
  { name: 'medium', share: 0.5, min: 20, max: 100 },
  { name: 'long', share: 0.22, min: 101, max: 400 },
  { name: 'very long', share: 0.03, min: 401, max: 1500 },
]

const CHAT_URLS = [
  'https://example.com/reports/q3?lang=ar&mode=full', 'https://github.com/chenglou/pretext/pull/312',
  'https://en.wikipedia.org/wiki/Line_breaking_rules_in_East_Asian_languages', 'https://docs.example.org/guide/getting-started#install',
  'http://localhost:3002/demos/markdown-chat',
]

const CHAT_CODE = [
  'prepare(text, font)', 'layout(prepared, width, lineHeight)', 'bun run test:wrapping --browser=all', 'white-space: pre-wrap', 'git rebase --onto main',
  'const lines = layoutWithLines(prepared, 320, 20)', 'npm i @chenglou/pretext', 'ctx.measureText(text).width',
]

// The source's paragraphs as one flow, so a slice never holds a newline; rules and wiki templates are left out.
function flow(text: string, joiner: string): string {
  const parts = paragraphs(text)
  const kept: string[] = []
  for (let i = 0; i < parts.length; i++) if (!/^[-{]/.test(parts[i]!)) kept.push(parts[i]!)
  return kept.join(joiner)
}

// Printable ASCII: straight quotes and hyphens for the source's curly quotes and dashes, accents dropped.
function toAscii(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, ' - ').replace(/–/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[^ -~]/g, '')
}

type ChatSources = { latinSmart: string; latin: string; cjk: string; arabic: string; app: string[] }
let chatSources: ChatSources | null = null

function getChatSources(): ChatSources {
  if (chatSources !== null) return chatSources
  const latinSmart = flow(corpus('en-gatsby-opening'), ' ')
  chatSources = {
    latinSmart, latin: toAscii(latinSmart), cjk: flow(`${corpus('zh-zhufu')}\n${corpus('zh-guxiang')}`, ''),
    arabic: flow(corpus('ar-risalat-al-ghufran-part-1'), ' '), app: paragraphs(corpus('mixed-app-text')),
  }
  return chatSources
}

function chatSlice(rng: ReturnType<typeof createRng>, source: string, min: number, max: number): string {
  // Anywhere that leaves `min` units, so a source shorter than `max` (an app-mixed paragraph) still starts anywhere.
  const start = alignStart(source, rng.int(Math.max(1, source.length - min)))
  return excerpt(source, start, min, max)
}

function chatMessage(rng: ReturnType<typeof createRng>, kind: ChatKind): ChatMessage | null {
  const sources = getChatSources()
  const r = rng.next()
  let lengths = CHAT_LENGTH_CLASSES[CHAT_LENGTH_CLASSES.length - 1]!
  for (let i = 0, edge = 0; i < CHAT_LENGTH_CLASSES.length; i++) {
    edge += CHAT_LENGTH_CLASSES[i]!.share
    if (r < edge) {
      lengths = CHAT_LENGTH_CLASSES[i]!
      break
    }
  }
  const source = kind === 'cjk' ? sources.cjk : kind === 'arabic' ? sources.arabic : kind === 'latin-smart' ? sources.latinSmart : kind === 'app-mixed' ? rng.pick(sources.app) : sources.latin
  // A length anywhere in the class, so lengths don't pile up at the class edges.
  const text = chatSlice(rng, source, lengths.min, lengths.min + rng.int(lengths.max - lengths.min + 1))
  if (text.length === 0) return null
  const plain = (whole: string): ChatMessage => ({ kind, parts: [{ code: false, text: whole }] })
  switch (kind) {
    case 'latin': case 'latin-smart': case 'cjk': case 'arabic': case 'app-mixed': return plain(text)
    case 'latin-emoji': {
      const emoji = rng.pick(EMOJI)
      const space = text.indexOf(' ', rng.int(text.length))
      return plain(rng.chance(0.8) || space < 0 ? `${text} ${emoji}` : `${text.slice(0, space)} ${emoji}${text.slice(space)}`)
    }
    case 'latin-url': {
      const url = rng.pick(CHAT_URLS)
      return plain(rng.chance(0.7) ? `${text} ${url}` : `${url} ${text}`)
    }
    case 'latin-code': {
      const code: ChatPart = { code: true, text: rng.pick(CHAT_CODE) }
      const space = text.indexOf(' ', rng.int(text.length))
      if (space < 0) return { kind, parts: [{ code: false, text: `${text} ` }, code] }
      return { kind, parts: [{ code: false, text: text.slice(0, space + 1) }, code, { code: false, text: text.slice(space) }] }
    }
  }
}

// The first `count` messages of a set's stream, so a longer set starts with the shorter one. 'latin' is the mix's 'latin'
// kind alone, from a stream of its own.
export function buildChat(set: ChatSetId, count: number): ChatMessage[] {
  const rng = createRng(`rebuild-bench-chat-${set}`)
  const out: ChatMessage[] = []
  while (out.length < count) {
    let kind: ChatKind = 'latin'
    if (set === 'mix') {
      const r = rng.next()
      for (let i = 0, edge = 0; i < CHAT_KIND_SHARES.length; i++) {
        edge += CHAT_KIND_SHARES[i]![1]
        if (r < edge) {
          kind = CHAT_KIND_SHARES[i]![0]
          break
        }
      }
    }
    const message = chatMessage(rng, kind)
    if (message !== null) out.push(message)
  }
  return out
}

export function chatText(message: ChatMessage): string {
  let text = ''
  for (let i = 0; i < message.parts.length; i++) text += message.parts[i]!.text
  return text
}

// What a set holds, for the report: messages by kind and by length, and how many hold what.
export type ChatMixSummary = {
  messages: number
  units: number
  meanUnits: number
  medianUnits: number
  maxUnits: number
  byKind: { kind: ChatKind; messages: number }[]
  // By the whole text's UTF-16 units, the class edges of CHAT_LENGTH_CLASSES (an added URL or code span can move a
  // message up a class).
  byLength: { name: string; messages: number }[]
  // Messages whose text is printable ASCII, and the rest, which Blink stores in 16 bits or lays out as more than one
  // Latin segment.
  ascii: number
  withEmoji: number
  withCjk: number
  withArabic: number
  withUrl: number
  withCodeSpan: number
  withSoftHyphen: number
}

export function describeChat(messages: readonly ChatMessage[]): ChatMixSummary {
  const byKind = CHAT_KIND_SHARES.map(([kind]) => ({ kind, messages: 0 }))
  const byLength = CHAT_LENGTH_CLASSES.map(({ name }) => ({ name, messages: 0 }))
  const lengths: number[] = []
  const summary: ChatMixSummary = {
    messages: messages.length, units: 0, meanUnits: 0, medianUnits: 0, maxUnits: 0, byKind, byLength, ascii: 0, withEmoji: 0, withCjk: 0, withArabic: 0,
    withUrl: 0, withCodeSpan: 0, withSoftHyphen: 0,
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    const text = chatText(message)
    lengths.push(text.length)
    summary.units += text.length
    byKind.find(entry => entry.kind === message.kind)!.messages++
    let lengthClass = CHAT_LENGTH_CLASSES.length - 1
    while (lengthClass > 0 && text.length < CHAT_LENGTH_CLASSES[lengthClass]!.min) lengthClass--
    byLength[lengthClass]!.messages++
    if (/^[ -~]*$/.test(text)) summary.ascii++
    if (/\p{Extended_Pictographic}/u.test(text)) summary.withEmoji++
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) summary.withCjk++
    if (/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text)) summary.withArabic++
    if (/https?:\/\//.test(text)) summary.withUrl++
    if (message.parts.some(part => part.code)) summary.withCodeSpan++
    if (text.includes(String.fromCharCode(0xad))) summary.withSoftHyphen++
  }
  lengths.sort((a, b) => a - b)
  summary.meanUnits = messages.length === 0 ? 0 : summary.units / messages.length
  summary.medianUnits = lengths.length === 0 ? 0 : lengths[Math.floor(lengths.length / 2)]!
  summary.maxUnits = lengths.length === 0 ? 0 : lengths[lengths.length - 1]!
  return summary
}

export type ChatOptions = { timed: number; headline: number; headlinePasses: number; phasePasses: number }

export function buildChatPlan(options: ChatOptions): ChatPlan {
  const count = Math.max(options.timed, options.headline)
  return {
    codeFont: CHAT_CODE_FONT, codeMainFont: `${CHAT_CODE_FONT.size}px ${CHAT_CODE_FONT.family}`, codePadding: CHAT_CODE_PADDING, width: CHAT_WIDTH,
    resizeWidths: CHAT_RESIZE_WIDTHS.slice(), sets: CHAT_SETS.map(id => ({ id, messages: buildChat(id, count) })), ...options,
  }
}

export type ContextSpec = { style: ScriptStyle; rows: RowSpec[]; chat: ChatPlan | null }

// One context per script with the cold, sweep and many rows, then the chat context, which no script selects.
export function buildContexts(options: { scripts: readonly Script[]; sizes: readonly SizeClass[]; scenarios: readonly Scenario[]; messages: number; chat: ChatOptions }): ContextSpec[] {
  const contexts: ContextSpec[] = []
  for (let s = 0; s < options.scripts.length; s++) {
    const script = options.scripts[s]!
    const rows: RowSpec[] = []
    if (options.scenarios.includes('cold')) {
      for (let i = 0; i < options.sizes.length; i++) {
        const size = options.sizes[i]!
        rows.push({ kind: 'cold', id: `cold/${script}/${size}`, size, text: buildInput(script, size), width: COLD_WIDTH })
      }
    }
    if (options.scenarios.includes('sweep')) {
      for (let i = 0; i < options.sizes.length; i++) {
        const size = options.sizes[i]!
        rows.push({ kind: 'sweep', id: `sweep/${script}/${size}`, size, text: buildInput(script, size), widths: SWEEP_WIDTHS.slice() })
      }
    }
    if (options.scenarios.includes('many')) {
      rows.push({ kind: 'many', id: `many/${script}`, messages: buildMessages(script, options.messages), width: MESSAGE_WIDTH })
    }
    if (rows.length > 0) contexts.push({ style: STYLES[script], rows, chat: null })
  }
  if (options.scenarios.includes('chat')) {
    contexts.push({ style: CHAT_STYLE, rows: CHAT_SETS.map(set => ({ kind: 'chat', id: `chat/${set}`, set })), chat: buildChatPlan(options.chat) })
  }
  return contexts
}
