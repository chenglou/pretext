/*
  Editorial reflow demo: "The Waters Beyond the Reef" reading experience.

  Demonstrates:
  - Drop cap with text flowing around it via layoutNextLine() variable-width
  - Pull quote as a mid-flow obstacle, body text wraps around it
  - Real-time reflow on resize with zero DOM reads in the layout path
  - Performance timing shown live

  This demo dogfoods layoutNextLine() for all body text,
  per the project's guidance to exercise the streaming userland path.
*/

import {
  layoutNextLine,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'
import { BODY_TEXT, CHAPTER_LABEL, CHAPTER_TITLE, PULLQUOTE_TEXT } from './old-man-sea-text.ts'

// --- typography constants ---
const BODY_FONT_FAMILY = '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const BODY_FONT = `18px ${BODY_FONT_FAMILY}`
const BODY_LINE_HEIGHT = 30
const PULLQUOTE_FONT = `italic 17px ${BODY_FONT_FAMILY}`
const PULLQUOTE_LINE_HEIGHT = 24
const PULLQUOTE_ATTR_TEXT = '— Anne Morrow Lindbergh'

// --- drop cap config ---
const DROP_CAP_LINES = 3
const DROP_CAP_FONT_SCALE = 0.82 // cap-height as fraction of em; tune for the serif font
const DROP_CAP_GAP_RIGHT = 12
const DROP_CAP_Y_NUDGE = 4 // px down to visually align cap top with first-line ascender

// --- pull quote placement ---
const PULLQUOTE_AFTER_LINE = 14
const PULLQUOTE_WIDTH_RATIO = 0.40
const PULLQUOTE_GAP = 18 // gap between body text and pullquote box
const PULLQUOTE_PAD_LEFT = 16
const PULLQUOTE_PAD_RIGHT = 12
const PULLQUOTE_PAD_Y = 12

// --- dom ---
const stageEl = document.getElementById('stage')
if (!(stageEl instanceof HTMLDivElement)) throw new Error('#stage not found')
const stage: HTMLDivElement = stageEl
const perfPill = document.getElementById('perf')

// --- dom node cache ---
const dom = {
  chapterLabel: makeEl('div', 'chapter-label'),
  chapterTitle: makeEl('h1', 'chapter-title'),
  chapterRule: makeEl('div', 'chapter-rule'),
  dropCap: makeEl('div', 'drop-cap'),
  pqBox: makeEl('div', 'pullquote-box'),
  pqAttr: makeEl('div', 'pullquote-attr'),
  pqLines: [] as HTMLDivElement[],
  bodyLines: [] as HTMLDivElement[],
}

function makeEl(tag: string, className: string): HTMLDivElement {
  const el = document.createElement(tag) as HTMLDivElement
  el.className = className
  return el
}

function mountStaticNodes(): void {
  dom.chapterLabel.textContent = CHAPTER_LABEL
  dom.pqAttr.textContent = PULLQUOTE_ATTR_TEXT
  stage.append(dom.chapterLabel, dom.chapterTitle, dom.chapterRule, dom.dropCap, dom.pqBox, dom.pqAttr)
}

// --- dom pool (same pattern as other pretext demos) ---
function syncPool(pool: HTMLDivElement[], count: number, className: string, parent: HTMLElement): void {
  while (pool.length < count) {
    const el = document.createElement('div')
    el.className = className
    pool.push(el)
    parent.appendChild(el)
  }
  while (pool.length > count) {
    pool.pop()!.remove()
  }
}

// --- text preparation (cached) ---
const preparedByKey = new Map<string, PreparedTextWithSegments>()

function getPrepared(text: string, font: string): PreparedTextWithSegments {
  const key = `${font}\0${text}`
  const cached = preparedByKey.get(key)
  if (cached !== undefined) return cached
  const prepared = prepareWithSegments(text, font)
  preparedByKey.set(key, prepared)
  return prepared
}

function singleLineWidth(prepared: PreparedTextWithSegments): number {
  let w = 0
  walkLineRanges(prepared, 1e6, line => { w = line.width })
  return w
}

// --- drop cap ---
function dropCapFontSize(bodyLineHeight: number): number {
  const targetHeight = bodyLineHeight * DROP_CAP_LINES
  return Math.round(targetHeight / DROP_CAP_FONT_SCALE)
}

function dropCapWidth(fontSize: number): number {
  const char = BODY_TEXT[0]!
  const font = `700 ${fontSize}px ${BODY_FONT_FAMILY}`
  const prepared = getPrepared(char, font)
  return Math.ceil(singleLineWidth(prepared))
}

// --- pullquote layout ---
type PQLine = { text: string; width: number }

function layoutPullquote(maxWidth: number): { lines: PQLine[]; height: number } {
  const prepared = getPrepared(PULLQUOTE_TEXT, PULLQUOTE_FONT)
  const lines: PQLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  while (true) {
    const line = layoutNextLine(prepared, cursor, maxWidth)
    if (line === null) break
    lines.push({ text: line.text, width: line.width })
    cursor = line.end
  }
  return { lines, height: lines.length * PULLQUOTE_LINE_HEIGHT }
}

// --- title font fitting (binary search like dynamic-layout) ---
function fitTitleFontSize(maxWidth: number): number {
  let lo = 22
  let hi = 56
  let best = lo
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const font = `700 ${mid}px ${BODY_FONT_FAMILY}`
    if (singleLineWidth(getPrepared(CHAPTER_TITLE, font)) <= maxWidth) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

// --- frame types ---
type Line = { x: number; y: number; text: string }

type Frame = {
  label: { y: number }
  title: { y: number; font: string }
  rule: { y: number; width: number }
  dropCap: { x: number; y: number; font: string; char: string; height: number }
  body: Line[]
  pq: {
    visible: boolean
    box: { x: number; y: number; w: number; h: number }
    attr: { x: number; y: number }
    lines: Line[]
  }
  totalHeight: number
}

// --- main layout computation (pure, no DOM) ---
function computeFrame(stageWidth: number): Frame {
  // --- header ---
  const labelY = 0
  const titleGap = 8
  const titleFontSize = fitTitleFontSize(stageWidth)
  const titleFont = `700 ${titleFontSize}px ${BODY_FONT_FAMILY}`
  const titleLineHeight = Math.round(titleFontSize * 1.15)
  const titleY = labelY + 16 + titleGap

  const ruleGap = 14
  const ruleY = titleY + titleLineHeight + ruleGap

  const bodyStartY = ruleY + 1 + 22

  // --- drop cap geometry ---
  const dcFontSize = dropCapFontSize(BODY_LINE_HEIGHT)
  const dcFont = `700 ${dcFontSize}px ${BODY_FONT_FAMILY}`
  const dcWidth = dropCapWidth(dcFontSize)
  const dcHeight = BODY_LINE_HEIGHT * DROP_CAP_LINES
  const dcTotalWidth = dcWidth + DROP_CAP_GAP_RIGHT

  // --- pullquote geometry (compute eagerly, position lazily) ---
  const pqOuterW = Math.round(stageWidth * PULLQUOTE_WIDTH_RATIO)
  const pqContentW = pqOuterW - PULLQUOTE_PAD_LEFT - PULLQUOTE_PAD_RIGHT
  // Hide pullquote when stage is too narrow for it to look good
  const pqMinStageWidth = 420
  const pqLayout = pqContentW > 80 && stageWidth >= pqMinStageWidth
    ? layoutPullquote(pqContentW)
    : { lines: [], height: 0 }
  const pqBoxH = pqLayout.height + PULLQUOTE_PAD_Y * 2
  const pqAttrH = 18

  // --- line-by-line body layout ---
  const bodyAfterDC = BODY_TEXT.slice(1) // first char is the drop cap
  const preparedBody = getPrepared(bodyAfterDC, BODY_FONT)

  const bodyLines: Line[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = bodyStartY
  let lineIdx = 0

  let pqPlaced = false
  let pqY = 0
  let pqX = 0
  const pqVisible = pqContentW > 80 && stageWidth >= pqMinStageWidth

  while (true) {
    // --- place pullquote when we reach the target line ---
    if (!pqPlaced && pqVisible && lineIdx === PULLQUOTE_AFTER_LINE) {
      pqX = stageWidth - pqOuterW
      pqY = y
      pqPlaced = true
    }

    // --- compute available width for this line ---
    let lineX = 0
    let maxW = stageWidth

    // drop cap indent for first N lines
    if (lineIdx < DROP_CAP_LINES) {
      lineX = dcTotalWidth
      maxW -= dcTotalWidth
    }

    // pullquote carve-out: narrow body while line band overlaps the pq zone
    if (pqPlaced && y < pqY + pqBoxH + pqAttrH + BODY_LINE_HEIGHT) {
      const pqLeftEdge = pqX - PULLQUOTE_GAP
      const available = pqLeftEdge - lineX
      if (available > 40) {
        maxW = Math.min(maxW, available)
      }
    }

    if (maxW < 40) {
      y += BODY_LINE_HEIGHT
      lineIdx++
      if (y > 20_000) break // safety
      continue
    }

    const line = layoutNextLine(preparedBody, cursor, maxW)
    if (line === null) break

    bodyLines.push({ x: Math.round(lineX), y: Math.round(y), text: line.text })
    cursor = line.end
    y += BODY_LINE_HEIGHT
    lineIdx++
  }

  // --- pullquote positioned lines ---
  const pqLines: Line[] = []
  if (pqPlaced) {
    for (let i = 0; i < pqLayout.lines.length; i++) {
      pqLines.push({
        x: Math.round(pqX + PULLQUOTE_PAD_LEFT),
        y: Math.round(pqY + PULLQUOTE_PAD_Y + i * PULLQUOTE_LINE_HEIGHT),
        text: pqLayout.lines[i]!.text,
      })
    }
  }

  return {
    label: { y: labelY },
    title: { y: titleY, font: titleFont },
    rule: { y: ruleY, width: stageWidth },
    dropCap: { x: 0, y: bodyStartY + DROP_CAP_Y_NUDGE, font: dcFont, char: BODY_TEXT[0]!, height: dcHeight },
    body: bodyLines,
    pq: {
      visible: pqPlaced,
      box: { x: pqX, y: pqY, w: pqOuterW, h: pqBoxH },
      attr: { x: pqX + PULLQUOTE_PAD_LEFT, y: pqY + pqBoxH + 4 },
      lines: pqLines,
    },
    totalHeight: y + 48,
  }
}

// --- project frame to DOM ---
function projectFrame(f: Frame): void {
  // header
  dom.chapterLabel.style.top = `${f.label.y}px`
  dom.chapterTitle.textContent = CHAPTER_TITLE
  dom.chapterTitle.style.top = `${f.title.y}px`
  dom.chapterTitle.style.font = f.title.font
  dom.chapterRule.style.top = `${f.rule.y}px`
  dom.chapterRule.style.width = `${f.rule.width}px`

  // drop cap
  dom.dropCap.textContent = f.dropCap.char
  dom.dropCap.style.left = `${f.dropCap.x}px`
  dom.dropCap.style.top = `${f.dropCap.y}px`
  dom.dropCap.style.font = f.dropCap.font
  dom.dropCap.style.lineHeight = `${f.dropCap.height}px`

  // pullquote
  if (f.pq.visible) {
    dom.pqBox.style.display = ''
    dom.pqBox.style.left = `${f.pq.box.x}px`
    dom.pqBox.style.top = `${f.pq.box.y}px`
    dom.pqBox.style.width = `${f.pq.box.w}px`
    dom.pqBox.style.height = `${f.pq.box.h}px`
    dom.pqAttr.style.display = ''
    dom.pqAttr.style.left = `${f.pq.attr.x}px`
    dom.pqAttr.style.top = `${f.pq.attr.y}px`
  } else {
    dom.pqBox.style.display = 'none'
    dom.pqAttr.style.display = 'none'
  }

  syncPool(dom.pqLines, f.pq.lines.length, 'pullquote-line', stage)
  for (let i = 0; i < f.pq.lines.length; i++) {
    const l = f.pq.lines[i]!
    const el = dom.pqLines[i]!
    el.textContent = l.text
    el.style.left = `${l.x}px`
    el.style.top = `${l.y}px`
    el.style.font = PULLQUOTE_FONT
    el.style.lineHeight = `${PULLQUOTE_LINE_HEIGHT}px`
  }

  // body lines
  syncPool(dom.bodyLines, f.body.length, 'body-line', stage)
  for (let i = 0; i < f.body.length; i++) {
    const l = f.body[i]!
    const el = dom.bodyLines[i]!
    el.textContent = l.text
    el.style.left = `${l.x}px`
    el.style.top = `${l.y}px`
    el.style.font = BODY_FONT
    el.style.lineHeight = `${BODY_LINE_HEIGHT}px`
  }

  stage.style.height = `${f.totalHeight}px`
}

// --- render loop ---
let raf: number | null = null

function scheduleRender(): void {
  if (raf !== null) return
  raf = requestAnimationFrame(() => {
    raf = null
    render()
  })
}

function render(): void {
  const w = stage.clientWidth

  const t0 = performance.now()
  const frame = computeFrame(w)
  const t1 = performance.now()

  projectFrame(frame)

  if (perfPill instanceof HTMLElement) {
    perfPill.textContent = `reflow ${(t1 - t0).toFixed(2)}ms · ${frame.body.length} lines`
  }
}

// --- boot ---
mountStaticNodes()
await document.fonts.ready
render()
window.addEventListener('resize', scheduleRender)
