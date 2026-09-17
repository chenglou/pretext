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

// WidthIterator with tabs allowed (WidthIterator.cpp:500-519): a TAB's advance is its tab stop, and letter spacing is
// added after it as after every glyph with an advance; the text between TABs is a Canvas total.
function tabbedWidth(_p: WebKitPrepared, m: Measurer, box: WebKitBox, from: number, to: number, left: number): number {
  const text = box.text
  const spaceWidth = measureText(m, box.plainContext, ' ')
  let width = 0
  let segmentStart = from
  for (let i = from; i <= to; i++) {
    if (i < to && text.charCodeAt(i) !== 0x09) continue
    if (i > segmentStart) width = f32(width + measureText(m, box.context, canvasString(text.slice(segmentStart, i))))
    if (i < to) {
      width = f32(width + tabWidth(box, spaceWidth, f32(left + width)))
      if (box.letterSpacing !== 0) width = f32(width + box.letterSpacing)
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
    // The spaced context adds word spacing where WidthIterator does, in its float32 order: after SPACE, LF and NBSP past index
    // 0 of the TextRun, which starts at `from` in both (TextUtil.cpp:84-89; WidthIterator.cpp calculateAdditionalWidth).
    width = measureText(m, box.spacedContext, canvasString(box.text.slice(from, end)))
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
