// The pieces of a decided line for Gecko (Firefox 156.0): what a painter takes of it (model.ts LinePieces). Fragments are
// classified by the placed frames' own flags (DESIGN.md §2.5), so the line is placed first (placement.ts). A pure function
// of the prepared paragraph and the decided line.
import type { Fragment, LinePieces } from '../../model.js'
import { joinsAcross } from './advance.js'
import { itemAt, type GeckoFilledLine, type PlacedText } from './lines.js'
import { placeLine, textFramesOf } from './placement.js'
import type { GeckoElement, GeckoPrepared } from './types.js'

// Gecko's painting rules read nothing beside the pieces.
export type GeckoPaintFacts = Record<never, never>

// The transformed index after the line's last kept character, a preserved newline that ends its frame left out; -1 on a
// line that keeps none. `texts` are the line's text frames in logical order.
export function lineEndT(p: GeckoPrepared, texts: PlacedText[]): number {
  for (let k = texts.length - 1; k >= 0; k--) {
    const r = texts[k]!.r
    const contentEnd = r.contentStart + r.contentLength
    for (let s = contentEnd - 1; s >= r.offset; s--) {
      const t = p.sourceT[s]!
      if (t === -1 || (r.endsInNewline && s === contentEnd - 1 && p.tUnits[t] === 0x0a)) continue
      return t + 1
    }
  }
  return -1
}

export function linePieces(p: GeckoPrepared, line: GeckoFilledLine): LinePieces<GeckoPaintFacts> {
  const placed = placeLine(p, line)
  const texts = textFramesOf(placed.root)
  const start = line.start
  const next = line.next
  // Characters after the last item belong to text nodes without frames, which the last line holds as collapsed.
  const isLastLine = next.item >= p.items.length
  const lineEnd = isLastLine ? p.text.length : next.offset

  // The white space the line end removed or hangs, by the frames' flags: trailing CharIsSpace characters trimmed at the
  // break (TEXT_TRIMMED_TRAILING_WHITESPACE, nsTextFrame.cpp:11203-11213; CharIsSpace is U+0020 and U+3000,
  // gfxFont.cpp:749-750), the IsTrimmableSpace characters TrimTrailingWhiteSpace removed, and under pre-wrap the trailing
  // CharIsSpace characters of the line's last frames with content (:11214-11229).
  const trimmed = new Set<number>()
  const hanging = new Set<number>()
  const placedByItem = new Map<number, PlacedText>()
  for (let k = 0; k < texts.length; k++) {
    const pf = texts[k]!
    const r = pf.r
    placedByItem.set(pf.item, pf)
    if (r.trimmedTrailingWhitespace) for (let t = r.tEnd - r.trimmableChars; t < r.tEnd; t++) trimmed.add(p.tSource[t]!)
    for (let s = pf.trimmedEnd; s < r.contentStart + r.contentLength; s++) if (p.sourceT[s] !== -1) trimmed.add(s)
  }
  for (let k = texts.length - 1; k >= 0; k--) {
    const r = texts[k]!.r
    const style = p.leaves[p.frames[r.frame]!.run]!.style
    if (!(style.whitespaceCanHang && style.whiteSpaceIsSignificant)) break
    if (r.prov === null) continue
    for (let t = r.tEnd - r.trimmableChars; t < r.tEnd; t++) hanging.add(p.tSource[t]!)
    if (r.trimmableChars < r.tEnd - r.prov.startT) break
  }
  const kindOf = (s: number): 'text' | 'trimmed' | 'hanging' => trimmed.has(s) ? 'trimmed' : hanging.has(s) ? 'hanging' : 'text'

  // Fragments in document order over the items the line consumed: collapsed text before and between them (text nodes
  // without frames), each placed text frame's content by its flags, element edges and objects.
  const fragments: Fragment[] = []
  const runOf = (s: number): number => {
    let r = 0
    while (p.leaves[r]!.end <= s) r++
    return r
  }
  let cursor = start.contentOffset
  const lastItem = isLastLine ? p.items.length : next.offset > itemAt(p, next.item) ? next.item + 1 : next.item
  for (let k = start.frame; k < lastItem; k++) {
    const item = p.items[k]!
    if (item.kind !== 'text') {
      pushCollapsed(fragments, runOf, cursor, item.at)
      cursor = Math.max(cursor, item.at)
      switch (item.kind) {
        case 'open': if (!item.split) fragments.push({ kind: 'box-start', element: item.element }); break
        case 'close': if (!item.split) fragments.push({ kind: 'box-end', element: item.element }); break
        case 'atomic': fragments.push({ kind: 'atomic', element: item.element, level: (p.elements[item.element] as Extract<GeckoElement, { kind: 'atomic' }>).level }); break
        case 'br': fragments.push({ kind: 'br', element: item.element }); break
        case 'wbr': fragments.push({ kind: 'wbr', element: item.element }); break
      }
      continue
    }
    const pf = placedByItem.get(k)
    const f = p.frames[item.frame]!
    const to = Math.min(f.end, lineEnd)
    if (pf === undefined) {
      pushCollapsed(fragments, runOf, cursor, to)
      cursor = Math.max(cursor, to)
      continue
    }
    const r = pf.r
    const contentEnd = r.contentStart + r.contentLength
    for (let s = cursor; s < contentEnd;) {
      if (s < r.offset) {
        pushCollapsed(fragments, runOf, s, r.offset)
        s = r.offset
        continue
      }
      const t = p.sourceT[s]!
      if (t === -1) {
        let e = s + 1
        while (e < contentEnd && p.sourceT[e] === -1) e++
        pushCollapsed(fragments, runOf, s, e)
        s = e
        continue
      }
      if (r.endsInNewline && s === contentEnd - 1 && p.tUnits[t] === 0x0a) {
        fragments.push({ kind: 'forced-break', run: f.run, start: s, end: s + 1 })
        s++
        continue
      }
      const kind = kindOf(s)
      let e = s + 1
      while (e < contentEnd && p.sourceT[e] !== -1 && kindOf(e) === kind &&
        !(r.endsInNewline && e === contentEnd - 1 && p.tUnits[p.sourceT[e]!] === 0x0a)) e++
      const tEnd = p.sourceT[e - 1]! + 1
      let painted = ''
      for (let q = t; q < tEnd; q++) painted += String.fromCharCode(p.tUnits[q]!)
      fragments.push({ kind, run: f.run, start: s, end: e, painted, level: f.level })
      s = e
    }
    cursor = Math.max(cursor, contentEnd)
    // The hyphen of a used soft hyphen follows the frame's content; its advance is inside the frame's box, without letter
    // spacing (AddHyphenToMetrics, nsTextFrame.cpp:6829-6845).
    if (r.usedHyphenation) fragments.push({ kind: 'hyphen', run: f.run, at: contentEnd, painted: '‐', letterSpacing: 0, level: f.level })
  }
  pushCollapsed(fragments, runOf, cursor, lineEnd)

  const lastT = lineEndT(p, texts)
  // The paragraph shaped letters on both sides of this break inside one word: the painter keeps their joining forms.
  let joinsNextLine = false
  if (!isLastLine && lastT > 0 && lastT < p.tUnits.length && p.unitOf[lastT - 1] === p.unitOf[lastT] &&
    p.units[p.unitOf[lastT]!]!.kind === 'word') {
    joinsNextLine = joinsAcross(p, p.units[p.unitOf[lastT]!]!, lastT)
  }
  // The line's content reaches past its band: its inline size with what justification added, less the hang.
  const overflows = placed.lineISize + placed.expansion - placed.hang - line.band.iSize > 0
  return { fragments, joinsNextLine, indented: placed.indented, align: placed.align, overflows, facts: {} }
}

function pushCollapsed(fragments: Fragment[], runOf: (s: number) => number, start: number, end: number): void {
  for (let s = start; s < end;) {
    const run = runOf(s)
    let e = s + 1
    while (e < end && runOf(e) === run) e++
    fragments.push({ kind: 'collapsed', run, start: s, end: e })
    s = e
  }
}
