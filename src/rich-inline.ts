import {
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
import { getFontMeasurementState, getSegmentMetrics } from './measurement.js'

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
  letterSpacing?: number // Extra horizontal spacing between graphemes, in CSS px
  break?: 'normal' | 'never' // `never` keeps the item atomic, like a pill or mention chip
  extraWidth?: number // Caller-owned horizontal chrome, e.g. padding + border width
}

export type PreparedRichInline = {
  readonly [preparedRichInlineBrand]: true
}

export type RichInlineCursor = {
  itemIndex: number // Index into the original RichInlineItem array
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
  items: Array<PreparedRichInlineItem | undefined>
}

type PreparedRichInlineItem = {
  break: 'normal' | 'never'
  breakBefore: boolean
  establishesLine: boolean
  extraWidth: number
  gapBefore: number
  naturalWidth: number
  prepared: PreparedTextWithSegments
}

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

function isCollapsibleBoundaryWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0C || code === 0x0D
}

function getCollapsedSpaceWidth(font: string, letterSpacing: number): number {
  const { cache } = getFontMeasurementState(font, false)
  return getSegmentMetrics(' ', cache).width + letterSpacing
}

function measureWholeItem(prepared: PreparedTextWithSegments): number | null {
  const end: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
  return stepPreparedLineGeometry(prepared, end, Number.POSITIVE_INFINITY)
}

type RichInlineFragmentCollector = (
  itemIndex: number,
  gapBefore: number,
  occupiedWidth: number,
  start: LayoutCursor,
  end: LayoutCursor,
) => void

function endsInsideFirstSegment(segmentIndex: number, graphemeIndex: number): boolean {
  return segmentIndex === 0 && graphemeIndex > 0
}

export function prepareRichInline(items: RichInlineItem[]): PreparedRichInline {
  const preparedItems = Array.from<PreparedRichInlineItem | undefined>({ length: items.length })
  // A collapsed SPACE can have zero or negative advance. Its existence and
  // ordinary break opportunity must survive independently of that number.
  let pendingGapWidth: number | null = null
  let breakAfterPreviousItem = false

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const letterSpacing = item.letterSpacing ?? 0
    let start = 0
    while (start < item.text.length && isCollapsibleBoundaryWhitespace(item.text.charCodeAt(start))) start++

    if (start === item.text.length) {
      if (start > 0 && pendingGapWidth === null) {
        pendingGapWidth = getCollapsedSpaceWidth(item.font, letterSpacing)
      }
      continue
    }

    // Scan from the ends once. A trailing-whitespace regex retries every
    // position in a long internal space run when later content prevents a match.
    let end = item.text.length
    while (end > start && isCollapsibleBoundaryWhitespace(item.text.charCodeAt(end - 1))) end--
    const hasLeadingWhitespace = start > 0
    const hasTrailingWhitespace = end < item.text.length
    const trimmedText = item.text.slice(start, end)

    const gapBefore = pendingGapWidth ?? (
      hasLeadingWhitespace ? getCollapsedSpaceWidth(item.font, letterSpacing) : 0
    )
    const prepared = prepareWithSegments(
      trimmedText,
      item.font,
      letterSpacing === 0 ? undefined : { letterSpacing },
    )
    // The flat walker can omit source controls at line start. Its result is
    // a measurement observation, not the rich item's identity or source end.
    const wholeWidth = measureWholeItem(prepared)
    const establishesLine = wholeWidth !== null || prepared.kinds.includes('zero-width-break')

    const preparedItem = {
      break: item.break ?? 'normal',
      breakBefore: pendingGapWidth !== null || hasLeadingWhitespace || breakAfterPreviousItem,
      establishesLine,
      extraWidth: item.extraWidth ?? 0,
      gapBefore,
      naturalWidth: wholeWidth ?? 0,
      prepared,
    } satisfies PreparedRichInlineItem
    preparedItems[index] = preparedItem
    if (establishesLine) breakAfterPreviousItem = prepared.kinds.at(-1) === 'zero-width-break'

    pendingGapWidth = hasTrailingWhitespace
      ? getCollapsedSpaceWidth(item.font, letterSpacing)
      : null
  }

  return {
    items: preparedItems,
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
  let hasContent = false
  let lineWidth = 0
  let remainingWidth = safeWidth
  let itemIndex = cursor.itemIndex

  lineLoop:
  while (itemIndex < flow.items.length) {
    const item = flow.items[itemIndex]
    if (item === undefined) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }
    if (
      !isLineStartCursor(cursor) &&
      cursor.segmentIndex === item.prepared.segments.length &&
      cursor.graphemeIndex === 0
    ) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    // Retain inactive source items in the original coordinate space without
    // turning their mere presence into a line. Their prior layout behavior is
    // unchanged; a following line can still expose their consumed source.
    if (!item.establishesLine) {
      collectFragment?.(itemIndex, 0, 0, cloneCursor(EMPTY_LAYOUT_CURSOR), {
        segmentIndex: item.prepared.segments.length,
        graphemeIndex: 0,
      })
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    const gapBefore = hasContent ? item.gapBefore : 0
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
      if (hasContent && totalWidth > remainingWidth) break lineLoop

      collectFragment?.(
        itemIndex,
        gapBefore,
        occupiedWidth,
        cloneCursor(EMPTY_LAYOUT_CURSOR),
        {
          segmentIndex: item.prepared.segments.length,
          graphemeIndex: 0,
        },
      )
      hasContent = true
      lineWidth += totalWidth
      remainingWidth = safeWidth - lineWidth
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    const reservedWidth = gapBefore + item.extraWidth
    if (hasContent && reservedWidth > remainingWidth) break lineLoop

    if (atItemStart) {
      const totalWidth = reservedWidth + item.naturalWidth
      if (totalWidth <= remainingWidth) {
        collectFragment?.(
          itemIndex,
          gapBefore,
          item.naturalWidth + item.extraWidth,
          cloneCursor(EMPTY_LAYOUT_CURSOR),
          {
            segmentIndex: item.prepared.segments.length,
            graphemeIndex: 0,
          },
        )
        hasContent = true
        lineWidth += totalWidth
        remainingWidth = safeWidth - lineWidth
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
    if (
      cursor.segmentIndex === lineEnd.segmentIndex &&
      cursor.graphemeIndex === lineEnd.graphemeIndex
    ) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    const itemOccupiedWidth = lineWidthForItem + item.extraWidth
    const lineWidthContribution = gapBefore + itemOccupiedWidth

    // The lower-level walker may force one unit to make progress. If that unit
    // only fits on a fresh line, wrap before this rich item instead.
    if (hasContent && atItemStart && lineWidthContribution > remainingWidth) break lineLoop

    // Preserve the ordinary item-boundary opportunity before emergency
    // splitting the next word. SPACE advance need not be positive; ZWSP has
    // no gap at all.
    if (hasContent && atItemStart && item.breakBefore && endsInsideFirstSegment(lineEnd.segmentIndex, lineEnd.graphemeIndex)) {
      break lineLoop
    }

    collectFragment?.(
      itemIndex,
      gapBefore,
      itemOccupiedWidth,
      cloneCursor(cursor),
      {
        segmentIndex: lineEnd.segmentIndex,
        graphemeIndex: lineEnd.graphemeIndex,
      },
    )
    hasContent = true
    lineWidth += lineWidthContribution
    remainingWidth = safeWidth - lineWidth

    if (
      lineEnd.segmentIndex === item.prepared.segments.length &&
      lineEnd.graphemeIndex === 0
    ) {
      itemIndex++
      cursor.segmentIndex = 0
      cursor.graphemeIndex = 0
      continue
    }

    cursor.segmentIndex = lineEnd.segmentIndex
    cursor.graphemeIndex = lineEnd.graphemeIndex
    break
  }

  if (!hasContent) return null

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
  const width = stepRichInlineLine(flow, maxWidth, end, (itemIndex, gapBefore, occupiedWidth, fragmentStart, fragmentEnd) => {
    fragments.push({
      itemIndex,
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
    const item = flow.items[fragment.itemIndex]
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
  const cursor = { ...RICH_INLINE_START_CURSOR }

  while (true) {
    const line = layoutNextRichInlineLineRange(prepared, maxWidth, cursor)
    if (line === null) return lineCount
    cursor.itemIndex = line.end.itemIndex
    cursor.segmentIndex = line.end.segmentIndex
    cursor.graphemeIndex = line.end.graphemeIndex
    onLine(line)
    lineCount++
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
    const lineWidth = stepRichInlineLine(flow, maxWidth, cursor)
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
