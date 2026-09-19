// WebKit's gaps (Safari 27.0): every Canvas-versus-DOM condition the port reports, with its test, its prose, its merge rule
// and its order (DESIGN.md §2.8, §5). Nothing outside this file builds a Gap, and nothing in it decides a line. The rest of
// the port calls it at the points where a condition shows:
// - while the paragraph is prepared (content.ts): the code points makeBox's coverage test can't vouch for, then the
//   paragraph's gaps, the facts of each box that only gaps read, and the history worlds (inspectParagraph);
// - while a line is filled (lines.ts): the four conditions a break decision itself shows, raised into the fill's GapSink;
// - on request, from a decided line (index.ts inspectLine): lineGaps, the fill's gaps followed by the conditions of every
//   character the filling measured, then page-history from the line as each history world lays it out.
// A paragraph prepared plain has `inspect` null and a null GapSink: every function here that takes one returns at once, so
// the paragraph asks Canvas nothing that only a gap reads, and lineGaps and paragraphGaps throw on it.
import { contextFor, width as canvasWidth, type CanvasSettings, type Context } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { FontFacts, Gap, GapName } from '../../model.js'
import { AL, FSI, L, LRE, LRI, LRO, ON, PDF, PDI, R, RLE, RLI, RLO, bidiClassOf, type BidiData } from '../../unicode/bidi.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import { canBreakBefore, dictionaryRangesStartingWithMark, hasDictionaryCharacter, inBetweenRangeStartingWithMark } from './breaks.js'
import { bidiBoxContent, familyNames, whitespaceRun, type LeafInput } from './content.js'
import { hasDelimiterData, isDelimiterQuote, isHanLocale, isPunctuation, lineRules, localeScript, webkitBidiData } from './data.js'
import { hasEmojiPresentation } from './fonts.js'
import type { WebKitLineGeometry, WebKitLineStart } from './geometry.js'
import { fillLine, lineHasVisuallyNonEmptyContent, sourceOffset, type WebKitFilledLine, type WebKitRefusedSlot } from './lines.js'
import { boxWidth, canvasString, controlIsAdjusted, fixedPitchWidth, isPiecedControl, itemWidth, measuredEnd, mergedGlyphs, singleSpaceWidth } from './measure.js'
import { lineGeometry } from './output.js'
import { preservesNewline, preservesSpacesAndTabs, tabsAllowed } from './style.js'
import type { WebKitBox, WebKitHistoryWorld, WebKitInspect, WebKitItem, WebKitPrepared, WebKitTextItem } from './types.js'

const f32 = Math.fround

// Where the gaps of a line's filling go: null on a paragraph prepared plain.
export type GapSink = Gap[] | null

// What the paragraph keeps for inspection, which a paragraph prepared plain doesn't have.
function inspectOf(p: WebKitPrepared, what: string): WebKitInspect {
  if (p.inspect === null) throw new Error(`${what} reads an inspected paragraph, and this one was prepared plain`)
  return p.inspect
}

// The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5).
export function paragraphGaps(p: WebKitPrepared): Gap[] {
  return inspectOf(p, 'paragraphGaps').gaps
}

// ---- While the paragraph is prepared ----

// makeBox's primary-font coverage test can't vouch for a code point that measures as wide as LastResort's own box: a fallback
// glyph of that advance looks covered (research/CHARTER-CRITIC.md item 1). Lines measuring such a code point report
// font-fallback. The test hands each code point it finds covered over with its width, and LastResort alone is measured beside
// it.
export type UnverifiedCoverage = { lastResortContext: Context; codePoints: number[] }

export function unverifiedCoverage(p: WebKitPrepared, lastResort: CanvasSettings): UnverifiedCoverage | null {
  return p.inspect === null ? null : { lastResortContext: contextFor(p.contexts, lastResort), codePoints: [] }
}

export function coveredLikeLastResort(unverified: UnverifiedCoverage | null, cp: number, s: string, covered: number): void {
  if (unverified === null) return
  if (covered === canvasWidth(unverified.lastResortContext, s) && !unverified.codePoints.includes(cp)) unverified.codePoints.push(cp)
}

// The box makeBox made, in box order: what its font facts leave unknown and the coverage above. inspectParagraph adds what the
// box's locale and text give once every box exists.
export function boxMade(inspect: WebKitInspect | null, facts: FontFacts, unverified: UnverifiedCoverage | null): void {
  if (inspect === null) return
  inspect.boxes.push({
    monospaceUnknown: facts.monospace === null, hyphenUnknown: facts.mapsHyphen === null, unverifiedCoverage: unverified === null ? [] : unverified.codePoints,
    primaryFamilyUnknown: facts.primaryFamily === null, pairKerningUnknown: facts.pairKerning === null, localeChoosesFonts: null, hanLocaleUnknown: false,
    quoteLocaleUnknown: false, dictionaryRangesStartingWithMark: [],
  })
}

// Once the paragraph's boxes, items and builder stand: its gaps, the rest of each box's facts, and its history worlds.
export function inspectParagraph(p: WebKitPrepared, leaves: readonly LeafInput[]): void {
  if (p.inspect === null) return
  collectBoxFacts(p, p.inspect, leaves)
  collectHistoryWorlds(p, p.inspect, webkitBidiData)
}

// The system design families CoreText resolves with the locale (FontCacheCoreText.cpp:585-598, SystemFontDatabaseCoreText.cpp:236).
const SYSTEM_DESIGN_FAMILIES = ['system-ui', '-apple-system', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded']

// Whether a family of a font list draws the code point: in Canvas the list followed by LastResort (`context`) doesn't give
// LastResort's box (the recipe of makeBox's coverage test; a glyph as wide as LastResort's box can't be told from it and
// counts as not drawn). A list draws a character with its first family that has a glyph, so what the families before some
// point of the box's list draw there they draw in the whole list.
function familyDraws(context: Context, lastResortContext: Context, cp: number): boolean {
  // FontCascade::treatAsZeroWidthSpace (FontCascadeInlines.h:160-176): drawn as a zero-width space whatever font has it,
  // so no font choice shows in a width. Controls below U+0020 and U+007F-U+009F never reach here.
  if (cp === 0xad || cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e) || cp === 0xfeff || cp === 0xfffc) return true
  const s = String.fromCodePoint(cp)
  return canvasWidth(context, s) !== canvasWidth(lastResortContext, s)
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
function hasLanguageDependentFallback(cp: number, locale: string, script: string): boolean {
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
// the content and fonts concerns the characters some line measures, so lineGaps reports it on the lines whose filling
// measured them, from the facts each box records here.
function collectBoxFacts(p: WebKitPrepared, inspect: WebKitInspect, leaves: readonly LeafInput[]): void {
  const env = p.env
  if (env.pageZoom === null) {
    inspect.gaps.push({ gap: 'page-zoom', run: null, detail: "the page zoom isn't given; laid out at 1" })
  }
  for (let b = 0; b < p.boxes.length; b++) {
    const box = p.boxes[b]!
    const facts = inspect.boxes[b]!
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
      const font = leaf.textStyle.font
      const size = f32(f32(font.size) * f32(p.zoom))
      const parts = box.canvasFamily.split(',').map(part => part.trim())
      const named = parts.slice(0, Math.min(firstUnknownFamily, namedGeneric ? box.firstNamedGeneric : families.length))
      const settings = { lang: '', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
      const lastResortContext = contextFor(p.contexts, { ...settings, font: canvasFont({ ...font, family: 'LastResort' }, size) })
      const namedContext = named.length === 0 ? lastResortContext : contextFor(p.contexts, { ...settings, font: canvasFont({ ...font, family: named.concat(['LastResort']).join(', ') }, size) })
      const listContext = contextFor(p.contexts, { ...settings, font: canvasFont({ ...font, family: parts.concat(['LastResort']).join(', ') }, size) })
      facts.localeChoosesFonts = { unknownFamily: firstUnknownFamily < families.length, namedGeneric, fallback: languageFallback, namedContext, listContext, lastResortContext }
    }
    facts.hanLocaleUnknown = env.preferredLanguages === null && leaf.lang !== '' && isHanLocale(leaf.lang)
    facts.quoteLocaleUnknown = env.icuDefaultLocale === null && quote && box.locale !== '' && !hasDelimiterData(box.locale)
    if (env.dictionaryBreaks.kind === 'intl-segmenter-word') {
      facts.dictionaryRangesStartingWithMark = dictionaryRangesStartingWithMark(lineRules(box.locale, box.style.lineBreakMode, p.icuDefaultLocale).rules, text)
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
// hand a box is a history world (WebKitHistoryWorld): the paragraph's items with that box built from the list. pageHistoryGaps
// lays every line out in each world that changes an item the line read, from the same line start, and reports page-history
// where the world's line differs: the effect of the cache on that line, computed instead of guessed.
// Declared approximations: one box differs per world (boxes find their keys independently, so the true set is the product);
// the other box's neighbours are the contexts below, not every text.

// TextBreakingPositionCache::minimumRequiredTextLengthForContentBreakCache and minimumRequiredContentBreaks
// (TextBreakingPositionCache.h:41-42).
const TEXT_BREAKING_POSITION_CACHE_MINIMUM_LENGTH = 5
const TEXT_BREAKING_POSITION_CACHE_MINIMUM_BREAKS = 3

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
function historyWorld(p: WebKitPrepared, inspect: WebKitInspect, boxIndex: number, extra: readonly number[], structure: WhitespaceStructure | null): WebKitHistoryWorld | null {
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
    return itemWidth(p, { ...item, start: from, end: to }, from, to, 0)
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
  return { prepared: { ...p, items, inspect: { ...inspect, worlds: [] } }, box: boxIndex, itemIndex, changed }
}

function collectHistoryWorlds(p: WebKitPrepared, inspect: WebKitInspect, bidi: BidiData): void {
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
      const world = historyWorld(p, inspect, b, extras[k]!, structures[j]!)
      if (world === null) continue
      let key = ''
      for (let i = 0; i < world.prepared.items.length; i++) {
        const item = world.prepared.items[i]!
        if (item.kind === 'text' && item.box === b) key += `${item.start}-${item.end}${item.isWordSeparator ? 's' : ''},`
      }
      if (worldKeys.has(key)) continue
      worldKeys.add(key)
      inspect.worlds.push(world)
    }
  }
}

// ---- While a line is filled ----

// TextUtil::hyphenWidth, read while filling a line (lines.ts lineHyphenWidth). Where FontFacts.mapsHyphen isn't given and U+2010
// and U+002D measure differently, the fact decides this line's fit, so the line reports hyphen-glyph. Merge rule: by gap and run.
export function hyphenWidthRead(sink: GapSink, p: WebKitPrepared, boxIndex: number): void {
  if (sink === null) return
  const box = p.boxes[boxIndex]!
  if (inspectOf(p, 'a line\'s filling').boxes[boxIndex]!.hyphenUnknown && hyphenGlyphsDiffer(box) && !sink.some(g => g.gap === 'hyphen-glyph' && g.run === box.run)) {
    sink.push({ gap: 'hyphen-glyph', run: box.run, detail: `whether ${box.primaryFamily} maps U+2010 isn't given; laid out with U+2010, which measures differently from "-" here` })
  }
}

// Whether U+2010 and U+002D measure differently in the box's context: where FontFacts.mapsHyphen decides a width.
function hyphenGlyphsDiffer(box: WebKitBox): boolean {
  return canvasWidth(box.context, '‐') !== canvasWidth(box.context, '-')
}


// firstCharacterBreakRespectingLineStartProhibitions (lines.ts) in an 8-bit box, which keeps `firstLength` units at the line
// start. Storage decides what this break keeps at the line start: one code unit in 8-bit text, the first character and every
// following one that can't start a line in 16-bit text (ICB:143-157). Latin-1 text is assumed 8-bit (specs/webkit-gaps.md
// §7.5), so where the unit after the first can't start a line, the 16-bit answer differs. Merge rule: by gap and run.
export function emergencyBreakIn8BitText(sink: GapSink, box: WebKitBox, item: WebKitTextItem, firstLength: number): void {
  if (sink === null) return
  if (item.start + firstLength < item.end && !canBreakBefore(box.text.charCodeAt(item.start + firstLength), box.style.lineBreak) && !sink.some(g => g.gap === 'string-storage' && g.run === box.run)) {
    sink.push({ gap: 'string-storage', run: box.run, detail: 'an emergency break keeps one code unit of 8-bit text at the line start, where 16-bit text keeps the following characters that can\'t start a line; Latin-1 text assumed 8-bit', at: { start: box.sourceStart + item.start, end: box.sourceStart + item.start + firstLength + 1 } })
  }
}

// rule webkit/gap/dictionary-stand-in-between-boxes
// TextUtil::mayBreakInBetween between two boxes (lines.ts breakInBetween), reporting dictionary-breaks-stand-in on the line
// that asks where the iterator's text starts a dictionary range with a combining mark (breaks.ts
// inBetweenRangeStartingWithMark). Merge rule: by equal range.
export function breakTestBetweenBoxes(sink: GapSink, p: WebKitPrepared, prevBox: WebKitBox, nextBox: WebKitBox): void {
  if (sink === null) return
  if (p.env.dictionaryBreaks.kind === 'intl-segmenter-word') {
    const end = inBetweenRangeStartingWithMark(prevBox.text, nextBox.text, nextBox.locale, nextBox.style.lineBreakMode, p.icuDefaultLocale)
    if (end !== null) {
      const at = { start: nextBox.sourceStart - Math.min(2, prevBox.text.length), end: nextBox.sourceStart + end }
      if (!sink.some(g => g.gap === 'dictionary-breaks-stand-in' && g.at !== undefined && g.at.start === at.start && g.at.end === at.end)) {
        sink.push({ gap: 'dictionary-breaks-stand-in', run: nextBox.run, detail: "the break test between two text boxes starts a dictionary range with a combining mark from the previous box's last two units, where the line engine resynchronizes from its dictionary and the word segmenter breaks after the mark", at })
      }
    }
  }
}

// LineBuilder::applyShapingOnRunRange (lines.ts) shaped the text items from `firstItem` to `lastItem` as one run, each run's
// width a stand-in (rule webkit/lines/shaped-run-in-joining-context). Merge rule: by overlap, with extension.
export function shapedAcrossInlineBoxes(sink: GapSink, p: WebKitPrepared, firstItem: WebKitTextItem, lastItem: WebKitTextItem): void {
  if (sink === null) return
  const firstBox = p.boxes[firstItem.box]!
  const at = { start: firstBox.sourceStart + firstItem.start, end: p.boxes[lastItem.box]!.sourceStart + lastItem.end }
  const known = sink.find(g => g.gap === 'rtl-shaping-across-inline-boxes' && g.at !== undefined && g.at.start <= at.end && g.at.end >= at.start)
  if (known !== undefined) known.at = { start: Math.min(known.at!.start, at.start), end: Math.max(known.at!.end, at.end) }
  else sink.push({ gap: 'rtl-shaping-across-inline-boxes', run: firstBox.run, detail: 'RTL text shaped across inline boxes as one run: each run is a difference of Canvas totals of the joined text, where WebKit sums CoreText base advances per character', at })
}

// ---- A decided line: the conditions of what its filling measured (DESIGN.md §2.8, §5) ----

// Every condition of the characters this line's filling measured: the items from the line start to the end of the last
// candidate content the builder formed, placed or not, so the content whose width ended the line counts. Each gap names the
// characters its condition concerns (`at`): one entry per gap, text leaf and stretch of concerned characters, since a gap
// covers a failure only where its range touches what differs (lab scorer 5). Ranges of one gap and leaf that touch are one
// entry.
// The list starts as the gaps the filling raised, in their order, which the merging below reads; the decided line keeps its
// own. Merge rule: by gap, run and overlap, scanning from the end, with extension.
function measuredGaps(p: WebKitPrepared, inspect: WebKitInspect, decided: WebKitFilledLine | WebKitRefusedSlot): Gap[] {
  if (decided.gaps === null) throw new Error('the line was filled from a paragraph prepared plain, which raises no gaps')
  const env = p.env
  const start = decided.from
  const gaps: Gap[] = []
  for (let k = 0; k < decided.gaps.length; k++) gaps.push({ ...decided.gaps[k]! })
  const add = (gap: GapName, box: WebKitBox, from: number, to: number, detail: string): void => {
    const at = { start: box.sourceStart + from, end: box.sourceStart + to }
    for (let k = gaps.length - 1; k >= 0; k--) {
      const known = gaps[k]!
      if (known.gap !== gap || known.run !== box.run || known.at === undefined || at.start > known.at.end || at.end < known.at.start) continue
      known.at = { start: Math.min(known.at.start, at.start), end: Math.max(known.at.end, at.end) }
      return
    }
    gaps.push({ gap, run: box.run, detail, at })
  }
  const end = Math.min(decided.measuredEnd, p.items.length)
  for (let index = start.itemIndex; index < end; index++) {
    const item = p.items[index]!
    if (item.kind !== 'text') continue
    const lineFrom = index === start.itemIndex ? item.start + start.offset : item.start
    if (lineFrom >= item.end) continue
    itemGaps(item, lineFrom, item.end, add)
    // rule webkit/gap/carried-width-conditions
    // A line that starts inside an item with a carried width lays out the whole item's width less what the lines before it
    // took (overflowWidthAsLeadingForNextLine, ALB:54-98; InlineTextItem::right, InlineTextItem.cpp:65-71), so what concerns
    // the whole item's measurement concerns the width of the rest (triage c-0033f34a9d6b3f85: `ty` after `affini` is
    // 9.439998626708984px natively, 9.44000244140625px from a whole that leaves out a pair adjustment; suite
    // c-790a15d5d04b7c3a: FF after `A` is 11.1171875px, the whole with `A` kerned as before a space, less `A` alone).
    if (index === start.itemIndex && start.offset > 0 && start.previousLine !== null && start.previousLine.carriedWidth !== null) {
      itemGaps(item, item.start, item.end, (gap, box, _from, _to, detail) => add(gap, box, lineFrom, item.end, `${detail}; in the whole item, which the carried width of the rest comes from`))
      if (start.previousLine.carriedFromShaping) add('rtl-shaping-across-inline-boxes', p.boxes[item.box]!, lineFrom, item.end, 'the carried width of the rest comes from a run shaped across inline boxes, a difference of Canvas totals of the joined text')
    }
  }
  return gaps

  function itemGaps(item: WebKitTextItem, from: number, to: number, add: (gap: GapName, box: WebKitBox, from: number, to: number, detail: string) => void): void {
    const box = p.boxes[item.box]!
    const facts = inspect.boxes[item.box]!
    const style = box.style
    const text = box.text
    // A collapsible white space item, or a lone preserved space, measures one space alone (TextUtil.cpp:111-122).
    const singleSpace = item.isWhitespace && (!preservesSpacesAndTabs(style) || (to - from === 1 && text.charCodeAt(from) === 0x20))
    // The string TextUtil::width measures for the item: with the U+0020 that follows a text item (TextUtil.cpp:72-76).
    const measured = text.slice(from, measuredEnd(box, to, !item.isWhitespace))
    // VT, FF and CR (measure.ts, "VT, FF and CR"): the stand-in is the DOM's sum unless Canvas shows a pair adjustment around
    // the control, or text follows a CR in the measured string. The complex text controller gives VT and FF .notdef's advance
    // and CR none (ComplexTextController.cpp:773-782): its kerning around VT and FF wasn't probed, so they report there.
    let controlsExact: boolean | null = null
    for (let i = from; i < to; i++) {
      const c = text.charCodeAt(i)
      if (c === 0x0b || c === 0x0c || (c === 0x0d && box.simpleFontCodePath)) {
        controlsExact ??= box.simpleFontCodePath && controlsMeasureExactly(box.spacedContext, measured)
        if (!controlsExact) add('control-character-width', box, i, i + 1, box.simpleFontCodePath
          ? 'Core Text kerns the letter before VT, FF or CR as before a space and keeps an adjustment on CR itself; Canvas shapes another string, so the width is pieced together outside the DOM\'s float32 order'
          : 'VT, FF and CR on the complex path are measured as U+0001 and U+0000, which Core Text shapes otherwise than the control')
      }
      // FontCascade::tabWidth counts stops from the primary font's spaceWidth() (FontCascadeInlines.h:76-94), taken from Canvas
      // W(' '), and letter spacing after a TAB follows WidthIterator; neither is probed (webkit audit E3).
      if (c === 0x09 && tabsAllowed(style)) add('tab-stops', box, i, i + 1, "tab stops count from Canvas W(' ') for the primary font's spaceWidth()")
      // Storage decides keep-all's punctuation breaks: after punctuation in 16-bit text only (BreakablePositions.h:257-274,
      // :292-299). Latin-1 text is assumed 8-bit (specs/webkit-gaps.md §7.5).
      if (box.is8Bit && style.wordBreak === 'keep-all' && isPunctuation(c) && i + 1 < text.length) add('string-storage', box, i, i + 1, 'keep-all breaks after punctuation in 16-bit text only; Latin-1 text assumed 8-bit')
    }
    // Letter spacing and ligatures (measure.ts mergedGlyphs): the gap sits where Canvas shows merged glyphs in the measured
    // string. On the simple path the string is measured with the merged pairs separated, which leaves what shaping does
    // across each pair with liga, clig, dlig and hlig off, a pair adjustment, unmeasured; on the complex path, or where
    // separating leaves glyphs merged, the string is measured as Canvas shapes it, and a merge the DOM keeps too (a
    // required ligature) can't be told from one it turns off.
    if (box.letterSpacing !== 0 && !singleSpace) {
      const merge = mergedGlyphs(box, measured)
      if (merge.separated !== null) {
        for (let k = 0; k < merge.pairs.length; k++) add('letter-spacing-ligatures', box, from + merge.pairs[k]![0], Math.min(to, from + merge.pairs[k]![1]), 'Canvas merges this pair under liga, clig, dlig or hlig, which the DOM turns off under letter-spacing; measured with U+200C between the two, which leaves out a pair adjustment between them')
      } else if (merge.merged) {
        add('letter-spacing-ligatures', box, from, to, merge.counted
          ? 'Canvas shows fewer spacing-bearing glyphs than characters here, and the DOM turns off liga, clig, dlig and hlig under letter-spacing; OffscreenCanvas keeps them'
          : "the string is too long to count its spacing-bearing glyphs exactly from two float32 totals, so Canvas can't show whether liga, clig, dlig or hlig, which the DOM turns off under letter-spacing, merged glyphs in it")
      }
    }
    // OffscreenCanvas has a null locale (specs/webkit-canvas.md §1.3): collectBoxFacts. A control is measured as
    // another character (canvasString) and draws no font's glyph of its own.
    const localeChooses = facts.localeChoosesFonts
    if (localeChooses !== null) {
      for (let i = from; i < to; i++) {
        const cp = text.codePointAt(i)!
        const length = cp > 0xffff ? 2 : 1
        if (cp > 0x1f && !(cp >= 0x7f && cp <= 0x9f)) {
          if ((localeChooses.unknownFamily || (localeChooses.namedGeneric && hasEmojiPresentation(cp))) && !familyDraws(localeChooses.namedContext, localeChooses.lastResortContext, cp)) {
            add('canvas-language', box, i, i + length, localeChooses.unknownFamily
              ? `no named family before the one locale ${box.locale} resolves draws this character; OffscreenCanvas has no locale`
              : `a character with default emoji presentation that no family before the generic one draws: the DOM skips the generic family's outline glyph, and Canvas measures the family locale ${box.locale} resolves it to by name`)
          } else if (localeChooses.fallback && hasLanguageDependentFallback(cp, box.locale, localeScript(box.locale)) && !familyDraws(localeChooses.listContext, localeChooses.lastResortContext, cp)) {
            add('canvas-language', box, i, i + length, `no family of the list draws this character, and locale ${box.locale} chooses its system fallback font; OffscreenCanvas has no locale`)
          }
        }
        i += length - 1
      }
    }
    if (facts.hanLocaleUnknown) add('ui-language', box, from, to, "the Han locale becomes the first preferred language starting with zh-, and the preferred languages aren't given; laid out as zh-hans")
    if (facts.quoteLocaleUnknown) {
      for (let i = from; i < to; i++) {
        if (isDelimiterQuote(text.charCodeAt(i))) add('ui-language', box, i, i + 1, `ICU has no delimiter data for ${box.locale}, so the quote overrides follow the WebContent process's default locale, which isn't given; laid out as en_US_POSIX`)
      }
    }
    if (box.fixedPitchFastMeasuring && facts.unverifiedCoverage.length > 0) {
      for (let i = from; i < to; i++) {
        const cp = text.codePointAt(i)!
        const length = cp > 0xffff ? 2 : 1
        if (facts.unverifiedCoverage.includes(cp)) add('font-fallback', box, i, i + length, "a code point measures as wide as LastResort's box, so the Canvas coverage test can't tell whether the primary font maps it, which decides the fixed-pitch width shortcut")
        i += length - 1
      }
    }
    // Test T1 of specs/webkit-gaps.md §2.5: where the width shortcut of a fixed-pitch primary font gives another width than
    // the advances, the monospace trait decides it, and so does whether the realized family is Courier New
    // (FontCoreText.cpp:776-782), which the first listed family stands in for.
    if (box.simplifiedMeasuring && !singleSpace && (facts.monospaceUnknown || (box.fixedPitch && facts.primaryFamilyUnknown))) {
      if (boxWidth(box, from, to, 0, !item.isWhitespace, false) !== fixedPitchShortcutWidth(box, from, to, !item.isWhitespace)) {
        add('fixed-pitch-path', box, from, to, facts.monospaceUnknown
          ? `whether ${box.primaryFamily} has the monospace trait isn't given, and the width shortcut of a fixed-pitch font gives this item another width (test T1)`
          : "the primary family isn't given, and whether it is Courier New decides the width shortcut, which gives this item another width (test T1)")
      }
    }
    // rule webkit/gap/simplified-measuring-space-advance
    // The DOM's simplified path sums the shaped advances of the primary font's glyphs in one float32 loop
    // (FontCascade::widthForSimpleTextSlow, FontCascade.cpp:381-412). Canvas runs WidthIterator: the unshaped sum U, plus the
    // shaped sum S less U, after it puts every character treated as a space back to its unshaped advance
    // (applyFontTransforms, WidthIterator.cpp:84-120): the total is f32(U + f32(S - U)). Where U / 2 <= S <= 2 * U, S - U is
    // exact in float32 (Sterbenz) and the total is S. Rounding is monotonic and U / 2 and 2 * U are float32 numbers, so an S
    // below U / 2 gives a total of at most U / 2 and an S above 2 * U one of at least 2 * U: a total strictly between them
    // says S is in range, and the two paths agree to the bit unless shaping changed a space's own advance, which Canvas can't
    // show (probe webkit-round3 R1: 162 of 162 strings without a space, kerned and ligated ones included, measure the same in
    // the DOM and in Canvas).
    // - A U+0020 before the string's last unit is the first glyph of a pair, where CoreText puts a pair adjustment: a
    //   preserved run of spaces.
    // - The U+0020 a text item is measured with is the string's last glyph, a pair's second glyph. CoreText puts the pair
    //   adjustment of kern, kerx and first-glyph GPOS value records on the letter (probe webkit-round3 R2: 2,350 of 2,350
    //   pre boxes `x` U+0020 in 25 fonts, 47 of them with an adjustment, equal the Canvas recipe). A GPOS value record for
    //   the pair's second glyph would move the space itself, and FontFacts.pairKerning says the font has none.
    if (box.simplifiedMeasuring && !box.fixedPitchFastMeasuring && !singleSpace) {
      const space = measured.indexOf(' ')
      let moved = space >= 0 && (space < measured.length - 1 || facts.pairKerningUnknown)
      if (!moved) {
        let unshaped = 0
        for (let i = 0; i < measured.length; i++) {
          const cp = measured.codePointAt(i)!
          unshaped = f32(unshaped + canvasWidth(box.context, canvasString(String.fromCodePoint(cp))))
          if (cp > 0xffff) i++
        }
        const total = canvasWidth(box.context, canvasString(measured))
        moved = total !== unshaped && !(total > unshaped / 2 && total < 2 * unshaped)
      }
      if (moved) add('simplified-measuring', box, from, to, "the DOM keeps a space's shaped advance on the simplified path, where Canvas puts it back to the unshaped one")
    }
    if (env.dictionaryBreaks.kind === 'unavailable' && hasDictionaryCharacter(lineRules(box.locale, style.lineBreakMode, p.icuDefaultLocale).rules, text, from, to)) {
      add('dictionary-breaks-unavailable', box, from, to, 'Thai, Lao, Khmer or Myanmar text gets no dictionary boundaries')
    }
    for (let k = 0; k < facts.dictionaryRangesStartingWithMark.length; k++) {
      const [rangeStart, rangeEnd] = facts.dictionaryRangesStartingWithMark[k]!
      if (rangeStart < to && rangeEnd > from) add('dictionary-breaks-stand-in', box, rangeStart, rangeEnd, 'a dictionary range starts with a combining mark, where the line engine resynchronizes from its dictionary and the word segmenter breaks after the mark')
    }
  }
}

// Whether the width of a string holding VT, FF or CR is the DOM's own float32 sum (measure.ts, "VT, FF and CR").
function controlsMeasureExactly(context: Context, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (!isPiecedControl(c)) continue
    if (c === 0x0d && i + 1 < text.length) return false
    if (controlIsAdjusted(context, text, i)) return false
  }
  return true
}


// The width shortcut's answer for the same range, which a fixed-pitch primary font would give (test T1 of
// specs/webkit-gaps.md §2.5): where it differs from boxWidth, FontFacts.monospace decides the width.
function fixedPitchShortcutWidth(box: WebKitBox, from: number, to: number, trailingSpace: boolean): number {
  if (from === to) return 0
  const end = measuredEnd(box, to, trailingSpace)
  let width = fixedPitchWidth(box, from, end)
  if (end > to) width = f32(width - f32(singleSpaceWidth(box) + box.wordSpacing))
  return Number.isNaN(width) ? 0 : Math.max(0, width)
}


// ---- A decided line: page history ("Page history: the break position cache" above) ----
// rule webkit/gap/page-history-worlds

// What the comparison below reads of a decided line: its range, its line box and its display boxes; or that the slot was
// refused.
type ComparedLine = { kind: 'line'; start: number; end: number; hasLineBox: boolean; geometry: WebKitLineGeometry } | { kind: 'below-floats' }

function comparedLine(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): ComparedLine {
  switch (decided.kind) {
    case 'line': return { kind: 'line', start: decided.start, end: decided.end, hasLineBox: lineHasVisuallyNonEmptyContent(p, decided.line), geometry: lineGeometry(p, decided) }
    case 'below-floats': return { kind: 'below-floats' }
  }
}

// Where a line of the paragraph and the same line in a history world differ, as a source range, or null where they agree in
// everything the observation port reads: the line's range, its line box and its display boxes.
function lineDifference(p: WebKitPrepared, a: ComparedLine, b: ComparedLine): { start: number; end: number } | null {
  if (a.kind !== 'line' || b.kind !== 'line') return a.kind === b.kind ? null : a.kind === 'line' ? { start: a.start, end: a.end } : { start: 0, end: 0 }
  let start = Infinity
  let end = -Infinity
  const mark = (from: number, to: number): void => {
    start = Math.min(start, from)
    end = Math.max(end, to)
  }
  // Another break: the text between the two breaks. What else differs on the line follows from the break.
  if (a.end !== b.end) return { start: Math.min(a.end, b.end), end: Math.max(a.end, b.end) }
  const ga = a.geometry
  const gb = b.geometry
  for (let k = 0; k < ga.boxes.length && k < gb.boxes.length; k++) {
    const x = ga.boxes[k]!
    const y = gb.boxes[k]!
    let same = x.kind === y.kind && x.x === y.x && x.width === y.width
    if (same && (x.kind === 'text' || x.kind === 'soft-line-break') && (y.kind === 'text' || y.kind === 'soft-line-break')) {
      same = x.run === y.run && x.start === y.start && x.end === y.end && x.level === y.level && x.hyphen === y.hyphen && x.expansion === y.expansion
    }
    if (same) continue
    if (x.kind === 'text' || x.kind === 'soft-line-break') mark(p.runStarts[x.run]! + x.start, p.runStarts[x.run]! + x.end)
    else mark(a.start, a.end)
  }
  // The line's own sums alone: no box says where.
  if (start === Infinity && (a.hasLineBox !== b.hasLineBox || ga.contentWidth !== gb.contentWidth || ga.hangingWidth !== gb.hangingWidth || ga.contentLogicalRight !== gb.contentLogicalRight || ga.alignmentOffset !== gb.alignmentOffset || ga.boxes.length !== gb.boxes.length)) mark(a.start, a.end)
  return start === Infinity ? null : { start, end }
}

// The line start in a history world that stands where `start` stands, or null where the world can't be at that start: the
// line begins inside an item with a width carried from the lines before it (overflowWidthAsLeadingForNextLine, ALB:54-98;
// InlineTextItem::right, InlineTextItem.cpp:65-71), and the world's item there isn't the own one, so its rest started from
// another whole (triage c-66ae4ab7d56cb0ae: line 6 keeps `ببب` at 16.27px, the rest of `بببب` alone, where the rest of
// `((بببب` is 26.02px); or the world has no item boundary at a line start between two of the own items.
function worldLineStart(p: WebKitPrepared, world: WebKitHistoryWorld, start: WebKitLineStart): WebKitLineStart | null {
  if (start.itemIndex >= p.items.length) return { ...start, itemIndex: world.prepared.items.length }
  const own = p.items[start.itemIndex]!
  let index = world.itemIndex[start.itemIndex]!
  if (own.kind !== 'text') return { ...start, itemIndex: index }
  const position = own.start + start.offset
  const items = world.prepared.items
  let first = items[index] as WebKitTextItem
  if (first.start > own.start) return null
  while (first.end <= position) {
    const following = items[index + 1]
    if (following === undefined || following.kind !== 'text' || following.box !== own.box || following.start !== first.end) return null
    first = following
    index++
  }
  if (start.offset === 0) return first.start === position ? { ...start, itemIndex: index } : null
  // A carried width is the whole item's less what the lines before took, so it stands in the world only where the world's
  // item is the own one (suite c-19ccdb6bbbc8089c: `ببب((` broken after its first letter carries 32.4px for `بب((`, where a
  // world that ends an item before `((` carries 10.416px for `بب`, which fits with nothing after it).
  if (start.previousLine !== null && start.previousLine.carriedWidth !== null) return first.start === own.start && first.end === own.end ? { ...start, itemIndex: index } : null
  if (first.start === own.start) return { ...start, itemIndex: index }
  return { ...start, itemIndex: index, offset: position - first.start }
}

const PAGE_HISTORY_DETAIL = "the break position cache keys a box by its text and wrapping styles, not by its paragraph's direction, neighbouring content, white-space or word spacing, so a box of the same text laid out earlier in the process can hand this box other item ends, and with them this line differs here"

// Each world that changes an item the line read lays the line out from the same start in the same slot, with the functions
// that fill and inspect the paragraph's own line. Merge rule: by gap and run, with extension and no overlap test.
function pageHistoryGaps(p: WebKitPrepared, inspect: WebKitInspect, decided: WebKitFilledLine | WebKitRefusedSlot, gaps: Gap[]): void {
  const start = decided.from
  const readEnd = Math.min(Math.max(decided.measuredEnd, start.itemIndex + 1), p.items.length)
  let ownLine: ComparedLine | null = null
  for (let w = 0; w < inspect.worlds.length; w++) {
    const world = inspect.worlds[w]!
    let reads = false
    for (let i = start.itemIndex; i < readEnd && !reads; i++) reads = world.changed[i]!
    if (!reads) continue
    const worldStart = worldLineStart(p, world, start)
    let at: { start: number; end: number } | null
    if (worldStart === null) {
      const from = start.itemIndex === 0 && start.offset === 0 ? 0 : sourceOffset(p, { index: start.itemIndex, offset: start.offset })
      const own = p.items[start.itemIndex]!
      at = { start: from, end: own.kind === 'text' ? p.boxes[own.box]!.sourceStart + own.end : from }
    } else {
      const inWorld = fillLine(world.prepared, worldStart, decided.slot).line
      // The world's line gets the gap work of the paragraph's own, with the Canvas questions that takes, though the comparison
      // reads none of it. A world shares its paragraph's box facts.
      measuredGaps(world.prepared, inspect, inWorld)
      ownLine ??= comparedLine(p, decided)
      at = lineDifference(p, ownLine, comparedLine(world.prepared, inWorld))
    }
    if (at === null) continue
    const run = p.boxes[world.box]!.run
    let known = false
    for (let k = 0; k < gaps.length && !known; k++) {
      const gap = gaps[k]!
      if (gap.gap !== 'page-history' || gap.run !== run || gap.at === undefined) continue
      gap.at = { start: Math.min(gap.at.start, at.start), end: Math.max(gap.at.end, at.end) }
      known = true
    }
    if (!known) gaps.push({ gap: 'page-history', run, detail: PAGE_HISTORY_DETAIL, at })
  }
}

// The gaps of a decided line or a refused slot: what its filling raised, the conditions of what it measured, and page-history
// where a history world lays the line (InlineFormattingContext::lineLayout) out otherwise. It throws on a paragraph prepared
// plain.
export function lineGaps(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): Gap[] {
  const inspect = inspectOf(p, 'inspectLine')
  const gaps = measuredGaps(p, inspect, decided)
  pageHistoryGaps(p, inspect, decided, gaps)
  return gaps
}
