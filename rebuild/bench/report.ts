// The bench report: the JSON shape run.ts writes, its markdown rendering, and a CLI that renders saved reports and a
// cross-browser summary:
//   bun rebuild/bench/report.ts <out>/chrome-bench.json <out>/firefox-bench.json <out>/safari-bench.json > summary.md
import { readFileSync } from 'node:fs'
import type { LabApp } from '../lab/browser-build.ts'
import type { BrowserBuild } from '../lab/types.ts'
import type { ChatMixSummary } from './cases.ts'
import type {
  BrowserKind, ChatHeadline, ChatHeadlineResize, ChatPhases, ChatPlan, ChatSetId, PageEnvironment, PhaseTotals, RowCount, RowTiming, Scenario, Script,
  ScriptStyle, Settings, SizeClass, VariantResult,
} from './protocol.ts'
import { median } from './stats.ts'

export type MergedRow = RowTiming & { counts: RowCount | null }

// A chat context's plan without its messages, which cases.ts builds again from the counts, what each set holds (the timed
// messages, and the headline's where there is a headline pass), and what the page posted beside the timed rows.
export type ChatReport = Omit<ChatPlan, 'sets'> & {
  sets: { id: ChatSetId; timed: ChatMixSummary; headline: ChatMixSummary | null }[]
  headlines: ChatHeadline[]
  headlineResizes: ChatHeadlineResize[]
  phases: ChatPhases[]
}

export type ContextReport = { script: Script | 'chat'; style: ScriptStyle; environment: PageEnvironment | null; rows: MergedRow[]; chat?: ChatReport | null }

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
  // -2 added the chat context (ContextReport.chat, VariantResult.layouts, PageEnvironment.spinMs); a -1 report has none.
  schema: 'rebuild-bench-1' | 'rebuild-bench-2'
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
  settings: Settings & { scripts: Script[]; sizes: SizeClass[]; scenarios: Scenario[]; messages: number; headline?: number; headlinePasses?: number; phasePasses?: number }
  // quietWait: what --quiet-load waited for before the start snapshot, and whether the 1-minute load average got under it;
  // null or absent without the option.
  machine: { cpu: string; memoryBytes: number; start: MachineSnapshot; end: MachineSnapshot | null; quietWait?: { below: number; waitedMs: number; reached: boolean } | null }
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

// ---- Chat ----

function count(value: number): string {
  return value.toLocaleString('en-US')
}

function perLayout(value: number, layouts: number): string {
  return (value / layouts).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${(100 * part / whole).toFixed(1)}%` : 'n/a'
}

function renderChatMix(out: string[], id: string, what: string, mix: ChatMixSummary): void {
  const n = mix.messages
  out.push(`- \`${id}\`, ${what}: ${count(n)} messages, ${count(mix.units)} UTF-16 units (mean ${mix.meanUnits.toFixed(0)}, median ${mix.medianUnits}, longest ${count(mix.maxUnits)}).`)
  out.push(`  - By kind: ${mix.byKind.filter(entry => entry.messages > 0).map(entry => `${entry.kind} ${share(entry.messages, n)}`).join(', ')}.`)
  out.push(`  - By length: ${mix.byLength.map(entry => `${entry.name} ${share(entry.messages, n)}`).join(', ')}.`)
  out.push(`  - Printable ASCII only ${share(mix.ascii, n)}; with an emoji ${share(mix.withEmoji, n)}, CJK ${share(mix.withCjk, n)}, Arabic or Hebrew ${share(mix.withArabic, n)}, a URL ${share(mix.withUrl, n)}, a code span ${share(mix.withCodeSpan, n)}, a soft hyphen ${share(mix.withSoftHyphen, n)}.`)
}

function renderPhaseRow(name: string, totals: PhaseTotals, messages: number, wholeMs: number): string {
  const outside = totals.ms - totals.measureTextMs - totals.contextMs
  return `| ${name} | ${formatMs(totals.ms / messages)} | ${share(totals.ms, wholeMs)} | ${formatMs(totals.measureTextMs / messages)} | ${perLayout(totals.measureTextCalls, messages)} | ${formatMs(totals.contextMs / messages)} | ${perLayout(totals.contexts, messages)} | ${formatMs(outside / messages)} |`
}

function addTotals(a: PhaseTotals, b: PhaseTotals): PhaseTotals {
  return { ms: a.ms + b.ms, measureTextMs: a.measureTextMs + b.measureTextMs, measureTextCalls: a.measureTextCalls + b.measureTextCalls, contextMs: a.contextMs + b.contextMs, contexts: a.contexts + b.contexts }
}

function renderChat(out: string[], context: ContextReport, chat: ChatReport): void {
  out.push(`Every message is laid out at ${chat.width}px; the resize case lays it out again at ${chat.resizeWidths.join(', ')}px. No font facts are supplied. A code span is ${chat.codeFont.size}px ${chat.codeFont.family} with ${chat.codePadding}px of padding on each inline side. A layout is one message at one width.`)
  out.push('')
  for (let s = 0; s < chat.sets.length; s++) {
    const set = chat.sets[s]!
    renderChatMix(out, set.id, 'the timed rows, the counts and the phases', set.timed)
    if (set.headline !== null) renderChatMix(out, set.id, 'the headline passes', set.headline)
  }
  for (let r = 0; r < context.rows.length; r++) {
    const row = context.rows[r]!
    out.push('')
    out.push(`### ${row.id}: ${count(row.messages ?? 0)} messages, ${count(row.units)} units`)
    out.push('')
    out.push('| Variant | Median, whole set | p95 | Per layout | vs baseline | Samples × reps | First | Outliers | measureText per layout | Contexts per layout | Lines |')
    out.push('|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|')
    for (let v = 0; v < row.variants.length; v++) {
      const variant = row.variants[v]!
      const st = variant.stats
      const layouts = variant.layouts ?? 1
      const counted = row.counts?.variants.find(entry => entry.variant === variant.variant) ?? null
      const base = variant.baseline === null ? undefined : row.variants.find(entry => entry.variant === variant.baseline)
      out.push(`| ${cell(variant.variant)} | ${formatMs(st.medianMs)} | ${formatMs(st.p95Ms)} | ${formatMs(st.medianMs / layouts)} | ${base === undefined ? '' : `${ratio(st.medianMs, base.stats.medianMs)} of ${cell(base.variant)}`} | ${st.n} × ${st.reps} | ${formatMs(variant.firstMs)} | ${st.outliers} | ${counted === null ? '' : perLayout(counted.measureTextCalls, layouts)} | ${counted === null ? '' : perLayout(counted.contexts, layouts)} | ${counted === null ? '' : count(counted.lines)} |`)
    }
    if (row.counts?.rebuildModesSameLines === false) out.push('| the rebuild\'s modes, or prepare() run in two halves, gave different lines | | | | | | | | | | |')
  }
  if (chat.headlines.length > 0) {
    out.push('')
    out.push(`### Headline: ${count(chat.headline)} messages from scratch, ${chat.headlinePasses} passes`)
    out.push('')
    out.push('| Set | Library | Passes, whole set | Median | Per message | vs main | Lines |')
    out.push('|---|---|---|---:|---:|---:|---:|')
    for (let h = 0; h < chat.headlines.length; h++) {
      const headline = chat.headlines[h]!
      const rebuild = median(headline.rebuildScratchMs)
      const main = median(headline.mainColdMs)
      out.push(`| ${headline.set} | rebuild scratch, count | ${headline.rebuildScratchMs.map(formatMs).join(', ')} | ${formatMs(rebuild)} | ${formatMs(rebuild / headline.messages)} | ${ratio(rebuild, main)} | ${count(headline.lines.rebuild)} |`)
      out.push(`| | main cold | ${headline.mainColdMs.map(formatMs).join(', ')} | ${formatMs(main)} | ${formatMs(main / headline.messages)} | | ${count(headline.lines.main)} |`)
    }
    if (chat.headlineResizes.length > 0) {
      out.push('')
      out.push('The resize case on the same messages, once: all of them prepared, laid out at the first width and kept, then laid out at each resize width.')
      out.push('')
      out.push('| Set | Library | Prepare and first layout, whole set | Resize, whole set at every width | Per layout |')
      out.push('|---|---|---:|---:|---:|')
      for (let h = 0; h < chat.headlineResizes.length; h++) {
        const resize = chat.headlineResizes[h]!
        const layouts = resize.messages * resize.widths.length
        out.push(`| ${resize.set} | rebuild, count | ${formatMs(resize.rebuildPrepareAndFillMs)} | ${formatMs(resize.rebuildResizeMs)} | ${formatMs(resize.rebuildResizeMs / layouts)} |`)
        out.push(`| | main | ${formatMs(resize.mainPrepareAndLayoutMs)} | ${formatMs(resize.mainResizeMs)} | ${formatMs(resize.mainResizeMs / layouts)} |`)
      }
    }
  }
  for (let p = 0; p < chat.phases.length; p++) {
    const phases = chat.phases[p]!
    const whole = addTotals(addTotals(phases.checks, phases.prepare), phases.fill)
    out.push('')
    out.push(`### Phases, ${phases.set}: where the rebuild's from-scratch time goes (${count(phases.messages)} messages, median of ${phases.passes} instrumented passes)`)
    out.push('')
    out.push('| Phase | Per message | Share | Inside measureText | measureText calls per message | Making contexts | Contexts per message | Outside Canvas |')
    out.push('|---|---:|---:|---:|---:|---:|---:|---:|')
    out.push(renderPhaseRow('font checks', phases.checks, phases.messages, whole.ms))
    out.push(renderPhaseRow('engine prepare', phases.prepare, phases.messages, whole.ms))
    out.push(renderPhaseRow('fill every line', phases.fill, phases.messages, whole.ms))
    out.push(renderPhaseRow('all', whole, phases.messages, whole.ms))
    out.push('')
    out.push(`Of the whole: ${share(whole.measureTextMs, whole.ms)} inside measureText, ${share(whole.contextMs, whole.ms)} making contexts, ${share(whole.ms - whole.measureTextMs - whole.contextMs, whole.ms)} outside Canvas. One performance.now() call took ${formatMs(phases.nowMs)} here, and the pass makes two around every Canvas call, so it runs slower than the timed rows: read the shares here and the totals there.`)
    out.push('')
    out.push('| Kind | Messages | Mean units | Per message | font checks | engine prepare | fill | measureText calls per message | Contexts per message |')
    out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
    for (let k = 0; k < phases.byKind.length; k++) {
      const kind = phases.byKind[k]!
      const n = kind.messages
      out.push(`| ${kind.kind} | ${count(n)} | ${(kind.units / n).toFixed(0)} | ${formatMs((kind.checksMs + kind.prepareMs + kind.fillMs) / n)} | ${formatMs(kind.checksMs / n)} | ${formatMs(kind.prepareMs / n)} | ${formatMs(kind.fillMs / n)} | ${perLayout(kind.measureTextCalls, n)} | ${perLayout(kind.contexts, n)} |`)
    }
  }
}

export function renderMarkdown(report: BenchReport): string {
  const out: string[] = []
  const b = report.build
  out.push(`# Rebuild bench: ${report.browser} ${b.appVersion} (engine ${b.engine}), ${report.mode}${report.smoke ? ', smoke' : ''}`)
  out.push('')
  if (report.smoke) {
    out.push('> Harness validation only. A smoke run\'s times aren\'t benchmark numbers; its measureText calls, contexts and lines are what a real run counts.')
    out.push('')
  } else if (report.mode === 'background') {
    out.push('> Background run: the page was never visible or focused, so the OS may have run it slower than a foreground page. Compare variants within this report; for absolute times use `--foreground` on an idle Mac on power, and compare the fixed arithmetic of the two reports.')
    out.push('')
  }
  out.push(`- Status: ${report.status}${report.errors.length > 0 ? `; ${report.errors.length} errors` : ''}`)
  out.push(`- Run ${report.runId}, ${report.startedAt} to ${report.finishedAt} (${formatMs(report.durationMs)})`)
  out.push(`- OS build ${b.os}; ${report.machine.cpu}; ${(report.machine.memoryBytes / 2 ** 30).toFixed(0)} GB`)
  const end = report.machine.end
  out.push(`- Power at start: ${cell(report.machine.start.power)}; at end: ${end === null ? 'n/a' : cell(end.power)}`)
  out.push(`- Power mode: ${cell(report.machine.start.powerMode)}`)
  const quiet = report.machine.quietWait ?? null
  out.push(`- Load average at start ${report.machine.start.loadAverage}, at end ${end === null ? 'n/a' : end.loadAverage}${quiet === null ? '' : `; waited ${formatMs(quiet.waitedMs)} for a 1-minute load under ${quiet.below}, which it ${quiet.reached ? 'reached' : 'did not reach'}`}`)
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
      out.push(`${cell(e.userAgent)}; crossOriginIsolated ${e.crossOriginIsolated}; performance.now() step ${formatMs(e.timerResolutionMs)} (${e.timerSteps} steps seen); heap API ${e.heapApi ? 'yes' : 'no'}${e.spinMs === undefined ? '' : `; fixed arithmetic ${formatMs(e.spinMs.start)} before the rows, ${formatMs(e.spinMs.end)} after`}`)
      out.push('')
    }
    if (context.chat !== undefined && context.chat !== null) {
      renderChat(out, context, context.chat)
      continue
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
  out.push('Times are per repetition; a repetition is the variant\'s whole operation (see the JSON `desc`). "vs main" and "vs baseline" divide the median by its baseline\'s median in the same row. "First" is one repetition timed alone before calibration. measureText calls, contexts and lines come from one untimed repetition after all timing in the document.')
  return out.join('\n') + '\n'
}

// The chat numbers of one report's set as labelled cells, in the README's order of questions (A to D).
function chatCells(report: BenchReport, setId: ChatSetId): Map<string, string> {
  const cells = new Map<string, string>()
  const context = report.contexts.find(entry => entry.chat !== undefined && entry.chat !== null)
  if (context === undefined) return cells
  const chat = context.chat!
  const row = context.rows.find(entry => entry.id === `chat/${setId}`)
  // By its whole name, else by the start of it (the resize variants' names hold the number of widths).
  const variant = (name: string): VariantResult | undefined => row?.variants.find(entry => entry.variant === name) ?? row?.variants.find(entry => entry.variant.startsWith(name))
  const timed = (label: string, name: string): void => {
    const v = variant(name)
    if (v !== undefined) cells.set(label, `${formatMs(v.stats.medianMs / (v.layouts ?? 1))} (whole set ${formatMs(v.stats.medianMs)})`)
  }
  const counted = (label: string, name: string, what: 'measureTextCalls' | 'contexts'): void => {
    const v = variant(name)
    const c = v === undefined ? undefined : row?.counts?.variants.find(entry => entry.variant === v.variant)
    if (v !== undefined && c !== undefined) cells.set(label, perLayout(c[what], v.layouts ?? 1))
  }
  const messages = count(row?.messages ?? 0)
  timed(`A. rebuild from scratch, count mode, per message (${messages} messages)`, 'rebuild scratch, count')
  counted('A. measureText calls per message', 'rebuild scratch, count', 'measureTextCalls')
  counted('A. contexts made per message', 'rebuild scratch, count', 'contexts')
  const headline = chat.headlines.find(entry => entry.set === setId)
  if (headline !== undefined) {
    const rebuild = median(headline.rebuildScratchMs)
    cells.set(`A. headline: ${count(headline.messages)} messages from scratch, median of ${headline.rebuildScratchMs.length} passes`, `${formatMs(rebuild)} (${formatMs(rebuild / headline.messages)} per message; passes ${headline.rebuildScratchMs.map(formatMs).join(', ')})`)
  }
  timed('A. the same with the pieces read', 'rebuild scratch, pieces')
  counted('A. measureText calls per message, pieces', 'rebuild scratch, pieces', 'measureTextCalls')
  timed('A. the same prepared for inspection and inspected', 'rebuild scratch, inspect')
  counted('A. measureText calls per message, inspected', 'rebuild scratch, inspect', 'measureTextCalls')
  counted('A. contexts made per message, inspected', 'rebuild scratch, inspect', 'contexts')
  timed('B. rebuild, first layout at a new width, per layout', 'rebuild first resize')
  counted('B. measureText calls per layout, new width', 'rebuild first resize', 'measureTextCalls')
  timed('B. rebuild, layout at a width met before, per layout', 'rebuild resize')
  counted('B. measureText calls per layout, width met before', 'rebuild resize', 'measureTextCalls')
  const resize = chat.headlineResizes.find(entry => entry.set === setId)
  if (resize !== undefined) {
    const layouts = resize.messages * resize.widths.length
    cells.set(`B. headline: ${count(resize.messages)} kept paragraphs at ${resize.widths.length} new widths, once`, `${formatMs(resize.rebuildResizeMs)} (${formatMs(resize.rebuildResizeMs / layouts)} per layout); main ${formatMs(resize.mainResizeMs)} (${formatMs(resize.mainResizeMs / layouts)})`)
  }
  timed('C. main cold, per message', 'main cold')
  counted('C. main measureText calls per message', 'main cold', 'measureTextCalls')
  if (headline !== undefined) {
    const main = median(headline.mainColdMs)
    cells.set(`C. headline: main cold, ${count(headline.messages)} messages`, `${formatMs(main)} (${formatMs(main / headline.messages)} per message; passes ${headline.mainColdMs.map(formatMs).join(', ')})`)
  }
  timed('C. main layout at another width, per layout', 'main resize')
  const scratch = variant('rebuild scratch, count')
  const mainCold = variant('main cold')
  if (scratch !== undefined && mainCold !== undefined) cells.set('A against C: rebuild from scratch over main cold', ratio(scratch.stats.medianMs, mainCold.stats.medianMs))
  const first = variant('rebuild first resize')
  const mainResize = variant('main resize')
  if (first !== undefined && mainResize !== undefined) cells.set('B against C: rebuild at a new width over main layout', ratio(first.stats.medianMs, mainResize.stats.medianMs))
  timed('D. from scratch with the font checks lifted out, per message', 'rebuild scratch, count, checks lifted')
  const phases = chat.phases.find(entry => entry.set === setId)
  if (phases !== undefined) {
    const whole = addTotals(addTotals(phases.checks, phases.prepare), phases.fill)
    cells.set('D. share of from scratch: font checks / engine prepare / fill', `${share(phases.checks.ms, whole.ms)} / ${share(phases.prepare.ms, whole.ms)} / ${share(phases.fill.ms, whole.ms)}`)
    cells.set('D. share of from scratch: inside measureText / making contexts / outside Canvas', `${share(whole.measureTextMs, whole.ms)} / ${share(whole.contextMs, whole.ms)} / ${share(whole.ms - whole.measureTextMs - whole.contextMs, whole.ms)}`)
    cells.set('D. font checks: measureText calls and contexts per message', `${perLayout(phases.checks.measureTextCalls, phases.messages)} and ${perLayout(phases.checks.contexts, phases.messages)}`)
  }
  if (context.environment?.spinMs !== undefined) cells.set('Fixed arithmetic in the page, before and after', `${formatMs(context.environment.spinMs.start)}, ${formatMs(context.environment.spinMs.end)}`)
  return cells
}

function renderChatSummary(out: string[], reports: readonly BenchReport[]): void {
  const sets: ChatSetId[] = ['mix', 'latin']
  let mixShown = false
  for (let s = 0; s < sets.length; s++) {
    const perReport = reports.map(report => chatCells(report, sets[s]!))
    const labels: string[] = []
    for (let i = 0; i < perReport.length; i++) {
      const own = [...perReport[i]!.keys()]
      for (let l = 0; l < own.length; l++) if (!labels.includes(own[l]!)) labels.push(own[l]!)
    }
    if (labels.length === 0) continue
    if (!mixShown) {
      mixShown = true
      out.push('## Chat')
      out.push('')
      const chat = reports.map(report => report.contexts.find(entry => entry.chat !== undefined && entry.chat !== null)?.chat).find(entry => entry !== undefined && entry !== null)!
      for (let k = 0; k < chat.sets.length; k++) {
        renderChatMix(out, chat.sets[k]!.id, 'timed', chat.sets[k]!.timed)
        if (chat.sets[k]!.headline !== null) renderChatMix(out, chat.sets[k]!.id, 'headline', chat.sets[k]!.headline!)
      }
      out.push('')
      out.push('A layout is one message at one width. Times are medians. The letters are the README\'s questions ("Chat").')
    }
    out.push('')
    out.push(`### ${sets[s]}`)
    out.push('')
    out.push(`| | ${reports.map(report => report.browser).join(' | ')} |`)
    out.push(`|---|${reports.map(() => '---:').join('|')}|`)
    for (let l = 0; l < labels.length; l++) out.push(`| ${cell(labels[l]!)} | ${perReport.map(cells => cell(cells.get(labels[l]!) ?? '')).join(' | ')} |`)
  }
  if (mixShown) out.push('')
}

// One table across reports: median (p95) per browser, and the rebuild's ratio to its baseline. The chat rows come first,
// as per-message numbers.
export function renderSummary(reports: readonly BenchReport[]): string {
  const out: string[] = []
  out.push('# Rebuild bench summary')
  out.push('')
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i]!
    out.push(`- ${r.browser} ${r.build.appVersion} (engine ${r.build.engine}): ${r.mode}${r.smoke ? ', smoke' : ''}, ${r.status}, ${r.startedAt}, power ${cell(r.machine.start.power.split('\n')[0]!)}, load ${r.machine.start.loadAverage} at start and ${r.machine.end?.loadAverage ?? 'n/a'} at end${r.smoke ? '; smoke: harness validation only' : ''}`)
  }
  out.push('')
  renderChatSummary(out, reports)
  out.push('## Every row')
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
          const key = `${row.id}\0${variant.variant}`
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
    const [id, variant] = keys[k]!.split('\0') as [string, string]
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
