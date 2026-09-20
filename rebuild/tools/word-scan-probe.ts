// A probe for Gecko's word scan (src/engines/gecko/lines.ts wordScan) in the real browser: the chat benchmark's messages
// from scratch and kept at three other widths, the engine's loop ('exact') and the word scan ('premise') taking turns in
// one document, with the order turned round every round. First counts, which don't depend on the machine's load:
// measureText calls and characters sent a message from scratch and a layout at a new width and at a width met before,
// the lines by how their scans were decided, and a hash of every line's range in each mode, which must be the same.
// Then the times: 10,000 messages from scratch with a list of contexts a message and with one list for the set, the
// same prepared and filled to be kept, and the 30,000 layouts at the other widths. It times the bench's fixed arithmetic
// (bench/page.ts spin) at the start and the end.
//
//   WORD_SCAN_MESSAGES=<messages.json> [WORD_SCAN_ROUNDS=4] [WORD_SCAN_MODE=premise|proven] [WORD_SCAN_WRAP=break-word|normal|anywhere] \
//     bun rebuild/probes/runner.ts --browser=firefox \
//     --probes=rebuild/tools/word-scan-probe.ts --out=<dir> --probe-timeout-ms=900000 --stall-ms=900000
//   (under the browser lock; --exclusive for the times)
//
// messages.json: { latin: ChatMessage[], mix: ChatMessage[] } from bench/cases.ts buildChat.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const lib = globalThis.wordScanProbe;
const env = lib.environment();
const now = () => performance.now();
const WIDTH = 320;
const OTHER_WIDTHS = [260, 380, 440];
const MODES = ['exact', MODE];
const proto = OffscreenCanvasRenderingContext2D.prototype;
const realMeasure = proto.measureText;
let calls = 0, characters = 0, sink = 0;
const counting = function (text) { calls++; characters += text.length; return realMeasure.call(this, text); };
const counted = (work) => { calls = 0; characters = 0; proto.measureText = counting; try { work(); } finally { proto.measureText = realMeasure; } return { calls, characters }; };
const spin = () => { const start = now(); let x = 1; for (let i = 0; i < 20000000; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; } sink += x & 1; return now() - start; };
const spinStart = spin();
const out = [];
const sets = Object.keys(MESSAGES);
for (let s = 0; s < sets.length; s++) {
  const paragraphs = MESSAGES[sets[s]].map(message => lib.paragraphOf(message.parts, WRAP));
  const counts = {};
  for (let m = 0; m < MODES.length; m++) {
    lib.setMode(MODES[m]);
    sink += lib.scratch(paragraphs.slice(0, 200), env, WIDTH, false);
    let lines = 0;
    const scratch = counted(() => { lines = lib.scratch(paragraphs, env, WIDTH, false); });
    let kept = null;
    const prepared = counted(() => { kept = lib.prepareAll(paragraphs, env, WIDTH); });
    const firstResize = counted(() => { sink += lib.relayout(kept, OTHER_WIDTHS); });
    const resizeAgain = counted(() => { sink += lib.relayout(kept, OTHER_WIDTHS); });
    const fresh = lib.prepareAll(paragraphs, env, WIDTH);
    const how = lib.decided(fresh, [WIDTH].concat(OTHER_WIDTHS));
    counts[MODES[m]] = { lines, scratch, prepared, firstResize, resizeAgain, decided: how.lines, ranges: how.ranges };
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const times = { exact: { scratch: [], scratchOneList: [], prepareAndFill: [], relayout: [] }, [MODE]: { scratch: [], scratchOneList: [], prepareAndFill: [], relayout: [] } };
  for (let round = 0; round < ROUNDS; round++) {
    for (let m = 0; m < MODES.length; m++) {
      const mode = MODES[round % 2 === 0 ? m : MODES.length - 1 - m];
      lib.setMode(mode);
      const t0 = now();
      sink += lib.scratch(paragraphs, env, WIDTH, false);
      const t1 = now();
      sink += lib.scratch(paragraphs, env, WIDTH, true);
      const t2 = now();
      const kept = lib.prepareAll(paragraphs, env, WIDTH);
      const t3 = now();
      sink += lib.relayout(kept, OTHER_WIDTHS);
      const t4 = now();
      times[mode].scratch.push(t1 - t0);
      times[mode].scratchOneList.push(t2 - t1);
      times[mode].prepareAndFill.push(t3 - t2);
      times[mode].relayout.push(t4 - t3);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  out.push({ set: sets[s], messages: paragraphs.length, counts, timesMs: times });
}
lib.setMode('premise');
return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, rounds: ROUNDS, mode: MODE, overflowWrap: WRAP, spinMs: { start: spinStart, end: spin() }, sink, sets: out };
`

export default async function wordScanProbes(): Promise<Probe[]> {
  const path = process.env['WORD_SCAN_MESSAGES']
  if (path === undefined) throw new Error('WORD_SCAN_MESSAGES names the messages file')
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'word-scan-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  const rounds = Number(process.env['WORD_SCAN_ROUNDS'] ?? 4)
  const mode = process.env['WORD_SCAN_MODE'] ?? 'premise'
  const wrap = process.env['WORD_SCAN_WRAP'] ?? 'break-word'
  return [{
    id: 'word-scan W1', spec: 'speculative study: Gecko\'s word scan against the engine\'s loop, counts and times in one document', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\nconst MESSAGES = ${readFileSync(path, 'utf8')};\nconst ROUNDS = ${rounds};\nconst MODE = ${JSON.stringify(mode)};\nconst WRAP = ${JSON.stringify(wrap)};\n${BODY}` }],
  }]
}
