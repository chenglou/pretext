// A page for the Gecko profiler: measureText loops in named phases that take turns, one second each, for about a minute,
// so any stretch the profiler holds has every phase in equal parts. rebuild/tools/gecko-profile-native.ts roots its
// report at a phase's function name (--under=phaseArabic30Repeat). The phases are the rows of gecko-measuretext-cost.ts
// whose cost the source reading didn't explain. Pinned Firefox 156.0; one browser slot, no timing is read from it.
//
//   bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/probes/gecko-measuretext-phases.ts \
//     --firefox-prefs=<prefs with browser.download.dir> --probe-timeout-ms=120000 --stall-ms=150000 --out=<out>
//   and, from outside, SIGUSR1 to the launched Firefox to start the profiler and SIGUSR2 to write the profile.
import type { Probe } from './types.ts'

const SOURCE = String.raw`
const FONT = '16px "Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif';
let seed = 20260920;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const range = (from, to) => { const out = []; for (let c = from; c <= to; c++) out.push(String.fromCodePoint(c)); return out; };
const LOWER = range(0x61, 0x7a);
const ARABIC = range(0x628, 0x63a).concat(range(0x641, 0x64a));
const HAN = range(0x4e00, 0x5fff);
const lettersOf = (alphabet, n) => { let s = ''; for (let i = 0; i < n; i++) s += alphabet[Math.floor(random() * alphabet.length)]; return s; };
const words = (alphabet, count) => { const out = []; for (let i = 0; i < count; i++) out.push(lettersOf(alphabet, 5)); return out.join(' '); };
const ctx = new OffscreenCanvas(1, 1).getContext('2d');
ctx.font = FONT;
const arabic30 = words(ARABIC, 5), arabic2 = ARABIC[1] + ARABIC[5], latin30 = words(LOWER, 5), latin40 = lettersOf(LOWER, 40), chinese300 = lettersOf(HAN, 300), chinese30 = lettersOf(HAN, 30);
const loop = (text, ms) => { let acc = 0, calls = 0; const end = performance.now() + ms; while (performance.now() < end) { for (let i = 0; i < 200; i++) acc += ctx.measureText(text).width; calls += 200; } return calls; };
function phaseArabic30Repeat(ms) { return loop(arabic30, ms); }
function phaseArabic2Repeat(ms) { return loop(arabic2, ms); }
function phaseLatin30Repeat(ms) { return loop(latin30, ms); }
function phaseLatin40Repeat(ms) { return loop(latin40, ms); }
function phaseChinese300Repeat(ms) { return loop(chinese300, ms); }
function phaseChinese30Repeat(ms) { return loop(chinese30, ms); }
function phaseNewContext(ms) { let acc = 0, calls = 0; const end = performance.now() + ms; while (performance.now() < end) { for (let i = 0; i < 50; i++) { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = FONT; acc += c.measureText('ab').width; } calls += 50; } return calls; }
const phases = [phaseArabic30Repeat, phaseArabic2Repeat, phaseLatin30Repeat, phaseLatin40Repeat, phaseChinese300Repeat, phaseChinese30Repeat, phaseNewContext];
const calls = phases.map(() => 0);
const start = performance.now();
while (performance.now() - start < 56000) {
  for (let p = 0; p < phases.length; p++) calls[p] += phases[p](1000);
  await new Promise(done => setTimeout(done, 0));
}
return { ms: performance.now() - start, phases: phases.map((phase, p) => ({ name: phase.name, calls: calls[p] })) };
`

export default function probes(): Probe[] {
  return [{
    id: 'gecko-measuretext-phases P1',
    spec: 'P1: measureText loops in named phases, for the Gecko profiler',
    pageLang: 'en',
    observe: [{ kind: 'script', source: SOURCE }],
    browsers: ['firefox'],
    note: 'For a profiler; nothing is timed.',
  }]
}
