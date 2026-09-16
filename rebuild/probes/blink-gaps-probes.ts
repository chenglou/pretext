// Probes for specs/blink-gaps.md §8 hypotheses the Blink port's measuring model rests on: U+2028 standing for U+0020 in
// Canvas strings (H5-H8) and pair totals as the unsafe-offset test (H12). Plain observations; verdicts are written by hand.
//
// Run under the browser lock (from ~/github/pretext-rebuild):
//   bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/probes/blink-gaps-probes.ts \
//     --out=.artifacts/probes/blink/gaps --probe-timeout-ms=60000
import type { Probe } from './types.ts'

// R16 at the zoomed size per family: default and optimizeLegibility contexts, `A V` with U+0020 and with U+2028, the word
// sum, and the DOM width of a `white-space: pre` span in raw LayoutUnits.
const spaceSource = `
const Z = window.devicePixelRatio
const measure = (font, s, rendering) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d')
  c.font = font
  c.textRendering = rendering
  return Math.round(c.measureText(s).width * 65536)
}
const out = {}
const families = ['Arial', 'Helvetica', '"Times New Roman"', 'Georgia']
for (let i = 0; i < families.length; i++) {
  const family = families[i]
  const font = (16 * Z) + 'px ' + family
  const row = {}
  const renderings = ['auto', 'optimizeLegibility']
  for (let r = 0; r < renderings.length; r++) {
    const rendering = renderings[r]
    const space = measure(font, 'A V', rendering)
    const separator = measure(font, 'A\\u2028V', rendering)
    const words = measure(font, 'A', rendering) + measure(font, ' ', rendering) + measure(font, 'V', rendering)
    row[rendering] = { space, separator, words, separatorMinusWords: separator - words, ceilSeparator: Math.ceil(separator / 1024) }
  }
  const span = document.createElement('span')
  span.style.font = '16px ' + family
  span.style.whiteSpace = 'pre'
  span.textContent = 'A V'
  host.appendChild(span)
  row.dom = Math.round(span.getBoundingClientRect().width * Z * 64)
  span.remove()
  out[family] = row
}
return { dpr: Z, families: out }
`

// Pair totals R16(xy) − R16(x) − R16(y) per family, U+2028 for the space.
const pairSource = `
const Z = window.devicePixelRatio
const measure = (font, s) => {
  const c = new OffscreenCanvas(1, 1).getContext('2d')
  c.font = font
  c.textRendering = 'optimizeLegibility'
  return Math.round(c.measureText(s).width * 65536)
}
const pairs = ['To', 'AV', 'Av', '\\u2028T', 'A\\u2028', 'oo', 'VA']
const families = ['Arial', 'Georgia', '"Courier New"', 'Helvetica']
const out = {}
for (let i = 0; i < families.length; i++) {
  const font = (16 * Z) + 'px ' + families[i]
  const row = {}
  for (let k = 0; k < pairs.length; k++) {
    const pair = pairs[k]
    const d = measure(font, pair) - measure(font, pair.slice(0, 1)) - measure(font, pair.slice(1))
    row[JSON.stringify(pair)] = d
  }
  out[families[i]] = row
}
return { dpr: Z, pairs: out }
`

export default async function gapsProbes(): Promise<Probe[]> {
  return [
    {
      id: 'blink-gaps H5-H8',
      spec: 'blink-gaps §8 H5-H8',
      pageLang: 'en',
      html: '<div></div>',
      observe: [{ kind: 'script', source: spaceSource }],
      note: 'Expected: Canvas with U+2028 gives the one-call HarfBuzz total, so ceil64 of it equals the DOM span width, where the word sum differs by the cross-space kerning (Arial, Helvetica, Times New Roman) and Georgia shows no difference.',
    },
    {
      id: 'blink-gaps H12',
      spec: 'blink-gaps §8 H12',
      pageLang: 'en',
      html: '<div></div>',
      observe: [{ kind: 'script', source: pairSource }],
      note: 'Expected: Arial To and the space pairs nonzero; Georgia and Courier New zero.',
    },
  ]
}
