// Blink follow-ups of 2026-09-17 (specs/blink-RESULTS.md "Other open items"). Plain observations; verdicts by hand.
//
// 1. CHARTER-CRITIC item 5 (`blink/measure/ignorables-left-out-if-8bit`): in Amiri the RTL item RLM `((` is 1567 units in
//    the DOM, equal to `((` with the RLM left out of the Canvas string and unlike U+2060 `((` (2814). Candidates: what U+2060,
//    U+034F and RLM measure alone and before `((`, in LTR and RTL contexts, 8-bit and 16-bit.
// 2. U+FFFC in text (`font-fallback`): Canvas turns U+FFFC into U+200B (character.h:167-175) while the DOM draws a fallback
//    glyph. Candidates Canvas doesn't normalize that may take the same fallback glyph: U+FFF9..U+FFFB, a private-use
//    character, an unassigned code point, U+FFFD.
//
// Run under the browser lock (from ~/github/pretext-rebuild):
//   python3 .artifacts/session/with-browser-lock.py blink-followups-20260917 -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/blink-followups-20260917.ts --out=.artifacts/probes/blink/followups-20260917 --probe-timeout-ms=60000
import type { CanvasMeasure, Probe } from './types.ts'

const DPR = 2

type Sample = { id: string; family: string; size: number; dir: 'ltr' | 'rtl'; text: string; candidates: string[]; fixtures?: string[] }

function escape(s: string): string {
  return s.replace(/"/g, '&quot;')
}

function probe(s: Sample): Probe {
  const css = `400 ${s.size}px ${s.family}`
  const base = { kind: 'offscreen' as const, font: `normal 400 ${s.size * DPR}px ${s.family}`, letterSpacing: '0px', lang: 'en', textRendering: 'optimizeLegibility', direction: s.dir }
  const canvas: CanvasMeasure[] = s.candidates.map(text => ({ ...base, text }))
  const style = `white-space:nowrap; font:${escape(css)}; line-height:48px; width:max-content`
  return {
    id: `blink-followups-20260917 ${s.id}`,
    spec: 'blink-RESULTS other open items',
    pageLang: 'en',
    browsers: ['chrome'],
    document: s.fixtures ? `followups-${s.fixtures.join('-')}` : 'followups',
    ...(s.fixtures ? { fontFixtures: s.fixtures } : {}),
    html: `<div id="t" lang="en" dir="${s.dir}" style="${style}"></div>`,
    setup: `element.textContent = ${JSON.stringify(s.text)}`,
    canvas,
    observe: ['rangeWidth', 'canvasWidths'],
    note: `Canvas entries at ${s.size * DPR}px: ${s.candidates.map(c => JSON.stringify(c)).join(', ')}. DOM extent × 128 against ceil(W × 64).`,
  }
}

const AMIRI = ['Amiri']
const brackets = ['((', '⁠', '⁠((', '͏', '͏((', '‏', '‏((', 'a((', 'ب((']
const OBJECT = ['￼', '￹', '￺', '￻', '', '͸', '�', '􏿽']

const SAMPLES: Sample[] = [
  { id: 'amiri rlm brackets rtl', family: 'Amiri', size: 24, dir: 'rtl', text: '‏((', candidates: brackets, fixtures: AMIRI },
  { id: 'amiri rlm brackets ltr', family: 'Amiri', size: 24, dir: 'ltr', text: '‏((', candidates: brackets, fixtures: AMIRI },
  { id: 'amiri wj brackets ltr', family: 'Amiri', size: 24, dir: 'ltr', text: '⁠((', candidates: brackets, fixtures: AMIRI },
  { id: 'amiri wj alone', family: 'Amiri', size: 24, dir: 'ltr', text: 'a⁠b', candidates: ['ab', 'a⁠b', '⁠'], fixtures: AMIRI },
  { id: 'arial object replacement', family: 'Arial', size: 16, dir: 'ltr', text: 'a￼b', candidates: OBJECT.concat(['a', 'b', 'ab']) },
  { id: 'times object replacement', family: '"Times New Roman"', size: 16, dir: 'ltr', text: 'a￼b', candidates: OBJECT.concat(['a', 'b', 'ab']) },
  { id: 'amiri object replacement', family: 'Amiri', size: 16, dir: 'ltr', text: 'a￼b', candidates: OBJECT.concat(['a', 'b', 'ab']), fixtures: AMIRI },
  { id: 'arial object replacement alone', family: 'Arial', size: 16, dir: 'ltr', text: '￼', candidates: OBJECT },
]

// 3. blink-RESULTS open class 4 (`suite/U+200D/middle` c-03c543bf92efcb2d): `ب` SHY `ب` ZWJ `ب` in Amiri 16px, pre-wrap,
//    break-word, 7.618 px. Native lines are the four grapheme clusters; the port gives [0, 4) and `ب`. Hypothesis: in the
//    item's own shaping (one line, nowrap) `ب` SHY `ب` is wider than 7.618 px, so ShapeLine's candidate break is at or before
//    offset 2 and the hyphen retry ends line 0 at 1, while the U+200D stand-ins measure [0, 4) at 850 units. Per code point
//    Range rects of the nowrap line give the item's positions; the second probe repeats the case's layout.
const SHY_ZWJ = 'ب­ب‍ب'
const shyZwjCanvas: CanvasMeasure[] = ['ب⁠ب‍‍', 'ب⁠ب‍ب', 'ب⁠ب', 'ب⁠‍', 'ب‍', '‍ب', 'ب', '‐', '-'].map(text => ({
  kind: 'offscreen' as const, font: 'normal 400 32px Amiri', letterSpacing: '0px', lang: 'en', textRendering: 'optimizeLegibility', direction: 'rtl' as const, text,
}))
const SHY_ZWJ_PROBES: Probe[] = [
  {
    id: 'blink-followups-20260917 amiri shy zwj nowrap positions',
    spec: 'blink-RESULTS open class 4',
    pageLang: 'en',
    browsers: ['chrome'],
    document: 'followups-Amiri',
    fontFixtures: AMIRI,
    html: `<div id="t" lang="en" dir="ltr" style="white-space:nowrap; font:400 16px Amiri; line-height:48px; width:max-content"></div>`,
    setup: `element.textContent = ${JSON.stringify(SHY_ZWJ)}`,
    canvas: shyZwjCanvas,
    observe: ['lines', 'rangeWidth', 'canvasWidths'],
    note: 'Item positions of the whole string in one line; Canvas entries at 32px. Compare [0, 4) with 975 units.',
  },
  {
    id: 'blink-followups-20260917 amiri shy zwj case layout',
    spec: 'blink-RESULTS open class 4',
    pageLang: 'en',
    browsers: ['chrome'],
    document: 'followups-Amiri',
    fontFixtures: AMIRI,
    html: `<div id="t" lang="en" dir="ltr" style="white-space:pre-wrap; overflow-wrap:break-word; font:400 16px Amiri; line-height:48px; width:7.61833324432373px"></div>`,
    setup: `element.textContent = ${JSON.stringify(SHY_ZWJ)}`,
    observe: ['lines'],
    note: 'The case layout, to check the lab rows.',
  },
]

export default function followupProbes(): Probe[] {
  return SAMPLES.map(probe).concat(SHY_ZWJ_PROBES)
}
