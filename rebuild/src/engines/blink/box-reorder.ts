// InlineLayoutStateStack::BoxData (inline_box_state.h): source ranges are nested or disjoint, in source close order.
export type BoxData = {
  element: number
  start: number
  end: number
  hasLineLeftEdge: boolean
  hasLineRightEdge: boolean
  marginLineLeft: number
  marginLineRight: number
  mbpLineLeft: number
  mbpLineRight: number
  parent: number
  // An intermediate fragment names its source box by 1-based index. After flattening, an original box names its
  // last fragment by 0-based index; 0 means none.
  fragmentedFrom: number
  rectLeft: number
  rectRight: number
}


// Source box ranges form a forest. Compile its parents once, then carry only the open source path while walking visual
// children. Leaving that path closes a visual fragment; entering it opens one. The scratch state belongs to this line.
export function reorderBoxes<C extends { box: number }>(logical: readonly C[], visual: readonly C[], boxes: BoxData[]): BoxData[] {
  if (boxes.length === 0) return boxes
  const byStart = boxes.map((_, i) => i).sort((a, b) =>
    boxes[a]!.start - boxes[b]!.start || boxes[b]!.end - boxes[a]!.end || b - a)
  const depth = new Int32Array(boxes.length)
  const path: number[] = []
  let next = 0
  for (let c = 0; c < logical.length; c++) {
    while (path.length > 0 && boxes[path[path.length - 1]!]!.end <= c) path.pop()
    while (next < byStart.length && boxes[byStart[next]!]!.start === c) {
      const b = byStart[next++]!
      boxes[b]!.parent = path.length === 0 ? 0 : path[path.length - 1]! + 1
      depth[b] = path.length + 1
      path.push(b)
    }
    logical[c]!.box = path.length === 0 ? 0 : path[path.length - 1]! + 1
  }
  for (const box of boxes) { box.start = 0; box.end = 0 }
  path.length = 0
  const starts: number[] = []
  const fragmented: BoxData[] = []
  const close = (end: number): void => {
    const b = path.pop()!, start = starts.pop()!, box = boxes[b]!
    if (box.end === 0) { box.start = start; box.end = end }
    else fragmented.push({
      ...box, start, end, fragmentedFrom: b + 1, parent: 0,
      hasLineLeftEdge: false, hasLineRightEdge: false,
      marginLineLeft: 0, marginLineRight: 0, mbpLineLeft: 0, mbpLineRight: 0,
    })
  }
  const entered: number[] = []
  for (let c = 0; c < visual.length; c++) {
    const target = visual[c]!.box
    let a = path.length === 0 ? 0 : path[path.length - 1]! + 1, b = target
    while (a !== b) {
      const da = a === 0 ? 0 : depth[a - 1]!, db = b === 0 ? 0 : depth[b - 1]!
      if (da >= db) a = boxes[a - 1]!.parent
      if (db >= da) b = boxes[b - 1]!.parent
    }
    while (path.length > 0 && path[path.length - 1]! + 1 !== a) close(c)
    entered.length = 0
    for (let b = target; b !== a; b = boxes[b - 1]!.parent) entered.push(b - 1)
    for (let k = entered.length - 1; k >= 0; k--) { path.push(entered[k]!); starts.push(c) }
    visual[c]!.box = 0
  }
  while (path.length > 0) close(visual.length)
  if (fragmented.length === 0) return boxes
  // Preserve the source box order and each box's visual fragment order, without repeated list insertion/reindexing.
  fragmented.sort((a, b) => a.fragmentedFrom - b.fragmentedFrom || a.start - b.start)
  const out: BoxData[] = []
  let f = 0
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!
    out.push(box)
    while (f < fragmented.length && fragmented[f]!.fragmentedFrom === b + 1) {
      const fragment = fragmented[f++]!
      fragment.fragmentedFrom = 0
      out.push(fragment)
      box.fragmentedFrom = out.length - 1
    }
    if (box.fragmentedFrom === 0 || !box.hasLineRightEdge) continue
    const last = out[box.fragmentedFrom]!
    last.hasLineRightEdge = true
    last.marginLineRight = box.marginLineRight
    last.mbpLineRight = box.mbpLineRight
    box.hasLineRightEdge = false
    box.marginLineRight = 0
    box.mbpLineRight = 0
  }
  return out
}
