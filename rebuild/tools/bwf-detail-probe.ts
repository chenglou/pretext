// The detail of a few layouts tools/bwf-fonts-probe.ts scored: both trees' lines, cuts and prefixes, the positions at every
// cut of either tree and at each line end, and Chrome's own lines, so a loss can be traced to the read that moved it.
//
//   BWF_TREE_A=<base> BWF_TREE_B=<head> BWF_DETAIL=<entries.json> bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/tools/bwf-detail-probe.ts --out=<dir> [--chrome-args=--force-device-scale-factor=1]
//
// entries.json: [{ family, variant: '400:normal', size, text: <a probe text's name> | paragraph: <text>, style, width }],
// family as in a families file (a generic keyword starts with `!`), style one of the probe's style names.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { ENTRY, NATIVE, TEXTS } from './bwf-fonts-probe.ts'

const BODY = String.raw`
const A = globalThis.bwfA, B = globalThis.bwfB;
const envA = A.environment(), envB = B.environment();
const zoom = window.devicePixelRatio;
${NATIVE}
const PLAIN = { name: 'plain', letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', textAlign: 'start', textIndent: 0, flip: false, spanEvery: 0, spanPadding: 0 };
const STYLES = {
  'plain': PLAIN, 'letter-spacing': { ...PLAIN, letterSpacing: 1.5 }, 'word-spacing': { ...PLAIN, wordSpacing: 4 }, 'negative-word-spacing': { ...PLAIN, wordSpacing: -2 },
  'pre-wrap': { ...PLAIN, whiteSpace: 'pre-wrap' }, 'break-spaces': { ...PLAIN, whiteSpace: 'break-spaces' }, 'justify-indent': { ...PLAIN, textAlign: 'justify', textIndent: 17.5 },
  'other-direction': { ...PLAIN, flip: true }, 'spans': { ...PLAIN, spanEvery: 3 }, 'padded-spans': { ...PLAIN, spanEvery: 2, spanPadding: 3 },
};
const styleOf = (name) => {
  if (STYLES[name]) return STYLES[name];
  const m = /^(?:ls(-?[\d.]+))?(?:ws(-?[\d.]+))?$/.exec(name);
  return { ...PLAIN, letterSpacing: Number(m[1] ?? 0), wordSpacing: Number(m[2] ?? 0) };
};
const out = [];
for (let e = 0; e < DETAIL.length; e++) {
  const d = DETAIL[e];
  const family = d.family.startsWith('!') ? d.family.slice(1) : '"' + d.family + '"';
  const given = TEXTS.find(t => t.name === d.text);
  const text = d.paragraph ?? given.text;
  const [weight, fontStyle] = (d.variant ?? '400:normal').split(':');
  const style = styleOf(d.style ?? 'plain');
  const pa = A.paragraphOf(family, d.size, Number(weight), fontStyle, text, given.lang, given.rtl, style);
  const a = A.prepare(pa, envA, A.createContextPool());
  const b = B.prepare(B.paragraphOf(family, d.size, Number(weight), fontStyle, text, given.lang, given.rtl, style), envB, B.createContextPool());
  const la = A.lines(a, d.width), lb = B.lines(b, d.width);
  const native = nativeLayout(pa, d.width);
  const ga = A.groupsOf(a), gb = B.groupsOf(b);
  const groups = [];
  for (let g = 0; g < gb.groups.length; g++) {
    const edges = new Set([...ga.groups[g].cuts, ...gb.groups[g].cuts]);
    // Every offset within four of a line end where the two trees' lines part.
    for (let l = 0; l < Math.min(la.length, lb.length); l++) {
      if (la[l][1] === lb[l][1] && la[l][0] === lb[l][0]) continue;
      for (let k = Math.min(la[l][1], lb[l][1]) - 4; k <= Math.max(la[l][1], lb[l][1]) + 4; k++) edges.add(k);
      break;
    }
    for (let l = 0; l < la.length; l++) { edges.add(la[l][1]); edges.add(la[l][0]); }
    for (let l = 0; l < lb.length; l++) { edges.add(lb[l][1]); edges.add(lb[l][0]); }
    const positions = [];
    for (const k of Array.from(edges).sort((x, y) => x - y)) {
      if (k <= gb.groups[g].start || k >= gb.groups[g].end) continue;
      positions.push([k, A.position16(a, g, k), B.position16(b, g, k), text.slice(Math.max(0, k - 6), k) + '|' + text.slice(k, k + 6), A.pair16(a, g, k), B.pair16(b, g, k), A.wide16(a, g, k), B.wide16(b, g, k)]);
    }
    groups.push({ start: gb.groups[g].start, end: gb.groups[g].end, baseCuts: ga.groups[g].cuts, basePrefix: ga.groups[g].prefix, headCuts: gb.groups[g].cuts, headPrefix: gb.groups[g].prefix, positions });
  }
  const nativeStarts = [];
  for (let c = 0, last = -1; c < native.lineOf.length; c++) if (native.lineOf[c][1] > last) { last = native.lineOf[c][1]; nativeStarts.push([native.lineOf[c][0], last]); }
  out.push({ entry: d, zoom, text, base: la, head: lb, baseScore: scoreLines(la, native), headScore: scoreLines(lb, native), nativeCount: native.count, nativeStarts, groups });
}
host.remove();
return out;
`

export default async function bwfDetailProbes(): Promise<Probe[]> {
  const treeA = process.env['BWF_TREE_A']
  const treeB = process.env['BWF_TREE_B']
  const detailPath = process.env['BWF_DETAIL']
  if (treeA === undefined || treeB === undefined || detailPath === undefined) throw new Error('BWF_TREE_A, BWF_TREE_B and BWF_DETAIL name the two checkouts and the entries file')
  const dir = mkdtempSync(join(tmpdir(), 'bwf-detail-probe-'))
  const bundles: string[] = []
  const sides: Array<[string, string]> = [[resolve(treeA), 'bwfA'], [resolve(treeB), 'bwfB']]
  for (let i = 0; i < sides.length; i++) {
    const entry = join(dir, `${sides[i]![1]}.ts`)
    writeFileSync(entry, ENTRY(sides[i]![0], sides[i]![1]))
    const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
    bundles.push(await built.outputs[0]!.text())
  }
  const constants = `const DETAIL = ${readFileSync(resolve(detailPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};`
  return [{
    id: 'bwf-detail D1', spec: 'the detail of layouts the fonts probe scored: both trees\' cuts, prefixes, positions and lines, and Chrome\'s lines', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\n${constants}\n${BODY}` }],
  }]
}
