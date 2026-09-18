// Gecko port round 2 follow-ups F10 to F12 (installed Firefox 156, DPR 2). Measurement only: Range rects in au (px × 60,
// unrounded), OffscreenCanvas measureText widths (× 60) and box metrics.
// - F10, font coverage from Canvas: whether a family list followed by "LastResort" measures a character differently from
//   the list alone exactly where the list's own families don't cover it (the emergency-break `font-fallback` condition,
//   research/ROUND1-CRITIC.md §4).
// - F11, which font draws an emoji cluster: whether box metrics of the cluster in the run's list and in "Apple Color Emoji"
//   alone tell a text font from the color font when widths agree (research/CHARTER-CRITIC.md §3 item 2).
// - F12, kerning split between a pair's glyphs: per-code-point DOM rects of kerned pairs in fonts with a legacy `kern` table
//   and in fonts with GPOS kerning (hb-kern.hh splits a legacy pair adjustment between both glyphs).
//
// Each probe returns its raw values with `checks` and `pre` over them (added in round 4).
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-round2b -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-round2b.ts --out=.artifacts/probes/gecko/round2b
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const measure = (font, text) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = 'en'; c.font = font;
  const m = c.measureText(text);
  return { au: +(m.width * 60).toFixed(4), left: +(m.actualBoundingBoxLeft * 60).toFixed(4), right: +(m.actualBoundingBoxRight * 60).toFixed(4), ascent: +(m.actualBoundingBoxAscent * 60).toFixed(4) };
};
const dom = (font, text) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; white-space: pre; line-height: 40px; font: ' + font;
  div.lang = 'en';
  const node = document.createTextNode(text);
  div.append(node);
  host.append(div);
  const origin = div.getBoundingClientRect().left;
  const range = document.createRange();
  const points = [];
  for (let i = 0; i < text.length;) {
    const len = text.codePointAt(i) > 0xffff ? 2 : 1;
    range.setStart(node, i); range.setEnd(node, i + len);
    points.push([...range.getClientRects()].map(r => [+((r.left - origin) * 60).toFixed(3), +(r.width * 60).toFixed(3)]));
    i += len;
  }
  range.selectNodeContents(node);
  const whole = [...range.getClientRects()].map(r => +(r.width * 60).toFixed(3));
  div.remove();
  return { whole, points };
};
`

const F10 = String.raw`
const out = { lastResortCheck: document.fonts.check('16px LastResort') };
for (const family of ['Arial', 'Georgia', '"Times New Roman"', 'Menlo', '"Hiragino Sans"', '"Geeza Pro"']) {
  const chars = {};
  for (const ch of ['a', '2', '-', 'b', 'é', '中', 'ب', 'ก', '😀', '‐', '́', 'ㄱ']) {
    chars['U+' + ch.codePointAt(0).toString(16).toUpperCase()] = { alone: measure('16px ' + family, ch), lastResort: measure('16px ' + family + ', LastResort', ch) };
  }
  out[family] = chars;
}
return out;
`

const F11 = String.raw`
const out = {};
for (const cluster of ['😀', '©︎', '©️', '☺', '☺️', '#️⃣', '👍🏽']) {
  const key = [...cluster].map(ch => 'U+' + ch.codePointAt(0).toString(16).toUpperCase()).join(' ');
  const row = {};
  for (const family of ['Arial', '"Apple Color Emoji"', 'Menlo', '"Apple Symbols"', '"Times New Roman"']) {
    row[family] = { css: measure('16px ' + family, cluster), device: measure('32px ' + family, cluster) };
  }
  row.domArial = dom('16px Arial', cluster).whole;
  out[key] = row;
}
return out;
`

const F12 = String.raw`
const out = {};
for (const family of ['"Times New Roman"', 'Arial', 'Georgia', '"Helvetica Neue"', 'Verdana', 'Helvetica', '"Courier New"', 'Menlo', '"Hiragino Sans"', '"PingFang SC"', '"Apple SD Gothic Neo"', 'Thonburi', '"Geeza Pro"']) {
  const font = '18px ' + family;
  const rows = {};
  for (const pair of ['AV', 'To', 'Wa', 'LT', 'Yo']) {
    rows[pair] = { dom: dom(font, pair), pair: measure(font, pair).au, first: measure(font, pair[0]).au, second: measure(font, pair[1]).au };
  }
  out[family] = rows;
}
return out;
`

// Checks over each probe's raw values (round 4), as in gecko-round2.ts.
const CHECKS = String.raw`
const checks = [];
const pre = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, measured, expected) => { checks.push({ name, measured, expected, ok: same(measured, expected) }); };
const need = (name, measured, expected) => { pre.push({ name, measured, expected, ok: same(measured, expected) }); };
const sum = list => Math.round(list.reduce((a, r) => a + (Array.isArray(r) ? r[1] : r), 0));
`
const withChecks = (source: string, checks: string): string => `${HELPERS}${CHECKS}const raw = (() => {${source}})();\n${checks}\nreturn { ...raw, checks, pre };`

const F10_CHECKS = String.raw`
const differing = [];
for (const family of Object.keys(raw)) {
  if (family === 'lastResortCheck') continue;
  for (const ch of Object.keys(raw[family])) if (!same(raw[family][ch].alone, raw[family][ch].lastResort)) differing.push([family, ch]);
}
need('document.fonts.check says LastResort is there', raw.lastResortCheck, true);
check('a family list followed by LastResort measures every probed character like the list alone: font matching never reaches it, so Canvas has no coverage signal this way', differing, []);
`

const F11_CHECKS = String.raw`
const emoji = '"Apple Color Emoji"';
const text = ['Arial', 'Menlo', '"Apple Symbols"', '"Times New Roman"'];
const face = raw['U+1F600'];
const copyright = raw['U+A9 U+FE0E'];
check('U+1F600 measures in every probed text font list as in "Apple Color Emoji" alone, width and ink box, at 16px and 32px', text.filter(f => !(same(face[f].css, face[emoji].css) && same(face[f].device, face[emoji].device))), []);
check('U+00A9 U+FE0E in Arial does not measure as in "Apple Color Emoji" alone', copyright.Arial.css.au !== copyright[emoji].css.au, true);
check('the DOM draws U+00A9 U+FE0E in 16px Arial as wide as Canvas measures it in Arial', sum(copyright.domArial), Math.round(copyright.Arial.css.au));
check('U+263A in Arial has another ink box than in "Apple Color Emoji" alone', same([raw['U+263A'].Arial.css.left, raw['U+263A'].Arial.css.right], [raw['U+263A'][emoji].css.left, raw['U+263A'][emoji].css.right]), false);
`

const F12_CHECKS = String.raw`
// How the DOM divides a pair adjustment R = W(pair) − W(first) − W(second): 'first' where the first glyph takes all of it,
// 'halves' where each takes half, 'halves-odd' where an odd one leaves the two glyphs' parts one au apart.
const kinds = {};
for (const family of Object.keys(raw)) for (const pair of Object.keys(raw[family])) {
  const row = raw[family][pair];
  const first = Math.round(row.first), second = Math.round(row.second), R = Math.round(row.pair) - first - second;
  if (R === 0) continue;
  const d0 = sum(row.dom.points[0]), d1 = sum(row.dom.points[1]);
  const kind = d0 === first + R && d1 === second ? 'first'
    : R % 2 === 0 && d0 === first + R / 2 && d1 === second + R / 2 ? 'halves'
    : R % 2 !== 0 && d0 + d1 === first + second + R && Math.abs((d0 - first) - (d1 - second)) === 1 ? 'halves-odd' : 'other';
  (kinds[family] = kinds[family] || []).push([pair, kind]);
}
const not = (families, allowed) => families.flatMap(f => (kinds[f] || []).filter(k => !allowed.includes(k[1])).map(k => [f, k[0], k[1]]));
need('the probed fonts kern some pair', Object.keys(kinds).length > 0, true);
check('fonts kerned through a legacy kern table divide a pair adjustment between the two glyphs (hb-kern.hh:102-106)', not(['"Times New Roman"', 'Verdana', 'Helvetica', '"Helvetica Neue"'], ['halves', 'halves-odd']), []);
check('fonts kerned through GPOS put it on the first glyph (PairSet.hh:126-127)', not(['Arial', '"Hiragino Sans"', '"Apple SD Gothic Neo"'], ['first']), []);
`

export default function probes(): Probe[] {
  const probe = (id: string, spec: string, source: string, checks: string): Probe => ({
    id,
    spec,
    pageLang: 'en',
    observe: [{ kind: 'script', source: withChecks(source, checks) }],
    browsers: ['firefox'],
    note: 'Measurement only.',
  })
  return [
    probe('gecko-port F10', 'gecko-port F10: family coverage through a LastResort fallback in Canvas', F10, F10_CHECKS),
    probe('gecko-port F11', 'gecko-port F11: box metrics of emoji clusters in text fonts and Apple Color Emoji', F11, F11_CHECKS),
    probe('gecko-port F12', 'gecko-port F12: how pair kerning divides between the two glyphs in the DOM', F12, F12_CHECKS),
  ]
}
