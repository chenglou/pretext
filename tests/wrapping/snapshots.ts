import { environmentFailure } from '../../shared/browser-environment.ts'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TEXTS, SIZES, WIDTHS, ACCURACY_FONTS, LETTER_SPACING_ORACLE_CASES } from '../../src/test-data.ts'
import sources from '../../corpora/sources.json'
import type { BrowserContext, BrowserEnvironment, BrowserKind, CaseResult } from './types.ts'
import { predictionGeometry } from './observe.ts'

type Row = {
  id: string; label: string; font: string; width: number; contentWidth: number
  direction: 'ltr' | 'rtl'; context: BrowserContext
  actual: number; predicted: number; diff: number; pass: boolean; breaks: string
}
type Environment = BrowserEnvironment & { direction: 'ltr' | 'rtl' }
type Capture = { environments: Environment[]; accuracy: Row[]; spacing: Row[]; corpora: Record<string, Row[]> }

function environmentsFor(capture: Capture, rows: Row[]): Environment[] {
  const matches = (row: Row, environment: Environment) => row.direction === environment.direction && (row.context.kind === 'fixtures'
    ? environment.context.kind === 'fixtures'
    : environment.context.kind === 'installed' && row.context.lang === environment.context.lang)
  const environments = capture.environments.filter(environment => rows.some(row => matches(row, environment)))
  for (const row of rows) {
    if (!environments.some(environment => matches(row, environment))) throw new Error(`Missing snapshot environment for ${row.id}: ${row.direction}/${row.context.kind === 'fixtures' ? 'fixtures' : row.context.lang}`)
  }
  return environments
}

// Dashboards consume the same observations as the gate. Only mismatches need
// checked-in rows; the complete input, rectangle and API evidence stays in NDJSON.
export function createSnapshots() {
  const captures: Record<BrowserKind, Capture> = {
    chrome: { environments: [], accuracy: [], spacing: [], corpora: {} },
    safari: { environments: [], accuracy: [], spacing: [], corpora: {} },
    firefox: { environments: [], accuracy: [], spacing: [], corpora: {} },
  }
  return {
    addRows(browser: BrowserKind, rows: CaseResult[]): void {
      const capture = captures[browser]
      for (const { input, native, predictions } of rows) {
        for (const origin of input.origins) {
          const accuracy = origin.startsWith('accuracy/')
          const corpus = origin.startsWith('corpora/')
          const spacing = origin.startsWith('maintained/letter-spacing/')
          if (!accuracy && !corpus && !spacing) continue
          const result = predictions.find(result => result.name === 'current')!
          if ('error' in result) throw new Error(`Incomplete snapshot ${input.id}: ${result.error}`)
          const predicted = predictionGeometry(input, result.prediction)
          const row: Row = {
            id: input.id, label: origin.slice(origin.lastIndexOf('/') + 1), font: input.font,
            direction: input.direction, context: input.context ?? { kind: 'fixtures' },
            width: input.width + (corpus || spacing ? 80 : 0), contentWidth: input.width,
            actual: native.height, predicted: predicted.height,
            diff: predicted.height - native.height,
            pass: result.assessment.height.status === 'pass' && (!spacing || result.assessment.lineCount.status === 'pass'), breaks: result.assessment.breaks.status,
          }
          if (accuracy) capture.accuracy.push(row)
          else if (spacing) capture.spacing.push(row)
          else (capture.corpora[row.label] ??= []).push(row)
        }
      }
    },
    addEnvironment(browser: BrowserKind, direction: 'ltr' | 'rtl', environment: BrowserEnvironment): void {
      const failure = environmentFailure(environment.measurement, 'correctness')
      if (failure !== null) throw new Error(`Invalid ${browser} snapshot: ${failure}`)
      const capture = captures[browser]
      for (const previous of capture.environments) {
        if (previous.measurement.userAgent !== environment.measurement.userAgent ||
            previous.measurement.start.dpr !== environment.measurement.start.dpr ||
            previous.measurement.start.visualViewportScale !== environment.measurement.start.visualViewportScale) {
          throw new Error(`Incompatible ${browser} snapshot environments; rerun on one display scale`)
        }
        const sameContext = previous.context.kind === 'fixtures'
          ? environment.context.kind === 'fixtures'
          : environment.context.kind === 'installed' && previous.context.lang === environment.context.lang
        if (previous.direction === direction && sameContext) throw new Error(`Duplicate ${browser} snapshot context`)
      }
      capture.environments.push({ direction, ...environment })
    },
    async write(root: string, evidence: { suiteHash: string; source: { revision: string | null; files: Record<string, string> }; output: string }): Promise<void> {
      const generatedAt = new Date().toISOString()
      const source = { revision: evidence.source.revision, files: evidence.source.files }
      const files: Array<{ path: string; data: unknown }> = []
      const spacingResults = []
      const spacingEnvironments: Array<Environment & { browser: BrowserKind }> = []
      for (const browser of ['chrome', 'safari', 'firefox'] as const) {
        const capture = captures[browser]
        const expectedAccuracy = TEXTS.length * SIZES.length * WIDTHS.length * ACCURACY_FONTS.length
        if (capture.accuracy.length !== expectedAccuracy) throw new Error(`Incomplete ${browser} accuracy snapshot: ${capture.accuracy.length}/${expectedAccuracy}`)
        const expectedSpacing = LETTER_SPACING_ORACLE_CASES.filter(input => (input.browsers ?? ['chrome', 'safari']).includes(browser)).length
        if (capture.spacing.length !== expectedSpacing) throw new Error(`Incomplete ${browser} letter-spacing snapshot: ${capture.spacing.length}/${expectedSpacing}`)
        const mismatches = capture.accuracy.filter(row => !row.pass)
        const provenance = { generatedAt, suiteHash: evidence.suiteHash, source }
        files.push({ path: `accuracy/${browser}.json`, data: {
          ...provenance, environments: environmentsFor(capture, capture.accuracy), status: 'ready', total: capture.accuracy.length,
          matchCount: capture.accuracy.length - mismatches.length, mismatchCount: mismatches.length, mismatches,
        } })
        for (const row of capture.spacing) spacingResults.push({ browser, ...row })
        for (const environment of environmentsFor(capture, capture.spacing)) spacingEnvironments.push({ browser, ...environment })
        const corpusSummaries = sources.map(meta => {
          const rows = capture.corpora[meta.id] ?? []
          rows.sort((a, b) => a.width - b.width)
          const start = meta.min_width ?? 300, end = meta.max_width ?? 900
          const expected = Math.floor((end - start) / 10) + 1
          if (rows.length !== expected) throw new Error(`Incomplete ${browser} ${meta.id} snapshot: ${rows.length}/${expected}`)
          const mismatches = rows.filter(row => !row.pass)
          return {
            ...provenance, environments: environmentsFor(capture, rows),
            corpusId: meta.id, language: meta.language, title: meta.title, browser,
            start, end, step: 10, widthCount: rows.length, exactCount: rows.length - mismatches.length,
            mismatches: mismatches.map(row => ({ id: row.id, width: row.width, contentWidth: row.contentWidth,
              diffPx: row.diff, predictedHeight: row.predicted + 80, actualHeight: row.actual + 80 })),
          }
        })
        files.push({ path: `corpora/${browser}-step10.json`, data: corpusSummaries })
      }
      files.push({ path: 'accuracy/letter-spacing.json', data: {
        generatedAt, suiteHash: evidence.suiteHash, source, environments: spacingEnvironments,
        total: spacingResults.length,
        geometryMatchCount: spacingResults.filter(row => row.pass).length,
        geometryMismatchCount: spacingResults.filter(row => !row.pass).length,
        firstBreakMismatchCount: spacingResults.filter(row => row.breaks === 'fail').length,
        results: spacingResults,
      } })
      // Validate every requested capture before replacing any dashboard input.
      for (const file of files) await writeFile(join(root, file.path), JSON.stringify(file.data, null, 2) + '\n')
      console.log(`Updated maintained snapshots from ${evidence.output}`)
    },
  }
}
