// How `record` reads the browser's own layout of a case. The DOM part runs in the page; the line functions below it also
// run offline, on stored rects, where the tests and the premise checks call them.
//
// - Lines come from rect positions, never from height / line height: every text box rect with positive height has a
//   vertical centre, and a new line starts where the next centre down is half a line height or more below the one before.
//   Main's height division read Safari 27's fractional line boxes as 3.000746 lines.
// - A visible character is a code point whose positive-size Range rects all sit on one line, leaving out Chrome's copies
//   of a soft hyphen's box. Its offset goes into the
//   recording as its line's first or last visible character. The pass rule (score.ts) checks both ends of each line, which
//   checks every visible character when the line index of visible characters never decreases in source order.
// - Short paragraphs are read code point by code point. Longer ones search from each line's first visible character for
//   the next line's: a few Range calls per line instead of one per code point.
import type { BrowserKind, Case, Recording, RecordedLine, Rect } from './types.ts'

// Paragraphs at least this long are searched instead of scanned.
export const SEARCH_FROM_UNITS = 1000

// The vertical centres each line's text boxes have, top to bottom.
export type Lines = { lo: number[]; hi: number[] }

export function groupLines(rects: readonly Rect[], lineHeight: number): Lines {
  const centres: number[] = []
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!
    if (rect.height > 0) centres.push(rect.y + rect.height / 2)
  }
  centres.sort((a, b) => a - b)
  const lines: Lines = { lo: [], hi: [] }
  for (let i = 0; i < centres.length; i++) {
    const centre = centres[i]!
    if (i === 0 || centre - centres[i - 1]! >= lineHeight / 2) {
      lines.lo.push(centre)
      lines.hi.push(centre)
    } else {
      lines.hi[lines.hi.length - 1] = centre
    }
  }
  return lines
}

// The line whose centres are nearest the rect's centre.
export function lineOf(lines: Lines, rect: Rect): number {
  const centre = rect.y + rect.height / 2
  let low = 0
  let high = lines.hi.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (lines.hi[middle]! < centre) low = middle + 1
    else high = middle
  }
  if (low === lines.hi.length) return low - 1
  if (low > 0 && centre < lines.lo[low]! && centre - lines.hi[low - 1]! < lines.lo[low]! - centre) return low - 1
  return low
}

// The Range rects of the code point that starts at a UTF-16 offset, relative to the paragraph.
export type RectsAt = (offset: number) => Rect[]

export const INVISIBLE = -1
export const SPLIT = -2

function codePointLength(text: string, offset: number): number {
  return text.codePointAt(offset)! > 0xffff ? 2 : 1
}

// The line all the code point's positive-size rects sit on; INVISIBLE without such rects, SPLIT across lines.
export function visibleLine(offset: number, lines: Lines, rectsAt: RectsAt): number {
  const rects = rectsAt(offset)
  let line = INVISIBLE
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!
    if (!(rect.width > 0 && rect.height > 0)) continue
    const at = lineOf(lines, rect)
    if (line === INVISIBLE) line = at
    else if (line !== at) return SPLIT
  }
  return line
}

// Where a line breaks at a soft hyphen, Chrome gives the hyphen's box to whichever range reaches it, so the code point
// next to the soft hyphen reports it too, often on the other line. The recording leaves that copy out. Other browsers
// report equal boxes for neighbouring zero-width characters, which are no copies, so this is Chrome's alone.
export function withoutHyphenCopies(text: string, rectsAt: RectsAt): RectsAt {
  return offset => {
    const rects = rectsAt(offset)
    if (text.charCodeAt(offset) === 0xad) return rects
    const hyphens: Rect[] = []
    if (offset > 0 && text.charCodeAt(offset - 1) === 0xad) hyphens.push(...rectsAt(offset - 1))
    const next = offset + codePointLength(text, offset)
    if (next < text.length && text.charCodeAt(next) === 0xad) hyphens.push(...rectsAt(next))
    if (hyphens.length === 0) return rects
    return rects.filter(rect => !hyphens.some(h => h.width > 0 && h.x === rect.x && h.y === rect.y && h.width === rect.width && h.height === rect.height))
  }
}

export type LineEnds = { first: number[]; last: number[] }

function emptyEnds(count: number): LineEnds {
  return { first: Array.from({ length: count }, () => -1), last: Array.from({ length: count }, () => -1) }
}

export function scanLineEnds(text: string, lines: Lines, rectsAt: RectsAt): LineEnds {
  const ends = emptyEnds(lines.lo.length)
  for (let offset = 0; offset < text.length; offset += codePointLength(text, offset)) {
    const line = visibleLine(offset, lines, rectsAt)
    if (line < 0) continue
    if (ends.first[line]! < 0) ends.first[line] = offset
    ends.last[line] = offset
  }
  return ends
}

// The same ends by search. null when a visible code point sits on an earlier line than one before it, where the search
// can't be trusted and the caller scans instead.
export function searchLineEnds(text: string, lines: Lines, rectsAt: RectsAt): LineEnds | null {
  const count = lines.lo.length
  const ends = emptyEnds(count)
  // The first visible code point at or after `from`, and its line; null at the end of the text.
  const nextVisible = (from: number): { offset: number; line: number } | null => {
    for (let offset = from; offset < text.length; offset += codePointLength(text, offset)) {
      const line = visibleLine(offset, lines, rectsAt)
      if (line >= 0) return { offset, line }
    }
    return null
  }
  // A UTF-16 offset moved back to the start of its code point.
  const snap = (offset: number): number => offset > 0 && (text.charCodeAt(offset) & 0xfc00) === 0xdc00 && (text.charCodeAt(offset - 1) & 0xfc00) === 0xd800 ? offset - 1 : offset
  let cursor = 0
  let guess = 32
  for (let line = 0; line < count; line++) {
    const start = nextVisible(cursor)
    if (start === null || start.line > line) continue
    if (start.line < line) return null
    ends.first[line] = start.offset
    // Gallop to an offset past the line, then bisect for the first offset whose next visible code point is on a later line.
    let low = start.offset
    let high = low
    for (let step = guess; ; step *= 2) {
      high = Math.min(text.length, snap(low + step))
      const probe = nextVisible(high)
      if (probe === null || probe.line > line) break
      if (probe.line < line) return null
      low = probe.offset
      if (high === text.length) break
    }
    for (;;) {
      let middle = snap((low + high) >> 1)
      if (middle <= low) middle = low + codePointLength(text, low)
      if (middle >= high) break
      const probe = nextVisible(middle)
      if (probe !== null && probe.line < line) return null
      if (probe === null || probe.line > line) high = middle
      else low = probe.offset
    }
    // `low` is the last visible code point on the line: every offset after it leads to a later line.
    ends.last[line] = low
    guess = Math.max(8, low - start.offset + 1)
    cursor = low + codePointLength(text, low)
  }
  return ends
}

// Each line's width: the horizontal extent of the text box rects on it that have positive size, less the U+0020 spaces
// that end it. Those hang past the line end, so a box sized to the text needs no room for them, and the library's line
// widths leave them out too; the shrink-wrap check compares the two. A trailing space counts only where its box reaches
// within a pixel of either end of the line, since WebKit gives a character's box in whole pixels; that leaves a space
// inside a line that bidi reordering ends elsewhere.
export function lineWidths(text: string, rects: readonly Rect[], lines: Lines, ends: LineEnds, rectsAt: RectsAt): number[] {
  const left = Array.from({ length: lines.lo.length }, () => Infinity)
  const right = Array.from({ length: lines.lo.length }, () => -Infinity)
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!
    if (!(rect.width > 0 && rect.height > 0)) continue
    const line = lineOf(lines, rect)
    left[line] = Math.min(left[line]!, rect.x)
    right[line] = Math.max(right[line]!, rect.x + rect.width)
  }
  const widths: number[] = []
  for (let line = 0; line < left.length; line++) {
    for (let offset = ends.last[line]!; offset >= 0 && offset >= ends.first[line]! && text.charCodeAt(offset) === 0x20; offset--) {
      const space = rectsAt(offset)
      for (let i = 0; i < space.length; i++) {
        const rect = space[i]!
        if (!(rect.width > 0 && rect.height > 0) || lineOf(lines, rect) !== line) continue
        if (rect.x < right[line]! && right[line]! <= rect.x + rect.width + 1) right[line] = rect.x
        else if (rect.x - 1 <= left[line]! && left[line]! < rect.x + rect.width) left[line] = rect.x + rect.width
      }
    }
    widths.push(right[line]! >= left[line]! ? right[line]! - left[line]! : 0)
  }
  return widths
}

export function recordedLines(text: string, nodeRects: readonly Rect[], lineHeight: number, browserRectsAt: RectsAt, browser: BrowserKind): RecordedLine[] {
  const lines = groupLines(nodeRects, lineHeight)
  const rectsAt = browser === 'chrome' ? withoutHyphenCopies(text, browserRectsAt) : browserRectsAt
  const ends = (text.length >= SEARCH_FROM_UNITS ? searchLineEnds(text, lines, rectsAt) : null) ?? scanLineEnds(text, lines, rectsAt)
  const widths = lineWidths(text, nodeRects, lines, ends, rectsAt)
  const out: RecordedLine[] = []
  for (let i = 0; i < widths.length; i++) out.push({ first: ends.first[i]!, last: ends.last[i]!, width: widths[i]! })
  return out
}

// ---- In the page ----

function setFont(style: CSSStyleDeclaration, font: Case['paragraph']['font']): void {
  style.fontFamily = font.family
  style.fontSize = `${font.size}px`
  style.fontWeight = String(font.weight)
  style.fontStyle = font.style
}

// The paragraph as an app would write it: a block of the case's width with its styles, and each run as a bare text node
// or a span, its text inserted exactly as given. Returns the styles the browser refused, whose layout isn't the case's.
function buildParagraph(c: Case): { element: HTMLDivElement; nodes: Text[]; refused: string[] } {
  const p = c.paragraph
  const element = document.createElement('div')
  const s = element.style
  s.position = 'absolute'
  s.left = '0'
  s.top = '0'
  s.margin = '0'
  s.padding = '0'
  s.border = '0'
  s.width = `${p.width}px`
  setFont(s, p.font)
  s.letterSpacing = `${p.letterSpacing}px`
  s.wordSpacing = `${p.wordSpacing}px`
  s.lineHeight = `${p.lineHeight}px`
  s.textAlign = 'start'
  s.hyphens = 'manual'
  const refused: string[] = []
  const keywords: Array<[string, string]> = [
    ['white-space', p.whiteSpace], ['word-break', p.wordBreak], ['overflow-wrap', p.overflowWrap],
    ['line-break', p.lineBreak], ['tab-size', String(p.tabSize)], ['direction', p.direction],
  ]
  for (let i = 0; i < keywords.length; i++) {
    const [property, value] = keywords[i]!
    s.setProperty(property, value)
    if (s.getPropertyValue(property) === '') refused.push(`${property}: ${value}`)
  }
  element.lang = p.lang
  const nodes: Text[] = []
  for (let i = 0; i < p.runs.length; i++) {
    const run = p.runs[i]!
    const text = document.createTextNode(run.text)
    nodes.push(text)
    if (run.node === 'text') {
      element.append(text)
      continue
    }
    const span = document.createElement('span')
    setFont(span.style, run.font)
    span.style.letterSpacing = `${run.letterSpacing}px`
    span.style.wordSpacing = `${run.wordSpacing}px`
    if (run.lang !== null) span.lang = run.lang
    // Padding repeats on every line the span reaches, as rich-inline's extraWidth does.
    if (run.padding !== undefined) {
      span.style.paddingInline = `${run.padding}px`
      span.style.setProperty('box-decoration-break', 'clone')
      span.style.setProperty('-webkit-box-decoration-break', 'clone')
    }
    if (run.atomic === true) {
      span.style.display = 'inline-block'
      span.style.whiteSpace = 'nowrap'
    }
    span.append(text)
    element.append(span)
  }
  return { element, nodes, refused }
}

function relativeRects(list: DOMRectList, origin: DOMRect, into: Rect[]): Rect[] {
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!
    into.push({ x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height })
  }
  return into
}

export function recordCase(c: Case, range: Range, browser: BrowserKind): Recording {
  const { element, nodes, refused } = buildParagraph(c)
  if (refused.length > 0) return { error: `refused ${refused.join(', ')}` }
  document.body.append(element)
  try {
    const origin = element.getBoundingClientRect()
    const runs = c.paragraph.runs
    const nodeRects: Rect[] = []
    const starts: number[] = []
    let text = ''
    for (let i = 0; i < runs.length; i++) {
      starts.push(text.length)
      text += runs[i]!.text
      if (runs[i]!.text.length === 0) continue
      range.selectNodeContents(nodes[i]!)
      relativeRects(range.getClientRects(), origin, nodeRects)
    }
    const rectsAt: RectsAt = offset => {
      let run = runs.length - 1
      while (starts[run]! > offset) run--
      const local = offset - starts[run]!
      range.setStart(nodes[run]!, local)
      range.setEnd(nodes[run]!, local + codePointLength(text, offset))
      return relativeRects(range.getClientRects(), origin, [])
    }
    return { lines: recordedLines(text, nodeRects, c.paragraph.lineHeight, rectsAt, browser), height: origin.height }
  } finally {
    element.remove()
  }
}
