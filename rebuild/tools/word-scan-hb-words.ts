// Word lists for tools/word-scan-hb-tails.py: every distinct token of main's corpora (and 24-unit pieces of the Han and
// kana ones), `n` before every ordered pair of printable ASCII, curly punctuation beside ASCII, samples of Lao, Tibetan,
// Mongolian, emoji sequences and Han beside Latin, and made-up words (letters, some with a mark) of every script Unicode
// gives letters. Each word carries its grapheme cluster starts in code points, hb-shape's cluster values.
//
//   bun rebuild/tools/word-scan-hb-words.ts <words.json>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const CORPORA = resolve(import.meta.dir, '../../corpora')
const c = (...codes: number[]) => String.fromCodePoint(...codes)
const groups: { name: string; words: string[] }[] = []
const files = readdirSync(CORPORA).filter(f => f.endsWith('.txt')).sort()
for (const f of files) {
  const text = readFileSync(join(CORPORA, f), 'utf8')
  const seen = new Set<string>()
  for (const w of text.split(/[ \t\n\r]+/)) if (w !== '' && w.length <= 400) seen.add(w)
  groups.push({ name: `corpus-${f.replace('.txt', '')}`, words: [...seen] })
  // Han and kana text has few spaces: pieces of 24 units too.
  if (/^(ja|zh)-/.test(f)) {
    const flat = text.replace(/[ \t\n\r]+/g, '')
    const pieces: string[] = []
    const seg = new Intl.Segmenter('ja', { granularity: 'grapheme' })
    let cut = ''
    for (const g of seg.segment(flat)) { cut += g.segment; if (cut.length >= 24) { pieces.push(cut); cut = '' } }
    groups.push({ name: `pieces-${f.replace('.txt', '')}`, words: pieces })
  }
}
const ascii: string[] = []
for (let a = 0x21; a < 0x7f; a++) for (let b = 0x21; b < 0x7f; b++) ascii.push(`n${c(a)}${c(b)}`)
groups.push({ name: 'ascii-pairs', words: ascii })
const curly = ['’', '‘', '”', '“', '—', '–', '…', '‚', '„', '«', '»', '‹', '›', '·', '•', '′', '″', '¡', '¿', '†']
const punct: string[] = []
for (let a = 0x21; a < 0x7f; a++) for (const p of curly) { punct.push(`n${c(a)}${p}`); punct.push(`n${p}${c(a)}`) }
for (const p of curly) for (const q of curly) punct.push(`n${p}${q}`)
groups.push({ name: 'curly-pairs', words: punct })
groups.push({ name: 'samples', words: [
  'ສະບາຍດີ', 'ພາສາລາວເປັນພາສາທາງການຂອງປະເທດລາວ', 'ຂ້ອຍຮັກເຈົ້າຫຼາຍໆ', 'ປະເທດລາວ', 'ນະຄອນຫຼວງວຽງຈັນ', 'ຂອບໃຈຫຼາຍໆ', 'ສາທາລະນະລັດ', 'ປະຊາທິປະໄຕ', 'ຫຼວງພະບາງ', 'ແມ່ນ້ຳຂອງ', 'ເຂົ້າໜຽວ',
  'བོད་ཡིག་ནི་བོད་པའི་ཡི་གེ་ཡིན།', 'ང་བོད་པ་ཡིན།', 'བཀྲ་ཤིས་བདེ་ལེགས།', 'སྐད་ཡིག', 'རྒྱ་མཚོ', 'སྤྱི་ཚོགས', 'བསྒྲུབས', 'ཀློག', 'ཧཱུྃ', 'ཨོཾ་མ་ཎི་པདྨེ་ཧཱུྃ',
  'ᠮᠣᠩᠭᠣᠯ', `ᠮᠣᠩᠭᠣᠯ${c(0x202f)}ᠤᠨ`, `ᠬᠠᠷᠠ${c(0x180e)}ᠠ`, `ᠭ${c(0x180b)}ᠠ`, 'ᠪᠢᠴᠢᠭ', 'ᠤᠯᠤᠰ', 'ᠬᠡᠯᠡ', `ᠨᠣᠮ${c(0x202f)}ᠢ`, 'ᠰᠠᠢᠨ', 'ᠪᠠᠢᠨ\u180eᠠ',
  c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466), c(0x1f3f3, 0xfe0f, 0x200d, 0x1f308), c(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb), c(0x31, 0xfe0f, 0x20e3),
  `a${c(0x1f44d, 0x1f3fd)}b`, `${c(0x1f600)}${c(0x1f600)}${c(0x1f600)}`, `ok${c(0x1f44c)}`, c(0x1f1fa, 0x1f1f8, 0x1f1ec, 0x1f1e7), `${c(0x1f4a9)}.`,
  'iPhone用户', '使用Chrome浏览器', '東京2020オリンピック', '第3回', 'Unicode標準', '日本語English混在', '한국어Korean', 'Wi-Fi接続', '「OK」', 'ＡＢＣ全角', 'ｶﾀｶﾅ',
] })
// Made-up words for every script with letters.
const names = ['Adlam','Ahom','Arabic','Armenian','Balinese','Bamum','Bassa_Vah','Batak','Bengali','Bhaiksuki','Bopomofo','Buginese','Buhid','Canadian_Aboriginal','Carian','Caucasian_Albanian','Chakma','Cham','Cherokee','Coptic','Cuneiform','Cypriot','Cyrillic','Devanagari','Duployan','Egyptian_Hieroglyphs','Elbasan','Ethiopic','Georgian','Glagolitic','Gothic','Grantha','Greek','Gujarati','Gunjala_Gondi','Gurmukhi','Hangul','Hanifi_Rohingya','Hanunoo','Hatran','Hebrew','Imperial_Aramaic','Inscriptional_Pahlavi','Inscriptional_Parthian','Javanese','Kaithi','Kannada','Kayah_Li','Kharoshthi','Khmer','Khojki','Khudawadi','Lao','Latin','Lepcha','Limbu','Linear_A','Linear_B','Lisu','Lycian','Lydian','Mahajani','Malayalam','Mandaic','Manichaean','Marchen','Masaram_Gondi','Meetei_Mayek','Mende_Kikakui','Meroitic_Cursive','Miao','Modi','Mongolian','Mro','Multani','Myanmar','Nabataean','Nag_Mundari','New_Tai_Lue','Newa','Nko','Ogham','Ol_Chiki','Old_Hungarian','Old_Italic','Old_North_Arabian','Old_Permic','Old_Persian','Old_South_Arabian','Old_Turkic','Oriya','Osage','Osmanya','Pahawh_Hmong','Palmyrene','Pau_Cin_Hau','Phags_Pa','Phoenician','Psalter_Pahlavi','Rejang','Runic','Samaritan','Saurashtra','Sharada','Siddham','Sinhala','Sora_Sompeng','Sundanese','Syloti_Nagri','Syriac','Tagalog','Tagbanwa','Tai_Le','Tai_Tham','Tai_Viet','Takri','Tamil','Telugu','Thaana','Thai','Tibetan','Tifinagh','Tirhuta','Ugaritic','Vai','Wancho','Warang_Citi','Yezidi','Yi','Nyiakeng_Puachue_Hmong','Sunuwar']
for (let s = 0; s < names.length; s++) {
  const script = names[s]!
  let letter: RegExp, mark: RegExp
  try { letter = new RegExp(`^[\\p{Script=${script}}&&\\p{L}]$`, 'v'); mark = new RegExp(`^[\\p{Script_Extensions=${script}}&&[\\p{M}]]$`, 'v') } catch { continue }
  const letters: number[] = [], marks: number[] = []
  for (let cp = 0x80; cp < 0x20000; cp++) { const ch = String.fromCodePoint(cp); if (letter.test(ch)) letters.push(cp); else if (mark.test(ch) && cp !== 0x34f) marks.push(cp) }
  if (letters.length === 0) continue
  let state = (s + 11) >>> 0
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const words: string[] = []
  for (let n = 0; n < 300; n++) {
    let w = ''
    const length = 2 + Math.floor(next() * 8)
    for (let i = 0; i < length; i++) { w += String.fromCodePoint(letters[Math.floor(next() * letters.length)]!); if (marks.length > 0 && next() < 0.35) w += String.fromCodePoint(marks[Math.floor(next() * marks.length)]!) }
    words.push(w)
  }
  groups.push({ name: `made-up-${script}`, words })
}
let total = 0
for (const g of groups) total += g.words.length
console.log(groups.length, 'groups', total, 'words')
// Grapheme cluster starts of each word, in code point indices (hb-shape's cluster values).
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
const withStarts = groups.map(g => ({ name: g.name, words: g.words.map(w => { const starts: number[] = []; let cp = 0; for (const s of seg.segment(w)) { starts.push(cp); cp += [...s.segment].length } return { w, starts } }) }))
writeFileSync(process.argv[2] ?? 'words.json', JSON.stringify(withStarts))
