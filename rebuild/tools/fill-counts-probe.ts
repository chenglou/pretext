// A measuring probe for profiling item 3 (research/PROFILING-START.md): what the library asks Canvas for the chat
// benchmark's messages, from scratch at 320px, in a real browser, by message kind: measureText calls, the UTF-16 units
// sent to Canvas, the longest string, and lines. Counts don't depend on the machine's load; the time per kind is the
// page's own clock around each message and is only a rough share. Beside them, one Chinese paragraph without spaces, a
// single shaping unit in Firefox, at several lengths: the first layout of each, timed once.
//
//   bun rebuild/probes/runner.ts --browser=<b> --probes=rebuild/tools/fill-counts-probe.ts --out=<dir> \
//     --probe-timeout-ms=900000 --stall-ms=900000        (under the browser lock)
//
// It runs the library of the tree it is in (the bundle of tools/store-library-probe-entry.ts), so a before and an
// after are two runs from two checkouts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat } from '../bench/cases.ts'

const MESSAGES = 1000
const LONG_UNITS = [250, 1000, 3000, 9428]

const BODY = String.raw`
const lib = globalThis.storeStudy;
const env = lib.environment();
const proto = OffscreenCanvasRenderingContext2D.prototype;
const realMeasure = proto.measureText;
let calls = 0, units = 0, longest = 0;
proto.measureText = function (text) { calls++; units += text.length; if (text.length > longest) longest = text.length; return realMeasure.call(this, text); };
const one = (parts) => {
  const paragraph = lib.paragraphOf(parts);
  calls = 0; units = 0; longest = 0;
  const t0 = performance.now();
  const lines = lib.scratch([paragraph], env, 320);
  return { ms: performance.now() - t0, calls, units, longest, lines };
};
try {
  const out = { userAgent: navigator.userAgent, engine: env.engine, devicePixelRatio: window.devicePixelRatio, sets: [], long: [] };
  for (const set of Object.keys(SETS)) {
    const byKind = new Map();
    // Once untimed over the first 200, for compiled code.
    for (let i = 0; i < 200; i++) one(SETS[set][i].parts);
    for (const message of SETS[set]) {
      let textUnits = 0;
      for (const part of message.parts) textUnits += part.text.length;
      const r = one(message.parts);
      let k = byKind.get(message.kind);
      if (k === undefined) { k = { kind: message.kind, messages: 0, textUnits: 0, calls: 0, unitsSent: 0, longest: 0, lines: 0, ms: 0 }; byKind.set(message.kind, k); }
      k.messages++; k.textUnits += textUnits; k.calls += r.calls; k.unitsSent += r.units; k.lines += r.lines; k.ms += r.ms;
      if (r.longest > k.longest) k.longest = r.longest;
    }
    out.sets.push({ set, kinds: [...byKind.values()] });
  }
  for (const text of LONG) out.long.push({ textUnits: text.length, ...one([{ code: false, text }]) });
  return out;
} finally {
  proto.measureText = realMeasure;
}
`

export default async function fillCountsProbes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'store-library-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  const sets = { mix: buildChat('mix', MESSAGES), latin: buildChat('latin', MESSAGES) }
  // The bench's Chinese sources without their white space: one shaping unit.
  let chinese = ''
  for (const name of ['zh-zhufu', 'zh-guxiang']) chinese += readFileSync(join(import.meta.dir, '..', '..', 'corpora', `${name}.txt`), 'utf8').replace(/\s+/gu, '')
  const long: string[] = []
  for (let i = 0; i < LONG_UNITS.length; i++) long.push(chinese.slice(0, LONG_UNITS[i]!))
  return [{
    id: 'fill-counts C1', spec: 'profiling item 3: calls and units sent to Canvas by chat message kind, and one long Chinese unit', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\nconst SETS = ${JSON.stringify(sets)};\nconst LONG = ${JSON.stringify(long)};\n${BODY}` }],
  }]
}
