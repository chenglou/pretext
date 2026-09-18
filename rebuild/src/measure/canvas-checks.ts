// What the ports' measuring recipes assume of the Canvas API, asked of the running browser once per page (env.ts
// detectEngine). A Canvas that lacks one of these doesn't fail: a context attribute the browser doesn't have becomes an
// ordinary property when a recipe assigns it, and the recipe then reads a width measured some other way. The build number
// can't stand in for this: a build near the pinned one predicts as well as the pinned one, and a build whose Canvas differs
// predicts badly while its native layout barely moved (rebuild/research/VERSION-DRIFT.md: without `lang`, and with a
// 0.001px letter spacing kept as a fraction, line counts fell from 99.8% to 89.2% where native layout was 98.3% the same).
//
// The lists are read from the recipes, and name only what a recipe sets to something other than the attribute's default:
// - Blink (engines/blink/shape.ts styleContexts, hankerning.ts): `lang` per style, `letterSpacing`, `textRendering =
//   'optimizeLegibility'`, `direction = 'rtl'`, the ink box of HanKerning's glyph types, and a letter spacing of 1/64 px
//   that turns optional ligatures off and adds exactly 1/64 px to each character (NO_LIGATURES_SPACING_PX; edgeGap's
//   differences cancel it in 16.16 units).
// - Gecko (engines/gecko/prepare.ts contexts, lines.ts ligatureAcross and the letter spacing recipes): `lang`,
//   `letterSpacing`, `direction = 'rtl'`, the ink box, and a letter spacing of 0.001px that turns optional ligatures off,
//   adds no app unit and leaves the ink box where it was, which ligatureAcross compares (specs/gecko-canvas.md §1.7 and
//   §2 A6; CanvasRenderingContext2D.cpp:4771-4774 rounds the spacing to app units per character).
// - WebKit (engines/webkit/content.ts contexts): `letterSpacing` and `wordSpacing`. Its context has no `lang`,
//   `fontKerning` or `textRendering`, and the port assigns them their defaults only; WebKit's Canvas keeps optional ligatures
//   under letter spacing, so the port has no recipe that turns them off.
// `wordSpacing = '0px'`, `fontKerning = 'auto'` and `textRendering = 'auto'` are defaults: a Canvas without the attribute
// measures the same.
import type { EngineName } from '../env.js'

type ContextAttribute = 'lang' | 'letterSpacing' | 'wordSpacing' | 'textRendering' | 'direction'

type CanvasNeeds = {
  attributes: readonly ContextAttribute[]
  // The recipes read TextMetrics.actualBoundingBoxLeft and actualBoundingBoxRight.
  inkBox: boolean
  // The letter spacing the recipes turn optional ligatures off with, what it must add to each character's width, and
  // whether the recipes also read the ink box under it, which then must not move.
  ligaturesOffSpacing: { value: string; addsPx: number; inkBoxStays: boolean } | null
  // The text rendering the check's two contexts take, null for the default. Blink's font cache key holds text-rendering
  // and not the specified size (font_description.cc:308-331), so a context at the default would share a platform font with
  // the page's own default text; the port's contexts are at optimizeLegibility (measure/font-checks.ts, last section).
  textRendering: CanvasTextRendering | null
}

function canvasNeeds(engine: EngineName): CanvasNeeds {
  switch (engine) {
    case 'blink': return { attributes: ['lang', 'letterSpacing', 'textRendering', 'direction'], inkBox: true, ligaturesOffSpacing: { value: '0.015625px', addsPx: 0.015625, inkBoxStays: false }, textRendering: 'optimizeLegibility' }
    case 'webkit': return { attributes: ['letterSpacing', 'wordSpacing'], inkBox: false, ligaturesOffSpacing: null, textRendering: null }
    case 'gecko': return { attributes: ['lang', 'letterSpacing', 'direction'], inkBox: true, ligaturesOffSpacing: { value: '0.001px', addsPx: 0, inkBoxStays: true }, textRendering: null }
  }
}

// One letter 16 times in a generic family, which always resolves: no ligature to turn off, and kerning stays on under
// letter spacing in both engines. A single letter wouldn't do: a Canvas that adds the spacing as a fraction and rounds the
// total shows nothing until the fractions add up (0.001px is 0.06 app units; in VERSION-DRIFT.md's build `nn` measures
// 16px either way and its ink box ends 0.001px later, probe canvas-checks). 16 letters at 1/64 px add 0.25px, exact in Blink's
// 16.16 totals, which float32 holds below 256 px. Two contexts: Blink caches shaped words per canvas
// (specs/blink-canvas.md §1.7).
const CHECK_FONT = '16px serif'
const CHECK_TEXT = 'nnnnnnnnnnnnnnnn'

// TextMetrics as a Canvas without the ink box returns it.
type MeasuredText = { width: number; actualBoundingBoxLeft?: number; actualBoundingBoxRight?: number }

// What the engine's recipes assume and this browser's Canvas lacks, named for the reader; empty when nothing is missing.
// Two contexts and two measureText calls.
export function missingCanvasSupport(engine: EngineName): string[] {
  if (typeof OffscreenCanvas !== 'function') return ['OffscreenCanvas']
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  if (context === null) return ['a 2D context on an OffscreenCanvas']
  const needs = canvasNeeds(engine)
  const missing: string[] = []
  for (let i = 0; i < needs.attributes.length; i++) {
    if (!(needs.attributes[i]! in context)) missing.push(`the context attribute ${needs.attributes[i]!}`)
  }
  if (needs.textRendering !== null && 'textRendering' in context) context.textRendering = needs.textRendering
  context.font = CHECK_FONT
  const plain: MeasuredText = context.measureText(CHECK_TEXT)
  if (needs.inkBox && (typeof plain.actualBoundingBoxLeft !== 'number' || typeof plain.actualBoundingBoxRight !== 'number')) {
    missing.push('TextMetrics.actualBoundingBoxLeft and actualBoundingBoxRight')
  }
  const spacing = needs.ligaturesOffSpacing
  if (spacing !== null && 'letterSpacing' in context) {
    const spaced = new OffscreenCanvas(1, 1).getContext('2d')!
    if (needs.textRendering !== null && 'textRendering' in spaced) spaced.textRendering = needs.textRendering
    spaced.font = CHECK_FONT
    spaced.letterSpacing = spacing.value
    const under: MeasuredText = spaced.measureText(CHECK_TEXT)
    // Exact: Blink's widths are 16.16 totals, Gecko's are app units.
    const added = (under.width - plain.width) / CHECK_TEXT.length
    if (added !== spacing.addsPx) missing.push(`a letter spacing of ${spacing.value} that adds ${spacing.addsPx}px to each character's width (here it adds ${added}px)`)
    if (spacing.inkBoxStays && (under.actualBoundingBoxLeft !== plain.actualBoundingBoxLeft || under.actualBoundingBoxRight !== plain.actualBoundingBoxRight)) {
      missing.push(`a letter spacing of ${spacing.value} that leaves the ink box where it was`)
    }
  }
  return missing
}
