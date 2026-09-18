// x-sysui experiment (Chrome): the DOM width of system-ui text at 20 and 24px against an OffscreenCanvas at the CSS size
// with text-rendering auto and optimizeLegibility (the port's contexts), whole string and word by word.
import type { Probe } from './types.ts'

const BODY = String.raw`
const TEXT = 'AVATAR Wave To. office fifty';
const out = [];
for (const size of [16, 20, 24]) {
  const span = document.createElement('span');
  span.style.cssText = 'font: ' + size + 'px system-ui; white-space: pre; position: absolute; left: 0; top: 0';
  span.textContent = TEXT;
  host.appendChild(span);
  const dom = span.getBoundingClientRect().width;
  host.removeChild(span);
  const row = { size, dom };
  for (const rendering of ['auto', 'optimizeLegibility', 'geometricPrecision']) {
    const c = new OffscreenCanvas(1, 1).getContext('2d');
    c.lang = 'en';
    c.font = size + 'px system-ui';
    c.textRendering = rendering;
    row[rendering] = c.measureText(TEXT).width;
    let words = 0;
    for (const part of TEXT.split(/( )/)) words += c.measureText(part).width;
    row[rendering + 'Words'] = words;
  }
  out.push(row);
}
return out;
`

export default function probes(): Probe[] {
  return [{ id: 'sysui blink text rendering', spec: 'x-sysui', pageLang: 'en', html: '<div></div>', observe: [{ kind: 'script', source: BODY }], browsers: ['chrome'] }]
}
