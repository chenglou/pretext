// Input-only full-book survey. The original maintained normalizer supplies a separate ordinary native paragraph.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normalizeSource } from '../../tests/wrapping/contracts.ts'
import { makeCase, validateCase } from '../lab/cases/case.ts'
import { canonicalFontFamily } from '../lab/cases/font.ts'
import { readLines } from '../lab/rows.ts'
import type { Case } from '../lab/types.ts'
import type { TierBrowser } from './sets.ts'

export type BookPair = { book: string; contentWidth: number; raw: string; normalized: string; source: string; sourceSha256: string }
export type BookSurveyManifest = {
  format: 'pretext-book-survey-inputs/1'; browser: TierBrowser; repo: string; artifactRoot: string;
  originalPopulation: number; sourceBooks: string[]; pairs: BookPair[]; cases: number; totalSourceUnits: number; maxSourceUnits: number;
  sources: Array<{ path: string; sha256: string }>; normalizerSha256: string; producerSha256: string;
  outputs: Array<{ file: string; sha256: string }>;
  selection: { widths: 2 | 3; readsAnyOutcome: false; preparationLocale: 'default'; originalHeightProtocol: string; strongProtocol: string };
}
export const hashBytes = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
type Meta = { id: string; output: string; language: string; direction?: string; font_family?: string; font_size_px?: number; line_height_px?: number; min_width?: number; max_width?: number }
export async function prepareBookSurvey(options: { browser: TierBrowser; out: string; widths?: 2 | 3; repo?: string; artifactRoot?: string }) {
  const repo = resolve(options.repo ?? join(import.meta.dir, '../..')), artifactRoot = resolve(options.artifactRoot ?? join(repo, '.artifacts')), out = resolve(options.out), widths = options.widths ?? 2
  if (!['chrome', 'firefox', 'webkit-host'].includes(options.browser) || ![2, 3].includes(widths)) throw new Error('browser is chrome/firefox/webkit-host and widths is 2/3')
  if (existsSync(out)) throw new Error(`${out}: output already exists`)
  const metadataPath = join(repo, 'corpora/sources.json'), metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Meta[]
  if (metadata.length === 0 || new Set(metadata.map(meta => meta.id)).size !== metadata.length) throw new Error('nonempty unique maintained corpus metadata required')
  const sources = [{ path: metadataPath, sha256: hashBytes(readFileSync(metadataPath)) }]
  const books = metadata.map(meta => {
    const path = join(repo, meta.output), text = readFileSync(path, 'utf8'), sha256 = hashBytes(text)
    sources.push({ path, sha256 }); return { meta, text, path, sha256, candidates: new Map<number, Case>() }
  })
  const byText = new Map(books.map(value => [value.sha256, value])); if (byText.size !== books.length) throw new Error('duplicate maintained corpus text identity')
  const root = join(artifactRoot, 'research-20260916/census/cases/chunks')
  let originalPopulation = 0
  for (const name of readdirSync(root).filter(name => /^corpus\d+\.ndjson$/.test(name)).sort()) {
    const path = join(root, name); sources.push({ path, sha256: hashBytes(readFileSync(path)) })
    for await (const line of readLines(path)) {
      const c = JSON.parse(line) as Case; if (c.family !== 'suite/maintained/corpus') continue
      validateCase(c)
      const p = c.paragraph, run = p.runs[0]
      if (c.inline !== undefined || p.runs.length !== 1 || run?.node !== 'text' || p.whiteSpace !== 'normal') throw new Error(`${c.id}: original corpus paragraph shape differs`)
      const book = byText.get(hashBytes(run.text)); if (!book || run.text !== book.text) throw new Error(`${c.id}: not an exact entire maintained source file`)
      const m = book.meta, font = { family: canonicalFontFamily(m.font_family ?? 'serif'), size: m.font_size_px ?? 18, weight: 400, style: 'normal' }
      if (JSON.stringify(p.font) !== JSON.stringify(font) || JSON.stringify(run.font) !== JSON.stringify(font) || p.lineHeight !== (m.line_height_px ?? Math.round(font.size * 1.6)) || p.lang !== m.language || c.pageLang !== m.language || p.direction !== (m.direction === 'rtl' ? 'rtl' : 'ltr') || p.letterSpacing !== 0 || p.wordSpacing !== 0 || run.letterSpacing !== 0 || run.wordSpacing !== 0 || p.wordBreak !== 'normal') throw new Error(`${c.id}/${m.id}: original corpus font/language/style differs`)
      if (book.candidates.has(p.width)) throw new Error(`${m.id}: duplicate original width`)
      book.candidates.set(p.width, c); originalPopulation++
    }
  }
  const cases = new Map<string, Case>(), pairs: BookPair[] = []
  for (const book of books) {
    const m = book.meta, first = (m.min_width ?? 300) - 80, last = (m.max_width ?? 900) - 80
    const expected = Array.from({ length: Math.floor((last - first) / 10) + 1 }, (_, i) => first + i * 10), actual = [...book.candidates.keys()].sort((a, b) => a - b)
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`${m.id}: complete original step-10 width population required`)
    const chosen = widths === 2 ? [first, last] : [first, expected[Math.floor((expected.length - 1) / 2)]!, last]
    for (const width of chosen) {
      const original = book.candidates.get(width)!, raw = makeCase({ ...original, family: `book/${m.id}/raw`, origin: `${original.origin}; own raw full-source survey` })
      const p = structuredClone(original.paragraph)
      p.runs[0]!.text = normalizeSource(book.text, 'normal', options.browser === 'webkit-host' ? 'safari' : options.browser)
      const normalized = makeCase({ ...original, paragraph: p, family: `book/${m.id}/normalized`, origin: `${original.origin}; exact maintained normalized native source, own full-source survey` })
      if (cases.has(raw.id) || (cases.has(normalized.id) && normalized.id !== raw.id)) throw new Error(`${m.id}: duplicate survey paragraph identity`)
      if (raw.id === normalized.id) { raw.origin += '; raw and normalized source are identical'; cases.set(raw.id, raw) }
      else { cases.set(raw.id, raw); cases.set(normalized.id, normalized) }
      pairs.push({ book: m.id, contentWidth: width, raw: raw.id, normalized: normalized.id, source: book.path, sourceSha256: book.sha256 })
    }
  }
  mkdirSync(out, { recursive: true }); const values = [...cases.values()]
  writeFileSync(join(out, 'cases.ndjson'), values.map(c => JSON.stringify(c)).join('\n') + '\n')
  const manifest: BookSurveyManifest = {
    format: 'pretext-book-survey-inputs/1', browser: options.browser, repo, artifactRoot, originalPopulation, sourceBooks: books.map(book => book.meta.id), pairs, cases: values.length,
    totalSourceUnits: values.reduce((n, c) => n + c.paragraph.runs[0]!.text.length, 0), maxSourceUnits: Math.max(...values.map(c => c.paragraph.runs[0]!.text.length)),
    sources, normalizerSha256: hashBytes(readFileSync(join(import.meta.dir, '../../tests/wrapping/contracts.ts'))), producerSha256: hashBytes(readFileSync(import.meta.path)),
    outputs: [{ file: 'cases.ndjson', sha256: hashBytes(readFileSync(join(out, 'cases.ndjson'))) }],
    selection: { widths, readsAnyOutcome: false, preparationLocale: 'default', originalHeightProtocol: 'cross-case diagnostic only: original raw public layout height vs matching normalized own-native height, rounded difference; not a full-source certificate or automatic candidate fault', strongProtocol: 'each raw/normalized ordinary paragraph: same text preparation and own full-source native observations in both orders' },
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); return manifest
}
if (import.meta.main) {
  try {
    const args = new Map<string, string>()
    for (const arg of process.argv.slice(2)) { const m = /^--(browser|out|widths|repo|artifact-root)=(.+)$/s.exec(arg); if (!m || args.has(m[1]!)) throw new Error(`unknown/duplicate argument ${arg}`); args.set(m[1]!, m[2]!) }
    if (!args.has('browser') || !args.has('out')) throw new Error('--browser and --out required')
    const result = await prepareBookSurvey({ browser: args.get('browser')! as TierBrowser, out: args.get('out')!, ...(args.has('widths') ? { widths: Number(args.get('widths')) as 2 | 3 } : {}), ...(args.has('repo') ? { repo: args.get('repo')! } : {}), ...(args.has('artifact-root') ? { artifactRoot: args.get('artifact-root')! } : {}) })
    console.log(JSON.stringify({ books: result.sourceBooks.length, pairs: result.pairs.length, cases: result.cases, totalSourceUnits: result.totalSourceUnits, maxSourceUnits: result.maxSourceUnits }))
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
}
