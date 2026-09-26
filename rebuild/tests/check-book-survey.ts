// A distinct fresh-own-main certificate, never relabeled as an old census audit. Six supplied lab files; no browser work.
import { createHash } from 'node:crypto'
import { createReadStream, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { normalizeSource } from '../../tests/wrapping/contracts.ts'
import { validateCase } from '../lab/cases/case.ts'
import { canonicalFontFamily } from '../lab/cases/font.ts'
import { lineRanges } from '../lab/compare-rows.ts'
import { measureFirstDocuments, measureFirstRowProblem, type MeasureFirstDocument } from '../lab/measure-first.ts'
import { existingRows, plainRows, readLines } from '../lab/rows.ts'
import { environmentKey, indexRows, nativeDifference, nativeView, readRowAt, rowText, withNativeRow, type NativeView } from '../lab/score.ts'
import type { Case, LabRow } from '../lab/types.ts'
import { evaluateVisibleRanges, type RangeEvaluation } from './check-main-obligations.ts'
import { hashBytes, type BookSurveyManifest } from './prepare-book-survey.ts'

type Role = 'main' | 'redo' | 'plain'
type Order = 'forward' | 'reverse'
type Metric = { status: 'pass' | 'fail' | 'inconclusive'; reason?: string; detail?: string }
type Issue = { kind: string; detail: string }
type Counted = { lineCount: number; height: number; locale: string | null }
type Small = { heightHealthy: boolean; nativeBlockCount: number | null; publicLineCount: number | null; evaluation: RangeEvaluation; ranges: Array<[number, number]> | null; environment: string | null; nativeHeight: number | null; predictedHeight: number | null; heightSource: string; nativeHealthy: boolean; sourceHealthy: boolean }
type Run = { role: Role; order: Order; path: string; recordPath: string; originalSha256: string; recordSha256: string; record: any; documents: readonly MeasureFirstDocument[]; index: Map<string, { offset: number; length: number; row: number }>; fd: number; release: () => void; stamp: string }
export type BookSurveyOptions = { catalog: string; mainForward: string; mainReverse: string; redoForward?: string; redoReverse?: string; plainForward?: string; plainReverse?: string; out?: string }
async function fileHash(path: string): Promise<string> { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex') }
function stamp(path: string): string { const s = statSync(path); return `${s.size}/${s.mtimeMs}` }
function empty(reason: string): Small { return { heightHealthy: false, nativeBlockCount: null, publicLineCount: null, evaluation: { lineCount: { status: 'inconclusive', reason }, visibleBreaks: { status: 'inconclusive', reason }, nativeLines: null, ranges: null }, ranges: null, environment: null, nativeHeight: null, predictedHeight: null, heightSource: 'unavailable', nativeHealthy: false, sourceHealthy: false } }
function rangeDifference(a: Small, b: Small): string | null {
  if (a.ranges === null || b.ranges === null) { if (a.ranges !== b.ranges) return 'only one prediction has comparable ranges' }
  else {
  if (a.ranges.length !== b.ranges.length) return `${a.ranges.length} ranges vs ${b.ranges.length}`
  for (let i = 0; i < a.ranges.length; i++) if (a.ranges[i]![0] !== b.ranges[i]![0] || a.ranges[i]![1] !== b.ranges[i]![1]) return `line ${i}: [${a.ranges[i]}] vs [${b.ranges[i]}]`
  }
  if (a.predictedHeight !== b.predictedHeight) return `predicted public/model height ${a.predictedHeight} vs ${b.predictedHeight}`
  return null
}
// The Range producer promises one observation for every scalar, including invisible controls. Identically truncated
// observations in both orders cannot certify omitted visible glyphs merely because their partial arrays agree.
function pointCoverage(row: LabRow): string | null {
  if ('error' in row.native || 'skipped' in row.native) return 'native observation unavailable'
  // These predetermined ordinary book widths are integers and must be the width actually observed.
  if (row.native.width !== row.case.paragraph.width) return `native content width ${row.native.width} differs from requested ${row.case.paragraph.width}`
  const text = rowText(row.case)
  let offset = 0, index = 0
  for (const point of text) {
    const actual = row.native.points[index++]
    if (!actual || actual.offset !== offset || actual.length !== point.length) return `native scalar ${index - 1}: expected [${offset},${offset + point.length}), got ${actual ? `[${actual.offset},${actual.offset + actual.length})` : 'missing'}`
    offset += point.length
  }
  return index === row.native.points.length ? null : `${row.native.points.length - index} unexpected native scalar observations`
}
function countedLayout(row: LabRow): Counted | null {
  const value = (row.prediction as unknown as { countedLayout?: Counted }).countedLayout
  return value && Number.isSafeInteger(value.lineCount) && value.lineCount >= 0 && Number.isFinite(value.height) && value.height >= 0 && value.height === value.lineCount * row.case.paragraph.lineHeight && value.locale === null ? value : null
}
function smallRow(row: LabRow, role: Role): { row: LabRow; small: Small; coverage: string | null } {
  const counted = role === 'main' ? countedLayout(row) : null, ranges = lineRanges(row.prediction)
  // Drop inspected geometry/facts/painter payload before scoring; only actual ranges and native evidence matter here.
  row.prediction = 'error' in ranges ? { error: ranges.error } : { lines: ranges.map(([start, end]) => ({ start, end })) }
  row.painter = null
  const coverage = pointCoverage(row), evaluation = evaluateVisibleRanges(row)
  const nativeBlockCount = !('error' in row.native) && !('skipped' in row.native) && Number.isInteger(row.case.paragraph.lineHeight) ? row.native.height / row.case.paragraph.lineHeight : null
  const heightHealthy = !('error' in row.native) && !('skipped' in row.native) && row.native.rejectedStyles.length === 0 && row.native.fontsStatusAfter === 'loaded' && Number.isFinite(row.native.height) && row.native.width === row.case.paragraph.width && row.build !== undefined && row.languages !== undefined && row.env.pageLang === row.case.pageLang
  const nativeHealthy = heightHealthy && evaluation.nativeLines !== null && Number.isSafeInteger(nativeBlockCount) && nativeBlockCount === evaluation.nativeLines
  if (role === 'main' && counted && evaluation.nativeLines !== null && counted.lineCount !== evaluation.nativeLines) evaluation.lineCount = { status: 'fail', reason: 'actual public layout count differs from own native', detail: `public layout ${counted.lineCount}, own native ${evaluation.nativeLines}; range count ${'error' in ranges ? 'unavailable' : ranges.length}` }
  const small: Small = { heightHealthy, nativeBlockCount, publicLineCount: counted?.lineCount ?? null, evaluation, ranges: 'error' in ranges ? null : ranges, environment: heightHealthy ? environmentKey(row) + '; pageLang ' + row.env.pageLang + '; fixtureFonts ' + JSON.stringify(row.env.fontFixtures) + '; UA ' + row.env.userAgent : null, nativeHeight: heightHealthy && !('error' in row.native) && !('skipped' in row.native) ? row.native.height : null, predictedHeight: role === 'main' ? counted?.height ?? null : 'error' in ranges ? null : ranges.length * row.case.paragraph.lineHeight, heightSource: role === 'main' ? 'actual default-locale prepareWithSegments/layout result' : 'contentful predicted line count × requested line height; vertical metrics are not ported', nativeHealthy, sourceHealthy: coverage === null }
  return { row, small, coverage }
}
async function load(role: Role, order: Order, path: string, manifest: BookSurveyManifest, casesPath: string): Promise<Run> {
  const original = existingRows(resolve(path)); if (original === null) throw new Error(`${path}: rows missing`)
  if (!new RegExp(`^${manifest.browser}-rows\\.ndjson(?:\\.zst)?$`).test(basename(original))) throw new Error(`${path}: browser rows filename differs`)
  const recordPath = join(dirname(original), `${manifest.browser}-run.json`), record = JSON.parse(readFileSync(recordPath, 'utf8'))
  const expectedPredictors = role === 'main' ? ['book-main-predictor.ts'] : role === 'redo' ? ['no-facts-predictor.ts', 'inspected-ranges-predictor.ts'] : ['plain-predictor.ts']
  if (record.status !== 'ok' || record.order !== (order === 'forward' ? 'file' : 'reverse') || record.predictOnly !== false || !record.measureFirst || !expectedPredictors.includes(basename(record.predictor ?? '')) || typeof record.bundleSha256 !== 'string' || record.bundleSha256.length === 0 || record.totals?.rows !== manifest.cases || !Array.isArray(record.measureFirst.documents)) throw new Error(`${recordPath}: requires complete fresh own-native ${role} --measure-first ${order} run`)
  let documents: readonly MeasureFirstDocument[]
  try { documents = measureFirstDocuments(record.measureFirst, manifest.cases) }
  catch (error) { throw new Error(`${recordPath}: ${String(error)}`) }
  if (typeof record.casesFile !== 'string' || !existsSync(record.casesFile) || await fileHash(record.casesFile) !== await fileHash(casesPath)) throw new Error(`${recordPath}: original input/document population differs`)
  const before = stamp(original), originalSha256 = await fileHash(original), plain = plainRows(original)
  try {
    const index: Run['index'] = new Map()
    for (const [id, entry] of await indexRows(plain.path)) index.set(id, { ...entry, row: index.size })
    if (index.size !== manifest.cases) throw new Error(`${recordPath}: raw rows do not cover the declared population`)
    return { role, order, path: original, recordPath, originalSha256, recordSha256: await fileHash(recordPath), record, documents, index, fd: openSync(plain.path, 'r'), release: plain.release, stamp: before }
  } catch (error) { plain.release(); throw error }
}
function condensed(value: Small) {
  const ranges = value.ranges
  return { ...value, ranges: ranges === null ? null : { count: ranges.length, sha256: hashBytes(JSON.stringify(ranges)), first: ranges.slice(0, 2), last: ranges.slice(-2) }, evaluation: { ...value.evaluation, ranges: undefined } }
}
export function originalHeightDiagnostic(raw: Small, normalized: Small, lineHeight: number): Metric {
  if (!raw.heightHealthy || !normalized.heightHealthy || raw.environment !== normalized.environment || raw.predictedHeight === null || normalized.nativeHeight === null) return { status: 'inconclusive', reason: 'raw preparation and normalized own-native height are unavailable or environments differ' }
  if (!Number.isInteger(lineHeight)) return { status: 'inconclusive', reason: 'original fractional-height protocol needs its independently observed used line-box advance' }
  const difference = raw.predictedHeight - normalized.nativeHeight
  return { status: Math.round(difference) === 0 ? 'pass' : 'fail', detail: `raw predicted height ${raw.predictedHeight}, normalized own-native height ${normalized.nativeHeight}; rounded difference ${Math.round(difference)}` }
}
export async function checkBookSurvey(options: BookSurveyOptions) {
  const started = Date.now(), catalog = resolve(options.catalog), manifestPath = join(catalog, 'manifest.json'), manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes.toString()) as BookSurveyManifest, casesPath = join(catalog, 'cases.ndjson')
  if (manifest.format !== 'pretext-book-survey-inputs/1' || !['chrome', 'firefox', 'webkit-host'].includes(manifest.browser) || manifest.selection.readsAnyOutcome !== false || manifest.selection.preparationLocale !== 'default') throw new Error('requires an input-only default-locale book survey')
  if (await fileHash(casesPath) !== manifest.outputs.find(output => output.file === 'cases.ndjson')?.sha256 || manifest.normalizerSha256 !== await fileHash(join(import.meta.dir, '../../tests/wrapping/contracts.ts')) || manifest.producerSha256 !== await fileHash(join(import.meta.dir, 'prepare-book-survey.ts'))) throw new Error('input producer/normalizer or sealed cases changed')
  for (const source of manifest.sources) if (await fileHash(source.path) !== source.sha256) throw new Error(`${source.path}: original corpus input source changed`)
  const cases = new Map<string, Case>()
  for await (const line of readLines(casesPath)) { const c = JSON.parse(line) as Case; validateCase(c); if (cases.has(c.id)) throw new Error('duplicate input case'); cases.set(c.id, c) }
  const metadataPath = join(manifest.repo, 'corpora/sources.json'), metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Array<{ id: string; output: string; font_family?: string; font_size_px?: number; line_height_px?: number; language: string; direction?: string; min_width?: number; max_width?: number }>
  const sorted = (values: string[]) => [...values].sort().join('\n')
  if (![2, 3].includes(manifest.selection.widths) || metadata.length === 0 || sorted(metadata.map(value => value.id)) !== sorted(manifest.sourceBooks) || new Set(manifest.sourceBooks).size !== manifest.sourceBooks.length || !manifest.sources.some(source => source.path === metadataPath) || cases.size !== manifest.cases || sorted([...new Set(manifest.pairs.map(pair => pair.book))]) !== sorted(manifest.sourceBooks) || manifest.pairs.length !== manifest.sourceBooks.length * manifest.selection.widths) throw new Error('input book/case population incomplete')
  const byBook = new Map(metadata.map(value => [value.id, value])), pairIds = new Set<string>(), pairKeys = new Set<string>()
  const originalPopulation = metadata.reduce((n, value) => n + Math.floor(((value.max_width ?? 900) - (value.min_width ?? 300)) / 10) + 1, 0)
  if (manifest.originalPopulation !== originalPopulation) throw new Error('original step-10 population differs')
  for (const pair of manifest.pairs) {
    const meta = byBook.get(pair.book), pairKey = `${pair.book}/${pair.contentWidth}`
    if (!meta || pairKeys.has(pairKey)) throw new Error('duplicate or unexplained book/width pair')
    pairKeys.add(pairKey)
    const first = (meta.min_width ?? 300) - 80, last = (meta.max_width ?? 900) - 80, middle = first + Math.floor((last - first) / 20) * 10
    if (!(manifest.selection.widths === 2 ? [first, last] : [first, middle, last]).includes(pair.contentWidth) || resolve(pair.source) !== join(manifest.repo, meta.output) || !manifest.sources.some(source => source.path === pair.source && source.sha256 === pair.sourceSha256)) throw new Error(`${pair.book}: input-only original book endpoint/source selection differs`)
    const a = cases.get(pair.raw), b = cases.get(pair.normalized)
    if (!a || !b || a.paragraph.width !== pair.contentWidth || b.paragraph.width !== pair.contentWidth || a.inline !== undefined || b.inline !== undefined || a.paragraph.runs.length !== 1 || b.paragraph.runs.length !== 1 || a.paragraph.runs[0]!.node !== 'text' || b.paragraph.runs[0]!.node !== 'text' || a.paragraph.whiteSpace !== 'normal' || b.paragraph.whiteSpace !== 'normal') throw new Error(`${pair.book}: matching ordinary raw/normalized pair missing`)
    const source = readFileSync(pair.source, 'utf8'), expected = normalizeSource(source, 'normal', manifest.browser === 'webkit-host' ? 'safari' : manifest.browser, meta.language)
    const withoutText = (c: Case) => ({ pageLang: c.pageLang, paragraph: { ...c.paragraph, runs: c.paragraph.runs.map(run => ({ ...run, text: '' })) }, fixtures: c.fontFixtures ?? [] })
    if (hashBytes(source) !== pair.sourceSha256 || rowText(a) !== source || rowText(b) !== expected || JSON.stringify(withoutText(a)) !== JSON.stringify(withoutText(b))) throw new Error(`${pair.book}: exact original raw/maintained-normalized source or matching font/width/language/style differs`)
    const p = a.paragraph, run = p.runs[0]!, font = { family: canonicalFontFamily(meta.font_family ?? 'serif'), size: meta.font_size_px ?? 18, weight: 400, style: 'normal' }
    if (JSON.stringify(p.font) !== JSON.stringify(font) || JSON.stringify(run.font) !== JSON.stringify(font) || p.lineHeight !== (meta.line_height_px ?? Math.round(font.size * 1.6)) || p.lang !== meta.language || a.pageLang !== meta.language || p.direction !== (meta.direction === 'rtl' ? 'rtl' : 'ltr') || p.letterSpacing !== 0 || p.wordSpacing !== 0 || run.letterSpacing !== 0 || run.wordSpacing !== 0 || p.wordBreak !== 'normal' || p.overflowWrap !== 'break-word' || p.lineBreak !== 'auto') throw new Error(`${pair.book}: original preparation/native font/language/style contract differs`)
    pairIds.add(pair.raw); pairIds.add(pair.normalized)
  }
  if (pairIds.size !== cases.size) throw new Error('input cases include unexplained paragraphs')
  const specifications: Array<[Role, string | undefined, string | undefined]> = [['main', options.mainForward, options.mainReverse], ['redo', options.redoForward, options.redoReverse], ['plain', options.plainForward, options.plainReverse]]
  if ((options.redoForward === undefined) !== (options.plainForward === undefined)) throw new Error('provide inspected and plain redo pairs together, or a main-only certificate survey')
  const runs: Run[] = [], summaries = new Map<string, Map<string, Small>>(), results: any[] = []
  let peakRssBytes = process.memoryUsage().rss
  try {
    for (const [role, forward, reverse] of specifications) {
      if ((forward === undefined) !== (reverse === undefined)) throw new Error(`${role}: both opposing orders required`)
      if (!forward || !reverse) continue
      const a = await load(role, 'forward', forward, manifest, casesPath); runs.push(a)
      const b = await load(role, 'reverse', reverse, manifest, casesPath); runs.push(b)
      if (basename(a.record.predictor) !== basename(b.record.predictor) || a.record.bundleSha256 !== b.record.bundleSha256 || a.record.chunkSize !== b.record.chunkSize || a.record.partCases !== b.record.partCases || a.record.partMs !== b.record.partMs) throw new Error(`${role}: opposing bundles/protocol differ`)
      for (const run of [a, b]) if ([...run.index.keys()].some(id => !cases.has(id))) throw new Error(`${run.path}: unexpected raw row ID`)
    }
    for (const [id, input] of cases) {
      const values = new Map<string, Small>(), issues: Issue[] = []
      let baseView: NativeView | null = null, baseRow: LabRow | null = null, baseHeight: number | null = null
      let mainNativeVaried = false
      for (const run of runs) {
        const key = `${run.role}/${run.order}`, entry = run.index.get(id)
        if (!entry) { values.set(key, empty('missing required raw row')); issues.push({ kind: 'inconclusive', detail: `${key}: row missing` }); continue }
        const loaded = readRowAt(run.fd, entry)
        if (loaded.id !== id || loaded.browser !== manifest.browser || loaded.family !== input.family || JSON.stringify(loaded.case) !== JSON.stringify(input)) { values.set(key, empty('row describes a different input')); issues.push({ kind: 'inconclusive', detail: `${key}: input differs` }); continue }
        const protocol = measureFirstRowProblem(loaded.env.measureFirst, entry.row, run.documents)
        if (protocol !== null) { values.set(key, empty(protocol)); issues.push({ kind: 'inconclusive', detail: `${key}: ${protocol}` }); continue }
        const { row, small, coverage } = smallRow(loaded, run.role); values.set(key, small)
        if (!small.nativeHealthy || !small.sourceHealthy || small.evaluation.lineCount.status === 'protocol' || small.evaluation.visibleBreaks.status === 'protocol') issues.push({ kind: 'inconclusive', detail: `${key}: ${coverage ?? (!small.nativeHealthy && small.nativeBlockCount !== small.evaluation.nativeLines ? `native block height count ${small.nativeBlockCount} disagrees with Range-group count ${small.evaluation.nativeLines}` : 'native/protocol observation unavailable')}` })
        if (run.role === 'main' && small.predictedHeight === null) issues.push({ kind: 'inconclusive', detail: `${key}: default-locale actual public layout height/count instrumentation unavailable` })
        if (small.heightHealthy && small.sourceHealthy && small.evaluation.nativeLines !== null) {
          const view = nativeView(row)
          if (key === 'main/forward') { baseView = view; baseHeight = small.nativeHeight; baseRow = { ...row, native: { error: 'native payload not retained; environment compatibility only' } } }
          else if (baseView && baseRow) {
            const compatible = withNativeRow({ ...row, native: { skipped: 'environment comparison only' } }, baseRow)
            if ('error' in compatible) issues.push({ kind: 'inconclusive', detail: `${key}: ${compatible.error}` })
            else {
              const difference = nativeDifference(baseView, view)
              if (difference !== null || baseHeight !== small.nativeHeight) {
                if (run.role === 'main' && run.order === 'reverse') mainNativeVaried = true
                issues.push({ kind: 'native-variation', detail: `main/forward vs ${key}: ${difference ?? `physical native height ${baseHeight} vs ${small.nativeHeight}`}` })
              }
            }
          }
        }
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
      }
      const mf = values.get('main/forward')!, mr = values.get('main/reverse')!
      const mainRangeChange = rangeDifference(mf, mr)
      if (mainRangeChange) issues.push({ kind: 'main-prediction-order-change', detail: mainRangeChange })
      const mainUnobserved = [mf, mr].some(value => !value.nativeHealthy || !value.sourceHealthy || value.ranges === null || [value.evaluation.lineCount, value.evaluation.visibleBreaks].some(metric => metric.status === 'inconclusive' || metric.status === 'protocol'))
      const mainFailed = [mf, mr].some(value => [value.evaluation.lineCount, value.evaluation.visibleBreaks].some(metric => metric.status === 'fail'))
      if ([mf, mr].some(value => !value.nativeHealthy || !value.sourceHealthy || value.evaluation.lineCount.status === 'inconclusive' || value.evaluation.lineCount.status === 'protocol' || (value.evaluation.lineCount.status !== 'fail' && (value.evaluation.visibleBreaks.status === 'inconclusive' || value.evaluation.visibleBreaks.status === 'protocol')))) issues.push({ kind: 'inconclusive', detail: 'main full-source placement is not established in both orders' })
      const requiredVisible = !mainRangeChange && !mainNativeVaried && ![mf, mr].some(value => value.predictedHeight === null) && [mf, mr].every(value => value.nativeHealthy && value.sourceHealthy && value.evaluation.lineCount.status === 'pass' && value.evaluation.visibleBreaks.status === 'pass')
      for (const role of ['redo', 'plain'] as const) {
        const a = values.get(`${role}/forward`), b = values.get(`${role}/reverse`)
        if (!a || !b) continue
        const difference = rangeDifference(a, b)
        if (difference) issues.push({ kind: 'prediction-order-change', detail: `${role}: ${difference}` })
        for (const [order, value] of [['forward', a], ['reverse', b]] as const) if (requiredVisible && (value.evaluation.lineCount.status !== 'pass' || value.evaluation.visibleBreaks.status !== 'pass')) issues.push({ kind: [value.evaluation.lineCount, value.evaluation.visibleBreaks].some(metric => metric.status === 'fail') ? 'lost-required-pass' : 'inconclusive', detail: `${role}/${order}: ${JSON.stringify(value.evaluation.lineCount)}, ${JSON.stringify(value.evaluation.visibleBreaks)}` })
      }
      if (values.has('redo/forward')) for (const order of ['forward', 'reverse'] as const) { const difference = rangeDifference(values.get(`redo/${order}`)!, values.get(`plain/${order}`)!); if (difference) issues.push({ kind: 'plain-inspected-parity', detail: `${order}: ${difference}` }) }
      const status = issues.some(issue => issue.kind === 'lost-required-pass') ? 'fail' : issues.some(issue => issue.kind === 'inconclusive') ? 'inconclusive' : issues.length ? 'review' : 'pass'
      results.push({ id, family: input.family, requiredVisible, mainObservation: mainNativeVaried || mainRangeChange ? 'review' : mainFailed ? 'fail' : mainUnobserved ? 'inconclusive' : 'pass', status, issues, outcomes: [...values].map(([run, value]) => ({ run, ...condensed(value) })) })
      // Only light scalar metadata crosses case boundaries. Never retain all NativeViews, inspected layouts or Range arrays.
      summaries.set(id, new Map([...values].map(([key, value]) => [key, { ...value, ranges: null, evaluation: { ...value.evaluation, ranges: null } }])))
      Bun.gc(true)
    }
    for (const run of runs) if (stamp(run.path) !== run.stamp || await fileHash(run.path) !== run.originalSha256 || await fileHash(run.recordPath) !== run.recordSha256) throw new Error(`${run.path}: supplied evidence changed during survey`)
  } finally { for (const run of runs) { closeSync(run.fd); run.release() } }
  const crossCaseHeights = manifest.pairs.map(pair => {
    const raw = summaries.get(pair.raw)!, normalized = summaries.get(pair.normalized)!, required = new Map(results.map(result => [result.id, result.requiredVisible]))
    const diagnostics = [...raw].map(([run, value]) => ({ run, ...originalHeightDiagnostic(value, normalized.get(run)!, cases.get(pair.raw)!.paragraph.lineHeight), rawPreparationHeight: value.predictedHeight, normalizedOwnNativeHeight: normalized.get(run)!.nativeHeight, rawOwnNativeHeight: value.nativeHeight, sameActualNativeHeight: value.nativeHeight === normalized.get(run)!.nativeHeight }))
    return { ...pair, meaning: 'cross-case original raw-prepared/normalized-painted height-only diagnostic; distinct source contracts; neither full cuts nor an automatic candidate-fault gate', mainHeightPassedBothOrders: diagnostics.filter(value => value.run.startsWith('main/')).every(value => value.status === 'pass'), bothOwnSourceVisibleCertified: Boolean(required.get(pair.raw)) && Boolean(required.get(pair.normalized)), diagnostics }
  })
  const counts = { surveyed: results.length, certifiedVisible: results.filter(value => value.requiredVisible).length, mainPass: results.filter(value => value.mainObservation === 'pass').length, mainFail: results.filter(value => value.mainObservation === 'fail').length, mainInconclusive: results.filter(value => value.mainObservation === 'inconclusive').length, mainReview: results.filter(value => value.mainObservation === 'review').length, pass: results.filter(value => value.status === 'pass').length, fail: results.filter(value => value.status === 'fail').length, inconclusive: results.filter(value => value.status === 'inconclusive').length, review: results.filter(value => value.status === 'review').length, originalMainHeightPairsPassedBothOrders: crossCaseHeights.filter(value => value.mainHeightPassedBothOrders).length, originalMainHeightPairsWithoutBothStrongCertificates: crossCaseHeights.filter(value => value.mainHeightPassedBothOrders && !value.bothOwnSourceVisibleCertified).length }
  const report = { format: 'pretext-fresh-own-main-book-survey/1', browser: manifest.browser, ok: counts.fail === 0 && counts.inconclusive === 0 && counts.review === 0 && counts.certifiedVisible > 0, completeObservedPopulation: true, certificate: 'stable own-native main visible source/count passes at each predetermined ordinary paragraph; derived independently of redo outcomes, never auto-removes native variation', originalHeightDiagnostic: manifest.selection.originalHeightProtocol, counts, inputs: { catalog, manifestSha256: hashBytes(manifestBytes), casesSha256: await fileHash(casesPath), normalizerSha256: manifest.normalizerSha256, producerSha256: manifest.producerSha256 }, acceptance: { scorerSha256: await fileHash(join(import.meta.dir, '../lab/score.ts')), rangeEvaluatorSha256: await fileHash(join(import.meta.dir, 'check-main-obligations.ts')), surveyCheckerSha256: await fileHash(import.meta.path), mainPredictorSha256: await fileHash(join(import.meta.dir, '../lab/baselines/book-main-predictor.ts')), mainAdapterSha256: await fileHash(join(import.meta.dir, '../lab/baselines/main-predictor.ts')) }, runs: runs.map(run => ({ role: run.role, order: run.order, path: run.path, rowsSha256: run.originalSha256, record: run.recordPath, recordSha256: run.recordSha256, bundleSha256: run.record.bundleSha256, predictor: run.record.predictor })), cases: results, crossCaseHeights, peakRssBytes, elapsedMs: Date.now() - started }
  if (options.out) {
    const out = resolve(options.out); if (existsSync(out)) throw new Error(`${out}: output already exists`); mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    const requiredIds = new Set(results.filter(result => result.requiredVisible).map(result => result.id))
    writeFileSync(join(out, 'required-cases.ndjson'), [...cases.values()].filter(c => requiredIds.has(c.id)).map(c => JSON.stringify(c)).join('\n') + (requiredIds.size ? '\n' : ''))
    writeFileSync(join(out, 'required-obligations.ndjson'), results.filter(result => result.requiredVisible).map(result => JSON.stringify({ id: result.id, family: result.family, required: { lineCount: 'pass', visibleBreaks: 'pass' }, certificate: { format: report.format, inputManifestSha256: report.inputs.manifestSha256, mainOwnNativeOrders: 'both', mainNativeVaried: false, certificateAdoptable: report.ok, independence: 'requirements depend on main only; retained even when redo fails or changes native state' } })).join('\n') + (requiredIds.size ? '\n' : ''))
  }
  return report
}
if (import.meta.main) {
  try {
    const args = new Map<string, string>()
    for (const arg of process.argv.slice(2)) { const m = /^--(catalog|main-forward|main-reverse|redo-forward|redo-reverse|plain-forward|plain-reverse|out)=(.+)$/s.exec(arg); if (!m || args.has(m[1]!)) throw new Error(`unknown/duplicate argument ${arg}`); args.set(m[1]!, m[2]!) }
    for (const key of ['catalog', 'main-forward', 'main-reverse', 'out']) if (!args.has(key)) throw new Error(`--${key} required`)
    const report = await checkBookSurvey({ catalog: args.get('catalog')!, mainForward: args.get('main-forward')!, mainReverse: args.get('main-reverse')!, out: args.get('out')!, ...Object.fromEntries(['redo-forward', 'redo-reverse', 'plain-forward', 'plain-reverse'].filter(key => args.has(key)).map(key => [key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()), args.get(key)])) })
    console.log(`${report.browser}: ${JSON.stringify(report.counts)}; ${report.elapsedMs}ms; peak RSS ${Math.round(report.peakRssBytes / 1048576)}MiB`); if (!report.ok) process.exit(1)
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2) }
}
