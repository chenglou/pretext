import {
  measureNaturalWidth,
  prepareWithSegments,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from './layout.js'
import {
  buildLineTextFromRange,
  getLineTextCache,
} from './line-text.js'
import {
  type LineBreakCursor,
  stepPreparedLineGeometry,
} from './line-break.js'

// Helper for rich-text inline flow under `white-space: normal`.
// It keeps the core layout API low-level while taking over the boring shared
// work that rich inline demos kept reimplementing in userland:
// - collapsed boundary whitespace across item boundaries
// - atomic inline boxes like pills
// - per-item extra horizontal chrome such as padding/borders

declare const preparedRichInlineBrand: unique symbol

export type RichInlineItem = {
  text: string // Raw author text, including any leading/trailing collapsible spaces
  font: string // Canvas font shorthand used to prepare and measure this item
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a pill or mention chip
  extraWidth?: number // Caller-owned horizontal chrome, e.g. padding + border width
}

export type PreparedRichInline = {
  readonly [preparedRichInlineBrand]: true
}

export type RichInlineCursor = {
  itemIndex: number
  segmentIndex: number
  graphemeIndex: number
}

export type RichInlineFragment = {
  itemIndex: number // Index into the original RichInlineItem array
  text: string // Text slice for this fragment
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}

export type RichInlineFragmentRange = {
  itemIndex: number // Index into the original RichInlineItem array
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}

export type RichInlineLine = {
  fragments: RichInlineFragment[]
  width: number
  end: RichInlineCursor
}

export type RichInlineLineRange = {
  fragments: RichInlineFragmentRange[]
  width: number
  end: RichInlineCursor
}

export type RichInlineStats = {
  lineCount: number
  maxLineWidth: number
}

type InternalPreparedRichInline = PreparedRichInline & {
  items: PreparedRichInlineItem[]
  itemsBySourceItemIndex: Array<PreparedRichInlineItem | undefined>
}

type PreparedRichInlineItem = {
  break: 'normal' | 'never'
  endGraphemeIndex: number
  endSegmentIndex: number
  extraWidth: number
  gapBefore: number
  naturalWidth: number
  prepared: PreparedTextWithSegments
  sourceItemIndex: number
}

const COLLAPSIBLE_BOUNDARY_RE = /[ \t\n\f\r]+/
const LEADING_COLLAPSIBLE_BOUNDARY_RE = /^[ \t\n\f\r]+/
const TRAILING_COLLAPSIBLE_BOUNDARY_RE = /[ \t\n\f\r]+$/
const EMPTY_LAYOUT_CURSOR: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
const RICH_INLINE_START_CURSOR: RichInlineCursor = {
  itemIndex: 0,
  segmentIndex: 0,
  graphemeIndex: 0,
}

function getInternalPreparedRichInline(prepared: PreparedRichInline): InternalPreparedRichInline {
  return prepared as InternalPreparedRichInline
}

function cloneCursor(cursor: LayoutCursor): LayoutCursor {
  return {
    segmentIndex: cursor.segmentIndex,
    graphemeIndex: cursor.graphemeIndex,
  }
}

function isLineStartCursor(cursor: LayoutCursor): boolean {
  return cursor.segmentIndex === 0 && cursor.graphemeIndex === 0
}

function getCollapsedSpaceWidth(font: string, cache: Map<string, number>): number {
  const cached = cache.get(font)
  if (cached !== undefined) return cached

  const joinedWidth = measureNaturalWidth(prepareWithSegments('A A', font))
  const compactWidth = measureNaturalWidth(prepareWithSegments('AA', font))
  const collapsedWidth = Math.max(0, joinedWidth - compactWidth)
  cache.set(font, collapsedWidth)
  return collapsedWidth
}

function prepareWholeItemLine(prepared: PreparedTextWithSegments): {
  endGraphemeIndex: number
  endSegmentIndex: number
  width: number
} | null {
  const end: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
  const width = stepPreparedLineGeometry(prepared, end, Number.POSITIVE_INFINITY)
  if (width === null) return null
  return {
    endGraphemeIndex: end.graphemeIndex,
    endSegmentIndex: end.segmentIndex,
    width,
  }
}

type RichInlineFragmentCollector = (
  item: PreparedRichInlineItem,
  gapBefore: number,
  occupiedWidth: number,
  start: LayoutCursor,
  end: LayoutCursor,
) => void

function endsInsideFirstSegment(segmentIndex: number, graphemeIndex: number): boolean {
  return segmentIndex === 0 && graphemeIndex > 0
}

export function prepareRichInline(items: RichInlineItem[]): PreparedRichInline {
  const preparedItems: PreparedRichInlineItem[] = []
  const itemsBySourceItemIndex = Array.from<PreparedRichInlineItem | undefined>({ length: items.length })
  const collapsedSpaceWidthCache = new Map<string, number>()
  let pendingGapWidth = 0

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const hasLeadingWhitespace = LEADING_COLLAPSIBLE_BOUNDARY_RE.test(item.text)
    const hasTrailingWhitespace = TRAILING_COLLAPSIBLE_BOUNDARY_RE.test(item.text)
    const trimmedText = item.text
      .replace(LEADING_COLLAPSIBLE_BOUNDARY_RE, '')
      .replace(TRAILING_COLLAPSIBLE_BOUNDARY_RE, '')

    if (trimmedText.length === 0) {
      if (COLLAPSIBLE_BOUNDARY_RE.test(item.text) && pendingGapWidth === 0) {
        pendingGapWidth = getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache)
      }
      continue
    }

    const gapBefore =
      pendingGapWidth > 0
        ? pendingGapWidth
        : hasLeadingWhitespace
          ? getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache)
          : 0
    const prepared = prepareWithSegments(trimmedText, item.font)
    const wholeLine = prepareWholeItemLine(prepared)
    if (wholeLine === null) {
      pendingGapWidth = hasTrailingWhitespace ? getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache) : 0
      continue
    }

    const preparedItem = {
      break: item.break ?? 'normal',
      endGraphemeIndex: wholeLine.endGraphemeIndex,
      endSegmentIndex: wholeLine.endSegmentIndex,
      extraWidth: item.extraWidth ?? 0,
      gapBefore,
      naturalWidth: wholeLine.width,
      prepared,
      sourceItemIndex: index,
    } satisfies PreparedRichInlineItem
    preparedItems.push(preparedItem)
    itemsBySourceItemIndex[index] = preparedItem

    pendingGapWidth = hasTrailingWhitespace ? getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache) : 0
  }

  return {
    items: preparedItems,
    itemsBySourceItemIndex,
  } as InternalPreparedRichInline
}

function stepRichInlineLine(
  flow: InternalPreparedRichInline,
  maxWidth: number,
  cursor: RichInlineCursor,
  collectFragment?: RichInlineFragmentCollector,
): number | null {
  if (flow.items.length === 0 || cursor.itemIndex >= flow.items.length) return null

  const safeWidth = Math.max(1, maxWidth)
  let lineWidth = 0
  let remainingWidth = safeWidth
  let itemIndex = cursor.itemIndex
  const textCursor: LineBreakCursor = {
    segmentIndex: cursor.segmentIndex,
    graphemeIndex: cursor.graphemeIndex,
  }

  lineLoop:
  while (itemIndex < flow.items.length) {
    const item = flow.items[itemIndex]!
    if (
      !isLineStartCursor(textCursor) &&
      textCursor.segmentIndex === item.endSegmentIndex &&
      textCursor.graphemeIndex === item.endGraphemeIndex
    ) {
      itemIndex++
      textCursor.segmentIndex = 0
      textCursor.graphemeIndex = 0
      continue
    }

    const gapBefore = lineWidth === 0 ? 0 : item.gapBefore
    const atItemStart = isLineStartCursor(textCursor)

    if (item.break === 'never') {
      if (!atItemStart) {
        itemIndex++
        textCursor.segmentIndex = 0
        textCursor.graphemeIndex = 0
        continue
      }

      const occupiedWidth = item.naturalWidth + item.extraWidth
      const totalWidth = gapBefore + occupiedWidth
      if (lineWidth > 0 && totalWidth > remainingWidth) break lineLoop

      collectFragment?.(
        item,
        gapBefore,
        occupiedWidth,
        cloneCursor(EMPTY_LAYOUT_CURSOR),
        {
          segmentIndex: item.endSegmentIndex,
          graphemeIndex: item.endGraphemeIndex,
        },
      )
      lineWidth += totalWidth
      remainingWidth = Math.max(0, safeWidth - lineWidth)
      itemIndex++
      textCursor.segmentIndex = 0
      textCursor.graphemeIndex = 0
      continue
    }

    const reservedWidth = gapBefore + item.extraWidth
    if (lineWidth > 0 && reservedWidth >= remainingWidth) break lineLoop

    if (atItemStart) {
      const totalWidth = reservedWidth + item.naturalWidth
      if (totalWidth <= remainingWidth) {
        collectFragment?.(
          item,
          gapBefore,
          item.naturalWidth + item.extraWidth,
          cloneCursor(EMPTY_LAYOUT_CURSOR),
          {
            segmentIndex: item.endSegmentIndex,
            graphemeIndex: item.endGraphemeIndex,
          },
        )
        lineWidth += totalWidth
        remainingWidth = Math.max(0, safeWidth - lineWidth)
        itemIndex++
        textCursor.segmentIndex = 0
        textCursor.graphemeIndex = 0
        continue
      }
    }

    const availableWidth = Math.max(1, remainingWidth - reservedWidth)
    const lineEnd: LineBreakCursor = {
      segmentIndex: textCursor.segmentIndex,
      graphemeIndex: textCursor.graphemeIndex,
    }
    const lineWidthForItem = stepPreparedLineGeometry(item.prepared, lineEnd, availableWidth)
    if (lineWidthForItem === null) {
      itemIndex++
      textCursor.segmentIndex = 0
      textCursor.graphemeIndex = 0
      continue
    }
    if (
      textCursor.segmentIndex === lineEnd.segmentIndex &&
      textCursor.graphemeIndex === lineEnd.graphemeIndex
    ) {
      itemIndex++
      textCursor.segmentIndex = 0
      textCursor.graphemeIndex = 0
      continue
    }

    // If the only thing we can fit after paying the boundary gap is a partial
    // slice of the item's first segment, prefer wrapping before the item so we
    // keep whole-word-style boundaries when they exist. But once the current
    // line can consume a real breakable unit from the item, stay greedy and
    // keep filling the line.
    if (
      lineWidth > 0 &&
      atItemStart &&
      gapBefore > 0 &&
      endsInsideFirstSegment(lineEnd.segmentIndex, lineEnd.graphemeIndex)
    ) {
      const freshLineEnd: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
      const freshLineWidth = stepPreparedLineGeometry(
        item.prepared,
        freshLineEnd,
        Math.max(1, safeWidth - item.extraWidth),
      )
      if (
        freshLineWidth !== null &&
        (
          freshLineEnd.segmentIndex > lineEnd.segmentIndex ||
          (
            freshLineEnd.segmentIndex === lineEnd.segmentIndex &&
            freshLineEnd.graphemeIndex > lineEnd.graphemeIndex
          )
        )
      ) {
        break lineLoop
      }
    }

    collectFragment?.(
      item,
      gapBefore,
      lineWidthForItem + item.extraWidth,
      cloneCursor(textCursor),
      {
        segmentIndex: lineEnd.segmentIndex,
        graphemeIndex: lineEnd.graphemeIndex,
      },
    )
    lineWidth += gapBefore + lineWidthForItem + item.extraWidth
    remainingWidth = Math.max(0, safeWidth - lineWidth)

    if (
      lineEnd.segmentIndex === item.endSegmentIndex &&
      lineEnd.graphemeIndex === item.endGraphemeIndex
    ) {
      itemIndex++
      textCursor.segmentIndex = 0
      textCursor.graphemeIndex = 0
      continue
    }

    textCursor.segmentIndex = lineEnd.segmentIndex
    textCursor.graphemeIndex = lineEnd.graphemeIndex
    break
  }

  if (lineWidth === 0) return null

  cursor.itemIndex = itemIndex
  cursor.segmentIndex = textCursor.segmentIndex
  cursor.graphemeIndex = textCursor.graphemeIndex
  return lineWidth
}

function stepRichInlineLineStats(
  flow: InternalPreparedRichInline,
  maxWidth: number,
  cursor: RichInlineCursor,
): number | null {
  if (flow.items.length === 0 || cursor.itemIndex >= flow.items.length) return null

  const safeWidth = Math.max(1, maxWidth)
  let lineWidth = 0
  let remainingWidth = safeWidth
  let itemIndex = cursor.itemIndex

  lineLoop:
  while (itemIndex < flow.items.length) {
    const item = flow.items[itemIndex]!
    if (
      !isLineStartCursor(cursor) &&
      cursor.segmentIndex === item.endSegmentIndex &&
      cursor.graphemeIndex === item.endGraphemeIndex
    ) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    const gapBefore = lineWidth === 0 ? 0 : item.gapBefore
    const atItemStart = isLineStartCursor(cursor)

    if (item.break === 'never') {
      if (!atItemStart) {
        itemIndex++
        cursor.segmentIndex = 0
        cursor.graphemeIndex = 0
        continue
      }

      const occupiedWidth = item.naturalWidth + item.extraWidth
      const totalWidth = gapBefore + occupiedWidth
      if (lineWidth > 0 && totalWidth > remainingWidth) break lineLoop

      lineWidth += totalWidth
      remainingWidth = Math.max(0, safeWidth - lineWidth)
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    const reservedWidth = gapBefore + item.extraWidth
    if (lineWidth > 0 && reservedWidth >= remainingWidth) break lineLoop

    if (atItemStart) {
      const totalWidth = reservedWidth + item.naturalWidth
      if (totalWidth <= remainingWidth) {
        lineWidth += totalWidth
        remainingWidth = Math.max(0, safeWidth - lineWidth)
        itemIndex++
        cursor.segmentIndex = 0
        cursor.graphemeIndex = 0
        continue
      }
    }

    const availableWidth = Math.max(1, remainingWidth - reservedWidth)
    const lineEnd: LineBreakCursor = {
      segmentIndex: cursor.segmentIndex,
      graphemeIndex: cursor.graphemeIndex,
    }
    const lineWidthForItem = stepPreparedLineGeometry(item.prepared, lineEnd, availableWidth)
    if (lineWidthForItem === null) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }
    if (cursor.segmentIndex === lineEnd.segmentIndex && cursor.graphemeIndex === lineEnd.graphemeIndex) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    if (
      lineWidth > 0 &&
      atItemStart &&
      gapBefore > 0 &&
      endsInsideFirstSegment(lineEnd.segmentIndex, lineEnd.graphemeIndex)
    ) {
      const freshLineEnd: LineBreakCursor = {
        segmentIndex: 0,
        graphemeIndex: 0,
      }
      const freshLineWidth = stepPreparedLineGeometry(
        item.prepared,
        freshLineEnd,
        Math.max(1, safeWidth - item.extraWidth),
      )
      if (
        freshLineWidth !== null &&
        (
          freshLineEnd.segmentIndex > lineEnd.segmentIndex ||
          (
            freshLineEnd.segmentIndex === lineEnd.segmentIndex &&
            freshLineEnd.graphemeIndex > lineEnd.graphemeIndex
          )
        )
      ) {
        break lineLoop
      }
    }

    lineWidth += gapBefore + lineWidthForItem + item.extraWidth
    remainingWidth = Math.max(0, safeWidth - lineWidth)

    if (lineEnd.segmentIndex === item.endSegmentIndex && lineEnd.graphemeIndex === item.endGraphemeIndex) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    cursor.segmentIndex = lineEnd.segmentIndex
    cursor.graphemeIndex = lineEnd.graphemeIndex
    break
  }

  if (lineWidth === 0) return null

  cursor.itemIndex = itemIndex
  return lineWidth
}

export function layoutNextRichInlineLineRange(
  prepared: PreparedRichInline,
  maxWidth: number,
  start: RichInlineCursor = RICH_INLINE_START_CURSOR,
): RichInlineLineRange | null {
  const flow = getInternalPreparedRichInline(prepared)
  const end: RichInlineCursor = {
    itemIndex: start.itemIndex,
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const fragments: RichInlineFragmentRange[] = []
  const width = stepRichInlineLine(flow, maxWidth, end, (item, gapBefore, occupiedWidth, fragmentStart, fragmentEnd) => {
    fragments.push({
      itemIndex: item.sourceItemIndex,
      gapBefore,
      occupiedWidth,
      start: fragmentStart,
      end: fragmentEnd,
    })
  })
  if (width === null) return null

  return {
    fragments,
    width,
    end,
  }
}

function materializeFragmentText(
  item: PreparedRichInlineItem,
  fragment: RichInlineFragmentRange,
): string {
  return buildLineTextFromRange(
    item.prepared,
    getLineTextCache(item.prepared),
    fragment.start.segmentIndex,
    fragment.start.graphemeIndex,
    fragment.end.segmentIndex,
    fragment.end.graphemeIndex,
  )
}

// Bridge from cheap range walking to full fragment text. Lets callers do
// shrinkwrap/virtualization/probing work first, then only pay for text on the
// lines they actually render.
export function materializeRichInlineLineRange(
  prepared: PreparedRichInline,
  line: RichInlineLineRange,
): RichInlineLine {
  const flow = getInternalPreparedRichInline(prepared)
  const fragments: RichInlineFragment[] = []

  for (let i = 0; i < line.fragments.length; i++) {
    const fragment = line.fragments[i]!
    const item = flow.itemsBySourceItemIndex[fragment.itemIndex]
    if (item === undefined) throw new Error('Missing rich-text inline item for fragment')
    fragments.push({
      itemIndex: fragment.itemIndex,
      text: materializeFragmentText(item, fragment),
      gapBefore: fragment.gapBefore,
      occupiedWidth: fragment.occupiedWidth,
      start: fragment.start,
      end: fragment.end,
    })
  }

  return {
    fragments,
    width: line.width,
    end: line.end,
  }
}

export function walkRichInlineLineRanges(
  prepared: PreparedRichInline,
  maxWidth: number,
  onLine: (line: RichInlineLineRange) => void,
): number {
  let lineCount = 0
  let cursor = RICH_INLINE_START_CURSOR

  while (true) {
    const line = layoutNextRichInlineLineRange(prepared, maxWidth, cursor)
    if (line === null) return lineCount
    onLine(line)
    lineCount++
    cursor = line.end
  }
}

export function measureRichInlineStats(
  prepared: PreparedRichInline,
  maxWidth: number,
): RichInlineStats {
  const flow = getInternalPreparedRichInline(prepared)
  let lineCount = 0
  let maxLineWidth = 0
  const cursor: RichInlineCursor = {
    itemIndex: 0,
    segmentIndex: 0,
    graphemeIndex: 0,
  }

  while (true) {
    const lineWidth = stepRichInlineLineStats(flow, maxWidth, cursor)
    if (lineWidth === null) {
      return {
        lineCount,
        maxLineWidth,
      }
    }
    lineCount++
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth
  }
}
