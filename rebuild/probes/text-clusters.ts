// TextMetrics.getTextClusters in Chrome behind the runtime flag ExtendedTextMetrics (text_metrics.idl, text_metrics.cc at
// Chrome 153): what it gives, beside what the Blink port derives today and beside the DOM. Speculative study of
// 2026-09-20; nothing here is for a shipped library, which can't rest on a flag. Every probe returns raw values, and the
// ones a verdict rests on return `checks` too.
//
// - `api/presence` (A1): the four flagged methods on TextMetrics.prototype, and a getTextClusters call on a main-thread
//   OffscreenCanvas context, on a connected <canvas> and on an OffscreenCanvas in a dedicated worker.
// - `api/semantics` (A2): per string and settings, the clusters (start, end, x) with the default options and with
//   { align: 'left' } and { align: 'right' }, the total, the ranged form, and the DOM's Range rects of the same text on
//   one line: kerning, a ligature, combining marks, Thai, Devanagari, Arabic in an LTR and an RTL context, bidi text, emoji
//   sequences, a font fallback edge, letter spacing, word spacing, U+0020 against U+2028, default-ignorable characters in a
//   one-byte and a two-byte string, and a string past 256 px.
// - `api/cost` (A3): what a getTextClusters call costs beside measureText alone, by string length, for strings Canvas
//   shapes as one word (U+2028 for spaces, the port's form) and for strings with U+0020, on first asks and on repeats.
// - `port/<fixtures>-<n>` (B): over paragraphs of the tier case files, with the lab's font facts and without them, the
//   position of every glyph cluster boundary of every shaping group as the port derives it without the API (the library
//   bundle loaded while the method is hidden from the prototype) and with it (the same bundle loaded again), which
//   boundaries the API told, where the API's clusters differ from the port's, and for paragraphs of one text leaf in one
//   shaping group the DOM's Range rects at the same boundaries.
//
// Run under the browser lock, from the worktree, in the pinned Chrome with the flag:
//   python3 ~/github/pretext-rebuild/.artifacts/session/with-browser-lock.py spec-clusters-probes --browser=chrome -- \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/text-clusters.ts --out=<dir> \
//     --probe-timeout-ms=900000 --stall-ms=1200000 --chrome-args=--enable-blink-features=ExtendedTextMetrics
// TEXT_CLUSTERS_CASES=<n> bounds the distinct paragraphs of part B (default 3000).
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readBuild } from '../lab/browser-build.ts'
import type { Probe } from './types.ts'

const spec = 'text-clusters 2026-09-20'
const REPO = resolve(import.meta.dir, '../..')

const PRESENCE = String.raw`
  const names = ['getTextClusters', 'getSelectionRects', 'getActualBoundingBox', 'getIndexFromOffset', 'emHeightAscent'];
  const present = {};
  for (const name of names) present[name] = typeof TextMetrics !== 'undefined' && name in TextMetrics.prototype;
  const ask = ctx => {
    ctx.font = '32px "Times New Roman"';
    const m = ctx.measureText('AVA office');
    if (typeof m.getTextClusters !== 'function') return { width: m.width, clusters: null };
    return { width: m.width, clusters: m.getTextClusters().map(c => [c.start, c.end, c.x]), selection: m.getSelectionRects(0, 3).map(r => [r.x, r.width]), index: m.getIndexFromOffset(40) };
  };
  const offscreen = ask(new OffscreenCanvas(1, 1).getContext('2d'));
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  const connected = ask(canvas.getContext('2d'));
  canvas.remove();
  const workerSource = 'onmessage = () => { const ctx = new OffscreenCanvas(1, 1).getContext("2d"); ctx.font = ' + JSON.stringify('32px "Times New Roman"') +
    '; const m = ctx.measureText("AVA office"); postMessage({ has: typeof TextMetrics !== "undefined" && "getTextClusters" in TextMetrics.prototype, textCluster: typeof TextCluster, width: m.width, clusters: typeof m.getTextClusters === "function" ? m.getTextClusters().map(c => [c.start, c.end, c.x]) : null }); }';
  const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
  const inWorker = await new Promise((done, fail) => { worker.onmessage = e => done(e.data); worker.onerror = e => fail(new Error(e.message)); worker.postMessage(0); });
  worker.terminate();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    userAgent: navigator.userAgent, present, textClusterInterface: typeof TextCluster, offscreen, connected, inWorker,
    checks: [
      { name: 'getTextClusters is on TextMetrics.prototype', expected: true, measured: present.getTextClusters },
      { name: 'a main-thread OffscreenCanvas context answers', expected: true, measured: offscreen.clusters !== null && offscreen.clusters.length > 0 },
      { name: 'a worker has the method', expected: true, measured: inWorker.has },
      { name: 'a worker\'s OffscreenCanvas answers what the main thread\'s does', expected: true, measured: same(inWorker.clusters, offscreen.clusters) },
      { name: 'a connected canvas answers what the OffscreenCanvas does', expected: true, measured: same(connected.clusters, offscreen.clusters) },
    ],
  };
`

// Strings are built from code points so the file stays ASCII.
const cps = (...list: number[]): string => String.fromCodePoint(...list)
type Sample = { id: string; font: string; text: string; direction?: string; letterSpacing?: string; wordSpacing?: string; lang?: string }
const SAMPLES: Sample[] = [
  { id: 'kerning', font: '32px "Times New Roman"', text: 'AVAVA To We' },
  { id: 'kerning-u2028', font: '32px "Times New Roman"', text: 'AVAVA' + cps(0x2028) + 'To' + cps(0x2028) + 'We' },
  { id: 'ligature', font: '32px "Hoefler Text"', text: 'office fi ffl' },
  { id: 'ligature-letter-spaced', font: '32px "Hoefler Text"', text: 'office fi ffl', letterSpacing: '2px' },
  { id: 'combining', font: '32px "Helvetica Neue"', text: 'e' + cps(0x301) + 'a' + cps(0x308, 0x304) + 'o' },
  { id: 'thai', font: '32px "Thonburi"', text: cps(0xe01, 0xe33, 0xe25, 0xe31, 0xe07, 0xe17, 0xe35, 0xe48, 0xe19, 0xe49, 0xe33), lang: 'th' },
  { id: 'devanagari', font: '32px "Kohinoor Devanagari"', text: cps(0x915, 0x94d, 0x937, 0x924, 0x94d, 0x930, 0x93f, 0x92f, 0x20, 0x939, 0x93f, 0x928, 0x94d, 0x926, 0x940), lang: 'hi' },
  { id: 'arabic-ltr-context', font: '32px "Geeza Pro"', text: cps(0x627, 0x644, 0x633, 0x644, 0x627, 0x645, 0x2028, 0x639, 0x644, 0x64a, 0x643, 0x645), lang: 'ar' },
  { id: 'arabic-rtl-context', font: '32px "Geeza Pro"', text: cps(0x627, 0x644, 0x633, 0x644, 0x627, 0x645, 0x2028, 0x639, 0x644, 0x64a, 0x643, 0x645), direction: 'rtl', lang: 'ar' },
  { id: 'arabic-marks', font: '32px "Geeza Pro"', text: cps(0x628, 0x650, 0x633, 0x652, 0x645, 0x650), direction: 'rtl', lang: 'ar' },
  { id: 'bidi', font: '32px "Times New Roman"', text: 'abc ' + cps(0x5d0, 0x5d1, 0x5d2) + ' def ' + cps(0x5d3, 0x5d4) + '12' },
  { id: 'emoji', font: '32px "Helvetica Neue"', text: 'a' + cps(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466, 0x1f1eb, 0x1f1f7, 0x1f44d, 0x1f3fd, 0x2764, 0xfe0f) + 'b' },
  { id: 'fallback-edge', font: '32px "Helvetica Neue"', text: 'abc' + cps(0x4e2d, 0x6587) + 'def' + cps(0x3042) + 'g' },
  { id: 'letter-spacing', font: '32px "Times New Roman"', text: 'AVAVA To', letterSpacing: '3px' },
  { id: 'word-spacing', font: '32px "Times New Roman"', text: 'AV AV To', wordSpacing: '10px' },
  { id: 'word-spacing-u2028', font: '32px "Times New Roman"', text: 'AV' + cps(0x2028) + 'AV' + cps(0x2028) + 'To', wordSpacing: '10px' },
  { id: 'ignorable-one-byte', font: '32px "Times New Roman"', text: 'AV' + cps(0xad) + 'AV' },
  { id: 'ignorable-two-byte', font: '32px "Times New Roman"', text: 'AV' + cps(0x2060) + 'AV' + cps(0x200d) + 'T' + cps(0x200b) + 'o' },
  { id: 'zwj-edges', font: '32px "Geeza Pro"', text: cps(0x200d, 0x628, 0x628, 0x200d), direction: 'rtl', lang: 'ar' },
  { id: 'wide', font: '32px "Times New Roman"', text: 'The quick brown fox jumps over the lazy dog and keeps going past it' },
  { id: 'wide-u2028', font: '32px "Times New Roman"', text: 'The quick brown fox jumps over the lazy dog and keeps going past it'.replaceAll(' ', cps(0x2028)) },
]

const SEMANTICS = String.raw`
  const out = [];
  for (const sample of SAMPLES) {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    ctx.lang = sample.lang || 'en';
    ctx.font = sample.font;
    ctx.textRendering = 'optimizeLegibility';
    if (sample.direction) ctx.direction = sample.direction;
    if (sample.letterSpacing) ctx.letterSpacing = sample.letterSpacing;
    if (sample.wordSpacing) ctx.wordSpacing = sample.wordSpacing;
    const m = ctx.measureText(sample.text);
    const list = options => (options === null ? m.getTextClusters() : m.getTextClusters(options)).map(c => [c.start, c.end, c.x, c.y, c.align]);
    const half = sample.text.length >> 1;
    // The DOM's Range rects per code unit of the same text on one line, from the line's left end.
    const div = document.createElement('div');
    div.lang = sample.lang || 'en';
    div.setAttribute('style', 'position:absolute;left:0;top:0;white-space:pre;text-rendering:optimizeLegibility;font:' + sample.font + ';direction:' + (sample.direction || 'ltr') +
      ';letter-spacing:' + (sample.letterSpacing || 'normal') + ';word-spacing:' + (sample.wordSpacing || 'normal'));
    div.textContent = sample.text;
    host.appendChild(div);
    const node = div.firstChild;
    const dom = [];
    const origin = div.getBoundingClientRect().left;
    for (let i = 0; i < sample.text.length; i++) {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rects = [...range.getClientRects()].map(r => [r.left - origin, r.width]);
      dom.push(rects);
    }
    const domWidth = div.getBoundingClientRect().width;
    div.remove();
    out.push({
      id: sample.id, font: sample.font, units: [...sample.text].map(ch => ch.codePointAt(0).toString(16)), length: sample.text.length, settings: { direction: ctx.direction, letterSpacing: ctx.letterSpacing, wordSpacing: ctx.wordSpacing },
      width: m.width, defaults: list(null), left: list({ align: 'left' }), right: list({ align: 'right' }), ranged: m.getTextClusters(half, sample.text.length).map(c => [c.start, c.end, c.x]), dom, domWidth, dpr: devicePixelRatio,
    });
  }
  return out;
`

const COST = String.raw`
  const WORDS = 'the of and to in that was his he it with is for as had you not be her on at by which have or from this him but all she they were my are me one their so an said them we who would been will no when there if more out up into do any your what has man could other than our some very time upon about may its only now like little then can should made did us such a great before must two these see know over much down after first mr good men own never most old shall day where those came come himself way work life without go make well through being long say might how am too even def again many back here think every people went same last thought away under take found hand eye still place while just also young yet though against things get ever part nothing'.split(' ');
  const FORMS = [['u2028', String.fromCharCode(0x2028)], ['space', ' ']];
  const LENGTHS = [8, 16, 32, 64, 128, 256];
  const N = 4000;
  let serial = 0;
  // Distinct strings of about length units: words joined by the separator, each string with a serial number inside one word.
  const strings = (length, separator) => {
    const list = [];
    for (let i = 0; i < N; i++) {
      let s = 'w' + (serial++).toString(36);
      for (let w = i; s.length < length; w++) s += separator + WORDS[w % WORDS.length];
      list.push(s.slice(0, length));
    }
    return list;
  };
  const time = run => { const start = performance.now(); const sink = run(); return { ms: performance.now() - start, sink }; };
  const rows = [];
  for (const [form, separator] of FORMS) {
    for (const length of LENGTHS) {
      const row = { form, length, n: N, rounds: [] };
      for (let round = 0; round < 3; round++) {
        const ctxA = new OffscreenCanvas(1, 1).getContext('2d');
        const ctxB = new OffscreenCanvas(1, 1).getContext('2d');
        const ctxC = new OffscreenCanvas(1, 1).getContext('2d');
        for (const ctx of [ctxA, ctxB, ctxC]) { ctx.font = '32px "Helvetica Neue"'; ctx.textRendering = 'optimizeLegibility'; }
        const a = strings(length, separator), b = strings(length, separator), c = strings(length, separator);
        const firstWidth = time(() => { let sum = 0; for (let i = 0; i < N; i++) sum += ctxA.measureText(a[i]).width; return sum; });
        const firstClusters = time(() => { let sum = 0; for (let i = 0; i < N; i++) { const m = ctxB.measureText(b[i]); sum += m.width + m.getTextClusters().length; } return sum; });
        const firstRead = time(() => { let sum = 0; for (let i = 0; i < N; i++) { const m = ctxC.measureText(c[i]); const list = m.getTextClusters(); for (let j = 0; j < list.length; j++) sum += list[j].start + list[j].x; } return sum; });
        const againWidth = time(() => { let sum = 0; for (let i = 0; i < N; i++) sum += ctxA.measureText(a[i]).width; return sum; });
        const againClusters = time(() => { let sum = 0; for (let i = 0; i < N; i++) { const m = ctxB.measureText(b[i]); sum += m.width + m.getTextClusters().length; } return sum; });
        const againRead = time(() => { let sum = 0; for (let i = 0; i < N; i++) { const m = ctxC.measureText(c[i]); const list = m.getTextClusters(); for (let j = 0; j < list.length; j++) sum += list[j].start + list[j].x; } return sum; });
        // What the port asks today for the same positions: one prefix per cluster boundary (the pair window's three strings left out).
        const ctxD = new OffscreenCanvas(1, 1).getContext('2d');
        ctxD.font = '32px "Helvetica Neue"'; ctxD.textRendering = 'optimizeLegibility';
        const d = strings(length, separator).slice(0, 200);
        const prefixes = time(() => { let sum = 0; for (let i = 0; i < d.length; i++) for (let k = 1; k <= d[i].length; k++) sum += ctxD.measureText(d[i].slice(0, k)).width; return sum; });
        row.rounds.push({
          usPerCall: { firstWidth: firstWidth.ms * 1000 / N, firstClusters: firstClusters.ms * 1000 / N, firstRead: firstRead.ms * 1000 / N, againWidth: againWidth.ms * 1000 / N, againClusters: againClusters.ms * 1000 / N, againRead: againRead.ms * 1000 / N },
          prefixesUsPerString: prefixes.ms * 1000 / d.length,
        });
      }
      rows.push(row);
    }
  }
  return { timerStepNote: 'performance.now() in a page that is not cross-origin isolated steps 0.1 ms; every figure is a loop of ' + N + ' calls', crossOriginIsolated, rows };
`

const PORT = String.raw`
  const hidden = Object.getOwnPropertyDescriptor(TextMetrics.prototype, 'getTextClusters');
  if (hidden === undefined) return { error: 'TextMetrics.prototype has no getTextClusters: run Chrome with --enable-blink-features=ExtendedTextMetrics' };
  delete TextMetrics.prototype.getTextClusters;
  const before = (await import('data:text/javascript;base64,' + LIBRARY)).library;
  Object.defineProperty(TextMetrics.prototype, 'getTextClusters', hidden);
  const after = (await import('data:text/javascript;base64,' + LIBRARY_AGAIN)).library;
  if (before.hasTextClusters || !after.hasTextClusters) return { error: 'the two bundles read the feature test as ' + before.hasTextClusters + ' and ' + after.hasTextClusters };
  const detected = before.detectEnvironment({ engine: 'blink', build: BUILD, contentLanguage: null, uiLanguage: null });
  if (detected.kind !== 'supported') return { error: 'unsupported environment: ' + JSON.stringify(detected) };
  const env = detected.env;
  let measureTextCalls = 0, clusterCalls = 0;
  const proto = OffscreenCanvasRenderingContext2D.prototype;
  const measureText = proto.measureText;
  proto.measureText = function (text) { measureTextCalls++; return measureText.call(this, text); };
  const getTextClusters = TextMetrics.prototype.getTextClusters;
  TextMetrics.prototype.getTextClusters = function (...rest) { clusterCalls++; return getTextClusters.apply(this, rest); };
  const LU = 1024;
  const configs = [['facts', before.fontFactsFor, after.fontFactsFor], ['no-facts', () => before.unknownFontFacts, () => after.unknownFontFacts]];
  const out = { dpr: devicePixelRatio, cases: CASES.length, configs: {} };
  for (const [config, factsBefore, factsAfter] of configs) {
    const contextsBefore = [], contextsAfter = [];
    const totals = {
      paragraphs: 0, errors: 0, groups: 0, boundaries: 0, told: 0, notTold: 0, toldEqual: 0, toldWithinLU: 0, toldSameLU: 0, toldDifferent: 0, notToldEqual: 0, notToldDifferent: 0,
      unitsTold: 0, clusterStartsAgree: 0, portStartApiNot: 0, apiStartPortNot: 0,
      dom: { paragraphs: 0, boundaries: 0, apiFloorEqual: 0, apiWithinLU: 0, apiDifferent: 0, portFloorEqual: 0, portWithinLU: 0, portDifferent: 0 },
      calls: { beforeMeasureText: 0, afterMeasureText: 0, afterTextClusters: 0 },
    };
    const byFamily = {};
    const examples = { toldDifferent: [], clusterStarts: [], domApiDifferent: [], domPortDifferent: [], errors: [] };
    for (const c of CASES) {
      const family = c.family.split('/').slice(0, 2).join('/');
      const fam = byFamily[family] ??= { paragraphs: 0, told: 0, toldEqual: 0, toldWithinLU: 0, toldDifferent: 0, maxDifference16: 0 };
      try {
        document.documentElement.lang = c.pageLang;
        const paragraphBefore = before.layoutInput(c, 'blink', factsBefore);
        const paragraphAfter = after.layoutInput(c, 'blink', factsAfter);
        const envCase = { ...env, pageLang: c.pageLang };
        let from = measureTextCalls;
        const pb = before.prepare(paragraphBefore, envCase, false, contextsBefore).state;
        const shb = { p: pb, gaps: null };
        const portAt = [];
        for (let g = 0; g < pb.groups.length; g++) {
          const group = pb.groups[g];
          for (let k = group.start + 1; k < group.end; k++) if (before.isClusterBoundary(pb, k)) portAt.push([g, k, before.groupPrefix16(shb, g, k)]);
        }
        totals.calls.beforeMeasureText += measureTextCalls - from;
        from = measureTextCalls;
        const fromClusters = clusterCalls;
        const pa = after.prepare(paragraphAfter, envCase, false, contextsAfter).state;
        const sha = { p: pa, gaps: null };
        totals.paragraphs++; fam.paragraphs++;
        totals.groups += pa.groups.length;
        const apiAt = new Map();
        for (let i = 0; i < portAt.length; i++) {
          const [g, k, port16] = portAt[i];
          const group = pa.groups[g];
          const told = after.toldPrefix16(sha, g, k, group.start, group.end) !== null;
          const api16 = after.groupPrefix16(sha, g, k);
          apiAt.set(k, api16);
          totals.boundaries++;
          const difference = Math.abs(api16 - port16);
          if (!told) { totals.notTold++; if (difference === 0) totals.notToldEqual++; else totals.notToldDifferent++; continue; }
          totals.told++; fam.told++;
          if (difference === 0) { totals.toldEqual++; fam.toldEqual++; }
          else if (difference < LU) {
            totals.toldWithinLU++; fam.toldWithinLU++;
            if (Math.ceil(api16 / LU) === Math.ceil(port16 / LU)) totals.toldSameLU++;
          } else { totals.toldDifferent++; fam.toldDifferent++; }
          if (difference > fam.maxDifference16) fam.maxDifference16 = difference;
          if (difference >= LU && examples.toldDifferent.length < 60) examples.toldDifferent.push({ id: c.id, family, font: pa.styles[group.style].font.family + ' ' + pa.styles[group.style].font.size, rtl: group.rtl, k, around: [...pa.text.slice(Math.max(group.start, k - 4), Math.min(group.end, k + 4))].map(ch => ch.codePointAt(0).toString(16)).join(' '), port16, api16 });
        }
        for (let g = 0; g < pa.groups.length; g++) {
          const group = pa.groups[g];
          for (let k = group.start + 1; k < group.end; k++) {
            const told = after.toldClusterStart(sha, g, k, group.start, group.end);
            if (told === null) continue;
            totals.unitsTold++;
            const port = after.isClusterBoundary(pa, k);
            if (told === port) { totals.clusterStartsAgree++; continue; }
            if (port) totals.portStartApiNot++; else totals.apiStartPortNot++;
            if (examples.clusterStarts.length < 60) examples.clusterStarts.push({ id: c.id, family, font: pa.styles[group.style].font.family + ' ' + pa.styles[group.style].font.size, k, port, api: told, around: [...pa.text.slice(Math.max(group.start, k - 3), Math.min(group.end, k + 3))].map(ch => ch.codePointAt(0).toString(16)).join(' ') });
          }
        }
        totals.calls.afterMeasureText += measureTextCalls - from;
        totals.calls.afterTextClusters += clusterCalls - fromClusters;
        // The DOM, for a paragraph of one text leaf whose text_content is the leaf's text, in one left-to-right shaping group.
        const p = c.paragraph;
        if (c.inline === undefined && p.runs.length === 1 && p.runs[0].node === 'text' && pa.text === p.runs[0].text && pa.groups.length === 1 && !pa.groups[0].rtl && p.direction === 'ltr' && pa.groups[0].start === 0) {
          const div = document.createElement('div');
          if (p.lang !== null) div.lang = p.lang;
          div.setAttribute('style', 'position:absolute;left:0;top:0;width:max-content;white-space:pre;font:' + p.font.style + ' ' + p.font.weight + ' ' + p.font.size + 'px ' + p.font.family +
            ';letter-spacing:' + p.letterSpacing + 'px;word-spacing:' + p.wordSpacing + 'px;direction:ltr');
          div.textContent = pa.text;
          host.appendChild(div);
          const node = div.firstChild;
          const origin = div.getBoundingClientRect().left;
          totals.dom.paragraphs++;
          for (let i = 0; i < portAt.length; i++) {
            const [g, k, port16] = portAt[i];
            const range = document.createRange();
            range.setStart(node, k);
            range.setEnd(node, Math.min(pa.text.length, k + 1));
            const rects = range.getClientRects();
            if (rects.length !== 1 || rects[0].width === 0) continue;
            // LocalRect floors a range's start position to a LayoutUnit (1/64 of a zoomed px).
            const domLU = (rects[0].left - origin) * 64 * devicePixelRatio;
            const api16 = apiAt.get(k);
            totals.dom.boundaries++;
            const apiOff = Math.abs(Math.floor(api16 / LU) - domLU), portOff = Math.abs(Math.floor(port16 / LU) - domLU);
            if (apiOff === 0) totals.dom.apiFloorEqual++; else if (apiOff <= 1) totals.dom.apiWithinLU++; else totals.dom.apiDifferent++;
            if (portOff === 0) totals.dom.portFloorEqual++; else if (portOff <= 1) totals.dom.portWithinLU++; else totals.dom.portDifferent++;
            const example = { id: c.id, family, font: p.font.family + ' ' + p.font.size, letterSpacing: p.letterSpacing, k, around: [...pa.text.slice(Math.max(0, k - 4), k + 4)].map(ch => ch.codePointAt(0).toString(16)).join(' '), domLU, api16, port16 };
            if (apiOff > 1 && examples.domApiDifferent.length < 60) examples.domApiDifferent.push(example);
            if (portOff > 1 && apiOff <= 1 && examples.domPortDifferent.length < 60) examples.domPortDifferent.push(example);
          }
          div.remove();
        }
      } catch (error) {
        totals.errors++;
        if (examples.errors.length < 20) examples.errors.push({ id: c.id, error: String(error && error.stack || error).slice(0, 400) });
      }
    }
    out.configs[config] = { totals, byFamily, examples };
  }
  proto.measureText = measureText;
  TextMetrics.prototype.getTextClusters = getTextClusters;
  return out;
`

async function bundled(path: string): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, path)], format: 'esm', target: 'browser' })
  if (!built.success) throw new Error(`${path} didn't bundle: ${built.logs.join('\n')}`)
  return await built.outputs[0]!.text()
}

const CASE_FILES = [
  '.artifacts/lab/cases/runs.ndjson', '.artifacts/lab/cases/policy.ndjson', '.artifacts/lab/cases/ws.ndjson',
  '.artifacts/lab/final-20260916/cases/suite-sample-part0.ndjson', '.artifacts/lab/final-20260916/cases/suite-sample-part1.ndjson',
  '.artifacts/lab/final-20260916/cases/suite-sample-part2.ndjson', '.artifacts/lab/final-20260916/cases/suite-sample-part3.ndjson',
]

type CaseLine = { id: string; family: string; pageLang: string; fontFixtures?: string[]; paragraph: { width: number } }

// Distinct paragraphs of the tier case files (a case's width doesn't move a position), taken in turn from every case family
// so the rare families are in, grouped by the fixture fonts they load and the page language, which a document shares.
function selectCases(limit: number): Map<string, CaseLine[]> {
  const byFamily = new Map<string, CaseLine[]>()
  const seen = new Set<string>()
  for (let f = 0; f < CASE_FILES.length; f++) {
    const lines = readFileSync(join(REPO, CASE_FILES[f]!), 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length === 0) continue
      const c = JSON.parse(lines[i]!) as CaseLine
      const key = JSON.stringify([{ ...c.paragraph, width: 0 }, c.pageLang, c.fontFixtures ?? [], (c as { inline?: unknown }).inline ?? null])
      if (seen.has(key)) continue
      seen.add(key)
      const family = c.family.split('/').slice(0, 2).join('/')
      if (!byFamily.has(family)) byFamily.set(family, [])
      byFamily.get(family)!.push(c)
    }
  }
  const families = [...byFamily.values()]
  const documents = new Map<string, CaseLine[]>()
  let taken = 0
  for (let round = 0; taken < limit; round++) {
    let any = false
    for (let f = 0; f < families.length && taken < limit; f++) {
      const c = families[f]![round]
      if (c === undefined) continue
      any = true
      taken++
      const key = JSON.stringify([c.fontFixtures ?? [], c.pageLang])
      if (!documents.has(key)) documents.set(key, [])
      documents.get(key)!.push(c)
    }
    if (!any) break
  }
  return documents
}

export default async function probes(): Promise<Probe[]> {
  const library = await bundled('text-clusters-entry.ts')
  const base64 = (text: string): string => Buffer.from(text).toString('base64')
  const build = readBuild('chrome').engine
  const list: Probe[] = [
    { id: 'text-clusters/api/presence', spec, pageLang: 'en', html: '<div></div>', observe: [{ kind: 'env' }, { kind: 'script', source: PRESENCE }] },
    { id: 'text-clusters/api/semantics', spec, pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: `const SAMPLES = ${JSON.stringify(SAMPLES)};\n${SEMANTICS}` }] },
    { id: 'text-clusters/api/cost', spec, pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: COST }] },
  ]
  const documents = selectCases(Number(process.env['TEXT_CLUSTERS_CASES'] ?? 3000))
  let n = 0
  for (const [key, cases] of documents) {
    const [fixtures, pageLang] = JSON.parse(key) as [string[], string]
    const head = `const LIBRARY = ${JSON.stringify(base64(library))};\nconst LIBRARY_AGAIN = ${JSON.stringify(base64(library + '\n// loaded again with getTextClusters on the prototype\n'))};\nconst BUILD = ${JSON.stringify(build)};\n`
    list.push({
      id: `text-clusters/port/${fixtures.length === 0 ? 'installed' : fixtures.join('+').replaceAll(' ', '-')}-${pageLang}-${n++}`, spec, pageLang, html: '<div></div>',
      ...(fixtures.length === 0 ? {} : { fontFixtures: fixtures }),
      observe: [{ kind: 'script', source: `${head}const CASES = ${JSON.stringify(cases)};\n${PORT}` }],
    })
  }
  return list
}
