// Separate fake OS children exercise exits, own-native completion and canonical-lock lifetime without a browser.
import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseOptions, runBookSurvey, type Options } from './run-book-survey.ts'

const scratch: string[] = []
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }) })
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value))
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
function fixture(browser: Options['browser'] = 'chrome', count = 1) {
  const root = mkdtempSync(join(tmpdir(), 'pretext-book-workflow-')); scratch.push(root)
  const catalog = join(root, 'catalog'), out = join(root, 'out')
  mkdirSync(catalog)
  const files = ['rebuild/lab/run.ts', 'rebuild/lab/score.ts', 'rebuild/tests/check-main-obligations.ts', 'rebuild/tests/check-book-survey.ts', 'rebuild/tests/prepare-book-survey.ts', 'tests/wrapping/contracts.ts', 'rebuild/lab/baselines/book-main-predictor.ts', 'rebuild/lab/baselines/no-facts-predictor.ts', 'rebuild/lab/baselines/inspected-ranges-predictor.ts', 'rebuild/lab/baselines/plain-predictor.ts', 'rebuild/lab/baselines/main-predictor.ts', 'src/layout.ts']
  for (const file of files) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), '// source\n') }
  for (const file of ['rebuild/src/engines/gecko/context.ts', 'rebuild/tests/sets.ts', 'scripts/browser-automation.ts', 'shared/navigation-state.ts', 'shared/browser-environment.ts', 'package.json', 'tsconfig.json', 'tests/wrapping/types.ts', '.artifacts/webkit-host/webkit-host']) {
    mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), file.endsWith('.json') ? '{}' : '// dependency\n')
  }
  mkdirSync(join(root, 'tests/wrapping/fonts')); json(join(root, 'tests/wrapping/fonts/fonts.json'), [{ file: 'fixture.ttf' }]); writeFileSync(join(root, 'tests/wrapping/fonts/fixture.ttf'), 'font bytes')
  mkdirSync(join(root, 'corpora')); const original = join(root, 'corpora/test.txt'); writeFileSync(original, 'original book source\n')
  writeFileSync(join(catalog, 'cases.ndjson'), Array.from({ length: count }, (_, i) => JSON.stringify({ id: i === 0 ? 'one' : 'two', family: 'book/test/raw' })).join('\n') + '\n')
  json(join(catalog, 'manifest.json'), { format: 'pretext-book-survey-inputs/1', browser, cases: count, producerSha256: hash(join(root, files[4]!)), normalizerSha256: hash(join(root, files[5]!)), sources: [{ path: original, sha256: hash(original) }], outputs: [{ file: 'cases.ndjson', sha256: hash(join(catalog, 'cases.ndjson')) }], selection: { readsAnyOutcome: false, preparationLocale: 'default' } })
  return { root, catalog, out, options: { browser, catalog, out } as Options }
}
function report(f: ReturnType<typeof fixture>, ok = true) {
  const count = read(join(f.catalog, 'manifest.json')).cases as number
  return { format: 'pretext-fresh-own-main-book-survey/1', browser: f.options.browser, ok, completeObservedPopulation: true, counts: { surveyed: count, certifiedVisible: count }, inputs: { manifestSha256: hash(join(f.catalog, 'manifest.json')), casesSha256: hash(join(f.catalog, 'cases.ndjson')) }, cases: Array.from({ length: count }, (_, i) => ({ id: i === 0 ? 'one' : 'two', status: ok ? 'pass' : 'fail' })) }
}
function processes(f: ReturnType<typeof fixture>, failures: Record<string, number> = {}, completed: Record<string, unknown> | 'missing' | null = null, output: ReturnType<typeof report> | 'missing' = report(f)) {
  return async (command: string[], log: string, cwd: string) => {
    const name = log.slice(log.lastIndexOf('/') + 1, -4), code = failures[name] ?? 0
    const count = read(join(f.catalog, 'manifest.json')).cases as number
    const order = command.find(arg => arg.startsWith('--order='))?.slice(8)
    const path = join(f.out, name), run = { status: 'ok', order, predictOnly: false, measureFirst: { documents: [{ firstRow: 0, rows: count }] }, totals: { rows: count }, bundleSha256: name.split('-')[0] + '-bundle', ...(typeof completed === 'object' && completed !== null ? completed : {}) }
    const body = `import {mkdirSync,writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,name:${JSON.stringify(name)},command:${JSON.stringify(command)},cwd:${JSON.stringify(cwd)}}));
${name !== 'check' && completed !== 'missing' ? `mkdirSync(${JSON.stringify(path)}); writeFileSync(${JSON.stringify(join(path, `${f.options.browser}-run.json`))},JSON.stringify(${JSON.stringify(run)}));` : ''}
${name === 'check' && output !== 'missing' ? `mkdirSync(${JSON.stringify(join(f.out, 'survey-check'))}); writeFileSync(${JSON.stringify(join(f.out, 'survey-check/report.json'))},JSON.stringify(${JSON.stringify(output)}));` : ''}
process.exit(${code});`
    return await Bun.spawn(['bun', '-e', body], { cwd, stdout: 'ignore', stderr: 'ignore' }).exited
  }
}
function operations(f: ReturnType<typeof fixture>, run = processes(f), events: string[] = []) {
  let held = false
  return {
    async acquire(browser: 'chrome' | 'safari' | 'firefox') { events.push(`acquire:${browser}`); held = true; return { release() { events.push('release'); held = false } } },
    async execute(command: string[], log: string, cwd: string) { expect(held).toBe(true); return await run(command, log, cwd) },
  }
}

test('CLI requires a supported browser and new catalog/output paths without diagnostic bypasses', () => {
  expect(parseOptions(['--browser=firefox', '--catalog=/tmp/books', '--out=/tmp/new'])).toEqual({ browser: 'firefox', catalog: '/tmp/books', out: '/tmp/new' })
  for (const args of [[], ['--browser=safari', '--catalog=/tmp/a', '--out=/tmp/b'], ['--browser=chrome', '--catalog=/tmp/a'], ['--browser=chrome', '--catalog=/tmp/a', '--out=/tmp/b', '--browser=firefox'], ['--browser=chrome', '--catalog=/tmp/a', '--out=/tmp/b', '--predict-only']]) expect(() => parseOptions(args)).toThrow()
})

test('one canonical lock encloses six distinct own-native processes and the checker, with source/completion provenance', async () => {
  const f = fixture('webkit-host'), events: string[] = []
  expect(await runBookSurvey(f.options, operations(f, processes(f), events), f.root)).toBe(0)
  expect(events).toEqual(['acquire:safari', 'release'])
  const jobs = read(join(f.out, 'jobs.json')), workflow = read(join(f.out, 'workflow.json'))
  expect(jobs.jobs.map((job: { job: string }) => job.job)).toEqual(['main-forward', 'main-reverse', 'redo-forward', 'redo-reverse', 'plain-forward', 'plain-reverse', 'check'])
  const logs = jobs.jobs.map((job: { log: string }) => read(job.log))
  expect(new Set(logs.map((log: { pid: number }) => log.pid)).size).toBe(7)
  for (const log of logs.slice(0, 6)) { expect(log.command).toContain('--measure-first'); expect(log.command).toContain('--chunk=1'); expect(log.command).not.toContain('--predict-only') }
  expect(logs[0].command).toContain(`--predictor=${join(f.root, 'rebuild/lab/baselines/book-main-predictor.ts')}`)
  for (const log of logs.slice(2, 4)) expect(log.command).toContain(`--predictor=${join(f.root, 'rebuild/lab/baselines/inspected-ranges-predictor.ts')}`)
  for (const log of logs.slice(4, 6)) expect(log.command).toContain(`--predictor=${join(f.root, 'rebuild/lab/baselines/plain-predictor.ts')}`)
  expect(workflow.redoScope).toContain('lab expected observation')
  expect(workflow.sources.some((source: { path: string }) => source.path === join(f.root, 'rebuild/lab/baselines/inspected-ranges-predictor.ts'))).toBe(true)
  expect(logs[1].command).toContain('--order=reverse')
  expect(logs[6].command).toContain(`--main-forward=${join(f.out, 'main-forward/webkit-host-rows.ndjson')}`)
  expect(jobs.completed).toBe(true); expect(workflow.exit).toBe(0); expect(workflow.finishedAt).toBeString()
  expect(workflow.sources.some((source: { path: string }) => source.path.endsWith('/run-book-survey.ts'))).toBe(true)
  expect(workflow.sources.some((source: { path: string }) => source.path === join(f.root, 'rebuild/src/engines/gecko/context.ts'))).toBe(true)
  expect(workflow.sources.some((source: { path: string }) => source.path === join(f.root, '.artifacts/webkit-host/webkit-host'))).toBe(true)
  expect(workflow.sourceVerifiedAfterLockAt).toBeString(); expect(workflow.sourceVerifiedAfterJobsAt).toBeString(); expect(workflow.adoptable).toBe(true)
  for (const job of jobs.jobs.slice(0, 6)) expect(job.completion.sha256).toBe(hash(job.completion.path))
  expect(workflow.report.sha256).toBe(hash(join(f.out, 'survey-check/report.json')))
})

test('every actual child exit is retained and the first failure survives a passing checker', async () => {
  const f = fixture(), events: string[] = []
  expect(await runBookSurvey(f.options, operations(f, processes(f, { 'main-reverse': 17, 'plain-forward': 3 }), events), f.root)).toBe(17)
  expect(read(join(f.out, 'jobs.json')).jobs.map((job: { exit: number }) => job.exit)).toEqual([0, 17, 0, 0, 3, 0, 0])
  expect(read(join(f.out, 'workflow.json')).exit).toBe(17); expect(events.at(-1)).toBe('release')
})

test('zero-exit native processes with failed, missing, borrowed or incomplete completion records cannot pass', async () => {
  for (const completion of [{ status: 'error' }, 'missing', { predictOnly: true }, { order: 'shuffle' }, { totals: { rows: 0 } }] as const) {
    const f = fixture()
    expect(await runBookSurvey(f.options, operations(f, processes(f, {}, completion)), f.root)).toBe(2)
    const jobs = read(join(f.out, 'jobs.json'))
    expect(jobs.jobs.every((job: { exit: number }) => job.exit === 0)).toBe(true)
    expect(jobs.jobs[0].errors.length).toBeGreaterThan(0); expect(jobs.status).toBe('error')
  }
})

test('strict-red and missing/incomplete checker reports propagate instead of disappearing behind native zero exits', async () => {
  for (const [code, output, expected] of [[1, false, 1], [0, false, 1], [0, 'missing', 2], [0, 'incomplete', 2]] as const) {
    const f = fixture(), value = output === 'missing' ? 'missing' : { ...report(f, false), ...(output === 'incomplete' ? { completeObservedPopulation: false } : {}) }
    expect(await runBookSurvey(f.options, operations(f, processes(f, { check: code }, null, value)), f.root)).toBe(expected)
    expect(read(join(f.out, 'jobs.json')).completed).toBe(true); expect(read(join(f.out, 'jobs.json')).status).toBe('error')
  }
})

test('stable main failures may remain observed non-required when the strict checker certifies other passes', async () => {
  const f = fixture('chrome', 2), value = report(f)
  value.cases[0]!.status = 'observed-main-failure'
  value.counts.certifiedVisible = 1
  expect(await runBookSurvey(f.options, operations(f, processes(f, {}, null, value)), f.root)).toBe(0)
})

test('existing output, tampered inputs and changed default-locale production fail before the lock or child processes', async () => {
  for (const kind of ['existing', 'tampered', 'corpus', 'outcome-selection', 'locale', 'producer'] as const) {
    const f = fixture(), events: string[] = []
    if (kind === 'existing') { mkdirSync(f.out); writeFileSync(join(f.out, 'keep'), 'untouched') }
    else if (kind === 'tampered') writeFileSync(join(f.catalog, 'cases.ndjson'), '{"id":"changed"}\n')
    else if (kind === 'producer') writeFileSync(join(f.root, 'rebuild/tests/prepare-book-survey.ts'), '// changed\n')
    else if (kind === 'corpus') writeFileSync(join(f.root, 'corpora/test.txt'), 'changed original book source\n')
    else { const m = read(join(f.catalog, 'manifest.json')); if (kind === 'locale') m.selection.preparationLocale = 'forced'; else m.selection.readsAnyOutcome = true; json(join(f.catalog, 'manifest.json'), m) }
    await expect(runBookSurvey(f.options, operations(f, processes(f), events), f.root)).rejects.toThrow()
    expect(events).toEqual([])
    if (kind === 'existing') expect(readFileSync(join(f.out, 'keep'), 'utf8')).toBe('untouched')
  }
})

test('lock acquisition and individual spawn exceptions preserve provenance and release acquired locks', async () => {
  const f = fixture()
  expect(await runBookSurvey(f.options, { async acquire() { throw new Error('live lock timeout') }, execute: processes(f) }, f.root)).toBe(2)
  expect(read(join(f.out, 'workflow.json')).error).toContain('live lock timeout')
  const g = fixture(), events: string[] = [], run = processes(g)
  const execute = async (...args: Parameters<typeof run>) => { if (args[1].endsWith('/main-forward.log')) throw new Error('child spawn failed'); return await run(...args) }
  expect(await runBookSurvey(g.options, operations(g, execute, events), g.root)).toBe(2)
  const jobs = read(join(g.out, 'jobs.json'))
  expect(jobs.jobs.length).toBe(7); expect(jobs.jobs[0].exit).toBeNull(); expect(jobs.jobs[0].errors.join(' ')).toContain('child spawn failed')
  expect(events.at(-1)).toBe('release'); expect(read(join(g.out, 'workflow.json')).exit).toBe(2)
})

test('real fake lab/checker CLIs receive safely encoded paths, with no legacy scheduler dependency', async () => {
  const f = fixture(); f.options.out = join(f.root, 'out space "quoted"')
  writeFileSync(join(f.root, 'rebuild/lab/run.ts'), `import {mkdirSync,writeFileSync} from 'node:fs';
const flags=new Map(process.argv.slice(2).map(arg=>{const split=arg.indexOf('=');return [arg.slice(2,split),arg.slice(split+1)];}));
if(!process.argv.includes('--measure-first')||process.argv.includes('--predict-only'))process.exit(19);
const out=flags.get('out')!,browser=flags.get('browser')!;mkdirSync(out);
writeFileSync(out+'/fake-pid',String(process.pid));
writeFileSync(out+'/'+browser+'-run.json',JSON.stringify({status:'ok',order:flags.get('order'),predictOnly:false,measureFirst:{documents:[{firstRow:0,rows:1}]},totals:{rows:1},bundleSha256:'fake-bundle'}));
console.log('fresh fake lab '+process.pid);`)
  writeFileSync(join(f.root, 'rebuild/tests/check-book-survey.ts'), `import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.argv.find(arg=>arg.startsWith('--out='))!.slice(6);mkdirSync(out);
writeFileSync(out+'/report.json',JSON.stringify(${JSON.stringify(report(f))}));console.log('fake checker completed');`)
  let held = false
  const operations = {
    async acquire() { held = true; return { release() { held = false } } },
    async execute(command: string[], log: string, cwd: string) {
      expect(held).toBe(true)
      const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      writeFileSync(log, stdout + stderr); return exit
    },
  }
  expect(await runBookSurvey(f.options, operations, f.root)).toBe(0); expect(held).toBe(false)
  const jobs = read(join(f.options.out, 'jobs.json')).jobs
  const pids = jobs.slice(0, 6).map((job: { job: string }) => readFileSync(join(f.options.out, job.job, 'fake-pid'), 'utf8'))
  expect(new Set(pids).size).toBe(6)
  expect(readFileSync(join(f.options.out, 'check.log'), 'utf8')).toContain('fake checker completed')
})

test('edits, added/deleted runtime files and served font/catalog/corpus drift during lock wait reject before capture', async () => {
  for (const kind of ['dependency', 'addition', 'deletion', 'font', 'host', 'catalog', 'corpus'] as const) {
    const f = fixture(kind === 'host' ? 'webkit-host' : 'chrome'), core = join(f.root, 'rebuild/src/engines/gecko/context.ts'), events: string[] = []
    const path = kind === 'addition' ? join(f.root, 'rebuild/src/engines/gecko/context.js') : kind === 'font' ? join(f.root, 'tests/wrapping/fonts/fixture.ttf') : kind === 'host' ? join(f.root, '.artifacts/webkit-host/webkit-host') : kind === 'catalog' ? join(f.catalog, 'cases.ndjson') : kind === 'corpus' ? join(f.root, 'corpora/test.txt') : core
    let captures = 0
    const worker = {
      async acquire() {
        const body = kind === 'deletion' ? `import {rmSync} from 'node:fs';rmSync(${JSON.stringify(path)})` : `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path)},'changed while waiting')`
        expect(await Bun.spawn(['bun', '-e', body], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
        return { release() { events.push('release') } }
      },
      async execute() { captures++; return 0 },
    }
    expect(await runBookSurvey(f.options, worker, f.root)).toBe(2); expect(captures).toBe(0); expect(events).toEqual(['release'])
    const workflow = read(join(f.out, 'workflow.json'))
    expect(workflow.error).toMatch(/changed during workflow|ENOENT/); expect(workflow.adoptable).toBe(false); expect(workflow.sourceVerifiedAfterLockAt).toBeUndefined()
  }
})

test('post-capture source drift blocks adoption while preserving every actual exit, including strict-red and child failures', async () => {
  for (const failure of [0, 17, 1] as const) {
    const f = fixture(), events: string[] = [], path = join(f.root, 'src/layout.ts')
    const run = processes(f, failure === 17 ? { 'main-reverse': 17 } : failure === 1 ? { check: 1 } : {}, null, report(f, failure !== 1))
    const worker = operations(f, async (command, log, cwd) => {
      const result = await run(command, log, cwd)
      if (log.endsWith('/redo-reverse.log')) expect(await Bun.spawn(['bun', '-e', `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path)},'changed between role pairs')`], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
      return result
    }, events)
    expect(await runBookSurvey(f.options, worker, f.root)).toBe(failure || 2)
    const workflow = read(join(f.out, 'workflow.json')), jobs = read(join(f.out, 'jobs.json')).jobs
    expect(jobs.map((job: { exit: number }) => job.exit)).toEqual([0, failure === 17 ? 17 : 0, 0, 0, 0, 0, failure === 1 ? 1 : 0])
    expect(workflow.error).toContain(path); expect(workflow.adoptable).toBe(false); expect(workflow.sourceVerifiedAfterLockAt).toBeString(); expect(workflow.sourceVerifiedAfterJobsAt).toBeUndefined(); expect(events.at(-1)).toBe('release')
    expect(workflow.frozenInputs.some((input: { path: string }) => input.path === join(f.root, 'corpora/test.txt'))).toBe(true)
  }
})

test('original book input changed by the checker child is rejected at the final freeze', async () => {
  const f = fixture(), run = processes(f), path = join(f.root, 'corpora/test.txt')
  const worker = operations(f, async (command, log, cwd) => {
    const result = await run(command, log, cwd)
    if (log.endsWith('/check.log')) expect(await Bun.spawn(['bun', '-e', `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path)},'changed after checking')`], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
    return result
  })
  expect(await runBookSurvey(f.options, worker, f.root)).toBe(2)
  const workflow = read(join(f.out, 'workflow.json'))
  expect(workflow.error).toContain('catalog/corpus inputs changed'); expect(workflow.adoptable).toBe(false)
  expect(read(join(f.out, 'jobs.json')).jobs.every((job: { exit: number }) => job.exit === 0)).toBe(true)
})
