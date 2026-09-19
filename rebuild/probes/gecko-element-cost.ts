// Gecko probes of what a detached `<canvas>` element costs as a measuring surface beside `new OffscreenCanvas(1, 1)`, pinned
// Firefox 156.0. Measurement only; nothing here decides a rule. The question is the maintainer's of 2026-09-19: is the canvas
// element "truly light". Kinds: `offscreen` is new OffscreenCanvas(1, 1); `element` is document.createElement('canvas') at
// its default 300 x 150; `element1` and `element0` set width = height = 1 and 0 first. No canvas is ever connected, except
// the flush probe's control. The element measures at the device font size (CSS size x devicePixelRatio), the offscreen at
// the CSS size, as the port's two paths did (commit 872c0da on x-sysui).
// - C1 create: the time to make N canvases with a 2D context, kept alive, N = 1 to 10,000, bare and with the seven
//   assignments of measure/canvas.ts contextFor; with willReadFrequently too.
// - C2 setters: each assignment alone over 2,000 fresh contexts, and ctx.font set again and set to a new size.
// - C3 measure: the first measureText of 2,000 fresh contexts, then one context over the distinct words of the chat bench's
//   first 1,000 messages (rebuild/bench/cases.ts buildChat), a first pass and five more.
// - C4 shape: 10,000 chat messages' worth of work per kind and pass: per message 3.6 contexts (mix) or 2.9 (latin) made,
//   assigned and dropped, and about 120 (mix) or 82 (latin) measureText calls on strings cut from the message, the counts
//   research/BENCH-NIGHT.md gives for Firefox. An emulation of the bench's shape, not the library.
// - C5 flush: a page of 30,000 styled blocks; style made dirty (a class that restyles every block), then layout (a width);
//   then ctx.font and measureText timed on a detached element, an OffscreenCanvas and a connected element (the control:
//   nsComputedDOMStyle::GetComputedStyle flushes style for an element in a document, nsComputedDOMStyle.cpp:484-491), and
//   the offsetWidth read after it, beside the same read with no canvas call between.
// - C6 fonts: a FontFace added to document.fonts and never loaded, measured on each kind: does measuring start the load,
//   how long the call takes, and whether a context made before the face loaded, or before it existed, takes it later.
// - C7 page: widths of words in the DOM beside the element at the device size and the offscreen at the CSS size, in app
//   units, for running under --firefox-prefs with another layout.css.devPixelsPerPx; and an element of a display: none
//   iframe's document, which has no pres shell.
// - C8 freeing: 10,000 contexts made and dropped, garbage made to bring a collection on, then 20 s of a 5 ms timer chain:
//   the waits of 10 ms or more are the main thread's pauses while the dead canvases are freed. A context and its canvas hold
//   each other, so only the cycle collector frees them, and a canvas element with a 2D context also leaves the observer
//   service (HTMLCanvasElement.cpp:459-462, :476-479). The row `none` drops 10,000 plain objects.
// - C9 freeing-buffers: C8 saw no pause in any row and, by the M2 runs, no freeing either. C9 puts 32 MiB buffers in the
//   garbage and keeps the timer chain running across it.
// - M rss: one kind per browser run: 1,000 live contexts, then 10,000, then dropped, with Date.now() marks that
//   gecko-element-cost-rss.ts reads beside its ps samples of the content process. M2 is the same with 32 MiB buffers in
//   the garbage after the drop and a wait of 40 s: the 1 x 1 element and the OffscreenCanvas gave nothing back within M's 15 s.
//
// Run (timing sets alone on the machine, each under 5 minutes; prefs: { "privacy.reduceTimerPrecision": false }):
//   python3 .artifacts/session/with-browser-lock.py ff-element-cost --exclusive -- bun rebuild/probes/runner.ts \
//     --browser=firefox --probes=rebuild/probes/gecko-element-cost.ts --only=C1 --firefox-prefs=<prefs.json> \
//     --probe-timeout-ms=240000 --stall-ms=300000 --out=<out>
//   python3 .artifacts/session/with-browser-lock.py ff-element-rss -- bun rebuild/probes/gecko-element-cost-rss.ts \
//     --only='M rss element-default' --out=<out>
import { buildChat, chatText } from '../bench/cases.ts'
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const dpr = window.devicePixelRatio;
const FAMILY = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const KINDS = ['offscreen', 'element', 'element1', 'element0'];
const canvasOf = kind => {
  if (kind === 'offscreen') return new OffscreenCanvas(1, 1);
  const c = document.createElement('canvas');
  if (kind === 'element1') { c.width = 1; c.height = 1; }
  if (kind === 'element0') { c.width = 0; c.height = 0; }
  return c;
};
const make = (kind, options) => options === undefined ? canvasOf(kind).getContext('2d') : canvasOf(kind).getContext('2d', options);
// The font size a kind measures at: the device size on an element, the CSS size on an OffscreenCanvas.
const sizeOf = (kind, css) => kind === 'offscreen' ? css : css * dpr;
const assign = (ctx, font, lang, letterSpacing, direction) => {
  ctx.lang = lang; ctx.font = font; ctx.letterSpacing = letterSpacing; ctx.wordSpacing = '0px';
  ctx.fontKerning = 'auto'; ctx.textRendering = 'auto'; ctx.direction = direction;
};
const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length === 0 ? null : s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const stats = list => ({ median: median(list), min: Math.min(...list), max: Math.max(...list), runs: list.length });
// The smallest step performance.now() shows, so a reader knows what a short time is worth.
const timerStep = () => { let step = Infinity, last = performance.now(); for (let i = 0; i < 200000; i++) { const t = performance.now(); if (t > last) { step = Math.min(step, t - last); last = t; } } return step; };
// A fixed integer loop, to see whether the page ran slowly (a background page under load).
const arithmetic = () => { const t0 = performance.now(); let x = 1; for (let i = 0; i < 30000000; i++) x = (x * 1664525 + 1013904223) | 0; return { ms: performance.now() - t0, x }; };
const sleep = ms => new Promise(done => setTimeout(done, ms));
`

const C1 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), rows: [] };
const variants = [];
for (let k = 0; k < KINDS.length; k++) variants.push({ kind: KINDS[k], options: undefined, assigned: false }, { kind: KINDS[k], options: undefined, assigned: true });
variants.push({ kind: 'offscreen', options: { willReadFrequently: true }, assigned: false }, { kind: 'element', options: { willReadFrequently: true }, assigned: false });
const counts = [1, 10, 100, 1000, 10000];
for (let c = 0; c < counts.length; c++) {
  const n = counts[c];
  const runs = n >= 10000 ? 5 : n >= 1000 ? 9 : 51;
  const times = variants.map(() => []);
  for (let r = 0; r < runs; r++) {
    for (let v0 = 0; v0 < variants.length; v0++) {
      const v = (v0 + r) % variants.length;
      const variant = variants[v];
      const font = sizeOf(variant.kind, 16) + 'px ' + FAMILY;
      const keep = new Array(n);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const ctx = make(variant.kind, variant.options);
        if (variant.assigned) assign(ctx, font, 'en', '0px', 'ltr');
        keep[i] = ctx;
      }
      times[v].push(performance.now() - t0);
      keep.length = 0;
    }
  }
  for (let v = 0; v < variants.length; v++) {
    const s = stats(times[v]);
    out.rows.push({ kind: variants[v].kind, willReadFrequently: variants[v].options !== undefined, assigned: variants[v].assigned, n, ms: s, usEach: s.median * 1000 / n });
  }
}
out.arithmeticAfter = arithmetic();
return out;
`

const C2 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), rows: [] };
const n = 2000, runs = 5;
const steps = [
  ['lang', (ctx, kind) => { ctx.lang = 'en'; }],
  ['font', (ctx, kind) => { ctx.font = sizeOf(kind, 16) + 'px ' + FAMILY; }],
  ['letterSpacing', (ctx, kind) => { ctx.letterSpacing = '0.001px'; }],
  ['wordSpacing', (ctx, kind) => { ctx.wordSpacing = '0px'; }],
  ['fontKerning', (ctx, kind) => { ctx.fontKerning = 'auto'; }],
  ['textRendering', (ctx, kind) => { ctx.textRendering = 'auto'; }],
  ['direction', (ctx, kind) => { ctx.direction = 'ltr'; }],
  ['font, the same string again', (ctx, kind) => { ctx.font = sizeOf(kind, 16) + 'px ' + FAMILY; }],
  ['font, a new size', (ctx, kind) => { ctx.font = sizeOf(kind, 17) + 'px ' + FAMILY; }],
];
const times = {};
for (let r = 0; r < runs; r++) {
  for (let k0 = 0; k0 < KINDS.length; k0++) {
    const kind = KINDS[(k0 + r) % KINDS.length];
    const list = new Array(n);
    for (let i = 0; i < n; i++) list[i] = make(kind);
    for (let s = 0; s < steps.length; s++) {
      const step = steps[s][1];
      const t0 = performance.now();
      for (let i = 0; i < n; i++) step(list[i], kind);
      const key = kind + '|' + steps[s][0];
      (times[key] = times[key] || []).push((performance.now() - t0) * 1000 / n);
    }
  }
}
for (const key in times) out.rows.push({ kind: key.split('|')[0], step: key.split('|')[1], usEach: stats(times[key]) });
out.arithmeticAfter = arithmetic();
return out;
`

const C3 = (words: string[]): string => String.raw`
const WORDS = ${JSON.stringify(words)};
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), words: WORDS.length, first: [], passes: [] };
// Font matching, fallback fonts and character maps load once per process: a throwaway pass per kind at sizes nothing below uses.
for (let k = 0; k < KINDS.length; k++) {
  const ctx = make(KINDS[k]);
  assign(ctx, sizeOf(KINDS[k], 13) + 'px ' + FAMILY, 'en', '0px', 'ltr');
  for (let i = 0; i < WORDS.length; i++) ctx.measureText(WORDS[i]);
}
// The first measureText of a fresh context, the same common word in each, 2,000 contexts a run.
const n = 2000, runs = 5;
const firstTimes = {}, secondTimes = {};
for (let r = 0; r < runs; r++) {
  for (let k0 = 0; k0 < KINDS.length; k0++) {
    const kind = KINDS[(k0 + r) % KINDS.length];
    const list = new Array(n);
    for (let i = 0; i < n; i++) { list[i] = make(kind); assign(list[i], sizeOf(kind, 16) + 'px ' + FAMILY, 'en', '0px', 'ltr'); }
    let t0 = performance.now();
    for (let i = 0; i < n; i++) list[i].measureText('the');
    (firstTimes[kind] = firstTimes[kind] || []).push((performance.now() - t0) * 1000 / n);
    t0 = performance.now();
    for (let i = 0; i < n; i++) list[i].measureText('the');
    (secondTimes[kind] = secondTimes[kind] || []).push((performance.now() - t0) * 1000 / n);
  }
}
for (const kind in firstTimes) out.first.push({ kind, firstUsEach: stats(firstTimes[kind]), secondUsEach: stats(secondTimes[kind]) });
// One context over every distinct word: a first pass (shaping) and five more (Gecko keeps shaped words per font). Sizes are
// each kind's own and the other's, to tell the kind from the size. The shaped words are kept per font, size and app units
// per pixel (60 on an OffscreenCanvas, the page's on an element), so no variant meets a word another shaped; the 1 x 1
// element takes half a pixel more for that.
const variants = [['offscreen', 16], ['element', 16 * dpr], ['element1', 16 * dpr + 0.5], ['offscreen', 16 * dpr], ['element', 16]];
for (let v = 0; v < variants.length; v++) {
  const kind = variants[v][0], px = variants[v][1];
  const ctx = make(kind);
  assign(ctx, px + 'px ' + FAMILY, 'en', '0px', 'ltr');
  const row = { kind, px, passMs: [], sum: 0 };
  for (let pass = 0; pass < 6; pass++) {
    let sum = 0;
    const t0 = performance.now();
    for (let i = 0; i < WORDS.length; i++) sum += ctx.measureText(WORDS[i]).width;
    row.passMs.push(performance.now() - t0);
    row.sum = sum;
  }
  row.firstPassUsEach = row.passMs[0] * 1000 / WORDS.length;
  row.laterUsEach = median(row.passMs.slice(1)) * 1000 / WORDS.length;
  out.passes.push(row);
}
out.arithmeticAfter = arithmetic();
return out;
`

const C4 = (set: string, messages: string[], perWord: number): string => String.raw`
const MESSAGES = ${JSON.stringify(messages)};
const SET = ${JSON.stringify(set)}, PER_WORD = ${String(perWord)};
const out = { dpr, set: SET, messages: MESSAGES.length, timerStep: timerStep(), arithmeticBefore: arithmetic(), passes: [] };
// Per message: the base context, the one at the large size (advance.ts largeContext: the size times 2^k under 2000px), the
// one with ligatures off (letterSpacing 0.001px), and on the mix a right-to-left one in 3 messages of 5; on latin no
// ligatures-off context in 1 message of 10. Per word up to PER_WORD strings: the word, the word and the next, the word
// between its neighbours, its two halves, and the phrase of up to 8 words ending at it.
// Kinds take turns every 500 messages, so a change in the machine's load during a pass falls on all of them alike. The 1 x 1
// element measures half a pixel larger, so it doesn't meet the words the 300 x 150 element shaped (same font, same app units).
const run = (kind, from, to, totals) => {
  const base = sizeOf(kind, 16) + (kind === 'element1' ? 0.5 : 0);
  let large = base; while (large * 2 <= 2000) large *= 2;
  const baseFont = base + 'px ' + FAMILY, largeFont = large + 'px ' + FAMILY;
  let contexts = 0, calls = 0, sum = 0, makeMs = 0;
  const t0 = performance.now();
  for (let m = from; m < to; m++) {
    const words = MESSAGES[m].split(' ');
    const tm = performance.now();
    const a = make(kind); assign(a, baseFont, 'en', '0px', 'ltr');
    const b = make(kind); assign(b, largeFont, 'en', '0px', 'ltr');
    contexts += 2;
    let c = null, d = null;
    if (SET === 'mix' || m % 10 !== 0) { c = make(kind); assign(c, baseFont, 'en', '0.001px', 'ltr'); contexts++; }
    if (SET === 'mix' && m % 5 < 3) { d = make(kind); assign(d, baseFont, 'en', '0px', 'rtl'); contexts++; }
    makeMs += performance.now() - tm;
    sum += b.measureText(words[0]).width; calls++;
    if (c !== null) { sum += c.measureText(words[0]).width; calls++; }
    if (d !== null) { sum += d.measureText(words[0]).width; calls++; }
    for (let i = 0; i < words.length; i++) {
      const w = words[i], half = (w.length + 1) >> 1;
      sum += a.measureText(w).width; calls++;
      if (PER_WORD > 1 && i + 1 < words.length) { sum += a.measureText(w + ' ' + words[i + 1]).width; calls++; }
      if (PER_WORD > 2 && i > 0 && i + 1 < words.length) { sum += a.measureText(words[i - 1] + ' ' + w + ' ' + words[i + 1]).width; calls++; }
      if (PER_WORD > 3) { sum += b.measureText(w.slice(0, half)).width; calls++; }
      if (PER_WORD > 4 && c !== null && half < w.length) { sum += c.measureText(w.slice(half)).width; calls++; }
      if (PER_WORD > 5) { sum += a.measureText(words.slice(Math.max(0, i - 7), i + 1).join(' ')).width; calls++; }
    }
  }
  totals.ms += performance.now() - t0; totals.makeMs += makeMs; totals.contexts += contexts; totals.calls += calls; totals.sum += sum;
};
const order = ['offscreen', 'element', 'element1'];
const CHUNK = 500;
for (let pass = 0; pass < 3; pass++) {
  const totals = order.map(kind => ({ kind, pass, ms: 0, makeMs: 0, contexts: 0, calls: 0, sum: 0 }));
  for (let from = 0, turn = pass; from < MESSAGES.length; from += CHUNK, turn++) {
    for (let k0 = 0; k0 < order.length; k0++) {
      const k = (k0 + turn) % order.length;
      run(order[k], from, Math.min(MESSAGES.length, from + CHUNK), totals[k]);
    }
  }
  for (let k = 0; k < totals.length; k++) {
    const row = totals[k];
    row.contextsPerMessage = row.contexts / MESSAGES.length; row.callsPerMessage = row.calls / MESSAGES.length; row.usPerMessage = row.ms * 1000 / MESSAGES.length;
    out.passes.push(row);
  }
}
out.arithmeticAfter = arithmetic();
return out;
`

const C5 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), blocks: 30000, rows: [] };
const style = document.createElement('style');
style.textContent = '.fc-item { display: block; font: 14px Arial; } .fc-root.fc-alt .fc-item { font-size: 15px; padding-left: 1px; }';
document.head.append(style);
const root = document.createElement('div');
root.className = 'fc-root';
root.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px;';
const parts = [];
for (let i = 0; i < out.blocks; i++) parts.push('<div class="fc-item">block ' + i + ' of some words that wrap when the box is narrow</div>');
root.innerHTML = parts.join('');
document.body.append(root);
const connected = document.createElement('canvas');
host.append(connected);
const surfaces = { 'detached element': make('element'), 'detached element, 1 x 1': make('element1'), offscreen: make('offscreen'), 'connected element (control)': connected.getContext('2d') };
for (const name in surfaces) { surfaces[name].lang = 'en'; surfaces[name].font = '20px Arial'; surfaces[name].measureText('warm'); }
root.offsetWidth;
let serial = 0, alt = false, width = 600;
const dirty = { clean: () => {}, 'style dirty': () => { alt = !alt; root.classList.toggle('fc-alt', alt); }, 'layout dirty': () => { width = width === 600 ? 590 : 600; root.style.width = width + 'px'; } };
const time = f => { const t0 = performance.now(); f(); return performance.now() - t0; };
const runs = 7;
for (const state in dirty) {
  const alone = [];
  for (let r = 0; r < runs; r++) { root.offsetWidth; dirty[state](); alone.push(time(() => root.offsetWidth)); }
  out.rows.push({ state, surface: 'no canvas call', readAfterMs: stats(alone) });
  for (const name in surfaces) {
    const ctx = surfaces[name];
    const fontMs = [], measureMs = [], readAfterMs = [];
    for (let r = 0; r < runs; r++) {
      root.offsetWidth;
      dirty[state]();
      serial++;
      // A font string and a text the context hasn't met, so no cache answers.
      fontMs.push(time(() => { ctx.font = (20 + serial / 8) + 'px Arial'; }));
      measureMs.push(time(() => { ctx.measureText('flush probe ' + serial); }));
      readAfterMs.push(time(() => root.offsetWidth));
    }
    out.rows.push({ state, surface: name, fontMs: stats(fontMs), measureMs: stats(measureMs), readAfterMs: stats(readAfterMs) });
  }
}
// The port's other assignments on a dirty page, the detached element only.
{
  const ctx = surfaces['detached element'];
  const assignMs = [], readAfterMs = [];
  for (let r = 0; r < runs; r++) {
    root.offsetWidth;
    dirty['style dirty']();
    serial++;
    assignMs.push(time(() => assign(ctx, (20 + serial / 8) + 'px Arial', 'en', r % 2 === 0 ? '0.001px' : '0px', r % 2 === 0 ? 'rtl' : 'ltr')));
    readAfterMs.push(time(() => root.offsetWidth));
  }
  out.rows.push({ state: 'style dirty', surface: 'detached element, all seven assignments', fontMs: stats(assignMs), readAfterMs: stats(readAfterMs) });
}
root.remove(); style.remove(); connected.remove();
out.arithmeticAfter = arithmetic();
return out;
`

const C6 = String.raw`
const out = { dpr, timerStep: timerStep(), rows: [] };
const text = 'Hamburgefonstiv';
const time = f => { const t0 = performance.now(); const value = f(); return { ms: performance.now() - t0, value }; };
const files = { offscreen: '/fonts/amiri.ttf', element: '/fonts/shantell-sans-regular.ttf', element1: '/fonts/noto-naskh-arabic.ttf' };
const kinds = ['offscreen', 'element', 'element1'];
for (let k = 0; k < kinds.length; k++) {
  const kind = kinds[k], family = 'ProbePending' + k, late = 'ProbeLate' + k;
  const px = sizeOf(kind, 16);
  // A context whose font names a family that doesn't exist yet.
  const before = make(kind); assign(before, px + 'px ' + late + ', Arial', 'en', '0px', 'ltr');
  const lateBefore = before.measureText(text).width;
  const face = new FontFace(family, 'url(' + files[kind] + ')');
  document.fonts.add(face);
  const row = { kind, px, statusAdded: face.status, fontsStatusAdded: document.fonts.status };
  const ctx = make(kind);
  const set = time(() => assign(ctx, px + 'px ' + family + ', Arial', 'en', '0px', 'ltr'));
  row.assignMs = set.ms; row.statusAfterAssign = face.status;
  const first = time(() => ctx.measureText(text).width);
  row.firstMeasureMs = first.ms; row.widthWhilePending = first.value; row.statusAfterMeasure = face.status; row.fontsStatusAfterMeasure = document.fonts.status;
  const fallback = make(kind); assign(fallback, px + 'px Arial', 'en', '0px', 'ltr');
  row.widthArial = fallback.measureText(text).width;
  const loaded = await Promise.race([face.loaded.then(() => 'loaded', e => 'error: ' + e), sleep(8000).then(() => 'timeout')]);
  row.loaded = loaded; row.statusAfterWait = face.status;
  row.widthSameContextAfterLoad = ctx.measureText(text).width;
  const fresh = make(kind); assign(fresh, px + 'px ' + family + ', Arial', 'en', '0px', 'ltr');
  row.widthFreshContextAfterLoad = fresh.measureText(text).width;
  // The same bytes under the late family's name, added loaded: does the old context take it without ctx.font again?
  const bytes = await (await fetch(files[kind])).arrayBuffer();
  const lateFace = new FontFace(late, bytes);
  await lateFace.load();
  document.fonts.add(lateFace);
  row.lateWidthBefore = lateBefore;
  row.lateWidthOldContext = before.measureText(text).width;
  const lateFresh = make(kind); assign(lateFresh, px + 'px ' + late + ', Arial', 'en', '0px', 'ltr');
  row.lateWidthFreshContext = lateFresh.measureText(text).width;
  document.fonts.delete(face);
  row.widthSameContextAfterDelete = ctx.measureText(text).width;
  document.fonts.delete(lateFace);
  out.rows.push(row);
}
return out;
`

const C7 = String.raw`
const out = { dpr, rows: [], hidden: null, visibility: document.visibilityState, focus: document.hasFocus() };
const apd = Math.max(1, Math.floor(60 / dpr + 0.5)); // nsDeviceContext.cpp:52-63
out.apd = apd;
const words = ['the', 'modern', 'workers', 'AVATAR', 'Toward', 'waffles', 'information', 'Yo', 'P,', 'T.', 'fifty', 'quickly', 'jumped', 'William', 'Wyoming', '1977', 'rhythm', 'Tokyo', 'Avery', 'LT'];
const fonts = [[16, '"Helvetica Neue"'], [15, '"Helvetica Neue"'], [14, 'Verdana'], [17, 'Georgia'], [16, '"Times New Roman"'], [13, 'Arial'], [16, 'system-ui']];
const domAuOf = (font, word) => {
  const span = document.createElement('span');
  span.style.cssText = 'position: absolute; left: 0; top: 0; white-space: pre; font: ' + font;
  span.lang = 'en';
  span.textContent = word;
  host.append(span);
  const range = document.createRange();
  range.selectNodeContents(span);
  const au = range.getBoundingClientRect().width * 60;
  span.remove();
  return au;
};
for (let f = 0; f < fonts.length; f++) {
  const css = fonts[f][0], family = fonts[f][1];
  const device = Math.round(css * 60) / apd;
  const element = make('element'); assign(element, device + 'px ' + family, 'en', '0px', 'ltr');
  const naive = make('element'); assign(naive, css * dpr + 'px ' + family, 'en', '0px', 'ltr');
  const offscreen = make('offscreen'); assign(offscreen, css + 'px ' + family, 'en', '0px', 'ltr');
  const row = { font: css + 'px ' + family, device, elementFontRead: element.font, words: words.length, elementEqual: 0, naiveEqual: 0, offscreenEqual: 0, offscreenWithin1: 0, misses: [] };
  for (let w = 0; w < words.length; w++) {
    const dom = Math.round(domAuOf(css + 'px ' + family, words[w]));
    const e = Math.round(element.measureText(words[w]).width * apd), n = Math.round(naive.measureText(words[w]).width * apd), o = Math.round(offscreen.measureText(words[w]).width * 60);
    if (e === dom) row.elementEqual++; else row.misses.push({ word: words[w], dom, element: e, offscreen: o });
    if (n === dom) row.naiveEqual++;
    if (o === dom) row.offscreenEqual++;
    if (Math.abs(o - dom) <= 1) row.offscreenWithin1++;
  }
  out.rows.push(row);
}
// A document without a pres shell: an element made by a display: none iframe's document.
const frame = document.createElement('iframe');
frame.style.display = 'none';
host.append(frame);
const inner = frame.contentDocument.createElement('canvas').getContext('2d');
assign(inner, 16 * dpr + 'px system-ui', 'en', '0px', 'ltr');
const outer = make('element'); assign(outer, 16 * dpr + 'px system-ui', 'en', '0px', 'ltr');
const off = make('offscreen'); assign(off, 16 * dpr + 'px system-ui', 'en', '0px', 'ltr');
out.hidden = { text: 'workers', hiddenFrameElement: inner.measureText('workers').width, pageElement: outer.measureText('workers').width, offscreenSameString: off.measureText('workers').width };
frame.remove();
return out;
`

const C8 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), contexts: 10000, rows: [] };
// A 5 ms timer chain for ms milliseconds: every wait of 10 ms or more between two ticks is a pause of the main thread.
const watch = ms => new Promise(done => {
  const pauses = [];
  const start = performance.now();
  let last = start, ticks = 0;
  const tick = () => {
    const t = performance.now();
    ticks++;
    if (t - last >= 10) pauses.push(+(t - last - 5).toFixed(2));
    last = t;
    if (t - start < ms) setTimeout(tick, 5); else done({ ticks, pauses: pauses.length, pausedMs: +pauses.reduce((a, b) => a + b, 0).toFixed(1), longestMs: pauses.length === 0 ? 0 : Math.max(...pauses) });
  };
  setTimeout(tick, 5);
});
const kinds = ['none', 'offscreen', 'element', 'element1'];
for (let round = 0; round < 2; round++) for (let k0 = 0; k0 < kinds.length; k0++) {
  const kind = kinds[(k0 + round) % kinds.length];
  let live = [];
  const t0 = performance.now();
  for (let i = 0; i < out.contexts; i++) {
    if (kind === 'none') { live.push({ i }); continue; }
    const ctx = make(kind); assign(ctx, sizeOf(kind, 16) + 'px ' + FAMILY, 'en', '0px', 'ltr'); ctx.measureText('the'); live.push(ctx);
  }
  const makeMs = performance.now() - t0;
  live = null;
  // Garbage brings a collection on, as in the M probes; then 20 s of watching while the dead contexts are freed.
  const tg = performance.now();
  for (let r = 0; r < 20; r++) { const junk = []; for (let i = 0; i < 100000; i++) junk.push([i, String(i)]); await sleep(20); }
  const garbageMs = performance.now() - tg;
  const watched = await watch(20000);
  out.rows.push({ round, kind, makeMs, garbageMs, ...watched });
}
out.arithmeticAfter = arithmetic();
return out;
`

const C9 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), contexts: 10000, rows: [] };
// C8 watched after its garbage and saw no pause in any row, the control included; the M2 runs then showed that the dead
// contexts go during garbage that holds 32 MiB buffers, not after it. So here the 5 ms timer chain runs across the garbage
// rounds too, and each round is one short task: a wait of 10 ms or more between two ticks is a pause, less the round's own
// time, which the row 'none' (10,000 plain objects, the same garbage) gives.
const kinds = ['none', 'offscreen', 'element', 'element1'];
for (let round = 0; round < 2; round++) for (let k0 = 0; k0 < kinds.length; k0++) {
  const kind = kinds[(k0 + round) % kinds.length];
  let live = [];
  for (let i = 0; i < out.contexts; i++) {
    if (kind === 'none') { live.push({ i }); continue; }
    const ctx = make(kind); assign(ctx, sizeOf(kind, 16) + 'px ' + FAMILY, 'en', '0px', 'ltr'); ctx.measureText('the'); live.push(ctx);
  }
  live = null;
  const pauses = [];
  let last = performance.now(), ticks = 0, watching = true;
  const tick = () => { const t = performance.now(); ticks++; if (t - last >= 10) pauses.push(+(t - last - 5).toFixed(2)); last = t; if (watching) setTimeout(tick, 5); };
  setTimeout(tick, 5);
  for (let r = 0; r < 40; r++) {
    const junk = [];
    for (let i = 0; i < 20000; i++) junk.push([i, String(i)]);
    junk.push(new ArrayBuffer(32 * 1024 * 1024));
    await sleep(100);
  }
  await sleep(12000);
  watching = false;
  pauses.sort((a, b) => b - a);
  out.rows.push({ round, kind, ticks, pauses: pauses.length, pausedMs: +pauses.reduce((a, b) => a + b, 0).toFixed(1), longest: pauses.slice(0, 5) });
}
out.arithmeticAfter = arithmetic();
return out;
`

const RSS = (kind: string, buffers: boolean): string => String.raw`
const KIND = ${JSON.stringify(kind)}, BUFFERS = ${String(buffers)};
const marks = [];
const mark = name => marks.push({ name, at: Date.now() });
const live = [];
// The kind 'none' keeps 10,000 plain objects: what the garbage rounds alone leave in the resident size.
const grow = to => { while (live.length < to) { if (KIND === 'none') { live.push({ i: live.length }); continue; } const ctx = make(KIND); assign(ctx, sizeOf(KIND, 16) + 'px ' + FAMILY, 'en', '0px', 'ltr'); ctx.measureText('the'); live.push(ctx); } };
await sleep(4000);
mark('before');
grow(1000);
mark('made 1,000');
await sleep(4000);
mark('settled 1,000');
grow(10000);
mark('made 10,000');
await sleep(4000);
mark('settled 10,000');
live.length = 0;
// No page can ask Firefox for a collection. Garbage brings one on: 40 rounds of 100,000 short arrays, a pause between. With
// BUFFERS each round also makes and drops a 32 MiB ArrayBuffer, whose bytes count toward the collector's malloc trigger
// (a 300 x 150 canvas's wrapper reports 180,000 bytes that way, a 1 x 1 one 4: CanvasRenderingContext2D.cpp:7529-7543).
for (let round = 0; round < 40; round++) {
  const junk = [];
  for (let i = 0; i < 100000; i++) junk.push([i, String(i)]);
  if (BUFFERS) junk.push(new ArrayBuffer(32 * 1024 * 1024));
  await sleep(100);
}
mark('dropped, garbage made');
await sleep(15000);
mark('dropped, 15 s later');
if (BUFFERS) { await sleep(25000); mark('dropped, 40 s later'); }
return { kind: KIND, buffers: BUFFERS, dpr, marks };
`

export default function probes(): Probe[] {
  const probe = (id: string, spec: string, source: string): Probe => ({
    id,
    spec,
    pageLang: 'en',
    observe: [{ kind: 'script', source: `${HELPERS}${source}` }],
    browsers: ['firefox'],
    note: 'Measurement only.',
  })
  const mix = buildChat('mix', 10000).map(chatText)
  const latin = buildChat('latin', 10000).map(chatText)
  const distinct = new Set<string>()
  for (let m = 0; m < 1000; m++) {
    const words = mix[m]!.split(' ')
    for (let i = 0; i < words.length; i++) if (words[i] !== '') distinct.add(words[i]!)
  }
  return [
    probe('gecko-element-cost C1 create', 'gecko-element-cost C1: the time to make N canvases with a 2D context, by kind', C1),
    probe('gecko-element-cost C2 setters', 'gecko-element-cost C2: each of the port\'s assignments, by kind', C2),
    probe('gecko-element-cost C3 measure', 'gecko-element-cost C3: the first measureText of a context and the steady state on the chat bench\'s words', C3([...distinct])),
    probe('gecko-element-cost C4 shape mix', 'gecko-element-cost C4: 10,000 chat messages\' worth of contexts and calls, the mix', C4('mix', mix, 6)),
    probe('gecko-element-cost C4 shape latin', 'gecko-element-cost C4: 10,000 chat messages\' worth of contexts and calls, plain ASCII', C4('latin', latin, 4)),
    probe('gecko-element-cost C5 flush', 'gecko-element-cost C5: does ctx.font or measureText flush a dirty page\'s style or layout', C5),
    probe('gecko-element-cost C6 fonts', 'gecko-element-cost C6: a FontFace that isn\'t loaded, and faces added after a context was made', C6),
    probe('gecko-element-cost C7 page', 'gecko-element-cost C7: DOM widths beside each kind in app units, and a document without a pres shell', C7),
    probe('gecko-element-cost C8 freeing', 'gecko-element-cost C8: main-thread pauses while 10,000 dropped contexts are freed', C8),
    probe('gecko-element-cost C9 freeing-buffers', 'gecko-element-cost C9: main-thread pauses across garbage that brings the collection on, 10,000 dropped contexts', C9),
    probe('gecko-element-cost M rss offscreen', 'gecko-element-cost M: marks around 1,000 and 10,000 live contexts, OffscreenCanvas', RSS('offscreen', false)),
    probe('gecko-element-cost M rss element-default', 'gecko-element-cost M: marks around 1,000 and 10,000 live contexts, a canvas element at 300 x 150', RSS('element', false)),
    probe('gecko-element-cost M rss element-1x1', 'gecko-element-cost M: marks around 1,000 and 10,000 live contexts, a canvas element at 1 x 1', RSS('element1', false)),
    probe('gecko-element-cost M2 rss-buffers none', 'gecko-element-cost M2: the same garbage and waits with no canvas made, the control', RSS('none', true)),
    probe('gecko-element-cost M2 rss-buffers offscreen', 'gecko-element-cost M2: the same with 32 MiB buffers in the garbage and a longer wait, OffscreenCanvas', RSS('offscreen', true)),
    probe('gecko-element-cost M2 rss-buffers element-default', 'gecko-element-cost M2: the same with 32 MiB buffers in the garbage and a longer wait, a canvas element at 300 x 150', RSS('element', true)),
    probe('gecko-element-cost M2 rss-buffers element-1x1', 'gecko-element-cost M2: the same with 32 MiB buffers in the garbage and a longer wait, a canvas element at 1 x 1', RSS('element1', true)),
  ]
}
