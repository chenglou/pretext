// A second reading of tools/contexts-start-up-probe.ts: what a PREPARED paragraph kept across Firefox's start-up does, now
// that Gecko's contexts are one prepare's (src/index.ts prepare). A prepared paragraph holds its contexts by reference and
// a Gecko fill at a new width asks them again, so a paragraph prepared before the late family names arrive is a kept list
// of its own. Read every 250 ms for eight seconds, in a browser that has just started:
//
// - K1: three words and three numbers at 32px, six lines in the monospace fallback and three in the named family at 371
//   to 379 px. Per family: the DOM's line count at a width that is new at every reading, the lines of the paragraph
//   prepared at the start and kept, filled at that width, and the lines of a paragraph prepared now.
// - K2: one long word with overflow-wrap: anywhere, whose breaks inside the word make the fill ask a second context
//   (engines/gecko/advance.ts ligatureAcross, measure.ts noLigaturesContext). The kept paragraph's count of contexts
//   says when a fill made one: a context made after the names arrived finds the family where the paragraph's first
//   context stays on the fallback, so one paragraph then measures with two fonts.
//
// One probe a browser launch:
//   python3 .artifacts/session/with-browser-lock.py contexts-heal-attack-lib --browser=firefox -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/contexts-heal-attack-probe.ts --only="K1" --out=<dir>
import { join } from 'node:path'
import type { Probe } from '../probes/types.ts'

const OVER_TIME = String.raw`
const lib = globalThis.contextsHealAttack;
const FAMILIES = [['Hiragino Sans, Japanese name', '"ヒラギノ角ゴシック", monospace'], ['Avenir Next Condensed Heavy, a legacy family name', '"Avenir Next Condensed Heavy", monospace'], ['Hiragino Sans, English name', '"Hiragino Sans", monospace']];
const t0 = performance.now();
const boxes = FAMILIES.map(row => {
  const box = document.createElement('div');
  box.lang = 'en';
  box.style.cssText = 'font: normal 400 32px/40px ' + row[1] + '; width: ' + FIRST_WIDTH + 'px; white-space: normal; overflow-wrap: ' + OVERFLOW_WRAP + '; position: absolute; left: 0; top: 0';
  box.textContent = TEXT;
  document.body.append(box);
  return box;
});
const kept = FAMILIES.map(row => lib.prepared(TEXT, row[1], 32, 'en', OVERFLOW_WRAP, []));
const contextsAtPrepare = kept.map(p => lib.contextsHeld(p));
const seen = FAMILIES.map(() => ({ dom: [], keptParagraph: [], preparedNow: [], contextsTheKeptParagraphHolds: [] }));
const note = (list, value, ms, width) => { if (list.length === 0 || list[list.length - 1].value !== value) list.push({ value, fromMs: ms, atWidth: width }); };
const readAll = (k) => {
  const ms = Math.round(performance.now() - t0);
  const width = FIRST_WIDTH + k * WIDTH_STEP;
  for (let i = 0; i < FAMILIES.length; i++) {
    boxes[i].style.width = width + 'px';
    note(seen[i].dom, Math.round(boxes[i].getBoundingClientRect().height / 40), ms, width);
    note(seen[i].keptParagraph, lib.linesOf(kept[i], width), ms, width);
    note(seen[i].contextsTheKeptParagraphHolds, lib.contextsHeld(kept[i]), ms, width);
    note(seen[i].preparedNow, lib.linesOf(lib.prepared(TEXT, FAMILIES[i][1], 32, 'en', OVERFLOW_WRAP, []), width), ms, width);
  }
};
readAll(0);
for (let k = 1; k <= 32; k++) {
  await new Promise(resolve => setTimeout(resolve, 250));
  readAll(k);
}
for (let i = 0; i < boxes.length; i++) boxes[i].remove();
const last = list => list[list.length - 1].value;
return {
  userAgent: navigator.userAgent, msSinceNavigationStart: Math.round(t0), text: TEXT, overflowWrap: OVERFLOW_WRAP,
  rows: FAMILIES.map((row, i) => ({ what: row[0], family: row[1], contextsAtPrepare: contextsAtPrepare[i], keptParagraphEqualsPreparedNowAtTheEnd: last(seen[i].keptParagraph) === last(seen[i].preparedNow), preparedNowEqualsDomAtTheEnd: last(seen[i].preparedNow) === last(seen[i].dom), ...seen[i] })),
};
`

export default async function contextsHealAttackProbes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'contexts-heal-attack-probe-entry.ts')], target: 'browser', format: 'iife', minify: false })
  if (!built.success) throw new Error(`bundling failed: ${built.logs.join('\n')}`)
  const bundle = await built.outputs[0]!.text()
  const words = `const TEXT = 'Hamburgefonstiv 0123 Hamburgefonstiv 0123 Hamburgefonstiv 0123';\nconst OVERFLOW_WRAP = 'normal';\nconst FIRST_WIDTH = 371;\nconst WIDTH_STEP = 0.25;`
  const longWord = `const TEXT = 'Hamburgefonstivfiflffiofficeaffinefluffiest0123456789';\nconst OVERFLOW_WRAP = 'anywhere';\nconst FIRST_WIDTH = 171;\nconst WIDTH_STEP = 0.25;`
  return [{
    id: 'contexts-heal-attack-lib K1', spec: 'a paragraph prepared at the start of a browser that has just started and kept, filled at new widths beside a paragraph prepared now and the DOM', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\n${words}\n${OVER_TIME}` }],
  }, {
    id: 'contexts-heal-attack-lib K2', spec: 'K1 with one long word that breaks inside, whose fill makes a second context after the late names arrived', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\n${longWord}\n${OVER_TIME}` }],
  }]
}
