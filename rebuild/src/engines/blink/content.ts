// text_content and items: which text nodes get a LayoutText (specs/blink-text.md §2.A), InlineItemsBuilder's
// white-space processing (§2.C), bidi item splitting (§2.D) and shaping groups (§2.E).
import type { Paragraph } from '../../model.js'
import { bidiDataFor } from '../../unicode/bidi.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import type { BlinkEndCollapseType, BlinkItem, BlinkStyle } from './types.js'

const SPACE = 0x20
const TAB = 0x09
const LF = 0x0a
const CR = 0x0d
const FF = 0x0c
const ZWSP = 0x200b
const ZWNJ = 0x200c

// character.h:150-153
export function isCollapsibleSpace(c: number): boolean {
  return c === SPACE || c === LF || c === TAB || c === CR
}

// IsAsciiSpace: U+0020, U+0009..U+000D (ascii_ctype.h:102-104).
function isAsciiSpace(c: number): boolean {
  return c === SPACE || (c >= 0x09 && c <= 0x0d)
}

// inline_items_builder.cc:164-184, used in preserve modes only.
function isControlItemCharacter(c: number): boolean {
  return c === LF || c === TAB || c === ZWNJ || c === CR || c === FF
}

export type Content = {
  text: string
  sourceOffsets: Int32Array
  items: BlinkItem[]
  hasNonOrc16Bit: boolean
}

// Element::MapLanguageAttributeToLocale: a non-empty lang sets -webkit-locale, lang="" sets it to auto, a null locale,
// "the language is explicitly unknown" (element.cc:12568-12600 at 152; the lab's native lines agree, case
// c-faf5ba9af9ede412: lang="" breaks after ” under the zh-CN UI table). specs/blink-text.md §2.F.3 says lang="" inherits;
// the source says otherwise. The root starts from Content-Language (style_resolver.cc:2405-2406).
export function styles(paragraph: Paragraph): { styles: BlinkStyle[]; styleOfRun: number[] } {
  const blockLocale = paragraph.lang !== '' ? paragraph.lang : null
  const out: BlinkStyle[] = []
  const key = (s: Omit<BlinkStyle, 'fontKey'>): string =>
    [s.font.family, s.font.size, s.font.weight, s.font.style, s.locale, s.letterSpacing, s.wordSpacing].join('\u0001')
  const block = { run: null, font: paragraph.font, letterSpacing: paragraph.letterSpacing, wordSpacing: paragraph.wordSpacing, locale: blockLocale }
  out.push({ ...block, fontKey: key(block) })
  const styleOfRun: number[] = []
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    switch (run.node) {
      case 'text':
        styleOfRun.push(0)
        break
      case 'span': {
        const s = { run: r, font: run.font, letterSpacing: run.letterSpacing, wordSpacing: run.wordSpacing, locale: run.lang === null ? blockLocale : run.lang !== '' ? run.lang : null }
        styleOfRun.push(out.length)
        out.push({ ...s, fontKey: key(s) })
        break
      }
    }
  }
  return { styles: out, styleOfRun }
}

class Builder {
  units: number[] = []
  src: number[] = []
  items: BlinkItem[] = []
  hasNonOrc16Bit = false
  readonly paragraph: Paragraph
  readonly collapses: boolean
  readonly preservesSpaces: boolean
  readonly wraps: boolean

  constructor(paragraph: Paragraph) {
    this.paragraph = paragraph
    switch (paragraph.whiteSpace) {
      case 'normal': this.collapses = true; this.preservesSpaces = false; this.wraps = true; break
      case 'nowrap': this.collapses = true; this.preservesSpaces = false; this.wraps = false; break
      case 'pre': this.collapses = false; this.preservesSpaces = true; this.wraps = false; break
      case 'pre-wrap': this.collapses = false; this.preservesSpaces = true; this.wraps = true; break
      case 'pre-line': this.collapses = true; this.preservesSpaces = false; this.wraps = true; break
      case 'break-spaces': this.collapses = false; this.preservesSpaces = true; this.wraps = true; break
    }
  }

  push(c: number, source: number): void {
    this.units.push(c)
    this.src.push(source)
    if (c >= 0x100 && c !== 0xfffc) this.hasNonOrc16Bit = true
  }

  item(type: BlinkItem['type'], control: BlinkItem['control'], start: number, run: number, style: number, endCollapseType: BlinkEndCollapseType): BlinkItem {
    const item: BlinkItem = {
      type, control, start, end: this.units.length, run, style, bidiLevel: 0, endCollapseType, isEndCollapsibleNewline: false,
      removedSpaceSource: -1, group: -1,
    }
    this.items.push(item)
    return item
  }

  // LastItemToCollapseWith (inline_items_builder.cc:207-214).
  lastItemToCollapseWith(): BlinkItem | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i]!.endCollapseType !== 'opaque-to-collapsing') return this.items[i]!
    }
    return null
  }

  // ShouldRemoveNewline with the East Asian width rule compiled out (inline_items_builder.cc:67, 92-151).
  shouldRemoveNewline(spaceIndex: number, after: string): boolean {
    return (spaceIndex > 0 && this.units[spaceIndex - 1] === ZWSP) || (after.length > 0 && after.charCodeAt(0) === ZWSP)
  }

  shift(from: BlinkItem, delta: number): void {
    const index = this.items.indexOf(from)
    for (let i = index + 1; i < this.items.length; i++) {
      this.items[i]!.start += delta
      this.items[i]!.end += delta
    }
  }

  // RemoveTrailingCollapsibleSpace (inline_items_builder.cc:1376-1410).
  removeTrailingCollapsibleSpace(item: BlinkItem): void {
    if (item.type !== 'text') return
    const offset = item.end - 1
    item.removedSpaceSource = this.src[offset]!
    this.units.splice(offset, 1)
    this.src.splice(offset, 1)
    item.end--
    item.endCollapseType = 'collapsed'
    this.shift(item, -1)
  }

  removeTrailingCollapsibleSpaceIfExists(): void {
    const item = this.lastItemToCollapseWith()
    if (item !== null && item.endCollapseType === 'collapsible') this.removeTrailingCollapsibleSpace(item)
  }

  // RestoreTrailingCollapsibleSpaceIfRemoved (inline_items_builder.cc:1412-1451).
  restoreTrailingCollapsibleSpaceIfRemoved(): void {
    const item = this.lastItemToCollapseWith()
    if (item === null || item.endCollapseType !== 'collapsed') return
    this.units.splice(item.end, 0, SPACE)
    this.src.splice(item.end, 0, item.removedSpaceSource)
    item.end++
    item.endCollapseType = 'collapsible'
    item.removedSpaceSource = -1
    this.shift(item, 1)
  }

  // AppendCollapseWhitespace (inline_items_builder.cc:784-985). `base` is S's source offset.
  appendCollapseWhitespace(s: string, base: number, run: number, style: number): void {
    const n = s.length
    let i = 0
    let endCollapse: BlinkEndCollapseType = 'not-collapsible'
    let runHasNewline = false
    let start: number
    const endOfSpaceRun = (from: number): void => {
      runHasNewline = false
      i = from
      while (i < n && isCollapsibleSpace(s.charCodeAt(i))) {
        if (s.charCodeAt(i) === LF) runHasNewline = true
        i++
      }
    }
    if (isCollapsibleSpace(s.charCodeAt(0))) {
      endOfSpaceRun(0)
      const last = this.lastItemToCollapseWith()
      let insertSpace: boolean
      if (last === null) {
        insertSpace = false // paragraph-leading spaces (868-872)
      } else if (last.endCollapseType === 'not-collapsible') {
        insertSpace = true
      } else {
        insertSpace = false
        if ((runHasNewline || last.isEndCollapsibleNewline) && last.type === 'text' && this.shouldRemoveNewline(last.end - 1, s.slice(i))) {
          this.removeTrailingCollapsibleSpace(last)
          runHasNewline = false
        }
        // The nowrap-to-wrap generated opportunity (847-866) needs per-span white-space, which the model doesn't have.
      }
      if (runHasNewline && this.shouldRemoveNewline(this.units.length, s.slice(i))) {
        insertSpace = false
        runHasNewline = false
      }
      start = this.units.length
      if (insertSpace) this.push(SPACE, base)
      if (i === n) endCollapse = 'collapsible'
    } else {
      const last = this.lastItemToCollapseWith()
      if (last !== null && last.endCollapseType === 'collapsible' && last.isEndCollapsibleNewline && this.shouldRemoveNewline(last.end - 1, s)) {
        this.removeTrailingCollapsibleSpace(last)
      }
      start = this.units.length
    }
    while (i < n) {
      let j = i
      while (j < n && !isCollapsibleSpace(s.charCodeAt(j))) j++
      for (let k = i; k < j; k++) this.push(s.charCodeAt(k), base + k)
      if (j === n) {
        endCollapse = 'not-collapsible'
        break
      }
      endOfSpaceRun(j)
      if (runHasNewline && this.shouldRemoveNewline(this.units.length, s.slice(i))) {
        endCollapse = 'not-collapsible'
        runHasNewline = false
      } else {
        this.push(SPACE, base + j)
        endCollapse = 'collapsible'
      }
    }
    if (this.units.length === start) {
      this.item('text', 'none', start, run, style, 'opaque-to-collapsing') // AppendEmptyTextItem (302-312)
      return
    }
    const item = this.item('text', 'none', start, run, style, endCollapse)
    item.isEndCollapsibleNewline = runHasNewline
  }

  // AppendForcedBreak (1162-1199): no bidi contexts in this model.
  appendForcedBreak(source: number, run: number, style: number): void {
    const start = this.units.length
    this.push(LF, source)
    this.item('control', 'forced-break', start, run, style, 'collapsible')
  }

  // AppendPreserveNewline (1138-1160).
  appendPreserveNewline(s: string, base: number, run: number, style: number): void {
    for (let start = 0; start < s.length;) {
      if (s.charCodeAt(start) === LF) {
        this.removeTrailingCollapsibleSpaceIfExists() // AppendForcedBreakCollapseWhitespace (1201-1208)
        this.appendForcedBreak(base + start, run, style)
        start++
        continue
      }
      let end = s.indexOf('\n', start + 1)
      if (end < 0) end = s.length
      this.appendCollapseWhitespace(s.slice(start, end), base + start, run, style)
      start = end
    }
  }

  // InsertBreakOpportunityAfterLeadingPreservedSpaces (986-1034).
  insertBreakAfterLeadingPreservedSpaces(s: string, base: number, run: number, style: number, start: number): number {
    if (this.collapses || !this.wraps || start >= s.length || s.charCodeAt(start) !== SPACE) return start
    const atLineStart = start > 0 ? s.charCodeAt(start - 1) === LF : this.units.length === 0 || this.units[this.units.length - 1] === LF
    if (!atLineStart) return start
    let end = start
    do end++; while (end < s.length && s.charCodeAt(end) === SPACE)
    const itemStart = this.units.length
    for (let k = start; k < end; k++) this.push(SPACE, base + k)
    this.item('text', 'none', itemStart, run, style, 'not-collapsible')
    const zwspStart = this.units.length
    this.push(ZWSP, -1)
    this.item('control', 'generated-zwsp', zwspStart, run, style, 'opaque-to-collapsing')
    return end
  }

  appendTextItem(s: string, base: number, from: number, to: number, run: number, style: number): void {
    const start = this.units.length
    for (let k = from; k < to; k++) this.push(s.charCodeAt(k), base + k)
    this.item('text', 'none', start, run, style, 'not-collapsible')
  }

  // AppendPreserveWhitespace (1040-1136).
  appendPreserveWhitespace(s: string, base: number, run: number, style: number): void {
    const n = s.length
    let start = this.insertBreakAfterLeadingPreservedSpaces(s, base, run, style, 0)
    if (start >= n) return
    const findControl = (from: number): number => {
      let c = from
      while (c < n && !isControlItemCharacter(s.charCodeAt(c))) c++
      return c
    }
    let control = findControl(start)
    while (start < n) {
      if (control !== start) {
        this.appendTextItem(s, base, start, control, run, style)
        if (control >= n) break
        start = control
      }
      const c = s.charCodeAt(start)
      if (c === LF) {
        this.appendForcedBreak(base + start, run, style)
        start++
        start = this.insertBreakAfterLeadingPreservedSpaces(s, base, run, style, start)
      } else if (c === TAB) {
        let end = start + 1
        while (end < n && s.charCodeAt(end) === TAB) end++
        const itemStart = this.units.length
        for (let k = start; k < end; k++) this.push(TAB, base + k)
        this.item('control', 'tab', itemStart, run, style, 'not-collapsible')
        start = end
      } else if (c === ZWNJ) {
        // ZWNJ splits the item but stays text (1112-1118).
        control = findControl(start + 1)
        continue
      } else {
        const itemStart = this.units.length
        this.push(c, base + start)
        this.item('control', 'cr-ff', itemStart, run, style, 'not-collapsible')
        start++
      }
      if (start >= n) break
      control = findControl(start)
    }
  }
}

// Text::TextLayoutObjectIsNeeded for a run's text node (text.cc:319-364). A span's text node is the first in-flow child
// of a LayoutInline, so it is always kept; a bare white-space-only node follows its previous in-flow sibling.
function layoutTextNeeded(paragraph: Paragraph, r: number, needed: boolean[]): boolean {
  const run = paragraph.runs[r]!
  if (run.text.length === 0) return false
  let whitespaceOnly = true
  for (let i = 0; i < run.text.length; i++) {
    if (!isAsciiSpace(run.text.charCodeAt(i))) { whitespaceOnly = false; break }
  }
  if (!whitespaceOnly) return true
  switch (run.node) {
    case 'span': return true
    case 'text': break
  }
  switch (paragraph.whiteSpace) {
    case 'pre': case 'pre-wrap': case 'pre-line': case 'break-spaces': return true
    case 'normal': case 'nowrap': break
  }
  for (let p = r - 1; p >= 0; p--) {
    const previous = paragraph.runs[p]!
    switch (previous.node) {
      case 'span': return true // a LayoutInline, not a <br>
      case 'text':
        if (!needed[p]) continue
        return !isAsciiSpace(previous.text.charCodeAt(previous.text.length - 1))
    }
  }
  return false // the first in-flow child of the block
}

export function buildContent(paragraph: Paragraph, styleOfRun: number[]): Content {
  const b = new Builder(paragraph)
  const needed: boolean[] = []
  let base = 0
  for (let r = 0; r < paragraph.runs.length; r++) {
    const run = paragraph.runs[r]!
    const style = styleOfRun[r]!
    needed.push(layoutTextNeeded(paragraph, r, needed))
    if (run.node === 'span') b.item('open-tag', 'none', b.units.length, r, style, 'opaque-to-collapsing')
    if (needed[r]) {
      b.restoreTrailingCollapsibleSpaceIfRemoved() // AppendText (669)
      switch (paragraph.whiteSpace) {
        case 'pre': case 'pre-wrap': case 'break-spaces': b.appendPreserveWhitespace(run.text, base, r, style); break
        case 'pre-line': b.appendPreserveNewline(run.text, base, r, style); break
        case 'normal': case 'nowrap': b.appendCollapseWhitespace(run.text, base, r, style); break
      }
    }
    if (run.node === 'span') b.item('close-tag', 'none', b.units.length, r, style, 'opaque-to-collapsing')
    base += run.text.length
  }
  b.removeTrailingCollapsibleSpaceIfExists() // ExitBlock (1621-1629)
  let text = ''
  for (let i = 0; i < b.units.length; i += 4096) text += String.fromCharCode(...b.units.slice(i, i + 4096))
  return { text, sourceOffsets: Int32Array.from(b.src), items: b.items, hasNonOrc16Bit: b.hasNonOrc16Bit }
}

// Character::MaybeBidiRtl(String) (character.h:295-328).
function maybeBidiRtl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 0x590 && c !== ZWSP && !(c >= 0x2010 && c <= 0x2029) && !(c >= 0x206a && c <= 0xd7ff) && !(c >= 0xff00 && c <= 0xffff)) return true
  }
  return false
}

// is_bidi_enabled_ (inline_items_builder.cc:1744-1746) and SegmentBidiRuns (inline_node.cc:1333-1461): items split
// where ICU's logical runs end (InlineItem::SetBidiLevel, inline_item.cc:207-254).
export function segmentBidiRuns(paragraph: Paragraph, content: Content): { items: BlinkItem[]; enabled: boolean } {
  const rtlBlock = paragraph.direction === 'rtl' // EnterBlock sets has_bidi_controls_ for an RTL block
  if (!rtlBlock && !(content.hasNonOrc16Bit && maybeBidiRtl(content.text))) return { items: content.items, enabled: false }
  const bidi = resolveIcuBidi(content.text, paragraph.direction, bidiDataFor('blink'))
  if (bidi.direction === 'ltr' && !rtlBlock) return { items: content.items, enabled: false }
  const levels = bidi.levels
  const out: BlinkItem[] = []
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i]!
    if (item.start === item.end) {
      item.bidiLevel = item.start < levels.length ? levels[item.start]! : levels.length > 0 ? levels[levels.length - 1]! : (rtlBlock ? 1 : 0)
      out.push(item)
      continue
    }
    let start = item.start
    for (let k = item.start + 1; k <= item.end; k++) {
      if (k === item.end || levels[k] !== levels[start]) {
        out.push({ ...item, start, end: k, bidiLevel: levels[start]!, endCollapseType: k === item.end ? item.endCollapseType : 'not-collapsible', isEndCollapsibleNewline: k === item.end && item.isEndCollapsibleNewline })
        start = k
      }
    }
  }
  return { items: out, enabled: true }
}
