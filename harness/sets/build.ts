// What every case-set generator shares: a seeded random stream, the paragraph and run builders, the case id and the case
// file writer. A case id is its set's name and a hash of what the browser lays out, so the same input keeps its id (and
// its recordings) when a generator runs again, and two generators that make the same input make one case.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserKind, Case, CssFont, Paragraph, TextRun } from '../types.ts'

// ---- Seeded randomness (a string seed, so a set names its own) ----

export type Rng = {
  next: () => number
  int: (n: number) => number
  pick: <T>(list: readonly T[]) => T
  chance: (p: number) => boolean
}

export function createRng(seed: string): Rng {
  // xmur3 to seed sfc32.
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  const mix = (): number => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
  let a = mix()
  let b = mix()
  let c = mix()
  let d = mix()
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  return {
    next,
    int: n => Math.floor(next() * n),
    pick: list => {
      if (list.length === 0) throw new Error('pick from an empty list')
      return list[Math.floor(next() * list.length)]!
    },
    chance: p => next() < p,
  }
}

// ---- Fonts, runs and paragraphs ----

export function font(family: string, size: number, weight = 400, style: CssFont['style'] = 'normal'): CssFont {
  return { family, size, weight, style }
}

// A Canvas or CSS font shorthand as main's tests and filed reports write it: `[italic] [bold|<weight>] <size>px <family>`.
export function parseFont(shorthand: string): CssFont {
  const match = /^(?:(italic) )?(?:(bold|\d{3}) )?(\d+(?:\.\d+)?)px (.+)$/.exec(shorthand.trim())
  if (match === null) throw new Error(`Can't read the font ${shorthand}`)
  const weight = match[2] === undefined ? 400 : match[2] === 'bold' ? 700 : Number(match[2])
  return font(match[4]!, Number(match[3]), weight, match[1] === 'italic' ? 'italic' : 'normal')
}

// The web fonts the harness serves (harness/fonts/fonts.json) that a font family list starts with.
const FIXTURE_FAMILIES = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'ProbeShantell', 'Shantell Sans', 'Inter', 'Roboto']

export function fixturesOf(runs: readonly TextRun[]): string[] {
  const out: string[] = []
  for (let i = 0; i < runs.length; i++) {
    const first = runs[i]!.font.family.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
    if (FIXTURE_FAMILIES.includes(first) && !out.includes(first)) out.push(first)
  }
  return out.sort()
}

export type RunOptions = { letterSpacing?: number; atomic?: true; padding?: number }

export function span(text: string, runFont: CssFont, options: RunOptions = {}): TextRun {
  return { text, node: 'span', font: runFont, letterSpacing: options.letterSpacing ?? 0, wordSpacing: 0, lang: null, ...(options.atomic === true ? { atomic: true } : {}), ...(options.padding === undefined ? {} : { padding: options.padding }) }
}

export type ParagraphSpec = {
  font: CssFont
  lang: string
  width?: number
  lineHeight?: number
  letterSpacing?: number
  whiteSpace?: Paragraph['whiteSpace']
  wordBreak?: Paragraph['wordBreak']
  direction?: Paragraph['direction']
}

// A paragraph as an app writes it: overflow-wrap: break-word and line-break: auto, the library's documented target. A
// string part is a bare text node in the paragraph's styles.
export function paragraph(spec: ParagraphSpec, parts: ReadonlyArray<string | TextRun>): Paragraph {
  const letterSpacing = spec.letterSpacing ?? 0
  const runs: TextRun[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    runs.push(typeof part === 'string' ? { text: part, node: 'text', font: spec.font, letterSpacing, wordSpacing: 0, lang: null } : part)
  }
  return {
    runs, font: spec.font, letterSpacing, wordSpacing: 0, width: spec.width ?? 0,
    lineHeight: spec.lineHeight ?? Math.round(spec.font.size * 1.25), whiteSpace: spec.whiteSpace ?? 'normal',
    wordBreak: spec.wordBreak ?? 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
    direction: spec.direction ?? 'ltr', lang: spec.lang,
  }
}

// The code points of a text, surrogate pairs kept whole.
export function codePoints(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    const high = (text.charCodeAt(i) & 0xfc00) === 0xd800 && i + 1 < text.length
    out.push(text.slice(i, high ? i + 2 : i + 1))
    if (high) i++
  }
  return out
}

export function textOf(p: Paragraph): string {
  let text = ''
  for (let i = 0; i < p.runs.length; i++) text += p.runs[i]!.text
  return text
}

// ---- UAX #14 line-break classes (sets/data/LineBreak-17.0.0.txt, the Unicode 17 file main's generic table was made from) ----

export type LineBreakTable = { from: Int32Array; to: Int32Array; names: string[] }
let table: LineBreakTable | null = null

// The file's ranges in order, each with its class.
export function lineBreakTable(): LineBreakTable {
  if (table !== null) return table
  const lines = readFileSync(join(import.meta.dir, 'data/LineBreak-17.0.0.txt'), 'utf8').split('\n')
  const from: number[] = []
  const to: number[] = []
  const names: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/.exec(lines[i]!)
    if (match === null) continue
    from.push(parseInt(match[1]!, 16))
    to.push(parseInt(match[2] ?? match[1]!, 16))
    names.push(match[3]!)
  }
  return table = { from: Int32Array.from(from), to: Int32Array.from(to), names }
}

// A code point's class, XX where the file lists none (UAX #14's default for unassigned code points).
export function lineBreakClass(codePoint: number): string {
  const { from, to, names } = lineBreakTable()
  let low = 0
  let high = from.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (to[middle]! < codePoint) low = middle + 1
    else if (from[middle]! > codePoint) high = middle - 1
    else return names[middle]!
  }
  return 'XX'
}

// ---- Cases ----

// JSON with sorted object keys, so equal inputs hash equal whatever order a builder wrote them in.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    const entries: string[] = []
    for (let i = 0; i < keys.length; i++) {
      const v = (value as Record<string, unknown>)[keys[i]!]
      if (v !== undefined) entries.push(`${JSON.stringify(keys[i])}:${canonical(v)}`)
    }
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function digest(value: unknown): string {
  return new Bun.CryptoHasher('sha256').update(canonical(value)).digest('hex').slice(0, 16)
}

export type CaseInput = {
  family: string
  origin: string
  pageLang: string
  paragraph: Paragraph
  browsers?: BrowserKind[]
  sample?: Case['sample']
  behaviour?: string
  edge?: true
}

// `set` names the case file; the id hashes only what the browser sees, so the same input made twice is one case.
export function makeCase(set: string, input: CaseInput): Case {
  const fontFixtures = fixturesOf(input.paragraph.runs)
  const browsers = input.browsers === undefined ? undefined : [...input.browsers].sort()
  const id = `${set}-${digest({ pageLang: input.pageLang, paragraph: input.paragraph, browsers, fontFixtures })}`
  return {
    id, family: input.family, origin: input.origin, pageLang: input.pageLang, paragraph: input.paragraph,
    ...(browsers === undefined ? {} : { browsers }), ...(fontFixtures.length === 0 ? {} : { fontFixtures }),
    ...(input.sample === undefined ? {} : { sample: input.sample }), ...(input.behaviour === undefined ? {} : { behaviour: input.behaviour }), ...(input.edge === true ? { edge: true } : {}),
  }
}

// One case per line, sorted by id; a repeated id keeps its first case.
export function writeCases(path: string, cases: readonly Case[]): Case[] {
  const byId = new Map<string, Case>()
  for (let i = 0; i < cases.length; i++) if (!byId.has(cases[i]!.id)) byId.set(cases[i]!.id, cases[i]!)
  const sorted = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let text = ''
  for (let i = 0; i < sorted.length; i++) text += `${JSON.stringify(sorted[i])}\n`
  writeFileSync(path, text)
  return sorted
}
