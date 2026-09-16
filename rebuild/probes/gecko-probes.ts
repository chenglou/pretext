// Firefox probes for the numbered hypotheses in rebuild/specs/gecko-lines.md (§10), gecko-canvas.md (§5),
// gecko-text.md (§18), the gecko items of CRITIC.md (§6), and six cross-cutting checks.
//
// Every probe is one `script` observation. The shared prelude builds test elements in the host, waits for fonts and two
// animation frames, and records `checks` (hypothesis claims, each with measured and expected values) and `pre`
// (preconditions the claim depends on, such as a font having a ligature). Each probe body runs twice in its document and
// the second pass is kept; `stable` says whether both passes measured the same values (async font fallback).
// Thresholds are computed in the page from Canvas or DOM measurements, never guessed. Widths are compared as integer
// app units (Math.round(px * 60)) unless a hypothesis names a tolerance.
//
// GECKO_PROBE_SET=apd selects the probes worth repeating at other app units per device pixel (run with
// --firefox-prefs and layout.css.devPixelsPerPx). Verdicts: rebuild/probes/gecko-verdicts.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Probe } from './types.ts'

const PRELUDE = String.raw`
const raf = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function settle() { host.getBoundingClientRect(); await document.fonts.ready; await raf(); await raf(); host.getBoundingClientRect(); }
let R = null;
function reset() { R = { checks: [], pre: [], raw: {} }; host.replaceChildren(); }
function check(name, measured, expected, ok) { R.checks.push({ name, measured, expected, ok: ok === true }); return ok === true; }
function pre(name, measured, expected, ok) { R.pre.push({ name, measured, expected, ok: ok === true }); return ok === true; }
async function twice(run) {
  reset(); await run(); const first = R;
  await settle(); await sleep(150);
  reset(); await run();
  const sig = x => JSON.stringify([x.checks.map(c => c.measured), x.pre.map(c => c.measured)]);
  R.stable = sig(first) === sig(R);
  if (!R.stable) R.firstPass = { checks: first.checks, pre: first.pre };
  R.env = { dpr: window.devicePixelRatio, visualViewportScale: window.visualViewport ? window.visualViewport.scale : null, lang: document.documentElement.getAttribute('lang') };
  return R;
}
const CN = 'font:16px/20px "Courier New";';
const CNF = '16px "Courier New"';
const HN = 'font:16px/20px "Helvetica Neue";';
const HNF = '16px "Helvetica Neue"';
function div(style, html) { const d = document.createElement('div'); d.setAttribute('style', 'margin:0;padding:0;border:0;' + style); if (html !== undefined && html !== null) d.innerHTML = html; host.append(d); return d; }
function divT(style, text) { const d = div(style); d.textContent = text; return d; }
function span(parent, text, style) { const s = document.createElement('span'); if (style) s.setAttribute('style', style); s.textContent = text; parent.append(s); return s; }
function preSpan(font, text, extra) { return span(div('font:' + font + ';white-space:pre;' + (extra || '')), text); }
function htmlSpan(style, html) { return div(style, html).firstElementChild; }
const bw = e => e.getBoundingClientRect().width;
const au = x => (x === null || x === undefined) ? null : Math.round(x * 60);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ctx2d(kind) {
  if (kind === 'ec') { const c = document.createElement('canvas'); c.width = 10; c.height = 10; host.append(c); return c.getContext('2d'); }
  return new OffscreenCanvas(1, 1).getContext('2d');
}
function measureWith(kind, font, text, props) { const c = ctx2d(kind); c.font = font; if (props) for (const k of Object.keys(props)) c[k] = props[k]; return c.measureText(text); }
const oc = (font, text, props) => measureWith('oc', font, text, props).width;
const ec = (font, text, props) => measureWith('ec', font, text, props).width;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
// Per grapheme cluster, not per code point: Firefox gives the base of a base + mark cluster a zero-width rect and the
// mark the whole advance, so per-code-point starts would land on the mark.
function points(e) {
  const origin = e.getBoundingClientRect(); const range = document.createRange();
  const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const out = []; let base = 0;
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const data = n.data;
    for (const seg of graphemes.segment(data)) {
      const i = seg.index, len = seg.segment.length;
      range.setStart(n, i); range.setEnd(n, i + len);
      out.push({ o: base + i, len, rects: Array.from(range.getClientRects(), q => ({ x: q.x - origin.x, y: q.y - origin.y, w: q.width, h: q.height })) });
    }
    base += data.length;
  }
  return out;
}
function lines(e) {
  const text = e.textContent; const lh = Number.parseFloat(getComputedStyle(e).lineHeight);
  let thr = Number.isFinite(lh) ? lh / 2 : NaN; const out = [];
  const pts = points(e);
  for (const p of pts) {
    const q = p.rects.find(r => r.w > 0 && r.h > 0); if (q === undefined) continue;
    if (!Number.isFinite(thr)) thr = q.h / 2;
    const c = q.y + q.h / 2; let line = out.find(l => Math.abs(l.c - c) < thr);
    if (line === undefined) { line = { c, start: p.o, end: p.o + p.len, left: q.x, right: q.x + q.w }; out.push(line); }
    line.start = Math.min(line.start, p.o); line.end = Math.max(line.end, p.o + p.len);
    line.left = Math.min(line.left, q.x); line.right = Math.max(line.right, q.x + q.w);
  }
  out.sort((a, b) => a.c - b.c);
  return out.map(l => ({ start: l.start, text: text.slice(l.start, l.end), left: l.left, right: l.right, centre: l.c }));
}
function checkStarts(name, e, expected) {
  const ls = lines(e); const s = ls.map(l => l.start);
  check(name, { starts: s, texts: ls.map(l => l.text) }, { starts: expected }, same(s, expected));
  return ls;
}
function pointAt(e, offset) { return points(e).find(p => p.o === offset); }
function xAt(e, offset) { const p = pointAt(e, offset); if (!p) return null; const q = p.rects.find(r => r.h > 0) || p.rects[0]; return q ? q.x : null; }
async function workerMeasure(items) {
  const src = 'onmessage = async e => { const run = () => e.data.map(it => { const c = new OffscreenCanvas(1, 1).getContext("2d"); c.font = it.font; if (it.props) for (const k of Object.keys(it.props)) c[k] = it.props[k]; const m = c.measureText(it.text); return { w: m.width, l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight }; }); const first = run(); await new Promise(r => setTimeout(r, 300)); postMessage({ first, second: run() }); };';
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timeout')), 5000);
      worker.onmessage = e => { clearTimeout(timer); resolve(e.data); };
      worker.onerror = e => { clearTimeout(timer); e.preventDefault(); reject(new Error('worker error ' + e.message)); };
      worker.postMessage(items);
    });
  } finally { worker.terminate(); URL.revokeObjectURL(url); }
}
`

function probe(spec: string, note: string, body: string, extra: Partial<Probe> = {}): Probe {
  return {
    id: spec, spec, pageLang: 'en', note,
    observe: [{ kind: 'script', source: `${PRELUDE}\nreturn await twice(async () => {\n${body}\n});` }],
    ...extra,
  }
}

// ---- Corpus words (gecko-canvas H2, H23) ----

const corpus = readFileSync(join(import.meta.dir, '../../corpora/en-gatsby-opening.txt'), 'utf8').split(/\s+/).filter(word => word !== '')
const wordCounts = new Map<string, number>()
for (let i = 0; i < corpus.length; i++) wordCounts.set(corpus[i]!, (wordCounts.get(corpus[i]!) ?? 0) + 1)
const WORDS = [...wordCounts.keys()]
const COUNTS = WORDS.map(word => wordCounts.get(word)!)
const H2_WORDS = WORDS.filter((_, i) => i % 191 === 7).slice(0, 50)

// ---- gecko-lines §10 ----

const lineProbes: Probe[] = [
  probe('gecko-lines H1', '86.4px: 1 line; 86.38px: 2 lines (aaaa / bbbb)', String.raw`
const t = 'aaaa bbbb';
const a = divT(CN + 'width:86.4px', t), b = divT(CN + 'width:86.38px', t);
await settle();
const w = au(oc(CNF, t)); pre('OC Courier New aaaa bbbb au', w, 5184, w === 5184);
checkStarts('width 86.4px', a, [0]);
checkStarts('width 86.38px', b, [0, 5]);`),
  probe('gecko-lines H2', 'aaaa bbbb cccc at 86.4px: 2 lines, aaaa bbbb / cccc', String.raw`
const e = divT(CN + 'width:86.4px', 'aaaa bbbb cccc'); await settle();
checkStarts('aaaa bbbb cccc at 86.4px', e, [0, 10]);`),
  probe('gecko-lines H3', '16px Georgia aaaa bbbb = 4320 au: 1 line at 72px, 2 lines at 71.99px, at every DPR and zoom', String.raw`
const t = 'aaaa bbbb';
const a = divT('font:16px/20px Georgia;width:72px', t), b = divT('font:16px/20px Georgia;width:71.99px', t);
const s = preSpan('16px Georgia', t);
await settle();
const w = au(oc('16px Georgia', t)); pre('OC Georgia aaaa bbbb au', w, 4320, w === 4320);
check('DOM span au', au(bw(s)), 4320, au(bw(s)) === 4320);
checkStarts('width 72px', a, [0]);
checkStarts('width 71.99px', b, [0, 5]);
R.raw.apd = Math.round(60 / devicePixelRatio);`),
  probe('gecko-lines H4', 'letter-spacing 0.01px: aaaa bbbb = 5193 au; 1 line at 86.55px, 2 lines at 86.5px', String.raw`
const t = 'aaaa bbbb', ls = 'letter-spacing:0.01px;';
const a = divT(CN + ls + 'width:86.55px', t), b = divT(CN + ls + 'width:86.5px', t);
const s = preSpan(CNF, t, ls);
await settle();
check('DOM span au', au(bw(s)), 5193, au(bw(s)) === 5193);
checkStarts('width 86.55px', a, [0]);
checkStarts('width 86.5px', b, [0, 5]);`),
  probe('gecko-lines H5', 'letter-spacing 1px: 5724 au; 1 line at 95.4px, 2 lines at 95.35px', String.raw`
const t = 'aaaa bbbb', ls = 'letter-spacing:1px;';
const a = divT(CN + ls + 'width:95.4px', t), b = divT(CN + ls + 'width:95.35px', t);
const s = preSpan(CNF, t, ls);
await settle();
check('DOM span au', au(bw(s)), 5724, au(bw(s)) === 5724);
checkStarts('width 95.4px', a, [0]);
checkStarts('width 95.35px', b, [0, 5]);`),
  probe('gecko-lines H6', 'word-spacing 10%: 5280 au; 1 line at 88px, 2 lines at 87.95px', String.raw`
const t = 'aaaa bbbb', ws = 'word-spacing:10%;';
const a = divT(CN + ws + 'width:88px', t), b = divT(CN + ws + 'width:87.95px', t);
const s = preSpan(CNF, t, ws);
await settle();
check('DOM span au', au(bw(s)), 5280, au(bw(s)) === 5280);
checkStarts('width 88px', a, [0]);
checkStarts('width 87.95px', b, [0, 5]);`),
  probe('gecko-lines H7', 'DOM word-spacing 10px a NBSP b = 38.8px; OC wordSpacing 10px: a NBSP b 28.8px, a b 38.8px', String.raw`
const s = span(div(CN + 'word-spacing:10px'), 'a b'); await settle();
check('DOM span a NBSP b', bw(s), 38.8, au(bw(s)) === 2328);
const w1 = oc(CNF, 'a b', { wordSpacing: '10px' }), w2 = oc(CNF, 'a b', { wordSpacing: '10px' });
check('OC a NBSP b', w1, 28.8, au(w1) === 1728);
check('OC a b', w2, 38.8, au(w2) === 2328);`),
  probe('gecko-lines H8', '57.6px: x / aaaa- / 1111; aaaa-1111: aaaa- / 1111; nowrap: 1 line', String.raw`
const a = divT(CN + 'width:57.6px', 'x aaaa-1111'), b = divT(CN + 'width:57.6px', 'aaaa-1111'), c = divT(CN + 'width:57.6px;white-space:nowrap', 'aaaa-1111');
await settle();
checkStarts('x aaaa-1111', a, [0, 2, 7]);
checkStarts('aaaa-1111', b, [0, 5]);
checkStarts('aaaa-1111 nowrap', c, [0]);`),
  probe('gecko-lines H9', 'overflow-wrap anywhere and break-word, 57.6px, aa bbbbbbbbbb: starts 0, 3, 9', String.raw`
const a = divT(CN + 'width:57.6px;overflow-wrap:anywhere', 'aa bbbbbbbbbb'), b = divT(CN + 'width:57.6px;overflow-wrap:break-word', 'aa bbbbbbbbbb');
await settle();
checkStarts('anywhere', a, [0, 3, 9]);
checkStarts('break-word', b, [0, 3, 9]);`),
  probe('gecko-lines H10', 'aa b<span>bbbbb</span> at 57.6px: aa / bbbbbb, line 2 starts at 3', String.raw`
const e = div(CN + 'width:57.6px', 'aa b<span style="color:red">bbbbb</span>'); await settle();
checkStarts('lines', e, [0, 3]);`),
  probe('gecko-lines H11', '<b>foo</b>bar at 28.8px: 1 overflowing line', String.raw`
const e = div(CN + 'width:28.8px', '<b>foo</b>bar'); await settle();
checkStarts('lines', e, [0]);`),
  probe('gecko-lines H12', 'padding-right 9.6px span: aaa / aaa b; control: aaa aaa / b', String.raw`
const a = div(CN + 'width:57.6px', '<span style="padding-right:9.6px">aaa aaa b</span>'), b = div(CN + 'width:57.6px', '<span>aaa aaa b</span>');
await settle();
checkStarts('with padding-right 9.6px', a, [0, 4]);
checkStarts('without padding', b, [0, 8]);`),
  probe('gecko-lines H12b', 'H12 at a discriminating width, 67.2px (4032 au = aaa aaa): with padding-right 9.6px aaa / aaa b; without aaa aaa / b', String.raw`
const a = div(CN + 'width:67.2px', '<span style="padding-right:9.6px">aaa aaa b</span>'), b = div(CN + 'width:67.2px', '<span>aaa aaa b</span>');
await settle();
checkStarts('with padding-right 9.6px at 67.2px', a, [0, 4]);
checkStarts('without padding at 67.2px', b, [0, 8]);`),
  probe('gecko-lines H13', 'pre-wrap right-aligned aaaa   bb at 57.6px: aaaa + 3 spaces / bb; first a at x = 19.2px', String.raw`
const e = divT(CN + 'width:57.6px;white-space:pre-wrap;text-align:right', 'aaaa   bb'); await settle();
checkStarts('lines', e, [0, 7]);
const x = xAt(e, 0); check('x of first a', x, 19.2, au(x) === 1152);
R.raw.points = points(e);`),
  probe('gecko-lines H14', 'break-spaces aaaa   bb at 57.6px: line 2 starts with the space at index 6', String.raw`
const e = divT(CN + 'width:57.6px;white-space:break-spaces', 'aaaa   bb'); await settle();
checkStarts('lines', e, [0, 6]);`),
  probe('gecko-lines H15', 'pre tab stops: x of b 76.8, 76.8, 153.6, and 76.8 with text-indent 57.6px', String.raw`
const mk = (t, extra) => divT(CN + 'white-space:pre;' + (extra || ''), t);
const a = mk('a\tb'), b = mk('aaaaaaa\tb'), c = mk('aaaaaaaa\tb'), d = mk('a\tb', 'text-indent:57.6px');
await settle();
const xb = e => xAt(e, e.textContent.length - 1);
check('a\\tb', xb(a), 76.8, au(xb(a)) === 4608);
check('aaaaaaa\\tb', xb(b), 76.8, au(xb(b)) === 4608);
check('aaaaaaaa\\tb', xb(c), 153.6, au(xb(c)) === 9216);
check('a\\tb with text-indent 57.6px', xb(d), 76.8, au(xb(d)) === 4608);`),
  probe('gecko-lines H16', 'hyphens manual, letter-spacing 1px, 53px, <span>aaaa&shy;bbbb</span>: aaaa- / bbbb; span first rect 52px', String.raw`
const e = div(CN + 'width:53px;hyphens:manual;letter-spacing:1px', '<span>aaaa&shy;bbbb</span>'); await settle();
checkStarts('lines', e, [0, 5]);
const r = e.firstElementChild.getClientRects(); const w = r.length > 0 ? r[0].width : null;
check('span first rect width', w, 52, au(w) === 3120);
R.raw.rects = Array.from(r, q => q.width);`),
  probe('gecko-lines H17', 'Hiragino Sans right-aligned at 48px: (A) 2 lines, first あ at x 16; (B) 2 lines, first あ at x 0', String.raw`
const HS = 'font:16px/20px "Hiragino Sans";width:48px;text-align:right';
const a = divT(HS, 'ああ　いい'), b = div(HS, 'ああ　<span style="color:red">いい</span>');
await settle();
for (const ch of ['あ', 'い', '　']) { const w = oc('16px "Hiragino Sans"', ch); pre('OC U+' + ch.codePointAt(0).toString(16) + ' is 16px', w, 16, au(w) === 960); }
checkStarts('(A) lines', a, [0, 3]);
checkStarts('(B) lines', b, [0, 3]);
const xa = xAt(a, 0), xb = xAt(b, 0);
check('(A) x of first あ', xa, 16, au(xa) === 960);
check('(B) x of first あ', xb, 0, au(xb) === 0);`),
  probe('gecko-lines H18', 'DOM a\\rb, a\\fb, a\\vb = 19.2px (OC 28.8px); a \\r b = 38.4px; a  b = 28.8px', String.raw`
const T = [['a\\rb', 'a\rb'], ['a\\fb', 'a\fb'], ['a\\vb', 'a\vb']];
const spans = T.map(([, t]) => span(div(CN), t));
const s4 = span(div(CN), 'a \r b'), s5 = span(div(CN), 'a  b');
await settle();
T.forEach(([n], i) => check('DOM ' + n, bw(spans[i]), 19.2, au(bw(spans[i])) === 1152));
T.forEach(([n, t]) => { const w = oc(CNF, t); check('OC ' + n, w, 28.8, au(w) === 1728); });
check('DOM a \\r b', bw(s4), 38.4, au(bw(s4)) === 2304);
check('DOM a  b', bw(s5), 28.8, au(bw(s5)) === 1728);`),
  probe('gecko-lines H19', 'OC widths x60: Georgia aaaa bbbb within 1e-3 of 4320; Courier New 5184', String.raw`
const g = oc('16px Georgia', 'aaaa bbbb') * 60, c = oc(CNF, 'aaaa bbbb') * 60;
check('Georgia x60', g, 4320, Math.abs(g - 4320) < 1e-3);
check('Courier New x60', c, 5184, Math.abs(c - 5184) < 1e-3);`),
  probe('gecko-lines H20', '14.4px Georgia aaaa bbbb at 64.7px: DOM 2 lines (DOM 3884 au); OC 3880 au', String.raw`
const e = divT('font:14.4px/20px Georgia;width:64.7px', 'aaaa bbbb'); const s = preSpan('14.4px Georgia', 'aaaa bbbb');
await settle();
checkStarts('DOM lines at 64.7px', e, [0, 5]);
check('DOM span au', au(bw(s)), 3884, au(bw(s)) === 3884);
const w = oc('14.4px Georgia', 'aaaa bbbb'); check('OC au', w * 60, 3880, au(w) === 3880);
const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = '14.4px Georgia'; R.raw.readback = c.font;`),
  probe('gecko-lines H21', 'Geeza Pro letter-spacing 2px span بببب == OC with letterSpacing 0.001px; OC 2px is 8px wider', String.raw`
const t = 'بببب';
const s = span(div('font:16px/30px "Geeza Pro";letter-spacing:2px'), t); await settle();
const w001 = oc('16px "Geeza Pro"', t, { letterSpacing: '0.001px' }), w2 = oc('16px "Geeza Pro"', t, { letterSpacing: '2px' });
check('DOM span == OC letterSpacing 0.001px', { dom: bw(s), oc: w001 }, 'equal', au(bw(s)) === au(w001));
check('OC 2px - OC 0.001px', w2 - w001, 8, au(w2) - au(w001) === 480);`),
  probe('gecko-lines H22', 'aaaa&shy;<span>bbbb</span> at 57.6px: aaaa- / bbbb, same as without the span', String.raw`
const H1 = 'aaaa&shy;<span style="color:red">bbbb</span>', H0 = 'aaaa&shy;bbbb';
const a = div(CN + 'width:57.6px', H1), b = div(CN + 'width:57.6px', H0);
const ar = div(CN + 'width:57.6px;text-align:right', H1), br = div(CN + 'width:57.6px;text-align:right', H0);
await settle();
checkStarts('with span', a, [0, 5]);
checkStarts('without span', b, [0, 5]);
const xa = xAt(ar, 0), xb = xAt(br, 0);
check('right-aligned x of first a with span (9.6 when the hyphen counts, 19.2 without it)', xa, 9.6, au(xa) === 576);
check('right-aligned x of first a without span', xb, 9.6, au(xb) === 576);
R.raw.shy = { withSpan: pointAt(a, 4), withoutSpan: pointAt(b, 4) };`),
  probe('gecko-lines H23', 'aaaaaaaa bb at 57.6px: line 1 extends to 76.8px; line 2 bb', String.raw`
const e = divT(CN + 'width:57.6px', 'aaaaaaaa bb'); await settle();
const ls = checkStarts('lines', e, [0, 9]);
check('line 1 right', ls[0] ? ls[0].right : null, 76.8, ls[0] !== undefined && au(ls[0].right) === 4608);`),
  probe('gecko-lines H24', 'pre-line <span>aaaa \\n bb</span>: 2 lines; span first rect 38.4px', String.raw`
const d = div(CN + 'white-space:pre-line'); const s = span(d, 'aaaa \n bb'); await settle();
checkStarts('lines', d, [0, 7]);
const r = s.getClientRects(); const w = r.length > 0 ? r[0].width : null;
check('span first rect width', w, 38.4, au(w) === 2304);
R.raw.rects = Array.from(r, q => q.width);`),
]

// ---- gecko-canvas §5 ----

const canvasProbes: Probe[] = [
  probe('gecko-canvas H1', 'OC 16px Georgia sentence width x60 is an integer within 1e-3 (at DPR 2 and DPR 1)', String.raw`
const w = oc('16px Georgia', 'Hello, world. Quick brown fox.');
check('OC x60 integer', w * 60, 'integer within 1e-3', Math.abs(w * 60 - Math.round(w * 60)) < 1e-3);
R.raw.width = w; R.raw.apd = Math.round(60 / devicePixelRatio);`),
  probe('gecko-canvas H2', 'EC 16px Georgia at DPR 2: width x30 integer, x60 never odd for 50 words; |EC - OC| <= n/60', String.raw`
const words = ${JSON.stringify(H2_WORDS)};
const rows = []; let int30 = true, even = true, within = true, maxExcess = 0;
for (const word of words) {
  const e = ec('16px Georgia', word), o = oc('16px Georgia', word), n = [...word].length;
  if (Math.abs(e * 30 - Math.round(e * 30)) >= 1e-3) int30 = false;
  if (Math.round(e * 60) % 2 !== 0) even = false;
  if (Math.abs(e - o) > n / 60 + 1e-9) { within = false; maxExcess = Math.max(maxExcess, Math.abs(e - o) - n / 60); }
  rows.push([word, e, o]);
}
check('EC width x30 integer for every word', int30, true, int30);
check('EC width x60 never odd', even, true, even);
check('|EC - OC| <= n/60 px', { within, maxExcess, equalCount: rows.filter(r => au(r[1]) === au(r[2])).length, words: rows.length }, true, within);
R.raw.rows = rows;`),
  probe('gecko-canvas H3', 'OC font 13.33px Arial reads back 13.375px Arial; EC reads back 13.33px Arial', String.raw`
const o = new OffscreenCanvas(1, 1).getContext('2d'); o.font = '13.33px Arial';
const e = ctx2d('ec'); e.font = '13.33px Arial';
check('OC readback', o.font, '13.375px Arial', o.font === '13.375px Arial');
check('EC readback', e.font, '13.33px Arial', e.font === '13.33px Arial');
const sizes = ['13.33px', '13.3px', '12.1px', '10.01px', '16.8px', '14.4px', '13.375px', '6.665px', '100.33px', '1.2em', '120%'];
R.raw.readbacks = sizes.map(s => { const o2 = new OffscreenCanvas(1, 1).getContext('2d'); o2.font = s + ' Arial'; const e2 = ctx2d('ec'); e2.font = s + ' Arial'; return { set: s, oc: o2.font, ec: e2.font }; });`),
  probe('gecko-canvas H3b', 'Follow-up to H3: DOM font-size is Servo quantize_font_size (10 significant bits) before app units, so 16.8px lays out at 16.8125px (1009 au), like 16.8166667px', String.raw`
const sizes = ['13.33px', '16.8px', '16.81px', '16.8166667px', '16.79px', '14.4px', '10.01px', '100.33px', '6.665px'];
const t = 'm'.repeat(60);
const els = sizes.map(s => preSpan(s + ' Georgia', t));
await settle();
const q10 = x => { const f = Math.fround; const v = f(x); const d = f(v * 16385); const r = f(d - v); return f(d - r); };
const rows = sizes.map((s, i) => ({ set: s, computed: getComputedStyle(els[i]).fontSize, q10: q10(Number.parseFloat(s)), au: au(bw(els[i])) }));
R.raw.rows = rows;
check('computed font-size == 10-bit quantized size', rows.map(r => [r.set, r.computed, r.q10]), 'computed == q10', rows.every(r => Math.abs(Number.parseFloat(r.computed) - r.q10) < 1e-4));
pre('60 m at 16.79px and 16.8166667px differ', { au1679: rows[4].au, au168166: rows[3].au }, 'different', rows[4].au !== rows[3].au);
check('DOM 16.8px == DOM 16.8166667px (1009 au size after quantization; 1008 vs 1009 without)', { au168: rows[1].au, au168166: rows[3].au, au1681: rows[2].au }, 'equal', rows[1].au === rows[3].au && rows[1].au === rows[2].au);`),
  probe('gecko-canvas H4','13.375px Georgia: DOM - OC in (0.3, 1.2) px; 13.5px: DOM x60 == OC x60', String.raw`
const t = 'The quick brown fox jumps over the lazy dog. '.repeat(4);
const s1 = preSpan('13.375px Georgia', t), s2 = preSpan('13.5px Georgia', t);
await settle();
const o1 = oc('13.375px Georgia', t), o2 = oc('13.5px Georgia', t);
check('13.375px DOM - OC', { diff: bw(s1) - o1, dom: bw(s1), oc: o1 }, '0.3 < diff < 1.2', bw(s1) - o1 > 0.3 && bw(s1) - o1 < 1.2);
check('13.5px DOM x60 == OC x60', { dom: bw(s2) * 60, oc: o2 * 60 }, 'equal', au(bw(s2)) === au(o2));`),
  probe('gecko-canvas H5', 'OC 😀 at 10..28px Helvetica Neue: 13,16,19,21,23,25,28; DOM at DPR 2: 11.5,12.5,14,16,20,24,28; DOM at DPR 1 == OC', String.raw`
const sizes = [10, 12, 14, 16, 20, 24, 28];
const ocExp = { 10: 13, 12: 16, 14: 19, 16: 21, 20: 23, 24: 25, 28: 28 }, dom2 = { 10: 11.5, 12: 12.5, 14: 14, 16: 16, 20: 20, 24: 24, 28: 28 };
const spans = {}; for (const n of sizes) spans[n] = preSpan(n + 'px "Helvetica Neue"', '\u{1F600}');
await settle();
const ocm = {}, domm = {}; for (const n of sizes) { ocm[n] = oc(n + 'px "Helvetica Neue"', '\u{1F600}'); domm[n] = bw(spans[n]); }
check('OC widths', ocm, ocExp, sizes.every(n => au(ocm[n]) === ocExp[n] * 60));
const dpr = devicePixelRatio;
if (dpr === 2) check('DOM widths at DPR 2', domm, dom2, sizes.every(n => au(domm[n]) === au(dom2[n])));
else if (dpr === 1) check('DOM widths at DPR 1 equal OC', domm, ocm, sizes.every(n => au(domm[n]) === au(ocm[n])));
else R.raw.dom = domm;`),
  probe('gecko-canvas H6', 'OC 24px 😀 = 25, /2 = 12.5 = DOM 12px at DPR 2; OC 32px / 2 = 16 = DOM 16px', String.raw`
const s12 = preSpan('12px "Helvetica Neue"', '\u{1F600}'), s16 = preSpan('16px "Helvetica Neue"', '\u{1F600}');
await settle();
const o24 = oc('24px "Helvetica Neue"', '\u{1F600}'), o32 = oc('32px "Helvetica Neue"', '\u{1F600}');
check('OC 24px', o24, 25, au(o24) === 1500);
check('OC 24px / 2 == DOM 12px == 12.5', { half: o24 / 2, dom: bw(s12) }, 12.5, au(o24 / 2) === au(bw(s12)) && au(bw(s12)) === 750);
check('OC 32px / 2 == DOM 16px == 16', { half: o32 / 2, dom: bw(s16) }, 16, au(o32 / 2) === au(bw(s16)) && au(bw(s16)) === 960);`),
  probe('gecko-canvas H7', 'EC 12px 😀 at DPR 2 gives 16, not 12.5', String.raw`
const w = ec('12px "Helvetica Neue"', '\u{1F600}'); check('EC 12px', w, 16, au(w) === 960);`),
  probe('gecko-canvas H8', '14px -apple-system pangram: OC < DOM < EC; DOM with font-optical-sizing none x60 == OC x60', String.raw`
const t = 'The quick brown fox jumps over the lazy dog';
const s1 = preSpan('14px -apple-system', t), s2 = preSpan('14px -apple-system', t, 'font-optical-sizing:none');
await settle();
const o = oc('14px -apple-system', t), e = ec('14px -apple-system', t), dm = bw(s1), dn = bw(s2);
check('OC < DOM < EC', { oc: o, dom: dm, ec: e }, 'oc < dom < ec', o < dm && dm < e);
check('DOM font-optical-sizing none == OC', { dom: dn, oc: o }, 'equal', au(dn) === au(o));`),
  probe('gecko-canvas H9', 'ja page: OC sans-serif == DOM span without lang; after root lang=zh-CN the next OC == DOM lang=zh-CN; span zh-CN not followed unless ctx.lang', String.raw`
document.documentElement.setAttribute('lang', 'ja');
const T = ['直直直', 'abc直'];
const mk = (t, lang) => { const s = preSpan('16px sans-serif', t); if (lang) s.setAttribute('lang', lang); return s; };
const noLang = T.map(t => mk(t)), zh = T.map(t => mk(t, 'zh-CN'));
await settle();
const domNo = noLang.map(bw), domZh = zh.map(bw);
const ctx = new OffscreenCanvas(1, 1).getContext('2d'); ctx.font = '16px sans-serif';
const ocJa = T.map(t => ctx.measureText(t).width);
document.documentElement.setAttribute('lang', 'zh-CN');
const ocAfter = T.map(t => ctx.measureText(t).width);
document.documentElement.setAttribute('lang', 'ja');
const ocBack = T.map(t => ctx.measureText(t).width);
const ocExplicit = T.map(t => oc('16px sans-serif', t, { lang: 'zh-CN' }));
R.raw = { domNo, domZh, ocJa, ocAfter, ocBack, ocExplicit };
for (let i = 0; i < T.length; i++) {
  const discriminating = au(domNo[i]) !== au(domZh[i]);
  check(T[i] + ': OC in ja page == DOM span without lang', { oc: ocJa[i], dom: domNo[i], discriminating }, 'equal', au(ocJa[i]) === au(domNo[i]));
  check(T[i] + ': OC after root lang=zh-CN == DOM span lang=zh-CN', { oc: ocAfter[i], dom: domZh[i], discriminating }, 'equal', au(ocAfter[i]) === au(domZh[i]));
  check(T[i] + ': span-level zh-CN followed only with ctx.lang', { ocBackInJa: ocBack[i], ocCtxLang: ocExplicit[i], domZh: domZh[i], discriminating }, 'ocBack != domZh (when discriminating), ocCtxLang == domZh', (!discriminating || au(ocBack[i]) !== au(domZh[i])) && au(ocExplicit[i]) === au(domZh[i]));
}`, { pageLang: 'ja' }),
  probe('gecko-canvas H10', 'Worker OC without ctx.lang, 16px sans-serif 直 follows the OS locale (zh-Hans here), not the page (ja)', String.raw`
const T = ['直', 'abc直', '骨直'];
const wk = await workerMeasure(T.map(t => ({ font: '16px sans-serif', text: t })));
const r3 = v => Math.round(v * 1000) / 1000;
const box = m => [r3(m.width), r3(m.actualBoundingBoxLeft), r3(m.actualBoundingBoxRight)];
const main = {}; for (const lang of ['zh-CN', 'zh-TW', 'ja', 'ko', 'en']) main[lang] = T.map(t => box(measureWith('oc', '16px sans-serif', t, { lang })));
const root = T.map(t => box(measureWith('oc', '16px sans-serif', t)));
const wbox = wk.second.map(m => [r3(m.w), r3(m.l), r3(m.r)]);
R.raw = { worker: wbox, workerFirst: wk.first, main, rootJa: root, navigatorLanguages: [...navigator.languages], intlLocale: new Intl.DateTimeFormat().resolvedOptions().locale };
for (let i = 0; i < T.length; i++) {
  const discriminating = !same(main['zh-CN'][i], root[i]);
  const matches = Object.keys(main).filter(k => same(main[k][i], wbox[i]));
  check(T[i] + ': worker width and glyph box == ctx.lang zh-CN, != page ja', { worker: wbox[i], zhCN: main['zh-CN'][i], pageJa: root[i], matches, discriminating }, 'worker == zh-CN, != ja', same(wbox[i], main['zh-CN'][i]) && (!discriminating || !same(wbox[i], root[i])));
}`, { pageLang: 'ja' }),
  probe('gecko-canvas H11', 'OC 16px Georgia: a\\tb, a\\nb, a\\vb, a\\fb, a\\rb, a U+0085 b, a U+2029 b all == a b; a  b == a b + space', String.raw`
const F = '16px Georgia'; const base = oc(F, 'a b');
const strs = [['\\t', 'a\tb'], ['\\n', 'a\nb'], ['\\v', 'a\vb'], ['\\f', 'a\fb'], ['\\r', 'a\rb'], ['U+0085', 'ab'], ['U+2029', 'a b']];
const widths = {}; let all = true;
for (const [n, t] of strs) { widths[n] = oc(F, t); if (au(widths[n]) !== au(base)) all = false; }
check('each == a b', { base, widths }, 'all equal', all);
const two = oc(F, 'a  b'), sp = oc(F, ' ');
check('a  b == a b + space', { two, base, space: sp }, 'two == base + space', au(two) === au(base) + au(sp));`),
  probe('gecko-canvas H12', 'OC a U+0001 b > ab; EC a U+0001 b == ab; DOM textContent a U+0001 b == ab', String.raw`
const F = '16px Georgia';
const s1 = preSpan(F, 'ab'), s2 = preSpan(F, 'ab'); await settle();
const o1 = oc(F, 'ab'), o2 = oc(F, 'ab'), e1 = ec(F, 'ab'), e2 = ec(F, 'ab');
check('OC hexbox wider', { withControl: o1, ab: o2 }, 'greater', o1 > o2);
check('EC equal', { withControl: e1, ab: e2 }, 'equal', au(e1) === au(e2));
check('DOM equal', { withControl: bw(s1), ab: bw(s2) }, 'equal', au(bw(s1)) === au(bw(s2)));`),
  probe('gecko-canvas H13', '18px Arial: OC A LRM V == OC A + OC V; EC A LRM V == EC AV; DOM A&lrm;V == DOM AV', String.raw`
const F = '18px Arial';
const d1 = htmlSpan('font:' + F + ';white-space:pre', '<span>A&lrm;V</span>'), d2 = htmlSpan('font:' + F + ';white-space:pre', '<span>AV</span>');
await settle();
const A = oc(F, 'A'), V = oc(F, 'V'), AV = oc(F, 'AV'), ALV = oc(F, 'A‎V');
pre('OC AV is kerned', { AV, sum: A + V }, 'AV < A + V', au(AV) < au(A) + au(V));
check('OC A LRM V == A + V', { ALV, sum: A + V }, 'equal', au(ALV) === au(A) + au(V));
const eALV = ec(F, 'A‎V'), eAV = ec(F, 'AV');
check('EC A LRM V == EC AV', { ALV: eALV, AV: eAV }, 'equal', au(eALV) === au(eAV));
check('DOM A&lrm;V == DOM AV', { ALV: bw(d1), AV: bw(d2) }, 'equal', au(bw(d1)) === au(bw(d2)));`),
  probe('gecko-canvas H14', '24px Hoefler Text fi: OC letterSpacing 0.001px wider than 0px; DOM letter-spacing 0.001px == 0', String.raw`
const F = '24px "Hoefler Text"';
const s0 = preSpan(F, 'fi'), s1 = preSpan(F, 'fi', 'letter-spacing:0.001px'); await settle();
const o0 = oc(F, 'fi', { letterSpacing: '0px' }), o1 = oc(F, 'fi', { letterSpacing: '0.001px' });
check('OC 0.001px > 0px', { ls0: o0, ls001: o1 }, 'greater', o1 > o0);
check('DOM 0.001px == 0', { ls0: bw(s0), ls001: bw(s1) }, 'equal', au(bw(s0)) === au(bw(s1)));`),
  probe('gecko-canvas H15', '24px Geeza Pro بيت: OC letterSpacing 2px - 0.001px = 6px; DOM letter-spacing 2px - 0 = 0', String.raw`
const F = '24px "Geeza Pro"', t = 'بيت';
const s0 = preSpan(F, t), s2 = preSpan(F, t, 'letter-spacing:2px'); await settle();
const o2 = oc(F, t, { letterSpacing: '2px' }), o001 = oc(F, t, { letterSpacing: '0.001px' });
check('OC 2px - 0.001px', o2 - o001, 6, au(o2) - au(o001) === 360);
check('DOM 2px - 0', bw(s2) - bw(s0), 0, au(bw(s2)) === au(bw(s0)));`),
  probe('gecko-canvas H16', '16px Georgia: OC wordSpacing 10px: a NBSP b +0, a U+3000 b +10; DOM word-spacing 10px: NBSP +10, U+3000 +0', String.raw`
const F = '16px Georgia';
const nb0 = oc(F, 'a b'), nb10 = oc(F, 'a b', { wordSpacing: '10px' }), id0 = oc(F, 'a　b'), id10 = oc(F, 'a　b', { wordSpacing: '10px' });
const dn0 = preSpan(F, 'a b'), dn10 = preSpan(F, 'a b', 'word-spacing:10px'), di0 = preSpan(F, 'a　b'), di10 = preSpan(F, 'a　b', 'word-spacing:10px');
await settle();
check('OC NBSP +0', nb10 - nb0, 0, au(nb10) === au(nb0));
check('OC U+3000 +10', id10 - id0, 10, au(id10) - au(id0) === 600);
check('DOM NBSP +10', bw(dn10) - bw(dn0), 10, au(bw(dn10)) - au(bw(dn0)) === 600);
check('DOM U+3000 +0', bw(di10) - bw(di0), 0, au(bw(di10)) === au(bw(di0)));`),
  probe('gecko-canvas H17', 'OC 12px Georgia Hello world: textRendering optimizeSpeed == geometricPrecision', String.raw`
const a = measureWith('oc', '12px Georgia', 'Hello world', { textRendering: 'optimizeSpeed' }).width, b = measureWith('oc', '12px Georgia', 'Hello world', { textRendering: 'geometricPrecision' }).width;
const c = new OffscreenCanvas(1, 1).getContext('2d'); c.textRendering = 'optimizeSpeed'; R.raw.readback = c.textRendering;
check('identical', { optimizeSpeed: a, geometricPrecision: b }, 'equal', a === b);`),
  probe('gecko-canvas H18', '16px Hiragino Sans 「直」。: OC fontKerning normal != auto; none == auto', String.raw`
const F = '16px "Hiragino Sans"', t = '「直」。';
const n = oc(F, t, { fontKerning: 'normal' }), a = oc(F, t, { fontKerning: 'auto' }), z = oc(F, t, { fontKerning: 'none' });
check('normal != auto', { normal: n, auto: a }, 'different', au(n) !== au(a));
check('none == auto', { none: z, auto: a }, 'equal', au(z) === au(a));`),
  probe('gecko-canvas H19', '18px Arial OC: A V == A + space + V and A NBSP V == A + NBSP + V in x60 integers', String.raw`
const F = '18px Arial';
const s = au(oc(F, 'A V')), s3 = au(oc(F, 'A')) + au(oc(F, ' ')) + au(oc(F, 'V'));
const n = au(oc(F, 'A V')), n3 = au(oc(F, 'A')) + au(oc(F, ' ')) + au(oc(F, 'V'));
check('A V', { whole: s, sum: s3 }, 'equal', s === s3);
check('A NBSP V', { whole: n, sum: n3 }, 'equal', n === n3);`),
  probe('gecko-canvas H20', 'OC direction ltr 18px Arial: abc אבג def == abc  + אבג +  def in x60 integers', String.raw`
const F = '18px Arial', L = { direction: 'ltr' };
const whole = au(oc(F, 'abc אבג def', L)), parts = [au(oc(F, 'abc ', L)), au(oc(F, 'אבג', L)), au(oc(F, ' def', L))];
check('whole == sum of runs', { whole, parts }, 'equal', whole === parts[0] + parts[1] + parts[2]);`),
  probe('gecko-canvas H21', 'EC at 110% zoom on DPR 2 (apd 27): widths x27 integers; OC unchanged from 100% (compared across runs)', String.raw`
const F = '16px Georgia', T = ['Hello, world. Quick brown fox.', 'aaaa bbbb', 'typography', 'Waffle', 'quick'];
const apd = Math.round(60 / devicePixelRatio);
const ecw = T.map(t => ec(F, t)), ocw = T.map(t => oc(F, t));
R.raw = { apd, texts: T, ec: ecw, oc: ocw };
check('EC widths x apd are integers', { apd, scaled: ecw.map(w => w * apd) }, 'integers', ecw.every(w => Math.abs(w * apd - Math.round(w * apd)) < 1e-3));
check('OC widths x60 are integers', ocw.map(w => w * 60), 'integers', ocw.every(w => Math.abs(w * 60 - Math.round(w * 60)) < 1e-3));`),
  probe('gecko-canvas H22', '18px Arial: OC AV <= OC A SHY V <= OC A + OC V; DOM A&shy;V == DOM AV', String.raw`
const F = '18px Arial';
const d1 = htmlSpan('font:' + F + ';white-space:pre', '<span>A&shy;V</span>'), d2 = htmlSpan('font:' + F + ';white-space:pre', '<span>AV</span>');
await settle();
const shy = au(oc(F, 'A­V')), AV = au(oc(F, 'AV')), sum = au(oc(F, 'A')) + au(oc(F, 'V'));
check('OC AV <= A SHY V <= A + V', { shy, AV, sum }, 'AV <= shy <= sum', AV <= shy && shy <= sum);
check('DOM A&shy;V == AV', { shy: bw(d1), AV: bw(d2) }, 'equal', au(bw(d1)) === au(bw(d2)));`),
  probe('gecko-canvas H23', '10,000 corpus words at 16px Georgia: DOM x60 - OC x60 == 0 for >= 99.9%, never beyond +-glyph count', String.raw`
const WORDS = ${JSON.stringify(WORDS)};
const COUNTS = ${JSON.stringify(COUNTS)};
const d = div('font:16px Georgia;white-space:pre');
const spans = WORDS.map(w => { const s = document.createElement('span'); s.textContent = w; d.append(s, '\n'); return s; });
await settle();
const ctx = new OffscreenCanvas(1, 1).getContext('2d'); ctx.font = '16px Georgia';
let zero = 0, zeroTokens = 0, tokens = 0, exceed = 0; const nonzero = [];
for (let i = 0; i < WORDS.length; i++) {
  const dom = au(bw(spans[i])), o = au(ctx.measureText(WORDS[i]).width), diff = dom - o;
  tokens += COUNTS[i];
  if (diff === 0) { zero++; zeroTokens += COUNTS[i]; } else nonzero.push([WORDS[i], dom, o]);
  if (Math.abs(diff) > [...WORDS[i]].length) exceed++;
}
check('DOM au == OC au share of distinct words', { words: WORDS.length, zero, share: zero / WORDS.length, tokens, zeroTokenShare: zeroTokens / tokens }, '>= 0.999', zero / WORDS.length >= 0.999);
check('|DOM - OC| <= glyph count', exceed, 0, exceed === 0);
R.raw.nonzeroCount = nonzero.length; R.raw.nonzero = nonzero.slice(0, 40);`),
  probe('gecko-canvas H24b', 'lang zh, Hiragino Sans, width 1px, ぁぁぁぁ: line-break normal breaks between small kana; auto does not', String.raw`
const t = 'ぁぁぁぁ';
const a = divT('font:16px/20px "Hiragino Sans";width:1px;line-break:normal', t), b = divT('font:16px/20px "Hiragino Sans";width:1px;line-break:auto', t);
a.setAttribute('lang', 'zh'); b.setAttribute('lang', 'zh');
await settle();
checkStarts('line-break normal', a, [0, 1, 2, 3]);
checkStarts('line-break auto', b, [0]);`),
  probe('gecko-canvas H25', '16px Georgia aaaa&shy;bbbb broken at the SHY: line width == OC aaaa + OC U+2010 if Georgia has U+2010, else OC aaaa-', String.raw`
const F = '16px Georgia';
const hyphenSerif = oc('16px Georgia, serif', '‐'), hyphenMono = oc('16px Georgia, monospace', '‐');
// Canvas can't tell whether Georgia maps U+2010: U+2010 measures the same whichever generic follows Georgia. Georgia's
// cmap (format 4 subtable, read offline) has no U+2010, so the hypothesis expects OC 'aaaa-'.
const hasU2010 = false;
const wAaaa = oc(F, 'aaaa'), wHyphen = oc(F, '‐'), wMinus = oc(F, 'aaaa-');
const width = Math.ceil(Math.max(wAaaa + wHyphen, wMinus) + 6);
const d = div('font:16px/20px Georgia;width:' + width + 'px', '<span>aaaa&shy;bbbb</span>');
const dr = div('font:16px/20px Georgia;text-align:right;width:' + width + 'px', 'aaaa&shy;bbbb');
await settle();
checkStarts('break at the SHY', d, [0, 5]);
const r = d.firstElementChild.getClientRects(); const lineW = r.length > 0 ? r[0].width : null;
const expected = hasU2010 ? wAaaa + wHyphen : wMinus;
check('line width', { spanFirstRect: lineW, rightAlignedWidth: width - xAt(dr, 0), georgiaMapsU2010: hasU2010, u2010WithSerifFallback: hyphenSerif, u2010WithMonospaceFallback: hyphenMono, ocAaaaPlusU2010: wAaaa + wHyphen, ocAaaaMinus: wMinus }, expected, au(lineW) === au(expected) && au(width - xAt(dr, 0)) === au(expected));`),
]

// ---- gecko-text §18 ----

const textProbes: Probe[] = [
  probe('gecko-text H1', '<b>foo</b>bar at 1px: 1 line', String.raw`
const e = div(HN + 'width:1px', '<b>foo</b>bar'); await settle(); checkStarts('lines', e, [0]);`),
  probe('gecko-text H2', 'foo<b> </b>bar at 1px: 2 lines', String.raw`
const e = div(HN + 'width:1px', 'foo<b> </b>bar'); await settle(); checkStarts('lines', e, [0, 4]);`),
  probe('gecko-text H3', '32px Arial: <span>A<span color>V</span></span> == <span>AV</span> < A + V', String.raw`
const F = 'font:32px Arial;white-space:nowrap';
const a = htmlSpan(F, '<span>A<span style="color:red">V</span></span>'), av = htmlSpan(F, '<span>AV</span>'), A = htmlSpan(F, '<span>A</span>'), V = htmlSpan(F, '<span>V</span>');
await settle();
check('color span == AV', { colorSpan: bw(a), AV: bw(av) }, 'equal', au(bw(a)) === au(bw(av)));
check('AV < A + V', { AV: bw(av), sum: bw(A) + bw(V) }, 'less', au(bw(av)) < au(bw(A)) + au(bw(V)));`),
  probe('gecko-text H4', '32px Arial: vertical-align 1px == A + V; padding-left 0.001px == kerned AV; padding-left 0.01px == A + V + 1/60', String.raw`
const F = 'font:32px Arial;white-space:nowrap';
const va = htmlSpan(F, '<span>A<span style="vertical-align:1px">V</span></span>'), p001 = htmlSpan(F, '<span>A<span style="padding-left:0.001px">V</span></span>'), p01 = htmlSpan(F, '<span>A<span style="padding-left:0.01px">V</span></span>');
const av = htmlSpan(F, '<span>AV</span>'), A = htmlSpan(F, '<span>A</span>'), V = htmlSpan(F, '<span>V</span>');
await settle();
const sum = au(bw(A)) + au(bw(V));
pre('AV kerned', { AV: au(bw(av)), sum }, 'less', au(bw(av)) < sum);
check('vertical-align:1px', { width: au(bw(va)), sum }, 'A + V', au(bw(va)) === sum);
check('padding-left:0.001px', { width: au(bw(p001)), AV: au(bw(av)) }, 'kerned AV', au(bw(p001)) === au(bw(av)));
check('padding-left:0.01px', { width: au(bw(p01)), sum }, 'A + V + 1 au', au(bw(p01)) === sum + 1);`),
  probe('gecko-text H5', '32px Arial: A<b>V</b> == A regular + V bold', String.raw`
const F = 'font:32px Arial;white-space:nowrap';
const ab = htmlSpan(F, '<span>A<b>V</b></span>'), A = htmlSpan(F, '<span>A</span>'), V = htmlSpan(F, '<span><b>V</b></span>');
await settle();
check('A<b>V</b> == A + bold V', { width: au(bw(ab)), sum: au(bw(A)) + au(bw(V)) }, 'equal', au(bw(ab)) === au(bw(A)) + au(bw(V)));`),
  probe('gecko-text H6', '32px Arial: letter-spacing 0.001px on V == kerned AV; 0.01px == A + V + 1/60', String.raw`
const F = 'font:32px Arial;white-space:nowrap';
const l001 = htmlSpan(F, '<span>A<span style="letter-spacing:0.001px">V</span></span>'), l01 = htmlSpan(F, '<span>A<span style="letter-spacing:0.01px">V</span></span>');
const av = htmlSpan(F, '<span>AV</span>'), A = htmlSpan(F, '<span>A</span>'), V = htmlSpan(F, '<span>V</span>');
await settle();
const sum = au(bw(A)) + au(bw(V));
check('letter-spacing:0.001px', { width: au(bw(l001)), AV: au(bw(av)) }, 'kerned AV', au(bw(l001)) === au(bw(av)));
check('letter-spacing:0.01px', { width: au(bw(l01)), sum }, 'A + V + 1 au', au(bw(l01)) === sum + 1);`),
  probe('gecko-text H7', 'width 1px: foo NBSP bar 1 line; foo ZWSP bar 2 lines', String.raw`
const a = divT(HN + 'width:1px', 'foo bar'), b = divT(HN + 'width:1px', 'foo​bar'); await settle();
checkStarts('NBSP', a, [0]); checkStarts('ZWSP', b, [0, 4]);`),
  probe('gecko-text H8', 'width 1px: ( word and « word give 2 lines, the first ( or «', String.raw`
const a = divT(HN + 'width:1px', '( word'), b = divT(HN + 'width:1px', '« word'); await settle();
checkStarts('( word', a, [0, 2]); checkStarts('« word', b, [0, 2]);`),
  probe('gecko-text H9', 'a\\fb, a\\vb, a\\rb: 2 lines at 1px; 1 line at 500px with width == ab', String.raw`
const T = [['a\\fb', 'a\fb'], ['a\\vb', 'a\vb'], ['a\\rb', 'a\rb']];
const narrow = T.map(([, t]) => divT(HN + 'width:1px', t)), wide = T.map(([, t]) => divT(HN + 'width:500px', '')), spans = T.map(([, t], i) => span(wide[i], t));
const ab = span(div(HN + 'width:500px'), 'ab');
await settle();
T.forEach(([n], i) => { checkStarts(n + ' at 1px', narrow[i], [0, 2]); checkStarts(n + ' at 500px', wide[i], [0]); check(n + ' width == ab', { width: bw(spans[i]), ab: bw(ab) }, 'equal', au(bw(spans[i])) === au(bw(ab))); });`),
  probe('gecko-text H10', 'a \\r b at 500px: width == pre a  b == a + 2 spaces + b', String.raw`
const s = span(div(HN + 'width:500px'), 'a \r b'), p = preSpan(HNF, 'a  b'), a = preSpan(HNF, 'a'), sp = preSpan(HNF, ' '), b = preSpan(HNF, 'b');
await settle();
check('a \\r b == pre a  b', { width: bw(s), pre: bw(p) }, 'equal', au(bw(s)) === au(bw(p)));
check('pre a  b == a + 2 space + b', { pre: au(bw(p)), sum: au(bw(a)) + 2 * au(bw(sp)) + au(bw(b)) }, 'equal', au(bw(p)) === au(bw(a)) + 2 * au(bw(sp)) + au(bw(b)));`),
  probe('gecko-text H11', 'DOM a U+0001 b == ab; OC a U+0001 b > ab; EC equal', String.raw`
const s1 = span(div(HN + 'width:500px'), 'ab'), s2 = span(div(HN + 'width:500px'), 'ab'); await settle();
check('DOM equal', { withControl: bw(s1), ab: bw(s2) }, 'equal', au(bw(s1)) === au(bw(s2)));
check('OC greater', { withControl: oc(HNF, 'ab'), ab: oc(HNF, 'ab') }, 'greater', oc(HNF, 'ab') > oc(HNF, 'ab'));
check('EC equal', { withControl: ec(HNF, 'ab'), ab: ec(HNF, 'ab') }, 'equal', au(ec(HNF, 'ab')) === au(ec(HNF, 'ab')));`),
  probe('gecko-text H12', 'PingFang SC: <span>日本\\n語</span> == 日本語; <span>abc\\n日本</span> == abc 日本', String.raw`
const PF = 'font:16px/20px "PingFang SC";width:500px';
const a = htmlSpan(PF, '<span>日本\n語</span>'), aRef = htmlSpan(PF, '<span>日本語</span>'), aSp = htmlSpan(PF, '<span>日本 語</span>');
const b = htmlSpan(PF, '<span>abc\n日本</span>'), bRef = htmlSpan(PF, '<span>abc 日本</span>'), bNo = htmlSpan(PF, '<span>abc日本</span>');
await settle();
check('日本\\n語 == 日本語', { width: bw(a), noSpace: bw(aRef), space: bw(aSp) }, 'noSpace', au(bw(a)) === au(bw(aRef)) && au(bw(aRef)) !== au(bw(aSp)));
check('abc\\n日本 == abc 日本', { width: bw(b), space: bw(bRef), noSpace: bw(bNo) }, 'space', au(bw(b)) === au(bw(bRef)) && au(bw(bRef)) !== au(bw(bNo)));`),
  probe('gecko-text H13', 'PingFang SC: <span>日本\\n<span>語</span></span> == 日本 語; <span><span>日本</span>\\n語</span> == 日本 語', String.raw`
const PF = 'font:16px/20px "PingFang SC";width:500px';
const a = htmlSpan(PF, '<span>日本\n<span>語</span></span>'), b = htmlSpan(PF, '<span><span>日本</span>\n語</span>');
const sp = htmlSpan(PF, '<span>日本 語</span>'), no = htmlSpan(PF, '<span>日本語</span>');
await settle();
check('日本\\n<span>語</span>', { width: bw(a), space: bw(sp), noSpace: bw(no) }, 'space', au(bw(a)) === au(bw(sp)) && au(bw(sp)) !== au(bw(no)));
check('<span>日本</span>\\n語', { width: bw(b), space: bw(sp), noSpace: bw(no) }, 'space', au(bw(b)) === au(bw(sp)));`),
  probe('gecko-text H14', 'p lang=ja: 。\\na == 。a; p lang=en: 。\\na == 。 a', String.raw`
const mk = (lang, html) => { const d = div(HN + 'width:500px', html); d.setAttribute('lang', lang); return d.firstElementChild; };
const ja = mk('ja', '<span>。\na</span>'), ja0 = mk('ja', '<span>。a</span>'), ja1 = mk('ja', '<span>。 a</span>');
const en = mk('en', '<span>。\na</span>'), en0 = mk('en', '<span>。a</span>'), en1 = mk('en', '<span>。 a</span>');
await settle();
check('lang ja', { width: bw(ja), noSpace: bw(ja0), space: bw(ja1) }, 'noSpace', au(bw(ja)) === au(bw(ja0)) && au(bw(ja0)) !== au(bw(ja1)));
check('lang en', { width: bw(en), noSpace: bw(en0), space: bw(en1) }, 'space', au(bw(en)) === au(bw(en1)) && au(bw(en0)) !== au(bw(en1)));`),
  probe('gecko-text H15', 'page without lang: <p>。\\na</p> == the lang=ja result iff the regional-prefs locale starts with zh or ja (this Mac: zh-Hans_US, so no space)', String.raw`
const d0 = div(HN + 'width:500px', '<span>。\na</span>'), r0 = div(HN + 'width:500px', '<span>。a</span>'), r1 = div(HN + 'width:500px', '<span>。 a</span>');
await settle();
const w = bw(d0.firstElementChild), no = bw(r0.firstElementChild), sp = bw(r1.firstElementChild);
R.raw = { hasLang: document.documentElement.hasAttribute('lang'), navigatorLanguages: [...navigator.languages], intlLocale: new Intl.DateTimeFormat().resolvedOptions().locale };
check('no lang: equals the ja result (no space)', { width: w, noSpace: no, space: sp }, 'noSpace', au(w) === au(no) && au(no) !== au(sp));`, { pageLang: null }),
  probe('gecko-text H16', 'lang ja, PingFang SC, 1px, アァア: auto 2 lines (アァ, ア); normal 3; loose 3', String.raw`
const mk = lb => { const d = divT('font:16px/20px "PingFang SC";width:1px;line-break:' + lb, 'アァア'); d.setAttribute('lang', 'ja'); return d; };
const a = mk('auto'), n = mk('normal'), l = mk('loose'); await settle();
checkStarts('auto', a, [0, 2]); checkStarts('normal', n, [0, 1, 2]); checkStarts('loose', l, [0, 1, 2]);`),
  probe('gecko-text H17', 'line-break normal, 1px: ja あ〜い 3 lines; en あ〜い 2 lines; ja あ〜い う 3 lines (あ〜, い, う)', String.raw`
const mk = (lang, t) => { const d = divT(HN + 'width:1px;line-break:normal', t); d.setAttribute('lang', lang); return d; };
const a = mk('ja', 'あ〜い'), b = mk('en', 'あ〜い'), c = mk('ja', 'あ〜い う');
await settle();
checkStarts('ja あ〜い', a, [0, 1, 2]); checkStarts('en あ〜い', b, [0, 2]); checkStarts('ja あ〜い う', c, [0, 2, 4]);`),
  probe('gecko-text H18', 'keep-all at 1px: 日本語 テキスト 2 lines; 한국어 텍스트 normal 6 lines, keep-all 2', String.raw`
const j = divT(HN + 'width:1px;word-break:keep-all', '日本語 テキスト');
const kn = divT(HN + 'width:1px', '한국어 텍스트'), kk = divT(HN + 'width:1px;word-break:keep-all', '한국어 텍스트');
await settle();
checkStarts('日本語 テキスト keep-all', j, [0, 4]); checkStarts('한국어 텍스트 normal', kn, [0, 1, 2, 4, 5, 6]); checkStarts('한국어 텍스트 keep-all', kk, [0, 4]);`),
  probe('gecko-text H19', '1px: <span break-all>abc</span>def → a, b, c, def; abc<span break-all>def</span> → abc, d, e, f', String.raw`
const a = div(HN + 'width:1px', '<span style="word-break:break-all">abc</span>def'), b = div(HN + 'width:1px', 'abc<span style="word-break:break-all">def</span>');
await settle();
checkStarts('break-all span then def', a, [0, 1, 2, 3]); checkStarts('abc then break-all span', b, [0, 3, 4, 5]);`),
  probe('gecko-text H20', 'line-break anywhere, 1px, e U+0301 e U+0301: 2 lines', String.raw`
const e = divT(HN + 'width:1px;line-break:anywhere', 'éé'); await settle(); checkStarts('lines', e, [0, 2]);`),
  probe('gecko-text H21', 'co SHY op at 1px: 2 lines, first ends with a hyphen; hyphens none: 1 line; f SHY i == fi where fi is a ligature', String.raw`
const a = div(HN + 'width:1px', '<span>co&shy;op</span>'), b = div(HN + 'width:1px;hyphens:none', '<span>co&shy;op</span>');
const co = preSpan(HNF, 'co');
const fonts = ['"Helvetica Neue"', '"Hoefler Text"'];
const lig = fonts.map(f => ({ f, fsi: span(div('font:16px ' + f + ';width:500px'), 'f­i'), fi: preSpan('16px ' + f, 'fi'), f1: preSpan('16px ' + f, 'f'), i1: preSpan('16px ' + f, 'i') }));
await settle();
checkStarts('hyphens manual', a, [0, 3]);
const first = a.firstElementChild.getClientRects()[0];
check('first line ends with a visible hyphen', { firstRect: first ? first.width : null, co: bw(co) }, 'firstRect > co', first !== undefined && au(first.width) > au(bw(co)));
checkStarts('hyphens none', b, [0]);
let ligatures = 0;
for (const x of lig) {
  const has = au(bw(x.fi)) < au(bw(x.f1)) + au(bw(x.i1));
  R.raw['ligature ' + x.f] = { hasFiLigature: has, fi: bw(x.fi), f: bw(x.f1), i: bw(x.i1), fShyI: bw(x.fsi) };
  if (has) { ligatures++; check(x.f + ' f SHY i == fi', { fShyI: bw(x.fsi), fi: bw(x.fi) }, 'equal', au(bw(x.fsi)) === au(bw(x.fi))); }
}
pre('at least one probe font has an fi ligature', ligatures, '>= 1', ligatures >= 1);`),
  probe('gecko-text H22', 'pre-line a   \\n   b at 500px: 2 lines, widths a and b', String.raw`
const e = divT(HN + 'width:500px;white-space:pre-line', 'a   \n   b'), a = preSpan(HNF, 'a'), b = preSpan(HNF, 'b');
await settle();
const ls = checkStarts('lines', e, [0, 8]);
check('line widths', { lines: ls.map(l => l.right - l.left), a: bw(a), b: bw(b) }, 'a, b', ls.length === 2 && au(ls[0].right - ls[0].left) === au(bw(a)) && au(ls[1].right - ls[1].left) === au(bw(b)));`),
  probe('gecko-text H23', 'Georgia foo  then Courier New  bar: the second span width == Courier bar', String.raw`
const d = div(HN + 'width:500px', '<span style="font-family:Georgia">foo </span><span style="font-family:\'Courier New\'"> bar</span>');
const ref = preSpan('16px "Courier New"', 'bar'); await settle();
const second = d.children[1];
check('second span == Courier bar', { second: bw(second), bar: bw(ref) }, 'equal', au(bw(second)) === au(bw(ref)));`),
  probe('gecko-text H24', '48px Geeza Pro: ب<span color>ب</span> == بب; ب<span vertical-align 1px>ب</span> == 2 x ب', String.raw`
const F = 'font:48px/80px "Geeza Pro";white-space:nowrap';
const c = htmlSpan(F, '<span>ب<span style="color:red">ب</span></span>'), v = htmlSpan(F, '<span>ب<span style="vertical-align:1px">ب</span></span>');
const bb = htmlSpan(F, '<span>بب</span>'), b1 = htmlSpan(F, '<span>ب</span>');
await settle();
pre('joined بب differs from 2 x ب', { bb: bw(bb), twice: 2 * bw(b1) }, 'different', au(bw(bb)) !== 2 * au(bw(b1)));
check('color span == بب', { width: bw(c), bb: bw(bb) }, 'equal', au(bw(c)) === au(bw(bb)));
check('vertical-align span == 2 x ب', { width: bw(v), twice: 2 * bw(b1) }, 'equal', au(bw(v)) === 2 * au(bw(b1)));`),
  probe('gecko-text H25', 'lang th Thonburi 1px: ไทย) → ไทย / ); (ไทย) → (ไทย / ); ภาษาไทยง่ายนิดเดียว starts 0, 4, 7, 11', String.raw`
const mk = t => { const d = divT('font:16px/30px Thonburi;width:1px', t); d.setAttribute('lang', 'th'); return d; };
const a = mk('ไทย)'), b = mk('(ไทย)'), c = mk('ภาษาไทยง่ายนิดเดียว');
await settle();
checkStarts('ไทย)', a, [0, 3]); checkStarts('(ไทย)', b, [0, 4]); checkStarts('ภาษาไทยง่ายนิดเดียว', c, [0, 4, 7, 11]);`),
  probe('gecko-text H26', '1px: 1-2 → 1- / 2; 12 → 1 line', String.raw`
const a = divT(HN + 'width:1px', '1-2'), b = divT(HN + 'width:1px', '12'); await settle();
checkStarts('1-2', a, [0, 2]); checkStarts('12', b, [0]);`),
  probe('gecko-text H27', 'text-transform capitalize foo<b>bar</b> baz renders Foobar Baz', String.raw`
const cap = htmlSpan(HN + 'width:500px;text-transform:capitalize', '<span>foo<b>bar</b> baz</span>');
const r1 = htmlSpan(HN + 'width:500px', '<span>Foo<b>bar</b> Baz</span>'), r2 = htmlSpan(HN + 'width:500px', '<span>Foo<b>Bar</b> Baz</span>');
await settle();
R.raw.innerText = cap.parentElement.innerText;
check('width == Foo<b>bar</b> Baz, != Foo<b>Bar</b> Baz', { capitalize: bw(cap), Foobar: bw(r1), FooBar: bw(r2), innerText: cap.parentElement.innerText }, 'Foobar Baz', au(bw(cap)) === au(bw(r1)) && au(bw(r1)) !== au(bw(r2)));`),
  probe('gecko-text H28', 'nowrap p, 1px, two white-space normal spans foo  / bar baz: source reading 3 lines (foo, bar, baz); CSS reading 2', String.raw`
const e = div(HN + 'white-space:nowrap;width:1px', '<span style="white-space:normal">foo </span><span style="white-space:normal">bar baz</span>'); await settle();
checkStarts('lines (hypothesis: 3)', e, [0, 4, 8]);`),
  probe('gecko-text H29', 'OC a\\fb == a b; DOM a\\fb == ab', String.raw`
const s = span(div(HN + 'width:500px'), 'a\fb'), ab = span(div(HN + 'width:500px'), 'ab'); await settle();
check('OC a\\fb == a b', { ff: oc(HNF, 'a\fb'), space: oc(HNF, 'a b') }, 'equal', oc(HNF, 'a\fb') === oc(HNF, 'a b'));
check('DOM a\\fb == ab', { ff: bw(s), ab: bw(ab) }, 'equal', au(bw(s)) === au(bw(ab)));`),
  probe('gecko-text H30', '32px Times New Roman: OC letterSpacing 0.001px office + 6 == DOM letter-spacing 1px office', String.raw`
const F = '32px "Times New Roman"';
const s = preSpan(F, 'office', 'letter-spacing:1px'), s0 = preSpan(F, 'office'); await settle();
const o001 = oc(F, 'office', { letterSpacing: '0.001px' }), o0 = oc(F, 'office');
R.raw = { ocLs0: o0, ocLs001: o001, domLs0: bw(s0) };
check('OC 0.001px + 6 == DOM 1px', { oc: o001 + 6, dom: bw(s) }, 'equal', au(o001) + 360 === au(bw(s)));`),
  probe('gecko-text H31', 'word-spacing 10px: a NBSP b +10px; a U+3000 b +0', String.raw`
const n0 = span(div(HN + 'width:500px'), 'a b'), n10 = span(div(HN + 'width:500px;word-spacing:10px'), 'a b');
const i0 = span(div(HN + 'width:500px'), 'a　b'), i10 = span(div(HN + 'width:500px;word-spacing:10px'), 'a　b');
await settle();
check('NBSP +10', bw(n10) - bw(n0), 10, au(bw(n10)) - au(bw(n0)) === 600);
check('U+3000 +0', bw(i10) - bw(i0), 0, au(bw(i10)) === au(bw(i0)));`),
  probe('gecko-text H32', 'U+3000 x: x left edge == one ideographic-space advance', String.raw`
const e = divT(HN + 'width:500px', '　x'), p = preSpan(HNF, '　'); await settle();
const x = xAt(e, 1), sp = pointAt(e, 0);
const adv = sp && sp.rects[0] ? sp.rects[0].w : null;
check('x of x == advance of U+3000 (> 0)', { x, rectWidth: adv, preSpanWidth: bw(p) }, 'x == advance > 0', au(x) > 0 && au(x) === au(bw(p)));`),
  probe('gecko-text H33', 'abcאבג at 1px: 1 line; abc אבג DOM width == OC abc  + OC אבג (direction rtl)', String.raw`
const e = divT(HN + 'width:1px', 'abcאבג'), s = span(div(HN + 'width:500px'), 'abc אבג'); await settle();
checkStarts('abcאבג at 1px', e, [0]);
const sum = au(oc(HNF, 'abc ')) + au(oc(HNF, 'אבג', { direction: 'rtl' }));
check('DOM == OC runs', { dom: au(bw(s)), sum }, 'equal', au(bw(s)) === sum);`),
]

// ---- CRITIC §6 (gecko items) ----

const criticProbes: Probe[] = [
  probe('CRITIC C8', 'DPR 2 16px Georgia span bbb: 26.9px (1614 au) without device-pixel snapping', String.raw`
const b3 = preSpan('16px Georgia', 'bbb'), b10 = preSpan('16px Georgia', 'bbbbbbbbbb'), a10 = preSpan('16px Georgia', 'aaaaaaaaaa'); await settle();
check('bbb', bw(b3), 26.9, au(bw(b3)) === 1614);
check('bbbbbbbbbb (snapped: 5400)', au(bw(b10)), 5380, au(bw(b10)) === 5380);
check('aaaaaaaaaa (snapped: 4800)', au(bw(a10)), 4840, au(bw(a10)) === 4840);`),
  probe('CRITIC C9', 'PingFang SC: <span>日本\\n<span>語</span></span> == 日本 語; <span>日本\\n語</span> == 日本語', String.raw`
const PF = 'font:16px/20px "PingFang SC";width:500px';
const a = htmlSpan(PF, '<span>日本\n<span>語</span></span>'), b = htmlSpan(PF, '<span>日本\n語</span>');
const sp = htmlSpan(PF, '<span>日本 語</span>'), no = htmlSpan(PF, '<span>日本語</span>');
await settle();
check('across a text node: space kept', { width: bw(a), space: bw(sp), noSpace: bw(no) }, 'space', au(bw(a)) === au(bw(sp)) && au(bw(sp)) !== au(bw(no)));
check('inside one text node: removed', { width: bw(b), space: bw(sp), noSpace: bw(no) }, 'noSpace', au(bw(b)) === au(bw(no)));`),
  probe('CRITIC C12', 'fresh OC 16px Arial: a\\fb, a\\vb, a\\rb === a b', String.raw`
const base = oc('16px Arial', 'a b'); const m = { ff: oc('16px Arial', 'a\fb'), vt: oc('16px Arial', 'a\vb'), cr: oc('16px Arial', 'a\rb') };
check('all === a b', { base, m }, 'equal', m.ff === base && m.vt === base && m.cr === base);`),
  probe('CRITIC C13', 'OC 40px Hoefler Text letterSpacing 1px fi == W(f) + W(i) + 2', String.raw`
const F = '40px "Hoefler Text"';
const fi0 = oc(F, 'fi'), f = oc(F, 'f'), i = oc(F, 'i'), fi1 = oc(F, 'fi', { letterSpacing: '1px' });
pre('fi ligature at letterSpacing 0', { fi: fi0, sum: f + i }, 'fi < f + i', au(fi0) < au(f) + au(i));
check('letterSpacing 1px fi == f + i + 2', { fi: fi1, sum: f + i + 2 }, 'equal', au(fi1) === au(f) + au(i) + 120);`),
  probe('CRITIC C14', 'text-transform full-width, 1px, Hiragino Sans, ab: Firefox 1 line', String.raw`
const e = divT('font:16px/20px "Hiragino Sans";width:1px;text-transform:full-width', 'ab'); await settle();
checkStarts('lines', e, [0]);`),
  probe('CRITIC W3', 'Courier New normal 57.6px, aaaa \\vbbbbb: VT kept at the start of line 2 with zero width', String.raw`
const e = divT(CN + 'width:57.6px', 'aaaa \vbbbbb'), er = divT(CN + 'width:57.6px;text-align:right', 'aaaa \vbbbbb'); await settle();
R.raw.rightAlignedXOfFirstA = xAt(er, 0);
const ls = checkStarts('lines', e, [0, 6]);
const vt = pointAt(e, 5);
const line2 = ls[1];
const onLine2 = vt && line2 ? vt.rects.filter(r => r.h > 0 && Math.abs(r.y + r.h / 2 - line2.centre) < 10) : [];
check('VT rect on line 2 at x 0 with zero width', { rects: vt ? vt.rects : null, line2Centre: line2 ? line2.centre : null }, 'zero-width rect at line 2 start', onLine2.length > 0 && onLine2.every(r => r.w === 0 && au(r.x) === 0));`),
]

// ---- Cross-cutting ----

// Puts an env observation (fonts, DPR, locale) before the probe's script.
function withEnv(p: Probe): Probe {
  return { ...p, observe: [{ kind: 'env', families: ['Courier New', 'Georgia', 'Hoefler Text', 'Geeza Pro', 'Hiragino Sans', 'PingFang SC', 'Thonburi', 'Times New Roman', 'Helvetica Neue', 'Arial', 'Apple Color Emoji', 'No Such Family 7f3a'] }, ...p.observe] }
}

const crossProbes: Probe[] = [
  probe('cross-cutting 1 emoji', 'Apple Color Emoji 😀 and a ZWJ family at 8..32px: OC at size x DPR / DPR == DOM span width', String.raw`
const sizes = [8, 10, 12, 14, 16, 20, 24, 32];
const E = [['U+1F600', '\u{1F600}'], ['family ZWJ', '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}']];
const spans = E.map(([, t]) => sizes.map(n => preSpan(n + 'px "Apple Color Emoji"', t)));
await settle();
const dpr = devicePixelRatio; const rows = []; let recipe = true, plain = 0;
E.forEach(([name, t], i) => sizes.forEach((n, k) => {
  const dom = bw(spans[i][k]), at = oc(n + 'px "Apple Color Emoji"', t), scaled = oc(n * dpr + 'px "Apple Color Emoji"', t) / dpr, e = ec(n + 'px "Apple Color Emoji"', t);
  rows.push({ emoji: name, size: n, dom, oc: at, ocScaled: scaled, ec: e });
  if (au(scaled) !== au(dom)) recipe = false; if (au(at) === au(dom)) plain++;
}));
check('OC(size x DPR)/DPR == DOM for every size and both emoji', { dpr, rows }, 'equal', recipe);
R.raw.plainEqualCount = plain;
R.raw.scaledFontReadback = sizes.map(n => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = n * dpr + 'px "Apple Color Emoji"'; return c.font; });`),
  probe('cross-cutting 2 controls', 'Courier New: DOM a\\rb, a\\fb, a\\vb, a\\tb in normal and pre vs OC (spec: CR/FF/VT 19.2 in both; TAB 28.8 normal, 86.4 pre; OC all 28.8)', String.raw`
const T = [['\\r', 'a\rb'], ['\\f', 'a\fb'], ['\\v', 'a\vb'], ['\\t', 'a\tb']];
const WS = ['normal', 'pre'];
const spans = WS.map(ws => T.map(([, t]) => span(div(CN + 'white-space:' + ws), t)));
await settle();
const expected = { normal: { '\\r': 1152, '\\f': 1152, '\\v': 1152, '\\t': 1728 }, pre: { '\\r': 1152, '\\f': 1152, '\\v': 1152, '\\t': 5184 } };
WS.forEach((ws, i) => T.forEach(([n], k) => { const w = bw(spans[i][k]); check('DOM ' + ws + ' a' + n + 'b', w, expected[ws][n] / 60, au(w) === expected[ws][n]); }));
T.forEach(([n, t]) => { const w = oc(CNF, t); check('OC a' + n + 'b', w, 28.8, au(w) === 1728); });
R.raw.oc = { ab: oc(CNF, 'ab'), aSpaceB: oc(CNF, 'a b') };`),
  probe('cross-cutting 3 ligatures', 'ffi fl in Hoefler Text and Helvetica Neue at 16 and 32px: DOM letter-spacing 0 / 0.001px / 1px and text-rendering vs OC letterSpacing and textRendering', String.raw`
const text = 'ffi fl';
const fonts = ['"Hoefler Text"', '"Helvetica Neue"'], sizes = [16, 32], LS = ['0px', '0.001px', '1px'], TR = ['auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision'];
const dom = {};
for (const f of fonts) for (const n of sizes) for (const ls of LS) for (const tr of TR) dom[[f, n, ls, tr].join('|')] = preSpan(n + 'px ' + f, text, 'letter-spacing:' + ls + ';text-rendering:' + tr);
await settle();
const rows = [];
for (const f of fonts) for (const n of sizes) {
  const F = n + 'px ' + f; const row = { font: F, dom: {}, oc: {} };
  for (const ls of LS) for (const tr of TR) { row.dom[ls + '|' + tr] = au(bw(dom[[f, n, ls, tr].join('|')])); row.oc[ls + '|' + tr] = au(oc(F, text, { letterSpacing: ls, textRendering: tr })); }
  rows.push(row);
  const hasLig = row.oc['0px|auto'] < row.oc['0.001px|auto'];
  R.raw['ligatureInCanvas ' + F] = hasLig;
  check(F + ': OC textRendering has no width effect', row.oc, 'equal per letterSpacing', LS.every(ls => TR.every(tr => row.oc[ls + '|' + tr] === row.oc[ls + '|auto'])));
  check(F + ': DOM text-rendering has no width effect', row.dom, 'equal per letter-spacing', LS.every(ls => TR.every(tr => row.dom[ls + '|' + tr] === row.dom[ls + '|auto'])));
  check(F + ': DOM letter-spacing 0.001px == 0 (0 au keeps ligatures)', { ls0: row.dom['0px|auto'], ls001: row.dom['0.001px|auto'] }, 'equal', row.dom['0px|auto'] === row.dom['0.001px|auto']);
  check(F + ': DOM ls 0 == OC ls 0', { dom: row.dom['0px|auto'], oc: row.oc['0px|auto'] }, 'equal', row.dom['0px|auto'] === row.oc['0px|auto']);
  check(F + ': DOM ls 1px == OC ls 1px', { dom: row.dom['1px|auto'], oc: row.oc['1px|auto'] }, 'equal', row.dom['1px|auto'] === row.oc['1px|auto']);
  check(F + ': OC ls 1px == OC ls 0.001px + 6px', { ls1: row.oc['1px|auto'], ls001: row.oc['0.001px|auto'] }, 'ls001 + 360 au', row.oc['1px|auto'] === row.oc['0.001px|auto'] + 360);
}
R.raw.rows = rows;`),
  ...['ja', 'zh-Hans', 'ko', 'en'].map((lang): Probe => probe(`cross-cutting 4 lang=${lang}`, `<html lang=${lang}>: OffscreenCanvas 16px sans-serif 永骨 == DOM span; glyph boxes show which font resolved`, String.raw`
const T = ['永骨', 'Aa永骨'];
const spans = T.map(t => preSpan('16px sans-serif', t)); await settle();
const rows = T.map((t, i) => { const m = measureWith('oc', '16px sans-serif', t); const e = measureWith('ec', '16px sans-serif', t); const ml = measureWith('oc', '16px sans-serif', t, { lang: document.documentElement.getAttribute('lang') }); return { text: t, dom: bw(spans[i]), oc: m.width, ocBox: [m.actualBoundingBoxLeft, m.actualBoundingBoxRight], ocCtxLang: ml.width, ec: e.width, ecBox: [e.actualBoundingBoxLeft, e.actualBoundingBoxRight] }; });
R.raw.rows = rows;
rows.forEach(r => check(r.text + ': OC == DOM', { oc: r.oc, dom: r.dom, ec: r.ec, ocBox: r.ocBox }, 'equal', au(r.oc) === au(r.dom)));`, { pageLang: lang })),
  probe('cross-cutting 5 system-ui', 'system-ui and -apple-system at 13, 14, 16, 20px: OC, EC, DOM, DOM with font-optical-sizing none', String.raw`
const t = 'The quick brown fox jumps over the lazy dog';
const fams = ['system-ui', '-apple-system'], sizes = [13, 14, 16, 20];
const spans = {}; for (const f of fams) for (const n of sizes) spans[f + n] = [preSpan(n + 'px ' + f, t), preSpan(n + 'px ' + f, t, 'font-optical-sizing:none')];
await settle();
const rows = [];
for (const f of fams) for (const n of sizes) {
  const F = n + 'px ' + f; const [s, sn] = spans[f + n];
  const r = { font: F, oc: oc(F, t), ec: ec(F, t), dom: bw(s), domOpszNone: bw(sn) }; rows.push(r);
  check(F + ': DOM font-optical-sizing none == OC', r, 'equal', au(r.domOpszNone) === au(r.oc));
}
R.raw.rows = rows;
R.raw.domEqualsOc = rows.filter(r => au(r.dom) === au(r.oc)).map(r => r.font);`),
  withEnv(probe('cross-cutting 6 environment and line-fit grid', 'DPR, visual viewport scale; line fit follows the app-unit grid (round(width x 60) vs text au), not 1/64 device px', String.raw`
const cases = [['16px', 'Georgia', 'ab ab'], ['16px', '"Courier New"', 'aaaa bbbb'], ['16px', 'Arial', 'Hello world']];
const dpr = devicePixelRatio; const built = [];
for (const [size, fam, text] of cases) {
  const T = oc(size + ' ' + fam, text), Tau = au(T);
  const start = Math.floor((Tau / 60 - 0.03) * 1024) / 1024;
  const divs = []; for (let k = 0; k <= 64; k++) { const w = start + k / 1024; divs.push([w, divT('font:' + size + '/20px ' + fam + ';width:' + w + 'px', text)]); }
  const nowrap = divT('font:' + size + '/20px ' + fam + ';white-space:nowrap', text);
  built.push({ text, fam, T, Tau, divs, nowrap });
}
await settle();
for (const c of built) {
  const obs = c.divs.map(([w, d]) => [w, Math.round(d.getBoundingClientRect().height / 20)]);
  const auModel = w => Math.round(Math.fround(w) * 60) >= c.Tau ? 1 : 2;
  const devModel = w => (Math.floor(w * 64 * dpr) + 1) / (64 * dpr) >= Math.ceil(c.T * 64 * dpr) / (64 * dpr) ? 1 : 2;
  const firstOne = (list) => { const f = list.find(x => x[1] === 1); return f ? f[0] : null; };
  const auMatches = obs.every(([w, n]) => n === auModel(w)), devMatches = obs.every(([w, n]) => n === devModel(w));
  const xs = points(c.nowrap).map(p => p.rects[0] ? p.rects[0].x : null).filter(x => x !== null);
  check(c.fam + ' ' + c.text + ': fit follows the app-unit model', { textAu: c.Tau, firstOneLineWidth: firstOne(obs), auModelFirst: firstOne(obs.map(([w]) => [w, auModel(w)])), dev64ModelFirst: firstOne(obs.map(([w]) => [w, devModel(w)])), devModelMatches: devMatches, rectXOn60Grid: xs.every(x => Math.abs(x * 60 - Math.round(x * 60)) < 1e-3), rectXAu: xs.map(x => Math.round(x * 6000) / 100) }, 'au model matches all 65 widths', auMatches);
}
R.raw.env = { dpr, visualViewportScale: visualViewport ? visualViewport.scale : null, innerWidth, outerWidth, screenWidth: screen.width };`)),
]

const APD_SET = ['gecko-lines H3', 'gecko-canvas H1', 'gecko-canvas H5', 'gecko-canvas H21', 'cross-cutting 1 emoji', 'cross-cutting 6 environment and line-fit grid']

export default function probes(): Probe[] {
  const all = [...lineProbes, ...canvasProbes, ...textProbes, ...criticProbes, ...crossProbes]
  return process.env['GECKO_PROBE_SET'] === 'apd' ? all.filter(p => APD_SET.includes(p.id)) : all
}
