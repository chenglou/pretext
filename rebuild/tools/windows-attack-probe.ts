// A second pair of eyes on the windows inside long shaping units (engines/gecko/advance.ts windowsOf; DESIGN.md §4.4),
// pinned Firefox 156.0 at DPR 2. Measurement only. Where probe gecko-windows runs the cut rule as page script, this one
// runs the port itself: the tree it is bundled from prepares each sample, a paragraph of one text node without spaces,
// and gives the advance before every cluster start with the kind of its stand-in reason, the unit's windows where the
// tree has them, and the lines at widths that put breaks beside the 16th, 32nd and 48th cluster, plain and inspected.
// Beside them the DOM's advance before every source offset (Range rects x 60, the in-word probe's method, gecko-port
// F15), and the calls and UTF-16 units the sample sent to Canvas.
//
// One run from a tree without windows and one from a tree with them are held against each other offline
// (tools/windows-attack-diff.ts): an advance, a reason kind or a line that differs refutes the cut rule for the sample's
// class, and the DOM says which of the two is right. The samples are the classes a cut is most likely to be wrong in:
// text a font kerns or substitutes across, fallback font edges and fonts that stick to the previous character's font,
// variation selectors, emoji, U+200D and U+200C, letter spacing, synthetic bold, fractional sizes, Arabic with marks,
// tatweel and digits, scripts written without spaces, and units long or wide enough to show a drift.
//
// Run, from each tree: python3 .artifacts/session/with-browser-lock.py <job> --browser=firefox -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/windows-attack-probe.ts --out=<out> \
//     --probe-timeout-ms=900000 --stall-ms=900000
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

export type Sample = { id: string; cls: string; family: string; size: number; weight: number; style: 'normal' | 'italic'; lang: string; direction: 'ltr' | 'rtl'; letterSpacing: number; text: string }

const corpus = (name: string, from: number, units: number): string => {
  const text = readFileSync(join(import.meta.dir, '..', '..', 'corpora', `${name}.txt`), 'utf8')
  let out = ''
  for (const ch of text.slice(from)) {
    if (out.length >= units) break
    // U+0020 and U+00A0 are shaping unit boundaries, and the other white space and controls are invalid characters.
    if (/\p{White_Space}|\p{Cc}|\p{Cf}/u.test(ch)) continue
    out += ch
  }
  return out
}

const repeat = (s: string, units: number): string => {
  let out = ''
  while (out.length < units) out += s
  return out
}

// `words` put into `base`, one after every `period` characters of it.
const mixed = (base: string, words: string[], period: number): string => {
  let out = ''
  let k = 0
  const chars = [...base]
  for (let i = 0; i < chars.length; i += period) out += chars.slice(i, i + period).join('') + words[k++ % words.length]!
  return out
}

const cp = (...codes: number[]): string => String.fromCodePoint(...codes)
const ZWJ = cp(0x200d)
const ZWNJ = cp(0x200c)

const BENCH = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif'

export function samples(): Sample[] {
  const out: Sample[] = []
  const add = (cls: string, name: string, family: string, size: number, lang: string, text: string, more: Partial<Sample> = {}): void => {
    const s: Sample = { id: '', cls, family, size, weight: 400, style: 'normal', lang, direction: 'ltr', letterSpacing: 0, text, ...more }
    s.id = `${cls} | ${name} | ${s.size}px ${s.weight} ${s.style} ${family} | ${lang} ${s.direction} ls ${s.letterSpacing} | ${text.length} units`
    out.push(s)
  }
  const han = corpus('zh-zhufu', 0, 2400)
  const kana = corpus('ja-rashomon', 0, 1200)
  const hangul = corpus('ko-sonagi', 0, 1200)
  const thai = corpus('th-nithan-vetal-story-1', 0, 2400)
  const khmer = corpus('km-prachum-reuang-preng-khmer-volume-7-stories-1-10', 0, 600)
  const burmese = corpus('my-cunning-heron-teacher', 0, 600)
  const hindi = corpus('hi-eidgah', 0, 600)
  const arabic = corpus('ar-risalat-al-ghufran-part-1', 0, 400)
  const arabic2 = corpus('ar-al-bukhala', 0, 400)
  const urdu = corpus('ur-chughd', 0, 300)
  const hebrew = corpus('he-masaot-binyamin-metudela', 0, 300)
  const latin = corpus('en-gatsby-opening', 0, 300)

  // Lengths around the 32 unit threshold and the last cell's rule, sizes whose advances aren't whole au, letter spacing.
  const cjkFonts: [string, number, string][] = [['"PingFang TC"', 16, 'zh-Hant'], ['"PingFang SC"', 15.5, 'zh-Hans'], ['"Songti SC"', 13.333, 'zh-Hans'], ['"Kaiti SC"', 20, 'zh-Hans'],
    [BENCH, 16, 'en'], ['serif', 17, 'zh-Hant'], ['"Hiragino Sans"', 16, 'ja'], ['Arial', 14.7, 'en']]
  const lengths = [33, 47, 48, 49, 63, 64, 65, 100, 400]
  for (let f = 0; f < cjkFonts.length; f++) {
    const [family, size, lang] = cjkFonts[f]!
    for (let k = 0; k < lengths.length; k++) if (f < 2 || k >= 7 || k === 0) add('han', `length ${lengths[k]!}`, family, size, lang, han.slice(f * 50, f * 50 + lengths[k]!))
  }
  const spacings = [1, 2, 0.3, -0.5, 5.25]
  for (let k = 0; k < spacings.length; k++) {
    add('han-spaced', 'letter spacing', '"PingFang TC"', 16, 'zh-Hant', han.slice(0, 200), { letterSpacing: spacings[k]! })
    add('han-spaced', 'letter spacing, bench fonts', BENCH, 16, 'en', han.slice(100, 300), { letterSpacing: spacings[k]! })
    add('thai-spaced', 'letter spacing', 'Thonburi', 18, 'th', thai.slice(0, 200), { letterSpacing: spacings[k]! })
    add('latin-spaced', 'letter spacing', '"Times New Roman"', 18, 'en', latin.slice(0, 200), { letterSpacing: spacings[k]! })
  }
  const kanaFonts: [string, number][] = [['"Hiragino Sans"', 16], ['"Hiragino Mincho ProN"', 19.5], ['"PingFang SC"', 16], [BENCH, 16], ['"Hiragino Maru Gothic ProN"', 15], ['Osaka', 16], ['"Yu Gothic"', 16]]
  for (let f = 0; f < kanaFonts.length; f++) add('kana', 'corpus', kanaFonts[f]![0], kanaFonts[f]![1], f === 3 ? 'en' : 'ja', kana.slice(f * 40, f * 40 + 300))
  const hangulFonts: [string, number][] = [['"Apple SD Gothic Neo"', 16], ['"Apple SD Gothic Neo"', 17.3], [BENCH, 16], ['AppleMyungjo', 18], ['"Nanum Gothic"', 16]]
  for (let f = 0; f < hangulFonts.length; f++) add('hangul', 'corpus', hangulFonts[f]![0], hangulFonts[f]![1], f === 2 ? 'en' : 'ko', hangul.slice(f * 40, f * 40 + 300))
  // Conjoining jamo: clusters of several characters, and a font that may compose them.
  add('hangul', 'conjoining jamo', '"Apple SD Gothic Neo"', 16, 'ko', repeat(cp(0x1112, 0x1161, 0x11ab) + cp(0x1100, 0x1173, 0x11af) + '한글', 160))
  // The page language and the text's language pick the fallback fonts and the `locl` forms.
  const langs = ['ja', 'zh-Hans', 'zh-Hant', 'ko', 'en', 'th']
  for (let k = 0; k < langs.length; k++) add('han-lang', 'language', BENCH, 16, langs[k]!, han.slice(300, 480))
  for (let k = 0; k < langs.length; k++) add('han-lang', 'language, Latin first font only', '"Helvetica Neue"', 16, langs[k]!, mixed(han.slice(500, 640), ['、', '。', '「', '」', '…', '——'], 9))

  // Latin with kerning and ligatures inside Han, the pairs at every phase of the grid.
  const latinWords = ['AVATAR', 'To', 'Wave', 'office', 'Ty', 'firstname', 'LT', 'Yo', '11', 'P,', 'WA', 'ffl', 'r.', 'VA']
  const mixFonts: [string, number][] = [['"Times New Roman", "Songti SC"', 18], [BENCH, 16], ['Verdana, "PingFang SC"', 16], ['"Helvetica Neue", "Hiragino Sans"', 14], ['Georgia, "PingFang SC"', 17],
    ['"Hoefler Text", "Songti SC"', 16], ['Zapfino, "PingFang SC"', 12], ['"Apple Chancery", "Kaiti SC"', 18], ['"PingFang SC"', 16], ['"Hiragino Sans"', 16]]
  const periods = [7, 5, 11, 13, 3]
  for (let f = 0; f < mixFonts.length; f++) for (let k = 0; k < periods.length; k++) if (f < 4 || k < 2) add('han-latin', `period ${periods[k]!}`, mixFonts[f]![0], mixFonts[f]![1], 'zh-Hans', mixed(han.slice(0, 220), latinWords, periods[k]!))
  // A kerned pair across each of the first cut's sixteen phases.
  for (let phase = 0; phase < 16; phase++) add('han-latin', `AV across offset ${31 - phase}..`, '"Times New Roman", "Songti SC"', 18, 'zh-Hans', han.slice(0, 15 + phase) + 'AV' + han.slice(40, 100) + 'To' + han.slice(100, 130))

  // Fallback font edges, and characters that take the previous character's font in system fallback.
  const symbols = ['☆', '♪', '→', '※', '〒', '①', '㈱', '㍻', '★', '♡', '✓', '∀', '㊙', '𠀋', '𠮷', '𡈽', 'ｶﾞ', 'ＡＶ', 'ㄅㄆ', '〜', '・', '︰']
  const fallbackFonts: [string, number, string][] = [[BENCH, 16, 'en'], ['"Helvetica Neue"', 16, 'ja'], ['Arial', 16, 'zh-Hans'], ['"PingFang SC"', 16, 'zh-Hans'], ['"Times New Roman"', 17, 'ko'], ['Menlo', 14, 'en']]
  for (let f = 0; f < fallbackFonts.length; f++) {
    const [family, size, lang] = fallbackFonts[f]!
    add('fallback', 'symbols in Han, period 6', family, size, lang, mixed(han.slice(0, 200), symbols, 6))
    add('fallback', 'symbols in Han, period 17', family, size, lang, mixed(han.slice(200, 420), symbols, 17))
    add('fallback', 'a run of stars after Han', family, size, lang, han.slice(0, 5) + repeat('☆', 60) + han.slice(5, 40))
    add('fallback', 'stars', family, size, lang, repeat('☆★', 80))
    add('fallback', 'arrows and notes after kana', family, size, lang, kana.slice(0, 20) + repeat('→♪', 50) + kana.slice(20, 60))
    add('fallback', 'rare Han then common Han', family, size, lang, '𠀋𠮷𡈽' + han.slice(0, 60) + '𠀋' + han.slice(60, 140))
    add('fallback', 'circled digits', family, size, lang, repeat('①②③④⑤⑥⑦⑧⑨⑩', 70))
    add('fallback', 'full-width Latin', family, size, lang, repeat('ＡＶＡＴＡＲＴｏＷａｖｅ', 80))
    add('fallback', 'half-width katakana', family, size, lang, repeat('ｶﾞｷﾞｸﾞﾊﾟﾋﾟｱｲｳｴｵ', 90))
  }
  // Variation selectors and emoji inside Han.
  const vs = ['葛' + cp(0xe0100), '辻' + cp(0xe0101), '禰' + cp(0xe0100), '︎', '☺' + cp(0xfe0e), '☺' + cp(0xfe0f), '❤' + cp(0xfe0f), '©', '™', '#' + cp(0xfe0f, 0x20e3),
    cp(0x1f600), cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), cp(0x1f1ef, 0x1f1f5) + cp(0x1f1fa, 0x1f1f8), cp(0x1f44d, 0x1f3fd), cp(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)]
  const emojiFonts: [string, number, string][] = [[BENCH, 16, 'en'], ['"PingFang SC"', 16, 'zh-Hans'], ['"Hiragino Sans"', 15, 'ja'], ['Arial', 16, 'en'], ['"Hiragino Mincho ProN"', 18, 'ja']]
  const emojiPeriods = [4, 7, 15, 16]
  for (let f = 0; f < emojiFonts.length; f++) for (let k = 0; k < emojiPeriods.length; k++) add('han-emoji-vs', `period ${emojiPeriods[k]!}`, emojiFonts[f]![0], emojiFonts[f]![1], emojiFonts[f]![2], mixed(han.slice(0, 200), vs, emojiPeriods[k]!))
  add('han-emoji-vs', 'emoji only', BENCH, 16, 'en', repeat(cp(0x1f600) + cp(0x1f602) + cp(0x1f44d, 0x1f3fd) + cp(0x2764, 0xfe0f), 120))
  add('han-emoji-vs', 'flags only', BENCH, 16, 'en', repeat(cp(0x1f1ef, 0x1f1f5) + cp(0x1f1fa, 0x1f1f8) + cp(0x1f1eb, 0x1f1f7), 120))
  add('han-joiners', 'U+200D and U+200C between Han', '"PingFang SC"', 16, 'zh-Hans', mixed(han.slice(0, 150), [ZWJ, ZWNJ], 5))
  add('han-joiners', 'U+200D and U+200C between Han, bench fonts', BENCH, 16, 'en', mixed(han.slice(0, 150), [ZWJ, ZWNJ, ZWJ + ZWJ], 8))

  // Synthetic bold and italic: families without a bold face, and oblique Han.
  const boldFonts: [string, string, string][] = [['"Baoli SC"', 'zh-Hans', han.slice(0, 120)], ['"Wawati SC"', 'zh-Hans', han.slice(0, 120)], ['"Libian SC"', 'zh-Hans', han.slice(0, 120)], ['"PingFang SC"', 'zh-Hans', han.slice(0, 120)],
    ['Sathu', 'th', thai.slice(0, 160)], ['Krungthep', 'th', thai.slice(0, 160)], ['Zapfino', 'en', latin.slice(0, 120)], ['"Apple Chancery"', 'en', latin.slice(0, 160)], ['"Apple Symbols"', 'en', repeat('☆★♪→', 80)],
    ['"Helvetica Neue", "Baoli SC"', 'zh-Hans', mixed(han.slice(0, 150), latinWords, 7)]]
  for (let f = 0; f < boldFonts.length; f++) {
    add('synthetic', 'bold', boldFonts[f]![0], 16, boldFonts[f]![1], boldFonts[f]![2], { weight: 700 })
    add('synthetic', 'bold italic', boldFonts[f]![0], 17, boldFonts[f]![1], boldFonts[f]![2], { weight: 700, style: 'italic' })
  }

  // Long Latin units: fonts that kern, ligate and substitute by context.
  const latinFonts: [string, number, 'normal' | 'italic'][] = [['"Helvetica Neue"', 16, 'normal'], ['"Times New Roman"', 18, 'normal'], ['Verdana', 16, 'normal'], ['Georgia', 16, 'normal'], ['"Hoefler Text"', 16, 'normal'],
    ['"Hoefler Text"', 17, 'italic'], ['Zapfino', 12, 'normal'], ['"Apple Chancery"', 18, 'normal'], ['"Snell Roundhand"', 20, 'normal'], ['Menlo', 14, 'normal'], ['"Shantell Sans"', 16, 'normal'], ['Amiri', 24, 'normal'],
    ['Optima', 16, 'normal'], ['Futura', 16, 'normal'], ['Didot', 18, 'normal'], ['"Bradley Hand"', 16, 'normal']]
  const latinTexts: [string, string][] = [['corpus', latin], ['url', 'https://example.com/reports/2026/AVATAR/To/Wave/office/firstname?query=Typography&filter=LT,Yo;flow=affluent#waffles-and-fjords'],
    ['fi and ff rows', repeat('fiffifflffffiffj', 120)], ['kerned pairs', repeat('AVAWATaToTyVAWAYoP,r.LT11', 130)], ['laughter', repeat('ha', 90) + repeat('!', 40) + repeat('.', 40)],
    ['digits', repeat('1234567890117141', 100)], ['base64', 'QWxsIHRoZSB3b3JsZCdzIGEgc3RhZ2UsIGFuZCBhbGwgdGhlIG1lbiBhbmQgd29tZW4gbWVyZWx5IHBsYXllcnM7VGhleSBoYXZlIHRoZWlyIGV4aXRz'],
    ['dashes and arrows', repeat('--->==>>-->~~~', 110)], ['combining marks', repeat('éàçñöûÃỹ̈ǘ', 110)]]
  for (let f = 0; f < latinFonts.length; f++) for (let k = 0; k < latinTexts.length; k++) if (f < 8 || k < 3) add('latin', latinTexts[k]![0], latinFonts[f]![0], latinFonts[f]![1], 'en', latinTexts[k]![1], { style: latinFonts[f]![2] })

  // Arabic: every letter boundary joins or kerns. Laughter, lam-alef rows, stretched alef, tatweel, marks, U+200C words,
  // Arabic-Indic digits, and running text without its spaces.
  const arabicFonts: [string, number][] = [['"Geeza Pro"', 16], ['Amiri', 24], ['"Noto Naskh Arabic"', 16], ['"Noto Nastaliq Urdu"', 20], ['Arial', 16], ['"Times New Roman"', 18], ['"DecoType Naskh"', 20], ['"Diwan Thuluth"', 20],
    ['Mishafi', 20], ['"Al Nile"', 16], ['Damascus', 16], ['Baghdad', 16], [BENCH, 16], ['"Helvetica Neue"', 16]]
  const vocalized = 'بِسْمِاللَّهِالرَّحْمَٰنِالرَّحِيمِالْحَمْدُلِلَّهِرَبِّالْعَالَمِينَالرَّحْمَٰنِالرَّحِيمِمَالِكِيَوْمِالدِّينِ'
  const arabicTexts: [string, string][] = [['laughter', repeat('ه', 60)], ['lam-alef row', repeat('لا', 70)], ['stretched alef', 'ي' + repeat('ا', 50) + 'رب'], ['tatweel', 'جم' + repeat('ـ', 45) + 'يل' + 'رائ' + repeat('ـ', 40) + 'ع'],
    ['vocalized', repeat(vocalized, 200)], ['U+200C words', mixed(arabic.slice(0, 160), [ZWNJ], 4)], ['Arabic-Indic digits', repeat('١٢٣٤٥٦٧٨٩٠', 60) + arabic.slice(0, 40)],
    ['corpus', arabic.slice(0, 300)], ['corpus 2', arabic2.slice(0, 300)], ['right-joining letters', repeat('دارزوردادرو', 80)], ['U+200D words', mixed(arabic.slice(0, 120), [ZWJ], 6)]]
  for (let f = 0; f < arabicFonts.length; f++) for (let k = 0; k < arabicTexts.length; k++) if (f < 6 || k < 5 || k === 7) add('arabic', arabicTexts[k]![0], arabicFonts[f]![0], arabicFonts[f]![1], 'ar', arabicTexts[k]![1], { direction: 'rtl' })
  add('arabic', 'corpus in a left-to-right paragraph', '"Geeza Pro"', 16, 'ar', arabic.slice(0, 200))
  add('urdu', 'corpus', '"Noto Nastaliq Urdu"', 20, 'ur', urdu, { direction: 'rtl' })
  add('urdu', 'corpus', '"Geeza Pro"', 16, 'ur', urdu, { direction: 'rtl' })
  add('hebrew', 'corpus', '"Arial Hebrew"', 16, 'he', hebrew, { direction: 'rtl' })
  add('hebrew', 'corpus', '"New Peninim MT"', 18, 'he', hebrew, { direction: 'rtl' })
  add('hebrew', 'corpus', '"Times New Roman"', 18, 'he', hebrew, { direction: 'rtl' })
  add('hebrew', 'pointed', '"Times New Roman"', 18, 'he', repeat('בְּרֵאשִׁיתבָּרָאאֱלֹהִיםאֵתהַשָּׁמַיִםוְאֵתהָאָרֶץ', 160), { direction: 'rtl' })
  add('hebrew', 'pointed', '"Arial Hebrew"', 18, 'he', repeat('בְּרֵאשִׁיתבָּרָאאֱלֹהִיםאֵתהַשָּׁמַיִםוְאֵתהָאָרֶץ', 160), { direction: 'rtl' })

  // Scripts written without spaces, and Indic scripts whose conjuncts and reordering cross cluster boundaries.
  const complex: [string, string, string, [string, number][]][] = [
    ['thai', 'th', thai.slice(0, 400), [['Thonburi', 20], ['Thonburi', 15.5], ['Ayuthaya', 16], ['Sathu', 16], ['Silom', 16], ['"Sukhumvit Set"', 16], ['Arial', 16], [BENCH, 16], ['Tahoma', 16]]],
    ['lao', 'lo', repeat('ສະບາຍດີຂອບໃຈຫຼາຍໆພາສາລາວເຈົ້າຊື່ຫຍັງຂ້ອຍບໍ່ເຂົ້າໃຈ', 300), [['"Lao MN"', 18], ['"Lao Sangam MN"', 16], [BENCH, 16]]],
    ['khmer', 'km', khmer.slice(0, 400), [['"Khmer MN"', 20], ['"Khmer Sangam MN"', 16], ['Arial', 16], [BENCH, 16]]],
    ['burmese', 'my', burmese.slice(0, 400), [['"Myanmar MN"', 20], ['"Myanmar Sangam MN"', 16], ['"Noto Sans Myanmar"', 16], ['Arial', 16], [BENCH, 16]]],
    ['tibetan', 'bo', repeat('བོད་སྐད་ཡིག་བཀྲ་ཤིས་བདེ་ལེགས་སངས་རྒྱས་ཆོས་དང་ཚོགས་ཀྱི་མཆོག་རྣམས་ལ།', 300), [['Kailasa', 18], ['Kokonor', 18], [BENCH, 16]]],
    ['devanagari', 'hi', hindi.slice(0, 400), [['"Kohinoor Devanagari"', 16], ['"Kohinoor Devanagari"', 19.5], ['"Devanagari MT"', 18], ['"Devanagari Sangam MN"', 16], ['"ITF Devanagari"', 16], ['"Shree Devanagari 714"', 18], ['Arial', 16], [BENCH, 16]]],
    ['devanagari', 'hi', repeat('क्षत्रियश्रीर्कीक्‍षक्‌षत्र्यंस्त्रीद्ध्र्यर्थिक', 300), [['"Kohinoor Devanagari"', 18], ['"Devanagari MT"', 18], ['"ITF Devanagari"', 16]]],
    ['bengali', 'bn', repeat('বাংলাদেশক্ষমাকরুনস্ত্রীর্কিকোকৌশ্রীজ্ঞান', 300), [['"Bangla MN"', 18], ['"Bangla Sangam MN"', 16], ['"Kohinoor Bangla"', 16]]],
    ['tamil', 'ta', repeat('தமிழ்நாடுவணக்கம்நன்றிகொண்டாட்டம்ஸ்ரீகௌரவம்க்ஷ', 300), [['"Tamil MN"', 18], ['"Tamil Sangam MN"', 16], [BENCH, 16]]],
    ['kannada', 'kn', repeat('ಕನ್ನಡಕ್ಷಮಿಸಿರಾಷ್ಟ್ರೀಯರ್ಕಸ್ತ್ರೀಕೊಕೋಜ್ಞಾನ', 300), [['"Kannada MN"', 18], ['"Kannada Sangam MN"', 16], ['"Noto Sans Kannada"', 16]]],
    ['telugu', 'te', repeat('తెలుగుక్షమించండిరాష్ట్రీయస్త్రీర్కకొకోజ్ఞానం', 300), [['"Telugu MN"', 18], ['"Telugu Sangam MN"', 16], ['"Kohinoor Telugu"', 16]]],
    ['malayalam', 'ml', repeat('മലയാളംക്ഷമിക്കണംസ്ത്രീര്‍ക്കകൊകോന്‍റെ', 300), [['"Malayalam MN"', 18], ['"Malayalam Sangam MN"', 16]]],
    ['sinhala', 'si', repeat('ශ්‍රීලංකාවක්‍ෂණිකකොකෝක්‍යර්‍ක', 300), [['"Sinhala MN"', 18], ['"Sinhala Sangam MN"', 16]]],
    ['gujarati-gurmukhi', 'gu', repeat('ગુજરાતીક્ષત્રિયશ્રીર્કિਪੰਜਾਬੀਕ੍ਰਿਸ਼ਨਸ੍ਤ੍ਰੀ', 300), [['"Gujarati MT"', 18], ['"Gujarati Sangam MN"', 16], ['"Gurmukhi MN"', 18]]],
    ['ethiopic-mongolian', 'am', repeat('ሰላምእንደምንአደርክ፡አማርኛ፡ᠮᠣᠩᠭᠣᠯᠪᠢᠴᠢᠭ', 300), [['Kefa', 16], [BENCH, 16]]],
  ]
  for (let c = 0; c < complex.length; c++) {
    const [cls, lang, text, fonts] = complex[c]!
    for (let f = 0; f < fonts.length; f++) add(cls, 'text', fonts[f]![0], fonts[f]![1], lang, text)
  }
  // Scripts mixed in one unit: script runs and font ranges inside windows, Common characters at window edges.
  add('mixed-scripts', 'Han, Thai, emoji, Hangul', BENCH, 16, 'en', han.slice(0, 60) + thai.slice(0, 60) + cp(0x1f600, 0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) + han.slice(60, 120) + hangul.slice(0, 60))
  add('mixed-scripts', 'brackets and digits across scripts', BENCH, 16, 'en', mixed(han.slice(0, 120) + thai.slice(0, 100) + hangul.slice(0, 100), ['（', '）', '(12)', '[', ']', '2026', '「', '」', '%', '：'], 6))
  add('mixed-scripts', 'brackets and digits across scripts', '"Times New Roman", "Songti SC", Thonburi', 17, 'zh-Hans', mixed(han.slice(0, 120) + thai.slice(0, 100) + kana.slice(0, 100), ['（', '）', '(12)', '[', ']', '2026', '「', '」', '%', '：'], 5))
  add('mixed-scripts', 'Arabic words in Han', BENCH, 16, 'en', mixed(han.slice(0, 200), ['سلام', 'لا', 'ههههه', '١٢٣'], 9))

  // A right-to-left script under a left-to-right override is shaped reversed unless its buffer holds digits and no
  // letter (advance.ts shapedReversed; hb-ot-shape.cc:588-645): a window of digits alone inside a unit with letters.
  const lro = cp(0x202d)
  const digitRuns = ['1', '17', '1174']
  for (let k = 0; k < digitRuns.length; k++) {
    add('override', 'Hebrew letters then digits under U+202D', '"Times New Roman"', 24, 'he', lro + 'אבגדה' + repeat(digitRuns[k]!, 60) + 'אבג', { direction: 'rtl' })
    add('override', 'Hebrew letters then digits under U+202D', 'Arial', 24, 'he', lro + 'אבגדה' + repeat(digitRuns[k]!, 60) + 'אבג', { direction: 'rtl' })
    add('override', 'Arabic letters then digits under U+202D', 'Arial', 24, 'ar', lro + 'دارزور' + repeat(digitRuns[k]!, 60) + 'دار', { direction: 'rtl' })
    add('override', 'Arabic letters then digits under U+202D, left to right', '"Times New Roman"', 24, 'ar', lro + 'دارزور' + repeat(digitRuns[k]!, 60) + 'دار')
  }
  add('override', 'Latin under U+202E', '"Times New Roman"', 18, 'en', cp(0x202e) + latin.slice(0, 120))
  add('override', 'Han and Latin under U+202E', '"Times New Roman", "Songti SC"', 18, 'zh-Hans', cp(0x202e) + mixed(han.slice(0, 120), latinWords, 7))

  // Long and wide units: a drift that grows with the number of windows would show in the last offsets.
  add('long', 'Han 2,400', '"PingFang SC"', 15.5, 'zh-Hans', han.slice(0, 2400))
  add('long', 'Han 2,400, bench fonts', BENCH, 16, 'en', han.slice(0, 2400))
  add('long', 'Han 2,400, a size off the 7-bit grid', '"Songti SC"', 13.333, 'zh-Hans', han.slice(0, 2400))
  add('long', 'Han 1,200, letter spacing', '"PingFang TC"', 16, 'zh-Hant', han.slice(0, 1200), { letterSpacing: 0.3 })
  add('long', 'kana 1,200', '"Hiragino Sans"', 14.7, 'ja', kana)
  add('long', 'Hangul 1,200', '"Apple SD Gothic Neo"', 17.3, 'ko', hangul)
  add('long', 'Thai 2,400', 'Thonburi', 15.5, 'th', thai.slice(0, 2400))
  add('long', 'Thai 1,200, bench fonts', BENCH, 16, 'en', thai.slice(0, 1200))
  add('long', 'Han and Latin 1,500', '"Times New Roman", "Songti SC"', 17.3, 'zh-Hans', mixed(han.slice(0, 1100), latinWords, 7))
  add('wide', 'Han over 2^18 px', '"PingFang SC"', 200, 'zh-Hans', han.slice(0, 1400))
  add('wide', 'Thai over 2^18 px', 'Thonburi', 150, 'th', thai.slice(0, 2400))
  add('wide', 'kana over 2^17 px at a fractional size', '"Hiragino Sans"', 133.3, 'ja', kana.slice(0, 1100))
  return out
}

const BODY = String.raw`
const lib = globalThis.windowsAttack;
const env = lib.environment();
const proto = OffscreenCanvasRenderingContext2D.prototype;
const realMeasure = proto.measureText;
let calls = 0, units = 0;
proto.measureText = function (text) { calls++; units += text.length; return realMeasure.call(this, text); };
// The DOM's advance before every code unit offset, in au, letter spacing included.
const domBefore = (s) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre; direction: ' + s.direction;
  div.lang = s.lang;
  const span = document.createElement('span');
  span.style.font = s.style + ' ' + s.weight + ' ' + s.size + 'px ' + s.family; span.style.letterSpacing = s.letterSpacing + 'px';
  const node = document.createTextNode(s.text); span.append(node); div.append(span);
  host.append(div);
  const range = document.createRange();
  const before = new Array(node.data.length + 1).fill(0);
  let sum = 0;
  for (let i = 0; i < node.data.length;) {
    const len = node.data.codePointAt(i) > 0xffff ? 2 : 1;
    range.setStart(node, i); range.setEnd(node, i + len);
    sum += [...range.getClientRects()].reduce((a, r) => a + r.width, 0) * 60;
    for (let k = 1; k <= len; k++) before[i + k] = Math.round(sum * 100) / 100;
    i += len;
  }
  div.remove();
  return before;
};
try {
  const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, samples: [] };
  for (const s of SAMPLES) {
    calls = 0; units = 0;
    const t0 = performance.now();
    let dumped = null, error = null;
    try { dumped = lib.dump(s, env); } catch (e) { error = String(e); }
    const ms = performance.now() - t0;
    const row = { id: s.id, cls: s.cls, calls, unitsSent: units, ms: Math.round(ms * 10) / 10, error, dump: dumped, dom: null };
    const dom = domBefore(s);
    if (dumped !== null) row.dom = dumped.src.map((at) => dom[at]);
    out.samples.push(row);
  }
  return out;
} finally {
  proto.measureText = realMeasure;
}
`

export default async function probes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'windows-attack-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  return [{
    id: 'gecko-windows-attack A1',
    spec: 'gecko-windows-attack A1: the port\'s advances, reasons, windows and lines on long units, beside the DOM, from the tree it runs in',
    pageLang: 'en',
    html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\nconst SAMPLES = ${JSON.stringify(samples())};\n${BODY}` }],
    browsers: ['firefox'],
    fontFixtures: ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Shantell Sans'],
    note: 'Measurement only.',
  }]
}
