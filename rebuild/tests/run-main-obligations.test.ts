// Fake child processes exercise workflow sequencing, completion and exit propagation; no browser or real lock runs.
import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseOptions, runJobs, runWorkflow, type Options } from './run-main-obligations.ts'

const scratch: string[] = []
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }) })
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value))
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
function fixture(browser: Options['browser'] = 'chrome') {
  const root = mkdtempSync(join(tmpdir(), 'pretext-fast-workflow-')); scratch.push(root)
  const catalog = join(root, 'catalog'), audit = join(root, 'audit'), out = join(root, 'out')
  mkdirSync(catalog); mkdirSync(audit); mkdirSync(join(root, 'rebuild/tests'), { recursive: true }); mkdirSync(join(root, 'rebuild/lab'))
  const source = ['rebuild/lab/score.ts', 'rebuild/tests/check-main-obligations.ts', 'rebuild/tests/audit-main-obligations.ts']
  for (const file of source) writeFileSync(join(root, file), '// acceptance source\n')
  for (const file of ['rebuild/src/engines/gecko/context.ts', 'rebuild/lab/baselines/inspected-ranges-predictor.ts', 'rebuild/tests/main-obligations.ts', 'rebuild/tests/sets.ts', 'rebuild/tests/ledger.ts', 'rebuild/tests/known-tail.ts', 'src/measurement.ts', 'scripts/browser-automation.ts', 'shared/navigation-state.ts', 'package.json', 'tsconfig.json', '.artifacts/webkit-host/webkit-host']) {
    mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), file.endsWith('.json') ? '{}' : '// dependency\n')
  }
  mkdirSync(join(root, 'tests/wrapping/fonts'), { recursive: true }); json(join(root, 'tests/wrapping/fonts/fonts.json'), [{ file: 'fixture.ttf' }]); writeFileSync(join(root, 'tests/wrapping/fonts/fixture.ttf'), 'font bytes')
  json(join(audit, 'manifest.json'), { format: 'pretext-main-native-audit/1', browser, complete: true, scorerSha256: hash(join(root, source[0]!)), rangeEvaluatorSha256: hash(join(root, source[1]!)), auditorSha256: hash(join(root, source[2]!)) })
  writeFileSync(join(catalog, 'fast-cases.ndjson'), '{"id":"one","family":"test"}\n')
  writeFileSync(join(catalog, 'fast-obligations.ndjson'), JSON.stringify({ id: 'one', family: 'test', required: { lineCount: 'pass', visibleBreaks: 'pass' }, mainEvidence: { status: 'verified', audit: { required: true, evaluation: { lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' } } } } }) + '\n')
  json(join(catalog, 'manifest.json'), { format: 'pretext-main-native-obligations/2', browser, selectedPopulationComplete: true, auditSource: { path: audit, manifestSha256: hash(join(audit, 'manifest.json')) }, selection: { excludesByOriginOrGapsOrRebuildOutcomeOrHistory: false }, counts: { fast: 1, certifiedRequired: 1, pendingCertification: 0 }, outputs: ['fast-cases.ndjson', 'fast-obligations.ndjson'].map(file => ({ file, sha256: hash(join(catalog, file)) })) })
  const options: Options = { browser, catalog, out, mainComparison: false }
  return { root, out, catalog, audit, options }
}

// Each requested job is still a separate OS process. It writes its PID and exercises an actual nonzero child exit.
function fakeProcesses(options: Options, failures: Record<string, number> = {}, report: 'pass' | 'fail' | 'missing' = 'pass', before?: () => void) {
  return async (command: string[], log: string, cwd: string) => {
    before?.()
    const name = log.slice(log.lastIndexOf('/') + 1, -4)
    const code = failures[name] ?? 0
    const body = `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,name:${JSON.stringify(name)},command:${JSON.stringify(command)},cwd:${JSON.stringify(cwd)}}));
${name === 'check' && report !== 'missing' ? `writeFileSync(${JSON.stringify(join(options.out, 'fresh-check.json'))},JSON.stringify({format:'pretext-fresh-main-obligations/1',ok:${report === 'pass'},counts:{obligations:1},cases:[{status:${JSON.stringify(report === 'pass' ? 'pass' : 'fail')}}],unexpected:[]}));` : ''}
process.exit(${code});`
    return await Bun.spawn(['bun', '-e', body], { cwd, stdout: 'ignore', stderr: 'ignore' }).exited
  }
}

function operations(f: ReturnType<typeof fixture>, run: ReturnType<typeof fakeProcesses>, events: string[]) {
  let held = false
  return {
    async acquire(browser: 'chrome' | 'safari' | 'firefox') {
      events.push(`acquire:${browser}`); held = true
      return { release() { events.push('release'); held = false } }
    },
    async execute(command: string[], log: string, cwd: string) {
      expect(held).toBe(true); expect(cwd).toBe(f.root)
      events.push('child'); return await run(command, log, cwd)
    },
  }
}

test('strict CLI selects the browser/catalog/new output and optional diagnostic only', () => {
  expect(parseOptions(['--browser=firefox', '--catalog=/tmp/catalog', '--out=/tmp/out', '--main-comparison'])).toEqual({ browser: 'firefox', catalog: '/tmp/catalog', out: '/tmp/out', mainComparison: true })
  for (const args of [[], ['--browser=safari', '--catalog=/tmp/a', '--out=/tmp/b'], ['--browser=chrome', '--catalog=/tmp/a'], ['--browser=chrome', '--catalog=/tmp/a', '--out=/tmp/b', '--browser=firefox'], ['--browser=chrome', '--catalog=/tmp/a', '--out=/tmp/b', '--force']]) expect(() => parseOptions(args)).toThrow()
})

test('one canonical lock encloses four fresh native jobs plus checker', async () => {
  const f = fixture('webkit-host'), events: string[] = []
  expect(await runWorkflow(f.options, operations(f, fakeProcesses(f.options), events), f.root)).toBe(0)
  expect(events).toEqual(['acquire:safari', ...Array(5).fill('child'), 'release'])
  const jobs = read(join(f.out, 'jobs.json'))
  expect(jobs.jobs.map((job: { job: string }) => job.job)).toEqual(['redo-forward', 'redo-reverse', 'plain-forward', 'plain-reverse', 'check'])
  const logs = jobs.jobs.map((job: { log: string }) => read(job.log))
  expect(new Set(logs.map((log: { pid: number }) => log.pid)).size).toBe(5)
  for (const log of logs.slice(0, 4)) { expect(log.command).toContain('--measure-first'); expect(log.command).not.toContain('--predict-only') }
  for (const log of logs.slice(0, 2)) expect(log.command).toContain(`--predictor=${join(f.root, 'rebuild/lab/baselines/inspected-ranges-predictor.ts')}`)
  for (const log of logs.slice(2, 4)) expect(log.command).toContain(`--predictor=${join(f.root, 'rebuild/lab/baselines/plain-predictor.ts')}`)
  expect(logs[1].command).toContain('--order=reverse'); expect(logs[3].command).toContain('--order=reverse')
  const workflow = read(join(f.out, 'workflow.json'))
  expect(jobs.completed).toBe(true); expect(workflow.exit).toBe(0)
  expect(workflow.redoScope).toContain('lab expected observation')
  expect(workflow.sources.some((source: { path: string }) => source.path === join(f.root, 'rebuild/lab/baselines/inspected-ranges-predictor.ts'))).toBe(true)
  expect(workflow.sourceVerifiedAfterLockAt).toBeString(); expect(workflow.sourceVerifiedAfterJobsAt).toBeString(); expect(workflow.adoptable).toBe(true)
  expect(workflow.sources.some((source: { path: string }) => source.path === join(f.root, 'rebuild/src/engines/gecko/context.ts'))).toBe(true)
})

test('optional main jobs have fresh processes and predict-only diagnostic arguments', async () => {
  const f = fixture(); f.options.mainComparison = true
  mkdirSync(f.out)
  expect(await runJobs(f.options, fakeProcesses(f.options), f.root)).toBe(0)
  const jobs = read(join(f.out, 'jobs.json')).jobs
  expect(jobs.map((job: { job: string }) => job.job)).toEqual(['redo-forward', 'redo-reverse', 'plain-forward', 'plain-reverse', 'main-forward', 'main-reverse', 'check'])
  for (const job of jobs.slice(4, 6)) { expect(job.command).toContain('--predict-only'); expect(job.command).not.toContain('--measure-first') }
  expect(jobs[6].command).toContain(`--main-forward=${join(f.out, 'main-forward', 'chrome-rows.ndjson')}`)
})

test('all actual child failures accumulate and the first nonzero exit survives a successful checker', async () => {
  const f = fixture(), events: string[] = []
  expect(await runWorkflow(f.options, operations(f, fakeProcesses(f.options, { 'redo-reverse': 17, 'plain-forward': 3 }), events), f.root)).toBe(17)
  const jobs = read(join(f.out, 'jobs.json'))
  expect(jobs.jobs.map((job: { exit: number }) => job.exit)).toEqual([0, 17, 3, 0, 0])
  expect(jobs.status).toBe('error'); expect(events.at(-1)).toBe('release')
  expect(read(join(f.out, 'workflow.json')).exit).toBe(17)
})

test('checker nonzero, false report and missing completion report each block success', async () => {
  for (const [code, report, expected] of [[23, 'pass', 23], [0, 'fail', 1], [0, 'missing', 2]] as const) {
    const f = fixture(); mkdirSync(f.out)
    expect(await runJobs(f.options, fakeProcesses(f.options, { check: code }, report), f.root)).toBe(expected)
    expect(read(join(f.out, 'jobs.json')).status).toBe('error')
  }
})

test('zero-exit children without a completed checker report fail and release the lock', async () => {
  const f = fixture(), events: string[] = []
  const worker = operations(f, fakeProcesses(f.options), events)
  worker.execute = async (_command, log) => { events.push('child'); writeFileSync(log, 'worker did not complete'); return 0 }
  expect(await runWorkflow(f.options, worker, f.root)).toBe(2)
  expect(events.at(-1)).toBe('release'); expect(read(join(f.out, 'workflow.json')).exit).toBe(2)
})

test('existing output and uncertified/tampered input fail before locks or processes', async () => {
  for (const kind of ['existing', 'pending', 'tampered', 'changed scorer'] as const) {
    const f = fixture(), events: string[] = []
    if (kind === 'existing') { mkdirSync(f.out); writeFileSync(join(f.out, 'keep'), 'untouched') }
    else if (kind === 'pending') { const m = read(join(f.catalog, 'manifest.json')); m.auditSource = null; json(join(f.catalog, 'manifest.json'), m) }
    else if (kind === 'tampered') writeFileSync(join(f.catalog, 'fast-cases.ndjson'), '{"id":"other"}\n')
    else writeFileSync(join(f.root, 'rebuild/lab/score.ts'), '// changed acceptance\n')
    await expect(runWorkflow(f.options, operations(f, fakeProcesses(f.options), events), f.root)).rejects.toThrow()
    expect(events).toEqual([])
    if (kind === 'existing') expect(readFileSync(join(f.out, 'keep'), 'utf8')).toBe('untouched')
  }
})

test('lock acquisition and worker spawn failures retain provenance and cannot pass', async () => {
  const f = fixture()
  const failedLock = { async acquire(): Promise<{ release(): void }> { throw new Error('live lock timeout') }, execute: fakeProcesses(f.options) }
  expect(await runWorkflow(f.options, failedLock, f.root)).toBe(2)
  expect(read(join(f.out, 'workflow.json')).error).toContain('live lock timeout')
  const g = fixture(), events: string[] = []
  const spawnFailed = operations(g, fakeProcesses(g.options), events)
  spawnFailed.execute = async () => { throw new Error('worker spawn failed') }
  expect(await runWorkflow(g.options, spawnFailed, g.root)).toBe(2)
  expect(events.at(-1)).toBe('release'); expect(read(join(g.out, 'jobs.json')).jobs.every((job: { error: string }) => job.error.includes('worker spawn failed'))).toBe(true)
})


test('a zero-exit lab with a failed completion record is rejected by the actual checker CLI', async () => {
  const f = fixture(); mkdirSync(f.out)
  const run = async (command: string[], log: string, cwd: string) => {
    if (log.endsWith('/check.log')) {
      const child = Bun.spawn(['bun', join(import.meta.dir, 'check-main-obligations.ts'), ...command.slice(2)], { cwd, stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      writeFileSync(log, stdout + stderr)
      return exit
    }
    const out = command.find(arg => arg.startsWith('--out='))!.slice(6)
    const order = command.find(arg => arg.startsWith('--order='))!.slice(8)
    const body = `import {mkdirSync,writeFileSync} from 'node:fs'; mkdirSync(${JSON.stringify(out)});
writeFileSync(${JSON.stringify(join(out, 'chrome-rows.ndjson'))},'');
writeFileSync(${JSON.stringify(join(out, 'chrome-run.json'))},JSON.stringify({status:'error',errors:['probe/completion failed'],order:${JSON.stringify(order)},predictOnly:false,measureFirst:{documents:[]},totals:{rows:0}}));
writeFileSync(${JSON.stringify(log)},'lab exited zero despite its failed completion');`
    return await Bun.spawn(['bun', '-e', body], { cwd, stdout: 'ignore', stderr: 'ignore' }).exited
  }
  expect(await runJobs(f.options, run, f.root)).toBe(2)
  const jobs = read(join(f.out, 'jobs.json'))
  expect(jobs.jobs.map((job: { exit: number }) => job.exit)).toEqual([0, 0, 0, 0, 2])
  expect(jobs.completed).toBe(true); expect(jobs.status).toBe('error')
  expect(readFileSync(join(f.out, 'check.log'), 'utf8')).toContain('requires a successful forward native run')
})

test('actual child argument arrays preserve quoted paths and fresh fake lab CLIs', async () => {
  const f = fixture(); f.options.out = join(f.root, 'out space "quoted"')
  writeFileSync(join(f.root, 'rebuild/lab/run.ts'), `import {mkdirSync,writeFileSync} from 'node:fs';
const flags=new Map(process.argv.slice(2).map(arg=>{const split=arg.indexOf('=');return [arg.slice(2,split),arg.slice(split+1)];}));
mkdirSync(flags.get('out')!); writeFileSync(flags.get('out')!+'/fake-pid',String(process.pid));
console.log('fresh fake lab '+process.pid);`)
  writeFileSync(join(f.root, 'rebuild/tests/check-main-obligations.ts'), `import {writeFileSync} from 'node:fs';
const out=process.argv.find(arg=>arg.startsWith('--out='))!.slice(6);
writeFileSync(out,JSON.stringify({format:'pretext-fresh-main-obligations/1',ok:true,counts:{obligations:1},cases:[{status:'pass'}],unexpected:[]}));console.log('fake checker completed');`)
  const audit = read(join(f.audit, 'manifest.json')); audit.rangeEvaluatorSha256 = hash(join(f.root, 'rebuild/tests/check-main-obligations.ts')); json(join(f.audit, 'manifest.json'), audit)
  const manifest = read(join(f.catalog, 'manifest.json')); manifest.auditSource.manifestSha256 = hash(join(f.audit, 'manifest.json')); json(join(f.catalog, 'manifest.json'), manifest)
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
  expect(await runWorkflow(f.options, operations, f.root)).toBe(0); expect(held).toBe(false)
  const jobs = read(join(f.options.out, 'jobs.json')).jobs
  const pids = jobs.slice(0, 4).map((job: { job: string }) => readFileSync(join(f.options.out, job.job, 'fake-pid'), 'utf8'))
  expect(new Set(pids).size).toBe(4)
  expect(readFileSync(join(f.options.out, 'check.log'), 'utf8')).toContain('fake checker completed')
})

test('runtime additions/deletions, main-source, served font and catalog/audit drift during lock wait reject before capture', async () => {
  for (const kind of ['dependency', 'addition', 'deletion', 'main', 'font', 'host', 'catalog', 'audit'] as const) {
    const f = fixture(kind === 'host' ? 'webkit-host' : 'chrome'); f.options.mainComparison = true
    const core = join(f.root, 'rebuild/src/engines/gecko/context.ts'), events: string[] = []
    const path = kind === 'addition' ? join(f.root, 'rebuild/src/engines/gecko/context.js') : kind === 'main' ? join(f.root, 'src/measurement.ts') : kind === 'font' ? join(f.root, 'tests/wrapping/fonts/fixture.ttf') : kind === 'host' ? join(f.root, '.artifacts/webkit-host/webkit-host') : kind === 'catalog' ? join(f.catalog, 'fast-cases.ndjson') : kind === 'audit' ? join(f.audit, 'manifest.json') : core
    let captures = 0
    const worker = {
      async acquire() {
        const body = kind === 'deletion' ? `import {rmSync} from 'node:fs';rmSync(${JSON.stringify(path)})` : `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path)},'changed while waiting')`
        expect(await Bun.spawn(['bun', '-e', body], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
        return { release() { events.push('release') } }
      },
      async execute() { captures++; return 0 },
    }
    expect(await runWorkflow(f.options, worker, f.root)).toBe(2); expect(captures).toBe(0); expect(events).toEqual(['release'])
    const workflow = read(join(f.out, 'workflow.json'))
    expect(workflow.error).toMatch(/changed during workflow|ENOENT/); expect(workflow.adoptable).toBe(false); expect(workflow.sourceVerifiedAfterLockAt).toBeUndefined()
  }
})

test('post-capture lab dependency drift is checked after passing, strict-red and failed-child runs without hiding exits', async () => {
  for (const failure of [0, 17, 1] as const) {
    const f = fixture(), events: string[] = [], path = join(f.root, 'rebuild/lab/port-measure.ts')
    writeFileSync(path, '// original observer dependency\n')
    const run = fakeProcesses(f.options, failure === 17 ? { 'redo-reverse': 17 } : failure === 1 ? { check: 1 } : {}, failure === 1 ? 'fail' : 'pass')
    const worker = operations(f, async (command, log, cwd) => {
      const result = await run(command, log, cwd)
      if (log.endsWith('/redo-reverse.log')) expect(await Bun.spawn(['bun', '-e', `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path)},'changed between role pairs')`], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
      return result
    }, events)
    expect(await runWorkflow(f.options, worker, f.root)).toBe(failure || 2)
    const workflow = read(join(f.out, 'workflow.json'))
    expect(read(join(f.out, 'jobs.json')).jobs.map((job: { exit: number }) => job.exit)).toEqual([0, failure === 17 ? 17 : 0, 0, 0, failure === 1 ? 1 : 0])
    expect(workflow.error).toContain(path); expect(workflow.adoptable).toBe(false); expect(workflow.sourceVerifiedAfterLockAt).toBeString(); expect(workflow.sourceVerifiedAfterJobsAt).toBeUndefined(); expect(events.at(-1)).toBe('release')
  }
})

test('certified obligations changed by the checker child are rejected at the final freeze', async () => {
  const f = fixture(), run = fakeProcesses(f.options), path = join(f.catalog, 'fast-obligations.ndjson'), events: string[] = []
  const worker = operations(f, async (command, log, cwd) => {
    const result = await run(command, log, cwd)
    if (log.endsWith('/check.log')) expect(await Bun.spawn(['bun', '-e', `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(path)},'changed after checking')`], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0)
    return result
  }, events)
  expect(await runWorkflow(f.options, worker, f.root)).toBe(2)
  const workflow = read(join(f.out, 'workflow.json'))
  expect(workflow.error).toContain('catalog/audit inputs changed'); expect(workflow.adoptable).toBe(false); expect(events.at(-1)).toBe('release')
  expect(read(join(f.out, 'jobs.json')).jobs.every((job: { exit: number }) => job.exit === 0)).toBe(true)
})
