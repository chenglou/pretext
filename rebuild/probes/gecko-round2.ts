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
// Each probe returns its raw values with `checks` and `pre` over them (added in round 4).
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

// Checks over each probe's raw values (round 4): a probe's script runs inside `raw`, and the claims its verdict rests on are
// computed from the values it returned, so the output gives facts (rebuild/tests/facts.ts) and the raw values stay as before.
const CHECKS = String.raw`
const checks = [];
const pre = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, measured, expected) => { checks.push({ name, measured, expected, ok: same(measured, expected) }); };
const need = (name, measured, expected) => { pre.push({ name, measured, expected, ok: same(measured, expected) }); };
const boxAu = rects => Math.round(rects.reduce((a, r) => a + r[1], 0));
`
const withChecks = (source: string, checks: string): string => `${HELPERS}${CHECKS}const raw = (() => {${source}})();\n${checks}\nreturn { ...raw, checks, pre };`

const F7_CHECKS = String.raw`
const all = ['thonburi', 'geeza300', 'geeza400', 'helvetica', 'menlo'].flatMap(g => raw[g].map(u => ({ group: g, text: u.text, dom: boxAu(u.dom), oc: Math.round(u.oc), ec: Math.round(u.ec) })));
check('an OffscreenCanvas at the CSS size is within 1 au of the DOM box on every unit', all.filter(u => Math.abs(u.oc - u.dom) > 1).map(u => [u.group, u.text]), []);
check('the units where it is 1 au off, OffscreenCanvas less DOM', all.filter(u => u.oc !== u.dom).map(u => [u.group, u.text, u.oc - u.dom]), [['thonburi', 'รมชาติทำให้ผู้คนมีคว', -1], ['thonburi', 'รมชาติทำให้ผู้คนมี', -1], ['geeza300', 'ووفقك', -1], ['geeza400', 'ووفقك', -1], ['helvetica', 'modern', 1]]);
check('supplementary: a canvas element at the CSS size is off on more units than the OffscreenCanvas', all.filter(u => u.ec !== u.dom).length > all.filter(u => u.oc !== u.dom).length, true);
`

const F8_CHECKS = String.raw`
const node = raw.domKo8bit[0];
need('kerning shows in Canvas: the digits alone measure differently under ko and under en', raw.canvas.koAlone !== raw.canvas.enAlone, true);
check('an 8-bit node of digits under lang=ko is as wide as under lang=en: the run is Latin (gfxTextRun.cpp:2744-2747)', boxAu(node.whole), boxAu(raw.domEn8bit[0].whole));
check('the same digits in a 16-bit text run under ko are as wide as Canvas alone under ko: Common resolves to Hangul, without kerning', boxAu(raw.domKo16bit[0].whole), Math.round(raw.canvas.koAlone));
check('a Latin letter in front gives Canvas the 8-bit node: W(a 7:00-9:00) less W(a ) under ko is the node less its leading space', Math.round(raw.canvas.koLatinContext - raw.canvas.koLatinContextSpace), boxAu(node.whole) - boxAu(node.points[0]));
`

const F9_CHECKS = String.raw`
const hv = raw.helvetica;
const letters = raw.domWord[0].points;
need('fi in 14px "Helvetica Neue" is as wide as f and i apart', Math.round(hv.fi.on.au), Math.round(hv.f.on.au + hv.i.on.au));
check('fi is as wide with ligatures off (letterSpacing 0.001px)', hv.fi.off.au, hv.fi.on.au);
check('the ink box of fi differs with ligatures off', hv.fi.on.right !== hv.fi.off.right, true);
check('inside firstname the DOM gives f and i the shares of the fi ligature: they add up to it and differ by the rounding the last part takes', [boxAu(letters[0]) + boxAu(letters[1]), Math.abs(boxAu(letters[0]) - boxAu(letters[1])) <= 1], [Math.round(hv.fi.on.au), true]);
check('the shares are not the letters Canvas measures apart', boxAu(letters[0]) !== Math.round(hv.f.on.au), true);
check('Arial has no fi ligature: width and ink box agree with ligatures on and off', [raw.arial.fi.on.au === raw.arial.fi.off.au, raw.arial.fi.on.right === raw.arial.fi.off.right], [true, true]);
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
    probe('gecko-port F7', 'gecko-port F7: 1 au unit widths against OffscreenCanvas and canvas elements', F7, F7_CHECKS),
    probe('gecko-port F8', 'gecko-port F8: digits in an 8-bit text run under lang ko', F8, F8_CHECKS),
    probe('gecko-port F9', 'gecko-port F9: partial fi ligature shares and Canvas ligature evidence', F9, F9_CHECKS),
  ]
}
