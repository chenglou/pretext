import { createDemoResources, buildDemoFrame, type DemoControls } from './justification-comparison.model.ts'
import { createDomCache, renderFrame, syncCssRiverOverlay } from './justification-comparison.ui.ts'

type State = {
  controls: DemoControls
  events: {
    widthInput: number | null
    showIndicatorsInput: boolean | null
  }
}

const dom = createDomCache()

const state: State = {
  controls: {
    colWidth: Number.parseInt(dom.slider.value, 10),
    showIndicators: dom.showIndicators.checked,
  },
  events: {
    widthInput: null,
    showIndicatorsInput: null,
  },
}

let scheduledRaf: number | null = null
let cssOverlayRequestId = 0

dom.slider.addEventListener('input', () => {
  state.events.widthInput = Number.parseInt(dom.slider.value, 10)
  scheduleRender()
})

dom.showIndicators.addEventListener('input', () => {
  state.events.showIndicatorsInput = dom.showIndicators.checked
  scheduleRender()
})

window.addEventListener('resize', scheduleRender)

await document.fonts.ready

const resources = createDemoResources()
render()

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderAndSyncCssOverlay() {
    scheduledRaf = null
    render()
  })
}

function render(): void {
  let colWidth = state.controls.colWidth
  if (state.events.widthInput !== null) colWidth = state.events.widthInput

  let showIndicators = state.controls.showIndicators
  if (state.events.showIndicatorsInput !== null) showIndicators = state.events.showIndicatorsInput

  const nextControls = { colWidth, showIndicators }
  const frame = buildDemoFrame(resources, nextControls)

  state.controls = nextControls
  state.events.widthInput = null
  state.events.showIndicatorsInput = null

  renderFrame(dom, frame, resources.normalSpaceWidth)
  scheduleCssOverlaySync()
}

function scheduleCssOverlaySync(): void {
  const requestId = ++cssOverlayRequestId
  requestAnimationFrame(function syncCssOverlayAfterLayout() {
    if (requestId !== cssOverlayRequestId) return
    syncCssRiverOverlay(dom, state.controls, resources.normalSpaceWidth)
  })
}
