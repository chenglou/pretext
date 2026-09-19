// Every gap of the Gecko port (Firefox 156.0; DESIGN.md §2.8, §5): each condition's test, its prose and its order, with the
// measuring that exists only to decide one. The rest of the port calls in at the program points where a condition can show,
// with the sink its gaps go to; on a plain paragraph the sink is null and every function returns at once, so a plain
// paragraph computes no gap and asks Canvas nothing for one. Nothing else builds a Gap.
// - Preparation raises the paragraph's gaps (GeckoPrepared.inspect.gaps; paragraphGaps).
// - A fill raises the gaps its passes run into, into the decided line's list, and notes the raw facts a later report needs:
//   the in-word offsets its break scans consulted (lines.ts glyphBefore) and the tabs whose width is a stand-in.
// - lineGaps reports a decided line's gaps from those and from its geometry.
// Gecko's lists aren't merged: a condition that shows twice is listed twice, as when both passes of a redo meet the same
// emergency break. Only the in-word report is sorted.
import type { GeckoEnvironment } from '../../env.js'
import { measureContext, measureText, type CanvasSettings, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { FontDecl, Gap, GapName, TextStyle } from '../../model.js'
import { advanceBefore, type InWordReason } from './advance.js'
import { COLOR_EMOJI_FAMILY, listedFontOf, opticalSizeAxisOf } from './fonts.js'
import type { GeckoFrameGeometry, GeckoLineStart } from './geometry.js'
import { BREAK_EMERGENCY_WRAP, complexLanguage } from './linebreak.js'
import type { GeckoLineInspect, Measured, PlacedText, SpanData } from './lines.js'
import { CANVAS_AU_PER_PX, quantize7, rangeAu } from './measure.js'
import type { EmojiPresentation } from './prepare.js'
import { WORD_WRAP_BREAK, frameOfSource, type GeckoInspect, type GeckoPrepared, type GeckoTextRun } from './types.js'

// Where gaps go: a list in raise order, or null on a plain paragraph.
export type GapSink = Gap[] | null

// The gaps of the paragraph's content, fonts and environment, whatever the slot (DESIGN.md §5).
export function paragraphGaps(p: GeckoPrepared): Gap[] {
  if (p.inspect === null) throw new Error('paragraphGaps reads an inspected paragraph, and this one was prepared plain')
  return p.inspect.gaps
}

// ---- Preparation ----

// lang="" leaves the style language empty, and the text then matches fonts under the OS regional-prefs locale
// (prepare.ts, the leaves' languages): the measure contexts take that locale when the caller gives it.
export function emptyLanguage(sink: GapSink, env: GeckoEnvironment, lang: string, run: number, start: number, end: number): void {
  if (sink === null) return
  if (lang === '' && env.regionalPrefsLocale === null) sink.push({ gap: 'ui-language', run, detail: 'lang="": font lists and generic families follow the OS regional-prefs locale, which pages cannot read (nsFontCache.cpp:61-63)', at: { start, end } })
}

// A paragraph that doesn't resolve bidi (prepare.ts step 2): the document resolves bidi once any text node holds a bidi
// code unit (CharacterData.cpp:298-302; nsBlockFrame.cpp:863-864), whatever this paragraph holds. An LTR paragraph with
// left-to-right embedding, override or isolate controls and no right-to-left character then splits frames at the level
// changes those controls make, and frames at different levels don't share a text run (nsTextFrame.cpp:2139-2148). The port
// predicts a fresh document (gecko audit F3).
export function leftToRightControls(sink: GapSink, text: string, run: number, start: number, end: number): void {
  if (sink === null) return
  let found = false
  for (let s = start; s < end && !found; s++) {
    const u = text.charCodeAt(s)
    found = u === 0x202a || u === 0x202d || u === 0x2066 || u === 0x2068
  }
  if (found) {
    sink.push({ gap: 'page-history', run, detail: "left-to-right bidi controls split frames only once the document has seen right-to-left text (CharacterData.cpp:298-302, nsTextFrame.cpp:2139-2148); the port predicts a fresh document", at: { start, end } })
  }
}

// The letter spacing of a cursive cluster goes by which font draws its marks, and the font facts didn't say (prepare.ts
// step 6): the cluster keeps the cursive rule.
export function cursiveClusterFonts(sink: GapSink, run: number, cp: number, start: number, end: number): void {
  if (sink === null) return
  sink.push({ gap: 'font-fallback', run, detail: `a cursive cluster takes letter spacing where another font draws one of its marks than the character before it (gfxTextRun.cpp:809-829), and the font facts don't say which fonts draw U+${cp.toString(16).toUpperCase()} and its marks`, at: { start, end } })
}

// A text run's Canvas font size isn't the DOM's (prepare.ts step 7): every width of the run is a stand-in
// (GeckoTextRun.advancesStandIn).
export function canvasFontSize(sink: GapSink, run: number, domAu: number, canvasAuSize: number, at: { start: number; end: number }): void {
  if (sink === null) return
  if (canvasAuSize !== domAu) sink.push({ gap: 'font-size-quantization', run, detail: `DOM size ${domAu / 60}px, Canvas size ${canvasAuSize / 60}px`, at })
}

// No OffscreenCanvas setting gives the DOM's auto optical sizing (specs/gecko-canvas.md §1.2 C1a), so a font with an
// opsz axis, or one whose axis isn't known, may measure differently (DESIGN.md §1.2).
export function opticalSize(sink: GapSink, run: number, font: FontDecl, at: { start: number; end: number }): void {
  if (sink === null) return
  if (font.facts.opticalSizeAxis !== false) {
    sink.push({ gap: 'optical-size', run, detail: font.facts.opticalSizeAxis === true ? `${font.family} has an opsz axis` : `whether ${font.family} has an opsz axis isn't given (default ${opticalSizeAxisOf(font)})`, at })
  }
}

// measureText's width is `float(au) / 60`, a float (:5277). Below 2^18 px a float32 step is at most 1/64 px, so the value is
// within 1/128 px, 0.47 au, of au / 60 and rounds back to it; from 2^18 px on a step is 1/32 px and the app units are lost.
const CANVAS_EXACT_AU = 2 ** 18 * CANVAS_AU_PER_PX

export function wideUnit(sink: GapSink, run: number, w: number, start: number, end: number): void {
  if (sink === null) return
  if (w >= CANVAS_EXACT_AU) {
    sink.push({ gap: 'float32-precision', run, detail: `a shaping unit ${w} au wide: measureText's float width gives app units back only below 2^18 px (CanvasRenderingContext2D.cpp:5277)`, at: { start, end } })
  }
}

// Whether a space takes part in shaping (gfxFont::SpaceMayParticipateInShaping: the DOM then shapes the text without
// the word cache, across its spaces, gfxFont.cpp:3779-3800) shows where words and spaces measured together differ from
// the sum of their units. A window of units is tested whole. measureText returns float(au) / 60 as a float
// (CanvasRenderingContext2D.cpp:5277), which gives the app units back only below 2^18 px: from there a float32 step is
// 1/32 px or more, up to 0.94 au of rounding. So a window ends before its sum reaches that, and the next one starts at
// the word before, so every space is tested between its two words.
// The test of one text run: its window of units as prepare.ts step 7 measures them, in the run's context. It measures a
// window where today's unit loop stands when the window ends, so Canvas is asked in that order.
export type SpaceTest = {
  sink: Gap[]
  m: Measurer
  context: number
  run: number
  tUnits: Uint16Array
  tSource: Int32Array
  start: number
  words: number
  spaces: number
  sum: number
  lastWordStart: number
  lastWordSum: number
  spacesSinceWord: number
}

export function spaceTest(sink: GapSink, m: Measurer, context: number, run: number, tUnits: Uint16Array, tSource: Int32Array, tStart: number): SpaceTest | null {
  if (sink === null) return null
  return { sink, m, context, run, tUnits, tSource, start: tStart, words: 0, spaces: 0, sum: 0, lastWordStart: tStart, lastWordSum: 0, spacesSinceWord: 0 }
}

function testWindow(test: SpaceTest, end: number): void {
  if (test.words >= 2 && test.spaces >= 1 && test.sum < CANVAS_EXACT_AU) {
    let s = ''
    for (let t = test.start; t < end; t++) s += String.fromCharCode(test.tUnits[t]!)
    const whole = Math.round(measureText(test.m, test.context, s) * CANVAS_AU_PER_PX)
    if (whole !== test.sum) {
      test.sink.push({ gap: 'space-in-shaping', run: test.run, detail: `the whole range measures ${whole} au, its units ${test.sum} au`, at: { start: test.tSource[test.start]!, end: test.tSource[end - 1]! + 1 } })
    }
  }
}

function endWindow(test: SpaceTest, end: number): void {
  testWindow(test, end)
  test.words = 0
  test.spaces = 0
  test.sum = 0
  test.lastWordSum = 0
}

// A boundary space of w au.
export function spaceMeasured(test: SpaceTest | null, w: number): void {
  if (test === null) return
  test.spaces++
  test.sum += w
  test.lastWordSum += w
  test.spacesSinceWord++
}

// An invalid character at t: nothing shapes across it.
export function invalidMet(test: SpaceTest | null, t: number): void {
  if (test === null) return
  endWindow(test, t)
  test.start = t + 1
}

// A word at t of w au.
export function wordMeasured(test: SpaceTest | null, t: number, w: number): void {
  if (test === null) return
  if (test.sum + w >= CANVAS_EXACT_AU && test.words >= 1) {
    testWindow(test, t)
    test.start = test.lastWordStart
    test.words = 1
    test.spaces = test.spacesSinceWord
    test.sum = test.lastWordSum
  }
  test.words++
  test.sum += w
  test.lastWordStart = t
  test.lastWordSum = w
  test.spacesSinceWord = 0
}

export function runEnded(test: SpaceTest | null, end: number): void {
  if (test === null) return
  endWindow(test, end)
}

// A word [t, e) of w au in a letter-spaced text run. CanAddSpacingAfter adds letter spacing only before a character that
// starts a cluster and a ligature group (nsTextFrame.cpp:3860-3873), and the paragraph's spacing counts clusters. Letter
// spacing turns optional ligatures off; the groups required shaping still forms show in Canvas's own letter spacing, which
// goes by the same two flags (CanvasRenderingContext2D.cpp:4759-4790): W at 2px less W at 0.001px, over 2px, counts the
// unit's groups (probe gecko-port F17). A unit with as many groups as clusters is spaced as the DOM spaces it. With fewer,
// Canvas doesn't say which cluster lost its spacing, unless the unit's script is cursive and takes none (:4107-4133).
export function letterSpacedGroups(sink: GapSink, m: Measurer, run: Pick<GeckoTextRun, 'context' | 'scriptRuns' | 'tStart'>, settings: CanvasSettings,
  leaf: number, letterSpacing: number, tUnits: Uint16Array, tSource: Int32Array, clusterStart: Uint8Array, spacingPrefix: Int32Array, t: number, e: number, w: number): void {
  if (sink === null || letterSpacing === 0) return
  let clusters = 0
  let spaced = false
  for (let k = t; k < e; k++) {
    clusters += clusterStart[k]!
    if (spacingPrefix[k + 1] !== spacingPrefix[k]) spaced = true
  }
  if (spaced) {
    const wide = rangeAu(m, { ...run, context: measureContext(m, { ...settings, letterSpacing: '2px' }) }, tUnits, t, e)
    const groups = (wide - w) / (2 * CANVAS_AU_PER_PX)
    if (groups !== clusters) {
      sink.push({ gap: 'glyph-clusters', run: leaf, detail: `Canvas letter spacing counts ${groups} ligature groups in a unit of ${clusters} clusters, and the DOM spaces by ligature group starts (nsTextFrame.cpp:3860-3873)`, at: { start: tSource[t]!, end: tSource[e - 1]! + 1 } })
    }
  }
}

// An emoji-default character with U+FE0E asks for a glyph without color (TextExplicit, gfxTextRun.cpp:3268-3273).
// The preferred fonts and the common fallback list of its script hold none for it (gfxPlatformMac.cpp:147-262
// puts "Apple Color Emoji" first only for a color request), so the font comes from the system-wide search, which
// in a content process looks only at the families whose character maps are loaded by then and starts loading the
// others (GlobalFontFallback, gfxPlatformFontList.cpp:1474-1486), and a color font found on the way stays the
// candidate where the search finds nothing (:1290-1300; gfxTextRun.cpp:3385-3390). So which font draws it follows
// the process's history, unless a listed family draws it. Both orders of the development and held-out suite
// samples (round 4, `.artifacts/lab/gecko/r4-1`): `❤️😀︎❤️` gives U+1F600 U+FE0E 20.7px natively after one
// history and 33.5px after the other, in 5 of the 5 history-dependent cases round 2's condition didn't name.
export function textPresentationSearch(sink: GapSink, run: number, font: FontDecl, first: number, presentation: EmojiPresentation, next: number, at: { start: number; end: number }): void {
  if (sink === null) return
  if (next === 0xfe0e && presentation === 'emoji-default') {
    const listed = listedFontOf(font, first)
    if (listed === null || listed < 0) {
      sink.push({ gap: 'page-history', run, detail: `U+${first.toString(16).toUpperCase()} U+FE0E asks for a glyph without color, which only the system-wide font search finds, among the families whose character maps the process has loaded by then (gfxPlatformFontList.cpp:1474-1486)`, at })
    }
  }
}

// gfxFontGroup::FindFontForChar asks for a color glyph when the next character is VS16 or a skin tone modifier, for a
// black flag with tag letters, or for an emoji-default character not followed by VS15 (gfxTextRun.cpp:3268-3308,
// font-variant-emoji normal).
function prefersColorGlyph(presentation: EmojiPresentation, ch: number, next: number): boolean {
  if (next === 0xfe0f || (next >= 0x1f3fb && next <= 0x1f3ff) || (ch === 0x1f3f4 && next >= 0xe0061 && next <= 0xe007a)) return true
  return presentation === 'emoji-default' && next !== 0xfe0e
}

// A cluster that another font than Apple Color Emoji draws in Canvas, atCssSize au wide (prepare.ts step 7).
export function pinnedEmojiFont(sink: GapSink, run: number, first: number, presentation: EmojiPresentation, next: number, atCssSize: number, at: { start: number; end: number }): void {
  if (sink === null) return
  if (prefersColorGlyph(presentation, first, next)) {
    sink.push({ gap: 'page-history', run, detail: `U+${first.toString(16).toUpperCase()} asks for a color glyph, but Canvas draws it with another font than Apple Color Emoji (${atCssSize} au): the document's font fallback has pinned it, and the DOM follows the state at its own layout time (probes gecko-port F2, F3)`, at })
  }
}

// A cluster that doesn't ask for a color glyph makes FindFontForChar look for a font without one first
// (gfxTextRun.cpp:3268-3308). Canvas runs the same matching in both contexts, except where the run's font string is
// Apple Color Emoji's own: then the two contexts are one and the test above can't fail. Probe gecko-port F4: `©︎`
// in 16px "Apple Color Emoji" draws with a text font at 729 au in Canvas and the DOM.
export function emojiFontOwnList(sink: GapSink, run: number, font: FontDecl, runFont: string, first: number, presentation: EmojiPresentation, next: number, at: { start: number; end: number }): void {
  if (sink === null) return
  if (runFont === canvasFont({ ...font, family: COLOR_EMOJI_FAMILY }, font.size) && !prefersColorGlyph(presentation, first, next)) {
    sink.push({ gap: 'font-fallback', run, detail: `U+${first.toString(16).toUpperCase()} asks for text presentation in Apple Color Emoji's own font list: which font the DOM draws it with depends on text fonts' coverage, which the Canvas test can't show there (gfxTextRun.cpp:3268-3308)`, at })
  }
}

// A bitmap emoji's advance comes from the device size (prepare.ts step 7), which Canvas takes on its 7-bit grid.
export function deviceSizeOffGrid(sink: GapSink, run: number, apd: number, devSize: number, at: { start: number; end: number }): void {
  if (sink === null) return
  if (apd !== 60 && quantize7(devSize) !== devSize) {
    sink.push({ gap: 'bitmap-emoji-size', run, detail: `device size ${devSize}px is not on Canvas's 7-bit size grid`, at })
  }
}

export function inexactDeviceAdvance(sink: GapSink, run: number, deviceAu60: number, apd: number, at: { start: number; end: number }): void {
  if (sink === null) return
  sink.push({ gap: 'bitmap-emoji-size', run, detail: `device-size advance ${deviceAu60} au at apd 60 doesn't give an exact au at apd ${apd}`, at })
}

// Text of a language ICU4X breaks with its LSTM models (complex/language.rs:17-45, linebreak.ts segmentComplex).
export function dictionaryBreaks(sink: GapSink, env: GeckoEnvironment, text: string): void {
  if (sink === null) return
  switch (env.dictionaryBreaks.kind) {
    case 'intl-segmenter-word':
      break
    case 'unavailable': {
      // Each stretch of such text: the break opportunities inside it are unknown.
      const n = text.length
      for (let s = 0; s < n;) {
        if (complexLanguage(text.charCodeAt(s)) === '') { s++; continue }
        let e = s + 1
        while (e < n && complexLanguage(text.charCodeAt(e)) !== '') e++
        sink.push({ gap: 'dictionary-breaks-unavailable', run: null, detail: 'Thai, Lao, Khmer or Myanmar text', at: { start: s, end: e } })
        s = e
      }
      break
    }
  }
}

// U+FFFD outside the listed fonts takes the family the process cached the first time system fallback placed one, whatever
// this run's style and neighbours would choose (gfxPlatformFontList::SystemFindFontForChar,
// gfxPlatformFontList.cpp:1244-1268, :1328-1330): its width follows the process's history. Canvas reads the same cache, so
// the prediction follows the state at measuring time. Which fonts cover U+FFFD isn't a Canvas fact, so every U+FFFD reports
// it unless the coverage facts name a listed family for it (the round 2 held-out suite's 104 history-dependent
// suite/U+FFFD rows: 16px natively after one history, 13.133px after another).
export function replacementCharacters(sink: GapSink, text: string, runStarts: number[], styles: TextStyle[]): void {
  if (sink === null) return
  for (let s = 0; s < text.length; s++) {
    if (text.charCodeAt(s) !== 0xfffd) continue
    let run = 0
    while (runStarts[run + 1]! <= s) run++
    // A listed family that the coverage facts say draws U+FFFD keeps it out of system fallback (fonts.ts listedFontOf).
    const listed = listedFontOf(styles[run]!.font, 0xfffd)
    if (listed !== null && listed >= 0) continue
    sink.push({ gap: 'page-history', run, detail: 'U+FFFD outside the listed fonts takes the family the process first fell back to for U+FFFD (gfxPlatformFontList.cpp:1244-1268, :1328-1330)', at: { start: s, end: s + 1 } })
  }
}

// gfxFont::SynthesizeSpaceWidth gives a U+2007 or U+2008 that no font in the list covers the font's figure or space width,
// rounded to whole device pixels (gfxTextRun.cpp:3032-3043, gfxFont.cpp:4809-4814). Canvas rounds at apd 60 and shows
// neither whether a font covers it nor the unrounded width.
export function figureSpaces(sink: GapSink, apd: number, text: string, runStarts: number[]): void {
  if (sink === null) return
  if (apd !== 60) {
    for (let s = 0; s < text.length; s++) {
      const u = text.charCodeAt(s)
      if (u !== 0x2007 && u !== 0x2008) continue
      let run = 0
      while (runStarts[run + 1]! <= s) run++
      sink.push({ gap: 'font-fallback', run, detail: `U+${u.toString(16).toUpperCase()} takes a synthesized width rounded to device pixels where no font covers it`, at: { start: s, end: s + 1 } })
    }
  }
}

// prepare.ts step 4 couldn't settle whether the emergency break at t exists (emergencyHyphenBreak).
export function emergencyBreakUnconfirmed(inspect: GeckoInspect | null, t: number): void {
  if (inspect === null) return
  inspect.emergencyUnconfirmed.add(t)
}

// ---- A fill ----

// A text frame's break scan, `r`, over tLength characters from tOffset. An emergency break after a hyphen exists where
// SetupClusterBoundaries saw an alphanumeric, the hyphen and the next alphanumeric in one shaped word (gfxFont.cpp:741-753),
// and InitScriptRun shapes words per font range (gfxTextRun.cpp:2930-3000), so fallback between them removes it. Canvas totals
// don't show font ranges; the coverage facts do, and only a break they couldn't settle is reported (prepare.ts step 4).
export function emergencyHyphenBreak(sink: GapSink, p: GeckoPrepared, run: number, wordCanWrap: boolean, r: Measured, tOffset: number, tLength: number): void {
  if (sink === null) return
  if (r.charsFit < tLength && r.breakPriority === WORD_WRAP_BREAK && !wordCanWrap && p.breakFlags[tOffset + r.charsFit] === BREAK_EMERGENCY_WRAP &&
    p.inspect!.emergencyUnconfirmed.has(tOffset + r.charsFit)) {
    sink.push({ gap: 'font-fallback', run, detail: `offset ${p.tSource[tOffset + r.charsFit]}: the emergency break after a hyphen needs the hyphen and the letters around it in one font range, which Canvas can't show (gfxFont.cpp:741-753, gfxTextRun.cpp:2930-3000)` })
  }
}

// Why a tab's width is a stand-in (lines.ts computeTabs): an earlier text frame of the line measures under a condition of
// its whole text run, or the position the tab counts from rests on an in-word stand-in.
export type TabReason =
  | { kind: 'earlier-frame'; under: NonNullable<GeckoTextRun['advancesStandIn']> }
  | { kind: 'in-word'; reason: InWordReason }

// The condition under which the inline position after the line's placed frames is a stand-in, or null: a text frame whose
// Canvas widths all are (GeckoTextRun.advancesStandIn), whose measured start or end is an in-word stand-in, or that holds a
// stand-in tab.
export function placedStandIn(sink: GapSink, p: GeckoPrepared, m: Measurer, psd: SpanData): TabReason | null {
  if (sink === null) return null
  for (let k = 0; k < psd.frames.length; k++) {
    const pf = psd.frames[k]!
    if (pf.kind === 'span') {
      const inner = placedStandIn(sink, p, m, pf.span)
      if (inner !== null) return inner
    }
    if (pf.kind !== 'text' || pf.r.prov === null) continue
    const prov = pf.r.prov
    if (prov.run.advancesStandIn !== null) return { kind: 'earlier-frame', under: prov.run.advancesStandIn }
    const tab = prov.tabStandIn.values().next()
    if (tab.done !== true) return tab.value
    const reason = advanceBefore(p, m, prov.run, prov.startT).standIn ?? advanceBefore(p, m, prov.run, pf.r.tEnd).standIn
    if (reason !== null) return { kind: 'in-word', reason }
  }
  return null
}

// A tab counts from `first`, the first cluster start the scan counts before it: `standIn` as it stands, or the stand-in
// that position is.
export function tabCountsFrom(sink: GapSink, standIn: TabReason | null, p: GeckoPrepared, m: Measurer, run: GeckoTextRun, first: number): TabReason | null {
  if (sink === null || standIn !== null) return standIn
  const reason = advanceBefore(p, m, run, first).standIn
  return reason === null ? null : { kind: 'in-word', reason }
}

// ---- A decided line ----

function inWordDetail(r: InWordReason): string {
  switch (r.kind) {
    case 'inside-cluster':
      return `offset ${r.at} inside a grapheme cluster: the DOM divides the cluster's advance by its glyph records and ligature groups, which Canvas can't show (gfxHarfBuzzShaper.cpp:1705-1786, gfxTextRun.cpp:238-322)` +
        (r.betweenMarks ? '; between two marks, a ligature of them with a negative advance makes the part before the cut 2^32 au wider and its frame nscoord_MAX (unsigned division, gfxTextRun.cpp:249-289; probes gecko-port F18, F20)' : '')
    case 'mark-starts-cluster': return `offset ${r.at} before a mark that starts a cluster: alone it shapes as a broken syllable with a dotted circle, not as in the unit (hb-ot-shaper-syllabic.cc:32-99)`
    case 'unit-starts-inside-cluster': return `offset ${r.at}: the unit starts inside a cluster, where Canvas can't count its ligature groups (gfxTextRun.cpp:238-322)`
    case 'group-mark-advances': return `offset ${r.at} inside a ligature group whose marks have advances of their own, which go to the part holding them (gfxTextRun.cpp:238-322)`
    case 'inside-ligature-row': return `offset ${r.at} inside one of several ligatures in a row, which Canvas tests pair by pair and the unit's shaping takes from its start (hb-ot-layout.cc:1917-1945)`
    case 'between-ligatures': return `offset ${r.at} between ligatures in a row, which Canvas tests pair by pair and the unit's shaping takes from its start (hb-ot-layout.cc:1917-1945)`
    case 'group-ends': return `offset ${r.at} inside a ligature group whose ends Canvas can't confirm: ${inWordDetail(r.end)}`
    case 'sides': {
      let sides: string
      switch (r.sides) {
        case 'joined': sides = `letters join across it, and W(prefix U+200D) + W(U+200D suffix) = ${r.au} au`; break
        case 'apart': sides = `W(prefix) + W(suffix) = ${r.au} au`; break
        case 'cluster': sides = `W(cluster before it and suffix) − W(suffix) − W(cluster) = ${r.au} au`; break
      }
      return `offset ${r.at}: ${sides}, W(unit) = ${r.unitAu} au`
    }
  }
}

function tabGapOf(r: TabReason): { gap: GapName; detail: string } {
  switch (r.kind) {
    case 'earlier-frame': return { gap: r.under, detail: `an earlier text frame of the line measures under ${r.under}` }
    case 'in-word': return { gap: 'in-word-prefix', detail: inWordDetail(r.reason) }
  }
}

// The text run holding transformed index t.
function textRunAt(p: GeckoPrepared, t: number): GeckoTextRun | null {
  for (let r = 0; r < p.textRuns.length; r++) {
    const run = p.textRuns[r]!
    if (t >= run.tStart && t < run.tEnd) return run
  }
  return null
}

// The gaps of a decided line: those its fill raised, then the in-word report, then its stand-in tabs. `frames` is the
// line's geometry (inspect.ts), `texts` its placed text frames in logical order, and `lastT` the transformed index after
// its last kept character (pieces.ts lineEndT).
export function lineGaps(p: GeckoPrepared, m: Measurer, start: GeckoLineStart, raised: GeckoLineInspect, frames: GeckoFrameGeometry[], texts: PlacedText[], lastT: number): Gap[] {
  const gaps = raised.gaps.slice()
  // in-word-prefix: the stand-in positions this line rests on. Its width is the advance between its two edges, and its break
  // is the last candidate that fit, which the first one that didn't ended (BreakAndMeasureText, gfxTextRun.cpp:1100-1180):
  // the offset the line starts at, the one it ends at, and the first one the passes consulted past its end. The characters
  // of a unit the line cuts take their advances from the positions inside the part it holds, so those count too; a unit the
  // line holds whole takes its width from its own total, unless a text frame of the line starts or ends inside it: every
  // frame measures its own range (nsTextFrame::ReflowText), so those positions count as well.
  {
    const startT = start.contentOffset < p.nextT.length ? p.nextT[start.contentOffset]! : -1
    const report = new Map<number, InWordReason>()
    const partOf = (from: number, to: number): void => {
      // Stand-in positions in [from, to], both inside one unit.
      const run = textRunAt(p, Math.min(from, p.tUnits.length - 1))
      if (run === null) return
      for (let t = from; t <= to && t < p.tUnits.length; t++) {
        // A position inside a cluster counts only where it is asked for by itself: a frame's edge, or one a skipped
        // character exposes. Elsewhere points snap to the cluster's start.
        if (p.clusterStart[t] === 0 && from !== to) continue
        const standIn = advanceBefore(p, m, run, t).standIn
        if (standIn !== null) report.set(p.tSource[t]!, standIn)
      }
    }
    if (startT >= 0 && startT < p.tUnits.length && lastT > startT) {
      const first = p.units[p.unitOf[startT]!]!
      if (first.kind === 'word' && first.tStart < startT) partOf(startT, Math.min(first.tEnd, lastT) - (first.tEnd <= lastT ? 1 : 0))
      const last = lastT < p.tUnits.length ? p.units[p.unitOf[lastT]!]! : null
      if (last !== null && last.kind === 'word' && last.tStart < lastT) partOf(Math.max(last.tStart + 1, startT), lastT)
    }
    for (let k = 0; k < frames.length; k++) {
      const f = frames[k]!
      if (f.kind !== 'text' || f.characters.length === 0) continue
      const from = p.nextT[f.measuredStart]!
      const to = p.nextT[f.contentEnd]!
      if (from < p.tUnits.length) partOf(from, from)
      if (to < p.tUnits.length && to > from) partOf(to, to)
      // A position inside a cluster shows only behind a skipped character: a point snaps back to its cluster's start, but
      // not across a character TransformText removed (FindClusterStart, nsTextFrame.cpp:3549-3560, :8683-8689).
      let skippedInCluster = false
      for (let c = 0; c < f.characters.length; c++) {
        const ch = f.characters[c]!
        if (ch.skipped) skippedInCluster = true
        else if (ch.clusterStart) skippedInCluster = false
        else if (skippedInCluster && ch.standInBefore) partOf(p.sourceT[f.measuredStart + c]!, p.sourceT[f.measuredStart + c]!)
      }
    }
    // The first offset past the line's end among those the fill's passes consulted, the dropped pass of a redo included.
    const endS = lastT >= 0 && lastT < p.tUnits.length ? p.tSource[lastT]! : -1
    let pastT = -1
    for (let k = 0; k < raised.consulted.length; k++) {
      const t = raised.consulted[k]!
      if (p.tSource[t]! > endS && endS >= 0 && (pastT === -1 || t < pastT)) pastT = t
    }
    if (pastT !== -1) report.set(p.tSource[pastT]!, advanceBefore(p, m, textRunAt(p, pastT)!, pastT).standIn!)
    const offsets = [...report.keys()].sort((a, b) => a - b)
    for (let k = 0; k < offsets.length; k++) {
      const s = offsets[k]!
      gaps.push({ gap: 'in-word-prefix', run: p.frames[frameOfSource(p.frames, s)]!.run, detail: inWordDetail(report.get(s)!), at: { start: s, end: s } })
    }
  }
  // The line's tabs whose width is a stand-in (computeTabs), each under the condition its position rests on.
  for (let k = 0; k < texts.length; k++) {
    const r = texts[k]!.r
    if (r.prov === null) continue
    for (const [t, reason] of r.prov.tabStandIn) {
      if (t >= r.tEnd) continue
      const s = p.tSource[t]!
      const under = tabGapOf(reason)
      gaps.push({ gap: under.gap, run: p.frames[r.frame]!.run, detail: `the tab at offset ${s} is the next stop less the position before it, which counts from the block's origin (CalcTabWidths, nsTextFrame.cpp:4306-4378) over a stand-in: ${under.detail}`, at: { start: s, end: s + 1 } })
    }
  }
  return gaps
}
