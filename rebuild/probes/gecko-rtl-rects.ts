// Gecko port follow-up F6 (installed Firefox 156, DPR 2): whether Range rects of code points in a right-to-left line far from
// the origin differ by an app unit from the same text near the origin. The lab's rule families put RTL paragraphs in a
// 100000px block, and their code point x values after the first space are 1 au above the frame's own advances
// (c-7d0d96b1e722680f: "Hello world again", Georgia 13px). Measurement only: per-code-point rects of one text node in au
// (px × 60, unrounded) and each rect's x relative to the first code point's.
import type { Probe } from './types.ts'

const SOURCE = String.raw`
const text = 'Hello world again';
const layout = (width, direction, align) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; width: ' + width + 'px; font: 13px Georgia; line-height: 32px; white-space: normal; direction: ' + direction + '; text-align: ' + align;
  div.lang = 'en';
  const node = document.createTextNode(text);
  div.append(node);
  host.append(div);
  const origin = div.getBoundingClientRect().left;
  const range = document.createRange();
  const points = [];
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i); range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    points.push([i, (r.left - origin) * 60, r.width * 60]);
  }
  const first = points[0][1];
  const out = { originAu: origin * 60, points: points.map(p => [p[0], +p[1].toFixed(3), +p[2].toFixed(3), +(p[1] - first).toFixed(3)]) };
  div.remove();
  return out;
};
return {
  dpr: window.devicePixelRatio,
  rtlWide: layout(100000, 'rtl', 'start'),
  rtlNarrow: layout(300, 'rtl', 'start'),
  ltrWideRight: layout(100000, 'ltr', 'right'),
  ltrNarrow: layout(300, 'ltr', 'start'),
  rtlMid: layout(4000, 'rtl', 'start'),
};
`

export default function probes(): Probe[] {
  return [
    {
      id: 'gecko-port F6',
      spec: 'gecko-port F6: code point rects of an RTL line far from the origin against the same line near it',
      pageLang: 'en',
      observe: [{ kind: 'script', source: SOURCE }],
      browsers: ['firefox'],
      note: 'Measurement only.',
    },
  ]
}
