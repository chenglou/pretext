// x-sysui experiment (Firefox): what measuring on a detached `<canvas>` element costs and risks against an OffscreenCanvas.
//
// cost      context creation with a new font string, and measureText calls, for both kinds (performance.now is clamped to
//           1 ms in Firefox, so only totals over many calls mean anything).
// before    in a fresh same-origin iframe whose document has laid out no text: the detached element's width at the device
//           size, then the DOM's width of the same text in that document, then the element's again.
// hidden    the same in a `display: none` iframe, whose document has no pres shell: SetFontInternal takes the disconnected
//           path there (CanvasRenderingContext2D.cpp:4222-4225).
//
//   python3 .artifacts/session/with-browser-lock.py probes-sysui-cost -- bun rebuild/probes/runner.ts --browser=firefox \
//     --probes=rebuild/probes/sysui-gecko-element-cost.ts --out=.artifacts/sysui/probes/firefox-cost
import type { Probe } from './types.ts'

const COST = String.raw`
const Z = window.devicePixelRatio;
const WORDS = [];
for (let i = 0; i < 60; i++) WORDS.push('Word' + i.toString(36) + 'fi To' + String.fromCharCode(97 + i % 26));
const make = (kind) => kind === 'offscreen' ? new OffscreenCanvas(1, 1).getContext('2d') : document.createElement('canvas').getContext('2d');
const result = {};
for (const round of [0, 1]) {
  for (const kind of ['offscreen', 'detached', 'offscreen', 'detached']) {
    const contexts = [];
    const t0 = performance.now();
    for (let w = 100; w <= 900; w += 100) {
      for (let s = 10; s < 40; s += 1) {
        const c = make(kind);
        // A size no earlier pass used, so no font style or font group is cached for the string.
        c.font = w + ' ' + ((kind === 'detached' ? s * Z : s) + round * 0.5 + (result[kind + 'Passes'] || 0) * 0.125) + 'px system-ui';
        contexts.push(c);
      }
    }
    const t1 = performance.now();
    let sum = 0;
    for (let i = 0; i < contexts.length; i++) for (let k = 0; k < WORDS.length; k++) sum += contexts[i].measureText(WORDS[k]).width;
    const t2 = performance.now();
    // The same strings again: Gecko's word cache answers.
    for (let i = 0; i < contexts.length; i++) for (let k = 0; k < WORDS.length; k++) sum += contexts[i].measureText(WORDS[k]).width;
    const t3 = performance.now();
    result[kind + 'Passes'] = (result[kind + 'Passes'] || 0) + 1;
    (result[kind] ||= []).push({ contexts: contexts.length, calls: contexts.length * WORDS.length, createAndSetFontMs: t1 - t0, firstMeasureMs: t2 - t1, repeatMeasureMs: t3 - t2, sum });
  }
}
return result;
`

const FRAME = (hidden: boolean): string => String.raw`
const Z = window.devicePixelRatio;
const TEXT = 'AVATAR Wave To. office fifty';
const frame = document.createElement('iframe');
frame.srcdoc = '<!doctype html><html lang="en"><body></body></html>';
frame.style.cssText = ${hidden ? "'display: none'" : "'position: fixed; left: 0; top: 0; width: 600px; height: 100px; border: 0'"};
await new Promise(resolve => { frame.onload = resolve; host.appendChild(frame); });
const doc = frame.contentDocument;
const measure = (size) => {
  const c = doc.createElement('canvas').getContext('2d');
  c.font = size * Z + 'px system-ui';
  return { font: c.font, width: c.measureText(TEXT).width / Z };
};
const out = { hidden: ${hidden}, rows: [] };
for (const size of [13, 16, 20]) {
  const before = measure(size);
  const span = doc.createElement('span');
  span.style.cssText = 'font: ' + size + 'px system-ui; white-space: pre; position: absolute; left: 0; top: 0';
  span.textContent = TEXT;
  doc.body.appendChild(span);
  const dom = span.getBoundingClientRect().width;
  const after = measure(size);
  const off = new OffscreenCanvas(1, 1).getContext('2d');
  off.font = size + 'px system-ui';
  out.rows.push({ size, elementBefore: before.width, dom, elementAfter: after.width, offscreen: off.measureText(TEXT).width, font: before.font });
}
// The same text in the top document, which is laid out.
const top = [];
for (const size of [13, 16, 20]) {
  const span = document.createElement('span');
  span.style.cssText = 'font: ' + size + 'px system-ui; white-space: pre; position: absolute; left: 0; top: 0';
  span.textContent = TEXT;
  host.appendChild(span);
  top.push({ size, dom: span.getBoundingClientRect().width });
  host.removeChild(span);
}
out.top = top;
host.removeChild(frame);
return out;
`

export default function probes(): Probe[] {
  return [
    { id: 'sysui gecko element cost', spec: 'x-sysui: canvas element against OffscreenCanvas, time', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: COST }], browsers: ['firefox'] },
    { id: 'sysui gecko element before layout', spec: 'x-sysui: canvas element in a document that has laid out nothing', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: FRAME(false) }], browsers: ['firefox'] },
    { id: 'sysui gecko element without a pres shell', spec: 'x-sysui: canvas element in a display: none iframe', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: FRAME(true) }], browsers: ['firefox'] },
  ]
}
