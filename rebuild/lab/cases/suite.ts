// Import of the old wrapping suite's re-observed rows. Each row's `input` (a WrappingCase from
// tests/wrapping/types.ts) becomes one single-run case with the old observer's paragraph styles:
// overflow-wrap break-word, line-break auto, tab-size 8, hyphens manual (the initial value). Inputs
// with native inline-item observations (`nativeItems`) also become a span-per-part case, as that
// observation laid them out. Only the observed paragraph matters: old library options (locale,
// detail, heightMode, lineMethod, rich parts) are dropped, and duplicates merge across browsers.
// Corpus rows keep their raw text even where the old observer laid out a normalized copy.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BrowserKind, Case, FontDecl, Paragraph, TextRun } from '../types.ts'
import { ALL_BROWSERS, canonicalJson, caseDigestFromCanonical, caseIdFromDigest, FIXTURE_FONT_FAMILIES, makeCase } from './case.ts'
import { parseFontFamilyList, parseFontShorthand } from './font.ts'

export type SuiteInput = {
  id: string
  family: string
  text: string
  font: string
  width: number
  lineHeight: number
  whiteSpace: 'normal' | 'pre-wrap'
  wordBreak: 'normal' | 'keep-all'
  letterSpacing: number
  direction: 'ltr' | 'rtl'
  lang?: string
  context?: { kind: 'installed'; lang: string }
  parts?: string[]
  nativeItems?: true
  browsers?: BrowserKind[]
  required?: string[]
  fontFixture?: string
}

function fail(input: unknown, why: string): never {
  const id = typeof input === 'object' && input !== null && typeof (input as { id?: unknown }).id === 'string' ? (input as { id: string }).id : '?'
  throw new Error(`Suite input ${id}: ${why}`)
}

export function parseSuiteInput(raw: unknown): SuiteInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(raw, 'not an object')
  const record = raw as Record<string, unknown>
  const string = (key: string): string => {
    const value = record[key]
    if (typeof value !== 'string') fail(raw, `${key} must be a string`)
    return value
  }
  const number = (key: string): number => {
    const value = record[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(raw, `${key} must be a finite number`)
    return value
  }
  const whiteSpace = string('whiteSpace')
  if (whiteSpace !== 'normal' && whiteSpace !== 'pre-wrap') fail(raw, `unknown whiteSpace ${whiteSpace}`)
  const wordBreak = string('wordBreak')
  if (wordBreak !== 'normal' && wordBreak !== 'keep-all') fail(raw, `unknown wordBreak ${wordBreak}`)
  const direction = string('direction')
  if (direction !== 'ltr' && direction !== 'rtl') fail(raw, `unknown direction ${direction}`)
  const input: SuiteInput = {
    id: string('id'), family: string('family'), text: string('text'), font: string('font'),
    width: number('width'), lineHeight: number('lineHeight'), whiteSpace, wordBreak, letterSpacing: number('letterSpacing'), direction,
  }
  if (record['lang'] !== undefined) input.lang = string('lang')
  if (record['context'] !== undefined) {
    const context = record['context'] as Record<string, unknown> | null
    if (context === null || context['kind'] !== 'installed' || typeof context['lang'] !== 'string' || context['lang'] === '') fail(raw, 'unknown context')
    input.context = { kind: 'installed', lang: context['lang'] }
  }
  if (record['parts'] !== undefined) {
    const parts = record['parts']
    if (!Array.isArray(parts) || parts.some(part => typeof part !== 'string')) fail(raw, 'parts must be strings')
    input.parts = parts as string[]
  }
  if (record['nativeItems'] !== undefined) {
    if (record['nativeItems'] !== true) fail(raw, 'nativeItems must be true')
    input.nativeItems = true
  }
  if (record['browsers'] !== undefined) {
    const browsers = record['browsers']
    if (!Array.isArray(browsers) || browsers.length === 0 || browsers.some(browser => !ALL_BROWSERS.includes(browser as BrowserKind))) fail(raw, 'unknown browsers')
    input.browsers = browsers as BrowserKind[]
  }
  if (record['required'] !== undefined) {
    const required = record['required']
    if (!Array.isArray(required) || required.some(metric => typeof metric !== 'string')) fail(raw, 'required must be strings')
    input.required = required as string[]
  }
  if (record['fontFixture'] !== undefined) input.fontFixture = string('fontFixture')
  return input
}

export type ConvertedInput = { variant: 'text' | 'items'; pageLang: string; paragraph: Paragraph; fontFixtures: string[] }

export function convertSuiteInput(input: SuiteInput): ConvertedInput[] {
  const decl = parseFontShorthand(input.font)
  // Fixture pages ran under <html lang="en"> with the fixture fonts loaded; installed contexts ran in
  // their own language with installed fonts only.
  const pageLang = input.context?.lang ?? 'en'
  const lang = input.lang ?? pageLang
  const fontFixtures = input.context === undefined
    ? [...new Set(parseFontFamilyList(decl.family).filter(name => !name.generic && FIXTURE_FONT_FAMILIES.includes(name.name)).map(name => name.name))].sort()
    : []
  if (input.fontFixture !== undefined && !fontFixtures.includes(input.fontFixture)) {
    fail(input, `fontFixture ${input.fontFixture} is not a loaded family of ${JSON.stringify(input.font)}`)
  }
  const base: Omit<Paragraph, 'runs'> = {
    font: decl, letterSpacing: input.letterSpacing, wordSpacing: 0, width: input.width, lineHeight: input.lineHeight,
    whiteSpace: input.whiteSpace, wordBreak: input.wordBreak, overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8,
    direction: input.direction, lang,
  }
  const out: ConvertedInput[] = [{
    variant: 'text', pageLang, fontFixtures,
    paragraph: { ...base, runs: [{ text: input.text, node: 'text', font: decl, letterSpacing: input.letterSpacing, wordSpacing: 0, lang: null }] },
  }]
  if (input.nativeItems === true) {
    if (input.parts === undefined || input.parts.join('') !== input.text) fail(input, 'nativeItems needs parts that join to the text')
    out.push({
      variant: 'items', pageLang, fontFixtures,
      paragraph: { ...base, runs: input.parts.map(part => ({ text: part, node: 'span' as const, font: decl, letterSpacing: input.letterSpacing, wordSpacing: 0, lang: null })) },
    })
  }
  return out
}

// Retained per unique case while importing: the paragraph as canonical JSON (compact, and already
// computed for the id) plus merge metadata.
type Entry = {
  pageLang: string
  paragraph: string
  fontFixtures: string[]
  digest: string
  families: string[]
  requiredFamilies: string[]
  origins: string[]
  // null: every browser.
  browsers: BrowserKind[] | null
}

export type SuiteEntry = { id: string; family: string; pageLang: string; fontFixtures: string[]; required: boolean; oldFamilies: string[] }

function orderFont(font: FontDecl): FontDecl {
  return { family: font.family, size: font.size, weight: font.weight, style: font.style }
}

// Field order as in types.ts, for readable output.
export function orderParagraph(p: Paragraph): Paragraph {
  const runs: TextRun[] = p.runs.map(run => ({ text: run.text, node: run.node, font: orderFont(run.font), letterSpacing: run.letterSpacing, wordSpacing: run.wordSpacing, lang: run.lang }))
  return {
    runs, font: orderFont(p.font), letterSpacing: p.letterSpacing, wordSpacing: p.wordSpacing, width: p.width, lineHeight: p.lineHeight,
    whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, tabSize: p.tabSize,
    direction: p.direction, lang: p.lang,
  }
}

function primaryFamily(entry: Entry): string {
  const candidates = entry.requiredFamilies.length > 0 ? entry.requiredFamilies : entry.families
  let best = candidates[0]!
  for (let i = 1; i < candidates.length; i++) if (candidates[i]! < best) best = candidates[i]!
  return `suite/${best}`
}

export class SuiteImport {
  private readonly byId = new Map<string, Entry>()
  inputs = 0

  add(raw: unknown): void {
    const input = parseSuiteInput(raw)
    this.inputs++
    const required = input.required !== undefined && input.required.length > 0
    for (const converted of convertSuiteInput(input)) {
      const paragraph = canonicalJson(converted.paragraph)
      const digest = caseDigestFromCanonical(converted.pageLang, paragraph, converted.fontFixtures)
      const id = caseIdFromDigest(digest)
      const origin = `${input.family} ${input.id}${converted.variant === 'items' ? ' items' : ''}${required ? ` required=${input.required!.join(',')}` : ''}`
      let entry = this.byId.get(id)
      if (entry === undefined) {
        entry = {
          pageLang: converted.pageLang, paragraph, fontFixtures: converted.fontFixtures, digest,
          families: [], requiredFamilies: [], origins: [], browsers: input.browsers === undefined ? null : [...input.browsers],
        }
        this.byId.set(id, entry)
      } else {
        if (entry.digest !== digest) throw new Error(`Case id collision for ${id}`)
        if (entry.browsers !== null) {
          if (input.browsers === undefined) entry.browsers = null
          else for (const browser of input.browsers) if (!entry.browsers.includes(browser)) entry.browsers.push(browser)
        }
      }
      if (!entry.families.includes(input.family)) entry.families.push(input.family)
      if (required && !entry.requiredFamilies.includes(input.family)) entry.requiredFamilies.push(input.family)
      if (!entry.origins.includes(origin)) entry.origins.push(origin)
    }
  }

  get size(): number {
    return this.byId.size
  }

  // Light summaries for selection and ordering; materialize() builds the full case.
  entries(): SuiteEntry[] {
    const out: SuiteEntry[] = []
    for (const [id, entry] of this.byId) {
      out.push({
        id, family: primaryFamily(entry), pageLang: entry.pageLang, fontFixtures: entry.fontFixtures,
        required: entry.requiredFamilies.length > 0, oldFamilies: entry.families.slice().sort(),
      })
    }
    return out
  }

  materialize(id: string): Case {
    const entry = this.byId.get(id)
    if (entry === undefined) throw new Error(`Unknown suite case ${id}`)
    const value = makeCase({
      family: primaryFamily(entry), origin: `suite ${entry.origins.slice().sort().join('; ')}`, pageLang: entry.pageLang,
      paragraph: orderParagraph(JSON.parse(entry.paragraph) as Paragraph), browsers: entry.browsers ?? undefined, fontFixtures: entry.fontFixtures,
    })
    if (value.id !== id) throw new Error(`Suite case ${id} changed identity on materialization (${value.id})`)
    return value
  }
}

export type RowsFile = { browser: BrowserKind; direction: 'ltr' | 'rtl'; rows: string; report: string }

// Row files whose completion report exists with status 'ready'; others are listed as skipped.
export function suiteRowFiles(dir: string): { files: RowsFile[]; skipped: string[] } {
  const files: RowsFile[] = []
  const skipped: string[] = []
  for (const browser of ALL_BROWSERS) {
    for (const direction of ['ltr', 'rtl'] as const) {
      const report = resolve(dir, browser, `${browser}-${direction}.json`)
      const rows = resolve(dir, browser, `${browser}-${direction}-rows.ndjson`)
      if (!existsSync(report)) {
        skipped.push(`${browser}-${direction}: no report`)
        continue
      }
      const status = (JSON.parse(readFileSync(report, 'utf8')) as { status?: unknown }).status
      if (status !== 'ready') {
        skipped.push(`${browser}-${direction}: report status ${String(status)}`)
        continue
      }
      if (!existsSync(rows)) throw new Error(`Report ${report} exists but its rows file is missing`)
      files.push({ browser, direction, rows, report })
    }
  }
  return { files, skipped }
}

const ROW_PREFIX = new TextEncoder().encode('{"input":')
const NATIVE_MARKER = new TextEncoder().encode(',"native":')

function indexOf(bytes: Uint8Array, pattern: Uint8Array, from: number): number {
  const first = pattern[0]!
  outer: for (let i = bytes.indexOf(first, from); i !== -1 && i + pattern.length <= bytes.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer
    return i
  }
  return -1
}

// Stream each row's `input` without parsing the (much larger) native observation and predictions.
// JSON strings escape '"', so ',"native":' can't occur inside the input object; a parse failure
// still falls back to parsing the whole row.
export async function streamRowInputs(path: string, visit: (input: unknown) => void): Promise<number> {
  const decoder = new TextDecoder()
  let rows = 0
  const handle = (line: Uint8Array): void => {
    if (line.length === 0) return
    rows++
    let prefixed = line.length > ROW_PREFIX.length
    for (let i = 0; prefixed && i < ROW_PREFIX.length; i++) prefixed = line[i] === ROW_PREFIX[i]
    const marker = prefixed ? indexOf(line, NATIVE_MARKER, ROW_PREFIX.length) : -1
    if (marker !== -1) {
      let input: unknown
      try {
        input = JSON.parse(decoder.decode(line.subarray(ROW_PREFIX.length, marker)))
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
      if (input !== undefined) {
        visit(input)
        return
      }
    }
    const row = JSON.parse(decoder.decode(line)) as { input?: unknown }
    if (row.input === undefined) throw new Error(`${path} row ${rows} has no input`)
    visit(row.input)
  }
  let pending: Uint8Array | null = null
  for await (const chunk of Bun.file(path).stream()) {
    let start = 0
    for (let newline = chunk.indexOf(10); newline !== -1; newline = chunk.indexOf(10, start)) {
      if (pending !== null) {
        const joined: Uint8Array = new Uint8Array(pending.length + newline)
        joined.set(pending)
        joined.set(chunk.subarray(0, newline), pending.length)
        pending = null
        handle(joined)
      } else {
        handle(chunk.subarray(start, newline))
      }
      start = newline + 1
    }
    if (start < chunk.length) {
      const rest = chunk.subarray(start)
      if (pending === null) pending = rest.slice()
      else {
        const joined: Uint8Array = new Uint8Array(pending.length + rest.length)
        joined.set(pending)
        joined.set(rest, pending.length)
        pending = joined
      }
    }
  }
  if (pending !== null) handle(pending)
  return rows
}
