// The identity the cut of a wide group rests on (shape.ts addPieces, measureGroups), asked of the real browser's Canvas
// in every font family of a list: does a group equal its pieces plus the adjustment the library puts at each cut?
// Brought over from the words study's identity probe (branch x-spec-words-blink, tools/words-identity-probe.ts), in
// the cut's terms: the library's own bundled module prepares each paragraph of tools/cut-fonts-probe.ts, and its own
// measure16 asks Canvas, so every string is written as the port writes it.
//
//   CUT_TREE_B=<checkout> CUT_FONTS=<families.json> bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/tools/cut-identity-probe.ts --out=<dir> --probe-timeout-ms=3000000 --stall-ms=3000000 \
//     [--chrome-args=--force-device-scale-factor=1]        (a Chrome slot of the browser lock; counts, no times)
//
// Two questions, in 16.16 units at the zoomed size.
// - The whole: W(group) against the last position (the pieces' totals plus every cut's adjustment). A total of 256 zoomed
//   px or more is a float32 that can't hold every 16.16 value, and Blink adds advances as floats, so a small difference
//   says nothing; the report counts the differences by size (a LayoutUnit is 1,024 units).
// - Each cut k, exactly: d is the adjustment the library put there (the position at the cut, less the position at the cut
//   before, less the piece between them). Two other windows around k, each below 256 zoomed px and so exact, must show
//   the same d if nothing but d crosses the cut: one that reaches back to the cut before k and two clusters past k, one
//   that starts two clusters before k and reaches the cut after it (each shrunk from its far end until it is exact). A
//   window's adjustment is W(window) - W(window before k) - W(window after k). The library's own windows are the pair
//   (one cluster a side) and the widest exact one between the cuts around k, shrunk on its longer side; `safe` counts the
//   cuts where both of those show 0.
// Per family: groups cut, cuts, safe cuts, cuts with d other than 0, windows tried and off (at safe cuts and at others),
// the largest difference, the whole's differences by size, and a few examples.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { ENTRY, SIZES, TEXTS } from './cut-fonts-probe.ts'

const BODY = String.raw`
const B = globalThis.cutTreeB;
const env = B.environment();
const zoom = window.devicePixelRatio;
const EXACT16 = 0x1000000;
const probeContext = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font) => { probeContext.font = font; return probeContext.measureText('mmmmmmmmmmlliWAVA fi 123').width; };
const resolves = (family) => measured('72px ' + family + ', monospace') !== measured('72px monospace') || measured('72px ' + family + ', serif') !== measured('72px serif');
const out = [];
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  const row = { family: FONTS[f], resolves: true, groups: 0, cuts: 0, safeCuts: 0, adjustedCuts: 0, windows: 0, windowsOffAtSafe: 0, windowsOffElsewhere: 0, cutsOffAtSafe: 0, cutsOffElsewhere: 0, largestWindow16: 0, whole: { exact: 0, under8: 0, under64: 0, under1024: 0, from1024: 0, largest16: 0 }, errors: 0, examples: [] };
  for (let t = 0; t < TEXTS.length; t++) for (let z = 0; z < SIZES.length; z++) {
    const text = TEXTS[t].text, size = SIZES[z];
    let c;
    try { c = B.prepare(B.paragraphOf(family, size, text, TEXTS[t].lang, TEXTS[t].rtl), env, []); } catch (error) { row.errors++; continue; }
    const made = B.groupsOf(c);
    const W = (g, from, to) => B.measure16(c, g, from, to);
    const clusterAfter = (k, max) => { let e = k + 1; while (e < max && !B.isClusterBoundary(c, e)) e++; return e; };
    const clusterBefore = (k, min) => { let e = k - 1; while (e > min && !B.isClusterBoundary(c, e)) e--; return e; };
    for (let g = 0; g < made.groups.length; g++) {
      const group = made.groups[g], cuts = group.cuts, prefix = group.prefix;
      if (cuts.length <= 2) continue;
      row.groups++;
      const whole16 = W(g, group.start, group.end), sum16 = prefix[prefix.length - 1];
      const off = Math.abs(whole16 - sum16);
      if (off === 0) row.whole.exact++; else if (off < 8) row.whole.under8++; else if (off < 64) row.whole.under64++; else if (off < 1024) row.whole.under1024++; else row.whole.from1024++;
      if (off > row.whole.largest16) row.whole.largest16 = off;
      if (off >= 1024 && row.examples.length < 6) row.examples.push({ text: TEXTS[t].name, size, group: g, whole16, positions16: sum16, pieces: cuts.length - 1 });
      for (let i = 1; i + 1 < cuts.length; i++) {
        const k = cuts[i], from = cuts[i - 1], to = cuts[i + 1];
        row.cuts++;
        const d = prefix[i] - prefix[i - 1] - W(g, from, k);
        const pair = B.pair16(c, g, k), wide = B.wide16(c, g, k);
        const safe = pair === 0 && wide === 0;
        if (safe) row.safeCuts++;
        if (d !== 0) row.adjustedCuts++;
        // Back to the cut before k and two clusters past k.
        let a = from, b = clusterAfter(clusterAfter(k, to), to);
        if (b > to) b = to;
        while (W(g, a, b) >= EXACT16 && a < clusterBefore(k, from)) { let next = clusterBefore(a + ((k - a + 3) >> 2) + 1, a); if (next <= a) next = clusterAfter(a, k); a = next; }
        const back = W(g, a, b) < EXACT16 ? W(g, a, b) - W(g, a, k) - W(g, k, b) : null;
        const backWindow = [a, b];
        // Two clusters before k and on to the cut after k.
        a = clusterBefore(clusterBefore(k, from), from); b = to;
        if (a < from) a = from;
        while (W(g, a, b) >= EXACT16 && b > clusterAfter(k, to)) { let next = clusterAfter(b - ((b - k + 3) >> 2) - 1, b); if (next >= b) next = clusterBefore(b, k); b = next; }
        const on = W(g, a, b) < EXACT16 ? W(g, a, b) - W(g, a, k) - W(g, k, b) : null;
        let cutOff = false;
        const windows = [back, on];
        for (let n = 0; n < 2; n++) {
          if (windows[n] === null) continue;
          row.windows++;
          const miss = Math.abs(windows[n] - d);
          if (miss === 0) continue;
          cutOff = true;
          if (safe) row.windowsOffAtSafe++; else row.windowsOffElsewhere++;
          if (miss > row.largestWindow16) row.largestWindow16 = miss;
        }
        if (cutOff) {
          if (safe) row.cutsOffAtSafe++; else row.cutsOffElsewhere++;
          if (row.examples.length < 6) row.examples.push({ text: TEXTS[t].name, size, group: g, cut: k, around: text.slice(Math.max(0, k - 8), k) + '|' + text.slice(k, k + 8), d, pair, wide, safe, back, backWindow, on, onWindow: [a, b] });
        }
      }
    }
  }
  out.push(row);
  if (f % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: zoom, texts: TEXTS.length, sizes: SIZES, fonts: out };
`

export default async function cutIdentityProbes(): Promise<Probe[]> {
  const tree = process.env['CUT_TREE_B']
  const fontsPath = process.env['CUT_FONTS']
  if (tree === undefined || fontsPath === undefined) throw new Error('CUT_TREE_B and CUT_FONTS name the checkout and the families file')
  const entry = join(mkdtempSync(join(tmpdir(), 'cut-identity-probe-')), 'cutTreeB.ts')
  writeFileSync(entry, ENTRY(resolve(tree), 'cutTreeB'))
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  return [{
    id: 'cut-identity I1', spec: 'the cut of a wide group: a group against its pieces and the adjustments at its cuts, on the machine\'s font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${await built.outputs[0]!.text()}\nconst FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};\nconst SIZES = ${JSON.stringify(SIZES)};\n${BODY}` }],
  }]
}
