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
