// An attack on words first in Blink's port (src/engines/blink/shape.ts addWordPieces, line-breaker.ts candidateAt and
// wordCandidate): a hunt for a line where the words and the cut search, or the walk over the cuts and the search over
// every offset, disagree. Not a test: nothing reads its exit code but the person who runs it.
//
//   bun rebuild/tools/words-attack.ts --a=<base checkout> --b=<checkout> --cases=<cases.ndjson>[,<more>]
//     [--widths=60,150,400] [--boundary=yes] [--canvas=usual|fine|across|far|backwards] [--dpr=2] [--limit=N] [--jobs=N]
//     [--out=<report.json>]
//
// tools/two-trees.ts with a plain predictor on both sides compares line ranges alone. This driver loads both checkouts'
// function sets (src/index.ts) in one process and compares, per case and width, as JSON:
// - `trees`: the base's plain paragraph against the checkout's, every line's fill result, its pieces and its decided line
//   (LineInfo: widths, positions, item results), so a width that moved shows where a range didn't;
// - `candidate`: the checkout's plain paragraph against the same with LineBreaker.wordCandidate answering -1 (the search
//   over every offset decides every line), the same fields: the candidate alone, with the word cuts on both sides;
// - `inspected`: the checkout's plain paragraph against its inspected one, fill results and pieces.
// Beside them, the layouts whose inspected paragraph reports one of the premises' gaps (words first's context-past-a-word
// and positions-run-backwards, the cut predictor's nested-window-wider), and of the layouts where `trees` or `candidate`
// differ, the ones that report one: a stand-in that keeps the premises must show none, and one that breaks a premise
// must show a gap on every layout that differs.
// The paragraph and the environment of a case are the ones the checkout's usual predictor gives the library, as
// tests/function-set.ts reads them.
//
// `--boundary=yes` lays every case out at its width (or each of --widths), then again at each decided line's own width
// and one LayoutUnit (1/64 px) to either side of it, where `position <= x` and `x < position` part: a sum of rounded
// parts against a rounded sum shows there or nowhere.
//
// `--canvas` picks the stand-in Canvas (no font; the answers are a fixed function of the context and the string):
// - usual: tests/stand-in-canvas.ts, whose values lie on a grid of 1/1024 px.
// - fine: advances and kerns on the grid of 1/65536 px, Blink's own unit, so no sum is helped by a coarse grid.
// - across: `fine`, and a letter after a space takes another advance by the letter before that space: something that
//   crosses a space and is no pair beside it, which the two words around the space measured together show.
// - far: `fine`, and a letter after a space takes another advance by the last letter of the word before the one before
//   the space: context that reaches more than one word past a space, which breaks words first's premise.
// - backwards: `fine`, and some letters inside a word take a negative advance, so positions inside a word run backwards
//   while the words' edges stay sorted: the premise of the walk that the words can't show.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installPage, type PageFacts } from '../lab/measurements.ts'
import type { Case, LayoutPrediction } from '../lab/types.ts'
import { installStandIn } from '../tests/stand-in-canvas.ts'

const REPO = resolve(import.meta.dir, '../..')
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const PREDICT_ENV = { browser: 'chrome', build: '153.0.8010.50', languages: { engine: 'blink', uiLanguage: 'zh-CN' } }

const options = new Map<string, string>()
const given = process.argv.slice(2)
// The hidden command `work` runs one slice of the cases.
const isWork = given[0] === 'work'
for (let i = isWork ? 1 : 0; import.meta.main && i < given.length; i++) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(given[i]!)
  if (match === null) throw new Error(`Unknown argument ${given[i]!}`)
  options.set(match[1]!, match[2]!)
}

// ---- The stand-in Canvases ----

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

function hashOf(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = mix(h, text.charCodeAt(i))
  return h
}

const MARK = /^\p{M}$/u
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u
const WIDE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u
const LETTER = /^\p{L}$/u
const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'fontStretch', 'fontVariantCaps', 'textAlign', 'textBaseline']

export type Variant = 'fine' | 'across' | 'far' | 'backwards'
type Kind = 'none' | 'wide' | 'space' | 'letter' | 'other'
const kinds = new Map<number, Kind>()
function kindOf(cp: number, ch: string): Kind {
  let kind = kinds.get(cp)
  if (kind === undefined) {
    // U+2028 is the space of Blink's measured strings (shape.ts canvasString).
    kind = MARK.test(ch) || IGNORABLE.test(ch) ? 'none' : WIDE.test(ch) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || cp > 0xffff ? 'wide' : cp === 0x20 || cp === 0xa0 || cp === 0x2028 ? 'space' : LETTER.test(ch) ? 'letter' : 'other'
    kinds.set(cp, kind)
  }
  return kind
}

// Every value is a whole number of 1/65536 px, so a sum of them is exact in a double.
const UNIT = 65536
function fineWidth(variant: Variant, size: number, seed: number, text: string, letterSpacing: number, wordSpacing: number, kerns: boolean): number {
  let total = 0
  let previous = -1
  let previousKind: Kind = 'none'
  let beforeSpace = -1
  let farBefore = -1
  let joinsNext = false
  let indexInWord = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x200d) {
      if (previousKind === 'letter') total += Math.round(size * UNIT * (((mix(seed, previous) % 5) - 2) / 32))
      joinsNext = true
      continue
    }
    const kind = kindOf(cp, ch)
    if (kind === 'none') continue
    let own = kind === 'wide' ? size * UNIT : kind === 'space' ? Math.round(size * UNIT * (0.25 + (seed % 4) / 64)) + (seed % 977) : Math.round(size * UNIT * (0.4 + (mix(seed, cp) % 24) / 64)) + (mix(seed ^ 7, cp) % 1021)
    if (joinsNext && kind === 'letter') own += Math.round(size * UNIT * (((mix(seed ^ 1, cp) % 5) - 2) / 32))
    // Pairs kern, a space's pairs too, by odd numbers of units.
    if (kerns && previous >= 0 && mix(mix(seed, previous), cp) % 3 === 0) own -= Math.round(size * UNIT / 32) + (mix(seed ^ 3, cp) % 511)
    if (letterSpacing === 0 && previous === 0x66 && (cp === 0x69 || cp === 0x6c)) own -= Math.round(size * UNIT / 16)
    // across: the first letter after a space, by the letter before the space.
    if (variant === 'across' && previousKind === 'space' && beforeSpace >= 0 && kind !== 'space' && mix(mix(seed ^ 11, beforeSpace), cp) % 4 === 0) own += Math.round(size * UNIT / 8)
    // far: the first letter after a space, by the last letter of the word before the one before the space.
    if (variant === 'far' && previousKind === 'space' && farBefore >= 0 && kind !== 'space' && mix(mix(seed ^ 17, farBefore), cp) % 4 === 0) own += Math.round(size * UNIT / 8)
    // backwards: the third character of a word and every fourth after it, by the character: narrower than nothing.
    if (variant === 'backwards' && kind !== 'space' && indexInWord >= 2 && indexInWord % 4 === 2 && mix(seed ^ 13, cp) % 3 === 0) own = -Math.round(size * UNIT / 4)
    own += Math.round(letterSpacing * UNIT)
    if (cp === 0x20 || cp === 0xa0) own += Math.round(wordSpacing * UNIT)
    if (kind === 'space') {
      if (previousKind !== 'space') {
        farBefore = beforeSpace
        beforeSpace = previous
      }
      indexInWord = 0
    } else {
      indexInWord++
    }
    previous = cp
    previousKind = kind
    joinsNext = false
    total += own
  }
  return total / UNIT
}

export function installVariant(variant: Variant, env: PageFacts): { restore: () => void } {
  const fonts = new Map<string, { size: number; seed: number }>()
  class Context {
    values = new Map<string, string>()
    measureText(text: string): Partial<TextMetrics> {
      const shorthand = this.values.get('font') ?? '10px sans-serif'
      let font = fonts.get(shorthand)
      if (font === undefined) {
        font = { size: Number(/(\d+(?:\.\d+)?)px/.exec(shorthand)?.[1] ?? 10), seed: hashOf(shorthand.replace(/(\d+(?:\.\d+)?)px/, '')) }
        fonts.set(shorthand, font)
      }
      const px = (name: string): number => Number.parseFloat(this.values.get(name) ?? '0') || 0
      const total = fineWidth(variant, font.size, font.seed, text, px('letterSpacing'), px('wordSpacing'), this.values.get('fontKerning') !== 'none')
      return {
        width: total, actualBoundingBoxLeft: 0, actualBoundingBoxRight: total, actualBoundingBoxAscent: font.size * 0.75, actualBoundingBoxDescent: font.size * 0.25,
        fontBoundingBoxAscent: font.size * 0.875, fontBoundingBoxDescent: font.size * 0.25,
      }
    }
  }
  for (let i = 0; i < SETTINGS.length; i++) {
    const name = SETTINGS[i]!
    Object.defineProperty(Context.prototype, name, {
      get(this: Context): string { return this.values.get(name) ?? '' },
      set(this: Context, value: unknown): void { this.values.set(name, String(value)) },
    })
  }
  return { restore: installPage(env, class { getContext(): Context { return new Context() } }) }
}

// ---- One slice of the cases (hidden command `work`) ----

type FillResult = { kind: 'line'; line: { info?: unknown }; next: unknown; hasLineBox: boolean } | { kind: 'below-floats'; line: unknown; next: unknown }
type FunctionSet = {
  prepare: (paragraph: unknown, env: unknown, inspect: boolean) => unknown
  firstLine: (prepared: unknown) => unknown
  fillLine: (prepared: unknown, start: unknown, slot: { width: number; left: number; right: number }) => FillResult
  linePieces: (prepared: unknown, line: unknown) => unknown
  inspectLine: (prepared: unknown, line: unknown) => { gaps?: unknown[] }
  paragraphGaps: (prepared: unknown) => unknown[]
}
type Walked = { lines: string[]; infos: string[]; widths: number[]; premiseGaps: Set<string>; error: string | null }
type Difference = { id: string; family: string; width: number; check: 'trees' | 'candidate' | 'inspected'; first: string; gaps: string[] }
type SliceResult = {
  layouts: number; lines: number
  differ: Record<string, number>; errors: Record<string, number>
  // Layouts whose inspected paragraph reports each premise's gap, and of the layouts where `trees` or `candidate`
  // differ, the ones whose inspected paragraph reports one.
  premiseGaps: Record<string, number>
  treesDifferWithGap: number
  candidateDifferWithGap: number
  differences: Difference[]
}
const PREMISE_GAPS = ['context-past-a-word', 'positions-run-backwards', 'nested-window-wider']

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function walk(lib: FunctionSet, paragraph: unknown, env: unknown, inspect: boolean, c: Case, width: number): Walked {
  const out: Walked = { lines: [], infos: [], widths: [], premiseGaps: new Set(), error: null }
  const note = (gaps: readonly unknown[] | undefined): void => {
    for (const gap of gaps ?? []) {
      const name = (gap as { gap: string }).gap
      if (PREMISE_GAPS.includes(name)) out.premiseGaps.add(name)
    }
  }
  try {
    const prepared = lib.prepare(paragraph, env, inspect)
    if (inspect) note(lib.paragraphGaps(prepared))
    const insets = c.inline?.lineSlots ?? []
    let row = 0
    for (let start = lib.firstLine(prepared); start !== null;) {
      const inset = row < insets.length ? insets[row]! : { left: 0, right: 0 }
      const result = lib.fillLine(prepared, start, { width, left: inset.left, right: inset.right })
      if (result.kind === 'line') {
        out.lines.push(JSON.stringify({ kind: result.kind, next: result.next, hasLineBox: result.hasLineBox, pieces: lib.linePieces(prepared, result.line) }))
        const info = result.line.info as { width?: number } | undefined
        out.infos.push(JSON.stringify(info ?? null))
        if (info !== undefined && typeof info.width === 'number') out.widths.push(info.width)
        if (inspect) note(lib.inspectLine(prepared, result.line).gaps)
        if (result.hasLineBox) row++
      } else {
        out.lines.push(JSON.stringify({ kind: result.kind, next: result.next }))
        out.infos.push('null')
        row++
      }
      start = result.next
    }
  } catch (error) {
    out.error = message(error)
  }
  return out
}

function firstDifference(before: Walked, after: Walked, withInfos: boolean): string | null {
  if (before.error !== after.error) return `error: ${before.error} -> ${after.error}`
  if (before.lines.length !== after.lines.length) return `lines: ${before.lines.length} -> ${after.lines.length}`
  for (let i = 0; i < before.lines.length; i++) {
    if (before.lines[i] !== after.lines[i]) return `line ${i}: ${before.lines[i]!.slice(0, 160)} -> ${after.lines[i]!.slice(0, 160)}`
    if (withInfos && before.infos[i] !== after.infos[i]) {
      const x = before.infos[i]!
      const y = after.infos[i]!
      let at = 0
      while (at < x.length && x[at] === y[at]) at++
      return `line ${i} info at ${at}: ${x.slice(Math.max(0, at - 60), at + 60)} -> ${y.slice(Math.max(0, at - 60), at + 60)}`
    }
  }
  return null
}

async function work(): Promise<void> {
  const a = await import(join(options.get('a')!, 'rebuild/src/index.ts')) as FunctionSet
  const b = await import(join(options.get('b')!, 'rebuild/src/index.ts')) as FunctionSet
  const predictor = await import(join(options.get('b')!, 'rebuild/lab/baselines/no-facts-predictor.ts')) as { predict: (c: Case, env: unknown) => LayoutPrediction | { error: string } }
  const breaker = await import(join(options.get('b')!, 'rebuild/src/engines/blink/line-breaker.ts')) as { LineBreaker: { prototype: { wordCandidate: (...args: unknown[]) => number } } }
  const fromWords = breaker.LineBreaker.prototype.wordCandidate
  const variant = options.get('canvas') ?? 'usual'
  const boundary = options.get('boundary') === 'yes'
  const asked = options.get('widths') === undefined ? null : options.get('widths')!.split(',').map(Number)
  const cases: Case[] = []
  for (const file of options.get('cases')!.split(',')) for (const line of readFileSync(file, 'utf8').split('\n')) if (line !== '') cases.push(JSON.parse(line) as Case)
  const result: SliceResult = { layouts: 0, lines: 0, differ: { trees: 0, candidate: 0, inspected: 0 }, errors: {}, premiseGaps: {}, treesDifferWithGap: 0, candidateDifferWithGap: 0, differences: [] }
  const from = Number(options.get('from'))
  const to = Math.min(cases.length, Number(options.get('to')))
  for (let i = from; i < to; i++) {
    const c = cases[i]!
    const env: PageFacts = { userAgent: USER_AGENT, devicePixelRatio: Number(options.get('dpr') ?? 2), pageLang: c.pageLang }
    const page = variant === 'usual' ? installStandIn(env) : installVariant(variant as Variant, env)
    try {
      const prediction = predictor.predict(c, PREDICT_ENV)
      if (!('layout' in prediction)) continue
      const paragraph = prediction.paragraph
      const libEnv = prediction.layout.env
      const widths = asked === null ? [c.paragraph.width] : asked.slice()
      const seen = new Set<number>(widths)
      for (let w = 0; w < widths.length; w++) {
        const width = widths[w]!
        const proto = walk(b, paragraph, libEnv, false, c, width)
        breaker.LineBreaker.prototype.wordCandidate = () => -1
        const searched = walk(b, paragraph, libEnv, false, c, width)
        breaker.LineBreaker.prototype.wordCandidate = fromWords
        const inspected = walk(b, paragraph, libEnv, true, c, width)
        const base = walk(a, paragraph, libEnv, false, c, width)
        result.layouts++
        result.lines += proto.lines.length
        if (proto.error !== null) result.errors[proto.error.slice(0, 120)] = (result.errors[proto.error.slice(0, 120)] ?? 0) + 1
        const checks: Array<[Difference['check'], string | null]> = [
          ['trees', firstDifference(base, proto, true)], ['candidate', firstDifference(searched, proto, true)], ['inspected', firstDifference(inspected, proto, false)],
        ]
        for (const name of inspected.premiseGaps) result.premiseGaps[name] = (result.premiseGaps[name] ?? 0) + 1
        const gaps = [...inspected.premiseGaps]
        for (let k = 0; k < checks.length; k++) {
          const first = checks[k]![1]
          if (first === null) continue
          result.differ[checks[k]![0]]!++
          if (checks[k]![0] === 'trees' && gaps.length > 0) result.treesDifferWithGap++
          if (checks[k]![0] === 'candidate' && gaps.length > 0) result.candidateDifferWithGap++
          if (result.differences.length < 40) result.differences.push({ id: c.id, family: c.family, width, check: checks[k]![0], first, gaps })
        }
        // A decided line's own width, in px of the slot (LayoutUnits over the layout zoom), and a unit to either side.
        if (boundary && w < (asked === null ? 1 : asked.length)) {
          const zoom = env.devicePixelRatio
          for (let l = 0; l < proto.widths.length && l < 6; l++) {
            for (let d = -1; d <= 1; d++) {
              const at = (proto.widths[l]! + d) / 64 / zoom
              if (at > 0 && !seen.has(at)) {
                seen.add(at)
                widths.push(at)
              }
            }
          }
        }
      }
    } finally {
      breaker.LineBreaker.prototype.wordCandidate = fromWords
      page.restore()
    }
  }
  writeFileSync(options.get('result')!, JSON.stringify(result))
}

// ---- The run ----

async function run(): Promise<void> {
  const files = options.get('cases')!.split(',').map(file => resolve(file))
  let count = 0
  for (const file of files) for (const line of readFileSync(file, 'utf8').split('\n')) if (line !== '') count++
  count = Math.min(count, Number(options.get('limit') ?? Infinity))
  const jobs = Math.max(1, Number(options.get('jobs') ?? 4))
  const dir = mkdtempSync(join(tmpdir(), 'words-attack-'))
  const size = Math.max(1, Math.ceil(count / (jobs * 6)))
  const slices: Array<{ from: number; to: number; result: string }> = []
  for (let from = 0; from < count; from += size) slices.push({ from, to: Math.min(count, from + size), result: join(dir, `slice-${slices.length}.json`) })
  let next = 0
  const failed: number[] = []
  const started = Date.now()
  await Promise.all(Array.from({ length: Math.min(jobs, slices.length) }, async () => {
    while (next < slices.length) {
      const slice = slices[next++]!
      const args = ['work', `--a=${resolve(options.get('a')!)}`, `--b=${resolve(options.get('b')!)}`, `--cases=${files.join(',')}`, `--from=${slice.from}`, `--to=${slice.to}`, `--result=${slice.result}`]
      for (const name of ['widths', 'boundary', 'canvas', 'dpr']) if (options.has(name)) args.push(`--${name}=${options.get(name)!}`)
      const proc = Bun.spawn(['bun', import.meta.path, ...args], { cwd: REPO, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
      if (await proc.exited !== 0) failed.push(slice.from)
    }
  }))
  const total: SliceResult = { layouts: 0, lines: 0, differ: { trees: 0, candidate: 0, inspected: 0 }, errors: {}, premiseGaps: {}, treesDifferWithGap: 0, candidateDifferWithGap: 0, differences: [] }
  for (const slice of slices) {
    if (failed.includes(slice.from)) continue
    const result = JSON.parse(readFileSync(slice.result, 'utf8')) as SliceResult
    total.layouts += result.layouts
    total.lines += result.lines
    total.treesDifferWithGap += result.treesDifferWithGap
    total.candidateDifferWithGap += result.candidateDifferWithGap
    for (const [key, n] of Object.entries(result.premiseGaps)) total.premiseGaps[key] = (total.premiseGaps[key] ?? 0) + n
    for (const [key, n] of Object.entries(result.differ)) total.differ[key] = (total.differ[key] ?? 0) + n
    for (const [key, n] of Object.entries(result.errors)) total.errors[key] = (total.errors[key] ?? 0) + n
    for (const difference of result.differences) if (total.differences.length < 200) total.differences.push(difference)
  }
  execFileSync('trash', [dir])
  const report = { a: options.get('a'), b: options.get('b'), cases: files.length, canvas: options.get('canvas') ?? 'usual', widths: options.get('widths') ?? 'own', boundary: options.get('boundary') === 'yes', failedSlices: failed, seconds: Math.round((Date.now() - started) / 1000), ...total }
  console.log(`[words-attack] ${report.canvas}${report.boundary ? ', boundary widths' : ''}: ${total.layouts} layouts, ${total.lines} lines: trees differ ${total.differ['trees']} (${total.treesDifferWithGap} with a premise's gap), candidate differs ${total.differ['candidate']} (${total.candidateDifferWithGap} with one), inspected differs ${total.differ['inspected']}; premise gaps reported ${JSON.stringify(total.premiseGaps)}; errors ${JSON.stringify(total.errors)}; failed slices ${failed.length} (${report.seconds} s)`)
  for (const difference of total.differences.slice(0, 12)) console.log(`  ${difference.check} ${difference.id} ${difference.family} at ${difference.width} [${difference.gaps.join(', ')}]: ${difference.first.slice(0, 300)}`)
  if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), `${JSON.stringify(report, null, 1)}\n`)
}

if (import.meta.main) {
  if (isWork) await work()
  else await run()
}
