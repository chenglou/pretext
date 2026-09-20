// Wide-group cuts (prefix 'cuts/'). The Blink port measures a shaping group of 256 zoomed px or more in pieces, because a
// Canvas total is exact only below that (engines/blink/shape.ts addPieces), and the pieces add up to the group only where
// the two sides of a cut change nothing in each other. These cases put a line's end within half a px of where the browser
// fits it, in texts whose cuts fall where shaping crosses them: ligatures and contextual forms inside unbroken words, kerning
// inside words and at spaces, joined Arabic and Indic letters, letter and word spacing, soft hyphens, combining marks,
// emoji sequences and the edges of an inline box. On 2026-09-20 a form of the port that picked its cuts without asking
// Canvas moved lines in 1,158 of the first 22,536 of them (Futura, Baskerville, Zapfino, Apple Chancery) where no other set
// of the tiers held one such text (research/PROFILING-START.md item 6). Never launches a browser.
//
// The widths come from the browser, so there are two passes:
//   bun rebuild/lab/cases/wide-group-cuts.ts pass1 [--out=FILE]
//     every variant (a text in a font at a size, Latin ones with 0 to 3 letters in front so the cuts land on other offsets)
//     on one line; run it in pinned Chrome (lab/run.ts --browser=chrome --cases=FILE) for the browser's code point rects;
//   bun rebuild/lab/cases/wide-group-cuts.ts pass2 --rows=<pass 1's chrome-rows.ndjson> [--one-each] [--seed=S] [--out=FILE]
//     per variant three break candidates at 56%, 68% and 80% of the text, so the first line holds the first cut, and per
//     candidate eight container widths around the browser's own width of the text before it: -0.5, -0.25, -1/16, -1/64,
//     0, +1/16, +0.25 and +0.5 px. A variant whose font the page couldn't resolve is left out. --one-each keeps one case
//     of every variant, drawn with the seed; without it every case is kept.
//
// Default outs .artifacts/lab/cases/wide-group-cuts-pass1.ndjson and .artifacts/lab/cases/wide-group-cuts.ndjson; pass 2
// writes `<out>.summary.json` with the family counts next to it. The tier set `wide-group-cuts` is pass 2 with
// --one-each and the default seed, `wide-group-cuts-1`: 2,159 cases of the 51,816.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Case, Paragraph } from '../types.ts'
import { el, font, leaf, treeParagraph, type BlockSpec, type TreePart } from './build.ts'
import { countFamilies, makeCase, mergeCases, sortCases } from './case.ts'
import { createRng } from './prng.ts'

type Wrap = 'normal' | 'break-all' | 'anywhere'
// Where a line may end: before a space, after a hyphen, or before any code point that has a width.
type Breaks = 'space' | 'hyphen' | 'any'
type Text = {
  name: string
  text: string
  wrap: Wrap
  breaks: Breaks
  lang: string
  direction: 'ltr' | 'rtl'
  fonts: readonly string[]
  sizes: readonly number[]
  // The letter put in front 0 to `rotations - 1` times.
  rotate: string
  rotations: number
  letterSpacing?: number
  wordSpacing?: number
  // The text's parts around an inline box, for a text that has one: the box holds the text from `boxStart` to `boxEnd`.
  box?: { start: number; end: number; padding: number }
}

const SHY = String.fromCodePoint(0xad)
const ACUTE = String.fromCodePoint(0x301)
const TILDE = String.fromCodePoint(0x303)
const ZWJ = String.fromCodePoint(0x200d)
const VS16 = String.fromCodePoint(0xfe0f)
const THUMB = String.fromCodePoint(0x1f44d, 0x1f3fd)
const FAMILY = String.fromCodePoint(0x1f468) + ZWJ + String.fromCodePoint(0x1f469) + ZWJ + String.fromCodePoint(0x1f467)
const FLAG = String.fromCodePoint(0x1f1ef, 0x1f1f5)
const KEYCAP = `1${VS16}${String.fromCodePoint(0x20e3)}`

// The first survey's fonts (twelve Latin, four Arabic), then every other installed family in which Canvas measures some
// ligature, contextual or kerning string otherwise than the sum of its letters (the survey of 2026-09-20, 164 families).
const LATIN = ['Hoefler Text', 'Georgia', 'Times New Roman', 'Helvetica Neue', 'Arial', 'Zapfino', 'Snell Roundhand', 'Apple Chancery', 'SignPainter', 'Baskerville', 'Avenir Next', 'Futura']
const LATIN_MORE = ['Chalkduster', 'Marker Felt', 'Noteworthy', 'Chalkboard SE', 'Skia', 'Seravek', 'Papyrus', 'Trattatello', 'Superclarendon', 'STIX Two Text',
  'American Typewriter', 'Rockwell', 'Tahoma', 'Kefa', 'Athelas', 'Didot', 'Palatino', 'Times', 'Optima', 'Cochin', 'Big Caslon', 'Iowan Old Style', 'PT Sans', 'PT Serif',
  'Gill Sans', 'Arial Black', 'Arial Narrow', 'DIN Alternate', 'Lucida Grande', 'Geneva', 'Brush Script MT', 'Avenir', 'Helvetica', 'Hiragino Sans', 'Kohinoor Devanagari',
  'Sukhumvit Set', 'Verdana', 'Charter', 'Trebuchet MS', 'Impact', 'Marion', 'Luminari', 'Herculanum', 'Phosphate']
const LATIN_FEW = ['Futura', 'Baskerville', 'Zapfino', 'Apple Chancery', 'Hoefler Text', 'Helvetica Neue', 'Times New Roman', 'Avenir Next']
const ARABIC = ['Geeza Pro', 'DecoType Naskh', 'Al Nile', 'Damascus']
const ARABIC_MORE = ['Al Bayan', 'Baghdad', 'Mishafi', 'Nadeem', 'Sana', 'KufiStandardGK', 'Farah', 'Farisi', 'Diwan Kufi', 'Diwan Thuluth', 'Muna', 'Beirut', 'Waseem', 'Al Tarikh',
  'Tahoma', 'Arial', 'Times New Roman', 'Noto Nastaliq Urdu']
const DEVANAGARI = ['Kohinoor Devanagari', 'Devanagari Sangam MN', 'ITF Devanagari']
const SIZES = [16, 26, 40]
const TWO_SIZES = [16, 40]

const LIGATURES = 'difficultofficeafflictionshufflingwaffleaffinitysufficientbaffledoffloadcoffinstaffing'
const LIGATURE_WORDS = 'The difficult office staff shuffled baffling waffles efficiently affirming the afflicted coffin offload'
const HYPHENATED = 'office-affiliate-traffic-waffle-Toyota-AVATAR-suffix-efficient-WAVY-offload-baffle-Tokyo-YAWL-staffing'
const KERNING_AT_SPACES = 'AT VA TO WA YA AV LT PA FA TA VA WAY TAY AVA YAT TOY VAT WAT LY TY PAT'
const ARABIC_SPACES = 'هذا نص عربي طويل لاختبار قياس النص عندما يكون أطول من مئتين وستة وخمسين بكسل في المتصفح'
const ARABIC_UNBROKEN = 'فسيكفيكهماللهوالمستشفياتالجامعيةوالاستقلاليةالاقتصادية'
const HINDI_SPACES = 'यह हिंदी में एक लंबा वाक्य है जो पाठ माप की जांच के लिए लिखा गया है और इसमें संयुक्ताक्षर हैं'
const HINDI_UNBROKEN = 'विश्वविद्यालयअंतर्राष्ट्रीयप्रौद्योगिकीसंस्थानस्वतंत्रताकार्यक्रम'

function latin(name: string, text: string, wrap: Wrap, breaks: Breaks, rotate: string, fonts: readonly string[], sizes: readonly number[], rotations: number): Text {
  return { name, text, wrap, breaks, lang: 'en', direction: 'ltr', fonts, sizes, rotate, rotations }
}

function script(name: string, text: string, wrap: Wrap, lang: string, direction: 'ltr' | 'rtl', fonts: readonly string[], sizes: readonly number[]): Text {
  return { name, text, wrap, breaks: wrap === 'normal' && text.includes(' ') ? 'space' : 'any', lang, direction, fonts, sizes, rotate: '', rotations: 1 }
}

// `mark` after every `every`-th letter of the text's words, from the `first`.
function marked(text: string, mark: string, first: number, every: number): string {
  let out = ''
  let letters = 0
  for (let i = 0; i < text.length; i++) {
    out += text[i]
    if (text[i] === ' ' || text[i] === '-') continue
    if (letters >= first && (letters - first) % every === 0) out += mark
    letters++
  }
  return out
}

const TEXTS: readonly Text[] = [
  // The first survey (2026-09-20), as it was: the same paragraphs, so the same case ids.
  latin('ligatures-unbroken', LIGATURES, 'break-all', 'any', 'x', LATIN, SIZES, 4),
  latin('ligatures-unbroken-anywhere', 'shufflingofficeaffinitydifficultbaffledwafflesufficientafflictioncoffinstaffingoffload', 'anywhere', 'any', 'x', LATIN, SIZES, 4),
  latin('kerning-unbroken', 'AVAWAYTAVATOYOVAWAKEYAWAVTOTAYLORWAYVATYPEWAVYTOWAYAVOWTAVERNYAWL', 'break-all', 'any', 'H', LATIN, SIZES, 4),
  latin('hyphenated-run', HYPHENATED, 'normal', 'hyphen', 'x', LATIN, SIZES, 4),
  latin('kerning-at-spaces', KERNING_AT_SPACES, 'normal', 'space', 'H', LATIN, SIZES, 4),
  latin('ligature-words', LIGATURE_WORDS, 'normal', 'space', 'x', LATIN, SIZES, 4),
  script('arabic-spaces', ARABIC_SPACES, 'normal', 'ar', 'rtl', ARABIC, SIZES),
  script('arabic-unbroken', ARABIC_UNBROKEN, 'break-all', 'ar', 'rtl', ARABIC, SIZES),
  script('urdu-spaces', 'یہ اردو زبان میں ایک طویل جملہ ہے جو متن کی پیمائش کی جانچ کے لیے لکھا گیا ہے', 'normal', 'ur', 'rtl', ['Noto Nastaliq Urdu', 'Geeza Pro'], SIZES),
  script('hindi-spaces', HINDI_SPACES, 'normal', 'hi', 'ltr', DEVANAGARI, SIZES),
  script('hindi-unbroken', HINDI_UNBROKEN, 'break-all', 'hi', 'ltr', DEVANAGARI, SIZES),
  script('thai', 'ภาษาไทยเป็นภาษาที่มีการเขียนติดกันโดยไม่มีช่องว่างระหว่างคำทำให้การตัดบรรทัดต้องใช้พจนานุกรม', 'break-all', 'th', 'ltr', ['Thonburi', 'Ayuthaya', 'Sathu'], SIZES),
  script('korean-spaces', '한국어 문장은 띄어쓰기가 있어서 줄바꿈이 공백에서 일어나며 글자 너비의 합이 정확한지 확인합니다', 'normal', 'ko', 'ltr', ['Apple SD Gothic Neo', 'AppleMyungjo'], SIZES),
  script('japanese-punctuation', 'あいうえお、「かきくけこ」。（さしすせそ）、「たちつてと」。なにぬねの、（はひふへほ）「まみむめも」。', 'normal', 'ja', 'ltr', ['Hiragino Sans', 'Hiragino Mincho ProN'], SIZES),
  script('myanmar', 'မြန်မာဘာသာစာကြောင်းရှည်တစ်ခုသည်စာသားတိုင်းတာမှုကိုစမ်းသပ်ရန်ဖြစ်သည်', 'break-all', 'my', 'ltr', ['Myanmar MN', 'Myanmar Sangam MN'], SIZES),
  // The second survey: the other families, scripts and features.
  latin('more/ligatures-unbroken', LIGATURES, 'break-all', 'any', 'x', LATIN_MORE, TWO_SIZES, 2),
  latin('more/hyphenated-run', HYPHENATED, 'normal', 'hyphen', 'x', LATIN_MORE, TWO_SIZES, 2),
  latin('more/kerning-at-spaces', KERNING_AT_SPACES, 'normal', 'space', 'H', LATIN_MORE, TWO_SIZES, 2),
  latin('more/ligature-words', LIGATURE_WORDS, 'normal', 'space', 'x', LATIN_MORE, TWO_SIZES, 2),
  script('more/arabic-spaces', ARABIC_SPACES, 'normal', 'ar', 'rtl', ARABIC_MORE, TWO_SIZES),
  script('more/arabic-unbroken', ARABIC_UNBROKEN, 'break-all', 'ar', 'rtl', ARABIC_MORE, TWO_SIZES),
  script('more/hindi-spaces', HINDI_SPACES, 'normal', 'hi', 'ltr', ['Devanagari MT', '"Shree Devanagari 714"'], TWO_SIZES),
  script('more/hindi-unbroken', HINDI_UNBROKEN, 'break-all', 'hi', 'ltr', ['Devanagari MT', '"Shree Devanagari 714"'], TWO_SIZES),
  script('more/bengali-spaces', 'আমি বাংলায় গান গাই আমি বাংলার গান গাই আমি আমার আমিকে চিরদিন এই বাংলায় খুঁজে পাই', 'normal', 'bn', 'ltr', ['Kohinoor Bangla', 'Bangla MN', 'Bangla Sangam MN'], TWO_SIZES),
  script('more/bengali-unbroken', 'বিশ্ববিদ্যালয়আন্তর্জাতিকপ্রযুক্তিস্বাধীনতাকর্মসূচিসংস্কৃতিরাষ্ট্রপতি', 'break-all', 'bn', 'ltr', ['Kohinoor Bangla', 'Bangla MN', 'Bangla Sangam MN'], TWO_SIZES),
  script('more/tamil-spaces', 'தமிழ் மொழி மிகவும் பழமையான மொழிகளில் ஒன்றாகும் இது இந்தியாவிலும் இலங்கையிலும் பேசப்படுகிறது', 'normal', 'ta', 'ltr', ['Tamil MN', 'Tamil Sangam MN', 'InaiMathi'], TWO_SIZES),
  script('more/tamil-unbroken', 'பல்கலைக்கழகம்தொழில்நுட்பம்சுதந்திரம்நிகழ்ச்சிகலாச்சாரம்', 'break-all', 'ta', 'ltr', ['Tamil MN', 'Tamil Sangam MN', 'InaiMathi'], TWO_SIZES),
  script('more/telugu-spaces', 'తెలుగు భాష భారతదేశంలో ఎక్కువగా మాట్లాడే భాషలలో ఒకటి మరియు ఇది ద్రావిడ భాషా కుటుంబానికి చెందినది', 'normal', 'te', 'ltr', ['Kohinoor Telugu', 'Telugu MN'], TWO_SIZES),
  script('more/malayalam-spaces', 'മലയാളം കേരളത്തിലെ പ്രധാന ഭാഷയാണ് ഇത് ദ്രാവിഡ ഭാഷാ കുടുംബത്തിൽ പെടുന്നു എന്ന് പറയപ്പെടുന്നു', 'normal', 'ml', 'ltr', ['Malayalam MN', 'Malayalam Sangam MN'], TWO_SIZES),
  script('more/khmer', 'ភាសាខ្មែរជាភាសាផ្លូវការរបស់ប្រទេសកម្ពុជាដែលមានអក្សរផ្ទាល់ខ្លួនតាំងពីបុរាណកាល', 'break-all', 'km', 'ltr', ['Khmer MN', 'Khmer Sangam MN'], TWO_SIZES),
  script('more/hebrew-points', 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל פְּנֵי תְהוֹם', 'normal', 'he', 'rtl', ['Arial Hebrew', 'New Peninim MT', 'Raanana', 'Corsiva Hebrew', 'Times New Roman'], TWO_SIZES),
  { ...latin('more/letter-spacing-words', LIGATURE_WORDS, 'normal', 'space', 'x', LATIN_FEW, TWO_SIZES, 2), letterSpacing: 1 },
  { ...latin('more/letter-spacing-unbroken', LIGATURES, 'break-all', 'any', 'x', LATIN_FEW, TWO_SIZES, 2), letterSpacing: -0.5 },
  { ...script('more/letter-spacing-arabic', ARABIC_SPACES, 'normal', 'ar', 'rtl', ['Geeza Pro', 'Noto Nastaliq Urdu', 'Al Nile'], TWO_SIZES), letterSpacing: 1 },
  { ...latin('more/word-spacing', KERNING_AT_SPACES, 'normal', 'space', 'H', LATIN_FEW, TWO_SIZES, 2), wordSpacing: 3 },
  latin('more/soft-hyphen-words', LIGATURE_WORDS.replaceAll('ff', `f${SHY}f`), 'normal', 'space', 'x', LATIN_FEW, TWO_SIZES, 2),
  latin('more/soft-hyphen-unbroken', LIGATURES.replaceAll('ff', `f${SHY}f`).replaceAll('le', `l${SHY}e`), 'break-all', 'any', 'x', LATIN_FEW, TWO_SIZES, 2),
  latin('more/marks-words', marked(LIGATURE_WORDS, ACUTE, 2, 5), 'normal', 'space', 'x', LATIN_FEW, TWO_SIZES, 2),
  latin('more/marks-unbroken', marked(marked(LIGATURES, ACUTE, 1, 4), TILDE, 3, 9), 'break-all', 'any', 'x', LATIN_FEW, TWO_SIZES, 2),
  latin('more/emoji-words', `The difficult ${THUMB} office staff ${FAMILY} shuffled baffling ${FLAG} waffles efficiently ${KEYCAP} affirming the afflicted ${THUMB} coffin offload`, 'normal', 'space', 'x', LATIN_FEW, TWO_SIZES, 2),
  latin('more/emoji-unbroken', `difficult${THUMB}office${FAMILY}affliction${FLAG}shuffling${KEYCAP}waffle${THUMB}affinity${FAMILY}sufficient${FLAG}baffled`, 'break-all', 'any', 'x', LATIN_FEW, TWO_SIZES, 2),
  { ...latin('more/box-in-word', LIGATURE_WORDS, 'normal', 'space', 'x', LATIN_FEW, TWO_SIZES, 2), box: { start: 50, end: 57, padding: 6 } },
  { ...latin('more/box-at-spaces', LIGATURE_WORDS, 'normal', 'space', 'x', LATIN_FEW, TWO_SIZES, 2), box: { start: 45, end: 66, padding: 3.3 } },
  { ...latin('more/box-unbroken', LIGATURES, 'break-all', 'any', 'x', LATIN_FEW, TWO_SIZES, 2), box: { start: 40, end: 47, padding: 6 } },
]

type Variant = { t: Text; text: string; family: string; size: number; key: string }

function variants(): Variant[] {
  const out: Variant[] = []
  for (let i = 0; i < TEXTS.length; i++) {
    const t = TEXTS[i]!
    for (let f = 0; f < t.fonts.length; f++) {
      for (let s = 0; s < t.sizes.length; s++) {
        for (let r = 0; r < t.rotations; r++) out.push({ t, text: t.rotate.repeat(r) + t.text, family: t.fonts[f]!, size: t.sizes[s]!, key: `${t.name}|${t.fonts[f]}|${t.sizes[s]}|${r}` })
      }
    }
  }
  return out
}

function caseOf(v: Variant, pass: string, note: string, width: number): Case {
  const t = v.t
  const spec: BlockSpec = {
    font: font(v.family, v.size), lang: t.lang, letterSpacing: t.letterSpacing ?? 0, wordSpacing: t.wordSpacing ?? 0, lineHeight: Math.round(v.size * 1.6),
    wordBreak: t.wrap === 'break-all' ? 'break-all' : 'normal', overflowWrap: t.wrap === 'anywhere' ? 'anywhere' : 'normal', direction: t.direction,
  }
  const shift = v.text.length - t.text.length
  const parts: TreePart[] = t.box === undefined ? [leaf(v.text)]
    : [leaf(v.text.slice(0, t.box.start + shift)), el({ start: { padding: t.box.padding }, end: { padding: t.box.padding } }, leaf(v.text.slice(t.box.start + shift, t.box.end + shift))), leaf(v.text.slice(t.box.end + shift))]
  const tree = treeParagraph(spec, parts)
  const paragraph: Paragraph = { ...tree.paragraph, width }
  return makeCase({ family: `cuts/${pass}/${t.name}`, origin: `generator=wide-group-cuts ${v.key} ${note}`, pageLang: 'en', paragraph, inline: tree.inline, browsers: ['chrome'] })
}

export function generatePass1(): Case[] {
  const cases: Case[] = []
  const all = variants()
  for (let i = 0; i < all.length; i++) cases.push(caseOf(all[i]!, 'pass1', 'one line', 20000))
  return cases
}

type Row = { case: Case; native: { missingFonts?: string[]; points: { offset: number; length: number; rects: { x: number; width: number }[] }[] } }

const DELTAS = [-0.5, -0.25, -1 / 16, -1 / 64, 0, 1 / 16, 0.25, 0.5]
const FRACTIONS = [0.56, 0.68, 0.8]

// The cases of one variant from its pass-1 row: nothing where the page couldn't resolve a font.
function variantCases(v: Variant, row: Row): Case[] {
  if ((row.native.missingFonts ?? []).length > 0) return []
  const points = row.native.points
  const candidates: number[] = []
  for (let k = 1; k < points.length; k++) {
    const at = points[k]!.offset
    const ok = v.t.breaks === 'space' ? v.text[at] === ' ' : v.t.breaks === 'hyphen' ? v.text[at - 1] === '-' : (points[k]!.rects[0]?.width ?? 0) > 0
    if (ok) candidates.push(at)
  }
  const cases: Case[] = []
  for (let q = 0; q < FRACTIONS.length; q++) {
    const want = FRACTIONS[q]! * v.text.length
    let best = -1
    for (let c = 0; c < candidates.length; c++) if (best < 0 || Math.abs(candidates[c]! - want) < Math.abs(best - want)) best = candidates[c]!
    if (best < 0) continue
    let lo = Infinity
    let hi = -Infinity
    for (let k = 0; k < points.length; k++) {
      const point = points[k]!
      if (point.offset >= best || v.text[point.offset] === ' ' && point.offset + point.length >= best) continue
      for (let r = 0; r < point.rects.length; r++) {
        lo = Math.min(lo, point.rects[r]!.x)
        hi = Math.max(hi, point.rects[r]!.x + point.rects[r]!.width)
      }
    }
    if (!(hi > lo)) continue
    for (let d = 0; d < DELTAS.length; d++) cases.push(caseOf(v, 'pass2', `at=${best} d=${DELTAS[d]}`, Math.round((hi - lo + DELTAS[d]!) * 64) / 64))
  }
  return mergeCases(cases)
}

// Every case, or with `oneEach` one case of every variant, drawn with the seed.
export function generatePass2(rows: readonly Row[], oneEach: boolean, seed: string): { cases: Case[]; missing: number } {
  const byOrigin = new Map<string, Row>()
  for (let i = 0; i < rows.length; i++) byOrigin.set(rows[i]!.case.origin, rows[i]!)
  const all = variants()
  const perVariant: Case[][] = []
  let missing = 0
  for (let i = 0; i < all.length; i++) {
    const v = all[i]!
    const row = byOrigin.get(caseOf(v, 'pass1', 'one line', 20000).origin)
    if (row === undefined) throw new Error(`no pass-1 row for ${v.key}`)
    const made = variantCases(v, row)
    if (made.length === 0) missing++
    else perVariant.push(made)
  }
  const cases: Case[] = []
  const rng = createRng(seed)
  for (let i = 0; i < perVariant.length; i++) {
    if (oneEach) cases.push(rng.pick(perVariant[i]!))
    else for (let k = 0; k < perVariant[i]!.length; k++) cases.push(perVariant[i]![k]!)
  }
  return { cases: sortCases(mergeCases(cases)), missing }
}

if (import.meta.main) {
  const mode = process.argv[2]
  const usage = 'usage: bun rebuild/lab/cases/wide-group-cuts.ts pass1 [--out=FILE] | pass2 --rows=FILE [--one-each] [--seed=S] [--out=FILE]'
  if (mode !== 'pass1' && mode !== 'pass2') throw new Error(usage)
  let out = resolve(import.meta.dir, mode === 'pass1' ? '../../../.artifacts/lab/cases/wide-group-cuts-pass1.ndjson' : '../../../.artifacts/lab/cases/wide-group-cuts.ndjson')
  let rowsFile: string | null = null
  let oneEach = false
  let seed = 'wide-group-cuts-1'
  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i]!
    if (arg.startsWith('--out=')) out = resolve(arg.slice(6))
    else if (arg.startsWith('--rows=') && mode === 'pass2') rowsFile = resolve(arg.slice(7))
    else if (arg === '--one-each' && mode === 'pass2') oneEach = true
    else if (arg.startsWith('--seed=') && mode === 'pass2') seed = arg.slice(7)
    else throw new Error(`Unknown argument ${arg}; ${usage}`)
  }
  mkdirSync(dirname(out), { recursive: true })
  if (mode === 'pass1') {
    const cases = generatePass1()
    writeFileSync(out, cases.map(value => `${JSON.stringify(value)}\n`).join(''))
    console.log(`${out}: ${cases.length} cases`)
  } else {
    if (rowsFile === null) throw new Error(usage)
    const rows = readFileSync(rowsFile, 'utf8').split('\n').filter(line => line !== '').map(line => JSON.parse(line) as Row)
    const made = generatePass2(rows, oneEach, seed)
    writeFileSync(out, made.cases.map(value => `${JSON.stringify(value)}\n`).join(''))
    const families = countFamilies(made.cases)
    writeFileSync(`${out.replace(/\.ndjson$/, '')}.summary.json`, `${JSON.stringify({ file: out, cases: made.cases.length, variantsLeftOut: made.missing, oneEach, seed: oneEach ? seed : null, families }, null, 2)}\n`)
    console.log(`${out}: ${made.cases.length} cases; ${made.missing} variants left out for a missing font or no candidate`)
    console.log(JSON.stringify(families, null, 2))
  }
}
