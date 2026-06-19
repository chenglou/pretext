import {
  layout,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'

type CardItem = {
  id: string
  label: string
  text: string
  imageIndex: number
}

type PreparedCard = {
  id: string
  prepared: PreparedTextWithSegments
}

type RenderedCard = {
  id: string
  column: number
  top: number
  text: string
  imageIndex: number
}

type State = {
  events: {
    columnCount: number | null
  }
  columnCount: number
}

const CARD_WIDTH = 280
const LINE_HEIGHT = 22
const CARD_PADDING_X = 20
const CARD_PADDING_Y = 16
const COLUMN_GAP = 20
const TOP_MARGIN = 24

const FONT = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'

const rawCards: CardItem[] = [
  {
    id: 'c1',
    label: 'Architecture',
    text: 'The building emerged from morning fog, its glass facade catching the first light. Steel beams and concrete formed a quiet dialogue with the mountains beyond.',
    imageIndex: 0,
  },
  {
    id: 'c2',
    label: ' ceramics',
    text: 'Glazed vessels lined the shelf — pale blue, oxidized copper, ash white. Each one held the memory of hands and fire.',
    imageIndex: 1,
  },
  {
    id: 'c3',
    label: 'Letters',
    text: 'She found the box in the attic, its contents undisturbed for decades. The handwriting was unfamiliar, the stamps exotic.',
    imageIndex: 2,
  },
  {
    id: 'c4',
    label: 'Morning',
    text: 'The café opened at six. Steam rose from cups as commuters hurried past, each carrying their own quiet urgency.',
    imageIndex: 3,
  },
  {
    id: 'c5',
    label: 'Field Notes',
    text: 'Observations from the research station: migration patterns, weather cycles, the patient work of cataloguing what endures.',
    imageIndex: 4,
  },
  {
    id: 'c6',
    label: 'Restoration',
    text: 'The painting spent three years in the lab. Conservators uncovered layers beneath the varnish — an earlier version, almost forgotten.',
    imageIndex: 5,
  },
  {
    id: 'c7',
    label: 'Transit',
    text: 'The train followed the river north. Farms gave way to forest, and the sky deepened into evening as the landscape changed.',
    imageIndex: 6,
  },
  {
    id: 'c8',
    label: 'Gathering',
    text: 'The market filled the square. Merchants called their wares, families browsed, and the afternoon unfolded at its own pace.',
    imageIndex: 7,
  },
  {
    id: 'c9',
    label: 'Compost',
    text: 'Turning the pile revealed earth, worms, and the slow alchemy of decay. What was waste became the soil for next season.',
    imageIndex: 0,
  },
  {
    id: 'c10',
    label: 'Survey',
    text: 'The team mapped the coastline mile by mile. Cliffs, coves, tide pools — a landscape that resists easy description.',
    imageIndex: 1,
  },
  {
    id: 'c11',
    label: 'Candle',
    text: 'The flame steadied as the room darkened. Shadows moved on the walls, and conversation found its natural rhythm.',
    imageIndex: 2,
  },
  {
    id: 'c12',
    label: 'Archive',
    text: 'Files filled the basement shelves. Each folder held a negotiation, a decision, a moment when someone chose a particular path.',
    imageIndex: 3,
  },
  {
    id: 'c13',
    label: 'Evening',
    text: 'The bridge crossed at dusk. Walkers shared the path, dogs pulled at leashes, and the city lights began to appear on the far shore.',
    imageIndex: 4,
  },
  {
    id: 'c14',
    label: 'Recipe',
    text: 'Flour, butter, a generational knowledge of texture. The dough came together by feel, not measurement.',
    imageIndex: 5,
  },
  {
    id: 'c15',
    label: 'Mapping',
    text: 'Streets appeared in layers — the citys present and past overlapping, one neighborhood named for a family, another for a trade.',
    imageIndex: 6,
  },
  {
    id: 'c16',
    label: 'Repair',
    text: 'The mechanism had worn smooth. Oil, adjustment, patience — eventually it ran again, neither new nor broken.',
    imageIndex: 7,
  },
  {
    id: 'c17',
    label: 'Tide',
    text: 'Low tide exposed the reef. Pools held small worlds — anemones, hermit crabs, the slow negotiation of salt and life.',
    imageIndex: 0,
  },
  {
    id: 'c18',
    label: 'Studio',
    text: 'The space collected light from the north. Sketches covered the wall, and the day found its purpose in the materials at hand.',
    imageIndex: 1,
  },
]

const preparedCards: PreparedCard[] = rawCards.map(card => ({
  id: card.id,
  prepared: prepareWithSegments(card.text, FONT),
}))

const domCache = {
  root: document.documentElement,
  grid: getRequiredDiv('grid'),
  columnSlider: getRequiredInput('column-slider'),
  columnValue: getRequiredSpan('column-value'),
}

const st: State = {
  events: {
    columnCount: null,
  },
  columnCount: 2,
}

let scheduledRaf: number | null = null

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}

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

function computeCardHeight(prepared: PreparedTextWithSegments, maxWidth: number): number {
  const metrics = layout(prepared, maxWidth, LINE_HEIGHT)
  return Math.ceil(metrics.height) + CARD_PADDING_Y * 2 + 70
}

function layoutMasonry(
  preparedCards: PreparedCard[],
  columnCount: number,
  viewportWidth: number,
): RenderedCard[] {
  const columnWidth = Math.floor(
    (viewportWidth - COLUMN_GAP * (columnCount - 1)) / columnCount,
  )
  const contentWidth = columnWidth - CARD_PADDING_X * 2

  const columnHeights = new Array(columnCount).fill(TOP_MARGIN)
  const rendered: RenderedCard[] = []

  for (let cardIndex = 0; cardIndex < preparedCards.length; cardIndex++) {
    const card = preparedCards[cardIndex]!
    const cardData = rawCards.find(c => c.id === card.id)!

    let minColumn = 0
    let minHeight = columnHeights[0]!

    for (let c = 1; c < columnCount; c++) {
      if (columnHeights[c]! < minHeight) {
        minColumn = c
        minHeight = columnHeights[c]!
      }
    }

    const cardHeight = computeCardHeight(card.prepared, contentWidth)
    columnHeights[minColumn] = minHeight + cardHeight + COLUMN_GAP

    rendered.push({
      id: card.id,
      column: minColumn,
      top: minHeight,
      text: cardData.text,
      imageIndex: cardData.imageIndex,
    })
  }

  return rendered
}

function renderGrid(cards: RenderedCard[], columnCount: number, viewportWidth: number): void {
  const grid = domCache.grid
  grid.textContent = ''

  const columnWidth = Math.floor(
    (viewportWidth - COLUMN_GAP * (columnCount - 1)) / columnCount,
  )

  const fragment = document.createDocumentFragment()

  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const card = cards[cardIndex]!
    const cardElement = document.createElement('div')
    cardElement.className = 'masonry-card'
    cardElement.style.setProperty('--card-width', `${columnWidth}px`)
    cardElement.style.setProperty('--card-left', `${card.column * (columnWidth + COLUMN_GAP)}px`)
    cardElement.style.setProperty('--card-top', `${card.top}px`)

    const labelEl = document.createElement('span')
    labelEl.className = 'card-label'
    const cardData = rawCards.find(c => c.id === card.id)!
    labelEl.textContent = cardData.label

    const imageBlock = document.createElement('div')
    imageBlock.className = 'card-image'
    imageBlock.style.setProperty('background-color', `var(--color-${(card.imageIndex % 8) + 1})`)

    const textEl = document.createElement('p')
    textEl.className = 'card-text'
    textEl.textContent = card.text

    cardElement.appendChild(imageBlock)
    cardElement.appendChild(labelEl)
    cardElement.appendChild(textEl)
    fragment.appendChild(cardElement)
  }

  grid.appendChild(fragment)
}

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderFrame() {
    scheduledRaf = null
    render()
  })
}

function boot(): void {
  domCache.columnSlider.addEventListener('input', () => {
    const value = Number.parseInt(domCache.columnSlider.value, 10)
    st.events.columnCount = value
    scheduleRender()
  })

  window.addEventListener('resize', () => {
    scheduleRender()
  })

  document.fonts.ready.then(() => {
    scheduleRender()
  })

  scheduleRender()
}

function render(): void {
  const viewportWidth = document.documentElement.clientWidth

  let columnCount = st.columnCount
  if (st.events.columnCount !== null) {
    columnCount = st.events.columnCount
    st.columnCount = columnCount
    st.events.columnCount = null
  }

  const minColumns = Math.max(1, Math.floor(viewportWidth / (CARD_WIDTH + COLUMN_GAP)))
  const maxColumns = Math.max(1, Math.floor(viewportWidth / (CARD_WIDTH * 0.5 + COLUMN_GAP)))
  const clampedColumns = Math.max(minColumns, Math.min(maxColumns, columnCount))

  domCache.columnSlider.min = String(minColumns)
  domCache.columnSlider.max = String(maxColumns)
  domCache.columnSlider.value = String(clampedColumns)
  domCache.columnValue.textContent = `${clampedColumns}`

  const cards = layoutMasonry(preparedCards, clampedColumns, viewportWidth)
  renderGrid(cards, clampedColumns, viewportWidth)
}