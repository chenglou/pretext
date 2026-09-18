// Rule-family derivation (TEST-ARCHITECTURE.md §2.3). Each family paragraph is observed in one browser, and the widths
// where that browser's own line decision at a focus offset changes are derived from its observations alone:
//
// - Pass A: width 1 with overflow-wrap normal and, when the paragraph has its own overflow-wrap, width 1 with its own
//   styles. Native line starts after the first line are the break opportunities.
// - Pass B: width 100000. The extent of a source range [s, k) is the right edge of its code points' positive rects
//   minus the left edge, without trailing SPACE, TAB or LF under the modes where they hang (edge differences, not sums
//   of graphemes: TENTPOLES-CRITIC §2.E item 1).
// - Pass C: a target (s, k) asks at which width the line starting at s first reaches k. The fit threshold T from
//   recorded facts (fit.ts) is observed with one grid unit below it, plus guards at ±1, ±4 and ±16px.
// - Pass D: while the nearest observed widths where the line reaches k and doesn't are more than one grid unit apart,
//   16 widths between them, for at most 6 rounds.
//
// Wave 1 targets start at 0 and after every forced break. Once they are settled, every line start the browser produced
// right after a wave-1 line at that target's derived or bracket widths gets its own targets (wave 2): the line after the
// first word, where overflow-wrap breaks a word the first line didn't take, or the line after a HanKerning trim. The family's cases are the pass A and B paragraphs and, per resolved target, the adjacent grid
// widths where the line reaches k and one unit below; the expected lines are those observations. Nothing here reads a
// prediction or imports rebuild/src.
//
//   bun rebuild/tests/derive.ts --browser=chrome|webkit-host|firefox|safari --dir=<dir> [--seed=S] [--families=a,b]
//
// One call runs one offline step. It exits 10 and prints the case files still to observe, one per line, or exits 0 once
// <dir>/final holds the family cases. observe-families.sh loops: derive, observe under the lock, derive.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeCase, mergeCases, paragraphText, sortCases } from '../lab/cases/case.ts'
import { existingRows, readLines } from '../lab/rows.ts'
import { nativeLines, rowText } from '../lab/score.ts'
import type { BrowserBuild, BrowserKind, Case, InlineNode, InlineStructure, LabRow } from '../lab/types.ts'
import { FAMILIES } from './families/catalogue.ts'
import { expandFamily, type Draft, type Engine, type FamilyParagraph } from './families/types.ts'
import { fitThreshold, gridWidth, widthGrid } from './fit.ts'

export const DERIVATION_FORMAT = 'pretext-rule-derivation/1'
export const OBSERVE_EXIT = 10
const NARROW = 1
const UNWRAPPED = 100000
const GUARD_PX: readonly number[] = [-16, -4, -1, 1, 4, 16]
const D_POINTS = 16
// 17^6 exceeds the grid units between width 1 and the unwrapped width in every browser, so a window that starts there
// closes within the limit.
export const MAX_D_ROUNDS = 6
const TARGETS_PER_SEGMENT = 4
const TARGETS_PER_WAVE2_START = 2
const TARGETS_WAVE2 = 4
const MAX_CASES_PER_FILE = 12000
const HANGING_MODES = new Set(['normal', 'nowrap', 'pre-line', 'pre-wrap'])

export type Pass = 'A-normal' | 'A-own' | 'B' | 'C' | 'D'
// One case's role for one family paragraph; a case shared by paragraphs of several families has several.
type MetaRecord = { caseId: string; paragraph: string; pass: Pass; units: number | null; targets: string[] }
type State = { format: typeof DERIVATION_FORMAT; browser: BrowserKind; seed: string; families: string[]; createdAt: string }

// What one observation says, cached next to the rows.
type Observation = {
  caseId: string
  dpr: number
  // Keys of the native lines: 0 for the first line, else the cluster start of the first visible code point, or the
  // first code point with a rect. Empty lines from consecutive preserved newlines have no key. null with an issue.
  keys: number[] | null
  issue: string | null
  textLength: number
  // Pass B: per UTF-16 offset, the horizontal edges of the union of its positive rects, or null.
  left?: Array<number | null>
  right?: Array<number | null>
}

export function engineOfBrowser(browser: BrowserKind): Engine {
  switch (browser) {
    case 'chrome': return 'blink'
    case 'safari':
    case 'webkit-host': return 'webkit'
    case 'firefox': return 'gecko'
  }
}

function caseBrowser(browser: BrowserKind): BrowserKind {
  return browser === 'webkit-host' ? 'safari' : browser
}

export function readNdjson<T>(path: string): T[] {
  const out: T[] = []
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) if (lines[i]!.trim() !== '') out.push(JSON.parse(lines[i]!) as T)
  return out
}

export function writeNdjson(path: string, values: readonly unknown[]): void {
  let text = ''
  for (let i = 0; i < values.length; i++) text += `${JSON.stringify(values[i])}\n`
  writeFileSync(path, text)
}

function roundName(round: number): string {
  return `r${String(round).padStart(2, '0')}`
}

// ---- Observations ----

// Native lines by the scorer's own grouping (score.ts nativeLines, a named observer assumption). A line's key is the
// lowest offset of a code point with a positive rect on it, and 0 for the first line; keys that don't increase line by
// line make the observation unusable for derivation.
function observationOf(row: LabRow, withExtents: boolean): Observation {
  const text = rowText(row.case)
  const base = { caseId: row.id, dpr: row.env.devicePixelRatio, textLength: text.length }
  if ('skipped' in row.native) return { ...base, keys: null, issue: `native observation skipped: ${row.native.skipped}` }
  if ('error' in row.native) return { ...base, keys: null, issue: row.native.error }
  const lines = nativeLines(row.native, row.case.paragraph, row.browser)
  const lowest: number[] = new Array(lines.count).fill(Infinity)
  for (let i = 0; i < row.native.points.length; i++) {
    const point = row.native.points[i]!
    for (let k = 0; k < point.rects.length; k++) {
      const line = lines.points[i]![k]!
      if (line >= 0 && point.rects[k]!.width > 0 && point.offset < lowest[line]!) lowest[line] = point.offset
    }
  }
  const keys: number[] = []
  for (let line = 0; line < lines.count; line++) {
    if (lowest[line] === Infinity) continue
    const key = keys.length === 0 ? 0 : lowest[line]!
    if (keys.length > 0 && key <= keys[keys.length - 1]!) return { ...base, keys: null, issue: `native line ${line} starts at ${key}, not after the line above` }
    keys.push(key)
  }
  const observation: Observation = { ...base, keys, issue: null }
  if (withExtents) {
    const left: Array<number | null> = new Array(text.length).fill(null)
    const right: Array<number | null> = new Array(text.length).fill(null)
    for (const point of row.native.points) {
      for (const rect of point.rects) {
        if (!(rect.width > 0 && rect.height > 0)) continue
        left[point.offset] = Math.min(left[point.offset] ?? Infinity, rect.x)
        right[point.offset] = Math.max(right[point.offset] ?? -Infinity, rect.x + rect.width)
      }
    }
    observation.left = left
    observation.right = right
  }
  return observation
}

export type RoundFile = { round: number; index: number; cases: string; observed: string }

export function roundFiles(dir: string, round: number): RoundFile[] {
  const roundDir = join(dir, 'rounds', roundName(round))
  if (!existsSync(roundDir)) return []
  const out: RoundFile[] = []
  for (const name of readdirSync(roundDir).sort()) {
    const match = /^cases-(\d+)\.ndjson$/.exec(name)
    if (match !== null) out.push({ round, index: Number(match[1]), cases: join(roundDir, name), observed: join(roundDir, `observed-${match[1]}`) })
  }
  return out
}

export function roundsIn(dir: string): number[] {
  const roundsDir = join(dir, 'rounds')
  if (!existsSync(roundsDir)) return []
  return readdirSync(roundsDir).filter(name => /^r\d\d$/.test(name)).map(name => Number(name.slice(1))).sort((a, b) => a - b)
}

function observedComplete(file: RoundFile, browser: BrowserKind): boolean {
  const runPath = join(file.observed, `${browser}-run.json`)
  if (!existsSync(runPath) || existingRows(join(file.observed, `${browser}-rows.ndjson`)) === null) return false
  const run = JSON.parse(readFileSync(runPath, 'utf8')) as { status: string; totals: { selected: number; rows: number } }
  return run.status === 'ok' && run.totals.rows === run.totals.selected
}

async function loadObservations(file: RoundFile, browser: BrowserKind, meta: ReadonlyMap<string, MetaRecord[]>): Promise<Observation[]> {
  const cache = join(file.observed, 'derived.ndjson')
  // A round's rows may be compressed by now (compress-rows.sh); compressing them doesn't make the cache stale.
  const rows = existingRows(join(file.observed, `${browser}-rows.ndjson`))
  if (rows === null) throw new Error(`${file.observed}: no ${browser}-rows.ndjson, plain or .zst`)
  if (existsSync(cache) && (rows.endsWith('.zst') || statSync(cache).mtimeMs >= statSync(rows).mtimeMs)) return readNdjson<Observation>(cache)
  const out: Observation[] = []
  for await (const line of readLines(rows)) {
    const row = JSON.parse(line) as LabRow
    const records = meta.get(row.id)
    if (records === undefined) throw new Error(`${rows}: row ${row.id} is not in the round's meta`)
    out.push(observationOf(row, records.some(record => record.pass === 'B')))
  }
  writeNdjson(cache, out)
  return out
}

// The build the driver read from the app bundle before the run (lab/run.ts), which it also checks against every row's
// user agent.
export function buildOfRun(observed: string, browser: BrowserKind): BrowserBuild {
  const run = JSON.parse(readFileSync(join(observed, `${browser}-run.json`), 'utf8')) as { build?: BrowserBuild }
  if (run.build === undefined) throw new Error(`${observed}: ${browser}-run.json records no browser build`)
  return run.build
}

export function sameBuild(a: BrowserBuild, b: BrowserBuild): boolean {
  return a.app === b.app && a.appVersion === b.appVersion && a.engine === b.engine && a.os === b.os
}

// The browser process's given languages the run recorded (lab/types.ts ProcessLanguages), as one string; runs from before
// the driver recorded them give 'not recorded'. Rounds under other languages can't be combined: unlabeled content breaks by
// them (DESIGN.md §1.4).
export function languagesOfRun(observed: string, browser: BrowserKind): string {
  const run = JSON.parse(readFileSync(join(observed, `${browser}-run.json`), 'utf8')) as { languages?: { given: unknown } }
  return run.languages === undefined ? 'not recorded' : JSON.stringify(run.languages.given)
}

// Whether the paragraph sets an overflow-wrap other than normal on the block or on any span: pass A then observes it
// twice.
export function hasOwnOverflowWrap(draft: Pick<Draft, 'paragraph' | 'inline'>): boolean {
  if (draft.paragraph.overflowWrap !== 'normal') return true
  const any = (nodes: readonly InlineNode[]): boolean => nodes.some(node => node.kind === 'span' && (node.overflowWrap !== 'normal' || any(node.children)))
  return draft.inline !== undefined && any(draft.inline.content)
}

function overflowWrapNormal(nodes: readonly InlineNode[]): InlineNode[] {
  return nodes.map(node => node.kind === 'span' ? { ...node, overflowWrap: 'normal' as const, children: overflowWrapNormal(node.children) } : node)
}

// Lengths the case declares that narrow or widen the line at s besides its text: the first row's slot insets (DESIGN.md
// §2.9) and, for the first line, the text-indent. They only decide where to look. Box edges and atomic inlines aren't
// added; where they decide a bracket, pass D finds it.
export function declaredOffset(inline: InlineStructure | undefined, s: number): number {
  if (inline === undefined) return 0
  const slot = inline.lineSlots[0]
  return (slot === undefined ? 0 : slot.left + slot.right) + (s === 0 ? inline.textIndent : 0)
}

// ---- Targets ----

export type Target = { id: string; paragraph: string; wave: 1 | 2; s: number; k: number; derived: number; extent: number }
export type Outcome =
  | { kind: 'resolved'; hi: number; lo: number; nonMonotone: boolean }
  | { kind: 'window'; lo: number | null; hi: number; nonMonotone: boolean }
  | { kind: 'no-reach' }
// Why a window stayed open: bisection ran out of rounds, no observed width is narrower than where the line reaches k, or
// every width inside the window was observed without a native line starting at s (the line before it changed there too).
export type Unresolved = 'rounds-exhausted' | 'no-short-width' | 'no-line-inside'

// A width's native lines in the paragraph's own styles.
export type Observed = { units: number; keys: readonly number[]; textLength: number; caseId: string }

// Where the line starting at s ends, or null when no native line starts at s at this width.
export function lineEnd(obs: Observed, s: number): number | null {
  const index = obs.keys.indexOf(s)
  if (index === -1) return null
  return index + 1 < obs.keys.length ? obs.keys[index + 1]! : obs.textLength
}

// The narrowest observed width where the line starting at s reaches k, the widest narrower one where it doesn't, and
// whether a wider width stops short again.
export function evaluate(target: Pick<Target, 's' | 'k'>, own: readonly Observed[]): Outcome {
  let hi: number | null = null
  for (let i = 0; i < own.length; i++) {
    const end = lineEnd(own[i]!, target.s)
    if (end !== null && end >= target.k && (hi === null || own[i]!.units < hi)) hi = own[i]!.units
  }
  if (hi === null) return { kind: 'no-reach' }
  let lo: number | null = null
  let nonMonotone = false
  for (let i = 0; i < own.length; i++) {
    const end = lineEnd(own[i]!, target.s)
    if (end === null || end >= target.k) continue
    if (own[i]!.units > hi) nonMonotone = true
    else if (lo === null || own[i]!.units > lo) lo = own[i]!.units
  }
  if (lo !== null && hi - lo === 1) return { kind: 'resolved', hi, lo, nonMonotone }
  return { kind: 'window', lo, hi, nonMonotone }
}

// Up to D_POINTS grid widths strictly between lo and hi.
export function bisectionWidths(lo: number, hi: number): number[] {
  const out: number[] = []
  if (hi - lo - 1 <= D_POINTS) {
    for (let u = lo + 1; u < hi; u++) out.push(u)
    return out
  }
  for (let i = 1; i <= D_POINTS; i++) {
    const u = lo + Math.round((i * (hi - lo)) / (D_POINTS + 1))
    if (u > lo && u < hi && !out.includes(u)) out.push(u)
  }
  return out
}

function extentOf(b: Observation, text: string, whiteSpace: string, s: number, k: number): number | null {
  let end = k
  if (HANGING_MODES.has(whiteSpace)) while (end > s && (text[end - 1] === ' ' || text[end - 1] === '\t' || text[end - 1] === '\n')) end--
  let left = Infinity
  let right = -Infinity
  for (let i = s; i < end; i++) {
    const l = b.left![i]
    const r = b.right![i]
    if (l === null || l === undefined || r === null || r === undefined) continue
    left = Math.min(left, l)
    right = Math.max(right, r)
  }
  return right > left ? right - left : null
}

// The candidates at each focus offset, or the nearest on each side where the focus isn't one.
export function chooseByFocus(candidates: readonly number[], focus: readonly number[], from: number, to: number, cap: number): number[] {
  const inside = candidates.filter(k => k > from && k < to)
  const chosen: number[] = []
  const add = (k: number | undefined): void => {
    if (k !== undefined && !chosen.includes(k) && chosen.length < cap) chosen.push(k)
  }
  for (let i = 0; i < focus.length; i++) {
    const f = focus[i]!
    if (f <= from || f >= to) continue
    if (inside.includes(f)) {
      add(f)
      continue
    }
    let below: number | undefined
    let above: number | undefined
    for (const k of inside) {
      if (k < f) below = k
      else if (above === undefined) above = k
    }
    add(below)
    add(above)
  }
  return chosen
}

// ---- The step ----

type ParagraphData = { p: FamilyParagraph; text: string; normal: Observation | null; own: Observation | null; b: Observation | null; sized: Observed[] }
type Requested = { c: boolean; dRounds: number }

// The narrowest width in grid units at which the page describes the case's slots (DESIGN.md §2.9, lab score.ts
// slotProtocol), by each engine's float placement:
// - every engine: the widest row's insets, or a row's left and right floats don't fit side by side and the next float drops
//   into another row (CSS 2.1 §9.5.1 rule 7);
// - Gecko: row 0's second float is placed on the first line only when its margin box fits in the line's remaining inline
//   size, text-indent included (nsLineLayout::TryToPlaceFloat, nsLineLayout.cpp:1485-1492, BlockReflowState::AddFloat,
//   :604-607, FlowAndPlaceFloat, :793-798): left + right + indent must not exceed the width;
// - WebKit: a float with clear that shrinks a line already constrained by a float needs the indented line's room
//   (LineBuilder::tryPlacingFloatBox, haveEnoughSpaceForFloatWithClear, InlineLineBuilder.cpp:1317-1328, :1368-1380; the
//   indent moves the line's start, :470-476). In LTR the right float is placed against left float + indent; in RTL it is
//   start-positioned and the indent overlaps it, so left + max(right, indent) must not exceed the width;
// - Blink positions leading floats in the exclusion space before any line and before text-indent applies
//   (InlineLayoutAlgorithm::PositionLeadingFloats, inline_layout_algorithm.cc:1115, :1738), so only the first rule holds.
// Round 1's feature-family rows agree: Firefox moved row 0's right float in exactly the 15 rows over its bound, webkit-host
// in the 7 LTR rows over its bound and none of the 6 RTL ones, and Chrome in none.
export function minimumUnits(inline: InlineStructure | undefined, grid: number, engine: Engine, direction: 'ltr' | 'rtl'): number {
  let widest = 0
  const slots = inline?.lineSlots ?? []
  for (const slot of slots) widest = Math.max(widest, slot.left + slot.right)
  const first = slots[0]
  if (first !== undefined && first.left > 0 && first.right > 0) {
    const indent = inline!.textIndent
    if (engine === 'gecko' || (engine === 'webkit' && direction === 'ltr')) widest = Math.max(widest, first.left + first.right + indent)
    else if (engine === 'webkit') widest = Math.max(widest, first.left + Math.max(first.right, indent))
  }
  return Math.ceil(widest * grid)
}

// A family case at a width. Pass A observes the content's break opportunities, which floats and text-indent don't make:
// its cases leave out the line slots and the indent, since floats wider than width 1 stack past their rows and a negative
// indent lets the first line hold more than one piece.
function familyCase(p: FamilyParagraph, browser: BrowserKind, width: number, normalOverflowWrap: boolean, note: string, opportunities = false): Case {
  const draft = p.draft
  const paragraph = normalOverflowWrap ? { ...draft.paragraph, width, overflowWrap: 'normal' as const } : { ...draft.paragraph, width }
  let inline = draft.inline === undefined || !normalOverflowWrap ? draft.inline : { ...draft.inline, content: overflowWrapNormal(draft.inline.content) }
  if (inline !== undefined && opportunities) inline = { ...inline, textIndent: 0, lineSlots: [] }
  return makeCase({
    family: `rule/${p.family}`, origin: `rule-family=${p.family} paragraph=${p.key} ${note}`, pageLang: draft.pageLang,
    paragraph, inline, browsers: [caseBrowser(browser)], fontFixtures: draft.fontFixtures,
  })
}

async function step(dir: string, browser: BrowserKind, seed: string, familyFilter: readonly string[] | null): Promise<number> {
  const engine = engineOfBrowser(browser)
  const statePath = join(dir, 'state.json')
  if (!existsSync(statePath)) return plan(dir, browser, engine, seed, familyFilter)
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as State
  if (state.format !== DERIVATION_FORMAT || state.browser !== browser) throw new Error(`${statePath}: another format or browser`)
  const paragraphs = readNdjson<FamilyParagraph>(join(dir, 'paragraphs.ndjson'))
  const rounds = roundsIn(dir)
  const last = rounds[rounds.length - 1]!
  const pending = roundFiles(dir, last).filter(file => !observedComplete(file, browser))
  if (pending.length > 0) {
    for (const file of pending) console.log(file.cases)
    return OBSERVE_EXIT
  }

  // Every observation of every round; one build and DPR for all of them.
  const data = new Map<string, ParagraphData>()
  for (const p of paragraphs) data.set(p.key, { p, text: paragraphText(p.draft.paragraph), normal: null, own: null, b: null, sized: [] })
  const requested = new Map<string, Requested>()
  let build: BrowserBuild | null = null
  let languages: string | null = null
  let dpr: number | null = null
  for (const round of rounds) {
    const meta = new Map<string, MetaRecord[]>()
    for (const record of readNdjson<MetaRecord>(join(dir, 'rounds', roundName(round), 'meta.ndjson'))) {
      const list = meta.get(record.caseId) ?? []
      list.push(record)
      meta.set(record.caseId, list)
    }
    const dRequested = new Set<string>()
    for (const list of meta.values()) {
      for (const record of list) {
        for (const id of record.targets) {
          const entry = requested.get(id) ?? { c: false, dRounds: 0 }
          if (record.pass === 'C') entry.c = true
          if (record.pass === 'D') dRequested.add(id)
          requested.set(id, entry)
        }
      }
    }
    for (const id of dRequested) requested.get(id)!.dRounds++
    for (const file of roundFiles(dir, round)) {
      const fileBuild = buildOfRun(file.observed, browser)
      if (build === null) build = fileBuild
      else if (!sameBuild(build, fileBuild)) throw new Error(`${file.observed}: observed under another browser build than earlier rounds; derive again for the new build`)
      const fileLanguages = languagesOfRun(file.observed, browser)
      if (languages === null) languages = fileLanguages
      else if (languages !== fileLanguages) throw new Error(`${file.observed}: observed under other process languages (${fileLanguages}) than earlier rounds (${languages})`)
      for (const obs of await loadObservations(file, browser, meta)) {
        if (dpr === null) dpr = obs.dpr
        else if (dpr !== obs.dpr) throw new Error(`${file.observed}: DPR ${obs.dpr}, earlier rounds ${dpr}`)
        for (const record of meta.get(obs.caseId)!) {
          const entry = data.get(record.paragraph)!
          switch (record.pass) {
            case 'A-normal': entry.normal = obs; break
            case 'A-own': entry.own = obs; break
            case 'B': entry.b = obs; break
            case 'C':
            case 'D':
              if (obs.keys !== null && record.units !== null) entry.sized.push({ units: record.units, keys: obs.keys, textLength: obs.textLength, caseId: obs.caseId })
              break
          }
        }
      }
    }
  }
  const grid = widthGrid(browser, dpr!)
  const unwrappedUnits = UNWRAPPED * grid

  const targets: Target[] = []
  const outcomes = new Map<string, Outcome>()
  const requests = new Map<string, Map<number, { pass: Pass; targets: string[] }>>()
  const request = (entry: ParagraphData, own: readonly Observed[], units: number, pass: Pass, target: string): boolean => {
    if (units < grid || units < minimumUnits(entry.p.draft.inline, grid, engine, entry.p.draft.paragraph.direction) || units >= unwrappedUnits || own.some(obs => obs.units === units)) return false
    let widths = requests.get(entry.p.key)
    if (widths === undefined) requests.set(entry.p.key, (widths = new Map()))
    const existing = widths.get(units) ?? { pass, targets: [] }
    if (!existing.targets.includes(target)) existing.targets.push(target)
    widths.set(units, existing)
    return true
  }
  const advance = (entry: ParagraphData, own: readonly Observed[], target: Target): void => {
    const outcome = evaluate(target, own)
    outcomes.set(target.id, outcome)
    if (outcome.kind !== 'window') return
    const seen = requested.get(target.id) ?? { c: false, dRounds: 0 }
    if (!seen.c) {
      let any = request(entry, own, target.derived, 'C', target.id)
      any = request(entry, own, target.derived - 1, 'C', target.id) || any
      for (const px of GUARD_PX) any = request(entry, own, target.derived + px * grid, 'C', target.id) || any
      if (any) return
    }
    if (seen.dRounds >= MAX_D_ROUNDS) return
    for (const u of bisectionWidths(Math.max(outcome.lo ?? grid - 1, minimumUnits(entry.p.draft.inline, grid, engine, entry.p.draft.paragraph.direction) - 1), outcome.hi)) request(entry, own, u, 'D', target.id)
  }
  for (const entry of data.values()) {
    const { p, text, b, normal } = entry
    const ownNarrow = hasOwnOverflowWrap(p.draft) ? entry.own : normal
    if (b === null || b.keys === null || normal === null || normal.keys === null || ownNarrow === null || ownNarrow.keys === null) continue
    const narrow: Observed = { units: NARROW * grid, keys: ownNarrow.keys, textLength: ownNarrow.textLength, caseId: ownNarrow.caseId }
    const own: Observed[] = [narrow, ...entry.sized, { units: unwrappedUnits, keys: b.keys, textLength: b.textLength, caseId: b.caseId }]
    const candidates = [...new Set([...normal.keys.slice(1), ...(entry.own?.keys ?? []).slice(1)])].sort((x, y) => x - y)
    const segments = b.keys
    const segmentEnd = (s: number): number => {
      for (let i = 0; i < segments.length; i++) if (segments[i]! > s) return segments[i]!
      return text.length
    }
    const makeTarget = (s: number, k: number, wave: 1 | 2): Target | null => {
      const extent = extentOf(b, text, p.draft.paragraph.whiteSpace, s, k)
      if (extent === null) return null
      return { id: `${p.key}:${s}:${k}`, paragraph: p.key, wave, s, k, derived: fitThreshold(browser, dpr!, extent + declaredOffset(p.draft.inline, s)), extent }
    }
    const wave1: Target[] = []
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!
      const first = lineEnd(narrow, s)
      if (first === null) continue
      for (const k of chooseByFocus(candidates.filter(c => c > first), p.draft.focus, s, segmentEnd(s), TARGETS_PER_SEGMENT)) {
        const target = makeTarget(s, k, 1)
        if (target !== null) wave1.push(target)
      }
    }
    for (const target of wave1) {
      targets.push(target)
      advance(entry, own, target)
    }
    if (!wave1.every(target => outcomes.get(target.id)!.kind !== 'window' || (requested.get(target.id)?.dRounds ?? 0) >= MAX_D_ROUNDS)) continue
    const starts = new Set<number>()
    for (const target of wave1) {
      const outcome = outcomes.get(target.id)!
      const widths = outcome.kind === 'resolved' ? [target.derived, outcome.hi, outcome.lo] : [target.derived]
      for (const units of widths) {
        const at = own.find(obs => obs.units === units)
        if (at === undefined) continue
        const index = at.keys.indexOf(target.s)
        if (index !== -1 && index + 1 < at.keys.length && at.keys[index + 1]! < segmentEnd(target.s)) starts.add(at.keys[index + 1]!)
      }
    }
    const wave2 = new Map<string, Target>()
    for (const s of [...starts].sort((x, y) => x - y)) {
      const first = lineEnd(narrow, s)
      if (first === null) continue
      for (const k of chooseByFocus(candidates.filter(c => c > first), p.draft.focus, s, segmentEnd(s), TARGETS_PER_WAVE2_START)) {
        const next = makeTarget(s, k, 2)
        if (next !== null && wave2.size < TARGETS_WAVE2 && !wave2.has(next.id) && !wave1.some(t => t.id === next.id)) wave2.set(next.id, next)
      }
    }
    for (const target of wave2.values()) {
      targets.push(target)
      advance(entry, own, target)
    }
  }

  writeNdjson(join(dir, 'targets.ndjson'), targets.map(target => ({ ...target, outcome: outcomes.get(target.id), requested: requested.get(target.id) ?? null })))
  if (requests.size === 0) return finalize(dir, browser, state, data, targets, outcomes, requested, grid, build!, dpr!, languages!)
  const cases: Case[] = []
  const meta: MetaRecord[] = []
  for (const [key, widths] of requests) {
    const p = data.get(key)!.p
    for (const [units, entry] of widths) {
      const value = familyCase(p, browser, gridWidth(units, grid), false, `pass=${entry.pass} units=${units}/${grid}`)
      cases.push(value)
      meta.push({ caseId: value.id, paragraph: key, pass: entry.pass, units, targets: entry.targets })
    }
  }
  writeRound(dir, last + 1, cases, meta)
  for (const file of roundFiles(dir, last + 1)) console.log(file.cases)
  return OBSERVE_EXIT
}

// Identical paragraphs from different families fold into one case; meta keeps one record per paragraph and pass.
function writeRound(dir: string, round: number, cases: readonly Case[], meta: readonly MetaRecord[]): void {
  const roundDir = join(dir, 'rounds', roundName(round))
  mkdirSync(roundDir, { recursive: true })
  const merged = sortCases(mergeCases(cases))
  for (let part = 0; part * MAX_CASES_PER_FILE < merged.length; part++) {
    writeNdjson(join(roundDir, `cases-${part}.ndjson`), merged.slice(part * MAX_CASES_PER_FILE, (part + 1) * MAX_CASES_PER_FILE))
  }
  const byRole = new Map<string, MetaRecord>()
  for (const record of meta) {
    const key = `${record.caseId} ${record.paragraph} ${record.pass}`
    const previous = byRole.get(key)
    if (previous === undefined) byRole.set(key, { ...record, targets: [...record.targets] })
    else for (const id of record.targets) if (!previous.targets.includes(id)) previous.targets.push(id)
  }
  writeNdjson(join(roundDir, 'meta.ndjson'), [...byRole.values()])
}

function plan(dir: string, browser: BrowserKind, engine: Engine, seed: string, familyFilter: readonly string[] | null): number {
  mkdirSync(dir, { recursive: true })
  const families = FAMILIES.filter(family => family.rules[engine] !== undefined && (familyFilter === null || familyFilter.includes(family.name)))
  if (families.length === 0) throw new Error(`no family targets ${engine}`)
  const paragraphs: FamilyParagraph[] = []
  for (const family of families) paragraphs.push(...expandFamily(family, engine, seed))
  writeNdjson(join(dir, 'paragraphs.ndjson'), paragraphs)
  const state: State = { format: DERIVATION_FORMAT, browser, seed, families: families.map(family => family.name), createdAt: new Date().toISOString() }
  writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
  const cases: Case[] = []
  const meta: MetaRecord[] = []
  for (const p of paragraphs) {
    const normal = familyCase(p, browser, NARROW, true, 'pass=A-normal', true)
    cases.push(normal)
    meta.push({ caseId: normal.id, paragraph: p.key, pass: 'A-normal', units: null, targets: [] })
    if (hasOwnOverflowWrap(p.draft)) {
      const own = familyCase(p, browser, NARROW, false, 'pass=A-own', true)
      cases.push(own)
      meta.push({ caseId: own.id, paragraph: p.key, pass: 'A-own', units: null, targets: [] })
    }
    const unwrapped = familyCase(p, browser, UNWRAPPED, false, 'pass=B')
    cases.push(unwrapped)
    meta.push({ caseId: unwrapped.id, paragraph: p.key, pass: 'B', units: null, targets: [] })
  }
  writeRound(dir, 0, cases, meta)
  console.error(`[derive] ${browser}: ${families.length} families, ${paragraphs.length} paragraphs, ${new Set(cases.map(c => c.id)).size} pass A and B cases`)
  for (const file of roundFiles(dir, 0)) console.log(file.cases)
  return OBSERVE_EXIT
}

export type FinalRole = 'A-normal' | 'A-own' | 'B' | 'reach' | 'short'
export type FinalRecord = { caseId: string; family: string; paragraph: string; rules: readonly string[]; role: FinalRole; units: number | null; target: Target | null; offsetUnits: number | null; derivedFrom: string[] }
export type FamilyStats = { paragraphs: number; targets: number; resolved: number; atDerived: number; nonMonotone: number; noReach: number; unresolved: number; unresolvedReasons: Partial<Record<Unresolved, number>>; offsets: Record<string, number> }

export function unresolvedReason(outcome: Extract<Outcome, { kind: 'window' }>, dRounds: number): Unresolved {
  if (dRounds >= MAX_D_ROUNDS) return 'rounds-exhausted'
  return outcome.lo === null ? 'no-short-width' : 'no-line-inside'
}

function finalize(dir: string, browser: BrowserKind, state: State, data: ReadonlyMap<string, ParagraphData>, targets: readonly Target[], outcomes: ReadonlyMap<string, Outcome>,
  requested: ReadonlyMap<string, Requested>, grid: number, build: BrowserBuild, dpr: number, languages: string): number {
  const finalDir = join(dir, 'final')
  mkdirSync(finalDir, { recursive: true })
  const cases: Case[] = []
  const records: FinalRecord[] = []
  const stats = new Map<string, FamilyStats>()
  const statsOf = (family: string): FamilyStats => {
    let value = stats.get(family)
    if (value === undefined) stats.set(family, (value = { paragraphs: 0, targets: 0, resolved: 0, atDerived: 0, nonMonotone: 0, noReach: 0, unresolved: 0, unresolvedReasons: {}, offsets: {} }))
    return value
  }
  const byParagraph = new Map<string, Target[]>()
  for (const target of targets) {
    const list = byParagraph.get(target.paragraph) ?? []
    list.push(target)
    byParagraph.set(target.paragraph, list)
  }
  for (const entry of data.values()) {
    const { p } = entry
    const s = statsOf(p.family)
    s.paragraphs++
    const derivedFrom = [entry.normal?.caseId, entry.own?.caseId, entry.b?.caseId].filter((id): id is string => id !== undefined)
    const roles: Array<[Case, FinalRole]> = [[familyCase(p, browser, NARROW, true, 'role=A-normal', true), 'A-normal']]
    if (hasOwnOverflowWrap(p.draft)) roles.push([familyCase(p, browser, NARROW, false, 'role=A-own', true), 'A-own'])
    roles.push([familyCase(p, browser, UNWRAPPED, false, 'role=B'), 'B'])
    for (const [value, role] of roles) {
      cases.push(value)
      records.push({ caseId: value.id, family: p.family, paragraph: p.key, rules: p.rules, role, units: null, target: null, offsetUnits: null, derivedFrom: [] })
    }
    for (const target of byParagraph.get(p.key) ?? []) {
      s.targets++
      const outcome = outcomes.get(target.id)!
      switch (outcome.kind) {
        case 'no-reach': s.noReach++; break
        case 'window': {
          s.unresolved++
          const reason = unresolvedReason(outcome, requested.get(target.id)?.dRounds ?? 0)
          s.unresolvedReasons[reason] = (s.unresolvedReasons[reason] ?? 0) + 1
          break
        }
        case 'resolved': {
          s.resolved++
          if (outcome.nonMonotone) s.nonMonotone++
          const offset = outcome.hi - target.derived
          if (offset === 0) s.atDerived++
          s.offsets[String(offset)] = (s.offsets[String(offset)] ?? 0) + 1
          const reach = familyCase(p, browser, gridWidth(outcome.hi, grid), false, `role=reach target=${target.s}:${target.k}`)
          const short = familyCase(p, browser, gridWidth(outcome.lo, grid), false, `role=short target=${target.s}:${target.k}`)
          const from = [...derivedFrom, ...entry.sized.filter(obs => obs.units === outcome.hi || obs.units === outcome.lo).map(obs => obs.caseId)]
          cases.push(reach, short)
          records.push({ caseId: reach.id, family: p.family, paragraph: p.key, rules: p.rules, role: 'reach', units: outcome.hi, target, offsetUnits: offset, derivedFrom: from })
          records.push({ caseId: short.id, family: p.family, paragraph: p.key, rules: p.rules, role: 'short', units: outcome.lo, target, offsetUnits: offset, derivedFrom: from })
          break
        }
      }
    }
  }
  const merged = sortCases(mergeCases(cases))
  writeNdjson(join(finalDir, 'family-cases.ndjson'), merged)
  writeNdjson(join(finalDir, 'derivation.ndjson'), records)
  let dRounds = 0
  for (const value of requested.values()) dRounds = Math.max(dRounds, value.dRounds)
  const totals = { paragraphs: 0, targets: 0, resolved: 0, atDerived: 0, nonMonotone: 0, noReach: 0, unresolved: 0 }
  for (const value of stats.values()) {
    totals.paragraphs += value.paragraphs
    totals.targets += value.targets
    totals.resolved += value.resolved
    totals.atDerived += value.atDerived
    totals.nonMonotone += value.nonMonotone
    totals.noReach += value.noReach
    totals.unresolved += value.unresolved
  }
  const summary = {
    format: DERIVATION_FORMAT, browser, seed: state.seed, build, languages, dpr, grid, rounds: roundsIn(dir).length, maxDRoundsUsed: dRounds,
    cases: merged.length, totals, finishedAt: new Date().toISOString(),
    families: Object.fromEntries([...stats].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  }
  writeFileSync(join(finalDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.error(`[derive] ${browser}: final ${merged.length} cases; targets ${totals.targets}, resolved ${totals.resolved} (${totals.atDerived} at the derived width), unresolved ${totals.unresolved}, no reach ${totals.noReach}`)
  return 0
}

if (import.meta.main) {
  const args = new Map(process.argv.slice(2).map(arg => {
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    return [match[1]!, match[2]!] as const
  }))
  const browser = args.get('browser')
  if (browser !== 'chrome' && browser !== 'safari' && browser !== 'firefox' && browser !== 'webkit-host') throw new Error('--browser must be chrome, safari, firefox or webkit-host')
  const dirArg = args.get('dir')
  if (dirArg === undefined) throw new Error('--dir is required')
  const families = args.get('families')
  process.exit(await step(resolve(dirArg), browser, args.get('seed') ?? 'rule-families-20260916', families === undefined ? null : families.split(',')))
}
