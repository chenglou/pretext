// A second look at "Firefox could measure on a detached <canvas> element on the page and on an OffscreenCanvas in workers,
// chosen by a feature test" (ff-element-workers.ts and ff-element-documents.ts hold the first look). Pinned Firefox 156.0.
// These probes try what the first set didn't. Measurement only; the probe page reads the DOM freely, the library wouldn't.
// Words: a pres shell is Gecko's presentation shell, which a document has only while it is displayed; au is an app unit,
// 1/60 CSS px; the device size of a font is its CSS size times devicePixelRatio; "the test" is assigning
// ctx.letterSpacing = '1vw' and reading it back ('1vw' with a pres shell, '0px' without: ParseSpacing,
// CanvasRenderingContext2D.cpp:3091-3110, with the units that need a style context in
// servo/components/style/values/specified/length.rs:609-640).
// - X1 kept-contexts: the first set assigned ctx.font again before every measurement. The library sets a context's font once
//   and keeps the context in the prepared paragraph, and fillLine measures later. So: contexts whose font is set once, at
//   each stage of an iframe going display: none and back, then removed, measured at every later stage without touching the
//   font; the test on contexts kept from each stage; and one system-ui context measuring a paragraph's words while shown,
//   while hidden and when shown again. From source a kept context drops its font group when the pres context it was made
//   with is no longer the document's (GetCurrentFontStyle, :5483-5523) and builds it again on whichever path holds then.
// - X2 hidden-tab-and-popup: window.open puts a new tab in front, so the probe's own tab is hidden. The new tab's document
//   right after window.open (before its first paint), the hidden tab, and the tab when it is visible again: the DOM's au, a
//   detached element canvas's au at the device size, and the test.
// - X3 worker-kinds: the library's bundled module over a second sample of lab cases (more than half of them new) on the
//   page, in a dedicated module worker and in a shared module worker, all on OffscreenCanvas, as the cases are and with
//   every family list ending in serif; what each scope has; and an OffscreenCanvas transferred from a canvas element, on the
//   page and in the dedicated worker, beside a plain OffscreenCanvas (GetPresShell has no element and no docshell then,
//   :2086-2094). A service worker needs a script served over http, which the runner doesn't serve: not probed.
// - X4 stylesheet-pending: the first set's flush probe left an element restyle pending. Here a rule is inserted into a
//   20,000-rule sheet before each operation, so the stylist update is pending and the document's font set is marked dirty
//   (ApplicableStylesChanged, Document.cpp:8073-8080). Both canvas kinds call FlushUserFontSet when a font is set, and a
//   context with a pres shell calls it at every measureText (:4343, :4446-4448, :5161-5165); a dirty set reads the @font-face
//   rules, which updates the stylist first (Document.cpp:18877-18890, ServoStyleSet.cpp:1335-1340). The time of each
//   operation, then of the style flush that follows it.
// - X5 more-documents: an SVG document and an XHTML document in shown iframes (createElement('canvas') in an SVG document
//   gives an element without getContext; the first set always used createElementNS), a quirks-mode document, and a document
//   that runs the test from a script in its own head, while it is parsed, shown and display: none.
// - X7 early-asking: X5's last rows again, three rounds: a document that asks from a script in its head, at the end of its
//   body, at DOMContentLoaded and at load, as a srcdoc iframe and as a blob-URL iframe, with the parent flushed right after
//   the insertion or not, and as a new tab (a top-level document). The device size is taken at DPR 2.
// - X6 test-cost: the first set timed the test on one kept context of one font. Here it runs over 200 kept contexts of
//   distinct fonts in turn, the same in a display: none iframe, the same with a restyle of 30,000 spans pending (and the
//   flush that follows, which shows the loop left it pending), and on a new canvas per ask with and without the test. A
//   timing run: take the machine with --exclusive and --only=X6.
//
// Results of 2026-09-19 (.artifacts/probes/ff-element-20260919/workers-check, DPR 2 unless said; the first set's own probes
// run again in a fresh Firefox gave its numbers exactly: D1 to D5, and W1 to W5 with the same 14 cases and 909 of 41,487 calls):
// - X1: a kept context follows its document without its font being touched. At all 6 stages every kept context measures
//   what a context made at that stage measures, and the test on a kept context agrees with its widths. One kept system-ui
//   context gives `workers` 3430 au while the iframe is shown, 3252.5 au while it is display: none and 3430 au when it is
//   shown again (the OffscreenCanvas at the CSS size has 3038): a prepared paragraph filled while its document has no pres
//   shell gets widths that are neither the page's nor the OffscreenCanvas's, and nothing says so unless the test is asked
//   again before the fill measures.
// - X2: window.open works in the runner's Firefox. The new tab's document right after window.open has a pres shell (the
//   test says 1vw and the element canvas gives the DOM's au on 5 of 5); so does the probe's tab while it is hidden
//   (visibilityState hidden, twice, 1.5 s apart) and when it is visible again. The test agrees with the widths in 6 of 6 rows.
// - X3, 217 cases (124 of them not in the first set's sample), 5,776 lines a sweep: the page against a dedicated worker 211
//   of 217 equal, a shared worker equal to the dedicated one on 217 of 217, and with every list ending in serif all three
//   equal on 217 of 217. Gap counts are the same in the three scopes (optical-size 216, in-word-prefix 16, font-fallback 1).
//   A shared worker has OffscreenCanvas, FontFace and self.fonts, and detectEnvironment() throws there as in a dedicated one.
//   A transferred OffscreenCanvas measures like a plain one on 5 of 5, detached, connected and in the worker, and the test
//   says 0px on it: there is no third canvas kind.
// - X4, 3 rounds after a warm-up round, 1 ms timer, 20,000 rules: with nothing done the flush that follows takes 3 ms. Setting
//   a font on a new context takes 2 ms on an OffscreenCanvas and on a detached element canvas alike and leaves 0 to 1 ms:
//   both kinds pay the pending stylist update when a font is set, today too. measureText alone on a kept OffscreenCanvas takes
//   0 ms and leaves 2 ms; on a kept element canvas it takes 2 ms and leaves 1 ms: only the element kind pays at a plain
//   measureText. The test alone on a kept element context takes 0 ms and leaves 2 ms.
// - X5: in an SVG document createElement('canvas') gives an Element in no namespace without getContext; createElementNS
//   with the XHTML namespace gives a canvas that measures like the DOM, and the test says 1vw. XHTML and plain text
//   documents: createElement works, like the DOM, 1vw. (A srcdoc document is never in quirks mode, so that row shows nothing.)
// - X5 and X7, a document asking from its own scripts: in a display: none iframe 0px at every moment, with the no-pres-shell
//   widths. In a shown iframe the head script got 1vw and the page's 8917 au in 13 of 14 rows over three runs, and once 0px
//   with 8282 au (its pres shell came later; at load it said 1vw). A new tab's head script: 1vw, 8917 au. The test agreed
//   with the widths every time, so it is right, but what an early prepare gets in an iframe can depend on timing.
// - D1 again under --firefox-prefs: layout.css.devPixelsPerPx 2.2 (devicePixelRatio 60/27, as a 110% zoom on this screen)
//   and 1.25: the top element canvas gives the DOM's au on 5 of 5 and the test is right in 21 of 21 rows. With
//   privacy.resistFingerprinting and devPixelsPerPx 1.0, devicePixelRatio says 2 where the page lays out at 1: the element
//   canvas at the "device size" is wrong on 5 of 5 (system-ui 8282 au for the DOM's 8917) while the test says 1vw, and the
//   OffscreenCanvas is right on 4 of 5. With privacy.fingerprintingProtection instead, devicePixelRatio says 1 and all is as
//   at DPR 1.
// - X6, twice under the exclusive lock, but at load averages of 81 and 49 (work outside the lock kept the machine busy; the
//   first set's quiet numbers are about 2.2 times lower), 5 rounds each, medians of the two runs: the test on one kept
//   context 0.75 and 0.75 us; over 200 kept contexts of distinct fonts 0.80 and 0.80 us; without a pres shell 0.20 and
//   0.25 us; with a restyle of 30,000 spans pending 0.75 and 0.80 us, and the restyle stays pending (12 to 18 ms after); a
//   new canvas, context and font 9 and 8.5 us, with the test 10 and 10 us.
//
// Run: python3 .artifacts/session/with-browser-lock.py ff-el-attacks -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/ff-element-attacks.ts --probe-timeout-ms=240000 --stall-ms=300000 --out=<out>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from './types.ts'

type SampledCase = { id: string; browsers?: string[]; fontFixtures?: string[] }

const ARTIFACTS = join(import.meta.dir, '../../.artifacts')
const SETS: Array<[string, number]> = [
  ['lab/cases/smoke.ndjson', 12], ['lab/cases/runs.ndjson', 45], ['lab/cases/policy.ndjson', 30], ['lab/cases/ws.ndjson', 25],
  ['lab/cases/rich-prewrap.ndjson', 25], ['lab/cases/suite-sample-5000.ndjson', 60], ['sysui/cases/system-ui.ndjson', 20],
]
const SWEEP = [48, 97.5, 160, 233, 320, 511.25, 800]

// Every k-th case Firefox runs, starting half a step in: 124 of the 217 are cases the first set didn't sample.
function sample(): SampledCase[] {
  const out: SampledCase[] = []
  for (let s = 0; s < SETS.length; s++) {
    const [file, want] = SETS[s]!
    const rows = readFileSync(join(ARTIFACTS, file), 'utf8').split('\n')
    const cases: SampledCase[] = []
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] === '') continue
      const c = JSON.parse(rows[i]!) as SampledCase
      if (c.browsers !== undefined && !c.browsers.includes('firefox')) continue
      cases.push(c)
    }
    const step = Math.max(2, Math.floor(cases.length / want))
    for (let i = Math.floor(step / 2), taken = 0; i < cases.length && taken < want; i += step, taken++) out.push(cases[i]!)
  }
  return out
}

const HELPERS = String.raw`
const XHTML = 'http://www.w3.org/1999/xhtml';
const cps = (...list) => String.fromCodePoint(...list);
const dprTop = window.devicePixelRatio;
const apdOf = dpr => Math.max(1, Math.floor(60 / dpr + 0.5));
const apdTop = apdOf(dprTop);
// weight, CSS size, family, text: the first set's samples, so the numbers compare.
const SAMPLES = [[400, 16, 'system-ui', 'workers of the world'], [400, 15, '"Helvetica Neue"', 'modern'], [700, 14, '"Helvetica Neue"', cps(0x20e3, 0x2764)], [400, 16, 'Arial', 'Hello, world'], [400, 13, 'Georgia', 'AVATAR To Wa']];
const fontOf = (weight, size, family) => weight + ' ' + size + 'px ' + family;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const round3 = v => +v.toFixed(3);
const elementCanvas = doc => doc.createElementNS(XHTML, 'canvas');
// One context per sample with its font set once, at the device size for an element canvas and the CSS size for an OffscreenCanvas.
const keptSet = (make, scale) => { const list = []; for (let i = 0; i < SAMPLES.length; i++) { const c = make(); c.lang = 'en'; c.font = fontOf(SAMPLES[i][0], SAMPLES[i][1] * scale, SAMPLES[i][2]); list.push(c); } return list; };
const measureSet = (list, unit) => { const out = []; for (let i = 0; i < list.length; i++) out.push(round3(list[i].measureText(SAMPLES[i][3]).width * unit)); return out; };
const elementAuIn = (doc, apd) => measureSet(keptSet(() => elementCanvas(doc).getContext('2d'), 60 / apd), apd);
const offscreenAu = () => measureSet(keptSet(() => new OffscreenCanvas(1, 1).getContext('2d'), 1), 60);
const domAuIn = (doc, parent) => {
  const out = [];
  for (let i = 0; i < SAMPLES.length; i++) {
    const span = doc.createElement('span');
    span.lang = 'en';
    span.style.cssText = 'position: absolute; left: 0; top: 0; white-space: pre; font: ' + fontOf(SAMPLES[i][0], SAMPLES[i][1], SAMPLES[i][2]);
    const node = doc.createTextNode(SAMPLES[i][3]); span.append(node); parent.append(span);
    const range = doc.createRange(); range.selectNodeContents(node);
    out.push(round3(range.getBoundingClientRect().width * 60));
    span.remove();
  }
  return out;
};
// The test, leaving the context's letter spacing as it was (0px).
const theTest = c => { c.letterSpacing = '1vw'; const kept = c.letterSpacing; c.letterSpacing = '0px'; return kept; };
const freshTest = doc => { const c = elementCanvas(doc).getContext('2d'); c.lang = 'en'; c.font = '16px Arial'; return theTest(c); };
const flush = () => host.getBoundingClientRect().width + document.documentElement.offsetWidth;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
`

const X1 = String.raw`
const dom = domAuIn(document, host);
const offscreen = offscreenAu();
const frame = document.createElement('iframe');
host.append(frame); flush();
const doc = frame.contentDocument;
const words = 'workers of the world unite and read the second look'.split(' ');
const wordContext = elementCanvas(doc).getContext('2d');
wordContext.lang = 'en'; wordContext.font = fontOf(400, 16 * 60 / apdTop, 'system-ui');
const wordsAu = () => words.map(w => round3(wordContext.measureText(w).width * apdTop));
const sets = [];
const stages = [];
const stage = name => {
  const made = { madeAt: name, contexts: keptSet(() => elementCanvas(doc).getContext('2d'), 60 / apdTop), testContext: (() => { const c = elementCanvas(doc).getContext('2d'); c.lang = 'en'; c.font = '16px Arial'; return c; })() };
  sets.push(made);
  const row = { stage: name, freshTest: freshTest(doc), kept: [], words: wordsAu() };
  for (let i = 0; i < sets.length; i++) {
    const au = measureSet(sets[i].contexts, apdTop);
    row.kept.push({ madeAt: sets[i].madeAt, au, likeDom: same(au, dom), test: theTest(sets[i].testContext) });
  }
  stages.push(row);
};
stage('shown');
frame.style.display = 'none';
stage('display: none set, parent not flushed');
flush();
stage('display: none, parent flushed');
frame.style.display = '';
stage('shown again, parent not flushed');
flush();
stage('shown again, parent flushed');
frame.remove(); flush();
stage('iframe removed');
// Every kept context against the fresh answer of its stage: a kept context that still said what it said when it was made
// would show here.
let keptFollowTheDocument = true, testAgreesWithWidths = true;
for (let s = 0; s < stages.length; s++) for (let k = 0; k < stages[s].kept.length; k++) {
  const last = stages[s].kept[stages[s].kept.length - 1];
  if (!same(stages[s].kept[k].au, last.au)) keptFollowTheDocument = false;
  if ((stages[s].kept[k].test === '1vw') !== stages[s].kept[k].likeDom) testAgreesWithWidths = false;
}
return {
  devicePixelRatio: dprTop, dom, offscreen, words, stages,
  checks: [
    { name: 'at every stage a context whose font was set at an earlier stage measures what a context made now measures', measured: keptFollowTheDocument, expected: true, ok: keptFollowTheDocument },
    { name: 'on every kept context the test says 1vw exactly when the context gives the DOM\'s app units', measured: testAgreesWithWidths, expected: true, ok: testAgreesWithWidths },
    { name: 'one kept system-ui context gives the same word widths while shown and while display: none (a prepared paragraph filled later)', measured: stages[2].words, expected: stages[0].words, ok: same(stages[2].words, stages[0].words) },
  ],
  pre: [],
};
`

const X2 = String.raw`
const waitForVisibility = (want, ms) => new Promise(resolve => {
  if (document.visibilityState === want) { resolve(true); return; }
  const timer = setTimeout(() => { document.removeEventListener('visibilitychange', listener); resolve(false); }, ms);
  const listener = () => { if (document.visibilityState === want) { clearTimeout(timer); document.removeEventListener('visibilitychange', listener); resolve(true); } };
  document.addEventListener('visibilitychange', listener);
});
const snapshot = (doc, win) => {
  const out = { visibility: doc.visibilityState, devicePixelRatio: win.devicePixelRatio, readyState: doc.readyState, hasBody: doc.body !== null };
  try {
    const apd = apdOf(win.devicePixelRatio);
    out.elementAu = elementAuIn(doc, apd);
    out.test = freshTest(doc);
    out.domAu = doc.body !== null ? domAuIn(doc, doc.body) : null;
    out.elementLikeDom = out.domAu !== null && same(out.elementAu, out.domAu);
  } catch (error) { out.error = String(error); }
  return out;
};
const offscreen = offscreenAu();
const before = snapshot(document, window);
const popup = window.open('about:blank', '_blank');
if (popup === null) return { opened: false, before, pre: [] };
const popupAtOnce = snapshot(popup.document, popup);
const hiddenArrived = await waitForVisibility('hidden', 5000);
const whileHidden = snapshot(document, window);
const keptWhileHidden = elementCanvas(document).getContext('2d');
keptWhileHidden.lang = 'en'; keptWhileHidden.font = fontOf(400, 16 * 60 / apdTop, 'system-ui');
const keptHiddenAu = round3(keptWhileHidden.measureText('workers of the world').width * apdTop);
await pause(1500);
const whileHiddenLater = snapshot(document, window);
let popupLater = null;
try { popupLater = snapshot(popup.document, popup); } catch (error) { popupLater = { error: String(error) }; }
popup.close();
const visibleArrived = await waitForVisibility('visible', 5000);
const after = snapshot(document, window);
const keptVisibleAu = round3(keptWhileHidden.measureText('workers of the world').width * apdTop);
const rows = { before, popupAtOnce, whileHidden, whileHiddenLater, popupLater, after };
const checks = [];
for (const name of Object.keys(rows)) {
  const r = rows[name];
  if (r === null || r.error !== undefined || r.domAu === null || r.domAu === undefined) continue;
  checks.push({ name: name + ': the test says 1vw exactly when the element canvas gives the DOM\'s app units', measured: [r.test, r.elementLikeDom], expected: 'both or neither', ok: (r.test === '1vw') === r.elementLikeDom });
}
return { opened: true, hiddenArrived, visibleArrived, offscreen, rows, keptHiddenAu, keptVisibleAu, checks, pre: [] };
`

// The module every scope runs: the page imports it for sweep, a dedicated worker answers on its own port and a shared worker
// on each connection's. It imports the library's bundled module from a blob URL the page made. sweep lays a lab case out
// plain (prepare, fillLine) and inspected (inspectLine, linePieces, paragraphGaps) at the case's width and the sweep's, with
// no font facts, as ff-element-workers.ts does, and returns two FNV-1a hashes of all of it.
const HARNESS = String.raw`
const decl = font => ({ ...font, facts: lib.UNKNOWN_FONT_FACTS });
const tree = nodes => nodes.map(node => node.kind === 'span' ? { ...node, font: decl(node.font), children: tree(node.children) } : node);
// As rebuild/lab/predictor-core.ts layoutInput, with every font fact unknown.
const paragraphOf = c => {
  const p = c.paragraph;
  const style = (font, letterSpacing, wordSpacing) => ({ font: decl(font), letterSpacing, wordSpacing, whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap, lineBreak: p.lineBreak, tabSize: p.tabSize });
  if (c.inline !== undefined) return { ...style(p.font, p.letterSpacing, p.wordSpacing), content: tree(c.inline.content), lang: p.lang, direction: p.direction, lineHeight: p.lineHeight, textIndent: c.inline.textIndent, textAlign: c.inline.textAlign };
  const content = [];
  for (let r = 0; r < p.runs.length; r++) {
    const run = p.runs[r];
    if (run.node === 'text') content.push({ kind: 'text', text: run.text });
    else content.push({ ...style(run.font, run.letterSpacing, run.wordSpacing), kind: 'span', lang: run.lang, inlineStart: lib.NO_BOX_EDGE, inlineEnd: lib.NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text: run.text }] });
  }
  return { ...style(p.font, p.letterSpacing, p.wordSpacing), content, lang: p.lang, direction: p.direction, lineHeight: p.lineHeight, textIndent: 0, textAlign: 'start' };
};
const fnv = (text, seed) => { let h = seed >>> 0; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const layOut = (c, env, sweepWidths) => {
  const widths = [c.paragraph.width].concat(sweepWidths);
  const gapNames = new Set();
  let lineCount = 0;
  try {
    const paragraph = paragraphOf(c);
    const parts = [];
    for (let mode = 0; mode < 2; mode++) {
      const prepared = lib.prepare(paragraph, env, mode === 1);
      for (let w = 0; w < widths.length; w++) {
        for (let start = lib.firstLine(prepared); start !== null;) {
          const filled = lib.fillLine(prepared, start, { width: widths[w], left: 0, right: 0 });
          if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats');
          parts.push(filled.start + ',' + filled.end + ',' + filled.hasLineBox);
          if (mode === 1) {
            const inspection = lib.inspectLine(prepared, filled.line);
            parts.push(JSON.stringify(inspection), JSON.stringify(lib.linePieces(prepared, filled.line)));
            for (let g = 0; g < inspection.gaps.length; g++) gapNames.add(inspection.gaps[g].gap);
            lineCount++;
          }
          start = filled.next;
        }
      }
      if (mode === 1) {
        const gaps = lib.paragraphGaps(prepared);
        parts.push(JSON.stringify(gaps));
        for (let g = 0; g < gaps.length; g++) gapNames.add(gaps[g].gap);
      }
    }
    const all = parts.join('\n');
    return { id: c.id, digest: fnv(all, 0x811c9dc5).toString(16) + '-' + fnv(all, 0x9747b28c).toString(16) + '-' + all.length, error: null, lineCount, gaps: [...gapNames].sort() };
  } catch (error) {
    return { id: c.id, digest: null, error: error instanceof Error ? error.message : String(error), lineCount, gaps: [...gapNames].sort() };
  }
};
export const sweep = (cases, env, sweepWidths) => { const t0 = performance.now(); const outcomes = []; for (let i = 0; i < cases.length; i++) outcomes.push(layOut(cases[i], env, sweepWidths)); return { outcomes, ms: performance.now() - t0 }; };
const attempt = run => { try { return run(); } catch (error) { return 'threw ' + error.name + ': ' + error.message; } };
export const facts = () => {
  const types = {};
  const names = ['document', 'window', 'devicePixelRatio', 'OffscreenCanvas', 'FontFace', 'fonts', 'matchMedia', 'HTMLCanvasElement', 'DedicatedWorkerGlobalScope', 'SharedWorkerGlobalScope'];
  for (let i = 0; i < names.length; i++) types[names[i]] = typeof globalThis[names[i]];
  return {
    types, scope: Object.prototype.toString.call(globalThis),
    context2d: attempt(() => Object.prototype.toString.call(new OffscreenCanvas(1, 1).getContext('2d'))),
    theTestOnOffscreen: attempt(() => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = '16px Arial'; c.letterSpacing = '1vw'; return c.letterSpacing; }),
    detectEngine: attempt(() => JSON.stringify(lib.detectEngine())),
    detectEnvironment: attempt(() => lib.detectEnvironment({ engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: null }).kind),
  };
};
const answer = async request => {
  switch (request.type) {
    case 'facts': return facts();
    case 'fonts': {
      if (typeof self.fonts === 'undefined') return 'no self.fonts';
      for (let i = 0; i < request.fixtures.length; i++) {
        const fixture = request.fixtures[i];
        const face = new FontFace(fixture.family, await (await fetch(fixture.url)).arrayBuffer(), { weight: fixture.weight });
        await face.load();
        self.fonts.add(face);
      }
      return request.fixtures.length;
    }
    case 'sweep': return sweep(request.cases, request.env, request.sweep);
    case 'transferred': {
      const c = request.canvas.getContext('2d');
      const out = [];
      for (let i = 0; i < request.samples.length; i++) { c.lang = 'en'; c.font = request.samples[i][0]; out.push(c.measureText(request.samples[i][1]).width); }
      c.letterSpacing = '1vw';
      return { widths: out, theTest: c.letterSpacing };
    }
  }
};
const serve = port => { port.onmessage = event => answer(event.data).then(value => port.postMessage({ id: event.data.id, value }), error => port.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) })); };
if (typeof SharedWorkerGlobalScope !== 'undefined' && self instanceof SharedWorkerGlobalScope) self.onconnect = event => serve(event.ports[0]);
else if (typeof DedicatedWorkerGlobalScope !== 'undefined' && self instanceof DedicatedWorkerGlobalScope) serve(self);
`

const X3 = String.raw`
const blobUrl = text => URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
const harnessUrl = blobUrl('import * as lib from ' + JSON.stringify(blobUrl(LIBRARY)) + ';\n' + HARNESS);
const page = await import(harnessUrl);
const info = JSON.parse(document.getElementById('probe-doc').textContent);
const fixtures = info.fixtures.map(f => ({ ...f, url: new URL(f.url, location.href).href }));
const client = (port, onFailure) => {
  let next = 1, failure = null;
  const pending = new Map();
  port.onmessage = e => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (e.data.error !== undefined) p.reject(new Error(e.data.error)); else p.resolve(e.data.value); };
  onFailure(text => { failure = text; for (const p of pending.values()) p.reject(new Error(text)); pending.clear(); });
  return (message, transfer) => new Promise((resolve, reject) => { if (failure !== null) { reject(new Error(failure)); return; } const id = next++; pending.set(id, { resolve, reject }); port.postMessage({ ...message, id }, transfer || []); });
};
const dedicated = new Worker(harnessUrl, { type: 'module' });
const askDedicated = client(dedicated, fail => { dedicated.onerror = e => fail('dedicated worker error: ' + e.message); });
const shared = new SharedWorker(harnessUrl, { type: 'module', name: 'ff-element-attacks' });
const askShared = client(shared.port, fail => { shared.onerror = e => fail('shared worker error: ' + (e.message || 'no message')); });
`

// X3's body after the scopes are up. Kept apart so the text above stays readable.
const X3_BODY = String.raw`
const pageFacts = page.facts();
const detected = await (async () => (await import(blobUrl(LIBRARY))).detectEnvironment({ engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: null }))();
if (detected.kind !== 'supported') return { error: 'detectEnvironment on the page', detected };
const environment = detected.env;
const guarded = async (name, run) => { try { return await Promise.race([run(), new Promise((resolve, reject) => setTimeout(() => reject(new Error(name + ': no answer in 40 s')), 40000))]); } catch (error) { return { failed: String(error) }; } };
const dedicatedFacts = await guarded('dedicated facts', () => askDedicated({ type: 'facts' }));
const sharedFacts = await guarded('shared facts', () => askShared({ type: 'facts' }));
const dedicatedFonts = await guarded('dedicated fonts', () => askDedicated({ type: 'fonts', fixtures }));
const sharedUp = sharedFacts.failed === undefined;
const sharedFonts = sharedUp ? await guarded('shared fonts', () => askShared({ type: 'fonts', fixtures })) : { failed: 'the shared worker never answered' };
const GENERIC = /(^|,)\s*(serif|sans-serif|monospace|cursive|fantasy|math|fangsong|emoji|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)\s*(,|$)/i;
const endingInSerif = () => {
  const cases = JSON.parse(JSON.stringify(CASES));
  const fix = font => { if (!GENERIC.test(font.family.replace(/"[^"]*"|'[^']*'/g, 'x'))) font.family += ', serif'; };
  const walk = nodes => { for (let i = 0; i < nodes.length; i++) if (nodes[i].kind === 'span') { fix(nodes[i].font); walk(nodes[i].children); } };
  for (let i = 0; i < cases.length; i++) { const c = cases[i]; fix(c.paragraph.font); for (let r = 0; r < c.paragraph.runs.length; r++) fix(c.paragraph.runs[r].font); if (c.inline !== undefined) walk(c.inline.content); }
  return cases;
};
const compare = (a, b) => {
  if (a.failed !== undefined || b.failed !== undefined) return { failed: a.failed || b.failed };
  const out = { cases: a.outcomes.length, lines: 0, equal: 0, errorsBoth: 0, differentIds: [] };
  for (let i = 0; i < a.outcomes.length; i++) {
    const x = a.outcomes[i], y = b.outcomes[i];
    out.lines += x.lineCount;
    if (x.error !== null && x.error === y.error) { out.errorsBoth++; out.equal++; continue; }
    if (x.digest !== null && x.digest === y.digest) { out.equal++; continue; }
    if (out.differentIds.length < 40) out.differentIds.push(x.id);
  }
  out.different = out.cases - out.equal;
  return out;
};
const gapCounts = run => { if (run.failed !== undefined) return null; const counts = {}; for (let i = 0; i < run.outcomes.length; i++) for (let g = 0; g < run.outcomes[i].gaps.length; g++) counts[run.outcomes[i].gaps[g]] = (counts[run.outcomes[i].gaps[g]] || 0) + 1; return counts; };
const result = { cases: CASES.length, dprTop, pageFacts, dedicatedFacts, sharedFacts, dedicatedFonts, sharedFonts, sets: {} };
const sets = [['as the cases are', CASES], ['every family list ending in serif', endingInSerif()]];
for (let s = 0; s < sets.length; s++) {
  const cases = sets[s][1];
  const onPage = page.sweep(cases, environment, SWEEP);
  const inDedicated = await guarded('dedicated sweep', () => askDedicated({ type: 'sweep', cases, env: environment, sweep: SWEEP }));
  const inShared = sharedUp ? await guarded('shared sweep', () => askShared({ type: 'sweep', cases, env: environment, sweep: SWEEP })) : { failed: 'the shared worker never answered' };
  result.sets[sets[s][0]] = {
    ms: { page: round3(onPage.ms), dedicated: inDedicated.ms === undefined ? null : round3(inDedicated.ms), shared: inShared.ms === undefined ? null : round3(inShared.ms) },
    pageAgainstDedicated: compare(onPage, inDedicated), pageAgainstShared: compare(onPage, inShared), dedicatedAgainstShared: compare(inDedicated, inShared),
    gaps: { page: gapCounts(onPage), dedicated: gapCounts(inDedicated), shared: gapCounts(inShared) },
  };
}
// An OffscreenCanvas transferred from a canvas element: detached, connected, and one sent to the dedicated worker.
const samplesAt = scale => SAMPLES.map(s => [fontOf(s[0], s[1] * scale, s[2]), s[3]]);
const transferredHere = connected => {
  const element = document.createElement('canvas');
  if (connected) host.append(element);
  const c = element.transferControlToOffscreen().getContext('2d');
  const at = (scale, unit) => samplesAt(scale).map(([font, text]) => { c.lang = 'en'; c.font = font; return round3(c.measureText(text).width * unit); });
  const out = { cssSizeAu: at(1, 60), deviceSizeAu: at(60 / apdTop, apdTop) };
  c.letterSpacing = '1vw'; out.theTest = c.letterSpacing;
  if (connected) element.remove();
  return out;
};
const dom = domAuIn(document, host), offscreen = offscreenAu();
const transferred = { detached: transferredHere(false), connected: transferredHere(true) };
const sent = document.createElement('canvas').transferControlToOffscreen();
const inWorker = await guarded('transferred in the worker', () => askDedicated({ type: 'transferred', canvas: sent, samples: samplesAt(1) }, [sent]));
transferred.inDedicatedWorker = inWorker.failed !== undefined ? inWorker : { cssSizeAu: inWorker.widths.map(w => round3(w * 60)), theTest: inWorker.theTest };
dedicated.terminate();
result.transferred = { dom, offscreen, ...transferred };
const serif = result.sets['every family list ending in serif'];
result.checks = [
  { name: 'every family list ending in serif: a dedicated worker gives the page\'s digests', measured: serif.pageAgainstDedicated.different, expected: 0, ok: serif.pageAgainstDedicated.different === 0 },
  { name: 'every family list ending in serif: a shared worker gives the page\'s digests', measured: serif.pageAgainstShared.different, expected: 0, ok: serif.pageAgainstShared.different === 0 },
  { name: 'as the cases are: a shared worker gives a dedicated worker\'s digests', measured: result.sets['as the cases are'].dedicatedAgainstShared.different, expected: 0, ok: result.sets['as the cases are'].dedicatedAgainstShared.different === 0 },
  { name: 'a transferred OffscreenCanvas measures like a plain OffscreenCanvas, detached, connected and in a worker', measured: [transferred.detached.cssSizeAu, transferred.connected.cssSizeAu, transferred.inDedicatedWorker.cssSizeAu], expected: offscreen, ok: same(transferred.detached.cssSizeAu, offscreen) && same(transferred.connected.cssSizeAu, offscreen) && transferred.inDedicatedWorker.cssSizeAu !== undefined && same(transferred.inDedicatedWorker.cssSizeAu, offscreen) },
];
result.pre = [];
return result;
`

const X4 = String.raw`
const RULES = 20000, SPANS = 2000;
const style = document.createElement('style');
const css = [];
for (let i = 0; i < RULES; i++) css.push('.ffx-box.r' + i + ' span.k' + (i % 50) + ' > b { color: rgb(' + (i % 255) + ', 2, 3) }');
style.textContent = css.join('\n');
document.head.append(style);
const box = document.createElement('div');
box.className = 'ffx-box';
box.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px; font: 12px Arial';
const parts = [];
for (let i = 0; i < SPANS; i++) parts.push('<span class="k' + (i % 50) + '">w' + (i % 97) + '</span> ');
box.innerHTML = parts.join('');
host.append(box);
const last = box.lastElementChild;
flush();
getComputedStyle(last).color;
const keptOffscreen = new OffscreenCanvas(1, 1).getContext('2d'); keptOffscreen.lang = 'en'; keptOffscreen.font = '16px Arial'; keptOffscreen.measureText('warm');
const keptElement = elementCanvas(document).getContext('2d'); keptElement.lang = 'en'; keptElement.font = '32px Arial'; keptElement.measureText('warm');
const keptTest = elementCanvas(document).getContext('2d'); keptTest.lang = 'en'; keptTest.font = '16px Arial';
let size = 20;
const operations = {
  'nothing': () => 0,
  'OffscreenCanvas made now: context, font, measureText': () => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = '16px Arial'; return c.measureText('Hello, world').width; },
  'OffscreenCanvas kept: measureText only': () => keptOffscreen.measureText('Hello, world').width,
  'OffscreenCanvas kept: another font, measureText': () => { keptOffscreen.font = (size++) + 'px Arial'; return keptOffscreen.measureText('Hello, world').width; },
  'detached element canvas made now: context, font, measureText': () => { const c = elementCanvas(document).getContext('2d'); c.lang = 'en'; c.font = '32px Arial'; return c.measureText('Hello, world').width; },
  'detached element canvas kept: measureText only': () => keptElement.measureText('Hello, world').width,
  'detached element canvas kept: the test only': () => theTest(keptTest),
  'getComputedStyle(span).color (the control)': () => getComputedStyle(last).color,
};
const names = Object.keys(operations);
const rows = [];
let serial = 0;
for (let round = 0; round < 4; round++) for (let n = 0; n < names.length; n++) {
  style.sheet.insertRule('.ffx-box.extra' + (serial++) + ' span > i { color: rgb(4, 5, 6) }', style.sheet.cssRules.length);
  const t0 = performance.now();
  const value = operations[names[n]]();
  const t1 = performance.now();
  const color = getComputedStyle(last).color;
  const t2 = performance.now();
  rows.push({ round, operation: names[n], value: typeof value === 'number' ? round3(value) : value, operationMs: round3(t1 - t0), flushAfterMs: round3(t2 - t1), color });
}
box.remove(); style.remove();
const median = list => { const s = list.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const summary = names.map(name => { const mine = rows.filter(r => r.operation === name && r.round > 0); return { operation: name, operationMsMedian: median(mine.map(r => r.operationMs)), flushAfterMsMedian: median(mine.map(r => r.flushAfterMs)), operationMs: mine.map(r => r.operationMs), flushAfterMs: mine.map(r => r.flushAfterMs) }; });
return { rules: RULES, spans: SPANS, note: 'round 0 is left out of the medians', summary, rows, pre: [] };
`

const X5 = String.raw`
const SVG = 'http://www.w3.org/2000/svg';
const loaded = (frame, ms) => new Promise(resolve => { const timer = setTimeout(() => resolve(false), ms); frame.addEventListener('load', () => { clearTimeout(timer); resolve(true); }, { once: true }); });
const dom = domAuIn(document, host), offscreen = offscreenAu();
const rows = [];
const report = (kind, doc, win) => {
  const row = { kind, contentType: doc.contentType, compatMode: doc.compatMode, devicePixelRatio: win.devicePixelRatio };
  try {
    const plain = doc.createElement('canvas');
    row.createElementGives = Object.prototype.toString.call(plain) + ', namespace ' + plain.namespaceURI + ', getContext ' + typeof plain.getContext;
    row.elementAu = elementAuIn(doc, apdOf(win.devicePixelRatio));
    row.likeDom = same(row.elementAu, dom);
    row.test = freshTest(doc);
  } catch (error) { row.error = String(error); }
  rows.push(row);
};
const framed = async (kind, make) => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width: 400px; height: 100px';
  const wait = loaded(frame, 8000);
  make(frame);
  host.append(frame);
  const arrived = await wait;
  flush();
  if (!arrived) rows.push({ kind, error: 'no load event in 8 s' }); else report(kind, frame.contentDocument, frame.contentWindow);
  frame.remove();
};
const blobOf = (text, type) => URL.createObjectURL(new Blob([text], { type }));
await framed('SVG document in a shown iframe', frame => { frame.src = blobOf('<svg xmlns="' + SVG + '" width="300" height="80"><text x="0" y="20">svg</text></svg>', 'image/svg+xml'); });
await framed('XHTML document in a shown iframe', frame => { frame.src = blobOf('<html xmlns="' + XHTML + '" lang="en"><head><title>x</title></head><body><p>xhtml</p></body></html>', 'application/xhtml+xml'); });
await framed('quirks-mode HTML document in a shown iframe', frame => { frame.srcdoc = '<html lang="en"><body><p>quirks</p></body></html>'; });
await framed('plain text document in a shown iframe', frame => { frame.src = blobOf('plain text', 'text/plain'); });
// A document that asks the test itself, from a script in its head while it is parsed (before its first paint), and on load.
const selfAsking = async (kind, frameStyle) => {
  const frame = document.createElement('iframe');
  frame.style.cssText = frameStyle;
  const open = '<scr' + 'ipt>', close = '</scr' + 'ipt>';
  const ask = 'const ask = () => { const c = document.createElement("canvas").getContext("2d"); c.lang = "en"; c.font = "32px system-ui"; const w = c.measureText("workers of the world").width; c.letterSpacing = "1vw"; return { test: c.letterSpacing, width: w, devicePixelRatio: window.devicePixelRatio, readyState: document.readyState, visibility: document.visibilityState }; };';
  frame.srcdoc = '<!doctype html><html lang="en"><head>' + open + ask + ' window.ask = ask; window.asked = { whileParsing: ask() }; addEventListener("load", () => { window.asked.onLoad = ask(); });' + close + '</head><body><p>self</p></body></html>';
  const wait = loaded(frame, 8000);
  host.append(frame);
  const arrived = await wait;
  const asked = arrived ? frame.contentWindow.asked : null;
  flush();
  rows.push({ kind, arrived, asked, afterParentFlush: arrived ? frame.contentWindow.ask() : null });
  frame.remove();
};
await selfAsking('a shown iframe asking from its own head script', 'width: 400px; height: 100px');
await selfAsking('a display: none iframe asking from its own head script', 'display: none');
return { devicePixelRatio: dprTop, dom, offscreen, systemUiPageAuAtDeviceSize: dom[0], rows, pre: [] };
`

const X6 = String.raw`
const FAMILIES = ['Arial', 'Georgia', '"Helvetica Neue"', 'system-ui', 'Verdana', '"Times New Roman"', '"Courier New"', 'Menlo', '"Trebuchet MS"', 'Palatino'];
const contextsIn = doc => { const list = []; for (let f = 0; f < FAMILIES.length; f++) for (let size = 10; size < 30; size++) { const c = elementCanvas(doc).getContext('2d'); c.lang = 'en'; c.font = size + 'px ' + FAMILIES[f]; c.measureText('warm'); list.push(c); } return list; };
const time = (n, run) => { const t0 = performance.now(); let sink = 0; for (let i = 0; i < n; i++) sink += run(i); const ms = performance.now() - t0; return { n, ms: round3(ms), usEach: +(ms * 1000 / n).toFixed(3), sink }; };
const ask = c => { c.letterSpacing = '1vw'; const n = c.letterSpacing.length; c.letterSpacing = '0px'; return n; };
const hiddenFrame = document.createElement('iframe');
hiddenFrame.style.display = 'none';
host.append(hiddenFrame); flush();
const style = document.createElement('style');
style.textContent = '.ffx-on span { color: rgb(1, 2, 3) }';
document.head.append(style);
const box = document.createElement('div');
box.style.cssText = 'position: absolute; left: 0; top: 0; width: 600px; font: 12px Arial';
const parts = [];
for (let i = 0; i < 30000; i++) parts.push('<span>w' + (i % 97) + '</span> ');
box.innerHTML = parts.join('');
host.append(box);
const last = box.lastElementChild;
flush(); getComputedStyle(last).color;
const one = contextsIn(document)[0], many = contextsIn(document), manyHidden = contextsIn(hiddenFrame.contentDocument);
const rows = [];
for (let round = 0; round < 5; round++) {
  rows.push({ round, what: 'the test on one kept context', ...time(20000, () => ask(one)) });
  rows.push({ round, what: 'the test over 200 kept contexts of distinct fonts, in turn', ...time(20000, i => ask(many[i % many.length])) });
  rows.push({ round, what: 'the same in a display: none iframe (no pres shell)', ...time(20000, i => ask(manyHidden[i % manyHidden.length])) });
  box.classList.toggle('ffx-on');
  const pending = time(20000, i => ask(many[i % many.length]));
  const t0 = performance.now(); getComputedStyle(last).color; const flushAfterMs = round3(performance.now() - t0);
  rows.push({ round, what: 'the same over 200 contexts with a restyle of 30,000 spans pending', ...pending, flushAfterMs });
  rows.push({ round, what: 'a new detached element canvas, context, font, then the test (what a prepare without kept state pays)', ...time(2000, i => { const c = elementCanvas(document).getContext('2d'); c.lang = 'en'; c.font = (10 + i % 20) + 'px ' + FAMILIES[i % FAMILIES.length]; return ask(c); }) });
  rows.push({ round, what: 'a new detached element canvas, context, font, no test', ...time(2000, i => { const c = elementCanvas(document).getContext('2d'); c.lang = 'en'; c.font = (10 + i % 20) + 'px ' + FAMILIES[i % FAMILIES.length]; return c.font.length; }) });
}
box.remove(); style.remove(); hiddenFrame.remove();
return { devicePixelRatio: dprTop, rows, pre: [] };
`

const X7 = String.raw`
const open = '<scr' + 'ipt>', close = '</scr' + 'ipt>';
const ask = 'const ask = () => { const c = document.createElement("canvas").getContext("2d"); c.lang = "en"; c.font = "32px system-ui"; const w = c.measureText("workers of the world").width; c.letterSpacing = "1vw"; return { test: c.letterSpacing, deviceSizeAu: Math.round(w * 30 * 1000) / 1000, devicePixelRatio: window.devicePixelRatio, readyState: document.readyState, visibility: document.visibilityState, msSinceStart: Math.round(performance.now()) }; };';
const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>early</title>' + open + ask + ' window.ask = ask; window.asked = { whileParsingHead: ask() }; document.addEventListener("DOMContentLoaded", () => { window.asked.domContentLoaded = ask(); }); addEventListener("load", () => { window.asked.onLoad = ask(); });' + close + '</head><body><p style="font: 16px system-ui">early</p>' + open + 'window.asked.whileParsingBodyEnd = ask();' + close + '</body></html>';
const blobUrl = () => URL.createObjectURL(new Blob([page], { type: 'text/html' }));
const loaded = (target, ms) => new Promise(resolve => { const timer = setTimeout(() => resolve(false), ms); target.addEventListener('load', () => { clearTimeout(timer); resolve(true); }, { once: true }); });
const dom = domAuIn(document, host);
const rows = [];
const framed = async (kind, source, flushAtOnce) => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width: 400px; height: 100px';
  if (source === 'srcdoc') frame.srcdoc = page; else frame.src = blobUrl();
  const wait = loaded(frame, 8000);
  host.append(frame);
  if (flushAtOnce) flush();
  const arrived = await wait;
  rows.push({ kind, arrived, asked: arrived ? JSON.parse(JSON.stringify(frame.contentWindow.asked)) : null, later: arrived ? (flush(), JSON.parse(JSON.stringify(frame.contentWindow.ask()))) : null });
  frame.remove();
};
for (let round = 0; round < 3; round++) {
  await framed('round ' + round + ': a shown srcdoc iframe, the parent not flushed after the insertion', 'srcdoc', false);
  await framed('round ' + round + ': a shown srcdoc iframe, the parent flushed right after the insertion', 'srcdoc', true);
  await framed('round ' + round + ': a shown blob-URL iframe, the parent not flushed after the insertion', 'blob', false);
  await framed('round ' + round + ': a shown blob-URL iframe, the parent flushed right after the insertion', 'blob', true);
}
// A top-level document: a new tab on the same page text.
const popup = window.open(blobUrl(), '_blank');
if (popup === null) rows.push({ kind: 'a new tab (a top-level document)', error: 'window.open gave null' });
else {
  let tries = 0;
  while (tries < 40 && !(popup.asked !== undefined && popup.asked.onLoad !== undefined)) { await pause(250); tries++; }
  let asked = null, later = null;
  try { asked = popup.asked === undefined ? null : JSON.parse(JSON.stringify(popup.asked)); later = popup.ask === undefined ? null : popup.ask(); } catch (error) { asked = { error: String(error) }; }
  rows.push({ kind: 'a new tab (a top-level document)', tries, asked, later });
  popup.close();
}
const pageAu = dom[0];
const early = [];
for (let i = 0; i < rows.length; i++) if (rows[i].asked !== null && rows[i].asked !== undefined && rows[i].asked.whileParsingHead !== undefined) early.push({ kind: rows[i].kind, head: rows[i].asked.whileParsingHead.test, headAu: rows[i].asked.whileParsingHead.deviceSizeAu, bodyEnd: rows[i].asked.whileParsingBodyEnd === undefined ? null : rows[i].asked.whileParsingBodyEnd.test, domContentLoaded: rows[i].asked.domContentLoaded === undefined ? null : rows[i].asked.domContentLoaded.test, onLoad: rows[i].asked.onLoad === undefined ? null : rows[i].asked.onLoad.test });
let agrees = true;
for (let i = 0; i < early.length; i++) if ((early[i].head === '1vw') !== (early[i].headAu === pageAu)) agrees = false;
return {
  devicePixelRatio: dprTop, pageAu, early, rows,
  checks: [{ name: 'in every head script the test says 1vw exactly when the element canvas at the device size gives the page\'s app units for system-ui', measured: agrees, expected: true, ok: agrees }],
  pre: [],
};
`

export default async function probes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/index.ts')], format: 'esm', target: 'browser' })
  if (!built.success) throw new Error(`the library didn't bundle: ${built.logs.map(log => log.message).join('\n')}`)
  const library = await built.outputs[0]!.text()
  const cases = sample()
  const fixtureFamilies: string[] = []
  for (let i = 0; i < cases.length; i++) {
    const families = cases[i]!.fontFixtures ?? []
    for (let f = 0; f < families.length; f++) if (!fixtureFamilies.includes(families[f]!)) fixtureFamilies.push(families[f]!)
  }
  const x3Head = `const LIBRARY = ${JSON.stringify(library)};\nconst HARNESS = ${JSON.stringify(HARNESS)};\nconst CASES = ${JSON.stringify(cases)};\nconst SWEEP = ${JSON.stringify(SWEEP)};\n`
  return [
    { id: 'ff-element-attacks/X1-kept-contexts', spec: 'condition 2 (b), second look: contexts whose font is set once, across a pres shell that goes and comes back', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'env' }, { kind: 'script', source: HELPERS + X1 }] },
    { id: 'ff-element-attacks/X5-more-documents', spec: 'condition 2 (b), second look: SVG, XHTML, quirks and plain text documents, and a document asking from its own head script', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + X5 }] },
    { id: 'ff-element-attacks/X4-stylesheet-pending', spec: 'condition 2 (b), second look: which measuring operations pay a pending stylist update', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + X4 }] },
    { id: 'ff-element-attacks/X3-worker-kinds', spec: 'condition 2 (a), second look: the page, a dedicated and a shared module worker on a second sample, and a transferred OffscreenCanvas', pageLang: 'en', html: '<div></div>', fontFixtures: fixtureFamilies, observe: [{ kind: 'script', source: HELPERS + x3Head + X3 + X3_BODY }] },
    { id: 'ff-element-attacks/X6-test-cost', spec: 'condition 2 (b), second look: what the test costs over many kept contexts of distinct fonts, without a pres shell, and with a restyle pending (a timing run)', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + X6 }] },
    { id: 'ff-element-attacks/X7-early-asking', spec: 'condition 2 (b), second look: a document asking the test from its own scripts while it is parsed: srcdoc and blob-URL iframes, the parent flushed or not, and a new tab', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: HELPERS + X7 }] },
    { id: 'ff-element-attacks/X2-hidden-tab-and-popup', spec: 'condition 2 (b), second look: the test and the element canvas in a hidden tab and in a new tab before its first paint', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'env' }, { kind: 'script', source: HELPERS + X2 }] },
  ]
}
