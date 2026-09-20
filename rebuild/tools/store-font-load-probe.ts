// A probe for the x-perf-store prototype: a web font that finishes loading after a page's list of contexts was made
// (probes/contexts-font-load.ts has the contexts alone: Chrome's and Firefox's kept contexts measure with the loaded font
// by themselves, webkit-host's don't). Here the library itself lays a text out with one kept list before the font loads,
// and again with the same list and with a new one after it, beside the DOM's own line count. On a tree whose contexts keep
// no answers the kept list follows the font in Chrome and Firefox; on the prototype's tree a kept answer can't.
// `Hamburgefonstiv` at 48px is 433px in monospace and 328px in Amiri, so four of them at 700px are four lines before the
// load and two after. `again` prepares the same text 200 more times on the kept list: whether anything heals with use.
//
//   bun rebuild/probes/runner.ts --browser=chrome|firefox|webkit-host --probes=rebuild/tools/store-font-load-probe.ts --out=<dir>
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const lib = globalThis.storeFontLoad;
const env = lib.environment();
const FAMILY = '"Late Amiri", monospace';
const SEEN = 'Hamburgefonstiv Hamburgefonstiv Hamburgefonstiv Hamburgefonstiv';
const UNSEEN = 'Hamburgefonstiv again Hamburgefonstiv again Hamburgefonstiv again';
const box = document.createElement('div');
box.style.cssText = 'font: 400 48px/60px "Late Amiri", monospace; width: 700px; white-space: normal; overflow-wrap: normal; position: absolute; left: 0; top: 0';
document.body.append(box);
const domLines = (text) => { box.textContent = text; return Math.round(box.getBoundingClientRect().height / 60); };
const kept = [];
const out = { engine: env.engine, devicePixelRatio: window.devicePixelRatio, before: {}, after: {} };
out.before.dom = domLines(SEEN);
out.before.keptList = lib.lines(SEEN, FAMILY, 48, 700, env, kept);
const face = new FontFace('Late Amiri', await (await fetch('/fonts/amiri.ttf')).arrayBuffer());
await face.load();
document.fonts.add(face);
await document.fonts.ready;
await new Promise(done => { const channel = new MessageChannel(); channel.port1.onmessage = () => done(null); channel.port2.postMessage(null); });
out.after.dom = domLines(SEEN);
out.after.keptList = lib.lines(SEEN, FAMILY, 48, 700, env, kept);
out.after.newList = lib.lines(SEEN, FAMILY, 48, 700, env, []);
out.after.domUnseen = domLines(UNSEEN);
out.after.keptListUnseen = lib.lines(UNSEEN, FAMILY, 48, 700, env, kept);
out.after.newListUnseen = lib.lines(UNSEEN, FAMILY, 48, 700, env, []);
let again = null;
for (let i = 0; i < 200; i++) again = lib.lines(SEEN, FAMILY, 48, 700, env, kept);
out.after.keptListAfter200MorePrepares = again;
out.contextsInKeptList = kept.length;
out.answersInKeptList = kept.map(context => context.widths === undefined ? null : context.widths.size + context.inkBoxes.size);
document.fonts.delete(face);
box.remove();
return out;
`

export default async function storeFontLoadProbes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'store-font-load-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  return [{
    id: 'store-font-load F1', spec: 'store prototype: a font that loads after the page\'s list of contexts was made', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\n${BODY}` }],
  }]
}
