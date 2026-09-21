import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { abcd } from '../lab/row-fixtures.ts'
import type { Case } from '../lab/types.ts'
import { buildMainObligations, coverageTokens, inputPath } from './main-obligations.ts'
import { LEDGER_FORMAT, type LedgerHeader } from './ledger.ts'

function fixture(): { root: string; from: string; artifacts: string; input: string; metadata: string; out: string; values: Case[] } {
  const root = mkdtempSync(join(tmpdir(), 'main-obligations-')), from = join(root, 'census'), artifacts = join(root, '.artifacts')
  const part = join(from, 'chrome', 'chunk00'), input = join(artifacts, 'original/cases.ndjson'), metadata = join(part, 'cases.ndjson')
  for (const path of [join(artifacts, 'original'), join(part, 'main'), join(part, 'rebuild')]) mkdirSync(path, { recursive: true })
  const values = ['a-pass', 'b-redo-fail', 'c-inconclusive', 'd-main-fail'].map((id, i) => {
    const value: Case = { id, family: 'fixture', origin: '', pageLang: 'und', paragraph: structuredClone(abcd) }
    value.id = id; value.family = i === 1 ? 'rule/other' : 'rule/first'; value.origin = i === 1 ? 'heuristic excluded by old triage' : 'arbitrary input'
    if (i === 1) { value.paragraph.font.family = 'Alternate'; value.paragraph.width = 40; value.paragraph.direction = 'rtl'; value.paragraph.runs[0]!.text = 'مرحبا بالعالم'; value.paragraph.runs[0]!.font.family = 'Alternate' }
    return value
  })
  writeFileSync(input, values.map(value => JSON.stringify(value)).join('\n') + '\n')
  const records = values.map((value, i) => ({ browser: 'chrome', id: value.id, family: value.family, chunk: 'chunk00', units: value.paragraph.runs.map(run => run.text).join('').length, main: { lineCount: 'pass', visibleBreaks: i === 2 ? 'unobserved' : i === 3 ? 'fail' : 'pass' }, native: { lines: 1, key: 'native-' + i }, rebuild: { lineCount: i === 1 ? 'fail' : 'pass', breaks: 'pass', widths: 'pass', painter: 'pass' }, gaps: i === 1 ? ['font-fallback'] : [], covered: i === 1 ? { lineCount: true } : {} }))
  writeFileSync(metadata, records.map(value => JSON.stringify(value)).join('\n') + '\n')
  for (const kind of ['main', 'rebuild']) writeFileSync(join(part, kind, 'chrome-run.json'), JSON.stringify({ status: 'ok', casesFile: '/removed/worktree/.artifacts/original/cases.ndjson', order: 'file', predictOnly: kind === 'main', totals: { rows: values.length }, build: { engine: '153' }, languages: { given: { uiLanguage: 'und' } }, bundleSha256: kind + '-bundle' }))
  mkdirSync(join(from, 'chrome', 'corpus04'), { recursive: true }) // Discovered, unclassified evidence cannot be called zero.
  return { root, from, artifacts, input, metadata, out: join(root, 'staged'), values }
}
function rows(path: string): any[] { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
function corpusFixture() {
  const f = fixture(), texts = ['short source\n  ', 'short source\n  ', 'second full paragraph '.repeat(300), 'main did not pass '.repeat(300)]
  for (let i = 0; i < f.values.length; i++) {
    const value = f.values[i]!
    value.family = 'suite/maintained/corpus'; value.origin = `suite maintained/corpus fixture-${i}`
    value.pageLang = 'en'; value.paragraph = structuredClone(abcd); value.paragraph.runs[0]!.text = texts[i]!
    value.paragraph.whiteSpace = 'normal'; value.paragraph.width = 100 + i * 10
  }
  writeFileSync(f.input, f.values.map(value => JSON.stringify(value)).join('\n') + '\n')
  const records = rows(f.metadata).map((value, i) => ({ ...value, family: f.values[i]!.family, units: texts[i]!.length, main: { lineCount: 'pass', visibleBreaks: i === 3 ? 'fail' : 'pass' } }))
  writeFileSync(f.metadata, records.map(value => JSON.stringify(value)).join('\n') + '\n')
  return f
}

describe('main/native obligations', () => {
  test('a cheap repeated book cannot crowd out a longer book sharing every family/font/style token; main failures remain visible', async () => {
    const f = corpusFixture()
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out, budget: 2, maxUnits: 10000 })
    const fast = rows(join(f.out, 'fast-cases.ndjson'))
    expect(new Set(fast.map(value => value.paragraph.runs[0].text))).toEqual(new Set([f.values[0]!.paragraph.runs[0]!.text, f.values[2]!.paragraph.runs[0]!.text]))
    expect(rows(join(f.out, 'full-cases.ndjson'))).toHaveLength(3)
    expect(rows(join(f.out, 'population.ndjson')).find(value => value.id === 'd-main-fail').mainPassObligation).toBe(false)
    const manifest = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8'))
    expect(manifest.selection.fast.corpusTexts).toMatchObject({ population: 3, eligible: 2, selected: 2 })
    expect(manifest.selection.fast.corpusTexts.absentFromFast).toHaveLength(1)
    const previous = readFileSync(join(f.out, 'fast-cases.ndjson'), 'utf8')
    writeFileSync(f.metadata, rows(f.metadata).reverse().map(value => JSON.stringify({ ...value, rebuild: { lineCount: 'fail', breaks: 'fail', widths: 'fail', painter: 'fail' }, gaps: ['everything'], covered: { lineCount: true, breaks: true } })).join('\n') + '\n')
    const changed = join(f.root, 'changed')
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: changed, budget: 2, maxUnits: 10000 })
    expect(readFileSync(join(changed, 'fast-cases.ndjson'), 'utf8')).toBe(previous)
  })

  test('corpus size or budget omissions are explicit rather than certifying that the one represented font covers all books', async () => {
    const f = corpusFixture()
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out, budget: 2, maxUnits: 100 })
    expect(rows(join(f.out, 'full-cases.ndjson'))).toHaveLength(3)
    const coverage = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8')).selection.fast.corpusTexts
    expect(coverage).toMatchObject({ population: 3, eligible: 1, selected: 1 })
    expect(coverage.unavailableForFast).toHaveLength(2)
    await expect(buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: join(f.root, 'too-small'), budget: 1, maxUnits: 10000 })).rejects.toThrow('required family/corpus-text representatives')
  })

  test('corpus identity hashes the exact raw text, independent of width; reconstructed item paragraphs cannot inherit it', () => {
    const f = corpusFixture(), first = f.values[0]!, second = f.values[1]!
    const token = (value: Case) => coverageTokens(value).find(value => value.startsWith('corpusText:'))
    expect(token(first)).toBe(`corpusText:${createHash('sha256').update(first.paragraph.runs[0]!.text).digest('hex')}`)
    expect(token(first)).toBe(token(second))
    second.paragraph.runs[0]!.text = first.paragraph.runs[0]!.text.replace(/\s+/g, ' ').trim()
    expect(token(first)).not.toBe(token(second))
    second.paragraph.runs.push(structuredClone(second.paragraph.runs[0]!))
    expect(() => token(second)).toThrow('one-node raw paragraph shape')
    second.paragraph.runs = [structuredClone(first.paragraph.runs[0]!)]
    second.paragraph.runs[0]!.node = 'span'
    expect(() => token(second)).toThrow('one-node raw paragraph shape')
    second.paragraph.runs[0]!.node = 'text'; second.paragraph.whiteSpace = 'pre-wrap'
    expect(() => token(second)).toThrow('one-node raw paragraph shape')
  })

  test('keeps every observed main pass including a covered rebuild failure and heuristic origin; inconclusive observations stay visible', async () => {
    const f = fixture()
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out, budget: 2 })
    const full = rows(join(f.out, 'full-cases.ndjson')), fast = rows(join(f.out, 'fast-cases.ndjson')), obligations = rows(join(f.out, 'obligations.ndjson')), population = rows(join(f.out, 'population.ndjson'))
    expect(full.map(value => value.id)).toEqual(['a-pass', 'b-redo-fail'])
    expect(fast.map(value => value.id)).toEqual(['a-pass', 'b-redo-fail'])
    expect(full[1]!.origin).toBe('heuristic excluded by old triage')
    expect(obligations[1]!.observedRebuild.lineCount).toBe('fail')
    expect(obligations[1]!.gaps).toEqual(['font-fallback'])
    expect(obligations.every(value => value.nativeStability === 'unverified-single-observation')).toBe(true)
    expect(population.find(value => value.id === 'c-inconclusive')!.mainPassObligation).toBe(false)
    expect(population.find(value => value.id === 'c-inconclusive')!.main.visibleBreaks).toBe('unobserved')
    const manifest = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8'))
    expect(manifest.selectedPopulationComplete).toBe(true)
    expect(manifest.allDiscoveredPartsComplete).toBe(false)
    expect(manifest.discoveredParts.find((part: any) => part.part === 'corpus04').metadataPresent).toBe(false)
    expect(manifest.counts).toMatchObject({ population: 4, obligations: 2, observedRebuildLineCountOrBreaksFailures: 1 })
    expect(manifest.selection.fast.missingTokens).toEqual([])
    expect(manifest.sources[0].inputSha256).toBe(createHash('sha256').update(readFileSync(f.input)).digest('hex'))
    expect(manifest.outputs.find((output: any) => output.file === 'full-cases.ndjson').sha256).toBe(createHash('sha256').update(readFileSync(join(f.out, 'full-cases.ndjson'))).digest('hex'))
  })

  test('selection cannot improve when rebuild failures or covering gaps change', async () => {
    const f = fixture()
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out, budget: 2 })
    const before = readFileSync(join(f.out, 'fast-cases.ndjson'), 'utf8')
    const records = rows(f.metadata).map(record => ({ ...record, rebuild: { lineCount: 'fail', breaks: 'fail', widths: 'fail', painter: 'fail' }, gaps: ['everything'], covered: { lineCount: true, breaks: true } }))
    writeFileSync(f.metadata, records.reverse().map(value => JSON.stringify(value)).join('\n') + '\n')
    const changed = join(f.root, 'changed')
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: changed, budget: 2 })
    expect(readFileSync(join(changed, 'fast-cases.ndjson'), 'utf8')).toBe(before)
  })

  test('literal Unicode line separators inside JSON text are not mistaken for record boundaries', async () => {
    const f = fixture()
    f.values[0]!.paragraph.runs[0]!.text = 'a\u2028b\u2029c'
    writeFileSync(f.input, f.values.map(value => JSON.stringify(value)).join('\n') + '\n')
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out, budget: 2 })
    expect(rows(join(f.out, 'full-cases.ndjson'))[0]!.paragraph.runs[0].text).toBe('a\u2028b\u2029c')
  })

  test('reviewed native history is annotated rather than used to improve selection, and legacy mixed exclusions are refused', async () => {
    const f = fixture(), history = join(f.root, 'history')
    mkdirSync(history)
    const header: LedgerHeader = {
      format: LEDGER_FORMAT, browser: 'chrome', config: 'no-facts', predictor: 'recorded', build: { app: 'Chrome', appVersion: '153', engine: '153', os: 'test' },
      environments: [], scorer: 8, bundles: [], library: null, orders: 'both', historyCarriedFrom: null,
      sets: { sample: { protocol: { set: 'sample', parts: [], casesPerRoundTrip: 25, freshProcessPerPart: true, runArgs: [] }, subset: false, cases: 1, environments: [], evidence: [] } },
      counts: { lineCount: { 'history-dependent': 1 }, breaks: { 'history-dependent': 1 }, widths: { 'history-dependent': 1 }, painter: { 'history-dependent': 1 } },
      exact: { counts: { 'history-dependent': 1 }, rectCounts: 0, rectCountsDiffering: 0, predictedValues: 0, predictedValuesDiffering: 0, passingWithDifferingValues: 0, passingWithDifferingRectCounts: 0 },
    }
    writeFileSync(join(history, 'ledger.json'), JSON.stringify(header))
    writeFileSync(join(history, 'entries.ndjson'), JSON.stringify({ set: 'sample', id: 'b-redo-fail', family: 'rule/other', status: { lineCount: 'history-dependent', breaks: 'history-dependent', widths: 'history-dependent', painter: 'history-dependent' }, exact: 'history-dependent' }) + '\n')
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out, budget: 2, historyLedger: history })
    expect(rows(join(f.out, 'fast-cases.ndjson')).map(value => value.id)).toEqual(['a-pass', 'b-redo-fail'])
    expect(rows(join(f.out, 'obligations.ndjson'))[1]!.knownNativeHistory).toBe(true)
    const manifest = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8'))
    expect(manifest.counts.obligationsWithKnownNativeHistory).toBe(1)
    expect(manifest.historySource.headerSha256).toHaveLength(64)
    writeFileSync(join(history, 'ledger.json'), JSON.stringify({ ...header, format: 'pretext-ledger/2' }))
    const legacyOut = join(f.root, 'legacy-out')
    await expect(buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: legacyOut, historyLedger: history })).rejects.toThrow('expected pretext-ledger/3')
    expect(existsSync(legacyOut)).toBe(false)
  })

  test('fast size limits reveal absent families without deleting full obligations; undersized budgets cannot quietly drop families', async () => {
    const f = fixture()
    await buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out, budget: 2, maxUnits: 5 })
    expect(rows(join(f.out, 'full-cases.ndjson'))).toHaveLength(2)
    expect(rows(join(f.out, 'fast-cases.ndjson')).map(value => value.id)).toEqual(['a-pass'])
    const manifest = JSON.parse(readFileSync(join(f.out, 'manifest.json'), 'utf8'))
    expect(manifest.selection.fast.familiesAbsent).toEqual(['family:rule/other'])
    expect(manifest.selection.fast.omittedForSize).toBe(1)
    const small = join(f.root, 'undersized')
    await expect(buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: small, budget: 1 })).rejects.toThrow('cannot cover 2 eligible families')
    expect(existsSync(join(small, 'manifest.json'))).toBe(false)
  })

  test('missing original evidence, incorrect recorded totals and missing case inputs cannot become a complete manifest', async () => {
    const f = fixture()
    await expect(buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', out: f.out, parts: 'chunk00,corpus04' })).rejects.toThrow('corpus04: selected original part is incomplete')
    expect(existsSync(f.out)).toBe(false)
    await expect(buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', out: f.out })).rejects.toThrow('chunk01: selected original part is incomplete')
    const nativePath = join(f.from, 'chrome/chunk00/rebuild/chrome-run.json'), record = JSON.parse(readFileSync(nativePath, 'utf8'))
    record.totals.rows = 3; writeFileSync(nativePath, JSON.stringify(record))
    await expect(buildMainObligations({ from: f.from, artifactRoot: f.artifacts, browser: 'chrome', parts: 'chunk00', out: f.out })).rejects.toThrow('metadata population differs')
    expect(existsSync(join(f.out, 'manifest.json'))).toBe(false)
    expect(() => inputPath('/removed/worktree/.artifacts/missing.ndjson', f.artifacts)).toThrow('recorded case input missing')
    expect(() => inputPath('/tmp/similarly-named.ndjson', f.artifacts)).toThrow('no .artifacts suffix')
    expect(() => inputPath('.artifacts/../escape.ndjson', f.artifacts)).toThrow('escapes --artifact-root')
  })
})
