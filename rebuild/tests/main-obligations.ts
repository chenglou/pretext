// Recover obligations from the original census's main-vs-native observations, independently of the rebuild's outcome.
// This stages cases and provenance, not a favorable-history gate seed. A native hash is not a stability certificate.
//
// bun rebuild/tests/main-obligations.ts --from=<census dir> --artifact-root=<shared .artifacts> --browser=chrome
//   --out=<new dir> [--parts=chunks|all|chunk00,real-text] [--budget=1000] [--max-units=4096]
//   [--seed=pretext-native-1] [--history-ledger=<reviewed format-3 ledger>] [--audit=<completed strict audit dir>]
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, openSync, closeSync, writeSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { Case, InlineNode } from '../lab/types.ts'
import { readLines as lines } from '../lab/rows.ts'
import { readLedger } from './ledger.ts'
import { TIER_BROWSERS, type TierBrowser } from './sets.ts'
import type { MainAuditEntry } from './audit-main-obligations.ts'

type Status = 'pass' | 'fail' | 'unobserved' | 'not-applicable'
type CensusCase = { browser: TierBrowser; id: string; family: string; chunk: string; units: number; main: { lineCount: Status; visibleBreaks: Status }; native: { lines: number | null; key: string | null }; rebuild: { lineCount: string; breaks: string; widths: string; painter: string }; gaps?: string[]; covered?: Record<string, boolean> }
type Run = { status: string; casesFile: string; order: string; predictOnly?: boolean; totals: { rows: number }; build: unknown; languages: unknown; bundleSha256: string }
type Obligation = { id: string; family: string; units: number; required: { lineCount: 'pass'; visibleBreaks: 'pass' } | null; mainEvidence: { status: 'pending-strict-native-source-audit' | MainAuditEntry['mainObservedVisiblePass']; audit: MainAuditEntry | null }; native: CensusCase['native']; nativeStability: 'unverified-single-observation'; knownNativeHistory: boolean; source: { part: string; metadata: string; input: string }; observedRebuild: CensusCase['rebuild']; gaps: string[]; covered: Record<string, boolean> }
type Candidate = { obligation: Obligation; tokens: string[]; rank: string; cost: number }
export type ObligationOptions = { from: string; artifactRoot: string; browser: TierBrowser; out: string; parts?: string; budget?: number; maxUnits?: number; seed?: string; historyLedger?: string; audit?: string }

function compare(a: Candidate, b: Candidate): number { return a.cost - b.cost || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) || (a.obligation.id < b.obligation.id ? -1 : a.obligation.id > b.obligation.id ? 1 : 0) }
// Keep only the cheapest deterministic fill candidates, alongside one best candidate per coverage token.
function retain(pool: Candidate[], candidate: Candidate, budget: number): void {
  if (pool.length < budget) {
    let index = pool.length
    pool.push(candidate)
    while (index > 0) { const parent = (index - 1) >> 1; if (compare(pool[parent]!, candidate) >= 0) break; pool[index] = pool[parent]!; index = parent }
    pool[index] = candidate
    return
  }
  if (compare(candidate, pool[0]!) >= 0) return
  let index = 0
  while (index * 2 + 1 < pool.length) {
    let child = index * 2 + 1
    if (child + 1 < pool.length && compare(pool[child + 1]!, pool[child]!) > 0) child++
    if (compare(candidate, pool[child]!) >= 0) break
    pool[index] = pool[child]!; index = child
  }
  pool[index] = candidate
}

function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
// Old worktree paths are intentionally translated only through their recorded .artifacts suffix, against a caller's
// explicit artifact root. Do not guess another checkout or fall back to a similarly named file.
export function inputPath(recorded: string, artifactRoot: string): string {
  const normalized = recorded.replaceAll('\\', '/')
  const marker = normalized.startsWith('.artifacts/') ? 0 : normalized.indexOf('/.artifacts/') + 1
  if (marker < 1 && !normalized.startsWith('.artifacts/')) throw new Error(`${recorded}: no .artifacts suffix; cannot normalize the input`)
  const suffix = normalized.slice(marker + '.artifacts/'.length)
  const path = resolve(artifactRoot, suffix)
  if (!path.startsWith(resolve(artifactRoot) + sep)) throw new Error(`${recorded}: input escapes --artifact-root`)
  if (!existsSync(path)) throw new Error(`${path}: recorded case input missing`)
  return path
}

const SCRIPTS = ['Latin', 'Arabic', 'Hebrew', 'Han', 'Hangul', 'Hiragana', 'Katakana', 'Cyrillic', 'Greek', 'Devanagari', 'Thai', 'Bengali', 'Gurmukhi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Lao', 'Myanmar', 'Khmer', 'Tibetan', 'Armenian', 'Georgian', 'Ethiopic']
const SCRIPT_TESTS = SCRIPTS.map(name => [name, new RegExp(`\\p{Script=${name}}`, 'u')] as const)
const KNOWN_SCRIPT_CHARACTERS = new RegExp(`[${[...SCRIPTS, 'Common', 'Inherited'].map(name => `\\p{Script=${name}}`).join('')}]`, 'gu')
function widthBucket(width: number): string { return width < 32 ? '<32' : width < 80 ? '32-79' : width < 160 ? '80-159' : width < 320 ? '160-319' : width < 640 ? '320-639' : '>=640' }
function corpusTextToken(value: Case): string | null {
  if (value.family !== 'suite/maintained/corpus') return null
  const p = value.paragraph
  // The original corpus import is one raw, normal-whitespace text node. Keep that shape: a normalized copy,
  // prefix, or span-per-word reconstruction is a different native paragraph, even if its font/family matches.
  if (value.inline !== undefined || p.runs.length !== 1 || p.runs[0]!.node !== 'text' || p.whiteSpace !== 'normal') throw new Error(`${value.id}: maintained corpus input must preserve its original one-node raw paragraph shape`)
  return `corpusText:${digest(p.runs[0]!.text)}`
}
export function coverageTokens(value: Case): string[] {
  const p = value.paragraph
  const tokens = new Set<string>([`family:${value.family}`, `pageLang:${value.pageLang}`, `lang:${p.lang}`, `direction:${p.direction}`, `width:${widthBucket(p.width)}`, `lineHeight:${p.lineHeight}`, `runCount:${p.runs.length < 3 ? p.runs.length : '3+'}`, `structure:${value.inline === undefined ? 'flat' : 'tree'}`])
  const font = (f: typeof p.font) => { tokens.add(`font:${f.family}`); tokens.add(`fontSize:${f.size}`); tokens.add(`fontStyle:${f.weight}/${f.style}`) }
  const style = (s: Pick<typeof p, 'font' | 'letterSpacing' | 'wordSpacing' | 'whiteSpace' | 'wordBreak' | 'overflowWrap' | 'lineBreak' | 'tabSize'>) => {
    font(s.font)
    for (const key of ['letterSpacing', 'wordSpacing', 'whiteSpace', 'wordBreak', 'overflowWrap', 'lineBreak', 'tabSize'] as const) tokens.add(`${key}:${s[key]}`)
  }
  style(p)
  let text = ''
  for (const run of p.runs) { font(run.font); tokens.add(`letterSpacing:${run.letterSpacing}`); tokens.add(`wordSpacing:${run.wordSpacing}`); tokens.add(`node:${run.node}`); if (run.lang !== null) tokens.add(`lang:${run.lang}`); text += run.text }
  const corpus = corpusTextToken(value)
  if (corpus !== null) tokens.add(corpus)
  for (const [name, test] of SCRIPT_TESTS) if (test.test(text)) tokens.add(`script:${name}`)
  if (/\p{Extended_Pictographic}/u.test(text)) tokens.add('script:emoji')
  if (/\p{Letter}/u.test(text.replace(KNOWN_SCRIPT_CHARACTERS, ''))) tokens.add('script:other')
  if (value.inline !== undefined) {
    tokens.add(`textAlign:${value.inline.textAlign}`)
    tokens.add(`textIndent:${value.inline.textIndent === 0 ? 'zero' : 'nonzero'}`)
    tokens.add(`slots:${value.inline.lineSlots.length === 0 ? 'none' : 'floats'}`)
    const visit = (nodes: InlineNode[]) => { for (const node of nodes) { tokens.add(`node:${node.kind}`); if (node.kind === 'span') { style(node); tokens.add(`verticalAlign:${node.verticalAlign}`); if (node.lang !== null) tokens.add(`lang:${node.lang}`); visit(node.children) } } }
    visit(value.inline.content)
  }
  return [...tokens].sort()
}

export async function buildMainObligations(options: ObligationOptions) {
  const started = Date.now()
  const from = resolve(options.from), artifactRoot = resolve(options.artifactRoot), out = resolve(options.out)
  const budget = options.budget ?? 1000, maxUnits = options.maxUnits ?? 4096, seed = options.seed ?? 'pretext-native-1'
  if (!TIER_BROWSERS.includes(options.browser)) throw new Error(`unknown browser ${options.browser}`)
  if (!Number.isSafeInteger(budget) || budget < 1 || !Number.isSafeInteger(maxUnits) || maxUnits < 1) throw new Error('budget and max-units must be positive integers')
  if (existsSync(out)) throw new Error(`${out}: output already exists`)
  const root = join(from, options.browser)
  const expectedChunks = Array.from({ length: 12 }, (_, index) => `chunk${String(index).padStart(2, '0')}`)
  const names = new Set([...expectedChunks, ...readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^(?:(?:chunk|corpus)\d+|real-text)$/.test(entry.name)).map(entry => entry.name)])
  const discovered = [...names].sort().map(name => {
    const metadata = join(root, name, 'cases.ndjson')
    return { part: name, metadata, metadataPresent: existsSync(metadata), nativeRunPresent: existsSync(join(root, name, 'rebuild', `${options.browser}-run.json`)), mainRunPresent: existsSync(join(root, name, 'main', `${options.browser}-run.json`)) }
  })
  const partScope = options.parts ?? 'chunks'
  const wanted = partScope === 'chunks' ? expectedChunks : partScope === 'all' ? discovered.map(part => part.part) : partScope.split(',')
  if (wanted.length === 0 || new Set(wanted).size !== wanted.length) throw new Error('select at least one part, naming each only once')
  for (const name of wanted) {
    const part = discovered.find(part => part.part === name)
    if (part === undefined || !part.metadataPresent || !part.nativeRunPresent || !part.mainRunPresent) throw new Error(`${name}: selected original part is incomplete; choose complete parts explicitly`)
  }
  // Certification derives only from original main/native rows. Every historical label stays in the full catalog;
  // an audit may establish which labels actually justify main-pass requirements, never favorable redo exclusions.
  const auditEntries = new Map<string, MainAuditEntry>(), auditSources = new Map<string, Record<string, any>>()
  let auditSource: Record<string, unknown> | null = null
  if (options.audit !== undefined) {
    const path = resolve(options.audit), bytes = readFileSync(join(path, 'manifest.json')), audit = JSON.parse(bytes.toString())
    if (audit.format !== 'pretext-main-native-audit/1' || audit.browser !== options.browser || !audit.complete || JSON.stringify([...audit.selectedParts].sort()) !== JSON.stringify([...wanted].sort()) || audit.scorerSha256 !== await fileHash(join(import.meta.dir, '../lab/score.ts')) || audit.rangeEvaluatorSha256 !== await fileHash(join(import.meta.dir, 'check-main-obligations.ts')) || audit.auditorSha256 !== await fileHash(join(import.meta.dir, 'audit-main-obligations.ts'))) throw new Error('audit scope, browser or acceptance source differs; rerun the strict original-native audit')
    if (await fileHash(join(audit.catalog, 'manifest.json')) !== audit.catalogManifestSha256) throw new Error('audit catalog provenance changed')
    const entriesPath = join(path, 'entries.ndjson')
    if (await fileHash(entriesPath) !== audit.outputs.find((value: any) => value.file === 'entries.ndjson')?.sha256) throw new Error('audit entries do not match their sealed manifest')
    for (const source of audit.sources) {
      if (auditSources.has(source.part)) throw new Error(`duplicate audit part ${source.part}`)
      for (const [file, hash] of [[source.mainRows, source.mainRowsSha256], [source.nativeRows, source.nativeRowsSha256]]) if (await fileHash(file) !== hash) throw new Error(`${file}: raw audit evidence changed`)
      auditSources.set(source.part, source)
    }
    if (auditSources.size !== wanted.length) throw new Error('audit omits an original population part')
    for await (const line of lines(entriesPath)) {
      const entry = JSON.parse(line) as MainAuditEntry
      if (auditEntries.has(entry.id) || !['verified', 'refuted', 'inconclusive'].includes(entry.mainObservedVisiblePass) || entry.required !== (entry.mainObservedVisiblePass === 'verified') || (entry.required && (entry.evaluation?.lineCount.status !== 'pass' || entry.evaluation.visibleBreaks.status !== 'pass'))) throw new Error(`${entry.id}: malformed strict native audit evidence`)
      auditEntries.set(entry.id, entry)
    }
    if (auditEntries.size !== audit.counts.historicalPasses) throw new Error('audit does not classify its claimed full historical population')
    auditSource = { path, manifestSha256: digest(bytes), entriesSha256: await fileHash(entriesPath), counts: audit.counts, nativeStability: audit.meaning.nativeStability }
  }
  const historyIds = new Set<string>()
  let historySource: Record<string, unknown> | null = null
  if (options.historyLedger !== undefined) {
    const path = resolve(options.historyLedger), ledger = readLedger(path)
    if (ledger.header.browser !== options.browser) throw new Error('history ledger names another browser')
    for (const entry of ledger.entries) if (entry.exact === 'history-dependent' || Object.values(entry.status).includes('history-dependent')) historyIds.add(entry.id)
    historySource = { path, build: ledger.header.build, environments: ledger.header.environments, scorer: ledger.header.scorer, config: ledger.header.config, headerSha256: await fileHash(join(path, 'ledger.json')), entriesSha256: await fileHash(join(path, 'entries.ndjson')), interpretation: 'annotated, never removed from obligations' }
  }
  const ids = new Set<string>(), pool: Candidate[] = [], best = new Map<string, Candidate>(), universe = new Set<string>(), eligibleUniverse = new Set<string>(), populationCorpusTexts = new Set<string>(), counts: Record<string, number> = {}, sources: Array<Record<string, unknown>> = []
  let population = 0, obligations = 0, certifiedRequired = 0, certifiedRedoFailures = 0, refuted = 0, inconclusive = 0, redoFailures = 0, knownHistory = 0, tooLarge = 0
  mkdirSync(out, { recursive: true })
  const populationFile = openSync(join(out, 'population.ndjson'), 'wx'), fullFile = openSync(join(out, 'full-cases.ndjson'), 'wx'), obligationsFile = openSync(join(out, 'obligations.ndjson'), 'wx')
  const requiredCases = openSync(join(out, 'required-cases.ndjson'), 'wx'), requiredObligations = openSync(join(out, 'required-obligations.ndjson'), 'wx')
  try {
    for (const name of [...wanted].sort()) {
      const metadata = join(root, name, 'cases.ndjson'), nativeRun = join(root, name, 'rebuild', `${options.browser}-run.json`), mainRun = join(root, name, 'main', `${options.browser}-run.json`)
      const nativeBytes = readFileSync(nativeRun), mainBytes = readFileSync(mainRun)
      const native = JSON.parse(nativeBytes.toString()) as Run, main = JSON.parse(mainBytes.toString()) as Run
      if (native.status !== 'ok' || main.status !== 'ok' || native.predictOnly === true || native.order !== 'file' || main.order !== 'file') throw new Error(`${name}: expected successful original file-order runs, including native observations`)
      const input = inputPath(native.casesFile, artifactRoot)
      if (inputPath(main.casesFile, artifactRoot) !== input) throw new Error(`${name}: main and native runs name different case inputs`)
      const certifiedSource = auditSources.get(name)
      if (options.audit !== undefined && (certifiedSource?.['metadata'] !== metadata || certifiedSource?.['input'] !== input || certifiedSource?.['metadataSha256'] !== await fileHash(metadata) || certifiedSource?.['inputSha256'] !== await fileHash(input) || certifiedSource?.['nativeRunSha256'] !== digest(nativeBytes) || certifiedSource?.['mainRunSha256'] !== digest(mainBytes))) throw new Error(`${name}: certification belongs to different original metadata, cases or runs`)
      const sourceStamp = [statSync(metadata).size, statSync(metadata).mtimeMs, statSync(input).size, statSync(input).mtimeMs]
      const observed = new Map<string, CensusCase>()
      for await (const line of lines(metadata)) {
        const value = JSON.parse(line) as CensusCase
        if (value.browser !== options.browser || value.chunk !== name || typeof value.id !== 'string' || ids.has(value.id)) throw new Error(`${name}/${value.id}: mismatched browser/part or duplicate original observation`)
        ids.add(value.id); observed.set(value.id, value); population++
        const kind = `${value.main.lineCount}/${value.main.visibleBreaks}`
        counts[kind] = (counts[kind] ?? 0) + 1
      }
      if (observed.size !== native.totals.rows || observed.size !== main.totals.rows) throw new Error(`${name}: metadata population differs from recorded native/main row counts`)
      let found = 0, partObligations = 0
      const inputIds = new Set<string>()
      for await (const line of lines(input)) {
        const value = JSON.parse(line) as Case
        if (inputIds.has(value.id)) throw new Error(`${name}/${value.id}: duplicate case in recorded input`)
        inputIds.add(value.id)
        const row = observed.get(value.id)
        if (row === undefined) continue // Cases applying to a different browser are in the shared input file.
        if (value.family !== row.family) throw new Error(`${name}/${value.id}: input family differs from its observation`)
        found++; observed.delete(value.id)
        const corpus = corpusTextToken(value)
        if (corpus !== null) populationCorpusTexts.add(corpus)
        const qualifies = row.main.lineCount === 'pass' && row.main.visibleBreaks === 'pass'
        const source = { part: name, metadata, input }
        writeSync(populationFile, JSON.stringify({ ...row, source, mainPassObligation: qualifies, knownNativeHistory: historyIds.has(row.id) }) + '\n')
        if (!qualifies) continue
        if (typeof row.native.lines !== 'number' || !Number.isFinite(row.native.lines) || typeof row.native.key !== 'string') throw new Error(`${name}/${value.id}: a claimed main pass lacks observed native evidence`)
        const proof = auditEntries.get(row.id)
        if (options.audit !== undefined && (proof === undefined || proof.part !== name || proof.family !== row.family || proof.historicalNative.lines !== row.native.lines || proof.historicalNative.key !== row.native.key)) throw new Error(`${name}/${row.id}: historical label lacks matching original native certification`)
        const obligation: Obligation = { id: row.id, family: row.family, units: row.units, required: proof?.required ? { lineCount: 'pass', visibleBreaks: 'pass' } : null, mainEvidence: { status: proof?.mainObservedVisiblePass ?? 'pending-strict-native-source-audit', audit: proof ?? null }, native: row.native, nativeStability: 'unverified-single-observation', knownNativeHistory: historyIds.has(row.id), source, observedRebuild: row.rebuild, gaps: row.gaps ?? [], covered: row.covered ?? {} }
        obligations++; partObligations++
        if (proof?.required) { certifiedRequired++; writeSync(requiredCases, line + '\n'); writeSync(requiredObligations, JSON.stringify(obligation) + '\n'); if (row.rebuild.lineCount === 'fail' || row.rebuild.breaks === 'fail') certifiedRedoFailures++ }
        else if (proof?.mainObservedVisiblePass === 'refuted') refuted++
        else if (proof?.mainObservedVisiblePass === 'inconclusive') inconclusive++
        if (obligation.knownNativeHistory) knownHistory++
        if (row.rebuild.lineCount === 'fail' || row.rebuild.breaks === 'fail') redoFailures++
        writeSync(fullFile, line + '\n'); writeSync(obligationsFile, JSON.stringify(obligation) + '\n')
        const tokens = coverageTokens(value)
        for (const token of tokens) universe.add(token)
        if (options.audit !== undefined && !proof!.required) continue
        if (row.units > maxUnits) { tooLarge++; continue }
        for (const token of tokens) eligibleUniverse.add(token)
        const candidate = { obligation, tokens, rank: digest(seed + '\n' + value.id), cost: row.units < 256 ? 0 : row.units < 1024 ? 1 : 2 }
        for (const token of tokens) { const previous = best.get(token); if (previous === undefined || compare(candidate, previous) < 0) best.set(token, candidate) }
        retain(pool, candidate, budget)
      }
      if (observed.size !== 0) throw new Error(`${name}: ${observed.size} observed IDs are missing from recorded input`)
      sources.push({ part: name, metadata, metadataSha256: await fileHash(metadata), input, inputSha256: await fileHash(input), sourceStamp, nativeRun, nativeRunSha256: digest(nativeBytes), mainRun, mainRunSha256: digest(mainBytes), rows: found, obligations: partObligations, build: native.build, languages: native.languages, nativeBundleSha256: native.bundleSha256, mainBundleSha256: main.bundleSha256 })
      const afterStamp = [statSync(metadata).size, statSync(metadata).mtimeMs, statSync(input).size, statSync(input).mtimeMs]
      if (sourceStamp.some((value, index) => value !== afterStamp[index])) throw new Error(`${name}: census source changed during extraction`)
    }
  } finally { closeSync(populationFile); closeSync(fullFile); closeSync(obligationsFile); closeSync(requiredCases); closeSync(requiredObligations) }
  if (options.audit !== undefined && auditEntries.size !== obligations) throw new Error('audit population differs from every selected historical label')
  // A linear inverted index limits sampling work to one representative per marginal token. Rank and cost use inputs
  // only. Neither a rebuild failure, a gap, an origin label nor a known-history annotation affects selection.
  const families = [...best.keys()].filter(token => token.startsWith('family:')).sort()
  const selected = new Map<string, Candidate>(), covered = new Set<string>()
  const choose = (candidate: Candidate) => { selected.set(candidate.obligation.id, candidate); for (const token of candidate.tokens) covered.add(token) }
  for (const family of families) choose(best.get(family)!)
  if (selected.size > budget) throw new Error(`budget ${budget} cannot cover ${selected.size} eligible families; increase --budget (staging is incomplete)`)
  for (const token of [...best.keys()].filter(token => token.startsWith('corpusText:')).sort()) if (!covered.has(token)) choose(best.get(token)!)
  if (selected.size > budget) throw new Error(`budget ${budget} cannot cover ${selected.size} required family/corpus-text representatives; increase --budget (staging is incomplete)`)
  for (const token of [...best.keys()].sort()) if (!covered.has(token) && selected.size < budget) choose(best.get(token)!)
  for (const candidate of pool.sort(compare)) if (selected.size < budget) choose(candidate)
  const fastCases = openSync(join(out, 'fast-cases.ndjson'), 'wx'), fastObligations = openSync(join(out, 'fast-obligations.ndjson'), 'wx')
  try {
    // Preserve original input order within each part, making a changed history protocol visible rather than implying that
    // this smaller population can inherit the original's native stability.
    for (const source of sources) {
      for await (const line of lines(source['input'] as string)) {
        const value = JSON.parse(line) as Case, candidate = selected.get(value.id)
        if (candidate !== undefined && candidate.obligation.source.part === source['part']) { writeSync(fastCases, line + '\n'); writeSync(fastObligations, JSON.stringify(candidate.obligation) + '\n') }
      }
      const metadata = source['metadata'] as string, input = source['input'] as string
      const afterStamp = [statSync(metadata).size, statSync(metadata).mtimeMs, statSync(input).size, statSync(input).mtimeMs]
      if ((source['sourceStamp'] as number[]).some((value, index) => value !== afterStamp[index])) throw new Error(`${source['part']}: census source changed during fast selection`)
    }
  } finally { closeSync(fastCases); closeSync(fastObligations) }
  const missingTokens = [...universe].filter(token => !covered.has(token)).sort()
  const manifest = {
    format: 'pretext-main-native-obligations/2', browser: options.browser, from, artifactRoot,
    generatorSha256: digest(readFileSync(join(import.meta.dir, 'main-obligations.ts'))),
    scope: partScope, selectedParts: [...wanted].sort(),
    discoveredParts: discovered.map(part => ({ ...part, verification: wanted.includes(part.part) ? 'verified-inputs-and-population' : 'unclassified' })),
    selectedPopulationComplete: true,
    allDiscoveredPartsAvailable: discovered.every(part => part.metadataPresent && part.nativeRunPresent && part.mainRunPresent),
    allDiscoveredPartsComplete: wanted.length === discovered.length && discovered.every(part => part.metadataPresent && part.nativeRunPresent && part.mainRunPresent),
    historySource,
    auditSource,
    selection: {
      question: options.audit === undefined ? 'historical main-pass labels staged for strict original-native audit; no automatic certified requirements' : 'strict native source audit verified main lineCount and complete unambiguous visibleBreaks at the original observation',
      nativeStability: 'unverified; fresh both-order/application-protocol native checks required',
      expectedGeometrySource: 'browser observations, never main predictions',
      excludesByOriginOrGapsOrRebuildOutcomeOrHistory: false,
      fast: {
        budget, maxUnits, seed, actual: selected.size, omittedForSize: tooLarge,
        tokenCount: universe.size, eligibleTokenCount: eligibleUniverse.size, coveredTokenCount: covered.size,
        scriptClasses: [...SCRIPTS, 'emoji', 'other'], missingTokens,
        familiesAbsent: missingTokens.filter(token => token.startsWith('family:')),
        corpusTexts: {
          population: populationCorpusTexts.size,
          eligible: [...eligibleUniverse].filter(token => token.startsWith('corpusText:')).length,
          selected: [...covered].filter(token => token.startsWith('corpusText:')).length,
          unavailableForFast: [...populationCorpusTexts].filter(token => !eligibleUniverse.has(token)).sort(),
          absentFromFast: [...populationCorpusTexts].filter(token => !covered.has(token)).sort(),
        },
      },
    },
    counts: {
      population, mainOutcomes: counts, obligations, certifiedRequired, refutedHistoricalLabels: refuted, inconclusiveHistoricalLabels: inconclusive, pendingCertification: obligations - certifiedRequired - refuted - inconclusive,
      observedRebuildLineCountOrBreaksFailures: redoFailures,
      certifiedObservedRebuildLineCountOrBreaksFailures: certifiedRedoFailures,
      obligationsWithKnownNativeHistory: knownHistory, fast: selected.size,
      fastObservedRebuildFailures: [...selected.values()].filter(candidate => candidate.obligation.observedRebuild.lineCount === 'fail' || candidate.obligation.observedRebuild.breaks === 'fail').length,
    },
    sources,
    outputs: await Promise.all(['population.ndjson', 'full-cases.ndjson', 'obligations.ndjson', 'required-cases.ndjson', 'required-obligations.ndjson', 'fast-cases.ndjson', 'fast-obligations.ndjson'].map(async file => ({ file, sha256: await fileHash(join(out, file)) }))),
    elapsedMs: Date.now() - started,
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return manifest
}

if (import.meta.main) {
  try {
    const args = new Map<string, string>()
    for (const arg of process.argv.slice(2)) { const match = /^--(from|artifact-root|browser|out|parts|budget|max-units|seed|history-ledger|audit)=(.+)$/s.exec(arg); if (match === null) throw new Error(`unknown argument ${arg}`); args.set(match[1]!, match[2]!) }
    for (const key of ['from', 'artifact-root', 'browser', 'out']) if (!args.has(key)) throw new Error(`--${key} is required`)
    const report = await buildMainObligations({ from: args.get('from')!, artifactRoot: args.get('artifact-root')!, browser: args.get('browser')! as TierBrowser, out: args.get('out')!, ...(args.has('parts') ? { parts: args.get('parts')! } : {}), ...(args.has('budget') ? { budget: Number(args.get('budget')) } : {}), ...(args.has('max-units') ? { maxUnits: Number(args.get('max-units')) } : {}), ...(args.has('seed') ? { seed: args.get('seed')! } : {}), ...(args.has('history-ledger') ? { historyLedger: args.get('history-ledger')! } : {}), ...(args.has('audit') ? { audit: args.get('audit')! } : {}) })
    console.log(JSON.stringify({ counts: report.counts, selection: report.selection, elapsedMs: report.elapsedMs }, null, 2))
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
}
