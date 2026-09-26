// `bun harness equal <ref> --offline`: whether two builds' src/ give the same results on the invariants' stand-in Canvas
// (invariants.ts), in seconds, before any browser time. cli.ts runs this file once per engine profile, since the library
// reads the profile from the user agent once per process:
//
//   bun harness/offline-equal.ts --profile=blink|webkit|gecko|unknown --a=<src dir> --b=<src dir> [--draws=15000] [--rich=1500]
//     [--bench=none]
//
// Each process loads both builds and gives them the same inputs in the same order, each under its page language:
// seeded draws from harness/cases and the bench's texts. Every 200 inputs it clears both builds' caches. An input differs
// when any field of prepareWithSegments' handle differs, or, at 11 widths, any line API's output, line text included:
// layout(), walkLineRanges, measureLineStats, layoutWithLines, and layoutNextLine, layoutNextLineRange and
// materializeLineRange at a width that changes per line; walkRichInlineLineRanges, materializeRichInlineLineRange,
// measureRichInlineStats and layoutNextRichInlineLineRange for a rich one. It is measured otherwise when its measureText
// calls, in order, differ in font, letter spacing or text. The stand-in's widths also move with each pair of neighbouring
// units, so a text measured whole and in pieces measures differently, and its bounding boxes span its width.
// It prints `{ profile, inputs, differ, parts, measuredOtherwise, calls, units, first, ms }` as JSON: `parts`, the
// inputs each part differs in, and calls and units for each build.
import './watchdog.ts'
import { join, resolve } from 'node:path'
import type { LayoutCursor, PrepareOptions } from '../src/layout.ts'
import type { RichInlineCursor, RichInlineItem } from '../src/rich-inline.ts'
import { labels, MESSAGE_FAMILIES, reader, richItems as benchItems, shapes, STYLE } from './bench/texts.ts'
import { drawCases, PROFILES, standInWidth, type Profile } from './invariants.ts'
import { canvasFont, isRich, prepareOptions, richItems } from './predict.ts'

const flag = (name: string): string | undefined => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const profile = flag('profile') as Profile
if (!(profile in PROFILES)) throw new Error(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`)
const spaced = profile === 'blink' || profile === 'gecko'
// Each build's measureText calls and units, and the calls of the input it is on, in order.
const measured = [0, 1].map(() => ({ calls: 0, units: 0, log: '' }))
let current = measured[0]!
const root = { lang: '' }
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: PROFILES[profile] }, configurable: true })
Object.defineProperty(globalThis, 'document', { value: { documentElement: root, body: null }, configurable: true })
Reflect.set(globalThis, 'OffscreenCanvas', class {
  getContext(): unknown {
    const ctx = {
      font: '10px sans-serif',
      ...(spaced ? { letterSpacing: '0px' } : {}),
      measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
        current.calls++
        current.units += text.length
        current.log += `${ctx.font}\u0001${ctx.letterSpacing ?? ''}\u0001${text}\u0000`
        let width = standInWidth(text, ctx.font, spaced ? Number.parseFloat(ctx.letterSpacing!) : 0)
        for (let i = 1; i < text.length; i++) width -= ((text.charCodeAt(i - 1) * 31 + text.charCodeAt(i)) % 7) / 10
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
      },
    } as { font: string; letterSpacing?: string; measureText: (text: string) => { width: number } }
    return ctx
  }
})

type Api = typeof import('../src/layout.ts') & typeof import('../src/rich-inline.ts')
const load = async (dir: string): Promise<Api> => ({ ...await import(join(dir, 'layout.ts')), ...await import(join(dir, 'rich-inline.ts')) }) as Api
// One module is one build, with its caches, so the two must be copies at two paths.
if (resolve(flag('a')!) === resolve(flag('b')!)) throw new Error('--a and --b name one src/ directory')
const builds = [await load(flag('a')!), await load(flag('b')!)]

type Input = { id: string; lang: string; width: number; text: string; font: string; options: PrepareOptions; items: RichInlineItem[] | null }
const inputs: Input[] = []
const start = performance.now()
for (const c of drawCases(join(import.meta.dir, 'cases'), 'offline-equal', Number(flag('draws') ?? 15000), Number(flag('rich') ?? 1500))) {
  const runs = c.paragraph.runs
  const rich = isRich(runs)
  inputs.push({ id: c.id, lang: c.pageLang, width: c.paragraph.width, text: runs.map(run => run.text).join(''), font: canvasFont(runs[0]!.font), options: rich ? {} : prepareOptions(c), items: rich ? richItems(runs) : null })
}
const bench = (id: string, lang: string, texts: readonly string[], font: string, options: PrepareOptions = {}): void => {
  for (let i = 0; i < texts.length; i++) inputs.push({ id: `${id} ${i}`, lang, width: 320, text: texts[i]!, font, options, items: null })
}
if (flag('bench') !== 'none') {
  for (const shape of shapes()) bench(`bench ${shape.id}`, shape.lang, shape.texts, shape.font, shape.options)
  for (const family of MESSAGE_FAMILIES) bench(`bench ${family}`, STYLE[family].lang, reader(family).batch(20000), STYLE[family].font)
  bench('bench labels', STYLE.labels.lang, labels().slice(0, 3000), STYLE.labels.font)
  for (const [i, text] of reader('latin').batch(20000).entries()) inputs.push({ id: `bench rich ${i}`, lang: 'en', width: 240, text, font: STYLE.latin.font, options: {}, items: benchItems(text, STYLE.latin.font) })
}

// One build's outputs for an input, each part as `<part>: <hash of its JSON>`.
function outputs(api: Api, x: Input): string[] {
  const out: string[] = []
  const part = (name: string, value: unknown): void => { out.push(`${name}: ${Bun.hash(JSON.stringify(value))}`) }
  const steps = x.text.length + 1
  const bounded = (list: unknown[], line: unknown): void => { if (list.push(line) > steps) throw new Error(`more than ${steps} lines`) }
  // An input over 4,000 units, a bench shape's, at its width and Infinity only: a book's lines at width 1 take a GB.
  const widths = x.text.length > 4000 ? [x.width, Infinity] : [0, 1, x.width / 3, x.width / 2, x.width * 0.75, x.width, x.width * 1.5, 37.3, 120, 333, Infinity]
  try {
    if (x.items === null) {
      const handle = api.prepareWithSegments(x.text, x.font, x.options)
      const fast = api.prepare(x.text, x.font, x.options)
      part('prepareWithSegments', handle)
      part('measureNaturalWidth', api.measureNaturalWidth(handle))
      for (const w of widths) {
        const walked: unknown[] = []
        const count = api.walkLineRanges(handle, w, line => bounded(walked, line))
        const stream: unknown[] = []
        for (let cursor: LayoutCursor | undefined = { segmentIndex: 0, graphemeIndex: 0 }, i = 0; cursor !== undefined; i++) {
          const range = api.layoutNextLineRange(handle, cursor, i % 2 === 0 ? w : w * 0.6)
          bounded(stream, [range, api.layoutNextLine(handle, cursor, i % 2 === 0 ? w : w * 0.6), range === null ? null : api.materializeLineRange(handle, range)])
          cursor = range?.end
        }
        part(`lines at ${w}`, [api.layout(fast, w, 20), count, walked, api.measureLineStats(handle, w), api.layoutWithLines(handle, w, 20), stream])
      }
    } else {
      const prepared = api.prepareRichInline(x.items)
      for (const w of widths) {
        const walked: unknown[] = []
        const count = api.walkRichInlineLineRanges(prepared, w, line => bounded(walked, [line, api.materializeRichInlineLineRange(prepared, line)]))
        const stream: unknown[] = []
        for (let cursor: RichInlineCursor | undefined = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }, i = 0; cursor !== undefined; i++) {
          const range = api.layoutNextRichInlineLineRange(prepared, i % 2 === 0 ? w : w * 0.6, cursor)
          bounded(stream, range)
          cursor = range?.end
        }
        part(`rich lines at ${w}`, [count, walked, api.measureRichInlineStats(prepared, w), stream])
      }
    }
  } catch (error) {
    out.push(`threw: ${error instanceof Error ? error.message : String(error)}`)
  }
  return out
}

let differ = 0
let measuredOtherwise = 0
// For each part that differs somewhere, the inputs it differs in.
const parts: Record<string, number> = {}
const first: string[] = []
for (let i = 0; i < inputs.length; i++) {
  const x = inputs[i]!
  // A yield lets the watchdog's clock run, and a collection now and then halves the memory held.
  if (i % 200 === 0) {
    for (let k = 0; k < 2; k++) builds[k]!.clearCache()
    if (i % 2000 === 0) Bun.gc(true)
    await Bun.sleep(0)
  }
  root.lang = x.lang
  const [a, b] = [0, 1].map(k => {
    current = measured[k]!
    current.log = ''
    return outputs(builds[k]!, x)
  }) as [string[], string[]]
  const names = new Set<string>()
  for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) names.add((a[k] ?? b[k]!).split(/:| at /)[0]!)
  if (names.size > 0) {
    differ++
    for (const name of names) parts[name] = (parts[name] ?? 0) + 1
    if (first.length < 10) first.push(`${x.id}: ${[...names].join(', ')} differ`)
  }
  if (measured[0]!.log !== measured[1]!.log) {
    measuredOtherwise++
    if (first.length < 10) first.push(`${x.id}: measured otherwise`)
  }
}
console.log(JSON.stringify({ profile, inputs: inputs.length, differ, parts, measuredOtherwise, calls: measured.map(m => m.calls), units: measured.map(m => m.units), first, ms: Math.round(performance.now() - start) }))
