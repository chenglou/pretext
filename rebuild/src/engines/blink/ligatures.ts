// Glyph clusters a font's ligatures form, from the font declaration's facts (FontFacts.fonts: coverage and ligatures per
// listed family; DESIGN.md §1.2). HarfBuzz merges the clusters of the characters a lookup ligates (ligate_input,
// hb-ot-layout-gsubgpos.hh:1500-1510; the morx ligature subtable, hb-aat-layout-morx-table.hh), Blink gives every character
// of a cluster the cluster's position and shares its advance among its graphemes (ComputePositionData,
// shape_result.cc:2113-2200; :228-349), never breaks inside one (OffsetToFit with BreakGlyphsOption(false), :684-694), and
// gives a cluster over an item edge to the item holding its first character (glyph_data_range.cc:56-90). Canvas totals show
// none of it: Geeza Pro's lam-lam-heh ligature has the advance of its parts. Without the facts a position between two
// characters of one shaping call is a stand-in (limits.ts positionLimit).
import { blinkOtLanguageTags } from './generated/break-tables.js'
import type { LigatureFacts, LigaturePattern, ListedFontFacts } from '../../model.js'
import { raw16Of } from './contexts.js'
import { isMark, joiningType } from './props.js'
import { isSegmentEdge } from './emoji.js'
import type { BlinkGroup, BlinkPrepared, BlinkStyle } from './types.js'

// What the facts say about the boundary before a text_content unit: nothing (0); no glyph cluster covers it; a ligature's
// cluster covers it; a listed ligature may cover it (one the facts don't settle: not formed in every context tried, not
// shaped in every combination, marks between components the facts didn't try).
export const LIGATURE_NONE = 1
export const LIGATURE_MERGED = 2
export const LIGATURE_UNCERTAIN = 3
// No fact speaks, and the port takes the letters for one glyph cluster by default (assumedClusters): read as merged
// (shape.ts isClusterBoundary), and never as a fact, so a line that can break between any two glyph clusters reports
// glyph-clusters over it (gaps.ts) and a position inside it is a stand-in (limits.ts positionLimit).
export const LIGATURE_ASSUMED = 4

// The study's switch (branch x-lam-alef): what a boundary no ligature fact settles is taken for. Only the study's
// predictors write it (lab/baselines/cluster-default-*.ts); it is no input of the library.
// - 'letters': every letter is its own glyph cluster, which is what the port did before the study;
// - 'lam-alef': lam and the alef after it are one cluster, with combining marks between them or not. The set is the four
//   lam-alef ligatures Unicode encodes (U+FEF5 to U+FEFC: lam U+0644 before alef U+0622, U+0623, U+0625 and U+0627), which
//   is HarfBuzz's own table for a font without GSUB (hb-ot-shaper-arabic-table.hh ligature_table);
// - 'encoded-ligatures': those, and where letter spacing is 0 (it turns liga off, font_features.cc:54-86) the Latin
//   ligatures Unicode encodes at U+FB00 to U+FB04 (ff, fi, fl, ffi, ffl) and lam lam heh where the first lam doesn't join
//   the letter before it (the fonts that draw it as one glyph do so there alone: Arial, Tahoma, Courier New, Geeza Pro);
// - 'canvas-lam-alef': 'lam-alef' where the style's Canvas context measures lam, alef otherwise than lam, U+200D, alef
//   (the Arabic shaper's ligating features don't skip a U+200D, hb-ot-shaper-arabic.cc:209-231), else 'letters'.
export type ClusterDefault = 'letters' | 'lam-alef' | 'encoded-ligatures' | 'canvas-lam-alef'
export const study: { clusterDefault: ClusterDefault } = { clusterDefault: 'letters' }

const LAM = 0x644
const HEH = 0x647
const LATIN_LIGATURES = ['ffi', 'ffl', 'ff', 'fi', 'fl']

function isLigatingAlef(cp: number): boolean {
  return cp === 0x622 || cp === 0x623 || cp === 0x625 || cp === 0x627
}

// Whether Canvas measures lam, alef otherwise than lam, U+200D, alef in the style's context: more than a unit of
// 1/65536 px a glyph apart (Blink truncates every glyph's advance to one, skia_text_metrics.cc:207-211), asked once a style.
function canvasLigatesLamAlef(st: BlinkStyle): boolean {
  if (st.canvasLigatesLamAlef !== null) return st.canvasLigatesLamAlef
  const joined = raw16Of(st.contexts, st.contexts.rtl, String.fromCharCode(LAM, 0x627))
  const apart = raw16Of(st.contexts, st.contexts.rtl, String.fromCharCode(LAM, 0x200d, 0x627))
  return st.canvasLigatesLamAlef = Math.abs(joined - apart) > 2 * st.contexts.scale
}

// The end of the base characters `count` positions after text offset `at`, with the combining marks before each skipped
// (a ligature lookup that ignores marks ligates over them, and ligate_input merges their clusters in,
// hb-ot-layout-gsubgpos.hh:1500-1560); -1 where one of them isn't `wanted`'s.
function basesEnd(text: string, at: number, limit: number, wanted: readonly ((cp: number) => boolean)[]): number {
  for (let w = 0; w < wanted.length; w++) {
    while (at < limit && isMark(text.codePointAt(at)!)) at += text.codePointAt(at)! > 0xffff ? 2 : 1
    if (at >= limit || !wanted[w]!(text.charCodeAt(at))) return -1
    at++
  }
  return at
}

// Whether the letter at text offset k joins the letter before it inside [start, k): that one is dual-joining, left-joining
// or join-causing, with transparent characters between them skipped (Unicode 9.2, rules R1 to R7).
function joinsBefore(text: string, k: number, start: number): boolean {
  for (let i = k - 1; i >= start; i--) {
    const type = joiningType(text.charCodeAt(i))
    if (type !== 5) return type === 1 || type === 3 || type === 4
  }
  return false
}

// Marks the boundaries inside the sequences of group [start, end) that the study's default takes for one glyph cluster,
// where no fact speaks about the boundary before the sequence's last letter.
function assumedClusters(p: BlinkPrepared, group: BlinkGroup, st: BlinkStyle): void {
  const variant = study.clusterDefault
  if (variant === 'letters') return
  const text = p.text
  const out = p.ligature
  const others = variant === 'encoded-ligatures' && st.letterSpacing === 0
  for (let k = group.start; k < group.end; k++) {
    const unit = text.charCodeAt(k)
    let end = -1
    if (unit === LAM) {
      if (others && !joinsBefore(text, k, group.start)) end = basesEnd(text, k + 1, group.end, [cp => cp === LAM, cp => cp === HEH])
      if (end < 0) end = basesEnd(text, k + 1, group.end, [isLigatingAlef])
      if (end >= 0 && variant === 'canvas-lam-alef' && !canvasLigatesLamAlef(st)) end = -1
    } else if (unit === 0x66 && others) {
      for (let n = 0; n < LATIN_LIGATURES.length && end < 0; n++) if (text.startsWith(LATIN_LIGATURES[n]!, k) && k + LATIN_LIGATURES[n]!.length <= group.end) end = k + LATIN_LIGATURES[n]!.length
    }
    if (end < 0) continue
    let unsettled = true
    for (let i = k + 1; i < end; i++) if (out[i] !== 0) unsettled = false
    if (unsettled) out.fill(LIGATURE_ASSUMED, k + 1, end)
    k = end - 1
  }
}

// hb_ot_tags_from_language for a locale of one subtag (hb-ot-tag.cc:322-420): whether `tag` is one of the language's tags,
// in the generated records, [code, tag, ...] sorted by code.
function languageHasOtTag(language: string, tag: string): boolean {
  let lo = 0
  let hi = blinkOtLanguageTags.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const record = blinkOtLanguageTags[mid]!
    if (record[0] === language) return record.indexOf(tag, 1) >= 0
    if (record[0]! < language) lo = mid + 1
    else hi = mid - 1
  }
  return false
}

// Whether the locale HarfBuzz shapes under (LayoutLocale::HarfbuzzLanguage: the content locale, else the application's) may
// select one of the language systems the facts didn't try. A locale of several subtags goes through
// hb_ot_tags_from_complex_language first, which isn't ported, so it may.
function mayUseOtherLanguageSystem(facts: LigatureFacts, locale: string | null): boolean {
  if (facts.languageSystems.length === 0) return false
  if (locale === null) return true
  const subtags = locale.toLowerCase().split(/[-_]/)
  if (subtags.length > 1) return true
  for (let i = 0; i < facts.languageSystems.length; i++) {
    const tag = facts.languageSystems[i]!.split('/')[2]
    if (tag !== undefined && languageHasOtTag(subtags[0]!, tag)) return true
  }
  return false
}

function covers(coverage: readonly number[], cp: number): boolean {
  let lo = 0
  let hi = coverage.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < coverage[2 * mid]!) hi = mid - 1
    else if (cp > coverage[2 * mid + 1]!) lo = mid + 1
    else return true
  }
  return false
}

// Whether listed family f of a style's font declaration maps code point cp, by its coverage fact; null when the fact isn't given.
export function listedFontCovers(fonts: readonly ListedFontFacts[] | undefined, f: number, cp: number): boolean | null {
  if (fonts === undefined || f < 0 || f >= fonts.length || fonts[f]!.coverage === null) return null
  return covers(fonts[f]!.coverage!, cp)
}

// Default-ignorable characters and joiners take no glyph of their own that decides the font (HarfBuzzShaper keeps a cluster
// in the font that draws its visible characters; hb-unicode.hh:170-197).
function decidesFont(cp: number): boolean {
  return !(cp === 0xad || cp === 0x34f || cp === 0x61c || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff)
}

// The listed family that draws text_content [a, b), a glyph cluster: the first one realized whose font maps every character
// of it (the shaper moves a cluster with a missing glyph to the next font whole, harfbuzz_shaper.cc:560-700). -1 where a
// family before it isn't known to be realized or to cover the cluster, or none covers it: a font the facts don't name.
function fontOf(p: BlinkPrepared, fonts: readonly ListedFontFacts[], a: number, b: number): number {
  for (let f = 0; f < fonts.length; f++) {
    const font = fonts[f]!
    if (font.realizes === false) continue
    if (font.realizes === null || font.coverage === null) return -1
    let all = true
    for (let i = a; i < b && all;) {
      const cp = p.text.codePointAt(i)!
      i += cp > 0xffff ? 2 : 1
      if (decidesFont(cp) && !covers(font.coverage, cp)) all = false
    }
    if (all) return f
  }
  return -1
}

type Match = { end: number; certain: boolean }

// A pattern at text_content offset i inside [i, limit): one alternative per position, in order, with combining marks
// between components skipped as the pattern's acrossMark says. Returns where the last component ends.
function matchPattern(p: BlinkPrepared, pattern: LigaturePattern, i: number, limit: number): Match | null {
  const text = p.text
  let at = i
  let certain = pattern.exact && pattern.everyContext
  for (let position = 0; position < pattern.positions.length; position++) {
    if (position > 0) {
      let marks = 0
      while (at < limit && isMark(text.codePointAt(at)!)) { at += text.codePointAt(at)! > 0xffff ? 2 : 1; marks++ }
      if (marks > 0) {
        // The fact covers a mark after the first component only.
        if (position === 1 && pattern.acrossMark === false) return null
        if (position > 1 || pattern.acrossMark === null) certain = false
      }
    }
    const alternatives = pattern.positions[position]!
    let matched = -1
    for (let a = 0; a < alternatives.length; a++) {
      const alternative = alternatives[a]!
      if (alternative.length > 0 && alternative.length > matched && at + alternative.length <= limit && text.startsWith(alternative, at)) matched = alternative.length
    }
    if (matched < 0) {
      // An alternative of several characters is a listed string shaped whole: combining marks between its characters are
      // skipped as between positions (lam, kasra, alef is Courier New's lam-alef ligature natively, c-ba72f46bea4d347c).
      let end = -1
      for (let a = 0; a < alternatives.length && end < 0; a++) {
        const across = matchAcrossMarks(text, at, limit, alternatives[a]!)
        if (across === null || (across.afterFirst && pattern.acrossMark === false)) continue
        end = across.end
        if (across.later || pattern.acrossMark === null) certain = false
      }
      if (end < 0) return null
      at = end
      continue
    }
    at += matched
  }
  return { end: at, certain }
}

// A listed string at text offset `at` with combining marks of the text skipped before each of its characters but the
// first (never before a mark the string itself holds): where it ends, and whether marks were skipped after its first
// character and after later ones. Null when the string isn't there or no mark was skipped.
function matchAcrossMarks(text: string, at: number, limit: number, listed: string): { end: number; afterFirst: boolean; later: boolean } | null {
  let i = at
  let afterFirst = false
  let later = false
  for (let a = 0, component = 0; a < listed.length; component++) {
    const cp = listed.codePointAt(a)!
    if (component > 0 && !isMark(cp)) {
      while (i < limit && isMark(text.codePointAt(i)!)) {
        i += text.codePointAt(i)! > 0xffff ? 2 : 1
        if (component === 1) afterFirst = true
        else later = true
      }
    }
    if (i >= limit || text.codePointAt(i) !== cp) return null
    const size = cp > 0xffff ? 2 : 1
    i += size
    a += size
  }
  return afterFirst || later ? { end: i, afterFirst, later } : null
}

// Fills the prepared paragraph's `ligature`, per text_content offset what the ligature facts say about the boundary before
// it (the constants above), and its `fontRun`, per unit of a shaping group the listed family that draws its glyph cluster
// (-1: a font the facts don't name).
export function fontFactsOfText(p: BlinkPrepared): void {
  const out = p.ligature
  const fontRun = p.fontRun
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    const style = p.styles[group.style]!
    const fonts = style.font.facts.fonts
    if (fonts === undefined) {
      assumedClusters(p, group, style)
      continue
    }
    const locale = style.locale ?? p.env.uiLanguage
    // The glyph clusters before ligatures: grapheme starts HarfBuzz doesn't mark a continuation.
    const starts: number[] = []
    for (let k = group.start; k < group.end; k++) if (p.graphemeStarts[k] === 1 && p.continuations[k] !== 1) starts.push(k)
    if (starts.length === 0 || starts[0] !== group.start) starts.unshift(group.start)
    starts.push(group.end)
    const fontAt: number[] = []
    for (let c = 0; c + 1 < starts.length; c++) {
      const f = fontOf(p, fonts, starts[c]!, starts[c + 1]!)
      fontAt.push(f)
      fontRun.fill(f, starts[c]!, starts[c + 1]!)
    }
    // Per listed family, its ligature facts where they hold under the locale.
    const usableFacts = fonts.map(font => font.ligatures === null || mayUseOtherLanguageSystem(font.ligatures, locale) ? null : font.ligatures)
    const usable = (f: number): LigatureFacts | null => f < 0 ? null : usableFacts[f]!
    // Lookups skip default-ignorable glyphs (hb-ot-layout-gsubgpos.hh:558-571), so a ligature can form over a cluster of
    // them, which the listed strings don't hold: the boundaries next to one stay unknown.
    const ignorable = (c: number): boolean => {
      for (let i = starts[c]!; i < starts[c + 1]!;) {
        const cp = p.text.codePointAt(i)!
        i += cp > 0xffff ? 2 : 1
        if (decidesFont(cp)) return false
      }
      return true
    }
    // Between clusters of two known fonts nothing ligates: each font's glyphs are a HarfBuzz call of their own.
    for (let c = 1; c + 1 < starts.length; c++) {
      const before = fontAt[c - 1]!
      const after = fontAt[c]!
      if (before < 0 || after < 0 || ignorable(c - 1) || ignorable(c)) continue
      if (before !== after) { out[starts[c]!] = LIGATURE_NONE; continue }
      const facts = usable(before)
      if (facts !== null && facts.complete) out[starts[c]!] = LIGATURE_NONE
    }
    // Ligatures form left to right in logical order, the longest listed one first: a listed string was shaped whole and
    // came out as one glyph, so the font prefers it to its shorter beginnings.
    for (let c = 0; c + 1 < starts.length;) {
      const f = fontAt[c]!
      const facts = usable(f)
      let next = c + 1
      if (facts !== null) {
        // The stretch of clusters in the same font and script segment.
        let limitCluster = c
        while (limitCluster + 1 < starts.length - 1 && fontAt[limitCluster + 1] === f && !isSegmentEdge(p, starts[limitCluster + 1]!)) limitCluster++
        const limit = starts[limitCluster + 1]!
        let best: Match | null = null
        for (let n = 0; n < facts.patterns.length; n++) {
          const pattern = facts.patterns[n]!
          // Under letter spacing Blink turns liga, clig and calt off (font_features.cc:54-86): only `spaced` ligatures form.
          if (style.letterSpacing !== 0 && !pattern.spaced) continue
          const match = matchPattern(p, pattern, starts[c]!, limit)
          if (match === null) continue
          if (best === null || match.end > best.end || (match.end === best.end && match.certain && !best.certain)) best = match
        }
        if (best !== null) {
          // The ligature's cluster runs to the next cluster start at or after its last component's end.
          let endCluster = c + 1
          while (starts[endCluster]! < best.end) endCluster++
          for (let inner = c + 1; inner < endCluster; inner++) {
            const k = starts[inner]!
            if (best.certain) out[k] = LIGATURE_MERGED
            else if (out[k] !== LIGATURE_MERGED) out[k] = LIGATURE_UNCERTAIN
          }
          if (best.certain && endCluster > c + 1) next = endCluster
        }
      }
      c = next
    }
    assumedClusters(p, group, style)
  }
}
