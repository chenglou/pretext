// What a painter takes of a decided Blink line (model.ts LinePieces): the fragments in logical order (DESIGN.md §2.2), from
// the line's item results, with the hanging width that says whether the line overflows its band. Nothing here reads or
// makes gaps, limits, glyph clusters or the offset mapping: those are inspection's (inspect.ts).
import type { ContentEvent } from '../../content.js'
import type { Fragment, LinePieces, TextAlign } from '../../model.js'
import { positionInsideGrapheme, runOfSource } from './gaps.js'
import type { BlinkLineStart } from './geometry.js'
import type { LineInfo } from './line-breaker.js'
import { joinsAcross, luTrunc, viewPrefix16, widthOf16, type Shaper } from './shape.js'
import type { BlinkPrepared, InlineItem } from './types.js'

// What Blink's painting rules read beside the pieces.
export type BlinkPaintFacts = { needsAccurateEndPosition: boolean }

function sourceStartOf(p: BlinkPrepared, textOffset: number): number {
  for (let t = textOffset; t < p.text.length; t++) if (p.sourceOffsets[t]! >= 0) return p.sourceOffsets[t]!
  return p.index.text.length
}

// The source units a line consumed, from where it started and where the next one starts (null after the last line):
// consecutive lines tile the text. Known when the line is filled, before any fragment is.
export function lineSourceRange(p: BlinkPrepared, start: BlinkLineStart, next: BlinkLineStart | null): { start: number; end: number } {
  const isFirst = start.itemIndex === 0 && start.textOffset === 0
  return { start: isFirst ? 0 : sourceStartOf(p, start.textOffset), end: next === null ? p.index.text.length : sourceStartOf(p, next.textOffset) }
}

type UnitKind = 'text' | 'hanging' | 'trimmed' | 'collapsed' | 'forced-break'

// Whether an item is an element's (a span's tags, an atomic inline, <br>, <wbr>) and not a text leaf's.
function isElementItem(item: InlineItem): boolean {
  switch (item.type) {
    case 'text': return false
    case 'control': return item.control === 'br' || item.control === 'wbr'
    case 'open-tag': case 'close-tag': case 'atomic': return true
  }
}

// The content event an item was made from (content.ts ContentEvent).
function eventOf(p: BlinkPrepared, item: InlineItem): number {
  switch (item.type) {
    case 'text': return p.index.leaves[item.run]!.event
    case 'control':
      switch (item.control) {
        case 'forced-break': case 'tab': case 'generated-zwsp': case 'cr-ff': return p.index.leaves[item.run]!.event
        case 'br': case 'wbr': return p.index.elements[item.element]!.open
      }
    case 'open-tag': case 'atomic': return p.index.elements[item.element]!.open
    case 'close-tag': return p.index.elements[item.element]!.close
  }
}

// The element fragment an element's item result makes at its item's own event (DESIGN.md §2.2): a span's start and end
// edges where its open and close tag results sit, an atomic inline, a <br> that ended the line, a <wbr> consumed on it.
function elementFragment(item: InlineItem, event: Exclude<ContentEvent, { kind: 'text' }>): Fragment | null {
  switch (event.kind) {
    case 'open': return item.type === 'open-tag' && item.element === event.element ? { kind: 'box-start', element: event.element } : null
    case 'close': return item.type === 'close-tag' && item.element === event.element ? { kind: 'box-end', element: event.element } : null
    case 'atomic': return item.type === 'atomic' && item.element === event.element ? { kind: 'atomic', element: event.element, level: item.bidiLevel } : null
    case 'br': case 'wbr': return item.type === 'control' && item.control === event.kind && item.element === event.element ? { kind: event.kind, element: event.element } : null
  }
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
    // An element's item makes an element fragment (the walk below) and takes no unit of a text leaf.
    if (isElementItem(item)) continue
    const level = r.hasOnlyBidiTrailingSpaces && p.bidiEnabled ? p.baseLevel : item.bidiLevel
    // CR and FF in preserve modes are control items in text_content without a fragment item (HandleControlItem →
    // HandleEmptyText, line_breaker.cc:2988-2994, 2034-2042): content the engine keeps without placing, painted as text so
    // the painted line splits its shaping group there too.
    if (item.type === 'control' && item.control === 'cr-ff') {
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
    const isText = item.type === 'text' || (item.type === 'control' && item.control === 'tab')
    // Preserved trailing spaces hang except under pre and break-spaces (line_info.cc:357-395).
    const ws = p.styles[item.style]!.whiteSpace
    const isHanging = isText && r.hasOnlyPreWrapTrailingSpaces && ws !== 'pre' && ws !== 'break-spaces'
    for (let t = r.start; t < r.end; t++) {
      const u = t - contentStart
      if (u < 0 || u >= n) continue
      resultOf[u] = i
      levels[u] = level
      if (item.type === 'control' && item.control === 'forced-break') kinds[u] = 'forced-break'
      else if (isText) kinds[u] = isHanging ? 'hanging' : 'text'
      if (kinds[u] === 'text') lastTextUnit = Math.max(lastTextUnit, u)
    }
    for (let t = r.end; t < (r.trimmedEnd ?? r.end); t++) {
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
  // The events the line touches: from the first to the last of the ones its item results were made from and the ones of
  // the leaves that hold its source units. Item results and events are both in document order, so an element's result is
  // the next one of its kind when its event comes by.
  const events = p.index.events
  let first = events.length
  let last = -1
  if (info.results.length > 0) {
    first = eventOf(p, p.items[info.results[0]!.itemIndex]!)
    last = eventOf(p, p.items[info.results[info.results.length - 1]!.itemIndex]!)
  }
  if (sourceStart < sourceEnd) {
    first = Math.min(first, p.index.leaves[runOfSource(p, sourceStart)]!.event)
    last = Math.max(last, p.index.leaves[runOfSource(p, sourceEnd - 1)]!.event)
  }
  let nextResult = 0
  for (let v = first; v <= last; v++) {
    const event = events[v]!
    if (event.kind !== 'text') {
      while (nextResult < info.results.length && !isElementItem(p.items[info.results[nextResult]!.itemIndex]!)) nextResult++
      const fragment = nextResult < info.results.length ? elementFragment(p.items[info.results[nextResult]!.itemIndex]!, event) : null
      if (fragment === null) continue
      close()
      fragments.push(fragment)
      nextResult++
      continue
    }
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
  }
  close()
  return fragments
}

// IsHangingSpace (line_info.cc:17-19): SPACE and IsOtherSpaceSeparator, which is U+3000 only (character.h:156-158).
function isHangingSpace(c: number): boolean {
  return c === 0x20 || c === 0x3000
}

// LineInfo::InflowEndOffset (line_info.cc:220-245): the end of the line's last text, control or atomic inline item result.
function inflowEndOffset(p: BlinkPrepared, info: LineInfo): number {
  for (let i = info.results.length - 1; i >= 0; i--) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    if (item.type === 'text' || item.type === 'control' || item.type === 'atomic') return r.end
  }
  return info.results.length > 0 ? info.results[0]!.start : 0
}

// rule blink/output/hang-width
// rule blink/output/end-offset-for-justify
// LineInfo::ComputeTrailingSpaceWidth (line_info.cc:289-415) for a line whose trailing white space is preserved, each
// item under its own style's white-space: the hang width, and the offset the walk stops at, which is EndOffsetForJustify
// (UpdateTextAlign, line_info.cc:275-288). The walk skips items that are opaque to collapsing, so trailing spaces before
// a close tag are found like any others and stay out of justification (rich-prewrap/trailing-spaces c-bb8068601ab36af7).
export function trailingSpacesOf(sh: Shaper, info: LineInfo): { width: number; endOffset: number } {
  const p = sh.p
  if (!info.hasTrailingSpaces) return { width: 0, endOffset: inflowEndOffset(p, info) }
  let trailing = 0
  for (let i = info.results.length - 1; i >= 0; i--) {
    const r = info.results[i]!
    const item = p.items[r.itemIndex]!
    if (item.endCollapseType === 'opaque-to-collapsing') continue
    let itemWidth = 0
    let willContinue = false
    let end = r.end
    if (item.type === 'control' || r.hasOnlyPreWrapTrailingSpaces) {
      itemWidth = r.inlineSize
      willContinue = true
    } else if (item.type === 'text') {
      if (r.end === r.start) continue
      if (isHangingSpace(p.text.charCodeAt(end - 1))) {
        do end--; while (end > r.start && isHangingSpace(p.text.charCodeAt(end - 1)))
        if (end === r.start) {
          itemWidth = r.inlineSize
          willContinue = true
        } else {
          // PositionForOffset over the item result's shape, truncated to a LayoutUnit without reshaping (:340-356).
          positionInsideGrapheme(sh.gaps, p, end)
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
          // No hang, and the item's spaces are justified with the rest (:397-401).
          if (willContinue) end = item.end
          willContinue = false
          break
      }
    }
    if (!willContinue) return { width: trailing, endOffset: end }
  }
  // An empty line, or only trailing spaces (:411-414).
  return { width: trailing, endOffset: info.results.length > 0 ? info.results[0]!.start : 0 }
}

// ComputedStyle::GetTextAlign(is_last_line) with text-align-last: auto: justify on the last line and before a forced break
// is start (line_info.cc:109-125, 275-276).
export function usedTextAlign(align: TextAlign, info: LineInfo): TextAlign {
  return align === 'justify' && info.isLastLine ? 'start' : align
}

// Blink reshapes a line edge between joining letters, which are unsafe to break in every font; the reshaped side keeps
// the joined forms only in a font that reads HarfBuzz's context (FontFacts.joining 'opentype').
function joinsNextLine(p: BlinkPrepared, next: BlinkLineStart | null): boolean {
  if (next === null) return false
  // The group whose text ends at k or holds it inside: the one of the unit before k.
  const k = next.textOffset
  const g = k > 0 ? p.groupOfUnit[k - 1]! : -1
  if (g < 0) return false
  const group = p.groups[g]!
  switch (p.styles[group.style]!.font.facts.joining) {
    case 'opentype': return joinsAcross(p, k, group.start, group.end)
    case 'aat': return false
    case null: return false
  }
}

// The pieces of the line `info` filled from `start`. It measures what the hanging width needs and raises nothing.
export function piecesOf(p: BlinkPrepared, info: LineInfo, start: BlinkLineStart): LinePieces<BlinkPaintFacts> {
  const next = info.token
  const range = lineSourceRange(p, start, next)
  const hangWidth = trailingSpacesOf({ p, gaps: null }, info).width
  return {
    fragments: fragmentsOf(p, info, start.textOffset, next === null ? p.text.length : next.textOffset, range.start, range.end),
    joinsNextLine: joinsNextLine(p, next), indented: info.textIndent !== 0, align: usedTextAlign(p.paragraph.textAlign, info),
    overflows: info.width - hangWidth - info.availableWidth > 0, facts: { needsAccurateEndPosition: info.needsAccurateEndPosition },
  }
}
