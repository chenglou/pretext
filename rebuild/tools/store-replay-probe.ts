// A replay probe for the store study: a browser makes the Canvas calls the rebuild makes for the chat benchmark's first
// 1,000 messages, from a trace written offline (tools/store-study.ts --part=trace), in five variants, and times each.
// Only Canvas work and the store's lookups are timed: none of the library's own JavaScript runs here.
//
//   STORE_TRACE=<trace.json> bun rebuild/probes/runner.ts --browser=<b> --probes=rebuild/tools/store-replay-probe.ts --out=<dir> \
//     --probe-timeout-ms=900000 --stall-ms=900000        (under the exclusive browser lock)
//
// Variants, each over every message of the trace:
// - today: the message's contexts made and set as the library does, then its calls in order.
// - contexts: the same contexts made and set, no call.
// - shared: contexts kept per settings for the page, the font checks' questions asked once per page, every engine
//   call made (PROFILING-START.md item 1).
// - store: shared, and a call reaches Canvas only when its context hasn't been asked that string; the rest are Map reads.
// - short: the word-and-boundary recipe's questions (main's segments, and the two clusters around each boundary,
//   together and alone) with the same store, on the main font's and the code font's context.
// A round runs the five in turn at a font size of its own (1/64 px steps), so the first variant of a round meets fonts
// no context has had, and the rounds rotate which variant goes first.
import { readFileSync } from 'node:fs'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const ROUNDS = 10;
const VARIANTS = ['today', 'contexts', 'shared', 'store', 'short'];
const now = () => performance.now();
let sink = 0;
const sized = (font, round) => font.replace(/(\d+(?:\.\d+)?)px/, (all, size) => (Number(size) + round / 64) + 'px');
const make = (settings, round) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = settings[1];
  c.font = sized(settings[0], round);
  c.letterSpacing = settings[2];
  c.wordSpacing = settings[3];
  c.fontKerning = settings[4];
  c.textRendering = settings[5];
  c.direction = settings[6];
  return c;
};
const strings = T.strings;
const messages = T.trace;
// The settings the engine asks most, and the code span's.
const asks = T.settings.map(() => 0);
for (let m = 0; m < messages.length; m++) { const t = messages[m]; for (let k = 0; k < t.calls.length; k += 3) if (t.calls[k + 2] !== 0) asks[t.contexts[t.calls[k]]]++; }
let mainSettings = 0, codeSettings = -1;
for (let i = 0; i < asks.length; i++) {
  if (asks[i] > asks[mainSettings]) mainSettings = i;
  if (T.settings[i][0].indexOf('Menlo') >= 0 && (codeSettings < 0 || asks[i] > asks[codeSettings])) codeSettings = i;
}
if (codeSettings < 0) codeSettings = mainSettings;

const run = (variant, round) => {
  let calls = 0, contexts = 0, lookups = 0;
  const shared = new Map();
  const sharedFor = (key, settingsIndex) => {
    let entry = shared.get(key);
    if (entry === undefined) { entry = { c: make(T.settings[settingsIndex], round), seen: new Map() }; shared.set(key, entry); contexts++; }
    return entry;
  };
  const t0 = now();
  for (let m = 0; m < messages.length; m++) {
    const t = messages[m];
    switch (variant) {
      case 'today': {
        const made = [];
        for (let i = 0; i < t.contexts.length; i++) made.push(make(T.settings[t.contexts[i]], round));
        contexts += made.length;
        for (let k = 0; k < t.calls.length; k += 3) sink += made[t.calls[k]].measureText(strings[t.calls[k + 1]]).width;
        calls += t.calls.length / 3;
        break;
      }
      case 'contexts':
        for (let i = 0; i < t.contexts.length; i++) sink += make(T.settings[t.contexts[i]], round).direction.length;
        contexts += t.contexts.length;
        break;
      case 'shared':
      case 'store':
        for (let k = 0; k < t.calls.length; k += 3) {
          const checks = t.calls[k + 2] === 0;
          const settingsIndex = t.contexts[t.calls[k]];
          const entry = sharedFor((checks ? 'c' : 'e') + settingsIndex, settingsIndex);
          const s = strings[t.calls[k + 1]];
          if (checks || variant === 'store') {
            lookups++;
            const known = entry.seen.get(s);
            if (known !== undefined) { sink += known; continue; }
            const w = entry.c.measureText(s).width;
            entry.seen.set(s, w);
            sink += w;
            calls++;
          } else {
            sink += entry.c.measureText(s).width;
            calls++;
          }
        }
        break;
      case 'short':
        for (let k = 0; k < t.short.length; k += 2) {
          const settingsIndex = t.short[k] === 0 ? mainSettings : codeSettings;
          const entry = sharedFor('s' + settingsIndex, settingsIndex);
          const s = strings[t.short[k + 1]];
          lookups++;
          const known = entry.seen.get(s);
          if (known !== undefined) { sink += known; continue; }
          const w = entry.c.measureText(s).width;
          entry.seen.set(s, w);
          sink += w;
          calls++;
        }
        break;
    }
  }
  return { variant, round, ms: now() - t0, calls, contexts, lookups };
};

const results = [];
for (let round = 0; round < ROUNDS; round++) {
  for (let v = 0; v < VARIANTS.length; v++) {
    const variant = VARIANTS[(v + round) % VARIANTS.length];
    const result = run(variant, round + 1);
    result.first = v === 0;
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
return { userAgent: navigator.userAgent, engine: T.engine, set: T.set, messages: messages.length, mainSettings: T.settings[mainSettings], codeSettings: T.settings[codeSettings], sink, results };
`

export default function storeReplayProbes(): Probe[] {
  const path = process.env['STORE_TRACE']
  if (path === undefined) throw new Error('STORE_TRACE names the trace file (tools/store-study.ts --part=trace)')
  const trace = JSON.parse(readFileSync(path, 'utf8')) as { engine: string; set: string }
  return [{
    id: `store-replay ${trace.engine} ${trace.set}`, spec: 'store study: the Canvas work of the chat messages, today and with contexts, a store and short questions', pageLang: 'en',
    html: '<div></div>', observe: [{ kind: 'script', source: `const T = ${JSON.stringify(trace)};\n${BODY}` }],
  }]
}
