import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { abcd, abcdExpected, abcdLayout, abcdNative, at, linesRow, row } from '../lab/row-fixtures.ts'
import type { LabRow } from '../lab/types.ts'
import { buildMainObligations } from './main-obligations.ts'
import { auditMainObligations } from './audit-main-obligations.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'main-pass-audit-')), artifacts = join(root, '.artifacts'), from = join(root, 'census'), part = join(from, 'chrome/chunk00'), input = join(artifacts, 'original/cases.ndjson')
  for (const path of [join(artifacts, 'original'), join(part, 'main'), join(part, 'rebuild')]) mkdirSync(path, { recursive: true })
  const values = ['sound-redo-failure', 'omitted-visible', 'ambiguous-range', 'historical-main-miss'].map((id, index): LabRow => {
    const value = row('chrome', structuredClone(abcd), structuredClone(abcdNative), structuredClone(abcdLayout), structuredClone(abcdExpected))
    value.id = id; value.case.id = id; value.family = value.case.family = 'family-' + index
    value.case.paragraph.width = 20; value.case.paragraph.overflowWrap = 'break-word'
    if ('error' in value.native || 'skipped' in value.native) throw new Error('needs native')
    value.native.width = 20; value.native.height = 40
    value.build = { app: 'Chrome', appVersion: '153', engine: '153', os: 'test' }
    value.languages = { launch: null, os: { appleLanguages: ['en'], appleLocale: 'en', launchdEnvironment: {} }, given: { engine: 'blink', uiLanguage: 'en' }, derivation: ['fixture'] }
    if (index === 0) value.prediction = { error: 'a redo failure cannot erase a sound main pass' }
    if (index === 2) value.native.points[0]!.rects.push(at(0, 8, 1))
    return value
  })
  const mains = values.map((value, index) => linesRow(value, index === 1 ? [[0, 3], [4, 5]] : [[0, 3], [3, 5]], { skipped: 'predict-only' }))
  const metadata = values.map((value, index) => ({ browser: 'chrome', id: value.id, family: value.family, chunk: 'chunk00', units: 5, main: { lineCount: 'pass', visibleBreaks: index === 3 ? 'fail' : 'pass' }, native: { lines: 2, key: 'old-native-' + index }, rebuild: { lineCount: index === 0 ? 'fail' : 'pass', breaks: 'pass', widths: 'pass', painter: 'pass' }, gaps: index === 0 ? ['a covering gap'] : [] }))
  writeFileSync(input, values.map(value => JSON.stringify(value.case)).join('\n') + '\n')
  writeFileSync(join(part, 'cases.ndjson'), metadata.map(value => JSON.stringify(value)).join('\n') + '\n')
  for (const [kind, rows] of [['main', mains], ['rebuild', values]] as const) {
    writeFileSync(join(part, kind, 'chrome-rows.ndjson'), rows.map(value => JSON.stringify(value)).join('\n') + '\n')
    writeFileSync(join(part, kind, 'chrome-run.json'), JSON.stringify({ status: 'ok', casesFile: '/removed/.artifacts/original/cases.ndjson', order: 'file', predictOnly: kind === 'main', totals: { rows: values.length }, bundleSha256: kind + '-bundle', build: values[0]!.build, languages: values[0]!.languages }))
  }
  return { root, artifacts, from, part, values, catalog: join(root, 'catalog'), out: join(root, 'audit') }
}
async function generate(f: ReturnType<typeof fixture>) { await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.catalog, budget: 3 }) }

describe('historical main-pass certification', () => {
  test('only raw-native-certified passes become requirements; all refuted and ambiguous historical labels stay in the full catalog', async () => {
    const f = fixture(); await generate(f)
    expect(JSON.parse(readFileSync(join(f.catalog, 'obligations.ndjson'), 'utf8').split('\n')[0]!).required).toBeNull()
    await auditMainObligations({ catalog: f.catalog, out: f.out })
    const certified = join(f.root, 'certified')
    const manifest = await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: certified, audit: f.out, budget: 3 })
    expect(manifest.counts).toMatchObject({ obligations: 3, certifiedRequired: 1, refutedHistoricalLabels: 1, inconclusiveHistoricalLabels: 1, pendingCertification: 0, fast: 1 })
    const fast = readFileSync(join(certified, 'fast-cases.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(fast.map(value => value.id)).toEqual(['sound-redo-failure'])
    const full = readFileSync(join(certified, 'obligations.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(full).toHaveLength(3)
    expect(full.find(value => value.id === 'sound-redo-failure')).toMatchObject({ required: { lineCount: 'pass', visibleBreaks: 'pass' }, observedRebuild: { lineCount: 'fail' }, gaps: ['a covering gap'] })
    expect(full.find(value => value.id === 'omitted-visible')).toMatchObject({ required: null, mainEvidence: { status: 'refuted' } })
    expect(JSON.parse(readFileSync(join(certified, 'required-cases.ndjson'), 'utf8').trim()).id).toBe('sound-redo-failure')
    expect(JSON.parse(readFileSync(join(certified, 'required-obligations.ndjson'), 'utf8').trim()).required).toEqual({ lineCount: 'pass', visibleBreaks: 'pass' })
    expect(manifest.counts.certifiedObservedRebuildLineCountOrBreaksFailures).toBe(1)
    expect(manifest.selection.fast.missingTokens).toContain('family:family-1')
    const run = join(f.part, 'rebuild/chrome-rows.ndjson')
    writeFileSync(run, '')
    await expect(buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: join(f.root, 'false-certification'), audit: f.out, budget: 3 })).rejects.toThrow('raw audit evidence changed')
  })

  test('raw native proof refutes an omitted visible letter, keeps ambiguous evidence separate, and preserves a main pass despite redo failure', async () => {
    const f = fixture(); await generate(f)
    const report = await auditMainObligations({ catalog: f.catalog, out: f.out })
    expect(report.counts).toEqual({ historicalPasses: 3, verified: 1, refuted: 1, inconclusive: 1 })
    const entries = readFileSync(join(f.out, 'entries.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(entries.find(value => value.id === 'sound-redo-failure')).toMatchObject({ mainObservedVisiblePass: 'verified', required: true })
    expect(entries.find(value => value.id === 'omitted-visible')).toMatchObject({ mainObservedVisiblePass: 'refuted', required: false, reason: 'visible source code point is omitted or split' })
    expect(entries.find(value => value.id === 'ambiguous-range')).toMatchObject({ mainObservedVisiblePass: 'inconclusive', required: false, reason: 'ambiguous native visible placement' })
    expect(entries.find(value => value.id === 'historical-main-miss')).toBeUndefined()
    expect(entries.every(value => value.mainRowSha256.length === 64 && value.nativeRowSha256.length === 64)).toBe(true)
    expect(report.meaning.nativeStability).toContain('not established')
    expect(report.sources[0]!['nativeRowsSha256']).toHaveLength(64)
  })

  test('missing or duplicated source rows cannot become a completed audit with a smaller population', async () => {
    const f = fixture(); await generate(f)
    const native = join(f.part, 'rebuild/chrome-rows.ndjson')
    writeFileSync(native, f.values.slice(1).map(value => JSON.stringify(value)).join('\n') + '\n')
    await expect(auditMainObligations({ catalog: f.catalog, out: f.out })).rejects.toThrow('do not cover the recorded census population')
    const g = fixture(); await generate(g)
    writeFileSync(join(g.part, 'main/chrome-rows.ndjson'), Array.from({ length: 4 }, () => JSON.stringify(linesRow(g.values[0]!, [[0, 3], [3, 5]], { skipped: 'predict-only' }))).join('\n') + '\n')
    await expect(auditMainObligations({ catalog: g.catalog, out: g.out })).rejects.toThrow('duplicate original main row')
  })

  test('changed input/run/output hashes and mismatched own native environment cannot falsely certify prior labels', async () => {
    const f = fixture(); await generate(f)
    writeFileSync(join(f.catalog, 'full-cases.ndjson'), '')
    await expect(auditMainObligations({ catalog: f.catalog, out: f.out })).rejects.toThrow('sealed output')
    const g = fixture(); await generate(g)
    const native = g.values.map(value => { const copied = structuredClone(value); copied.env.devicePixelRatio = 1; return copied })
    writeFileSync(join(g.part, 'rebuild/chrome-rows.ndjson'), native.map(value => JSON.stringify(value)).join('\n') + '\n')
    const report = await auditMainObligations({ catalog: g.catalog, out: g.out })
    expect(report.counts).toMatchObject({ verified: 0, inconclusive: 3 })
    expect(Object.keys(report.reasons)[0]).toContain('cannot combine original main/native environments')
    const h = fixture(); await generate(h)
    writeFileSync(join(h.part, 'main/chrome-run.json'), '{}')
    await expect(auditMainObligations({ catalog: h.catalog, out: h.out })).rejects.toThrow('catalog provenance')
  })
})
