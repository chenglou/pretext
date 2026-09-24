// Lab cases for the layouts tools/bwf-fonts-probe.ts scored as the head's losses (and, with --kinds, its gains), so the lab's
// own observation and scorer can say again which tree Chrome agrees with (lab/run.ts with each tree's predictor, then
// lab/score.ts). Plain paragraphs and the styles the lab's paragraph builder takes as they are; spans with padding are built as
// spans. Only probe runs at the lab's device pixel ratio (2) make sense to replay.
//
//   bun rebuild/tools/bwf-fonts-cases.ts --probe=<chrome-probes.json>[,<more>] --out=<cases.ndjson> [--kinds=losses,gains] [--limit=40]
//
// --limit is the most cases a family, text, style and variant get. The ids are in no registry.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { el, font, leaf, treeParagraph, type BlockSpec, type TreePart } from '../lab/cases/build.ts'
import { makeCase } from '../lab/cases/case.ts'
import { TEXTS } from './bwf-fonts-probe.ts'

type Scored = { part: string; text: string; style: string; size: number; variant: string; width: number; paragraph?: string }
type Row = { family: string; resolves: boolean; losses?: Scored[]; gains?: Scored[] }

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const kinds = (options.get('kinds') ?? 'losses').split(',') as Array<'losses' | 'gains'>
const limit = Number(options.get('limit') ?? 40)

// The probe's styles by name (tools/bwf-fonts-probe.ts STYLES and SPACING).
function styleOf(name: string): { block: Partial<BlockSpec>; flip: boolean; spanEvery: number; spanPadding: number } {
  const none = { block: {}, flip: false, spanEvery: 0, spanPadding: 0 }
  switch (name) {
    case 'plain': return none
    case 'letter-spacing': return { ...none, block: { letterSpacing: 1.5 } }
    case 'word-spacing': return { ...none, block: { wordSpacing: 4 } }
    case 'negative-word-spacing': return { ...none, block: { wordSpacing: -2 } }
    case 'pre-wrap': return { ...none, block: { whiteSpace: 'pre-wrap' } }
    case 'break-spaces': return { ...none, block: { whiteSpace: 'break-spaces' } }
    case 'justify-indent': return { ...none, block: { textAlign: 'justify', textIndent: 17.5 } }
    case 'other-direction': return { ...none, flip: true }
    case 'spans': return { ...none, spanEvery: 3 }
    case 'padded-spans': return { ...none, spanEvery: 2, spanPadding: 3 }
  }
  const spaced = /^(?:ls(-?[\d.]+))?(?:ws(-?[\d.]+))?$/.exec(name)
  if (spaced === null) throw new Error(`Unknown style ${name}`)
  return { ...none, block: { letterSpacing: Number(spaced[1] ?? 0), wordSpacing: Number(spaced[2] ?? 0) } }
}

// The probe's paragraphOf content, as the lab's tree: every n-th word a span of the same font, every other span taking the
// space before its word inside.
function partsOf(text: string, spanEvery: number, spanPadding: number, fontDecl: ReturnType<typeof font>): TreePart[] {
  if (spanEvery === 0) return [leaf(text)]
  const parts: TreePart[] = []
  const words = text.split(' ')
  let plain = ''
  let spans = 0
  for (let w = 0; w < words.length; w++) {
    const lead = w === 0 ? '' : ' '
    if (w % spanEvery !== spanEvery - 1 || words[w]!.length === 0) { plain += lead + words[w]!; continue }
    const inside = spans++ % 2 === 1
    if (!inside) plain += lead
    if (plain.length > 0) parts.push(leaf(plain))
    plain = ''
    parts.push(el({ font: fontDecl, start: { padding: spanPadding }, end: { padding: spanPadding } }, leaf((inside ? lead : '') + words[w]!)))
  }
  if (plain.length > 0) parts.push(leaf(plain))
  return parts
}

const lines: string[] = []
const seen = new Set<string>()
const files = options.get('probe')!.split(',')
for (let p = 0; p < files.length; p++) {
  const report = JSON.parse(readFileSync(resolve(files[p]!), 'utf8')) as { results: Array<{ result: { observations: Array<{ value: { fonts: Row[] } }> } }> }
  const rows = report.results[0]!.result.observations[0]!.value.fonts
  for (let f = 0; f < rows.length; f++) {
    const row = rows[f]!
    if (!row.resolves) continue
    const family = row.family.startsWith('!') ? row.family.slice(1) : JSON.stringify(row.family)
    const taken = new Map<string, number>()
    for (let k = 0; k < kinds.length; k++) {
      const list = row[kinds[k]!] ?? []
      for (let i = 0; i < list.length; i++) {
        const d = list[i]!
        const given = TEXTS.find(candidate => candidate.name === d.text)!
        const key = `${kinds[k]}/${d.text}/${d.style}/${d.variant}`
        if ((taken.get(key) ?? 0) >= limit) continue
        taken.set(key, (taken.get(key) ?? 0) + 1)
        const style = styleOf(d.style)
        const [weight, fontStyle] = d.variant.split(':')
        const fontDecl = font(family, d.size, Number(weight), fontStyle as 'normal' | 'italic')
        const rtl = given.rtl !== style.flip
        const made = treeParagraph({ font: fontDecl, lang: given.lang, lineHeight: d.size * 2, overflowWrap: 'break-word', direction: rtl ? 'rtl' : 'ltr', ...style.block }, partsOf(d.paragraph ?? given.text, style.spanEvery, style.spanPadding, fontDecl))
        const c = makeCase({ family: 'bwf-fonts/' + kinds[k], origin: `tools/bwf-fonts-cases.ts family=${row.family} text=${d.text}/${d.style} variant=${d.variant} size=${d.size} width=${d.width} part=${d.part}`, pageLang: 'en', paragraph: { ...made.paragraph, width: d.width }, inline: made.inline })
        if (seen.has(c.id)) continue
        seen.add(c.id)
        lines.push(JSON.stringify(c))
      }
    }
  }
}
writeFileSync(resolve(options.get('out')!), `${lines.join('\n')}\n`)
console.log(`[bwf-fonts-cases] ${lines.length} cases`)
