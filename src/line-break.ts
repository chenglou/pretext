import type { SegmentBreakKind } from './analysis.js'
import { getEngineProfile } from './measurement.js'
import { getSegmentEntryWidth, type SegmentEntryGeometry } from './entry-geometry.js'

export type LineBreakCursor = {
  segmentIndex: number
  graphemeIndex: number
}

export type PreparedLineBreakData = {
  widths: number[]
  kinds: SegmentBreakKind[]
  simpleLineWalkFastPath: boolean
  breakableFitAdvances: (number[] | null)[]
  breakablePreferredBreaks: (number[] | null)[]
  entryGeometry?: (SegmentEntryGeometry | null)[] | null
  letterSpacing: number
  spacingGraphemeCounts: number[]
  discretionaryHyphenWidth: number
  discretionaryHyphenContexts?: boolean[] | null
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

export function breaksAfter(kind: SegmentBreakKind): boolean {
  return (
    kind === 'space' ||
    kind === 'preserved-space' ||
    kind === 'tab' ||
    kind === 'zero-width-break' ||
    kind === 'soft-hyphen'
  )
}

// Preserved spaces and tabs at the end of a line hang past it (CSS Text 3
// §4.1.2), so they take no room when fitting and don't size the line (§8.2).
// Gecko doesn't hang tabs.
function isHangingWhiteSpace(kind: SegmentBreakKind, hangTabs: boolean): boolean {
  return kind === 'preserved-space' || (hangTabs && kind === 'tab')
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

function getTrailingLetterSpacing(
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

// A line that ends after a whole segment charges its advance and the letter
// spacing gap after it. Spaces and zero-width breaks hang, and zero-width text
// owns no gap, though NEL does. The walker handles soft hyphens before this.
function getWholeSegmentFitContribution(
  prepared: PreparedLineBreakData,
  kind: SegmentBreakKind,
  breakAfter: boolean,
  segmentIndex: number,
  leadingSpacing: number,
  segmentWidth: number,
): number {
  if (breakAfter ? kind !== 'tab' : segmentWidth === 0 && kind !== 'control') return 0
  return getLineEndContribution(leadingSpacing, segmentWidth + getTrailingLetterSpacing(prepared, segmentIndex))
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
  // A run of preserved spaces and tabs that hangs where the line wraps already
  // charged the gap after the glyph before it.
  if (
    endSegmentIndex < prepared.kinds.length &&
    prepared.kinds[endSegmentIndex] !== 'hard-break' &&
    isHangingWhiteSpace(prepared.kinds[endSegmentIndex - 1]!, getEngineProfile().hangTabs)
  ) {
    return 0
  }

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
  // CSS widths are never negative. Every walker lays out a negative width as 0,
  // where zero-width content still fits, so the walkers agree there too.
  const fitLimit = Math.max(0, maxWidth) + lineFitEpsilon

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
  endSegmentIndex: number,
  endGraphemeIndex: number,
): number | null {
  return walkPreparedComplexLines(prepared, cursor, chunkIndex, maxWidth, undefined, 1, endSegmentIndex, endGraphemeIndex).lastLineWidth
}

// A return from an unfit discretionary hyphen needs an overflow that isolated
// widths can show and a target that really is the latest opportunity. No soft
// hyphen on the line may measure narrower joined than apart, and nothing after
// the target may be text after text or a dash inside a segment, which can hold an
// opportunity that segment kinds don't mark, such as after `-` or between
// ideographs. Checked only on a line that would end at an unfit hyphen. The
// target can be a segment start that follows a break outside the prepared
// text, such as a rich-inline item boundary.
export function canReturnFromUnfitHyphen(
  prepared: PreparedLineBreakData,
  lineStartSegmentIndex: number,
  targetSegmentIndex: number,
  softHyphenIndex: number,
): boolean {
  const discretionaryHyphenContexts = prepared.discretionaryHyphenContexts ?? null
  if (discretionaryHyphenContexts === null || getEngineProfile().unfitHyphenRetreat !== 'reduced-width') return false
  for (let i = lineStartSegmentIndex; i <= softHyphenIndex; i++) {
    if (discretionaryHyphenContexts[i]) return false
  }
  const { kinds, breakablePreferredBreaks } = prepared
  for (let i = targetSegmentIndex; i < softHyphenIndex; i++) {
    if (breaksAfter(kinds[i]!)) continue
    if ((i > targetSegmentIndex && !breaksAfter(kinds[i - 1]!)) || breakablePreferredBreaks[i] !== null) return false
  }
  return true
}

function walkPreparedComplexLines(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  chunkIndex: number,
  maxWidth: number,
  onLine?: InternalLineVisitor,
  lineLimit = Number.POSITIVE_INFINITY,
  // A single-line caller can end stepping at an ordinary break before this
  // cursor, as if the text continued past it.
  endSegmentLimit = Number.POSITIVE_INFINITY,
  endGraphemeLimit = 0,
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
  const hangTabs = engineProfile.hangTabs
  // A negative width lays out as 0, as in the simple walker.
  const availableWidth = Math.max(0, maxWidth)
  const fitLimit = availableWidth + lineFitEpsilon
  // Preparation records soft-hyphen contexts only where the engine retreats
  // and the text has a soft hyphen; hand-built handles may omit them.
  const discretionaryHyphenContexts = prepared.discretionaryHyphenContexts ?? null
  const retreatsFromUnfitHyphen =
    discretionaryHyphenContexts !== null && engineProfile.unfitHyphenRetreat === 'reduced-width'

  let lineStartSegmentIndex: number
  let lineStartGraphemeIndex: number
  let lineW: number
  let hasContent: boolean
  let lineEndSegmentIndex: number
  let lineEndGraphemeIndex: number
  let pendingBreakSegmentIndex: number
  // A line that ends at the pending break both fits and paints this width.
  let pendingBreakWidth: number
  let pendingBreakKind: SegmentBreakKind | null
  // The latest opportunity whose line leaves room for the hyphen, which Blink's
  // retry against the width minus the hyphen returns to when a selected
  // discretionary hyphen does not fit, with that line's painted width.
  let fitBreakSegmentIndex: number
  let fitBreakPaintWidth: number
  // The last whole segment appended after other line content, and its advance.
  let appendedSegmentIndex: number
  let appendedSegmentAdvance = 0
  // The latest run of preserved spaces and tabs: the segment after it, and the
  // line's width before it, with the gap after the glyph before it.
  let hangEndSegmentIndex: number
  let hangStartWidth = 0

  function getCurrentLinePaintWidth(): number {
    return (
      pendingBreakKind === 'soft-hyphen' &&
      pendingBreakSegmentIndex === lineEndSegmentIndex &&
      lineEndGraphemeIndex === 0
    )
      ? pendingBreakWidth
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
    // Preserved spaces and tabs before a hard break or the end of the text
    // hang only where they don't fit (CSS Text 3 §8.2).
    const hangsWhereUnfit =
      endGraphemeIndex === 0 &&
      hangEndSegmentIndex >= 0 &&
      (endSegmentIndex === hangEndSegmentIndex || endSegmentIndex === hangEndSegmentIndex + 1) &&
      (hangEndSegmentIndex === kinds.length || kinds[hangEndSegmentIndex] === 'hard-break')
    const paintWidth = finalizeLinePaintWidth(
      prepared,
      hangsWhereUnfit ? lineW : width,
      lineStartSegmentIndex,
      lineStartGraphemeIndex,
      endSegmentIndex,
      endGraphemeIndex,
    )
    return hangsWhereUnfit ? Math.max(hangStartWidth, Math.min(paintWidth, availableWidth)) : paintWidth
  }

  // A line that would end at a selected discretionary hyphen that does not fit
  // returns to the recorded earlier opportunity. Null without one, where the
  // hyphen overflows.
  function finishLineBeforeUnfitHyphen(): number | null {
    if (
      fitBreakSegmentIndex < 0 ||
      pendingBreakKind !== 'soft-hyphen' ||
      pendingBreakSegmentIndex !== lineEndSegmentIndex ||
      lineEndGraphemeIndex !== 0 ||
      pendingBreakWidth <= fitLimit ||
      !canReturnFromUnfitHyphen(
        prepared,
        lineStartSegmentIndex,
        fitBreakSegmentIndex,
        lineEndSegmentIndex - 1,
      )
    ) {
      return null
    }
    return finishLine(fitBreakSegmentIndex, 0, fitBreakPaintWidth)
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
    advance: number,
  ): void {
    if (!breakAfter) return
    pendingBreakSegmentIndex = segmentIndex + 1
    // The break segment hangs with the gap before it, a run of preserved spaces
    // and tabs hangs whole, and a tab that doesn't hang counts whole.
    pendingBreakWidth = isHangingWhiteSpace(kind, hangTabs) ? hangStartWidth : kind === 'tab' ? lineW : lineW - advance
    pendingBreakKind = kind
  }

  function appendBreakableSegmentFrom(
    segmentIndex: number,
    startGraphemeIndex: number,
    endGraphemeIndex = breakableFitAdvances[segmentIndex]!.length,
  ): number | null {
    const fitAdvances = breakableFitAdvances[segmentIndex]!
    const preferredBreaks = breakablePreferredBreaks[segmentIndex] ?? null
    let preferredBreakIndex = preferredBreaks === null
      ? -1
      : getNextPreferredBreakIndex(preferredBreaks, 0, startGraphemeIndex + 1)
    let lastPreferredBreakEnd = -1
    let lastPreferredBreakWidth = 0

    const entry = prepared.entryGeometry?.[segmentIndex]
    // Entry geometry describes whole segment tails, not a caller's grapheme limit.
    const freshWhole = endGraphemeIndex === fitAdvances.length
      ? getSegmentEntryWidth(entry, startGraphemeIndex, fitAdvances.length)
      : null
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

    for (let g = startGraphemeIndex; g < endGraphemeIndex; g++) {
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
    pendingBreakWidth = 0
    pendingBreakKind = null
    fitBreakSegmentIndex = -1
    fitBreakPaintWidth = 0
    appendedSegmentIndex = -1
    hangEndSegmentIndex = -1
    // Retained line-start ZWSP establishes the line without owning a spacing gap.
    let zeroWidthPrefix = true
    let afterUnspacedControl = false

    const chunk = prepared.chunks[chunkIndex]!
    const endSegmentIndex = Math.min(chunk.endSegmentIndex, endSegmentLimit)
    const consumedEndSegmentIndex = endSegmentIndex < chunk.endSegmentIndex
      ? endSegmentIndex
      : chunk.consumedEndSegmentIndex
    let lineWidth: number | null = null
    if (chunk.startSegmentIndex === chunk.endSegmentIndex) {
      cursor.segmentIndex = chunk.consumedEndSegmentIndex
      cursor.graphemeIndex = 0
      lineWidth = 0
    } else {
      lineLoop: for (let i = cursor.segmentIndex; i < endSegmentIndex; i++) {
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

        if (kind === 'soft-hyphen' && startGraphemeIndex === 0) {
          if (hasContent) {
            lineEndSegmentIndex = i + 1
            lineEndGraphemeIndex = 0
            if (i + 1 < chunk.endSegmentIndex) {
              pendingBreakSegmentIndex = i + 1
              pendingBreakWidth = lineW + discretionaryHyphenWidth
              pendingBreakKind = kind
              // A soft hyphen's fit already includes its own hyphen.
              if (retreatsFromUnfitHyphen && pendingBreakWidth <= fitLimit) {
                fitBreakSegmentIndex = pendingBreakSegmentIndex
                fitBreakPaintWidth = pendingBreakWidth
              }
            }
          }
          continue
        }

        const fitAdvance = getWholeSegmentFitContribution(prepared, kind, breakAfter, i, leadingSpacing, w)
        const hangs = breakAfter && isHangingWhiteSpace(kind, hangTabs)
        if (hangs) {
          if (hangEndSegmentIndex !== i) hangStartWidth = lineW + leadingSpacing
          hangEndSegmentIndex = i + 1
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
          updatePendingBreakForWholeSegment(kind, breakAfter, i, advance)
          if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + discretionaryHyphenWidth <= fitLimit) {
            fitBreakSegmentIndex = pendingBreakSegmentIndex
            fitBreakPaintWidth = pendingBreakWidth
          }
          continue
        }

        // A run of preserved spaces and tabs fits where the text before it fits.
        const newFitW = hangs ? hangStartWidth : lineW + fitAdvance
        if (newFitW > fitLimit) {
          // UAX #14 LB6: no ordinary break before NEL. The line ends before the
          // text or glue that NEL follows instead. When that content started
          // the line, overflow still breaks right before the NEL.
          if (kind === 'control' && appendedSegmentIndex === i - 1 && (kinds[i - 1] === 'text' || kinds[i - 1] === 'glue')) {
            lineW -= appendedSegmentAdvance
            lineEndSegmentIndex = i - 1
            lineEndGraphemeIndex = 0
          }
          // A break segment hangs with the gap before it. A collapsible space or
          // ZWSP hangs even after overflowing content that started the line, as
          // the simple walker does; a preserved space there starts the next line.
          if (breakAfter && (lineW <= fitLimit ||
            (pendingBreakSegmentIndex < 0 && (kind === 'space' || kind === 'zero-width-break')))) {
            const currentBreakWidth = hangs ? hangStartWidth : kind === 'tab' ? lineW + advance : lineW
            appendWholeSegment(i, advance)
            lineWidth = finishLine(i + 1, 0, currentBreakWidth)
            break lineLoop
          }

          if (pendingBreakSegmentIndex >= 0 && pendingBreakWidth <= fitLimit) {
            if (
              lineEndSegmentIndex > pendingBreakSegmentIndex ||
              (lineEndSegmentIndex === pendingBreakSegmentIndex && lineEndGraphemeIndex > 0)
            ) {
              lineWidth = finishLine()
              break lineLoop
            }
            lineWidth = finishLine(pendingBreakSegmentIndex, 0, pendingBreakWidth)
            break lineLoop
          }

          lineWidth = finishLineBeforeUnfitHyphen() ?? finishLine()
          break lineLoop
        }

        appendWholeSegment(i, advance)
        updatePendingBreakForWholeSegment(kind, breakAfter, i, advance)
        if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + discretionaryHyphenWidth <= fitLimit) {
          fitBreakSegmentIndex = pendingBreakSegmentIndex
          fitBreakPaintWidth = pendingBreakWidth
        }
        appendedSegmentIndex = i
        appendedSegmentAdvance = advance
      }

      // A limit inside a breakable text segment walks its leading graphemes as
      // the last unit of the line.
      if (lineWidth === null && endGraphemeLimit > 0 && endSegmentLimit < chunk.endSegmentIndex) {
        if (!hasContent) {
          const startGraphemeIndex = endSegmentLimit === cursor.segmentIndex ? cursor.graphemeIndex : 0
          lineWidth = appendBreakableSegmentFrom(endSegmentLimit, startGraphemeIndex, endGraphemeLimit) ??
            finishLine(endSegmentLimit, endGraphemeLimit, lineW)
        } else {
          const fitAdvances = breakableFitAdvances[endSegmentLimit]!
          let advance = letterSpacing !== 0 && spacingGraphemeCounts[endSegmentLimit]! > 0 && !zeroWidthPrefix && !afterUnspacedControl
            ? letterSpacing
            : 0
          for (let g = 0; g < endGraphemeLimit; g++) {
            advance += getBreakableGraphemeAdvance(prepared, g > 0, fitAdvances[g]!)
          }
          if (getBreakableCandidateFitWidth(prepared, lineW + advance) <= fitLimit) {
            lineW += advance
            lineWidth = finishLine(endSegmentLimit, endGraphemeLimit, lineW)
          } else if (
            pendingBreakSegmentIndex >= 0 &&
            pendingBreakWidth <= fitLimit &&
            lineEndSegmentIndex === pendingBreakSegmentIndex &&
            lineEndGraphemeIndex === 0
          ) {
            lineWidth = finishLine(pendingBreakSegmentIndex, 0, pendingBreakWidth)
          } else {
            lineWidth = finishLineBeforeUnfitHyphen() ?? finishLine()
          }
        }
      }
      // A limit before the chunk end is an ordinary break before later text, so
      // a line that ends there at an unfit selected hyphen returns as well.
      if (lineWidth === null) {
        lineWidth = pendingBreakSegmentIndex === consumedEndSegmentIndex && lineEndGraphemeIndex === 0
          ? finishLineBeforeUnfitHyphen() ?? finishLine(consumedEndSegmentIndex, 0, pendingBreakWidth)
          : finishLine(consumedEndSegmentIndex, 0, lineW)
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
  // A negative width lays out as 0, as in the batch walkers.
  const fitLimit = Math.max(0, maxWidth) + lineFitEpsilon

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

// An end cursor stops stepping at an ordinary break there, as if the text were
// cut at it, and returns the paint width of a line that ends there. A cursor
// inside a segment needs that segment's breakable fit advances.
export function stepPreparedLineGeometryFromChunk(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  chunkIndex: number,
  maxWidth: number,
  endSegmentIndex = prepared.widths.length,
  endGraphemeIndex = 0,
): number | null {
  if (prepared.simpleLineWalkFastPath && endSegmentIndex === prepared.widths.length) {
    return stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)
  }

  return stepPreparedChunkLineGeometry(prepared, cursor, chunkIndex, maxWidth, endSegmentIndex, endGraphemeIndex)
}

export function stepPreparedLineGeometry(
  prepared: PreparedLineBreakData,
  cursor: LineBreakCursor,
  maxWidth: number,
  endSegmentIndex = prepared.widths.length,
  endGraphemeIndex = 0,
): number | null {
  const chunkIndex = normalizePreparedLineStart(prepared, cursor)
  if (chunkIndex < 0) return null
  return stepPreparedLineGeometryFromChunk(prepared, cursor, chunkIndex, maxWidth, endSegmentIndex, endGraphemeIndex)
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
