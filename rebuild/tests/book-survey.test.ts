import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { abcdExpected, abcdLayout, abcdNative, paragraph, row } from '../lab/row-fixtures.ts'
import { makeCase } from '../lab/cases/case.ts'
import type { Case, LabRow } from '../lab/types.ts'
import { checkBookSurvey, originalHeightDiagnostic, type BookSurveyOptions } from './check-book-survey.ts'
import { hashBytes, prepareBookSurvey } from './prepare-book-survey.ts'

async function inputs(texts = ['ab\ncd']) {
  const root = mkdtempSync(join(tmpdir(), 'book-survey-')), artifactRoot = join(root, 'artifacts'), chunk = join(artifactRoot, 'research-20260916/census/cases/chunks')
  mkdirSync(join(root, 'corpora'), { recursive: true }); mkdirSync(chunk, { recursive: true })
  const metadata = texts.map((text, i) => {
    const output = `corpora/book${i}.txt`; writeFileSync(join(root, output), text)
    return { id: `book${i}`, output, language: 'en', font_family: 'Arial', font_size_px: 16, line_height_px: 20, min_width: 100, max_width: 110 }
  })
  writeFileSync(join(root, 'corpora/sources.json'), JSON.stringify(metadata))
  const originals = texts.flatMap((text, i) => [20, 30].map(width => makeCase({ family: 'suite/maintained/corpus', origin: `book${i}`, pageLang: 'en', paragraph: paragraph([[text, 'text']], { width, overflowWrap: 'break-word' }) })))
  const originalPath = join(chunk, 'corpus00.ndjson'); writeFileSync(originalPath, originals.map(c => JSON.stringify(c)).join('\n') + '\n')
  const catalog = join(root, 'catalog'), manifest = await prepareBookSurvey({ repo: root, artifactRoot, out: catalog, browser: 'chrome' })
  const cases = readFileSync(join(catalog, 'cases.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Case)
  return { root, artifactRoot, catalog, manifest, cases, originalPath, originals }
}
async function fixture() {
  const input = await inputs()
  function observation(c: Case, main = false, predictionIndex = 0): LabRow {
    const n = structuredClone(abcdNative); n.width = c.paragraph.width; n.height = 40
    const value = row('chrome', c.paragraph, n, structuredClone(abcdLayout), structuredClone(abcdExpected))
    value.id = c.id; value.family = c.family; value.case = structuredClone(c)
    value.build = { app: 'Chrome', appVersion: '153.0.8010.50', engine: '153.0.8010.50', os: 'test' }
    value.languages = { launch: null, os: { appleLanguages: ['en'], appleLocale: 'en', launchdEnvironment: {} }, given: { engine: 'blink', uiLanguage: 'en' }, derivation: ['fixture'] }
    value.env.measureFirst = { predictionIndex, documentPredictions: input.cases.length }
    value.prediction = { lines: [{ start: 0, end: 2 }, { start: 3, end: 5 }], ...(main ? { countedLayout: { lineCount: 2, height: 40, locale: null } } : {}) }
    return value
  }
  const values = input.cases.map((c, index) => observation(c, false, index)), mainValues = input.cases.map((c, index) => observation(c, true, index))
  function save(role: 'main' | 'redo' | 'plain', order: 'forward' | 'reverse', data: LabRow[] = role === 'main' ? mainValues : values, stamp = true) {
    const dir = join(input.root, `${role}-${order}`); mkdirSync(dir, { recursive: true }); const path = join(dir, 'chrome-rows.ndjson')
    const ordered = structuredClone(order === 'reverse' ? [...data].reverse() : data)
    if (stamp) ordered.forEach((value, predictionIndex) => { value.env.measureFirst = { predictionIndex, documentPredictions: input.cases.length } })
    writeFileSync(path, ordered.map(value => JSON.stringify(value)).join('\n') + '\n')
    writeFileSync(join(dir, 'chrome-run.json'), JSON.stringify({ status: 'ok', order: order === 'forward' ? 'file' : 'reverse', predictOnly: false, casesFile: join(input.catalog, 'cases.ndjson'), measureFirst: { documents: [{ firstRow: 0, rows: input.cases.length }] }, predictor: role === 'main' ? 'book-main-predictor.ts' : role === 'redo' ? 'no-facts-predictor.ts' : 'plain-predictor.ts', bundleSha256: role + '-bundle', totals: { rows: input.cases.length }, chunkSize: 1, partCases: null, partMs: null }))
    return path
  }
  const options: BookSurveyOptions = { catalog: input.catalog, mainForward: save('main', 'forward'), mainReverse: save('main', 'reverse'), redoForward: save('redo', 'forward'), redoReverse: save('redo', 'reverse'), plainForward: save('plain', 'forward'), plainReverse: save('plain', 'reverse') }
  function mutate(role: 'main' | 'redo' | 'plain', order: 'forward' | 'reverse', fn: (value: LabRow) => void) { const rows = structuredClone(role === 'main' ? mainValues : values); fn(rows[0]!); save(role, order, rows) }
  return { ...input, options, values, mainValues, save, mutate }
}
function ranges(value: LabRow, lines: Array<[number, number]>, publicCount?: number) {
  value.prediction = { lines: lines.map(([start, end]) => ({ start, end })), ...(publicCount === undefined ? {} : { countedLayout: { lineCount: publicCount, height: publicCount * value.case.paragraph.lineHeight, locale: null } }) }
}

describe('input-only original full-book survey', () => {
  test('every entire book and endpoint is selected using exact maintained normalization, independently of outcome files', async () => {
    const f = await inputs(['ab\ncd', 'ef\n gh'])
    expect(f.manifest.sourceBooks).toEqual(['book0', 'book1']); expect(f.manifest.originalPopulation).toBe(4); expect(f.manifest.cases).toBe(8)
    expect(f.manifest.pairs.map(p => [p.book, p.contentWidth])).toEqual([['book0', 20], ['book0', 30], ['book1', 20], ['book1', 30]])
    expect(f.cases.map(c => c.paragraph.runs[0]!.text)).toEqual(['ab\ncd', 'ab cd', 'ab\ncd', 'ab cd', 'ef\n gh', 'ef gh', 'ef\n gh', 'ef gh'])
    writeFileSync(join(f.artifactRoot, 'candidate-failures.json'), JSON.stringify({ fail: f.cases.map(c => c.id), gaps: ['anything'] }))
    const second = join(f.root, 'second'), manifest = await prepareBookSurvey({ repo: f.root, artifactRoot: f.artifactRoot, out: second, browser: 'chrome' })
    expect(readFileSync(join(second, 'cases.ndjson'), 'utf8')).toBe(readFileSync(join(f.catalog, 'cases.ndjson'), 'utf8')); expect(manifest.pairs).toEqual(f.manifest.pairs)
  })
  test('truncated corpus inputs or missing widths cannot stand in for complete original book inputs', async () => {
    const f = await inputs(), truncated = structuredClone(f.originals); truncated[0]!.paragraph.runs[0]!.text = 'ab'; truncated[0] = makeCase(truncated[0]!)
    writeFileSync(f.originalPath, truncated.map(c => JSON.stringify(c)).join('\n'))
    await expect(prepareBookSurvey({ repo: f.root, artifactRoot: f.artifactRoot, out: join(f.root, 'bad'), browser: 'chrome' })).rejects.toThrow('not an exact entire')
    writeFileSync(f.originalPath, JSON.stringify(f.originals[0]) + '\n')
    await expect(prepareBookSurvey({ repo: f.root, artifactRoot: f.artifactRoot, out: join(f.root, 'missing'), browser: 'chrome' })).rejects.toThrow('complete original')
  })
  test('Blink and WebKit normalized variants follow the maintained ZWSP/LF rule exactly', async () => {
    const f = await inputs(['a\u200b\nb']), safari = join(f.root, 'safari')
    await prepareBookSurvey({ repo: f.root, artifactRoot: f.artifactRoot, out: safari, browser: 'webkit-host' })
    expect(f.cases[1]!.paragraph.runs[0]!.text).toBe('a\u200bb')
    const cases = readFileSync(join(safari, 'cases.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Case)
    expect(cases[1]!.paragraph.runs[0]!.text).toBe('a\u200b b')
  })
})

describe('fresh own-main full-visible certification and independent redo gate', () => {
  test('identical missing/malformed measure-first row tags in all six files cannot certify; document resets and raw reverse positions are required', async () => {
    for (const tag of [undefined, null, {}, { predictionIndex: -1, documentPredictions: 4 }, { predictionIndex: 0, documentPredictions: 0 }, { predictionIndex: 0, documentPredictions: 1 }]) {
      const f = await fixture(), values = structuredClone(f.values), main = structuredClone(f.mainValues)
      for (const value of [...values, ...main]) { if (tag === undefined) delete value.env.measureFirst; else Object.assign(value.env, { measureFirst: tag }) }
      for (const role of ['main', 'redo', 'plain'] as const) for (const order of ['forward', 'reverse'] as const) f.save(role, order, role === 'main' ? main : values, false)
      const report = await checkBookSurvey(f.options)
      expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ certifiedVisible: 0, inconclusive: 4 })
      expect(report.cases[0]!.issues.some((issue: { detail: string }) => issue.detail.includes('measure-first row'))).toBe(true)
    }
    const f = await fixture()
    for (const role of ['main', 'redo', 'plain'] as const) for (const order of ['forward', 'reverse'] as const) {
      const path = f.save(role, order), rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as LabRow)
      rows.forEach((value, index) => { value.env.measureFirst = { predictionIndex: index % 2, documentPredictions: 2 } })
      writeFileSync(path, rows.map(value => JSON.stringify(value)).join('\n') + '\n')
      const recordPath = join(f.root, `${role}-${order}/chrome-run.json`), record = JSON.parse(readFileSync(recordPath, 'utf8'))
      record.measureFirst.documents = [{ firstRow: 0, rows: 2 }, { firstRow: 2, rows: 2 }]; writeFileSync(recordPath, JSON.stringify(record))
    }
    expect((await checkBookSurvey(f.options)).ok).toBe(true)
    const path = f.options.mainReverse, rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as LabRow)
    rows[1]!.env.measureFirst!.predictionIndex = 0; writeFileSync(path, rows.map(value => JSON.stringify(value)).join('\n') + '\n')
    const report = await checkBookSurvey(f.options)
    expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ certifiedVisible: 3, inconclusive: 1 })
  })

  test('all six fresh own-native files certify both ordinary sources; original height is a separate cross-case diagnostic', async () => {
    const f = await fixture(), report = await checkBookSurvey({ ...f.options, out: join(f.root, 'checked') })
    expect(report.ok).toBe(true); expect(report.format).toBe('pretext-fresh-own-main-book-survey/1')
    expect(report.counts).toMatchObject({ surveyed: 4, certifiedVisible: 4, mainPass: 4, pass: 4, originalMainHeightPairsPassedBothOrders: 2 })
    expect(report.crossCaseHeights.every(p => p.bothOwnSourceVisibleCertified)).toBe(true)
    expect(report.runs).toHaveLength(6); expect(report.runs.every(run => run.rowsSha256.length === 64)).toBe(true)
    const required = readFileSync(join(f.root, 'checked/required-obligations.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(required.every(c => c.required.lineCount === 'pass' && c.certificate.mainOwnNativeOrders === 'both')).toBe(true)
  })
  test('stable main wrong cuts can pass original height without acquiring a stronger certificate', async () => {
    const f = await fixture(); for (const order of ['forward', 'reverse'] as const) f.mutate('main', order, value => ranges(value, [[0, 4], [4, 5]], 2))
    const report = await checkBookSurvey(f.options)
    expect(report.counts).toMatchObject({ mainFail: 1, certifiedVisible: 3, originalMainHeightPairsPassedBothOrders: 2, originalMainHeightPairsWithoutBothStrongCertificates: 1 })
    expect(report.cases[0]!.requiredVisible).toBe(false); expect(report.cases[0]!.mainObservation).toBe('fail')
    expect(report.ok).toBe(true) // The known main miss is retained, not a redo obligation or silent disappearance.
  })
  test('actual public layout count is protected even when all range cuts match own native', async () => {
    const f = await fixture(); for (const order of ['forward', 'reverse'] as const) f.mutate('main', order, value => ranges(value, [[0, 2], [3, 5]], 1))
    const report = await checkBookSurvey(f.options)
    expect(report.counts).toMatchObject({ mainFail: 1, certifiedVisible: 3 }); expect(report.cases[0]!.requiredVisible).toBe(false)
    expect(report.cases[0]!.outcomes[0]!.evaluation.lineCount.reason).toBe('actual public layout count differs from own native')
  })
  test('a lost stable main pass is required despite redo failure, arbitrary gap claims or a broken inspected port', async () => {
    const f = await fixture(); f.mutate('redo', 'reverse', value => { value.prediction = { layout: structuredClone(abcdLayout), measure: { contexts: 0, calls: 0, memoHits: 0 }, observation: { error: 'planted broken port' } }; value.prediction.layout.lines[0]!.end = 4; value.prediction.layout.lines[1]!.start = 4; value.prediction.layout.gaps = [{ gap: 'page-history', run: null, detail: 'covers anything' }] })
    const report = await checkBookSurvey(f.options)
    expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ certifiedVisible: 4, fail: 1 }); expect(report.cases[0]!.requiredVisible).toBe(true)
    expect(report.cases[0]!.issues.some((issue: { kind: string }) => issue.kind === 'lost-required-pass')).toBe(true)
  })
  test('main native order variation cannot certify or silently retire a case; redo native variation keeps the independently required pass', async () => {
    const f = await fixture(); f.mutate('main', 'reverse', value => { if (!('error' in value.native) && !('skipped' in value.native)) value.native.points[0]!.rects[0]!.width += 1 / 128 })
    let report = await checkBookSurvey(f.options)
    expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ certifiedVisible: 3, mainReview: 1, review: 1 }); expect(report.cases[0]!.requiredVisible).toBe(false)
    f.save('main', 'reverse'); f.mutate('redo', 'reverse', value => { if (!('error' in value.native) && !('skipped' in value.native)) value.native.points[0]!.rects[0]!.width += 1 / 128 })
    report = await checkBookSurvey({ ...f.options, out: join(f.root, 'blocked') })
    expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ certifiedVisible: 4, review: 1 }); expect(report.cases[0]!.requiredVisible).toBe(true)
    const required = JSON.parse(readFileSync(join(f.root, 'blocked/required-obligations.ndjson'), 'utf8').split('\n')[0]!)
    expect(required.certificate.certificateAdoptable).toBe(false)
  })
  test('prediction order changes are distinct from native history, including invisible ownership and plain/inspected parity', async () => {
    const f = await fixture(); f.mutate('main', 'reverse', value => ranges(value, [[0, 3], [3, 5]], 2))
    let report = await checkBookSurvey(f.options)
    expect(report.ok).toBe(false); expect(report.cases[0]!.issues.map((issue: { kind: string }) => issue.kind)).toEqual(['main-prediction-order-change'])
    expect(report.counts.certifiedVisible).toBe(3)
    f.save('main', 'reverse'); for (const order of ['forward', 'reverse'] as const) f.mutate('plain', order, value => ranges(value, [[0, 3], [3, 5]]))
    report = await checkBookSurvey(f.options)
    expect(report.counts).toMatchObject({ certifiedVisible: 4, review: 1, fail: 0 }); expect(report.cases[0]!.issues.every((issue: { kind: string }) => issue.kind === 'plain-inspected-parity')).toBe(true)
  })
  test('identically missing positive-width native code points in all runs remain unavailable, not a false independent certificate', async () => {
    const f = await fixture()
    for (const role of ['main', 'redo', 'plain'] as const) for (const order of ['forward', 'reverse'] as const) f.mutate(role, order, value => { if (!('error' in value.native) && !('skipped' in value.native)) value.native.points.pop() })
    const report = await checkBookSurvey(f.options)
    expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ mainInconclusive: 1, inconclusive: 1, certifiedVisible: 3 }); expect(report.cases[0]!.requiredVisible).toBe(false)
    expect(report.cases[0]!.issues.some((issue: { detail: string }) => issue.detail.includes('native scalar 4'))).toBe(true)
  })
  test('identically observing the wrong modeled width in all six jobs cannot certify either source cuts or original heights', async () => {
    const f = await fixture()
    for (const role of ['main', 'redo', 'plain'] as const) for (const order of ['forward', 'reverse'] as const) f.mutate(role, order, value => { if (!('error' in value.native) && !('skipped' in value.native)) value.native.width = 100 })
    const report = await checkBookSurvey(f.options)
    expect(report.ok).toBe(false)
    expect(report.counts).toMatchObject({ certifiedVisible: 3, mainInconclusive: 1, inconclusive: 1 })
    expect(report.cases[0]!.issues.some((issue: { detail: string }) => issue.detail.includes('native content width 100 differs from requested 20'))).toBe(true)
    expect(report.crossCaseHeights[0]!.diagnostics.every(value => value.status === 'inconclusive')).toBe(true)
  })
  test('missing public main capture, ambiguous native placement or unavailable native cannot be promoted through an old height pass', async () => {
    const f = await fixture(); for (const order of ['forward', 'reverse'] as const) f.mutate('main', order, value => ranges(value, [[0, 2], [3, 5]]))
    let report = await checkBookSurvey(f.options); expect(report.ok).toBe(false); expect(report.counts.certifiedVisible).toBe(3)
    for (const order of ['forward', 'reverse'] as const) f.mutate('main', order, value => { value.native = { error: 'unavailable own native' } })
    report = await checkBookSurvey(f.options); expect(report.ok).toBe(false); expect(report.counts.mainInconclusive).toBe(1)
    for (const order of ['forward', 'reverse'] as const) f.mutate('main', order, value => { if (!('error' in value.native) && !('skipped' in value.native)) value.native.points[0]!.rects.push({ x: 0, y: 20, width: 8, height: 20 }) })
    report = await checkBookSurvey(f.options); expect(report.ok).toBe(false); expect(report.counts.mainInconclusive).toBe(1)
  })
  test('native block count disagreement stays inconclusive, preserving the separately observed cross-source heights', async () => {
    const f = await fixture()
    for (const role of ['main', 'redo', 'plain'] as const) for (const order of ['forward', 'reverse'] as const) f.mutate(role, order, value => { if (!('error' in value.native) && !('skipped' in value.native)) value.native.height = 60 })
    const report = await checkBookSurvey(f.options)
    expect(report.ok).toBe(false); expect(report.counts.certifiedVisible).toBe(3); expect(report.counts.fail).toBe(0); expect(report.counts.inconclusive).toBe(1)
    expect(report.cases[0]!.outcomes[0]!.nativeBlockCount).toBe(3)
    expect(report.crossCaseHeights[0]!.mainHeightPassedBothOrders).toBe(true)
    expect(report.crossCaseHeights[0]!.diagnostics[0]!.rawOwnNativeHeight).toBe(60)
    expect(report.crossCaseHeights[0]!.diagnostics[0]!.normalizedOwnNativeHeight).toBe(40)
    expect(report.crossCaseHeights[0]!.diagnostics[0]!.sameActualNativeHeight).toBe(false)
  })
  test('borrowed/native-first protocol, missing rows, incorrect source hashes or family omissions refuse certification', async () => {
    const f = await fixture(), recordPath = join(f.root, 'main-forward/chrome-run.json'), record = JSON.parse(readFileSync(recordPath, 'utf8'))
    record.predictOnly = true; writeFileSync(recordPath, JSON.stringify(record)); await expect(checkBookSurvey(f.options)).rejects.toThrow('fresh own-native')
    f.save('main', 'forward'); f.save('redo', 'reverse', f.values.slice(1)); await expect(checkBookSurvey(f.options)).rejects.toThrow('raw rows')
    f.save('redo', 'reverse'); const path = join(f.catalog, 'manifest.json'), manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.sourceBooks = ['invented']; writeFileSync(path, JSON.stringify(manifest)); await expect(checkBookSurvey(f.options)).rejects.toThrow('population incomplete')
    writeFileSync(path, JSON.stringify(f.manifest)); writeFileSync(join(f.root, 'corpora/book0.txt'), 'changed'); await expect(checkBookSurvey(f.options)).rejects.toThrow('source changed')
  })
  test('original rounded-height rule is literal, with unsupported fractional used-line-box evidence kept inconclusive', async () => {
    const f = await fixture(), report = await checkBookSurvey(f.options), base = report.cases[0]!.outcomes[0]!
    const raw = { ...base, ranges: null, predictedHeight: 40 }, normalized = { ...raw, nativeHeight: 40.49 }
    expect(originalHeightDiagnostic(raw, normalized, 20).status).toBe('pass')
    normalized.nativeHeight = 40.51; expect(originalHeightDiagnostic(raw, normalized, 20).status).toBe('fail')
    expect(originalHeightDiagnostic(raw, normalized, 20.1).status).toBe('inconclusive')
    expect(hashBytes('ab\ncd')).not.toBe(hashBytes('ab cd'))
  })
})

test('book main hook measures the unchanged ordinary raw case with default preparation locale and captures actual public layout', async () => {
  class Context { font = ''; measureText(text: string) { return { width: [...text].length * 8 } } }
  class Canvas { getContext() { return new Context() } }
  const previous = Reflect.get(globalThis, 'OffscreenCanvas'); Reflect.set(globalThis, 'OffscreenCanvas', Canvas)
  try {
    const { predict } = await import('../lab/baselines/book-main-predictor.ts')
    const p = paragraph([['ab\ncd', 'text']], { width: 20, overflowWrap: 'break-word', lang: 'deliberately_invalid_locale!' })
    const c = makeCase({ family: 'book/hook/raw', origin: 'instrumentation fixture', pageLang: 'en', paragraph: p }), before = JSON.stringify(c)
    const result = predict(c, { browser: 'chrome', build: 'test' })
    expect('error' in result).toBe(false); expect(JSON.stringify(c)).toBe(before)
    expect(result.countedLayout).toEqual({ lineCount: 2, height: 40, locale: null })
    if (!('error' in result)) expect(result.lines.map(line => [line.start, line.end])).toEqual([[0, 3], [3, 5]])
  } finally { if (previous === undefined) Reflect.deleteProperty(globalThis, 'OffscreenCanvas'); else Reflect.set(globalThis, 'OffscreenCanvas', previous) }
})


test('book certification permits either inspected redo adapter but rejects changed observation modes, arbitrary predictors and mixed-order adapters', async () => {
  for (const predictor of ['no-facts-predictor.ts', 'inspected-ranges-predictor.ts']) {
    const f = await fixture()
    if (predictor === 'inspected-ranges-predictor.ts') {
      const projected = structuredClone(f.values); for (const value of projected) { value.prediction = { lines: [{ start: 0, end: 2 }, { start: 3, end: 5 }], measureLog: 7 }; value.painter = null }
      f.options.redoForward = f.save('redo', 'forward', projected); f.options.redoReverse = f.save('redo', 'reverse', projected)
    }
    for (const order of ['forward', 'reverse']) {
      const path = join(f.root, `redo-${order}/chrome-run.json`), record = JSON.parse(readFileSync(path, 'utf8'))
      record.predictor = `/sealed/baselines/${predictor}`; writeFileSync(path, JSON.stringify(record))
    }
    expect((await checkBookSurvey(f.options)).ok).toBe(true)
    const path = join(f.root, 'redo-reverse/chrome-run.json'), record = JSON.parse(readFileSync(path, 'utf8'))
    record.predictor = predictor === 'no-facts-predictor.ts' ? 'inspected-ranges-predictor.ts' : 'no-facts-predictor.ts'
    writeFileSync(path, JSON.stringify(record))
    await expect(checkBookSurvey(f.options)).rejects.toThrow('opposing bundles/protocol differ')
  }
  for (const predictor of ['plain-predictor.ts', 'predictor.ts', 'some-predictor.ts']) {
    const f = await fixture(), path = join(f.root, 'redo-forward/chrome-run.json'), record = JSON.parse(readFileSync(path, 'utf8'))
    record.predictor = predictor; writeFileSync(path, JSON.stringify(record))
    await expect(checkBookSurvey(f.options)).rejects.toThrow('complete fresh own-native redo')
  }
})


test('a range-only inspected book adapter cannot forgive same-count wrong source cuts', async () => {
  const f = await fixture(), projected = structuredClone(f.values)
  for (const value of projected) { value.prediction = { lines: [{ start: 0, end: 4 }, { start: 4, end: 5 }], measureLog: 7 }; value.painter = null }
  for (const order of ['forward', 'reverse'] as const) {
    f.save('redo', order, projected)
    const path = join(f.root, `redo-${order}/chrome-run.json`), record = JSON.parse(readFileSync(path, 'utf8'))
    record.predictor = 'inspected-ranges-predictor.ts'; writeFileSync(path, JSON.stringify(record))
  }
  const report = await checkBookSurvey(f.options)
  expect(report.ok).toBe(false); expect(report.counts.certifiedVisible).toBe(f.cases.length); expect(report.counts.fail).toBe(f.cases.length)
  expect(report.cases.every(result => result.requiredVisible && result.issues.some((issue: { kind: string }) => issue.kind === 'lost-required-pass'))).toBe(true)
})
