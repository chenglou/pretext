// The premises of words first and the cut predictor in Blink's port, asked of Canvas directly on the machine's font families,
// with no library in the page. Not a test: counts and examples for the person who runs it.
//
//   BWF_FONTS=<families.json> [BWF_SIZES=16,32] [BWF_WEIGHTS=400,700] bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/tools/bwf-premise-probe.ts --out=<dir> --probe-timeout-ms=20000000 --stall-ms=20000000
//
// Per family that resolves, size and weight:
// - `nested`: the cut predictor's premise, that a string is never narrower than a window inside it (shape.ts
//   predictedWindow). From every BWF_STRIDE-th word start (2) and from four more grapheme starts of each text, the string grows
//   one grapheme at a time up to BWF_GROW graphemes (40), and from every such start's end it shrinks from the left the same way: each step that
//   measures narrower than the string before it is a window wider than the string around it. Counted with the largest
//   drop in px and a few examples. The strings are the text's own, as JavaScript slices them (8-bit where the slice is
//   Latin-1).
// - `spaces`: whether the space's advance depends on the script Canvas resolves for it, as Euphemia UCAS's does (DESIGN.md
//   §4.6, "What V3 lost in Euphemia UCAS"): U+0020 alone (an 8-bit string, shaped as one Latin segment), U+2028 alone (a
//   16-bit string that resolves as Common, the port's stand-in for a space in a 16-bit string), and U+2028 between two
//   letters of each of Latin, Cyrillic, Greek, Arabic, Hebrew and Devanagari less the two letters alone.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { TEXTS } from './bwf-fonts-probe.ts'

const BODY = String.raw`
// A context per family and size: Chrome keeps every string a canvas shaped, and one context over every family grew the
// renderer past 9 GB.
let context = new OffscreenCanvas(1, 1).getContext('2d');
const width = (text) => context.measureText(text).width;
const SAMPLE = 'mmmmmmmmmmlliWAVA fi 123';
const measuredAt = (font, text) => { context.font = font; return context.measureText(text).width; };
const resolves = (family) => measuredAt('72px ' + family + ', monospace', SAMPLE) !== measuredAt('72px monospace', SAMPLE) || measuredAt('72px ' + family + ', serif', SAMPLE) !== measuredAt('72px serif', SAMPLE);
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const starts = TEXTS.map(given => { const out = []; for (const s of segmenter.segment(given.text)) out.push(s.index); out.push(given.text.length); return out; });
const LETTERS = [['latin', 'n', 'o'], ['latin-caps', 'H', 'T'], ['cyrillic', 'н', 'о'], ['greek', 'ν', 'ο'], ['arabic', 'ب', 'ب'], ['hebrew', 'נ', 'ו'], ['devanagari', 'न', 'म']];
const out = [];
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  const row = { family: FONTS[f], resolves: true, nested: { steps: 0, drops: 0, largestPx: 0, byText: {}, examples: [] }, spaces: [] };
  for (let w = 0; w < WEIGHTS.length; w++) for (let z = 0; z < SIZES.length; z++) {
    const size = SIZES[z], weight = WEIGHTS[w];
    context = new OffscreenCanvas(1, 1).getContext('2d');
    context.font = weight + ' ' + size + 'px ' + family;
    // ---- spaces ----
    const sp = { weight, size, u0020: width(' '), u2028: width(' '), inRuns: {} };
    for (let l = 0; l < LETTERS.length; l++) {
      const [name, a, b] = LETTERS[l];
      sp.inRuns[name] = width(a + ' ' + b) - width(a + b);
    }
    row.spaces.push(sp);
    // ---- nested ----
    for (let t = 0; t < TEXTS.length * 2; t++) {
      // Each text twice: as JavaScript slices it, and with U+2028 for U+0020, as the port writes a segmented paragraph's
      // strings so that Canvas doesn't measure the words apart (shape.ts canvasString).
      const lined = t >= TEXTS.length;
      const text = lined ? TEXTS[t - TEXTS.length].text.replaceAll(' ', ' ') : TEXTS[t].text, marks = starts[t % TEXTS.length];
      const name = TEXTS[t % TEXTS.length].name + (lined ? '/u2028' : '');
      const from = new Set();
      for (let i = 0, words = 0; i < marks.length - 1; i++) if (i === 0 || (text.charCodeAt(marks[i] - 1) === 0x20 || text.charCodeAt(marks[i] - 1) === 0x2028)) { if (words++ % STRIDE === 0) from.add(i); }
      for (let i = 0; i < 4; i++) from.add(Math.floor((i + 0.5) * (marks.length - 1) / 4));
      for (const i of from) {
        let last = 0;
        const end = Math.min(marks.length - 1, i + GROW);
        for (let j = i + 1; j <= end; j++) {
          const now = width(text.slice(marks[i], marks[j]));
          row.nested.steps++;
          if (now < last) {
            row.nested.drops++;
            row.nested.byText[name] = (row.nested.byText[name] ?? 0) + 1;
            if (last - now > row.nested.largestPx) row.nested.largestPx = last - now;
            if (row.nested.examples.length < 12) row.nested.examples.push({ weight, size, text: name, grows: 'right', outer: text.slice(marks[i], marks[j]), inner: text.slice(marks[i], marks[j - 1]), outerPx: now, innerPx: last });
          }
          last = now;
        }
        last = 0;
        for (let j = end - 1; j >= i; j--) {
          const now = width(text.slice(marks[j], marks[end]));
          row.nested.steps++;
          if (now < last) {
            row.nested.drops++;
            row.nested.byText[name] = (row.nested.byText[name] ?? 0) + 1;
            if (last - now > row.nested.largestPx) row.nested.largestPx = last - now;
            if (row.nested.examples.length < 12) row.nested.examples.push({ weight, size, text: name, grows: 'left', outer: text.slice(marks[j], marks[end]), inner: text.slice(marks[j + 1], marks[end]), outerPx: now, innerPx: last });
          }
          last = now;
        }
      }
    }
  }
  out.push(row);
  if (f % 4 === 3) await new Promise(r => setTimeout(r, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, sizes: SIZES, weights: WEIGHTS, fonts: out };
`

export default async function bwfPremiseProbes(): Promise<Probe[]> {
  const fontsPath = process.env['BWF_FONTS']
  if (fontsPath === undefined) throw new Error('BWF_FONTS names the families file')
  const sizes = (process.env['BWF_SIZES'] ?? '16,32').split(',').map(Number)
  const weights = (process.env['BWF_WEIGHTS'] ?? '400').split(',').map(Number)
  const constants = `const FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(TEXTS)};\nconst SIZES = ${JSON.stringify(sizes)};\nconst WEIGHTS = ${JSON.stringify(weights)};\nconst STRIDE = ${Number(process.env['BWF_STRIDE'] ?? 2)};\nconst GROW = ${Number(process.env['BWF_GROW'] ?? 40)};`
  return [{
    id: 'bwf-premises P1', spec: 'the premises of words first and the cut predictor asked of Canvas directly: nested windows and the space by script', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${constants}\n${BODY}` }],
  }]
}
