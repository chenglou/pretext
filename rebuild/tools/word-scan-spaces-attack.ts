// A second attack on Gecko's word scan (src/engines/gecko/lines.ts wordScan), on what word-scan-attack.ts draws thinly:
// every space-like character, inside words, under every spacing and white-space value. The word scan's spacing
// condition reads the port's own spacing data and lists no characters, so the question is whether some character's
// spacing, trimming or break reaches a scan in a way the walk over units doesn't see. Gecko's word spacing reaches
// U+0020 and U+00A0, and a collapsed tab, return or line feed (IsCSSWordSpacingSpace, nsTextFrame.cpp:879-898); only
// U+0020 and U+00A0 cut shaping units (IsBoundarySpace, gfxFont.cpp:3317-3330), so every other space is inside a word;
// the break scan trims by the glyph flag of U+0020 and U+3000 (gfxShapedText::SetupClusterBoundaries), not by
// IsTrimmableSpace, which has U+1680 too (nsTextFrame.cpp:904-913).
// Drawn: U+0020, U+00A0, U+1680, U+2000 to U+200A, U+202F, U+205F, U+3000, U+200B, a tab and a line feed, each alone,
// doubled, before U+200D, U+200C, a combining mark and a bidi control, at a word's start, middle and end, and between
// words; word spacing from -30 to 20px and letter spacing; every white-space value, pre-wrap and break-spaces most
// often; every overflow-wrap, word-break and line-break value; words split over spans with other spacing; both
// directions. The Canvas is constructed: each character its own positive advance, no pair adjustments, so the word
// scan's premise holds and any difference is a condition that is wrong.
// Each paragraph is laid out plain by the `loop` copy (tools/word-scan-variants.ts) and the tree's library, and inspected
// by the tree's library, which must give the plain lines and report no negative-word-tail (gaps.ts negativeWordTail), at
// drawn widths and at the widths where any line's break moves under the loop, each with the au before and after.
//
//   bun rebuild/tools/word-scan-spaces-attack.ts [--seed=1] [--count=20000] [--out=<report.json>]
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PINNED_BUILDS, type GeckoEnvironment } from '../src/env.ts'
import * as treeEngine from '../src/engines/gecko/index.ts'
import { createContextPool } from '../src/measure/canvas.ts'
import { UNKNOWN_FONT_FACTS, type FontDecl, type InlineNode, type LineBreak, type OverflowWrap, type Paragraph, type TextStyle, type WhiteSpace, type WordBreak } from '../src/model.ts'
import { wordScanVariant, type WordScanTally } from './word-scan-variants.ts'

type Engine = typeof treeEngine
const engineOf = async (variant: 'loop' | 'counted'): Promise<Engine> => await import(join(wordScanVariant(variant), 'engines/gecko/index.ts')) as Engine
const ENGINES = { loop: await engineOf('loop'), tree: treeEngine, counted: await engineOf('counted') }
const tally = ((globalThis as { wordScanTally?: WordScanTally }).wordScanTally ??= { decided: 0, left: 0, passed: 0 })

const options = new Map<string, string>()
for (let i = 2; i < process.argv.length; i++) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(process.argv[i]!)
  if (match === null) throw new Error(`Unknown argument ${process.argv[i]}`)
  options.set(match[1]!, match[2] ?? '')
}
const seed = Number(options.get('seed') ?? 1)
const count = Number(options.get('count') ?? 20000)

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

// ---- The constructed Canvas: a positive advance a character, by size; marks, join and bidi controls have none ----

const IGNORABLE = /^[\p{M}\p{Default_Ignorable_Code_Point}]$/u
// U+200B to U+200F, U+2028 to U+202E and U+2060 to U+2069 too: zero width space, join and bidi controls, separators.
const noAdvance = (cp: number): boolean => cp < 0x20 || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2069) || IGNORABLE.test(String.fromCodePoint(cp))
function advanceOf(cp: number, size: number): number {
  if (noAdvance(cp)) return 0
  const em = cp === 0x20 || cp === 0xa0 ? 0.25 : cp === 0x3000 || cp === 0x2003 || cp === 0x2001 ? 1 : cp === 0x2002 || cp === 0x2000 ? 0.5 : cp === 0x200a ? 0.1
    : cp >= 0x2004 && cp <= 0x2009 ? 0.2 : cp === 0x202f || cp === 0x205f ? 0.22 : cp === 0x1680 ? 0.45 : cp > 0x2e80 ? 1 : 0.3 + ((cp * 37) % 23) / 64
  return Math.round(size * 60 * em)
}

let asked = 0
class Ctx {
  font = ''; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'; fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string) {
    asked++
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)![1])
    const spacing = Math.round(Number.parseFloat(this.letterSpacing) * 60)
    let total = 0
    for (const ch of text) {
      const advance = advanceOf(ch.codePointAt(0)!, size)
      if (advance > 0) total += advance + spacing
    }
    return { width: total / 60, actualBoundingBoxLeft: 0, actualBoundingBoxRight: total / 60 }
  }
}
;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext() { return new Ctx() } }

// ---- Paragraphs ----

const c = (...codes: number[]): string => String.fromCodePoint(...codes)
const SPACE_LIKE = [0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x200b, 0x09, 0x0a]
// What follows a space: nothing, a join control, a mark, a bidi control and then one of them, a second space.
const AFTER = ['', '', '', c(0x200d), c(0x200c), c(0x301), c(0x200e, 0x200d), c(0x200f, 0x301), c(0x200e), c(0xa0), ' ', c(0x3000), c(0x200d, 0x200d)]
const LETTERS = ['a', 'bb', 'ccc', 'dddd', 'mmmmmm', 'i', 'x-y', 'well-known', c(0x65e5, 0x672c, 0x8a9e), c(0x645, 0x631, 0x62d, 0x628, 0x627), c(0x5e9, 0x5dc, 0x5d5, 0x5dd), 'supercalifragilisticexpialidocious', 'a.b', '1,000']

const space = (): string => c(chance(0.35) ? pick([0x20, 0xa0]) : pick(SPACE_LIKE)) + pick(AFTER)

function word(): string {
  let text = chance(0.15) ? space() : ''
  const parts = 1 + int(3)
  for (let i = 0; i < parts; i++) {
    if (i > 0) text += space()
    text += pick(LETTERS)
  }
  return chance(0.15) ? text + space() : text
}

function words(): string {
  const length = 1 + int(6)
  let text = ''
  for (let i = 0; i < length; i++) text += (i > 0 ? (chance(0.7) ? ' ' : space()) : '') + word()
  return text
}

const WHITE_SPACE: readonly WhiteSpace[] = ['normal', 'normal', 'pre-wrap', 'pre-wrap', 'break-spaces', 'break-spaces', 'pre-line', 'nowrap', 'pre']
const WORD_BREAK: readonly WordBreak[] = ['normal', 'normal', 'normal', 'break-all', 'keep-all', 'break-word']
const OVERFLOW_WRAP: readonly OverflowWrap[] = ['normal', 'break-word', 'break-word', 'anywhere']
const LINE_BREAK: readonly LineBreak[] = ['auto', 'auto', 'auto', 'loose', 'strict', 'anywhere']
const FONT: FontDecl = { family: 'Optima', size: 16, weight: 400, style: 'normal', facts: { ...UNKNOWN_FONT_FACTS, opticalSizeAxis: false } }

function style(): TextStyle {
  return {
    font: chance(0.8) ? FONT : { ...FONT, family: 'Arial', size: 21.5 }, letterSpacing: chance(0.85) ? 0 : pick([-1, 0.5, 3]), wordSpacing: pick([0, -2, -8, -20, -30, -30, 5, 20]),
    whiteSpace: pick(WHITE_SPACE), wordBreak: pick(WORD_BREAK), overflowWrap: pick(OVERFLOW_WRAP), lineBreak: pick(LINE_BREAK), tabSize: pick([8, 4, 0]),
  }
}

function paragraph(): Paragraph {
  const block = style()
  const content: InlineNode[] = []
  const parts = 1 + int(2)
  for (let i = 0; i < parts; i++) {
    const text = words()
    if (chance(0.6)) {
      content.push({ kind: 'text', text })
      continue
    }
    // A span that starts and ends anywhere, inside words and between a space and what follows it.
    const a = int(text.length + 1)
    const b = a + int(text.length - a + 1)
    const edge = { margin: 0, border: 0, padding: 0 }
    const span = chance(0.4) ? block : { ...style(), whiteSpace: chance(0.7) ? block.whiteSpace : pick(WHITE_SPACE) }
    content.push({ kind: 'text', text: text.slice(0, a) })
    content.push({ ...span, kind: 'span', lang: null, inlineStart: edge, inlineEnd: chance(0.7) ? edge : { margin: 0, border: 1, padding: 3 }, verticalAlign: 'baseline', children: [{ kind: 'text', text: text.slice(a, b) }] })
    content.push({ kind: 'text', text: text.slice(b) })
  }
  return { ...block, content, lang: 'en', direction: chance(0.2) ? 'rtl' : 'ltr', lineHeight: 20, textIndent: chance(0.85) ? 0 : pick([10, -5]), textAlign: pick(['start', 'start', 'justify', 'end']) }
}

// ---- Layout by one library ----

const env: GeckoEnvironment = {
  engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: 'en-us',
  dictionaryBreaks: { kind: 'unavailable' },
}

// A layout's lines, as ranges or with their pieces, and on an inspected paragraph its negative-word-tail gaps.
type Laid = { lines: string[]; error: string | null; gaps: number }

function layout(p: Paragraph, widthAu: number, engine: Engine, rangesOnly: boolean, inspect = false): Laid {
  const lines: string[] = []
  let gaps = 0
  try {
    const prepared = engine.prepare(p, env, inspect, createContextPool())
    let guard = 0
    for (let start = engine.firstLine(prepared); start !== null;) {
      const filled = engine.fillLine(prepared, start, { width: widthAu / 60, left: 0, right: 0 })
      if (filled.kind !== 'line') throw new Error('below floats without floats')
      lines.push(rangesOnly ? `${filled.start}-${filled.end}` : JSON.stringify({ start: filled.start, end: filled.end, box: filled.hasLineBox, pieces: engine.linePieces(prepared, filled.line) }))
      for (const gap of filled.line.inspect?.gaps ?? []) if (gap.gap === 'negative-word-tail') gaps++
      if (++guard > 2000) break
      start = filled.next
    }
  } catch (error) {
    return { lines, error: error instanceof Error ? error.message : String(error), gaps }
  }
  return { lines, error: null, gaps }
}

// The first width after `lo` where some line's break moves under the loop, with the au around it.
function threshold(p: Paragraph, lo: number, hi: number, into: number[]): void {
  const ranges = (widthAu: number): string | null => {
    const laid = layout(p, widthAu, ENGINES.loop, true)
    return laid.error !== null ? null : laid.lines.join(' ')
  }
  const first = ranges(lo)
  if (first === null || first === ranges(hi)) return
  let l = lo
  let h = hi
  while (h - l > 1) {
    const mid = (l + h) >> 1
    if (ranges(mid) === first) l = mid
    else h = mid
  }
  into.push(l, h, l - 1, h + 1)
}

// ---- The run ----

const report = {
  seed, count, paragraphs: 0, layouts: 0, lines: 0, loopErrors: 0, scans: { decided: 0, left: 0, passed: 0 }, differing: 0, modes: 0, gapped: 0,
  examples: [] as { paragraph: Paragraph; widthAu: number; loop: string[]; tree: string[]; gaps: number }[],
}
const same = (a: Laid, b: Laid): boolean => a.error === b.error && a.lines.length === b.lines.length && a.lines.every((line, i) => line === b.lines[i])
for (let n = 0; n < count; n++) {
  const p = paragraph()
  const widths = [600 + int(1800), 2400 + int(6000), 9000 + int(20000)]
  for (let k = 0; k < 8; k++) {
    const from = 300 + int(16000)
    threshold(p, from, from + 300 + int(2400), widths)
  }
  report.paragraphs++
  for (let w = 0; w < widths.length; w++) {
    const widthAu = Math.max(1, widths[w]!)
    const loop = layout(p, widthAu, ENGINES.loop, false)
    if (loop.error !== null) {
      report.loopErrors++
      continue
    }
    report.layouts++
    report.lines += loop.lines.length
    const tree = layout(p, widthAu, ENGINES.tree, false)
    const inspected = layout(p, widthAu, ENGINES.tree, false, true)
    if (!same(tree, layout(p, widthAu, ENGINES.counted, false))) throw new Error('the counted copy gives other lines than the tree')
    if (!same(tree, inspected)) report.modes++
    if (inspected.gaps > 0) report.gapped++
    if (!same(loop, tree)) {
      report.differing++
      if (report.examples.length < 40) report.examples.push({ paragraph: p, widthAu, loop: loop.lines, tree: tree.lines, gaps: inspected.gaps })
    }
  }
}
report.scans = { decided: tally.decided, left: tally.left, passed: tally.passed }
const out = options.get('out')
if (out !== undefined && out !== '') writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`)
console.log(`[word-scan-spaces-attack] seed ${seed}: ${report.paragraphs} paragraphs, ${report.layouts} layouts, ${report.lines} lines, ${asked} Canvas calls; ${report.loopErrors} layouts failed under the loop`)
console.log(`  plain scans: ${report.scans.decided} decided by the word scan, ${report.scans.passed} words passed over on the premise; ${report.scans.left} left to the loop`)
console.log(`  layouts that differ from the loop's: ${report.differing}; inspected layouts with the gap ${report.gapped}; inspected lines other than plain ${report.modes}`)
for (let i = 0; i < Math.min(8, report.examples.length); i++) {
  const e = report.examples[i]!
  console.log(`  differs at ${e.widthAu} au: ${JSON.stringify(e.paragraph.content).slice(0, 300)} ws=${e.paragraph.wordSpacing} ls=${e.paragraph.letterSpacing} ${e.paragraph.whiteSpace} ${e.paragraph.overflowWrap} ${e.paragraph.wordBreak}; gaps ${e.gaps}`)
}
process.exit(report.differing > 0 || report.gapped > 0 || report.modes > 0 ? 1 : 0)
