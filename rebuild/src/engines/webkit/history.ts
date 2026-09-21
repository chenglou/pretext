// WebKit's page history (Safari 27.0): the break position cache, which can hand a box the item ends another paragraph of the
// process gave the same text. An inspected paragraph keeps each other item list the cache can hand one of its boxes as a
// history world, and a decided line is laid out again in the worlds that change what it read; where a world's line differs,
// the line reports page-history (gaps.ts). Nothing here decides a line, and a paragraph prepared plain has no worlds.
import type { Gap } from '../../model.js'
import { AL, FSI, L, LRE, LRI, LRO, ON, PDF, PDI, R, RLE, RLI, RLO, bidiClassOf } from '../../unicode/bidi.js'
import { resolveIcuBidi } from '../../unicode/ubidi.js'
import { webkitBidiData } from './data.js'
import { inspectOf, lineDiffersInHistoryWorld, lineGaps } from './gaps.js'
import type { WebKitLineGeometry, WebKitLineStart } from './geometry.js'
import { bidiBoxContent, whitespaceRun } from './items.js'
import { fillLine, lineHasVisuallyNonEmptyContent, sourceOffset } from './lines.js'
import { itemWidth } from './measure.js'
import { lineGeometry } from './output.js'
import { preservesNewline, preservesSpacesAndTabs } from './style.js'
import type { WebKitBox, WebKitFilledLine, WebKitHistoryWorld, WebKitInspect, WebKitItem, WebKitPrepared, WebKitRefusedSlot, WebKitTextItem } from './types.js'

// rule webkit/gap/page-history-worlds

// TextBreakingPositionCache (InlineItemsBuilder.cpp:858-924, 936-939, 1082-1148; TextBreakingPositionCache.h:41-42): when a
// block's line layout goes away (LineLayout::~LineLayout, LayoutIntegrationLineLayout.cpp:210-220), a box of at least 5 units
// whose item list has at least 3 items stores its items' ends, taken after the bidi splits, under (content,
// TextBreakingPositionContext, origin), unless the key is there already. A later box with the same key builds its items from
// those ends instead of the break iterator (buildInlineItemListForTextFromBreakingPositionsCache, IIB:858-924), and then takes
// its own bidi splits. The cache belongs to the process and is evicted at random past 500,000 units
// (TextBreakingPositionCache.cpp:36-60). The context holds white-space collapse (pre, pre-wrap and break-spaces share a value),
// overflow-wrap, line-break, word-break, nbsp mode and locale (TextBreakingPositionContext.h:30-80), so the cached ends are this
// box's break iterator ends plus what the key leaves out:
// - the other box's bidi splits, at the level boundaries its paragraph direction and neighbouring content give the same text;
// - its preserved white space: whole under pre and pre-wrap, per unit under break-spaces (IIB:972-979), split before a TAB
//   that follows a word separator under word spacing (IIB:964, moveToNextNonWhitespacePosition :54-73);
// - a white-space item built from the cache is a word separator unless its first character is a preserved TAB (IIB:893),
//   where the break iterator path asks whether the run holds any separator (IIB:66-72).
// What the library lays out is the paragraph in a process that never saw the box's key. Each other item list the cache can
// hand a box is a history world (WebKitHistoryWorld): the paragraph's items with that box built from the list. pageHistoryGaps
// lays every line out in each world that changes an item the line read, from the same line start, and reports page-history
// where the world's line differs: the effect of the cache on that line, computed instead of guessed.
// Declared approximations: one box differs per world (boxes find their keys independently, so the true set is the product);
// the other box's neighbours are the contexts below, not every text.

// TextBreakingPositionCache::minimumRequiredTextLengthForContentBreakCache and minimumRequiredContentBreaks
// (TextBreakingPositionCache.h:41-42).
const TEXT_BREAKING_POSITION_CACHE_MINIMUM_LENGTH = 5
const TEXT_BREAKING_POSITION_CACHE_MINIMUM_BREAKS = 3

// Context around the box for the bidi rules that read across its edges: nothing (sos, eos and L1 at the paragraph end), a
// strong L, R or AL, a European number alone, after L, after R or after AL (W2 makes it an Arabic number), and an Arabic
// number. With paragraph level parity these stand for every resolved class W1-W7, N0-N2 and L1 read across an edge (UAX #9;
// ICU 78.2 ubidi.cpp). Embeddings and isolates open around the box shift levels by parity, which the two directions cover;
// a box whose own PDI or PDF closes one opened before it, or whose initiator is closed after it, also takes the contexts
// that open or close one.
const HISTORY_BEFORE = ['', 'a', 'א', 'ا', '1', 'a1', 'א1', 'ا1', '١']
const HISTORY_AFTER = ['', 'a', 'א', '1', '١']
const HISTORY_BEFORE_OPENING = ['\u2066', '\u2067', '\u202a', '\u202b', '\u202d', '\u202e']
const HISTORY_AFTER_CLOSING = ['\u2069', '\u2069a', '\u2069א', '\u202c', '\u202ca', '\u202cא']
// ubidi_setPara gives a text without RTL characters, or with nothing else, the paragraph level everywhere
// (directionFromFlags, ICU 78.2 ubidi.cpp:1007-1018, :2684-2693), whatever embeddings and isolates it holds. The flags are the
// whole text's, so other content of another box's paragraph makes it mixed (held-out c-7cc5e3e26ff7c30d: `a` SHY LRI `b` PDI
// `c` takes level 2 on `b` once its paragraph holds an RTL character). A paragraph of its own before the context, ended by a
// class-B character, sets those flags and nothing else: B resets the explicit stack and sos.
const HISTORY_MIXED_PARAGRAPH = 'aא\n'

// The level boundaries of text[from, to) under a direction, as offsets less `shift`.
function levelBoundaries(text: string, direction: 'ltr' | 'rtl', from: number, to: number, shift: number): number[] {
  const levels = resolveIcuBidi(HISTORY_MIXED_PARAGRAPH + text, direction, webkitBidiData).levels
  const offset = HISTORY_MIXED_PARAGRAPH.length
  const out: number[] = []
  for (let i = from + 1; i < to; i++) if (levels[offset + i] !== levels[offset + i - 1]) out.push(i - shift)
  return out
}

// The sets of level boundaries other paragraphs give the box's text, each as sorted box offsets: per direction, every context
// before the box with every context after it.
function historyBoundarySets(box: WebKitBox): number[][] {
  const text = box.text
  // The text as the bidi paragraph holds it (computeBidiLevels): white space that doesn't preserve newlines as spaces, and
  // under preserved newlines U+2028 as a space and LF and U+2029 as paragraph separators.
  let analysis = ''
  if (preservesNewline(box.style)) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      analysis += c === 0x2028 ? ' ' : c === 0x2029 ? '\n' : text[i]!
    }
  } else {
    analysis = bidiBoxContent(box)
  }
  const length = analysis.length
  let firstStrong = -1
  let lastStrong = -1
  let closesOuter = false
  let opensInner = false
  // Bracket pairs resolve by the strong context before their opening bracket (N0): one that opens before the first strong
  // character takes the context before the box wherever it closes, and one that closes after the last strong character needs
  // its opening bracket to resolve at all. An explicit code's level reaches to its end. Such a box is resolved whole.
  const brackets: number[] = []
  for (let i = 0; i < length; i++) {
    const cp = analysis.codePointAt(i)!
    const c = bidiClassOf(webkitBidiData, cp)
    if (c === L || c === R || c === AL) {
      if (firstStrong < 0) firstStrong = i
      lastStrong = i
    }
    if (c === PDF || c === PDI) closesOuter = true
    if (c === LRE || c === RLE || c === LRO || c === RLO || c === LRI || c === RLI || c === FSI) opensInner = true
    if (c === ON) for (let k = 0; k < webkitBidiData.brackets.length; k += 3) if (webkitBidiData.brackets[k] === cp || webkitBidiData.brackets[k + 1] === cp) brackets.push(i)
    if (cp > 0xffff) i++
  }
  const explicit = closesOuter || opensInner
  let wholeBefore = explicit
  let wholeAfter = explicit
  for (let k = 0; k < brackets.length; k++) {
    if (brackets[k]! < firstStrong) wholeBefore = true
    if (brackets[k]! > lastStrong) wholeAfter = true
  }
  const before = closesOuter ? HISTORY_BEFORE.concat(HISTORY_BEFORE_OPENING) : HISTORY_BEFORE
  const after = opensInner ? HISTORY_AFTER.concat(HISTORY_AFTER_CLOSING) : HISTORY_AFTER
  const sets: number[][] = []
  const directions = ['ltr', 'rtl'] as const
  for (let d = 0; d < directions.length; d++) {
    const direction = directions[d]!
    if (firstStrong < 0 || (wholeBefore && wholeAfter)) {
      // No strong character, or a box resolved whole at both edges: every context pair over the whole text.
      for (let k = 0; k < before.length; k++) for (let j = 0; j < after.length; j++) {
        sets.push(levelBoundaries(before[k]! + analysis + after[j]!, direction, before[k]!.length, before[k]!.length + length, before[k]!.length))
      }
      continue
    }
    // Before the first strong character the rules read the context before the box; after the last one, the context after it.
    // Between them every rule finds its strong neighbours inside the box.
    const interior = levelBoundaries(analysis, direction, 0, length, 0)
    const leading: number[][] = []
    if (firstStrong === 0) leading.push(interior.filter(position => position <= lastStrong))
    else for (let k = 0; k < before.length; k++) {
      const context = before[k]!
      const found = wholeBefore
        ? levelBoundaries(context + analysis, direction, context.length, context.length + length, context.length).filter(position => position <= lastStrong)
        : levelBoundaries(context + analysis.slice(0, firstStrong + 1), direction, context.length, context.length + firstStrong + 1, context.length).concat(interior.filter(position => position > firstStrong && position <= lastStrong))
      leading.push(found)
    }
    const trailing: number[][] = []
    if (lastStrong === length - 1) trailing.push([])
    else for (let j = 0; j < after.length; j++) {
      const context = after[j]!
      const found = wholeAfter
        ? levelBoundaries(analysis + context, direction, 0, length, 0).filter(position => position > lastStrong)
        : levelBoundaries(analysis.slice(lastStrong) + context, direction, 0, length - lastStrong, -lastStrong)
      trailing.push(found)
    }
    for (let k = 0; k < leading.length; k++) for (let j = 0; j < trailing.length; j++) sets.push(leading[k]!.concat(trailing[j]!))
  }
  return sets
}

type WhitespaceStructure = 'whole' | 'per-unit' | 'separators'

// The ends of a preserved white-space run [start, end) under a structure (handleWhitespace, IIB:963-989).
function whitespaceEnds(text: string, start: number, end: number, structure: WhitespaceStructure, preserveNewline: boolean): number[] {
  const ends: number[] = []
  if (structure === 'per-unit') {
    for (let i = start + 1; i <= end; i++) ends.push(i)
    return ends
  }
  for (let position = start; position < end;) {
    const run = whitespaceRun(text.slice(0, end), position, preserveNewline, true, structure === 'separators')
    if (run === null) break
    position += run.length
    ends.push(position)
  }
  return ends
}

// The paragraph's items with one box built from a cached list: the box's own ends (white space under `structure`) plus
// `extra`, then its own bidi splits, which are the boundaries between its own items of different levels.
function historyWorld(p: WebKitPrepared, inspect: WebKitInspect, boxIndex: number, extra: readonly number[], structure: WhitespaceStructure | null): WebKitHistoryWorld | null {
  const box = p.boxes[boxIndex]!
  const text = box.text
  const preserve = preservesSpacesAndTabs(box.style)
  const items: WebKitItem[] = []
  const itemIndex: number[] = []
  const changed: boolean[] = []
  let differs = false
  let boxItems = 0
  const width = (item: WebKitTextItem, from: number, to: number): number | null => {
    if (item.width === null) return null
    return itemWidth(p, { ...item, start: from, end: to }, from, to, 0)
  }
  for (let i = 0; i < p.items.length; i++) {
    const item = p.items[i]!
    itemIndex.push(items.length)
    changed.push(false)
    if (item.kind !== 'text' || item.box !== boxIndex) {
      if (item.kind === 'soft-line-break' && item.box === boxIndex) boxItems++
      items.push(item)
      continue
    }
    if (item.isWhitespace && preserve && structure !== null) {
      // The run of this box's adjacent white-space items of one level: the cached structure, then the own bidi splits.
      // `ownRun` is the run's own items, from p.items[i] on, and `worldRun` the world's.
      const ownRun: WebKitTextItem[] = [item]
      let runEnd = item.end
      while (i + ownRun.length < p.items.length) {
        const following = p.items[i + ownRun.length]!
        if (following.kind !== 'text' || following.box !== boxIndex || !following.isWhitespace || following.level !== item.level || following.start !== runEnd) break
        ownRun.push(following)
        runEnd = following.end
      }
      const ends = whitespaceEnds(text, item.start, runEnd, structure, preservesNewline(box.style))
      for (let k = 0; k < extra.length; k++) if (extra[k]! > item.start && extra[k]! < runEnd && !ends.includes(extra[k]!)) ends.push(extra[k]!)
      ends.sort((a, b) => a - b)
      const first = items.length
      const worldRun: WebKitTextItem[] = []
      let from = item.start
      for (let k = 0; k < ends.length; k++) {
        const to = ends[k]!
        const isWordSeparator = text.charCodeAt(from) !== 0x09
        worldRun.push({ ...item, start: from, end: to, isWordSeparator, width: width(item, from, to) })
        from = to
      }
      let ownMatches = worldRun.length === ownRun.length
      for (let own = 0, k = 0; own < ownRun.length; own++) {
        const ownItem = ownRun[own]!
        while (k + 1 < worldRun.length && worldRun[k + 1]!.start <= ownItem.start) k++
        const worldItem = worldRun[k]!
        if (worldItem.start !== ownItem.start || worldItem.end !== ownItem.end || worldItem.isWordSeparator !== ownItem.isWordSeparator) ownMatches = false
        if (own > 0) {
          itemIndex.push(first + k)
          changed.push(false)
        }
      }
      for (let k = 0; k < worldRun.length; k++) items.push(worldRun[k]!)
      boxItems += worldRun.length
      if (!ownMatches) {
        differs = true
        for (let own = 0; own < ownRun.length; own++) changed[i + own] = true
      }
      i += ownRun.length - 1
      continue
    }
    const ends: number[] = []
    for (let k = 0; k < extra.length; k++) if (extra[k]! > item.start && extra[k]! < item.end) ends.push(extra[k]!)
    // A white-space item built from the cache is a word separator unless it starts with a preserved TAB (IIB:893).
    const isWordSeparator = item.isWhitespace ? text.charCodeAt(item.start) !== 0x09 || !preserve : item.isWordSeparator
    if (ends.length === 0 && isWordSeparator === item.isWordSeparator) {
      items.push(item)
      boxItems++
      continue
    }
    differs = true
    changed[i] = true
    ends.push(item.end)
    let from = item.start
    for (let k = 0; k < ends.length; k++) {
      const to = ends[k]!
      // buildInlineItemListForTextFromBreakingPositionsCache reads the soft hyphen at each end (IIB:908).
      items.push({ ...item, start: from, end: to, isWordSeparator, hasTrailingSoftHyphen: item.isWhitespace ? false : text.charCodeAt(to - 1) === 0xad, width: ends.length === 1 ? item.width : width(item, from, to) })
      boxItems++
      from = to
    }
  }
  if (!differs || boxItems < TEXT_BREAKING_POSITION_CACHE_MINIMUM_BREAKS) return null
  return { prepared: { ...p, items, inspect: { ...inspect, worlds: [] } }, box: boxIndex, itemIndex, changed }
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// The history worlds of an inspected paragraph, once its items stand: per box, one world for each distinct item list the
// cache can hand it.
export function collectHistoryWorlds(p: WebKitPrepared): void {
  const inspect = p.inspect
  if (inspect === null) return
  let itemCursor = 0
  for (let b = 0; b < p.boxes.length; b++) {
    const box = p.boxes[b]!
    if (box.text.length < TEXT_BREAKING_POSITION_CACHE_MINIMUM_LENGTH) continue
    // Whether one of the box's own items ends at a box offset.
    const isOwnEnd = new Array<boolean>(box.text.length + 1).fill(false)
    let hasLongWhitespace = false
    let previousWhitespaceEnd = -1
    // Text leaves and their bidi splits stay contiguous in logical item order.
    while (itemCursor < p.items.length) {
      const item = p.items[itemCursor]!
      if ((item.kind === 'text' || item.kind === 'soft-line-break') && item.box >= b) break
      itemCursor++
    }
    let changesSeparator = false
    for (; itemCursor < p.items.length; itemCursor++) {
      const item = p.items[itemCursor]!
      if ((item.kind !== 'text' && item.kind !== 'soft-line-break') || item.box !== b) break
      isOwnEnd[item.kind === 'text' ? item.end : item.start + 1] = true
      if (item.kind !== 'text' || !item.isWhitespace) continue
      changesSeparator ||= item.isWordSeparator !== (box.text.charCodeAt(item.start) !== 0x09 || !preservesSpacesAndTabs(box.style))
      hasLongWhitespace ||= item.end - item.start > 1 || previousWhitespaceEnd === item.start
      previousWhitespaceEnd = item.end
    }
    // The distinct sets of ends other paragraphs add to the box's own, the empty one first.
    const extras: number[][] = [[]]
    const sets = historyBoundarySets(box)
    for (let k = 0; k < sets.length; k++) {
      const extra = sets[k]!.filter(position => position > 0 && position < box.text.length && !isOwnEnd[position]!).sort((x, y) => x - y)
      if (!extras.some(known => sameNumbers(known, extra))) extras.push(extra)
    }
    // Preserved white space of two units or more takes the three structures; a world that equals the own items is dropped.
    const structures: Array<WhitespaceStructure | null> = preservesSpacesAndTabs(box.style) && hasLongWhitespace ? ['whole', 'per-unit', 'separators'] : [null]
    // The box's item list in each world kept so far, as start, end and word separator flag per item.
    const kept: number[][] = []
    for (let k = 0; k < extras.length; k++) for (let j = 0; j < structures.length; j++) {
      // This candidate has exactly the own boundaries and separator flags.
      if (extras[k]!.length === 0 && structures[j] === null && !changesSeparator) continue
      const world = historyWorld(p, inspect, b, extras[k]!, structures[j]!)
      if (world === null) continue
      const boxItems: number[] = []
      for (let i = 0; i < world.prepared.items.length; i++) {
        const item = world.prepared.items[i]!
        if (item.kind === 'text' && item.box === b) boxItems.push(item.start, item.end, item.isWordSeparator ? 1 : 0)
      }
      if (kept.some(known => sameNumbers(known, boxItems))) continue
      kept.push(boxItems)
      inspect.worlds.push(world)
    }
  }
}

// ---- A decided line in the history worlds ----
// rule webkit/gap/page-history-worlds

// What the comparison below reads of a decided line: its range, its line box and its display boxes; or that the slot was
// refused.
type ComparedLine = { kind: 'line'; start: number; end: number; hasLineBox: boolean; geometry: WebKitLineGeometry } | { kind: 'below-floats' }

function comparedLine(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot): ComparedLine {
  switch (decided.kind) {
    case 'line': return { kind: 'line', start: decided.start, end: decided.end, hasLineBox: lineHasVisuallyNonEmptyContent(p, decided.line), geometry: lineGeometry(p, decided) }
    case 'below-floats': return { kind: 'below-floats' }
  }
}

// Where a line of the paragraph and the same line in a history world differ, as a source range, or null where they agree in
// everything the observation port reads: the line's range, its line box and its display boxes.
function lineDifference(p: WebKitPrepared, a: ComparedLine, b: ComparedLine): { start: number; end: number } | null {
  if (a.kind !== 'line' || b.kind !== 'line') return a.kind === b.kind ? null : a.kind === 'line' ? { start: a.start, end: a.end } : { start: 0, end: 0 }
  let start = Infinity
  let end = -Infinity
  const mark = (from: number, to: number): void => {
    start = Math.min(start, from)
    end = Math.max(end, to)
  }
  // Another break: the text between the two breaks. What else differs on the line follows from the break.
  if (a.end !== b.end) return { start: Math.min(a.end, b.end), end: Math.max(a.end, b.end) }
  const ga = a.geometry
  const gb = b.geometry
  for (let k = 0; k < ga.boxes.length && k < gb.boxes.length; k++) {
    const x = ga.boxes[k]!
    const y = gb.boxes[k]!
    let same = x.kind === y.kind && x.x === y.x && x.width === y.width
    if (same && (x.kind === 'text' || x.kind === 'soft-line-break') && (y.kind === 'text' || y.kind === 'soft-line-break')) {
      same = x.run === y.run && x.start === y.start && x.end === y.end && x.level === y.level && x.hyphen === y.hyphen && x.expansion === y.expansion
    }
    if (same) continue
    if (x.kind === 'text' || x.kind === 'soft-line-break') mark(p.runStarts[x.run]! + x.start, p.runStarts[x.run]! + x.end)
    else mark(a.start, a.end)
  }
  // The line's own sums alone: no box says where.
  if (start === Infinity && (a.hasLineBox !== b.hasLineBox || ga.contentWidth !== gb.contentWidth || ga.hangingWidth !== gb.hangingWidth || ga.contentLogicalRight !== gb.contentLogicalRight || ga.alignmentOffset !== gb.alignmentOffset || ga.boxes.length !== gb.boxes.length)) mark(a.start, a.end)
  return start === Infinity ? null : { start, end }
}

// The line start in a history world that stands where `start` stands, or null where the world can't be at that start: the
// line begins inside an item with a width carried from the lines before it (overflowWidthAsLeadingForNextLine, ALB:54-98;
// InlineTextItem::right, InlineTextItem.cpp:65-71), and the world's item there isn't the own one, so its rest started from
// another whole (triage c-66ae4ab7d56cb0ae: line 6 keeps `ببب` at 16.27px, the rest of `بببب` alone, where the rest of
// `((بببب` is 26.02px); or the world has no item boundary at a line start between two of the own items.
function worldLineStart(p: WebKitPrepared, world: WebKitHistoryWorld, start: WebKitLineStart): WebKitLineStart | null {
  if (start.itemIndex >= p.items.length) return { ...start, itemIndex: world.prepared.items.length }
  const own = p.items[start.itemIndex]!
  let index = world.itemIndex[start.itemIndex]!
  if (own.kind !== 'text') return { ...start, itemIndex: index }
  const position = own.start + start.offset
  const items = world.prepared.items
  // A world maps a text item to the text item that holds its start (historyWorld), which a list of indices doesn't say.
  let first = items[index] as WebKitTextItem
  if (first.start > own.start) return null
  while (first.end <= position) {
    const following = items[index + 1]
    if (following === undefined || following.kind !== 'text' || following.box !== own.box || following.start !== first.end) return null
    first = following
    index++
  }
  if (start.offset === 0) return first.start === position ? { ...start, itemIndex: index } : null
  // A carried width is the whole item's less what the lines before took, so it stands in the world only where the world's
  // item is the own one (suite c-19ccdb6bbbc8089c: `ببب((` broken after its first letter carries 32.4px for `بب((`, where a
  // world that ends an item before `((` carries 10.416px for `بب`, which fits with nothing after it).
  if (start.previousLine !== null && start.previousLine.carriedWidth !== null) return first.start === own.start && first.end === own.end ? { ...start, itemIndex: index } : null
  if (first.start === own.start) return { ...start, itemIndex: index }
  return { ...start, itemIndex: index, offset: position - first.start }
}

// Each world that changes an item the line read lays the line (InlineFormattingContext::lineLayout) out from the same start
// in the same slot, with the functions that fill and inspect the paragraph's own line, and `gaps`, the line's own
// (gaps.ts lineGaps), gets page-history where the world's line differs. It throws on a paragraph prepared plain.
export function pageHistoryGaps(p: WebKitPrepared, decided: WebKitFilledLine | WebKitRefusedSlot, gaps: Gap[]): void {
  const inspect = inspectOf(p, 'inspectLine')
  const start = decided.from
  const readEnd = Math.min(Math.max(decided.measuredEnd, start.itemIndex + 1), p.items.length)
  let ownLine: ComparedLine | null = null
  for (let w = 0; w < inspect.worlds.length; w++) {
    const world = inspect.worlds[w]!
    let reads = false
    for (let i = start.itemIndex; i < readEnd && !reads; i++) reads = world.changed[i]!
    if (!reads) continue
    const worldStart = worldLineStart(p, world, start)
    let at: { start: number; end: number } | null
    if (worldStart === null) {
      const from = start.itemIndex === 0 && start.offset === 0 ? 0 : sourceOffset(p, { index: start.itemIndex, offset: start.offset })
      const own = p.items[start.itemIndex]!
      at = { start: from, end: own.kind === 'text' ? p.boxes[own.box]!.sourceStart + own.end : from }
    } else {
      const inWorld = fillLine(world.prepared, worldStart, decided.slot).line
      // The world's line gets the gap work of the paragraph's own, with the Canvas questions that takes, though the comparison
      // reads none of it. A world shares its paragraph's box facts.
      lineGaps(world.prepared, inWorld)
      ownLine ??= comparedLine(p, decided)
      at = lineDifference(p, ownLine, comparedLine(world.prepared, inWorld))
    }
    if (at !== null) lineDiffersInHistoryWorld(gaps, p.boxes[world.box]!.run, at)
  }
}
