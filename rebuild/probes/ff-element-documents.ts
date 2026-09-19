// In which documents does a detached <canvas> element measure like the page, and what tells? Pinned Firefox 156.0.
// A canvas element's context takes the page's path only while its owner document has a presentation shell (pres shell):
// SetFontInternal asks GetPresShell() and falls to SetFontInternalDisconnected without one, the OffscreenCanvas path
// (CanvasRenderingContext2D.cpp:2086-2094, :4219-4224, :4423-4431), and GetAppUnitsValues gives 60 app units per pixel
// without one (:7132-7155). Measurement only; the probe page reads the DOM freely, the library wouldn't.
// - D1 kinds: per kind of document, an element canvas made by it at the device font size (CSS size x devicePixelRatio),
//   beside the top document's element canvas, an OffscreenCanvas at the CSS size and the DOM's own width, all in app units;
//   the window's devicePixelRatio there; and the detection candidates: which letterSpacing and font values the context
//   keeps (a value that needs the style system is kept only with a pres shell, :3091-3110), what a 0.01px letter spacing
//   adds (the app unit grid, :5233-5236), and whether system-ui differs from the OffscreenCanvas's (optical sizing).
//   An iframe is measured twice: right after it is inserted, before anything flushed the parent, and after a flush.
// - D2 toggle: an iframe shown, then display: none, then shown again. Contexts made at each stage are measured at every
//   later stage, before and after the parent's flush, so the output says what a context made earlier does.
// - D3 flushes: with a style change pending on 30,000 spans, the time of one operation and then of the style flush that
//   follows it. An operation that flushed leaves nothing for the flush that follows. Operations: a detached element canvas
//   (context, font, measureText), the letterSpacing test on it, an OffscreenCanvas, a connected element canvas, reading
//   devicePixelRatio, and getComputedStyle as the control that does flush.
// - D5 frame-zoom: an iframe under CSS zoom 1, 1.5 and 0.8, the nearest a probe page gets to a zoomed document: the frame
//   window's devicePixelRatio, the DOM's widths inside the frame, and the frame's element canvas at the device size that
//   ratio gives, and at the top window's.
// - D4 cost: the detection candidates timed in loops (Firefox's timer has 1 ms steps). A timing run: take the machine with
//   --exclusive.
//
// Results of 2026-09-19 (.artifacts/probes/ff-element-20260919/workers):
// - D1 at DPR 2: the top document's element canvas gives the DOM's app units on 5 of 5 samples (system-ui 8917, where the
//   OffscreenCanvas has 7761; `modern` 3118 against 3119; the bold keycap and heart 786 against 793). So does an iframe
//   that is shown, visibility: hidden, 0 x 0, far off screen or under a content-visibility: hidden parent, before and after
//   the parent's flush. Without a pres shell (an iframe that is display: none or under a display: none parent, a removed
//   iframe's document, createHTMLDocument, DOMParser, a template's owner document, an XML document, a canvas adopted by
//   one) every sample is off: 8282, 3117.5, 785, 5016, 5553.5. devicePixelRatio is still 2 in a display: none iframe and 1
//   in a removed one. At DPR 1 the element without a pres shell equals the OffscreenCanvas on 5 of 5, and only system-ui
//   tells the two kinds apart.
// - What tells: a letterSpacing of 1rem, 1vw, 1vh, 1lh, 1cqw or calc(1px + 1em) reads back as set with a pres shell and
//   as 0px without one, in 21 of 21 rows at both ratios; so do the font values 2em, larger, 1rem, 1vw, menu and caption. The
//   0.01px grid test tells only where the page's app units per device pixel aren't 60, and system-ui differs from the
//   OffscreenCanvas with or without a pres shell at DPR 2.
// - D2: a context follows its document at every measureText. After display: none and the parent's flush all 3 contexts,
//   the 2 made before included, measure without a pres shell; shown again and flushed, all 5 give the DOM's app units.
//   Between setting the style and the parent's flush nothing changes. The 1vw test agrees with the widths at all 5 stages.
// - D3, 3 rounds: a detached element canvas, the 1vw test on it, an OffscreenCanvas and devicePixelRatio take 0 to 1 ms and
//   leave the 5 to 7 ms style flush pending; a connected element canvas takes 6 to 7 ms and leaves 0, as getComputedStyle.
// - D5: under CSS zoom 1.5 and 0.8 the frame's devicePixelRatio is 3 and 60/38, and the frame's element canvas at that
//   scale gives the frame's DOM widths on 5 of 5; at the top window's scale it is wrong on 5 of 5 under both.
// - D4, alone on the machine (load average 3.8), 5 rounds: the 1vw test on a kept context 0.35 us (0.30 to 0.35); with a new
//   detached canvas, context and font 4.5 us (3.5 to 5.0); an element canvas and an OffscreenCanvas with one measureText
//   each 7.0 us (6.5 to 8.5).
//
// Run: python3 .artifacts/session/with-browser-lock.py ff-el-documents -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/ff-element-documents.ts --probe-timeout-ms=120000 --out=<out>
// D1 again at 60 app units per device pixel: --only=D1 --firefox-prefs=<file with {"layout.css.devPixelsPerPx": "1.0"}>.
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const XHTML = 'http://www.w3.org/1999/xhtml';
const cps = (...list) => String.fromCodePoint(...list);
const topDpr = window.devicePixelRatio;
const topApd = Math.max(1, Math.floor(60 / topDpr + 0.5));
// weight, CSS size, family, text. system-ui has an optical size axis here; "modern" in 15px Helvetica Neue is the one app
// unit class (probe gecko-port F13); the bold keycap and heart take synthetic bold (F14).
const SAMPLES = [[400, 16, 'system-ui', 'workers of the world'], [400, 15, '"Helvetica Neue"', 'modern'], [700, 14, '"Helvetica Neue"', cps(0x20e3, 0x2764)], [400, 16, 'Arial', 'Hello, world'], [400, 13, 'Georgia', 'AVATAR To Wa']];
const fontOf = (weight, size, family) => weight + ' ' + size + 'px ' + family;
const canvasIn = doc => doc.createElementNS ? doc.createElementNS(XHTML, 'canvas') : doc.createElement('canvas');
const elementContext = doc => canvasIn(doc).getContext('2d');
const offscreenContext = () => new OffscreenCanvas(1, 1).getContext('2d');
const setUp = (c, font) => { c.lang = 'en'; c.font = font; return c; };
// App units of every sample on a context of the given kind: an element canvas at the device size over the top window's
// app units per device pixel, an OffscreenCanvas at the CSS size over 60.
const elementAu = c => SAMPLES.map(([weight, size, family, text]) => +(setUp(c, fontOf(weight, size * 60 / topApd, family)).measureText(text).width * topApd).toFixed(3));
const offscreenAu = c => SAMPLES.map(([weight, size, family, text]) => +(setUp(c, fontOf(weight, size, family)).measureText(text).width * 60).toFixed(3));
const domAu = () => SAMPLES.map(([weight, size, family, text]) => {
  const span = document.createElement('span');
  span.lang = 'en';
  span.style.cssText = 'position: absolute; left: 0; top: 0; white-space: pre; font: ' + fontOf(weight, size, family);
  const node = document.createTextNode(text); span.append(node); host.append(span);
  const range = document.createRange(); range.selectNodeContents(node);
  const au = +(range.getBoundingClientRect().width * 60).toFixed(3);
  span.remove();
  return au;
});
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const SPACINGS = ['1px', '1em', '1ex', '1ch', '1rem', '1vw', '1vh', '1lh', '1cap', '1ic', 'calc(1px)', 'calc(1px + 1em)', '1cqw'];
const FONTS = ['2em serif', 'larger serif', '1rem serif', '1vw serif', 'calc(10px + 1px) serif', 'medium serif', 'menu', 'caption'];
// What could tell a context with a pres shell from one without, each on a context of its own. Nothing here reads layout.
const candidates = doc => {
  const out = { spacingKept: {}, fontKept: {} };
  for (let i = 0; i < SPACINGS.length; i++) {
    const c = setUp(elementContext(doc), '16px Arial');
    c.letterSpacing = SPACINGS[i];
    out.spacingKept[SPACINGS[i]] = c.letterSpacing;
  }
  for (let i = 0; i < FONTS.length; i++) {
    const c = setUp(elementContext(doc), '10px sans-serif');
    c.font = FONTS[i];
    out.fontKept[FONTS[i]] = c.font;
  }
  const grid = setUp(elementContext(doc), '32px Arial');
  const plain = grid.measureText('nnnnnnnnnnnnnnnn').width;
  grid.letterSpacing = '0.01px';
  out.gridAddedPx = grid.measureText('nnnnnnnnnnnnnnnn').width - plain;
  const e = setUp(elementContext(doc), fontOf(400, 16 * 60 / topApd, 'system-ui')), o = setUp(offscreenContext(), fontOf(400, 16, 'system-ui'));
  out.systemUiElementAu = +(e.measureText('workers of the world').width * topApd).toFixed(3);
  out.systemUiOffscreenAu = +(o.measureText('workers of the world').width * 60).toFixed(3);
  return out;
};
const dprOf = win => { try { return win === null || win === undefined ? null : win.devicePixelRatio; } catch (error) { return String(error); } };
const flush = () => host.getBoundingClientRect().width + document.documentElement.offsetWidth;
`

const D1 = String.raw`
const dom = domAu();
const topElement = elementAu(elementContext(document));
const offscreen = offscreenAu(offscreenContext());
const rows = [];
const report = (kind, doc, win) => {
  let au = null, error = null, found = null;
  try { au = elementAu(elementContext(doc)); found = candidates(doc); } catch (e) { error = String(e); }
  rows.push({ kind, error, devicePixelRatio: dprOf(win), au, likeDom: au !== null && same(au, dom), likeTopElement: au !== null && same(au, topElement), likeOffscreen: au !== null && same(au, offscreen), candidates: found });
};
report('top document', document, window);
const frameKinds = [
  ['iframe, shown', '', ''], ['iframe, display: none', 'display: none', ''], ['iframe in a display: none parent', '', 'display: none'],
  ['iframe, visibility: hidden', 'visibility: hidden', ''], ['iframe, 0 x 0', 'width: 0; height: 0; border: 0', ''],
  ['iframe in a content-visibility: hidden parent', '', 'content-visibility: hidden'], ['iframe, far off screen', 'position: absolute; left: -20000px', ''],
];
for (const [kind, frameStyle, parentStyle] of frameKinds) {
  const parent = document.createElement('div');
  parent.style.cssText = parentStyle;
  const frame = document.createElement('iframe');
  frame.style.cssText = frameStyle;
  parent.append(frame); host.append(parent);
  report(kind + ', before the parent flushed', frame.contentDocument, frame.contentWindow);
  flush();
  report(kind + ', after the parent flushed', frame.contentDocument, frame.contentWindow);
  parent.remove();
}
{
  const frame = document.createElement('iframe');
  host.append(frame); flush();
  const doc = frame.contentDocument, win = frame.contentWindow;
  const before = elementContext(doc);
  const shown = elementAu(before);
  frame.remove();
  report('removed iframe, its document kept', doc, win);
  rows.push({ kind: 'removed iframe, a context made while it was shown', au: elementAu(before), shownAu: shown });
  flush();
  report('removed iframe, after the parent flushed', doc, win);
}
report('document.implementation.createHTMLDocument', document.implementation.createHTMLDocument('x'), null);
report('DOMParser text/html', new DOMParser().parseFromString('<!doctype html><html lang="en"><body></body></html>', 'text/html'), null);
report('template contents owner document', document.createElement('template').content.ownerDocument, null);
report('document.implementation.createDocument (XML)', document.implementation.createDocument(XHTML, 'html', null), null);
{
  const other = document.implementation.createHTMLDocument('x');
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  const here = elementAu(c);
  other.adoptNode(canvas);
  const there = elementAu(c);
  document.adoptNode(canvas);
  const back = elementAu(c);
  rows.push({ kind: 'one canvas: made here, adopted by a createHTMLDocument document, adopted back', here, there, back, thereLikeOffscreen: same(there, offscreen), backLikeDom: same(back, dom) });
}
const topLikeDom = same(topElement, dom);
return {
  devicePixelRatio: topDpr, appUnitsPerDevPixel: topApd, visibility: document.visibilityState, samples: SAMPLES.map(s => fontOf(s[0], s[1], s[2]) + ' | ' + [...s[3]].map(ch => ch.codePointAt(0).toString(16)).join(' ')),
  dom, topElement, offscreen, rows,
  checks: [{ name: 'the top document\'s detached element canvas at the device size gives the DOM\'s app units on every sample', measured: topElement, expected: dom, ok: topLikeDom }],
  pre: [],
};
`

const D2 = String.raw`
const dom = domAu();
const offscreen = offscreenAu(offscreenContext());
const frame = document.createElement('iframe');
host.append(frame); flush();
const doc = frame.contentDocument, win = frame.contentWindow;
const contexts = [];
const stages = [];
const stage = name => {
  const made = { madeAt: name, c: elementContext(doc) };
  contexts.push(made);
  const row = { stage: name, devicePixelRatio: dprOf(win), sameDocument: frame.contentDocument === doc, contexts: [] };
  for (let i = 0; i < contexts.length; i++) {
    const au = elementAu(contexts[i].c);
    row.contexts.push({ madeAt: contexts[i].madeAt, au, likeDom: same(au, dom), likeOffscreen: same(au, offscreen) });
  }
  row.spacingKept = candidates(doc).spacingKept['1vw'];
  stages.push(row);
};
stage('shown');
frame.style.display = 'none';
stage('display: none set, parent not flushed');
flush();
stage('display: none, parent flushed');
frame.style.display = '';
stage('shown again, parent not flushed');
flush();
stage('shown again, parent flushed');
frame.remove();
return { devicePixelRatio: topDpr, dom, offscreen, stages, pre: [] };
`

const D3 = String.raw`
const style = document.createElement('style');
style.textContent = '.ffel-on span { color: rgb(1, 2, 3) } .ffel-box span { color: rgb(9, 9, 9) }';
document.head.append(style);
const box = document.createElement('div');
box.className = 'ffel-box';
box.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px; font: 12px Arial';
const parts = [];
for (let i = 0; i < 30000; i++) parts.push('<span>w' + (i % 97) + '</span> ');
box.innerHTML = parts.join('');
const connected = document.createElement('canvas');
host.append(box, connected);
const last = box.lastElementChild;
flush();
getComputedStyle(last).color;
const detachedContext = elementContext(document);
const operations = {
  'nothing': () => 0,
  'detached element canvas: context, font, measureText': () => setUp(elementContext(document), '32px Arial').measureText('Hello, world').width,
  'detached element canvas made earlier: font, measureText': () => setUp(detachedContext, '30px Georgia').measureText('Hello, world').width,
  'detached element canvas: the letterSpacing test': () => { const c = setUp(elementContext(document), '16px Arial'); c.letterSpacing = '1vw'; return c.letterSpacing; },
  'OffscreenCanvas: context, font, measureText': () => setUp(offscreenContext(), '16px Arial').measureText('Hello, world').width,
  'window.devicePixelRatio': () => window.devicePixelRatio,
  'document.documentElement.lang': () => document.documentElement.lang,
  'connected element canvas: context, font, measureText': () => setUp(connected.getContext('2d'), '32px Arial').measureText('Hello, world').width,
  'getComputedStyle(span).color (the control)': () => getComputedStyle(last).color,
};
const rows = [];
let on = false;
for (let round = 0; round < 3; round++) for (const name of Object.keys(operations)) {
  on = !on;
  box.classList.toggle('ffel-on', on);
  const t0 = performance.now();
  const value = operations[name]();
  const t1 = performance.now();
  const color = getComputedStyle(last).color;
  const t2 = performance.now();
  rows.push({ round, operation: name, value: typeof value === 'number' ? +value.toFixed(3) : value, operationMs: +(t1 - t0).toFixed(1), flushAfterMs: +(t2 - t1).toFixed(1), color });
}
box.remove(); connected.remove(); style.remove();
return { spans: 30000, rows, pre: [] };
`

const D4 = String.raw`
const time = (n, run) => { const t0 = performance.now(); let sink = 0; for (let i = 0; i < n; i++) sink += run(i); return { n, ms: +(performance.now() - t0).toFixed(1), usEach: +((performance.now() - t0) * 1000 / n).toFixed(2), sink: +sink.toFixed(1) }; };
const rows = [];
for (let round = 0; round < 5; round++) {
  rows.push({ round, what: 'a detached element canvas, its context, font, the letterSpacing test', ...time(2000, i => { const c = setUp(elementContext(document), '16px Arial'); c.letterSpacing = '1vw'; return c.letterSpacing.length; }) });
  rows.push({ round, what: 'a detached element canvas and an OffscreenCanvas, contexts, fonts, one measureText each (system-ui)', ...time(2000, i => setUp(elementContext(document), '32px system-ui').measureText('workers').width - setUp(offscreenContext(), '16px system-ui').measureText('workers').width) });
  rows.push({ round, what: 'the letterSpacing test on one context kept', ...(() => { const c = setUp(elementContext(document), '16px Arial'); return time(20000, i => { c.letterSpacing = '0px'; c.letterSpacing = '1vw'; return c.letterSpacing.length; }); })() });
  rows.push({ round, what: 'a detached element canvas, context, font, one measureText', ...time(2000, i => setUp(elementContext(document), (16 + i % 7) + 'px Arial').measureText('Hello, world').width) });
  rows.push({ round, what: 'an OffscreenCanvas, context, font, one measureText', ...time(2000, i => setUp(offscreenContext(), (16 + i % 7) + 'px Arial').measureText('Hello, world').width) });
}
return { devicePixelRatio: topDpr, rows, pre: [] };
`

const D5 = String.raw`
const rows = [];
for (const zoom of ['1', '1.5', '0.8']) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width: 500px; height: 120px; zoom: ' + zoom;
  host.append(frame); flush();
  const doc = frame.contentDocument, win = frame.contentWindow;
  const dpr = win.devicePixelRatio, apd = Math.max(1, Math.floor(60 / dpr + 0.5));
  const dom = SAMPLES.map(([weight, size, family, text]) => {
    const span = doc.createElement('span');
    span.lang = 'en';
    span.style.cssText = 'position: absolute; left: 0; top: 0; white-space: pre; font: ' + fontOf(weight, size, family);
    const node = doc.createTextNode(text); span.append(node); doc.body.append(span);
    const range = doc.createRange(); range.selectNodeContents(node);
    const au = +(range.getBoundingClientRect().width * 60).toFixed(3);
    span.remove();
    return au;
  });
  const c = elementContext(doc);
  const atFrameScale = SAMPLES.map(([weight, size, family, text]) => +(setUp(c, fontOf(weight, size * 60 / apd, family)).measureText(text).width * apd).toFixed(3));
  const atTopScale = elementAu(elementContext(doc));
  rows.push({ zoom, frameDevicePixelRatio: dpr, frameAppUnitsPerDevPixel: apd, dom, elementAtFrameScale: atFrameScale, elementAtTopScale: atTopScale, frameScaleLikeDom: same(atFrameScale, dom), topScaleLikeDom: same(atTopScale, dom), spacingKept: candidates(doc).spacingKept['1vw'] });
  frame.remove();
}
return { topDevicePixelRatio: topDpr, topAppUnitsPerDevPixel: topApd, rows, pre: [] };
`

const probes: Probe[] = [
  { id: 'ff-element-documents/D1-kinds', spec: 'condition 2 (b): which documents give a detached canvas element the page\'s path, and what tells', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'env' }, { kind: 'script', source: HELPERS + D1 }] },
  { id: 'ff-element-documents/D2-toggle', spec: 'condition 2 (b): an iframe toggled to display: none and back, and the contexts made before', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + D2 }] },
  { id: 'ff-element-documents/D3-flushes', spec: 'condition 2 (b): which operations flush a pending style change', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + D3 }] },
  { id: 'ff-element-documents/D5-frame-zoom', spec: 'condition 2 (b): an iframe under CSS zoom, whose document has its own device pixel scale', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + D5 }] },
  { id: 'ff-element-documents/D4-cost', spec: 'condition 2 (b): what the detection candidates cost', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + D4 }] },
]

export default probes
