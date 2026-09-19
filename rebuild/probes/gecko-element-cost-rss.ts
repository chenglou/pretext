// Runs one `M rss` probe of gecko-element-cost.ts through runner.ts and samples the resident size of the launched
// Firefox's processes with ps every 250 ms beside it. The probe's page records Date.now() marks; this joins the two clocks
// (one machine) and writes <out>/rss.json: per mark, the resident size in KiB of the content process that grew most between
// the first mark and `settled 10,000`, and of all the instance's processes together. Resident size is what ps reports (rss):
// it leaves out compressed and swapped pages, so read a fall with care on a machine short of memory.
//
// Run, one kind per browser process so no run inherits another's heap:
//   python3 .artifacts/session/with-browser-lock.py ff-element-rss -- bun rebuild/probes/gecko-element-cost-rss.ts \
//     --only='M rss offscreen' --out=<out>
// Exits with the runner's exit code, or 1 when the marks or the samples are missing.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

type Sample = { at: number; pid: number; ppid: number; rss: number; main: boolean }
type Mark = { name: string; at: number }

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i++) {
  const match = /^--([a-z-]+)=(.*)$/.exec(process.argv[i]!)
  if (match === null) throw new Error(`Unknown argument ${process.argv[i]!}`)
  args.set(match[1]!, match[2]!)
}
const only = args.get('only')
const out = args.get('out')
if (only === undefined || out === undefined) throw new Error('Usage: bun rebuild/probes/gecko-element-cost-rss.ts --only=<M rss probe id substring> --out=<dir>')
const outDir = resolve(out)
mkdirSync(outDir, { recursive: true })

const samples: Sample[] = []
// Instances that were already running belong to other jobs.
let others: number[] | null = null
function sample(): void {
  const at = Date.now()
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (ps.status !== 0) return
  const lines = ps.stdout.split('\n')
  const rows: Array<{ pid: number; ppid: number; rss: number; command: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(lines[i]!)
    if (match !== null) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]), command: match[4]! })
  }
  // The runner's profile folder names the instance; its children are the content and helper processes.
  const mains = new Set<number>()
  for (let i = 0; i < rows.length; i++) if (rows[i]!.command.includes('/profiles/probes-firefox-') && rows[i]!.command.includes('--remote-debugging-port')) mains.add(rows[i]!.pid)
  if (others === null) {
    others = [...mains]
    return
  }
  for (let i = 0; i < others.length; i++) mains.delete(others[i]!)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    if (mains.has(row.pid) || mains.has(row.ppid)) samples.push({ at, pid: row.pid, ppid: row.ppid, rss: row.rss, main: mains.has(row.pid) })
  }
}

sample()
const runner = spawn('bun', [join(import.meta.dir, 'runner.ts'), '--browser=firefox', `--probes=${join(import.meta.dir, 'gecko-element-cost.ts')}`,
  `--only=${only}`, `--out=${outDir}`, '--probe-timeout-ms=120000', '--stall-ms=180000'], { stdio: 'inherit' })
const timer = setInterval(sample, 250)
const code = await new Promise<number>(done => runner.on('exit', status => done(status ?? 1)))
clearInterval(timer)

function finish(): number {
  if (code !== 0) return code
  const result = JSON.parse(readFileSync(join(outDir, 'firefox-probes.json'), 'utf8')) as { results: Array<{ id: string; result: { observations: Array<{ value?: { kind: string; marks: Mark[] } }> } | null }> }
  const value = result.results[0]?.result?.observations[0]?.value
  if (value === undefined || value.marks === undefined || samples.length === 0) return 1
  const marks = value.marks
  const pids = [...new Set(samples.filter(s => !s.main).map(s => s.pid))]
  // A process's resident size at a time: its last sample at or before it.
  const rssAt = (pid: number, at: number): number | null => {
    let found: number | null = null
    for (let i = 0; i < samples.length; i++) if (samples[i]!.pid === pid && samples[i]!.at <= at) found = samples[i]!.rss
    return found
  }
  const first = marks[0]!.at
  const peak = marks.find(m => m.name === 'settled 10,000')!.at
  let content = -1
  let growth = -Infinity
  for (let i = 0; i < pids.length; i++) {
    const a = rssAt(pids[i]!, first), b = rssAt(pids[i]!, peak)
    if (a !== null && b !== null && b - a > growth) { growth = b - a; content = pids[i]! }
  }
  // The page waits before every mark but the two `made` ones, so the last sample before a mark is a settled one.
  const rows = marks.map(m => {
    let all = 0
    const everyPid = [...new Set(samples.map(s => s.pid))]
    for (let i = 0; i < everyPid.length; i++) all += rssAt(everyPid[i]!, m.at) ?? 0
    return { mark: m.name, at: m.at, contentKiB: rssAt(content, m.at), allProcessesKiB: all }
  })
  writeFileSync(join(outDir, 'rss-samples.json'), `${JSON.stringify(samples)}\n`)
  writeFileSync(join(outDir, 'rss.json'), `${JSON.stringify({ kind: value.kind, contentPid: content, processes: pids.length + 1, samples: samples.length, rows }, null, 2)}\n`)
  console.log(JSON.stringify({ kind: value.kind, rows }, null, 2))
  return 0
}

process.exit(finish())
