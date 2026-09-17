// Gecko port follow-up F5 (installed Firefox 156, DPR 2): where a first line goes when text-indent is wider than the first
// row's band between the lab's slot floats (rule/line-slots c-2c6803d9cbcda5b2). Records the floats' rects and each word's
// rect, with and without text-indent, in the lab's float protocol (DESIGN.md §2.9): per row a float: left; clear: left and a
// float: right; clear: right block, one line height tall, before the content.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-slot-indent -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-slot-indent.ts --out=.artifacts/probes/gecko/slot-indent
import type { Probe } from './types.ts'

const SOURCE = String.raw`
const layout = (indent, rows, text) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; width: 233.78333333333333px; font: 16px Arial; line-height: 32px; direction: rtl; white-space: normal; text-indent: ' + indent + 'px';
  div.lang = 'en';
  const floats = [];
  for (const row of rows) {
    for (const side of ['left', 'right']) {
      const f = document.createElement('div');
      f.style.cssText = 'float: ' + side + '; clear: ' + side + '; width: ' + row[side] + 'px; height: 32px; margin: 0; padding: 0; border: 0';
      div.append(f);
      floats.push(f);
    }
  }
  const node = document.createTextNode(text);
  div.append(node);
  host.append(div);
  const origin = div.getBoundingClientRect();
  const rect = r => [Math.round((r.left - origin.left) * 60), Math.round(r.width * 60), Math.round((r.top - origin.top) * 60)];
  const range = document.createRange();
  const words = [];
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i); range.setEnd(node, i + 1);
    words.push([i, [...range.getClientRects()].map(rect)]);
  }
  const out = { floats: floats.map(f => rect(f.getBoundingClientRect())), words, height: Math.round(origin.height * 60) };
  div.remove();
  return out;
};
const rows = [{ left: 111.89999999999999, right: 111.89999999999999 }, { left: 37.3, right: 37.3 }, { left: 37.3, right: 37.3 }];
const text = 'aaaa bbbb cccc dddd eeee ffff gggg';
return {
  dpr: window.devicePixelRatio,
  indent10: layout(10, rows, text),
  indent0: layout(0, rows, text),
  indent9: layout(9, rows, text),
  ltrNote: 'direction rtl as in the case',
};
`

export default function probes(): Probe[] {
  return [
    {
      id: 'gecko-port F5',
      spec: 'gecko-port F5: a first line whose text-indent is wider than the first row band between slot floats',
      pageLang: 'en',
      observe: [{ kind: 'script', source: SOURCE }],
      browsers: ['firefox'],
      note: 'Measurement only.',
    },
  ]
}
