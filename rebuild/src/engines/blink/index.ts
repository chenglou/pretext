// Blink (Chrome 153.0.8010.48). prepare builds text_content, items, bidi levels, script runs and shaping groups and
// measures the groups; nextLine runs LineBreaker::NextLine for one line and turns its item results into fragments.
import type { Environment } from '../../env.js'
import type { Measurer } from '../../measure/canvas.js'
import type { Fragment, Gap, LineOf, Paragraph } from '../../model.js'
import { graphemeBoundaries, graphemeRulesFor } from '../../unicode/grapheme.js'
import type { EngineImplementation } from '../engine.js'
import { buildContent, segmentBidiRuns, styles as stylesOf } from './content.js'
import { addGap } from './gaps.js'
import { LineBreaker, type LineInfo } from './line-breaker.js'
import { USCRIPT_LATIN, hasNoInkClass, isWhiteSpace } from './props.js'
import { scriptsPerUnit } from './script.js'
import {
  JOINING_CONTEXT, joinsAcross, luCeil, measureGroups, measuresAtCssSize, pairAdjust16, styleContexts, truncateView, type Shaper,
} from './shape.js'
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

const JOINING_DETAIL = `a line or shaping-group edge between joining letters: Blink shapes it with HarfBuzz context, which OpenType Arabic fonts join through and AAT (morx) fonts such as Geeza Pro don't (probe blink-followups F1; hb-ot-shape.cc:60-66, 100-101). Canvas can't tell the two apart; the port measures the ${JOINING_CONTEXT === 'opentype' ? 'OpenType joined' : 'AAT unjoined'} forms`
const ATTRIBUTION_DETAIL = 'a line edge taken from the paragraph position where the shaping adjusted the glyphs on both sides: Canvas totals show the adjustment but not which glyph carries it (GPOS first-glyph values, legacy kern d >> 1; specs/blink-gaps.md §3.6 L1)'
const IN_WORD_DETAIL = 'a line edge inside a word where the pair total shows no adjustment, so the port doesn\'t reshape: HarfBuzz can still flag the offset unsafe_to_break (contextual lookups, width-neutral flags) and Blink reshapes there (specs/blink-gaps.md §3.6 L2)'

function prepareGaps(p: BlinkPrepared): void {
  const collapses = p.paragraph.whiteSpace === 'normal' || p.paragraph.whiteSpace === 'nowrap' || p.paragraph.whiteSpace === 'pre-line'
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.type !== 'text') continue
    for (let k = item.start; k < item.end; k++) {
      const c = p.text.charCodeAt(k)
      if ((c === 0x0c && collapses) || c === 0x0b || (c >= 0x01 && c <= 0x08) || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) {
        addGap(p, 'control-character-width', item.run, `U+${c.toString(16).toUpperCase().padStart(4, '0')}: FF and VT measured as U+0001, other controls literally; the fallback font Core Text picks for a control isn't probed (specs/blink-gaps.md §2.8)`)
      }
      // Canvas turns U+FFFC into U+200B (character.h:167-175); the DOM shapes it with a fallback glyph.
      if (c === 0xfffc) addGap(p, 'font-fallback', item.run, 'U+FFFC in text: Canvas measures it as U+200B')
    }
  }
  for (let s = 0; s < p.styles.length; s++) {
    const style = p.styles[s]!
    if (style.locale === null) addGap(p, 'ui-language', style.run, 'no lang: break tables and generic families follow the UI language')
    if (p.layoutZoom !== 1 && measuresAtCssSize(style.font.family)) {
      addGap(p, 'optical-size', style.run, 'system-ui measured at the CSS size and scaled: advances truncated to 16.16 before scaling can differ by a unit per glyph, and a platform font that page text or another canvas created at the zoomed size first changes the DOM widths (probes-chrome correction 7)')
    }
  }
  for (let g = 0; g < p.groups.length; g++) {
    const group = p.groups[g]!
    // An element edge inside an extended grapheme cluster splits a sequence the DOM shapes in two calls (e.g. a keycap or
    // emoji ZWJ sequence across spans); Canvas measures each part alone and may pick other glyphs.
    if (group.start > 0 && p.graphemeStarts[group.start] !== 1) {
      addGap(p, 'font-fallback', p.styles[group.style]!.run, 'a shaping-group edge inside a grapheme cluster')
    }
    if (g > 0 && p.groups[g - 1]!.end === group.start && joinsAcross(p, group.start, group.start, group.end)) {
      addGap(p, 'unsafe-to-break', p.styles[group.style]!.run, JOINING_DETAIL)
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
  if (joinsAcross(p, k, group.start, group.end)) {
    addGap(p, 'unsafe-to-break', run, JOINING_DETAIL)
    return
  }
  if (pairAdjust16(sh, g, k) !== 0) {
    if (fromPosition) addGap(p, 'unsafe-to-break', run, ATTRIBUTION_DETAIL)
    return
  }
  if (p.graphemeStarts[k] === 1 && !isSpaceLB(p.text.charCodeAt(k - 1)) && !isSpaceLB(p.text.charCodeAt(k))) addGap(p, 'in-word-prefix', run, IN_WORD_DETAIL)
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
  // Blink reshapes a line edge between joining letters (they are unsafe to break); the reshape keeps the joined forms only
  // under the OpenType model shape.ts measures.
  let joinsNextLine = false
  if (next !== null) {
    switch (JOINING_CONTEXT) {
      case 'opentype': {
        const g = groupAround(p, next.textOffset)
        joinsNextLine = joinsAcross(p, next.textOffset, g >= 0 ? p.groups[g]!.start : next.textOffset, g >= 0 ? p.groups[g]!.end : next.textOffset)
        break
      }
      case 'aat': break
    }
  }
  return {
    start: sourceStart, end: sourceEnd, width: paintedExtent(sh, info),
    engineWidth: { unit: 'blink-layout-unit', raw, layoutZoom: p.layoutZoom },
    fragments, joinsNextLine, next,
  }
}

// Controls other than TAB, LF and CR: Chrome draws them with an advance (U+008D 16px wide).
function isOtherControl(c: number): boolean {
  return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f)
}

// Space separators other than SPACE that no engine's hanging rule is verified for (lab/score.ts OTHER_SPACE).
function isOtherSpace(c: number): boolean {
  return c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x205f || c === 0x3000
}

// The painted extent the lab observes (DESIGN.md §2.1; lab/score.ts markVisible and lineExtent), from the first to the
// last visible code point. A code point carries ink when its grapheme holds one that is neither white space nor of a
// class without ink (gc Cc, Cf, Zl, Zp, Default_Ignorable_Code_Point) and it isn't white space itself. Visible: a code
// point with ink, a control other than TAB, LF and CR, or white space outside those classes (TAB included) other than
// SPACE, TAB and the other space separators in the line's trailing run under normal, nowrap, pre-line and pre-wrap. The
// trailing run reaches back to a code point with ink, a no-break space or such a control. An edge inside an item result
// is the caret position rounded outward (fragment_item.cc:1153-1164); a chosen hyphen ends the extent.
function paintedExtent(sh: Shaper, info: LineInfo): number {
  const p = sh.p
  const text = p.text
  let hangs: boolean
  switch (p.paragraph.whiteSpace) {
    case 'pre': case 'break-spaces': hangs = false; break
    case 'normal': case 'nowrap': case 'pre-line': case 'pre-wrap': hangs = true; break
  }
  const painted = (i: number): boolean => {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    return r.end > r.start && (item.type === 'text' || item.control === 'tab')
  }
  const graphemeHasInk = (t: number): boolean => {
    let a = t
    while (a > 0 && p.graphemeStarts[a] !== 1) a--
    let b = t + 1
    while (b < text.length && p.graphemeStarts[b] !== 1) b++
    for (let u = a; u < b;) {
      const cp = text.codePointAt(u)!
      if (!isWhiteSpace(cp) && !hasNoInkClass(cp)) return true
      u += cp > 0xffff ? 2 : 1
    }
    return false
  }
  // Walk the painted units from the end: the trailing run, then the last visible unit.
  let trailing = true
  let lastResult = -1
  let lastUnit = -1
  for (let i = info.results.length - 1; i >= 0 && lastResult < 0; i--) {
    if (!painted(i)) continue
    const r = info.results[i]!
    if (r.isHyphenated && r.hyphen !== null) {
      lastResult = i
      lastUnit = r.end
      break
    }
    for (let t = r.end - 1; t >= r.start; t--) {
      if ((text.charCodeAt(t) & 0xfc00) === 0xdc00 && t > r.start) continue
      const cp = text.codePointAt(t)!
      const ink = !isWhiteSpace(cp) && graphemeHasInk(t)
      if (ink || cp === 0xa0 || cp === 0x2007 || cp === 0x202f || isOtherControl(cp)) trailing = false
      const whiteSpaceVisible = (cp === 0x09 || (isWhiteSpace(cp) && !hasNoInkClass(cp))) && !(hangs && trailing && (cp === 0x20 || cp === 0x09 || isOtherSpace(cp)))
      if (ink || isOtherControl(cp) || whiteSpaceVisible) {
        lastResult = i
        let e = t + 1
        while (e < r.end && p.graphemeStarts[e] !== 1) e++
        lastUnit = e
        break
      }
    }
  }
  if (lastResult < 0) return 0
  let firstResult = -1
  let firstUnit = -1
  for (let i = 0; i <= lastResult && firstResult < 0; i++) {
    if (!painted(i)) continue
    const r = info.results[i]!
    for (let t = r.start; t < r.end; t++) {
      if ((text.charCodeAt(t) & 0xfc00) === 0xdc00 && t > r.start) continue
      const cp = text.codePointAt(t)!
      const ink = !isWhiteSpace(cp) && graphemeHasInk(t)
      if (ink || isOtherControl(cp) || cp === 0x09 || (isWhiteSpace(cp) && !hasNoInkClass(cp))) {
        firstResult = i
        let a = t
        while (a > r.start && p.graphemeStarts[a] !== 1) a--
        firstUnit = a
        break
      }
    }
  }
  if (firstResult < 0) {
    firstResult = lastResult
    firstUnit = info.results[lastResult]!.start
  }
  let offset = 0
  let left = 0
  let right = 0
  for (let i = 0; i <= lastResult; i++) {
    const r = info.results[i]!
    if (i === firstResult) {
      left = firstUnit === r.start ? offset : offset + Math.floor(Math.fround(truncateView(sh, r.shape!, p.items[r.itemIndex]!.group, r.start, firstUnit).width * 64))
    }
    if (i === lastResult) {
      right = lastUnit >= r.end ? offset + r.inlineSize : offset + luCeil(truncateView(sh, r.shape!, p.items[r.itemIndex]!.group, r.start, lastUnit).width)
    }
    offset += r.inlineSize
  }
  // Content whose advances sum to zero or less has no positive rect, and the lab observes no extent for it.
  return Math.max(0, right - left) / 64 / p.layoutZoom
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
      paragraph, env, measurer, layoutZoom: zoom, text, is8Bit, segmented, scripts, sourceOffsets: content.sourceOffsets, contentOffsets,
      sourceRuns, sourceLength, items: bidi.items, styles, groups: [], contexts, bidiEnabled: bidi.enabled,
      baseLevel: paragraph.direction === 'rtl' ? 1 : 0, settings: iteratorSettings(paragraph), graphemeStarts,
      wordSpacingAnywhere: paragraph.whiteSpace === 'pre' || paragraph.whiteSpace === 'pre-wrap' || paragraph.whiteSpace === 'break-spaces',
      hanKerning: styles.map(() => null), gaps: [],
    }
    shapingGroups(p)
    measureGroups({ p, m: measurer })
    prepareGaps(p)
    return p
  },

  // A paragraph none of whose lines creates a line box has none (line_breaker.cc:945-975 SetIsEmptyLine;
  // inline_layout_algorithm.cc:1493-1498).
  firstLine(p: BlinkPrepared): BlinkLineStart | null {
    const start: BlinkLineStart = { engine: 'blink', itemIndex: 0, textOffset: 0, style: 0, afterForcedBreak: false }
    for (let token: BlinkLineStart | null = start; token !== null;) {
      const info = new LineBreaker({ p, m: p.measurer }, token, p.paragraph.width).nextLine()
      if (info.shouldCreateLineBox) return start
      token = info.token
    }
    return null
  },

  nextLine(p: BlinkPrepared, start: BlinkLineStart, availableWidth: number, measurer: Measurer): LineOf<BlinkLineStart> {
    const sh: Shaper = { p, m: measurer }
    // Lines that create no line box paint nothing (line_breaker.cc:945-975, inline_layout_algorithm.cc:1493-1498): their
    // content belongs to the painted line around them.
    let breaker = new LineBreaker(sh, start, availableWidth)
    let info = breaker.nextLine()
    for (;;) {
      if (breaker.iterator.dictionaryUnavailable) addGap(p, 'dictionary-breaks-unavailable', null, 'Thai, Lao, Khmer or Myanmar text without the running browser segmenter')
      if (info.shouldCreateLineBox || info.token === null) break
      breaker = new LineBreaker(sh, info.token, availableWidth)
      info = breaker.nextLine()
    }
    let next = info.token
    while (next !== null) {
      const ahead = new LineBreaker(sh, next, availableWidth).nextLine()
      if (ahead.shouldCreateLineBox) break
      next = ahead.token
    }
    lineEdgeGaps(sh, info, start)
    const isFirst = start.itemIndex === 0 && start.textOffset === 0
    return lineOutput(sh, info, start, next, isFirst)
  },

  gaps(p: BlinkPrepared): Gap[] {
    return p.gaps
  },
}

export type { BlinkItem }
