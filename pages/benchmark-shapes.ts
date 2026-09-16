import type { PrepareOptions } from '../src/layout.ts'
import { TEXTS } from '../src/test-data.ts'
import enGatsbyOpening from '../corpora/en-gatsby-opening.txt' with { type: 'text' }
import zhGuxiang from '../corpora/zh-guxiang.txt' with { type: 'text' }
import zhZhufu from '../corpora/zh-zhufu.txt' with { type: 'text' }

// Texts for the /benchmark shape rows: batches of many texts over preparation
// paths the short shared corpus rarely reaches.
export type ShapeBenchmarkResult = {
  id: string
  texts: number
  segments: number
  lineCount: number
  canvasCalls: number
  firstMs: number
  prepareMs: number
  warmMs: number
  layoutMs: number
}

export type ShapeCase = {
  id: string
  label: string
  font: string
  options?: PrepareOptions
  texts: readonly string[]
}

const LATIN_FONT = '16px "Helvetica Neue", Helvetica, Arial, sans-serif'
const JAPANESE_FONT = '20px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif'
const CHINESE_FONT = '20px "Songti SC", "PingFang SC", "Noto Serif CJK SC", serif'
// No other section measures this font, so the fresh row's first batch is cold in
// the browser's own width caches too.
const FRESH_FONT = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'
const FRESH_TEXTS = 1000

const CHAT_TEXTS = TEXTS.filter(item => item.text.trim().length > 1).map(item => item.text)

// Text-default symbols with VS16, a keycap and ZWJ sequences.
const EMOJI = [
  '\u2764\uFE0F', '\u2714\uFE0F', '\u26A0\uFE0F', '1\uFE0F\u20E3', '\u{1F3F3}\uFE0F',
  '\u{1F469}\u200D\u{1F4BB}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',
  '\u{1F3F3}\uFE0F\u200D\u{1F308}', '\u{1F9D1}\u{1F3FD}\u200D\u{1F680}', '\u2764\uFE0F\u200D\u{1F525}',
] as const

// ZWSP, WJ, soft hyphens, and bidi marks, embeddings, overrides and isolates.
const TAIL_UNITS = ['\u200B', '\u2060', '\u00AD', '\u200E\u200F\u061C\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069'] as const
const TAIL_LENGTHS = [32, 128, 512] as const

const MARKS = ['\u0301', '\u0300', '\u0308', '\u0327'] as const

const CJK_BRACKET_PIECES: ReadonlyArray<(n: number) => string> = [
  () => '彼は「はい」と言った。',
  n => `（注${n}）`,
  () => '『羅生門』』】〕》）」',
  () => 'ちょっと待ってー！？',
  () => 'ぁぃぅぇぉっゃゅょゎ',
  () => '々〻ゝゞヽヾ〜',
  () => '“好的。”他说：“走吧！”',
  n => `〔${n}〕〉》」』、。`,
]

const SHALOM = '\u05E9\u05DC\u05D5\u05DD'

// Newlines and NEL next to ZWSP; ZWSP, WJ and isolates before a space between
// LTR, RTL and mixed words; a ZWJ after a space; '!' or '?' before a letter,
// digit, bracket or symbol.
const CONTROL_JOINS = [
  '\u200B\n', '\n\u200B', '\u0085', '\u200B\r\n',
  '\u200B ', '\u2060 ', ` ${SHALOM}\u200B ${SHALOM} `, `\u2060 ${SHALOM} `, ' \u2066beta\u2069\u200B ',
  ' \u200D', '!', '?(', '!5', '!\u2192',
] as const

function generate(count: number, build: (index: number) => string): string[] {
  return Array.from({ length: count }, (_, index) => build(index))
}

function paragraphs(corpus: string): string[] {
  return corpus.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

function chatText(index: number): string {
  return CHAT_TEXTS[index % CHAT_TEXTS.length]!
}

function withEmoji(index: number): string {
  const words = chatText(index).split(' ')
  let text = words[0]!
  for (let i = 1; i < words.length; i++) {
    text += ` ${words[i]!}`
    if (i % 4 === 3) text += ` ${EMOJI[(index + i) % EMOJI.length]!}`
  }
  // A reaction run without spaces ends the message.
  return `${text} ${EMOJI[index % EMOJI.length]!}${EMOJI[(index + 3) % EMOJI.length]!}${EMOJI[(index + 7) % EMOJI.length]!}`
}

function withInvisibleTail(index: number): string {
  const unit = TAIL_UNITS[index % TAIL_UNITS.length]!
  const length = TAIL_LENGTHS[index % TAIL_LENGTHS.length]!
  return chatText(index) + unit.repeat(Math.ceil(length / unit.length)).slice(0, length)
}

// A soft hyphen after every third letter of long words, keeping two letters at
// the end, with a combining mark after every other one.
function withSoftHyphens(paragraph: string): string {
  let inserted = 0
  return paragraph.replace(/\p{L}{6,}/gu, word => {
    let result = word[0]!
    for (let i = 1; i < word.length; i++) {
      if (i % 3 === 0 && word.length - i >= 2) {
        result += inserted % 2 === 0 ? '\u00AD' : `\u00AD${MARKS[(inserted >> 1) % MARKS.length]!}`
        inserted++
      }
      result += word[i]!
    }
    return result
  })
}

// NBSP and U+2007 next to dashes, word-initial dashes, and TABs before dashes.
function withDashes(index: number): string {
  const n = 10 + (index * 7) % 90
  return `${chatText(index)} Pages ${n}\u00A0-\u00A0${n + 12}, call 555\u2007-\u2007${1000 + index}, before\u00A0\u2014\u00A0after, ` +
    `flag\u2007-v and\u00A0-w, then \u2010draft, \u2013 item ${n}, \u2014quoted, \u2212${n}°C, -${SHALOM} and col\t-${n}\t\u2013${n % 7}.`
}

function cjkBrackets(index: number): string {
  let text = ''
  for (let i = 0; i < 12; i++) text += CJK_BRACKET_PIECES[(index + i) % CJK_BRACKET_PIECES.length]!((index * 3 + i) % 100)
  return text
}

function withControls(index: number): string {
  const words = chatText(index).split(' ')
  let text = words[0]!
  for (let i = 1; i < words.length; i++) {
    text += (i % 3 === 0 ? CONTROL_JOINS[(index + i) % CONTROL_JOINS.length]! : ' ') + words[i]!
  }
  return text
}

function freshSentences(count: number): string[] {
  const sentences = new Set<string>()
  const pieces = enGatsbyOpening.split(/(?<=[.!?”])\s+/)
  for (let i = 0; i < pieces.length && sentences.size < count; i++) {
    const sentence = pieces[i]!.trim()
    if (sentence.length > 0) sentences.add(sentence)
  }
  return [...sentences]
}

export function buildShapeCases(): ShapeCase[] {
  const chinese = [...paragraphs(zhZhufu), ...paragraphs(zhGuxiang)].map(paragraph => `\u3000\u3000${paragraph}`)
  const brackets = generate(120, cjkBrackets)
  return [
    { id: 'cjk-indent', label: 'Chinese paragraphs opened by two U+3000', font: CHINESE_FONT, texts: chinese },
    { id: 'cjk-indent-spaced', label: 'The same with 2px letter spacing', font: CHINESE_FONT, options: { letterSpacing: 2 }, texts: chinese },
    { id: 'emoji', label: 'Comments with VS16 emoji and ZWJ sequences', font: LATIN_FONT, texts: generate(240, withEmoji) },
    { id: 'invisible-tails', label: 'Comments followed by 32 to 512 ZWSP, WJ, soft hyphens or bidi controls', font: LATIN_FONT, texts: generate(108, withInvisibleTail) },
    { id: 'soft-hyphens', label: 'Prose with soft hyphens, half followed by a mark', font: LATIN_FONT, texts: paragraphs(enGatsbyOpening).slice(0, 120).map(withSoftHyphens) },
    { id: 'dashes', label: 'Glue, TABs and word-initial dashes next to dashes', font: LATIN_FONT, texts: generate(120, withDashes) },
    { id: 'cjk-brackets', label: 'CJK closing brackets and nonstarters', font: JAPANESE_FONT, texts: brackets },
    { id: 'cjk-brackets-keep-all', label: 'The same with keep-all', font: JAPANESE_FONT, options: { wordBreak: 'keep-all' }, texts: brackets },
    { id: 'controls', label: 'Newlines, format characters and joiners next to spaces, and exclamation followers', font: LATIN_FONT, texts: generate(120, withControls) },
    { id: 'fresh-sentences', label: `${FRESH_TEXTS} distinct sentences in a font no other row measures`, font: FRESH_FONT, texts: freshSentences(FRESH_TEXTS) },
  ]
}
