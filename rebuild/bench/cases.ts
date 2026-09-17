// The bench inputs: per script, one text in each size class and a set of chat-like messages, built deterministically from
// the checked-in corpora. Every input is one paragraph both libraries can express: one run in one font, white-space
// normal, word-break normal, overflow-wrap break-word (main's only wrapping mode), line-break auto, no letter or word
// spacing. The rebuild also takes the paragraph's direction, which main has no input for and doesn't need for breaks.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRng } from '../lab/cases/prng.ts'
import type { RowSpec, Scenario, Script, ScriptStyle, SizeClass } from './protocol.ts'

export const SCRIPTS: readonly Script[] = ['latin', 'cjk', 'arabic', 'mixed']
export const SIZES: readonly SizeClass[] = ['tiny', 'sentence', 'paragraph', 'long', 'corpus']
export const SCENARIOS: readonly Scenario[] = ['cold', 'sweep', 'many']

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

function style(script: Script, lang: string, family: string, direction: ScriptStyle['direction']): ScriptStyle {
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

export type ContextSpec = { style: ScriptStyle; rows: RowSpec[] }

export function buildContexts(options: { scripts: readonly Script[]; sizes: readonly SizeClass[]; scenarios: readonly Scenario[]; messages: number }): ContextSpec[] {
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
    if (rows.length > 0) contexts.push({ style: STYLES[script], rows })
  }
  return contexts
}
