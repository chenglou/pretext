// Independent bookkeeping controls: no native browser, real-font, or total-shaping claim.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Part, ShapeResult, Shaper, View } from '../../src/engines/blink/shape.js'

type Shape = typeof import('../../src/engines/blink/shape.js')
type A6View = Omit<View, 'kind'> & { parts: Part[] }
type Module = { shape: Shape; limits: typeof import('../../src/engines/blink/limits.js'); legacy: boolean }
const flags = new Map(process.argv.slice(2).map(arg => {
  const match = /^--(base|head|out)=(.+)$/s.exec(arg)
  if (match === null) throw new Error(`Unknown argument ${arg}`)
  return [match[1]!, match[2]!] as const
}))
const baseRoot = resolve(flags.get('base') ?? '/private/tmp/pretext-stateless-round2-baseline-20260922')
const headRoot = resolve(flags.get('head') ?? join(import.meta.dir, '../../..'))
const out = resolve(flags.get('out') ?? '/private/tmp/pretext-blink-view-proof.json')
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
function seal(root: string): string {
  const files: Array<[string, string]> = []
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name.endsWith('.js') && existsSync(path.slice(0, -3) + '.ts')) throw new Error(`source-bypassing JS sidecar: ${path}`)
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push([path.slice(root.length), hash(readFileSync(path, 'utf8'))])
    }
  }
  visit(join(root, 'rebuild/src'))
  return hash(JSON.stringify(files))
}
async function load(root: string, legacy: boolean): Promise<Module> {
  return { shape: await import(join(root, 'rebuild/src/engines/blink/shape.ts')) as Shape,
    limits: await import(join(root, 'rebuild/src/engines/blink/limits.ts')) as Module['limits'], legacy }
}
const before = { base: seal(baseRoot), head: seal(headRoot) }
const base = await load(baseRoot, true), head = await load(headRoot, false)
// Tab results need no prepared glyph/font facts: prefix16 is their defined arithmetic, and their position limits are null.
const shaper = { p: { text: 'a'.repeat(40), is8Bit: true }, gaps: null } as unknown as Shaper
const counts = { direct: 0, trims: 0, joins: 0, prefix: 0, grapheme: 0, limits: 0, originalUnchanged: 0 }
let failures = 0
const counterexamples: unknown[] = []
function parts(module: Module, view: View): Part[] {
  return module.legacy ? (view as A6View).parts : Array.from({ length: module.shape.viewPartCount(view) }, (_, i) => module.shape.viewPartAt(view, i))
}
function normalized(module: Module, view: View) {
  return { width: view.width, rtl: view.rtl, startIndex: view.startIndex, charIndexOffset: view.charIndexOffset,
    numCharacters: view.numCharacters, parts: parts(module, view).map(part => ({ kind: part.kind,
      source: part.kind === 'range' ? part.sr : part.call, start: part.start, end: part.end,
      index: part.index, offset: part.offset, length: part.length })) }
}
function equal(label: string, a: unknown, b: unknown, input: unknown): void {
  if (isDeepStrictEqual(a, b)) return
  failures++
  if (counterexamples.length < 10) counterexamples.push({ label, input, base: a, head: b })
}
function check(a: View, b: View, input: unknown): void {
  equal('bookkeeping/float32 width', normalized(base, a), normalized(head, b), input)
  for (let k = 0; k <= 12; k++) {
    equal('prefix16', base.shape.viewPrefix16(shaper, a, k), head.shape.viewPrefix16(shaper, b, k), { input, k }); counts.prefix++
    equal('position limit', base.limits.viewPositionLimit(shaper, a, k), head.limits.viewPositionLimit(shaper, b, k), { input, k }); counts.limits++
  }
  const ap = parts(base, a), bp = parts(head, b)
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    for (const position of [ap[i]!.start, ap[i]!.index, a.startIndex + a.charIndexOffset]) {
      equal('grapheme numbering', base.shape.partGraphemeStarts(shaper, a, ap[i]!, position),
        head.shape.partGraphemeStarts(shaper, b, bp[i]!, position), { input, i, position }); counts.grapheme++
    }
  }
}
function trim(a: View, b: View, start: number, end: number, input: unknown): [View, View] {
  const originalA = normalized(base, a), originalB = normalized(head, b)
  const clippedA = base.shape.truncateView(shaper, a, start, end), clippedB = head.shape.truncateView(shaper, b, start, end)
  check(clippedA, clippedB, { input, trim: [start, end] }); counts.trims++
  equal('A6 original after trim', normalized(base, a), originalA, input)
  equal('current original after trim', normalized(head, b), originalB, input); counts.originalUnchanged += 2
  return [clippedA, clippedB]
}
const widths: Array<[number, number]> = [[0, 0], [1, 1], [65537, 65539], [0x1000000 - 1, 1], [0x1000000, 3], [0x1000001, 0x1000003], [0x4000001, 0x8000003]]
for (const rtl of [false, true]) for (const sourceStart of [0, 3]) for (const length of [0, 1, 4]) for (const [first16, rest16] of widths) {
  const sr: ShapeResult = { kind: 'tabs', start: sourceStart, end: sourceStart + length, rtl,
    first16, rest16, width16: length === 0 ? 0 : first16 + (length - 1) * rest16 }
  const edges = [...new Set([0, sourceStart, sourceStart + 1, Math.max(0, sr.end - 1), sr.end, sr.end + 1, base.shape.WHOLE])].sort((a, b) => a - b)
  for (const start of edges) for (const end of edges) {
    if (start > end) continue
    const a = base.shape.viewOf(shaper, sr, start, end), b = head.shape.viewOf(shaper, sr, start, end)
    const input = { sr, cut: [start, end] }; check(a, b, input); counts.direct++
    // A direct result segment takes the same route as viewOf, including explicit reversed numbering.
    check(base.shape.viewFromSegments(shaper, rtl, [{ kind: 'result', sr, start, end }]),
      head.shape.viewFromSegments(shaper, rtl, [{ kind: 'result', sr, start, end }]), { ...input, method: 'single segment' })
    for (const [cutStart, cutEnd] of [[sourceStart, sr.end], [start, start], [sourceStart + 1, sr.end + 1], [0, base.shape.WHOLE]] as const) {
      const [ta, tb] = trim(a, b, cutStart, cutEnd, input)
      trim(ta, tb, Math.min(cutStart, sr.end), Math.max(cutStart, sr.end), { input, secondTrim: true })
    }
  }
}
for (const rtl of [false, true]) for (const widthsOfRun of [[65537, 65539], [0x1000001, 0x1000003]] as const) {
  const left: ShapeResult = { kind: 'tabs', start: 2, end: 6, rtl, first16: widthsOfRun[0], rest16: widthsOfRun[1], width16: widthsOfRun[0] + 3 * widthsOfRun[1] }
  const right: ShapeResult = { ...left, start: 6, end: 10, first16: widthsOfRun[1], width16: 4 * widthsOfRun[1] }
  for (const leftCut of [[2, 6], [3, 5], [4, 4]] as const) for (const rightCut of [[6, 10], [7, 9], [8, 8]] as const) {
    const segments = [{ kind: 'result' as const, sr: left, start: leftCut[0], end: leftCut[1] },
      { kind: 'result' as const, sr: right, start: rightCut[0], end: rightCut[1] }]
    const a = base.shape.viewFromSegments(shaper, rtl, segments), b = head.shape.viewFromSegments(shaper, rtl, segments)
    const input = { rtl, widthsOfRun, leftCut, rightCut }; check(a, b, input); counts.joins++
    for (let start = 0; start <= 11; start++) for (let end = start; end <= 11; end++) trim(a, b, start, end, input)
    // Joining existing views preserves each source's bookkeeping without changing it.
    const av = base.shape.viewOf(shaper, left), bv = head.shape.viewOf(shaper, left)
    check(base.shape.viewFromSegments(shaper, rtl, [{ kind: 'view', view: av, start: 2, end: 6 }, segments[1]!]),
      head.shape.viewFromSegments(shaper, rtl, [{ kind: 'view', view: bv, start: 2, end: 6 }, segments[1]!]), { input, joinedView: true })
  }
}
const after = { base: seal(baseRoot), head: seal(headRoot) }
const stable = isDeepStrictEqual(before, after)
const report = { method: 'Independent A6/current tab-result bookkeeping and float32 arithmetic controls',
  scope: 'Defined tab arithmetic, result clipping, empty/inside-zero/outside cuts, single and multiple parts, RTL numbering, repeated view trimming, prefix and grapheme numbering, null tab position limits, original non-mutation. No Canvas questions or installed font assertions; actual group/run/query-order proof is separate.',
  base: baseRoot, head: headRoot, widths, counts, failures, counterexamples, sourceStable: stable, before, after,
  helperHash: hash(readFileSync(import.meta.path, 'utf8')) }
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify({ counts, failures, sourceStable: stable, counterexamples }) + '\n')
if (!stable || failures > 0) process.exitCode = 1
