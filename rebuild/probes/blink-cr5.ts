// Blink probes for the correctness round after the re-architecture (2026-09-19). Raw observations; the verdicts are in
// specs/blink-RESULTS.md, "Correctness round 5".
//
// Z. A zero-advance glyph cluster made of a default-ignorable character and a combining mark (SHY, ZWSP or U+2060 before a
//    mark), at overflow widths: which line Chrome puts it on, in several fonts and texts.
// K. Pair placement. For kerned Latin pairs in many families: what the DOM gives the first letter inside the pair (the
//    ground truth: the whole adjustment on it, or half), beside everything Canvas can be asked about the pair: totals and
//    ink boxes at the size and at the size times 2^k, under direction rtl, under a right-to-left override, and with a
//    letter spacing. The question is whether any of it differs between the two kinds of font.
// L. Cluster membership. For lam-alef in many Arabic families: whether the DOM treats it as one glyph cluster (a width
//    where beh and lam fit and alef doesn't; the Range widths of lam and alef), beside everything Canvas can be asked: the
//    pair with and without U+200D, U+200C, U+2060, U+034F and tatweel between, ink boxes, a letter spacing, liga off, and
//    the size times 2^k.
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py blink-cr5 -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/blink-cr5.ts --out=<out folder> --probe-timeout-ms=120000
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const cp = (...a) => String.fromCodePoint(...a);
const ctx = (family, size, direction, letterSpacing, weight) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = (weight || '400') + ' ' + size + 'px ' + family; c.lang = 'en'; c.direction = direction; c.letterSpacing = letterSpacing || '0px'; c.fontKerning = 'auto'; c.textRendering = 'optimizeLegibility'; return c; };
const u = v => Math.round(v * 65536);
const m = (c, text) => { const t = c.measureText(text); return [u(t.width), u(t.actualBoundingBoxLeft), u(t.actualBoundingBoxRight)]; };
const resolves = family => { const a = ctx(family + ', monospace', 40, 'ltr'), b = ctx(family + ', serif', 40, 'ltr'); const s = 'Hamburgefonstiv ' + cp(0x644, 0x627, 0x628); return a.measureText(s).width === b.measureText(s).width; };
const block = (family, size, width, text, extra) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; white-space: normal; overflow-wrap: break-word; direction: ltr; width: ' + width + 'px; font: 400 ' + size + 'px/60px ' + family + ';' + (extra || '');
  div.lang = 'en';
  const node = document.createTextNode(text); div.append(node); host.append(div);
  return { div, node };
};
const rectsOf = (node, a, b, origin) => { const r = document.createRange(); r.setStart(node, a); r.setEnd(node, b); return [...r.getClientRects()].map(q => [Math.round((q.x - origin.x) * 128), Math.floor((q.y - origin.y + q.height / 2) / 60), Math.round(q.width * 128)]); };
const lines = (family, size, width, text, extra) => {
  const { div, node } = block(family, size, width, text, extra);
  const origin = div.getBoundingClientRect();
  const units = [];
  for (let i = 0; i < text.length; i++) units.push(rectsOf(node, i, i + 1, origin));
  const count = Math.round(origin.height / 60);
  div.remove();
  return { count, units };
};
`

const Z = HELPERS + String.raw`
const SHY = cp(0xad), ZWSP = cp(0x200b), WJ = cp(0x2060), ACUTE = cp(0x301), KASRA = cp(0x650), BEH = cp(0x628), BA = cp(0x92c);
const out = { dpr: window.devicePixelRatio, cases: [] };
const run = (name, family, size, width, text, extra) => out.cases.push({ name, family, size, width, extra: extra || '', text: [...text].map(ch => ch.codePointAt(0).toString(16)).join(' '), ...lines(family, size, width, text, extra) });
run('suite: a ZWSP acute ) ba, ls -1', '"Shantell Sans"', 16, 8, 'a' + ZWSP + ACUTE + ')' + BA, 'letter-spacing: -1px;');
run('the same, no letter spacing', '"Shantell Sans"', 16, 8, 'a' + ZWSP + ACUTE + ')' + BA);
for (const family of ['Arial', '"Times New Roman"', 'Georgia']) {
  for (const [label, ign] of [['ZWSP', ZWSP], ['SHY', SHY], ['WJ', WJ]]) {
    run('a ' + label + ' acute b, 4px', family, 16, 4, 'a' + ign + ACUTE + 'b');
    run('a ' + label + ' b, 4px', family, 16, 4, 'a' + ign + 'b');
    run('ab ' + label + ' acute cd, 20px', family, 16, 20, 'ab' + ign + ACUTE + 'cd');
    run('a acute ' + label + ' acute b, 4px', family, 16, 4, 'a' + ACUTE + ign + ACUTE + 'b');
  }
}
for (const family of ['"Noto Nastaliq Urdu"', 'Amiri', '"Noto Naskh Arabic"', 'Arial', '"Geeza Pro"']) {
  for (const width of [0.5, 1, 3]) {
    run('beh SHY kasra beh', family, 16, width, BEH + SHY + KASRA + BEH, 'direction: rtl;');
    run('beh kasra SHY kasra beh', family, 16, width, BEH + KASRA + SHY + KASRA + BEH, 'direction: rtl;');
    run('beh ZWSP kasra beh', family, 16, width, BEH + ZWSP + KASRA + BEH, 'direction: rtl;');
    run('beh SHY beh', family, 16, width, BEH + SHY + BEH, 'direction: rtl;');
  }
  const c = ctx(family, 32, 'rtl');
  const ZWJ = cp(0x200d);
  out[family] = { whole: m(c, BEH + WJ + KASRA + BEH), first: m(c, BEH + ZWJ), firstWithMark: m(c, BEH + WJ + KASRA + ZWJ), last: m(c, ZWJ + BEH), lastWithMark: m(c, ZWJ + WJ + KASRA + BEH), noIgnorable: m(c, BEH + KASRA + BEH), firstNoIgnorable: m(c, BEH + KASRA + ZWJ) };
}
return out;
`

const K = HELPERS + String.raw`
const WJ = cp(0x2060), LS = cp(0x2028), RLO = cp(0x202e), PDF = cp(0x202c);
const FAMILIES = ['"Times New Roman"', 'Arial', 'Georgia', 'Verdana', '"Trebuchet MS"', 'Tahoma', '"Helvetica Neue"', 'Helvetica', 'Times', 'Palatino', 'Optima', 'Baskerville', 'Didot', '"Hoefler Text"', 'Futura', '"Gill Sans"', '"Avenir Next"', 'Cochin', '"American Typewriter"', 'Rockwell', 'Charter', '"Iowan Old Style"', '"Big Caslon"', '"Bodoni 72"', 'Copperplate', '"Lucida Grande"', 'Geneva', '"Marker Felt"', 'Papyrus', '"Apple Chancery"', '"Shantell Sans"', 'ProbeShantell', '"Courier New"', 'Menlo'];
const PAIRS = ['AV', 'To', 'Ty', 'LT', 'P.', 'Wa', 'Yo', 'r,', 'VA', 'AT', 'A' + WJ + ' '];
const out = { dpr: window.devicePixelRatio, families: {} };
for (const family of FAMILIES) {
  if (!resolves(family)) { out.families[family] = null; continue; }
  const weight = family === 'ProbeShantell' ? '700' : '400';
  const base = ctx(family, 36, 'ltr', '0px', weight), rtl = ctx(family, 36, 'rtl', '0px', weight), spaced = ctx(family, 36, 'ltr', '1px', weight);
  const big = [1, 2, 3, 4, 5].map(k => ctx(family, 36 * 2 ** k, 'ltr', '0px', weight));
  const rows = {};
  for (const pair of PAIRS) {
    const a = pair[0], b = pair[pair.length - 1] === ' ' ? LS : pair[pair.length - 1];
    const canvasPair = pair[pair.length - 1] === ' ' ? pair.slice(0, -1) + LS : pair;
    const { div, node } = block(family, 18, 400, pair + 'B', 'white-space: pre; font-weight: ' + weight + ';');
    const origin = div.getBoundingClientRect();
    const dom = { first: rectsOf(node, 0, 1, origin), last: rectsOf(node, pair.length - 1, pair.length, origin), pair: rectsOf(node, 0, pair.length, origin) };
    div.remove();
    rows[[...pair].map(ch => ch.codePointAt(0).toString(16)).join(' ')] = {
      dom, pair: m(base, canvasPair), a: m(base, a), b: m(base, b), rtl: m(rtl, canvasPair), override: m(base, RLO + canvasPair + PDF), reversed: m(base, b + a),
      spaced: m(spaced, canvasPair), big: big.map(c => [m(c, canvasPair), m(c, a), m(c, b)]),
    };
  }
  out.families[family] = rows;
}
return out;
`

const L = HELPERS + String.raw`
const LAM = cp(0x644), ALEF = cp(0x627), BEH = cp(0x628), ZWJ = cp(0x200d), ZWNJ = cp(0x200c), WJ = cp(0x2060), CGJ = cp(0x34f), TATWEEL = cp(0x640), KASRA = cp(0x650), LRO = cp(0x202d), PDF = cp(0x202c);
const FAMILIES = ['Arial', '"Times New Roman"', '"Courier New"', '"Geeza Pro"', 'Amiri', '"Noto Naskh Arabic"', '"Noto Nastaliq Urdu"', '"Al Bayan"', '"Al Nile"', '"Al Tarikh"', 'Baghdad', 'Beirut', 'Damascus', '"DecoType Naskh"', '"Diwan Kufi"', '"Diwan Thuluth"', 'Farah', 'Farisi', 'KufiStandardGK', 'Mishafi', 'Muna', 'Nadeem', 'Sana', 'Waseem', 'Tahoma', '"Microsoft Sans Serif"', '"Arial Unicode MS"', '"SF Arabic"', 'system-ui', '"Shantell Sans"', 'Georgia'];
const out = { dpr: window.devicePixelRatio, families: {} };
for (const family of FAMILIES) {
  const listed = resolves(family);
  const word = BEH + LAM + ALEF + BEH;
  // DOM ground truth: the Range widths of lam and alef inside the unbroken word, and the lines at a width that holds beh
  // and lam by the paragraph's own positions plus a quarter of alef's share.
  const wide = block(family, 16, 400, word, 'direction: rtl;');
  const origin = wide.div.getBoundingClientRect();
  const parts = [0, 1, 2, 3].map(i => rectsOf(wide.node, i, i + 1, origin));
  const firstTwo = rectsOf(wide.node, 0, 2, origin);
  wide.div.remove();
  const widthOfFirstTwo = firstTwo.reduce((s, r) => s + r[2], 0) / 128;
  const alefShare = (parts[2][0] ? parts[2][0][2] : 0) / 128;
  const sweep = {};
  for (const extra of [0.05, 0.25, 0.5, 0.75]) { const w = widthOfFirstTwo + alefShare * extra; sweep[extra] = { width: w, ...lines(family, 16, w, word, 'direction: rtl;') }; }
  const c = ctx(family, 32, 'rtl'), ltr = ctx(family, 32, 'ltr'), spaced = ctx(family, 32, 'rtl', '4px'), noLiga = ctx(family, 32, 'rtl', '0.015625px');
  const big = [1, 2, 3].map(k => ctx(family, 32 * 2 ** k, 'rtl'));
  const strings = { lamAlef: LAM + ALEF, lamZwjAlef: LAM + ZWJ + ALEF, lamZwnjAlef: LAM + ZWNJ + ALEF, lamWjAlef: LAM + WJ + ALEF, lamCgjAlef: LAM + CGJ + ALEF, lamTatweelAlef: LAM + TATWEEL + ALEF, lamKasraAlef: LAM + KASRA + ALEF, lamZwj: LAM + ZWJ, zwjAlef: ZWJ + ALEF, zwjTatweelZwj: ZWJ + TATWEEL + ZWJ, lam: LAM, alef: ALEF, word, wordZwj: BEH + LAM + ZWJ + ALEF + BEH, behLamZwj: BEH + LAM + ZWJ, zwjAlefBeh: ZWJ + ALEF + BEH };
  const canvas = {};
  for (const name of Object.keys(strings)) canvas[name] = { rtl: m(c, strings[name]), ltr: m(ltr, strings[name]), spaced: m(spaced, strings[name]), noLiga: m(noLiga, strings[name]), big: big.map(x => m(x, strings[name])) };
  canvas.lamAlefOverride = { ltr: m(ltr, LRO + LAM + ALEF + PDF) };
  out.families[family] = { listed, parts, firstTwo, sweep, canvas };
}
return out;
`

export default function probes(): Probe[] {
  const fixtures = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Shantell Sans', 'ProbeShantell']
  return [
    { id: 'blink-cr5 Z zero-advance cluster of an ignorable and a mark', spec: 'blink-RESULTS correctness round 5', pageLang: 'en', fontFixtures: fixtures, observe: [{ kind: 'script', source: Z }], browsers: ['chrome'], note: 'Per case: line count by height, and per UTF-16 unit every Range rect as [x, line, width] in 1/128 px.' },
    { id: 'blink-cr5 K pair placement', spec: 'blink-RESULTS correctness round 5', pageLang: 'en', fontFixtures: fixtures, observe: [{ kind: 'script', source: K }], browsers: ['chrome'], note: 'Canvas [width, inkLeft, inkRight] in 1/65536 px at 36px (18px at DPR 2) and at 36px times 2^k; DOM Range rects in 1/128 px at 18px.' },
    { id: 'blink-cr5 L lam-alef cluster membership', spec: 'blink-RESULTS correctness round 5', pageLang: 'en', fontFixtures: fixtures, observe: [{ kind: 'script', source: L }], browsers: ['chrome'], note: 'Canvas [width, inkLeft, inkRight] in 1/65536 px at 32px (16px at DPR 2); DOM Range rects in 1/128 px at 16px.' },
  ]
}
