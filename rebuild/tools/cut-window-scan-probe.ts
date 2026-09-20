// A closer look at one cut of a wide group where tools/cut-identity-probe.ts found a window that shows another adjustment
// than the one the library put at the cut: how far does the font's context reach on each side? The library's own bundled
// module prepares the paragraph in the real browser and its measure16 asks Canvas.
//
//   CUT_TREE_B=<checkout> CUT_SCAN=<scan.json> bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/tools/cut-window-scan-probe.ts --out=<dir> [--chrome-args=--force-device-scale-factor=1]
//
// scan.json: [{ "family": "Zapfino", "text": "ligatures", "size": 28, "cut": 101 }, ...], with a family as the fonts file
// writes it and a text of tools/cut-fonts-probe.ts by name. Per entry, in 16.16 units at the zoomed size: the group's
// cuts and positions, the adjustment d the library put at the cut, its pair window and its window between the cuts, and two
// scans. `after`: the window starts one cluster before the cut and ends 1, 2, 3... clusters after it. `before`: it ends one
// cluster after the cut and starts 1, 2, 3... clusters before it. Each entry of a scan is the window, its text, its total
// and its adjustment W(window) - W(window before the cut) - W(window after the cut), while the total stays below 256 zoomed
// px. Beside them every string Canvas was asked for the longest window of the `after` scan, with its width, and every
// string it was asked while the paragraph was prepared, in order (`prepareAsked`): the cut search's own windows.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { ENTRY, TEXTS } from './cut-fonts-probe.ts'

const BODY = String.raw`
const B = globalThis.cutTreeB;
const env = B.environment();
const EXACT16 = 0x1000000;
const asked = [];
let recording = false;
const original = OffscreenCanvasRenderingContext2D.prototype.measureText;
OffscreenCanvasRenderingContext2D.prototype.measureText = function (s) { const m = original.call(this, s); if (recording) asked.push({ codes: Array.from(s, c => c.codePointAt(0).toString(16)).join(' '), font: this.font, width16: Math.round(m.width * 65536) }); return m; };
const out = [];
for (let n = 0; n < SCAN.length; n++) {
  const scan = SCAN[n];
  const given = TEXTS.find(t => t.name === scan.text);
  const family = scan.family.startsWith('!') ? scan.family.slice(1) : '"' + scan.family + '"';
  asked.length = 0;
  recording = true;
  const c = B.prepare(B.paragraphOf(family, scan.size, given.text, given.lang, given.rtl), env, []);
  recording = false;
  const prepareAsked = asked.slice();
  const made = B.groupsOf(c);
  let g = 0;
  while (g + 1 < made.groups.length && made.groups[g].end <= scan.cut) g++;
  const group = made.groups[g], cuts = group.cuts, prefix = group.prefix, k = scan.cut;
  const i = cuts.indexOf(k);
  const W = (from, to) => B.measure16(c, g, from, to);
  const clusterAfter = (o, max) => { let e = o + 1; while (e < max && !B.isClusterBoundary(c, e)) e++; return e; };
  const clusterBefore = (o, min) => { let e = o - 1; while (e > min && !B.isClusterBoundary(c, e)) e--; return e; };
  const row = { scan, devicePixelRatio: window.devicePixelRatio, group: [group.start, group.end], cuts, positions16: prefix, isCut: i > 0, d: i > 0 ? prefix[i] - prefix[i - 1] - W(cuts[i - 1], k) : null, pair: B.pair16(c, g, k), wide: B.wide16(c, g, k), after: [], before: [] };
  const a1 = clusterBefore(k, group.start), b1 = clusterAfter(k, group.end);
  let last = null;
  for (let b = b1, steps = 0; steps < 40; steps++) {
    const total = W(a1, b);
    if (total >= EXACT16) break;
    row.after.push({ window: [a1, b], text: given.text.slice(a1, k) + '|' + given.text.slice(k, b), total16: total, adjust16: total - W(a1, k) - W(k, b) });
    last = b;
    if (b >= group.end) break;
    b = clusterAfter(b, group.end);
  }
  for (let a = a1, steps = 0; steps < 40; steps++) {
    const total = W(a, b1);
    if (total >= EXACT16) break;
    row.before.push({ window: [a, b1], text: given.text.slice(a, k) + '|' + given.text.slice(k, b1), total16: total, adjust16: total - W(a, k) - W(k, b1) });
    if (a <= group.start) break;
    a = clusterBefore(a, group.start);
  }
  if (last !== null) { asked.length = 0; recording = true; W(a1, last); W(a1, k); W(k, last); recording = false; row.asked = asked.slice(); }
  row.prepareAsked = prepareAsked;
  out.push(row);
}
OffscreenCanvasRenderingContext2D.prototype.measureText = original;
return out;
`

export default async function cutWindowScanProbes(): Promise<Probe[]> {
  const tree = process.env['CUT_TREE_B']
  const scanPath = process.env['CUT_SCAN']
  if (tree === undefined || scanPath === undefined) throw new Error('CUT_TREE_B and CUT_SCAN name the checkout and the cuts to scan')
  const entry = join(mkdtempSync(join(tmpdir(), 'cut-window-scan-probe-')), 'cutTreeB.ts')
  writeFileSync(entry, ENTRY(resolve(tree), 'cutTreeB'))
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  return [{
    id: 'cut-window-scan W1', spec: 'the cut of a wide group: how far a font\'s context reaches on each side of one cut', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${await built.outputs[0]!.text()}\nconst SCAN = ${readFileSync(resolve(scanPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};\n${BODY}` }],
  }]
}
