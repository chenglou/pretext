// Six fresh own-native full-book runs, then the strict survey checker. No borrowed native observations.
// bun rebuild/tests/run-book-survey.ts --browser=chrome|firefox|webkit-host --catalog=<survey stage> --out=<new dir>
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { acquireBrowserAutomationLock, type AutomationBrowserKind } from '../../scripts/browser-automation.ts'
import { sealFiles, sealNativeSources, verifyFileSeals } from './native-workflow-sources.ts'

export type Options = { browser: 'chrome' | 'firefox' | 'webkit-host'; catalog: string; out: string }
type Execute = (command: string[], log: string, cwd: string) => Promise<number>
type Operations = { acquire: typeof acquireBrowserAutomationLock; execute: Execute }
const repo = resolve(import.meta.dir, '../..')
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
async function execute(command: string[], log: string, cwd: string): Promise<number> {
  const fd = openSync(log, 'wx')
  try { return await Bun.spawn(command, { cwd, stdout: fd, stderr: fd }).exited }
  finally { closeSync(fd) }
}
export function parseOptions(args: string[]): Options {
  const flags = new Map<string, string>()
  for (const arg of args) {
    const match = /^--(browser|catalog|out)=(.+)$/s.exec(arg)
    if (!match || flags.has(match[1]!)) throw new Error(`unknown or duplicate argument ${arg}`)
    flags.set(match[1]!, match[2]!)
  }
  const browser = flags.get('browser')
  if (browser !== 'chrome' && browser !== 'firefox' && browser !== 'webkit-host') throw new Error('--browser is chrome, firefox or webkit-host')
  if (!flags.has('catalog') || !flags.has('out')) throw new Error('--catalog and --out are required')
  return { browser, catalog: resolve(flags.get('catalog')!), out: resolve(flags.get('out')!) }
}

export async function runBookSurvey(options: Options, operations: Operations = { acquire: acquireBrowserAutomationLock, execute }, root = repo): Promise<number> {
  const { browser, catalog, out } = options
  if (existsSync(out)) throw new Error(`${out}: output must be new`)
  const manifestPath = join(catalog, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8')), cases = join(catalog, 'cases.ndjson')
  if (manifest.format !== 'pretext-book-survey-inputs/1' || manifest.browser !== browser || !Number.isSafeInteger(manifest.cases) || manifest.cases <= 0 || manifest.selection?.readsAnyOutcome !== false || manifest.selection.preparationLocale !== 'default') throw new Error('requires an input-only full-book survey catalog for the selected browser')
  const inputs = [manifestPath, cases].map(path => ({ path, sha256: hash(path) }))
  if (!manifest.outputs?.some((output: { file: string; sha256: string }) => output.file === 'cases.ndjson' && output.sha256 === inputs[1]!.sha256)) throw new Error('survey case hash differs')
  const acceptance = ['rebuild/tests/check-main-obligations.ts', 'rebuild/tests/check-book-survey.ts', 'rebuild/tests/prepare-book-survey.ts', 'rebuild/tests/sets.ts', 'tests/wrapping/contracts.ts', 'tests/wrapping/types.ts', 'shared/browser-environment.ts', import.meta.path]
  const sources = sealNativeSources(root, true, acceptance, browser === 'webkit-host')
  if (hash(join(root, 'rebuild/tests/prepare-book-survey.ts')) !== manifest.producerSha256 || hash(join(root, 'tests/wrapping/contracts.ts')) !== manifest.normalizerSha256) throw new Error('survey producer or normalizer source changed; regenerate inputs')
  const frozenInputs = sealFiles([...inputs.map(input => input.path), ...manifest.sources.map((input: { path: string }) => input.path)])
  for (const input of manifest.sources as Array<{ path: string; sha256: string }>) if (frozenInputs.find(file => file.path === resolve(input.path))?.sha256 !== input.sha256) throw new Error(`${input.path}: original corpus input changed; regenerate inputs`)
  function verifyFreeze() {
    verifyFileSeals(sources, sealNativeSources(root, true, acceptance, browser === 'webkit-host'), 'runtime/acceptance sources')
    verifyFileSeals(frozenInputs, sealFiles(frozenInputs.map(input => input.path)), 'catalog/corpus inputs')
  }
  mkdirSync(dirname(out), { recursive: true }); mkdirSync(out)
  const jobs: Array<{ job: string; command: string[]; log: string; startedAt: string; finishedAt: string; exit: number | null; durationMs: number; completion?: unknown; errors: string[] }> = []
  const record = { format: 'pretext-book-survey-workflow/1', redoScope: 'inspected core ranges/measurements; lab expected observation, painting and painter limits omitted', options, inputs, sources, frozenInputs, inputSources: manifest.sources, cases: manifest.cases, nativeScope: 'each role prepares the same source and has its own fresh native observations in both orders', startedAt: new Date().toISOString(), lockBrowser: browser === 'webkit-host' ? 'safari' : browser, adoptable: false, exit: null as number | null }
  save(join(out, 'workflow.json'), record)
  let lock: Awaited<ReturnType<Operations['acquire']>> | undefined, exit = 0
  async function job(name: string, command: string[], order?: string) {
    const startedAt = new Date().toISOString(), start = Date.now(), log = join(out, `${name}.log`)
    const result = { job: name, command, log, startedAt, finishedAt: '', exit: null as number | null, durationMs: 0, errors: [] as string[] }
    console.log(`[book survey] ${name}`)
    try { result.exit = await operations.execute(command, log, root); exit ||= result.exit }
    catch (error) { result.errors.push(String(error)); exit ||= 2 }
    if (order !== undefined) {
      try {
        const path = join(out, name, `${browser}-run.json`), completed = JSON.parse(readFileSync(path, 'utf8'))
        Object.assign(result, { completion: { path, sha256: hash(path), status: completed.status, bundleSha256: completed.bundleSha256, rows: completed.totals?.rows, predictOnly: completed.predictOnly, measureFirst: completed.measureFirst, order: completed.order } })
        if (completed.status !== 'ok' || completed.order !== order || completed.predictOnly !== false || !completed.measureFirst || completed.totals?.rows !== manifest.cases) throw new Error('requires a successful complete own-native measure-first run')
      } catch (error) { result.errors.push(String(error)); exit ||= 2 }
    }
    result.durationMs = Date.now() - start; result.finishedAt = new Date().toISOString(); jobs.push(result)
    save(join(out, 'jobs.json'), { format: 'pretext-book-survey-jobs/1', browser, jobs })
    console.log(`[book survey] ${name}: exit ${result.exit}; ${result.durationMs}ms`)
  }
  try {
    lock = await operations.acquire(record.lockBrowser as AutomationBrowserKind)
    verifyFreeze(); Object.assign(record, { sourceVerifiedAfterLockAt: new Date().toISOString() })
    for (const [role, predictor] of [['main', 'book-main-predictor.ts'], ['redo', 'inspected-ranges-predictor.ts'], ['plain', 'plain-predictor.ts']]) for (const [order, flag] of [['forward', 'file'], ['reverse', 'reverse']]) await job(`${role}-${order}`, [
      'bun', join(root, 'rebuild/lab/run.ts'), `--browser=${browser}`, `--cases=${cases}`, `--predictor=${join(root, 'rebuild/lab/baselines', predictor!)}`, `--order=${flag}`, `--out=${join(out, `${role}-${order}`)}`, '--measure-first', '--chunk=1',
    ], flag)
    const reportDir = join(out, 'survey-check'), reportPath = join(reportDir, 'report.json')
    await job('check', ['bun', join(root, 'rebuild/tests/check-book-survey.ts'), `--catalog=${catalog}`, ...['main', 'redo', 'plain'].flatMap(role => ['forward', 'reverse'].map(order => `--${role}-${order}=${join(out, `${role}-${order}`, `${browser}-rows.ndjson`)}`)), `--out=${reportDir}`])
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      if (report.format !== 'pretext-fresh-own-main-book-survey/1' || report.browser !== browser || report.completeObservedPopulation !== true || report.counts?.surveyed !== manifest.cases || !Array.isArray(report.cases) || report.cases.length !== manifest.cases || report.inputs?.manifestSha256 !== inputs[0]!.sha256 || report.inputs?.casesSha256 !== inputs[1]!.sha256) throw new Error('checker report missing or incomplete')
      if (report.ok === true && !(report.counts.certifiedVisible > 0)) throw new Error('green checker report has no own-main certifications')
      if (report.ok !== true) exit ||= 1
      Object.assign(record, { report: { path: reportPath, sha256: hash(reportPath), ok: report.ok } })
    } catch (error) { Object.assign(record, { error: String(error) }); exit ||= 2 }
    verifyFreeze(); Object.assign(record, { sourceVerifiedAfterJobsAt: new Date().toISOString() })
    record.exit = exit
    record.adoptable = exit === 0
    save(join(out, 'jobs.json'), { format: 'pretext-book-survey-jobs/1', browser, completed: true, status: exit === 0 ? 'ok' : 'error', exit, jobs })
  } catch (error) { record.exit = exit || 2; Object.assign(record, { error: String(error) }); console.error(String(error)) }
  finally { lock?.release(); save(join(out, 'workflow.json'), { ...record, finishedAt: new Date().toISOString() }) }
  return record.exit ?? 2
}

if (import.meta.main) {
  try { process.exit(await runBookSurvey(parseOptions(process.argv.slice(2)))) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
}
