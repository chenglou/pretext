// The page side of tools/measuretext-cost-probe.ts and tools/measuretext-cost-shell.ts: what one Canvas measureText call
// costs in Chromium by what the string is, what a font assignment and a new context cost, and the library's own stream
// of Canvas calls for the chat benchmark's messages played back without the library around it. Measurement only, raw
// values, no checks.
//
// Two variants take turns in every round. Before a variant's samples the page measures one of two fixed ASCII strings
// (AB_STRINGS). A stock browser measures them like any string, so its two variants are the same code and their
// distance is the noise of the run. A Chromium built with the study's switch patch reads them as "candidate off" and
// "candidate on", so one process runs base and patched in turn.
//
// Every source string here is ASCII: characters of other scripts are built from code points in the page.

export const AB_STRINGS = ['__blink_ab_variant_0__', '__blink_ab_variant_1__'] as const

const SHARED = String.raw`
const AB = ${JSON.stringify(AB_STRINGS)};
const FONT = '16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const toggleContext = new OffscreenCanvas(1, 1).getContext('2d');
const setVariant = (v) => { toggleContext.measureText(AB[v]); };
const newContext = (font) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = font; return c; };
// A new flat string object with these units: never a key, never seen by Blink.
const fresh = (codes) => String.fromCharCode.apply(null, codes);
const codesOf = (s) => { const out = []; for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); return out; };
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const quantile = (xs, q) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const summary = (xs) => ({ median: median(xs), p10: quantile(xs, 0.1), p90: quantile(xs, 0.9), min: Math.min.apply(null, xs), samples: xs.length });
let sink = 0;
`

// M1: per call costs. A class makes its inputs outside the clock and runs them inside it.
export const MICRO_BODY = SHARED + String.raw`
const ROUNDS = PARAMS.rounds;
const SCALE = PARAMS.scale;
const LATIN_WORDS = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'and', 'runs', 'away', 'from', 'here', 'with', 'some', 'more'];
const latinSpaced = (units) => { let s = ''; for (let i = 0; s.length < units; i++) s += (s === '' ? '' : ' ') + LATIN_WORDS[i % LATIN_WORDS.length]; return s.slice(0, units); };
const latinSolid = (units) => { let s = ''; for (let i = 0; s.length < units; i++) s += LATIN_WORDS[i % LATIN_WORDS.length]; return s.slice(0, units); };
const arabicWord = (n, seed) => { const out = []; for (let i = 0; i < n; i++) { out.push(0x628 + (seed % 23)); seed = Math.floor(seed / 23) + 7 * i + 1; } return out; };
const arabicSpaced = (units) => { let out = []; for (let w = 0; out.length < units; w++) { if (out.length > 0) out.push(0x20); out = out.concat(arabicWord(4, w * 31 + 5)); } return out.slice(0, units); };
const cjk = (units, seed) => { const out = []; for (let i = 0; i < units; i++) out.push(0x4e00 + ((seed + i * 131) % 3000)); return out; };
const EMOJI = [0xd83d, 0xde00];
const FAMILY = [0xd83d, 0xdc68, 0x200d, 0xd83d, 0xdc69, 0x200d, 0xd83d, 0xdc67];

let unique = 0;
const letters = (n) => { let v = unique++; const out = []; for (let i = 0; i < n; i++) { out.push(97 + (v % 26)); v = Math.floor(v / 26); } return out; };
const VOCAB = []; for (let i = 0; i < 256; i++) VOCAB.push([97 + (i % 26), 97 + ((i >> 3) % 26), 97 + ((i >> 5) % 26), 97 + ((i * 7) % 26)]);
const knownWords = (words) => { let v = unique++; let out = []; for (let w = 0; w < words; w++) { if (w > 0) out.push(0x20); out = out.concat(VOCAB[(v + w * 97) % 256]); v = Math.floor(v / 3) + w; } return out; };

// kind 'same': one string object measured n times. 'fresh': n new string objects with the same units, which the
// canvas has met. 'new': n strings the canvas has never met.
const classes = [];
const addHit = (id, codes, n) => {
  classes.push({ id: 'same ' + id, n, ctx: newContext(FONT), make(c) { const s = fresh(codes); c.ctx.measureText(s); return s; }, run(c, s) { let w = 0; for (let i = 0; i < c.n; i++) w += c.ctx.measureText(s).width; return w; } });
  classes.push({ id: 'fresh ' + id, n, ctx: newContext(FONT), make(c) { const xs = []; for (let i = 0; i < c.n; i++) xs.push(fresh(codes)); c.ctx.measureText(fresh(codes)); return xs; }, run(c, xs) { let w = 0; for (let i = 0; i < xs.length; i++) w += c.ctx.measureText(xs[i]).width; return w; } });
};
const addNew = (id, gen, n) => {
  classes.push({ id: 'new ' + id, n, ctx: newContext(FONT), make(c) { const xs = []; for (let i = 0; i < c.n; i++) xs.push(fresh(gen())); return xs; }, run(c, xs) { let w = 0; for (let i = 0; i < xs.length; i++) w += c.ctx.measureText(xs[i]).width; return w; } });
};
addHit('latin 2', codesOf('hi'), 20000 * SCALE);
addHit('latin 5', codesOf('hello'), 20000 * SCALE);
addHit('latin 30 spaced', codesOf(latinSpaced(30)), 10000 * SCALE);
addHit('latin 30 solid', codesOf(latinSolid(30)), 20000 * SCALE);
addHit('latin 300 spaced', codesOf(latinSpaced(300)), 2000 * SCALE);
addHit('latin 300 solid', codesOf(latinSolid(300)), 10000 * SCALE);
addHit('arabic 5', arabicWord(5, 11), 20000 * SCALE);
addHit('arabic 30 spaced', arabicSpaced(30), 5000 * SCALE);
addHit('cjk 2', cjk(2, 3), 20000 * SCALE);
addHit('cjk 30', cjk(30, 3), 5000 * SCALE);
addHit('emoji 1', EMOJI, 20000 * SCALE);
addHit('emoji family', FAMILY, 20000 * SCALE);
addNew('latin word 5', () => letters(5), 4000 * SCALE);
addNew('latin word 10', () => letters(10), 4000 * SCALE);
addNew('latin 30 solid', () => letters(30), 2000 * SCALE);
addNew('latin 300 solid', () => letters(300), 300 * SCALE);
addNew('latin 29 of 6 known words', () => knownWords(6), 4000 * SCALE);
addNew('latin 299 of 60 known words', () => knownWords(60), 500 * SCALE);
addNew('arabic word 5', () => arabicWord(5, unique++ * 13 + 1), 2000 * SCALE);
addNew('cjk 2 of known characters', () => cjk(2, unique++ * 17), 4000 * SCALE);
addNew('cjk 30 of known characters', () => cjk(30, unique++ * 17), 1000 * SCALE);

// Reading the result: nothing, the width, the width and the four ink box fields.
const readCodes = codesOf('hello');
classes.push({ id: 'read nothing, fresh latin 5', n: 20000 * SCALE, ctx: newContext(FONT), make(c) { const xs = []; for (let i = 0; i < c.n; i++) xs.push(fresh(readCodes)); return xs; }, run(c, xs) { let w = 0; for (let i = 0; i < xs.length; i++) { c.ctx.measureText(xs[i]); w++; } return w; } });
classes.push({ id: 'read width and ink box, fresh latin 5', n: 20000 * SCALE, ctx: newContext(FONT), make(c) { const xs = []; for (let i = 0; i < c.n; i++) xs.push(fresh(readCodes)); return xs; }, run(c, xs) { let w = 0; for (let i = 0; i < xs.length; i++) { const m = c.ctx.measureText(xs[i]); w += m.width + m.actualBoundingBoxLeft + m.actualBoundingBoxRight + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent; } return w; } });

// The font setter and a new context.
const FONT_B = '14px Menlo';
classes.push({ id: 'font = the string it has', n: 20000 * SCALE, ctx: newContext(FONT), make() { return null; }, run(c) { for (let i = 0; i < c.n; i++) c.ctx.font = FONT; return c.n; } });
classes.push({ id: 'font = one of two strings in turn', n: 10000 * SCALE, ctx: newContext(FONT), make() { return null; }, run(c) { for (let i = 0; i < c.n; i++) c.ctx.font = (i & 1) === 0 ? FONT_B : FONT; return c.n; } });
classes.push({ id: 'font = a string never assigned', n: 1000 * SCALE, ctx: newContext(FONT), make(c) { const xs = []; for (let i = 0; i < c.n; i++) xs.push((10 + (unique++) / 1024) + 'px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif'); return xs; }, run(c, xs) { for (let i = 0; i < xs.length; i++) c.ctx.font = xs[i]; return xs.length; } });
classes.push({ id: 'new OffscreenCanvas + getContext', n: 2000 * SCALE, ctx: null, make() { return null; }, run(c) { let k = 0; for (let i = 0; i < c.n; i++) { const x = new OffscreenCanvas(1, 1).getContext('2d'); if (x !== null) k++; } return k; } });
classes.push({ id: 'new OffscreenCanvas + getContext + font', n: 2000 * SCALE, ctx: null, make() { return null; }, run(c) { let k = 0; for (let i = 0; i < c.n; i++) { const x = new OffscreenCanvas(1, 1).getContext('2d'); x.font = FONT; k++; } return k; } });
classes.push({ id: 'new OffscreenCanvas + getContext + font + measure latin 5', n: 2000 * SCALE, ctx: null, make() { return fresh(readCodes); }, run(c, s) { let w = 0; for (let i = 0; i < c.n; i++) { const x = new OffscreenCanvas(1, 1).getContext('2d'); x.font = FONT; w += x.measureText(s).width; } return w; } });

const samples = classes.map(() => [[], []]);
// One untimed pass of every class for compiled code and warm caches.
for (let k = 0; k < classes.length; k++) { const c = classes[k]; sink += c.run(c, c.make(c)); }
for (let round = 0; round < ROUNDS; round++) {
  for (let turn = 0; turn < 2; turn++) {
    const v = (round & 1) === 0 ? turn : 1 - turn;
    setVariant(v);
    for (let k = 0; k < classes.length; k++) {
      const c = classes[k];
      const input = c.make(c);
      const t0 = performance.now();
      sink += c.run(c, input);
      samples[k][v].push((performance.now() - t0) * 1e6 / c.n);
    }
  }
  await new Promise((done) => { const ch = new MessageChannel(); ch.port1.onmessage = () => done(); ch.port2.postMessage(0); });
}
setVariant(0);
return {
  userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, crossOriginIsolated: self.crossOriginIsolated === true, font: FONT, rounds: ROUNDS, unit: 'ns per call',
  classes: classes.map((c, k) => ({ id: c.id, callsPerSample: c.n, variant0: summary(samples[k][0]), variant1: summary(samples[k][1]), raw: samples[k] })),
  sink,
};
`

// R1: the library's stream of Canvas calls for the first PARAMS.messages messages of the chat mix, one kept list of
// contexts, recorded once and then played back on new contexts, a new string object per call as the library makes
// them, with nothing of the library inside the clock.
export const REPLAY_BODY = SHARED + String.raw`
const lib = globalThis.measureTextCost;
const env = lib.environment();
const proto = OffscreenCanvasRenderingContext2D.prototype;
const SETTERS = ['font', 'letterSpacing', 'wordSpacing', 'textRendering', 'fontKerning', 'fontVariantCaps', 'fontStretch', 'direction', 'lang'];
const ops = [];
const ids = new Map();
const idOf = (ctx) => { let id = ids.get(ctx); if (id === undefined) { id = ids.size; ids.set(ctx, id); } return id; };
const realMeasure = proto.measureText;
const realSetters = {};
proto.measureText = function (text) { ops.push({ c: idOf(this), t: text }); return realMeasure.call(this, text); };
for (const name of SETTERS) {
  const d = Object.getOwnPropertyDescriptor(proto, name);
  if (d === undefined || d.set === undefined) continue;
  realSetters[name] = d;
  Object.defineProperty(proto, name, { configurable: true, enumerable: d.enumerable, get: d.get, set(value) { ops.push({ c: idOf(this), k: name, v: value }); d.set.call(this, value); } });
}
let lines = 0;
try {
  lines = lib.scratchKept(MESSAGES.map((m) => lib.paragraphOf(m.parts)), env, 320);
} finally {
  proto.measureText = realMeasure;
  for (const name of Object.keys(realSetters)) Object.defineProperty(proto, name, realSetters[name]);
}

// What the stream is.
let measures = 0, assignments = 0, units = 0, spaced = 0, wide = 0, repeats = 0;
const seen = new Map();
const lengths = { '1': 0, '2': 0, '3-5': 0, '6-12': 0, '13-30': 0, '31-100': 0, 'over 100': 0 };
for (let i = 0; i < ops.length; i++) {
  const op = ops[i];
  if (op.t === undefined) { assignments++; continue; }
  measures++; units += op.t.length;
  if (op.t.indexOf(' ') >= 0) spaced++;
  let isWide = false; for (let j = 0; j < op.t.length; j++) if (op.t.charCodeAt(j) > 255) { isWide = true; break; }
  if (isWide) wide++;
  const key = op.c + '|' + op.t;
  if (seen.has(key)) repeats++; else seen.set(key, true);
  const n = op.t.length;
  lengths[n <= 1 ? '1' : n === 2 ? '2' : n <= 5 ? '3-5' : n <= 12 ? '6-12' : n <= 30 ? '13-30' : n <= 100 ? '31-100' : 'over 100']++;
}
const codes = ops.map((op) => op.t === undefined ? null : codesOf(op.t));

const play = (contexts, strings) => {
  let w = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let ctx = contexts[op.c];
    if (ctx === undefined) { ctx = new OffscreenCanvas(1, 1).getContext('2d'); contexts[op.c] = ctx; }
    if (strings[i] === null) ctx[op.k] = op.v; else w += ctx.measureText(strings[i]).width;
  }
  return w;
};
const freshStrings = () => codes.map((c) => c === null ? null : fresh(c));
const first = [[], []], again = [[], []];
// Untimed once, for compiled code.
{ const contexts = []; sink += play(contexts, freshStrings()); sink += play(contexts, freshStrings()); }
for (let round = 0; round < PARAMS.rounds; round++) {
  for (let turn = 0; turn < 2; turn++) {
    const v = (round & 1) === 0 ? turn : 1 - turn;
    setVariant(v);
    const contexts = [];
    let strings = freshStrings();
    let t0 = performance.now();
    sink += play(contexts, strings);
    first[v].push((performance.now() - t0) * 1e6 / measures);
    strings = freshStrings();
    t0 = performance.now();
    sink += play(contexts, strings);
    again[v].push((performance.now() - t0) * 1e6 / measures);
  }
  await new Promise((done) => { const ch = new MessageChannel(); ch.port1.onmessage = () => done(); ch.port2.postMessage(0); });
}
setVariant(0);
return {
  userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, crossOriginIsolated: self.crossOriginIsolated === true, engine: env.engine,
  messages: MESSAGES.length, lines, rounds: PARAMS.rounds, unit: 'ns per measureText call of the stream, the assignments inside the clock',
  stream: { measures, assignments, contexts: ids.size, units, meanUnits: units / measures, withASpace: spaced, withAUnitOver255: wide, metBeforeOnTheSameContext: repeats, lengths },
  firstPass: { variant0: summary(first[0]), variant1: summary(first[1]), raw: first },
  samePassAgain: { variant0: summary(again[0]), variant1: summary(again[1]), raw: again },
  sink,
};
`
