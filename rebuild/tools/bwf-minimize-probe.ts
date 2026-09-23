// Minimal repros for layouts tools/bwf-fonts-probe.ts scored as the head's losses: for each entry, the paragraph and every
// run of its words (up to 12 words, from every word start), each laid out by both trees at widths one LayoutUnit apart
// across the range where the paragraph's lines move, and judged by Chrome. Reports per entry the shortest runs with a loss.
//
//   BWF_TREE_A=<base> BWF_TREE_B=<head> BWF_DETAIL=<entries.json> bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/tools/bwf-minimize-probe.ts --out=<dir> [--chrome-args=--force-device-scale-factor=3]
//
// entries.json as tools/bwf-detail-probe.ts takes, with optional `maxWords` (12) and `span` (the widths tried: from the
// entry's width less `span` px to it plus `span`, default 12).
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
  const full = d.paragraph ?? given.text;
  const [weight, fontStyle] = (d.variant ?? '400:normal').split(':');
  const style = styleOf(d.style ?? 'plain');
  const words = full.split(' ');
  const maxWords = d.maxWords ?? 12;
  const candidates = [full];
  for (let n = 2; n <= maxWords; n++) for (let s = 0; s + n <= words.length; s++) candidates.push(words.slice(s, s + n).join(' '));
  const found = [];
  let tried = 0;
  for (let c = 0; c < candidates.length && found.length < 6; c++) {
    const text = candidates[c];
    const pa = A.paragraphOf(family, d.size, Number(weight), fontStyle, text, given.lang, given.rtl, style);
    const a = A.prepare(pa, envA, A.createContextPool());
    const b = B.prepare(B.paragraphOf(family, d.size, Number(weight), fontStyle, text, given.lang, given.rtl, style), envB, B.createContextPool());
    // The widths: every LayoutUnit across the span around the entry's width, and around each of the head's line widths at it.
    const span = d.span ?? 12;
    const unit = 1 / 64 / zoom;
    const widths = new Set();
    const centers = [d.width];
    const lb0 = B.lines(b, d.width);
    for (let l = 0; l < lb0.length; l++) centers.push(lb0[l][3] / 64 / zoom);
    for (let i = 0; i < centers.length; i++) for (let k = -3; k <= 3; k++) widths.add(Math.round((centers[i] + k * unit) * 64 * zoom) / 64 / zoom);
    if (c > 0) for (let w = Math.max(unit, d.width - span); w <= d.width + span; w += 0.25) widths.add(Math.round(w * 64 * zoom) / 64 / zoom);
    for (const width of widths) {
      if (width <= 0) continue;
      tried++;
      const la = A.lines(a, width), lb = B.lines(b, width);
      if (JSON.stringify(la) === JSON.stringify(lb)) continue;
      const native = nativeLayout(pa, width);
      const sa = scoreLines(la, native), sb = scoreLines(lb, native);
      if (sa.breaks && !sb.breaks) { found.push({ text, words: text.split(' ').length, width, base: la, head: lb, headFirst: sb.first, nativeCount: native.count }); break; }
    }
  }
  found.sort((x, y) => x.text.length - y.text.length);
  out.push({ entry: d, zoom, tried, found });
}
host.remove();
return out;
`

export default async function bwfMinimizeProbes(): Promise<Probe[]> {
  const treeA = process.env['BWF_TREE_A']
  const treeB = process.env['BWF_TREE_B']
  const detailPath = process.env['BWF_DETAIL']
  if (treeA === undefined || treeB === undefined || detailPath === undefined) throw new Error('BWF_TREE_A, BWF_TREE_B and BWF_DETAIL name the two checkouts and the entries file')
  const dir = mkdtempSync(join(tmpdir(), 'bwf-minimize-probe-'))
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
    id: 'bwf-minimize M1', spec: 'the shortest runs of words where the head loses a line the base and Chrome agree on', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundles[0]!}\n${bundles[1]!}\n${constants}\n${BODY}` }],
  }]
}
