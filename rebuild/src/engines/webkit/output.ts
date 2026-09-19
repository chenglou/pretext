// WebKit line output (Safari 27.0): what is read from a decided line (lines.ts) and never decides one. The pieces a painter
// takes, with the fragments in logical order; and the line's geometry, with the alignment offset and the display boxes
// (InlineDisplayContentBuilder) from the closed Line::Run list. Pure functions of the prepared paragraph and the line; none
// asks Canvas. Cited as in lines.ts.
import type { Fragment, LinePieces, TextAlign } from '../../model.js'
import type { WebKitDisplayBox, WebKitLineGeometry, WebKitTextBox } from './geometry.js'
import { lastRunLogicalRight, lineHasVisuallyNonEmptyContent, spanEdges, textIndent } from './lines.js'
import { collapsesWhiteSpace, layoutUnit } from './style.js'
import { DEFAULT_BIDI_LEVEL, OPAQUE_BIDI_LEVEL, type Line, type LineRun, type WebKitBox, type WebKitFilledLine, type WebKitPrepared, type WebKitStyle } from './types.js'

const f32 = Math.fround

// What WebKit's painting rules read beside the pieces: the width the breaker carried into the line's first text, which
// the painted line measures again, and whether the line holds an RTL run WebKit shaped across inline boxes.
export type WebKitPaintFacts = { carriedWidth: number | null; shapedAcrossBoxes: boolean }

// What a painter takes of the line (model.ts LinePieces).
export function linePieces(p: WebKitPrepared, filled: WebKitFilledLine): LinePieces<WebKitPaintFacts> {
  const { from, line } = filled
  let shapedAcrossBoxes = false
  for (let i = 0; i < line.runs.length; i++) {
    const run = line.runs[i]!
    if (run.kind === 'text' && run.shapingBoundary !== null) shapedAcrossBoxes = true
  }
  const hangingWidth = line.hanging === null ? 0 : line.hanging.width
  return {
    fragments: lineFragments(p, line, filled.start, filled.end),
    joinsNextLine: false,
    indented: from.isFirstFormattedLine && filled.builder === 'line-builder',
    align: usedAlignment(p.style.textAlign, filled.isLastLineOrLineEndsWithForcedLineBreak),
    overflows: line.contentLogicalWidth - hangingWidth - filled.rect.width > 0,
    facts: { carriedWidth: from.offset > 0 && from.previousLine !== null ? from.previousLine.carriedWidth : null, shapedAcrossBoxes },
  }
}

// The line's geometry: its rect and sums, the alignment offset, and the display boxes.
export function lineGeometry(p: WebKitPrepared, filled: WebKitFilledLine): WebKitLineGeometry {
  const { line, rect } = filled
  const hangingWidth = line.hanging === null ? 0 : line.hanging.width
  const contentLogicalRight = lastRunLogicalRight(line)
  const alignmentOffset = line.runs.length > 0 ? horizontalAlignmentOffset(p.style, contentLogicalRight, rect.width, hangingWidth, filled.isLastLineOrLineEndsWithForcedLineBreak) : 0
  // The display line's left edge (IDLB:124-129): the line rect's left, mirrored across the container in an RTL block.
  const containerWidth = f32(layoutUnit(f32(f32(filled.slot.width) * f32(p.zoom))))
  const lineLeft = p.style.rtl ? f32(containerWidth - f32(rect.left + rect.width)) : rect.left
  return {
    lineLeft: p.style.rtl ? f32(containerWidth - f32(rect.left + rect.width)) : f32(rect.left - textIndent(p, filled.from)),
    contentEdgeOffset: rect.contentEdgeOffset,
    lineBoxWidth: rect.width,
    contentWidth: line.contentLogicalWidth,
    hangingWidth,
    contentLogicalRight,
    alignmentOffset,
    boxes: displayBoxes(p, filled, lineLeft, alignmentOffset, lineHasVisuallyNonEmptyContent(p, line)),
  }
}

// ---- The alignment offset ----

// The used alignment of a line (horizontalAlignmentOffset's computedHorizontalAlignment, IFU:221-247), as the model reports it.
function usedAlignment(textAlign: TextAlign, isLastLineOrLineEndsWithForcedLineBreak: boolean): TextAlign {
  if (isLastLineOrLineEndsWithForcedLineBreak && textAlign === 'justify') return 'start'
  return textAlign
}

// InlineFormattingUtils::horizontalAlignmentOffset (IFU:198-276) with text-align-last: auto.
function horizontalAlignmentOffset(s: WebKitStyle, contentLogicalRightIn: number, lineLogicalWidth: number, hangingTrailingWidth: number, isLastLineOrLineEndsWithForcedLineBreak: boolean): number {
  let contentLogicalRight = contentLogicalRightIn
  if (hangingTrailingWidth) {
    if (isLastLineOrLineEndsWithForcedLineBreak) contentLogicalRight = Math.min(contentLogicalRight, lineLogicalWidth)
    else contentLogicalRight = f32(contentLogicalRight - hangingTrailingWidth)
  }
  const horizontalAvailableSpace = f32(lineLogicalWidth - contentLogicalRight)
  if (horizontalAvailableSpace <= 0) return 0
  const ltr = !s.rtl
  switch (usedAlignment(s.textAlign, isLastLineOrLineEndsWithForcedLineBreak)) {
    case 'left': return ltr ? 0 : horizontalAvailableSpace
    case 'start': return 0
    case 'right': return ltr ? horizontalAvailableSpace : 0
    case 'end': return horizontalAvailableSpace
    case 'center': return f32(horizontalAvailableSpace / 2)
    case 'justify': return 0
  }
}

// ---- Display boxes and fragments from the closed Line::Run list ----

// The text leaf a source offset is in: the last one that starts at or before it.
function runAt(p: WebKitPrepared, offset: number): number {
  let low = 0
  let high = p.runStarts.length - 2
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (p.runStarts[middle]! <= offset) low = middle
    else high = middle - 1
  }
  return low
}

// ubidi_reorderVisual (ICU 78.2 ubidiln.cpp:709-744, 812-867): L2 over one level per run; indexMap[visual] = logical.
function reorderVisual(levels: number[]): number[] {
  const indexMap: number[] = []
  let minLevel = 126
  let maxLevel = 0
  for (let i = 0; i < levels.length; i++) {
    indexMap.push(i)
    minLevel = Math.min(minLevel, levels[i]!)
    maxLevel = Math.max(maxLevel, levels[i]!)
  }
  if (minLevel === maxLevel && (minLevel & 1) === 0) return indexMap
  minLevel |= 1
  for (; maxLevel >= minLevel; maxLevel--) {
    let start = 0
    for (;;) {
      while (start < levels.length && levels[start]! < maxLevel) start++
      if (start >= levels.length) break
      let limit = start + 1
      while (limit < levels.length && levels[limit]! >= maxLevel) limit++
      for (let a = start, z = limit - 1; a < z; a++, z--) {
        const t = indexMap[a]!
        indexMap[a] = indexMap[z]!
        indexMap[z] = t
      }
      if (limit === levels.length) break
      start = limit + 1
    }
  }
  return indexMap
}

// computedVisualOrder (ILB:93-138): opaque runs are left out and the others reordered by level.
function visualOrder(runs: LineRun[]): number[] {
  const levels: number[] = []
  const offsets: number[] = []
  let accumulated = 0
  for (let i = 0; i < runs.length; i++) {
    const level = runs[i]!.level
    if (level === OPAQUE_BIDI_LEVEL) {
      accumulated++
      continue
    }
    if (level > 126) continue
    levels.push(level)
    offsets.push(accumulated)
  }
  const order = reorderVisual(levels)
  for (let i = 0; i < order.length; i++) order[i] = order[i]! + offsets[order[i]!]!
  return order
}

// A soft line break's box holds its one unit and nothing a text run gets from its content: a line that ends with one isn't
// justified (lines.ts applyRunBasedAlignmentIfApplicable).
function textDisplayBox(p: WebKitPrepared, run: Extract<LineRun, { kind: 'text' | 'soft-line-break' }>, x: number): WebKitTextBox {
  const box = p.boxes[run.box]!
  switch (run.kind) {
    case 'text':
      return {
        kind: 'text', run: box.run, start: run.textStart, end: run.textStart + run.textLength, level: run.level, isWordSeparator: run.isWordSeparator, x, width: run.width,
        hyphen: run.needsHyphen ? box.hyphen : null, expansion: run.expansion, expansionBehavior: { left: run.expansionBehavior.left, right: run.expansionBehavior.right },
        shapedAcrossBoxes: run.shapingBoundary !== null, canvasFamily: box.canvasFamily,
      }
    case 'soft-line-break':
      return {
        kind: 'soft-line-break', run: box.run, start: run.textStart, end: run.textStart + 1, level: run.level, isWordSeparator: false, x, width: 0,
        hyphen: null, expansion: 0, expansionBehavior: { left: 'allow', right: 'allow' }, shapedAcrossBoxes: false, canvasFamily: box.canvasFamily,
      }
  }
}

// InlineDisplayContentBuilder::build (IDCB:100-117) for a line with content. x is from the content box: m_displayLine's left
// (the line rect's left after floats and text-indent, mirrored in an RTL block, IDLB:124-129) plus the root inline box's
// left, the alignment offset (LBB:63).
// - Without bidi reordering (processNonBidiContent :504-645): a text box at root left + run left
//   (LineBox::logicalRectForTextRun, InlineLineBox.cpp:58-73); an inline box's border box from root left + run left +
//   max(0, margin start), as wide as the root inline box's right minus its left unless its end run is on the line, then to
//   the end run's right less the end margin (LBB:482-521); an atomic box at root left + run left + max(0, margin start), its
//   border box wide (LBB:474-481); a <br> at root left + run left, zero wide (LBB:465-473).
// - With reordering (processBidiContent :851-1088): boxes follow in visual order from the content's left edge, each at the
//   edge plus its word spacing margin, the edge advancing by f32(width + margin). An RTL line's edge is
//   f32(line box width - contentLogicalRightIncludingNegativeMargin) (IDLB:136-138): the alignment offset plus
//   Line::contentLogicalRight(), the last run's logical right (InlineLine.h:71). Spans, atomic inlines and <br> on such a
//   line take the display box tree walk of :1031-1070, which isn't ported.
function displayBoxes(p: WebKitPrepared, filled: WebKitFilledLine, lineLeft: number, alignmentOffset: number, hasContentfulInFlowContent: boolean): WebKitDisplayBox[] {
  if (!filled.line.hasNonDefaultBidiLevelRun) return nonBidiDisplayBoxes(p, filled, lineLeft, alignmentOffset, hasContentfulInFlowContent)
  if (hasContentfulInFlowContent) return bidiDisplayBoxes(p, filled, lineLeft, alignmentOffset)
  // A reordered line without contentful in-flow content (bidiDisplayBoxes' first rule).
  const out = nonBidiDisplayBoxes(p, filled, lineLeft, alignmentOffset, hasContentfulInFlowContent)
  if (p.style.rtl) for (let i = 0; i < out.length; i++) if (out[i]!.kind === 'inline-box') out[i]!.x = f32(lineLeft + filled.rect.width)
  return out
}

function nonBidiDisplayBoxes(p: WebKitPrepared, filled: WebKitFilledLine, lineLeft: number, alignmentOffset: number, hasContentfulInFlowContent: boolean): WebKitDisplayBox[] {
  const line = filled.line
  const runs = line.runs
  const out: WebKitDisplayBox[] = []
  const hanging = line.hanging === null ? 0 : line.hanging.width
  // The root inline box: left at the alignment offset, width the content width less hanging content in LTR (LBB:51-63),
  // which the initial width of an inline box adds back (LBB:488-495).
  const contentLogicalWidth = p.style.rtl ? line.contentLogicalWidth : f32(line.contentLogicalWidth - hanging)
  const rootRight = f32(alignmentOffset + contentLogicalWidth)
  // The display boxes of the inline boxes open at a run, innermost last, as indices into `out`; null where a box got none.
  const open: (number | null)[] = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    switch (run.kind) {
      case 'text':
      case 'soft-line-break':
        out.push(textDisplayBox(p, run, f32(lineLeft + f32(alignmentOffset + run.left))))
        break
      case 'hard-line-break':
        out.push({ kind: 'line-break', element: run.element, x: f32(lineLeft + f32(alignmentOffset + run.left)), width: 0 })
        break
      case 'atomic': {
        const e = p.elements[run.element]!
        if (e.kind !== 'atomic') throw new Error(`element ${run.element} isn't atomic`)
        const left = f32(f32(alignmentOffset + run.left) + Math.max(0, e.marginStart))
        out.push({ kind: 'atomic', element: run.element, level: run.level === DEFAULT_BIDI_LEVEL || run.level === OPAQUE_BIDI_LEVEL ? (p.style.rtl ? 1 : 0) : run.level, x: f32(lineLeft + left), width: e.borderBoxWidth })
        break
      }
      case 'inline-box-start':
      case 'spanning-inline-box-start': {
        // Line-spanning boxes on a line whose content floats pushed away get no display box (IDCB:603-609).
        if (run.kind === 'spanning-inline-box-start' && !hasContentfulInFlowContent && filled.rect.constrainedByFloat) {
          open.push(null)
          break
        }
        const marginStart = run.kind === 'inline-box-start' ? spanEdges(p, run.element).marginStart : 0
        // Inline box runs are margin boxes: the border box starts past a positive margin, while a negative margin start
        // already moved the run left (IL:300-305) and stays in the box (LBB:482-487).
        const left = f32(f32(alignmentOffset + run.left) + Math.max(0, marginStart))
        let width = Math.max(0, f32(rootRight - left))
        if (!p.style.rtl) width = Math.max(0, f32(f32(rootRight + hanging) - left))
        open.push(out.length)
        out.push({ kind: 'inline-box', element: run.element, x: f32(lineLeft + left), width, hasStartEdge: run.kind === 'inline-box-start', hasEndEdge: false })
        break
      }
      case 'inline-box-end': {
        // Every inline box that ends on the line starts on it, as itself or as a line-spanning start (lines.ts newLine).
        const index = open.pop()!
        if (index === null) break
        const boxOut = out[index]! as Extract<WebKitDisplayBox, { kind: 'inline-box' }>
        const marginEnd = spanEdges(p, run.element).marginEnd
        const right = f32(f32(alignmentOffset + run.left) + f32(run.width - marginEnd))
        boxOut.width = Math.max(0, f32(right - f32(boxOut.x - lineLeft)))
        boxOut.hasEndEdge = true
        break
      }
      case 'word-break-opportunity':
        break
    }
  }
  return out
}

// InlineDisplayContentBuilder::processBidiContent (IDCB:851-1088) for a line that needs visual reordering.
// - A line without contentful in-flow content takes processNonBidiContent, and in an RTL block its inline boxes sit at the
//   line box's right edge (processBidiLinesWithNoContent, :826-849).
// - createDisplayBoxesInVisualOrder (:871-1028): runs in visual order, wbr and inline box ends skipped. Every run's container
//   gets a display box when first reached (ensureDisplayBoxForContainer, :713-721); an inline box start whose box has no
//   content on the line gets one at its own position (:971-998). Text runs sit at the running edge plus their word spacing
//   margin, the edge advancing by f32(width + margin); a line break at the edge; an atomic inline past its line-left margin,
//   the edge advancing by its margin box.
// - handleInlineBoxes (:1031-1070): with inline boxes, adjustVisualGeometryForDisplayBox walks the display box tree from the
//   same edge again and places everything, adding an inline box's line-left margin, border and padding on its first box in
//   LTR (last in RTL) and its line-right ones on its last box in LTR (first in RTL) (:728-824).
// - closeInlineBoxes (:1073-1087): trailing inline box starts at the opaque level get a zero-width box at the line's right.
// The model's spans inherit the block's direction.
function bidiDisplayBoxes(p: WebKitPrepared, filled: WebKitFilledLine, lineLeft: number, alignmentOffset: number): WebKitDisplayBox[] {
  const line = filled.line
  const runs = line.runs
  const rtlBlock = p.style.rtl
  const lineWidth = filled.rect.width
  const contentLineLeftEdge = rtlBlock ? f32(lineWidth - f32(alignmentOffset + lastRunLogicalRight(line))) : alignmentOffset
  // Which spans have content on this line (InlineLineBoxBuilder.cpp:448-472: text, soft and hard line breaks set their parent
  // inline box's content), and which have their first and last box here.
  const hasContentOnLine = new Set<number>()
  const firstBox = new Set<number>()
  const lastBox = new Set<number>()
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    if (run.kind === 'text' || run.kind === 'soft-line-break') hasContentOnLine.add(p.boxes[run.box]!.parent)
    else if (run.kind === 'hard-line-break') hasContentOnLine.add(p.elements[run.element]!.parent)
    else if (run.kind === 'inline-box-start') firstBox.add(run.element)
    else if (run.kind === 'inline-box-end') lastBox.add(run.element)
  }
  // The display box tree: an inline box's node holds its children, and a leaf the word spacing before its box. The boxes are
  // the ones in `out`.
  type InlineBox = Extract<WebKitDisplayBox, { kind: 'inline-box' }>
  type Node = { kind: 'inline-box'; box: InlineBox; children: Node[] } | { kind: 'leaf'; box: Exclude<WebKitDisplayBox, InlineBox>; margin: number }
  const out: WebKitDisplayBox[] = []
  const rootChildren: Node[] = []
  // The ancestor stack: the containers from the root (the block, -1) inward, each with its node's children.
  const stack: { element: number; children: Node[] }[] = [{ element: -1, children: rootChildren }]
  const addContainer = (parent: Node[], element: number): Node[] => {
    const box: InlineBox = { kind: 'inline-box', element, x: 0, width: 0, hasStartEdge: firstBox.has(element), hasEndEdge: lastBox.has(element) }
    const children: Node[] = []
    out.push(box)
    parent.push({ kind: 'inline-box', box, children })
    stack.push({ element, children })
    return children
  }
  const ensureContainer = (element: number): Node[] => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k]!.element !== element) continue
      stack.length = k + 1
      return stack[k]!.children
    }
    return addContainer(ensureContainer(p.elements[element]!.parent), element)
  }
  const addLeaf = (parent: Node[], box: Exclude<WebKitDisplayBox, InlineBox>, margin: number) => {
    out.push(box)
    parent.push({ kind: 'leaf', box, margin })
  }
  let edge = contentLineLeftEdge
  let hasInlineBox = false
  const order = visualOrder(runs)
  for (let k = 0; k < order.length; k++) {
    const run = runs[order[k]!]!
    if (run.kind === 'word-break-opportunity' || run.kind === 'inline-box-end') continue
    const parent = ensureContainer(run.kind === 'text' || run.kind === 'soft-line-break' ? p.boxes[run.box]!.parent : p.elements[run.element]!.parent)
    hasInlineBox ||= parent !== rootChildren || run.kind === 'inline-box-start' || run.kind === 'spanning-inline-box-start'
    switch (run.kind) {
      case 'text': {
        const margin = run.isWordSeparator ? p.boxes[run.box]!.wordSpacing : 0
        addLeaf(parent, textDisplayBox(p, run, f32(lineLeft + f32(edge + margin))), margin)
        edge = f32(edge + f32(run.width + margin))
        break
      }
      case 'soft-line-break':
        addLeaf(parent, textDisplayBox(p, run, f32(lineLeft + edge)), 0)
        break
      case 'hard-line-break':
        addLeaf(parent, { kind: 'line-break', element: run.element, x: f32(lineLeft + edge), width: 0 }, 0)
        break
      case 'atomic': {
        const e = p.elements[run.element]!
        if (e.kind !== 'atomic') throw new Error(`element ${run.element} isn't atomic`)
        const marginLeft = rtlBlock ? e.marginEnd : e.marginStart
        const marginRight = rtlBlock ? e.marginStart : e.marginEnd
        addLeaf(parent, { kind: 'atomic', element: run.element, level: run.level, x: f32(lineLeft + f32(edge + marginLeft)), width: e.borderBoxWidth }, 0)
        edge = f32(f32(f32(edge + marginLeft) + e.borderBoxWidth) + marginRight)
        break
      }
      case 'inline-box-start':
      case 'spanning-inline-box-start':
        if (!hasContentOnLine.has(run.element)) addContainer(parent, run.element)
        break
    }
  }
  if (hasInlineBox) {
    // rule webkit/output/first-and-last-display-box
    // computeIsFirstIsLastBox (:1036-1060): a span whose content isn't contiguous in visual order has several display boxes
    // on the line, and of those only the first in box order is its first box and only the last its last box (rule/box-edges
    // c-20592b0063422319: the hanging space of a span at the line's left and its word at the right, in an RTL block; the
    // start border and padding go on the left box alone).
    const seen = new Set<number>()
    for (let i = 0; i < out.length; i++) {
      const box = out[i]!
      if (box.kind !== 'inline-box') continue
      if (seen.has(box.element)) box.hasStartEdge = false
      seen.add(box.element)
    }
    seen.clear()
    for (let i = out.length - 1; i >= 0; i--) {
      const box = out[i]!
      if (box.kind !== 'inline-box') continue
      if (seen.has(box.element)) box.hasEndEdge = false
      seen.add(box.element)
    }
    // adjustVisualGeometryForDisplayBox (:728-824).
    let right = contentLineLeftEdge
    const adjust = (node: Node) => {
      if (node.kind === 'leaf') {
        const box = node.box
        if (box.kind === 'atomic') {
          const e = p.elements[box.element]!
          if (e.kind !== 'atomic') throw new Error(`element ${box.element} isn't atomic`)
          const marginLeft = rtlBlock ? e.marginEnd : e.marginStart
          box.x = f32(f32(lineLeft + right) + marginLeft)
          right = f32(right + e.marginBoxWidth)
          return
        }
        box.x = f32(lineLeft + f32(right + node.margin))
        right = f32(right + f32(box.width + node.margin))
        return
      }
      const box = node.box
      const e = spanEdges(p, box.element)
      const ltr = !rtlBlock
      const isFirst = box.hasStartEdge
      const isLast = box.hasEndEdge
      const marginLeft = ltr ? e.marginStart : e.marginEnd
      const borderPaddingLeft = ltr ? f32(e.borderStart + e.paddingStart) : f32(e.borderEnd + e.paddingEnd)
      const marginRight = ltr ? e.marginEnd : e.marginStart
      const borderPaddingRight = ltr ? f32(e.borderEnd + e.paddingEnd) : f32(e.borderStart + e.paddingStart)
      const applyLeft = (ltr && isFirst) || (!ltr && isLast)
      if (applyLeft) right = f32(right + marginLeft)
      const left = right
      if (applyLeft) right = f32(right + borderPaddingLeft)
      for (let c = 0; c < node.children.length; c++) adjust(node.children[c]!)
      const applyRight = (ltr && isLast) || (!ltr && isFirst)
      if (applyRight) right = f32(right + borderPaddingRight)
      box.x = f32(lineLeft + left)
      box.width = f32(right - left)
      if (applyRight) right = f32(right + marginRight)
    }
    for (let c = 0; c < rootChildren.length; c++) adjust(rootChildren[c]!)
  }
  // closeInlineBoxes (:1073-1087).
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!
    if (run.kind !== 'inline-box-start' || run.level !== OPAQUE_BIDI_LEVEL) break
    if (out.some(b => b.kind === 'inline-box' && b.element === run.element)) continue
    out.push({ kind: 'inline-box', element: run.element, x: f32(lineLeft + lineWidth), width: 0, hasStartEdge: firstBox.has(run.element), hasEndEdge: lastBox.has(run.element) })
  }
  return out
}

// The line's fragments in logical order, from the closed run list. Units inside a text run are laid out: `hanging` for
// HangingContent's trailing white space, else `text`. A soft line break run is the `forced-break`. The unit trimming took
// out of its run is `trimmed`. Every other unit of [start, end) is in no run: white space that collapsed completely or
// into earlier white space, a text node without a renderer (`collapsed`). A run with needsHyphen is followed by the
// `hyphen`. Inline box start runs are `box-start` (spanning starts carry no edge), end runs `box-end`, and atomic, hard line
// break and word break opportunity runs their elements. Levels are the runs' levels after resetBidiLevelForTrailingWhitespace;
// UBIDI_DEFAULT_LTR is the root level.
function lineFragments(p: WebKitPrepared, line: Line, start: number, end: number): Fragment[] {
  const rootLevel = p.style.rtl ? 1 : 0
  const levelOf = (level: number) => level === DEFAULT_BIDI_LEVEL || level === OPAQUE_BIDI_LEVEL ? rootLevel : level
  // Collapsible white space is laid out as a space (a newline or TAB in normal is a space).
  const painted = (box: WebKitBox, from: number, to: number): string => {
    const text = box.text.slice(from, to)
    if (!collapsesWhiteSpace(box.style)) return text
    let out = ''
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      out += c === 0x09 || c === 0x0a ? ' ' : text[i]!
    }
    return out
  }
  const runs = line.runs
  let lastTextRun = -1
  for (let i = 0; i < runs.length; i++) if (runs[i]!.kind === 'text') lastTextRun = i
  // Each piece with the source offset it sits at. An element's run sits where its item does, the start of the first text box
  // at or after it in document order (types.ts WebKitItem), clamped to the line's cursor so fragments stay in logical order.
  const pieces: { at: number; fragment: Fragment }[] = []
  let cursor = start
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    switch (run.kind) {
      case 'text': {
        const box = p.boxes[run.box]!
        const from = run.textStart
        const to = run.textStart + run.textLength
        const hangFrom = i === lastTextRun && line.hanging !== null ? Math.max(from, to - line.hanging.length) : to
        const level = levelOf(run.level)
        if (hangFrom > from) pieces.push({ at: box.sourceStart + from, fragment: { kind: 'text', run: box.run, start: box.sourceStart + from, end: box.sourceStart + hangFrom, painted: painted(box, from, hangFrom), level } })
        if (to > hangFrom) pieces.push({ at: box.sourceStart + hangFrom, fragment: { kind: 'hanging', run: box.run, start: box.sourceStart + hangFrom, end: box.sourceStart + to, painted: painted(box, hangFrom, to), level } })
        if (run.needsHyphen) pieces.push({ at: box.sourceStart + to, fragment: { kind: 'hyphen', run: box.run, at: box.sourceStart + to, painted: box.hyphen, letterSpacing: box.cssLetterSpacing, level } })
        cursor = box.sourceStart + to
        break
      }
      case 'soft-line-break': {
        const box = p.boxes[run.box]!
        pieces.push({ at: box.sourceStart + run.textStart, fragment: { kind: 'forced-break', run: box.run, start: box.sourceStart + run.textStart, end: box.sourceStart + run.textStart + 1 } })
        cursor = box.sourceStart + run.textStart + 1
        break
      }
      case 'inline-box-start':
        pieces.push({ at: Math.max(cursor, run.sourceOffset), fragment: { kind: 'box-start', element: run.element } })
        break
      case 'inline-box-end':
        pieces.push({ at: Math.max(cursor, run.sourceOffset), fragment: { kind: 'box-end', element: run.element } })
        break
      case 'atomic':
        pieces.push({ at: Math.max(cursor, run.sourceOffset), fragment: { kind: 'atomic', element: run.element, level: levelOf(run.level) } })
        break
      case 'hard-line-break':
        pieces.push({ at: Math.max(cursor, run.sourceOffset), fragment: { kind: 'br', element: run.element } })
        break
      case 'word-break-opportunity':
        pieces.push({ at: Math.max(cursor, run.sourceOffset), fragment: { kind: 'wbr', element: run.element } })
        break
      case 'spanning-inline-box-start':
        break
    }
  }
  if (line.trimmedUnit !== null) {
    const box = p.boxes[line.trimmedUnit.box]!
    const s = box.sourceStart + line.trimmedUnit.offset
    let index = pieces.length
    while (index > 0 && pieces[index - 1]!.at > s) index--
    pieces.splice(index, 0, { at: s, fragment: { kind: 'trimmed', run: box.run, start: s, end: s + 1, painted: ' ', level: levelOf(line.trimmedUnit.level) } })
  }
  const fragments: Fragment[] = []
  let covered = start
  const collapse = (to: number) => {
    while (covered < to) {
      const run = runAt(p, covered)
      const runEnd = Math.min(to, p.runStarts[run + 1]!)
      fragments.push({ kind: 'collapsed', run, start: covered, end: runEnd })
      covered = runEnd
    }
  }
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!
    const fragment = piece.fragment
    switch (fragment.kind) {
      case 'text':
      case 'hanging':
      case 'trimmed':
      case 'forced-break':
        collapse(fragment.start)
        fragments.push(fragment)
        covered = fragment.end
        break
      case 'hyphen':
        fragments.push(fragment)
        break
      case 'box-start':
      case 'box-end':
      case 'atomic':
      case 'br':
      case 'wbr':
        collapse(Math.min(piece.at, end))
        fragments.push(fragment)
        break
      case 'collapsed':
        break
    }
  }
  collapse(end)
  return fragments
}
