// The library's Canvas checks at engine detection (rebuild/src/env.ts detectEngine, src/measure/canvas-checks.ts) in a
// browser. The page runs the library's own module, bundled here, so the answer is the one an app gets; beside it the raw
// values the checks read: which text attributes an OffscreenCanvas context has, whether TextMetrics has the ink box, and
// what each port's ligature-free letter spacing adds to the width of one, two and sixteen `n` (the checks' string), and how
// far it moves the ink box's right edge.
//
// A pinned browser must answer supported (the `checks`). A build whose Canvas lacks what the recipes assume must answer
// unsupported and name it: Firefox 140.16.0esr, the build of rebuild/research/VERSION-DRIFT.md, has no `lang` and keeps a
// 0.001px letter spacing as a fraction.
//
// Run under the browser lock, from the worktree:
//   python3 ~/github/pretext-rebuild/.artifacts/session/with-browser-lock.py canvas-checks-firefox -- bun rebuild/probes/runner.ts \
//     --browser=firefox --probes=rebuild/probes/canvas-checks.ts --out=.artifacts/probes/canvas-checks/firefox-156
// (and --browser=chrome, --browser=webkit-host). Another build: LAB_FIREFOX_APP=<bundle> or LAB_CHROME_APP=<bundle> before
// the command, and an --out of its own.
import { join } from 'node:path'
import type { Probe } from './types.ts'

const PAGE = String.raw`
const lib = await import('data:text/javascript;base64,' + LIBRARY);
const detected = lib.detectEngine();
const context = () => new OffscreenCanvas(1, 1).getContext('2d');
const first = context();
const attributes = {};
for (const name of ['lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction']) attributes[name] = name in first;
const measure = (spacing, text) => {
  const c = context();
  c.font = '16px serif';
  if (spacing !== null) c.letterSpacing = spacing;
  const m = c.measureText(text);
  return { width: m.width, right: typeof m.actualBoundingBoxRight === 'number' ? m.actualBoundingBoxRight : null, left: typeof m.actualBoundingBoxLeft === 'number' ? m.actualBoundingBoxLeft : null };
};
const spacings = {};
for (const spacing of ['0.001px', '0.015625px']) {
  spacings[spacing] = {};
  for (const text of ['n', 'nn', 'nnnnnnnnnnnnnnnn']) {
    const plain = measure(null, text), spaced = measure(spacing, text);
    spacings[spacing][text] = { plain, spaced, added: spaced.width - plain.width, rightMoved: plain.right === null ? null : spaced.right - plain.right };
  }
}
const checks = [{ name: 'detectEngine() answers supported', measured: detected.kind, expected: 'supported', ok: detected.kind === 'supported' }];
return { detected, attributes, spacings, checks, pre: [] };
`

export default async function probes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/env.ts')], format: 'esm', target: 'browser' })
  if (!built.success) throw new Error(`env.ts didn't bundle: ${built.logs.map(log => log.message).join('\n')}`)
  const library = Buffer.from(await built.outputs[0]!.text()).toString('base64')
  return [{
    id: 'canvas-checks/detect-engine',
    spec: 'rebuild/src/measure/canvas-checks.ts: what the measuring recipes assume of the Canvas API, in this browser',
    pageLang: 'en',
    html: '<div></div>',
    observe: [{ kind: 'env' }, { kind: 'script', source: `const LIBRARY = ${JSON.stringify(library)};\n${PAGE}` }],
  }]
}
