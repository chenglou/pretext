import type { SegmentBreakKind } from './analysis.js'
import { getEngineProfile } from './measurement.js'
import { getSegmentEntryWidth, type SegmentEntryGeometry } from './entry-geometry.js'

export type LineBreakCursor = {
  segmentIndex: number
  graphemeIndex: number
}

// The prepared handle's line-break data: parallel arrays per segment.
export type PreparedLineBreakData = {
  widths: number[] // Segment widths, e.g. [42.5, 4.4, 37.2]
  kinds: SegmentBreakKind[] // Break behavior per segment, e.g. ['text', 'space', 'text']
  simpleLineWalkFastPath: boolean // Normal text can use the simpler old line walker across all layout APIs
  breakableFitAdvances: (number[] | null)[] // Per-grapheme fit advances for breakable segments, else null
  entryGeometry: (SegmentEntryGeometry | null)[] | null // Per segment, how its tails fit on a fresh line; null without any
  // Per segment, false where an engine's scan gives no break before text, glue,
  // zero-width glue or a control, so no line ends there. Null without one.
  breaksBefore: boolean[] | null
  // Per segment with breakable fit advances, the graphemes that can't start a line, which
  // a line holding only an overflowing first grapheme keeps. Null without any.
  lineStartProhibitions: (number[] | null)[] | null
  letterSpacing: number // Extra advance between rendered graphemes on the same line
  spacingGraphemeCounts: number[] // Rendered grapheme counts for letter-spacing gaps; empty when letterSpacing is 0
  discretionaryHyphenWidth: number // Visible width added when a soft hyphen is chosen as the break
  // Per segment, true for a soft hyphen whose neighboring text measures narrower
  // joined than apart. Null when the text has no soft hyphen or the engine keeps
  // an unfit hyphen.
  discretionaryHyphenContexts: boolean[] | null
  tabStopAdvance: number // Absolute advance between tab stops for pre-wrap tab segments
  // Hard-break chunks for line walking. Callers should not depend on this representation.
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
  const contribution = segmentWidth + getTrailingLetterSpacing(prepared, segmentIndex)
  return contribution === 0 ? 0 : leadingSpacing + contribution
}

function getBreakableCandidateFitWidth(
  prepared: PreparedLineBreakData,
  candidatePaintWidth: number,
): number {
  return prepared.letterSpacing === 0
    ? candidatePaintWidth
    : candidatePaintWidth + prepared.letterSpacing
}

// Where a line that holds only an overflowing grapheme ends: after that grapheme and
// the graphemes after it that can't start a line, up to `endGraphemeIndex`.
function getOverflowingFirstGraphemeEnd(
  prepared: PreparedLineBreakData,
  segmentIndex: number,
  graphemeIndex: number,
  endGraphemeIndex: number,
): number {
  const prohibitions = prepared.lineStartProhibitions?.[segmentIndex] ?? null
  let end = graphemeIndex + 1
  while (prohibitions !== null && end < endGraphemeIndex && prohibitions.includes(end)) end++
  return end
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
    // Segments that take no letter spacing, such as zero-width glue or marks
    // shaped on the grapheme before them, leave that grapheme's gap last.
    if (kind === 'space' || (kind !== 'control' && prepared.spacingGraphemeCounts[i] === 0)) continue

    if (i === startSegmentIndex && startGraphemeIndex > 0) {
      return prepared.letterSpacing
    }

    return prepared.spacingGraphemeCounts[i]! > 0
      ? prepared.letterSpacing
      : 0
  }

  return 0
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

export function walkPreparedLinesRaw(
  prepared: PreparedLineBreakData,
  maxWidth: number,
  onLine?: InternalLineVisitor,
): number {
  const cursor: LineBreakCursor = { segmentIndex: 0, graphemeIndex: 0 }
  if (!prepared.simpleLineWalkFastPath) {
    const chunkIndex = normalizePreparedLineStart(prepared, cursor)
    return walkPreparedComplexLines(prepared, cursor, chunkIndex, maxWidth, onLine).lineCount
  }
  // A fast-path handle is one chunk of text, spaces and ZWSPs, so each line steps
  // from where the last one ended, past what a line can't start with.
  const segmentCount = prepared.widths.length
  let lineCount = 0
  while (true) {
    const startSegmentIndex = normalizeLineStartSegmentIndex(prepared, cursor.segmentIndex, segmentCount, cursor.segmentIndex === 0)
    if (startSegmentIndex >= segmentCount) return lineCount
    const startGraphemeIndex = cursor.graphemeIndex
    cursor.segmentIndex = startSegmentIndex
    const width = stepPreparedSimpleLineGeometry(prepared, cursor, maxWidth)!
    lineCount++
    onLine?.(width, startSegmentIndex, startGraphemeIndex, cursor.segmentIndex, cursor.graphemeIndex)
  }
}

// A return from an unfit discretionary hyphen needs an overflow that isolated
// widths can show and a target that really is the latest opportunity. No soft
// hyphen on the line may measure narrower joined than apart, and nothing after
// the target may be text after text, which can hold an opportunity that segment
// kinds don't mark. Checked only on a line that would end at an unfit hyphen. The
// target can be a segment start that follows a break outside the prepared
// text, such as a rich-inline item boundary.
export function canReturnFromUnfitHyphen(
  prepared: PreparedLineBreakData,
  lineStartSegmentIndex: number,
  targetSegmentIndex: number,
  softHyphenIndex: number,
): boolean {
  const { discretionaryHyphenContexts, kinds } = prepared
  if (discretionaryHyphenContexts === null || getEngineProfile().unfitHyphenRetreat === 'none') return false
  for (let i = lineStartSegmentIndex; i <= softHyphenIndex; i++) {
    if (discretionaryHyphenContexts[i]) return false
  }
  for (let i = targetSegmentIndex; i < softHyphenIndex; i++) {
    if (breaksAfter(kinds[i]!)) continue
    if (i > targetSegmentIndex && !breaksAfter(kinds[i - 1]!)) return false
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
    discretionaryHyphenWidth,
    letterSpacing,
    spacingGraphemeCounts,
    breaksBefore,
  } = prepared
  const engineProfile = getEngineProfile()
  const lineFitEpsilon = engineProfile.lineFitEpsilon
  const hangTabs = engineProfile.hangTabs
  // A negative width lays out as 0, as in the simple walker.
  const availableWidth = Math.max(0, maxWidth)
  const fitLimit = availableWidth + lineFitEpsilon
  // Preparation records soft-hyphen contexts only where the engine retreats
  // and the text has a soft hyphen.
  const retreatsFromUnfitHyphen = prepared.discretionaryHyphenContexts !== null && engineProfile.unfitHyphenRetreat !== 'none'
  // Blink's retry leaves room for the hyphen at every earlier opportunity. Gecko
  // returns to any opportunity whose line fits, such as a break between text segments.
  const retreatsAtFullWidth = retreatsFromUnfitHyphen && engineProfile.unfitHyphenRetreat === 'full-width'
  const reservedHyphenWidth = retreatsAtFullWidth ? 0 : discretionaryHyphenWidth

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
    const paintWidth = (hangsWhereUnfit ? lineW : width) +
      getTerminalLetterSpacing(prepared, lineStartSegmentIndex, lineStartGraphemeIndex, endSegmentIndex, endGraphemeIndex)
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
    if (!breakAfter || breaksBefore?.[segmentIndex + 1] === false) return
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
    // The gap before the first grapheme, on a line that already has content.
    leadingSpacing = 0,
  ): number | null {
    const fitAdvances = breakableFitAdvances[segmentIndex]!
    const entry = prepared.entryGeometry?.[segmentIndex]
    // Entry geometry describes whole segment tails on a fresh line, not a
    // caller's grapheme limit.
    const freshWhole = !hasContent && endGraphemeIndex === fitAdvances.length
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
        if (g > startGraphemeIndex && fresh > fitLimit) return finishLine()
        startLineAtGrapheme(segmentIndex, g, fresh - terminal)
      }
      // Exhausting an emergency fragment consumes the measured segment and
      // ends this line. Only intact admission above continues into other source.
      return finishLine(segmentIndex + 1, 0)
    }

    for (let g = startGraphemeIndex; g < endGraphemeIndex; g++) {
      const baseGw = fitAdvances[g]!

      if (!hasContent) {
        startLineAtGrapheme(segmentIndex, g, baseGw)
        // A line that holds only this grapheme, overflowing, keeps the graphemes after
        // it that can't start a line, and ends.
        const end = getBreakableCandidateFitWidth(prepared, baseGw) > fitLimit
          ? getOverflowingFirstGraphemeEnd(prepared, segmentIndex, g, endGraphemeIndex)
          : g + 1
        if (end > g + 1) {
          for (let k = g + 1; k < end; k++) lineW += fitAdvances[k]! + letterSpacing
          return end === fitAdvances.length ? finishLine(segmentIndex + 1, 0) : finishLine(segmentIndex, end)
        }
      } else {
        const gw = baseGw + (g > startGraphemeIndex ? letterSpacing : leadingSpacing)
        const candidatePaintWidth = lineW + gw
        if (getBreakableCandidateFitWidth(prepared, candidatePaintWidth) > fitLimit) return finishLine()

        lineW = candidatePaintWidth
        lineEndSegmentIndex = segmentIndex
        lineEndGraphemeIndex = g + 1
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
        // after itself; other segments that take none leave it as it was.
        const gap = letterSpacing !== 0 && hasContent && !zeroWidthPrefix && !afterUnspacedControl ? letterSpacing : 0
        let leadingSpacing = 0
        if (letterSpacing !== 0 && (spacingGraphemeCounts[i]! > 0 || kind === 'control')) {
          leadingSpacing = gap
          afterUnspacedControl = spacingGraphemeCounts[i] === 0
        }
        if (kind !== 'zero-width-break' && kind !== 'zero-width-glue') zeroWidthPrefix = false
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

        // Text that takes no letter spacing, such as zero-width glue, fits like
        // the line that still ends with the gap before it.
        const fitAdvance = letterSpacing !== 0 && spacingGraphemeCounts[i] === 0 && !breakAfter && kind !== 'control'
          ? gap + w
          : getWholeSegmentFitContribution(prepared, kind, breakAfter, i, leadingSpacing, w)
        const hangs = breakAfter && isHangingWhiteSpace(kind, hangTabs)
        if (hangs) {
          if (hangEndSegmentIndex !== i) hangStartWidth = lineW + leadingSpacing
          hangEndSegmentIndex = i + 1
        }
        // Where glue can't hold a line, glue at a line start isn't the line's content:
        // the segment after it starts the line, however wide.
        if (!hasContent && kind === 'zero-width-glue' && !engineProfile.zeroWidthGlueTakesLine) {
          lineEndSegmentIndex = i + 1
          lineEndGraphemeIndex = 0
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
          updatePendingBreakForWholeSegment(kind, breakAfter, i, advance)
          if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + reservedHyphenWidth <= fitLimit) {
            fitBreakSegmentIndex = pendingBreakSegmentIndex
            fitBreakPaintWidth = pendingBreakWidth
          }
          continue
        }

        // A run of preserved spaces and tabs fits where the text before it fits.
        const newFitW = hangs ? hangStartWidth : lineW + fitAdvance
        if (newFitW > fitLimit) {
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

          // Where the scan gives no break before the segment, as before NEL (UAX
          // #14 LB6), the line returns to its last break. Without one, Blink and
          // WebKit retry between graphemes, so the segment's graphemes fill it.
          const unbroken = breaksBefore !== null && !breaksBefore[i]
          if (unbroken && pendingBreakSegmentIndex >= 0) {
            lineEndSegmentIndex = pendingBreakSegmentIndex
            lineEndGraphemeIndex = 0
          } else if (unbroken && breakableFitAdvances[i] !== null) {
            const line = appendBreakableSegmentFrom(i, 0, undefined, leadingSpacing)
            if (line === null) continue
            lineWidth = line
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

        // A break the scan gives before text is one the line can return to.
        if (breaksBefore !== null && breaksBefore[i] && !breakAfter && pendingBreakSegmentIndex !== i) {
          pendingBreakSegmentIndex = i
          pendingBreakWidth = lineW
          pendingBreakKind = null
        }
        if (retreatsAtFullWidth && !breakAfter && breaksBefore?.[i] !== false && !breaksAfter(kinds[i - 1]!)) {
          fitBreakSegmentIndex = i
          fitBreakPaintWidth = lineW
        }
        appendWholeSegment(i, advance)
        updatePendingBreakForWholeSegment(kind, breakAfter, i, advance)
        if (retreatsFromUnfitHyphen && breakAfter && pendingBreakWidth + reservedHyphenWidth <= fitLimit) {
          fitBreakSegmentIndex = pendingBreakSegmentIndex
          fitBreakPaintWidth = pendingBreakWidth
        }
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
            advance += fitAdvances[g]! + (g > 0 ? letterSpacing : 0)
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
  const { widths, kinds, breakableFitAdvances } = prepared
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
        hasContent = true
        lineW = fitAdvances[startGraphemeIndex]!
        lineEndSegmentIndex = i
        lineEndGraphemeIndex = startGraphemeIndex + 1

        const overflowEnd = lineW > fitLimit
          ? getOverflowingFirstGraphemeEnd(prepared, i, startGraphemeIndex, fitAdvances.length)
          : startGraphemeIndex + 1
        if (overflowEnd > startGraphemeIndex + 1) {
          for (let g = startGraphemeIndex + 1; g < overflowEnd; g++) lineW += fitAdvances[g]!
          cursor.segmentIndex = overflowEnd === fitAdvances.length ? i + 1 : i
          cursor.graphemeIndex = overflowEnd === fitAdvances.length ? 0 : overflowEnd
          return lineW
        }

        for (let g = startGraphemeIndex + 1; g < fitAdvances.length; g++) {
          const gw = fitAdvances[g]!
          if (lineW + gw > fitLimit) {
            cursor.segmentIndex = lineEndSegmentIndex
            cursor.graphemeIndex = lineEndGraphemeIndex
            return lineW
          }
          lineW += gw
          lineEndSegmentIndex = i
          lineEndGraphemeIndex = g + 1
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

  return walkPreparedComplexLines(prepared, cursor, chunkIndex, maxWidth, undefined, 1, endSegmentIndex, endGraphemeIndex).lastLineWidth
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
  let maxLineWidth = 0
  const lineCount = walkPreparedLinesRaw(prepared, maxWidth, width => {
    if (width > maxLineWidth) maxLineWidth = width
  })
  return { lineCount, maxLineWidth }
}
