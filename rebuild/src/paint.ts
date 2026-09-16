// Paints predicted lines so the browser draws each one as the paragraph's own layout did: form A-wrap of
// specs/painter.md §6. DESIGN.md §7 explains the choices and what painting a line alone still changes.
//
// - One block per line at the paragraph's content width, with its white-space, word-break, overflow-wrap, line-break and
//   tab-size, so the engine runs its own line-end rules again (Blink's CJK punctuation trimming in ShapeLine, Gecko's
//   pre-wrap hang width), and a line wider than predicted wraps visibly (R1).
// - Each run's slice of the line is one node with the run's styles, and a bare text node stays a bare text node. Slices
//   of different runs are never merged, and a slice is split only where its bidi level changes (R2).
// - Trailing collapsible white space stays in its slice, so the engine trims it and shapes the text before it the same
//   way (R3). Preserved white space is painted as laid out. Collapsed white space and forced breaks aren't painted.
// - The text is painted as the engine laid it out (R5).
// - The hyphen at a soft-hyphen break is its own span, styled per engine so that it shapes alone where the engine
//   shapes it alone (R6).
// - Where the paragraph's shaping joined letters across a line edge, U+200D on both sides keeps the joining forms (R7).
// - A line with a fragment at a level other than the paragraph's base level is drawn under bidi-override: the line
//   block overrides to the base direction and nested override spans add one level each, so the browser reorders the
//   line with the paragraph's levels instead of resolving the line alone (R8, specs/painter.md §4.4).
// Nothing sets a text width: the lab compares the painted extent with the predicted width (rebuild/lab/README.md
// "painter").
import type { EngineName } from './env.js'
import type { FontDecl, Fragment, Paragraph, ParagraphLayout, TextRun } from './model.js'

function setFont(style: CSSStyleDeclaration, font: FontDecl): void {
  style.fontFamily = font.family
  style.fontSize = `${font.size}px`
  style.fontWeight = String(font.weight)
  style.fontStyle = font.style
}

// The node a run's slice goes in: a span with the run's styles, or the line itself for a bare text node.
function runContainer(doc: Document, line: HTMLElement, run: TextRun): HTMLElement {
  switch (run.node) {
    case 'text':
      return line
    case 'span': {
      const span = doc.createElement('span')
      setFont(span.style, run.font)
      span.style.letterSpacing = `${run.letterSpacing}px`
      span.style.wordSpacing = `${run.wordSpacing}px`
      if (run.lang !== null) span.lang = run.lang
      line.append(span)
      return span
    }
  }
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
      // (nsTextFrame.cpp:2091-2096). In the paragraph the hyphen is part of the frame, never a break candidate; as its
      // own frame on an overflowing line, overflow-wrap would offer a word-wrap break before it (gfxTextRun.cpp:
      // 1068-1074), which nowrap removes (WordCanWrap needs WhiteSpaceCanWrap, nsStyleStruct.h:1360-1367).
      span.style.unicodeBidi = 'isolate'
      span.style.whiteSpace = 'nowrap'
      break
  }
  span.append(doc.createTextNode(fragment.painted))
  return span
}

export function paintLines(paragraph: Paragraph, layout: ParagraphLayout, doc: Document): HTMLDivElement[] {
  const base = paragraph.direction === 'rtl' ? 1 : 0
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

    let reorders = false
    let firstText = -1
    let lastText = -1
    for (let f = 0; f < line.fragments.length; f++) {
      const fragment = line.fragments[f]!
      switch (fragment.kind) {
        case 'text':
          if (firstText < 0) firstText = f
          lastText = f
          if (fragment.level !== base) reorders = true
          break
        case 'trimmed':
        case 'hanging':
        case 'hyphen':
          if (fragment.level !== base) reorders = true
          break
        case 'collapsed':
        case 'forced-break':
          break
      }
    }
    if (reorders) s.unicodeBidi = 'bidi-override'
    const joinsPreviousLine = l > 0 && layout.lines[l - 1]!.joinsNextLine

    // stack[0] holds the current run's slice; stack[d] is the override span for level base + d.
    let run = -1
    const stack: HTMLElement[] = []
    let text = ''
    const flush = (): void => {
      if (text.length === 0) return
      stack[stack.length - 1]!.append(doc.createTextNode(text))
      text = ''
    }
    const enter = (fragmentRun: number, level: number): void => {
      if (fragmentRun !== run) {
        flush()
        run = fragmentRun
        stack.length = 0
        stack.push(runContainer(doc, element, paragraph.runs[fragmentRun]!))
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
          enter(fragment.run, fragment.level)
          if (f === firstText && joinsPreviousLine) text += '‍'
          text += fragment.painted
          if (f === lastText && line.joinsNextLine) text += '‍'
          break
        case 'trimmed':
        case 'hanging':
          enter(fragment.run, fragment.level)
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
