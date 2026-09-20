// The profiling phase's split of Firefox's wall time between the browser's Canvas and the port's own JavaScript, on the
// chat benchmark's messages (bench/cases.ts buildChat): from scratch with one list of contexts a pass, and the resize
// case. Everything runs in ONE page, the modes and the checkouts taking turns round by round, so whatever the machine
// does it does to every side of a difference. tools/prof-entry.ts has the three Canvases.
// - `split`: a pass on the real Canvas against the same pass on the stand-in. The stand-in's time is the port's own
//   JavaScript; the difference is the browser's share.
// - `resize`: the same for 10,000 kept messages laid out at three new widths (prepared and first filled untimed).
// - `phases`: the scratch pass with a timer between prepare and the fill of every message, in both modes.
// - `canvas`: the second method for the browser's share, on the first PROF_CANVAS_MESSAGES messages: the recorded calls
//   alone on the real Canvas, without the library.
// - `export`: the first PROF_EXPORT_MESSAGES messages' recorded answers and the environment, for tools/prof-bun.ts.
// - `micro`: what a few operations the port runs for every message or question cost in this browser, a million times
//   each: a typed array of a chat message's length, a view of one, the three ways to make a string of its units.
// - `loop`: the scratch pass on the real Canvas and nothing else, PROF_ROUNDS times: what to hold the Gecko profiler
//   over (`kill -USR1 <firefox pid>` starts it, `-USR2` stops it and writes profile_<n>_<pid>.json to the profile's
//   download folder: prefs browser.download.folderList 2 and browser.download.dir).
// Several checkouts (PROF_TREES="base=<checkout>,head=<checkout>") give alternating pairs of a change, in both modes;
// each records its own questions, and equal hashes say the change moved no question. A checkout needs rebuild/src and
// this tool's prof-entry.ts. PROF_SETS=mix,latin names the chat sets, PROF_MESSAGES their size (10,000), and
// PROF_RESIZE_TREES=base,head the checkouts the resize section runs (all when empty).
//
//   PROF_SECTIONS=split,resize,phases,canvas PROF_ROUNDS=12 \
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/prof-probe.ts --out=<dir> \
//       --firefox-prefs=<prefs.json> --probe-timeout-ms=1500000 --stall-ms=1500000
// The prefs file turns Firefox's timer clamp off for the `phases` section, which reads a timer twice a message:
//   { "privacy.reduceTimerPrecision": false, "privacy.resistFingerprinting.reduceTimerPrecision.jitter": false }
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat } from '../bench/cases.ts'

const BODY = String.raw`
const sets = Object.keys(SETS);
const WIDTHS = [260, 380, 440];
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const has = (section) => CONFIG.sections.includes(section);
for (const entry of LIBS) {
  entry.env = entry.lib.environment();
  entry.paragraphs = {};
  for (const set of sets) entry.paragraphs[set] = SETS[set].map((message) => entry.lib.paragraphOf(message.parts));
}
let step = Infinity;
for (let i = 0, last = performance.now(); i < 200000; i++) { const now = performance.now(); if (now > last) { step = Math.min(step, now - last); last = now; } }
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, messages: CONFIG.messages, timerStepMs: step, recordings: [], rows: [], exported: null, micro: null };
// Once untimed over the first 1,000 of each set, for compiled code.
for (const entry of LIBS) for (const set of sets) entry.lib.scratch(entry.paragraphs[set].slice(0, 1000), entry.env, 320);

// Records one scenario of one checkout, once: what it asks, and the stand-in's answers. 'resize' marks where the relayout
// starts. The recording itself is kept only with its strings, for the replay on the real Canvas.
const recorded = new Map();
const sharedAnswers = new Map();
function record(entry, set, scenario, count, texts) {
  const key = [entry.label, set, scenario, count, texts].join(' ');
  if (!recorded.has(key)) recorded.set(key, recordNow(entry, set, scenario, count, texts));
  return recorded.get(key);
}
function recordNow(entry, set, scenario, count, texts) {
  const lib = entry.lib;
  const paragraphs = entry.paragraphs[set].slice(0, count);
  const recording = lib.newRecording(texts);
  lib.recordingCanvas(recording);
  let mark = 0;
  let lines;
  if (scenario === 'scratch') lines = lib.scratch(paragraphs, entry.env, 320);
  else { const prepared = lib.prepareAll(paragraphs, entry.env, 320); mark = recording.context.length; lines = lib.relayout(prepared, WIDTHS); }
  lib.realCanvas();
  const answers = lib.answersOf(recording);
  // The checked stand-in over the same scenario: every call's string as long as the recorded one's, every answer used.
  lib.standInCanvas(answers, true);
  let standInLines;
  if (scenario === 'scratch') standInLines = lib.scratch(paragraphs, entry.env, 320);
  else standInLines = lib.relayout(lib.prepareAll(paragraphs, entry.env, 320), WIDTHS);
  lib.realCanvas();
  let units = 0;
  for (let i = 0; i < recording.length.length; i++) units += recording.length[i];
  // What prepare alone asks: the fill's questions are the rest.
  const prepareRecording = lib.newRecording(false);
  lib.recordingCanvas(prepareRecording);
  lib.prepareOnly(paragraphs, entry.env);
  lib.realCanvas();
  out.recordings.push({ label: entry.label, set, scenario, messages: count, calls: recording.context.length, callsBeforeMark: mark, callsInPrepare: prepareRecording.context.length, units, contexts: recording.settings.length, hash: recording.hash >>> 0, lines, standInLines });
  // Checkouts that asked the same questions in the same order share one set of answers.
  const sharedKey = [set, scenario, count].join(' ');
  const first = sharedAnswers.get(sharedKey);
  if (first !== undefined && first.hash === recording.hash && first.answers.width.length === answers.width.length) return { paragraphs, recording: texts ? recording : null, answers: first.answers, mark };
  if (first === undefined) sharedAnswers.set(sharedKey, { hash: recording.hash, answers });
  return { paragraphs, recording: texts ? recording : null, answers, mark };
}

async function timed(label, set, scenario, mode, round, run) {
  await pause();
  const t0 = performance.now();
  const lines = run();
  out.rows.push({ label, set, scenario, mode, round, ms: performance.now() - t0, lines });
}

for (const scenario of ['scratch', 'resize']) {
  if (!has(scenario === 'scratch' ? 'split' : 'resize')) continue;
  const jobs = [];
  for (const entry of LIBS) for (const set of sets) {
    if (scenario === 'resize' && CONFIG.resizeTrees.length > 0 && !CONFIG.resizeTrees.includes(entry.label)) continue;
    const made = record(entry, set, scenario, CONFIG.messages, false);
    for (const mode of ['real', 'stand-in']) jobs.push({ entry, set, mode, made });
  }
  for (let round = 0; round < CONFIG.rounds; round++) {
    for (let k = 0; k < jobs.length; k++) {
      // Forward on even rounds and backward on odd ones, starting one job later each round.
      const job = jobs[(round % 2 === 0 ? k + round : jobs.length * CONFIG.rounds - k - round) % jobs.length];
      const lib = job.entry.lib;
      if (job.mode === 'stand-in') lib.standInCanvas(job.made.answers, false);
      if (scenario === 'scratch') await timed(job.entry.label, job.set, scenario, job.mode, round, () => lib.scratch(job.made.paragraphs, job.entry.env, 320));
      else {
        const prepared = lib.prepareAll(job.made.paragraphs, job.entry.env, 320);
        await timed(job.entry.label, job.set, scenario, job.mode, round, () => lib.relayout(prepared, WIDTHS));
      }
      lib.realCanvas();
    }
  }
}

if (has('phases')) {
  const jobs = [];
  for (const entry of LIBS) for (const set of sets) {
    const made = record(entry, set, 'scratch', CONFIG.messages, false);
    for (const mode of ['real', 'stand-in']) jobs.push({ entry, set, mode, made });
  }
  for (let round = 0; round < CONFIG.rounds; round++) {
    for (let k = 0; k < jobs.length; k++) {
      const job = jobs[(round % 2 === 0 ? k + round : jobs.length * CONFIG.rounds - k - round) % jobs.length];
      const lib = job.entry.lib;
      await pause();
      if (job.mode === 'stand-in') lib.standInCanvas(job.made.answers, false);
      const phases = lib.scratchPhases(job.made.paragraphs, job.entry.env, 320);
      lib.realCanvas();
      out.rows.push({ label: job.entry.label, set: job.set, scenario: 'phases', mode: job.mode, round, ms: phases.prepareMs + phases.fillMs, prepareMs: phases.prepareMs, fillMs: phases.fillMs, lines: phases.lines });
    }
  }
}

if (has('canvas')) {
  const entry = LIBS[LIBS.length - 1];
  for (const scenario of ['scratch', 'resize']) for (const set of sets) {
    const made = record(entry, set, scenario, CONFIG.canvasMessages, true);
    const lib = entry.lib;
    for (let round = 0; round < CONFIG.rounds; round++) {
      const order = round % 2 === 0 ? ['real', 'stand-in', 'canvas'] : ['canvas', 'stand-in', 'real'];
      for (const mode of order) {
        if (mode === 'canvas') {
          await pause();
          const replay = lib.canvasOnly(made.recording, made.mark);
          out.rows.push({ label: entry.label, set, scenario: scenario + '-first-' + CONFIG.canvasMessages, mode, round, ms: replay.measureMs, contextsMs: replay.contextsMs, lines: 0 });
          continue;
        }
        if (mode === 'stand-in') lib.standInCanvas(made.answers, false);
        if (scenario === 'scratch') await timed(entry.label, set, scenario + '-first-' + CONFIG.canvasMessages, mode, round, () => lib.scratch(made.paragraphs, entry.env, 320));
        else {
          const prepared = lib.prepareAll(made.paragraphs, entry.env, 320);
          await timed(entry.label, set, scenario + '-first-' + CONFIG.canvasMessages, mode, round, () => lib.relayout(prepared, WIDTHS));
        }
        lib.realCanvas();
      }
    }
  }
}

if (has('micro')) {
  const units = new Uint16Array(111);
  for (let i = 0; i < units.length; i++) units[i] = 97 + (i % 26);
  const text = String.fromCharCode.apply(null, units);
  const cases = {
    'new Int32Array(111)': () => new Int32Array(111).length,
    'new Uint8Array(111)': () => new Uint8Array(111).length,
    'new Int32Array(12)': () => new Int32Array(12).length,
    'units.subarray(3, 9)': () => units.subarray(3, 9).length,
    'units.slice(0, 111)': () => units.slice(0, 111).length,
    'string of 6 units, a character at a time': () => { let s = ''; for (let k = 3; k < 9; k++) s += String.fromCharCode(units[k]); return s.length; },
    'string of 6 units, text.slice(3, 9)': () => text.slice(3, 9).length,
    'string of 111 units, a character at a time': () => { let s = ''; for (let k = 0; k < 111; k++) s += String.fromCharCode(units[k]); return s.length; },
    'string of 111 units, a spread of a view': () => String.fromCharCode(...units.subarray(0, 8192)).length,
    'string of 111 units, Reflect.apply over a view': () => Reflect.apply(String.fromCharCode, null, units.subarray(0, 8192)).length,
    'an object of two fields': () => ({ au: units[5], standIn: null }).au,
    'a Set made and asked once': () => new Set().has('u') ? 1 : 0,
  };
  out.micro = {};
  for (let round = 0; round < 5; round++) {
    for (const name of Object.keys(cases)) {
      const run = cases[name];
      let n = 0;
      await pause();
      const t0 = performance.now();
      for (let i = 0; i < 1000000; i++) n += run();
      const ns = performance.now() - t0;
      if (out.micro[name] === undefined) out.micro[name] = [];
      out.micro[name].push(Math.round(ns * 10) / 10 + (n < 0 ? 1 : 0));
    }
  }
}

if (has('loop')) {
  for (let round = 0; round < CONFIG.rounds; round++) {
    for (const entry of LIBS) for (const set of sets) await timed(entry.label, set, 'loop', 'real', round, () => entry.lib.scratch(entry.paragraphs[set], entry.env, 320));
  }
}

if (has('export')) {
  const entry = LIBS[LIBS.length - 1];
  out.exported = { env: entry.env, messages: CONFIG.exportMessages, sets: {} };
  for (const set of sets) {
    const made = record(entry, set, 'resize', CONFIG.exportMessages, false);
    out.exported.sets[set] = { mark: made.mark, length: Array.from(made.answers.length), width: Array.from(made.answers.width), left: Array.from(made.answers.left), right: Array.from(made.answers.right) };
  }
}
return out;
`

export default async function profProbes(): Promise<Probe[]> {
  const here = resolve(import.meta.dir, '../..')
  const trees = (process.env['PROF_TREES'] ?? `head=${here}`).split(',').filter(entry => entry !== '')
  const config = {
    sections: (process.env['PROF_SECTIONS'] ?? 'split,resize,phases,canvas').split(','),
    rounds: Number(process.env['PROF_ROUNDS'] ?? '12'),
    messages: Number(process.env['PROF_MESSAGES'] ?? '10000'),
    canvasMessages: Number(process.env['PROF_CANVAS_MESSAGES'] ?? '2000'),
    exportMessages: Number(process.env['PROF_EXPORT_MESSAGES'] ?? '1000'),
    // The checkouts the resize section runs, by label; every one when empty.
    resizeTrees: (process.env['PROF_RESIZE_TREES'] ?? '').split(',').filter(label => label !== ''),
  }
  let libs = 'const LIBS = [];\n'
  for (let i = 0; i < trees.length; i++) {
    const at = trees[i]!.indexOf('=')
    const built = await Bun.build({ entrypoints: [join(trees[i]!.slice(at + 1), 'rebuild/tools/prof-entry.ts')], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling ${trees[i]!} failed: ${built.logs.join('\n')}`)
    libs += `${await built.outputs[0]!.text()}\nLIBS.push({ label: ${JSON.stringify(trees[i]!.slice(0, at))}, lib: globalThis.prof });\n`
  }
  const sets: Record<string, unknown> = {}
  const names = (process.env['PROF_SETS'] ?? 'mix,latin').split(',')
  for (let i = 0; i < names.length; i++) sets[names[i]!] = buildChat(names[i] as 'mix' | 'latin', config.messages)
  return [{
    id: 'prof T1', spec: 'the profiling phase: the browser\'s Canvas against the port\'s own JavaScript on the chat benchmark, in one page', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${libs}const SETS = ${JSON.stringify(sets)};\nconst CONFIG = ${JSON.stringify(config)};\n${BODY}` }],
    browsers: ['firefox'],
  }]
}
