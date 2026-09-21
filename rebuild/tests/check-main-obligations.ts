// The original main/native catalog supplies case obligations; fresh opposing-order native runs test them. Visible
// source ranges are checked equally for plain, inspected and main predictions, without an observation port or gap waiver.
//
// bun rebuild/tests/check-main-obligations.ts --cases=<fast-cases.ndjson> --obligations=<fast-obligations.ndjson>
//   --forward=<redo-forward/browser-rows.ndjson> --reverse=<redo-reverse/browser-rows.ndjson> --out=<new report.json>
//   [--plain-forward=<rows> --plain-reverse=<rows>] [--main-forward=<rows> --main-reverse=<rows>]
//   [--control-forward=<usual rows> --control-reverse=<usual rows>] [--label=redo|main]
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { lineRanges } from '../lab/compare-rows.ts'
import { measureFirstDocuments, measureFirstRowProblem } from '../lab/measure-first.ts'
import { existingRows, readLines } from '../lab/rows.ts'
import { environmentKey, nativeDifference, nativeHyphenReportRects, nativeView, rowText, scoreRow, withNativeRow, type Metric, type NativeView } from '../lab/score.ts'
import type { Case, LabRow } from '../lab/types.ts'

type Order = 'forward' | 'reverse'
type Role = 'redo' | 'plain' | 'main' | 'control'
type Outcome = { status: 'pass' | 'fail' | 'inconclusive' | 'protocol'; reason?: string; detail?: string }
type Obligation = { id: string; family: string; required: { lineCount: string; visibleBreaks: string } | null; native: { lines: number; key: string }; knownNativeHistory?: boolean }
export type RangeEvaluation = { lineCount: Outcome; visibleBreaks: Outcome; nativeLines: number | null; ranges: Array<[number, number]> | null }
export type CheckOptions = { cases: string; obligations: string; forward: string; reverse: string; out?: string; label?: 'redo' | 'main'; plainForward?: string; plainReverse?: string; mainForward?: string; mainReverse?: string; controlForward?: string; controlReverse?: string }
type RunRecord = { status: string; order: string; predictOnly: boolean; measureFirst: unknown; predictor: string; bundleSha256: string; totals: { rows: number }; chunkSize: number; partCases: number | null; partMs: number | null }
type Loaded = { role: Role; order: Order; path: string; recordPath: string; record: RunRecord; rows: Map<string, LabRow>; hash: string; recordHash: string; unexpected: string[] }
type Evaluated = { evaluation: RangeEvaluation; row: LabRow | null; view: NativeView | null; nativeSource: string }
type Issue = { kind: string; detail: string }
export type CaseResult = { id: string; family: string; status: 'pass' | 'fail' | 'inconclusive' | 'review'; knownNativeHistory: boolean; outcomes: Array<{ role: Role; order: Order; nativeSource: string; evaluation: RangeEvaluation }>; issues: Issue[]; mainBaselineFailed: boolean }

const inconclusive = (reason: string, detail?: string): Outcome => ({ status: 'inconclusive', reason, ...(detail === undefined ? {} : { detail }) })
function asOutcome(metric: Metric): Outcome { return { ...metric, status: metric.status === 'pass' || metric.status === 'fail' ? metric.status : 'inconclusive' } }
function noEvaluation(reason: string, detail?: string): RangeEvaluation { return { lineCount: inconclusive(reason, detail), visibleBreaks: inconclusive(reason, detail), nativeLines: null, ranges: null } }

// Input-only check of the lab paragraph's observed content-box width. No value comes from a predictor.
// page.ts builds an absolutely positioned block at x=0, with zero margin/padding/border, content-box sizing,
// and width `<Case.paragraph.width>px`; inline children/floats can overflow but do not enlarge that box.
//
// Browser source provenance (the primary implementation references are preserved in these checked-in notes):
// - Blink: computed fixed CSS length -> float32(width*devicePixelRatio), LayoutUnit(float) truncates at 1/64
//   zoomed px, then reports float32(LayoutUnit/64 × float32(1/zoom)) at the paragraph origin x=0
//   (rebuild/specs/blink-lines.md §2.1–2.2; rebuild/research/observe-blink.md §4.1/4.7;
//   layout_unit.h:125–130; length_functions.cc).
// - WebKit: LayoutUnit(float) truncates the float32 CSS length at 1/64px
//   (rebuild/specs/webkit-lines.md; platform/LayoutUnit.h:76–78). The lab's WebKit recipe supplies pageZoom=1.
// - Gecko: CSS length -> NSToIntRound(float32(width)*60), then DOMRect::SetLayoutRect rounds each au edge
//   to 1/65536px and SetRect narrows to float32 (rebuild/specs/gecko-lines.md §2.2;
//   rebuild/research/observe-gecko.md §2.4; DOMRect.cpp:152–164 and DOMRect.h:122–127).
//
// Scope: the actual untransformed, installed-browser lab recipe. Unemulated Blink uses window.devicePixelRatio
// (browser zoom included). A DevTools/headless device-scale override can make it differ from layout zoom; that
// observation protocol needs a separately recorded layout zoom before this check can certify it. Blink uses DPR,
// not visualViewport.scale (pinch zoom). WebKit's pageZoom=1 is the driver/predictor recipe, not an inference
// about arbitrary Safari tabs. Gecko widths are limited to the source-audited exact transform range (<2^23au);
// unsupported/clamped extremes require a new native protocol review rather than tolerance or a guessed pass.
type Input = Pick<LabRow, 'browser' | 'case' | 'env'>
type ExpectedParagraphWidth = { value: number; encoding: string } | { error: string }
const f32 = Math.fround
function expectedParagraphWidth(row: Input): ExpectedParagraphWidth {
  const width = row.case.paragraph.width
  if (!Number.isFinite(width) || width < 0) return { error: 'declared paragraph width must be finite and nonnegative' }
  switch (row.browser) {
    case 'chrome': {
      const zoom = row.env.devicePixelRatio
      if (!Number.isFinite(zoom) || zoom <= 0) return { error: 'Blink layout zoom requires a positive finite recorded devicePixelRatio' }
      const layoutZoom = f32(zoom)
      const raw = f32(f32(width * layoutZoom) * 64)
      if (!Number.isFinite(raw) || raw > 0x7fffffff) return { error: 'Blink width exceeds the reviewed unclamped LayoutUnit range' }
      return { value: f32(f32(Math.trunc(raw) / 64) * f32(1 / layoutZoom)), encoding: 'Blink double CSS length × float layout zoom → float32/truncated zoomed LayoutUnits → float32 inverse-zoom client bounds' }
    }
    case 'safari':
    case 'webkit-host': {
      const raw = f32(f32(width) * 64)
      if (!Number.isFinite(raw) || raw > 0x7fffffff) return { error: 'WebKit width exceeds the reviewed unclamped LayoutUnit range' }
      return { value: Math.trunc(raw) / 64, encoding: 'WebKit pageZoom=1: float32 CSS length → truncated LayoutUnits' }
    }
    case 'firefox': {
      const product = f32(f32(width) * 60), au = Math.floor(product + 0.5)
      if (!Number.isFinite(product) || au >= 0x800000) return { error: 'Gecko width exceeds the reviewed exact client-bounds transform range (<2^23au)' }
      return { value: f32(Math.floor(au * (65536 / 60) + 0.5) / 65536), encoding: 'Gecko float32 CSS length → rounded au → rounded 1/65536px edge → float32 DOMRect' }
    }
  }
}
function observedWidthProtocol(row: Pick<LabRow, 'browser' | 'case' | 'env' | 'native'>): string | null {
  if ('error' in row.native || 'skipped' in row.native) return null // Shared scorer handles unavailable native evidence.
  const expected = expectedParagraphWidth(row)
  if ('error' in expected) return expected.error
  return row.native.width === expected.value ? null : `declared width ${row.case.paragraph.width}px, expected observed content-box width ${expected.value}px, recorded ${row.native.width}px; ${expected.encoding}`
}

// Shared scorer validation/native line grouping, but never the inspected port's rect expectations. The extra checks
// make source coverage complete and expose ambiguous native evidence instead of turning a partial observation green.
export function evaluateVisibleRanges(row: LabRow): RangeEvaluation {
  if ('error' in row.prediction) {
    const native = scoreRow({ ...row, prediction: { lines: [] }, painter: null }).native
    const width = native === null ? null : observedWidthProtocol(row)
    if (width !== null) { const outcome: Outcome = { status: 'protocol', reason: 'native paragraph width does not describe the declared input', detail: width }; return { lineCount: outcome, visibleBreaks: outcome, nativeLines: native!.count, ranges: null } }
    return { ...noEvaluation('prediction error', row.prediction.error), nativeLines: native?.count ?? null, lineCount: { status: 'fail', reason: 'prediction error', detail: row.prediction.error } }
  }
  const ranges = lineRanges(row.prediction)
  if ('error' in ranges) return noEvaluation('prediction error', ranges.error)
  const text = rowText(row.case)
  for (let index = 0; index < ranges.length; index++) {
    const [start, end] = ranges[index]!
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length || (index > 0 && start < ranges[index - 1]![1])) return noEvaluation('malformed predicted source ranges', `line ${index}: [${start}, ${end}) of ${text.length} units`)
  }
  const score = scoreRow({ ...row, prediction: { lines: ranges.map(([start, end]) => ({ start, end })) }, painter: null })
  if (score.native === null || 'skipped' in row.native || 'error' in row.native) return noEvaluation(score.metrics.lineCount.reason ?? 'native observation unavailable', score.metrics.lineCount.detail)
  const width = observedWidthProtocol(row)
  if (score.protocol !== null || row.native.rejectedStyles.length !== 0 || width !== null) {
    const outcome: Outcome = { status: 'protocol', reason: 'native observation does not describe the declared input', detail: score.protocol ?? width ?? row.native.rejectedStyles.join('; ') }
    return { lineCount: outcome, visibleBreaks: outcome, nativeLines: score.native.count, ranges }
  }
  const lineCount = asOutcome(score.metrics.lineCount)
  let visibleBreaks = asOutcome(score.diagnostics!.visibleBreaks)
  if (lineCount.status === 'pass') {
    let ambiguous: string | null = null
    const reports = nativeHyphenReportRects(row.browser, row.case.paragraph.runs, text, row.native, score.native)
    for (let index = 0; index < row.native.points.length; index++) {
      const point = row.native.points[index]!, nativeLines = new Set<number>()
      let reportPositive = false
      for (let rect = 0; rect < point.rects.length; rect++) if (point.rects[rect]!.width > 0 && score.native.points[index]![rect]! >= 0) {
        if (reports[index]![rect]) reportPositive = true
        else nativeLines.add(score.native.points[index]![rect]!)
      }
      if (nativeLines.size === 0) { if (reportPositive) ambiguous ??= `code point ${point.offset}: only positive-width hyphen item reports, no own positive-width placement`; continue }
      if (nativeLines.size > 1) { ambiguous ??= `code point ${point.offset}: positive-width rects span native lines ${[...nativeLines].join(',')}`; continue }
      let low = 0, high = ranges.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (point.offset >= ranges[middle]![1]) low = middle + 1
        else high = middle
      }
      const predicted = low < ranges.length && ranges[low]![0] <= point.offset && point.offset < ranges[low]![1] ? low : -1
      if (predicted < 0 || ranges[predicted]![1] < point.offset + point.length) visibleBreaks = { status: 'fail', reason: 'visible source code point is omitted or split', detail: `code point ${point.offset} [${point.offset}, ${point.offset + point.length}): ${predicted < 0 ? 'no predicted line' : `line ${predicted} ends at ${ranges[predicted]![1]}`}` }
    }
    if (visibleBreaks.status !== 'fail' && ambiguous !== null) visibleBreaks = inconclusive('ambiguous native visible placement', ambiguous)
  }
  return { lineCount, visibleBreaks, nativeLines: score.native.count, ranges }
}

function rangeDifference(a: Array<[number, number]> | null, b: Array<[number, number]> | null): string | null {
  if (a === null || b === null) return 'a prediction has no comparable source ranges'
  if (a.length !== b.length) return `${a.length} line ranges vs ${b.length}`
  for (let index = 0; index < a.length; index++) if (a[index]![0] !== b[index]![0] || a[index]![1] !== b[index]![1]) return `line ${index}: [${a[index]!.join(',')}] vs [${b[index]!.join(',')}]`
  return null
}
async function fileHash(path: string): Promise<string> { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
async function load(role: Role, order: Order, path: string, cases: ReadonlyMap<string, Case>): Promise<Loaded> {
  const rowsPath = existingRows(resolve(path))
  if (rowsPath === null) throw new Error(`${path}: rows missing`)
  const browser = /^(chrome|firefox|webkit-host)-rows\.ndjson(?:\.zst)?$/.exec(basename(rowsPath))?.[1]
  if (browser === undefined) throw new Error(`${path}: use the lab's browser-rows.ndjson filename`)
  const recordPath = join(dirname(rowsPath), `${browser}-run.json`), bytes = readFileSync(recordPath), record = JSON.parse(bytes.toString()) as RunRecord
  if (record.status !== 'ok' || record.order !== (order === 'forward' ? 'file' : 'reverse') || (record.predictOnly === true && role !== 'main')) throw new Error(`${recordPath}: requires a successful ${order} ${role === 'main' ? 'main' : 'native'} run`)
  if (role === 'redo' && !['no-facts-predictor.ts', 'inspected-ranges-predictor.ts'].includes(basename(record.predictor ?? ''))) throw new Error(`${recordPath}: unsupported redo predictor; use no-facts-predictor.ts or inspected-ranges-predictor.ts`)
  if (role === 'plain' && basename(record.predictor ?? '') !== 'plain-predictor.ts') throw new Error(`${recordPath}: plain parity requires plain-predictor.ts`)
  if ((role === 'redo' || role === 'plain') && !record.measureFirst) throw new Error(`${recordPath}: the application check requires --measure-first`)
  let documents: ReturnType<typeof measureFirstDocuments> | null = null
  if (role === 'redo' || role === 'plain') {
    try { documents = measureFirstDocuments(record.measureFirst, record.totals.rows) }
    catch (error) { throw new Error(`${recordPath}: ${String(error)}`) }
  }
  const rows = new Map<string, LabRow>(), unexpected: string[] = []
  let count = 0
  for await (const line of readLines(rowsPath)) {
    const row = JSON.parse(line) as LabRow
    if (documents !== null) {
      const problem = measureFirstRowProblem(row.env.measureFirst, count, documents)
      if (problem !== null) throw new Error(`${path}/${row.id}: ${problem}`)
    }
    count++
    if (row.browser !== browser) throw new Error(`${path}/${row.id}: browser differs from run filename`)
    if (!cases.has(row.id)) { unexpected.push(row.id); continue }
    if (rows.has(row.id)) throw new Error(`${path}: duplicate case ${row.id}`)
    rows.set(row.id, row)
  }
  if (count !== record.totals.rows) throw new Error(`${path}: row count differs from the completed run record`)
  return { role, order, path: rowsPath, recordPath, record, rows, hash: await fileHash(rowsPath), recordHash: createHash('sha256').update(bytes).digest('hex'), unexpected }
}

export async function checkFreshObligations(options: CheckOptions) {
  const started = Date.now()
  if (options.out !== undefined && existsSync(options.out)) throw new Error(`${options.out}: report already exists`)
  const cases = new Map<string, Case>(), obligations = new Map<string, Obligation>()
  for await (const line of readLines(options.cases)) { const value = JSON.parse(line) as Case; if (cases.has(value.id)) throw new Error(`duplicate input case ${value.id}`); cases.set(value.id, value) }
  for await (const line of readLines(options.obligations)) {
    const value = JSON.parse(line) as Obligation
    if (obligations.has(value.id) || value.required?.lineCount !== 'pass' || value.required.visibleBreaks !== 'pass' || cases.get(value.id)?.family !== value.family) throw new Error(`${value.id}: uncertified, duplicate or malformed obligation, or case input mismatch; use a strict-audit-certified fast catalog`)
    obligations.set(value.id, value)
  }
  if (obligations.size === 0 || cases.size !== obligations.size) throw new Error('case inputs and nonempty obligations must have the same population')
  const paths: Array<[Role, string | undefined, string | undefined]> = [['redo', options.forward, options.reverse], ['plain', options.plainForward, options.plainReverse], ['main', options.mainForward, options.mainReverse], ['control', options.controlForward, options.controlReverse]]
  const runs: Loaded[] = []
  for (const [role, forward, reverse] of paths) {
    if ((forward === undefined) !== (reverse === undefined)) throw new Error(`${role}: provide both opposing orders`)
    if (forward === undefined || reverse === undefined) continue
    const a = await load(role, 'forward', forward, cases), b = await load(role, 'reverse', reverse, cases)
    if ((role === 'redo' && basename(a.record.predictor) !== basename(b.record.predictor)) || Boolean(a.record.measureFirst) !== Boolean(b.record.measureFirst) || a.record.predictOnly !== b.record.predictOnly || a.record.chunkSize !== b.record.chunkSize || a.record.partCases !== b.record.partCases || a.record.partMs !== b.record.partMs || a.record.bundleSha256 !== b.record.bundleSha256) throw new Error(`${role}: the opposing runs differ in library bundle or protocol`)
    runs.push(a, b)
  }
  const results: CaseResult[] = []
  for (const [id, obligation] of obligations) {
    const result: CaseResult = { id, family: obligation.family, status: 'pass', knownNativeHistory: obligation.knownNativeHistory ?? false, outcomes: [], issues: [], mainBaselineFailed: false }
    const evaluated = new Map<string, Evaluated>(), expected = JSON.stringify(cases.get(id))
    for (const run of runs) {
      const key = `${run.role}/${run.order}`, row = run.rows.get(id)
      let used: LabRow | null = row ?? null, nativeSource = 'own'
      let evaluation: RangeEvaluation
      if (row === undefined) evaluation = noEvaluation('missing required row', key)
      else if (row.case.id !== id || JSON.stringify(row.case) !== expected || row.family !== obligation.family) { evaluation = noEvaluation('row describes a different case', key); used = null }
      else if (row.build === undefined || row.languages === undefined) { evaluation = noEvaluation('fresh browser build/process languages not recorded', key); used = null }
      else if (run.role === 'main' && run.record.predictOnly === true) {
        const target = runs.find(value => value.role === 'redo' && value.order === run.order)!.rows.get(id)
        const borrowed = target === undefined ? { error: 'corresponding redo native row missing' } : withNativeRow(row, target)
        nativeSource = `borrowed redo/${run.order}; main's native state not observed`
        if ('error' in borrowed) { evaluation = noEvaluation('cannot borrow native observation', borrowed.error); used = null }
        else { used = borrowed; evaluation = evaluateVisibleRanges(borrowed) }
      } else evaluation = evaluateVisibleRanges(row)
      let view: NativeView | null = null
      if (used !== null && evaluation.nativeLines !== null && !('skipped' in used.native) && !('error' in used.native)) view = nativeView(used)
      const value = { evaluation, row: used, view, nativeSource }
      evaluated.set(key, value); result.outcomes.push({ role: run.role, order: run.order, nativeSource, evaluation })
      const failed = [evaluation.lineCount, evaluation.visibleBreaks].some(metric => metric.status === 'fail')
      const unobserved = [evaluation.lineCount, evaluation.visibleBreaks].some(metric => metric.status === 'inconclusive' || metric.status === 'protocol')
      // A main line-count miss necessarily leaves its visible-cut diagnostic unobserved. It is a baseline miss,
      // not missing native evidence, and must not withdraw or block an otherwise satisfied redo obligation.
      if (run.role === 'main') { result.mainBaselineFailed ||= failed; if (unobserved && (!failed || evaluation.nativeLines === null || evaluation.lineCount.status === 'protocol' || evaluation.visibleBreaks.status === 'protocol')) result.issues.push({ kind: 'inconclusive', detail: `${key}: main comparison unavailable` }) }
      else if (failed || unobserved) result.issues.push({ kind: failed ? 'lost-required-pass' : 'inconclusive', detail: `${key}: ${[evaluation.lineCount, evaluation.visibleBreaks].filter(metric => metric.status !== 'pass').map(metric => `${metric.status} ${metric.reason ?? ''}: ${metric.detail ?? ''}`).join('; ')}` })
    }
    const base = evaluated.get('redo/forward')!
    for (const run of runs) {
      const key = `${run.role}/${run.order}`, value = evaluated.get(key)!
      if (key === 'redo/forward' || base.row === null || value.row === null || base.view === null || value.view === null || value.nativeSource !== 'own') continue
      const compatible = withNativeRow({ ...value.row, native: { skipped: 'environment compatibility check' } }, base.row)
      if ('error' in compatible) result.issues.push({ kind: 'inconclusive', detail: `${key}: ${compatible.error}` })
      else { const difference = nativeDifference(base.view, value.view); if (difference !== null) result.issues.push({ kind: 'native-variation', detail: `redo/forward vs ${key}: ${difference}` }) }
    }
    for (const [role, forward] of paths) if (forward !== undefined) {
      const a = evaluated.get(`${role}/forward`)!, b = evaluated.get(`${role}/reverse`)!, difference = rangeDifference(a.evaluation.ranges, b.evaluation.ranges)
      if (a.evaluation.ranges !== null && b.evaluation.ranges !== null && difference !== null) result.issues.push({ kind: 'prediction-order-change', detail: `${role}: ${difference}; native variation is recorded independently` })
    }
    if (options.plainForward !== undefined) for (const order of ['forward', 'reverse'] as const) {
      const difference = rangeDifference(evaluated.get(`redo/${order}`)!.evaluation.ranges, evaluated.get(`plain/${order}`)!.evaluation.ranges)
      if (difference !== null) result.issues.push({ kind: 'plain-inspected-parity', detail: `${order}: ${difference}` })
    }
    if (result.issues.some(issue => issue.kind === 'lost-required-pass')) result.status = 'fail'
    else if (result.issues.some(issue => issue.kind === 'inconclusive')) result.status = 'inconclusive'
    else if (result.issues.length !== 0) result.status = 'review'
    results.push(result)
  }
  const unexpected = runs.flatMap(run => run.unexpected.map(id => ({ role: run.role, order: run.order, id })))
  const report = {
    format: 'pretext-fresh-main-obligations/1', label: options.label ?? 'redo', ok: unexpected.length === 0 && results.every(result => result.status === 'pass'),
    counts: { obligations: obligations.size, pass: results.filter(result => result.status === 'pass').length, fail: results.filter(result => result.status === 'fail').length, inconclusive: results.filter(result => result.status === 'inconclusive').length, review: results.filter(result => result.status === 'review').length, nativeVariation: results.filter(result => result.issues.some(issue => issue.kind === 'native-variation')).length, predictionOrderChange: results.filter(result => result.issues.some(issue => issue.kind === 'prediction-order-change')).length, plainParityLost: results.filter(result => result.issues.some(issue => issue.kind === 'plain-inspected-parity')).length, mainBaselineFailed: results.filter(result => result.mainBaselineFailed).length, unexpectedRows: unexpected.length },
    scope: { required: 'fresh line count and every observed unambiguous visible code point, declared paragraph width encoded by the lab browser recipe, both orders; plain parity and native scorer-view stability when supplied', main: options.mainForward === undefined ? 'not supplied' : 'diagnostic baseline; failures never retire required redo passes; borrowed native state is explicit', exactPositionsAndWidthsAndPainter: 'glyph positions/widths, vertical coordinates and painting not assessed; paragraph content-box width checked', historyExclusionsAdopted: false },
    inputs: { cases: resolve(options.cases), casesSha256: await fileHash(options.cases), obligations: resolve(options.obligations), obligationsSha256: await fileHash(options.obligations) },
    runs: runs.map(run => ({ role: run.role, order: run.order, rows: run.path, rowsSha256: run.hash, record: run.recordPath, recordSha256: run.recordHash, bundleSha256: run.record.bundleSha256, predictor: run.record.predictor, predictOnly: run.record.predictOnly, measureFirst: Boolean(run.record.measureFirst), environments: [...new Set([...run.rows.values()].map(environmentKey))] })),
    unexpected, cases: results, elapsedMs: Date.now() - started,
  }
  if (options.out !== undefined) { mkdirSync(dirname(resolve(options.out)), { recursive: true }); writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }) }
  return report
}

if (import.meta.main) {
  try {
    const args = new Map<string, string>()
    for (const arg of process.argv.slice(2)) { const match = /^--(cases|obligations|forward|reverse|plain-forward|plain-reverse|main-forward|main-reverse|control-forward|control-reverse|out|label)=(.+)$/s.exec(arg); if (match === null) throw new Error(`unknown argument ${arg}`); args.set(match[1]!, match[2]!) }
    for (const key of ['cases', 'obligations', 'forward', 'reverse', 'out']) if (!args.has(key)) throw new Error(`--${key} is required`)
    const options: CheckOptions = { cases: args.get('cases')!, obligations: args.get('obligations')!, forward: args.get('forward')!, reverse: args.get('reverse')!, out: args.get('out')! }
    for (const [flag, key] of [['plain-forward', 'plainForward'], ['plain-reverse', 'plainReverse'], ['main-forward', 'mainForward'], ['main-reverse', 'mainReverse'], ['control-forward', 'controlForward'], ['control-reverse', 'controlReverse']] as const) if (args.has(flag)) options[key] = args.get(flag)!
    if (args.has('label')) { const label = args.get('label'); if (label !== 'redo' && label !== 'main') throw new Error('--label is redo or main'); options.label = label }
    const report = await checkFreshObligations(options)
    console.log(`${report.label}: ${JSON.stringify(report.counts)}; ${report.ok ? 'PASS' : 'FAIL / review required'}; ${report.elapsedMs}ms`)
    for (const result of report.cases.filter(value => value.status !== 'pass').slice(0, 12)) console.log(`${result.id} ${result.family}: ${result.status}; ${result.issues.slice(0, 3).map(issue => `${issue.kind}: ${issue.detail.slice(0, 240)}`).join('; ')}`)
    process.exit(report.ok ? 0 : 1)
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
}
