// Case identity, validation and merging. A case id is a content hash of what the browser lays out
// (page language, paragraph, loaded fixture fonts); family, origin and browser scope are metadata and
// don't change it. Two generators that produce the same paragraph produce the same id, and mergeCases
// folds them into one record.

import { createHash } from 'node:crypto'
import type { BrowserKind, Case, FontDecl, Paragraph } from '../types.ts'
import { canonicalFontFamily } from './font.ts'

export const ALL_BROWSERS: readonly BrowserKind[] = ['chrome', 'safari', 'firefox']

// Web fonts from tests/wrapping/fonts/fonts.json, which the old suite loaded on its fixture page.
export const FIXTURE_FONT_FAMILIES: readonly string[] = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'ProbeShantell', 'Shantell Sans']

// Bump when the meaning of a case's content changes, so old ids can't silently describe new layouts.
const ID_VERSION = 'pretext-lab-case/1'

const WHITE_SPACE = new Set<Paragraph['whiteSpace']>(['normal', 'pre', 'pre-wrap', 'pre-line', 'nowrap', 'break-spaces'])
const WORD_BREAK = new Set<Paragraph['wordBreak']>(['normal', 'break-all', 'keep-all', 'break-word'])
const OVERFLOW_WRAP = new Set<Paragraph['overflowWrap']>(['normal', 'break-word', 'anywhere'])
const LINE_BREAK = new Set<Paragraph['lineBreak']>(['auto', 'loose', 'normal', 'strict', 'anywhere'])

// JSON with sorted object keys and -0 written as 0. Throws on values JSON can't represent exactly.
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string': return JSON.stringify(value)
    case 'boolean': return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`Non-finite number in case content: ${value}`)
      return JSON.stringify(Object.is(value, -0) ? 0 : value)
    case 'object': {
      if (Array.isArray(value)) {
        const items: string[] = []
        for (let i = 0; i < value.length; i++) items.push(canonicalJson(value[i]))
        return `[${items.join(',')}]`
      }
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      const entries: string[] = []
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!
        if (record[key] === undefined) continue
        entries.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      }
      return `{${entries.join(',')}}`
    }
    default: throw new Error(`Unsupported value in case content: ${typeof value}`)
  }
}

export function caseDigest(pageLang: string, paragraph: Paragraph, fontFixtures?: readonly string[]): string {
  return caseDigestFromCanonical(pageLang, canonicalJson(paragraph), fontFixtures)
}

// The digest of canonicalJson({ fontFixtures, pageLang, paragraph }), given the paragraph's canonical
// JSON (keys in sorted order: fontFixtures, pageLang, paragraph). Fixture fonts must already be sorted.
export function caseDigestFromCanonical(pageLang: string, canonicalParagraph: string, fontFixtures?: readonly string[]): string {
  const fixtures = fontFixtures === undefined || fontFixtures.length === 0 ? '' : `"fontFixtures":${canonicalJson(fontFixtures)},`
  return createHash('sha256').update(`${ID_VERSION}\n{${fixtures}"pageLang":${JSON.stringify(pageLang)},"paragraph":${canonicalParagraph}}`).digest('hex')
}

export function caseIdFromDigest(digest: string): string {
  return `c-${digest.slice(0, 16)}`
}

export type CaseInput = {
  family: string
  origin: string
  pageLang: string
  paragraph: Paragraph
  browsers?: readonly BrowserKind[] | undefined
  fontFixtures?: readonly string[] | undefined
}

function normalizeBrowsers(browsers: readonly BrowserKind[] | undefined): BrowserKind[] | undefined {
  if (browsers === undefined) return undefined
  const set = new Set<BrowserKind>()
  for (const browser of browsers) {
    if (!ALL_BROWSERS.includes(browser)) throw new Error(`Unknown browser ${JSON.stringify(browser)}`)
    set.add(browser)
  }
  if (set.size === 0) throw new Error('A case must apply to at least one browser')
  const list = ALL_BROWSERS.filter(browser => set.has(browser))
  return list.length === ALL_BROWSERS.length ? undefined : list
}

function normalizeFixtures(fixtures: readonly string[] | undefined): string[] | undefined {
  if (fixtures === undefined || fixtures.length === 0) return undefined
  for (const name of fixtures) {
    if (!FIXTURE_FONT_FAMILIES.includes(name)) throw new Error(`Unknown fixture font ${JSON.stringify(name)}`)
  }
  return [...new Set(fixtures)].sort()
}

export function makeCase(input: CaseInput): Case {
  const browsers = normalizeBrowsers(input.browsers)
  const fontFixtures = normalizeFixtures(input.fontFixtures)
  const digest = caseDigest(input.pageLang, input.paragraph, fontFixtures)
  const result: Case = {
    id: caseIdFromDigest(digest),
    family: input.family,
    origin: input.origin,
    pageLang: input.pageLang,
    paragraph: input.paragraph,
    ...(browsers === undefined ? {} : { browsers }),
    ...(fontFixtures === undefined ? {} : { fontFixtures }),
  }
  validateCase(result)
  return result
}

function sameFont(a: FontDecl, b: FontDecl): boolean {
  return a.family === b.family && a.size === b.size && a.weight === b.weight && a.style === b.style
}

function validateFont(font: FontDecl, where: string): void {
  if (typeof font.family !== 'string' || canonicalFontFamily(font.family) !== font.family) {
    throw new Error(`${where}: font family ${JSON.stringify(font.family)} is not in canonical form`)
  }
  if (!(font.size > 0) || !Number.isFinite(font.size)) throw new Error(`${where}: font size must be positive`)
  if (!(font.weight >= 1 && font.weight <= 1000)) throw new Error(`${where}: font weight out of range`)
  if (font.style !== 'normal' && font.style !== 'italic') throw new Error(`${where}: unknown font style`)
}

const finite = (value: number): boolean => typeof value === 'number' && Number.isFinite(value)

export function validateCase(value: Case): void {
  const where = `case ${value.id} (${value.family})`
  if (typeof value.family !== 'string' || value.family === '') throw new Error(`${where}: empty family`)
  if (typeof value.pageLang !== 'string' || value.pageLang === '') throw new Error(`${where}: pageLang must be non-empty`)
  const p = value.paragraph
  validateFont(p.font, where)
  if (!finite(p.width) || p.width < 0) throw new Error(`${where}: width must be finite and non-negative`)
  if (!finite(p.lineHeight) || p.lineHeight <= 0) throw new Error(`${where}: lineHeight must be positive`)
  if (!finite(p.tabSize) || p.tabSize < 0) throw new Error(`${where}: tabSize must be non-negative`)
  if (!finite(p.letterSpacing) || !finite(p.wordSpacing)) throw new Error(`${where}: spacing must be finite`)
  if (!WHITE_SPACE.has(p.whiteSpace)) throw new Error(`${where}: unknown white-space ${p.whiteSpace}`)
  if (!WORD_BREAK.has(p.wordBreak)) throw new Error(`${where}: unknown word-break ${p.wordBreak}`)
  if (!OVERFLOW_WRAP.has(p.overflowWrap)) throw new Error(`${where}: unknown overflow-wrap ${p.overflowWrap}`)
  if (!LINE_BREAK.has(p.lineBreak)) throw new Error(`${where}: unknown line-break ${p.lineBreak}`)
  if (p.direction !== 'ltr' && p.direction !== 'rtl') throw new Error(`${where}: unknown direction`)
  if (typeof p.lang !== 'string') throw new Error(`${where}: paragraph lang must be a string`)
  if (!Array.isArray(p.runs) || p.runs.length === 0) throw new Error(`${where}: a paragraph needs runs`)
  for (let i = 0; i < p.runs.length; i++) {
    const run = p.runs[i]!
    const at = `${where} run ${i}`
    if (typeof run.text !== 'string') throw new Error(`${at}: text must be a string`)
    validateFont(run.font, at)
    if (!finite(run.letterSpacing) || !finite(run.wordSpacing)) throw new Error(`${at}: spacing must be finite`)
    if (run.node === 'text') {
      if (!sameFont(run.font, p.font) || run.letterSpacing !== p.letterSpacing || run.wordSpacing !== p.wordSpacing || run.lang !== null) {
        throw new Error(`${at}: a bare text node must carry the paragraph's font, spacing and a null lang`)
      }
      if (run.text === '' && p.runs.length > 1) throw new Error(`${at}: empty bare text node`)
      if (i > 0 && p.runs[i - 1]!.node === 'text') throw new Error(`${at}: adjacent bare text nodes`)
    } else if (run.node === 'span') {
      if (run.lang !== null && typeof run.lang !== 'string') throw new Error(`${at}: lang must be a string or null`)
    } else {
      throw new Error(`${at}: unknown node kind`)
    }
  }
  if (value.browsers !== undefined && normalizeBrowsers(value.browsers)?.join() !== value.browsers.join()) {
    throw new Error(`${where}: browsers must be a canonical proper subset`)
  }
  const digest = caseDigest(value.pageLang, p, value.fontFixtures)
  if (value.id !== caseIdFromDigest(digest)) throw new Error(`${where}: id does not match its content`)
}

export function paragraphText(paragraph: Paragraph): string {
  let text = ''
  for (let i = 0; i < paragraph.runs.length; i++) text += paragraph.runs[i]!.text
  return text
}

// Fold cases with the same id: the first family wins, browser scopes union, origins accumulate.
export function mergeCases(cases: Iterable<Case>): Case[] {
  const byId = new Map<string, { value: Case; digest: string; origins: string[]; browsers: Set<BrowserKind> | null }>()
  for (const value of cases) {
    const digest = caseDigest(value.pageLang, value.paragraph, value.fontFixtures)
    const previous = byId.get(value.id)
    if (previous === undefined) {
      byId.set(value.id, { value, digest, origins: [value.origin], browsers: value.browsers === undefined ? null : new Set(value.browsers) })
      continue
    }
    if (previous.digest !== digest) throw new Error(`Case id collision for ${value.id}`)
    if (!previous.origins.includes(value.origin)) previous.origins.push(value.origin)
    if (previous.browsers !== null) {
      if (value.browsers === undefined) previous.browsers = null
      else for (const browser of value.browsers) previous.browsers.add(browser)
    }
  }
  const out: Case[] = []
  for (const { value, origins, browsers } of byId.values()) {
    out.push(makeCase({
      family: value.family, origin: origins.join('; '), pageLang: value.pageLang, paragraph: value.paragraph,
      browsers: browsers === null ? undefined : [...browsers], fontFixtures: value.fontFixtures,
    }))
  }
  return out
}

// Output order groups cases by page context (language and fixture fonts), then family, then id.
export function caseOrderKey(value: { pageLang: string; fontFixtures?: readonly string[] | undefined; family: string; id: string }): string {
  return `${value.pageLang} ${(value.fontFixtures ?? []).join(',')} ${value.family} ${value.id}`
}

export function sortByCaseOrder<T extends { pageLang: string; fontFixtures?: readonly string[] | undefined; family: string; id: string }>(items: T[]): T[] {
  const keyed = items.map(item => ({ item, key: caseOrderKey(item) }))
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (let i = 0; i < keyed.length; i++) items[i] = keyed[i]!.item
  return items
}

export function sortCases(cases: Case[]): Case[] {
  return sortByCaseOrder(cases)
}

export function countFamilies(cases: readonly Case[]): Record<string, number> {
  const counts = new Map<string, number>()
  for (let i = 0; i < cases.length; i++) counts.set(cases[i]!.family, (counts.get(cases[i]!.family) ?? 0) + 1)
  return Object.fromEntries([...counts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}
