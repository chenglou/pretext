import { writeFileSync } from 'node:fs'

type BrowserKind = 'chrome' | 'safari' | 'firefox'

type AccuracySnapshot = {
  total?: number
  matchCount?: number
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

type CorpusStatusMeta = {
  id: string
  language: string
  chromeAnchorFallback: string
  safariAnchorFallback: string
  notes: string
}

const PRODUCT_SHAPED: CorpusStatusMeta[] = [
  {
    id: 'mixed-app-text',
    language: 'mul',
    chromeAnchorFallback: 'exact at `300 / 600 / 800`',
    safariAnchorFallback: '',
    notes: 'remaining Chrome-only `710px` miss is SHY / extractor-sensitive; Safari is exact there again in height/line count',
  },
]

const LONG_FORM: CorpusStatusMeta[] = [
  {
    id: 'ja-kumo-no-ito',
    language: 'Japanese',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact',
    notes: 'second Japanese canary; same broad one-line positive edge-fit field as `羅生門`, but smaller',
  },
  {
    id: 'ja-rashomon',
    language: 'Japanese',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact',
    notes: 'real Japanese canary; remaining field is mostly opening-quote / punctuation compression plus a few one-line edge fits',
  },
  {
    id: 'ko-unsu-joh-eun-nal',
    language: 'Korean',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'not recently rerun',
    notes: 'Korean coarse corpus is clean',
  },
  {
    id: 'zh-guxiang',
    language: 'Chinese',
    chromeAnchorFallback: 'exact at `600 / 800`, `+64px` at `300`',
    safariAnchorFallback: 'exact',
    notes: 'second Chinese canary; same Chrome-positive / Safari-clean split as `祝福`, but slightly healthier overall',
  },
  {
    id: 'zh-zhufu',
    language: 'Chinese',
    chromeAnchorFallback: 'exact at `600 / 800`, `+32px` at `300`',
    safariAnchorFallback: 'exact',
    notes: 'real Chinese canary; broad positive one-line field in Chrome, exact Safari anchors',
  },
  {
    id: 'th-nithan-vetal-story-1',
    language: 'Thai',
    chromeAnchorFallback: 'exact at key sentinels after fixes',
    safariAnchorFallback: 'exact',
    notes: 'two remaining coarse one-line misses',
  },
  {
    id: 'th-nithan-vetal-story-7',
    language: 'Thai',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact',
    notes: 'second Thai canary stays healthy',
  },
  {
    id: 'km-prachum-reuang-preng-khmer-volume-7-stories-1-10',
    language: 'Khmer',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact',
    notes: 'full `step=10` is slower; sampled check is the preferred first pass',
  },
  {
    id: 'my-cunning-heron-teacher',
    language: 'Myanmar',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact at anchors',
    notes: 'real residual Myanmar canary; quote/follower and phrase-break classes remain',
  },
  {
    id: 'my-bad-deeds-return-to-you-teacher',
    language: 'Myanmar',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact',
    notes: 'healthier than the first Myanmar text, but still shows the same broad quote+follower class in Chrome',
  },
  {
    id: 'ur-chughd',
    language: 'Urdu',
    chromeAnchorFallback: 'exact at `600 / 800`, `-76px` at `300`',
    safariAnchorFallback: 'exact at `600 / 800`, `-76px` at `300`',
    notes: 'real Nastaliq/Naskh canary; broad negative field at narrow widths and local shaping/context drift',
  },
  {
    id: 'hi-eidgah',
    language: 'Hindi',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact',
    notes: 'Hindi coarse corpus is clean',
  },
  {
    id: 'ar-risalat-al-ghufran-part-1',
    language: 'Arabic',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact at key sentinels',
    notes: 'Arabic coarse corpus is clean; fine sweep still has a small positive one-line field',
  },
  {
    id: 'ar-al-bukhala',
    language: 'Arabic',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact at anchors',
    notes: 'large second Arabic canary; anchors are clean',
  },
  {
    id: 'he-masaot-binyamin-metudela',
    language: 'Hebrew',
    chromeAnchorFallback: 'exact',
    safariAnchorFallback: 'exact',
    notes: 'Hebrew coarse corpus is clean',
  },
]

const PRODUCT_BY_ID = new Map(PRODUCT_SHAPED.map(meta => [meta.id, meta] as const))
const LONG_FORM_BY_ID = new Map(LONG_FORM.map(meta => [meta.id, meta] as const))

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

async function loadJson<T>(path: string): Promise<T> {
  return await Bun.file(path).json()
}

function formatSignedPx(diffPx: number): string {
  return `${diffPx > 0 ? '+' : ''}${Math.round(diffPx)}px`
}

function formatWidthList(widths: number[]): string {
  return widths.join(' / ')
}

function formatAnchorStatus(rows: RepresentativeRow[] | undefined, fallback: string): string {
  if (rows === undefined || rows.length === 0) {
    return fallback
  }

  const sorted = [...rows].sort((a, b) => a.width - b.width)
  const exactWidths = sorted
    .filter(row => Math.round(row.diffPx) === 0)
    .map(row => row.width)
  if (exactWidths.length === sorted.length) {
    return 'exact'
  }

  const parts: string[] = []
  if (exactWidths.length > 0) {
    parts.push(`exact at \`${formatWidthList(exactWidths)}\``)
  }

  for (const row of sorted) {
    if (Math.round(row.diffPx) === 0) continue
    parts.push(`\`${formatSignedPx(row.diffPx)}\` at \`${row.width}\``)
  }

  return parts.join(', ')
}

function formatSweepStatus(summary: SweepSummary | undefined): string {
  if (summary === undefined) return 'n/a'
  return `\`${summary.exactCount}/${summary.widthCount} exact\``
}

function formatAccuracyStatus(snapshot: AccuracySnapshot): string {
  const total = snapshot.total ?? 0
  const matchCount = snapshot.matchCount ?? 0
  return `\`${matchCount}/${total}\``
}

function renderCorpusRow(
  meta: CorpusStatusMeta,
  representativeByCorpus: Map<string, RepresentativeRow[]>,
  safariRepresentativeByCorpus: Map<string, RepresentativeRow[]>,
  sampledByCorpus: Map<string, SweepSummary>,
  step10ByCorpus: Map<string, SweepSummary>,
): string {
  return `| \`${meta.id}\` | ${meta.language} | ${formatAnchorStatus(representativeByCorpus.get(meta.id), meta.chromeAnchorFallback)} | ${formatAnchorStatus(safariRepresentativeByCorpus.get(meta.id), meta.safariAnchorFallback)} | ${formatSweepStatus(sampledByCorpus.get(meta.id))} | ${formatSweepStatus(step10ByCorpus.get(meta.id))} | ${meta.notes} |`
}

function renderProductRow(
  meta: CorpusStatusMeta,
  representativeByCorpus: Map<string, RepresentativeRow[]>,
  step10ByCorpus: Map<string, SweepSummary>,
): string {
  return `| \`${meta.id}\` | ${formatAnchorStatus(representativeByCorpus.get(meta.id), meta.chromeAnchorFallback)} | ${formatSweepStatus(step10ByCorpus.get(meta.id))} | ${meta.notes} |`
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

const output = parseStringFlag('output') ?? 'corpora/STATUS.md'
const representative = await loadJson<RepresentativeSnapshot>('corpora/representative.json')
const chromeSampled = await loadJson<SweepSummary[]>('corpora/chrome-sampled.json')
const chromeStep10 = await loadJson<SweepSummary[]>('corpora/chrome-step10.json')
const chromeAccuracy = await loadJson<AccuracySnapshot>('accuracy/chrome.json')
const safariAccuracy = await loadJson<AccuracySnapshot>('accuracy/safari.json')
const firefoxAccuracy = await loadJson<AccuracySnapshot>('accuracy/firefox.json')
const existingStatus = await Bun.file(output).text()

const tailStart = existingStatus.indexOf('## Fine-Sweep Notes')
if (tailStart === -1) {
  throw new Error(`Could not find manual tail marker in ${output}`)
}

const manualTail = existingStatus.slice(tailStart).trimStart()
const chromeRepresentativeByCorpus = indexRepresentativeRows(representative, 'chrome')
const safariRepresentativeByCorpus = indexRepresentativeRows(representative, 'safari')
const sampledByCorpus = indexSweepSummaries(chromeSampled)
const step10ByCorpus = indexSweepSummaries(chromeStep10)

for (const summary of chromeStep10) {
  if (!PRODUCT_BY_ID.has(summary.corpusId) && !LONG_FORM_BY_ID.has(summary.corpusId)) {
    throw new Error(`Missing corpus metadata for ${summary.corpusId}`)
  }
}

const head = [
  '# Corpus Status',
  '',
  'Current sweep snapshot for the checked-in canaries.',
  '',
  'This is the compact status page. Historical reasoning, failed experiments, and',
  'why the numbers moved live in `RESEARCH.md`. The shared mismatch vocabulary now',
  'lives in `TAXONOMY.md`. Machine-readable anchor rows live in `representative.json`,',
  'and the current Chrome sampled / coarse sweep snapshots live in `chrome-sampled.json`',
  'and `chrome-step10.json`.',
  '',
  'Conventions:',
  '- "anchors" means `300 / 600 / 800` unless noted otherwise',
  '- "sampled" usually means `--samples=9`',
  '- "step=10" means `300..900`',
  '- values are the last recorded results on this machine, not a claim of universal permanence',
  '',
  '<!-- Top tables are generated by `bun run corpus-status` from checked-in JSON snapshots. -->',
  '',
  '## Browser Regression Gate',
  '',
  '| Sweep | Status |',
  '|---|---|',
  `| Official browser corpus (Chrome) | ${formatAccuracyStatus(chromeAccuracy)} |`,
  `| Official browser corpus (Safari) | ${formatAccuracyStatus(safariAccuracy)} |`,
  `| Official browser corpus (Firefox) | ${formatAccuracyStatus(firefoxAccuracy)} |`,
  '',
  '## Product-Shaped Canary',
  '',
  '| Corpus | Chrome anchors | Chrome step=10 | Notes |',
  '|---|---:|---:|---|',
  ...PRODUCT_SHAPED.map(meta => renderProductRow(meta, chromeRepresentativeByCorpus, step10ByCorpus)),
  '',
  '## Long-Form Corpora',
  '',
  '| Corpus | Language | Chrome anchors | Safari anchors | Chrome sampled | Chrome step=10 | Notes |',
  '|---|---|---:|---:|---:|---:|---|',
  ...LONG_FORM.map(meta =>
    renderCorpusRow(
      meta,
      chromeRepresentativeByCorpus,
      safariRepresentativeByCorpus,
      sampledByCorpus,
      step10ByCorpus,
    ),
  ),
  '',
].join('\n')

writeFileSync(output, `${head}\n${manualTail.endsWith('\n') ? manualTail : `${manualTail}\n`}`, 'utf8')
console.log(`wrote ${output}`)
