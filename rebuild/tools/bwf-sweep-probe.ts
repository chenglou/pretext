// A width sweep of chosen lab cases in the real browser: the base's and the head's plain lines at every width from
// SWEEP_FROM to SWEEP_TO px in steps of SWEEP_STEP px (and the head's first lines' own widths with one LayoutUnit to either
// side at each), the widths where they differ, and the premises' gaps the head's inspected paragraph reports at a few
// widths, with their details. For the cases tools/bwf-constructed-probe.ts found reporting a gap or differing.
//
//   SWEEP_TREE_A=<base checkout> SWEEP_TREE_B=<head checkout> SWEEP_CASES=<cases.ndjson> [SWEEP_FROM=20] [SWEEP_TO=700]
//     [SWEEP_STEP=0.125] bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/bwf-sweep-probe.ts --out=<dir>
//     --probe-timeout-ms=6000000 --stall-ms=6000000 [--chrome-args=--force-device-scale-factor=N]   (a Chrome slot)
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { ENTRY } from './bwf-constructed-probe.ts'

const BODY = String.raw`
const A = globalThis.conTreeA, B = globalThis.conTreeB;
const envA = A.environment(), envB = B.environment();
const zoom = window.devicePixelRatio;
const PREMISES = ['context-past-a-word', 'positions-run-backwards', 'nested-window-wider'];
const out = [];
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const slots = c.inline?.lineSlots ?? [];
  const row = { id: c.id, family: c.family, layouts: 0, differ: 0, differing: [], gaps: [] };
  const pa = A.paragraphOf(c), pb = B.paragraphOf(c);
  const qa = A.prepare(pa, envA, false, A.createContextPool()), qb = B.prepare(pb, envB, false, B.createContextPool());
  const widths = [];
  for (let w = FROM; w <= TO; w += STEP) widths.push(w);
  const seen = new Set(widths);
  for (let w = 0; w < widths.length; w++) {
    const width = widths[w];
    const la = A.lines(qa, width, slots, null), lb = B.lines(qb, width, slots, null);
    row.layouts++;
    if (JSON.stringify(la) !== JSON.stringify(lb)) {
      row.differ++;
      let l = 0;
      while (l < la.length && l < lb.length && JSON.stringify(la[l]) === JSON.stringify(lb[l])) l++;
      if (row.differing.length < 200) row.differing.push({ width, line: l, base: la[l] ?? null, head: lb[l] ?? null, baseLines: la.length, headLines: lb.length });
    }
    if (w % 97 === 0) for (let l = 0; l < lb.length && l < 6; l++) for (let d = -1; d <= 1; d++) {
      if (lb[l].length < 4) continue;
      const at = (lb[l][3] + d) / 64 / zoom;
      if (at > 0 && !seen.has(at)) { seen.add(at); widths.push(at); }
    }
  }
  for (const width of INSPECT) {
    const gaps = new Set(), details = new Set();
    const qi = B.prepare(pb, envB, true, B.createContextPool());
    B.lines(qi, width, slots, gaps, details);
    for (const d of details) { const g = JSON.parse(d); if (PREMISES.includes(g.gap) && row.gaps.length < 30) row.gaps.push({ width, ...g }); }
  }
  out.push(row);
  await new Promise(r => setTimeout(r, 0));
}
return { devicePixelRatio: zoom, from: FROM, to: TO, step: STEP, cases: out };
`

export default async function bwfSweepProbes(): Promise<Probe[]> {
  const treeA = process.env['SWEEP_TREE_A']
  const treeB = process.env['SWEEP_TREE_B']
  const casesPath = process.env['SWEEP_CASES']
  if (treeA === undefined || treeB === undefined || casesPath === undefined) throw new Error('SWEEP_TREE_A, SWEEP_TREE_B and SWEEP_CASES name the two checkouts and the cases file')
  const dir = mkdtempSync(join(tmpdir(), 'bwf-sweep-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string]> = [[resolve(treeA), 'conTreeA'], [resolve(treeB), 'conTreeB']]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const byLang = new Map<string, unknown[]>()
  for (const line of readFileSync(resolve(casesPath), 'utf8').split('\n')) {
    if (line === '') continue
    const c = JSON.parse(line) as { pageLang: string }
    let list = byLang.get(c.pageLang)
    if (list === undefined) byLang.set(c.pageLang, list = [])
    list.push(c)
  }
  const constants = `const FROM = ${Number(process.env['SWEEP_FROM'] ?? 20)};\nconst TO = ${Number(process.env['SWEEP_TO'] ?? 700)};\nconst STEP = ${Number(process.env['SWEEP_STEP'] ?? 0.125)};\nconst INSPECT = [97.3, 143, 250.5, 411];`
  const probes: Probe[] = []
  for (const [lang, cases] of byLang) {
    probes.push({
      id: `bwf-sweep ${lang}`, spec: 'a width sweep of chosen cases: the base and the head of Blink\'s port, plain lines compared, and the premises\' gaps with details', pageLang: lang, html: '<div></div>',
      observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\n${constants}\nconst CASES = ${JSON.stringify(cases)};\n${BODY}` }],
    })
  }
  return probes
}
