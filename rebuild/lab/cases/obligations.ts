// First-class cases from main's wrapping suite (tests/wrapping/cases.ts). Main requires native metrics on some inputs
// because browsers really lay them out that way, and on others only to hold one of main's heuristics in place. This
// module keeps the first kind as lab cases, in family `obligations/<group>`, with provenance to main's input:
//
// - accuracy: the canonical accuracy grid (4 font stacks × 8 sizes × 8 widths × 30 texts);
// - pre-wrap, keep-all, symbols, letter-spacing, discretionary: the maintained small oracles, where main requires them;
// - rich-boundaries: the two rows main requires in every browser (#177, #194);
// - reported/<issue>: the filed-report reproductions main requires (#208, #210, #210-rich, #212, #214, #225, #274);
// - safari-paint: the two Safari paint witnesses (an opening quote after a chosen soft hyphen, keep-all's hidden marker);
// - emergency-graphemes: a grapheme at width 1 stays whole (main checks it through its API contract);
// - corpus: the 18 long-form corpora at every 10px step, as canaries that require nothing.
//
// Main's own pins stay ordinary suite cases: entry geometry, the standalone ZWSP, Safari space kerning, the space after an
// overflowing glyph and the exact-fit rich admission rows (rebuild test strategy, "Drop").
//
// Main's metrics map to the lab's metrics. height, lineCount, and richHeight on the span-per-part variant → lineCount;
// breaks, source (visible source placement), hyphen (the expected line text) and an expected line text → breaks;
// widths → widths. api is a contract of main's public surface and has no lab metric, and whether a hyphen glyph was
// painted isn't observable from Range rects. A requirement applies in the browser whose rows carried the input, when the
// input's own browser scope allows it, because measured threshold widths are each browser's own.

import type { BrowserKind, Case, Paragraph } from '../types.ts'
import { ALL_BROWSERS, canonicalJson, caseDigestFromCanonical, caseIdFromDigest, makeCase, sortCases } from './case.ts'
import { convertSuiteInput, orderParagraph, parseSuiteInput } from './suite.ts'

export type LabMetric = 'lineCount' | 'breaks' | 'widths' | 'painter'
const LAB_METRICS: readonly LabMetric[] = ['lineCount', 'breaks', 'widths', 'painter']
// Main's Assessment keys (tests/wrapping/types.ts).
const MAIN_METRICS = new Set(['height', 'lineCount', 'breaks', 'source', 'whitespace', 'widths', 'hyphen', 'api', 'richHeight'])

export type ObligationMatch = { group: string; label: string; canary: boolean }

// The group of an input from its origins, or null for an input that isn't a first-class obligation. The first rule in
// order that matches wins; within a rule, the first matching origin names the label.
export function obligationGroup(origins: readonly string[]): ObligationMatch | null {
  const find = (test: (origin: string) => boolean): string | undefined => origins.find(test)
  let label = find(origin => origin.startsWith('accuracy/'))
  if (label !== undefined) return { group: 'accuracy', label, canary: false }
  for (const name of ['pre-wrap', 'keep-all', 'symbols', 'letter-spacing', 'discretionary', 'rich-boundaries']) {
    label = find(origin => origin.startsWith(`maintained/${name}/`))
    if (label !== undefined) return { group: name, label, canary: false }
  }
  // Exact-fit rich admission rows carry issue/#210-#211 too, but they hold main's fit arithmetic in place.
  if (find(origin => origin.startsWith('rich-admission/')) === undefined) {
    label = find(origin => origin.startsWith('reported-reproduction/#'))
    if (label !== undefined) return { group: `reported/${label.slice('reported-reproduction/'.length)}`, label, canary: false }
    label = find(origin => origin === 'issue/#208')
    if (label !== undefined) return { group: 'reported/#208', label, canary: false }
  }
  label = find(origin => origin === 'observer-controls/quote-marker' || origin === 'observer-controls/keep-all-hidden-marker')
  if (label !== undefined) return { group: 'safari-paint', label, canary: false }
  label = find(origin => origin === 'emergency-graphemes')
  if (label !== undefined) return { group: 'emergency-graphemes', label, canary: false }
  label = find(origin => origin.startsWith('corpora/'))
  if (label !== undefined) return { group: 'corpus', label, canary: true }
  return null
}

export type RequirementSource = { required: readonly string[]; expectedText: boolean; emergencyGraphemes: boolean }

// The lab metrics a variant of main's input requires.
export function labRequirement(source: RequirementSource, variant: 'text' | 'items'): LabMetric[] {
  const metrics = new Set<LabMetric>()
  for (const metric of source.required) {
    if (!MAIN_METRICS.has(metric)) throw new Error(`Unknown main metric ${JSON.stringify(metric)}`)
    if (variant === 'items') {
      if (metric === 'richHeight') metrics.add('lineCount')
      continue
    }
    if (metric === 'height' || metric === 'lineCount') metrics.add('lineCount')
    else if (metric === 'breaks' || metric === 'source' || metric === 'hyphen') metrics.add('breaks')
    else if (metric === 'widths') metrics.add('widths')
  }
  if (variant === 'text' && source.expectedText) metrics.add('breaks')
  if (variant === 'text' && source.emergencyGraphemes) {
    metrics.add('lineCount')
    metrics.add('breaks')
  }
  return LAB_METRICS.filter(metric => metrics.has(metric))
}

type Entry = {
  group: string
  rank: number
  canary: boolean
  pageLang: string
  paragraph: string
  fontFixtures: string[]
  digest: string
  requires: Map<BrowserKind, Set<LabMetric>>
  browsers: Set<BrowserKind>
  labels: Set<string>
  suiteIds: Set<string>
  mainRequired: Set<string>
}

// Group order for merging: an id reached from two groups keeps the earlier one.
const GROUP_RANK = ['accuracy', 'pre-wrap', 'keep-all', 'symbols', 'letter-spacing', 'discretionary', 'rich-boundaries', 'reported', 'safari-paint', 'emergency-graphemes', 'corpus']
function rank(group: string): number {
  const index = GROUP_RANK.indexOf(group.startsWith('reported/') ? 'reported' : group)
  if (index === -1) throw new Error(`Unranked obligation group ${group}`)
  return index
}

export type ObligationTable = {
  groups: Record<string, { cases: number; requiredPairs: Partial<Record<BrowserKind, number>> }>
  required: Record<string, Partial<Record<BrowserKind, LabMetric[]>>>
}

export class ObligationImport {
  private readonly byId = new Map<string, Entry>()
  inputs = 0

  // One row input (a WrappingCase) from the rows of `rowBrowser`.
  add(raw: unknown, rowBrowser: BrowserKind): void {
    if (!ALL_BROWSERS.includes(rowBrowser)) throw new Error(`Unknown row browser ${rowBrowser}`)
    const record = raw as { origins?: unknown; discretionary?: { expectedText?: unknown }; emergencyGraphemes?: unknown }
    const origins = record.origins
    if (!Array.isArray(origins) || origins.some(origin => typeof origin !== 'string')) throw new Error('Suite input origins must be strings')
    const match = obligationGroup(origins as string[])
    if (match === null) return
    const input = parseSuiteInput(raw)
    if (input.browsers !== undefined && !input.browsers.includes(rowBrowser)) return
    this.inputs++
    const source: RequirementSource = {
      required: input.required ?? [],
      expectedText: Array.isArray(record.discretionary?.expectedText),
      emergencyGraphemes: record.emergencyGraphemes === true,
    }
    for (const converted of convertSuiteInput(input)) {
      const metrics = match.canary ? [] : labRequirement(source, converted.variant)
      if (!match.canary && metrics.length === 0) continue
      const paragraph = canonicalJson(converted.paragraph)
      const digest = caseDigestFromCanonical(converted.pageLang, paragraph, converted.fontFixtures)
      const id = caseIdFromDigest(digest)
      let entry = this.byId.get(id)
      if (entry === undefined) {
        entry = {
          group: match.group, rank: rank(match.group), canary: match.canary, pageLang: converted.pageLang, paragraph, fontFixtures: converted.fontFixtures,
          digest, requires: new Map(), browsers: new Set(), labels: new Set(), suiteIds: new Set(), mainRequired: new Set(),
        }
        this.byId.set(id, entry)
      } else {
        if (entry.digest !== digest) throw new Error(`Case id collision for ${id}`)
        if (rank(match.group) < entry.rank) {
          entry.group = match.group
          entry.rank = rank(match.group)
        }
        entry.canary &&= match.canary
      }
      entry.browsers.add(rowBrowser)
      entry.labels.add(converted.variant === 'items' ? `${match.label} (span per part)` : match.label)
      entry.suiteIds.add(input.id)
      for (const metric of source.required) entry.mainRequired.add(metric)
      if (metrics.length > 0) {
        let set = entry.requires.get(rowBrowser)
        if (set === undefined) entry.requires.set(rowBrowser, (set = new Set()))
        for (const metric of metrics) set.add(metric)
      }
    }
  }

  get size(): number {
    return this.byId.size
  }

  cases(): Case[] {
    const out: Case[] = []
    for (const [id, entry] of this.byId) {
      const browsers = entry.canary ? [...entry.browsers] : [...entry.requires.keys()]
      const requirement = entry.canary
        ? 'lab requires nothing (canary)'
        : `lab requires ${ALL_BROWSERS.filter(browser => entry.requires.has(browser)).map(browser => `${browser}:${LAB_METRICS.filter(metric => entry.requires.get(browser)!.has(metric)).join('+')}`).join(' ')}`
      const mainRequired = [...entry.mainRequired].sort()
      const value = makeCase({
        family: `obligations/${entry.group}`,
        origin: `main tests/wrapping ${[...entry.labels].sort().join('; ')} (${[...entry.suiteIds].sort().join(' ')}); main requires ${mainRequired.length === 0 ? 'nothing' : mainRequired.join(',')}; ${requirement}`,
        pageLang: entry.pageLang, paragraph: orderParagraph(JSON.parse(entry.paragraph) as Paragraph), browsers, fontFixtures: entry.fontFixtures,
      })
      if (value.id !== id) throw new Error(`Obligation case ${id} changed identity on materialization (${value.id})`)
      out.push(value)
    }
    return sortCases(out)
  }

  // Per group, cases and required (case, metric) pairs per browser; per case, the metrics it requires per browser.
  table(ids: ReadonlySet<string> | null = null): ObligationTable {
    const groups = new Map<string, { cases: number; requiredPairs: Partial<Record<BrowserKind, number>> }>()
    const required: Record<string, Partial<Record<BrowserKind, LabMetric[]>>> = {}
    const sorted = [...this.byId.keys()].sort()
    for (let i = 0; i < sorted.length; i++) {
      const id = sorted[i]!
      if (ids !== null && !ids.has(id)) continue
      const entry = this.byId.get(id)!
      let group = groups.get(entry.group)
      if (group === undefined) groups.set(entry.group, (group = { cases: 0, requiredPairs: {} }))
      group.cases++
      if (entry.canary) continue
      const perBrowser: Partial<Record<BrowserKind, LabMetric[]>> = {}
      for (const browser of ALL_BROWSERS) {
        const set = entry.requires.get(browser)
        if (set === undefined) continue
        perBrowser[browser] = LAB_METRICS.filter(metric => set.has(metric))
        group.requiredPairs[browser] = (group.requiredPairs[browser] ?? 0) + set.size
      }
      required[id] = perBrowser
    }
    return { groups: Object.fromEntries([...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))), required }
  }
}
