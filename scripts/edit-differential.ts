// Differential test for prepareEdit(). Every edit's result must deep-equal a
// fresh prepare()/prepareWithSegments() of the edited text, with no tolerance,
// under deterministic fake canvases, in one child process per engine profile
// (profiles are computed once per process).
//
//   bun run scripts/edit-differential.ts [--scale=1] [--profiles=blink,webkit,gecko,android] [--seed=N] [--out=file.json]
//   bun run scripts/edit-differential.ts --mutate=noguardblocks   (runs against a mutated copy of src/)
//   bun run scripts/edit-differential.ts --canaries [--scale=0.25] [--url-canary-base=477510e]
//
// Scripts: A random documents with random edits, B token streams, C typing
// sessions, D targeted cases inside long documents, E invalidation between
// documents (font load, <html lang> change, setLocale()).

import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TEXTS } from '../src/test-data.ts'

type LayoutModule = typeof import('../src/layout.ts')
type EditModule = typeof import('../src/prepare-edit.ts')
type AnalysisModule = typeof import('../src/analysis.ts')
type MeasurementModule = typeof import('../src/measurement.ts')
type Handle = import('../src/layout.ts').PreparedTextWithSegments
type LayoutLineRange = import('../src/layout.ts').LayoutLineRange

const PROFILES: Record<string, string> = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
}

// editHooks.reason codes.
const REASONS: Record<string, string> = {
  splice: 'spliced',
  same: 'same text, previous returned',
  language: 'full: page language changed',
  generation: 'full: caches cleared',
  empty: 'full: empty previous text',
  bounds: 'full: no separator bounds the window',
  half: 'full: window over half the text',
  bidi: 'full: explicit bidi controls appeared or disappeared (WebKit)',
  converge: 'full: guard blocks did not converge after 4 widenings',
}

// Source mutations for canaries and ablations, applied to a copy of src/. Each
// search string must occur exactly once.
const MUTATIONS: Record<string, [file: string, search: string, replace: string][]> = {
  criteria: [['prepare-edit.ts', '  if (start === 0 || end >= normalized.length) return false\n', '  if (start === 0 || end >= normalized.length) return false\n  return true\n']],
  guards: [['prepare-edit.ts', 'if (!leftConverged || !rightConverged) {', 'if (false) {']],
  noguardblocks: [['prepare-edit.ts', 'let leftGuards = 1', 'let leftGuards = 0']],
  nocontext: [['prepare-edit.ts', 'state.documentLanguage, context, windowStarts)', 'state.documentLanguage, null, windowStarts)']],
  rightneighbor: [['prepare-edit.ts', 'if (profile.measureTextWithFollowingSpace && !isStrongOrNumber(after)) return false', '']],
  counts: [['prepare-edit.ts', 'letterSpacing === 0 && nonSimpleKinds === 0 && entries === 0', 'old.simpleLineWalkFastPath && measured.simpleLineWalkFastPath']],
}

const repoRoot = path.resolve(import.meta.dir, '..')

function argument(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
}

type Failure = { script: string, label: string | null, config: string, reason: string, difference: string, before: string, after: string }

type Summary = {
  profile: string
  src: string
  edits: number
  paths: Record<string, number>
  differences: number
  layoutDifferences: number
  heldChanges: number
  offsetErrors: number
  contiguityErrors: number
  canvasProbes: number
  canvasExcess: number
  widenedEdits: number
  widenings: number
  windowChars: { p50: number, p90: number, p99: number, max: number }
  meanTextCharsAtSplice: number
  targeted: Record<string, Record<string, number>>
  targetedDifferences: Record<string, number>
  failures: Failure[]
  ms: { 'A+E'?: number, B?: number, C?: number, D?: number }
}

function failing(summary: Summary): number {
  return summary.differences + summary.layoutDifferences + summary.heldChanges + summary.offsetErrors +
    summary.contiguityErrors + summary.canvasExcess
}

// --- Fake canvases ---

const FONT = '12px Test'
const EMOJI_DOM_WIDTH = 12
const ignorableRe = /\p{Default_Ignorable_Code_Point}/u
const pictographicRe = /\p{Extended_Pictographic}/u
const wideRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-｠]/u

// 10 per visible code point, 14 per pictograph, 4 per space; a space after `o`
// kerns by -1 and `bc` by -2. Letter spacing adds per visible code point.
function fixedWidth(text: string, spacing: number): number {
  let width = 0
  let previous = ''
  let visible = 0
  for (const ch of text) {
    if (ignorableRe.test(ch)) continue
    visible++
    if (ch === ' ') width += previous === 'o' ? 3 : 4
    else width += pictographicRe.test(ch) ? 14 : previous === 'b' && ch === 'c' ? 8 : 10
    previous = ch
  }
  return width + spacing * visible
}

// Wide East Asian 16, U+0020 4.25, pictographs 18, others 5 to 12.875 by a
// hash; some pairs kern by -0.75.
const proportionalCache = new Map<number, number>()
function proportionalWidth(text: string, spacing: number): number {
  let width = 0
  let previous = 0
  let visible = 0
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!
    i += cp > 0xffff ? 2 : 1
    let w = proportionalCache.get(cp)
    if (w === undefined) {
      const ch = String.fromCodePoint(cp)
      w = ignorableRe.test(ch) ? 0 : cp === 0x20 ? 4.25 : pictographicRe.test(ch) ? 18 : wideRe.test(ch) ? 16
        : 5 + ((Math.imul(cp, 2654435761) >>> 0) % 8) + (cp % 8) / 8
      proportionalCache.set(cp, w)
    }
    if (w === 0) continue
    visible++
    width += w
    if (previous !== 0 && (previous * 31 + cp) % 7 === 0) width -= 0.75
    previous = cp
  }
  return width + spacing * visible
}

function installGlobals(userAgent: string): { canvas: { table: 'fixed' | 'proportional', calls: number, units: number }, root: { lang: string } } {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true, writable: true })
  const root = { lang: '' }
  // A span measures the emoji narrower than Canvas, so emoji correction is not zero.
  const documentStub = {
    documentElement: root,
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, textContent: '', getBoundingClientRect: () => ({ width: EMOJI_DOM_WIDTH }) }),
  }
  Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true, writable: true })
  const canvas = { table: 'fixed' as 'fixed' | 'proportional', calls: 0, units: 0 }
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
      canvas.calls++
      canvas.units += text.length
      const spacing = Number.parseFloat(this.letterSpacing) || 0
      return { width: canvas.table === 'fixed' ? fixedWidth(text, spacing) : proportionalWidth(text, spacing) }
    }
  }
  Reflect.set(globalThis, 'OffscreenCanvas', class { getContext() { return new FakeContext() } })
  return { canvas, root }
}

// --- Generators ---

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HAZARDS = [
  ' ', '  ', '\t', '\n', '\r', '\r\n', '\f', '\u0085', '\u2029', '\u00A0', '\u202F', '\u2060', '\u200B', '\u200D', '\u00AD',
  '\u0301', '\u064B', '\u05BE', '\u202A', '\u2066', '\u202C', '\u2069', '\uFEFF', '\uD83D', '\uDE00', '\u3000', '\u0E33', '\u0600', '\u{1F3FB}',
  '-', '\u2010', '\u2013', '\u2014', '$', '%', '!', '?', ',', '.', '(', ')', '"', '\u201C', '\u201D', '\u2019', 'o', 'b', 'c', '1',
  '\u05D0', '\u05E2', '\u05E9\u05DC\u05D5\u05DD', '\u0639\u0631\u0628\u064A\u060C\u061F', '\u4E2D', '\u4E2D\u6587\u5B57\u3002\u300C\u300D\uFF0C',
  '\u30A2', '\u30A2\u30FC\u30C3\u3083\u3005', '\uD55C\uAD6D\uC5B4', '\uFF08', '\uFF09', '\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22', '\u103B', '\u1780',
  '\u{1F600}', '\u{1F44D}\u{1F3FD}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}', '\u2764\uFE0F', 'ab\u00ADcd',
  "don't", 'e.g.', '1,000.5', '1-2-3-4-5x', '3.14', '00:00', '$5', '-5%', 'www.a.com/www.b?q=1', 'https://a.com/p?q=1&r=2', 'https://x.y/z?a',
]

type Corpus = { label: string, text: string }

function loadCorpora(): Corpus[] {
  const dir = path.join(repoRoot, 'corpora')
  const corpora = readdirSync(dir).filter(file => file.endsWith('.txt')).sort()
    .map(file => ({ label: file, text: readFileSync(path.join(dir, file), 'utf8') }))
  corpora.push({ label: 'test-data TEXTS', text: TEXTS.map(entry => entry.text).join('\n') })
  return corpora
}

type Options = { whiteSpace: 'normal' | 'pre-wrap', wordBreak: 'normal' | 'keep-all', letterSpacing: number }
type Config = { options: Options, rich: boolean }

const CONFIGS: Config[] = []
for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
  for (const wordBreak of ['normal', 'keep-all'] as const) {
    for (const letterSpacing of [0, 1.5]) {
      for (const rich of [false, true]) CONFIGS.push({ options: { whiteSpace, wordBreak, letterSpacing }, rich })
    }
  }
}

// The 16 combinations cycle; every seventh spaced one uses -0.5 instead.
function configFor(index: number): Config {
  const config = CONFIGS[index % CONFIGS.length]!
  return index % 7 === 3 && config.options.letterSpacing !== 0 ? { ...config, options: { ...config.options, letterSpacing: -0.5 } } : config
}

function describeConfig(config: Config): string {
  return `${config.rich ? 'rich' : 'opaque'}/${config.options.whiteSpace}/${config.options.wordBreak}/${config.options.letterSpacing}`
}

// --- Child ---

async function child(): Promise<void> {
  const profile = argument('profile') ?? 'blink'
  const scale = Number(argument('scale') ?? '1')
  const src = argument('src') ?? path.join(repoRoot, 'src')
  const { canvas, root } = installGlobals(PROFILES[profile]!)
  const L = await import(path.join(src, 'layout.ts')) as LayoutModule
  const E = await import(path.join(src, 'prepare-edit.ts')) as EditModule
  const A = await import(path.join(src, 'analysis.ts')) as AnalysisModule
  const M = await import(path.join(src, 'measurement.ts')) as MeasurementModule

  const next = mulberry32(Number(argument('seed') ?? '20260913'))
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1))
  const corpora = loadCorpora()
  const words = corpora.flatMap(corpus => corpus.text.split(/\s+/).slice(0, 400)).filter(word => word.length > 0)

  const summary: Summary = {
    profile, src, edits: 0, paths: {}, differences: 0, layoutDifferences: 0, heldChanges: 0, offsetErrors: 0,
    contiguityErrors: 0, canvasProbes: 0, canvasExcess: 0, widenedEdits: 0, widenings: 0,
    windowChars: { p50: 0, p90: 0, p99: 0, max: 0 }, meanTextCharsAtSplice: 0, targeted: {}, targetedDifferences: {}, failures: [], ms: {},
  }
  const windows: number[] = []
  let splicedTextChars = 0

  function prepareFor(config: Config, text: string, editable: boolean): Handle {
    const options = editable ? { ...config.options, editable: true } : config.options
    return config.rich ? L.prepareWithSegments(text, FONT, options) : L.prepare(text, FONT, options) as Handle
  }

  // Corpus words mixed with hazard tokens, or only words and spaces.
  function randomWords(target: number, hazards = true): string {
    let text = ''
    while (text.length < target) {
      text += !hazards ? pick(words) + ' ' : next() < 0.75 ? pick(words) + (next() < 0.85 ? ' ' : pick(HAZARDS)) : pick(HAZARDS)
    }
    return text
  }

  function randomDoc(): string {
    if (next() < 0.35) return randomWords(int(40, 900))
    const corpus = pick(corpora).text
    const length = int(60, 2400)
    const start = int(0, Math.max(0, corpus.length - length))
    return corpus.slice(start, start + length)
  }

  function codeUnitOffset(text: string): number {
    let offset = int(0, text.length)
    if (next() < 0.9 && offset > 0 && offset < text.length) {
      const code = text.charCodeAt(offset)
      if (code >= 0xdc00 && code <= 0xdfff) offset--
    }
    return offset
  }

  function randomInsert(): string {
    const r = next()
    if (r < 0.4) return pick(HAZARDS)
    if (r < 0.75) return pick(words).slice(0, int(1, 8))
    const corpus = pick(corpora).text
    const start = int(0, Math.max(0, corpus.length - 200))
    return corpus.slice(start, start + int(1, 200))
  }

  function randomEdit(text: string): string {
    const r = next()
    const at = codeUnitOffset(text)
    if (r < 0.3) return text.slice(0, at) + randomInsert() + text.slice(at)
    if (r < 0.5) return text.slice(0, at) + text.slice(Math.min(text.length, at + int(1, next() < 0.8 ? 3 : 60)))
    if (r < 0.65) return text.slice(0, at) + randomInsert() + text.slice(Math.min(text.length, at + int(1, 12)))
    if (r < 0.8) return text + randomInsert()
    // A hazard directly before or after an existing space, tab or line feed.
    const positions: number[] = []
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code === 0x20 || code === 0x09 || code === 0x0a) positions.push(i)
    }
    if (positions.length === 0) return text + pick(HAZARDS)
    const position = pick(positions) + (next() < 0.5 ? 0 : 1)
    return text.slice(0, position) + pick(HAZARDS) + text.slice(position)
  }

  function snippet(text: string, other: string): string {
    let start = 0
    while (start < text.length && text.charCodeAt(start) === other.charCodeAt(start)) start++
    return JSON.stringify(text.slice(Math.max(0, start - 60), start + 60))
  }

  function fail(script: string, label: string | null, config: Config, difference: string, before: string, after: string): void {
    if (summary.failures.length < 12) {
      summary.failures.push({ script, label, config: describeConfig(config), reason: E.editHooks.reason, difference, before: snippet(before, after), after: snippet(after, before) })
    }
    if (label !== null) summary.targetedDifferences[label] = (summary.targetedDifferences[label] ?? 0) + 1
  }

  function firstDifference(a: Handle, b: Handle): string | null {
    if (Bun.deepEquals(a, b, true)) return null
    const x = a as unknown as Record<string, unknown>
    const y = b as unknown as Record<string, unknown>
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const u = x[key]
      const v = y[key]
      if (Bun.deepEquals(u, v, true)) continue
      if (Array.isArray(u) && Array.isArray(v)) {
        for (let i = 0; i < Math.max(u.length, v.length); i++) {
          if (!Bun.deepEquals(u[i], v[i], true)) return `${key}[${i}]: edit ${JSON.stringify(u[i])}, fresh ${JSON.stringify(v[i])} (lengths ${u.length}/${v.length})`
        }
      }
      return `${key}: edit ${JSON.stringify(u)?.slice(0, 160)}, fresh ${JSON.stringify(v)?.slice(0, 160)}`
    }
    return 'objects differ outside their own keys'
  }

  const BASE_WIDTHS = [1, 5, 23, 47, 61, 90, 150, 320, 400, 5000, Infinity]

  function layoutRecord(prepared: Handle, rich: boolean, widths: readonly number[]): unknown[] {
    const record: unknown[] = []
    for (let wi = 0; wi < widths.length; wi++) {
      const width = widths[wi]!
      record.push(L.layout(prepared, width, 20))
      if (!rich) continue
      const ranges: LayoutLineRange[] = []
      L.walkLineRanges(prepared, width, range => { ranges.push(range) })
      record.push(ranges, ranges.map(range => L.materializeLineRange(prepared, range)), L.layoutWithLines(prepared, width, 20), L.measureLineStats(prepared, width))
      const stepped: unknown[] = []
      let cursor = { segmentIndex: 0, graphemeIndex: 0 }
      for (let range = L.layoutNextLineRange(prepared, cursor, width); range !== null; range = L.layoutNextLineRange(prepared, cursor, width)) {
        stepped.push(range)
        cursor = range.end
      }
      cursor = { segmentIndex: 0, graphemeIndex: 0 }
      for (let line = L.layoutNextLine(prepared, cursor, width); line !== null; line = L.layoutNextLine(prepared, cursor, width)) {
        stepped.push(line)
        cursor = line.end
      }
      record.push(stepped)
    }
    if (rich) record.push(L.measureNaturalWidth(prepared))
    return record
  }

  function profileNow(): ReturnType<MeasurementModule['getEngineProfile']> {
    return M.getEngineProfile(A.getBreakLanguage(root.lang))
  }

  function checkDeep(script: string, label: string | null, config: Config, edited: Handle, expected: Handle, previousText: string, text: string): void {
    const widths = BASE_WIDTHS.slice()
    if (config.rich) {
      const epsilon = profileNow().lineFitEpsilon
      for (const width of [150, 400]) {
        const lines = L.layoutWithLines(expected, width, 20).lines
        for (let i = 0; i < Math.min(3, lines.length); i++) widths.push(lines[i]!.width - epsilon, lines[i]!.width + epsilon)
      }
    }
    if (!Bun.deepEquals(layoutRecord(edited, config.rich, widths), layoutRecord(expected, config.rich, widths), true)) {
      summary.layoutDifferences++
      fail(script, label, config, 'layout outputs differ', previousText, text)
    }
    const state = E.editHooks.states.get(edited)
    const analysis = A.analyzeText(text, profileNow(), config.options.whiteSpace, config.options.wordBreak)
    // Contiguity: analysis starts follow the segment texts.
    let expectedStart = 0
    for (let i = 0; i < analysis.len; i++) {
      if (analysis.starts[i] !== expectedStart) break
      expectedStart += analysis.texts[i]!.length
    }
    if (expectedStart !== analysis.normalized.length) {
      summary.contiguityErrors++
      fail(script, label, config, `analysis starts not contiguous at ${expectedStart}`, previousText, text)
    }
    if (state === undefined || state.source !== text || state.normalized !== analysis.normalized || state.starts.length !== edited.widths.length) {
      summary.offsetErrors++
      fail(script, label, config, 'retained text or starts do not match', previousText, text)
      return
    }
    for (let k = 0; k < state.starts.length; k++) {
      const nc = state.normalized.charCodeAt(state.starts[k]!)
      const sc = text.charCodeAt(state.sourceStarts[k]!)
      const collapsed = config.options.whiteSpace === 'normal' && nc === 0x20 && (sc === 0x09 || sc === 0x0a || sc === 0x0d || sc === 0x0c)
      const rewritten = config.options.whiteSpace === 'pre-wrap' && nc === 0x0a && (sc === 0x0d || sc === 0x0c)
      const contiguous = !config.rich || state.normalized.startsWith(edited.segments[k]!, state.starts[k]!)
      if ((nc !== sc && !collapsed && !rewritten) || !contiguous) {
        summary.offsetErrors++
        fail(script, label, config, `retained offsets wrong at segment ${k}`, previousText, text)
        return
      }
    }
  }

  // One edit. A probe first measures a fresh prepare and then the edit, each
  // from the caches a cold prepare of the previous text leaves, and compares
  // their Canvas calls; the edit then continues from that cold previous handle.
  function checkEdit(script: string, label: string | null, config: Config, previous: Handle, previousText: string, text: string, deep: boolean, probe: boolean): Handle {
    let freshCalls = -1
    if (probe) {
      L.clearCache()
      prepareFor(config, previousText, false)
      canvas.calls = 0
      prepareFor(config, text, false)
      freshCalls = canvas.calls
      L.clearCache()
      previous = prepareFor(config, previousText, true)
    }
    const snapshot = deep ? structuredClone(previous) : null
    canvas.calls = 0
    const edited = L.prepareEdit(previous, text)
    const editCalls = canvas.calls
    summary.edits++
    const reason = E.editHooks.reason
    summary.paths[reason] = (summary.paths[reason] ?? 0) + 1
    if (label !== null) {
      const counts = summary.targeted[label] ??= {}
      counts[reason] = (counts[reason] ?? 0) + 1
    }
    if (reason === 'splice') {
      windows.push(E.editHooks.window)
      splicedTextChars += text.length
    }
    if (E.editHooks.widenings > 0) {
      summary.widenedEdits++
      summary.widenings += E.editHooks.widenings
    }
    if (probe) {
      summary.canvasProbes++
      if (editCalls > freshCalls) {
        summary.canvasExcess++
        fail(script, label, config, `Canvas calls: edit ${editCalls}, fresh ${freshCalls}`, previousText, text)
      }
    }
    const expected = prepareFor(config, text, false)
    const difference = firstDifference(edited, expected)
    if (difference !== null) {
      summary.differences++
      fail(script, label, config, difference, previousText, text)
    }
    if (snapshot !== null) {
      if (!Bun.deepEquals(previous, snapshot, true)) {
        summary.heldChanges++
        fail(script, label, config, 'previous handle changed', previousText, text)
      }
      checkDeep(script, label, config, edited, expected, previousText, text)
    }
    return edited
  }

  // Script A, with the invalidation events of script E between documents.
  let started = performance.now()
  const documents = Math.round(900 * scale)
  for (let d = 0; d < documents; d++) {
    const config = configFor(d)
    let text = randomDoc()
    let handle = prepareFor(config, text, true)
    const edits = int(4, 24)
    for (let e = 0; e < edits; e++) {
      const nextText = randomEdit(text)
      handle = checkEdit('A', null, config, handle, text, nextText, e % 5 === 0, e % 5 === 2)
      text = nextText
    }
    const invalidation = d % 50 === 7 ? 'font load' : d % 50 === 21 ? 'lang change' : d % 50 === 33 ? 'setLocale' : null
    if (invalidation === null) continue
    if (invalidation === 'font load') {
      canvas.table = canvas.table === 'fixed' ? 'proportional' : 'fixed'
      L.clearCache()
    } else if (invalidation === 'lang change') {
      root.lang = root.lang === '' ? 'ja' : root.lang === 'ja' ? 'ko' : ''
    } else {
      L.setLocale(next() < 0.5 ? 'th' : undefined)
    }
    const nextText = randomEdit(text)
    checkEdit('E', invalidation, config, handle, text, nextText, true, false)
  }
  summary.ms['A+E'] = Math.round(performance.now() - started)

  // Script B: 1,500-character streams in 1-8-unit tokens; some with CR LF.
  started = performance.now()
  const streams = Math.round(48 * scale)
  for (let s = 0; s < streams; s++) {
    const config = configFor(s)
    const corpus = corpora[s % corpora.length]!.text
    const start = int(0, Math.max(0, corpus.length - 1600))
    let target = corpus.slice(start, start + 1500)
    if (s % 3 === 0) target = target.replace(/\n/g, '\r\n')
    let text = ''
    let handle = prepareFor(config, text, true)
    for (let step = 0; text.length < target.length; step++) {
      const nextText = target.slice(0, text.length + int(1, 8))
      handle = checkEdit('B', null, config, handle, text, nextText, step % 25 === 24, step % 25 === 12)
      text = nextText
    }
  }
  summary.ms.B = Math.round(performance.now() - started)

  // Script C: type a word into a corpus slice, then delete six graphemes.
  started = performance.now()
  const sessions = Math.round(240 * scale)
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (let s = 0; s < sessions; s++) {
    const config = configFor(s)
    const corpus = pick(corpora).text
    const start = int(0, Math.max(0, corpus.length - 3000))
    let text = corpus.slice(start, start + int(800, 3000))
    let handle = prepareFor(config, text, true)
    let at = codeUnitOffset(text)
    for (const ch of pick(words) + ' ') {
      const nextText = text.slice(0, at) + ch + text.slice(at)
      at += ch.length
      handle = checkEdit('C', null, config, handle, text, nextText, false, false)
      text = nextText
    }
    for (let k = 0; k < 6 && at > 0; k++) {
      const grapheme = graphemes.segment(text).containing(at - 1)!
      const nextText = text.slice(0, grapheme.index) + text.slice(at)
      at = grapheme.index
      handle = checkEdit('C', null, config, handle, text, nextText, k === 5, k === 3)
      text = nextText
    }
  }
  summary.ms.C = Math.round(performance.now() - started)

  // Script D: targeted cases, each text an edit of the one before, inside long
  // documents of corpus words, in every option combination.
  started = performance.now()
  const TARGETED: { label: string, texts: string[], embed: 'middle' | 'end' | 'none' }[] = [
    { label: 'space + ZWJ', texts: ['x \u200Dword', 'x \u200Dwordy'], embed: 'middle' },
    { label: 'LF + mark + $', texts: ['a\n\u0301$5', 'a\n\u0301$55'], embed: 'middle' },
    { label: 'TAB + hyphen', texts: ['a\t-\u05D0b', 'a\t-\u05D0bc'], embed: 'middle' },
    { label: 'direction scan', texts: ['fo\u200D , , , , bar', 'fo\u200D , , , , \u05E2\u05D1'], embed: 'middle' },
    { label: 'explicit control typed and deleted', texts: ['ab cd', 'ab \u202Acd', 'ab cd'], embed: 'middle' },
    { label: 'first soft hyphen typed and deleted', texts: ['alpha beta', 'al\u00ADpha beta', 'alpha beta'], embed: 'middle' },
    { label: 'entry geometry typed and deleted', texts: ['word play', 'wo\u200Drd play', 'word play'], embed: 'middle' },
    { label: 'Hebrew letter typed and deleted', texts: ['abc def', 'abc d\u05D0ef', 'abc def'], embed: 'middle' },
    { label: 'Arabic letter typed and deleted', texts: ['abc def', 'abc d\u0639ef', 'abc def'], embed: 'middle' },
    { label: 'empty and non-empty', texts: ['', 'a', '', 'ab cd', ''], embed: 'none' },
    { label: 'trailing whitespace', texts: ['end', 'end ', 'end  ', 'end'], embed: 'end' },
    { label: 'CR then LF', texts: ['x', 'x\r', 'x\r\n', 'x\r\ny'], embed: 'end' },
    { label: 'explicit control in another paragraph', texts: ['fo\u200D bar\n\u202Ax', 'fo\u200D baz\n\u202Ax'], embed: 'middle' },
    { label: 'overflowing glyph then space', texts: ['\u5B57 \u5B57', '\u5B57 \u5B57\u5B57'], embed: 'middle' },
    { label: 'soft-hyphen-only paragraph', texts: ['a\n\u00AD\nb', 'a\n\u00AD\nbc'], embed: 'middle' },
    { label: 'URL query', texts: ['see www.a.com/www.b?q=1 now', 'see www.a.com/www.b?q=12 now'], embed: 'middle' },
  ]
  for (let t = 0; t < TARGETED.length; t++) {
    const targeted = TARGETED[t]!
    for (let c = 0; c < CONFIGS.length; c++) {
      const config = configFor(c)
      const prefix = targeted.embed === 'none' ? '' : randomWords(int(600, 1500), false)
      const suffix = targeted.embed === 'middle' ? ' ' + randomWords(int(600, 1500), false).trimEnd() : ''
      let text = prefix + targeted.texts[0]! + suffix
      let handle = prepareFor(config, text, true)
      for (let i = 1; i < targeted.texts.length; i++) {
        const nextText = prefix + targeted.texts[i]! + suffix
        handle = checkEdit('D', targeted.label, config, handle, text, nextText, true, false)
        text = nextText
      }
    }
  }
  summary.ms.D = Math.round(performance.now() - started)

  windows.sort((a, b) => a - b)
  const quantile = (q: number): number => windows.length === 0 ? 0 : windows[Math.min(windows.length - 1, Math.floor(q * windows.length))]!
  summary.windowChars = { p50: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99), max: quantile(1) }
  summary.meanTextCharsAtSplice = Math.round(splicedTextChars / Math.max(1, windows.length))
  console.log(JSON.stringify(summary))
}

// --- Parent ---

// A copy of src/ with the named mutations; `url-revert` restores analysis.ts
// from before the URL query start fix.
function mutatedSource(names: readonly string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), `pretext-edit-${names.join('-')}-`))
  cpSync(path.join(repoRoot, 'src'), dir, { recursive: true })
  for (const name of names) {
    if (name === 'url-revert') {
      const show = Bun.spawnSync(['git', 'show', `${argument('url-canary-base') ?? '477510e'}:src/analysis.ts`], { cwd: repoRoot })
      if (show.exitCode !== 0) throw new Error(show.stderr.toString())
      writeFileSync(path.join(dir, 'analysis.ts'), show.stdout)
      continue
    }
    const patches = MUTATIONS[name]
    if (patches === undefined) throw new Error(`unknown mutation ${name}`)
    for (const [file, search, replace] of patches) {
      const target = path.join(dir, file)
      const source = readFileSync(target, 'utf8')
      const count = source.split(search).length - 1
      if (count !== 1) throw new Error(`mutation ${name} matched ${count} times in ${file}`)
      writeFileSync(target, source.replace(search, () => replace))
    }
  }
  return dir
}

async function runChild(profile: string, extra: string[]): Promise<Summary> {
  const proc = Bun.spawn([process.execPath, import.meta.path, '--child', `--profile=${profile}`, ...extra], { stdout: 'pipe', stderr: 'inherit' })
  const output = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`child ${profile} ${extra.join(' ')} exited with ${code}`)
  return JSON.parse(output.trim().split('\n').pop()!) as Summary
}

// At most four child processes at a time.
async function runLimited<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = []
  let nextJob = 0
  async function worker(): Promise<void> {
    while (nextJob < jobs.length) {
      const index = nextJob++
      results[index] = await jobs[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker))
  return results
}

function row(summary: Summary): string {
  const full = Object.entries(summary.paths).filter(([reason]) => reason !== 'splice' && reason !== 'same').reduce((sum, [, count]) => sum + count, 0)
  return `| ${summary.profile} | ${summary.edits} | ${summary.paths['splice'] ?? 0} | ${summary.paths['same'] ?? 0} | ${full} | ${summary.differences} | ${summary.layoutDifferences} | ` +
    `${summary.heldChanges} | ${summary.offsetErrors} | ${summary.contiguityErrors} | ${summary.canvasExcess}/${summary.canvasProbes} | ${summary.widenedEdits} | ` +
    `${summary.windowChars.p50}/${summary.windowChars.p90}/${summary.windowChars.p99}/${summary.windowChars.max} |`
}

const HEADER = '| profile | edits | spliced | same | full | differences | layout | held changed | offsets | contiguity | canvas excess/probes | widened edits | window p50/p90/p99/max |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'

function describePaths(paths: Record<string, number>): string {
  return Object.entries(paths).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${REASONS[reason] ?? reason} ${count}`).join('; ')
}

async function parent(): Promise<void> {
  const shared = ['scale', 'seed'].flatMap(name => argument(name) === undefined ? [] : [`--${name}=${argument(name)}`])
  const out = argument('out')

  if (process.argv.includes('--canaries')) {
    const canaries = [
      { name: 'separator criteria and guards off', profile: 'blink', mutations: ['criteria', 'guards'], label: null },
      { name: 'measurement context off', profile: 'webkit', mutations: ['nocontext'], label: null },
      { name: 'right-neighbor rule off', profile: 'webkit', mutations: ['rightneighbor'], label: 'direction scan' },
      { name: 'counts off', profile: 'blink', mutations: ['counts'], label: null },
      { name: 'URL query start fix reverted', profile: 'blink', mutations: ['url-revert'], label: null },
    ]
    const results = await runLimited(canaries.map(canary => () => runChild(canary.profile, [...shared, `--src=${mutatedSource(canary.mutations)}`])))
    let passed = 0
    for (let i = 0; i < canaries.length; i++) {
      const canary = canaries[i]!
      const summary = results[i]!
      const failed = failing(summary) > 0 && (canary.label === null || (summary.targetedDifferences[canary.label] ?? 0) > 0)
      if (!failed) passed++
      console.log(`\n## ${canary.name} (${canary.profile}): ${failed ? 'fails' : 'DID NOT FAIL'}`)
      console.log(HEADER)
      console.log(row(summary))
      console.log(`paths: ${describePaths(summary.paths)}`)
      console.log(`targeted differences: ${JSON.stringify(summary.targetedDifferences)}; source ${summary.src}`)
      for (const failure of summary.failures.slice(0, 4)) console.log(JSON.stringify(failure))
    }
    if (out !== undefined) writeFileSync(out, JSON.stringify(results, null, 2))
    if (passed > 0) process.exit(1)
    return
  }

  const mutations = argument('mutate')
  const src = mutations === undefined ? argument('src') : mutatedSource(mutations.split(','))
  const extra = [...shared, ...(src === undefined ? [] : [`--src=${src}`])]
  const profiles = (argument('profiles') ?? 'blink,webkit,gecko,android').split(',')
  const results = await runLimited(profiles.map(profile => () => runChild(profile, extra)))
  console.log(HEADER)
  for (const summary of results) console.log(row(summary))
  for (const summary of results) {
    console.log(`\n${summary.profile}: ${describePaths(summary.paths)}`)
    console.log(`${summary.profile}: guard widenings ${summary.widenings} in ${summary.widenedEdits} edits; mean text chars at splice ${summary.meanTextCharsAtSplice}; ms ${JSON.stringify(summary.ms)}; source ${summary.src}`)
    console.log(`${summary.profile} targeted: ${JSON.stringify(summary.targeted)}`)
    for (const failure of summary.failures) console.log(JSON.stringify(failure))
  }
  if (out !== undefined) writeFileSync(out, JSON.stringify(results, null, 2))
  if (results.some(summary => failing(summary) > 0)) process.exit(1)
}

if (process.argv.includes('--child')) await child()
else await parent()
