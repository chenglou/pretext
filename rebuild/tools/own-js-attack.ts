// An attack on the profiling phase's WebKit changes (research/PROFILING-START.md): texts and styles built to hit the
// edges of each changed function, run through two checkouts in one process under the stand-in Canvas, and compared field
// by field. Tier 1 holds a tree to the recorded cases at their recorded widths; none of those was built against a line
// filled by sums (engines/webkit/lines.ts commitPlainStretch), a family list cut out in stretches (font-family.ts), the
// font checks' found contexts (measure/font-checks.ts) or a kept word segmenter (engines/webkit/breaks.ts).
//
//   bun rebuild/tools/own-js-attack.ts --a=<checkout> --b=<checkout> [--only=families,fill,boundaries] [--grain] [--shard=k/n]
//
// A checkout is any folder that holds rebuild/src. Three parts:
// 1. families: listedFamilies of both trees over hand-made lists and 300,000 seeded random ones from an alphabet of
//    quotes, backslashes, hex digits, every CSS white space, commas, a lone surrogate, NUL and an astral character: the
//    same families or the same error.
// 2. fill: paragraphs (empty runs, only spaces, lone surrogates, soft hyphens, U+200B, mixed direction, dictionary
//    scripts, 100,000 units with and without a break opportunity) in every structure the builders tell apart (one text
//    node, two, one span without edges, a span whose white-space isn't the block's, a padded span, a code span, <br>,
//    <wbr>, an atomic inline), under every white-space, overflow-wrap, word-break and line-break value, plain and
//    inspected, prepared once and filled at many widths, with a list of contexts a paragraph and with one list for all
//    of them. Compared: every Canvas context made and every question (the context's settings and the string) in order,
//    every fillLine result whole (the line's runs, widths, trimmable content, measuredEnd, the next start), linePieces,
//    and inspectLine and paragraphGaps where inspected. -0, NaN and the infinities are kept apart from 0 and null.
// 3. boundaries: widths built to land on a fit test. For every line start a layout reaches and every item after it,
//    the line widths at which that item, and that item with the next, fit exactly, and the float32 neighbours on both
//    sides: a sum taken in another order, or a test of `>` where the builder has `<=`, shows here and nowhere else.
//
// --grain multiplies every stand-in width by 1.0371 and rounds it to float32, so the widths have no short binary
// form and float32 sums round at every step, as a real font's advances at 16px do (the stand-in's are short).
// --shard=k/n runs every n-th paragraph of the fill part from the k-th on, so n processes share it (it is some 26,000
// paragraphs, four times each in both trees). Exit 0 when nothing differs, 1 otherwise; every difference is printed with
// its case and the first differing piece.
import { join, resolve } from 'node:path'
import type * as Library from '../src/index.ts'
import type { FontDecl, InlineNode, LineSlot, Paragraph } from '../src/model.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null) throw new Error(`unknown argument ${raw}`)
  options.set(match[1]!, match[2] ?? '')
}
const treeA = resolve(options.get('a') ?? '')
const treeB = resolve(options.get('b') ?? '')
if (!options.has('a') || !options.has('b')) throw new Error('--a=<checkout> --b=<checkout>')
const only = (options.get('only') ?? 'families,fill,boundaries').split(',')
const GRAIN = options.has('grain') ? 1.0371 : 1
const shard = (options.get('shard') ?? '0/1').split('/').map(Number)

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15'
installStandInCanvas({ userAgent: USER_AGENT, devicePixelRatio: 2, pageLang: 'en' })

// Every context made and every question, in order.
let sequence: string[] = []
type Inner = { measureText(text: string): Record<string, number> } & Record<string, unknown>
const StandIn = (globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Inner } }).OffscreenCanvas
const ATTRIBUTES = ['lang', 'font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction']
class RecordingContext {
  inner: Inner = new StandIn(1, 1).getContext('2d')
  settings: string | null = null
  constructor() { sequence.push('a context made') }
  measureText(text: string): Record<string, number> {
    this.settings ??= ATTRIBUTES.map(name => String(this.inner[name])).join('|')
    sequence.push(`${this.settings}\n${text}`)
    const answer = this.inner.measureText(text)
    if (GRAIN === 1) return answer
    return { ...answer, width: Math.fround(answer['width']! * GRAIN), actualBoundingBoxLeft: Math.fround(answer['actualBoundingBoxLeft']! * GRAIN), actualBoundingBoxRight: Math.fround(answer['actualBoundingBoxRight']! * GRAIN) }
  }
}
for (const name of ATTRIBUTES) {
  Object.defineProperty(RecordingContext.prototype, name, {
    get(this: RecordingContext): unknown { return this.inner[name] },
    set(this: RecordingContext, value: unknown): void {
      this.inner[name] = value
      this.settings = null
    },
  })
}
Object.defineProperty(globalThis, 'OffscreenCanvas', { value: class { getContext(): RecordingContext { return new RecordingContext() } }, configurable: true, writable: true })

type Lib = typeof Library
type Families = { listedFamilies(list: string): unknown }
const libA = await import(join(treeA, 'rebuild/src/index.ts')) as Lib
const libB = await import(join(treeB, 'rebuild/src/index.ts')) as Lib
const familiesA = await import(join(treeA, 'rebuild/src/font-family.ts')) as Families
const familiesB = await import(join(treeB, 'rebuild/src/font-family.ts')) as Families

const env: Library.Environment = { engine: 'webkit', build: libA.PINNED_BUILDS.webkit, devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: null, icuDefaultLocale: null, dictionaryBreaks: { kind: 'intl-segmenter-word' } }

let differences = 0
function differ(where: string, a: string, b: string): void {
  differences++
  if (differences > 40) return
  let at = 0
  while (at < a.length && at < b.length && a[at] === b[at]) at++
  console.log(`DIFFERS ${where}\n  a: ${a.slice(Math.max(0, at - 120), at + 200)}\n  b: ${b.slice(Math.max(0, at - 120), at + 200)}`)
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- 1. families ----

function familiesOf(lib: Families, list: string): string {
  try {
    return JSON.stringify(lib.listedFamilies(list))
  } catch (error) {
    return `throws ${error instanceof Error ? error.message : String(error)}`
  }
}

function attackFamilies(): void {
  const lists = [
    '', ' ', ',', 'a,', ',a', 'a,,b', '"', "'", '"a', "'a", '"a\\', '"a\\"', '"a\\\n b"', '"a\\\r\n b"', '"a\\\f"', 'a\\', 'a\\ b', '\\41 rial', '\\41rial', '\\000041rial', '\\0000411', '\\0 x', '\\110000 x',
    '\\d800 x', '"\\d800"', '"\\41 \\42"', '"\\41  \\42"', 'a\\,b, c', 'Helvetica  Neue ,  serif', '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', "'It\\'s', \"say \\\"hi\\\"\"", 'a"b"', '"a"b', '"a" b',
    '"a" , b', '\t\n\r\fa\t\n\r\f,\t\n\r\fb\t\n\r\f', 'a\u00a0b', 'SANS-SERIF', '"serif"', 'system-ui, -apple-system', '\ud800', '"\ud800"', 'a\u0000b', '"a\u0000b"', '\\', '\\\\', '"\\\\"', '"\\', "'\\'", 'a\\\n', '"a\\\n',
  ]
  const alphabet = ['"', "'", '\\', '\\', ',', ' ', ' ', '\t', '\n', '\r', '\f', 'a', 'B', 'f', '0', '9', 'g', '-', '_', '\u00e9', '\ud83d\ude00', '\ud800', '\u0000', 'serif', 'Helvetica Neue']
  const random = mulberry32(20260920)
  for (let n = 0; n < 300000; n++) {
    let list = ''
    const length = Math.floor(random() * 25)
    for (let i = 0; i < length; i++) list += alphabet[Math.floor(random() * alphabet.length)]!
    lists.push(list)
  }
  let threw = 0
  for (let i = 0; i < lists.length; i++) {
    const a = familiesOf(familiesA, lists[i]!)
    const b = familiesOf(familiesB, lists[i]!)
    if (a.startsWith('throws')) threw++
    if (a !== b) differ(`families ${JSON.stringify(lists[i])}`, a, b)
  }
  console.log(`families: ${lists.length} lists, ${threw} of them rejected by both, ${differences} differences so far`)
}

// ---- 2. fill ----

const FAMILY = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif'
function fontOf(lib: Lib, family: string, size: number, facts: Partial<FontDecl['facts']> = {}): FontDecl {
  return { family, size, weight: 400, style: 'normal', facts: { ...lib.UNKNOWN_FONT_FACTS, ...facts } }
}
type Style = Pick<Paragraph, 'letterSpacing' | 'wordSpacing' | 'whiteSpace' | 'wordBreak' | 'overflowWrap' | 'lineBreak' | 'tabSize'>
const PLAIN: Style = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8 }
type Block = Pick<Paragraph, 'direction' | 'lang' | 'textIndent' | 'textAlign'>
const BLOCK: Block = { direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
// A case is built per library, because a declaration's unknown facts are the library's own object.
type Case = { name: string; build: (lib: Lib) => Paragraph; widths: readonly number[]; slots?: readonly LineSlot[] }

const WIDTHS = [0, 1, 7, 33.3, 60, 150, 320, 1000, 1e9, -10, Infinity, NaN]
const FEW_WIDTHS = [33.3, 150, 320]
const WHITE_SPACES = ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'] as const
const OVERFLOW_WRAPS = ['normal', 'break-word', 'anywhere'] as const
const WORD_BREAKS = ['normal', 'break-all', 'keep-all', 'break-word'] as const
const LINE_BREAKS = ['auto', 'loose', 'normal', 'strict', 'anywhere'] as const

const TEXTS: Array<[string, string]> = [
  ['empty', ''], ['one space', ' '], ['spaces', '     '], ['newline', '\n'], ['space newline space', ' \n '], ['tab', '\t'], ['letter', 'a'], ['letter space', 'a '], ['space letter', ' a'],
  ['double spaces', 'one  two   three    four'], ['leading and trailing', '   The quick brown fox   '], ['nbsp', 'a \u00a0b\u00a0 c\u00a0\u00a0d'], ['tabs', 'a\tb \t c\t\td'],
  ['soft hyphens', 'ex\u00adtra\u00ador\u00addi\u00adnary \u00adthings\u00ad hap\u00ad\u00adpen\u00ad'], ['zwsp', 'a\u200bb \u200b c\u200b\u200bd averyvery\u200blongword\u200b'],
  ['lone surrogates', '\ud800 a \udc00 b\ud800c \udc00\ud800 d\ud83d'], ['nul and controls', 'a\u0000b \u000bc\u000c d\re \u001ff \u007fg'], ['emoji', 'ok \ud83d\udc4d\ud83c\udffd fine \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 yes\ud83c\uddfa\ud83c\uddf8'],
  ['cjk', '\u4eca\u5929\u5929\u6c14\u5f88\u597d\uff0c\u6211\u4eec\u53bb\u516c\u56ed\u3002Hello\u4e16\u754c'], ['arabic mixed', 'abc \u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645 def 123 \u05e9\u05dc\u05d5\u05dd ghi'],
  ['thai', '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35\u0e04\u0e23\u0e31\u0e1a \u0e22\u0e34\u0e19\u0e14\u0e35\u0e17\u0e35\u0e48\u0e44\u0e14\u0e49\u0e23\u0e39\u0e49\u0e08\u0e31\u0e01 ok \u0e02\u0e2d\u0e1a\u0e04\u0e38\u0e13\u0e21\u0e32\u0e01'],
  ['thai mark first', '\u0e31\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35\u0e04\u0e23\u0e31\u0e1a a \u0e2a\u0e27 b \u0e2a\u0e27\u0e31\u0e2a'], ['lao khmer burmese', '\u0eaa\u0eb0\u0e9a\u0eb2\u0e8d\u0e94\u0eb5 \u179f\u17bd\u179f\u17d2\u178a\u17b8\u1787\u17b6\u1799 \u1019\u1004\u103a\u1039\u1002\u101c\u102c\u1015\u102b\u1019\u1004\u103a\u1039\u1002\u101c\u102c\u1015\u102b'],
  ['hyphens and slashes', 'well-known state-of-the-art and/or 3-4 x--y a/b/c https://example.com/a-b/c?d=e&f=g#h'], ['punctuation', '"Wait," she said (quietly)... \u201creally?\u201d \u2014 yes! $5.00 50% #tag @me'],
  ['long word', 'a averyveryveryveryveryveryveryveryveryverylongwordindeedwithoutanybreak b'], ['sentence', 'The quick brown fox jumps over the lazy dog, then naps in the warm sun all day.'],
  ['newlines', 'first line\nsecond  line\n\nfourth line \n fifth'], ['crlf', 'a\r\nb\rc'], ['short words', 'a b c d e f g h i j k l m n o p q r s t u v w x y z'],
  ['space before break', 'aaa bbb  ccc   ddd \u00adeee fff\u200b ggg'],
]
const GIANTS: Array<[string, string]> = [
  ['100,000 units of words', 'The quick brown fox, jumping; over a lazy dog. '.repeat(2128).slice(0, 100000)],
  ['100,000 units of one word', 'abcdefghij'.repeat(10000)],
  ['100,000 spaces', ' '.repeat(100000)],
  ['100,000 units of short words', 'a '.repeat(50000)],
]

function cut(text: string): number {
  const at = text.indexOf(' ', text.length >> 1)
  return at < 0 ? text.length >> 1 : at + 1
}
const EDGE0 = { margin: 0, border: 0, padding: 0 }
const EDGE6 = { margin: 0, border: 0, padding: 6 }
function spanOf(font: FontDecl, style: Style, edge: typeof EDGE0, children: InlineNode[]): InlineNode {
  return { ...style, kind: 'span', font, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children }
}
type Structure = { name: string; content: (lib: Lib, text: string, style: Style) => InlineNode[] }
const STRUCTURES: Structure[] = [
  { name: 'one', content: (_, text) => [{ kind: 'text', text }] },
  { name: 'two', content: (_, text) => [{ kind: 'text', text: text.slice(0, cut(text)) }, { kind: 'text', text: text.slice(cut(text)) }] },
  { name: 'span', content: (lib, text, style) => [spanOf(fontOf(lib, FAMILY, 16), style, EDGE0, [{ kind: 'text', text }])] },
  { name: 'padded span', content: (lib, text, style) => [spanOf(fontOf(lib, FAMILY, 16), style, EDGE6, [{ kind: 'text', text }])] },
  { name: 'code', content: (lib, text, style) => [{ kind: 'text', text: text.slice(0, cut(text)) }, spanOf(fontOf(lib, 'Menlo', 14), style, EDGE6, [{ kind: 'text', text: 'x = y' }]), { kind: 'text', text: text.slice(cut(text)) }] },
  { name: 'br', content: (_, text) => [{ kind: 'text', text: text.slice(0, cut(text)) }, { kind: 'br' }, { kind: 'text', text: text.slice(cut(text)) }] },
  { name: 'wbr', content: (_, text) => [{ kind: 'text', text: text.slice(0, cut(text)) }, { kind: 'wbr' }, { kind: 'text', text: text.slice(cut(text)) }] },
  { name: 'atomic', content: (_, text) => [{ kind: 'text', text: text.slice(0, cut(text)) }, { kind: 'atomic', width: 20, height: 10, marginInlineStart: 1, marginInlineEnd: 2, verticalAlign: 'baseline' } as InlineNode, { kind: 'text', text: text.slice(cut(text)) }] },
]

function paragraphOf(lib: Lib, content: InlineNode[], style: Style, block: Block = BLOCK, font: FontDecl = fontOf(lib, FAMILY, 16)): Paragraph {
  return { ...style, ...block, font, content, lineHeight: 20 }
}

function fillCases(): Case[] {
  const cases: Case[] = []
  // Every structure over every text, under the two styles a chat has.
  for (let t = 0; t < TEXTS.length; t++) {
    for (let s = 0; s < STRUCTURES.length; s++) {
      for (const overflowWrap of ['normal', 'break-word'] as const) {
        const style = { ...PLAIN, overflowWrap }
        cases.push({ name: `${TEXTS[t]![0]} | ${STRUCTURES[s]!.name} | overflow-wrap ${overflowWrap}`, build: lib => paragraphOf(lib, STRUCTURES[s]!.content(lib, TEXTS[t]![1], style), style), widths: WIDTHS, slots: [{ width: 150, left: 20, right: 10 }] })
      }
    }
  }
  // Every break mode over every text, in the two structures the simple builder takes.
  for (let t = 0; t < TEXTS.length; t++) {
    for (const whiteSpace of WHITE_SPACES) for (const overflowWrap of OVERFLOW_WRAPS) for (const wordBreak of WORD_BREAKS) for (const lineBreak of LINE_BREAKS) {
      const style = { ...PLAIN, whiteSpace, overflowWrap, wordBreak, lineBreak }
      for (let s = 0; s < 3; s += 2) {
        cases.push({ name: `${TEXTS[t]![0]} | ${STRUCTURES[s]!.name} | ${whiteSpace} ${overflowWrap} ${wordBreak} ${lineBreak}`, build: lib => paragraphOf(lib, STRUCTURES[s]!.content(lib, TEXTS[t]![1], style), style), widths: FEW_WIDTHS })
      }
    }
  }
  // A span without edges whose white-space isn't the block's: the simple builder runs inside it under the block's style.
  for (let t = 0; t < TEXTS.length; t++) {
    for (const block of WHITE_SPACES) for (const inner of WHITE_SPACES) {
      if (block === inner) continue
      for (const overflowWrap of ['normal', 'break-word'] as const) {
        cases.push({
          name: `${TEXTS[t]![0]} | block ${block}, span ${inner} | overflow-wrap ${overflowWrap}`, widths: WIDTHS,
          build: lib => paragraphOf(lib, [spanOf(fontOf(lib, FAMILY, 16), { ...PLAIN, overflowWrap, whiteSpace: inner }, EDGE0, [{ kind: 'text', text: TEXTS[t]![1] }])], { ...PLAIN, overflowWrap, whiteSpace: block }),
        })
      }
    }
  }
  // One axis at a time over every text: spacing, direction, indent, alignment, language, tab size, family lists, given facts.
  const axes: Array<[string, (lib: Lib, text: string) => Paragraph]> = [
    ['letter-spacing 1.5', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], { ...PLAIN, letterSpacing: 1.5 })],
    ['letter-spacing -0.5', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], { ...PLAIN, letterSpacing: -0.5 })],
    ['letter-spacing -0.5 in a span', (lib, text) => paragraphOf(lib, [spanOf(fontOf(lib, FAMILY, 16), { ...PLAIN, letterSpacing: -0.5 }, EDGE0, [{ kind: 'text', text }])], PLAIN)],
    ['word-spacing 2', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], { ...PLAIN, wordSpacing: 2 })],
    ['word-spacing -1', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], { ...PLAIN, wordSpacing: -1 })],
    ['rtl', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, { ...BLOCK, direction: 'rtl' })],
    ['text-indent 20', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, { ...BLOCK, textIndent: 20 })],
    ['justify', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, { ...BLOCK, textAlign: 'justify' })],
    ['center', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, { ...BLOCK, textAlign: 'center' })],
    ['lang ja', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, { ...BLOCK, lang: 'ja' })],
    ['lang th', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, { ...BLOCK, lang: 'th' })],
    ['lang empty', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, { ...BLOCK, lang: '' })],
    ['tab-size 0, pre-wrap', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], { ...PLAIN, whiteSpace: 'pre-wrap', tabSize: 0 })],
    ['facts given', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, BLOCK, fontOf(lib, FAMILY, 16, { primaryFamily: 'Helvetica Neue', monospace: false, mapsHyphen: true }))],
    ['monospace given', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, BLOCK, fontOf(lib, 'Menlo, monospace', 13, { primaryFamily: 'Menlo', monospace: true }))],
    ['size 11.5', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, BLOCK, fontOf(lib, FAMILY, 11.5))],
  ]
  const lists = ['serif', 'SANS-SERIF', '"serif"', 'system-ui, -apple-system, "Segoe UI"', 'Menlo', "'Courier New', monospace", 'Helvetica  Neue ,Arial', '\\48 elvetica Neue, "Pi\\6e gFang TC"', '"A \\"quoted\\" name", \'It\\\'s\', fantasy', 'ui-monospace, "Geeza Pro"', 'Unknown Family One, Unknown\\ Two, cursive', '"unclosed', 'trailing\\']
  for (let i = 0; i < lists.length; i++) axes.push([`family ${lists[i]}`, (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN, BLOCK, fontOf(lib, lists[i]!, 16))])
  for (let t = 0; t < TEXTS.length; t++) for (let a = 0; a < axes.length; a++) cases.push({ name: `${TEXTS[t]![0]} | ${axes[a]![0]}`, build: lib => axes[a]![1](lib, TEXTS[t]![1]), widths: FEW_WIDTHS })
  // Several declarations in one paragraph, so one call resolves more than one and a page's list holds their contexts.
  cases.push({
    name: 'three declarations, two languages', widths: FEW_WIDTHS,
    build: lib => paragraphOf(lib, [
      { kind: 'text', text: 'plain ex\u00adtra ' }, spanOf(fontOf(lib, 'Menlo', 14), PLAIN, EDGE6, [{ kind: 'text', text: 'code \u0628\u0628' }]),
      { ...spanOf(fontOf(lib, 'Georgia, serif', 18), PLAIN, EDGE0, [{ kind: 'text', text: ' \u4eca\u5929 serif' }, spanOf(fontOf(lib, 'Menlo', 14), PLAIN, EDGE0, [{ kind: 'text', text: ' again' }])]), lang: 'ja' } as InlineNode,
    ], PLAIN),
  })
  for (let g = 0; g < GIANTS.length; g++) {
    for (const [whiteSpace, overflowWrap] of [['normal', 'break-word'], ['normal', 'normal'], ['pre-wrap', 'anywhere'], ['break-spaces', 'normal']] as const) {
      const style = { ...PLAIN, whiteSpace, overflowWrap }
      cases.push({ name: `${GIANTS[g]![0]} | ${whiteSpace} ${overflowWrap}`, build: lib => paragraphOf(lib, [{ kind: 'text', text: GIANTS[g]![1] }], style), widths: [60, 320, 1e9] })
    }
  }
  return cases
}

// JSON with -0, NaN and the infinities kept apart from 0 and null.
function exact(_: string, value: unknown): unknown {
  if (typeof value !== 'number') return value
  if (Object.is(value, -0)) return '-0'
  return Number.isFinite(value) ? value : String(value)
}

const LINE_CAP = 200000

// What a tree makes of a case: one string per step, in order.
function run(lib: Lib, c: Case, inspect: boolean, contexts: Library.Context[]): string[] {
  const out: string[] = []
  sequence = []
  try {
    const prepared = lib.prepare(c.build(lib), env, inspect, contexts)
    if (inspect) out.push(`gaps ${JSON.stringify(lib.paragraphGaps(prepared), exact)}`)
    const slots: LineSlot[] = [...c.widths.map(width => ({ width, left: 0, right: 0 })), ...(c.slots ?? [])]
    for (let w = 0; w < slots.length; w++) {
      let lines = 0
      for (let start = lib.firstLine(prepared); start !== null;) {
        const filled = lib.fillLine(prepared, start, slots[w]!)
        out.push(`${slots[w]!.width} ${JSON.stringify(filled, exact)}`)
        if (filled.kind === 'line') {
          out.push(`pieces ${JSON.stringify(lib.linePieces(prepared, filled.line), exact)}`)
          if (inspect) out.push(`inspection ${JSON.stringify(lib.inspectLine(prepared, filled.line), exact)}`)
        }
        start = filled.next
        if (++lines > LINE_CAP) {
          out.push('line cap')
          break
        }
      }
    }
  } catch (error) {
    out.push(`throws ${error instanceof Error ? error.message : String(error)}`)
  }
  out.push(`questions ${sequence.length}`)
  for (let i = 0; i < sequence.length; i++) out.push(sequence[i]!)
  return out
}

function compare(where: string, a: string[], b: string[]): void {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue
    differ(`${where}, step ${i}`, a[i] ?? '(nothing)', b[i] ?? '(nothing)')
    return
  }
}

function attackFill(): void {
  const cases = fillCases().filter((_, i) => i % shard[1]! === shard[0]!)
  let steps = 0
  let threw = 0
  for (const inspect of [false, true]) {
    // A list of contexts a paragraph, then one list for every paragraph, which a tree keeps across the cases.
    for (const shared of [false, true]) {
      const listA: Library.Context[] = []
      const listB: Library.Context[] = []
      for (let i = 0; i < cases.length; i++) {
        const a = run(libA, cases[i]!, inspect, shared ? listA : [])
        const b = run(libB, cases[i]!, inspect, shared ? listB : [])
        steps += a.length
        if (a.some(step => step.startsWith('throws'))) threw++
        compare(`fill ${inspect ? 'inspected' : 'plain'}, ${shared ? 'one list' : 'a list a paragraph'}: ${cases[i]!.name}`, a, b)
      }
      console.log(`fill ${inspect ? 'inspected' : 'plain'}, ${shared ? 'one list' : 'a list a paragraph'}: ${cases.length} paragraphs done, ${differences} differences so far`)
    }
  }
  console.log(`fill: ${cases.length} paragraphs x plain and inspected x two kinds of context list, ${steps} steps compared, ${threw} runs threw in both trees, ${differences} differences so far`)
}

// ---- 3. boundaries ----

const bits = new Int32Array(1)
const float = new Float32Array(bits.buffer)
// The float32 `steps` places after `value` (before it when negative), for a positive value.
function neighbour(value: number, steps: number): number {
  float[0] = value
  bits[0] = bits[0]! + steps
  return float[0]!
}

type Item = { kind: string; width?: number | null; isWhitespace?: boolean }

function attackBoundaries(): void {
  const f32 = Math.fround
  const texts = ['aaa bbb ccc ddd eee fff ggg hhh', 'The quick brown fox jumps over the lazy dog, then naps.', 'a bb ccc dddd eeeee ffffff ggggggg', 'one  two three\u00adfour five\u200bsix seven', 'it is so, no? ok. we do; he is: a-b c/d']
  const shapes: Array<[string, (lib: Lib, text: string) => Paragraph]> = [['one', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], PLAIN)], ['one, break-word', (lib, text) => paragraphOf(lib, [{ kind: 'text', text }], { ...PLAIN, overflowWrap: 'break-word' })]]
  for (const block of WHITE_SPACES) for (const inner of WHITE_SPACES) {
    shapes.push([`block ${block}, span ${inner}`, (lib, text) => paragraphOf(lib, [spanOf(fontOf(lib, FAMILY, 16), { ...PLAIN, whiteSpace: inner }, EDGE0, [{ kind: 'text', text }])], { ...PLAIN, whiteSpace: block })])
  }
  let widthsTried = 0
  for (let t = 0; t < texts.length; t++) {
    for (let s = 0; s < shapes.length; s++) {
      const preparedA = libA.prepare(shapes[s]![1](libA, texts[t]!), env, false, [])
      const preparedB = libB.prepare(shapes[s]![1](libB, texts[t]!), env, false, [])
      const items = (preparedA as unknown as { state: { items: Item[] } }).state.items
      const fill = (lib: Lib, prepared: Library.Prepared, width: number): string[] => {
        const out: string[] = []
        for (let start = lib.firstLine(prepared); start !== null;) {
          const filled = lib.fillLine(prepared, start, { width, left: 0, right: 0 })
          out.push(JSON.stringify(filled, exact))
          start = filled.next
        }
        return out
      }
      // The line starts the layouts at a few widths reach.
      const starts = new Set<number>([0])
      for (const width of [40, 60, 90, 150, 320]) {
        for (let start = libA.firstLine(preparedA); start !== null;) {
          const filled = libA.fillLine(preparedA, start, { width, left: 0, right: 0 })
          start = filled.next
          if (start !== null && start.engine === 'webkit' && start.offset === 0) starts.add(start.itemIndex)
        }
      }
      const widths = new Set<number>()
      for (const from of starts) {
        let right = 0
        for (let i = from; i < items.length && i < from + 14; i++) {
          const item = items[i]!
          if (item.kind !== 'text' || item.width === null || item.width === undefined) {
            if (item.kind === 'text') break
            continue
          }
          if (right === 0 && item.isWhitespace === true) continue
          const next = items[i + 1]
          const targets = [f32(right + item.width)]
          if (next !== undefined && next.kind === 'text' && typeof next.width === 'number') targets.push(f32(right + f32(item.width + next.width)), f32(f32(right + item.width) + next.width))
          for (let k = 0; k < targets.length; k++) for (let step = -6; step <= 6; step++) {
            const lineRight = neighbour(targets[k]!, step)
            // The builders test against float32(width + 1/64): the doubles around the width that lands on lineRight.
            for (const nudge of [-1e-7, 0, 1e-7]) widths.add(lineRight - 1 / 64 + nudge)
          }
          right = f32(right + item.width)
        }
      }
      for (const width of widths) {
        widthsTried++
        const a = fill(libA, preparedA, width)
        const b = fill(libB, preparedB, width)
        compare(`boundary ${JSON.stringify(texts[t])} | ${shapes[s]![0]} | width ${width}`, a, b)
      }
    }
  }
  console.log(`boundaries: ${texts.length} texts x ${shapes.length} shapes, ${widthsTried} widths on a fit test or a float32 step beside one, ${differences} differences so far`)
}

if (only.includes('families')) attackFamilies()
if (only.includes('fill')) attackFill()
if (only.includes('boundaries')) attackBoundaries()
console.log(differences === 0 ? 'nothing differs' : `${differences} differences`)
process.exit(differences === 0 ? 0 : 1)
