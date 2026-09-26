import { beforeEach, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { createContextPool } from '../../measure/canvas.js'
import { SourceScriptCursor, isSegmentEdge } from './emoji.js'
import { prepare } from './index.js'
import { GapAccumulator } from './gap-accumulator.js'
import { scriptsPerUnit } from './script.js'
import { canvasScriptsPerUnit, groupPrefix16, measure16 } from './shape.js'

let asked: string[] = [], largeAnswers = false
class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'
  fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    asked.push(text)
    // U+202A..U+202E, which Canvas turns into U+200B (shape.ts inGroupDirection), measure nothing.
    const units = text.replace(/[\u202a-\u202e]/g, '')
    return { width: largeAnswers ? (units === 'a' ? 2 ** 44 : 1 / 512) : units.length * .0001,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}
beforeEach(() => {
  asked = []; largeAnswers = false
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}
function paragraph(text: string): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

test('preparing thousands of alternating LTR script segments completes with every original segment question', () => {
  const text = 'aक'.repeat(8192)
  const p = prepare(paragraph(text), env, false, createContextPool())
  expect(p.text).toBe(text)
  expect(p.groups.length).toBe(1)
  expect(asked.length).toBe(text.length)
  expect(asked.every((segment, i) => segment === (i % 2 === 0 ? 'a' : 'क'))).toBe(true)
  expect(p.groups[0]!.prefixAtCut).toEqual([0, 7 * text.length])
})

test('cross-script questions stay in source order and retain the right-associated measured total', () => {
  const p = prepare(paragraph('aकb'), env, false, createContextPool())
  asked = []; largeAnswers = true
  const width = measure16({ p, gaps: null }, 0, 0, p.text.length, 0, p.text.length)
  expect(asked).toEqual(['a', 'क', 'b'])
  // Per-segment raw widths are 2^60, 128, 128. Their original right-associated total includes 256;
  // summing each small width into the huge prefix would round both away.
  expect(width).toBe(2 ** 60 + 256)
})

// The facade counts whatever primary buffers the constructor owns, so the work budget also rejects the earlier
// correct five-column representation through actual extra reads, rather than through changed private field names.
function partitionReadCount(p: ReturnType<typeof prepare>): () => number {
  let reads = 0
  const segments = p.segments
  if (segments === null) return () => 0
  const fields = segments as unknown as Record<string, unknown>
  for (const [key, source] of Object.entries(fields)) {
    if (!(source instanceof Int32Array) && !(source instanceof Uint8Array)) throw new Error(`unexpected source partition field ${key}`)
    Object.defineProperty(segments, key, { value: new Proxy(source, { get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } }) })
  }
  return () => reads
}

// All offset positions and questions remain asserted; a per-offset rescan of one script or of the numeric-direction
// exception must not hide behind a small Canvas total.
test('all positions in one scripted shaping segment have linear partition reads, including Arabic digits', () => {
  for (const seed of ['אבג', '١٢٣٤٥٦٧٨٩٠']) {
    const text = seed.repeat(Math.ceil(1024 / seed.length)).slice(0, 1024)
    const p = prepare(paragraph(text), env, false, createContextPool())
    const reads = partitionReadCount(p)
    asked = []
    for (let k = 1; k < text.length; k++) {
      expect(groupPrefix16({ p, gaps: null }, 0, k)).toBe(Math.round(k * .0001 * 65536) - 1)
    }
    expect(asked.length).toBe(4 * (text.length - 1))
    expect(reads()).toBeLessThan(16 * text.length)
  }
})


test('dense script edges and shaping directions use constant reads per source unit', () => {
  const text = 'aक'.repeat(1024)
  const p = prepare(paragraph(text), env, false, createContextPool())
  const reads = partitionReadCount(p)
  asked = []
  for (let k = 0; k < text.length; k++) {
    expect(isSegmentEdge(p, k)).toBe(k > 0)
    expect(p.segments!.reversedAt(k)).toBe(false)
  }
  expect(asked).toEqual([])
  expect(reads()).toBeLessThanOrEqual(4 * text.length)
})


test('lone low scripts stay distinct from ignored measurement boundaries under letter spacing', () => {
  for (const spacing of [-2, 1.5]) for (const direction of ['ltr', 'rtl'] as const) {
    const input = paragraph('ب\uDC00ب')
    input.letterSpacing = spacing; input.direction = direction
    const p = prepare(input, env, false, createContextPool())
    expect(Array.from({ length: p.text.length }, (_, k) => p.segments!.scriptAt(k))).toEqual([2, 103, 2])
    // The first source character still shapes as cursive Arabic, so the DOM and Canvas spacing rules agree.
    // A group beginning at the low must not overwrite that first character's source script.
    const g = p.groupOfUnit[0]!, group = p.groups[g]!
    asked = []
    expect(measure16({ p, gaps: null }, g, 0, 1, group.start, group.end)).toBe(7)
    // An RTL group's strings go to Canvas inside U+202E and U+202C (shape.ts inGroupDirection).
    const inRtl = (s: string): string => '\u202e' + s + '\u202c'
    expect(asked).toEqual([inRtl('ب')])
    // The original splitter ignores the boundary before the low, but preserves the boundary after it.
    asked = []
    expect(measure16({ p, gaps: null }, g, 0, 3, 0, 3)).toBe(20)
    expect(asked).toEqual([inRtl('ب\uDC00'), inRtl('ب')])
    // Starting a question at that same low reads its actual Unknown script and reaches the next accepted boundary.
    asked = []
    expect(measure16({ p, gaps: null }, g, 1, 3, 0, 3)).toBe(14)
    expect(asked).toEqual([inRtl('\uDC00'), inRtl('ب')])
  }
})


test('spacing follows Unknown source runs that absorb Western digits after lone lows', () => {
  for (const spacing of [-2, 1.5]) for (const direction of ['ltr', 'rtl'] as const) {
    const input = paragraph('ب12\uDC00\uDC0134ب')
    input.letterSpacing = spacing; input.direction = direction
    const p = prepare(input, env, false, createContextPool())
    expect(Array.from({ length: p.text.length }, (_, k) => p.segments!.scriptAt(k))).toEqual([2, 2, 2, 103, 103, 103, 103, 2])
    const g = p.groupOfUnit[1]!
    asked = []
    // The Canvas string resolves 12 as Common, while the source resolves it as cursive Arabic, so only those two
    // characters lose Canvas spacing. After the ignored low boundary, 34 is Unknown on both sides and keeps spacing.
    expect(measure16({ p, gaps: null }, g, 1, 7, 1, 7)).toBe(39 - 2 * spacing * 65536)
    expect(asked).toEqual(['12\uDC00\uDC0134'])
  }
})

test('script-context gaps stop at the exact source-script change hidden by lone lows', () => {
  for (const direction of ['ltr', 'rtl'] as const) for (const fixture of [
    { text: 'אב12\uDC00\uDC0134גד', ranges: [{ start: 2, end: 6 }] },
    { text: 'क12\uDC00\uDC0134ख', ranges: [] },
  ]) {
    const input = paragraph(fixture.text); input.direction = direction
    const p = prepare(input, env, true, createContextPool())
    const g = p.groupOfUnit[fixture.text.indexOf('1')]!, group = p.groups[g]!
    const gaps = new GapAccumulator(p.text.length)
    measure16({ p, gaps }, g, group.start, group.end, group.start, group.end)
    expect(gaps.snapshot().filter(gap => gap.gap === 'script-context').map(gap => gap.at)).toEqual(fixture.ranges)
  }
})

test('monotonic mapped source units cross each exact script run once', () => {
  const text = 'ب12\uDC00\uDC0134ب'.repeat(512), scripts = scriptsPerUnit(text)
  const p = prepare(paragraph(text), env, false, createContextPool()), reads = partitionReadCount(p)
  const source = new SourceScriptCursor(p.segments!, 0, scripts[0]!)
  asked = []
  for (let k = 0; k < text.length; k++) expect(source.at(k)).toBe(scripts[k]!)
  expect(asked).toEqual([])
  expect(reads()).toBeLessThanOrEqual(2 * text.length)
})

test('Canvas resolves the scripts of each bidi level run of a string alone', () => {
  // `١٢٣` U+2028 U+2060 `[2]` resolves to two left-to-right level runs, the Arabic-Indic digits a level above the rest, and
  // Canvas shapes them as two items: the digits Arabic, the space, U+2060 and `[2]` Common. Over the string whole they
  // would all be Arabic, as the paragraph's own run, whose items of one direction the DOM shapes together, keeps them.
  const s = '١٢٣ ⁠[2]'
  const p = prepare(paragraph(s), env, false, createContextPool())
  expect(Array.from(scriptsPerUnit(s))).toEqual([2, 2, 2, 2, 2, 2, 2, 2])
  expect(Array.from(canvasScriptsPerUnit(p, 0, s, false))).toEqual([2, 2, 2, 0, 0, 0, 0, 0])
  // A string that holds no right-to-left character on a left-to-right context is one item.
  expect(Array.from(canvasScriptsPerUnit(p, 0, 'ab, cd', false))).toEqual(Array.from(scriptsPerUnit('ab, cd')))
})

test("a string that may hold a level of the other direction goes to Canvas inside an override of its group's direction", () => {
  // Under U+202D the paragraph's Arabic is a left-to-right group, which the DOM shapes left to right; Canvas, handed the
  // string alone with U+2060 for the U+202D, would resolve its letters right to left (shape.ts inGroupDirection).
  const overridden = prepare(paragraph('‭بب'), env, false, createContextPool())
  const g = overridden.groupOfUnit[1]!
  expect(overridden.groups[g]!.rtl).toBe(false)
  asked = []
  measure16({ p: overridden, gaps: null }, g, 0, 3, 0, 3)
  expect(asked).toEqual(['‭⁠بب‬'])
  // Wrapped, the digits and `[2]` are one level run, which Canvas resolves as Arabic, as the paragraph does.
  const s = '١٢٣ ⁠[2]'
  const p = prepare(paragraph(s), env, false, createContextPool())
  expect(Array.from(canvasScriptsPerUnit(p, 0, '‭' + s + '‬', false)).slice(1, -1)).toEqual(Array.from(scriptsPerUnit(s)))
  // A left-to-right string without a character of class R, AL or AN, an emoji's included, goes as it is.
  const plain = prepare(paragraph('ab 👍'), env, false, createContextPool())
  asked = []
  measure16({ p: plain, gaps: null }, 0, 0, 5, 0, 5)
  expect(asked).toEqual(['ab 👍'])
})

test('letter spacing is corrected once a glyph cluster, by its first character', () => {
  // The flag's two regional indicators are one cluster, which the DOM keeps in the Arabic run beside it and doesn't space,
  // and which Canvas, measuring the flag alone, shapes as Common and spaces once (ApplySpacingOrExpansion).
  const input = paragraph('ب🇸🇦ب')
  input.letterSpacing = 1.5; input.direction = 'rtl'
  const p = prepare(input, env, false, createContextPool())
  const g = p.groupOfUnit[1]!
  asked = []
  expect(measure16({ p, gaps: null }, g, 1, 5, 1, 5)).toBe(Math.round(4 * .0001 * 65536) - 1.5 * 65536)
})
