// What one Canvas call costs in Firefox, by what it is asked: the measurements beside a reading of Gecko's measureText
// (dom/canvas/CanvasRenderingContext2D.cpp DrawOrMeasureText). Pinned Firefox 156.0, OffscreenCanvas on the main thread
// unless a row says worker. Measurement only, raw values, no `checks`. Every variant of a probe takes turns inside one
// page, a round after the other, forward on even rounds and backward on odd ones; a row gives the median, the smallest
// and the largest per-call time over the rounds, in microseconds. A difference inside that spread is no difference.
// - T1 strings: measureText by string. `repeat` asks one string again and again. `combo` asks strings never asked before
//   that are made of words asked before (Gecko keeps shaped words per font, gfxFont.cpp SplitAndInitTextRun, so these
//   find every word). `new` asks strings whose words were never asked (each word is shaped by HarfBuzz). Lengths 2, 30
//   and 300; Latin, Arabic, Chinese, emoji; a word of 30 letters (Gecko keeps words up to 32 characters) and one of 40
//   (never kept); the empty loop as the floor.
// - T2 setter: ctx.font with the string it has, two strings taking turns, a spelling never seen (letter case), a size
//   never seen; the same followed by one measureText (a font group resolves its families at the first measurement);
//   a new OffscreenCanvas with getContext alone, with the font, and with the font and one measureText.
// - T3 fields: one measureText with nothing read, .width read, and every ink and font box field read.
// - T4 worker: five of T1's variants inside a dedicated worker.
// - T5 boxes: width, actualBoundingBoxLeft and Right of a left-to-right string, a right-to-left one and a string of both,
//   beside the sum of its parts: whether the ink box of a string in several direction runs spans the runs.
//
// Run (the timed sets alone on the machine, under ten minutes; prefs: { "privacy.reduceTimerPrecision": false }):
//   python3 .artifacts/session/with-browser-lock.py upstream-gecko-timing --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-measuretext-cost.ts \
//     --firefox-prefs=<prefs.json> --probe-timeout-ms=240000 --stall-ms=300000 --out=<out>
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const FONT = '16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const stats = list => ({ median: median(list), min: Math.min(...list), max: Math.max(...list), rounds: list.length });
const timerStep = () => { let step = Infinity, last = performance.now(); for (let i = 0; i < 200000; i++) { const t = performance.now(); if (t > last) { step = Math.min(step, t - last); last = t; } } return step; };
const arithmetic = () => { const t0 = performance.now(); let x = 1; for (let i = 0; i < 30000000; i++) x = (x * 1664525 + 1013904223) | 0; return { ms: performance.now() - t0, x }; };
// A small seeded generator, so two runs ask the same strings.
let seed = 20260920;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = list => list[Math.floor(random() * list.length)];
const range = (from, to) => { const out = []; for (let c = from; c <= to; c++) out.push(String.fromCodePoint(c)); return out; };
const LOWER = range(0x61, 0x7a);
const ARABIC = range(0x628, 0x63a).concat(range(0x641, 0x64a));
const HAN = range(0x4e00, 0x5fff);
const lettersOf = (alphabet, n) => { let s = ''; for (let i = 0; i < n; i++) s += pick(alphabet); return s; };
// Words joined by single spaces, cut to exactly 'length' characters; a cut that ends on the space takes a letter there.
const sentence = (word, length) => { let s = ''; while (s.length < length) s += (s === '' ? '' : ' ') + word(); s = s.slice(0, length); return s.endsWith(' ') ? s.slice(0, length - 1) + s[0] : s; };
const vocabulary = (alphabet, size, letters) => { const out = []; for (let i = 0; i < size; i++) out.push(lettersOf(alphabet, letters)); return out; };
const listOf = (n, make) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = make(i); return out; };
// The timed loop: one measureText per string, the width read.
const timeList = (ctx, list) => { let acc = 0; const t0 = performance.now(); for (let i = 0; i < list.length; i++) acc += ctx.measureText(list[i]).width; const t = performance.now() - t0; return { us: t * 1000 / list.length, acc }; };
`

// The variants of T1 and T4 as page script: each has a name, the calls a round makes, and a function giving the round's
// list of strings. `fresh` lists are built before the clock starts.
const VARIANTS = String.raw`
const latinWords = vocabulary(LOWER, 64, 5);
const arabicWords = vocabulary(ARABIC, 64, 5);
const pairAlphabet = LOWER.concat(range(0x41, 0x5a), range(0x30, 0x39), range(0xc0, 0xd6), range(0xd8, 0xf6), range(0xf8, 0x17f));
const pairs = [];
for (let a = 0; a < pairAlphabet.length; a++) for (let b = 0; b < pairAlphabet.length; b++) pairs.push(pairAlphabet[a] + pairAlphabet[b]);
for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); const t = pairs[i]; pairs[i] = pairs[j]; pairs[j] = t; }
let pairAt = 0;
const hanPairs = [];
for (let i = 0; i < 80000; i++) hanPairs.push(HAN[i % HAN.length] + HAN[(i * 7 + 13 + Math.floor(i / HAN.length) * 31) % HAN.length]);
let hanPairAt = 0;
const same = (n, s) => () => listOf(n, () => s);
const EMOJI = String.fromCodePoint(0x1f600);
const FAMILY = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map(c => String.fromCodePoint(c)).join('');
const variantsOf = scale => [
  { name: 'floor: the loop with a string length read, no Canvas call', n: 4000 * scale, floor: true, list: same(4000 * scale, 'ab') },
  { name: 'Latin 2, repeat', n: 4000 * scale, list: same(4000 * scale, 'ab') },
  { name: 'Latin 2, new', n: 2000, list: () => { const out = pairs.slice(pairAt, pairAt + 2000); pairAt += 2000; return out; } },
  { name: 'Latin 30 in 5 words, repeat', n: 3000 * scale, list: same(3000 * scale, sentence(() => pick(latinWords), 30)) },
  { name: 'Latin 30 in 5 words, combo', n: 3000 * scale, list: () => listOf(3000 * scale, () => sentence(() => pick(latinWords), 30)) },
  { name: 'Latin 30 in 5 words, new', n: 3000 * scale, list: () => listOf(3000 * scale, () => sentence(() => lettersOf(LOWER, 5), 30)) },
  { name: 'Latin one word of 30, repeat', n: 3000 * scale, list: same(3000 * scale, lettersOf(LOWER, 30)) },
  { name: 'Latin one word of 30, new', n: 3000 * scale, list: () => listOf(3000 * scale, () => lettersOf(LOWER, 30)) },
  { name: 'Latin one word of 40, repeat', n: 3000 * scale, list: same(3000 * scale, lettersOf(LOWER, 40)) },
  { name: 'Latin one word of 40, new', n: 3000 * scale, list: () => listOf(3000 * scale, () => lettersOf(LOWER, 40)) },
  { name: 'Latin 300 in 50 words, repeat', n: 500 * scale, list: same(500 * scale, sentence(() => pick(latinWords), 300)) },
  { name: 'Latin 300 in 50 words, combo', n: 500 * scale, list: () => listOf(500 * scale, () => sentence(() => pick(latinWords), 300)) },
  { name: 'Latin 300 in 50 words, new', n: 500 * scale, list: () => listOf(500 * scale, () => sentence(() => lettersOf(LOWER, 5), 300)) },
  { name: 'Arabic 2, repeat', n: 4000 * scale, list: same(4000 * scale, ARABIC[1] + ARABIC[5]) },
  { name: 'Arabic 30 in 5 words, repeat', n: 3000 * scale, list: same(3000 * scale, sentence(() => pick(arabicWords), 30)) },
  { name: 'Arabic 30 in 5 words, combo', n: 3000 * scale, list: () => listOf(3000 * scale, () => sentence(() => pick(arabicWords), 30)) },
  { name: 'Arabic 30 in 5 words, new', n: 3000 * scale, list: () => listOf(3000 * scale, () => sentence(() => lettersOf(ARABIC, 5), 30)) },
  { name: 'Arabic 300 in 50 words, repeat', n: 500 * scale, list: same(500 * scale, sentence(() => pick(arabicWords), 300)) },
  { name: 'Chinese 2, repeat', n: 4000 * scale, list: same(4000 * scale, HAN[10] + HAN[500]) },
  { name: 'Chinese 2, new', n: 2000, list: () => { const out = hanPairs.slice(hanPairAt, hanPairAt + 2000); hanPairAt += 2000; return out; } },
  { name: 'Chinese 30, repeat', n: 3000 * scale, list: same(3000 * scale, lettersOf(HAN, 30)) },
  { name: 'Chinese 30, new', n: 3000 * scale, list: () => listOf(3000 * scale, () => lettersOf(HAN, 30)) },
  { name: 'Chinese 40, repeat', n: 3000 * scale, list: same(3000 * scale, lettersOf(HAN, 40)) },
  { name: 'Chinese 300, repeat', n: 500 * scale, list: same(500 * scale, lettersOf(HAN, 300)) },
  { name: 'emoji 1, repeat', n: 4000 * scale, list: same(4000 * scale, EMOJI) },
  { name: 'emoji sequence of 3 joined, repeat', n: 4000 * scale, list: same(4000 * scale, FAMILY) },
  { name: 'Latin 30 in 5 words and an emoji, repeat', n: 3000 * scale, list: same(3000 * scale, sentence(() => pick(latinWords), 28) + ' ' + EMOJI) },
];
const runVariants = (ctx, variants, rounds) => {
  const times = variants.map(() => []);
  // One untimed round first: fonts, glyph boxes and the vocabulary's words are met before the clock runs.
  for (let v = 0; v < variants.length; v++) timeList(ctx, variants[v].list().slice(0, 200));
  for (let r = 0; r < rounds; r++) {
    for (let v0 = 0; v0 < variants.length; v0++) {
      const v = r % 2 === 0 ? v0 : variants.length - 1 - v0;
      const list = variants[v].list();
      if (variants[v].floor) {
        let acc = 0; const t0 = performance.now(); for (let i = 0; i < list.length; i++) acc += list[i].length; times[v].push((performance.now() - t0) * 1000 / list.length);
      } else {
        times[v].push(timeList(ctx, list).us);
      }
    }
  }
  return variants.map((variant, v) => ({ name: variant.name, callsARound: variant.n, usEach: stats(times[v]) }));
};
`

const T1 = String.raw`
const out = { font: FONT, timerStep: timerStep(), arithmeticBefore: arithmetic() };
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
ctx.font = FONT;
out.rows = runVariants(ctx, variantsOf(3), 15);
out.arithmeticAfter = arithmetic();
return out;
`

const T2 = String.raw`
const out = { font: FONT, timerStep: timerStep(), arithmeticBefore: arithmetic(), rows: [] };
const OTHER = '14px Menlo, monospace';
// A spelling never seen: the letter case of the first family's name, 2^13 spellings, one resolved family.
const spelling = i => { const name = 'helvetica neue'; let s = ''; let bit = 0; for (let k = 0; k < name.length; k++) { const c = name[k]; if (c === ' ') { s += c; continue; } s += (i >> bit) & 1 ? c.toUpperCase() : c; bit++; } return '16px "' + s + '", "PingFang TC", "Geeza Pro", sans-serif'; };
let spellingAt = 1;
let sizeAt = 0;
const n = 500;
const kept = new OffscreenCanvas(1, 1).getContext('2d');
kept.font = FONT; kept.measureText('ab');
const variants = [
  { name: 'ctx.font, the string it has', run: () => { const t0 = performance.now(); for (let i = 0; i < n; i++) kept.font = FONT; return performance.now() - t0; } },
  { name: 'ctx.font, two strings taking turns', run: () => { const t0 = performance.now(); for (let i = 0; i < n; i++) kept.font = i % 2 === 0 ? OTHER : FONT; return performance.now() - t0; } },
  { name: 'ctx.font, two strings taking turns, one measureText after each', run: () => { const t0 = performance.now(); for (let i = 0; i < n; i++) { kept.font = i % 2 === 0 ? OTHER : FONT; kept.measureText('ab'); } return performance.now() - t0; } },
  { name: 'measureText alone, for the row above', run: () => { kept.font = FONT; const t0 = performance.now(); for (let i = 0; i < n; i++) kept.measureText('ab'); return performance.now() - t0; } },
  { name: 'ctx.font, a spelling never seen', run: () => { const list = listOf(n, () => spelling(spellingAt++)); const t0 = performance.now(); for (let i = 0; i < n; i++) kept.font = list[i]; return performance.now() - t0; } },
  { name: 'ctx.font, a spelling never seen, one measureText after each', run: () => { const list = listOf(n, () => spelling(spellingAt++)); const t0 = performance.now(); for (let i = 0; i < n; i++) { kept.font = list[i]; kept.measureText('ab'); } return performance.now() - t0; } },
  { name: 'ctx.font, a size never seen, one measureText after each', run: () => { const list = listOf(n, () => (20 + (sizeAt++) / 8) + 'px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif'); const t0 = performance.now(); for (let i = 0; i < n; i++) { kept.font = list[i]; kept.measureText('ab'); } return performance.now() - t0; } },
  { name: 'new OffscreenCanvas and getContext', run: () => { const keep = new Array(n); const t0 = performance.now(); for (let i = 0; i < n; i++) keep[i] = new OffscreenCanvas(1, 1).getContext('2d'); return performance.now() - t0; } },
  { name: 'new OffscreenCanvas, getContext and font', run: () => { const keep = new Array(n); const t0 = performance.now(); for (let i = 0; i < n; i++) { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = FONT; keep[i] = c; } return performance.now() - t0; } },
  { name: 'new OffscreenCanvas, getContext, font and one measureText', run: () => { const keep = new Array(n); const t0 = performance.now(); for (let i = 0; i < n; i++) { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = FONT; c.measureText('ab'); keep[i] = c; } return performance.now() - t0; } },
];
const times = variants.map(() => []);
for (let v = 0; v < variants.length; v++) variants[v].run();
for (let r = 0; r < 15; r++) {
  for (let v0 = 0; v0 < variants.length; v0++) {
    const v = r % 2 === 0 ? v0 : variants.length - 1 - v0;
    times[v].push(variants[v].run() * 1000 / n);
  }
}
kept.font = FONT;
for (let v = 0; v < variants.length; v++) out.rows.push({ name: variants[v].name, callsARound: n, usEach: stats(times[v]) });
out.arithmeticAfter = arithmetic();
return out;
`

const T3 = String.raw`
const out = { font: FONT, timerStep: timerStep(), arithmeticBefore: arithmetic(), rows: [] };
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
ctx.font = FONT;
const texts = { 'Latin 2': 'ab', 'Latin 30 in 5 words': 'The quick brown fox jumps over' };
const n = 4000;
const reads = [
  ['nothing read', s => { let acc = 0; for (let i = 0; i < n; i++) { ctx.measureText(s); acc += 1; } return acc; }],
  ['width read', s => { let acc = 0; for (let i = 0; i < n; i++) acc += ctx.measureText(s).width; return acc; }],
  ['width and the four ink box fields read', s => { let acc = 0; for (let i = 0; i < n; i++) { const m = ctx.measureText(s); acc += m.width + m.actualBoundingBoxLeft + m.actualBoundingBoxRight + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent; } return acc; }],
  ['all twelve fields read', s => { let acc = 0; for (let i = 0; i < n; i++) { const m = ctx.measureText(s); acc += m.width + m.actualBoundingBoxLeft + m.actualBoundingBoxRight + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + m.fontBoundingBoxAscent + m.fontBoundingBoxDescent + m.emHeightAscent + m.emHeightDescent + m.hangingBaseline + m.alphabeticBaseline + m.ideographicBaseline; } return acc; }],
];
const variants = [];
for (const label in texts) for (let k = 0; k < reads.length; k++) variants.push({ name: label + ', ' + reads[k][0], text: texts[label], run: reads[k][1] });
const times = variants.map(() => []);
for (let v = 0; v < variants.length; v++) variants[v].run(variants[v].text);
for (let r = 0; r < 21; r++) {
  for (let v0 = 0; v0 < variants.length; v0++) {
    const v = r % 2 === 0 ? v0 : variants.length - 1 - v0;
    const t0 = performance.now();
    variants[v].run(variants[v].text);
    times[v].push((performance.now() - t0) * 1000 / n);
  }
}
for (let v = 0; v < variants.length; v++) out.rows.push({ name: variants[v].name, callsARound: n, usEach: stats(times[v]) });
out.arithmeticAfter = arithmetic();
return out;
`

const T4 = (shared: string): string => String.raw`
const source = ${JSON.stringify(shared)} + String.raw${'`'}
const wanted = ['floor: the loop with a string length read, no Canvas call', 'Latin 2, repeat', 'Latin 30 in 5 words, repeat', 'Latin 30 in 5 words, combo', 'Latin one word of 40, repeat', 'Chinese 30, repeat', 'Arabic 30 in 5 words, repeat'];
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
ctx.font = FONT;
const rows = runVariants(ctx, variantsOf(1).filter(v => wanted.includes(v.name)), 15);
postMessage({ font: FONT, timerStep: timerStep(), rows });
${'`'};
const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
const worker = new Worker(url);
const result = await new Promise((done, fail) => { worker.onmessage = e => done(e.data); worker.onerror = e => fail(new Error('worker: ' + e.message)); });
worker.terminate();
URL.revokeObjectURL(url);
return result;
`

const T5 = String.raw`
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
ctx.font = '32px "Helvetica Neue", "Arial Hebrew", "Geeza Pro", sans-serif';
const hebrew = [0x5e9, 0x5dc, 0x5d5, 0x5dd, 0x5e2, 0x5d5, 0x5dc, 0x5dd].map(c => String.fromCodePoint(c)).join('');
const latin = 'Hamburgefonstiv';
const box = s => { const m = ctx.measureText(s); return { units: s.length, width: m.width, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight }; };
return { font: ctx.font, latin: box(latin), hebrew: box(hebrew), latinThenHebrew: box(latin + ' ' + hebrew), hebrewThenLatin: box(hebrew + ' ' + latin), space: box(' ') };
`

export default function probes(): Probe[] {
  const probe = (id: string, spec: string, source: string): Probe => ({
    id,
    spec,
    pageLang: 'en',
    observe: [{ kind: 'script', source }],
    browsers: ['firefox'],
    note: 'Measurement only.',
  })
  return [
    probe('gecko-measuretext-cost T1 strings', 'T1: measureText per call by what the string is', `${HELPERS}${VARIANTS}${T1}`),
    probe('gecko-measuretext-cost T2 setter', 'T2: the font setter and a new context', `${HELPERS}${T2}`),
    probe('gecko-measuretext-cost T3 fields', 'T3: reading .width alone against the box fields', `${HELPERS}${T3}`),
    probe('gecko-measuretext-cost T4 worker', 'T4: measureText per call inside a dedicated worker', `${HELPERS}${T4(`${HELPERS}${VARIANTS}`)}`),
    probe('gecko-measuretext-cost T5 boxes', 'T5: the ink box of a string in several direction runs', T5),
  ]
}
