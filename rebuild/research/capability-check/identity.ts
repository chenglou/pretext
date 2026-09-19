// Capability h: identity on what is painted (rich-note's links and chips, markdown-chat's links and inline code).
//   bun rebuild/research/capability-check/identity.ts
// Part 1, the function set alone: a line's fragments name the application's own nodes: `run` is the text leaf's index in
// document order and `element` the element's, so an application that paints a line itself knows what each piece is.
// Part 2: paintLines builds the DOM the engine's painting rules need (override spans, joiners, hyphen spans), and its spans
// carry no identity: the recorded DOM of a line sets only styles and lang. With `onElement`, a callback added on this branch
// (src/paint.ts, six lines), the application is handed each span and atomic box with its element index.
import { blinkPaintRules, fillLine, firstLine, geckoPaintRules, linePieces, paintLines, webkitPaintRules, type LineStart, type PaintLine, type PaintRules } from '../../src/index.ts'
import { RecordingDocument, recordedPainting, type RecordedNode } from '../../tools/recording-document.ts'
import { forEach, fullSlot, prepare } from './setup.ts'

const WIDTH = 320

function attributes(nodes: readonly RecordedNode[], out: Set<string>): Set<string> {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.node !== 'element') continue
    for (let k = 0; k < node.set.length; k++) out.add(node.set[k]![0])
    attributes(node.children, out)
  }
  return out
}

forEach((engine, sample, env) => {
  if (sample.name !== 'spans') return
  const prepared = prepare(sample.paragraph, env, false)
  const lines: PaintLine<unknown>[] = []
  for (let start: LineStart | null = firstLine(prepared); start !== null;) {
    const result = fillLine(prepared, start, fullSlot(WIDTH))
    if (result.kind !== 'line') throw new Error('refused')
    const pieces = linePieces(prepared, result.line)
    lines.push({ pieces, slot: fullSlot(WIDTH), hasLineBox: result.hasLineBox })
    const named = pieces.fragments.map(f => ('run' in f ? `${f.kind}@leaf${f.run}` : `${f.kind}@element${f.element}`))
    console.log(`${engine.padEnd(6)} line ${lines.length}: ${named.join(' ')}`)
    start = result.next
  }
  const rules = (engine === 'blink' ? blinkPaintRules : engine === 'webkit' ? webkitPaintRules : geckoPaintRules) as PaintRules<unknown>
  const doc = new RecordingDocument() as unknown as Document
  const plain = recordedPainting(paintLines(sample.paragraph, lines, [], rules, doc))!
  const seen: string[] = []
  paintLines(sample.paragraph, lines, [], rules, doc, (element, node) => { seen.push(`element${element}:<${node.localName}>`) })
  console.log(`${engine.padEnd(6)} paintLines sets on its elements, styles aside: [${[...attributes(plain.flat(), new Set())].join(', ')}] | with onElement: ${seen.join(' ')}`)
})
