// Gecko probes for the cases main passes and the rebuild fails (research/MAIN-PASSES-REFRESH.md, 2026-09-19), pinned
// Firefox 156.0 at DPR 2. Measurement only: Range rects of text nodes in au (px x 60) beside measureText widths from a
// main-thread OffscreenCanvas at the CSS size, which is how the port measures (CHARTER.md, decision 2).
// - M1, which glyph of a kerned pair carries the adjustment, from the app-unit rounding of Canvas totals. GPOS adds the
//   whole adjustment to the first glyph's advance (PairSet.hh:126-127) and the kern and kerx pair machine gives each glyph
//   half (hb-kern.hh:102-106); Gecko rounds each glyph's advance to app units (gfxHarfBuzzShaper.cpp:1699-1702), so the two
//   give totals that can differ by an app unit, which the advances at the size times 2^k predict. Per word: the DOM's code
//   point advances, and every substring's Canvas au at the CSS size and at the largest size times 2^k under 2000px.
// - M2, U+200D at the start of a Canvas string. ComputeRanges starts with the group's first valid font as the previous
//   font and a join control keeps the previous font (gfxTextRun.cpp:3609-3613, :3311-3318); the character after a join
//   causer takes that font only where it has the character (:3320-3325), so a letter a fallback font draws sits in another
//   font range than the U+200D before it and shapes without it. Per word and cut: the DOM's advances, W(unit), W(prefix),
//   W(suffix), W(prefix U+200D), W(U+200D suffix), W(prefix U+200D suffix), and the suffix after its own first letter,
//   U+200C and U+200D, with W(letter U+200C).
// - M3, native line counts of three constructed paragraphs beside the suite's widths, for what main's sums would give there.
// - M4, a boundary U+00A0. SplitAndInitTextRun shapes it as a word of its own, the character U+00A0 (gfxFont.cpp:3317-3330,
//   :3834-3861), where U+0020 takes the font's space glyph; a font without a glyph for it gives the space glyph
//   (gfxHarfBuzzShaper.cpp:113-118), and font matching tries U+0020 for it (gfxTextRun.cpp:3226-3229). Per font: the DOM's
//   advance of U+00A0 and of U+0020 between two letters, and Canvas's W(U+00A0) and W(U+0020).
// - M5, a font list whose first font draws only the digits (a FontFace over local("Times New Roman") with unicode-range
//   U+30-39, then Arial): the pair placement recipe's probe pairs are letters, which Arial draws, and `11` is Times New
//   Roman's. Per word: the DOM's advances and every substring's Canvas au at the CSS size and at the size times 2^k, as M1,
//   to show what crosses two faces (nothing) and that one declaration can hold two placements.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-mainfacts -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-mainfacts.ts --out=<out>
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const dpr = window.devicePixelRatio;
const cps = (...list) => String.fromCodePoint(...list);
const ZWJ = cps(0x200d), ZWNJ = cps(0x200c), SHY = cps(0xad);
const ctxOf = (font, lang, direction, letterSpacing) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = lang; c.font = font; c.letterSpacing = letterSpacing || '0px'; c.direction = direction;
  return c;
};
const dom = (font, lang, direction, text) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: pre; direction: ' + direction;
  div.lang = lang;
  const s = document.createElement('span'); s.style.font = font; const node = document.createTextNode(text); s.append(node); div.append(s);
  host.append(div);
  const range = document.createRange();
  const points = [];
  for (let i = 0; i < node.data.length;) {
    const len = node.data.codePointAt(i) > 0xffff ? 2 : 1;
    range.setStart(node, i); range.setEnd(node, i + len);
    points.push(+([...range.getClientRects()].reduce((a, r) => a + r.width, 0) * 60).toFixed(3));
    i += len;
  }
  div.remove();
  return points;
};
const lines = (font, lang, width, whiteSpace, text) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; overflow-wrap: break-word; font: ' + font + '; width: ' + width + 'px; white-space: ' + whiteSpace;
  div.lang = lang;
  const node = document.createTextNode(text); div.append(node);
  host.append(div);
  const range = document.createRange();
  const tops = [];
  for (let i = 0; i < node.data.length; i++) {
    range.setStart(node, i); range.setEnd(node, i + 1);
    const rects = [...range.getClientRects()].filter(r => r.width > 0);
    tops.push(rects.length === 0 ? null : Math.round(rects[0].top / 40));
  }
  const count = Math.round(div.getBoundingClientRect().height / 40);
  div.remove();
  return { width, count, tops };
};
`

const M1 = String.raw`
const words = ['AV', 'VA', 'To', 'Wa', 'LT', 'Yo', 'Ty', 'AT', 'TA', 'AW', 'WA', 'P,', 'T.', 'r,', 'y,', 'Vo', 'ff', '11', 'rd', 'oW', 'aY', 'AVATAR', 'VAWAVAV', 'ToWaY', 'waffles', '1111'];
const fonts = [[400, 16, '"Times New Roman"'], [400, 17, '"Times New Roman"'], [400, 18, '"Times New Roman"'], [400, 24, '"Times New Roman"'], [700, 16, '"Times New Roman"'],
  [400, 14, 'Verdana'], [400, 16, 'Verdana'], [400, 20, 'Verdana'], [400, 14, '"Helvetica Neue"'], [400, 15, '"Helvetica Neue"'], [400, 24, '"Helvetica Neue"'], [400, 12, 'Helvetica'], [400, 16, 'Helvetica'],
  [400, 16, 'Arial'], [400, 20, 'Arial'], [700, 15, 'Arial'], [400, 13, 'Georgia'], [400, 16, '"Hoefler Text"'], [400, 16, 'Times'], [400, 16, '"Courier New"'], [400, 16, 'Amiri'], [400, 16, '"Shantell Sans"'], [400, 17, 'Palatino'], [400, 16, '"Trebuchet MS"'], [400, 16, 'Tahoma'], [400, 15, 'Optima'], [400, 16, 'Futura'], [400, 16, '"Gill Sans"'], [400, 16, 'Baskerville'], [400, 16, 'Didot']];
const out = { dpr, rows: [] };
for (const [wt, sz, fam] of fonts) {
  const css = wt + ' ' + sz + 'px ' + fam;
  let k = 0;
  while (sz * 2 ** (k + 1) <= 2000) k++;
  const base = ctxOf(css, 'en', 'ltr'), large = ctxOf(wt + ' ' + (sz * 2 ** k) + 'px ' + fam, 'en', 'ltr');
  for (const word of words) {
    const sub = {};
    for (let i = 0; i < word.length; i++) for (let j = i + 1; j <= word.length; j++) {
      const s = word.slice(i, j);
      sub[i + ',' + j] = [Math.round(base.measureText(s).width * 60), Math.round(large.measureText(s).width * 60)];
    }
    out.rows.push({ css, k, word, dom: dom(css, 'en', 'ltr', word), sub });
  }
}
return out;
`

const M2 = String.raw`
const words = [
  ['mn', 'ltr', cps(0x1820, 0x1821, 0x1822)], ['mn', 'ltr', cps(0x182e, 0x1823, 0x1829, 0x182d, 0x1823, 0x182f)],
  ['syr', 'rtl', cps(0x710, 0x712, 0x713)], ['syr', 'rtl', cps(0x72b, 0x720, 0x721, 0x710)],
  ['en', 'ltr', cps(0xa840, 0xa841, 0xa842)], ['nqo', 'rtl', cps(0x7d2, 0x7de, 0x7cf)],
  ['ar', 'rtl', cps(0x628, 0x628)], ['ar', 'rtl', cps(0x628, 0x628, 0x628)], ['ar', 'rtl', cps(0x633, 0x644, 0x627, 0x645)], ['ar', 'rtl', cps(0x645, 0x62d, 0x645, 0x62f)],
  ['ar', 'rtl', cps(0x644, 0x623, 0x644, 0x627)], ['ar', 'rtl', cps(0x646, 0x633, 0x62a, 0x639, 0x644, 0x64a, 0x642)],
];
const fonts = ['400 16px Arial', '400 16px "Times New Roman"', '400 16px Amiri', '400 24px Amiri', '400 16px "Noto Nastaliq Urdu"', '400 16px "Noto Naskh Arabic"', '400 16px "Geeza Pro"', '400 16px "Courier New"', '400 16px Georgia'];
const out = { dpr, rows: [] };
for (const css of fonts) for (const [lang0, direction, word] of words) for (const lang of lang0 === 'en' ? ['en'] : ['en', lang0]) {
  const c = ctxOf(css, lang, direction);
  const au = s => Math.round(c.measureText(s).width * 60);
  const cuts = [];
  for (let t = 1; t < word.length; t++) {
    const prefix = word.slice(0, t), suffix = word.slice(t), c0 = word[t];
    cuts.push({ t, prefix: au(prefix), suffix: au(suffix), prefixZwj: au(prefix + ZWJ), zwjSuffix: au(ZWJ + suffix), prefixZwjSuffix: au(prefix + ZWJ + suffix),
      guarded: au(c0 + ZWNJ + ZWJ + suffix), guard: au(c0 + ZWNJ), lastZwjSuffix: au(word[t - 1] + ZWJ + suffix), lastZwj: au(word[t - 1] + ZWJ) });
  }
  out.rows.push({ css, lang, direction, word: [...word].map(ch => ch.codePointAt(0).toString(16)).join(' '), unit: au(word), dom: dom(css, lang, direction, word), cuts });
}
return out;
`

const M3 = String.raw`
const beh = cps(0x628);
const out = { dpr, rows: [] };
for (const width of [12, 12.04, 12.06, 12.1, 12.5]) out.rows.push({ name: 'aabb((bb in 24px Amiri', ...lines('400 24px Amiri', 'en', width, 'normal', 'aabb((' + beh + beh) });
for (const width of [12, 20, 23.6, 23.7, 25, 26.1]) out.rows.push({ name: 'A SHY V in 18px Times New Roman', ...lines('400 18px "Times New Roman"', 'en', width, 'normal', 'A' + SHY + 'V') });
for (const width of [10, 12.5, 12.6, 13, 17.2]) out.rows.push({ name: 'Mongolian a e i in 16px Arial', ...lines('400 16px Arial', 'en', width, 'normal', cps(0x1820, 0x1821, 0x1822)) });
return out;
`

const M4 = String.raw`
const NBSP = cps(0xa0);
const families = ['"Times New Roman"', 'Verdana', '"Helvetica Neue"', 'Helvetica', 'Arial', 'Georgia', '"Hoefler Text"', 'Times', '"Courier New"', 'Amiri', '"Shantell Sans"', 'Palatino', '"Trebuchet MS"', 'Tahoma', 'Optima', 'Futura', '"Gill Sans"', 'Baskerville', 'Didot',
  'Avenir', '"Avenir Next"', '"Avenir Next Condensed"', 'Charter', 'Cochin', '"American Typewriter"', 'Athelas', '"Iowan Old Style"', 'Marion', 'Rockwell', 'Seravek', 'Superclarendon', '"PT Serif"', '"PT Sans"', '"PT Mono"', '"Lucida Grande"', '"Arial Narrow"', '"Arial Black"', 'Impact', '"Marker Felt"', 'Noteworthy', '"Chalkboard SE"', 'Papyrus', 'Skia', '"Snell Roundhand"', '"Apple Chancery"', 'Zapfino', '"DIN Alternate"', 'Luminari', 'Trattatello', 'STIXGeneral', '"STIX Two Text"', '"New York"',
  '"Hiragino Sans"', '"Hiragino Mincho ProN"', '"PingFang TC"', '"PingFang SC"', '"Apple SD Gothic Neo"', '"Kohinoor Devanagari"', '"Geeza Pro"', '"Noto Naskh Arabic"', '"Noto Nastaliq Urdu"', 'Galvji', 'Menlo', 'Monaco', 'Courier', '"Andale Mono"', '"Comic Sans MS"', '"Brush Script MT"', 'Chalkduster', 'Copperplate', 'Herculanum', '"Bradley Hand"', '"Myanmar MN"', 'Thonburi', '"Arial Hebrew"', '"Apple Color Emoji"', 'Symbol', 'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];
const out = { dpr, rows: [] };
for (const fam of families) for (const [wt, sz] of [[400, 16], [700, 19], [400, 13.5]]) {
  const css = wt + ' ' + sz + 'px ' + fam;
  const c = ctxOf(css, 'en', 'ltr');
  const au = s => Math.round(c.measureText(s).width * 60);
  out.rows.push({ css, domNbsp: dom(css, 'en', 'ltr', 'a' + NBSP + 'b')[1], domSpace: dom(css, 'en', 'ltr', 'a b')[1], domNbspPair: dom(css, 'en', 'ltr', 'a' + NBSP + NBSP + 'b').slice(1, 3),
    nbsp: au(NBSP), space: au(' '), aNbspB: au('a' + NBSP + 'b'), aSpaceB: au('a b'), a: au('a'), b: au('b') });
}
return out;
`

const M5 = String.raw`
const face = new FontFace('ProbeDigits', 'local("Times New Roman")', { unicodeRange: 'U+30-39' });
document.fonts.add(face);
await face.load();
const out = { dpr, status: face.status, rows: [] };
const words = ['11', '1111', 'AV', 'To', 'A1', '1A', 'T1', '1T', 'V1', '1V', 'AV11', '11AV', '7.', '.7', 'P,'];
for (const [sz, list] of [[16, 'ProbeDigits, Arial'], [24, 'ProbeDigits, Arial'], [16, 'Arial'], [24, 'Arial'], [16, '"Times New Roman"'], [24, '"Times New Roman"'], [16, 'ProbeDigits, Verdana'], [18, 'ProbeDigits, Georgia']]) {
  const css = '400 ' + sz + 'px ' + list;
  let k = 0;
  while (sz * 2 ** (k + 1) <= 2000) k++;
  const base = ctxOf(css, 'en', 'ltr'), large = ctxOf('400 ' + (sz * 2 ** k) + 'px ' + list, 'en', 'ltr');
  for (const word of words) {
    const sub = {};
    for (let i = 0; i < word.length; i++) for (let j = i + 1; j <= word.length; j++) {
      const s = word.slice(i, j);
      sub[i + ',' + j] = [Math.round(base.measureText(s).width * 60), Math.round(large.measureText(s).width * 60)];
    }
    out.rows.push({ css, k, word, dom: dom(css, 'en', 'ltr', word), sub });
  }
}
document.fonts.delete(face);
return out;
`

export default function probes(): Probe[] {
  const probe = (id: string, spec: string, source: string, fontFixtures?: string[]): Probe => ({
    id,
    spec,
    pageLang: 'en',
    observe: [{ kind: 'script', source: `${HELPERS}${source}` }],
    browsers: ['firefox'],
    ...(fontFixtures === undefined ? {} : { fontFixtures }),
    note: 'Measurement only.',
  })
  return [
    probe('gecko-mainfacts M1', 'gecko-mainfacts M1: which glyph of a kerned pair carries the adjustment, from app-unit rounding', M1, ['Amiri', 'Shantell Sans']),
    probe('gecko-mainfacts M2', 'gecko-mainfacts M2: U+200D at the start of a Canvas string and the font range of the letter after it', M2, ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu']),
    probe('gecko-mainfacts M3', 'gecko-mainfacts M3: native line counts beside the suite widths', M3, ['Amiri']),
    probe('gecko-mainfacts M4', 'gecko-mainfacts M4: a boundary U+00A0 in the DOM and in Canvas, beside U+0020', M4, ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Shantell Sans']),
    probe('gecko-mainfacts M5', 'gecko-mainfacts M5: a first font that draws only the digits, and the placement of pairs in each face', M5),
  ]
}
