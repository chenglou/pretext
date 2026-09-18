// Blink probes of ceiling round 3 (specs/blink-RESULTS.md "Ceiling round 3"). Plain observations; verdicts by hand.
//
// R1. A word-final letter before a space in Noto Nastaliq Urdu (`c-d5c9e88814700c97`, line 188: `آگ` before a trimmed space is
//     3436 units natively and 2968 from the Canvas prefix). hb-shape gives `گ` 1342 font units before a space and 1159 at
//     the end of text. Does Canvas show the adjustment through U+2028, which the port measures in place of U+0020?
// R2. Word-by-word Canvas shaping: `ب　ب` under 0 and 1/64 px of letter spacing (the port's word-split test), in a font
//     whose GPOS covers the space glyph and in one without GPOS.
//
// Run under the browser lock (from ~/github/pretext-rebuild):
//   python3 .artifacts/session/with-browser-lock.py blink-round3 -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/blink-round3.ts --out=.artifacts/probes/blink/round3 --probe-timeout-ms=60000
import type { Probe } from './types.ts'

const NASTALIQ = String.raw`
const family = '"Noto Nastaliq Urdu"';
const oc = (text, size, extra) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = '400 ' + size + 'px ' + family; c.direction = 'rtl'; c.letterSpacing = '0px'; c.fontKerning = 'auto'; c.textRendering = (extra && extra.textRendering) || 'optimizeLegibility'; return c.measureText(text).width; };
const dom = (text) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 60px; white-space: pre; direction: rtl; font: 400 20px ' + family;
  div.lang = 'ur';
  const node = document.createTextNode(text); div.append(node); host.append(div);
  const points = [];
  for (let i = 0; i < text.length; i++) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); points.push([...r.getClientRects()].map(q => [q.x * 128, q.width * 128])); }
  const whole = document.createRange(); whole.selectNodeContents(node);
  const rects = [...whole.getClientRects()].map(q => [q.x * 128, q.width * 128]);
  div.remove();
  return { rects, points };
};
const out = { dpr: window.devicePixelRatio, dom: {}, canvas: {}, canvasAuto: {} };
for (const text of ['آگ', 'آگ ', 'آگ لگ', 'میں آگ لگ گئی']) out.dom[text] = dom(text);
for (const text of ['آگ', 'آگ ', 'آگ ', ' ', ' ', 'آگ لگ', 'آگ لگ', 'لگ', ' لگ', 'آگ ', 'گ', 'گ ', '‍گ', '‍گ ']) {
  out.canvas[text] = oc(text, 40) * 64;
  out.canvasAuto[text] = oc(text, 40, { textRendering: 'auto' }) * 64;
}
return out;
`

const WORDS = String.raw`
const widths = (family) => {
  const at = (ls) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = '400 40px ' + family; c.direction = 'ltr'; c.letterSpacing = ls; c.fontKerning = 'auto'; c.textRendering = 'optimizeLegibility'; return c.measureText('ب　ب').width; };
  return { zero: at('0px'), sixtyFourth: at('0.015625px'), one: at('1px') };
};
const out = {};
for (const family of ['"Geeza Pro"', 'Arial', '"Times New Roman"', '"Helvetica Neue"', 'Georgia', 'Verdana', '"Courier New"', '"Hiragino Sans"', '"PingFang SC"', '"Noto Nastaliq Urdu"', 'Amiri', '"Noto Naskh Arabic"', '"Shantell Sans"', 'system-ui']) out[family] = widths(family);
return out;
`

export default function probes(): Probe[] {
  return [
    { id: 'blink-round3 R1 nastaliq word-final before space', spec: 'blink-RESULTS ceiling round 3', pageLang: 'ur', fontFixtures: ['Noto Nastaliq Urdu'], observe: [{ kind: 'script', source: NASTALIQ }], browsers: ['chrome'], note: 'Measurement only. DOM rects × 128 are LayoutUnits at DPR 2; Canvas widths × 64 at 40px.' },
    { id: 'blink-round3 R2 canvas word split', spec: 'blink-RESULTS ceiling round 3', pageLang: 'en', fontFixtures: ['Noto Nastaliq Urdu', 'Amiri', 'Noto Naskh Arabic', 'Shantell Sans'], observe: [{ kind: 'script', source: WORDS }], browsers: ['chrome'], note: 'Measurement only.' },
  ]
}
