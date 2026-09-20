// The cores of a gates run (gates.ts shareCores, cores.ts withCore): checks that start at once against a listener that
// accepts nothing meanwhile, which is a gates run's start under load, and a check that dies.
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shareCores } from './gates.ts'

const dir = mkdtempSync(join(tmpdir(), 'cores-test-'))
afterAll(() => { rmSync(dir, { recursive: true }) })

// A check: every request at once, as --jobs children are asked for at a check's start; a line when a request holds its
// core and one when it gives it back. It ends by itself: it closes nothing and calls no exit, as twin-scan.ts does.
const CHECK = join(dir, 'check.ts')
writeFileSync(CHECK, `import { appendFileSync, writeFileSync } from 'node:fs'
import { withCore } from ${JSON.stringify(join(import.meta.dir, 'cores.ts'))}
const [log, ready, requests, hold] = process.argv.slice(2)
writeFileSync(ready, '')
await Promise.all(Array.from({ length: Number(requests) }, (_, i) => withCore(i % 4 === 0, async () => {
  appendFileSync(log, 'start\\n')
  await Bun.sleep(Number(hold))
  appendFileSync(log, 'end\\n')
})))
`)
const linesOf = (path: string): string[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(line => line !== '') : [])
const soon = async (what: () => boolean): Promise<void> => { while (!what()) await Bun.sleep(50) }
const check = (socket: string, holder: number, log: string, ready: string, requests: number, hold: number) =>
  Bun.spawn(['bun', CHECK, log, ready, String(requests), String(hold)], { env: { ...process.env, PRETEXT_GATES_CORES: socket, PRETEXT_GATES_HOLDER: String(holder) }, stdout: 'ignore', stderr: 'pipe' })

test('31 checks of 16 requests each start at once while the listener accepts nothing: every request gets its core, never more than the cores at once', async () => {
  // A full run on 16 cores: 31 gates that replay shards, --jobs=16 each. macOS keeps 128 connections that a listener
  // hasn't accepted (kern.ipc.somaxconn) and refuses the next at once, so a connection a request lost 352 of 480 here.
  const CHECKS = 31
  const REQUESTS = 16
  const CORES = 8
  const socket = join(dir, 'at-once.sock')
  const log = join(dir, 'at-once.log')
  const ready = join(dir, 'at-once-ready')
  mkdirSync(ready)
  const shared = shareCores(CORES, socket)
  const checks = Array.from({ length: CHECKS }, (_, i) => check(socket, i, log, join(ready, String(i)), REQUESTS, 2))
  // This process accepts nothing until every check has started, and for a moment more while their requests arrive: a
  // gates run is as busy while it starts its gates.
  while (readdirSync(ready).length < CHECKS) Bun.sleepSync(20)
  Bun.sleepSync(500)
  for (let i = 0; i < checks.length; i++) expect({ check: i, exit: await checks[i]!.exited, stderr: await new Response(checks[i]!.stderr).text() }).toEqual({ check: i, exit: 0, stderr: '' })
  shared.stop()
  const lines = linesOf(log)
  expect(lines.length).toBe(2 * CHECKS * REQUESTS)
  let held = 0
  let most = 0
  for (let i = 0; i < lines.length; i++) {
    held += lines[i] === 'start' ? 1 : -1
    most = Math.max(most, held)
  }
  expect(held).toBe(0)
  expect(most).toBe(CORES)
}, 300000)

test('a check that dies gives back the cores it holds, and its waiting requests no longer wait', async () => {
  const socket = join(dir, 'dies.sock')
  const shared = shareCores(4, socket)
  // Six requests on four cores: four hold a core for a minute, two wait.
  const first = check(socket, 0, join(dir, 'first.log'), join(dir, 'first-ready'), 6, 60000)
  await soon(() => linesOf(join(dir, 'first.log')).length === 4)
  const second = check(socket, 1, join(dir, 'second.log'), join(dir, 'second-ready'), 4, 300)
  await soon(() => existsSync(join(dir, 'second-ready')))
  await Bun.sleep(300)
  expect(linesOf(join(dir, 'second.log'))).toEqual([])
  first.kill('SIGKILL')
  // All four at once: the dead check's two waiting requests took none of the cores that came back.
  await soon(() => linesOf(join(dir, 'second.log')).length >= 4)
  expect(linesOf(join(dir, 'second.log')).slice(0, 4)).toEqual(['start', 'start', 'start', 'start'])
  expect(await second.exited).toBe(0)
  // This process's own parts take and give cores beside the socket's.
  await Promise.all([0, 1, 2, 3].map(holder => shared.take(holder)))
  let fifth = false
  void shared.take(4).then(() => { fifth = true })
  await Bun.sleep(50)
  expect(fifth).toBe(false)
  shared.give()
  await soon(() => fifth)
  shared.stop()
}, 120000)
