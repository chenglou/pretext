// Does the Gecko port run in a worker as it is, and does it give there what it gives on the page? Pinned Firefox 156.0.
// The page imports the library's bundled module (rebuild/src/index.ts, bundled by path when the probes load) and starts a
// module worker that imports the same text. Both lay the same lab cases out on OffscreenCanvas, the only canvas a worker has, with
// one Environment object the page detected and posted to the worker, and the page compares the digests (every line range,
// line box width, advance, fragment and gap, plain and inspected, at the case's width and a sweep of widths).
// - W1 identity: the page first, then a worker that has no fixture web font in its own font set, then the same worker after
//   the fixtures were added to `self.fonts`. Also what the worker's global scope has (scopeFacts), and whether a prepared
//   paragraph can be cloned for another scope (it holds its Canvas contexts).
// - W2 identity-worker-first: a fresh document, the worker (fixtures added) before the page.
// - W4 trace: every measureText call of the sweep recorded in both scopes (context font, lang, letter spacing, direction,
//   text), the calls both made whose widths differ, and those texts again one code point at a time.
// - W5 default-generic: a family list that names no generic family gets the language's default generic at its end
//   (gfxFontGroup::BuildFontList, gfxTextRun.cpp:1969-1977), which is the font.default pref on the main thread and always
//   sans-serif on a worker thread (GetDefaultGeneric, :1881-1891). Raw widths of characters the named family lacks, with
//   and without a generic at the end, in both scopes; then the sweep with every list ending in serif, and in sans-serif.
// - W3 empty-lang, in a document with <html lang="ja">: a context whose `lang` is the empty string takes the root
//   element's lang on the page and the OS locale in a worker (CanvasRenderingContext2D.cpp:5446-5468), which the port reaches
//   for content with lang="" when the regional-prefs locale isn't given (engines/gecko/prepare.ts canvasLang). Raw widths in
//   both scopes, then the library over the same text with the locale unknown and given.
//
// Results of 2026-09-19 (.artifacts/probes/ff-element-20260919/workers, 435 cases, 13,158 lines a sweep, DPR 2):
// - the worker has no document, window, devicePixelRatio or matchMedia; detectEngine() answers there and
//   detectEnvironment() throws "window is not defined", so the page's Environment is posted to it. A prepared paragraph
//   can't be posted: it holds its contexts (DataCloneError);
// - the page gives the same digests twice. The worker gives them on 421 of 435 cases, in both orders. The other 14 hold
//   characters the named families lack in a list without a generic family: 909 of the 41,487 measureText calls both scopes
//   made differ, all of that kind (`!` after "Geeza Pro" is 6.67px on the page, Times, and 5.55px in the worker,
//   Helvetica). With every list ending in serif, or in sans-serif, all 435 are equal;
// - without the fixtures in `self.fonts` 22 more cases differ, every one a case that names a fixture family;
// - a context with an empty lang measures differently in the two scopes for sans-serif, serif and monospace under
//   <html lang="ja">; with the regional-prefs locale given the library's digests are equal on 12 of 12 cases, with it
//   unknown on 4 of 12, where both scopes report `ui-language` on all 12.
//
// The cases are a fixed sample of the lab's development sets and the system-ui set, read from the shared artifacts folder
// when the probes load: every k-th case Firefox runs, so a run needs .artifacts/lab/cases and .artifacts/sysui/cases.
//
// Run: python3 .artifacts/session/with-browser-lock.py ff-el-workers -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/ff-element-workers.ts --probe-timeout-ms=240000 --stall-ms=300000 --out=<out>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from './types.ts'

type SampledCase = { id: string; browsers?: string[]; fontFixtures?: string[]; paragraph: { lang: string; width: number }; inline?: { lineSlots?: unknown[] } }

const ARTIFACTS = join(import.meta.dir, '../../.artifacts')
const SETS: Array<[string, number]> = [
  ['lab/cases/smoke.ndjson', 25], ['lab/cases/runs.ndjson', 90], ['lab/cases/policy.ndjson', 60], ['lab/cases/ws.ndjson', 50],
  ['lab/cases/rich-prewrap.ndjson', 50], ['lab/cases/suite-sample-5000.ndjson', 120], ['sysui/cases/system-ui.ndjson', 40],
]
const SWEEP = [48, 97.5, 160, 233, 320, 511.25, 800]

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
    const step = Math.max(1, Math.floor(cases.length / want))
    for (let i = 0, taken = 0; i < cases.length && taken < want; i += step, taken++) out.push(cases[i]!)
  }
  return out
}

// The module both scopes run: on the page it only exports makeHarness, in a worker it also answers requests. It is plain
// JavaScript over the library's bundled module, which each scope imports from a blob URL of its own, so nothing of
// rebuild/src is imported here (tests/independence.test.ts). makeHarness lays a lab case out in both modes: plain (prepare,
// fillLine: every line's source range and whether it has a line box) and inspected (also inspectLine's geometry and gaps,
// linePieces and paragraphGaps), at the case's own width and the sweep's, with no font facts supplied. A case's digest is
// two 32-bit FNV-1a hashes of the JSON of all of it; `lines` keeps each line's start, end and line box width in app units.
const HARNESS = String.raw`
export const makeHarness = lib => {
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
  const fillEvery = (prepared, width, inspected, parts, lines, gapNames) => {
    for (let start = lib.firstLine(prepared); start !== null;) {
      const filled = lib.fillLine(prepared, start, { width, left: 0, right: 0 });
      if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats');
      parts.push(filled.start + ',' + filled.end + ',' + filled.hasLineBox);
      let lineWidth = -1;
      if (inspected) {
        const inspection = lib.inspectLine(prepared, filled.line);
        parts.push(JSON.stringify(inspection), JSON.stringify(lib.linePieces(prepared, filled.line)));
        if (inspection.geometry !== null) lineWidth = inspection.geometry.width;
        for (let g = 0; g < inspection.gaps.length; g++) gapNames.add(inspection.gaps[g].gap);
      }
      if (lines !== null) lines.push(filled.start, filled.end, lineWidth);
      start = filled.next;
    }
  };
  const layOut = (c, env, sweep) => {
    const widths = [c.paragraph.width].concat(sweep);
    const lines = [];
    const gapNames = new Set();
    try {
      const paragraph = paragraphOf(c);
      const parts = [];
      const plain = lib.prepare(paragraph, env, false);
      for (let w = 0; w < widths.length; w++) fillEvery(plain, widths[w], false, parts, null, gapNames);
      const inspected = lib.prepare(paragraph, env, true);
      for (let w = 0; w < widths.length; w++) { const row = []; fillEvery(inspected, widths[w], true, parts, row, gapNames); lines.push(row); }
      const gaps = lib.paragraphGaps(inspected);
      parts.push(JSON.stringify(gaps));
      for (let g = 0; g < gaps.length; g++) gapNames.add(gaps[g].gap);
      const all = parts.join('\n');
      return { id: c.id, digest: fnv(all, 0x811c9dc5).toString(16) + '-' + fnv(all, 0x9747b28c).toString(16) + '-' + all.length, error: null, lines, gaps: [...gapNames].sort() };
    } catch (error) {
      return { id: c.id, digest: null, error: error instanceof Error ? error.message : String(error), lines, gaps: [...gapNames].sort() };
    }
  };
  const sweepCases = (cases, env, sweep) => {
    const t0 = performance.now();
    const outcomes = [];
    for (let i = 0; i < cases.length; i++) outcomes.push(layOut(cases[i], env, sweep));
    return { outcomes, ms: performance.now() - t0 };
  };
  // The same sweep with every measureText call of the scope's OffscreenCanvas contexts recorded: the context's font, lang,
  // letter spacing and direction and the text, with the first width it got.
  const traceCases = (cases, env, sweep) => {
    const proto = OffscreenCanvasRenderingContext2D.prototype;
    const measureText = proto.measureText;
    const widths = {};
    proto.measureText = function (text) {
      const metrics = measureText.call(this, text);
      const key = this.font + '|' + this.lang + '|' + this.letterSpacing + '|' + this.direction + '|' + text;
      if (!(key in widths)) widths[key] = metrics.width;
      return metrics;
    };
    try { return { outcomes: sweepCases(cases, env, sweep).outcomes, widths }; } finally { proto.measureText = measureText; }
  };
  // Can a prepared paragraph leave the scope that made it? structuredClone is what postMessage does.
  const cloneAttempt = (c, env) => {
    const prepared = lib.prepare(paragraphOf(c), env, false);
    const contexts = prepared.state.contexts.size;
    try { structuredClone(prepared); return { contexts, cloned: true, error: null }; } catch (error) { return { contexts, cloned: false, error: error.name + ': ' + error.message }; }
  };
  const attempt = run => { try { return { value: run() }; } catch (error) { return { threw: error.name + ': ' + error.message }; } };
  // What this global scope has of what the library and a page's setup read, and what the library's two detection
  // functions answer here.
  const scopeFacts = () => {
    const types = {};
    for (const name of ['document', 'window', 'devicePixelRatio', 'navigator', 'OffscreenCanvas', 'FontFace', 'fonts', 'matchMedia', 'requestAnimationFrame', 'HTMLCanvasElement', 'Intl']) types[name] = typeof globalThis[name];
    return {
      types, userAgent: attempt(() => navigator.userAgent), language: attempt(() => navigator.language), segmenter: typeof Intl.Segmenter,
      detectEngine: attempt(() => lib.detectEngine()),
      detectEnvironment: attempt(() => lib.detectEnvironment({ engine: 'gecko', build: '156.0', contentLanguage: null, regionalPrefsLocale: null })),
    };
  };
  return { sweepCases, traceCases, cloneAttempt, scopeFacts };
};

if (typeof document === 'undefined' && typeof postMessage === 'function') {
  let harness = null;
  const answer = async request => {
    switch (request.type) {
      case 'init': harness = makeHarness(await import(URL.createObjectURL(new Blob([request.library], { type: 'text/javascript' })))); return true;
      case 'facts': return harness.scopeFacts();
      case 'fonts':
        for (const fixture of request.fixtures) {
          const face = new FontFace(fixture.family, await (await fetch(fixture.url)).arrayBuffer(), { weight: fixture.weight });
          await face.load();
          self.fonts.add(face);
        }
        return request.fixtures.length;
      case 'sweep': return harness.sweepCases(request.cases, request.env, request.sweep);
      case 'trace': return harness.traceCases(request.cases, request.env, request.sweep);
      case 'widths': {
        const c = new OffscreenCanvas(1, 1).getContext('2d');
        c.lang = request.lang; c.font = request.font;
        return request.texts.map(text => c.measureText(text).width);
      }
    }
  };
  onmessage = event => answer(event.data).then(value => postMessage({ id: event.data.id, value }), error => postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) }));
}
`

const COMMON = String.raw`
const blobUrl = text => URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
const harnessUrl = blobUrl(HARNESS);
const lib = (await import(harnessUrl)).makeHarness(await import(blobUrl(LIBRARY)));
const info = JSON.parse(document.getElementById('probe-doc').textContent);
const fixtures = info.fixtures.map(f => ({ ...f, url: new URL(f.url, location.href).href }));
const startWorker = () => {
  const worker = new Worker(harnessUrl, { type: 'module' });
  let next = 1;
  const pending = new Map();
  let failure = null;
  worker.onmessage = e => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (e.data.error !== undefined) p.reject(new Error(e.data.error)); else p.resolve(e.data.value); };
  worker.onerror = e => { failure = 'worker error: ' + e.message; for (const p of pending.values()) p.reject(new Error(failure)); pending.clear(); };
  const send = message => new Promise((resolve, reject) => { if (failure !== null) { reject(new Error(failure)); return; } const id = next++; pending.set(id, { resolve, reject }); worker.postMessage({ ...message, id }); });
  // The worker imports the library from a blob URL of its own before anything else is asked of it.
  const ready = send({ type: 'init', library: LIBRARY });
  return { ask: message => ready.then(() => send(message)), stop: () => worker.terminate() };
};
const detected = lib.scopeFacts().detectEnvironment;
if (detected.value === undefined || detected.value.kind !== 'supported') return { error: 'detectEnvironment on the page', detected };
const env = detected.value.env;
const compare = (a, b) => {
  const out = { cases: a.length, equal: 0, lines: 0, errorsBoth: 0, different: [], differentByFixture: 0 };
  for (let i = 0; i < a.length; i++) {
    for (let w = 0; w < a[i].lines.length; w++) out.lines += a[i].lines[w].length / 3;
    if (a[i].error !== null && a[i].error === b[i].error) { out.errorsBoth++; out.equal++; continue; }
    if (a[i].digest !== null && a[i].digest === b[i].digest) { out.equal++; continue; }
    const usesFixture = FIXTURE_IDS.includes(a[i].id);
    if (usesFixture) out.differentByFixture++;
    let first = null;
    for (let w = 0; w < a[i].lines.length && first === null; w++) {
      const x = a[i].lines[w], y = b[i].lines[w] || [];
      for (let k = 0; k < Math.max(x.length, y.length); k++) if (x[k] !== y[k]) { first = { sweepIndex: w, line: Math.floor(k / 3), member: ['start', 'end', 'widthAu'][k % 3], first: x[k], second: y[k] }; break; }
    }
    if (out.different.length < 40) out.different.push({ id: a[i].id, usesFixture, errors: [a[i].error, b[i].error], gaps: [a[i].gaps, b[i].gaps], firstLineDifference: first });
  }
  out.differentCount = out.cases - out.equal;
  return out;
};
const gapCounts = outcomes => { const counts = {}; for (const o of outcomes) for (const g of o.gaps) counts[g] = (counts[g] || 0) + 1; return counts; };
`

const W1 = String.raw`
const pageRun = lib.sweepCases(CASES, env, SWEEP);
const pageAgain = lib.sweepCases(CASES, env, SWEEP);
const worker = startWorker();
const workerFacts = await worker.ask({ type: 'facts' });
const preparedLeavesItsScope = lib.cloneAttempt(CASES[0], env);
const bare = await worker.ask({ type: 'sweep', cases: CASES, env, sweep: SWEEP });
const added = await worker.ask({ type: 'fonts', fixtures });
const withFonts = await worker.ask({ type: 'sweep', cases: CASES, env, sweep: SWEEP });
worker.stop();
const pageTwice = compare(pageRun.outcomes, pageAgain.outcomes), bareCompared = compare(pageRun.outcomes, bare.outcomes), fontsCompared = compare(pageRun.outcomes, withFonts.outcomes);
return {
  env, dpr: window.devicePixelRatio, pageFacts: lib.scopeFacts(), workerFacts, preparedLeavesItsScope, fixturesAddedToWorker: added, fixtureCases: FIXTURE_IDS.length,
  ms: { page: pageRun.ms, pageAgain: pageAgain.ms, workerWithoutFixtures: bare.ms, workerWithFixtures: withFonts.ms },
  pageGaps: gapCounts(pageRun.outcomes), workerGaps: gapCounts(withFonts.outcomes),
  pageTwice, workerWithoutFixtures: bareCompared, workerWithFixtures: fontsCompared,
  checks: [
    { name: 'the page gives the same digests twice', measured: pageTwice.differentCount, expected: 0, ok: pageTwice.differentCount === 0 },
    { name: 'a worker with the fixtures in self.fonts gives the page\'s digests', measured: fontsCompared.differentCount, expected: 0, ok: fontsCompared.differentCount === 0 },
    { name: 'a worker without them differs only on cases that name a fixture font', measured: bareCompared.differentCount - bareCompared.differentByFixture, expected: 0, ok: bareCompared.differentCount === bareCompared.differentByFixture },
  ],
  pre: [],
};
`

const W2 = String.raw`
const worker = startWorker();
await worker.ask({ type: 'fonts', fixtures });
const first = await worker.ask({ type: 'sweep', cases: CASES, env, sweep: SWEEP });
worker.stop();
const pageRun = lib.sweepCases(CASES, env, SWEEP);
const compared = compare(first.outcomes, pageRun.outcomes);
return {
  ms: { worker: first.ms, page: pageRun.ms }, workerThenPage: compared,
  checks: [{ name: 'worker first, then the page: same digests', measured: compared.differentCount, expected: 0, ok: compared.differentCount === 0 }],
  pre: [],
};
`

const W3 = String.raw`
const texts = ['Hello, world 12345', 'Hello ' + String.fromCodePoint(0x4e16, 0x754c, 0x3001, 0x76f4, 0x9aa8) + ' ok', String.fromCodePoint(0x76f4, 0x3059, 0x9aa8, 0x3001, 0x300c, 0x30c6, 0x30b9, 0x30c8, 0x300d), String.fromCodePoint(0x201c) + 'quoted' + String.fromCodePoint(0x201d, 0x2026)];
const fonts = ['16px sans-serif', '16px serif', '16px monospace', '16px system-ui', '16px Arial'];
const langs = ['', 'ja', 'en', 'zh-Hans', 'zh-hans-us'];
const worker = startWorker();
const raw = [];
for (const font of fonts) for (const lang of langs) {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = lang; c.font = font;
  const page = texts.map(t => c.measureText(t).width);
  const inWorker = await worker.ask({ type: 'widths', font, lang, texts });
  raw.push({ font, lang, page, worker: inWorker, same: page.every((v, i) => v === inWorker[i]) });
}
const paragraphCase = (id, family, text) => ({ id, paragraph: { runs: [{ text, node: 'text', font: { family, size: 16, weight: 400, style: 'normal' }, letterSpacing: 0, wordSpacing: 0, lang: null }], font: { family, size: 16, weight: 400, style: 'normal' }, letterSpacing: 0, wordSpacing: 0, width: 140, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: '' } });
const cases = [];
for (const family of ['sans-serif', 'serif', 'Arial']) for (let t = 0; t < texts.length; t++) cases.push(paragraphCase(family + '/' + t, family, texts[t] + ' ' + texts[(t + 1) % texts.length] + ' ' + texts[t]));
const library = {};
for (const [name, locale] of [['localeUnknown', null], ['localeGiven', 'zh-hans-us']]) {
  const e = { ...env, regionalPrefsLocale: locale };
  const page = lib.sweepCases(cases, e, SWEEP);
  const inWorker = await worker.ask({ type: 'sweep', cases, env: e, sweep: SWEEP });
  library[name] = { compared: compare(page.outcomes, inWorker.outcomes), pageGaps: gapCounts(page.outcomes), workerGaps: gapCounts(inWorker.outcomes) };
}
worker.stop();
return {
  htmlLang: document.documentElement.lang, navigatorLanguage: navigator.language, raw, library,
  checks: [
    { name: 'an explicit ctx.lang measures the same in both scopes', measured: raw.filter(r => r.lang !== '' && !r.same).length, expected: 0, ok: raw.every(r => r.lang === '' || r.same) },
    { name: 'with the regional-prefs locale given, lang="" content gives the same digests in both scopes', measured: library.localeGiven.compared.differentCount, expected: 0, ok: library.localeGiven.compared.differentCount === 0 },
  ],
  pre: [],
};
`

const W4 = String.raw`
const worker = startWorker();
await worker.ask({ type: 'fonts', fixtures });
const page = lib.traceCases(CASES, env, SWEEP);
const inWorker = await worker.ask({ type: 'trace', cases: CASES, env, sweep: SWEEP });
worker.stop();
let asked = 0, askedByBoth = 0;
const different = [];
for (const key in page.widths) {
  asked++;
  if (!(key in inWorker.widths)) continue;
  askedByBoth++;
  if (page.widths[key] !== inWorker.widths[key]) different.push(key);
}
const rows = [];
const perFont = {};
for (const key of different) {
  const parts = key.split('|');
  const text = parts.slice(4).join('|');
  perFont[parts[0]] = (perFont[parts[0]] || 0) + 1;
  if (rows.length < 120) rows.push({ font: parts[0], lang: parts[1], letterSpacing: parts[2], direction: parts[3], text, codePoints: [...text].map(ch => ch.codePointAt(0).toString(16)).join(' '), page: page.widths[key], worker: inWorker.widths[key] });
}
// Each differing text again, one code point at a time, in both scopes: which characters carry the difference.
const single = {};
for (const row of rows.slice(0, 60)) {
  const chars = [...new Set([...row.text])];
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = row.lang; c.font = row.font;
  const onPage = chars.map(ch => c.measureText(ch).width);
  const w2 = startWorker();
  const there = await w2.ask({ type: 'widths', font: row.font, lang: row.lang, texts: chars });
  w2.stop();
  for (let i = 0; i < chars.length; i++) if (onPage[i] !== there[i]) single[row.font + '|' + row.lang + '|U+' + chars[i].codePointAt(0).toString(16)] = [onPage[i], there[i]];
}
return { asked, askedByBoth, differentCount: different.length, perFont, rows, single, compared: compare(page.outcomes, inWorker.outcomes), pre: [] };
`

const W5 = String.raw`
const cps = (...list) => String.fromCodePoint(...list);
const worker = startWorker();
await worker.ask({ type: 'fonts', fixtures });
const texts = ['!', cps(0xbb), cps(0x3000), cps(0x2009), 'Hello', cps(0x915, 0x943, 0x92a)];
const raw = [];
for (const family of ['"Geeza Pro"', 'BlinkMacSystemFont', 'Georgia', 'system-ui', '"No Such Family"']) for (const tail of ['', ', serif', ', sans-serif']) {
  const font = '20px ' + family + tail;
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = 'en'; c.font = font;
  raw.push({ font, page: texts.map(t => c.measureText(t).width), worker: await worker.ask({ type: 'widths', font, lang: 'en', texts }) });
}
const GENERIC = /(^|,)\s*(serif|sans-serif|monospace|cursive|fantasy|math|fangsong|emoji|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)\s*(,|$)/i;
const withGeneric = generic => {
  const cases = JSON.parse(JSON.stringify(CASES));
  const fix = font => { if (!GENERIC.test(font.family.replace(/"[^"]*"|'[^']*'/g, 'x'))) font.family += ', ' + generic; };
  const walk = nodes => { for (const node of nodes) if (node.kind === 'span') { fix(node.font); walk(node.children); } };
  for (const c of cases) { fix(c.paragraph.font); for (const run of c.paragraph.runs) fix(run.font); if (c.inline !== undefined) walk(c.inline.content); }
  return cases;
};
const sameLines = (a, b) => { let differ = 0; const ids = []; for (let i = 0; i < a.length; i++) if (JSON.stringify(a[i].lines) !== JSON.stringify(b[i].lines) || a[i].error !== b[i].error) { differ++; if (ids.length < 20) ids.push(a[i].id); } return { cases: a.length, differ, ids }; };
const plainPage = lib.sweepCases(CASES, env, SWEEP).outcomes;
const plainWorker = (await worker.ask({ type: 'sweep', cases: CASES, env, sweep: SWEEP })).outcomes;
const out = { raw, plain: compare(plainPage, plainWorker) };
for (const generic of ['serif', 'sans-serif']) {
  const cases = withGeneric(generic);
  const page = lib.sweepCases(cases, env, SWEEP).outcomes;
  const inWorker = (await worker.ask({ type: 'sweep', cases, env, sweep: SWEEP })).outcomes;
  out[generic] = { pageAgainstWorker: compare(page, inWorker), pageLinesAgainstPlainPage: sameLines(page, plainPage), workerLinesAgainstPlainWorker: sameLines(inWorker, plainWorker) };
}
worker.stop();
out.checks = [
  { name: 'every family list ending in serif: the worker gives the digests of the page', measured: out.serif.pageAgainstWorker.differentCount, expected: 0, ok: out.serif.pageAgainstWorker.differentCount === 0 },
  { name: 'every family list ending in sans-serif: the worker gives the digests of the page', measured: out['sans-serif'].pageAgainstWorker.differentCount, expected: 0, ok: out['sans-serif'].pageAgainstWorker.differentCount === 0 },
  { name: 'in a worker, ending the list in sans-serif changes no line', measured: out['sans-serif'].workerLinesAgainstPlainWorker.differ, expected: 0, ok: out['sans-serif'].workerLinesAgainstPlainWorker.differ === 0 },
];
out.pre = [];
return out;
`

export default async function probes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/index.ts')], format: 'esm', target: 'browser' })
  if (!built.success) throw new Error(`the library didn't bundle: ${built.logs.map(log => log.message).join('\n')}`)
  const library = await built.outputs[0]!.text()
  const cases = sample()
  const fixtureFamilies: string[] = []
  const fixtureIds: string[] = []
  for (let i = 0; i < cases.length; i++) {
    const families = cases[i]!.fontFixtures ?? []
    if (families.length > 0) fixtureIds.push(cases[i]!.id)
    for (let f = 0; f < families.length; f++) if (!fixtureFamilies.includes(families[f]!)) fixtureFamilies.push(families[f]!)
  }
  const head = (withCases: boolean) => `const LIBRARY = ${JSON.stringify(library)};\nconst HARNESS = ${JSON.stringify(HARNESS)};\nconst CASES = ${withCases ? JSON.stringify(cases) : '[]'};\nconst SWEEP = ${JSON.stringify(SWEEP)};\nconst FIXTURE_IDS = ${JSON.stringify(withCases ? fixtureIds : [])};\n${COMMON}`
  return [
    { id: 'ff-element-workers/W1-identity', spec: 'condition 2 (a): the Gecko port on the page and in a module worker, both on OffscreenCanvas', pageLang: 'en', html: '<div></div>', fontFixtures: fixtureFamilies, observe: [{ kind: 'env' }, { kind: 'script', source: head(true) + W1 }] },
    { id: 'ff-element-workers/W2-identity-worker-first', spec: 'condition 2 (a): the worker before the page, in a fresh document', pageLang: 'en', html: '<div></div>', fontFixtures: fixtureFamilies, observe: [{ kind: 'script', source: head(true) + W2 }] },
    { id: 'ff-element-workers/W4-trace', spec: 'condition 2 (a): every measureText call of the sweep in both scopes, and the ones that differ', pageLang: 'en', html: '<div></div>', fontFixtures: fixtureFamilies, observe: [{ kind: 'script', source: head(true) + W4 }] },
    { id: 'ff-element-workers/W5-default-generic', spec: 'condition 2 (a): the generic family a list without one ends in, on the page and in a worker (gfxTextRun.cpp:1881-1891, :1969-1977)', pageLang: 'en', html: '<div></div>', fontFixtures: fixtureFamilies, observe: [{ kind: 'script', source: head(true) + W5 }] },
    { id: 'ff-element-workers/W3-empty-lang', spec: 'condition 2 (a): a context with an empty lang in the two scopes, under <html lang="ja">', pageLang: 'ja', html: '<div></div>', observe: [{ kind: 'env' }, { kind: 'script', source: head(false) + W3 }] },
  ]
}
