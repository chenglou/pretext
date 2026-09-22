// Four fresh own-native application checks, then the strict obligation checker. Main is an optional diagnostic.
// bun rebuild/tests/run-main-obligations.ts --browser=chrome|firefox|webkit-host --catalog=<audited stage> --out=<new dir>
//   [--main-comparison]
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { acquireBrowserAutomationLock, type AutomationBrowserKind } from '../../scripts/browser-automation.ts'
import { sealFiles, sealNativeSources, verifyFileSeals } from './native-workflow-sources.ts'

type Browser = 'chrome' | 'firefox' | 'webkit-host'
export type Options = { browser: Browser; catalog: string; out: string; mainComparison: boolean }
type Execute = (command: string[], log: string, cwd: string) => Promise<number>
type Operations = { acquire: typeof acquireBrowserAutomationLock; execute: Execute }
const repo = resolve(import.meta.dir, '../..')
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
function passingReport(report: { format?: string; ok?: boolean; counts?: { obligations: number }; cases?: Array<{ status: string }>; unexpected?: unknown[] }): boolean {
  return report.format === 'pretext-fresh-main-obligations/1' && report.ok === true && Array.isArray(report.cases) && report.cases.length > 0 && report.counts?.obligations === report.cases.length && report.cases.every(row => row.status === 'pass') && report.unexpected?.length === 0
}
async function execute(command: string[], log: string, cwd: string): Promise<number> {
  const fd = openSync(log, 'wx')
  try { return await Bun.spawn(command, { cwd, stdout: fd, stderr: fd }).exited }
  finally { closeSync(fd) }
}

export function parseOptions(args: string[]): Options {
  const flags = new Map<string, string>()
  for (const arg of args) {
    const match = /^--(browser|catalog|out)=(.+)$/s.exec(arg)
    const key = match?.[1] ?? (arg === '--main-comparison' ? 'main-comparison' : null)
    if (key === null || flags.has(key)) throw new Error(`unknown or duplicate argument ${arg}`)
    flags.set(key, match?.[2] ?? '')
  }
  const browser = flags.get('browser')
  if (browser !== 'chrome' && browser !== 'firefox' && browser !== 'webkit-host') throw new Error('--browser is chrome, firefox or webkit-host')
  if (!flags.has('catalog') || !flags.has('out')) throw new Error('--catalog and --out are required')
  return { browser, catalog: resolve(flags.get('catalog')!), out: resolve(flags.get('out')!), mainComparison: flags.has('main-comparison') }
}

// All children are separate processes; the workflow holds the canonical browser lock across them.
export async function runJobs(options: Options, run: Execute = execute, root = repo): Promise<number> {
  const { browser, catalog, out, mainComparison } = options
  const jobs: Array<{ job: string; command: string[]; log: string; startedAt: string; exit: number | null; durationMs: number; error?: string }> = []
  let exit = 0
  async function job(name: string, command: string[]) {
    const startedAt = new Date().toISOString(), start = Date.now(), log = join(out, `${name}.log`)
    console.log(`[main obligations] ${name}`)
    const record = { job: name, command, log, startedAt, exit: null as number | null, durationMs: 0 }
    try { record.exit = await run(command, log, root); exit ||= record.exit }
    catch (error) { Object.assign(record, { error: String(error) }); exit ||= 2 }
    record.durationMs = Date.now() - start; jobs.push(record)
    save(join(out, 'jobs.json'), { format: 'pretext-main-native-jobs/1', browser, mainComparison, mainScope: 'predict-only diagnostic; native state borrowed from corresponding redo run', jobs })
    console.log(`[main obligations] ${name}: exit ${record.exit}; ${record.durationMs}ms`)
  }
  for (const [role, predictor] of [['redo', 'inspected-ranges-predictor.ts'], ['plain', 'plain-predictor.ts'], ...(mainComparison ? [['main', 'main-predictor.ts']] : [])]) {
    for (const [order, flag] of [['forward', 'file'], ['reverse', 'reverse']]) await job(`${role}-${order}`, [
      'bun', join(root, 'rebuild/lab/run.ts'), `--browser=${browser}`, `--cases=${join(catalog, 'fast-cases.ndjson')}`,
      `--predictor=${join(root, 'rebuild/lab/baselines', predictor!)}`, `--order=${flag}`, `--out=${join(out, `${role}-${order}`)}`,
      role === 'main' ? '--predict-only' : '--measure-first',
    ])
  }
  const report = join(out, 'fresh-check.json')
  await job('check', ['bun', join(root, 'rebuild/tests/check-main-obligations.ts'),
    `--cases=${join(catalog, 'fast-cases.ndjson')}`, `--obligations=${join(catalog, 'fast-obligations.ndjson')}`,
    ...['redo', 'plain', ...(mainComparison ? ['main'] : [])].flatMap(role => ['forward', 'reverse'].map(order =>
      `--${role === 'redo' ? '' : `${role}-`}${order}=${join(out, `${role}-${order}`, `${browser}-rows.ndjson`)}`)), `--out=${report}`,
  ])
  try { if (!passingReport(JSON.parse(readFileSync(report, 'utf8')))) exit ||= 1 }
  catch (error) { console.error(`completed checker report unavailable: ${String(error)}`); exit ||= 2 }
  save(join(out, 'jobs.json'), { format: 'pretext-main-native-jobs/1', browser, mainComparison, mainScope: 'predict-only diagnostic; native state borrowed from corresponding redo run', completed: true, status: exit === 0 ? 'ok' : 'error', exit, jobs })
  return exit
}

export async function runWorkflow(options: Options, operations: Operations = { acquire: acquireBrowserAutomationLock, execute }, root = repo): Promise<number> {
  const { browser, catalog, out } = options
  if (existsSync(out)) throw new Error(`${out}: output must be new`)
  const manifestPath = join(catalog, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.format !== 'pretext-main-native-obligations/2' || manifest.browser !== browser || !manifest.auditSource || manifest.selectedPopulationComplete !== true || manifest.selection?.excludesByOriginOrGapsOrRebuildOutcomeOrHistory !== false) throw new Error('requires a complete audited format-2 catalog for the selected browser')
  const cases = join(catalog, 'fast-cases.ndjson'), obligations = join(catalog, 'fast-obligations.ndjson')
  const required = readFileSync(obligations, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  if (required.length === 0 || required.some(row => row.required?.lineCount !== 'pass' || row.required?.visibleBreaks !== 'pass' || row.mainEvidence?.status !== 'verified' || row.mainEvidence.audit?.required !== true || row.mainEvidence.audit.evaluation?.lineCount?.status !== 'pass' || row.mainEvidence.audit.evaluation?.visibleBreaks?.status !== 'pass') || manifest.counts?.fast !== required.length || manifest.counts?.pendingCertification !== 0 || !(manifest.counts?.certifiedRequired >= required.length)) throw new Error('fast obligations must have certified pass/pass requirements')
  const inputs = [manifestPath, cases, obligations].map(path => ({ path, sha256: hash(path) }))
  for (const input of inputs.slice(1)) if (!manifest.outputs?.some((output: { file: string; sha256: string }) => join(catalog, output.file) === input.path && output.sha256 === input.sha256)) throw new Error(`${input.path}: certified output hash differs`)
  const auditPath = join(manifest.auditSource.path, 'manifest.json'), audit = JSON.parse(readFileSync(auditPath, 'utf8'))
  if (hash(auditPath) !== manifest.auditSource.manifestSha256 || audit.format !== 'pretext-main-native-audit/1' || audit.browser !== browser || audit.complete !== true) throw new Error('catalog audit provenance differs or is incomplete')
  for (const [file, expected] of [['rebuild/lab/score.ts', audit.scorerSha256], ['rebuild/tests/check-main-obligations.ts', audit.rangeEvaluatorSha256], ['rebuild/tests/audit-main-obligations.ts', audit.auditorSha256]]) if (hash(join(root, file!)) !== expected) throw new Error(`${file}: acceptance source changed; recertify the catalog`)
  const acceptance = ['rebuild/tests/check-main-obligations.ts', 'rebuild/tests/audit-main-obligations.ts', 'rebuild/tests/main-obligations.ts', 'rebuild/tests/ledger.ts', 'rebuild/tests/known-tail.ts', 'rebuild/tests/sets.ts', import.meta.path]
  const sources = sealNativeSources(root, options.mainComparison, acceptance, browser === 'webkit-host'), frozenInputs = sealFiles([...inputs.map(input => input.path), auditPath])
  function verifyFreeze() {
    verifyFileSeals(sources, sealNativeSources(root, options.mainComparison, acceptance, browser === 'webkit-host'), 'runtime/acceptance sources')
    verifyFileSeals(frozenInputs, sealFiles(frozenInputs.map(input => input.path)), 'catalog/audit inputs')
  }
  mkdirSync(dirname(out), { recursive: true }); mkdirSync(out)
  const record = { format: 'pretext-main-native-workflow/1', redoScope: 'inspected core ranges/measurements; lab expected observation, painting and painter limits omitted', plainScope: 'count/range output without pieces', options, inputs, sources, frozenInputs, auditSource: manifest.auditSource, startedAt: new Date().toISOString(), lockBrowser: browser === 'webkit-host' ? 'safari' : browser, driverSha256: hash(import.meta.path), adoptable: false, exit: null as number | null }
  save(join(out, 'workflow.json'), record)
  let lock: Awaited<ReturnType<Operations['acquire']>> | undefined
  try {
    lock = await operations.acquire(record.lockBrowser as AutomationBrowserKind)
    verifyFreeze(); Object.assign(record, { sourceVerifiedAfterLockAt: new Date().toISOString() })
    record.exit = await runJobs(options, operations.execute, root)
    verifyFreeze(); Object.assign(record, { sourceVerifiedAfterJobsAt: new Date().toISOString() })
    if (record.exit === 0) {
      const jobs = JSON.parse(readFileSync(join(out, 'jobs.json'), 'utf8')), report = JSON.parse(readFileSync(join(out, 'fresh-check.json'), 'utf8'))
      if (jobs.format !== 'pretext-main-native-jobs/1' || jobs.browser !== browser || jobs.completed !== true || jobs.status !== 'ok' || jobs.exit !== 0 || jobs.jobs?.length !== (options.mainComparison ? 7 : 5) || jobs.jobs.some((job: { exit: number | null }) => job.exit !== 0) || !passingReport(report) || report.counts.obligations !== required.length) throw new Error('workflow exited zero without completed passing jobs/checker report')
    }
    record.adoptable = record.exit === 0
    return record.exit
  } catch (error) { record.exit ||= 2; Object.assign(record, { error: String(error) }); console.error(String(error)); return record.exit }
  finally { lock?.release(); save(join(out, 'workflow.json'), { ...record, finishedAt: new Date().toISOString() }) }
}

if (import.meta.main) {
  try { process.exit(await runWorkflow(parseOptions(process.argv.slice(2)))) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
}
