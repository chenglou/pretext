// Differential harness for incremental text: pre-wrap text split after every
// '\n', each piece keeping its '\n', must prepare into handles whose results
// add up to the whole text's. Also checks the userland recipe through edits and
// streams, that the simple line walker agrees with the complex one, and that a
// streamed markdown chat message that reuses unchanged blocks lays out like
// one parsed from scratch. No browser: a deterministic fake Canvas, one child
// process per engine profile, fixed seeds.
//
// bun run scripts/pieces-differential.ts [--src=<dir>] [--profiles=blink,webkit,gecko,android]
//   [--sections=contract,edits,walker,chat] [--variant=<name>] [--scale=<n>] [--json=<path>]
//
// Variants are canaries that must report differences: naive-split (pieces
// without their '\n', at least one line per non-final piece), stale-font and
// stale-lang (pieces kept across a font load or a <html lang> change),
// chat-stale-font (chat blocks reused across a font load). --src runs another
// source tree, such as main's, and skips the chat section, which imports this
// tree's demo model.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { LayoutCursor, LayoutResult, PreparedText, PreparedTextWithSegments, PrepareOptions } from '../src/layout.ts'
import { TEXTS } from '../src/test-data.ts'

type Lib = typeof import('../src/layout.ts')
type Measurement = typeof import('../src/measurement.ts')

const USER_AGENTS = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
} as const
type Profile = keyof typeof USER_AGENTS
const PROFILES = Object.keys(USER_AGENTS) as Profile[]
const SECTIONS = ['contract', 'edits', 'walker', 'chat'] as const
const VARIANTS = ['none', 'naive-split', 'stale-font', 'stale-lang', 'chat-stale-font'] as const
const DEFAULT_SRC = new URL('../src', import.meta.url).pathname
const FONT = '16px Test'
const LINE_HEIGHT = 20

// --- Userland recipe (README proposal), not a library export ---

export type Piece<P> = { text: string; prepared: P }

// Each piece keeps its '\n', so CR LF stays in one piece.
export function splitPieces(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/)
}

// Keeps equal pieces at the front and back and prepares the pieces between.
export function updatePieces<P>(old: readonly Piece<P>[], text: string, prepareOne: (piece: string) => P): Piece<P>[] {
  const texts = splitPieces(text)
  let front = 0
  while (front < texts.length && front < old.length && texts[front] === old[front]!.text) front++
  let back = 0
  while (
    back < texts.length - front && back < old.length - front &&
    texts[texts.length - 1 - back] === old[old.length - 1 - back]!.text
  ) back++
  const next = new Array<Piece<P>>(texts.length)
  for (let i = 0; i < front; i++) next[i] = old[i]!
  for (let i = 0; i < back; i++) next[texts.length - 1 - i] = old[old.length - 1 - i]!
  for (let i = front; i < texts.length - back; i++) next[i] = { text: texts[i]!, prepared: prepareOne(texts[i]!) }
  return next
}

// The README's recipe: any piece whose text equals an old piece's reuses it.
export function updatePiecesByText<P>(old: readonly Piece<P>[], text: string, prepareOne: (piece: string) => P): Piece<P>[] {
  const byText = new Map<string, Piece<P>>()
  for (const piece of old) byText.set(piece.text, piece)
  return splitPieces(text).map(piece => byText.get(piece) ?? { text: piece, prepared: prepareOne(piece) })
}

export function layoutPieces(
  pieces: readonly Piece<PreparedText>[],
  maxWidth: number,
  lineHeight: number,
  layout: Lib['layout'],
): LayoutResult {
  let lineCount = 0
  for (let i = 0; i < pieces.length; i++) lineCount += layout(pieces[i]!.prepared, maxWidth, lineHeight).lineCount
  return { lineCount, height: lineCount * lineHeight }
}

// --- Arguments ---

function parseArgs(): Map<string, string> {
  const args = new Map<string, string>()
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    args.set(match[1]!, match[2] ?? 'true')
  }
  return args
}

// --- Fake environment: Canvas, document and navigator ---

const canvas = { table: 'fixed' as 'fixed' | 'proportional', calls: 0, units: 0 }
const ignorableRe = /\p{Default_Ignorable_Code_Point}/u
const emojiRe = /\p{Emoji_Presentation}/u
const wideRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFF60]/u
const codePointClasses = new Map<number, number>()

// 0 ignorable, 1 emoji, 2 wide, 3 space, 4 other.
function codePointClass(codePoint: number): number {
  let result = codePointClasses.get(codePoint)
  if (result !== undefined) return result
  const ch = String.fromCodePoint(codePoint)
  result = ignorableRe.test(ch) ? 0 : emojiRe.test(ch) ? 1 : wideRe.test(ch) ? 2 : codePoint === 0x20 ? 3 : 4
  codePointClasses.set(codePoint, result)
  return result
}

// Fixed table: 10 per visible code point, 4 per space, 22 per emoji, 0 for
// default ignorables, -1 for a space after 'o', -2 for 'bc'. Proportional
// table: wide 16, space 4.25, emoji 22, others 5 to 12.875 by a hash, and some
// pairs kern by -0.75. Letter spacing is added per visible code point.
function measureFake(text: string, letterSpacing: number): number {
  canvas.calls++
  canvas.units += text.length
  let width = 0
  let visible = 0
  let previous = 0
  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i)!
    i += codePoint > 0xFFFF ? 2 : 1
    const kind = codePointClass(codePoint)
    if (kind === 0) continue
    visible++
    if (canvas.table === 'fixed') {
      if (kind === 1) width += 22
      else if (kind === 3) width += previous === 0x6F ? 3 : 4
      else width += previous === 0x62 && codePoint === 0x63 ? 8 : 10
    } else {
      width += kind === 1 ? 22 : kind === 2 ? 16 : kind === 3 ? 4.25 : 5 + ((Math.imul(codePoint, 2654435761) >>> 0) % 8) + (codePoint % 8) / 8
      if (previous !== 0 && (previous * 31 + codePoint) % 7 === 0) width -= 0.75
    }
    previous = codePoint
  }
  return width + letterSpacing * visible
}

class FakeContext {
  font = FONT
  letterSpacing = '0px'
  direction = 'ltr'
  fontKerning = 'auto'
  fontStretch = 'normal'
  fontVariantCaps = 'normal'
  textRendering = 'auto'
  wordSpacing = '0px'
  lang = ''
  measureText(text: string): { width: number } {
    return { width: measureFake(text, Number.parseFloat(this.letterSpacing) || 0) }
  }
}

const documentElement = { lang: '' }

function installEnvironment(profile: Profile): void {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { userAgent: USER_AGENTS[profile] } })
  Reflect.set(globalThis, 'OffscreenCanvas', class { getContext(): FakeContext { return new FakeContext() } })
  // Canvas measures an emoji 22px wide and the DOM 18px, so the emoji
  // correction is 4px and its text-wide gate matters.
  Reflect.set(globalThis, 'document', {
    documentElement,
    body: { appendChild(): void {}, removeChild(): void {} },
    createElement: () => ({ style: {}, textContent: '', getBoundingClientRect: () => ({ width: 18 }) }),
  })
}

// --- Seeded generation ---

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length)]!

const TOKEN_GROUPS: readonly (readonly string[])[] = [
  // English
  ['word', 'Word', 'too', 'abc', 'don\'t', 'e.g.', '“quoted”', 'it’s', '–', '—', 'hello', 'o'],
  // CJK
  ['中文', '字', '。', '「', '」', '，', 'ア', 'ー', 'ッ', 'ゃ', '々', '한국어', '（', '）', '\u3000', '日本ァア'],
  // Arabic and Hebrew
  ['عربي', '،', '؟', '\u064B', 'שלום', '־', 'אב 123'],
  // Southeast Asian
  ['ภาษาไทย', 'မာဘာ', 'ខ្មែរ'],
  // Emoji
  ['\u{1F600}', '\u{1F44D}\u{1F3FD}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}', '❤\uFE0F'],
  // Glue and breaks
  ['ab\u00ADcd', '\u00AD', '\u00A0', '\u202F', '\u2060', '\u200B', '\u200D', '\u0301', '\u202A', '\u2066', '\u202C', '\u2069'],
  // URLs
  ['https://a.com/p?q=1&r=2', 'www.a.com/www.b?q=1', 'www.', '?q=1'],
  // Numbers
  ['1,000.5', '1-2-3-4-5x', '3.14', '00:00', '$5', '-5%', '12'],
  // Whitespace, twice as likely
  [' ', ' ', '  ', '\t', '\n', '\n', '\r\n', '\r', '\f', '\u0085', '\u2029'],
  [' ', '\n', ' ', '\n', '\r\n'],
  // Broken input
  ['\uD800', '\uDC00'],
]
const TOKENS = TOKEN_GROUPS.flat()

// Single code points for exhaustive inserts.
const INSERT_ALPHABET = [
  'a', 'o', 'c', ' ', '\n', '\r', '\t', '\f', '\u0085', '\u2029', '\u00AD', '\u00A0', '\u202F', '\u2060', '\u200B',
  '\u200D', '\u0301', '\u202A', '\u2066', '\u2069', '字', '。', '「', 'ア', 'ー', 'ゃ',
  '한', 'ท', 'ا', '،', 'ש', '־', '\u{1F600}', '\u{1F1EF}', '-', '.', '?', '/', '1', '$',
  '%', '(', '\u3000',
]

function randomText(next: () => number, minTokens: number, maxTokens: number): string {
  const n = minTokens + Math.floor(next() * (maxTokens - minTokens + 1))
  let text = ''
  for (let i = 0; i < n; i++) text += pick(next, TOKENS)
  return text
}

const corpusDir = new URL('../corpora/', import.meta.url).pathname
let corpusLines: string[][] | null = null

function corpusSlice(next: () => number, maxLines: number, maxUnits: number): string {
  corpusLines ??= readdirSync(corpusDir).filter(file => file.endsWith('.txt'))
    .map(file => readFileSync(corpusDir + file, 'utf8').split('\n'))
  const lines = pick(next, corpusLines)
  const start = Math.floor(next() * lines.length)
  let text = lines.slice(start, start + 1 + Math.floor(next() * maxLines)).join('\n')
  if (next() < 0.3) text += '\n'
  const codePoints = Array.from(text)
  return codePoints.length > maxUnits ? codePoints.slice(0, maxUnits).join('') : text
}

// --- Reporting ---

type Bucket = { count: number; examples: string[] }
const failures = new Map<string, Bucket>()
const internal = new Map<string, Bucket>()
const counters = new Map<string, number>()

function addTo(map: Map<string, Bucket>, category: string, detail: string): void {
  let bucket = map.get(category)
  if (bucket === undefined) {
    bucket = { count: 0, examples: [] }
    map.set(category, bucket)
  }
  bucket.count++
  if (bucket.examples.length < 3) bucket.examples.push(detail)
}
const fail = (category: string, detail: string): void => addTo(failures, category, detail)
const note = (category: string, detail: string): void => addTo(internal, category, detail)
const count = (name: string, n = 1): void => { counters.set(name, (counters.get(name) ?? 0) + n) }

function show(text: string): string {
  return JSON.stringify(text).replace(/[^\x20-\x7E]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))
}

// --- Library under test ---

let lib: Lib
let lineFitEpsilon = 0

type Handles = { rich: PreparedTextWithSegments; opaque: PreparedText }

// Internal fields read through a loose view, so the harness also runs on trees
// without some of them, such as one without the simple walker's flag.
type HandleView = {
  widths: number[]
  kinds: string[]
  segments?: string[]
  simpleLineWalkFastPath?: boolean
  segLevels: Int8Array | null
  breakableFitAdvances: (number[] | null)[]
  breakablePreferredBreaks: (number[] | null)[]
  entryGeometry?: unknown[] | null
  letterSpacing: number
  spacingGraphemeCounts: number[]
  discretionaryHyphenWidth: number
  discretionaryHyphenContexts: boolean[] | null
  tabStopAdvance: number
  chunks: { startSegmentIndex: number; endSegmentIndex: number; consumedEndSegmentIndex: number }[]
}
const view = (handle: PreparedText): HandleView => handle as unknown as HandleView

function preparer(options: PrepareOptions): (piece: string) => Handles {
  return piece => ({ rich: lib.prepareWithSegments(piece, FONT, options), opaque: lib.prepare(piece, FONT, options) })
}

function countPrepared(old: readonly Piece<Handles>[], next: readonly Piece<Handles>[]): void {
  const kept = new Set(old)
  let prepared = 0
  for (const piece of next) if (!kept.has(piece)) prepared++
  count('pieces prepared', prepared)
  count('pieces reused', next.length - prepared)
}

// --- Comparison ---

const GRID = [1, 5, 23, 47, 61, 90, 150, 320, 400, 5000, Number.POSITIVE_INFINITY]
const QUICK_GRID = [1, 23, 61, 150, Number.POSITIVE_INFINITY]

// The grid plus reference line widths of the whole text, just below, at and
// above their fit limit.
function widthsFor(whole: PreparedTextWithSegments, grid: readonly number[], maxReferences: number): number[] {
  const widths = grid.slice()
  const seen = new Set<number>()
  for (const reference of [Number.POSITIVE_INFINITY, 90]) {
    lib.walkLineRanges(whole, reference, line => {
      if (seen.size >= maxReferences || line.width <= 0 || seen.has(line.width)) return
      seen.add(line.width)
      widths.push(line.width - 2 * lineFitEpsilon, line.width - lineFitEpsilon, line.width + lineFitEpsilon)
    })
  }
  return widths
}

function sameArray<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean = (x, y) => x === y): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!same(a[i]!, b[i]!)) return false
  return true
}
const sameAdvances = (a: number[] | null, b: number[] | null): boolean => a === null || b === null ? a === b : sameArray(a, b)

function rangeKey(width: number, start: LayoutCursor, end: LayoutCursor, shift: number): string {
  return `${width}|${start.segmentIndex + shift}.${start.graphemeIndex}-${end.segmentIndex + shift}.${end.graphemeIndex}`
}

function walkRanges(handle: PreparedTextWithSegments, width: number, shift: number, out: string[]): number {
  return lib.walkLineRanges(handle, width, line => out.push(rangeKey(line.width, line.start, line.end, shift)))
}

function stepRanges(handle: PreparedTextWithSegments, width: number, shift: number, out: string[], label: string): void {
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  for (let guard = 0; guard < 100_000; guard++) {
    const range = lib.layoutNextLineRange(handle, cursor, width)
    if (range === null) return
    out.push(rangeKey(range.width, range.start, range.end, shift))
    cursor = range.end
  }
  fail('api: layoutNextLineRange made no progress', label)
}

function stepLines(handle: PreparedTextWithSegments, width: number, shift: number, out: string[], label: string): void {
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  for (let guard = 0; guard < 100_000; guard++) {
    const line = lib.layoutNextLine(handle, cursor, width)
    if (line === null) return
    out.push(`${show(line.text)}|${rangeKey(line.width, line.start, line.end, shift)}`)
    cursor = line.end
  }
  fail('api: layoutNextLine made no progress', label)
}

function batchLines(handle: PreparedTextWithSegments, width: number, shift: number, out: string[]): number {
  const result = lib.layoutWithLines(handle, width, LINE_HEIGHT)
  for (const line of result.lines) out.push(`${show(line.text)}|${rangeKey(line.width, line.start, line.end, shift)}`)
  return result.lineCount
}

function materializedTexts(handle: PreparedTextWithSegments, width: number, out: string[]): void {
  lib.walkLineRanges(handle, width, range => out.push(lib.materializeLineRange(handle, range).text))
}

function numericDiff(segments: readonly string[], expected: readonly number[], actual: readonly number[]): string {
  const cells: string[] = []
  for (let i = 0; i < expected.length && cells.length < 4; i++) {
    if (expected[i] !== actual[i]) cells.push(`${show(segments[i]!)} whole ${expected[i]} pieces ${actual[i]}`)
  }
  return cells.join(', ')
}

// A prepare() handle holds the same line-breaking data as prepareWithSegments().
function compareOpaque(opaque: HandleView, rich: HandleView, tag: string): void {
  const fields = (h: HandleView): unknown => [h.widths, h.kinds, h.simpleLineWalkFastPath, h.breakableFitAdvances,
    h.breakablePreferredBreaks, h.entryGeometry ?? null, h.letterSpacing, h.spacingGraphemeCounts,
    h.discretionaryHyphenWidth, h.discretionaryHyphenContexts, h.tabStopAdvance, h.chunks]
  if (!Bun.deepEquals(fields(opaque), fields(rich), true) || opaque.segLevels !== null) {
    fail('arrays: prepare() handle differs from prepareWithSegments()', tag)
  }
}

// Compares pieces with a fresh whole-text preparation in the same process.
function compareWithWhole(label: string, text: string, options: PrepareOptions, pieces: readonly Piece<Handles>[], mode: 'full' | 'quick'): void {
  count('comparisons')
  const tag = `${label} ${show(text)} ${JSON.stringify(options)} lang=${show(documentElement.lang)} table=${canvas.table}`
  if (pieces.map(piece => piece.text).join('') !== text) {
    fail('recipe: piece texts do not join to the text', tag)
    return
  }
  const whole = lib.prepareWithSegments(text, FONT, options)
  const wholeOpaque = lib.prepare(text, FONT, options)
  const w = view(whole)
  compareOpaque(view(wholeOpaque), w, tag)

  const segments: string[] = []
  const kinds: string[] = []
  const widths: number[] = []
  const fit: (number[] | null)[] = []
  const preferred: (number[] | null)[] = []
  const spacing: number[] = []
  const hyphen: boolean[] = []
  const entry: unknown[] = []
  const levels: number[] = []
  const chunks: string[] = []
  let offset = 0
  let simplePieceComplexWhole = false
  let nullVsArray = false
  for (const piece of pieces) {
    const p = view(piece.prepared.rich)
    compareOpaque(view(piece.prepared.opaque), p, tag)
    for (let i = 0; i < p.widths.length; i++) {
      segments.push(p.segments![i]!)
      kinds.push(p.kinds[i]!)
      widths.push(p.widths[i]!)
      fit.push(p.breakableFitAdvances[i]!)
      preferred.push(p.breakablePreferredBreaks[i]!)
      hyphen.push(p.discretionaryHyphenContexts?.[i] ?? false)
      entry.push(p.entryGeometry?.[i] ?? null)
      levels.push(p.segLevels?.[i] ?? 0)
    }
    for (const value of p.spacingGraphemeCounts) spacing.push(value)
    for (const chunk of p.chunks) {
      chunks.push(`${chunk.startSegmentIndex + offset}/${chunk.endSegmentIndex + offset}/${chunk.consumedEndSegmentIndex + offset}`)
    }
    if (p.letterSpacing !== w.letterSpacing || p.discretionaryHyphenWidth !== w.discretionaryHyphenWidth || p.tabStopAdvance !== w.tabStopAdvance) {
      fail('arrays: scalar fields differ', tag)
    }
    if (p.simpleLineWalkFastPath === true && w.simpleLineWalkFastPath === false) simplePieceComplexWhole = true
    if (
      (p.discretionaryHyphenContexts === null) !== (w.discretionaryHyphenContexts === null) ||
      ((p.entryGeometry ?? null) === null) !== ((w.entryGeometry ?? null) === null) ||
      (p.segLevels === null) !== (w.segLevels === null)
    ) nullVsArray = true
    offset += p.widths.length
  }
  if (!sameArray(segments, w.segments!) || !sameArray(kinds, w.kinds)) {
    fail('arrays: segments or kinds differ', `${tag}\n  whole  ${w.segments!.map(show).join('|')}\n  pieces ${segments.map(show).join('|')}`)
    return
  }
  if (!sameArray(widths, w.widths)) fail('arrays: widths differ', `${tag} ${numericDiff(segments, w.widths, widths)}`)
  if (!sameArray(fit, w.breakableFitAdvances, sameAdvances)) fail('arrays: breakableFitAdvances differ', tag)
  if (!sameArray(preferred, w.breakablePreferredBreaks, sameAdvances)) fail('arrays: breakablePreferredBreaks differ', tag)
  if (!sameArray(spacing, w.spacingGraphemeCounts)) fail('arrays: spacingGraphemeCounts differ', tag)
  if (!sameArray(hyphen, w.discretionaryHyphenContexts ?? w.widths.map(() => false))) fail('arrays: discretionaryHyphenContexts differ', tag)
  if (!sameArray(entry, w.entryGeometry ?? w.widths.map(() => null), (a, b) => Bun.deepEquals(a, b, true))) fail('arrays: entryGeometry differs', tag)
  if (!sameArray(levels, w.segLevels === null ? w.widths.map(() => 0) : Array.from(w.segLevels))) fail('arrays: segLevels differ', tag)
  const wholeChunks = w.chunks.map(chunk => `${chunk.startSegmentIndex}/${chunk.endSegmentIndex}/${chunk.consumedEndSegmentIndex}`)
  if (!sameArray(chunks, wholeChunks)) note('internal: chunks representation', `${tag} whole ${wholeChunks.join(' ')} pieces ${chunks.join(' ')}`)
  if (simplePieceComplexWhole) note('internal: a piece takes the simple walker, the whole text does not', tag)
  if (nullVsArray) note('internal: optional array null in one, present in the other', tag)

  const opaquePieces = pieces.map(piece => ({ text: piece.text, prepared: piece.prepared.opaque }))
  for (const width of widthsFor(whole, mode === 'full' ? GRID : QUICK_GRID, mode === 'full' ? 6 : 2)) {
    count('width checks')
    const at = `${tag} @${width}`
    const wholeCount = lib.layout(wholeOpaque, width, LINE_HEIGHT).lineCount
    const pieceCount = layoutPieces(opaquePieces, width, LINE_HEIGHT, lib.layout).lineCount
    if (pieceCount !== wholeCount) fail('layout: layout() line counts do not add up', `${at} whole ${wholeCount} pieces ${pieceCount}`)

    const wholeWalk: string[] = []
    const walkCount = walkRanges(whole, width, 0, wholeWalk)
    const wholeSteps: string[] = []
    stepRanges(whole, width, 0, wholeSteps, at)
    const wholeStepLines: string[] = []
    stepLines(whole, width, 0, wholeStepLines, at)
    const wholeBatch: string[] = []
    const batchCount = batchLines(whole, width, 0, wholeBatch)
    const wholeTexts: string[] = []
    materializedTexts(whole, width, wholeTexts)
    if (walkCount !== wholeWalk.length || walkCount !== wholeCount || batchCount !== wholeCount) fail('api: line counts disagree between layout(), walkLineRanges() and layoutWithLines()', at)
    if (!sameArray(wholeSteps, wholeWalk)) fail('api: layoutNextLineRange() differs from walkLineRanges()', at)
    if (!sameArray(wholeStepLines, wholeBatch)) fail('api: layoutNextLine() differs from layoutWithLines()', at)

    const pieceWalk: string[] = []
    const pieceSteps: string[] = []
    const pieceStepLines: string[] = []
    const pieceBatch: string[] = []
    const pieceTexts: string[] = []
    let shift = 0
    let stats = { lineCount: 0, maxLineWidth: 0 }
    for (const piece of pieces) {
      const handle = piece.prepared.rich
      walkRanges(handle, width, shift, pieceWalk)
      stepRanges(handle, width, shift, pieceSteps, at)
      stepLines(handle, width, shift, pieceStepLines, at)
      batchLines(handle, width, shift, pieceBatch)
      materializedTexts(handle, width, pieceTexts)
      const pieceStats = lib.measureLineStats(handle, width)
      stats = { lineCount: stats.lineCount + pieceStats.lineCount, maxLineWidth: Math.max(stats.maxLineWidth, pieceStats.maxLineWidth) }
      shift += view(handle).widths.length
    }
    if (!sameArray(pieceWalk, wholeWalk)) fail('layout: walkLineRanges() differ', `${at}\n  whole  ${wholeWalk.join(' ')}\n  pieces ${pieceWalk.join(' ')}`)
    if (!sameArray(pieceSteps, wholeSteps)) fail('layout: layoutNextLineRange() differ', at)
    if (!sameArray(pieceStepLines, wholeStepLines)) fail('layout: layoutNextLine() differ', at)
    if (!sameArray(pieceBatch, wholeBatch)) fail('layout: layoutWithLines() differ', `${at}\n  whole  ${wholeBatch.join(' ')}\n  pieces ${pieceBatch.join(' ')}`)
    if (!sameArray(pieceTexts, wholeTexts)) fail('layout: materializeLineRange() differ', at)
    const wholeStats = lib.measureLineStats(whole, width)
    if (stats.lineCount !== wholeStats.lineCount || stats.maxLineWidth !== wholeStats.maxLineWidth) {
      fail('layout: measureLineStats() do not add up', `${at} whole ${JSON.stringify(wholeStats)} pieces ${JSON.stringify(stats)}`)
    }
  }
  let natural = 0
  for (const piece of pieces) natural = Math.max(natural, lib.measureNaturalWidth(piece.prepared.rich))
  if (natural !== lib.measureNaturalWidth(whole)) fail('layout: measureNaturalWidth() differs', tag)
}

function snapshot(pieces: readonly Piece<Handles>[]): unknown {
  return structuredClone(pieces.map(piece => [piece.text, piece.prepared.rich, piece.prepared.opaque]))
}

function checkHeld(label: string, pieces: readonly Piece<Handles>[], before: unknown): void {
  count('held-handle checks')
  if (!Bun.deepEquals(snapshot(pieces), before, true)) fail('held: a held piece changed', label)
}

// Canvas calls of the recipe's update against a fresh prepare of the new text,
// each from the same pre-edit caches: empty, then the old text prepared whole
// and as pieces.
function checkCanvasCalls(label: string, before: string, after: string, options: PrepareOptions): void {
  const prepareOne = preparer(options)
  lib.clearCache()
  prepareOne(before)
  const old = updatePieces([], before, prepareOne)
  let start = canvas.calls
  updatePieces(old, after, prepareOne)
  const incremental = canvas.calls - start
  lib.clearCache()
  prepareOne(before)
  updatePieces([], before, prepareOne)
  start = canvas.calls
  prepareOne(after)
  const fresh = canvas.calls - start
  count('canvas checks')
  count('canvas calls, recipe', incremental)
  count('canvas calls, fresh prepare', fresh)
  if (incremental > fresh) {
    fail('canvas: the recipe made more Canvas calls than a fresh prepare', `${label} recipe ${incremental} fresh ${fresh} ${JSON.stringify(options)} ${show(before)} -> ${show(after)}`)
  }
}

// --- Invalidation: userland drops every piece after these ---

let variant: (typeof VARIANTS)[number] = 'none'
const LANGS = ['', 'ja', 'ko']
let langIndex = 0

function fontLoad(): void {
  canvas.table = canvas.table === 'fixed' ? 'proportional' : 'fixed'
  lib.clearCache()
  count('font loads')
}

// Returns the pieces to keep after an invalidation event.
function invalidate(step: number, pieces: Piece<Handles>[]): Piece<Handles>[] {
  switch (step % 3) {
    case 0:
      fontLoad()
      return variant === 'stale-font' ? pieces : []
    case 1:
      langIndex = (langIndex + 1) % LANGS.length
      documentElement.lang = LANGS[langIndex]!
      count('lang changes')
      return variant === 'stale-lang' ? pieces : []
    default:
      lib.setLocale(step % 2 === 0 ? 'ja' : undefined)
      count('setLocale calls')
      return []
  }
}

// --- Section: contract ---

const PRE_WRAP_CONFIGS: PrepareOptions[] = [
  { whiteSpace: 'pre-wrap' },
  { whiteSpace: 'pre-wrap', wordBreak: 'keep-all' },
  { whiteSpace: 'pre-wrap', letterSpacing: 1.5 },
  { whiteSpace: 'pre-wrap', wordBreak: 'keep-all', letterSpacing: 1.5 },
  { whiteSpace: 'pre-wrap', letterSpacing: -0.5 },
  { whiteSpace: 'pre-wrap', wordBreak: 'keep-all', letterSpacing: -0.5 },
]

const TARGETED = [
  'a\n\u00AD\nb', 'a\n\n', '\n', '\n\n', 'a\n\u200B\nb', 'a\n\u200B', 'fo\u200D bar\n\u202Ax', 'fo\u200D bar\nx',
  'x\r\ny', 'x\ry\n', 'www.a.com\n/b', 'ab\u00ADcd\nef', 'אב 123\nabc', 'a\t\n\tb', '1-2\n-3',
  '字 字\n字 字', 'o\u2060 b\n\u2066x', '\u{1F600} a\nb c', 'a\f b\n c', 'a\u0085 b\n\u2029c',
  '日本ァア\n日本ーー', 'ab\u00ADcd \u00ADef\ngh',
]

// The rejected recipe: pieces without their '\n', at least one line for each
// non-final piece.
function checkNaiveSplit(text: string, options: PrepareOptions): void {
  const parts = text.replace(/\r\n|[\r\f]/g, '\n').split('\n').map(part => lib.prepare(part, FONT, options))
  const whole = lib.prepare(text, FONT, options)
  for (const width of GRID) {
    count('comparisons')
    let sum = 0
    for (let i = 0; i < parts.length; i++) {
      const lines = lib.layout(parts[i]!, width, LINE_HEIGHT).lineCount
      sum += i < parts.length - 1 ? Math.max(1, lines) : lines
    }
    const wholeCount = lib.layout(whole, width, LINE_HEIGHT).lineCount
    if (sum !== wholeCount) fail('layout: layout() line counts do not add up', `naive-split ${show(text)} ${JSON.stringify(options)} @${width} whole ${wholeCount} naive ${sum}`)
  }
}

function runContract(profileIndex: number, scale: number): void {
  const next = rng(1000 + profileIndex)
  const texts = [...TARGETED, ...TEXTS.map(item => item.text)]
  for (let i = 0; i < 300 * scale; i++) texts.push(randomText(next, 3, 28))
  for (let i = 0; i < 100 * scale; i++) texts.push(corpusSlice(next, 12, 800))
  for (let t = 0; t < texts.length; t++) {
    if (t > 0 && t % 60 === 0) invalidate(t / 60 - 1, [])
    const text = texts[t]!
    count('contract texts')
    for (const options of PRE_WRAP_CONFIGS) {
      if (variant === 'naive-split') checkNaiveSplit(text, options)
      else compareWithWhole('contract', text, options, updatePieces([], text, preparer(options)), 'full')
    }
  }
}

// --- Section: edits through the recipe ---

function runEdits(profileIndex: number, scale: number): void {
  const next = rng(2000 + profileIndex)
  let config = 0
  const nextOptions = (): PrepareOptions => PRE_WRAP_CONFIGS[config++ % PRE_WRAP_CONFIGS.length]!
  let events = 0

  // Every single-code-point insert at every code unit offset, and every code
  // point deleted, for texts of up to 40 code units.
  for (let t = 0; t < 12 * scale; t++) {
    if (t > 0 && t % 4 === 0) invalidate(events++, [])
    let base = ''
    while (base.length === 0 || base.length > 40 || !base.includes('\n')) base = randomText(next, 2, 8)
    const options = nextOptions()
    const prepareOne = preparer(options)
    const basePieces = updatePieces([], base, prepareOne)
    const held = snapshot(basePieces)
    const step = (label: string, text: string): void => {
      const pieces = updatePieces(basePieces, text, prepareOne)
      countPrepared(basePieces, pieces)
      count('edit steps')
      compareWithWhole(label, text, options, pieces, 'quick')
    }
    for (let offset = 0; offset <= base.length; offset++) {
      for (const insert of INSERT_ALPHABET) step('insert', base.slice(0, offset) + insert + base.slice(offset))
    }
    for (let offset = 0; offset < base.length;) {
      const size = base.codePointAt(offset)! > 0xFFFF ? 2 : 1
      step('delete', base.slice(0, offset) + base.slice(offset + size))
      offset += size
    }
    checkHeld(`exhaustive ${show(base)}`, basePieces, held)
  }

  // Chains of random splices: delete 0-8 code points, insert 0-3 tokens, and
  // sometimes undo the previous splice.
  for (let t = 0; t < 40 * scale; t++) {
    let text = t % 2 === 0 ? randomText(next, 3, 24) : corpusSlice(next, 8, 400)
    const options = nextOptions()
    const prepareOne = preparer(options)
    const update = t % 4 < 2 ? updatePieces : updatePiecesByText
    count(t % 4 < 2 ? 'splice chains, head and tail recipe' : 'splice chains, equal-text recipe')
    let pieces = update([], text, prepareOne)
    let undo: string | null = null
    for (let s = 0; s < 50; s++) {
      const before = text
      if (undo !== null && next() < 0.15) {
        text = undo
        undo = null
        count('undo steps')
      } else {
        const codePoints = Array.from(text)
        const at = Math.floor(next() * (codePoints.length + 1))
        const deleted = Math.floor(next() * 9)
        let insert = ''
        for (let i = Math.floor(next() * 4); i > 0; i--) insert += pick(next, TOKENS)
        text = codePoints.slice(0, at).join('') + insert + codePoints.slice(at + deleted).join('')
        undo = before
      }
      if (s % 25 === 24) pieces = invalidate(events++, pieces)
      const old = pieces
      const held = s % 5 === 0 ? snapshot(old) : null
      pieces = update(old, text, prepareOne)
      countPrepared(old, pieces)
      count('edit steps')
      compareWithWhole('splice', text, options, pieces, 'full')
      if (held !== null) checkHeld(`splice ${show(before)} -> ${show(text)}`, old, held)
      if (s % 10 === 9) checkCanvasCalls('splice', before, text, options)
    }
  }

  // Enter and Backspace at piece edges, a range across several LFs, a
  // multi-line paste, select-all replace, clearing and typing into empty text.
  for (let t = 0; t < 30 * scale; t++) {
    let text = corpusSlice(next, 6, 300) + '\n' + randomText(next, 3, 12)
    const options = nextOptions()
    const prepareOne = preparer(options)
    const update = t % 2 === 0 ? updatePieces : updatePiecesByText
    let pieces = update([], text, prepareOne)
    const apply = (label: string, edited: string): void => {
      const old = pieces
      const held = snapshot(old)
      pieces = update(old, edited, prepareOne)
      countPrepared(old, pieces)
      count('edit steps')
      compareWithWhole(label, edited, options, pieces, 'full')
      checkHeld(label, old, held)
      text = edited
    }
    const lineFeeds = (): number[] => {
      const at: number[] = []
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) at.push(i)
      return at
    }
    let positions = lineFeeds()
    if (positions.length > 0) {
      const lf = pick(next, positions)
      apply('enter before LF', text.slice(0, lf) + '\n' + text.slice(lf))
      apply('enter after LF', text.slice(0, lf + 1) + '\n' + text.slice(lf + 1))
      apply('backspace LF', text.slice(0, lf) + text.slice(lf + 1))
      apply('CR before LF', text.slice(0, lf) + '\r' + text.slice(lf))
      apply('backspace CR', text.slice(0, lf) + text.slice(lf + 1))
    }
    positions = lineFeeds()
    if (positions.length >= 3) {
      const first = Math.floor(next() * (positions.length - 2))
      apply('delete across LFs', text.slice(0, Math.max(0, positions[first]! - 2)) + text.slice(positions[first + 2]! + 2))
    }
    const at = Math.floor(next() * (text.length + 1))
    let paste = ''
    for (let i = 0; i < 3; i++) paste += randomText(next, 2, 6) + '\n'
    apply('multi-line paste', text.slice(0, at) + paste + text.slice(at))
    apply('select-all replace', randomText(next, 4, 20) + '\n' + corpusSlice(next, 3, 200))
    apply('clear', '')
    apply('type into empty text', 'a')
  }

  // Token-by-token appends of corpus slices. A token ends right after a CR, so
  // CR and LF arrive separately.
  for (let t = 0; t < 12 * scale; t++) {
    const source = corpusSlice(next, 10, 600).replace(/\n/g, t % 3 === 0 ? '\r\n' : '\n') + (t % 2 === 0 ? '\n' : '')
    const options = nextOptions()
    const prepareOne = preparer(options)
    let text = ''
    let pieces: Piece<Handles>[] = []
    const update = t % 2 === 0 ? updatePieces : updatePiecesByText
    let token = 0
    for (let end = 0; end < source.length; token++) {
      let size = 1 + Math.floor(next() * 8)
      const cr = source.indexOf('\r', end)
      if (cr >= 0 && cr < end + size) size = cr + 1 - end
      const before = text
      end = Math.min(source.length, end + size)
      text = source.slice(0, end)
      if (token % 40 === 39) pieces = invalidate(events++, pieces)
      const old = pieces
      pieces = update(old, text, prepareOne)
      countPrepared(old, pieces)
      count('stream tokens')
      compareWithWhole('stream', text, options, pieces, token % 10 === 9 ? 'full' : 'quick')
      if (token % 10 === 5) checkCanvasCalls('stream', before, text, options)
    }
  }
}

// --- Section: walker invariant ---

// Every handle on the simple walker must lay out like a copy forced onto the
// complex walker. Trees without the flag report no simple-path handles.
function runWalker(profileIndex: number, scale: number): void {
  const next = rng(3000 + profileIndex)
  const texts = [...TARGETED, ...TEXTS.map(item => item.text), '字 字', '字\u200B字', 'ab cd', 'abc def ghi']
  for (let i = 0; i < 4000 * scale; i++) texts.push(randomText(next, 2, 16))
  for (let i = 0; i < 200 * scale; i++) texts.push(corpusSlice(next, 6, 500))
  const optionSets: PrepareOptions[] = [{}, { whiteSpace: 'pre-wrap' }, { wordBreak: 'keep-all' }]
  for (let t = 0; t < texts.length; t++) {
    if (t > 0 && t % 500 === 0) invalidate(t / 500 - 1, [])
    const text = texts[t]!
    for (const options of optionSets) {
      const rich = lib.prepareWithSegments(text, FONT, options)
      if (view(rich).simpleLineWalkFastPath !== true) {
        count('walker: handles on the complex walker, skipped')
        continue
      }
      count('walker: handles on the simple walker')
      const forced = { ...rich, simpleLineWalkFastPath: false } as PreparedTextWithSegments
      const opaque = lib.prepare(text, FONT, options)
      const forcedOpaque = { ...opaque, simpleLineWalkFastPath: false } as PreparedText
      const tag = `walker ${show(text)} ${JSON.stringify(options)}`
      for (const width of widthsFor(rich, GRID, 6)) {
        count('walker: width checks')
        const at = `${tag} @${width}`
        if (lib.layout(opaque, width, LINE_HEIGHT).lineCount !== lib.layout(forcedOpaque, width, LINE_HEIGHT).lineCount) fail('walker: layout() differs', at)
        const simple: string[] = []
        const complex: string[] = []
        walkRanges(rich, width, 0, simple)
        walkRanges(forced, width, 0, complex)
        if (!sameArray(simple, complex)) fail('walker: walkLineRanges() differ', `${at}\n  simple  ${simple.join(' ')}\n  complex ${complex.join(' ')}`)
        const steppedSimple: string[] = []
        const steppedComplex: string[] = []
        stepRanges(rich, width, 0, steppedSimple, at)
        stepRanges(forced, width, 0, steppedComplex, at)
        if (!sameArray(steppedSimple, steppedComplex)) fail('walker: layoutNextLineRange() differ', at)
        const linesSimple: string[] = []
        const linesComplex: string[] = []
        stepLines(rich, width, 0, linesSimple, at)
        stepLines(forced, width, 0, linesComplex, at)
        if (!sameArray(linesSimple, linesComplex)) fail('walker: layoutNextLine() differ', at)
        const batchSimple: string[] = []
        const batchComplex: string[] = []
        batchLines(rich, width, 0, batchSimple)
        batchLines(forced, width, 0, batchComplex)
        if (!sameArray(batchSimple, batchComplex)) fail('walker: layoutWithLines() differ', at)
        if (!Bun.deepEquals(lib.measureLineStats(rich, width), lib.measureLineStats(forced, width), true)) fail('walker: measureLineStats() differ', at)
      }
      if (lib.measureNaturalWidth(rich) !== lib.measureNaturalWidth(forced)) fail('walker: measureNaturalWidth() differs', tag)
    }
  }
}

// --- Section: streamed markdown chat ---

const CHAT_TARGETED = [
  'Title line\n===\n\nbody text after the heading',
  'Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter the table',
  'before\n\n```ts\nconst x = 1\nconsole.log(x)\n```\n\nafter the fence',
  'some **bold words** here and _em_ there',
  '- item one\n- item two\n  continued\n\n1. first\n2. second',
  '> quote\n> > nested quote\n> back out\ncontinued lazily',
  'see [docs][1] now\n\n[1]: https://example.com/docs',
]

// Paragraphs of a corpus with headings, lists and fenced code between them.
function buildChatMessage(corpus: string, size: number): string {
  const paragraphs = readFileSync(`${corpusDir}${corpus}.txt`, 'utf8').split(/\n+/).map(p => p.trim()).filter(p => p.length > 0)
  let markdown = ''
  for (let i = 1; markdown.length < size; i++) {
    const paragraph = paragraphs[i % paragraphs.length]!
    if (i % 5 === 0) markdown += `## Section ${i}\n\n`
    else if (i % 5 === 1) markdown += `- item **bold ${i}** with \`code\`\n- another item\n\n`
    else if (i % 5 === 2) markdown += '```ts\nconst x = ' + i + '\nconsole.log(x)\n```\n\n'
    markdown += `**${paragraph.slice(0, 4)}**${paragraph.slice(4)}\n\n`
  }
  return markdown.slice(0, size)
}

// Streams each message token by token. After every token the message parsed
// with the previous token's blocks must lay out like one parsed from scratch.
async function runChat(profileIndex: number, scale: number): Promise<void> {
  const model = await import('../pages/demos/markdown-chat.model.ts')
  const { BASE_MESSAGE_SPECS } = await import('../pages/demos/markdown-chat.data.ts')
  const next = rng(4000 + profileIndex)
  const messages: { role: 'assistant' | 'user'; markdown: string }[] = [
    ...BASE_MESSAGE_SPECS,
    ...CHAT_TARGETED.map(markdown => ({ role: 'assistant' as const, markdown })),
    { role: 'assistant', markdown: buildChatMessage('en-gatsby-opening', 1500) },
    { role: 'assistant', markdown: buildChatMessage('ja-rashomon', 1500) },
  ]
  let tokens = 0
  for (let m = 0; m < messages.length * scale; m++) {
    const message = messages[m % messages.length]!
    const codePoints = Array.from(message.markdown)
    let blocks: ReturnType<typeof model.parseMarkdownBlocks> = []
    for (let end = 0; end < codePoints.length;) {
      end = Math.min(codePoints.length, end + 1 + Math.floor(next() * 6))
      const prefix = codePoints.slice(0, end).join('')
      tokens++
      if (tokens % 300 === 0) {
        fontLoad()
        if (variant !== 'chat-stale-font') blocks = []
      }
      const previousPrepared = new Set<unknown>(blocks.map(block => block.kind === 'inline' ? block.flow : block.kind === 'code' ? block.prepared : null))
      const incremental = model.parseMarkdownBlocks(prefix, blocks)
      const fresh = model.parseMarkdownBlocks(prefix)
      count('chat: tokens')
      for (const block of incremental) {
        if (block.kind === 'rule') continue
        count(previousPrepared.has(block.kind === 'inline' ? block.flow : block.prepared) ? 'chat: blocks reused' : 'chat: blocks prepared')
      }
      for (const width of [360, 640, 860]) {
        const a = model.buildConversationFrame([{ blocks: incremental, role: message.role }], width)
        const b = model.buildConversationFrame([{ blocks: fresh, role: message.role }], width)
        const at = `message ${m} token ${tokens} ${show(prefix.slice(-60))} @${width} table=${canvas.table}`
        if (!Bun.deepEquals(a.messages[0]!.frame, b.messages[0]!.frame, true)) fail('chat: block kinds, heights or widths differ', at)
        if (!Bun.deepEquals(model.materializeMessageBlocks(a.messages[0]!), model.materializeMessageBlocks(b.messages[0]!), true)) fail('chat: lines differ', at)
      }
      blocks = incremental
    }
  }
}

// --- Processes ---

type ChildResult = {
  profile: Profile
  failures: Record<string, Bucket>
  internal: Record<string, Bucket>
  counters: Record<string, number>
}

async function runChild(args: Map<string, string>): Promise<void> {
  const profile = args.get('profile') as Profile
  if (!PROFILES.includes(profile)) throw new Error(`Unknown profile ${profile}`)
  const src = args.get('src') ?? DEFAULT_SRC
  const scale = Number(args.get('scale') ?? '1')
  variant = (args.get('variant') ?? 'none') as typeof variant
  const sections = (args.get('sections') ?? SECTIONS.join(',')).split(',')
  installEnvironment(profile)
  lib = await import(`${src}/layout.ts`) as Lib
  const measurement = await import(`${src}/measurement.ts`) as Measurement
  lineFitEpsilon = measurement.getEngineProfile().lineFitEpsilon
  // 18 when the fake DOM's 4px emoji correction applies.
  count('environment: corrected emoji width', view(lib.prepareWithSegments('\u{1F600}', FONT)).widths[0]!)
  const profileIndex = PROFILES.indexOf(profile)
  if (sections.includes('contract')) runContract(profileIndex, scale)
  if (sections.includes('edits')) runEdits(profileIndex, scale)
  if (sections.includes('walker')) runWalker(profileIndex, scale)
  if (sections.includes('chat')) {
    if (src === DEFAULT_SRC) await runChat(profileIndex, scale)
    else count('chat: skipped for --src')
  }
  const result: ChildResult = {
    profile,
    failures: Object.fromEntries(failures),
    internal: Object.fromEntries(internal),
    counters: Object.fromEntries(counters),
  }
  console.log(`RESULT ${JSON.stringify(result)}`)
}

// Examples print clipped; --json keeps them whole.
const clip = (text: string): string => text.length > 600 ? `${text.slice(0, 600)}...` : text

async function runParent(args: Map<string, string>): Promise<void> {
  const profiles = (args.get('profiles') ?? PROFILES.join(',')).split(',') as Profile[]
  for (const profile of profiles) if (!PROFILES.includes(profile)) throw new Error(`Unknown profile ${profile}`)
  const variantName = args.get('variant') ?? 'none'
  if (!(VARIANTS as readonly string[]).includes(variantName)) throw new Error(`Unknown variant ${variantName}`)
  const passThrough = ['src', 'sections', 'variant', 'scale'].flatMap(key => args.has(key) ? [`--${key}=${args.get(key)}`] : [])
  // One child per profile, at most four at a time: profiles are cached per process.
  const results = await Promise.all(profiles.map(async profile => {
    const child = Bun.spawn([process.execPath, import.meta.path, '--child', `--profile=${profile}`, ...passThrough], { stdout: 'pipe', stderr: 'inherit' })
    const output = await new Response(child.stdout).text()
    const exitCode = await child.exited
    const line = output.split('\n').find(row => row.startsWith('RESULT '))
    if (exitCode !== 0 || line === undefined) throw new Error(`${profile} child exited with ${exitCode}\n${output}`)
    return JSON.parse(line.slice('RESULT '.length)) as ChildResult
  }))
  let failed = false
  console.log(`variant=${variantName} src=${args.get('src') ?? DEFAULT_SRC} sections=${args.get('sections') ?? SECTIONS.join(',')} scale=${args.get('scale') ?? '1'}`)
  for (const result of results) {
    console.log(`\n== ${result.profile} ==`)
    console.log(`  ${Object.entries(result.counters).map(([name, value]) => `${name}: ${value}`).join('\n  ')}`)
    const failureEntries = Object.entries(result.failures)
    if (failureEntries.length === 0) console.log('  failures: none')
    for (const [category, bucket] of failureEntries) {
      failed = true
      console.log(`  FAIL ${category}: ${bucket.count}`)
      for (const example of bucket.examples) console.log(`    ${clip(example).replace(/\n/g, '\n    ')}`)
    }
    for (const [category, bucket] of Object.entries(result.internal)) {
      console.log(`  internal ${category}: ${bucket.count}`)
      console.log(`    ${clip(bucket.examples[0]!)}`)
    }
  }
  const json = args.get('json')
  if (json !== undefined) writeFileSync(json, JSON.stringify({ args: Object.fromEntries(args), results }, null, 1))
  process.exitCode = failed ? 1 : 0
}

if (import.meta.main) {
  const args = parseArgs()
  await (args.has('child') ? runChild(args) : runParent(args))
}
