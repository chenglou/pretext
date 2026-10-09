// What the dynamic-layout and editorial-engine pages share: the test their headline fits ask of each font size, and
// what paints their lines, one absolutely positioned node per line, made when the line appears and removed when it
// goes. The justification page keeps its river marks the same way.
import { walkLineRanges, type PreparedText } from '../../src/layout.ts'

export type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
}

// Whether a line ends partway into a segment at this width: a word wider than the line, broken between two graphemes.
export function breaksInsideWord(prepared: PreparedText, maxWidth: number): boolean {
  let found = false
  walkLineRanges(prepared, maxWidth, line => {
    if (line.end.graphemeIndex !== 0) found = true
  })
  return found
}

export function positionedLinesEqual(a: PositionedLine[], b: PositionedLine[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!
    const right = b[index]!
    if (
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.text !== right.text
    ) {
      return false
    }
  }
  return true
}

// Makes `nodes` `count` long: adds new nodes after the last one, or to `parent` when there is none, and removes the
// surplus from the end. The nodes that stay aren't touched, so a text selection inside one is kept, and the list stays
// together and in order in the document, which a selection dragged across lines follows.
export function setNodeCount<T extends HTMLElement>(nodes: T[], count: number, create: () => T, parent: HTMLElement): void {
  while (nodes.length < count) {
    const element = create()
    const last = nodes[nodes.length - 1]
    if (last === undefined) parent.appendChild(element)
    else last.after(element)
    nodes.push(element)
  }
  while (nodes.length > count) {
    nodes.pop()!.remove()
  }
}

export function hasActiveTextSelection(): boolean {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.rangeCount > 0
}
