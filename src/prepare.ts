// Preparation's measurement phase: each segment of a text analysis measured in a font, with
// the facts the line walkers read at a line's edges. layout.ts and rich-inline.ts prepare
// through it, as they walk through line-break.ts.

import { observeSegmentEntries, textMayHaveEntryGeometry, type SegmentEntryGeometry } from './entry-geometry.js'
import { getHanKerningTrims, textMayHanKern, type HanKerningTrims } from './han-kerning.js'
import { findGraphemeEnds } from './graphemes.js'
import type { CharTable } from './generated/engine-break-data.js'
import {
  CONTROL,
  HARD_BREAK,
  KIND_BITS,
  ONE_CLUSTER,
  PRESERVED_SPACE,
  SEGMENT_KINDS,
  SOFT_HYPHEN,
  SPACE,
  SPACED,
  TAB,
  TEXT,
  UNBROKEN,
  ZERO_WIDTH_BREAK,
  ZERO_WIDTH_GLUE,
  type SegmentBreakKind,
  type SegmentKindCode,
  type TextAnalysis,
} from './analysis.js'
import {
  type BreakableFitMode,
  type EngineProfile,
  type FontMeasurement,
  getCorrectedSegmentWidth,
  getEmojiCorrection,
  getFollowingSpaceMetrics,
  getFontMeasurement,
  getSegmentFit,
  getSegmentMetrics,
  getTextWidth,
  measureWithLetterSpacing,
  textMayContainEmoji,
  type SegmentFit,
  type SegmentMetrics,
} from './measurement.js'
import type { PreparedText, PreparedTextWithSegments } from './layout.js'
import type { PreparedLineBreakData } from './line-break.js'

// Text and spaces take letter spacing after each grapheme; a ZWSP takes none.
function countRenderedSpacingGraphemes(text: string, kind: SegmentKindCode, graphemeTable: CharTable): number {
  return kind === ZERO_WIDTH_BREAK ? 0 : findGraphemeEnds(graphemeTable, text, 0, text.length, null)
}

function addInternalLetterSpacing(width: number, graphemeCount: number, letterSpacing: number): number {
  return graphemeCount > 1 ? width + (graphemeCount - 1) * letterSpacing : width
}

// Code points that WebKit's FontCascade::characterRangeCodePath sends to the
// complex text path, stored as start/end pairs. So does a ZWJ after an emoji.
const complexTextPathRanges = [
  0x02E5, 0x02E9, 0x0300, 0x036F, 0x0591, 0x05BD, 0x05BF, 0x05CF, 0x0600, 0x109F,
  0x1100, 0x11FF, 0x135D, 0x135F, 0x1700, 0x18AF, 0x1900, 0x194F, 0x1980, 0x19DF,
  0x1A00, 0x1CFF, 0x1DC0, 0x1DFF, 0x20D0, 0x20FF, 0x26F9, 0x26F9, 0x2CEF, 0x2CF1,
  0x302A, 0x302F, 0x3099, 0x309C, 0xA67C, 0xA67D, 0xA6F0, 0xA6F1, 0xA800, 0xABFF,
  0xD7B0, 0xD7FF, 0xFE00, 0xFE0F, 0xFE20, 0xFE2F, 0x10A00, 0x10A5F, 0x11000, 0x110CF,
  0x11100, 0x111DF, 0x11200, 0x1124F, 0x112B0, 0x1137F, 0x11400, 0x114DF, 0x11580, 0x1165F,
  0x11680, 0x116CF, 0x11700, 0x11CBF, 0x16B00, 0x16B8F, 0x1E900, 0x1E95F, 0x1F1E6, 0x1F1FF,
  0x1F3FB, 0x1F3FF, 0xE0000, 0xE007F, 0xE0100, 0xE01EF,
] as const

const extendedPictographicRe = /\p{Extended_Pictographic}/u
const leadingCombiningMarkRe = /^\p{M}/u
// Decimal digits and the joiners of numbers, times and dates.
const numericRunRe = /^[\p{Nd}:\-/×,.+\u2013\u2014]+$/u
const markRunRe = /^\p{M}+$/u
const nonspacingMarkRunRe = /^\p{Mn}+$/u
const controlOrMarkRunRe = /^(?:[\p{Cc}\u2028\u2029]|\p{M}+)$/u
const controlCharacterRe = /^[\p{Cc}\u2028\u2029]$/u
// The fewest UTF-16 units of a long chain of mark runs that a run's context keeps after
// the grapheme (getMarkContext): measured after the whole chain, a long chain prepared in
// time that grows with the square of its length. Safari gives a run a width that depends
// on how far it sits from the grapheme, up to 61 units in the chains measured
// (RESEARCH.md), so a context that keeps fewer moves widths there.
const MARK_CHAIN_CONTEXT_UNITS = 96

function needsComplexTextPath(text: string): boolean {
  let previousIsEmoji = false
  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i)!
    i += codePoint > 0xFFFF ? 2 : 1
    if (codePoint === 0x200D && previousIsEmoji) return true
    previousIsEmoji = codePoint > 0xFFFF && extendedPictographicRe.test(String.fromCodePoint(codePoint))
    for (let range = 0; range < complexTextPathRanges.length && codePoint >= complexTextPathRanges[range]!; range += 2) {
      if (codePoint <= complexTextPathRanges[range + 1]!) return true
    }
  }
  return false
}

const explicitBidiControlRe = /[\u202A-\u202E\u2066-\u2069]/
// Format characters stand for bidi class BN, except the direction marks LRM,
// RLM and ALM, which are strong characters like letters.
const trailingFormatCharacterRe = /(?![\u200E\u200F\u061C])\p{Cf}$/u
// Letters in the right-to-left blocks have bidi class R or AL, as do RLM and
// ALM. Every other letter except modifier letters has class L, as does LRM.
const rightToLeftLetterRe = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u200F\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u
// The last letter or direction mark before format characters other than a soft
// hyphen, and the first letter, direction mark or ASCII digit after the space,
// past spaces and format characters.
const letterBeforeFormatTailRe = /([\p{Lu}\p{Ll}\p{Lt}\p{Lo}\u200E\u200F\u061C])\p{M}*(?:(?![\u00AD\u200E\u200F\u061C])\p{Cf})+$/u
const letterAfterSpacesRe = / (?: |(?![\u200E\u200F\u061C])\p{Cf})*([0-9\p{Lu}\p{Ll}\p{Lt}\p{Lo}\u200E\u200F\u061C])/uy

// Bidi class B: the characters that end a bidi paragraph.
function isParagraphSeparatorCode(code: number): boolean {
  return code === 0x0a || code === 0x0d || (code >= 0x1c && code <= 0x1e) || code === 0x85 || code === 0x2029
}

export function measureAnalysis(
  analysis: TextAnalysis,
  font: string,
  includeSegments: boolean,
  letterSpacing: number,
  engineProfile: EngineProfile,
  language: string | null,
  // Whether text segments take emergency breaks between graphemes: an atomic rich item,
  // which is only laid out whole, takes none.
  overflowBreaks: boolean,
): (PreparedText & PreparedLineBreakData) | PreparedTextWithSegments {
  const { normalized, texts, starts, flags } = analysis
  const segmentCount = flags.length
  const fontMeasurement = getFontMeasurement(font, language)
  const emojiCorrection = textMayContainEmoji(normalized) ? getEmojiCorrection(font, fontMeasurement) : 0
  // The gap before the hyphen, plus the hyphen's own spacing where the engine
  // letter-spaces it.
  const discretionaryHyphenWidth = getTextWidth('-', fontMeasurement, emojiCorrection) +
    (letterSpacing === 0 ? 0 : letterSpacing * (engineProfile.letterSpaceDiscretionaryHyphen ? 2 : 1))
  const spaceWidth = getTextWidth(' ', fontMeasurement, emojiCorrection)
  const tabStopAdvance = spaceWidth * 8
  const hasLetterSpacing = letterSpacing !== 0
  // Only a segment holding a default-ignorable code point has entry geometry, so text
  // without one doesn't look for it.
  const entryFitBasis = engineProfile.entryFitBasis !== 'disabled' && textMayHaveEntryGeometry(normalized) ? engineProfile.entryFitBasis : 'disabled'

  // A collapsed space's first source character, for engines that look at the
  // source after a text item.
  function getSpaceSourceCode(analysisIndex: number): number {
    const start = starts[analysisIndex]!
    return analysis.spaceSources === null ? normalized.charCodeAt(start) : analysis.spaceSources[start]!
  }

  // A WebKit text item runs to its next break opportunity, so it also owns any
  // zero-width breaks before the space. The item is measured with one following
  // U+0020 minus an unshaped space, which keeps the kerning between the item's
  // end and that space. With letter spacing the same measurement also moves the
  // space's gap onto the item and clamps the item at zero, which the
  // per-grapheme gap model does not represent, so only the unspaced case takes
  // the kerning. A soft hyphen before the space also takes none: on an RTL page
  // WebKit needs about a hyphen's width more to fit such an item, and
  // preparation cannot see the page direction. Returns the zero-width breaks
  // between the text and the space, or null when the text takes no kerning.
  function getFollowingSpaceTail(analysisIndex: number, text: string): string | null {
    if (!engineProfile.measureTextWithFollowingSpace || hasLetterSpacing) return null
    let next = analysisIndex + 1
    while (next < segmentCount && (flags[next]! & KIND_BITS) === ZERO_WIDTH_BREAK) next++
    if (next >= segmentCount) return null
    const nextKind = flags[next]! & KIND_BITS
    if ((nextKind !== SPACE && nextKind !== PRESERVED_SPACE) || getSpaceSourceCode(next) !== 0x20) return null
    const tail = normalized.slice(starts[analysisIndex + 1], starts[next])
    return formatTailStaysWithWord(tail === '' ? text : text + tail, starts[next]!) ? tail : null
  }

  // Text directly before such a space is measured together with the space
  // instead of alone, so its kerned width costs no extra Canvas call. Other
  // occurrences of the same text measure it alone.
  function getTextMetrics(text: string, followingSpaceTail: string | null): SegmentMetrics {
    return followingSpaceTail === '' ? getFollowingSpaceMetrics(text, fontMeasurement) : getSegmentMetrics(text, fontMeasurement)
  }

  // A zero-width break before the space ends the measured item, so only the
  // item's kerning with the space is added to the text's own width.
  function getTailKerning(item: string): number {
    return getFollowingSpaceMetrics(item, fontMeasurement).width - getSegmentMetrics(item, fontMeasurement).width - spaceWidth
  }

  // WebKit splits text items where resolved bidi levels change before it
  // measures them. Format characters between a word and the space resolve with
  // that space, so they stay in the word's item, and the word's last glyph keeps
  // its kerning with the space, only when the space resolves to the word's
  // direction. Without the paragraph direction that is known when the word's last
  // letter or direction mark and the first one after the space have the same
  // direction, with only spaces and format characters between (UAX #9 N1).
  // Explicit embeddings, overrides and isolates end with their paragraph (UAX #9
  // X8), so only controls in the space's own paragraph leave its direction
  // unknown. Spaces arrive in order, so each paragraph is scanned once.
  let hasExplicitBidiControls: boolean | null = null
  let controlParagraphEnd = -1
  let paragraphHasExplicitBidiControls = false
  function spaceParagraphHasExplicitBidiControls(spaceStart: number): boolean {
    hasExplicitBidiControls ??= explicitBidiControlRe.test(normalized)
    if (!hasExplicitBidiControls) return false
    if (spaceStart < controlParagraphEnd) return paragraphHasExplicitBidiControls
    let start = spaceStart
    while (start > 0 && !isParagraphSeparatorCode(normalized.charCodeAt(start - 1))) start--
    let end = spaceStart
    while (end < normalized.length && !isParagraphSeparatorCode(normalized.charCodeAt(end))) end++
    controlParagraphEnd = end
    paragraphHasExplicitBidiControls = explicitBidiControlRe.test(normalized.slice(start, end))
    return paragraphHasExplicitBidiControls
  }
  function formatTailStaysWithWord(item: string, spaceStart: number): boolean {
    if (!trailingFormatCharacterRe.test(item)) return true
    const before = letterBeforeFormatTailRe.exec(item)
    if (before === null) return false
    letterAfterSpacesRe.lastIndex = spaceStart
    const after = letterAfterSpacesRe.exec(normalized)
    if (after === null) return false
    // An ASCII digit takes the direction of the text before it (UAX #9 W7 and N1).
    const next = after[1]!
    return (next.charCodeAt(0) <= 0x39 || rightToLeftLetterRe.test(before[1]!) === rightToLeftLetterRe.test(next)) &&
      !spaceParagraphHasExplicitBidiControls(spaceStart)
  }

  // The source a run of combining marks shapes after when only zero-width glue,
  // controls or other such runs, with no break, separate the run from the grapheme
  // before it: that grapheme and what separates them. Without the separators, Canvas
  // can compose the marks with the grapheme or draw both in another font. A walk that
  // reaches the last run that asked takes that run's answer, so each segment is walked
  // and each grapheme found once, however many runs share it. Once what separates them
  // passes MARK_CHAIN_CONTEXT_UNITS, the context keeps the grapheme and the fewest of the
  // chain's last runs, each with the separators before it, that hold at least that many
  // units: in Chrome, Safari and Firefox, runs of 1 to 400 marks then measure as they do
  // after the whole chain, to 0.002px, and without the grapheme some took 25px less
  // (RESEARCH.md).
  let markRunIndex = -1
  let markBaseStart = -1 // where that run's grapheme starts in the normalized text, or -1
  let markChainStart = -1 // the segment after that grapheme
  let markChainKept = -1 // the first segment of the chain the context keeps
  function getMarkContext(analysisIndex: number, text: string): string | null {
    if ((flags[analysisIndex]! & UNBROKEN) === 0 || !markRunRe.test(text)) return null
    let baseStart = -1
    for (let k = analysisIndex - 1; k >= 0; k--) {
      const kind = flags[k]! & KIND_BITS
      const start = starts[k]!
      const end = starts[k + 1]!
      if (kind === ZERO_WIDTH_GLUE || ((kind === TEXT || kind === CONTROL) && controlOrMarkRunRe.test(texts[k]!))) {
        if (k !== markRunIndex) continue
        baseStart = markBaseStart
      } else if (kind === TEXT) {
        const ends = new Int32Array(end - start)
        const count = findGraphemeEnds(engineProfile.graphemeTable, normalized, start, end, ends)
        baseStart = count > 1 ? ends[count - 2]! : start
        markChainStart = markChainKept = k + 1
      }
      break
    }
    markRunIndex = analysisIndex
    markBaseStart = baseStart
    if (baseStart < 0) return null
    const start = starts[analysisIndex]!
    return start - baseStart > MARK_CHAIN_CONTEXT_UNITS ? getLongMarkChainContext(baseStart, start) : normalized.slice(baseStart, start)
  }
  // Apart from getMarkContext(), which prepare() calls for every segment, so that V8
  // still inlines that one there (RESEARCH.md, Keeping Work Bounded). V8 inlines a
  // function only while its bytecode stays under about 460 bytes, whether or not the
  // source is minified: with this loop inside, getMarkContext() took 519 bytes and
  // Chrome 154's prepare() ran 1-3% slower; without it, 374 (Node 23, V8 12.9). Before
  // growing getMarkContext(), check it with node --print-bytecode and
  // --trace-turbo-inlining, and bench Chrome's prepare() rows against main.
  function getLongMarkChainContext(baseStart: number, start: number): string {
    // The kept part starts after the grapheme or a run of marks, moves only forward and
    // never holds fewer than MARK_CHAIN_CONTEXT_UNITS.
    for (let k = markChainKept + 1; start - starts[k]! >= MARK_CHAIN_CONTEXT_UNITS; k++) {
      if (markRunRe.test(texts[k - 1]!)) markChainKept = k
    }
    if (markChainKept === markChainStart) return normalized.slice(baseStart, start)
    return normalized.slice(baseStart, starts[markChainStart]) + normalized.slice(starts[markChainKept], start)
  }

  const widths: number[] = []
  // An engine's scan makes one prepared segment per analysis segment, whose flags the
  // walkers, layout()'s count and rich-inline layout read where the scan gives no break.
  const segmentFlags = new Uint8Array(segmentCount)
  // Text of the simple walkers' kinds without letter spacing. They lay it out where
  // the scan breaks at every segment boundary, and layout() counts it with the
  // simple stepper where it doesn't (countPreparedLines).
  let simpleKinds = !hasLetterSpacing
  let hasGlue = false
  const breakableFitAdvances: (number[] | null)[] = []
  let entryGeometry: (SegmentEntryGeometry | null)[] | null = null
  let lineStartProhibitions: (number[] | null)[] | null = null
  // When not even the first character of an overflowing word fits an empty line,
  // WebKit keeps the punctuation, NBSP, U+2010 and U+2013 after that character on the
  // line, in text holding a code unit above U+00FF (InlineContentBreaker.cpp:124-158,
  // 222-233), by its scan's line-start table. Blink and Gecko end the line after the
  // first grapheme.
  const keepsLineStartPunctuation = engineProfile.lineBreakScan === 'webkit' && /[\u0100-\uFFFF]/.test(normalized)
  const segments = includeSegments ? [] as string[] : null
  const kinds = includeSegments ? [] as SegmentBreakKind[] : null
  const retreatsFromUnfitHyphen = engineProfile.unfitHyphenRetreat !== 'none'
  let discretionaryHyphenContexts: number[] | null = null
  let previousJoinablePiece: string | null = null
  let previousJoinableMetrics: SegmentMetrics | null = null

  // Pieces split by a soft hyphen are measured apart, but Blink and Gecko shape
  // the unbroken text together: cursive joins, marks and kerning across the soft
  // hyphen. Canvas shows how much narrower the neighbors measure joined than
  // apart, which isolated widths can't show when proving that a hyphen overflows.
  function getJoinedNarrowing(analysisIndex: number, before: string | null, beforeMetrics: SegmentMetrics | null): number {
    if (before === null) return 0
    let next = analysisIndex + 1
    while (next < segmentCount && (flags[next]! & KIND_BITS) === SOFT_HYPHEN) next++
    if (next >= segmentCount || (flags[next]! & KIND_BITS) !== TEXT) return 0
    const after = texts[next]!
    const apart = getCorrectedSegmentWidth(before, beforeMetrics!, emojiCorrection) + getTextWidth(after, fontMeasurement, emojiCorrection)
    const together = getTextWidth(before + after, fontMeasurement, emojiCorrection)
    return apart - together > engineProfile.lineFitEpsilon ? apart - together : 0
  }

  function getEntryGeometry(text: string, fit: SegmentFit, width: number, fitBasis: 'fresh' | 'original'): SegmentEntryGeometry | null {
    // The fit fixes the text, font and advances, and Pretext sets no other context state.
    // Only the WebKit profile moves the advances by a following space, and it observes
    // no entries.
    const cached = fit.entryGeometry
    if (cached !== null && cached.letterSpacing === letterSpacing && cached.emojiCorrection === emojiCorrection) return cached.geometry
    const geometry = observeSegmentEntries(text, fit.advances!, letterSpacing, width, fitBasis,
      source => measureWithLetterSpacing(source, letterSpacing, emojiCorrection, fontMeasurement))
    // Replacing this last observation leaves prepared copies intact.
    if (geometry !== null) fit.entryGeometry = { letterSpacing, emojiCorrection, geometry }
    return geometry
  }

  // A text segment's width as measured: alone, or together with the following space less
  // that space, plus the item's kerning with a space that follows zero-width breaks. Apart
  // from the loop below, whose code JavaScriptCore otherwise never optimizes fully on CJK
  // text (RESEARCH.md, Keeping Work Bounded).
  function getTextSegmentWidth(text: string, textMetrics: SegmentMetrics, measuredWithSpace: boolean, followingSpaceKerning: number): number {
    return getCorrectedSegmentWidth(text, textMetrics, emojiCorrection) - (measuredWithSpace ? spaceWidth : 0) + followingSpaceKerning
  }

  for (let mi = 0; mi < segmentCount; mi++) {
    const text = texts[mi]!
    const segment = flags[mi]!
    const kind = (segment & KIND_BITS) as SegmentKindCode
    let width = 0
    // Graphemes that take letter spacing after them.
    let spacingGraphemeCount = 0
    let fitAdvances: number[] | null = null
    let entry: SegmentEntryGeometry | null = null
    let prohibitions: number[] | null = null
    switch (kind) {
      case TEXT: {
        // A control the engine hides takes no advance, only letter spacing.
        if (engineProfile.hidesControlCharacters && controlCharacterRe.test(text)) {
          spacingGraphemeCount = 1
          break
        }
        // Such a run of marks adds its context with the marks, minus the context, and
        // takes no letter spacing of its own.
        const markContext = getMarkContext(mi, text)
        if (markContext !== null) {
          width = engineProfile.shapesMarksAcrossSoftHyphen && texts[mi - 1] === '\u00AD' && nonspacingMarkRunRe.test(text)
            ? 0
            : getTextWidth(markContext + text, fontMeasurement, emojiCorrection) - getTextWidth(markContext, fontMeasurement, emojiCorrection)
          break
        }
        // With an empty following-space tail, the text is measured together with the
        // space; with a zero-width tail, the item's kerning is added.
        const followingSpaceTail = getFollowingSpaceTail(mi, text)
        const measuredWithSpace = followingSpaceTail === ''
        const textMetrics = getTextMetrics(text, followingSpaceTail)
        previousJoinablePiece = text
        previousJoinableMetrics = textMetrics
        if (hasLetterSpacing) spacingGraphemeCount = countRenderedSpacingGraphemes(text, kind, engineProfile.graphemeTable)
        const followingSpaceKerning = followingSpaceTail === null || measuredWithSpace ? 0 : getTailKerning(text + followingSpaceTail)
        width = getTextSegmentWidth(text, textMetrics, measuredWithSpace, followingSpaceKerning)
        // Under break-word, Blink retries an overflowing line with a break allowed between
        // any two graphemes (line_breaker.cc), WebKit searches the word's grapheme prefixes
        // (TextUtil::breakWord) and Gecko may wrap before any cluster (gfxTextRun.cpp:1069-1072),
        // so every text segment takes emergency grapheme breaks, unless it is one Gecko cluster
        // or an atomic item's.
        if (!overflowBreaks || (segment & ONE_CLUSTER) !== 0 || text.length === 1) break
        const fitMode: BreakableFitMode = letterSpacing !== 0 ? 'segment-prefixes'
          : numericRunRe.test(text) ? 'pair-context'
          : textMetrics.width >= engineProfile.prefixFitMinWidth ? 'segment-prefixes'
          : 'sum-graphemes'
        const fit = getSegmentFit(text, textMetrics, fontMeasurement, emojiCorrection, fitMode,
          measuredWithSpace ? spaceWidth : null, engineProfile.lineBreakScan === 'webkit')
        fitAdvances = fit.advances
        if (fitAdvances === null) break
        // The cached advances are shared by every occurrence of this text; only
        // the final grapheme touches the following space.
        if (followingSpaceKerning !== 0) {
          fitAdvances = fitAdvances.slice()
          fitAdvances[fitAdvances.length - 1] = fitAdvances[fitAdvances.length - 1]! + followingSpaceKerning
        }
        if (entryFitBasis !== 'disabled') {
          entry = getEntryGeometry(text, fit, addInternalLetterSpacing(width, spacingGraphemeCount, letterSpacing), entryFitBasis)
        }
        if (keepsLineStartPunctuation) prohibitions = fit.lineStartProhibitions
        break
      }
      case SPACE:
      case PRESERVED_SPACE:
      case ZERO_WIDTH_BREAK:
        width = getTextWidth(text, fontMeasurement, emojiCorrection)
        if (hasLetterSpacing) spacingGraphemeCount = countRenderedSpacingGraphemes(text, kind, engineProfile.graphemeTable)
        break
      case TAB:
        spacingGraphemeCount = 1
        break
      case CONTROL: {
        width = getTextWidth(text, fontMeasurement, emojiCorrection)
        // NEL shares a WebKit text item with the text before it and with
        // combining marks after it, and the complex text path spaces it. Complex
        // text shares the item only when its direction matches the page's, which
        // preparation cannot see, so NEL next to complex text keeps its spacing.
        const nextText = mi + 1 < segmentCount ? texts[mi + 1]! : ''
        if (hasLetterSpacing && (
          (mi > 0 && (flags[mi - 1]! & KIND_BITS) === TEXT && needsComplexTextPath(texts[mi - 1]!)) ||
          (leadingCombiningMarkRe.test(nextText) && needsComplexTextPath(nextText))
        )) spacingGraphemeCount = 1
        break
      }
      case SOFT_HYPHEN:
      case ZERO_WIDTH_GLUE:
      case HARD_BREAK:
        break
    }
    // layout() counts text with zero-width glue that can't hold a line with the simple stepper, which steps
    // past it at a line start (countPreparedLines); the line APIs lay it out with the full walker.
    if (kind === ZERO_WIDTH_GLUE) hasGlue = true
    if (kind !== TEXT && kind !== SPACE && kind !== ZERO_WIDTH_BREAK && (kind !== ZERO_WIDTH_GLUE || engineProfile.zeroWidthGlueTakesLine)) simpleKinds = false
    if (kind !== TEXT && kind !== SOFT_HYPHEN) previousJoinablePiece = null
    segmentFlags[mi] = (segment & ~ONE_CLUSTER) | (hasLetterSpacing && spacingGraphemeCount > 0 ? SPACED : 0)
    widths.push(addInternalLetterSpacing(width, spacingGraphemeCount, letterSpacing))
    breakableFitAdvances.push(fitAdvances)
    if (entry !== null && entryGeometry === null) entryGeometry = Array.from({ length: mi }, () => null)
    entryGeometry?.push(entry)
    if (prohibitions !== null && lineStartProhibitions === null) lineStartProhibitions = Array.from({ length: mi }, () => null)
    lineStartProhibitions?.push(prohibitions)
    if (segments !== null) segments.push(text)
    kinds?.push(SEGMENT_KINDS[kind]!)
    if (kind === SOFT_HYPHEN && retreatsFromUnfitHyphen) {
      discretionaryHyphenContexts ??= Array.from({ length: mi }, () => 0)
      discretionaryHyphenContexts.push(getJoinedNarrowing(mi, previousJoinablePiece, previousJoinableMetrics))
    } else {
      discretionaryHyphenContexts?.push(0)
    }
  }

  // A segment's width is its width between the text before and after it; one that starts
  // a line takes back the halt Blink gives its first character there.
  let hanKerning: HanKerningTrims = { widthTrims: null, lineStartExtras: null, lineEndTrims: null, overflowLineEndTrims: null }
  if (engineProfile.hanKerning && textMayHanKern(normalized)) {
    hanKerning = getHanKerningTrims(fontMeasurement, analysis)
    const trims = hanKerning.widthTrims
    if (trims !== null) for (let i = 0; i < trims.length; i++) widths[i] = widths[i]! - trims[i]!
  }
  let lineEndTrims = hanKerning.lineEndTrims
  if (engineProfile.hangsIdeographicSpace && normalized.includes('\u3000')) {
    lineEndTrims = addIdeographicSpaceHangs(lineEndTrims, analysis, fontMeasurement, letterSpacing, discretionaryHyphenWidth)
  }
  const prepared = {
    widths,
    segmentFlags,
    simpleLineWalkFastPath: simpleKinds && !analysis.hasUnbroken && !hasGlue,
    simpleLineCountFastPath: simpleKinds,
    breakableFitAdvances,
    entryGeometry,
    letterSpacing,
    discretionaryHyphenWidth,
    discretionaryHyphenContexts,
    lineStartProhibitions,
    lineStartExtras: hanKerning.lineStartExtras,
    lineEndTrims,
    overflowLineEndTrims: hanKerning.overflowLineEndTrims,
    tabStopAdvance,
  } as unknown as PreparedTextWithSegments
  if (segments !== null && kinds !== null) {
    prepared.segments = segments
    prepared.kinds = kinds
  }
  return prepared
}

// Blink (Chrome 153) hangs a run of U+3000 that ends a line, as it hangs spaces: ShapingLineBreaker
// counts U+3000 as a breakable space (IsBreakableSpace, shaping_line_breaker.cc:38-41, with
// Character::IsOtherSpaceSeparator, character.h:156-158), so a line whose width runs out on
// the run ends after it and fits without it (shaping_line_breaker.cc:384-452), and the line
// breaker keeps the run as trailing space (HandleTrailingSpaces, line_breaker.cc:2447-2514),
// in normal and pre-wrap white space alike. A text segment that ends in such a run, where a
// line can end after it or a collapsible space follows, which hangs with it, drops the run
// and its letter spacing at a line end. The line then ends where the run starts
// (shaping_line_breaker.cc:490-493), so after a soft hyphen it ends with a hyphen
// (SetBreakOffset, shaping_line_breaker.cc:212-216), which has to fit. Gecko (Firefox 156)
// marks U+3000 as a space glyph, like SPACE (SetupClusterBoundaries, gfxFont.cpp:749-750), and
// BreakAndMeasureText fits a line without its trailing space glyphs (gfxTextRun.cpp:1152-1160,
// 1175), so Firefox hangs the run too.
function addIdeographicSpaceHangs(
  trims: number[] | null,
  analysis: TextAnalysis,
  measurement: FontMeasurement,
  letterSpacing: number,
  hyphenWidth: number,
): number[] | null {
  const { normalized, starts, flags } = analysis
  for (let i = 0; i < flags.length; i++) {
    const end = i + 1 < flags.length ? starts[i + 1]! : normalized.length
    if ((flags[i]! & KIND_BITS) !== TEXT || normalized.charCodeAt(end - 1) !== 0x3000) continue
    if (i + 1 < flags.length) {
      const next = flags[i + 1]! & KIND_BITS
      if (next !== HARD_BREAK && next !== SPACE && !(next === TEXT && (flags[i + 1]! & UNBROKEN) === 0)) continue
    }
    let start = end - 1
    while (start > starts[i]! && normalized.charCodeAt(start - 1) === 0x3000) start--
    const run = normalized.slice(start, end)
    const afterSoftHyphen = i > 0 && start === starts[i] && normalized.charCodeAt(start - 1) === 0xAD
    const hang = getSegmentMetrics(run, measurement).width + run.length * letterSpacing - (afterSoftHyphen ? hyphenWidth : 0)
    if (hang <= 0) continue
    trims ??= Array.from({ length: flags.length }, () => 0)
    trims[i] = trims[i]! + hang
  }
  return trims
}
