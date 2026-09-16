// Paints predicted lines so the browser draws each one as the paragraph's own layout did: form A-wrap of
// specs/painter.md §6. DESIGN.md §7 explains the choices and what painting a line alone still changes.
//
// - One block per line at the paragraph's content width, with its white-space, word-break, overflow-wrap, line-break and
//   tab-size, so the engine runs its own line-end rules again (Blink's CJK punctuation trimming in ShapeLine, Gecko's
//   pre-wrap hang width), and a line wider than predicted wraps visibly (R1).
// - A line that ends at a chosen soft hyphen or starts with the U+200D of R7 doesn't wrap: it holds a boundary the
//   paragraph never offered as a break (the hyphen, the joiner), which the browser would break at when the line overflows.
// - Each run's slice of the line is one node with the run's styles, and a bare text node stays a bare text node. Slices
//   of different runs are never merged, and a slice is split only where its bidi level changes (R2). A span between two
//   painted slices without painted text of its own is painted empty, so its neighbours keep the element between them.
//   A bare slice of ASCII white space alone at the start of a line goes in a span, because a text node of only such
//   white space as a block's first child isn't laid out.
// - Trailing collapsible white space stays in its slice, so the engine trims it and shapes the text before it the same
//   way (R3). Preserved white space is painted as laid out. Collapsed white space and forced breaks aren't painted.
// - The text is painted as the engine laid it out (R5).
// - The hyphen at a soft-hyphen break is its own span, styled per engine so that it shapes alone where the engine
//   shapes it alone (R6).
// - Where the paragraph's shaping joined letters across a line edge, U+200D on both sides keeps the joining forms (R7).
// - A line with a fragment at a level other than the paragraph's base level is drawn under bidi-override: the line
//   block overrides to the base direction and nested override spans add one level each, so the browser reorders the
//   line with the paragraph's levels instead of resolving the line alone (R8, specs/painter.md §4.4). Text never sits
//   directly in an override element, and the line's trailing white space takes the level of the text before it.
// Nothing sets a text width: the lab compares the painted extent with the predicted width (rebuild/lab/README.md
// "painter").
import type { EngineName } from './env.js'
import type { FontDecl, Fragment, Paragraph, ParagraphLayout, TextRun } from './model.js'

// U+0020 and U+0009..U+000D, the white space of Blink's IsASCIISpace: a text node holding only these as a block's first
// child gets no layout object in collapsing modes (Blink text.cc:319-364, the Blink port's layoutTextNeeded).
const ASCII_SPACE_ONLY = /^[\t-\r ]+$/
const SPACES_AND_TABS = /^[\t ]+$/

function setFont(style: CSSStyleDeclaration, font: FontDecl): void {
  style.fontFamily = font.family
  style.fontSize = `${font.size}px`
  style.fontWeight = String(font.weight)
  style.fontStyle = font.style
}

// A span with the run's styles.
function runSpan(doc: Document, parent: HTMLElement, run: TextRun): HTMLSpanElement {
  const span = doc.createElement('span')
  setFont(span.style, run.font)
  span.style.letterSpacing = `${run.letterSpacing}px`
  span.style.wordSpacing = `${run.wordSpacing}px`
  if (run.lang !== null) span.lang = run.lang
  parent.append(span)
  return span
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

export function paintLines(paragraph: Paragraph, layout: ParagraphLayout, doc: Document): HTMLDivElement[] {
  const base = paragraph.direction === 'rtl' ? 1 : 0
  const collapses = paragraph.whiteSpace === 'normal' || paragraph.whiteSpace === 'nowrap'
  const out: HTMLDivElement[] = []
  for (let l = 0; l < layout.lines.length; l++) {
    const line = layout.lines[l]!
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
    s.textAlign = 'start'
    s.textIndent = '0'
    s.textTransform = 'none'
    element.lang = paragraph.lang

    // The line's trailing white space. A painted line is a bidi paragraph of its own, and all three browsers resolve
    // it with ICU's ubidi_setPara, which gives white space at the end of a paragraph the paragraph level (UAX #9 L1), so
    // the level it's painted at only decides node division. Painting it at the level of the text before it in the same
    // run keeps that slice one text node, as it was in the paragraph: WebKit measures a word together with the space
    // after it in its text box (TextUtil.cpp:76-77), and Blink keeps the space in the text item.
    let trailing = line.fragments.length
    while (trailing > 0) {
      const fragment = line.fragments[trailing - 1]!
      const white = fragment.kind === 'collapsed' || fragment.kind === 'forced-break' || fragment.kind === 'trimmed' ||
        fragment.kind === 'hanging' || (fragment.kind === 'text' && SPACES_AND_TABS.test(fragment.painted))
      if (!white) break
      trailing--
    }
    const beforeTrailing = trailing > 0 ? line.fragments[trailing - 1]! : null
    const levelOf = (f: number, fragment: Extract<Fragment, { level: number }>): number =>
      f >= trailing && beforeTrailing !== null && beforeTrailing.kind === 'text' && beforeTrailing.run === fragment.run ? beforeTrailing.level : fragment.level

    let reorders = false
    let hyphenated = false
    let firstText = -1
    let lastText = -1
    // The first painted run of the line and its painted text.
    let firstRun = -1
    let firstRunText = ''
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
        case 'collapsed':
        case 'forced-break':
          break
      }
    }
    if (reorders) s.unicodeBidi = 'bidi-override'
    const joinsPreviousLine = l > 0 && layout.lines[l - 1]!.joinsNextLine
    // In the paragraph the hyphen belongs to the line after the break was taken, and the letters around a joined edge
    // are one cluster run; painted, the hyphen span and the leading U+200D start new items and grapheme clusters, which
    // an overflowing line would break before (Blink HandleOverflow's break-anywhere retry, WebKit's soft wrap opportunity
    // after a soft hyphen at a text box end, InlineFormattingUtils.cpp:385-437, Gecko's word-wrap break before a frame).
    if (hyphenated || joinsPreviousLine) s.setProperty('text-wrap-mode', 'nowrap')
    const firstInSpan = firstRun >= 0 && paragraph.runs[firstRun]!.node === 'text' && collapses && ASCII_SPACE_ONLY.test(firstRunText)

    // stack[0] holds the current run's slice; stack[d] is the override span for level base + d.
    let run = -1
    const stack: HTMLElement[] = []
    let text = ''
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
    const enter = (fragmentRun: number, level: number): void => {
      if (fragmentRun !== run) {
        flush()
        // Spans between the previous painted run and this one hold no painted text on this line.
        if (run >= 0) for (let r = run + 1; r < fragmentRun; r++) if (paragraph.runs[r]!.node === 'span') runSpan(doc, element, paragraph.runs[r]!)
        run = fragmentRun
        stack.length = 0
        const textRun = paragraph.runs[fragmentRun]!
        stack.push(textRun.node === 'span' || (fragmentRun === firstRun && firstInSpan) ? runSpan(doc, element, textRun) : element)
      }
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
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      switch (fragment.kind) {
        case 'text':
          enter(fragment.run, levelOf(f, fragment))
          if (f === firstText && joinsPreviousLine) text += '‍'
          text += fragment.painted
          if (f === lastText && line.joinsNextLine) text += '‍'
          break
        case 'trimmed':
        case 'hanging':
          enter(fragment.run, levelOf(f, fragment))
          text += fragment.painted
          break
        case 'hyphen':
          enter(fragment.run, fragment.level)
          flush()
          stack[stack.length - 1]!.append(hyphenSpan(doc, layout.engine, fragment))
          break
        case 'collapsed':
        case 'forced-break':
          break
      }
    }
    flush()
    out.push(element)
  }
  return out
}
