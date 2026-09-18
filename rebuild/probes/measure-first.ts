// Measure-first probes (Chrome at a layout zoom other than 1; rebuild/lab/README.md "Measure first"). An application measures
// before any DOM text exists, so whatever a Canvas measurement leaves in the renderer decides the first native layout.
//
// Blink's FontCache keys a platform font by the effective (zoomed) size and FontDescription's options, among them
// text-rendering, and not by the specified size (font_description.cc:308-331, FontCacheKey; pinned 153.0.8010.48), while
// opsz and HarfBuzz's ptem come from the specified size of whichever text created the font (font_platform_data_mac.mm:
// 170-178; rebuild/platform-bugs ledger item A). So a Canvas at S × DPR px and DOM text at S px can share one system UI
// platform font. Each probe here measures with one kind of context first, then lays out DOM text at S px, and checks the DOM
// width against the clean rule, ceil64(W(S px) × DPR) / (64 × DPR) with W from a context at the CSS size, whose key no DOM
// text of the probe has (specs/blink-lines.md §2.5). Every probe is meaningful only as the first system UI text of a fresh
// browser process, so each runs alone:
//
//   for id in bare library library-page-legibility font-check font-check-word font-check-auto font-check-auto-word dom-first; do
//     python3 .artifacts/session/with-browser-lock.py probes-measure-first-$id -- bun rebuild/probes/runner.ts --browser=chrome \
//       --probes=rebuild/probes/measure-first.ts --only="measure-first M1 ($id)" --out=.artifacts/probes/measure-first/$id
//   done
//
// Verdicts of 2026-09-18 (Chrome 153.0.8010.50, DPR 2) are in rebuild/lab/README.md "Measure first".
import type { Probe } from './types.ts'

type First = { label: string; font: string | null; props: Record<string, string>; texts: string[]; domStyle: string; expectShared: boolean }

const BODY = String.raw`
const Z = window.devicePixelRatio;
const f32 = Math.fround;
const ceil64 = v => Math.ceil(f32(f32(v) * 64));
const TEXT = 'Hello world';
const context = (font, props) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) if (keys[i] === 'lang') c[keys[i]] = props[keys[i]];
  c.font = font;
  for (let i = 0; i < keys.length; i++) if (keys[i] !== 'lang') c[keys[i]] = props[keys[i]];
  return c;
};
const first = {};
if (FIRST.font !== null) {
  for (const size of SIZES) {
    const c = context(FIRST.font.replace('SIZE', String(size * Z)), FIRST.props);
    for (const text of FIRST.texts) first[size * Z + 'px ' + JSON.stringify(text)] = c.measureText(text).width;
  }
}
const dom = {};
const range = document.createRange();
for (const size of SIZES) {
  host.innerHTML = '<div style="font:' + size + 'px system-ui;white-space:nowrap;' + FIRST.domStyle + '"><span>' + TEXT + '</span></div>';
  range.selectNodeContents(host.firstElementChild.firstElementChild);
  dom[size] = range.getBoundingClientRect().width;
}
// The clean rule, from contexts at the CSS size, asked after the DOM text so they can't have made its font.
const clean = {};
const checks = [];
let shared = 0;
for (const size of SIZES) {
  clean[size] = ceil64(context(size + 'px system-ui', {}).measureText(TEXT).width * Z) / (64 * Z);
  if (dom[size] !== clean[size]) shared++;
}
checks.push({
  name: FIRST.expectShared ? 'DOM text took the platform font the context made (its width differs from the clean rule at some size)' : 'DOM text is as wide as the clean rule says at every size',
  ok: FIRST.expectShared ? shared > 0 : shared === 0, expected: clean, measured: dom, dpr: 2,
});
host.innerHTML = '';
return { first, dom, clean, checks };
`

const LIBRARY = { lang: 'en', letterSpacing: '0px', wordSpacing: '0px', fontKerning: 'auto', direction: 'ltr' }
const FIRSTS: Record<string, First> = {
  // The known bug: a context with default settings at the DOM's zoomed size.
  bare: { label: 'a context with default settings', font: 'SIZEpx system-ui', props: {}, texts: ['Hello world'], domStyle: '', expectShared: true },
  // The library's measuring context (src/measure/canvas.ts, engines/blink): text-rendering optimizeLegibility, which is part
  // of the cache key, against DOM text at text-rendering auto.
  library: { label: "the library's measuring context", font: 'normal 400 SIZEpx system-ui', props: { ...LIBRARY, textRendering: 'optimizeLegibility' }, texts: ['Hello world'], domStyle: '', expectShared: false },
  // The same context against a page that sets text-rendering: optimizeLegibility on its text.
  'library-page-legibility': { label: "the library's measuring context, DOM text at text-rendering: optimizeLegibility", font: 'normal 400 SIZEpx system-ui', props: { ...LIBRARY, textRendering: 'optimizeLegibility' }, texts: ['Hello world'], domStyle: 'text-rendering:optimizeLegibility;', expectShared: true },
  // The runtime font checks' contexts (src/measure/font-checks.ts) measure as the library's other contexts do, at
  // text-rendering optimizeLegibility, with the family before a generic: asked about a space and U+2010, and about a word.
  'font-check': { label: "the font checks' context", font: 'normal 400 SIZEpx system-ui, monospace', props: { ...LIBRARY, textRendering: 'optimizeLegibility' }, texts: [' ', '‐'], domStyle: '', expectShared: false },
  'font-check-word': { label: "the font checks' context, asked about a word", font: 'normal 400 SIZEpx system-ui, monospace', props: { ...LIBRARY, textRendering: 'optimizeLegibility' }, texts: ['Hello world'], domStyle: '', expectShared: false },
  // The same contexts at text-rendering auto, as the checks measured until the correctness line: the key of the page's own
  // text, which is why they don't.
  'font-check-auto': { label: "a font check's context at text-rendering auto", font: 'normal 400 SIZEpx system-ui, monospace', props: { ...LIBRARY, textRendering: 'auto' }, texts: [' ', '‐'], domStyle: '', expectShared: true },
  'font-check-auto-word': { label: "a font check's context at text-rendering auto, asked about a word", font: 'normal 400 SIZEpx system-ui, monospace', props: { ...LIBRARY, textRendering: 'auto' }, texts: ['Hello world'], domStyle: '', expectShared: true },
  // No context first: the DOM makes its own fonts.
  'dom-first': { label: 'no context', font: null, props: {}, texts: [], domStyle: '', expectShared: false },
}

export default function measureFirstProbes(): Probe[] {
  return Object.entries(FIRSTS).map(([id, first]) => ({
    id: `measure-first M1 (${id})`,
    spec: `measure-first M1: DOM system-ui text after ${first.label} measured at its zoomed size`,
    pageLang: 'en',
    browsers: ['chrome'],
    html: '<div></div>',
    observe: [{ kind: 'script', source: `const FIRST = ${JSON.stringify(first)}; const SIZES = [8, 10, 13, 16];\n${BODY}` }],
    note: 'Meaningful only alone in a fresh browser process (--only), at a layout zoom other than 1.',
  }))
}
