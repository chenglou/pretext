// An attack on Gecko's word scan (src/engines/gecko/lines.ts wordScan): seeded random paragraphs on a constructed Canvas
// that shapes like a font and has no negative advance, laid out plain by the tree's library and by its edited copies
// (tools/word-scan-variants.ts): `loop`, the engine's loop alone, and `proven`, the word scan without its premise; and
// inspected by the tree's library, which holds each scan the word scan decides against the loop and reports
// negative-word-tail where they differ (gaps.ts negativeWordTail). It goes where the recorded sets don't:
// - a font with wide pair adjustments in both signs, optional ligatures of two to four letters that are much narrower
//   than their parts, a required ligature, Arabic joining forms of their own widths through U+200D, marks and ignorable
//   characters without an advance, and an ink box that tells a ligature as wide as its parts. Every glyph keeps a
//   positive advance after its pairs' adjustments, so no suffix of a shaped word has a negative advance: the word scan's
//   premise holds for this font as the engine would shape it.
// - text with U+00A0 and U+0020 before join controls and marks, U+3000, soft hyphens, tabs, segment breaks, U+200B, U+2060,
//   U+2009, words of more than 32 characters, hyphens, URLs, Arabic with marks and tatweel, Hebrew, Han, kana, Thai, emoji
//   sequences; words split over spans with other fonts, spacing and box edges; atomic inlines, <br>, <wbr>;
// - every white-space, overflow-wrap, word-break and line-break value, letter and word spacing in both signs and wide,
//   text-indent, both directions, justification;
// - widths from 1 au up, and the widths where the first line's break moves, found by bisection with the loop, each with
//   the au before and after it (Gecko compares integer app units, 1/60 px).
// A layout counts as differing where a line's range or its pieces differ from the loop's. The inspected layout must give
// the plain one's lines and pieces, and must report negative-word-tail on every layout that differs: one that differs
// without it is a disagreement the inspected path can't see.
//
// `--no-spaced-nbsp` leaves out the words with U+00A0 before a join control, the first shape this tool found (negative
// word spacing on a no-break space inside a word, word-scan-spacing.test.ts), so that a run says whether anything else
// differs. `--focus` draws what the word scan's premise decides more often: no letter spacing, no break-spaces, wider
// lines. `--all-lines` looks for the widths where any line's break moves, not the first line's alone. `--break-premise`
// makes the font break the premise: `e` takes back a quarter of an em, so a word ending in it is narrower than its
// prefix. Layouts may then differ from the loop's, and each must carry the gap.
//
//   bun rebuild/tools/word-scan-attack.ts [--seed=1] [--count=20000] [--no-spaced-nbsp] [--focus] [--all-lines] [--break-premise]
//     [--dictionary] [--scripts] [--out=<report.json>]
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PINNED_BUILDS, type GeckoEnvironment } from '../src/env.ts'
import * as treeEngine from '../src/engines/gecko/index.ts'
import { joiningType } from '../src/engines/gecko/props.ts'
import { createContextPool } from '../src/measure/canvas.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type LineBreak, type OverflowWrap, type Paragraph, type TextStyle, type WhiteSpace, type WordBreak } from '../src/model.ts'
import { wordScanVariant, type WordScanTally } from './word-scan-variants.ts'

type Engine = typeof treeEngine
const engineOf = async (variant: 'loop' | 'proven' | 'counted'): Promise<Engine> => await import(join(wordScanVariant(variant), 'engines/gecko/index.ts')) as Engine
const ENGINES = { loop: await engineOf('loop'), proven: await engineOf('proven'), tree: treeEngine, counted: await engineOf('counted') }
const tally = ((globalThis as { wordScanTally?: WordScanTally }).wordScanTally ??= { decided: 0, left: 0, passed: 0 })

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2] ?? '')
}
const seed = Number(options.get('seed') ?? 1)
const count = Number(options.get('count') ?? 20000)
const spacedNbsp = !options.has('no-spaced-nbsp')
const focus = options.has('focus')
const allLines = options.has('all-lines')
const breakPremise = options.has('break-premise')
// `--dictionary` gives the environment Intl.Segmenter's word dictionary for Thai, Lao, Khmer and Myanmar, so runs of those
// scripts hold natural breaks inside one shaping unit; `--scripts` draws such runs from main's corpora and words of other
// scripts the lists above leave out (Indic, Tibetan, Mongolian, emoji sequences, Han and kana beside Latin).
const dictionary = options.has('dictionary')
const scripts = options.has('scripts')

// ---- A seeded stream ----

let state = (seed * 2654435761) >>> 0
function random(): number {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (n: number): number => Math.floor(random() * n)
const pick = <T>(list: readonly T[]): T => list[int(list.length)]!
const chance = (p: number): boolean => random() < p

// ---- The constructed Canvas ----

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

const MARK = /^\p{M}$/u
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u
const WIDE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u
const NARROW = 'il.,\'|:;!'
// Optional ligatures, longest first; the four-letter one is a quarter of its parts, as 14px "Courier New" draws rial.
const LIGATURES = ['wxyz', 'ffi', 'ffl', 'fi', 'fl', 'ff', 'st', 'ct', 'th', 'Th', 'ee', 'oo']
const LAM = 0x644
const ALEF = 0x627

type Glyph = { advance: number; ink: number }

// The glyphs of a string at `size` px in font `face`, in au: one per character, a ligature's on its first character and
// nothing on its others. Every advance is an integer, and stays positive after its pairs' adjustments.
function shape(text: string, size: number, face: number, ligatures: boolean): Glyph[] {
  const cps: number[] = []
  for (const ch of text) cps.push(ch.codePointAt(0)!)
  const unit = size * 60
  const glyphs: Glyph[] = []
  const base = (cp: number): number => {
    const ch = String.fromCodePoint(cp)
    if (cp === 0x200d || cp === 0x200c || MARK.test(ch) || IGNORABLE.test(ch) || cp < 0x20) return 0
    if (cp === 0x20 || cp === 0xa0) return Math.round(unit * 0.25)
    if (WIDE.test(ch) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || cp > 0xffff) return Math.round(unit)
    if (NARROW.includes(ch)) return Math.round(unit * 0.2)
    return Math.round(unit * (0.35 + (mix(face, cp) % 40) / 64))
  }
  // Whether the letter at i joins the letter before it, and the one after it: marks and join controls are transparent,
  // and U+200D joins as a letter would.
  const joins = (i: number, step: -1 | 1): boolean => {
    const own = joiningType(cps[i]!)
    if (step === -1 ? own !== 'D' && own !== 'R' : own !== 'D' && own !== 'L') return false
    for (let k = i + step; k >= 0 && k < cps.length; k += step) {
      const other = cps[k]!
      if (other === 0x200d) return true
      if (other === 0x200c) return false
      const t = joiningType(other)
      if (t === 'T') continue
      return step === -1 ? t === 'D' || t === 'L' || t === 'C' : t === 'D' || t === 'R' || t === 'C'
    }
    return false
  }
  for (let i = 0; i < cps.length; i++) {
    let advance = base(cps[i]!)
    const type = joiningType(cps[i]!)
    if (advance > 0 && (type === 'D' || type === 'R' || type === 'L')) {
      const form = (joins(i, -1) ? 1 : 0) + (joins(i, 1) ? 2 : 0)
      advance = Math.round(advance * (0.6 + (mix(face + form, cps[i]!) % 45) / 64))
    }
    glyphs.push({ advance, ink: mix(face, cps[i]!) % 7 })
  }
  // Ligatures: the required lam-alef always, the optional ones where letter spacing leaves them on.
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] === LAM && cps[i + 1] === ALEF) {
      glyphs[i] = { advance: Math.round((glyphs[i]!.advance + glyphs[i + 1]!.advance) * 0.7), ink: 8 }
      glyphs[i + 1] = { advance: 0, ink: 0 }
      i++
      continue
    }
    if (!ligatures) continue
    for (let l = 0; l < LIGATURES.length; l++) {
      const lig = LIGATURES[l]!
      let match = i + lig.length <= cps.length
      for (let k = 0; match && k < lig.length; k++) match = cps[i + k] === lig.charCodeAt(k)
      if (!match) continue
      let parts = 0
      for (let k = 0; k < lig.length; k++) parts += glyphs[i + k]!.advance
      // `st` is as wide as its parts and shows in its ink alone; `wxyz` is a quarter; the others between.
      const factor = lig === 'st' ? 1 : lig === 'wxyz' ? 0.25 : 0.45 + (mix(face, l) % 40) / 64
      glyphs[i] = { advance: Math.round(parts * factor), ink: 9 + l }
      for (let k = 1; k < lig.length; k++) glyphs[i + k] = { advance: 0, ink: 0 }
      i += lig.length - 1
      break
    }
  }
  // Pair adjustments between neighbouring glyphs with an advance, all of it on the first glyph, up to 0.45 of the
  // narrower of the two in either sign.
  let previous = -1
  for (let i = 0; i < cps.length; i++) {
    if (glyphs[i]!.advance <= 0) continue
    if (previous >= 0 && cps[i] !== 0x20 && cps[i] !== 0xa0 && cps[previous] !== 0x20 && cps[previous] !== 0xa0) {
      const h = mix(mix(face, cps[previous]!), cps[i]!)
      if (h % 3 === 0) {
        const reach = Math.floor(Math.min(glyphs[previous]!.advance, glyphs[i]!.advance) * 0.45)
        glyphs[previous]!.advance += ((h >>> 8) % (2 * reach + 1)) - reach
      }
    }
    previous = i
  }
  if (breakPremise) for (let i = 0; i < cps.length; i++) if (cps[i] === 0x65 && glyphs[i]!.advance > 0) glyphs[i]!.advance = -Math.round(unit * 0.25)
  return glyphs
}

let asked = 0
function installCanvas(): void {
  class Ctx {
    font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
    measureText(text: string) {
      asked++
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)![1])
      const face = mix(7, this.font.replace(/(\d+(?:\.\d+)?)px/, '').length + this.font.charCodeAt(this.font.length - 1))
      const spacing = Math.round(Number.parseFloat(this.letterSpacing) * 60)
      const glyphs = shape(text, size, face, this.letterSpacing === '0px')
      let total = 0
      let last = 0
      for (let i = 0; i < glyphs.length; i++) {
        if (glyphs[i]!.advance < 0 && !breakPremise) throw new Error('a negative advance')
        if (glyphs[i]!.advance === 0) continue
        total += glyphs[i]!.advance + spacing
        last = glyphs[i]!.ink
      }
      return { width: total / 60, actualBoundingBoxLeft: 0, actualBoundingBoxRight: (total - last) / 60 }
    }
  }
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }
}

// ---- Paragraphs ----

const c = (...codes: number[]): string => String.fromCodePoint(...codes)
const NBSP = c(0xa0)
const SHY = c(0xad)
const ZWJ = c(0x200d)
const ZWNJ = c(0x200c)
const ACUTE = c(0x301)
const LATIN = ['alpha', 'AVATAR', 'To', 'waffle', 'first', 'office', 'wxyz', 'awxyzb', 'stst', 'i', 'l.', 'a', 'I', 'x-y', 'co-op', 'well-known-word', 'http://example.com/a/b?c=d&e=f',
  '3.14', 'Hello,', 'world!', '(paren)', `dash${c(0x2014)}dash`, `be${SHY}ta`, `gam${SHY}ma${SHY}delta`, `end${SHY}`, 'supercalifragilisticexpialidociousness', `e${ACUTE}te${ACUTE}`, `a${ACUTE}${c(0x302, 0x303)}`,
  `no${NBSP}break`, `aaaa${NBSP}${ZWJ}bb`, `aa${NBSP}${ZWNJ}b`, `a${NBSP}${ACUTE}b`, `aa ${ZWJ}bb`, `aa ${ACUTE}bb`, `zero${c(0x200b)}width`, `word${c(0x2060)}joiner`, `thin${c(0x2009)}space`, `full${c(0x3000)}width`, c(0x3000), 'T.', 'V,', 'r,', 'P.', "A'", 'fi', 'ffl', 'il.,il.,il.,']
const ARABIC = ['مرحبا', 'بالعالم', 'اللغة', 'العربية', 'ريال', 'سلام', 'لا', 'الإسلام', `م${c(0x64e)}ر${c(0x652)}ح${c(0x64e)}ب${c(0x64b)}ا`, `ك${c(0x640, 0x640, 0x640)}تاب`, `كل${ZWJ}`, `${ZWJ}مة`, `كل${ZWNJ}مة`, `ال${NBSP}${ZWJ}له`]
const HEBREW = ['שלום', 'עולם', `ע${c(0x5b4)}ב${c(0x5b0)}ר${c(0x5b4)}ית`]
const CJK = ['日本語のテキスト', '中文文本。', '한국어', '「引用」', `全角${c(0x3000)}空白`]
const OTHER = ['ภาษาไทย', c(0x1f44d, 0x1f3fd), c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), c(0x1f1fa, 0x1f1f8, 0x1f1ec, 0x1f1e7), 'नमस्ते', `x${c(0x1f600)}y`, `${c(0x2061)}${ACUTE}a`]
// Long runs without U+0020 from main's corpora (corpora/*.txt), and words of other scripts, for --scripts.
const SA_RUNS = [
  'เช้าวันหนึ่ง', 'พระวัชรมุกุฏ', 'พากันขี่ม้าออกเที่ยวล่าเนื้อในป่า', 'พุทธิศริระเป็นบุตรของประธาน', 'ชายหนุ่มทั้งสองขี่ม้าไปในป่า', 'พบสระใหญ่สระหนึ่งมีกำแพงล้อมรอบ', 'ภาษาไทย', 'น้ำ', 'กำ', 'ที่',
  'ສະບາຍດີ', 'ພາສາລາວເປັນພາສາທາງການຂອງປະເທດລາວ', 'ຂ້ອຍຮັກເຈົ້າຫຼາຍໆ',
  `${c(0x200b)}ត្មាត${c(0x200b)}បោក${c(0x200b)}ដំរី${c(0x200b)}ស`, `កាល${c(0x200b)}ពី${c(0x200b)}ព្រេង${c(0x200b)}នាយ`, `មាន${c(0x200b)}ពួក${c(0x200b)}ពល${c(0x200b)}បរិវារ${c(0x200b)}ជា${c(0x200b)}ច្រើន${c(0x200b)}អាស្រ័យ${c(0x200b)}នៅ${c(0x200b)}ក្នុង${c(0x200b)}ព្រៃ${c(0x200b)}ភ្នំ`, 'ស្ដេចត្មាតមួយ',
  'ရှေးအခါက', 'တောအရပ်တစ်နေရာတွင်', 'ရေအိုင်တစ်အိုင်ရှိသည်။', 'ငါးမျိုးစုံတို့', 'မှီခိုနေထိုင်ရာ', `${c(0x1004, 0x103a, 0x1038)}`,
]
const OTHER_SCRIPTS = [
  'रमजान', 'मनोहर,', 'वृक्षों', 'हरियाली', 'क्षत्रिय', 'श्रीमान्', 'বাংলা', 'ভাষা', 'தமிழ்', 'மொழி', 'සිංහල', 'ಕನ್ನಡ', 'ગુજરાતી', 'ਪੰਜਾਬੀ',
  'བོད་ཡིག་ནི་བོད་པའི་ཡི་གེ་ཡིན།', 'ང་བོད་པ་ཡིན།', 'བཀྲ་ཤིས་བདེ་ལེགས།',
  'ᠮᠣᠩᠭᠣᠯ', `ᠮᠣᠩᠭᠣᠯ${c(0x202f)}ᠤᠨ`, `ᠬᠠᠷᠠ${c(0x180e)}ᠠ`, `ᠭ${c(0x180b)}ᠠ`, 'ᠪᠢᠴᠢᠭ',
  c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466), c(0x1f3f3, 0xfe0f, 0x200d, 0x1f308), c(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb), c(0x31, 0xfe0f, 0x20e3), `a${c(0x1f44d, 0x1f3fd)}b`,
  `${c(0x1f600)}${c(0x1f600)}${c(0x1f600)}`, `ok${c(0x1f44c)}`,
  'iPhone用户', '使用Chrome浏览器', '東京2020オリンピック', '第3回', 'Unicode標準', '日本語English混在', '한국어Korean', 'Wi-Fi接続', '「OK」', 'ＡＢＣ全角', 'ｶﾀｶﾅ',
]
const SPACES = [' ', ' ', ' ', ' ', '  ', '   ', c(9), c(10), ` ${c(10)} `, NBSP, `${NBSP} `, ` ${NBSP}`, '', c(0x3000), ` ${SHY}`, `${SHY} `]

const FAMILIES = ['Optima', 'Arial', 'Georgia', 'Menlo']
const WHITE_SPACE: readonly WhiteSpace[] = ['normal', 'normal', 'normal', 'normal', 'pre-wrap', 'pre-line', 'nowrap', 'pre', 'break-spaces']
const WORD_BREAK: readonly WordBreak[] = ['normal', 'normal', 'normal', 'break-all', 'keep-all', 'break-word']
const OVERFLOW_WRAP: readonly OverflowWrap[] = ['normal', 'break-word', 'break-word', 'anywhere']
const LINE_BREAK: readonly LineBreak[] = ['auto', 'auto', 'auto', 'loose', 'normal', 'strict', 'anywhere']

const joinedNbsp = (word: string): boolean => word.includes(`${NBSP}${ZWJ}`) || word.includes(`${NBSP}${ZWNJ}`)
const LATIN_DRAWN = spacedNbsp ? LATIN : LATIN.filter(word => !joinedNbsp(word))
const ARABIC_DRAWN = spacedNbsp ? ARABIC : ARABIC.filter(word => !joinedNbsp(word))

function words(): string {
  const roll = int(10)
  const pool = scripts && chance(0.5) ? (chance(0.6) ? SA_RUNS : OTHER_SCRIPTS) : roll < 6 ? LATIN_DRAWN : roll < 8 ? ARABIC_DRAWN : roll < 9 ? (chance(0.5) ? HEBREW : CJK) : OTHER
  const length = 1 + int(8)
  let text = chance(0.1) ? pick(SPACES) : ''
  for (let i = 0; i < length; i++) {
    if (i > 0) text += pick(SPACES)
    text += chance(0.85) ? pick(pool) : pick(LATIN_DRAWN)
  }
  if (chance(0.2)) text += pick(SPACES)
  // A drawn U+00A0 can meet a word that starts with a join control.
  return spacedNbsp ? text : text.replaceAll(`${NBSP}${ZWJ}`, `${NBSP}x${ZWJ}`).replaceAll(`${NBSP}${ZWNJ}`, `${NBSP}x${ZWNJ}`)
}

function fontDecl(): FontDecl {
  return { family: pick(FAMILIES), size: pick([10, 14, 16, 16, 16, 18, 21.5]), weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } }
}

function style(font: FontDecl, plainSpacing: boolean): TextStyle {
  return {
    font,
    letterSpacing: focus || plainSpacing || chance(0.75) ? 0 : pick([-1, 0.5, 3]),
    wordSpacing: chance(0.5) ? 0 : pick([-2, 5, -8, -30, 20]),
    whiteSpace: focus ? pick(['normal', 'normal', 'normal', 'pre-wrap', 'pre-line'] as const) : pick(WHITE_SPACE), wordBreak: pick(WORD_BREAK), overflowWrap: pick(OVERFLOW_WRAP), lineBreak: pick(LINE_BREAK), tabSize: pick([8, 8, 4, 0]),
  }
}

const edge = (): BoxEdge => ({ margin: pick([0, 0, 0, 3, -3, 7]), border: pick([0, 0, 1]), padding: pick([0, 0, 2, 5]) })

function paragraph(): Paragraph {
  const block = style(fontDecl(), chance(0.5))
  const content: InlineNode[] = []
  const parts = 1 + int(3)
  for (let i = 0; i < parts; i++) {
    const text = words()
    const roll = int(10)
    if (roll < 5) content.push({ kind: 'text', text })
    else if (roll < 8) {
      // A span that starts and ends inside words.
      const a = int(text.length + 1)
      const b = a + int(text.length - a + 1)
      const inherit = chance(0.5)
      const span = inherit ? block : { ...style(chance(0.5) ? block.font : fontDecl(), chance(0.5)), whiteSpace: chance(0.7) ? block.whiteSpace : pick(WHITE_SPACE) }
      content.push({ kind: 'text', text: text.slice(0, a) })
      content.push({ ...span, kind: 'span', lang: null, inlineStart: chance(0.5) ? edge() : { margin: 0, border: 0, padding: 0 }, inlineEnd: chance(0.5) ? edge() : { margin: 0, border: 0, padding: 0 }, verticalAlign: 'baseline', children: [{ kind: 'text', text: text.slice(a, b) }] })
      content.push({ kind: 'text', text: text.slice(b) })
    } else if (roll < 9) {
      content.push({ kind: 'text', text })
      content.push(chance(0.5) ? { kind: 'atomic', width: pick([0, 10, 40]), height: 10, marginInlineStart: pick([0, 4, -4]), marginInlineEnd: 0 } : chance(0.5) ? { kind: 'br' } : { kind: 'wbr' })
    } else content.push({ kind: 'text', text })
  }
  return {
    ...block, content, lang: pick(['en', 'en', 'ar', 'ja']), direction: chance(0.25) ? 'rtl' : 'ltr', lineHeight: 20, textIndent: chance(0.8) ? 0 : pick([10, -5, 40]),
    textAlign: pick(['start', 'start', 'start', 'justify', 'end', 'center']),
  }
}

// ---- Layout by one library ----

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: dictionary ? { kind: 'intl-segmenter-word' } : { kind: 'unavailable' },
}

// A layout's lines, as ranges or with their pieces, and on an inspected paragraph its negative-word-tail gaps.
type Laid = { lines: string[]; error: string | null; gaps: number }

function layout(p: Paragraph, widthAu: number, engine: Engine, firstOnly: boolean, inspect = false): Laid {
  const lines: string[] = []
  let gaps = 0
  try {
    const prepared = engine.prepare(p, env, inspect, createContextPool())
    let guard = 0
    for (let start = engine.firstLine(prepared); start !== null;) {
      const filled = engine.fillLine(prepared, start, { width: widthAu / 60, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('below floats without floats')
      lines.push(firstOnly ? `${filled.start}-${filled.end}` : JSON.stringify({ start: filled.start, end: filled.end, box: filled.hasLineBox, pieces: engine.linePieces(prepared, filled.line) }))
      for (const gap of filled.line.inspect?.gaps ?? []) if (gap.gap === 'negative-word-tail') gaps++
      if ((firstOnly && !allLines) || ++guard > 2000) break
      start = filled.next
    }
  } catch (error) {
    return { lines, error: error instanceof Error ? error.message : String(error), gaps }
  }
  return { lines, error: null, gaps }
}

// The widths where the first line's break moves (any line's under --all-lines), by bisection between two widths whose
// lines differ.
function thresholds(p: Paragraph, lo: number, hi: number, into: number[], depth: number): void {
  const ranges = (widthAu: number): string | null => {
    const laid = layout(p, widthAu, ENGINES.loop, true)
    return laid.error !== null ? null : allLines ? laid.lines.join(' ') : laid.lines[0]!
  }
  const first = ranges(lo)
  const last = ranges(hi)
  if (first === null || last === null || first === last) return
  let l = lo
  let h = hi
  while (h - l > 1) {
    const mid = (l + h) >> 1
    if (ranges(mid) === first) l = mid
    else h = mid
  }
  into.push(l, h, l - 1, h + 1)
  if (depth > 0) thresholds(p, h + 1, hi, into, depth - 1)
}

// ---- The run ----

installCanvas()
const report = {
  seed, count, breakPremise, dictionary, scripts, paragraphs: 0, layouts: 0, lines: 0, exactErrors: 0,
  scans: { decided: 0, left: 0, passed: 0 },
  differing: { proven: 0, premise: 0 }, modes: 0, gapped: 0, differingWithoutGap: 0,
  examples: [] as { paragraph: Paragraph; widthAu: number; mode: string; exact: string[]; word: string[]; gaps: number }[],
}
const same = (a: Laid, b: Laid): boolean => a.error === b.error && a.lines.length === b.lines.length && a.lines.every((line, i) => line === b.lines[i])
for (let n = 0; n < count; n++) {
  const p = paragraph()
  const widths: number[] = focus ? [1200 + int(3000), 3000 + int(6000), 9000 + int(21000)] : [1 + int(1800), 1800 + int(7200), 9000 + int(21000), 1]
  if (allLines) {
    // The first width after a drawn one where some line's break moves: six drawn starts.
    for (let k = 0; k < 6; k++) {
      const from = 1200 + int(24000)
      thresholds(p, from, from + 600 + int(3000), widths, 0)
    }
  } else thresholds(p, focus ? 1200 : 1, 40000, widths, focus ? 6 : 3)
  report.paragraphs++
  for (let w = 0; w < widths.length; w++) {
    const widthAu = Math.max(1, widths[w]!)
    const exact = layout(p, widthAu, ENGINES.loop, false)
    if (exact.error !== null) {
      report.exactErrors++
      continue
    }
    report.layouts++
    report.lines += exact.lines.length
    const premise = layout(p, widthAu, ENGINES.tree, false)
    const proven = layout(p, widthAu, ENGINES.proven, false)
    const inspected = layout(p, widthAu, ENGINES.tree, false, true)
    if (!same(premise, layout(p, widthAu, ENGINES.counted, false))) throw new Error('the counted copy gives other lines than the tree')
    if (!same(premise, inspected)) report.modes++
    if (inspected.gaps > 0) report.gapped++
    if (!same(exact, proven)) {
      report.differing.proven++
      if (report.examples.length < 40) report.examples.push({ paragraph: p, widthAu, mode: 'proven', exact: exact.lines, word: proven.lines, gaps: inspected.gaps })
    }
    if (!same(exact, premise)) {
      report.differing.premise++
      if (inspected.gaps === 0) report.differingWithoutGap++
      if (report.examples.length < 40) report.examples.push({ paragraph: p, widthAu, mode: 'premise', exact: exact.lines, word: premise.lines, gaps: inspected.gaps })
    }
  }
}
report.scans = { decided: tally.decided, left: tally.left, passed: tally.passed }
const out = options.get('out')
if (out !== undefined && out !== '') writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`)
console.log(`[word-scan-attack] seed ${seed}${breakPremise ? ', a font that breaks the premise' : ''}${dictionary ? ', dictionary breaks' : ''}${scripts ? ', more scripts' : ''}: ${report.paragraphs} paragraphs, ${report.layouts} layouts, ${report.lines} lines, ${asked} Canvas calls; ${report.exactErrors} layouts failed under the loop`)
console.log(`  plain scans: ${report.scans.decided} decided by the word scan, ${report.scans.passed} words passed over on the premise; ${report.scans.left} left to the loop`)
console.log(`  layouts that differ from the loop's: without the premise ${report.differing.proven}, the tree's ${report.differing.premise}, of them without the gap ${report.differingWithoutGap}; inspected layouts with the gap ${report.gapped}; inspected lines other than plain ${report.modes}`)
for (let i = 0; i < Math.min(8, report.examples.length); i++) {
  const e = report.examples[i]!
  console.log(`  differs (${e.mode}) at ${e.widthAu} au: ${JSON.stringify(e.paragraph.content).slice(0, 300)} ws=${e.paragraph.wordSpacing} ls=${e.paragraph.letterSpacing} ${e.paragraph.whiteSpace} ${e.paragraph.overflowWrap} ${e.paragraph.wordBreak}; gaps ${e.gaps}`)
}
// A font that keeps the premise allows no difference and no gap; one that breaks it allows differences that carry the gap.
const failed = report.differing.proven > 0 || report.modes > 0 || report.differingWithoutGap > 0 || (!breakPremise && (report.differing.premise > 0 || report.gapped > 0))
process.exit(failed ? 1 : 0)
