import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abcd, abcdExpected, abcdLayout, abcdNative, row } from '../lab/row-fixtures.ts'
import { readLedger, type LedgerEntry, type LedgerHeader } from './ledger.ts'
import { migrateLedger } from './migrate-ledger.ts'

function fixture(): { root: string; from: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'ledger-migration-'))
  const from = join(root, 'legacy')
  const forward = join(root, 'recording/forward')
  const reverse = join(root, 'recording/reverse')
  for (const dir of [from, forward, reverse]) mkdirSync(dir, { recursive: true })
  for (const [order, folder] of [['forward', forward], ['reverse', reverse]] as const) {
    const stable = row('chrome', abcd, abcdNative, abcdLayout, abcdExpected)
    stable.id = 'c-stable'
    const predicted = structuredClone(abcdExpected)
    if (order === 'reverse') predicted.codePoints[1]!.rects[0]!.x.value += 1 / 128
    const orderDependent = row('chrome', abcd, abcdNative, abcdLayout, predicted)
    orderDependent.id = 'c-order'
    const nativeDependent = structuredClone(stable)
    nativeDependent.id = 'c-native'
    if ('error' in nativeDependent.native || 'skipped' in nativeDependent.native) throw new Error('fixture must carry a native observation')
    nativeDependent.native.floats = [{ x: 0, y: order === 'reverse' ? 1 : 0, width: 8, height: 20 }]
    for (const value of [stable, orderDependent, nativeDependent]) value.case.id = value.id
    writeFileSync(join(folder, 'chrome-rows.ndjson'), [stable, orderDependent, nativeDependent].map(value => JSON.stringify(value)).join('\n') + '\n')
    writeFileSync(join(folder, 'chrome-run.json'), JSON.stringify({ status: 'ok', predictOnly: false, runId: order, bundleSha256: 'original-library-bundle', startedAt: '2026-09-20T00:00:00Z' }))
  }
  const evidence = ([['forward', forward], ['reverse', reverse]] as const).map(([order, folder]) => ({ part: 0, order, run: join(folder, 'chrome-run.json'), perCase: join(folder, 'chrome-per-case.ndjson'), summary: join(folder, 'chrome-summary.json'), runId: order, bundleSha256: 'original-library-bundle', startedAt: '2026-09-20T00:00:00Z' }))
  const header: LedgerHeader = {
    format: 'pretext-ledger/2' as LedgerHeader['format'], browser: 'chrome', config: 'no-facts', predictor: 'original-predictor.ts', build: { app: 'Chrome', appVersion: '153', engine: '153', os: 'test' }, environments: [], scorer: 7, bundles: ['original-library-bundle'], library: { commit: 'original-library-commit', dirty: [] }, orders: 'both', historyCarriedFrom: null,
    sets: { sample: { protocol: { set: 'sample', parts: [{ casesFile: 'sample.ndjson', casesSha256: 'case-inputs-hash' }], casesPerRoundTrip: 25, freshProcessPerPart: true, runArgs: [] }, subset: false, cases: 3, environments: [], evidence } }, counts: { lineCount: {}, breaks: {}, widths: {}, painter: {} }, exact: { counts: {}, rectCounts: 0, rectCountsDiffering: 0, predictedValues: 0, predictedValuesDiffering: 0, passingWithDifferingValues: 0, passingWithDifferingRectCounts: 0 },
  }
  const entries: LedgerEntry[] = ['c-stable', 'c-order', 'c-native'].map(id => ({ set: 'sample', id, family: 'fixture', status: { lineCount: 'pass', breaks: 'pass', widths: 'pass', painter: 'pass' }, exact: id === 'c-order' ? 'history-dependent' : 'exact' }))
  writeFileSync(join(from, 'ledger.json'), JSON.stringify(header))
  writeFileSync(join(from, 'entries.ndjson'), entries.map(value => JSON.stringify(value)).join('\n') + '\n')
  return { root, from, out: join(root, 'staged') }
}

describe('migration from recorded observations', () => {
  test('reclassifies native-only and prediction-only plants, preserving source evidence and requiring review', async () => {
    const { root, from, out } = fixture()
    const beforeHeader = readFileSync(join(from, 'ledger.json'), 'utf8')
    const beforeEntries = readFileSync(join(from, 'entries.ndjson'), 'utf8')
    const result = await migrateLedger({ from, sourceRoot: root, out, native: 'full' })
    expect(result.cases).toBe(3)
    expect(result.reviewRequired).toBe(true)
    const staged = readLedger(join(out, 'ledger'))
    expect(staged.header.scorer).toBe(8)
    expect(staged.header.library!.commit).toBe('original-library-commit')
    expect(staged.header.bundles).toEqual(['original-library-bundle'])
    const stable = staged.entries.find(entry => entry.id === 'c-stable')!
    const order = staged.entries.find(entry => entry.id === 'c-order')!
    const native = staged.entries.find(entry => entry.id === 'c-native')!
    expect(stable.exact).toBe('exact')
    expect([order.status.lineCount, order.status.breaks, order.status.widths]).toEqual(['pass', 'pass', 'pass'])
    expect(order.exact).toBe('prediction-order-dependent')
    expect(order.predictionOrderDependent!.exact).toEqual({ forward: 'exact', reverse: 'not exact (values 1, rect counts 0)', differing: { forward: null, reverse: { values: 1, rectCounts: 0 } } })
    expect(Object.values(native.status)).toEqual(['history-dependent', 'history-dependent', 'history-dependent', 'history-dependent'])
    expect(native.exact).toBe('history-dependent')
    expect(result.nativeHistoryAdded).toHaveLength(5)
    const provenance = JSON.parse(readFileSync(join(out, 'migration.json'), 'utf8')) as { pinsChanged: boolean; seedsAdopted: boolean; evidence: Array<{ rowsSha256: string; runSha256: string }> }
    expect([provenance.pinsChanged, provenance.seedsAdopted]).toEqual([false, false])
    expect(provenance.evidence).toHaveLength(2)
    expect(provenance.evidence.every(item => item.rowsSha256.length === 64 && item.runSha256.length === 64)).toBe(true)
    expect(readFileSync(join(from, 'ledger.json'), 'utf8')).toBe(beforeHeader)
    expect(readFileSync(join(from, 'entries.ndjson'), 'utf8')).toBe(beforeEntries)
  })

  test('cannot carry legacy history or overwrite output, and plan does not stage', async () => {
    const { root, from, out } = fixture()
    await expect(migrateLedger({ from, sourceRoot: root, out, native: 'full', carryNativeFrom: from })).rejects.toThrow('expected pretext-ledger/3')
    expect(existsSync(out)).toBe(false)
    await migrateLedger({ from, sourceRoot: root, out, native: 'full', plan: true })
    expect(existsSync(out)).toBe(false)
    mkdirSync(out)
    await expect(migrateLedger({ from, sourceRoot: root, out, native: 'full' })).rejects.toThrow('staging output already exists')
  })
})
