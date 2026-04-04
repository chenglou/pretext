import type { SegmentBreakKind } from './analysis.js'
import { getEngineProfile } from './measurement.js'

export type LineBreakCursor = {
  segmentIndex: number
  graphemeIndex: number
}

export type PreparedLineBreakData = {
  widths: number[]
  lineEndFitAdvances: number[]
  lineEndPaintAdvances: number[]
  kinds: SegmentBreakKind[]
  simpleLineWalkFastPath: boolean
  breakableWidths: (number[] | null)[]
  breakablePrefixWidths: (number[] | null)[]
  discretionaryHyphenWidth: number
  tabStopAdvance: number
  chunks: {
    startSegmentIndex: number
    endSegmentIndex: number
    consumedEndSegmentIndex: number
  }[]
}

export type InternalLayoutLine = {
  startSegmentIndex: number
  startGraphemeIndex: number
  endSegmentIndex: number
  endGraphemeIndex: number
  width: number
}

function normalizeSimpleLineStartSegmentIndex(
  prepared: PreparedLineBreakData,
  segmentIndex: number,
): number {
  while (segmentIndex < prepared.widths.length) {
    const kind = prepared.kinds[segmentIndex]!
    if (kind !== 'space' && kind !== 'zero-width-break' && kind !== 'soft-hyphen') break
    segmentIndex++
  }
  return segmentIndex
}

function getTabAdvance(lineWidth: number, tabStopAdvance: number): number {
  if (tabStopAdvance <= 0) return 0

  const remainder = lineWidth % tabStopAdvance
  if (Math.abs(remainder) <= 1e-6) return tabStopAdvance
  return tabStopAdvance - remainder
}

function fitSoftHyphenBreak(
  graphemeWidths: number[],
  initialWidth: number,
  maxWidth: number,
  lineFitEpsilon: number,
  discretionaryHyphenWidth: number,
  cumulativeWidths: boolean,
): { fitCount: number, fittedWidth: number } {
  let fitCount = 0
  let fittedWidth = initialWidth

  while (fitCount < graphemeWidths.length) {
    const nextWidth = cumulativeWidths
      ? initialWidth + graphemeWidths[fitCount]!
      : fittedWidth + graphemeWidths[fitCount]!
    const nextLineWidth = fitCount + 1 < graphemeWidths.length
      ? nextWidth + discretionaryHyphenWidth
      : nextWidth
    if (nextLineWidth > maxWidth + lineFitEpsilon) break
    fittedWidth = nextWidth
    fitCount++
  }

  return { fitCount, fittedWidth }
}

function findChunkIndexForStart(prepared: PreparedLineBreakData, segmentIndex: number): number {
  let lo = 0
  let hi = prepared.chunks.length

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (segmentIndex < prepared.chunks[mid]!.consumedEndSegmentIndex) {
      hi = mid
    } else {
      lo = mid + 1
    }
  }

  return lo < prepared.chunks.length ? lo : -1
}

function normalizeLineStartInChunk(
  prepared: PreparedLineBreakData,
  chunkIndex: number,
  cursor: LineBreakCursor,
): number {
  let segmentIndex = cursor.segmentIndex
  if (cursor.graphemeIndex > 0) return chunkIndex

  const chunk = prepared.chunks[chunkIndex]!
  if (chunk.startSegmentIndex === chunk.endSegmentIndex && segmentIndex === chunk.startSegmentIndex) {
    cursor.segmentIndex = segmentIndex
    cursor.graphemeIndex = 0
    return chunkIndex
  }

  if (segmentIndex < chunk.startSegmentIndex) segmentIndex = chunk.startSegmentIndex
  while (segmentIndex < chunk.endSegmentIndex) {
    const kind = prepared.kinds[segmentIndex]!
    if (kind !== 'space' && kind !== 'zero-width-break' && kind !== 'soft-hyphen') {
      cursor.segmentIndex = segmentIndex
      cursor.graphemeIndex = 0
      return chunkIndex
    }
    segmentIndex++
  }

  if (chunk.consumedEndSegmentIndex >= prepared.widths.length) return -1
  cursor.segmentIndex = chunk.consumedEndSegmentIndex
  cursor.graphemeIndex = 0
  return chunkIndex + 1
}

function normalizeLineStartChunkIndex(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
): number {
  if (cursor.segmentIndex >= prepared.widths.length) return -1

  const chunkIndex = findChunkIndexForStart(prepared, cursor.segmentIndex)
  if (chunkIndex < 0) return -1
  return normalizeLineStartInChunk(prepared, chunkIndex, cursor)
}

function normalizeLineStartChunkIndexFromHint(
  prepared: PreparedLineBreakData,
  chunkIndex: number,
  cursor: LineBreakCursor,
): number {
  if (cursor.segmentIndex >= prepared.widths.length) return -1

  let nextChunkIndex = chunkIndex
  while (
    nextChunkIndex < prepared.chunks.length &&
    cursor.segmentIndex >= prepared.chunks[nextChunkIndex]!.consumedEndSegmentIndex
  ) {
    nextChunkIndex++
  }
  if (nextChunkIndex >= prepared.chunks.length) return -1
  return normalizeLineStartInChunk(prepared, nextChunkIndex, cursor)
}

export function normalizeLineStart(
  prepared: PreparedLineBreakData,
  start: LineBreakCursor,
): LineBreakCursor | null {
  const cursor = {
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const chunkIndex = normalizeLineStartChunkIndex(prepared, cursor)
  return chunkIndex < 0 ? null : cursor
}

export function countPreparedLines(prepared: PreparedLineBreakData, maxWidth: number): number {
  if (prepared.simpleLineWalkFastPath) {
    return countPreparedLinesSimple(prepared, maxWidth)
  }
  return walkPreparedLines(prepared, maxWidth)
}

function countPreparedLinesSimple(prepared: PreparedLineBreakData, maxWidth: number): number {
  return walkPreparedLinesSimple(prepared, maxWidth)
}

function walkPreparedLinesSimple(
  prepared: PreparedLineBreakData,
  maxWidth: number,
  onLine?: (line: InternalLayoutLine) => void,
): number {
  const { widths, kinds, breakableWidths, breakablePrefixWidths } = prepared
  if (widths.length === 0) return 0

  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
  const preferPrefixWidths = engineProfile.preferPrefixWidthsForBreakableRuns
  const fitLimit = maxWidth + lineFitEpsilon

  let lineCount = 0
  let lineW = 0
  let hasContent = false
  let lineStartSegmentIndex = 0
  let lineStartGraphemeIndex = 0
  let lineEndSegmentIndex = 0
  let lineEndGraphemeIndex = 0
  let pendingBreakSegmentIndex = -1
  let pendingBreakPaintWidth = 0

  function clearPendingBreak(): void {
    pendingBreakSegmentIndex = -1
    pendingBreakPaintWidth = 0
  }

  function emitCurrentLine(
    endSegmentIndex = lineEndSegmentIndex,
    endGraphemeIndex = lineEndGraphemeIndex,
    width = lineW,
  ): void {
    lineCount++
    onLine?.({
      startSegmentIndex: lineStartSegmentIndex,
      startGraphemeIndex: lineStartGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
      width,
    })
    lineW = 0
    hasContent = false
    clearPendingBreak()
  }

  function startLineAtSegment(segmentIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = 0
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
    lineW = width
  }

  function startLineAtGrapheme(segmentIndex: number, graphemeIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = graphemeIndex
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = graphemeIndex + 1
    lineW = width
  }

  function appendWholeSegment(segmentIndex: number, width: number): void {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, width)
      return
    }
    lineW += width
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
  }

  function appendBreakableSegment(segmentIndex: number): void {
    appendBreakableSegmentFrom(segmentIndex, 0)
  }

  function appendBreakableSegmentFrom(segmentIndex: number, startGraphemeIndex: number): void {
    const gWidths = breakableWidths[segmentIndex]!
    const gPrefixWidths = preferPrefixWidths ? breakablePrefixWidths[segmentIndex] ?? null : null
    let previousPrefixWidth =
      gPrefixWidths === null || startGraphemeIndex === 0 ? 0 : gPrefixWidths[startGraphemeIndex - 1]!

    for (let g = startGraphemeIndex; g < gWidths.length; g++) {
      const gw = gPrefixWidths === null ? gWidths[g]! : gPrefixWidths[g]! - previousPrefixWidth

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, gw)
      } else if (lineW + gw > fitLimit) {
        emitCurrentLine()
        startLineAtGrapheme(segmentIndex, g, gw)
      } else {
        lineW += gw
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
      }

      if (gPrefixWidths !== null) previousPrefixWidth = gPrefixWidths[g]!
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
  }

  let i = 0
  while (i < widths.length) {
    if (!hasContent) {
      i = normalizeSimpleLineStartSegmentIndex(prepared, i)
      if (i >= widths.length) break
    }

    const w = widths[i]!
    const kind = kinds[i]!
    const breakAfter = kind === 'space' || kind === 'preserved-space' || kind === 'tab' || kind === 'zero-width-break' || kind === 'soft-hyphen'

    if (!hasContent) {
      if (w > maxWidth && breakableWidths[i] !== null) {
        appendBreakableSegment(i)
      } else {
        startLineAtSegment(i, w)
      }
      if (breakAfter) {
        pendingBreakSegmentIndex = i + 1
        pendingBreakPaintWidth = lineW - w
      }
      i++
      continue
    }

    const newW = lineW + w
    if (newW > fitLimit) {
      if (breakAfter) {
        appendWholeSegment(i, w)
        emitCurrentLine(i + 1, 0, lineW - w)
        i++
        continue
      }

      if (pendingBreakSegmentIndex >= 0) {
        if (
          lineEndSegmentIndex > pendingBreakSegmentIndex ||
          (lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0)
        ) {
          emitCurrentLine()
          continue
        }
        emitCurrentLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth)
        continue
      }

      if (w > maxWidth && breakableWidths[i] !== null) {
        emitCurrentLine()
        appendBreakableSegment(i)
        i++
        continue
      }

      emitCurrentLine()
      continue
    }

    appendWholeSegment(i, w)
    if (breakAfter) {
      pendingBreakSegmentIndex = i + 1
      pendingBreakPaintWidth = lineW - w
    }
    i++
  }

  if (hasContent) emitCurrentLine()
  return lineCount
}

export function walkPreparedLines(
  prepared: PreparedLineBreakData,
  maxWidth: number,
  onLine?: (line: InternalLayoutLine) => void,
): number {
  if (prepared.simpleLineWalkFastPath) {
    return walkPreparedLinesSimple(prepared, maxWidth, onLine)
  }

  const {
    widths,
    lineEndFitAdvances,
    lineEndPaintAdvances,
    kinds,
    breakableWidths,
    breakablePrefixWidths,
    discretionaryHyphenWidth,
    tabStopAdvance,
    chunks,
  } = prepared
  if (widths.length === 0 || chunks.length === 0) return 0

  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
  const preferPrefixWidths = engineProfile.preferPrefixWidthsForBreakableRuns
  const fitLimit = maxWidth + lineFitEpsilon

  let lineCount = 0
  let lineW = 0
  let hasContent = false
  let lineStartSegmentIndex = 0
  let lineStartGraphemeIndex = 0
  let lineEndSegmentIndex = 0
  let lineEndGraphemeIndex = 0
  let pendingBreakSegmentIndex = -1
  let pendingBreakFitWidth = 0
  let pendingBreakPaintWidth = 0
  let pendingBreakKind: SegmentBreakKind | null = null

  function clearPendingBreak(): void {
    pendingBreakSegmentIndex = -1
    pendingBreakFitWidth = 0
    pendingBreakPaintWidth = 0
    pendingBreakKind = null
  }

  function emitCurrentLine(
    endSegmentIndex = lineEndSegmentIndex,
    endGraphemeIndex = lineEndGraphemeIndex,
    width = lineW,
  ): void {
    lineCount++
    onLine?.({
      startSegmentIndex: lineStartSegmentIndex,
      startGraphemeIndex: lineStartGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
      width,
    })
    lineW = 0
    hasContent = false
    clearPendingBreak()
  }

  function startLineAtSegment(segmentIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = 0
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
    lineW = width
  }

  function startLineAtGrapheme(segmentIndex: number, graphemeIndex: number, width: number): void {
    hasContent = true
    lineStartSegmentIndex = segmentIndex
    lineStartGraphemeIndex = graphemeIndex
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = graphemeIndex + 1
    lineW = width
  }

  function appendWholeSegment(segmentIndex: number, width: number): void {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, width)
      return
    }
    lineW += width
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
  }

  function updatePendingBreakForWholeSegment(
    kind: SegmentBreakKind,
    breakAfter: boolean,
    segmentIndex: number,
    segmentWidth: number,
  ): void {
    if (!breakAfter) return
    const fitAdvance = kind === 'tab' ? 0 : lineEndFitAdvances[segmentIndex]!
    const paintAdvance = kind === 'tab' ? segmentWidth : lineEndPaintAdvances[segmentIndex]!
    pendingBreakSegmentIndex = segmentIndex + 1
    pendingBreakFitWidth = lineW - segmentWidth + fitAdvance
    pendingBreakPaintWidth = lineW - segmentWidth + paintAdvance
    pendingBreakKind = kind
  }

  function appendBreakableSegment(segmentIndex: number): void {
    appendBreakableSegmentFrom(segmentIndex, 0)
  }

  function appendBreakableSegmentFrom(segmentIndex: number, startGraphemeIndex: number): void {
    const gWidths = breakableWidths[segmentIndex]!
    const gPrefixWidths = preferPrefixWidths ? breakablePrefixWidths[segmentIndex] ?? null : null
    let previousPrefixWidth =
      gPrefixWidths === null || startGraphemeIndex === 0 ? 0 : gPrefixWidths[startGraphemeIndex - 1]!

    for (let g = startGraphemeIndex; g < gWidths.length; g++) {
      const gw = gPrefixWidths === null ? gWidths[g]! : gPrefixWidths[g]! - previousPrefixWidth

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, gw)
      } else if (lineW + gw > fitLimit) {
        emitCurrentLine()
        startLineAtGrapheme(segmentIndex, g, gw)
      } else {
        lineW += gw
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
      }

      if (gPrefixWidths !== null) previousPrefixWidth = gPrefixWidths[g]!
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
  }

  function continueSoftHyphenBreakableSegment(segmentIndex: number): boolean {
    if (pendingBreakKind !== 'soft-hyphen') return false
    const gWidths = breakableWidths[segmentIndex]!
    if (gWidths === null) return false
    const fitWidths = engineProfile.preferPrefixWidthsForBreakableRuns
      ? breakablePrefixWidths[segmentIndex] ?? gWidths
      : gWidths
    const usesPrefixWidths = fitWidths !== gWidths
    const { fitCount, fittedWidth } = fitSoftHyphenBreak(
      fitWidths,
      lineW,
      maxWidth,
      lineFitEpsilon,
      discretionaryHyphenWidth,
      usesPrefixWidths,
    )
    if (fitCount === 0) return false

    lineW = fittedWidth
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = fitCount
    clearPendingBreak()

    if (fitCount === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
      return true
    }

    emitCurrentLine(
      segmentIndex,
      fitCount,
      fittedWidth + discretionaryHyphenWidth,
    )
    appendBreakableSegmentFrom(segmentIndex, fitCount)
    return true
  }

  function emitEmptyChunk(chunk: { startSegmentIndex: number, consumedEndSegmentIndex: number }): void {
    lineCount++
    onLine?.({
      startSegmentIndex: chunk.startSegmentIndex,
      startGraphemeIndex: 0,
      endSegmentIndex: chunk.consumedEndSegmentIndex,
      endGraphemeIndex: 0,
      width: 0,
    })
    clearPendingBreak()
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]!
    if (chunk.startSegmentIndex === chunk.endSegmentIndex) {
      emitEmptyChunk(chunk)
      continue
    }

    hasContent = false
    lineW = 0
    lineStartSegmentIndex = chunk.startSegmentIndex
    lineStartGraphemeIndex = 0
    lineEndSegmentIndex = chunk.startSegmentIndex
    lineEndGraphemeIndex = 0
    clearPendingBreak()

    let i = chunk.startSegmentIndex
    while (i < chunk.endSegmentIndex) {
      const kind = kinds[i]!
      const breakAfter = kind === 'space' || kind === 'preserved-space' || kind === 'tab' || kind === 'zero-width-break' || kind === 'soft-hyphen'
      const w = kind === 'tab' ? getTabAdvance(lineW, tabStopAdvance) : widths[i]!

      if (kind === 'soft-hyphen') {
        if (hasContent) {
          lineEndSegmentIndex = i + 1
          lineEndGraphemeIndex = 0
          pendingBreakSegmentIndex = i + 1
          pendingBreakFitWidth = lineW + discretionaryHyphenWidth
          pendingBreakPaintWidth = lineW + discretionaryHyphenWidth
          pendingBreakKind = kind
        }
        i++
        continue
      }

      if (!hasContent) {
        if (w > maxWidth && breakableWidths[i] !== null) {
          appendBreakableSegment(i)
        } else {
          startLineAtSegment(i, w)
        }
        updatePendingBreakForWholeSegment(kind, breakAfter, i, w)
        i++
        continue
      }

      const newW = lineW + w
      if (newW > fitLimit) {
        const currentBreakFitWidth = lineW + (kind === 'tab' ? 0 : lineEndFitAdvances[i]!)
        const currentBreakPaintWidth = lineW + (kind === 'tab' ? w : lineEndPaintAdvances[i]!)

        if (
          pendingBreakKind === 'soft-hyphen' &&
          engineProfile.preferEarlySoftHyphenBreak &&
          pendingBreakFitWidth <= fitLimit
        ) {
          emitCurrentLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth)
          continue
        }

        if (pendingBreakKind === 'soft-hyphen' && continueSoftHyphenBreakableSegment(i)) {
          i++
          continue
        }

        if (breakAfter && currentBreakFitWidth <= fitLimit) {
          appendWholeSegment(i, w)
          emitCurrentLine(i + 1, 0, currentBreakPaintWidth)
          i++
          continue
        }

        if (pendingBreakSegmentIndex >= 0 && pendingBreakFitWidth <= fitLimit) {
          if (
            lineEndSegmentIndex > pendingBreakSegmentIndex ||
            (lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0)
          ) {
            emitCurrentLine()
            continue
          }
          const nextSegmentIndex = pendingBreakSegmentIndex
          emitCurrentLine(nextSegmentIndex, 0, pendingBreakPaintWidth)
          i = nextSegmentIndex
          continue
        }

        if (w > maxWidth && breakableWidths[i] !== null) {
          emitCurrentLine()
          appendBreakableSegment(i)
          i++
          continue
        }

        emitCurrentLine()
        continue
      }

      appendWholeSegment(i, w)
      updatePendingBreakForWholeSegment(kind, breakAfter, i, w)
      i++
    }

    if (hasContent) {
      const finalPaintWidth =
        pendingBreakSegmentIndex === chunk.consumedEndSegmentIndex
          ? pendingBreakPaintWidth
          : lineW
      emitCurrentLine(chunk.consumedEndSegmentIndex, 0, finalPaintWidth)
    }
  }

  return lineCount
}

function stepPreparedChunkLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  chunkIndex: number,
  maxWidth: number,
): number | null {
  const chunk = prepared.chunks[chunkIndex]!
  if (chunk.startSegmentIndex === chunk.endSegmentIndex) {
    cursor.segmentIndex = chunk.consumedEndSegmentIndex
    cursor.graphemeIndex = 0
    return 0
  }

  const {
    widths,
    lineEndFitAdvances,
    lineEndPaintAdvances,
    kinds,
    breakableWidths,
    breakablePrefixWidths,
    discretionaryHyphenWidth,
    tabStopAdvance,
  } = prepared
  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
  const preferPrefixWidths = engineProfile.preferPrefixWidthsForBreakableRuns
  const fitLimit = maxWidth + lineFitEpsilon

  let lineW = 0
  let hasContent = false
  let lineEndSegmentIndex = cursor.segmentIndex
  let lineEndGraphemeIndex = cursor.graphemeIndex
  let pendingBreakSegmentIndex = -1
  let pendingBreakFitWidth = 0
  let pendingBreakPaintWidth = 0
  let pendingBreakKind: SegmentBreakKind | null = null

  function clearPendingBreak(): void {
    pendingBreakSegmentIndex = -1
    pendingBreakFitWidth = 0
    pendingBreakPaintWidth = 0
    pendingBreakKind = null
  }

  function finishLine(
    endSegmentIndex = lineEndSegmentIndex,
    endGraphemeIndex = lineEndGraphemeIndex,
    width = lineW,
  ): number | null {
    if (!hasContent) return null
    cursor.segmentIndex = endSegmentIndex
    cursor.graphemeIndex = endGraphemeIndex
    return width
  }

  function startLineAtSegment(segmentIndex: number, width: number): void {
    hasContent = true
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
    lineW = width
  }

  function startLineAtGrapheme(segmentIndex: number, graphemeIndex: number, width: number): void {
    hasContent = true
    lineEndSegmentIndex = segmentIndex
    lineEndGraphemeIndex = graphemeIndex + 1
    lineW = width
  }

  function appendWholeSegment(segmentIndex: number, width: number): void {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, width)
      return
    }
    lineW += width
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
  }

  function updatePendingBreakForWholeSegment(
    kind: SegmentBreakKind,
    breakAfter: boolean,
    segmentIndex: number,
    segmentWidth: number,
  ): void {
    if (!breakAfter) return
    const fitAdvance = kind === 'tab' ? 0 : lineEndFitAdvances[segmentIndex]!
    const paintAdvance = kind === 'tab' ? segmentWidth : lineEndPaintAdvances[segmentIndex]!
    pendingBreakSegmentIndex = segmentIndex + 1
    pendingBreakFitWidth = lineW - segmentWidth + fitAdvance
    pendingBreakPaintWidth = lineW - segmentWidth + paintAdvance
    pendingBreakKind = kind
  }

  function appendBreakableSegmentFrom(segmentIndex: number, startGraphemeIndex: number): number | null {
    const gWidths = breakableWidths[segmentIndex]!
    const gPrefixWidths = preferPrefixWidths ? breakablePrefixWidths[segmentIndex] ?? null : null
    let previousPrefixWidth =
      gPrefixWidths === null || startGraphemeIndex === 0 ? 0 : gPrefixWidths[startGraphemeIndex - 1]!

    for (let g = startGraphemeIndex; g < gWidths.length; g++) {
      const gw = gPrefixWidths === null ? gWidths[g]! : gPrefixWidths[g]! - previousPrefixWidth

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, gw)
      } else {
        if (lineW + gw > fitLimit) {
          return finishLine()
        }

        lineW += gw
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
      }

      if (gPrefixWidths !== null) previousPrefixWidth = gPrefixWidths[g]!
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === gWidths.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
    return null
  }

  function maybeFinishAtSoftHyphen(segmentIndex: number): number | null {
    if (pendingBreakKind !== 'soft-hyphen' || pendingBreakSegmentIndex < 0) return null

    const gWidths = breakableWidths[segmentIndex] ?? null
    if (gWidths !== null) {
      const fitWidths = engineProfile.preferPrefixWidthsForBreakableRuns
        ? breakablePrefixWidths[segmentIndex] ?? gWidths
        : gWidths
      const usesPrefixWidths = fitWidths !== gWidths
      const { fitCount, fittedWidth } = fitSoftHyphenBreak(
        fitWidths,
        lineW,
        maxWidth,
        lineFitEpsilon,
        discretionaryHyphenWidth,
        usesPrefixWidths,
      )

      if (fitCount === gWidths.length) {
        lineW = fittedWidth
        lineEndSegmentIndex = segmentIndex + 1
        lineEndGraphemeIndex = 0
        clearPendingBreak()
        return null
      }

      if (fitCount > 0) {
        return finishLine(
          segmentIndex,
          fitCount,
          fittedWidth + discretionaryHyphenWidth,
        )
      }
    }

    if (pendingBreakFitWidth <= fitLimit) {
      return finishLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth)
    }

    return null
  }

  for (let i = cursor.segmentIndex; i < chunk.endSegmentIndex; i++) {
    const kind = kinds[i]!
    const breakAfter = kind === 'space' || kind === 'preserved-space' || kind === 'tab' || kind === 'zero-width-break' || kind === 'soft-hyphen'
    const startGraphemeIndex = i === cursor.segmentIndex ? cursor.graphemeIndex : 0
    const w = kind === 'tab' ? getTabAdvance(lineW, tabStopAdvance) : widths[i]!

    if (kind === 'soft-hyphen' && startGraphemeIndex === 0) {
      if (hasContent) {
        lineEndSegmentIndex = i + 1
        lineEndGraphemeIndex = 0
        pendingBreakSegmentIndex = i + 1
        pendingBreakFitWidth = lineW + discretionaryHyphenWidth
        pendingBreakPaintWidth = lineW + discretionaryHyphenWidth
        pendingBreakKind = kind
      }
      continue
    }

    if (!hasContent) {
      if (startGraphemeIndex > 0) {
        const line = appendBreakableSegmentFrom(i, startGraphemeIndex)
        if (line !== null) return line
      } else if (w > maxWidth && breakableWidths[i] !== null) {
        const line = appendBreakableSegmentFrom(i, 0)
        if (line !== null) return line
      } else {
        startLineAtSegment(i, w)
      }
      updatePendingBreakForWholeSegment(kind, breakAfter, i, w)
      continue
    }

    const newW = lineW + w
    if (newW > fitLimit) {
      const currentBreakFitWidth = lineW + (kind === 'tab' ? 0 : lineEndFitAdvances[i]!)
      const currentBreakPaintWidth = lineW + (kind === 'tab' ? w : lineEndPaintAdvances[i]!)

      if (
        pendingBreakKind === 'soft-hyphen' &&
        engineProfile.preferEarlySoftHyphenBreak &&
        pendingBreakFitWidth <= fitLimit
      ) {
        return finishLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth)
      }

      const softBreakLine = maybeFinishAtSoftHyphen(i)
      if (softBreakLine !== null) return softBreakLine

      if (breakAfter && currentBreakFitWidth <= fitLimit) {
        appendWholeSegment(i, w)
        return finishLine(i + 1, 0, currentBreakPaintWidth)
      }

      if (pendingBreakSegmentIndex >= 0 && pendingBreakFitWidth <= fitLimit) {
        if (
          lineEndSegmentIndex > pendingBreakSegmentIndex ||
          (lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0)
        ) {
          return finishLine()
        }
        return finishLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth)
      }

      if (w > maxWidth && breakableWidths[i] !== null) {
        const currentLine = finishLine()
        if (currentLine !== null) return currentLine
        const line = appendBreakableSegmentFrom(i, 0)
        if (line !== null) return line
      }

      return finishLine()
    }

    appendWholeSegment(i, w)
    updatePendingBreakForWholeSegment(kind, breakAfter, i, w)
  }

  if (pendingBreakSegmentIndex === chunk.consumedEndSegmentIndex && lineEndGraphemeIndex === 0) {
    return finishLine(chunk.consumedEndSegmentIndex, 0, pendingBreakPaintWidth)
  }

  return finishLine(chunk.consumedEndSegmentIndex, 0, lineW)
}

function stepPreparedSimpleLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  maxWidth: number,
): number | null {
  const { widths, kinds, breakableWidths, breakablePrefixWidths } = prepared
  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
  const preferPrefixWidths = engineProfile.preferPrefixWidthsForBreakableRuns
  const fitLimit = maxWidth + lineFitEpsilon

  let lineW = 0
  let hasContent = false
  let lineEndSegmentIndex = cursor.segmentIndex
  let lineEndGraphemeIndex = cursor.graphemeIndex
  let pendingBreakSegmentIndex = -1
  let pendingBreakPaintWidth = 0

  for (let i = cursor.segmentIndex; i < widths.length; i++) {
    const w = widths[i]!
    const kind = kinds[i]!
    const breakAfter = kind === 'space' || kind === 'preserved-space' || kind === 'tab' || kind === 'zero-width-break' || kind === 'soft-hyphen'
    const startGraphemeIndex = i === cursor.segmentIndex ? cursor.graphemeIndex : 0
    const breakableWidth = breakableWidths[i]

    if (!hasContent) {
      if (startGraphemeIndex > 0 || (w > maxWidth && breakableWidth !== null)) {
        const gWidths = breakableWidth!
        const gPrefixWidths = preferPrefixWidths ? breakablePrefixWidths[i] ?? null : null
        let previousPrefixWidth =
          gPrefixWidths === null || startGraphemeIndex === 0
            ? 0
            : gPrefixWidths[startGraphemeIndex - 1]!
        const firstGraphemeWidth =
          gPrefixWidths === null
            ? gWidths[startGraphemeIndex]!
            : gPrefixWidths[startGraphemeIndex]! - previousPrefixWidth

        hasContent = true
        lineW = firstGraphemeWidth
        lineEndSegmentIndex = i
        lineEndGraphemeIndex = startGraphemeIndex + 1

        if (gPrefixWidths !== null) previousPrefixWidth = gPrefixWidths[startGraphemeIndex]!

        for (let g = startGraphemeIndex + 1; g < gWidths.length; g++) {
          const gw = gPrefixWidths === null ? gWidths[g]! : gPrefixWidths[g]! - previousPrefixWidth
          if (lineW + gw > fitLimit) {
            cursor.segmentIndex = lineEndSegmentIndex
            cursor.graphemeIndex = lineEndGraphemeIndex
            return lineW
          }
          lineW += gw
          lineEndSegmentIndex = i
          lineEndGraphemeIndex = g + 1
          if (gPrefixWidths !== null) previousPrefixWidth = gPrefixWidths[g]!
        }

        if (lineEndSegmentIndex === i && lineEndGraphemeIndex === gWidths.length) {
          lineEndSegmentIndex = i + 1
          lineEndGraphemeIndex = 0
        }
      } else {
        hasContent = true
        lineW = w
        lineEndSegmentIndex = i + 1
        lineEndGraphemeIndex = 0
      }
      if (breakAfter) {
        pendingBreakSegmentIndex = i + 1
        pendingBreakPaintWidth = lineW - w
      }
      continue
    }

    if (lineW + w > fitLimit) {
      if (breakAfter) {
        cursor.segmentIndex = i + 1
        cursor.graphemeIndex = 0
        return lineW
      }

      if (pendingBreakSegmentIndex >= 0) {
        if (
          lineEndSegmentIndex > pendingBreakSegmentIndex ||
          (lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0)
        ) {
          cursor.segmentIndex = lineEndSegmentIndex
          cursor.graphemeIndex = lineEndGraphemeIndex
          return lineW
        }
        cursor.segmentIndex = pendingBreakSegmentIndex
        cursor.graphemeIndex = 0
        return pendingBreakPaintWidth
      }

      cursor.segmentIndex = lineEndSegmentIndex
      cursor.graphemeIndex = lineEndGraphemeIndex
      return lineW
    }

    lineW += w
    lineEndSegmentIndex = i + 1
    lineEndGraphemeIndex = 0
    if (breakAfter) {
      pendingBreakSegmentIndex = i + 1
      pendingBreakPaintWidth = lineW - w
    }
  }

  if (!hasContent) return null
  cursor.segmentIndex = lineEndSegmentIndex
  cursor.graphemeIndex = lineEndGraphemeIndex
  return lineW
}

export function layoutNextLineRange(
  prepared: PreparedLineBreakData,
  start: LineBreakCursor,
  maxWidth: number,
): InternalLayoutLine | null {
  const end: LineBreakCursor = {
    segmentIndex: start.segmentIndex,
    graphemeIndex: start.graphemeIndex,
  }
  const chunkIndex = normalizeLineStartChunkIndex(prepared, end)
  if (chunkIndex < 0) return null

  const lineStartSegmentIndex = end.segmentIndex
  const lineStartGraphemeIndex = end.graphemeIndex
  const width = prepared.simpleLineWalkFastPath
    ? stepPreparedSimpleLineGeometry(prepared, end, maxWidth)
    : stepPreparedChunkLineGeometry(prepared, end, chunkIndex, maxWidth)
  if (width === null) return null

  return {
    startSegmentIndex: lineStartSegmentIndex,
    startGraphemeIndex: lineStartGraphemeIndex,
    endSegmentIndex: end.segmentIndex,
    endGraphemeIndex: end.graphemeIndex,
    width,
  }
}

export function stepPreparedLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  maxWidth: number,
): number | null {
  const chunkIndex = normalizeLineStartChunkIndex(prepared, cursor)
  if (chunkIndex < 0) return null

  if (prepared.simpleLineWalkFastPath) {
    return stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
  }

  return stepPreparedChunkLineGeometry(prepared, cursor, chunkIndex, maxWidth)
}

export function measurePreparedLineGeometry(
  prepared: PreparedLineBreakData,
  maxWidth: number,
): {
  lineCount: number
  maxLineWidth: number
} {
  if (prepared.widths.length === 0) {
    return {
      lineCount: 0,
      maxLineWidth: 0,
    }
  }

  const cursor: LineBreakCursor = {
    segmentIndex: 0,
    graphemeIndex: 0,
  }
  let lineCount = 0
  let maxLineWidth = 0

  if (!prepared.simpleLineWalkFastPath) {
    let chunkIndex = normalizeLineStartChunkIndex(prepared, cursor)
    while (chunkIndex >= 0) {
      const lineWidth = stepPreparedChunkLineGeometry(prepared, cursor, chunkIndex, maxWidth)
      if (lineWidth === null) {
        return {
          lineCount,
          maxLineWidth,
        }
      }
      lineCount++
      if (lineWidth > maxLineWidth) maxLineWidth = lineWidth
      chunkIndex = normalizeLineStartChunkIndexFromHint(prepared, chunkIndex, cursor)
    }
    return {
      lineCount,
      maxLineWidth,
    }
  }

  while (true) {
    const lineWidth = stepPreparedLineGeometry(prepared, cursor, maxWidth)
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
