// The word scan's premise (src/engines/gecko/lines.ts wordScan: no tail of a shaped word has a negative advance) in the
// real Firefox, over the scripts and fonts tools/word-scan-premise-probe.ts leaves out: words of main's corpora (Thai,
// Khmer, Myanmar and their dictionary breaks, Devanagari, Urdu, Arabic, Hebrew, Korean, Han and kana, English with curly
// quotes and dashes), Lao, Tibetan and Mongolian samples, emoji sequences, Han beside Latin, and made-up words of every
// script a Noto face on this Mac draws; each in the families that draw it, at several sizes, weights and styles, with the
// lab's font facts (lab/font-facts.ts, which says `split` for the kern-table faces) and without them.
// Each word is a paragraph of its own under overflow-wrap: break-word (and word-break: break-all where a group asks),
// at T, the smallest width where the tree's plain library gives it one line. At T the word's end fits, so the word scan
// passes over every inner candidate on the premise alone, and the inspected paragraph, which runs the engine's loop
// beside it over the same advances, reports negative-word-tail wherever a prefix is wider than T (gaps.ts
// negativeWordTail). One library suffices: the gap is the difference. Where it fires, the probe lays the word out
// natively at T too: one native line says the port's own estimate crossed the word's end (a false gap), more says the
// word scan's line is wrong.
//
// WORD_SCAN_SCRIPTS_CONTROL=1 takes 20px off Canvas's answer for every `q` in Arial, over `xq`, `axqi` and `hello`: the
// first two must come back with the gap and the third without.
// WORD_SCAN_SCRIPTS_GROUPS=<comma list> keeps some groups; WORD_SCAN_SCRIPTS_LIMIT=<n> keeps n words a group.
// WORD_SCAN_SCRIPTS_NATIVE=1 also holds every word to Firefox's own premise: laid out natively at its own native advance
// A (a span's width) and at A + 1 au, it must give one line; where it doesn't, some prefix of the shaped word is wider
// than the word in Firefox's glyphs, and the record says what the port gives at A (nativeFailures).
// WORD_SCAN_SCRIPTS_WEBFONTS=1 replaces the groups with installed faces loaded as web fonts at axis corners (below).
//
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=firefox -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/word-scan-scripts-probe.ts --out=<dir> \
//       --probe-timeout-ms=7200000 --stall-ms=7200000 [--firefox-prefs=<{"layout.css.devPixelsPerPx": "1.0"}>]
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fontFactsFor } from '../lab/font-facts.ts'
import { UNKNOWN_FONT_FACTS, type FontFacts } from '../src/model.ts'
import type { Probe } from '../probes/types.ts'
import { negativeTailFont } from './negative-tail-font.ts'

const MAIN = resolve(import.meta.dir, '../../corpora')
const FIXTURES = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu']

async function bundleOf(src: string): Promise<string> {
  const entry = join(mkdtempSync(join(tmpdir(), 'pretext-word-scan-scripts-')), 'entry.ts')
  writeFileSync(entry, readFileSync(join(import.meta.dir, 'word-scan-scripts-probe-entry.ts'), 'utf8').replaceAll("'../src/", `'${src}/`))
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling ${src} failed: ${built.logs.join('\n')}`)
  return await built.outputs[0]!.text()
}

const c = (...codes: number[]): string => String.fromCodePoint(...codes)

// The distinct tokens between U+0020, tabs and line feeds of main's corpus files, in text order, up to `cap`, each cut
// to at most `longest` UTF-16 units at a grapheme boundary.
function tokens(files: string[], cap: number, longest = 120): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })
  for (let f = 0; f < files.length; f++) {
    const text = readFileSync(join(MAIN, `${files[f]!}.txt`), 'utf8')
    const parts = text.split(/[ \t\n\r]+/)
    for (let i = 0; i < parts.length && out.length < cap; i++) {
      let word = parts[i]!
      if (word === '' || word.includes(c(0xad))) continue
      if (word.length > longest) {
        let cut = ''
        for (const g of graphemes.segment(word)) { if (cut.length + g.segment.length > longest) break; cut += g.segment }
        word = cut
      }
      if (!seen.has(word)) { seen.add(word); out.push(word) }
    }
  }
  return out
}

// Runs of Han and kana text cut into pieces of `size` UTF-16 units at grapheme boundaries.
function pieces(files: string[], size: number, cap: number): string[] {
  const out: string[] = []
  const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' })
  for (let f = 0; f < files.length && out.length < cap; f++) {
    const text = readFileSync(join(MAIN, `${files[f]!}.txt`), 'utf8').replace(/[ \t\n\r]+/g, '')
    let cut = ''
    for (const g of graphemes.segment(text)) {
      cut += g.segment
      if (cut.length >= size) { out.push(cut); cut = ''; if (out.length >= cap) break }
    }
  }
  return out
}

// Made-up words of a script: letters with a mark after some of them, from the code points Unicode gives the script.
function madeUp(script: string, count: number, seed: number): string[] {
  const letters: number[] = []
  const marks: number[] = []
  const letter = new RegExp(`^[\\p{Script=${script}}&&\\p{L}]$`, 'v')
  const mark = new RegExp(`^[\\p{Script_Extensions=${script}}&&\\p{M}]$`, 'v')
  for (let cp = 0x80; cp < 0x20000; cp++) {
    const ch = String.fromCodePoint(cp)
    if (letter.test(ch)) letters.push(cp)
    else if (mark.test(ch) && cp !== 0x34f) marks.push(cp)
  }
  if (letters.length === 0) return []
  let state = seed >>> 0
  const next = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const out: string[] = []
  for (let n = 0; n < count; n++) {
    let word = ''
    const length = 2 + Math.floor(next() * 7)
    for (let i = 0; i < length; i++) {
      word += String.fromCodePoint(letters[Math.floor(next() * letters.length)]!)
      if (marks.length > 0 && next() < 0.3) word += String.fromCodePoint(marks[Math.floor(next() * marks.length)]!)
    }
    out.push(word)
  }
  return out
}

// Web fonts the page loads through the FontFace API under WORD_SCAN_SCRIPTS_WEBFONTS=1: installed faces at the corners
// of their variation axes, which Canvas measures too where the instance is the face's own (a descriptor, not
// font-variation-settings on an element). HarfBuzz gives Skia at wght 0.48, wdth 0.62 negative tails ('.' before a closing
// curly quote, -122 and +108 of 2048); its named Light Condensed instance (wdth 0.70) has none.
// `bytes`: a font file read here and handed to the page, where `source` names none.
type WebFont = { family: string; source: string; variationSettings: string | null; bytes?: string }
const WEBFONTS: WebFont[] = [
  { family: 'SkiaCorner', source: 'local("Skia")', variationSettings: '"wght" 0.48, "wdth" 0.62' },
  { family: 'SkiaCornerBytes', source: '', bytes: '/System/Library/Fonts/Supplemental/Skia.ttf', variationSettings: '"wght" 0.48, "wdth" 0.62' },
  { family: 'SkiaLightCondensed', source: 'local("Skia")', variationSettings: '"wght" 0.48, "wdth" 0.7' },
  { family: 'SkiaPlain', source: 'local("Skia")', variationSettings: null },
  // tools/negative-tail-font.ts: made up, a legacy kern table whose pairs give the point after `y` and `q` after `V`
  // negative advances. The premise fails in the font itself: the inspected paragraph must report the gap, and Firefox's
  // own line is the loop's.
  { family: 'NegativeTail', source: '', bytes: 'generated:negative-tail', variationSettings: null },
  { family: 'MonaspaceNeonThinWide', source: 'local("Monaspace Neon Var")', variationSettings: '"wght" 200, "wdth" 125, "slnt" -11' },
  { family: 'MonaspaceNeonBlackNarrow', source: 'local("Monaspace Neon Var")', variationSettings: '"wght" 800, "wdth" 100, "slnt" 0' },
]

const ARABIC_TANWEEN = ['شكراً', 'جداً', 'أيضاً', 'مثلاً', 'دائماً', 'أبداً', 'عادةً', 'حالاً', 'فوراً', 'تقريباً', 'أولاً', 'ثانياً', 'أخيراً', 'غداً', 'صباحاً', 'مساءً', 'سابقاً', 'لاحقاً', 'قليلاً', 'كثيراً', 'طبعاً', 'حقاً', 'ممتازاً', 'رجالاً', 'جميلاً', 'كتاباً', 'بيتاً', 'ولداً', 'سلاماً', 'عاماً', 'ومركباً', 'صلاحاً', 'سجالاً', 'أمثالاً', 'وأشكالاً', 'عظيماً', 'جسيماً', 'حكيماً', 'مصباحاً', 'فرحاً', 'سماعاً', 'معدولاً', 'قولاً', 'محتالاً', 'دلكاً', 'مفتوحاً', 'ومتوزعاً', 'نشالاً', 'مرسالاً', 'مسوغاً', 'مالاً', 'طولاً', 'جياعاً', 'هشيماً', 'صحاحاً', 'وأرباعاً', 'بهرجاً', 'ومنازعاً', 'وزعيماً', 'بدلاً', 'إمتاعاً', 'سليماً', 'تعظيماً', 'أكلاً', 'أقداحاً', 'قداحاً', 'وأكلاً', 'نوحاً', '{وَلاَ', 'غزلاً', 'آكلاً', 'زوجاً', 'مقيماً', 'طسوجاً', 'عجولاً', 'ضحكاً', 'لئيماً', 'موصولاً', 'وفرخاً', 'بولاً', 'شجاعاً', 'مخدوعاً', 'مضياعاً', 'نفاجاً', 'توكلاً', 'متوكلاً', 'وغنماً', 'ممسكاً', 'ممدوحاً', 'مسلكاً', 'بالاً', 'وَلاَ', 'مستأكلاً', 'مشغولاً', 'جردناجاً', 'جدحاً', 'وغولاً', 'جوعاً', 'ألالاً', 'مجزلاً', 'وكلاً', 'ودرمكاً', 'مجموعاً', 'ارتفاعاً', 'نسخٍ', 'إلاّ', 'سجسجٍ', 'ملكاً', 'زعلاً', 'رهيرٍ', 'بركةٌ', 'جرعاً', 'ألاّ', 'بصيرٍ', 'إلاَّ', 'هلمَّ', 'ضلالاً', 'كلاّ', 'إيغالاً', 'مقولاً', 'عترٍ', 'رسولاً', 'علمٌ', 'مالكاً', 'بخيرٍ', 'منزلاً', 'بحقيرٍ', 'خبرٍ', 'مصنوعاً', 'كثيرٍ', 'مستودعاً', 'غرلاً', 'كبيرٍ', 'مهرولاً', 'هلُمَّ', 'سريرٍ', 'ناعماً']

type Variant = { weight: number; style: 'normal' | 'italic' }
type Group = {
  name: string
  words: string[]
  families: string[]
  sizes: number[]
  lang: string
  direction: 'ltr' | 'rtl'
  variants?: Variant[]
  wordBreaks?: ('normal' | 'break-all')[]
  // Also with the lab's font facts for each family, where the table knows it.
  labFacts?: boolean
  // Also Firefox's own premise for every word (WORD_SCAN_SCRIPTS_NATIVE=1 asks it of every group).
  native?: boolean
}

const REGULAR: Variant = { weight: 400, style: 'normal' }
const BOLD: Variant = { weight: 700, style: 'normal' }
const ITALIC: Variant = { weight: 400, style: 'italic' }
const BOLD_ITALIC: Variant = { weight: 700, style: 'italic' }

const SANS = ['!sans-serif', '!serif', '!system-ui']
const LATIN_FAMILIES = ['Helvetica', 'Helvetica Neue', 'Times', 'Times New Roman', 'Verdana', 'Hoefler Text', 'Apple Chancery', 'Arial', 'Georgia', 'Optima', 'Palatino',
  'Baskerville', 'Didot', 'Futura', 'Gill Sans', 'Avenir Next', 'Charter', 'Iowan Old Style', 'Superclarendon', 'Marker Felt', 'Zapfino', 'Snell Roundhand', 'Savoye LET',
  'Bradley Hand', 'SignPainter', 'Brush Script MT', 'Luminari', 'Party LET', 'Chalkduster', 'Papyrus', 'Herculanum', 'Trattatello', 'Noteworthy', 'Cochin', 'Big Caslon',
  'Bodoni 72', 'American Typewriter', 'Rockwell', 'Copperplate', 'Skia', 'Athelas', 'Seravek', 'Kefa III', 'PT Serif', 'PT Sans', 'STIX Two Text', 'Lucida Grande',
  'Trebuchet MS', 'Comic Sans MS', 'Courier New', 'Menlo', 'Monaspace Neon', 'Monaspace Radon', 'Monaspace Neon Var', 'Fira Code', 'Tahoma', 'Arial Unicode MS', ...SANS]
const SPLIT = ['Helvetica', 'Helvetica Neue', 'Times', 'Times New Roman', 'Verdana', 'Hoefler Text', 'Apple Chancery']

const NOTO_SCRIPTS: Array<[string, string, 'ltr' | 'rtl']> = [
  ['Adlam', 'Noto Sans Adlam', 'rtl'], ['Duployan', 'Noto Sans Duployan', 'ltr'], ['Mongolian', 'Noto Sans Mongolian', 'ltr'], ['Syriac', 'Noto Sans Syriac', 'rtl'],
  ['Nko', 'Noto Sans NKo', 'rtl'], ['Hanifi_Rohingya', 'Noto Sans Hanifi Rohingya', 'rtl'], ['Mandaic', 'Noto Sans Mandaic', 'rtl'], ['Manichaean', 'Noto Sans Manichaean', 'rtl'],
  ['Psalter_Pahlavi', 'Noto Sans Psalter Pahlavi', 'rtl'], ['Phags_Pa', 'Noto Sans PhagsPa', 'ltr'], ['Javanese', 'Noto Sans Javanese', 'ltr'], ['Balinese', 'Noto Serif Balinese', 'ltr'],
  ['Tai_Tham', 'Noto Sans Tai Tham', 'ltr'], ['Chakma', 'Noto Sans Chakma', 'ltr'], ['Cham', 'Noto Sans Cham', 'ltr'], ['Khojki', 'Noto Sans Khojki', 'ltr'],
  ['Sharada', 'Noto Sans Sharada', 'ltr'], ['Siddham', 'Noto Sans Siddham', 'ltr'], ['Grantha', 'Grantha Sangam MN', 'ltr'], ['Tibetan', 'Kokonor', 'ltr'],
  ['Tibetan', 'Kailasa', 'ltr'], ['Myanmar', 'Noto Sans Myanmar', 'ltr'], ['Khmer', 'Khmer MN', 'ltr'], ['Lao', 'Lao MN', 'ltr'], ['Thai', 'Thonburi', 'ltr'],
  ['Thaana', 'Noto Sans Thaana', 'rtl'], ['Newa', 'Noto Sans Newa', 'ltr'], ['Tirhuta', 'Noto Sans Tirhuta', 'ltr'], ['Modi', 'Noto Sans Modi', 'ltr'],
  ['Takri', 'Noto Sans Takri', 'ltr'], ['Kaithi', 'Noto Sans Kaithi', 'ltr'], ['Lepcha', 'Noto Sans Lepcha', 'ltr'], ['Limbu', 'Noto Sans Limbu', 'ltr'],
  ['Buginese', 'Noto Sans Buginese', 'ltr'], ['Batak', 'Noto Sans Batak', 'ltr'], ['Sundanese', 'Noto Sans Sundanese', 'ltr'], ['Rejang', 'Noto Sans Rejang', 'ltr'],
  ['Kayah_Li', 'Noto Sans Kayah Li', 'ltr'], ['Tai_Viet', 'Noto Sans Tai Viet', 'ltr'], ['Meetei_Mayek', 'Noto Sans Meetei Mayek', 'ltr'], ['Ol_Chiki', 'Noto Sans Ol Chiki', 'ltr'],
  ['Gunjala_Gondi', 'Noto Sans Gunjala Gondi', 'ltr'], ['Masaram_Gondi', 'Noto Sans Masaram Gondi', 'ltr'], ['Ahom', 'Noto Serif Ahom', 'ltr'], ['Wancho', 'Noto Sans Wancho', 'ltr'],
  ['Nag_Mundari', 'Noto Sans Nag Mundari', 'ltr'], ['Sinhala', 'Sinhala MN', 'ltr'], ['Malayalam', 'Malayalam MN', 'ltr'], ['Tamil', 'Tamil MN', 'ltr'], ['Telugu', 'Kohinoor Telugu', 'ltr'],
  ['Kannada', 'Noto Sans Kannada', 'ltr'], ['Oriya', 'Noto Sans Oriya', 'ltr'], ['Gujarati', 'Kohinoor Gujarati', 'ltr'], ['Gurmukhi', 'Gurmukhi MN', 'ltr'], ['Bengali', 'Kohinoor Bangla', 'ltr'],
  ['Armenian', 'Noto Sans Armenian', 'ltr'], ['Georgian', '!sans-serif', 'ltr'], ['Ethiopic', 'Kefa III', 'ltr'], ['Cherokee', 'Plantagenet Cherokee', 'ltr'],
  ['Canadian_Aboriginal', 'Euphemia UCAS', 'ltr'], ['Yi', 'Noto Sans Yi', 'ltr'], ['Vai', 'Noto Sans Vai', 'ltr'], ['Egyptian_Hieroglyphs', 'Noto Sans Egyptian Hieroglyphs', 'ltr'],
]

function groups(): Group[] {
  if (process.env['WORD_SCAN_SCRIPTS_CONTROL'] === '1') return [{ name: 'control', words: ['xq', 'axqi', 'hello'], families: ['Arial'], sizes: [16], lang: 'en', direction: 'ltr' }]
  const THAI = ['Thonburi', 'Ayuthaya', 'Krungthep', 'Sathu', 'Silom', 'Sukhumvit Set', 'Tahoma', 'Arial Unicode MS', 'Microsoft Sans Serif', 'Arial', 'Times New Roman', ...SANS]
  const all: Group[] = [
    { name: 'thai', words: tokens(['th-nithan-vetal-story-1', 'th-nithan-vetal-story-7'], 2400), families: THAI, sizes: [11, 16, 23, 37], lang: 'th', direction: 'ltr', wordBreaks: ['normal', 'break-all'] },
    { name: 'thai-bold', words: tokens(['th-nithan-vetal-story-1'], 400), families: THAI, sizes: [16], lang: 'th', direction: 'ltr', variants: [BOLD, ITALIC, BOLD_ITALIC] },
    {
      name: 'lao', words: ['ສະບາຍດີ', 'ພາສາລາວເປັນພາສາທາງການຂອງປະເທດລາວ', 'ຂ້ອຍຮັກເຈົ້າຫຼາຍໆ', 'ປະເທດລາວ', 'ນະຄອນຫຼວງວຽງຈັນ', 'ຂອບໃຈຫຼາຍໆ', 'ສາທາລະນະລັດ', 'ປະຊາທິປະໄຕ', 'ປະຊາຊົນລາວ', 'ຫຼວງພະບາງ', 'ແມ່ນ້ຳຂອງ', 'ເຂົ້າໜຽວ'],
      families: ['Lao MN', 'Lao Sangam MN', 'Arial Unicode MS', ...SANS], sizes: [11, 16, 23, 37, 61], lang: 'lo', direction: 'ltr', wordBreaks: ['normal', 'break-all'],
    },
    { name: 'khmer', words: tokens(['km-prachum-reuang-preng-khmer-volume-7-stories-1-10'], 1200), families: ['Khmer MN', 'Khmer Sangam MN', 'Arial Unicode MS', 'Arial', ...SANS], sizes: [11, 16, 23, 37], lang: 'km', direction: 'ltr', wordBreaks: ['normal', 'break-all'], labFacts: true },
    { name: 'myanmar', words: tokens(['my-cunning-heron-teacher', 'my-bad-deeds-return-to-you-teacher'], 600), families: ['Myanmar MN', 'Myanmar Sangam MN', 'Noto Sans Myanmar', 'Noto Serif Myanmar', 'Arial Unicode MS', ...SANS], sizes: [11, 16, 23, 37], lang: 'my', direction: 'ltr', wordBreaks: ['normal', 'break-all'] },
    { name: 'hindi', words: tokens(['hi-eidgah'], 2500), families: ['Kohinoor Devanagari', 'Devanagari MT', 'Devanagari Sangam MN', 'ITF Devanagari', 'Shree Devanagari 714', 'Arial Unicode MS', 'Arial', ...SANS], sizes: [13, 16, 29], lang: 'hi', direction: 'ltr', labFacts: true },
    { name: 'urdu', words: tokens(['ur-chughd'], 2500), families: ['Noto Nastaliq Urdu', 'Geeza Pro', 'Waseem', 'Farisi', 'DecoType Naskh', 'Damascus', 'Arial', 'Times New Roman', 'Tahoma', ...SANS], sizes: [13, 16, 29], lang: 'ur', direction: 'rtl', labFacts: true },
    {
      name: 'arabic', words: tokens(['ar-al-bukhala', 'ar-risalat-al-ghufran-part-1'], 2500),
      families: ['Geeza Pro', 'Noto Nastaliq Urdu', 'Amiri', 'Noto Naskh Arabic', 'Al Bayan', 'Baghdad', 'Damascus', 'DecoType Naskh', 'Diwan Kufi', 'Diwan Thuluth', 'Farah', 'Farisi', 'KufiStandardGK', 'Mishafi', 'Mishafi Gold', 'Nadeem', 'Sana', 'Waseem', 'Al Nile', 'Al Tarikh', 'Beirut', 'Muna', 'Arial', 'Times New Roman', 'Courier New', 'Tahoma', 'Arial Unicode MS', 'Microsoft Sans Serif', ...SANS],
      sizes: [13, 16, 29], lang: 'ar', direction: 'rtl', labFacts: true,
    },
    { name: 'arabic-styles', words: tokens(['ar-al-bukhala'], 300), families: ['Geeza Pro', 'Noto Nastaliq Urdu', 'Diwan Thuluth', 'Farisi', 'Mishafi', 'Waseem', 'Amiri', 'Arial'], sizes: [9, 20, 48, 96], lang: 'ar', direction: 'rtl', variants: [REGULAR, BOLD, ITALIC] },
    // Words ending in alef and tanween (and a few others), where HarfBuzz gives 20px-and-up Mishafi and Diwan Thuluth a
    // negative tail: after a ligature the tanween takes back more than its own advance (hb-shape 14.2 over Mishafi.ttf:
    // 'صلاحاً' is 813, 801, 1081 and -120 of 2048 per cluster, and the alef starts a grapheme inside the 1081 ligature).
    // Firefox's own premise is checked for each (`native`).
    {
      name: 'arabic-tanween', words: ARABIC_TANWEEN,
      families: ['Mishafi', 'Mishafi Gold', 'Diwan Thuluth', 'Geeza Pro', 'Farisi', 'Waseem', 'DecoType Naskh', 'Noto Nastaliq Urdu', 'Al Bayan', 'Baghdad', 'Damascus', 'KufiStandardGK', 'Diwan Kufi', 'Arial', 'Times New Roman', '!serif'],
      sizes: [11, 13, 16, 20, 23, 29, 37, 48, 61, 96], lang: 'ar', direction: 'rtl', native: true, labFacts: true,
    },
    { name: 'hebrew', words: tokens(['he-masaot-binyamin-metudela'], 2000), families: ['Arial Hebrew', 'Arial Hebrew Scholar', 'Corsiva Hebrew', 'New Peninim MT', 'Raanana', 'Times New Roman', 'Arial', 'Lucida Grande', ...SANS], sizes: [13, 16, 29], lang: 'he', direction: 'rtl', labFacts: true },
    { name: 'korean', words: tokens(['ko-sonagi', 'ko-unsu-joh-eun-nal'], 2000), families: ['Apple SD Gothic Neo', 'AppleMyungjo', 'AppleGothic', 'Arial Unicode MS', ...SANS], sizes: [13, 16, 29], lang: 'ko', direction: 'ltr', wordBreaks: ['normal', 'break-all'] },
    { name: 'cjk', words: [...pieces(['ja-rashomon', 'ja-kumo-no-ito'], 24, 150), ...pieces(['zh-zhufu', 'zh-guxiang'], 24, 150)], families: ['Hiragino Sans', 'Hiragino Mincho ProN', 'Hiragino Kaku Gothic ProN', 'PingFang SC', 'Songti SC', 'STSong', 'Heiti SC', 'Kaiti SC', 'Arial', ...SANS], sizes: [13, 16, 29], lang: 'ja', direction: 'ltr' },
    {
      name: 'cjk-latin', words: ['iPhone用户', '使用Chrome浏览器', '東京2020オリンピック', '第3回', 'Unicode標準', '日本語English混在', '한국어Korean', 'Wi-Fi接続', '「OK」', 'ＡＢＣ全角', 'ｶﾀｶﾅ', 'HTML5と CSS3', '価格は¥12,800です', '「了解です」', 'AI技術', '100%纯天然', 'GPU加速', 'macOS用', 'Emacs派', 'Vim派'],
      families: ['Hiragino Sans', 'PingFang SC', 'Songti SC', 'Apple SD Gothic Neo', 'Arial', 'Helvetica Neue', 'Times New Roman', ...SANS], sizes: [11, 16, 23, 37, 61], lang: 'ja', direction: 'ltr', wordBreaks: ['normal', 'break-all'], labFacts: true,
    },
    {
      name: 'tibetan', words: ['བོད་ཡིག་ནི་བོད་པའི་ཡི་གེ་ཡིན།', 'ང་བོད་པ་ཡིན།', 'བཀྲ་ཤིས་བདེ་ལེགས།', 'སྐད་ཡིག', 'རྒྱ་མཚོ', 'སྤྱི་ཚོགས', 'བསྒྲུབས', 'ཀློག', 'ཧཱུྃ', 'ཨོཾ་མ་ཎི་པདྨེ་ཧཱུྃ'],
      families: ['Kokonor', 'Kailasa', 'Arial Unicode MS', ...SANS], sizes: [11, 16, 23, 37, 61], lang: 'bo', direction: 'ltr',
    },
    {
      name: 'mongolian', words: ['ᠮᠣᠩᠭᠣᠯ', `ᠮᠣᠩᠭᠣᠯ${c(0x202f)}ᠤᠨ`, `ᠬᠠᠷᠠ${c(0x180e)}ᠠ`, `ᠭ${c(0x180b)}ᠠ`, 'ᠪᠢᠴᠢᠭ', 'ᠤᠯᠤᠰ', 'ᠬᠡᠯᠡ', `ᠨᠣᠮ${c(0x202f)}ᠢ`, 'ᠰᠠᠢᠨ', `ᠪᠠᠢᠨ${c(0x180e)}ᠠ`],
      families: ['Noto Sans Mongolian', 'Arial Unicode MS', ...SANS], sizes: [11, 16, 23, 37, 61], lang: 'mn', direction: 'ltr',
    },
    {
      name: 'emoji', words: [c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466), c(0x1f3f3, 0xfe0f, 0x200d, 0x1f308), c(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb), c(0x31, 0xfe0f, 0x20e3),
        `a${c(0x1f44d, 0x1f3fd)}b`, `${c(0x1f600)}${c(0x1f600)}${c(0x1f600)}`, `ok${c(0x1f44c)}`, c(0x1f1fa, 0x1f1f8, 0x1f1ec, 0x1f1e7), `x${c(0x1f600)}y`, `${c(0x2764, 0xfe0f)}${c(0x1f525)}`, `${c(0x263a)}${c(0x263a, 0xfe0f)}`,
        `wow${c(0x1f389)}${c(0x1f389)}`, `${c(0x1f9d1, 0x200d, 0x1f91d, 0x200d, 0x1f9d1)}`, `${c(0x1f44b, 0x1f3ff)}hi`, `${c(0x1f4a9)}.`],
      families: ['Apple Color Emoji', 'Arial', 'Helvetica Neue', 'Times New Roman', ...SANS], sizes: [9, 11, 13, 16, 19, 23, 29, 37, 48, 61, 77, 96], lang: 'en', direction: 'ltr', variants: [REGULAR, BOLD],
    },
    { name: 'english', words: tokens(['en-gatsby-opening'], 3500), families: LATIN_FAMILIES, sizes: [16], lang: 'en', direction: 'ltr', labFacts: true },
    { name: 'english-split-sizes', words: tokens(['en-gatsby-opening', 'mixed-app-text'], 2500), families: SPLIT, sizes: [9, 11, 13, 19, 29, 37, 48, 61, 77, 96], lang: 'en', direction: 'ltr', labFacts: true },
    { name: 'english-styles', words: tokens(['en-gatsby-opening'], 800), families: ['Helvetica Neue', 'Times New Roman', 'Hoefler Text', 'Apple Chancery', 'Zapfino', 'Marker Felt', 'Superclarendon', 'Georgia', 'Skia', 'Monaspace Neon Var', 'Avenir Next'], sizes: [13, 23], lang: 'en', direction: 'ltr', variants: [BOLD, ITALIC, BOLD_ITALIC, { weight: 100, style: 'normal' }, { weight: 900, style: 'normal' }], labFacts: true },
    // Variable faces reached through plain CSS weights and styles (no variation settings): Skia's legacy kern table does
    // not vary, so at its light and condensed instances a pair takes back more than a narrow glyph has (hb-shape at wght
    // 0.48). Firefox's own premise is checked for each (`native`).
    {
      name: 'variable-weights', words: [...tokens(['en-gatsby-opening'], 60000).filter(w => /[.,][\u2019\u201d]$|[\u2019\u201d][.,]$|[VYPFTWL][.,]$/.test(w)).slice(0, 300), ...tokens(['en-gatsby-opening'], 300)],
      families: ['Skia', '!system-ui', 'Monaspace Neon Var', 'Monaspace Xenon Var', 'Avenir Next', 'Helvetica Neue', 'Kohinoor Devanagari'], sizes: [11, 16, 23, 37], lang: 'en', direction: 'ltr',
      variants: [{ weight: 100, style: 'normal' }, { weight: 200, style: 'normal' }, { weight: 300, style: 'normal' }, REGULAR, { weight: 500, style: 'normal' }, BOLD, { weight: 900, style: 'normal' }, ITALIC], native: true,
    },
    { name: 'mixed', words: tokens(['mixed-app-text'], 300), families: ['Helvetica Neue', 'Arial', 'Times New Roman', 'Hiragino Sans', 'Geeza Pro', ...SANS], sizes: [11, 16, 23, 37], lang: 'en', direction: 'ltr', labFacts: true },
  ]
  for (let s = 0; s < NOTO_SCRIPTS.length; s++) {
    const [script, family, direction] = NOTO_SCRIPTS[s]!
    all.push({ name: `made-up-${script}-${family}`, words: madeUp(script, 120, 7 + s), families: [family, '!sans-serif'], sizes: [13, 23], lang: 'und', direction })
  }
  if (process.env['WORD_SCAN_SCRIPTS_WEBFONTS'] === '1') {
    const quoted = tokens(['en-gatsby-opening'], 60000).filter(w => /[.,][\u2019\u201d]$|[\u2019\u201d][.,]$/.test(w)).slice(0, 400)
    const pairs: string[] = []
    const P = `'".,-:;!?()/\\*AVWTYLPFJrfyvwaoe17\u2019\u201d\u201c`
    for (let a = 0; a < P.length; a++) for (let b = 0; b < P.length; b++) pairs.push(`n${P[a]!}${P[b]!}`)
    all.length = 0
    const made = ['y.', 'baby.', 'Gatsby.', 'f,', 'stuff,', 'a.', 'area.', 'Vq', 'aVq', 'Vqa', 'abc', 'yes', 'y.y.']
    all.push({ name: 'webfont-skia', words: [...made, ...quoted, ...pairs], families: WEBFONTS.map(font => font.family), sizes: [11, 16, 23, 37, 61, 96], lang: 'en', direction: 'ltr', native: true })
  }
  const keep = process.env['WORD_SCAN_SCRIPTS_GROUPS']?.split(',') ?? null
  const limit = Number(process.env['WORD_SCAN_SCRIPTS_LIMIT'] ?? Number.POSITIVE_INFINITY)
  return all.filter(group => keep === null || keep.some(name => group.name === name || group.name.startsWith(`${name}-`))).map(group => ({ ...group, words: group.words.slice(0, limit) }))
}

// The families' facts as the lab gives them, per variant, keyed by `family|weight|style`.
function labFactsOf(list: Group[]): Record<string, FontFacts> {
  const out: Record<string, FontFacts> = {}
  for (let g = 0; g < list.length; g++) {
    const group = list[g]!
    if (group.labFacts !== true) continue
    const variants = group.variants ?? [REGULAR]
    for (let f = 0; f < group.families.length; f++) {
      const family = group.families[f]!
      const css = family.startsWith('!') ? family.slice(1) : `"${family}"`
      for (let v = 0; v < variants.length; v++) {
        const key = `${family}|${variants[v]!.weight}|${variants[v]!.style}`
        if (out[key] !== undefined) continue
        const facts = fontFactsFor({ family: css, size: 16, weight: variants[v]!.weight, style: variants[v]!.style }, 'gecko', FIXTURES)
        if (JSON.stringify(facts) !== JSON.stringify(UNKNOWN_FONT_FACTS)) out[key] = facts
      }
    }
  }
  return out
}

const PAGE = String.raw`
const lib = LIB;
const webfonts = [];
for (let i = 0; i < WEBFONTS.length; i++) {
  const wf = WEBFONTS[i];
  const record = { family: wf.family, source: wf.bytes ? 'bytes' : wf.source, variationSettings: wf.variationSettings, status: null, error: null, widths: null };
  try {
    const descriptors = wf.variationSettings === null ? {} : { variationSettings: wf.variationSettings };
    let source = wf.source;
    if (wf.bytes) { const raw = atob(wf.bytes); const buffer = new Uint8Array(raw.length); for (let k = 0; k < raw.length; k++) buffer[k] = raw.charCodeAt(k); source = buffer.buffer; }
    const face = new FontFace(wf.family, source, descriptors);
    document.fonts.add(face);
    await face.load();
    record.status = face.status;
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    const widths = {};
    const probeText = ['baby.”', '.”', '”', '.', 'baby'];
    for (const f of [wf.family, 'Skia']) { ctx.font = '96px "' + f + '"'; widths[f] = probeText.map(t => ctx.measureText(t).width); }
    record.widths = widths;
  } catch (error) {
    record.error = String(error && error.message || error);
  }
  webfonts.push(record);
}
const env = lib.environment();
const HIGH = 60 * 6000;
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, webfonts, groups: [], failures: [], nativeFailures: [], errors: [] };
let calls = 0;
const proto = OffscreenCanvasRenderingContext2D.prototype;
const measureText = proto.measureText;
proto.measureText = function (text) {
  calls++;
  const metrics = measureText.call(this, text);
  if (!CONTROL) return metrics;
  const back = 20 * (text.split('q').length - 1);
  return { width: metrics.width - back, actualBoundingBoxLeft: metrics.actualBoundingBoxLeft, actualBoundingBoxRight: metrics.actualBoundingBoxRight - back };
};
// Native lines of the spec at a width in au: the line index of each code point's first positive rect.
const nativeLines = (s, widthAu) => {
  const div = document.createElement('div');
  div.lang = s.lang;
  div.dir = s.direction;
  div.style.cssText = 'margin:0;padding:0;border:0;white-space:normal;font-kerning:auto;text-rendering:auto;font-synthesis:weight style;'
    + 'font-family:' + s.family + ';font-size:' + s.size + 'px;font-weight:' + s.weight + ';font-style:' + s.style + ';line-height:' + (2 * s.size) + 'px;'
    + 'overflow-wrap:' + s.overflowWrap + ';word-break:' + s.wordBreak + ';width:' + (widthAu / 60) + 'px;letter-spacing:' + (s.letterSpacing || 0) + 'px;word-spacing:' + (s.wordSpacing || 0) + 'px';
  div.textContent = s.text;
  host.appendChild(div);
  const box = div.getBoundingClientRect();
  const node = div.firstChild;
  const range = document.createRange();
  const starts = [];
  let last = -1;
  const clusters = [...new Intl.Segmenter(s.lang === 'und' ? 'en' : s.lang, { granularity: 'grapheme' }).segment(node.data)];
  for (let c = 0; c < clusters.length; c++) {
    const from = clusters[c].index, to = from + clusters[c].segment.length;
    let line = null;
    for (let i = from; i < to && line === null;) {
      const length = node.data.codePointAt(i) > 0xffff ? 2 : 1;
      range.setStart(node, i);
      range.setEnd(node, i + length);
      const rects = range.getClientRects();
      for (let r = 0; r < rects.length; r++) {
        if (rects[r].width <= 0 && rects[r].height <= 0) continue;
        line = Math.floor((rects[r].top + rects[r].height / 2 - box.top) / (2 * s.size));
        break;
      }
      i += length;
    }
    if (line !== null && line !== last) { starts.push(from + ':' + line); last = line; }
  }
  const lines = Math.round(box.height / (2 * s.size));
  host.removeChild(div);
  return { lines, starts: starts.join(' ') };
};
// The word's native advance in au: a span of it on one line, as Firefox paints it.
const nativeAdvance = (s) => {
  const span = document.createElement('span');
  span.lang = s.lang;
  span.dir = s.direction;
  span.style.cssText = 'margin:0;padding:0;border:0;white-space:nowrap;font-kerning:auto;text-rendering:auto;font-synthesis:weight style;'
    + 'font-family:' + s.family + ';font-size:' + s.size + 'px;font-weight:' + s.weight + ';font-style:' + s.style + ';letter-spacing:' + (s.letterSpacing || 0) + 'px;word-spacing:' + (s.wordSpacing || 0) + 'px';
  span.textContent = s.text;
  host.appendChild(span);
  const width = span.getBoundingClientRect().width;
  host.removeChild(span);
  return Math.round(width * 60);
};
for (let g = 0; g < GROUPS.length; g++) {
  const group = GROUPS[g];
  const variants = group.variants || [{ weight: 400, style: 'normal' }];
  const wordBreaks = group.wordBreaks || ['normal'];
  for (let f = 0; f < group.families.length; f++) {
    const name = group.families[f];
    const family = name[0] === '!' ? name.slice(1) : '"' + name + '"';
    for (let v = 0; v < variants.length; v++) {
      const variant = variants[v];
      const factSets = [['unknown', UNKNOWN]];
      const lab = FACTS[name + '|' + variant.weight + '|' + variant.style];
      if (group.labFacts && lab !== undefined) factSets.push(['lab', lab]);
      for (let k = 0; k < factSets.length; k++) {
        const counts = { group: group.name, family: name, weight: variant.weight, style: variant.style, facts: factSets[k][0], installed: document.fonts.check('16px ' + family), words: 0, searched: 0, gaps: 0, falseGaps: 0, wrongLines: 0, nativeChecked: 0, nativeBroken: 0, nativeBrokenPortOne: 0, calls: 0 };
        try {
          for (let b = 0; b < wordBreaks.length; b++) {
            for (let s = 0; s < group.sizes.length; s++) {
              for (let w = 0; w < group.words.length; w++) {
                counts.words++;
                const spec = { family, size: group.sizes[s], weight: variant.weight, style: variant.style, facts: factSets[k][1], text: group.words[w], lang: group.lang, direction: group.direction, overflowWrap: 'break-word', wordBreak: wordBreaks[b] };
                const T = lib.oneLineFrom(env, spec, HIGH);
                if (T === null) continue;
                counts.searched++;
                const inspected = lib.layAt(env, spec, T, true);
                if (NATIVE || group.native) {
                  // The premise in Firefox itself: the word laid out at its own native advance A (and A + 1 au) under
                  // break-word gives one line unless some prefix is wider than the word.
                  const A = nativeAdvance(spec);
                  counts.nativeChecked++;
                  const atA = nativeLines(spec, A);
                  if (atA.lines > 1 && nativeLines(spec, A + 1).lines > 1) {
                    counts.nativeBroken++;
                    let lo = A + 1, hi = A + 60 * 200;
                    if (nativeLines(spec, hi).lines === 1) { while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (nativeLines(spec, mid).lines === 1) hi = mid; else lo = mid; } } else hi = null;
                    const portAtA = lib.layAt(env, spec, A, true);
                    if (portAtA.starts.length === 1) counts.nativeBrokenPortOne++;
                    if (out.nativeFailures.length < 3000) out.nativeFailures.push({ group: group.name, family: name, facts: factSets[k][0], size: spec.size, weight: spec.weight, style: spec.style, wordBreak: spec.wordBreak, text: spec.text,
                      codePoints: Array.from(spec.text).map((ch) => ch.codePointAt(0).toString(16)).join(' '), A, nativeOneLineFrom: hi, portT: T, nativeAtA: atA, portAtA: portAtA.ranges, portGapsAtA: portAtA.gaps, portPlainAtA: lib.layAt(env, spec, A, false).ranges });
                  }
                }
                if (inspected.gaps.length === 0) continue;
                counts.gaps++;
                const native = nativeLines(spec, T);
                if (native.lines === 1) counts.falseGaps++;
                else counts.wrongLines++;
                if (out.failures.length < 2000) out.failures.push({ group: group.name, family: name, facts: factSets[k][0], size: spec.size, weight: spec.weight, style: spec.style, wordBreak: spec.wordBreak, text: spec.text,
                  codePoints: Array.from(spec.text).map((ch) => ch.codePointAt(0).toString(16)).join(' '), T, inspected: inspected.ranges, plain: lib.layAt(env, spec, T, false).ranges, gap: inspected.gaps[0], native });
              }
            }
          }
        } catch (error) {
          out.errors.push({ group: group.name, family: name, error: String(error && error.stack || error) });
        }
        counts.calls = calls; calls = 0;
        out.groups.push(counts);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
}
proto.measureText = measureText;
return out;
`

export default async function wordScanScriptsProbes(): Promise<Probe[]> {
  const control = process.env['WORD_SCAN_SCRIPTS_CONTROL'] === '1'
  const list = groups()
  const facts = labFactsOf(list)
  const lib = `${await bundleOf(resolve(import.meta.dir, '../src'))}\nconst LIB = globalThis.wordScanScriptsProbe;\n`
  const words = list.reduce((n, group) => n + group.words.length * group.families.length * group.sizes.length * (group.variants?.length ?? 1) * (group.wordBreaks?.length ?? 1), 0)
  console.log(`[word-scan-scripts-probe] ${list.length} groups, ${words} word layouts before lab facts; lab facts for ${Object.keys(facts).length} family variants`)
  return [{
    id: 'word-scan P2', spec: "Gecko's word scan: each word at the width of its own advance, inspected, over scripts and fonts the first probe leaves out", pageLang: 'en', html: '<div></div>',
    fontFixtures: FIXTURES,
    observe: [{ kind: 'script', source: `${lib}const CONTROL = ${control};\nconst NATIVE = ${process.env['WORD_SCAN_SCRIPTS_NATIVE'] === '1'};\nconst WEBFONTS = ${JSON.stringify(process.env['WORD_SCAN_SCRIPTS_WEBFONTS'] === '1' ? WEBFONTS.map(font => font.bytes === undefined ? font : { ...font, bytes: Buffer.from(font.bytes === 'generated:negative-tail' ? negativeTailFont() : readFileSync(font.bytes)).toString('base64') }) : [])};\nconst UNKNOWN = ${JSON.stringify(UNKNOWN_FONT_FACTS)};\nconst FACTS = ${JSON.stringify(facts)};\nconst GROUPS = ${JSON.stringify(list)};\n${PAGE}` }], browsers: ['firefox'],
  }]
}
