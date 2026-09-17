// WebKit content building (Safari 27.0): which runs get a text renderer, per-box locale, storage, code path, font facts and
// measuring facts, InlineItemsBuilder::handleTextContent, the bidi paragraph with its item splits, stored widths, the
// builder choice and the paragraph's gaps (specs/webkit-text.md §2-§6, specs/webkit-lines.md §2-§3). Cited at
// WebKit-7625.1.29.11.27 under Source/WebCore/: IIB = layout/formattingContexts/inline/InlineItemsBuilder.cpp.
import type { WebKitEnvironment } from '../../env.js'
import { measureContext, measureText, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { Paragraph, TextRun } from '../../model.js'
import { getCategory } from '../../breaks/rbbi.js'
import { AL, LRE, LRO, PDF, R, RLE, RLO, bidiClassOf, bidiDataFor, type BidiData } from '../../unicode/bidi.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import { canBreakBefore, dictionaryRangeStartsWithMark, makeFactory, moveToNextBreakablePosition } from './breaks.js'
import { computedLocale, hasDelimiterData, isDelimiterQuote, isHanLocale, isPunctuation, lineRules, localeScript } from './data.js'
import { boxWidth, fixedPitchShortcutWidth, itemWidth, singleSpaceWidth } from './measure.js'
import { preservesNewline, preservesSpacesAndTabs, tabsAllowed, webkitStyle } from './style.js'
import type { WebKitBox, WebKitPrepared, WebKitStyle, WebKitTextItem } from './types.js'

const f32 = Math.fround

// UBIDI_DEFAULT_LTR, the level of items built without bidi (IIB:907, 977, 987, 1031).
export const DEFAULT_BIDI_LEVEL = 254
// InlineItem::opaqueBidiLevel (InlineItem.h:54).
const OPAQUE_BIDI_LEVEL = 255

// uprv_getDefaultLocaleID without LANG, LC_ALL or LC_MESSAGES (AppleICU76 putil.cpp:1727-1874; specs/webkit-gaps.md §8.2).
const ICU_DEFAULT_LOCALE_WITHOUT_ENVIRONMENT = 'en_US_POSIX'

// isASCIIWhitespace: SPACE, LF, TAB, CR, FF; VT isn't one (WTF/ASCIICType.h:154-157).
function containsOnlyASCIIWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c !== 0x20 && c !== 0x0a && c !== 0x09 && c !== 0x0d && c !== 0x0c) return false
  }
  return true
}

// RenderTreeUpdater::textRendererIsNeeded (RenderTreeUpdater.cpp:536-595) for the model's tree: a bare text node in the
// block, or a span's only child. `previous` is the block's previous child renderer.
function textRendererIsNeeded(run: TextRun, previous: 'none' | 'text' | 'inline', style: WebKitStyle): boolean {
  if (run.text.length === 0) return false
  if (!containsOnlyASCIIWhitespace(run.text)) return true
  switch (run.node) {
    // The parent is the span's RenderInline, and the node has no previous sibling inside it (:562-568).
    case 'span':
      return true
    case 'text':
      if (previous === 'text') return true
      if (preservesNewline(style)) return true
      // The first inline content inside the block gets none; otherwise hasPrecedingInFlowChild (:570-594).
      return previous !== 'none'
  }
}

// Supplementary blocks isEmojiGroupCandidate accepts (WTF/wtf/text/CharacterProperties.h:34-55): Miscellaneous Symbols and
// Pictographs, Emoticons, Transport and Map Symbols, Supplemental Symbols and Pictographs, Symbols and Pictographs
// Extended-A. Only supplementary code points reach it.
function isEmojiGroupCandidate(c: number): boolean {
  return (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f680 && c <= 0x1f6ff) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x1fa70 && c <= 0x1faff)
}

// FontCascade::characterRangeCodePath (FontCascade.cpp:733-960): true when it returns Complex.
function isComplexCodePath(text: string): boolean {
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

// WidthIterator::characterCanUseSimplifiedTextMeasuring (WidthIterator.cpp:694-742).
function characterCanUseSimplifiedTextMeasuring(c: number, whitespaceIsCollapsed: boolean): boolean {
  switch (c) {
    case 0x0a:
    case 0x0d:
      return true
    case 0x09:
      if (!whitespaceIsCollapsed) return false
      break
    case 0x00a0: case 0x00ad: case 0x200e: case 0x200f: case 0x202a: case 0x202b: case 0x202d: case 0x202e:
    case 0x2066: case 0x2067: case 0x202c: case 0x2069: case 0x2068: case 0xfffc: case 0xfeff: case 0x200c:
    case 0x200d: case 0x2060: case 0x200b: case 0x2061: case 0x2062: case 0x2063: case 0x206a: case 0x206b:
    case 0x206c: case 0x206d: case 0x206e: case 0x206f: case 0x2592:
      return false
  }
  return !(c >= 0x3041 || c <= 0x1f || (c >= 0x7f && c <= 0x9f))
}

// The system design families CoreText resolves with the locale (FontCacheCoreText.cpp:585-598, SystemFontDatabaseCoreText.cpp:236).
const SYSTEM_DESIGN_FAMILIES = ['system-ui', '-apple-system', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded']
// CSS <generic-family> keywords (CSS Fonts 4 §4.2) and WebKit's -apple-system and -webkit- aliases: written unquoted in a
// font-family list, since a quoted keyword names a family of that name.
const GENERIC_FAMILY_KEYWORDS = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui', 'emoji', 'math', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', '-apple-system', '-webkit-standard', '-webkit-body', '-webkit-pictograph']

function familyNames(family: string): string[] {
  const out: string[] = []
  const parts = family.split(',')
  for (let i = 0; i < parts.length; i++) out.push(parts[i]!.trim().replace(/^["']|["']$/g, '').toLowerCase())
  return out
}

function cssFamilyName(name: string): string {
  return GENERIC_FAMILY_KEYWORDS.includes(name.toLowerCase()) ? name : JSON.stringify(name)
}

// TextUtil::isStrongDirectionalityCharacter (TextUtil.cpp:486-515), over the code points of 16-bit content.
function hasStrongDirectionality(text: string, is8Bit: boolean, bidi: BidiData): boolean {
  if (is8Bit) return false
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    if (cp < 0x0590 || (cp >= 0x2010 && cp <= 0x2029) || (cp >= 0x206a && cp <= 0xd7ff) || (cp >= 0xff00 && cp <= 0xffff)) continue
    const c = bidiClassOf(bidi, cp)
    if (c === R || c === AL || c === RLE || c === RLO || c === LRE || c === LRO || c === PDF) return true
  }
  return false
}

function makeBox(p: WebKitPrepared, m: Measurer, run: number, sourceStart: number, bidi: BidiData): WebKitBox {
  const r = p.paragraph.runs[run]!
  const facts = r.font.facts
  const zoom = f32(p.zoom)
  const size = f32(f32(r.font.size) * zoom)
  const letterSpacing = f32(f32(r.letterSpacing) * zoom)
  const wordSpacing = f32(f32(r.wordSpacing) * zoom)
  const text = r.text
  let is8Bit = true
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) { is8Bit = false; break }
  const simpleFontCodePath = !isComplexCodePath(text)
  let simplifiedMeasuring = simpleFontCodePath && letterSpacing === 0 && wordSpacing === 0
  const collapsed = p.style.collapse === 'collapse' || p.style.collapse === 'preserve-breaks'
  for (let i = 0; simplifiedMeasuring && i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    simplifiedMeasuring = characterCanUseSimplifiedTextMeasuring(cp, collapsed)
  }
  // The index-0 family (FontCascadeFonts.cpp:200-218): the given fact, else the first family listed.
  const primaryFamily = facts.primaryFamily === null ? familyNames(r.font.family)[0]! : facts.primaryFamily.toLowerCase()
  const primaryFamilyCss = facts.primaryFamily === null ? r.font.family.split(',')[0]!.trim() : cssFamilyName(facts.primaryFamily)
  const fixedPitch = facts.monospace === true
  const font = canvasFont(r.font, size)
  const settings = { font, lang: '', letterSpacing: `${letterSpacing}px`, wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
  const context = measureContext(m, settings)
  const plainContext = measureContext(m, { ...settings, letterSpacing: '0px' })
  // Simplified measuring also needs a glyph from the primary font for every character
  // (FontCascade::canUseSimplifiedTextMeasuring, FontCascade.cpp:486-510). Fallback follows the family list before
  // system fallback (FontCascadeFonts.cpp:426-439, specs/webkit-gaps.md §3.3), so a family after the primary one that
  // draws a glyph no other font would shows coverage: if the primary family maps the code point, "P, LastResort" draws
  // the paragraph's glyph; otherwise LastResort's box, 17.6015625px at 16px in webkit-host (rebuild/probes/webkit-followups.ts
  // B5: Courier maps Ω, Menlo doesn't map U+3000). Only fixed-pitch boxes read the result, in the width and breakWord
  // shortcuts; the 17.6015625px advance matching a fallback glyph's is the recipe's loss.
  if (simplifiedMeasuring && fixedPitch) {
    const coverageContext = measureContext(m, { ...settings, font: canvasFont({ ...r.font, family: `${primaryFamilyCss}, LastResort` }, size), letterSpacing: '0px' })
    for (let i = 0; simplifiedMeasuring && i < text.length; i++) {
      const cp = text.codePointAt(i)!
      if (cp > 0xffff) i++
      if (cp < 0x20) continue
      const s = String.fromCodePoint(cp)
      simplifiedMeasuring = measureText(m, coverageContext, s) === measureText(m, plainContext, s)
    }
  }
  return {
    run, sourceStart, text, is8Bit, simpleFontCodePath, simplifiedMeasuring, fixedPitch,
    fixedPitchFastMeasuring: fixedPitch && primaryFamily !== 'courier new',
    monospaceUnknown: facts.monospace === null,
    primaryFamily,
    hyphen: facts.mapsHyphen === false ? '-' : '‐',
    hyphenUnknown: facts.mapsHyphen === null,
    locale: computedLocale(r.lang ?? p.paragraph.lang, p.env.preferredLanguages),
    context, plainContext, letterSpacing, wordSpacing, hasStrongDirectionality: hasStrongDirectionality(text, is8Bit, bidi),
  }
}

// moveToNextNonWhitespacePosition (IIB:54-73). " \t" stops before the TAB when splitting at word separators; "\t " doesn't.
function whitespaceRun(text: string, start: number, preserveNewline: boolean, preserveTab: boolean, stopAtWordSeparatorBoundary: boolean): { length: number; isWordSeparator: boolean } | null {
  let hasWordSeparator = false
  let isWordSeparator = false
  let q = start
  while (q < text.length) {
    const c = text.charCodeAt(q)
    const treatedAsSpace = c === 0x20 || (c === 0x0a && !preserveNewline) || (c === 0x09 && !preserveTab)
    isWordSeparator = treatedAsSpace
    hasWordSeparator = hasWordSeparator || isWordSeparator
    if (!treatedAsSpace && c !== 0x09) break
    if (stopAtWordSeparatorBoundary && hasWordSeparator && !isWordSeparator) break
    q++
  }
  return q === start ? null : { length: q - start, isWordSeparator: hasWordSeparator }
}

// InlineItemsBuilder::handleTextContent (IIB:924-1051) with hyphens: manual and -webkit-nbsp-mode: normal. `defer` is
// shouldDeferTextMeasurement's content part: the paragraph needs visual reordering (IIB:1150-1154).
function handleTextContent(p: WebKitPrepared, m: Measurer, boxIndex: number, defer: boolean): void {
  const box = p.boxes[boxIndex]!
  const text = box.text
  const preserveSpaces = preservesSpacesAndTabs(p.style)
  const preserveNewline = preservesNewline(p.style)
  const factory = makeFactory(text, box.is8Bit, box.locale, p.style.lineBreakMode, p.icuDefaultLocale, p.env.dictionaryBreaks)
  // canCacheWidthOnInlineTextItem (IIB:777-787): preserved white space in a box with a TAB depends on position.
  const deferWhitespace = defer || (preserveSpaces && text.includes('\t'))
  const spaceWidth = deferWhitespace ? null : Math.max(0, singleSpaceWidth(m, box))
  let position = 0
  while (position < text.length) {
    const c = text.charCodeAt(position)
    // U+2028 and U+2029 always force a break; LF does when newlines are preserved (:954-962).
    if (c === 0x2028 || c === 0x2029 || (c === 0x0a && preserveNewline)) {
      p.items.push({ kind: 'soft-line-break', box: boxIndex, start: position, level: DEFAULT_BIDI_LEVEL })
      position++
      continue
    }
    const ws = whitespaceRun(text, position, preserveNewline, preserveSpaces, preserveSpaces && box.wordSpacing !== 0)
    if (ws !== null) {
      if (p.style.collapse === 'break-spaces') {
        for (let k = 0; k < ws.length; k++) {
          p.items.push({ kind: 'text', box: boxIndex, start: position + k, end: position + k + 1, level: DEFAULT_BIDI_LEVEL, isWhitespace: true, isWordSeparator: ws.isWordSeparator, hasTrailingSoftHyphen: false, width: spaceWidth })
        }
      } else {
        const width = spaceWidth === null ? null : !preserveSpaces || ws.length === 1 ? spaceWidth : boxWidth(p, m, box, position, position + ws.length, 0, false)
        p.items.push({ kind: 'text', box: boxIndex, start: position, end: position + ws.length, level: DEFAULT_BIDI_LEVEL, isWhitespace: true, isWordSeparator: ws.isWordSeparator, hasTrailingSoftHyphen: false, width })
      }
      position += ws.length
      continue
    }
    const end = position + moveToNextBreakablePosition(position, factory, p.style)
    p.items.push({
      kind: 'text', box: boxIndex, start: position, end, level: DEFAULT_BIDI_LEVEL, isWhitespace: false, isWordSeparator: false,
      hasTrailingSoftHyphen: text.charCodeAt(end - 1) === 0xad, width: defer ? null : boxWidth(p, m, box, position, end, 0, true),
    })
    position = end
  }
}

// replaceNonPreservedNewLineAndTabCharactersAndAppend (IIB:383-415): LF and TAB become spaces, and U+2029 too in 16-bit
// content. CR, VT, FF, U+001C-U+001F and NEL stay literal.
function bidiBoxContent(box: WebKitBox): string {
  let out = ''
  for (let i = 0; i < box.text.length; i++) {
    const c = box.text.charCodeAt(i)
    out += c === 0x0a || c === 0x09 || (!box.is8Bit && c === 0x2029) ? ' ' : box.text[i]!
  }
  return out
}

// InlineItemsBuilder::breakAndComputeBidiLevels (IIB:550-775) for a block with unicode-bidi: normal and spans without
// unicode-bidi: the paragraph text, ubidi_setPara, the item splits at logical run ends, and the opaque levels.
function computeBidiLevels(p: WebKitPrepared): void {
  const items = p.items
  const preserveNewline = preservesNewline(p.style)
  let paragraph = ''
  const offsets: (number | null)[] = []
  let lastBox = -1
  let boxOffset = 0
  const appendBoxContentOnce = (box: number) => {
    if (lastBox === box) return
    boxOffset = paragraph.length
    paragraph += bidiBoxContent(p.boxes[box]!)
    lastBox = box
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    switch (item.kind) {
      case 'soft-line-break':
        if (p.boxes[item.box]!.text.charCodeAt(item.start) !== 0x2028) {
          // handleBidiParagraphStart (:535-548): no controls to unwind, then LF.
          offsets.push(paragraph.length)
          paragraph += '\n'
        } else if (!preserveNewline) {
          appendBoxContentOnce(item.box)
          offsets.push(boxOffset + item.start)
        } else {
          // :593 appends the U+2028 itself.
          offsets.push(paragraph.length)
          paragraph += '\u2028'
        }
        break
      case 'text':
        if (!preserveNewline) {
          appendBoxContentOnce(item.box)
          offsets.push(boxOffset + item.start)
        } else {
          offsets.push(paragraph.length)
          paragraph += p.boxes[item.box]!.text.slice(item.start, item.end)
        }
        break
      case 'inline-box-start':
      case 'inline-box-end':
        offsets.push(null)
        break
    }
  }
  if (paragraph.length === 0) return
  const levels = resolveIcuBidi(paragraph, p.style.rtl ? 'rtl' : 'ltr', bidiDataFor('webkit')).levels
  let itemIndex = 0
  let hasSeenOpaqueItem = false
  for (let position = 0; position < paragraph.length;) {
    // ubidi_getLogicalRun: the maximal run of equal levels from `position`.
    const level = levels[position]!
    let end = position + 1
    while (end < paragraph.length && levels[end] === level) end++
    for (; itemIndex < offsets.length; itemIndex++) {
      const offset = offsets[itemIndex]!
      const item = items[itemIndex]!
      if (offset === null) {
        hasSeenOpaqueItem = true
        item.level = level
        continue
      }
      if (offset >= end) break
      item.level = level
      if (item.kind !== 'text') continue
      if (offset + item.end - item.start > end) {
        // InlineTextItem::split (InlineTextItem.cpp:73-82): both sides keep hasTrailingSoftHyphen, and neither keeps a width.
        const leftLength = end - offset
        const right: WebKitTextItem = { ...item, start: item.start + leftLength, width: null }
        item.end = item.start + leftLength
        item.width = null
        items.splice(itemIndex + 1, 0, right)
        offsets.splice(itemIndex + 1, 0, end)
        itemIndex++
        break
      }
    }
    position = end
  }
  if (!hasSeenOpaqueItem) return
  // setBidiLevelForOpaqueInlineItems (:730-774).
  const hasContent: boolean[] = []
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!
    switch (item.kind) {
      case 'inline-box-start':
        if (hasContent.pop() === true) item.level = OPAQUE_BIDI_LEVEL
        break
      case 'inline-box-end':
        hasContent.push(false)
        item.level = OPAQUE_BIDI_LEVEL
        break
      case 'text':
        if (!item.isWhitespace || preservesSpacesAndTabs(p.style)) hasContent.fill(true)
        break
      case 'soft-line-break':
        hasContent.fill(true)
        break
    }
  }
}

// computeInlineTextItemWidthsAndTextSpacing (IIB:804-856): after the splits, every non-empty item that isn't a lone ZWSP
// and whose width doesn't depend on position.
function computeItemWidths(p: WebKitPrepared, m: Measurer): void {
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.kind !== 'text') continue
    const box = p.boxes[item.box]!
    const length = item.end - item.start
    if (length === 0 || (length === 1 && box.text.charCodeAt(item.start) === 0x200b)) continue
    if (item.isWhitespace && preservesSpacesAndTabs(p.style) && box.text.includes('\t')) continue
    item.width = itemWidth(p, m, item, item.start, item.end, 0)
  }
}

// Code points whose system fallback CoreText picks by language: Hangul, CJK symbols and punctuation, kana, Bopomofo, Han
// and fullwidth forms, by block (specs/webkit-canvas.md §1.3, probes-safari cross-cutting 4).
function hasLanguageDependentFallback(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa960 && cp <= 0xa97f)
    || (cp >= 0xac00 && cp <= 0xd7ff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xffef)
    || (cp >= 0x1aff0 && cp <= 0x1b16f) || (cp >= 0x1f200 && cp <= 0x1f2ff) || (cp >= 0x20000 && cp <= 0x3ffff)
}

// Test T1 of specs/webkit-gaps.md §2.5 over the box's items: whether the width shortcut a fixed-pitch primary font takes
// would give another width than the advances layout measured.
function fixedPitchDecidesWidths(p: WebKitPrepared, m: Measurer, boxIndex: number): boolean {
  const box = p.boxes[boxIndex]!
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.kind !== 'text' || item.box !== boxIndex || item.width === null) continue
    // Collapsible white space and a lone preserved space are one space wide whatever the pitch (TextUtil.cpp:111-122).
    if (item.isWhitespace && (!preservesSpacesAndTabs(p.style) || item.end - item.start === 1)) continue
    const trailingSpace = !item.isWhitespace
    if (boxWidth(p, m, box, item.start, item.end, 0, trailingSpace) !== fixedPitchShortcutWidth(p, m, box, item.start, item.end, trailingSpace)) return true
  }
  return false
}

// The paragraph's gaps: conditions of its content, fonts and environment whatever the width (DESIGN.md §2.8, §5). Gaps
// that depend on where lines break are reported by lines.ts.
function collectGaps(p: WebKitPrepared, m: Measurer): void {
  const gaps = p.gaps
  const env = p.env
  if (env.pageZoom === null) {
    gaps.push({ gap: 'page-zoom', run: null, detail: "the page zoom isn't given; laid out at 1" })
  }
  let complexRtlBoxes = 0
  for (let b = 0; b < p.boxes.length; b++) {
    const box = p.boxes[b]!
    const run = p.paragraph.runs[box.run]!
    const lang = run.lang ?? p.paragraph.lang
    const text = box.text
    let carriageReturn = false
    let otherControl = false
    let languageFallback = false
    let quote = false
    let punctuation = false
    let dictionary = false
    let tab = false
    let longWhitespace = false
    const { rules } = lineRules(box.locale, p.style.lineBreakMode, p.icuDefaultLocale)
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i)!
      if (cp > 0xffff) i++
      if (cp === 0x0d) carriageReturn = true
      else if ((cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x00) || (cp >= 0x7f && cp <= 0x9f)) otherControl = true
      if (cp === 0x09) tab = true
      if ((cp === 0x20 || cp === 0x09) && i > 0 && (text.charCodeAt(i - 1) === 0x20 || text.charCodeAt(i - 1) === 0x09)) longWhitespace = true
      if (hasLanguageDependentFallback(cp)) languageFallback = true
      if (isDelimiterQuote(cp)) quote = true
      if (cp <= 0xffff && isPunctuation(cp)) punctuation = true
      if (getCategory(rules, cp) >= rules.dictCategoriesStart) dictionary = true
    }
    // Whether an item's second code unit can't start a line, where the 16-bit emergency break extends past the first unit
    // (InlineContentBreaker.cpp:143-157), and how many items the box has.
    let lineStartProhibition = false
    let boxItems = 0
    for (let i = 0; i < p.items.length; i++) {
      const item = p.items[i]!
      if ((item.kind !== 'text' && item.kind !== 'soft-line-break') || item.box !== b) continue
      boxItems++
      if (item.kind === 'text' && !item.isWhitespace && item.end - item.start > 1 && !canBreakBefore(text.charCodeAt(item.start + 1), p.style.lineBreak)) lineStartProhibition = true
    }
    // specs/webkit-text.md §5.3: on the simple font code path the DOM keeps CR's glyph advance, measured as U+0000 (0 in
    // Arial); VT, FF and other Cc take .notdef, measured as U+0001, which another font can supply.
    if (carriageReturn && box.simpleFontCodePath) gaps.push({ gap: 'control-character-width', run: box.run, detail: "CR keeps its glyph advance on the simple path; measured as U+0000, 0 in Arial" })
    if (otherControl) gaps.push({ gap: 'control-character-width', run: box.run, detail: 'VT, FF and other Cc take .notdef, measured as U+0001; the .notdef can come from another font' })
    if (box.letterSpacing !== 0) gaps.push({ gap: 'letter-spacing-ligatures', run: box.run, detail: 'the DOM turns off liga, clig, dlig and hlig under letter-spacing; OffscreenCanvas keeps them' })
    const families = familyNames(run.font.family)
    // OffscreenCanvas has a null locale (specs/webkit-canvas.md §1.3). The DOM passes the box's locale where fonts are
    // chosen: -webkit-standard per script (FontGenericFamilies.cpp:50-66; SettingsBaseCocoa.mm:44-50 sets it for Han, kana
    // and Hangul, the other generic families have only a Common entry on macOS), system-ui and the ui-* designs
    // (FontCacheCoreText.cpp:585-598, SystemFontDatabaseCoreText.cpp:236), and system fallback (FontCacheCoreText.cpp:822),
    // whose cascades differ by language for Han, kana and Hangul (DESIGN.md §1.3).
    const standardPerScript = families.includes('-webkit-standard') && ['HAN', 'SIMPLIFIED_HAN', 'TRADITIONAL_HAN', 'KATAKANA_OR_HIRAGANA', 'HANGUL'].includes(localeScript(box.locale))
    let systemDesign = false
    for (let i = 0; i < families.length; i++) if (SYSTEM_DESIGN_FAMILIES.includes(families[i]!)) systemDesign = true
    if (box.locale !== '' && (standardPerScript || systemDesign || languageFallback)) {
      gaps.push({ gap: 'canvas-language', run: box.run, detail: `locale ${box.locale} chooses ${languageFallback ? 'the fallback font for Han, kana or Hangul' : 'the system or standard font'}; OffscreenCanvas has no locale` })
    }
    if (box.monospaceUnknown && box.simplifiedMeasuring && fixedPitchDecidesWidths(p, m, b)) {
      gaps.push({ gap: 'fixed-pitch-path', run: box.run, detail: `whether ${box.primaryFamily} has the monospace trait isn't given, and the width shortcut of a fixed-pitch font would give other item widths (test T1)` })
    }
    // The text box's simplified path sums shaped advances in one float32 loop (FontCascade::widthForSimpleTextSlow,
    // FontCascade.cpp:381-412); Canvas runs WidthIterator. No probe has settled whether the order changes a sum
    // (probes-safari correction 5), so every simplified-path box outside the width shortcut reports it (DESIGN.md §1.3).
    if (box.simplifiedMeasuring && !box.fixedPitchFastMeasuring) {
      gaps.push({ gap: 'simplified-measuring', run: box.run, detail: 'the DOM sums glyph advances in another float32 order on the simplified path' })
    }
    // FontCascade::tabWidth counts stops from the primary font's spaceWidth() (FontCascadeInlines.h:76-94), taken here from
    // Canvas W(' '), and letter spacing after a TAB follows WidthIterator; neither is probed (webkit audit E3).
    if (tab && tabsAllowed(p.style)) gaps.push({ gap: 'tab-stops', run: box.run, detail: "tab stops count from Canvas W(' ') for the primary font's spaceWidth()" })
    if (dictionary && env.dictionaryBreaks.kind === 'unavailable') gaps.push({ gap: 'dictionary-breaks-unavailable', run: box.run, detail: 'Thai, Lao, Khmer or Myanmar text gets no dictionary boundaries' })
    if (dictionary && env.dictionaryBreaks.kind === 'intl-segmenter-word' && dictionaryRangeStartsWithMark(rules, box.text)) {
      gaps.push({ gap: 'dictionary-breaks-stand-in', run: box.run, detail: 'a dictionary range starts with a combining mark, where the line engine resynchronizes from its dictionary and the word segmenter breaks after the mark' })
    }
    if (env.preferredLanguages === null && lang !== '' && isHanLocale(lang)) {
      gaps.push({ gap: 'ui-language', run: box.run, detail: `the Han locale ${lang} becomes the first preferred language starting with zh-, and the preferred languages aren't given; laid out as zh-hans` })
    }
    if (env.icuDefaultLocale === null && quote && box.locale !== '' && !hasDelimiterData(box.locale)) {
      gaps.push({ gap: 'ui-language', run: box.run, detail: `ICU has no delimiter data for ${box.locale}, so the quote overrides follow the WebContent process's default locale, which isn't given; laid out as en_US_POSIX` })
    }
    // Storage decides keep-all punctuation breaks (BreakablePositions.h:292-299) and what an emergency break keeps at a
    // line start: one code unit in 8-bit text, the first character and every following one that can't start a line in
    // 16-bit text (InlineContentBreaker.cpp:139-158). The port treats Latin-1 text as 8-bit (specs/webkit-gaps.md §7.5).
    if (box.is8Bit && ((p.style.wordBreak === 'keep-all' && punctuation) || (p.style.wrap && lineStartProhibition))) {
      gaps.push({ gap: 'string-storage', run: box.run, detail: 'keep-all punctuation breaks and emergency line-start breaks differ for 16-bit storage; Latin-1 text assumed 8-bit' })
    }
    // TextBreakingPositionCache (InlineItemsBuilder.cpp:1082-1148, 858-900): a box with at least 3 items and 5 units stores
    // its item ends under (content, TextBreakingPositionContext, origin), and a later box with the same key builds its
    // items from them. preserve and break-spaces share a context (TextBreakingPositionContext.h:48-58) and word spacing
    // isn't in it, while both change where preserved white space splits into items (IIB:54-73, 1001-1016).
    if (boxItems >= 3 && text.length >= 5 && preservesSpacesAndTabs(p.style) && longWhitespace) {
      gaps.push({ gap: 'page-history', run: box.run, detail: 'a box of the same text laid out earlier under break-spaces or pre-wrap, or with other word spacing, leaves its white-space items in the break position cache' })
    }
    if (!box.simpleFontCodePath && box.hasStrongDirectionality) complexRtlBoxes++
  }
  if (p.builder === 'line-builder' && complexRtlBoxes > 1) {
    gaps.push({ gap: 'rtl-shaping-across-inline-boxes', run: null, detail: 'LineBuilder shapes complex RTL text joined across inline boxes as one run' })
  }
}

export function prepareWebKit(paragraph: Paragraph, env: WebKitEnvironment, m: Measurer): WebKitPrepared {
  const style = webkitStyle(paragraph)
  const bidi = bidiDataFor('webkit')
  const p: WebKitPrepared = {
    paragraph, env, zoom: env.pageZoom ?? 1, icuDefaultLocale: env.icuDefaultLocale ?? ICU_DEFAULT_LOCALE_WITHOUT_ENVIRONMENT, style,
    builder: 'line-builder', boxes: [], runStarts: [], items: [], gaps: [],
  }
  // m_contentRequiresVisualReordering (IIB:231-240): a 16-bit box with strong RTL content, or an RTL inline box.
  let reordering = false
  for (let r = 0; r < paragraph.runs.length; r++) reordering ||= paragraph.runs[r]!.node === 'span' && style.rtl
  let previous: 'none' | 'text' | 'inline' = 'none'
  let offset = 0
  let inlineBoxes = 0
  const boxRuns: number[] = []
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    p.runStarts.push(offset)
    if (textRendererIsNeeded(run, previous, style)) {
      const box = makeBox(p, m, r, offset, bidi)
      reordering ||= box.hasStrongDirectionality
      p.boxes.push(box)
      boxRuns.push(r)
      if (run.node === 'text') previous = 'text'
    }
    if (run.node === 'span') previous = 'inline'
    offset += run.text.length
  }
  p.runStarts.push(offset)
  let boxIndex = 0
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    if (run.node === 'span') {
      p.items.push({ kind: 'inline-box-start', run: r, level: DEFAULT_BIDI_LEVEL })
      inlineBoxes++
    }
    if (boxIndex < boxRuns.length && boxRuns[boxIndex] === r) handleTextContent(p, m, boxIndex++, reordering)
    if (run.node === 'span') p.items.push({ kind: 'inline-box-end', run: r, level: DEFAULT_BIDI_LEVEL })
  }
  if (style.rtl || reordering) computeBidiLevels(p)
  if (reordering) computeItemWidths(p, m)
  // isEligibleForSimplifiedInlineLayoutByStyle (TextOnlySimpleLineBuilder.cpp:499-528): word-spacing 0 and LTR; the
  // model's other properties sit at eligible initial values.
  const styleEligible = f32(paragraph.wordSpacing) === 0 && !style.rtl
  const items = p.items
  if (items.length > 0 && inlineBoxes === 0 && !reordering && styleEligible) {
    p.builder = 'text-only-simple'
  } else if (inlineBoxes === 1 && items.length > 2 && items[0]!.kind === 'inline-box-start' && items[items.length - 1]!.kind === 'inline-box-end' && !reordering && styleEligible && f32(paragraph.runs[(items[0] as { run: number }).run]!.wordSpacing) === 0) {
    // RangeBasedLineBuilder::isEligibleForRangeInlineLayout (RangeBasedLineBuilder.cpp:131-184): one span around every item.
    p.builder = 'range-based'
  }
  collectGaps(p, m)
  return p
}
