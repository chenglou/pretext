// A timing probe for the store study (research: what a store of measured widths would save). One script per browser,
// run through the probe runner under the exclusive browser lock:
//
//   python3 .artifacts/session/with-browser-lock.py store-timing --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/store-timing-probe.ts --out=<dir> --probe-timeout-ms=600000 --stall-ms=600000
//
// It times, in rounds that take every measurement in turn (so load that comes and goes lands on all of them):
// - measureText by string length (1 to 128 units), on a context whose font no context has had (a size of its own), for
//   strings the context hasn't met (`cold`), the same strings again (`warm`), and the same strings on a second context
//   with the same settings (`otherContext`: tells a cache per canvas from a cache per font). In Chrome also with U+2028
//   for every space, which is what the Blink port asks (one Canvas word instead of several).
// - a new context whose font string other contexts have had: making it and assigning its settings, and its first,
//   second and later measureText calls of strings that font has measured before.
// - Map lookups in a store of 200,000 strings: by the key's own string object, by a string built again for the lookup
//   (a slice of the text, and the text's units joined one by one as the ports build their strings), hits and misses.
// Timers are coarse (1 ms in Firefox and WebKit), so every number is a loop of at least tens of milliseconds, and a
// loop's own overhead is timed apart and taken off.
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const ROUNDS = 5;
const LENGTHS = [1, 2, 4, 8, 16, 32, 64, 128];
const N = 300;
const isChrome = /\bChrome\//.test(navigator.userAgent);
const isFirefox = /\bFirefox\//.test(navigator.userAgent);
const baseSize = isChrome ? 32 : 16;
const family = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
let seed = 12345;
const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const letters = 'etaoinshrdlucmfwypvbgkqjxz';
const singles = [];
for (let c = 0x21; c < 0x7f; c++) singles.push(String.fromCharCode(c));
for (let c = 0xc0; c < 0x180; c++) if (c !== 0xd7 && c !== 0xf7) singles.push(String.fromCharCode(c));
for (let c = 0x391; c < 0x3ca; c++) if (c !== 0x3a2) singles.push(String.fromCharCode(c));
for (let c = 0x410; c < 0x450; c++) singles.push(String.fromCharCode(c));
// N distinct strings of L units: single characters, pairs, or made-up words of 2 to 8 letters with single spaces.
const stringsOf = (L, space) => {
  const out = new Set();
  while (out.size < N) {
    let s = '';
    if (L === 1) s = singles[Math.floor(rand() * singles.length)];
    else if (L === 2) s = letters[Math.floor(rand() * 26)].toUpperCase() + letters[Math.floor(rand() * 26)];
    else {
      let word = 0;
      let wordLength = 2 + Math.floor(rand() * 7);
      while (s.length < L) {
        if (L > 8 && word === wordLength && s.length < L - 1) { s += space; word = 0; wordLength = 2 + Math.floor(rand() * 7); continue; }
        s += letters[Math.floor(rand() * rand() * 26)];
        word++;
      }
    }
    out.add(s);
  }
  return Array.from(out);
};
let sizes = 0;
const contextAt = (size) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = 'en';
  c.font = 'normal 400 ' + size + 'px ' + family;
  c.letterSpacing = '0px';
  c.wordSpacing = '0px';
  c.fontKerning = 'auto';
  c.textRendering = isChrome ? 'optimizeLegibility' : 'auto';
  c.direction = 'ltr';
  return c;
};
// A font size no context has had: 1/64 px steps, which every engine keeps apart.
const freshSize = () => baseSize + (++sizes) / 64;
let sink = 0;
const now = () => performance.now();
// Timer resolution: the smallest step seen.
let resolution = Infinity;
for (let i = 0, last = now(); i < 200000; i++) { const t = now(); if (t > last) { resolution = Math.min(resolution, t - last); last = t; } }

const results = [];
const record = (round, name, L, perCallUs, extra) => results.push(Object.assign({ round, name, L, perCallUs }, extra || {}));

const measureByLength = (round, label, space) => {
  for (let li = 0; li < LENGTHS.length; li++) {
    const L = LENGTHS[li];
    const strings = stringsOf(L, space);
    // Batches until the cold loop has run for 60 ms or 40 batches.
    let cold = 0, warm = 0, other = 0, setup = 0, batches = 0;
    while (batches < 40 && (cold < 60 || batches < 4)) {
      const size = freshSize();
      let t0 = now();
      const a = contextAt(size);
      sink += a.measureText('x').width;
      const b = contextAt(size);
      sink += b.measureText('x').width;
      let t1 = now();
      setup += t1 - t0;
      for (let i = 0; i < N; i++) sink += a.measureText(strings[i]).width;
      let t2 = now();
      cold += t2 - t1;
      for (let i = 0; i < N; i++) sink += a.measureText(strings[i]).width;
      let t3 = now();
      warm += t3 - t2;
      for (let i = 0; i < N; i++) sink += b.measureText(strings[i]).width;
      let t4 = now();
      other += t4 - t3;
      batches++;
    }
    const calls = batches * N;
    record(round, label + ' cold', L, cold * 1000 / calls, { batches });
    record(round, label + ' warm', L, warm * 1000 / calls, { batches });
    record(round, label + ' otherContext', L, other * 1000 / calls, { batches });
    record(round, label + ' two contexts of a new size, each with one call', L, setup * 1000 / batches / 2, { batches });
  }
};

// A new context whose font string others have had, and its first calls, of strings that font has measured.
const newContexts = (round) => {
  const size = baseSize;
  const warmStrings = stringsOf(8, ' ').slice(0, 16);
  const first = contextAt(size);
  for (let i = 0; i < warmStrings.length; i++) sink += first.measureText(warmStrings[i]).width;
  const K = 300;
  const counts = [0, 1, 2, 4, 16];
  const totals = [];
  for (let k = 0; k < counts.length; k++) {
    const t0 = now();
    for (let i = 0; i < K; i++) {
      const c = contextAt(size);
      for (let j = 0; j < counts[k]; j++) sink += c.measureText(warmStrings[j]).width;
    }
    totals.push((now() - t0) * 1000 / K);
  }
  record(round, 'new context, font met before: made and set', 0, totals[0]);
  record(round, 'new context, font met before: its first call', 8, totals[1] - totals[0]);
  record(round, 'new context, font met before: its second call', 8, totals[2] - totals[1]);
  record(round, 'new context, font met before: calls 3 and 4, each', 8, (totals[3] - totals[2]) / 2);
  record(round, 'new context, font met before: calls 5 to 16, each', 8, (totals[4] - totals[3]) / 12);
  // The same 16 strings on one kept context.
  const REPS = 300;
  const t0 = now();
  for (let i = 0; i < REPS; i++) for (let j = 0; j < 16; j++) sink += first.measureText(warmStrings[j]).width;
  record(round, 'kept context: a string met before', 8, (now() - t0) * 1000 / (REPS * 16));
};

// A store of 200,000 strings cut from one long text, and lookups of 2,000 of them per length.
let text = '';
while (text.length < 1200000) { const n = 2 + Math.floor(rand() * 7); for (let i = 0; i < n; i++) text += letters[Math.floor(rand() * rand() * 26)]; text += ' '; }
const store = new Map();
const keyOffsets = {};
for (let li = 0; li < LENGTHS.length; li++) keyOffsets[LENGTHS[li]] = [];
for (let i = 0; store.size < 200000; i++) {
  const L = LENGTHS[i % LENGTHS.length];
  const at = Math.floor(rand() * (text.length - 200));
  const key = text.slice(at, at + L);
  if (!store.has(key)) store.set(key, store.size + 0.5);
  if (keyOffsets[L].length < 2000) keyOffsets[L].push(at);
}
const lookups = (round) => {
  for (let li = 0; li < LENGTHS.length; li++) {
    const L = LENGTHS[li];
    const offsets = keyOffsets[L];
    const own = offsets.map(at => text.slice(at, at + L));
    for (let i = 0; i < own.length; i++) sink += store.get(own[i]);
    const REPS = Math.max(4, Math.floor(400 / L));
    let t0 = now();
    for (let r = 0; r < REPS; r++) for (let i = 0; i < own.length; i++) sink += store.get(own[i]);
    const byObject = (now() - t0) * 1000 / (REPS * own.length);
    t0 = now();
    for (let r = 0; r < REPS; r++) for (let i = 0; i < offsets.length; i++) sink += text.slice(offsets[i], offsets[i] + L).length;
    const sliceOnly = (now() - t0) * 1000 / (REPS * offsets.length);
    t0 = now();
    for (let r = 0; r < REPS; r++) for (let i = 0; i < offsets.length; i++) sink += store.get(text.slice(offsets[i], offsets[i] + L));
    const sliceGet = (now() - t0) * 1000 / (REPS * offsets.length);
    t0 = now();
    for (let r = 0; r < REPS; r++) for (let i = 0; i < offsets.length; i++) { let s = ''; for (let k = 0; k < L; k++) s += String.fromCharCode(text.charCodeAt(offsets[i] + k)); sink += s.length; }
    const joinOnly = (now() - t0) * 1000 / (REPS * offsets.length);
    t0 = now();
    for (let r = 0; r < REPS; r++) for (let i = 0; i < offsets.length; i++) { let s = ''; for (let k = 0; k < L; k++) s += String.fromCharCode(text.charCodeAt(offsets[i] + k)); sink += store.get(s); }
    const joinGet = (now() - t0) * 1000 / (REPS * offsets.length);
    t0 = now();
    let missed = 0;
    for (let r = 0; r < REPS; r++) for (let i = 0; i < offsets.length; i++) { if (store.get('#' + text.slice(offsets[i] + 1, offsets[i] + L)) === undefined) missed++; }
    const missGet = (now() - t0) * 1000 / (REPS * offsets.length);
    sink += missed;
    record(round, 'Map.get by the key object itself', L, byObject);
    record(round, 'Map.get of a fresh slice', L, sliceGet, { buildUs: sliceOnly });
    record(round, 'Map.get of a string joined unit by unit', L, joinGet, { buildUs: joinOnly });
    record(round, 'Map.get miss of a fresh concatenation', L, missGet);
  }
};

// The contexts the rebuild makes for one plain ASCII chat message today, in order, with the calls each one takes
// (read from the library under the stand-in Canvas; tools/store-study.ts has the counts): per message against kept.
const F = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const H = '"Helvetica Neue"';
const setOf = (font, lang, letterSpacing, textRendering, direction, calls) => ({ font, lang, letterSpacing, textRendering, direction, calls });
const LIBRARY_SETS = isChrome ? [
  setOf('normal 400 16px ' + H + ', monospace', 'en', '0px', 'optimizeLegibility', 'ltr', 2), setOf('normal 400 16px ' + H + ', serif', 'en', '0px', 'optimizeLegibility', 'ltr', 2),
  setOf('normal 400 16px monospace', 'en', '0px', 'optimizeLegibility', 'ltr', 2), setOf('normal 400 16px serif', 'en', '0px', 'optimizeLegibility', 'ltr', 2),
  setOf('normal 400 16px ' + F, 'en', '0px', 'optimizeLegibility', 'ltr', 1), setOf('normal 400 32px ' + F, 'en', '0px', 'optimizeLegibility', 'ltr', 1),
  setOf('normal 400 32px ' + F, 'en', '0px', 'optimizeLegibility', 'ltr', 259), setOf('normal 400 32px ' + F, 'en', '0px', 'optimizeLegibility', 'rtl', 0),
  setOf('normal 400 32px ' + F, 'en', '0.015625px', 'optimizeLegibility', 'ltr', 0), setOf('normal 400 32px ' + F, 'en', '0.015625px', 'optimizeLegibility', 'rtl', 0),
] : isFirefox ? [
  setOf('normal 400 16px ' + F, 'en', '0px', 'auto', 'ltr', 47), setOf('normal 400 16px ' + F, 'en', '0.001px', 'auto', 'ltr', 13), setOf('normal 400 16px ' + F, 'en', '2px', 'auto', 'ltr', 2),
] : [
  setOf('normal 400 16px ' + H + ', monospace', '', '0px', 'auto', 'ltr', 2), setOf('normal 400 16px ' + H + ', serif', '', '0px', 'auto', 'ltr', 3),
  setOf('normal 400 16px monospace', '', '0px', 'auto', 'ltr', 2), setOf('normal 400 16px serif', '', '0px', 'auto', 'ltr', 2),
  setOf('normal 400 16px ' + F, '', '0px', 'auto', 'ltr', 15),
];
const makeSet = (set) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = set.lang;
  c.font = set.font;
  c.letterSpacing = set.letterSpacing;
  c.wordSpacing = '0px';
  c.fontKerning = 'auto';
  c.textRendering = set.textRendering;
  c.direction = set.direction;
  return c;
};
// 64 short strings, words with a trailing space and single characters, which every font here has measured before.
const pool = stringsOf(4, ' ').slice(0, 24).map(s => s + ' ').concat(stringsOf(8, ' ').slice(0, 24), stringsOf(2, ' ').slice(0, 8), [' ', 'i', 'M', '.', 'a', 'e', 't', 'o']);
const askSet = (c, calls, from) => { for (let j = 0; j < calls; j++) sink += c.measureText(pool[(from + j) % pool.length]).width; };
const keptSets = LIBRARY_SETS.map(makeSet);
for (let i = 0; i < keptSets.length; i++) askSet(keptSets[i], pool.length, 0);
const libraryContexts = (round) => {
  const M = 150;
  let callsPerMessage = 0;
  for (let i = 0; i < LIBRARY_SETS.length; i++) callsPerMessage += LIBRARY_SETS[i].calls;
  let t0 = now();
  for (let m = 0; m < M; m++) for (let i = 0; i < LIBRARY_SETS.length; i++) askSet(makeSet(LIBRARY_SETS[i]), LIBRARY_SETS[i].calls, m);
  const perMessage = (now() - t0) * 1000 / M;
  t0 = now();
  for (let m = 0; m < M; m++) for (let i = 0; i < LIBRARY_SETS.length; i++) askSet(keptSets[i], LIBRARY_SETS[i].calls, m);
  const kept = (now() - t0) * 1000 / M;
  t0 = now();
  for (let m = 0; m < M; m++) for (let i = 0; i < LIBRARY_SETS.length; i++) sink += makeSet(LIBRARY_SETS[i]).direction.length;
  const madeOnly = (now() - t0) * 1000 / M;
  t0 = now();
  for (let m = 0; m < M; m++) for (let i = 0; i < LIBRARY_SETS.length; i++) askSet(makeSet(LIBRARY_SETS[i]), Math.min(1, LIBRARY_SETS[i].calls), m);
  const madeWithOneCall = (now() - t0) * 1000 / M;
  record(round, 'a message: its contexts made, then its calls (us a message)', callsPerMessage, perMessage, { contexts: LIBRARY_SETS.length });
  record(round, 'a message: the same calls on kept contexts (us a message)', callsPerMessage, kept, { contexts: LIBRARY_SETS.length });
  record(round, 'a message: its contexts made and set, no call (us a message)', 0, madeOnly, { contexts: LIBRARY_SETS.length });
  record(round, 'a message: its contexts made, one call each (us a message)', LIBRARY_SETS.length, madeWithOneCall, { contexts: LIBRARY_SETS.length });
};

const spin = () => { const t0 = now(); let x = 1; for (let i = 0; i < 20000000; i++) { x = (x * 1664525 + 1013904223) | 0; x ^= x >>> 7; } sink += x & 1; return now() - t0; };
const spins = [spin()];
for (let round = 0; round < ROUNDS; round++) {
  measureByLength(round, 'measureText, spaces as U+0020', ' ');
  if (isChrome) measureByLength(round, 'measureText, spaces as U+2028', '\u2028');
  newContexts(round);
  libraryContexts(round);
  lookups(round);
  spins.push(spin());
  await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, timerResolutionMs: resolution, fixedArithmeticMs: spins, storeSize: store.size, isFirefox, sink, results };
`

export default function storeTimingProbes(): Probe[] {
  return [{
    id: 'store-timing T1', spec: 'store study: the cost of measureText by length and history, of a new context, and of a Map lookup', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: BODY }],
  }]
}
