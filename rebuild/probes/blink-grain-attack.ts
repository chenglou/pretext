// The review of the cut-grain study (2026-09-20; GA1): the grain of Chrome's Canvas totals where the study's own probe
// (blink-grain.ts G1) didn't look. G1 asked 95 ASCII advances, 42 kerned pairs and three repeated strings, upright and
// regular, in installed families. This asks, per font declaration and zoomed size, raw:
// - `own`/`other`: the 16.16 advances of a script's single characters, or'ed, split by whether the family itself draws
//   the character (one it lacks measures the same with and without the family before a generic one, under two generics);
// - `spaces`: the advance of every Unicode space HarfBuzz synthesizes from the space glyph when the font lacks it
//   (hb-ot-shape-normalize.cc:174-186, hb-ot-shape-fallback.cc:545-630 at harfbuzz dfdc088c: the scale over 2, 3, 4, 5, 6
//   or 16, 4/18 of it, half the space, a digit's or the period's advance), which no unitsPerEm scales;
// - `pairs` (Latin): the adjustments of every capital before every small letter, small before small, and small before
//   punctuation, or'ed;
// - `words`: shaped text below 256 px, where a total is the exact sum whatever the grain is: every word of a list alone
//   and every two neighbours together, or'ed (ligatures, contextual forms, marks, cursive attachment, kerx, class kerning);
// - `long`: the first n words as one run (U+2028 between them) and as Canvas words (U+0020), for totals up to 3,000 px;
// - `periodic`: three units repeated, one ending in U+2028, one in U+2009 and one in U+202F: one repeat R1, the adjustment
//   between two, whether 3 to 5 repeats add up while exact, and N repeats less N R1 + (N - 1) d for totals to 3,000 px.
// Declarations: bold and italic the family has no face for (synthetic), families with bitmap strikes, `hdmx`, `kerx`,
// `morx`, CFF outlines, `trak`, variable fonts at instances off their default, font lists whose second family covers a
// space the first lacks, and web fonts loaded from bytes (GRAIN_WEBFONTS, a JSON object: face name to { path, descriptors };
// the files are read when the probe is built and never enter the repository).
// The font files' unitsPerEm are read by the study's own script and joined afterwards.
//
//   GRAIN_WEBFONTS=<webfonts.json> bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/blink-grain-attack.ts \
//     --out=<dir> --probe-timeout-ms=3000000 --stall-ms=3000000          (a Chrome slot of the browser lock; no times)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Probe } from './types.ts'

type Spec = { label: string; prefix: string; family: string; script: string }

const spec = (label: string, family: string, script: string = 'latin', prefix: string = ''): Spec => ({ label, prefix, family, script })

// Every Latin family in four styles: the faces a family lacks are synthesized (FontPlatformData synthetic bold and italic).
const LATIN = [
  'Trebuchet MS', 'Tahoma', 'Comic Sans MS', 'Impact', 'Courier New', 'Geneva', 'Monaco', 'Lucida Grande', 'Palatino', 'Charter', 'Gill Sans', 'Baskerville',
  'Times', 'Helvetica', 'Microsoft Sans Serif', 'DIN Alternate', 'Iowan Old Style', 'Rockwell', 'Papyrus', 'Andale Mono', 'Arial Black', 'Arial Narrow',
  'Brush Script MT', 'Arial Unicode MS', 'Apple Symbols', 'Galvji', 'Courier', 'Academy Engraved LET', 'Party LET', 'Savoye LET',
  // trak, and variable fonts
  'Osaka', 'Apple Chancery', 'Skia',
  // 1000 and 2000 units per em, for the contrast
  'Helvetica Neue', 'Avenir', 'Futura', 'Optima', 'Didot', 'American Typewriter',
  // the study's five, for the styles it didn't ask
  'Arial', 'Georgia', 'Verdana', 'Times New Roman', 'Menlo',
]
const STYLES = ['', 'bold', 'italic', 'italic bold']

const SPECS: Spec[] = []
for (let f = 0; f < LATIN.length; f++) for (let s = 0; s < STYLES.length; s++) SPECS.push(spec(`${LATIN[f]!}${STYLES[s] === '' ? '' : ' ' + STYLES[s]!}`, `"${LATIN[f]!}"`, 'latin', STYLES[s]!))
const GENERIC = ['system-ui', 'ui-serif', 'ui-rounded', 'ui-monospace']
for (let f = 0; f < GENERIC.length; f++) for (let w = 0; w < 3; w++) SPECS.push(spec(`${GENERIC[f]!} ${[400, 500, 700][w]!}`, GENERIC[f]!, 'latin', String([400, 500, 700][w]!)))
// Font lists whose second family has a Unicode space the first lacks (the study's cmap facts): Chrome keeps the space in the
// first family, synthesized, where coverage facts say the second draws it.
SPECS.push(spec('Georgia, Arial', '"Georgia", "Arial"'), spec('Verdana, Tahoma', '"Verdana", "Tahoma"'), spec('Arial, Times New Roman', '"Arial", "Times New Roman"'), spec('Trebuchet MS, Arial', '"Trebuchet MS", "Arial"'))
const OTHER: Array<[string, string]> = [
  ['Baghdad', 'arabic'], ['Damascus', 'arabic'], ['Diwan Thuluth', 'arabic'], ['Farisi', 'arabic'], ['Mishafi', 'arabic'], ['Waseem', 'arabic'], ['KufiStandardGK', 'arabic'],
  ['Diwan Kufi', 'arabic'], ['Al Tarikh', 'arabic'], ['Beirut', 'arabic'], ['Nadeem', 'arabic'], ['Sana', 'arabic'], ['Muna', 'arabic'], ['Farah', 'arabic'],
  ['Geeza Pro', 'arabic'], ['Noto Nastaliq Urdu', 'arabic'], ['Al Nile', 'arabic'], ['Arial', 'arabic'], ['Times New Roman', 'arabic'], ['Tahoma', 'arabic'],
  ['Corsiva Hebrew', 'hebrew'], ['New Peninim MT', 'hebrew'], ['Raanana', 'hebrew'], ['Arial Hebrew', 'hebrew'], ['Arial', 'hebrew'], ['Times New Roman', 'hebrew'],
  ['Tamil MN', 'tamil'], ['Tamil Sangam MN', 'tamil'], ['Kannada MN', 'kannada'], ['Kannada Sangam MN', 'kannada'], ['Malayalam MN', 'malayalam'], ['Malayalam Sangam MN', 'malayalam'],
  ['Telugu MN', 'telugu'], ['Oriya MN', 'oriya'], ['Bangla Sangam MN', 'bangla'], ['Bangla MN', 'bangla'], ['Devanagari MT', 'devanagari'], ['Devanagari Sangam MN', 'devanagari'],
  ['Kohinoor Devanagari', 'devanagari'], ['Gujarati MT', 'gujarati'], ['Gurmukhi MN', 'gurmukhi'], ['Gurmukhi MT', 'gurmukhi'], ['Sinhala MN', 'sinhala'], ['Khmer MN', 'khmer'],
  ['Lao MN', 'lao'], ['Myanmar MN', 'myanmar'], ['Myanmar Sangam MN', 'myanmar'], ['Thonburi', 'thai'], ['Ayuthaya', 'thai'], ['Tahoma', 'thai'], ['Arial Unicode MS', 'thai'],
  ['Arial Unicode MS', 'devanagari'], ['Arial Unicode MS', 'arabic'], ['Euphemia UCAS', 'ucas'], ['Grantha Sangam MN', 'tamil'],
]
for (let i = 0; i < OTHER.length; i++) SPECS.push(spec(`${OTHER[i]![0]} (${OTHER[i]![1]})`, `"${OTHER[i]![0]}"`, OTHER[i]![1]))

const BODY = String.raw`
const cp = String.fromCodePoint;
const LS = cp(0x2028), THIN = cp(0x2009), NARROW = cp(0x202f);
const SIZES = [9, 10, 11, 12, 12.8, 13, 13.2, 13.33, 14, 15, 16, 16.5, 17, 17.6, 18, 19.5, 20, 22.5, 24, 25.5, 26, 28, 32, 36, 39.99, 42, 48, 64, 96, 144, 255, 256, 300];
const SPACES = [0x20, 0xa0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000];
const TARGETS = [300, 450, 700, 1000, 1500, 2200, 3000];
const range = (a, b) => { const out = []; for (let c = a; c <= b; c++) out.push(c); return out; };
const LATIN_WORDS = ('The office staff of the affluent fjord village called Zapfino offered waffles, coffee and truffles to five efficient officials, who filed the final affidavit ' +
  'AVATAR Wave Yo. Ty fly affix Tr r. P. L T V A W. Y, F. T, r, y. "Quoted" (paren) [bracket] it\'s don\'t rock\'n\'roll WAVE AWAY To Tomorrow. Yes, Your Truly, V. A. Wyatt first fifth ffl fi fl ff Th ct st Thin fin flat after Tfi fT ' +
  'ok so I tried the new layout thing at 320 px - it works, mostly... but 3.14 of the 1,000 rows (about 0.3%) overflow? see http://example.com/a/b?c=d&e=f or ping me @ 12:30 -- thanks! 7/8 10:45 2026-09-20 $5 100% #1 No. 7 A1 B2 {3} 4th 1st ' +
  'Na' + cp(0x131) + 've caf' + cp(0xe9) + ' r' + cp(0xe9) + 'sum' + cp(0xe9) + ' co' + cp(0xf6) + 'perate ' + cp(0xc5) + 'ngstr' + cp(0xf6) + 'm sm' + cp(0xf8) + 'rrebr' + cp(0xf8) + 'd e' + cp(0x301) + 'tude Vi' + cp(0x1ec7) + 't ph' + cp(0x1edf) + ' T' + cp(0xfc) + 'r ' + cp(0xd8) + 'y cr' + cp(0xe8) + 'me fa' + cp(0xe7) + 'ade jalape' + cp(0xf1) + 'o S' + cp(0xe3) + 'o Z' + cp(0xfc) + 'rich Krak' + cp(0xf3) + 'w Dvo' + cp(0x159, 0xe1) + 'k ' + cp(0x141, 0xf3) + 'd' + cp(0x17a) + ' ' +
  cp(0x39a, 0x3b1, 0x3bb, 0x3b7, 0x3bc, 0x3ad, 0x3c1, 0x3b1) + ' ' + cp(0x3ba, 0x3cc, 0x3c3, 0x3bc, 0x3b5) + ' ' + cp(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442) + ' ' + cp(0x43c, 0x438, 0x440) + ' ' + cp(0x413, 0x423, 0x422, 0x410) + ' ' + cp(0x201c) + 'quote' + cp(0x201d) + ' ' + cp(0x2018) + 'it' + cp(0x2019) + 's' + cp(0x2014) + 'dash' + cp(0x2013) + 'en' + cp(0x2026)).split(' ');
// Words of a script made from its letters: every letter with two others, a mark after the second where the script has marks,
// and for an Indic script a conjunct (consonant, virama, consonant) with a vowel sign.
const generated = (letters, marks, virama, signs) => {
  const out = [];
  for (let i = 0; i < letters.length; i++) {
    const a = letters[i], b = letters[(i * 7 + 3) % letters.length], c = letters[(i * 13 + 5) % letters.length];
    let w = cp(a);
    if (virama !== 0 && i % 2 === 0) w += cp(virama);
    w += cp(b);
    if (marks.length > 0 && i % 3 === 0) w += cp(marks[i % marks.length]);
    if (signs.length > 0) w += cp(signs[i % signs.length]);
    w += cp(c);
    if (signs.length > 0 && i % 2 === 1) w += cp(signs[(i * 5 + 1) % signs.length]);
    out.push(w);
  }
  return out;
};
const indic = (base) => ({ singles: range(base + 0x05, base + 0x39).concat(range(base + 0x3e, base + 0x4c), range(base + 0x66, base + 0x6f)), words: generated(range(base + 0x15, base + 0x39), [base + 0x02], base + 0x4d, range(base + 0x3e, base + 0x4c)) });
const SCRIPTS = {
  latin: { singles: range(0x21, 0x7e).concat(range(0xa1, 0xac), range(0xae, 0x17f), range(0x391, 0x3a1), range(0x3a3, 0x3c9), range(0x410, 0x44f), [0x2010, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122, 0xfb01, 0xfb02]), words: LATIN_WORDS },
  arabic: { singles: range(0x621, 0x64a).concat(range(0x660, 0x669), range(0x671, 0x6d3), [0x60c, 0x61b, 0x61f, 0x640, 0xfdf2, 0xfdfd]), words: generated(range(0x626, 0x64a).filter(c => c !== 0x640), range(0x64b, 0x652), 0, []).concat([cp(0x644, 0x627), cp(0x627, 0x644, 0x644, 0x647), cp(0x644, 0x644, 0x647), cp(0x645, 0x62d, 0x645, 0x62f), cp(0x628, 0x640, 0x640, 0x628), cp(0x6cc, 0x6c1), cp(0x646, 0x633, 0x62a, 0x639, 0x644, 0x6cc, 0x642), cp(0x67e, 0x627, 0x6a9, 0x633, 0x62a, 0x627, 0x646), cp(0x6c1, 0x6d2)]) },
  hebrew: { singles: range(0x5d0, 0x5ea).concat(range(0x5b0, 0x5bc), [0x5be, 0x5c1, 0x5c2, 0x5f3, 0x5f4]), words: generated(range(0x5d0, 0x5ea), range(0x5b0, 0x5bc), 0, []) },
  devanagari: indic(0x900), bangla: indic(0x980), gurmukhi: indic(0xa00), gujarati: indic(0xa80), oriya: indic(0xb00), tamil: indic(0xb80), telugu: indic(0xc00), kannada: indic(0xc80), malayalam: indic(0xd00),
  sinhala: { singles: range(0xd85, 0xdc6).concat(range(0xdcf, 0xddf)), words: generated(range(0xd9a, 0xdc6), [0xd82], 0xdca, range(0xdcf, 0xddf)) },
  thai: { singles: range(0xe01, 0xe3a).concat(range(0xe40, 0xe5b)), words: generated(range(0xe01, 0xe2e), range(0xe47, 0xe4c), 0, [0xe31, 0xe34, 0xe35, 0xe36, 0xe37, 0xe38, 0xe39, 0xe32, 0xe33]) },
  lao: { singles: range(0xe81, 0xebd).concat(range(0xec0, 0xecd)), words: generated(range(0xe94, 0xeae), range(0xec8, 0xecb), 0, [0xeb1, 0xeb4, 0xeb5, 0xeb8, 0xeb9, 0xeb2]) },
  khmer: { singles: range(0x1780, 0x17d3), words: generated(range(0x1780, 0x17a2), [0x17c6], 0x17d2, range(0x17b6, 0x17c5)) },
  myanmar: { singles: range(0x1000, 0x104f), words: generated(range(0x1000, 0x1021), [0x1036, 0x1037], 0x1039, range(0x102b, 0x1032).concat([0x103b, 0x103c, 0x103d, 0x103e])) },
  ucas: { singles: range(0x1401, 0x14ff), words: generated(range(0x1401, 0x1480), [], 0, []) },
};
const UPPER = range(0x41, 0x5a).map(c => cp(c)), LOWER = range(0x61, 0x7a).map(c => cp(c)), PUNCT = ['.', ',', ':', ';', '-', '"', "'", ')', '?', '!'];
const PAIRS = [];
for (let i = 0; i < UPPER.length; i++) for (let j = 0; j < LOWER.length; j++) PAIRS.push([UPPER[i], LOWER[j]]);
for (let i = 0; i < UPPER.length; i++) for (let j = 0; j < UPPER.length; j++) PAIRS.push([UPPER[i], UPPER[j]]);
for (let i = 0; i < LOWER.length; i++) for (let j = 0; j < LOWER.length; j++) PAIRS.push([LOWER[i], LOWER[j]]);
for (let i = 0; i < LOWER.length; i++) for (let j = 0; j < PUNCT.length; j++) { PAIRS.push([LOWER[i], PUNCT[j]]); PAIRS.push([UPPER[i], PUNCT[j]]); }

// Web fonts from bytes.
const loaded = [];
for (const name of Object.keys(WEBFONTS)) {
  const bytes = Uint8Array.from(atob(WEBFONTS[name].base64), c => c.charCodeAt(0));
  const face = new FontFace(name, bytes.buffer, WEBFONTS[name].descriptors);
  await face.load();
  document.fonts.add(face);
  loaded.push({ name, status: face.status });
}
await document.fonts.ready;

const contextOf = (font) => {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  ctx.font = font;
  ctx.letterSpacing = '0px'; ctx.wordSpacing = '0px'; ctx.fontKerning = 'auto'; ctx.textRendering = 'optimizeLegibility'; ctx.direction = 'ltr';
  if ('lang' in ctx) ctx.lang = 'en';
  return ctx;
};
const out = [];
for (let f = 0; f < SPECS.length; f++) {
  const spec = SPECS[f], script = SCRIPTS[spec.script];
  const font = (size, families) => (spec.prefix === '' ? '' : spec.prefix + ' ') + String(size) + 'px ' + families;
  const c1 = contextOf(font(72, spec.family + ', monospace')), c2 = contextOf(font(72, 'monospace')), c3 = contextOf(font(72, spec.family + ', serif')), c4 = contextOf(font(72, 'serif'));
  const probeText = spec.script === 'latin' ? 'mmmmmmmmmmlliWAVA fi 123' : script.words.slice(0, 6).join(' ');
  if (c1.measureText(probeText).width === c2.measureText(probeText).width && c3.measureText(probeText).width === c4.measureText(probeText).width) { out.push({ label: spec.label, resolves: false }); continue; }
  const ownOf = (s) => c1.measureText(s).width !== c2.measureText(s).width || c3.measureText(s).width !== c4.measureText(s).width;
  const singles = script.singles.map(c => cp(c));
  const own = singles.map(ownOf);
  const spacesOwn = SPACES.map(c => ownOf(cp(c)) ? 1 : 0);
  // A word counts where the family draws every character of it that has a width of its own.
  const words = script.words.filter(w => { for (const ch of w) if (!ownOf(ch) && c2.measureText(ch).width !== 0) return false; return true; });
  const rows = [];
  for (let z = 0; z < SIZES.length; z++) {
    const ctx = contextOf(font(SIZES[z], spec.family));
    const W = (s) => Math.round(ctx.measureText(s).width * 65536);
    let ownBits = 0, ownCount = 0, otherBits = 0, otherCount = 0;
    const alone = new Map();
    for (let i = 0; i < singles.length; i++) {
      const w = W(singles[i]);
      alone.set(singles[i], w);
      if (w === 0) continue;
      if (own[i]) { ownBits |= w; ownCount++; } else { otherBits |= w; otherCount++; }
    }
    const spaces = SPACES.map(c => W(cp(c) === ' ' ? LS : cp(c)));
    let pairBits = 0, pairCount = 0;
    if (spec.script === 'latin') for (let i = 0; i < PAIRS.length; i++) {
      const d = W(PAIRS[i][0] + PAIRS[i][1]) - alone.get(PAIRS[i][0]) - alone.get(PAIRS[i][1]);
      if (d !== 0) { pairBits |= Math.abs(d); pairCount++; }
    }
    let wordBits = 0, wordCount = 0, wordWorst = 32, wordWorstText = '';
    const note = (w, s) => { if (w === 0 || w >= 0x1000000) return; wordBits |= w; wordCount++; const tz = Math.log2(w & -w); if (tz < wordWorst) { wordWorst = tz; wordWorstText = s; } };
    for (let i = 0; i < words.length; i++) { note(W(words[i]), words[i]); if (i + 1 < words.length) note(W(words[i] + LS + words[i + 1]), words[i] + ' ' + words[i + 1]); }
    // The first n words as one run and as Canvas words.
    const long = [];
    if (words.length > 0) {
      let text = '', text20 = '', next = 0;
      for (let n = 0; n < 4000 && next < TARGETS.length; n++) {
        text += (n === 0 ? '' : LS) + words[n % words.length];
        text20 += (n === 0 ? '' : ' ') + words[n % words.length];
        if (n % 4 !== 3) continue;
        const w = W(text);
        if (w >= TARGETS[next] * 65536) { long.push([n + 1, w, W(text20)]); while (next < TARGETS.length && w >= TARGETS[next] * 65536) next++; }
      }
    }
    const periodic = [];
    const unitWord = words.length > 0 ? words[0] : singles[0];
    const units = [unitWord + LS, unitWord + THIN, unitWord + NARROW];
    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      const r1 = W(unit), d = W(unit + unit) - 2 * r1;
      const adds = [];
      for (let n = 3; n <= 5; n++) { const sum = n * r1 + (n - 1) * d; adds.push(sum >= 0x1000000 ? -1 : W(unit.repeat(n)) === sum ? 1 : 0); }
      const longs = [];
      if (r1 + d > 0) for (let t = 0; t < TARGETS.length; t++) {
        const n = Math.ceil(TARGETS[t] * 65536 / (r1 + d));
        const sum = n * r1 + (n - 1) * d;
        longs.push([n, sum, W(unit.repeat(n)) - sum]);
      }
      periodic.push({ r1, d, adds, longs });
    }
    rows.push({ z: SIZES[z], ownBits, ownCount, otherBits, otherCount, spaces, pairBits, pairCount, wordBits, wordCount, wordWorst, wordWorstText, long, periodic });
  }
  out.push({ label: spec.label, prefix: spec.prefix, family: spec.family, script: spec.script, resolves: true, ownSingles: own.filter(o => o).length, singles: singles.length, words: words.length, allWords: script.words.length, spacesOwn, rows });
  if (f % 2 === 1) await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, sizes: SIZES, spaces: SPACES, targets: TARGETS, loaded, specs: out };
`

export default function blinkGrainAttackProbes(): Probe[] {
  const webfontsPath = process.env['GRAIN_WEBFONTS']
  const webfonts: Record<string, { base64: string; descriptors: Record<string, string> }> = {}
  const specs = SPECS.slice()
  if (webfontsPath !== undefined) {
    const listed = JSON.parse(readFileSync(resolve(webfontsPath), 'utf8')) as Record<string, { path: string; descriptors: Record<string, string>; prefixes: string[] }>
    const names = Object.keys(listed)
    for (let i = 0; i < names.length; i++) {
      const entry = listed[names[i]!]!
      webfonts[names[i]!] = { base64: readFileSync(resolve(entry.path)).toString('base64'), descriptors: entry.descriptors }
      for (let s = 0; s < entry.prefixes.length; s++) specs.push(spec(`${names[i]!}${entry.prefixes[s] === '' ? '' : ' ' + entry.prefixes[s]!}`, `"${names[i]!}"`, 'latin', entry.prefixes[s]!))
    }
  }
  return [{
    id: 'blink-grain-attack GA1', spec: 'the grain of Canvas totals by font kind: synthetic styles, bitmap strikes, kerx, morx, CFF, trak, variable instances, synthesized spaces, font lists and web fonts', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `const SPECS = ${JSON.stringify(specs)};\nconst WEBFONTS = ${JSON.stringify(webfonts)};\n${BODY}` }],
  }]
}
