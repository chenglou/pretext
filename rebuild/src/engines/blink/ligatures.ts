// Glyph clusters a font's ligatures form, from the font declaration's facts (FontFacts.fonts: coverage and ligatures per
// listed family; DESIGN.md §1.2). HarfBuzz merges the clusters of the characters a lookup ligates (ligate_input,
// hb-ot-layout-gsubgpos.hh:1500-1510; the morx ligature subtable, hb-aat-layout-morx-table.hh), Blink gives every character
// of a cluster the cluster's position and shares its advance among its graphemes (ComputePositionData,
// shape_result.cc:2113-2200; :228-349), never breaks inside one (OffsetToFit with BreakGlyphsOption(false), :684-694), and
// gives a cluster over an item edge to the item holding its first character (glyph_data_range.cc:56-90). Canvas totals show
// none of it: Geeza Pro's lam-lam-heh ligature has the advance of its parts. Without the facts a position between two
// characters of one shaping call is a stand-in (shape.ts positionLimit).
import { blinkOtLanguageTags } from '../../breaks/generated/blink-break-tables.js'
import type { LigatureFacts, LigaturePattern, ListedFontFacts } from '../../model.js'
import { isMark } from './props.js'
import { isSegmentEdge } from './shape.js'
import type { BlinkPrepared } from './types.js'

// What the facts say about the boundary before a text_content unit: nothing; no glyph cluster covers it; a ligature's
// cluster covers it; a listed ligature may cover it (one the facts don't settle: not formed in every context tried, not
// shaped in every combination, marks between components the facts didn't try).
export const LIGATURE_UNKNOWN = 0
export const LIGATURE_NONE = 1
export const LIGATURE_MERGED = 2
export const LIGATURE_UNCERTAIN = 3

let otTags: Map<string, string[]> | null = null

// hb_ot_tags_from_language for a locale of one subtag (hb-ot-tag.cc:322-420).
function otLanguageTags(language: string): string[] {
  if (otTags === null) {
    otTags = new Map()
    const entries = blinkOtLanguageTags.split('|')
    for (let i = 0; i < entries.length; i++) {
      const eq = entries[i]!.indexOf('=')
      otTags.set(entries[i]!.slice(0, eq), entries[i]!.slice(eq + 1).split(',').filter(tag => tag.length > 0))
    }
  }
  return otTags.get(language) ?? []
}

// Whether the locale HarfBuzz shapes under (LayoutLocale::HarfbuzzLanguage: the content locale, else the application's) may
// select one of the language systems the facts didn't try. A locale of several subtags goes through
// hb_ot_tags_from_complex_language first, which isn't ported, so it may.
function mayUseOtherLanguageSystem(facts: LigatureFacts, locale: string | null): boolean {
  if (facts.languageSystems.length === 0) return false
  if (locale === null) return true
  const subtags = locale.toLowerCase().split(/[-_]/)
  if (subtags.length > 1) return true
  const tags = otLanguageTags(subtags[0]!)
  for (let i = 0; i < facts.languageSystems.length; i++) {
    const tag = facts.languageSystems[i]!.split('/')[2]
    if (tag !== undefined && tags.includes(tag)) return true
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
    if (matched < 0) return null
    at += matched
  }
  return { end: at, certain }
}

// Per text_content offset, what the ligature facts say about the boundary before it (the constants above), and per unit of
// a shaping group the listed family that draws its glyph cluster (-1: a font the facts don't name).
export function fontFactsOfText(p: BlinkPrepared): { ligature: Uint8Array; fontRun: Int16Array } {
  const out = new Uint8Array(p.text.length + 1)
  const fontRun = new Int16Array(p.text.length).fill(-1)
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    const style = p.styles[group.style]!
    const fonts = style.font.facts.fonts
    if (fonts === undefined) continue
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
    const usable = (f: number): LigatureFacts | null => {
      if (f < 0) return null
      const facts = fonts[f]!.ligatures
      return facts === null || mayUseOtherLanguageSystem(facts, locale) ? null : facts
    }
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
  }
  return { ligature: out, fontRun }
}
