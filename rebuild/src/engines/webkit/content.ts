// WebKit content building (Safari 27.0): which runs get a text renderer, per-box locale, storage, code path, font facts and
// measuring facts, InlineItemsBuilder::handleTextContent, the bidi paragraph with its item splits, stored widths, the
// builder choice and the paragraph's gaps (specs/webkit-text.md §2-§6, specs/webkit-lines.md §2-§3). Cited at
// WebKit-7625.1.29.11.27 under Source/WebCore/: IIB = layout/formattingContexts/inline/InlineItemsBuilder.cpp.
import type { WebKitEnvironment } from '../../env.js'
import { measureContext, measureText, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import { genericFamilyUnder, standardFamilyOf } from './fonts.js'
import { indexContent, langUnder, styleUnder } from '../../content.js'
import type { Paragraph, TextStyle } from '../../model.js'
import { AL, FSI, L, LRE, LRI, LRO, ON, PDF, PDI, R, RLE, RLI, RLO, bidiClassOf, bidiDataFor, type BidiData } from '../../unicode/bidi.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import { dictionaryRangesStartingWithMark, makeFactory, moveToNextBreakablePosition } from './breaks.js'
import { computedLocale, hasDelimiterData, isDelimiterQuote, isHanLocale, lineRules, localeScript } from './data.js'
import { boxWidth, itemWidth, singleSpaceWidth } from './measure.js'
import { boxEdges, layoutUnit, preservesNewline, preservesSpacesAndTabs, webkitStyle } from './style.js'
import type { WebKitBox, WebKitHistoryWorld, WebKitItem, WebKitPrepared, WebKitStyle, WebKitTextItem } from './types.js'

const f32 = Math.fround

// TextBreakingPositionCache::minimumRequiredTextLengthForContentBreakCache and minimumRequiredContentBreaks
// (TextBreakingPositionCache.h:41-42).
const TEXT_BREAKING_POSITION_CACHE_MINIMUM_LENGTH = 5
const TEXT_BREAKING_POSITION_CACHE_MINIMUM_BREAKS = 3

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

// RenderTreeUpdater::textRendererIsNeeded (RenderTreeUpdater.cpp:536-595) over the model's tree, which has only blocks, inline
// spans, atomic inline-blocks, <br> and <wbr>. `previous` is the rendering parent's previous child renderer, and whether it
// exists is hasPrecedingInFlowChild. A block's first child renderer finds childrenInline() true, so the "first inline content"
// test (:575-591) never answers yes, and the node gets a renderer exactly when an earlier in-flow child renderer exists.
type PreviousRenderer = 'none' | 'text' | 'inline' | 'br'

function textRendererIsNeeded(text: string, previous: PreviousRenderer, parentStyle: WebKitStyle, parentIsInline: boolean): boolean {
  if (text.length === 0) return false
  if (!containsOnlyASCIIWhitespace(text)) return true
  if (previous === 'text') return true
  // pre, pre-wrap and pre-line always make renderers (:557-558).
  if (preservesNewline(parentStyle)) return true
  // <span><br/> <br/></span> (:560-562).
  if (previous === 'br') return false
  // A RenderInline parent keeps the node unless the previous renderer is a block (:564-570).
  if (parentIsInline) return true
  return previous !== 'none'
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

// A font-family list as names, each marked quoted or not: a quoted keyword names a family of that name, not the generic family
// (CSS Fonts 4 §4.2, research/CHARTER-CRITIC.md item 9).
type FamilyName = { name: string; quoted: boolean }

function familyNames(family: string): FamilyName[] {
  const out: FamilyName[] = []
  const parts = family.split(',')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim()
    const quoted = /^["'].*["']$/.test(part)
    out.push({ name: part.replace(/^["']|["']$/g, '').toLowerCase(), quoted })
  }
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

// The facts of one text leaf's box: its computed style, font, spacing and language as the tree gives them.
type LeafInput = { run: number; parent: number; text: string; textStyle: TextStyle; style: WebKitStyle; lang: string }

function makeBox(p: WebKitPrepared, m: Measurer, leaf: LeafInput, sourceStart: number, bidi: BidiData): WebKitBox {
  const facts = leaf.textStyle.font.facts
  const locale = computedLocale(leaf.lang, p.env.preferredLanguages)
  // The list Canvas measures with (fonts.ts): each unquoted generic keyword the locale resolves to a family of its own is
  // named. Only unquoted names are keywords.
  const listed = familyNames(leaf.textStyle.font.family)
  const canvasFamilies = leaf.textStyle.font.family.split(',').map(part => part.trim())
  let firstNamedGeneric = -1
  for (let i = 0; i < listed.length; i++) {
    const named = listed[i]!.quoted || locale === '' ? null : genericFamilyUnder(listed[i]!.name, locale, localeScript(locale), p.env.preferredLanguages)
    if (named === null) continue
    canvasFamilies[i] = JSON.stringify(named)
    if (firstNamedGeneric < 0) firstNamedGeneric = i
  }
  let font = { ...leaf.textStyle.font, family: canvasFamilies.join(', ') }
  const zoom = f32(p.zoom)
  const size = f32(f32(font.size) * zoom)
  const letterSpacing = f32(f32(leaf.textStyle.letterSpacing) * zoom)
  const wordSpacing = f32(f32(leaf.textStyle.wordSpacing) * zoom)
  const text = leaf.text
  let is8Bit = true
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) { is8Bit = false; break }
  const simpleFontCodePath = !isComplexCodePath(text)
  let simplifiedMeasuring = simpleFontCodePath && letterSpacing === 0 && wordSpacing === 0
  const collapsed = leaf.style.collapse === 'collapse' || leaf.style.collapse === 'preserve-breaks'
  for (let i = 0; simplifiedMeasuring && i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    simplifiedMeasuring = characterCanUseSimplifiedTextMeasuring(cp, collapsed)
  }
  // The index-0 family (FontCascadeFonts.cpp:200-218): the given fact, else the first family listed.
  const primaryFamily = facts.primaryFamily === null ? familyNames(font.family)[0]!.name : facts.primaryFamily.toLowerCase()
  const primaryFamilyCss = facts.primaryFamily === null ? font.family.split(',')[0]!.trim() : cssFamilyName(facts.primaryFamily)
  const fixedPitch = facts.monospace === true
  // No family of the list resolves where the list followed by LastResort measures a space as LastResort alone does. The
  // settings' standard family then draws (FontCascadeFonts::realizeFallbackRangesAt, FontCascadeFonts.cpp:210-217), which the
  // locale's script chooses (fonts.ts standardFamilyOf; probe webkit-round4 R7: `a` in `STHeiti`, which the WebContent process
  // doesn't have, is 7.99px under en and 9.81px under ja at 18px; R11: `cursive` under zh names Kaiti SC, which it doesn't
  // have either): it is named at the end of the list.
  const standardFamily = locale === '' ? null : standardFamilyOf(localeScript(locale), p.env.preferredLanguages)
  if (standardFamily !== null) {
    const plain = { lang: '', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
    const listThenLastResort = measureContext(m, { ...plain, font: canvasFont({ ...font, family: `${font.family}, LastResort` }, size) })
    const lastResort = measureContext(m, { ...plain, font: canvasFont({ ...font, family: 'LastResort' }, size) })
    if (measureText(m, listThenLastResort, ' ') === measureText(m, lastResort, ' ')) {
      if (firstNamedGeneric < 0) firstNamedGeneric = listed.length
      font = { ...font, family: `${font.family}, ${JSON.stringify(standardFamily)}` }
    }
  }
  const settings = { font: canvasFont(font, size), lang: '', letterSpacing: `${letterSpacing}px`, wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
  const context = measureContext(m, settings)
  const plainContext = measureContext(m, { ...settings, letterSpacing: '0px' })
  const spacedContext = wordSpacing === 0 ? context : measureContext(m, { ...settings, wordSpacing: `${wordSpacing}px` })
  const countContext = letterSpacing === 0 ? plainContext : measureContext(m, { ...settings, letterSpacing: '64px' })
  // Simplified measuring also needs a glyph from the primary font for every character
  // (FontCascade::canUseSimplifiedTextMeasuring, FontCascade.cpp:486-510). Fallback follows the family list before
  // system fallback (FontCascadeFonts.cpp:426-439, specs/webkit-gaps.md §3.3), so a family after the primary one that
  // draws a glyph no other font would shows coverage: if the primary family maps the code point, "P, LastResort" draws
  // the paragraph's glyph; otherwise LastResort's box, 17.6015625px at 16px in webkit-host (rebuild/probes/webkit-followups.ts
  // B5: Courier maps Ω, Menlo doesn't map U+3000). Only fixed-pitch boxes read the result, in the width and breakWord
  // shortcuts; the 17.6015625px advance matching a fallback glyph's is the recipe's loss.
  // The recipe can't vouch for a code point that measures as wide as LastResort's own box: a fallback glyph of that advance
  // looks covered (research/CHARTER-CRITIC.md item 1). Lines measuring such a code point report font-fallback.
  const unverifiedCoverage: number[] = []
  if (simplifiedMeasuring && fixedPitch) {
    const coverageContext = measureContext(m, { ...settings, font: canvasFont({ ...font, family: `${primaryFamilyCss}, LastResort` }, size), letterSpacing: '0px' })
    const lastResortContext = measureContext(m, { ...settings, font: canvasFont({ ...font, family: 'LastResort' }, size), letterSpacing: '0px' })
    for (let i = 0; simplifiedMeasuring && i < text.length; i++) {
      const cp = text.codePointAt(i)!
      if (cp > 0xffff) i++
      if (cp < 0x20) continue
      const s = String.fromCodePoint(cp)
      const covered = measureText(m, coverageContext, s)
      simplifiedMeasuring = covered === measureText(m, plainContext, s)
      if (simplifiedMeasuring && covered === measureText(m, lastResortContext, s) && !unverifiedCoverage.includes(cp)) unverifiedCoverage.push(cp)
    }
  }
  let spacingFacts: Array<{ coverage: readonly number[]; inputs: readonly number[] }> | null = null
  if (letterSpacing !== 0 && facts.fonts !== undefined && facts.fonts.length === familyNames(font.family).length) {
    spacingFacts = []
    for (let i = 0; i < facts.fonts.length && spacingFacts !== null; i++) {
      const listed = facts.fonts[i]!
      if (listed.realizes === false) continue
      if (listed.realizes === null || listed.coverage === null || listed.spacingInputs === undefined || listed.spacingInputs === null) spacingFacts = null
      else spacingFacts.push({ coverage: listed.coverage, inputs: listed.spacingInputs })
    }
  }
  return {
    run: leaf.run, parent: leaf.parent, style: leaf.style, sourceStart, text, is8Bit, simpleFontCodePath, simplifiedMeasuring, fixedPitch,
    fixedPitchFastMeasuring: fixedPitch && primaryFamily !== 'courier new',
    monospaceUnknown: facts.monospace === null,
    primaryFamily,
    hyphen: facts.mapsHyphen === false ? '-' : '‐',
    hyphenUnknown: facts.mapsHyphen === null,
    locale, canvasFamily: font.family, firstNamedGeneric,
    context, plainContext, spacedContext, countContext, letterSpacing, wordSpacing, cssLetterSpacing: leaf.textStyle.letterSpacing,
    hasStrongDirectionality: hasStrongDirectionality(text, is8Bit, bidi), unverifiedCoverage,
    primaryFamilyUnknown: facts.primaryFamily === null,
    pairKerningUnknown: facts.pairKerning === null,
    spacingFacts,
    localeChoosesFonts: null, namedContext: plainContext, listContext: plainContext, lastResortContext: plainContext, hanLocaleUnknown: false, quoteLocaleUnknown: false,
    dictionaryRangesStartingWithMark: [],
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

// InlineItemsBuilder::handleTextContent (IIB:924-1051) with hyphens: manual and -webkit-nbsp-mode: normal, over the text
// box's own style. `defer` is shouldDeferTextMeasurement's content part: the paragraph needs visual reordering
// (IIB:1150-1154).
function handleTextContent(p: WebKitPrepared, m: Measurer, boxIndex: number, defer: boolean): void {
  const box = p.boxes[boxIndex]!
  const style = box.style
  const text = box.text
  const preserveSpaces = preservesSpacesAndTabs(style)
  const preserveNewline = preservesNewline(style)
  const factory = makeFactory(text, box.is8Bit, box.locale, style.lineBreakMode, p.icuDefaultLocale, p.env.dictionaryBreaks)
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
      if (style.collapse === 'break-spaces') {
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
    const end = position + moveToNextBreakablePosition(position, factory, style)
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
// unicode-bidi: the paragraph text, ubidi_setPara, the item splits at logical run ends, and the opaque levels. Inline box
// starts and ends and word break opportunities have no position in the paragraph (:599-618); an atomic inline is U+FFFC
// (:596-598); a hard line break starts a paragraph with LF (handleBidiParagraphStart, :535-548, :568).
function computeBidiLevels(p: WebKitPrepared): void {
  const items = p.items
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
      case 'soft-line-break': {
        const preserveNewline = preservesNewline(p.boxes[item.box]!.style)
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
          paragraph += ' '
        }
        break
      }
      case 'text':
        if (!preservesNewline(p.boxes[item.box]!.style)) {
          appendBoxContentOnce(item.box)
          offsets.push(boxOffset + item.start)
        } else {
          offsets.push(paragraph.length)
          paragraph += p.boxes[item.box]!.text.slice(item.start, item.end)
        }
        break
      case 'hard-line-break':
        offsets.push(paragraph.length)
        paragraph += '\n'
        lastBox = -1
        break
      case 'atomic':
        offsets.push(paragraph.length)
        paragraph += '￼'
        lastBox = -1
        break
      case 'inline-box-start':
      case 'inline-box-end':
      case 'word-break-opportunity':
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
      case 'word-break-opportunity':
        item.level = OPAQUE_BIDI_LEVEL
        break
      case 'text':
        if (!item.isWhitespace || preservesSpacesAndTabs(p.boxes[item.box]!.style)) hasContent.fill(true)
        break
      case 'soft-line-break':
      case 'hard-line-break':
      case 'atomic':
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
    if (item.isWhitespace && preservesSpacesAndTabs(box.style) && box.text.includes('\t')) continue
    item.width = itemWidth(p, m, item, item.start, item.end, 0)
  }
}

// Whether a family of a font list draws the code point: in Canvas the list followed by LastResort (`context`) doesn't give
// LastResort's box (the recipe of makeBox's coverage test; a glyph as wide as LastResort's box can't be told from it and
// counts as not drawn). A list draws a character with its first family that has a glyph, so what the families before some
// point of the box's list draw there they draw in the whole list.
export function familyDraws(m: Measurer, box: WebKitBox, context: number, cp: number): boolean {
  // FontCascade::treatAsZeroWidthSpace (FontCascadeInlines.h:160-176): drawn as a zero-width space whatever font has it,
  // so no font choice shows in a width. Controls below U+0020 and U+007F-U+009F never reach here.
  if (cp === 0xad || cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e) || cp === 0xfeff || cp === 0xfffc) return true
  const s = String.fromCodePoint(cp)
  return measureText(m, context, s) !== measureText(m, box.lastResortContext, s)
}

// Whether system fallback for the code point can change a width under the locale. lookupFallbackFont hands Core Text the
// computed locale for every character no family of the list draws (FontCacheCoreText.cpp:775-790, :822), and Core Text is
// closed, so which characters a language moves is a table of probe verdicts, a registered heuristic (CHARTER known
// deviations): as the source reads, every such character under any locale, the condition fires on 29% of passing development
// lines at a lift of 0.8.
// - Under a Han, kana or Hangul script: Hangul, CJK symbols and punctuation, kana, Bopomofo, Han and fullwidth forms, by
//   block (specs/webkit-canvas.md §1.3, probes-safari cross-cutting 4; probe webkit-round3 R3: under ko 36 of 117 strings
//   equal Canvas), and enclosed alphanumerics, box drawing, geometric shapes and vertical forms (probe webkit-round4 R14
//   under ko). The font follows the original font's class too: Han under ko is AppleMyungjo after Times and Georgia and Apple
//   SD Gothic Neo after Helvetica, Arial and Menlo (R12).
// - Under Urdu and Kashmiri: the Arabic blocks, which fall back to Noto Nastaliq Urdu where Canvas has Geeza Pro (R13, R14).
// R14 (70 languages, three sample characters of each of 321 blocks after Helvetica, Times and Geeza Pro) found no other pair;
// it sees a font change only where advances differ, and three samples don't stand for a block.
export function hasLanguageDependentFallback(cp: number, locale: string, script: string): boolean {
  if (['HAN', 'SIMPLIFIED_HAN', 'TRADITIONAL_HAN', 'KATAKANA_OR_HIRAGANA', 'HANGUL'].includes(script)) {
    return (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2460 && cp <= 0x257f) || (cp >= 0x25a0 && cp <= 0x25ff) || (cp >= 0x2e80 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff)
      || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe1f) || (cp >= 0xfe30 && cp <= 0xfe4f)
      || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x1aff0 && cp <= 0x1b16f) || (cp >= 0x1f200 && cp <= 0x1f2ff) || (cp >= 0x20000 && cp <= 0x3ffff)
  }
  const language = locale.toLowerCase().split(/[-_]/)[0]
  if (language === 'ur' || language === 'ks') return (cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) || (cp >= 0x8a0 && cp <= 0x8ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)
  return false
}

// The paragraph's gaps are conditions of the environment alone (DESIGN.md §2.8, §5): page zoom not given. Every condition of
// the content and fonts concerns the characters some line measures, so lines.ts reports it on the lines whose filling
// measured them (lineGaps), from the facts each box records here.
function collectBoxFacts(p: WebKitPrepared, m: Measurer, leaves: LeafInput[]): void {
  const env = p.env
  if (env.pageZoom === null) {
    p.gaps.push({ gap: 'page-zoom', run: null, detail: "the page zoom isn't given; laid out at 1" })
  }
  for (let b = 0; b < p.boxes.length; b++) {
    const box = p.boxes[b]!
    const leaf = leaves[box.run]!
    const text = box.text
    const script = localeScript(box.locale)
    let languageFallback = false
    let quote = false
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i)!
      if (cp > 0xffff) i++
      if (hasLanguageDependentFallback(cp, box.locale, script)) languageFallback = true
      if (isDelimiterQuote(cp)) quote = true
    }
    // rule webkit/gap/canvas-language-scope
    // OffscreenCanvas has a null locale (specs/webkit-canvas.md §1.3), so its font description's script is Common. The DOM
    // passes the box's locale where fonts are chosen:
    // - serif, sans-serif, cursive, fantasy, monospace and -webkit-standard: the family the locale resolves them to is named
    //   in the list Canvas gets (makeBox, fonts.ts), which leaves characters with default emoji presentation: the DOM skips
    //   a generic family's outline glyph for them, and Canvas doesn't know the named family for a generic one;
    // - -webkit-standard under USCRIPT_HAN where the preferred languages that choose it aren't given
    //   (FontGenericFamilies.cpp:56-60);
    // - system-ui and the ui-* designs (FontCacheCoreText.cpp:585-598, SystemFontDatabaseCoreText.cpp:236);
    // - system fallback after the list (FontCacheCoreText.cpp:822), for the characters hasLanguageDependentFallback lists.
    // Nothing else reads it: a family named by a string is looked up by name (fontWithFamily, FontCacheCoreText.cpp:624-643;
    // only fontDescriptorWithFamilySpecialCase's system names take the locale), its glyphs are CTFontGetGlyphsForCharacters
    // of that font (GlyphPageCoreText.cpp:51-73), and a list draws a character with its first family that has a glyph
    // (FontCascadeFonts::glyphDataForVariant, FontCascadeFonts.cpp:426-470). So a character a named family draws before the
    // list reaches a family of the kinds above doesn't depend on the locale, under any locale (probe webkit-round4 R7: 663
    // characters of 33 named families that Canvas says a named family draws measure the same in the DOM under no language,
    // en, ja, ko, zh-Hans, zh-Hant and zh-HK as in Canvas, 4,641 of 4,641; of the 855 no named family draws, 468 differ under
    // ko, 51 under ja, 48 under each zh, none under en or none; R12: 15 named families measure 18 strings the same under 10
    // languages apart from such characters). Round 3 read `"PingFang SC"` drawing kana at Apple SD Gothic Neo's advance under
    // ko as a named family that doesn't settle its own characters. It has no kana glyph here: the WebContent process resolves
    // the name to the system's reserved PingFangUI.ttc, which holds Han and no kana or U+2027, and the kana comes from system
    // fallback (R7; an unsandboxed process finds the downloaded PingFang.ttc asset, which the lab's coverage facts read, so
    // Canvas decides what a named family draws).
    const families = familyNames(box.canvasFamily)
    const cjkLocale = ['HAN', 'SIMPLIFIED_HAN', 'TRADITIONAL_HAN', 'KATAKANA_OR_HIRAGANA', 'HANGUL'].includes(script)
    let firstUnknownFamily = families.length
    for (let i = 0; i < families.length && firstUnknownFamily === families.length; i++) {
      const family = families[i]!
      if (!family.quoted && ((family.name === '-webkit-standard' && cjkLocale) || SYSTEM_DESIGN_FAMILIES.includes(family.name))) firstUnknownFamily = i
    }
    const namedGeneric = box.firstNamedGeneric >= 0
    if (box.locale !== '' && (firstUnknownFamily < families.length || namedGeneric || languageFallback)) {
      box.localeChoosesFonts = { unknownFamily: firstUnknownFamily < families.length, namedGeneric, fallback: languageFallback }
      const font = leaf.textStyle.font
      const size = f32(f32(font.size) * f32(p.zoom))
      const parts = box.canvasFamily.split(',').map(part => part.trim())
      const named = parts.slice(0, Math.min(firstUnknownFamily, namedGeneric ? box.firstNamedGeneric : families.length))
      const settings = { lang: '', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
      box.lastResortContext = measureContext(m, { ...settings, font: canvasFont({ ...font, family: 'LastResort' }, size) })
      box.namedContext = named.length === 0 ? box.lastResortContext : measureContext(m, { ...settings, font: canvasFont({ ...font, family: named.concat(['LastResort']).join(', ') }, size) })
      box.listContext = measureContext(m, { ...settings, font: canvasFont({ ...font, family: parts.concat(['LastResort']).join(', ') }, size) })
    }
    box.hanLocaleUnknown = env.preferredLanguages === null && leaf.lang !== '' && isHanLocale(leaf.lang)
    box.quoteLocaleUnknown = env.icuDefaultLocale === null && quote && box.locale !== '' && !hasDelimiterData(box.locale)
    if (env.dictionaryBreaks.kind === 'intl-segmenter-word') {
      box.dictionaryRangesStartingWithMark = dictionaryRangesStartingWithMark(lineRules(box.locale, box.style.lineBreakMode, p.icuDefaultLocale).rules, text)
    }
  }
}

// ---- Page history: the break position cache ----
// rule webkit/gap/page-history-worlds

// TextBreakingPositionCache (InlineItemsBuilder.cpp:858-924, 936-939, 1082-1148; TextBreakingPositionCache.h:41-42): when a
// block's line layout goes away (LineLayout::~LineLayout, LayoutIntegrationLineLayout.cpp:210-220), a box of at least 5 units
// whose item list has at least 3 items stores its items' ends, taken after the bidi splits, under (content,
// TextBreakingPositionContext, origin), unless the key is there already. A later box with the same key builds its items from
// those ends instead of the break iterator (buildInlineItemListForTextFromBreakingPositionsCache, IIB:858-924), and then takes
// its own bidi splits. The cache belongs to the process and is evicted at random past 500,000 units
// (TextBreakingPositionCache.cpp:36-60). The context holds white-space collapse (pre, pre-wrap and break-spaces share a value),
// overflow-wrap, line-break, word-break, nbsp mode and locale (TextBreakingPositionContext.h:30-80), so the cached ends are this
// box's break iterator ends plus what the key leaves out:
// - the other box's bidi splits, at the level boundaries its paragraph direction and neighbouring content give the same text;
// - its preserved white space: whole under pre and pre-wrap, per unit under break-spaces (IIB:972-979), split before a TAB
//   that follows a word separator under word spacing (IIB:964, moveToNextNonWhitespacePosition :54-73);
// - a white-space item built from the cache is a word separator unless its first character is a preserved TAB (IIB:893),
//   where the break iterator path asks whether the run holds any separator (IIB:66-72).
// What the library lays out is the paragraph in a process that never saw the box's key. Each other item list the cache can
// hand a box is a history world (WebKitHistoryWorld): the paragraph's items with that box built from the list. lines.ts lays
// every line out in each world that changes an item the line read, from the same line start, and reports page-history where
// the world's line differs: the effect of the cache on that line, computed instead of guessed.
// Declared approximations: one box differs per world (boxes find their keys independently, so the true set is the product);
// the other box's neighbours are the contexts below, not every text.

// Context around the box for the bidi rules that read across its edges: nothing (sos, eos and L1 at the paragraph end), a
// strong L, R or AL, a European number alone, after L, after R or after AL (W2 makes it an Arabic number), and an Arabic
// number. With paragraph level parity these stand for every resolved class W1-W7, N0-N2 and L1 read across an edge (UAX #9;
// ICU 78.2 ubidi.cpp). Embeddings and isolates open around the box shift levels by parity, which the two directions cover;
// a box whose own PDI or PDF closes one opened before it, or whose initiator is closed after it, also takes the contexts
// that open or close one.
const HISTORY_BEFORE = ['', 'a', 'א', 'ا', '1', 'a1', 'א1', 'ا1', '١']
const HISTORY_AFTER = ['', 'a', 'א', '1', '١']
const HISTORY_BEFORE_OPENING = ['\u2066', '\u2067', '\u202a', '\u202b', '\u202d', '\u202e']
const HISTORY_AFTER_CLOSING = ['\u2069', '\u2069a', '\u2069א', '\u202c', '\u202ca', '\u202cא']
// ubidi_setPara gives a text without RTL characters, or with nothing else, the paragraph level everywhere
// (directionFromFlags, ICU 78.2 ubidi.cpp:1007-1018, :2684-2693), whatever embeddings and isolates it holds. The flags are the
// whole text's, so other content of another box's paragraph makes it mixed (held-out c-7cc5e3e26ff7c30d: `a` SHY LRI `b` PDI
// `c` takes level 2 on `b` once its paragraph holds an RTL character). A paragraph of its own before the context, ended by a
// class-B character, sets those flags and nothing else: B resets the explicit stack and sos.
const HISTORY_MIXED_PARAGRAPH = 'aא\n'

// The level boundaries of text[from, to) under a direction, as offsets less `shift`.
function levelBoundaries(text: string, direction: 'ltr' | 'rtl', bidi: BidiData, from: number, to: number, shift: number): number[] {
  const levels = resolveIcuBidi(HISTORY_MIXED_PARAGRAPH + text, direction, bidi).levels
  const offset = HISTORY_MIXED_PARAGRAPH.length
  const out: number[] = []
  for (let i = from + 1; i < to; i++) if (levels[offset + i] !== levels[offset + i - 1]) out.push(i - shift)
  return out
}

// The sets of level boundaries other paragraphs give the box's text, each as sorted box offsets: per direction, every context
// before the box with every context after it.
function historyBoundarySets(box: WebKitBox, bidi: BidiData): number[][] {
  const text = box.text
  // The text as the bidi paragraph holds it (computeBidiLevels): white space that doesn't preserve newlines as spaces, and
  // under preserved newlines U+2028 as a space and LF and U+2029 as paragraph separators.
  let analysis = ''
  if (preservesNewline(box.style)) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      analysis += c === 0x2028 ? ' ' : c === 0x2029 ? '\n' : text[i]!
    }
  } else {
    analysis = bidiBoxContent(box)
  }
  const length = analysis.length
  let firstStrong = -1
  let lastStrong = -1
  let closesOuter = false
  let opensInner = false
  // Bracket pairs resolve by the strong context before their opening bracket (N0): one that opens before the first strong
  // character takes the context before the box wherever it closes, and one that closes after the last strong character needs
  // its opening bracket to resolve at all. An explicit code's level reaches to its end. Such a box is resolved whole.
  const brackets: number[] = []
  for (let i = 0; i < length; i++) {
    const cp = analysis.codePointAt(i)!
    const c = bidiClassOf(bidi, cp)
    if (c === L || c === R || c === AL) {
      if (firstStrong < 0) firstStrong = i
      lastStrong = i
    }
    if (c === PDF || c === PDI) closesOuter = true
    if (c === LRE || c === RLE || c === LRO || c === RLO || c === LRI || c === RLI || c === FSI) opensInner = true
    if (c === ON) for (let k = 0; k < bidi.brackets.length; k += 3) if (bidi.brackets[k] === cp || bidi.brackets[k + 1] === cp) brackets.push(i)
    if (cp > 0xffff) i++
  }
  const explicit = closesOuter || opensInner
  let wholeBefore = explicit
  let wholeAfter = explicit
  for (let k = 0; k < brackets.length; k++) {
    if (brackets[k]! < firstStrong) wholeBefore = true
    if (brackets[k]! > lastStrong) wholeAfter = true
  }
  const before = closesOuter ? HISTORY_BEFORE.concat(HISTORY_BEFORE_OPENING) : HISTORY_BEFORE
  const after = opensInner ? HISTORY_AFTER.concat(HISTORY_AFTER_CLOSING) : HISTORY_AFTER
  const sets: number[][] = []
  const directions = ['ltr', 'rtl'] as const
  for (let d = 0; d < directions.length; d++) {
    const direction = directions[d]!
    if (firstStrong < 0 || (wholeBefore && wholeAfter)) {
      // No strong character, or a box resolved whole at both edges: every context pair over the whole text.
      for (let k = 0; k < before.length; k++) for (let j = 0; j < after.length; j++) {
        sets.push(levelBoundaries(before[k]! + analysis + after[j]!, direction, bidi, before[k]!.length, before[k]!.length + length, before[k]!.length))
      }
      continue
    }
    // Before the first strong character the rules read the context before the box; after the last one, the context after it.
    // Between them every rule finds its strong neighbours inside the box.
    const interior = levelBoundaries(analysis, direction, bidi, 0, length, 0)
    const leading: number[][] = []
    if (firstStrong === 0) leading.push(interior.filter(position => position <= lastStrong))
    else for (let k = 0; k < before.length; k++) {
      const context = before[k]!
      const found = wholeBefore
        ? levelBoundaries(context + analysis, direction, bidi, context.length, context.length + length, context.length).filter(position => position <= lastStrong)
        : levelBoundaries(context + analysis.slice(0, firstStrong + 1), direction, bidi, context.length, context.length + firstStrong + 1, context.length).concat(interior.filter(position => position > firstStrong && position <= lastStrong))
      leading.push(found)
    }
    const trailing: number[][] = []
    if (lastStrong === length - 1) trailing.push([])
    else for (let j = 0; j < after.length; j++) {
      const context = after[j]!
      const found = wholeAfter
        ? levelBoundaries(analysis + context, direction, bidi, 0, length, 0).filter(position => position > lastStrong)
        : levelBoundaries(analysis.slice(lastStrong) + context, direction, bidi, 0, length - lastStrong, -lastStrong)
      trailing.push(found)
    }
    for (let k = 0; k < leading.length; k++) for (let j = 0; j < trailing.length; j++) sets.push(leading[k]!.concat(trailing[j]!))
  }
  return sets
}

type WhitespaceStructure = 'whole' | 'per-unit' | 'separators'

// The ends of a preserved white-space run [start, end) under a structure (handleWhitespace, IIB:963-989).
function whitespaceEnds(text: string, start: number, end: number, structure: WhitespaceStructure, preserveNewline: boolean): number[] {
  const ends: number[] = []
  if (structure === 'per-unit') {
    for (let i = start + 1; i <= end; i++) ends.push(i)
    return ends
  }
  for (let position = start; position < end;) {
    const run = whitespaceRun(text.slice(0, end), position, preserveNewline, true, structure === 'separators')
    if (run === null) break
    position += run.length
    ends.push(position)
  }
  return ends
}

// The paragraph's items with one box built from a cached list: the box's own ends (white space under `structure`) plus
// `extra`, then its own bidi splits, which are the boundaries between its own items of different levels.
function historyWorld(p: WebKitPrepared, m: Measurer, boxIndex: number, extra: readonly number[], structure: WhitespaceStructure | null): WebKitHistoryWorld | null {
  const box = p.boxes[boxIndex]!
  const text = box.text
  const preserve = preservesSpacesAndTabs(box.style)
  const items: WebKitItem[] = []
  const itemIndex: number[] = []
  const changed: boolean[] = []
  let differs = false
  let boxItems = 0
  const width = (item: WebKitTextItem, from: number, to: number): number | null => {
    if (item.width === null) return null
    return itemWidth(p, m, { ...item, start: from, end: to }, from, to, 0)
  }
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    itemIndex.push(items.length)
    changed.push(false)
    if (item.kind !== 'text' || item.box !== boxIndex) {
      if (item.kind === 'soft-line-break' && item.box === boxIndex) boxItems++
      items.push(item)
      continue
    }
    if (item.isWhitespace && preserve && structure !== null) {
      // The run of this box's adjacent white-space items of one level: the cached structure, then the own bidi splits.
      let last = i
      while (last + 1 < p.items.length) {
        const following = p.items[last + 1]!
        if (following.kind !== 'text' || following.box !== boxIndex || !following.isWhitespace || following.level !== item.level || following.start !== (p.items[last] as WebKitTextItem).end) break
        last++
      }
      const runEnd = (p.items[last] as WebKitTextItem).end
      const ends = whitespaceEnds(text, item.start, runEnd, structure, preservesNewline(box.style))
      for (let k = 0; k < extra.length; k++) if (extra[k]! > item.start && extra[k]! < runEnd && !ends.includes(extra[k]!)) ends.push(extra[k]!)
      ends.sort((a, b) => a - b)
      const first = items.length
      let from = item.start
      for (let k = 0; k < ends.length; k++) {
        const to = ends[k]!
        const isWordSeparator = text.charCodeAt(from) !== 0x09
        items.push({ ...item, start: from, end: to, isWordSeparator, width: width(item, from, to) })
        boxItems++
        from = to
      }
      let ownMatches = ends.length === last - i + 1
      for (let own = i, k = first; own <= last; own++) {
        const ownItem = p.items[own] as WebKitTextItem
        while (k + 1 < items.length && (items[k + 1] as WebKitTextItem).start <= ownItem.start) k++
        const worldItem = items[k] as WebKitTextItem
        if (worldItem.start !== ownItem.start || worldItem.end !== ownItem.end || worldItem.isWordSeparator !== ownItem.isWordSeparator) ownMatches = false
        if (own > i) {
          itemIndex.push(k)
          changed.push(false)
        }
      }
      if (!ownMatches) {
        differs = true
        for (let own = i; own <= last; own++) changed[own] = true
      }
      i = last
      continue
    }
    const ends: number[] = []
    for (let k = 0; k < extra.length; k++) if (extra[k]! > item.start && extra[k]! < item.end) ends.push(extra[k]!)
    // A white-space item built from the cache is a word separator unless it starts with a preserved TAB (IIB:893).
    const isWordSeparator = item.isWhitespace ? text.charCodeAt(item.start) !== 0x09 || !preserve : item.isWordSeparator
    if (ends.length === 0 && isWordSeparator === item.isWordSeparator) {
      items.push(item)
      boxItems++
      continue
    }
    differs = true
    changed[i] = true
    ends.push(item.end)
    let from = item.start
    for (let k = 0; k < ends.length; k++) {
      const to = ends[k]!
      // buildInlineItemListForTextFromBreakingPositionsCache reads the soft hyphen at each end (IIB:908).
      items.push({ ...item, start: from, end: to, isWordSeparator, hasTrailingSoftHyphen: item.isWhitespace ? false : text.charCodeAt(to - 1) === 0xad, width: ends.length === 1 ? item.width : width(item, from, to) })
      boxItems++
      from = to
    }
  }
  if (!differs || boxItems < TEXT_BREAKING_POSITION_CACHE_MINIMUM_BREAKS) return null
  return { prepared: { ...p, items, historyWorlds: [] }, box: boxIndex, itemIndex, changed }
}

function collectHistoryWorlds(p: WebKitPrepared, m: Measurer, bidi: BidiData): void {
  for (let b = 0; b < p.boxes.length; b++) {
    const box = p.boxes[b]!
    if (box.text.length < TEXT_BREAKING_POSITION_CACHE_MINIMUM_LENGTH) continue
    const ownEnds = new Set<number>()
    let hasLongWhitespace = false
    let previousWhitespaceEnd = -1
    for (let i = 0; i < p.items.length; i++) {
      const item = p.items[i]!
      if ((item.kind !== 'text' && item.kind !== 'soft-line-break') || item.box !== b) continue
      ownEnds.add(item.kind === 'text' ? item.end : item.start + 1)
      if (item.kind !== 'text' || !item.isWhitespace) continue
      hasLongWhitespace ||= item.end - item.start > 1 || previousWhitespaceEnd === item.start
      previousWhitespaceEnd = item.end
    }
    const extras: number[][] = [[]]
    const seen = new Set<string>([''])
    const sets = historyBoundarySets(box, bidi)
    for (let k = 0; k < sets.length; k++) {
      const extra = sets[k]!.filter(position => position > 0 && position < box.text.length && !ownEnds.has(position)).sort((x, y) => x - y)
      const key = extra.join(',')
      if (seen.has(key)) continue
      seen.add(key)
      extras.push(extra)
    }
    // Preserved white space of two units or more takes the three structures; a world that equals the own items is dropped.
    const structures: Array<WhitespaceStructure | null> = preservesSpacesAndTabs(box.style) && hasLongWhitespace ? ['whole', 'per-unit', 'separators'] : [null]
    const worldKeys = new Set<string>()
    for (let k = 0; k < extras.length; k++) for (let j = 0; j < structures.length; j++) {
      const world = historyWorld(p, m, b, extras[k]!, structures[j]!)
      if (world === null) continue
      let key = ''
      for (let i = 0; i < world.prepared.items.length; i++) {
        const item = world.prepared.items[i]!
        if (item.kind === 'text' && item.box === b) key += `${item.start}-${item.end}${item.isWordSeparator ? 's' : ''},`
      }
      if (worldKeys.has(key)) continue
      worldKeys.add(key)
      p.historyWorlds.push(world)
    }
  }
}

// TextOnlySimpleLineBuilder::isEligibleForSimplifiedInlineLayoutByStyle (TextOnlySimpleLineBuilder.cpp:499-528) over the
// properties the model has; the others sit at eligible initial values (word-break auto-phrase, box-decoration-break clone,
// hanging-punctuation, hyphenate-limit-lines, text-wrap-style, line-align, line-snap, ::first-line).
function isEligibleForSimplifiedInlineLayoutByStyle(s: WebKitStyle): boolean {
  return s.wordSpacing === 0 && !s.rtl && s.textIndent === 0 && s.textAlign !== 'justify'
}

export function prepareWebKit(paragraph: Paragraph, env: WebKitEnvironment, m: Measurer): WebKitPrepared {
  const zoom = env.pageZoom ?? 1
  const style = webkitStyle(paragraph, paragraph, zoom)
  const index = indexContent(paragraph)
  const bidi = bidiDataFor('webkit')
  const p: WebKitPrepared = {
    paragraph, env, zoom, icuDefaultLocale: env.icuDefaultLocale ?? ICU_DEFAULT_LOCALE_WITHOUT_ENVIRONMENT, style, elements: [],
    builder: 'line-builder', boxes: [], runStarts: [], runTexts: [], items: [], gaps: [], historyWorlds: [],
  }
  const styleOf = (parent: number): WebKitStyle => {
    if (parent < 0) return style
    const e = p.elements[parent]!
    if (e.kind !== 'span') throw new Error(`element ${parent} holds content but is ${e.kind}`)
    return e.style
  }
  for (let e = 0; e < index.elements.length; e++) {
    const indexed = index.elements[e]!
    const node = indexed.node
    switch (node.kind) {
      case 'span':
        p.elements.push({ kind: 'span', parent: indexed.parent, style: webkitStyle(node, paragraph, zoom), edges: boxEdges(node.inlineStart, node.inlineEnd, zoom, env.devicePixelRatio), letterSpacing: f32(f32(node.letterSpacing) * f32(zoom)) })
        break
      case 'atomic': {
        // BoxGeometry of an inline-block with box-sizing: border-box (LayoutIntegrationBoxGeometryUpdater.cpp:670-706):
        // LayoutUnit margins and border box; the margin box is their LayoutUnit sum.
        const marginStart = layoutUnit(f32(f32(node.marginInlineStart) * f32(zoom)))
        const marginEnd = layoutUnit(f32(f32(node.marginInlineEnd) * f32(zoom)))
        const borderBoxWidth = layoutUnit(f32(f32(node.width) * f32(zoom)))
        p.elements.push({ kind: 'atomic', parent: indexed.parent, node, marginStart, marginEnd, borderBoxWidth, marginBoxWidth: f32(marginStart + borderBoxWidth + marginEnd) })
        break
      }
      case 'br':
        p.elements.push({ kind: 'br', parent: indexed.parent })
        break
      case 'wbr':
        p.elements.push({ kind: 'wbr', parent: indexed.parent })
        break
    }
  }
  // Leaves in document order, with the renderer decision of each rendering parent's children.
  const leaves: LeafInput[] = []
  const rendered: boolean[] = []
  const frames: { parent: number; previous: PreviousRenderer }[] = [{ parent: -1, previous: 'none' }]
  for (let ev = 0; ev < index.events.length; ev++) {
    const event = index.events[ev]!
    const frame = frames[frames.length - 1]!
    switch (event.kind) {
      case 'open':
        frame.previous = 'inline'
        frames.push({ parent: event.element, previous: 'none' })
        break
      case 'close':
        frames.pop()
        break
      case 'atomic':
      case 'wbr':
        frame.previous = 'inline'
        break
      case 'br':
        frame.previous = 'br'
        break
      case 'text': {
        const leaf = index.leaves[event.run]!
        const parentStyle = styleOf(leaf.parent)
        const textStyle = styleUnder(paragraph, index, leaf.parent)
        leaves.push({ run: event.run, parent: leaf.parent, text: leaf.text, textStyle, style: parentStyle, lang: langUnder(paragraph, index, leaf.parent) })
        const needed = textRendererIsNeeded(leaf.text, frame.previous, parentStyle, leaf.parent >= 0)
        rendered.push(needed)
        if (needed) frame.previous = 'text'
        break
      }
    }
  }
  // m_contentRequiresVisualReordering (IIB:231-240): a 16-bit box with strong RTL content, or an RTL inline box.
  let reordering = false
  let inlineBoxes = 0
  let textAndLineBreakOnly = true
  for (let e = 0; e < p.elements.length; e++) {
    const element = p.elements[e]!
    if (element.kind === 'span') {
      inlineBoxes++
      reordering ||= element.style.rtl
    }
    // isTextOrLineBreak and isInlineBoxWithInlineContent (IIB:89-92, :242-245): atomic inlines and <wbr> aren't.
    if (element.kind === 'atomic' || element.kind === 'wbr') textAndLineBreakOnly = false
  }
  const boxOfRun: number[] = []
  for (let r = 0; r < leaves.length; r++) {
    p.runStarts.push(index.leaves[r]!.start)
    p.runTexts.push(leaves[r]!.text)
    boxOfRun.push(-1)
    if (!rendered[r]) continue
    const box = makeBox(p, m, leaves[r]!, index.leaves[r]!.start, bidi)
    reordering ||= box.hasStrongDirectionality
    boxOfRun[r] = p.boxes.length
    p.boxes.push(box)
  }
  p.runStarts.push(index.text.length)
  // collectInlineItems: the tree walk (IIB:320-370, 1053-1078).
  for (let ev = 0; ev < index.events.length; ev++) {
    const event = index.events[ev]!
    switch (event.kind) {
      case 'open': p.items.push({ kind: 'inline-box-start', element: event.element, level: DEFAULT_BIDI_LEVEL }); break
      case 'close': p.items.push({ kind: 'inline-box-end', element: event.element, level: DEFAULT_BIDI_LEVEL }); break
      case 'atomic': p.items.push({ kind: 'atomic', element: event.element, level: DEFAULT_BIDI_LEVEL }); break
      case 'br': p.items.push({ kind: 'hard-line-break', element: event.element, level: DEFAULT_BIDI_LEVEL }); break
      case 'wbr': p.items.push({ kind: 'word-break-opportunity', element: event.element, level: DEFAULT_BIDI_LEVEL }); break
      case 'text':
        if (boxOfRun[event.run]! >= 0) handleTextContent(p, m, boxOfRun[event.run]!, reordering)
        break
    }
  }
  if (style.rtl || reordering) computeBidiLevels(p)
  if (reordering) computeItemWidths(p, m)
  const items = p.items
  if (items.length > 0 && textAndLineBreakOnly && inlineBoxes === 0 && !reordering && isEligibleForSimplifiedInlineLayoutByStyle(style)) {
    p.builder = 'text-only-simple'
  } else if (isEligibleForRangeInlineLayout(p, inlineBoxes, textAndLineBreakOnly, reordering)) {
    p.builder = 'range-based'
  }
  collectBoxFacts(p, m, leaves)
  collectHistoryWorlds(p, m, bidi)
  return p
}

// RangeBasedLineBuilder::isEligibleForRangeInlineLayout (RangeBasedLineBuilder.cpp:36-39, :131-184) without floats: every
// item is an inline box start or end, or one span without box edges around content the simple builder takes.
function isEligibleForRangeInlineLayout(p: WebKitPrepared, inlineBoxes: number, textAndLineBreakOnly: boolean, reordering: boolean): boolean {
  const items = p.items
  if (items.length === 0) return false
  const isEmptyContent = items.length % 2 === 0 && inlineBoxes === items.length / 2
  const first = items[0]!
  const last = items[items.length - 1]!
  const isFullyNestedContent = inlineBoxes === 1 && first.kind === 'inline-box-start' && last.kind === 'inline-box-end' && items.length > 2
  if (!isEmptyContent && !isFullyNestedContent) return false
  // hasDecorationOrBreak (:147-160): the leading inline box starts' margin, border and padding.
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.kind !== 'inline-box-start') break
    const element = p.elements[item.element]!
    if (element.kind !== 'span') break
    const e = element.edges
    if (e.marginStart + e.borderStart + e.paddingStart + e.marginEnd + e.borderEnd + e.paddingEnd !== 0 || e.marginStart < 0 || e.marginEnd < 0) return false
  }
  if (isEmptyContent) return true
  if (!textAndLineBreakOnly || reordering) return false
  const span = p.elements[(first as { element: number }).element]!
  if (span.kind !== 'span') return false
  if (span.style.textAlign !== p.style.textAlign) return false
  return isEligibleForSimplifiedInlineLayoutByStyle(p.style) && isEligibleForSimplifiedInlineLayoutByStyle(span.style)
}
