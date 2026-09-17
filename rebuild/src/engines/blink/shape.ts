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
import { measureContext, measureText, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { Gap } from '../../model.js'
import { addGap, sourceOffsetAt, sourceRange } from './gaps.js'
import { hanKerningFontData, hanKerningMayApply, resolvedCharType, shouldKern, shouldKernLast, trim16 } from './hankerning.js'
import { HAN_CLOSE, HAN_OPEN, USCRIPT_LATIN, isCursiveScript, joiningType } from './props.js'
import { scriptsPerUnit } from './script.js'
import type { BlinkPrepared, BlinkStyle, StyleContexts } from './types.js'

const f32 = Math.fround
// Float32 holds every 16.16 integer below 2^24, 256 px.
const EXACT16 = 0x1000000

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

// A style whose fonts have an opsz axis is measured at the CSS size and scaled: Blink's DOM shapes at the zoomed size
// with opsz and HarfBuzz ptem at the specified size (font_platform_data_mac.mm:170-178, harfbuzz_face.cc:648), which
// equals the CSS-size advances scaled in a clean renderer (probes-chrome correction 7: DOM(S) = ceil64(W(S) × DPR) at
// 10-28px). Other fonts are measured at the zoomed size (specs/blink-lines.md §2.3).
export function styleContexts(m: Measurer, style: BlinkStyle, zoom: number, partition: string): StyleContexts {
  const cssSize = style.measuresAtCssSize
  const scale = cssSize ? zoom : 1
  // Computed font size f32(specified × zoom); DOM and Canvas both floor it to 1/100 (specs/blink-lines.md §2.3).
  const font = canvasFont(style.font, cssSize ? f32(style.font.size) : f32(f32(style.font.size) * f32(zoom)))
  const lang = style.locale ?? ''
  const letterSpacing = `${cssSize ? f32(style.letterSpacing) : f32(style.letterSpacing * zoom)}px`
  // optimizeLegibility sets kKerning | kLigatures, so Canvas shapes a whole bidi run in one call when the primary font's
  // GPOS or GSUB coverage holds the space glyph (font_fallback_list.cc:264-286; blink-canvas H6 confirmed). It adds no
  // HarfBuzz feature (font_features.cc:32-240). Other fonts still split before CJK bases (plain_text_node.cc:115-153).
  const base = { font, lang, wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'optimizeLegibility' as const, partition }
  // A letter spacing of 1/64 px turns liga, clig and calt off (font_features.cc:54-86) and adds 1024 raw16 per character,
  // which cancels in a pair adjustment's differences (edgeGap in index.ts).
  const noLigatures = `${NO_LIGATURES_SPACING_PX}px`
  return {
    ltr: measureContext(m, { ...base, letterSpacing, direction: 'ltr' }),
    rtl: measureContext(m, { ...base, letterSpacing, direction: 'rtl' }),
    ltrNoLigatures: measureContext(m, { ...base, letterSpacing: noLigatures, direction: 'ltr' }),
    rtlNoLigatures: measureContext(m, { ...base, letterSpacing: noLigatures, direction: 'rtl' }),
    // The hyphen is shaped alone without spacing (hyphen_result.cc:12-16).
    hyphen: measureContext(m, { ...base, letterSpacing: '0px', direction: 'ltr' }),
    scale,
  }
}

// What measuring needs: the prepared paragraph, the layout's measurer, and where gaps go (the paragraph's in prepare, a
// line's while that line is filled).
export type Shaper = {
  p: BlinkPrepared
  m: Measurer
  gaps: Gap[]
}

// Math.round(W × 65536) of a Canvas string, in 16.16 units of the zoomed px.
export function raw16Of(sh: Shaper, contexts: StyleContexts, context: number, s: string): number {
  return Math.round(measureText(sh.m, context, s) * contexts.scale * 65536)
}

const NO_LIGATURES_SPACING_PX = 0.015625

// Joining_Type D, L or C joins the following character; D, R or C the preceding one; T is transparent.
function joinsFollowing(jt: number): boolean { return jt === 1 || jt === 3 || jt === 4 }
function joinsPreceding(jt: number): boolean { return jt === 1 || jt === 2 || jt === 4 }

// hb_unicode_funcs_t::is_default_ignorable (hb-unicode.hh:167-197).
function isDefaultIgnorable(cp: number): boolean {
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

// Character::TreatAsZeroWidthSpace (character.h:160-189): FF, CR, U+FFFC, ZWNJ, ZWJ and ICU's Default_Ignorable_Code_Point
// (SHY alone below U+0100). HarfBuzz's default-ignorable set lacks the Hangul fillers and the shorthand format controls
// that ICU's has (DerivedCoreProperties.txt 17.0: U+115F, U+1160, U+3164, U+FFA0, U+1BCA0..U+1BCA3).
function treatAsZeroWidthSpace(c: number): boolean {
  if (c === 0x0c || c === 0x0d || c === 0xfffc || c === 0x200c || c === 0x200d) return true
  if (c < 0x100) return c === 0xad
  return isDefaultIgnorable(c) || c === 0x115f || c === 0x1160 || c === 0x3164 || c === 0xffa0 || (c >= 0x1bca0 && c <= 0x1bca3)
}

function allDefaultIgnorable(p: BlinkPrepared, from: number, to: number): boolean {
  for (let i = from; i < to;) {
    const cp = p.text.codePointAt(i)!
    if (!isDefaultIgnorable(cp)) return false
    i += cp > 0xffff ? 2 : 1
  }
  return true
}

const JOINING_DETAIL = 'a shaping call edge between joining letters (a group edge, or a reshape the line breaker measured, chosen or not) in a font the declaration gives no joining fact for: Blink shapes each side with HarfBuzz context, which OpenType fonts join through and AAT (morx) fonts such as Geeza Pro don\'t (hb-ot-shape.cc:60-66, 100-101; probe blink-followups F1); the port measures the edge as an AAT font gives it'

const CONTEXT_DETAIL = 'a shaping call edge between joining letters in an OpenType joining font: U+200D stands in for the context HarfBuzz reads, which gives the joined forms but not contextual alternates that read the letters beyond it (DESIGN.md §5 unsafe-to-break: contextual forms across a chosen edge)'

// Whether a range measured as part of a shaping call over [callStart, callEnd) of group g gets U+200D at its edge k,
// where the text on the other side joins: inside the call the letters are joined; at the call's own edge only when the
// font reads HarfBuzz's context (FontFacts.joining 'opentype'). Where the fact isn't given the edge decides a width, so
// the measurement reports joining-technology to where gaps go: the paragraph's in prepare, the line's being filled.
function joinedAtEdge(sh: Shaper, g: number, k: number, callStart: number, callEnd: number): boolean {
  const p = sh.p
  if (k > callStart && k < callEnd) return joinsAcross(p, k, callStart, callEnd)
  const style = p.styles[p.groups[g]!.style]!
  switch (style.joining) {
    case 'opentype':
      if (!joinsAcross(p, k, callStart, callEnd)) return false
      addGap(sh.gaps, 'unsafe-to-break', style.run, CONTEXT_DETAIL, sourceOffsetAt(p, k))
      return true
    case 'aat': return false
    case null:
      if (joinsAcross(p, k, callStart, callEnd)) addGap(sh.gaps, 'joining-technology', style.run, JOINING_DETAIL, sourceOffsetAt(p, k))
      return false
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
// `domScript` is the script the paragraph shapes [from, to) with (measure16 splits ranges at script edges). A Latin range
// stays an 8-bit string whatever its length, since Canvas shapes an 8-bit string as one Latin segment exactly as the DOM
// shapes a Latin segment; only a range under another script is sliced into a 16-bit string, so RunSegmenter resolves its
// characters as the paragraph does.
export type CanvasString = { s: string; units: Int32Array; twoByte: boolean; leftOut: boolean }

export function canvasString(p: BlinkPrepared, from: number, to: number, zwjBefore: boolean, zwjAfter: boolean, domScript: number): CanvasString {
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
      case 0x20: codes.push(0x2028); wide = true; break
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
  const contexts = p.contexts[group.style]!
  const cs = canvasString(p, from, to, joinedAtEdge(sh, g, from, callStart, callEnd), joinedAtEdge(sh, g, to, callStart, callEnd), p.scripts[from]!)
  const context = noLigatures ? (group.rtl ? contexts.rtlNoLigatures : contexts.ltrNoLigatures) : (group.rtl ? contexts.rtl : contexts.ltr)
  const w = cs.s.length === 0 ? 0 : raw16Of(sh, contexts, context, cs.s)
  const scripts = cs.twoByte ? scriptsPerUnit(cs.s) : null
  const st = p.styles[group.style]!
  // What the string can shape otherwise than the DOM (script-context, soft-hyphen-shaping) depends only on the content, so
  // prepare reports it with its range (contentGaps in index.ts).
  const ls16 = st.letterSpacing === 0 ? 0 : raw16Trunc(f32(st.letterSpacing * p.layoutZoom))
  let adjust = wordSpacing16(p, group.style, from, to)
  for (let u = 0; u < cs.units.length; u++) {
    const t = cs.units[u]!
    if (t < 0) continue
    const c = p.text.charCodeAt(t)
    if ((c & 0xfc00) === 0xdc00) continue
    const canvasScript = scripts === null ? USCRIPT_LATIN : scripts[u]!
    if (ls16 === 0) continue
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
  return w + adjust
}

// Word spacing on U+0020, TAB, LF and NBSP, except at text_content index 0 unless NBSP or the block preserves spaces
// (shape_result_spacing.cc:103-139, specs/blink-text.md §2.E).
function wordSpacing16(p: BlinkPrepared, style: number, from: number, to: number): number {
  const ws = p.styles[style]!.wordSpacing
  if (ws === 0) return 0
  const raw = raw16Trunc(f32(ws * p.layoutZoom))
  let n = 0
  for (let i = from; i < to; i++) {
    const c = p.text.charCodeAt(i)
    if ((c === 0x20 || c === 0x09 || c === 0x0a || c === 0xa0) && (i !== 0 || c === 0xa0 || p.wordSpacingAnywhere)) n++
  }
  return n * raw
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
  return p.graphemeStarts[k] === 1 && p.continuations[k] !== 1
}

// Whether k is inside a grapheme at a unit HarfBuzz doesn't mark a continuation: whether glyphs there form one cluster or
// two depends on the font's lookups.
export function startsClusterInsideGrapheme(p: BlinkPrepared, k: number): boolean {
  return p.graphemeStarts[k] !== 1 && p.continuations[k] !== 1
}

function clusterStartAtOrBefore(p: BlinkPrepared, k: number, min: number): number {
  while (k > min && !isClusterBoundary(p, k)) k--
  return k
}

function clusterEndAfter(p: BlinkPrepared, k: number, max: number): number {
  let e = k + 1
  while (e < max && !isClusterBoundary(p, e)) e++
  return e
}

// d at offset k inside a shaping call over [lo, hi) of group g: the adjustment between the clusters on both sides of k.
// Each side is whole glyph clusters (isClusterBoundary): a mark after SHY, ZWSP or U+2060 starts a grapheme but continues
// the ignorable's HarfBuzz cluster (hb_form_clusters, hb-ot-shape.cc:578-586), and measured alone Canvas shapes it as a
// broken cluster the paragraph never has (c-01763358db8471a3: a kasra after SHY gave its neighbour a -2 px adjustment).
// HarfBuzz's lookups skip default-ignorable glyphs (hb-ot-layout-gsubgpos.hh:558-571), so a side that holds only
// default-ignorable characters (U+200B between two letters) reaches to the next cluster.
export function pairAdjust16(sh: Shaper, g: number, k: number, lo: number, hi: number): number {
  const p = sh.p
  if (k <= lo || k >= hi) return 0
  let a = clusterStartAtOrBefore(p, k - 1, lo)
  while (a > lo && allDefaultIgnorable(p, a, k)) a = clusterStartAtOrBefore(p, a - 1, lo)
  let b = clusterEndAfter(p, k, hi)
  while (b < hi && allDefaultIgnorable(p, k, b)) b = clusterEndAfter(p, b, hi)
  return measure16(sh, g, a, b, lo, hi) - measure16(sh, g, a, k, lo, hi) - measure16(sh, g, k, b, lo, hi)
}

// pairAdjust16 measured through the no-ligature contexts: the adjustment without liga, clig and calt.
export function pairAdjustNoLigatures16(sh: Shaper, g: number, k: number, lo: number, hi: number): number {
  const p = sh.p
  if (k <= lo || k >= hi) return 0
  let a = clusterStartAtOrBefore(p, k - 1, lo)
  while (a > lo && allDefaultIgnorable(p, a, k)) a = clusterStartAtOrBefore(p, a - 1, lo)
  let b = clusterEndAfter(p, k, hi)
  while (b < hi && allDefaultIgnorable(p, k, b)) b = clusterEndAfter(p, b, hi)
  return measure16(sh, g, a, b, lo, hi, true) - measure16(sh, g, a, k, lo, hi, true) - measure16(sh, g, k, b, lo, hi, true)
}

// The adjustment across offset k with two glyph clusters on each side, where HarfBuzz context lookups can read further
// than the one-cluster pair window.
export function wideAdjust16(sh: Shaper, g: number, k: number, lo: number, hi: number): number {
  const p = sh.p
  if (k <= lo || k >= hi) return 0
  let a = clusterStartAtOrBefore(p, k - 1, lo)
  if (a > lo) a = clusterStartAtOrBefore(p, a - 1, lo)
  let b = clusterEndAfter(p, k, hi)
  if (b < hi) b = clusterEndAfter(p, b, hi)
  return measure16(sh, g, a, b, lo, hi) - measure16(sh, g, a, k, lo, hi) - measure16(sh, g, k, b, lo, hi)
}

// Whether offset k inside group g passes the port's safe-to-break test.
function passesSafeTest(sh: Shaper, g: number, k: number): boolean {
  const p = sh.p
  const group = p.groups[g]!
  return isClusterBoundary(p, k) && !joinsAcross(p, k, group.start, group.end) && pairAdjust16(sh, g, k, group.start, group.end) === 0
}

// The offsets where [a, b) is cut into pieces below 256 zoomed px. A space is a cluster of its own, and HarfBuzz's
// syllable-based shapers build syllables only from their script's characters (hb-ot-shaper-myanmar-machine.rl,
// hb-ot-shaper-use-machine.rl), so a cut beside a space keeps every lookup but pair kerning inside one piece, and the pair
// adjustment adds that (blink-gaps §3.2, §3.6 L4). A cut inside a word can split a syllable whose clusters the pair test
// sees one at a time (Myanmar medials and stacked consonants). The cut is the offset nearest the middle beside a space
// that passes the safe test, else any offset that passes it, else the nearest cluster boundary, reported as
// unsafe-to-break.
function addCuts(sh: Shaper, g: number, a: number, b: number, cuts: number[]): void {
  const p = sh.p
  const group = p.groups[g]!
  if (measure16(sh, g, a, b, group.start, group.end) < EXACT16) return
  const mid = a + ((b - a) >> 1)
  let spaceCut = -1
  let safeCut = -1
  let boundary = -1
  for (let d = 0; spaceCut < 0 && (mid - d > a || mid + d < b); d++) {
    for (let side = 0; side < 2 && spaceCut < 0; side++) {
      const c = side === 0 ? mid - d : mid + d
      if (c <= a || c >= b || p.graphemeStarts[c] !== 1) continue
      if (boundary < 0) boundary = c
      const besideSpace = (p.text.charCodeAt(c - 1) === 0x20) !== (p.text.charCodeAt(c) === 0x20)
      if (!besideSpace && safeCut >= 0) continue
      if (!passesSafeTest(sh, g, c)) continue
      if (besideSpace) spaceCut = c
      else safeCut = c
    }
  }
  if (boundary < 0) {
    addGap(sh.gaps, 'float32-precision', p.styles[group.style]!.run, 'a grapheme cluster of 256 zoomed px or more', sourceRange(p, a, b))
    return
  }
  let k = spaceCut >= 0 ? spaceCut : safeCut
  if (k < 0) {
    k = boundary
    addGap(sh.gaps, 'unsafe-to-break', p.styles[group.style]!.run, 'a shaping group of 256 zoomed px or more has no offset near its middle that the pair test calls safe; the pieces add the pair adjustment there', sourceOffsetAt(p, k))
  }
  addCuts(sh, g, a, k, cuts)
  cuts.push(k)
  addCuts(sh, g, k, b, cuts)
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
    addCuts(sh, g, group.start, group.end, cuts)
    cuts.push(group.end)
    const prefix = [0]
    for (let i = 1; i < cuts.length; i++) {
      prefix.push(prefix[i - 1]! + measure16(sh, g, cuts[i - 1]!, cuts[i]!, group.start, group.end) + (i < cuts.length - 1 ? pairAdjust16(sh, g, cuts[i]!, group.start, group.end) : 0))
    }
    group.cuts = cuts
    group.prefixAtCut = prefix
  }
}

// The part of pair adjustment d between the clusters on both sides of an offset that the glyph before it carries
// (FontFacts.pairKerning): all of it on the first glyph's advance, or kern >> 1 where the kern and kerx pair machine applies
// it (hb-kern.hh:102-106). Where the fact isn't given, the first glyph's.
export function pairBefore16(sh: Shaper, g: number, d: number): number {
  switch (sh.p.styles[sh.p.groups[g]!.style]!.pairKerning) {
    case 'split': return d >> 1
    case 'first-advance': case null: return d
  }
}

// The 16.16 advance sum of group g before offset k: the glyphs of the clusters before k in the paragraph's shaping.
export function groupPrefix16(sh: Shaper, g: number, k: number): number {
  const p = sh.p
  const group = p.groups[g]!
  if (k >= group.end) return group.prefixAtCut[group.prefixAtCut.length - 1]! - group.startTrim16 - group.endTrim16
  k = clusterStartAtOrBefore(p, k, group.start)
  if (k <= group.start) return 0
  const cuts = group.cuts
  let lo = 0
  let hi = cuts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cuts[mid]! <= k) lo = mid
    else hi = mid - 1
  }
  const pair = pairBefore16(sh, g, pairAdjust16(sh, g, k, group.start, group.end))
  // prefixAtCut holds the whole adjustment at its cut, which belongs to both glyphs around it.
  let base = cuts[lo] === k ? group.prefixAtCut[lo]! - pairAdjust16(sh, g, k, group.start, group.end) + pair : group.prefixAtCut[lo]! + measure16(sh, g, cuts[lo]!, k, group.start, group.end) + pair
  // An open mark halted after the character before it carries the adjustment itself (ShouldKern), so it isn't before k.
  if (kernsAfter(sh, g, k, group.start, group.end)) base -= pair
  // HanKerning halted the group's first character (han_kerning.cc:235-262), which every later position includes.
  return base - group.startTrim16
}

function kernsAfter(sh: Shaper, g: number, k: number, lo: number, hi: number): boolean {
  const p = sh.p
  if (p.is8Bit || k <= lo || k >= hi || !hanKerningMayApply(p.hanKerningCandidates, lo, hi)) return false
  const data = hanKerningFontData(p, p.groups[g]!.style)
  if (!data.hasHalt) return false
  const type = resolvedCharType(data, p.text.charCodeAt(k))
  const last = resolvedCharType(data, p.text.charCodeAt(k - 1))
  return shouldKern(type, last) && !shouldKernLast(type, last)
}

const HAN_KERNING_DETAIL = 'a HanKerning trim added from Canvas facts: `halt` through the 「「 pair trim and character types from ink bounds (han_kerning.cc:417-535)'

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
  addGap(sh.gaps, 'han-kerning', p.styles[style]!.run, HAN_KERNING_DETAIL, sourceRange(p, a, a + 1))
  return trim16(sh, style, c)
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
  addGap(sh.gaps, 'han-kerning', p.styles[style]!.run, HAN_KERNING_DETAIL, sourceRange(p, b - 1, b))
  return trim16(sh, style, c)
}

// A ShapeResult for one item: a text item's cut of its group, or the tab run CreateForTabulationCharacters builds.
export type ShapeResult =
  | { kind: 'group'; group: number; start: number; end: number; rtl: boolean; width16: number; base16: number }
  | { kind: 'tabs'; start: number; end: number; rtl: boolean; first16: number; rest16: number; width16: number }

// An item's result is the group's glyphs whose cluster starts in the item's range (CopyRange through FindGlyphDataRange), so
// an item edge inside a glyph cluster counts as the next cluster boundary.
export function itemShapeResult(sh: Shaper, itemIndex: number): ShapeResult {
  const p = sh.p
  const item = p.items[itemIndex]!
  const group = p.groups[item.group]!
  const base16 = groupPrefix16(sh, item.group, sliceEdge(p, item.start, group.start, group.end))
  return {
    kind: 'group', group: item.group, start: item.start, end: item.end, rtl: (item.bidiLevel & 1) === 1,
    width16: groupPrefix16(sh, item.group, sliceEdge(p, item.end, group.start, group.end)) - base16, base16,
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
export function safeToBreak(sh: Shaper, sr: ShapeResult, k: number): boolean {
  switch (sr.kind) {
    case 'tabs':
      return true
    case 'group': {
      const group = sh.p.groups[sr.group]!
      if (k <= group.start) return group.startTrim16 === 0
      if (k >= group.end) return true
      return passesSafeTest(sh, sr.group, k)
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

export function snappedWidth(sr: ShapeResult): number {
  return luCeil(widthOf16(sr.width16))
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

// CachedOffsetForPosition (shape_result.cc:2261-2323), returning an absolute text_content offset.
export function offsetForPosition(sh: Shaper, sr: ShapeResult, x: number): number {
  const length = sr.end - sr.start
  if (x <= 0) return sr.start + (!sr.rtl ? 0 : length)
  if (f32(x / 64) >= widthOf16(sr.width16)) return sr.start + (!sr.rtl ? length : 0)
  // x_position[v] for visual index v: LTR the position of offset v, RTL the advance of the logical last v characters.
  // In RTL every character of a cluster takes the cluster's left edge: the advance after the cluster's end
  // (ComputePositionData, shape_result.cc:2113-2200).
  const xPosition = (v: number): number => !sr.rtl ? ceilFrom16(prefix16(sh, sr, sr.start + v))
    : ceilFrom16(sr.width16 - prefix16(sh, sr, v === 0 ? sr.end : sr.kind === 'group' ? clusterEndAfter(sh.p, sr.start + length - v - 1, sr.end) : sr.start + length - v))
  let low = 0
  let high = length - 1
  while (low <= high) {
    const mid = low + ((high - low) >> 1)
    const position = xPosition(mid)
    if (position <= x && (mid + 1 === length || xPosition(mid + 1) > x)) {
      if (!sr.rtl) return sr.start + mid
      return sr.start + (position === x ? length - mid : length - mid - 1)
    }
    if (x < position) high = mid - 1
    else low = mid + 1
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
export function callPrefix16(sh: Shaper, call: ReshapeCall, k: number): number {
  if (k <= call.start) return 0
  if (k >= call.end) return call.width16
  const p = sh.p
  k = clusterStartAtOrBefore(p, k, call.start)
  if (k <= call.start) return 0
  const pair = pairBefore16(sh, call.group, pairAdjust16(sh, call.group, k, call.start, call.end))
  let base = measure16(sh, call.group, call.start, k, call.start, call.end) + pair
  if (kernsAfter(sh, call.group, k, call.start, call.end)) base -= pair
  return base - call.startTrim16
}

// A view takes the glyphs whose character index, their cluster's first character, lies in its range
// (GlyphDataRange::FindGlyphDataRange, glyph_data_range.cc:56-90), so a range edge inside a glyph cluster gives the cluster to
// the part holding its start: the edge counts as the next cluster boundary. Positions (CachedPositionForOffset) snap the
// other way, to the cluster's start (shape_result.cc:2113-2200).
function sliceEdge(p: BlinkPrepared, k: number, lo: number, hi: number): number {
  if (k <= lo || k >= hi) return k
  let e = k
  while (e < hi && !isClusterBoundary(p, e)) e++
  return e
}

function rangeSlicePrefix16(sh: Shaper, sr: ShapeResult, k: number): number {
  return prefix16(sh, sr, sr.kind === 'group' ? sliceEdge(sh.p, k, sr.start, sr.end) : k)
}

function callSlicePrefix16(sh: Shaper, call: ReshapeCall, k: number): number {
  return callPrefix16(sh, call, sliceEdge(sh.p, k, call.start, call.end))
}

export function partWidth16(sh: Shaper, part: Part): number {
  switch (part.kind) {
    case 'range': return rangeSlicePrefix16(sh, part.sr, part.end) - rangeSlicePrefix16(sh, part.sr, part.start)
    case 'reshape': return callSlicePrefix16(sh, part.call, part.end) - callSlicePrefix16(sh, part.call, part.start)
  }
}

// The source range of the grapheme around text_content offset k (k inside it or at its start).
export function graphemeSourceRange(p: BlinkPrepared, k: number): { start: number; end: number } {
  let a = Math.min(k, p.text.length)
  while (a > 0 && p.graphemeStarts[a] !== 1) a--
  let b = a + 1
  while (b < p.text.length && p.graphemeStarts[b] !== 1) b++
  return sourceRange(p, a, Math.min(b, p.text.length))
}

export const GRAPHEME_CLUSTERS_DETAIL ='a position inside a grapheme at a character HarfBuzz doesn\'t mark a continuation: the glyphs form one cluster or two as the font\'s lookups merge them (ligate_input, hb-ot-layout-gsubgpos.hh:1500-1510), which Canvas totals don\'t show; the port gives the grapheme one position'

function makeView(sh: Shaper, parts: Part[], rtl: boolean, startIndex: number, charIndexOffset: number, numCharacters: number): View {
  let width = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    // A view edge inside a grapheme (a line edge, a bidi run edge, trailing spaces split off) takes the grapheme's position.
    const g = part.kind === 'reshape' ? part.call.group : part.sr.kind === 'group' ? part.sr.group : -1
    if (g >= 0) {
      for (const edge of [part.start, part.end]) {
        if (startsClusterInsideGrapheme(sh.p, edge)) addGap(sh.gaps, 'glyph-clusters', sh.p.styles[sh.p.groups[g]!.style]!.run, GRAPHEME_CLUSTERS_DETAIL, graphemeSourceRange(sh.p, edge))
      }
    }
    width = f32(width + widthOf16(partWidth16(sh, part)))
  }
  return { parts, width, rtl, startIndex, charIndexOffset, numCharacters }
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
    if (start < k) {
      switch (part.kind) {
        case 'range': sum += rangeSlicePrefix16(sh, part.sr, k) - rangeSlicePrefix16(sh, part.sr, part.start); break
        case 'reshape': sum += callSlicePrefix16(sh, part.call, k) - callSlicePrefix16(sh, part.call, part.start); break
      }
    }
    break
  }
  return sum
}

// LineBreaker::ShapeText (line_breaker.cc:2044-2064): [start, end) shaped alone with the current style's spacing.
export function reshape(sh: Shaper, g: number, start: number, end: number, isLineStart: boolean = false): ReshapePart {
  const startTrim16 = hanKerningStartTrim16(sh, g, start, end, isLineStart)
  const endTrim16 = hanKerningEndTrim16(sh, g, start, end)
  const width16 = measure16(sh, g, start, end, start, end) - startTrim16 - endTrim16
  return { kind: 'reshape', call: { group: g, start, end, startTrim16, endTrim16, width16 }, start, end, index: start, offset: 0, length: end - start }
}

// A line-end reshape with `han_kerning_end` (shaping_line_breaker.cc:344-363; harfbuzz_shaper.cc:1018-1030): HanKerning
// halts the last character whatever follows (apply_end), with the start context as usual.
export function reshapeHanKerningEnd(sh: Shaper, g: number, start: number, end: number): ReshapePart {
  const p = sh.p
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
          addGap(sh.gaps, 'han-kerning', p.styles[style]!.run, HAN_KERNING_DETAIL, sourceRange(p, end - 1, end))
          endTrim16 = trim16(sh, style, c)
          break
        default:
          addGap(sh.gaps, 'han-kerning', p.styles[style]!.run, 'a line-end halt on a character that isn\'t a fullwidth open or close mark: Canvas can\'t show whether its font halts it (shaping_line_breaker.cc:344-363)', sourceRange(p, end - 1, end))
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
export function hyphenText(style: BlinkStyle): string {
  switch (style.font.facts.mapsHyphen) {
    case true: return '‐'
    case false: return '-'
    case null: return '‐'
  }
}

// LineBreaker::AddHyphen shapes the hyphen whenever a break at a soft hyphen is tried (line_breaker.cc:728-760), and its
// width decides whether the break fits. Where mapsHyphen isn't given and U+002D measures differently in the run's
// context, that decision rests on the default, so the line being filled reports hyphen-glyph.
export function shapeHyphen(sh: Shaper, style: number): { text: string; inlineSize: number } {
  const contexts = sh.p.contexts[style]!
  const st = sh.p.styles[style]!
  const text = hyphenText(st)
  const raw16 = raw16Of(sh, contexts, contexts.hyphen, text)
  if (st.font.facts.mapsHyphen === null && raw16 !== raw16Of(sh, contexts, contexts.hyphen, '-')) {
    addGap(sh.gaps, 'hyphen-glyph', st.run, 'a soft hyphen break the line breaker tried in a font the declaration gives no mapsHyphen fact for: Blink draws U+2010 when the primary font maps it and U+002D otherwise, and the two measure differently here (computed_style.cc:1804-1820)')
  }
  return { text, inlineSize: Math.max(0, luCeil(widthOf16(raw16))) }
}

// ShapeResult::CreateForTabulationCharacters with Font::TabWidth (shape_result.cc:1898-1944, font.cc:303-340): the
// block's font (TabSizeAncestor) and spacing (TabSizeWithSpacing), the first tab to the next stop from `position`. Blink
// counts stops from SimpleFontData::SpaceWidth, the platform advance (simple_font_data.cc:225-240) without `trak` tracking
// and before 16.16 truncation; Canvas gives the shaping advance (gap tab-stops, probe blink-followups F4).
export function tabShapeResult(sh: Shaper, start: number, end: number, rtl: boolean, positionLU: number, run: number, style: number): ShapeResult {
  const p = sh.p
  addGap(sh.gaps, 'tab-stops', run, 'tab stops count from the platform space advance, without `trak` tracking and untruncated; Canvas gives the tracked 16.16 advance (simple_font_data.cc:225-240, font.cc:303-340)', sourceRange(p, start, end))
  // The item's tab-size (style.GetTabSize(), line_breaker.cc:2968) with the block's font and spacing (FontForTab under
  // TabSizeAncestor, inline_node.cc:2130-2140).
  const block = p.styles[0]!
  const contexts = p.contexts[0]!
  const space = widthOf16(raw16Of(sh, contexts, contexts.hyphen, ' '))
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
