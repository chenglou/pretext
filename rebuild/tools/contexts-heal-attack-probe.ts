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
// - K3: K2's word at one width, with two paragraphs prepared at the start: one filled at once, whose fill makes its second
//   and third context before the names arrive, and one first filled three seconds in, whose fill makes them after. Where
//   the two break the word differently, the second measures with two fonts: its first context on the fallback, the
//   contexts its fill made on the family.
//
// What they showed (2026-09-20, pinned Firefox, two runs each of K1 and K3, one of K2; runs under
// .artifacts/probes/contexts-heal/attack):
// - K1: the kept paragraph stays at six lines for all eight seconds, at a width that is new at every reading. The DOM and a
//   paragraph prepared now have three from 1,360 and 701 ms on. So Gecko's one-prepare list keeps the late names' damage
//   to the paragraphs prepared before they arrived, and doesn't mend those.
// - K2: the same, six lines at the end where the DOM has five. Its first fill, 9 ms in, had made all three contexts.
// - K3: the paragraph first filled after the names arrived breaks the word at 1 9 17 25 33 41 49 53: eight lines, the
//   first of one character. The one filled at once gives 8 16 24 32 40 48 53, the fallback's answer, and a paragraph
//   prepared now 8 19 32 43 51 53 with the DOM's six lines (9 22 34 46 53 and five for the legacy name). Its contexts go
//   from one to three at that fill. Under the family's English name all three agree.
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

const FIRST_FILL_LATE = String.raw`
const lib = globalThis.contextsHealAttack;
const FAMILIES = [['Hiragino Sans, Japanese name', '"ヒラギノ角ゴシック", monospace'], ['Avenir Next Condensed Heavy, a legacy family name', '"Avenir Next Condensed Heavy", monospace'], ['Hiragino Sans, English name', '"Hiragino Sans", monospace']];
const TEXT = 'Hamburgefonstivfiflffiofficeaffinefluffiest0123456789';
const WIDTH = 171;
const FIRST_FILL_MS = 3000;
const t0 = performance.now();
const boxes = FAMILIES.map(row => {
  const box = document.createElement('div');
  box.lang = 'en';
  box.style.cssText = 'font: normal 400 32px/40px ' + row[1] + '; width: ' + WIDTH + 'px; white-space: normal; overflow-wrap: anywhere; position: absolute; left: 0; top: 0';
  box.textContent = TEXT;
  document.body.append(box);
  return box;
});
const filledAtOnce = FAMILIES.map(row => lib.prepared(TEXT, row[1], 32, 'en', 'anywhere', []));
const filledLate = FAMILIES.map(row => lib.prepared(TEXT, row[1], 32, 'en', 'anywhere', []));
const seen = FAMILIES.map(() => ({ dom: [], filledAtOnce: [], filledLate: [], preparedNow: [], contextsFilledAtOnceHolds: [], contextsFilledLateHolds: [] }));
const note = (list, value, ms) => { if (list.length === 0 || list[list.length - 1].value !== value) list.push({ value, fromMs: ms }); };
const readAll = () => {
  const ms = Math.round(performance.now() - t0);
  for (let i = 0; i < FAMILIES.length; i++) {
    note(seen[i].dom, String(Math.round(boxes[i].getBoundingClientRect().height / 40)) + ' lines', ms);
    note(seen[i].filledAtOnce, lib.lineEnds(filledAtOnce[i], WIDTH), ms);
    note(seen[i].contextsFilledAtOnceHolds, lib.contextsHeld(filledAtOnce[i]), ms);
    if (ms >= FIRST_FILL_MS) note(seen[i].filledLate, lib.lineEnds(filledLate[i], WIDTH), ms);
    note(seen[i].contextsFilledLateHolds, lib.contextsHeld(filledLate[i]), ms);
    note(seen[i].preparedNow, lib.lineEnds(lib.prepared(TEXT, FAMILIES[i][1], 32, 'en', 'anywhere', []), WIDTH), ms);
  }
};
readAll();
for (let k = 1; k <= 24; k++) {
  await new Promise(resolve => setTimeout(resolve, 250));
  readAll();
}
for (let i = 0; i < boxes.length; i++) boxes[i].remove();
const last = list => list[list.length - 1].value;
return {
  userAgent: navigator.userAgent, msSinceNavigationStart: Math.round(t0), text: TEXT, width: WIDTH, firstFillMs: FIRST_FILL_MS,
  rows: FAMILIES.map((row, i) => ({ what: row[0], family: row[1], filledLateEqualsFilledAtOnce: last(seen[i].filledLate) === last(seen[i].filledAtOnce), filledLateEqualsPreparedNow: last(seen[i].filledLate) === last(seen[i].preparedNow), ...seen[i] })),
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
  }, {
    id: 'contexts-heal-attack-lib K3', spec: 'a paragraph prepared at the start and first filled three seconds in, beside one filled at once, one prepared now and the DOM', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `${bundle}\n${FIRST_FILL_LATE}` }],
  }]
}
