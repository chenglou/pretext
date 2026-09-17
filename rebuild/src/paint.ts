// Paints predicted lines so the browser draws each one as the paragraph's own layout did: form A-wrap of
// specs/painter.md §6. DESIGN.md §7 explains the choices and what painting a line alone still changes.
//
// - One block per line at the paragraph's content width, with the block's text style, direction, lang and text-align,
//   the text-indent where the engine indented the line, and the line's slot as floats of its insets, so the engine runs
//   its own line rules again (Blink's CJK punctuation trimming in ShapeLine, Gecko's pre-wrap hang width, a band's
//   arithmetic), and a line wider than predicted wraps visibly (R1). A paragraph that isn't start-aligned gives the block
//   the line's used alignment as text-align-last, since the painted line is its block's last line. A line from a later
//   line build than the paragraph's first gets its floats from a holder block around the line block, where they are
//   already in the formatting context, as in the paragraph.
// - Where an engine's handling of a line's trailing white space reads whether content follows, a line that ended at a
//   soft wrap ends with softWrapBox, which wraps to the painted block's second line (DESIGN.md §7, "Soft wraps").
// - A line that ends at a chosen soft hyphen or starts with the U+200D of R7 doesn't wrap: it holds a boundary the
//   paragraph never offered as a break (the hyphen, the joiner), which the browser would break at when the line overflows.
// - The line's pieces are painted in logical order inside the elements that hold them. Between two consecutive painted
//   pieces the painter replays the paragraph's element structure, so a span between them with nothing painted of its own
//   is painted empty and its neighbours keep the element between them. A span's start and end edges are painted on the
//   lines that hold its box-start and box-end fragments, and a span with such an edge on a line where none of its content
//   is painted is painted for the edge alone. Each leaf's slice of the line is one text node, split only where its bidi
//   level changes (R2). A bare slice of ASCII white space alone at the start of a line goes in a span, because a text
//   node of only such white space as a block's first child isn't laid out.
// - Trailing collapsible white space stays in its slice, so the engine trims it and shapes the text before it the same
//   way (R3). Preserved white space is painted as laid out, and in Blink hanging spaces are their own text node, as they
//   are their own item result. Collapsed white space, forced breaks and <br> aren't painted; <wbr> is.
// - The text is painted as the engine laid it out (R5).
// - The hyphen at a soft-hyphen break is its own span, styled per engine so that it shapes alone where the engine
//   shapes it alone (R6).
// - Where the paragraph's shaping joined letters across a line edge, U+200D on both sides keeps the joining forms (R7).
// - A line with a piece at a level other than the paragraph's base level is drawn under bidi-override: the line block
//   overrides to the base direction and nested override spans add one level each, so the browser reorders the line with
//   the paragraph's levels instead of resolving the line alone (R8, specs/painter.md §4.4). Override spans sit inside the
//   innermost element of a piece, never around elements. Text never sits directly in an override element, and the line's
//   trailing white space takes the level of the text before it.
// - An atomic inline is painted as an empty inline-block of its declared border box and margins, aligned to the line top,
//   for the app to fill.
// - A line without a line box paints nothing and gets no block.
// Nothing sets a text width: the lab compares the painted rects with the rects the observation contract expects
// (DESIGN.md §7, §9).
import { indexContent, styleUnder } from './content.js'
import type { EngineName } from './env.js'
import type { AtomicInline, BelowFloats, BlinkLineGeometry, BoxEdge, CssFont, Fragment, LineOf, Paragraph, TextStyle } from './model.js'

// U+0020 and U+0009..U+000D, the white space of Blink's IsASCIISpace: a text node holding only these as a block's first
// child gets no layout object in collapsing modes (Blink text.cc:319-364, the Blink port's layoutTextNeeded).
const ASCII_SPACE_ONLY = /^[\t-\r ]+$/
const SPACES_AND_TABS = /^[\t ]+$/

// The shared fields of a line: all the painter reads.
export type PaintedLine = Pick<LineOf<unknown, unknown>, 'fragments' | 'hasLineBox' | 'joinsNextLine' | 'slot' | 'indented' | 'align'>
export type PaintableLayout = { belowFloats: readonly Pick<BelowFloats, 'row'>[] } & (
  | { engine: 'blink'; lines: readonly (PaintedLine & { geometry: Pick<BlinkLineGeometry, 'needsAccurateEndPosition'> })[] }
  | { engine: Exclude<EngineName, 'blink'>; lines: readonly PaintedLine[] }
)

function setFont(style: CSSStyleDeclaration, font: CssFont): void {
  style.fontFamily = font.family
  style.fontSize = `${font.size}px`
  style.fontWeight = String(font.weight)
  style.fontStyle = font.style
}

function hasEdge(edge: BoxEdge): boolean {
  return edge.margin !== 0 || edge.border !== 0 || edge.padding !== 0
}

// A span with an element's styles: its font, spacing and lang always, as flat runs painted them, and the inherited
// properties that decide lines where they differ from its parent's.
function styledSpan(doc: Document, style: TextStyle, parent: TextStyle, lang: string | null): HTMLSpanElement {
  const span = doc.createElement('span')
  const s = span.style
  setFont(s, style.font)
  s.letterSpacing = `${style.letterSpacing}px`
  s.wordSpacing = `${style.wordSpacing}px`
  if (lang !== null) span.lang = lang
  if (style.whiteSpace !== parent.whiteSpace) s.whiteSpace = style.whiteSpace
  if (style.wordBreak !== parent.wordBreak) s.wordBreak = style.wordBreak
  if (style.overflowWrap !== parent.overflowWrap) s.overflowWrap = style.overflowWrap
  if (style.lineBreak !== parent.lineBreak) s.setProperty('line-break', style.lineBreak)
  if (style.tabSize !== parent.tabSize) s.setProperty('tab-size', String(style.tabSize))
  return span
}

function paintEdge(style: CSSStyleDeclaration, side: 'start' | 'end', edge: BoxEdge): void {
  if (edge.margin !== 0) style.setProperty(`margin-inline-${side}`, `${edge.margin}px`)
  if (edge.border !== 0) style.setProperty(`border-inline-${side}`, `${edge.border}px solid`)
  if (edge.padding !== 0) style.setProperty(`padding-inline-${side}`, `${edge.padding}px`)
}

// R6: the hyphen, shaped the way the engine shapes it.
function hyphenSpan(doc: Document, engine: EngineName, fragment: Extract<Fragment, { kind: 'hyphen' }>): HTMLSpanElement {
  const span = doc.createElement('span')
  span.style.letterSpacing = `${fragment.letterSpacing}px`
  switch (engine) {
    case 'blink':
      // Blink shapes the hyphen alone, without spacing (hyphen_result.cc:12-16). A length vertical-align ends the
      // shaping group at the box edge (inline_node.cc:494-527) without moving the baseline.
      span.style.verticalAlign = '0px'
      break
    case 'webkit':
      // Layout measures the hyphen alone and paint shapes it with the word before it, so the width matches and the ink
      // keeps any kerning (specs/painter.md L3).
      break
    case 'gecko':
      // Gecko draws the hyphen from its own text run (nsTextFrame.cpp:7963-7984); an isolate ends the text run
      // (nsTextFrame.cpp:2091-2096).
      span.style.unicodeBidi = 'isolate'
      break
  }
  span.append(doc.createTextNode(fragment.painted))
  return span
}

// An atomic inline's border box and margins, empty. Top alignment keeps the line box at the line height while the box is
// no taller (CSS 2.1 §10.8).
function atomicBox(doc: Document, atomic: AtomicInline): HTMLSpanElement {
  const span = doc.createElement('span')
  const s = span.style
  s.display = 'inline-block'
  s.boxSizing = 'border-box'
  s.width = `${atomic.width}px`
  s.height = `${atomic.height}px`
  s.verticalAlign = 'top'
  if (atomic.marginInlineStart !== 0) s.setProperty('margin-inline-start', `${atomic.marginInlineStart}px`)
  if (atomic.marginInlineEnd !== 0) s.setProperty('margin-inline-end', `${atomic.marginInlineEnd}px`)
  return span
}

// A float of one line height that takes a slot's inset off one side of the painted block, as the paragraph's floats did.
function floatInset(doc: Document, side: 'left' | 'right', width: number, height: number): HTMLDivElement {
  const div = doc.createElement('div')
  const s = div.style
  s.cssFloat = side
  s.margin = '0'
  s.padding = '0'
  s.border = '0'
  s.width = `${width}px`
  s.height = `${height}px`
  return div
}

// An empty inline-block wider than any band, after a line that ended at a soft wrap: it can't share a line with anything,
// so the browser wraps the painted line before it, and the painted line is a wrapped line followed by more content, as
// it was in the paragraph, instead of its block's last line.
function softWrapBox(doc: Document): HTMLSpanElement {
  const span = doc.createElement('span')
  const s = span.style
  s.display = 'inline-block'
  s.width = 'calc(100% + 1px)'
  s.height = '0'
  s.margin = '0'
  s.padding = '0'
  s.border = '0'
  s.verticalAlign = 'top'
  return span
}

function wraps(whiteSpace: TextStyle['whiteSpace']): boolean {
  return whiteSpace !== 'nowrap' && whiteSpace !== 'pre'
}

export function paintLines(paragraph: Paragraph, layout: PaintableLayout, doc: Document): HTMLDivElement[] {
  const index = indexContent(paragraph)
  const base = paragraph.direction === 'rtl' ? 1 : 0
  const collapses = paragraph.whiteSpace === 'normal' || paragraph.whiteSpace === 'nowrap'
  const out: HTMLDivElement[] = []
  // The last line with a line box before this one.
  let previousJoins = false
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
    if (!line.hasLineBox) continue
    const joinsPreviousLine = previousJoins
    previousJoins = line.joinsNextLine
    const element = doc.createElement('div')
    const s = element.style
    s.display = 'block'
    s.margin = '0'
    s.padding = '0'
    s.border = '0'
    s.width = `${paragraph.width}px`
    s.height = `${paragraph.lineHeight}px`
    s.lineHeight = `${paragraph.lineHeight}px`
    setFont(s, paragraph.font)
    s.letterSpacing = `${paragraph.letterSpacing}px`
    s.wordSpacing = `${paragraph.wordSpacing}px`
    s.whiteSpace = paragraph.whiteSpace
    s.wordBreak = paragraph.wordBreak
    s.overflowWrap = paragraph.overflowWrap
    s.setProperty('line-break', paragraph.lineBreak)
    s.setProperty('tab-size', String(paragraph.tabSize))
    s.direction = paragraph.direction
    s.textAlign = paragraph.textAlign
    if (paragraph.textAlign !== 'start') s.setProperty('text-align-last', line.align)
    s.textIndent = line.indented ? `${paragraph.textIndent}px` : '0'
    s.textTransform = 'none'
    element.lang = paragraph.lang
    if (line.slot.left < 0 || line.slot.right < 0) throw new Error(`the painter paints a slot as floats and can't paint negative insets (${line.slot.left}, ${line.slot.right})`)
    // The paragraph's slot floats come before its content (DESIGN.md §2.9), so only the paragraph's first line build
    // places them, and every later build, a retry after a refused slot included, finds them in the formatting context.
    // WebKit counts tab stops from the line rect's left after the floats it finds but before those the build places
    // itself (InlineLineBuilder.cpp:478, :1394-1396). A painted line block places floats it holds, so a line from a later
    // build gets its floats from a holder block around it instead, where they intrude on the line block's first line.
    const firstBuild = l === 0 && !layout.belowFloats.some(refused => refused.row === 0)
    const intruding = (line.slot.left > 0 || line.slot.right > 0) && !firstBuild
    let root = element
    if (intruding) {
      root = doc.createElement('div')
      const r = root.style
      r.display = 'block'
      r.margin = '0'
      r.padding = '0'
      r.border = '0'
      r.width = `${paragraph.width}px`
      r.height = `${paragraph.lineHeight}px`
    }
    if (line.slot.left > 0) root.append(floatInset(doc, 'left', line.slot.left, paragraph.lineHeight))
    if (line.slot.right > 0) root.append(floatInset(doc, 'right', line.slot.right, paragraph.lineHeight))
    if (intruding) root.append(element)

    // The line's trailing white space. A painted line is a bidi paragraph of its own, and all three browsers resolve
    // it with ICU's ubidi_setPara, which gives white space at the end of a paragraph the paragraph level (UAX #9 L1), so
    // the level it's painted at only decides node division. Painting it at the level of the text before it in the same
    // leaf keeps that slice one text node, as it was in the paragraph: WebKit measures a word together with the space
    // after it in its text box (TextUtil.cpp:76-77), and Blink keeps the space in the text item. Box edges, <br> and
    // <wbr> don't end the trailing white space.
    let trailing = line.fragments.length
    while (trailing > 0) {
      const fragment = line.fragments[trailing - 1]!
      const white = fragment.kind === 'collapsed' || fragment.kind === 'forced-break' || fragment.kind === 'trimmed' ||
        fragment.kind === 'hanging' || fragment.kind === 'box-start' || fragment.kind === 'box-end' || fragment.kind === 'br' ||
        fragment.kind === 'wbr' || (fragment.kind === 'text' && SPACES_AND_TABS.test(fragment.painted))
      if (!white) break
      trailing--
    }
    const beforeTrailing = trailing > 0 ? line.fragments[trailing - 1]! : null
    const levelOf = (f: number, fragment: Extract<Fragment, { kind: 'text' | 'trimmed' | 'hanging' }>): number =>
      f >= trailing && beforeTrailing !== null && beforeTrailing.kind === 'text' && beforeTrailing.run === fragment.run ? beforeTrailing.level : fragment.level

    let reorders = false
    let hyphenated = false
    let firstText = -1
    let lastText = -1
    // The first painted leaf of the line and its painted text.
    let firstRun = -1
    let firstRunText = ''
    const startEdges = new Set<number>()
    const endEdges = new Set<number>()
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      switch (fragment.kind) {
        case 'text':
        case 'trimmed':
        case 'hanging':
          if (fragment.kind === 'text') {
            if (firstText < 0) firstText = f
            lastText = f
          }
          if (levelOf(f, fragment) !== base) reorders = true
          if (firstRun < 0) firstRun = fragment.run
          if (fragment.run === firstRun) firstRunText += fragment.painted
          break
        case 'hyphen':
          hyphenated = true
          if (fragment.level !== base) reorders = true
          break
        case 'atomic':
          if (fragment.level !== base) reorders = true
          break
        case 'box-start':
          startEdges.add(fragment.element)
          break
        case 'box-end':
          endEdges.add(fragment.element)
          break
        case 'collapsed':
        case 'forced-break':
        case 'br':
        case 'wbr':
          break
      }
    }
    if (reorders) s.unicodeBidi = 'bidi-override'
    // In the paragraph the hyphen belongs to the line after the break was taken, and the letters around a joined edge
    // are one cluster run; painted, the hyphen span and the leading U+200D start new items and grapheme clusters, which
    // an overflowing line would break before (Blink HandleOverflow's break-anywhere retry, WebKit's soft wrap opportunity
    // after a soft hyphen at a text box end, InlineFormattingUtils.cpp:385-437, Gecko's word-wrap break before a frame).
    if (hyphenated || joinsPreviousLine) s.setProperty('text-wrap-mode', 'nowrap')
    const firstInSpan = firstRun >= 0 && index.leaves[firstRun]!.parent === -1 && collapses && ASCII_SPACE_ONLY.test(firstRunText)
    // The line ended at a soft wrap: another line follows and no forced break ended it. Painted alone it's its block's
    // last line, where white space at the line's end is handled as before a forced break, so the painter ends the line
    // with softWrapBox where the engine's rules for that white space read whether more content follows:
    // - WebKit and Gecko, trailing white space that hangs: a pre-wrap sequence hangs unconditionally at a soft wrap and
    //   only conditionally at the end (WebKit horizontalAlignmentOffset, InlineFormattingUtils.cpp:198-217), Gecko's
    //   TextAlignLine hangs or trims it for alignment and justification only on a wrapped line (nsLineLayout.cpp:3505-3516),
    //   reserves a span's end border and padding on each of its lines (nsInlineFrame.cpp:512-513), and resolves white space
    //   at the paragraph's end to the base level (UAX #9 L1) where the paragraph kept its level.
    // - Blink, a trimmed collapsible space where the line's end isn't reshaped: the paragraph shaped the text with the space
    //   after it and trimmed the space afterwards (line_breaker.cc:255-268), while a block's end removes the space from
    //   the text before shaping (ExitBlock, inline_items_builder.cc:1622-1629). Where the end is reshaped
    //   (needsAccurateEndPosition), the paragraph shaped the text without the space, as the block's end does.
    // A line block that doesn't wrap gets no box, and neither does a line ending with R7's U+200D, which allows no break
    // after it (UAX #14 LB8a, ICU line.txt:151-153).
    let lastContent: Fragment['kind'] | null = null
    for (let f = line.fragments.length - 1; f >= 0 && lastContent === null; f--) {
      const kind = line.fragments[f]!.kind
      if (kind !== 'box-start' && kind !== 'box-end' && kind !== 'collapsed' && kind !== 'wbr') lastContent = kind
    }
    let softWrap = l < layout.lines.length - 1 && wraps(paragraph.whiteSpace) && !hyphenated && !joinsPreviousLine && !line.joinsNextLine &&
      lastContent !== 'forced-break' && lastContent !== 'br'
    switch (layout.engine) {
      case 'blink': softWrap &&= lastContent === 'trimmed' && !layout.lines[l]!.geometry.needsAccurateEndPosition; break
      case 'webkit':
      case 'gecko': softWrap &&= lastContent === 'hanging'; break
    }

    // The painted spans of the elements open at this point of the walk, outermost first.
    const open: { element: number; node: HTMLElement }[] = []
    // The event of the last painted piece, or -1 before the first.
    let cursor = -1
    // The leaf whose slice is being painted; -1 when none is.
    let run = -1
    // stack[0] holds the current piece's container; stack[d] is the override span for level base + d.
    const stack: HTMLElement[] = []
    let text = ''
    const container = (): HTMLElement => open.length > 0 ? open[open.length - 1]!.node : element
    const flush = (): void => {
      if (text.length === 0) return
      let parent = stack[stack.length - 1]!
      // WebKit measures a text box with its parent's unicode-bidi and direction (TextUtil.cpp:89-90): under an override
      // an RTL box is measured as an RTL override run, which sums glyph advances in another order than the paragraph's
      // LTR run and can move the width by a float32 step. A plain span between keeps the override, which forces every
      // character until the override ends, and the paragraph's measurement.
      if (stack.length > 1 || (parent === element && reorders)) parent = parent.appendChild(doc.createElement('span'))
      parent.append(doc.createTextNode(text))
      text = ''
    }
    const endPiece = (): void => {
      flush()
      run = -1
      stack.length = 0
    }
    const openElement = (e: number): void => {
      endPiece()
      const indexed = index.elements[e]!
      const node = indexed.node
      if (node.kind !== 'span') throw new Error(`the painter can't open element ${e}, a ${node.kind}`)
      const span = styledSpan(doc, node, styleUnder(paragraph, index, indexed.parent), node.lang)
      if (startEdges.has(e)) paintEdge(span.style, 'start', node.inlineStart)
      // A span without its box end on the line continues past it; on a soft wrap its end edge goes to the painted next line.
      if (endEdges.has(e) || softWrap) paintEdge(span.style, 'end', node.inlineEnd)
      if (node.verticalAlign !== 'baseline') span.style.verticalAlign = node.verticalAlign
      container().append(span)
      open.push({ element: e, node: span })
    }
    const closeElement = (e: number): void => {
      endPiece()
      const top = open.pop()
      if (top === undefined || top.element !== e) throw new Error(`the painter closed element ${e} out of document order`)
    }
    // Brings the walk to the event at `target`, the next painted piece. Before the first piece it opens the elements
    // holding the piece, outermost first; later it replays the opens and closes strictly between the last piece and this
    // one.
    const reach = (parent: number, target: number): void => {
      if (cursor < 0) {
        const chain: number[] = []
        for (let e = parent; e >= 0; e = index.elements[e]!.parent) chain.push(e)
        for (let k = chain.length - 1; k >= 0; k--) openElement(chain[k]!)
      } else {
        for (let k = cursor + 1; k < target; k++) {
          const event = index.events[k]!
          if (event.kind === 'open') openElement(event.element)
          else if (event.kind === 'close') closeElement(event.element)
        }
      }
      cursor = Math.max(cursor, target)
    }
    const setLevel = (level: number): void => {
      const depth = level - base
      if (stack.length - 1 === depth) return
      flush()
      while (stack.length - 1 > depth) stack.pop()
      while (stack.length - 1 < depth) {
        const span = doc.createElement('span')
        span.style.unicodeBidi = 'bidi-override'
        // An override of the opposite parity adds exactly one level.
        span.style.direction = ((base + stack.length) & 1) === 0 ? 'ltr' : 'rtl'
        stack[stack.length - 1]!.append(span)
        stack.push(span)
      }
    }
    const enterLeaf = (leaf: number, level: number): void => {
      if (leaf !== run) {
        const indexed = index.leaves[leaf]!
        reach(indexed.parent, indexed.event)
        endPiece()
        run = leaf
        if (leaf === firstRun && firstInSpan) {
          const span = styledSpan(doc, paragraph, paragraph, null)
          container().append(span)
          stack.push(span)
        } else {
          stack.push(container())
        }
      }
      setLevel(level)
    }
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      switch (fragment.kind) {
        case 'text':
          enterLeaf(fragment.run, levelOf(f, fragment))
          if (f === firstText && joinsPreviousLine) text += '‍'
          text += fragment.painted
          if (f === lastText && line.joinsNextLine) text += '‍'
          break
        case 'trimmed':
        case 'hanging':
          enterLeaf(fragment.run, levelOf(f, fragment))
          // Blink gives preserved trailing spaces an item result of their own, rounded up alone (HandleTrailingSpaces,
          // line_breaker.cc:2418-2534). A text node of their own is an item of its own, still shaped with the text before.
          if (layout.engine === 'blink' && fragment.kind === 'hanging' && f > 0 && line.fragments[f - 1]!.kind !== 'hanging') flush()
          text += fragment.painted
          break
        case 'hyphen':
          enterLeaf(fragment.run, fragment.level)
          flush()
          stack[stack.length - 1]!.append(hyphenSpan(doc, layout.engine, fragment))
          break
        case 'atomic': {
          const indexed = index.elements[fragment.element]!
          if (indexed.node.kind !== 'atomic') throw new Error(`fragment names element ${fragment.element}, a ${indexed.node.kind}, as atomic`)
          reach(indexed.parent, indexed.open)
          endPiece()
          stack.push(container())
          setLevel(fragment.level)
          stack[stack.length - 1]!.append(atomicBox(doc, indexed.node))
          break
        }
        case 'box-start': {
          const indexed = index.elements[fragment.element]!
          if (indexed.node.kind !== 'span' || !hasEdge(indexed.node.inlineStart)) break
          reach(indexed.parent, indexed.open)
          openElement(fragment.element)
          break
        }
        case 'box-end': {
          const indexed = index.elements[fragment.element]!
          if (indexed.node.kind !== 'span' || !hasEdge(indexed.node.inlineEnd)) break
          // Before the first piece, the span itself is among the elements to open.
          reach(cursor < 0 ? fragment.element : indexed.parent, indexed.close)
          closeElement(fragment.element)
          break
        }
        case 'wbr': {
          // The paragraph's <wbr> between two leaves, painted as it was.
          const indexed = index.elements[fragment.element]!
          reach(indexed.parent, indexed.open)
          endPiece()
          container().append(doc.createElement('wbr'))
          break
        }
        case 'collapsed':
        case 'forced-break':
        case 'br':
          break
      }
    }
    flush()
    if (softWrap) {
      // Spans whose box ends on this line close before the wrap.
      while (open.length > 0 && endEdges.has(open[open.length - 1]!.element)) closeElement(open[open.length - 1]!.element)
      // The white space of the box's parent decides the break before it (CSS Text §5.1: at the boundary of two inline
      // boxes the nearest common ancestor's white space applies), as the paragraph's break inside that span did.
      if (open.length === 0 || wraps(styleUnder(paragraph, index, open[open.length - 1]!.element).whiteSpace)) {
        container().append(softWrapBox(doc))
      } else {
        // The span holding the line's end doesn't wrap, so nothing can wrap before the box: the line stays its block's
        // last line, without the end edges of the spans that continue.
        for (let k = 0; k < open.length; k++) {
          const style = open[k]!.node.style
          style.removeProperty('margin-inline-end')
          style.removeProperty('border-inline-end')
          style.removeProperty('padding-inline-end')
        }
      }
    }
    out.push(root)
  }
  return out
}
