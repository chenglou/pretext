// Gecko port round 2 follow-ups F7 to F9 (installed Firefox 156, DPR 2). Measurement only: Range rects of text nodes in au
// (px × 60, unrounded), and measureText widths (× 60) and box metrics from a main-thread OffscreenCanvas ("oc"), a
// detached `<canvas>` element ("ec", created and never appended) and a connected one ("cc", appended to the host).
// - F7, the 1 au widths of research/ROUND1-CRITIC.md §5: per shaping unit, the DOM box against each Canvas, for the words of
//   the traced lines (Thonburi 32px, Geeza Pro 10px, Helvetica Neue 15px).
// - F8, digits in an 8-bit text run under lang="ko" (c-9d23fb8693d45e81): whether the DOM kerns `7:` and `-9` in Apple SD
//   Gothic Neo Bold, and which Canvas strings give the DOM's advances.
// - F9, a partial `fi` ligature at an emergency break (c-daf9c7047097f77b): the DOM's shares, and whether Canvas widths or
//   box metrics with ligatures switched off (letterSpacing 0.001px) show the ligature.
//
// Run: python3 .artifacts/session/with-browser-lock.py probes-gecko-round2 -- \
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-round2.ts --out=.artifacts/probes/gecko/round2
import type { Probe } from './types.ts'

const HELPERS = String.raw`
const ctxOf = (kind, font, lang, letterSpacing) => {
  let c;
  if (kind === 'oc') c = new OffscreenCanvas(1, 1).getContext('2d');
  else {
    const el = document.createElement('canvas');
    if (kind === 'cc') host.append(el);
    c = el.getContext('2d');
  }
  c.lang = lang; c.font = font; c.letterSpacing = letterSpacing || '0px';
  return c;
};
const measure = (kind, font, lang, text, letterSpacing) => {
  const m = ctxOf(kind, font, lang, letterSpacing).measureText(text);
  return { au: +(m.width * 60).toFixed(4), left: +(m.actualBoundingBoxLeft * 60).toFixed(4), right: +(m.actualBoundingBoxRight * 60).toFixed(4) };
};
const dom = (font, lang, direction, parts, width) => {
  const div = document.createElement('div');
  div.style.cssText = 'position: absolute; left: 0; top: 0; margin: 0; padding: 0; border: 0; line-height: 40px; white-space: ' + (width ? 'normal; overflow-wrap: anywhere; width: ' + width + 'px' : 'pre') + '; direction: ' + direction + '; font: ' + font;
  div.lang = lang;
  const nodes = parts.map(p => document.createTextNode(p));
  for (const n of nodes) { const s = document.createElement('span'); s.append(n); div.append(s); }
  host.append(div);
  const origin = div.getBoundingClientRect().left;
  const range = document.createRange();
  const out = nodes.map(node => {
    range.selectNodeContents(node);
    const whole = [...range.getClientRects()].map(r => [+((r.left - origin) * 60).toFixed(3), +(r.width * 60).toFixed(3)]);
    const points = [];
    for (let i = 0; i < node.data.length;) {
      const len = node.data.codePointAt(i) > 0xffff ? 2 : 1;
      range.setStart(node, i); range.setEnd(node, i + len);
      points.push([...range.getClientRects()].map(r => [+((r.left - origin) * 60).toFixed(3), +(r.width * 60).toFixed(3), r.top]));
      i += len;
    }
    return { text: node.data, whole, points };
  });
  div.remove();
  return out;
};
const units = (font, lang, direction, words) => words.map(w => ({
  text: w,
  dom: dom(font, lang, direction, [w])[0].whole,
  oc: measure('oc', font, lang, w).au,
  ec: measure('ec', font, lang, w).au,
  cc: measure('cc', font, lang, w).au,
}));
`

const F7 = String.raw`
const paragraph = "In the heart of القاهرة القديمة, you can find ancient mosques alongside modern cafés. The city's history spans millennia. كل شارع يحكي قصة مختلفة about the rich cultural heritage.";
const helvetica = '400 15px "Helvetica Neue", Helvetica, Arial, sans-serif';
return {
  dpr: window.devicePixelRatio,
  thonburi: units('500 32px Thonburi', 'en', 'ltr', ['รมชาติทำให้ผู้คนมีคว', 'รมชาติทำให้ผู้คนมี', 'รมชาติ']),
  geeza300: units('300 10px "Geeza Pro"', 'en', 'rtl', ['على', 'شكره', 'ووفقك', ' ']),
  geeza400: units('400 10px "Geeza Pro"', 'en', 'rtl', ['ووفقك', 'لطاعته', ' ']),
  helvetica: units(helvetica, 'en', 'ltr', paragraph.split(' ').concat([' '])),
  helveticaLine: { text: paragraph.slice(54, 105), dom: dom(helvetica, 'en', 'ltr', [paragraph.slice(54, 105)])[0].whole, oc: measure('oc', helvetica, 'en', paragraph.slice(54, 105)).au, ec: measure('ec', helvetica, 'en', paragraph.slice(54, 105)).au },
  menlo: units('400 16px Menlo', 'en', 'ltr', ['workers', 'straight']),
};
`

const F8 = String.raw`
const bold = '700 18px "Apple SD Gothic Neo"';
return {
  domKo8bit: dom(bold, 'ko', 'ltr', [' 7:00-9:00']),
  domEn8bit: dom(bold, 'en', 'ltr', [' 7:00-9:00']),
  // One text run of two nodes with equal style, the second holding a Hangul syllable: the run is 16-bit.
  domKo16bit: dom(bold, 'ko', 'ltr', ['7:00-9:00', '한']),
  canvas: {
    koAlone: measure('oc', bold, 'ko', '7:00-9:00').au,
    koSuffix: measure('oc', bold, 'ko', ':00-9:00').au,
    enAlone: measure('oc', bold, 'en', '7:00-9:00').au,
    koLatinContext: measure('oc', bold, 'ko', 'a 7:00-9:00').au,
    koLatinContextSpace: measure('oc', bold, 'ko', 'a ').au,
    koLatinContextSuffix: measure('oc', bold, 'ko', 'a :00-9:00').au,
    koSeven: measure('oc', bold, 'ko', '7').au,
    enSeven: measure('oc', bold, 'en', '7').au,
    ecKoAlone: measure('ec', bold, 'ko', '7:00-9:00').au,
  },
};
`

const F9 = String.raw`
const helvetica = '400 14px "Helvetica Neue"';
const strings = ['f', 'i', 'fi', 'firstname', 'irstname', 'fl', 'ffi', 'office', 'x', 'fix'];
const set = (font) => {
  const out = {};
  for (const s of strings) out[s] = { on: measure('oc', font, 'en', s), off: measure('oc', font, 'en', s, '0.001px') };
  return out;
};
return {
  domWord: dom(helvetica, 'en', 'ltr', ['firstname']),
  domEmergency: dom(helvetica, 'en', 'ltr', ['firstname'], 2),
  helvetica: set(helvetica),
  arial: set('400 14px Arial'),
  georgia: set('400 14px Georgia'),
};
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
    probe('gecko-port F7', 'gecko-port F7: 1 au unit widths against OffscreenCanvas and canvas elements', F7),
    probe('gecko-port F8', 'gecko-port F8: digits in an 8-bit text run under lang ko', F8),
    probe('gecko-port F9', 'gecko-port F9: partial fi ligature shares and Canvas ligature evidence', F9),
  ]
}
