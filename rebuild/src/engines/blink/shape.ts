// Widths from Canvas for Blink's shape results (specs/blink-lines.md §1.3-§1.4, §3, §6, §11, §12; specs/blink-gaps.md
// §3; DESIGN.md §4.4).
//
// The DOM shapes a shaping group in one HarfBuzz call per script segment and fallback font (inline_node.cc:1636-1717,
// harfbuzz_shaper.cc:880-1101). Canvas splits a string into words at U+0020, TAB and ZWSP and shapes each alone
// (plain_text_node.cc:84-155), so measured strings carry U+2028 in place of U+0020: Blink maps U+2028 to the space glyph
// (harfbuzz_face.cc:110-113) and Canvas doesn't split there (specs/blink-gaps.md §3.3). Word spacing is added in 16.16
// integers; letter spacing is the context's.
//
// A group's advances come from one Canvas call while the total is below 256 zoomed px, where Canvas totals are exact 16.16
// values (blink-canvas §1.5). A wider group is halved at an offset the pair test calls safe (blink-gaps §3.6 L4). The
// paragraph position of an offset k inside a piece is the piece prefix measured alone plus the adjustment HarfBuzz made
// between the clusters on both sides of k, d = R(xy) − R(x) − R(y), the part the glyph before k carries: all of it as GPOS
// first-glyph pair values put it, or d >> 1 where the kern and kerx pair machine applies it (blink-gaps §3.4-§3.5,
// FontFacts.pairKerning; unsafe-to-break at line edges where the fact isn't given).
//
// Every shaping call carries up to 5 code points of text_content on each side as context
// (case_mapping_harfbuzz_buffer_filler.cc:32-43, hb-buffer.hh:109-111), and Arabic joining reads it
// (hb-ot-shaper-arabic.cc:305-372). Canvas has no context. Inside a call the letters on both sides of a measured edge are
// joined, so the measured range gets U+200D on that side. At a call's own edge they join only in fonts that read the
// context: OpenType fonts do, `morx` fonts never do (hb-ot-shape.cc:60-66, 100-101; probe blink-followups F1: Amiri keeps
// joined forms on one-letter lines, Geeza Pro doesn't). Canvas can't tell the two apart, so the font declaration says
// which (FontFacts.joining); when it doesn't, the edge is measured as an AAT font gives it and the layout reports
// joining-technology there.
import { width as canvasWidth } from '../../measure/canvas.js'
import { graphemeBoundaries } from '../../unicode/grapheme.js'
import { collapsesWhiteSpace } from './content.js'
import { NO_LIGATURES_SPACING_PX, raw16Of, styleContexts } from './contexts.js'
import { blinkGraphemeRules } from './data.js'
import { isSegmentEdge } from './emoji.js'
import { floatSum, hanKerningEndUnknown, hanKerningTrim, hyphenGlyph, measuredRange, tabStops, uncutCluster, unsafeCut, viewEdges, type GapSink, type UnknownRun } from './gaps.js'
import { hanKerningFontData, hanKerningMayApply, resolvedCharType, shouldKern, shouldKernLast, trim16 } from './hankerning.js'
import { LIGATURE_MERGED, listedFontCovers } from './ligatures.js'
import {
  HAN_CLOSE, HAN_OPEN, USCRIPT_COMMON, USCRIPT_INHERITED, USCRIPT_LATIN, isCjkIdeographOrSymbol, isCjkIdeographOrSymbolBase, isCursiveScript,
  isDefaultIgnorable, isEmojiComponent, isExtendedPictographic, isMark, isMarkOrModifier, isWhiteSpace, joiningType, scriptOf,
} from './props.js'
import { scriptsPerUnit } from './script.js'
import type { BlinkPrepared, ComputedStyle, InlineItem, StyleContexts } from './types.js'

const f32 = Math.fround
// Float32 holds every 16.16 integer below 2^24, 256 px.
export const EXACT16 = 0x1000000

// LayoutUnit::FromFloatCeil (layout_unit.h:134-136).
export function luCeil(f: number): number {
  return Math.ceil(f32(f32(f) * 64))
}

// LayoutUnit(float), truncating (layout_unit.h:125-130).
export function luTrunc(f: number): number {
  return Math.trunc(f32(f32(f) * 64))
}

// InlineLayoutUnit::ToCeil<LayoutUnit>: 16.16 to 1/64, ceiling (layout_unit.h:231-241).
export function ceilFrom16(raw16: number): number {
  return Math.ceil(raw16 / 1024)
}

// TextRunLayoutUnit(float): saturated_cast<int32>(v * 65536), truncating (layout_unit.h:98-100).
function raw16Trunc(px: number): number {
  return Math.trunc(f32(f32(px) * 65536))
}

// ShapeResult::width_ after position data: the float of the exact 16.16 total (shape_result.cc:2230).
export function widthOf16(raw16: number): number {
  return f32(raw16 / 65536)
}

// What measuring needs: the prepared paragraph, whose styles hold their Canvas contexts, and where gaps go (gaps.ts
// GapSink: the paragraph's in prepare, a line's while that line is filled or inspected, null on a paragraph prepared plain).
export type Shaper = {
  p: BlinkPrepared
  gaps: GapSink
}

// The contexts a string of a style is measured on, by the string's storage. Chrome keeps the strings and the words a
// canvas shaped under their characters and direction, whatever their storage (frame_shape_cache.cc:45-65, 135-149;
// plain_text_node.cc:400-412), so a canvas answers a one-byte and a two-byte string of the same characters with whichever
// it shaped first, in either order (probe blink-storage S3). A segmented paragraph asks both kinds (canvasString), and a
// word Canvas cuts from a two-byte string before a CJK character can be Latin-1-only too, so there the one-byte strings
// have contexts of their own, made when the first one is asked: no canvas holds both kinds, and the order of the
// questions can't change an answer. An unsegmented paragraph needs one set: its strings are two-byte by their characters
// alone, and Canvas cuts no words from them (they hold no U+0020, TAB, U+FFFC or CJK character: text_content is Latin-1
// but for atomic inlines, where a shaping group ends), so every two-byte string and word holds a unit above U+00FF.
// rule blink/measure/contexts-per-storage
export function contextsOf(p: BlinkPrepared, style: number, twoByte: boolean): StyleContexts {
  const st = p.styles[style]!
  if (twoByte || !p.segmented) return st.contexts
  return st.oneByteContexts ??= styleContexts(p.canvases, st, p.layoutZoom, '8bit')
}

// Joining_Type D, L or C joins the following character; D, R or C the preceding one; T is transparent.
function joinsFollowing(jt: number): boolean { return jt === 1 || jt === 3 || jt === 4 }
function joinsPreceding(jt: number): boolean { return jt === 1 || jt === 2 || jt === 4 }

// hb_unicode_funcs_t::is_default_ignorable (hb-unicode.hh:170-197 at harfbuzz dfdc088c): HarfBuzz's own switch, which
// leaves out the Hangul fillers, the shorthand format controls and U+180F that Unicode's property has. Blink's
// Character::IsDefaultIgnorable reads ICU's property instead (props.ts isDefaultIgnorable).
export function isDefaultIgnorableHarfBuzz(cp: number): boolean {
  switch (cp >> 16) {
    case 0:
      switch (cp >> 8) {
        case 0x00: return cp === 0xad
        case 0x03: return cp === 0x34f
        case 0x06: return cp === 0x61c
        case 0x17: return cp >= 0x17b4 && cp <= 0x17b5
        case 0x18: return cp >= 0x180b && cp <= 0x180e
        case 0x20: return (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f)
        case 0xfe: return (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff
        case 0xff: return cp >= 0xfff0 && cp <= 0xfff8
        default: return false
      }
    case 0x01: return cp >= 0x1d173 && cp <= 0x1d17a
    case 0x0e: return cp >= 0xe0000 && cp <= 0xe0fff
    default: return false
  }
}

// Character::TreatAsSpace (character.h:156-159).
function treatAsSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0xa0
}

// Character::TreatAsZeroWidthSpace (character.h:160-189): FF, CR, U+FFFC, ZWNJ, ZWJ and Character::IsDefaultIgnorable.
function treatAsZeroWidthSpace(c: number): boolean {
  return c === 0x0c || c === 0x0d || c === 0xfffc || c === 0x200c || c === 0x200d || isDefaultIgnorable(c)
}

// Whether [from, to) holds no glyph that every lookup stops at: only default-ignorable characters, which every lookup
// skips (may_skip, hb-ot-layout-gsubgpos.hh:558-571 at harfbuzz dfdc088c), and marks, which a lookup skips where its flag
// says IgnoreMarks (check_glyph_property, :561-562) and the kern and kerx pair machine always does (hb-kern.hh:58).
function holdsNoBase(p: BlinkPrepared, from: number, to: number): boolean {
  for (let i = from; i < to;) {
    const cp = p.text.codePointAt(i)!
    if (!isDefaultIgnorableHarfBuzz(cp) && !isMark(cp)) return false
    i += cp > 0xffff ? 2 : 1
  }
  return true
}

// Whether a range measured as part of a shaping call over [callStart, callEnd) of group g gets U+200D at its edge k,
// where the text on the other side joins: inside the call the letters are joined; at the call's own edge only when the
// font reads HarfBuzz's context (FontFacts.joining 'opentype'). Where the fact isn't given the edge decides a width, and
// the measurement reports it (gaps.ts measuredRange).
function joinedAtEdge(p: BlinkPrepared, g: number, k: number, callStart: number, callEnd: number): boolean {
  if (k > callStart && k < callEnd) return joinsAcross(p, k, callStart, callEnd)
  switch (p.styles[p.groups[g]!.style]!.font.facts.joining) {
    case 'opentype': return joinsAcross(p, k, callStart, callEnd)
    case 'aat': case null: return false
  }
}

// Whether HarfBuzz's Arabic shaper joins the letters on both sides of offset k in a call over [lo, hi): the nearest
// non-transparent character before k joins the following one and the nearest after k the preceding one
// (hb-ot-shaper-arabic.cc:305-372). Characters outside [lo, hi) are context, at most 5 code points on each side.
export function joinsAcross(p: BlinkPrepared, k: number, lo: number, hi: number): boolean {
  const text = p.text
  let before = 0
  for (let i = k, context = 0; i > 0;) {
    const low = text.charCodeAt(i - 1)
    const size = (low & 0xfc00) === 0xdc00 && i >= 2 && (text.charCodeAt(i - 2) & 0xfc00) === 0xd800 ? 2 : 1
    i -= size
    if (i < lo && ++context > 5) break
    const jt = joiningType(text.codePointAt(i)!)
    if (jt !== 5) {
      before = jt
      break
    }
  }
  if (!joinsFollowing(before)) return false
  for (let j = k, context = 0; j < text.length;) {
    const cp = text.codePointAt(j)!
    if (j >= hi && ++context > 5) break
    j += cp > 0xffff ? 2 : 1
    const jt = joiningType(cp)
    if (jt !== 5) return joinsPreceding(jt)
  }
  return false
}

// The string Canvas measures for text_content[from, to), with each code unit's text_content offset (-1 for added context).
// Canvas turns U+0009..U+000D into spaces (plain_text_node.cc:49-50) and SHY into ZWSP, which splits a word (:84-113): so
// U+0020 becomes U+2028, VT and FF become U+0001, which takes the same fallback font (blink-gaps §2.8), and SHY is left out
// (gap soft-hyphen-shaping). CR in collapse modes is already a space, and CR and FF in preserve modes are control items.
//
// Canvas shapes an 8-bit string as one Latin segment and runs RunSegmenter over a 16-bit one (harfbuzz_shaper.cc:1072-1101),
// and Blink keys storage on V8's representation (to_blink_string.cc:216-227). A paragraph that RunSegmenter segments asks
// for 16-bit strings. A string holding a code unit above U+00FF is 16-bit as String.fromCharCode builds it. A Latin-1-only
// string can be made 16-bit only as a slice of 13 code units or more of a 16-bit string: String.prototype.slice copies a
// shorter substring into a one-byte string whenever its units fit, and returns single characters from the one-byte table
// (v8 string-slice.tq:8-33; builtins-string-gen.cc:2154 SubString, AllocAndCopyStringCharacters; SlicedString::kMinLength
// 13, string.h:1181; at Chrome 153's V8 6b96683d). Such a string is measured 8-bit.
//
// The default-ignorable characters Canvas turns into U+200B end a Canvas word (TreatAsZeroWidthSpaceInComplexScriptLegacy,
// character.h:167-175; plain_text_node.cc:47-62, 85-91): SHY, ZWSP, LRM, RLM, U+202A..U+202E and U+FEFF. The DOM keeps
// such a character in the shaping call. RunSegmenter's emoji scanner sees a non-emoji character there, so `👍` SHY `🏽`
// stays two segments (emoji_segmentation_category_inline_header.h:15-77); a combining mark after it starts another cluster;
// `morx` state machines see its glyph (hb-aat-layout-common.hh:1226-1241); HarfBuzz hides it only after substitution
// (hb-ot-shape.cc:951-959). U+2060 WORD JOINER has the same HarfBuzz properties (gc Cf, neither joiner nor hidden:
// hb-ot-layout.hh:212-244), script Common, emoji category kMaxCategory and bidi class BN, and Canvas doesn't normalize it,
// so the string carries U+2060 instead (probe blink-ignorables: emoji sequences, Geeza Pro and Amiri joining, Thai marks,
// kerning and letter spacing all equal the DOM). In an 8-bit paragraph the DOM shapes one Latin segment without RunSegmenter
// (inline_node.cc:1256-1290), which U+2060 would turn into a 16-bit string that Canvas segments, so there the character is
// left out and the string stays 8-bit; a `morx` substitution across it can still differ (gap soft-hyphen-shaping). In a
// segmented paragraph the string carries U+2060 whatever its length: probe blink-followups-20260917 gives RLM `((` in
// Amiri 2814 units in the DOM and with U+2060, against 1567 with the RLM left out. The 1567 an earlier probe saw came from
// the brackets resolving to the following Latin run's script, which script-context names.
//
// `keepSpaces`: U+0020 stays U+0020, so a Latin-1-only string stays 8-bit (measure16 spacesStay).
//
// `domScript` is the script the paragraph shapes [from, to) with (measure16 splits ranges at script edges). A Latin range
// stays an 8-bit string whatever its length, since Canvas shapes an 8-bit string as one Latin segment exactly as the DOM
// shapes a Latin segment; only a range under another script is sliced into a 16-bit string, so RunSegmenter resolves its
// characters as the paragraph does.
export type CanvasString = { s: string; units: Int32Array; twoByte: boolean; leftOut: boolean }

export function canvasString(p: BlinkPrepared, from: number, to: number, zwjBefore: boolean, zwjAfter: boolean, domScript: number, keepSpaces: boolean = false): CanvasString {
  let codes: number[] = []
  let units: number[] = []
  if (zwjBefore) { codes.push(0x200d); units.push(-1) }
  let wide = zwjBefore || zwjAfter
  const substituted: number[] = []
  for (let i = from; i < to; i++) {
    const c = p.text.charCodeAt(i)
    switch (c) {
      case 0xad: case 0x200b: case 0x200e: case 0x200f: case 0x202a: case 0x202b: case 0x202c: case 0x202d: case 0x202e: case 0xfeff:
        substituted.push(codes.length); codes.push(0x2060); break
      case 0x20: if (keepSpaces) codes.push(0x20); else { codes.push(0x2028); wide = true } break
      case 0x0b: case 0x0c: codes.push(0x0001); break
      default: codes.push(c); if (c > 0xff) wide = true
    }
    units.push(i)
  }
  if (zwjAfter) { codes.push(0x200d); units.push(-1) }
  // Whether the string keeps its default-ignorable characters as U+2060, which makes it 16-bit: in a segmented paragraph.
  const keeps = wide || p.segmented
  const leftOut = !keeps && substituted.length > 0
  if (leftOut) {
    const keptCodes: number[] = []
    const keptUnits: number[] = []
    for (let i = 0, next = 0; i < codes.length; i++) {
      if (next < substituted.length && substituted[next] === i) { next++; continue }
      keptCodes.push(codes[i]!)
      keptUnits.push(units[i]!)
    }
    codes = keptCodes
    units = keptUnits
  }
  let s = ''
  for (let i = 0; i < codes.length; i += 4096) s += String.fromCharCode(...codes.slice(i, i + 4096))
  // A segmented paragraph's Latin-1-only string is 16-bit when V8 slices it, from 13 code units on; a Latin range keeps the
  // one Latin segment of an 8-bit string. A shorter range the paragraph shapes under another script gets U+2060 before it,
  // which makes the string 16-bit without a glyph or a script (the ignorables probe above: U+2060 alone measures 0, and
  // U+2060 `((` gives Amiri's DOM width where the 8-bit `((` shapes as Latin), so RunSegmenter resolves it as Common.
  const nonLatin = keeps && !wide && substituted.length === 0 && domScript !== USCRIPT_LATIN
  const forced = nonLatin && codes.length >= 13
  const prefixed = nonLatin && !forced && codes.length > 0
  const twoByte = wide || (keeps && substituted.length > 0) || forced || prefixed
  if (prefixed) return { s: '\u2060' + s, units: Int32Array.from([-1, ...units]), twoByte, leftOut }
  return { s: forced ? ('Ā' + s).slice(1) : s, units: Int32Array.from(units), twoByte, leftOut }
}

// IsWordDelimiter<true> over the string as NormalizeSpacesAndMaybeBidi leaves it (plain_text_node.cc:26-91): U+0020, TAB and
// U+200B, with U+0009..U+000D turned into spaces and FF, CR, SHY, LRM, RLM, U+202A..U+202E, U+FEFF and U+FFFC into U+200B.
// Of these a Canvas string of the port holds U+FFFC alone (canvasString replaces the others).
function isCanvasWordDelimiter(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xad || c === 0x200b || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) ||
    c === 0xfeff || c === 0xfffc
}

// Character::IsCommonOrInheritedScript (character.cc:283-288).
function isCommonOrInheritedScript(cp: number): boolean {
  const script = scriptOf(cp)
  return script === USCRIPT_COMMON || script === USCRIPT_INHERITED
}

// NextWordEndIndex for a 16-bit string (plain_text_node.cc:93-155): a word ends at a delimiter and before a CJK ideograph or
// symbol base; a word that starts with a CJK ideograph or symbol is that character with the modifiers, joiners, emoji
// components and pictographs after it, the Common and Inherited CJK symbols after it, and the first CJK character with a
// script when the word had none yet.
function canvasWordEnd(s: string, start: number): number {
  const length = s.length
  if (start + 1 === length || isCanvasWordDelimiter(s.charCodeAt(start))) return start + 1
  let end = start
  let ch = s.codePointAt(end)!
  end += ch > 0xffff ? 2 : 1
  if (!isCjkIdeographOrSymbol(ch)) {
    for (let next = end; end < length; end = next) {
      ch = s.codePointAt(next)!
      next += ch > 0xffff ? 2 : 1
      if (isCanvasWordDelimiter(ch) || isCjkIdeographOrSymbolBase(ch)) return end
    }
    return length
  }
  let hasAnyScript = !isCommonOrInheritedScript(ch)
  for (let next = end; end < length; end = next) {
    ch = s.codePointAt(next)!
    next += ch > 0xffff ? 2 : 1
    if (isMarkOrModifier(ch) || ch === 0x200d || isEmojiComponent(ch) || isExtendedPictographic(ch)) continue
    if (isCjkIdeographOrSymbol(ch)) {
      if (isCommonOrInheritedScript(ch)) continue
      if (!hasAnyScript) {
        hasAnyScript = true
        continue
      }
    }
    return end
  }
  return length
}

// Whether Canvas shapes this style's strings word by word (Font::CanShapeWordByWord, font_fallback_list.cc:264-286): with
// the contexts' optimizeLegibility, unless the primary font's GPOS or GSUB lookups cover the space glyph
// (HarfBuzzFace::HasSpaceInLigaturesOrKerning, harfbuzz_face.cc:341-390). Canvas shows it: between two Arabic letters U+3000
// is a word of its own under the Common script, which takes letter spacing, where a string shaped whole keeps it in the
// Arabic run, which takes none on it (ShapeResultSpacing::ComputeSpacing, shape_result_spacing.cc:103-139). The two
// contexts differ by 1/64 px of letter spacing, so the widths differ by that or by nothing. The direction is the contexts'
// LTR; the three characters are one RTL bidi run in either (U+3000 is WS between two AL).
function canvasSplitsWords(p: BlinkPrepared, style: number): boolean {
  const st = p.styles[style]!
  const probe = '\u0628\u3000\u0628'
  return st.canvasSplitsWords ??= canvasWidth(st.contexts.ltrNoLigatures, probe) - canvasWidth(st.contexts.hyphen, probe) > NO_LIGATURES_SPACING_PX / 2
}

// The script Canvas shapes every code unit of a 16-bit Canvas string under: RunSegmenter runs over each PlainTextItem alone
// (HarfBuzzShaper(item.text_), plain_text_node.cc:400-425; harfbuzz_shaper.cc:1080-1101), and SegmentWord makes an item of
// every word unless the font can't be shaped word by word (:372-398). So U+3000 between Arabic letters is Common in Canvas,
// where the paragraph keeps it in the Arabic run (probe critic-r2 blink-u3000: 10px of letter spacing adds 10px per U+3000
// in Canvas and nothing in the DOM).
export function canvasScriptsPerUnit(p: BlinkPrepared, style: number, s: string): Uint8Array {
  let splitPoint = false
  for (let i = 0; i < s.length && !splitPoint;) {
    const cp = s.codePointAt(i)!
    if (cp >= 0x2c7 && (isCanvasWordDelimiter(cp) || isCjkIdeographOrSymbol(cp))) splitPoint = true
    i += cp > 0xffff ? 2 : 1
  }
  if (!splitPoint || !canvasSplitsWords(p, style)) return scriptsPerUnit(s)
  const scripts = new Uint8Array(s.length)
  for (let start = 0; start < s.length;) {
    const end = canvasWordEnd(s, start)
    scripts.set(scriptsPerUnit(s.slice(start, end)), start)
    start = end
  }
  return scripts
}

// Whether a range is measured with its spaces as U+0020 in an 8-bit string instead of U+2028 in a 16-bit one: a range the
// paragraph shapes as Latin that holds a space, a character other than white space, no soft hyphen, and no character with
// a script of its own, in a font Canvas shapes whole. U+2028 makes the string 16-bit, RunSegmenter then resolves every
// character of such a range as Common over the string alone (script_run_iterator.cc), and a font with other lookups for
// Common and Latin shapes it otherwise than the paragraph's Latin segment does (script-context). Where Canvas doesn't cut
// the font's text into words, the 8-bit string with its spaces is one item shaped as one Latin segment
// (plain_text_node.cc:381-385, harfbuzz_shaper.cc:1072-1077): the paragraph's own characters, script, font and direction.
// A font shaped word by word keeps U+2028, since U+0020 would cut the string there (plain_text_node.cc:387-399), and
// script-context with it. With a letter in the range RunSegmenter gives Latin either way, and white space alone is no
// script's (gaps.ts hasScriptNeutral).
// rule blink/measure/spaces-stay-in-neutral-latin-range
function spacesStay(p: BlinkPrepared, style: number, from: number, to: number): boolean {
  if (p.scripts[from] !== USCRIPT_LATIN) return false
  let space = false
  let other = false
  for (let i = from; i < to; i++) {
    const c = p.text.charCodeAt(i)
    if (c > 0xff || c === 0xad) return false
    if (c === 0x20) space = true
    else if (!isCommonOrInheritedScript(c)) return false
    else if (!isWhiteSpace(c)) other = true
  }
  return space && other && !canvasSplitsWords(p, style)
}

// Math.round(W × 65536) of text_content[from, to) of group g, measured as part of a shaping call over [callStart,
// callEnd), in its context, with JS word spacing and the letter spacing Canvas gives other characters than the DOM does.
export function measure16(sh: Shaper, g: number, from: number, to: number, callStart: number, callEnd: number, noLigatures: boolean = false): number {
  const p = sh.p
  if (from >= to) return 0
  // RunSegmenter splits a 16-bit paragraph at script runs, and HarfBuzzShaper shapes every segment in its own call
  // (harfbuzz_shaper.cc:1072-1101), so nothing kerns or ligates across a script edge. A range crossing one is measured per
  // segment (research/SUPERSET-blink.md §2.1 C).
  if (p.segmented) {
    for (let k = from + 1; k < to; k++) {
      if (p.scripts[k] !== p.scripts[k - 1] && (p.text.charCodeAt(k) & 0xfc00) !== 0xdc00) {
        return measure16(sh, g, from, k, callStart, callEnd, noLigatures) + measure16(sh, g, k, to, callStart, callEnd, noLigatures)
      }
    }
  }
  const group = p.groups[g]!
  const cs = canvasString(p, from, to, joinedAtEdge(p, g, from, callStart, callEnd), joinedAtEdge(p, g, to, callStart, callEnd), p.scripts[from]!, spacesStay(p, group.style, from, to))
  const contexts = contextsOf(p, group.style, cs.twoByte)
  const context = noLigatures ? (group.rtl ? contexts.rtlNoLigatures : contexts.ltrNoLigatures) : (group.rtl ? contexts.rtl : contexts.ltr)
  const w = cs.s.length === 0 ? 0 : raw16Of(contexts, context, cs.s)
  const st = p.styles[group.style]!
  const ls16 = st.letterSpacing === 0 ? 0 : raw16Trunc(f32(st.letterSpacing * p.layoutZoom))
  const adjust = wordSpacing16(p, group.style, from, to)
  // Under letter spacing the width reads the scripts Canvas shapes a 16-bit string under (letterSpacingDifference16); an
  // 8-bit string is a Latin range shaped as Latin on both sides.
  const scripts = cs.twoByte && ls16 !== 0 ? canvasScriptsPerUnit(p, group.style, cs.s) : null
  measuredRange(sh.gaps, p, g, from, to, callStart, callEnd, cs, scripts)
  if (ls16 === 0) return w + adjust
  return w + adjust + letterSpacingDifference16(p, cs, scripts, ls16)
}

// The letter spacing the DOM gives the string's characters less what Canvas gave them.
function letterSpacingDifference16(p: BlinkPrepared, cs: CanvasString, scripts: Uint8Array | null, ls16: number): number {
  let adjust = 0
  for (let u = 0; u < cs.units.length; u++) {
    const t = cs.units[u]!
    if (t < 0) continue
    const c = p.text.charCodeAt(t)
    if ((c & 0xfc00) === 0xdc00) continue
    const canvasScript = scripts === null ? USCRIPT_LATIN : scripts[u]!
    // ShapeResultSpacing::ComputeSpacing (shape_result_spacing.cc:103-139): letter spacing on a character that isn't a zero
    // width space, and in a cursive script run only on a space (IgnoreLetterSpacingInCursiveScripts, stable). The DOM reads
    // the paragraph's character and its segment's script; Canvas its own character (U+2028, U+0001, U+2060) and the script
    // its RunSegmenter gives the string, so a lone U+202F (Latin or Mongolian) loses its spacing in Canvas where the DOM's
    // Latin run keeps it (research/SUPERSET-blink.md §2.1 B).
    const cp = p.text.codePointAt(t)!
    const canvasCp = cs.s.codePointAt(u)!
    const dom = !treatAsZeroWidthSpace(cp) && (!isCursiveScript(p.scripts[t]!) || treatAsSpace(cp))
    const canvas = !treatAsZeroWidthSpace(canvasCp) && (!isCursiveScript(canvasScript) || treatAsSpace(canvasCp))
    if (dom !== canvas) adjust += dom ? ls16 : -ls16
  }
  return adjust
}

// Word spacing on U+0020, TAB, LF and NBSP, except at text_content index 0 unless NBSP or the block preserves spaces
// (shape_result_spacing.cc:103-139, specs/blink-text.md §2.E).
function wordSpacing16(p: BlinkPrepared, style: number, from: number, to: number): number {
  const ws = p.styles[style]!.wordSpacing
  if (ws === 0) return 0
  const raw = raw16Trunc(f32(ws * p.layoutZoom))
  // Word spacing at text_content index 0 (WordSpacingWhiteSpacePre, inline_node.cc:1561-1565).
  const anywhere = !collapsesWhiteSpace(p.paragraph.whiteSpace)
  let n = 0
  for (let i = from; i < to; i++) {
    const c = p.text.charCodeAt(i)
    if ((c === 0x20 || c === 0x09 || c === 0x0a || c === 0xa0) && (i !== 0 || c === 0xa0 || anywhere)) n++
  }
  return n * raw
}

// A font that lacks U+3000 gets it from HarfBuzz as the font's space glyph (the normalizer's space fallback,
// hb-ot-shape-normalize.cc:174-186 at harfbuzz dfdc088c), and Blink counts that glyph as missing unless the font is the last
// one to try: "HarfBuzz synthesizes U+3000 IDEOGRAPHIC SPACE using the space glyph. This is not desired for run-splitting"
// (HarfBuzzShaper::ExtractShapeResults, harfbuzz_shaper.cc:598-606). So the character goes to a fallback font, whose glyph
// has its own advance, while the clusters next to it keep what that pass gave them beside a space glyph: in Times New Roman
// `T` after U+3000 keeps the second glyph's part of the (space, T) kern, 18.5 units at 32 px, and U+3000 is one em
// (c-0ee8c36920378f9f). Canvas shapes the same way, so its totals hold the same advances.
//
// For offset k inside a shaping call, where U+3000 starts or ends: whether the pass that shaped the cluster on the other side
// of k drew U+3000 with its space glyph, by the coverage fact of the listed family that draws that cluster. 'start': U+3000
// starts at k and the cluster before k keeps the whole adjustment across k; 'end': U+3000 ends at k and the cluster after k
// keeps it. 'unknown' where the facts don't name that cluster's font; null where k isn't such an offset or the font maps
// U+3000 itself.
export function requeuedSpaceAt(p: BlinkPrepared, k: number, lo: number, hi: number): 'start' | 'end' | 'unknown' | null {
  if (k <= lo || k >= hi) return null
  const startsHere = p.text.charCodeAt(k) === 0x3000
  const endsHere = p.text.charCodeAt(k - 1) === 0x3000
  if (startsHere === endsHere) return null
  const neighbour = startsHere ? clusterStartAtOrBefore(p, k - 1, lo) : k
  const g = p.groupOfUnit[neighbour]!
  if (g < 0) return null
  const covered = listedFontCovers(p.styles[p.groups[g]!.style]!.font.facts.fonts, p.fontRun[neighbour]!, 0x3000)
  if (covered === null) return 'unknown'
  if (covered) return null
  return startsHere ? 'start' : 'end'
}

// Whether a HarfBuzz run starts at offset k by the declaration's coverage facts: every stretch one font draws is a run of its
// own (CommitGlyphs per slice, harfbuzz_shaper.cc:560-700), and a run's first glyph is safe to break before whatever
// HarfBuzz flagged (SafeToBreakBefore, shape_result.cc:1361-1369).
export function isFontRunEdge(p: BlinkPrepared, k: number, lo: number, hi: number): boolean {
  if (k <= lo || k >= hi || !isClusterBoundary(p, k)) return false
  const state = requeuedSpaceAt(p, k, lo, hi)
  if (state === 'start' || state === 'end') return true
  const before = p.fontRun[clusterStartAtOrBefore(p, k - 1, lo)]!
  const after = p.fontRun[k]!
  return before >= 0 && after >= 0 && before !== after
}

// A HarfBuzz glyph cluster starts at a unit that isn't a continuation (hb_form_clusters, hb-ot-shape.cc:578-586). Blink gives
// every character that isn't a cluster base the cluster's position and never marks it safe to break before
// (ShapeResult::ComputePositionData, shape_result.cc:2113-2200; CachedOffsetForPosition, :2261-2323). HarfBuzz marks a mark
// a continuation even after SHY, ZWSP or U+2060, where Unicode's grapheme rules put a boundary (research/SUPERSET-blink.md
// §2.1 A). Offsets inside a grapheme keep the grapheme's position as before. Beyond continuations, clusters merge where a
// font's lookups ligate or reorder glyphs (ligate_input, hb-ot-layout-gsubgpos.hh:1500-1510), which Canvas doesn't
// show: the Bengali conjunct `ক্য` is one grapheme (GB9c) and one cluster natively in Kohinoor Bangla (rule/clusters), while
// U+0600 before U+3000 is one grapheme (GB9b) and two clusters in Amiri (c-32e897f031fc55ea). Treating every
// non-continuation unit as a boundary (fix-r9) fixed the second and lost 8 of the first, so the grapheme stays the unit,
// and a position asked at another cluster start inside a grapheme reports glyph-clusters (startsClusterInsideGrapheme).
export function isClusterBoundary(p: BlinkPrepared, k: number): boolean {
  return p.graphemeStarts[k] === 1 && p.continuations[k] !== 1 && p.ligature[k] !== LIGATURE_MERGED
}

// Whether k is inside a grapheme at a unit HarfBuzz doesn't mark a continuation: whether glyphs there form one cluster or
// two depends on the font's lookups.
export function startsClusterInsideGrapheme(p: BlinkPrepared, k: number): boolean {
  return p.graphemeStarts[k] !== 1 && p.continuations[k] !== 1
}

export function clusterStartAtOrBefore(p: BlinkPrepared, k: number, min: number): number {
  while (k > min && !isClusterBoundary(p, k)) k--
  return k
}

function clusterEndAfter(p: BlinkPrepared, k: number, max: number): number {
  let e = k + 1
  while (e < max && !isClusterBoundary(p, e)) e++
  return e
}

// d at offset k inside a shaping call over [lo, hi) of group g: the adjustment between the clusters on both sides of k
// (the pair window).
// Each side is whole glyph clusters (isClusterBoundary): a mark after SHY, ZWSP or U+2060 starts a grapheme but continues
// the ignorable's HarfBuzz cluster (hb_form_clusters, hb-ot-shape.cc:578-586), and measured alone Canvas shapes it as a
// broken cluster the paragraph never has (c-01763358db8471a3: a kasra after SHY gave its neighbour a -2 px adjustment).
// HarfBuzz's lookups skip default-ignorable glyphs (hb-ot-layout-gsubgpos.hh:558-571), so a side that holds only
// default-ignorable characters (U+200B between two letters) reaches to the next cluster. So does a side that holds only
// such characters and marks (holdsNoBase): SHY and a kasra between two beh are one cluster of no advance, and the letters
// adjust each other across it as they do across the kasra alone (16px Noto Nastaliq Urdu at DPR 2: both strings measure
// 2,810,183 units, 174,063 less than the two beh measured apart). A window that ended at the kasra measured 0 there, so
// the whole difference fell on the last letter, the space of a wrapped line start at SHY was clamped at 0, and the kasra
// got a line of its own where natively it shares SHY's (c-3b9588a5730c17d8; probe blink-cr5 Z). Canvas says what the two
// sides change; which glyph carries it is pairBefore16's.
// `noLigatures` measures it through the no-ligature contexts: the adjustment without liga, clig and calt.
export function pairAdjust16(sh: Shaper, g: number, k: number, lo: number, hi: number, noLigatures: boolean = false): number {
  const p = sh.p
  if (k <= lo || k >= hi) return 0
  const kept = !noLigatures && keepsByOffset(sh, g, lo, hi) ? p.groups[g]!.pair16 : null
  if (kept !== null && !Number.isNaN(kept[k - lo]!)) return kept[k - lo]!
  let a = clusterStartAtOrBefore(p, k - 1, lo)
  while (a > lo && holdsNoBase(p, a, k)) a = clusterStartAtOrBefore(p, a - 1, lo)
  let b = clusterEndAfter(p, k, hi)
  while (b < hi && holdsNoBase(p, k, b)) b = clusterEndAfter(p, b, hi)
  const d = measure16(sh, g, a, b, lo, hi, noLigatures) - measure16(sh, g, a, k, lo, hi, noLigatures) - measure16(sh, g, k, b, lo, hi, noLigatures)
  if (kept !== null) kept[k - lo] = d
  return d
}

// Whether what a call over [lo, hi) of group g measures at an offset is kept by offset for every later read, at any width
// (BlinkGroup.prefix16, pair16, wide16). Two conditions:
// - the call is the group's own, the paragraph's shaping. An adjustment depends on the call's range as well as on the offset
//   (a reshape's windows stop at its edges and join there by other rules), and a reshape's range follows the line;
// - the read raises no gap: every read of a plain paragraph, and linePieces' on an inspected one. A read under a gap list
//   measures, because each measurement raises its range's gaps into the list of the line that reads (gaps.ts measuredRange),
//   and a value read back would leave them out of a list that doesn't have them yet.
function keepsByOffset(sh: Shaper, g: number, lo: number, hi: number): boolean {
  const group = sh.p.groups[g]!
  return sh.gaps === null && lo === group.start && hi === group.end
}

// The adjustment across offset k inside a shaping call over [lo, hi) of group g: what the text before k and the text after
// it change in each other's advances, W(window) − W(window before k) − W(window after k), over the widest window around k
// inside [from, to) whose Canvas total is exact (below 256 zoomed px). Lookups read contexts of any length
// (ChainContextFormat, hb-ot-layout-gsubgpos.hh), which a window of one cluster on each side misses: Noto Nastaliq Urdu
// widens a word-final letter before a space after some letters (probe blink-round3 R1: `آگ` and a space measure 468 units
// more together than apart, `گ` and a space measure the same; natively `گ` is 3436 units there and 2968 without the space).
// A window that is too wide shrinks on its longer side, by half its distance to k, and never below the cluster next to k.
// `whole` is the measured total of [from, to), which the caller has or measures.
function windowAdjust16(sh: Shaper, g: number, k: number, from: number, to: number, lo: number, hi: number, whole: number): number {
  const p = sh.p
  if (k <= from || k >= to) return 0
  let a = from
  let b = to
  let nearA = clusterStartAtOrBefore(p, k - 1, lo)
  while (nearA > from && holdsNoBase(p, nearA, k)) nearA = clusterStartAtOrBefore(p, nearA - 1, lo)
  let nearB = clusterEndAfter(p, k, hi)
  while (nearB < to && holdsNoBase(p, k, nearB)) nearB = clusterEndAfter(p, nearB, hi)
  nearA = Math.max(nearA, from)
  nearB = Math.min(nearB, to)
  while (whole >= EXACT16 && (a < nearA || b > nearB)) {
    if (a < nearA && (k - a >= b - k || b <= nearB)) {
      let next = clusterStartAtOrBefore(p, a + ((k - a + 1) >> 1), lo)
      if (next <= a) next = clusterEndAfter(p, a, hi)
      a = Math.min(nearA, next)
    } else {
      let next = clusterEndAfter(p, b - ((b - k + 1) >> 1) - 1, hi)
      if (next >= b) next = clusterStartAtOrBefore(p, b - 1, lo)
      b = Math.max(nearB, next)
    }
    whole = measure16(sh, g, a, b, lo, hi)
  }
  return whole - measure16(sh, g, a, k, lo, hi) - measure16(sh, g, k, b, lo, hi)
}

// windowAdjust16 for an offset the layout asks about: within the piece of the paragraph's group that holds k, or the two
// pieces around a cut; within a reshape, the call. Whatever it shows, the two sides shaped apart differ from the call, which
// is what HarfBuzz's unsafe-to-break flag means (hb-buffer.hh:517-527), so the safe test reads it. Nothing asks it of the
// group's own call before the group's cuts are made (measureGroups), so there it is a fact of the offset (keepsByOffset).
export function adjust16(sh: Shaper, g: number, k: number, lo: number, hi: number): number {
  if (k <= lo || k >= hi || !keepsByOffset(sh, g, lo, hi)) return measuredAdjust16(sh, g, k, lo, hi)
  const kept = sh.p.groups[g]!.wide16
  if (Number.isNaN(kept[k - lo]!)) kept[k - lo] = measuredAdjust16(sh, g, k, lo, hi)
  return kept[k - lo]!
}

function measuredAdjust16(sh: Shaper, g: number, k: number, lo: number, hi: number): number {
  const group = sh.p.groups[g]!
  if (k <= lo || k >= hi) return 0
  if (lo !== group.start || hi !== group.end || group.cuts.length <= 2) return windowAdjust16(sh, g, k, lo, hi, lo, hi, measure16(sh, g, lo, hi, lo, hi))
  const cuts = group.cuts
  let i = 0
  while (i + 1 < cuts.length && cuts[i + 1]! <= k) i++
  const from = cuts[i] === k ? cuts[i - 1]! : cuts[i]!
  const to = cuts[i + 1] ?? group.end
  return windowAdjust16(sh, g, k, from, to, lo, hi, measure16(sh, g, from, to, lo, hi))
}

// The adjustment the position of offset k takes (groupPrefix16, callPrefix16): how much the advances before k differ in the
// call from the prefix measured alone. Canvas totals give the sum of what changes on both sides of k, not the side:
// - before white space the wide window's: the text after k starts with a space glyph, which has one form, so what the
//   window shows is the letter before k taking its form before a space (probe blink-round3 R1: natively `گ` is 3436 units
//   before a space and 2968 at the end of text, and the space 338 either way);
// - elsewhere the pair window's, a kern between the two clusters next to k, which the pairKerning fact places. What a wider
//   window shows beyond it can sit on either side: after a space the four letters of `ريال` make one Rial glyph in Courier
//   New's fallback and four glyphs measured alone (c-11abbf1905a0c6ef), which is the text after k changing; between joined
//   letters the window's sides cut the word, and their difference is every form and ligature the cut undoes.
// Where the two windows differ and the offset isn't before white space, the position is a stand-in (limits.ts positionLimit, and
// unsafe-to-break at a line edge taken from it). Heuristic, registered in CHARTER.md's known deviations.
export function positionAdjust16(sh: Shaper, g: number, k: number, lo: number, hi: number): number {
  if (k <= lo || k >= hi) return 0
  if (beforeWhiteSpace(sh.p, k, lo, hi)) return adjust16(sh, g, k, lo, hi)
  return pairAdjust16(sh, g, k, lo, hi)
}

function beforeWhiteSpace(p: BlinkPrepared, k: number, lo: number, hi: number): boolean {
  const c = p.text.charCodeAt(k)
  return (c === 0x20 || c === 0xa0 || c === 0x3000) && !joinsAcross(p, k, lo, hi)
}

// Whether offset k inside group g passes the port's safe-to-break test, with the adjustment across k taken inside [from, to),
// whose measured total is `whole`.
function passesSafeTest(sh: Shaper, g: number, k: number, from: number, to: number, whole: number): boolean {
  const p = sh.p
  const group = p.groups[g]!
  return isClusterBoundary(p, k) && !joinsAcross(p, k, group.start, group.end) && windowAdjust16(sh, g, k, from, to, group.start, group.end, whole) === 0 &&
    pairAdjust16(sh, g, k, group.start, group.end) === 0
}

// The offsets where [a, b) is cut into pieces below 256 zoomed px. A space is a cluster of its own, and HarfBuzz's
// syllable-based shapers build syllables only from their script's characters (hb-ot-shaper-myanmar-machine.rl,
// hb-ot-shaper-use-machine.rl), so a cut beside a space keeps every lookup but pair kerning inside one piece, and the pair
// adjustment adds that (blink-gaps §3.2, §3.6 L4). A cut inside a word can split a syllable whose clusters the pair test
// sees one at a time (Myanmar medials and stacked consonants). The cut is the offset nearest the middle beside a space
// that passes the safe test, else the nearest other offset that passes it, else the nearest grapheme boundary, reported as
// unsafe-to-break. An offset beside a space that passes wins over every other offset, so the search tries those first,
// from the middle outward, and tries the others only once they have all failed: what it then finds is what trying every
// offset in one turn from the middle outward finds, without the questions about offsets that can't win. Every piece's end
// goes to `cuts` and its measured total to `totals`, in order, and to `zero` whether the adjustment a position takes at
// the cut at its end is a 0 the search measured (positionAdjust16): the pair window's at a cut that passed the safe test,
// and before white space the wide window's, which is the search's own window where both sides of the cut are one piece
// (adjust16 takes it between the cuts around an offset).
function addPieces(sh: Shaper, g: number, a: number, b: number, cuts: number[], totals: number[], zero: boolean[]): void {
  const p = sh.p
  const group = p.groups[g]!
  const whole = measure16(sh, g, a, b, group.start, group.end)
  if (whole < EXACT16) {
    cuts.push(b)
    totals.push(whole)
    zero.push(false)
    return
  }
  const mid = a + ((b - a) >> 1)
  let k = -1
  let boundary = -1
  for (let turn = 0; turn < 2 && k < 0; turn++) {
    for (let d = 0; k < 0 && (mid - d > a || mid + d < b); d++) {
      for (let side = d === 0 ? 1 : 0; side < 2 && k < 0; side++) {
        const c = side === 0 ? mid - d : mid + d
        if (c <= a || c >= b || p.graphemeStarts[c] !== 1) continue
        if (boundary < 0) boundary = c
        const besideSpace = (p.text.charCodeAt(c - 1) === 0x20) !== (p.text.charCodeAt(c) === 0x20)
        if (besideSpace === (turn === 0) && passesSafeTest(sh, g, c, a, b, whole)) k = c
      }
    }
  }
  if (boundary < 0) {
    uncutCluster(sh.gaps, p, g, a, b)
    cuts.push(b)
    totals.push(whole)
    zero.push(false)
    return
  }
  const passed = k >= 0
  if (!passed) {
    k = boundary
    unsafeCut(sh.gaps, p, g, k)
  }
  const first = cuts.length
  addPieces(sh, g, a, k, cuts, totals, zero)
  const at = cuts.length - 1
  addPieces(sh, g, k, b, cuts, totals, zero)
  zero[at] = passed && (!beforeWhiteSpace(p, k, group.start, group.end) || (at === first && cuts.length === at + 2))
}

// Cuts, prefixes and HanKerning edge trims for every group (the widths Blink knows before filling lines).
export function measureGroups(sh: Shaper): void {
  const p = sh.p
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    // The paragraph's shaping of the group reads the characters on both sides of it (HanKerning context).
    group.startTrim16 = hanKerningStartTrim16(sh, g, group.start, group.end, false)
    group.endTrim16 = hanKerningEndTrim16(sh, g, group.start, group.end)
    const cuts = [group.start]
    const totals: number[] = []
    const zero = [false]
    addPieces(sh, g, group.start, group.end, cuts, totals, zero)
    const prefix = [0]
    for (let i = 0; i < totals.length; i++) prefix.push(prefix[i]! + totals[i]!)
    group.cuts = cuts
    group.prefixAtCut = prefix
    // The adjustment at a cut needs the cuts on both sides of it (adjust16's window), where the search didn't measure it.
    for (let i = 1; i < cuts.length - 1; i++) {
      const d = zero[i]! ? 0 : positionAdjust16(sh, g, cuts[i]!, group.start, group.end)
      for (let j = i; j < prefix.length; j++) prefix[j]! += d
    }
  }
}

// hb_script_get_horizontal_direction (hb-common.cc:520-612 at harfbuzz dfdc088c) over UScriptCode numbers
// (unicode/uscript.h): the scripts HarfBuzz shapes right to left, and the ones it gives no direction (Old Hungarian, Old
// Italic, Runic, Tifinagh). Every other script is left to right.
function scriptDirection(script: number): 'ltr' | 'rtl' | 'none' {
  switch (script) {
    case 2: case 19: case 34: case 37: case 47: case 57: case 84: case 86: case 87: case 88: case 91: case 108: case 116: case 117: case 121: case 122:
    case 123: case 125: case 126: case 133: case 140: case 141: case 142: case 143: case 144: case 162: case 167: case 182: case 183: case 184:
    case 185: case 189: case 192: case 194: case 201: case 209:
      return 'rtl'
    case 30: case 32: case 60: case 76:
      return 'none'
    default:
      return 'ltr'
  }
}

// Whether HarfBuzz shapes the call holding offset k of group g over the reversed text. A buffer whose direction isn't its
// script's own is reversed by graphemes and shaped in the script's direction (hb_ensure_native_direction,
// hb-ot-shape.cc:588-644): quotes or Latin letters in an RTL run are shaped left to right in visual order, so the first
// glyph of a pair is the logically later one. An LTR run under an RTL script stays as it is when it holds a decimal digit or
// a regional indicator and no letter (:593-630). Blink gives HarfBuzz the segment's script and the item's direction
// (harfbuzz_shaper.cc:341-342). General categories are the running JavaScript engine's.
function shapedReversed(p: BlinkPrepared, g: number, k: number): boolean {
  const group = p.groups[g]!
  const direction = scriptDirection(p.scripts[Math.min(k, group.end - 1)]!)
  if (direction === 'none') return false
  let scriptRtl = direction === 'rtl'
  if (scriptRtl && !group.rtl) {
    let a = k
    while (a > group.start && !isSegmentEdge(p, a)) a--
    let b = k + 1
    while (b < group.end && !isSegmentEdge(p, b)) b++
    const text = p.text.slice(a, b)
    if (!/\p{L}/u.test(text) && /[\p{Nd}\u{1F1E6}-\u{1F1FF}]/u.test(text)) scriptRtl = false
  }
  return group.rtl !== scriptRtl
}

// The part of pair adjustment d between the clusters on both sides of offset k that the glyph before it carries
// (FontFacts.pairKerning): all of it on the first glyph's advance, or kern >> 1 where the kern and kerx pair machine applies
// it (hb-kern.hh:102-106). Where the fact isn't given, the first glyph's.
function pairBefore16(sh: Shaper, g: number, d: number, k: number): number {
  // Where HarfBuzz shaped the reversed text, its first glyph is the cluster after k.
  const reversed = shapedReversed(sh.p, g, k)
  switch (sh.p.styles[sh.p.groups[g]!.style]!.font.facts.pairKerning) {
    case 'split': return reversed ? d - (d >> 1) : d >> 1
    case 'first-advance': case null: return reversed ? 0 : d
  }
}

// The 16.16 advance sum of group g before offset k: the glyphs of the clusters before k in the paragraph's shaping.
export function groupPrefix16(sh: Shaper, g: number, k: number): number {
  const p = sh.p
  const group = p.groups[g]!
  if (k >= group.end) return group.prefixAtCut[group.prefixAtCut.length - 1]! - group.startTrim16 - group.endTrim16
  k = clusterStartAtOrBefore(p, k, group.start)
  if (k <= group.start) return 0
  const kept = keepsByOffset(sh, g, group.start, group.end) ? group.prefix16 : null
  if (kept !== null && !Number.isNaN(kept[k - group.start]!)) return kept[k - group.start]!
  const cuts = group.cuts
  let lo = 0
  let hi = cuts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cuts[mid]! <= k) lo = mid
    else hi = mid - 1
  }
  const d = positionAdjust16(sh, g, k, group.start, group.end)
  const pair = adjustBefore16(sh, g, d, k, group.start, group.end)
  // prefixAtCut holds the whole adjustment at its cut, which belongs to both glyphs around it.
  const base = cuts[lo] === k ? group.prefixAtCut[lo]! - d + pair : group.prefixAtCut[lo]! + measure16(sh, g, cuts[lo]!, k, group.start, group.end) + pair
  // HanKerning halted the group's first character (han_kerning.cc:235-262), which every later position includes.
  if (kept !== null) kept[k - group.start] = base - group.startTrim16
  return base - group.startTrim16
}

// Which side of offset k carries the adjustment across it, or 'pair' where that is the font's pair kerning. Where HanKerning
// halts one of the two characters around k, that character carries it whole: the close mark before k (ShouldKernLast), else
// the open mark after it (ShouldKern). HanKerning picks the character from text_content in logical order
// (han_kerning.cc:235-300), whatever order HarfBuzz shapes the run in: in an RTL paragraph `」。` is an RTL run and natively
// `」` is the half-width one (c-306178822a6c08a1). Beside a U+3000 that went to a fallback font (requeuedSpaceAt) the
// cluster on the other side of k carries all of it. Everything else is a pair adjustment (pairBefore16).
export function adjustmentSide(sh: Shaper, g: number, k: number, lo: number, hi: number): 'before' | 'after' | 'pair' {
  const p = sh.p
  if (!p.is8Bit && k > lo && k < hi && hanKerningMayApply(p.hanKerningCandidates, lo, hi)) {
    const data = hanKerningFontData(p, p.groups[g]!.style)
    if (data.hasHalt) {
      const type = resolvedCharType(data, p.text.charCodeAt(k))
      const last = resolvedCharType(data, p.text.charCodeAt(k - 1))
      if (shouldKernLast(type, last)) return 'before'
      if (shouldKern(type, last)) return 'after'
    }
  }
  switch (requeuedSpaceAt(p, k, lo, hi)) {
    case 'start': return 'before'
    case 'end': return 'after'
    case 'unknown': case null: return 'pair'
  }
}

// The part of adjustment d across offset k that the glyphs before k carry.
export function adjustBefore16(sh: Shaper, g: number, d: number, k: number, lo: number, hi: number): number {
  switch (adjustmentSide(sh, g, k, lo, hi)) {
    case 'before': return d
    case 'after': return 0
    case 'pair': return pairBefore16(sh, g, d, k)
  }
}

// HanKerning::AppendFontFeatures start context (han_kerning.cc:235-262): a range that doesn't start a line halts its first
// character when ShouldKern holds with the character before it.
function hanKerningStartTrim16(sh: Shaper, g: number, a: number, b: number, isLineStart: boolean): number {
  const p = sh.p
  if (a === 0 || isLineStart || !hanKerningMayApply(p.hanKerningCandidates, a, b)) return 0
  const style = p.groups[g]!.style
  const data = hanKerningFontData(p, style)
  if (!data.hasHalt) return 0
  const c = p.text.charCodeAt(a)
  if (!shouldKern(resolvedCharType(data, c), resolvedCharType(data, p.text.charCodeAt(a - 1)))) return 0
  hanKerningTrim(sh.gaps, p, style, a)
  return trim16(p, style, c)
}

// The end context (han_kerning.cc:264-300): the last character halts when ShouldKernLast holds with the one after.
function hanKerningEndTrim16(sh: Shaper, g: number, a: number, b: number): number {
  const p = sh.p
  if (b >= p.text.length || !hanKerningMayApply(p.hanKerningCandidates, a, b)) return 0
  const style = p.groups[g]!.style
  const data = hanKerningFontData(p, style)
  if (!data.hasHalt) return 0
  const c = p.text.charCodeAt(b - 1)
  if (!shouldKernLast(resolvedCharType(data, p.text.charCodeAt(b)), resolvedCharType(data, c))) return 0
  hanKerningTrim(sh.gaps, p, style, b - 1)
  return trim16(p, style, c)
}

// A ShapeResult for one item: a text item's cut of its group, or the tab run CreateForTabulationCharacters builds.
export type ShapeResult =
  | { kind: 'group'; group: number; start: number; end: number; rtl: boolean; width16: number; base16: number }
  | { kind: 'tabs'; start: number; end: number; rtl: boolean; first16: number; rest16: number; width16: number }

// An item's result is the group's glyphs whose cluster starts in the item's range (CopyRange through FindGlyphDataRange), so
// an item edge inside a glyph cluster counts as the next cluster boundary.
export function itemShapeResult(sh: Shaper, item: InlineItem): ShapeResult {
  const p = sh.p
  const g = p.groupOfUnit[item.start]!
  const group = p.groups[g]!
  const base16 = groupPrefix16(sh, g, sliceEdge(p, item.start, group.start, group.end))
  return {
    kind: 'group', group: g, start: item.start, end: item.end, rtl: (item.bidiLevel & 1) === 1,
    width16: groupPrefix16(sh, g, sliceEdge(p, item.end, group.start, group.end)) - base16, base16,
  }
}

// Advance sum from the result's start to k.
export function prefix16(sh: Shaper, sr: ShapeResult, k: number): number {
  switch (sr.kind) {
    case 'group':
      return k <= sr.start ? 0 : k >= sr.end ? sr.width16 : groupPrefix16(sh, sr.group, k) - sr.base16
    case 'tabs':
      return k <= sr.start ? 0 : sr.first16 + (Math.min(k, sr.end) - sr.start - 1) * sr.rest16
  }
}

// safe_to_break_before per offset (shape_result.cc:1360-1392). Tab glyphs are all safe (shape_result.cc:1932). A group's
// start is a run start, safe unless HanKerning halted its first character and added the offset to the unsafe ones
// (harfbuzz_shaper.cc:1044-1048). Inside a group: never inside a cluster, never between joining letters, which HarfBuzz
// marks unsafe_to_break in every font (safe_to_insert_tatweel without the tatweel flag, hb-buffer.hh:517-527,
// hb-ot-shaper-arabic.cc:332, 366; AAT transitions, hb-aat-layout-common.hh:1341-1370), and not where the pair total shows
// an adjustment (necessary, not sufficient: gap in-word-prefix).
function safeToBreak(sh: Shaper, sr: ShapeResult, k: number): boolean {
  switch (sr.kind) {
    case 'tabs':
      return true
    case 'group': {
      const group = sh.p.groups[sr.group]!
      if (k <= group.start) return group.startTrim16 === 0
      if (k >= group.end) return true
      if (isFontRunEdge(sh.p, k, group.start, group.end)) return true
      return isClusterBoundary(sh.p, k) && !joinsAcross(sh.p, k, group.start, group.end) && adjust16(sh, sr.group, k, group.start, group.end) === 0 &&
        pairAdjust16(sh, sr.group, k, group.start, group.end) === 0
    }
  }
}

export function isStartSafeToBreak(sh: Shaper, sr: ShapeResult): boolean {
  return safeToBreak(sh, sr, sr.start)
}

// CachedNextSafeToBreakOffset (shape_result.cc:2376-2403).
export function nextSafeToBreak(sh: Shaper, sr: ShapeResult, k: number): number {
  for (let i = k; i < sr.end; i++) if (safeToBreak(sh, sr, i)) return i
  return sr.end
}

// CachedPreviousSafeToBreakOffset (shape_result.cc:2405-2431).
export function previousSafeToBreak(sh: Shaper, sr: ShapeResult, k: number): number {
  if (k >= sr.end) return sr.end
  for (let i = k; i > sr.start; i--) if (safeToBreak(sh, sr, i)) return i
  return sr.start
}

// ShapeResult::SnappedWidth of an item's result: the ceiling of its float width, the sum of its runs' (floatWidthOfParts).
export function snappedWidth(sh: Shaper, sr: ShapeResult): number {
  if (sr.width16 < EXACT16 || sr.kind !== 'group') return luCeil(widthOf16(sr.width16))
  return luCeil(floatWidthOfParts(sh, [{ kind: 'range', sr, start: sr.start, end: sr.end, index: sr.start, offset: 0, length: sr.end - sr.start }], sr.rtl))
}

// CachedPositionForOffset (shape_result.cc:2325-2363), relative to the result's start, in LayoutUnits.
export function positionForOffset(sh: Shaper, sr: ShapeResult, k: number): number {
  const length = sr.end - sr.start
  const offset = k - sr.start
  if (!sr.rtl) return offset < length ? ceilFrom16(prefix16(sh, sr, k)) : luCeil(widthOf16(sr.width16))
  if (offset >= length) return 0
  if (offset === 0) return luCeil(widthOf16(sr.width16))
  return ceilFrom16(sr.width16 - prefix16(sh, sr, k))
}

// CachedOffsetForPosition (shape_result.cc:2261-2323), returning an absolute text_content offset. `before` keeps the search
// below that offset, for a caller that knows an exact position there lies past x (ShapeLine's out-of-order stand-ins).
export function offsetForPosition(sh: Shaper, sr: ShapeResult, x: number, before: number = sr.end + 1): number {
  const length = sr.end - sr.start
  if (x <= 0) return sr.start + (!sr.rtl ? 0 : length)
  if (before > sr.end && f32(x / 64) >= widthOf16(sr.width16)) return sr.start + (!sr.rtl ? length : 0)
  // x_position[v] for visual index v: LTR the position of offset v, RTL the advance of the logical last v characters.
  // In RTL every character of a cluster takes the cluster's left edge: the advance after the cluster's end
  // (ComputePositionData, shape_result.cc:2113-2200).
  const xPosition = (v: number): number => !sr.rtl ? ceilFrom16(prefix16(sh, sr, sr.start + v))
    : ceilFrom16(sr.width16 - prefix16(sh, sr, v === 0 ? sr.end : sr.kind === 'group' ? clusterEndAfter(sh.p, sr.start + length - v - 1, sr.end) : sr.start + length - v))
  // Visual indices of the offsets below `before`: the first ones in LTR, the last ones in RTL.
  const bounded = before <= sr.end
  let low = bounded && sr.rtl ? length - (before - sr.start) : 0
  let high = bounded && !sr.rtl ? before - sr.start - 1 : length - 1
  const last = high
  // What the search has read at the two ends of what is left: the position at `low` once it moved up, and the one past
  // `high` once it moved down. It comes back to those two indices and to no other, and doesn't measure them again.
  let lowPosition: number | null = null
  let pastHighPosition: number | null = null
  while (low <= high) {
    const mid = low + ((high - low) >> 1)
    const position: number = mid === low && lowPosition !== null ? lowPosition : xPosition(mid)
    if (x < position) {
      high = mid - 1
      pastHighPosition = position
      continue
    }
    const next: number | null = mid + 1 === length || (bounded && !sr.rtl && mid === last) ? null : mid === high && pastHighPosition !== null ? pastHighPosition : xPosition(mid + 1)
    if (next === null || next > x) {
      if (!sr.rtl) return sr.start + mid
      return sr.start + (position === x ? length - mid : length - mid - 1)
    }
    low = mid + 1
    lowPosition = next
  }
  return sr.start
}

// The result of LineBreaker::ShapeText over [start, end) of group g (line_breaker.cc:2044-2064): its own shaping call,
// with the HanKerning trims its edges got and its width.
export type ReshapeCall = { group: number; start: number; end: number; startTrim16: number; endTrim16: number; width16: number }

// A ShapeResultView part (RunInfoPart, shape_result_view.h:160-260): the glyphs of text_content [start, end) in the item's
// shape result or in a reshape, with Blink's bookkeeping, which decides what a later view of the view takes: `index`
// (start_index_), `offset` (offset_, from the numbered run start) and `length` (num_characters_). A reshape or the item's
// result is one run: index its start, offset 0.
export type Part =
  | { kind: 'range'; sr: ShapeResult; start: number; end: number; index: number; offset: number; length: number }
  | { kind: 'reshape'; call: ReshapeCall; start: number; end: number; index: number; offset: number; length: number }

export type ReshapePart = Extract<Part, { kind: 'reshape' }>

// A ShapeResultView: parts in logical order, its width the float32 sum of each part's float width, and start_index_,
// char_index_offset_ and num_characters_ (StartIndex() = startIndex + charIndexOffset).
export type View = { parts: Part[]; width: number; rtl: boolean; startIndex: number; charIndexOffset: number; numCharacters: number }

// A ShapeResultView::Segment (shape_result_view.h:77-100): the item's shape result, a reshape or a view, cut to [start, end).
export type Segment =
  | { kind: 'result'; sr: ShapeResult; start: number; end: number }
  | { kind: 'reshape'; call: ReshapeCall; start: number; end: number }
  | { kind: 'view'; view: View; start: number; end: number }

// std::numeric_limits<unsigned>::max(), a segment end that takes the whole source.
export const WHOLE = 0xffffffff

// The 16.16 advance sum of a reshape's glyphs before offset k, as groupPrefix16 gives it for a group without cuts: the
// prefix measured inside the call, the pair adjustment on the glyph before k, less what HanKerning halted at the start.
function callPrefix16(sh: Shaper, call: ReshapeCall, k: number): number {
  if (k <= call.start) return 0
  if (k >= call.end) return call.width16
  const p = sh.p
  k = clusterStartAtOrBefore(p, k, call.start)
  if (k <= call.start) return 0
  const pair = adjustBefore16(sh, call.group, positionAdjust16(sh, call.group, k, call.start, call.end), k, call.start, call.end)
  return measure16(sh, call.group, call.start, k, call.start, call.end) + pair - call.startTrim16
}

// A view takes the glyphs whose character index, their cluster's first character, lies in its range
// (GlyphDataRange::FindGlyphDataRange, glyph_data_range.cc:56-90), so a range edge inside a glyph cluster gives the cluster to
// the part holding its start: the edge counts as the next cluster boundary. Positions (CachedPositionForOffset) snap the
// other way, to the cluster's start (shape_result.cc:2113-2200).
export function sliceEdge(p: BlinkPrepared, k: number, lo: number, hi: number): number {
  if (k <= lo || k >= hi) return k
  let e = k
  while (e < hi && !isClusterBoundary(p, e)) e++
  return e
}

// The advance sum before slice edge k in the shaping call a part's glyphs come from: the item's result or a reshape.
export function slicePrefix16(sh: Shaper, part: Part, k: number): number {
  switch (part.kind) {
    case 'range': return prefix16(sh, part.sr, part.sr.kind === 'group' ? sliceEdge(sh.p, k, part.sr.start, part.sr.end) : k)
    case 'reshape': return callPrefix16(sh, part.call, sliceEdge(sh.p, k, part.call.start, part.call.end))
  }
}

export function partWidth16(sh: Shaper, part: Part): number {
  return slicePrefix16(sh, part, part.end) - slicePrefix16(sh, part, part.start)
}

function makeView(sh: Shaper, parts: Part[], rtl: boolean, startIndex: number, charIndexOffset: number, numCharacters: number): View {
  viewEdges(sh.gaps, sh.p, parts)
  return { parts, width: floatWidthOfParts(sh, parts, rtl), rtl, startIndex, charIndexOffset, numCharacters }
}

// A view's float width: every part's glyphs are HarfBuzz runs, one per script segment and per stretch one font draws
// (HarfBuzzShaper::ShapeSegment and CommitGlyphs, harfbuzz_shaper.cc:560-700, 1080-1101); a run's width is its exact advance
// sum as a float (shape_result.cc:1539-1576), and the view adds them in the runs' stored order, the visual one
// (PopulateRunInfoParts, shape_result_view.cc:215-273; InsertRun, shape_result.cc:1578-1609). Below 256 zoomed px every such
// sum is exact; past it the float32 sum rounds by where the runs are: a line of 983 px in Geeza Pro with `!` and `:` drawn
// by the next listed family was one LayoutUnit narrower natively than the ceiling of the exact total (c-98ab54a5eeff7b16).
function floatWidthOfParts(sh: Shaper, parts: Part[], rtl: boolean): number {
  const p = sh.p
  // The advance sums before every part's two edges, measured once for the total and for the sum.
  const start16: number[] = []
  const end16: number[] = []
  let total16 = 0
  for (let i = 0; i < parts.length; i++) {
    end16.push(slicePrefix16(sh, parts[i]!, parts[i]!.end))
    start16.push(slicePrefix16(sh, parts[i]!, parts[i]!.start))
    total16 += end16[i]! - start16[i]!
  }
  if (total16 < EXACT16) {
    let width = 0
    for (let i = 0; i < parts.length; i++) width = f32(width + widthOf16(end16[i]! - start16[i]!))
    return width
  }
  let width = 0
  // The exact sum so far, and how far the float sum can be from it: a sum below 256 px is exact, so only a run that ends
  // past it can round, by half a float32 step at its size, and a run of a font the facts don't name may be one run per
  // cluster.
  let exact16 = 0
  let slack16 = 0
  let first = -1
  let last = -1
  // Every run's advance, or'ed, and the runs of fonts the facts don't name past 256 px: what says whether the sum can be
  // off (gaps.ts floatSum).
  const unknownRuns: UnknownRun[] = []
  let bits = 0
  for (let n = 0; n < parts.length; n++) {
    const index = rtl ? parts.length - 1 - n : n
    const part = parts[index]!
    if (part.kind === 'range' && part.sr.kind !== 'group') { width = f32(width + widthOf16(end16[index]! - start16[index]!)); continue }
    const lo = part.kind === 'reshape' ? part.call.start : part.sr.start
    const hi = part.kind === 'reshape' ? part.call.end : part.sr.end
    const a = sliceEdge(p, part.start, lo, hi)
    const b = sliceEdge(p, part.end, lo, hi)
    if (a >= b) continue
    if (first < 0 || a < first) first = a
    if (b > last) last = b
    const prefix = (k: number): number => part.kind === 'reshape' ? callPrefix16(sh, part.call, k) : prefix16(sh, part.sr, k)
    // Run edges inside the part, in logical order.
    const edges = [a]
    for (let k = a + 1; k < b; k++) {
      if (!isClusterBoundary(p, k)) continue
      if (isSegmentEdge(p, k) || p.fontRun[k] !== p.fontRun[k - 1]) edges.push(k)
    }
    edges.push(b)
    // The advance sum before every run edge: the part's own two are measured, the ones between in the runs' visual order.
    const at16 = new Array<number>(edges.length)
    at16[0] = start16[index]!
    at16[edges.length - 1] = end16[index]!
    for (let r = 1; r + 1 < edges.length; r++) {
      const e = rtl ? edges.length - 1 - r : r
      at16[e] = prefix(edges[e]!)
    }
    for (let r = 0; r + 1 < edges.length; r++) {
      const e = rtl ? edges.length - 2 - r : r
      const run16 = at16[e + 1]! - at16[e]!
      width = f32(width + widthOf16(run16))
      exact16 += run16
      bits |= run16
      if (exact16 < EXACT16) continue
      let unknownClusters = 0
      for (let k = edges[e]!; k < edges[e + 1]!; k++) if (p.fontRun[k]! < 0 && isClusterBoundary(p, k)) unknownClusters++
      if (unknownClusters > 0) unknownRuns.push({ prefix, from: edges[e]!, to: edges[e + 1]! })
      slack16 += unknownClusters * 2 ** Math.max(0, Math.floor(Math.log2(exact16)) - 23) / 2
    }
  }
  floatSum(sh.gaps, p, total16, slack16, bits, first, last, unknownRuns)
  return width
}

function startIndexOf(segment: Segment): number {
  switch (segment.kind) {
    case 'result': return segment.sr.start
    case 'reshape': return segment.call.start
    case 'view': return segment.view.startIndex + segment.view.charIndexOffset
  }
}

function endIndexOf(segment: Segment): number {
  switch (segment.kind) {
    case 'result': return segment.sr.end
    case 'reshape': return segment.call.end
    case 'view': return segment.view.startIndex + segment.view.charIndexOffset + segment.view.numCharacters
  }
}

function runsOf(segment: Segment): Part[] {
  switch (segment.kind) {
    case 'result': return [{ kind: 'range', sr: segment.sr, start: segment.sr.start, end: segment.sr.end, index: segment.sr.start, offset: 0, length: segment.sr.end - segment.sr.start }]
    case 'reshape': return [{ kind: 'reshape', call: segment.call, start: segment.call.start, end: segment.call.end, index: segment.call.start, offset: 0, length: segment.call.end - segment.call.start }]
    case 'view': return segment.view.parts
  }
}

// ShapeResultView::Create(segments) (InitData::Populate, shape_result_view.cc:89-137; PopulateRunInfoParts, :215-273;
// Create, :287-308). RTL walks the segments back to front, while each segment's parts are numbered from the characters
// counted so far, so in RTL a view joining several segments numbers them in visual order: ShapeToEnd's reshaped line start
// [1, 2) and the rest [2, 3) are numbered [2, 3) and [1, 2). A later view by character range takes parts by those numbers
// (RunInfoPart::ComputeStartEnd, shape_result_view.h:218-250) and glyphs by their index in their run (FindGlyphDataRange,
// glyph_data_range.cc:56-90): cut at 2, the letter's glyph goes with the space (specs/blink-RESULTS.md class 3, probe-zw3).
export function viewFromSegments(sh: Shaper, rtl: boolean, segments: Segment[]): View {
  const first = segments[0]!
  const firstStart = Math.max(startIndexOf(first), first.start)
  const startIndex = rtl ? firstStart : 0
  const charIndexOffset = rtl ? 0 : firstStart
  const parts: Part[] = []
  let numCharacters = 0
  for (let n = 0; n < segments.length; n++) {
    const segment = segments[rtl ? segments.length - 1 - n : n]!
    const otherStart = startIndexOf(segment)
    const indexDiff = startIndex + numCharacters - Math.max(segment.start, otherStart)
    numCharacters += Math.min(segment.end, endIndexOf(segment)) - Math.max(segment.start, otherStart)
    const runs = runsOf(segment)
    const offsetForRun = segment.kind === 'view' ? segment.view.charIndexOffset : 0
    const taken: Part[] = []
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!
      let partStart = run.index + offsetForRun
      if (rtl) partStart = Math.max(partStart, run.offset)
      if (run.length === 0 || segment.end <= partStart) continue
      const partEnd = partStart + run.length
      if (segment.start >= partEnd) continue
      const runStart = partStart - run.offset
      const rangeStart = segment.start > runStart ? Math.max(segment.start, partStart) - runStart : 0
      const rangeEnd = Math.min(segment.end, partEnd) - runStart
      let a = run.start
      let b = run.end
      if (!(partStart >= segment.start && partEnd <= segment.end)) {
        const origin = run.kind === 'range' ? run.sr.start : run.call.start
        a = Math.min(b, Math.max(a, origin + rangeStart))
        b = Math.max(a, Math.min(b, origin + rangeEnd))
      }
      const bookkeeping = { start: a, end: b, index: runStart + rangeStart + indexDiff, offset: rangeStart, length: rangeEnd - rangeStart }
      taken.push(run.kind === 'range' ? { kind: 'range', sr: run.sr, ...bookkeeping } : { kind: 'reshape', call: run.call, ...bookkeeping })
    }
    if (rtl) parts.unshift(...taken)
    else parts.push(...taken)
  }
  return makeView(sh, parts, rtl, startIndex, charIndexOffset, numCharacters)
}

// ShapeResultView::Create(result, start, end).
export function viewOf(sh: Shaper, sr: ShapeResult, start: number = sr.start, end: number = sr.end): View {
  return viewFromSegments(sh, sr.rtl, [{ kind: 'result', sr, start, end }])
}

// The 16.16 advance sum of a view's glyphs before offset k. A part numbered outside its glyphs' characters
// (viewFromSegments) gives its glyphs the view's nearest edge.
export function viewPrefix16(sh: Shaper, view: View, k: number): number {
  const first = view.startIndex + view.charIndexOffset
  const last = first + view.numCharacters
  let sum = 0
  for (let i = 0; i < view.parts.length; i++) {
    const part = view.parts[i]!
    const start = Math.min(Math.max(part.start, first), last)
    const end = Math.min(Math.max(part.end, first), last)
    if (start === end) {
      if (part.start < part.end && (k > start || k >= last)) sum += partWidth16(sh, part)
      continue
    }
    if (k >= end) {
      sum += partWidth16(sh, part)
      continue
    }
    if (start < k) sum += slicePrefix16(sh, part, k) - slicePrefix16(sh, part, part.start)
    break
  }
  return sum
}

// Where Blink's caret code starts graphemes among the characters of a view's part: flags per character of the part, or
// null where the part's list comes from its own text and the paragraph's boundaries apply. `position` is where the part's
// characters sit in the item as the caret code counts them (inspect.ts shapeOf). FragmentItem::LineLeftAndRightForOffsets
// copies the view into a ShapeResult whose runs keep the parts' numbers (CreateShapeResult, shape_result_view.cc:182-212),
// and ShapeResult::EnsureGraphemes lists each run's graphemes over the item text at the run's start_index_ less the
// result's (shape_result.cc:186-214). An RTL view of several segments numbers its parts in visual order
// (viewFromSegments), so a reshaped line end `بِ` after a NUL of the same item is numbered where the NUL is, its list is
// made from NUL and beh, two graphemes, and the cluster's advance is shared between the letter and its mark
// (c-66aa475c77b20230: natively beh and kasra report halves of 293 and 292 units).
export function partGraphemeStarts(sh: Shaper, view: View, part: Part, position: number): Uint8Array | null {
  const p = sh.p
  const first = view.startIndex + view.charIndexOffset
  const windowStart = first + part.index - view.startIndex
  if (part.length <= 0 || windowStart === position || windowStart < 0 || windowStart + part.length > p.text.length) return null
  const window = p.text.slice(windowStart, windowStart + part.length)
  const starts = new Uint8Array(part.length)
  if (p.is8Bit) {
    for (let j = 0; j < part.length; j++) if (!(j > 0 && window.charCodeAt(j - 1) === 0x0d && window.charCodeAt(j) === 0x0a)) starts[j] = 1
  } else {
    const boundaries = graphemeBoundaries(window, blinkGraphemeRules)
    for (let j = 0; j < boundaries.length; j++) if (boundaries[j]! < part.length) starts[boundaries[j]!] = 1
  }
  starts[0] = 1
  return starts
}

// The shaping group a line edge inside an item's result is shaped again in. A tab run's offsets are all safe to break
// (safeToBreak), so ShapeLine never shapes one again.
function reshapedGroup(sr: ShapeResult): number {
  switch (sr.kind) {
    case 'group': return sr.group
    case 'tabs': throw new Error('a line edge inside a tab run is never shaped again')
  }
}

// LineBreaker::ShapeText (line_breaker.cc:2044-2064): [start, end) of an item's result shaped alone with the current
// style's spacing.
export function reshape(sh: Shaper, sr: ShapeResult, start: number, end: number, isLineStart: boolean = false): ReshapePart {
  const g = reshapedGroup(sr)
  const startTrim16 = hanKerningStartTrim16(sh, g, start, end, isLineStart)
  const endTrim16 = hanKerningEndTrim16(sh, g, start, end)
  const width16 = measure16(sh, g, start, end, start, end) - startTrim16 - endTrim16
  return { kind: 'reshape', call: { group: g, start, end, startTrim16, endTrim16, width16 }, start, end, index: start, offset: 0, length: end - start }
}

// A line-end reshape with `han_kerning_end` (shaping_line_breaker.cc:344-363; harfbuzz_shaper.cc:1018-1030): HanKerning
// halts the last character whatever follows (apply_end), with the start context as usual.
export function reshapeHanKerningEnd(sh: Shaper, sr: ShapeResult, start: number, end: number): ReshapePart {
  const p = sh.p
  const g = reshapedGroup(sr)
  const startTrim16 = hanKerningStartTrim16(sh, g, start, end, false)
  let endTrim16 = 0
  if (hanKerningMayApply(p.hanKerningCandidates, start, end)) {
    const style = p.groups[g]!.style
    const data = hanKerningFontData(p, style)
    if (data.hasHalt) {
      const c = p.text.charCodeAt(end - 1)
      // Canvas's `cc` halts one of the two only for fullwidth open and close marks (ShouldKern, ShouldKernLast); for
      // other types the difference is ordinary kerning (Arial `’’`), and `hasHalt` describes the font `「` falls back to.
      switch (resolvedCharType(data, c)) {
        case HAN_OPEN: case HAN_CLOSE:
          hanKerningTrim(sh.gaps, p, style, end - 1)
          endTrim16 = trim16(p, style, c)
          break
        default:
          hanKerningEndUnknown(sh.gaps, p, style, end - 1)
      }
    }
  }
  const width16 = measure16(sh, g, start, end, start, end) - startTrim16 - endTrim16
  return { kind: 'reshape', call: { group: g, start, end, startTrim16, endTrim16, width16 }, start, end, index: start, offset: 0, length: end - start }
}

// ShapeResultView::Create(view, start, end) (shape_result_view.cc:317-322): the parts cut to [start, end) without shaping
// again; a cut reshape keeps its glyphs.
export function truncateView(sh: Shaper, view: View, start: number, end: number): View {
  return viewFromSegments(sh, view.rtl, [{ kind: 'view', view, start, end }])
}

// HyphenResult (hyphen_result.cc:12-16): U+2010 when the primary font maps it, else U+002D (computed_style.cc:1804-1820).
// Canvas can't show which, because fallback supplies U+2010: the font declaration says (FontFacts.mapsHyphen), and when
// it doesn't the hyphen is U+2010 (lines report hyphen-glyph where that decides a width).
function hyphenText(style: ComputedStyle): string {
  switch (style.font.facts.mapsHyphen) {
    case true: return '‐'
    case false: return '-'
    case null: return '‐'
  }
}

// LineBreaker::AddHyphen shapes the hyphen whenever a break at a soft hyphen is tried (line_breaker.cc:728-760), and its
// width decides whether the break fits (gaps.ts hyphenGlyph where that rests on the default).
export function shapeHyphen(sh: Shaper, style: number): { text: string; inlineSize: number } {
  const text = hyphenText(sh.p.styles[style]!)
  // U+2010 is a two-byte string and U+002D a one-byte one, as the paragraph's own hyphen strings are.
  const contexts = contextsOf(sh.p, style, text !== '-')
  const raw16 = raw16Of(contexts, contexts.hyphen, text)
  hyphenGlyph(sh.gaps, sh.p, style, raw16)
  return { text, inlineSize: Math.max(0, luCeil(widthOf16(raw16))) }
}

// ShapeResult::CreateForTabulationCharacters with Font::TabWidth (shape_result.cc:1898-1944, font.cc:303-340): the
// block's font (TabSizeAncestor) and spacing (TabSizeWithSpacing), the first tab to the next stop from `position`. Blink
// counts stops from SimpleFontData::SpaceWidth, the platform advance (simple_font_data.cc:225-240) without `trak` tracking
// and before 16.16 truncation; Canvas gives the shaping advance (gap tab-stops, probe blink-followups F4).
export function tabShapeResult(sh: Shaper, start: number, end: number, rtl: boolean, positionLU: number, run: number, style: number): ShapeResult {
  const p = sh.p
  tabStops(sh.gaps, p, run, start, end)
  // The item's tab-size (style.GetTabSize(), line_breaker.cc:2968) with the block's font and spacing (FontForTab under
  // TabSizeAncestor, inline_node.cc:2130-2140).
  const block = p.styles[0]!
  const contexts = contextsOf(p, 0, false)
  const space = widthOf16(raw16Of(contexts, contexts.hyphen, ' '))
  const ls = f32(block.letterSpacing * p.layoutZoom)
  const ws = f32(block.wordSpacing * p.layoutZoom)
  // TabWidthInternal: TabSize::GetPixelSize with TabSizeWithSpacing (stable, runtime_enabled_features.json5:6172), and the
  // letter spacing when that is 0, which TabWidth(font_data, tab_size) returns as the base whatever it is (font.h:260-264,
  // font.cc:303-317). So under tab-size 0 with letter spacing, tabs stop at multiples of the letter spacing.
  const pixelSize = f32(f32(p.styles[style]!.tabSize) * f32(f32(space + ls) + ws))
  const base = pixelSize !== 0 ? pixelSize : ls
  const tabWidth = (position: number | null): number => {
    // TabWidth(font_data, tab_size, position) returns the letter spacing only when the base is 0 (font.cc:319-340).
    if (base === 0) return ls
    if (position === null) return base
    let modulo = f32(position % base)
    if (modulo < 0) modulo = f32(modulo + base)
    let distance = f32(base - modulo)
    if (distance < f32(space / 2)) distance = f32(distance + base)
    return distance
  }
  // TextRunLayoutUnit::FromFloatRound: roundf of v × 65536.
  const round16 = (v: number): number => { const x = f32(v * 65536); return x < 0 ? -Math.round(-x) : Math.round(x) }
  const first16 = round16(tabWidth(f32(positionLU / 64)))
  const rest16 = round16(tabWidth(null))
  return { kind: 'tabs', start, end, rtl, first16, rest16, width16: first16 + (end - start - 1) * rest16 }
}
