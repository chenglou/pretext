// A second look at gecko-element-cost.ts's verdict (a detached canvas element is a light measuring surface in Firefox), pinned
// Firefox 156.0: probes of what that file didn't try. Measurement only, raw values, no `checks`. Kinds as there: `offscreen` is
// new OffscreenCanvas(1, 1), `element1` a detached document.createElement('canvas') with width = height = 1. The element
// measures at the device font size (CSS size x devicePixelRatio), the offscreen at the CSS size.
// - K1 sheet: a page of 30,000 blocks and a style sheet of 3,000 rules; then a change to the page's style sheets (a rule
//   inserted that matches nothing, a rule inserted that matches every block, a style element appended), which is what a
//   CSS-in-JS library does while an app renders. Any such change marks the document's font set dirty
//   (Document::ApplicableStylesChanged, Document.cpp:8072-8080), and Document::FlushUserFontSet then brings the style sheet
//   data up to date (ServoStyleSet::AppendFontFaceRules calls UpdateStylistIfNeeded, ServoStyleSet.cpp:1336-1341;
//   Document.cpp:18877-18890). An element's context calls it in ctx.font and in every measureText
//   (CanvasRenderingContext2D.cpp:4343, :5161-5164); an OffscreenCanvas's only in ctx.font (:4446-4448), since its measureText
//   has no pres shell. Timed: the first canvas call after the change, the next one, and the offsetWidth read after, beside
//   the read with no canvas call; then 200 rule inserts with a measureText on a kept context after each.
// - K1b sheet-scale: K1's inserted rule that matches nothing, then one measureText on the kept element context, on pages of
//   1,000 or 30,000 blocks with style sheets of 0, 3,000 or 20,000 rules: what the forced update grows with.
// - K2 declarations: D distinct font declarations taking turns (families x weights x styles x sizes), D = 1 to 1,024. Fresh
//   contexts as the port makes them today, per context: made, assigned, one measureText. The element takes its font group
//   from the page's font cache, 128 entries searched one by one (nsFontCache.cpp:59-112, nsFontCache.h:53); the
//   OffscreenCanvas builds one per context (CanvasRenderingContext2D.cpp:4589). Then D kept contexts measured in turn.
// - K3 live: 36,000 live contexts of one kind (10,000 kept chat messages at 3.6 contexts each). First what a frame costs:
//   a canvas element's context joins its document's refresh driver as a post-refresh observer when the document has a pres
//   shell, connected or not (SetCanvasElement, nsICanvasRenderingContextInternal.h:73-76, .cpp:183-190), and every tick calls
//   every observer's DidRefresh (nsRefreshDriver.cpp:2595-2598), which is empty for a 2D context
//   (CanvasRenderingContext2D.cpp:1555); an OffscreenCanvas's context has no pres shell and doesn't join. Measured as the time
//   from the end of a requestAnimationFrame callback that moves one small box to a message task posted from it, which runs
//   when the tick is over, before the contexts exist, with them alive and after they are dropped. Then garbage that holds
//   32 MiB buffers while a 5 ms timer chain runs: the waits of 10 ms or more are the main thread's pauses with that many live
//   canvases for the collectors to pass over. Then the contexts are dropped and the same watch runs again. One kind per
//   browser process.
// - K4 freeing-scale: gecko-element-cost C9 at 10,000, 20,000 and 40,000 dropped contexts. A canvas element with a 2D context
//   is an observer of two topics and leaves the observer service when freed (HTMLCanvasElement.cpp:459-462, :476-479,
//   :570-574); the question is whether the freeing pause grows faster than the count.
// - K5 dirty-shape: the chat bench's shape of work (gecko-element-cost C4: per message 3.6 contexts made, assigned and
//   dropped, about 116 measureText calls) over 300 messages on a page whose style, then layout, is dirty the whole time, beside
//   the clean page, and the offsetWidth read after each.
// - K6 font-loaded: 1,000 kept contexts whose font list starts with a FontFace that hasn't loaded; the first measureText of
//   each after the face loads, beside the pass before and the pass after.
//
// Run (timing sets alone on the machine, each under 5 minutes; prefs: { "privacy.reduceTimerPrecision": false }):
//   python3 .artifacts/session/with-browser-lock.py ff-element-check --exclusive -- bun rebuild/probes/runner.ts \
//     --browser=firefox --probes=rebuild/probes/gecko-element-cost-check.ts --only=K1 --firefox-prefs=<prefs.json> \
//     --probe-timeout-ms=240000 --stall-ms=280000 --out=<out>
import { buildChat, chatText } from '../bench/cases.ts'
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const dpr = window.devicePixelRatio;
const FAMILY = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const canvasOf = kind => {
  if (kind === 'offscreen') return new OffscreenCanvas(1, 1);
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  return c;
};
const make = kind => canvasOf(kind).getContext('2d');
const sizeOf = (kind, css) => kind === 'offscreen' ? css : css * dpr;
const assign = (ctx, font, lang, letterSpacing, direction) => {
  ctx.lang = lang; ctx.font = font; ctx.letterSpacing = letterSpacing; ctx.wordSpacing = '0px';
  ctx.fontKerning = 'auto'; ctx.textRendering = 'auto'; ctx.direction = direction;
};
const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length === 0 ? null : s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const stats = list => ({ median: median(list), min: Math.min(...list), max: Math.max(...list), runs: list.length });
const timerStep = () => { let step = Infinity, last = performance.now(); for (let i = 0; i < 200000; i++) { const t = performance.now(); if (t > last) { step = Math.min(step, t - last); last = t; } } return step; };
const arithmetic = () => { const t0 = performance.now(); let x = 1; for (let i = 0; i < 30000000; i++) x = (x * 1664525 + 1013904223) | 0; return { ms: performance.now() - t0, x }; };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const time = f => { const t0 = performance.now(); f(); return performance.now() - t0; };
// The large page: BLOCKS styled blocks under one root, and a style sheet of RULES rules beside the one that styles them.
const buildPage = (blocks, rules) => {
  const style = document.createElement('style');
  const css = ['.kc-item { display: block; font: 14px Arial; } .kc-root.kc-alt .kc-item { font-size: 15px; padding-left: 1px; }'];
  for (let i = 0; i < rules; i++) css.push('.kc-r' + i + ' .kc-part > span.kc-s' + (i % 50) + ':not(.kc-off) { color: rgb(' + (i % 255) + ', 0, 0); }');
  style.textContent = css.join('\n');
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'kc-root';
  root.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px;';
  const parts = [];
  for (let i = 0; i < blocks; i++) parts.push('<div class="kc-item">block ' + i + ' of some words that wrap when the box is narrow</div>');
  root.innerHTML = parts.join('');
  document.body.append(root);
  root.offsetWidth;
  return { style, root };
};
// A 5 ms timer chain: every wait of 10 ms or more between two ticks is a pause of the main thread. stop() gives the pauses,
// longest first, each with the time since the watch began.
const watcher = () => {
  const pauses = [];
  const start = performance.now();
  let last = start, ticks = 0, watching = true;
  const tick = () => { const t = performance.now(); ticks++; if (t - last >= 10) pauses.push({ ms: +(t - last - 5).toFixed(2), atS: +((t - start) / 1000).toFixed(2) }); last = t; if (watching) setTimeout(tick, 5); };
  setTimeout(tick, 5);
  return { stop: () => { watching = false; pauses.sort((a, b) => b.ms - a.ms); return { ticks, pauses: pauses.length, pausedMs: +pauses.reduce((a, b) => a + b.ms, 0).toFixed(1), longest: pauses.slice(0, 6) }; } };
};
// Frames for ms milliseconds: each requestAnimationFrame callback moves a small box and posts a message; the message task
// runs after the refresh driver's tick, so its delay is what the tick did after the callback (style, layout, painting,
// the post-refresh observers).
const frames = ms => new Promise(done => {
  const box = document.createElement('div');
  box.style.cssText = 'position: absolute; left: 0; top: 0; width: 10px; height: 10px; background: red;';
  host.append(box);
  const gaps = [], channel = new MessageChannel();
  const start = performance.now();
  let n = 0, callbackEnd = 0, finished = false;
  channel.port1.onmessage = () => {
    gaps.push(performance.now() - callbackEnd);
    if (finished) { box.remove(); channel.port1.close(); done({ frames: n, perSecond: +(n * 1000 / (performance.now() - start)).toFixed(1), afterCallbackMs: stats(gaps.slice(5)), mean: +(gaps.slice(5).reduce((a, b) => a + b, 0) / Math.max(1, gaps.length - 5)).toFixed(4) }); }
  };
  const frame = () => {
    n++;
    box.style.transform = 'translateX(' + (n % 50) + 'px)';
    if (performance.now() - start > ms) finished = true; else requestAnimationFrame(frame);
    callbackEnd = performance.now();
    channel.port2.postMessage(0);
  };
  requestAnimationFrame(frame);
  // A window that gets no frames (a fully covered one) still ends.
  setTimeout(() => { if (n === 0) { box.remove(); done({ frames: 0 }); } }, ms + 3000);
});
// Garbage that brings a collection on, as gecko-element-cost M2 and C9: 40 rounds, each with a 32 MiB buffer.
const garbage = async () => {
  for (let r = 0; r < 40; r++) {
    const junk = [];
    for (let i = 0; i < 20000; i++) junk.push([i, String(i)]);
    junk.push(new ArrayBuffer(32 * 1024 * 1024));
    await sleep(100);
  }
};
`

const K1 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), blocks: 30000, rules: 3000, rows: [], interleaved: [] };
const page = buildPage(out.blocks, out.rules);
const root = page.root, sheet = page.style.sheet;
let serial = 0;
const added = [];
const changes = {
  'no change': () => {},
  'rule inserted, matches nothing': () => { sheet.insertRule('.kc-new' + serial + ' { color: blue; }', sheet.cssRules.length); },
  'rule inserted, matches every block': () => { sheet.insertRule('.kc-item { outline-color: rgb(' + (serial % 255) + ', 1, 1); }', sheet.cssRules.length); },
  'style element appended': () => { const s = document.createElement('style'); s.textContent = '.kc-extra' + serial + ' { color: green; }'; document.head.append(s); added.push(s); },
};
const kept = { element1: make('element1'), offscreen: make('offscreen') };
for (const kind in kept) { assign(kept[kind], sizeOf(kind, 16) + 'px Arial', 'en', '0px', 'ltr'); kept[kind].measureText('warm'); }
const surfaces = [
  ['no canvas call', null, false],
  ['kept detached element 1 x 1, measureText twice', 'element1', false],
  ['kept OffscreenCanvas, measureText twice', 'offscreen', false],
  ['kept detached element 1 x 1, ctx.font then measureText', 'element1', true],
  ['kept OffscreenCanvas, ctx.font then measureText', 'offscreen', true],
];
const runs = 7;
for (const change in changes) {
  for (let s = 0; s < surfaces.length; s++) {
    const name = surfaces[s][0], kind = surfaces[s][1], setsFont = surfaces[s][2];
    const firstMs = [], secondMs = [], readAfterMs = [];
    for (let r = 0; r < runs; r++) {
      root.offsetWidth;
      serial++;
      changes[change]();
      if (kind !== null) {
        const ctx = kept[kind];
        if (setsFont) firstMs.push(time(() => { ctx.font = (sizeOf(kind, 16) + serial / 4) + 'px Arial'; }));
        else firstMs.push(time(() => { ctx.measureText('sheet probe ' + serial); }));
        secondMs.push(time(() => { ctx.measureText('sheet probe again ' + serial); }));
      }
      readAfterMs.push(time(() => root.offsetWidth));
    }
    const row = { change, surface: name, readAfterMs: stats(readAfterMs) };
    if (kind !== null) { row.firstCallMs = stats(firstMs); row.secondCallMs = stats(secondMs); }
    out.rows.push(row);
  }
}
// What an app that inserts rules while it renders and measures as it goes pays: 200 rule inserts, a measureText on a kept
// context after each (a text the context hasn't met), then one offsetWidth read. 'no canvas call' inserts only.
for (let r = 0; r < 3; r++) {
  const order = ['no canvas call', 'offscreen', 'element1'];
  for (let k0 = 0; k0 < order.length; k0++) {
    const kind = order[(k0 + r) % order.length];
    root.offsetWidth;
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      serial++;
      sheet.insertRule('.kc-loop' + serial + ' { color: blue; }', sheet.cssRules.length);
      if (kind !== 'no canvas call') kept[kind].measureText('loop ' + serial);
    }
    const loopMs = performance.now() - t0;
    const readAfterMs = time(() => root.offsetWidth);
    out.interleaved.push({ round: r, kind, inserts: 200, loopMs, readAfterMs, rulesNow: sheet.cssRules.length });
  }
}
for (let i = 0; i < added.length; i++) added[i].remove();
root.remove(); page.style.remove();
out.arithmeticAfter = arithmetic();
return out;
`

const K1B = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), rows: [] };
const configs = [[1000, 0], [30000, 0], [1000, 3000], [30000, 3000], [1000, 20000], [30000, 20000]];
const kept = { element1: make('element1'), offscreen: make('offscreen') };
for (const kind in kept) { assign(kept[kind], sizeOf(kind, 16) + 'px Arial', 'en', '0px', 'ltr'); kept[kind].measureText('warm'); }
let serial = 0;
const runs = 9;
for (let c = 0; c < configs.length; c++) {
  const page = buildPage(configs[c][0], configs[c][1]);
  const root = page.root, sheet = page.style.sheet;
  const surfaces = [null, 'element1', 'offscreen'];
  for (let s = 0; s < surfaces.length; s++) {
    const kind = surfaces[s];
    const measureMs = [], readAfterMs = [];
    for (let r = 0; r < runs; r++) {
      root.offsetWidth;
      serial++;
      sheet.insertRule('.kc-new' + serial + ' { color: blue; }', sheet.cssRules.length);
      if (kind !== null) measureMs.push(time(() => { kept[kind].measureText('sheet scale ' + serial); }));
      readAfterMs.push(time(() => root.offsetWidth));
    }
    const row = { blocks: configs[c][0], rules: configs[c][1], surface: kind === null ? 'no canvas call' : kind, readAfterMs: stats(readAfterMs) };
    if (kind !== null) row.measureMs = stats(measureMs);
    out.rows.push(row);
  }
  root.remove(); page.style.remove();
  document.body.offsetWidth;
}
out.arithmeticAfter = arithmetic();
return out;
`

const K2 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), fresh: [], kept: [] };
// 1,024 declarations: 8 families (under the 10 family lists within 6 s that report a font fingerprinter, nsFontCache.h:55-60)
// x 2 weights x 2 styles x 32 sizes. CSS sizes 10 to 41 px keep their device sizes apart after Gecko's rounding of a canvas
// font size to 7 bits (QuantizeFontSize, CanvasRenderingContext2D.cpp:4207-4217).
const families = ['"Helvetica Neue"', 'Arial', 'Georgia', 'Verdana', '"Times New Roman"', '"Courier New"', '"Trebuchet MS"', 'Menlo'];
const decls = [];
for (let size = 10; size < 42; size++) for (let f = 0; f < families.length; f++) for (let w = 0; w < 2; w++) for (let s = 0; s < 2; s++) decls.push({ prefix: (s === 1 ? 'italic ' : '') + (w === 1 ? '700 ' : '400 '), size, family: families[f] });
const fontOf = (kind, d) => d.prefix + sizeOf(kind, d.size) + 'px ' + d.family + ', sans-serif';
const kinds = ['offscreen', 'element1'];
const fonts = {};
for (let k = 0; k < kinds.length; k++) fonts[kinds[k]] = decls.map(d => fontOf(kinds[k], d));
const counts = [1, 16, 100, 128, 129, 200, 1024];
const N = 8192, runs = 5;
for (let c = 0; c < counts.length; c++) {
  const D = counts[c];
  // Every declaration once per kind first, so font matching and the platform fonts exist.
  for (let k = 0; k < kinds.length; k++) for (let i = 0; i < D; i++) { const ctx = make(kinds[k]); assign(ctx, fonts[kinds[k]][i], 'en', '0px', 'ltr'); ctx.measureText('the'); }
  const times = { offscreen: [], element1: [] }, fontTimes = { offscreen: [], element1: [] }, measureTimes = { offscreen: [], element1: [] };
  for (let r = 0; r < runs; r++) {
    for (let k0 = 0; k0 < kinds.length; k0++) {
      const kind = kinds[(k0 + r) % kinds.length], list = fonts[kind];
      const keep = new Array(N);
      let t0 = performance.now();
      for (let i = 0; i < N; i++) keep[i] = make(kind);
      const t1 = performance.now();
      for (let i = 0; i < N; i++) assign(keep[i], list[i % D], 'en', '0px', 'ltr');
      const t2 = performance.now();
      for (let i = 0; i < N; i++) keep[i].measureText('the');
      const t3 = performance.now();
      times[kind].push((t3 - t0) * 1000 / N); fontTimes[kind].push((t2 - t1) * 1000 / N); measureTimes[kind].push((t3 - t2) * 1000 / N);
    }
  }
  for (let k = 0; k < kinds.length; k++) out.fresh.push({ declarations: D, kind: kinds[k], contexts: N, usPerContext: stats(times[kinds[k]]), assignUs: stats(fontTimes[kinds[k]]), firstMeasureUs: stats(measureTimes[kinds[k]]) });
}
// D kept contexts, one per declaration, measured in turn: 20 words on each, 3 passes after a first.
const words = ['the', 'modern', 'workers', 'information', 'quickly', 'jumped', 'William', 'Wyoming', 'rhythm', 'Tokyo', 'Avery', 'waffles', 'Toward', 'fifty', 'of', 'and', 'message', 'layout', 'browser', 'canvas'];
const keptCounts = [1, 128, 1024];
for (let c = 0; c < keptCounts.length; c++) {
  const D = keptCounts[c];
  for (let k = 0; k < kinds.length; k++) {
    const kind = kinds[k];
    const list = new Array(D);
    for (let i = 0; i < D; i++) { list[i] = make(kind); assign(list[i], fonts[kind][i], 'en', '0px', 'ltr'); }
    const passUs = [];
    for (let pass = 0; pass < 4; pass++) {
      const t0 = performance.now();
      const loops = Math.max(1, Math.round(1024 / D));
      for (let l = 0; l < loops; l++) for (let w = 0; w < words.length; w++) for (let i = 0; i < D; i++) list[i].measureText(words[w]);
      passUs.push((performance.now() - t0) * 1000 / (loops * words.length * D));
    }
    out.kept.push({ declarations: D, kind, firstPassUsPerCall: passUs[0], laterUsPerCall: median(passUs.slice(1)) });
  }
}
out.arithmeticAfter = arithmetic();
return out;
`

const K3 = (kind: string): string => String.raw`
const KIND = ${JSON.stringify(kind)};
const out = { dpr, kind: KIND, timerStep: timerStep(), arithmeticBefore: arithmetic(), contexts: 36000 };
out.framesBefore = await frames(2500);
let live = [];
const t0 = performance.now();
for (let i = 0; i < out.contexts; i++) {
  if (KIND === 'none') { live.push({ i }); continue; }
  const ctx = make(KIND); assign(ctx, sizeOf(KIND, 16) + 'px ' + FAMILY, 'en', i % 3 === 2 ? '0.001px' : '0px', 'ltr'); ctx.measureText('the'); live.push(ctx);
}
out.makeMs = performance.now() - t0;
await sleep(2000);
out.framesLive = await frames(2500);
// Twice with everything alive: the first watch can hold the collections that tenure the new objects.
for (let round = 0; round < 2; round++) {
  const w = watcher();
  await garbage();
  await sleep(6000);
  out['live, watch ' + (round + 1)] = w.stop();
}
out.stillLive = live.length;
live = null;
const w = watcher();
await garbage();
await sleep(12000);
out['dropped'] = w.stop();
out.framesAfterDrop = await frames(2500);
out.arithmeticAfter = arithmetic();
return out;
`

const K4 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), rows: [] };
const plan = [['none', 40000], ['offscreen', 10000], ['element1', 10000], ['offscreen', 20000], ['element1', 20000], ['offscreen', 40000], ['element1', 40000]];
for (let p = 0; p < plan.length; p++) {
  const kind = plan[p][0], n = plan[p][1];
  let live = [];
  for (let i = 0; i < n; i++) {
    if (kind === 'none') { live.push({ i }); continue; }
    const ctx = make(kind); assign(ctx, sizeOf(kind, 16) + 'px ' + FAMILY, 'en', '0px', 'ltr'); ctx.measureText('the'); live.push(ctx);
  }
  live = null;
  const w = watcher();
  await garbage();
  await sleep(9000);
  out.rows.push({ kind, contexts: n, ...w.stop() });
}
out.arithmeticAfter = arithmetic();
return out;
`

const K5 = (messages: string[]): string => String.raw`
const MESSAGES = ${JSON.stringify(messages)};
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), blocks: 30000, messages: MESSAGES.length, rows: [] };
const page = buildPage(out.blocks, 0);
const root = page.root;
let alt = false, width = 600, turn = 0;
const dirty = { clean: () => {}, 'style dirty': () => { alt = !alt; root.classList.toggle('kc-alt', alt); }, 'layout dirty': () => { width = width === 600 ? 590 : 600; root.style.width = width + 'px'; } };
// gecko-element-cost C4's work for the mix, with a size no earlier turn used, so no shaped word answers from a cache.
const shape = kind => {
  turn++;
  const base = sizeOf(kind, 16) + turn / 4;
  let large = base; while (large * 2 <= 2000) large *= 2;
  const baseFont = base + 'px ' + FAMILY, largeFont = large + 'px ' + FAMILY;
  let sum = 0, calls = 0, contexts = 0;
  for (let m = 0; m < MESSAGES.length; m++) {
    const words = MESSAGES[m].split(' ');
    const a = make(kind); assign(a, baseFont, 'en', '0px', 'ltr');
    const b = make(kind); assign(b, largeFont, 'en', '0px', 'ltr');
    const c = make(kind); assign(c, baseFont, 'en', '0.001px', 'ltr');
    contexts += 3;
    let d = null;
    if (m % 5 < 3) { d = make(kind); assign(d, baseFont, 'en', '0px', 'rtl'); contexts++; sum += d.measureText(words[0]).width; calls++; }
    sum += b.measureText(words[0]).width + c.measureText(words[0]).width; calls += 2;
    for (let i = 0; i < words.length; i++) {
      const w = words[i], half = (w.length + 1) >> 1;
      sum += a.measureText(w).width; calls++;
      if (i + 1 < words.length) { sum += a.measureText(w + ' ' + words[i + 1]).width; calls++; }
      if (i > 0 && i + 1 < words.length) { sum += a.measureText(words[i - 1] + ' ' + w + ' ' + words[i + 1]).width; calls++; }
      sum += b.measureText(w.slice(0, half)).width; calls++;
      if (half < w.length) { sum += c.measureText(w.slice(half)).width; calls++; }
      sum += a.measureText(words.slice(Math.max(0, i - 7), i + 1).join(' ')).width; calls++;
    }
  }
  return { sum, calls, contexts };
};
const kinds = ['offscreen', 'element1'];
const runs = 5;
for (const state in dirty) {
  const alone = [];
  for (let r = 0; r < runs; r++) { root.offsetWidth; dirty[state](); alone.push(time(() => root.offsetWidth)); }
  out.rows.push({ state, kind: 'no canvas call', readAfterMs: stats(alone) });
  const workMs = { offscreen: [], element1: [] }, readMs = { offscreen: [], element1: [] };
  let counts = null;
  for (let r = 0; r < runs; r++) {
    for (let k0 = 0; k0 < kinds.length; k0++) {
      const kind = kinds[(k0 + r) % kinds.length];
      root.offsetWidth;
      dirty[state]();
      const t0 = performance.now();
      counts = shape(kind);
      workMs[kind].push(performance.now() - t0);
      readMs[kind].push(time(() => root.offsetWidth));
    }
  }
  for (let k = 0; k < kinds.length; k++) out.rows.push({ state, kind: kinds[k], contexts: counts.contexts, calls: counts.calls, workMs: stats(workMs[kinds[k]]), readAfterMs: stats(readMs[kinds[k]]) });
}
root.remove(); page.style.remove();
out.arithmeticAfter = arithmetic();
return out;
`

const K6 = String.raw`
const out = { dpr, timerStep: timerStep(), arithmeticBefore: arithmetic(), contexts: 1000, rows: [] };
const files = { offscreen: '/fonts/amiri.ttf', element1: '/fonts/shantell-sans-regular.ttf' };
const kinds = ['offscreen', 'element1'];
const pass = list => { let sum = 0; const t0 = performance.now(); for (let i = 0; i < list.length; i++) sum += list[i].measureText('Hamburgefonstiv').width; return { usEach: (performance.now() - t0) * 1000 / list.length, sum }; };
for (let k = 0; k < kinds.length; k++) {
  const kind = kinds[k], family = 'KcWeb' + k;
  const face = new FontFace(family, 'url(' + files[kind] + ')');
  document.fonts.add(face);
  const list = new Array(out.contexts);
  // One context per declaration: the sizes differ, the family list is the same.
  for (let i = 0; i < list.length; i++) { list[i] = make(kind); assign(list[i], sizeOf(kind, 12 + (i % 50) / 2) + 'px ' + family + ', Arial', 'en', '0px', 'ltr'); }
  const row = { kind, statusBefore: face.status };
  row.whilePendingFirst = pass(list);
  row.statusAfterFirstMeasure = face.status;
  row.whilePendingSecond = pass(list);
  row.loaded = await Promise.race([face.loaded.then(() => 'loaded', e => 'error: ' + e), sleep(8000).then(() => 'timeout')]);
  // No sleep between the load and the pass: what an app that waits for the face and prepares at once pays.
  row.afterLoadFirst = pass(list);
  row.afterLoadSecond = pass(list);
  row.afterLoadThird = pass(list);
  // The same after ctx.font is set again, which is what takes the face on an OffscreenCanvas whose list named a family
  // that didn't exist (gecko-element-cost C6).
  const t0 = performance.now();
  for (let i = 0; i < list.length; i++) list[i].font = list[i].font;
  row.fontAgainUsEach = (performance.now() - t0) * 1000 / list.length;
  row.afterFontAgain = pass(list);
  document.fonts.delete(face);
  out.rows.push(row);
}
out.arithmeticAfter = arithmetic();
return out;
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
  const mix = buildChat('mix', 300).map(chatText)
  return [
    probe('gecko-element-cost-check K1 sheet', 'gecko-element-cost-check K1: a style sheet change, then a canvas call: who brings the style sheet data up to date', K1),
    probe('gecko-element-cost-check K1b sheet-scale', 'gecko-element-cost-check K1b: what the forced style sheet update grows with, blocks and rules', K1B),
    probe('gecko-element-cost-check K2 declarations', 'gecko-element-cost-check K2: many distinct font declarations taking turns, fresh contexts and kept ones', K2),
    probe('gecko-element-cost-check K3 live none', 'gecko-element-cost-check K3: pauses across garbage with 36,000 plain objects alive, the control', K3('none')),
    probe('gecko-element-cost-check K3 live offscreen', 'gecko-element-cost-check K3: pauses across garbage with 36,000 live OffscreenCanvas contexts, then dropped', K3('offscreen')),
    probe('gecko-element-cost-check K3 live element1', 'gecko-element-cost-check K3: pauses across garbage with 36,000 live canvas element contexts, then dropped', K3('element1')),
    probe('gecko-element-cost-check K4 freeing-scale', 'gecko-element-cost-check K4: the freeing pause at 10,000, 20,000 and 40,000 dropped contexts', K4),
    probe('gecko-element-cost-check K5 dirty-shape', 'gecko-element-cost-check K5: the chat bench\'s shape of work on a page whose style or layout is dirty', K5(mix)),
    probe('gecko-element-cost-check K6 font-loaded', 'gecko-element-cost-check K6: the first measureText of 1,000 kept contexts after their web font loads', K6),
  ]
}
