// Totals of a cut fonts probe run (cut-fonts-ko-probe.ts): families that resolve, layouts, and the families whose lines,
// cuts or positions differ between the base and the knockout, with their counts; writes <dir>/summary.json.
//   bun rebuild/tools/audit/fonts-summary.ts <probe run dir>...
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Row = { family: string; resolves: boolean; layouts?: number; lines?: number; cuts?: number; cutsDiffer?: number; positionsDiffer?: number; differ?: number; differNearCut?: number; nearCut?: number; errors?: number; examples?: unknown[] }
for (const dir of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(join(dir, 'chrome-probes.json'), 'utf8')) as { status: string; results: Array<{ result: { observations: Array<{ value: { fonts: Row[] } }>; errors?: unknown[] } }> }
  const fonts = report.results[0]!.result.observations[0]!.value.fonts
  const totals = { resolve: 0, layouts: 0, lines: 0, cuts: 0, cutsDiffer: 0, positionsDiffer: 0, differ: 0, differNearCut: 0, errors: 0 }
  const differing: Row[] = []
  for (const f of fonts) {
    if (!f.resolves) continue
    totals.resolve++
    totals.layouts += f.layouts ?? 0; totals.lines += f.lines ?? 0; totals.cuts += f.cuts ?? 0; totals.cutsDiffer += f.cutsDiffer ?? 0
    totals.positionsDiffer += f.positionsDiffer ?? 0; totals.differ += f.differ ?? 0; totals.differNearCut += f.differNearCut ?? 0; totals.errors += f.errors ?? 0
    if ((f.differ ?? 0) > 0) differing.push(f)
  }
  differing.sort((a, b) => (b.differ ?? 0) - (a.differ ?? 0))
  const summary = { status: report.status, totals, familiesWithDifferences: differing.map(f => ({ family: f.family, differ: f.differ, layouts: f.layouts, cutsDiffer: f.cutsDiffer, examples: f.examples?.slice(0, 2) })) }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1))
  console.log(`${dir}: ${report.status}; ${totals.resolve} families, ${totals.layouts} layouts, ${totals.differ} differ (${totals.differNearCut} near a cut), groups with other cuts ${totals.cutsDiffer}, errors ${totals.errors}`)
  console.log(`  families with differing lines (${differing.length}): ${differing.slice(0, 25).map(f => `${f.family} ${f.differ}/${f.layouts}`).join(', ')}`)
}
