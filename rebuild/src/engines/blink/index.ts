// Blink (Chrome 153.0.8010.48). prepare builds text_content, items, bidi levels, script runs and shaping groups and
// measures the groups; nextLine runs LineBreaker::NextLine for one line and returns what LogicalLineBuilder and
// InlineLayoutAlgorithm make of its item results: the fragment items in visual order at their LayoutUnit positions, with
// glyph clusters and the offset mapping (DESIGN.md §2.3), and the fragments in logical order.
import type { BlinkEnvironment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { BlinkGlyphCluster, BlinkItem, BlinkLine, BlinkLineGeometry, BlinkMappingUnit, Fragment, Gap, Paragraph } from '../../model.js'
import { graphemeBoundaries, graphemeRulesFor } from '../../unicode/grapheme.js'
import type { EngineImplementation } from '../engine.js'
import { hasDictionaryCharacters, lineTable } from './breaks.js'
import { buildContent, segmentBidiRuns, styles as stylesOf } from './content.js'
import { addGap } from './gaps.js'
import { hanKerningMayApply, measureHanKerningFontData } from './hankerning.js'
import { LineBreaker, type LineInfo } from './line-breaker.js'
import { USCRIPT_LATIN, isExtendedPictographic, isMark } from './props.js'
import { scriptsPerUnit } from './script.js'
import {
  joinsAcross, luTrunc, measureGroups, pairAdjust16, styleContexts, viewPrefix16, widthOf16, type Shaper, type View,
} from './shape.js'
import type { BlinkGroup, BlinkLineStart, BlinkPrepared, IteratorSettings } from './types.js'

// SetCurrentStyleForce's settings from the block's style (line_breaker.cc:4557-4643); spans inherit them in this model.
function iteratorSettings(paragraph: Paragraph): IteratorSettings {
  let autoWrap: boolean
  switch (paragraph.whiteSpace) {
    case 'normal': case 'pre-wrap': case 'pre-line': case 'break-spaces': autoWrap = true; break
    case 'nowrap': case 'pre': autoWrap = false; break
  }
  let strictness: IteratorSettings['strictness']
  let breakType: IteratorSettings['breakType']
  let breakAnywhereIfOverflow = false
  if (paragraph.lineBreak === 'anywhere') {
    strictness = 'default'
    breakType = 'break-character'
  } else {
    switch (paragraph.lineBreak) {
      case 'auto': strictness = 'default'; break
      case 'normal': strictness = 'normal'; break
      case 'strict': strictness = 'strict'; break
      case 'loose': strictness = 'loose'; break
    }
    switch (paragraph.wordBreak) {
      case 'normal': breakType = 'normal'; break
      case 'break-all': breakType = 'break-all'; break
      case 'break-word': breakType = 'normal'; breakAnywhereIfOverflow = true; break
      case 'keep-all': breakType = 'keep-all'; break
    }
    if (!breakAnywhereIfOverflow) breakAnywhereIfOverflow = paragraph.overflowWrap === 'anywhere' || paragraph.overflowWrap === 'break-word'
  }
  return {
    autoWrap, strictness, breakType, breakAnywhereIfOverflow,
    softHyphen: true, // hyphens: manual
    breakSpace: paragraph.whiteSpace === 'break-spaces' ? 'after-every-space' : 'after-space-run',
  }
}

// InlineNode::ShapeText's grouping (inline_node.cc:1625-1680): equal Font, equal direction, no control item between,
// no ZWNJ at an item start; tags here have no inline margins, borders, padding or vertical-align. EqualsRunSegment
// compares segment data that items only get in a paragraph with one segment (inline_item.cc:187-196, inline_node.cc:
// 1256-1290), so it never splits a group here; each segment is its own HarfBuzz call inside the group
// (harfbuzz_shaper.cc:1080-1101), which Canvas repeats for the strings it measures.
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
      if (it.type === 'control') break
      if (it.type !== 'text') continue
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
    index = j - 1
  }
}

// HarfBuzz's continuation flags per shaping call's buffer, from the call's start (hb_set_unicode_props,
// hb-ot-shape.cc:466-522): marks (hb-ot-layout.hh:246-251), emoji modifiers, the second of a regional indicator pair, ZWJ
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
          if (next < group.end && isExtendedPictographic(text.codePointAt(next)!)) {
            const nextSize = text.codePointAt(next)! > 0xffff ? 2 : 1
            for (let u = next; u < next + nextSize; u++) p.continuations[u] = 1
            next += nextSize
          }
        } else if ((cp >= 0xff9e && cp <= 0xff9f) || (cp >= 0xe0020 && cp <= 0xe007f)) {
          continuation = true
        }
      }
      if (continuation) p.continuations[i] = 1
      previousRegionalBase = regional
      i = next
    }
  }
}

function languageOf(tag: string): string {
  return tag.split(/[-_@]/)[0]!.toLowerCase()
}

const ATTRIBUTION_DETAIL = 'a line edge taken from the paragraph position where the shaping adjusted the glyphs on both sides: Canvas totals show the adjustment but not which glyph carries it (GPOS first-glyph values, legacy kern d >> 1; specs/blink-gaps.md §3.6 L1)'
const IN_WORD_DETAIL = 'a line edge inside a word where the pair total shows no adjustment, so the port doesn\'t reshape: HarfBuzz can still flag the offset unsafe_to_break (contextual lookups, width-neutral flags) and Blink reshapes there (specs/blink-gaps.md §3.6 L2)'

// The paragraph's gaps: its content, its fonts' facts and the environment (DESIGN.md §2.8).
function prepareGaps(sh: Shaper): void {
  const p = sh.p
  const collapses = p.paragraph.whiteSpace === 'normal' || p.paragraph.whiteSpace === 'nowrap' || p.paragraph.whiteSpace === 'pre-line'
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.type !== 'text') continue
    for (let k = item.start; k < item.end; k++) {
      const c = p.text.charCodeAt(k)
      if ((c === 0x0c && collapses) || c === 0x0b || (c >= 0x01 && c <= 0x08) || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) {
        addGap(p.gaps, 'control-character-width', item.run, `U+${c.toString(16).toUpperCase().padStart(4, '0')}: FF and VT measured as U+0001, other controls literally; the fallback font Core Text picks for a control isn't probed (specs/blink-gaps.md §2.8)`)
      }
      // Canvas turns U+FFFC into U+200B (character.h:167-175); the DOM shapes it with a fallback glyph.
      if (c === 0xfffc) addGap(p.gaps, 'font-fallback', item.run, 'U+FFFC in text: Canvas measures it as U+200B')
    }
    if (p.env.dictionaryBreaks.kind === 'unavailable' && item.start < item.end &&
      hasDictionaryCharacters(p.text, item.start, item.end, lineTable(p.styles[item.style]!.locale, p.settings.strictness, p.env.uiLanguage))) {
      addGap(p.gaps, 'dictionary-breaks-unavailable', item.run, 'Thai, Lao, Khmer or Myanmar text without the running browser\'s Intl.v8BreakIterator: no break opportunities inside such runs (DESIGN.md §6.3)')
    }
  }
  for (let s = 0; s < p.styles.length; s++) {
    const style = p.styles[s]!
    if (p.env.uiLanguage === null && (style.locale === null || (languageOf(style.locale) === 'ko' && p.settings.strictness === 'strict'))) {
      addGap(p.gaps, 'ui-language', style.run, 'content without a locale, or ko with line-break: strict, follows Chrome\'s application locale, which isn\'t given: break tables, generic families and the HarfBuzz language (specs/blink-canvas.md §2.3)')
    }
    if (p.layoutZoom !== 1) {
      if (style.font.facts.opticalSizeAxis === null) {
        addGap(p.gaps, 'optical-size', style.run, `whether the fonts have an opsz axis isn't given; measured ${style.measuresAtCssSize ? 'at the CSS size and scaled, as for the system UI font' : 'at the zoomed size'} (font_platform_data_mac.mm:170-176, probes-chrome correction 7)`)
      }
      if (style.measuresAtCssSize) {
        addGap(p.gaps, 'page-history', style.run, 'a font with an opsz axis measured at the CSS size and scaled: a platform font that earlier text or another canvas created at the zoomed size changes the DOM widths (probes-chrome correction 7)')
      }
    }
  }
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    // An element edge inside an extended grapheme cluster splits a sequence the DOM shapes in two calls (e.g. a keycap or
    // emoji ZWJ sequence across spans); Canvas measures each part alone and may pick other glyphs.
    if (group.start > 0 && p.graphemeStarts[group.start] !== 1) {
      addGap(p.gaps, 'font-fallback', p.styles[group.style]!.run, 'a shaping-group edge inside a grapheme cluster')
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

// Gaps at a line edge k inside a shaping group. `fromPosition`: the width there comes from the paragraph's position without
// a reshape at an unsafe offset (a wrapped line start's available-width correction, a line end before a space).
function edgeGap(sh: Shaper, k: number, fromPosition: boolean): void {
  const p = sh.p
  const g = groupAround(p, k)
  if (g < 0) return
  const group = p.groups[g]!
  const run = runAt(p, k)
  // A joining edge is reshaped; the reshape's measurement reports joining-technology where the fact isn't given.
  if (joinsAcross(p, k, group.start, group.end)) return
  if (pairAdjust16(sh, g, k, group.start, group.end) !== 0) {
    if (fromPosition) addGap(sh.gaps, 'unsafe-to-break', run, ATTRIBUTION_DETAIL)
    return
  }
  if (p.graphemeStarts[k] === 1 && !isSpaceLB(p.text.charCodeAt(k - 1)) && !isSpaceLB(p.text.charCodeAt(k))) addGap(sh.gaps, 'in-word-prefix', run, IN_WORD_DETAIL)
}

function lineEdgeGaps(sh: Shaper, info: LineInfo, start: BlinkLineStart): void {
  const p = sh.p
  // A wrapped line start: ShapeLine reshapes [start, first safe) and corrects the available width by the paragraph's
  // positions (shaping_line_breaker.cc:309-324).
  if (start.textOffset > 0 && !start.afterForcedBreak) edgeGap(sh, start.textOffset, true)
  // The end, the paragraph's last line included: a line ending before hanging or trimmed spaces takes its width there.
  for (let i = info.results.length - 1; i >= 0; i--) {
    const r = info.results[i]!
    if (p.items[r.itemIndex]!.type !== 'text' || r.end === r.start || r.hasOnlyPreWrapTrailingSpaces) continue
    let k = r.end
    while (k > r.start && isSpaceLB(p.text.charCodeAt(k - 1))) k--
    // A line end before a space isn't reshaped (dont_reshape_end_if_at_space, line_breaker.cc:255-268).
    edgeGap(sh, k, isSpaceLB(p.text.charCodeAt(k)))
    return
  }
}

type UnitKind = 'text' | 'hanging' | 'trimmed' | 'collapsed' | 'forced-break'

// The line's fragments in logical order (DESIGN.md §2.2), from its item results.
function fragmentsOf(p: BlinkPrepared, info: LineInfo, contentStart: number, contentEnd: number, sourceStart: number, sourceEnd: number): Fragment[] {
  const n = Math.max(0, contentEnd - contentStart)
  const kinds: UnitKind[] = new Array(n).fill('collapsed')
  const levels = new Uint8Array(n)
  const resultOf = new Int32Array(n).fill(-1)
  const hangs = p.paragraph.whiteSpace === 'pre-wrap' || p.paragraph.whiteSpace === 'normal' || p.paragraph.whiteSpace === 'pre-line' || p.paragraph.whiteSpace === 'nowrap'
  let lastTextUnit = -1
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
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
    const isHanging = isText && r.hasOnlyPreWrapTrailingSpaces && hangs
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
  for (let s = sourceStart; s < sourceEnd; s++) {
    const t = p.contentOffsets[s]!
    const u = t - contentStart
    const inLine = t >= 0 && u >= 0 && u < n
    const kind: UnitKind = inLine ? kinds[u]! : 'collapsed'
    const run = p.sourceRuns[s]!
    const level = inLine ? levels[u]! : p.baseLevel
    const result = inLine ? resultOf[u]! : -1
    if (open !== null && open.kind === kind && open.run === run && open.level === level && open.end === s && open.result === result) {
      open.end = s + 1
      if (inLine) open.painted += p.text.charAt(t)
      continue
    }
    close()
    open = { kind, run, level, start: s, end: s + 1, painted: inLine ? p.text.charAt(t) : '', result }
  }
  close()
  return fragments
}

// IsHangingSpace (line_info.cc:17-19): SPACE and IsOtherSpaceSeparator, which is U+3000 only (character.h:156-158).
function isHangingSpace(c: number): boolean {
  return c === 0x20 || c === 0x3000
}

// LineInfo::ComputeTrailingSpaceWidth (line_info.cc:289-400) for a line whose trailing white space is preserved, with
// every item under the block's white-space.
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
          const view = r.shape!
          const before16 = viewPrefix16(sh, view, end)
          itemWidth = p.baseLevel === 1 ? luTrunc(widthOf16(viewPrefix16(sh, view, r.end) - before16)) : luTrunc(Math.fround(view.width - widthOf16(before16)))
        }
      }
    }
    if (itemWidth !== 0) {
      switch (p.paragraph.whiteSpace) {
        case 'normal': case 'nowrap': case 'pre-line':
          trailing += itemWidth
          break
        case 'pre-wrap':
          if (trailing === 0 && (info.hasForcedBreak || info.isLastLine)) {
            // Conditional hang: only the part of the trailing spaces that overflows the line hangs (:370-381).
            const itemEnd = info.width - trailing
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

// The glyph clusters of text_content[a, b) in a result's view, logical order: a cluster starts at every unit HarfBuzz
// doesn't mark as a continuation, and the item's edges cut clusters (ShapeResultView slices at character indices).
// Advances are the view's prefix differences, Canvas stand-ins for HarfBuzz's glyph advances.
function clustersOf(sh: Shaper, view: View, a: number, b: number): BlinkGlyphCluster[] {
  const p = sh.p
  const clusters: BlinkGlyphCluster[] = []
  let start = a
  let before = viewPrefix16(sh, view, a)
  for (let k = a + 1; k <= b; k++) {
    if (k < b && p.continuations[k] === 1) continue
    const graphemeStarts = [start]
    for (let x = start + 1; x < k; x++) if (p.graphemeStarts[x] === 1) graphemeStarts.push(x)
    const after = viewPrefix16(sh, view, k)
    clusters.push({ textStart: start, textEnd: k, graphemeStarts, advance: after - before })
    before = after
    start = k
  }
  return clusters
}

// LogicalLineBuilder::HandleItemResults (logical_line_builder.cc:200-464), BidiReorder (:688-760) and the positions of
// InlineLayoutAlgorithm::CreateLine: ComputeInlinePositions from AdjustLineOffsetForHanging, then ApplyTextAlign with
// text-align: start (inline_layout_algorithm.cc:303-311, 361-389, 943-970; inline_box_state.cc:845-856;
// length_utils.cc:1607-1640).
function itemsOf(sh: Shaper, info: LineInfo, hangWidth: number): BlinkItem[] {
  const p = sh.p
  const logical: BlinkItem[] = []
  const reorderLevels: number[] = []
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    // UAX #9 L1 for results holding only trailing spaces (:716-720).
    const reorderLevel = r.hasOnlyBidiTrailingSpaces ? p.baseLevel : item.bidiLevel
    switch (item.type) {
      case 'text': {
        // Empty or fully collapsed text makes no fragment item (:215-223).
        if (r.end === r.start) break
        const hyphen = r.isHyphenated ? r.hyphen!.inlineSize : 0
        logical.push({ kind: 'text', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize - hyphen, clusters: clustersOf(sh, r.shape!, r.start, r.end) })
        reorderLevels.push(reorderLevel)
        if (r.isHyphenated) {
          logical.push({ kind: 'hyphen', run: item.run, level: item.bidiLevel, x: 0, inlineSize: hyphen })
          reorderLevels.push(item.bidiLevel)
        }
        break
      }
      case 'control':
        // PlaceControlItem (:404-445): a generated break opportunity and an empty result (CR, FF) make no item.
        switch (item.control) {
          case 'tab':
            if (r.end === r.start) break
            logical.push({ kind: 'tab', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize, clusters: clustersOf(sh, r.shape!, r.start, r.end) })
            reorderLevels.push(reorderLevel)
            break
          case 'forced-break':
            if (r.end === r.start) break
            logical.push({ kind: 'forced-break', run: item.run, textStart: r.start, textEnd: r.end, level: item.bidiLevel, x: 0, inlineSize: r.inlineSize })
            reorderLevels.push(reorderLevel)
            break
          case 'generated-zwsp': case 'cr-ff': case 'none':
            break
        }
        break
      // A span without margins, borders, padding or decorations is a culled inline box: no fragment item.
      case 'open-tag': case 'close-tag':
        break
    }
  }
  const order = p.bidiEnabled ? indicesInVisualOrder(reorderLevels) : null
  const items: BlinkItem[] = []
  let position = p.baseLevel === 1 ? -hangWidth : 0
  for (let v = 0; v < logical.length; v++) {
    const item = logical[order === null ? v : order[v]!]!
    item.x = position
    position += item.inlineSize
    items.push(item)
  }
  if (p.baseLevel === 1) {
    // LineOffsetForTextAlign: text-align: start in an RTL block aligns right, and a wide line spills out to the left.
    const space = info.availableWidth - (info.width - hangWidth)
    for (let i = 0; i < items.length; i++) items[i]!.x += space
  }
  return items
}

// OffsetMapping units over the line's source units (offset_mapping_builder.cc:95-117, offset_mapping.cc:278-299): source
// units kept in text_content map one to one, removed ones to an empty range where they collapsed, and a unit Blink
// generated (U+200B after leading preserved spaces) has an empty source range before the unit that follows it.
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
      if (item.control === 'generated-zwsp' && item.start === t) {
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

function lineOutput(sh: Shaper, info: LineInfo, start: BlinkLineStart): BlinkLine {
  const p = sh.p
  const next = info.token
  const contentStart = start.textOffset
  const contentEnd = next === null ? p.text.length : next.textOffset
  const isFirst = start.itemIndex === 0 && start.textOffset === 0
  const sourceStart = isFirst ? 0 : sourceStartOf(p, contentStart)
  const sourceEnd = next === null ? p.sourceLength : sourceStartOf(p, contentEnd)
  const hangWidth = hangWidthOf(sh, info)
  const geometry: BlinkLineGeometry = {
    layoutZoom: p.layoutZoom,
    availableWidth: info.availableWidth,
    width: info.width,
    hangWidth,
    mapping: mappingOf(p, sourceStart, sourceEnd, contentStart, contentEnd),
    items: itemsOf(sh, info, hangWidth),
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
    joinsNextLine, geometry, gaps: sh.gaps, next,
  }
}

export const blinkEngine: EngineImplementation<BlinkEnvironment, BlinkPrepared, BlinkLineStart, BlinkLineGeometry> = {
  prepare(paragraph: Paragraph, env: BlinkEnvironment, measurer: Measurer): BlinkPrepared {
    const zoom = env.devicePixelRatio
    const { styles, styleOfRun } = stylesOf(paragraph)
    const content = buildContent(paragraph, styleOfRun)
    const bidi = segmentBidiRuns(paragraph, content)
    const text = content.text
    let is8Bit = true
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) { is8Bit = false; break }
    // SegmentScriptRuns (inline_node.cc:1256-1290): one Latin segment unless 16-bit text with a character other than
    // U+FFFC, or bidi.
    const segmented = !((is8Bit || !content.hasNonOrc16Bit) && !bidi.enabled)
    const scripts = segmented ? scriptsPerUnit(text) : new Uint8Array(text.length).fill(USCRIPT_LATIN)
    let sourceLength = 0
    for (let r = 0; r < paragraph.runs.length; r++) sourceLength += paragraph.runs[r]!.text.length
    const sourceRuns = new Int32Array(sourceLength)
    for (let r = 0, s = 0; r < paragraph.runs.length; r++) {
      sourceRuns.fill(r, s, s + paragraph.runs[r]!.text.length)
      s += paragraph.runs[r]!.text.length
    }
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
    const p: BlinkPrepared = {
      paragraph, env, layoutZoom: zoom, text, is8Bit, segmented, scripts, sourceOffsets: content.sourceOffsets, contentOffsets, collapsedAt,
      sourceRuns, sourceLength, items: bidi.items, styles, groups: [], contexts, bidiEnabled: bidi.enabled,
      baseLevel: paragraph.direction === 'rtl' ? 1 : 0, settings: iteratorSettings(paragraph), graphemeStarts,
      continuations: new Uint8Array(text.length),
      wordSpacingAnywhere: paragraph.whiteSpace === 'pre' || paragraph.whiteSpace === 'pre-wrap' || paragraph.whiteSpace === 'break-spaces',
      hanKerning: styles.map(() => null), gaps: [],
    }
    const sh: Shaper = { p, m: measurer, gaps: p.gaps }
    shapingGroups(p)
    markContinuations(p)
    for (let g = 0; g < p.groups.length; g++) {
      const group = p.groups[g]!
      if (hanKerningMayApply(text, is8Bit, group.start, group.end)) measureHanKerningFontData(sh, group.style)
    }
    measureGroups(sh)
    prepareGaps(sh)
    return p
  },

  // A paragraph without inline items lays out no line; every other paragraph makes at least one line, with or without a
  // line box (line_breaker.cc:945-975).
  firstLine(p: BlinkPrepared): BlinkLineStart | null {
    if (p.items.length === 0) return null
    return { engine: 'blink', itemIndex: 0, textOffset: 0, style: 0, afterForcedBreak: false }
  },

  nextLine(p: BlinkPrepared, start: BlinkLineStart, availableWidth: number, measurer: Measurer): BlinkLine {
    const sh: Shaper = { p, m: measurer, gaps: [] as Gap[] }
    const info = new LineBreaker(sh, start, availableWidth).nextLine()
    lineEdgeGaps(sh, info, start)
    return lineOutput(sh, info, start)
  },

  gaps(p: BlinkPrepared): Gap[] {
    return p.gaps
  },
}
