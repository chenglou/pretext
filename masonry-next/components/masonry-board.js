'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const FONT = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'
const CARD_PADDING = 16
const CARD_ACTIONS_HEIGHT = 44
const GAP = 12
const LINE_HEIGHT = 22
const MAX_COLUMN_WIDTH = 400
const SINGLE_COLUMN_MAX_VIEWPORT_WIDTH = 520
const VIEWPORT_BUFFER = 300

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

function createMeasureContext() {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  context.font = FONT
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

function computeLayout(thoughts, windowWidth, heightCache, context) {
  let columnCount
  let columnWidth

  if (windowWidth <= SINGLE_COLUMN_MAX_VIEWPORT_WIDTH) {
    columnCount = 1
    columnWidth = Math.min(MAX_COLUMN_WIDTH, windowWidth - GAP * 2)
  } else {
    const minColumnWidth = 100 + windowWidth * 0.1
    columnCount = Math.max(2, Math.floor((windowWidth + GAP) / (minColumnWidth + GAP)))
    columnWidth = Math.min(MAX_COLUMN_WIDTH, (windowWidth - (columnCount + 1) * GAP) / columnCount)
  }

  const textWidth = Math.max(120, columnWidth - CARD_PADDING * 2)
  const contentWidth = columnCount * columnWidth + (columnCount - 1) * GAP
  const offsetLeft = (windowWidth - contentWidth) / 2
  const columnHeights = new Float64Array(columnCount)
  const positionedCards = []

  for (let index = 0; index < columnCount; index += 1) {
    columnHeights[index] = GAP
  }

  for (const thought of thoughts) {
    const cacheKey = `${thought.id}:${Math.round(textWidth)}`
    let cardHeight = heightCache.get(cacheKey)

    if (cardHeight == null) {
      const lineCount = measureWrappedLines(thought.body, textWidth, context)
      cardHeight = lineCount * LINE_HEIGHT + CARD_PADDING * 2 + CARD_ACTIONS_HEIGHT
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
      x: offsetLeft + shortestColumn * (columnWidth + GAP),
      y: columnHeights[shortestColumn],
      height: cardHeight,
      width: columnWidth,
    })

    columnHeights[shortestColumn] += cardHeight + GAP
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
    if (activeThoughts.length === 0) {
      setLayout(current => ({
        ...current,
        contentHeight: 0,
        positionedCards: [],
        columnCount: current.columnCount || 1,
      }))
      return
    }

    measureContextRef.current = createMeasureContext()

    function updateLayout() {
      const nextLayout = computeLayout(
        activeThoughts,
        document.documentElement.clientWidth,
        heightCacheRef.current,
        measureContextRef.current,
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
  }, [activeThoughts])

  const visibleTop = viewport.top - VIEWPORT_BUFFER
  const visibleBottom = viewport.top + viewport.height + VIEWPORT_BUFFER
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

  const favoriteCount = thoughts.reduce((count, thought) => count + (thought.isFavorite ? 1 : 0), 0)

  return (
    <main className="page-shell">
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
