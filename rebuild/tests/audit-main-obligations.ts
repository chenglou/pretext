// Recheck every historical main-pass label against its original raw browser observation. No browser work and no
// rebuild-outcome selection: a verified result proves only this original observation, never opposing-order stability.
// bun rebuild/tests/audit-main-obligations.ts --catalog=<generated catalog dir> --out=<new audit dir>
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { existingRows, readLines } from '../lab/rows.ts'
import { withNativeRow } from '../lab/score.ts'
import type { Case, LabRow } from '../lab/types.ts'
import { evaluateVisibleRanges, type RangeEvaluation } from './check-main-obligations.ts'
import { inputPath } from './main-obligations.ts'

type Source = { part: string; metadata: string; metadataSha256: string; input: string; inputSha256: string; nativeRun: string; nativeRunSha256: string; mainRun: string; mainRunSha256: string; rows: number; obligations: number }
type Catalog = { format: string; browser: string; from: string; artifactRoot: string; scope: string; selectedParts: string[]; selectedPopulationComplete: boolean; generatorSha256: string; counts: { population: number; obligations: number }; sources: Source[]; outputs: Array<{ file: string; sha256: string }> }
type Population = { id: string; family: string; mainPassObligation: boolean; main: unknown; native: { lines: number; key: string }; source: { part: string } }
export type MainAuditEntry = { id: string; family: string; part: string; mainObservedVisiblePass: 'verified' | 'refuted' | 'inconclusive'; required: boolean; historicalMain: unknown; historicalNative: Population['native']; evaluation: RangeEvaluation | null; reason: string | null; mainRowSha256: string | null; nativeRowSha256: string | null }
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
async function fileHash(path: string): Promise<string> { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
function stamp(path: string): string { const value = statSync(path); return `${value.size}/${value.mtimeMs}` }
function inconclusive(row: Population, reason: string): MainAuditEntry { return { id: row.id, family: row.family, part: row.source.part, mainObservedVisiblePass: 'inconclusive', required: false, historicalMain: row.main, historicalNative: row.native, evaluation: null, reason, mainRowSha256: null, nativeRowSha256: null } }

export async function auditMainObligations(options: { catalog: string; out: string }) {
  const started = Date.now(), catalog = resolve(options.catalog), out = resolve(options.out)
  if (existsSync(out)) throw new Error(`${out}: output already exists`)
  const manifestPath = join(catalog, 'manifest.json'), manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes.toString()) as Catalog
  if (!['pretext-main-native-obligations/1', 'pretext-main-native-obligations/2'].includes(manifest.format) || !manifest.selectedPopulationComplete || !['chrome', 'firefox', 'webkit-host'].includes(manifest.browser) || manifest.sources.length !== manifest.selectedParts.length || new Set(manifest.sources.map(value => value.part)).size !== manifest.sources.length) throw new Error('requires a complete generated original-population catalog')
  for (const file of ['population.ndjson', 'full-cases.ndjson', 'obligations.ndjson']) {
    const expected = manifest.outputs.find(output => output.file === file)?.sha256
    if (expected === undefined || await fileHash(join(catalog, file)) !== expected) throw new Error(`${file}: does not match the catalog's sealed output`)
  }
  const population = new Map<string, Map<string, Population>>(), expectedCases = new Map<string, Case>()
  let seenPopulation = 0, historicalPasses = 0
  for await (const line of readLines(join(catalog, 'population.ndjson'))) {
    const row = JSON.parse(line) as Population
    let part = population.get(row.source.part); if (part === undefined) population.set(row.source.part, part = new Map())
    if (part.has(row.id)) throw new Error(`${row.id}: duplicate population observation`)
    part.set(row.id, row); seenPopulation++; if (row.mainPassObligation) historicalPasses++
  }
  for await (const line of readLines(join(catalog, 'full-cases.ndjson'))) { const value = JSON.parse(line) as Case; if (expectedCases.has(value.id)) throw new Error(`duplicate original main-pass case ${value.id}`); expectedCases.set(value.id, value) }
  if (seenPopulation !== manifest.counts.population || historicalPasses !== manifest.counts.obligations || expectedCases.size !== historicalPasses) throw new Error('catalog output populations do not match its manifest')
  mkdirSync(out, { recursive: true })
  const destination = join(out, 'entries.ndjson'), file = openSync(destination, 'wx'), sources: Array<Record<string, unknown>> = [], counts = { historicalPasses, verified: 0, refuted: 0, inconclusive: 0 }, reasons: Record<string, number> = {}
  try {
    for (const source of manifest.sources) {
      const observations = population.get(source.part)
      if (observations === undefined || observations.size !== source.rows) throw new Error(`${source.part}: missing original population`)
      const seals: Array<[string, string]> = [[source.metadata, source.metadataSha256], [source.input, source.inputSha256], [source.nativeRun, source.nativeRunSha256], [source.mainRun, source.mainRunSha256]]
      for (const [path, hash] of seals) if (await fileHash(path) !== hash) throw new Error(`${path}: original source does not match catalog provenance`)
      const nativeRun = JSON.parse(readFileSync(source.nativeRun, 'utf8')), mainRun = JSON.parse(readFileSync(source.mainRun, 'utf8'))
      if (nativeRun.status !== 'ok' || mainRun.status !== 'ok' || nativeRun.predictOnly || !mainRun.predictOnly || nativeRun.order !== 'file' || mainRun.order !== 'file' || nativeRun.totals.rows !== source.rows || mainRun.totals.rows !== source.rows || inputPath(nativeRun.casesFile, manifest.artifactRoot) !== source.input || inputPath(mainRun.casesFile, manifest.artifactRoot) !== source.input) throw new Error(`${source.part}: original main/native run protocol does not match the catalog`)
      const mainPath = existingRows(join(dirname(source.mainRun), `${manifest.browser}-rows.ndjson`)), nativePath = existingRows(join(dirname(source.nativeRun), `${manifest.browser}-rows.ndjson`))
      if (mainPath === null || nativePath === null) throw new Error(`${source.part}: original raw main/native rows missing`)
      const paths = [...seals.map(([path]) => path), mainPath, nativePath], before = paths.map(stamp)
      const main = new Map<string, { row: LabRow; hash: string }>(), mainIds = new Set<string>(), nativeIds = new Set<string>(), completed = new Set<string>()
      for await (const line of readLines(mainPath)) {
        const row = JSON.parse(line) as LabRow, old = observations.get(row.id)
        if (row.browser !== manifest.browser || old === undefined || mainIds.has(row.id)) throw new Error(`${source.part}/${row.id}: unexpected or duplicate original main row`)
        mainIds.add(row.id)
        if (old.mainPassObligation) main.set(row.id, { row, hash: digest(line) })
      }
      for await (const line of readLines(nativePath)) {
        const row = JSON.parse(line) as LabRow, old = observations.get(row.id)
        if (row.browser !== manifest.browser || old === undefined || nativeIds.has(row.id)) throw new Error(`${source.part}/${row.id}: unexpected or duplicate original native row`)
        nativeIds.add(row.id)
        if (!old.mainPassObligation) continue
        const predicted = main.get(row.id), expected = expectedCases.get(row.id)
        let result = inconclusive(old, 'original main row missing')
        if (predicted !== undefined && expected !== undefined) {
          if (predicted.row.case.id !== row.id || row.case.id !== row.id || row.family !== old.family || predicted.row.family !== old.family || JSON.stringify(predicted.row.case) !== JSON.stringify(expected) || JSON.stringify(row.case) !== JSON.stringify(expected)) result.reason = 'original rows do not describe the catalog input'
          else {
            const borrowed = withNativeRow(predicted.row, row)
            if ('error' in borrowed) result.reason = `cannot combine original main/native environments: ${borrowed.error}`
            else {
              const evaluation = evaluateVisibleRanges(borrowed), metrics = [evaluation.lineCount, evaluation.visibleBreaks]
              result.evaluation = evaluation
              if (evaluation.nativeLines !== null && evaluation.nativeLines !== old.native.lines) result.reason = `raw native line count ${evaluation.nativeLines} differs from historical metadata ${old.native.lines}`
              else {
                result.mainObservedVisiblePass = metrics.every(metric => metric.status === 'pass') ? 'verified' : metrics.some(metric => metric.status === 'fail') ? 'refuted' : 'inconclusive'
                result.required = result.mainObservedVisiblePass === 'verified'
                result.reason = metrics.find(metric => metric.status !== 'pass')?.reason ?? null
              }
            }
          }
          result.mainRowSha256 = predicted.hash
        }
        result.nativeRowSha256 = digest(line)
        counts[result.mainObservedVisiblePass]++; if (result.reason !== null) reasons[result.reason] = (reasons[result.reason] ?? 0) + 1
        writeSync(file, JSON.stringify(result) + '\n'); completed.add(row.id)
      }
      if (mainIds.size !== source.rows || nativeIds.size !== source.rows || completed.size !== source.obligations) throw new Error(`${source.part}: original raw rows do not cover the recorded census population`)
      const mainRowsSha256 = await fileHash(mainPath), nativeRowsSha256 = await fileHash(nativePath)
      if (paths.some((path, index) => stamp(path) !== before[index])) throw new Error(`${source.part}: original evidence changed during audit`)
      sources.push({ ...source, mainRows: mainPath, mainRowsSha256, nativeRows: nativePath, nativeRowsSha256, audited: completed.size })
    }
  } finally { closeSync(file) }
  if (counts.verified + counts.refuted + counts.inconclusive !== historicalPasses) throw new Error('audit did not classify every historical main-pass label')
  const report = {
    format: 'pretext-main-native-audit/1', browser: manifest.browser, catalog, catalogManifestSha256: digest(manifestBytes), catalogGeneratorSha256: manifest.generatorSha256,
    scope: manifest.scope, selectedParts: manifest.selectedParts, complete: true, counts, reasons,
    meaning: { verified: 'main line count and complete unambiguous visible source ranges passed at the original native observation', refuted: 'raw native evidence refutes at least one historical main-pass label; retained visibly, not a required main pass', inconclusive: 'raw native evidence does not certify a main pass; retained visibly', nativeStability: 'not established: original file-order observation only', excludesByRebuildOutcomeOrGapsOrHistory: false },
    auditorSha256: digest(readFileSync(join(import.meta.dir, 'audit-main-obligations.ts'))), rangeEvaluatorSha256: digest(readFileSync(join(import.meta.dir, 'check-main-obligations.ts'))), scorerSha256: digest(readFileSync(join(import.meta.dir, '../lab/score.ts'))),
    sources, outputs: [{ file: 'entries.ndjson', sha256: await fileHash(destination) }], elapsedMs: Date.now() - started,
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  return report
}

if (import.meta.main) {
  try {
    const args = new Map<string, string>()
    for (const arg of process.argv.slice(2)) { const match = /^--(catalog|out)=(.+)$/s.exec(arg); if (match === null || args.has(match[1]!)) throw new Error(`unknown or repeated argument ${arg}`); args.set(match[1]!, match[2]!) }
    if (!args.has('catalog') || !args.has('out')) throw new Error('--catalog and --out are required')
    const report = await auditMainObligations({ catalog: args.get('catalog')!, out: args.get('out')! })
    console.log(`${report.browser}: ${JSON.stringify(report.counts)}; ${JSON.stringify(report.reasons)}; ${report.elapsedMs}ms; original observation only`)
    // Refuted historical labels are a completed audit result, not an engine gate. Incomplete evidence cannot produce
    // the completed manifest and is refused above. The fresh checker gates newly certified obligations separately.
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
}
