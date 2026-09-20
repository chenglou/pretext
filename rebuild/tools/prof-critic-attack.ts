// The profiling phase's review of the Gecko port's free fixes: two checkouts held against each other on paragraphs the
// recorded cases don't hold, built to reach the edges of the functions the fixes changed (the script a piece itemizes to
// alone, the character properties of U+0000 to U+00FF, the spacing step's walk over frames). Tier 1 holds a checkout to
// the recorded cases at their recorded widths; this tool runs any paragraph at any width through both checkouts in one
// process over the stand-in Canvas (tools/stand-in-canvas.ts), in lockstep, and compares
// - every Canvas question in order: each context made, each attribute assigned to it, each string measured in it;
// - the prepared paragraph field by field after `prepare` and again after every fill (typed arrays, lists, records);
// - every fill result, its pieces and, on an inspected paragraph, its inspection and the paragraph's gaps;
// - an error's message where one side throws.
// It also compares every exported function of engines/gecko/props.ts over all of Unicode, which is the whole proof of a
// change to that file. The stand-in's answers aren't a browser's: equality says the two checkouts compute the same from
// the same answers and ask the same, which is what "free" means, and says nothing of Firefox.
//
//   bun rebuild/tools/prof-critic-attack.ts --a=<checkout> --b=<checkout> [--random=3000] [--seed=1] [--ignore=tText]
//     [--long=100000] [--only=<name>,<name>] [--out=<report.json>]
//
// A checkout is a folder that holds rebuild/src. `--ignore` names fields of the prepared paragraph one side doesn't have.
// Exit 0 when nothing differs, 1 when something does; each difference is printed with its paragraph's name and path.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { installStandInCanvas } from './stand-in-canvas.ts'

type Library = typeof import('../src/index.ts')
type Props = Record<string, unknown>
type Paragraph = import('../src/model.ts').Paragraph
type InlineNode = import('../src/model.ts').InlineNode
type FontDecl = import('../src/model.ts').FontDecl
type TextStyle = import('../src/model.ts').TextStyle

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const treeA = resolve(options.get('a') ?? '')
const treeB = resolve(options.get('b') ?? '')
const ignored = new Set((options.get('ignore') ?? '').split(',').filter(name => name !== ''))
const randomCount = Number(options.get('random') ?? '3000')
const longUnits = Number(options.get('long') ?? '100000')

// ---- The questions, in order ----

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0'
const ATTRIBUTES = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction']
let log: string[] = []

// A context that writes what it is asked to `log` and asks the stand-in's. `id` is its place among the contexts its side
// made for the paragraph, which is what the comparison of two prepared paragraphs sees of it.
let side = 0
function loggingCanvas(): void {
  const StandIn = (globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Record<string, unknown> } }).OffscreenCanvas
  const made = [0, 0]
  class LoggingContext {
    id = made[side]!++
    constructor() {
      Object.defineProperty(this, 'inner', { value: new StandIn(1, 1).getContext('2d'), enumerable: false })
      log.push(`context ${this.id}`)
    }
    measureText(text: string): unknown {
      log.push(`${this.id} measure ${JSON.stringify(text)}`)
      return ((this as unknown as { inner: { measureText(text: string): unknown } }).inner).measureText(text)
    }
  }
  for (let a = 0; a < ATTRIBUTES.length; a++) {
    const name = ATTRIBUTES[a]!
    Object.defineProperty(LoggingContext.prototype, name, {
      get(this: { inner: Record<string, unknown> }): unknown { return this.inner[name] },
      set(this: { id: number; inner: Record<string, unknown> }, value: unknown): void { log.push(`${this.id} ${name} = ${String(value)}`); this.inner[name] = value },
    })
  }
  ;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class { getContext(): unknown { return new LoggingContext() } }
}

// ---- Field by field ----

type Difference = { path: string; a: string; b: string }

const show = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value).slice(0, 120)
  if (typeof value === 'object' && value !== null) return Object.prototype.toString.call(value)
  return String(value)
}

// The first difference between two values, or null. Objects met before on this path pair are taken as equal, so a cycle
// ends. Functions are equal when both are functions.
function firstDifference(a: unknown, b: unknown, path: string, seen: Map<object, object>): Difference | null {
  if (Object.is(a, b)) return null
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (typeof a === 'function' && typeof b === 'function') return null
    return { path, a: show(a), b: show(b) }
  }
  if (seen.get(a) === b) return null
  seen.set(a, b)
  if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b)) return { path, a: show(a), b: show(b) }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>
    const y = b as unknown as ArrayLike<number>
    if (x.length !== y.length) return { path: `${path}.length`, a: String(x.length), b: String(y.length) }
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return { path: `${path}[${i}]`, a: String(x[i]), b: String(y[i]) }
    return null
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return { path: `${path}.length`, a: String(a.length), b: String(b.length) }
    for (let i = 0; i < a.length; i++) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`, seen)
      if (found !== null) return found
    }
    return null
  }
  if (a instanceof Map && b instanceof Map) return firstDifference([...a.entries()], [...b.entries()], `${path}<map>`, seen)
  if (a instanceof Set && b instanceof Set) return firstDifference([...a.values()], [...b.values()], `${path}<set>`, seen)
  const keysA = Object.keys(a).filter(key => !ignored.has(key)).sort()
  const keysB = Object.keys(b).filter(key => !ignored.has(key)).sort()
  if (keysA.join(' ') !== keysB.join(' ')) return { path: `${path}<keys>`, a: keysA.join(' '), b: keysB.join(' ') }
  for (let k = 0; k < keysA.length; k++) {
    const key = keysA[k]!
    const found = firstDifference((a as Props)[key], (b as Props)[key], `${path}.${key}`, seen)
    if (found !== null) return found
  }
  return null
}

// Two logs of questions: the first place they part, with the question before it.
function firstOtherQuestion(a: readonly string[], b: readonly string[], path: string): Difference | null {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { path: `${path}[${i}] after ${i > 0 ? a[i - 1]! : 'nothing'}`, a: a[i]!, b: b[i]! }
  if (a.length !== b.length) return { path: `${path}[${n}] after ${n > 0 ? a[n - 1]! : 'nothing'}`, a: a[n] ?? 'no more questions', b: b[n] ?? 'no more questions' }
  return null
}

// ---- The paragraphs ----

const UNKNOWN = { primaryFamily: null, mapsHyphen: null, monospace: null, opticalSizeAxis: null, joining: null, pairKerning: null }
const FONTS: FontDecl[] = [
  { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: UNKNOWN },
  { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: UNKNOWN },
  { family: 'Georgia, "Hiragino Mincho ProN", serif', size: 18, weight: 700, style: 'italic', facts: UNKNOWN },
  { family: '"Apple SD Gothic Neo"', size: 18, weight: 700, style: 'normal', facts: { ...UNKNOWN, pairKerning: 'split' } },
  { family: 'system-ui', size: 13, weight: 400, style: 'normal', facts: UNKNOWN },
]
const WHITE_SPACE = ['normal', 'pre', 'pre-wrap', 'pre-line', 'nowrap', 'break-spaces'] as const
const WORD_BREAK = ['normal', 'break-all', 'keep-all', 'break-word'] as const
const OVERFLOW_WRAP = ['normal', 'break-word', 'anywhere'] as const
const LINE_BREAK = ['auto', 'loose', 'normal', 'strict', 'anywhere'] as const
const LANGS = ['en', 'ja', 'ko', 'zh-TW', 'ar', '', 'th', 'tr']
const WIDTHS = [0, 1, 17, 60, 120, 320, 1000, 1000000]

const deep = (n: number): string => '('.repeat(n) + '\u6f22deep\u5b57' + ')'.repeat(n)

// Texts by what they reach. Every changed function reads transformed text a piece at a time, so most are words without
// spaces that an in-word break cuts at every cluster.
const TEXTS: string[] = [
  // Nothing, and white space alone.
  '', ' ', '    ', '\n', '\t', ' \t\n \r ', '\u00a0', '\u3000', ' \u0301', '\u00a0\u0308x',
  // U+0000..U+00FF: every property read by index. Controls, soft hyphens, the no-break space, Latin-1 letters and signs.
  'Hello world', 'a', 'The quick brown fox (jumps) over [the] {lazy} dog. 7:00-9:00 fi ffl office waffle',
  ' 7:00-9:00', '7:00-9:00 (12) [34] {56}', 'na\u00efve caf\u00e9 \u00bfqu\u00e9? \u00abguillemets\u00bb \u00aa\u00ba\u00b5\u00b7\u00d7\u00f7\u00df\u00ff',
  'extra\u00adordi\u00adnary\u00ad', 'a\u00a0b\u00a0\u00a0c', '\u0001\u0008\u000b\u000c\u001f\u007f\u0080\u0085\u009f\u00a0\u00ad', 'x\u0000y', 'tab\there\t\tand\tthere',
  'https://example.com/a/very/long/path/that-goes-on?query=string&other=value#fragment-of-the-url',
  // Latin past U+02EA, Greek, Cyrillic, scripts changing inside a word.
  '\u1e7c\u1e17\u1ebd \u01c5 \u02ea\u02eb \u0250\u02b8\u02b9\u02e0\u02e4\u02e5', '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac \u0420\u0443\u0441\u0441\u043a\u0438\u0439', 'abc\u0414\u0415\u0424\u6f22\u5b57\u03b1\u03b2\u03b3def', 'a\u6f22b\u5b57c\u304bd\u30abe',
  '12345\u6f22\u5b5767890', '...\u6f22...', '\u6f22\u5b57123', '123abc\u1e00456',
  // Han, kana (Hiragana itemizes as Katakana), Hangul, marks and signs that belong to several scripts.
  '\u6f22\u5b57\u304b\u306a\u30ab\u30ca\u3001\u3002\u300c\u62ec\u5f27\u300d\uff08\u5168\u89d2\uff09\u30fc\u3005\u3006', '\u65e5\u672c\u8a9e\u306e\u30c6\u30ad\u30b9\u30c8\u3067\u3059\u3002\u3053\u308c\u306f\u9577\u3044\u6587\u7ae0\u3067\u3059\u3002',
  '\u304b\u306a\u3060\u3051\u306e\u3072\u3089\u304c\u306a', '\u30ab\u30bf\u30ab\u30ca\u30c0\u30b1', '\u30fc\u304b\u30fc\u30ab\u30fc', '\u3001\u304b\u3002\u30ab', '\u304b\u3099\u306f\u309a\u30ab\u3099', '\u3099\u304b', '\uff76\uff80\uff76\uff85\uff9e\uff9f\uff70',
  '\ud55c\uad6d\uc5b4 \ud14d\uc2a4\ud2b8 \u1112\u1161\u11ab', '\u4e00\u3000\u4e8c\u3000\u3000\u4e09',
  // Paired brackets: the itemizer's stack of 32, unmatched and crossed pairs, brackets that start a piece.
  deep(3), deep(31), deep(32), deep(33), deep(40), ')(][}{', '\uff08\u6f22\uff09\u5b57)', '(\u6f22]\u5b57)', '\u300ca\u300d\u300e\u304b\u300f', '\u27e8x\u27e9\u3008\u6f22\u3009', '((\u0645\u0631\u062d\u0628\u0627))', ')\u6f22(', '\u6f22(\u304b)\u30ab(a)\u0645',
  // Joining scripts, marks, digits, join controls, cursive scripts that take no letter spacing.
  '\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645 123 (\u0639\u0631\u0628\u064a) \u060c \u061f', '\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u0651\u064e\u0670\u0647\u0650', '\u0661\u0662\u0663\u066b\u0664', '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645', '\u0628\u200d \u200d\u0628', '\u0628\u0640\u0640\u0628', '\u0652\u0633',
  '\u0634\u0644\u0645\u0710 \u072b\u0720\u0721\u0710\u0730', '\u07d0\u07d1\u07d2\u07eb', '\u1820\u1821\u1822\u180e\u1823', '\u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd (\u05d1\u05d3\u05d9\u05e7\u05d4) 123', 'abc \u05d0\u05d1\u05d2 def \u0627\u0628\u062c 456',
  '\u202dabc\u05d0\u05d1\u05d2\u202c', '\u202e123456\u202c', '\u2067\u05d0(\u05d1)\u2069', 'a\u200eb\u200fc\u061cd', '\u05d0\u05d1\u05d2' + '1234567890'.repeat(6),
  // Scripts without spaces, conjuncts, marks that belong to many scripts.
  '\u0928\u092e\u0938\u094d\u0924\u0947 \u0926\u0941\u0928\u093f\u092f\u093e \u0915\u094d\u0937\u0924\u094d\u0930\u093f\u092f', '\u0915\u0951\u1cd0\u0964\u0965', '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35\u0e0a\u0e32\u0e27\u0e42\u0e25\u0e01\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22', '\u1781\u17d2\u1789\u17bb\u17c6', '\u1019\u103c\u1014\u103a\u1019\u102c', '\u0f56\u0f7c\u0f51\u0f0b\u0f61\u0f72\u0f42',
  // Emoji and other characters above U+FFFF: Common, Han, Hiragana, Gothic, mathematical letters, private use.
  '\ud83d\udc4d\ud83c\udffd', '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66', '\ud83c\uddef\ud83c\uddf5\ud83c\uddfa\ud83c\uddf8', '\u263a\ufe0e\u263a\ufe0f 1\ufe0f\u20e3', 'ok\ud83d\ude00ok\ud83d\ude00',
  '\ud840\udc00\ud840\udc01\u6f22', '\ud82c\udc01\u304b', '\ud800\udf30\ud800\udf31', '\ud835\udc9c\ud835\udcb7', '\udb80\udc00\udb80\udc01', '1\ud840\udc00', '(\ud82c\udc01)',
  // Surrogates alone, at every place of a piece.
  '\ud840', '\udc00', 'a\ud83d', '\ude00b', '\ud840\ud840\udc00', '\udc00\ud840', '\u6f22\ud840', '\udc00\u5b57', '12\ud840', '\ud82c', '\udc01\u304b',
  // Private use, unassigned, noncharacters, the object and replacement characters.
  '\ue000\ue001\uf8ff', '\u0378\u0379', '\uffff\ufffe', '\ufffc\ufffd', 'a\ue000b',
  // Characters that end a shaping unit, and a mark or U+202F right after one.
  'a\u2060\u0301\u200b\u0308\u093eb', 'x\u2028\u202f', 'a\u2029b', 'a\u200bb\u200b\u200bc', '\ufeffa\ufeff', 'a\u200b\u0301b', '\u6f22\u200b\u3099\u304b', 'a\u202fb',
  // Marks alone and marks first.
  '\u0301', '\u0301a', 'a\u0301\u0302\u0303', 'e\u0301\u00e9', '\u20dd', '\u093e\u0915',
]

// A generator of the same numbers for a seed (mulberry32).
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Named = { name: string; paragraph: Paragraph; widths: number[] }

function styleOf(next: () => number, font: FontDecl): TextStyle {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!
  const plain = next() < 0.5
  return {
    font,
    letterSpacing: plain ? 0 : pick([0, 0, 1.5, -0.5, 4]),
    wordSpacing: plain ? 0 : pick([0, 0, 3, -1]),
    whiteSpace: pick(WHITE_SPACE),
    wordBreak: pick(WORD_BREAK),
    overflowWrap: pick(OVERFLOW_WRAP),
    lineBreak: pick(LINE_BREAK),
    tabSize: pick([8, 4, 0]),
  }
}

function randomParagraph(next: () => number, name: string): Named {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!
  const block = styleOf(next, pick(FONTS))
  // A text of one to four pooled texts, joined with or without a space, so pieces of different scripts meet in a word.
  const text = (): string => {
    let out = ''
    const parts = 1 + Math.floor(next() * 4)
    for (let i = 0; i < parts; i++) out += (i > 0 && next() < 0.5 ? ' ' : '') + pick(TEXTS)
    return out
  }
  const nodes = (depth: number): InlineNode[] => {
    const out: InlineNode[] = []
    const count = 1 + Math.floor(next() * 4)
    for (let i = 0; i < count; i++) {
      const kind = next()
      if (kind < 0.55 || depth >= 2) out.push({ kind: 'text', text: text() })
      else if (kind < 0.85) {
        // A span with the block's style or one of its own; most share the block's font, so text runs cross them.
        const style = next() < 0.5 ? block : styleOf(next, next() < 0.6 ? block.font : pick(FONTS))
        const edge = next() < 0.7 ? { margin: 0, border: 0, padding: 0 } : { margin: pick([0, 2, -1]), border: pick([0, 1]), padding: pick([0, 6]) }
        out.push({ ...style, kind: 'span', lang: next() < 0.7 ? null : pick(LANGS), inlineStart: edge, inlineEnd: edge, verticalAlign: next() < 0.9 ? 'baseline' : '0px', children: nodes(depth + 1) })
      } else if (kind < 0.9) out.push({ kind: 'atomic', width: 20, height: 12, marginInlineStart: 1, marginInlineEnd: 2 })
      else if (kind < 0.95) out.push({ kind: 'br' })
      else out.push({ kind: 'wbr' })
    }
    return out
  }
  const paragraph: Paragraph = {
    ...block, content: nodes(0), lang: pick(LANGS), direction: next() < 0.75 ? 'ltr' : 'rtl', lineHeight: 20,
    textIndent: next() < 0.8 ? 0 : 10, textAlign: next() < 0.8 ? 'start' : 'justify',
  }
  const widths = [pick(WIDTHS), pick(WIDTHS), pick(WIDTHS)]
  return { name, paragraph, widths }
}

function builtParagraphs(): Named[] {
  const out: Named[] = []
  const base = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const block = (content: InlineNode[], more: Partial<Paragraph>): Paragraph => ({ ...base, font: FONTS[0]!, content, lang: 'en', direction: 'ltr', lineHeight: 20, textIndent: 0, textAlign: 'start', ...more })
  const span = (children: InlineNode[], more: Partial<TextStyle>): InlineNode => ({ ...base, font: FONTS[0]!, ...more, kind: 'span', lang: null, inlineStart: { margin: 0, border: 0, padding: 0 }, inlineEnd: { margin: 0, border: 0, padding: 0 }, verticalAlign: 'baseline', children })
  // Every pooled text alone: in the chat's style, with every cluster a break, preserved, spaced, right to left, in Korean.
  for (let i = 0; i < TEXTS.length; i++) {
    const text = TEXTS[i]!
    out.push({ name: `text ${i} chat`, paragraph: block([{ kind: 'text', text }], {}), widths: WIDTHS })
    out.push({ name: `text ${i} break-all`, paragraph: block([{ kind: 'text', text }], { wordBreak: 'break-all', overflowWrap: 'anywhere' }), widths: [1, 60, 320] })
    out.push({ name: `text ${i} pre-wrap spaced`, paragraph: block([{ kind: 'text', text }], { whiteSpace: 'pre-wrap', letterSpacing: 1.5, wordSpacing: 3, tabSize: 4 }), widths: [1, 60, 320] })
    out.push({ name: `text ${i} rtl ko`, paragraph: block([{ kind: 'text', text }], { direction: 'rtl', lang: 'ko', font: FONTS[3]!, lineBreak: 'anywhere' }), widths: [1, 60, 320] })
    out.push({ name: `text ${i} every break mode`, paragraph: block([{ kind: 'text', text }], { whiteSpace: WHITE_SPACE[i % 6]!, wordBreak: WORD_BREAK[i % 4]!, overflowWrap: OVERFLOW_WRAP[i % 3]!, lineBreak: LINE_BREAK[i % 5]! }), widths: [17, 120] })
  }
  // A surrogate pair cut by a node boundary, in one text run and in two, with Common characters before it.
  const halves: Array<[string, string]> = [['\u6f22\ud840', '\udc00\u5b57'], ['12\ud840', '\udc00'], ['\ud840', '\udc00'], ['(\ud82c', '\udc01)\u304b'], ['a\ud83d', '\ude00b'], ['\u304b \ud840', '\udc00 \u304b']]
  for (let i = 0; i < halves.length; i++) {
    const [first, second] = halves[i]!
    out.push({ name: `split pair ${i} two leaves`, paragraph: block([{ kind: 'text', text: first }, { kind: 'text', text: second }], { overflowWrap: 'anywhere' }), widths: [1, 60, 320] })
    out.push({ name: `split pair ${i} span`, paragraph: block([{ kind: 'text', text: first }, span([{ kind: 'text', text: second }], {})], { wordBreak: 'break-all' }), widths: [1, 60, 320] })
    out.push({ name: `split pair ${i} spaced span`, paragraph: block([span([{ kind: 'text', text: first }], { letterSpacing: 2 }), span([{ kind: 'text', text: second }], { letterSpacing: 1 })], { wordBreak: 'break-all' }), widths: [1, 60, 320] })
    out.push({ name: `split pair ${i} other font`, paragraph: block([{ kind: 'text', text: first }, span([{ kind: 'text', text: second }], { font: FONTS[1]! })], { wordBreak: 'break-all' }), widths: [1, 60, 320] })
  }
  // The spacing step: spacing that changes at every frame, empty leaves and spans between them, tabs, marks that start
  // a node after a cursive letter, a space before a mark at a node's end, bidi splits inside a spaced node.
  const spaced = (ls: number, ws: number, text: string): InlineNode => span([{ kind: 'text', text }], { letterSpacing: ls, wordSpacing: ws })
  out.push({ name: 'spacing per span', paragraph: block([spaced(2, 0, 'ab cd'), spaced(0, 5, ' ef gh '), { kind: 'text', text: '' }, spaced(-1, -2, 'ij\tkl'), span([], { letterSpacing: 3 }), spaced(4, 4, '\u0633'), spaced(1, 1, '\u0652\u0633 '), spaced(2, 2, '\u0301x')], { whiteSpace: 'pre-wrap' }), widths: WIDTHS })
  out.push({ name: 'spacing bidi', paragraph: block([spaced(2, 3, 'abc \u05d0\u05d1\u05d2 def \u0627\u0628\u062c 123 '), { kind: 'text', text: '\u05d3\u05d4 xyz' }, spaced(1, 0, '\u202eabc\u202c \ud83d\ude00\u0628\ud83d\ude00')], { direction: 'rtl' }), widths: WIDTHS })
  out.push({ name: 'spacing tabs', paragraph: block([spaced(2, 3, 'a\tb\u0628\t\ud803\udd00\ud803\udd01\tc'), { kind: 'br' }, spaced(0, 0, '\t\tx'), { kind: 'atomic', width: 20, height: 12, marginInlineStart: 0, marginInlineEnd: 0 }, spaced(3, 1, 'y \u0308z\t')], { whiteSpace: 'pre', tabSize: 4 }), widths: WIDTHS })
  out.push({ name: 'spacing pre-line', paragraph: block([spaced(2, 3, 'one two\nthree  four \n five'), { kind: 'wbr' }, spaced(1, 1, 'six\u00adseven\u00ad\u0301eight')], { whiteSpace: 'pre-line' }), widths: WIDTHS })
  // Only spaces, in every white-space mode; nothing at all.
  for (let i = 0; i < WHITE_SPACE.length; i++) out.push({ name: `only spaces ${WHITE_SPACE[i]!}`, paragraph: block([{ kind: 'text', text: '     ' }, span([{ kind: 'text', text: '  \t \n ' }], { letterSpacing: 1, wordSpacing: 2 })], { whiteSpace: WHITE_SPACE[i]! }), widths: [0, 17, 320] })
  out.push({ name: 'no content', paragraph: block([], {}), widths: [320] })
  out.push({ name: 'empty span', paragraph: block([span([], {})], {}), widths: [320] })
  // Long paragraphs: words of several scripts, and one unit without a space.
  const words = ['lorem', 'ipsum', '(dolor)', '7:00-9:00', '\u6f22\u5b57\u304b\u306a', '\u0645\u0631\u062d\u0628\u0627', 'caf\u00e9', '\ud83d\ude00', 'office', '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35']
  let long = ''
  for (let i = 0; long.length < longUnits; i++) long += (i > 0 ? ' ' : '') + words[i % words.length]!
  out.push({ name: `long words ${long.length} units`, paragraph: block([{ kind: 'text', text: long }], {}), widths: [320] })
  let unit = ''
  for (let i = 0; unit.length < 4000; i++) unit += i % 7 === 3 ? '\uff08\u304b\uff09' : i % 5 === 2 ? 'ab1' : '\u6f22\u5b57'
  out.push({ name: `long unit ${unit.length} units`, paragraph: block([{ kind: 'text', text: unit }], {}), widths: [320] })
  return out
}

// ---- The run ----

type Side = { lib: Library; label: string }
type Found = { name: string; inspect: boolean; stage: string; difference: Difference }

function attempt<T>(run: () => T): { value: T } | { error: string } {
  try {
    return { value: run() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

// One paragraph through both checkouts in lockstep: the first difference, or null.
function runOne(sides: [Side, Side], named: Named, inspect: boolean, counts: { questions: number; lines: number; errors: number }): { stage: string; difference: Difference } | null {
  const standIn = installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: 'en' })
  loggingCanvas()
  try {
    const prepared: unknown[] = []
    const logs: string[][] = []
    for (let s = 0; s < 2; s++) {
      log = []
      side = s
      const lib = sides[s]!.lib
      prepared.push(attempt(() => {
        const detected = lib.detectEnvironment({ engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: 'zh-hans-us' })
        if (detected.kind === 'unsupported') throw new Error(detected.reason)
        return lib.prepare(named.paragraph, detected.env, inspect, [])
      }))
      logs.push(log)
    }
    counts.questions += logs[0]!.length
    let found = firstOtherQuestion(logs[0]!, logs[1]!, 'questions(prepare)')
    if (found !== null) return { stage: 'prepare', difference: found }
    found = firstDifference(prepared[0], prepared[1], 'prepared', new Map())
    if (found !== null) return { stage: 'prepare', difference: found }
    const a = prepared[0] as { value: import('../src/index.ts').Prepared } | { error: string }
    const b = prepared[1] as typeof a
    if ('error' in a || 'error' in b) { counts.errors++; return null }
    if (inspect) {
      found = firstDifference(attempt(() => sides[0]!.lib.paragraphGaps(a.value)), attempt(() => sides[1]!.lib.paragraphGaps(b.value)), 'paragraphGaps', new Map())
      if (found !== null) return { stage: 'gaps', difference: found }
    }
    for (let w = 0; w < named.widths.length; w++) {
      const width = named.widths[w]!
      const results: unknown[][] = [[], []]
      for (let s = 0; s < 2; s++) {
        log = []
        side = s
        const lib = sides[s]!.lib
        const value = (s === 0 ? a : b).value
        results[s]!.push(attempt(() => {
          const lines: unknown[] = []
          for (let start = lib.firstLine(value); start !== null;) {
            const filled = lib.fillLine(value, start, { width, left: 0, right: 0 })
            if (filled.kind === 'below-floats') throw new Error('below floats without an inset')
            lines.push(filled, lib.linePieces(value, filled.line))
            if (inspect) lines.push(lib.inspectLine(value, filled.line))
            start = filled.next
          }
          return lines
        }))
        logs[s] = log
      }
      counts.questions += logs[0]!.length
      found = firstOtherQuestion(logs[0]!, logs[1]!, `questions(fill ${width})`)
      if (found !== null) return { stage: `fill ${width}`, difference: found }
      found = firstDifference(results[0], results[1], `lines(${width})`, new Map())
      if (found !== null) return { stage: `fill ${width}`, difference: found }
      const first = results[0]![0] as { value: unknown[] } | { error: string }
      if ('error' in first) counts.errors++
      else counts.lines += first.value.length / (inspect ? 3 : 2)
      found = firstDifference(a.value, b.value, `prepared(after ${width})`, new Map())
      if (found !== null) return { stage: `after fill ${width}`, difference: found }
    }
    return null
  } finally {
    standIn.restore()
  }
}

// Every exported function of engines/gecko/props.ts on every code point (and for the two-argument ones, with every script
// name the itemizer can hold), and on what isn't a code point: a caller that reads past a string's end hands in NaN.
function compareProps(a: Props, b: Props): Found[] {
  const found: Found[] = []
  const scripts = ['Zyyy', 'Zinh', 'Zzzz', 'Latn', 'Kana', 'Hira', 'Hani', 'Arab', 'Deva', 'Hang', 'Grek', 'Cyrl', 'Beng', 'Bopo', 'Yiii']
  const names = Object.keys(a).sort()
  if (names.join(' ') !== Object.keys(b).sort().join(' ')) found.push({ name: 'props', inspect: false, stage: 'exports', difference: { path: 'exports', a: names.join(' '), b: Object.keys(b).sort().join(' ') } })
  for (let n = 0; n < names.length; n++) {
    const name = names[n]!
    const fa = a[name]
    const fb = b[name]
    if (typeof fa !== 'function' || typeof fb !== 'function') continue
    const callA = fa as (cp: number, script?: string) => unknown
    const callB = fb as (cp: number, script?: string) => unknown
    const extra = callA.length === 2 ? scripts : [undefined]
    let first: Difference | null = null
    for (let e = 0; e < extra.length && first === null; e++) {
      const inputs = [NaN, 0x110000, 0x7fffffff]
      for (let i = 0; i < inputs.length && first === null; i++) if (!Object.is(callA(inputs[i]!, extra[e]), callB(inputs[i]!, extra[e]))) first = { path: `${name}(${inputs[i]})`, a: String(callA(inputs[i]!, extra[e])), b: String(callB(inputs[i]!, extra[e])) }
      for (let cp = 0; cp <= 0x10ffff && first === null; cp++) if (!Object.is(callA(cp, extra[e]), callB(cp, extra[e]))) first = { path: `${name}(0x${cp.toString(16)}${extra[e] === undefined ? '' : `, ${extra[e]}`})`, a: String(callA(cp, extra[e])), b: String(callB(cp, extra[e])) }
    }
    if (first !== null) found.push({ name: 'props', inspect: false, stage: name, difference: first })
  }
  return found
}

const libA = await import(join(treeA, 'rebuild/src/index.ts')) as Library
const libB = await import(join(treeB, 'rebuild/src/index.ts')) as Library
const sides: [Side, Side] = [{ lib: libA, label: treeA }, { lib: libB, label: treeB }]
const started = Date.now()
const found: Found[] = compareProps(await import(join(treeA, 'rebuild/src/engines/gecko/props.ts')) as Props, await import(join(treeB, 'rebuild/src/engines/gecko/props.ts')) as Props)
console.log(`[attack] props.ts over U+0000..U+10FFFF: ${found.length} functions differ (${Math.round((Date.now() - started) / 100) / 10} s)`)

let paragraphs = builtParagraphs()
const next = generator(Number(options.get('seed') ?? '1'))
for (let i = 0; i < randomCount; i++) paragraphs.push(randomParagraph(next, `random ${i}`))
if (options.has('only')) paragraphs = paragraphs.filter(named => options.get('only')!.split(',').includes(named.name))
const counts = { questions: 0, lines: 0, errors: 0 }
let layouts = 0
for (let i = 0; i < paragraphs.length; i++) {
  for (const inspect of [false, true]) {
    const named = paragraphs[i]!
    // The long paragraphs' inspected form holds every gap of every line: plain alone.
    if (inspect && named.name.startsWith('long')) continue
    layouts += named.widths.length
    const difference = runOne(sides, named, inspect, counts)
    if (difference !== null) found.push({ name: named.name, inspect, ...difference })
  }
}
console.log(`[attack] ${paragraphs.length} paragraphs, plain and inspected, ${layouts} layouts, ${counts.lines} lines, ${counts.questions} Canvas questions and settings compared in order, ${counts.errors} runs that threw the same error on both sides (${Math.round((Date.now() - started) / 100) / 10} s)`)
console.log(`[attack] a = ${treeA}\n[attack] b = ${treeB}\n[attack] ${found.length} differ`)
for (let i = 0; i < Math.min(found.length, 40); i++) {
  const f = found[i]!
  console.log(`  ${f.name} (${f.inspect ? 'inspected' : 'plain'}) at ${f.stage}: ${f.difference.path}: ${f.difference.a} -> ${f.difference.b}`)
}
const out = options.get('out')
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify({ a: treeA, b: treeB, paragraphs: paragraphs.length, layouts, counts, found }, null, 1)}\n`)
process.exit(found.length > 0 ? 1 : 0)
