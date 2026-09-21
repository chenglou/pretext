// The library's runtime font checks (rebuild/src/measure/font-checks.ts) in the browsers, over every font declaration the
// lab's case files name, beside what the DOM does with the same declaration. The page runs the library's own module with
// what the running engine's port asks of it (src/engines/<engine>/checks.ts), both bundled here, so the answers are the
// ones a layout gets. Raw values only: the verdict tool compares them with the lab's
// font table (rebuild/lab/font-facts.ts) and the DOM observations.
//
// Per declaration (16px, lang en), each in a paragraph of its own, which is one call of the checks; the page counts the
// contexts a call makes and logs its measureText calls on the Canvas classes:
// - `all`: the facts learned for a paragraph holding a soft hyphen and an Arabic letter, so every check the engine has
//   runs, with the whole Canvas call log (font string as assigned, text, width).
// - `plain`: the same for a paragraph of Latin letters alone, the common case: its Canvas calls and contexts.
// - DOM: the hyphen a soft hyphen break draws (a min-content block of `mmmm` SHY `ii`, beside U+2010 and U+002D alone);
//   two behs in one text node, around U+200C, and with the second in a span with `vertical-align: 0px`, which ends Blink's
//   shaping call at the span's edge (ShouldBreakShapingBeforeBox, inline_node.cc:494-527), so the behs join there only in a
//   font that reads HarfBuzz's context; the sample string's width at 16px, beside Canvas at 16px and at 16px times the
//   device pixel ratio.
// - `shared`: every declaration as a span of one paragraph, in list order, which is one call: the Canvas calls and contexts
//   of all of them together, where declarations share their questions (the two generics alone, a family at the probe size).
//
// Run under the browser lock, from the worktree:
//   python3 ~/github/pretext-rebuild/.artifacts/session/with-browser-lock.py font-checks-probe-chrome -- bun rebuild/probes/runner.ts \
//     --browser=chrome --probes=rebuild/probes/font-checks.ts --out=.artifacts/lab/font-checks/probes --probe-timeout-ms=120000
// (and --browser=firefox, --browser=webkit-host). Verdicts: bun .artifacts/lab/font-checks/tools/verdict.ts
import { join } from 'node:path'
import { labDeclarations } from '../lab/font-facts.ts'
import type { Probe } from './types.ts'

const FIXTURES = ['Amiri', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'ProbeShantell', 'Shantell Sans']

const PAGE = String.raw`
const lib = await import('data:text/javascript;base64,' + LIBRARY);
const canvas = await import('data:text/javascript;base64,' + CANVAS);
const ua = navigator.userAgent;
const engine = /\bFirefox\//.test(ua) ? 'gecko' : /\bChrome\//.test(ua) ? 'blink' : 'webkit';
const env = { engine, devicePixelRatio: window.devicePixelRatio };
const port = await import('data:text/javascript;base64,' + CHECKS[engine]);
const checks = engine === 'blink' ? port.blinkFontChecks(env) : engine === 'webkit' ? port.webkitFontChecks : port.geckoFontChecks;
const SAMPLE = 'Hamburgefonstiv', BEH = '\u0628', ZWNJ = '\u200c';
// The page's own count of a call's Canvas work: contexts made, and every measureText call with the font string its context
// was assigned. Arguments pass through untouched.
let made = 0, asked = [];
const assignedFont = new WeakMap();
const proto = OffscreenCanvasRenderingContext2D.prototype;
const fontProperty = Object.getOwnPropertyDescriptor(proto, 'font');
Object.defineProperty(proto, 'font', { ...fontProperty, set(value) { assignedFont.set(this, String(value)); fontProperty.set.call(this, value); } });
const measureText = proto.measureText;
proto.measureText = function (text) { const metrics = measureText.call(this, text); asked.push([assignedFont.get(this), text, metrics.width]); return metrics; };
const getContext = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (...rest) { made++; return getContext.apply(this, rest); };
const style = d => ({
  font: { family: d.family, size: 16, weight: d.weight, style: d.style, facts: { primaryFamily: null, mapsHyphen: null, monospace: null, opticalSizeAxis: null, joining: null, pairKerning: null } },
  letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
});
const block = (d, content) => ({ ...style(d), content, lang: 'en', direction: 'ltr', lineHeight: 20, textIndent: 0, textAlign: 'start' });
const learn = paragraph => {
  made = 0; asked = [];
  const facts = lib.withLearnedFontFacts(paragraph, checks, canvas.createContextPool()).font.facts;
  return { facts, calls: asked.length, contexts: made, log: asked };
};
const domWidth = (font, html, extra) => {
  const div = document.createElement('div');
  div.lang = 'en';
  div.setAttribute('style', 'position:absolute;left:0;top:0;white-space:nowrap;font:' + font + ';' + (extra || ''));
  div.innerHTML = '<span>' + html + '</span>';
  host.appendChild(div);
  const width = div.firstChild.getBoundingClientRect().width;
  div.remove();
  return width;
};
const canvasWidth = (font, text) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; return c.measureText(text).width; };
const out = { engine, dpr: window.devicePixelRatio, declarations: [], shared: null };
for (const d of DECLARATIONS) {
  const font = d.style + ' ' + d.weight + ' 16px ' + d.family;
  const { log, ...all } = learn(block(d, [{ kind: 'text', text: 'a\u00adb ' + BEH }]));
  const { log: _plainLog, ...plain } = learn(block(d, [{ kind: 'text', text: 'ab cd' }]));
  const hyphenDom = (() => {
    const div = document.createElement('div');
    div.lang = 'en';
    div.setAttribute('style', 'position:absolute;left:0;top:0;width:min-content;hyphens:manual;font:' + font);
    div.textContent = 'mmmm\u00adii';
    host.appendChild(div);
    const minContent = div.getBoundingClientRect().width;
    div.remove();
    return { minContent, mmmm: domWidth(font, 'mmmm'), hyphen: domWidth(font, '\u2010'), minus: domWidth(font, '-') };
  })();
  const joiningDom = {
    plain: domWidth(font, BEH + BEH, 'direction:rtl'),
    edge: domWidth(font, BEH + '<span style="vertical-align:0px">' + BEH + '</span>', 'direction:rtl'),
    zwnj: domWidth(font, BEH + ZWNJ + BEH, 'direction:rtl'),
  };
  const zoomed = 16 * window.devicePixelRatio;
  const sizes = {
    dom: domWidth(font, SAMPLE), canvasCss: canvasWidth(font, SAMPLE),
    canvasZoomed: canvasWidth(d.style + ' ' + d.weight + ' ' + zoomed + 'px ' + d.family, SAMPLE),
  };
  out.declarations.push({ declaration: d, all, plain, log, hyphenDom, joiningDom, sizes });
}
const edge = { margin: 0, border: 0, padding: 0 };
const spans = DECLARATIONS.map(d => ({ ...style(d), kind: 'span', lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: 'a\u00adb ' + BEH }] }));
const together = learn(block(DECLARATIONS[0], spans));
out.shared = { calls: together.calls, contexts: together.contexts };
return out;
`

async function bundled(path: string): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, path)], format: 'esm', target: 'browser' })
  if (!built.success) throw new Error(`${path} didn't bundle: ${built.logs.join('\n')}`)
  return Buffer.from(await built.outputs[0]!.text()).toString('base64')
}

export default async function probes(): Promise<Probe[]> {
  const library = await bundled('../src/measure/font-checks.ts')
  const canvas = await bundled('../src/measure/canvas.ts')
  const checks = { blink: await bundled('../src/engines/blink/checks.ts'), webkit: await bundled('../src/engines/webkit/checks.ts'), gecko: await bundled('../src/engines/gecko/checks.ts') }
  const declarations = labDeclarations().map(d => ({ family: d.family, weight: d.weight, style: d.style }))
  const source = `const LIBRARY = ${JSON.stringify(library)};\nconst CANVAS = ${JSON.stringify(canvas)};\nconst CHECKS = ${JSON.stringify(checks)};\nconst DECLARATIONS = ${JSON.stringify(declarations)};\n${PAGE}`
  return [{
    id: 'font-checks/lab-declarations',
    spec: 'rebuild/src/measure/font-checks.ts: every check, per lab font declaration, beside the DOM',
    pageLang: 'en',
    html: '<div></div>',
    fontFixtures: FIXTURES,
    observe: [{ kind: 'env' }, { kind: 'script', source }],
  }]
}
