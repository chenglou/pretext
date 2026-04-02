'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const BASE_FONT_SIZE = 15
const BASE_CARD_PADDING_X = 16
const BASE_CARD_PADDING_TOP = 12
const BASE_CARD_PADDING_BOTTOM = 16
const BASE_CARD_ACTIONS_HEIGHT = 44
const BASE_GAP = 12
const BASE_LINE_HEIGHT = 22
const BASE_MAX_COLUMN_WIDTH = 400
const BASE_SINGLE_COLUMN_MAX_VIEWPORT_WIDTH = 520
const BASE_VIEWPORT_BUFFER = 300
const ZOOM_STEP = 0.1
const MIN_ZOOM = 0.8
const MAX_ZOOM = 1.8
const DEFAULT_ZOOM = 1
const ZOOM_STORAGE_KEY = 'masonry-next-zoom'

function IconButton({ label, pressed, onClick, children, testId }) {
  return (
    <button
      type="button"
      className="card-action-button"
      aria-label={label}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function FavoriteIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`card-action-icon${active ? ' is-active' : ''}`}>
      <path
        d="M12 17.2 5.8 21l1.6-7.1L2 9l7.2-.6L12 2l2.8 6.4L22 9l-5.4 4.9 1.6 7.1z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="card-action-icon">
      <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="card-action-icon">
      <path
        d="M10 14 14 10M8.5 15.5l-1.8 1.8a3.5 3.5 0 1 1-5-5l3.2-3.1a3.5 3.5 0 0 1 5 0M15.5 8.5l1.8-1.8a3.5 3.5 0 0 1 5 5l-3.2 3.1a3.5 3.5 0 0 1-5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HideIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="card-action-icon">
      <path
        d="M4 4 20 20M10.7 10.9a2 2 0 0 0 2.4 2.4M9.9 5.1A11 11 0 0 1 12 5c5.7 0 9.7 5.3 10 5.7a1 1 0 0 1 0 1.1 18 18 0 0 1-4 4.2M6.2 6.2A18.2 18.2 0 0 0 2 10.7a1 1 0 0 0 0 1.1C2.3 12.2 6.3 17.5 12 17.5c1.2 0 2.2-.2 3.2-.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(zoom.toFixed(2))))
}

function getNextZoom(currentZoom, direction) {
  return clampZoom(currentZoom + ZOOM_STEP * direction)
}

function getMetrics(zoom) {
  return {
    zoom,
    fontSize: BASE_FONT_SIZE * zoom,
    font: `${BASE_FONT_SIZE * zoom}px ${FONT_FAMILY}`,
    cardPaddingX: BASE_CARD_PADDING_X * zoom,
    cardPaddingTop: BASE_CARD_PADDING_TOP * zoom,
    cardPaddingBottom: BASE_CARD_PADDING_BOTTOM * zoom,
    cardActionsHeight: BASE_CARD_ACTIONS_HEIGHT * zoom,
    gap: BASE_GAP * zoom,
    lineHeight: BASE_LINE_HEIGHT * zoom,
    maxColumnWidth: BASE_MAX_COLUMN_WIDTH * zoom,
    singleColumnMaxViewportWidth: BASE_SINGLE_COLUMN_MAX_VIEWPORT_WIDTH * zoom,
    viewportBuffer: BASE_VIEWPORT_BUFFER * zoom,
    minTextWidth: 120 * zoom,
  }
}

function createMeasureContext(font) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  context.font = font
  return context
}

function measureWrappedLines(text, maxWidth, context) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return 1

  const words = normalized.split(' ')
  let lineCount = 0
  let currentLine = ''

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word
    if (context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine
      continue
    }

    if (currentLine) {
      lineCount += 1
      currentLine = ''
    }

    if (context.measureText(word).width <= maxWidth) {
      currentLine = word
      continue
    }

    let fragment = ''
    for (const char of Array.from(word)) {
      const candidate = `${fragment}${char}`
      if (fragment && context.measureText(candidate).width > maxWidth) {
        lineCount += 1
        fragment = char
      } else {
        fragment = candidate
      }
    }
    currentLine = fragment
  }

  if (currentLine) lineCount += 1
  return Math.max(1, lineCount)
}

function computeLayout(thoughts, windowWidth, heightCache, context, metrics) {
  let columnCount
  let columnWidth

  if (windowWidth <= metrics.singleColumnMaxViewportWidth) {
    columnCount = 1
    columnWidth = Math.min(metrics.maxColumnWidth, windowWidth - metrics.gap * 2)
  } else {
    const minColumnWidth = 100 + windowWidth * 0.1
    columnCount = Math.max(2, Math.floor((windowWidth + metrics.gap) / (minColumnWidth + metrics.gap)))
    columnWidth = Math.min(
      metrics.maxColumnWidth,
      (windowWidth - (columnCount + 1) * metrics.gap) / columnCount,
    )
  }

  const textWidth = Math.max(metrics.minTextWidth, columnWidth - metrics.cardPaddingX * 2)
  const contentWidth = columnCount * columnWidth + (columnCount - 1) * metrics.gap
  const offsetLeft = (windowWidth - contentWidth) / 2
  const columnHeights = new Float64Array(columnCount)
  const positionedCards = []

  for (let index = 0; index < columnCount; index += 1) {
    columnHeights[index] = metrics.gap
  }

  for (const thought of thoughts) {
    const cacheKey = `${thought.id}:${Math.round(textWidth)}:${metrics.zoom}`
    let cardHeight = heightCache.get(cacheKey)

    if (cardHeight == null) {
      const lineCount = measureWrappedLines(thought.body, textWidth, context)
      cardHeight =
        lineCount * metrics.lineHeight +
        metrics.cardPaddingTop +
        metrics.cardPaddingBottom +
        metrics.cardActionsHeight
      heightCache.set(cacheKey, cardHeight)
    }

    let shortestColumn = 0
    for (let index = 1; index < columnCount; index += 1) {
      if (columnHeights[index] < columnHeights[shortestColumn]) {
        shortestColumn = index
      }
    }

    positionedCards.push({
      ...thought,
      x: offsetLeft + shortestColumn * (columnWidth + metrics.gap),
      y: columnHeights[shortestColumn],
      height: cardHeight,
      width: columnWidth,
    })

    columnHeights[shortestColumn] += cardHeight + metrics.gap
  }

  return {
    columnCount,
    columnWidth,
    contentHeight: Math.max(...columnHeights),
    positionedCards,
  }
}

export default function MasonryBoard() {
  const heightCacheRef = useRef(new Map())
  const measureContextRef = useRef(null)
  const [thoughts, setThoughts] = useState([])
  const [layout, setLayout] = useState({ contentHeight: 0, positionedCards: [], columnCount: 0 })
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const [filter, setFilter] = useState('all')
  const [statusMessage, setStatusMessage] = useState('')
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  const metrics = useMemo(() => getMetrics(zoom), [zoom])

  const hiddenCount = useMemo(
    () => thoughts.reduce((count, thought) => count + (thought.isHidden ? 1 : 0), 0),
    [thoughts],
  )

  const activeThoughts = useMemo(() => {
    return thoughts.filter(thought => {
      if (thought.isHidden) return false
      if (filter === 'favorites') return thought.isFavorite
      return true
    })
  }, [filter, thoughts])

  useEffect(() => {
    if (!statusMessage) return undefined

    const timeoutId = window.setTimeout(() => {
      setStatusMessage('')
    }, 1800)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [statusMessage])

  useEffect(() => {
    let cancelled = false

    async function loadThoughts() {
      const response = await fetch('/api/thoughts')
      const payload = await response.json()
      if (!cancelled) setThoughts(payload)
    }

    loadThoughts()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const storedZoom = window.localStorage.getItem(ZOOM_STORAGE_KEY)
    if (!storedZoom) return

    const parsedZoom = Number.parseFloat(storedZoom)
    if (!Number.isFinite(parsedZoom)) return
    setZoom(clampZoom(parsedZoom))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom))
  }, [zoom])

  useEffect(() => {
    function handleKeydown(event) {
      const isModifierPressed = event.metaKey || event.ctrlKey
      if (!isModifierPressed || event.altKey) return

      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName
        if (target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
          return
        }
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoom(currentZoom => {
          const nextZoom = getNextZoom(currentZoom, 1)
          setStatusMessage(`Zoom ${Math.round(nextZoom * 100)}%`)
          return nextZoom
        })
        return
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setZoom(currentZoom => {
          const nextZoom = getNextZoom(currentZoom, -1)
          setStatusMessage(`Zoom ${Math.round(nextZoom * 100)}%`)
          return nextZoom
        })
        return
      }

      if (event.key === '0') {
        event.preventDefault()
        setZoom(() => {
          setStatusMessage(`Zoom ${Math.round(DEFAULT_ZOOM * 100)}%`)
          return DEFAULT_ZOOM
        })
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [])

  useEffect(() => {
    if (activeThoughts.length === 0) {
      setLayout(current => ({
        ...current,
        contentHeight: 0,
        positionedCards: [],
        columnCount: current.columnCount || 1,
      }))
      return
    }

    measureContextRef.current = createMeasureContext(metrics.font)

    function updateLayout() {
      const nextLayout = computeLayout(
        activeThoughts,
        document.documentElement.clientWidth,
        heightCacheRef.current,
        measureContextRef.current,
        metrics,
      )
      setLayout(nextLayout)
      setViewport({
        top: window.scrollY,
        height: document.documentElement.clientHeight,
      })
    }

    function updateViewport() {
      setViewport({
        top: window.scrollY,
        height: document.documentElement.clientHeight,
      })
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    window.addEventListener('scroll', updateViewport, { passive: true })

    return () => {
      window.removeEventListener('resize', updateLayout)
      window.removeEventListener('scroll', updateViewport)
    }
  }, [activeThoughts, metrics])

  const visibleTop = viewport.top - metrics.viewportBuffer
  const visibleBottom = viewport.top + viewport.height + metrics.viewportBuffer
  const visibleCards = layout.positionedCards.filter(card => {
    return card.y < visibleBottom && card.y + card.height > visibleTop
  })

  function updateThought(updatedThought) {
    setThoughts(currentThoughts =>
      currentThoughts.map(thought => (thought.id === updatedThought.id ? updatedThought : thought)),
    )
  }

  async function handleFavorite(card) {
    const response = await fetch(`/api/thoughts/${card.id}/favorite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: !card.isFavorite }),
    })

    const updatedThought = await response.json()
    updateThought(updatedThought)
    setStatusMessage(updatedThought.isFavorite ? 'Added to favorites' : 'Removed from favorites')
  }

  async function handleHide(card) {
    const response = await fetch(`/api/thoughts/${card.id}/hide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isHidden: true }),
    })

    const updatedThought = await response.json()
    updateThought(updatedThought)
    setStatusMessage('Thought hidden')
  }

  async function handleResetHidden() {
    await fetch('/api/thoughts/reset-hidden', {
      method: 'POST',
    })

    setThoughts(currentThoughts =>
      currentThoughts.map(thought => ({
        ...thought,
        isHidden: false,
      })),
    )
    setStatusMessage('Hidden thoughts restored')
  }

  async function handleCopy(card) {
    await navigator.clipboard.writeText(card.body)
    setStatusMessage('Thought copied')
  }

  async function handlePermalink(card) {
    const permalink = `${window.location.origin}/#thought-${card.id}`
    await navigator.clipboard.writeText(permalink)
    window.history.replaceState(null, '', `#thought-${card.id}`)
    setStatusMessage('Permalink copied')
  }

  function handleZoom(direction) {
    setZoom(currentZoom => {
      const nextZoom = getNextZoom(currentZoom, direction)
      setStatusMessage(`Zoom ${Math.round(nextZoom * 100)}%`)
      return nextZoom
    })
  }

  function handleResetZoom() {
    setZoom(DEFAULT_ZOOM)
    setStatusMessage(`Zoom ${Math.round(DEFAULT_ZOOM * 100)}%`)
  }

  const favoriteCount = thoughts.reduce((count, thought) => count + (thought.isFavorite ? 1 : 0), 0)
  const zoomPercent = Math.round(zoom * 100)

  return (
    <main
      className="page-shell"
      style={{
        '--card-padding-x': `${metrics.cardPaddingX}px`,
        '--card-padding-top': `${metrics.cardPaddingTop}px`,
        '--card-padding-bottom': `${metrics.cardPaddingBottom}px`,
        '--card-actions-height': `${metrics.cardActionsHeight}px`,
        '--card-font-size': `${metrics.fontSize}px`,
        '--card-line-height': `${metrics.lineHeight}px`,
        '--card-action-button-size': `${30 * zoom}px`,
        '--card-action-icon-size': `${16 * zoom}px`,
      }}
    >
      <div className="page-toolbar">
        <div className="page-toolbar-group">
          <button
            type="button"
            className={`toolbar-pill${filter === 'all' ? ' is-active' : ''}`}
            data-testid="filter-all"
            onClick={() => setFilter('all')}
          >
            All <span>{thoughts.length - hiddenCount}</span>
          </button>
          <button
            type="button"
            className={`toolbar-pill${filter === 'favorites' ? ' is-active' : ''}`}
            data-testid="filter-favorites"
            onClick={() => setFilter('favorites')}
          >
            Favorites <span>{favoriteCount}</span>
          </button>
        </div>
        <div className="page-toolbar-group">
          <button
            type="button"
            className="toolbar-pill"
            data-testid="zoom-out"
            onClick={() => handleZoom(-1)}
            disabled={zoom <= MIN_ZOOM}
          >
            Zoom out
          </button>
          <button
            type="button"
            className="toolbar-pill is-active"
            data-testid="zoom-level"
            onClick={handleResetZoom}
          >
            Zoom <span>{zoomPercent}%</span>
          </button>
          <button
            type="button"
            className="toolbar-pill"
            data-testid="zoom-in"
            onClick={() => handleZoom(1)}
            disabled={zoom >= MAX_ZOOM}
          >
            Zoom in
          </button>
          <button
            type="button"
            className="toolbar-pill"
            data-testid="reset-hidden"
            onClick={handleResetHidden}
            disabled={hiddenCount === 0}
          >
            Reset hidden <span>{hiddenCount}</span>
          </button>
        </div>
      </div>

      {statusMessage ? (
        <div className="page-status" data-testid="status-message">
          {statusMessage}
        </div>
      ) : null}

      {thoughts.length === 0 ? (
        <div className="masonry-loading" data-testid="loading-indicator">
          Loading thoughts...
        </div>
      ) : null}

      {thoughts.length > 0 && activeThoughts.length === 0 ? (
        <div className="empty-state" data-testid="empty-state">
          No thoughts match this view yet.
        </div>
      ) : null}

      <div
        className="masonry-root"
        data-testid="masonry-root"
        data-column-count={layout.columnCount ?? 0}
        data-card-count={activeThoughts.length}
        data-zoom-level={zoomPercent}
        style={{ height: `${layout.contentHeight}px` }}
      >
        {visibleCards.map(card => (
          <article
            key={card.id}
            id={`thought-${card.id}`}
            className={`masonry-card${card.isFavorite ? ' is-favorite' : ''}`}
            data-testid="masonry-card"
            data-card-id={card.id}
            data-favorite={card.isFavorite ? 'true' : 'false'}
            style={{
              left: `${card.x}px`,
              top: `${card.y}px`,
              width: `${card.width}px`,
              height: `${card.height}px`,
            }}
          >
            <div className="card-actions">
              <IconButton
                label={card.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                pressed={card.isFavorite}
                testId={`favorite-${card.id}`}
                onClick={() => handleFavorite(card)}
              >
                <FavoriteIcon active={card.isFavorite} />
              </IconButton>
              <IconButton
                label="Copy thought"
                testId={`copy-${card.id}`}
                onClick={() => handleCopy(card)}
              >
                <CopyIcon />
              </IconButton>
              <IconButton
                label="Copy permalink"
                testId={`permalink-${card.id}`}
                onClick={() => handlePermalink(card)}
              >
                <LinkIcon />
              </IconButton>
              <IconButton
                label="Hide thought"
                testId={`hide-${card.id}`}
                onClick={() => handleHide(card)}
              >
                <HideIcon />
              </IconButton>
            </div>
            <p className="card-text">{card.body}</p>
          </article>
        ))}
      </div>
    </main>
  )
}
