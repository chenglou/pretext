// Widths from Canvas for Blink's shape results (specs/blink-lines.md §1.3-§1.4, §3, §6, §11, §12; specs/blink-gaps.md
// §3; DESIGN.md §4.4).
//
// The DOM shapes a shaping group in one HarfBuzz call. Canvas splits a string into words at U+0020, TAB and ZWSP and
// shapes each alone (plain_text_node.cc:84-155), so measured strings carry U+2028 in place of U+0020: Blink maps U+2028
// to the space glyph (harfbuzz_face.cc:110-113) and Canvas doesn't split there (specs/blink-gaps.md §3.3, H5-H8). Canvas
// word spacing stays 0 and word spacing is added in 16.16 integers, and letter spacing is the context's.
//
// A group is measured in pieces, cut at space edges and every MAX_PIECE code units, and halved until each is narrower
// than 256 zoomed px. Where pieces meet, the adjustment
// HarfBuzz made between the two neighbouring grapheme clusters, d = R(xy) − R(x) − R(y), is added and put on the glyph
// before the cut, as GPOS pair kerning does (specs/blink-gaps.md §3.2, §3.5). The same pair total decides safe-to-break:
// an offset with d ≠ 0 is unsafe (necessary, not sufficient; gap unsafe-to-break). Pieces stay below 256 zoomed px, where
// Canvas totals are exact 16.16 values (blink-canvas §1.5).
import { measureContext, measureText, type Measurer } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import { hanKerningFontData, hanKerningMayApply, resolvedCharType, shouldKern, shouldKernLast, trim16 } from './hankerning.js'
import { joiningType, scriptKind } from './props.js'
import type { BlinkPrepared, BlinkStyle } from './types.js'

const f32 = Math.fround
const LS = '\u2028'
const MAX_PIECE = 32

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

export function styleContexts(m: Measurer, style: BlinkStyle, zoom: number): { ltr: number; rtl: number; hyphen: number } {
  // Computed font size f32(specified × zoom); DOM and Canvas both floor it to 1/100 (specs/blink-lines.md §2.3).
  const font = canvasFont(style.font, f32(f32(style.font.size) * f32(zoom)))
  const lang = style.locale ?? ''
  const letterSpacing = `${f32(style.letterSpacing * zoom)}px`
  // optimizeLegibility sets kKerning | kLigatures, so Canvas shapes a whole bidi run in one call when the primary font's
  // GPOS or GSUB coverage holds the space glyph (font_fallback_list.cc:264-286; blink-canvas H6 confirmed). It adds no
  // HarfBuzz feature (font_features.cc:32-240). Other fonts still split before CJK bases (plain_text_node.cc:115-153).
  const base = { font, lang, wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'optimizeLegibility' as const, partition: '' }
  return {
    ltr: measureContext(m, { ...base, letterSpacing, direction: 'ltr' }),
    rtl: measureContext(m, { ...base, letterSpacing, direction: 'rtl' }),
    // The hyphen is shaped alone without spacing (hyphen_result.cc:12-16).
    hyphen: measureContext(m, { ...base, letterSpacing: '0px', direction: 'ltr' }),
  }
}

// The string Canvas measures for text_content[from, to): U+0020 → U+2028; SHY dropped, because Canvas turns it into
// ZWSP, which splits a word (gap soft-hyphen-shaping); VT and FF → U+0001, which takes the same fallback font, because
// Canvas turns U+0009..U+000D into spaces (blink-gaps §2.8, blink-canvas H2). CR in collapse modes is already a space,
// and CR and FF in preserve modes are control items.
function canvasText(p: BlinkPrepared, from: number, to: number): { s: string; formFeeds: number } {
  let s = ''
  let formFeeds = 0
  let chunkStart = from
  const text = p.text
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x20 || c === 0xad || c === 0x0b || c === 0x0c) {
      s += text.slice(chunkStart, i)
      if (c === 0x20) s += LS
      else if (c === 0x0b) s += '\u0001'
      else if (c === 0x0c) { s += '\u0001'; formFeeds++ }
      chunkStart = i + 1
    }
  }
  return { s: s + text.slice(chunkStart, to), formFeeds }
}

export type Shaper = {
  p: BlinkPrepared
  m: Measurer
}

// Joining_Type D, L or C joins the following character; D, R or C the preceding one; T is transparent.
function joinsFollowing(jt: number): boolean { return jt === 1 || jt === 3 || jt === 4 }
function joinsPreceding(jt: number): boolean { return jt === 1 || jt === 2 || jt === 4 }

// Whether HarfBuzz's Arabic shaper gives the characters on both sides of offset k joining forms: the nearest
// non-transparent character before k joins to the following one and the nearest after k to the preceding one
// (hb-ot-shaper-arabic.cc:305-360). Inside a shaping group both sides are in one call.
export function joinsAcross(p: BlinkPrepared, k: number): boolean {
  const text = p.text
  let before = 0
  for (let i = k; i > 0;) {
    const cp = text.codePointAt(i - 1)!
    const size = (cp & 0xfc00) === 0xdc00 && i >= 2 && (text.charCodeAt(i - 2) & 0xfc00) === 0xd800 ? 2 : 1
    const full = size === 2 ? text.codePointAt(i - 2)! : cp
    const jt = joiningType(full)
    i -= size
    if (jt !== 5) { before = jt; break }
  }
  if (!joinsFollowing(before)) return false
  for (let j = k; j < text.length;) {
    const cp = text.codePointAt(j)!
    const jt = joiningType(cp)
    j += cp > 0xffff ? 2 : 1
    if (jt !== 5) return joinsPreceding(jt)
  }
  return false
}

// Math.round(W × 65536) of text_content[from, to) inside group g, in its context, with JS word spacing and FF letter
// spacing removed (TreatAsZeroWidthSpace skips FF, character.h:163-189). Where the paragraph's shaping joins letters
// across an edge of the range, U+200D on that side keeps the joining form: Canvas has no HarfBuzz context, and with the
// direction of the item it joins through a ZWJ (probes-chrome.md blink-text H29).
export function measure16(sh: Shaper, g: number, from: number, to: number): number {
  const { p, m } = sh
  if (from >= to) return 0
  const group = p.groups[g]!
  const contexts = p.contexts[group.style]!
  const { s, formFeeds } = canvasText(p, from, to)
  const zwjBefore = from > group.start && joinsAcross(p, from) ? '\u200d' : ''
  const zwjAfter = to < group.end && joinsAcross(p, to) ? '\u200d' : ''
  const w = s.length === 0 ? 0 : Math.round(measureText(m, group.rtl ? contexts.rtl : contexts.ltr, zwjBefore + s + zwjAfter) * 65536)
  const st = p.styles[group.style]!
  const ls16 = st.letterSpacing === 0 ? 0 : raw16Trunc(f32(st.letterSpacing * p.layoutZoom))
  return w - formFeeds * ls16 + spacesInCursiveRuns(p, from, to) * ls16 + wordSpacing16(p, group.style, from, to)
}

// Letter spacing skips clusters of cursive scripts except spaces (shape_result_spacing.cc:118-130). A U+2028 standing for
// a space in such a run isn't a space to Canvas, so the space's spacing is added back: the space takes the script of the
// nearest character before it that has one, else after it (ScriptRunIterator merging Common characters).
function spacesInCursiveRuns(p: BlinkPrepared, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) {
    if (p.text.charCodeAt(i) !== 0x20) continue
    let kind = 1
    for (let j = i - 1; j >= from && kind === 1; j--) kind = scriptKind(p.text.charCodeAt(j))
    for (let j = i + 1; j < to && kind === 1; j++) kind = scriptKind(p.text.charCodeAt(j))
    if (kind === 2) n++
  }
  return n
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

// d at offset k inside group g: the adjustment between the clusters on both sides of k.
export function pairAdjust16(sh: Shaper, g: number, k: number): number {
  const group = sh.p.groups[g]!
  if (k <= group.start || k >= group.end) return 0
  const a = graphemeStartAtOrBefore(sh.p, k - 1, group.start)
  const b = graphemeEndAfter(sh.p, k, group.end)
  return measure16(sh, g, a, b) - measure16(sh, g, a, k) - measure16(sh, g, k, b)
}

// Cuts and piece prefixes for every group (the widths Blink knows before filling lines).
export function measureGroups(sh: Shaper): void {
  const p = sh.p
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    const cuts = [group.start]
    for (let k = group.start + 1; k < group.end; k++) {
      if (p.graphemeStarts[k] !== 1) continue
      const spaceEdge = (p.text.charCodeAt(k - 1) === 0x20) !== (p.text.charCodeAt(k) === 0x20)
      if (spaceEdge || k - cuts[cuts.length - 1]! >= MAX_PIECE) cuts.push(k)
    }
    cuts.push(group.end)
    const exact: number[] = [group.start]
    const prefix = [0]
    const addPiece = (from: number, to: number): void => {
      const w = measure16(sh, g, from, to)
      if (w >= 0x1000000) {
        // Canvas totals of 256 zoomed px or more are float32-rounded (blink-canvas §1.5): halve at a cluster boundary.
        let mid = from + ((to - from) >> 1)
        while (mid > from && p.graphemeStarts[mid] !== 1) mid--
        if (mid > from) {
          addPiece(from, mid)
          addPiece(mid, to)
          return
        }
      }
      exact.push(to)
      prefix.push(prefix[prefix.length - 1]! + w + pairAdjust16(sh, g, to))
    }
    for (let i = 1; i < cuts.length; i++) addPiece(cuts[i - 1]!, cuts[i]!)
    // The paragraph's shaping of the group reads the characters on both sides of it (HanKerning context).
    const startTrim = hanKerningStartTrim16(sh, g, group.start, group.end, false)
    for (let i = 1; i < prefix.length; i++) prefix[i]! -= startTrim
    prefix[prefix.length - 1]! -= hanKerningEndTrim16(sh, g, group.start, group.end)
    group.cuts = exact
    group.prefixAtCut = prefix
  }
}

// The 16.16 advance sum of group g before offset k: the glyphs of the clusters before k in the paragraph's shaping.
export function groupPrefix16(sh: Shaper, g: number, k: number): number {
  const p = sh.p
  const group = p.groups[g]!
  if (k >= group.end) return group.prefixAtCut[group.prefixAtCut.length - 1]!
  k = graphemeStartAtOrBefore(p, k, group.start)
  const cuts = group.cuts
  let lo = 0
  let hi = cuts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cuts[mid]! <= k) lo = mid
    else hi = mid - 1
  }
  const base = cuts[lo] === k ? group.prefixAtCut[lo]! : group.prefixAtCut[lo]! + measure16(sh, g, cuts[lo]!, k) + pairAdjust16(sh, g, k)
  // An open mark halted after the character before it carries the adjustment itself (ShouldKern), so it isn't before k.
  return base - (kernsAfter(sh, g, k) ? pairAdjust16(sh, g, k) : 0)
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

// HanKerning::AppendFontFeatures start context (han_kerning.cc:235-262): a range that doesn't start a line halts its first
// character when ShouldKern holds with the character before it.
function hanKerningStartTrim16(sh: Shaper, g: number, a: number, b: number, isLineStart: boolean): number {
  const p = sh.p
  if (a === 0 || isLineStart || !hanKerningMayApply(p.text, p.is8Bit, a, b)) return 0
  const style = p.groups[g]!.style
  const data = hanKerningFontData(sh, style)
  if (!data.hasHalt) return 0
  const c = p.text.charCodeAt(a)
  return shouldKern(resolvedCharType(data, c), resolvedCharType(data, p.text.charCodeAt(a - 1))) ? trim16(sh, style, c) : 0
}

// The end context (han_kerning.cc:264-300): the last character halts when ShouldKernLast holds with the one after.
function hanKerningEndTrim16(sh: Shaper, g: number, a: number, b: number): number {
  const p = sh.p
  if (b >= p.text.length || !hanKerningMayApply(p.text, p.is8Bit, a, b)) return 0
  const style = p.groups[g]!.style
  const data = hanKerningFontData(sh, style)
  if (!data.hasHalt) return 0
  const c = p.text.charCodeAt(b - 1)
  return shouldKernLast(resolvedCharType(data, p.text.charCodeAt(b)), resolvedCharType(data, c)) ? trim16(sh, style, c) : 0
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

// safe_to_break_before per offset (shape_result.cc:1360-1392): at the result's start (a run start, or a group cut
// HarfBuzz didn't flag), never inside a cluster, else not where the pair total shows an adjustment. Tab glyphs are all
// safe (shape_result.cc:1932).
export function safeToBreak(sh: Shaper, sr: ShapeResult, k: number): boolean {
  switch (sr.kind) {
    case 'tabs':
      return true
    case 'group': {
      const group = sh.p.groups[sr.group]!
      if (k <= group.start || k >= group.end) return true
      return sh.p.graphemeStarts[k] === 1 && pairAdjust16(sh, sr.group, k) === 0
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
  const width16 = measure16(sh, g, start, end) - hanKerningStartTrim16(sh, g, start, end, isLineStart) - hanKerningEndTrim16(sh, g, start, end)
  return { kind: 'reshape', start, end, width16 }
}

// A line-end reshape with `han_kerning_end` (shaping_line_breaker.cc:344-363; harfbuzz_shaper.cc:1018-1030): HanKerning
// halts the last character whatever follows (apply_end), with the start context as usual.
export function reshapeHanKerningEnd(sh: Shaper, g: number, start: number, end: number): ReshapePart {
  const p = sh.p
  let width16 = measure16(sh, g, start, end) - hanKerningStartTrim16(sh, g, start, end, false)
  if (hanKerningMayApply(p.text, p.is8Bit, start, end)) {
    const style = p.groups[g]!.style
    if (hanKerningFontData(sh, style).hasHalt) width16 -= trim16(sh, style, p.text.charCodeAt(end - 1))
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
  const size = f32(f32(st.font.size) * f32(p.layoutZoom))
  const probe = (fallback: string): number => measureText(m, measureContext(m, {
    font: canvasFont({ ...st.font, family: `${st.font.family}, ${fallback}` }, size), lang: st.locale ?? '', letterSpacing: '0px',
    wordSpacing: '0px', fontKerning: 'auto', textRendering: 'auto', direction: 'ltr', partition: '',
  }), '\u2010')
  const text = probe('"Courier New"') === probe('Georgia') ? '\u2010' : '-'
  return { text, inlineSize: Math.max(0, luCeil(measureText(m, p.contexts[style]!.hyphen, text))) }
}

// ShapeResult::CreateForTabulationCharacters with Font::TabWidth (shape_result.cc:1898-1944, font.cc:303-340): the
// block's font (TabSizeAncestor) and spacing (TabSizeWithSpacing), the first tab to the next stop from `position`.
export function tabShapeResult(sh: Shaper, start: number, end: number, rtl: boolean, positionLU: number): ShapeResult {
  const { p, m } = sh
  const block = p.styles[0]!
  const space = f32(measureText(m, p.contexts[0]!.hyphen, ' '))
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
