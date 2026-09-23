// Constructed paragraphs aimed at the three font premises of Blink's words first and cut predictor
// (src/engines/blink/shape.ts addWordPieces, windowAdjust16; line-breaker.ts wordCandidate) and at the edges of their
// recipes: long runs without a space that passes (text without spaces, URLs, CJK, Thai, Myanmar, Khmer, Arabic and
// Devanagari run together, emoji ZWJ sequences and stacked combining marks whose share by UTF-16 length is far from
// their width), words near 256 zoomed px, letter and word spacing of both signs far enough to make advances negative,
// tabs under preserved white space, soft hyphens in paragraphs with and without script segments, default-ignorable and
// bidi control characters at word edges, words without a script of their own beside script changes, Korean with
// spaces, right-to-left and mixed paragraphs, lines that start inside a word, words split across inline boxes, very
// large sizes and text indents. Not a test: the cases feed tools/words-attack.ts (the stand-in Canvases) and
// tools/bwf-constructed-probe.ts (the real browser), which pick the widths.
//
//   bun rebuild/tools/bwf-constructed-cases.ts --out=<cases.ndjson> [--set=all|chrome] [--seed=bwf-constructed-1]
//
// `chrome` keeps real families only and fewer sizes. The ids are in no registry.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { atomic, el, font, leaf, treeParagraph, type BlockSpec, type TreePart } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { createRng, type Rng } from '../lab/cases/prng.ts'
import type { Case } from '../lab/types.ts'

const ch = (...codes: number[]): string => String.fromCodePoint(...codes)
const SHY = ch(0xad)
const ZWSP = ch(0x200b)
const WJ = ch(0x2060)
const ZWJ = ch(0x200d)
const ZWNJ = ch(0x200c)
const LRM = ch(0x200e)
const RLM = ch(0x200f)
const FEFF = ch(0xfeff)
const CGJ = ch(0x34f)
const TAB = ch(9)

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const set = options.get('set') ?? 'all'
const rng: Rng = createRng(options.get('seed') ?? 'bwf-constructed-1')

// ---- Text pools ----

const LONG_LATIN = ['pneumonoultramicroscopicsilicovolcanoconiosis', 'supercalifragilisticexpialidocious', 'antidisestablishmentarianism', 'honorificabilitudinitatibus', 'floccinaucinihilipilification', 'WWWWWWWWWWMMMMMMMMMMiiiiiiiiiillllllllll', 'officeaffluentfjordwaffletrufflesoffice']
const URLS = ['https://example.com/a/very/long/path/to/some/resource/file.html?query=value&other=thing&more=1234567890#fragment', 'user.name+tag@subdomain.example-domain.co.uk', 'snake_case_identifier_that_goes_on_and_on_forever_and_ever', 'camelCaseIdentifierThatGoesOnAndOnForeverAndEverAgain', '/usr/local/lib/node_modules/some-package/dist/index.js']
const HAN = '日本語の文章と中文混排测试这是一个很长的段落没有空格的文本我们需要测试换行的行为是否正确以及在不同宽度下的表现如何'
const KANA = 'カタカナとひらがなのながいぶんしょうをためしますテキストレイアウトのテストです'
const THAI = 'สวัสดีชาวโลกนี่คือข้อความภาษาไทยที่ยาวมากโดยไม่มีช่องว่างเพื่อทดสอบการตัดคำและการขึ้นบรรทัดใหม่'
const MYANMAR = 'မြန်မာဘာသာစကားသည်မြန်မာနိုင်ငံ၏ရုံးသုံးဘာသာစကားဖြစ်သည်ကျွန်ုပ်တို့စမ်းသပ်နေသည်'
const KHMER = 'ភាសាខ្មែរគឺជាភាសាផ្លូវការរបស់ប្រទេសកម្ពុជាយើងកំពុងសាកល្បងការបំបែកបន្ទាត់'
const DEVANAGARI = 'नमस्तेदुनियायहहिन्दीमेंएकलंबाशब्दहैजिसमेंकोईरिक्तस्थाननहींहैक्षत्रियश्रीराजभाषा'
const ARABIC = 'مرحبابالعالمهذانصعربيطويلبدونمسافاتلاختبارالتفافالأسطرالعربيةالجميلة'
const URDU = 'یہاردومیںایکلمبامتنہےجسمیںکوئیخالیجگہنہیںہےپاکستانکیقومیزبان'
const EMOJI = [ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466), ch(0x1f3f3, 0xfe0f, 0x200d, 0x1f308), ch(0x1f1ef, 0x1f1f5), ch(0x1f44d, 0x1f3fd), ch(0x1f9d1, 0x1f3fb, 0x200d, 0x1f91d, 0x200d, 0x1f9d1, 0x1f3ff), ch(0x31, 0xfe0f, 0x20e3), ch(0x2764, 0xfe0f, 0x200d, 0x1f525), ch(0x1f600)]
const MARKS = [0x300, 0x301, 0x302, 0x303, 0x304, 0x306, 0x307, 0x308, 0x30a, 0x30b, 0x30c, 0x316, 0x317, 0x323, 0x324, 0x327, 0x328, 0x32d, 0x330, 0x331, 0x334, 0x335, 0x336, 0x338, 0x34d, 0x35c, 0x361]
const PROSE = 'To be, or not to be: that is the question. Whether tis nobler in the mind to suffer the slings and arrows of outrageous fortune, or to take arms against a sea of troubles, and by opposing end them.'
const KERNING = 'AVATAR Wave Yo. Ty fly office affix fjord Tr r. P. L T V A W. Y, F. T, r, y. To Tomorrow. Yes, Your Truly, V. A. Wyatt WAVE AWAY Te Yo Va AV'
const CHAT = `lol ok brb, gonna grab coffee ${ch(0x2615)} then I'll push the fix ${ch(0x1f44d)} ${ch(0x2014)} tbh it's like 3 lines... can u review PR #1423 when u get a sec? thx!! ${ch(0x1f64f, 0x1f64f)} also the CI is red again (flaky test?) idk`
const KOREAN = '한국어 문장은 띄어쓰기를 사용합니다. 이 문단은 줄 바꿈을 시험하기 위한 긴 문장입니다. 대한민국의 수도는 서울이며, 인구는 약 천만 명입니다. 2026년 9월 23일 테스트 (괄호) 「인용」 끝.'
const ARABIC_PROSE = 'مرحبا بالعالم، هذا نص عربي للاختبار. اللغة العربية جميلة جدا، وفي البداية كان الخط العربي يكتب بلا نقاط ثم تطور عبر القرون 123 في كل البلاد.'
const HEBREW_PROSE = 'שלום עולם, זהו טקסט בעברית לבדיקה. hello world 123 עם מילים באנגלית (בסוגריים) ומספרים 3.14 בסוף.'
const HINDI_PROSE = 'नमस्ते दुनिया, यह हिन्दी में एक परीक्षण वाक्य है। भारत की राजभाषा हिन्दी है और यह देवनागरी लिपि में लिखी जाती है। 2026 में।'
const URDU_PROSE = 'یہ اردو میں ایک جملہ ہے۔ پاکستان کی قومی زبان اردو ہے اور یہ نستعلیق خط میں لکھی جاتی ہے، 2026 میں۔'

function repeatTo(unit: string, units: number): string {
  let s = ''
  while (s.length < units) s += unit
  // Cut at a code point edge.
  let end = units
  if (end < s.length && (s.charCodeAt(end) & 0xfc00) === 0xdc00) end++
  return s.slice(0, end)
}

function zalgo(word: string, perLetter: number): string {
  let s = ''
  for (const letter of word) {
    s += letter
    for (let i = 0; i < perLetter; i++) s += ch(MARKS[(letter.codePointAt(0)! * 7 + i * 3) % MARKS.length]!)
  }
  return s
}

// ---- Families ----

const LATIN_FAMILIES = ['Arial', 'Times New Roman', 'Helvetica Neue', 'Georgia', 'Avenir Next', 'Palatino', 'Hoefler Text', 'Menlo', 'Courier New', 'Baskerville', 'Futura', 'Gill Sans', 'Optima', 'Didot', 'Charter', 'Verdana', 'American Typewriter']
const CONTEXT_FAMILIES = ['Zapfino', 'Apple Chancery', 'Snell Roundhand', 'Savoye LET', 'Bradley Hand', 'Noteworthy', 'Chalkboard SE', 'Marker Felt', 'SignPainter', 'Skia', 'Papyrus', 'Party LET', 'Trattatello', 'Luminari', 'Fira Code', 'Euphemia UCAS', 'STIX Two Text', 'PT Sans', 'Athelas']
const ARABIC_FAMILIES = ['Geeza Pro', 'Noto Nastaliq Urdu', 'Damascus', 'Baghdad', 'Al Nile', 'Mishafi', 'Diwan Thuluth', 'Farisi', 'Waseem', 'DecoType Naskh', 'KufiStandardGK', 'Arial', 'Times New Roman', 'Sana', 'Nadeem']
const HEBREW_FAMILIES = ['Arial Hebrew', 'Raanana', 'New Peninim MT', 'Corsiva Hebrew', 'Arial', 'Times New Roman']
const CJK_FAMILIES = ['PingFang SC', 'Hiragino Sans', 'Hiragino Mincho ProN', 'Songti SC', 'Apple SD Gothic Neo', 'Heiti SC', '"Helvetica Neue", "PingFang SC", sans-serif']
const INDIC_FAMILIES = ['Kohinoor Devanagari', 'ITF Devanagari', 'Devanagari Sangam MN', '"Shree Devanagari 714"', 'Mukta Mahee']
const SEA_FAMILIES = ['Thonburi', 'Sathu', 'Silom', 'Krungthep', 'Ayuthaya', 'Sukhumvit Set', 'Myanmar Sangam MN', 'Myanmar MN', 'Noto Sans Myanmar', 'Khmer Sangam MN', 'Khmer MN']
const GENERIC = ['serif', 'sans-serif']

const pick = <T>(xs: readonly T[]): T => xs[rng.int(xs.length)]!
const cases: Case[] = []
const seen = new Set<string>()
const byFamily: Record<string, number> = {}

function add(family: string, spec: BlockSpec, parts: TreePart[], width: number, pageLang: string = 'en'): void {
  const made = treeParagraph(spec, parts)
  if (made.paragraph.runs.length === 0) return
  const c = makeCase({ family, origin: `tools/bwf-constructed-cases.ts ${family}`, pageLang, paragraph: { ...made.paragraph, width }, inline: made.inline })
  if (seen.has(c.id)) return
  seen.add(c.id)
  cases.push(c)
  byFamily[family] = (byFamily[family] ?? 0) + 1
}

const chrome = set === 'chrome'
const SIZES = chrome ? [16, 40, 96] : [12, 16, 24, 40, 64, 96]
const WIDTHS = [30, 97.3, 200, 333.3, 640]

// 1. Runs without a space that passes: the cut search and its predictor.
{
  const runs: Array<[string, string, string, readonly string[], boolean]> = [
    ['latin', 'en', LONG_LATIN.join(''), LATIN_FAMILIES.concat(CONTEXT_FAMILIES), false],
    ['url', 'en', URLS.join(''), LATIN_FAMILIES.concat(['Fira Code', 'Menlo']), false],
    ['han', 'zh', HAN, CJK_FAMILIES, false],
    ['kana', 'ja', KANA, CJK_FAMILIES, false],
    ['thai', 'th', THAI, SEA_FAMILIES.slice(0, 6), false],
    ['myanmar', 'my', MYANMAR, SEA_FAMILIES.slice(6, 9), false],
    ['khmer', 'km', KHMER, SEA_FAMILIES.slice(9), false],
    ['devanagari', 'hi', DEVANAGARI, INDIC_FAMILIES, false],
    ['arabic', 'ar', ARABIC, ARABIC_FAMILIES, true],
    ['urdu', 'ur', URDU, ['Noto Nastaliq Urdu', 'Geeza Pro', 'Damascus', 'Arial'], true],
    ['emoji', 'en', EMOJI.join(''), LATIN_FAMILIES.slice(0, 4), false],
    ['zalgo', 'en', zalgo('zalgocomestoyourtextnowbeware', 7), LATIN_FAMILIES.slice(0, 6), false],
    ['ignorables', 'en', ['word', 'joined', 'by', 'ignorable', 'characters', 'that', 'lookups', 'skip'].join(`${WJ}${ZWSP}`) + FEFF + 'end' + CGJ + 'x' + ZWNJ + 'y' + LRM + 'z', LATIN_FAMILIES.slice(0, 6), false],
    ['mixed', 'en', `abc日本語def${ch(0x1f44d)}123ghi中文jkl${EMOJI[0]}mno한국어pqr`, LATIN_FAMILIES.slice(0, 4).concat(CJK_FAMILIES.slice(0, 2)), false],
  ]
  const lengths = chrome ? [40, 120, 320] : [24, 40, 64, 120, 200, 320, 600]
  for (let r = 0; r < runs.length; r++) {
    const [name, lang, unit, families, rtl] = runs[r]!
    for (let l = 0; l < lengths.length; l++) {
      const text = repeatTo(unit, lengths[l]!)
      for (let s = 0; s < SIZES.length; s++) {
        const size = SIZES[s]!
        const family = pick(families)
        const styles: Array<Partial<BlockSpec>> = [{}, { overflowWrap: 'anywhere' }, { wordBreak: 'break-all' }, { letterSpacing: -0.4 * size }, { letterSpacing: -0.2 * size }, { letterSpacing: 0.25 * size }, { overflowWrap: 'break-word', letterSpacing: 1 * size }]
        for (let y = 0; y < styles.length; y++) {
          if (chrome && y > 3) continue
          add(`con/run-${name}`, { font: font(family, size), lang, lineHeight: size * 2, overflowWrap: 'break-word', direction: rtl ? 'rtl' : 'ltr', ...styles[y] }, [leaf(text)], pick(WIDTHS), lang === 'ar' || lang === 'ur' ? 'ar' : lang === 'ja' || lang === 'zh' ? 'ja' : lang === 'th' ? 'th' : 'en')
        }
      }
    }
  }
}

// 2. Words near 256 zoomed px, alone and in pairs, over a sweep of sizes: at some size each word or pair crosses it.
{
  const texts = ['internationalization characteristically counterrevolutionaries uncharacteristically office', 'layout every width message the of and to we you your', 'AVATAR WAVE AWAY Tomorrow Yesterday Wyatt Truly', 'a bb ccc dddd eeeee ffffff ggggggg hhhhhhhh iiiiiiiii jjjjjjjjjj']
  const step = chrome ? 3.7 : 1.3
  for (let t = 0; t < texts.length; t++) for (let size = 9; size <= 80; size += step) {
    const family = pick(LATIN_FAMILIES.concat(CONTEXT_FAMILIES.slice(0, 6)))
    add('con/near256', { font: font(family, Math.round(size * 100) / 100), lang: 'en', lineHeight: Math.ceil(size * 2), overflowWrap: 'break-word' }, [leaf(texts[t]!)], pick(WIDTHS))
  }
}

// 3. Letter and word spacing of both signs, far enough to make advances and words narrower than nothing.
{
  const texts: Array<[string, string, readonly string[]]> = [['prose', PROSE, LATIN_FAMILIES], ['kerning', KERNING, LATIN_FAMILIES.concat(CONTEXT_FAMILIES)], ['chat', CHAT, LATIN_FAMILIES.concat(['Euphemia UCAS'])], ['runs', 'a  b   c    d  e f   g T  o V   a  To   be,  or  not   to be:    that  is the  question.   ', LATIN_FAMILIES]]
  const letter = [-0.6, -0.4, -0.25, -0.1, 0, 0.1, 0.5, 1.5]
  const word = [-1.2, -0.6, -0.3, 0, 0.3, 1]
  const whiteSpace = ['normal', 'pre-wrap', 'break-spaces'] as const
  for (let t = 0; t < texts.length; t++) for (let a = 0; a < letter.length; a++) for (let b = 0; b < word.length; b++) {
    if (letter[a] === 0 && word[b] === 0) continue
    if (chrome && rng.chance(0.5)) continue
    const size = pick(chrome ? [16, 32] : [13, 16, 21.5, 32, 48])
    const [name, text, families] = texts[t]!
    add(`con/spacing-${name}`, { font: font(pick(families), size), lang: 'en', lineHeight: size * 2, overflowWrap: 'break-word', letterSpacing: letter[a]! * size, wordSpacing: word[b]! * size, whiteSpace: pick(whiteSpace) }, [leaf(text)], pick(WIDTHS))
  }
}

// 4. Tabs under preserved white space.
{
  const texts = [`a${TAB}b${TAB}c d${TAB}${TAB}e`, `word${TAB}word word${TAB} word ${TAB}word`, `${TAB}indented line with ${TAB}tabs and spaces${TAB}`, `internationalization${TAB}characteristically${TAB}x`, `名前${TAB}値${TAB}説明 日本語${TAB}テスト`, `name${TAB}value${TAB}${ch(0x1f44d)} ok${TAB}${ch(0x2014)}${TAB}done`]
  for (let t = 0; t < texts.length; t++) for (const ws of ['pre-wrap', 'pre', 'break-spaces'] as const) for (const tab of [0, 1, 3, 8]) {
    const size = pick([12, 16, 24])
    add('con/tabs', { font: font(pick(LATIN_FAMILIES.concat(['PingFang SC'])), size), lang: 'en', lineHeight: size * 2, whiteSpace: ws, tabSize: tab, overflowWrap: 'break-word', wordSpacing: rng.chance(0.3) ? pick([-3, 4]) : 0 }, [leaf(texts[t]!)], pick(WIDTHS))
  }
}

// 5. Soft hyphens, in paragraphs without script segments (Latin-1 alone) and with them (a curly quote or dash).
{
  const texts = [`of${SHY}fice af${SHY}flu${SHY}ent fjord ${SHY}start end${SHY} a ${SHY}b a${SHY} b dou${SHY}${SHY}ble in${SHY}ter${SHY}na${SHY}tion${SHY}al${SHY}iza${SHY}tion`, `super${SHY}cal${SHY}i${SHY}frag${SHY}il${SHY}is${SHY}tic${SHY}ex${SHY}pi${SHY}al${SHY}i${SHY}do${SHY}cious pneu${SHY}mono${SHY}ultra${SHY}micro${SHY}scopic${SHY}silico${SHY}volcano${SHY}coniosis`]
  for (let t = 0; t < texts.length; t++) for (const segmented of [false, true]) for (let s = 0; s < SIZES.length; s++) for (const ow of ['normal', 'break-word'] as const) {
    const text = segmented ? `${ch(0x201c)}${texts[t]!}${ch(0x201d)} ${ch(0x2014)} ok` : texts[t]!
    add('con/shy', { font: font(pick(LATIN_FAMILIES), SIZES[s]!), lang: 'en', lineHeight: SIZES[s]! * 2, overflowWrap: ow, letterSpacing: rng.chance(0.25) ? 1 : 0 }, [leaf(text)], pick(WIDTHS))
  }
}

// 6. Default-ignorable and bidi control characters at word edges, doubled, beside spaces and inside words.
{
  const controls = [ZWSP, WJ, FEFF, ZWJ, ZWNJ, LRM, RLM, CGJ, ch(0xfe0f), ch(0x180e), ch(0x2066), ch(0x2067), ch(0x2068), ch(0x2069), ch(0x202a), ch(0x202c), ch(0x2061), ch(0x115f), ch(0x3164)]
  for (let c = 0; c < controls.length; c++) {
    const x = controls[c]!
    const text = `foo ${x}bar baz${x} qux ${x}${x}quux T${x} ${x}o V${x}${x} a of${x}fice ${x} lone ${x}${x} two end${x}`
    for (const segmented of [false, true]) for (const size of [16, 28]) {
      add('con/ignorables', { font: font(pick(LATIN_FAMILIES.concat(CONTEXT_FAMILIES.slice(0, 5))), size), lang: 'en', lineHeight: size * 2, overflowWrap: 'break-word' }, [leaf(segmented ? `${text} ${ch(0x2014)}` : text)], pick(WIDTHS))
    }
  }
}

// 7. Words without a script of their own beside script changes and at group edges.
{
  const texts: Array<[string, string, string, readonly string[], boolean]> = [
    ['latin', 'en', `123 abc - def ${ch(0x2014)} 4.5 ${ch(0x201c)}ghi${ch(0x201d)} ${ch(0x1f44d)} jkl ... (mno) [7] ${ch(0x2026)} pqr ${ch(0xab)} stu ${ch(0xbb)} 99% vwx ${ch(0x1f64f, 0x1f64f)} yz`, LATIN_FAMILIES.concat(CONTEXT_FAMILIES), false],
    ['all-neutral', 'en', `1 2 3 - ${ch(0x2014)} ... 4.5 ${ch(0x1f44d)} (6) [7] 99% ${ch(0x2026)} #1 @2 $3 & + = / : ; ! ?`, LATIN_FAMILIES.concat(['Euphemia UCAS']), false],
    ['arabic', 'ar', `${ARABIC_PROSE} - ${ch(0x2014)} 12 (${ch(0x645, 0x631, 0x62d, 0x628, 0x627)}) ${ch(0x1f44d)} ... ${ch(0xab)}${ch(0x646, 0x635)}${ch(0xbb)}`, ARABIC_FAMILIES, true],
    ['hebrew', 'he', `${HEBREW_PROSE} - 12 ${ch(0x2014)} (${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)}) ${ch(0x1f44d)} ...`, HEBREW_FAMILIES, true],
    ['cjk-latin', 'ja', `日本語 English 中文 123 テスト test ${ch(0x3001)} words ${ch(0x3002)} 한국어 abc (括弧) 「引用」 ${ch(0x1f44d)} ok`, CJK_FAMILIES, false],
    ['hindi', 'hi', `${HINDI_PROSE} - 12 ${ch(0x2014)} (${ch(0x928, 0x92e)}) ${ch(0x964)} ok`, INDIC_FAMILIES, false],
    ['urdu', 'ur', URDU_PROSE, ['Noto Nastaliq Urdu', 'Geeza Pro', 'Damascus', 'Arial'], true],
  ]
  for (let t = 0; t < texts.length; t++) for (let s = 0; s < SIZES.length; s++) for (const flip of [false, true]) {
    const [name, lang, text, families, rtl] = texts[t]!
    const size = SIZES[s]!
    add(`con/neutral-${name}`, { font: font(pick(families), size), lang, lineHeight: size * 2, overflowWrap: 'break-word', direction: rtl !== flip ? 'rtl' : 'ltr', wordSpacing: rng.chance(0.2) ? pick([-2, 3]) : 0 }, [leaf(text)], pick(WIDTHS), lang === 'ar' || lang === 'ur' ? 'ar' : lang === 'ja' ? 'ja' : 'en')
  }
}

// 8. Korean with spaces, under normal and keep-all.
for (let s = 0; s < SIZES.length; s++) for (const wb of ['normal', 'keep-all', 'break-all'] as const) for (const family of chrome ? ['Apple SD Gothic Neo', 'PingFang SC'] : ['Apple SD Gothic Neo', 'AppleGothic', 'PingFang SC', 'sans-serif']) {
  add('con/korean', { font: font(family, SIZES[s]!), lang: 'ko', lineHeight: SIZES[s]! * 2, overflowWrap: 'break-word', wordBreak: wb }, [leaf(KOREAN)], pick(WIDTHS))
}

// 9. Lines that start inside a word, then more words.
{
  const text = `${LONG_LATIN[0]!} the office of ${LONG_LATIN[1]!} to be or not ${URLS[0]!} and so on ${LONG_LATIN[5]!} end`
  for (let s = 0; s < SIZES.length; s++) for (const style of [{ overflowWrap: 'anywhere' }, { overflowWrap: 'break-word' }, { wordBreak: 'break-all' }, { wordBreak: 'break-word' }] as Array<Partial<BlockSpec>>) {
    add('con/midword', { font: font(pick(LATIN_FAMILIES.concat(CONTEXT_FAMILIES.slice(0, 4))), SIZES[s]!), lang: 'en', lineHeight: SIZES[s]! * 2, ...style }, [leaf(text)], pick([30, 64, 97.3, 150]))
  }
}

// 10. Words split across inline boxes, boxes with edges at word edges, other spacing inside a word, atomic inlines.
{
  for (let i = 0; i < (chrome ? 60 : 200); i++) {
    const size = pick([13, 16, 24, 40])
    const family = pick(LATIN_FAMILIES.concat(CONTEXT_FAMILIES.slice(0, 6)))
    const parts: TreePart[] = [leaf('The office of the ')]
    const kind = rng.int(5)
    const edge = { margin: pick([0, 3, -3]), border: pick([0, 1]), padding: pick([0, 2, 6]) }
    if (kind === 0) parts.push(leaf('affl'), el({}, leaf('uent fjord')), leaf(' village'))
    else if (kind === 1) parts.push(el({ start: edge, end: edge }, leaf('affluent')), leaf(' '), el({ start: edge }, leaf(' fjord')), leaf(' village'))
    else if (kind === 2) parts.push(leaf('aff'), el({ letterSpacing: pick([-2, 2, 5]) }, leaf('lu')), leaf('ent fjord village'))
    else if (kind === 3) parts.push(leaf('affluent '), atomic(pick([0, 10, 40]), 10), leaf(' fjord'), atomic(5, 5), leaf('village'))
    else parts.push(leaf('affluent'), el({ font: font(pick(LATIN_FAMILIES), size) }, leaf(' fjord ')), leaf('village of the ' + LONG_LATIN[2]!))
    parts.push(leaf(' and the waffles, coffee and truffles.'))
    add('con/spans', { font: font(family, size), lang: 'en', lineHeight: size * 2, overflowWrap: 'break-word', wordSpacing: rng.chance(0.3) ? pick([-2, 3]) : 0 }, parts, pick(WIDTHS))
  }
}

// 11. Very large sizes, where every word is 256 zoomed px or more, and text indents.
{
  const texts: Array<[string, string, readonly string[], boolean]> = [['en', PROSE, LATIN_FAMILIES.concat(CONTEXT_FAMILIES), false], ['ar', ARABIC_PROSE, ARABIC_FAMILIES, true], ['ur', URDU_PROSE, ['Noto Nastaliq Urdu', 'Geeza Pro'], true], ['hi', HINDI_PROSE, INDIC_FAMILIES, false], ['ja', `${HAN} ${KANA}`, CJK_FAMILIES, false], ['en', CHAT, LATIN_FAMILIES, false]]
  for (let t = 0; t < texts.length; t++) for (const size of chrome ? [72, 150] : [72, 120, 180]) for (let i = 0; i < (chrome ? 3 : 5); i++) {
    const [lang, text, families, rtl] = texts[t]!
    add('con/large', { font: font(pick(families), size), lang, lineHeight: size * 2, overflowWrap: 'break-word', direction: rtl ? 'rtl' : 'ltr', textIndent: pick([0, 0, -30, 55.5]), textAlign: pick(['start', 'justify', 'center'] as const) }, [leaf(text)], pick([200, 480, 900, 1500]), lang === 'ar' || lang === 'ur' ? 'ar' : lang === 'ja' ? 'ja' : 'en')
  }
}

// 12. Prose in every generic and ordinary family at DPR-sensitive sizes, right to left, and justified.
{
  const texts: Array<[string, string, string, readonly string[], boolean]> = [['en', PROSE, 'en', LATIN_FAMILIES.concat(GENERIC), false], ['en', KERNING, 'en', CONTEXT_FAMILIES, false], ['ar', ARABIC_PROSE, 'ar', ARABIC_FAMILIES, true], ['he', HEBREW_PROSE, 'en', HEBREW_FAMILIES, true], ['hi', HINDI_PROSE, 'en', INDIC_FAMILIES, false], ['ur', URDU_PROSE, 'ar', ['Noto Nastaliq Urdu'], true]]
  for (let t = 0; t < texts.length; t++) {
    const [lang, text, pageLang, families, rtl] = texts[t]!
    for (let f = 0; f < families.length; f++) for (const size of chrome ? [16, 28] : [11, 16, 21.5, 28, 33]) {
      add(`con/prose-${lang}`, { font: font(families[f]!, size), lang, lineHeight: size * 2, overflowWrap: 'break-word', direction: rtl ? 'rtl' : 'ltr', textAlign: pick(['start', 'justify'] as const) }, [leaf(text)], pick(WIDTHS), pageLang)
    }
  }
}

// 13. Short words repeated, where a font's contextual forms and state machines could carry past a space: single letters,
// doubled letters, a font's own named ligatures, Arabic one-letter and two-letter words.
{
  const latin = ['e e e e e e e e e e e e', 'a b a b a b a b a b a b', 'aa aa aa aa aa aa aa aa', 'll ll ll ll ll ll ll ll', 'the the the the the the the the', 'Th Th Th Th Th Th Th', 'Zapfino Zapfino Zapfino Zapfino', 'and and and and and and', 'fifty fifty fifty fifty', 'I I I I I I I I I I I I', 'st ct st ct st ct st ct', 'o o o o o o o o o o o o', 'yy gg yy gg yy gg yy gg', 'Qu Qu Qu Qu Qu Qu Qu', 'of the of the of the of the', 'ss ss ss ss ss ss ss ss', 'r. r, r. r, r. r, r. r,']
  const arabic = [`${ch(0x648)} ${ch(0x648)} ${ch(0x648)} ${ch(0x648)} ${ch(0x648)} ${ch(0x648)} ${ch(0x648)} ${ch(0x648)}`, `${ch(0x628)} ${ch(0x628)} ${ch(0x628)} ${ch(0x628)} ${ch(0x628)} ${ch(0x628)} ${ch(0x628)}`, `${ch(0x647)} ${ch(0x647)} ${ch(0x647)} ${ch(0x647)} ${ch(0x647)} ${ch(0x647)}`, `${ch(0x644, 0x627)} ${ch(0x644, 0x627)} ${ch(0x644, 0x627)} ${ch(0x644, 0x627)} ${ch(0x644, 0x627)}`, `${ch(0x641, 0x64a)} ${ch(0x641, 0x64a)} ${ch(0x641, 0x64a)} ${ch(0x641, 0x64a)} ${ch(0x641, 0x64a)}`, `${ch(0x627, 0x644, 0x644, 0x647)} ${ch(0x627, 0x644, 0x644, 0x647)} ${ch(0x627, 0x644, 0x644, 0x647)} ${ch(0x627, 0x644, 0x644, 0x647)}`, `${ch(0x646)} ${ch(0x6cc)} ${ch(0x6d2)} ${ch(0x646)} ${ch(0x6cc)} ${ch(0x6d2)} ${ch(0x646)} ${ch(0x6cc)} ${ch(0x6d2)}`]
  for (let t = 0; t < latin.length; t++) for (let f = 0; f < CONTEXT_FAMILIES.length; f++) for (const size of chrome ? [16, 40] : [16, 28, 40]) {
    add('con/repeats-latin', { font: font(CONTEXT_FAMILIES[f]!, size), lang: 'en', lineHeight: size * 2, overflowWrap: 'break-word' }, [leaf(latin[t]!)], pick(WIDTHS))
  }
  for (let t = 0; t < arabic.length; t++) for (let f = 0; f < ARABIC_FAMILIES.length; f++) for (const size of chrome ? [16, 40] : [16, 28, 40]) {
    add('con/repeats-arabic', { font: font(ARABIC_FAMILIES[f]!, size), lang: 'ar', lineHeight: size * 2, overflowWrap: 'break-word', direction: 'rtl' }, [leaf(arabic[t]!)], pick(WIDTHS), 'ar')
  }
}

// 14. Letter spacing beside script runs a cursive script takes none in and words Canvas measures alone as Common: the
// wide window's rule for such sides (shape.ts adjustBetweenCuts16) moves windows, and letterSpacingDifference16 corrects
// each measured string by the script Canvas gives it. The stand-in Canvas gives every character letter spacing, so only
// the browser can say what these do (the owner's DPR 3 difference, c-e0534106b1315b66, is the first text).
{
  const texts = [
    `ภาษาไทย ${ZWJ}${ch(0x1f44d, 0x1f3fd)}${ZWSP} 2026-09-20${ZWSP} हिन्दी ١٢٣ ${SHY}[2] ${ZWSP}テキスト ${ZWSP}thin${ch(0x2009)}space 'tis`,
    `abc ١٢٣ ${SHY}[2] def ١٢٣ (4) ghi ٤٥٦ ${ch(0x1f44d)} jkl`,
    `${ch(0x645, 0x631, 0x62d, 0x628, 0x627)} [1] (2) ${ch(0x639, 0x627, 0x644, 0x645)} ${SHY}[3] ١٢٣ ${ch(0x2014)} ${ch(0x646, 0x635)}`,
    `word ${ch(0x5e9, 0x5dc, 0x5d5, 0x5dd)} [1] ${ch(0x2014)} (2) ${ch(0x5e2, 0x5d5, 0x5dc, 0x5dd)} ${SHY}x end`,
    `office ١٢٣ ${ch(0x201c)}[2]${ch(0x201d)} ${ch(0x2026)} fjord ${ch(0x663, 0x664)} ${SHY}${ch(0x2014)} waffle`,
  ]
  for (let t = 0; t < texts.length; t++) for (const ls of [-3, -1, 1, 3]) for (const ws of [0, 2.5]) for (const size of [16, 21.5]) for (const rtl of [false, true]) {
    if (chrome && rng.chance(0.4)) continue
    add('con/ls-script', { font: font(pick(['sans-serif', 'Arial', 'Geeza Pro', 'Times New Roman', 'Helvetica Neue']), size), lang: t === 0 ? 'th' : t === 2 ? 'ar' : 'en', lineHeight: 40, overflowWrap: 'break-word', lineBreak: pick(['auto', 'anywhere'] as const), letterSpacing: ls, wordSpacing: ws, direction: rtl ? 'rtl' : 'ltr' }, [leaf(texts[t]!)], pick(WIDTHS))
  }
}

const out = options.get('out')
if (out === undefined) throw new Error('--out=<cases.ndjson> is required')
const lines: string[] = []
for (let i = 0; i < cases.length; i++) lines.push(JSON.stringify(cases[i]!))
writeFileSync(resolve(out), `${lines.join('\n')}\n`)
console.log(`[bwf-constructed-cases] ${cases.length} cases (${set}): ${JSON.stringify(byFamily)}`)
