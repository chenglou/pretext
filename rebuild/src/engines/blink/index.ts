// Blink (Chrome 153.0.8010.48). prepare builds text_content, items, bidi levels, script runs and shaping groups from the
// inline tree and measures the groups; nextLine runs LineBreaker::NextLine for one line in one layout opportunity and
// returns what LogicalLineBuilder and InlineLayoutAlgorithm make of its item results: the fragment items in visual order
// at their LayoutUnit positions, with glyph clusters and the offset mapping (DESIGN.md §2.3), and the fragments in logical
// order.
import { indexContent } from '../../content.js'
import type { BlinkEnvironment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type {
  BlinkGlyphCluster, BlinkItem, BlinkLine, BlinkLineGeometry, BlinkLineResult, BlinkMappingUnit, BlinkShapeRun, Fragment, Gap, LineSlot, Paragraph, TextAlign,
} from '../../model.js'
import { graphemeBoundaries, graphemeRulesFor } from '../../unicode/grapheme.js'
import type { EngineImplementation } from '../engine.js'
import { hasDictionaryCharacters, lineTable } from './breaks.js'
import { breaksShapingAfter, breaksShapingBefore, buildContent, collapsesWhiteSpace, lengthLU, segmentBidiRuns, stylesOf, wrapsLines } from './content.js'
import { emojiPriorities } from './emoji.js'
import { addGap, sourceOffsetAt, sourceRange } from './gaps.js'
import { hanKerningCandidates, hanKerningMayApply, measureHanKerningFontData } from './hankerning.js'
import { LIGATURE_MERGED, LIGATURE_NONE, LIGATURE_UNCERTAIN, fontFactsOfText } from './ligatures.js'
import { LineBreaker, type LineInfo } from './line-breaker.js'
import { USCRIPT_LATIN, isCjkIdeographOrSymbol, isDefaultIgnorable, isExtendedPictographic, isMark } from './props.js'
import { scriptsPerUnit } from './script.js'
import {
  adjust16, ceilFrom16, isSegmentEdge, positionAdjust16, graphemeSourceRange, groupPrefix16, isClusterBoundary, joinsAcross, luCeil, startsClusterInsideGrapheme, GRAPHEME_CLUSTERS_DETAIL, luTrunc, measureGroups,
  isFontRunEdge, pairAdjust16, pairAdjustNoLigatures16, pairPlacementUnknown, partGraphemeStarts, partPrefix16, partWidth16, positionLimit, requeuedSpaceAt, styleContexts, viewPositionLimit, viewPrefix16, widthOf16, type Shaper, type View,
} from './shape.js'
import type { BlinkGroup, BlinkLineStart, BlinkPrepared } from './types.js'

// InlineNode::ShapeText's grouping (inline_node.cc:1625-1680): equal Font, equal direction, no control item or atomic
// inline between, no ZWNJ at an item start, and no open or close tag whose box edges or vertical-align break shaping
// (ShouldBreakShapingBeforeBox, ShouldBreakShapingAfterBox, :494-527). EqualsRunSegment compares segment data that items
// only get in a paragraph with one segment (inline_item.cc:187-196, inline_node.cc:1256-1290), so it never splits a group
// here; each segment is its own HarfBuzz call inside the group (harfbuzz_shaper.cc:1080-1101), which Canvas repeats for the
// strings it measures.
function shapingGroups(p: BlinkPrepared): void {
  const items = p.items
  for (let index = 0; index < items.length; index++) {
    const s = items[index]!
    if (s.type !== 'text' || s.start === s.end) continue
    const members = [index]
    let end = s.end
    let j = index + 1
    for (; j < items.length; j++) {
      const it = items[j]!
      if (it.type === 'control' || it.type === 'atomic') break
      if (it.type === 'open-tag') {
        if (breaksShapingBefore(p.styles[it.style]!)) break
        continue
      }
      if (it.type === 'close-tag') {
        if (breaksShapingAfter(p.styles[it.style]!)) break
        continue
      }
      if (it.start === it.end) continue
      if (p.styles[it.style]!.fontKey !== p.styles[s.style]!.fontKey) break
      if ((it.bidiLevel & 1) !== (s.bidiLevel & 1)) break
      if (p.text.charCodeAt(it.start) === 0x200c) break
      members.push(j)
      end = it.end
    }
    const group: BlinkGroup = { start: s.start, end, style: s.style, rtl: (s.bidiLevel & 1) === 1, cuts: [], prefixAtCut: [], startTrim16: 0, endTrim16: 0 }
    for (let k = 0; k < members.length; k++) items[members[k]!]!.group = p.groups.length
    p.groups.push(group)
    index = members[members.length - 1]!
  }
}

// HarfBuzz's continuation flags per shaping call's buffer, from the call's start (hb_set_unicode_props,
// hb-ot-shape.cc:470-546 at harfbuzz dfdc088c): marks (hb-ot-layout.hh:247), emoji modifiers, the second of a regional indicator pair, ZWJ
// and the Extended_Pictographic character after it, halfwidth voiced sound marks and tag characters. hb_form_clusters
// merges each continuation into the glyph cluster before it (:578-586).
function markContinuations(p: BlinkPrepared): void {
  const text = p.text
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    let previousRegionalBase = false
    for (let i = group.start; i < group.end;) {
      const cp = text.codePointAt(i)!
      const size = cp > 0xffff ? 2 : 1
      if (size === 2) p.continuations[i + 1] = 1
      let continuation = false
      let regional = false
      let next = i + size
      if (cp >= 0x80) {
        if (isMark(cp)) continuation = true
        else if (cp >= 0x1f3fb && cp <= 0x1f3ff) continuation = true
        else if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
          continuation = i > group.start && previousRegionalBase
          regional = !continuation
        } else if (cp === 0x200d) {
          continuation = true
          if (next < group.end && isExtendedPictographic(text.codePointAt(next)!) && !isSegmentEdge(p, next)) {
            const nextSize = text.codePointAt(next)! > 0xffff ? 2 : 1
            for (let u = next; u < next + nextSize; u++) p.continuations[u] = 1
            next += nextSize
          }
        } else if ((cp >= 0xff9e && cp <= 0xff9f) || (cp >= 0xe0020 && cp <= 0xe007f)) {
          continuation = true
        }
      }
      // A continuation merges into a cluster of its own shaping call; a segment starts another one (emoji.ts).
      if (continuation && !isSegmentEdge(p, i)) p.continuations[i] = 1
      previousRegionalBase = regional
      i = next
    }
  }
}

function languageOf(tag: string): string {
  return tag.split(/[-_@]/)[0]!.toLowerCase()
}

const ATTRIBUTION_DETAIL = 'a line edge taken from the paragraph position where the shaping adjusted the glyphs on both sides: Canvas totals show the adjustment but not which glyph carries it (GPOS first-glyph values, legacy kern d >> 1; specs/blink-gaps.md §3.6 L1)'
const LIGATURE_DETAIL = 'a chosen line edge where the pair total shows the shaping adjusted glyphs on both sides: a ligature may cover both, where Blink doesn\'t break, or a kern, where it may; Canvas totals don\'t show glyph clusters (shape_result.cc:684-694)'
const JOINING_LIGATURE_DETAIL = 'a chosen line edge between joining letters: a font\'s ligature may cover letters on both sides, where Blink doesn\'t break (shape_result.cc:684-694); Canvas totals don\'t show glyph clusters'
const IN_WORD_DETAIL = 'a line edge inside a word where the pair total shows no adjustment, so the port doesn\'t reshape: HarfBuzz can still flag the offset unsafe_to_break (contextual lookups, width-neutral flags) and Blink reshapes there (specs/blink-gaps.md §3.6 L2)'

const UNCERTAIN_LIGATURE_DETAIL = 'a ligature the font declaration lists as forming in some contexts only, on a line that can break between any two glyph clusters: Blink never breaks inside a glyph and gives its characters one position (shape_result.cc:684-694, 2113-2200), and whether the glyph forms here isn\'t known'

const TRUNCATED_START_DETAIL = 'a wrapped line start inside an RTL shaping run that the port\'s width tests call safe, in an item result the line cuts again at its trailing spaces: where HarfBuzz flags the start unsafe (contextual lookups and ligatures before it that change no width), Blink reshapes it, joins the reshape and the rest in one view whose parts it numbers in visual order, and the cut gives the first cluster\'s glyph to the part after it (shape_result_view.cc:215-308)'

const TRUNCATED_RESHAPE_DETAIL = 'a wrapped line start reshaped inside an RTL shaping run, in an item result the line cuts again at its trailing spaces: Blink reshapes up to the first offset HarfBuzz left safe, which can lie past the one the port\'s width tests find, numbers the view\'s parts in visual order, and the cut then keeps other glyphs than the port\'s view does (shape_result_view.cc:215-308, shaping_line_breaker.cc:309-324)'

const UNTESTED_END_DETAIL = 'a later break opportunity whose line-end reshape failed the fit test: every safe offset the port found between the line start and it is safe by the pair test alone, and where HarfBuzz flags them all (contextual lookups that change no width, as Shantell Sans\'s alternates do) Blink reshapes the whole range and takes the opportunity without a fit test (shaping_line_breaker.cc:497-506)'

const REQUEUED_SPACE_DETAIL = 'a line edge beside U+3000 where Canvas totals show an adjustment, in a font the declaration gives no coverage fact for: a font without U+3000 shapes its neighbours beside the space glyph HarfBuzz puts there, and Blink sends U+3000 itself to a fallback font (harfbuzz_shaper.cc:598-606), so the neighbour keeps its part of the kern, U+3000 none, and the offset is a run edge that is never reshaped; a font with U+3000 kerns it like any glyph'

const CLAMPED_START_DETAIL = 'a wrapped line start inside shaped text whose reshape alone takes the space left: ShapeLine adds the paragraph\'s width of the reshaped text to the space, less the reshape, and clamps the result at 0 (shaping_line_breaker.cc:309-324), where nothing fits and the line overflows at its first break; the paragraph\'s width there starts at a position the port takes from a Canvas stand-in'

const END_TEST_DETAIL = 'a break opportunity whose line-end reshape passed or failed the fit test by less than the rounding of the last safe offset\'s position: Blink reshapes from the last offset HarfBuzz left safe and tests the width after that position\'s ceiling (shaping_line_breaker.cc:543-553), HarfBuzz can flag offsets the port\'s width tests call safe (contextual lookups that change no width), and from an earlier safe offset the same glyphs pass or fail by another ceiling'

const PAIR_PLACEMENT_DETAIL = 'glyph clusters inside a line with a pair adjustment between them, in a font the declaration gives no pairKerning fact for: GPOS pair values sit on the first glyph\'s advance and the kern and kerx machine gives each glyph half (hb-kern.hh:102-106), Canvas totals show the sum, and the port puts all of it on the first glyph, so the two advances and every position between them can be half the adjustment off'

const SCALED_DETAIL = 'advances measured in a font made for the CSS size and scaled to the DOM\'s font size: Blink truncates each glyph\'s advance to 1/65536 px at its own size (skia_text_metrics.cc:207-211), so a sum of scaled advances can be a few units off the DOM\'s, which moves a width or a fit test that lies that close to a LayoutUnit'

const PLATFORM_FONT_DETAIL = 'a font with an opsz axis: the DOM sets the axis from the specified size (font_platform_data_mac.mm:170-178) and takes the platform font from a cache of the renderer process whose key holds the zoomed size alone (font_cache_key.h:53-68, font_description.cc:308-331), so text or a canvas that asked for this family at the same zoomed size under another specified size first decides the optical size of both (Chromium #489579956)'

const SOFT_HYPHEN_DETAIL = 'a default-ignorable character left out of an 8-bit Canvas string, whose glyph a `morx` substitution across it still sees in the DOM (hb-aat-layout-common.hh:1226-1241)'

// The source ranges of the text items under a style.
function styleRanges(p: BlinkPrepared, style: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.type === 'text' && item.style === style && item.start < item.end) ranges.push(sourceRange(p, item.start, item.end))
  }
  return ranges
}

// The conditions of the content, each with the source range it concerns (DESIGN.md §2.8, §5).
function contentGaps(sh: Shaper): void {
  const p = sh.p
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.type !== 'text' || item.start === item.end) continue
    const collapses = collapsesWhiteSpace(p.styles[item.style]!.whiteSpace)
    for (let k = item.start; k < item.end; k++) {
      const c = p.text.charCodeAt(k)
      // Canvas turns VT and FF into spaces (plain_text_node.cc:47-52, character.h:226-240), which the port replaces with
      // U+0001; other controls reach both paths as they are. In preserve modes FF is a control item.
      if (c === 0x0b || (c === 0x0c && collapses)) {
        addGap(p.gaps, 'control-character-width', item.run, 'VT or FF measured as U+0001, which takes the fallback font Core Text picks for a control; the width isn\'t probed (specs/blink-gaps.md §2.8)', sourceRange(p, k, k + 1))
      }
      // Canvas turns U+FFFC into U+200B (plain_text_node.cc:52-58, character.h:167-175); the DOM shapes it with a fallback glyph.
      if (c === 0xfffc) addGap(p.gaps, 'font-fallback', item.run, 'U+FFFC in text: Canvas measures it as U+200B', sourceRange(p, k, k + 1))
      // canvasString leaves these out of an 8-bit string (a range of a paragraph RunSegmenter doesn't segment, without
      // spaces or characters above U+00FF).
      if (!p.segmented && (c === 0xad || c === 0x200b || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || c === 0xfeff)) {
        addGap(p.gaps, 'soft-hyphen-shaping', item.run, SOFT_HYPHEN_DETAIL, sourceRange(p, k, k + 1))
      }
    }
    if (p.env.dictionaryBreaks.kind === 'unavailable' &&
      hasDictionaryCharacters(p.text, item.start, item.end, lineTable(p.styles[item.style]!.locale, p.settings[item.style]!.strictness, p.env.uiLanguage))) {
      addGap(p.gaps, 'dictionary-breaks-unavailable', item.run, 'Thai, Lao, Khmer or Myanmar text without the running browser\'s Intl.v8BreakIterator: no break opportunities inside such runs (DESIGN.md §6.3)', sourceRange(p, item.start, item.end))
    }
  }
}

// The paragraph's gaps: its content, its fonts' facts and the environment (DESIGN.md §2.8).
function prepareGaps(sh: Shaper): void {
  const p = sh.p
  contentGaps(sh)
  for (let s = 0; s < p.styles.length; s++) {
    const style = p.styles[s]!
    const ranges = (): { start: number; end: number }[] => styleRanges(p, s)
    if (p.env.uiLanguage === null && (style.locale === null || (languageOf(style.locale) === 'ko' && p.settings[s]!.strictness === 'strict'))) {
      for (const at of ranges()) addGap(p.gaps, 'ui-language', style.run, 'content without a locale, or ko with line-break: strict, follows Chrome\'s application locale, which isn\'t given: break tables, generic families and the HarfBuzz language (specs/blink-canvas.md §2.3)', at)
    }
    if (p.layoutZoom !== 1) {
      const unknown = style.font.facts.opticalSizeAxis === null
      if (unknown || style.measuresAtCssSize) {
        const detail = `${unknown ? 'whether the fonts have an opsz axis isn\'t given; ' : ''}${style.measuresAtCssSize ? SCALED_DETAIL : 'measured at the zoomed size'} (font_platform_data_mac.mm:170-178, probes-chrome correction 7)`
        for (const at of ranges()) addGap(p.gaps, 'optical-size', style.run, detail, at)
      }
      // The renderer's font cache, not this text: the gap has no range, so it explains no line by where it is (probe
      // critic-r3 blink-order: alone in a fresh process the DOM's widths are the same whether Canvas or the DOM asked first).
      if (style.measuresAtCssSize) addGap(p.gaps, 'page-history', style.run, PLATFORM_FONT_DETAIL)
    }
  }
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    // An element edge inside an extended grapheme cluster splits a sequence the DOM shapes in two calls (e.g. a keycap or
    // emoji ZWJ sequence across spans); Canvas measures each part alone and may pick other glyphs.
    if (group.start > 0 && p.graphemeStarts[group.start] !== 1) {
      addGap(p.gaps, 'font-fallback', p.styles[group.style]!.run, 'a shaping-group edge inside a grapheme cluster', graphemeSourceRange(p, group.start))
    }
  }
}

function sourceStartOf(p: BlinkPrepared, textOffset: number): number {
  for (let t = textOffset; t < p.text.length; t++) if (p.sourceOffsets[t]! >= 0) return p.sourceOffsets[t]!
  return p.sourceLength
}

// The group whose text holds offset k strictly inside, or -1.
function groupAround(p: BlinkPrepared, k: number): number {
  for (let g = 0; g < p.groups.length; g++) if (p.groups[g]!.start < k && k < p.groups[g]!.end) return g
  return -1
}

function runAt(p: BlinkPrepared, k: number): number | null {
  const source = p.sourceOffsets[k]!
  return source >= 0 ? p.sourceRuns[source]! : null
}

// line_breaker.cc:186-188.
function isSpaceLB(c: number): boolean {
  return c === 0x20 || c === 0x09
}

// The source range of the glyph clusters on both sides of offset k inside a shaping call over [lo, hi).
function clustersAround(p: BlinkPrepared, k: number, lo: number, hi: number): { start: number; end: number } {
  let a = k - 1
  while (a > lo && !isClusterBoundary(p, a)) a--
  let b = k + 1
  while (b < hi && !isClusterBoundary(p, b)) b++
  return sourceRange(p, a, b)
}

// Gaps at a line edge k inside a shaping group. `fromPosition`: the width there comes from the paragraph's position without
// a reshape at an unsafe offset (a wrapped line start's available-width correction, a line end before a space). `margin`:
// how many LayoutUnits the line's decision is from going the other way.
function edgeGap(sh: Shaper, k: number, fromPosition: boolean, margin: number): void {
  const p = sh.p
  const g = groupAround(p, k)
  if (g < 0) return
  const group = p.groups[g]!
  const style = p.styles[group.style]!
  const run = runAt(p, k)
  const d = positionAdjust16(sh, g, k, group.start, group.end)
  const wide = adjust16(sh, g, k, group.start, group.end)
  const pair = pairAdjust16(sh, g, k, group.start, group.end)
  const at = sourceOffsetAt(p, k)
  // Beside U+3000 in a font that lacks it, k is a run edge, safe to break, and the cluster on its other side carries the
  // adjustment (shape.ts requeuedSpaceAt). Where the facts don't name that cluster's font, an adjustment there is placed by
  // the pairKerning rule, which is wrong if U+3000 went to a fallback font.
  switch (requeuedSpaceAt(p, k, group.start, group.end)) {
    case 'start': case 'end': return
    case 'unknown':
      if (pair !== 0) {
        let a = k - 1
        while (a > group.start && !isClusterBoundary(p, a)) a--
        let b = k + 1
        while (b < group.end && !isClusterBoundary(p, b)) b++
        addGap(sh.gaps, 'font-fallback', run, REQUEUED_SPACE_DETAIL, sourceRange(p, a, b))
        return
      }
      break
    case null: break
  }
  // The shaping adjusted glyphs across the chosen edge: a ligature may merge the clusters on both sides into one glyph,
  // which Blink never breaks inside (OffsetToFit with BreakGlyphsOption(false), shape_result.cc:684-694; lam-alef in Apple
  // fonts, research/SUPERSET-blink.md §2.2 F), and Canvas totals can't tell a ligature from a kern (DESIGN.md §5
  // glyph-clusters). Letter spacing turns liga, clig and calt off in the DOM and in Canvas (font_features.cc:54-86): under
  // letter spacing no such ligature forms, and otherwise the pair window measured with a letter spacing that cancels out
  // shows whether the adjustment is a kern alone.
  // Where the declaration's ligature facts say no ligature covers k (ligatures.ts), what liga, clig and calt change there is
  // a contextual form, which no fact places.
  const ligatureFree = p.ligature[k] === LIGATURE_NONE
  const contextual = pair !== 0 && isClusterBoundary(p, k) && style.letterSpacing === 0 && pairAdjustNoLigatures16(sh, g, k, group.start, group.end) !== pair
  if (contextual && !ligatureFree) addGap(sh.gaps, 'glyph-clusters', run, LIGATURE_DETAIL, at)
  // A joining edge is reshaped; the reshape's measurement reports joining-technology or unsafe-to-break. Joining letters
  // are where fonts form ligatures over several graphemes (lam-alef, the three-letter Allah ligature in Geeza Pro,
  // c-1c0b1895a5de8849), which the one-grapheme pair window can't see, and Blink never breaks inside one.
  if (joinsAcross(p, k, group.start, group.end)) {
    if (!ligatureFree) addGap(sh.gaps, 'glyph-clusters', run, JOINING_LIGATURE_DETAIL, at)
    return
  }
  if (d !== 0 || wide !== 0) {
    // Which glyph carries the adjustment decides the position; FontFacts.pairKerning gives it for a kern between the two
    // clusters next to k, and nothing does for an adjustment that reads a longer context (positionAdjust16).
    if (fromPosition && (style.pairKerning === null || pair !== wide || contextual)) addGap(sh.gaps, 'unsafe-to-break', run, ATTRIBUTION_DETAIL, at)
    return
  }
  if (p.graphemeStarts[k] !== 1 || isSpaceLB(p.text.charCodeAt(k - 1)) || isSpaceLB(p.text.charCodeAt(k))) return
  // The pair window shows nothing across k, but HarfBuzz can still mark k unsafe to break (contextual lookups, width-neutral
  // flags), where Blink reshapes and the port doesn't.
  // - Where nothing interacts across k, the reshape's glyphs are the paragraph's and only rounding differs. At a line end
  //   Blink compares the reshape's width w after the last safe offset's ceiled position, ceil(p) + w, with the end position
  //   (shaping_line_breaker.cc:543-553), where the port compared ceil(p + w): less than one LayoutUnit apart. A wrapped line
  //   start corrects the available width by old_width − SnappedWidth (:309-324), which with equal glyphs is
  //   ceil(p1) − ceil(p0) − ceil(p1 − p0): 0 or −1. Both can act on one line, so the decision can go the other way only
  //   where the port's own margin, a whole number of LayoutUnits, is 0 or 1.
  //   The adjustment is taken over the whole measured piece around k (adjust16), so nothing the port can measure interacts
  //   across k here, at any distance.
  if (margin < 2) addGap(sh.gaps, 'in-word-prefix', run, IN_WORD_DETAIL, at)
}

const ITEM_EDGE_DETAIL = 'an item edge inside a shaping call (a span edge between characters Blink shapes together): a glyph cluster over the edge goes to the item holding its first character (CopyRanges and FindGlyphDataRange, inline_node.cc:1781, glyph_data_range.cc:56-90), and item sizes are ceiled one by one, so the items around the edge, the x of the items after them and the line\'s width rest on a position the port doesn\'t know'

// A text item that starts inside its shaping group at an item edge takes its glyphs from the group's result by cluster. Where
// the port doesn't know the position of that edge (positionLimit), the line reports the condition over the clusters on both
// sides of it.
function itemEdgeGaps(sh: Shaper, info: LineInfo): void {
  const p = sh.p
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    if (item.type !== 'text' || r.end === r.start || r.start !== item.start) continue
    const group = p.groups[item.group]!
    if (r.start <= group.start) continue
    const limit = positionLimit(sh, item.group, r.start, group.start, group.end)
    if (limit === null) continue
    let a = r.start - 1
    while (a > group.start && !isClusterBoundary(p, a)) a--
    let b = r.start + 1
    while (b < group.end && !isClusterBoundary(p, b)) b++
    addGap(sh.gaps, limit, runAt(p, r.start), ITEM_EDGE_DETAIL, sourceRange(p, a, b))
  }
}

function lineEdgeGaps(sh: Shaper, info: LineInfo, start: BlinkLineStart): void {
  const p = sh.p
  // The break decision measured the content up to the next break opportunity after the line's end, the word that didn't
  // fit (ShapeLine's candidate offset lies before it, shaping_line_breaker.cc:421-480), so the content conditions there are
  // this line's too.
  const contentEnd = info.token === null ? p.text.length : info.token.textOffset
  if (info.decisionEnd > contentEnd) {
    const range = sourceRange(p, contentEnd, info.decisionEnd)
    for (let i = 0; i < p.gaps.length; i++) {
      const g = p.gaps[i]!
      if (g.at !== undefined && g.at.start < range.end && g.at.end > range.start) addGap(sh.gaps, g.gap, g.run, g.detail, g.at)
    }
  }
  // How far the decision is from going the other way: the line's position against the fit bound (available width + 1,
  // line_breaker.cc CanFitOnLine), and, where the content that didn't fit sits in the same shaping group, its end against
  // the bound too.
  const bound = info.availableWidth + 1
  let margin = Math.abs(bound - info.unclampedWidth)
  if (info.decisionEnd > contentEnd) {
    const g = groupAround(p, contentEnd)
    if (g >= 0 && info.decisionEnd <= p.groups[g]!.end) {
      const extra = ceilFrom16(groupPrefix16(sh, g, info.decisionEnd) - groupPrefix16(sh, g, contentEnd))
      margin = Math.min(margin, Math.abs(info.unclampedWidth + extra - bound))
    }
  }
  // Positions inside a ligature over graphemes are what the decision reads at its candidate offset, where Blink gives every
  // character of a glyph the glyph's position (ComputePositionData, shape_result.cc:2113-2200) and the port Canvas prefixes:
  // ProbeShantell `ffiffl` natively fits `ffif` on the first line. So the content the decision measured past the line's end
  // reports glyph-clusters where a pair window there adjusts otherwise with liga, clig and calt off (font_features.cc:54-86).
  if (info.decisionEnd > contentEnd) {
    const g = groupAround(p, contentEnd) >= 0 ? groupAround(p, contentEnd) : groupAround(p, contentEnd + 1)
    const group = g >= 0 ? p.groups[g]! : null
    if (group !== null && p.styles[group.style]!.letterSpacing === 0) {
      const end = Math.min(info.decisionEnd, group.end)
      for (let k = Math.max(contentEnd, group.start + 1); k < end; k++) {
        // A boundary the ligature facts settle is predicted: a ligature's cluster takes one position, and none forms elsewhere.
        if (!isClusterBoundary(p, k) || p.ligature[k] === LIGATURE_NONE) continue
        const d = pairAdjust16(sh, g, k, group.start, group.end)
        if (pairAdjustNoLigatures16(sh, g, k, group.start, group.end) !== d) {
          addGap(sh.gaps, 'glyph-clusters', runAt(p, k), LIGATURE_DETAIL, sourceOffsetAt(p, k))
          break
        }
      }
    }
  }
  // A listed ligature the facts don't settle (one that forms in some contexts only, ligatures.ts) inside what the decision
  // measured, on a line that may break between any two clusters: whether its letters are one glyph cluster decides where
  // such a break can fall and what the positions around it are (Courier New draws `لله` as one glyph after some letters:
  // c-06218d32a4b76797 keeps `له` together where natively every letter, reshaped alone, takes a line).
  if (info.breaksInsideWords) {
    for (let k = start.textOffset + 1; k < info.decisionEnd; k++) {
      if (p.ligature[k] !== LIGATURE_UNCERTAIN) continue
      let a = k - 1
      while (a > 0 && !isClusterBoundary(p, a)) a--
      let b = k + 1
      while (b < p.text.length && !isClusterBoundary(p, b)) b++
      addGap(sh.gaps, 'glyph-clusters', runAt(p, k), UNCERTAIN_LIGATURE_DETAIL, sourceRange(p, a, b))
    }
  }
  // An opportunity the port gave up after its end reshape failed the fit test, which Blink takes untested where HarfBuzz
  // flags every offset before it (LineInfo.untestedEnds). A rewind can drop the item the opportunity was in, so only the
  // ones past the line's end count.
  for (let i = 0; i < info.untestedEnds.length; i++) {
    const end = info.untestedEnds[i]!
    if (end > contentEnd) addGap(sh.gaps, 'in-word-prefix', runAt(p, contentEnd), UNTESTED_END_DETAIL, sourceRange(p, contentEnd, end))
  }
  // A wrapped line start whose reshape takes the whole space: whether ShapeLine clamps the corrected space rests on the
  // start's position, a stand-in (LineInfo.clampedStarts), and with it everything the line holds.
  for (let i = 0; i < info.clampedStarts.length; i++) {
    const clamped = info.clampedStarts[i]!
    if (clamped.start === start.textOffset) addGap(sh.gaps, clamped.limit, runAt(p, clamped.start), CLAMPED_START_DETAIL, sourceRange(p, clamped.start, Math.max(contentEnd, clamped.start + 1)))
  }
  // A line-end fit test that another last safe offset could turn around (line-breaker.ts EndTest): an opportunity past the
  // line's end that the port gave up, or the one the line ends at.
  let lineEnd = -1
  for (let i = info.results.length - 1; i >= 0 && lineEnd < 0; i--) {
    const r = info.results[i]!
    if (p.items[r.itemIndex]!.type === 'text' && r.shape !== null && !r.hasOnlyPreWrapTrailingSpaces) lineEnd = r.trimmedEnd >= 0 ? r.trimmedEnd : r.end
  }
  for (let i = 0; i < info.endTests.length; i++) {
    const test = info.endTests[i]!
    if (!test.fits && test.offset > contentEnd) addGap(sh.gaps, 'in-word-prefix', runAt(p, contentEnd), END_TEST_DETAIL, sourceRange(p, contentEnd, test.offset))
    // A rewind can drop the item a test was in: only the test of the end the line kept counts.
    if (test.fits && test.offset === lineEnd && test.from >= start.textOffset && test.from < test.offset) {
      addGap(sh.gaps, 'in-word-prefix', runAt(p, test.from), END_TEST_DETAIL, sourceRange(p, test.from, test.offset))
    }
  }
  // A wrapped line start inside an RTL shaping run that the port's tests call safe, in an item result the line cut again:
  // where HarfBuzz flags the start, Blink's view joins the reshaped start and the rest, numbers its parts in visual order,
  // and the later cut gives the first letter's glyph to the part after it (shape_result_view.cc:215-308, class 3 of
  // specs/blink-RESULTS.md). Natively `ك` before a trimmed space is 0 wide at such a start after Geeza Pro's lam-alef, which
  // the pair and wide windows call safe (fresh set r3-blink-4, c-a7d036caa5cf8f42).
  if (start.textOffset > 0 && !start.afterForcedBreak && info.truncatedStarts.includes(start.textOffset)) {
    const k = start.textOffset
    const g = groupAround(p, k)
    const first = info.results.find(r => r.start === k && r.shape !== null)
    if (g >= 0 && p.groups[g]!.rtl && !isSegmentEdge(p, k) && first !== undefined && first.shape!.parts.length > 0 && first.shape!.parts[0]!.kind === 'range') {
      let b = k + 1
      while (b < p.groups[g]!.end && !isClusterBoundary(p, b)) b++
      addGap(sh.gaps, 'in-word-prefix', runAt(p, k), TRUNCATED_START_DETAIL, sourceRange(p, k, b))
    }
    // The same cut where the port reshaped the start: the reshape ends at the port's first safe offset, which HarfBuzz may
    // flag. A longer reshape numbers the parts otherwise, and the cut keeps other glyphs: natively `حين. ` in Geeza Pro is
    // reshaped to the item's end and keeps `ن`, where the port's reshape of `حين` alone loses it with the space
    // (c-a3b5719bcaf20813: 3762 units natively, 2533 predicted). Known only where the reshape ends at a run's first glyph
    // or at the item's end.
    const head = first === undefined || first.shape!.parts.length === 0 ? null : first.shape!.parts[0]!
    if (g >= 0 && p.groups[g]!.rtl && first !== undefined && head !== null && head.kind === 'reshape' && first.shape!.parts.length > 1) {
      const end = head.call.end
      const itemEnd = p.items[first.itemIndex]!.end
      if (end < itemEnd && !isSegmentEdge(p, end) && !isFontRunEdge(p, end, p.groups[g]!.start, p.groups[g]!.end)) {
        addGap(sh.gaps, 'in-word-prefix', runAt(p, k), TRUNCATED_RESHAPE_DETAIL, sourceRange(p, k, first.trimmedEnd >= 0 ? first.trimmedEnd : first.end))
      }
    }
  }
  // A wrapped line start: ShapeLine reshapes [start, first safe) and corrects the available width by the paragraph's
  // positions (shaping_line_breaker.cc:309-324).
  if (start.textOffset > 0 && !start.afterForcedBreak) edgeGap(sh, start.textOffset, true, margin)
  // The end, the paragraph's last line included: a line ending before hanging or trimmed spaces takes its width there.
  // Preserved trailing spaces the line's width holds end at the paragraph position after them, whose adjustment with what
  // follows sits on their last glyph (c-05bd16ecf8949f4c: `xx ` before `AAAA` in Times New Roman).
  let spacesEnd = -1
  for (let i = info.results.length - 1; i >= 0; i--) {
    const r = info.results[i]!
    if (p.items[r.itemIndex]!.type !== 'text' || r.end === r.start) continue
    if (spacesEnd < 0) spacesEnd = r.end
    if (r.hasOnlyPreWrapTrailingSpaces) continue
    let k = r.end
    while (k > r.start && isSpaceLB(p.text.charCodeAt(k - 1))) k--
    // A line end before a space isn't reshaped (dont_reshape_end_if_at_space, line_breaker.cc:255-268) unless the line
    // needs an accurate end position.
    edgeGap(sh, k, isSpaceLB(p.text.charCodeAt(k)) && !info.needsAccurateEndPosition, margin)
    if (k < spacesEnd && (isSpaceLB(p.text.charCodeAt(spacesEnd - 1)) || p.text.charCodeAt(spacesEnd - 1) === 0x3000)) edgeGap(sh, spacesEnd, true, margin)
    return
  }
}

type UnitKind = 'text' | 'hanging' | 'trimmed' | 'collapsed' | 'forced-break'

// Which element fragments the line's item results hold (DESIGN.md §2.2): a span's start and end edges where its open and
// close tag results sit, an atomic inline, a <br> that ended the line, a <wbr> consumed on it.
type ElementsOnLine = { open: Set<number>; close: Set<number>; atomic: Map<number, number>; br: Set<number>; wbr: Set<number> }

function elementsOn(p: BlinkPrepared, info: LineInfo): ElementsOnLine {
  const on: ElementsOnLine = { open: new Set(), close: new Set(), atomic: new Map(), br: new Set(), wbr: new Set() }
  for (let i = 0; i < info.results.length; i++) {
    const item = p.items[info.results[i]!.itemIndex]!
    switch (item.type) {
      case 'open-tag': on.open.add(item.element); break
      case 'close-tag': on.close.add(item.element); break
      case 'atomic': on.atomic.set(item.element, item.bidiLevel); break
      case 'control':
        if (item.element >= 0 && item.control === 'forced-break') on.br.add(item.element)
        if (item.control === 'wbr') on.wbr.add(item.element)
        break
      case 'text': break
    }
  }
  return on
}

// The line's fragments in logical order (DESIGN.md §2.2), from its item results, in document order over the content events.
function fragmentsOf(p: BlinkPrepared, info: LineInfo, contentStart: number, contentEnd: number, sourceStart: number, sourceEnd: number): Fragment[] {
  const n = Math.max(0, contentEnd - contentStart)
  const kinds: UnitKind[] = new Array(n).fill('collapsed')
  const levels = new Uint8Array(n)
  const resultOf = new Int32Array(n).fill(-1)
  let lastTextUnit = -1
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    if (item.type === 'open-tag' || item.type === 'close-tag' || item.type === 'atomic' || item.element >= 0) continue
    const level = r.hasOnlyBidiTrailingSpaces && p.bidiEnabled ? p.baseLevel : item.bidiLevel
    // CR and FF in preserve modes are control items in text_content without a fragment item (HandleControlItem →
    // HandleEmptyText, line_breaker.cc:2988-2994, 2034-2042): content the engine keeps without placing, painted as text so
    // the painted line splits its shaping group there too.
    if (item.control === 'cr-ff') {
      for (let t = item.start; t < item.end; t++) {
        const u = t - contentStart
        if (u < 0 || u >= n) continue
        kinds[u] = 'text'
        levels[u] = item.bidiLevel
        resultOf[u] = i
        lastTextUnit = Math.max(lastTextUnit, u)
      }
      continue
    }
    const isText = item.type === 'text' || item.control === 'tab'
    // Preserved trailing spaces hang except under pre and break-spaces (line_info.cc:357-395).
    const ws = p.styles[item.style]!.whiteSpace
    const isHanging = isText && r.hasOnlyPreWrapTrailingSpaces && ws !== 'pre' && ws !== 'break-spaces'
    for (let t = r.start; t < r.end; t++) {
      const u = t - contentStart
      if (u < 0 || u >= n) continue
      resultOf[u] = i
      levels[u] = level
      if (item.control === 'forced-break') kinds[u] = 'forced-break'
      else if (isText) kinds[u] = isHanging ? 'hanging' : 'text'
      if (kinds[u] === 'text') lastTextUnit = Math.max(lastTextUnit, u)
    }
    for (let t = r.end; t < r.trimmedEnd; t++) {
      const u = t - contentStart
      if (u >= 0 && u < n) { kinds[u] = 'trimmed'; levels[u] = p.baseLevel }
    }
  }
  // Collapsible spaces the line breaker skipped after the break are removed at the line end; the ones before any text
  // were skipped at the line start.
  for (let u = 0; u < n; u++) {
    if (kinds[u] === 'collapsed' && resultOf[u]! < 0 && u > lastTextUnit && p.text.charCodeAt(contentStart + u) === 0x20) {
      kinds[u] = 'trimmed'
      levels[u] = p.baseLevel
    }
  }
  const on = elementsOn(p, info)
  const fragments: Fragment[] = []
  let open: { kind: UnitKind; run: number; level: number; start: number; end: number; painted: string; result: number } | null = null
  const close = (): void => {
    if (open === null) return
    const o = open
    open = null
    switch (o.kind) {
      case 'collapsed': fragments.push({ kind: 'collapsed', run: o.run, start: o.start, end: o.end }); break
      case 'forced-break': fragments.push({ kind: 'forced-break', run: o.run, start: o.start, end: o.end }); break
      case 'trimmed': fragments.push({ kind: 'trimmed', run: o.run, start: o.start, end: o.end, painted: o.painted, level: o.level }); break
      case 'hanging': fragments.push({ kind: 'hanging', run: o.run, start: o.start, end: o.end, painted: o.painted, level: o.level }); break
      case 'text': {
        fragments.push({ kind: 'text', run: o.run, start: o.start, end: o.end, painted: o.painted, level: o.level })
        const r = info.results[o.result]!
        if (r.isHyphenated && o.end === p.sourceOffsets[r.end - 1]! + 1) {
          fragments.push({ kind: 'hyphen', run: o.run, at: o.end, painted: r.hyphen!.text, letterSpacing: 0, level: o.level })
        }
        break
      }
    }
  }
  const events = p.index.events
  for (let v = 0; v < events.length; v++) {
    const event = events[v]!
    switch (event.kind) {
      case 'text': {
        const leaf = p.index.leaves[event.run]!
        const from = Math.max(sourceStart, leaf.start)
        const to = Math.min(sourceEnd, leaf.start + leaf.text.length)
        for (let s = from; s < to; s++) {
          const t = p.contentOffsets[s]!
          const u = t - contentStart
          const inLine = t >= 0 && u >= 0 && u < n
          const kind: UnitKind = inLine ? kinds[u]! : 'collapsed'
          const level = inLine ? levels[u]! : p.baseLevel
          const result = inLine ? resultOf[u]! : -1
          if (open !== null && open.kind === kind && open.run === event.run && open.level === level && open.end === s && open.result === result) {
            open.end = s + 1
            if (inLine) open.painted += p.text.charAt(t)
            continue
          }
          close()
          open = { kind, run: event.run, level, start: s, end: s + 1, painted: inLine ? p.text.charAt(t) : '', result }
        }
        break
      }
      case 'open':
        if (on.open.has(event.element)) { close(); fragments.push({ kind: 'box-start', element: event.element }) }
        break
      case 'close':
        if (on.close.has(event.element)) { close(); fragments.push({ kind: 'box-end', element: event.element }) }
        break
      case 'atomic':
        if (on.atomic.has(event.element)) { close(); fragments.push({ kind: 'atomic', element: event.element, level: on.atomic.get(event.element)! }) }
        break
      case 'br':
        if (on.br.has(event.element)) { close(); fragments.push({ kind: 'br', element: event.element }) }
        break
      case 'wbr':
        if (on.wbr.has(event.element)) { close(); fragments.push({ kind: 'wbr', element: event.element }) }
        break
    }
  }
  close()
  return fragments
}

// IsHangingSpace (line_info.cc:17-19): SPACE and IsOtherSpaceSeparator, which is U+3000 only (character.h:156-158).
function isHangingSpace(c: number): boolean {
  return c === 0x20 || c === 0x3000
}

// LineInfo::ComputeTrailingSpaceWidth (line_info.cc:289-400) for a line whose trailing white space is preserved, each
// item under its own style's white-space.
function hangWidthOf(sh: Shaper, info: LineInfo): number {
  const p = sh.p
  if (!info.hasTrailingSpaces) return 0
  let trailing = 0
  for (let i = info.results.length - 1; i >= 0; i--) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    if (item.endCollapseType === 'opaque-to-collapsing') continue
    let itemWidth = 0
    let willContinue = false
    if (item.type === 'control' || r.hasOnlyPreWrapTrailingSpaces) {
      itemWidth = r.inlineSize
      willContinue = true
    } else if (item.type === 'text') {
      if (r.end === r.start) continue
      let end = r.end
      if (isHangingSpace(p.text.charCodeAt(end - 1))) {
        do end--; while (end > r.start && isHangingSpace(p.text.charCodeAt(end - 1)))
        if (end === r.start) {
          itemWidth = r.inlineSize
          willContinue = true
        } else {
          // PositionForOffset over the item result's shape, truncated to a LayoutUnit without reshaping (:340-356).
          if (startsClusterInsideGrapheme(p, end)) addGap(sh.gaps, 'glyph-clusters', runAt(p, end), GRAPHEME_CLUSTERS_DETAIL, graphemeSourceRange(p, end))
          const view = r.shape!
          const before16 = viewPrefix16(sh, view, end)
          itemWidth = p.baseLevel === 1 ? luTrunc(widthOf16(viewPrefix16(sh, view, r.end) - before16)) : luTrunc(Math.fround(view.width - widthOf16(before16)))
        }
      }
    }
    if (itemWidth !== 0) {
      switch (p.styles[item.style]!.whiteSpace) {
        case 'normal': case 'nowrap': case 'pre-line':
          trailing += itemWidth
          break
        case 'pre-wrap':
          if (trailing === 0 && (info.hasForcedBreak || info.isLastLine)) {
            // Conditional hang: only the part of the trailing spaces that overflows the line hangs (:370-381).
            const itemEnd = info.unclampedWidth - trailing
            const actual = Math.max(0, Math.min(itemWidth, itemEnd - info.availableWidth))
            if (actual !== itemWidth) willContinue = false
            trailing += actual
          } else {
            trailing += itemWidth
          }
          break
        case 'pre': case 'break-spaces':
          willContinue = false
          break
      }
    }
    if (!willContinue) return trailing
  }
  return trailing
}

// BidiParagraph::IndicesInVisualOrder, ubidi_reorderVisual (ubidi.cpp): runs at or above each level from the highest down
// to the lowest odd one are reversed.
function indicesInVisualOrder(levels: number[]): number[] {
  const n = levels.length
  const map: number[] = []
  let minLevel = 255
  let maxLevel = 0
  for (let i = 0; i < n; i++) {
    map.push(i)
    minLevel = Math.min(minLevel, levels[i]!)
    maxLevel = Math.max(maxLevel, levels[i]!)
  }
  if (minLevel === maxLevel && (minLevel & 1) === 0) return map
  minLevel |= 1
  for (; maxLevel >= minLevel; maxLevel--) {
    let start = 0
    for (;;) {
      while (start < n && levels[start]! < maxLevel) start++
      if (start >= n) break
      let limit = start
      while (++limit < n && levels[limit]! >= maxLevel) { /* extend the run */ }
      for (let a = start, b = limit - 1; a < b; a++, b--) {
        const t = map[a]!
        map[a] = map[b]!
        map[b] = t
      }
      if (limit === n) break
      start = limit + 1
    }
  }
  return map
}

// A text or tab item's shape as Blink's caret code reads it (FragmentItem::LineLeftAndRightForOffsets,
// fragment_item.cc:1132-1199): the glyph clusters and the runs of the ShapeResult it copies from the result's view, in
// logical order. A cluster starts at every unit HarfBuzz doesn't mark a continuation, and a view's part holds the clusters
// that start in its range (ShapeResultView slices at character indices). Advances are prefix differences inside the part's
// own shaping call, Canvas stand-ins for HarfBuzz's glyph advances.
//
// The caret code finds a character by counting the runs' characters (ShapeResult::PositionForOffset,
// shape_result.cc:696-733), so a part's characters sit where the parts before it end, whatever text its glyphs came from.
// That is the glyphs' own text except in an RTL view cut again after ShapeResultView::Create numbered its parts in visual
// order (viewFromSegments): `نِ` and a trimmed space at a wrapped line start in Geeza Pro keep the space's glyph in the cut
// view, natively the letter reports the letter's and its mark's glyphs, 1640 units, and the mark the space's 959
// (c-8768b30f8733ee4c).
function shapeOf(sh: Shaper, view: View, a: number, b: number, partsKnown: boolean, rtl: boolean, justification: { start: number; add16: number }[] = []): { clusters: BlinkGlyphCluster[]; runs: BlinkShapeRun[] } {
  const p = sh.p
  const clusters: BlinkGlyphCluster[] = []
  const runs: BlinkShapeRun[] = []
  const extra = new Map<number, number>()
  for (let i = 0; i < justification.length; i++) extra.set(justification[i]!.start, justification[i]!.add16)
  // PositionForOffset counts the characters from the item's visual start, the logical end in RTL: where the parts count
  // fewer characters than the item has, the ones left over are the first in RTL and the last in LTR, and no run holds them.
  let counted = 0
  for (let n = 0; n < view.parts.length; n++) counted += Math.max(0, view.parts[n]!.length)
  let position = rtl && counted < b - a ? b - counted : a
  let pending = 0
  for (let n = 0; n < view.parts.length; n++) {
    const part = view.parts[n]!
    const characters = Math.min(part.length, b - position)
    if (characters <= 0) {
      // A part without characters of its own keeps its glyphs: they widen the cluster next to it.
      if (clusters.length > 0) clusters[clusters.length - 1]!.advance += partWidth16(sh, part)
      else pending += partWidth16(sh, part)
      continue
    }
    const listed = partGraphemeStarts(sh, view, part, position)
    const shift = position - part.start
    const group = part.kind === 'reshape' ? part.call.group : part.sr.kind === 'group' ? part.sr.group : -1
    const reshaped = part.kind === 'reshape' ? { textStart: part.call.start, textEnd: part.call.end } : null
    // The shaping call the part's glyphs come from: the reshape, or the paragraph's group.
    const callStart = part.kind === 'reshape' ? part.call.start : group >= 0 ? p.groups[group]!.start : part.start
    const callEnd = part.kind === 'reshape' ? part.call.end : group >= 0 ? p.groups[group]!.end : part.end
    const limit = part.start + characters
    let runStart = part.start
    let fontsKnown = true
    const endRun = (end: number): void => {
      runs.push({ textStart: runStart + shift, textEnd: end + shift, reshaped, fontsKnown })
      runStart = end
      fontsKnown = true
    }
    let start = part.start
    for (let k = part.start + 1; k <= limit; k++) {
      if (k < limit && k < part.end && (p.continuations[k] === 1 || p.ligature[k] === LIGATURE_MERGED)) continue
      if (k < limit && k >= part.end) continue
      if (k < limit && startsClusterInsideGrapheme(p, k)) addGap(sh.gaps, 'glyph-clusters', runAt(p, k), GRAPHEME_CLUSTERS_DETAIL, graphemeSourceRange(p, k))
      const graphemeStarts = [start + shift]
      for (let x = start + 1; x < k; x++) if (listed === null ? p.graphemeStarts[x] === 1 : listed[x - part.start] === 1) graphemeStarts.push(x + shift)
      // The part's last cluster takes every glyph the part still holds (a cluster cut by the part's end goes to the part
      // holding its start).
      const advance = (k >= limit ? partWidth16(sh, part) : partPrefix16(sh, part, k)) - partPrefix16(sh, part, start) + (extra.get(start) ?? 0) + pending
      pending = 0
      const cluster: BlinkGlyphCluster = { textStart: start + shift, textEnd: k + shift, graphemeStarts, advance }
      const startLimit = shift === 0 && start > a ? viewPositionLimit(sh, view, start) : null
      if (startLimit !== null) cluster.startLimit = startLimit
      // A pair adjustment at either end of the cluster whose side isn't known: the clusters around it are stand-ins.
      if (group >= 0 && shift === 0) {
        if (pairPlacementUnknown(sh, group, start, callStart, callEnd)) addGap(sh.gaps, 'unsafe-to-break', runAt(p, start), PAIR_PLACEMENT_DETAIL, clustersAround(p, start, callStart, callEnd))
        if (k >= limit && pairPlacementUnknown(sh, group, k, callStart, callEnd)) addGap(sh.gaps, 'unsafe-to-break', runAt(p, k), PAIR_PLACEMENT_DETAIL, clustersAround(p, k, callStart, callEnd))
      }
      let codePoints = 0
      for (let x = start; x < k; x++) if ((p.text.charCodeAt(x) & 0xfc00) !== 0xdc00) codePoints++
      if (rtl && !partsKnown && codePoints > 1) cluster.graphemesLimit = 'in-word-prefix'
      clusters.push(cluster)
      if (group >= 0 && p.fontRun[start]! < 0) fontsKnown = false
      // Another HarfBuzz run starts at k: a script segment, or a stretch another font draws.
      if (k < limit && group >= 0 && (isSegmentEdge(p, k) || isFontRunEdge(p, k, p.groups[group]!.start, p.groups[group]!.end))) endRun(k)
      start = k
    }
    endRun(limit)
    position += characters
  }
  return { clusters, runs }
}

// LineOffsetForTextAlign (length_utils.cc:1607-1655).
function lineOffsetForTextAlign(align: TextAlign, rtl: boolean, space: number): number {
  let used: 'left' | 'right' | 'center'
  switch (align) {
    case 'start': case 'justify': used = rtl ? 'right' : 'left'; break
    case 'end': used = rtl ? 'left' : 'right'; break
    case 'left': used = 'left'; break
    case 'right': used = 'right'; break
    case 'center': used = 'center'; break
  }
  switch (used) {
    case 'left': return rtl ? Math.min(0, space) : 0
    case 'right': return rtl ? space : Math.max(0, space)
    case 'center': return !rtl || space > 0 ? Math.max(0, Math.trunc(space / 2)) : space
  }
}

// JustificationContext::CheckOpportunity with text-justify: auto (justification_opportunity.cc:36-121): expand after a
// space; in 16-bit text also before and after a CJK ideograph or symbol, before only when the previous character didn't
// expand after. Default-ignorable characters are skipped without changing the state.
type JustifyState = { afterOpportunity: boolean }

function checkOpportunity(p: BlinkPrepared, state: JustifyState, c: number): [boolean, boolean] {
  if (isDefaultIgnorable(c)) return [false, false]
  if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0xa0) {
    state.afterOpportunity = true
    return [false, true]
  }
  if (p.is8Bit || !isCjkIdeographOrSymbol(c)) {
    state.afterOpportunity = false
    return [false, false]
  }
  const before = !state.afterOpportunity
  state.afterOpportunity = true
  return [before, true]
}

// ApplyJustification (justification_utils.cc:237-310): SetupJustificationOpportunity counts the opportunities of the item
// results up to EndOffsetForJustify, ExpansionSetup drops the one after the last character and divides the space
// (shape_result_spacing.cc:34-58, 87-100), and JustifyResults adds each expansion to the glyph cluster it belongs to
// (ShapeResult::ApplySpacingOrExpansion, shape_result.cc:993-1046), resizing the item results. Returns whether it applied.
function applyJustification(sh: Shaper, info: LineInfo, space: number): boolean {
  const p = sh.p
  if (!info.shouldCreateLineBox || space <= 0) return false
  // EndOffsetForJustify: before preserved trailing spaces, else InflowEndOffset (line_info.cc:220-245, 275-288).
  let endOffset = info.results.length > 0 ? info.results[0]!.start : 0
  for (let i = info.results.length - 1; i >= 0; i--) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    if (item.type === 'text' || item.type === 'control' || item.type === 'atomic') { endOffset = r.end; break }
  }
  if (info.hasTrailingSpaces) {
    for (let i = info.results.length - 1; i >= 0; i--) {
      const r = info.results[i]!
      if (r.hasOnlyPreWrapTrailingSpaces) { endOffset = Math.min(endOffset, r.start); continue }
      break
    }
  }
  const lineStart = info.results.length > 0 ? info.results[0]!.start : 0
  if (endOffset === lineStart) return false
  const rtl = p.baseLevel === 1
  const state: JustifyState = { afterOpportunity: true }
  let count = 0
  const countText = (from: number, to: number): void => {
    const starts: number[] = []
    for (let k = from; k < to; k++) if (p.is8Bit || p.graphemeStarts[k] === 1) starts.push(k)
    const order = rtl ? starts.reverse() : starts
    for (let i = 0; i < order.length; i++) {
      const [before, after] = checkOpportunity(p, state, p.text.codePointAt(order[i]!)!)
      count += (before ? 1 : 0) + (after ? 1 : 0)
    }
  }
  const countItem = (r: LineInfo['results'][number]): void => {
    if (r.start >= endOffset || r.hasOnlyPreWrapTrailingSpaces) return
    const item = p.items[r.itemIndex]!
    if (r.shape !== null) countText(r.start, Math.min(r.end, endOffset))
    else if (item.type === 'atomic') {
      const [before, after] = checkOpportunity(p, state, 0xfffc)
      count += (before ? 1 : 0) + (after ? 1 : 0)
    }
  }
  const last = info.results[info.results.length - 1]
  if (rtl) {
    if (last !== undefined && last.hyphen !== null) countText16(p, state, last.hyphen.text, n => { count += n })
    for (let i = info.results.length - 1; i >= 0; i--) countItem(info.results[i]!)
  } else {
    for (let i = 0; i < info.results.length; i++) countItem(info.results[i]!)
    if (last !== undefined && last.hyphen !== null) countText16(p, state, last.hyphen.text, n => { count += n })
  }
  if (state.afterOpportunity && count > 0) count--
  if (count === 0) return false
  // InlineLayoutUnit of the space and the per-opportunity TextRunLayoutUnit, both 16.16 (layout_unit.h:474-475).
  let expansion16 = space * 1024
  const per16 = Math.trunc(expansion16 / count)
  let remaining = count
  const next = (): number => {
    remaining--
    if (remaining === 0) { const rest = expansion16; expansion16 = 0; return rest }
    expansion16 -= per16
    return per16
  }
  const applied: JustifyState = { afterOpportunity: true }
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    if (r.hasOnlyPreWrapTrailingSpaces) break
    const item = p.items[r.itemIndex]!
    if (r.shape === null) continue
    const clusters: { start: number; add16: number }[] = []
    const starts: number[] = []
    for (let k = r.start; k < r.end; k++) if (k === r.start || p.continuations[k] !== 1 && p.graphemeStarts[k] === 1 && p.ligature[k] !== LIGATURE_MERGED) starts.push(k)
    const order = (item.bidiLevel & 1) === 1 ? starts.slice().reverse() : starts
    let add = 0
    for (let c = 0; c < order.length; c++) {
      const k = order[c]!
      // ComputeExpansion: nothing once no opportunity is left or past the justified text (shape_result_spacing.cc:140-150).
      if (k >= endOffset || remaining === 0) continue
      const [before, after] = checkOpportunity(p, applied, p.text.codePointAt(k)!)
      let spacing = 0
      // FinalizeComputeExpansion (:171-187).
      if (before) spacing += next()
      if (after && remaining > 0) spacing += next()
      if (spacing !== 0) {
        add += spacing
        clusters.push({ start: k, add16: spacing })
      }
    }
    r.justification = clusters
    const view = r.shape
    const width16 = viewPrefix16(sh, view, r.end) - viewPrefix16(sh, view, r.start) + add
    r.inlineSize = Math.max(0, luCeil(widthOf16(width16))) + (r.isHyphenated ? r.hyphen!.inlineSize : 0)
  }
  return true
}

// CountOpportunities over a string outside text_content (the hyphen), per code unit.
function countText16(p: BlinkPrepared, state: JustifyState, text: string, add: (n: number) => void): void {
  for (let i = 0; i < text.length; i++) {
    const [before, after] = checkOpportunity(p, state, text.charCodeAt(i))
    add((before ? 1 : 0) + (after ? 1 : 0))
  }
}

// ComputedStyle::GetTextAlign(is_last_line) with text-align-last: auto: justify on the last line and before a forced break
// is start (line_info.cc:109-125, 275-276).
function usedTextAlign(align: TextAlign, info: LineInfo): TextAlign {
  return align === 'justify' && info.isLastLine ? 'start' : align
}

// A LogicalLineItem (logical_line_item.h): a leaf fragment item, or the placeholder a box that creates a box fragment adds
// where it opens (InlineLayoutStateStack::AddBoxFragmentPlaceholder, inline_box_state.cc:505-545). `offset` is
// rect.offset.inline_offset, `marginLineLeft` what ComputeInlinePositions stores as margin_line_left, and `box` the 1-based
// BoxData index PrepareForReorder sets.
type LineChild = {
  item: BlinkItem | null
  level: number
  opaque: boolean
  fragment: boolean
  offset: number
  inlineSize: number
  marginLineLeft: number
  box: number
}

// InlineLayoutStateStack::BoxData (inline_box_state.h): a box's range of children, its line-left and line-right edges and
// its parent box.
type BoxData = {
  element: number
  start: number
  end: number
  hasLineLeftEdge: boolean
  hasLineRightEdge: boolean
  marginLineLeft: number
  marginLineRight: number
  mbpLineLeft: number
  mbpLineRight: number
  parent: number
  fragmentedFrom: number
  rectLeft: number
  rectRight: number
}

// LogicalLineBuilder::HandleItemResults (logical_line_builder.cc:200-464) with the box states of InlineLayoutStateStack
// (OnBeginPlaceItems, OnOpenTag, OnCloseTag, OnEndPlaceItems, AddBoxData; inline_box_state.cc:290-691), BidiReorder
// (logical_line_builder.cc:688-760) with PrepareForReorder and UpdateAfterReorder (inline_box_state.cc:661-848), and
// ComputeInlinePositions (:845-935) from AdjustLineOffsetForHanging; then ApplyTextAlign (inline_layout_algorithm.cc:943-970)
// and the line box at the opportunity's line left plus the alignment offset and, in LTR, the text-indent (:480-492).
function itemsOf(sh: Shaper, info: LineInfo, hangWidth: number, alignOffset: number): BlinkItem[] {
  const p = sh.p
  const children: LineChild[] = []
  const leaf = (item: BlinkItem, level: number, marginLineLeft: number, inlineSize: number): void => {
    children.push({ item, level, opaque: false, fragment: true, offset: marginLineLeft, inlineSize, marginLineLeft: 0, box: 0 })
  }
  type BoxState = { element: number; style: number; needsBoxFragment: boolean; hasStartEdge: boolean; start: number; startEdge: { margin: number; mbp: number } }
  const stack: BoxState[] = []
  const boxes: BoxData[] = []
  const rtlStyle = p.baseLevel === 1 // spans inherit the block's direction in the model
  const placeholder = (): number => {
    children.push({ item: null, level: 0, opaque: true, fragment: false, offset: 0, inlineSize: 0, marginLineLeft: 0, box: 0 })
    return children.length - 1
  }
  // RebuildBoxStates (logical_line_builder.cc:790-813): boxes open at the line start get placeholders and no start edge.
  if (info.results.length > 0) {
    const open: number[] = []
    const first = info.results[0]!.itemIndex
    for (let i = 0; i < first; i++) {
      const item = p.items[i]!
      if (item.type === 'open-tag') open.push(i)
      else if (item.type === 'close-tag') open.pop()
    }
    for (let o = 0; o < open.length; o++) {
      const item = p.items[open[o]!]!
      const start = children.length
      if (item.shouldCreateBoxFragment) placeholder()
      stack.push({ element: item.element, style: item.style, needsBoxFragment: item.shouldCreateBoxFragment, hasStartEdge: false, start, startEdge: { margin: 0, mbp: 0 } })
    }
  }
  // AddBoxData (inline_box_state.cc:548-630).
  const endBox = (box: BoxState, hasEndEdge: boolean): void => {
    if (!box.needsBoxFragment) return
    const style = p.styles[box.style]!
    const endMbp = style.end.margin + style.end.border + style.end.padding
    let data: BoxData = {
      element: box.element, start: box.start, end: children.length,
      hasLineLeftEdge: box.hasStartEdge, marginLineLeft: box.hasStartEdge ? box.startEdge.margin : 0, mbpLineLeft: box.hasStartEdge ? box.startEdge.mbp : 0,
      hasLineRightEdge: hasEndEdge, marginLineRight: hasEndEdge ? style.end.margin : 0, mbpLineRight: hasEndEdge ? endMbp : 0,
      parent: 0, fragmentedFrom: 0, rectLeft: 0, rectRight: 0,
    }
    if (rtlStyle) {
      data = {
        ...data, hasLineLeftEdge: data.hasLineRightEdge, hasLineRightEdge: data.hasLineLeftEdge, marginLineLeft: data.marginLineRight,
        marginLineRight: data.marginLineLeft, mbpLineLeft: data.mbpLineRight, mbpLineRight: data.mbpLineLeft,
      }
    }
    if (data.end > data.start + 1) {
      boxes.push(data)
      return
    }
    // An empty inline box is a flat fragment now, never deferred or reordered (:612-630).
    const ph = children[data.start]!
    ph.offset += data.marginLineLeft
    ph.inlineSize = data.mbpLineLeft + data.mbpLineRight
    ph.fragment = true
    ph.item = { kind: 'inline-box', element: data.element, x: 0, inlineSize: ph.inlineSize - data.marginLineLeft - data.marginLineRight, hasStartEdge: rtlStyle ? data.hasLineRightEdge : data.hasLineLeftEdge, hasEndEdge: rtlStyle ? data.hasLineLeftEdge : data.hasLineRightEdge }
  }
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    // UAX #9 L1 for results holding only trailing spaces (:716-720).
    const level = r.hasOnlyBidiTrailingSpaces ? p.baseLevel : item.bidiLevel
    switch (item.type) {
      case 'text': {
        // Empty or fully collapsed text makes no fragment item (:215-223).
        if (r.end === r.start) break
        const hyphen = r.isHyphenated ? r.hyphen!.inlineSize : 0
        const shape = shapeOf(sh, r.shape!, r.start, r.end, r.partsKnown, (item.bidiLevel & 1) === 1, r.justification)
        const sizeLimit = viewPositionLimit(sh, r.shape!, r.end)
        const textItem: BlinkItem = sizeLimit === null
          ? { kind: 'text', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize - hyphen, clusters: shape.clusters, runs: shape.runs, partsKnown: r.partsKnown }
          : { kind: 'text', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize - hyphen, clusters: shape.clusters, runs: shape.runs, partsKnown: r.partsKnown, sizeLimit }
        leaf(textItem, level, 0, r.inlineSize - hyphen)
        if (r.isHyphenated) leaf({ kind: 'hyphen', run: item.run, level: item.bidiLevel, x: 0, inlineSize: hyphen }, item.bidiLevel, 0, hyphen)
        break
      }
      case 'control':
        // PlaceControlItem (:404-445): a generated break opportunity and an empty result (CR, FF) make no item.
        switch (item.control) {
          case 'tab':
            if (r.end === r.start) break
            leaf({ kind: 'tab', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize, clusters: shapeOf(sh, r.shape!, r.start, r.end, true, (item.bidiLevel & 1) === 1, r.justification).clusters }, level, 0, r.inlineSize)
            break
          case 'forced-break':
            if (r.end === r.start) break
            if (item.element >= 0) leaf({ kind: 'br', element: item.element, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize }, level, 0, r.inlineSize)
            else leaf({ kind: 'forced-break', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize }, level, 0, r.inlineSize)
            break
          case 'generated-zwsp': case 'wbr': case 'cr-ff': case 'none':
            break
        }
        break
      case 'atomic':
        // PlaceAtomicInline places the border box after the start margin (:470-490); the child is the margin box.
        leaf({ kind: 'atomic', element: item.element, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize - r.marginStart - r.marginEnd, marginStart: r.marginStart, marginEnd: r.marginEnd }, level, r.marginStart, r.inlineSize)
        break
      case 'open-tag': {
        const start = children.length
        if (item.shouldCreateBoxFragment) placeholder()
        const style = p.styles[item.style]!
        const sized = r.inlineSize !== 0 || (item.shouldCreateBoxFragment && (style.start.margin !== 0 || style.start.border !== 0 || style.start.padding !== 0))
        stack.push({
          element: item.element, style: item.style, needsBoxFragment: item.shouldCreateBoxFragment, hasStartEdge: true, start,
          startEdge: sized ? { margin: style.start.margin, mbp: style.start.margin + style.start.border + style.start.padding } : { margin: 0, mbp: 0 },
        })
        break
      }
      case 'close-tag': {
        const box = stack.pop()
        if (box !== undefined) endBox(box, true)
        break
      }
    }
  }
  // OnEndPlaceItems (:437-459): boxes still open end without their end edge.
  while (stack.length > 0) endBox(stack.pop()!, false)
  // Opaque children take the level of the next child, the paragraph's at the end (:720-736).
  let lastLevel = p.baseLevel
  for (let c = children.length - 1; c >= 0; c--) {
    if (children[c]!.opaque) children[c]!.level = lastLevel
    else lastLevel = children[c]!.level
  }
  let visual = children
  if (p.bidiEnabled && children.length > 0) {
    // PrepareForReorder (:661-691).
    for (let b = 0; b < boxes.length; b++) {
      const index = b + 1
      for (let c = boxes[b]!.start; c < boxes[b]!.end; c++) {
        const child = children[c]!
        let childBox = child.box
        if (childBox === 0) { child.box = index; continue }
        while (childBox !== index) {
          const inner = boxes[childBox - 1]!
          childBox = inner.parent
          if (childBox === 0) { inner.parent = index; break }
        }
      }
    }
    const order = indicesInVisualOrder(children.map(c => c.level))
    visual = order.map(i => children[i]!)
    // UpdateAfterReorder and UpdateBoxDataFragmentRange (:692-782).
    for (let b = 0; b < boxes.length; b++) { boxes[b]!.start = 0; boxes[b]!.end = 0 }
    const fragmented: BoxData[] = []
    const update = (from: number): number => {
      let index = from
      for (; index < visual.length; index++) {
        const startChild = visual[index]!
        const boxIndex = startChild.box
        if (boxIndex === 0) continue
        startChild.box = boxes[boxIndex - 1]!.parent
        const startIndex = index
        for (index++; index < visual.length; index++) {
          const endChild = visual[index]!
          while (endChild.box !== 0 && endChild.box < boxIndex) update(index)
          if (boxIndex !== endChild.box) break
          endChild.box = boxes[boxIndex - 1]!.parent
        }
        if (boxes[boxIndex - 1]!.end === 0) {
          boxes[boxIndex - 1]!.start = startIndex
          boxes[boxIndex - 1]!.end = index
        } else {
          // A fragment takes the box's item and rect alone; its edges start unset (BoxData(other, start, end),
          // inline_box_state.h:328-332), and the box's line-right edge moves to the last one below.
          fragmented.push({
            ...boxes[boxIndex - 1]!, start: startIndex, end: index, fragmentedFrom: boxIndex, parent: 0,
            hasLineLeftEdge: false, hasLineRightEdge: false, marginLineLeft: 0, marginLineRight: 0, mbpLineLeft: 0, mbpLineRight: 0,
          })
        }
        if (boxes[boxIndex - 1]!.parent !== 0) return startIndex
        return index
      }
      return index
    }
    for (let index = 0; index < visual.length;) index = update(index)
    // UpdateFragmentedBoxDataEdges (:784-826): fragments go right after their box, and the line-right edge moves to the last.
    fragmented.sort((a, b) => a.fragmentedFrom !== b.fragmentedFrom ? a.fragmentedFrom - b.fragmentedFrom : a.start - b.start)
    const lastOf = new Map<number, BoxData>()
    for (let f = fragmented.length - 1; f >= 0; f--) {
      const frag = fragmented[f]!
      const from = frag.fragmentedFrom
      boxes.splice(from, 0, { ...frag, fragmentedFrom: 0 })
      for (const [key, value] of [...lastOf]) if (key >= from) { lastOf.delete(key); lastOf.set(key + 1, value) }
      if (!lastOf.has(from - 1)) lastOf.set(from - 1, boxes[from]!)
    }
    for (const [original, last] of lastOf) {
      const box = boxes[original]!
      if (!box.hasLineRightEdge) continue
      last.hasLineRightEdge = true
      last.marginLineRight = box.marginLineRight
      last.mbpLineRight = box.mbpLineRight
      box.hasLineRightEdge = false
      box.marginLineRight = 0
      box.mbpLineRight = 0
    }
  }
  // ComputeInlinePositions (:845-935).
  let position = p.baseLevel === 1 ? -hangWidth : 0
  for (let c = 0; c < visual.length; c++) {
    const child = visual[c]!
    child.marginLineLeft = child.offset
    child.offset += position
    if (child.fragment) position += child.inlineSize
  }
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!
    if (box.mbpLineLeft !== 0) {
      for (let c = box.start; c < visual.length; c++) visual[c]!.offset += box.mbpLineLeft
      position += box.mbpLineLeft
    }
    if (box.mbpLineRight !== 0) {
      for (let c = box.end; c < visual.length; c++) visual[c]!.offset += box.mbpLineRight
      position += box.mbpLineRight
    }
  }
  const padLeft = new Array<number>(visual.length).fill(0)
  const padRight = new Array<number>(visual.length).fill(0)
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!
    const startChild = visual[box.start]!
    const lastChild = visual[box.end - 1]!
    let left = startChild.offset - startChild.marginLineLeft
    let right = lastChild.offset - lastChild.marginLineLeft + lastChild.inlineSize
    padLeft[box.start]! += box.mbpLineLeft
    padRight[box.end - 1]! += box.mbpLineRight
    left += box.marginLineLeft
    right -= box.marginLineRight
    left -= padLeft[box.start]!
    right += padRight[box.end - 1]!
    box.rectLeft = left
    box.rectRight = right
  }
  const rtl = p.baseLevel === 1
  const lineBoxLeft = info.lineLeft + alignOffset + (rtl ? 0 : info.textIndent)
  const out: BlinkItem[] = []
  for (let c = 0; c < visual.length; c++) {
    const child = visual[c]!
    if (child.item === null) continue
    child.item.x = lineBoxLeft + child.offset
    out.push(child.item)
  }
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!
    out.push({
      kind: 'inline-box', element: box.element, x: lineBoxLeft + box.rectLeft, inlineSize: box.rectRight - box.rectLeft,
      hasStartEdge: rtlStyle ? box.hasLineRightEdge : box.hasLineLeftEdge, hasEndEdge: rtlStyle ? box.hasLineLeftEdge : box.hasLineRightEdge,
    })
  }
  return out
}

// OffsetMapping units over the line's source units (offset_mapping_builder.cc:95-117, offset_mapping.cc:278-299): source
// units kept in text_content map one to one, removed ones to an empty range where they collapsed, and a unit Blink
// generated for a text node (U+200B after leading preserved spaces) has an empty source range before the unit that follows
// it. Elements' units (a <wbr>'s U+200B, a <br>'s LF, an atomic inline's U+FFFC) belong to no text node.
function mappingOf(p: BlinkPrepared, sourceStart: number, sourceEnd: number, contentStart: number, contentEnd: number): BlinkMappingUnit[] {
  const units: BlinkMappingUnit[] = []
  const push = (unit: BlinkMappingUnit): void => {
    const last = units.length > 0 ? units[units.length - 1]! : null
    if (last !== null && last.run === unit.run && last.collapsed === unit.collapsed && last.end === unit.start && unit.start < unit.end &&
      last.start < last.end && last.textEnd === unit.textStart && (!unit.collapsed || last.textStart === unit.textStart)) {
      last.end = unit.end
      last.textEnd = unit.textEnd
      return
    }
    units.push(unit)
  }
  const generated = (t: number, s: number): void => {
    for (let i = 0; i < p.items.length; i++) {
      const item = p.items[i]!
      if (item.control === 'generated-zwsp' && item.start === t && item.run >= 0) {
        push({ run: item.run, start: s, end: s, textStart: t, textEnd: t + 1, collapsed: false })
        return
      }
    }
  }
  let t = contentStart
  for (let s = sourceStart; s < sourceEnd; s++) {
    const c = p.contentOffsets[s]!
    if (c < 0) {
      push({ run: p.sourceRuns[s]!, start: s, end: s + 1, textStart: p.collapsedAt[s]!, textEnd: p.collapsedAt[s]!, collapsed: true })
      continue
    }
    for (; t < c; t++) if (p.sourceOffsets[t] === -1) generated(t, s)
    t = c + 1
    push({ run: p.sourceRuns[s]!, start: s, end: s + 1, textStart: c, textEnd: c + 1, collapsed: false })
  }
  for (; t < contentEnd; t++) if (p.sourceOffsets[t] === -1) generated(t, sourceEnd)
  return units
}

function lineOutput(sh: Shaper, info: LineInfo, start: BlinkLineStart, slot: LineSlot): BlinkLine {
  const p = sh.p
  const next = info.token
  const contentStart = start.textOffset
  const contentEnd = next === null ? p.text.length : next.textOffset
  const isFirst = start.itemIndex === 0 && start.textOffset === 0
  const sourceStart = isFirst ? 0 : sourceStartOf(p, contentStart)
  const sourceEnd = next === null ? p.sourceLength : sourceStartOf(p, contentEnd)
  const hangWidth = hangWidthOf(sh, info)
  const align = usedTextAlign(p.paragraph.textAlign, info)
  // ApplyTextAlign's space: AvailableWidth − WidthForAlignment, the unclamped width less the hanging width
  // (inline_layout_algorithm.cc:949-952, line_info.h:157-167). Justification that finds opportunities expands the item
  // results and moves nothing; otherwise the line falls back to start (:955-968).
  const space = info.availableWidth - (info.unclampedWidth - hangWidth)
  const justified = align === 'justify' && applyJustification(sh, info, space)
  const alignOffset = justified ? 0 : lineOffsetForTextAlign(align === 'justify' ? 'start' : align, p.baseLevel === 1, space)
  const geometry: BlinkLineGeometry = {
    layoutZoom: p.layoutZoom,
    lineLeft: info.lineLeft,
    lineRight: info.lineRight,
    availableWidth: info.availableWidth,
    textIndent: info.textIndent,
    needsAccurateEndPosition: info.needsAccurateEndPosition,
    width: info.width,
    hangWidth,
    alignOffset,
    mapping: mappingOf(p, sourceStart, sourceEnd, contentStart, contentEnd),
    items: itemsOf(sh, info, hangWidth, alignOffset),
  }
  // Blink reshapes a line edge between joining letters, which are unsafe to break in every font; the reshaped side keeps
  // the joined forms only in a font that reads HarfBuzz's context (FontFacts.joining 'opentype').
  let joinsNextLine = false
  if (next !== null) {
    const k = next.textOffset
    for (let g = 0; g < p.groups.length; g++) {
      const group = p.groups[g]!
      if (!(group.start < k && k <= group.end)) continue
      switch (p.styles[group.style]!.joining) {
        case 'opentype': joinsNextLine = joinsAcross(p, k, group.start, group.end); break
        case 'aat': break
        case null: break
      }
      break
    }
  }
  return {
    start: sourceStart, end: sourceEnd,
    fragments: fragmentsOf(p, info, contentStart, contentEnd, sourceStart, sourceEnd),
    hasLineBox: info.shouldCreateLineBox,
    joinsNextLine, slot, indented: info.textIndent !== 0, align, geometry, gaps: sh.gaps, next,
  }
}

// NeedsAccurateEndPosition from text-align with text-align-last: auto (LineInfo::ComputeNeedsAccurateEndPosition,
// line_info.cc:127-175). It reads BaseDirection() for left and right, but LineBreaker::PrepareNextLine computes it in
// SetLineStyle (line_breaker.cc:842) after Reset set the base direction to LTR (line_info.cc:48-75) and before
// SetBaseDirection (line_breaker.cc:870-871), so left never needs it and right always does, in either direction.
function needsAccurateEndPosition(align: TextAlign): boolean {
  switch (align) {
    case 'start': case 'left': return false
    case 'end': case 'center': case 'justify': case 'right': return true
  }
}

export const blinkEngine: EngineImplementation<BlinkEnvironment, BlinkPrepared, BlinkLineStart, BlinkLineGeometry> = {
  prepare(paragraph: Paragraph, env: BlinkEnvironment, measurer: Measurer): BlinkPrepared {
    const zoom = env.devicePixelRatio
    const index = indexContent(paragraph)
    const { styles, settings, styleOfLeaf, styleOfElement } = stylesOf(paragraph, index, zoom)
    // BoxInfo::text_metrics compares FontHeight of the primary fonts (inline_items_builder.cc:236-266); equal font
    // declarations have equal metrics. Different declarations are taken to differ, which only decides whether a span
    // without box edges creates a box fragment for its element rects, never where lines break.
    const fontHeightsDiffer = (a: number, b: number): boolean => {
      const fa = styles[a]!.font
      const fb = styles[b]!.font
      return fa.family !== fb.family || fa.size !== fb.size || fa.weight !== fb.weight || fa.style !== fb.style
    }
    const content = buildContent(index, styles, styleOfLeaf, styleOfElement, fontHeightsDiffer)
    const bidi = segmentBidiRuns(paragraph, content)
    const text = content.text
    let is8Bit = true
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) { is8Bit = false; break }
    // SegmentScriptRuns (inline_node.cc:1256-1290): one Latin segment unless 16-bit text with a character other than
    // U+FFFC, or bidi.
    const segmented = !((is8Bit || !content.hasNonOrc16Bit) && !bidi.enabled)
    const scripts = segmented ? scriptsPerUnit(text) : new Uint8Array(text.length).fill(USCRIPT_LATIN)
    const priorities = segmented ? emojiPriorities(text) : new Uint8Array(text.length)
    const sourceLength = index.text.length
    const sourceRuns = new Int32Array(sourceLength)
    for (let r = 0; r < index.leaves.length; r++) sourceRuns.fill(r, index.leaves[r]!.start, index.leaves[r]!.start + index.leaves[r]!.text.length)
    const contentOffsets = new Int32Array(sourceLength).fill(-1)
    for (let t = 0; t < text.length; t++) if (content.sourceOffsets[t]! >= 0) contentOffsets[content.sourceOffsets[t]!] = t
    const collapsedAt = new Int32Array(sourceLength)
    for (let s = 0, t = 0; s < sourceLength; s++) {
      if (contentOffsets[s]! >= 0) t = contentOffsets[s]! + 1
      else collapsedAt[s] = t
    }
    const graphemeStarts = new Uint8Array(text.length + 1)
    if (is8Bit) {
      for (let i = 0; i <= text.length; i++) if (!(i > 0 && text.charCodeAt(i - 1) === 0x0d && text.charCodeAt(i) === 0x0a)) graphemeStarts[i] = 1
    } else {
      const boundaries = graphemeBoundaries(text, graphemeRulesFor('blink'))
      for (let i = 0; i < boundaries.length; i++) graphemeStarts[boundaries[i]!] = 1
    }
    const contexts = []
    for (let s = 0; s < styles.length; s++) contexts.push(styleContexts(measurer, styles[s]!, zoom, segmented ? '16bit' : '8bit'))
    const rtl = paragraph.direction === 'rtl'
    const p: BlinkPrepared = {
      paragraph, env, index, layoutZoom: zoom, text, is8Bit, segmented, scripts, priorities, sourceOffsets: content.sourceOffsets, contentOffsets, collapsedAt,
      sourceRuns, sourceLength, items: bidi.items, styles, settings, groups: [], contexts, bidiEnabled: bidi.enabled,
      baseLevel: rtl ? 1 : 0, graphemeStarts, hanKerningCandidates: hanKerningCandidates(text),
      continuations: new Uint8Array(text.length),
      ligature: new Uint8Array(text.length + 1),
      fontRun: new Int16Array(text.length).fill(-1),
      groupOfUnit: new Int32Array(text.length).fill(-1),
      wordSpacingAnywhere: !collapsesWhiteSpace(paragraph.whiteSpace),
      canvasSplitsWords: styles.map(() => undefined),
      hanKerning: styles.map(() => null),
      textAlign: paragraph.textAlign, needsAccurateEndPosition: needsAccurateEndPosition(paragraph.textAlign),
      gaps: [],
    }
    const sh: Shaper = { p, m: measurer, gaps: p.gaps }
    shapingGroups(p)
    markContinuations(p)
    for (let g = 0; g < p.groups.length; g++) p.groupOfUnit.fill(g, p.groups[g]!.start, p.groups[g]!.end)
    const fontFacts = fontFactsOfText(p)
    p.ligature = fontFacts.ligature
    p.fontRun = fontFacts.fontRun
    for (let g = 0; g < p.groups.length; g++) {
      const group = p.groups[g]!
      if (hanKerningMayApply(p.hanKerningCandidates, group.start, group.end)) measureHanKerningFontData(sh, group.style)
    }
    measureGroups(sh)
    prepareGaps(sh)
    return p
  },

  // A paragraph without inline items lays out no line; every other paragraph makes at least one line, with or without a
  // line box (line_breaker.cc:945-975).
  firstLine(p: BlinkPrepared): BlinkLineStart | null {
    if (p.items.length === 0) return null
    return { engine: 'blink', itemIndex: 0, textOffset: 0, style: 0, afterForcedBreak: false, isPastFirstFormattedLine: false, afterLeadingFloats: false }
  },

  nextLine(p: BlinkPrepared, start: BlinkLineStart, slot: LineSlot, measurer: Measurer): BlinkLineResult {
    const sh: Shaper = { p, m: measurer, gaps: [] as Gap[] }
    const info = new LineBreaker(sh, start, slot).nextLine()
    lineEdgeGaps(sh, info, start)
    itemEdgeGaps(sh, info)
    // A line that overflows a layout opportunity narrower than the container, in a block that wraps, moves to the next
    // opportunity (inline_layout_algorithm.cc:1341-1367).
    if (info.hasOverflow && info.availableWidth !== lengthLU(p.paragraph.width, p.layoutZoom) && wrapsLines(p.paragraph.whiteSpace)) {
      return { kind: 'below-floats', gaps: sh.gaps }
    }
    return { kind: 'line', line: lineOutput(sh, info, start, slot) }
  },

  gaps(p: BlinkPrepared): Gap[] {
    return p.gaps
  },
}
