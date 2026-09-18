// WebKit widths from Canvas totals: TextUtil::width with the following-space rule, singleSpaceWidth, the hyphen, tab
// stops, word spacing, the fixed-pitch shortcut, breakWord's probe sequence and firstUserPerceivedCharacterLength
// (specs/webkit-lines.md §3.3, §8.1; specs/webkit-canvas.md §(e); specs/webkit-gaps.md §2, §5). Every width is float32.
import { measureText, type Measurer } from '../../measure/canvas.js'
import { graphemeBoundaries, graphemeRulesFor } from '../../unicode/grapheme.js'
import { collapsesWhiteSpace, preservesSpacesAndTabs, tabsAllowed } from './style.js'
import type { WebKitBox, WebKitPrepared, WebKitTextItem } from './types.js'

const f32 = Math.fround

// Canvas turns U+0009-U+000D into spaces (CanvasRenderingContext2DBase.cpp:2847-2875). The DOM draws VT and FF with
// .notdef's advance, which Canvas gives for U+0001 (probes-safari webkit-canvas H10). It keeps CR's own glyph advance,
// 0 in Arial (probes-safari correction 4), which Canvas gives for U+0000, deleted after shaping (webkit-canvas H8). Gap
// control-character-width. TAB and LF never reach here: they are white space or forced breaks.
export function canvasString(text: string): string {
  let out = ''
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c !== 0x0b && c !== 0x0c && c !== 0x0d) continue
    out += text.slice(from, i) + (c === 0x0d ? String.fromCharCode(0) : String.fromCharCode(1))
    from = i + 1
  }
  return from === 0 ? text : out + text.slice(from)
}

// ---- Letter spacing and ligatures ----
// rule webkit/measure/letter-spacing-merged-glyphs
//
// The DOM turns off liga, clig, dlig and hlig where letter-spacing isn't 0 (StyleComputedStyleBase.cpp:324-331,
// UnrealizedCoreTextFont.cpp:258-264). An OffscreenCanvas context keeps them: setLetterSpacing changes the FontCascade's
// spacing, not its description (CanvasRenderingContext2DBase.cpp:3271-3296, FontCascade.cpp:81). Canvas still shows where such
// a lookup merged glyphs. WidthIterator adds letter spacing once per character that keeps glyphs of non-zero width after
// shaping (applyExtraSpacingAfterShaping and calculateAdditionalWidth, WidthIterator.cpp:491-517, :654-690), and the complex
// text controller once per glyph with an advance (ComplexTextController.cpp:792-796), so a total at LETTER_SPACING_PROBE px of
// letter spacing less the total at none counts a string's spacing-bearing glyphs, and a ligature counts one where its
// letters alone count one each (probe webkit-round3 R1: every string whose count equals its letters' counts measures the
// same in Canvas as in the letter-spaced DOM, 247 of 247 strings without a space in 15 fonts, and 26 of the 237 that count
// fewer do).
const LETTER_SPACING_PROBE = 64

function spacedGlyphCount(m: Measurer, box: WebKitBox, s: string): number {
  return Math.round((measureText(m, box.countContext, s) - measureText(m, box.plainContext, s)) / LETTER_SPACING_PROBE)
}

// What Canvas shows of merged glyphs in a string a letter-spaced box measures. The features the DOM turns off join separate
// grapheme clusters; inside a cluster glyphs merge by other rules the DOM keeps (marks, conjuncts, emoji sequences), so
// clusters are counted, not code points. `merged`: the string counts fewer spacing-bearing glyphs than its grapheme clusters
// do alone. `pairs`: the offsets of adjacent cluster pairs that merge when measured as a pair, [first, end of second).
// `separated`: on the simple font code path, the string with U+200C between the clusters of each such pair, when that
// leaves nothing merged; else null. WidthIterator commits the font range before a default-ignorable without a glyph and
// adds it as a deleted glyph of width 0 (commitIgnorable, WidthIterator.cpp:318-323), and a U+200C glyph sits between the
// two letters otherwise, so no lookup matches across it, and it gets no letter spacing (calculateAdditionalWidth's baseWidth
// test). The separated string is the DOM's glyphs less what shaping does across each separated pair with those features
// off: a pair adjustment between the two letters (probe R1: ProbeShantell 700 `fi` is 0.288px wider in the DOM, Amiri's is
// equal). On the complex path U+200C would break joining, and a required ligature such as lam-alef merges in the DOM too
// (probe R1), so nothing is separated there.
// Where the listed families' facts say which font draws every character of the string and none of them is an input of a
// liga, clig, dlig or hlig lookup there (ListedFontFacts.spacingInputs), letter-spacing changes nothing in the string:
// whatever merges, merges in the DOM too (Geeza Pro's lam-alef and Allah ligatures are morx ligatures the DOM keeps).
export type MergedGlyphs = { merged: boolean; pairs: Array<[number, number]>; separated: string | null }
const NOTHING_MERGED: MergedGlyphs = { merged: false, pairs: [], separated: null }

// Whether letter-spacing can change the string's shaping by the listed families' facts: false where every character is
// drawn by a listed family that gives coverage and spacing inputs and none is an input; null where the facts don't say.
function spacingCanChangeShaping(box: WebKitBox, s: string): boolean | null {
  if (box.spacingFacts === null) return null
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!
    if (cp > 0xffff) i++
    let drawn = false
    for (let k = 0; k < box.spacingFacts.length && !drawn; k++) {
      const family = box.spacingFacts[k]!
      if (!inRanges(family.coverage, cp)) continue
      if (inRanges(family.inputs, cp)) return true
      drawn = true
    }
    if (!drawn) return null
  }
  return false
}

function inRanges(ranges: readonly number[], cp: number): boolean {
  let low = 0
  let high = ranges.length / 2 - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (cp < ranges[2 * middle]!) high = middle - 1
    else if (cp > ranges[2 * middle + 1]!) low = middle + 1
    else return true
  }
  return false
}

export function mergedGlyphs(m: Measurer, box: WebKitBox, text: string): MergedGlyphs {
  if (box.letterSpacing === 0 || text.length < 2) return NOTHING_MERGED
  if (spacingCanChangeShaping(box, text) === false) return NOTHING_MERGED
  const s = canvasString(text)
  const starts = graphemeBoundaries(s, graphemeRulesFor('webkit'))
  const counts: number[] = []
  let alone = 0
  for (let k = 0; k + 1 < starts.length; k++) {
    const count = spacedGlyphCount(m, box, s.slice(starts[k]!, starts[k + 1]!))
    counts.push(count)
    alone += count
  }
  if (spacedGlyphCount(m, box, s) >= alone) return NOTHING_MERGED
  const pairs: Array<[number, number]> = []
  let separated = ''
  for (let k = 0; k + 1 < counts.length; k++) {
    const isMerged = spacedGlyphCount(m, box, s.slice(starts[k]!, starts[k + 2]!)) < counts[k]! + counts[k + 1]!
    if (isMerged) pairs.push([starts[k]!, starts[k + 2]!])
    separated += s.slice(starts[k]!, starts[k + 1]!) + (isMerged ? '\u200c' : '')
  }
  separated += s.slice(starts[counts.length - 1]!)
  if (!box.simpleFontCodePath || pairs.length === 0 || spacedGlyphCount(m, box, separated) < alone) return { merged: true, pairs, separated: null }
  return { merged: true, pairs, separated }
}

// ---- VT, FF and CR ----
// rule webkit/measure/vt-ff-cr-as-space-shaped
//
// Canvas turns U+0009-U+000D into spaces before it measures (CanvasRenderingContext2DBase.cpp:2847-2875), so it never shapes
// the DOM's string. What the DOM does with VT, FF and CR, all on the WidthIterator path (a control keeps a box off
// simplified measuring, WidthIterator.cpp:694-742):
// - Font::applyTransforms hands Core Text the glyphs and the characters (CTFontShapeGlyphs, FontCoreText.cpp:689-700), and
//   Core Text kerns the letter before the control as before a space: `A` FF `V` in 16px Arial is 32.4609375px, A's advance
//   less 113 units, .notdef's 12px and V's advance, where Canvas's `A` U+0001 `V` kerns A against V across the control and
//   gives 32.15625px (probe webkit-round3 R5);
// - applyCSSVisibilityRules then overwrites a control's advance with .notdef's, VT and FF among them, and leaves CR's as
//   shaping left it, with the space glyph (WidthIterator.cpp:792-823). So a pair adjustment on the control's own advance
//   is lost for VT and FF and kept for CR, where Canvas can't show it: WidthIterator puts a space's advance back
//   (:84-120). Other Cc characters reach Canvas as they are and measure the same there (probe R5: 96 of 96).
// The stand-in with the control as U+0001 (VT, FF) or U+0000 (CR, no advance) is the DOM's own float32 sum wherever Canvas
// shows no pair adjustment around the control: the letter before it against a space, and the two letters around it across
// the stand-in. Elsewhere the width is pieced together, the text before the control shaped before a space, less the space,
// then the control's advance, then the text after it, and the pieces don't add up in the DOM's float32 order, so the line
// reports control-character-width (probe R5: 46 of 48 VT and FF strings equal the pieces, 2 are a float32 step off). A CR
// followed by more of the measured string always reports it: the adjustment on CR's own advance isn't observable.
function isPiecedControl(c: number): boolean {
  return c === 0x0b || c === 0x0c || c === 0x0d
}

// Whether Canvas shows a pair adjustment around the control at `index` of `text`.
function controlIsAdjusted(m: Measurer, context: number, text: string, index: number): boolean {
  const before = index > 0 && !isPiecedControl(text.charCodeAt(index - 1)) ? text[index - 1]! : ''
  const after = index + 1 < text.length && !isPiecedControl(text.charCodeAt(index + 1)) ? text[index + 1]! : ''
  const standIn = text.charCodeAt(index) === 0x0d ? String.fromCharCode(0) : String.fromCharCode(1)
  const space = measureText(m, context, ' ')
  if (before !== '' && measureText(m, context, `${before} `) !== f32(measureText(m, context, before) + space)) return true
  if (before !== '' && after !== '' && measureText(m, context, before + standIn + after) !== f32(f32(measureText(m, context, before) + measureText(m, context, standIn)) + measureText(m, context, after))) return true
  return false
}

// Whether the width of a string holding VT, FF or CR is the DOM's own float32 sum (see above).
export function controlsMeasureExactly(m: Measurer, context: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (!isPiecedControl(c)) continue
    if (c === 0x0d && i + 1 < text.length) return false
    if (controlIsAdjusted(m, context, text, i)) return false
  }
  return true
}

// The Canvas width of a range the DOM measures: in a letter-spaced box the separated string where Canvas shows merged pairs,
// and VT, FF and CR by the stand-in or the pieces above.
function measureDomString(m: Measurer, box: WebKitBox, context: number, text: string): number {
  const separated = mergedGlyphs(m, box, text).separated
  const s = separated === null ? text : separated
  let pieced = false
  for (let i = 0; i < s.length && !pieced; i++) pieced = isPiecedControl(s.charCodeAt(i)) && controlIsAdjusted(m, context, s, i)
  if (!pieced) return measureText(m, context, canvasString(s))
  const space = measureText(m, context, ' ')
  let width = 0
  let segmentStart = 0
  for (let i = 0; i <= s.length; i++) {
    if (i < s.length && !isPiecedControl(s.charCodeAt(i))) continue
    const segment = canvasString(s.slice(segmentStart, i))
    if (i === s.length) {
      if (segment !== '') width = f32(width + measureText(m, context, segment))
      break
    }
    // The text before the control, shaped before a space: its own total where Canvas shows no adjustment between its last
    // letter and a space (exact), else the total with the space less the space.
    if (segment !== '') {
      const last = segment[segment.length - 1]!
      const adjusted = measureText(m, context, `${last} `) !== f32(measureText(m, context, last) + space)
      width = f32(width + (adjusted ? f32(measureText(m, context, `${segment} `) - space) : measureText(m, context, segment)))
    }
    if (s.charCodeAt(i) !== 0x0d) width = f32(width + measureText(m, context, String.fromCharCode(1)))
    segmentStart = i + 1
  }
  return width
}

// TextUtil::singleSpaceWidth (TextUtil.cpp:54-60): widthOfSpaceString, a TextRun of one space, which gets letter spacing
// and no word spacing (index 0), or the primary font's space advance on the simplified path, which has no spacing.
export function singleSpaceWidth(m: Measurer, box: WebKitBox): number {
  return measureText(m, box.context, ' ')
}

// TextUtil::hyphenWidth (TextUtil.cpp:621-624): the hyphen string measured through the cascade.
export function hyphenWidth(m: Measurer, box: WebKitBox): number {
  return Math.max(0, measureText(m, box.context, box.hyphen))
}

// Whether U+2010 and U+002D measure differently in the box's context: where FontFacts.mapsHyphen decides a width.
export function hyphenGlyphsDiffer(m: Measurer, box: WebKitBox): boolean {
  return measureText(m, box.context, '‐') !== measureText(m, box.context, '-')
}

// FontCascade::tabWidth (FontCascadeInlines.h:76-94) with a tab-size of spaces (TabSize.h:52-55): the stop counts from
// the TextRun's xpos, the pen position on the line. The primary font's spaceWidth() is taken from Canvas W(' ') without
// spacing (gap tab-stops).
function tabWidth(box: WebKitBox, spaceWidth: number, position: number): number {
  const base = f32(box.style.tabSize * spaceWidth)
  if (base === 0) return box.letterSpacing
  let remainder = f32(position % base)
  if (remainder < 0) remainder = f32(remainder + base)
  let result = f32(base - remainder)
  if (result < f32(spaceWidth / 2)) result = f32(result + base)
  return result
}

// WidthIterator::calculateAdditionalWidth (WidthIterator.cpp:500-519): word spacing after SPACE, LF, NBSP, and TAB when
// tabs aren't allowed (FontCascade::treatAsSpace, FontCascadeInlines.h:140-143), except at the TextRun's index 0 unless
// the character is NBSP. The Canvas context has no word spacing, so it is added here.
function addWordSpacing(box: WebKitBox, from: number, to: number, width: number): number {
  if (box.wordSpacing === 0) return width
  const allowTabs = tabsAllowed(box.style)
  let w = width
  for (let i = from; i < to; i++) {
    const c = box.text.charCodeAt(i)
    const treatAsSpace = c === 0x20 || c === 0x0a || c === 0xa0 || (c === 0x09 && !allowTabs)
    if (treatAsSpace && (i > from || c === 0xa0)) w = f32(w + box.wordSpacing)
  }
  return w
}

// WidthIterator with tabs allowed. It first sums every glyph, a TAB as the space glyph, and shapes (advanceInternal,
// WidthIterator.cpp:440-488; a TAB is treated as a space, FontCascadeInlines.h:140-143), which is what Canvas totals for the
// string, since Canvas turns a TAB into a space too. Then it adds, per character in order, what spacing and tab stops add
// (applyExtraSpacingAfterShaping, :654-690): for a TAB f32(stop - space glyph) and then the letter spacing
// (calculateAdditionalWidth, :491-517; applyAdditionalWidth, :556-563), the stop counted from the TextRun's xPos plus the
// advances so far. So a lone TAB is f32(space + f32(stop - space)), not the stop (suite c-6607fcdcc27aec94: 22.880001068115234px
// for a stop 22.8799991607666px away). Without letter and word spacing the Canvas total plus the TABs' additions in order is
// WidthIterator's own float32 order; with spacing the additions interleave with the spacing's, and the text between TABs is
// summed piece by piece. The pen position before a TAB is a Canvas prefix total, where WidthIterator adds advances per
// character from xPos (gap tab-stops).
function tabbedWidth(_p: WebKitPrepared, m: Measurer, box: WebKitBox, from: number, to: number, left: number): number {
  const text = box.text
  const spaceWidth = measureText(m, box.plainContext, ' ')
  const tabAddition = (position: number): number => f32(tabWidth(box, spaceWidth, position) - spaceWidth)
  if (box.letterSpacing === 0 && box.wordSpacing === 0) {
    let width = measureDomString(m, box, box.context, text.slice(from, to))
    let added = 0
    for (let i = from; i < to; i++) {
      if (text.charCodeAt(i) !== 0x09) continue
      const before = i > from ? measureDomString(m, box, box.context, text.slice(from, i)) : 0
      const addition = tabAddition(f32(left + f32(before + added)))
      added = f32(added + addition)
      width = f32(width + addition)
    }
    return width
  }
  let width = 0
  let segmentStart = from
  for (let i = from; i <= to; i++) {
    if (i < to && text.charCodeAt(i) !== 0x09) continue
    if (i > segmentStart) width = f32(width + measureDomString(m, box, box.context, text.slice(segmentStart, i)))
    if (i < to) {
      let addition = tabAddition(f32(left + width))
      if (box.letterSpacing !== 0) addition = f32(addition + box.letterSpacing)
      width = f32(width + f32(spaceWidth + addition))
    }
    segmentStart = i + 1
  }
  return width
}

// FontCascade::widthForSimpleTextWithFixedPitch (FontCascade.cpp:414-442).
export function fixedPitchWidth(_p: WebKitPrepared, m: Measurer, box: WebKitBox, from: number, to: number): number {
  const spaceWidth = measureText(m, box.plainContext, ' ')
  if (collapsesWhiteSpace(box.style)) return f32((to - from) * spaceWidth)
  let width = 0
  for (let i = from; i < to; i++) {
    const c = box.text.charCodeAt(i)
    if (c === 0x0a || c === 0x2028 || c === 0x2029) continue
    if (c >= 0x20) width = f32(width + spaceWidth)
    if (i > from && c === 0x20) width = f32(width + box.wordSpacing)
  }
  return width
}

function containsTab(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (text.charCodeAt(i) === 0x09) return true
  return false
}

// The end of a range measured with UseTrailingWhitespaceMeasuringOptimization: a range followed by U+0020 in the same box
// takes that space along (TextUtil.cpp:72-76).
export function measuredEnd(box: WebKitBox, to: number, trailingSpace: boolean): number {
  return trailingSpace && to < box.text.length && box.text.charCodeAt(to) === 0x20 ? to + 1 : to
}

// TextUtil::width over a box range (TextUtil.cpp:62-104). With `trailingSpace` a range followed by U+0020 in the same box is
// measured with that space, then the space and word spacing are subtracted.
export function boxWidth(p: WebKitPrepared, m: Measurer, box: WebKitBox, from: number, to: number, left: number, trailingSpace: boolean, fixedPitchShortcut = true): number {
  if (from === to) return 0
  const end = measuredEnd(box, to, trailingSpace)
  let width: number
  if (fixedPitchShortcut && box.simplifiedMeasuring && box.fixedPitchFastMeasuring) {
    width = fixedPitchWidth(p, m, box, from, end)
  } else if (tabsAllowed(box.style) && containsTab(box.text, from, end)) {
    // Canvas strings split at TABs start past the TextRun's index 0, where WidthIterator gives a space word spacing, so the
    // tab path adds word spacing itself.
    width = addWordSpacing(box, from, end, tabbedWidth(p, m, box, from, end, left))
  } else {
    // rule webkit/measure/word-spacing-in-context
    // The spaced context adds word spacing where WidthIterator does, in its float32 order: after SPACE, LF and NBSP past index
    // 0 of the TextRun, which starts at `from` in both (TextUtil.cpp:84-89; WidthIterator.cpp calculateAdditionalWidth).
    width = measureDomString(m, box, box.spacedContext, box.text.slice(from, end))
  }
  if (end > to) width = f32(width - f32(singleSpaceWidth(m, box) + box.wordSpacing))
  return Number.isNaN(width) ? 0 : Math.max(0, width)
}

// The width shortcut's answer for the same range, which a fixed-pitch primary font would give (test T1 of
// specs/webkit-gaps.md §2.5): where it differs from boxWidth, FontFacts.monospace decides the width.
export function fixedPitchShortcutWidth(p: WebKitPrepared, m: Measurer, box: WebKitBox, from: number, to: number, trailingSpace: boolean): number {
  if (from === to) return 0
  const end = measuredEnd(box, to, trailingSpace)
  let width = fixedPitchWidth(p, m, box, from, end)
  if (end > to) width = f32(width - f32(singleSpaceWidth(m, box) + box.wordSpacing))
  return Number.isNaN(width) ? 0 : Math.max(0, width)
}

// TextUtil::width over an InlineTextItem range (TextUtil.cpp:111-122): collapsible white space and a single preserved
// space are one space wide.
export function itemWidth(p: WebKitPrepared, m: Measurer, item: WebKitTextItem, from: number, to: number, left: number): number {
  const box = p.boxes[item.box]!
  if (item.isWhitespace && (!preservesSpacesAndTabs(box.style) || (to - from === 1 && box.text.charCodeAt(from) === 0x20))) {
    return Math.max(0, singleSpaceWidth(m, box))
  }
  return boxWidth(p, m, box, from, to, left, true)
}

// U16_SET_CP_START
function codePointStart(text: string, start: number, index: number): number {
  if (index > start && (text.charCodeAt(index) & 0xfc00) === 0xdc00 && (text.charCodeAt(index - 1) & 0xfc00) === 0xd800) return index - 1
  return index
}

// U16_FWD_1(s, i, length)
export function forwardOneCodePoint(text: string, index: number, length: number): number {
  const lead = (text.charCodeAt(index) & 0xfc00) === 0xd800
  const i = index + 1
  if (lead && i !== length && (text.charCodeAt(i) & 0xfc00) === 0xdc00) return i + 1
  return i
}

export type WordBreakLeft = { length: number; logicalWidth: number }

// TextUtil::breakWord (TextUtil.cpp:242-365): the output of this exact probe sequence, not "the longest prefix that
// fits". Every probe measures from the item start.
export function breakWord(p: WebKitPrepared, m: Measurer, item: WebKitTextItem, textWidth: number, availableWidth: number, left: number): WordBreakLeft {
  const box = p.boxes[item.box]!
  const text = box.text
  const start = item.start
  const length = item.end - item.start
  if (textWidth === 0) return { length: 0, logicalWidth: 0 }
  const widthTo = (end: number) => boxWidth(p, m, box, start, end, left, true)
  if (box.simpleFontCodePath) {
    const aligned = (index: number) => box.is8Bit ? index : codePointStart(text, start, index)
    // :265-280, the fixed-pitch shortcut.
    if (box.fixedPitch && box.simplifiedMeasuring) {
      const characterWidth = measureText(m, box.context, ' ')
      const estimatedCount = Math.floor(f32(availableWidth / characterWidth))
      const end = aligned(Math.min(start + estimatedCount, start + length - 1))
      const underflow = widthTo(end)
      if (!(underflow > availableWidth || f32(underflow + characterWidth) < availableWidth)) return { length: end - start, logicalWidth: underflow }
    }
    // :284-311, the average-width estimate.
    const averageCharacterWidth = f32(textWidth / length)
    const candidateLength = Math.trunc(f32(availableWidth / averageCharacterWidth))
    const candidateEnd = aligned(start + candidateLength)
    if (candidateEnd > start && candidateEnd < start + length) {
      const w = widthTo(candidateEnd)
      if (w === availableWidth) return { length: candidateEnd - start, logicalWidth: w }
      if (w > availableWidth) {
        const adjusted = aligned(candidateEnd - 1)
        if (adjusted > start) {
          const aw = widthTo(adjusted)
          if (aw <= availableWidth) return { length: adjusted - start, logicalWidth: aw }
        }
      } else {
        const adjusted = aligned(candidateEnd + 1)
        if (adjusted < start + length) {
          const aw = widthTo(adjusted)
          if (aw > availableWidth) return { length: candidateEnd - start, logicalWidth: w }
          if (aw === availableWidth) return { length: adjusted - start, logicalWidth: aw }
        }
      }
    }
    // :315-349, bisection from twice the estimate.
    let leftIndex = start
    let right = start + length - 1
    const startOffset = Math.trunc(f32(f32(2 * availableWidth) / averageCharacterWidth))
    right = aligned(Math.min(leftIndex + startOffset, right))
    let leftSideWidth = 0
    while (leftIndex < right) {
      const middle = aligned(leftIndex + Math.floor((right - leftIndex) / 2))
      const endOfMiddle = box.is8Bit ? middle + 1 : forwardOneCodePoint(text, middle, start + length)
      const w = widthTo(endOfMiddle)
      if (w < availableWidth) {
        leftIndex = endOfMiddle
        leftSideWidth = w
      } else if (w > availableWidth) {
        right = middle
      } else {
        right = endOfMiddle
        leftSideWidth = w
        break
      }
    }
    return { length: right - start, logicalWidth: leftSideWidth }
  }
  // :354-364, the complex font path walks grapheme clusters.
  const boundaries = graphemeBoundaries(text.slice(start, start + length), graphemeRulesFor('webkit'))
  let result: WordBreakLeft = { length: 0, logicalWidth: 0 }
  for (let k = 1; k < boundaries.length; k++) {
    const w = widthTo(start + boundaries[k]!)
    if (w > availableWidth) return result
    result = { length: boundaries[k]!, logicalWidth: w }
  }
  return result
}

// TextUtil::firstUserPerceivedCharacterLength (TextUtil.cpp:578-604): one code unit for 8-bit text, one code point on the
// simple font path, else an ICU grapheme over the box content.
export function firstUserPerceivedCharacterLength(p: WebKitPrepared, item: WebKitTextItem): number {
  const box = p.boxes[item.box]!
  const itemLength = item.end - item.start
  if (box.is8Bit) return Math.min(itemLength, 1)
  if (box.simpleFontCodePath) return Math.min(itemLength, forwardOneCodePoint(box.text, item.start, box.text.length) - item.start)
  const boundaries = graphemeBoundaries(box.text, graphemeRulesFor('webkit'))
  for (let k = 0; k < boundaries.length; k++) {
    if (boundaries[k]! > item.start) return Math.min(itemLength, boundaries[k]! - item.start)
  }
  return itemLength
}
