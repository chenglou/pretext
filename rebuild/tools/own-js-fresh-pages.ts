// A second look at what tools/own-js-probe.ts measures, by another arrangement: every page holds ONE library. The probe
// page there holds every checkout's library at once, and JavaScriptCore compiles and places each copy a little
// differently (two copies of one tree differed by up to 2% there), which an app never sees: it ships one. Here a page is
// a fresh document with one checkout's library, the documents take turns (base, change, base, change ...), and a round is
// one document of every checkout, so a round's difference between two checkouts is an alternating pair in fresh pages.
//
// A page: the chat benchmark's first messages of each set from scratch at 320px with one list of contexts a pass,
// PASSES + 1 times with the sets taking turns (the first pass of the first set compiles the library: it is reported
// apart as `cold`), then KEPT kept messages laid out again at 260, 380 and 440px, PASSES times after one untimed turn.
//
// The last documents, one for each label of OWN_JS_FRESH_SPLIT=<label>[,<label>], are the split between Canvas and the
// library's own JavaScript by a third method, the questions asked again: one pass's measureText calls are recorded (the
// context object and the string, in order), and then the real measureText is called with them again, in the same order
// on the same contexts, with nothing of the library between two calls. That is what Canvas costs for those questions
// with no timer and no wrapper inside the library's pass. It is a lower bound of Canvas's share in place: the calls
// follow each other, so Canvas's code and data stay in the processor's caches. They are asked twice, of the recorded
// contexts and of contexts made anew with their settings, since a pass starts its own list of contexts and a new
// context has looked up none of its fonts' glyphs.
//
// A document fetches its library and the messages from a second local server this module starts (a bundle is 2 MB, and
// the runner keeps every probe's script in its output).
//
//   OWN_JS_TREES="base=<checkout>,head=<checkout>" OWN_JS_ROUNDS=16 OWN_JS_PASSES=5 OWN_JS_MESSAGES=10000 OWN_JS_KEPT=3000 \
//   [OWN_JS_LANGUAGE=th] [OWN_JS_FRESH_SPLIT=base,head] \
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=webkit-host --isolated --probes=rebuild/tools/own-js-fresh-pages.ts --out=<dir> \
//       --probe-timeout-ms=600000 --stall-ms=600000
//   bun rebuild/tools/own-js-fresh-summary.ts <dir>/<browser>-probes.json
//
// A checkout is any folder that holds rebuild/src and rebuild/tools/own-js-probe-entry.ts.
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat, buildLanguages } from '../bench/cases.ts'

const LOAD = String.raw`
const [libraryText, SETS] = await Promise.all([
  fetch(SERVER + '/lib/' + LABEL + '.js').then((response) => response.text()),
  fetch(SERVER + '/sets.json').then((response) => response.json()),
]);
(0, eval)(libraryText);
const lib = globalThis.ownJs;
const WIDTH = 320;
const WIDTHS = [260, 380, 440];
const sets = Object.keys(SETS);
// A turn of the event loop between passes. Not a timer: a page that was never visible has its timers held to one a second.
const pause = () => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
  channel.port2.postMessage(0);
});
const env = lib.environment();
const paragraphs = {};
for (const set of sets) paragraphs[set] = SETS[set].map((message) => lib.paragraphOf(message.parts));
`

const ROUND = String.raw`
const out = { label: LABEL, round: ROUND, crossOriginIsolated: window.crossOriginIsolated, messages: SETS[sets[0]].length, kept: KEPT, cold: 0, scratch: {}, relayout: {}, lines: {} };
for (const set of sets) { out.scratch[set] = []; out.relayout[set] = []; }
for (let pass = 0; pass <= PASSES; pass++) {
  for (const set of sets) {
    await pause();
    const t0 = performance.now();
    const lines = lib.scratch(paragraphs[set], env, WIDTH);
    const ms = performance.now() - t0;
    if (pass === 0 && set === sets[0]) out.cold = ms;
    if (pass > 0) out.scratch[set].push(ms);
    out.lines[set] = lines;
  }
}
for (const set of sets) {
  const kept = lib.prepareAll(paragraphs[set].slice(0, KEPT), env, WIDTH);
  lib.relayout(kept, WIDTHS);
  for (let pass = 0; pass < PASSES; pass++) {
    await pause();
    const t0 = performance.now();
    lib.relayout(kept, WIDTHS);
    out.relayout[set].push(performance.now() - t0);
  }
}
return out;
`

const SPLIT = String.raw`
const Canvas2D = OffscreenCanvasRenderingContext2D.prototype;
const realMeasureText = Canvas2D.measureText;
const out = { label: LABEL, split: [] };
for (const set of sets) lib.scratch(paragraphs[set].slice(0, 1000), env, WIDTH);
for (const set of sets) {
  const result = { set, calls: 0, contexts: 0, real: [], asked: [], askedOfNew: [], loop: [] };
  lib.scratch(paragraphs[set], env, WIDTH);
  const questions = [];
  Canvas2D.measureText = function (text) {
    questions.push(this, text);
    return realMeasureText.call(this, text);
  };
  lib.scratch(paragraphs[set], env, WIDTH);
  Canvas2D.measureText = realMeasureText;
  result.calls = questions.length / 2;
  result.contexts = new Set(questions.filter((_, i) => i % 2 === 0)).size;
  // The same questions for contexts made anew with the recorded ones' settings, as a pass that starts its own list asks
  // them: a new context starts with none of the fonts' glyphs looked up.
  const SETTINGS = ['lang', 'font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'];
  const onNewContexts = () => {
    const made = new Map();
    const out = [];
    for (let i = 0; i < questions.length; i += 2) {
      let context = made.get(questions[i]);
      if (context === undefined) {
        context = new OffscreenCanvas(1, 1).getContext('2d');
        for (const name of SETTINGS) context[name] = questions[i][name];
        made.set(questions[i], context);
      }
      out.push(context, questions[i + 1]);
    }
    return out;
  };
  // The loop alone: the same walk over the recorded questions with a call that asks nothing.
  const nothing = function (text) { return { width: text.length }; };
  for (let pass = 0; pass < PASSES; pass++) {
    await pause();
    let t0 = performance.now();
    lib.scratch(paragraphs[set], env, WIDTH);
    result.real.push(performance.now() - t0);
    await pause();
    let sum = 0;
    t0 = performance.now();
    for (let i = 0; i < questions.length; i += 2) sum += realMeasureText.call(questions[i], questions[i + 1]).width;
    result.asked.push(performance.now() - t0);
    const again = onNewContexts();
    await pause();
    t0 = performance.now();
    for (let i = 0; i < again.length; i += 2) sum += realMeasureText.call(again[i], again[i + 1]).width;
    result.askedOfNew.push(performance.now() - t0);
    await pause();
    t0 = performance.now();
    for (let i = 0; i < questions.length; i += 2) sum += nothing.call(questions[i], questions[i + 1]).width;
    result.loop.push(performance.now() - t0);
    if (sum < 0) throw new Error('unreachable');
  }
  out.split.push(result);
}
return out;
`

export default async function freshPageProbes(): Promise<Probe[]> {
  const trees = (process.env['OWN_JS_TREES'] ?? '').split(',').filter(entry => entry !== '')
  if (trees.length === 0) throw new Error('OWN_JS_TREES="label=<checkout>[,label=<checkout>]" names the checkouts')
  const rounds = Number(process.env['OWN_JS_ROUNDS'] ?? '16')
  const passes = Number(process.env['OWN_JS_PASSES'] ?? '5')
  const messages = Number(process.env['OWN_JS_MESSAGES'] ?? '10000')
  const kept = Number(process.env['OWN_JS_KEPT'] ?? '3000')
  const language = process.env['OWN_JS_LANGUAGE'] ?? ''
  const splits = (process.env['OWN_JS_FRESH_SPLIT'] ?? '').split(',').filter(label => label !== '')
  const labels: string[] = []
  const files = new Map<string, string>()
  for (let i = 0; i < trees.length; i++) {
    const at = trees[i]!.indexOf('=')
    const label = trees[i]!.slice(0, at)
    const built = await Bun.build({ entrypoints: [join(trees[i]!.slice(at + 1), 'rebuild/tools/own-js-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling ${trees[i]!} failed: ${built.logs.join('\n')}`)
    labels.push(label)
    files.set(`/lib/${label}.js`, await built.outputs[0]!.text())
  }
  for (let i = 0; i < splits.length; i++) if (!labels.includes(splits[i]!)) throw new Error(`OWN_JS_FRESH_SPLIT: ${splits[i]!} isn't one of ${labels.join(', ')}`)
  const sets: Record<string, { parts: { code: boolean; text: string }[] }[]> = language === ''
    ? { mix: buildChat('mix', messages), latin: buildChat('latin', messages) }
    : { [language]: buildLanguages(messages * 11).filter(message => message.language === language).map(message => ({ parts: [{ code: false, text: message.text }] })) }
  files.set('/sets.json', JSON.stringify(sets))
  // The probe page is cross-origin isolated, so what it fetches from this second origin has to allow it.
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    fetch(request) {
      const body = files.get(new URL(request.url).pathname)
      if (body === undefined) return new Response('not found', { status: 404 })
      return new Response(body, { headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin', 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } })
    },
  })
  const constants = (label: string, round: number): string => `const SERVER = ${JSON.stringify(`http://127.0.0.1:${server.port}`)};\nconst LABEL = ${JSON.stringify(label)};\nconst ROUND = ${round};\nconst PASSES = ${passes};\nconst KEPT = ${kept};\n`
  const probes: Probe[] = []
  for (let round = 0; round < rounds; round++) {
    for (let k = 0; k < labels.length; k++) {
      const label = labels[(k + round) % labels.length]!
      probes.push({
        id: `own-js fresh r${round} ${label}`, spec: 'the profiling phase: one checkout\'s library a fresh page, the checkouts taking turns', pageLang: 'en', html: '<div></div>',
        observe: [{ kind: 'script', source: `${constants(label, round)}${LOAD}${ROUND}` }],
      })
    }
  }
  for (let i = 0; i < splits.length; i++) {
    probes.push({
      id: `own-js fresh split ${i} ${splits[i]!}`, spec: 'the profiling phase: Canvas\'s share by asking one pass\'s questions again', pageLang: 'en', html: '<div></div>',
      observe: [{ kind: 'script', source: `${constants(splits[i]!, rounds)}${LOAD}${SPLIT}` }],
    })
  }
  return probes
}
