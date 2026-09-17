// Case identity, validation and merging. A case id is a content hash of what the browser lays out
// (page language, paragraph, loaded fixture fonts); family, origin and browser scope are metadata and
// don't change it. Two generators that produce the same paragraph produce the same id, and mergeCases
// folds them into one record.

import { createHash } from 'node:crypto'
import type { BoxEdge } from '../../src/model.ts'
import type { BrowserKind, Case, FontDecl, InlineNode, InlineStructure, Paragraph, TextRun } from '../types.ts'
import { canonicalFontFamily } from './font.ts'

export const ALL_BROWSERS: readonly BrowserKind[] = ['chrome', 'safari', 'firefox']

// Web fonts from tests/wrapping/fonts/fonts.json, which the old suite loaded on its fixture page.
export const FIXTURE_FONT_FAMILIES: readonly string[] = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'ProbeShantell', 'Shantell Sans']

// Bump when the meaning of a case's content changes, so old ids can't silently describe new layouts.
const ID_VERSION = 'pretext-lab-case/1'
// Cases with inline structure hash their paragraph and structure under their own version (DESIGN.md §1.1); flat cases keep
// ID_VERSION and their ids.
const INLINE_ID_VERSION = 'pretext-lab-case/2'
const TEXT_ALIGN = new Set<InlineStructure['textAlign']>(['start', 'end', 'left', 'right', 'center', 'justify'])

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

export function caseDigest(pageLang: string, paragraph: Paragraph, fontFixtures?: readonly string[], inline?: InlineStructure): string {
  if (inline !== undefined) {
    const content = { ...(fontFixtures === undefined || fontFixtures.length === 0 ? {} : { fontFixtures }), inline, pageLang, paragraph }
    return createHash('sha256').update(`${INLINE_ID_VERSION}\n${canonicalJson(content)}`).digest('hex')
  }
  return caseDigestFromCanonical(pageLang, canonicalJson(paragraph), fontFixtures)
}

// The runs a case with inline structure lists: every text leaf in document order, a leaf under the block as a bare text
// run with the block's font and spacing, a leaf under a span as a span run with that span's font and spacing and the
// nearest lang an enclosing span sets (null when none does).
export function leafRuns(paragraph: Pick<Paragraph, 'font' | 'letterSpacing' | 'wordSpacing'>, content: readonly InlineNode[]): TextRun[] {
  const runs: TextRun[] = []
  const walk = (nodes: readonly InlineNode[], under: { font: FontDecl; letterSpacing: number; wordSpacing: number; lang: string | null } | null): void => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      if (node.kind === 'text') {
        runs.push(under === null
          ? { text: node.text, node: 'text', font: paragraph.font, letterSpacing: paragraph.letterSpacing, wordSpacing: paragraph.wordSpacing, lang: null }
          : { text: node.text, node: 'span', font: under.font, letterSpacing: under.letterSpacing, wordSpacing: under.wordSpacing, lang: under.lang })
      } else if (node.kind === 'span') {
        walk(node.children, { font: node.font, letterSpacing: node.letterSpacing, wordSpacing: node.wordSpacing, lang: node.lang ?? under?.lang ?? null })
      }
    }
  }
  walk(content, null)
  return runs
}

function noEdge(edge: BoxEdge): boolean {
  return edge.margin === 0 && edge.border === 0 && edge.padding === 0
}

// Whether inline structure describes a flat paragraph (DESIGN.md §1.1, "Flat paragraphs"): text leaves and spans holding
// one leaf each, spans without box edges, at baseline and with the block's wrapping styles, text-indent 0, text-align start,
// no line slots, and the runs a flat case allows (a bare leaf empty only when it's the only content, no two bare leaves
// next to each other).
export function flatStructure(paragraph: Paragraph, inline: InlineStructure): boolean {
  if (inline.textIndent !== 0 || inline.textAlign !== 'start' || inline.lineSlots.length > 0 || inline.content.length === 0) return false
  for (let i = 0; i < inline.content.length; i++) {
    const node = inline.content[i]!
    if (node.kind === 'text') {
      if (node.text === '' && inline.content.length > 1) return false
      if (i > 0 && inline.content[i - 1]!.kind === 'text') return false
      continue
    }
    if (node.kind !== 'span' || node.children.length !== 1 || node.children[0]!.kind !== 'text') return false
    if (!noEdge(node.inlineStart) || !noEdge(node.inlineEnd) || node.verticalAlign !== 'baseline') return false
    if (node.whiteSpace !== paragraph.whiteSpace || node.wordBreak !== paragraph.wordBreak || node.overflowWrap !== paragraph.overflowWrap
      || node.lineBreak !== paragraph.lineBreak || node.tabSize !== paragraph.tabSize) return false
  }
  return true
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
  // Inline structure; a flat one is dropped, so the case keeps its flat id.
  inline?: InlineStructure | undefined
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
  const inline = input.inline === undefined || flatStructure(input.paragraph, input.inline) ? undefined : input.inline
  const digest = caseDigest(input.pageLang, input.paragraph, fontFixtures, inline)
  const result: Case = {
    id: caseIdFromDigest(digest),
    family: input.family,
    origin: input.origin,
    pageLang: input.pageLang,
    paragraph: input.paragraph,
    ...(inline === undefined ? {} : { inline }),
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
  if (value.inline !== undefined) validateInline(p, value.inline, where)
  for (let i = 0; i < p.runs.length && value.inline === undefined; i++) {
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
  const digest = caseDigest(value.pageLang, p, value.fontFixtures, value.inline)
  if (value.id !== caseIdFromDigest(digest)) throw new Error(`${where}: id does not match its content`)
}

function validateEdge(edge: BoxEdge, where: string): void {
  if (!finite(edge.margin)) throw new Error(`${where}: margin must be finite`)
  if (!finite(edge.border) || edge.border < 0 || !finite(edge.padding) || edge.padding < 0) throw new Error(`${where}: border and padding must be finite and non-negative`)
}

function validateInline(p: Paragraph, inline: InlineStructure, where: string): void {
  if (flatStructure(p, inline)) throw new Error(`${where}: flat inline structure; a flat case carries runs only`)
  if (!finite(inline.textIndent)) throw new Error(`${where}: textIndent must be finite`)
  if (!TEXT_ALIGN.has(inline.textAlign)) throw new Error(`${where}: unknown text-align ${inline.textAlign}`)
  if (!Array.isArray(inline.content) || !Array.isArray(inline.lineSlots)) throw new Error(`${where}: inline content and lineSlots must be arrays`)
  if (inline.lineSlots.length > 0) {
    if (!Number.isInteger(p.lineHeight)) throw new Error(`${where}: line slots need a whole-px line height`)
    const sides = ['left', 'right'] as const
    for (let k = 0; k < sides.length; k++) {
      const side = sides[k]!
      let positive = 0
      for (let row = 0; row < inline.lineSlots.length; row++) {
        const inset = inline.lineSlots[row]![side]
        if (!finite(inset) || inset < 0) throw new Error(`${where}: slot row ${row} ${side} inset must be finite and non-negative`)
        if (inset > 0) positive++
      }
      if (positive !== 0 && positive !== inline.lineSlots.length) throw new Error(`${where}: every row's ${side} inset must be positive, or every row's 0`)
    }
    if (inline.lineSlots.every(slot => slot.left === 0 && slot.right === 0)) throw new Error(`${where}: line slots without insets`)
  }
  const walk = (nodes: readonly InlineNode[], at: string): void => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const here = `${at}/${i}`
      switch (node.kind) {
        case 'text':
          if (typeof node.text !== 'string') throw new Error(`${here}: text must be a string`)
          break
        case 'span':
          validateFont(node.font, here)
          if (!finite(node.letterSpacing) || !finite(node.wordSpacing)) throw new Error(`${here}: spacing must be finite`)
          if (!finite(node.tabSize) || node.tabSize < 0) throw new Error(`${here}: tabSize must be non-negative`)
          if (!WHITE_SPACE.has(node.whiteSpace) || !WORD_BREAK.has(node.wordBreak) || !OVERFLOW_WRAP.has(node.overflowWrap) || !LINE_BREAK.has(node.lineBreak)) {
            throw new Error(`${here}: unknown wrapping keyword`)
          }
          if (node.lang !== null && typeof node.lang !== 'string') throw new Error(`${here}: lang must be a string or null`)
          validateEdge(node.inlineStart, `${here} inline start`)
          validateEdge(node.inlineEnd, `${here} inline end`)
          if (node.verticalAlign !== 'baseline' && node.verticalAlign !== '0px') throw new Error(`${here}: unknown vertical-align`)
          if (!Array.isArray(node.children)) throw new Error(`${here}: children must be an array`)
          walk(node.children, here)
          break
        case 'atomic':
          if (!finite(node.width) || node.width < 0 || !finite(node.height) || node.height < 0) throw new Error(`${here}: atomic size must be finite and non-negative`)
          // A taller box changes line box heights, which the model doesn't carry (DESIGN.md §1.1, "Atomic inlines").
          if (node.height > p.lineHeight) throw new Error(`${here}: atomic inline taller than the line height`)
          if (!finite(node.marginInlineStart) || !finite(node.marginInlineEnd)) throw new Error(`${here}: atomic margins must be finite`)
          break
        case 'br':
        case 'wbr':
          break
        default:
          throw new Error(`${here}: unknown node kind ${(node as { kind: unknown }).kind}`)
      }
    }
  }
  walk(inline.content, `${where} content`)
  if (canonicalJson(p.runs) !== canonicalJson(leafRuns(p, inline.content))) throw new Error(`${where}: runs must list the tree's leaves (leafRuns)`)
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
    const digest = caseDigest(value.pageLang, value.paragraph, value.fontFixtures, value.inline)
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
      browsers: browsers === null ? undefined : [...browsers], fontFixtures: value.fontFixtures, inline: value.inline,
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
