/*
This page's made to show off our layout APIs:
- Title lines are measured and placed by our own layout engine, not inferred from DOM flow.
- Title font size is fit using repeated API calls so whole words survive.
- The title itself now participates in obstacle routing against the OpenAI logo.
- The author line is placed from the measured title result, and it also respects the OpenAI geometry.
- The body is one continuous text stream, not two unrelated excerpts.
- The left column consumes text first, and the right column resumes from the same cursor.
- The right column routes around:
  - the actual title geometry
  - the Anthropic/Claude logo hull
  - the OpenAI logo when it intrudes
- The left column routes around the OpenAI logo hull.
- The logo contours are derived once from rasterized SVG alpha, cached, then transformed per render.
- Hover/click hit testing uses transformed logo hulls too.
- Clicking a logo rotates it, and the text reflows live around the rotated geometry.
- Obstacle exclusion is based on the full line band, not a single y sample.
- The page is a fixed-height viewport-bound spread:
  - vertical resize changes reflow
  - overflow after the second column truncates
- The first visible render now waits for both fonts and hull preload, so it uses the real geometry from the start.
- There is no DOM text measurement loop feeding layout.
*/
import { layoutNextLine, prepareWithSegments, walkLineRanges, type LayoutCursor, type PreparedTextWithSegments } from '../../src/layout.ts'
import { BODY_COPY } from './dynamic-layout-text.ts'
import openaiLogoUrl from '../assets/openai-symbol.svg'
import claudeLogoUrl from '../assets/claude-symbol.svg'
import {
  carveTextLineSlots,
  getPolygonIntervalForBand,
  getRectIntervalsForBand,
  getWrapHull,
  isPointInPolygon,
  transformWrapPoints,
  type Interval,
  type Point,
  type Rect,
} from './wrap-geometry.ts'

const BODY_FONT = '20px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const BODY_LINE_HEIGHT = 32
const CREDIT_TEXT = 'Leopold Aschenbrenner'
const CREDIT_FONT = '12px "Helvetica Neue", Helvetica, Arial, sans-serif'
const CREDIT_LINE_HEIGHT = 16
const HEADLINE_TEXT = 'SITUATIONAL AWARENESS: THE DECADE AHEAD'
const HEADLINE_FONT_FAMILY = '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const HINT_PILL_SAFE_TOP = 72
const NARROW_BREAKPOINT = 760
const NARROW_COLUMN_MAX_WIDTH = 430

function resolveImportedAssetUrl(assetUrl: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(assetUrl) || assetUrl.startsWith('data:') || assetUrl.startsWith('blob:')) {
    return assetUrl
  }
  if (assetUrl.startsWith('/')) {
    return new URL(assetUrl, window.location.origin).href
  }
  return new URL(assetUrl, import.meta.url).href
}

const OPENAI_LOGO_SRC = resolveImportedAssetUrl(openaiLogoUrl)
const CLAUDE_LOGO_SRC = resolveImportedAssetUrl(claudeLogoUrl)

type LogoKind = 'openai' | 'claude'
type SpinState = {
  from: number
  to: number
  start: number
  duration: number
}
type LogoAnimationState = {
  angle: number
  spin: SpinState | null
}

type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
}

type ProjectedBodyLine = PositionedLine & {
  className: string
}

type TextProjection = {
  pageWidth: number
  pageHeight: number
  headlineFont: string
  headlineLineHeight: number
  headlineLines: PositionedLine[]
  creditLeft: number
  creditTop: number
  bodyFont: string
  bodyLineHeight: number
  bodyLines: ProjectedBodyLine[]
}

type BandObstacle =
  | {
      kind: 'polygon'
      points: Point[]
      horizontalPadding: number
      verticalPadding: number
    }
  | {
      kind: 'rects'
      rects: Rect[]
      horizontalPadding: number
      verticalPadding: number
    }

type PageLayout = {
  isNarrow: boolean
  gutter: number
  pageWidth: number
  pageHeight: number
  centerGap: number
  columnWidth: number
  headlineRegion: Rect
  headlineFont: string
  headlineLineHeight: number
  creditGap: number
  copyGap: number
  openaiRect: Rect
  claudeRect: Rect
}

type LogoHits = { openai: Point[]; claude: Point[] }
type WrapHulls = {
  openaiLayout: Point[]
  claudeLayout: Point[]
  openaiHit: Point[]
  claudeHit: Point[]
}

const stageNode = document.getElementById('stage')
if (!(stageNode instanceof HTMLDivElement)) throw new Error('#stage not found')
const stage = stageNode
const pageNode = document.querySelector('.page')
if (!(pageNode instanceof HTMLElement)) throw new Error('.page not found')

type DomCache = {
  page: HTMLElement // cache lifetime: page
  headline: HTMLHeadingElement // cache lifetime: page
  credit: HTMLParagraphElement // cache lifetime: page
  openaiLogo: HTMLImageElement // cache lifetime: page
  claudeLogo: HTMLImageElement // cache lifetime: page
  headlineLines: HTMLSpanElement[] // cache lifetime: headline line count
  bodyLines: HTMLSpanElement[] // cache lifetime: visible line count
}

const preparedByKey = new Map<string, PreparedTextWithSegments>()
const scheduled = { value: false }
const events: { mousemove: MouseEvent | null; click: MouseEvent | null; blur: boolean } = {
  mousemove: null,
  click: null,
  blur: false,
}
const pointer = { x: -Infinity, y: -Infinity }
let currentLogoHits!: LogoHits
let hoveredLogo: LogoKind | null = null
let committedTextProjection: TextProjection | null = null
const logoAnimations: { openai: LogoAnimationState; claude: LogoAnimationState } = {
  openai: { angle: 0, spin: null },
  claude: { angle: 0, spin: null },
}

const domCache: DomCache = {
  page: pageNode,
  headline: createHeadline(),
  credit: createCredit(),
  openaiLogo: createLogo('logo logo--openai', 'OpenAI symbol', OPENAI_LOGO_SRC),
  claudeLogo: createLogo('logo logo--claude', 'Claude symbol', CLAUDE_LOGO_SRC),
  headlineLines: [],
  bodyLines: [],
}

function createHeadline(): HTMLHeadingElement {
  const element = document.createElement('h1')
  element.className = 'headline'
  return element
}

function createCredit(): HTMLParagraphElement {
  const element = document.createElement('p')
  element.className = 'credit'
  element.textContent = CREDIT_TEXT
  return element
}

function createLogo(className: string, alt: string, src: string): HTMLImageElement {
  const element = document.createElement('img')
  element.className = className
  element.alt = alt
  element.src = src
  element.draggable = false
  return element
}

function mountStaticNodes(): void {
  stage.append(
    domCache.headline,
    domCache.credit,
    domCache.openaiLogo,
    domCache.claudeLogo,
  )
}

const [, openaiLayout, claudeLayout, openaiHit, claudeHit] = await Promise.all([
  document.fonts.ready,
  getWrapHull(OPENAI_LOGO_SRC, { smoothRadius: 6, mode: 'mean' }),
  getWrapHull(CLAUDE_LOGO_SRC, { smoothRadius: 6, mode: 'mean' }),
  getWrapHull(OPENAI_LOGO_SRC, { smoothRadius: 3, mode: 'mean' }),
  getWrapHull(CLAUDE_LOGO_SRC, { smoothRadius: 5, mode: 'mean' }),
])
const wrapHulls: WrapHulls = { openaiLayout, claudeLayout, openaiHit, claudeHit }
const preparedBody = getPrepared(BODY_COPY, BODY_FONT)
const preparedCredit = getPrepared(CREDIT_TEXT, CREDIT_FONT)
const creditWidth = Math.ceil(getPreparedSingleLineWidth(preparedCredit))

function getTypography(): { font: string, lineHeight: number } {
  return { font: BODY_FONT, lineHeight: BODY_LINE_HEIGHT }
}

function getPrepared(text: string, font: string): PreparedTextWithSegments {
  const key = `${font}::${text}`
  const cached = preparedByKey.get(key)
  if (cached !== undefined) return cached
  const prepared = prepareWithSegments(text, font)
  preparedByKey.set(key, prepared)
  return prepared
}

function getPreparedSingleLineWidth(prepared: PreparedTextWithSegments): number {
  let width = 0
  walkLineRanges(prepared, 100_000, line => {
    width = line.width
  })
  return width
}

function headlineBreaksInsideWord(prepared: PreparedTextWithSegments, maxWidth: number): boolean {
  let breaksInsideWord = false
  walkLineRanges(prepared, maxWidth, line => {
    if (line.end.graphemeIndex !== 0) breaksInsideWord = true
  })
  return breaksInsideWord
}

function getObstacleIntervals(obstacle: BandObstacle, bandTop: number, bandBottom: number): Interval[] {
  switch (obstacle.kind) {
    case 'polygon': {
      const interval = getPolygonIntervalForBand(
        obstacle.points,
        bandTop,
        bandBottom,
        obstacle.horizontalPadding,
        obstacle.verticalPadding,
      )
      return interval === null ? [] : [interval]
    }
    case 'rects':
      return getRectIntervalsForBand(
        obstacle.rects,
        bandTop,
        bandBottom,
        obstacle.horizontalPadding,
        obstacle.verticalPadding,
      )
  }
}

function layoutColumn(
  prepared: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  region: Rect,
  lineHeight: number,
  obstacles: BandObstacle[],
  side: 'left' | 'right',
): { lines: PositionedLine[], cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor
  let lineTop = region.y
  const lines: PositionedLine[] = []
  while (true) {
    if (lineTop + lineHeight > region.y + region.height) break

    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    const blocked: Interval[] = []
    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
      const obstacle = obstacles[obstacleIndex]!
      const intervals = getObstacleIntervals(obstacle, bandTop, bandBottom)
      for (let intervalIndex = 0; intervalIndex < intervals.length; intervalIndex++) {
        blocked.push(intervals[intervalIndex]!)
      }
    }

    const slots = carveTextLineSlots(
      { left: region.x, right: region.x + region.width },
      blocked,
    )
    if (slots.length === 0) {
      lineTop += lineHeight
      continue
    }

    let slot = slots[0]!
    for (let slotIndex = 1; slotIndex < slots.length; slotIndex++) {
      const candidate = slots[slotIndex]!
      const bestWidth = slot.right - slot.left
      const candidateWidth = candidate.right - candidate.left
      if (candidateWidth > bestWidth) {
        slot = candidate
        continue
      }
      if (candidateWidth < bestWidth) continue
      if (side === 'left') {
        if (candidate.left > slot.left) slot = candidate
        continue
      }
      if (candidate.left < slot.left) slot = candidate
    }
    const width = slot.right - slot.left
    const line = layoutNextLine(prepared, cursor, width)
    if (line === null) break

    lines.push({
      x: Math.round(slot.left),
      y: Math.round(lineTop),
      width: line.width,
      text: line.text,
    })

    cursor = line.end
    lineTop += lineHeight
  }

  return { lines, cursor }
}

function syncPool<T extends HTMLElement>(pool: T[], length: number, create: () => T, parent: HTMLElement = stage): void {
  while (pool.length < length) {
    const element = create()
    pool.push(element)
    parent.appendChild(element)
  }
  while (pool.length > length) {
    const element = pool.pop()!
    element.remove()
  }
}

function projectHeadlineLines(lines: PositionedLine[], font: string, lineHeight: number): void {
  syncPool(domCache.headlineLines, lines.length, () => {
    const element = document.createElement('span')
    element.className = 'headline-line'
    return element
  }, domCache.headline)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const element = domCache.headlineLines[index]!
    element.textContent = line.text
    element.style.left = `${line.x}px`
    element.style.top = `${line.y}px`
    element.style.font = font
    element.style.lineHeight = `${lineHeight}px`
  }
}

function projectChromeLayout(layout: PageLayout, contentHeight: number): void {
  domCache.page.className = layout.isNarrow ? 'page page--mobile' : 'page'
  stage.style.height = `${contentHeight}px`

  domCache.openaiLogo.style.left = `${layout.openaiRect.x}px`
  domCache.openaiLogo.style.top = `${layout.openaiRect.y}px`
  domCache.openaiLogo.style.width = `${layout.openaiRect.width}px`
  domCache.openaiLogo.style.height = `${layout.openaiRect.height}px`
  domCache.openaiLogo.style.transform = `rotate(${logoAnimations.openai.angle}rad)`

  domCache.claudeLogo.style.left = `${layout.claudeRect.x}px`
  domCache.claudeLogo.style.top = `${layout.claudeRect.y}px`
  domCache.claudeLogo.style.width = `${layout.claudeRect.width}px`
  domCache.claudeLogo.style.height = `${layout.claudeRect.height}px`
  domCache.claudeLogo.style.transform = `rotate(${logoAnimations.claude.angle}rad)`
}

function positionedLinesEqual(a: PositionedLine[], b: PositionedLine[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!
    const right = b[index]!
    if (
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.text !== right.text
    ) {
      return false
    }
  }
  return true
}

function projectedBodyLinesEqual(a: ProjectedBodyLine[], b: ProjectedBodyLine[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!
    const right = b[index]!
    if (
      left.className !== right.className ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.text !== right.text
    ) {
      return false
    }
  }
  return true
}

function textProjectionEqual(a: TextProjection | null, b: TextProjection): boolean {
  return a !== null &&
    a.pageWidth === b.pageWidth &&
    a.pageHeight === b.pageHeight &&
    a.headlineFont === b.headlineFont &&
    a.headlineLineHeight === b.headlineLineHeight &&
    a.creditLeft === b.creditLeft &&
    a.creditTop === b.creditTop &&
    a.bodyFont === b.bodyFont &&
    a.bodyLineHeight === b.bodyLineHeight &&
    positionedLinesEqual(a.headlineLines, b.headlineLines) &&
    projectedBodyLinesEqual(a.bodyLines, b.bodyLines)
}

function projectTextProjection(projection: TextProjection): void {
  domCache.headline.style.left = '0px'
  domCache.headline.style.top = '0px'
  domCache.headline.style.width = `${projection.pageWidth}px`
  domCache.headline.style.height = `${projection.pageHeight}px`
  domCache.headline.style.font = projection.headlineFont
  domCache.headline.style.lineHeight = `${projection.headlineLineHeight}px`
  domCache.headline.style.letterSpacing = '0px'

  projectHeadlineLines(projection.headlineLines, projection.headlineFont, projection.headlineLineHeight)

  domCache.credit.style.left = `${projection.creditLeft}px`
  domCache.credit.style.top = `${projection.creditTop}px`
  domCache.credit.style.width = 'auto'
  domCache.credit.style.font = CREDIT_FONT
  domCache.credit.style.lineHeight = `${CREDIT_LINE_HEIGHT}px`

  syncPool(domCache.bodyLines, projection.bodyLines.length, () => {
    const element = document.createElement('span')
    element.className = 'line'
    return element
  })
  for (let index = 0; index < projection.bodyLines.length; index++) {
    const line = projection.bodyLines[index]!
    const element = domCache.bodyLines[index]!
    element.className = line.className
    element.textContent = line.text
    element.style.left = `${line.x}px`
    element.style.top = `${line.y}px`
    element.style.font = projection.bodyFont
    element.style.lineHeight = `${projection.bodyLineHeight}px`
  }
}

function fitHeadlineFontSize(headlineWidth: number, pageWidth: number): number {
  let low = Math.ceil(Math.max(22, pageWidth * 0.026))
  let high = Math.floor(Math.min(94.4, Math.max(55.2, pageWidth * 0.055)))
  let best = low

  while (low <= high) {
    const size = Math.floor((low + high) / 2)
    const font = `700 ${size}px ${HEADLINE_FONT_FAMILY}`
    const headlinePrepared = getPrepared(HEADLINE_TEXT, font)
    if (!headlineBreaksInsideWord(headlinePrepared, headlineWidth)) {
      best = size
      low = size + 1
    } else {
      high = size - 1
    }
  }

  return best
}

function easeSpin(t: number): number {
  const oneMinusT = 1 - t
  return 1 - oneMinusT * oneMinusT * oneMinusT
}

function getLogoAnimation(kind: LogoKind): LogoAnimationState {
  switch (kind) {
    case 'openai':
      return logoAnimations.openai
    case 'claude':
      return logoAnimations.claude
  }
}

function updateLogoSpin(logo: LogoAnimationState, now: number): boolean {
  if (logo.spin === null) return false

  const progress = Math.min(1, (now - logo.spin.start) / logo.spin.duration)
  logo.angle = logo.spin.from + (logo.spin.to - logo.spin.from) * easeSpin(progress)
  if (progress >= 1) {
    logo.angle = logo.spin.to
    logo.spin = null
    return false
  }
  return true
}

function updateSpinState(now: number): boolean {
  const openaiAnimating = updateLogoSpin(logoAnimations.openai, now)
  const claudeAnimating = updateLogoSpin(logoAnimations.claude, now)
  return openaiAnimating || claudeAnimating
}

function startLogoSpin(kind: LogoKind, direction: 1 | -1, now: number): void {
  const logo = getLogoAnimation(kind)
  const delta = direction * Math.PI
  logo.spin = {
    from: logo.angle,
    to: logo.angle + delta,
    start: now,
    duration: 900,
  }
}

function getLogoProjection(layout: PageLayout, lineHeight: number): {
  openaiObstacle: BandObstacle
  claudeObstacle: BandObstacle
  hits: LogoHits
} {
  const openaiWrap = transformWrapPoints(wrapHulls.openaiLayout, layout.openaiRect, logoAnimations.openai.angle)
  const claudeWrap = transformWrapPoints(wrapHulls.claudeLayout, layout.claudeRect, logoAnimations.claude.angle)
  return {
    openaiObstacle: {
      kind: 'polygon',
      points: openaiWrap,
      horizontalPadding: Math.round(lineHeight * 0.82),
      verticalPadding: Math.round(lineHeight * 0.26),
    },
    claudeObstacle: {
      kind: 'polygon',
      points: claudeWrap,
      horizontalPadding: Math.round(lineHeight * 0.28),
      verticalPadding: Math.round(lineHeight * 0.12),
    },
    hits: {
      openai: transformWrapPoints(wrapHulls.openaiHit, layout.openaiRect, logoAnimations.openai.angle),
      claude: transformWrapPoints(wrapHulls.claudeHit, layout.claudeRect, logoAnimations.claude.angle),
    },
  }
}

function buildLayout(pageWidth: number, pageHeight: number, lineHeight: number): PageLayout {
  const isNarrow = pageWidth < NARROW_BREAKPOINT
  if (isNarrow) {
    const gutter = Math.round(Math.max(18, Math.min(28, pageWidth * 0.06)))
    const centerGap = 0
    const columnWidth = Math.round(Math.min(pageWidth - gutter * 2, NARROW_COLUMN_MAX_WIDTH))
    const headlineTop = 28
    const headlineWidth = pageWidth - gutter * 2
    const headlineFontSize = Math.min(48, fitHeadlineFontSize(headlineWidth, pageWidth))
    const headlineLineHeight = Math.round(headlineFontSize * 0.92)
    const headlineFont = `700 ${headlineFontSize}px ${HEADLINE_FONT_FAMILY}`
    const creditGap = Math.round(Math.max(12, lineHeight * 0.5))
    const copyGap = Math.round(Math.max(18, lineHeight * 0.7))
    const claudeSize = Math.round(Math.min(92, pageWidth * 0.23, pageHeight * 0.11))
    const openaiSize = Math.round(Math.min(138, pageWidth * 0.34))
    const headlineRegion: Rect = {
      x: gutter,
      y: headlineTop,
      width: headlineWidth,
      height: Math.max(320, pageHeight - headlineTop - gutter),
    }
    const openaiRect: Rect = {
      x: gutter - Math.round(openaiSize * 0.22),
      y: pageHeight - gutter - openaiSize + Math.round(openaiSize * 0.08),
      width: openaiSize,
      height: openaiSize,
    }
    const claudeRect: Rect = {
      x: pageWidth - gutter - Math.round(claudeSize * 0.88),
      y: 4,
      width: claudeSize,
      height: claudeSize,
    }

    return {
      isNarrow,
      gutter,
      pageWidth,
      pageHeight,
      centerGap,
      columnWidth,
      headlineRegion,
      headlineFont,
      headlineLineHeight,
      creditGap,
      copyGap,
      openaiRect,
      claudeRect,
    }
  }

  const gutter = Math.round(Math.max(52, pageWidth * 0.048))
  const centerGap = Math.round(Math.max(28, pageWidth * 0.025))
  const columnWidth = Math.round((pageWidth - gutter * 2 - centerGap) / 2)

  const headlineTop = Math.round(Math.max(42, pageWidth * 0.04, HINT_PILL_SAFE_TOP))
  const headlineWidth = Math.round(Math.min(pageWidth - gutter * 2, Math.max(columnWidth, pageWidth * 0.5)))
  const headlineFontSize = fitHeadlineFontSize(headlineWidth, pageWidth)
  const headlineLineHeight = Math.round(headlineFontSize * 0.92)
  const headlineFont = `700 ${headlineFontSize}px ${HEADLINE_FONT_FAMILY}`
  const creditGap = Math.round(Math.max(14, lineHeight * 0.6))
  const copyGap = Math.round(Math.max(20, lineHeight * 0.9))
  const openaiShrinkT = Math.max(0, Math.min(1, (960 - pageWidth) / 260))
  const OPENAI_SIZE = 400 - openaiShrinkT * 56
  const openaiSize = Math.round(Math.min(OPENAI_SIZE, pageHeight * 0.43))
  const claudeSize = Math.round(Math.max(276, Math.min(500, pageWidth * 0.355, pageHeight * 0.45)))
  const headlineRegion: Rect = {
    x: gutter,
    y: headlineTop,
    width: headlineWidth,
    height: pageHeight - headlineTop - gutter,
  }

  const openaiRect: Rect = {
    x: gutter - Math.round(openaiSize * 0.3),
    y: pageHeight - gutter - openaiSize + Math.round(openaiSize * 0.2),
    width: openaiSize,
    height: openaiSize,
  }

  const claudeRect: Rect = {
    x: pageWidth - Math.round(claudeSize * 0.69),
    y: -Math.round(claudeSize * 0.22),
    width: claudeSize,
    height: claudeSize,
  }

  return {
    isNarrow,
    gutter,
    pageWidth,
    pageHeight,
    centerGap,
    columnWidth,
    headlineRegion,
    headlineFont,
    headlineLineHeight,
    creditGap,
    copyGap,
    openaiRect,
    claudeRect,
  }
}

function evaluateLayout(
  layout: PageLayout,
  lineHeight: number,
  preparedBody: PreparedTextWithSegments,
): {
  headlineLines: PositionedLine[]
  creditLeft: number
  creditTop: number
  leftLines: PositionedLine[]
  rightLines: PositionedLine[]
  contentHeight: number
  hits: LogoHits
} {
  const { openaiObstacle, claudeObstacle, hits } = getLogoProjection(layout, lineHeight)

  const headlinePrepared = getPrepared(HEADLINE_TEXT, layout.headlineFont)
  const headlineResult = layoutColumn(
    headlinePrepared,
    { segmentIndex: 0, graphemeIndex: 0 },
    layout.headlineRegion,
    layout.headlineLineHeight,
    [openaiObstacle],
    'left',
  )
  const headlineLines = headlineResult.lines
  const headlineRects = headlineLines.map(line => ({
      x: line.x,
      y: line.y,
      width: Math.ceil(line.width),
      height: layout.headlineLineHeight,
    }))
  const headlineBottom = headlineLines.length === 0
    ? layout.headlineRegion.y
    : Math.max(...headlineLines.map(line => line.y + layout.headlineLineHeight))
  const creditTop = headlineBottom + layout.creditGap
  const creditRegion: Rect = {
    x: layout.gutter + 4,
    y: creditTop,
    width: layout.headlineRegion.width,
    height: CREDIT_LINE_HEIGHT,
  }
  const copyTop = creditTop + CREDIT_LINE_HEIGHT + layout.copyGap
  const leftRegion: Rect = {
    x: layout.gutter,
    y: copyTop,
    width: layout.columnWidth,
    height: layout.pageHeight - copyTop - layout.gutter,
  }
  const rightRegion: Rect = {
    x: layout.gutter + layout.columnWidth + layout.centerGap,
    y: layout.headlineRegion.y,
    width: layout.columnWidth,
    height: layout.pageHeight - layout.headlineRegion.y - layout.gutter,
  }
  const titleObstacle: BandObstacle = {
    kind: 'rects',
    rects: headlineRects,
    horizontalPadding: Math.round(lineHeight * 0.95),
    verticalPadding: Math.round(lineHeight * 0.3),
  }

  const creditBlocked = getObstacleIntervals(
    openaiObstacle,
    creditRegion.y,
    creditRegion.y + creditRegion.height,
  )
  const claudeCreditBlocked = getObstacleIntervals(
    claudeObstacle,
    creditRegion.y,
    creditRegion.y + creditRegion.height,
  )
  const creditSlots = carveTextLineSlots(
    {
      left: creditRegion.x,
      right: creditRegion.x + creditRegion.width,
    },
    layout.isNarrow ? creditBlocked.concat(claudeCreditBlocked) : creditBlocked,
  )
  let creditLeft = creditRegion.x
  for (let index = 0; index < creditSlots.length; index++) {
    const slot = creditSlots[index]!
    if (slot.right - slot.left >= creditWidth) {
      creditLeft = Math.round(slot.left)
      break
    }
  }

  if (layout.isNarrow) {
    const bodyRegion: Rect = {
      x: Math.round((layout.pageWidth - layout.columnWidth) / 2),
      y: copyTop,
      width: layout.columnWidth,
      height: Math.max(0, layout.pageHeight - copyTop - layout.gutter),
    }

    const bodyResult = layoutColumn(
      preparedBody,
      { segmentIndex: 0, graphemeIndex: 0 },
      bodyRegion,
      lineHeight,
      [claudeObstacle, openaiObstacle],
      'left',
    )

    return {
      headlineLines,
      creditLeft,
      creditTop,
      leftLines: bodyResult.lines,
      rightLines: [],
      contentHeight: layout.pageHeight,
      hits,
    }
  }

  const leftResult = layoutColumn(
    preparedBody,
    { segmentIndex: 0, graphemeIndex: 0 },
    leftRegion,
    lineHeight,
    [openaiObstacle],
    'left',
  )

  const rightResult = layoutColumn(
    preparedBody,
    leftResult.cursor,
    rightRegion,
    lineHeight,
    [titleObstacle, claudeObstacle, openaiObstacle],
    'right',
  )

  return {
    headlineLines,
    creditLeft,
    creditTop,
    leftLines: leftResult.lines,
    rightLines: rightResult.lines,
    contentHeight: layout.pageHeight,
    hits,
  }
}

function commitFrame(now: number): boolean {
  const { font, lineHeight } = getTypography()
  const root = document.documentElement
  const pageWidth = root.clientWidth
  const pageHeight = root.clientHeight
  const animating = updateSpinState(now)
  const layout = buildLayout(pageWidth, pageHeight, lineHeight)
  const { headlineLines, creditLeft, creditTop, leftLines, rightLines, contentHeight, hits } = evaluateLayout(layout, lineHeight, preparedBody)

  currentLogoHits = hits

  projectChromeLayout(layout, contentHeight)

  const bodyLines: ProjectedBodyLine[] = [
    ...leftLines.map(line => ({ ...line, className: 'line line--left' })),
    ...rightLines.map(line => ({ ...line, className: 'line line--right' })),
  ]
  const textProjection: TextProjection = {
    pageWidth: layout.pageWidth,
    pageHeight: layout.pageHeight,
    headlineFont: layout.headlineFont,
    headlineLineHeight: layout.headlineLineHeight,
    headlineLines,
    creditLeft,
    creditTop,
    bodyFont: font,
    bodyLineHeight: lineHeight,
    bodyLines,
  }

  if (!textProjectionEqual(committedTextProjection, textProjection)) {
    projectTextProjection(textProjection)
    committedTextProjection = textProjection
  }

  document.body.style.cursor = hoveredLogo === null ? '' : 'pointer'

  return animating
}

function render(now: number): boolean {
  // === handle inputs against the previous committed hit geometry
  if (events.click !== null) {
    pointer.x = events.click.clientX
    pointer.y = events.click.clientY
  }
  if (events.mousemove !== null) {
    pointer.x = events.mousemove.clientX
    pointer.y = events.mousemove.clientY
  }

  const nextHovered =
    events.blur
      ? null
      : isPointInPolygon(currentLogoHits.openai, pointer.x, pointer.y)
        ? 'openai'
        : isPointInPolygon(currentLogoHits.claude, pointer.x, pointer.y)
          ? 'claude'
          : null
  hoveredLogo = nextHovered

  if (events.click !== null) {
    if (isPointInPolygon(currentLogoHits.openai, pointer.x, pointer.y)) {
      startLogoSpin('openai', -1, now)
    } else if (isPointInPolygon(currentLogoHits.claude, pointer.x, pointer.y)) {
      startLogoSpin('claude', 1, now)
    }
  }

  // === commit state
  events.mousemove = null
  events.click = null
  events.blur = false

  return commitFrame(now)
}

function scheduleRender(): void {
  if (scheduled.value) return
  scheduled.value = true
  requestAnimationFrame(function renderAndMaybeScheduleAnotherRender(now) {
    scheduled.value = false
    if (render(now)) scheduleRender()
  })
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.rangeCount > 0
}

window.addEventListener('resize', scheduleRender)
pageNode.addEventListener('touchmove', event => {
  if (hasActiveTextSelection()) return
  event.preventDefault()
}, { passive: false })
document.addEventListener('mousemove', event => {
  events.mousemove = event
  scheduleRender()
})
window.addEventListener('blur', () => {
  events.blur = true
  scheduleRender()
})
document.addEventListener('click', event => {
  events.click = event
  scheduleRender()
})

mountStaticNodes()
commitFrame(performance.now())
