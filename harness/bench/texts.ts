// The bench's texts. Chat-like messages are read in order from each family's own part of the corpora, so no message,
// and no stretch of text, is prepared twice by the rows that want new text:
//   latin   The Great Gatsby's opening.
//   cjk     祝福, 故鄉, 羅生門 and 蜘蛛の糸 joined (all the CJK prose the repo has, about 23,700 units).
//   arabic  البخلاء.
//   thai    both Thai stories.
//   mixed   paragraphs in turn from رسالة الغفران, the Korean, Hebrew and Hindi stories and mixed-app-text; a fifth of the
//           messages end with an emoji. One font list for every message, as a chat sets one font on its bubbles.
//   labels  Chromium's translated UI strings in 35 languages (harness/sets/data/ui-strings.json), one label a call.
// Messages take the rebuild's chat lengths: a quarter 5-19 units, half 20-100, a quarter 101-400. The worst-case shapes
// come from the old benchmark page: its shape rows, its pre-wrap chunks, its long breakable runs and a book-length
// Arabic paragraph.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PrepareOptions } from '../../src/layout.ts'
import type { RichInlineItem } from '../../src/rich-inline.ts'
import { TEXTS } from '../../src/test-data.ts'
import { createRng } from '../sets/build.ts'

const CORPORA = join(import.meta.dir, '../../corpora')
const corpus = (id: string): string => readFileSync(join(CORPORA, `${id}.txt`), 'utf8').trim()
const paragraphs = (text: string): string[] => text.split(/\n+/).map(p => p.trim()).filter(p => p !== '')

export type Family = 'latin' | 'cjk' | 'arabic' | 'thai' | 'mixed' | 'labels'
export const MESSAGE_FAMILIES = ['latin', 'cjk', 'arabic', 'thai', 'mixed'] as const
export const STYLE: Record<Family, { font: string; lang: string }> = {
  latin: { font: '16px "Helvetica Neue"', lang: 'en' },
  cjk: { font: '16px "PingFang TC"', lang: 'zh-Hant' },
  arabic: { font: '16px "Geeza Pro"', lang: 'ar' },
  thai: { font: '16px Thonburi', lang: 'th' },
  mixed: { font: '16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', lang: 'en' },
  labels: { font: '13px system-ui, "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', lang: 'en' },
}

const texts = new Map<Family, string>()
export function familyText(family: Exclude<Family, 'labels'>): string {
  let text = texts.get(family)
  if (text !== undefined) return text
  if (family === 'latin') text = corpus('en-gatsby-opening')
  else if (family === 'cjk') text = ['zh-zhufu', 'zh-guxiang', 'ja-rashomon', 'ja-kumo-no-ito'].map(corpus).join('\n\n')
  else if (family === 'arabic') text = corpus('ar-al-bukhala')
  else if (family === 'thai') text = `${corpus('th-nithan-vetal-story-1')}\n\n${corpus('th-nithan-vetal-story-7')}`
  else {
    const pools = ['ar-risalat-al-ghufran-part-1', 'ko-sonagi', 'ko-unsu-joh-eun-nal', 'he-masaot-binyamin-metudela', 'hi-eidgah', 'mixed-app-text'].map(id => paragraphs(corpus(id)))
    const parts: string[] = []
    const longest = Math.max(...pools.map(pool => pool.length))
    for (let round = 0; round < longest; round++) for (let p = 0; p < pools.length; p++) if (round < pools[p]!.length) parts.push(pools[p]![round]!)
    text = parts.join('\n\n')
  }
  texts.set(family, text)
  return text
}

const BOUNDARY = /[\s。，、！？；」』]/u
const EMOJI = ['👍', '🎉', '👩‍💻', '❤️', '😂']

export function units(list: readonly string[]): number {
  let n = 0
  for (let i = 0; i < list.length; i++) n += list[i]!.length
  return n
}

// Reads a family's text forward in chat-length messages; nothing is read twice. `batch(n)` returns messages holding
// exactly n UTF-16 units (one more where the cut would split a surrogate pair): the last message is cut, and its rest
// starts the next batch. Throws when the text runs out.
export function reader(family: Exclude<Family, 'labels'>, from = 0): { batch: (n: number) => string[]; at: () => number } {
  const text = familyText(family)
  const rng = createRng(`bench-${family}-${from}`)
  let at = from
  let carry: string | null = null
  const next = (): string => {
    const r = rng.next()
    const [min, max] = r < 0.25 ? [5, 19] : r < 0.75 ? [20, 100] : [101, 400]
    while (at > 0 && at < text.length && !BOUNDARY.test(text[at - 1]!)) at++
    while (at < text.length && /\s/u.test(text[at]!)) at++
    if (at + max >= text.length) throw new Error(`${family}: the text ran out at ${at}`)
    let end = at + max
    while (end > at + min && !BOUNDARY.test(text[end - 1]!)) end--
    if ((text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end++
    const message = text.slice(at, end).trim()
    at = end
    return family === 'mixed' && rng.chance(0.2) ? `${message} ${rng.pick(EMOJI)}` : message
  }
  return {
    at: () => at,
    batch(n) {
      const out: string[] = []
      for (let total = 0; total < n;) {
        let m = carry ?? next()
        carry = null
        if (m === '') continue
        if (total + m.length > n) {
          let cut = n - total
          if ((m.charCodeAt(cut - 1) & 0xfc00) === 0xd800) cut++
          carry = m.slice(cut).trimStart() || null
          m = m.slice(0, cut)
        }
        out.push(m)
        total += m.length
      }
      return out
    },
  }
}

// Every label in order, each language's in turn.
export function labels(): string[] {
  const { strings } = JSON.parse(readFileSync(join(import.meta.dir, '../sets/data/ui-strings.json'), 'utf8')) as { strings: Record<string, string[]> }
  const lists = Object.values(strings)
  const out: string[] = []
  for (let i = 0; i < Math.max(...lists.map(list => list.length)); i++) for (let l = 0; l < lists.length; l++) if (i < lists[l]!.length) out.push(lists[l]![i]!)
  return out
}

// The old benchmark page's rich-inline stress items: a message's words, every ninth an unbreakable code pill, the next
// ones a chip and an italic word.
const CODE = '600 12px "SF Mono", ui-monospace, Menlo, Monaco, monospace'
const CHIP = '700 11px "Helvetica Neue", Helvetica, Arial, sans-serif'
export function richItems(text: string, font: string): RichInlineItem[] {
  const items: RichInlineItem[] = []
  const tokens = text.match(/\S+|\s+/g) ?? [text]
  for (let i = 0, styled = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (/^\s+$/.test(token)) {
      items.push({ text: token, font })
      continue
    }
    const style = styled++ % 9
    if (style === 2 && token.length <= 18) items.push({ text: token, font: CODE, break: 'never', extraWidth: 12 })
    else if (style === 5 && token.length <= 12) items.push({ text: token, font: CHIP, break: 'never', extraWidth: 14 })
    else items.push({ text: token, font: style === 7 ? `italic ${font}` : font })
  }
  return items
}

// ---- Worst-case shapes ----

export type Shape = { id: string; font: string; lang: string; options: PrepareOptions; texts: string[]; ops: string[] }
const LATIN = '16px "Helvetica Neue", Helvetica, Arial, sans-serif'
const CHINESE = '20px "Songti SC", "PingFang SC", serif'
const JAPANESE = '20px "Hiragino Mincho ProN", serif'
const CHAT = TEXTS.filter(item => item.text.trim().length > 1).map(item => item.text)
const chat = (i: number): string => CHAT[i % CHAT.length]!
const generate = (count: number, build: (i: number) => string): string[] => Array.from({ length: count }, (_, i) => build(i))
const EMOJI_SEQUENCES = ['❤️', '✔️', '1️⃣', '\u{1F469}‍\u{1F4BB}', '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}', '\u{1F3F3}️‍\u{1F308}', '\u{1F9D1}\u{1F3FD}‍\u{1F680}']
const TAILS = ['​', '⁠', '­', '‎‏؜‪‫‬‭‮⁦⁧⁨⁩']
const MARKS = ['́', '̀', '̈', '̧']
const SHALOM = 'שלום'
const CONTROL_JOINS = ['​\n', '\n​', '\u0085', '​\r\n', '​ ', '⁠ ', ` ${SHALOM}​ ${SHALOM} `, `⁠ ${SHALOM} `, ' ⁦beta⁩​ ', ' ‍', '!', '?(', '!5', '!→']
const BRACKETS: ReadonlyArray<(n: number) => string> = [
  () => '彼は「はい」と言った。', n => `（注${n}）`, () => '『羅生門』』】〕》）」', () => 'ちょっと待ってー！？', () => 'ぁぃぅぇぉっゃゅょゎ',
  () => '々〻ゝゞヽヾ〜', () => '“好的。”他说：“走吧！”', n => `〔${n}〕〉》」』、。`,
]

function joinWords(index: number, joint: (i: number) => string): string {
  const words = chat(index).split(' ')
  let text = words[0]!
  for (let i = 1; i < words.length; i++) text += joint(i) + words[i]!
  return text
}

export function shapes(): Shape[] {
  const chinese = [...paragraphs(corpus('zh-zhufu')), ...paragraphs(corpus('zh-guxiang'))].map(p => `　　${p}`)
  const brackets = generate(120, i => BRACKETS.map((_, k) => BRACKETS[(i + k) % BRACKETS.length]!((i * 3 + k) % 100)).join(''))
  let marks = 0
  const softHyphens = paragraphs(corpus('en-gatsby-opening')).slice(0, 120).map(p => p.replace(/\p{L}{6,}/gu, word => {
    let out = word[0]!
    for (let i = 1; i < word.length; i++) {
      if (i % 3 === 0 && word.length - i >= 2) out += marks++ % 2 === 0 ? '­' : `­${MARKS[(marks >> 1) % MARKS.length]!}`
      out += word[i]!
    }
    return out
  }))
  const preWrap = generate(12, seed => generate(320, i => {
    const n = seed * 320 + i
    return [`section ${n}\talpha ${n % 11}`, '  ', `entry ${n}  `, '', `col\t${n % 97}\t${(n * 3) % 101}`, `note ${n} x`][i % 6]!
  }).join('\n'))
  const runs = generate(220, i => [
    `https://bench.example.com/releases/2026/04/${i}/artifact-alpha-beta-gamma-delta-epsilon-${i.toString(36)}?build=${1200 + i}&cursor=sha${(0xabcde + i).toString(16)}&channel=stable`,
    `cacheKey_v${i}_AlphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXiOmicronPiRhoSigmaTauUpsilonPhiChiPsiOmega`,
    `metrics pipeline phase ${i % 17} snapshot ${(i * 13) % 97}`,
    `window:${String(i % 24).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}-${String((i + 5) % 24).padStart(2, '0')}:${String((i * 11) % 60).padStart(2, '0')}`,
    `module::worker::queue::flush::retry::recover::ship::${i}`,
  ].join(' ')).join(' ')
  const both = ['prepare', 'layout']
  return [
    { id: 'cjk-letter-spaced', font: CHINESE, lang: 'zh', options: { letterSpacing: 2 }, texts: chinese, ops: both },
    { id: 'soft-hyphens-marks', font: LATIN, lang: 'en', options: {}, texts: softHyphens, ops: both },
    { id: 'controls', font: LATIN, lang: 'en', options: {}, texts: generate(120, i => joinWords(i, k => (k % 3 === 0 ? CONTROL_JOINS[(i + k) % CONTROL_JOINS.length]! : ' '))), ops: both },
    { id: 'invisible-tails', font: LATIN, lang: 'en', options: {}, texts: generate(108, i => chat(i) + TAILS[i % 4]!.repeat(Math.ceil([32, 128, 512][i % 3]! / TAILS[i % 4]!.length)).slice(0, [32, 128, 512][i % 3])), ops: both },
    { id: 'pre-wrap-chunks', font: LATIN, lang: 'en', options: { whiteSpace: 'pre-wrap' }, texts: preWrap, ops: ['prepare', 'layout', 'walk'] },
    { id: 'cjk-brackets-keep-all', font: JAPANESE, lang: 'ja', options: { wordBreak: 'keep-all' }, texts: brackets, ops: both },
    { id: 'emoji', font: LATIN, lang: 'en', options: {}, texts: generate(240, i => `${joinWords(i, k => (k % 4 === 3 ? ` ${EMOJI_SEQUENCES[(i + k) % 7]!} ` : ' '))} ${EMOJI_SEQUENCES[i % 7]!}${EMOJI_SEQUENCES[(i + 3) % 7]!}`), ops: ['prepare'] },
    { id: 'long-breakable-runs', font: LATIN, lang: 'en', options: {}, texts: [runs], ops: both },
    { id: 'arabic-book', font: '20px "Geeza Pro", "Noto Naskh Arabic", serif', lang: 'ar', options: {}, texts: [corpus('ar-risalat-al-ghufran-part-1').replace(/\s+/g, ' ')], ops: both },
  ]
}
