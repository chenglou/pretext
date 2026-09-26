// The widths where each browser's lines change, and the rules that cut a generated set down to them.
//
// A template is an input without a width. The steps, each saved under .artifacts/harness-sets/<set>/ so a stopped run
// resumes:
// 1. `recordFirst`, in each browser: every template at its own widths and, where it asks, a coarse grid, plus width 1
//    and 100000. Line breaking is greedy, so where two widths lay out the same, every width between them does.
// 2. `select`, offline, over all three browsers' recordings, comparing where lines start and end (not their widths):
//    - rule 2: inputs that differ only in which control character (Unicode category Cc or Cf) they hold merge into the
//      first of them where all three browsers break the same way at every width;
//    - rule 1: of each remaining template, only the neighbouring recorded widths whose layouts differ (a change);
//    - for a set too big to review (the catalog), a cover: a change is kept only when, in that browser, it shows a line
//      break no change kept before it shows, and every family keeps one. A break is described by the paragraph's
//      white-space, word-break and letter-spacing sign, the UAX #14 class of the last visible character before it, the
//      classes of what sits between, the class of the first visible character after it, and whether it sits at the edge
//      of a span.
// 3. `bisect`, in each browser: halves each kept change until its two widths are one layout unit apart: 1/128 px in
//    Chrome at DPR 2, 1/64 px in WebKit, 1/60 px in Firefox (rebuild/tests/fit.ts).
// 4. `cut`: each kept template's cases, at width 1 and 100000 in every browser and, in the browser that changes, around
//    at most three exact changes inside its kept ones, each showing a line break the template hasn't shown yet, the
//    widest first: 1/64 px either side of the width where the lines change (`edge`, where the fit is exact to
//    1/64 px) and a width well inside each of its two layouts (where the break chosen is checked away from the fit). A long paragraph's lines
//    change every few pixels, and pinning each change would sweep one input across widths.
// `bun harness record` then records the cut cases in fresh short documents in two orders.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LIB, runJob } from '../run.ts'
import { assertSameEnvironment, readRecordings, writeRecordings } from '../store.ts'
import type { BrowserKind, Case, Paragraph, Recording } from '../types.ts'
import { digest, fixturesOf, lineBreakClass, makeCase, textOf } from './build.ts'

export type Template = {
  family: string
  origin: string
  pageLang: string
  paragraph: Paragraph
  // The widths to record first: the template's own, and the coarse grid when `grid`.
  widths: number[]
  grid: boolean
}

export const CUT_BROWSERS = ['chrome', 'firefox', 'webkit-host'] as const
type CutBrowser = (typeof CUT_BROWSERS)[number]

// Layout units per CSS px at DPR 2, and how the browser turns a CSS width into them.
const UNITS: Record<CutBrowser, number> = { chrome: 128, 'webkit-host': 64, firefox: 60 }
function unitsOf(browser: CutBrowser, width: number): number {
  return browser === 'firefox' ? Math.round(width * 60) : Math.floor(width * UNITS[browser] + 1e-6)
}

const NARROW = 1
const WIDE = 100_000
const GRID = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024]
const MAX_ROUNDS = 24
const CHANGES_PER_TEMPLATE = 3
// How far either side of a change its edge cases sit: the README's exact fit. In Chrome a layout unit is 1/128 px, and
// one unit either side of a change, half the cases failed before and after #340 alike.
const EDGE = 1 / 64
const JOB_CASES = 20_000
// Longer documents than `record`'s: page history only moves which widths get searched.
const SWEEP_DOCUMENT = 500

const keys = new WeakMap<Template, string>()
export function templateKey(t: Template): string {
  let key = keys.get(t)
  if (key === undefined) keys.set(t, key = digest({ pageLang: t.pageLang, paragraph: { ...t.paragraph, width: 0 } }))
  return key
}

function firstWidths(t: Template): number[] {
  const widths = new Set<number>(t.grid ? [...t.widths, ...GRID] : t.widths)
  widths.add(NARROW)
  widths.add(WIDE)
  return [...widths].sort((a, b) => a - b)
}

// Scratch cases, named by template and width.
export const sweepId = (set: string, t: Template, width: number): string => `${set}-sweep-${templateKey(t)}-w${width}`

function sweepCase(set: string, t: Template, width: number): Case {
  const fontFixtures = fixturesOf(t.paragraph.runs)
  return { id: sweepId(set, t, width), family: t.family, origin: t.origin, pageLang: t.pageLang, paragraph: { ...t.paragraph, width }, ...(fontFixtures.length === 0 ? {} : { fontFixtures }) }
}

export const dirOf = (set: string): string => resolve(import.meta.dir, `../../.artifacts/harness-sets/${set}`)
export const recordingsFile = (set: string, browser: CutBrowser): string => join(dirOf(set), `${browser}.txt`)
export const probesFile = (set: string, browser: CutBrowser): string => join(dirOf(set), `${browser}.probes.json`)
const selectionFile = (set: string): string => join(dirOf(set), 'selection.json')

type State = { env: string; recordings: Map<string, Recording>; probes: Record<string, number[]> }

function loadState(set: string, browser: CutBrowser): State {
  const file = readRecordings(recordingsFile(set, browser))
  const probes = existsSync(probesFile(set, browser)) ? JSON.parse(readFileSync(probesFile(set, browser), 'utf8')) as Record<string, number[]> : {}
  return { env: file?.env ?? '', recordings: file?.recordings ?? new Map(), probes }
}

function saveState(set: string, browser: CutBrowser, state: State): void {
  mkdirSync(dirOf(set), { recursive: true })
  writeRecordings(recordingsFile(set, browser), { env: state.env, recordings: state.recordings })
  writeFileSync(probesFile(set, browser), `${JSON.stringify(state.probes)}\n`)
}

// Records the cases not recorded yet, JOB_CASES per job, saving after each job.
async function recordInto(set: string, browser: CutBrowser, state: State, cases: readonly Case[]): Promise<void> {
  const missing = cases.filter(c => !state.recordings.has(c.id))
  for (let from = 0; from < missing.length; from += JOB_CASES) {
    const chunk = missing.slice(from, from + JOB_CASES)
    const job = await runJob<Recording>({ browser, mode: 'record', cases: chunk, documentSize: SWEEP_DOCUMENT, lib: LIB })
    if (state.env === '') state.env = job.env
    else assertSameEnvironment(browser, state.env, job.env)
    for (const [id, recording] of job.results) state.recordings.set(id, recording)
    saveState(set, browser, state)
    console.log(`${set} ${browser}: ${from + chunk.length} of ${missing.length} recorded, the last ${chunk.length} in ${(job.ms / 1000).toFixed(0)} s`)
  }
}

export async function recordFirst(set: string, templates: readonly Template[], browser: CutBrowser): Promise<void> {
  const state = loadState(set, browser)
  // A job's worth of templates at a time, so the case list never holds the whole set.
  let cases: Case[] = []
  for (let i = 0; i < templates.length; i++) {
    const widths = firstWidths(templates[i]!)
    for (let w = 0; w < widths.length; w++) cases.push(sweepCase(set, templates[i]!, widths[w]!))
    if (cases.length >= JOB_CASES || i + 1 === templates.length) {
      await recordInto(set, browser, state, cases)
      cases = []
    }
  }
}

type Recorded = { width: number; layout: string; recording: Recording }

// What a width's layout is for the cut: where each line starts and ends. Line widths are left out: Firefox reports a
// space that hangs past the edge clipped to it, so a line's width moves with the paragraph's width though no break
// does.
function breaksOf(recording: Recording): string {
  if ('error' in recording) return `error ${recording.error}`
  let out = ''
  for (let i = 0; i < recording.lines.length; i++) out += `${recording.lines[i]!.first}-${recording.lines[i]!.last} `
  return out
}

// Every width a template has been recorded at in one browser, sorted; `first` keeps round 0's widths only.
function recordedWidths(set: string, t: Template, state: State, first: boolean): Recorded[] {
  const widths = new Set([...firstWidths(t), ...(first ? [] : state.probes[templateKey(t)] ?? [])])
  const out: Recorded[] = []
  for (const width of widths) {
    const recording = state.recordings.get(sweepId(set, t, width))
    if (recording !== undefined) out.push({ width, layout: breaksOf(recording), recording })
  }
  return out.sort((a, b) => a.width - b.width)
}

// ---- Rule 2 ----

// A layout with offsets counted in code points, so inputs whose controls differ in UTF-16 length compare equal.
function inCodePoints(text: string, layout: string): string {
  const index: number[] = []
  let n = 0
  for (let i = 0; i < text.length; i++) {
    index.push(n)
    if ((text.charCodeAt(i) & 0xfc00) !== 0xd800) n++
  }
  return layout.replace(/(\d+)-(\d+) /g, (_, a: string, b: string) => `${index[Number(a)]}-${index[Number(b)]} `)
}

const CONTROL = /[\p{gc=Cc}\p{gc=Cf}]/gu

// The template with each Cc or Cf character replaced by its category.
function mergeKey(t: Template): string {
  const runs = t.paragraph.runs.map(run => ({ ...run, text: run.text.replace(CONTROL, ch => (/\p{gc=Cc}/u.test(ch) ? '\u{FFF0}' : '\u{FFF1}')) }))
  return digest({ pageLang: t.pageLang, paragraph: { ...t.paragraph, width: 0, runs } })
}

function survivors(set: string, templates: readonly Template[], states: readonly State[]): { keep: Set<string>; standsFor: Map<string, string[]>; incomplete: number } {
  const groups = new Map<string, Array<{ t: Template; key: string; signature: string }>>()
  let incomplete = 0
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]!
    const text = textOf(t.paragraph)
    const parts: string[] = []
    const widths = firstWidths(t)
    for (let b = 0; b < CUT_BROWSERS.length; b++) {
      for (let w = 0; w < widths.length; w++) {
        const recording = states[b]!.recordings.get(sweepId(set, t, widths[w]!))
        if (recording !== undefined) parts.push(inCodePoints(text, breaksOf(recording)))
      }
    }
    if (parts.length < widths.length * CUT_BROWSERS.length) {
      incomplete++
      continue
    }
    const group = mergeKey(t)
    let list = groups.get(group)
    if (list === undefined) groups.set(group, list = [])
    list.push({ t, key: templateKey(t), signature: parts.join('|') })
  }
  const keep = new Set<string>()
  const standsFor = new Map<string, string[]>()
  for (const list of groups.values()) {
    list.sort((a, b) => (textOf(a.t.paragraph) < textOf(b.t.paragraph) ? -1 : 1))
    const first = new Map<string, string>()
    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!
      const representative = first.get(entry.signature)
      if (representative === undefined) {
        first.set(entry.signature, entry.key)
        keep.add(entry.key)
        continue
      }
      const controls = [...textOf(entry.t.paragraph).matchAll(CONTROL)].map(m => `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
      let stands = standsFor.get(representative)
      if (stands === undefined) standsFor.set(representative, stands = [])
      stands.push(controls.join('+'))
    }
  }
  return { keep, standsFor, incomplete }
}

// ---- Which changes to keep ----

function codePointLength(text: string, offset: number): number {
  return text.codePointAt(offset)! > 0xffff ? 2 : 1
}

// The line break after line `j` of a recording, as the cover describes it; `end` when line `j` is the last.
function breakAt(t: Template, text: string, recording: Recording, j: number): string {
  const p = t.paragraph
  const mode = `${p.whiteSpace}/${p.wordBreak}/${Math.sign(p.letterSpacing)}`
  if ('error' in recording) return `${mode} error`
  const a = recording.lines[j]
  const b = recording.lines[j + 1]
  if (a === undefined || b === undefined) return `${mode} end`
  if (a.first < 0 || b.first < 0) return `${mode} empty line`
  const after = a.last + codePointLength(text, a.last)
  let gap = ''
  for (let o = after; o < b.first; o += codePointLength(text, o)) {
    const lb = lineBreakClass(text.codePointAt(o)!)
    if (!gap.endsWith(` ${lb}`)) gap += ` ${lb}`
  }
  let edge = ''
  let offset = 0
  for (let r = 0; r + 1 < p.runs.length; r++) {
    offset += p.runs[r]!.text.length
    if (offset >= after && offset <= b.first) edge = ' at a span edge'
  }
  return `${mode} ${lineBreakClass(text.codePointAt(a.last)!)} |${gap} | ${lineBreakClass(text.codePointAt(b.first)!)}${edge}`
}

// The first line whose end moves between two recordings.
function movedLine(a: Recording, b: Recording): number {
  if ('error' in a || 'error' in b) return 0
  let j = 0
  while (j < a.lines.length && j < b.lines.length && a.lines[j]!.first === b.lines[j]!.first && a.lines[j]!.last === b.lines[j]!.last) j++
  return j
}

// Per browser, each kept template's changes, as pairs of round-0 widths.
type Selection = Record<CutBrowser, Record<string, Array<[number, number]>>>

export type SelectReport = { templates: number; incomplete: number; merged: number; kept: number; changes: Record<CutBrowser, number>; selected: Record<CutBrowser, number>; selectedTemplates: number }

export function select(set: string, templates: readonly Template[], cover: boolean): SelectReport {
  const states = CUT_BROWSERS.map(b => loadState(set, b))
  const { keep, standsFor, incomplete } = survivors(set, templates, states)
  const selection: Selection = { chrome: {}, firefox: {}, 'webkit-host': {} }
  const changes = { chrome: 0, firefox: 0, 'webkit-host': 0 }
  const selected = { chrome: 0, firefox: 0, 'webkit-host': 0 }
  for (let b = 0; b < CUT_BROWSERS.length; b++) {
    const browser = CUT_BROWSERS[b]!
    const covered = new Set<string>()
    const familyCovered = new Set<string>()
    const firstOfFamily = new Map<string, { key: string; pair: [number, number] }>()
    const seen = new Set<string>()
    for (let i = 0; i < templates.length; i++) {
      const t = templates[i]!
      const key = templateKey(t)
      if (!keep.has(key) || seen.has(key)) continue
      seen.add(key)
      const text = textOf(t.paragraph)
      const recorded = recordedWidths(set, t, states[b]!, true)
      for (let k = 0; k + 1 < recorded.length; k++) {
        const lo = recorded[k]!
        const hi = recorded[k + 1]!
        if (lo.layout === hi.layout) continue
        changes[browser]++
        const pair: [number, number] = [lo.width, hi.width]
        if (!firstOfFamily.has(t.family)) firstOfFamily.set(t.family, { key, pair })
        let take = !cover
        if (cover) {
          const j = movedLine(lo.recording, hi.recording)
          const breaks = [breakAt(t, text, lo.recording, j), breakAt(t, text, hi.recording, j)]
          for (let n = 0; n < breaks.length; n++) {
            if (covered.has(breaks[n]!)) continue
            covered.add(breaks[n]!)
            take = true
          }
        }
        if (!take) continue
        ;(selection[browser][key] ??= []).push(pair)
        familyCovered.add(t.family)
        selected[browser]++
      }
    }
    // Every family keeps a change.
    for (const [family, first] of firstOfFamily) {
      if (familyCovered.has(family)) continue
      ;(selection[browser][first.key] ??= []).push(first.pair)
      selected[browser]++
    }
  }
  const selectedKeys = new Set<string>()
  for (let b = 0; b < CUT_BROWSERS.length; b++) for (const key of Object.keys(selection[CUT_BROWSERS[b]!])) selectedKeys.add(key)
  mkdirSync(dirOf(set), { recursive: true })
  writeFileSync(selectionFile(set), `${JSON.stringify({ selection, standsFor: Object.fromEntries(standsFor) })}\n`)
  return { templates: templates.length, incomplete, merged: templates.length - incomplete - keep.size, kept: keep.size, changes, selected, selectedTemplates: selectedKeys.size }
}

function readSelection(set: string): { selection: Selection; standsFor: Record<string, string[]> } {
  if (!existsSync(selectionFile(set))) throw new Error(`${set}: no selection; run select first`)
  return JSON.parse(readFileSync(selectionFile(set), 'utf8')) as { selection: Selection; standsFor: Record<string, string[]> }
}

// The recorded widths inside a kept change whose layouts differ from the next one's.
function changesInside(recorded: readonly Recorded[], pair: readonly [number, number]): Array<[Recorded, Recorded]> {
  const out: Array<[Recorded, Recorded]> = []
  for (let k = 0; k + 1 < recorded.length; k++) {
    const lo = recorded[k]!
    const hi = recorded[k + 1]!
    if (lo.width >= pair[0] && hi.width <= pair[1] && lo.layout !== hi.layout) out.push([lo, hi])
  }
  return out
}

// ---- Bisection ----

export async function bisect(set: string, templates: readonly Template[], browser: CutBrowser): Promise<void> {
  const state = loadState(set, browser)
  const pairs = readSelection(set).selection[browser]
  const units = UNITS[browser]
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const probes: Case[] = []
    const seen = new Set<string>()
    for (let i = 0; i < templates.length; i++) {
      const t = templates[i]!
      const key = templateKey(t)
      const kept = pairs[key]
      if (kept === undefined || seen.has(key)) continue
      seen.add(key)
      const recorded = recordedWidths(set, t, state, false)
      for (let p = 0; p < kept.length; p++) {
        const inside = changesInside(recorded, kept[p]!)
        for (let c = 0; c < inside.length; c++) {
          const lo = unitsOf(browser, inside[c]![0].width)
          const hi = unitsOf(browser, inside[c]![1].width)
          if (hi - lo <= 1) continue
          const width = Math.floor((lo + hi) / 2) / units
          ;(state.probes[key] ??= []).push(width)
          probes.push(sweepCase(set, t, width))
        }
      }
    }
    if (probes.length === 0) break
    console.log(`${set} ${browser}: bisection round ${round}, ${probes.length} widths`)
    await recordInto(set, browser, state, probes)
  }
  saveState(set, browser, state)
}

// ---- The cut ----

function caseBrowser(browser: CutBrowser): BrowserKind {
  return browser === 'webkit-host' ? 'safari' : browser
}

function preview(t: Template): string {
  const text = JSON.stringify(textOf(t.paragraph)).slice(1, -1)
  const p = t.paragraph
  const style = [`${p.font.size}px ${p.font.family.split(',')[0]!.replace(/"/g, '')}`, p.whiteSpace === 'normal' ? '' : p.whiteSpace,
    p.wordBreak === 'normal' ? '' : p.wordBreak, p.letterSpacing === 0 ? '' : `letter-spacing ${p.letterSpacing}`, p.direction === 'rtl' ? 'rtl' : '',
    p.runs.length > 1 ? `${p.runs.length} runs` : '', p.lang === t.pageLang ? `lang ${p.lang}` : `lang ${p.lang} on a ${t.pageLang} page`].filter(s => s !== '')
  return `"${text.length > 48 ? `${text.slice(0, 45)}...` : text}" ${style.join(', ')}`
}

// A width an app might use well inside [low, high], where every width lays out the same: a whole pixel near the middle,
// else the middle to 1/64 px; null when the range is one width, or reaches width 1 or 100000, which are pinned anyway.
function insideWidth(low: number, high: number): number | null {
  if (low === NARROW || high === WIDE) return null
  const middle = (low + high) / 2
  for (const width of [Math.round(middle), Math.round(middle * 64) / 64]) if (width > low && width < high) return width
  return null
}

export function cut(set: string, templates: readonly Template[]): Case[] {
  const states = CUT_BROWSERS.map(b => loadState(set, b))
  const { selection, standsFor } = readSelection(set)
  const cases: Case[] = []
  const seen = new Set<string>()
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]!
    const key = templateKey(t)
    if (seen.has(key) || !CUT_BROWSERS.some(b => selection[b][key] !== undefined)) continue
    seen.add(key)
    // Which browsers want each width, and whether it is an edge there: width 1 and 100000 in all, and in the browser
    // that changes, the two edges of each change taken and a width well inside each of its two layouts.
    const wanted = new Map<number, Map<CutBrowser, boolean>>()
    const want = (width: number, browser: CutBrowser, edge: boolean): void => {
      let browsers = wanted.get(width)
      if (browsers === undefined) wanted.set(width, browsers = new Map())
      browsers.set(browser, (browsers.get(browser) ?? false) || edge)
    }
    for (let b = 0; b < CUT_BROWSERS.length; b++) {
      want(NARROW, CUT_BROWSERS[b]!, false)
      want(WIDE, CUT_BROWSERS[b]!, false)
    }
    const text = textOf(t.paragraph)
    for (let b = 0; b < CUT_BROWSERS.length; b++) {
      const browser = CUT_BROWSERS[b]!
      const kept = selection[browser][key] ?? []
      const recorded = recordedWidths(set, t, states[b]!, false)
      // The widest changes come first: they are the widths apps lay text out at, and in a narrow box a long text breaks
      // inside its words whatever it holds.
      const inside: Array<[Recorded, Recorded]> = []
      for (let p = 0; p < kept.length; p++) inside.push(...changesInside(recorded, kept[p]!))
      inside.sort((x, y) => y[0].width - x[0].width)
      const shown = new Set<string>()
      const taken: Array<[Recorded, Recorded]> = []
      for (let c = 0; c < inside.length && taken.length < CHANGES_PER_TEMPLATE; c++) {
        const [lo, hi] = inside[c]!
        const j = movedLine(lo.recording, hi.recording)
        const breaks = [breakAt(t, text, lo.recording, j), breakAt(t, text, hi.recording, j)]
        if (breaks.every(x => shown.has(x))) continue
        for (let n = 0; n < breaks.length; n++) shown.add(breaks[n]!)
        taken.push(inside[c]!)
      }
      // A template whose changes all break alike still keeps its first.
      if (taken.length === 0 && inside.length > 0) taken.push(inside[0]!)
      for (let c = 0; c < taken.length; c++) {
        const [lo, hi] = taken[c]!
        // The widths recorded with each side's layout reach down from lo and up from hi.
        let first = recorded.indexOf(lo)
        while (first > 0 && recorded[first - 1]!.layout === lo.layout) first--
        let last = recorded.indexOf(hi)
        while (last + 1 < recorded.length && recorded[last + 1]!.layout === hi.layout) last++
        // The edges: 1/64 px either side of the width where the lines change, where the browser lays that width out as
        // the side's recorded widths (the same layout units), else the change's own widths.
        const down = unitsOf(browser, hi.width - EDGE)
        const up = unitsOf(browser, hi.width + EDGE)
        want(down >= unitsOf(browser, recorded[first]!.width) && down <= unitsOf(browser, lo.width) ? hi.width - EDGE : lo.width, browser, true)
        want(up <= unitsOf(browser, recorded[last]!.width) ? hi.width + EDGE : hi.width, browser, true)
        const below = insideWidth(recorded[first]!.width, lo.width)
        const above = insideWidth(hi.width, recorded[last]!.width)
        if (below !== null) want(below, browser, false)
        if (above !== null) want(above, browser, false)
      }
    }
    const stands = standsFor[key]
    const origin = stands === undefined ? t.origin : `${t.origin}; stands for the same input with ${stands.join(', ')}, which lay out the same in all three browsers`
    const behaviour = `${t.family} ${preview(t)} [${key.slice(0, 8)}]`
    for (const [width, browsers] of [...wanted].sort((a, b) => a[0] - b[0])) {
      // A width that is an edge in one browser and inside a layout in another is two cases.
      for (const edge of [false, true]) {
        const at = CUT_BROWSERS.filter(b => browsers.get(b) === edge)
        if (at.length === 0) continue
        const list = at.length === CUT_BROWSERS.length ? undefined : at.map(caseBrowser)
        cases.push(makeCase(set, { family: t.family, origin, pageLang: t.pageLang, paragraph: { ...t.paragraph, width }, ...(list === undefined ? {} : { browsers: list }), behaviour, ...(edge ? { edge: true } : {}) }))
      }
    }
  }
  return cases
}

// UTF-16 units a case set asks a recording to read, per browser: the recording-time estimate is this times 58 us.
export function unitsPerBrowser(cases: readonly Case[]): Record<CutBrowser, { cases: number; units: number }> {
  const out = { chrome: { cases: 0, units: 0 }, firefox: { cases: 0, units: 0 }, 'webkit-host': { cases: 0, units: 0 } }
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!
    const units = textOf(c.paragraph).length
    for (let b = 0; b < CUT_BROWSERS.length; b++) {
      const browser = CUT_BROWSERS[b]!
      if (c.browsers !== undefined && !c.browsers.includes(caseBrowser(browser))) continue
      out[browser].cases++
      out[browser].units += units
    }
  }
  return out
}
