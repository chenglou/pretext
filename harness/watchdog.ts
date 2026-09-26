// Kills its process once it holds more than 1 GB, 2 GB for bun test itself, once the process that started it is gone, or
// once its main thread has run no timer for 30 s. A defect can make a line walker loop without end inside the library,
// where no bound in the code calling it reaches. Such a walker can take a gigabyte a second until the machine stalls,
// even in a child that the test which started it has given up on, or spin without allocating, which only a time limit
// ends. A worker checks every 100 ms, as it runs while the walker spins, and the main thread stamps a shared clock every
// second. `bun test` preloads this file (bunfig.toml), but bun reads that only when started from the repository root, so
// each test file that runs the library in bun test's own process imports it first as well; either way it runs once. The
// processes the tests start load it first. When nothing is wrong, each process holds about half its limit at most, and
// a main thread goes at most 4 s without a timer. The message names what running() last named, and is best effort:
// once the parent is gone, stderr can be a pipe nobody reads.
import { Worker } from 'node:worker_threads'

// bun test puts a test file where the script goes.
const test = process.argv[1]?.endsWith('.test.ts') === true
const name = JSON.stringify(test ? 'bun test' : process.argv.slice(1).join(' ').slice(0, 200))
const limit = test ? 2048 : 1024
const start = Date.now()
// The seconds since `start` when the main thread last ran a timer.
const clock = new Int32Array(new SharedArrayBuffer(4))
setInterval(() => Atomics.store(clock, 0, Math.floor((Date.now() - start) / 1000)), 1000).unref()
// What the process is running, for the message: a test file names itself while bun test runs it.
const label = new Uint8Array(new SharedArrayBuffer(256))
export function running(what: string): void {
  label.fill(0)
  new TextEncoder().encodeInto(what, label)
}
new Worker(`const { writeSync } = require('node:fs')
const { workerData: { clock, label } } = require('node:worker_threads')
setInterval(() => {
  const mb = Math.round(process.memoryUsage().rss / 2 ** 20)
  const stalled = Math.floor((Date.now() - ${start}) / 1000) - Atomics.load(clock, 0)
  if (mb <= ${limit} && process.ppid === ${process.ppid} && stalled < 30) return
  const why = mb > ${limit} ? ' holds ' + mb + ' MB' : process.ppid !== ${process.ppid} ? ': the process that started it is gone' : ' ran no timer for ' + stalled + ' s'
  const what = new TextDecoder().decode(label.slice(0, label.indexOf(0) < 0 ? label.length : label.indexOf(0)))
  try { writeSync(2, ${name} + (what === '' ? '' : ' (' + what + ')') + why + ', killing it\\n') } catch {}
  process.kill(process.pid, 'SIGKILL')
}, 100)`, { eval: true, workerData: { clock, label } }).unref()
