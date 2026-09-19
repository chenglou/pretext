// Capability i, a side look: whether prepared paragraphs could share their Canvas contexts, now that the engines' records
// hold contexts by reference. It needs shared-contexts.patch applied to a scratch copy of the tree (three sites, one per
// engine, read globalThis.sharedContexts instead of making a list): this script is not run against the branch as it is.
//   git archive HEAD rebuild/src rebuild/tools rebuild/research/capability-check | tar -x -C <scratch>/shared-ctx
//   cd <scratch>/shared-ctx && patch -p1 < rebuild/research/capability-check/shared-contexts.patch
//   bun rebuild/research/capability-check/shared-contexts.ts
// 200 paragraphs (the four samples, each cut at 50 lengths) are prepared and counted at 320px, once with a list of contexts
// per paragraph as the library does, once with one list shared by all of them. It prints the contexts made, the Canvas
// calls, and whether every line range is equal. The contexts left under the shared list are the font checks' own, made
// per prepare (measure/font-checks.ts withLearnedFontFacts). The stand-in has no per-canvas cache, so this says the
// records tolerate a shared list and nothing about what Chrome's cache would make of it.
import { fillAll, forEach, prepare, ranges } from './setup.ts'
import type { InlineNode, Paragraph } from '../../src/index.ts'

function cut(paragraph: Paragraph, keep: number): Paragraph {
  let left = keep
  const walk = (nodes: InlineNode[]): InlineNode[] => nodes.map(node => {
    if (node.kind === 'text') { const text = node.text.slice(0, Math.max(0, left)); left -= node.text.length; return { ...node, text } }
    if (node.kind === 'span') return { ...node, children: walk(node.children) }
    return node
  })
  return { ...paragraph, content: walk(paragraph.content) }
}

const totals = new Map<string, { contexts: number[]; calls: number[]; same: boolean }>()
forEach((engine, sample, env, standIn) => {
  const total = totals.get(engine) ?? { contexts: [0, 0], calls: [0, 0], same: true }
  totals.set(engine, total)
  const results: string[][] = [[], []]
  for (let mode = 0; mode < 2; mode++) {
    (globalThis as unknown as { sharedContexts: unknown[] | undefined }).sharedContexts = mode === 1 ? [] : undefined
    standIn.reset()
    for (let k = 1; k <= 50; k++) {
      const prepared = prepare(cut(sample.paragraph, Math.ceil(sample.text.length * k / 50)), env, false)
      results[mode]!.push(ranges(fillAll(prepared, 320)))
    }
    total.contexts[mode]! += standIn.asked().contexts
    total.calls[mode]! += standIn.asked().calls
  }
  (globalThis as unknown as { sharedContexts: unknown[] | undefined }).sharedContexts = undefined
  if (results[0]!.join('|') !== results[1]!.join('|')) total.same = false
})
for (const [engine, total] of totals) console.log(`${engine.padEnd(6)} 200 paragraphs: contexts ${total.contexts[0]} per-paragraph lists, ${total.contexts[1]} one shared list | calls ${total.calls[0]} and ${total.calls[1]} | same lines: ${total.same}`)
