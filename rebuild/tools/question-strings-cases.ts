// Cases built to hit the edges of the code that builds a Canvas question in the Blink port (engines/blink/shape.ts
// canvasString, engines/blink/content.ts stringOfUnits, engines/blink/props.ts), for tools/question-strings-dump.ts,
// tools/two-trees.ts and tools/positions-attack.ts. No recorded set holds them, and no browser has seen them: they say
// whether two trees compute the same thing, not whether either is right.
//
//   bun rebuild/tools/question-strings-cases.ts <out.ndjson> [<giants.ndjson>]
//
// The edges: a string of 0, 1, 12, 13 and 14 units; texts of 4,095 to 8,193 units and of 100,000 (String.fromCharCode
// takes 4,096 units a call); a range that holds only characters the string leaves out; the characters Canvas replaces
// (U+0020, VT, FF, SHY, ZWSP, LRM, RLM, the embeddings, U+FEFF) in a paragraph of 8-bit text and in one that is
// segmented; a Latin-1-only range the paragraph shapes under another script (brackets and digits beside Arabic, Hebrew
// and Han); Arabic joining across a range's edges, with marks between; lone and split surrogates; code points on both
// sides of U+3000, where the property tables read by index end; mixed direction; letter and word spacing, which read
// the list of text offsets; every white-space, word-break, overflow-wrap and line-break value over one text.
import { writeFileSync } from 'node:fs'
import type { Case, Paragraph, TextRun } from '../lab/types.ts'

const ch = (...codePoints: number[]): string => String.fromCodePoint(...codePoints)
const unit = (code: number): string => String.fromCharCode(code)
const SHY = unit(0xad), ZWSP = unit(0x200b), LRM = unit(0x200e), RLM = unit(0x200f), LRE = unit(0x202a), PDF = unit(0x202c), RLO = unit(0x202e), BOM = unit(0xfeff)
const NBSP = unit(0xa0), NNBSP = unit(0x202f), IDEOGRAPHIC_SPACE = unit(0x3000), ZWJ = unit(0x200d), ZWNJ = unit(0x200c), WJ = unit(0x2060), VT = unit(0x0b), FF = unit(0x0c)
const ARABIC = ch(0x0628, 0x0650, 0x0633, 0x0645, 0x0020, 0x0627, 0x0644, 0x0644, 0x0647, 0x0020, 0x0622, 0x06af)
const HEBREW = ch(0x05e9, 0x05dc, 0x05d5, 0x05dd, 0x0020, 0x05e2, 0x05d5, 0x05dc, 0x05dd)
const HAN = ch(0x4e2d, 0x6587, 0x6e2c, 0x8a66, 0x3001, 0x300c, 0x62ec, 0x865f, 0x300d, 0x3002)
const THAI = ch(0x0e20, 0x0e32, 0x0e29, 0x0e32, 0x0e44, 0x0e17, 0x0e22, 0x0e17, 0x0e35, 0x0e48, 0x0e2a, 0x0e27, 0x0e22)
const DEVANAGARI = ch(0x0915, 0x094d, 0x0937, 0x0924, 0x094d, 0x0930, 0x093f, 0x092f, 0x0020, 0x0939, 0x093f, 0x0928, 0x094d, 0x0926, 0x0940)
const EMOJI = ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x0020, 0x1f44d, 0x1f3fd, 0x0020, 0x1f1e8, 0x1f1e6, 0x0020, 0x0023, 0xfe0f, 0x20e3, 0x0020, 0x2764, 0xfe0f)
const LATIN = 'The quick brown fox (it jumps) over 12 lazy dogs; office affluent waffle. Tj AV fi ffl To.'

const SANS = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal' } as const
const SERIF_BIG = { family: '"Times New Roman", serif', size: 40, weight: 700, style: 'italic' } as const
const MONO = { family: 'Menlo', size: 14, weight: 400, style: 'normal' } as const

type Style = Partial<Pick<Paragraph, 'whiteSpace' | 'wordBreak' | 'overflowWrap' | 'lineBreak' | 'direction' | 'letterSpacing' | 'wordSpacing' | 'width' | 'font' | 'lang'>>

const lines: string[] = []
const giants: string[] = []
function add(into: string[], family: string, name: string, texts: ReadonlyArray<string | { code: string }>, style: Style = {}): void {
  const font = style.font ?? SANS
  const letterSpacing = style.letterSpacing ?? 0
  const wordSpacing = style.wordSpacing ?? 0
  const runs: TextRun[] = texts.map(text => typeof text === 'string'
    ? { text, node: 'text', font, letterSpacing, wordSpacing, lang: null }
    : { text: text.code, node: 'span', font: MONO, letterSpacing, wordSpacing, lang: null })
  const paragraph: Paragraph = {
    runs, font, letterSpacing, wordSpacing, width: style.width ?? 120, lineHeight: Math.ceil(font.size * 1.5), whiteSpace: style.whiteSpace ?? 'normal', wordBreak: style.wordBreak ?? 'normal',
    overflowWrap: style.overflowWrap ?? 'break-word', lineBreak: style.lineBreak ?? 'auto', tabSize: 8, direction: style.direction ?? 'ltr', lang: style.lang ?? 'en',
  }
  const c: Case = { id: `question-strings/${family}/${name}`, family: `question-strings/${family}`, origin: 'tools/question-strings-cases.ts', pageLang: 'en', paragraph }
  into.push(JSON.stringify(c))
}

// ---- Lengths ----
add(lines, 'lengths', 'empty', [''])
add(lines, 'lengths', 'empty-runs', ['', 'ab', '', { code: '' }, 'cd', ''])
add(lines, 'lengths', 'one-unit', ['a'])
for (const n of [12, 13, 14]) {
  add(lines, 'lengths', `latin-${n}`, ['x'.repeat(n)])
  add(lines, 'lengths', `brackets-after-arabic-${n}`, [ARABIC + ' ' + '('.repeat(n) + ' ' + ARABIC])
  add(lines, 'lengths', `digits-after-hebrew-${n}`, [HEBREW + ' ' + '1234567890123456'.slice(0, n) + ' ' + HEBREW], { direction: 'rtl' })
  add(lines, 'lengths', `brackets-in-han-${n}`, [HAN + '('.repeat(n) + HAN + '.'.repeat(n)])
  add(lines, 'lengths', `brackets-after-arabic-big-${n}`, [ARABIC + '('.repeat(n) + '-'.repeat(n)], { font: SERIF_BIG, width: 300 })
}
for (const n of [4095, 4096, 4097, 8192, 8193]) {
  add(giants, 'lengths', `words-${n}`, ['lorem ipsum '.repeat(Math.ceil(n / 12)).slice(0, n)], { width: 320 })
  add(giants, 'lengths', `one-word-${n}`, ['a'.repeat(n)], { width: 320 })
  add(giants, 'lengths', `han-${n}`, [HAN.repeat(Math.ceil(n / HAN.length)).slice(0, n)], { width: 320 })
}
add(giants, 'lengths', 'words-100000', ['lorem ipsum dolor '.repeat(5556).slice(0, 100000)], { width: 320 })
add(giants, 'lengths', 'mixed-100000', [(LATIN + ' ' + ARABIC + ' ' + HAN + ' ' + EMOJI + ' ').repeat(800).slice(0, 100000)], { width: 320 })
add(giants, 'lengths', 'one-word-20000', ['ab'.repeat(10000)], { width: 320, overflowWrap: 'anywhere' })

// ---- White space alone, and the characters Canvas replaces ----
const WHITE_SPACES = ['normal', 'pre', 'pre-wrap', 'pre-line', 'nowrap', 'break-spaces'] as const
for (const whiteSpace of WHITE_SPACES) {
  add(lines, 'spaces', `one-space-${whiteSpace}`, [' '], { whiteSpace })
  add(lines, 'spaces', `spaces-${whiteSpace}`, ['          '], { whiteSpace, width: 20 })
  add(lines, 'spaces', `spaces-tabs-newlines-${whiteSpace}`, [' \t \n  \t\t\n\n ' + VT + FF + ' \r\n '], { whiteSpace, width: 40 })
  add(lines, 'spaces', `spaces-around-${whiteSpace}`, ['   a   b   ', { code: '   ' }, '   c'], { whiteSpace, width: 30 })
  add(lines, 'spaces', `other-spaces-${whiteSpace}`, [NBSP + NBSP + 'a' + NNBSP + 'b' + IDEOGRAPHIC_SPACE + IDEOGRAPHIC_SPACE + 'c' + unit(0x2028) + 'd' + unit(0x2029) + 'e' + unit(0x1680) + unit(0x2003)], { whiteSpace, width: 30 })
}
const REPLACED = [SHY, ZWSP, LRM, RLM, LRE + PDF, RLO + PDF, BOM, VT, FF, WJ, ZWJ, ZWNJ]
for (let r = 0; r < REPLACED.length; r++) {
  const x = REPLACED[r]!
  add(lines, 'replaced', `alone-${r}`, [x])
  add(lines, 'replaced', `alone-twice-${r}`, [x + x, x])
  add(lines, 'replaced', `in-latin-${r}`, [x + 'co' + x + 'operate extra' + x + 'ordinary' + x + ' ' + x + 'affluent' + x])
  add(lines, 'replaced', `in-latin-big-${r}`, ['of' + x + 'fice waf' + x + 'fle ' + x + 'AV' + x + 'To'], { font: SERIF_BIG, width: 200 })
  add(lines, 'replaced', `in-segmented-${r}`, [x + 'co' + x + 'operate ' + ARABIC + x + ARABIC + ' ' + x + HAN + x + ' (' + x + ')' + x])
  add(lines, 'replaced', `in-arabic-rtl-${r}`, [ARABIC.replaceAll(' ', x + ' ' + x)], { direction: 'rtl', lang: 'ar' })
  add(lines, 'replaced', `spaced-${r}`, ['co' + x + 'operate ' + ARABIC + x + ARABIC + ' ' + THAI + x + THAI], { letterSpacing: 1.5, wordSpacing: 3 })
}

// ---- Joining across a range's edges ----
const BEH = ch(0x0628), KASRA = ch(0x0650), ALEF = ch(0x0627), LAM = ch(0x0644)
add(lines, 'joining', 'beh-run', [BEH.repeat(40)], { overflowWrap: 'anywhere', width: 60 })
add(lines, 'joining', 'beh-run-marks', [(BEH + KASRA).repeat(30)], { overflowWrap: 'anywhere', width: 60 })
add(lines, 'joining', 'lam-alef', [(LAM + ALEF).repeat(30) + ' ' + (LAM + KASRA + ALEF).repeat(10)], { overflowWrap: 'anywhere', width: 60, direction: 'rtl' })
add(lines, 'joining', 'beh-across-spans', [BEH.repeat(5), { code: BEH.repeat(5) }, BEH + ZWJ, ZWJ + BEH, BEH + ZWNJ + BEH], { wordBreak: 'break-all', width: 50 })
add(lines, 'joining', 'beh-big', [(BEH + BEH + KASRA + LAM + ALEF + ' ').repeat(12)], { font: SERIF_BIG, width: 260, direction: 'rtl', lang: 'ar' })
add(lines, 'joining', 'beh-spaced', [(BEH + BEH + KASRA + LAM + ALEF + ' ').repeat(12)], { letterSpacing: 2, width: 100 })
add(lines, 'joining', 'adlam', [ch(0x1e900, 0x1e922, 0x1e923, 0x1e924, 0x1e944).repeat(12)], { overflowWrap: 'anywhere', width: 80, direction: 'rtl' })
add(lines, 'joining', 'mongolian-nnbsp', [ch(0x1820, 0x1821, 0x202f, 0x1822, 0x1823).repeat(10) + ' ' + NNBSP + ' a' + NNBSP + 'b'], { letterSpacing: 1, width: 80 })
add(lines, 'joining', 'syriac-nko', [ch(0x0712, 0x0713, 0x0714, 0x0020, 0x07ca, 0x07cb, 0x07cc).repeat(10)], { overflowWrap: 'anywhere', width: 60 })

// ---- Surrogates ----
const HIGH = unit(0xd83d), LOW = unit(0xde00)
add(lines, 'surrogates', 'lone-high', [HIGH])
add(lines, 'surrogates', 'lone-low', [LOW])
add(lines, 'surrogates', 'lone-inside', ['ab' + HIGH + 'cd ' + LOW + 'ef ' + LOW + HIGH + ' gh' + HIGH], { overflowWrap: 'anywhere', width: 30 })
add(lines, 'surrogates', 'split-across-nodes', ['smile ' + HIGH, LOW + ' and ' + HIGH, { code: LOW + ' code' }], { width: 60 })
add(lines, 'surrogates', 'astral-letters', [ch(0x20000, 0x20001, 0x2a6d6, 0x1d400, 0x1d401, 0x10ffff, 0xe0100, 0x10a00, 0x10a01).repeat(6)], { overflowWrap: 'anywhere', width: 60 })
add(lines, 'surrogates', 'emoji', [(EMOJI + ' ').repeat(6)], { width: 90 })
add(lines, 'surrogates', 'emoji-spaced-big', [(EMOJI + ' ').repeat(4)], { font: SERIF_BIG, letterSpacing: 2, width: 260 })

// ---- Both sides of U+3000 ----
let edge = ''
for (let cp = 0x2fe0; cp <= 0x3020; cp++) edge += ch(cp)
add(lines, 'u3000', 'every-code-point', [edge], { overflowWrap: 'anywhere', width: 80 })
add(lines, 'u3000', 'with-latin-and-arabic', ['a' + ch(0x2fff) + ch(0x3000) + 'b ' + BEH + ch(0x2fff) + BEH + ch(0x3000) + BEH + ch(0x3001) + BEH + ' ' + ch(0x2e80, 0x2eff, 0x2f00, 0x2fd5, 0x2ff0, 0x2ffb, 0x3005, 0x3007, 0x303f)], { width: 60 })
add(lines, 'u3000', 'general-punctuation', [`a${ch(0x2010)}b${ch(0x2011)}c${ch(0x2013)}d${ch(0x2014)}${ch(0x2014)}e${ch(0x2026)}f ${ch(0x201c)}g${ch(0x201d)} ${ch(0x2018)}h${ch(0x2019)} i${ch(0x2044)}j ${ch(0x20ac)}5 ${ch(0x2116)}6 7${ch(0x2030)}`.repeat(3)], { width: 70 })
add(lines, 'u3000', 'marks-first', [ch(0x0301) + 'a' + ch(0x0301, 0x0302) + ' ' + ch(0x0e31) + THAI + ' ' + ch(0x094d) + DEVANAGARI + ' e' + ch(0x20dd) + ' ' + ch(0x302a) + HAN + ch(0x3099)], { width: 80 })

// ---- Scripts and direction ----
const MIXED = `${LATIN} ${ARABIC} (${HEBREW}) 123 ${HAN} ${THAI} ${DEVANAGARI} ${EMOJI} ${ch(0x03b1, 0x03b2, 0x03b3)} ${ch(0x0430, 0x0431, 0x0432)} ${ch(0xac00, 0xac01, 0x1100, 0x1161, 0x11a8)} ${ch(0x3042, 0x30a2, 0xff76, 0xff9e)}`
for (const direction of ['ltr', 'rtl'] as const) {
  add(lines, 'mixed', `plain-${direction}`, [MIXED], { direction, width: 160 })
  add(lines, 'mixed', `spans-${direction}`, [LATIN.slice(0, 30), { code: 'code(' + ARABIC.slice(0, 5) }, ARABIC + ' (', { code: HEBREW + ')' }, ' 123 ' + HAN, { code: HAN + ' ' + THAI }, EMOJI], { direction, width: 160 })
  add(lines, 'mixed', `spaced-${direction}`, [MIXED], { direction, letterSpacing: -0.5, wordSpacing: 4, width: 200 })
  add(lines, 'mixed', `big-${direction}`, [MIXED], { direction, font: SERIF_BIG, width: 420 })
}

// ---- Every break mode over one text ----
const BREAKS = `${LATIN.slice(0, 40)} ${SHY}super${SHY}cali${SHY}fragilistic ${HAN}${ch(0x3041, 0x30fc, 0x3005)} ${ch(0xac00, 0xac01, 0xac02)} a/b-c_d${NBSP}e ${THAI} https://example.com/a/b?c=d&e=f#g 1,000.50${ch(0x20ac)} ${ARABIC}`
const WORD_BREAKS = ['normal', 'break-all', 'keep-all', 'break-word'] as const
const OVERFLOW_WRAPS = ['normal', 'break-word', 'anywhere'] as const
const LINE_BREAKS = ['auto', 'loose', 'normal', 'strict', 'anywhere'] as const
for (const whiteSpace of WHITE_SPACES) for (const wordBreak of WORD_BREAKS) for (const overflowWrap of OVERFLOW_WRAPS) for (const lineBreak of LINE_BREAKS) {
  add(lines, 'modes', `${whiteSpace}-${wordBreak}-${overflowWrap}-${lineBreak}`, [BREAKS.slice(0, 60), { code: BREAKS.slice(60, 90) }, BREAKS.slice(90)], { whiteSpace, wordBreak, overflowWrap, lineBreak, width: 90, lang: lineBreak === 'loose' ? 'ja' : 'en' })
}

const out = process.argv[2]
if (out === undefined) throw new Error('an output path')
writeFileSync(out, lines.join('\n') + '\n')
if (process.argv[3] !== undefined) writeFileSync(process.argv[3], giants.join('\n') + '\n')
console.log(`${lines.length} cases, ${giants.length} giants`)
