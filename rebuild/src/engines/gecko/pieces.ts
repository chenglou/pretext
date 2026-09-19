// The pieces of a decided line for Gecko (Firefox 156.0): what a painter takes of it (model.ts LinePieces). Fragments are
// classified by the placed frames' own flags (DESIGN.md §2.5), so the line is placed first (placement.ts). A pure function
// of the prepared paragraph and the decided line.
import type { Fragment, LinePieces } from '../../model.js'
import { joinsAcross } from './advance.js'
import { itemAt, type GeckoFilledLine } from './lines.js'
import { placeLine, textFramesOf, type PlacedText } from './placement.js'
import { holderOfSource, objectAt, type GeckoLeaf, type GeckoPrepared } from './types.js'

// Gecko's painting rules read nothing beside the pieces.
export type GeckoPaintFacts = Record<never, never>

// The transformed index after the line's last kept character, a preserved newline that ends its frame left out; null on a
// line that keeps none. `texts` are the line's text frames in logical order.
export function lineEndT(p: GeckoPrepared, texts: PlacedText[]): number | null {
  for (let k = texts.length - 1; k >= 0; k--) {
    const r = texts[k]!.r
    const contentEnd = r.contentStart + r.contentLength
    for (let s = contentEnd - 1; s >= r.offset; s--) {
      const t = p.sourceT[s]!
      if (t === -1 || (r.endsInNewline && s === contentEnd - 1 && p.tUnits[t] === 0x0a)) continue
      return t + 1
    }
  }
  return null
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
  // CharIsSpace characters of the line's last frames with content (:11214-11229): the frames from `hangingFrom` on, back
  // from the line's end as far as a frame is white space alone.
  let hangingFrom = texts.length
  for (let k = texts.length - 1; k >= 0; k--) {
    const r = texts[k]!.r
    const style = p.leaves[p.frames[r.frame]!.run]!.style
    if (!(style.whitespaceCanHang && style.whiteSpaceIsSignificant)) break
    hangingFrom = k
    if (r.prov !== null && r.trimmableChars < r.tEnd - r.prov.startT) break
  }
  // A kept character s of text frame k.
  const kindOf = (k: number, s: number): 'text' | 'trimmed' | 'hanging' => {
    const pf = texts[k]!
    const trailing = p.sourceT[s]! >= pf.r.tEnd - pf.r.trimmableChars
    if ((pf.r.trimmedTrailingWhitespace && trailing) || s >= pf.trimmedEnd) return 'trimmed'
    return k >= hangingFrom && trailing ? 'hanging' : 'text'
  }

  // Fragments in document order over the items the line consumed: collapsed text before and between them (text nodes
  // without frames), each placed text frame's content by its flags, element edges and objects.
  const fragments: Fragment[] = []
  // The line's next text frame: they come in item order.
  let nextText = 0
  let cursor = start.contentOffset
  const lastItem = isLastLine ? p.items.length : next.offset > itemAt(p, next.item) ? next.item + 1 : next.item
  for (let k = start.frame; k < lastItem; k++) {
    const item = p.items[k]!
    if (item.kind !== 'text') {
      pushCollapsed(fragments, p.leaves, cursor, item.at)
      cursor = Math.max(cursor, item.at)
      switch (item.kind) {
        case 'open': if (!item.split) fragments.push({ kind: 'box-start', element: item.element }); break
        case 'close': if (!item.split) fragments.push({ kind: 'box-end', element: item.element }); break
        case 'atomic': fragments.push({ kind: 'atomic', element: item.element, level: objectAt(p.elements, item.element).level }); break
        case 'br': fragments.push({ kind: 'br', element: item.element }); break
        case 'wbr': fragments.push({ kind: 'wbr', element: item.element }); break
      }
      continue
    }
    const f = p.frames[item.frame]!
    const to = Math.min(f.end, lineEnd)
    if (nextText === texts.length || texts[nextText]!.item !== k) {
      pushCollapsed(fragments, p.leaves, cursor, to)
      cursor = Math.max(cursor, to)
      continue
    }
    const placedText = nextText++
    const r = texts[placedText]!.r
    const contentEnd = r.contentStart + r.contentLength
    for (let s = cursor; s < contentEnd;) {
      if (s < r.offset) {
        pushCollapsed(fragments, p.leaves, s, r.offset)
        s = r.offset
        continue
      }
      const t = p.sourceT[s]!
      if (t === -1) {
        let e = s + 1
        while (e < contentEnd && p.sourceT[e] === -1) e++
        pushCollapsed(fragments, p.leaves, s, e)
        s = e
        continue
      }
      if (r.endsInNewline && s === contentEnd - 1 && p.tUnits[t] === 0x0a) {
        fragments.push({ kind: 'forced-break', run: f.run, start: s, end: s + 1 })
        s++
        continue
      }
      const kind = kindOf(placedText, s)
      let e = s + 1
      while (e < contentEnd && p.sourceT[e] !== -1 && kindOf(placedText, e) === kind &&
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
  pushCollapsed(fragments, p.leaves, cursor, lineEnd)

  const lastT = lineEndT(p, texts)
  // The paragraph shaped letters on both sides of this break inside one word: the painter keeps their joining forms.
  let joinsNextLine = false
  if (!isLastLine && lastT !== null && lastT < p.tUnits.length && p.unitOf[lastT - 1] === p.unitOf[lastT] &&
    p.units[p.unitOf[lastT]!]!.kind === 'word') {
    joinsNextLine = joinsAcross(p, p.units[p.unitOf[lastT]!]!, lastT)
  }
  // The line's content reaches past its band: its inline size with what justification added, less the hang.
  const overflows = placed.lineISize + placed.expansion - placed.hang - line.band.iSize > 0
  return { fragments, joinsNextLine, indented: placed.indented, align: placed.align, overflows, facts: {} }
}

// Source [start, end) as collapsed text, a fragment a leaf.
function pushCollapsed(fragments: Fragment[], leaves: GeckoLeaf[], start: number, end: number): void {
  if (start >= end) return
  let run = holderOfSource(leaves, start)
  for (let s = start; s < end;) {
    while (leaves[run]!.end <= s) run++
    const e = Math.min(leaves[run]!.end, end)
    fragments.push({ kind: 'collapsed', run, start: s, end: e })
    s = e
  }
}
