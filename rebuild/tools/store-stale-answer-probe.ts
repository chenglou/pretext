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
//
// S2 and S3 ask the question the x-perf-store prototype needs answered: a store on a kept context (measure/canvas.ts)
// is sound only if ONE context gives one string one answer for as long as it lives. Every string of STRINGS is asked
// on a context of its own, made before anything else happens and never touched again, every 250 ms for ten seconds, and
// beside it on a new context each time. S2 does nothing else, so with the runner's first page in a newly started browser
// it shows what the process's own start-up does; S3 measures U+1F600 U+FE0E once after its first reading, the known
// trigger. Per string: every change of the kept context's answer and of the new contexts', with the time of the reading
// that first showed it, so a row of one entry never changed and a row of three went away and came back.
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

const STRINGS = String.raw`
const LIST = 'normal 400 16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
const ARIAL = 'normal 400 16px Arial';
const STRINGS = [
  ['emoji, Arial', ARIAL, '\u{1F600}'],
  ['emoji, the bench list', LIST, '\u{1F600}'],
  ['emoji after a word, the bench list', LIST, 'ok \u{1F600}'],
  ['emoji with U+FE0F, the bench list', LIST, '\u2764\uFE0F'],
  ['emoji ZWJ sequence, the bench list', LIST, '\u{1F469}\u200D\u{1F4BB}'],
  ['flag, the bench list', LIST, '\u{1F1EF}\u{1F1F5}'],
  ['keycap, Arial', ARIAL, '1\uFE0F\u20E3'],
  ['text-default symbol, Arial', ARIAL, '\u2603'],
  ['lone surrogate, Arial', ARIAL, 'a\uD83D'],
  ['Han by fallback, Arial', ARIAL, '\u6F22\u5B57\u3068\u304B\u306A'],
  ['Han in a listed font, the bench list', LIST, '\u795D\u798F\u6545\u9109'],
  ['Hangul by fallback, the bench list', LIST, '\uD55C\uAD6D\uC5B4'],
  ['Thai by fallback, the bench list', LIST, '\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35'],
  ['Devanagari by fallback, the bench list', LIST, '\u0928\u092E\u0938\u094D\u0924\u0947'],
  ['Arabic in a listed font, the bench list', LIST, '\u0645\u0631\u062D\u0628\u0627'],
  ['Hebrew by fallback, the bench list', LIST, '\u05E9\u05DC\u05D5\u05DD'],
  ['arrow and check mark by fallback, the bench list', LIST, '\u2192 \u2713'],
  ['math by fallback, Arial', ARIAL, '\u2211\u222B\u221A'],
  ['private use, Arial', ARIAL, '\uE000'],
  ['unassigned, Arial', ARIAL, '\u0378'],
  ['a named font that draws it, the bench list', LIST, 'Hamburgefonstiv'],
  ['a named font that draws it, Times New Roman', 'normal 400 16px "Times New Roman"', 'Hamburgefonstiv'],
];
`

const OVER_TIME = String.raw`
const make = (font) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; return c; };
const t0 = performance.now();
const kept = STRINGS.map(row => make(row[1]));
const seen = STRINGS.map(() => ({ kept: [], fresh: [] }));
const note = (list, width, ms) => { if (list.length === 0 || list[list.length - 1].width !== width) list.push({ width, fromMs: ms }); };
const readAll = () => {
  const ms = Math.round(performance.now() - t0);
  for (let i = 0; i < STRINGS.length; i++) {
    note(seen[i].kept, kept[i].measureText(STRINGS[i][2]).width, ms);
    note(seen[i].fresh, make(STRINGS[i][1]).measureText(STRINGS[i][2]).width, ms);
  }
};
readAll();
let sequence = null;
if (TRIGGER) sequence = make(ARIAL).measureText('\u{1F600}\uFE0E').width;
for (let i = 0; i < 40; i++) {
  if (i > 0 || !TRIGGER) await new Promise(resolve => setTimeout(resolve, 250));
  readAll();
}
const rows = STRINGS.map((row, i) => ({ what: row[0], font: row[1], text: row[2], kept: seen[i].kept, fresh: seen[i].fresh }));
return {
  userAgent: navigator.userAgent, msSinceNavigationStart: Math.round(t0), trigger: TRIGGER, sequenceWidth: sequence, tookMs: Math.round(performance.now() - t0),
  keptContextsThatChanged: rows.filter(row => row.kept.length > 1).map(row => row.what),
  freshContextsThatChanged: rows.filter(row => row.fresh.length > 1).map(row => row.what),
  rows,
};
`

export default function storeStaleAnswerProbes(): Probe[] {
  return [{
    id: 'store-stale-answer S2', spec: 'store prototype: one kept context, one string, ten seconds, nothing else happening', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${STRINGS}\nconst TRIGGER = false;\n${OVER_TIME}` }],
  }, {
    id: 'store-stale-answer S3', spec: 'store prototype: one kept context, one string, ten seconds, after U+1F600 U+FE0E was measured once', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${STRINGS}\nconst TRIGGER = true;\n${OVER_TIME}` }],
  }, {
    id: 'store-stale-answer S1', spec: 'store study: one key with two answers inside one page', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: BODY }],
  }]
}
