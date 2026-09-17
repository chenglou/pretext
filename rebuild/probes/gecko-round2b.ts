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

export default function probes(): Probe[] {
  const probe = (id: string, spec: string, source: string): Probe => ({
    id,
    spec,
    pageLang: 'en',
    observe: [{ kind: 'script', source: HELPERS + source }],
    browsers: ['firefox'],
    note: 'Measurement only.',
  })
  return [
    probe('gecko-port F10', 'gecko-port F10: family coverage through a LastResort fallback in Canvas', F10),
    probe('gecko-port F11', 'gecko-port F11: box metrics of emoji clusters in text fonts and Apple Color Emoji', F11),
    probe('gecko-port F12', 'gecko-port F12: how pair kerning divides between the two glyphs in the DOM', F12),
  ]
}
