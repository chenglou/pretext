// An independently encoded cross-check of the WebKit hypotheses (rebuild/specs/webkit-lines.md §12, webkit-text.md §14,
// webkit-canvas.md (f), the WebKit rows of CRITIC.md §6, and six cross-cutting checks). The canonical set is
// webkit-probes.ts; this one was written separately, so agreement between the two isolates probe-encoding mistakes.
// Ids keep the spec's numbering. Where a hypothesis needs a threshold width, the page computes it from OffscreenCanvas
// measurements (M) with the spec's float32 recipe. Verdicts come from webkit-verdicts-crosscheck.ts over the raw output.
import type { ObservationSpec, Probe } from './types.ts'

// Helpers shared by every script observation. Plain JS; no backticks and no template interpolation inside.
const PRELUDE = String.raw`
const f = Math.fround;
const T64 = x => Math.trunc(x * 64) / 64;
const C64 = x => Math.ceil(x * 64) / 64;
const DPR = window.devicePixelRatio;
const __ctx = new Map();
function ctx2d(font, o) {
  o = o || {};
  const key = JSON.stringify([font, o]);
  let c = __ctx.get(key);
  if (!c) {
    c = new OffscreenCanvas(1, 1).getContext('2d');
    c.font = font;
    const keys = ['letterSpacing', 'wordSpacing', 'direction', 'textRendering', 'fontKerning'];
    for (let i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined) c[keys[i]] = o[keys[i]];
    __ctx.set(key, c);
  }
  return c;
}
function M(font, text, o) { return ctx2d(font, o).measureText(text).width; }
function MX(font, text, o) { const m = ctx2d(font, o).measureText(text); return { w: m.width, l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight }; }
function rel(q, h) { return { x: q.x - h.x, y: q.y - h.y, w: q.width, h: q.height }; }
function rectsOf(list) { const h = host.getBoundingClientRect(); const out = []; for (let i = 0; i < list.length; i++) out.push(rel(list[i], h)); return out; }
function box(e) { return rel(e.getBoundingClientRect(), host.getBoundingClientRect()); }
function nodeRects(node) { const r = document.createRange(); r.selectNodeContents(node); return rectsOf(r.getClientRects()); }
function subRects(node, a, b) { const r = document.createRange(); r.setStart(node, a); r.setEnd(node, b); return rectsOf(r.getClientRects()); }
function contentsRects(e) { const r = document.createRange(); r.selectNodeContents(e); return rectsOf(r.getClientRects()); }
function extent(rects) { let l = Infinity, r = -Infinity; for (let i = 0; i < rects.length; i++) { const q = rects[i]; if (q.w > 0 && q.h > 0) { l = Math.min(l, q.x); r = Math.max(r, q.x + q.w); } } return l === Infinity ? null : { left: l, right: r, width: r - l }; }
function $(sel) { const e = host.querySelector(sel); if (!e) throw new Error('No element ' + sel); return e; }
function add(html) { const t = document.createElement('div'); t.innerHTML = html; const e = t.firstElementChild; host.append(e); return e; }
function textNodes(e) { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const out = []; for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n); return out; }
// Lines from per-code-point Range rects. Visible code points (a rect with positive width and height) define lines by
// vertical centre, and a line's start is its smallest visible offset; texts are the pieces between consecutive starts.
// Zero-width code points only get a per-point line (from a rect with positive height), because WebKit reports a
// collapsed space after an inline box end on the next line.
function lines(e, withPoints) {
  const nodes = textNodes(e); const r = document.createRange(); const pts = []; let base = 0; let text = '';
  for (let n = 0; n < nodes.length; n++) {
    const d = nodes[n].data;
    for (let i = 0; i < d.length;) { const l = d.codePointAt(i) > 0xffff ? 2 : 1; r.setStart(nodes[n], i); r.setEnd(nodes[n], i + l); pts.push({ o: base + i, l: l, rects: rectsOf(r.getClientRects()) }); i += l; }
    base += d.length; text += d;
  }
  const lhRaw = getComputedStyle(e).lineHeight; const lh = lhRaw.endsWith('px') ? parseFloat(lhRaw) : NaN;
  const L = [];
  const near = c => { for (let i = 0; i < L.length; i++) if (Math.abs(L[i].c - c) < L[i].t) return L[i]; return null; };
  for (let p = 0; p < pts.length; p++) {
    const q = pts[p].rects.find(q => q.w > 0 && q.h > 0); if (!q) continue;
    const c = q.y + q.h / 2; let x = near(c);
    if (!x) { x = { c: c, t: Number.isFinite(lh) ? lh / 2 : q.h / 2, s: pts[p].o, left: q.x, right: q.x + q.w }; L.push(x); }
    x.s = Math.min(x.s, pts[p].o); x.left = Math.min(x.left, q.x); x.right = Math.max(x.right, q.x + q.w); pts[p].line = x;
  }
  const unplaced = [];
  for (let p = 0; p < pts.length; p++) {
    if (pts[p].line) continue;
    const q = pts[p].rects.find(q => q.h > 0); const x = q ? near(q.y + q.h / 2) : null;
    if (x) pts[p].line = x; else unplaced.push(pts[p].o);
  }
  L.sort((a, b) => a.c - b.c);
  const starts = L.map(x => x.s);
  const texts = starts.map((s, i) => text.slice(s, i + 1 < starts.length ? starts[i + 1] : text.length));
  const out = { count: L.length, starts: starts, texts: texts, lefts: L.map(x => x.left), rights: L.map(x => x.right), unplaced: unplaced };
  if (withPoints) out.points = pts.map(p => ({ o: p.o, line: p.line ? L.indexOf(p.line) : -1, rects: p.rects }));
  return out;
}
function at(e, w) { e.style.width = w + 'px'; return lines(e); }
`

function script(body: string): ObservationSpec {
  return { kind: 'script', source: `${PRELUDE}\n${body}` }
}
const LINES = script('return lines(element, true)')

const ARIAL = 'font:16px Arial;line-height:20px'
const MINCHO = "font:20px 'Hiragino Mincho ProN';line-height:30px"
const MENLO = 'font:16px Menlo;line-height:20px'
const FAMILIES = ['Arial', 'Georgia', 'Menlo', 'Helvetica Neue', 'Hoefler Text', 'Hiragino Mincho ProN', 'Hiragino Sans', 'Thonburi', 'Geeza Pro', 'Times New Roman', 'Apple Color Emoji']

function p(style: string, content: string): string {
  return `<p style="margin:0;${style}">${content}</p>`
}

type Extra = Partial<Pick<Probe, 'setup' | 'canvas' | 'document' | 'note' | 'hostWidth'>>
function linesProbe(id: string, spec: string, pageLang: string | null, html: string, extra: Extra = {}): Probe {
  return { id, spec, pageLang, html, observe: [LINES], ...extra }
}

function emptyNodesSource(): string {
  return String.raw`
const mk = t => { const d = add('<div style="font:16px Arial;line-height:20px"></div>'); if (t !== null) d.textContent = t; return d; };
const cases = { empty: mk(null), cr: mk('\r'), spaceTabLfFf: mk(' \t\n\f'), vt: mk('\v'), x: mk('x') };
const parsed = add('<div style="font:16px Arial;line-height:20px">\r</div>');
const out = {};
for (const k in cases) out[k] = { h: box(cases[k]).h, codes: cases[k].firstChild ? Array.from(cases[k].firstChild.data, c => c.charCodeAt(0)) : null };
out.parserCr = { h: box(parsed).h, codes: parsed.firstChild ? Array.from(parsed.firstChild.data, c => c.charCodeAt(0)) : null };
return out;
`
}

const AV17 = 'AV'.repeat(17)
const probes: Probe[] = []

// ---------------------------------------------------------------------------------------------------------------
// webkit-lines §12
// ---------------------------------------------------------------------------------------------------------------
{
  const spec = (n: number) => `webkit-lines H${n}`
  const doc = 'wk-lines-en'
  probes.push({
    id: 'webkit-lines env', spec: 'environment', pageLang: 'en', document: doc,
    observe: [{ kind: 'env', families: FAMILIES }],
  })
  probes.push({
    id: 'webkit-lines H1', spec: spec(1), pageLang: 'en', document: doc,
    html: `<div style="${ARIAL}">ab cd</div>`,
    observe: [script(String.raw`
const F = '16px Arial', e = element;
const sp = M(F, ' '), ab = f(M(F, 'ab ') - sp), cd = M(F, 'cd');
const s = f(f(ab) + sp), w = f(s + cd);
const W1 = T64(w), W2 = C64(w) - 2 / 64;
const kSpec = Math.ceil(w * 64) - 1;
let kSource = null;
for (let k = kSpec - 8; k <= kSpec + 8; k++) if (kSource === null && cd <= f(f(k / 64 + 1 / 64) - s)) kSource = k;
const scan = [];
for (let k = kSpec - 6; k <= kSpec + 6; k++) scan.push([k, at(e, k / 64).count]);
let kObserved = null; for (const [k, c] of scan) if (kObserved === null && c === 1) kObserved = k;
return { sp, ab, cd, M_abcd: M(F, 'ab cd'), s, w, wOnGrid: w * 64 === Math.round(w * 64), W1, W2, linesW1: at(e, W1), linesW2: at(e, W2), kSpec, kSource, kObserved, scan };
`)],
  })
  probes.push({
    id: 'webkit-lines H2', spec: spec(2), pageLang: 'en', document: doc,
    html: `<div style="${ARIAL}">ab cd</div>`,
    observe: [script(String.raw`
const F = '16px Arial', e = element;
const sp = M(F, ' '), s = f(f(M(F, 'ab ') - sp) + sp), w = f(s + M(F, 'cd'));
const k0 = Math.ceil(w * 64) - 1;
const rows = [];
for (let k = k0 - 8; k <= k0 + 8; k++) {
  const a = at(e, k / 64).starts.join(','), b = at(e, k / 64 + 0.01).starts.join(','), c = at(e, k / 64 + 0.015).starts.join(',');
  rows.push({ k, a, plus001: b, plus0015: c, same: a === b && a === c });
}
return { w, k0, rows, allSame: rows.every(r => r.same) };
`)],
  })
  probes.push({
    id: 'webkit-lines H3', spec: spec(3), pageLang: 'en', document: doc,
    html: `<div style="font:16px Georgia;line-height:20px">AV AV</div>`,
    observe: [script(String.raw`
const F = '16px Georgia', e = element;
const sp = M(F, ' '), aw = f(M(F, 'AV ') - sp), mav = M(F, 'AV');
const Wspec = T64(f(f(aw) + sp + aw));
const sSrc = f(aw + sp), sAlt = f(mav + sp);
const base = Math.floor(Wspec * 64);
let kSrc = null, kAlt = null;
for (let k = base - 12; k <= base + 12; k++) {
  if (kSrc === null && mav <= f(f(k / 64 + 1 / 64) - sSrc)) kSrc = k;
  if (kAlt === null && mav <= f(f(k / 64 + 1 / 64) - sAlt)) kAlt = k;
}
const scan = []; for (let k = base - 8; k <= base + 8; k++) scan.push([k, at(e, k / 64).count]);
let kObs = null; for (const [k, c] of scan) if (kObs === null && c === 1) kObs = k;
const atW = at(e, Wspec);
const firstAV = subRects(e.firstChild, 0, 2), node = nodeRects(e.firstChild);
e.style.width = '1000px';
return { sp, aw, mav, M_AVAV: M(F, 'AV AV'), Wspec, atW, kSrc, kAlt, kObs, scan, firstAVAtW: firstAV, nodeAtW: node, firstAVWide: subRects(e.firstChild, 0, 2), nodeWide: nodeRects(e.firstChild) };
`)],
  })
  probes.push({
    id: 'webkit-lines H4', spec: spec(4), pageLang: 'en', document: doc,
    html: `<div style="${ARIAL};overflow-wrap:anywhere">${AV17}</div>`,
    observe: [script(String.raw`
const e = element, F = '16px Arial', t = e.textContent;
const widths = {};
for (const w of [112.75, 113.5, 114.75]) widths[w] = at(e, w).starts;
return { widths, M_all: M(F, t), M_0_11: M(F, t.slice(0, 11)), M_11_22: M(F, t.slice(11, 22)), M_22: M(F, t.slice(22)), M_22_33: M(F, t.slice(22, 33)) };
`)],
  })
  probes.push({
    id: 'webkit-lines H5', spec: spec(5), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL}">x foo&shy;i</div><div id="B" style="${ARIAL}"><span>x</span> foo&shy;i</div></div>`,
    observe: [script(String.raw`
const F = '16px Arial', A = $('#A'), B = $('#B');
const sp = M(F, ' '), wx = f(M(F, 'x ') - sp), wf = M(F, 'foo­'), wi = M(F, 'i'), H2010 = M(F, '‐'), Hminus = M(F, '-');
const L = f(f(f(wx + sp) + wf) + wi);
const W = C64(L) - 1 / 64;
const cond = H => { const Lh = f(f(f(wx + sp) + wf) + H); return { H, Lh, ok: L <= T64(W) + 1 / 64 && T64(W) + 1 / 64 < Lh, HgtI: H > wi }; };
const scan = []; let prev = null;
for (let k = Math.floor(L * 64) - 4; k <= Math.ceil(f(f(f(wx + sp) + wf) + H2010) * 64) + 4; k++) {
  const key = at(A, k / 64).starts.join(',') + '|' + at(B, k / 64).starts.join(',');
  if (prev && prev.key === key) prev.to = k; else { prev = { key, from: k, to: k }; scan.push(prev); }
}
return { sp, wx, wf, wi, H2010, Hminus, L, W, c2010: cond(H2010), cMinus: cond(Hminus), A: at(A, W), B: at(B, W), scan };
`)],
  })
  probes.push({
    id: 'webkit-lines H6', spec: spec(6), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL}">aa&shy;bb&shy;cc&shy;dd</div><div id="B" style="${ARIAL}"><span>a</span>a&shy;bb&shy;cc&shy;dd</div></div>`,
    observe: [script(String.raw`
const F = '16px Arial', A = $('#A'), B = $('#B');
const waa = M(F, 'aa­'), wbb = M(F, 'bb­'), wcc = M(F, 'cc­'), wdd = M(F, 'dd'), H = M(F, '‐'), Hminus = M(F, '-');
const w2 = f(waa + wbb), w3 = f(w2 + wcc), w4 = f(w3 + wdd);
const W = C64(f(w2 + H)) - 1 / 64, a = T64(W) + 1 / 64;
const constraints = { ddOverflowsAfterAabbcc: w4 > a, aabbccFits: w3 <= a, hyphenAfterCcDoesNotFit: H > a - w3, hyphenAfterBbFitsOnlyWithEpsilon: T64(W) - w2 < H && H <= a - w2 };
const atW = { A: at(A, W), B: at(B, W) };
const runs = []; let prev = null;
for (let k = Math.floor(waa * 64) - 64; k <= Math.ceil(w4 * 64) + 64; k++) {
  const sa = at(A, k / 64).starts.join(','), sb = at(B, k / 64).starts.join(',');
  const key = sa + '|' + sb;
  if (prev && prev.key === key) prev.to = k; else { prev = { key, from: k, to: k, A: sa, B: sb }; runs.push(prev); }
}
return { waa, wbb, wcc, wdd, H, Hminus, w2, w3, w4, W, constraints, atW, runs: runs.map(r => ({ from: r.from, to: r.to, A: r.A, B: r.B })) };
`)],
  })
  probes.push({
    id: 'webkit-lines H7', spec: spec(7), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL};letter-spacing:4px">abc abc</div><div id="R" style="${ARIAL};letter-spacing:4px;text-align:right;width:100px">abc abc</div></div>`,
    observe: [script(String.raw`
const F = '16px Arial', o = { letterSpacing: '4px' }, A = $('#A'), R = $('#R');
const spl = M(F, ' ', o), a = f(M(F, 'abc ', o) - spl), abcls = M(F, 'abc', o);
const W1 = T64(a), W2 = T64(a) - 1 / 64 - 0.01;
const r1 = at(A, W1), n1 = nodeRects(A.firstChild);
const r2 = at(A, W2), n2 = nodeRects(A.firstChild);
const lineAll = f(f(a + spl) + abcls);
return { spl, a, abcls, abc: M(F, 'abc'), W1, W2, r1, n1, r2, n2, right: { lines: lines(R), node: nodeRects(R.firstChild), expectedLeftUntrimmed: 100 - lineAll, expectedLeftTrimmed: 100 - (lineAll - 4) } };
`)],
  })
  probes.push({
    id: 'webkit-lines H8', spec: spec(8), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL};overflow-wrap:anywhere">aa bbbbbbbbbbbbbbbbbbbb</div><div id="B" style="${ARIAL};word-break:break-all">aa bbbbbbbbbbbbbbbbbbbb</div></div>`,
    observe: [script(String.raw`
const F = '16px Arial', A = $('#A'), B = $('#B');
const W = T64(M(F, 'aa bbbb'));
const sp = M(F, ' '), waa = f(M(F, 'aa ') - sp), left = f(waa + sp), avail = f(f(W + 1 / 64) - left);
let nFit = 0; for (let i = 1; i <= 20; i++) if (M(F, 'b'.repeat(i)) <= avail) nFit = i;
return { W, waa, sp, avail, nFit, anywhere: at(A, W), breakAll: at(B, W) };
`)],
  })
  probes.push({
    id: 'webkit-lines H9', spec: spec(9), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL};width:1px;overflow-wrap:anywhere">W)))iiii</div><div id="B" style="${ARIAL};width:1px;overflow-wrap:anywhere">W)))iiii一</div></div>`,
    observe: [script('return { A: lines($("#A"), true), B: lines($("#B"), true) };')],
  })
  probes.push({
    id: 'webkit-lines H10', spec: spec(10), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL};word-break:break-all">aaaa‐bbbb</div><div id="B" style="${ARIAL};word-break:break-all;line-break:loose">aaaa‐bbbb</div><div id="C" style="${ARIAL}">aaaa‐bbbb</div></div>`,
    observe: [script(String.raw`
const F = '16px Arial', W = T64(M(F, 'aaaa'));
return { W, M_aaaa: M(F, 'aaaa'), M_aaaaH: M(F, 'aaaa‐'), auto: at($('#A'), W), loose: at($('#B'), W), noBreakAll: at($('#C'), W) };
`)],
  })
  const ws = (id: string, mode: string, extra = '') => `<div id="${id}" style="${ARIAL};white-space:${mode}${extra}">abc      def</div>`
  probes.push({
    id: 'webkit-lines H11', spec: spec(11), pageLang: 'en', document: doc,
    html: `<div>${ws('PW', 'pre-wrap')}${ws('BS', 'break-spaces')}${ws('NW', 'nowrap')}${ws('PRE', 'pre')}${ws('PWR', 'pre-wrap', ';text-align:right')}</div>`,
    observe: [script(String.raw`
const F = '16px Arial', sp = M(F, ' '), W = T64(M(F, 'abc') + sp), wabc = f(M(F, 'abc ') - sp);
const out = { W, sp, wabc, M_abc: M(F, 'abc') };
for (const id of ['PW', 'BS', 'NW', 'PRE']) out[id] = at($('#' + id), W);
out.BSnode = nodeRects($('#BS').firstChild);
const pwr = $('#PWR'); pwr.style.width = W + 'px';
out.PWR = { lines: lines(pwr), node: nodeRects(pwr.firstChild), glyphA: subRects(pwr.firstChild, 0, 1), expectedLeftHangExcluded: W - wabc };
const long = add('<div style="font:16px Arial;line-height:20px;white-space:break-spaces"></div>'); long.textContent = 'abc' + ' '.repeat(20) + 'def';
out.BSlong = at(long, W);
out.BSlongNode = nodeRects(long.firstChild);
return out;
`)],
  })
  probes.push({
    id: 'webkit-lines H12', spec: spec(12), pageLang: 'en', document: doc,
    html: `<div style="${ARIAL};text-align:right">abc def</div>`,
    observe: [script(String.raw`
const F = '16px Arial', e = element, sp = M(F, ' '), a = f(M(F, 'abc ') - sp);
const W = T64(a + sp) + 1 / 64;
const r = at(e, W);
return { a, sp, W, lines: r, node: nodeRects(e.firstChild), glyphA: subRects(e.firstChild, 0, 1), expectedLeft: W - a };
`)],
  })
  probes.push({ id: 'webkit-lines H13', spec: spec(13), pageLang: 'en', document: doc, observe: [script(emptyNodesSource())] })
  probes.push({
    id: 'webkit-lines H14', spec: spec(14), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const F = '16px Arial';
const mk = t => { const s = add('<div style="font:16px Arial;line-height:20px;white-space:pre"><span></span></div>').firstChild; s.textContent = t; return s; };
const w = s => ({ box: box(s).w, node: nodeRects(s.firstChild).map(q => q.w) });
const vt = mk('a\vb'), ab = mk('ab'), cr = mk('a\rb'), asp = mk('a b');
return { vt: w(vt), ab: w(ab), cr: w(cr), aSpaceB: w(asp), M_a: M(F, 'a'), M_b: M(F, 'b'), M_ab: M(F, 'ab'), M_aSpaceB: M(F, 'a b'), M_a01b: M(F, 'ab'), notdef: f(M(F, 'ab') - M(F, 'ab')), M_sp: M(F, ' ') };
`)],
  })
  probes.push({
    id: 'webkit-lines H15', spec: spec(15), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const F = '16px Arial', sp = M(F, ' ');
const fmodf = (x, y) => { let r = f(x % y); if (r < 0) r = f(r + y); return r; };
const tabAt = (pos, base) => { let t = f(base - fmodf(f(pos), base)); if (t < sp / 2) t = f(t + base); return t; };
const wa = M(F, 'a'), base4 = f(4 * sp);
const P1 = add('<div style="font:16px Arial;line-height:20px;white-space:pre;tab-size:4"></div>'); P1.textContent = 'a\tb';
const P1s = add('<div style="font:16px Arial;line-height:20px;white-space:pre;tab-size:4"></div>'); P1s.append('a\t'); const bs = document.createElement('span'); bs.textContent = 'b'; P1s.append(bs);
const cands = ['aa', 'ab', 'a', 'abc', 'x', 'xx', 'W', 'Wa', 'm', 'mm', 'abcd', 'e', 'ee', 'o'];
let pick = null; for (const c of cands) if (pick === null && fmodf(M(F, c), sp) > sp / 2) pick = c;
let p2 = null;
if (pick !== null) {
  const P2 = add('<div style="font:16px Arial;line-height:20px;white-space:pre;tab-size:1"></div>'); P2.append(pick + '\t'); const s2 = document.createElement('span'); s2.textContent = 'b'; P2.append(s2);
  const P2t = add('<div style="font:16px Arial;line-height:20px;white-space:pre;tab-size:1"></div>'); P2t.textContent = pick + '\tb';
  const wp = M(F, pick), rem = fmodf(wp, sp);
  p2 = { pick, wp, rem, expectedBLeft: f(wp + tabAt(wp, sp)), noJumpBLeft: f(wp + f(sp - rem)), spanB: box(s2), textB: subRects(P2t.firstChild, pick.length + 1, pick.length + 2), node: nodeRects(P2t.firstChild) };
}
return { sp, wa, base4, expectedBLeft: f(wa + tabAt(wa, base4)), textB: subRects(P1.firstChild, 2, 3), node: nodeRects(P1.firstChild), spanB: box(bs), p2 };
`)],
  })
  probes.push({
    id: 'webkit-lines H16 border', spec: spec(16), pageLang: 'en', document: doc,
    note: 'Only the border exception is measurable here: this Mac has one display, at DPR 2. The DPR 1 half of H16 is not run.',
    observe: [script(String.raw`
const outer = add('<div style="border-left:0.7px solid black;width:100px;font:16px Arial;line-height:20px"><div style="height:1px"></div></div>');
return { dpr: DPR, borderLeftWidth: getComputedStyle(outer).borderLeftWidth, innerLeft: box(outer.firstChild).x - box(outer).x, outerWidth: box(outer).w };
`)],
  })
  probes.push({
    id: 'webkit-lines H18', spec: spec(18), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL}">foo<b>bar</b> baz</div><div id="B" style="${ARIAL};overflow-wrap:anywhere">foo<b>bar</b> baz</div></div>`,
    observe: [script(String.raw`
const F = '16px Arial', W = T64(M(F, 'foo')) + 1 / 64;
return { W, M_foo: M(F, 'foo'), M_bar_bold: M('bold 16px Arial', 'bar'), normal: at($('#A'), W), anywhere: at($('#B'), W) };
`)],
  })
  probes.push({
    id: 'webkit-lines H19', spec: spec(19), pageLang: 'en', document: doc,
    html: `<div style="${ARIAL};text-transform:uppercase">straße straße</div>`,
    observe: [script(String.raw`
const F = '16px Arial', e = element, W = T64(M(F, 'STRASSE'));
const r = at(e, W);
return { W, lines: r, node: nodeRects(e.firstChild), M_STRASSE: M(F, 'STRASSE'), M_STRASSE_following_space: f(M(F, 'STRASSE ') - M(F, ' ')) };
`)],
  })
  probes.push({
    id: 'webkit-lines H20', spec: spec(20), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${ARIAL};width:0">W</div><div id="B" style="${ARIAL};width:0"><span>W</span></div></div>`,
    observe: [script(String.raw`
const A = $('#A'), B = $('#B');
return { A: lines(A), Anode: nodeRects(A.firstChild), B: lines(B), Bnode: nodeRects(B.firstChild.firstChild), Bspan: box(B.firstChild), M_W: M('16px Arial', 'W') };
`)],
  })
  probes.push({
    id: 'webkit-lines H21', spec: spec(21), pageLang: 'en', document: doc,
    html: `<div style="${ARIAL};white-space:pre-wrap;text-align:right">abc   </div>`,
    observe: [script(String.raw`
const F = '16px Arial', e = element, sp = M(F, ' '), wabc = f(M(F, 'abc ') - sp), w3 = M(F, '   ');
const content = f(wabc + w3);
e.style.width = '100px'; const wide = { node: nodeRects(e.firstChild), glyphA: subRects(e.firstChild, 0, 1), lines: lines(e) };
const W2 = T64(M(F, 'abc') + sp); e.style.width = W2 + 'px'; const narrow = { node: nodeRects(e.firstChild), glyphA: subRects(e.firstChild, 0, 1), lines: lines(e) };
return { sp, wabc, w3, content, W2, wide, narrow, expectedWideLeft: 100 - content, expectedNarrowLeft: 0 };
`)],
  })
  probes.push({
    id: 'webkit-lines H22', spec: spec(22), pageLang: 'en',
    note: 'Fresh document: adds a <style> to <head> and removes it before returning.',
    html: `<div><div id="C" style="${ARIAL};overflow-wrap:anywhere">${AV17}</div><div id="FL1" style="${ARIAL};overflow-wrap:anywhere">${AV17}</div><div id="FL2" style="${ARIAL};overflow-wrap:anywhere">${AV17}</div></div>`,
    observe: [script(String.raw`
const st = document.createElement('style');
st.textContent = '#FL1::first-line{font-size:16px} #FL2::first-line{letter-spacing:1px}';
document.head.append(st);
try {
  const F = '16px Arial', t = 'AV'.repeat(17), o = { letterSpacing: '1px' };
  const longest = (rest, availW) => { let n = 0; for (let i = 1; i <= rest.length; i++) if (M(F, rest.slice(0, i)) <= availW) n = i; return Math.max(1, n); };
  const fresh = (start, avail) => { const s = [0, start]; let q = start; while (q < t.length && M(F, t.slice(q)) > avail) { q += longest(t.slice(q), avail); if (q < t.length) s.push(q); } return s; };
  const carry = (start, carried, avail) => { const s = [0, start]; let q = start, c = carried; while (q < t.length && c > avail) { const n = longest(t.slice(q), avail); c = f(c - M(F, t.slice(q, q + n))); q += n; if (q < t.length) s.push(q); } return s; };
  const rows = [];
  for (const w of [112.75, 113.5, 114.75]) {
    const avail = f(w + 1 / 64);
    const control = at($('#C'), w).starts, fl1 = at($('#FL1'), w).starts, fl2 = at($('#FL2'), w).starts;
    const s1c = control[1], s1 = fl2[1];
    rows.push({ w, control, fl1, fl2,
      controlCarryPrediction: s1c === undefined ? null : carry(s1c, f(M(F, t) - M(F, t.slice(0, s1c))), avail),
      controlFreshPrediction: s1c === undefined ? null : fresh(s1c, avail),
      fl2FreshPrediction: s1 === undefined ? null : fresh(s1, avail),
      fl2CarryPrediction: s1 === undefined ? null : carry(s1, f(M(F, t, o) - M(F, t.slice(0, s1), o)), avail) });
  }
  return rows;
} finally { st.remove(); }
`)],
  })
}

// ---------------------------------------------------------------------------------------------------------------
// webkit-text §14
// ---------------------------------------------------------------------------------------------------------------
{
  const spec = (n: number) => `webkit-text H${n}`
  const doc = 'wk-text-en'
  const W1 = 'width:1px'
  const add = (id: string, n: number, pageLang: string | null, html: string, extra: Extra = {}) =>
    probes.push(linesProbe(`webkit-text H${n}${id === '' ? '' : ` ${id}`}`, spec(n), pageLang, html, pageLang === 'en' && extra.document === undefined ? { document: doc, ...extra } : extra))

  add('bold', 1, 'en', p(`${ARIAL};${W1}`, '<b>foo</b>bar'))
  add('control', 1, 'en', p(`${ARIAL};${W1}`, '<b>foo</b> bar'))
  add('', 2, 'en', p(`${ARIAL};${W1}`, '<b>ex-</b>ample'))
  add('span', 3, 'en', p(`${ARIAL};${W1}`, 'x<b>-</b>1'))
  add('single', 3, 'en', p(`${ARIAL};${W1}`, 'x-1'))
  add('', 4, 'ja', p(`${MINCHO};width:25px`, '中文“abc”中文'))
  add('', 5, 'en', p(`${MINCHO};width:25px`, '中«abc»中'))
  for (const lang of ['en', null, 'ja', 'fr', 'de', 'he', 'ar']) {
    add(lang === null ? 'no-lang' : lang, 6, lang, p(`${ARIAL};${W1}`, '----““aabb'))
  }
  add('ja-page en-span', 7, 'ja', p(`${ARIAL};${W1}`, '<span lang="en">----““aabb</span>'))
  add('en-page ja-span', 7, 'en', p(`${ARIAL};${W1}`, '<span lang="ja">----““aabb</span>'))
  probes.push(linesProbe('webkit-text H7 ja-page empty-lang-p', spec(7), 'ja', `<p lang="" style="margin:0;${ARIAL};${W1}">----““aabb</p>`))
  for (const lang of ['und', 'xx']) add(lang, 8, lang, p(`${ARIAL};${W1}`, '----““aabb'))
  add('cjk-dot-paren', 9, 'en', p(`${ARIAL};${W1}`, '中.abc(d'))
  add('latin-dot-paren', 9, 'en', p(`${ARIAL};${W1}`, 'x.abc(d'))
  add('cjk-comma-bracket', 9, 'en', p(`${ARIAL};${W1}`, '中,abc[d'))
  add('cjk-dot-less', 9, 'en', p(`${ARIAL};${W1}`, '中.abc&lt;d'))
  add('cr', 10, 'en', p(`${ARIAL};${W1}`, 'x'), { setup: String.raw`element.textContent = "a\rb"` })
  add('cr strict', 10, 'en', p(`${ARIAL};${W1};line-break:strict`, 'x'), { setup: String.raw`element.textContent = "a\rb"` })
  add('cjk cr', 10, 'en', p(`${MINCHO};${W1}`, 'x'), { setup: String.raw`element.textContent = "中\r中"` })
  add('cjk ff', 10, 'en', p(`${MINCHO};${W1}`, 'x'), { setup: String.raw`element.textContent = "中\f中"` })
  add('cjk vt', 10, 'en', p(`${MINCHO};${W1}`, 'x'), { setup: String.raw`element.textContent = "中\v中"` })
  probes.push({
    id: 'webkit-text H11', spec: spec(11), pageLang: 'en', document: doc,
    canvas: [{ kind: 'offscreen', font: '16px Arial', text: 'a\rb' }, { kind: 'offscreen', font: '16px Arial', text: 'a b' }],
    observe: ['canvasWidths', script(String.raw`
const F = '16px Arial';
const mk = t => { const s = add('<p style="margin:0;font:16px Arial;line-height:20px"><span></span></p>').firstChild; s.textContent = t; return s; };
const cr = mk('a\rb'), sp = mk('a b');
return { crSpan: box(cr).w, crNode: nodeRects(cr.firstChild).map(q => q.w), spaceSpan: box(sp).w, spaceNode: nodeRects(sp.firstChild).map(q => q.w), M_cr: M(F, 'a\rb'), M_space: M(F, 'a b'), M_ab: M(F, 'ab') };
`)],
  })
  probes.push({
    id: 'webkit-text H12', spec: spec(12), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const F = '16px Arial';
const mk = () => add('<div style="display:inline-block;vertical-align:top;font:16px Arial;line-height:20px"></div>');
const sa = t => { const s = document.createElement('span'); s.textContent = t; return s; };
const d1 = mk(), a1 = sa('a'), b1 = sa('b'); d1.append(a1, '\f', b1);
const d2 = mk(), b2 = sa('b'); d2.append('\f', b2);
const d3 = mk(), b3 = sa('b'); d3.append('\v', b3);
return { notdef: f(M(F, 'ab') - M(F, 'ab')), M_a: M(F, 'a'), M_b: M(F, 'b'),
  ffBetweenSpans: { width: box(d1).w, gap: box(b1).x - (box(a1).x + box(a1).w), ffRects: nodeRects(d1.childNodes[1]) },
  ffFirst: { width: box(d2).w, bLeft: box(b2).x - box(d2).x, ffRects: nodeRects(d2.childNodes[0]) },
  vtFirst: { width: box(d3).w, bLeft: box(b3).x - box(d3).x, vtRects: nodeRects(d3.childNodes[0]) } };
`)],
  })
  add('u2028', 13, 'en', p(`${ARIAL};width:1000px`, 'a b'))
  add('u2029', 13, 'en', p(`${ARIAL};width:1000px`, 'a b'))
  add('manual', 14, 'en', p(`${ARIAL};${W1};hyphens:manual`, 'co&shy;op'))
  add('none', 14, 'en', p(`${ARIAL};${W1};hyphens:none`, 'co&shy;op'))
  add('16-bit', 15, 'en', p(`${ARIAL};${W1};word-break:keep-all`, 'abc,def(ghi中'))
  add('8-bit', 15, 'en', p(`${ARIAL};${W1};word-break:keep-all`, 'abc,def(ghi'))
  add('spans', 16, 'en', p(`${MINCHO};${W1};word-break:keep-all`, '<span>中文，</span><span>中文</span>'))
  add('single', 16, 'en', p(`${MINCHO};${W1};word-break:keep-all`, '中文，中文'))
  add('', 17, 'en', p(`${ARIAL};${W1};word-break:keep-all`, 'co&shy;op'))
  add('normal', 18, 'en', p(`${ARIAL};${W1}`, 'a&#x200B;b'))
  add('keep-all', 18, 'en', p(`${ARIAL};${W1};word-break:keep-all`, 'a&#x200B;b'))
  add('', 19, 'en', p(`${MENLO};width:48.2px;word-break:break-all`, 'aaaa,,,,bbbb'))
  add('', 20, 'en', p(`${MINCHO};${W1};overflow-wrap:anywhere`, '中、、文'))
  add('en normal', 21, 'en', p(`${MINCHO};width:25px;line-break:normal`, '日本ァア'))
  add('no-lang normal', 21, null, p(`${MINCHO};width:25px;line-break:normal`, '日本ァア'))
  add('ja auto', 21, 'ja', p(`${MINCHO};width:25px`, '日本ァア'))
  add('ja strict', 21, 'ja', p(`${MINCHO};width:25px;line-break:strict`, '日本ァア'))
  add('', 22, 'th', p('font:16px Thonburi;line-height:24px;width:1px', 'ความสวยงามของธรรมชาติ'))
  add('digits', 23, 'en', p(`${ARIAL};${W1}`, 'ab-12 -12 a -12 12-34'))
  add('question', 23, 'en', p(`${ARIAL};${W1}`, 'x?-b x?$b x!(b'))
  add('', 24, 'en', p(`${MINCHO};width:25px`, '中&nbsp;中'))
  probes.push({
    id: 'webkit-text H25', spec: spec(25), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const mk = h => add('<p style="margin:0;font:16px Arial;line-height:20px">' + h + '</p>');
const p1 = mk('<span style="white-space:pre-wrap">a </span><span> b</span>');
const p2 = mk('<span>a </span><span> b</span>');
const r2 = add('<p style="margin:0;font:16px Arial;line-height:20px;white-space:pre-wrap">a  b</p>');
const r1 = add('<p style="margin:0;font:16px Arial;line-height:20px;white-space:pre-wrap">a b</p>');
return { preWrapFirst: extent(contentsRects(p1)), normal: extent(contentsRects(p2)), preWrapTwoSpaces: extent(contentsRects(r2)), preWrapOneSpace: extent(contentsRects(r1)), sp: M('16px Arial', ' ') };
`)],
  })
  probes.push({
    id: 'webkit-text H26', spec: spec(26), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const F = '24px "Times New Roman"';
const mk = h => { const q = add('<p>' + h + '</p>'); q.style.cssText = 'margin:0;line-height:30px;font:' + F; return q; };
const p1 = mk('<span>A</span><span>V</span>'), p2 = mk('<span>AV</span>');
const sA = box(p1.children[0]).w, sV = box(p1.children[1]).w;
return { spansExtent: extent(contentsRects(p1)), sA, sV, sum: sA + sV, singleSpan: box(p2.children[0]).w, singleExtent: extent(contentsRects(p2)), M_A: M(F, 'A'), M_V: M(F, 'V'), M_AV: M(F, 'AV') };
`)],
  })
  probes.push({
    id: 'webkit-text H27', spec: spec(27), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const F = '20px "Hiragino Mincho ProN"';
const mk = t => { const q = add('<p><span></span></p>'); q.style.cssText = 'margin:0;line-height:30px;font:' + F; q.firstChild.textContent = t; return q.firstChild; };
const a = mk('中\n文'), b = mk('中 文');
return { lf: box(a).w, space: box(b).w, lfNode: nodeRects(a.firstChild), spaceNode: nodeRects(b.firstChild), M_space: M(F, '中 文') };
`)],
  })
  add('', 28, 'en', p(`${ARIAL};${W1}`, 'xyzשלום'))
  probes.push({
    id: 'webkit-text H29', spec: spec(29), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const F = '20px "Hiragino Mincho ProN"';
const mk = h => { const q = add('<p>' + h + '</p>'); q.style.cssText = 'margin:0;line-height:30px;font:' + F; return q; };
const p1 = mk('<span>中a</span>'), p2 = mk('<span>中</span><span>a</span>');
return { single: box(p1.firstChild).w, singleExtent: extent(contentsRects(p1)), splitExtent: extent(contentsRects(p2)), splitSum: box(p2.children[0]).w + box(p2.children[1]).w, M_zh_a: M(F, '中a'), M_zh: M(F, '中'), M_a: M(F, 'a'), autospace: getComputedStyle(p1).getPropertyValue('text-autospace') };
`)],
  })
  const zhScript = script(String.raw`
const specs = [
  ['quotes', '----““aabb', '16px Arial', 20, 1],
  ['cjkQuotes', '中文“abc”中文', '20px "Hiragino Mincho ProN"', 30, 25],
  ['kana', '日本ァア', '20px "Hiragino Mincho ProN"', 30, 25],
  ['wave', '中〜中', '20px "Hiragino Mincho ProN"', 30, 25],
];
const out = { lang: document.documentElement.getAttribute('lang') };
for (const [k, t, font, lh, w] of specs) { const q = add('<p></p>'); q.style.cssText = 'margin:0;line-height:' + lh + 'px;width:' + w + 'px;font:' + font; q.textContent = t; out[k] = lines(q).starts; }
return out;
`)
  for (const lang of ['zh', 'zh-Hans', 'zh-Hant-TW', 'zh-CN']) probes.push({ id: `webkit-text H30 ${lang}`, spec: spec(30), pageLang: lang, observe: [zhScript] })
}

// ---------------------------------------------------------------------------------------------------------------
// webkit-canvas (f)
// ---------------------------------------------------------------------------------------------------------------
{
  const spec = (n: number) => `webkit-canvas H${n}`
  const doc = 'wk-canvas-en'
  const HN = '16px "Helvetica Neue"'
  probes.push({
    id: 'webkit-canvas H1', spec: spec(1), pageLang: 'en',
    canvas: ['a\vb', 'a b', 'a\fb', 'a\rb', 'a\nb', 'a\tb'].map(text => ({ kind: 'offscreen' as const, font: HN, text })),
    observe: ['canvasWidths', script(String.raw`
const F = '16px "Helvetica Neue"';
const mk = t => { const q = add('<div><span></span></div>'); q.style.cssText = 'white-space:pre;line-height:20px;font:' + F; q.firstChild.textContent = t; return q.firstChild; };
const vt = mk('a\vb'), ab = mk('ab');
return { vtSpan: box(vt).w, abSpan: box(ab).w, diff: box(vt).w - box(ab).w, vtNode: nodeRects(vt.firstChild).map(q => q.w), abNode: nodeRects(ab.firstChild).map(q => q.w), notdef01: f(M(F, 'ab') - M(F, 'ab')), M_sp: M(F, ' ') };
`)],
  })
  probes.push({
    id: 'webkit-canvas H2', spec: spec(2), pageLang: 'en', document: doc,
    canvas: [{ kind: 'offscreen', font: 'condensed 16px "Helvetica Neue"', text: 'Hello' }, { kind: 'offscreen', font: HN, text: 'Hello' }],
    observe: ['canvasWidths'],
  })
  const hoefler = String.raw`
const mk = (ls, style) => { const q = add('<div><span></span></div>'); q.style.cssText = 'white-space:pre;line-height:24px;font:16px "Hoefler Text"'; q.firstChild.style.letterSpacing = ls; if (style) q.firstChild.style.cssText += ';' + style; q.firstChild.textContent = 'fifl'; return box(q.firstChild).w; };
return { domLs10: mk('10px'), domLs0: mk('0px'), domLs10NoLig: mk('10px', 'font-variant-ligatures:no-common-ligatures'), M_f: M('16px "Hoefler Text"', 'f'), M_i: M('16px "Hoefler Text"', 'i'), M_l: M('16px "Hoefler Text"', 'l') };
`
  probes.push({
    id: 'webkit-canvas H3', spec: spec(3), pageLang: 'en', document: doc,
    canvas: [
      { kind: 'offscreen', font: '16px "Hoefler Text"', letterSpacing: '10px', text: 'fifl' },
      { kind: 'offscreen', font: '16px "Hoefler Text"', text: 'fifl' },
    ],
    observe: ['canvasWidths', script(hoefler)],
  })
  probes.push({
    id: 'webkit-canvas H4', spec: spec(4), pageLang: 'en', document: doc,
    canvas: [
      { kind: 'element', elementStyle: 'font-variant-ligatures: no-common-ligatures', font: '16px "Hoefler Text"', letterSpacing: '10px', text: 'fifl' },
      { kind: 'element', font: '16px "Hoefler Text"', letterSpacing: '10px', text: 'fifl' },
    ],
    observe: ['canvasWidths', script(hoefler)],
  })
  probes.push({
    id: 'webkit-canvas H5', spec: spec(5), pageLang: 'en', document: doc,
    note: 'Also checked over every canvasWidths entry of the run.',
    observe: [script(String.raw`
const fonts = ['16px Arial', '13.37px Georgia', '15px "Helvetica Neue"', '17px "Hiragino Sans"', '19px "Times New Roman"', 'bold 11px Menlo'];
const texts = ['Hello world', 'AV To', '永文字', 'مرحبا', 'fifl ffi', '\u{1F600}', 'ab', 'ab-12 -12'];
const rows = []; let all = true;
for (const F of fonts) for (const t of texts) for (const ls of [undefined, '0.3px']) { const w = M(F, t, ls ? { letterSpacing: ls } : undefined); const ok = Math.fround(w) === w; all = all && ok; rows.push([F, t, ls || '', w, ok]); }
return { all, rows };
`)],
  })
  probes.push({
    id: 'webkit-canvas H6', spec: spec(6), pageLang: 'en', document: doc,
    canvas: [
      { kind: 'offscreen', font: '16px "Geeza Pro"', direction: 'ltr', text: 'مرحبا بالعالم' },
      { kind: 'offscreen', font: '16px "Geeza Pro"', direction: 'rtl', text: 'مرحبا بالعالم' },
      { kind: 'element', font: '16px "Geeza Pro"', direction: 'ltr', text: 'مرحبا بالعالم' },
      { kind: 'element', font: '16px "Geeza Pro"', direction: 'rtl', text: 'مرحبا بالعالم' },
    ],
    observe: ['canvasWidths'],
  })
  probes.push({
    id: 'webkit-canvas H7', spec: spec(7), pageLang: 'ja',
    canvas: [
      { kind: 'element', elementLang: 'ja', font: '16px sans-serif', text: '直角 骨' },
      { kind: 'element', font: '16px sans-serif', text: '直角 骨' },
      { kind: 'offscreen', font: '16px sans-serif', text: '直角 骨' },
    ],
    observe: ['canvasWidths', script(String.raw`
const q = add('<div style="white-space:pre;line-height:24px"><span></span></div>'); q.firstChild.style.font = '16px sans-serif'; q.firstChild.textContent = '直角 骨';
return { dom: box(q.firstChild).w, domNode: nodeRects(q.firstChild.firstChild).map(r => r.w) };
`)],
  })
  probes.push({
    id: 'webkit-canvas H8', spec: spec(8), pageLang: 'en', document: doc,
    canvas: [
      { kind: 'offscreen', font: '16px Menlo', text: 'a b' },
      { kind: 'offscreen', font: '16px Menlo', text: 'a­b' },
      { kind: 'offscreen', font: '16px Menlo', text: 'ab' },
    ],
    observe: ['canvasWidths'],
  })
  probes.push({
    id: 'webkit-canvas H10', spec: spec(10), pageLang: 'en', document: doc,
    canvas: [{ kind: 'offscreen', font: HN, text: 'ab' }, { kind: 'offscreen', font: HN, text: 'ab' }],
    observe: ['canvasWidths', script(String.raw`
const mk = t => { const q = add('<div><span></span></div>'); q.style.cssText = 'white-space:pre;line-height:20px;font:16px "Helvetica Neue"'; q.firstChild.textContent = t; return q.firstChild; };
const c = mk('ab'), ab = mk('ab');
return { ctrlSpan: box(c).w, abSpan: box(ab).w, domDiff: box(c).w - box(ab).w, ctrlNode: nodeRects(c.firstChild).map(r => r.w), abNode: nodeRects(ab.firstChild).map(r => r.w) };
`)],
  })
  const quoteDivs = String.raw`
const twoLine = ['en', 'es', 'it', 'el', 'ko', 'zh', 'zh-Hant', 'xx'], oneLine = ['sv', 'fi', 'da', 'he', 'ar', 'ja', 'de', 'fr', 'ru', 'hu', 'nl', 'fa'];
const res = {};
for (const L of twoLine.concat(oneLine)) { const d = add('<div></div>'); d.setAttribute('lang', L); d.style.cssText = 'font:16px Menlo;line-height:20px;width:50px'; d.textContent = 'abcd.“efg”'; res[L] = lines(d).starts; }
return { twoLine, oneLine, res, M_abcd_dot: M('16px Menlo', 'abcd.') };
`
  probes.push({ id: 'webkit-canvas H11 lang attributes', spec: spec(11), pageLang: 'en', document: doc, observe: [script(quoteDivs)] })
  probes.push(linesProbe('webkit-canvas H11 no-lang page', spec(11), null, `<div style="${MENLO};width:50px">abcd.“efg”</div>`))
  probes.push({
    id: 'webkit-canvas H12', spec: spec(12), pageLang: 'en', document: doc,
    html: `<div><div id="A" style="${MENLO};width:50px"><span lang="sv">abcd.</span><span lang="en">“efg”</span></div><div id="B" style="${MENLO};width:50px"><span lang="en">abcd.</span><span lang="sv">“efg”</span></div></div>`,
    observe: [script('return { svThenEn: lines($("#A"), true), enThenSv: lines($("#B"), true) };')],
  })
  probes.push(linesProbe('webkit-canvas H13', spec(13), 'en', `<div lang="sv" style="font:16px 'Hiragino Sans';line-height:24px;width:16px">中“文”中</div>`, { document: doc }))
  probes.push(linesProbe('webkit-canvas H14 16-bit', spec(14), 'en', `<div style="${MENLO};width:50px;word-break:keep-all">abcd,efgh中</div>`, { document: doc }))
  probes.push(linesProbe('webkit-canvas H14 8-bit', spec(14), 'en', `<div style="${MENLO};width:50px;word-break:keep-all">abcd,efghé</div>`, { document: doc }))
  probes.push({
    id: 'webkit-canvas H15', spec: spec(15), pageLang: 'en', document: doc,
    canvas: [{ kind: 'offscreen', font: '16px "Times New Roman"', text: 'AV' }, { kind: 'offscreen', font: '16px "Times New Roman"', text: 'Hello world' }],
    observe: ['canvasWidths', script(String.raw`
const mk = t => { const q = add('<div><span></span></div>'); q.style.cssText = 'line-height:20px;font:16px "Times New Roman"'; q.firstChild.textContent = t; return q.firstChild; };
const av = mk('AV'), hw = mk('Hello world');
return { avSpan: box(av).w, avNode: nodeRects(av.firstChild).map(r => r.w), hwSpan: box(hw).w, hwNode: nodeRects(hw.firstChild).map(r => r.w) };
`)],
  })
  probes.push({
    id: 'webkit-canvas H16', spec: spec(16), pageLang: 'en',
    note: 'Fresh document so no earlier measurement of "Te st" is cached.',
    observe: [script(String.raw`
const F = '16px "Times New Roman"';
const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = F;
const q = add('<div style="line-height:20px"></div>');
const o = [], d = [], fresh = [];
for (let i = 0; i < 100; i++) {
  o.push(c.measureText('Te st').width);
  const s = document.createElement('span'); s.style.font = F; s.textContent = 'Te st'; q.replaceChildren(s);
  d.push(box(s).w);
  const c2 = new OffscreenCanvas(1, 1).getContext('2d'); c2.font = F; fresh.push(c2.measureText('Te st').width);
}
return { offscreenDistinct: Array.from(new Set(o)), domDistinct: Array.from(new Set(d)), freshDistinct: Array.from(new Set(fresh)), first: o[0], dom0: d[0] };
`)],
  })
  probes.push(linesProbe('webkit-canvas H17 auto', spec(17), null, `<div style="${MENLO};width:25px">a-1234</div>`))
  probes.push(linesProbe('webkit-canvas H17 strict', spec(17), null, `<div style="${MENLO};width:25px;line-break:strict">a-1234</div>`))
  probes.push({
    id: 'webkit-canvas H18', spec: spec(18), pageLang: 'en', document: doc,
    observe: [script(String.raw`
const t = '\u{1F468}‍\u{1F469}‍\u{1F467} \u{1F1EF}\u{1F1F5}\u{1F1EF}\u{1F1F5}';
return { starts: Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t), s => s.index), locale: new Intl.Segmenter().resolvedOptions().locale, length: t.length };
`)],
  })
  probes.push(linesProbe('webkit-canvas H19', spec(19), 'en', `<div style="${MENLO};width:500px">ab&#x2028;cd</div>`, { document: doc }))
}

// ---------------------------------------------------------------------------------------------------------------
// CRITIC §6 (WebKit rows)
// ---------------------------------------------------------------------------------------------------------------
{
  const doc = 'critic-en'
  probes.push({
    id: 'CRITIC C10 css-zoom proxy', spec: 'CRITIC §6.4 (C10)', pageLang: 'en', document: doc,
    note: 'Proxy only: CSS zoom 1.25 instead of 125% page zoom, which background automation cannot set.',
    observe: [script(String.raw`
const F20 = '20px Arial', sp = M(F20, ' '), a = f(M(F20, 'nnnnn ') - sp), total = f(f(a + sp) + M(F20, 'nnnnn'));
let W = null, Tz = null, Ttz = null;
for (let j = -512; j <= 512 && W === null; j++) {
  const cand = total / 1.25 + j / 4096;
  const tz = T64(f(f(cand) * 1.25)), ttz = T64(f(T64(f(cand)) * 1.25));
  if (total <= tz + 1 / 64 && ttz + 1 / 64 < total) { W = cand; Tz = tz; Ttz = ttz; }
}
if (W === null) return { total, W: null };
const d = add('<div style="zoom:1.25;font:16px Arial;line-height:20px">nnnnn nnnnn</div>'); d.style.width = W + 'px';
return { total, W, zoomBeforeTruncation: Tz, truncationBeforeZoom: Ttz, lines: lines(d), node: nodeRects(d.firstChild), computedWidth: getComputedStyle(d).width, computedFontSize: getComputedStyle(d).fontSize };
`)],
  })
  probes.push(linesProbe('CRITIC C11', 'CRITIC §6.5 (C11)', 'en', `<div lang="und" style="${MENLO};width:50px">abcd.“efg”</div>`, { document: doc }))
  probes.push({
    id: 'CRITIC C12', spec: 'CRITIC §6.6 (C12)', pageLang: 'en', document: doc,
    canvas: ['a\fb', 'a b', 'a\vb', 'a\rb'].map(text => ({ kind: 'offscreen' as const, font: '16px Arial', text })),
    observe: ['canvasWidths'],
  })
  probes.push({
    id: 'CRITIC C13', spec: 'CRITIC §6.7 (C13)', pageLang: 'en', document: doc,
    canvas: [
      { kind: 'offscreen', font: '40px "Hoefler Text"', letterSpacing: '1px', text: 'fi' },
      { kind: 'offscreen', font: '40px "Hoefler Text"', text: 'fi' },
      { kind: 'offscreen', font: '40px "Hoefler Text"', text: 'f' },
      { kind: 'offscreen', font: '40px "Hoefler Text"', text: 'i' },
    ],
    observe: ['canvasWidths'],
  })
  probes.push(linesProbe('CRITIC C14', 'CRITIC §6.8 (C14)', 'en', `<div style="width:1px;text-transform:full-width;font:16px 'Hiragino Sans';line-height:24px">ab</div>`, { document: doc }))
  probes.push({ id: 'CRITIC W7', spec: 'CRITIC §6.11 (W7)', pageLang: 'en', document: doc, observe: [script(emptyNodesSource())] })
}

// ---------------------------------------------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------------------------------------------
{
  probes.push({
    id: 'cross 1 emoji', spec: 'cross-cutting 1', pageLang: 'en',
    observe: [script(String.raw`
const sizes = [8, 10, 12, 14, 16, 20, 24, 32];
const texts = { grin: '\u{1F600}', family: '\u{1F468}‍\u{1F469}‍\u{1F467}' };
const rows = [];
for (const s of sizes) for (const k in texts) {
  const t = texts[k], font = s + 'px "Apple Color Emoji"';
  const span = add('<div style="white-space:pre;line-height:normal"><span></span></div>').firstChild; span.style.font = font; span.textContent = t;
  const ce = document.createElement('canvas'); host.append(ce); const cx = ce.getContext('2d'); cx.font = font;
  rows.push({ size: s, text: k, dom: box(span).w, domNode: nodeRects(span.firstChild).map(q => q.w), canvas: M(font, t), canvasAtDprSize: M((s * DPR) + 'px "Apple Color Emoji"', t) / DPR, elementCanvas: cx.measureText(t).width });
}
return { dpr: DPR, rows };
`)],
  })
  probes.push({
    id: 'cross 2 controls', spec: 'cross-cutting 2', pageLang: 'en',
    observe: [script(String.raw`
const F = '16px Arial', out = [];
for (const mode of ['normal', 'pre']) for (const t of ['a\rb', 'a\fb', 'a\vb', 'a\tb', 'a b', 'ab']) {
  const q = add('<div><span></span></div>'); q.style.cssText = 'line-height:20px;font:' + F + ';white-space:' + mode; q.firstChild.textContent = t;
  out.push({ mode, codes: Array.from(t, c => c.charCodeAt(0)), span: box(q.firstChild).w, node: nodeRects(q.firstChild.firstChild).map(r => r.w), canvas: M(F, t) });
}
return { rows: out, M_a01b: M(F, 'ab'), M_ab: M(F, 'ab'), M_aSpaceB: M(F, 'a b') };
`)],
  })
  probes.push({
    id: 'cross 3 ligatures', spec: 'cross-cutting 3', pageLang: 'en',
    observe: [script(String.raw`
const text = 'ffi fl', rows = [];
for (const fam of ['Hoefler Text', 'Helvetica Neue']) {
  const font = '32px "' + fam + '"';
  const dom = {};
  for (const ls of ['normal', '0px', '0.001px', '1px']) for (const tr of ['auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision']) {
    const sp = add('<div style="white-space:pre;line-height:40px"><span></span></div>').firstChild; sp.style.font = font; sp.style.letterSpacing = ls; sp.style.textRendering = tr; sp.textContent = text;
    dom[ls + '|' + tr] = box(sp).w;
  }
  const offscreen = {};
  for (const ls of ['0px', '0.001px', '1px']) for (const tr of [undefined, 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision']) {
    const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = font; c.letterSpacing = ls; if (tr) c.textRendering = tr;
    offscreen[ls + '|' + (tr || 'unset')] = { w: c.measureText(text).width, textRenderingIsString: typeof c.textRendering === 'string', letterSpacing: c.letterSpacing, textRenderingInPrototype: 'textRendering' in OffscreenCanvasRenderingContext2D.prototype };
  }
  const elem = {};
  for (const style of ['', 'text-rendering:optimizeSpeed', 'font-variant-ligatures:no-common-ligatures', 'letter-spacing:1px']) for (const ls of ['0px', '1px']) {
    const ce = document.createElement('canvas'); ce.setAttribute('style', style); host.append(ce); const c = ce.getContext('2d'); c.font = font; c.letterSpacing = ls;
    elem[style + '|' + ls] = c.measureText(text).width;
  }
  const parts = { f: M(font, 'f'), i: M(font, 'i'), l: M(font, 'l'), sp: M(font, ' '), ff: M(font, 'ff'), fi: M(font, 'fi'), fl: M(font, 'fl'), ffi: M(font, 'ffi') };
  rows.push({ family: fam, dom, offscreen, element: elem, parts, glyphSum: f(f(f(f(f(parts.f + parts.f) + parts.i) + parts.sp) + parts.f) + parts.l) });
}
return rows;
`)],
  })
  const langScript = script(String.raw`
const font = '32px sans-serif', texts = ['永骨', '永骨，。「」', 'abc永'], rows = [];
for (const t of texts) {
  const sp = add('<div style="white-space:pre;line-height:40px"><span></span></div>').firstChild; sp.style.font = font; sp.textContent = t;
  const ce = document.createElement('canvas'); host.append(ce); const c = ce.getContext('2d'); c.font = font; const me = c.measureText(t);
  rows.push({ text: t, dom: box(sp).w, domNode: nodeRects(sp.firstChild).map(q => q.w), offscreen: MX(font, t), element: { w: me.width, l: me.actualBoundingBoxLeft, r: me.actualBoundingBoxRight } });
}
return { lang: document.documentElement.getAttribute('lang'), rows };
`)
  for (const lang of ['ja', 'zh-Hans', 'ko', 'en']) probes.push({ id: `cross 4 lang ${lang}`, spec: 'cross-cutting 4', pageLang: lang, observe: [langScript] })
  probes.push({
    id: 'cross 5 system-ui', spec: 'cross-cutting 5', pageLang: 'en',
    observe: [script(String.raw`
const rows = [];
for (const fam of ['system-ui', '-apple-system']) for (const s of [13, 14, 16, 20]) for (const t of ['Hello world', 'The quick brown fox 0123']) {
  const font = s + 'px ' + fam;
  const sp = add('<div style="white-space:pre;line-height:30px"><span></span></div>').firstChild; sp.style.font = font; sp.textContent = t;
  const ce = document.createElement('canvas'); host.append(ce); const c = ce.getContext('2d'); c.font = font;
  rows.push({ family: fam, size: s, text: t, dom: box(sp).w, domNode: nodeRects(sp.firstChild).map(q => q.w), offscreen: M(font, t), offscreenFont: ctx2d(font).font, element: c.measureText(t).width, elementFont: c.font });
}
return rows;
`)],
  })
  probes.push({
    id: 'cross 6 env grid', spec: 'cross-cutting 6', pageLang: 'en',
    observe: [{ kind: 'env', families: FAMILIES }, script(String.raw`
const F = '16px Arial', sp = M(F, ' ');
const pairs = [['ab', 'cd'], ['hello', 'world'], ['nnnnn', 'nnnnn'], ['AV', 'To'], ['xy', 'zz'], ['quick', 'brown'], ['m', 'iii'], ['Wave', 'form']];
const rows = [];
for (const [x, y] of pairs) {
  const e = add('<div style="font:16px Arial;line-height:20px"></div>'); e.textContent = x + ' ' + y;
  const s = f(f(M(F, x + ' ') - sp) + sp), w = f(s + M(F, y));
  const k = Math.ceil(w * 64) - 1;
  const scan = []; for (let j = 2 * k - 6; j <= 2 * k + 6; j++) scan.push([j, at(e, j / 128).count]);
  let jFirstOneLine = null; for (const [j, c] of scan) if (jFirstOneLine === null && c === 1) jFirstOneLine = j;
  e.style.width = '1000px';
  rows.push({ text: x + ' ' + y, w, w128: w * 128, k64: k, jFirstOneLine, scan, nodeRects: nodeRects(e.firstChild), glyphRects: [0, 1, 2].map(i => subRects(e.firstChild, i, i + 1)) });
}
return { dpr: DPR, visualViewportScale: window.visualViewport ? window.visualViewport.scale : null, rows };
`)],
  })
}

// ---------------------------------------------------------------------------------------------------------------
// String storage: the same Latin-1 text built from 8-bit and from 16-bit JS strings. WebKit applies the keep-all
// punctuation rule and the first-unit line-start rule only to 16-bit text boxes (webkit-text §16 open question).
// ---------------------------------------------------------------------------------------------------------------
probes.push({
  id: 'storage 8-bit vs 16-bit', spec: 'webkit-text §16 (8-bit storage); webkit-lines H9, H11; webkit-text H15; webkit-canvas H14', pageLang: 'en',
  note: 'The probe markup itself arrives through the runner JSON (as every probe html does); the script builds the rest.',
  html: `<p style="margin:0;${ARIAL};width:1px;word-break:keep-all">abc,def(ghi</p>`,
  observe: [script(String.raw`
const F = '16px Arial';
const forced16 = s => (s + '一').slice(0, -1);
const W11 = T64(M(F, 'abc') + M(F, ' '));
const cases = [
  ['webkit-lines H9', 'font:16px Arial;line-height:20px;width:1px;overflow-wrap:anywhere', 'W)))iiii'],
  ['webkit-text H15', 'font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi'],
  ['webkit-canvas H14', 'font:16px Menlo;line-height:20px;width:50px;word-break:keep-all', 'abcd,efghé'],
  ['webkit-lines H11 break-spaces', 'font:16px Arial;line-height:20px;white-space:break-spaces;width:' + W11 + 'px', 'abc      def'],
];
const makers = {
  textContent8: (d, t) => { d.textContent = t; },
  textContent16: (d, t) => { d.textContent = forced16(t); },
  innerHTML8: (d, t) => { d.innerHTML = t; },
  innerHTML16: (d, t) => { d.innerHTML = forced16(t); },
  createTextNode16: (d, t) => { d.append(document.createTextNode(forced16(t))); },
  jsonParseWithCjkPayload: (d, t) => { d.textContent = JSON.parse(JSON.stringify([t, '一']))[0]; },
  jsonParseLatin1Payload: (d, t) => { d.textContent = JSON.parse(JSON.stringify([t]))[0]; },
};
const rows = [];
for (const [id, style, t] of cases) {
  const row = { id, text: t };
  for (const k in makers) { const d = add('<div></div>'); d.style.cssText = style; makers[k](d, t); const L = lines(d); row[k] = L.texts; }
  rows.push(row);
}
return { W11, runnerJsonMarkup: lines(element).texts, rows };
`)],
})

// ---------------------------------------------------------------------------------------------------------------
// Page history: does laying out a 16-bit text first change the breaks of a later Latin-1 text? Each order gets a fresh
// document; within one, every text is laid out (and removed) before the next is inserted.
// ---------------------------------------------------------------------------------------------------------------
{
  const sequences: Array<[string, Array<[string, string]>]> = [
    ['keep-all 16-bit then 8-bit', [['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi中'], ['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi']]],
    ['keep-all 8-bit then 16-bit', [['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi'], ['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi中']]],
    ['keep-all other prefix 16-bit then 8-bit', [['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'xyz,uvw(rst中'], ['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi']]],
    ['keep-all 16-bit then 8-bit, then 8-bit again in a new element', [['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi中'], ['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi'], ['font:16px Arial;line-height:20px;width:1px;word-break:keep-all', 'abc,def(ghi']]],
    ['Menlo keep-all 16-bit then 8-bit', [['font:16px Menlo;line-height:20px;width:50px;word-break:keep-all', 'abcd,efgh中'], ['font:16px Menlo;line-height:20px;width:50px;word-break:keep-all', 'abcd,efghé']]],
    ['anywhere 16-bit then 8-bit', [['font:16px Arial;line-height:20px;width:1px;overflow-wrap:anywhere', 'W)))iiii一'], ['font:16px Arial;line-height:20px;width:1px;overflow-wrap:anywhere', 'W)))iiii']]],
    ['anywhere 8-bit then 16-bit', [['font:16px Arial;line-height:20px;width:1px;overflow-wrap:anywhere', 'W)))iiii'], ['font:16px Arial;line-height:20px;width:1px;overflow-wrap:anywhere', 'W)))iiii一']]],
    ['anywhere both in one fragment', [['font:16px Arial;line-height:20px;width:1px;overflow-wrap:anywhere', 'W)))iiii|W)))iiii一']]],
  ]
  for (const [name, steps] of sequences) {
    probes.push({
      id: `history ${name}`, spec: 'page history (webkit-lines H9; webkit-text H15; webkit-canvas H14)', pageLang: 'en',
      note: 'Fresh document. Texts are inserted one at a time; "a|b" inserts two sibling divs at once.',
      observe: [script(String.raw`
const steps = ${JSON.stringify(steps)};
const out = [];
for (const [style, text] of steps) {
  const parts = text.split('|');
  const divs = parts.map(t => { const d = add('<div></div>'); d.style.cssText = style; d.textContent = t; return d; });
  divs.forEach((d, i) => out.push({ text: parts[i], texts: lines(d).texts }));
  divs.forEach(d => d.remove());
}
return out;
`)],
    })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Payload width: the runner sends each document's probes as JSON, and the page applies `html` with innerHTML. A raw
// non-Latin-1 character anywhere in that payload may make every parsed string, and so the markup and its text node,
// 16-bit. Same markup twice, each in a fresh document: once with a raw 中 in the note, once with an ASCII note.
// ---------------------------------------------------------------------------------------------------------------
{
  const cases: Array<[string, string]> = [
    ['keep-all abc,def(ghi', `<p style="margin:0;${ARIAL};width:1px;word-break:keep-all">abc,def(ghi</p>`],
    ['Menlo keep-all abcd,efghé', `<p style="margin:0;${MENLO};width:50px;word-break:keep-all">abcd,efghé</p>`],
    ['anywhere W)))iiii', `<p style="margin:0;${ARIAL};width:1px;overflow-wrap:anywhere">W)))iiii</p>`],
  ]
  for (const [name, html] of cases) {
    probes.push(linesProbe(`payload 16-bit ${name}`, 'string storage via the runner JSON (webkit-lines H9; webkit-text H15; webkit-canvas H14)', 'en', html, { note: 'Payload carries a raw CJK character: 中' }))
    probes.push(linesProbe(`payload 8-bit ${name}`, 'string storage via the runner JSON (webkit-lines H9; webkit-text H15; webkit-canvas H14)', 'en', html, { note: 'Payload is Latin-1 only.' }))
  }
}

// ---------------------------------------------------------------------------------------------------------------
// TextBreakingPositionCache: a process-wide cache keyed by content (by value), style context and origin. Run "cache A"
// in one runner invocation (one webkit-host process, documents in this order) and "cache B" in another. Contents are
// unique to these probes so no other probe can have filled the cache for them.
// ---------------------------------------------------------------------------------------------------------------
{
  const spec = 'TextBreakingPositionCache (webkit-text §5.2; webkit-lines H11; webkit-text H15)'
  const setW11 = String.raw`const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = '16px Arial'; element.style.width = (Math.trunc((c.measureText('abc').width + c.measureText(' ').width) * 64) / 64) + 'px';`
  const keepAll = `<p style="margin:0;${ARIAL};width:1px;word-break:keep-all">pqr,stu(vwx</p>`
  const ws = (mode: string, text: string) => `<p style="margin:0;${ARIAL};white-space:${mode}">${text}</p>`
  probes.push(linesProbe('cache A1 keep-all 16-bit payload', spec, 'en', keepAll, { note: 'Payload carries a raw CJK character: 中. Fills the cache with 16-bit breaks for pqr,stu(vwx.' }))
  probes.push(linesProbe('cache A2 keep-all 8-bit payload after A1', spec, 'en', keepAll, { note: 'Latin-1 payload, same content and style as A1.' }))
  probes.push(linesProbe('cache A3 pre-wrap abc      xyz', spec, 'en', ws('pre-wrap', 'abc      xyz'), { setup: setW11, note: 'Fills the cache with pre-wrap items (one whitespace item for the six spaces).' }))
  probes.push(linesProbe('cache A4 break-spaces abc      xyz after A3', spec, 'en', ws('break-spaces', 'abc      xyz'), { setup: setW11 }))
  probes.push(linesProbe('cache A5 break-spaces mno      qrs control', spec, 'en', ws('break-spaces', 'mno      qrs'), { setup: setW11 }))
  probes.push(linesProbe('cache B1 keep-all 8-bit payload alone', spec, 'en', keepAll, { note: 'Separate runner invocation: a fresh webkit-host process.' }))
  probes.push(linesProbe('cache B2 break-spaces abc      xyz alone', spec, 'en', ws('break-spaces', 'abc      xyz'), { setup: setW11, note: 'Separate runner invocation: a fresh webkit-host process.' }))
}

export default probes
