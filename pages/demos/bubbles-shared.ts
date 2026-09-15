import { layout, prepareWithSegments, walkLineRanges, type PreparedTextWithSegments } from '../../src/layout.ts'

export type WrapMetrics = {
  lineCount: number
  height: number
  maxLineWidth: number
}

export type PreparedBubble = {
  prepared: PreparedTextWithSegments
}

export type BubbleRenderWidths = {
  cssWidth: number
  tightWidth: number
}

export type BubbleRenderState = {
  totalWastedPixels: number
  widths: BubbleRenderWidths[]
}

export type BubblesPageGeometry = {
  isNarrow: boolean
  pageWidth: number
  gridGap: number
  panelPaddingX: number
  minChatWidth: number
  maxChatWidth: number
  chatWidth: number
  bubbleMaxWidth: number
}

declare global {
  // Defined by the classic script after the controls in bubbles.html, so the first paint has the
  // page's geometry and the bubbles' font and padding before this module loads.
  const bubblesPage: {
    defaultChatWidth: number
    bubbleFont: string
    bubbleLineHeight: number
    bubblePaddingX: number
    bubblePaddingY: number
    getGeometry(viewportWidth: number, requestedChatWidth: number): BubblesPageGeometry
    paint(geometry: BubblesPageGeometry): void
  }
}

// The same font and padding the page's classic script paints on the bubbles.
export const FONT = bubblesPage.bubbleFont
export const LINE_HEIGHT = bubblesPage.bubbleLineHeight
export const PADDING_H = bubblesPage.bubblePaddingX
export const PADDING_V = bubblesPage.bubblePaddingY

export function prepareBubbleTexts(texts: string[]): PreparedBubble[] {
  return texts.map(text => ({
    prepared: prepareWithSegments(text, FONT),
  }))
}

export function collectWrapMetrics(prepared: PreparedTextWithSegments, maxWidth: number): WrapMetrics {
  let maxLineWidth = 0
  const lineCount = walkLineRanges(prepared, maxWidth, line => {
    if (line.width > maxLineWidth) maxLineWidth = line.width
  })
  return {
    lineCount,
    height: lineCount * LINE_HEIGHT,
    maxLineWidth,
  }
}

export function findTightWrapMetrics(prepared: PreparedTextWithSegments, maxWidth: number): WrapMetrics {
  const initial = collectWrapMetrics(prepared, maxWidth)
  let lo = 1
  let hi = Math.max(1, Math.ceil(maxWidth))

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const midLineCount = layout(prepared, mid, LINE_HEIGHT).lineCount
    if (midLineCount <= initial.lineCount) {
      hi = mid
    } else {
      lo = mid + 1
    }
  }

  return collectWrapMetrics(prepared, lo)
}

export function computeBubbleRender(preparedBubbles: PreparedBubble[], bubbleMaxWidth: number): BubbleRenderState {
  const contentMaxWidth = bubbleMaxWidth - PADDING_H * 2
  let totalWastedPixels = 0
  const widths: BubbleRenderWidths[] = []

  for (let index = 0; index < preparedBubbles.length; index++) {
    const bubble = preparedBubbles[index]!
    const cssMetrics = collectWrapMetrics(bubble.prepared, contentMaxWidth)
    const tightMetrics = findTightWrapMetrics(bubble.prepared, contentMaxWidth)

    const cssWidth = Math.ceil(cssMetrics.maxLineWidth) + PADDING_H * 2
    const tightWidth = Math.ceil(tightMetrics.maxLineWidth) + PADDING_H * 2
    const cssHeight = cssMetrics.height + PADDING_V * 2
    totalWastedPixels += Math.max(0, cssWidth - tightWidth) * cssHeight
    widths.push({ cssWidth, tightWidth })
  }

  return {
    totalWastedPixels,
    widths,
  }
}

export function formatPixelCount(value: number): string {
  return `${Math.round(value).toLocaleString()}`
}
