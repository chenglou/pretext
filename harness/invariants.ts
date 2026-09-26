// What an app relies on in the line APIs that no recording shows, checked offline. `bun test harness` runs it in one
// process per engine profile, since the library reads the profile from the user agent once per process:
//
//   bun harness/invariants.ts --profile=blink|webkit|gecko|unknown [--lib=<src dir>] [--draws=500] [--rich=100]
//
// Each process gives the library a stand-in Canvas: at 16 px a character is 8 px, a space 4, a mark or a format character
// 0, plus the letter spacing per grapheme. The Blink and Gecko processes run under a desktop user agent with a string
// `letterSpacing` on the context, as Chrome's and Firefox's have, so preparation takes the paths those browsers take.
// The inputs are seeded draws from harness/cases (a failure names its case, at its width, half and 1.5 times it, 1 and
// Infinity) and a few fixed ones. The checks:
// - every line API agrees with walkLineRanges (predict.ts's check), and layoutWithLines and layoutNextLine give equal
//   line objects, so a field one of them forgets shows;
// - lines cover the source forward without overlap, at a fixed width and at one that changes per line, and between lines
//   leave only collapsed spaces, a soft hyphen or ZWSP that doesn't break, or a pre-wrap line feed;
// - stepping leaves its start cursor as it was, the ranges a stream gives stay as they were, JSON copies of cursors and
//   ranges resume the same, and a materialized line passed back as a range gives the same line;
// - a visitor that edits the range it's given doesn't change the lines after it;
// - rich lines: a gap is the SPACE advance of the item whose white space made it, sign included; an empty item keeps
//   the other items' indices; a `break: 'never'` item stays whole; each fragment counts its item's extraWidth once;
//   a line is as wide as its fragments' gaps and widths together, or 0 if they add up to less;
// - held handles, and their structuredClone() copies, lay out as before after the same texts are prepared with letter
//   spacing 1, after clearCache() and after setLocale(), and prepares with filled caches equal cold ones, at the held
//   texts' letter spacing and at 1;
// - growth: from 64 to 4,096 units, four times the text takes at most five times the measureText calls and the UTF-16
//   units submitted to them, and every walker ends within a line per unit, plus one, at widths 1, 96 and Infinity,
//   asking Canvas nothing.
// Every walk and stream here stops after a line per source unit, plus one, as a failure, and predict.ts's checks test a
// range before building its text. A walker that never returns is out of this file's reach: watchdog.ts, imported
// first, kills the process past 1 GB, once its parent is gone or once it has run no timer for 30 s, and
// invariants.test.ts gives it 10 s.
// It prints the failures as JSON: `{ profile, cases, failures, counts, ms }`.
import './watchdog.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { LayoutCursor, LayoutLine, LayoutLineRange, PrepareOptions, PreparedText, PreparedTextWithSegments } from '../src/layout.ts'
import type { PreparedRichInline, RichInlineCursor, RichInlineItem, RichInlineLineRange } from '../src/rich-inline.ts'
import { canvasFont, isRich, plainDisagreement, prepareOptions, richDisagreement, richItems, unsupported } from './predict.ts'
import { createRng } from './sets/build.ts'
import type { Case } from './types.ts'

export const PROFILES = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  unknown: '',
} as const
export type Profile = keyof typeof PROFILES
type Api = typeof import('../src/layout.ts') & typeof import('../src/rich-inline.ts')

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function standInWidth(text: string, font: string, letterSpacing: number): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) / 16
  let width = 0
  for (const ch of text) width += /[\p{M}\p{Cf}]/u.test(ch) ? 0 : ch === ' ' ? 4 : 8
  let count = 0
  if (letterSpacing !== 0) for (const _ of graphemes.segment(text)) count++
  return width * size + count * letterSpacing
}

// measureText calls and the UTF-16 units submitted to them.
const measured = { calls: 0, units: 0 }
function installStandIn(profile: Profile): void {
  const spaced = profile === 'blink' || profile === 'gecko'
  const context = (): { font: string; letterSpacing?: string; measureText: (text: string) => { width: number } } => {
    const ctx = {
      font: '10px sans-serif',
      measureText(text: string): { width: number } {
        measured.calls++
        measured.units += text.length
        return { width: standInWidth(text, ctx.font, spaced ? Number.parseFloat(ctx.letterSpacing!) : 0) }
      },
      ...(spaced ? { letterSpacing: '0px' } : {}),
    }
    return ctx
  }
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: PROFILES[profile] }, configurable: true })
  Reflect.set(globalThis, 'OffscreenCanvas', class { getContext(): ReturnType<typeof context> { return context() } })
}

// Seeded draws: `plain` cases from every set but the rich one and `rich` from it, parsing only the lines drawn, and
// leaving out what the library can't express and texts over 4,000 units, which the growth check covers.
export function drawCases(dir: string, seed: string, plain: number, rich: number): Case[] {
  const files = readdirSync(dir).filter(name => name.endsWith('.ndjson')).sort()
  // Each line as its file's bytes and where the line starts; the line ends at the next newline.
  const pools: [Array<[Buffer, number]>, Array<[Buffer, number]>] = [[], []]
  for (let f = 0; f < files.length; f++) {
    const bytes = readFileSync(join(dir, files[f]!))
    const pool = pools[files[f] === 'rich.ndjson' ? 1 : 0]
    for (let at = 0; at < bytes.length; at = bytes.indexOf(10, at) + 1) {
      pool.push([bytes, at])
      if (bytes.indexOf(10, at) < 0) break
    }
  }
  const rng = createRng(seed)
  const out: Case[] = []
  const wanted = [plain, rich]
  for (let k = 0; k < 2; k++) {
    const pool = pools[k]!
    const taken = new Set<number>()
    for (let tries = 0, got = 0; got < wanted[k]! && tries < 20 * wanted[k]!; tries++) {
      const at = rng.int(pool.length)
      if (taken.has(at)) continue
      taken.add(at)
      const [bytes, start] = pool[at]!
      const end = bytes.indexOf(10, start)
      const c = JSON.parse(bytes.toString('utf8', start, end < 0 ? bytes.length : end)) as Case
      let units = 0
      for (let i = 0; i < c.paragraph.runs.length; i++) units += c.paragraph.runs[i]!.text.length
      if (unsupported(c) !== null || units > 4000) continue
      out.push(c)
      got++
    }
  }
  return out
}

type Failures = { list: string[]; counts: Record<string, number> }

export async function runInvariants(profile: Profile, lib: string, draws: { dir: string; seed: string; plain: number; rich: number }): Promise<{ cases: number; failures: Failures }> {
  installStandIn(profile)
  const api = { ...await import(join(lib, 'layout.ts')), ...await import(join(lib, 'rich-inline.ts')) } as Api
  const { findGraphemeEnds } = await import(join(lib, 'graphemes.ts')) as typeof import('../src/graphemes.ts')
  const { getEngineProfile } = await import(join(lib, 'measurement.ts')) as typeof import('../src/measurement.ts')
  const failures: Failures = { list: [], counts: {} }
  const fail = (check: string, label: string, detail: string): void => {
    failures.counts[check] = (failures.counts[check] ?? 0) + 1
    if (failures.list.length < 40) failures.list.push(`${check}: ${label}: ${detail}`)
  }
  const same = (a: unknown, b: unknown): boolean => Bun.deepEquals(a, b, true)
  const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  // A cursor's UTF-16 offset in the prepared text, by the library's own graphemes; -1 for one that names none.
  const offsetsOf = (segments: readonly string[]): ((cursor: LayoutCursor) => number) => {
    const starts: number[] = []
    let total = 0
    for (let i = 0; i < segments.length; i++) {
      starts.push(total)
      total += segments[i]!.length
    }
    const ends: Array<Int32Array | undefined> = []
    return cursor => {
      if (cursor.segmentIndex >= segments.length) return cursor.segmentIndex === segments.length && cursor.graphemeIndex === 0 ? total : -1
      if (cursor.graphemeIndex === 0) return starts[cursor.segmentIndex] ?? -1
      const segment = segments[cursor.segmentIndex]!
      let list = ends[cursor.segmentIndex]
      if (list === undefined) {
        const buffer = new Int32Array(segment.length)
        ends[cursor.segmentIndex] = list = buffer.subarray(0, findGraphemeEnds(getEngineProfile().graphemeTable, segment, 0, segment.length, buffer))
      }
      return cursor.graphemeIndex <= list.length ? starts[cursor.segmentIndex]! + list[cursor.graphemeIndex - 1]! : -1
    }
  }
  // Lines that cover `stream` forward without overlap, leaving between them only what may go unpainted there.
  const covers = (stream: string, spans: ReadonlyArray<[number, number]>, whiteSpace: 'normal' | 'pre-wrap', from = 0): string | null => {
    const unpainted = whiteSpace === 'normal' ? /^[ \u00AD\u200B]*$/ : /^[\n\u00AD\u200B]*$/
    let end = from
    for (let i = 0; i < spans.length; i++) {
      const [s, e] = spans[i]!
      if (s < end || e < s) return `line ${i} covers ${s}-${e} after ${end}`
      if (!unpainted.test(stream.slice(end, s))) return `line ${i} leaves ${JSON.stringify(stream.slice(end, s))} unpainted`
      end = e
    }
    return unpainted.test(stream.slice(end)) ? null : `${JSON.stringify(stream.slice(end))} after the last line is unpainted`
  }

  const START: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  const plain = (label: string, prepared: PreparedTextWithSegments, fast: PreparedText, whiteSpace: 'normal' | 'pre-wrap', width: number, lineHeight: number): void => {
    const at = `${label} at ${width}`
    const steps = prepared.segments.join('').length + 1
    const calls = measured.calls
    try {
      const walked: LayoutLineRange[] = []
      const count = api.walkLineRanges(prepared, width, line => { if (walked.push(line) > steps) throw new Error(`walkLineRanges gives more than ${steps} lines`) })
      const disagreement = plainDisagreement(api, prepared, api.layout(fast, width, lineHeight), walked, count, width, lineHeight, steps)
      if (disagreement !== null) return fail('agreement', at, disagreement)
      const batch = api.layoutWithLines(prepared, width, lineHeight).lines
      const offset = offsetsOf(prepared.segments)
      const stream = prepared.segments.join('')
      const spans = (lines: readonly LayoutLineRange[]): Array<[number, number]> => lines.map(line => [offset(line.start), offset(line.end)])
      const coverage = covers(stream, spans(batch), whiteSpace)
      if (coverage !== null) fail('coverage', at, coverage)
      let cursor = { ...START }
      const streamed: LayoutLineRange[] = []
      for (let i = 0; ; i++) {
        const before = { ...cursor }
        const line = api.layoutNextLine(prepared, cursor, width)
        if (!same(cursor, before)) fail('cursors', at, `layoutNextLine moved its start cursor to ${JSON.stringify(cursor)}`)
        const range = api.layoutNextLineRange(prepared, before, width)
        if (line === null || range === null) {
          if (api.layoutNextLine(prepared, json(before), width) !== null) fail('cursors', at, 'a JSON copy of the end cursor starts the text again')
          break
        }
        if (i >= steps) return fail('walkers end', at, `layoutNextLine gives more than ${steps} lines`)
        streamed.push(range)
        if (!same(line, batch[i])) fail('line objects', at, `layoutNextLine line ${i} is ${JSON.stringify(line)}; layoutWithLines' ${JSON.stringify(batch[i])}`)
        if (!same(api.layoutNextLine(prepared, json(before), width), line)) fail('cursors', at, `a JSON copy of the cursor before line ${i} resumes otherwise`)
        if (!same(api.materializeLineRange(prepared, json(range)), line)) fail('cursors', at, `a JSON copy of range ${i} materializes otherwise`)
        if (!same(api.materializeLineRange(prepared, line), line)) fail('round trip', at, `line ${i} passed back as a range gives another line`)
        cursor = { ...line.end }
      }
      // A virtualized list keeps the ranges it streamed.
      for (let i = 0; i < streamed.length; i++) {
        const line = batch[i]
        if (line === undefined || !same(streamed[i], { width: line.width, start: line.start, end: line.end })) {
          fail('cursors', at, `after the stream, the range layoutNextLineRange gave for line ${i} is ${JSON.stringify(streamed[i])}`)
          break
        }
      }
      // Streamed at a width that changes per line, as around a float.
      const varied: LayoutLine[] = []
      const widths = [width, Math.max(1, width / 2), width * 1.5]
      for (let line = api.layoutNextLine(prepared, START, width); line !== null; line = api.layoutNextLine(prepared, line.end, widths[varied.length % 3]!)) {
        if (varied.push(line) > steps) return fail('walkers end', at, `layoutNextLine gives more than ${steps} lines at changing widths`)
      }
      const variedCoverage = covers(stream, spans(varied), whiteSpace)
      if (variedCoverage !== null) fail('coverage', `${at} changing per line`, variedCoverage)
      const visited: LayoutLineRange[] = []
      api.walkLineRanges(prepared, width, range => {
        if (visited.push(structuredClone(range)) > steps) throw new Error(`walkLineRanges gives more than ${steps} lines after its visitor edits them`)
        range.start.segmentIndex = range.end.segmentIndex = Number.MAX_SAFE_INTEGER
        range.end.graphemeIndex = 1
        range.width = -1
      })
      for (let i = 0; i < Math.max(visited.length, batch.length); i++) {
        const line = batch[i]
        if (line === undefined || !same(visited[i], { width: line.width, start: line.start, end: line.end })) {
          fail('visitors', at, `after a visitor edits the range it's given, line ${i} is ${JSON.stringify(visited[i])}`)
          break
        }
      }
    } catch (error) {
      fail('walkers end', at, error instanceof Error ? error.message : String(error))
    } finally {
      if (measured.calls !== calls) fail('no Canvas after preparing', at, `${measured.calls - calls} measureText calls`)
    }
  }

  const rich = (label: string, items: RichInlineItem[], width: number): void => {
    const at = `${label} at ${width}`
    // Everything prepared first, so what follows asks Canvas nothing: the paragraph, each item alone (whose own
    // prepared text the fragments' cursors index), the paragraph after an empty item, and without extraWidth.
    const prepared = api.prepareRichInline(items)
    const handles = items.map(item => api.prepareWithSegments(item.text, item.font, item.letterSpacing === undefined ? {} : { letterSpacing: item.letterSpacing }))
    const shiftedPrepared = api.prepareRichInline([{ text: '', font: items[0]!.font }, ...items])
    const extra = items.some(item => (item.extraWidth ?? 0) !== 0)
    const withoutExtra = extra ? api.prepareRichInline(items.map(({ extraWidth: _, ...rest }) => rest)) : null
    const steps = items.reduce((sum, item) => sum + item.text.length, 0) + 1
    const walk = (p: PreparedRichInline, w: number): RichInlineLineRange[] => {
      const lines: RichInlineLineRange[] = []
      api.walkRichInlineLineRanges(p, w, line => { if (lines.push(line) > steps) throw new Error(`walkRichInlineLineRanges gives more than ${steps} lines`) })
      return lines
    }
    const calls = measured.calls
    try {
      const walked: RichInlineLineRange[] = []
      const count = api.walkRichInlineLineRanges(prepared, width, line => { if (walked.push(line) > steps) throw new Error(`walkRichInlineLineRanges gives more than ${steps} lines`) })
      const disagreement = richDisagreement(api, prepared, walked, count, width, steps, i => handles[i]?.segments.length ?? -1)
      if (disagreement !== null) return fail('agreement', at, disagreement)
      const lines: RichInlineLineRange[] = []
      let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 }
      for (let i = 0; ; i++) {
        const before = { ...cursor }
        const range = api.layoutNextRichInlineLineRange(prepared, width, cursor)
        if (!same(cursor, before)) fail('cursors', at, `layoutNextRichInlineLineRange moved its start cursor to ${JSON.stringify(cursor)}`)
        if (range === null) {
          if (api.layoutNextRichInlineLineRange(prepared, width, json(before)) !== null) fail('cursors', at, 'a JSON copy of the rich end cursor starts the text again')
          break
        }
        if (i >= steps) return fail('walkers end', at, `layoutNextRichInlineLineRange gives more than ${steps} lines`)
        if (!same(api.layoutNextRichInlineLineRange(prepared, width, json(before)), range)) fail('cursors', at, `a JSON copy of the cursor before rich line ${i} resumes otherwise`)
        const line = api.materializeRichInlineLineRange(prepared, range)
        if (!same(api.materializeRichInlineLineRange(prepared, json(range)), line)) fail('cursors', at, `a JSON copy of rich range ${i} materializes otherwise`)
        if (!same(api.materializeRichInlineLineRange(prepared, line), line)) fail('round trip', at, `rich line ${i} passed back as a range gives another line`)
        lines.push(range)
        cursor = { ...range.end }
      }
      // Each item's fragments cover its own prepared text.
      const offsets = handles.map(handle => offsetsOf(handle.segments))
      const spans: Array<Array<[number, number]>> = items.map(() => [])
      const whole = items.map(() => 0)
      for (let i = 0; i < lines.length; i++) {
        let occupied = 0
        for (const f of lines[i]!.fragments) {
          occupied += f.gapBefore + f.occupiedWidth
          spans[f.itemIndex]!.push([offsets[f.itemIndex]!(f.start), offsets[f.itemIndex]!(f.end)])
          if (f.gapItemIndex >= 0) {
            const gapItem = items[f.gapItemIndex]!
            const space = standInWidth(' ', gapItem.font, gapItem.letterSpacing ?? 0)
            if (Math.abs(f.gapBefore - space) > 1e-6) fail('rich lines', at, `line ${i}'s gap before item ${f.itemIndex} is ${f.gapBefore}; item ${f.gapItemIndex}'s SPACE is ${space}`)
          }
          const segments = handles[f.itemIndex]!.segments.length
          if (items[f.itemIndex]!.break === 'never' && segments > 0) {
            whole[f.itemIndex]!++
            if (!same(f.start, START) || !same(f.end, { segmentIndex: segments, graphemeIndex: 0 })) fail('rich lines', at, `atomic item ${f.itemIndex} is split at ${JSON.stringify(f.start)}-${JSON.stringify(f.end)}`)
          }
        }
        if (Math.abs(lines[i]!.width - Math.max(0, occupied)) > 1e-6) fail('rich lines', at, `line ${i} is ${lines[i]!.width} wide; its fragments' gaps and widths add up to ${occupied}`)
      }
      for (let k = 0; k < items.length; k++) {
        const coverage = covers(handles[k]!.segments.join(''), spans[k]!, 'normal')
        if (coverage !== null) fail('coverage', `${at}, item ${k}`, coverage)
        if (items[k]!.break === 'never' && handles[k]!.segments.length > 0 && whole[k] !== 1) fail('rich lines', at, `atomic item ${k} is in ${whole[k]} fragments`)
      }
      const visited: RichInlineLineRange[] = []
      api.walkRichInlineLineRanges(prepared, width, range => {
        if (visited.push(structuredClone(range)) > steps) throw new Error(`walkRichInlineLineRanges gives more than ${steps} lines after its visitor edits them`)
        range.fragments.length = 0
        range.end.itemIndex = range.end.segmentIndex = Number.MAX_SAFE_INTEGER
        range.width = -1
      })
      if (!same(visited, lines)) fail('visitors', at, 'a visitor that edits the rich range it\'s given changes the lines after it')
      // An empty item first moves every index by one and changes nothing else.
      const shifted = walk(shiftedPrepared, width)
      const expected = lines.map(line => ({
        ...line, end: { ...line.end, itemIndex: line.end.itemIndex + 1 },
        fragments: line.fragments.map(f => ({ ...f, itemIndex: f.itemIndex + 1, gapItemIndex: f.gapItemIndex < 0 ? f.gapItemIndex : f.gapItemIndex + 1 })),
      }))
      if (!same(shifted, expected)) fail('rich lines', at, `an empty first item gives ${JSON.stringify(shifted[0])} for line 0, not ${JSON.stringify(expected[0])}`)
      // On one line, each fragment is its text's width plus its item's extraWidth, once.
      if (withoutExtra !== null) {
        const withExtra = walk(prepared, Infinity)
        const without = walk(withoutExtra, Infinity)
        const a = withExtra.flatMap(line => line.fragments)
        const b = without.flatMap(line => line.fragments)
        for (let k = 0; k < Math.max(a.length, b.length); k++) {
          const extraWidth = items[a[k]?.itemIndex ?? 0]!.extraWidth ?? 0
          if (a[k] === undefined || b[k] === undefined || Math.abs(a[k]!.occupiedWidth - extraWidth - b[k]!.occupiedWidth) > 1e-6) {
            fail('rich lines', label, `fragment ${k} occupies ${a[k]?.occupiedWidth} with extraWidth ${extraWidth}, ${b[k]?.occupiedWidth} without`)
            break
          }
        }
      }
    } catch (error) {
      fail('walkers end', at, error instanceof Error ? error.message : String(error))
    } finally {
      if (measured.calls !== calls) fail('no Canvas after preparing', at, `${measured.calls - calls} measureText calls`)
    }
  }

  // ---- The drawn cases, and the fixed inputs ----
  const cases = drawCases(draws.dir, draws.seed, draws.plain, draws.rich)
  type Held = { label: string; text: string; font: string; options: PrepareOptions; widths: number[]; handle: PreparedTextWithSegments; copy: PreparedTextWithSegments; fast: PreparedText; laidOut: string }
  // Held handles: the first drawn cases' and the fixed inputs'.
  const HELD = 120
  const held: Held[] = []
  const layOut = (h: { handle: PreparedTextWithSegments; fast: PreparedText; widths: number[] }): string => {
    const out = JSON.stringify(h.widths.map(w => [api.layout(h.fast, w, 20), api.layoutWithLines(h.handle, w, 20).lines]))
    return out
  }
  const plainInput = (label: string, text: string, font: string, options: PrepareOptions, width: number, lineHeight: number): void => {
    const handle = api.prepareWithSegments(text, font, options)
    const fast = api.prepare(text, font, options)
    const widths = [width, Math.max(1, width / 2), width * 1.5, 1, Infinity]
    for (let i = 0; i < widths.length; i++) plain(label, handle, fast, options.whiteSpace ?? 'normal', widths[i]!, lineHeight)
    if (held.length >= HELD && !label.startsWith('fixed')) return
    const h = { label, text, font, options, widths: [width, 1], handle, copy: structuredClone(handle), fast }
    held.push({ ...h, laidOut: layOut(h) })
  }
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!
    const p = c.paragraph
    if (isRich(p.runs)) {
      const items = richItems(p.runs)
      for (const width of [p.width, Math.max(1, p.width / 2), p.width * 1.5, 1, Infinity]) rich(c.id, items, width)
    } else {
      plainInput(c.id, p.runs.map(run => run.text).join(''), canvasFont(p.runs[0]!.font), prepareOptions(c), p.width, p.lineHeight)
    }
  }
  const FONT = '16px Test'
  // A mark after a word joiner, where Chrome and Firefox measure a fresh line's first graphemes apart (entry geometry).
  plainInput('fixed a WJ U+0301 bc', 'a\u2060\u0301bc ', FONT, { letterSpacing: -1 }, 27, 20)
  plainInput('fixed a WJ U+0301 bc x16', 'a\u2060\u0301bc '.repeat(16), FONT, { letterSpacing: -1 }, 27, 20)
  // A SPACE is 4px here: the gap's sign changes at letter spacing -4.
  for (const letterSpacing of [-10, -4.1, -4, -3.9, 0, 2]) rich(`fixed a gap at letter spacing ${letterSpacing}`, [{ text: 'x ', font: FONT, letterSpacing }, { text: 'y', font: FONT, letterSpacing }], Infinity)
  rich('fixed empty and blank items', ['', 'AB', ' ', 'CD', ''].map(text => ({ text, font: FONT })), 16.1)
  rich('fixed one item a line', ['A', 'B', 'C'].map(text => ({ text, font: FONT })), 8.1)
  const pill: RichInlineItem = { text: 'ABCD', font: FONT, break: 'never', extraWidth: 18 }
  rich('fixed a pill alone', [pill], 1)
  rich('fixed a pill between letters', [{ text: 'A', font: FONT }, pill, { text: 'B', font: FONT }], 50)

  // ---- Held handles ----
  const recheck = (after: string): void => {
    for (let i = 0; i < held.length; i++) {
      const h = held[i]!
      if (layOut(h) !== h.laidOut) fail('held handles', h.label, `lays out otherwise after ${after}`)
      if (layOut({ ...h, handle: h.copy }) !== h.laidOut) fail('held handles', h.label, `its structuredClone() copy lays out otherwise after ${after}`)
    }
  }
  // The same texts at letter spacing 1, prepared while the caches hold the others, and laid out against cold prepares.
  const spaced = held.map(h => {
    const options = { ...h.options, letterSpacing: 1 }
    const laidOut = layOut({ handle: api.prepareWithSegments(h.text, h.font, options), fast: api.prepare(h.text, h.font, options), widths: h.widths })
    return { label: `${h.label} at letter spacing 1`, text: h.text, font: h.font, options, widths: h.widths, laidOut }
  })
  recheck('the same texts are prepared with letter spacing 1')
  const fresh = (list: ReadonlyArray<Omit<Held, 'handle' | 'copy' | 'fast'>>, detail: string): void => {
    for (let i = 0; i < list.length; i++) {
      const h = list[i]!
      const handle = api.prepareWithSegments(h.text, h.font, h.options)
      if (layOut({ handle, fast: api.prepare(h.text, h.font, h.options), widths: h.widths }) !== h.laidOut) fail('held handles', h.label, detail)
    }
  }
  fresh(held, 'a prepare with filled caches lays out otherwise')
  api.clearCache()
  recheck('clearCache()')
  fresh(held, 'a prepare after clearCache() lays out otherwise')
  api.clearCache()
  fresh(spaced, 'a cold prepare lays out otherwise than one made while the caches held the text at other letter spacing')
  api.setLocale('ar')
  recheck('setLocale()')
  api.setLocale(undefined)

  // ---- Growth ----
  const recipes: ReadonlyArray<readonly [string, (n: number) => string, 'normal' | 'pre-wrap']> = [
    ['latin-url', n => `https://example.com/${'alpha-b/'.repeat(n)}?q=end`, 'normal'],
    ['arabic-openers', n => '\u0628\u0650\u0628\u0650((tail '.repeat(n), 'normal'],
    ['cjk-openers', n => '\u300C\u300Ctail \u4E16\u754C '.repeat(n), 'normal'],
    ['controls', n => 'alpha\u00ADbeta\u200Bgamma '.repeat(n), 'normal'],
    ['entry-controls', n => 'a\u2060\u0301bc '.repeat(n), 'normal'],
    ['long-word', n => 'abcdefghij'.repeat(n), 'normal'],
    ['long-grapheme', n => `a${'\u0301'.repeat(n)}`.repeat(8), 'normal'],
    ['tabs', n => 'a\t\t\u200Bb\n'.repeat(n), 'pre-wrap'],
    ['soft-hyphens', n => 'co\u00ADop\u00ADer\u00ADa\u00ADtion'.repeat(n), 'normal'],
    ['soft-hyphens-with-marks', n => 'nai\u0308\u00ADve\u0301 '.repeat(n), 'normal'],
    ['marks', n => 'e\u0301\u0323x\u0308 '.repeat(n), 'normal'],
    ['control-characters', n => 'ab\u0001cd\u0007 \u0085ef '.repeat(n), 'normal'],
    ['control-characters-pre-wrap', n => 'ab\u0001\tcd\u0007\n'.repeat(n), 'pre-wrap'],
  ]
  for (let r = 0; r < recipes.length; r++) {
    const [name, make, whiteSpace] = recipes[r]!
    const one = make(1).length
    const slope = make(2).length - one
    for (const letterSpacing of [0, 1]) {
      let previous: { calls: number; units: number; length: number } | null = null
      for (const target of [64, 256, 1024, 4096]) {
        const text = make(Math.max(1, Math.ceil((target - one + slope) / slope)))
        const options: PrepareOptions = { whiteSpace, letterSpacing }
        const label = `${name} (${text.length} units, letter spacing ${letterSpacing})`
        api.clearCache()
        const calls = measured.calls
        const units = measured.units
        const handle = api.prepareWithSegments(text, FONT, options)
        const fast = api.prepare(text, FONT, options)
        const richHandle = whiteSpace === 'normal' ? api.prepareRichInline([{ text, font: FONT, letterSpacing }]) : null
        const now = { calls: measured.calls - calls, units: measured.units - units, length: text.length }
        if (previous !== null && (now.calls > 5 * Math.max(1, previous.calls) || now.units > 5 * Math.max(1, previous.units))) {
          fail('growth', label, `${now.calls} measureText calls on ${now.units} units, from ${previous.calls} on ${previous.units} at ${previous.length} units`)
        }
        previous = now
        const before = measured.calls
        const most = text.length + 1
        for (const width of [1, 96, Infinity]) {
          let lines = 0
          try {
            if (api.layout(fast, width, 20).lineCount > most) fail('walkers end', label, `layout() gives more than ${most} lines at ${width}`)
            if (api.measureLineStats(handle, width).lineCount > most) fail('walkers end', label, `measureLineStats gives more than ${most} lines at ${width}`)
            api.walkLineRanges(handle, width, () => { if (++lines > most) throw new Error(`walkLineRanges gives more than ${most} lines at ${width}`) })
            lines = 0
            for (let range = api.layoutNextLineRange(handle, START, width); range !== null; range = api.layoutNextLineRange(handle, range.end, width)) {
              if (++lines > most) throw new Error(`layoutNextLineRange gives more than ${most} lines at ${width}`)
            }
            lines = 0
            if (richHandle !== null) api.walkRichInlineLineRanges(richHandle, width, () => { if (++lines > most) throw new Error(`walkRichInlineLineRanges gives more than ${most} lines at ${width}`) })
          } catch (error) {
            fail('walkers end', label, error instanceof Error ? error.message : String(error))
          }
        }
        if (measured.calls !== before) fail('no Canvas after preparing', label, `${measured.calls - before} measureText calls`)
      }
    }
  }
  return { cases: cases.length, failures }
}

if (import.meta.main) {
  const flag = (name: string): string | undefined => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const profile = (flag('profile') ?? 'blink') as Profile
  if (!(profile in PROFILES)) throw new Error(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`)
  const start = performance.now()
  const result = await runInvariants(profile, resolve(flag('lib') ?? join(import.meta.dir, '../src')), {
    dir: join(import.meta.dir, 'cases'), seed: flag('seed') ?? 'invariants', plain: Number(flag('draws') ?? 500), rich: Number(flag('rich') ?? 100),
  })
  console.log(JSON.stringify({ profile, cases: result.cases, failures: result.failures.list, counts: result.failures.counts, ms: Math.round(performance.now() - start) }))
}
