import { FONT, LINE_HEIGHT, PAD, PARA_GAP, PARAGRAPHS } from './justification-comparison.data.ts'
import {
  type CanvasColumnFrame,
  getRiverIndicator,
  type DemoControls,
  type DemoFrame,
  type PositionedLine,
  type QualityMetrics,
  type RiverIndicator,
} from './justification-comparison.model.ts'

type CanvasSurface = {
  element: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

type MetricPanelCache = {
  linesValue: HTMLSpanElement
  avgDeviationValue: HTMLSpanElement
  maxDeviationValue: HTMLSpanElement
  riverCountValue: HTMLSpanElement
}

export type DomCache = {
  slider: HTMLInputElement
  showIndicators: HTMLInputElement
  widthValue: HTMLElement
  columns: HTMLElement[]
  cssCol: HTMLElement
  cssRiverOverlay: HTMLElement
  cssParagraphs: HTMLParagraphElement[]
  cssRange: Range
  cssRiverMarks: HTMLDivElement[]
  hyphenCanvas: CanvasSurface
  optimalCanvas: CanvasSurface
  metrics: {
    css: MetricPanelCache
    hyphen: MetricPanelCache
    optimal: MetricPanelCache
  }
}

export function createDomCache(): DomCache {
  const slider = getInputElement('widthSlider')
  const showIndicators = getInputElement('showIndicators')
  const widthValue = getHtmlElement('widthVal')
  const cssCol = getHtmlElement('cssCol')
  const cssText = getHtmlElement('cssText')
  const cssRiverOverlay = getHtmlElement('cssRiverOverlay')

  const columns = Array.from(document.querySelectorAll<HTMLElement>('.column'))
  const cssParagraphs = createCssParagraphs(cssText)

  return {
    slider,
    showIndicators,
    widthValue,
    columns,
    cssCol,
    cssRiverOverlay,
    cssParagraphs,
    cssRange: document.createRange(),
    cssRiverMarks: [],
    hyphenCanvas: createCanvasSurface('c2'),
    optimalCanvas: createCanvasSurface('c3'),
    metrics: {
      css: createMetricPanel(getHtmlElement('metrics0')),
      hyphen: createMetricPanel(getHtmlElement('metrics2')),
      optimal: createMetricPanel(getHtmlElement('metrics3')),
    },
  }
}

export function renderFrame(
  dom: DomCache,
  frame: DemoFrame,
  normalSpaceWidth: number,
): void {
  applyControls(dom, frame.controls)
  applyColumnWidths(dom, frame.controls.colWidth)

  updateMetricPanel(dom.metrics.css, frame.css.metrics)
  updateMetricPanel(dom.metrics.hyphen, frame.hyphen.metrics)
  updateMetricPanel(dom.metrics.optimal, frame.optimal.metrics)

  paintCanvasColumn(dom.hyphenCanvas, frame.hyphen, frame.controls.showIndicators, normalSpaceWidth)
  paintCanvasColumn(dom.optimalCanvas, frame.optimal, frame.controls.showIndicators, normalSpaceWidth)
}

export function syncCssRiverOverlay(
  dom: DomCache,
  controls: DemoControls,
  normalSpaceWidth: number,
): void {
  if (!controls.showIndicators) {
    hideUnusedRiverMarks(dom.cssRiverMarks, 0)
    return
  }

  const overlayRect = dom.cssCol.getBoundingClientRect()
  const riverMarks: Array<{
    left: number
    top: number
    width: number
    color: string
  }> = []

  for (let paragraphIndex = 0; paragraphIndex < dom.cssParagraphs.length; paragraphIndex++) {
    const paragraph = dom.cssParagraphs[paragraphIndex]!
    const textNode = paragraph.firstChild
    if (!(textNode instanceof Text)) throw new Error('Expected CSS paragraph to contain a single text node')

    const text = textNode.textContent
    if (text === null) throw new Error('Expected CSS paragraph text')

    for (let charIndex = 0; charIndex < text.length; charIndex++) {
      if (text[charIndex] !== ' ') continue

      dom.cssRange.setStart(textNode, charIndex)
      dom.cssRange.setEnd(textNode, charIndex + 1)
      const rects = dom.cssRange.getClientRects()
      if (rects.length !== 1) continue

      const rect = rects[0]!
      if (rect.width < 1) continue

      const indicator = getRiverIndicator(rect.width, normalSpaceWidth)
      if (indicator === null) continue

      riverMarks.push({
        left: rect.left - overlayRect.left,
        top: rect.top - overlayRect.top,
        width: rect.width,
        color: toRgba(indicator),
      })
    }
  }

  ensureRiverMarkCount(dom.cssRiverMarks, dom.cssRiverOverlay, riverMarks.length)
  for (let index = 0; index < riverMarks.length; index++) {
    const mark = dom.cssRiverMarks[index]!
    const riverMark = riverMarks[index]!
    mark.style.display = 'block'
    mark.style.left = `${riverMark.left}px`
    mark.style.top = `${riverMark.top}px`
    mark.style.width = `${riverMark.width}px`
    mark.style.background = riverMark.color
  }
  hideUnusedRiverMarks(dom.cssRiverMarks, riverMarks.length)
}

function getHtmlElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing HTMLElement #${id}`)
  return element
}

function getInputElement(id: string): HTMLInputElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing HTMLInputElement #${id}`)
  return element
}

function getCanvasElement(id: string): HTMLCanvasElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLCanvasElement)) throw new Error(`Missing HTMLCanvasElement #${id}`)
  return element
}

function createCanvasSurface(id: string): CanvasSurface {
  const element = getCanvasElement(id)
  const ctx = element.getContext('2d')
  if (ctx === null) throw new Error(`2D canvas context is required for #${id}`)
  return { element, ctx }
}

function createCssParagraphs(cssText: HTMLElement): HTMLParagraphElement[] {
  const paragraphs: HTMLParagraphElement[] = []

  for (let index = 0; index < PARAGRAPHS.length; index++) {
    const paragraph = document.createElement('p')
    paragraph.textContent = PARAGRAPHS[index]!
    paragraph.style.marginBottom = `${index < PARAGRAPHS.length - 1 ? PARA_GAP : 0}px`
    paragraphs.push(paragraph)
  }

  cssText.replaceChildren(...paragraphs)
  return paragraphs
}

function createMetricPanel(container: HTMLElement): MetricPanelCache {
  const linesValue = document.createElement('span')
  const avgDeviationValue = document.createElement('span')
  const maxDeviationValue = document.createElement('span')
  const riverCountValue = document.createElement('span')

  container.replaceChildren(
    createMetricRow('Lines', linesValue),
    createMetricRow('Avg deviation', avgDeviationValue),
    createMetricRow('Max deviation', maxDeviationValue),
    createMetricRow('River spaces', riverCountValue),
  )

  return {
    linesValue,
    avgDeviationValue,
    maxDeviationValue,
    riverCountValue,
  }
}

function createMetricRow(label: string, value: HTMLSpanElement): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'metric-row'

  const labelNode = document.createElement('span')
  labelNode.className = 'metric-label'
  labelNode.textContent = label

  value.className = 'metric-value'

  row.append(labelNode, value)
  return row
}

function applyControls(dom: DomCache, controls: DemoControls): void {
  dom.slider.value = String(controls.colWidth)
  dom.showIndicators.checked = controls.showIndicators
  dom.widthValue.textContent = `${controls.colWidth}px`
}

function applyColumnWidths(dom: DomCache, colWidth: number): void {
  const widthPx = `${colWidth}px`
  for (let index = 0; index < dom.columns.length; index++) {
    dom.columns[index]!.style.width = widthPx
  }
  dom.cssCol.style.width = widthPx
}

function updateMetricPanel(panel: MetricPanelCache, metrics: QualityMetrics): void {
  panel.linesValue.textContent = String(metrics.lineCount)
  panel.linesValue.className = 'metric-value'

  panel.avgDeviationValue.textContent = `${(metrics.avgDeviation * 100).toFixed(1)}%`
  panel.avgDeviationValue.className = `metric-value ${qualityClass(metrics.avgDeviation)}`

  panel.maxDeviationValue.textContent = `${(metrics.maxDeviation * 100).toFixed(1)}%`
  panel.maxDeviationValue.className = `metric-value ${qualityClass(metrics.maxDeviation / 2)}`

  panel.riverCountValue.textContent = String(metrics.riverCount)
  panel.riverCountValue.className = `metric-value ${metrics.riverCount > 0 ? 'bad' : 'good'}`
}

function qualityClass(avgDeviation: number): 'good' | 'ok' | 'bad' {
  if (avgDeviation < 0.15) return 'good'
  if (avgDeviation < 0.35) return 'ok'
  return 'bad'
}

function paintCanvasColumn(
  surface: CanvasSurface,
  frame: CanvasColumnFrame,
  showIndicators: boolean,
  normalSpaceWidth: number,
): void {
  setupCanvas(surface, frame.colWidth, frame.totalHeight)

  const ctx = surface.ctx
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, frame.colWidth, frame.totalHeight)

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, frame.colWidth, frame.totalHeight)
  ctx.clip()

  ctx.font = FONT
  ctx.textBaseline = 'top'

  for (let paragraphIndex = 0; paragraphIndex < frame.paragraphs.length; paragraphIndex++) {
    const paragraph = frame.paragraphs[paragraphIndex]!
    for (let lineIndex = 0; lineIndex < paragraph.length; lineIndex++) {
      paintLine(ctx, paragraph[lineIndex]!, showIndicators, normalSpaceWidth)
    }
  }

  ctx.restore()
}

function setupCanvas(surface: CanvasSurface, width: number, height: number): void {
  const dpr = devicePixelRatio || 1
  surface.element.width = width * dpr
  surface.element.height = height * dpr
  surface.element.style.width = `${width}px`
  surface.element.style.height = `${height}px`
  surface.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function paintLine(
  ctx: CanvasRenderingContext2D,
  line: PositionedLine,
  showIndicators: boolean,
  normalSpaceWidth: number,
): void {
  let x = PAD

  switch (line.spacing.kind) {
    case 'ragged':
    case 'overflow':
      ctx.fillStyle = '#2a2520'
      for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex++) {
        const segment = line.segments[segmentIndex]!
        if (segment.kind === 'space') {
          x += segment.width
          continue
        }
        ctx.fillText(segment.text, x, line.y)
        x += segment.width
      }
      return
    case 'justified':
      for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex++) {
        const segment = line.segments[segmentIndex]!
        if (segment.kind === 'space') {
          if (showIndicators && line.spacing.isRiver) {
            const indicator = getRiverIndicator(line.spacing.width, normalSpaceWidth)
            if (indicator !== null) {
              ctx.fillStyle = toRgba(indicator)
              ctx.fillRect(x + 1, line.y, line.spacing.width - 2, LINE_HEIGHT)
            }
          }
          x += line.spacing.width
          continue
        }
        ctx.fillStyle = '#2a2520'
        ctx.fillText(segment.text, x, line.y)
        x += segment.width
      }
      return
  }
}

function ensureRiverMarkCount(
  marks: HTMLDivElement[],
  overlay: HTMLElement,
  count: number,
): void {
  while (marks.length < count) {
    const mark = document.createElement('div')
    mark.style.position = 'absolute'
    mark.style.pointerEvents = 'none'
    mark.style.height = `${LINE_HEIGHT}px`
    overlay.appendChild(mark)
    marks.push(mark)
  }
}

function hideUnusedRiverMarks(marks: HTMLDivElement[], fromIndex: number): void {
  for (let index = fromIndex; index < marks.length; index++) {
    marks[index]!.style.display = 'none'
  }
}

function toRgba(indicator: RiverIndicator): string {
  return `rgba(${indicator.red},${indicator.green},${indicator.blue},${indicator.alpha})`
}
