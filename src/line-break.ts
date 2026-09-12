import type { SegmentBreakKind } from './analysis.js'
import { getEngineProfile } from './measurement.js'
import { getSegmentEntryWidth, type SegmentEntryGeometry } from './entry-geometry.js'

export type LineBreakCursor = {
  segmentIndex: number
  graphemeIndex: number
}

export type PreparedLineBreakData = {
  widths: number[]
  lineEndFitAdvances: number[]
  lineEndPaintAdvances: number[] // Painted contribution before terminal line-end letter-spacing
  kinds: SegmentBreakKind[]
  simpleLineWalkFastPath: boolean
  breakableFitAdvances: (number[] | null)[]
  breakablePreferredBreaks: (number[] | null)[]
  entryGeometry?: (SegmentEntryGeometry | null)[] | null
  letterSpacing: number
  spacingGraphemeCounts: number[]
  discretionaryHyphenWidth: number
  tabStopAdvance: number
  chunks: {
    startSegmentIndex: number
    endSegmentIndex: number
    consumedEndSegmentIndex: number
  }[]
}

type InternalLineVisitor = (
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
) => void

// End cursors consume source. A terminal SHY is not a selected wrap, even
// though it is the final consumed segment. Rendering derives that distinction
// from the endpoint instead of treating every consumed SHY as visible.
export function isDiscretionaryLineEnd(
  kinds: readonly SegmentBreakKind[],
  endSegmentIndex: number,
  endGraphemeIndex: number,
): boolean {
  return endGraphemeIndex === 0 && endSegmentIndex > 0 && endSegmentIndex < kinds.length && kinds[endSegmentIndex - 1] === 'soft-hyphen'
}

// At a paragraph or hard-break start, ZWSP is real source: it establishes the
// line and offers a break after it. UAX #14 forbids an ordinary break before
// ZWSP. After a forced overflow break browsers can still give ZWSP its own line;
// that start is consumed here, as before.
function consumesAtLineStart(kind: SegmentBreakKind, atChunkStart: boolean): boolean {
  return kind === 'space' || kind === 'soft-hyphen' || (kind === 'zero-width-break' && !atChunkStart)
}

function breaksAfter(kind: SegmentBreakKind): boolean {
  return (
    kind === 'space' ||
    kind === 'preserved-space' ||
    kind === 'tab' ||
    kind === 'zero-width-break' ||
    kind === 'soft-hyphen'
  )
}

function normalizeLineStartSegmentIndex(
  prepared: PreparedLineBreakData,
  segmentIndex: number,
  endSegmentIndex: number,
  atChunkStart: boolean,
): number {
  while (segmentIndex < endSegmentIndex) {
    const kind = prepared.kinds[segmentIndex]!
    if (!consumesAtLineStart(kind, atChunkStart)) break
    segmentIndex++
  }
  return segmentIndex
}

function getTabAdvance(lineWidth: number, tabStopAdvance: number, minimumAdvance: number): number {
  if (tabStopAdvance <= 0) return 0

  const remainder = lineWidth % tabStopAdvance
  if (Math.abs(remainder) <= 1e-6) return tabStopAdvance
  const advance = tabStopAdvance - remainder
  return advance < minimumAdvance ? advance + tabStopAdvance : advance
}

function getLineEndContribution(leadingSpacing: number, segmentContribution: number): number {
  return segmentContribution === 0 ? 0 : leadingSpacing + segmentContribution
}

function getTabTrailingLetterSpacing(
  prepared: PreparedLineBreakData,
  segmentIndex: number,
): number {
  return (
    prepared.letterSpacing !== 0 &&
    prepared.spacingGraphemeCounts[segmentIndex]! > 0
  )
    ? prepared.letterSpacing
    : 0
}

function getWholeSegmentFitContribution(
  prepared: PreparedLineBreakData,
  kind: SegmentBreakKind,
  segmentIndex: number,
  leadingSpacing: number,
  segmentWidth: number,
): number {
  const segmentContribution = kind === 'tab'
    ? segmentWidth + getTabTrailingLetterSpacing(prepared, segmentIndex)
    : prepared.lineEndFitAdvances[segmentIndex]!
  return getLineEndContribution(leadingSpacing, segmentContribution)
}

function getBreakOpportunityFitContribution(
  prepared: PreparedLineBreakData,
  kind: SegmentBreakKind,
  segmentIndex: number,
  leadingSpacing: number,
): number {
  const segmentContribution = kind === 'tab' ? 0 : prepared.lineEndFitAdvances[segmentIndex]!
  return getLineEndContribution(leadingSpacing, segmentContribution)
}

function getLineEndPaintContribution(
  prepared: PreparedLineBreakData,
  kind: SegmentBreakKind,
  segmentIndex: number,
  leadingSpacing: number,
  segmentWidth: number,
): number {
  const segmentContribution = kind === 'tab' ? segmentWidth : prepared.lineEndPaintAdvances[segmentIndex]!
  return getLineEndContribution(leadingSpacing, segmentContribution)
}

function getBreakableGraphemeAdvance(
  prepared: PreparedLineBreakData,
  hasContent: boolean,
  baseAdvance: number,
): number {
  return prepared.letterSpacing !== 0 && hasContent
    ? baseAdvance + prepared.letterSpacing
    : baseAdvance
}

function getBreakableCandidateFitWidth(
  prepared: PreparedLineBreakData,
  candidatePaintWidth: number,
): number {
  return prepared.letterSpacing === 0
    ? candidatePaintWidth
    : candidatePaintWidth + prepared.letterSpacing
}

function getNextPreferredBreakIndex(
  preferredBreaks: number[],
  preferredBreakIndex: number,
  graphemeEnd: number,
): number {
  let lo = preferredBreakIndex
  if (lo >= preferredBreaks.length || preferredBreaks[lo]! >= graphemeEnd) return lo

  // Simple batch walking carries the next boundary. The shared complex loop
  // and public continuations seek instead of rescanning every prior cut.
  let hi = preferredBreaks.length
  lo++
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (preferredBreaks[mid]! < graphemeEnd) lo = mid + 1
    else hi = mid
  }
  return lo
}

function getTerminalLetterSpacing(
  prepared: PreparedLineBreakData,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): number {
  if (prepared.letterSpacing === 0) return 0

  if (endGraphemeIndex > 0) {
    return prepared.spacingGraphemeCounts[endSegmentIndex]! > 0
      ? prepared.letterSpacing
      : 0
  }

  if (isDiscretionaryLineEnd(prepared.kinds, endSegmentIndex, endGraphemeIndex)) return 0

  for (let i = endSegmentIndex - 1; i >= startSegmentIndex; i--) {
    const kind = prepared.kinds[i]!
    if (kind === 'space' || kind === 'zero-width-break' || kind === 'hard-break' || kind === 'soft-hyphen') continue

    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      return prepared.letterSpacing
    }

    return prepared.spacingGraphemeCounts[i]! > 0
      ? prepared.letterSpacing
      : 0
  }

  return 0
}

function finalizeLinePaintWidth(
  prepared: PreparedLineBreakData,
  width: number,
  startSegmentIndex: number,
  startGraphemeIndex: number,
  endSegmentIndex: number,
  endGraphemeIndex: number,
): number {
  return width + getTerminalLetterSpacing(
    prepared,
    startSegmentIndex,
    startGraphemeIndex,
    endSegmentIndex,
    endGraphemeIndex,
  )
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

  // Consumed-only chunks can occur consecutively. Normalize through each of
  // them before entering the walker, while keeping actual empty hard-break
  // chunks observable as empty lines.
  for (let currentChunkIndex = chunkIndex; currentChunkIndex < prepared.chunks.length; currentChunkIndex++) {
    const chunk = prepared.chunks[currentChunkIndex]!
    if (chunk.startSegmentIndex === chunk.endSegmentIndex && segmentIndex === chunk.startSegmentIndex) {
      cursor.segmentIndex = segmentIndex
      cursor.graphemeIndex = 0
      return currentChunkIndex
    }

    if (segmentIndex < chunk.startSegmentIndex) segmentIndex = chunk.startSegmentIndex
    const atChunkStart = segmentIndex === chunk.startSegmentIndex
    segmentIndex = normalizeLineStartSegmentIndex(prepared, segmentIndex, chunk.endSegmentIndex, atChunkStart)
    if (segmentIndex < chunk.endSegmentIndex) {
      cursor.segmentIndex = segmentIndex
      cursor.graphemeIndex = 0
      return currentChunkIndex
    }

    if (chunk.consumedEndSegmentIndex >= prepared.widths.length) return -1
    segmentIndex = chunk.consumedEndSegmentIndex
    cursor.segmentIndex = segmentIndex
    cursor.graphemeIndex = 0
  }
  return -1
}

// Mutates `cursor` to the next renderable line start and returns its chunk index.
export function normalizePreparedLineStart(
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

export function countPreparedLines(prepared: PreparedLineBreakData, maxWidth: number): number {
  return walkPreparedLinesRaw(prepared, maxWidth)
}

function walkPreparedLinesSimple(
  prepared: PreparedLineBreakData,
  maxWidth: number,
  onLine?: InternalLineVisitor,
): number {
  const { widths, kinds, breakableFitAdvances, breakablePreferredBreaks } = prepared
  if (widths.length === 0) return 0

  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
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
    onLine?.(
      width,
      lineStartSegmentIndex,
      lineStartGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
    )
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

  function appendBreakableSegmentFrom(segmentIndex: number, startGraphemeIndex: number): void {
    const fitAdvances = breakableFitAdvances[segmentIndex]!
    const preferredBreaks = breakablePreferredBreaks[segmentIndex] ?? null
    let preferredBreakIndex = preferredBreaks === null
      ? -1
      : getNextPreferredBreakIndex(preferredBreaks, 0, startGraphemeIndex + 1)
    let lastPreferredBreakEnd = -1
    let lastPreferredBreakWidth = 0

    let g = startGraphemeIndex
    while (g < fitAdvances.length) {
      const gw = fitAdvances[g]!

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, gw)
      } else if (lineW + gw > fitLimit) {
        if (preferredBreaks !== null && lastPreferredBreakEnd > startGraphemeIndex) {
          emitCurrentLine(segmentIndex, lastPreferredBreakEnd, lastPreferredBreakWidth)
          g = lastPreferredBreakEnd
          preferredBreakIndex = getNextPreferredBreakIndex(preferredBreaks, preferredBreakIndex, g + 1)
          lastPreferredBreakEnd = -1
          lastPreferredBreakWidth = 0
          continue
        }
        emitCurrentLine()
        startLineAtGrapheme(segmentIndex, g, gw)
      } else {
        lineW += gw
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
      }

      const graphemeEnd = g + 1
      if (preferredBreaks !== null && preferredBreaks[preferredBreakIndex] === graphemeEnd) {
        lastPreferredBreakEnd = graphemeEnd
        lastPreferredBreakWidth = lineW
        preferredBreakIndex++
      }
      g++
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === fitAdvances.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
  }

  let i = 0
  while (i < widths.length) {
    if (!hasContent) {
      i = normalizeLineStartSegmentIndex(prepared, i, widths.length, i === 0)
      if (i >= widths.length) break
    }

    const w = widths[i]!
    const kind = kinds[i]!
    const breakAfter = breaksAfter(kind)

    if (!hasContent) {
      if (w > fitLimit && breakableFitAdvances[i] !== null) {
        appendBreakableSegmentFrom(i, 0)
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

      if (w > fitLimit && breakableFitAdvances[i] !== null) {
        emitCurrentLine()
        appendBreakableSegmentFrom(i, 0)
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

export function walkPreparedLinesRaw(
  prepared: PreparedLineBreakData,
  maxWidth: number,
  onLine?: InternalLineVisitor,
): number {
  if (prepared.simpleLineWalkFastPath) return walkPreparedLinesSimple(prepared, maxWidth, onLine)
  const cursor: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
  const chunkIndex = normalizePreparedLineStart(prepared, cursor)
  return walkPreparedComplexLines(prepared, cursor, chunkIndex, maxWidth, onLine).lineCount
}

function stepPreparedChunkLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  chunkIndex: number,
  maxWidth: number,
): number | null {
  return walkPreparedComplexLines(prepared, cursor, chunkIndex, maxWidth, undefined, 1).lastLineWidth
}

function walkPreparedComplexLines(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  chunkIndex: number,
  maxWidth: number,
  onLine?: InternalLineVisitor,
  lineLimit = Number.POSITIVE_INFINITY,
): { lineCount: number; lastLineWidth: number | null } {
  const {
    widths,
    kinds,
    breakableFitAdvances,
    breakablePreferredBreaks,
    discretionaryHyphenWidth,
    letterSpacing,
    spacingGraphemeCounts,
  } = prepared
  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
  const fitLimit = maxWidth + lineFitEpsilon

  let lineStartSegmentIndex: number
  let lineStartGraphemeIndex: number
  let lineW: number
  let hasContent: boolean
  let lineEndSegmentIndex: number
  let lineEndGraphemeIndex: number
  let pendingBreakSegmentIndex: number
  let pendingBreakFitWidth: number
  let pendingBreakPaintWidth: number
  let pendingBreakKind: SegmentBreakKind | null
  // The last whole segment appended after other line content, and its advance.
  let appendedSegmentIndex: number
  let appendedSegmentAdvance = 0

  function getCurrentLinePaintWidth(): number {
    return (
      pendingBreakKind === 'soft-hyphen' &&
      pendingBreakSegmentIndex === lineEndSegmentIndex &&
      lineEndGraphemeIndex === 0
    )
      ? pendingBreakPaintWidth
      : lineW
  }

  function finishLine(
    endSegmentIndex = lineEndSegmentIndex,
    endGraphemeIndex = lineEndGraphemeIndex,
    width = getCurrentLinePaintWidth(),
  ): number | null {
    if (!hasContent) return null
    cursor.segmentIndex = endSegmentIndex
    cursor.graphemeIndex = endGraphemeIndex
    return finalizeLinePaintWidth(
      prepared,
      width,
      lineStartSegmentIndex,
      lineStartGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
    )
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

  function appendWholeSegment(segmentIndex: number, advance: number): void {
    if (!hasContent) {
      startLineAtSegment(segmentIndex, advance)
      return
    }
    lineW += advance
    lineEndSegmentIndex = segmentIndex + 1
    lineEndGraphemeIndex = 0
  }

  function updatePendingBreakForWholeSegment(
    kind: SegmentBreakKind,
    breakAfter: boolean,
    segmentIndex: number,
    segmentWidth: number,
    leadingSpacing: number,
    advance: number,
  ): void {
    if (!breakAfter) return
    const fitAdvance = getBreakOpportunityFitContribution(prepared, kind, segmentIndex, leadingSpacing)
    const paintAdvance = getLineEndPaintContribution(prepared, kind, segmentIndex, leadingSpacing, segmentWidth)
    pendingBreakSegmentIndex = segmentIndex + 1
    pendingBreakFitWidth = lineW - advance + fitAdvance
    pendingBreakPaintWidth = lineW - advance + paintAdvance
    pendingBreakKind = kind
  }

  function appendBreakableSegmentFrom(segmentIndex: number, startGraphemeIndex: number): number | null {
    const fitAdvances = breakableFitAdvances[segmentIndex]!
    const preferredBreaks = breakablePreferredBreaks[segmentIndex] ?? null
    let preferredBreakIndex = preferredBreaks === null
      ? -1
      : getNextPreferredBreakIndex(preferredBreaks, 0, startGraphemeIndex + 1)
    let lastPreferredBreakEnd = -1
    let lastPreferredBreakWidth = 0

    const entry = prepared.entryGeometry?.[segmentIndex]
    const freshWhole = getSegmentEntryWidth(entry, startGraphemeIndex, fitAdvances.length)
    if (freshWhole !== null) {
      const terminal = prepared.letterSpacing
      if (entry!.entries[startGraphemeIndex]!.admissionFit <= fitLimit) {
        startLineAtSegment(segmentIndex, freshWhole - terminal)
        return null
      }
      // Admission, ordered emergency prefixes and continuing pen are distinct.
      // The first real grapheme is mandatory source progress, even when unfit.
      for (let g = startGraphemeIndex; g < fitAdvances.length; g++) {
        const fresh = getSegmentEntryWidth(entry, startGraphemeIndex, g + 1)!
        if (g > startGraphemeIndex && fresh > fitLimit) {
          return lastPreferredBreakEnd > startGraphemeIndex
            ? finishLine(segmentIndex, lastPreferredBreakEnd, lastPreferredBreakWidth)
            : finishLine()
        }
        startLineAtGrapheme(segmentIndex, g, fresh - terminal)
        if (preferredBreaks !== null && preferredBreaks[preferredBreakIndex] === g + 1) {
          lastPreferredBreakEnd = g + 1
          lastPreferredBreakWidth = lineW
          preferredBreakIndex++
        }
      }
      // Exhausting an emergency fragment consumes the measured segment and
      // ends this line. Only intact admission above continues into other source.
      return finishLine(segmentIndex + 1, 0)
    }

    for (let g = startGraphemeIndex; g < fitAdvances.length; g++) {
      const baseGw = fitAdvances[g]!

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, baseGw)
      } else {
        const gw = getBreakableGraphemeAdvance(prepared, true, baseGw)
        const candidatePaintWidth = lineW + gw
        if (getBreakableCandidateFitWidth(prepared, candidatePaintWidth) > fitLimit) {
          if (preferredBreaks !== null && lastPreferredBreakEnd > startGraphemeIndex) {
            return finishLine(segmentIndex, lastPreferredBreakEnd, lastPreferredBreakWidth)
          }
          return finishLine()
        }

        lineW = candidatePaintWidth
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
      }

      const graphemeEnd = g + 1
      if (preferredBreaks !== null && preferredBreaks[preferredBreakIndex] === graphemeEnd) {
        lastPreferredBreakEnd = graphemeEnd
        lastPreferredBreakWidth = lineW
        preferredBreakIndex++
      }
    }

    if (hasContent && lineEndSegmentIndex === segmentIndex && lineEndGraphemeIndex === fitAdvances.length) {
      lineEndSegmentIndex = segmentIndex + 1
      lineEndGraphemeIndex = 0
    }
    return null
  }

  let lineCount = 0
  let lastLineWidth: number | null = null
  while (chunkIndex >= 0 && lineCount < lineLimit) {
    lineStartSegmentIndex = cursor.segmentIndex
    lineStartGraphemeIndex = cursor.graphemeIndex
    lineW = 0
    hasContent = false
    lineEndSegmentIndex = cursor.segmentIndex
    lineEndGraphemeIndex = cursor.graphemeIndex
    pendingBreakSegmentIndex = -1
    pendingBreakFitWidth = 0
    pendingBreakPaintWidth = 0
    pendingBreakKind = null
    appendedSegmentIndex = -1
    // Retained line-start ZWSP establishes the line without owning a spacing gap.
    let zeroWidthPrefix = true
    let afterUnspacedControl = false

    const chunk = prepared.chunks[chunkIndex]!
    let lineWidth: number | null = null
    if (chunk.startSegmentIndex === chunk.endSegmentIndex) {
      cursor.segmentIndex = chunk.consumedEndSegmentIndex
      cursor.graphemeIndex = 0
      lineWidth = 0
    } else {
      lineLoop: for (let i = cursor.segmentIndex; i < chunk.endSegmentIndex; i++) {
        const kind = kinds[i]!
        const breakAfter = breaksAfter(kind)
        const startGraphemeIndex = i === cursor.segmentIndex ? cursor.graphemeIndex : 0
        // The gap before a segment belongs to the grapheme before it. A control
        // that takes no letter spacing still follows that gap but adds none
        // after itself; zero-width breaks and soft hyphens leave it as it was.
        let leadingSpacing = 0
        if (letterSpacing !== 0 && (spacingGraphemeCounts[i]! > 0 || kind === 'control')) {
          if (hasContent && !zeroWidthPrefix && !afterUnspacedControl) leadingSpacing = letterSpacing
          afterUnspacedControl = spacingGraphemeCounts[i] === 0
        }
        if (kind !== 'zero-width-break') zeroWidthPrefix = false
        // Tab stops are eight spaces apart, so half a space is a sixteenth of one.
        const w = kind === 'tab'
          ? getTabAdvance(lineW + leadingSpacing, prepared.tabStopAdvance, engineProfile.skipNarrowTabStops ? prepared.tabStopAdvance / 16 : 0)
          : widths[i]!
        const advance = leadingSpacing + w
        const fitAdvance = getWholeSegmentFitContribution(prepared, kind, i, leadingSpacing, w)

        if (kind === 'soft-hyphen' && startGraphemeIndex === 0) {
          if (hasContent) {
            lineEndSegmentIndex = i + 1
            lineEndGraphemeIndex = 0
            if (i + 1 < chunk.endSegmentIndex) {
              pendingBreakSegmentIndex = i + 1
              pendingBreakFitWidth = lineW + discretionaryHyphenWidth
              pendingBreakPaintWidth = lineW + discretionaryHyphenWidth
              pendingBreakKind = kind
            }
          }
          continue
        }

        if (!hasContent) {
          if (startGraphemeIndex > 0) {
            const line = appendBreakableSegmentFrom(i, startGraphemeIndex)
            if (line !== null) {
              lineWidth = line
              break lineLoop
            }
          } else if (fitAdvance > fitLimit && breakableFitAdvances[i] !== null) {
            const line = appendBreakableSegmentFrom(i, 0)
            if (line !== null) {
              lineWidth = line
              break lineLoop
            }
          } else {
            startLineAtSegment(i, w)
          }
          updatePendingBreakForWholeSegment(kind, breakAfter, i, w, leadingSpacing, advance)
          continue
        }

        const newFitW = lineW + fitAdvance
        if (newFitW > fitLimit) {
          // UAX #14 LB6: no ordinary break before NEL. The line ends before the
          // text or glue that NEL follows instead. When that content started
          // the line, overflow still breaks right before the NEL.
          if (kind === 'control' && appendedSegmentIndex === i - 1 && (kinds[i - 1] === 'text' || kinds[i - 1] === 'glue')) {
            lineW -= appendedSegmentAdvance
            lineEndSegmentIndex = i - 1
            lineEndGraphemeIndex = 0
          }
          const currentBreakFitWidth =
            lineW + getBreakOpportunityFitContribution(prepared, kind, i, leadingSpacing)
          const currentBreakPaintWidth =
            lineW + getLineEndPaintContribution(prepared, kind, i, leadingSpacing, w)

          if (breakAfter && currentBreakFitWidth <= fitLimit) {
            appendWholeSegment(i, advance)
            lineWidth = finishLine(i + 1, 0, currentBreakPaintWidth)
            break lineLoop
          }

          if (pendingBreakSegmentIndex >= 0 && pendingBreakFitWidth <= fitLimit) {
            if (
              lineEndSegmentIndex > pendingBreakSegmentIndex ||
              (lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0)
            ) {
              lineWidth = finishLine()
              break lineLoop
            }
            lineWidth = finishLine(pendingBreakSegmentIndex, 0, pendingBreakPaintWidth)
            break lineLoop
          }

          lineWidth = finishLine()
          break lineLoop
        }

        appendWholeSegment(i, advance)
        updatePendingBreakForWholeSegment(kind, breakAfter, i, w, leadingSpacing, advance)
        appendedSegmentIndex = i
        appendedSegmentAdvance = advance
      }

      if (lineWidth === null) {
        lineWidth = pendingBreakSegmentIndex === chunk.consumedEndSegmentIndex && lineEndGraphemeIndex === 0
          ? finishLine(chunk.consumedEndSegmentIndex, 0, pendingBreakPaintWidth)
          : finishLine(chunk.consumedEndSegmentIndex, 0, lineW)
      }
    }
    if (lineWidth === null) break
    lastLineWidth = lineWidth
    lineCount++
    onLine?.(lineWidth, lineStartSegmentIndex, lineStartGraphemeIndex, cursor.segmentIndex, cursor.graphemeIndex)
    // A single-line caller owns normalization of the following line.
    if (lineCount < lineLimit) chunkIndex = normalizeLineStartChunkIndexFromHint(prepared, chunkIndex, cursor)
  }
  return { lineCount, lastLineWidth }
}

function stepPreparedSimpleLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  maxWidth: number,
): number | null {
  const { widths, kinds, breakableFitAdvances, breakablePreferredBreaks } = prepared
  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
  const fitLimit = maxWidth + lineFitEpsilon

  let lineW = 0
  let hasContent = false
  let lineEndSegmentIndex = cursor.segmentIndex
  let lineEndGraphemeIndex = cursor.graphemeIndex
  let pendingBreakSegmentIndex = -1
  let pendingBreakPaintWidth = 0

  for (let i = cursor.segmentIndex; i < widths.length; i++) {
    const kind = kinds[i]!
    const breakAfter = breaksAfter(kind)
    const startGraphemeIndex = i === cursor.segmentIndex ? cursor.graphemeIndex : 0
    const breakableFitAdvance = breakableFitAdvances[i]
    const w = widths[i]!

    if (!hasContent) {
      if (startGraphemeIndex > 0 || (w > fitLimit && breakableFitAdvance !== null)) {
        const fitAdvances = breakableFitAdvance!
        const preferredBreaks = breakablePreferredBreaks[i] ?? null
        let preferredBreakIndex = preferredBreaks === null
          ? -1
          : getNextPreferredBreakIndex(preferredBreaks, 0, startGraphemeIndex + 1)
        let lastPreferredBreakEnd = -1
        let lastPreferredBreakWidth = 0
        const firstGraphemeWidth = fitAdvances[startGraphemeIndex]!

        hasContent = true
        lineW = firstGraphemeWidth
        lineEndSegmentIndex = i
        lineEndGraphemeIndex = startGraphemeIndex + 1
        if (preferredBreaks !== null && preferredBreaks[preferredBreakIndex] === lineEndGraphemeIndex) {
          lastPreferredBreakEnd = lineEndGraphemeIndex
          lastPreferredBreakWidth = lineW
          preferredBreakIndex++
        }

        for (let g = startGraphemeIndex + 1; g < fitAdvances.length; g++) {
          const gw = fitAdvances[g]!
          if (lineW + gw > fitLimit) {
            if (preferredBreaks !== null && lastPreferredBreakEnd > startGraphemeIndex) {
              cursor.segmentIndex = i
              cursor.graphemeIndex = lastPreferredBreakEnd
              return lastPreferredBreakWidth
            }
            cursor.segmentIndex = lineEndSegmentIndex
            cursor.graphemeIndex = lineEndGraphemeIndex
            return lineW
          }
          lineW += gw
          lineEndSegmentIndex = i
          lineEndGraphemeIndex = g + 1
          if (preferredBreaks !== null && preferredBreaks[preferredBreakIndex] === lineEndGraphemeIndex) {
            lastPreferredBreakEnd = lineEndGraphemeIndex
            lastPreferredBreakWidth = lineW
            preferredBreakIndex++
          }
        }

        if (lineEndSegmentIndex === i && lineEndGraphemeIndex === fitAdvances.length) {
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

export function stepPreparedLineGeometryFromChunk(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  chunkIndex: number,
  maxWidth: number,
): number | null {
  if (prepared.simpleLineWalkFastPath) {
    return stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
  }

  return stepPreparedChunkLineGeometry(prepared, cursor, chunkIndex, maxWidth)
}

export function stepPreparedLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  maxWidth: number,
): number | null {
  const chunkIndex = normalizePreparedLineStart(prepared, cursor)
  if (chunkIndex < 0) return null
  return stepPreparedLineGeometryFromChunk(prepared, cursor, chunkIndex, maxWidth)
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
    const chunkIndex = normalizePreparedLineStart(prepared, cursor)
    lineCount = walkPreparedComplexLines(prepared, cursor, chunkIndex, maxWidth, width => {
      if (width > maxLineWidth) maxLineWidth = width
    }).lineCount
    return { lineCount, maxLineWidth }
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
