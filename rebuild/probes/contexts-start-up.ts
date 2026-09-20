// Every way a KEPT Canvas context can answer otherwise than a context made now, for the same settings and string, in a
// browser that has just started (src/index.ts prepare keeps a page's contexts in Blink and WebKit; research/PERF-CONTEXT-STORE.md
// §3.7 found Firefox's kept contexts on the fallback font for families named by a localized name). Raw Canvas beside the
// DOM, no library. One probe a browser launch; the runner launches the pinned browser anew for every run.
//
// - S1: 11 font declarations, each with one context per way of touching it, all made before anything is measured, read
//   every 250 ms for ten seconds beside a new context and a DOM span. The declarations: families by their English name, by
//   a localized name (Japanese, Chinese, Korean), by a legacy family name of one face (`Avenir Next Condensed Heavy`), a
//   family that doesn't exist, generic keywords under `ja` and `zh-CN`, and the bench's list with U+20BF (a character
//   Gecko finds a font for only by its global fallback).
//   The ways of touching a context, at every reading unless said: nothing (`kept`); the same font string assigned again;
//   another font string and back; fontKerning to `none` and back; lang to another language and back; letterSpacing to 1px
//   and back; fontKerning to `none` and back and then a spelling of the same font string that the context has never seen
//   (one more trailing space each time). `kerningLate`, `langLate` and `otherAndBackLate` do nothing before five seconds in
//   and then touch at every reading, which tells a way that works once from one that never does. `firstMeasuredLate` has
//   its font assigned at the start and is first measured five seconds in.
// - S2: S1 in a page that does nothing for twelve seconds first, past Gecko's gfx.font_loader.delay of 8 s: whether the
//   names come by themselves, without anyone asking for one.
// - S3: S1 with three more declarations, each a web font that arrives four seconds in, by three routes at once: a FontFace
//   made from bytes and added, a FontFace with a URL added and then loaded, an @font-face rule that a span uses. In Firefox
//   the page's font set changing is also what brings S1's stale contexts back.
// - W1 to W8: one route alone in a document of its own, two seconds in, with a span in the family (W1 bytes, W2 URL, W3
//   rule) and without any DOM text in it (W4, W5, W6), which is a page that paints with Canvas or prepares before it
//   renders. probes/contexts-font-load.ts is W4's case. W7 and W8 are a fourth route with and without the span: a
//   FontFace with a URL that is loaded first and added after, which is how most pages that load fonts by script do it.
// - T1: what each way costs beside making a context, a loop per way, the ways taking turns over five rounds. Times, so
//   read the ratios between ways; `spinMs` is a fixed arithmetic loop of its own before and after each font, which shows
//   a machine whose load changed during the run.
//
// Per declaration and way: every change of the answer with the time of the reading that first showed it. A list of one
// entry never changed. The verdicts are in research/PERF-LIFETIME.md ("Kept contexts in a browser that has just started").
//
// Run under the browser lock, from the worktree (S2 waits, so give it a longer probe timeout):
//   python3 .artifacts/session/with-browser-lock.py contexts-start-up --browser=firefox -- bun rebuild/probes/runner.ts \
//     --browser=firefox --probes=rebuild/probes/contexts-start-up.ts --only="S1" --probe-timeout-ms=60000 --out=<dir>
import type { Probe } from './types.ts'

const ROWS = String.raw`
const LATIN = 'Hamburgefonstiv 0123';
const CJK = '漢字とかな 한글 汉字 Hamburg';
const BITCOIN = 'that is 5 ' + String.fromCodePoint(0x20bf) + ' a month';
const SYSTEM_ROWS = [
  ['Hiragino Sans, English name', '"Hiragino Sans", monospace', 'en', LATIN],
  ['Hiragino Sans, Japanese name', '"ヒラギノ角ゴシック", monospace', 'en', LATIN],
  ['PingFang SC, Chinese name', '"苹方-简", monospace', 'en', LATIN],
  ['Apple SD Gothic Neo, Korean name', '"Apple SD 산돌고딕 Neo", monospace', 'en', LATIN],
  ['Avenir Next Condensed Heavy, a legacy family name', '"Avenir Next Condensed Heavy", monospace', 'en', LATIN],
  ['Avenir Next Condensed, English name', '"Avenir Next Condensed", monospace', 'en', LATIN],
  ['a family that does not exist', '"No Such Family Zq", monospace', 'en', LATIN],
  ['sans-serif under ja', 'sans-serif', 'ja', CJK],
  ['serif under zh-CN', 'serif', 'zh-CN', CJK],
  ['system-ui under ja', 'system-ui', 'ja', CJK],
  ['the bench list with U+20BF', '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', 'en', BITCOIN],
];
const WEB_ROWS = {
  bytes: ['a web font, a FontFace made from bytes and added', '"Late Bytes", monospace', 'en', LATIN],
  url: ['a web font, a FontFace with a URL added and then loaded', '"Late Url", monospace', 'en', LATIN],
  rule: ['a web font, an @font-face rule', '"Late Rule", monospace', 'en', LATIN],
  loaded: ['a web font, a FontFace with a URL loaded and then added', '"Late Loaded", monospace', 'en', LATIN],
};
const fontOf = (row, size) => 'normal 400 ' + size + 'px ' + row[1];
`

const OVER_TIME = String.raw`
const make = (row) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = row[2]; c.font = fontOf(row, 32); return c; };
const WAYS = ['kept', 'sameString', 'otherAndBack', 'otherAndBackLate', 'kerning', 'kerningLate', 'lang', 'langLate', 'spacing', 'kerningAndNewSpelling', 'firstMeasuredLate'];
const LATE_MS = 5000;
const t0 = performance.now();
const contexts = ROWS.map(row => WAYS.map(() => make(row)));
const spellings = ROWS.map(() => 0);
const spans = !WITH_SPANS ? [] : ROWS.map(row => {
  const span = document.createElement('span');
  span.lang = row[2];
  span.style.cssText = 'font: ' + fontOf(row, 32) + '; white-space: nowrap; position: absolute; left: 0; top: 0';
  span.textContent = row[3];
  document.body.append(span);
  return span;
});
const seen = ROWS.map(() => { const out = { fresh: [], dom: [] }; for (let w = 0; w < WAYS.length; w++) out[WAYS[w]] = []; return out; });
const note = (list, width, ms) => { if (list.length === 0 || list[list.length - 1].width !== width) list.push({ width, fromMs: ms }); };
const touch = (r, way, c, ms) => {
  const row = ROWS[r];
  switch (way) {
    case 'kept': return true;
    case 'sameString': c.font = fontOf(row, 32); return true;
    case 'otherAndBackLate': if (ms < LATE_MS) return true;
    case 'otherAndBack': c.font = fontOf(row, 31); c.font = fontOf(row, 32); return true;
    case 'kerningLate': if (ms < LATE_MS) return true;
    case 'kerning': c.fontKerning = 'none'; c.fontKerning = 'auto'; return true;
    case 'langLate': if (ms < LATE_MS) return true;
    case 'lang': c.lang = 'fr'; c.lang = row[2]; return true;
    case 'spacing': c.letterSpacing = '1px'; c.letterSpacing = '0px'; return true;
    case 'kerningAndNewSpelling': spellings[r]++; c.fontKerning = 'none'; c.fontKerning = 'auto'; c.font = fontOf(row, 32) + ' '.repeat(spellings[r]); return true;
    case 'firstMeasuredLate': return ms >= LATE_MS;
  }
};
const readAll = () => {
  const ms = Math.round(performance.now() - t0);
  for (let r = 0; r < ROWS.length; r++) {
    for (let w = 0; w < WAYS.length; w++) if (touch(r, WAYS[w], contexts[r][w], ms)) note(seen[r][WAYS[w]], contexts[r][w].measureText(ROWS[r][3]).width, ms);
    note(seen[r].fresh, make(ROWS[r]).measureText(ROWS[r][3]).width, ms);
    if (WITH_SPANS) note(seen[r].dom, spans[r].getBoundingClientRect().width, ms);
  }
};
let fontsStarted = false;
const startFonts = async () => {
  if (ROUTES.includes('bytes')) {
    const bytes = new FontFace('Late Bytes', await (await fetch('/fonts/amiri.ttf')).arrayBuffer());
    await bytes.load();
    document.fonts.add(bytes);
  }
  if (ROUTES.includes('url')) {
    const url = new FontFace('Late Url', 'url(/fonts/amiri.ttf?late-url)');
    document.fonts.add(url);
    url.load();
  }
  if (ROUTES.includes('loaded')) {
    const loaded = new FontFace('Late Loaded', 'url(/fonts/amiri.ttf?late-loaded)');
    await loaded.load();
    document.fonts.add(loaded);
  }
  if (ROUTES.includes('rule')) {
    const style = document.createElement('style');
    style.textContent = '@font-face { font-family: "Late Rule"; src: url(/fonts/amiri.ttf?late-rule); }';
    document.head.append(style);
  }
};
readAll();
const firstPassMs = Math.round(performance.now() - t0);
for (let i = 0; i < 40; i++) {
  await new Promise(resolve => setTimeout(resolve, 250));
  if (!fontsStarted && ROUTES.length > 0 && performance.now() - t0 >= FONTS_AT_MS) { fontsStarted = true; startFonts(); }
  readAll();
}
for (let i = 0; i < spans.length; i++) spans[i].remove();
const rows = ROWS.map((row, r) => {
  const last = list => list[list.length - 1].width;
  const differsFromFreshAtTheEnd = WAYS.filter(way => seen[r][way].length > 0 && last(seen[r][way]) !== last(seen[r].fresh));
  return { what: row[0], font: fontOf(row, 32), lang: row[2], differsFromFreshAtTheEnd, freshDiffersFromDomAtTheEnd: WITH_SPANS && Math.abs(last(seen[r].fresh) - last(seen[r].dom)) > 0.05, ...seen[r] };
});
return { userAgent: navigator.userAgent, host: location.host, msSinceNavigationStart: Math.round(t0), waitedMs: WAITED_MS, routes: ROUTES, fontsAtMs: FONTS_AT_MS, withSpans: WITH_SPANS, firstPassMs, tookMs: Math.round(performance.now() - t0), rows };
`

const TIMING = String.raw`
const FONTS = ['normal 400 16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', 'normal 400 16px -apple-system, "Segoe UI", Roboto, sans-serif'];
const TEXT = 'Hamburgefonstiv';
const make = (font) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = 'en'; c.font = font; c.letterSpacing = '0px'; c.wordSpacing = '0px'; c.fontKerning = 'auto'; c.textRendering = 'auto'; c.direction = 'ltr';
  return c;
};
const spin = () => { const t = performance.now(); let x = 0; for (let i = 0; i < 20000000; i++) x = (x + i * i) % 1000003; return { ms: performance.now() - t, x }; };
let spelling = 0;
const WAYS = {
  'a new context, measured once': (font, kept) => make(font).measureText(TEXT).width,
  'a new context, not measured': (font, kept) => { make(font); return 0; },
  'the kept context, measured': (font, kept) => kept.measureText(TEXT).width,
  'the same string assigned again, measured': (font, kept) => { kept.font = font; return kept.measureText(TEXT).width; },
  'another string and back, measured': (font, kept) => { kept.font = 'normal 400 15px serif'; kept.font = font; return kept.measureText(TEXT).width; },
  'fontKerning to none and back, measured': (font, kept) => { kept.fontKerning = 'none'; kept.fontKerning = 'auto'; return kept.measureText(TEXT).width; },
  'fontKerning to none and back and a new spelling, measured': (font, kept) => { spelling = spelling % 40 + 1; kept.fontKerning = 'none'; kept.fontKerning = 'auto'; kept.font = font + ' '.repeat(spelling); return kept.measureText(TEXT).width; },
};
const names = Object.keys(WAYS);
const out = { userAgent: navigator.userAgent, spinMs: [], fonts: [] };
out.spinMs.push(spin().ms);
for (let f = 0; f < FONTS.length; f++) {
  const font = FONTS[f];
  const kept = make(font);
  kept.measureText(TEXT);
  const rounds = names.map(() => []);
  for (let round = 0; round < 5; round++) {
    for (let k = 0; k < names.length; k++) {
      const way = WAYS[names[round % 2 === 0 ? k : names.length - 1 - k]];
      const index = round % 2 === 0 ? k : names.length - 1 - k;
      let ops = 0;
      let sum = 0;
      const start = performance.now();
      let now = start;
      while (now - start < 120) { for (let i = 0; i < 200; i++) sum += way(font, kept); ops += 200; now = performance.now(); }
      rounds[index].push({ ops, ms: now - start, microsecondsAnOp: (now - start) * 1000 / ops, sum });
    }
  }
  out.fonts.push({ font, ways: names.map((name, k) => { const us = rounds[k].map(r => r.microsecondsAnOp).sort((a, b) => a - b); return { way: name, medianMicrosecondsAnOp: us[2], minMicrosecondsAnOp: us[0], maxMicrosecondsAnOp: us[4], rounds: rounds[k] }; }) });
  out.spinMs.push(spin().ms);
}
return out;
`

function overTime(rows: string, waitedMs: number, routes: string[], fontsAtMs: number, withSpans: boolean): string {
  const wait = waitedMs === 0 ? '' : 'await new Promise(resolve => setTimeout(resolve, WAITED_MS));'
  return `${ROWS}\nconst ROWS = ${rows};\nconst WAITED_MS = ${waitedMs};\nconst ROUTES = ${JSON.stringify(routes)};\nconst FONTS_AT_MS = ${fontsAtMs};\nconst WITH_SPANS = ${withSpans};\n${wait}\n${OVER_TIME}`
}

const ROUTE_NAMES = ['bytes', 'url', 'rule']

const probes: Probe[] = [{
  id: 'contexts-start-up S1', spec: 'kept Canvas contexts beside new ones and the DOM over ten seconds, in a browser that has just started', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime('SYSTEM_ROWS', 0, [], 0, true) }],
}, {
  id: 'contexts-start-up S2', spec: 'S1 in a page that does nothing for twelve seconds first', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime('SYSTEM_ROWS', 12000, [], 0, true) }],
}, {
  id: 'contexts-start-up S3', spec: 'S1 with three web fonts that arrive four seconds in', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: overTime('SYSTEM_ROWS.concat([WEB_ROWS.bytes, WEB_ROWS.url, WEB_ROWS.rule])', 0, ROUTE_NAMES, 4000, true) }],
}]
for (let i = 0; i < 6; i++) {
  const route = ROUTE_NAMES[i % 3]!
  const withSpans = i < 3
  probes.push({
    id: `contexts-start-up W${i + 1}`, spec: `one web font two seconds in, route ${route}, ${withSpans ? 'with a span in the family' : 'without DOM text in the family'}`, pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: overTime(`[WEB_ROWS.${route}]`, 0, [route], 2000, withSpans) }],
  })
}
for (let i = 0; i < 2; i++) {
  probes.push({
    id: `contexts-start-up W${i + 7}`, spec: `one web font two seconds in, route loaded, ${i === 0 ? 'with a span in the family' : 'without DOM text in the family'}`, pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: overTime('[WEB_ROWS.loaded]', 0, ['loaded'], 2000, i === 0) }],
  })
}
probes.push({
  id: 'contexts-start-up T1', spec: 'what each way of touching a kept context costs beside making a context', pageLang: 'en', html: '<div></div>',
  observe: [{ kind: 'script', source: TIMING }],
})

export default probes
