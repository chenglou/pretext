import { clampLU } from './layout-unit.js'
// text_content and items: which text nodes get a LayoutText (specs/blink-text.md §2.A), InlineItemsBuilder's
// white-space processing (§2.C) over the inline tree in document order, with open and close tags, atomic inlines, <br>
// and <wbr> (inline_items_builder.cc), bidi item splitting (§2.D) and the styles items are handled under.
import type { ContentIndex } from '../../content.js'
import { listedFamilies } from '../../font-family.js'
import type { FontDecl, Paragraph, TextStyle, WhiteSpace } from '../../model.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import { blinkBidiData } from './data.js'
import type { BlinkBoxEdge, ComputedStyle, EndCollapseType, InlineItem, IteratorSettings } from './types.js'

const SPACE = 0x20
const TAB = 0x09
const LF = 0x0a
const CR = 0x0d
const FF = 0x0c
const ZWSP = 0x200b
const ZWNJ = 0x200c
const ORC = 0xfffc

// character.h:150-153
function isCollapsibleSpace(c: number): boolean {
  return c === SPACE || c === LF || c === TAB || c === CR
}

// IsBreakableSpace as the line breaker reads it: a space or a tab (line_breaker.cc:186-188).
export function isSpaceLB(c: number): boolean {
  return c === SPACE || c === TAB
}

// IsAsciiSpace: U+0020, U+0009..U+000D (ascii_ctype.h:102-104).
function isAsciiSpace(c: number): boolean {
  return c === SPACE || (c >= 0x09 && c <= 0x0d)
}

// inline_items_builder.cc:164-184, used in preserve modes only.
function isControlItemCharacter(c: number): boolean {
  return c === LF || c === TAB || c === ZWNJ || c === CR || c === FF
}

// ComputedStyle::ShouldCollapseWhiteSpaces, ShouldPreserveBreaks, ShouldWrapLine over white-space's longhands
// (white-space-collapse, text-wrap-mode; computed_style.h).
export function collapsesWhiteSpace(ws: WhiteSpace): boolean {
  return ws === 'normal' || ws === 'nowrap' || ws === 'pre-line'
}

function preservesBreaks(ws: WhiteSpace): boolean {
  return ws !== 'normal' && ws !== 'nowrap'
}

export function wrapsLines(ws: WhiteSpace): boolean {
  return ws !== 'nowrap' && ws !== 'pre'
}

// SetCurrentStyleForce's iterator settings for one style (line_breaker.cc:4557-4643), hyphens: manual.
function iteratorSettings(style: TextStyle): IteratorSettings {
  const autoWrap = wrapsLines(style.whiteSpace)
  let strictness: IteratorSettings['strictness']
  let breakType: IteratorSettings['breakType']
  let breakAnywhereIfOverflow = false
  if (style.lineBreak === 'anywhere') {
    strictness = 'default'
    breakType = 'break-character'
  } else {
    switch (style.lineBreak) {
      case 'auto': strictness = 'default'; break
      case 'normal': strictness = 'normal'; break
      case 'strict': strictness = 'strict'; break
      case 'loose': strictness = 'loose'; break
    }
    switch (style.wordBreak) {
      case 'normal': breakType = 'normal'; break
      case 'break-all': breakType = 'break-all'; break
      case 'break-word': breakType = 'normal'; breakAnywhereIfOverflow = true; break
      case 'keep-all': breakType = 'keep-all'; break
    }
    if (!breakAnywhereIfOverflow) breakAnywhereIfOverflow = style.overflowWrap === 'anywhere' || style.overflowWrap === 'break-word'
  }
  return {
    autoWrap, strictness, breakType, breakAnywhereIfOverflow, softHyphen: true,
    breakSpace: style.whiteSpace === 'break-spaces' ? 'after-every-space' : 'after-space-run',
  }
}

// A CSS fixed Length: resolve the double literal under float zoom, clamp to the CSS Length range, then store its float
// (CSSPrimitiveValue::ComputeLength<Length>/ClampToCSSLengthRange, css_primitive_value.cc:44-65,328-331;
// CSSLengthResolver::ZoomedComputedPixels, css_length_resolver.cc:153-159). Only then does MinimumValueForLength cast
// Length::Pixels() to LayoutUnit (length_functions.h:62-64; layout_unit.h:125-130). Border widths use a separate producer.
export function lengthLU(px: number, zoom: number): number {
  const stored = Math.fround(Math.min(33554429, Math.max(-33554430, px * Math.fround(zoom))))
  return clampLU(Math.fround(stored * 64))
}

const NO_EDGE: BlinkBoxEdge = { margin: 0, border: 0, padding: 0 }

// ConvertBorderWidth: the zoomed px as a float, then ClampLineWidth, 1 below one px and the floor otherwise, stored as an
// integer (style_builder_converter.cc:1953-1990).
function borderLU(px: number, zoom: number): number {
  const zoomed = Math.fround(px * zoom)
  const width = zoomed > 0 && zoomed < 1 ? 1 : Math.min(33554431, Math.max(0, Math.floor(zoomed)))
  return width * 64
}

function edgeLU(edge: { margin: number; border: number; padding: number }, zoom: number): BlinkBoxEdge {
  return { margin: lengthLU(edge.margin, zoom), border: borderLU(edge.border, zoom), padding: lengthLU(edge.padding, zoom) }
}

// Element::MapLanguageAttributeToLocale: a non-empty lang sets -webkit-locale, lang="" sets it to auto, a null locale,
// "the language is explicitly unknown" (element.cc:12653-12686 at 153; the lab's native lines agree, case
// c-faf5ba9af9ede412: lang="" breaks after ” under the zh-CN UI table). specs/blink-text.md §2.F.3 says lang="" inherits;
// the source says otherwise. A span without lang inherits its parent's locale. The root element starts from
// Content-Language (style_resolver.cc:2405-2406), but in this model the block always has a lang attribute (lang="" when
// the case says ''), which replaces it, so BlinkEnvironment.contentLanguage never reaches a locale here.
export function stylesOf(paragraph: Paragraph, index: ContentIndex<FontDecl>, zoom: number): { styles: ComputedStyle[]; styleOfLeaf: number[]; styleOfElement: number[] } {
  const blockLocale = paragraph.lang !== '' ? paragraph.lang : null
  const styles: ComputedStyle[] = [styleOf(-1, 0, paragraph, blockLocale, NO_EDGE, NO_EDGE, 'baseline')]
  const styleOfElement: number[] = []
  for (let e = 0; e < index.elements.length; e++) {
    const element = index.elements[e]!
    const parent = element.parent < 0 ? 0 : styleOfElement[element.parent]!
    const node = element.node
    if (node.kind !== 'span') {
      styleOfElement.push(parent)
      continue
    }
    const locale = node.lang === null ? styles[parent]!.locale : node.lang !== '' ? node.lang : null
    styleOfElement.push(styles.length)
    styles.push(styleOf(e, parent, node, locale, edgeLU(node.inlineStart, zoom), edgeLU(node.inlineEnd, zoom), node.verticalAlign))
  }
  const styleOfLeaf: number[] = []
  for (let r = 0; r < index.leaves.length; r++) {
    const leaf = index.leaves[r]!
    const style = leaf.parent < 0 ? 0 : styleOfElement[leaf.parent]!
    styleOfLeaf.push(style)
    if (styles[style]!.run === null) styles[style]!.run = r
  }
  return { styles, styleOfLeaf, styleOfElement }
}

// The primary family is FontFacts.primaryFamily, or the first family of the list (DESIGN.md §1.2).
function styleOf(element: number, parent: number, style: TextStyle, locale: string | null, start: BlinkBoxEdge, end: BlinkBoxEdge, verticalAlign: ComputedStyle['verticalAlign']): ComputedStyle {
  const font = style.font
  const first = listedFamilies(font.family)[0]!
  const keyword = font.facts.primaryFamily !== null ? isSystemFontKeyword(font.facts.primaryFamily, false) : isSystemFontKeyword(first.name, first.quoted)
  return {
    element, parent, run: null, font, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, whiteSpace: style.whiteSpace,
    wordBreak: style.wordBreak, overflowWrap: style.overflowWrap, lineBreak: style.lineBreak, tabSize: style.tabSize, locale,
    measuresAtCssSize: font.facts.opticalSizeAxis ?? keyword,
    start, end, verticalAlign, iterator: iteratorSettings(style), shouldCreateBoxFragment: false,
  }
}

// Equal Font (font_description.cc:136-157): family, size, weight, style, locale and spacing.
export function sameFont(a: ComputedStyle, b: ComputedStyle): boolean {
  return a.font.family === b.font.family && a.font.size === b.font.size && a.font.weight === b.font.weight && a.font.style === b.font.style &&
    a.locale === b.locale && a.letterSpacing === b.letterSpacing && a.wordSpacing === b.wordSpacing
}

// BoxInfo::text_metrics compares FontHeight of the primary fonts (inline_items_builder.cc:236-266); equal font
// declarations have equal metrics. Different declarations are taken to differ, which only decides whether a span without
// box edges creates a box fragment for its element rects, never where lines break.
function fontHeightsDiffer(a: ComputedStyle, b: ComputedStyle): boolean {
  return a.font.family !== b.font.family || a.font.size !== b.font.size || a.font.weight !== b.font.weight || a.font.style !== b.font.style
}

// The families Blink resolves to the macOS system UI font: the generic system-ui (FontCache::GetFontPlatformData,
// font_cache_mac.mm:408) and the family name BlinkMacSystemFont (LegacySystemFontFamily, :289-292). The system UI font
// has an opsz axis (probes-chrome correction 7), which is the documented default of FontFacts.opticalSizeAxis.
// The names are compared as Blink compares them. Unquoted, system-ui is a CSS value keyword, looked up in ASCII lowercase
// (ConsumeGenericFamily, css_parsing_utils.cc:6420-6422; CssValueKeywordID, css_property_parser.cc:387-406), and the style
// builder names it system-ui (style_builder_converter.cc:476-477). A family name, quoted or not, stays as written:
// BlinkMacSystemFont becomes system-ui only when it equals LegacySystemFontFamily exactly (:544-547), and the font cache
// gives the system UI font to the name system-ui whether it came from the keyword or from a quoted name
// (font_fallback_list.cc:168-174, then font_cache_mac.mm:408). Probe blink-sysui-spellings at DPR 2: System-UI, SYSTEM-UI,
// "system-ui" and "BlinkMacSystemFont" lay out as system-ui does; blinkmacsystemfont and BLINKMACSYSTEMFONT name nothing
// and fall to the standard font. So does a quoted "System-UI" in a clean renderer, which is the answer here; once
// system-ui exists at its size it gets the system UI font, because the platform font cache's key compares names without
// case (font_face_creation_params.h:115-124).
function isSystemFontKeyword(name: string, quoted: boolean): boolean {
  return (quoted ? name : name.toLowerCase()) === 'system-ui' || name === 'BlinkMacSystemFont'
}

// ComputedStyle predicates over a span's box edges as the lab sets them (only non-zero lengths are written): MayHaveMargin,
// MayHavePadding, HasBorder, and HasBoxDecorationBackground, which a border makes true (computed_style.h).
export function mayHaveMargin(style: ComputedStyle): boolean {
  return style.start.margin !== 0 || style.end.margin !== 0
}

export function mayHavePadding(style: ComputedStyle): boolean {
  return style.start.padding !== 0 || style.end.padding !== 0
}

export function hasBorder(style: ComputedStyle): boolean {
  return style.start.border !== 0 || style.end.border !== 0
}

// ShouldBreakShapingBeforeBox and ShouldBreakShapingAfterBox (inline_node.cc:494-527).
export function breaksShapingBefore(style: ComputedStyle): boolean {
  return style.start.padding !== 0 || style.start.margin !== 0 || style.start.border !== 0 || style.verticalAlign !== 'baseline'
}

export function breaksShapingAfter(style: ComputedStyle): boolean {
  return style.end.padding !== 0 || style.end.margin !== 0 || style.end.border !== 0 || style.verticalAlign !== 'baseline'
}

// IsInlineBoxStartEmpty (inline_item.cc:32-46) and IsInlineBoxEndEmpty (:53-67) of a span's open and close tag, no quirks
// mode (inline_item.cc:32-67).
export function boxStartEmpty(style: ComputedStyle): boolean {
  return style.start.border === 0 && style.start.padding === 0 && style.start.margin === 0
}

export function boxEndEmpty(style: ComputedStyle): boolean {
  return style.end.border === 0 && style.end.padding === 0 && style.end.margin === 0
}

export type Content = {
  text: string
  sourceOffsets: Int32Array
  items: InlineItem[]
  hasNonOrc16Bit: boolean
}

// What the previous in-flow layout object among a node's siblings was, for Text::TextLayoutObjectIsNeeded
// (text.cc:319-364): none, a LayoutText (with whether its text ends with white space), an inline, or a <br>.
type PreviousInFlow = null | { kind: 'text'; endsWithSpace: boolean } | { kind: 'inline' } | { kind: 'br' }

class Builder {
  private units: number[] = []
  private src: number[] = []
  items: InlineItem[] = []
  hasNonOrc16Bit = false
  readonly styles: ComputedStyle[]
  // The styles of the spans that are open (BoxInfo, inline_items_builder.cc:236-266).
  readonly boxes: { style: number; open: number }[] = []
  // Only the last non-opaque item can have its trailing space removed/restored. Earlier ones are finalized.
  private lastCollapse = -1
  private beforeLastBlocking = -1
  private nonOpaqueBlocking = -1
  private opaqueBlocking = -1
  // The current eligible item's erased space remains physically present until that item is finalized.
  // Later items are opaque; their offsets use that physical coordinate space during this epoch.
  private removedAt = -1

  get length(): number { return this.units.length - (this.removedAt < 0 ? 0 : 1) }
  unitAt(offset: number): number | undefined {
    return this.units[offset + (this.removedAt >= 0 && offset >= this.removedAt ? 1 : 0)]
  }

  private finalizeSpace(): void {
    if (this.removedAt < 0) return
    this.units.splice(this.removedAt, 1)
    this.src.splice(this.removedAt, 1)
    for (let i = this.lastCollapse + 1; i < this.items.length; i++) {
      this.items[i]!.start--
      this.items[i]!.end--
    }
    this.removedAt = -1
  }

  finish(): Content {
    this.finalizeSpace()
    let text = ''
    for (let i = 0; i < this.units.length; i += 4096) text += String.fromCharCode(...this.units.slice(i, i + 4096))
    return { text, sourceOffsets: Int32Array.from(this.src), items: this.items, hasNonOrc16Bit: this.hasNonOrc16Bit }
  }

  constructor(styles: ComputedStyle[]) {
    this.styles = styles
  }

  push(c: number, source: number): void {
    this.units.push(c)
    this.src.push(source)
    // IsNonOrc16BitCharacter (inline_items_builder.cc).
    if (c >= 0x100 && c !== ORC) this.hasNonOrc16Bit = true
  }

  // What an item over the units appended since `start` holds, whatever its type.
  span(start: number, style: number, endCollapseType: EndCollapseType): { start: number; end: number; style: number; bidiLevel: number; endCollapseType: EndCollapseType } {
    return { start, end: this.length, style, bidiLevel: 0, endCollapseType }
  }

  private blocksEmptySpan(item: InlineItem): boolean {
    return !this.isEmptyItem(item) && !(item.type === 'text' && item.endCollapseType === 'collapsible' && item.end - item.start === 1)
  }

  private appendItem(item: InlineItem): void {
    if (item.endCollapseType === 'opaque-to-collapsing') {
      // Every opaque item appended after the eligible item is at or beyond its pending erased space.
      if (this.removedAt >= 0) { item.start++; item.end++ }
    } else this.finalizeSpace()
    const index = this.items.length
    this.items.push(item)
    if (item.endCollapseType === 'opaque-to-collapsing') {
      if (this.blocksEmptySpan(item)) this.opaqueBlocking = index
    } else {
      this.beforeLastBlocking = this.nonOpaqueBlocking
      this.lastCollapse = index
      if (this.blocksEmptySpan(item)) this.nonOpaqueBlocking = index
    }
  }

  // LastItemToCollapseWith (inline_items_builder.cc:207-214), maintained as the append-only stream's cursor.
  lastItemToCollapseWith(): InlineItem | null {
    return this.lastCollapse < 0 ? null : this.items[this.lastCollapse]!
  }

  // ShouldRemoveNewline with the East Asian width rule compiled out (inline_items_builder.cc:67, 92-151).
  shouldRemoveNewline(spaceIndex: number, after: string): boolean {
    return (spaceIndex > 0 && this.unitAt(spaceIndex - 1) === ZWSP) || (after.length > 0 && after.charCodeAt(0) === ZWSP)
  }

  // RemoveTrailingCollapsibleSpace (inline_items_builder.cc:1376-1410).
  removeTrailingCollapsibleSpace(item: InlineItem): void {
    if (item.type !== 'text') return
    this.removedAt = item.end - 1
    item.end--
    item.endCollapseType = 'collapsed'
    this.nonOpaqueBlocking = this.lastCollapse
  }

  removeTrailingCollapsibleSpaceIfExists(): void {
    const item = this.lastItemToCollapseWith()
    if (item !== null && item.endCollapseType === 'collapsible') this.removeTrailingCollapsibleSpace(item)
  }

  // RestoreTrailingCollapsibleSpaceIfRemoved (inline_items_builder.cc:1412-1451).
  restoreTrailingCollapsibleSpaceIfRemoved(): void {
    const item = this.lastItemToCollapseWith()
    if (item === null || item.endCollapseType !== 'collapsed') return
    this.removedAt = -1
    item.end++
    item.endCollapseType = 'collapsible'
    this.nonOpaqueBlocking = this.blocksEmptySpan(item) ? this.lastCollapse : this.beforeLastBlocking
  }

  // AppendBreakOpportunity (inline_items_builder.cc:1209-1218): an opaque U+200B flow-control item, a <wbr>'s or one
  // generated for a text leaf.
  appendBreakOpportunity(of: { control: 'wbr'; element: number } | { control: 'generated-zwsp'; run: number }, style: number): void {
    const start = this.length
    this.push(ZWSP, -1)
    this.appendItem({ ...this.span(start, style, 'opaque-to-collapsing'), type: 'control', ...of })
  }

  // AppendCollapseWhitespace (inline_items_builder.cc:784-985). `base` is S's source offset.
  appendCollapseWhitespace(s: string, base: number, run: number, style: number): void {
    const n = s.length
    let i = 0
    let endCollapse: EndCollapseType = 'not-collapsible'
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
        if (last.type === 'text' && (runHasNewline || last.isEndCollapsibleNewline) && this.shouldRemoveNewline(last.end - 1, s.slice(i))) {
          this.removeTrailingCollapsibleSpace(last)
          runHasNewline = false
        } else if (!wrapsLines(this.styles[last.style]!.whiteSpace) && wrapsLines(this.styles[style]!.whiteSpace)) {
          // A nowrap space run collapsing a following wrapping one keeps its soft wrap opportunity through a generated
          // break opportunity, except right after a forced break (847-866; AppendGeneratedBreakOpportunity, 317-326).
          if (last.type !== 'control' || this.unitAt(last.start) !== LF) this.appendBreakOpportunity({ control: 'generated-zwsp', run }, style)
        }
      }
      if (runHasNewline && this.shouldRemoveNewline(this.length, s.slice(i))) {
        insertSpace = false
        runHasNewline = false
      }
      start = this.length
      if (insertSpace) this.push(SPACE, base)
      if (i === n) endCollapse = 'collapsible'
    } else {
      const last = this.lastItemToCollapseWith()
      if (last !== null && last.type === 'text' && last.endCollapseType === 'collapsible' && last.isEndCollapsibleNewline && this.shouldRemoveNewline(last.end - 1, s)) {
        this.removeTrailingCollapsibleSpace(last)
      }
      start = this.length
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
      if (runHasNewline && this.shouldRemoveNewline(this.length, s.slice(i))) {
        endCollapse = 'not-collapsible'
        runHasNewline = false
      } else {
        this.push(SPACE, base + j)
        endCollapse = 'collapsible'
      }
    }
    // AppendEmptyTextItem (302-312) when nothing was appended.
    if (this.length === start) this.appendItem({ ...this.span(start, style, 'opaque-to-collapsing'), type: 'text', run, isEndCollapsibleNewline: false })
    else this.appendItem({ ...this.span(start, style, endCollapse), type: 'text', run, isEndCollapsibleNewline: runHasNewline })
  }

  // AppendForcedBreak (1162-1199): no bidi contexts in this model. `source` is -1 for a <br>'s LF.
  appendForcedBreak(source: number, of: { control: 'forced-break'; run: number } | { control: 'br'; element: number }, style: number): void {
    const start = this.length
    this.push(LF, source)
    this.appendItem({ ...this.span(start, style, 'collapsible'), type: 'control', ...of })
  }

  // AppendPreserveNewline (1138-1160).
  appendPreserveNewline(s: string, base: number, run: number, style: number): void {
    for (let start = 0; start < s.length;) {
      if (s.charCodeAt(start) === LF) {
        this.removeTrailingCollapsibleSpaceIfExists() // AppendForcedBreakCollapseWhitespace (1201-1208)
        this.appendForcedBreak(base + start, { control: 'forced-break', run }, style)
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
    const ws = this.styles[style]!.whiteSpace
    if (collapsesWhiteSpace(ws) || !wrapsLines(ws) || start >= s.length || s.charCodeAt(start) !== SPACE) return start
    const atLineStart = start > 0 ? s.charCodeAt(start - 1) === LF : this.length === 0 || this.unitAt(this.length - 1) === LF
    if (!atLineStart) return start
    let end = start
    do end++; while (end < s.length && s.charCodeAt(end) === SPACE)
    const itemStart = this.length
    for (let k = start; k < end; k++) this.push(SPACE, base + k)
    this.appendItem({ ...this.span(itemStart, style, 'not-collapsible'), type: 'text', run, isEndCollapsibleNewline: false })
    this.appendBreakOpportunity({ control: 'generated-zwsp', run }, style)
    return end
  }

  appendTextItem(s: string, base: number, from: number, to: number, run: number, style: number): void {
    const start = this.length
    for (let k = from; k < to; k++) this.push(s.charCodeAt(k), base + k)
    this.appendItem({ ...this.span(start, style, 'not-collapsible'), type: 'text', run, isEndCollapsibleNewline: false })
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
        this.appendForcedBreak(base + start, { control: 'forced-break', run }, style)
        start++
        start = this.insertBreakAfterLeadingPreservedSpaces(s, base, run, style, start)
      } else if (c === TAB) {
        let end = start + 1
        while (end < n && s.charCodeAt(end) === TAB) end++
        const itemStart = this.length
        for (let k = start; k < end; k++) this.push(TAB, base + k)
        this.appendItem({ ...this.span(itemStart, style, 'not-collapsible'), type: 'control', control: 'tab', run })
        start = end
      } else if (c === ZWNJ) {
        // ZWNJ splits the item but stays text (1112-1118).
        control = findControl(start + 1)
        continue
      } else {
        const itemStart = this.length
        this.push(c, base + start)
        this.appendItem({ ...this.span(itemStart, style, 'not-collapsible'), type: 'control', control: 'cr-ff', run })
        start++
      }
      if (start >= n) break
      control = findControl(start)
    }
  }

  // AppendText's dispatch (inline_items_builder.cc:637-679) for a leaf's text under its style. A text whose string is
  // stored in 16 bits counts as 16-bit content whatever its characters (AppendTransformedString, :725), and the leaf's
  // text node is stored in 16 bits when it holds a unit above U+00FF, U+FFFC included: the HTML parser stores a text in
  // 8 bits when its units fit (literal_buffer.h:306-321), and so does V8 but for slices of 13 units or more out of a
  // two-byte string and what is built from them (to_blink_string.cc:216-227; specs/blink-RESULTS.md "String storage"),
  // which no script can tell apart. Probe blink-storage S4: 13 brackets in Amiri are shaped as one Latin segment beside
  // an inline-block and segmented beside a text node that holds U+FFFC alone.
  // rule blink/script/single-latin-segment
  appendText(s: string, base: number, run: number, style: number): void {
    for (let i = 0; i < s.length && !this.hasNonOrc16Bit; i++) if (s.charCodeAt(i) >= 0x100) this.hasNonOrc16Bit = true
    this.restoreTrailingCollapsibleSpaceIfRemoved()
    const ws = this.styles[style]!.whiteSpace
    if (!collapsesWhiteSpace(ws) && ws !== 'pre-line') this.appendPreserveWhitespace(s, base, run, style)
    else if (ws === 'pre-line') this.appendPreserveNewline(s, base, run, style)
    else this.appendCollapseWhitespace(s, base, run, style)
  }

  // A <br>: LayoutBR's text "\n" under its parent's style through AppendText. In collapse modes the lone newline is a
  // forced break after the trailing collapsible space goes (AppendForcedBreakCollapseWhitespace, 814-826); preserve modes
  // append it as a newline (AppendPreserveWhitespace, 1040-1136), which for a lone LF is the forced break alone.
  appendLineBreak(element: number, style: number): void {
    this.restoreTrailingCollapsibleSpaceIfRemoved()
    if (collapsesWhiteSpace(this.styles[style]!.whiteSpace)) this.removeTrailingCollapsibleSpaceIfExists()
    this.appendForcedBreak(-1, { control: 'br', element }, style)
  }

  // EnterInline (1530-1620): the open tag, and the parent box's ShouldCreateBoxFragment when this child needs it.
  enterInline(element: number, style: number): void {
    const st = this.styles[style]!
    this.appendItem({ ...this.span(this.length, style, 'opaque-to-collapsing'), type: 'open-tag', element })
    // LayoutInline::ComputeInitialShouldCreateBoxFragment (layout_inline.cc:183-213): decoration background, padding or
    // margin.
    st.shouldCreateBoxFragment = hasBorder(st) || mayHavePadding(st) || mayHaveMargin(st)
    if (this.boxes.length > 0) {
      const parent = this.styles[this.boxes[this.boxes.length - 1]!.style]!
      // ShouldCreateBoxFragmentForChild (inline_items_builder.cc:244-266).
      if (!parent.shouldCreateBoxFragment && (mayHaveMargin(st) || st.verticalAlign !== 'baseline' || fontHeightsDiffer(parent, st))) parent.shouldCreateBoxFragment = true
    }
    this.boxes.push({ style, open: this.items.length - 1 })
  }

  // InlineItem::IsEmptyItem as the builder sees it: an empty text item (AppendEmptyTextItem, 302-312, the one text item
  // that is opaque to collapsing) and a tag whose side has no border, padding or margin (ComputeBoxProperties,
  // inline_item.cc:118-151). A text item whose last space was removed is not one (1376-1410).
  isEmptyItem(item: InlineItem): boolean {
    switch (item.type) {
      case 'text': return item.endCollapseType === 'opaque-to-collapsing'
      case 'open-tag': return boxStartEmpty(this.styles[item.style]!)
      case 'close-tag': return boxEndEmpty(this.styles[item.style]!)
      case 'control': case 'atomic': return false
    }
  }

  // ExitInline (1631-1694). A box that holds nothing but empty items and text items that are one collapsible space creates
  // a box fragment, "so that we can compute its position/size correctly" (1660-1691): the space can't collapse until the
  // next node comes. So a span around a space the line end removes still has a rect on that line, of no width (case
  // c-d600d9b01c0ae9d7: natively a rect 0 wide at the end of `delta gamma`).
  exitInline(element: number, style: number): void {
    const st = this.styles[style]!
    // The old reverse walk stopped at the nearest blocking item or this span's open tag.
    const open = this.boxes[this.boxes.length - 1]!.open
    if (!st.shouldCreateBoxFragment && Math.max(this.nonOpaqueBlocking, this.opaqueBlocking) <= open) st.shouldCreateBoxFragment = true
    this.appendItem({ ...this.span(this.length, style, 'opaque-to-collapsing'), type: 'close-tag', element })
    this.boxes.pop()
  }

  // AppendAtomicInline (1267-1287).
  appendAtomicInline(element: number, style: number): void {
    this.restoreTrailingCollapsibleSpaceIfRemoved()
    const start = this.length
    this.push(ORC, -1)
    this.appendItem({ ...this.span(start, style, 'not-collapsible'), type: 'atomic', element })
    if (this.boxes.length > 0) this.styles[this.boxes[this.boxes.length - 1]!.style]!.shouldCreateBoxFragment = true
  }
}

// Text::TextLayoutObjectIsNeeded (text.cc:319-364) for a leaf under a block or inline parent.
function layoutTextNeeded(text: string, style: ComputedStyle, parentIsInline: boolean, previous: PreviousInFlow): boolean {
  if (text.length === 0) return false
  let whitespaceOnly = true
  for (let i = 0; i < text.length; i++) {
    if (!isAsciiSpace(text.charCodeAt(i))) { whitespaceOnly = false; break }
  }
  if (!whitespaceOnly) return true
  if (preservesBreaks(style.whiteSpace)) return true
  if (previous === null) return parentIsInline
  switch (previous.kind) {
    case 'text': return !previous.endsWithSpace
    case 'inline': return true
    case 'br': return false
  }
}

// Builds the items, and sets each span's shouldCreateBoxFragment on its style.
export function buildContent(index: ContentIndex<FontDecl>, styles: ComputedStyle[], styleOfLeaf: number[], styleOfElement: number[]): Content {
  const b = new Builder(styles)
  // The previous in-flow sibling per parent: index e + 1, 0 for the block. Children of an element start with none
  // (Element::AttachLayoutTree, element.cc:4774, 4792), and an element becomes its parent's previous in-flow object once
  // attached (:4817, :4852).
  const previous: PreviousInFlow[] = new Array(index.elements.length + 1).fill(null)
  for (let v = 0; v < index.events.length; v++) {
    const event = index.events[v]!
    switch (event.kind) {
      case 'open':
        b.enterInline(event.element, styleOfElement[event.element]!)
        previous[event.element + 1] = null
        break
      case 'close':
        b.exitInline(event.element, styleOfElement[event.element]!)
        previous[index.elements[event.element]!.parent + 1] = { kind: 'inline' }
        break
      case 'text': {
        const leaf = index.leaves[event.run]!
        const style = styleOfLeaf[event.run]!
        if (layoutTextNeeded(leaf.text, styles[style]!, leaf.parent >= 0, previous[leaf.parent + 1]!)) {
          b.appendText(leaf.text, leaf.start, event.run, style)
          previous[leaf.parent + 1] = { kind: 'text', endsWithSpace: isAsciiSpace(leaf.text.charCodeAt(leaf.text.length - 1)) }
        }
        break
      }
      case 'atomic': {
        b.appendAtomicInline(event.element, styleOfElement[event.element]!)
        previous[index.elements[event.element]!.parent + 1] = { kind: 'inline' }
        break
      }
      case 'br':
        b.appendLineBreak(event.element, styleOfElement[event.element]!)
        previous[index.elements[event.element]!.parent + 1] = { kind: 'br' }
        break
      case 'wbr':
        // LayoutWordBreak is a LayoutText with empty text (layout_word_break.cc:35; inline_items_builder.cc:597-607).
        b.appendBreakOpportunity({ control: 'wbr', element: event.element }, styleOfElement[event.element]!)
        previous[index.elements[event.element]!.parent + 1] = { kind: 'text', endsWithSpace: false }
        break
    }
  }
  b.removeTrailingCollapsibleSpaceIfExists() // ExitBlock (1621-1629)
  return b.finish()
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
export function segmentBidiRuns(paragraph: Paragraph, content: Content): { items: InlineItem[]; enabled: boolean } {
  const rtlBlock = paragraph.direction === 'rtl' // EnterBlock sets has_bidi_controls_ for an RTL block
  if (!rtlBlock && !(content.hasNonOrc16Bit && maybeBidiRtl(content.text))) return { items: content.items, enabled: false }
  const bidi = resolveIcuBidi(content.text, paragraph.direction, blinkBidiData)
  if (bidi.direction === 'ltr' && !rtlBlock) return { items: content.items, enabled: false }
  const levels = bidi.levels
  const out: InlineItem[] = []
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
        const part = { start, end: k, bidiLevel: levels[start]!, endCollapseType: k === item.end ? item.endCollapseType : 'not-collapsible' as const }
        if (item.type === 'text') out.push({ ...item, ...part, isEndCollapsibleNewline: k === item.end && item.isEndCollapsibleNewline })
        else out.push({ ...item, ...part })
        start = k
      }
    }
  }
  return { items: out, enabled: true }
}
