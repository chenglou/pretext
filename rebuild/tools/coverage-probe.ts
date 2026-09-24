// Which characters of a text a face draws itself, by the two-fallback test (src/measure/font-checks.ts `draws`): a
// character drawn otherwise under `<face>, monospace` than under `<face>, serif` is drawn by a generic, so the face lacks
// it; where the generics alone agree too the test can't tell. Also each word of the text, with its trailing space,
// measured alone and after as many words before it as keep the string below 250px (exact in float32), where the two differ.
//
//   COVERAGE=<entries.json> bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/coverage-probe.ts --out=<dir>
//
// entries.json: [{ family, size, weight?, style?, text, lang? }], family as CSS writes it (quoted where it needs quotes).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
function width(font, text) { ctx.font = font; return ctx.measureText(text).width; }
const out = [];
for (let n = 0; n < ENTRIES.length; n++) {
  const e = ENTRIES[n];
  const head = (e.style ?? 'normal') + ' ' + (e.weight ?? 400) + ' ' + e.size + 'px ';
  const seen = new Set();
  const lacks = [];
  const unknown = [];
  for (const ch of e.text) {
    if (seen.has(ch) || ch === ' ') continue;
    seen.add(ch);
    if (width(head + e.family + ', monospace', ch) !== width(head + e.family + ', serif', ch)) lacks.push(ch);
    else if (width(head + 'monospace', ch) === width(head + 'serif', ch)) unknown.push(ch);
  }
  const words = [];
  const font = head + e.family;
  const whole = e.text;
  const starts = [0];
  for (let i = 0; i < whole.length; i++) if (whole[i] === ' ' && i + 1 < whole.length) starts.push(i + 1);
  for (let w = 0; w < starts.length; w++) {
    const start = starts[w];
    const end = w + 1 < starts.length ? starts[w + 1] : whole.length;
    const word = whole.slice(start, end);
    const alone = width(font, word);
    let from = w;
    while (from > 0 && width(font, whole.slice(starts[from - 1], end)) < 250) from--;
    if (from === w) continue;
    const before = whole.slice(starts[from], start);
    const inText = width(font, before + word) - width(font, before);
    if (alone !== inText) words.push({ word, start, before, alone, inText });
  }
  out.push({ entry: e, lacks, unknown, words });
}
return out;
`

export default async function coverageProbes(): Promise<Probe[]> {
  const entriesPath = process.env['COVERAGE']
  if (entriesPath === undefined) throw new Error('COVERAGE names the entries file')
  const constants = `const ENTRIES = ${readFileSync(resolve(entriesPath), 'utf8')};`
  return [{
    id: 'coverage C1', spec: 'which characters of a text a face draws itself (two-fallback test), and the words that measure otherwise alone than in the text', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${constants}\n${BODY}` }],
  }]
}
