// Blink (Chrome 153.0.8010.48). prepare builds text_content, items, bidi levels and shaping groups and measures the
// groups; nextLine runs LineBreaker::NextLine for one line and turns its item results into fragments.
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Fragment, Gap, GapName, LineOf, Paragraph } from '../../model.js'
import { graphemeBoundaries, graphemeRulesFor } from '../../unicode/grapheme.js'
import type { EngineImplementation } from '../engine.js'
import { buildContent, segmentBidiRuns, styles as stylesOf } from './content.js'
import { LineBreaker, type ItemResult, type LineInfo } from './line-breaker.js'
import { joinsAcross, luCeil, measureGroups, styleContexts, truncateView, type Shaper } from './shape.js'
import type { BlinkGroup, BlinkItem, BlinkLineStart, BlinkPrepared, IteratorSettings } from './types.js'

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
// no ZWNJ at an item start; tags here have no inline margins, borders, padding or vertical-align. Script run segments
// are left to Canvas, which segments the measured string itself.
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
    const rtl = (s.bidiLevel & 1) === 1
    const group: BlinkGroup = { start: s.start, end, style: s.style, rtl, context: rtl ? p.contexts[s.style]!.rtl : p.contexts[s.style]!.ltr, cuts: [], prefixAtCut: [] }
    for (let k = 0; k < members.length; k++) items[members[k]!]!.group = p.groups.length
    p.groups.push(group)
    index = j - 1
  }
}

function addGap(p: BlinkPrepared, gap: GapName, run: number | null, detail: string): void {
  for (let i = 0; i < p.gaps.length; i++) if (p.gaps[i]!.gap === gap && p.gaps[i]!.run === run) return
  p.gaps.push({ gap, run, detail })
}

function prepareGaps(p: BlinkPrepared): void {
  const collapses = p.paragraph.whiteSpace === 'normal' || p.paragraph.whiteSpace === 'nowrap' || p.paragraph.whiteSpace === 'pre-line'
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.type !== 'text') continue
    for (let k = item.start; k < item.end; k++) {
      const c = p.text.charCodeAt(k)
      if ((c === 0x0c && collapses) || c === 0x0b || (c >= 0x01 && c <= 0x08) || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) {
        addGap(p, 'control-character-width', item.run, `U+${c.toString(16).toUpperCase().padStart(4, '0')} measured as U+0001 (specs/blink-gaps.md §2.8)`)
      }
      if (c === 0xad && k > item.start && k + 1 < item.end) addGap(p, 'soft-hyphen-shaping', item.run, 'Canvas measures the word without the soft hyphen')
      // Canvas turns U+FFFC into U+200B (character.h:167-175); the DOM shapes it with a fallback glyph.
      if (c === 0xfffc) addGap(p, 'font-fallback', item.run, 'U+FFFC in text: Canvas measures it as U+200B')
    }
  }
  if (!p.is8Bit) {
    for (let i = 0; i < p.items.length; i++) {
      const item = p.items[i]!
      if (item.type !== 'text') continue
      for (let k = item.start; k < item.end; k++) {
        const c = p.text.charCodeAt(k)
        // HanKerning::MayApply (han_kerning.h:152-156): 16-bit text with a possible fullwidth open or close mark.
        if ((c >= 0x2018 && c <= 0x301f) || (c >= 0xff08 && c <= 0xff60)) {
          addGap(p, 'han-kerning', item.run, 'fullwidth punctuation that HanKerning may trim from context Canvas can\'t show')
          break
        }
      }
    }
  }
  for (let s = 0; s < p.styles.length; s++) {
    const style = p.styles[s]!
    if (style.locale === null) addGap(p, 'ui-language', style.run, 'no lang: break tables and generic families follow the UI language')
    if (p.layoutZoom !== 1 && /system-ui|BlinkMacSystemFont/i.test(style.font.family)) addGap(p, 'optical-size', style.run, 'system-ui at layout zoom ≠ 1')
  }
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    // HarfBuzz's context joins OpenType Arabic fonts across shaping calls; AAT fonts join only inside one call
    // (probes-chrome.md blink-text H3). Canvas can't tell the two apart, and pieces here join only inside a group.
    if (g > 0 && p.groups[g - 1]!.end === group.start && joinsAcross(p, group.start)) {
      addGap(p, 'unsafe-to-break', p.styles[group.style]!.run, 'joining letters on both sides of a shaping-group edge')
    }
    for (let i = 1; i < group.prefixAtCut.length; i++) {
      if (group.prefixAtCut[i]! - group.prefixAtCut[i - 1]! >= 0x1000000) {
        addGap(p, 'float32-precision', p.styles[group.style]!.run, 'a measured piece is 256 zoomed px or wider')
        break
      }
    }
  }
}

// A line box exists for the rest of the paragraph only if an item there creates one (LineBreaker::NextLine
// ShouldCreateLineBox): text beyond a lone collapsible leading space, a forced break or a tab.
function restCreatesLineBox(p: BlinkPrepared, token: BlinkLineStart): boolean {
  const collapses = p.paragraph.whiteSpace === 'normal' || p.paragraph.whiteSpace === 'nowrap' || p.paragraph.whiteSpace === 'pre-line'
  for (let i = token.itemIndex; i < p.items.length; i++) {
    const item = p.items[i]!
    const from = i === token.itemIndex ? token.textOffset : item.start
    switch (item.type) {
      case 'text':
        if (from >= item.end) continue
        if (collapses && item.end - from === 1 && p.text.charCodeAt(from) === 0x20) continue
        return true
      case 'control':
        switch (item.control) {
          case 'forced-break': case 'tab': return true
          case 'generated-zwsp': case 'cr-ff': case 'none': continue
        }
        continue
      case 'open-tag': case 'close-tag':
        continue
    }
  }
  return false
}

function sourceStartOf(p: BlinkPrepared, textOffset: number): number {
  for (let t = textOffset; t < p.text.length; t++) if (p.sourceOffsets[t]! >= 0) return p.sourceOffsets[t]!
  return p.sourceLength
}

type UnitKind = 'text' | 'hanging' | 'trimmed' | 'collapsed' | 'forced-break'

function lineOutput(sh: Shaper, info: LineInfo, start: BlinkLineStart, next: BlinkLineStart | null, isFirst: boolean): LineOf<BlinkLineStart> {
  const p = sh.p
  const contentStart = start.textOffset
  const contentEnd = next === null ? p.text.length : next.textOffset
  const n = Math.max(0, contentEnd - contentStart)
  const kinds: UnitKind[] = new Array(n).fill('collapsed')
  const levels = new Uint8Array(n)
  const resultOf = new Int32Array(n).fill(-1)
  const hangs = p.paragraph.whiteSpace === 'pre-wrap' || p.paragraph.whiteSpace === 'normal' || p.paragraph.whiteSpace === 'pre-line' || p.paragraph.whiteSpace === 'nowrap'
  let hanging = 0
  let lastTextUnit = -1
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    const level = r.hasOnlyBidiTrailingSpaces && p.bidiEnabled ? p.baseLevel : item.bidiLevel
    const isText = item.type === 'text' || item.control === 'tab'
    const isHanging = isText && r.hasOnlyPreWrapTrailingSpaces && hangs
    if (isHanging) hanging += r.inlineSize
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
  const sourceStart = isFirst ? 0 : sourceStartOf(p, contentStart)
  const sourceEnd = next === null ? p.sourceLength : sourceStartOf(p, contentEnd)
  const fragments: Fragment[] = []
  const toPx = (lu: number): number => lu / 64 / p.layoutZoom
  let open: { kind: UnitKind; run: number; level: number; start: number; end: number; painted: string; result: number } | null = null
  const widthGiven = new Set<number>()
  const close = (): void => {
    if (open === null) return
    const o = open
    open = null
    switch (o.kind) {
      case 'collapsed': fragments.push({ kind: 'collapsed', run: o.run, start: o.start, end: o.end }); break
      case 'forced-break': fragments.push({ kind: 'forced-break', run: o.run, start: o.start, end: o.end }); break
      case 'trimmed': fragments.push({ kind: 'trimmed', run: o.run, start: o.start, end: o.end, painted: o.painted, level: o.level }); break
      case 'hanging':
      case 'text': {
        const r = info.results[o.result]!
        let width = 0
        if (!widthGiven.has(o.result)) {
          widthGiven.add(o.result)
          width = toPx(r.inlineSize - (r.isHyphenated && r.hyphen !== null ? r.hyphen.inlineSize : 0))
        }
        fragments.push({ kind: o.kind, run: o.run, start: o.start, end: o.end, painted: o.painted, width, level: o.level })
        if (r.isHyphenated && r.hyphen !== null && o.end === p.sourceOffsets[r.end - 1]! + 1) {
          fragments.push({ kind: 'hyphen', run: o.run, at: o.end, painted: r.hyphen.text, letterSpacing: 0, width: toPx(r.hyphen.inlineSize), level: o.level })
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
  const raw = info.width - hanging
  return {
    start: sourceStart, end: sourceEnd, width: paintedExtent(sh, info, raw),
    engineWidth: { unit: 'blink-layout-unit', raw, layoutZoom: p.layoutZoom },
    fragments, joinsNextLine: next !== null && joinsInGroup(p, next.textOffset), next,
  }
}

// The paragraph's shaping joined the letters on both sides of a line edge: an edge inside one shaping group between
// joining letters (specs/painter.md §3.1 a; OpenType Arabic keeps the joined forms at a safe break).
function joinsInGroup(p: BlinkPrepared, k: number): boolean {
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    if (group.start < k && k < group.end) return joinsAcross(p, k)
  }
  return false
}

// Code points with no ink of their own: controls other than TAB, separators and default-ignorables (lab/README.md
// "Visible code points"; TAB counts as white space).
function isInvisible(c: number): boolean {
  return (c < 0x20 && c !== 0x09) || (c >= 0x7f && c < 0xa0) || c === 0xad || (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 ||
    (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || (c >= 0xfe00 && c <= 0xfe0f) || c === 0xfeff
}

// The extent of the painted content with hanging white space left out (DESIGN.md §2.1, lab/README.md "widths"). SPACE and
// TAB in the line's trailing run hang under normal, nowrap, pre-line and pre-wrap; a control with width ends that run,
// and code points without ink (controls, separators, default-ignorables) are never part of the extent. When skipped code
// points have width, the extent runs between glyph edges: a fragment's LayoutUnit offset plus the caret position rounded
// outward (fragment_item.cc:1153-1164). Otherwise it is the fragments' LayoutUnit width; a line with nothing inked has none.
function paintedExtent(sh: Shaper, info: LineInfo, raw: number): number {
  const p = sh.p
  const zoom = p.layoutZoom
  let spacesHang: boolean
  switch (p.paragraph.whiteSpace) {
    case 'pre': case 'break-spaces': spacesHang = false; break
    case 'normal': case 'nowrap': case 'pre-line': case 'pre-wrap': spacesHang = true; break
  }
  const hasWidth = (c: number): boolean => (c < 0x20 && c !== 0x09) || (c >= 0x7f && c < 0xa0)
  const inked = (r: ItemResult): boolean => {
    const item = p.items[r.itemIndex]!
    return r.end > r.start && (item.type === 'text' || item.control === 'tab')
  }
  let skippedWidth = false
  let right = -1
  let offset = 0
  for (let i = 0; i < info.results.length; i++) offset += info.results[i]!.inlineSize
  for (let i = info.results.length - 1; i >= 0 && right < 0; i--) {
    const r = info.results[i]!
    offset -= r.inlineSize
    if (!inked(r)) continue
    if (r.isHyphenated && r.hyphen !== null) { right = offset + r.inlineSize; break }
    let k = r.end
    let runOpen = true
    while (k > r.start) {
      const c = p.text.charCodeAt(k - 1)
      if (spacesHang && runOpen && (c === 0x20 || c === 0x09)) {
        if (r.inlineSize > 0) skippedWidth = true
      } else if (isInvisible(c)) {
        if (hasWidth(c)) { skippedWidth = true; runOpen = false }
      } else {
        break
      }
      k--
    }
    if (k === r.start) continue
    right = k === r.end ? offset + r.inlineSize : offset + luCeil(truncateView(sh, r.shape!, p.items[r.itemIndex]!.group, r.start, k).width)
  }
  if (right < 0) return 0
  let left = 0
  offset = 0
  for (let i = 0; i < info.results.length; i++) {
    const r = info.results[i]!
    if (inked(r)) {
      let k = r.start
      while (k < r.end && isInvisible(p.text.charCodeAt(k))) {
        if (hasWidth(p.text.charCodeAt(k))) skippedWidth = true
        k++
      }
      if (k < r.end) {
        left = k === r.start ? offset : offset + Math.floor(Math.fround(truncateView(sh, r.shape!, p.items[r.itemIndex]!.group, r.start, k).width * 64))
        break
      }
    }
    offset += r.inlineSize
  }
  if (!skippedWidth) return raw / 64 / zoom
  return (right - left) / 64 / zoom
}

export const blinkEngine: EngineImplementation<BlinkPrepared, BlinkLineStart> = {
  prepare(paragraph: Paragraph, env: Environment, measurer: Measurer): BlinkPrepared {
    const zoom = env.devicePixelRatio
    const { styles, styleOfRun } = stylesOf(paragraph)
    const content = buildContent(paragraph, styleOfRun)
    const bidi = segmentBidiRuns(paragraph, content)
    const text = content.text
    let is8Bit = true
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) { is8Bit = false; break }
    let sourceLength = 0
    for (let r = 0; r < paragraph.runs.length; r++) sourceLength += paragraph.runs[r]!.text.length
    const sourceRuns = new Int32Array(sourceLength)
    for (let r = 0, s = 0; r < paragraph.runs.length; r++) {
      sourceRuns.fill(r, s, s + paragraph.runs[r]!.text.length)
      s += paragraph.runs[r]!.text.length
    }
    const contentOffsets = new Int32Array(sourceLength).fill(-1)
    for (let t = 0; t < text.length; t++) if (content.sourceOffsets[t]! >= 0) contentOffsets[content.sourceOffsets[t]!] = t
    const graphemeStarts = new Uint8Array(text.length + 1)
    if (is8Bit) {
      for (let i = 0; i <= text.length; i++) if (!(i > 0 && text.charCodeAt(i - 1) === 0x0d && text.charCodeAt(i) === 0x0a)) graphemeStarts[i] = 1
    } else {
      const boundaries = graphemeBoundaries(text, graphemeRulesFor('blink'))
      for (let i = 0; i < boundaries.length; i++) graphemeStarts[boundaries[i]!] = 1
    }
    const contexts = []
    for (let s = 0; s < styles.length; s++) contexts.push(styleContexts(measurer, styles[s]!, zoom))
    const p: BlinkPrepared = {
      paragraph, env, layoutZoom: zoom, text, is8Bit, sourceOffsets: content.sourceOffsets, contentOffsets, sourceRuns, sourceLength,
      items: bidi.items, styles, groups: [], contexts, bidiEnabled: bidi.enabled, baseLevel: paragraph.direction === 'rtl' ? 1 : 0,
      settings: iteratorSettings(paragraph), graphemeStarts,
      wordSpacingAnywhere: paragraph.whiteSpace === 'pre' || paragraph.whiteSpace === 'pre-wrap' || paragraph.whiteSpace === 'break-spaces',
      hanKerning: styles.map(() => null), gaps: [],
    }
    shapingGroups(p)
    measureGroups({ p, m: measurer })
    prepareGaps(p)
    return p
  },

  firstLine(p: BlinkPrepared): BlinkLineStart | null {
    const start: BlinkLineStart = { engine: 'blink', itemIndex: 0, textOffset: 0, style: 0, afterForcedBreak: false }
    return restCreatesLineBox(p, start) ? start : null
  },

  nextLine(p: BlinkPrepared, start: BlinkLineStart, availableWidth: number, measurer: Measurer): LineOf<BlinkLineStart> {
    const sh: Shaper = { p, m: measurer }
    const breaker = new LineBreaker(sh, start, availableWidth)
    const info = breaker.nextLine()
    if (breaker.iterator.dictionaryUnavailable) addGap(p, 'dictionary-breaks-unavailable', null, 'Thai, Lao, Khmer or Myanmar text without the running browser segmenter')
    let next = info.token
    if (next !== null && !restCreatesLineBox(p, next)) next = null
    if (next !== null && next.textOffset > 0 && next.itemIndex < p.items.length && p.items[next.itemIndex]!.group >= 0 && joinsAcross(p, next.textOffset)) {
      // OpenType Arabic keeps the paragraph's joined forms at a break (joining sets unsafe_to_concat, not
      // unsafe_to_break); AAT fonts such as Geeza Pro flag the offset and reshape the edge without context
      // (probes-chrome.md blink-text H3). The port measures OpenType behaviour.
      addGap(p, 'unsafe-to-break', p.items[next.itemIndex]!.run, 'a line edge between joining letters')
    }
    const isFirst = start.itemIndex === 0 && start.textOffset === 0
    return lineOutput(sh, info, start, next, isFirst)
  },

  gaps(p: BlinkPrepared): Gap[] {
    return p.gaps
  },
}

export type { BlinkItem }
