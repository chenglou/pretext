// Capability g, first half: a line start made from a source offset (editorial-engine starts its body after the drop cap,
// `{ segmentIndex: 0, graphemeIndex: 1 }`).
//   bun rebuild/research/capability-check/offset-start.ts
// The function set makes a start only in firstLine and in a fill result's `next`. `lineStartAt` is a tiny export on this
// branch (src/index.ts, one function per engine's index.ts) that builds the engine's start from a source offset out of the
// prepared paragraph's own maps. Checks:
// 1. At every line start the engine reached itself, at two widths, the made start equals the engine's `next` (as JSON) or,
//    where it differs, fills the same line.
// 2. The drop cap: lines from source offset 1, against the same text with its first unit sliced off and prepared again.
// 3. A start is plain data: it survives JSON, and serves another prepared object of the same paragraph.
import { fillLine, lineStartAt, lineWidth, type FillResult, type InlineNode, type LineStart, type Paragraph, type Prepared } from '../../src/index.ts'
import { fillAll, forEach, fullSlot, prepare, ranges } from './setup.ts'

type Filled = Extract<FillResult, { kind: 'line' }>

function linesFrom(prepared: Prepared, from: LineStart | null, width: number): Filled[] {
  const out: Filled[] = []
  for (let start = from; start !== null;) {
    const result = fillLine(prepared, start, fullSlot(width))
    if (result.kind !== 'line') throw new Error('refused')
    out.push(result)
    start = result.next
  }
  return out
}

// The paragraph without its first source unit.
function sliced(paragraph: Paragraph): Paragraph {
  let done = false
  const cut = (nodes: InlineNode[]): InlineNode[] => nodes.map(node => {
    if (done) return node
    if (node.kind === 'text' && node.text.length > 0) { done = true; return { ...node, text: node.text.slice(1) } }
    if (node.kind === 'span') return { ...node, children: cut(node.children) }
    return node
  })
  return { ...paragraph, content: cut(paragraph.content) }
}

forEach((engine, sample, env) => {
  const prepared = prepare(sample.paragraph, env, false)
  let starts = 0
  let sameStart = 0
  let sameLine = 0
  const differing = new Set<string>()
  for (const width of [320, 150]) {
    const lines = fillAll(prepared, width)
    for (let i = 1; i < lines.length; i++) {
      const native = lines[i - 1]!.next!
      const made = lineStartAt(prepared, lines[i]!.start)
      starts++
      if (JSON.stringify(made) === JSON.stringify(native)) sameStart++
      else if (made !== null) {
        const a = made as unknown as Record<string, unknown>
        const b = native as unknown as Record<string, unknown>
        for (const key of Object.keys(b)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) differing.add(key)
      }
      if (made !== null) {
        const again = fillLine(prepared, made, fullSlot(width))
        if (again.kind === 'line' && again.start === lines[i]!.start && again.end === lines[i]!.end && lineWidth(prepared, again.line) === lineWidth(prepared, lines[i]!.line)) sameLine++
      }
    }
  }
  // The drop cap.
  const body = linesFrom(prepared, lineStartAt(prepared, 1), 320)
  const other = prepare(sliced(sample.paragraph), env, false)
  const alone = fillAll(other, 320)
  const shifted = alone.map(line => ({ start: line.start + 1, end: line.end + 1 }))
  const firstWidths = `${lineWidth(prepared, body[0]!.line).toFixed(3)} against ${lineWidth(other, alone[0]!.line).toFixed(3)}`
  // Plain data.
  const second = prepare(sample.paragraph, env, false)
  const native = fillAll(prepared, 320)[0]!.next!
  const copy = JSON.parse(JSON.stringify(native)) as LineStart
  const a = fillLine(prepared, native, fullSlot(320))
  const b = fillLine(second, copy, fullSlot(320))
  const plain = a.kind === 'line' && b.kind === 'line' && a.start === b.start && a.end === b.end && JSON.stringify(a.next) === JSON.stringify(b.next)
  console.log(`${engine.padEnd(6)} ${sample.name.padEnd(6)} made start equals the engine's: ${sameStart}/${starts}${differing.size > 0 ? ` (differs in ${[...differing].join(', ')})` : ''}; fills the same line and width: ${sameLine}/${starts}`)
  console.log(`${''.padEnd(13)} from offset 1: ${body.length} lines, first ${ranges(body.slice(0, 2))}; equals the sliced text's lines: ${ranges(body) === ranges(shifted)} (first line ${firstWidths} px) | a JSON copy of a start serves another prepared object: ${plain}`)
})
