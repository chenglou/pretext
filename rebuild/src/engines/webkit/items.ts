// WebKit's inline items (Safari 27.0): InlineItemsBuilder over the boxes content.ts made. The tree walk with
// InlineItemsBuilder::handleTextContent, the bidi paragraph with its item splits, and the widths a reordered paragraph defers
// (specs/webkit-text.md §5-§6, specs/webkit-lines.md §3). Cited at WebKit-7625.1.29.11.27 under Source/WebCore/:
// IIB = layout/formattingContexts/inline/InlineItemsBuilder.cpp.
import type { ContentIndex } from '../../content.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import { makeFactory, moveToNextBreakablePosition } from './breaks.js'
import { webkitBidiData } from './data.js'
import { boxWidth, itemWidth, singleSpaceWidth } from './measure.js'
import { preservesNewline, preservesSpacesAndTabs } from './style.js'
import { DEFAULT_BIDI_LEVEL, OPAQUE_BIDI_LEVEL, type WebKitBox, type WebKitPrepared, type WebKitTextItem } from './types.js'

// InlineItemsBuilder::build (IIB:121-135) over the boxes of the rendered runs (`boxOfRun`; null for a text node without a
// renderer): the items of the tree in document order, then the bidi levels of an RTL block or of content that needs visual
// reordering, then the widths such content deferred.
export function buildItems<Font>(p: WebKitPrepared, index: ContentIndex<Font>, boxOfRun: readonly (number | null)[], reordering: boolean): void {
  // Where each element's item sits among the source units: at the next text box after its event.
  const offsetAfter = new Array<number>(index.events.length)
  for (let ev = index.events.length - 1, next = index.text.length; ev >= 0; ev--) {
    const event = index.events[ev]!
    if (event.kind === 'text' && boxOfRun[event.run]! !== null) next = index.leaves[event.run]!.start
    offsetAfter[ev] = next
  }
  // collectInlineItems: the tree walk (IIB:320-370, 1053-1078).
  for (let ev = 0; ev < index.events.length; ev++) {
    const event = index.events[ev]!
    switch (event.kind) {
      case 'open': p.items.push({ kind: 'inline-box-start', element: event.element, level: DEFAULT_BIDI_LEVEL, sourceOffset: offsetAfter[ev]! }); break
      case 'close': p.items.push({ kind: 'inline-box-end', element: event.element, level: DEFAULT_BIDI_LEVEL, sourceOffset: offsetAfter[ev]! }); break
      case 'atomic': p.items.push({ kind: 'atomic', element: event.element, level: DEFAULT_BIDI_LEVEL, sourceOffset: offsetAfter[ev]! }); break
      case 'br': p.items.push({ kind: 'hard-line-break', element: event.element, level: DEFAULT_BIDI_LEVEL, sourceOffset: offsetAfter[ev]! }); break
      case 'wbr': p.items.push({ kind: 'word-break-opportunity', element: event.element, level: DEFAULT_BIDI_LEVEL, sourceOffset: offsetAfter[ev]! }); break
      case 'text': {
        const box = boxOfRun[event.run]!
        if (box !== null) handleTextContent(p, box, reordering)
        break
      }
    }
  }
  if (p.style.rtl || reordering) computeBidiLevels(p)
  if (reordering) computeItemWidths(p)
}

// moveToNextNonWhitespacePosition (IIB:54-73). " \t" stops before the TAB when splitting at word separators; "\t " doesn't.
export function whitespaceRun(text: string, start: number, preserveNewline: boolean, preserveTab: boolean, stopAtWordSeparatorBoundary: boolean): { length: number; isWordSeparator: boolean } | null {
  let hasWordSeparator = false
  let isWordSeparator = false
  let q = start
  while (q < text.length) {
    const c = text.charCodeAt(q)
    const treatedAsSpace = c === 0x20 || (c === 0x0a && !preserveNewline) || (c === 0x09 && !preserveTab)
    isWordSeparator = treatedAsSpace
    hasWordSeparator = hasWordSeparator || isWordSeparator
    if (!treatedAsSpace && c !== 0x09) break
    if (stopAtWordSeparatorBoundary && hasWordSeparator && !isWordSeparator) break
    q++
  }
  return q === start ? null : { length: q - start, isWordSeparator: hasWordSeparator }
}

// InlineItemsBuilder::handleTextContent (IIB:924-1051) with hyphens: manual and -webkit-nbsp-mode: normal, over the text
// box's own style. `defer` is shouldDeferTextMeasurement's content part: the paragraph needs visual reordering
// (IIB:1150-1154).
function handleTextContent(p: WebKitPrepared, boxIndex: number, defer: boolean): void {
  const box = p.boxes[boxIndex]!
  const style = box.style
  const text = box.text
  const preserveSpaces = preservesSpacesAndTabs(style)
  const preserveNewline = preservesNewline(style)
  const factory = makeFactory(text, box.is8Bit, box.locale, style.lineBreakMode, p.icuDefaultLocale, p.env.dictionaryBreaks)
  // canCacheWidthOnInlineTextItem (IIB:777-787): preserved white space in a box with a TAB depends on position.
  const deferWhitespace = defer || (preserveSpaces && text.includes('\t'))
  const spaceWidth = deferWhitespace ? null : Math.max(0, singleSpaceWidth(box))
  let position = 0
  while (position < text.length) {
    const c = text.charCodeAt(position)
    // U+2028 and U+2029 always force a break; LF does when newlines are preserved (:954-962).
    if (c === 0x2028 || c === 0x2029 || (c === 0x0a && preserveNewline)) {
      p.items.push({ kind: 'soft-line-break', box: boxIndex, start: position, level: DEFAULT_BIDI_LEVEL })
      position++
      continue
    }
    const ws = whitespaceRun(text, position, preserveNewline, preserveSpaces, preserveSpaces && style.wordSpacing !== 0)
    if (ws !== null) {
      if (style.collapse === 'break-spaces') {
        for (let k = 0; k < ws.length; k++) {
          p.items.push({ kind: 'text', box: boxIndex, start: position + k, end: position + k + 1, level: DEFAULT_BIDI_LEVEL, isWhitespace: true, isWordSeparator: ws.isWordSeparator, hasTrailingSoftHyphen: false, width: spaceWidth })
        }
      } else {
        const width = spaceWidth === null ? null : !preserveSpaces || ws.length === 1 ? spaceWidth : boxWidth(box, position, position + ws.length, 0, false)
        p.items.push({ kind: 'text', box: boxIndex, start: position, end: position + ws.length, level: DEFAULT_BIDI_LEVEL, isWhitespace: true, isWordSeparator: ws.isWordSeparator, hasTrailingSoftHyphen: false, width })
      }
      position += ws.length
      continue
    }
    const end = position + moveToNextBreakablePosition(position, factory, style)
    p.items.push({
      kind: 'text', box: boxIndex, start: position, end, level: DEFAULT_BIDI_LEVEL, isWhitespace: false, isWordSeparator: false,
      hasTrailingSoftHyphen: text.charCodeAt(end - 1) === 0xad, width: defer ? null : boxWidth(box, position, end, 0, true),
    })
    position = end
  }
}

// replaceNonPreservedNewLineAndTabCharactersAndAppend (IIB:383-415): LF and TAB become spaces, and U+2029 too in 16-bit
// content. CR, VT, FF, U+001C-U+001F and NEL stay literal.
export function bidiBoxContent(box: WebKitBox): string {
  let out = ''
  for (let i = 0; i < box.text.length; i++) {
    const c = box.text.charCodeAt(i)
    out += c === 0x0a || c === 0x09 || (!box.is8Bit && c === 0x2029) ? ' ' : box.text[i]!
  }
  return out
}

// InlineItemsBuilder::breakAndComputeBidiLevels (IIB:550-775) for a block with unicode-bidi: normal and spans without
// unicode-bidi: the paragraph text, ubidi_setPara, the item splits at logical run ends, and the opaque levels. Inline box
// starts and ends and word break opportunities have no position in the paragraph (:599-618); an atomic inline is U+FFFC
// (:596-598); a hard line break starts a paragraph with LF (handleBidiParagraphStart, :535-548, :568).
function computeBidiLevels(p: WebKitPrepared): void {
  const items = p.items
  let paragraph = ''
  const offsets: (number | null)[] = []
  let lastBox: number | null = null
  let boxOffset = 0
  const appendBoxContentOnce = (box: number) => {
    if (lastBox === box) return
    boxOffset = paragraph.length
    paragraph += bidiBoxContent(p.boxes[box]!)
    lastBox = box
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    switch (item.kind) {
      case 'soft-line-break': {
        const preserveNewline = preservesNewline(p.boxes[item.box]!.style)
        if (p.boxes[item.box]!.text.charCodeAt(item.start) !== 0x2028) {
          // handleBidiParagraphStart (:535-548): no controls to unwind, then LF.
          offsets.push(paragraph.length)
          paragraph += '\n'
        } else if (!preserveNewline) {
          appendBoxContentOnce(item.box)
          offsets.push(boxOffset + item.start)
        } else {
          // :593 appends the U+2028 itself.
          offsets.push(paragraph.length)
          paragraph += '\u2028'
        }
        break
      }
      case 'text':
        if (!preservesNewline(p.boxes[item.box]!.style)) {
          appendBoxContentOnce(item.box)
          offsets.push(boxOffset + item.start)
        } else {
          offsets.push(paragraph.length)
          paragraph += p.boxes[item.box]!.text.slice(item.start, item.end)
        }
        break
      case 'hard-line-break':
        offsets.push(paragraph.length)
        paragraph += '\n'
        lastBox = null
        break
      case 'atomic':
        offsets.push(paragraph.length)
        paragraph += '\ufffc'
        lastBox = null
        break
      case 'inline-box-start':
      case 'inline-box-end':
      case 'word-break-opportunity':
        offsets.push(null)
        break
    }
  }
  if (paragraph.length === 0) return
  const levels = resolveIcuBidi(paragraph, p.style.rtl ? 'rtl' : 'ltr', webkitBidiData).levels
  let itemIndex = 0
  let hasSeenOpaqueItem = false
  for (let position = 0; position < paragraph.length;) {
    // ubidi_getLogicalRun: the maximal run of equal levels from `position`.
    const level = levels[position]!
    let end = position + 1
    while (end < paragraph.length && levels[end] === level) end++
    for (; itemIndex < offsets.length; itemIndex++) {
      const offset = offsets[itemIndex]!
      const item = items[itemIndex]!
      if (offset === null) {
        hasSeenOpaqueItem = true
        item.level = level
        continue
      }
      if (offset >= end) break
      item.level = level
      if (item.kind !== 'text') continue
      if (offset + item.end - item.start > end) {
        // InlineTextItem::split (InlineTextItem.cpp:73-82): both sides keep hasTrailingSoftHyphen, and neither keeps a width.
        const leftLength = end - offset
        const right: WebKitTextItem = { ...item, start: item.start + leftLength, width: null }
        item.end = item.start + leftLength
        item.width = null
        items.splice(itemIndex + 1, 0, right)
        offsets.splice(itemIndex + 1, 0, end)
        itemIndex++
        break
      }
    }
    position = end
  }
  if (!hasSeenOpaqueItem) return
  // setBidiLevelForOpaqueInlineItems (:730-774).
  const hasContent: boolean[] = []
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!
    switch (item.kind) {
      case 'inline-box-start':
        if (hasContent.pop() === true) item.level = OPAQUE_BIDI_LEVEL
        break
      case 'inline-box-end':
        hasContent.push(false)
        item.level = OPAQUE_BIDI_LEVEL
        break
      case 'word-break-opportunity':
        item.level = OPAQUE_BIDI_LEVEL
        break
      case 'text':
        if (!item.isWhitespace || preservesSpacesAndTabs(p.boxes[item.box]!.style)) hasContent.fill(true)
        break
      case 'soft-line-break':
      case 'hard-line-break':
      case 'atomic':
        hasContent.fill(true)
        break
    }
  }
}

// computeInlineTextItemWidthsAndTextSpacing (IIB:804-856): after the splits, every non-empty item that isn't a lone ZWSP
// and whose width doesn't depend on position.
function computeItemWidths(p: WebKitPrepared): void {
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    if (item.kind !== 'text') continue
    const box = p.boxes[item.box]!
    const length = item.end - item.start
    if (length === 0 || (length === 1 && box.text.charCodeAt(item.start) === 0x200b)) continue
    if (item.isWhitespace && preservesSpacesAndTabs(box.style) && box.text.includes('\t')) continue
    item.width = itemWidth(p, item, item.start, item.end, 0)
  }
}
