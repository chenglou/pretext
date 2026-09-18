// Tier 2: the tiers' sets in one pinned browser (rebuild/lab/README.md, "Test tiers").
//
//   bun rebuild/tests/browser-sets.ts --browser=chrome|firefox|webkit-host --out=<dir> [--config=no-facts|facts]
//     [--sets=<name>[,...]] [--groups=smoke,development,families,heldout] [--both-orders] [--record] [--measure-first]
//     [--ids-file=<file>] [--reference=<ledger dir>] [--baseline=<gate file>] [--seed --staging=<dir>] [--rerun-failed]
//
// Don't wrap it in the browser lock: every browser job takes the lock itself. What it does, in order:
// 1. Reads the build of the app it will launch (the pinned copy of Chrome or Firefox, the system WebKit for webkit-host)
//    and refuses, before any browser time is spent, when the reference ledger or the baseline was observed under another
//    build: statuses of two builds never meet (exit 2; pin the new build and seed a reference for it, TESTS.md §12).
// 2. Runs every part of every selected set as one run.ts job, in a fresh browser process, three at a time (the lock's
//    slots), in file order, and with --both-orders also reversed. Parts and cases per round trip are the protocol in
//    sets.ts. --record adds run.ts --record-measurements to the forward jobs, for tier 1's inputs (replay.ts pack).
//    A failed job is never run again: the command stops and names its log; fix the cause, then --rerun-failed runs the
//    failed jobs once more (their folders are renamed, not removed). Jobs that finished are kept, so the command resumes.
// 3. Scores every part with lab/score.ts, the forward order against the reverse one under --both-orders.
// 4. Builds the run's ledger (ledger.ts) in <out>/ledger. A forward-only run takes the reference's history-dependent cases.
// 5. With a reference ledger (default .artifacts/tests/reference/<browser>-<config>/ledger when it exists): prints the
//    status transitions, grouped by family and condition.
// 6. With a baseline (default rebuild/tests/baselines/sets/<browser>-<engine build>-<config>.json when it exists): checks
//    the runs against it through lab/gate.ts. --seed --staging=<dir> stages a new seed with its seed record instead; like
//    every seed it is never written over the baseline it replaces (lab README, "Seeds go to a staging folder").
// Exit 1 when the gate loses a pair or a pass became a failure; exit 2 when a job failed or results aren't comparable.
//
// --measure-first runs every job under run.ts --measure-first (lab README "Measure first"): per document every case is
// predicted before the document's first native layout, as an application measures. It is another protocol, recorded in the
// ledger's sets, so the transitions against the reference are printed knowingly across protocols, and the gate, whose seeds
// describe the usual protocol, isn't run. compare-sets.ts compares its rows with a usual run's, case by case.
//
// --ids-file runs only the listed cases (tier 1 routes cases here): each part's subset keeps the part's order, but not
// its history, so the run's sets are marked `subset`, its ledger isn't checked for missing cases, and the gate isn't run.
import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { readBuild } from '../lab/browser-build.ts'
import { appliesTo, readCaseLines, writeCaseLines } from '../lab/cases/parts.ts'
import { checkRuns, formatBaseline, parseBaseline, readRun, runProblems, seedBaseline, seedRecord, stagedPath, type Engine } from '../lab/gate.ts'
import { existingRows } from '../lab/rows.ts'
import { buildLedger, printTransitions, readLedger, transitionsBetween, writeLedger, METRIC_NAMES, type SetsRun } from './ledger.ts'
import { CONFIGS, PREDICTORS, REPO, TIER_BROWSERS, partFiles, selectSets, setProtocol, type Config, type TestSet, type TierBrowser } from './sets.ts'

const LOCK = join(REPO, '.artifacts/session/with-browser-lock.py')
const ENGINES: Record<TierBrowser, Engine> = { chrome: 'blink', firefox: 'gecko', 'webkit-host': 'webkit' }

function fail(text: string): never {
  console.error(`[browser-sets] ${text}`)
  process.exit(2)
}

const options = new Map<string, string>()
const flags = new Set<string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
  if (match === null) fail(`Unknown argument ${raw}`)
  const name = match[1]!
  if (['both-orders', 'record', 'seed', 'rerun-failed', 'measure-first'].includes(name) && match[2] === undefined) flags.add(name)
  else if (['browser', 'out', 'config', 'sets', 'groups', 'ids-file', 'reference', 'baseline', 'staging'].includes(name) && match[2] !== undefined) options.set(name, match[2])
  else fail(`Unknown argument ${raw}`)
}
const browser = options.get('browser') as TierBrowser | undefined
if (browser === undefined || !TIER_BROWSERS.includes(browser)) fail('--browser must be chrome, firefox or webkit-host')
const config = (options.get('config') ?? 'no-facts') as Config
if (!CONFIGS.includes(config)) fail('--config must be no-facts or facts')
const outDir = resolve(options.get('out') ?? fail('--out is required'))
const bothOrders = flags.has('both-orders')
const measureFirst = flags.has('measure-first')
if (measureFirst && (flags.has('record') || flags.has('seed'))) fail('--measure-first goes with neither --record (a record is per case, in one pass) nor --seed (seeds describe the usual protocol)')
const moreRunArgs = measureFirst ? ['--measure-first'] : []
let sets: TestSet[]
try {
  sets = selectSets(browser, options.get('sets'), options.get('groups'))
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
if (sets.length === 0) fail('No set selected')
const wantedIds = options.get('ids-file') === undefined ? null : new Set(readFileSync(resolve(options.get('ids-file')!), 'utf8').split(/[\s,]+/).filter(id => id !== ''))
const started = Date.now()
const log = (text: string): void => console.log(`[browser-sets ${browser} ${config} +${Math.round((Date.now() - started) / 1000)}s] ${text}`)

// ---- 1. The build ----

const build = readBuild(browser)
const referenceDir = options.get('reference') !== undefined ? resolve(options.get('reference')!) : join(REPO, `.artifacts/tests/reference/${browser}-${config}/ledger`)
const reference = existsSync(join(referenceDir, 'ledger.json')) ? readLedger(referenceDir) : null
if (options.get('reference') !== undefined && reference === null) fail(`${referenceDir} holds no ledger`)
if (reference !== null && JSON.stringify(reference.header.build) !== JSON.stringify(build)) {
  fail(`The reference ledger ${relative(REPO, referenceDir)} was observed under ${JSON.stringify(reference.header.build)}; the app this run would launch is ${JSON.stringify(build)}. A browser or OS build moved: pin the new build, derive the families and seed a reference for it (rebuild/TESTS.md §12). Nothing ran.`)
}
const baselinePath = options.get('baseline') !== undefined ? resolve(options.get('baseline')!) : join(REPO, `rebuild/tests/baselines/sets/${browser}-${build.engine}-${config}.json`)

// ---- 2. Browser jobs ----

type Order = 'forward' | 'reverse'
type Job = { set: TestSet; part: number; order: Order; cases: string; dir: string; name: string }
const jobs: Job[] = []
// The commit the run starts at, and what differs from it under the library and the lab: what the rows describe.
// `git status --porcelain` lines are two status columns, a space and the path.
const library = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain', '--', 'rebuild/src', 'rebuild/lab'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(line => line.length > 3).map(line => line.slice(3)),
}
const runRecord: SetsRun = { browser, config, predictor: PREDICTORS[config], build, orders: bothOrders ? 'both' : 'forward', library, sets: [] }
mkdirSync(outDir, { recursive: true })
for (const set of sets) {
  const files = partFiles(set, browser)
  const parts: SetsRun['sets'][number]['parts'] = []
  for (let k = 0; k < files.length; k++) {
    let cases = files[k]!
    if (wantedIds !== null) {
      const lines = readCaseLines(cases).filter(line => appliesTo(line, browser) && wantedIds.has(line.id))
      if (lines.length === 0) continue
      cases = join(outDir, 'cases', `${set.name}-part${k}.ndjson`)
      mkdirSync(join(outDir, 'cases'), { recursive: true })
      writeCaseLines(cases, lines)
    }
    const dirOf = (order: Order): string => join(outDir, 'runs', set.name, order, `part${k}`)
    jobs.push({ set, part: k, order: 'forward', cases, dir: dirOf('forward'), name: `${set.name}-${k}-forward` })
    if (bothOrders) jobs.push({ set, part: k, order: 'reverse', cases, dir: dirOf('reverse'), name: `${set.name}-${k}-reverse` })
    parts.push({ part: k, forward: relative(REPO, dirOf('forward')), reverse: bothOrders ? relative(REPO, dirOf('reverse')) : null })
  }
  if (parts.length > 0) runRecord.sets.push({ name: set.name, protocol: setProtocol(set, browser, moreRunArgs), subset: wantedIds !== null, parts })
}
if (jobs.length === 0) fail('No case selected')

type JobState = 'ok' | 'failed' | 'absent'
function jobState(job: Job): JobState {
  const record = join(job.dir, `${browser}-run.json`)
  if (existsSync(record)) {
    try {
      if ((JSON.parse(readFileSync(record, 'utf8')) as { status?: string }).status === 'ok') return 'ok'
    } catch {
      // An unreadable record is a failed job.
    }
    return 'failed'
  }
  return existsSync(join(job.dir, 'run.log')) ? 'failed' : 'absent'
}

function runJob(job: Job): Promise<number> {
  mkdirSync(job.dir, { recursive: true })
  const args = [LOCK, `sets-${browser}-${config}-${job.name}`, '--max-wait-min=240', '--', 'bun', 'rebuild/lab/run.ts', `--browser=${browser}`, `--cases=${job.cases}`, `--out=${job.dir}`,
    `--order=${job.order === 'forward' ? 'file' : 'reverse'}`, `--predictor=${join(REPO, PREDICTORS[config])}`, ...job.set.runArgs, ...moreRunArgs]
  if (flags.has('record') && job.order === 'forward') args.push('--record-measurements')
  const out = createWriteStream(join(job.dir, 'run.log'))
  const from = Date.now()
  return new Promise(done => {
    const child = spawn('python3', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('close', code => {
      out.end()
      jobMs[job.name] = Date.now() - from
      done(code ?? 1)
    })
  })
}

async function pool<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(width, items.length); w++) workers.push((async () => { while (next < items.length) await work(items[next++]!) })())
  await Promise.all(workers)
}

const jobMs: Record<string, number> = {}
const failedBefore = jobs.filter(job => jobState(job) === 'failed')
if (failedBefore.length > 0) {
  if (!flags.has('rerun-failed')) fail(`${failedBefore.length} jobs failed in an earlier call (${failedBefore.map(job => job.name).join(', ')}); read ${relative(REPO, failedBefore[0]!.dir)}/run.log, fix the cause, then pass --rerun-failed to run them once more`)
  for (const job of failedBefore) renameSync(job.dir, `${job.dir}.failed-${Date.now()}`)
}
const toRun = jobs.filter(job => jobState(job) === 'absent')
log(`${jobs.length} jobs over ${runRecord.sets.length} sets (${jobs.length - toRun.length} already done); ${build.app} ${build.appVersion}, engine ${build.engine}, macOS ${build.os}`)
const runFrom = Date.now()
const failed: Job[] = []
await pool(toRun, 3, async job => {
  const code = await runJob(job)
  if (code !== 0 || jobState(job) !== 'ok') failed.push(job)
})
const runMs = Date.now() - runFrom
if (failed.length > 0) {
  for (const job of failed) console.error(`[browser-sets] job ${job.name} failed; log: ${relative(REPO, join(job.dir, 'run.log'))}\n${readFileSync(join(job.dir, 'run.log'), 'utf8').trimEnd().split('\n').slice(-6).map(line => `    ${line}`).join('\n')}`)
  fail(`${failed.length} of ${toRun.length} jobs failed. Nothing runs again: fix the cause, then pass --rerun-failed`)
}
// A call that only resumes (every job was done) keeps the library the jobs ran under, which the first call recorded.
const recordPath = join(outDir, 'sets-run.json')
if (toRun.length === 0 && existsSync(recordPath)) {
  const earlier = (JSON.parse(readFileSync(recordPath, 'utf8')) as SetsRun).library
  if (earlier !== undefined) runRecord.library = earlier
}
writeFileSync(recordPath, `${JSON.stringify(runRecord, null, 2)}\n`)

// ---- 3. Scoring ----

function scoreJob(job: Job): Promise<number> {
  const other = bothOrders ? join(outDir, 'runs', job.set.name, job.order === 'forward' ? 'reverse' : 'forward', `part${job.part}`, `${browser}-rows.ndjson`) : null
  const args = ['rebuild/lab/score.ts', `--rows=${join(job.dir, `${browser}-rows.ndjson`)}`, `--cases=${job.cases}`, `--out=${join(job.dir, `${browser}-summary.json`)}`,
    `--per-case=${join(job.dir, `${browser}-per-case.ndjson`)}`, '--examples=5', ...(other === null ? [] : [`--native-compare=${other}`])]
  const out = createWriteStream(join(job.dir, 'score.log'))
  return new Promise(done => {
    const child = spawn('bun', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('close', code => {
      out.end()
      done(code ?? 1)
    })
  })
}
const scoreFrom = Date.now()
const unscored: Job[] = []
// Suite samples hold the long paragraphs; four scorers at once stay far below the memory the watchdog allows.
await pool(jobs, 4, async job => {
  if (existingRows(join(job.dir, `${browser}-rows.ndjson`)) === null) fail(`${relative(REPO, job.dir)} holds no rows`)
  if ((await scoreJob(job)) !== 0) unscored.push(job)
})
const scoreMs = Date.now() - scoreFrom
if (unscored.length > 0) fail(`score.ts failed on ${unscored.map(job => job.name).join(', ')}; see score.log in each job's folder`)

// ---- 4 and 5. The ledger and its transitions ----

const ledgerFrom = Date.now()
const ledgerDir = join(outDir, 'ledger')
const ledger = buildLedger(outDir, reference === null ? null : referenceDir)
writeLedger(ledgerDir, ledger)
log(`ledger ${relative(REPO, ledgerDir)}: ${ledger.entries.length} cases, scorer ${ledger.header.scorer}, ${ledger.header.bundles.length} library bundle${ledger.header.bundles.length === 1 ? '' : 's'}`)
for (const metric of METRIC_NAMES) console.log(`  ${metric.padEnd(9)} ${Object.entries(ledger.header.counts[metric]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([kind, n]) => `${kind} ${n}`).join(', ')}`)
let exit = 0
if (ledger.header.bundles.length > 1) {
  console.error('[browser-sets] the jobs ran more than one library bundle: the library changed during the run, so its rows describe no single library')
  exit = 2
}
if (reference !== null) {
  console.log(`transitions against ${relative(REPO, referenceDir)}${measureFirst ? ' (the usual protocol; this run measured first)' : ''}:`)
  const report = transitionsBetween(reference, ledger, measureFirst ? ['protocol'] : [])
  writeFileSync(join(outDir, 'transitions.json'), `${JSON.stringify(report, null, 2)}\n`)
  printTransitions(report)
  if (report.comparable.length > 0) exit = 2
  else if (report.blocking > 0) exit = Math.max(exit, 1)
}

// ---- 6. The gate ----

const perCaseFiles = jobs.map(job => join(job.dir, `${browser}-per-case.ndjson`))
if (measureFirst) {
  log('measure first: the gate, whose seeds describe the usual protocol, did not run')
} else if (wantedIds === null && (flags.has('seed') || existsSync(baselinePath))) {
  const runs = perCaseFiles.map(readRun)
  const engine = ENGINES[browser]
  if (flags.has('seed')) {
    const problems = runProblems(engine, runs, { allowUncompared: false, environments: null })
    if (problems.length > 0) fail(`The runs can't seed a baseline (a seed needs both orders):\n${problems.join('\n')}`)
    const staged = stagedPath(baselinePath, options.get('staging'))
    const seed = seedBaseline(runs, { engine, engineVersion: build.engine, note: `tier 2 sets, ${config}, ${build.app} ${build.appVersion}, macOS ${build.os}; sets ${runRecord.sets.map(set => set.name).join(', ')}` })
    const before = existsSync(baselinePath) ? parseBaseline(readFileSync(baselinePath, 'utf8'), baselinePath) : null
    const record = seedRecord(before, seed, runs, { staged: relative(REPO, staged), against: relative(REPO, baselinePath) })
    mkdirSync(resolve(staged, '..'), { recursive: true })
    writeFileSync(staged, formatBaseline(seed))
    writeFileSync(`${staged.replace(/\.json$/, '')}.seed-record.json`, `${JSON.stringify(record, null, 2)}\n`)
    log(`staged ${relative(REPO, staged)} (not adopted): ${seed.counts.cases} cases, pass pairs ${JSON.stringify(seed.counts.passPairs)}, ${seed.counts.historyDependentCases} history-dependent, ${seed.counts.unstablePairs} unstable pairs${before === null ? '' : `; against the adopted seed ${record.lost.length} pairs lost, ${record.gained.length} gained, ${record.leftThroughHistory.length} left through history dependence`}`)
  } else {
    const baseline = parseBaseline(readFileSync(baselinePath, 'utf8'), baselinePath)
    const problems = runProblems(engine, runs, { allowUncompared: !bothOrders, environments: baseline.environments })
    if (problems.length > 0) {
      console.error(`[browser-sets] the gate refuses the runs against ${relative(REPO, baselinePath)}:\n${[...new Set(problems.map(problem => problem.replace(/^[^:]+: /, '')))].join('\n')}`)
      exit = 2
    } else {
      // A run of some sets isn't missing the others' cases, so completeness is asked only of a run of every set.
      const report = checkRuns(baseline, runs, { complete: options.get('sets') === undefined && options.get('groups') === undefined })
      writeFileSync(join(outDir, 'gate.json'), `${JSON.stringify(report, null, 2)}\n`)
      log(`gate against ${relative(REPO, baselinePath)}: lost ${report.counts.lostPairs}, new ${report.counts.newPairs}, history-dependent ${report.counts.historyDependentCases}, unstable ${report.counts.unstablePairs}, missing ${report.counts.missingCases} cases: ${report.ok ? 'pass' : 'FAIL'}`)
      for (const lost of report.lost.slice(0, 20)) console.log(`  lost ${lost.id} ${lost.family} ${lost.metric}: ${lost.status}${lost.reason === null ? '' : ` (${lost.reason})`}`)
      if (!report.ok) exit = Math.max(exit, 1)
    }
  }
} else if (wantedIds === null) {
  log(`no baseline at ${relative(REPO, baselinePath)}: the gate didn't run (stage one with --both-orders --seed --staging=<dir>)`)
}

const timing = { browser, config, orders: runRecord.orders, recorded: flags.has('record'), jobs: jobs.length, jobsRun: toRun.length, cases: ledger.entries.length, runMs, scoreMs, ledgerAndGateMs: Date.now() - ledgerFrom, totalMs: Date.now() - started, jobMs }
writeFileSync(join(outDir, 'timing.json'), `${JSON.stringify(timing, null, 2)}\n`)
log(`done: browser jobs ${Math.round(runMs / 1000)} s, scoring ${Math.round(scoreMs / 1000)} s, ledger and gate ${Math.round(timing.ledgerAndGateMs / 1000)} s`)
process.exit(exit)
