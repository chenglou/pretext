// What the Blink port asks of the shared runtime checks: the Canvas its measuring recipes assume
// (measure/canvas-checks.ts) and the font facts it reads among those Canvas can answer (measure/font-checks.ts).
import type { BlinkEnvironment } from '../../env.js'
import type { CanvasNeeds } from '../../measure/canvas-checks.js'
import type { FontChecks } from '../../measure/font-checks.js'

// Read from the recipes (engines/blink/contexts.ts styleContexts, hankerning.ts): `lang` per style, `letterSpacing`,
// `textRendering = 'optimizeLegibility'`, `direction = 'rtl'`, the ink box of HanKerning's glyph types, and a letter spacing
// of 1/64 px that turns optional ligatures off and adds exactly 1/64 px to each character (NO_LIGATURES_SPACING_PX;
// edgeGap's differences cancel it in 16.16 units).
export const blinkCanvasNeeds: CanvasNeeds = {
  attributes: ['lang', 'letterSpacing', 'textRendering', 'direction'], inkBox: true,
  ligaturesOffSpacing: { value: '0.015625px', addsPx: 0.015625, inkBoxStays: false }, textRendering: 'optimizeLegibility',
}

// The families Blink gives the macOS system UI font, which it measures at the CSS size (model.ts opticalSizeAxis;
// font_cache_mac.mm:289-292, :408).
const SYSTEM_FONT_FAMILIES = ['system-ui', 'blinkmacsystemfont']

// Blink reads primaryFamily for the opticalSizeAxis default, so it is asked there only with that check or for the hyphen.
// opticalSizeAxis is asked at the layout zoom, which Canvas never applies. Blink resolves a Canvas font under the context's
// language, and its contexts are at text-rendering optimizeLegibility (contexts.ts styleContexts).
export function blinkFontChecks(env: BlinkEnvironment): FontChecks {
  return {
    primaryFamily: false, mapsHyphen: true, monospace: false, opticalSizeAxis: { zoom: env.devicePixelRatio, cssSizeFamilies: SYSTEM_FONT_FAMILIES },
    joining: true, contextTakesLang: true, textRendering: 'optimizeLegibility',
  }
}
