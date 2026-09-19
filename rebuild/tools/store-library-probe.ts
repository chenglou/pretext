// A probe for the store study: the library itself, from scratch over the chat benchmark's first 1,000 messages, in a
// real browser, three ways that take turns: as it is; with measureText answered from memory (every answer recorded in
// a pass before, found by the context's settings and the string), which leaves the library's own JavaScript, its
// contexts and a Map read per question; and with the contexts replaced by plain objects too, which leaves the
// JavaScript and the Map reads alone. The same for a layout of kept paragraphs at three other widths. The second and
// third are what no store can beat with the library's code as it is.
//
//   STORE_MESSAGES=<messages.json> bun rebuild/probes/runner.ts --browser=<b> --probes=rebuild/tools/store-library-probe.ts \
//     --out=<dir> --probe-timeout-ms=900000 --stall-ms=900000        (under the exclusive browser lock)
//
// messages.json: { latin: ChatMessage[], mix: ChatMessage[] } from bench/cases.ts buildChat.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const lib = globalThis.storeStudy;
const env = lib.environment();
const now = () => performance.now();
const ROUNDS = 5;
const WIDTH = 320;
const OTHER_WIDTHS = [260, 380, 440];
const NAMES = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'];
const keyOf = (c) => { let k = ''; for (let i = 0; i < NAMES.length; i++) k += c[NAMES[i]] + '|'; return k; };
const proto = OffscreenCanvasRenderingContext2D.prototype;
const realMeasure = proto.measureText;
const RealCanvas = globalThis.OffscreenCanvas;
const answers = new Map();
let calls = 0, contexts = 0;
const counting = function (text) { calls++; return realMeasure.call(this, text); };
const recording = function (text) {
  const m = realMeasure.call(this, text);
  const key = keyOf(this);
  let byText = answers.get(key);
  if (byText === undefined) { byText = new Map(); answers.set(key, byText); }
  // The key is another string than the one Canvas takes (V8 would store a looked-up string in one byte).
  if (!byText.has('|' + text)) byText.set('|' + text, { width: m.width, actualBoundingBoxLeft: m.actualBoundingBoxLeft, actualBoundingBoxRight: m.actualBoundingBoxRight, actualBoundingBoxAscent: m.actualBoundingBoxAscent, actualBoundingBoxDescent: m.actualBoundingBoxDescent, fontBoundingBoxAscent: m.fontBoundingBoxAscent, fontBoundingBoxDescent: m.fontBoundingBoxDescent });
  return m;
};
const remembered = function (text) {
  let byText = this.storeStudyAnswers;
  if (byText === undefined) { byText = answers.get(keyOf(this)); this.storeStudyAnswers = byText; }
  const m = byText.get('|' + text);
  if (m === undefined) throw new Error('no recorded answer for ' + JSON.stringify(text) + ' under ' + keyOf(this));
  return m;
};
// A context that is a plain object: what the library assigns, and measureText from memory.
class PlainContext {
  constructor() { this.font = '10px sans-serif'; this.lang = 'inherit'; this.letterSpacing = '0px'; this.wordSpacing = '0px'; this.fontKerning = 'auto'; this.textRendering = 'auto'; this.direction = 'ltr'; this.storeStudyAnswers = undefined; }
}
PlainContext.prototype.measureText = remembered;
class PlainCanvas { getContext() { return new PlainContext(); } }
// Recorded keys hold the settings as the real context reports them, so a plain context needs the same spelling: the
// recording pass also notes, per assigned spelling, what the real context reported.
const spelled = new Map();
const withMode = (mode, work) => {
  proto.measureText = mode === 'real' ? realMeasure : mode === 'count' ? counting : mode === 'record' ? recording : remembered;
  globalThis.OffscreenCanvas = mode === 'plain' ? PlainCanvas : RealCanvas;
  try { return work(); } finally { proto.measureText = realMeasure; globalThis.OffscreenCanvas = RealCanvas; }
};
let sink = 0;
const out = [];
const sets = Object.keys(MESSAGES);
for (let s = 0; s < sets.length; s++) {
  const paragraphs = MESSAGES[sets[s]].map(message => lib.paragraphOf(message.parts));
  // Once untimed for compiled code, once to count, once to record every answer at all four widths.
  withMode('real', () => { sink += lib.scratch(paragraphs.slice(0, 200), env, WIDTH); });
  calls = 0;
  const lines = withMode('count', () => lib.scratch(paragraphs, env, WIDTH));
  const scratchCalls = calls;
  withMode('record', () => { const kept = lib.prepareAll(paragraphs, env, WIDTH); sink += lib.relayout(kept, OTHER_WIDTHS); });
  // A plain context reports what it was assigned; a real one can spell it otherwise ('normal 400 16px X' reads back as
  // '16px X'). So the answers are also filed under the assigned spelling, found by laying out once with contexts that
  // note both.
  const assignedKeys = new Map();
  withMode('record', () => {
    globalThis.OffscreenCanvas = class { getContext() {
      const real = new RealCanvas(1, 1).getContext('2d');
      const assigned = {};
      return new Proxy(real, {
        set(t, k, v) { assigned[k] = String(v); t[k] = v; return true; },
        get(t, k) {
          if (k === 'measureText') return (text) => { let a = ''; for (let i = 0; i < NAMES.length; i++) a += (assigned[NAMES[i]] === undefined ? new PlainContext()[NAMES[i]] : assigned[NAMES[i]]) + '|'; assignedKeys.set(a, keyOf(t)); return recording.call(t, text); };
          const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    } };
    const kept = lib.prepareAll(paragraphs, env, WIDTH);
    sink += lib.relayout(kept, OTHER_WIDTHS);
  });
  assignedKeys.forEach((reported, assigned) => { if (!answers.has(assigned)) answers.set(assigned, answers.get(reported)); });
  const modes = ['real', 'remembered', 'plain'];
  const scratch = { real: [], remembered: [], plain: [] };
  const relayout = { real: [], remembered: [], plain: [] };
  for (let round = 0; round < ROUNDS; round++) {
    for (let m = 0; m < modes.length; m++) {
      const mode = modes[(m + round) % modes.length];
      let t0 = 0, t1 = 0, t2 = 0, t3 = 0;
      withMode(mode, () => {
        t0 = now();
        sink += lib.scratch(paragraphs, env, WIDTH);
        t1 = now();
        const kept = lib.prepareAll(paragraphs, env, WIDTH);
        t2 = now();
        sink += lib.relayout(kept, OTHER_WIDTHS);
        t3 = now();
      });
      scratch[mode].push((t1 - t0) * 1000 / paragraphs.length);
      relayout[mode].push((t3 - t2) * 1000 / (paragraphs.length * OTHER_WIDTHS.length));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  let stored = 0;
  answers.forEach(byText => { stored += byText.size; });
  out.push({ set: sets[s], messages: paragraphs.length, lines, measureTextCallsPerMessage: scratchCalls / paragraphs.length, scratchUsPerMessage: scratch, relayoutUsPerLayout: relayout, recordedAnswers: stored });
}
return { userAgent: navigator.userAgent, engine: env.engine, devicePixelRatio: window.devicePixelRatio, sink, sets: out };
`

export default async function storeLibraryProbes(): Promise<Probe[]> {
  const path = process.env['STORE_MESSAGES']
  if (path === undefined) throw new Error('STORE_MESSAGES names the messages file')
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'store-library-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  return [{
    id: 'store-library L1', spec: 'store study: the library from scratch and at other widths, as it is and with Canvas answered from memory', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\nconst MESSAGES = ${readFileSync(path, 'utf8')};\n${BODY}` }],
  }]
}
