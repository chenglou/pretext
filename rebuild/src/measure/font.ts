// Font strings for ctx.font. The size is whatever the engine shapes at, which the engine computes (DESIGN.md §4):
// - Blink: the computed size, float32(specified × layout zoom), because the DOM shapes at the zoomed size and Canvas
//   never zooms; both then floor to 1/100 px in float32 (specs/blink-lines.md §2.3, specs/blink-canvas.md §1.2).
// - WebKit: the CSS size times page zoom (specs/webkit-lines.md §1.6, unverified: CRITIC.md W5).
// - Gecko: the CSS size when QuantizeFontSize(size) equals the DOM's round(size × 60) / 60, else a named gap; Apple Color
//   Emoji at size × DPR (specs/gecko-canvas.md §1.2 C2, §1.9).
import type { FontDecl } from '../model.js'

// `style weight size family`. String(size) is the shortest decimal that parses back to the same double, so a float32
// size survives the CSS parser unchanged.
export function canvasFont(font: FontDecl, sizePx: number): string {
  return `${font.style} ${font.weight} ${String(sizePx)}px ${font.family}`
}
