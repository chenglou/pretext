import { prepare, layout, type PreparedText } from '../../../src/layout.ts'
import rawThoughts from './shower-thoughts.json'

// --- config ---
const font = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'
const lineHeight = 22
const cardPadding = 16
const gap = 12
const maxColWidth = 400
const singleColumnMaxViewportWidth = 520

type Card = {
  text: string
  prepared: PreparedText
}

type PositionedCard = {
  cardIndex: number
  x: number
  y: number
  h: number
}

type LayoutState = {
  colWidth: number
  contentHeight: number
  positionedCards: PositionedCard[]
}

type State = {
  cards: Card[]
}

// --- prepare all texts upfront ---
const st: State = {
  cards: rawThoughts.map(text => ({
    text,
    prepared: prepare(text, font),
  })),
}

type DomCache = {
  container: HTMLDivElement // cache lifetime: same as app
  cards: Array<HTMLDivElement | undefined> // cache lifetime: on visibility changes
}

const domCache: DomCache = {
  container: document.createElement('div'),
  cards: [],
}

domCache.container.style.position = 'relative'
document.body.appendChild(domCache.container)

function computeLayout(windowWidth: number): LayoutState {
  let colCount: number
  let colWidth: number
  if (windowWidth <= singleColumnMaxViewportWidth) {
    colCount = 1
    colWidth = Math.min(maxColWidth, windowWidth - gap * 2)
  } else {
    const minColWidth = 100 + windowWidth * 0.1
    colCount = Math.max(2, Math.floor((windowWidth + gap) / (minColWidth + gap)))
    colWidth = Math.min(maxColWidth, (windowWidth - (colCount + 1) * gap) / colCount)
  }
  const textWidth = colWidth - cardPadding * 2
  const contentWidth = colCount * colWidth + (colCount - 1) * gap
  const offsetLeft = (windowWidth - contentWidth) / 2

  const colHeights = new Float64Array(colCount)
  for (let c = 0; c < colCount; c++) colHeights[c] = gap

  const positionedCards: PositionedCard[] = []
  for (let i = 0; i < st.cards.length; i++) {
    let shortest = 0
    for (let c = 1; c < colCount; c++) {
      if (colHeights[c]! < colHeights[shortest]!) shortest = c
    }

    const { height } = layout(st.cards[i]!.prepared, textWidth, lineHeight)
    const totalH = height + cardPadding * 2

    positionedCards.push({
      cardIndex: i,
      x: offsetLeft + shortest * (colWidth + gap),
      y: colHeights[shortest]!,
      h: totalH,
    })

    colHeights[shortest]! += totalH + gap
  }

  let contentHeight = 0
  for (let c = 0; c < colCount; c++) {
    if (colHeights[c]! > contentHeight) contentHeight = colHeights[c]!
  }

  return { colWidth, contentHeight, positionedCards }
}

function getOrCreateCardNode(cardIndex: number): HTMLDivElement {
  const existingNode = domCache.cards[cardIndex]
  if (existingNode) return existingNode

  const node = document.createElement('div')
  node.className = 'card'
  node.textContent = st.cards[cardIndex]!.text
  domCache.container.appendChild(node)
  domCache.cards[cardIndex] = node
  return node
}

// --- events ---
window.addEventListener('resize', () => scheduleRender())
window.addEventListener('scroll', () => scheduleRender(), true)

let scheduledRaf: number | null = null
function scheduleRender() {
  if (scheduledRaf != null) return
  scheduledRaf = requestAnimationFrame(function renderAndMaybeScheduleAnotherRender() {
    scheduledRaf = null
    render()
  })
}

function render() {
  // --- DOM reads ---
  const windowWidth = document.documentElement.clientWidth
  const windowHeight = document.documentElement.clientHeight
  const scrollTop = window.scrollY

  const layoutState = computeLayout(windowWidth)
  domCache.container.style.height = `${layoutState.contentHeight}px`

  // --- visibility + DOM writes (single pass) ---
  const viewTop = scrollTop - 200
  const viewBottom = scrollTop + windowHeight + 200
  const visibleFlags = new Uint8Array(st.cards.length)

  for (let i = 0; i < layoutState.positionedCards.length; i++) {
    const positionedCard = layoutState.positionedCards[i]!
    if (positionedCard.y > viewBottom || positionedCard.y + positionedCard.h < viewTop) continue

    visibleFlags[positionedCard.cardIndex] = 1
    const node = getOrCreateCardNode(positionedCard.cardIndex)
    node.style.left = `${positionedCard.x}px`
    node.style.top = `${positionedCard.y}px`
    node.style.width = `${layoutState.colWidth}px`
    node.style.height = `${positionedCard.h}px`
  }

  for (let cardIndex = 0; cardIndex < domCache.cards.length; cardIndex++) {
    const node = domCache.cards[cardIndex]
    if (node && visibleFlags[cardIndex] === 0) {
      node.remove()
      domCache.cards[cardIndex] = undefined
    }
  }
}

scheduleRender()
