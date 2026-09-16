// Gecko port follow-up F3 (installed Firefox 156, DPR 2): can Canvas tell which font draws an emoji cluster, in a fresh
// document and after the text-presentation measurement that pins U+1F600 (F2)? The port corrects a cluster to Apple Color
// Emoji's device-size advance only when Apple Color Emoji draws it (gfxMacFont.cpp:437-463 for sbix advances;
// gfxFontGroup::FindFontForChar, gfxTextRun.cpp:3178-3600, decides the font). The rule under test: a cluster is drawn by
// Apple Color Emoji when it measures the same in the run's font list as in "Apple Color Emoji" alone, at the CSS size and
// at the device size.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-emoji-font -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-emoji-font.ts --out=.artifacts/probes/gecko/emoji-font
import type { Probe } from './types.ts'

const SOURCE = String.raw`
const au = (font, text) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; return Math.round(c.measureText(text).width * 60); };
const dom = (font, text) => {
  const span = document.createElement('span');
  span.style.cssText = 'font: ' + font + '; white-space: pre';
  span.textContent = text;
  host.append(span);
  const w = Math.round(span.getBoundingClientRect().width * 60);
  span.remove();
  return w;
};
const clusters = { grin: '\u{1F600}', grinVS15: '\u{1F600}\u{FE0E}', heart: '❤', heartVS16: '❤\u{FE0F}', keycap: '#⃣',
  keycapVS16: '#\u{FE0F}⃣', flag: '\u{1F1EF}\u{1F1F5}', thumbTone: '\u{1F44D}\u{1F3FD}', one: '1', astronaut: '\u{1F469}‍\u{1F680}' };
const snapshot = () => {
  const out = {};
  for (const [name, text] of Object.entries(clusters)) {
    out[name] = {
      arial16: au('16px Arial', text), ace16: au('16px "Apple Color Emoji"', text),
      arial32: au('32px Arial', text), ace32: au('32px "Apple Color Emoji"', text),
      times24: au('24px "Times New Roman"', text), ace24: au('24px "Apple Color Emoji"', text),
      times48: au('48px "Times New Roman"', text), ace48: au('48px "Apple Color Emoji"', text),
      dom16Arial: dom('16px Arial', text), dom24Times: dom('24px "Times New Roman"', text),
    };
  }
  return out;
};
const fresh = snapshot();
// F2's pinning measurement, then the DOM laying out the same sequence.
const pin = au('16px Georgia', '\u{1F600}\u{1F600}\u{FE0E}');
const pinDom = dom('16px Georgia', '\u{1F600}\u{1F600}\u{FE0E}');
const pinned = snapshot();
return { dpr: window.devicePixelRatio, pin, pinDom, fresh, pinned };
`

export default function probes(): Probe[] {
  return [
    {
      id: 'gecko-port F3',
      spec: 'gecko-port F3: Canvas identification of Apple Color Emoji clusters, fresh and after F2 pinning',
      pageLang: 'en',
      observe: [{ kind: 'script', source: SOURCE }],
      browsers: ['firefox'],
      note: 'Measurement only; the port compares the run font list with "Apple Color Emoji" at the CSS and device sizes.',
    },
  ]
}
