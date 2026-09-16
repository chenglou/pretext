// Text supply for generated families: per-script snippets written for the lab, short excerpts from the
// checked-in corpora, and code point / grapheme boundary helpers.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Rng } from './prng.ts'

export type Script = 'latin' | 'ja' | 'zh-Hans' | 'zh-Hant' | 'ko' | 'ar' | 'he' | 'th' | 'hi' | 'emoji'

export type ScriptInfo = {
  lang: string
  // Named installed macOS fonts covering the script, as CSS family lists.
  fonts: readonly string[]
  direction: 'ltr' | 'rtl'
  // Words are separated by spaces.
  spaced: boolean
  // Mostly fullwidth characters.
  cjk: boolean
  corpora: readonly string[]
  snippets: readonly string[]
}

export const LATIN_FONTS = ['Arial', '"Helvetica Neue"', '"Times New Roman"', 'Georgia', 'Verdana', '"Courier New"', 'Menlo'] as const

// The twelve named fonts of the mixed-fonts family, with the script each covers.
export const MIXED_FONTS: ReadonlyArray<readonly [string, Script]> = [
  ['Arial', 'latin'], ['"Helvetica Neue"', 'latin'], ['"Times New Roman"', 'latin'], ['Georgia', 'latin'],
  ['Verdana', 'latin'], ['"Courier New"', 'latin'], ['Menlo', 'latin'], ['"Hiragino Sans"', 'ja'],
  ['"PingFang SC"', 'zh-Hans'], ['"Apple SD Gothic Neo"', 'ko'], ['"Geeza Pro"', 'ar'], ['Thonburi', 'th'],
]

export const EMOJI_SEQUENCES = [
  '\u{1F469}\u200D\u{1F4BB}', // woman technologist
  '\u{1F468}\u{1F3FD}\u200D\u{1F52C}', // man scientist, medium skin tone
  '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}', // family
  '\u{1F3F3}\uFE0F\u200D\u{1F308}', // rainbow flag
  '\u{1F1EF}\u{1F1F5}', // flag JP
  '\u{1F1EB}\u{1F1F7}', // flag FR
  '1\uFE0F\u20E3', // keycap 1
  '\u2764\uFE0F', // red heart
  '\u{1F44D}\u{1F3FD}', // thumbs up, medium skin tone
  '\u{1F600}', // grinning face
  '\u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}', // people holding hands
] as const

const E = EMOJI_SEQUENCES

export const URL_TEXTS = [
  'https://example.com/reports/q3?lang=ar&mode=full#section-2',
  'foo.bar+tag@example.co.uk',
  '/usr/local/lib/node_modules/@scope/package/dist/index.js',
  'C:\\Program Files\\Example App\\bin\\tool.exe',
  'https://例え.jp/パス/ファイル?名前=値',
  'git@github.com:example/project.git',
  'https://example.com/a/very/long/path/without/any/spaces/at/all/index.html',
] as const

export const NUMBER_TEXTS = [
  '1,234,567.89', '3.14159265358979323846264338327950288', '+81-3-1234-5678', '2026-09-16T05:40:00Z',
  '¥12,800', '$1,000.00', '50%', '0x7fffffffffffffff', 'v2.3.1-rc.4', 'a3f5c9e1b2d4f6a8c0e2d4f6a8b0c2e4',
  'ISBN 978-3-16-148410-0', '(555) 010-9999', '12:30-14:45', '१२३४५६७८९०', '١٢٣٤٥٦٧٨٩٠', '100000000000000000000000',
] as const

export const SCRIPT_INFO: Record<Script, ScriptInfo> = {
  latin: {
    lang: 'en', fonts: LATIN_FONTS, direction: 'ltr', spaced: true, cjk: false, corpora: ['en-gatsby-opening'],
    snippets: [
      'The quick brown fox jumps over the lazy dog.',
      'Typography is the craft of arranging type to make written language legible and appealing.',
      'She said “hello” and then—after a long pause—walked away without a word.',
      'Please update the release notes before Friday, then ping the whole team.',
      'A long line with state-of-the-art tools and well-known edge cases.',
      'Numbers like 3.14159, 1,000,000 and 42% should stay readable at any width.',
      'Office workers efficiently shuffled affluent files in the fjord.',
      'AVATAR WAVE Ty To Yo LT: kerning pairs tighten capital letters.',
      'naïve café résumé coöperate façade jalapeño Zürich',
      'Visit https://example.com/docs/getting-started?lang=en#install today.',
      'It’s a well-known fact: “quotes,” ‘apostrophes’ and em—dashes matter.',
      'Supercalifragilisticexpialidocious pneumonoultramicroscopicsilicovolcanoconiosis',
    ],
  },
  ja: {
    lang: 'ja', fonts: ['"Hiragino Sans"', '"Hiragino Mincho ProN"'], direction: 'ltr', spaced: false, cjk: true,
    corpora: ['ja-rashomon', 'ja-kumo-no-ito'],
    snippets: [
      '或日の暮方の事である。一人の下人が、羅生門の下で雨やみを待つてゐた。',
      '「こんにちは」と彼女は言った。',
      'わかって、ちょっと待ってください。',
      'みそラーメンを食べました！ほんとうに？',
      'コンピューター、インターネット、ソフトウェア。',
      '人々は時々、ゝゞヽヾのような踊り字を使う。',
      '約3ヶ月後に「“quote clusters” も確認してください」と連絡があった。',
      'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ',
      '日本語とEnglishが混在するテキスト〜テスト゠カタカナ',
      '価格は¥12,800です。割引は20％、送料は€5。',
    ],
  },
  'zh-Hans': {
    lang: 'zh-Hans', fonts: ['"PingFang SC"', '"Songti SC"'], direction: 'ltr', spaced: false, cjk: true, corpora: [],
    snippets: [
      '他说“你好”，然后走了。',
      '中文排版需要注意标点符号的位置，例如句号、逗号和引号。',
      '今天天气很好，我们去公园散步吧！',
      '价格是¥12,800元（含税），请在9月16日前付款。',
      '《红楼梦》是中国古典小说的巅峰之作。',
      '这是一个测试：包含冒号、分号；以及省略号……还有破折号——结束。',
      '我们使用Pretext来预测浏览器的换行位置。',
      '请访问https://example.com了解更多信息。',
      '“引号”在行首和行尾的处理方式各不相同。',
    ],
  },
  'zh-Hant': {
    lang: 'zh-Hant', fonts: ['"PingFang TC"', '"Songti SC"'], direction: 'ltr', spaced: false, cjk: true,
    corpora: ['zh-zhufu', 'zh-guxiang'],
    snippets: [
      '舊曆的年底畢竟最像年底，村鎮上不必說。',
      '他是我的本家，比我長一輩，應該稱之曰「四叔」。',
      '「你好嗎？」她問道。',
      '臺灣的繁體中文排版與香港略有不同。',
    ],
  },
  ko: {
    lang: 'ko', fonts: ['"Apple SD Gothic Neo"'], direction: 'ltr', spaced: true, cjk: true,
    corpora: ['ko-sonagi', 'ko-unsu-joh-eun-nal'],
    snippets: [
      '소년은 개울가에서 소녀를 보자 곧 윤 초시네 증손녀딸이라는 걸 알 수 있었다.',
      '다음 배포는 7:00-9:00 사이예요.',
      '했다.”라고 그가 말했다.',
      '한국어 줄바꿈은 보통 어절 단위로 이루어집니다.',
      '“안녕하세요!” 그녀가 웃으며 인사했다.',
      '서울특별시 종로구 세종대로 175 (세종로)',
    ],
  },
  ar: {
    lang: 'ar', fonts: ['"Geeza Pro"'], direction: 'rtl', spaced: true, cjk: false,
    corpora: ['ar-al-bukhala', 'ar-risalat-al-ghufran-part-1'],
    snippets: [
      'هذا جيد، ولكن لا تكسر العبارة «فيقول: وعليك السلام» داخل البطاقة.',
      'مرحبا بالعالم',
      'السلام عليكم ورحمة الله وبركاته',
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'تولاك الله بحفظه وأعانك على شكره ووفقك لطاعته',
    ],
  },
  he: {
    lang: 'he', fonts: ['Arial', '"Times New Roman"'], direction: 'rtl', spaced: true, cjk: false,
    corpora: ['he-masaot-binyamin-metudela'],
    snippets: ['בדיקה אחת נוספת לפני השחרור.', 'שלום עולם', 'זה הספר מחובר מדברים שספר איש אחד', 'שָׁלוֹם עֲלֵיכֶם'],
  },
  th: {
    lang: 'th', fonts: ['Thonburi'], direction: 'ltr', spaced: false, cjk: false,
    corpora: ['th-nithan-vetal-story-1', 'th-nithan-vetal-story-7'],
    snippets: [
      'ภาษาไทยไม่มีการเว้นวรรคระหว่างคำ',
      'สวัสดีครับ ยินดีต้อนรับสู่ประเทศไทย',
      'ความสวยงามของธรรมชาติทำให้ผู้คนมีความสุขมากขึ้นทุกวัน',
      'ทูลว่า "พระองค์พร้อมหรือยัง" แล้วส่งลิงก์ใหม่ทันที',
      'น้ำใจไมตรี',
    ],
  },
  hi: {
    lang: 'hi', fonts: ['"Kohinoor Devanagari"'], direction: 'ltr', spaced: true, cjk: false, corpora: ['hi-eidgah'],
    snippets: ['रमजान के पूरे तीस रोजों के बाद आज ईद आयी है।', 'कृपया बताओ! यह २४×७ सपोर्ट है।', 'क्षत्रिय हिन्दी भाषा'],
  },
  emoji: {
    lang: 'en', fonts: ['Arial', '"Helvetica Neue"'], direction: 'ltr', spaced: true, cjk: false, corpora: [],
    snippets: [
      `Status ${E[0]} working, ${E[1]} testing, ${E[2]} family time`,
      `Flags ${E[4]}${E[5]} and keycaps ${E[6]} with hearts ${E[7]}${E[7]}`,
      `${E[8]}${E[9]}${E[10]}${E[3]}${E[0]}${E[1]}`,
      `ok${E[9]}ok ${E[8]} done ${E[3]} merged`,
    ],
  },
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

export function graphemes(value: string): string[] {
  const out: string[] = []
  for (const part of segmenter.segment(value)) out.push(part.segment)
  return out
}

// UTF-16 offsets strictly inside `value` at code point boundaries (never inside a surrogate pair).
export function codePointBoundaries(value: string): number[] {
  const out: number[] = []
  let offset = 0
  for (const char of value) {
    if (offset > 0) out.push(offset)
    offset += char.length
  }
  return out
}

// UTF-16 offsets strictly inside `value` at grapheme cluster boundaries.
export function graphemeBoundaries(value: string): number[] {
  const out: number[] = []
  for (const part of segmenter.segment(value)) if (part.index > 0) out.push(part.index)
  return out
}

// Offsets strictly inside `value` just before or just after a SPACE.
export function spaceBoundaries(value: string): number[] {
  const out = new Set<number>()
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== ' ') continue
    if (i > 0) out.add(i)
    if (i + 1 < value.length) out.add(i + 1)
  }
  return [...out].sort((a, b) => a - b)
}

const corpusCache = new Map<string, string[]>()
const CORPORA_DIR = resolve(import.meta.dir, '../../../corpora')

export function corpusLines(id: string): string[] {
  let lines = corpusCache.get(id)
  if (lines === undefined) {
    lines = readFileSync(resolve(CORPORA_DIR, `${id}.txt`), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 12)
    if (lines.length === 0) throw new Error(`Corpus ${id} has no usable lines`)
    corpusCache.set(id, lines)
  }
  return lines
}

// A contiguous excerpt of about [min, max] graphemes. Spaced scripts cut at spaces.
export function excerpt(rng: Rng, source: string, min: number, max: number, spaced: boolean): string {
  const trimmed = source.trim()
  const units = graphemes(trimmed)
  if (units.length <= max) return trimmed
  const target = min + rng.int(Math.max(1, max - min + 1))
  if (!spaced) {
    const start = rng.int(units.length - target + 1)
    const out = units.slice(start, start + target).join('').trim()
    return out === '' ? trimmed.slice(0, 1) : out
  }
  const words = trimmed.split(/ +/)
  let best = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const start = rng.int(words.length)
    let out = words[start]!
    let length = graphemes(out).length
    for (let i = start + 1; i < words.length; i++) {
      const next = graphemes(words[i]!).length + 1
      if (length + next > target) break
      out += ` ${words[i]!}`
      length += next
    }
    best = out
    if (length >= min) break
  }
  return best
}

// A phrase in `script`: half from the script's corpora (when it has any), half from the snippets.
export function phrase(rng: Rng, script: Script, min: number, max: number): string {
  const info = SCRIPT_INFO[script]
  const source = info.corpora.length > 0 && rng.chance(0.5) ? rng.pick(corpusLines(rng.pick(info.corpora))) : rng.pick(info.snippets)
  return excerpt(rng, source, min, max, info.spaced)
}

export function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i < to; i++) out.push(i)
  return out
}
