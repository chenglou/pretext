// How Chrome's DOM reads other spellings of its two system font names (2026-09-19). One probe, meaningful alone in a fresh
// browser at DPR 2: Blink's platform font cache compares family names without case (font_face_creation_params.h:115-124 at
// 153), so the order of the steps is part of the probe. The verdicts are in the comment on isSystemFontKeyword
// (src/engines/blink/content.ts).
//
// Each row is the width of one sample in a nowrap block under `font-family: <spelling>` alone, so a spelling that names
// nothing falls to the standard font, which the control row shows. Step 1, at 17px, lays out the spellings the source says
// name nothing before the system font exists at that size, then `system-ui` and the spellings the source says equal it.
// Step 2, at 19px, lays out `system-ui` first and the quoted "System-UI" after it. Canvas is asked last, at the CSS size
// and then at the zoomed size, because a platform font created at the zoomed size changes later DOM widths
// (specs/probes-chrome.md correction 7).
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py blink-sysui-spellings -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/blink-sysui-spellings.ts --out=<out folder>
import type { Probe } from './types.ts'

const SOURCE = String.raw`
const Z = window.devicePixelRatio;
const f32 = Math.fround;
const SAMPLE = 'Hamburgefonstiv 0123';
const checks = [];
const dom = (family, size) => {
  const div = document.createElement('div');
  div.lang = 'en';
  div.style.cssText = 'position: absolute; left: 0; top: 0; white-space: nowrap; font: 400 ' + size + 'px/30px ' + family;
  const span = document.createElement('span');
  span.textContent = SAMPLE;
  div.append(span);
  host.append(div);
  const width = span.getBoundingClientRect().width;
  const computed = getComputedStyle(div).fontFamily;
  div.remove();
  return { family, size, width, computed };
};
const canvas = (family, size) => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = '400 ' + size + 'px ' + family; c.lang = 'en'; return c.measureText(SAMPLE).width; };
const NOTHING = ['NoSuchFamilyXyz', '"System-UI"', '"SYSTEM-UI"', 'blinkmacsystemfont', 'BLINKMACSYSTEMFONT', '"blinkmacsystemfont"'];
const SYSTEM = ['system-ui', 'System-UI', 'SYSTEM-UI', 'sYsTeM-uI', 'BlinkMacSystemFont', '"BlinkMacSystemFont"', '"system-ui"'];
const step1 = [];
for (const family of NOTHING) step1.push(dom(family, 17));
for (const family of SYSTEM) step1.push(dom(family, 17));
const step2 = [dom('system-ui', 19), dom('"System-UI"', 19), dom('NoSuchFamilyXyz', 19)];
const control = step1[0].width, system = step1[NOTHING.length].width;
checks.push({ name: 'the system font and the standard font give the sample different widths at 17px', ok: control !== system, expected: 'different', measured: [control, system] });
for (let i = 1; i < NOTHING.length; i++) checks.push({ name: NOTHING[i] + ' at 17px, laid out before system-ui: the standard font', ok: step1[i].width === control, expected: control, measured: step1[i].width });
for (let i = 1; i < SYSTEM.length; i++) checks.push({ name: SYSTEM[i] + ' at 17px: the system font', ok: step1[NOTHING.length + i].width === system, expected: system, measured: step1[NOTHING.length + i].width });
checks.push({ name: '"System-UI" at 19px, laid out after system-ui at 19px: the system font, from the cache', ok: step2[1].width === step2[0].width && step2[1].width !== step2[2].width, expected: step2[0].width, measured: step2[1].width });
const atCssSize = {}, atZoomedSize = {};
for (const family of NOTHING.concat(SYSTEM)) atCssSize[family] = canvas(family, 17);
for (const family of NOTHING.concat(SYSTEM)) atZoomedSize[family] = canvas(family, 17 * Z);
for (let i = 0; i < SYSTEM.length; i++) {
  const expected = Math.ceil(f32(f32(atCssSize[SYSTEM[i]] * Z) * 64)) / (64 * Z);
  checks.push({ name: SYSTEM[i] + ' at 17px: the DOM width is the Canvas width at the CSS size, scaled and rounded up to a LayoutUnit', ok: expected === step1[NOTHING.length + i].width, expected, measured: step1[NOTHING.length + i].width });
}
return { dpr: Z, sample: SAMPLE, step1, step2, atCssSize, atZoomedSize, checks };
`

export default function probes(): Probe[] {
  return [{ id: 'blink-sysui-spellings', spec: 'src/engines/blink/content.ts isSystemFontKeyword', pageLang: 'en', observe: [{ kind: 'script', source: SOURCE }], browsers: ['chrome'], note: 'Widths in CSS px. Alone in a fresh browser; step order matters.' }]
}
