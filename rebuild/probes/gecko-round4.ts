// Gecko port round 4 probes F20 to F27 (pinned Firefox 156, DPR 2). Measurement only: Range rects of text nodes in au
// (px × 60) and measureText widths from a main-thread OffscreenCanvas. Every probe returns `checks` (name, measured,
// expected, ok) and `pre` (what a claim depends on), so each gives facts (rebuild/tests/facts.ts).
// - F20, the unbounded frame of F18, traced: gfxTextRun::ComputeLigatureData divides a ligature group's signed advance by an
//   unsigned cluster count (gfxTextRun.cpp:249-289), so a group with a negative advance, cut by a frame edge, gives the part
//   before the cut 2^32 + W au, and the frame takes nscoord_MAX (nsTextFrame.cpp:11272-11273). Under kerx marks keep their
//   advances (hb-ot-shape.cc:189-191). Per pair of marks after reh in "Geeza Pro": the marks' advance, and whether a span
//   edge between them gives an unbounded frame.
// - F21, tab positions (CalcTabWidths, nsTextFrame.cpp:4306-4378): a character adds its cluster's advance only where it
//   starts a cluster, and spacing is asked for one character at a time, so a mark is its own base.
// - F22, an in-word position 1 au off where the two sides measured with U+200D add up to the unit (Noto Nastaliq Urdu,
//   held-out c-2fb217d962864f20: sad in `صنم` is 912 au natively and 911 au as W(sad U+200D)).
// - F23, a spacing mark that starts a cluster (U+1038 in "Myanmar MN"): alone it shapes as a broken syllable with a dotted
//   circle (hb-ot-shaper-syllabic.cc:32-99), so the suffix from it doesn't measure as in the unit.
// - F24, synthetic bold on an OffscreenCanvas: the DOM adds NS_round(offset(device size) × apd) per glyph-holding character,
//   Canvas NS_round(offset(CSS size) × 60), with offset(s) = 0.25 + 0.75 s / 48 below 48px (gfxFont.h:1899-1904,
//   gfxFont.cpp:901-939, :3551-3562): the residual class `gecko/synthetic-bold-offset`.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-round4 -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-round4.ts --out=.artifacts/probes/gecko/round4
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const checks = [];
const pre = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, measured, expected, ok) => { checks.push({ name, measured, expected, ok: ok === undefined ? same(measured, expected) : ok === true }); };
const need = (name, measured, expected, ok) => { pre.push({ name, measured, expected, ok: ok === undefined ? same(measured, expected) : ok === true }); };
const apd = Math.max(1, Math.floor(60 / window.devicePixelRatio + 0.5));
const oc = (font, lang, direction, text, letterSpacing) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = lang; c.font = font; c.direction = direction; c.letterSpacing = letterSpacing || '0px';
  return Math.round(c.measureText(text).width * 60);
};
// Per part one span with one text node; per node the rects of the whole node and of each code point, as [x, width] in au.
const dom = (style, lang, parts) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; ' + style;
  div.lang = lang;
  const nodes = parts.map(p => { const s = document.createElement('span'); if (p.style) s.style.cssText = p.style; const n = document.createTextNode(p.text === undefined ? p : p.text); s.append(n); div.append(s); return n; });
  host.append(div);
  const origin = div.getBoundingClientRect();
  const range = document.createRange();
  const au = r => [Math.round((r.left - origin.left) * 60), Math.round(r.width * 60), Math.round(r.top - origin.top)];
  const out = nodes.map(node => {
    range.selectNodeContents(node);
    const whole = [...range.getClientRects()].map(au);
    const points = [];
    for (let i = 0; i < node.data.length;) {
      const len = node.data.codePointAt(i) > 0xffff ? 2 : 1;
      range.setStart(node, i); range.setEnd(node, i + len);
      points.push([...range.getClientRects()].map(au));
      i += len;
    }
    return { text: node.data, whole, points };
  });
  div.remove();
  return out;
};
const widthOf = rects => rects.reduce((a, r) => a + r[1], 0);
`

const F20 = String.raw`
const geeza = '400 20px "Geeza Pro"';
const reh = 'ر';
const marks = { fatha: 'َ', damma: 'ُ', kasra: 'ِ', shadda: 'ّ', sukun: 'ْ', fathatan: 'ً' };
const block = 'white-space: normal; width: 400px; direction: rtl; font: ';
// nscoord_MAX is 2^30 − 1 au, 17895697.05px, which float32 holds as 17895698px: × 60 is 1073741880.
const UNBOUNDED = 1073741880;
// HarfBuzz's modified combining classes for Arabic marks (hb-unicode.hh, _hb_modified_combining_class): shadda first.
const order = { shadda: 27, fathatan: 28, fatha: 31, damma: 32, kasra: 33, sukun: 34 };
const rows = [];
for (const [a, first] of Object.entries(marks)) for (const [b, second] of Object.entries(marks)) {
  if (a === b) continue;
  const cut = dom(block + geeza, 'ar', [reh + first, second + 'حيم']);
  const uncut = widthOf(dom(block + geeza, 'ar', [reh + first + second + 'حيم'])[0].whole);
  // The marks in a span of their own: a frame is at least 0 wide (nsTextFrame.cpp:11272-11273), so where the marks' glyphs
  // advance by less than 0 the three frames are wider than the uncut node by that much.
  const apart = dom(block + geeza, 'ar', [reh, first + second, 'حيم']);
  const excess = widthOf(apart[0].whole) + widthOf(apart[1].whole) + widthOf(apart[2].whole) - uncut;
  rows.push({ pair: a + ' ' + b, reordered: order[a] > order[b], marksAdvance: -excess, canvasMarksAdvance: oc(geeza, 'ar', 'rtl', reh + first + second) - oc(geeza, 'ar', 'rtl', reh), firstFrame: cut[0].whole.map(r => r[1]), secondFrame: cut[1].whole.map(r => r[1]), uncut });
}
const unbounded = rows.filter(r => r.firstFrame.includes(UNBOUNDED));
need('some pair of marks after reh advances by less than 0 in "Geeza Pro" (marks keep their advances under kerx)', rows.filter(r => r.marksAdvance < 0).length > 0, true);
check('reh fatha | shadda in 20px "Geeza Pro": the frame before the cut is nscoord_MAX wide (2^30 − 1 au through float32)', rows.find(r => r.pair === 'fatha shadda').firstFrame, [UNBOUNDED]);
check('reh fatha | shadda: the frame after the cut is 0 wide', rows.find(r => r.pair === 'fatha shadda').secondFrame, [0]);
check('every unbounded cut is between marks that advance by less than 0 (ComputeLigatureData divides a signed advance by an unsigned count)', unbounded.map(r => [r.pair, r.marksAdvance < 0]), unbounded.map(r => [r.pair, true]));
check('every pair HarfBuzz reorders, which merges the two marks\' clusters, is unbounded when cut', rows.filter(r => r.reordered).map(r => [r.pair, r.firstFrame.includes(UNBOUNDED)]), rows.filter(r => r.reordered).map(r => [r.pair, true]));
check('supplementary: Canvas totals don\'t show the marks\' advance, the base takes it back', rows.map(r => r.canvasMarksAdvance).filter(x => x !== 0), []);
const sum = list => list.reduce((x, y) => x + y, 0);
const bounded = rows.filter(r => !r.firstFrame.includes(UNBOUNDED));
check('supplementary: a cut that is not unbounded keeps the word, the two frames add up to the uncut node', bounded.map(r => [r.pair, sum(r.firstFrame) + sum(r.secondFrame) - r.uncut]), bounded.map(r => [r.pair, 0]));
// OpenType positioning zeroes mark advances (hb-ot-shape.cc:189-191, :1051-1070), so the same cut is bounded in Arial.
const arial = '400 20px Arial';
const arialCut = dom(block + arial, 'ar', [reh + marks.fatha, marks.shadda + 'حيم']);
const arialUncut = dom(block + arial, 'ar', [reh + marks.fatha + marks.shadda + 'حيم']);
check('reh fatha | shadda in 20px Arial: bounded, and the two frames add up to the uncut node', widthOf(arialCut[0].whole) + widthOf(arialCut[1].whole), widthOf(arialUncut[0].whole));
check('Arial: the marks after reh have no advance', oc(arial, 'ar', 'rtl', reh + marks.fatha + marks.shadda) - oc(arial, 'ar', 'rtl', reh), 0);
// A cut before both marks is a ligature group start, so nothing is divided.
const before = dom(block + geeza, 'ar', [reh, marks.fatha + marks.shadda + 'حيم']);
check('reh | fatha shadda in "Geeza Pro": bounded', before[0].whole.concat(before[1].whole).some(r => r[1] === UNBOUNDED), false);
return { apd, rows, arial: { cut: arialCut.map(n => n.whole), uncut: arialUncut.map(n => n.whole) }, before: before.map(n => n.whole), checks, pre };
`

const F21 = String.raw`
const deva = '400 20px "Kohinoor Devanagari"';
const pre1 = 'white-space: pre; tab-size: 8; font: ';
const space = widthOf(dom(pre1 + deva, 'hi', ['a a'])[0].points[1]);
const tabWidth = 8 * space;
// A span that starts at U+094B inside the cluster of U+0926, with a tab in it.
const split = dom(pre1 + deva, 'hi', ['द', 'ो\tx']);
const markPart = widthOf(split[1].points[0]);
const tab = split[1].points[1][0];
const whole = dom(pre1 + deva, 'hi', ['दो\tx']);
const wholeTab = whole[0].points[2][0];
need('the mark that starts the span has a part of the cluster of its own', markPart > 0, true);
check('a whole cluster before a tab: the tab ends at a stop', (wholeTab[0] + wholeTab[1]) % tabWidth, 0);
check('a span that starts inside a cluster: its tab ends past a stop by the part of the cluster it holds', (tab[0] + tab[1]) % tabWidth, markPart);
// Letter spacing: a cursive cluster takes none, but CalcTabWidths asks for one character at a time, so the mark is its own
// base and the position counts the spacing the frame doesn't have. Everything is at level 1 of a right-to-left block, so
// the tab stays inside one frame and one text run.
const arial = '400 20px Arial';
const spaced = 'white-space: pre; tab-size: 8; direction: rtl; letter-spacing: 1px; font: ';
const spaceArial = widthOf(dom('white-space: pre; font: ' + arial, 'ar', ['ب ب'])[0].points[1]);
const stop = 8 * (spaceArial + 60);
const arabic = dom(spaced + arial, 'ar', ['بَ\tب'])[0];
const hebrew = dom(spaced + arial, 'he', ['בַ\tב'])[0];
const before = n => widthOf(n.points[0]) + widthOf(n.points[1]);
need('the cursive cluster takes no letter spacing: beh with fatha under 1px is as wide as without', before(arabic), widthOf(dom('white-space: pre; direction: rtl; font: ' + arial, 'ar', ['بَ\tب'])[0].points[0]) + widthOf(dom('white-space: pre; direction: rtl; font: ' + arial, 'ar', ['بَ\tب'])[0].points[1]));
check('beh fatha tab under 1px letter spacing: the tab ends 60 au short of the stop (the mark alone is not cursive)', before(arabic) + widthOf(arabic.points[2]), stop - 60);
check('bet patah tab under 1px letter spacing: the tab ends at the stop', before(hebrew) + widthOf(hebrew.points[2]), stop);
return { apd, space, tabWidth, split: split.map(n => n.points), whole: whole[0].points, spaceArial, stop, arabic: arabic.points, hebrew: hebrew.points, checks, pre };
`

const F22 = String.raw`
const family = '"Noto Nastaliq Urdu"';
const font = '400 20px ' + family;
const word = 'صنم';
const ZWJ = '‍';
const node = dom('white-space: pre; direction: rtl; font: ' + font, 'ur', [word])[0];
const domSad = widthOf(node.points[0]);
const unit = oc(font, 'ur', 'rtl', word);
const prefix = oc(font, 'ur', 'rtl', 'ص' + ZWJ);
const suffix = oc(font, 'ur', 'rtl', ZWJ + 'نم');
// The prefix at 2^k times the size, in au of the 20px size: its advance before rounding.
const scaled = [];
for (let k = 1; k <= 6; k++) {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = 'ur'; c.direction = 'rtl'; c.font = '400 ' + (20 * 2 ** k) + 'px ' + family;
  scaled.push(+(c.measureText('ص' + ZWJ).width * 60 / 2 ** k).toFixed(4));
}
need('the DOM unit equals the Canvas unit', widthOf(node.whole), unit);
need('the two sides measured with U+200D add up to the unit', prefix + suffix, unit);
check('supplementary: sad in the DOM against W(sad U+200D), in au', domSad - prefix, 1);
check('supplementary: the prefix before rounding, read at 64 times the size, lies within 1/64 au of a half app unit', Math.abs(scaled[5] - Math.floor(scaled[5]) - 0.5) <= 1 / 64 + 1e-9, true);
return { apd, domPoints: node.points, domSad, unit, prefix, suffix, scaled, checks, pre };
`

const F23 = String.raw`
const font = '400 20px "Myanmar MN"';
const word = 'ငါး';
const node = dom('white-space: pre; font: ' + font, 'my', [word])[0];
const w = s => oc(font, 'my', 'ltr', s);
const visarga = widthOf(node.points[2]);
const beforeVisarga = node.points[2][0][0] - node.points[0][0][0];
need('"Myanmar MN" draws the word: the DOM node equals the Canvas unit', widthOf(node.whole), w(word));
need('U+1038 starts a cluster: it has a rect of its own', visarga > 0 && widthOf(node.points[1]) > 0, true);
check('the prefix that ends before U+1038 measures the DOM position before it', w('ငါ'), beforeVisarga);
check('U+1038 alone is wider than in the word: a broken syllable gets a dotted circle', w('း') > visarga, true);
check('U+102B U+1038 alone is two broken syllables: W(U+102B U+1038) = W(U+102B) + W(U+1038)', w('ါး'), w('ါ') + w('း'));
return { apd, points: node.points, canvas: { word: w(word), prefix: w('ငါ'), visargaAlone: w('း'), aaAlone: w('ါ'), aaVisarga: w('ါး'), dottedCircle: w('◌'), dottedVisarga: w('◌း') }, checks, pre };
`

const F24 = String.raw`
const nsRound = x => x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
const offset = size => size < 48 ? 0.25 + 0.75 * size / 48 : size / 48;
const dpr = window.devicePixelRatio;
// U+2764 has no glyph in "Helvetica Neue": a fallback font without a bold face draws it, with synthetic bold.
const rows = [];
for (const family of ['"Helvetica Neue"', 'Georgia', 'Arial']) for (const size of [12, 14, 16, 18, 20, 24, 28, 32]) {
  const bold = '700 ' + size + 'px ' + family;
  const regular = '400 ' + size + 'px ' + family;
  const domBold = widthOf(dom('white-space: pre; font: ' + bold, 'en', ['❤'])[0].whole);
  const domRegular = widthOf(dom('white-space: pre; font: ' + regular, 'en', ['❤'])[0].whole);
  const ocBold = oc(bold, 'en', 'ltr', '❤');
  const ocRegular = oc(regular, 'en', 'ltr', '❤');
  rows.push({ family, size, domBold, domRegular, ocBold, ocRegular, canvasBoldStep: nsRound(offset(size) * 60), domBoldStep: nsRound(offset(size * dpr) * apd) });
}
const synthetic = rows.filter(r => r.ocBold - r.ocRegular === r.canvasBoldStep);
need('some row is synthetic bold: Canvas at weight 700 less weight 400 is NS_round(offset(size) × 60)', synthetic.length > 0, true);
check('synthetic bold in the DOM: weight 700 less weight 400 is NS_round(offset(device size) × apd)', synthetic.map(r => [r.family, r.size, r.domBold - r.domRegular]), synthetic.map(r => [r.family, r.size, r.domBoldStep]));
check('the DOM less the OffscreenCanvas, per synthetic bold glyph: the two steps\' difference, and nothing at weight 400', synthetic.map(r => [r.family, r.size, r.domBold - r.ocBold, r.domRegular - r.ocRegular]), synthetic.map(r => [r.family, r.size, r.domBoldStep - r.canvasBoldStep, 0]));
// The keycap heart of ceiling round 2 (c-a2661c5b12f20aec).
const heart = dom('white-space: pre; font: 700 14px "Helvetica Neue"', 'en', ['⃣❤'])[0];
check('U+20E3 U+2764 in bold 14px "Helvetica Neue": DOM 786 au, OffscreenCanvas 793', [widthOf(heart.whole), oc('700 14px "Helvetica Neue"', 'en', 'ltr', '⃣❤')], [786, 793]);
// A bitmap emoji under a bold font: the device-size recipe reads the advance with the step inside it.
const emoji = [];
for (const size of [16, 18, 20, 24]) {
  const domBold = widthOf(dom('white-space: pre; font: 700 ' + size + 'px Arial', 'en', ['😀'])[0].whole);
  const domRegular = widthOf(dom('white-space: pre; font: 400 ' + size + 'px Arial', 'en', ['😀'])[0].whole);
  const deviceBold = oc('700 ' + (size * dpr) + 'px Arial', 'en', 'ltr', '😀');
  const deviceRegular = oc('400 ' + (size * dpr) + 'px Arial', 'en', 'ltr', '😀');
  emoji.push({ size, domBold, domRegular, deviceBold, deviceRegular, recipe: Math.floor(deviceBold * apd / 60 + 0.5), bySteps: Math.floor(deviceRegular * apd / 60 + 0.5) + nsRound(offset(size * dpr) * apd) });
}
check('a bold bitmap emoji in the DOM: the regular device advance at the page\'s apd plus NS_round(offset(device size) × apd)', emoji.map(r => [r.size, r.domBold]), emoji.map(r => [r.size, r.bySteps]));
check('supplementary: the device-size recipe over the bold Canvas advance, against the DOM, in au', emoji.map(r => [r.size, r.recipe - r.domBold]), emoji.map(r => [r.size, 0]));
return { apd, rows, emoji, heart: heart.points, checks, pre };
`

// - F25, which cluster of a cursive run with a marked cluster takes letter spacing (eval-r3-2 c-f3e8314c35b33990: three
//   Phags-pa letters and U+0301 in 16px "Courier New" under 1px; natively 699, 685 and 676 au where the port's in-word
//   stand-ins are 631, 685 and 684).
const F25 = String.raw`
const courier = '400 16px "Courier New"';
const text = 'ꡀꡁꡂ́';
const at = ls => dom('white-space: pre; letter-spacing: ' + ls + 'px; font: ' + courier, 'en', [text])[0].points.map(widthOf);
const plain = at(0), one = at(1), four = at(4);
need('without letter spacing the DOM node equals the Canvas unit', plain.reduce((a, b) => a + b, 0), oc(courier, 'en', 'ltr', text));
check('under 1px of letter spacing only the cluster holding U+0301 grows, by 60 au', one.map((w, i) => w - plain[i]), [0, 0, 0, 60]);
check('under 4px it grows by 240 au', four.map((w, i) => w - plain[i]), [0, 0, 0, 240]);
check('the letters alone take none: Phags-pa is a cursive script', dom('white-space: pre; letter-spacing: 4px; font: ' + courier, 'en', ['ꡀꡁꡂ'])[0].points.map(widthOf), dom('white-space: pre; font: ' + courier, 'en', ['ꡀꡁꡂ'])[0].points.map(widthOf));
return { apd, plain, one, four, checks, pre };
`

// - F26, the suffix-side in-word recipe (lines.ts inWordAdvance): where the cluster before an offset has no joining forms and
//   W(cluster and suffix) − W(suffix) − W(cluster) = 0, the advance before the offset is W(unit) − W(suffix). Per word and
//   cluster boundary, in scripts without cursive joining: the DOM's position against the recipe, leaving out offsets where
//   the ink box shows a ligature (letterSpacing 0.001px turns optional ligatures off, probe F9).
const F26 = String.raw`
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const boxOf = (font, lang, text, ls) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = lang; c.font = font; c.letterSpacing = ls; const m = c.measureText(text); return [Math.round(m.width * 60), m.actualBoundingBoxLeft, m.actualBoundingBoxRight]; };
const words = {
  en: ['firstname', 'office', 'AVATAR', 'Wave', 'Typography', "city's", 'fjord', 'Yo-yo', 'W.A.V.E', 'r,a.T', 'different', 'waffle'],
  ru: ['Привет', 'Уголок', 'ГАТЧИНА'],
  el: ['Αυτοκίνητο', 'Υγεία'],
  he: ['שלום', 'ירושלים'],
  th: ['ทำให้', 'ผู้คน', 'กุสมาวดี'],
  hi: ['नमस्ते', 'क्षत्रिय', 'हिन्दी'],
  ja: ['日本語の', 'タイポグラフィ'],
  ko: ['한국어', '타이포'],
};
const fonts = { en: ['400 16px Arial', '400 14px "Helvetica Neue"', '400 18px "Times New Roman"', '400 16px Verdana', '400 13px Georgia', '700 15px Helvetica', '400 16px "Courier New"', '400 16px Menlo'], ru: ['400 16px Arial', '400 18px "Times New Roman"', '400 16px Verdana'], el: ['400 16px Arial', '400 18px "Times New Roman"'], he: ['400 16px Arial', '400 18px "Times New Roman"'], th: ['400 20px Thonburi', '400 16px Arial'], hi: ['400 16px "Kohinoor Devanagari"', '400 16px Arial'], ja: ['400 18px "Hiragino Sans"'], ko: ['400 18px "Apple SD Gothic Neo"'] };
const rows = [];
let cuts = 0;
for (const lang of Object.keys(words)) for (const font of fonts[lang]) for (const text of words[lang]) {
  const direction = lang === 'he' ? 'rtl' : 'ltr';
  const node = dom('white-space: pre; direction: ' + direction + '; font: ' + font, lang, [text])[0];
  const unit = oc(font, lang, direction, text);
  if (widthOf(node.whole) !== unit) { rows.push({ font, text, skipped: 'the DOM node is not the Canvas unit (the 1 au class, or another font)' }); continue; }
  const clusters = [...seg.segment(text)].map(g => g.index);
  // Per code point widths, by UTF-16 offset.
  const widthAt = []; let o = 0;
  for (const p of node.points) { widthAt.push([o, widthOf(p)]); o += text.codePointAt(o) > 0xffff ? 2 : 1; }
  for (let k = 1; k < clusters.length; k++) {
    const t = clusters[k], a = clusters[k - 1];
    const cluster = text.slice(a, t), suffix = text.slice(t);
    const across = oc(font, lang, direction, cluster + suffix) - oc(font, lang, direction, suffix) - oc(font, lang, direction, cluster);
    if (across !== 0) continue;
    const pair = text.slice(a, clusters[k + 1] === undefined ? text.length : clusters[k + 1]);
    const on = boxOf(font, lang, pair, '0px'), off = boxOf(font, lang, pair, '0.001px');
    if (on[0] !== off[0] || on[1] !== off[1] || on[2] !== off[2]) continue;
    cuts++;
    const domBefore = widthAt.filter(w => w[0] < t).reduce((x, w) => x + w[1], 0);
    const recipe = unit - oc(font, lang, direction, suffix);
    if (domBefore !== recipe) rows.push({ font, text, t, domBefore, recipe });
  }
}
need('the recipe applies at many offsets', cuts > 300, true);
check('where nothing crosses an offset by the three-string test and the ink box shows no ligature, W(unit) − W(suffix) is the DOM advance before it', rows.filter(r => r.skipped === undefined), []);
return { apd, cuts, rows, checks, pre };
`

// - F27, the units of the residual class gecko/one-shaping-unit-one-app-unit that the round 4 sets met beyond F7's and F13's
//   strings: per word of each node, the DOM box against an OffscreenCanvas at the CSS size.
const F27 = String.raw`
const nodes = [
  ['400 10px "Helvetica Neue"', 'en', 'ltr', 'Ty To Yo LT: kerning'],
  ['700 32px Thonburi', 'th', 'ltr', 'รมชาติทำให้ผู้คนมีความสุขมากขึ้'],
  ['500 32px Thonburi', 'th', 'ltr', 'รมชาติทำให้ผู้คนมีคว'],
  ['400 10px "Geeza Pro"', 'ar', 'rtl', 'خروج تروك'],
  ['400 10px "Geeza Pro"', 'ar', 'rtl', 'ووفقك لطاعته'],
  ['300 10px "Geeza Pro"', 'ar', 'rtl', 'على شكره ووفقك'],
  ['400 15px "Helvetica Neue", Helvetica, Arial, sans-serif', 'en', 'ltr', 'In the heart of you can find ancient mosques alongside modern cafés.'],
];
const rows = [];
for (const [font, lang, direction, text] of nodes) for (const word of text.split(' ')) {
  const box = widthOf(dom('white-space: pre; direction: ' + direction + '; font: ' + font, lang, [word])[0].whole);
  rows.push([font, word, oc(font, lang, direction, word) - box]);
}
check('an OffscreenCanvas at the CSS size is within 1 au of the DOM box on every word', rows.filter(r => Math.abs(r[2]) > 1), []);
check('the words where it is 1 au off, OffscreenCanvas less DOM', rows.filter(r => r[2] !== 0), [['400 10px "Helvetica Neue"', 'LT:', 1], ['700 32px Thonburi', 'รมชาติทำให้ผู้คนมีความสุขมากขึ้', -1], ['500 32px Thonburi', 'รมชาติทำให้ผู้คนมีคว', -1], ['400 10px "Geeza Pro"', 'تروك', -1], ['400 10px "Geeza Pro"', 'ووفقك', -1], ['300 10px "Geeza Pro"', 'ووفقك', -1], ['400 15px "Helvetica Neue", Helvetica, Arial, sans-serif', 'modern', 1]]);
return { apd, rows, checks, pre };
`

export default function probes(): Probe[] {
  const probe = (id: string, spec: string, source: string, fontFixtures?: string[]): Probe => ({
    id,
    spec,
    pageLang: 'en',
    observe: [{ kind: 'script', source: HELPERS + source }],
    browsers: ['firefox'],
    note: 'Measurement only.',
    ...(fontFixtures === undefined ? {} : { fontFixtures }),
  })
  return [
    probe('gecko-port F20', 'gecko-port F20: a frame edge inside a ligature group with a negative advance', F20),
    probe('gecko-port F21', 'gecko-port F21: tab positions count cluster starts and single-character spacing', F21),
    probe('gecko-port F22', 'gecko-port F22: an in-word position 1 au off where the sides add up', F22, ['Noto Nastaliq Urdu']),
    probe('gecko-port F23', 'gecko-port F23: a spacing mark that starts a cluster shapes alone as a broken syllable', F23),
    probe('gecko-port F24', 'gecko-port F24: synthetic bold on an OffscreenCanvas', F24),
    probe('gecko-port F25', 'gecko-port F25: letter spacing on a cursive run whose last cluster holds a mark of another font', F25),
    probe('gecko-port F26', 'gecko-port F26: the suffix-side in-word recipe against the DOM', F26),
    probe('gecko-port F27', 'gecko-port F27: words an OffscreenCanvas measures 1 au off the DOM', F27),
  ]
}
