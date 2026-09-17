// Gecko port follow-up F4 (installed Firefox 156, DPR 2): what Canvas string reproduces the DOM's advances for a shaping unit
// that starts with a cluster extender or U+202F right after an invalid character (research/SUPERSET-gecko.md §2.1 A), and
// which widths a text-presentation © takes in "Apple Color Emoji" (§2.1 E). Measurement only: per-code-point Range rects of
// one text node, and OffscreenCanvas widths of candidate strings, all in au at apd 60.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-font-matching -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-font-matching.ts --out=.artifacts/probes/gecko/font-matching
import type { Probe } from './types.ts'

const SOURCE = String.raw`
const au = (font, text) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; return Math.round(c.measureText(text).width * 60); };
const rects = (font, text) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; white-space: pre; font: ' + font;
  div.lang = 'en';
  const node = document.createTextNode(text);
  div.append(node);
  host.append(div);
  const origin = div.getBoundingClientRect().left;
  const out = [];
  const range = document.createRange();
  for (let i = 0; i < text.length;) {
    const len = text.codePointAt(i) > 0xffff ? 2 : 1;
    range.setStart(node, i); range.setEnd(node, i + len);
    out.push([i, [...range.getClientRects()].map(r => [Math.round((r.left - origin) * 60), Math.round(r.width * 60)])]);
    i += len;
  }
  const whole = Math.round(div.getBoundingClientRect().width * 60);
  div.remove();
  return { whole, points: out };
};
const cases = {
  georgiaMark: { font: '16px Georgia', dom: 'a​́)ब', canvas: ['́)ब', '​́)ब', 'a​́)ब', 'a​', '​', 'a', '́', '​́', 'a​́', ')ब', ')', 'ब'] },
  arialDevanagari: { font: '16px Arial', dom: 'a⁠́​̈ाb', canvas: ['̈ाb', '​̈ाb', 'a⁠́​̈ाb', 'a⁠́​', 'a⁠́', '̈ा', '​̈ा', 'ाb', 'ा', 'b', '̈'] },
  arialNnbsp: { font: '16px Arial', dom: 'x  ', canvas: [' ', '  ', 'x  ', 'x ', 'x'] },
  emojiCopyright: { font: '16px "Apple Color Emoji"', dom: '©︎', canvas: ['©︎', '©'] },
};
const out = {};
for (const [name, c] of Object.entries(cases)) {
  const widths = {};
  for (const s of c.canvas) widths[[...s].map(ch => 'U+' + ch.codePointAt(0).toString(16).toUpperCase()).join(' ')] = au(c.font, s);
  out[name] = { dom: rects(c.font, c.dom), canvas: widths };
}
const copyrightSizes = {};
for (const family of ['"Apple Color Emoji"', 'Arial', '"Apple Symbols"', 'Menlo', 'Georgia', '"Times New Roman"', '"Helvetica Neue"']) {
  copyrightSizes[family] = { css16: au('16px ' + family, '©︎'), dev32: au('32px ' + family, '©︎'), plain16: au('16px ' + family, '©') };
}
out.copyrightSizes = copyrightSizes;
out.copyrightDom32 = rects('32px "Apple Color Emoji"', '©︎');
return { dpr: window.devicePixelRatio, ...out };
`

export default function probes(): Probe[] {
  return [
    {
      id: 'gecko-port F4',
      spec: 'gecko-port F4: Canvas strings for units after invalid characters, and text-presentation © in Apple Color Emoji',
      pageLang: 'en',
      observe: [{ kind: 'script', source: SOURCE }],
      browsers: ['firefox'],
      note: 'Measurement only.',
    },
  ]
}
