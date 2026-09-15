import {
  computeBubbleRender,
  formatPixelCount,
  prepareBubbleTexts,
} from './bubbles-shared.ts'

type State = {
  requestedChatWidth: number
  events: {
    sliderValue: number | null
  }
}

const domCache = {
  chatShrink: getRequiredDiv('chat-shrink'),
  slider: getRequiredInput('slider'),
  cssWaste: getRequiredSpan('css-waste'),
  shrinkWaste: getRequiredSpan('shrink-waste'),
}

const shrinkNodes = getChatMessageNodes(domCache.chatShrink)
const preparedBubbles = prepareBubbleTexts(shrinkNodes.map(readNodeText))
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

document.fonts.ready.then(() => {
  scheduleRender()
})

scheduleRender()

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

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

function getChatMessageNodes(chat: HTMLDivElement): HTMLDivElement[] {
  return Array.from(chat.querySelectorAll<HTMLDivElement>('.msg'))
}

function readNodeText(node: HTMLDivElement): string {
  return node.textContent ?? ''
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
  domCache.shrinkWaste.textContent = '0'
}
