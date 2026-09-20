// A probe on the store study's "Chrome's canvas already is the store": how many strings does one canvas keep? The study
// found a repeat on a kept canvas flat at about 0.14 us and a first ask at about 0.8 us. With one context for the page
// (PROFILING-START.md item 1) a canvas meets about 100 new strings a message, so what it keeps after a million of them
// says whether a repeat stays cheap and whether the browser's own memory is bounded. A ratio of about six, so load
// matters little; run it under the exclusive browser lock all the same:
//
//   bun rebuild/probes/runner.ts --browser=chrome|firefox|webkit-host --probes=rebuild/tools/store-canvas-bound-probe.ts \
//     --out=<dir> --probe-timeout-ms=600000 --stall-ms=600000
//
// Per string kind (a word of 8 units; two words of 24 units with U+2028 between them, as the Blink port writes a space):
// one new context at a font size of its own measures N distinct strings once (`first`), then measures them again in
// chunks of 5,000 from the newest back to the oldest (`again`, us a call per chunk). Chunks the canvas kept cost the
// repeat's price, the others the first ask's. Then the newest chunk once more (`newestAfter`): an LRU has dropped it by
// then, a canvas that keeps everything hasn't.
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const isChrome = /\bChrome\//.test(navigator.userAgent);
const baseSize = isChrome ? 32 : 16;
const family = '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const now = () => performance.now();
const letters = 'etaoinshrdlucmfwypvbgkqjxz';
const CHUNK = 5000;
const SIZES = [20000, 100000, 1000000];
let sink = 0;
let made = 0;
const make = () => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = 'en';
  c.font = 'normal 400 ' + (baseSize + (++made) / 64) + 'px ' + family;
  c.letterSpacing = '0px';
  c.wordSpacing = '0px';
  c.fontKerning = 'auto';
  c.textRendering = isChrome ? 'optimizeLegibility' : 'auto';
  c.direction = 'ltr';
  return c;
};
const word = (i, length) => { let s = ''; let x = i + 1; for (let k = 0; k < length; k++) { s += letters[x % 26]; x = Math.floor(x / 26) + k; } return s; };
const KINDS = [
  { name: 'a word of 8 units', build: (i) => word(i, 8) },
  { name: 'two words of 24 units around U+2028', build: (i) => word(i, 12) + '\u2028' + word(i + 7, 11) },
];
const results = [];
for (let k = 0; k < KINDS.length; k++) {
  for (let s = 0; s < SIZES.length; s++) {
    const n = SIZES[s];
    const strings = new Array(n);
    for (let i = 0; i < n; i++) strings[i] = KINDS[k].build(i);
    const c = make();
    let t0 = now();
    for (let i = 0; i < n; i++) sink += c.measureText(strings[i]).width;
    const first = (now() - t0) * 1000 / n;
    const again = [];
    for (let end = n; end > 0; end -= CHUNK) {
      const start = Math.max(0, end - CHUNK);
      t0 = now();
      for (let i = start; i < end; i++) sink += c.measureText(strings[i]).width;
      again.push(Math.round((now() - t0) * 1000000 / (end - start)) / 1000);
    }
    t0 = now();
    for (let i = n - CHUNK; i < n; i++) sink += c.measureText(strings[i]).width;
    const newestAfter = (now() - t0) * 1000 / CHUNK;
    results.push({ kind: KINDS[k].name, strings: n, firstUsPerCall: first, againUsPerCallByChunkFromNewest: again, newestAfterUsPerCall: newestAfter });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
return { userAgent: navigator.userAgent, chunk: CHUNK, sink, results };
`

export default function storeCanvasBoundProbes(): Probe[] {
  return [{
    id: 'store-canvas-bound B1', spec: 'store study: how many measured strings one canvas keeps', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: BODY }],
  }]
}
