// x-sysui experiment: which kind of canvas gives the DOM's width of platform UI font text, per engine.
//
// For each string, content language and size, in one document per page language: the DOM width of a span (font-family
// system-ui, lang on the span), and measureText on
//   offscreen          an OffscreenCanvas at the CSS size, ctx.lang = the span's lang where the context has the attribute
//   offscreenDevice    the same at the CSS size × devicePixelRatio, width ÷ devicePixelRatio
//   detached           a `<canvas>` element never connected, with a lang attribute, at the CSS size
//   detachedDevice     the same at the device size (Gecko's round 3 recipe), width ÷ devicePixelRatio
//   connected          a `<canvas lang>` element connected to the document (display: none would drop its style, so it is
//                      position: fixed, 1 × 1), at the CSS size
//   connectedDevice    the same at the device size
//
//   python3 .artifacts/session/with-browser-lock.py probes-sysui -- bun rebuild/probes/runner.ts --browser=<b> \
//     --probes=rebuild/probes/sysui-canvas-kinds.ts --out=.artifacts/sysui/probes/<b>
import type { Probe } from './types.ts'

const BODY = String.raw`
const Z = window.devicePixelRatio;
const TEXTS = [
  ['latin', 'AVATAR Wave To. office fifty'],
  ['punct', 'Save “Untitled” · Wi-Fi… ‘ok’'],
  ['digits', '11/17/2026, 7:41 AM — 0.5×'],
  ['han', '直骨海角過誤認'],
  ['hans', '这是一个测试还结'],
  ['kana', 'こんにちはカタカナ'],
  ['hangul', '안녕하세요 그녀가'],
  ['emoji', '😀👍🏽❤️'],
  ['arabic', 'مرحبا بالعالم'],
  ['thai', 'ภาษาไทยไม่มี'],
];
const LANGS = ['en', 'ja', 'zh-Hans', 'zh-Hant', 'ko'];
const SIZES = [13, 16, 17.3, 20, 24];
const FAMILY = 'system-ui';
const contexts = new Map();
const hidden = document.createElement('div');
hidden.style.cssText = 'position: fixed; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden';
host.appendChild(hidden);
const contextOf = (kind, lang, size) => {
  const key = kind + '|' + lang + '|' + size;
  let c = contexts.get(key);
  if (c !== undefined) return c;
  if (kind === 'offscreen') {
    c = new OffscreenCanvas(1, 1).getContext('2d');
    if ('lang' in c) c.lang = lang;
  } else {
    const el = document.createElement('canvas');
    el.width = 1; el.height = 1;
    el.setAttribute('lang', lang);
    if (kind === 'connected') hidden.appendChild(el);
    c = el.getContext('2d');
    if ('lang' in c) c.lang = kind === 'connected' ? 'inherit' : lang;
  }
  c.font = size + 'px ' + FAMILY;
  contexts.set(key, c);
  return c;
};
const out = [];
for (const lang of LANGS) {
  for (const size of SIZES) {
    for (const [name, text] of TEXTS) {
      const span = document.createElement('span');
      span.setAttribute('lang', lang);
      span.style.cssText = 'font: ' + size + 'px ' + FAMILY + '; white-space: pre; position: absolute; left: 0; top: 0';
      span.textContent = text;
      host.appendChild(span);
      const dom = span.getBoundingClientRect().width;
      host.removeChild(span);
      const row = { lang, size, name, dom };
      for (const kind of ['offscreen', 'detached', 'connected']) {
        row[kind] = contextOf(kind, lang, size).measureText(text).width;
        row[kind + 'Device'] = contextOf(kind, lang, size * Z).measureText(text).width / Z;
      }
      out.push(row);
    }
  }
}
return { devicePixelRatio: Z, hasCtxLang: 'lang' in new OffscreenCanvas(1, 1).getContext('2d'), rows: out };
`

export default function probes(): Probe[] {
  const list: Probe[] = []
  for (const pageLang of ['en', 'ja']) {
    list.push({
      id: `sysui canvas kinds (page ${pageLang})`, spec: 'x-sysui: which canvas gives the DOM width of system-ui text', pageLang,
      html: '<div></div>', observe: [{ kind: 'script', source: BODY }],
    })
  }
  return list
}
