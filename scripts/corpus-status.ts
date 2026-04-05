import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type BrowserKind = 'chrome' | 'safari' | 'firefox'

type AccuracySnapshot = {
  total?: number
  matchCount?: number
  mismatchCount?: number
}

type RepresentativeRow = {
  corpusId: string
  width: number
  diffPx: number
}

type RepresentativeSnapshot = {
  browsers: Partial<Record<BrowserKind, {
    rows: RepresentativeRow[]
  }>>
}

type SweepSummary = {
  corpusId: string
  language: string
  title: string
  widthCount: number
  exactCount: number
}

type AnchorSummary = {
  exactWidths: number[]
  mismatches: Array<{
    width: number
    diffPx: number
  }>
}

type CorpusDashboardMeta = {
  id: string
  notes: string
}

type FineSweepNote = {
  corpusId: string
  result:
    | { kind: 'exact_count', exactCount: number, widthCount: number }
    | { kind: 'not_fully_mapped', label: string }
  notes: string
}

type FontMatrixNote = {
  corpusId: string
  status: string
  notes: string
}

const PRODUCT_SHAPED: CorpusDashboardMeta[] = [
  {
    id: 'mixed-app-text',
    notes: 'remaining Chrome-only `710px` miss is SHY / extractor-sensitive; Safari is exact there again in height/line count',
  },
]

const LONG_FORM: CorpusDashboardMeta[] = [
  {
    id: 'en-gatsby-opening',
    notes: 'English long-form canary; broad narrow-width negative field with one local positive flip',
  },
  {
    id: 'ja-kumo-no-ito',
    notes: 'second Japanese canary; same broad one-line positive edge-fit field as `羅生門`, but smaller',
  },
  {
    id: 'ja-rashomon',
    notes: 'real Japanese canary; remaining field is mostly opening-quote / punctuation compression plus a few one-line edge fits',
  },
  {
    id: 'ko-unsu-joh-eun-nal',
    notes: 'Korean coarse corpus is clean',
  },
  {
    id: 'zh-guxiang',
    notes: 'second Chinese canary; same Chrome-positive / Safari-clean split as `祝福`, but slightly healthier overall',
  },
  {
    id: 'zh-zhufu',
    notes: 'real Chinese canary; broad positive one-line field in Chrome, exact Safari anchors',
  },
  {
    id: 'th-nithan-vetal-story-1',
    notes: 'two remaining coarse one-line misses',
  },
  {
    id: 'th-nithan-vetal-story-7',
    notes: 'second Thai canary stays healthy',
  },
  {
    id: 'km-prachum-reuang-preng-khmer-volume-7-stories-1-10',
    notes: 'full `step=10` is slower; sampled check is the preferred first pass',
  },
  {
    id: 'my-cunning-heron-teacher',
    notes: 'real residual Myanmar canary; quote/follower and phrase-break classes remain',
  },
  {
    id: 'my-bad-deeds-return-to-you-teacher',
    notes: 'healthier than the first Myanmar text, but still shows the same broad quote+follower class in Chrome',
  },
  {
    id: 'ur-chughd',
    notes: 'real Nastaliq/Naskh canary; broad negative field at narrow widths and local shaping/context drift',
  },
  {
    id: 'hi-eidgah',
    notes: 'Hindi coarse corpus is clean',
  },
  {
    id: 'ar-risalat-al-ghufran-part-1',
    notes: 'Arabic coarse corpus is clean; fine sweep still has a small positive one-line field',
  },
  {
    id: 'ar-al-bukhala',
    notes: 'large second Arabic canary; anchors are clean',
  },
  {
    id: 'he-masaot-binyamin-metudela',
    notes: 'Hebrew coarse corpus is clean',
  },
]

const FINE_SWEEP_NOTES: FineSweepNote[] = [
  {
    corpusId: 'ar-risalat-al-ghufran-part-1',
    result: { kind: 'exact_count', exactCount: 594, widthCount: 601 },
    notes: 'remaining misses are one-line positive edge-fit cases',
  },
  {
    corpusId: 'my-cunning-heron-teacher',
    result: { kind: 'not_fully_mapped', label: 'not fully mapped at `step=1`' },
    notes: 'current useful sentinels are the shared `350` and `690` classes',
  },
  {
    corpusId: 'ur-chughd',
    result: { kind: 'not_fully_mapped', label: 'not fully mapped at `step=1`' },
    notes: 'first narrow-width mismatch shows real local width/context drift, not dirty data',
  },
]

const FONT_MATRIX_NOTES: FontMatrixNote[] = [
  {
    corpusId: 'ja-kumo-no-ito',
    status: 'sampled matrix has a small field',
    notes: '`Hiragino Mincho ProN` had `+32px` at `450px`; `Hiragino Sans` was `5/5 exact`',
  },
  {
    corpusId: 'ja-rashomon',
    status: 'sampled matrix has small field',
    notes: '`Hiragino Mincho ProN` was `3/5 exact`; `Hiragino Sans` improved to `4/5 exact`, but `450px` still missed',
  },
  {
    corpusId: 'ko-unsu-joh-eun-nal',
    status: 'clean on sampled matrix',
    notes: '`Apple SD Gothic Neo`, `AppleMyungjo`',
  },
  {
    corpusId: 'zh-guxiang',
    status: 'sampled matrix has a real font split',
    notes: '`Songti SC` had `+64px` at `300` and `+32px` at `450`; `PingFang SC` improved `450` but still missed `300`',
  },
  {
    corpusId: 'zh-zhufu',
    status: 'sampled matrix has a real font split',
    notes: '`Songti SC` was `3/5 exact`; `PingFang SC` widened the positive field to `300 / 450 / 600`',
  },
  {
    corpusId: 'th-nithan-vetal-story-1',
    status: 'clean on sampled matrix',
    notes: '`Thonburi`, `Ayuthaya`',
  },
  {
    corpusId: 'th-nithan-vetal-story-7',
    status: 'clean on sampled matrix',
    notes: '`Thonburi`, `Ayuthaya`',
  },
  {
    corpusId: 'km-prachum-reuang-preng-khmer-volume-7-stories-1-10',
    status: 'clean on sampled matrix',
    notes: '`Khmer Sangam MN`, `Khmer MN`',
  },
  {
    corpusId: 'hi-eidgah',
    status: 'clean on sampled matrix',
    notes: '`Kohinoor Devanagari`, `Devanagari Sangam MN`, `ITF Devanagari`',
  },
  {
    corpusId: 'ar-risalat-al-ghufran-part-1',
    status: 'clean on sampled matrix',
    notes: '`Geeza Pro`, `SF Arabic`, `Arial`',
  },
  {
    corpusId: 'he-masaot-binyamin-metudela',
    status: 'clean on sampled matrix',
    notes: '`Times New Roman`, `SF Hebrew`',
  },
  {
    corpusId: 'my-cunning-heron-teacher',
    status: 'clean on sampled matrix',
    notes: '`Myanmar MN`, `Myanmar Sangam MN`, `Noto Sans Myanmar`',
  },
  {
    corpusId: 'my-bad-deeds-return-to-you-teacher',
    status: 'one sampled miss',
    notes: '`Myanmar Sangam MN` had `-32px` at `300px`; `Myanmar MN` and `Noto Sans Myanmar` stayed exact',
  },
  {
    corpusId: 'ur-chughd',
    status: 'sampled matrix has a real narrow field',
    notes: '`Noto Nastaliq Urdu` was `2/5 exact`; `Geeza Pro` improved to `3/5 exact` but kept the same narrow negative field',
  },
]

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

async function loadJson<T>(path: string): Promise<T> {
  return await Bun.file(path).json()
}

function indexRepresentativeRows(
  snapshot: RepresentativeSnapshot,
  browser: BrowserKind,
): Map<string, RepresentativeRow[]> {
  const rows = snapshot.browsers[browser]?.rows ?? []
  const byCorpus = new Map<string, RepresentativeRow[]>()
  for (const row of rows) {
    const bucket = byCorpus.get(row.corpusId)
    if (bucket === undefined) {
      byCorpus.set(row.corpusId, [row])
    } else {
      bucket.push(row)
    }
  }
  return byCorpus
}

function indexSweepSummaries(summaries: SweepSummary[]): Map<string, SweepSummary> {
  return new Map(summaries.map(summary => [summary.corpusId, summary] as const))
}

function summarizeAnchors(rows: RepresentativeRow[] | undefined): AnchorSummary | null {
  if (rows === undefined || rows.length === 0) return null

  const sorted = [...rows].sort((a, b) => a.width - b.width)
  return {
    exactWidths: sorted.filter(row => Math.round(row.diffPx) === 0).map(row => row.width),
    mismatches: sorted
      .filter(row => Math.round(row.diffPx) !== 0)
      .map(row => ({ width: row.width, diffPx: Math.round(row.diffPx) })),
  }
}

function summarizeAccuracy(snapshot: AccuracySnapshot) {
  return {
    total: snapshot.total ?? 0,
    matchCount: snapshot.matchCount ?? 0,
    mismatchCount: snapshot.mismatchCount ?? 0,
  }
}

const output = parseStringFlag('output') ?? 'corpora/dashboard.json'
const representative = await loadJson<RepresentativeSnapshot>('corpora/representative.json')
const chromeSampled = await loadJson<SweepSummary[]>('corpora/chrome-sampled.json')
const chromeStep10 = await loadJson<SweepSummary[]>('corpora/chrome-step10.json')
const chromeAccuracy = await loadJson<AccuracySnapshot>('accuracy/chrome.json')
const safariAccuracy = await loadJson<AccuracySnapshot>('accuracy/safari.json')
const firefoxAccuracy = await loadJson<AccuracySnapshot>('accuracy/firefox.json')

const chromeRepresentativeByCorpus = indexRepresentativeRows(representative, 'chrome')
const safariRepresentativeByCorpus = indexRepresentativeRows(representative, 'safari')
const sampledByCorpus = indexSweepSummaries(chromeSampled)
const step10ByCorpus = indexSweepSummaries(chromeStep10)

const dashboard = {
  generatedAt: new Date().toISOString(),
  sources: {
    accuracy: {
      chrome: 'accuracy/chrome.json',
      safari: 'accuracy/safari.json',
      firefox: 'accuracy/firefox.json',
    },
    representative: 'corpora/representative.json',
    chromeSampled: 'corpora/chrome-sampled.json',
    chromeStep10: 'corpora/chrome-step10.json',
    taxonomy: 'corpora/TAXONOMY.md',
  },
  browserRegressionGate: {
    chrome: summarizeAccuracy(chromeAccuracy),
    safari: summarizeAccuracy(safariAccuracy),
    firefox: summarizeAccuracy(firefoxAccuracy),
  },
  productShaped: PRODUCT_SHAPED.map(meta => {
    const sampled = sampledByCorpus.get(meta.id)
    const step10 = step10ByCorpus.get(meta.id)
    return {
      id: meta.id,
      title: step10?.title ?? sampled?.title ?? meta.id,
      language: step10?.language ?? sampled?.language ?? '',
      chromeAnchors: summarizeAnchors(chromeRepresentativeByCorpus.get(meta.id)),
      safariAnchors: summarizeAnchors(safariRepresentativeByCorpus.get(meta.id)),
      chromeSampled: sampled === undefined ? null : { exactCount: sampled.exactCount, widthCount: sampled.widthCount },
      chromeStep10: step10 === undefined ? null : { exactCount: step10.exactCount, widthCount: step10.widthCount },
      notes: meta.notes,
    }
  }),
  longForm: LONG_FORM.map(meta => {
    const sampled = sampledByCorpus.get(meta.id)
    const step10 = step10ByCorpus.get(meta.id)
    return {
      id: meta.id,
      title: step10?.title ?? sampled?.title ?? meta.id,
      language: step10?.language ?? sampled?.language ?? '',
      chromeAnchors: summarizeAnchors(chromeRepresentativeByCorpus.get(meta.id)),
      safariAnchors: summarizeAnchors(safariRepresentativeByCorpus.get(meta.id)),
      chromeSampled: sampled === undefined ? null : { exactCount: sampled.exactCount, widthCount: sampled.widthCount },
      chromeStep10: step10 === undefined ? null : { exactCount: step10.exactCount, widthCount: step10.widthCount },
      notes: meta.notes,
    }
  }),
  fineSweepNotes: FINE_SWEEP_NOTES,
  fontMatrixNotes: FONT_MATRIX_NOTES,
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8')
console.log(`wrote ${output}`)
