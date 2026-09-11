import { createDemoResources, buildDemoFrame } from './demos/justification-comparison.model.ts'
import { FONT, PARAGRAPHS } from './demos/justification-comparison.data.ts'
import { buildNavigationPhaseHash } from '../shared/navigation-state.ts'

const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? undefined
const widths = params.has('full')
  ? Array.from({ length: 401 }, (_, index) => index + 200)
  : [200, 364, 490, 491, 492, 493, 494, 495, 496, 497, 498, 600]

await document.fonts.load(FONT)
await document.fonts.ready
location.hash = buildNavigationPhaseHash('measuring', requestId)
const resources = createDemoResources()
const failures: object[] = []
let testedLines = 0
for (const colWidth of widths) {
  const frame = buildDemoFrame(resources, { colWidth, showIndicators: true })
  for (const name of ['hyphen', 'optimal'] as const) {
    for (const [paragraphIndex, paragraph] of frame[name].paragraphs.entries()) {
      const source = PARAGRAPHS[paragraphIndex]!
      let sourceOffset = 0
      for (const [lineIndex, line] of paragraph.entries()) {
        testedLines++
        // Follow the painter's segment advances, including its chosen spaces.
        let paintedWidth = 0
        let text = ''
        for (const segment of line.segments) {
          paintedWidth += segment.kind === 'space' && line.spacing.kind === 'justified'
            ? line.spacing.width : segment.width
          text += segment.kind === 'space' ? ' ' : segment.text
        }
        if (paintedWidth > line.maxWidth + 0.01) {
          failures.push({ kind: 'overflow', name, colWidth, paragraphIndex, lineIndex, paintedWidth, maxWidth: line.maxWidth, text })
        }
        if (line.trailingMarker === 'soft-hyphen' && line.ending === 'wrap') text = text.slice(0, -1)
        if (source.slice(sourceOffset, sourceOffset + text.length) !== text) {
          failures.push({ kind: 'source', name, colWidth, paragraphIndex, lineIndex, sourceOffset, text })
        }
        sourceOffset += text.length
        // Spaces consumed at a line boundary are absent from painted segments.
        while (source[sourceOffset] === ' ') sourceOffset++
      }
      if (sourceOffset !== source.length) {
        failures.push({ kind: 'incomplete-source', name, colWidth, paragraphIndex, sourceOffset })
      }
    }
  }
}
const report = {
  status: 'ready', requestId, userAgent: navigator.userAgent, dpr: devicePixelRatio,
  testedWidths: widths.length, testedLines, failures,
}
document.getElementById('result')!.textContent = JSON.stringify(report, null, 2)
const endpoint = params.get('reportEndpoint')
if (endpoint !== null) {
  location.hash = buildNavigationPhaseHash('posting', requestId)
  await fetch(endpoint, { method: 'POST', body: JSON.stringify(report) })
}
