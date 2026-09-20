// The offline gates in one command (rebuild/lab/README.md, "Test tiers"): every check that needs no browser, run side by
// side, with every exit code read from the child process itself and one table at the end.
//
//   bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all] [--quick] [--cores=N] [--no-wait] [--fresh]
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
// A gate's process asks over one connection, whatever its --jobs: macOS refuses a connection at once while 128 wait
// for the listener to accept them, and a connection a request was 496 at the start of a full run (cores.ts).
// The socket is pretext-gates-<pid>.sock in the temporary folder. A run that is killed leaves its file, and listening fails
// on a path that exists, so a run first removes the socket files of processes that are gone (removeStaleSockets).
//
// A turn: the machine runs one full run and one --quick run at a time. Several full runs at once, each in its own
// worktree, took two to three times as long each (19 to 33 minutes at load averages of 80 to 160) and spoiled the timed
// benchmarks beside them. Before its first gate a run takes a ticket, <n>.json in .artifacts/tests/gates/queue, which
// every worktree shares: n is one more than the highest number there, and the ticket is a hard link to a finished
// draft, which fails when the name exists. So a ticket holds its pid, worktree, flags and time from the moment it
// exists, two runs never get one number, and tickets appear in the order of their numbers. A run starts when no ticket
// below its own is a live run's of its kind, or of its worktree (two runs of one worktree write the same reports and
// logs), first come, first served, and while it waits it says who holds the turn and how many wait before it. Nothing
// is ever taken over, so nothing is timed: a ticket is dead when its pid is gone, or is a process that started after
// the ticket was written (the machine reuses pids within hours, and a killed run's ticket stays until the next run
// looks), or is a zombie (a killed run whose parent never reaps it, which held the turn for as long as the parent
// lived); a run skips and removes the dead tickets below its own and leaves its own behind as the highest, so the
// numbers only go up. A run whose turn came still starts no gate while under 30% of the machine's memory is free, as the
// browser lock does, and keeps its place meanwhile. --no-wait takes no ticket and asks nothing of memory, for a human who
// knows better. Measured with --quick --engine=gecko, 42
// to 55 s alone: two at once took 115 and 120 s, one after the other 50 and 100 s, so --quick runs wait for each other;
// on half the cores each they took 74 and 76 s, which gives the second what it takes from the first and costs a run
// alone a quarter, so no run takes fewer cores instead of waiting. A --quick run and a full run don't wait for each
// other: beside a full run the --quick run took 123 s, and its wait would be six minutes on average. replay.ts pack and
// freeze take a ticket too, one that writes: they replace the frozen references every run reads, so they wait for
// every live run before them and every run after them waits for them (Ticket).
//
// Reuse: a run whose inputs equal an earlier finished run's prints that run's table again, says that it is a reused
// result with that run's time, worktree and commit, and exits with its code, in under a second (an owner, its critic and
// the orchestrator run the gates on one tree); --fresh runs anyway and replaces the result. A key that misses an input
// would hide a failure, so the key is a sha256 over everything a gate reads, and what that is is said once, beside
// what reads it: every gate reads the working tree and what is installed, which inputsKey hashes and lists, with what
// it leaves out and why (--cores, what git holds, what unit tests read outside the repository); and what a gate reads
// of .artifacts, such as a frozen reference, is the gate's `reads` list, set where the gate is made (gatesOf) with the
// reason beside it, which the key walks. A new gate's input goes in its `reads`.
// A result is kept only when the run finished, no gate's tool failed (a row that counts as 2 knows nothing, whatever
// the run's exit code), no case goes to tier 2 and the key is the same after the run as before it: a tree edited, or a
// reference frozen again, under the run keeps nothing. A reused result is the table and gates.json, not the gates'
// reports: tier 2 takes its cases from tier 1's <report>.needs-browser.ids in the working tree (browser-sets.ts
// --ids-file), which after a reused result is absent or an earlier tree's, so a run that sends cases to tier 2 runs
// again in the worktree that goes on to tier 2. Results are <key>.json in .artifacts/tests/gates/results, the last 50.
// The key takes a quarter of a second for the full form and a tenth for one engine's --quick at a load average of 30,
// and 1.2 and 0.5 s at 60.
//
// The type check is incremental: tsc keeps each project's state in node_modules/.cache/pretext-gates (untracked), keyed
// by the hash of every file's text, the compiler options and the compiler's version, and checks in full when the state is
// missing or doesn't fit. It prints the errors `bunx tsc --noEmit -p <project>` prints and exits 0 when that does; with
// errors tsc exits 2 when it found them in this run and 1 when it kept them from the last one.
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { cpus, release, tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { CONFIGS, REPO, SETS, partFiles, partPaths, type Config, type TierBrowser } from './sets.ts'

const ENGINES = ['blink', 'webkit', 'gecko'] as const
type EngineName = typeof ENGINES[number]
const BROWSER_OF: Record<EngineName, TierBrowser> = { blink: 'chrome', webkit: 'webkit-host', gecko: 'firefox' }
const TSC_PROJECTS = ['rebuild', 'rebuild/lab', 'rebuild/tests', 'rebuild/probes', 'rebuild/lab/cases', 'rebuild/bench']
const OUT = join(REPO, 'rebuild/tests/.check/gates')
const TSC_STATE = join(REPO, 'node_modules/.cache/pretext-gates')
// The queue's tickets and the kept results: in the .artifacts folder every worktree shares.
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
  // What the gate reads beside the working tree, which every gate reads: files and folders of .artifacts, as paths from
  // the top of the working tree. The key of a kept result walks these lists (inputsKey), so a gate's input is in the key
  // by being named here, where the gate is made (gatesOf). Every *.zst under a path named here goes in by its name, size
  // and time, not its bytes, which is sound for a frozen reference's shards alone, whose hashes the manifests hold: a
  // gate that reads another *.zst needs it in the key by its bytes.
  reads: string[]
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
export type Run = { engines: EngineName[]; quick: boolean; cores: number; wait: boolean; fresh: boolean }
export function runOf(args: readonly string[]): Run | string {
  const run: Run = { engines: [...ENGINES], quick: false, cores: Math.max(1, cpus().length - 2), wait: true, fresh: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--quick') run.quick = true
    else if (arg === '--no-wait') run.wait = false
    else if (arg === '--fresh') run.fresh = true
    else if (arg.startsWith('--engine=')) run.engines = arg === '--engine=all' ? [...ENGINES] : ENGINES.filter(name => name === arg.slice('--engine='.length))
    else if (arg.startsWith('--cores=')) run.cores = Number(arg.slice('--cores='.length))
    else return `Unknown argument ${arg}`
  }
  if (run.engines.length === 0) return '--engine must be blink, webkit, gecko or all'
  if (!Number.isInteger(run.cores) || run.cores < 1) return '--cores must be a whole number of cores, 1 or more'
  return run
}

// ---- A turn for every run ----

// A run's place in the queue, <n>.json: who asks, from where, with which flags, and when (ms). `writes` is a job that
// replaces the frozen references every worktree's gates read (replay.ts pack and freeze): it waits for every live run
// before it, and every run after it waits for it. On 2026-09-20 a pack removed input shards under another worktree's
// sweep, which failed with ENOENT. A ticket from before the field reads as a run that doesn't write.
export type Ticket = { pid: number; at: number; worktree: string; flags: string; quick: boolean; writes?: boolean }

// The queue every worktree shares, since each worktree's .artifacts is the main checkout's.
export const QUEUE = join(SHARED, 'queue')

const when = (ms: number): string => new Date(ms).toString().slice(4, 24)
const ticketNumber = (name: string): number => Number(/^(\d+)\.json$/.exec(name)?.[1] ?? 0)

// Whether the run that wrote a ticket still runs. Its pid alone would not do: the machine reuses pids within hours, and
// a killed run's ticket stays until the next run looks. So a process of that pid that started after the ticket was written
// is another one (`ps` gives the start to the second, in UTC here, since `bun test` keeps another time zone than its
// children; when it gives nothing to read, the ticket counts as live). And a killed run whose parent never reaps it
// stays a zombie for as long as the parent lives: signal 0 still finds it, and `ps` gives its state as Z.
function ticketLives(ticket: Ticket): boolean {
  if (!processExists(ticket.pid)) return false
  const [state, ...started] = Bun.spawnSync(['ps', '-o', 'stat=,lstart=', '-p', String(ticket.pid)], { env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }).stdout.toString().trim().split(/\s+/)
  return !state!.startsWith('Z') && !(Date.parse(`${started.join(' ')} UTC`) > ticket.at)
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

// The machine's free memory in percent, as macOS's `memory_pressure` gives it and the browser lock reads it
// (.artifacts/session/with-browser-lock.py, which starts no browser job under 30% either).
function freeMemoryPercent(): number {
  return Number(/free percentage: (\d+)%/.exec(Bun.spawnSync(['memory_pressure']).stdout.toString())![1])
}

// A run starts no gate while less of the machine's memory is free: every gate's children load a group of recorded cases,
// and several heavy jobs at once took the machine to its swap on 2026-09-19. It keeps its place while it waits, so the
// runs behind it wait too.
export const MIN_FREE_MEMORY = 30

// Takes a ticket in `dir` and resolves when no ticket below it is a live run's of its kind (full, or --quick) or of its
// worktree, whose reports and logs it would write over, or a live job's that writes the references, or any live run's
// when this one writes them, and `minFreeMemory` percent of the machine's memory is free (0 asks nothing); says who
// holds the turn, or how much memory is free, while it waits. True when it waited.
// The ticket is a hard link to a finished draft, which fails when the name exists: a ticket holds its run from the
// moment it exists, two runs never get one number, and the numbers only go up, since a run removes dead tickets below
// its own only. So every ticket below a run's own was there before it, and nothing is ever taken over.
export async function takeTurn(dir: string, ticket: Ticket, minFreeMemory: number): Promise<boolean> {
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
      else if (earlier.writes === true || ticket.writes === true || earlier.quick === ticket.quick || earlier.worktree === ticket.worktree) before.push(earlier)
    }
    const free = before.length > 0 || minFreeMemory === 0 ? 100 : freeMemoryPercent()
    if (before.length === 0 && free >= minFreeMemory) {
      if (said !== '') console.error(`[gates] the turn came after ${Math.round((Date.now() - ticket.at) / 1000)} s`)
      return said !== ''
    }
    const holder = before[0]
    const text = holder === undefined
      ? `waiting for memory: under ${minFreeMemory}% of the machine's memory is free. --no-wait skips the wait`
      : `waiting for a turn: pid ${holder.pid} holds it (worktree ${holder.worktree}, flags ${holder.flags === '' ? 'none' : holder.flags}, since ${when(holder.at)}); runs waiting before this one: ${before.length - 1}. --no-wait skips the queue`
    if (text !== said) console.error(`[gates] ${text}`)
    said = text
    await Bun.sleep(500)
  }
}

// ---- A result a key ----

// The files under a folder, in order, or the file itself; none when it isn't there (a recording can leave no ledger).
function filesUnder(path: string): string[] {
  const entry = statSync(path, { throwIfNoEntry: false })
  if (entry === undefined) return []
  if (entry.isFile()) return [path]
  return readdirSync(path, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort()
}

// One hash over everything a gate of this run reads: a key that misses an input would hide a failure. `repo` is the
// working tree, with its .artifacts.
// - The engines and --quick, which choose the gates (gatesOf), bun's version and revision, the OS release.
// - Every tracked file of the working tree and every untracked one git doesn't ignore, by its bytes, since the gates run
//   on uncommitted edits (844 files, 64 MB): rebuild/ with this file, the root package.json, bun.lock and tsconfig.json,
//   and the root src/ and scripts/ files that rebuild/bench and rebuild/probes import. Under rebuild/ also every file
//   git ignores, but for .check, which the gates write: tsc, the unit tests and the citation ledger read rebuild's
//   folders whole, and the root .gitignore names `dist` and `site` wherever they are (a failing test in rebuild/site
//   and a type error in rebuild/src/dist failed their gates and left the key as it was). Of what git ignores
//   elsewhere, the gates read node_modules and .artifacts and write tsc's state, which tsc keys by content itself.
// - What is installed: the package.json of every package at the top of node_modules, since bun.lock doesn't say that a
//   worktree installed it.
// - What a gate reads of .artifacts: its `reads` list, which says why where the gate is made (gatesOf). Every file by
//   its bytes, but a shard (*.zst, 725 MB) by name, size and modification time: the manifests hold every shard's sha256
//   and tier 1 checks each shard against it before it replays (exit 2 otherwise, which is never kept), so a kept
//   result's shards were the manifests', and a shard written since has another time.
// Not in the key: --cores (a process replays a group of shards cut from the manifest alone, replay.ts "Deterministic by
// construction", and the reports were the same bytes at 3, 6, 8 and 16 jobs, research/ITERATION-SPEED.md); what git
// holds (tier 1 asks which STORAGE_PATHS files differ from the reference's commit: the commit is in the manifest, the
// files are in the tree, and a commit never changes); and what unit tests read outside the repository (the pinned
// engine sources and the groundwork's tools under ~/github/browser-engines, Homebrew's ICU 78): every worktree reads the
// same files there and no step of the rebuild writes them, so run with --fresh after changing one.
export function inputsKey(repo: string, run: Run): string {
  const hash = new Bun.CryptoHasher('sha256')
  const addFile = (path: string): void => {
    // A tracked file can be deleted in the working tree.
    const content = existsSync(path) ? readFileSync(path) : null
    hash.update(`${relative(repo, path)}\0${content === null ? 'gone' : content.length}\0`)
    if (content !== null) hash.update(content)
  }
  hash.update(`${run.engines.join(',')} ${run.quick ? 'quick' : 'full'}; bun ${Bun.version} ${Bun.revision}; ${process.platform} ${release()}\0`)
  // An empty list from a git that failed would be a key that reads no file of the tree.
  const listed = (...args: string[]): string[] => {
    const list = Bun.spawnSync(['git', 'ls-files', '-z', ...args], { cwd: repo })
    if (list.exitCode !== 0) throw new Error(`git ls-files failed in ${repo}: ${list.stderr.toString()}`)
    return list.stdout.toString().split('\0')
  }
  // Under rebuild also what git ignores, but for what the gates write: the gates read its folders whole.
  const tree = [...listed('--cached', '--others', '--exclude-standard'), ...listed('--others', '--ignored', '--exclude-standard', '--', 'rebuild', ':!rebuild/tests/.check')]
  for (let i = 0; i < tree.length; i++) if (tree[i] !== '') addFile(join(repo, tree[i]!))
  const modules = join(repo, 'node_modules')
  const installed = readdirSync(modules).sort()
  for (let i = 0; i < installed.length; i++) {
    const name = installed[i]!
    if (name.startsWith('.')) continue
    const packages = name.startsWith('@') ? readdirSync(join(modules, name)).sort().map(inner => join(name, inner)) : [name]
    for (let k = 0; k < packages.length; k++) addFile(join(modules, packages[k]!, 'package.json'))
  }
  // Several gates read one frozen reference: once each.
  const reads = [...new Set(gatesOf(run.engines, run.quick).flatMap(gate => gate.reads))].sort()
  for (let r = 0; r < reads.length; r++) {
    const files = filesUnder(join(repo, reads[r]!))
    for (let i = 0; i < files.length; i++) {
      if (!files[i]!.endsWith('.zst')) addFile(files[i]!)
      else {
        const shard = statSync(files[i]!)
        hash.update(`${relative(repo, files[i]!)}\0${shard.size} ${shard.mtimeMs}\0`)
      }
    }
  }
  return hash.digest('hex')
}

// A finished run as it is kept for reuse: when and where it ran, and what it printed.
export type Kept = { key: string; at: number; worktree: string; commit: string; dirty: boolean; seconds: number; exit: number; rows: Row[] }

export function keptResult(dir: string, key: string): Kept | null {
  const path = join(dir, `${key}.json`)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Kept : null
}

// Why a finished run's rows aren't kept for reuse, or null (the file comment).
export function notKept(rows: readonly Row[]): string | null {
  if (rows.some(row => row.as === 2)) return 'a gate\'s tool failed'
  if (rows.some(row => row.tier2 > 0)) return 'tier 1 sends cases to tier 2, and their ids are in this worktree\'s reports, which a reused result doesn\'t write'
  return null
}

// Keeps a result under its key, in one step, so a reader never sees half a file, and drops all but the last 50.
export function keepResult(dir: string, kept: Kept): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `draft-${process.pid}`), `${JSON.stringify(kept, null, 1)}\n`)
  renameSync(join(dir, `draft-${process.pid}`), join(dir, `${kept.key}.json`))
  // Two runs can finish at once: a result the other one dropped counts as the oldest.
  const results = readdirSync(dir).filter(name => name.endsWith('.json')).map(name => ({ name, at: statSync(join(dir, name), { throwIfNoEntry: false })?.mtimeMs ?? 0 })).sort((a, b) => b.at - a.at)
  for (let i = 50; i < results.length; i++) rmSync(join(dir, results[i]!.name), { force: true })
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

export function gatesOf(engines: readonly EngineName[], quick: boolean): Gate[] {
  const gates: Gate[] = []
  for (let i = 0; i < TSC_PROJECTS.length; i++) {
    const project = TSC_PROJECTS[i]!
    gates.push({
      name: `tsc ${project}`, sharded: false, report: null, reads: [], read: (code, _report, log) => tscVerdict(code, log),
      parts: [['x', 'tsc', '--noEmit', '-p', `${project}/tsconfig.json`, '--incremental', '--tsBuildInfoFile', join(TSC_STATE, `${project.replaceAll('/', '_')}.tsbuildinfo`)]],
    })
  }
  // A process a test file: two files take most of the unit tests' time, and one process runs the files one after another.
  // Ten minutes a test, not bun's five seconds: the limit is there to end a test that hangs, and the gates ask whether a
  // test passes, not how fast. Beside a timed browser job they run on the efficiency cores of a busy machine: tests that
  // read row files or walk every code point took 5 to 10 s there, and at a load average over 100 the likely-subtags test,
  // 18 s alone, ran past two minutes.
  const leftOut = quick && engines.length === 1 ? ENGINES.filter(name => name !== engines[0]) : []
  const tests = unitTestFiles(leftOut)
  gates.push({ name: `unit tests${leftOut.length === 0 ? '' : ` without ${leftOut.join(' and ')}`}`, sharded: false, report: null, reads: [], parts: tests.map(file => ['test', '--timeout', '600000', file]), read: (code, _report, log) => unitTestsVerdict(code, tests.length, log) })
  if (!quick) {
    const citations = join(OUT, 'citations.json')
    gates.push({ name: 'citations', sharded: false, report: citations, reads: [], parts: [['rebuild/tools/citations.ts', 'check', `--out=${citations}`]], read: (code, report, log) => citationsVerdict(code, report as CitationsReport | null, log) })
    if (engines.includes('blink')) {
      const twins = join(OUT, 'twin-scan.json')
      // Chrome's set files, which nothing pins: the inputs' manifests hold the hashes they had when recorded.
      const sets = SETS.filter(set => set.browsers.includes('chrome'))
      // A process a case file: 19 files, and the four largest hold half the cases.
      gates.push({
        name: 'twin scan', sharded: true, atMost: 4, report: twins, reads: sets.flatMap(set => partPaths(set, 'chrome')), parts: [['rebuild/tools/twin-scan.ts', `--cases=${sets.flatMap(set => partFiles(set, 'chrome')).join(',')}`, `--out=${twins}`]],
        read: (code, report, log) => twinVerdict(code, report as TwinReport | null, log),
      })
    }
  }
  // A gate a browser and configuration replays that pair's frozen reference, replay.ts's referenceDir: what `check` reads
  // of it is inputs/, reference/ and ledger/ (browser/ is for `pack` and --against=browser). `check` reads that folder
  // and never the tracked pins in rebuild/tests/reference (freeze copies reference/manifest.json there; the six are
  // equal today), so the pins alone would not do, and inputs/unfaithful.json and inputs/storage-sensitive.ids are pinned
  // by nothing.
  const each = (add: (browser: TierBrowser, config: Config, check: string, reference: string[]) => void): void => {
    for (let e = 0; e < engines.length; e++) for (let c = 0; c < CONFIGS.length; c++) {
      const pair = `${BROWSER_OF[engines[e]!]}-${CONFIGS[c]!}`
      add(BROWSER_OF[engines[e]!], CONFIGS[c]!, `rebuild/tests/.check/${pair}`, ['inputs', 'reference', 'ledger'].map(part => `.artifacts/tests/reference/${pair}/${part}`))
    }
  }
  each((browser, config, check, reference) => gates.push({
    name: `tier 1 ${browser} ${config}`, sharded: true, report: join(REPO, check, 'check-report.json'), reads: reference, parts: [['rebuild/tests/replay.ts', 'check', `--browser=${browser}`, `--config=${config}`]],
    read: (code, report) => tier1Verdict(code, report as Tier1Report | null),
  }))
  const functionSet = (name: string): void => each((browser, config, check, reference) => gates.push({
    name: `${name} ${browser} ${config}`, sharded: true, report: join(REPO, check, `${name}-report.json`), reads: reference, parts: [['rebuild/tests/function-set.ts', name, `--browser=${browser}`, `--config=${config}`]],
    read: (code, report, log) => functionSetVerdict(name, code, report as FunctionSetReport | null, log),
  }))
  functionSet('plain')
  functionSet('pure')
  if (!quick) {
    // The painter differential's frozen bundles, painter-diff.ts's FROZEN_DIR: the tool checks them against
    // rebuild/tools/painter-frozen.json on every run (exit 2 otherwise).
    each((browser, config, _check, reference) => gates.push({
      name: `painter ${browser} ${config}`, sharded: true, report: join(REPO, '.artifacts/tests/painter-diff', basename(REPO), `${browser}-${config}.json`), reads: [...reference, '.artifacts/tests/painter-frozen'], parts: [['rebuild/tools/painter-diff.ts', 'check', `--browser=${browser}`, `--config=${config}`]],
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

// A run's cores, one child process at a time: `take` resolves when a core is this process's, for a part of a
// single-process gate, and `give` gives it back; a sharded gate's process asks through the socket (cores.ts), over its
// one connection, a number a request: `<n> long|short <holder>` asks, `<n> done` gives the core back, and the answer
// `<n>` grants it. Every core of a connection that closes comes back, so a gate that dies gives its cores back by dying.
export type Cores = { take: (holder: number) => Promise<void>; give: () => void; stop: () => void }
// A request of a connection, under the number its process gave it.
type Ask = { n: number; waiter: Waiter; granted: boolean }
export function shareCores(cores: number, socketPath: string): Cores {
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
  // A request that ends, by its `done` or with its connection: its core comes back, or it no longer waits for one.
  const end = (ask: Ask): void => {
    if (ask.granted) {
      free++
      if (ask.waiter.long) long--
    } else waiting.splice(waiting.indexOf(ask.waiter), 1)
  }
  // A connection's requests that wait for a core or hold one: --jobs at most.
  const server = Bun.listen<{ partial: string; asks: Ask[] }>({
    unix: socketPath,
    socket: {
      open(socket) { socket.data = { partial: '', asks: [] } },
      // Lines can come several to a chunk, and a chunk can end inside one.
      data(socket, bytes) {
        const asks = socket.data.asks
        const lines = (socket.data.partial + bytes.toString()).split('\n')
        socket.data.partial = lines.pop()!
        for (let i = 0; i < lines.length; i++) {
          const [n, kind, holder] = lines[i]!.split(' ')
          if (kind === 'done') end(asks.splice(asks.findIndex(ask => ask.n === Number(n)), 1)[0]!)
          else {
            const ask: Ask = { n: Number(n), granted: false, waiter: { long: kind === 'long', holder: Number(holder), grant: () => { ask.granted = true; socket.write(`${n}\n`) } } }
            asks.push(ask)
            waiting.push(ask.waiter)
          }
        }
        grant()
      },
      close(socket) {
        for (let i = 0; i < socket.data.asks.length; i++) end(socket.data.asks[i]!)
        grant()
      },
    },
  })
  return {
    take: holder => new Promise<void>(granted => {
      waiting.push({ long: false, holder, grant: granted })
      grant()
    }),
    give: () => {
      free++
      grant()
    },
    stop: () => { server.stop() },
  }
}

// Starts every gate at once, and shares the cores among their child processes.
async function runAll(gates: readonly Gate[], cores: number): Promise<Row[]> {
  removeStaleSockets(tmpdir())
  const socketPath = join(tmpdir(), `pretext-gates-${process.pid}.sock`)
  const shared = shareCores(cores, socketPath)
  const runGate = async (gate: Gate, g: number): Promise<Row> => {
    const log = join(OUT, `${gate.name.replaceAll(/[^a-z0-9]+/gi, '-')}.log`)
    const fd = openSync(log, 'w')
    const started = Date.now()
    const env = { ...process.env, PRETEXT_GATES_CORES: socketPath, PRETEXT_GATES_HOLDER: String(g) }
    const codes = await Promise.all(gate.parts.map(async part => {
      if (gate.sharded) return await Bun.spawn(['bun', ...part, `--jobs=${Math.min(cores, gate.atMost ?? cores)}`], { cwd: REPO, env, stdin: 'ignore', stdout: fd, stderr: fd }).exited
      await shared.take(g)
      const code = await Bun.spawn(['bun', ...part], { cwd: REPO, stdin: 'ignore', stdout: fd, stderr: fd }).exited
      shared.give()
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
  shared.stop()
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
    console.error(`[gates] ${run}\nUsage: bun rebuild/tests/gates.ts [--engine=blink|webkit|gecko|all] [--quick] [--cores=N] [--no-wait] [--fresh]`)
    process.exit(2)
  }
  mkdirSync(OUT, { recursive: true })
  mkdirSync(TSC_STATE, { recursive: true })
  // An earlier run of the same inputs answers at once, before the queue; and after a wait again, since the run this
  // one waited for may have been of the same tree (an owner, its critic and the orchestrator start together).
  const earlierRun = (key: string): Kept | null => (run.fresh ? null : keptResult(join(SHARED, 'results'), key))
  let key = inputsKey(REPO, run)
  let earlier = earlierRun(key)
  if (earlier === null && run.wait && await takeTurn(QUEUE, { pid: process.pid, at: Date.now(), worktree: REPO, flags: process.argv.slice(2).join(' '), quick: run.quick }, MIN_FREE_MEMORY)) {
    key = inputsKey(REPO, run)
    earlier = earlierRun(key)
  }
  if (earlier !== null) {
    writeFileSync(join(OUT, 'gates.json'), `${JSON.stringify(earlier.rows, null, 2)}\n`)
    printTable(earlier.rows)
    console.log(`Reused result: no gate ran now. A run with the same inputs finished on ${when(earlier.at)} in ${earlier.worktree}, at commit ${earlier.commit}${earlier.dirty ? ' with uncommitted changes' : ''}; the logs and the gates' reports are that worktree's, and --fresh runs the gates anyway`)
    console.log(`Reused result of ${when(earlier.at)}: ${closingLine(earlier.rows, earlier.seconds, earlier.exit)}`)
    process.exit(earlier.exit)
  }
  const started = Date.now()
  const gates = gatesOf(run.engines, run.quick)
  console.error(`[gates] ${gates.length} gates${run.quick ? ' (quick)' : ''} for ${run.engines.join(', ')} on ${run.cores} cores; logs in ${relative(REPO, OUT)}`)
  const rows = await runAll(gates, run.cores)
  const seconds = Math.round((Date.now() - started) / 100) / 10
  writeFileSync(join(OUT, 'gates.json'), `${JSON.stringify(rows, null, 2)}\n`)
  printTable(rows)
  let exit = 0
  for (let i = 0; i < rows.length; i++) exit = worse(exit, rows[i]!.as)
  // Kept for reuse only when the rows allow it, and the inputs are what they were when the run started.
  const reason = notKept(rows) ?? (inputsKey(REPO, run) !== key ? 'the inputs changed under the run' : null)
  if (reason !== null) console.error(`[gates] not kept for reuse: ${reason}`)
  else {
    const git = (...args: string[]): string => Bun.spawnSync(['git', ...args], { cwd: REPO }).stdout.toString().trim()
    keepResult(join(SHARED, 'results'), { key, at: Date.now(), worktree: REPO, commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '', seconds, exit, rows })
  }
  console.log(closingLine(rows, seconds, exit))
  process.exit(exit)
}
