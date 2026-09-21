import { LineGapRanges } from './line-gap-ranges.js'
import { itemAt } from './item-sequence.js'
// WebKit's gaps (Safari 27.0): every Canvas-versus-DOM condition the port reports, with its test, its prose, its merge rule
// and its order (DESIGN.md §2.8, §5). line-gap-ranges.ts owns the latest-overlap merge; nothing here decides a line, fills one or
// reads the rest of the port's stages: the rest of the port calls it at the points where a condition shows.
// - While the paragraph is prepared (content.ts): the paragraph's gaps, the code points makeBox's coverage test can't vouch
//   for, and the facts of each box that only gaps read.
// - While a line is filled (lines.ts): the four conditions a break decision itself shows, raised into the fill's GapSink.
// - On request, from a decided line (index.ts inspectLine): lineGaps, the fill's gaps followed by the conditions of every
//   character the filling measured; then page-history, raised by history.ts from the line as each history world lays it out.
// A paragraph prepared plain has `inspect` null and a null GapSink: every function here that takes one returns at once, so
// the paragraph asks Canvas nothing that only a gap reads, and lineGaps and paragraphGaps throw on it.
import type { WebKitEnvironment } from '../../env.js'
import { contextFor, width as canvasWidth, type CanvasSettings, type Context } from '../../measure/canvas.js'
import type { Gap, GapName } from '../../model.js'
import { canBreakBefore, dictionaryRangesStartingWithMark, hasDictionaryCharacter, inBetweenRangeStartingWithMark } from './breaks.js'
import { isDelimiterQuote, isPunctuation } from './data.js'
import { hasEmojiPresentation } from './fonts.js'
import { hasDelimiterDataOf, lineRulesOf, primaryLanguageOf } from './locale-source.js'
import { compiledInspection, type CompiledFont } from './font-compilation.js'
import { advancesWidth, canvasString, controlIsAdjusted, fixedPitchWidth, isComplexCodePath, isPiecedControl, lessMeasuredSpace, measuredEnd, mergedGlyphs } from './measure.js'
import { preservesSpacesAndTabs, tabsAllowed } from './style.js'
import type { WebKitBox, WebKitBoxInspect, WebKitFilledLine, WebKitInspect, WebKitPrepared, WebKitRefusedSlot, WebKitTextItem } from './types.js'

const f32 = Math.fround

// Where the gaps of a line's filling go: null on a paragraph prepared plain.
export type GapSink = Gap[] | null

// What the paragraph keeps for inspection, which a paragraph prepared plain doesn't have.
export function inspectOf(p: WebKitPrepared, what: string): WebKitInspect {
  if (p.inspect === null) throw new Error(`${what} reads an inspected paragraph, and this one was prepared plain`)
  return p.inspect
}

// The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5): copies, so nothing the caller
// holds is the prepared paragraph's.
export function paragraphGaps(p: WebKitPrepared): Gap[] {
  const gaps = inspectOf(p, 'paragraphGaps').gaps
  const out: Gap[] = []
  for (let k = 0; k < gaps.length; k++) out.push({ ...gaps[k]! })
  return out
}

// ---- While the paragraph is prepared ----

// What an inspected paragraph keeps, as its preparing starts. The paragraph's gaps are conditions of the environment alone
// (DESIGN.md §2.8, §5): page zoom not given. Every condition of the content and fonts concerns the characters some line
// measures, so lineGaps reports it on the lines whose filling measured them, from the facts each box records (boxMade).
export function newInspection(env: WebKitEnvironment): WebKitInspect {
  const gaps: Gap[] = []
  if (env.pageZoom === null) gaps.push({ gap: 'page-zoom', run: null, detail: "the page zoom isn't given; laid out at 1" })
  return { gaps, boxes: [], worlds: [] }
}

// makeBox's primary-font coverage test can't vouch for a code point that measures as wide as LastResort's own box: a fallback
// glyph of that advance looks covered (research/CHARTER-CRITIC.md item 1). Lines measuring such a code point report
// font-fallback. The test hands each code point it finds covered over once, with its width, and LastResort alone is measured
// beside it.
export type UnverifiedCoverage = { lastResortContext: Context; codePoints: number[] }

export function unverifiedCoverage(p: WebKitPrepared, lastResort: CanvasSettings): UnverifiedCoverage | null {
  return p.inspect === null ? null : { lastResortContext: contextFor(p.contexts, lastResort), codePoints: [] }
}

export function coveredLikeLastResort(unverified: UnverifiedCoverage | null, cp: number, s: string, covered: number): void {
  if (unverified === null) return
  if (covered === canvasWidth(unverified.lastResortContext, s)) unverified.codePoints.push(cp)
}

// localeToScriptCode's names (data.ts localeScript) of the Han, kana and Hangul scripts.
const HAN_KANA_AND_HANGUL_SCRIPTS = ['HAN', 'SIMPLIFIED_HAN', 'TRADITIONAL_HAN', 'KATAKANA_OR_HIRAGANA', 'HANGUL']

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
type LanguageFallback = 'cjk' | 'arabic' | null
function hasLanguageDependentFallback(cp: number, kind: LanguageFallback): boolean {
  if (kind === 'cjk') {
    return (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2460 && cp <= 0x257f) || (cp >= 0x25a0 && cp <= 0x25ff) || (cp >= 0x2e80 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff)
      || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe1f) || (cp >= 0xfe30 && cp <= 0xfe4f)
      || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x1aff0 && cp <= 0x1b16f) || (cp >= 0x1f200 && cp <= 0x1f2ff) || (cp >= 0x20000 && cp <= 0x3ffff)
  }
  if (kind === 'arabic') return (cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) || (cp >= 0x8a0 && cp <= 0x8ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)
  return false
}

// The box makeBox made, in box order: the facts of it that only gaps read (types.ts WebKitBoxInspect), from what its font
// facts leave unknown, the coverage above, and its locale and text. `font` owns the resolved family's pure source analysis
// and Canvas strings for this preparation (font-compilation.ts); `rawHan` is the script classification of this leaf's inherited language before specialization.
export function boxMade(p: WebKitPrepared, box: WebKitBox, font: CompiledFont, rawHan: boolean, unverified: UnverifiedCoverage | null): void {
  if (p.inspect === null) return
  const env = p.env
  const facts = font.declared.facts
  const text = box.text
  const language = primaryLanguageOf(box.locale)
  const fallbackKind: LanguageFallback = HAN_KANA_AND_HANGUL_SCRIPTS.includes(box.locale.script) ? 'cjk' : language === 'ur' || language === 'ks' ? 'arabic' : null
  let languageFallback: LanguageFallback = null
  let quote = false
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!
    if (cp > 0xffff) i++
    if (hasLanguageDependentFallback(cp, fallbackKind)) languageFallback = fallbackKind
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
  const compiled = compiledInspection(font)
  let localeChoosesFonts: WebKitBoxInspect['localeChoosesFonts'] = null
  if (box.locale.name !== '' && (compiled.unknownFamily || compiled.namedGeneric || languageFallback)) {
    const settings = { lang: '', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'auto' as const, direction: 'ltr' as const, partition: '' }
    const lastResortContext = contextFor(p.contexts, { ...settings, font: font.lastResortFont })
    const namedContext = compiled.namedLastResortFont === null ? lastResortContext : contextFor(p.contexts, { ...settings, font: compiled.namedLastResortFont })
    const listContext = contextFor(p.contexts, { ...settings, font: font.listLastResortFont })
    localeChoosesFonts = { unknownFamily: compiled.unknownFamily, namedGeneric: compiled.namedGeneric, fallback: languageFallback, namedContext, listContext, lastResortContext }
  }
  p.inspect.boxes.push({
    monospaceUnknown: facts.monospace === null, hyphenUnknown: facts.mapsHyphen === null, unverifiedCoverage: unverified === null ? [] : unverified.codePoints,
    primaryFamilyUnknown: facts.primaryFamily === null, pairKerningUnknown: facts.pairKerning === null, localeChoosesFonts,
    hanLocaleUnknown: env.preferredLanguages === null && rawHan,
    quoteLocaleUnknown: env.icuDefaultLocale === null && quote && box.locale.name !== '' && !hasDelimiterDataOf(box.locale),
    dictionaryRangesStartingWithMark: env.dictionaryBreaks.kind === 'intl-segmenter-word' ? dictionaryRangesStartingWithMark(lineRulesOf(box.locale, box.style.lineBreakMode).rules, text) : [],
  })
}

// ---- While a line is filled ----

// TextUtil::hyphenWidth, read while filling a line (lines.ts lineHyphenWidth), which measured the box's hyphen string as
// `hyphenTotal`. Where FontFacts.mapsHyphen isn't given the string is U+2010, and where U+002D measures differently in the
// box's context the fact decides this line's fit, so the line reports hyphen-glyph. Merge rule: by gap and run.
export function hyphenWidthRead(sink: GapSink, p: WebKitPrepared, boxIndex: number, hyphenTotal: number): void {
  if (sink === null) return
  const box = p.boxes[boxIndex]!
  if (inspectOf(p, 'a line\'s filling').boxes[boxIndex]!.hyphenUnknown && hyphenTotal !== canvasWidth(box.context, '-') && !sink.some(g => g.gap === 'hyphen-glyph' && g.run === box.run)) {
    sink.push({ gap: 'hyphen-glyph', run: box.run, detail: `whether ${box.primaryFamily} maps U+2010 isn't given; laid out with U+2010, which measures differently from "-" here` })
  }
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
    const end = inBetweenRangeStartingWithMark(prevBox.text, nextBox.text, nextBox.locale.name, nextBox.style.lineBreakMode, p.icuDefaultLocale, nextBox.locale)
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
// own. Merge rule: by gap, run and inclusive overlap, extending the latest matching raw entry. It throws on a paragraph prepared plain.
export function lineGaps(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): Gap[] {
  const inspect = inspectOf(p, 'inspectLine')
  if (decided.gaps === null) throw new Error('the line was filled from a paragraph prepared plain, which raises no gaps')
  const env = p.env
  const start = decided.from
  const gaps: Gap[] = []
  for (let k = 0; k < decided.gaps.length; k++) gaps.push({ ...decided.gaps[k]! })
  // The final run start is indexContent's text.length, including source units with no renderer (content.ts).
  const ranges = new LineGapRanges(gaps, p.runStarts[p.runStarts.length - 1]!)
  const add = (gap: GapName, box: WebKitBox, from: number, to: number, detail: string): void => {
    ranges.add(gap, box.run, detail, { start: box.sourceStart + from, end: box.sourceStart + to })
  }
  const end = Math.min(decided.measuredEnd, p.items.length)
  for (let index = start.itemIndex; index < end; index++) {
    const item = itemAt(p.items, index)!
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
    // The path is the measured string's, in the DOM and in Canvas (measure.ts "The font code path"): a string without a
    // complex path character is WidthIterator's in a complex path box too.
    let controlsExact: boolean | null = null
    let simplePath: boolean | null = null
    for (let i = from; i < to; i++) {
      const c = text.charCodeAt(i)
      if (isPiecedControl(c)) {
        simplePath ??= box.simpleFontCodePath || !isComplexCodePath(measured)
        if (c !== 0x0d || simplePath) {
          controlsExact ??= simplePath && controlsMeasureExactly(box.spacedContext, measured)
          if (!controlsExact) add('control-character-width', box, i, i + 1, simplePath
            ? 'Core Text kerns the letter before VT, FF or CR as before a space and keeps an adjustment on CR itself; Canvas shapes another string, so the width is pieced together outside the DOM\'s float32 order'
            : 'VT, FF and CR on the complex path are measured as U+0001 and U+0000, which Core Text shapes otherwise than the control')
        }
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
    // OffscreenCanvas has a null locale (specs/webkit-canvas.md §1.3): boxMade. A control is measured as
    // another character (canvasString) and draws no font's glyph of its own.
    const localeChooses = facts.localeChoosesFonts
    if (localeChooses !== null) {
      for (let i = from; i < to; i++) {
        const cp = text.codePointAt(i)!
        const length = cp > 0xffff ? 2 : 1
        if (cp > 0x1f && !(cp >= 0x7f && cp <= 0x9f)) {
          if ((localeChooses.unknownFamily || (localeChooses.namedGeneric && hasEmojiPresentation(cp))) && !familyDraws(localeChooses.namedContext, localeChooses.lastResortContext, cp)) {
            add('canvas-language', box, i, i + length, localeChooses.unknownFamily
              ? `no named family before the one locale ${box.locale.name} resolves draws this character; OffscreenCanvas has no locale`
              : `a character with default emoji presentation that no family before the generic one draws: the DOM skips the generic family's outline glyph, and Canvas measures the family locale ${box.locale.name} resolves it to by name`)
          } else if (localeChooses.fallback && hasLanguageDependentFallback(cp, localeChooses.fallback) && !familyDraws(localeChooses.listContext, localeChooses.lastResortContext, cp)) {
            add('canvas-language', box, i, i + length, `no family of the list draws this character, and locale ${box.locale.name} chooses its system fallback font; OffscreenCanvas has no locale`)
          }
        }
        i += length - 1
      }
    }
    if (facts.hanLocaleUnknown) add('ui-language', box, from, to, "the Han locale becomes the first preferred language starting with zh-, and the preferred languages aren't given; laid out as zh-hans")
    if (facts.quoteLocaleUnknown) {
      for (let i = from; i < to; i++) {
        if (isDelimiterQuote(text.charCodeAt(i))) add('ui-language', box, i, i + 1, `ICU has no delimiter data for ${box.locale.name}, so the quote overrides follow the WebContent process's default locale, which isn't given; laid out as en_US_POSIX`)
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
    // the advances, the monospace trait decides it (FontFacts.monospace), and so does whether the realized family is Courier
    // New (FontCoreText.cpp:776-782), which the first listed family stands in for.
    if (box.simplifiedMeasuring && !singleSpace && (facts.monospaceUnknown || (box.fixedPitch && facts.primaryFamilyUnknown))) {
      const end = measuredEnd(box, to, !item.isWhitespace)
      if (lessMeasuredSpace(box, to, end, advancesWidth(box, from, end, 0)) !== lessMeasuredSpace(box, to, end, fixedPitchWidth(box, from, end))) {
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
    if (env.dictionaryBreaks.kind === 'unavailable' && hasDictionaryCharacter(lineRulesOf(box.locale, style.lineBreakMode).rules, text, from, to)) {
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




// ---- A decided line in a history world (history.ts) ----

const PAGE_HISTORY_DETAIL = "the break position cache keys a box by its text and wrapping styles, not by its paragraph's direction, neighbouring content, white-space or word spacing, so a box of the same text laid out earlier in the process can hand this box other item ends, and with them this line differs here"

// A history world that hands the text box of `run` another item list lays the line out otherwise at `at` (history.ts
// pageHistoryGaps). Merge rule: by gap and run, with extension and no overlap test.
export function lineDiffersInHistoryWorld(gaps: Gap[], run: number, at: { start: number; end: number }): void {
  for (let k = 0; k < gaps.length; k++) {
    const gap = gaps[k]!
    if (gap.gap !== 'page-history' || gap.run !== run || gap.at === undefined) continue
    gap.at = { start: Math.min(gap.at.start, at.start), end: Math.max(gap.at.end, at.end) }
    return
  }
  gaps.push({ gap: 'page-history', run, detail: PAGE_HISTORY_DETAIL, at })
}
