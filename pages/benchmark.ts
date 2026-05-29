import {
  prepare,
  prepareWithSegments,
  layout,
  layoutNextLine,
  measureLineStats,
  layoutWithLines,
  walkLineRanges,
  clearCache,
} from '../src/layout.ts'
import type { PreparedText, PreparedTextWithSegments } from '../src/layout.ts'
import { analyzeText } from '../src/analysis.ts'
import { getEngineProfile } from '../src/measurement.ts'
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
  type RichInlineItem,
  type PreparedRichInline,
} from '../src/rich-inline.ts'
import { TEXTS } from '../src/test-data.ts'
import {
  clearNavigationReport,
  publishNavigationPhase,
  publishNavigationReport as publishHashReport,
} from './report-utils.ts'
import arRisalatAlGhufranPart1 from '../corpora/ar-risalat-al-ghufran-part-1.txt' with { type: 'text' }
import hiEidgah from '../corpora/hi-eidgah.txt' with { type: 'text' }
import jaKumoNoIto from '../corpora/ja-kumo-no-ito.txt' with { type: 'text' }
import jaRashomon from '../corpora/ja-rashomon.txt' with { type: 'text' }
import kmPrachumReuangPrengKhmerVolume7Stories1To10 from '../corpora/km-prachum-reuang-preng-khmer-volume-7-stories-1-10.txt' with { type: 'text' }
import myBadDeedsReturnToYouTeacher from '../corpora/my-bad-deeds-return-to-you-teacher.txt' with { type: 'text' }
import myCunningHeronTeacher from '../corpora/my-cunning-heron-teacher.txt' with { type: 'text' }
import koSonagi from '../corpora/ko-sonagi.txt' with { type: 'text' }
import koUnsuJohEunNal from '../corpora/ko-unsu-joh-eun-nal.txt' with { type: 'text' }
import thNithanVetalStory1 from '../corpora/th-nithan-vetal-story-1.txt' with { type: 'text' }
import urChughd from '../corpora/ur-chughd.txt' with { type: 'text' }
import zhGuxiang from '../corpora/zh-guxiang.txt' with { type: 'text' }
import zhZhufu from '../corpora/zh-zhufu.txt' with { type: 'text' }

const COUNT = 500
const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const MONO_FONT_FAMILY = '"SF Mono", ui-monospace, Menlo, Monaco, monospace'
const FONT_SIZE = 16
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.2)
const WIDTH_BEFORE = 400
const WIDTH_AFTER = 300
const WARMUP = 2
const RUNS = 10
const PREPARE_SAMPLE_REPEATS = 1
const LAYOUT_SAMPLE_REPEATS = 200
const LAYOUT_SAMPLE_WIDTHS = [200, 250, 300, 350, 400] as const
const DOM_BATCH_SAMPLE_REPEATS = 1
const DOM_INTERLEAVED_SAMPLE_REPEATS = 1
const RICH_COUNT = 60
const RICH_LAYOUT_SAMPLE_REPEATS = 40
const RICH_LAYOUT_SAMPLE_WIDTHS = [180, 220, 260] as const
const RICH_INLINE_COUNT = 36
const RICH_INLINE_SAMPLE_REPEATS = 40
const RICH_INLINE_SAMPLE_WIDTHS = [180, 220, 260] as const
const RICH_PRE_WRAP_COUNT = 12
const RICH_PRE_WRAP_LINE_COUNT = 320
const RICH_PRE_WRAP_SAMPLE_REPEATS = 20
const RICH_PRE_WRAP_SAMPLE_WIDTHS = [220, 260, 320] as const
const RICH_LONG_REPEAT = 8
const RICH_LONG_SAMPLE_WIDTHS = [240, 300, 360] as const
const CORPUS_LAYOUT_SAMPLE_REPEATS = 200
const CORPUS_WARMUP = 1
const CORPUS_RUNS = 7
const RICH_INLINE_CODE_FONT = `600 12px ${MONO_FONT_FAMILY}`
const RICH_INLINE_CHIP_FONT = `700 11px ${FONT_FAMILY}`
const RICH_INLINE_EMPHASIS_FONT = `italic ${FONT_SIZE}px ${FONT_FAMILY}`
const RICH_INLINE_CODE_EXTRA_WIDTH = 12
const RICH_INLINE_CHIP_EXTRA_WIDTH = 14

type BenchmarkResult = { label: string, ms: number, desc: string }
type CorpusBenchmarkResult = {
  id: string
  label: string
  font: string
  chars: number
  analysisSegments: number
  segments: number
  breakableSegments: number
  width: number
  lineCount: number
  analysisMs: number
  measureMs: number
  prepareMs: number
  layoutMs: number
}

type BenchmarkReport = {
  status: 'ready' | 'error'
  requestId?: string
  results?: BenchmarkResult[]
  richResults?: BenchmarkResult[]
  richInlineResults?: BenchmarkResult[]
  richPreWrapResults?: BenchmarkResult[]
  richLongResults?: BenchmarkResult[]
  corpusResults?: CorpusBenchmarkResult[]
  message?: string
}

type PrepareProfile = {
  analysisMs: number
  measureMs: number
  totalMs: number
  analysisSegments: number
}

const params = new URLSearchParams(location.search)
const reportMode = params.get('report') === '1'
const requestId = params.get('requestId') ?? undefined

const CORPORA = [
  {
    id: 'ja-kumo-no-ito',
    label: 'Japanese prose (story 2)',
    text: jaKumoNoIto,
    font: '20px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'ja-rashomon',
    label: 'Japanese prose',
    text: jaRashomon,
    font: '20px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'ko-unsu-joh-eun-nal',
    label: 'Korean prose',
    text: koUnsuJohEunNal,
    font: '18px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", sans-serif',
    lineHeight: 30,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'ko-sonagi',
    label: 'Korean prose (story 2)',
    text: koSonagi,
    font: '18px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", sans-serif',
    lineHeight: 30,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'zh-zhufu',
    label: 'Chinese prose',
    text: zhZhufu,
    font: '20px "Songti SC", "PingFang SC", "Noto Serif CJK SC", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'zh-guxiang',
    label: 'Chinese prose (story 2)',
    text: zhGuxiang,
    font: '20px "Songti SC", "PingFang SC", "Noto Serif CJK SC", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'th-nithan-vetal-story-1',
    label: 'Thai prose',
    text: thNithanVetalStory1,
    font: '20px "Thonburi", "Noto Sans Thai", sans-serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'my-cunning-heron-teacher',
    label: 'Myanmar prose',
    text: myCunningHeronTeacher,
    font: '20px "Myanmar MN", "Myanmar Sangam MN", "Noto Sans Myanmar", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'my-bad-deeds-return-to-you-teacher',
    label: 'Myanmar prose (story 2)',
    text: myBadDeedsReturnToYouTeacher,
    font: '20px "Myanmar MN", "Myanmar Sangam MN", "Noto Sans Myanmar", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'ur-chughd',
    label: 'Urdu prose',
    text: urChughd,
    font: '20px "Noto Nastaliq Urdu", "DecoType Nastaleeq Urdu UI", "Geeza Pro", serif',
    lineHeight: 38,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'km-prachum-reuang-preng-khmer-volume-7-stories-1-10',
    label: 'Khmer prose',
    text: kmPrachumReuangPrengKhmerVolume7Stories1To10,
    font: '20px "Khmer Sangam MN", "Khmer MN", "Noto Sans Khmer", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'hi-eidgah',
    label: 'Hindi prose',
    text: hiEidgah,
    font: '20px "Kohinoor Devanagari", "Noto Serif Devanagari", serif',
    lineHeight: 32,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
  {
    id: 'synthetic-long-breakable-runs',
    label: 'Long breakable runs (synthetic)',
    text: buildLongBreakableStressText(220),
    font: FONT,
    lineHeight: LINE_HEIGHT,
    width: 300,
    sampleWidths: [220, 300, 380] as const,
  },
  {
    id: 'ar-risalat-al-ghufran-part-1',
    label: 'Arabic prose',
    text: arRisalatAlGhufranPart1,
    font: '20px "Geeza Pro", "Noto Naskh Arabic", "Arial", serif',
    lineHeight: 34,
    width: 300,
    sampleWidths: [240, 300, 360] as const,
  },
] as const

// Filter edge cases — not realistic comments
const commentTexts = TEXTS.filter(t => t.text.trim().length > 1)
const texts: string[] = []
for (let i = 0; i < COUNT; i++) {
  texts.push(commentTexts[i % commentTexts.length]!.text)
}

function buildLongBreakableStressText(repeatCount: number): string {
  const parts: string[] = []
  for (let i = 0; i < repeatCount; i++) {
    const startHour = String(i % 24).padStart(2, '0')
    const endHour = String((i + 5) % 24).padStart(2, '0')
    const minute = String((i * 7) % 60).padStart(2, '0')
    const second = String((i * 11) % 60).padStart(2, '0')
    parts.push(
      `https://bench.example.com/releases/2026/04/${i}/artifact-alpha-beta-gamma-delta-epsilon-${i.toString(36)}?build=${1200 + i}&cursor=sha${(0xabcde + i).toString(16)}&channel=stable`,
      `cacheKey_v${i}_AlphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXiOmicronPiRhoSigmaTauUpsilonPhiChiPsiOmega`,
      `metrics\u00A0pipeline\u00A0phase\u00A0${i % 17}\u00A0snapshot\u00A0${(i * 13) % 97}`,
      `window:${startHour}:${minute}-${endHour}:${second}`,
      `module::worker::queue::flush::retry::recover::ship::${i}`,
    )
  }
  return parts.join(' ')
}

function buildRichInlineStressItems(text: string): RichInlineItem[] {
  const tokens = text.match(/\S+|\s+/g) ?? [text]
  const items: RichInlineItem[] = []
  let styledTokenIndex = 0

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (/^\s+$/.test(token)) {
      items.push({
        font: FONT,
        text: token,
      })
      continue
    }

    const styleIndex = styledTokenIndex % 9
    styledTokenIndex++

    if (styleIndex === 2 && token.length <= 18) {
      items.push({
        break: 'never',
        extraWidth: RICH_INLINE_CODE_EXTRA_WIDTH,
        font: RICH_INLINE_CODE_FONT,
        text: token,
      })
      continue
    }

    if (styleIndex === 5 && token.length <= 12) {
      items.push({
        break: 'never',
        extraWidth: RICH_INLINE_CHIP_EXTRA_WIDTH,
        font: RICH_INLINE_CHIP_FONT,
        text: token,
      })
      continue
    }

    items.push({
      font: styleIndex === 7 ? RICH_INLINE_EMPHASIS_FONT : FONT,
      text: token,
    })
  }

  return items
}

function buildPreWrapChunkStressText(seed: number, lineCount: number): string {
  const lines: string[] = []
  const seedOffset = seed * lineCount

  for (let i = 0; i < lineCount; i++) {
    const n = seedOffset + i
    switch (i % 6) {
      case 0:
        lines.push(`section ${n}\talpha ${n % 11}`)
        break
      case 1:
        lines.push('  ')
        break
      case 2:
        lines.push(`entry ${n}  `)
        break
      case 3:
        lines.push('')
        break
      case 4:
        lines.push(`col\t${n % 97}\t${(n * 3) % 101}`)
        break
      default:
        lines.push(`note ${n} x`)
        break
    }
  }

  return lines.join('\n')
}

declare global {
  interface Window {
    __BENCHMARK_REPORT__?: BenchmarkReport
  }
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function bench(
  fn: (repeatIndex: number) => void,
  sampleRepeats = 1,
  warmup = WARMUP,
  runs = RUNS,
): number {
  function runRepeated(): void {
    for (let r = 0; r < sampleRepeats; r++) {
      fn(r)
    }
  }

  for (let i = 0; i < warmup; i++) runRepeated()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    runRepeated()
    times.push((performance.now() - t0) / sampleRepeats)
  }
  return median(times)
}

// Yield to let the browser paint status updates
function nextFrame(): Promise<void> {
  return new Promise(resolve => { requestAnimationFrame(() => { resolve() }) })
}

function withRequestId<T extends BenchmarkReport>(report: T): BenchmarkReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function publishNavigationReport(report: BenchmarkReport): void {
  if (!reportMode) return
  publishHashReport(report)
}

function setReport(report: BenchmarkReport): void {
  window.__BENCHMARK_REPORT__ = report
  publishNavigationReport(report)
}

// Keep this local to `/benchmark` so `layout.ts` does not grow a second public
// prepare API just to expose timing splits for one internal page.
function profilePrepareForBenchmark(text: string, font: string): PrepareProfile {
  const t0 = performance.now()
  const analysis = analyzeText(text, getEngineProfile())
  const t1 = performance.now()

  const totalStart = performance.now()
  prepare(text, font)
  const totalEnd = performance.now()

  const totalMs = totalEnd - totalStart
  const analysisMs = t1 - t0

  return {
    analysisMs,
    measureMs: Math.max(0, totalMs - analysisMs),
    totalMs,
    analysisSegments: analysis.len,
  }
}

function buildCorpusBenchmarks(): CorpusBenchmarkResult[] {
  const corpusResults: CorpusBenchmarkResult[] = []
  let corpusLayoutSink = 0

  for (const corpus of CORPORA) {
    const analysisSamples: number[] = []
    const measureSamples: number[] = []
    const prepareSamples: number[] = []

    for (let i = 0; i < CORPUS_WARMUP + CORPUS_RUNS; i++) {
      clearCache()
      const profile = profilePrepareForBenchmark(corpus.text, corpus.font)
      if (i >= CORPUS_WARMUP) {
        analysisSamples.push(profile.analysisMs)
        measureSamples.push(profile.measureMs)
        prepareSamples.push(profile.totalMs)
      }
    }

    const analysisMs = median(analysisSamples)
    const measureMs = median(measureSamples)
    const prepareMs = median(prepareSamples)

    clearCache()
    const metadataProfile = profilePrepareForBenchmark(corpus.text, corpus.font)
    clearCache()
    const prepared = prepareWithSegments(corpus.text, corpus.font)
    const lineCount = layout(prepared, corpus.width, corpus.lineHeight).lineCount

    const layoutMs = bench(repeatIndex => {
      const width = corpus.sampleWidths[repeatIndex % corpus.sampleWidths.length]!
      const result = layout(prepared, width, corpus.lineHeight)
      corpusLayoutSink += result.height + result.lineCount + repeatIndex
    }, CORPUS_LAYOUT_SAMPLE_REPEATS, CORPUS_WARMUP, CORPUS_RUNS)

    corpusResults.push({
      id: corpus.id,
      label: corpus.label,
      font: corpus.font,
      chars: corpus.text.length,
      analysisSegments: metadataProfile.analysisSegments,
      segments: prepared.widths.length,
      breakableSegments: prepared.breakableFitAdvances.filter(widths => widths !== null).length,
      width: corpus.width,
      lineCount,
      analysisMs,
      measureMs,
      prepareMs,
      layoutMs,
    })
  }

  document.body.dataset['corpusLayoutSink'] = String(corpusLayoutSink)
  return corpusResults
}

function buildRichBenchmarks(
  prepared: PreparedTextWithSegments[],
  widths: readonly number[],
  lineHeight: number,
  labelPrefix: string,
  descSuffix: string,
  sampleRepeats = RICH_LAYOUT_SAMPLE_REPEATS,
): BenchmarkResult[] {
  let richSink = 0

  const measureLineStatsMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      const result = measureLineStats(prepared[i]!, width)
      sum += result.lineCount + result.maxLineWidth
    }
    richSink += sum + repeatIndex
  }, sampleRepeats)

  const layoutWithLinesMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      const result = layoutWithLines(prepared[i]!, width, lineHeight)
      sum += result.lineCount + result.height + result.lines.length
    }
    richSink += sum + repeatIndex
  }, sampleRepeats)

  const walkLineRangesMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      sum += walkLineRanges(prepared[i]!, width, line => {
        sum += line.width + line.end.segmentIndex - line.start.segmentIndex
      })
    }
    richSink += sum + repeatIndex
  }, sampleRepeats)

  const layoutNextLineMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      let cursor = { segmentIndex: 0, graphemeIndex: 0 }
      while (true) {
        const line = layoutNextLine(prepared[i]!, cursor, width)
        if (line === null) break
        sum += line.width + line.text.length + line.end.segmentIndex - line.start.segmentIndex
        cursor = line.end
      }
    }
    richSink += sum + repeatIndex
  }, sampleRepeats)

  document.body.dataset[`${labelPrefix}RichSink`] = String(richSink)

  return [
    {
      label: 'Our library: measureLineStats()',
      ms: measureLineStatsMs,
      desc: `${descSuffix}; stats only`,
    },
    {
      label: 'Our library: layoutWithLines()',
      ms: layoutWithLinesMs,
      desc: `${descSuffix}; materializes text lines`,
    },
    {
      label: 'Our library: walkLineRanges()',
      ms: walkLineRangesMs,
      desc: `${descSuffix}; line ranges only, no line text strings`,
    },
    {
      label: 'Our library: layoutNextLine()',
      ms: layoutNextLineMs,
      desc: `${descSuffix}; streaming line-by-line layout`,
    },
  ]
}

function buildRichInlineBenchmarks(
  prepared: PreparedRichInline[],
  widths: readonly number[],
  descSuffix: string,
  sampleRepeats = RICH_INLINE_SAMPLE_REPEATS,
): BenchmarkResult[] {
  let richInlineSink = 0

  const measureRichInlineStatsMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      const result = measureRichInlineStats(prepared[i]!, width)
      sum += result.lineCount + result.maxLineWidth
    }
    richInlineSink += sum + repeatIndex
  }, sampleRepeats)

  const walkRichInlineLineRangesMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      sum += walkRichInlineLineRanges(prepared[i]!, width, line => {
        sum += line.width + line.fragments.length + line.end.itemIndex
      })
    }
    richInlineSink += sum + repeatIndex
  }, sampleRepeats)

  const materializeRichInlineLineRangeMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      sum += walkRichInlineLineRanges(prepared[i]!, width, range => {
        const line = materializeRichInlineLineRange(prepared[i]!, range)
        sum += line.width + line.fragments.length + line.end.itemIndex
        for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex++) {
          const fragment = line.fragments[fragmentIndex]!
          sum += fragment.text.length + fragment.itemIndex
        }
      })
    }
    richInlineSink += sum + repeatIndex
  }, sampleRepeats)

  const layoutNextRichInlineLineRangeMs = bench(repeatIndex => {
    const width = widths[repeatIndex % widths.length]!
    let sum = 0
    for (let i = 0; i < prepared.length; i++) {
      let cursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }
      while (true) {
        const range = layoutNextRichInlineLineRange(prepared[i]!, width, cursor)
        if (range === null) break
        const line = materializeRichInlineLineRange(prepared[i]!, range)
        sum += line.width + line.fragments.length + line.end.itemIndex
        for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex++) {
          const fragment = line.fragments[fragmentIndex]!
          sum += fragment.text.length + fragment.itemIndex
        }
        cursor = line.end
      }
    }
    richInlineSink += sum + repeatIndex
  }, sampleRepeats)

  document.body.dataset['richInlineSink'] = String(richInlineSink)

  return [
    {
      label: 'Our library: measureRichInlineStats()',
      ms: measureRichInlineStatsMs,
      desc: `${descSuffix}; stats only`,
    },
    {
      label: 'Our library: walkRichInlineLineRanges()',
      ms: walkRichInlineLineRangesMs,
      desc: `${descSuffix}; per-line ranges with fragment ownership, no text strings`,
    },
    {
      label: 'Our library: materializeRichInlineLineRange()',
      ms: materializeRichInlineLineRangeMs,
      desc: `${descSuffix}; range walker plus per-line materialization`,
    },
    {
      label: 'Our library: layoutNextRichInlineLineRange() + materializeRichInlineLineRange()',
      ms: layoutNextRichInlineLineRangeMs,
      desc: `${descSuffix}; streaming range walk plus per-line materialization`,
    },
  ]
}

function renderBenchmarkTable(results: BenchmarkResult[], treatFirstAsSetup: boolean): string {
  const comparable = treatFirstAsSetup ? results.filter(r => r.label !== results[0]?.label) : results
  const fastest = Math.min(...comparable.map(r => r.ms))
  let html = '<table><tr><th>Approach</th><th>Median (ms)</th><th>Relative</th><th>Description</th></tr>'
  const fastestComparable = fastest || 0.01
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    const isSetup = treatFirstAsSetup && i === 0
    const rel = isSetup ? 0 : result.ms / fastestComparable
    const cls = isSetup ? 'mid' : rel < 1.5 ? 'fast' : rel < 10 ? 'mid' : 'slow'
    const relText = isSetup ? 'one-time' : rel < 1.01 ? 'fastest' : `${rel.toFixed(1)}×`
    html += `<tr class="${cls}">
      <td>${result.label}</td>
      <td>${result.ms < 0.01 ? '<0.01' : result.ms.toFixed(2)}</td>
      <td>${relText}</td>
      <td>${result.desc}</td>
    </tr>`
  }
  html += '</table>'
  return html
}

async function run() {
  const root = document.getElementById('root')!
  window.__BENCHMARK_REPORT__ = withRequestId({ status: 'error', message: 'Pending benchmark run' })
  clearNavigationReport()
  publishNavigationPhase('loading', requestId)

  let topLayoutSink = 0
  let scalingLayoutSink = 0
  let domBatchSink = 0
  let domInterleavedSink = 0

  // Create visible DOM container
  const container = document.createElement('div')
  container.style.cssText = 'position:relative;overflow:hidden;height:1px'
  document.body.appendChild(container)

  const divs: HTMLDivElement[] = []
  for (let i = 0; i < COUNT; i++) {
    const div = document.createElement('div')
    div.style.font = FONT
    div.style.lineHeight = `${LINE_HEIGHT}px`
    div.style.width = `${WIDTH_BEFORE}px`
    div.style.position = 'relative'
    div.style.wordWrap = 'break-word'
    div.style.overflowWrap = 'break-word'
    div.textContent = texts[i]!
    container.appendChild(div)
    divs.push(div)
  }
  divs[0]!.getBoundingClientRect() // force initial layout

  // Pre-prepare for layout benchmark
  const prepared: PreparedText[] = []
  for (let i = 0; i < COUNT; i++) {
    prepared.push(prepare(texts[i]!, FONT))
  }

  const results: BenchmarkResult[] = []
  const richTexts = texts.slice(0, RICH_COUNT)
  const richPreWrapTexts = Array.from(
    { length: RICH_PRE_WRAP_COUNT },
    (_, index) => buildPreWrapChunkStressText(index, RICH_PRE_WRAP_LINE_COUNT),
  )
  publishNavigationPhase('measuring', requestId)

  // --- 1. prepare() ---
  root.innerHTML = '<p>Benchmarking prepare()...</p>'
  await nextFrame()
  const tPrepare = bench(() => {
    clearCache()
    for (let i = 0; i < COUNT; i++) {
      prepare(texts[i]!, FONT)
    }
  }, PREPARE_SAMPLE_REPEATS)
  results.push({ label: 'Our library: prepare()', ms: tPrepare, desc: `One cold ${COUNT}-text measurement batch` })

  // --- 2. layout() ---
  root.innerHTML = '<p>Benchmarking layout()...</p>'
  await nextFrame()
  const tLayout = bench(repeatIndex => {
    const maxWidth = LAYOUT_SAMPLE_WIDTHS[repeatIndex % LAYOUT_SAMPLE_WIDTHS.length]!
    let sum = 0
    for (let i = 0; i < COUNT; i++) {
      const result = layout(prepared[i]!, maxWidth, LINE_HEIGHT)
      sum += result.height + result.lineCount
    }
    topLayoutSink += sum + repeatIndex
  }, LAYOUT_SAMPLE_REPEATS)
  results.push({ label: 'Our library: layout()', ms: tLayout, desc: `Normalized hot-path throughput per ${COUNT}-text batch` })

  // --- 3. DOM batch ---
  root.innerHTML = '<p>Benchmarking DOM batch...</p>'
  await nextFrame()
  for (const div of divs) div.style.width = `${WIDTH_BEFORE}px`
  divs[0]!.getBoundingClientRect()
  const tBatch = bench(() => {
    let sum = 0
    for (let i = 0; i < COUNT; i++) divs[i]!.style.width = `${WIDTH_AFTER}px`
    for (let i = 0; i < COUNT; i++) sum += divs[i]!.getBoundingClientRect().height
    for (let i = 0; i < COUNT; i++) divs[i]!.style.width = `${WIDTH_BEFORE}px`
    divs[0]!.getBoundingClientRect()
    domBatchSink += sum
  }, DOM_BATCH_SAMPLE_REPEATS)
  results.push({ label: 'DOM batch', ms: tBatch, desc: `Single ${WIDTH_BEFORE}→${WIDTH_AFTER}px batch resize: write all, then read all` })

  // --- 4. DOM interleaved ---
  root.innerHTML = '<p>Benchmarking DOM interleaved...</p>'
  await nextFrame()
  for (const div of divs) div.style.width = `${WIDTH_BEFORE}px`
  divs[0]!.getBoundingClientRect()
  const tInterleaved = bench(() => {
    let sum = 0
    for (let i = 0; i < COUNT; i++) {
      divs[i]!.style.width = `${WIDTH_AFTER}px`
      sum += divs[i]!.getBoundingClientRect().height
    }
    for (let i = 0; i < COUNT; i++) divs[i]!.style.width = `${WIDTH_BEFORE}px`
    divs[0]!.getBoundingClientRect()
    domInterleavedSink += sum
  }, DOM_INTERLEAVED_SAMPLE_REPEATS)
  results.push({ label: 'DOM interleaved', ms: tInterleaved, desc: `Single ${WIDTH_BEFORE}→${WIDTH_AFTER}px batch resize: write + read per div` })

  document.body.removeChild(container)

  // --- Rich shared-corpus batch ---
  root.innerHTML = '<p>Benchmarking rich line APIs...</p>'
  await nextFrame()
  clearCache()
  const richPrepared = richTexts.map(text => prepareWithSegments(text, FONT))
  const richResults = buildRichBenchmarks(
    richPrepared,
    RICH_LAYOUT_SAMPLE_WIDTHS,
    LINE_HEIGHT,
    'shared',
    `${RICH_COUNT}-text shared-corpus batch across widths ${RICH_LAYOUT_SAMPLE_WIDTHS.join('/')}px`,
  )

  // --- Rich-inline rich-text inline flow stress ---
  root.innerHTML = '<p>Benchmarking rich-text inline flow APIs...</p>'
  await nextFrame()
  clearCache()
  const richInlinePrepared = richTexts
    .slice(0, RICH_INLINE_COUNT)
    .map(text => prepareRichInline(buildRichInlineStressItems(text)))
  const richInlineResults = buildRichInlineBenchmarks(
    richInlinePrepared,
    RICH_INLINE_SAMPLE_WIDTHS,
    `${RICH_INLINE_COUNT} rich-text inline flow shared-corpus texts across widths ${RICH_INLINE_SAMPLE_WIDTHS.join('/')}px`,
  )

  // --- Rich pre-wrap chunk stress ---
  root.innerHTML = '<p>Benchmarking pre-wrap rich line APIs...</p>'
  await nextFrame()
  clearCache()
  const richPreWrapPrepared = richPreWrapTexts.map(text =>
    prepareWithSegments(text, FONT, { whiteSpace: 'pre-wrap' }),
  )
  const richPreWrapResults = buildRichBenchmarks(
    richPreWrapPrepared,
    RICH_PRE_WRAP_SAMPLE_WIDTHS,
    LINE_HEIGHT,
    'preWrap',
    `${RICH_PRE_WRAP_COUNT} generated pre-wrap texts with ${RICH_PRE_WRAP_LINE_COUNT} hard-break chunks across widths ${RICH_PRE_WRAP_SAMPLE_WIDTHS.join('/')}px`,
    RICH_PRE_WRAP_SAMPLE_REPEATS,
  )

  // --- Rich long-form stress ---
  root.innerHTML = '<p>Benchmarking long-form rich line APIs...</p>'
  await nextFrame()
  clearCache()
  const richLongPrepared = Array.from({ length: RICH_LONG_REPEAT }, () =>
    prepareWithSegments(
      arRisalatAlGhufranPart1,
      '20px "Geeza Pro", "Noto Naskh Arabic", "Arial", serif',
    ),
  )
  const richLongResults = buildRichBenchmarks(
    richLongPrepared,
    RICH_LONG_SAMPLE_WIDTHS,
    34,
    'long',
    `${RICH_LONG_REPEAT} Arabic long-form texts across widths ${RICH_LONG_SAMPLE_WIDTHS.join('/')}px`,
  )

  // --- Long-form corpus stress ---
  root.innerHTML = '<p>Benchmarking long-form corpora...</p>'
  await nextFrame()
  const corpusResults = buildCorpusBenchmarks()

  // --- Render ---
  // Relative speed only for resize approaches (layout vs DOM). prepare() is
  // a one-time setup cost — not comparable to per-resize measurements.
  const layoutMs = tLayout || 0.01 // guard against 0 from low-res timers (Firefox/Safari)
  let html = `
    <div class="summary">
      <span class="big">${tLayout < 0.01 ? '<0.01' : tLayout.toFixed(2)}ms</span> layout / ${COUNT}-text batch
      <span class="sep">|</span>
      ${(tInterleaved / layoutMs).toFixed(0)}× faster than DOM interleaved
      <span class="sep">|</span>
      ${(tBatch / layoutMs).toFixed(0)}× faster than DOM batch
    </div>
  `
  html += renderBenchmarkTable(results, true)
  html += `<p class="note">${COUNT} logical texts per batch, repeated from the shared corpus. ${WARMUP} warmup + ${RUNS} measured runs. Table values are median ms per ${COUNT}-text batch. Layout repeats ${LAYOUT_SAMPLE_REPEATS}× internally and cycles widths ${LAYOUT_SAMPLE_WIDTHS.join('/')}px to stabilize sub-millisecond timings; DOM paths measure one real ${WIDTH_BEFORE}→${WIDTH_AFTER}px resize batch. ${FONT}. Visible containers, position:relative.</p>`

  root.innerHTML = html
  root.innerHTML += `
    <h2 style="color:#4fc3f7;font-family:monospace;font-size:16px;margin:24px 0 8px">Rich line APIs (shared corpus)</h2>
    ${renderBenchmarkTable(richResults, false)}
    <p class="note">${RICH_COUNT} shared-corpus texts prepared with segments. Median ms per batch across widths ${RICH_LAYOUT_SAMPLE_WIDTHS.join('/')}px. This tracks the richer APIs used by shrinkwrap, custom layout, and manual reflow.</p>
  `
  root.innerHTML += `
    <h2 style="color:#4fc3f7;font-family:monospace;font-size:16px;margin:24px 0 8px">Rich-text inline flow APIs (shared corpus)</h2>
    ${renderBenchmarkTable(richInlineResults, false)}
    <p class="note">${RICH_INLINE_COUNT} shared-corpus texts split into deterministic rich-text inline items with collapsible boundary whitespace, atomic mono/code pills, and badge-like chips. Median ms per batch across widths ${RICH_INLINE_SAMPLE_WIDTHS.join('/')}px. This is the benchmark canary for the rich-text inline flow helper.</p>
  `
  root.innerHTML += `
    <h2 style="color:#4fc3f7;font-family:monospace;font-size:16px;margin:24px 0 8px">Rich line APIs (pre-wrap chunk stress)</h2>
    ${renderBenchmarkTable(richPreWrapResults, false)}
    <p class="note">${RICH_PRE_WRAP_COUNT} generated texts in <code>pre-wrap</code> mode, each with ${RICH_PRE_WRAP_LINE_COUNT} explicit hard-break chunks plus tabs, blank lines, and trailing spaces. This is the chunk-heavy canary for manual line layout.</p>
  `
  root.innerHTML += `
    <h2 style="color:#4fc3f7;font-family:monospace;font-size:16px;margin:24px 0 8px">Rich line APIs (Arabic long-form stress)</h2>
    ${renderBenchmarkTable(richLongResults, false)}
    <p class="note">${RICH_LONG_REPEAT} copies of the Arabic long-form corpus prepared with segments. Median ms per batch across widths ${RICH_LONG_SAMPLE_WIDTHS.join('/')}px. This is the richer-path worst-case canary.</p>
  `

  // --- CJK vs Latin scaling test ---
  const cjkBase = "这是一段中文文本用于测试文本布局库对中日韩字符的支持每个字符之间都可以断行性能测试显示新的文本测量方法比传统方法快了将近一千五百倍"
  const latinBase = "The quick brown fox jumps over the lazy dog and then runs around the park looking for something interesting to do on a sunny afternoon "

  function makeText(base: string, n: number): string {
    let t = ''
    while (t.length < n) t += base
    return t.slice(0, n)
  }

  function med(times: number[]): number {
    const s = [...times].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]!
  }

  const charSizes = [50, 100, 200, 500, 1000]
  const cjkRows: string[] = []

  for (const n of charSizes) {
    const cjk = makeText(cjkBase, n)
    const lat = makeText(latinBase, n)

    // prepare (cold)
    const pTimes = { cjk: [] as number[], lat: [] as number[] }
    for (let r = 0; r < 15; r++) {
      clearCache(); let t0 = performance.now(); prepare(cjk, FONT); pTimes.cjk.push(performance.now() - t0)
      clearCache(); t0 = performance.now(); prepare(lat, FONT); pTimes.lat.push(performance.now() - t0)
    }

    // layout (1000x for resolution)
    clearCache()
    const pc = prepareWithSegments(cjk, FONT)
    const pl = prepareWithSegments(lat, FONT)
    const cSegs = pc.widths.length
    const lSegs = pl.widths.length
    const lTimes = { cjk: [] as number[], lat: [] as number[] }
    for (let r = 0; r < 15; r++) {
      let cjkSink = 0
      let t0 = performance.now()
      for (let j = 0; j < 1000; j++) {
        const result = layout(pc, WIDTH_AFTER, LINE_HEIGHT)
        cjkSink += result.height + result.lineCount
      }
      lTimes.cjk.push((performance.now() - t0) / 1000)

      let latSink = 0
      t0 = performance.now()
      for (let j = 0; j < 1000; j++) {
        const result = layout(pl, WIDTH_AFTER, LINE_HEIGHT)
        latSink += result.height + result.lineCount
      }
      lTimes.lat.push((performance.now() - t0) / 1000)
      scalingLayoutSink += cjkSink + latSink + r
    }

    cjkRows.push(`<tr>
      <td>${n}</td><td>${cSegs}</td><td>${lSegs}</td>
      <td>${med(pTimes.cjk).toFixed(2)}</td><td>${med(pTimes.lat).toFixed(2)}</td>
      <td>${med(lTimes.cjk).toFixed(4)}</td><td>${med(lTimes.lat).toFixed(4)}</td>
    </tr>`)
  }

  root.innerHTML += `
    <h2 style="color:#4fc3f7;font-family:monospace;font-size:16px;margin:24px 0 8px">CJK vs Latin scaling</h2>
    <table>
      <tr><th>Chars</th><th>CJK segs</th><th>Latin segs</th><th>CJK prepare (ms)</th><th>Latin prepare (ms)</th><th>CJK layout/1k (ms)</th><th>Latin layout/1k (ms)</th></tr>
      ${cjkRows.join('')}
    </table>
  `
  root.innerHTML += `
    <h2 style="color:#4fc3f7;font-family:monospace;font-size:16px;margin:24px 0 8px">Long-form corpus stress</h2>
    <table>
      <tr><th>Corpus</th><th>Chars</th><th>Segs</th><th>Analyze (ms)</th><th>Measure (ms)</th><th>Prepare cold (ms)</th><th>Layout hot (ms)</th><th>Lines @ width</th></tr>
      ${corpusResults.map(result => `
        <tr>
          <td>${result.label}</td>
          <td>${result.chars.toLocaleString()}</td>
          <td>${result.segments.toLocaleString()}</td>
          <td>${result.analysisMs.toFixed(2)}</td>
          <td>${result.measureMs.toFixed(2)}</td>
          <td>${result.prepareMs.toFixed(2)}</td>
          <td>${result.layoutMs < 0.01 ? '<0.01' : result.layoutMs.toFixed(2)}</td>
          <td>${result.lineCount} @ ${result.width}px</td>
        </tr>
      `).join('')}
    </table>
    <p class="note">Long-form rows split cold prepare into text analysis and measurement phases for one full corpus text, then report one hot layout pass over the prepared result. They are intended to catch script-specific prepare regressions and long-breakable-run measurement costs that the short shared corpus can hide.</p>
  `
  root.dataset['topLayoutSink'] = String(topLayoutSink)
  root.dataset['scalingLayoutSink'] = String(scalingLayoutSink)
  root.dataset['domBatchSink'] = String(domBatchSink)
  root.dataset['domInterleavedSink'] = String(domInterleavedSink)
  console.log('benchmark sinks', { topLayoutSink, scalingLayoutSink, domBatchSink, domInterleavedSink })

  setReport(withRequestId({
    status: 'ready',
    results,
    richResults,
    richInlineResults,
    richPreWrapResults,
    richLongResults,
    corpusResults,
  }))
}

run().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  const root = document.getElementById('root')!
  root.innerHTML = `<p>${message}</p>`
  setReport(withRequestId({ status: 'error', message }))
})
