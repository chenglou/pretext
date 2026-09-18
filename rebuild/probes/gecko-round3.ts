// Gecko port round 3 probes F13 and F14 (installed Firefox 156, DPR 2). Measurement only: Range rects of text nodes in au
// (px × 60) and measureText widths from a main-thread OffscreenCanvas ("oc") and a detached `<canvas>` element ("ec").
// - F13, the 1 au class (research/ROUND2-CRITIC.md item 4). The DOM shapes at the device font size (CSS size × 60 / apd) and
//   rounds each glyph at the page's apd (gfxHarfBuzzShaper.cpp:1559, :1699-1702); an OffscreenCanvas shapes at the CSS size
//   and rounds at apd 60. A canvas element's text run has the page's apd, and its font group's device size is the canvas
//   font size (CanvasRenderingContext2D.cpp, SetFontInternal: `resizedFont.size` is the size over the CSS-to-device scale).
//   So an element canvas whose font size is the DOM's device size should hold the DOM's glyph advances: width × apd.
//   Per unit: the DOM box, oc and ec at the CSS size, oc and ec at the device size, and oc at the CSS size × 2^k.
// - F14, synthetic bold (c-a2661c5b12f20aec: U+2764 in bold 14px Helvetica Neue, 786 au natively, 793 predicted).
//   gfxFont::GetSyntheticBoldOffset is 0.25 + 0.75 × size / 48 device px below 48px (gfxFont.h:1899-1904), added per
//   glyph-holding character as NS_round(offset × apd) (gfxFont.cpp:3551-3562, :901-939): not linear in the device size, so
//   Canvas at the CSS size adds another amount than the DOM. Per string: the DOM's code point rects, and oc at weights 400
//   and 700 at the CSS and the device size.
//
// Each probe returns its raw values with `checks` and `pre` over them (added in round 4; F19's rows are under `rows`).
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-round3 -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-round3.ts --out=.artifacts/probes/gecko/round3
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const dpr = window.devicePixelRatio;
const ctxOf = (kind, font, lang, direction) => {
  const c = kind === 'oc' ? new OffscreenCanvas(1, 1).getContext('2d') : document.createElement('canvas').getContext('2d');
  c.lang = lang; c.font = font; c.direction = direction;
  return c;
};
const px = (kind, font, lang, direction, text) => ctxOf(kind, font, lang, direction).measureText(text).width;
const dom = (font, lang, direction, parts) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre; direction: ' + direction;
  div.lang = lang;
  const nodes = parts.map(p => {
    const s = document.createElement('span'); s.style.font = p.font || font; const n = document.createTextNode(p.text); s.append(n); div.append(s); return n;
  });
  host.append(div);
  const range = document.createRange();
  const out = nodes.map(node => {
    range.selectNodeContents(node);
    const whole = [...range.getClientRects()].reduce((a, r) => a + r.width, 0) * 60;
    const points = [];
    for (let i = 0; i < node.data.length;) {
      const len = node.data.codePointAt(i) > 0xffff ? 2 : 1;
      range.setStart(node, i); range.setEnd(node, i + len);
      points.push(+([...range.getClientRects()].reduce((a, r) => a + r.width, 0) * 60).toFixed(3));
      i += len;
    }
    return { text: node.data, whole: +whole.toFixed(3), points };
  });
  div.remove();
  return out;
};
`

const F13 = String.raw`
const unit = (weight, size, family, lang, direction, text) => {
  const css = weight + ' ' + size + 'px ' + family;
  const dev = weight + ' ' + (size * dpr) + 'px ' + family;
  const pow = [];
  for (let k = 1; k <= 5 && size * 2 ** k <= 1024; k++) pow.push(+(px('oc', weight + ' ' + (size * 2 ** k) + 'px ' + family, lang, direction, text) * 60).toFixed(4));
  return {
    text, css,
    dom: dom(css, lang, direction, [{ text }])[0].whole,
    ocCss: +(px('oc', css, lang, direction, text) * 60).toFixed(4),
    ecCss: +(px('ec', css, lang, direction, text) * 60).toFixed(4),
    ocDev: +(px('oc', dev, lang, direction, text) * 60).toFixed(4),
    // A canvas element's au per device unit is the page's: 60 / dpr.
    ecDev: +(px('ec', dev, lang, direction, text) * 60 / dpr).toFixed(4),
    pow,
  };
};
const paragraph = "In the heart of القاهرة القديمة, you can find ancient mosques alongside modern cafés. The city's history spans millennia. كل شارع يحكي قصة مختلفة about the rich cultural heritage.";
const hn = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const out = { dpr, units: [] };
for (const w of ['รมชาติทำให้ผู้คนมีคว', 'รมชาติทำให้ผู้คนมี', 'รมชาติ', 'ทำให้', 'ผู้คน', 'มีคว']) out.units.push(unit(500, 32, 'Thonburi', 'en', 'ltr', w));
for (const w of ['على', 'شكره', 'ووفقك', 'لطاعته', 'وأعانك', 'به', 'المرابحة', 'عند', 'سوق،', 'وما']) for (const wt of [300, 400, 500, 700]) out.units.push(unit(wt, 10, '"Geeza Pro"', 'en', 'rtl', w));
for (const w of paragraph.split(' ')) out.units.push(unit(400, 15, hn, 'en', w.charCodeAt(0) > 0x500 ? 'rtl' : 'ltr', w));
for (const w of ['LT:', 'kerning', 'pairs']) out.units.push(unit(700, 10, '"Helvetica Neue"', 'en', 'ltr', w));
const latin = ['workers', 'straight', 'modern', 'Typography', 'AVATAR', 'Wave.', 'office', 'finally', 'Yo', 'To', "city's"];
for (const w of latin) for (const [wt, sz, fam] of [[400, 16, 'Arial'], [400, 13, 'Georgia'], [400, 17, '"Times New Roman"'], [700, 11, '"Helvetica Neue"'], [400, 14, '"Helvetica Neue"'], [400, 15, 'Verdana'], [400, 12, 'Helvetica'], [400, 16, 'Menlo'], [400, 18, '"Courier New"'], [400, 16, 'system-ui'], [400, 13, '-apple-system']]) out.units.push(unit(wt, sz, fam, 'en', 'ltr', w));
for (const w of ['中文排版', '日本語の', '한국어', 'שלום', 'नमस्ते', '😀', '👍🏽', '1️⃣', '🏳️‍🌈', '©︎', '☺']) for (const [wt, sz, fam] of [[400, 16, 'Arial'], [400, 14, '"Helvetica Neue"'], [400, 18, '"Hiragino Sans"'], [400, 17, '"PingFang SC"']]) out.units.push(unit(wt, sz, fam, 'en', w === 'שלום' ? 'rtl' : 'ltr', w));
return out;
`

const F14 = String.raw`
const rows = [];
const row = (size, family, lang, direction, parts) => {
  const font = w => w + ' ' + size + 'px ' + family;
  const devFont = w => w + ' ' + (size * dpr) + 'px ' + family;
  const canvas = parts.map(p => ({
    text: p.text,
    oc700: +(px('oc', font(p.weight), lang, direction, p.text) * 60).toFixed(4),
    oc400: +(px('oc', font(400), lang, direction, p.text) * 60).toFixed(4),
    oc700Dev: +(px('oc', devFont(p.weight), lang, direction, p.text) * 60).toFixed(4),
    oc400Dev: +(px('oc', devFont(400), lang, direction, p.text) * 60).toFixed(4),
    ec700Dev: +(px('ec', devFont(p.weight), lang, direction, p.text) * 60 / dpr).toFixed(4),
  }));
  rows.push({ size, family, dom: dom(font(400), lang, direction, parts.map(p => ({ text: p.text, font: font(p.weight) }))), canvas });
};
for (const size of [10, 12, 14, 16, 18, 20, 24, 26, 32]) {
  row(size, '"Helvetica Neue"', 'en', 'ltr', [{ text: '1️', weight: 400 }, { text: '⃣❤', weight: 700 }, { text: '️', weight: 400 }]);
  row(size, '"Helvetica Neue"', 'en', 'ltr', [{ text: '❤', weight: 700 }]);
  row(size, '"Helvetica Neue"', 'en', 'ltr', [{ text: 'a→b☺c', weight: 700 }]);
  row(size, 'Amiri', 'en', 'ltr', [{ text: 'Hello', weight: 700 }, { text: 'office', weight: 700 }]);
  row(size, 'Amiri', 'ar', 'rtl', [{ text: 'مرحبا', weight: 700 }, { text: 'لطاعته', weight: 700 }]);
  row(size, '"Apple Symbols"', 'en', 'ltr', [{ text: '→☺♞', weight: 700 }]);
  row(size, 'Arial', 'en', 'ltr', [{ text: 'Hello', weight: 700 }, { text: '中文', weight: 700 }, { text: 'שלום', weight: 700 }]);
  row(size, 'Menlo', 'en', 'ltr', [{ text: 'ab→', weight: 700 }]);
}
return { dpr, rows };
`

// - F15, in-word advances (research/ROUND2-CRITIC.md item 8; 974 of 1,013 development prediction failures sit under
//   `in-word-prefix` alone). The DOM sums the glyph records of one shaping of the whole unit (gfxTextRun.cpp:1214-1256), so a
//   letter before an in-word break keeps its joined form. Per word and cluster boundary t: the DOM's advance before t (the
//   code point rects of the unbroken word), and on a canvas element at the device size W(unit), W(prefix), W(suffix),
//   W(prefix + U+200D) and W(U+200D + suffix). U+200D is Join_Causing (ArabicShaping.txt), which HarfBuzz's Arabic shaper
//   reads for OpenType fonts (hb-ot-shaper-arabic.cc); an AAT font's morx decides for itself (gecko-AUDIT probe A2).
// - F16, how an odd pair adjustment divides (hb-kern.hh:102-106: kern1 = kern >> 1 on the first glyph, the rest on the
//   second, in 16.16 device px, each glyph then rounded to app units). Per pair: the DOM's two code point rects, and on the
//   element canvas at the device size × 2^k the pair, its first and its second glyph, so the unrounded advances and the
//   unrounded adjustment can be read to 2^-k au.
const F15 = String.raw`
const ZWJ = '‍';
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const word = (weight, size, family, lang, direction, text) => {
  const css = weight + ' ' + size + 'px ' + family;
  const dev = weight + ' ' + (size * dpr) + 'px ' + family;
  const c = ctxOf('ec', dev, lang, direction);
  const au = s => Math.round(c.measureText(s).width * 60 / dpr);
  const d = dom(css, lang, direction, [{ text }])[0];
  const cuts = [];
  let t = 0;
  for (const g of seg.segment(text)) {
    if (t > 0) cuts.push({ t, prefix: au(text.slice(0, t)), suffix: au(text.slice(t)), prefixZwj: au(text.slice(0, t) + ZWJ), zwjSuffix: au(ZWJ + text.slice(t)) });
    t += g.segment.length;
  }
  return { css, text, dom: d.points, domWhole: d.whole, unit: au(text), zwj: au(ZWJ), cuts };
};
const arabic = ['سلام', 'السلام', 'مرحبا', 'لطاعته', 'ووفقك', 'وأعانك', 'المرابحة', 'كِتَابٌ', 'اللَّهِ', 'الْعَرَبِيَّةُ', 'بب', 'ببب', 'لا', 'بلا', 'فلان', 'محمد', 'يحكي', 'مختلفة', 'القاهرة', 'هههه', 'نستعليق', 'ﷲ', 'لله'];
const out = { dpr, words: [] };
for (const [wt, sz, fam] of [[400, 24, 'Amiri'], [400, 16, 'Amiri'], [400, 16, '"Noto Naskh Arabic"'], [400, 20, '"Noto Naskh Arabic"'], [400, 16, '"Geeza Pro"'], [400, 14, '"Geeza Pro"'], [400, 16, 'Arial'], [400, 18, '"Times New Roman"'], [400, 16, '"Courier New"'], [400, 16, '"Noto Nastaliq Urdu"'], [400, 16, '"Shantell Sans"']]) for (const w of arabic) out.words.push(word(wt, sz, fam, 'ar', 'rtl', w));
for (const w of ['ᠮᠣᠩᠭᠣᠯ', 'ᠠᠡᠢ']) out.words.push(word(400, 16, 'Arial', 'mn', 'ltr', w));
for (const w of ['नमस्ते', 'क्षत्रिय', 'বাংলা']) out.words.push(word(400, 16, 'Arial', 'hi', 'ltr', w));
for (const w of ['firstname', 'office', 'AVATAR', 'Wave', 'Typography', "city's", 'fjord']) for (const [wt, sz, fam] of [[400, 16, 'Arial'], [400, 14, '"Helvetica Neue"'], [400, 18, '"Times New Roman"'], [400, 16, 'Verdana'], [400, 13, 'Georgia'], [400, 16, 'Amiri']]) out.words.push(word(wt, sz, fam, 'en', 'ltr', w));
return out;
`

const F16 = String.raw`
const pairs = ['AV', 'To', 'Wa', 'LT', 'Yo', 'yo', 'y,', 'r,', 'ra', 'xe', 'ke', 'T.', 'P,', 'Ty', 'rn', 've', 'fo', 'Vo', 'AT', 'ay'];
const out = { dpr, rows: [] };
for (const [wt, sz, fam] of [[400, 16, 'Verdana'], [400, 14, 'Verdana'], [400, 20, 'Verdana'], [400, 18, '"Times New Roman"'], [400, 17, '"Times New Roman"'], [400, 14, '"Helvetica Neue"'], [400, 15, '"Helvetica Neue"'], [700, 14, '"Helvetica Neue"'], [400, 12, 'Helvetica'], [400, 16, 'Arial'], [400, 13, 'Georgia']]) {
  for (const pair of pairs) {
    const css = wt + ' ' + sz + 'px ' + fam;
    const d = dom(css, 'en', 'ltr', [{ text: pair }])[0];
    const sizes = [];
    for (let k = 0; k <= 5 && sz * dpr * 2 ** k <= 1024; k++) {
      const c = ctxOf('ec', wt + ' ' + (sz * dpr * 2 ** k) + 'px ' + fam, 'en', 'ltr');
      const au = s => Math.round(c.measureText(s).width * 60 / dpr);
      sizes.push({ k, pair: au(pair), first: au(pair[0]), second: au(pair[1]) });
    }
    out.rows.push({ css, pair, dom: d.points, sizes });
  }
}
return out;
`

// - F17, ligature groups through Canvas letter spacing. CanvasBidiProcessor adds letter spacing after a character only where
//   the next one starts a cluster and a ligature group (CanvasRenderingContext2D.cpp:4759-4790), the glyph flags
//   ComputeLigatureData shares a ligature's width by (gfxTextRun.cpp:238-322). Letter spacing turns optional ligatures off,
//   so W(unit, 2px) − W(unit, 0.001px) over 2px counts the unit's ligature groups under required shaping. Per word: that
//   count, the grapheme clusters, and the DOM's code point rects, where a ligature shows as equal shares.
const F17 = String.raw`
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
const word = (weight, size, family, lang, direction, text) => {
  const css = weight + ' ' + size + 'px ' + family;
  const dev = weight + ' ' + (size * dpr) + 'px ' + family;
  const ctx = ls => { const c = ctxOf('ec', dev, lang, direction); c.letterSpacing = ls; return c; };
  const au = (c, s) => Math.round(c.measureText(s).width * 60 / dpr);
  const spaced = au(ctx('2px'), text), off = au(ctx('0.001px'), text), on = au(ctx('0px'), text);
  return { css, text, dom: dom(css, lang, direction, [{ text }])[0].points, graphemes: [...seg.segment(text)].length, on, off, spaced, groups: (spaced - off) / (2 * 60 / dpr) };
};
const out = { dpr, words: [] };
const arabic = ['سلام', 'السلام', 'مرحبا', 'لطاعته', 'المرابحة', 'كِتَابٌ', 'اللَّهِ', 'لله', 'الله.', 'لا', 'بلا', 'فلان', 'محمد', 'مختلفة', 'ﷲ'];
for (const [wt, sz, fam] of [[400, 24, 'Amiri'], [400, 16, '"Noto Naskh Arabic"'], [400, 16, '"Geeza Pro"'], [400, 16, 'Arial'], [400, 18, '"Times New Roman"'], [400, 16, '"Courier New"'], [400, 16, '"Noto Nastaliq Urdu"']]) for (const w of arabic) out.words.push(word(wt, sz, fam, 'ar', 'rtl', w));
for (const w of ['ฤา', 'ทำให้', 'ผู้คน', 'เวตาลเล่าว่า', 'กุสมาวดี']) for (const [wt, sz, fam] of [[400, 20, 'Thonburi'], [400, 16, 'Arial']]) out.words.push(word(wt, sz, fam, 'th', 'ltr', w));
for (const w of ['नमस्ते', 'क्षत्रिय', 'हिन्दी', 'বাংলা', 'ক্ষ', 'தமிழ்', 'မြန်မာ']) for (const [wt, sz, fam] of [[400, 16, 'Arial'], [400, 16, '"Kohinoor Devanagari"']]) out.words.push(word(wt, sz, fam, 'hi', 'ltr', w));
for (const w of ['firstname', 'office', 'AVATAR', 'fjord', 'ffl', 'Th', 'ct', 'st']) for (const [wt, sz, fam] of [[400, 14, '"Helvetica Neue"'], [400, 16, 'Arial'], [400, 16, 'Amiri'], [400, 16, 'Georgia'], [400, 18, '"Times New Roman"'], [400, 16, '"Hoefler Text"']]) out.words.push(word(wt, sz, fam, 'en', 'ltr', w));
return out;
`

// - F18, a grapheme cluster split across two spans of one text run (held-out c-4bbfaaafb6f3d47f, c-710f180e5314942f,
//   c-9c05c70ce585fb82: natively the continuation holding the cluster's base is 2^30 + 56 au wide and the word breaks
//   before it, though the word fits the line). Variants of that paragraph: which of word spacing, pre-wrap, direction, the
//   cut inside the cluster and the text before the word it takes.
const F18 = String.raw`
const build = (opts) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; overflow-wrap: break-word; font: ' + opts.font + '; width: ' + opts.width + 'px; white-space: ' + opts.whiteSpace + '; direction: ' + opts.direction;
  div.lang = opts.lang;
  const nodes = opts.runs.map(r => { const sp = document.createElement('span'); sp.style.wordSpacing = r.ws + 'px'; const n = document.createTextNode(r.text); sp.append(n); div.append(sp); return n; });
  host.append(div);
  const origin = div.getBoundingClientRect();
  const range = document.createRange();
  const out = nodes.map(node => { range.selectNodeContents(node); return [...range.getClientRects()].map(r => [Math.round((r.left - origin.left) * 60), Math.round(r.width * 60), Math.round(r.top - origin.top)]); });
  const height = div.getBoundingClientRect().height;
  div.remove();
  return { nodes: out, height };
};
const geeza = '400 20px "Geeza Pro"';
const lead = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ ';
const base = { font: geeza, width: 52, whiteSpace: 'pre-wrap', direction: 'rtl', lang: 'ar', runs: [{ text: lead, ws: -4 }, { text: 'الرَ', ws: 2 }, { text: 'ّحِيمِ', ws: 4 }] };
const v = {};
v.asIs = build(base);
v.noWordSpacing = build({ ...base, runs: base.runs.map(r => ({ ...r, ws: 0 })) });
v.equalWordSpacing = build({ ...base, runs: base.runs.map(r => ({ ...r, ws: 2 })) });
v.normal = build({ ...base, whiteSpace: 'normal' });
v.ltr = build({ ...base, direction: 'ltr' });
v.cutAtClusterStart = build({ ...base, runs: [base.runs[0], { text: 'الرَّ', ws: 2 }, { text: 'حِيمِ', ws: 4 }] });
v.wordAlone = build({ ...base, runs: base.runs.slice(1) });
v.wordAloneWide = build({ ...base, width: 200, runs: base.runs.slice(1) });
v.wordAloneNoSpacing = build({ ...base, runs: base.runs.slice(1).map(r => ({ ...r, ws: 0 })) });
v.wide = build({ ...base, width: 400 });
v.latin = build({ font: '400 20px Arial', width: 52, whiteSpace: 'pre-wrap', direction: 'ltr', lang: 'en', runs: [{ text: 'some words cafe', ws: 2 }, { text: '́s and more', ws: 4 }] });
v.latinNoSpacing = build({ font: '400 20px Arial', width: 52, whiteSpace: 'pre-wrap', direction: 'ltr', lang: 'en', runs: [{ text: 'some words cafe', ws: 0 }, { text: '́s and more', ws: 0 }] });
const word = (font, direction, lang, a, b) => build({ font, width: 400, whiteSpace: 'normal', direction, lang, runs: [{ text: a, ws: 0 }, { text: b, ws: 0 }] }).nodes;
v.cuts = {
  geezaBaseMark_Mark: word(geeza, 'rtl', 'ar', 'الرَ', 'ّحِيمِ'),
  geezaBase_MarkMark: word(geeza, 'rtl', 'ar', 'الر', 'َّحِيمِ'),
  geezaOneMark: word(geeza, 'rtl', 'ar', 'الر', 'َحيم'),
  arialBaseMark_Mark: word('400 20px Arial', 'rtl', 'ar', 'الرَ', 'ّحِيمِ'),
  arialBase_MarkMark: word('400 20px Arial', 'rtl', 'ar', 'الر', 'َّحِيمِ'),
  amiriBaseMark_Mark: word('400 20px Amiri', 'rtl', 'ar', 'الرَ', 'ّحِيمِ'),
  timesBaseMark_Mark: word('400 20px "Times New Roman"', 'rtl', 'ar', 'الرَ', 'ّحِيمِ'),
  latinBaseMark_Mark: word('400 20px Arial', 'ltr', 'en', 'café', '̂s'),
  latinBase_MarkMark: word('400 20px Arial', 'ltr', 'en', 'cafe', '́̂s'),
  thaiBaseMark_Mark: word('400 20px Thonburi', 'ltr', 'th', 'ผู', '้คน'),
  devaSplit: word('400 20px "Kohinoor Devanagari"', 'ltr', 'hi', 'नमस्', 'ते'),
  emojiZwj: word('400 20px Arial', 'ltr', 'en', 'a👩‍', '🔬b'),
};
return v;
`

// - F19, letter spacing in a cursive script with a mark in another font (fresh c-c408f28194762a1e: three Hanifi Rohingya
//   letters and U+0301 in 16px "Courier New" under 1px of letter spacing are 60 au wider natively than their Canvas total,
//   though the DOM gives a cursive script's clusters no letter spacing, nsTextFrame.cpp:4107-4133).
const F19 = String.raw`
const row = (font, ls, text, direction) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; white-space: pre; font: ' + font + '; letter-spacing: ' + ls + 'px; direction: ' + (direction || 'ltr');
  div.lang = 'en';
  const n = document.createTextNode(text); div.append(n); host.append(div);
  const range = document.createRange();
  const points = [];
  for (let i = 0; i < text.length;) { const len = text.codePointAt(i) > 0xffff ? 2 : 1; range.setStart(n, i); range.setEnd(n, i + len); points.push(Math.round([...range.getClientRects()].reduce((a, r) => a + r.width, 0) * 60)); i += len; }
  range.selectNodeContents(n);
  const whole = Math.round([...range.getClientRects()].reduce((a, r) => a + r.width, 0) * 60);
  div.remove();
  const c = ctxOf('ec', font.replace(/(\d+)px/, (m, px) => (px * dpr) + 'px'), 'en', 'ltr');
  return { font, ls, text, whole, points, canvas: Math.round(c.measureText(text).width * 60 / dpr) };
};
const courier = '400 16px "Courier New"';
const out = [];
for (const text of ['\u{10D00}\u{10D01}\u{10D02}́', '\u{10D00}\u{10D01}\u{10D02}', '\u{10D02}́', 'بب́', 'ببب', 'ab́c']) for (const ls of [0, 1, 4]) for (const font of [courier, '400 16px Arial']) out.push(row(font, ls, text));
// Which clusters of a cursive script take letter spacing: a mark of the base's font, a mark another font draws, other scripts.
for (const text of ['ܐܒܓ́', 'ܐܒܓ', 'ܓ́', 'ܓܰ', 'بب́', 'ببَ', 'ب́', 'ߒߞ́', 'ߒߞ߫', 'ᠮᠣ́', 'ᠮᠣ']) for (const ls of [0, 4]) for (const font of [courier, '400 16px "Geeza Pro"', '400 16px "Times New Roman"']) out.push(row(font, ls, text));
return out;
`

// Checks over each probe's raw values (round 4), as in gecko-round2.ts.
const CHECKS = String.raw`
const checks = [];
const pre = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, measured, expected) => { checks.push({ name, measured, expected, ok: same(measured, expected) }); };
const need = (name, measured, expected) => { pre.push({ name, measured, expected, ok: same(measured, expected) }); };
`
const withChecks = (source: string, checks: string): string => `${HELPERS}${CHECKS}const raw = (() => {${source}})();\n${checks}\nreturn { ...(Array.isArray(raw) ? { rows: raw } : raw), checks, pre };`

const F13_CHECKS = String.raw`
const units = raw.units.map(u => ({ css: u.css, text: u.text, dom: Math.round(u.dom), oc: Math.round(u.ocCss), element: Math.round(u.ecDev) }));
const emojiOrSystem = u => /system-ui|-apple-system/.test(u.css) || /\p{Extended_Pictographic}|\u20e3/u.test(u.text);
check('a detached canvas element at the device font size, width × apd, is the DOM box on every unit', units.filter(u => u.element !== u.dom).map(u => [u.css, u.text]), []);
check('the units an OffscreenCanvas at the CSS size gets exactly 1 au off, OffscreenCanvas less DOM: the residual class gecko/one-shaping-unit-one-app-unit', units.filter(u => Math.abs(u.oc - u.dom) === 1).map(u => [u.css, u.text, u.oc - u.dom]), [["500 32px Thonburi", "รมชาติทำให้ผู้คนมีคว", -1], ["500 32px Thonburi", "รมชาติทำให้ผู้คนมี", -1], ["500 32px Thonburi", "ทำให้", -1], ["300 10px \"Geeza Pro\"", "ووفقك", -1], ["400 10px \"Geeza Pro\"", "ووفقك", -1], ["500 10px \"Geeza Pro\"", "ووفقك", -1], ["300 10px \"Geeza Pro\"", "وأعانك", -1], ["400 10px \"Geeza Pro\"", "وأعانك", -1], ["500 10px \"Geeza Pro\"", "وأعانك", -1], ["300 10px \"Geeza Pro\"", "وما", -1], ["400 10px \"Geeza Pro\"", "وما", -1], ["500 10px \"Geeza Pro\"", "وما", -1], ["400 15px \"Helvetica Neue\", Helvetica, Arial, sans-serif", "modern", 1], ["700 10px \"Helvetica Neue\"", "LT:", 1]]);
check('units further off on the OffscreenCanvas are bitmap emoji or the system font at its optical size', units.filter(u => Math.abs(u.oc - u.dom) > 1 && !emojiOrSystem(u)).map(u => [u.css, u.text, u.oc - u.dom]), []);
`

const F14_CHECKS = String.raw`
const parts = raw.rows.flatMap(r => r.canvas.map((c, i) => ({ size: r.size, family: r.family, text: c.text, dom: Math.round(r.dom[i].whole), element: Math.round(c.ec700Dev), oc: Math.round(c.oc700) })));
const heart = parts.find(x => x.size === 14 && x.text === '⃣❤');
check('a canvas element at the device size holds the DOM box of every part, synthetic bold included', parts.filter(x => x.element !== x.dom).map(x => [x.size, x.family, x.text]), []);
check('U+20E3 U+2764 in bold 14px "Helvetica Neue": DOM 786 au, OffscreenCanvas at the CSS size 793 (the residual class gecko/synthetic-bold-offset)', [heart.dom, heart.oc], [786, 793]);
`

const F15_CHECKS = String.raw`
// Where the two sides add up to the unit, plainly or with U+200D at the cut, the prefix is the DOM's advance before the cut.
const exceptions = [];
let plain = 0, joined = 0;
for (const w of raw.words) {
  const offsets = []; let o = 0;
  for (const ch of w.text) { offsets.push(o); o += ch.length; }
  for (const c of w.cuts) {
    const domBefore = w.dom.reduce((a, width, i) => offsets[i] < c.t ? a + Math.round(width) : a, 0);
    if (c.prefix + c.suffix === w.unit) { plain++; if (c.prefix !== domBefore) exceptions.push([w.css, w.text, c.t]); }
    else if (c.prefixZwj + c.zwjSuffix === w.unit) { joined++; if (c.prefixZwj !== domBefore) exceptions.push([w.css, w.text, c.t]); }
  }
}
need('many cuts add up, plainly and with U+200D', plain > 300 && joined > 300, true);
check('where the two sides add up to the unit, the prefix is the DOM advance before the cut, except inside the fi ligature of "Helvetica Neue", which is as wide as its parts (probe F9)', exceptions, [['400 14px "Helvetica Neue"', 'firstname', 1], ['400 14px "Helvetica Neue"', 'office', 3]]);
`

const F16_CHECKS = String.raw`
const legacy = ['Verdana', '"Times New Roman"', '"Helvetica Neue"', 'Helvetica'];
const width = rects => Math.round(rects.reduce((a, r) => a + r, 0));
const even = [], odd = [];
for (const row of raw.rows) {
  if (!legacy.some(f => row.css.endsWith(f))) continue;
  const at = row.sizes[0];
  const R = at.pair - at.first - at.second;
  if (R === 0) continue;
  const d0 = Math.round(row.dom[0]), d1 = Math.round(row.dom[1]);
  if (R % 2 === 0) { if (!(d0 === at.first + R / 2 && d1 === at.second + R / 2)) even.push([row.css, row.pair, R, d0 - at.first, d1 - at.second]); }
  else if (!(d0 + d1 === at.pair && Math.abs((d0 - at.first) - (d1 - at.second)) === 1)) odd.push([row.css, row.pair, R, d0 - at.first, d1 - at.second]);
}
check('under a legacy kern table an even pair adjustment divides in halves between the two glyphs (hb-kern.hh:102-106)', even, []);
check('an odd one leaves the two glyphs one au apart, adding up to the pair', odd, []);
`

const F17_CHECKS = String.raw`
check('Canvas letter spacing counts a whole number of ligature groups, no more than the grapheme clusters', raw.words.filter(w => !Number.isInteger(w.groups) || w.groups > w.graphemes || w.groups < 1).map(w => [w.css, w.text, w.groups]), []);
check('the words with fewer groups than clusters: lam-alef and the fonts\u2019 other required ligatures, U+0E24 U+0E32', raw.words.filter(w => w.groups < w.graphemes).map(w => [w.css, w.text, w.graphemes, w.groups]), [["400 16px \"Geeza Pro\"", "سلام", 4, 3], ["400 16px \"Geeza Pro\"", "السلام", 6, 5], ["400 16px \"Geeza Pro\"", "المرابحة", 8, 7], ["400 16px \"Geeza Pro\"", "اللَّهِ", 4, 2], ["400 16px \"Geeza Pro\"", "لله", 3, 1], ["400 16px \"Geeza Pro\"", "الله.", 5, 3], ["400 16px \"Geeza Pro\"", "لا", 2, 1], ["400 16px \"Geeza Pro\"", "بلا", 3, 2], ["400 16px \"Geeza Pro\"", "فلان", 4, 3], ["400 16px Arial", "سلام", 4, 3], ["400 16px Arial", "السلام", 6, 5], ["400 16px Arial", "لا", 2, 1], ["400 16px Arial", "بلا", 3, 2], ["400 16px Arial", "فلان", 4, 3], ["400 18px \"Times New Roman\"", "سلام", 4, 3], ["400 18px \"Times New Roman\"", "السلام", 6, 5], ["400 18px \"Times New Roman\"", "لا", 2, 1], ["400 18px \"Times New Roman\"", "بلا", 3, 2], ["400 18px \"Times New Roman\"", "فلان", 4, 3], ["400 16px \"Courier New\"", "سلام", 4, 3], ["400 16px \"Courier New\"", "السلام", 6, 5], ["400 16px \"Courier New\"", "لا", 2, 1], ["400 16px \"Courier New\"", "بلا", 3, 2], ["400 16px \"Courier New\"", "فلان", 4, 3], ["400 16px \"Noto Nastaliq Urdu\"", "اللَّهِ", 4, 2], ["400 20px Thonburi", "ฤา", 2, 1], ["400 16px Arial", "ฤา", 2, 1]]);
`

const F18_CHECKS = String.raw`
// nscoord_MAX, 2^30 − 1 au, through float32 px: 17895698px × 60.
const UNBOUNDED = 1073741880;
const unbounded = v => v.nodes.some(node => node.some(r => r[1] === UNBOUNDED));
check('reh fatha | shadda across two spans in 20px "Geeza Pro": a frame is nscoord_MAX wide', unbounded(raw.asIs), true);
check('whatever the word spacing, white-space, direction, width and the text before the word', ['noWordSpacing', 'equalWordSpacing', 'normal', 'ltr', 'wordAlone', 'wordAloneWide', 'wordAloneNoSpacing', 'wide'].filter(k => !unbounded(raw[k])), []);
check('a cut before both marks is bounded', unbounded(raw.cutAtClusterStart), false);
check('of the single-word cuts only the one between the two marks in "Geeza Pro" is unbounded (the Amiri row loaded no web font and is "Geeza Pro" too)', Object.keys(raw.cuts).filter(k => raw.cuts[k].some(node => node.some(r => r[1] === UNBOUNDED))), ['geezaBaseMark_Mark', 'amiriBaseMark_Mark']);
`

const F19_CHECKS = String.raw`
// Per string and font: which code points grow under letter spacing, by how much per px.
const by = {};
for (const r of raw) (by[r.font + '|' + r.text] = by[r.font + '|' + r.text] || {})[r.ls] = r;
const growth = (font, text, ls) => { const a = by[font + '|' + text][0], b = by[font + '|' + text][ls]; return b.points.map((w, i) => (w - a.points[i]) / ls); };
const courier = '400 16px "Courier New"', geeza = '400 16px "Geeza Pro"', times = '400 16px "Times New Roman"';
check('beh beh with U+0301 under 4px: no cluster grows in "Courier New" and "Times New Roman", which have U+0301', [growth(courier, 'بب́', 4), growth(times, 'بب́', 4)], [[0, 0, 0], [0, 0, 0]]);
check('in "Geeza Pro", which lacks U+0301, the marked cluster grows by the letter spacing', growth(geeza, 'بب́', 4), [0, 0, 60]);
check('with a mark of the base font (fatha) nothing grows in "Geeza Pro"', growth(geeza, 'ببَ', 4), [0, 0, 0]);
check('Syriac, N\u2019Ko and Mongolian letters, drawn by fallback fonts, grow only in the cluster marked with U+0301', [growth(courier, 'ܐܒܓ́', 4), growth(courier, 'ߒߞ́', 4), growth(courier, 'ᠮᠣ́', 4)], [[0, 0, 0, 60], [0, 0, 60], [0, 0, 60]]);
check('and not with a mark of their own script', [growth(courier, 'ܓܰ', 4), growth(courier, 'ߒߞ߫', 4)], [[0, 0], [0, 0, 0]]);
check('Hanifi Rohingya letters with U+0301 under 1px: only the marked cluster grows', growth(courier, '\u{10D00}\u{10D01}\u{10D02}́', 1), [0, 0, 0, 60]);
check('a Latin cluster takes the spacing whatever draws its mark', growth(courier, 'ab́c', 4), [60, 0, 60, 60]);
`

export default function probes(): Probe[] {
  const probe = (id: string, spec: string, source: string, checks: string, fontFixtures?: string[]): Probe => ({
    id,
    spec,
    pageLang: 'en',
    observe: [{ kind: 'script', source: withChecks(source, checks) }],
    browsers: ['firefox'],
    ...(fontFixtures === undefined ? {} : { fontFixtures }),
    note: 'Measurement only.',
  })
  return [
    probe('gecko-port F13', 'gecko-port F13: a canvas element at the device font size against the DOM for the 1 au class', F13, F13_CHECKS),
    probe('gecko-port F14', 'gecko-port F14: synthetic bold at the CSS and the device size', F14, F14_CHECKS, ['Amiri']),
    probe('gecko-port F15', 'gecko-port F15: in-word advances against prefix, suffix and U+200D recipes', F15, F15_CHECKS, ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Shantell Sans']),
    probe('gecko-port F16', 'gecko-port F16: how an odd pair adjustment divides between two glyphs', F16, F16_CHECKS),
    probe('gecko-port F18', 'gecko-port F18: a grapheme cluster split across two spans of one text run', F18, F18_CHECKS),
    probe('gecko-port F19', 'gecko-port F19: letter spacing in a cursive script with a mark in another font', F19, F19_CHECKS),
    probe('gecko-port F17', 'gecko-port F17: ligature groups counted through Canvas letter spacing', F17, F17_CHECKS, ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu']),
  ]
}
