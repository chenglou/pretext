// The offline gates inside a job under the browser lock (gates.ts takeTurn): a run that such a job starts waits for no
// exclusive job, since the job keeps its lock until the run ends and an exclusive job starts only once it has every
// lock. Before, the wait never ended: with the lock script itself, `with-browser-lock.py timed-gates --exclusive -- bun
// <a turn>` said "pid N (timed-gates) holds the browser lock" until it was killed, and held every browser slot meanwhile;
// so did a turn inside a job with a Chrome slot once an exclusive job had taken the lock and waited for that slot
// (2026-09-20).
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'gates-own-job-test-'))
afterAll(() => { rmSync(dir, { recursive: true }) })
const TURN = join(dir, 'turn.ts')
writeFileSync(TURN, `import { appendFileSync } from 'node:fs'
import { takeTurn } from ${JSON.stringify(join(import.meta.dir, 'gates.ts'))}
const [queue, lock] = process.argv.slice(2)
await takeTurn(queue, { pid: process.pid, at: Date.now(), worktree: 'a worktree', flags: '', quick: false }, 0, lock)
appendFileSync(queue + '.log', 'start\\n')
`)
const textOf = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const soon = async (what: () => boolean): Promise<void> => { while (!what()) await Bun.sleep(50) }
// A stand-in for the browser lock's folder: the exclusive lock held by `holder`, `waiter` waiting for it, and a Chrome
// slot held by `slot`.
const lockOf = (name: string, holder: number, waiter: number, slot: number): string => {
  const lock = join(dir, name)
  mkdirSync(join(lock, 'browser-lock'), { recursive: true })
  writeFileSync(join(lock, 'browser-lock.owner'), JSON.stringify({ job: 'timed-gates', pid: holder }))
  writeFileSync(join(lock, `browser-lock.waiting-${waiter}`), JSON.stringify({ job: 'bench-firefox', pid: waiter, atMs: Date.now() }))
  mkdirSync(join(lock, 'browser-lock-chrome-0'))
  writeFileSync(join(lock, 'browser-lock-chrome-0.owner'), JSON.stringify({ job: 'sets-chrome', pid: slot }))
  return lock
}
// The run is started by a shell, as a wrapper script starts it, so this process is two above it.
const turn = (queue: string, lock: string) => Bun.spawn(['sh', '-c', `bun ${TURN} ${queue} ${lock}; true`], { stdout: 'ignore', stderr: Bun.file(`${queue}.err`) })

test('a run that a job under the browser lock starts waits for no exclusive job, whether its job holds the exclusive lock or a browser\'s slot; the same run beside those jobs waits', async () => {
  const holder = Bun.spawn(['sleep', '600'])
  const waiter = Bun.spawn(['sleep', '600'])
  const slot = Bun.spawn(['sleep', '600'])
  // This process stands in for the lock script. It holds the exclusive lock, and its command starts the run.
  const own = join(dir, 'own')
  expect(await turn(own, lockOf('own-lock', process.pid, waiter.pid, slot.pid)).exited).toBe(0)
  expect([textOf(`${own}.log`), textOf(`${own}.err`)]).toEqual(['start\n', ''])
  // It holds a Chrome slot, and an exclusive job that has taken the lock waits for that slot, so for the run.
  const chain = join(dir, 'chain')
  expect(await turn(chain, lockOf('chain-lock', holder.pid, waiter.pid, process.pid)).exited).toBe(0)
  expect([textOf(`${chain}.log`), textOf(`${chain}.err`)]).toEqual(['start\n', ''])
  // The same files with nobody above the run: it waits, for the holder and for the waiter.
  const beside = join(dir, 'beside')
  const outside = turn(beside, lockOf('beside-lock', holder.pid, waiter.pid, slot.pid))
  await soon(() => textOf(`${beside}.err`).includes(`pid ${holder.pid} (timed-gates) holds the browser lock; pid ${waiter.pid} (bench-firefox) waits for the browser lock`))
  expect(textOf(`${beside}.log`)).toBe('')
  holder.kill('SIGKILL')
  waiter.kill('SIGKILL')
  expect(await outside.exited).toBe(0)
  expect(textOf(`${beside}.log`)).toBe('start\n')
  slot.kill('SIGKILL')
}, 120000)
