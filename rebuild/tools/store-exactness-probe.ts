// An exactness probe for the store study: can the long strings the ports measure be had, bit for bit, from short
// questions that repeat? Counts, not times, so it needs no quiet machine (one browser slot):
//
//   STORE_SAMPLES=<samples.json> bun rebuild/probes/runner.ts --browser=chrome|firefox|webkit-host \
//     --probes=rebuild/tools/store-exactness-probe.ts --out=<dir> --probe-timeout-ms=600000
//
// samples.json holds chat messages by kind: { latin, smart, cjk, arabic }, arrays of strings.
// In each engine's own unit (Blink: round(W x 65536) at the zoomed size; Gecko: round(W x 60); WebKit: float32 px):
// - spaces: a run of 1 to 6 words measured whole, with the engine's space, against (a) every word alone plus the
//   spaces alone, which is what main sums, and (b) every word measured with the spaces beside it, less each inner space
//   once, which keeps what a word and its neighbouring space do to each other.
// - inside: the advance before every cluster of a word or of a run without spaces, as W(whole) - W(suffix), against
//   the clusters alone plus what each neighbouring pair measures together beyond its two clusters.
// Per font it reports how many samples agree exactly, the largest difference, and a few that differ.
import { readFileSync } from 'node:fs'
import type { Probe } from '../probes/types.ts'

const BODY = String.raw`
const ua = navigator.userAgent;
const engine = /\bFirefox\//.test(ua) ? 'gecko' : /\bChrome\//.test(ua) ? 'blink' : 'webkit';
const zoom = engine === 'blink' ? window.devicePixelRatio : 1;
const unit = engine === 'blink' ? (w => Math.round(w * 65536)) : engine === 'gecko' ? (w => Math.round(w * 60)) : (w => Math.fround(w));
const SPACE = engine === 'blink' ? '\u2028' : ' ';
const FONTS = ['"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', '"Times New Roman"', 'Arial', 'Georgia', 'Verdana', 'system-ui', '"Avenir Next"', '"Gill Sans"', 'Didot', 'Menlo'];
const contextFor = (family) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d');
  c.lang = 'en';
  c.font = 'normal 400 ' + (16 * zoom) + 'px ' + family;
  c.letterSpacing = '0px';
  c.wordSpacing = '0px';
  c.fontKerning = 'auto';
  c.textRendering = engine === 'blink' ? 'optimizeLegibility' : 'auto';
  c.direction = 'ltr';
  return c;
};
let seed = 99;
const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
const clustersOf = (s) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), g => g.segment);
const out = [];
for (let f = 0; f < FONTS.length; f++) {
  const c = contextFor(FONTS[f]);
  const memo = new Map();
  let calls = 0;
  const W = (s) => { let v = memo.get('|' + s); if (v === undefined) { v = unit(c.measureText(s).width); memo.set('|' + s, v); calls++; } return v; };
  const spaceAlone = W(SPACE);
  const spaces = { samples: 0, wordsAloneExact: 0, wordsWithSpacesExact: 0, maxAlone: 0, maxWithSpaces: 0, examples: [] };
  const texts = S.latin.concat(f === 0 ? S.smart : []);
  for (let t = 0; t < texts.length; t++) {
    const words = texts[t].split(' ').filter(w => w !== '');
    for (let n = 0; n < 6 && words.length > 1; n++) {
      const count = 2 + Math.floor(rand() * 5);
      const from = Math.floor(rand() * Math.max(1, words.length - count));
      const slice = words.slice(from, from + count);
      if (slice.length < 2) continue;
      const whole = c.measureText(slice.join(SPACE)).width;
      // Blink's totals are exact 16.16 values only below 256 zoomed px.
      if (engine === 'blink' && whole >= 256) continue;
      let alone = (slice.length - 1) * spaceAlone;
      let withSpaces = -(slice.length - 1) * spaceAlone;
      for (let i = 0; i < slice.length; i++) {
        alone += W(slice[i]);
        withSpaces += W((i > 0 ? SPACE : '') + slice[i] + (i + 1 < slice.length ? SPACE : ''));
      }
      const w = unit(whole);
      spaces.samples++;
      if (alone === w) spaces.wordsAloneExact++;
      if (withSpaces === w) spaces.wordsWithSpacesExact++;
      spaces.maxAlone = Math.max(spaces.maxAlone, Math.abs(alone - w));
      spaces.maxWithSpaces = Math.max(spaces.maxWithSpaces, Math.abs(withSpaces - w));
      if (withSpaces !== w && spaces.examples.length < 6) spaces.examples.push({ text: slice.join(' '), whole: w, wordsAlone: alone, wordsWithSpaces: withSpaces });
    }
  }
  const spaceCalls = calls;
  // Inside a word or a run without spaces: the advance before each cluster.
  const inside = {};
  const kinds = f === 0 ? ['latin', 'cjk', 'arabic'] : ['latin'];
  for (let kk = 0; kk < kinds.length; kk++) {
    const kind = kinds[kk];
    const tally = { units: 0, offsets: 0, clustersAloneExact: 0, withPairsExact: 0, maxAlone: 0, maxWithPairs: 0, longQuestions: 0, longUnits: 0, examples: [] };
    const seen = new Set();
    const list = S[kind];
    for (let t = 0; t < list.length && tally.units < 1500; t++) {
      const units = list[t].split(' ');
      for (let u = 0; u < units.length; u++) {
        const text = units[u];
        if (text.length < 3 || seen.has(text)) continue;
        seen.add(text);
        const clusters = clustersOf(text);
        if (clusters.length < 3) continue;
        const whole = c.measureText(text).width;
        if (engine === 'blink' && whole >= 256) continue;
        tally.units++;
        let alone = 0, pairs = 0;
        let at = 0;
        for (let k = 1; k < clusters.length; k++) {
          at += clusters[k - 1].length;
          const suffix = text.slice(at);
          tally.longQuestions++;
          tally.longUnits += suffix.length;
          const measured = unit(whole) - unit(c.measureText(suffix).width);
          alone += W(clusters[k - 1]);
          pairs += W(clusters[k - 1] + clusters[k]) - W(clusters[k - 1]) - W(clusters[k]);
          tally.offsets++;
          if (alone === measured) tally.clustersAloneExact++;
          if (alone + pairs === measured) tally.withPairsExact++;
          tally.maxAlone = Math.max(tally.maxAlone, Math.abs(alone - measured));
          tally.maxWithPairs = Math.max(tally.maxWithPairs, Math.abs(alone + pairs - measured));
          if (alone + pairs !== measured && tally.examples.length < 6) tally.examples.push({ text, before: at, measured, clustersAlone: alone, withPairs: alone + pairs });
        }
      }
    }
    inside[kind] = tally;
  }
  out.push({ font: FONTS[f], spaceAlone, spaces, shortQuestionsForSpaces: spaceCalls, inside, shortQuestionsInAll: calls });
}
return { userAgent: ua, engine, zoom, fonts: out };
`

export default function storeExactnessProbes(): Probe[] {
  const path = process.env['STORE_SAMPLES']
  if (path === undefined) throw new Error('STORE_SAMPLES names the samples file')
  return [{
    id: 'store-exactness E1', spec: 'store study: long measured strings against sums of short questions', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `const S = ${readFileSync(path, 'utf8')};\n${BODY}` }],
  }]
}
