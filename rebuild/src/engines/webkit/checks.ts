// What the WebKit port asks of the shared runtime checks: the Canvas its measuring recipes assume
// (measure/canvas-checks.ts) and the font facts it reads among those Canvas can answer (measure/font-checks.ts).
import type { CanvasNeeds } from '../../measure/canvas-checks.js'
import type { FontChecks } from '../../measure/font-checks.js'

// Read from the recipes (engines/webkit/content.ts contexts): `letterSpacing` and `wordSpacing`. Its context has no `lang`,
// `fontKerning` or `textRendering`, and the port assigns them their defaults only; WebKit's Canvas keeps optional ligatures
// under letter spacing, so the port has no recipe that turns them off with spacing: it finds the pairs Canvas merges and
// measures them apart (measure.ts mergedGlyphs).
export const webkitCanvasNeeds: CanvasNeeds = { attributes: ['letterSpacing', 'wordSpacing'], inkBox: false, ligaturesOffSpacing: null, textRendering: null }

// WebKit reads primaryFamily itself (model.ts FontFacts), the hyphen and the pitch. It doesn't read opticalSizeAxis, and
// its Canvas shows no shaping context for joining. Its context has no language.
export const webkitFontChecks: FontChecks = {
  primaryFamily: true, mapsHyphen: true, monospace: true, opticalSizeAxis: null, joining: false, contextTakesLang: false, textRendering: 'auto',
}
