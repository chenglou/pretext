import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { abcd, abcdExpected, abcdLayout, abcdNative, at, linesRow, row } from '../lab/row-fixtures.ts'
import type { LabRow } from '../lab/types.ts'
import { checkFreshObligations, evaluateVisibleRanges, type CheckOptions } from './check-main-obligations.ts'
import { nativeHyphenReportRects, scoreRow } from '../lab/score.ts'

function base(): LabRow {
  const value = row('chrome', structuredClone(abcd), structuredClone(abcdNative), structuredClone(abcdLayout), structuredClone(abcdExpected))
  value.case.paragraph.width = 20; value.case.paragraph.overflowWrap = 'break-word'
  if ('error' in value.native || 'skipped' in value.native) throw new Error('fixture needs native')
  value.native.width = 20; value.native.height = 40
  value.build = { app: 'Chrome', appVersion: '153.0.8010.50', engine: '153.0.8010.50', os: 'test' }
  value.languages = { launch: null, os: { appleLanguages: ['en'], appleLocale: 'en', launchdEnvironment: {} }, given: { engine: 'blink', uiLanguage: 'en' }, derivation: ['fixture'] }
  value.env.measureFirst = { predictionIndex: 0, documentPredictions: 1 }
  return value
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fresh-obligations-')), value = base()
  const cases = join(root, 'cases.ndjson'), obligations = join(root, 'obligations.ndjson')
  writeFileSync(cases, JSON.stringify(value.case) + '\n')
  writeFileSync(obligations, JSON.stringify({ id: value.id, family: value.family, required: { lineCount: 'pass', visibleBreaks: 'pass' }, native: { lines: 2, key: 'historical-native' }, knownNativeHistory: false }) + '\n')
  function save(role: string, order: 'forward' | 'reverse', rows: LabRow[], predictOnly = false): string {
    const dir = join(root, `${role}-${order}`); mkdirSync(dir, { recursive: true })
    const path = join(dir, 'chrome-rows.ndjson')
    const observed = structuredClone(rows)
    if (role === 'control' || predictOnly) for (const value of observed) delete value.env.measureFirst
    writeFileSync(path, observed.map(value => JSON.stringify(value)).join('\n') + '\n')
    writeFileSync(join(dir, 'chrome-run.json'), JSON.stringify({ status: 'ok', order: order === 'forward' ? 'file' : 'reverse', predictOnly, measureFirst: role === 'control' || predictOnly ? null : { documents: [{ firstRow: 0, rows: rows.length }] }, predictor: role === 'redo' ? 'no-facts-predictor.ts' : role === 'plain' ? 'plain-predictor.ts' : role === 'main' ? 'main-predictor.ts' : 'no-facts-predictor.ts', bundleSha256: role + '-bundle', totals: { rows: rows.length }, chunkSize: 25, partCases: null, partMs: null }))
    return path
  }
  const options: CheckOptions = { cases, obligations, forward: save('redo', 'forward', [value]), reverse: save('redo', 'reverse', [value]) }
  return { root, value, options, save }
}

describe('fresh visible obligations, independent of port/gap success', () => {
  test('required application rows reject missing or malformed measure-first evidence in either role/order and records require complete positive documents', async () => {
    for (const role of ['redo', 'plain']) for (const order of ['forward', 'reverse'] as const) {
      for (const tag of [undefined, null, {}, { predictionIndex: -1, documentPredictions: 1 }, { predictionIndex: 0, documentPredictions: 0 }, { predictionIndex: 0, documentPredictions: 2 }]) {
        const f = fixture(), value = structuredClone(f.value)
        if (tag === undefined) delete value.env.measureFirst
        else Object.assign(value.env, { measureFirst: tag })
        f.options.plainForward = f.save('plain', 'forward', [f.value]); f.options.plainReverse = f.save('plain', 'reverse', [f.value])
        const path = f.save(role, order, [value])
        if (role === 'redo') { if (order === 'forward') f.options.forward = path; else f.options.reverse = path }
        else { if (order === 'forward') f.options.plainForward = path; else f.options.plainReverse = path }
        await expect(checkFreshObligations(f.options)).rejects.toThrow('measure-first row 0')
      }
    }
    for (const documents of [[], [{ firstRow: 1, rows: 1 }], [{ firstRow: 0, rows: 0 }], [{ firstRow: 0, rows: 2 }], [{ firstRow: 0, rows: 1 }, { firstRow: 0, rows: 1 }]]) {
      const f = fixture(), path = join(f.root, 'redo-forward/chrome-run.json'), record = JSON.parse(readFileSync(path, 'utf8'))
      record.measureFirst.documents = documents; writeFileSync(path, JSON.stringify(record))
      await expect(checkFreshObligations(f.options)).rejects.toThrow('measure-first document population')
    }
  })

  test('raw row positions reset across documents, reverse order remains valid, and Native-first controls/predict-only main remain usable', async () => {
    const f = fixture(), values = Array.from({ length: 3 }, (_, index) => {
      const value = structuredClone(f.value); value.id = value.case.id = `c-${index}`; return value
    })
    writeFileSync(f.options.cases, values.map(value => JSON.stringify(value.case)).join('\n') + '\n')
    writeFileSync(f.options.obligations, values.map(value => JSON.stringify({ id: value.id, family: value.family, required: { lineCount: 'pass', visibleBreaks: 'pass' } })).join('\n') + '\n')
    for (const order of ['forward', 'reverse'] as const) {
      const ordered = structuredClone(order === 'reverse' ? [...values].reverse() : values)
      ordered.forEach((value, index) => { value.env.measureFirst = { predictionIndex: index < 2 ? index : 0, documentPredictions: index < 2 ? 2 : 1 } })
      const path = f.save('redo', order, ordered), recordPath = join(f.root, `redo-${order}/chrome-run.json`), record = JSON.parse(readFileSync(recordPath, 'utf8'))
      record.measureFirst.documents = [{ firstRow: 0, rows: 2 }, { firstRow: 2, rows: 1 }]; writeFileSync(recordPath, JSON.stringify(record))
      if (order === 'forward') f.options.forward = path; else f.options.reverse = path
    }
    expect((await checkFreshObligations(f.options)).counts).toMatchObject({ pass: 3, inconclusive: 0 })
    const path = f.options.reverse, rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as LabRow)
    rows[1]!.env.measureFirst!.predictionIndex = 0; writeFileSync(path, rows.map(value => JSON.stringify(value)).join('\n') + '\n')
    await expect(checkFreshObligations(f.options)).rejects.toThrow('measure-first row 1')
    const g = fixture(), nativeFirst = structuredClone(g.value), main = structuredClone(g.value)
    delete nativeFirst.env.measureFirst; delete main.env.measureFirst; main.native = { skipped: 'predict-only' }
    g.options.controlForward = g.save('control', 'forward', [nativeFirst]); g.options.controlReverse = g.save('control', 'reverse', [nativeFirst])
    g.options.mainForward = g.save('main', 'forward', [main], true); g.options.mainReverse = g.save('main', 'reverse', [main], true)
    expect(evaluateVisibleRanges(nativeFirst)).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' } })
    expect((await checkFreshObligations(g.options)).ok).toBe(true)
  })

  test('Blink hyphen item reports use native same-node evidence, preserve the real following glyph and cannot forgive wrong cuts or missing glyphs', () => {
    const value = base()
    value.case.paragraph.runs[0]!.text = 'a\u00adb'
    if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
    value.native.points = [
      { offset: 0, length: 1, rects: [at(0, 8)] },
      { offset: 1, length: 1, rects: [at(8, 0), at(8, 4)] },
      { offset: 2, length: 1, rects: [at(8, 4), at(0, 8, 1)] },
    ]
    value.native.runRects = [[at(0, 8), at(8, 4), at(0, 8, 1)]]
    const correct = linesRow(value, [[0, 2], [2, 3]])
    const native = scoreRow(correct).native!
    expect(nativeHyphenReportRects('chrome', value.case.paragraph.runs, 'a\u00adb', value.native, native)).toEqual([[false], [false, false], [true, false]])
    expect(evaluateVisibleRanges(correct)).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' } })
    expect(evaluateVisibleRanges(linesRow(value, [[0, 3], [3, 3]])).visibleBreaks.status).toBe('fail')
    expect(evaluateVisibleRanges(linesRow(value, [[0, 2], [3, 3]])).visibleBreaks.status).toBe('fail')
    const onlyReport = structuredClone(correct)
    if ('error' in onlyReport.native || 'skipped' in onlyReport.native) throw new Error('native fixture')
    onlyReport.native.points[2]!.rects = [at(8, 4)]
    expect(evaluateVisibleRanges(onlyReport).visibleBreaks).toMatchObject({ status: 'inconclusive', reason: 'ambiguous native visible placement' })
    const otherNode = structuredClone(correct)
    otherNode.case.paragraph.runs = [{ ...otherNode.case.paragraph.runs[0]!, text: 'a\u00ad' }, { ...otherNode.case.paragraph.runs[0]!, text: 'b' }]
    if ('error' in otherNode.native || 'skipped' in otherNode.native) throw new Error('native fixture')
    otherNode.native.runRects = [[at(0, 8), at(8, 4)], [at(8, 4), at(0, 8, 1)]]
    expect(evaluateVisibleRanges(otherNode).visibleBreaks.status).toBe('inconclusive')
    expect(nativeHyphenReportRects('firefox', value.case.paragraph.runs, 'a\u00adb', value.native, native)[2]).toEqual([false, false])
  })

  test('same-count wrong cuts and an omitted visible letter fail; zero-width edge omission remains permitted', () => {
    const f = fixture()
    expect(evaluateVisibleRanges(f.value).visibleBreaks.status).toBe('pass')
    const wrong = linesRow(f.value, [[0, 4], [4, 5]])
    expect(evaluateVisibleRanges(wrong)).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'fail' } })
    expect(evaluateVisibleRanges(linesRow(f.value, [[0, 3], [4, 5]]))).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'fail', reason: 'visible source code point is omitted or split' } })
    expect(evaluateVisibleRanges(linesRow(f.value, [[0, 2], [3, 5]]))).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' } })
  })

  test('a broken inspected port and arbitrarily covering gaps cannot change visible results', async () => {
    const f = fixture(), value = structuredClone(f.value)
    if (!('layout' in value.prediction)) throw new Error('engine fixture')
    value.prediction.observation = { error: 'broken observation port' }
    value.prediction.layout.gaps = [{ gap: 'page-history', detail: 'covers everything', run: null }]
    f.options.forward = f.save('redo', 'forward', [value]); f.options.reverse = f.save('redo', 'reverse', [value])
    expect((await checkFreshObligations(f.options)).ok).toBe(true)
    value.prediction.layout.lines[0]!.end = 4; value.prediction.layout.lines[1]!.start = 4
    f.options.reverse = f.save('redo', 'reverse', [value])
    const report = await checkFreshObligations(f.options)
    expect(report.ok).toBe(false)
    expect(report.counts).toMatchObject({ fail: 1, predictionOrderChange: 1, nativeVariation: 0 })
  })

  test('malformed native geometry cannot hide an omitted visible glyph or certify opposing orders', async () => {
    const f = fixture(), omitted = linesRow(f.value, [[0, 3], [4, 5]])
    expect(evaluateVisibleRanges(omitted).visibleBreaks.status).toBe('fail')
    for (const width of [-7, null]) {
      const malformed = structuredClone(omitted)
      if ('error' in malformed.native || 'skipped' in malformed.native) throw new Error('native fixture')
      Object.assign(malformed.native.points[3]!.rects[0]!, { width })
      expect(evaluateVisibleRanges(malformed)).toMatchObject({
        lineCount: { status: 'inconclusive', reason: 'malformed native observation' },
        visibleBreaks: { status: 'inconclusive', reason: 'malformed native observation' },
      })
      f.options.forward = f.save('redo', 'forward', [malformed]); f.options.reverse = f.save('redo', 'reverse', [malformed])
      const report = await checkFreshObligations(f.options)
      expect(report.ok).toBe(false)
      expect(report.counts).toMatchObject({ pass: 0, inconclusive: 1, nativeVariation: 0 })
    }
  })

  test('identical missing node or element lists in all six runs and either opposing order cannot certify', async () => {
    for (const collection of ['runRects', 'elements'] as const) {
      const f = fixture()
      if ('error' in f.value.native || 'skipped' in f.value.native) throw new Error('native fixture')
      if (collection === 'elements') {
        f.value.case.inline = { content: [{ kind: 'text', text: 'ab cd' }, { kind: 'wbr' }], textIndent: 0, textAlign: 'start', lineSlots: [] }
        f.value.native.elements = [[]]
        writeFileSync(f.options.cases, JSON.stringify(f.value.case) + '\n')
      }
      expect(evaluateVisibleRanges(f.value)).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' } })
      const malformed = structuredClone(f.value)
      if ('error' in malformed.native || 'skipped' in malformed.native) throw new Error('native fixture')
      malformed.native[collection] = []
      expect(evaluateVisibleRanges(malformed)).toMatchObject({ lineCount: { status: 'inconclusive', reason: 'malformed native observation' }, visibleBreaks: { status: 'inconclusive', reason: 'malformed native observation' }, nativeLines: null })
      f.options.plainForward = f.save('plain', 'forward', [malformed]); f.options.plainReverse = f.save('plain', 'reverse', [malformed])
      f.options.mainForward = f.save('main', 'forward', [malformed]); f.options.mainReverse = f.save('main', 'reverse', [malformed])
      for (const [forward, reverse] of [[malformed, malformed], [f.value, malformed], [malformed, f.value]]) {
        f.options.forward = f.save('redo', 'forward', [forward!]); f.options.reverse = f.save('redo', 'reverse', [reverse!])
        const report = await checkFreshObligations(f.options)
        expect(report.ok).toBe(false)
        expect(report.counts).toMatchObject({ pass: 0, inconclusive: 1, nativeVariation: 0 })
        expect(report.cases[0]!.outcomes.filter(outcome => outcome.evaluation.nativeLines === null).every(outcome => outcome.evaluation.lineCount.reason === 'malformed native observation')).toBe(true)
      }
    }
  })

  test('paragraph, point, node, element and float geometry reject nonnumeric, nonfinite and negative dimensions', () => {
    const change = (mutate: (native: typeof abcdNative) => void) => {
      const value = base()
      if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
      value.native.elements = [[at(0, 0)]]; value.native.floats = [at(0, 0)]
      mutate(value.native)
      expect(evaluateVisibleRanges(value).lineCount).toMatchObject({ status: 'inconclusive', reason: 'malformed native observation' })
    }
    for (const field of ['width', 'height'] as const) for (const invalid of [null, '0', NaN, Infinity, -1]) {
      change(native => Object.assign(native, { [field]: invalid }))
    }
    for (const field of ['x', 'y', 'width', 'height'] as const) for (const invalid of [null, '0', NaN, Infinity, ...(field === 'width' || field === 'height' ? [-1] : [])]) {
      change(native => Object.assign(native.points[3]!.rects[0]!, { [field]: invalid }))
      change(native => Object.assign(native.runRects[0]![0]!, { [field]: invalid }))
      change(native => Object.assign(native.elements![0]![0]!, { [field]: invalid }))
      change(native => Object.assign(native.floats![0]!, { [field]: invalid }))
    }
    for (const collection of ['points', 'runRects', 'elements', 'floats']) change(native => Object.assign(native, { [collection]: null }))
    change(native => Object.assign(native.points[0]!, { rects: null }))
    change(native => Object.assign(native, { runRects: [null] }))
    change(native => Object.assign(native, { elements: [null] }))
    change(native => Object.assign(native, { floats: [null] }))
  })

  test('native geometry permits zero dimensions, negative positions and absent optional collections', () => {
    const value = base()
    if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
    value.native.width = 0; value.native.height = 0
    for (const point of value.native.points) for (const rect of point.rects) { rect.x -= 100; rect.y -= 100 }
    for (const rects of value.native.runRects) for (const rect of rects) { rect.x -= 100; rect.y -= 100 }
    value.native.points[2]!.rects.push({ x: -1, y: -1, width: 0, height: 0 })
    expect(scoreRow(value).metrics.lineCount.status).toBe('pass') // Zero dimensions remain legal schema.
    expect(evaluateVisibleRanges(value).lineCount.status).toBe('protocol') // A modeled 20px box observed at 0px is another input.
    value.native.width = value.case.paragraph.width
    expect(evaluateVisibleRanges(value)).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' } })
    value.native.elements = [[{ x: -1, y: -1, width: 0, height: 0 }]]
    value.native.floats = [{ x: -1, y: -1, width: 0, height: 0 }]
    expect(evaluateVisibleRanges(value)).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'pass' } })
  })

  test('plain parity changes block even when both modes match every native visible placement', async () => {
    const f = fixture(), plain = linesRow(f.value, [[0, 2], [2, 5]])
    expect(evaluateVisibleRanges(plain).visibleBreaks.status).toBe('pass')
    f.options.plainForward = f.save('plain', 'forward', [plain]); f.options.plainReverse = f.save('plain', 'reverse', [plain])
    const report = await checkFreshObligations(f.options)
    expect(report.ok).toBe(false)
    expect(report.counts).toMatchObject({ review: 1, plainParityLost: 1, nativeVariation: 0, fail: 0 })
  })

  test('native variation is a required review rather than an exclusion, even alongside prediction failure', async () => {
    const f = fixture(), reverse = structuredClone(f.value)
    if ('error' in reverse.native || 'skipped' in reverse.native) throw new Error('native fixture')
    reverse.native.points[0]!.rects[0]!.x += 1 / 128
    f.options.reverse = f.save('redo', 'reverse', [reverse])
    const report = await checkFreshObligations(f.options)
    expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ nativeVariation: 1, review: 1, pass: 0 })
    expect(report.cases[0]!.outcomes.every(outcome => outcome.evaluation.visibleBreaks.status === 'pass')).toBe(true)
    reverse.prediction = { error: 'planted predictor failure' }; f.options.reverse = f.save('redo', 'reverse', [reverse])
    expect((await checkFreshObligations(f.options)).counts).toMatchObject({ nativeVariation: 1, fail: 1 })
  })

  test('cross-protocol native variation and ambiguous multi-line positive rects cannot appear as green stability', async () => {
    const f = fixture(), control = structuredClone(f.value)
    if ('error' in control.native || 'skipped' in control.native) throw new Error('native fixture')
    control.native.points[1]!.rects[0]!.width += 1 / 128
    f.options.controlForward = f.save('control', 'forward', [control]); f.options.controlReverse = f.save('control', 'reverse', [control])
    expect((await checkFreshObligations(f.options)).counts).toMatchObject({ nativeVariation: 1, review: 1 })
    const ambiguous = structuredClone(f.value)
    if ('error' in ambiguous.native || 'skipped' in ambiguous.native) throw new Error('native fixture')
    ambiguous.native.points[0]!.rects.push(at(0, 8, 1))
    expect(evaluateVisibleRanges(ambiguous)).toMatchObject({ lineCount: { status: 'pass' }, visibleBreaks: { status: 'inconclusive', reason: 'ambiguous native visible placement' } })
  })

  test('empty application population is rejected; missing native, malformed observations and rejected styles stay inconclusive', async () => {
    const f = fixture()
    f.options.reverse = f.save('redo', 'reverse', [])
    await expect(checkFreshObligations(f.options)).rejects.toThrow('measure-first document population')
    const failed = structuredClone(f.value); failed.native = { error: 'native failed' }
    expect(evaluateVisibleRanges(failed).lineCount.status).toBe('inconclusive')
    const malformed = structuredClone(f.value)
    if ('error' in malformed.native || 'skipped' in malformed.native) throw new Error('native fixture')
    malformed.native.points.pop()
    expect(evaluateVisibleRanges(malformed).lineCount.reason).toBe('malformed native observation')
    const rejected = structuredClone(f.value)
    if ('error' in rejected.native || 'skipped' in rejected.native) throw new Error('native fixture')
    rejected.native.rejectedStyles = ['word-break']
    expect(evaluateVisibleRanges(rejected).lineCount.status).toBe('protocol')
  })

  test('borrowed main native is explicit and a main miss never removes a required redo case', async () => {
    const f = fixture(), main = linesRow(f.value, [[0, 4], [4, 5]], { skipped: 'predict-only' })
    f.options.mainForward = f.save('main', 'forward', [main], true); f.options.mainReverse = f.save('main', 'reverse', [main], true)
    const report = await checkFreshObligations(f.options)
    expect(report.ok).toBe(true); expect(report.counts).toMatchObject({ pass: 1, mainBaselineFailed: 1, obligations: 1 })
    expect(report.cases[0]!.outcomes.filter(outcome => outcome.role === 'main').every(outcome => outcome.nativeSource.includes('borrowed redo/'))).toBe(true)
    const countMiss = linesRow(f.value, [[0, 5]], { skipped: 'predict-only' })
    f.save('main', 'forward', [countMiss], true); f.save('main', 'reverse', [countMiss], true)
    const countReport = await checkFreshObligations(f.options)
    expect(countReport.ok).toBe(true)
    expect(countReport.counts).toMatchObject({ mainBaselineFailed: 1, inconclusive: 0 })
    const wrong = structuredClone(f.value)
    if (!('layout' in wrong.prediction)) throw new Error('engine fixture')
    wrong.prediction.layout.lines[0]!.end = 4; wrong.prediction.layout.lines[1]!.start = 4
    f.options.reverse = f.save('redo', 'reverse', [wrong])
    expect((await checkFreshObligations(f.options)).ok).toBe(false)
  })

  test('the actual report seals inputs and run provenance and refuses mismatched bundles, case inputs and stale output', async () => {
    const f = fixture(); f.options.out = join(f.root, 'report.json')
    const report = await checkFreshObligations(f.options)
    expect(report.ok).toBe(true); expect(report.inputs.casesSha256).toHaveLength(64); expect(report.runs[0]!.recordSha256).toHaveLength(64)
    expect(JSON.parse(readFileSync(f.options.out, 'utf8')).counts.obligations).toBe(1)
    await expect(checkFreshObligations(f.options)).rejects.toThrow('report already exists')
    delete f.options.out
    const different = structuredClone(f.value); different.case.paragraph.width = 19
    f.options.reverse = f.save('redo', 'reverse', [different])
    expect((await checkFreshObligations(f.options)).counts).toMatchObject({ inconclusive: 1 })
    const recordPath = join(f.root, 'redo-reverse/chrome-run.json'), record = JSON.parse(readFileSync(recordPath, 'utf8'))
    record.bundleSha256 = 'another-library'; writeFileSync(recordPath, JSON.stringify(record))
    await expect(checkFreshObligations(f.options)).rejects.toThrow('opposing runs differ in library bundle or protocol')
  })
})

test('consistent wrong native widths in both inspected/plain orders cannot certify a required visible pass', async () => {
  const f = fixture(), value = structuredClone(f.value)
  if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
  value.native.width = 100
  f.options.forward = f.save('redo', 'forward', [value]); f.options.reverse = f.save('redo', 'reverse', [value])
  f.options.plainForward = f.save('plain', 'forward', [value]); f.options.plainReverse = f.save('plain', 'reverse', [value])
  const report = await checkFreshObligations(f.options)
  expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ inconclusive: 1, pass: 0, nativeVariation: 0 })
  expect(report.cases[0]!.outcomes.every(outcome => outcome.evaluation.lineCount.status === 'protocol')).toBe(true)
})
test('fractional widths accept the source-derived native lattice and reject a one-unit wrong width even with identical cuts', async () => {
  const f = fixture(), value = structuredClone(f.value)
  value.case.paragraph.width = 20.0149; writeFileSync(f.options.cases, JSON.stringify(value.case) + '\n')
  if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
  value.native.width = 20.0078125
  f.options.forward = f.save('redo', 'forward', [value]); f.options.reverse = f.save('redo', 'reverse', [value])
  expect((await checkFreshObligations(f.options)).ok).toBe(true)
  value.native.width += 1 / 128
  f.save('redo', 'forward', [value]); f.save('redo', 'reverse', [value])
  const report = await checkFreshObligations(f.options)
  expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ inconclusive: 1, nativeVariation: 0 })
})
test('a prediction error cannot conceal a wrong native width protocol behind a main count miss', () => {
  const f = fixture(), value = structuredClone(f.value); value.prediction = { error: 'planted prediction error' }
  if ('error' in value.native || 'skipped' in value.native) throw new Error('native fixture')
  value.native.width = 100
  expect(evaluateVisibleRanges(value)).toMatchObject({ lineCount: { status: 'protocol' }, visibleBreaks: { status: 'protocol' } })
})


test('redo accepts only the two inspected adapters, matched between orders; plain prediction cannot masquerade as inspected', async () => {
  for (const predictor of ['no-facts-predictor.ts', 'inspected-ranges-predictor.ts']) {
    const f = fixture()
    if (predictor === 'inspected-ranges-predictor.ts') {
      const projected = structuredClone(f.value); projected.prediction = { lines: [{ start: 0, end: 3 }, { start: 3, end: 5 }], measureLog: 7 }; projected.painter = null
      f.options.forward = f.save('redo', 'forward', [projected]); f.options.reverse = f.save('redo', 'reverse', [projected])
    }
    for (const order of ['forward', 'reverse']) {
      const path = join(f.root, `redo-${order}/chrome-run.json`), record = JSON.parse(readFileSync(path, 'utf8'))
      record.predictor = `/sealed/baselines/${predictor}`; writeFileSync(path, JSON.stringify(record))
    }
    expect((await checkFreshObligations(f.options)).ok).toBe(true)
    const path = join(f.root, 'redo-reverse/chrome-run.json'), record = JSON.parse(readFileSync(path, 'utf8'))
    record.predictor = predictor === 'no-facts-predictor.ts' ? 'inspected-ranges-predictor.ts' : 'no-facts-predictor.ts'
    writeFileSync(path, JSON.stringify(record))
    await expect(checkFreshObligations(f.options)).rejects.toThrow('opposing runs differ in library bundle or protocol')
  }
  for (const predictor of ['plain-predictor.ts', 'predictor.ts', 'some-predictor.ts']) {
    const f = fixture(), path = join(f.root, 'redo-forward/chrome-run.json'), record = JSON.parse(readFileSync(path, 'utf8'))
    record.predictor = predictor; writeFileSync(path, JSON.stringify(record))
    await expect(checkFreshObligations(f.options)).rejects.toThrow('unsupported redo predictor')
  }
})


test('a range-only inspected adapter still loses a required pass on same-count wrong cuts', async () => {
  const f = fixture(), projected = structuredClone(f.value)
  projected.prediction = { lines: [{ start: 0, end: 4 }, { start: 4, end: 5 }], measureLog: 7 }; projected.painter = null
  for (const order of ['forward', 'reverse'] as const) {
    f.save('redo', order, [projected])
    const path = join(f.root, `redo-${order}/chrome-run.json`), record = JSON.parse(readFileSync(path, 'utf8'))
    record.predictor = 'inspected-ranges-predictor.ts'; writeFileSync(path, JSON.stringify(record))
  }
  const report = await checkFreshObligations(f.options)
  expect(report.ok).toBe(false); expect(report.counts).toMatchObject({ fail: 1, nativeVariation: 0 })
  expect(report.cases[0]!.outcomes.every(outcome => outcome.evaluation.lineCount.status === 'pass' && outcome.evaluation.visibleBreaks.status === 'fail')).toBe(true)
})


test('passing inspected rows cannot be relabelled as plain parity under either supported adapter', async () => {
  for (const predictor of ['no-facts-predictor.ts', 'inspected-ranges-predictor.ts']) {
    const f = fixture(), value = structuredClone(f.value)
    if (predictor === 'inspected-ranges-predictor.ts') {
      value.prediction = { lines: [{ start: 0, end: 3 }, { start: 3, end: 5 }], measureLog: 7 }; value.painter = null
    }
    for (const order of ['forward', 'reverse'] as const) {
      f.save('redo', order, [value])
      const path = join(f.root, `redo-${order}/chrome-run.json`), record = JSON.parse(readFileSync(path, 'utf8'))
      record.predictor = `/sealed/baselines/${predictor}`; writeFileSync(path, JSON.stringify(record))
    }
    expect((await checkFreshObligations(f.options)).ok).toBe(true) // Both inspected orders satisfy the obligation.
    f.options.plainForward = f.options.forward; f.options.plainReverse = f.options.reverse
    await expect(checkFreshObligations(f.options)).rejects.toThrow('plain parity requires plain-predictor.ts')
  }
})

test('actual plain ranges retain parity and main label, native-first control and predict-only main diagnostics', async () => {
  const f = fixture(), plain = linesRow(f.value, [[0, 3], [3, 5]])
  f.options.plainForward = f.save('plain', 'forward', [plain]); f.options.plainReverse = f.save('plain', 'reverse', [plain])
  const nativeFirst = structuredClone(f.value), main = structuredClone(f.value)
  delete nativeFirst.env.measureFirst; delete main.env.measureFirst; main.native = { skipped: 'predict-only' }
  f.options.controlForward = f.save('control', 'forward', [nativeFirst]); f.options.controlReverse = f.save('control', 'reverse', [nativeFirst])
  f.options.mainForward = f.save('main', 'forward', [main], true); f.options.mainReverse = f.save('main', 'reverse', [main], true)
  f.options.label = 'main'
  const report = await checkFreshObligations(f.options)
  expect(report).toMatchObject({ ok: true, label: 'main', counts: { pass: 1, plainParityLost: 0, nativeVariation: 0 } })
  expect(report.runs.filter(run => run.role === 'plain').every(run => run.predictor === 'plain-predictor.ts')).toBe(true)
  expect(report.cases[0]!.outcomes.filter(outcome => outcome.role === 'main').every(outcome => outcome.nativeSource.startsWith('borrowed redo/'))).toBe(true)
  // Reject only the affected plain run, including a reverse-only incorrect adapter.
  const path = join(f.root, 'plain-reverse/chrome-run.json'), record = JSON.parse(readFileSync(path, 'utf8'))
  record.predictor = 'no-facts-predictor.ts'; writeFileSync(path, JSON.stringify(record))
  await expect(checkFreshObligations(f.options)).rejects.toThrow('plain parity requires plain-predictor.ts')
})
