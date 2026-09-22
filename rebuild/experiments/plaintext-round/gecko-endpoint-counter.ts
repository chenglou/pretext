// Owned indexed reads under identical retained answers. No timings or browser-performance claim.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { join, resolve } from 'node:path'
import { PINNED_BUILDS, type GeckoEnvironment } from '../../src/env.js'
import * as current from '../../src/engines/gecko/index.js'
import { createContextPool } from '../../src/measure/canvas.js'
import type { GeckoPrepared, GeckoUnit } from '../../src/engines/gecko/types.js'
import { installStandInCanvas } from '../../tools/stand-in-canvas.ts'
import { cases, type PlainCase } from './cases.ts'

const base = process.argv[2] ?? '/private/tmp/pretext-stateless-round3-baseline-20260922'
const baseline: typeof current = await import(`${base}/rebuild/src/engines/gecko/index.ts`)
const baselineCanvas: { createContextPool: typeof createContextPool } = await import(`${base}/rebuild/src/measure/canvas.ts`)
const head = resolve(import.meta.dir, '../../..')
const env: GeckoEnvironment = { engine: 'gecko', build: PINNED_BUILDS.gecko, devicePixelRatio: 2, pageLang: 'en',
  contentLanguage: null, regionalPrefsLocale: 'en-US', dictionaryBreaks: { kind: 'intl-segmenter-word' } }
type Counts = { unitOf: number; units: number; windows: number; offsets: number; clusterStart: number }
type Mode = 'full' | 'range'
const userAgent = 'Mozilla/5.0 Firefox/156.0'
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
function seal(tree: string): string {
  const files: string[] = []
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(?:js|mjs|cjs|jsx)$/.test(entry.name)) throw new Error(`Unexpected runtime sidecar: ${path}`)
      else if (entry.name.endsWith('.ts')) files.push(path.slice(tree.length), hash(readFileSync(path, 'utf8')))
    }
  }
  visit(join(tree, 'rebuild/src'))
  return hash(JSON.stringify(files))
}
function seals() {
  return { base: seal(base), head: seal(head), helpers: hash(JSON.stringify([
    import.meta.path, join(import.meta.dir, 'cases.ts'), join(head, 'rebuild/tools/stand-in-canvas.ts'),
  ].map(path => [path, hash(readFileSync(path, 'utf8'))]))) }
}

function counted<T extends object>(values: T, name: keyof Counts, counts: Counts): T {
  return new Proxy(values, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) counts[name]++
    return Reflect.get(target, key, target) as unknown
  } })
}
function wrapUnit(unit: GeckoUnit, counts: Counts): void {
  const inWord = unit.inWord
  if (inWord === null) return
  inWord.offsets = counted(inWord.offsets, 'offsets', counts)
  if (inWord.windows !== null) {
    for (const window of inWord.windows) wrapUnit(window, counts)
    inWord.windows = counted(inWord.windows, 'windows', counts)
  }
}
function instrument(p: GeckoPrepared, counts: Counts): void {
  for (const unit of p.units) wrapUnit(unit, counts)
  p.unitOf = counted(p.unitOf, 'unitOf', counts)
  p.units = counted(p.units, 'units', counts)
  p.clusterStart = counted(p.clusterStart, 'clusterStart', counts)
}
function drain(lib: typeof current, prepared: GeckoPrepared[], c: PlainCase, mode: Mode) {
  const cuts: unknown[] = []
  let lines = 0
  for (const width of c.widths) for (const p of prepared) {
    let steps = 0
    for (let start = lib.firstLine(p); start !== null;) {
      const insets = c.insets?.[steps++] ?? { left: 0, right: 0 }
      const f = mode === 'range' ? lib.fillLineRange(p, start, { width, ...insets }) : lib.fillLine(p, start, { width, ...insets })
      cuts.push(f.kind === 'line' ? { start: f.start, end: f.end, next: f.next, hasLineBox: f.hasLineBox } : f)
      if (f.kind === 'line' && f.hasLineBox) lines++
      start = f.next
    }
  }
  return { cuts, lines }
}
function run(lib: typeof current, c: PlainCase, mode: Mode, copies: number) {
  const canvas = installStandInCanvas({ userAgent, devicePixelRatio: 2, pageLang: c.paragraph.lang })
  try {
    const prepared = Array.from({ length: copies }, () => lib.prepare(structuredClone(c.paragraph), { ...env, pageLang: c.paragraph.lang }, false,
      lib === current ? createContextPool() : baselineCanvas.createContextPool()))
    drain(lib, prepared, c, mode)
    const counts: Counts = { unitOf: 0, units: 0, windows: 0, offsets: 0, clusterStart: 0 }
    for (const p of prepared) instrument(p, counts)
    canvas.reset()
    const result = drain(lib, prepared, c, mode)
    return { ...result, counts, canvas: canvas.asked() }
  } finally { canvas.restore() }
}

const control = cases([]).find(c => c.id === 'long-word')!
const selected: Array<{ c: PlainCase; copies: number }> = [64, 128, 256, 512].map(n => ({ copies: 4,
  c: { ...control, id: `unbroken-ascii/${n}`, widths: [24, 36, 48], paragraph: { ...control.paragraph,
    font: { ...control.paragraph.font, family: '"Helvetica Neue"' }, content: [{ kind: 'text', text: 'abcd'.repeat(n / 4) }] } },
}))
selected.push(...cases([]).filter(c => c.id.startsWith('endpoint/')).map(c => ({ c, copies: 1 })))
const rows = []
const before = seals()
for (const { c, copies } of selected) for (const mode of ['full', 'range'] as const) {
  const before = run(baseline, c, mode, copies), after = run(current, c, mode, copies)
  if (!isDeepStrictEqual(before.cuts, after.cuts) || before.lines !== after.lines || !isDeepStrictEqual(before.canvas, after.canvas)) {
    throw new Error(`counter instrumentation changed output or questions: ${c.id} ${mode}`)
  }
  rows.push({ id: c.id, mode, copies, lines: before.lines, canvas: before.canvas, baseline: before.counts, current: after.counts })
}
const after = seals()
const stable = isDeepStrictEqual(before, after)
if (!stable) throw new Error('Source/helper seal changed during counters')
const report = { scope: 'Indexed reads of owned source-to-unit maps, units, retained windows/offsets and cluster flags. Warm stand-in Canvas answers; no timing or native accuracy claim.',
  base, head, bunVersion: Bun.version, before, after, stable, environment: env,
  asciiContract: { font: '16px "Helvetica Neue"', texts: 'four identical abcd repetitions at 64/128/256/512 UTF-16 units', widths: [24, 36, 48],
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', letterSpacing: 0, wordSpacing: 0, direction: 'ltr', lang: 'en' }, rows }
const out = process.argv[3]
if (out !== undefined) writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
