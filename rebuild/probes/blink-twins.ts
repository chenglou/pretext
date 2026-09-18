// Twin strings in Chrome's Canvas (research/ARCHITECTURE-PLAN-2.md §2 item 5, §7 check 9). A twin is one run of
// characters measured twice on one canvas, once as a one-byte string and once as a two-byte string: Canvas shapes a
// one-byte string as one Latin segment and runs RunSegmenter over a two-byte one (harfbuzz_shaper.cc:1072-1101), and the
// Blink port makes a Latin-1-only string of 13 units or more two-byte by slicing it out of a two-byte string where the
// paragraph shapes the range under another script (engines/blink/shape.ts canvasString). Both kinds go to the one
// canvas of a segmented paragraph's style. What the re-architecture needs to know before the string memo goes:
// - T1: whether the two strings measure differently at all on fresh canvases (Amiri's brackets and digits);
// - T2: what one canvas answers the second of them, in both orders (Blink's word cache: does the first shaping win);
// - T3: whether the first answer survives other strings measured between the two (a cache eviction), and from how many;
// - T4: whether the port's own way of building and asking the two-byte string gives the two-byte shaping.
// One script observation per sample, raw widths only; the verdicts are written by hand.
//
// Verdicts, pinned Chrome 153.0.8010.50, 2026-09-18 (.artifacts/probes/blink/twins, twins-port), widths at 48px:
// - T1: Amiri's 13 brackets are 159.119873046875 one-byte and 285.79193115234375 two-byte; 13 guillemets 293.28 and
//   258.96; `(12) [34] {56} 7` 290.30 and 337.54. Amiri's digits, Geeza Pro's digits, Arial's brackets and Times New
//   Roman's digits measure the same both ways. 12 brackets measure the same: V8 copies that slice into one byte.
// - T2: on one canvas the first shaping answers both, in both orders and both directions.
// - T3: it still does after 20,000 other words measured between the two. No eviction was seen.
// - T4: a Map lookup on the sliced string before the call makes it measure as one-byte (159.12 where the same slice
//   without the lookup measures 285.79): V8 replaces a looked-up string whose units fit one byte by a one-byte string.
//   measure/canvas.ts measureText looks every string up in its memo before it asks Canvas, so at the correctness line
//   canvasString's two-byte slice reaches Canvas as one-byte, and no twin can differ. Without the memo it reaches Canvas
//   as two-byte: on lab/cases/twins.ts in Chrome, the line's library with the memo taken out changes the lines or the
//   geometry of 254 of 380 predictions (lineCount 320 to 346 passing, widths 131 to 263), while its replay against the
//   line's record gives 380 of 380 the same lines. Attributes the port assigns (letterSpacing, wordSpacing, fontKerning,
//   direction) change nothing.
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py blink-twins -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/blink-twins.ts --out=.artifacts/probes/blink/twins --probe-timeout-ms=120000
import type { Probe } from './types.ts'

type Sample = { id: string; family: string; text: string; fixtures?: string[] }

// The page script: `text` arrives as a JSON literal, which V8 stores in one byte when its units fit.
function source(s: Sample): string {
  return `
    const text = ${JSON.stringify(s.text)}
    const wide = ('\\u0100' + text).slice(1)
    const context = direction => {
      const c = new OffscreenCanvas(1, 1).getContext('2d')
      c.lang = 'en'
      c.font = ${JSON.stringify(`normal 400 48px ${s.family}`)}
      c.textRendering = 'optimizeLegibility'
      c.direction = direction
      return c
    }
    const out = { text, units: text.length }
    for (const direction of ['ltr', 'rtl']) {
      const fresh = { oneByte: context(direction).measureText(text).width, twoByte: context(direction).measureText(wide).width }
      const a = context(direction)
      const oneByteFirst = { oneByte: a.measureText(text).width, twoByte: a.measureText(wide).width, oneByteAgain: a.measureText(text).width }
      const b = context(direction)
      const twoByteFirst = { twoByte: b.measureText(wide).width, oneByte: b.measureText(text).width, twoByteAgain: b.measureText(wide).width }
      // Other words between the two asks. Each filler is a word of its own that the canvas never saw.
      const between = {}
      for (const fillers of [10, 100, 1000, 5000, 20000]) {
        const c = context(direction)
        const first = c.measureText(text).width
        for (let i = 0; i < fillers; i++) c.measureText('w' + direction + fillers + 'x' + i)
        between[fillers] = { oneByteFirst: first, twoByteAfter: c.measureText(wide).width, oneByteAfter: c.measureText(text).width }
      }
      out[direction] = { fresh, oneByteFirst, twoByteFirst, between }
    }
    return out
  `
}

function probe(s: Sample): Probe {
  return {
    id: `blink-twins ${s.id}`,
    spec: 'ARCHITECTURE-PLAN-2 check 9',
    pageLang: 'en',
    browsers: ['chrome'],
    ...(s.fixtures ? { fontFixtures: s.fixtures } : {}),
    html: '<div id="t"></div>',
    observe: [{ kind: 'script', source: source(s) }],
    note: 'Widths at 48px of one run of characters as a one-byte and as a two-byte string: on fresh canvases, on one canvas in both orders, and with other words measured between.',
  }
}

const AMIRI = ['Amiri']
const SAMPLES: Sample[] = [
  { id: 'amiri brackets 13', family: 'Amiri', text: '(((((((((((((', fixtures: AMIRI },
  // 12 units: V8 copies the slice into a one-byte string, so both strings are one-byte and nothing can differ.
  { id: 'amiri brackets 12', family: 'Amiri', text: '((((((((((((', fixtures: AMIRI },
  { id: 'amiri digits 13', family: 'Amiri', text: '1234567890123', fixtures: AMIRI },
  { id: 'amiri mixed 16', family: 'Amiri', text: '(12) [34] {56} 7', fixtures: AMIRI },
  { id: 'geeza digits 24', family: '"Geeza Pro"', text: '100000000000000000000000' },
  { id: 'arial brackets 13', family: 'Arial', text: '(((((((((((((' },
  { id: 'times digits 13', family: '"Times New Roman"', text: '1234567890123' },
]

// T4: the two-byte slice as the Blink port builds and asks it (engines/blink/shape.ts canvasString, measure/canvas.ts
// measureContext and measureText): the string from String.fromCharCode, the context's attributes assigned in the port's
// order with its values, and a Map lookup on the string before the call.
function portSource(family: string, text: string): string {
  return `
    const codes = ${JSON.stringify([...text].map(ch => ch.charCodeAt(0)))}
    const built = () => String.fromCharCode(...codes)
    const sliced = () => ('\u0100' + built()).slice(1)
    const font = ${JSON.stringify(`normal 400 48px ${family}`)}
    const bare = () => { const c = new OffscreenCanvas(1, 1).getContext('2d'); c.lang = 'en'; c.font = font; c.textRendering = 'optimizeLegibility'; return c }
    const asPort = () => {
      const c = new OffscreenCanvas(1, 1).getContext('2d')
      c.lang = 'en'; c.font = font; c.letterSpacing = '0px'; c.wordSpacing = '0px'; c.fontKerning = 'auto'; c.textRendering = 'optimizeLegibility'; c.direction = 'ltr'
      return c
    }
    const out = {}
    out.bareOneByte = bare().measureText(built()).width
    out.bareTwoByte = bare().measureText(sliced()).width
    out.portOneByte = asPort().measureText(built()).width
    out.portTwoByte = asPort().measureText(sliced()).width
    // One attribute of the port's at a time, on the bare context.
    for (const [name, value] of [['letterSpacing', '0px'], ['wordSpacing', '0px'], ['fontKerning', 'auto'], ['direction', 'ltr']]) {
      const c = bare()
      c[name] = value
      out['bareTwoByteWith_' + name] = c.measureText(sliced()).width
    }
    // The memo's lookup before the call.
    const memo = new Map()
    const looked = sliced()
    memo.get(looked)
    out.bareTwoByteAfterMapGet = bare().measureText(looked).width
    memo.set(looked, 1)
    out.bareTwoByteAfterMapSet = bare().measureText(looked).width
    const again = sliced()
    memo.get(again)
    out.portTwoByteAfterMapGet = asPort().measureText(again).width
    return out
  `
}

const PORT_PROBES: Probe[] = [['Amiri', '((((((((((((('], ['Amiri', '\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab\u00ab']].map(([family, text], i) => ({
  id: `blink-twins as the port asks ${i + 1}`,
  spec: 'ARCHITECTURE-PLAN-2 check 9',
  pageLang: 'en',
  browsers: ['chrome'],
  fontFixtures: AMIRI,
  html: '<div id="t"></div>',
  observe: [{ kind: 'script', source: portSource(family!, text!) }],
  note: 'The two-byte slice on a context set up as the port\'s, attribute by attribute, and after a Map lookup.',
}))

export const probes: Probe[] = [...SAMPLES.map(probe), ...PORT_PROBES]
export default probes
