// Rule-targeted families (TEST-ARCHITECTURE.md §2.2). A family names the library rules it targets per engine, the axes
// the cited source reads (relevant: covered exhaustively), the axes nearby code reads (neighbours: a pairwise covering
// array), and a builder that turns one combination into a paragraph with its focus offsets. Background axes (font size
// where the rule doesn't read it, filler text) are drawn inside the builder from a seeded stream.
//
// A family paragraph has no width. derive.ts observes it in each browser and derives the widths where the browser's own
// decision at a focus offset changes. Nothing here imports rebuild/src (tests/independence.test.ts).
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../lab/cases/case.ts'
import { createRng, type Rng } from '../../lab/cases/prng.ts'
import type { InlineStructure, Paragraph } from '../../lab/types.ts'
import { pairwiseRows } from './covering.ts'

export type Engine = 'blink' | 'webkit' | 'gecko'
export type AxisValue = string | number | boolean
export type Axis = { readonly name: string; readonly values: readonly AxisValue[] }
export type Values = Readonly<Record<string, AxisValue>>

export type Draft = {
  pageLang: string
  // width is ignored; derive.ts sets it.
  paragraph: Paragraph
  // Inline structure (lab/types.ts InlineStructure), from lab/cases/build.ts treeParagraph; absent for a flat paragraph.
  inline?: InlineStructure
  fontFixtures?: readonly string[]
  // Source offsets where the rule acts at a line edge: a line should end, or the next line start, exactly there.
  focus: readonly number[]
  note: string
}

export type RuleFamily = {
  name: string
  // Rule ids (rebuild/tests/rules.json) per engine; the family runs in the browsers of these engines.
  rules: Readonly<Partial<Record<Engine, readonly string[]>>>
  // What the relevant axes are and which source or recorded fact they come from.
  why: string
  relevant: readonly Axis[]
  neighbours: readonly Axis[]
  // null: the combination doesn't make a paragraph (an axis value meaningless under another).
  build(values: Values, rng: Rng): Draft | null
}

export type FamilyParagraph = {
  // p-<16 hex>: a hash of the family name and the page content, so a family paragraph keeps its key across runs.
  key: string
  family: string
  rules: readonly string[]
  values: Values
  draft: Draft
}

export function familyEngines(family: RuleFamily): Engine[] {
  const engines: Engine[] = []
  for (const engine of ['blink', 'webkit', 'gecko'] as const) if (family.rules[engine] !== undefined) engines.push(engine)
  return engines
}

export function str(values: Values, name: string): string {
  const value = values[name]
  if (typeof value !== 'string') throw new Error(`axis ${name} is not a string: ${JSON.stringify(value)}`)
  return value
}

export function num(values: Values, name: string): number {
  const value = values[name]
  if (typeof value !== 'number') throw new Error(`axis ${name} is not a number: ${JSON.stringify(value)}`)
  return value
}

function cartesian(axes: readonly Axis[]): number[][] {
  let rows: number[][] = [[]]
  for (let a = 0; a < axes.length; a++) {
    const next: number[][] = []
    for (let r = 0; r < rows.length; r++) for (let v = 0; v < axes[a]!.values.length; v++) next.push([...rows[r]!, v])
    rows = next
  }
  return rows
}

// Every paragraph of a family for one engine: relevant combinations × neighbour covering rows, one background draw each.
export function expandFamily(family: RuleFamily, engine: Engine, seed: string): FamilyParagraph[] {
  const rules = family.rules[engine]
  if (rules === undefined) return []
  const relevant = cartesian(family.relevant)
  const neighbours = pairwiseRows(family.neighbours.map(axis => axis.values.length))
  const out: FamilyParagraph[] = []
  const byKey = new Map<string, FamilyParagraph>()
  for (let r = 0; r < relevant.length; r++) {
    for (let n = 0; n < neighbours.length; n++) {
      const values: Record<string, AxisValue> = {}
      for (let a = 0; a < family.relevant.length; a++) values[family.relevant[a]!.name] = family.relevant[a]!.values[relevant[r]![a]!]!
      for (let a = 0; a < family.neighbours.length; a++) values[family.neighbours[a]!.name] = family.neighbours[a]!.values[neighbours[n]![a]!]!
      const rng: Rng = createRng(`${seed}/${family.name}/${r}/${n}`)
      const draft = family.build(values, rng)
      if (draft === null) continue
      const content = canonicalJson({ family: family.name, pageLang: draft.pageLang, paragraph: { ...draft.paragraph, width: 0 }, inline: draft.inline, fontFixtures: draft.fontFixtures ?? [] })
      const key = `p-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`
      // Axis values that only move the focus (a mark at the line end or start) give the same paragraph: one paragraph
      // with the union of their focus offsets.
      const existing = byKey.get(key)
      if (existing !== undefined) {
        existing.draft = { ...existing.draft, focus: [...new Set([...existing.draft.focus, ...draft.focus])].sort((a, b) => a - b) }
        continue
      }
      const paragraph: FamilyParagraph = { key, family: family.name, rules, values, draft }
      byKey.set(key, paragraph)
      out.push(paragraph)
    }
  }
  return out
}
