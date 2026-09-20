// A timing probe for profiling items 3 and 8 (research/PROFILING-START.md): the chat benchmark's headline, 10,000
// messages from scratch at 320px, for several checkouts of the library inside ONE page, in alternating order. Each
// checkout's library is bundled from its own tree (tools/store-library-probe-entry.ts) and keeps its own code; a round
// runs every library once over the mix and once over plain ASCII, and the next round starts one library later. Whatever
// the machine does during a round it does to every library, so the differences between libraries hold under a load
// that would spoil runs taken one browser after another; the absolute numbers still want a quiet machine.
//
//   FILL_AB_TREES="base=<checkout>,head=<checkout>" FILL_AB_ROUNDS=5 \
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/fill-ab-probe.ts --out=<dir> \
//       --probe-timeout-ms=1500000 --stall-ms=1500000
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat } from '../bench/cases.ts'

const MESSAGES = 10000

const BODY = String.raw`
const sets = Object.keys(SETS);
for (const entry of LIBS) {
  entry.env = entry.lib.environment();
  entry.paragraphs = {};
  for (const set of sets) entry.paragraphs[set] = SETS[set].map((message) => entry.lib.paragraphOf(message.parts));
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
// Once untimed over the first 1,000 of each set, for compiled code.
for (const entry of LIBS) for (const set of sets) entry.lib.scratch(entry.paragraphs[set].slice(0, 1000), entry.env, 320);
const out = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, messages: SETS[sets[0]].length, rounds: [] };
for (let round = 0; round < ROUNDS; round++) {
  const row = [];
  for (let k = 0; k < LIBS.length; k++) {
    const entry = LIBS[(k + round) % LIBS.length];
    for (const set of sets) {
      await pause();
      const t0 = performance.now();
      const lines = entry.lib.scratch(entry.paragraphs[set], entry.env, 320);
      row.push({ label: entry.label, set, ms: performance.now() - t0, lines });
    }
  }
  out.rounds.push(row);
}
return out;
`

export default async function fillAbProbes(): Promise<Probe[]> {
  const trees = (process.env['FILL_AB_TREES'] ?? '').split(',').filter(entry => entry !== '')
  if (trees.length < 2) throw new Error('FILL_AB_TREES="label=<checkout>,label=<checkout>" names at least two checkouts')
  const rounds = Number(process.env['FILL_AB_ROUNDS'] ?? '5')
  let libs = 'const LIBS = [];\n'
  for (let i = 0; i < trees.length; i++) {
    const at = trees[i]!.indexOf('=')
    const built = await Bun.build({ entrypoints: [join(trees[i]!.slice(at + 1), 'rebuild/tools/store-library-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling ${trees[i]!} failed: ${built.logs.join('\n')}`)
    libs += `${await built.outputs[0]!.text()}\nLIBS.push({ label: ${JSON.stringify(trees[i]!.slice(0, at))}, lib: globalThis.storeStudy });\n`
  }
  const sets = { mix: buildChat('mix', MESSAGES), latin: buildChat('latin', MESSAGES) }
  return [{
    id: 'fill-ab T1', spec: 'profiling items 3 and 8: the chat headline for several checkouts in one page, alternating', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${libs}const SETS = ${JSON.stringify(sets)};\nconst ROUNDS = ${rounds};\n${BODY}` }],
    browsers: ['firefox'],
  }]
}
