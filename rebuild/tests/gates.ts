// The offline gates in one command (rebuild/lab/README.md, "Test tiers"): every check that needs no browser, run side by
// side, with every exit code read from the child process itself and one table at the end.
//
//   bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all] [--quick] [--cores=N] [--no-wait]
//
// --quick is what to run after every small edit: tier 0 (`bunx tsc --noEmit` over the six projects, and the unit tests),
// tier 1 for the engine's browser in both configurations, and the function set's plain and pure checks for that browser.
// Without it the rest runs too: the function set's sweep, the painter differential, the citation ledger and, for Blink,
// the twin scan over Chrome's set files. --engine=all (the default) runs every browser's gates. Tier 2 needs a browser
// and stays its own command (browser-sets.ts).
//
// Every project's program holds files of all three engines (through src/index.ts), so tier 0 checks the six projects
// whatever the engine. The unit tests are the files `bun test rebuild` runs, a process a file, so the two slow files
// (ICU's likely subtags, the bidi conformance file) run beside the others; with one engine, --quick leaves out the files
// under the other two engines' folders, and the full form always runs them all.
//
// The table has a row per gate: its exit code, what the code means in words and which kind of step accepts it, the key
// counts of its report, and the time from the start of the run to the gate's result. A gate's output goes to
// rebuild/tests/.check/gates/<gate>.log, and the rows go to rebuild/tests/.check/gates/gates.json. A report is read only
// when the gate wrote it during this run, so a gate that fails before its report never shows an earlier run's counts.
//
// Exit 0 only when every gate is fine for a pure refactoring: a step that means to change no prediction and no Canvas
// question. Otherwise the worst of the gates' results, in this order:
//   1  behaviour changed or a check fails: a type error, a failing unit test, a changed prediction, a function-set case
//      that fails, a lost citation, a painting that differs, a tripped twin scan;
//   2  a gate's tool failed, so nothing is known of it: read its log;
//   5  rebuild/src/index.ts doesn't export the function set, so its checks ran on nothing;
//   4  tier 1: no prediction changed, but a case asks other questions or a new one. No step accepts it;
//   3  tier 1: no prediction changed, and cases dropped questions, which only a step that names what it drops accepts;
//      or the painter differential left cases unpainted, or a function-set check skipped cases, which tier 1 settles
//      first.
// Tier 1's own exit 3 is fine for a pure refactoring when no case dropped a question: questions asked more or less often
// (repeats only), or Chrome's string storage rule alone (replay.ts). Those cases still go to tier 2: the row says so, and
// the run's last line names how many cases are for tier 2, per tier 1 gate, so "every gate is fine" never reads as "done".
//
// Cores: every gate starts at once, and the gates share --cores (default: all but two) one child process at a time
// (cores.ts): a process of tier 0 takes a core, and a gate that replays shards asks for one before each child it starts.
// The cores go to the gates in the table's order, so the first rows' results come first and a gate's last children run
// beside the next gate's first. A quarter of the cores go to groups of long paragraphs first, whichever gate asks: they
// take up to two minutes each in the sweep and bound the run's end, so they start at once, and the other three quarters
// keep the order. (With every core open to them the sweep's long groups held tier 1's result back for seven minutes.)
// The socket is pretext-gates-<pid>.sock in the temporary folder. A run that is killed leaves its file, and listening fails
// on a path that exists, so a run first removes the socket files of processes that are gone (removeStaleSockets).
//
// A turn: the machine runs one full run and one --quick run at a time. Several full runs at once, each in its own
// worktree, took two to three times as long each (19 to 33 minutes at load averages of 80 to 160) and spoiled the timed
// benchmarks beside them. Before its first gate a run takes a ticket, <n>.json in .artifacts/tests/gates/queue, which
// every worktree shares: n is one more than the highest number there, and the ticket is a hard link to a finished draft,
// which fails when the name exists. So a ticket holds its pid, worktree, flags and time from the moment it exists, two
// runs never get one number, and tickets appear in the order of their numbers. A run starts when no ticket below its own
// is a live run's of its kind, first come, first served, and while it waits it says who holds the turn and how many wait
// before it. Nothing is ever taken over, so nothing is timed: a ticket is dead when its pid is gone, or is a process that
// started after the ticket was written (the machine reuses pids within hours, and a killed run's ticket stays until
// the next run looks); a run skips and removes the dead tickets below its own and leaves its own behind as the highest,
// so the numbers only go up. --no-wait takes no ticket, for a human who knows better. Measured with --quick
// --engine=gecko, 42 to 55 s alone: two at once took 115 and 120 s, one after the other 50 and 100 s, so --quick runs
// wait for each other; on half the cores each they took 74 and 76 s, which gives the second what it takes from the
// first and costs a run alone a quarter, so no run takes fewer cores instead of waiting. A --quick run and a full run
// don't wait for each other: beside a full run the --quick run took 123 s, and its wait would be six minutes on average.
//
// The type check is incremental: tsc keeps each project's state in node_modules/.cache/pretext-gates (untracked), keyed
// by the hash of every file's text, the compiler options and the compiler's version, and checks in full when the state is
// missing or doesn't fit. It prints the errors `bunx tsc --noEmit -p <project>` prints and exits 0 when that does; with
// errors tsc exits 2 when it found them in this run and 1 when it kept them from the last one.
import { closeSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { CONFIGS, REPO, SETS, partFiles, type Config, type TierBrowser } from './sets.ts'

const ENGINES = ['blink', 'webkit', 'gecko'] as const
type EngineName = typeof ENGINES[number]
const BROWSER_OF: Record<EngineName, TierBrowser> = { blink: 'chrome', webkit: 'webkit-host', gecko: 'firefox' }
const TSC_PROJECTS = ['rebuild', 'rebuild/lab', 'rebuild/tests', 'rebuild/probes', 'rebuild/lab/cases', 'rebuild/bench']
const OUT = join(REPO, 'rebuild/tests/.check/gates')
const TSC_STATE = join(REPO, 'node_modules/.cache/pretext-gates')
// The queue's tickets: in the .artifacts folder every worktree shares.
const SHARED = join(REPO, '.artifacts/tests/gates')

// What a gate's result counts as toward the exit code: 0 is fine for a pure refactoring.
export type Verdict = { counts: string; meaning: string; as: number }
// Tier 1's also says how many cases it sends to tier 2, which its exit 3 does even where it is fine for a pure refactoring.
export type Tier1Verdict = Verdict & { tier2: number }
type Gate = {
  name: string
  // One process a part, each the arguments after `bun`; the gate's exit code is its parts' largest. A sharded gate has
  // one part, which asks for its children's cores itself (cores.ts) and gets --jobs added.
  parts: string[][]
  sharded: boolean
  // The most children a sharded gate runs at once; absent when it can use every core.
  atMost?: number
  // The report the gate writes, or null when its log is all there is.
  report: string | null
  read: (code: number, report: unknown, log: string) => Verdict | Tier1Verdict
}
// `tier2`: the cases the gate sends to tier 2, which only a tier 1 gate does.
export type Row = { gate: string; exit: number; as: number; meaning: string; counts: string; tier2: number; wallSeconds: number; log: string }

const TOOL_FAILED = 'the tool failed, so nothing is known: read the log'
const lastLine = (log: string): string => log.trimEnd().split('\n').pop()!.slice(0, 160)

// ---- What each gate's exit code means ----

type Tier1Report = { counts: { cases: number; predictionChanged: number; repeatsOnly: number; droppedOnly: number; otherQuestions: number; newQuestion: number; unfaithful: number }; storage?: { cases: number }; needsBrowser: string[] }

export function tier1Verdict(code: number, report: Tier1Report | null): Tier1Verdict {
  if (report === null) return { counts: 'no report', meaning: TOOL_FAILED, as: 2, tier2: 0 }
  const c = report.counts
  const tier2 = report.needsBrowser.length
  const counts = `${c.cases} cases: ${c.predictionChanged} predictions changed; questions: ${c.repeatsOnly} repeats only, ${c.droppedOnly} dropped only, ${c.otherQuestions} other, ${c.newQuestion} new; ${tier2} for tier 2`
  const runs = `tier 2 runs the ${tier2} listed cases (--ids-file)`
  switch (code) {
    case 0: return { counts, tier2, meaning: 'every prediction and every Canvas question is the reference\'s. Fine for any step', as: 0 }
    case 1: return { counts, tier2, meaning: 'a prediction changed. Only a step that means to move predictions accepts it, and it records, packs and freezes again', as: 1 }
    case 3:
      if (c.droppedOnly > 0) return { counts, tier2, meaning: `no prediction changed; cases dropped questions. Only a step that names what it drops accepts it; ${runs}`, as: 3 }
      if (c.repeatsOnly > 0) return { counts, tier2, meaning: `no prediction changed; questions are asked more or less often (repeats only). Fine for a refactoring; ${runs}`, as: 0 }
      return { counts, tier2, meaning: `nothing changed; a file that builds Canvas strings differs from the reference's commit, so Chrome's ${report.storage?.cases ?? 0} storage-sensitive cases go to tier 2 by rule. Fine for a refactoring; ${runs}`, as: 0 }
    case 4: return { counts, tier2, meaning: 'no prediction changed, but a case asks other questions or a new one. No step accepts it', as: 4 }
    default: return { counts, tier2, meaning: TOOL_FAILED, as: 2 }
  }
}

type FunctionSetReport = { counts: { cases: number; passed: number; problems: number; skipped: number }; otherOrder: number }

export function functionSetVerdict(check: string, code: number, report: FunctionSetReport | null, log: string): Verdict {
  if (code === 5) return { counts: 'nothing checked', meaning: 'rebuild/src/index.ts doesn\'t export the function set. No step accepts it', as: 5 }
  if (report === null) return { counts: lastLine(log), meaning: TOOL_FAILED, as: 2 }
  const c = report.counts
  const counts = `${c.cases} cases: ${c.passed} pass, ${c.problems} fail, ${c.skipped} skipped${check === 'plain' ? `; ${report.otherOrder} first ask in another order (not a failure)` : ''}`
  switch (code) {
    case 0:
      // The check exits 0 on skipped cases: the lab's path threw, or asks a question the record lacks.
      if (c.skipped > 0) return { counts, meaning: 'every case that ran passes, but cases were skipped because the lab\'s path gave no layout: tier 1 settles those first', as: 3 }
      return { counts, meaning: 'every case passes', as: 0 }
    case 1: return { counts, meaning: 'a case fails. No step accepts it', as: 1 }
    default: return { counts, meaning: TOOL_FAILED, as: 2 }
  }
}

type PainterReport = { counts: { cases: number; painted: number; same: number; paintingDiffers: number; predictionChanged: number; newQuestion: number; frozenDiffers: number } }

export function painterVerdict(code: number, report: PainterReport | null, log: string): Verdict {
  if (report === null) return { counts: lastLine(log), meaning: TOOL_FAILED, as: 2 }
  const c = report.counts
  const counts = `${c.cases} cases: ${c.painted} painted on both sides, ${c.paintingDiffers} differ; not painted: ${c.predictionChanged} predictions changed, ${c.newQuestion} new questions, ${c.frozenDiffers} where the frozen predictor differs`
  switch (code) {
    case 0: return { counts, meaning: 'every painted case is byte-equal to the frozen painter\'s', as: 0 }
    case 1: return { counts, meaning: 'a painting differs, or the frozen predictor no longer gives the reference. Only a step that means to change the painter\'s DOM accepts it', as: 1 }
    case 3: return { counts, meaning: 'no painting differs, but cases weren\'t painted because their prediction changed or asks a new question: tier 1 settles those first', as: 3 }
    default: return { counts, meaning: TOOL_FAILED, as: 2 }
  }
}

type CitationsReport = { losses: unknown[]; acceptedLosses: number; moved: unknown[]; newStalePointers: unknown[] }

export function citationsVerdict(code: number, report: CitationsReport | null, log: string): Verdict {
  if (report === null) return { counts: lastLine(log), meaning: TOOL_FAILED, as: 2 }
  const counts = `${report.losses.length} lost, ${report.acceptedLosses} losses accepted by name, ${report.moved.length} moved between scopes, ${report.newStalePointers.length} new stale test pointers`
  switch (code) {
    case 0: return { counts, meaning: 'no citation, prose string or test pointer of the correctness line is lost', as: 0 }
    case 1: return { counts, meaning: 'a citation, a prose string or a test pointer is lost: put it back, or accept the loss by name with a reason (citations.ts accept)', as: 1 }
    default: return { counts, meaning: TOOL_FAILED, as: 2 }
  }
}

type TwinReport = { cases: number; withTwoByteSlice: number; withTwin: number }

// The scan exits 0 whatever it finds: its report is the result, and it is a tripwire at 0 cases.
export function twinVerdict(code: number, report: TwinReport | null, log: string): Verdict {
  if (code !== 0 || report === null) return { counts: lastLine(log), meaning: TOOL_FAILED, as: 2 }
  const counts = `${report.cases} cases: ${report.withTwoByteSlice} ask a two-byte slice, ${report.withTwin} ask one context both storages`
  if (report.withTwin > 0) return { counts, meaning: 'the tripwire tripped: a Blink context is asked the same characters as a one-byte and as a two-byte string, and Chrome answers both with the first. No step accepts it', as: 1 }
  return { counts, meaning: 'no Blink context is asked the same characters in both storages', as: 0 }
}

export function tscVerdict(code: number, log: string): Verdict {
  const errors = log.split('\n').filter(line => /error TS\d+/.test(line)).length
  if (code === 0) return { counts: '0 errors', meaning: 'no type error', as: 0 }
  return errors > 0 ? { counts: `${errors} errors`, meaning: 'type errors. No step accepts them', as: 1 } : { counts: lastLine(log), meaning: TOOL_FAILED, as: 2 }
}

// The log holds one summary a test file.
export function unitTestsVerdict(code: number, files: number, log: string): Verdict {
  const sum = (pattern: RegExp): number => [...log.matchAll(pattern)].reduce((total, match) => total + Number(match[1]), 0)
  const failed = sum(/^\s*(\d+) fail$/gm)
  const counts = `${files} files: ${sum(/^\s*(\d+) pass$/gm)} pass, ${failed} fail`
  if (code === 0) return { counts, meaning: 'every unit test passes', as: 0 }
  return failed > 0 ? { counts, meaning: 'a unit test fails. No step accepts it', as: 1 } : { counts, meaning: TOOL_FAILED, as: 2 }
}

// The worst of two results: 1, 2, 5, 4, 3, then 0 (the file comment).
const WORST_FIRST = [1, 2, 5, 4, 3, 0]
export const worse = (a: number, b: number): number => (WORST_FIRST.indexOf(a) <= WORST_FIRST.indexOf(b) ? a : b)

// The run's last line: whether every gate is fine for a pure refactoring, and how many cases tier 1 sends to tier 2, which
// it does even where its row is fine (the file comment).
export function closingLine(rows: readonly Row[], seconds: number, exit: number): string {
  const failing = rows.filter(row => row.as !== 0)
  const sending = rows.filter(row => row.tier2 > 0)
  let cases = 0
  for (let i = 0; i < sending.length; i++) cases += sending[i]!.tier2
  const gates = failing.length === 0 ? 'every gate is fine for a pure refactoring' : `not fine for a pure refactoring: ${failing.map(row => `${row.gate} (exit ${row.exit}, log ${row.log})`).join('; ')}`
  const tier2 = sending.length === 0 ? 'no case is for tier 2' : `${cases} cases are for tier 2, which a browser still has to run (${sending.map(row => `${row.gate}: ${row.tier2}`).join('; ')})`
  return `${rows.length} gates in ${seconds} s: ${gates}; ${tier2}. Exit ${exit}`
}

// Whether a process with this pid exists: signal 0 tests for it and sends nothing. EPERM is a live process of another user.
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Removes the socket files in `dir` whose process is gone, and the one of this pid, which a run that starts can only have
// from an earlier process of the same pid. Returns the pids whose files went.
export function removeStaleSockets(dir: string): number[] {
  const names = readdirSync(dir)
  const removed: number[] = []
  for (let i = 0; i < names.length; i++) {
    const match = /^pretext-gates-(\d+)\.sock$/.exec(names[i]!)
    if (match === null) continue
    const pid = Number(match[1])
    if (pid !== process.pid && processExists(pid)) continue
    unlinkSync(join(dir, names[i]!))
    removed.push(pid)
  }
  return removed
}

// ---- A run ----

// What the arguments ask for, or what is wrong with them.
export type Run = { engines: EngineName[]; quick: boolean; cores: number; wait: boolean }
export function runOf(args: readonly string[]): Run | string {
  const run: Run = { engines: [...ENGINES], quick: false, cores: Math.max(1, cpus().length - 2), wait: true }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--quick') run.quick = true
    else if (arg === '--no-wait') run.wait = false
    else if (arg.startsWith('--engine=')) run.engines = arg === '--engine=all' ? [...ENGINES] : ENGINES.filter(name => name === arg.slice('--engine='.length))
    else if (arg.startsWith('--cores=')) run.cores = Number(arg.slice('--cores='.length))
    else return `Unknown argument ${arg}`
  }
  if (run.engines.length === 0) return '--engine must be blink, webkit, gecko or all'
  if (!Number.isInteger(run.cores) || run.cores < 1) return '--cores must be a whole number of cores, 1 or more'
  return run
}

// ---- A turn for every run ----

// A run's place in the queue, <n>.json: who asks, from where, with which flags, and when (ms).
export type Ticket = { pid: number; at: number; worktree: string; flags: string; quick: boolean }

const when = (ms: number): string => new Date(ms).toString().slice(4, 24)
const ticketNumber = (name: string): number => Number(/^(\d+)\.json$/.exec(name)?.[1] ?? 0)

// Whether the run that wrote a ticket still runs. Its pid alone would not do: the machine reuses pids within hours, and
// a killed run's ticket stays until the next run looks. So a process of that pid that started after the ticket was written
// is another one (`ps` gives the start to the second, in UTC here, since `bun test` keeps another time zone than its
// children; when it gives nothing to read, the ticket counts as live).
function ticketLives(ticket: Ticket): boolean {
  if (!processExists(ticket.pid)) return false
  const started = Bun.spawnSync(['ps', '-o', 'lstart=', '-p', String(ticket.pid)], { env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }).stdout.toString()
  return !(Date.parse(`${started} UTC`) > ticket.at)
}

// A ticket below a run's own, or null when another waiter removed it as dead between the listing and this read.
function readTicket(path: string): Ticket | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Ticket
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}


// Takes a ticket in `dir` and resolves when no ticket below it is a live run's of its kind (full, or --quick); says who
// holds the turn while it waits. True when it waited. The ticket is a hard link to a finished draft, which fails when the
// name exists: a ticket holds its run from the moment it exists, two runs never get one number, and the numbers only go
// up, since a run removes dead tickets below its own only. So every ticket below a run's own was there before it, and
// nothing is ever taken over.
export async function takeTurn(dir: string, ticket: Ticket): Promise<boolean> {
  mkdirSync(dir, { recursive: true })
  const draft = join(dir, `draft-${ticket.pid}`)
  writeFileSync(draft, JSON.stringify(ticket))
  let mine = 0
  while (mine === 0) {
    const names = readdirSync(dir)
    let highest = 0
    for (let i = 0; i < names.length; i++) highest = Math.max(highest, ticketNumber(names[i]!))
    try {
      linkSync(draft, join(dir, `${highest + 1}.json`))
      mine = highest + 1
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  unlinkSync(draft)
  let said = ''
  for (;;) {
    const numbers = readdirSync(dir).map(ticketNumber).filter(n => n > 0 && n < mine).sort((a, b) => a - b)
    const before: Ticket[] = []
    for (let i = 0; i < numbers.length; i++) {
      const path = join(dir, `${numbers[i]!}.json`)
      const earlier = readTicket(path)
      if (earlier === null) continue
      if (!ticketLives(earlier)) rmSync(path, { force: true })
      else if (earlier.quick === ticket.quick) before.push(earlier)
    }
    if (before.length === 0) {
      if (said !== '') console.error(`[gates] the turn came after ${Math.round((Date.now() - ticket.at) / 1000)} s`)
      return said !== ''
    }
    const holder = before[0]!
    const text = `waiting for a turn: pid ${holder.pid} holds it (worktree ${holder.worktree}, flags ${holder.flags === '' ? 'none' : holder.flags}, since ${when(holder.at)}); runs waiting before this one: ${before.length - 1}. --no-wait skips the queue`
    if (text !== said) console.error(`[gates] ${text}`)
    said = text
    await Bun.sleep(500)
  }
}

// ---- The gates of a run ----

// Every unit test file under rebuild, outside the folders of the engines left out.
function unitTestFiles(leftOut: readonly EngineName[]): string[] {
  const others = leftOut.map(name => `rebuild/src/engines/${name}/`)
  const out: string[] = []
  const walk = (dir: string): void => {
    const entries = readdirSync(join(REPO, dir), { withFileTypes: true })
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(path)
      } else if (entry.name.endsWith('.test.ts') && !others.some(prefix => path.startsWith(prefix))) out.push(`./${path}`)
    }
  }
  walk('rebuild')
  return out.sort()
}

function gatesOf(engines: readonly EngineName[], quick: boolean): Gate[] {
  const gates: Gate[] = []
  for (let i = 0; i < TSC_PROJECTS.length; i++) {
    const project = TSC_PROJECTS[i]!
    gates.push({
      name: `tsc ${project}`, sharded: false, report: null, read: (code, _report, log) => tscVerdict(code, log),
      parts: [['x', 'tsc', '--noEmit', '-p', `${project}/tsconfig.json`, '--incremental', '--tsBuildInfoFile', join(TSC_STATE, `${project.replaceAll('/', '_')}.tsbuildinfo`)]],
    })
  }
  // A process a test file: two files take most of the unit tests' time, and one process runs the files one after another.
  const leftOut = quick && engines.length === 1 ? ENGINES.filter(name => name !== engines[0]) : []
  const tests = unitTestFiles(leftOut)
  gates.push({ name: `unit tests${leftOut.length === 0 ? '' : ` without ${leftOut.join(' and ')}`}`, sharded: false, report: null, parts: tests.map(file => ['test', file]), read: (code, _report, log) => unitTestsVerdict(code, tests.length, log) })
  if (!quick) {
    const citations = join(OUT, 'citations.json')
    gates.push({ name: 'citations', sharded: false, report: citations, parts: [['rebuild/tools/citations.ts', 'check', `--out=${citations}`]], read: (code, report, log) => citationsVerdict(code, report as CitationsReport | null, log) })
    if (engines.includes('blink')) {
      const twins = join(OUT, 'twin-scan.json')
      const cases = SETS.filter(set => set.browsers.includes('chrome')).flatMap(set => partFiles(set, 'chrome'))
      // A process a case file: 19 files, and the four largest hold half the cases.
      gates.push({ name: 'twin scan', sharded: true, atMost: 4, report: twins, parts: [['rebuild/tools/twin-scan.ts', `--cases=${cases.join(',')}`, `--out=${twins}`]], read: (code, report, log) => twinVerdict(code, report as TwinReport | null, log) })
    }
  }
  const each = (add: (browser: TierBrowser, config: Config, check: string) => void): void => {
    for (let e = 0; e < engines.length; e++) for (let c = 0; c < CONFIGS.length; c++) add(BROWSER_OF[engines[e]!], CONFIGS[c]!, `rebuild/tests/.check/${BROWSER_OF[engines[e]!]}-${CONFIGS[c]!}`)
  }
  each((browser, config, check) => gates.push({
    name: `tier 1 ${browser} ${config}`, sharded: true, report: join(REPO, check, 'check-report.json'), parts: [['rebuild/tests/replay.ts', 'check', `--browser=${browser}`, `--config=${config}`]],
    read: (code, report) => tier1Verdict(code, report as Tier1Report | null),
  }))
  const functionSet = (name: string): void => each((browser, config, check) => gates.push({
    name: `${name} ${browser} ${config}`, sharded: true, report: join(REPO, check, `${name}-report.json`), parts: [['rebuild/tests/function-set.ts', name, `--browser=${browser}`, `--config=${config}`]],
    read: (code, report, log) => functionSetVerdict(name, code, report as FunctionSetReport | null, log),
  }))
  functionSet('plain')
  functionSet('pure')
  if (!quick) {
    each((browser, config) => gates.push({
      name: `painter ${browser} ${config}`, sharded: true, report: join(REPO, '.artifacts/tests/painter-diff', basename(REPO), `${browser}-${config}.json`), parts: [['rebuild/tools/painter-diff.ts', 'check', `--browser=${browser}`, `--config=${config}`]],
      read: (code, report, log) => painterVerdict(code, report as PainterReport | null, log),
    }))
    functionSet('sweep')
  }
  return gates
}

// ---- Running them ----

// Who gets the next core: the gates in the table's order, then first come, first served; while `longFirst`, a group of
// long paragraphs before any other.
export type Waiter = { long: boolean; holder: number; grant: () => void }
export function nextWaiter(waiting: readonly Waiter[], longFirst: boolean): number {
  let best = 0
  for (let i = 1; i < waiting.length; i++) {
    const a = waiting[i]!
    const b = waiting[best]!
    if (longFirst && a.long !== b.long ? a.long : a.holder < b.holder) best = i
  }
  return best
}

// Starts every gate at once. The cores go round through `waiting`: a part of a single-process gate waits here, and a
// sharded gate's children wait through the socket (cores.ts), where a connection is a core until it closes.
async function runAll(gates: readonly Gate[], cores: number): Promise<Row[]> {
  const waiting: Waiter[] = []
  let free = cores
  // The cores that groups of long paragraphs hold.
  let long = 0
  const grant = (): void => {
    while (free > 0 && waiting.length > 0) {
      free--
      const next = waiting.splice(nextWaiter(waiting, long < Math.ceil(cores / 4)), 1)[0]!
      if (next.long) long++
      next.grant()
    }
  }
  removeStaleSockets(tmpdir())
  const socketPath = join(tmpdir(), `pretext-gates-${process.pid}.sock`)
  const server = Bun.listen<{ waiter: Waiter | null; granted: boolean }>({
    unix: socketPath,
    socket: {
      open(socket) { socket.data = { waiter: null, granted: false } },
      data(socket, bytes) {
        const [kind, holder] = bytes.toString().trim().split(' ')
        socket.data.waiter = { long: kind === 'long', holder: Number(holder), grant: () => { socket.data.granted = true; socket.write('1') } }
        waiting.push(socket.data.waiter)
        grant()
      },
      close(socket) {
        const waiter = socket.data.waiter
        if (socket.data.granted) {
          free++
          if (waiter!.long) long--
        } else if (waiter !== null) waiting.splice(waiting.indexOf(waiter), 1)
        grant()
      },
    },
  })
  const runGate = async (gate: Gate, g: number): Promise<Row> => {
    const log = join(OUT, `${gate.name.replaceAll(/[^a-z0-9]+/gi, '-')}.log`)
    const fd = openSync(log, 'w')
    const started = Date.now()
    const env = { ...process.env, PRETEXT_GATES_CORES: socketPath, PRETEXT_GATES_HOLDER: String(g) }
    const codes = await Promise.all(gate.parts.map(async part => {
      if (gate.sharded) return await Bun.spawn(['bun', ...part, `--jobs=${Math.min(cores, gate.atMost ?? cores)}`], { cwd: REPO, env, stdin: 'ignore', stdout: fd, stderr: fd }).exited
      await new Promise<void>(granted => {
        waiting.push({ long: false, holder: g, grant: granted })
        grant()
      })
      const code = await Bun.spawn(['bun', ...part], { cwd: REPO, stdin: 'ignore', stdout: fd, stderr: fd }).exited
      free++
      grant()
      return code
    }))
    closeSync(fd)
    // Only the report this run wrote: an earlier run's would show counts of another tree.
    const written = gate.report === null ? undefined : statSync(gate.report, { throwIfNoEntry: false })
    const report = written !== undefined && written.mtimeMs >= started ? JSON.parse(readFileSync(gate.report!, 'utf8')) as unknown : null
    const exit = Math.max(...codes)
    const verdict = gate.read(exit, report, readFileSync(log, 'utf8'))
    const row: Row = { gate: gate.name, exit, as: verdict.as, meaning: verdict.meaning, counts: verdict.counts, tier2: 'tier2' in verdict ? verdict.tier2 : 0, wallSeconds: Math.round((Date.now() - started) / 100) / 10, log: relative(REPO, log) }
    console.error(`[gates] ${row.gate}: exit ${row.exit}, ${row.wallSeconds} s${row.as === 0 ? '' : `: ${row.meaning}`}`)
    return row
  }
  const rows = await Promise.all(gates.map(runGate))
  server.stop()
  return rows
}

function printTable(rows: readonly Row[]): void {
  const header = ['gate', 'exit', 'fine for a pure refactoring', 'done after', 'counts', 'what the exit code means']
  const lines = rows.map(row => [row.gate, String(row.exit), row.as === 0 ? 'yes' : `NO (counts as ${row.as})`, `${row.wallSeconds} s`, row.counts, row.meaning])
  const widths = header.map((name, i) => Math.max(name.length, ...lines.map(line => line[i]!.length)))
  const format = (cells: readonly string[]): string => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ')
  console.log(format(header))
  for (let i = 0; i < lines.length; i++) console.log(format(lines[i]!))
}

if (import.meta.main) {
  const run = runOf(process.argv.slice(2))
  if (typeof run === 'string') {
    console.error(`[gates] ${run}\nUsage: bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all] [--quick] [--cores=N] [--no-wait]`)
    process.exit(2)
  }
  mkdirSync(OUT, { recursive: true })
  mkdirSync(TSC_STATE, { recursive: true })
  if (run.wait) await takeTurn(join(SHARED, 'queue'), { pid: process.pid, at: Date.now(), worktree: REPO, flags: process.argv.slice(2).join(' '), quick: run.quick })
  const started = Date.now()
  const gates = gatesOf(run.engines, run.quick)
  console.error(`[gates] ${gates.length} gates${run.quick ? ' (quick)' : ''} for ${run.engines.join(', ')} on ${run.cores} cores; logs in ${relative(REPO, OUT)}`)
  const rows = await runAll(gates, run.cores)
  const seconds = Math.round((Date.now() - started) / 100) / 10
  writeFileSync(join(OUT, 'gates.json'), `${JSON.stringify(rows, null, 2)}\n`)
  printTable(rows)
  let exit = 0
  for (let i = 0; i < rows.length; i++) exit = worse(exit, rows[i]!.as)
  console.log(closingLine(rows, seconds, exit))
  process.exit(exit)
}
