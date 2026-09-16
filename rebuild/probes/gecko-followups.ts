// Follow-up Firefox probes from the Gecko port's lab attribution (rebuild/specs/gecko-RESULTS.md).
//
// Verdicts, installed Firefox 156.0 at DPR 2 (.artifacts/probes/gecko/followups*/firefox-probes.json):
// - F1 refuted: a fresh document measures U+1F600 at 32px, 33px Arial and 47px Georgia correctly on the first call.
// - F2 confirmed: after one OffscreenCanvas measures U+1F600 U+FE0E (17px), U+1F600 alone measures 17px at 32px and 28px
//   Arial and 28px Georgia, in new contexts.
//
// gecko-port F1: an OffscreenCanvas measures an emoji before Firefox's asynchronous system font fallback
// (gfx.font_rendering.fallback.async, specs/gecko-canvas.md §1.11) has picked Apple Color Emoji, so the first
// measurement in a document at a new size returns another width. suite-r1 predicted U+1F600 at 32px Arial as 17px in
// one document and 32px in another (c-0e9eee22e9d69e02, c-0a05b8622a4460aa).
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-followups -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-followups.ts --out=.artifacts/probes/gecko/followups
import type { Probe } from './types.ts'

const FALLBACK = String.raw`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const measure = (font, text) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; return c.measureText(text).width; };
const out = {};
// A size and a character no earlier content in this fresh document used.
const sizes = ['32px Arial', '33px Arial', '47px Georgia'];
const text = '\u{1F600}';
for (const font of sizes) out[font] = { first: measure(font, text) };
await sleep(1000);
for (const font of sizes) out[font].afterOneSecond = measure(font, text);
const span = document.createElement('span');
span.style.cssText = 'font: 32px Arial; white-space: pre';
span.textContent = text;
host.append(span);
span.getBoundingClientRect();
await document.fonts.ready;
await sleep(500);
out.dom32 = span.getBoundingClientRect().width;
for (const font of sizes) out[font].afterDom = measure(font, text);
return { widths: out, dpr: window.devicePixelRatio, stable: sizes.every(f => out[f].first === out[f].afterOneSecond) };
`

// gecko-port F2: after F1 refuted the asynchronous claim, earlier measurements in the same document may change which
// font Canvas matches for U+1F600: measure U+1F600 U+FE0E (text presentation) first, then U+1F600 alone.
const HISTORY = String.raw`
const measure = (font, text) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; return c.measureText(text).width; };
const E = '\u{1F600}', VS15 = '\u{FE0E}';
const out = {};
out.emoji32Before = measure('32px Arial', E);
out.vs15at32 = measure('32px Arial', E + VS15);
out.emoji32After = measure('32px Arial', E);
out.vs15at28 = measure('28px Arial', E + VS15);
out.emoji28After = measure('28px Arial', E);
out.vs15at14Georgia = measure('14px Georgia', E + E + VS15);
out.emoji28Georgia = measure('28px Georgia', E);
return out;
`

export default function probes(): Probe[] {
  return [
    {
      id: 'gecko-port F2',
      spec: 'gecko-port F2: OffscreenCanvas emoji width after a text-presentation measurement in the same document',
      pageLang: 'en',
      observe: [{ kind: 'script', source: HISTORY }],
      browsers: ['firefox'],
      note: 'Holds if emoji28After (28px, measured only after the VS15 form) differs from the whole-pixel emoji advance; emoji32Before is the control.',
    },
    {
      id: 'gecko-port F1',
      spec: 'gecko-port F1: OffscreenCanvas emoji widths before and after async system font fallback',
      pageLang: 'en',
      observe: [{ kind: 'script', source: FALLBACK }],
      browsers: ['firefox'],
      note: 'Expected if the hypothesis holds: first < afterOneSecond for at least one size (for example 17px, then 32px at 32px Arial); refuted if every first equals afterOneSecond.',
    },
  ]
}
