import {
  materializeLineRange,
  measureNaturalWidth,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLineRange,
  type LayoutResult,
  type PreparedTextWithSegments,
} from './layout.js'
import {
  layoutNextLineRange as stepPreparedLineRange,
  type LineBreakCursor,
  stepPreparedLineGeometry,
} from './line-break.js'

// Experimental sidecar for mixed inline runs under `white-space: normal`.
// It keeps the core layout API low-level while taking over the boring shared
// work that rich inline demos kept reimplementing in userland:
// - collapsed boundary whitespace across item boundaries
// - atomic inline boxes like pills
// - per-item extra horizontal chrome such as padding/borders

declare const preparedInlineFlowBrand: unique symbol

export type InlineFlowItem = {
  text: string // Raw author text, including any leading/trailing collapsible spaces
  font: string // Canvas font shorthand used to prepare and measure this item
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a pill or mention chip
  extraWidth?: number // Caller-owned horizontal chrome, e.g. padding + border width
}

export type PreparedInlineFlow = {
  readonly [preparedInlineFlowBrand]: true
}

export type InlineFlowCursor = {
  itemIndex: number
  segmentIndex: number
  graphemeIndex: number
}

export type InlineFlowFragment = {
  itemIndex: number // Index into the original InlineFlowItem array
  text: string // Text slice for this fragment
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}

export type InlineFlowFragmentRange = {
  itemIndex: number // Index into the original InlineFlowItem array
  gapBefore: number // Collapsed inter-item gap paid before this fragment on this line
  occupiedWidth: number // Text width plus the item's extraWidth contribution
  start: LayoutCursor // Start cursor within the item's prepared text
  end: LayoutCursor // End cursor within the item's prepared text
}

export type InlineFlowLine = {
  fragments: InlineFlowFragment[]
  width: number
  end: InlineFlowCursor
}

export type InlineFlowLineRange = {
  fragments: InlineFlowFragmentRange[]
  width: number
  end: InlineFlowCursor
}

export type InlineFlowGeometry = {
  lineCount: number
  maxLineWidth: number
}

type InternalPreparedInlineFlow = PreparedInlineFlow & {
  items: PreparedInlineFlowItem[]
  itemsBySourceItemIndex: Array<PreparedInlineFlowItem | undefined>
}

type PreparedInlineFlowItem = {
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
const FLOW_START_CURSOR: InlineFlowCursor = {
  itemIndex: 0,
  segmentIndex: 0,
  graphemeIndex: 0,
}

function getInternalPreparedInlineFlow(prepared: PreparedInlineFlow): InternalPreparedInlineFlow {
  return prepared as InternalPreparedInlineFlow
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
  const line = stepPreparedLineRange(prepared, EMPTY_LAYOUT_CURSOR, Number.POSITIVE_INFINITY)
  if (line === null) return null
  return {
    endGraphemeIndex: line.endGraphemeIndex,
    endSegmentIndex: line.endSegmentIndex,
    width: line.width,
  }
}

type InlineFlowFragmentCollector = (
  item: PreparedInlineFlowItem,
  gapBefore: number,
  occupiedWidth: number,
  start: LayoutCursor,
  end: LayoutCursor,
) => void

function endsInsideFirstSegment(segmentIndex: number, graphemeIndex: number): boolean {
  return segmentIndex === 0 && graphemeIndex > 0
}

export function prepareInlineFlow(items: InlineFlowItem[]): PreparedInlineFlow {
  const preparedItems: PreparedInlineFlowItem[] = []
  const itemsBySourceItemIndex = Array.from<PreparedInlineFlowItem | undefined>({ length: items.length })
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
    } satisfies PreparedInlineFlowItem
    preparedItems.push(preparedItem)
    itemsBySourceItemIndex[index] = preparedItem

    pendingGapWidth = hasTrailingWhitespace ? getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache) : 0
  }

  return {
    items: preparedItems,
    itemsBySourceItemIndex,
  } as InternalPreparedInlineFlow
}

function stepInlineFlowLine(
  flow: InternalPreparedInlineFlow,
  maxWidth: number,
  cursor: InlineFlowCursor,
  collectFragment?: InlineFlowFragmentCollector,
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
    const line = stepPreparedLineRange(item.prepared, textCursor, availableWidth)
    if (line === null) {
      itemIndex++
      textCursor.segmentIndex = 0
      textCursor.graphemeIndex = 0
      continue
    }
    if (
      textCursor.segmentIndex === line.endSegmentIndex &&
      textCursor.graphemeIndex === line.endGraphemeIndex
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
      endsInsideFirstSegment(line.endSegmentIndex, line.endGraphemeIndex)
    ) {
      const freshLine = stepPreparedLineRange(
        item.prepared,
        EMPTY_LAYOUT_CURSOR,
        Math.max(1, safeWidth - item.extraWidth),
      )
      if (
        freshLine !== null &&
        (
          freshLine.endSegmentIndex > line.endSegmentIndex ||
          (
            freshLine.endSegmentIndex === line.endSegmentIndex &&
            freshLine.endGraphemeIndex > line.endGraphemeIndex
          )
        )
      ) {
        break lineLoop
      }
    }

    collectFragment?.(
      item,
      gapBefore,
      line.width + item.extraWidth,
      cloneCursor(textCursor),
      {
        segmentIndex: line.endSegmentIndex,
        graphemeIndex: line.endGraphemeIndex,
      },
    )
    lineWidth += gapBefore + line.width + item.extraWidth
    remainingWidth = Math.max(0, safeWidth - lineWidth)

    if (
      line.endSegmentIndex === item.endSegmentIndex &&
      line.endGraphemeIndex === item.endGraphemeIndex
    ) {
      itemIndex++
      textCursor.segmentIndex = 0
      textCursor.graphemeIndex = 0
      continue
    }

    textCursor.segmentIndex = line.endSegmentIndex
    textCursor.graphemeIndex = line.endGraphemeIndex
    break
  }

  if (lineWidth === 0) return null

  cursor.itemIndex = itemIndex
  cursor.segmentIndex = textCursor.segmentIndex
  cursor.graphemeIndex = textCursor.graphemeIndex
  return lineWidth
}

function stepInlineFlowLineGeometry(
  flow: InternalPreparedInlineFlow,
  maxWidth: number,
  cursor: InlineFlowCursor,
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

export function layoutNextInlineFlowLineRange(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  start: InlineFlowCursor = FLOW_START_CURSOR,
): InlineFlowLineRange | null {
  const flow = getInternalPreparedInlineFlow(prepared)
  const end: InlineFlowCursor = {
    itemIndex: start.itemIndex,
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const fragments: InlineFlowFragmentRange[] = []
  const width = stepInlineFlowLine(flow, maxWidth, end, (item, gapBefore, occupiedWidth, fragmentStart, fragmentEnd) => {
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
  item: PreparedInlineFlowItem,
  fragment: InlineFlowFragmentRange,
): string {
  const line = materializeLineRange(item.prepared, {
    width: fragment.occupiedWidth - item.extraWidth,
    start: fragment.start,
    end: fragment.end,
  } satisfies LayoutLineRange)
  return line.text
}

export function layoutNextInlineFlowLine(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  start: InlineFlowCursor = FLOW_START_CURSOR,
): InlineFlowLine | null {
  const flow = getInternalPreparedInlineFlow(prepared)
  const line = layoutNextInlineFlowLineRange(prepared, maxWidth, start)
  if (line === null) return null

  return {
    fragments: line.fragments.map(fragment => {
      const item = flow.itemsBySourceItemIndex[fragment.itemIndex]
      if (item === undefined) throw new Error('Missing inline-flow item for fragment')
      return {
        ...fragment,
        text: materializeFragmentText(item, fragment),
      }
    }),
    width: line.width,
    end: line.end,
  }
}

export function walkInlineFlowLineRanges(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  onLine: (line: InlineFlowLineRange) => void,
): number {
  let lineCount = 0
  let cursor = FLOW_START_CURSOR

  while (true) {
    const line = layoutNextInlineFlowLineRange(prepared, maxWidth, cursor)
    if (line === null) return lineCount
    onLine(line)
    lineCount++
    cursor = line.end
  }
}

export function measureInlineFlowGeometry(
  prepared: PreparedInlineFlow,
  maxWidth: number,
): InlineFlowGeometry {
  const flow = getInternalPreparedInlineFlow(prepared)
  let lineCount = 0
  let maxLineWidth = 0
  const cursor: InlineFlowCursor = {
    itemIndex: 0,
    segmentIndex: 0,
    graphemeIndex: 0,
  }

  while (true) {
    const lineWidth = stepInlineFlowLineGeometry(flow, maxWidth, cursor)
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

export function walkInlineFlowLines(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  onLine: (line: InlineFlowLine) => void,
): number {
  let lineCount = 0
  let cursor = FLOW_START_CURSOR

  while (true) {
    const line = layoutNextInlineFlowLine(prepared, maxWidth, cursor)
    if (line === null) return lineCount
    onLine(line)
    lineCount++
    cursor = line.end
  }
}

export function measureInlineFlow(
  prepared: PreparedInlineFlow,
  maxWidth: number,
  lineHeight: number,
): LayoutResult {
  const { lineCount } = measureInlineFlowGeometry(prepared, maxWidth)
  return {
    lineCount,
    height: lineCount * lineHeight,
  }
}
