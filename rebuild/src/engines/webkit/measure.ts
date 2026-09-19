// WebKit widths from Canvas totals: TextUtil::width with the following-space rule, singleSpaceWidth, tab stops, word
// spacing, the fixed-pitch shortcut, breakWord's probe sequence and firstUserPerceivedCharacterLength
// (specs/webkit-lines.md §3.3, §8.1; specs/webkit-canvas.md §(e); specs/webkit-gaps.md §2, §5). Every width is float32.
// Every read asks Canvas, in a context its box holds (types.ts WebKitBox), and nothing here keeps an answer.
import { width as canvasWidth, type Context } from '../../measure/canvas.js'
import { graphemeBoundaries } from '../../unicode/grapheme.js'
import { inRanges, webkitGraphemeRules } from './data.js'
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

// ---- The font code path ----
// FontCascade::width chooses the simple or the complex path from the TextRun it is handed (codePath(run),
// FontCascade.cpp:304-309; :708-730 scans the run's own characters), and TextUtil::width hands it the measured range alone
// (TextUtil.cpp:84-89). Canvas measures through the same function, so a string of a box's text takes the same path in both.
// The box's path, RenderText::canUseSimpleFontCodePath over its whole text (WebKitBox.simpleFontCodePath), is what simplified
// measuring, breakWord, firstUserPerceivedCharacterLength and the runs shaped across inline boxes read
// (LayoutIntegrationBoxTreeUpdater.cpp:260-264, TextUtil.cpp:253, :585, InlineLineBuilder.cpp:896), and no width does.
//
// Supplementary blocks isEmojiGroupCandidate accepts (WTF/wtf/text/CharacterProperties.h:34-55): Miscellaneous Symbols and
// Pictographs, Emoticons, Transport and Map Symbols, Supplemental Symbols and Pictographs, Symbols and Pictographs
// Extended-A. Only supplementary code points reach it.
function isEmojiGroupCandidate(c: number): boolean {
  return (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f680 && c <= 0x1f6ff) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x1fa70 && c <= 0x1faff)
}

// FontCascade::characterRangeCodePath (FontCascade.cpp:733-960): true when it returns Complex.
export function isComplexCodePath(text: string): boolean {
  let previousIsEmojiGroupCandidate = false
  const size = text.length
  for (let i = 0; i < size; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x200d && previousIsEmojiGroupCandidate) return true
    previousIsEmojiGroupCandidate = false
    if (c < 0x2e5) continue
    if (c <= 0x2e9) return true
    if (c < 0x300) continue
    if (c <= 0x36f) return true
    if (c < 0x591 || c === 0x5be) continue
    if (c <= 0x5cf) return true
    if (c < 0x600) continue
    if (c <= 0x109f) return true
    if (c < 0x1100) continue
    if (c <= 0x11ff) return true
    if (c < 0x135d) continue
    if (c <= 0x135f) return true
    if (c < 0x1700) continue
    if (c <= 0x18af) return true
    if (c < 0x1900) continue
    if (c <= 0x194f) return true
    if (c < 0x1980) continue
    if (c <= 0x19df) return true
    if (c < 0x1a00) continue
    if (c <= 0x1cff) return true
    if (c < 0x1dc0) continue
    if (c <= 0x1dff) return true
    if (c <= 0x2000) continue
    if (c < 0x20d0) continue
    if (c <= 0x20ff) return true
    if (c < 0x26f9) continue
    if (c < 0x26fa) return true
    if (c < 0x2cef) continue
    if (c <= 0x2cf1) return true
    if (c < 0x302a) continue
    if (c <= 0x302f) return true
    if (c < 0x3099) continue
    if (c < 0x309d) return true
    if (c < 0xa67c) continue
    if (c <= 0xa67d) return true
    if (c < 0xa6f0) continue
    if (c <= 0xa6f1) return true
    if (c < 0xa800) continue
    if (c <= 0xabff) return true
    if (c < 0xd7b0) continue
    if (c <= 0xd7ff) return true
    if (c <= 0xdbff) {
      if (i + 1 === size) continue
      const next = text.charCodeAt(++i)
      if ((next & 0xfc00) !== 0xdc00) continue
      const s = ((c - 0xd800) << 10) + next - 0xdc00 + 0x10000
      if (s < 0x10a00) continue
      if (s < 0x10a60) return true
      if (s < 0x11000) continue
      if (s < 0x110d0) return true
      if (s < 0x11100) continue
      if (s < 0x111e0) return true
      if (s < 0x11200) continue
      if (s < 0x11250) return true
      if (s < 0x112b0) continue
      if (s < 0x11380) return true
      if (s < 0x11400) continue
      if (s < 0x114e0) return true
      if (s < 0x11580) continue
      if (s < 0x11660) return true
      if (s < 0x11680) continue
      if (s < 0x116d0) return true
      if (s < 0x11700) continue
      if (s < 0x11cc0) return true
      if (s < 0x16b00) continue
      if (s < 0x16b90) return true
      if (s < 0x1e900) continue
      if (s < 0x1e960) return true
      if (s < 0x1f1e6) continue
      if (s <= 0x1f1ff) return true
      if (s >= 0x1f3fb && s <= 0x1f3ff) return true
      if (isEmojiGroupCandidate(s)) {
        previousIsEmojiGroupCandidate = true
        continue
      }
      if (s < 0xe0000) continue
      if (s < 0xe0080) return true
      if (s < 0xe0100) continue
      if (s <= 0xe01ef) return true
      continue
    }
    // :961-969, variation selectors and combining half marks.
    if (c < 0xfe00) continue
    if (c <= 0xfe0f) return true
    if (c < 0xfe20) continue
    if (c <= 0xfe2f) return true
  }
  return false
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
// The probe spacing is a power of two, so a count times it is exact; any value would do that the two totals' rounding can't
// reach half of. Both totals are float32 sums of at most three additions a glyph (the advance, the spacing, what shaping
// moved), each off by at most half a unit in the last place of the larger total, so their difference is within
// 3 * glyphs * ulp(total) of glyphs * spacing, and the count is exact while that stays under half the spacing: about 900
// letters at 16px (probe webkit-round4 R8: off by less than 0.002 of a glyph at 50,000 letters in 5 fonts). Past that the
// string isn't counted and reports the gap. U+200C between merged pairs adds code units and no glyph to a string, so the
// bound takes twice the string's length.
const LETTER_SPACING_PROBE = 64

// A string's spacing-bearing glyphs, from its total in the count context and its total without spacing.
function glyphCount(spacedTotal: number, plainTotal: number): number {
  return Math.round((spacedTotal - plainTotal) / LETTER_SPACING_PROBE)
}

function spacedGlyphCount(box: WebKitBox, s: string): number {
  return glyphCount(canvasWidth(box.countContext, s), canvasWidth(box.plainContext, s))
}

function glyphCountIsExact(spacedTotal: number, length: number): boolean {
  return !(spacedTotal > 0) || 3 * 2 * length * 2 ** (Math.floor(Math.log2(spacedTotal)) - 23) < LETTER_SPACING_PROBE / 2
}

// What Canvas shows of merged glyphs in a string a letter-spaced box measures. The features the DOM turns off join separate
// grapheme clusters; inside a cluster glyphs merge by other rules the DOM keeps (marks, conjuncts, emoji sequences), so
// clusters are counted, not code points. `merged`: the string counts fewer spacing-bearing glyphs than its grapheme clusters
// do alone. `pairs`: the offsets of adjacent cluster pairs that merge when measured as a pair, [first, end of second).
// `separated`: on the simple font code path, the string with U+200C between the clusters of each such pair, when that
// leaves nothing merged; else null. `counted`: false where the string is too long for an exact count (above), which reports
// as merged. WidthIterator commits the font range before a default-ignorable without a glyph and
// adds it as a deleted glyph of width 0 (commitIgnorable, WidthIterator.cpp:318-323), and a U+200C glyph sits between the
// two letters otherwise, so no lookup matches across it, and it gets no letter spacing (calculateAdditionalWidth's baseWidth
// test). The separated string is the DOM's glyphs less what shaping does across each separated pair with those features
// off: a pair adjustment between the two letters (probe R1: ProbeShantell 700 `fi` is 0.288px wider in the DOM, Amiri's is
// equal). On the complex path U+200C would break joining, and a required ligature such as lam-alef merges in the DOM too
// (probe R1), so nothing is separated there. The path is the measured string's ("The font code path"): `office` after a
// combining mark or an Arabic letter of the same box is measured on the simple path once the range starts past them, so its
// pairs are separated (suite c-19d718b564ee2744: `ffi` after U+2060 U+0301 at -4px of letter spacing is about 8px too wide
// with its ligature, 9 lines for the DOM's 4).
// Where the listed families' facts say which font draws every character of the string and none of them is an input of a
// liga, clig, dlig or hlig lookup there (ListedFontFacts.spacingInputs), letter-spacing changes nothing in the string:
// whatever merges, merges in the DOM too (Geeza Pro's lam-alef and Allah ligatures are morx ligatures the DOM keeps).
export type MergedGlyphs = { merged: boolean; pairs: Array<[number, number]>; separated: string | null; counted: boolean }
const NOTHING_MERGED: MergedGlyphs = { merged: false, pairs: [], separated: null, counted: true }

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

export function mergedGlyphs(box: WebKitBox, text: string): MergedGlyphs {
  if (box.letterSpacing === 0 || text.length < 2) return NOTHING_MERGED
  if (spacingCanChangeShaping(box, text) === false) return NOTHING_MERGED
  const s = canvasString(text)
  // The string's total in the count context says whether the string can be counted, and then counts it.
  const spacedTotal = canvasWidth(box.countContext, s)
  if (!glyphCountIsExact(spacedTotal, s.length)) return { merged: true, pairs: [], separated: null, counted: false }
  const starts = graphemeBoundaries(s, webkitGraphemeRules)
  const counts: number[] = []
  let alone = 0
  for (let k = 0; k + 1 < starts.length; k++) {
    const count = spacedGlyphCount(box, s.slice(starts[k]!, starts[k + 1]!))
    counts.push(count)
    alone += count
  }
  if (glyphCount(spacedTotal, canvasWidth(box.plainContext, s)) >= alone) return NOTHING_MERGED
  const pairs: Array<[number, number]> = []
  let separated = ''
  for (let k = 0; k + 1 < counts.length; k++) {
    const isMerged = spacedGlyphCount(box, s.slice(starts[k]!, starts[k + 2]!)) < counts[k]! + counts[k + 1]!
    if (isMerged) pairs.push([starts[k]!, starts[k + 2]!])
    separated += s.slice(starts[k]!, starts[k + 1]!) + (isMerged ? '\u200c' : '')
  }
  separated += s.slice(starts[counts.length - 1]!)
  // A simple path box holds no character of the complex path, so none of its strings does.
  const simplePath = box.simpleFontCodePath || !isComplexCodePath(s)
  if (!simplePath || pairs.length === 0 || spacedGlyphCount(box, separated) < alone) return { merged: true, pairs, separated: null, counted: true }
  return { merged: true, pairs, separated, counted: true }
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
export function isPiecedControl(c: number): boolean {
  return c === 0x0b || c === 0x0c || c === 0x0d
}

// Whether Canvas shows a pair adjustment around the control at `index` of `text`.
export function controlIsAdjusted(context: Context, text: string, index: number): boolean {
  const before = index > 0 && !isPiecedControl(text.charCodeAt(index - 1)) ? text[index - 1]! : ''
  const after = index + 1 < text.length && !isPiecedControl(text.charCodeAt(index + 1)) ? text[index + 1]! : ''
  const standIn = text.charCodeAt(index) === 0x0d ? String.fromCharCode(0) : String.fromCharCode(1)
  // The space is asked whatever stands around the control, as it has been since the rows were recorded.
  const space = canvasWidth(context, ' ')
  if (before === '') return false
  const beforeSpace = canvasWidth(context, `${before} `)
  const beforeAlone = canvasWidth(context, before)
  if (beforeSpace !== f32(beforeAlone + space)) return true
  return after !== '' && canvasWidth(context, before + standIn + after) !== f32(f32(beforeAlone + canvasWidth(context, standIn)) + canvasWidth(context, after))
}

// The Canvas width of a range the DOM measures: in a letter-spaced box the separated string where Canvas shows merged pairs,
// and VT, FF and CR by the stand-in or the pieces above.
function measureDomString(box: WebKitBox, context: Context, text: string): number {
  const separated = mergedGlyphs(box, text).separated
  const s = separated === null ? text : separated
  let pieced = false
  for (let i = 0; i < s.length && !pieced; i++) pieced = isPiecedControl(s.charCodeAt(i)) && controlIsAdjusted(context, s, i)
  if (!pieced) return canvasWidth(context, canvasString(s))
  const space = canvasWidth(context, ' ')
  let width = 0
  let segmentStart = 0
  for (let i = 0; i <= s.length; i++) {
    if (i < s.length && !isPiecedControl(s.charCodeAt(i))) continue
    const segment = canvasString(s.slice(segmentStart, i))
    if (i === s.length) {
      if (segment !== '') width = f32(width + canvasWidth(context, segment))
      break
    }
    // The text before the control, shaped before a space: its own total where Canvas shows no adjustment between its last
    // letter and a space (exact), else the total with the space less the space.
    if (segment !== '') {
      const last = segment[segment.length - 1]!
      const adjusted = canvasWidth(context, `${last} `) !== f32(canvasWidth(context, last) + space)
      width = f32(width + (adjusted ? f32(canvasWidth(context, `${segment} `) - space) : canvasWidth(context, segment)))
    }
    if (s.charCodeAt(i) !== 0x0d) width = f32(width + canvasWidth(context, String.fromCharCode(1)))
    segmentStart = i + 1
  }
  return width
}

// TextUtil::singleSpaceWidth (TextUtil.cpp:54-60): widthOfSpaceString, a TextRun of one space, which gets letter spacing
// and no word spacing (index 0), or the primary font's space advance on the simplified path, which has no spacing. The box
// keeps it where its items were built with it (WebKitBox.spaceWidth).
export function singleSpaceWidth(box: WebKitBox): number {
  return box.spaceWidth ?? canvasWidth(box.context, ' ')
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
  if (box.style.wordSpacing === 0) return width
  const allowTabs = tabsAllowed(box.style)
  let w = width
  for (let i = from; i < to; i++) {
    const c = box.text.charCodeAt(i)
    const treatAsSpace = c === 0x20 || c === 0x0a || c === 0xa0 || (c === 0x09 && !allowTabs)
    if (treatAsSpace && (i > from || c === 0xa0)) w = f32(w + box.style.wordSpacing)
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
function tabbedWidth(box: WebKitBox, from: number, to: number, left: number): number {
  const text = box.text
  const spaceWidth = canvasWidth(box.plainContext, ' ')
  const tabAddition = (position: number): number => f32(tabWidth(box, spaceWidth, position) - spaceWidth)
  if (box.letterSpacing === 0 && box.style.wordSpacing === 0) {
    let width = measureDomString(box, box.context, text.slice(from, to))
    let added = 0
    for (let i = from; i < to; i++) {
      if (text.charCodeAt(i) !== 0x09) continue
      const before = i > from ? measureDomString(box, box.context, text.slice(from, i)) : 0
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
    if (i > segmentStart) width = f32(width + measureDomString(box, box.context, text.slice(segmentStart, i)))
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
export function fixedPitchWidth(box: WebKitBox, from: number, to: number): number {
  const spaceWidth = canvasWidth(box.plainContext, ' ')
  if (collapsesWhiteSpace(box.style)) return f32((to - from) * spaceWidth)
  let width = 0
  for (let i = from; i < to; i++) {
    const c = box.text.charCodeAt(i)
    if (c === 0x0a || c === 0x2028 || c === 0x2029) continue
    if (c >= 0x20) width = f32(width + spaceWidth)
    if (i > from && c === 0x20) width = f32(width + box.style.wordSpacing)
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
// measured with that space, then the space and word spacing are subtracted. The total is the width shortcut's where the box
// takes it, else the advances.
export function boxWidth(box: WebKitBox, from: number, to: number, left: number, trailingSpace: boolean): number {
  if (from === to) return 0
  const end = measuredEnd(box, to, trailingSpace)
  return lessMeasuredSpace(box, to, end, box.simplifiedMeasuring && box.fixedPitchFastMeasuring ? fixedPitchWidth(box, from, end) : advancesWidth(box, from, end, left))
}

// The advances of [from, end), as WidthIterator or the complex text controller sums them. Where the font facts don't say
// whether the box takes the width shortcut, gaps.ts holds this total against the shortcut's (test T1 of
// specs/webkit-gaps.md §2.5).
export function advancesWidth(box: WebKitBox, from: number, end: number, left: number): number {
  // Canvas strings split at TABs start past the TextRun's index 0, where WidthIterator gives a space word spacing, so the
  // tab path adds word spacing itself.
  if (tabsAllowed(box.style) && containsTab(box.text, from, end)) return addWordSpacing(box, from, end, tabbedWidth(box, from, end, left))
  // rule webkit/measure/word-spacing-in-context
  // The spaced context adds word spacing where WidthIterator does, in its float32 order: after SPACE, LF and NBSP past index
  // 0 of the TextRun, which starts at `from` in both (TextUtil.cpp:84-89; WidthIterator.cpp calculateAdditionalWidth).
  return measureDomString(box, box.spacedContext, box.text.slice(from, end))
}

// The width of a range that ends at `to` from the total measured to `end` (measuredEnd).
export function lessMeasuredSpace(box: WebKitBox, to: number, end: number, total: number): number {
  const width = end > to ? f32(total - f32(singleSpaceWidth(box) + box.style.wordSpacing)) : total
  return Number.isNaN(width) ? 0 : Math.max(0, width)
}

// TextUtil::width over an InlineTextItem range (TextUtil.cpp:111-122): collapsible white space and a single preserved
// space are one space wide.
export function itemWidth(p: WebKitPrepared, item: WebKitTextItem, from: number, to: number, left: number): number {
  const box = p.boxes[item.box]!
  if (item.isWhitespace && (!preservesSpacesAndTabs(box.style) || (to - from === 1 && box.text.charCodeAt(from) === 0x20))) {
    return Math.max(0, singleSpaceWidth(box))
  }
  return boxWidth(box, from, to, left, true)
}

// U16_SET_CP_START
export function codePointStart(text: string, start: number, index: number): number {
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
export function breakWord(p: WebKitPrepared, item: WebKitTextItem, textWidth: number, availableWidth: number, left: number): WordBreakLeft {
  const box = p.boxes[item.box]!
  const text = box.text
  const start = item.start
  const length = item.end - item.start
  if (textWidth === 0) return { length: 0, logicalWidth: 0 }
  const widthTo = (end: number) => boxWidth(box, start, end, left, true)
  if (box.simpleFontCodePath) {
    const aligned = (index: number) => box.is8Bit ? index : codePointStart(text, start, index)
    // :265-280, the fixed-pitch shortcut.
    if (box.fixedPitch && box.simplifiedMeasuring) {
      const characterWidth = singleSpaceWidth(box)
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
  const boundaries = graphemeBoundaries(text.slice(start, start + length), webkitGraphemeRules)
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
  const boundaries = graphemeBoundaries(box.text, webkitGraphemeRules)
  for (let k = 0; k < boundaries.length; k++) {
    if (boundaries[k]! > item.start) return Math.min(itemLength, boundaries[k]! - item.start)
  }
  return itemLength
}
