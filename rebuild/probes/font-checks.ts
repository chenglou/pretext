// The library's runtime font checks (rebuild/src/measure/font-checks.ts) in the browsers, over every font declaration the
// lab's case files name, beside what the DOM does with the same declaration. The page runs the library's own module,
// bundled here, so the answers are the ones a layout gets. Raw values only: the verdict tool compares them with the lab's
// font table (rebuild/lab/font-facts.ts) and the DOM observations.
//
// Per declaration (16px, lang en), with a measurer of its own each time:
// - `all`: the facts learned for a paragraph holding a soft hyphen and an Arabic letter, so every check the engine has
//   runs, with the whole Canvas call log (font string, text, width).
// - `plain`: the same for a paragraph of Latin letters alone, the common case: its Canvas calls and contexts.
// - DOM: the hyphen a soft hyphen break draws (a min-content block of `mmmm` SHY `ii`, beside U+2010 and U+002D alone);
//   two behs in one text node, around U+200C, and with the second in a span with `vertical-align: 0px`, which ends Blink's
//   shaping call at the span's edge (ShouldBreakShapingBeforeBox, inline_node.cc:494-527), so the behs join there only in a
//   font that reads HarfBuzz's context; the sample string's width at 16px, beside Canvas at 16px and at 16px times the
//   device pixel ratio.
// - `shared`: every declaration through one measurer, in list order: the calls the second and later declarations cost
//   when answers and generic-family measurements are already there.
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
const ua = navigator.userAgent;
const engine = /\bFirefox\//.test(ua) ? 'gecko' : /\bChrome\//.test(ua) ? 'blink' : 'webkit';
const env = { engine, devicePixelRatio: window.devicePixelRatio };
const SAMPLE = 'Hamburgefonstiv', BEH = '\u0628', ZWNJ = '\u200c';
const measurer = () => ({ log: { contexts: [], calls: [], memoHits: 0 }, keys: new Map(), contexts: [], memo: [] });
const paragraph = (d, text) => ({
  font: { family: d.family, size: 16, weight: d.weight, style: d.style, facts: { primaryFamily: null, mapsHyphen: null, monospace: null, opticalSizeAxis: null, joining: null, pairKerning: null } },
  letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
  content: [{ kind: 'text', text }], lang: 'en', direction: 'ltr', width: 300, lineHeight: 20, textIndent: 0, textAlign: 'start',
});
const learn = (d, text, m) => {
  const facts = lib.withLearnedFontFacts(paragraph(d, text), env, m).font.facts;
  return { facts, calls: m.log.calls.length, contexts: m.log.contexts.length };
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
const out = { engine, dpr: window.devicePixelRatio, declarations: [], shared: [] };
const sharedMeasurer = measurer();
for (const d of DECLARATIONS) {
  const font = d.style + ' ' + d.weight + ' 16px ' + d.family;
  const m = measurer();
  const all = learn(d, 'a\u00adb ' + BEH, m);
  const log = m.log.calls.map(c => [m.log.contexts[c.context].font, c.text, c.width]);
  const plain = learn(d, 'ab cd', measurer());
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
  const before = sharedMeasurer.log.calls.length, contextsBefore = sharedMeasurer.log.contexts.length;
  learn(d, 'a\u00adb ' + BEH, sharedMeasurer);
  out.shared.push({ calls: sharedMeasurer.log.calls.length - before, contexts: sharedMeasurer.log.contexts.length - contextsBefore });
}
return out;
`

export default async function probes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/measure/font-checks.ts')], format: 'esm', target: 'browser' })
  if (!built.success) throw new Error(`the font checks didn't bundle: ${built.logs.join('\n')}`)
  const library = Buffer.from(await built.outputs[0]!.text()).toString('base64')
  const declarations = labDeclarations().map(d => ({ family: d.family, weight: d.weight, style: d.style }))
  const source = `const LIBRARY = ${JSON.stringify(library)};\nconst DECLARATIONS = ${JSON.stringify(declarations)};\n${PAGE}`
  return [{
    id: 'font-checks/lab-declarations',
    spec: 'rebuild/src/measure/font-checks.ts: every check, per lab font declaration, beside the DOM',
    pageLang: 'en',
    html: '<div></div>',
    fontFixtures: FIXTURES,
    observe: [{ kind: 'env' }, { kind: 'script', source }],
  }]
}
