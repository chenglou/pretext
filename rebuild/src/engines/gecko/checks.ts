// What the Gecko port asks of the shared runtime checks: the Canvas its measuring recipes assume
// (measure/canvas-checks.ts) and the font facts it reads among those Canvas can answer (measure/font-checks.ts).
import type { CanvasNeeds } from '../../measure/canvas-checks.js'
import type { FontChecks } from '../../measure/font-checks.js'

// Read from the recipes (engines/gecko/prepare.ts contexts, lines.ts ligatureAcross and the letter spacing recipes): `lang`,
// `letterSpacing`, `direction = 'rtl'`, the ink box, and a letter spacing of 0.001px that turns optional ligatures off,
// adds no app unit and leaves the ink box where it was, which ligatureAcross compares (specs/gecko-canvas.md §1.7 and
// §2 A6; CanvasRenderingContext2D.cpp:4771-4774 rounds the spacing to app units per character).
export const geckoCanvasNeeds: CanvasNeeds = {
  attributes: ['lang', 'letterSpacing', 'direction'], inkBox: true, ligaturesOffSpacing: { value: '0.001px', addsPx: 0, inkBoxStays: true }, textRendering: null,
}

// Gecko is asked nothing: of the facts with a check it reads primaryFamily alone, and only to word a gap's detail
// (engines/gecko/fonts.ts).
export const geckoFontChecks: FontChecks = {
  primaryFamily: false, mapsHyphen: false, monospace: false, opticalSizeAxis: null, joining: false, contextTakesLang: true, textRendering: 'auto',
}
