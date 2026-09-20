// Reads a text-clusters-attack.ts output file and prints what it found, per probe:
//   bun rebuild/probes/text-clusters-attack-verdicts.ts <dir with chrome-probes.json>
// A cluster's DOM position is its Range rect's left edge from the block's left edge. The DOM floors it to a LayoutUnit of
// the zoomed page, 1/(64 * devicePixelRatio) CSS px, so a Canvas position `agrees` when its floor is that number, is
// `within` when it is less than one such step away, and `differs` otherwise.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProbeOutput } from './types.ts'

type Cluster = { start: number; end: number; left: number; advance: number; dom: Array<[number, number]> }
type Form = { width: number; clusters: Cluster[] }
type DomSample = { id: string; font: string; textMatches: boolean; codePoints: string[]; length: number; domWidth: number; dpr: number; forms: { plain: Form; port: Form }; units: Array<Array<[number, number]>> }

const dir = process.argv[2]
if (dir === undefined) throw new Error('Usage: bun rebuild/probes/text-clusters-attack-verdicts.ts <dir>')
const output = JSON.parse(readFileSync(join(dir, 'chrome-probes.json'), 'utf8')) as ProbeOutput

function valueOf(id: string): unknown {
  for (let i = 0; i < output.results.length; i++) {
    const r = output.results[i]!
    if (r.id !== id || r.result === null) continue
    for (let o = 0; o < r.result.observations.length; o++) {
      const observation = r.result.observations[o] as { kind: string; value?: unknown; error?: string }
      if (observation.kind === 'script') return observation.value ?? { error: observation.error }
    }
  }
  return null
}

function classify(form: Form, dpr: number): { agrees: number; within: number; differs: number; noRect: number; worst: Array<{ start: number; canvas: number; dom: number }>; widthAgrees: number } {
  const step = 1 / (64 * dpr)
  const out = { agrees: 0, within: 0, differs: 0, noRect: 0, worst: [] as Array<{ start: number; canvas: number; dom: number }>, widthAgrees: 0 }
  for (let i = 0; i < form.clusters.length; i++) {
    const c = form.clusters[i]!
    if (c.dom.length === 0) { out.noRect++; continue }
    let left = c.dom[0]![0]
    let right = c.dom[0]![0] + c.dom[0]![1]
    for (let r = 1; r < c.dom.length; r++) {
      left = Math.min(left, c.dom[r]![0])
      right = Math.max(right, c.dom[r]![0] + c.dom[r]![1])
    }
    const floored = Math.floor(c.left / step) * step
    if (floored === left) out.agrees++
    else if (Math.abs(c.left - left) < step) out.within++
    else {
      out.differs++
      out.worst.push({ start: c.start, canvas: c.left, dom: left })
    }
    if (Math.abs(right - left - c.advance) <= step) out.widthAgrees++
  }
  return out
}

console.log(`status ${output.status}; ${output.totals.results} results, ${output.totals.probesWithErrors} probes with errors, ${output.totals.observationErrors} observation errors`)
console.log('presence', JSON.stringify(valueOf('text-clusters-attack/presence')))

for (const id of ['text-clusters-attack/dom', 'text-clusters-attack/dom-fixtures']) {
  const value = valueOf(id) as { has: boolean; samples: DomSample[] } | null
  if (value === null || value.samples === undefined) { console.log(id, 'no value', JSON.stringify(value)); continue }
  console.log(`\n== ${id} (flag on: ${value.has})`)
  const totals = { plain: { agrees: 0, within: 0, differs: 0 }, port: { agrees: 0, within: 0, differs: 0 } }
  for (let s = 0; s < value.samples.length; s++) {
    const sample = value.samples[s]!
    const line: string[] = [sample.id.padEnd(38)]
    for (const name of ['plain', 'port'] as const) {
      const got = classify(sample.forms[name], sample.dpr)
      totals[name].agrees += got.agrees
      totals[name].within += got.within
      totals[name].differs += got.differs
      const width = sample.forms[name].width
      line.push(`${name}: ${got.agrees}/${got.within}/${got.differs}${got.noRect > 0 ? ` (no rect ${got.noRect})` : ''} of ${sample.forms[name].clusters.length}, total ${width.toFixed(4)} dom ${sample.domWidth.toFixed(4)}` +
        (got.worst.length > 0 ? ` first off at ${got.worst[0]!.start}: canvas ${got.worst[0]!.canvas.toFixed(4)} dom ${got.worst[0]!.dom.toFixed(4)}` : ''))
    }
    if (!sample.textMatches) line.push('DOM TEXT DIFFERS FROM THE SAMPLE')
    console.log(line.join(' | '))
  }
  console.log(`totals agrees/within/differs: plain ${totals.plain.agrees}/${totals.plain.within}/${totals.plain.differs}; port ${totals.port.agrees}/${totals.port.within}/${totals.port.differs}`)
}

for (const id of ['text-clusters-attack/storage', 'text-clusters-attack/one-byte-glyphs', 'text-clusters-attack/float', 'text-clusters-attack/no-advance', 'text-clusters-attack/long-item', 'text-clusters-attack/chat-cost']) {
  console.log(`\n== ${id}`)
  const value = valueOf(id) as Record<string, unknown> | null
  if (value === null) { console.log('no value'); continue }
  if (id.endsWith('/storage')) {
    const samples = value['samples'] as Array<{ id: string; font: string; widthsDiffer: boolean; clustersDiffer: boolean; clusterCounts: [number, number]; firstShapingAnswersBoth: boolean; alone: { oneByte: { width: number }; twoByte: { width: number } } }>
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!
      console.log(`${s.id.padEnd(22)} ${s.font.padEnd(28)} one-byte ${s.alone.oneByte.width.toFixed(3)} two-byte ${s.alone.twoByte.width.toFixed(3)} widths differ ${s.widthsDiffer}, clusters differ ${s.clustersDiffer} (${s.clusterCounts.join(' / ')}), first shaping answers both ${s.firstShapingAnswersBoth}`)
    }
  } else if (id.endsWith('/one-byte-glyphs')) {
    const families = value['families'] as Array<{ family: string; asked: number; odd: Array<{ cp: string; clusters: number[][] }>; pairs: Array<{ text: string; clusters: number[][] }> }>
    for (let i = 0; i < families.length; i++) {
      const f = families[i]!
      console.log(`${f.family.padEnd(24)} odd ${f.odd.length} of ${f.asked}${f.odd.length > 0 ? ': ' + f.odd.slice(0, 6).map(o => `U+${o.cp} ${JSON.stringify(o.clusters.map(c => [c[0], c[1]]))}`).join('; ') : ''}${f.pairs.length > 0 ? ' | merged: ' + f.pairs.map(p => `${p.text} ${JSON.stringify(p.clusters.map(c => [c[0], c[1]]))}`).join('; ') : ''}`)
    }
  } else if (id.endsWith('/float')) {
    const samples = value['samples'] as Array<Record<string, unknown>>
    for (let i = 0; i < samples.length; i++) console.log(JSON.stringify(samples[i]))
  } else if (id.endsWith('/no-advance')) {
    const families = value['families'] as Array<{ family: string; rows: Array<{ cp: string; form: string; reported: boolean; advance: number | null }> }>
    for (let i = 0; i < families.length; i++) {
      const f = families[i]!
      const reported = f.rows.filter(r => r.reported)
      console.log(`${f.family.padEnd(24)} reported ${reported.length} of ${f.rows.length}: ${reported.map(r => `U+${r.cp} ${r.form} ${r.advance}`).join('; ')}`)
    }
  } else console.log(JSON.stringify(value))
}
