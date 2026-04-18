import { type ChildProcess } from 'node:child_process'
import {
  acquireBrowserAutomationLock,
  createBrowserSession,
  ensurePageServer,
  getAvailablePort,
  loadHashReport,
  type AutomationBrowserKind,
  type BrowserKind,
} from './browser-automation.ts'

type ProbeReport = {
  status: 'ready' | 'error'
  requestId?: string
  browserLineMethod?: 'range' | 'span'
  width?: number
  predictedHeight?: number
  actualHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  firstBreakMismatch?: {
    line: number
    deltaText: string
    reasonGuess: string
    oursText: string
    browserText: string
  } | null
  extractorSensitivity?: string | null
  message?: string
}

type OracleCase = {
  label: string
  text: string
  width: number
  font: string
  lineHeight: number
  lang: string
  dir?: 'ltr' | 'rtl'
  whiteSpace?: 'normal' | 'pre-wrap'
  wordBreak?: 'normal' | 'keep-all'
}

const ORACLE_CASES: OracleCase[] = [
  // B: Edge cases — normal mode
  {
    label: 'B1: Hangul Jamo standalone (U+1100)',
    text: 'ᄀᄂᄃ 테스트 ᄀᄂᄃ 테스트 ᄀᄂᄃ',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2: Hangul Compatibility Jamo (U+3130)',
    text: 'ㄱㄴㄷ 호환 자모 ㄱㄴㄷ 호환 자모 ㄱㄴㄷ',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B3: Korean+English mixed',
    text: '안녕 Hello 세계 안녕 Hello 세계',
    width: 200,
    font: '20px "Apple SD Gothic Neo"',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B4: Korean+numbers mixed',
    text: '가격은 10,000원 입니다 배송은 3,500원 입니다',
    width: 200,
    font: '20px "Apple SD Gothic Neo"',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B5: Korean+CJK punctuation',
    text: '안녕하세요。잘 부탁합니다。감사합니다。',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B6: NBSP + Korean',
    text: '서울\u00A0시청역 부산\u00A0역',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  // B2-width-variants: same texts at different widths to confirm bug is width-sensitive
  {
    label: 'B2c-w160: ㅠㅠ crying expression (160px)',
    text: 'ㅠㅠ 너무 슬퍼요 ㅠㅠ 정말로',
    width: 160,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2c-w140: ㅠㅠ crying expression (140px)',
    text: 'ㅠㅠ 너무 슬퍼요 ㅠㅠ 정말로',
    width: 140,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2d-w150: ㄹㅇ literally slang (150px)',
    text: '이거 ㄹㅇ임 ㄹㅇ 아니면 뭐야',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2f-w150: ㅇㅋ/ㄴㄴ okay/nope slang (150px)',
    text: 'ㅇㅋ 알겠어요 ㄴㄴ 그건 아니고',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  // B2-variants: Hangul Compatibility Jamo edge cases (the confirmed bug)
  {
    label: 'B2b: ㅋㅋ laughter slang mixed',
    text: 'ㅋㅋㅋ 진짜 웃기다 ㅋㅋㅋ 진짜로',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2c: ㅠㅠ crying expression',
    text: 'ㅠㅠ 너무 슬퍼요 ㅠㅠ 정말로',
    width: 200,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2d: ㄹㅇ literally slang mid-sentence',
    text: '이거 ㄹㅇ임 ㄹㅇ 아니면 뭐야',
    width: 180,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2e: consonants-only run',
    text: 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  {
    label: 'B2f: ㅇㅋ/ㄴㄴ okay/nope internet slang',
    text: 'ㅇㅋ 알겠어요 ㄴㄴ 그건 아니고',
    width: 180,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
  },
  // C: Layout modes
  {
    label: 'C1: keep-all + narrow width',
    text: '한국어 테스트 입니다',
    width: 80,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    wordBreak: 'keep-all',
  },
  {
    label: 'C2: keep-all + Korean+English mixed',
    text: '한국어 Korean 혼합 테스트',
    width: 150,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    wordBreak: 'keep-all',
  },
  {
    label: 'C3: pre-wrap + Korean hard break',
    text: '가나다\n라마바',
    width: 300,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    whiteSpace: 'pre-wrap',
  },
  {
    label: 'C4: pre-wrap + tab + Korean',
    text: '가나\t다라',
    width: 300,
    font: '20px serif',
    lineHeight: 34,
    lang: 'ko',
    whiteSpace: 'pre-wrap',
  },

  // F: Chat/messenger patterns
  { label: 'F1: jamo-only long run', text: 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', width: 120, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'F2: jamo+syllable mixed', text: 'ㅎㅎ네ㅋㅋ진짜ㅋㅋㅋ', width: 150, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'F3: syllable then jamo+question', text: '오늘 뭐해?ㅋㅋ', width: 120, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'F4: Korean+emoji no space', text: '안녕😊잘지내?', width: 150, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'F5: jamo abbreviations + spaces', text: 'ㄴㄴ ㅇㅇ ㄱㄱ', width: 100, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'F6: jamo-syllable-jamo transitions', text: 'ㅋㅋㅋㅋㅋ재밌다ㅋㅋㅋ아진짜', width: 130, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'F7: syllable+jamo+tilde', text: '네네ㅎㅎ 감사합니다~', width: 150, font: '20px serif', lineHeight: 34, lang: 'ko' },

  // G: SNS/URL patterns
  { label: 'G1: hashtag + Korean', text: '#한글태그 다음텍스트', width: 150, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'G2: URL sandwiched in Korean', text: '자세한건https://example.com/path?q=검색 참고', width: 200, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'G3: number+Korean no space', text: '가격은10,000원입니다', width: 150, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'G4: parenthesized English in Korean', text: '서울(Seoul)과 부산(Busan)', width: 180, font: '20px serif', lineHeight: 34, lang: 'ko' },

  // H: Unicode boundary cases
  { label: 'H1: Hangul Jamo U+1100 standalone', text: 'ᄀᄂᄃᄅᄆᄇ', width: 120, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'H2: ZWSP between Korean', text: '한\u200B글\u200B테\u200B스\u200B트', width: 100, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'H3: NBSP between Korean', text: '한\u00A0글\u00A0테스트', width: 100, font: '20px serif', lineHeight: 34, lang: 'ko' },
  { label: 'H4: smart quotes + Korean', text: '\u201C한글 인용문\u201D과 텍스트', width: 150, font: '20px serif', lineHeight: 34, lang: 'ko' },

  // I: keep-all extended
  { label: 'I1: keep-all long sentence', text: '대한민국은 민주공화국이다 모든 권력은 국민으로부터 나온다', width: 150, font: '20px serif', lineHeight: 34, lang: 'ko', wordBreak: 'keep-all' },
  { label: 'I2: keep-all Korean+English', text: 'React와 Vue는 프론트엔드 프레임워크입니다', width: 160, font: '20px serif', lineHeight: 34, lang: 'ko', wordBreak: 'keep-all' },
  { label: 'I3: keep-all pure syllables no words', text: '가나다라마바사아자차카타파하', width: 80, font: '20px serif', lineHeight: 34, lang: 'ko', wordBreak: 'keep-all' },
]

function parseStringFlag(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find(value => value.startsWith(prefix))
  return arg === undefined ? null : arg.slice(prefix.length)
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseStringFlag(name)
  if (raw === null) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid value for --${name}: ${raw}`)
  return parsed
}

function parseBrowsers(value: string | null): AutomationBrowserKind[] {
  const raw = (value ?? 'chrome,safari').trim()
  if (raw.length === 0) return ['chrome', 'safari']

  const browsers = raw
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)

  for (const browser of browsers) {
    if (browser !== 'chrome' && browser !== 'safari' && browser !== 'firefox') {
      throw new Error(`Unsupported browser ${browser}`)
    }
  }

  return browsers as AutomationBrowserKind[]
}

function buildProbeUrl(baseUrl: string, requestId: string, testCase: OracleCase): string {
  const dir = testCase.dir ?? 'ltr'
  const whiteSpace = testCase.whiteSpace ?? 'normal'
  const wordBreak = testCase.wordBreak ?? 'normal'
  return (
    `${baseUrl}/probe?text=${encodeURIComponent(testCase.text)}` +
    `&width=${testCase.width}` +
    `&font=${encodeURIComponent(testCase.font)}` +
    `&lineHeight=${testCase.lineHeight}` +
    `&dir=${encodeURIComponent(dir)}` +
    `&lang=${encodeURIComponent(testCase.lang)}` +
    `&whiteSpace=${encodeURIComponent(whiteSpace)}` +
    `&wordBreak=${encodeURIComponent(wordBreak)}` +
    `&method=span` +
    `&requestId=${encodeURIComponent(requestId)}`
  )
}

function reportIsExact(report: ProbeReport): boolean {
  return (
    report.status === 'ready' &&
    report.diffPx === 0 &&
    report.predictedLineCount === report.browserLineCount &&
    report.predictedHeight === report.actualHeight &&
    report.firstBreakMismatch === null
  )
}

function printCaseResult(browser: AutomationBrowserKind, testCase: OracleCase, report: ProbeReport): void {
  if (report.status === 'error') {
    console.log(`  FAIL  ${testCase.label}: error: ${report.message ?? 'unknown error'}`)
    return
  }

  const pass = reportIsExact(report)
  const icon = pass ? '✓ PASS' : '✗ FAIL'
  const lines = `[${report.predictedLineCount} lines]`
  const detail = pass
    ? lines
    : `expected=${report.browserLineCount} got=${report.predictedLineCount}  width=${testCase.width}px font=${testCase.font}`

  console.log(`  ${icon}  ${testCase.label.padEnd(40)} ${detail}`)

  if (!pass && report.firstBreakMismatch != null) {
    console.log(
      `         break L${report.firstBreakMismatch.line}: ${report.firstBreakMismatch.reasonGuess} | ` +
      `ours ${JSON.stringify(report.firstBreakMismatch.oursText)} | ` +
      `browser ${JSON.stringify(report.firstBreakMismatch.browserText)}`,
    )
  }
}

async function runBrowser(browser: AutomationBrowserKind, port: number): Promise<boolean> {
  const lock = await acquireBrowserAutomationLock(browser)
  const reportBrowser: BrowserKind | null = browser === 'firefox' ? null : browser
  const session = reportBrowser === null ? null : createBrowserSession(reportBrowser)
  let serverProcess: ChildProcess | null = null
  let ok = true
  let pass = 0

  try {
    if (session === null || reportBrowser === null) {
      throw new Error('Firefox is not supported for korean oracle checks')
    }

    const pageServer = await ensurePageServer(port, '/probe', process.cwd())
    serverProcess = pageServer.process

    console.log(`\nKorean Layout Check — ${browser.charAt(0).toUpperCase() + browser.slice(1)}`)
    console.log('─'.repeat(60))

    for (const testCase of ORACLE_CASES) {
      const requestId = `${browser}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const url = buildProbeUrl(pageServer.baseUrl, requestId, testCase)
      const report = await loadHashReport<ProbeReport>(session, url, requestId, reportBrowser, timeoutMs)
      printCaseResult(browser, testCase, report)
      if (reportIsExact(report)) {
        pass++
      } else {
        ok = false
      }
    }

    console.log(`\nSummary: ${browser} ${pass}/${ORACLE_CASES.length} pass`)
  } finally {
    session?.close()
    serverProcess?.kill()
    lock.release()
  }

  return ok
}

const requestedPort = parseNumberFlag('port', 0)
const browsers = parseBrowsers(parseStringFlag('browser'))
const timeoutMs = parseNumberFlag('timeout', 60_000)

const port = await getAvailablePort(requestedPort === 0 ? null : requestedPort)
let overallOk = true
for (const browser of browsers) {
  const browserOk = await runBrowser(browser, port)
  if (!browserOk) overallOk = false
}

if (!overallOk) process.exitCode = 1
