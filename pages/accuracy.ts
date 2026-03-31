import {
  clearCache,
  layout,
  layoutWithLines,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from '../src/layout.ts'
import { getDiagnosticUnits } from './diagnostic-utils.ts'
import { clearNavigationReport, publishNavigationPhase, publishNavigationReport } from './report-utils.ts'
import { TEXTS, SIZES, WIDTHS } from '../src/test-data.ts'

const FONTS = [
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Georgia, "Times New Roman", serif',
  'Verdana, Geneva, sans-serif',
  '"Courier New", Courier, monospace',
]

type Mismatch = {
  label: string
  font: string
  fontSize: number
  lineHeight: number
  width: number
  actual: number
  predicted: number
  diff: number
  text: string
  diagnosticLines?: string[]
}

type AccuracyRow = {
  label: string
  font: string
  fontSize: number
  lineHeight: number
  width: number
  actual: number
  predicted: number
  diff: number
}

type AccuracyReport = {
  status: 'ready' | 'error'
  requestId?: string
  environment?: EnvironmentFingerprint
  total?: number
  matchCount?: number
  mismatchCount?: number
  mismatches?: Mismatch[]
  rows?: AccuracyRow[]
  message?: string
}

type AccuracyNavigationReport = {
  status: 'ready' | 'error'
  requestId?: string
  total?: number
  matchCount?: number
  mismatchCount?: number
  message?: string
}

type EnvironmentFingerprint = {
  userAgent: string
  devicePixelRatio: number
  viewport: {
    innerWidth: number
    innerHeight: number
    outerWidth: number
    outerHeight: number
    visualViewportScale: number | null
  }
  screen: {
    width: number
    height: number
    availWidth: number
    availHeight: number
    colorDepth: number
    pixelDepth: number
  }
}

declare global {
  interface Window {
    __ACCURACY_REPORT__?: AccuracyReport
  }
}

const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const includeFullRows = params.get('full') === '1'
const reportEndpoint = params.get('reportEndpoint')

function withRequestId<T extends AccuracyReport>(report: T): AccuracyReport {
  return requestId === undefined ? report : { ...report, requestId }
}

function getEnvironmentFingerprint(): EnvironmentFingerprint {
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      visualViewportScale: window.visualViewport?.scale ?? null,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
    },
  }
}

function publishReport(report: AccuracyReport): void {
  const reportJson = JSON.stringify(report)
  window.__ACCURACY_REPORT__ = report
  if (reportEndpoint !== null) {
    publishNavigationPhase('posting', requestId)
    void (async () => {
      try {
        await fetch(reportEndpoint, {
          method: 'POST',
          body: reportJson,
        })
        publishNavigationReport(toNavigationReport(report))
      } catch {
        // Best-effort side channel for large reports.
      }
    })()
    return
  }
  publishNavigationReport(toNavigationReport(report))
}

function toNavigationReport(report: AccuracyReport): AccuracyNavigationReport {
  if (report.status === 'error') {
    return {
      status: report.status,
      ...(report.requestId === undefined ? {} : { requestId: report.requestId }),
      ...(report.message === undefined ? {} : { message: report.message }),
    }
  }

  return {
    status: report.status,
    ...(report.requestId === undefined ? {} : { requestId: report.requestId }),
    ...(report.total === undefined ? {} : { total: report.total }),
    ...(report.matchCount === undefined ? {} : { matchCount: report.matchCount }),
    ...(report.mismatchCount === undefined ? {} : { mismatchCount: report.mismatchCount }),
  }
}
function getBrowserLines(
  prepared: PreparedTextWithSegments,
  div: HTMLDivElement,
): string[] {
  const textNode = div.firstChild
  if (!(textNode instanceof Text)) return []

  const units = getDiagnosticUnits(prepared)
  const range = document.createRange()
  const browserLines: string[] = []
  let currentLine = ''
  let lastTop: number | null = null

  for (const unit of units) {
    range.setStart(textNode, unit.start)
    range.setEnd(textNode, unit.end)
    const rects = range.getClientRects()
    const rectTop: number | null = rects.length > 0 ? rects[0]!.top : lastTop

    if (rectTop !== null && lastTop !== null && rectTop > lastTop + 0.5) {
      browserLines.push(currentLine)
      currentLine = unit.text
    } else {
      currentLine += unit.text
    }

    if (rectTop !== null) lastTop = rectTop
  }

  if (currentLine) browserLines.push(currentLine)
  return browserLines
}

function runSweep(): { total: number, mismatches: Mismatch[], rows: AccuracyRow[] } {
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden'
  document.body.appendChild(container)

  const mismatches: Mismatch[] = []
  const rows: AccuracyRow[] = []
  let total = 0

  for (const fontFamily of FONTS) {
    for (const fontSize of SIZES) {
      const font = `${fontSize}px ${fontFamily}`
      const lineHeight = Math.round(fontSize * 1.2)
      clearCache()

      for (const maxWidth of WIDTHS) {
        const divs: HTMLDivElement[] = []
        const prepared: PreparedTextWithSegments[] = []

        for (const { text } of TEXTS) {
          const div = document.createElement('div')
          div.style.font = font
          div.style.lineHeight = `${lineHeight}px`
          div.style.width = `${maxWidth}px`
          div.style.wordWrap = 'break-word'
          div.style.overflowWrap = 'break-word'
          div.textContent = text
          container.appendChild(div)
          divs.push(div)
          prepared.push(prepareWithSegments(text, font))
        }

        for (let i = 0; i < TEXTS.length; i++) {
          const { label, text } = TEXTS[i]!
          const actual = divs[i]!.getBoundingClientRect().height
          const predicted = layout(prepared[i]!, maxWidth, lineHeight).height
          rows.push({
            label,
            font: fontFamily,
            fontSize,
            lineHeight,
            width: maxWidth,
            actual,
            predicted,
            diff: predicted - actual,
          })
          total++
          if (Math.abs(actual - predicted) >= 1) {
            const browserLines = getBrowserLines(prepared[i]!, divs[i]!)
            const ourLayout = layoutWithLines(prepared[i]!, maxWidth, lineHeight)

            const lineDetails: string[] = []
            const maxLines = Math.max(browserLines.length, ourLayout.lines.length)
            for (let li = 0; li < maxLines; li++) {
              const ours = (ourLayout.lines[li]?.text ?? '').trimEnd()
              const theirs = (browserLines[li] ?? '').trimEnd()
              if (ours !== theirs) {
                lineDetails.push(`L${li+1} ours="${ours.slice(0,40)}" browser="${theirs.slice(0,40)}"`)
              }
            }
            if (lineDetails.length === 0 && browserLines.length !== ourLayout.lines.length) {
              lineDetails.push(`ours=${ourLayout.lines.length}L browser=${browserLines.length}L (same content, different count?)`)
            }

            mismatches.push({
              label,
              font: fontFamily,
              fontSize,
              lineHeight,
              width: maxWidth,
              actual,
              predicted,
              diff: predicted - actual,
              text,
              diagnosticLines: lineDetails.length > 0 ? lineDetails : ['no per-line canvas/DOM diff found'],
            })
          }
        }
        container.innerHTML = ''
      }
    }
  }

  document.body.removeChild(container)
  return { total, mismatches, rows }
}

// --- Render ---

function render() {
  const root = document.getElementById('root')!
  root.innerHTML = '<p>Running sweep...</p>'
  window.__ACCURACY_REPORT__ = withRequestId({ status: 'error', message: 'Pending sweep' })
  clearNavigationReport()
  publishNavigationPhase('loading', requestId)

  requestAnimationFrame(() => {
    try {
      publishNavigationPhase('measuring', requestId)
      const { total, mismatches, rows } = runSweep()
      const matchCount = total - mismatches.length
      const pct = ((matchCount / total) * 100).toFixed(2)

      let html = `
        <div class="summary">
          <span class="big">${matchCount}/${total}</span> match (${pct}%)
          <span class="sep">|</span>
          ${mismatches.length} mismatches
          <span class="sep">|</span>
          ${FONTS.length} fonts × ${SIZES.length} sizes × ${WIDTHS.length} widths × ${TEXTS.length} texts
        </div>
      `

      // Group mismatches by font
      const byFont = new Map<string, Mismatch[]>()
      for (const m of mismatches) {
        const key = m.font
        let arr = byFont.get(key)
        if (!arr) { arr = []; byFont.set(key, arr) }
        arr.push(m)
      }

      // Group within font by size
      for (const [font, ms] of byFont) {
        html += `<h2>${font}</h2>`

        const bySize = new Map<number, Mismatch[]>()
        for (const m of ms) {
          let arr = bySize.get(m.fontSize)
          if (!arr) { arr = []; bySize.set(m.fontSize, arr) }
          arr.push(m)
        }

        for (const [size, sizeMs] of bySize) {
          html += `<h3>${size}px (${sizeMs.length} mismatches)</h3>`
          html += '<table><colgroup><col class="num"><col class="num"><col class="num"><col class="num"><col class="text"></colgroup><tr><th>Width</th><th>Actual</th><th>Predicted</th><th>Diff</th><th>Text</th></tr>'
          for (const m of sizeMs) {
            const cls = m.diff > 0 ? 'over' : 'under'
            const snippet = m.text
            html += `<tr class="${cls}">
              <td>${m.width}px</td>
              <td>${m.actual}px</td>
              <td>${m.predicted}px</td>
              <td>${m.diff > 0 ? '+' : ''}${m.diff}px</td>
              <td class="text">${escapeHtml(snippet)}</td>
            </tr>`
            if (m.diagnosticLines && m.diagnosticLines.length > 0) {
              html += `<tr class="${cls}"><td colspan="5" class="text" style="color:#888;font-size:11px;padding-left:24px">${escapeHtml(m.diagnosticLines.join(' | '))}</td></tr>`
            }
          }
          html += '</table>'
        }
      }

      if (mismatches.length === 0) {
        html += '<p class="perfect">All tests pass.</p>'
      }

      root.innerHTML = html
      publishReport(withRequestId({
        status: 'ready',
        environment: getEnvironmentFingerprint(),
        total,
        matchCount,
        mismatchCount: mismatches.length,
        mismatches,
        ...(includeFullRows ? { rows } : {}),
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      root.innerHTML = `<p>${escapeHtml(message)}</p>`
      publishReport(withRequestId({ status: 'error', message }))
    }
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

render()
