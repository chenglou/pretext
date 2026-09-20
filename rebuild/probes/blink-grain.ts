// The grain of Chrome's Canvas totals, on the machine's font families (the cut-grain study, 2026-09-20; G1).
//
// A Canvas total of one HarfBuzz run is the float32 of the run's exact 16.16 advance sum (shape_result.cc:1539-1576), so
// it is that sum whenever the sum is a multiple of 2^(e - 23), e the sum's highest bit. If every advance and adjustment
// of a font at a size is a multiple of 2^g units (the grain), every sum is, and a total is exact below 2^(24 + g) units.
// HarfBuzz scales a font value v to (v * x_mult + 32768) >> 16 with x_mult = (x_scale << 16) / unitsPerEm
// (hb-font.hh:1145-1165), and Blink sets x_scale to trunc(f32(size) * 65536) (harfbuzz_face.cc:639-641), so a font of 2^n
// units per em has the grain tz(x_scale) - n. Glyph advances come from Core Text through Skia, truncated to 16.16
// (skia_text_metrics.cc:17-73, 207-211), which no source says anything about: this probe measures them.
//
// Per family and zoomed size (the CSS sizes 12 to 20, 24 and 28 px and four fractional ones, times the ratios 1, 1.5, 2
// and 3; Canvas measures at the zoomed size whatever the window's ratio is, as the port asks it), raw:
// - `singles`: the 16.16 advances of the printable ASCII characters and the space (as U+2028), or'ed, and how many
//   differ from 0;
// - `pairs`: the adjustments of 42 pairs that fonts kern, W(ab) - W(a) - W(b), or'ed, and how many differ from 0;
// - `units`: three short strings, each repeated. One repeat R1, the adjustment between two d = W(uu) - 2 R1, and whether
//   three, four and five repeats measure 3 R1 + 2 d and so on while they are exact (below 256 px). Then N repeats for
//   totals from 300 to 3,000 px: the measured total less N R1 + (N - 1) d, and less the float32 of that sum.
// - per family, `covered`: how many of those characters the family itself draws (a fallback font has its own grain).
// The font files' unitsPerEm are read by the study's own script, never by the library, and joined afterwards.
//
//   GRAIN_FONTS=<families.json> bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/blink-grain.ts \
//     --out=<dir> --probe-timeout-ms=3000000 --stall-ms=3000000          (a Chrome slot of the browser lock; no times)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Probe } from './types.ts'

const BODY = String.raw`
const SPACE = String.fromCharCode(0x2028);
const CSS_SIZES = [12, 12.8, 13, 13.33, 14, 14.4, 15, 16, 17, 17.6, 18, 19, 20, 24, 28];
const RATIOS = [1, 1.5, 2, 3];
const PAIRS = ['AV','AW','AY','AT','Av','Aw','Ay','FA','LT','LV','LW','LY','PA','TA','Ta','Te','To','Tr','Ty','VA','Va','Ve','Vo','WA','Wa','We','Wo','YA','Ya','Ye','Yo','r.','r,','y.','y,','f.','T.','T,','V.','V,','P.','P,'];
const UNITS = ['n', 'on', 'e' + SPACE];
const TARGETS = [300, 450, 700, 1000, 1500, 2200, 3000];
const f32 = Math.fround;
const zoomedSizes = [];
for (let s = 0; s < CSS_SIZES.length; s++) for (let r = 0; r < RATIOS.length; r++) {
  const z = f32(f32(CSS_SIZES[s]) * f32(RATIOS[r]));
  if (!zoomedSizes.includes(z)) zoomedSizes.push(z);
}
const probeContext = new OffscreenCanvas(1, 1).getContext('2d');
const measured = (font) => { probeContext.font = font; return probeContext.measureText('mmmmmmmmmmlliWAVA fi 123').width; };
const resolves = (family) => measured('72px ' + family + ', monospace') !== measured('72px monospace') || measured('72px ' + family + ', serif') !== measured('72px serif');
const singles = [SPACE];
for (let c = 0x21; c <= 0x7e; c++) singles.push(String.fromCharCode(c));
const out = [];
for (let f = 0; f < FONTS.length; f++) {
  const family = FONTS[f].startsWith('!') ? FONTS[f].slice(1) : '"' + FONTS[f] + '"';
  if (!resolves(family)) { out.push({ family: FONTS[f], resolves: false }); continue; }
  // How many of the single characters the family itself draws: one the family lacks measures the same with and without it
  // before a generic family, under both of two generic families.
  let covered = 0;
  const coveredSingles = [];
  for (let i = 0; i < singles.length; i++) {
    const before = (generic) => { probeContext.font = '72px ' + family + ', ' + generic; const a = probeContext.measureText(singles[i]).width; probeContext.font = '72px ' + generic; return a !== probeContext.measureText(singles[i]).width; };
    const own = before('monospace') || before('serif');
    coveredSingles.push(own ? 1 : 0);
    if (own) covered++;
  }
  const rows = [];
  for (let z = 0; z < zoomedSizes.length; z++) {
    // The port's measuring context (contexts.ts styleContexts): the zoomed size, optimizeLegibility, no spacing.
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    ctx.font = String(zoomedSizes[z]) + 'px ' + family;
    ctx.letterSpacing = '0px'; ctx.wordSpacing = '0px'; ctx.fontKerning = 'auto'; ctx.textRendering = 'optimizeLegibility'; ctx.direction = 'ltr';
    if ('lang' in ctx) ctx.lang = 'en';
    const W = (s) => Math.round(ctx.measureText(s).width * 65536);
    const alone = new Map();
    let singleBits = 0, singleCount = 0;
    for (let i = 0; i < singles.length; i++) { const w = W(singles[i]); alone.set(singles[i], w); singleBits |= w; if (w !== 0) singleCount++; }
    let pairBits = 0, pairCount = 0;
    for (let i = 0; i < PAIRS.length; i++) { const d = W(PAIRS[i]) - alone.get(PAIRS[i][0]) - alone.get(PAIRS[i][1]); pairBits |= Math.abs(d); if (d !== 0) pairCount++; }
    const units = [];
    for (let u = 0; u < UNITS.length; u++) {
      const unit = UNITS[u];
      const r1 = W(unit), d = W(unit + unit) - 2 * r1;
      // Whether the repeats add up while they are exact: 1 yes, 0 no, -1 not exact any more.
      const periodic = [];
      for (let n = 3; n <= 5; n++) { const sum = n * r1 + (n - 1) * d; periodic.push(sum >= 0x1000000 ? -1 : W(unit.repeat(n)) === sum ? 1 : 0); }
      const longs = [];
      if (r1 + d > 0) for (let t = 0; t < TARGETS.length; t++) {
        const n = Math.ceil(TARGETS[t] * 65536 / (r1 + d));
        const sum = n * r1 + (n - 1) * d;
        const w = W(unit.repeat(n));
        longs.push([n, sum, w - sum, w - Math.round(f32(sum / 65536) * 65536)]);
      }
      units.push({ r1, d, periodic, longs });
    }
    rows.push({ z: zoomedSizes[z], singleBits, singleCount, pairBits, pairCount, units });
  }
  out.push({ family: FONTS[f], resolves: true, covered, coversUnits: coveredSingles[0] === 1 && coveredSingles[singles.indexOf('n')] === 1 && coveredSingles[singles.indexOf('o')] === 1 && coveredSingles[singles.indexOf('e')] === 1, rows });
  if (f % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
}
return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, cssSizes: CSS_SIZES, ratios: RATIOS, targets: TARGETS, fonts: out };
`

export default function blinkGrainProbes(): Probe[] {
  const fontsPath = process.env['GRAIN_FONTS']
  if (fontsPath === undefined) throw new Error('GRAIN_FONTS names the families file')
  return [{
    id: 'blink-grain G1', spec: 'the grain of Canvas totals: single advances, pair adjustments and long totals against their exact sums, on the machine\'s font families', pageLang: 'en', html: '<div></div>',
    observe: [{ kind: 'script', source: `const FONTS = ${readFileSync(resolve(fontsPath), 'utf8')};\n${BODY}` }],
  }]
}
