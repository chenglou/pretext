// The Canvas contexts a style's strings are measured on, and a measured total in the port's units (specs/blink-lines.md
// §2.3; DESIGN.md §4.4). Which of a style's contexts a string goes to is shape.ts contextsOf's.
import { contextFor, width as canvasWidth, type Context, type ContextPool } from '../../measure/canvas.js'
import { canvasFont } from '../../measure/font.js'
import type { ComputedStyle, StyleContexts } from './types.js'

const f32 = Math.fround

// A letter spacing of 1/64 px: what turns liga, clig and calt off in a no-ligature context (styleContexts).
export const NO_LIGATURES_SPACING_PX = 0.015625

// FontDescription::EffectiveFontSize (font_description.cc:271-282): the size a platform font is made at and cached under,
// the computed size floored to 1/100 px in float32.
function effectiveFontSize(computed: number): number {
  return f32(Math.floor(f32(computed * 100)) / 100)
}

// The factor from the advances of a font made for the CSS size to the DOM's at the zoomed size: the ratio of the two
// platform font sizes. It is the zoom only where the two floors agree: 16.8px is a 16.79px font in Canvas and a 33.59px
// one in the DOM at zoom 2, 13.33px is 13.33px and 26.66px. Both sides set opsz and HarfBuzz's ptem from the specified size,
// so nothing else differs. The 64 rule/system-fonts-and-sizes rows at 16.8px failed under the zoom and pass under the ratio
// (`Hello world again and more` is 204.742188px in the DOM, ceil64 of Canvas's 204.680374px × 33.59 / 16.79, where × 2 / 2
// gives 204.6875px; specs/blink-RESULTS.md "Round 4b").
// Kept as a float32, so its products with Canvas's 16.16 totals are exact doubles and differences of measured totals stay
// exact, as the pair and safe tests need.
function cssSizeScale(size: number, zoom: number): number {
  const css = effectiveFontSize(f32(size))
  return css === 0 ? zoom : f32(effectiveFontSize(f32(f32(size) * f32(zoom))) / css)
}

// A style whose fonts have an opsz axis is measured at the CSS size and scaled: Blink's DOM shapes at the zoomed size
// with opsz and HarfBuzz ptem at the specified size (font_platform_data_mac.mm:170-178, harfbuzz_face.cc:639-648), so its
// glyphs are the CSS-size font's at another size (probes-chrome correction 7: DOM(S) = ceil64(W(S) × DPR) at 10-28px in a
// clean renderer). The scaled advances are stand-ins: Blink truncates each glyph's advance to 1/65536 px at its own size
// (skia_text_metrics.cc:207-211), which the layout reports as optical-size (gaps.ts preparedContent). Other fonts are measured
// at the zoomed size (specs/blink-lines.md §2.3).
export function styleContexts(canvases: ContextPool, style: ComputedStyle, zoom: number, partition: string): StyleContexts {
  const cssSize = style.measuresAtCssSize
  const scale = cssSize ? cssSizeScale(style.font.size, zoom) : 1
  // Computed font size f32(specified × zoom); DOM and Canvas both floor it to 1/100 (effectiveFontSize).
  const font = canvasFont(style.font, cssSize ? f32(style.font.size) : f32(f32(style.font.size) * f32(zoom)))
  const lang = style.locale ?? ''
  // The DOM's letter spacing is the CSS value times the zoom, whatever the font sizes' ratio is.
  const letterSpacing = `${f32(style.letterSpacing * zoom / scale)}px`
  // optimizeLegibility sets kKerning | kLigatures, so Canvas shapes a whole bidi run in one call when the primary font's
  // GPOS or GSUB coverage holds the space glyph (font_fallback_list.cc:264-286; blink-canvas H6 confirmed). It adds no
  // HarfBuzz feature (font_features.cc:32-240). Other fonts still split before CJK bases (plain_text_node.cc:115-153).
  const base = { font, lang, wordSpacing: '0px', fontKerning: 'auto' as const, textRendering: 'optimizeLegibility' as const, partition }
  // A letter spacing of 1/64 px turns liga, clig and calt off (font_features.cc:54-86) and adds 1024 raw16 per character,
  // which cancels in a pair adjustment's differences (edgeGap in gaps.ts).
  const noLigatures = `${NO_LIGATURES_SPACING_PX}px`
  return {
    ltr: contextFor(canvases, { ...base, letterSpacing, direction: 'ltr' }),
    rtl: contextFor(canvases, { ...base, letterSpacing, direction: 'rtl' }),
    ltrNoLigatures: contextFor(canvases, { ...base, letterSpacing: noLigatures, direction: 'ltr' }),
    rtlNoLigatures: contextFor(canvases, { ...base, letterSpacing: noLigatures, direction: 'rtl' }),
    // The hyphen is shaped alone without spacing (hyphen_result.cc:12-16).
    hyphen: contextFor(canvases, { ...base, letterSpacing: '0px', direction: 'ltr' }),
    scale,
  }
}

// W × 65536 of a Canvas string, a whole number of 16.16 units (a Canvas total is the float32 of one, blink-canvas §1.5),
// times the style's scale: 16.16 units of the zoomed px. Whole where the scale is 1 or 2; under another scale the
// fractions are exact, so sums and differences of measured totals are too.
export function raw16Of(contexts: StyleContexts, context: Context, s: string): number {
  return Math.round(canvasWidth(context, s) * 65536) * contexts.scale
}
