import { prepare, layout, type PreparedText } from '../../src/layout.ts'
import rawThoughts from './masonry/shower-thoughts.json'

// --- config ---
const font = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'
const lineHeight = 22
const rowPaddingY = 12
const rowPaddingX = 16
const borderBottom = 1
const overscan = 3 // extra rows rendered above/below viewport
const repeatCount = 20 // repeat the corpus to reach thousands of items

// --- prepare all texts upfront (the whole point of Pretext) ---
type Item = { text: string; prepared: PreparedText }

const items: Item[] = []
for (let r = 0; r < repeatCount; r++) {
  for (let i = 0; i < rawThoughts.length; i++) {
    items.push({
      text: rawThoughts[i]!,
      prepared: prepare(rawThoughts[i]!, font),
    })
  }
}

// --- precompute all row heights from Pretext (zero DOM reads) ---
// This is the key insight: layout() is pure arithmetic on cached widths,
// so we can predict every row's pixel height before any DOM exists.
let contentWidth = 0
let rowHeights: number[] = []
let rowTops: number[] = []
let totalHeight = 0

function recomputeHeights(viewportWidth: number): void {
  contentWidth = viewportWidth
  const textWidth = contentWidth - rowPaddingX * 2

  rowHeights = new Array(items.length)
  rowTops = new Array(items.length)
  totalHeight = 0

  for (let i = 0; i < items.length; i++) {
    const { height } = layout(items[i]!.prepared, textWidth, lineHeight)
    const rowH = height + rowPaddingY * 2 + borderBottom
    rowHeights[i] = rowH
    rowTops[i] = totalHeight
    totalHeight += rowH
  }
}

// --- binary search for the first visible row ---
function findFirstVisible(scrollTop: number): number {
  let lo = 0
  let hi = items.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (rowTops[mid]! + rowHeights[mid]! <= scrollTop) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

// --- DOM ---
const viewport = document.getElementById('viewport') as HTMLDivElement
const statTotal = document.getElementById('stat-total') as HTMLElement
const statRendered = document.getElementById('stat-rendered') as HTMLElement
const statDomReads = document.getElementById('stat-dom-reads') as HTMLElement
const statHeight = document.getElementById('stat-height') as HTMLElement

const rowPool: HTMLDivElement[] = []
let activeRows = new Map<number, HTMLDivElement>()

function acquireRow(): HTMLDivElement {
  const recycled = rowPool.pop()
  if (recycled) return recycled
  const el = document.createElement('div')
  el.className = 'row'
  const idx = document.createElement('div')
  idx.className = 'row-index'
  el.appendChild(idx)
  el.appendChild(document.createElement('span'))
  viewport.appendChild(el)
  return el
}

function releaseRow(el: HTMLDivElement): void {
  el.style.display = 'none'
  rowPool.push(el)
}

statTotal.textContent = String(items.length)
statDomReads.textContent = '0'

// --- render loop ---
let scheduledRaf: number | null = null
let prevViewportWidth = 0

window.addEventListener('resize', () => scheduleRender())
window.addEventListener('scroll', () => scheduleRender(), true)
document.fonts.ready.then(() => scheduleRender())

function scheduleRender(): void {
  if (scheduledRaf != null) return
  scheduledRaf = requestAnimationFrame(() => {
    scheduledRaf = null
    render()
  })
}

function render(): void {
  const viewportWidth = viewport.clientWidth
  if (viewportWidth !== prevViewportWidth) {
    recomputeHeights(viewportWidth)
    prevViewportWidth = viewportWidth
    viewport.style.height = `${totalHeight}px`
    statHeight.textContent = `${Math.round(totalHeight)}px`
  }

  const scrollTop = window.scrollY - viewport.offsetTop
  const windowHeight = document.documentElement.clientHeight

  const viewTop = Math.max(0, scrollTop)
  const viewBottom = scrollTop + windowHeight

  const firstVisible = Math.max(0, findFirstVisible(viewTop) - overscan)
  let lastVisible = firstVisible
  while (lastVisible < items.length - 1 && rowTops[lastVisible]! < viewBottom) {
    lastVisible++
  }
  lastVisible = Math.min(items.length - 1, lastVisible + overscan)

  // recycle rows that left the visible range
  const nextActive = new Map<number, HTMLDivElement>()
  for (const [idx, el] of activeRows) {
    if (idx < firstVisible || idx > lastVisible) {
      releaseRow(el)
    } else {
      nextActive.set(idx, el)
    }
  }

  // create or reuse rows in the visible range
  for (let i = firstVisible; i <= lastVisible; i++) {
    let el = nextActive.get(i)
    if (!el) {
      el = acquireRow()
      const indexEl = el.children[0] as HTMLDivElement
      const textEl = el.children[1] as HTMLSpanElement
      indexEl.textContent = `#${i}`
      textEl.textContent = items[i]!.text
      nextActive.set(i, el)
    }
    el.style.display = ''
    el.style.top = `${rowTops[i]!}px`
    el.style.height = `${rowHeights[i]!}px`
  }

  activeRows = nextActive
  statRendered.textContent = String(nextActive.size)
}

scheduleRender()
