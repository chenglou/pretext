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
import { FontCoverage, cmapCovers as covers, decidesFont } from './font-coverage.js'
import { isMark } from './props.js'
import { isSegmentEdge } from './emoji.js'
import type { BlinkPrepared } from './types.js'

// What the facts say about the boundary before a text_content unit: nothing (0); no glyph cluster covers it; a ligature's
// cluster covers it; a listed ligature may cover it (one the facts don't settle: not formed in every context tried, not
// shaped in every combination, marks between components the facts didn't try).
export const LIGATURE_NONE = 1
export const LIGATURE_MERGED = 2
export const LIGATURE_UNCERTAIN = 3

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

// Whether listed family f of a style's font declaration maps code point cp, by its coverage fact; null when the fact isn't given.
export function listedFontCovers(fonts: readonly ListedFontFacts[] | undefined, f: number, cp: number): boolean | null {
  if (fonts === undefined || f < 0 || f >= fonts.length || fonts[f]!.coverage === null) return null
  return covers(fonts[f]!.coverage!, cp)
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
  // Skipping input marks can only lengthen the literal; the final astral codepoint may end one unit past limit.
  if (listed.length > limit - at + 1) return null
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

type LocalFacts = {
  source: LigatureFacts
  locales: Map<string | null, boolean>
  patterns: Map<number, LigaturePattern[]> | null
}
const NO_PATTERNS: readonly LigaturePattern[] = []

// First-position matching consumes no leading marks. Every match therefore starts with one alternative's first UTF16
// unit, including an alternative that names only a high surrogate. Keep the original pattern order in each bucket.
function patternsAt(facts: LocalFacts, firstUnit: number): readonly LigaturePattern[] {
  if (facts.patterns === null) {
    const index = new Map<number, LigaturePattern[]>()
    for (let n = 0; n < facts.source.patterns.length; n++) {
      const pattern = facts.source.patterns[n]!
      const first = pattern.positions[0]
      // Zero positions match only the start itself, changing no cluster boundary or candidate advance.
      if (first === undefined) continue
      for (let a = 0; a < first.length; a++) {
        const alternative = first[a]!
        if (alternative.length === 0) continue
        const unit = alternative.charCodeAt(0)
        const bucket = index.get(unit)
        if (bucket === undefined) index.set(unit, [pattern])
        // Several first alternatives (or an identical repeated source pattern) need only one identical match.
        else if (bucket[bucket.length - 1] !== pattern) bucket.push(pattern)
      }
    }
    facts.patterns = index
  }
  return facts.patterns.get(firstUnit) ?? NO_PATTERNS
}

// Fills the prepared paragraph's `ligature`, per text_content offset what the ligature facts say about the boundary before
// it (the constants above), and its `fontRun`, per unit of a shaping group the listed family that draws its glyph cluster
// (-1: a font the facts don't name).
export function fontFactsOfText(p: BlinkPrepared): void {
  const out = p.ligature
  const fontRun = p.fontRun
  // Source facts and locale interpretation belong to this preparation, not every shaping group or emitted paragraph.
  const coverageTables = new Map<readonly ListedFontFacts[], FontCoverage>()
  const localFacts = new Map<LigatureFacts, LocalFacts>()
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    const style = p.styles[group.style]!
    const fonts = style.font.facts.fonts
    if (fonts === undefined) continue
    let coverage = coverageTables.get(fonts)
    if (coverage === undefined) { coverage = new FontCoverage(fonts); coverageTables.set(fonts, coverage) }
    const locale = style.locale ?? p.env.uiLanguage
    // The glyph clusters before ligatures: grapheme starts HarfBuzz doesn't mark a continuation.
    const starts: number[] = []
    for (let k = group.start; k < group.end; k++) if (p.graphemeStarts[k] === 1 && p.continuations[k] !== 1) starts.push(k)
    if (starts.length === 0 || starts[0] !== group.start) starts.unshift(group.start)
    starts.push(group.end)
    const fontAt: number[] = []
    for (let c = 0; c + 1 < starts.length; c++) {
      const f = coverage.font(p.text, starts[c]!, starts[c + 1]!)
      fontAt.push(f)
      fontRun.fill(f, starts[c]!, starts[c + 1]!)
    }
    // Interpret only facts a cluster's selected family actually needs, once for each applicable locale.
    const usable = (f: number): LocalFacts | null => {
      if (f < 0) return null
      const source = fonts[f]!.ligatures
      if (source === null) return null
      let facts = localFacts.get(source)
      if (facts === undefined) {
        facts = { source, locales: new Map(), patterns: null }
        localFacts.set(source, facts)
      }
      let allowed = facts.locales.get(locale)
      if (allowed === undefined) {
        allowed = !mayUseOtherLanguageSystem(source, locale)
        facts.locales.set(locale, allowed)
      }
      return allowed ? facts : null
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
      if (facts !== null && facts.source.complete) out[starts[c]!] = LIGATURE_NONE
    }
    // Ligatures form left to right in logical order, the longest listed one first: a listed string was shaped whole and
    // came out as one glyph, so the font prefers it to its shorter beginnings.
    // This endpoint belongs to one same-font/script stretch; later candidates inside it share the endpoint.
    let limitCluster = -1
    // Earlier uncertain spans can only stay uncertain or become merged; later candidates write just their extension.
    let uncertainEndCluster = 0
    for (let c = 0; c + 1 < starts.length;) {
      const f = fontAt[c]!
      const facts = usable(f)
      let next = c + 1
      if (facts !== null) {
        // The stretch of clusters in the same font and script segment.
        if (limitCluster < c) {
          limitCluster = c
          while (limitCluster + 1 < starts.length - 1 && fontAt[limitCluster + 1] === f && !isSegmentEdge(p, starts[limitCluster + 1]!)) limitCluster++
        }
        const limit = starts[limitCluster + 1]!
        let best: Match | null = null
        const patterns = patternsAt(facts, p.text.charCodeAt(starts[c]!))
        for (let n = 0; n < patterns.length; n++) {
          const pattern = patterns[n]!
          // Under letter spacing Blink turns liga, clig and calt off (font_features.cc:54-86): only `spaced` ligatures form.
          if (style.letterSpacing !== 0 && !pattern.spaced) continue
          const match = matchPattern(p, pattern, starts[c]!, limit)
          if (match === null) continue
          if (best === null || match.end > best.end || (match.end === best.end && match.certain && !best.certain)) best = match
        }
        if (best !== null) {
          // The ligature's cluster runs to the next cluster start at or after its last component's end.
          let endCluster = c + 1
          if (starts[endCluster]! < best.end) {
            let lo = endCluster + 1, hi = starts.length
            while (lo < hi) {
              const mid = (lo + hi) >>> 1
              if (starts[mid]! < best.end) lo = mid + 1
              else hi = mid
            }
            endCluster = lo
          }
          const firstInner = best.certain ? c + 1 : Math.max(c + 1, uncertainEndCluster)
          for (let inner = firstInner; inner < endCluster; inner++) {
            const k = starts[inner]!
            if (best.certain) out[k] = LIGATURE_MERGED
            else if (out[k] !== LIGATURE_MERGED) out[k] = LIGATURE_UNCERTAIN
          }
          if (best.certain && endCluster > c + 1) next = endCluster
          if (!best.certain) uncertainEndCluster = Math.max(uncertainEndCluster, endCluster)
        }
      }
      c = next
    }
  }
}
