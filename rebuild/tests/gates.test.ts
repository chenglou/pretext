// What gates.ts makes of each gate's exit code and report, its queue and the key of a kept result. These run no gate.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative } from 'node:path'
import { FROZEN_DIR } from '../tools/painter-diff.ts'
import { citationsVerdict, closingLine, exclusiveBrowserJobs, functionSetVerdict, gatesOf, inputsKey, keepResult, keptResult, nextWaiter, notKept, painterVerdict, removeStaleSockets, runOf, takeTurn, tier1Verdict, tscVerdict, twinVerdict, unitTestsVerdict, worse, type Kept, type Row, type Run } from './gates.ts'
import { referenceDir } from './replay.ts'
import { CONFIGS, REPO, TIER_BROWSERS } from './sets.ts'

const tier1 = (counts: Partial<{ predictionChanged: number; repeatsOnly: number; droppedOnly: number; otherQuestions: number; newQuestion: number }>, storage?: { cases: number }) => ({
  counts: { cases: 100, predictionChanged: 0, repeatsOnly: 0, droppedOnly: 0, otherQuestions: 0, newQuestion: 0, unfaithful: 0, ...counts }, needsBrowser: [], ...(storage === undefined ? {} : { storage }),
})

describe('tier 1\'s exit codes', () => {
  test('0 is fine, 1 and 4 never are for a pure refactoring', () => {
    expect(tier1Verdict(0, tier1({})).as).toBe(0)
    expect(tier1Verdict(1, tier1({ predictionChanged: 2 })).as).toBe(1)
    expect(tier1Verdict(4, tier1({ otherQuestions: 1 })).as).toBe(4)
    expect(tier1Verdict(4, tier1({ newQuestion: 1 })).as).toBe(4)
  })

  test('3 is fine with repeats only or the string storage rule alone, and not with a dropped question', () => {
    expect(tier1Verdict(3, tier1({ repeatsOnly: 5 })).as).toBe(0)
    expect(tier1Verdict(3, tier1({}, { cases: 40 }))).toMatchObject({ as: 0, meaning: expect.stringContaining('40 storage-sensitive cases') })
    expect(tier1Verdict(3, tier1({ repeatsOnly: 5, droppedOnly: 1 }))).toMatchObject({ as: 3, meaning: expect.stringContaining('names what it drops') })
  })

  test('a failed tool, or a report this run didn\'t write, is never fine', () => {
    expect(tier1Verdict(2, null).as).toBe(2)
    expect(tier1Verdict(0, null).as).toBe(2)
    expect(tier1Verdict(7, tier1({})).as).toBe(2)
  })

  test('the cases for tier 2 are counted whatever the exit code, and the run\'s last line names them beside "fine"', () => {
    expect(tier1Verdict(3, { ...tier1({}, { cases: 2 }), needsBrowser: ['c-1', 'c-2'] })).toMatchObject({ as: 0, tier2: 2 })
    expect(tier1Verdict(0, tier1({})).tier2).toBe(0)
    const row = (gate: string, as: number, tier2: number): Row => ({ gate, exit: as === 0 && tier2 > 0 ? 3 : as, as, meaning: '', counts: '', tier2, wallSeconds: 1, log: `${gate}.log` })
    expect(closingLine([row('tsc rebuild', 0, 0), row('tier 1 chrome no-facts', 0, 0)], 12.5, 0)).toBe('2 gates in 12.5 s: every gate is fine for a pure refactoring; no case is for tier 2. Exit 0')
    expect(closingLine([row('tier 1 chrome no-facts', 0, 40), row('tier 1 chrome facts', 0, 2), row('tier 1 firefox facts', 0, 0)], 3, 0))
      .toBe('3 gates in 3 s: every gate is fine for a pure refactoring; 42 cases are for tier 2, which a browser still has to run (tier 1 chrome no-facts: 40; tier 1 chrome facts: 2). Exit 0')
    expect(closingLine([row('unit tests', 1, 0), row('tier 1 chrome facts', 0, 2)], 3, 1)).toBe('2 gates in 3 s: not fine for a pure refactoring: unit tests (exit 1, log unit tests.log); 2 cases are for tier 2, which a browser still has to run (tier 1 chrome facts: 2). Exit 1')
  })
})

describe('the other gates', () => {
  const functionSet = { counts: { cases: 10, passed: 10, problems: 0, skipped: 0 }, otherOrder: 3 }
  test('the function set: 5 means nothing was checked', () => {
    expect(functionSetVerdict('plain', 0, functionSet, '')).toMatchObject({ as: 0, counts: expect.stringContaining('3 first ask in another order') })
    expect(functionSetVerdict('pure', 1, { ...functionSet, counts: { cases: 10, passed: 9, problems: 1, skipped: 0 } }, '').as).toBe(1)
    expect(functionSetVerdict('pure', 0, { ...functionSet, counts: { cases: 10, passed: 8, problems: 0, skipped: 2 } }, '')).toMatchObject({ as: 3, meaning: expect.stringContaining('skipped') })
    expect(functionSetVerdict('sweep', 5, null, 'skipped').as).toBe(5)
    expect(functionSetVerdict('sweep', 2, null, 'it threw').as).toBe(2)
  })

  test('the painter differential: 3 waits for tier 1', () => {
    const counts = { cases: 10, painted: 10, same: 10, paintingDiffers: 0, predictionChanged: 0, newQuestion: 0, frozenDiffers: 0 }
    expect(painterVerdict(0, { counts }, '').as).toBe(0)
    expect(painterVerdict(1, { counts: { ...counts, paintingDiffers: 1 } }, '').as).toBe(1)
    expect(painterVerdict(3, { counts: { ...counts, predictionChanged: 1 } }, '').as).toBe(3)
  })

  test('citations, and the twin scan, whose exit is 0 whatever it finds', () => {
    expect(citationsVerdict(0, { losses: [], acceptedLosses: 2, moved: [], newStalePointers: [] }, '').as).toBe(0)
    expect(citationsVerdict(1, { losses: [{}], acceptedLosses: 2, moved: [], newStalePointers: [] }, '').as).toBe(1)
    expect(twinVerdict(0, { cases: 380, withTwoByteSlice: 281, withTwin: 0 }, '').as).toBe(0)
    expect(twinVerdict(0, { cases: 380, withTwoByteSlice: 281, withTwin: 166 }, '')).toMatchObject({ as: 1, meaning: expect.stringContaining('tripwire') })
    expect(twinVerdict(1, null, 'the anchor is gone').as).toBe(2)
  })

  test('tier 0', () => {
    expect(tscVerdict(0, '').as).toBe(0)
    expect(tscVerdict(2, 'rebuild/src/a.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n')).toMatchObject({ as: 1, counts: '1 errors' })
    expect(tscVerdict(1, 'error: could not find tsc').as).toBe(2)
    // One summary a test file.
    expect(unitTestsVerdict(0, 2, ' 800 pass\n 0 fail\n 11 pass\n 0 fail\n')).toMatchObject({ as: 0, counts: '2 files: 811 pass, 0 fail' })
    expect(unitTestsVerdict(1, 2, ' 800 pass\n 0 fail\n 10 pass\n 1 fail\n')).toMatchObject({ as: 1, counts: '2 files: 810 pass, 1 fail' })
    expect(unitTestsVerdict(1, 2, ' 800 pass\n 0 fail\nerror: Cannot find module').as).toBe(2)
  })

  test('the worst result: 1, 2, 5, 4, 3, then 0', () => {
    expect([0, 3, 4, 5, 2, 1].reduce(worse, 0)).toBe(1)
    expect([0, 3, 4, 5, 2].reduce(worse, 0)).toBe(2)
    expect([3, 0, 4].reduce(worse, 0)).toBe(4)
    expect([0, 3, 0].reduce(worse, 0)).toBe(3)
  })
})

test('the next core goes by the table\'s order, then first come, first served; a group of long paragraphs first while their share lasts', () => {
  const waiter = (long: boolean, holder: number) => ({ long, holder, grant: () => {} })
  expect(nextWaiter([waiter(false, 7), waiter(false, 8), waiter(false, 7)], true)).toBe(0)
  expect(nextWaiter([waiter(false, 8), waiter(false, 7), waiter(false, 7)], true)).toBe(1)
  expect(nextWaiter([waiter(false, 7), waiter(true, 12), waiter(true, 9)], true)).toBe(2)
  expect(nextWaiter([waiter(false, 7), waiter(true, 12), waiter(true, 9)], false)).toBe(0)
})

const dir = mkdtempSync(join(tmpdir(), 'gates-test-'))
// The folders this file makes are removed directly: `trash` asks the Finder, which took 4.5 s for an empty folder at a load
// average of 70, and a hook that takes 5 s fails the file.
afterAll(() => { rmSync(dir, { recursive: true }) })

test('a run removes the socket files of processes that are gone, and its own pid\'s, which can only be an earlier process\'s', () => {
  const gone = Bun.spawnSync(['true']).pid
  const names = [`pretext-gates-${gone}.sock`, `pretext-gates-${process.pid}.sock`, `pretext-gates-${process.ppid}.sock`, 'pretext-gates-notes.txt']
  for (let i = 0; i < names.length; i++) writeFileSync(join(dir, names[i]!), '')
  expect(removeStaleSockets(dir).sort((a, b) => a - b)).toEqual([gone, process.pid].sort((a, b) => a - b))
  expect(readdirSync(dir).sort()).toEqual([`pretext-gates-${process.ppid}.sock`, 'pretext-gates-notes.txt'].sort())
})

test('gates.ts refuses an unknown engine or argument before it runs anything', () => {
  const run = (args: string[]): { exitCode: number; stderr: string } => {
    const result = Bun.spawnSync(['bun', join(import.meta.dir, 'gates.ts'), ...args])
    return { exitCode: result.exitCode, stderr: result.stderr.toString() }
  }
  expect(run(['--engine=presto'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('--engine must be blink, webkit, gecko or all') })
  expect(run(['--fast'])).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('Unknown argument --fast') })
})

// ---- The queue: child processes that take a turn, say so in <queue>.log, and hold it ----

const shared = mkdtempSync(join(tmpdir(), 'gates-test-shared-'))
afterAll(() => { rmSync(shared, { recursive: true }) })
// No browser lock's folder is here, so no exclusive browser job is.
const NO_LOCK = join(shared, 'no-browser-lock')
const TURN = join(shared, 'turn.ts')
writeFileSync(TURN, `import { appendFileSync } from 'node:fs'
import { takeTurn } from ${JSON.stringify(join(import.meta.dir, 'gates.ts'))}
const [queue, name, hold, flags, worktree, minFreeMemory, browserLock] = process.argv.slice(2)
await takeTurn(queue, { pid: process.pid, at: Date.now(), worktree, flags, quick: flags === '--quick' }, Number(minFreeMemory ?? 0), browserLock ?? ${JSON.stringify(NO_LOCK)})
appendFileSync(queue + '.log', 'start ' + name + '\\n')
await Bun.sleep(Number(hold))
appendFileSync(queue + '.log', 'end ' + name + '\\n')
`)
const textOf = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const soon = async (what: () => boolean): Promise<void> => { while (!what()) await Bun.sleep(50) }

test('a run waits its turn behind the live runs of its kind and of its worktree, first come, first served, and says who holds it; a killed holder\'s turn goes on', async () => {
  const queue = join(shared, 'queue')
  const start = (name: string, flags: string, worktree = name) => Bun.spawn(['bun', TURN, queue, name, '60000', flags, worktree], { stdout: 'ignore', stderr: Bun.file(join(shared, `${name}.err`)) })
  const log = (): string => textOf(`${queue}.log`)
  const said = (name: string): string => textOf(join(shared, `${name}.err`))
  const a = start('a', '')
  await soon(() => log().includes('start a'))
  const b = start('b', '')
  await soon(() => said('b').includes(`pid ${a.pid} holds it (worktree a, flags none, since `) && said('b').includes('; runs waiting before this one: 0.'))
  const c = start('c', '')
  await soon(() => said('c').includes(`pid ${a.pid} holds it`) && said('c').includes('; runs waiting before this one: 1.'))
  const quick = start('quick', '--quick')
  await soon(() => log().includes('start quick'))
  const quick2 = start('quick2', '--quick')
  await soon(() => said('quick2').includes(`pid ${quick.pid} holds it (worktree quick, flags --quick, since `))
  expect(log()).toBe('start a\nstart quick\n')
  a.kill('SIGKILL')
  await soon(() => log().includes('start b') && said('c').includes(`pid ${b.pid} holds it`))
  expect(log()).not.toContain('start c')
  b.kill('SIGKILL')
  await soon(() => log().includes('start c'))
  // A full run and a --quick run don't wait for each other.
  c.kill('SIGKILL')
  const late = start('late', '')
  await soon(() => log().includes('start late'))
  expect(log()).not.toContain('start quick2')
  // Two runs of one worktree do: they would write the same reports and logs.
  const same = start('same', '--quick', 'late')
  quick.kill('SIGKILL')
  await soon(() => log().includes('start quick2'))
  quick2.kill('SIGKILL')
  await soon(() => said('same').includes(`pid ${late.pid} holds it (worktree late, flags none, since `))
  expect(log()).not.toContain('start same')
  late.kill('SIGKILL')
  await soon(() => log().includes('start same'))
  same.kill('SIGKILL')
}, 120000)

test('runs that ask at the same moment get a ticket each and never run together', async () => {
  const queue = join(shared, 'at-once')
  const runs = [0, 1, 2, 3, 4].map(i => Bun.spawn(['bun', TURN, queue, `run${i}`, '100', '', `run${i}`], { stdout: 'ignore', stderr: 'ignore' }))
  for (let i = 0; i < runs.length; i++) expect(await runs[i]!.exited).toBe(0)
  const lines = textOf(`${queue}.log`).trim().split('\n')
  expect(lines.length).toBe(10)
  for (let i = 0; i < lines.length; i += 2) expect(lines[i + 1]).toBe(lines[i]!.replace('start', 'end'))
  // A finished run's ticket stays as the highest number, so numbers only go up; the dead ones below it went.
  expect(readdirSync(queue)).toEqual(['5.json'])
}, 120000)

test('a ticket whose pid is now a younger process\'s is dead: pids come round again', async () => {
  const queue = join(shared, 'pid-again')
  mkdirSync(queue)
  writeFileSync(join(queue, '1.json'), JSON.stringify({ pid: process.pid, at: Date.now() - 3600000, worktree: 'gone', flags: '', quick: false }))
  expect(await takeTurn(queue, { pid: process.pid, at: Date.now(), worktree: 'here', flags: '', quick: false }, 0, NO_LOCK)).toBe(false)
  expect(readdirSync(queue)).toEqual(['2.json'])
})

test('a killed run that its parent never reaps is a zombie, which signal 0 still finds: its turn goes on', async () => {
  const queue = join(shared, 'zombie')
  // The shell starts the run and becomes a `sleep`, which never waits for its child.
  const parent = Bun.spawn(['sh', '-c', `bun "$0" "$1" holder 60000 '' holder & exec sleep 60`, TURN, queue], { stdout: 'ignore', stderr: 'ignore' })
  await soon(() => textOf(`${queue}.log`).includes('start holder'))
  const holder = (JSON.parse(readFileSync(join(queue, '1.json'), 'utf8')) as { pid: number }).pid
  process.kill(holder, 'SIGKILL')
  await soon(() => Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(holder)]).stdout.toString().startsWith('Z'))
  expect(await takeTurn(queue, { pid: process.pid, at: Date.now(), worktree: 'next', flags: '', quick: false }, 0, NO_LOCK)).toBe(false)
  expect(readdirSync(queue)).toEqual(['2.json'])
  parent.kill('SIGKILL')
}, 120000)

test('a run whose turn came still starts no gate while too little of the machine\'s memory is free, and keeps its place', async () => {
  const queue = join(shared, 'memory')
  // No machine has 101% of its memory free, so the first run waits for ever; the second waits behind it.
  const first = Bun.spawn(['bun', TURN, queue, 'first', '0', '', 'one', '101'], { stdout: 'ignore', stderr: 'pipe' })
  await soon(() => existsSync(join(queue, '1.json')))
  const second = Bun.spawn(['bun', TURN, queue, 'second', '0', '', 'two', '0'], { stdout: 'ignore', stderr: 'pipe' })
  await soon(() => existsSync(join(queue, '2.json')))
  await Bun.sleep(1500)
  expect(textOf(`${queue}.log`)).toBe('')
  first.kill('SIGKILL')
  await soon(() => textOf(`${queue}.log`).includes('end second'))
  expect(await new Response(first.stderr).text()).toContain("waiting for memory: under 101% of the machine's memory is free")
  expect(await new Response(second.stderr).text()).toContain('waiting for a turn')
}, 120000)

// A stand-in for the browser lock's folder (.artifacts/session/with-browser-lock.py): the exclusive lock is the folder
// `browser-lock` with its owner file beside it, and a waiting exclusive job's marker is `browser-lock.waiting-<pid>`.
const holds = (lock: string, owner: string): void => {
  mkdirSync(join(lock, 'browser-lock'), { recursive: true })
  writeFileSync(join(lock, 'browser-lock.owner'), owner)
}
const releases = (lock: string): void => {
  unlinkSync(join(lock, 'browser-lock.owner'))
  rmdirSync(join(lock, 'browser-lock'))
}
const waits = (lock: string, job: string, pid: number, atMs: number): void => writeFileSync(join(lock, `browser-lock.waiting-${pid}`), JSON.stringify({ job, pid, atMs }))

test('the exclusive browser jobs: the lock\'s holder while its pid lives or isn\'t written yet, and the waiters whose process lives', () => {
  const lock = join(shared, 'lock-shapes')
  expect(exclusiveBrowserJobs(lock)).toEqual([])
  mkdirSync(lock)
  const gone = Bun.spawnSync(['true']).pid
  // The slots of the browsers' jobs are no exclusive job.
  mkdirSync(join(lock, 'browser-lock-chrome-0'))
  writeFileSync(join(lock, 'browser-lock-chrome-0.owner'), JSON.stringify({ job: 'probes-chrome', pid: process.pid }))
  expect(exclusiveBrowserJobs(lock)).toEqual([])
  // The folder is made before its owner file is written.
  mkdirSync(join(lock, 'browser-lock'))
  expect(exclusiveBrowserJobs(lock)).toEqual([{ job: 'its owner file names no pid yet', pid: null, waits: false }])
  holds(lock, JSON.stringify({ job: 'bench-chrome', pid: process.pid, session: 'pretext-rebuild', at: '2026-09-19T23:00:00' }))
  expect(exclusiveBrowserJobs(lock)).toEqual([{ job: 'bench-chrome', pid: process.pid, waits: false }])
  // The main repository's checkers write their pid in a line of text.
  holds(lock, `accuracy-check pid: ${process.pid}\n`)
  expect(exclusiveBrowserJobs(lock)).toEqual([{ job: 'a checker of the main repository', pid: process.pid, waits: false }])
  // Half an owner file, which the lock script doesn't write in one step: still held, by nobody it can name.
  holds(lock, '{"job": "bench-chr')
  expect(exclusiveBrowserJobs(lock)).toEqual([{ job: 'its owner file names no pid yet', pid: null, waits: false }])
  // A dead owner's lock is there for the taking.
  holds(lock, JSON.stringify({ job: 'bench-chrome', pid: gone }))
  expect(exclusiveBrowserJobs(lock)).toEqual([])
  releases(lock)
  // A waiter counts while its process lives: not a killed one's marker, and not one whose pid is now a younger process's.
  waits(lock, 'bench-firefox', process.ppid, Date.now())
  waits(lock, 'killed', gone, Date.now())
  waits(lock, 'pid-again', process.pid, Date.now() - 3600000)
  expect(exclusiveBrowserJobs(lock)).toEqual([{ job: 'bench-firefox', pid: process.ppid, waits: true }])
})

test('a run whose turn came starts no gate while an exclusive browser job holds the browser lock or waits for it, says which, and keeps its place; a run that has started goes on', async () => {
  const queue = join(shared, 'exclusive')
  const lock = join(shared, 'lock')
  const log = (): string => textOf(`${queue}.log`)
  // Two sleeping processes stand in for a timed run that holds the lock and one that waits for it.
  const holder = Bun.spawn(['sleep', '600'])
  const waiter = Bun.spawn(['sleep', '600'])
  holds(lock, JSON.stringify({ job: 'bench-chrome', pid: holder.pid, session: 'pretext-rebuild', at: '2026-09-19T23:00:00' }))
  waits(lock, 'bench-firefox', waiter.pid, Date.now())
  const start = (name: string, hold: number) => Bun.spawn(['bun', TURN, queue, name, String(hold), '', name, '0', lock], { stdout: 'ignore', stderr: Bun.file(join(shared, `exclusive-${name}.err`)) })
  const said = (name: string): string => textOf(join(shared, `exclusive-${name}.err`))
  const first = start('first', 2000)
  await soon(() => said('first').includes(`waiting for an exclusive browser job, a timed run that gates beside it would spoil: pid ${holder.pid} (bench-chrome) holds the browser lock; pid ${waiter.pid} (bench-firefox) waits for the browser lock. --no-wait skips the wait`))
  const second = start('second', 0)
  await soon(() => said('second').includes(`waiting for a turn: pid ${first.pid} holds it`))
  // The holder is done. The waiter still waits, so still no gate starts.
  holder.kill('SIGKILL')
  releases(lock)
  await soon(() => said('first').includes(`spoil: pid ${waiter.pid} (bench-firefox) waits for the browser lock. --no-wait`))
  expect(log()).toBe('')
  // The waiter takes the lock and its marker goes, and then it is done.
  holds(lock, JSON.stringify({ job: 'bench-firefox', pid: waiter.pid }))
  unlinkSync(join(lock, `browser-lock.waiting-${waiter.pid}`))
  await soon(() => said('first').includes(`spoil: pid ${waiter.pid} (bench-firefox) holds the browser lock. --no-wait`))
  expect(log()).toBe('')
  releases(lock)
  await soon(() => log().includes('start first'))
  // A run that has started isn't stopped by a timed run that comes later; the next run waits for it.
  holds(lock, JSON.stringify({ job: 'bench-webkit-host', pid: waiter.pid }))
  await soon(() => log().includes('end first') && said('second').includes(`pid ${waiter.pid} (bench-webkit-host) holds the browser lock`))
  expect(log()).toBe('start first\nend first\n')
  // A killed holder's lock holds nobody up.
  waiter.kill('SIGKILL')
  await soon(() => log().includes('end second'))
  expect(await first.exited).toBe(0)
  expect(await second.exited).toBe(0)
}, 120000)

// ---- Reuse ----

test('the key of a run\'s inputs: every file of the working tree, the frozen references and the flags that choose gates; not --cores', () => {
  const repo = join(shared, 'repo')
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  const shard = '.artifacts/tests/reference/firefox-no-facts/inputs/smoke/part0-000.ndjson.zst'
  write('.gitignore', '.artifacts\nnode_modules\ndist\nrebuild/tests/.check/\n')
  write('rebuild/src/a.ts', 'export const a = 1\n')
  write('node_modules/typescript/package.json', '{"version":"6.0.2"}')
  write('node_modules/@types/bun/package.json', '{"version":"1.4.0"}')
  write('.artifacts/tests/reference/firefox-no-facts/inputs/manifest.json', '{"sets":{}}')
  write(shard, 'shard')
  write('.artifacts/tests/reference/firefox-no-facts/reference/manifest.json', '{"sets":{}}')
  write('.artifacts/tests/reference/firefox-facts/inputs/unfaithful.json', '{"cases":{}}')
  write('.artifacts/tests/reference/chrome-facts/inputs/manifest.json', '{"sets":{}}')
  write('.artifacts/tests/painter-frozen/facts.js', '// frozen\n')
  Bun.spawnSync(['git', 'init', '-q'], { cwd: repo })
  Bun.spawnSync(['git', 'add', '-A'], { cwd: repo })
  const run = (...args: string[]): Run => runOf(['--engine=gecko', ...args]) as Run
  const keys = [inputsKey(repo, run('--quick'))]
  // Each change gives a key no earlier state had.
  const changesFor = (of: Run, change: () => void): void => {
    change()
    const key = inputsKey(repo, of)
    expect(keys).not.toContain(key)
    keys.push(key)
  }
  const changes = (change: () => void): void => changesFor(run('--quick'), change)
  expect(inputsKey(repo, run('--quick'))).toBe(keys[0]!)
  changes(() => write('rebuild/src/a.ts', 'export const a = 2\n'))
  changes(() => write('rebuild/src/untracked.ts', ''))
  // Under rebuild also what git ignores: tsc, the unit tests and the citation ledger read its folders whole.
  changes(() => write('rebuild/src/dist/ignored.test.ts', ''))
  changes(() => unlinkSync(join(repo, 'rebuild/src/a.ts')))
  changes(() => write('package.json', '{}'))
  changes(() => write('bun.lock', ''))
  // A tracked pin of a frozen reference is a file of the tree.
  changes(() => write('rebuild/tests/reference/firefox-facts.json', '{}'))
  changes(() => write('node_modules/typescript/package.json', '{"version":"6.0.3"}'))
  changes(() => write('.artifacts/tests/reference/firefox-no-facts/inputs/manifest.json', '{"sets":{ }}'))
  changes(() => write('.artifacts/tests/reference/firefox-facts/inputs/unfaithful.json', '{"cases":{"smoke/c-1":"x"}}'))
  changes(() => write('.artifacts/tests/reference/firefox-facts/ledger/entries.ndjson', '{}\n'))
  // A shard goes in by name, size and time: the manifests hold its hash, and tier 1 checks it.
  changes(() => write(shard, 'shar'))
  changes(() => utimesSync(join(repo, shard), new Date(2026, 0, 1), new Date(2026, 0, 1)))
  changes(() => renameSync(join(repo, shard), join(repo, shard.replace('part0-000', 'part0-001'))))
  const last = keys[keys.length - 1]!
  // What this run's gates don't read: an ignored file outside rebuild, what the gates write, another engine's reference,
  // the painter's frozen bundle with --quick.
  write('.artifacts/notes.txt', 'x')
  write('dist/layout.js', '')
  write('rebuild/tests/.check/gates/gates.json', '[]')
  write('.artifacts/tests/reference/chrome-facts/inputs/manifest.json', '{"sets":{ }}')
  write('.artifacts/tests/painter-frozen/facts.js', '// frozen again\n')
  expect(inputsKey(repo, run('--quick'))).toBe(last)
  // The flags: --engine and --quick choose the gates; --cores, --no-wait and --fresh change no gate's result.
  expect(inputsKey(repo, run('--quick', '--cores=3', '--no-wait', '--fresh'))).toBe(last)
  expect(inputsKey(repo, runOf(['--quick', '--engine=webkit']) as Run)).not.toBe(last)
  const full = inputsKey(repo, run())
  expect(full).not.toBe(last)
  expect(inputsKey(repo, run('--cores=3'))).toBe(full)
  write('.artifacts/tests/painter-frozen/facts.js', '// frozen\n')
  expect(inputsKey(repo, run())).not.toBe(full)
  // Chrome's set files, which the twin scan reads and nothing pins: in the full key with Blink, and in no other.
  const blink = (...args: string[]): string => inputsKey(repo, runOf(['--engine=blink', ...args]) as Run)
  const before = [blink(), blink('--quick'), inputsKey(repo, run())]
  write('.artifacts/lab/cases/twins.ndjson', '{}\n')
  expect(blink()).not.toBe(before[0]!)
  expect([blink('--quick'), inputsKey(repo, run())]).toEqual([before[1]!, before[2]!])
  // The key walks the gates' `reads`, so whatever a gate names there is in it: a new file in each folder named, and a
  // byte more in each file, moves the key of a run with that gate.
  const all = runOf([]) as Run
  const named = [...new Set(gatesOf(all.engines, all.quick).flatMap(gate => gate.reads))]
  expect(named.length).toBeGreaterThan(30)
  for (let i = 0; i < named.length; i++) changesFor(all, () => write(extname(named[i]!) === '' ? `${named[i]!}/planted` : named[i]!, `planted ${i}\n`))
}, 120000)

test('the paths a gate\'s `reads` name are the tools\' own: replay.ts\'s reference folder and painter-diff.ts\'s frozen bundles, which gates.ts can\'t import (it must start on a tree whose library doesn\'t load)', () => {
  const gates = gatesOf(['blink', 'webkit', 'gecko'], false)
  const reads = (name: string): string[] => gates.find(gate => gate.name === name)!.reads
  for (let b = 0; b < TIER_BROWSERS.length; b++) for (let c = 0; c < CONFIGS.length; c++) {
    const pair = `${TIER_BROWSERS[b]!} ${CONFIGS[c]!}`
    const reference = ['inputs', 'reference', 'ledger'].map(part => relative(REPO, join(referenceDir(TIER_BROWSERS[b]!, CONFIGS[c]!), part)))
    expect(reads(`tier 1 ${pair}`)).toEqual(reference)
    expect(reads(`plain ${pair}`)).toEqual(reference)
    expect(reads(`pure ${pair}`)).toEqual(reference)
    expect(reads(`sweep ${pair}`)).toEqual(reference)
    expect(reads(`painter ${pair}`)).toEqual([...reference, relative(REPO, FROZEN_DIR)])
  }
  // Tier 0 and the citation ledger read the tree alone.
  expect(gates.filter(gate => gate.reads.length === 0).map(gate => gate.name.split(' ')[0]!)).toEqual(['tsc', 'tsc', 'tsc', 'tsc', 'tsc', 'tsc', 'unit', 'citations'])
})

test('a run is kept unless a gate\'s tool failed, whatever the run\'s exit code, or tier 1 sends cases to tier 2, whose ids a reused result doesn\'t write', () => {
  const row = (as: number, tier2: number): Row => ({ gate: 'a gate', exit: as, as, meaning: '', counts: '', tier2, wallSeconds: 1, log: 'a-gate.log' })
  expect(notKept([row(0, 0), row(1, 0), row(3, 0)])).toBeNull()
  expect(notKept([row(1, 0), row(2, 0)])).toContain('tool failed')
  expect(notKept([row(0, 0), row(0, 40)])).toContain('tier 2')
})

test('a kept result comes back by its key, and the last 50 stay', () => {
  const results = join(shared, 'results')
  const kept = (n: number): Kept => ({ key: `key${n}`, at: n, worktree: '/w', commit: 'abc', dirty: false, seconds: 1, exit: 3, rows: [] })
  for (let n = 0; n < 52; n++) {
    keepResult(results, kept(n))
    utimesSync(join(results, `key${n}.json`), new Date(2026, 0, 1, 0, n), new Date(2026, 0, 1, 0, n))
  }
  expect(readdirSync(results).length).toBe(50)
  expect(keptResult(results, 'key0')).toBeNull()
  expect(keptResult(results, 'key1')).toBeNull()
  expect(keptResult(results, 'key2')).toEqual(kept(2))
  // --fresh replaces a result under its key.
  keepResult(results, { ...kept(51), exit: 0 })
  expect(readdirSync(results).length).toBe(50)
  expect(keptResult(results, 'key51')).toEqual({ ...kept(51), exit: 0 })
})
