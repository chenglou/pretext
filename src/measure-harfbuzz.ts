// Server-side text measurement using HarfBuzz (WASM).
// Kept around for headless probes/research where browser canvas measureText
// isn't available.
//
// HarfBuzz is the same shaping engine browsers use internally, so measurements
// are representative. The key difference: we load a specific font file, so results
// are deterministic across platforms (vs browser canvas which resolves system fonts).
//
// Not used in the browser — the browser version uses canvas measureText directly,
// which is faster and uses the same fonts the DOM will render with.

import type { HarfBuzzModule, HarfBuzzFont, HarfBuzzFace, HarfBuzzBlob } from './harfbuzz-types.ts'

let hb: HarfBuzzModule | null = null
const fonts = new Map<string, { font: HarfBuzzFont, face: HarfBuzzFace, blob: HarfBuzzBlob }>()

export async function init(): Promise<void> {
  if (hb !== null) return
  const mod = await import('harfbuzzjs')
  hb = await (mod.default as unknown as Promise<HarfBuzzModule>)
}

export function loadFont(name: string, path: string): void {
  if (hb === null) throw new Error('Call init() first')
  if (fonts.has(name)) return
  // Node/Bun only — bundlers targeting browsers should exclude this module.
  const data = require('fs').readFileSync(path) as Buffer
  const blob = hb.createBlob(new Uint8Array(data))
  const face = hb.createFace(blob, 0)
  const font = hb.createFont(face)
  fonts.set(name, { font, face, blob })
}

export function measureText(text: string, fontName: string, fontSize: number): number {
  if (hb === null) throw new Error('Call init() first')
  const entry = fonts.get(fontName)
  if (!entry) throw new Error(`Font "${fontName}" not loaded. Call loadFont() first.`)

  const buf = hb.createBuffer()
  buf.addText(text)
  // Use explicit LTR direction. guessSegmentProperties() assigns RTL to
  // isolated Arabic words, changing their advance widths vs when measured
  // as part of a mixed-direction string. LTR gives consistent widths that
  // match browser canvas measureText behavior.
  buf.setDirection('ltr')
  hb.shape(entry.font, buf)
  const glyphs = buf.json() as { ax: number }[]
  const scale = fontSize / entry.face.upem
  let width = 0
  for (let i = 0; i < glyphs.length; i++) {
    width += glyphs[i]!.ax
  }
  buf.destroy()
  return width * scale
}
