// A probe on the store study's key: can one page get two answers for one key, a context's settings and a string? The
// recorded tier cases hold 91 such keys in Firefox, every one with an emoji or a lone surrogate (tools/store-key-check.ts),
// but each case is a document of its own. TAKE-BACK.md 5.5 has the state behind them: after U+1F600 U+FE0E is shaped once
// in a new content process, a plain U+1F600 measures as a missing-glyph box until the character-map loader finishes.
// This asks it inside one page, on one kept context and on new ones, as a page-lifetime store would meet it. Counts, not
// times (one browser slot):
//
//   bun rebuild/probes/runner.ts --browser=firefox|chrome|webkit-host --probes=rebuild/tools/store-stale-answer-probe.ts --out=<dir>
//
// Widths in px of U+1F600 under `16px Arial`: at the start, right after the text-presentation sequence is measured once,
// and every half second for five seconds. `kept` is one context made at the start; `fresh` is a new context each time.
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const make = () => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = 'normal 400 16px Arial'; return c; };
const GRIN = '\u{1F600}';
const kept = make();
const read = (label, t0) => ({ label, ms: Math.round(performance.now() - t0), kept: kept.measureText(GRIN).width, fresh: make().measureText(GRIN).width });
const t0 = performance.now();
const rows = [read('at the start', t0)];
const sequence = make().measureText(GRIN + '\u{FE0E}').width;
rows.push(read('after the text-presentation sequence was measured once', t0));
for (let i = 0; i < 10; i++) {
  await new Promise(resolve => setTimeout(resolve, 500));
  rows.push(read('later', t0));
}
const answers = new Set();
for (let i = 0; i < rows.length; i++) { answers.add(rows[i].kept); answers.add(rows[i].fresh); }
return { userAgent: navigator.userAgent, sequenceWidth: sequence, distinctAnswersForOneKey: Array.from(answers), rows };
`

export default function storeStaleAnswerProbes(): Probe[] {
  return [{
    id: 'store-stale-answer S1', spec: 'store study: one key with two answers inside one page', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: BODY }],
  }]
}
