// Scale every CSS length of lab cases by a factor (font sizes, letter and word spacing, line height, width, text indent,
// box edges, atomic sizes): a case laid out at DPR d is the scaled case laid out at DPR d / factor, in zoomed px, which
// is what Blink shapes and breaks in. The lab observes at the machine's DPR (2 here), so a layout a probe found at DPR 1
// or 3 goes to the lab scaled by 0.5 or 1.5. widths.json maps a case id to the widths (at the case's DPR) to make cases
// at; without it each case keeps its width.
//
//   bun rebuild/tools/scale-cases.ts <cases.ndjson> <out.ndjson> <factor> [widths.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { makeCase } from '../lab/cases/case.ts'
const [inFile, outFile, factorArg, widthsArg] = process.argv.slice(2)
const k = Number(factorArg)
const r = (x: number): number => Math.round(x * k * 1e6) / 1e6
const scaleFont = (f: any) => ({ ...f, size: r(f.size) })
const scaleEdge = (e: any) => ({ margin: r(e.margin), border: r(e.border), padding: r(e.padding) })
function node(n: any): any {
  switch (n.kind) {
    case 'span': return { ...n, font: scaleFont(n.font), letterSpacing: r(n.letterSpacing), wordSpacing: r(n.wordSpacing), inlineStart: scaleEdge(n.inlineStart), inlineEnd: scaleEdge(n.inlineEnd), children: n.children.map(node) }
    case 'atomic': return { ...n, width: r(n.width), height: r(n.height), marginInlineStart: r(n.marginInlineStart), marginInlineEnd: r(n.marginInlineEnd) }
    default: return n
  }
}
const out: string[] = []
const seen = new Set<string>()
const widths = widthsArg === undefined ? null : JSON.parse(readFileSync(widthsArg, 'utf8')) as Record<string, number[]>
for (const line of readFileSync(inFile!, 'utf8').split('\n')) {
  if (!line) continue
  const c = JSON.parse(line)
  const p = c.paragraph
  const runs = p.runs.map((run: any) => ({ ...run, font: scaleFont(run.font), letterSpacing: r(run.letterSpacing), wordSpacing: r(run.wordSpacing) }))
  const inline = c.inline === undefined ? undefined : { ...c.inline, content: c.inline.content.map(node), textIndent: r(c.inline.textIndent), lineSlots: c.inline.lineSlots?.map((s: any) => ({ left: r(s.left), right: r(s.right) })) }
  for (const width of widths?.[c.id] ?? [p.width]) {
    const made = makeCase({ family: c.family, origin: `${c.origin} scaled=${k} from=${c.id}`, pageLang: c.pageLang, paragraph: { ...p, runs, font: scaleFont(p.font), letterSpacing: r(p.letterSpacing), wordSpacing: r(p.wordSpacing), lineHeight: Math.ceil(r(p.lineHeight)), width: r(width) }, inline, fontFixtures: c.fontFixtures })
    if (seen.has(made.id)) continue
    seen.add(made.id)
    out.push(JSON.stringify(made))
  }
}
writeFileSync(outFile!, out.join('\n') + '\n')
console.log(out.length)
