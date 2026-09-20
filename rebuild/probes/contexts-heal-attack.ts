// A second reading of probes/contexts-start-up.ts: what its rows didn't ask about kept Canvas contexts. Raw Canvas beside
// the DOM, no library. One probe a browser launch; the runner launches the pinned browser anew for every run.
//
// - H1: the family names pages really write, in a Firefox that has just started: which of them Firefox learns late. 22
//   names from common CSS font lists, each before `monospace`, one context kept from the start, read every 250 ms for
//   eight seconds beside a new context and a DOM span. A name whose new context changes and whose kept context doesn't
//   is a late name on this machine.
// - H2: contexts-start-up S1's four late names in a page whose font set has used a src: local() rule from the start.
//   The guess it tests: when the late names arrive the parent process rebuilds the font sets that used a local() rule
//   (gfxPlatformFontList::ForceGlobalReflow, RebuildLocalFonts, gfxPlatformFontList.cpp:2864-2942;
//   gfxUserFontSet::RebuildLocalRules, gfxUserFontSet.cpp:1087-1092), and a font group looks its families up again when
//   its font set was rebuilt (gfxFontGroup::UpdateUserFonts, gfxTextRun.cpp:3946-3965), so a kept context might follow
//   by itself there. It doesn't (2026-09-20, one run): the kept context stays on the fallback. A page's own process
//   only forgets its local() faces (nsPresContext::ForceReflowForFontInfoUpdate, nsPresContext.cpp:210-214), which moves
//   no rebuild generation.
// - H3: a family that draws at first through an installed font and later through a web font of the same name: a
//   FontFace named `Helvetica Neue`, loaded first and added two seconds in, with a span in the family.
// - H4: a loaded FontFace added to a font set that held a face and was emptied again (add, delete, then the late add).
//   WebKit's font cache leaves the font set out of its key whenever the set holds no face (CSSFontSelector.cpp:526-539),
//   not only before its first face.
// - H5: the late names with two more ways of touching a kept context at every reading: reset() and then the settings
//   again, and the canvas resized and then the settings again. Both bring a Gecko context back to its first state
//   (CanvasRenderingContext2D.h:124-128, SetDimensions, ClearTarget, SetInitialState, CanvasRenderingContext2D.cpp:1871),
//   and neither empties the context's own cache of font groups (:4456-4478, filled at :4606-4608), so by the source the
//   font assigned again finds the old font group.
//
// Per row and way: every change of the answer with the time of the reading that first showed it. A list of one entry
// never changed.
//
// Run under the browser lock, from the worktree:
//   python3 .artifacts/session/with-browser-lock.py contexts-heal-attack --browser=firefox -- bun rebuild/probes/runner.ts \
//     --browser=firefox --probes=rebuild/probes/contexts-heal-attack.ts --only="H1" --probe-timeout-ms=60000 --out=<dir>
import type { Probe } from './types.ts'

const NAMES = [
  'Helvetica Neue', 'Helvetica Neue Light', 'HelveticaNeue-Light', 'Helvetica Neue UltraLight', 'Arial Narrow', 'Arial Black',
  'Avenir Next Demi Bold', 'Avenir Heavy', 'Gill Sans Light', 'Futura Condensed ExtraBold',
  'Hiragino Kaku Gothic ProN', 'Hiragino Kaku Gothic Pro', 'ヒラギノ角ゴ ProN W3', 'ヒラギノ角ゴ Pro W3', 'ヒラギノ角ゴ ProN', 'ヒラギノ明朝 ProN',
  '游ゴシック', '游ゴシック体', 'YuGothic', 'Yu Gothic', '华文黑体', '黑体-简',
]

const OVER_TIME = String.raw`
const LATIN = 'Hamburgefonstiv 0123';
const fontOf = (row, size) => 'normal 400 ' + size + 'px ' + row[1];
const make = (row) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = fontOf(row, 32); return c; };
const LATE_MS = 5000;
if (LOCAL_RULE) {
  const style = document.createElement('style');
  style.textContent = '@font-face { font-family: "Local Alias"; src: local("Helvetica Neue"), local("Arial"); }';
  document.head.append(style);
  const user = document.createElement('span');
  user.style.cssText = 'font: 32px "Local Alias", monospace; position: absolute; left: 0; top: 60px';
  user.textContent = LATIN;
  document.body.append(user);
  user.getBoundingClientRect();
}
let early = null;
if (EARLY_FACE_THEN_DELETED) {
  early = new FontFace('Early Other', 'url(/fonts/amiri.ttf?early-other)');
  await early.load();
  document.fonts.add(early);
}
const t0 = performance.now();
const contexts = ROWS.map(row => WAYS.map(() => make(row)));
const spans = ROWS.map(row => {
  const span = document.createElement('span');
  span.lang = 'en';
  span.style.cssText = 'font: ' + fontOf(row, 32) + '; white-space: nowrap; position: absolute; left: 0; top: 0';
  span.textContent = LATIN;
  document.body.append(span);
  return span;
});
const seen = ROWS.map(() => { const out = { fresh: [], dom: [] }; for (let w = 0; w < WAYS.length; w++) out[WAYS[w]] = []; return out; });
const note = (list, width, ms) => { if (list.length === 0 || list[list.length - 1].width !== width) list.push({ width, fromMs: ms }); };
const touch = (r, way, c, ms) => {
  switch (way) {
    case 'kept': return true;
    case 'sameString': c.font = fontOf(ROWS[r], 32); return true;
    case 'otherAndBack': c.font = fontOf(ROWS[r], 31); c.font = fontOf(ROWS[r], 32); return true;
    case 'firstMeasuredLate': return ms >= LATE_MS;
    case 'reset': c.reset(); c.lang = 'en'; c.font = fontOf(ROWS[r], 32); return true;
    case 'resize': c.canvas.width = 2; c.canvas.width = 1; c.lang = 'en'; c.font = fontOf(ROWS[r], 32); return true;
  }
};
const readAll = () => {
  const ms = Math.round(performance.now() - t0);
  for (let r = 0; r < ROWS.length; r++) {
    for (let w = 0; w < WAYS.length; w++) if (touch(r, WAYS[w], contexts[r][w], ms)) note(seen[r][WAYS[w]], contexts[r][w].measureText(LATIN).width, ms);
    note(seen[r].fresh, make(ROWS[r]).measureText(LATIN).width, ms);
    note(seen[r].dom, spans[r].getBoundingClientRect().width, ms);
  }
};
let deleted = false;
let added = false;
let addedAtMs = null;
const addLate = async () => {
  const face = new FontFace(LATE_FACE, 'url(/fonts/amiri.ttf?late-attack)');
  await face.load();
  document.fonts.add(face);
  addedAtMs = Math.round(performance.now() - t0);
};
readAll();
for (let i = 0; i < 32; i++) {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (early !== null && !deleted && performance.now() - t0 >= 1000) { deleted = true; document.fonts.delete(early); }
  if (LATE_FACE !== null && !added && performance.now() - t0 >= 2000) { added = true; addLate(); }
  readAll();
}
for (let i = 0; i < spans.length; i++) spans[i].remove();
const last = list => list[list.length - 1].width;
const rows = ROWS.map((row, r) => ({
  what: row[0], font: fontOf(row, 32),
  differsFromFreshAtTheEnd: WAYS.filter(way => seen[r][way].length > 0 && last(seen[r][way]) !== last(seen[r].fresh)),
  freshChanged: seen[r].fresh.length > 1, freshDiffersFromDomAtTheEnd: Math.abs(last(seen[r].fresh) - last(seen[r].dom)) > 0.05, ...seen[r],
}));
return { userAgent: navigator.userAgent, msSinceNavigationStart: Math.round(t0), localRule: LOCAL_RULE, earlyFaceThenDeleted: EARLY_FACE_THEN_DELETED, lateFace: LATE_FACE, addedAtMs, facesInTheSetAtTheEnd: document.fonts.size, rows };
`

function overTime(rows: [string, string][], ways: string[], localRule: boolean, earlyFaceThenDeleted: boolean, lateFace: string | null): string {
  return `const ROWS = ${JSON.stringify(rows)};\nconst WAYS = ${JSON.stringify(ways)};\nconst LOCAL_RULE = ${localRule};\nconst EARLY_FACE_THEN_DELETED = ${earlyFaceThenDeleted};\nconst LATE_FACE = ${JSON.stringify(lateFace)};\n${OVER_TIME}`
}

const LATE_NAMES: [string, string][] = [
  ['Hiragino Sans, Japanese name', '"ヒラギノ角ゴシック", monospace'], ['PingFang SC, Chinese name', '"苹方-简", monospace'],
  ['Apple SD Gothic Neo, Korean name', '"Apple SD 산돌고딕 Neo", monospace'], ['Avenir Next Condensed Heavy, a legacy family name', '"Avenir Next Condensed Heavy", monospace'],
  ['Hiragino Sans, English name', '"Hiragino Sans", monospace'],
]
const WAYS = ['kept', 'sameString', 'otherAndBack', 'firstMeasuredLate']

const probes: Probe[] = [{
  id: 'contexts-heal-attack H1', spec: 'family names pages write, kept Canvas contexts beside new ones and the DOM, in a browser that has just started', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime(NAMES.map((name): [string, string] => [name, `"${name}", monospace`]), ['kept'], false, false, null) }],
}, {
  id: 'contexts-heal-attack H2', spec: 'late family names in a page whose font set has used a src: local() rule from the start', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime(LATE_NAMES, WAYS, true, false, null) }],
}, {
  id: 'contexts-heal-attack H3', spec: 'a family that draws through an installed font first and through a loaded FontFace of the same name two seconds in', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime([['Helvetica Neue, installed, then a FontFace of that name', '"Helvetica Neue", monospace']], WAYS, false, false, 'Helvetica Neue') }],
}, {
  id: 'contexts-heal-attack H4', spec: 'a loaded FontFace added two seconds in to a font set that held a face and was emptied again', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime([['a web font, loaded and then added to a set emptied before', '"Late Attack", monospace']], WAYS, false, true, 'Late Attack') }],
}, {
  id: 'contexts-heal-attack H5', spec: 'late family names, a kept context reset or resized and given its settings again at every reading', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime(LATE_NAMES, ['kept', 'reset', 'resize'], false, false, null) }],
}]

export default probes
