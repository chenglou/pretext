// The bench report: the JSON shape run.ts writes, its markdown rendering, and a CLI that renders saved reports and a
// cross-browser summary:
//   bun rebuild/bench/report.ts <out>/chrome-bench.json <out>/firefox-bench.json <out>/safari-bench.json > summary.md
import { readFileSync } from 'node:fs'
import type { LabApp } from '../lab/browser-build.ts'
import type { BrowserBuild } from '../lab/types.ts'
import type { BrowserKind, PageEnvironment, RowCount, RowTiming, Scenario, Script, ScriptStyle, Settings, SizeClass } from './protocol.ts'

export type MergedRow = RowTiming & { counts: RowCount | null }

export type ContextReport = { script: Script; style: ScriptStyle; environment: PageEnvironment | null; rows: MergedRow[] }

export type MachineSnapshot = {
  at: string
  // The first two lines of `pmset -g batt`.
  power: string
  // `pmset -g` lowpowermode / powermode lines.
  powerMode: string
  // `sysctl -n vm.loadavg`.
  loadAverage: string
  // `ps -Ao pcpu,pid,comm -r`, the top 8.
  topProcesses: string[]
  // Other browser automation seen: lab or bench profiles, webkit-host, lab and wrapping-suite drivers, not this run's.
  otherJobs: string[]
}

export type LockState = {
  ownerFile: string
  owner: unknown
  // The owner pid is this driver's parent, the with-browser-lock.py wrapper.
  ours: boolean
}

export type BenchReport = {
  schema: 'rebuild-bench-1'
  status: 'ok' | 'error'
  errors: string[]
  mode: 'foreground' | 'background'
  smoke: boolean
  browser: BrowserKind
  build: BrowserBuild
  // The bundle the run launched (lab/browser-build.ts labApp): its path, whether it is a pinned copy, and the copy's tree
  // hash; null for webkit-host. Absent in reports from before 2026-09-18, which launched the installed browsers.
  app?: LabApp | null
  runId: string
  startedAt: string
  finishedAt: string
  durationMs: number
  settings: Settings & { scripts: Script[]; sizes: SizeClass[]; scenarios: Scenario[]; messages: number }
  machine: { cpu: string; memoryBytes: number; start: MachineSnapshot; end: MachineSnapshot | null }
  lock: { start: LockState; end: LockState | null }
  source: { head: string; status: string[]; srcSha256: string; rebuildSrcSha256: string }
  bundleBytes: number
  // Rows whose page wasn't visible and focused at their start or end (foreground mode), or whose DPR or viewport changed.
  environmentViolations: string[]
  contexts: ContextReport[]
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a'
  if (ms < 1) return `${(ms * 1000).toPrecision(3)} µs`
  if (ms < 1000) return `${ms.toPrecision(3)} ms`
  return `${(ms / 1000).toPrecision(3)} s`
}

function ratio(value: number, base: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) return ''
  return `×${(value / base).toPrecision(3)}`
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function rowLabel(row: MergedRow): string {
  return row.kind === 'many' ? `${row.id} (${row.messages} messages)` : row.id
}

export function renderMarkdown(report: BenchReport): string {
  const out: string[] = []
  const b = report.build
  out.push(`# Rebuild bench: ${report.browser} ${b.appVersion} (engine ${b.engine}), ${report.mode}${report.smoke ? ', smoke' : ''}`)
  out.push('')
  if (report.smoke || report.mode === 'background') {
    out.push('> Harness validation only. Background or smoke runs aren\'t benchmark numbers: real numbers need `--foreground` on an idle Mac on power.')
    out.push('')
  }
  out.push(`- Status: ${report.status}${report.errors.length > 0 ? `; ${report.errors.length} errors` : ''}`)
  out.push(`- Run ${report.runId}, ${report.startedAt} to ${report.finishedAt} (${formatMs(report.durationMs)})`)
  out.push(`- OS build ${b.os}; ${report.machine.cpu}; ${(report.machine.memoryBytes / 2 ** 30).toFixed(0)} GB`)
  const end = report.machine.end
  out.push(`- Power at start: ${cell(report.machine.start.power)}; at end: ${end === null ? 'n/a' : cell(end.power)}`)
  out.push(`- Power mode: ${cell(report.machine.start.powerMode)}`)
  out.push(`- Load average at start ${report.machine.start.loadAverage}, at end ${end === null ? 'n/a' : end.loadAverage}`)
  const others = [...new Set([...report.machine.start.otherJobs, ...(end === null ? [] : end.otherJobs)])]
  out.push(`- Other browser jobs seen: ${others.length === 0 ? 'none' : cell(others.join('; '))}`)
  out.push(`- Browser lock: ${report.lock.start.ours ? 'held by this run\'s wrapper' : `not this run's (${cell(JSON.stringify(report.lock.start.owner))})`}`)
  out.push(`- Source: HEAD ${report.source.head}; src sha256 ${report.source.srcSha256.slice(0, 12)}; rebuild/src sha256 ${report.source.rebuildSrcSha256.slice(0, 12)}; ${report.source.status.length === 0 ? 'clean' : `changed: ${cell(report.source.status.join(', '))}`}`)
  const s = report.settings
  out.push(`- Settings: samples ${s.minSamples}-${s.samples}, warm-up ${s.warmup}, min sample ${s.minSampleMs} ms, budget ${s.budgetMs} ms per row, ${s.messages} messages; bundle ${(report.bundleBytes / 1024).toFixed(0)} KB`)
  if (report.environmentViolations.length > 0) out.push(`- Environment violations: ${cell(report.environmentViolations.join('; '))}`)
  for (let i = 0; i < report.errors.length; i++) out.push(`- Error: ${cell(report.errors[i]!.split('\n')[0]!)}`)
  for (let c = 0; c < report.contexts.length; c++) {
    const context = report.contexts[c]!
    const e = context.environment
    out.push('')
    out.push(`## ${context.script}: ${context.style.font.size}px ${context.style.font.family}, lang ${context.style.lang}, ${context.style.direction}`)
    out.push('')
    if (e !== null) {
      out.push(`${cell(e.userAgent)}; crossOriginIsolated ${e.crossOriginIsolated}; performance.now() step ${formatMs(e.timerResolutionMs)} (${e.timerSteps} steps seen); heap API ${e.heapApi ? 'yes' : 'no'}`)
      out.push('')
    }
    out.push('| Row | Units | Variant | Median | p95 | vs main | Samples × reps | First | Outliers | Heap drops | measureText | Contexts | Lines |')
    out.push('|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for (let r = 0; r < context.rows.length; r++) {
      const row = context.rows[r]!
      const medians = new Map<string, number>()
      for (let v = 0; v < row.variants.length; v++) medians.set(row.variants[v]!.variant, row.variants[v]!.stats.medianMs)
      for (let v = 0; v < row.variants.length; v++) {
        const variant = row.variants[v]!
        const st = variant.stats
        const count = row.counts?.variants.find(entry => entry.variant === variant.variant) ?? null
        const base = variant.baseline === null ? Number.NaN : medians.get(variant.baseline) ?? Number.NaN
        out.push(`| ${v === 0 ? cell(rowLabel(row)) : ''} | ${v === 0 ? row.units.toLocaleString('en-US') : ''} | ${cell(variant.variant)} | ${formatMs(st.medianMs)} | ${formatMs(st.p95Ms)} | ${ratio(st.medianMs, base)} | ${st.n} × ${st.reps} | ${formatMs(variant.firstMs)} | ${st.outliers} | ${st.heapDropSamples ?? 'n/a'} | ${count === null ? '' : count.measureTextCalls.toLocaleString('en-US')} | ${count === null ? '' : count.contexts.toLocaleString('en-US')} | ${count === null ? '' : count.lines.toLocaleString('en-US')} |`)
      }
      if (row.counts?.rebuildModesSameLines === false) out.push(`| | | the rebuild's modes gave different lines | | | | | | | | | | |`)
    }
  }
  out.push('')
  out.push('Times are per repetition; a repetition is the variant\'s whole operation (see the JSON `desc`). "vs main" divides the median by its baseline\'s median in the same row. "First" is one repetition timed alone before calibration. measureText calls, contexts and lines come from one untimed repetition after all timing in the document.')
  return out.join('\n') + '\n'
}

// One table across reports: median (p95) per browser, and the rebuild's ratio to its baseline.
export function renderSummary(reports: readonly BenchReport[]): string {
  const out: string[] = []
  out.push('# Rebuild bench summary')
  out.push('')
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]!
    out.push(`- ${r.browser} ${r.build.appVersion} (engine ${r.build.engine}): ${r.mode}${r.smoke ? ', smoke' : ''}, ${r.status}, ${r.startedAt}, power ${cell(r.machine.start.power.split('\n')[0]!)}, load ${r.machine.start.loadAverage}`)
  }
  out.push('')
  out.push(`| Row | Variant | ${reports.map(r => `${r.browser} median (p95) | vs main`).join(' | ')} |`)
  out.push(`|---|---|${reports.map(() => '---:|---:').join('|')}|`)
  const keys: string[] = []
  const seen = new Set<string>()
  type Entry = { row: MergedRow; median: number; p95: number; base: number }
  const byReport: Array<Map<string, Entry>> = []
  for (let i = 0; i < reports.length; i++) {
    const map = new Map<string, Entry>()
    const contexts = reports[i]!.contexts
    for (let c = 0; c < contexts.length; c++) {
      for (let r = 0; r < contexts[c]!.rows.length; r++) {
        const row = contexts[c]!.rows[r]!
        for (let v = 0; v < row.variants.length; v++) {
          const variant = row.variants[v]!
          const key = `${row.id} ${variant.variant}`
          const base = variant.baseline === null ? Number.NaN : row.variants.find(entry => entry.variant === variant.baseline)?.stats.medianMs ?? Number.NaN
          map.set(key, { row, median: variant.stats.medianMs, p95: variant.stats.p95Ms, base })
          if (!seen.has(key)) {
            seen.add(key)
            keys.push(key)
          }
        }
      }
    }
    byReport.push(map)
  }
  for (let k = 0; k < keys.length; k++) {
    const [id, variant] = keys[k]!.split(' ') as [string, string]
    const cells: string[] = []
    for (let i = 0; i < reports.length; i++) {
      const entry = byReport[i]!.get(keys[k]!)
      cells.push(entry === undefined ? ' | ' : `${formatMs(entry.median)} (${formatMs(entry.p95)}) | ${ratio(entry.median, entry.base)}`)
    }
    out.push(`| ${cell(id)} | ${cell(variant)} | ${cells.join(' | ')} |`)
  }
  return out.join('\n') + '\n'
}

if (import.meta.main) {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('Usage: bun rebuild/bench/report.ts <browser>-bench.json...')
    process.exit(2)
  }
  const reports: BenchReport[] = []
  for (let i = 0; i < files.length; i++) reports.push(JSON.parse(readFileSync(files[i]!, 'utf8')) as BenchReport)
  process.stdout.write(reports.length === 1 ? renderMarkdown(reports[0]!) : renderSummary(reports))
}
