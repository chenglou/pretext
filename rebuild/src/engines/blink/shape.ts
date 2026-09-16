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
// between the clusters on both sides of k, d = R(xy) − R(x) − R(y), on the glyph before k as GPOS first-glyph pair values
// put it (blink-gaps §3.4-§3.5; legacy `kern` puts d >> 1 there, reported as unsafe-to-break at line edges).
//
// Every shaping call carries up to 5 code points of text_content on each side as context
// (case_mapping_harfbuzz_buffer_filler.cc:32-43, hb-buffer.hh:109-111), and Arabic joining reads it
// (hb-ot-shaper-arabic.cc:305-372). Canvas has no context, so a measured range gets U+200D on each side where the text joins
// across that edge, which gives the OpenType joining forms (probe blink-followups F1: Amiri keeps them on every one-letter
// line). AAT fonts such as Geeza Pro shape with `morx`, which never reads the context (hb-ot-shape.cc:60-66, 100-101), and
// take isolated forms at such edges instead; Canvas can't tell the two apart (gap unsafe-to-break).
import { measureContext, measureText, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import { addGap } from './gaps.js'
import { hanKerningFontData, hanKerningMayApply, resolvedCharType, shouldKern, shouldKernLast, trim16 } from './hankerning.js'
import { HAN_CLOSE, HAN_OPEN, USCRIPT_LATIN, isCursiveScript, isWhiteSpace, joiningType } from './props.js'
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

// Blink resolves `system-ui` and `BlinkMacSystemFont` to the system UI font, whose DOM advances at the zoomed size are the
// CSS-size advances scaled, because opsz and HarfBuzz ptem take the specified size (font_platform_data_mac.mm:170-178,
// harfbuzz_face.cc:648; probes-chrome correction 7: DOM(S) = ceil64(W(S) × DPR) at 10-28px). Other families are measured at
// the zoomed size (specs/blink-lines.md §2.3).
export function measuresAtCssSize(family: string): boolean {
  const first = family.split(',')[0]!.trim()
  return first === 'system-ui' || first === 'BlinkMacSystemFont'
}

export function styleContexts(m: Measurer, style: BlinkStyle, zoom: number, partition: string): StyleContexts {
  const cssSize = measuresAtCssSize(style.font.family)
  const scale = cssSize ? zoom : 1
  // Computed font size f32(specified × zoom); DOM and Canvas both floor it to 1/100 (specs/blink-lines.md §2.3).
  const font = canvasFont(style.font, cssSize ? f32(style.font.size) : f32(f32(style.font.size) * f32(zoom)))
  const lang = style.locale ?? ''
  const letterSpacing = `${cssSize ? f32(style.letterSpacing) : f32(style.letterSpacing * zoom)}px`
  // optimizeLegibility sets kKerning | kLigatures, so Canvas shapes a whole bidi run in one call when the primary font's
  // GPOS or GSUB coverage holds the space glyph (font_fallback_list.cc:264-286; blink-canvas H6 confirmed). It adds no
  // HarfBuzz feature (font_features.cc:32-240). Other fonts still split before CJK bases (plain_text_node.cc:115-153).
  const base = { font, lang, wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'optimizeLegibility' as const, partition }
  return {
    ltr: measureContext(m, { ...base, letterSpacing, direction: 'ltr' }),
    rtl: measureContext(m, { ...base, letterSpacing, direction: 'rtl' }),
    // The hyphen is shaped alone without spacing (hyphen_result.cc:12-16).
    hyphen: measureContext(m, { ...base, letterSpacing: '0px', direction: 'ltr' }),
    scale,
  }
}

export type Shaper = {
  p: BlinkPrepared
  m: Measurer
}

// Math.round(W × 65536) of a Canvas string, in 16.16 units of the zoomed px.
export function raw16Of(sh: Shaper, contexts: StyleContexts, context: number, s: string): number {
  return Math.round(measureText(sh.m, context, s) * contexts.scale * 65536)
}

// Joining_Type D, L or C joins the following character; D, R or C the preceding one; T is transparent.
function joinsFollowing(jt: number): boolean { return jt === 1 || jt === 3 || jt === 4 }
function joinsPreceding(jt: number): boolean { return jt === 1 || jt === 2 || jt === 4 }

// How the port assumes joining letters on both sides of a shaping call's edge (a group edge, a line-edge reshape) were
// shaped. 'opentype': HarfBuzz's Arabic shaper joins them through the call's context (hb-ot-shaper-arabic.cc:305-372).
// 'aat': fonts with `morx` shape with it, which never reads the context (hb-ot-shape.cc:60-66, 100-101), so they don't
// join. Canvas can't tell which path a font takes (gap unsafe-to-break); inside one call both join. Over the lab's 5,272
// Arabic cases 'opentype' keeps 562 more line counts and 583 more breaks, and 'aat' 111 more widths, all in Geeza Pro
// (specs/blink-RESULTS.md, joining model).
export const JOINING_CONTEXT: 'opentype' | 'aat' = 'opentype'

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

function allDefaultIgnorable(p: BlinkPrepared, from: number, to: number): boolean {
  for (let i = from; i < to;) {
    const cp = p.text.codePointAt(i)!
    if (!isDefaultIgnorable(cp)) return false
    i += cp > 0xffff ? 2 : 1
  }
  return true
}

// Whether a measured range of group g gets U+200D at its edge k, where text on the other side joins: inside the call the
// paragraph's shaping stands for, the letters are joined; at the call's edge (group edges, and both edges of a reshape)
// only under the OpenType model, through the context.
function joinedAtEdge(p: BlinkPrepared, g: number, k: number, from: number, to: number, reshaping: boolean): boolean {
  const group = p.groups[g]!
  if (!reshaping && k > group.start && k < group.end) return joinsAcross(p, k, group.start, group.end)
  switch (JOINING_CONTEXT) {
    case 'opentype': return joinsAcross(p, k, from, to)
    case 'aat': return false
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
// and Blink keys storage on V8's representation (to_blink_string.cc:216-227). A paragraph that RunSegmenter segments gets
// 16-bit strings where V8 keeps them 16-bit: slices of a 16-bit string, except those of 1 and 2 code units, which V8 makes
// 8-bit when their code units allow.
//
// The default-ignorable characters Canvas turns into U+200B end a Canvas word (TreatAsZeroWidthSpaceInComplexScriptLegacy,
// character.h:167-175; plain_text_node.cc:47-62, 85-91): SHY, ZWSP, LRM, RLM, U+202A..U+202E and U+FEFF. The DOM keeps
// such a character in the shaping call. RunSegmenter's emoji scanner sees a non-emoji character there, so `👍` SHY `🏽`
// stays two segments (emoji_segmentation_category_inline_header.h:15-77); a combining mark after it starts another cluster;
// `morx` state machines see its glyph (hb-aat-layout-common.hh:1226-1241); HarfBuzz hides it only after substitution
// (hb-ot-shape.cc:951-959). U+2060 WORD JOINER has the same HarfBuzz properties (gc Cf, neither joiner nor hidden:
// hb-ot-layout.hh:212-244), script Common, emoji category kMaxCategory and bidi class BN, and Canvas doesn't normalize it,
// so the string carries U+2060 instead (probe blink-ignorables: emoji sequences, Geeza Pro and Amiri joining, Thai marks,
// kerning and letter spacing all equal the DOM). Where the string without the character would be 8-bit (an 8-bit
// paragraph, or 1 or 2 code units, as above), the character is left out and the string keeps that storage; every probed
// Latin-1 string equals the DOM that way. The RTL item `‏((` in Amiri is one: 1567 units natively and left out, 2814 with
// U+2060 or the character itself. That difference isn't storage (`(((` measures the same as an 8-bit and a 16-bit string)
// and its cause isn't known. A `morx` substitution across a character left out can still differ (gap soft-hyphen-shaping).
type CanvasString = { s: string; units: Int32Array; twoByte: boolean; leftOut: boolean }

function canvasString(p: BlinkPrepared, from: number, to: number, zwjBefore: boolean, zwjAfter: boolean): CanvasString {
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
  const twoByte = wide || (p.segmented && codes.length - substituted.length > 2)
  const leftOut = !twoByte && substituted.length > 0
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
  const forced = twoByte && !wide && substituted.length === 0
  return { s: forced ? ('Ā' + s).slice(1) : s, units: Int32Array.from(units), twoByte, leftOut }
}

// Math.round(W × 65536) of text_content[from, to) inside group g, in its context, with JS word spacing and the letter
// spacing Canvas gives other characters than the DOM does. `reshaping`: the range is its own shaping call.
export function measure16(sh: Shaper, g: number, from: number, to: number, reshaping: boolean = false): number {
  const p = sh.p
  if (from >= to) return 0
  const group = p.groups[g]!
  const contexts = p.contexts[group.style]!
  const cs = canvasString(p, from, to, joinedAtEdge(p, g, from, from, to, reshaping), joinedAtEdge(p, g, to, from, to, reshaping))
  const w = cs.s.length === 0 ? 0 : raw16Of(sh, contexts, group.rtl ? contexts.rtl : contexts.ltr, cs.s)
  const scripts = cs.twoByte ? scriptsPerUnit(cs.s) : null
  const st = p.styles[group.style]!
  if (cs.leftOut && cs.s.length > 1) {
    addGap(p, 'soft-hyphen-shaping', st.run, `text_content [${from}, ${to}) is measured as an 8-bit string without its default-ignorable characters, whose glyphs a \`morx\` substitution across them still sees in the DOM (hb-aat-layout-common.hh:1226-1241)`)
  }
  const ls16 = st.letterSpacing === 0 ? 0 : raw16Trunc(f32(st.letterSpacing * p.layoutZoom))
  let adjust = wordSpacing16(p, group.style, from, to)
  for (let u = 0; u < cs.units.length; u++) {
    const t = cs.units[u]!
    if (t < 0) continue
    const canvasScript = scripts === null ? USCRIPT_LATIN : scripts[u]!
    // A word's characters shaped under another script than the paragraph's (DESIGN.md §5 script-context); white space is
    // the space glyph's own matter (space-in-shaping).
    if (canvasScript !== p.scripts[t] && !isWhiteSpace(p.text.charCodeAt(t))) {
      addGap(p, 'script-context', st.run, `text_content [${from}, ${to}) shapes a character as UScriptCode ${canvasScript} in Canvas and ${p.scripts[t]} in the paragraph (harfbuzz_shaper.cc:1072-1101)`)
    }
    if (ls16 === 0) continue
    // Letter spacing skips cursive runs except on spaces (shape_result_spacing.cc:118-130) and FF (TreatAsZeroWidthSpace,
    // character.h:163-189). U+2028 isn't a space and U+0001 isn't zero width to Canvas.
    const cursive = isCursiveScript(canvasScript)
    switch (p.text.charCodeAt(t)) {
      case 0x20: if (cursive) adjust += ls16; break
      case 0x0c: if (!cursive) adjust -= ls16; break
    }
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

function graphemeStartAtOrBefore(p: BlinkPrepared, k: number, min: number): number {
  while (k > min && p.graphemeStarts[k] !== 1) k--
  return k
}

function graphemeEndAfter(p: BlinkPrepared, k: number, max: number): number {
  let e = k + 1
  while (e < max && p.graphemeStarts[e] !== 1) e++
  return e
}

// d at offset k inside group g: the adjustment between the clusters on both sides of k. HarfBuzz's lookups skip
// default-ignorable glyphs (hb-ot-layout-gsubgpos.hh:558-571), so a side that holds only default-ignorable characters
// (U+200B between two letters) reaches to the next cluster.
export function pairAdjust16(sh: Shaper, g: number, k: number): number {
  const p = sh.p
  const group = p.groups[g]!
  if (k <= group.start || k >= group.end) return 0
  let a = graphemeStartAtOrBefore(p, k - 1, group.start)
  while (a > group.start && allDefaultIgnorable(p, a, k)) a = graphemeStartAtOrBefore(p, a - 1, group.start)
  let b = graphemeEndAfter(p, k, group.end)
  while (b < group.end && allDefaultIgnorable(p, k, b)) b = graphemeEndAfter(p, b, group.end)
  return measure16(sh, g, a, b) - measure16(sh, g, a, k) - measure16(sh, g, k, b)
}

// Whether offset k inside group g passes the port's safe-to-break test.
function passesSafeTest(sh: Shaper, g: number, k: number): boolean {
  const p = sh.p
  const group = p.groups[g]!
  return p.graphemeStarts[k] === 1 && !joinsAcross(p, k, group.start, group.end) && pairAdjust16(sh, g, k) === 0
}

// The offsets where [a, b) is cut into pieces below 256 zoomed px. A space is a cluster of its own, and HarfBuzz's
// syllable-based shapers build syllables only from their script's characters (hb-ot-shaper-myanmar-machine.rl,
// hb-ot-shaper-use-machine.rl), so a cut beside a space keeps every lookup but pair kerning inside one piece, and the pair
// adjustment adds that (blink-gaps §3.2, §3.6 L4). A cut inside a word can split a syllable whose clusters the pair test
// sees one at a time (Myanmar medials and stacked consonants). The cut is the offset nearest the middle beside a space
// that passes the safe test, else any offset that passes it, else the nearest cluster boundary.
function addCuts(sh: Shaper, g: number, a: number, b: number, cuts: number[]): void {
  const p = sh.p
  if (measure16(sh, g, a, b) < EXACT16) return
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
  const style = p.groups[g]!.style
  if (boundary < 0) {
    addGap(p, 'float32-precision', p.styles[style]!.run, 'a grapheme cluster of 256 zoomed px or more')
    return
  }
  let k = spaceCut >= 0 ? spaceCut : safeCut
  if (k < 0) {
    k = boundary
    addGap(p, 'unsafe-to-break', p.styles[style]!.run, 'a shaping group of 256 zoomed px or more has no offset near its middle that the pair test calls safe; the pieces add the pair adjustment there')
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
      prefix.push(prefix[i - 1]! + measure16(sh, g, cuts[i - 1]!, cuts[i]!) + (i < cuts.length - 1 ? pairAdjust16(sh, g, cuts[i]!) : 0))
    }
    group.cuts = cuts
    group.prefixAtCut = prefix
  }
}

// The 16.16 advance sum of group g before offset k: the glyphs of the clusters before k in the paragraph's shaping.
export function groupPrefix16(sh: Shaper, g: number, k: number): number {
  const p = sh.p
  const group = p.groups[g]!
  if (k >= group.end) return group.prefixAtCut[group.prefixAtCut.length - 1]! - group.startTrim16 - group.endTrim16
  k = graphemeStartAtOrBefore(p, k, group.start)
  if (k <= group.start) return 0
  const cuts = group.cuts
  let lo = 0
  let hi = cuts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cuts[mid]! <= k) lo = mid
    else hi = mid - 1
  }
  let base = cuts[lo] === k ? group.prefixAtCut[lo]! : group.prefixAtCut[lo]! + measure16(sh, g, cuts[lo]!, k) + pairAdjust16(sh, g, k)
  // An open mark halted after the character before it carries the adjustment itself (ShouldKern), so it isn't before k.
  if (kernsAfter(sh, g, k)) base -= pairAdjust16(sh, g, k)
  // HanKerning halted the group's first character (han_kerning.cc:235-262), which every later position includes.
  return base - group.startTrim16
}

function kernsAfter(sh: Shaper, g: number, k: number): boolean {
  const p = sh.p
  const group = p.groups[g]!
  if (p.is8Bit || k <= group.start || k >= group.end) return false
  const data = hanKerningFontData(sh, group.style)
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
  if (a === 0 || isLineStart || !hanKerningMayApply(p.text, p.is8Bit, a, b)) return 0
  const style = p.groups[g]!.style
  const data = hanKerningFontData(sh, style)
  if (!data.hasHalt) return 0
  const c = p.text.charCodeAt(a)
  if (!shouldKern(resolvedCharType(data, c), resolvedCharType(data, p.text.charCodeAt(a - 1)))) return 0
  addGap(p, 'han-kerning', p.styles[style]!.run, HAN_KERNING_DETAIL)
  return trim16(sh, style, c)
}

// The end context (han_kerning.cc:264-300): the last character halts when ShouldKernLast holds with the one after.
function hanKerningEndTrim16(sh: Shaper, g: number, a: number, b: number): number {
  const p = sh.p
  if (b >= p.text.length || !hanKerningMayApply(p.text, p.is8Bit, a, b)) return 0
  const style = p.groups[g]!.style
  const data = hanKerningFontData(sh, style)
  if (!data.hasHalt) return 0
  const c = p.text.charCodeAt(b - 1)
  if (!shouldKernLast(resolvedCharType(data, p.text.charCodeAt(b)), resolvedCharType(data, c))) return 0
  addGap(p, 'han-kerning', p.styles[style]!.run, HAN_KERNING_DETAIL)
  return trim16(sh, style, c)
}

// A ShapeResult for one item: a text item's cut of its group, or the tab run CreateForTabulationCharacters builds.
export type ShapeResult =
  | { kind: 'group'; group: number; start: number; end: number; rtl: boolean; width16: number; base16: number }
  | { kind: 'tabs'; start: number; end: number; rtl: boolean; first16: number; rest16: number; width16: number }

export function itemShapeResult(sh: Shaper, itemIndex: number): ShapeResult {
  const item = sh.p.items[itemIndex]!
  const base16 = groupPrefix16(sh, item.group, item.start)
  return {
    kind: 'group', group: item.group, start: item.start, end: item.end, rtl: (item.bidiLevel & 1) === 1,
    width16: groupPrefix16(sh, item.group, item.end) - base16, base16,
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
  const xPosition = (v: number): number => !sr.rtl ? ceilFrom16(prefix16(sh, sr, sr.start + v)) : ceilFrom16(sr.width16 - prefix16(sh, sr, sr.start + length - v))
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

// A ShapeResultView: up to three segments, its width the float32 sum of each part's float width
// (shape_result_view.cc:250-265).
export type Part =
  | { kind: 'range'; sr: ShapeResult; start: number; end: number }
  | { kind: 'reshape'; start: number; end: number; width16: number }

export type ReshapePart = Extract<Part, { kind: 'reshape' }>

export type View = { parts: Part[]; width: number }

export function partWidth16(sh: Shaper, part: Part): number {
  switch (part.kind) {
    case 'range': return prefix16(sh, part.sr, part.end) - prefix16(sh, part.sr, part.start)
    case 'reshape': return part.width16
  }
}

export function makeView(sh: Shaper, parts: Part[]): View {
  let width = 0
  for (let i = 0; i < parts.length; i++) width = f32(width + widthOf16(partWidth16(sh, parts[i]!)))
  return { parts, width }
}

// ShapeResultView::Create(result, start, end).
export function viewOf(sh: Shaper, sr: ShapeResult, start: number = sr.start, end: number = sr.end): View {
  return makeView(sh, [{ kind: 'range', sr, start, end }])
}

// LineBreaker::ShapeText (line_breaker.cc:2044-2064): [start, end) shaped alone with the current style's spacing.
export function reshape(sh: Shaper, g: number, start: number, end: number, isLineStart: boolean = false): ReshapePart {
  const width16 = measure16(sh, g, start, end, true) - hanKerningStartTrim16(sh, g, start, end, isLineStart) - hanKerningEndTrim16(sh, g, start, end)
  return { kind: 'reshape', start, end, width16 }
}

// A line-end reshape with `han_kerning_end` (shaping_line_breaker.cc:344-363; harfbuzz_shaper.cc:1018-1030): HanKerning
// halts the last character whatever follows (apply_end), with the start context as usual.
export function reshapeHanKerningEnd(sh: Shaper, g: number, start: number, end: number): ReshapePart {
  const p = sh.p
  let width16 = measure16(sh, g, start, end, true) - hanKerningStartTrim16(sh, g, start, end, false)
  if (hanKerningMayApply(p.text, p.is8Bit, start, end)) {
    const style = p.groups[g]!.style
    const data = hanKerningFontData(sh, style)
    if (data.hasHalt) {
      const c = p.text.charCodeAt(end - 1)
      // Canvas's `cc` halts one of the two only for fullwidth open and close marks (ShouldKern, ShouldKernLast); for
      // other types the difference is ordinary kerning (Arial `’’`), and `hasHalt` describes the font `「` falls back to.
      switch (resolvedCharType(data, c)) {
        case HAN_OPEN: case HAN_CLOSE:
          addGap(p, 'han-kerning', p.styles[style]!.run, HAN_KERNING_DETAIL)
          width16 -= trim16(sh, style, c)
          break
        default:
          addGap(p, 'han-kerning', p.styles[style]!.run, 'a line-end halt on a character that isn\'t a fullwidth open or close mark: Canvas can\'t show whether its font halts it (shaping_line_breaker.cc:344-363)')
      }
    }
  }
  return { kind: 'reshape', start, end, width16 }
}

// A view cut to [start, end): whole parts kept, a part cut at an edge measured from its own shaping.
export function truncateView(sh: Shaper, view: View, g: number, start: number, end: number): View {
  const parts: Part[] = []
  for (let i = 0; i < view.parts.length; i++) {
    const part = view.parts[i]!
    const a = Math.max(start, part.start)
    const b = Math.min(end, part.end)
    if (a >= b) continue
    switch (part.kind) {
      case 'range': parts.push({ kind: 'range', sr: part.sr, start: a, end: b }); break
      case 'reshape': parts.push(a === part.start && b === part.end ? part : reshape(sh, g, a, b)); break
    }
  }
  return makeView(sh, parts)
}

// HyphenResult (hyphen_result.cc:12-16): U+2010 when the primary font has it, else U+002D (computed_style.cc:1804-1820);
// the two-fallback test of specs/blink-gaps.md §5.5 tells whether the family list's primary font maps U+2010.
export function shapeHyphen(sh: Shaper, style: number): { text: string; inlineSize: number } {
  const { p, m } = sh
  const st = p.styles[style]!
  const contexts = p.contexts[style]!
  const size = contexts.scale === 1 ? f32(f32(st.font.size) * f32(p.layoutZoom)) : f32(st.font.size)
  const probe = (fallback: string): number => measureText(m, measureContext(m, {
    font: canvasFont({ ...st.font, family: `${st.font.family}, ${fallback}` }, size), lang: st.locale ?? '', letterSpacing: '0px',
    wordSpacing: '0px', fontKerning: 'auto', textRendering: 'auto', direction: 'ltr', partition: '',
  }), '‐')
  const text = probe('"Courier New"') === probe('Georgia') ? '‐' : '-'
  return { text, inlineSize: Math.max(0, luCeil(widthOf16(raw16Of(sh, contexts, contexts.hyphen, text)))) }
}

// ShapeResult::CreateForTabulationCharacters with Font::TabWidth (shape_result.cc:1898-1944, font.cc:303-340): the
// block's font (TabSizeAncestor) and spacing (TabSizeWithSpacing), the first tab to the next stop from `position`. Blink
// counts stops from SimpleFontData::SpaceWidth, the platform advance (simple_font_data.cc:225-240) without `trak` tracking
// and before 16.16 truncation; Canvas gives the shaping advance (gap tab-stops, probe blink-followups F4).
export function tabShapeResult(sh: Shaper, start: number, end: number, rtl: boolean, positionLU: number, run: number): ShapeResult {
  const p = sh.p
  addGap(p, 'tab-stops', run, 'tab stops count from the platform space advance, without `trak` tracking and untruncated; Canvas gives the tracked 16.16 advance (simple_font_data.cc:225-240, font.cc:303-340)')
  const block = p.styles[0]!
  const contexts = p.contexts[0]!
  const space = widthOf16(raw16Of(sh, contexts, contexts.hyphen, ' '))
  const ls = f32(block.letterSpacing * p.layoutZoom)
  const ws = f32(block.wordSpacing * p.layoutZoom)
  const base = f32(f32(p.paragraph.tabSize) * f32(f32(space + ls) + ws))
  const tabWidth = (position: number | null): number => {
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
