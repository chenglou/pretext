// The word pieces identity asked of the real browser's Canvas in every font family of a list, where
// tools/words-identity.ts reads it from the recorded answers of the lab's few fonts: is a run of words measured whole
// equal to its words each measured with its trailing space, plus the pair adjustment between each space and the cluster
// after it? W(w1 s w2 s w3) = W(w1 s) + d(w2) + W(w2 s) + d(w3) + W(w3), with d(w) = W(s c) - W(s) - W(c), c the first
// grapheme of w, s = U+2028 as Blink's port writes a space, in 16.16 units at the zoomed size, wholes below 256 px.
//
//   WORDS_FONTS=<families.json> bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/words-identity-probe.ts \
//     --out=<dir> --probe-timeout-ms=900000 --stall-ms=900000        (a Chrome slot of the browser lock; counts, no times)
//
// Left-to-right texts alone: the port adds U+200D where letters join at a measured edge, which this probe doesn't. Per
// family: windows of two and of three words tried, how many are exact, the largest difference, whether any d is non-zero
// (the font kerns with the space glyph, so the identity isn't trivially true), the windows of three that are off though both
// of their windows of two are exact (what a check of two words at every cut would miss), and a few windows that are off.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { TEXTS } from './words-fonts-probe.ts'

const BODY = String.raw`
const zoom = window.devicePixelRatio;
const SPACE = String.fromCharCode(0x2028);
const probeContext = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font) => { probeContext.font = font; return probeContext.measureText('mmmmmmmmmmlliWAVA fi 123').width; };
const resolves = (family) => measured('72px ' + family + ', monospace') !== measured('72px monospace') || measured('72px ' + family + ', serif') !== measured('72px serif');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const firstOf = (word) => graphemes.segment(word)[Symbol.iterator]().next().value.segment;
const out = [];
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  // One context for strings that hold U+2028 (two-byte) and one for words alone (one-byte where Latin-1), as the port
  // keeps the two storages apart.
  const make = () => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = 'normal 400 ' + (16 * zoom) + 'px ' + family; c.fontKerning = 'auto'; c.textRendering = 'optimizeLegibility'; c.direction = 'ltr'; return c; };
  const wide = make(), narrow = make();
  const memo = new Map();
  const W = (s) => { let v = memo.get('|' + s); if (v === undefined) { v = (s.indexOf(SPACE) >= 0 ? wide : narrow).measureText(s).width; memo.set('|' + s, v); } return v; };
  const U = (s) => Math.round(W(s) * 65536);
  const row = { family: FONTS[f], resolves: true, pairs: 0, pairsExact: 0, triples: 0, triplesExact: 0, triplesOffWithExactPairs: 0, largest16: 0, kernsWithSpace: 0, examples: [] };
  const pairOff = new Map();
  for (let t = 0; t < TEXTS.length; t++) {
    if (TEXTS[t].rtl) continue;
    const words = TEXTS[t].text.split(' ').filter(w => w !== '');
    const d = (w) => { const c = firstOf(w); return U(SPACE + c) - U(SPACE) - U(c); };
    pairOff.clear();
    for (let i = 0; i + 1 < words.length; i++) {
      for (let n = 2; n <= 3 && i + n <= words.length; n++) {
        const slice = words.slice(i, i + n);
        const whole = slice.join(SPACE);
        if (W(whole) >= 256) continue;
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += k + 1 < n ? U(slice[k] + SPACE) : U(slice[k]);
          if (k > 0) { const dk = d(slice[k]); if (dk !== 0) row.kernsWithSpace++; sum += dk; }
        }
        const off = Math.abs(sum - U(whole));
        if (n === 2) { row.pairs++; if (off === 0) row.pairsExact++; pairOff.set(i, off !== 0); }
        else {
          row.triples++;
          if (off === 0) row.triplesExact++;
          // A window of three that is off though both of its windows of two are exact: what a check of two words a cut misses.
          else if (pairOff.get(i) === false && W(words[i + 1] + SPACE + words[i + 2]) < 256) {
            const right = U(words[i + 1] + SPACE + words[i + 2]) - U(words[i + 1] + SPACE) - U(words[i + 2]) - d(words[i + 2]);
            if (right === 0) { row.triplesOffWithExactPairs++; if (row.examples.length < 8) row.examples.push({ text: t, words: slice.join(' '), whole16: U(whole), pieces16: sum, pairsExact: true }); }
          }
        }
        if (off > row.largest16) row.largest16 = off;
        if (off !== 0 && row.examples.length < 5) row.examples.push({ text: t, words: slice.join(' '), whole16: U(whole), pieces16: sum });
      }
    }
  }
  out.push(row);
  if (f % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: zoom, fonts: out };
`

const RTL = new Set(['ar', 'ur', 'he'])

export default function wordsIdentityProbes(): Probe[] {
  const fontsPath = process.env['WORDS_FONTS']
  if (fontsPath === undefined) throw new Error('WORDS_FONTS names the families file')
  const texts = TEXTS.map(given => ({ text: given.text, rtl: RTL.has(given.lang) }))
  return [{
    id: 'words-identity I1', spec: 'word pieces study: a run of words against its words with their spaces and the pair adjustments, on the machine\'s font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `const FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\nconst TEXTS = ${JSON.stringify(texts)};\n${BODY}` }],
  }]
}
