// How much of a chat page's layout time is the browser's Canvas and how much is the library's own JavaScript, in a real
// browser, and what a change to the library buys there. One page holds the library of one or more checkouts, each
// bundled from its own tree (tools/own-js-probe-entry.ts), and the chat benchmark's first 10,000 messages of each set.
//
// 1. Alternating rounds: every library lays every set out from scratch at 320px with one list of contexts a pass, and
//    the next round starts one library later; then the same for kept messages laid out again at 260, 380 and 440px.
//    Whatever the machine does during a round it does to every library, so a round's difference between two libraries
//    holds under a load that would spoil runs taken one after the other.
// 2. The split, per library and set, by two methods. `timed`: measureText, the constructor, getContext and the text
//    attributes' setters are wrapped with a timer each, and the time inside them is summed, less what two timer reads
//    around nothing cost. `map`: measureText answers from a Map what Canvas answered the first time, so a pass is the
//    library's own code and the Map, and the Map alone is timed by asking it one pass's questions again; Canvas is a
//    pass with the real Canvas less that. The phase timers (the font checks, the engine's prepare, the fill) run under
//    both the real Canvas and the Map.
//
//   OWN_JS_TREES="base=<checkout>,head=<checkout>" OWN_JS_ROUNDS=15 OWN_JS_MESSAGES=10000 OWN_JS_KEPT=10000 [OWN_JS_LANGUAGE=th] \
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=webkit-host --isolated --probes=rebuild/tools/own-js-probe.ts --out=<dir> \
//       --probe-timeout-ms=1500000 --stall-ms=1500000
//   bun rebuild/tools/own-js-summary.ts <dir>/<browser>-probes.json
//
// A checkout is any folder that holds rebuild/src and rebuild/tools/own-js-probe-entry.ts. With one tree the rounds
// time that library alone. --isolated gives the page its finest timer (20 µs in webkit-host and Firefox, 5 µs in Chrome;
// 1 ms without it in WebKit and Firefox), which the `timed` method needs.
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat, buildLanguages } from '../bench/cases.ts'

const BODY = String.raw`
const WIDTH = 320;
const WIDTHS = [260, 380, 440];
const sets = Object.keys(SETS);
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
for (const entry of LIBS) {
  entry.env = entry.lib.environment();
  entry.paragraphs = {};
  for (const set of sets) entry.paragraphs[set] = SETS[set].map((message) => entry.lib.paragraphOf(message.parts));
}
// Once untimed over the first 1,000 of each set, for compiled code.
for (const entry of LIBS) for (const set of sets) entry.lib.relayout(entry.lib.prepareAll(entry.paragraphs[set].slice(0, 1000), entry.env, WIDTH), WIDTHS);

let timerStepMs = Infinity;
for (let i = 0; i < 200; i++) {
  const from = performance.now();
  let to = performance.now();
  while (to === from) to = performance.now();
  timerStepMs = Math.min(timerStepMs, to - from);
}
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, crossOriginIsolated: window.crossOriginIsolated, timerStepMs, messages: SETS[sets[0]].length, kept: KEPT, scratch: [], relayout: [], split: [] };

// 1. Alternating rounds.
for (let round = 0; round < ROUNDS; round++) {
  const row = [];
  for (let k = 0; k < LIBS.length; k++) {
    const entry = LIBS[(k + round) % LIBS.length];
    for (const set of sets) {
      await pause();
      const t0 = performance.now();
      const lines = entry.lib.scratch(entry.paragraphs[set], entry.env, WIDTH);
      row.push({ label: entry.label, set, ms: performance.now() - t0, lines });
    }
  }
  out.scratch.push(row);
}
for (const set of sets) {
  // Kept messages, filled at every width once before the rounds, so no width is new to them.
  const kept = LIBS.map((entry) => entry.lib.prepareAll(entry.paragraphs[set].slice(0, KEPT), entry.env, WIDTH));
  for (let k = 0; k < LIBS.length; k++) LIBS[k].lib.relayout(kept[k], WIDTHS);
  for (let round = 0; round < ROUNDS; round++) {
    for (let k = 0; k < LIBS.length; k++) {
      const at = (k + round) % LIBS.length;
      await pause();
      const t0 = performance.now();
      const lines = LIBS[at].lib.relayout(kept[at], WIDTHS);
      out.relayout.push({ round, label: LIBS[at].label, set, ms: performance.now() - t0, lines });
    }
  }
}

// 2. The split.
const Canvas2D = OffscreenCanvasRenderingContext2D.prototype;
const realMeasureText = Canvas2D.measureText;
const SETTERS = ['font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction', 'lang'];
const work = { calls: 0, measureTextMs: 0, contexts: 0, contextMs: 0 };

function wrapTimed() {
  const restores = [];
  Canvas2D.measureText = function (text) {
    work.calls++;
    const t0 = performance.now();
    const metrics = realMeasureText.call(this, text);
    work.measureTextMs += performance.now() - t0;
    return metrics;
  };
  restores.push(() => { Canvas2D.measureText = realMeasureText; });
  for (const name of SETTERS) {
    const descriptor = Object.getOwnPropertyDescriptor(Canvas2D, name);
    if (descriptor === undefined || descriptor.set === undefined) continue;
    const set = descriptor.set;
    Object.defineProperty(Canvas2D, name, { ...descriptor, set(value) {
      const t0 = performance.now();
      set.call(this, value);
      work.contextMs += performance.now() - t0;
    } });
    restores.push(() => Object.defineProperty(Canvas2D, name, descriptor));
  }
  const realGetContext = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (...rest) {
    work.contexts++;
    const t0 = performance.now();
    const context = realGetContext.apply(this, rest);
    work.contextMs += performance.now() - t0;
    return context;
  };
  restores.push(() => { OffscreenCanvas.prototype.getContext = realGetContext; });
  const RealCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = function (width, height) {
    const t0 = performance.now();
    const canvas = new RealCanvas(width, height);
    work.contextMs += performance.now() - t0;
    return canvas;
  };
  globalThis.OffscreenCanvas.prototype = RealCanvas.prototype;
  restores.push(() => { globalThis.OffscreenCanvas = RealCanvas; });
  return () => { for (const restore of restores) restore(); };
}

// Two timer reads around nothing: what every timed interval above holds beside the call it times.
function emptyIntervalMs() {
  let sum = 0;
  const n = 2000000;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    sum += performance.now() - t0;
  }
  return sum / n;
}

// measureText from a Map per context settings; asked, when an array, records one pass's questions.
const answersBySettings = new Map();
let asked = null;
function wrapMap() {
  Canvas2D.measureText = function (text) {
    let answers = this.ownJsAnswers;
    if (answers === undefined) {
      const key = SETTERS.map((name) => String(this[name])).join('|');
      answers = answersBySettings.get(key);
      if (answers === undefined) {
        answers = new Map();
        answersBySettings.set(key, answers);
      }
      this.ownJsAnswers = answers;
    }
    if (asked !== null) asked.push(answers, text);
    let metrics = answers.get(text);
    if (metrics === undefined) {
      metrics = realMeasureText.call(this, text);
      answers.set(text, metrics);
    }
    return metrics;
  };
  return () => { Canvas2D.measureText = realMeasureText; };
}

const emptyMs = emptyIntervalMs();
out.emptyIntervalMs = emptyMs;
for (const entry of LIBS) {
  for (const set of sets) {
    const paragraphs = entry.paragraphs[set];
    const result = { label: entry.label, set, real: [], realPhases: [], timed: [], map: [], mapPhases: [], mapAlone: [], calls: 0, contexts: 0 };
    for (let pass = 0; pass < PASSES; pass++) {
      await pause();
      const t0 = performance.now();
      entry.lib.scratch(paragraphs, entry.env, WIDTH);
      result.real.push(performance.now() - t0);
    }
    for (let pass = 0; pass < PASSES; pass++) {
      await pause();
      const phases = { checks: 0, prepare: 0, fill: 0 };
      entry.lib.scratchPhases(paragraphs, entry.env, WIDTH, phases);
      result.realPhases.push(phases);
    }
    const restoreTimed = wrapTimed();
    for (let pass = 0; pass < PASSES; pass++) {
      await pause();
      work.calls = 0; work.measureTextMs = 0; work.contexts = 0; work.contextMs = 0;
      const t0 = performance.now();
      entry.lib.scratch(paragraphs, entry.env, WIDTH);
      result.timed.push({ ms: performance.now() - t0, calls: work.calls, measureTextMs: work.measureTextMs, contexts: work.contexts, contextMs: work.contextMs });
    }
    restoreTimed();
    const restoreMap = wrapMap();
    entry.lib.scratch(paragraphs, entry.env, WIDTH);
    asked = [];
    entry.lib.scratch(paragraphs, entry.env, WIDTH);
    const questions = asked;
    asked = null;
    result.calls = questions.length / 2;
    for (let pass = 0; pass < PASSES; pass++) {
      await pause();
      const t0 = performance.now();
      entry.lib.scratch(paragraphs, entry.env, WIDTH);
      result.map.push(performance.now() - t0);
    }
    for (let pass = 0; pass < PASSES; pass++) {
      await pause();
      const phases = { checks: 0, prepare: 0, fill: 0 };
      entry.lib.scratchPhases(paragraphs, entry.env, WIDTH, phases);
      result.mapPhases.push(phases);
    }
    for (let pass = 0; pass < PASSES; pass++) {
      await pause();
      let sum = 0;
      const t0 = performance.now();
      for (let i = 0; i < questions.length; i += 2) sum += questions[i].get(questions[i + 1]).width;
      result.mapAlone.push(performance.now() - t0);
      if (sum < 0) throw new Error('unreachable');
    }
    restoreMap();
    out.split.push(result);
  }
}
return out;
`

export default async function ownJsProbes(): Promise<Probe[]> {
  const trees = (process.env['OWN_JS_TREES'] ?? '').split(',').filter(entry => entry !== '')
  if (trees.length === 0) throw new Error('OWN_JS_TREES="label=<checkout>[,label=<checkout>]" names the checkouts')
  const rounds = Number(process.env['OWN_JS_ROUNDS'] ?? '15')
  const passes = Number(process.env['OWN_JS_PASSES'] ?? '7')
  const messages = Number(process.env['OWN_JS_MESSAGES'] ?? '10000')
  // The kept messages of the second part: every library's are alive at once, so fewer with many libraries.
  const kept = Number(process.env['OWN_JS_KEPT'] ?? String(messages))
  let libs = 'const LIBS = [];\n'
  for (let i = 0; i < trees.length; i++) {
    const at = trees[i]!.indexOf('=')
    const built = await Bun.build({ entrypoints: [join(trees[i]!.slice(at + 1), 'rebuild/tools/own-js-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling ${trees[i]!} failed: ${built.logs.join('\n')}`)
    libs += `${await built.outputs[0]!.text()}\nLIBS.push({ label: ${JSON.stringify(trees[i]!.slice(0, at))}, lib: globalThis.ownJs });\n`
  }
  // OWN_JS_LANGUAGE=th: one language of bench/cases.ts buildLanguages in place of the chat sets, for what a script costs.
  const language = process.env['OWN_JS_LANGUAGE'] ?? ''
  const sets: Record<string, { parts: { code: boolean; text: string }[] }[]> = language === ''
    ? { mix: buildChat('mix', messages), latin: buildChat('latin', messages) }
    : { [language]: buildLanguages(messages * 11).filter(message => message.language === language).map(message => ({ parts: [{ code: false, text: message.text }] })) }
  return [{
    id: 'own-js T1', spec: 'the profiling phase: Canvas against the library\'s own JavaScript on the chat headline, and checkouts in alternating rounds', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${libs}const SETS = ${JSON.stringify(sets)};\nconst ROUNDS = ${rounds};\nconst PASSES = ${passes};\nconst KEPT = ${kept};\n${BODY}` }],
  }]
}
