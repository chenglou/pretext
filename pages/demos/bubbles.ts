import {
  computeBubbleRender,
  formatPixelCount,
  prepareBubbleTexts,
} from './bubbles.model.ts'

type State = {
  requestedChatWidth: number
  events: {
    sliderValue: number | null
  }
}

const domCache = {
  slider: getRequiredInput('slider'),
  cssWaste: getRequiredSpan('css-waste'),
}

const shrinkNodes = bubblesPage.dom.shrinkBubbles
const preparedBubbles = prepareBubbleTexts(bubblesPage.messages.map(message => message.text))
const st: State = {
  requestedChatWidth: bubblesPage.defaultChatWidth,
  events: {
    sliderValue: null,
  },
}
let scheduledRaf: number | null = null

domCache.slider.addEventListener('input', () => {
  st.events.sliderValue = Number.parseInt(domCache.slider.value, 10)
  scheduleRender()
})

window.addEventListener('resize', () => {
  scheduleRender()
})

scheduleRender()

function getRequiredInput(id: string): HTMLInputElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredSpan(id: string): HTMLSpanElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLSpanElement)) throw new Error(`#${id} not found`)
  return element
}

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderBubblesFrame() {
    scheduledRaf = null
    render()
  })
}

function render(): void {
  // The body's width, not the root's: see the geometry script in bubbles.html.
  const viewportWidth = document.body.clientWidth
  let requestedChatWidth = st.requestedChatWidth
  if (st.events.sliderValue !== null) requestedChatWidth = st.events.sliderValue
  const geometry = bubblesPage.getGeometry(viewportWidth, requestedChatWidth)
  const renderState = computeBubbleRender(preparedBubbles, geometry.bubbleMaxWidth)

  st.requestedChatWidth = requestedChatWidth
  st.events.sliderValue = null

  bubblesPage.paint(geometry)
  for (let index = 0; index < shrinkNodes.length; index++) {
    const shrinkNode = shrinkNodes[index]!
    const widths = renderState.widths[index]!

    shrinkNode.style.maxWidth = `${geometry.bubbleMaxWidth}px`
    shrinkNode.style.width = `${widths.tightWidth}px`
  }

  domCache.cssWaste.textContent = formatPixelCount(renderState.totalWastedPixels)
}
