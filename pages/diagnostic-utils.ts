import type { PreparedTextWithSegments } from '../src/layout.ts'

export type DiagnosticUnit = {
  text: string
  start: number
  end: number
}

const diagnosticGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function getDiagnosticUnits(prepared: PreparedTextWithSegments): DiagnosticUnit[] {
  const units: DiagnosticUnit[] = []
  let offset = 0

  for (let i = 0; i < prepared.segments.length; i++) {
    const segment = prepared.segments[i]!
    if (prepared.breakableFitAdvances[i] !== null) {
      let localOffset = 0
      for (const grapheme of diagnosticGraphemeSegmenter.segment(segment)) {
        const start = offset + localOffset
        localOffset += grapheme.segment.length
        units.push({ text: grapheme.segment, start, end: offset + localOffset })
      }
    } else {
      units.push({ text: segment, start: offset, end: offset + segment.length })
    }
    offset += segment.length
  }

  return units
}

export function getLineContent(text: string, end: number): { text: string, end: number } {
  const trimmed = text.trimEnd()
  return {
    text: trimmed,
    end: end - (text.length - trimmed.length),
  }
}

export function formatBreakContext(text: string, breakOffset: number, radius = 32): string {
  const start = Math.max(0, breakOffset - radius)
  const end = Math.min(text.length, breakOffset + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, breakOffset)}|${text.slice(breakOffset, end)}${end < text.length ? '…' : ''}`
}

export function measureCanvasTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
): number {
  ctx.font = font
  return ctx.measureText(text).width
}

export function measureDomTextWidth(
  doc: Document,
  text: string,
  font: string,
  direction: string,
): number {
  const span = doc.createElement('span')
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.whiteSpace = 'pre'
  span.style.font = font
  span.style.direction = direction
  span.style.unicodeBidi = 'plaintext'
  span.textContent = text
  doc.body.appendChild(span)
  const width = span.getBoundingClientRect().width
  doc.body.removeChild(span)
  return width
}

// A line as the corpus and probe pages compare them: where its content ends, its
// width measured whole and, when known, the sum of its segment widths.
type MeasuredLine = {
  contentEnd: number
  fullWidth: number
  sumWidth?: number
}

// A guess at why the first mismatched line differs, which corpus-taxonomy sorts.
export function classifyBreakMismatch(contentWidth: number, ours: MeasuredLine | undefined, browser: MeasuredLine | undefined): string {
  if (!ours || !browser) return 'line-count mismatch after an earlier break shift'

  const longer = ours.contentEnd >= browser.contentEnd ? ours : browser
  const longerLabel = longer === ours ? 'ours' : 'browser'
  const overflow = longer.fullWidth - contentWidth
  if (Math.abs(overflow) <= 0.05) {
    return `${longerLabel} keeps text with only ${overflow.toFixed(3)}px overflow`
  }

  const oursDrift = (ours.sumWidth ?? ours.fullWidth) - ours.fullWidth
  if (Math.abs(oursDrift) > 0.05) {
    return `our segment sum drifts from full-string width by ${oursDrift.toFixed(3)}px`
  }

  if (browser.contentEnd > ours.contentEnd && browser.fullWidth <= contentWidth) {
    return 'browser fits the longer line while our break logic cuts earlier'
  }

  return 'different break opportunity around punctuation or shaping context'
}
