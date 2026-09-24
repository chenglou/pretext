// Whether a combining mark earlier in a Canvas string changes the width of what follows it, per face: for every family
// and variant, a sample of kerned pairs S measured alone and after `e` with U+0301 (and after the precomposed `é`, as a
// control), words apart by U+2028 as the port's strings are (shape.ts canvasString). In italic Athelas the mark takes the
// kern of `h` and `ở` away (the words-first fix round, 2026-09-23); this looks for every face that does something alike.
// K2 measures consonants before `ở` and its kin in regular and italic Athelas alone and after six mark prefixes: `e`
// with U+0301, `a` with U+0300 and `o` with U+031B, each before U+2028, U+0301 alone before U+2028, `e` with U+0301 with
// no U+2028, and `e` with U+0301 three words back.
//
//   MARK_KERN_FONTS=<families.json> bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/mark-kern-probe.ts --out=<dir>
//
// families.json: a list of family names as the fonts attack's lists write them (a generic keyword starts with `!`).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const LS = ' ';
const SAMPLES = ['To' + LS + 'AV' + LS + 'Wa' + LS + 'Ya' + LS + 'Te' + LS + 'fo' + LS + 'hở' + LS + 'kỹ' + LS + 'Vo' + LS + 'ry', 'phở' + LS + 'Tür' + LS + 'Øy', 'The' + LS + 'office' + LS + 'waffle'];
const MARKED = 'é' + LS;
const COMPOSED = 'é' + LS;
const VARIANTS = [['normal', 400], ['italic', 400], ['italic', 200], ['normal', 700], ['italic', 700]];
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
function w(font, s) { ctx.font = font; return ctx.measureText(s).width; }
const out = [];
for (let f = 0; f < FAMILIES.length; f++) {
  const name = FAMILIES[f];
  const css = name.startsWith('!') ? name.slice(1) : '"' + name.replace(/"/g, '\\"') + '"';
  for (let v = 0; v < VARIANTS.length; v++) {
    const font = VARIANTS[v][0] + ' ' + VARIANTS[v][1] + ' 32px ' + css;
    const found = [];
    for (let s = 0; s < SAMPLES.length; s++) {
      const S = SAMPLES[s];
      const alone = w(font, S);
      const afterMark = w(font, MARKED + S) - w(font, MARKED);
      const afterComposed = w(font, COMPOSED + S) - w(font, COMPOSED);
      if (afterMark !== alone || afterComposed !== alone) found.push({ sample: s, alone, afterMark, afterComposed });
    }
    if (found.length > 0) out.push({ family: name, style: VARIANTS[v][0], weight: VARIANTS[v][1], found });
  }
}
return { families: FAMILIES.length, variants: VARIANTS.length, faces: out };
`

const PAIRS = String.raw`
const LS = '\u2028';
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
function w(f, s) { ctx.font = f; return ctx.measureText(s).width; }
const pairs = ['AV', 'To', 'hở', 'hơ', 'ho', 'hỏ', 'nở', 'mở', 'tở', 'kở', 'rở', 'vở', 'xở', 'cở', 'gở', 'hờ', 'hợ', 'hư', 'sở', 'lở', 'bở'];
const marks = ['e\u0301' + LS, 'a\u0300' + LS, 'o\u031b' + LS, '\u0301' + LS, 'e\u0301', 'x' + LS + 'e\u0301' + LS + 'y' + LS + 'z' + LS];
const out = [];
for (const f of ['normal 400 32px Athelas', 'italic 400 32px Athelas']) {
  const rows = [];
  for (const p of pairs) {
    const alone = w(f, p);
    rows.push({ pair: p, alone, after: marks.map(m => w(f, m + p) - w(f, m) - alone) });
  }
  out.push({ font: f, rows });
}
return out;
`

export default async function markKernProbes(): Promise<Probe[]> {
  const path = process.env['MARK_KERN_FONTS']
  if (path === undefined) throw new Error('MARK_KERN_FONTS names the families file')
  const constants = `const FAMILIES = ${readFileSync(resolve(path), 'utf8')};`
  return [{
    id: 'mark-kern K1', spec: 'whether a combining mark earlier in a Canvas string changes the width of what follows it, per family and variant', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${constants}\n${BODY}` }],
  }, {
    id: 'mark-kern K2', spec: 'consonants before o with the horn and the hook in Athelas, alone and after a combining mark earlier in the string', pageLang: 'vi', html: '<div></div>',
    observe: [{ kind: 'script', source: PAIRS }],
  }]
}
