import { createDemoResources, layoutParagraphOptimal, type DemoControls } from './optimal-line-breaking.model.ts'
import { renderFrame, renderMetrics, createCtx } from './optimal-line-breaking.ui.ts'

type State = {
  controls: DemoControls
  events: {
    widthInput: number | null
    showMetricsInput: boolean | null
    showBadnessInput: boolean | null
    showFitnessInput: boolean | null
  }
}

const LINE_HEIGHT = 24
const PADDING = 12

const dom = {
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  widthSlider: document.getElementById('widthSlider') as HTMLInputElement,
  widthVal: document.getElementById('widthVal') as HTMLSpanElement,
  showMetrics: document.getElementById('showMetrics') as HTMLInputElement,
  showBadness: document.getElementById('showBadness') as HTMLInputElement,
  showFitness: document.getElementById('showFitness') as HTMLInputElement,
  paragraphSelect: document.getElementById('paragraphSelect') as HTMLSelectElement,
}

const ctx = createCtx(dom.canvas)

const state: State = {
  controls: {
    colWidth: Number.parseInt(dom.widthSlider.value, 10),
    showMetrics: dom.showMetrics.checked,
    showBadness: dom.showBadness.checked,
    showFitness: dom.showFitness.checked,
  },
  events: {
    widthInput: null,
    showMetricsInput: null,
    showBadnessInput: null,
    showFitnessInput: null,
  },
}

let scheduledRaf: number | null = null

dom.widthSlider.addEventListener('input', () => {
  state.events.widthInput = Number.parseInt(dom.widthSlider.value, 10)
  scheduleRender()
})

dom.showMetrics.addEventListener('input', () => {
  state.events.showMetricsInput = dom.showMetrics.checked
  scheduleRender()
})

dom.showBadness.addEventListener('input', () => {
  state.events.showBadnessInput = dom.showBadness.checked
  scheduleRender()
})

dom.showFitness.addEventListener('input', () => {
  state.events.showFitnessInput = dom.showFitness.checked
  scheduleRender()
})

dom.paragraphSelect.addEventListener('change', scheduleRender)
window.addEventListener('resize', scheduleRender)

await document.fonts.ready

const resources = createDemoResources()
render()

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(render)
}

function render(): void {
  scheduledRaf = null

  let colWidth = state.controls.colWidth
  if (state.events.widthInput !== null) colWidth = state.events.widthInput

  let showMetrics = state.controls.showMetrics
  if (state.events.showMetricsInput !== null) showMetrics = state.events.showMetricsInput

  let showBadness = state.controls.showBadness
  if (state.events.showBadnessInput !== null) showBadness = state.events.showBadnessInput

  let showFitness = state.controls.showFitness
  if (state.events.showFitnessInput !== null) showFitness = state.events.showFitnessInput

  const paragraphIdx = Number.parseInt(dom.paragraphSelect.value, 10)
  const prepared = resources.preparedParagraphs[paragraphIdx]!

  const lines = layoutParagraphOptimal(prepared, colWidth - PADDING * 2, resources.normalSpaceWidth)

  const canvasWidth = colWidth
  const canvasHeight = lines.length * LINE_HEIGHT + PADDING * 2 + (showMetrics ? 200 : 0)

  dom.canvas.width = canvasWidth
  dom.canvas.height = canvasHeight
  dom.canvas.style.width = canvasWidth + 'px'
  dom.canvas.style.height = canvasHeight + 'px'

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  ctx.save()
  ctx.translate(PADDING, PADDING)

  const endY = renderFrame(
    ctx,
    lines,
    resources.normalSpaceWidth,
    LINE_HEIGHT - 4,
    LINE_HEIGHT,
    showBadness,
    showFitness
  )

  ctx.restore()

  if (showMetrics) {
    ctx.save()
    ctx.translate(PADDING, endY + PADDING)
    renderMetrics(ctx, lines, resources.normalSpaceWidth, 0, 0)
    ctx.restore()
  }

  state.controls = { colWidth, showMetrics, showBadness, showFitness }
  state.events = { widthInput: null, showMetricsInput: null, showBadnessInput: null, showFitnessInput: null }

  dom.widthVal.textContent = colWidth + 'px'
}
