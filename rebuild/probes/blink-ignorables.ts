// Default-ignorable characters in Blink's Canvas strings (rebuild/specs/blink-RESULTS.md, Follow-up). Canvas turns SHY,
// ZWSP, LRM, RLM, U+202A..U+202E and U+FEFF into U+200B, which ends a Canvas word (plain_text_node.cc:47-62, 85-91,
// character.h:167-175). The DOM keeps the character inside the shaping call, where HarfBuzz hides it after substitution
// (hb-ot-shape.cc:951-959) and RunSegmenter's emoji scanner sees a non-emoji character (emoji_segmentation_category
// kMaxCategory). Candidates for the Canvas string: the character left out, the character itself, and default-ignorable
// characters Canvas doesn't normalize: U+2060 WORD JOINER, U+034F COMBINING GRAPHEME JOINER, U+180E MONGOLIAN VOWEL
// SEPARATOR. Plain observations; verdicts are written by hand from the widths.
//
// Run under the browser lock (from ~/github/pretext-rebuild):
//   bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/blink-ignorables.ts \
//     --out=.artifacts/probes/blink/ignorables --probe-timeout-ms=60000
import type { CanvasMeasure, Probe } from './types.ts'

const DPR = 2

type Sample = {
  id: string
  family: string
  size: number
  weight?: number
  dir: 'ltr' | 'rtl'
  // The block's text; with `span`, the text of a span that holds one bidi item, followed by `after` in the block.
  text: string
  after?: string
  letterSpacing?: number
  fixtures?: string[]
}

const CANDIDATES: Array<[string, string | null]> = [
  ['drop', ''],
  ['literal', null],
  ['U+2060', '⁠'],
  ['U+034F', '͏'],
  ['U+180E', '᠎'],
]

const NORMALIZED = /[­​‎‏‪-‮﻿]/g

function escape(s: string): string {
  return s.replace(/"/g, '&quot;')
}

function probe(s: Sample): Probe {
  const weight = s.weight ?? 400
  const css = `${weight} ${s.size}px ${s.family}`
  const base = { kind: 'offscreen' as const, font: `normal ${weight} ${s.size * DPR}px ${s.family}`, letterSpacing: `${(s.letterSpacing ?? 0) * DPR}px`, lang: 'en', textRendering: 'optimizeLegibility', direction: s.dir }
  const canvas: CanvasMeasure[] = []
  for (const [, replacement] of CANDIDATES) {
    canvas.push({ ...base, text: replacement === null ? s.text : s.text.replace(NORMALIZED, replacement) })
  }
  // The parts between the normalized characters, each measured alone.
  const parts = s.text.split(NORMALIZED)
  for (const part of parts) if (part.length > 0) canvas.push({ ...base, text: part })
  const style = `white-space:nowrap; font:${escape(css)}; letter-spacing:${s.letterSpacing ?? 0}px; line-height:48px; width:max-content`
  const html = `<div id="t" lang="en" dir="${s.dir}" style="${style}"></div>`
  const setup = s.after === undefined
    ? `element.textContent = ${JSON.stringify(s.text)}`
    : `const span = document.createElement('span'); span.textContent = ${JSON.stringify(s.text)}; element.append(span, ${JSON.stringify(s.after)})`
  return {
    id: `blink-ignorables ${s.id}`,
    spec: 'blink-RESULTS class 3 (soft-hyphen-shaping)',
    pageLang: 'en',
    browsers: ['chrome'],
    document: s.fixtures ? `ignorables-${s.fixtures.join('-')}` : 'ignorables',
    ...(s.fixtures ? { fontFixtures: s.fixtures } : {}),
    html,
    setup,
    canvas,
    observe: s.after === undefined ? ['rangeWidth', 'canvasWidths'] : [{ kind: 'boxWidth', selectors: ['span'] }, 'canvasWidths'],
    note: `Canvas entries at ${s.size * DPR}px: drop, literal, U+2060, U+034F, U+180E, then the parts alone. DOM extent (or the span's box) × 128 against ceil(W × 64).`,
  }
}

const SAMPLES: Sample[] = [
  { id: 'skin-modifier shy', family: 'Arial', size: 24, dir: 'ltr', text: 'a\u{1f44d}­\u{1f3fd}b' },
  { id: 'skin-modifier zwsp', family: 'Arial', size: 24, dir: 'ltr', text: 'a\u{1f44d}​\u{1f3fd}b' },
  { id: 'skin-modifier wj', family: 'Arial', size: 24, dir: 'ltr', text: 'a\u{1f44d}⁠\u{1f3fd}b' },
  { id: 'skin-modifier unbroken', family: 'Arial', size: 24, dir: 'ltr', text: 'a\u{1f44d}\u{1f3fd}b' },
  { id: 'woman-before-zwj shy', family: 'Arial', size: 24, dir: 'ltr', text: 'a\u{1f469}­‍\u{1f680}b' },
  { id: 'woman-before-zwj zwsp', family: 'Arial', size: 12, dir: 'rtl', text: 'a\u{1f469}​‍\u{1f680}b' },
  { id: 'woman-after-zwj shy', family: 'Arial', size: 24, dir: 'ltr', text: 'a\u{1f469}‍­\u{1f680}b' },
  { id: 'woman-after-zwj zwsp', family: 'Arial', size: 12, dir: 'rtl', text: 'a\u{1f469}‍​\u{1f680}b' },
  { id: 'heart-vs16 shy', family: 'Arial', size: 24, dir: 'ltr', text: 'a❤️­b' },
  { id: 'kerning zwsp', family: 'Arial', size: 24, dir: 'ltr', text: 'A​V' },
  { id: 'kerning shy 16-bit', family: 'Arial', size: 24, dir: 'ltr', text: 'A­V ' },
  { id: 'kerning zwsp (ProbeShantell bold, letter spacing 1px)', family: 'ProbeShantell', size: 16, weight: 700, dir: 'ltr', letterSpacing: 1, text: 'abc​d', fixtures: ['ProbeShantell'] },
  { id: 'mark after zwsp', family: 'Arial', size: 16, dir: 'ltr', text: 'a​́b' },
  { id: 'mark after zwsp (letter spacing -4px)', family: 'Arial', size: 16, dir: 'ltr', letterSpacing: -4, text: 'a​́b' },
  { id: 'mark after feff', family: '"Courier New"', size: 16, dir: 'ltr', text: 'a﻿﻿́b' },
  { id: 'mark after feff (letter spacing -4px)', family: '"Courier New"', size: 16, dir: 'ltr', letterSpacing: -4, text: 'a﻿﻿́b' },
  { id: 'mark-context', family: '"Courier New"', size: 16, dir: 'ltr', text: 'a⁠́​̈b' },
  { id: 'mark-context (letter spacing 1px)', family: '"Courier New"', size: 16, dir: 'ltr', letterSpacing: 1, text: 'a⁠́​̈b' },
  { id: 'arabic shy zwsp (Geeza Pro fallback)', family: '"Shantell Sans"', size: 16, dir: 'rtl', text: 'ب­ب​ب' },
  { id: 'arabic feff (Geeza Pro fallback)', family: '"Shantell Sans"', size: 16, dir: 'rtl', text: 'ب­ب﻿ب' },
  { id: 'arabic zwsp (Geeza Pro)', family: '"Geeza Pro"', size: 16, dir: 'rtl', text: 'ب​ب' },
  { id: 'arabic zwsp (Amiri)', family: 'Amiri', size: 24, dir: 'rtl', text: 'ب​ب', fixtures: ['Amiri'] },
  { id: 'arabic shy (Amiri)', family: 'Amiri', size: 24, dir: 'rtl', text: 'ب­ب', fixtures: ['Amiri'] },
  { id: 'rlm brackets (Amiri)', family: 'Amiri', size: 24, dir: 'rtl', text: '‏((tail', fixtures: ['Amiri'] },
  { id: 'rlm brackets item (Amiri)', family: 'Amiri', size: 24, dir: 'rtl', text: '‏((', after: 'tail', fixtures: ['Amiri'] },
  { id: 'thai mark after zwsp', family: 'Thonburi', size: 18, dir: 'ltr', text: 'พระองค​์พร้อม' },
  { id: 'thai zwsp between clusters', family: 'Thonburi', size: 20, dir: 'ltr', text: 'พระธรรม​ธวัช' },
  { id: 'thai vowel after zwsp', family: 'Thonburi', size: 20, dir: 'ltr', text: 'เอ​็ง' },
  { id: 'latin shy 8-bit', family: 'Arial', size: 24, dir: 'ltr', text: 'AVA­VAT' },
]

// Whether `‏((` with U+2060 measures wider in Amiri because the 16-bit string resolves the brackets as Common: `(((` as an
// 8-bit string (one Latin segment) against the same text as a 16-bit string (RunSegmenter, Common only).
const STORAGE: Probe = {
  id: 'blink-ignorables storage (Amiri)',
  spec: 'blink-RESULTS class 3 (soft-hyphen-shaping)',
  pageLang: 'en',
  browsers: ['chrome'],
  document: 'ignorables-Amiri',
  fontFixtures: ['Amiri'],
  html: '<div id="t" lang="en" dir="rtl" style="font:24px Amiri; line-height:48px">(((</div>',
  observe: [{
    kind: 'script',
    source: `const c = new OffscreenCanvas(1, 1).getContext('2d'); c.font = 'normal 400 48px Amiri'; c.lang = 'en'; c.textRendering = 'optimizeLegibility'; c.direction = 'rtl';
const w = s => c.measureText(s).width;
return { oneByte3: w('((('), twoByte3: w(('\\u0100(((').slice(1)), wj2: w('\\u2060(('), oneByte2: w('(('), latinTail: w('((tail'), twoByteLatinTail: w(('\\u0100((tail').slice(1)) }`,
  }],
  note: 'Expected if storage explains the RLM row: twoByte3 − oneByte3 is 1.5 × (wj2 − oneByte2); latinTail equals twoByteLatinTail.',
}

export default function ignorableProbes(): Probe[] {
  return [...SAMPLES.map(probe), STORAGE]
}
