// The library with one kept list of contexts beside the DOM, where probes/contexts-start-up.ts showed raw kept contexts
// going stale (it runs the library, so it lives here, beside tools/fill-counts-probe.ts). Three words and three numbers at
// 32px in a 380px box: six lines in the monospace fallback, three in the named family. Read every 250 ms for eight seconds:
// the DOM's line count, the library's with one list kept from the start, and the library's with a new list.
//
// - L1: in a browser that has just started, families named by a Japanese name and by a legacy family name, which Firefox
//   learns about a second after it is first asked. Since Gecko's contexts are one call's (src/index.ts prepare), the kept
//   list follows a new one at every reading, and the DOM follows at its reflow; on a tree where Gecko uses the caller's
//   list, the kept list stays at six lines.
// - L2: a FontFace loaded first and added two seconds in, which is the one thing that makes WebKit's kept contexts stale.
//   A third list is the one the page starts anew right after its own add(), which is WebKit's contract.
//
// One probe a browser launch:
//   python3 .artifacts/session/with-browser-lock.py contexts-start-up-lib --browser=firefox -- bun rebuild/probes/runner.ts \
//     --browser=firefox --probes=rebuild/tools/contexts-start-up-probe.ts --only="L1" --out=<dir>
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

const OVER_TIME = String.raw`
const lib = globalThis.contextsStartUp;
const TEXT = 'Hamburgefonstiv 0123 Hamburgefonstiv 0123 Hamburgefonstiv 0123';
const WIDTH = 380;
const t0 = performance.now();
const boxes = FAMILIES.map(row => {
  const box = document.createElement('div');
  box.lang = 'en';
  box.style.cssText = 'font: normal 400 32px/40px ' + row[1] + '; width: ' + WIDTH + 'px; white-space: normal; overflow-wrap: normal; position: absolute; left: 0; top: 0';
  box.textContent = TEXT;
  document.body.append(box);
  return box;
});
const kept = FAMILIES.map(() => []);
const remade = FAMILIES.map(() => []);
const seen = FAMILIES.map(() => ({ dom: [], keptList: [], listRemadeAfterAdd: [], newList: [] }));
const note = (list, lines, ms) => { if (list.length === 0 || list[list.length - 1].lines !== lines) list.push({ lines, fromMs: ms }); };
const readAll = () => {
  const ms = Math.round(performance.now() - t0);
  for (let i = 0; i < FAMILIES.length; i++) {
    const family = FAMILIES[i][1];
    note(seen[i].dom, Math.round(boxes[i].getBoundingClientRect().height / 40), ms);
    note(seen[i].keptList, lib.lineCount(TEXT, family, 32, 'en', WIDTH, kept[i]), ms);
    note(seen[i].listRemadeAfterAdd, lib.lineCount(TEXT, family, 32, 'en', WIDTH, remade[i]), ms);
    note(seen[i].newList, lib.lineCount(TEXT, family, 32, 'en', WIDTH, []), ms);
  }
};
let fontStarted = false;
let addedAtMs = null;
const addLoadedFont = async () => {
  const face = new FontFace('Late Loaded', 'url(/fonts/amiri.ttf?late-loaded)');
  await face.load();
  document.fonts.add(face);
  for (let i = 0; i < remade.length; i++) remade[i] = [];
  addedAtMs = Math.round(performance.now() - t0);
};
readAll();
for (let k = 0; k < 32; k++) {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (LATE_FONT && !fontStarted && performance.now() - t0 >= 2000) { fontStarted = true; addLoadedFont(); }
  readAll();
}
for (let i = 0; i < boxes.length; i++) boxes[i].remove();
const last = list => list[list.length - 1].lines;
return {
  userAgent: navigator.userAgent, msSinceNavigationStart: Math.round(t0), addedAtMs,
  rows: FAMILIES.map((row, i) => ({ what: row[0], family: row[1], contextsInTheKeptList: kept[i].length, keptListEqualsNewListAtTheEnd: last(seen[i].keptList) === last(seen[i].newList), newListEqualsDomAtTheEnd: last(seen[i].newList) === last(seen[i].dom), ...seen[i] })),
};
`

export default async function contextsStartUpProbes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'contexts-start-up-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  const names = `const FAMILIES = [['Hiragino Sans, Japanese name', '"ヒラギノ角ゴシック", monospace'], ['Avenir Next Condensed Heavy, a legacy family name', '"Avenir Next Condensed Heavy", monospace'], ['Hiragino Sans, English name', '"Hiragino Sans", monospace']];\nconst LATE_FONT = false;`
  const late = `const FAMILIES = [['a web font, a FontFace loaded and then added', '"Late Loaded", monospace']];\nconst LATE_FONT = true;`
  return [{
    id: 'contexts-start-up-lib L1', spec: 'the library with one kept list beside the DOM in a browser that has just started, families named by names Firefox learns late', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\n${names}\n${OVER_TIME}` }],
  }, {
    id: 'contexts-start-up-lib L2', spec: 'the library with one kept list beside the DOM, a FontFace loaded and then added two seconds in', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\n${late}\n${OVER_TIME}` }],
  }]
}
