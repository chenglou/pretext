// What an app relies on in the line APIs that no recording shows, checked offline. `bun test harness` runs it in one
// process per engine profile, since the library reads the profile from the user agent once per process:
//
//   bun harness/invariants.ts --profile=blink|webkit|gecko|unknown [--lib=<src dir>] [--draws=500|all] [--rich=100|all]
//
// Each process gives the library a stand-in Canvas: at 16 px a character is 8 px, a space 4, a mark or a format character
// 0, plus the letter spacing per grapheme. U+2028 measures as the space, whose glyph Chrome draws it with, and sits 0,
// 0.5 or 1 px closer to the character on either side of it unless the context's `fontKerning` is 'none', so the
// Chromium profile finds every font kerning the space and takes its kerning with spaces (getFontSpaceKerning and
// getSpaceKerning in src/measurement.ts). Two neighbouring characters of 8 px each, so neither a space, U+2028, a mark
// nor a format character, sit 0 to 0.6 px closer: for six of every seven pairs that is kerning, and for the seventh a
// ligature, off under any letter spacing, so a word doesn't measure as its letters do alone and the fits of a word cut
// between letters take the paths they take in a font (getSegmentFit). Nothing in src/ measures two such neighbours
// under `fontKerning` 'none', so that kerning doesn't read it. The Blink and Gecko processes run under a desktop user
// agent with a string `letterSpacing` on the context, as Chrome's and Firefox's have, so preparation takes the paths
// those browsers take.
// The inputs are seeded draws from harness/cases (a failure names its case, at its width, half and 1.5 times it, 1 and
// Infinity) and a few fixed ones; `bun harness gate` runs its browser's profile over every case (`all`), 20-25 s of
// processor time a profile at a load average of 30-60: in 500 draws, five WebKit-profile cases that failed the coverage
// check had about a 4% chance to be drawn.
// The checks:
// - every line API agrees with walkLineRanges (predict.ts's check), and layoutWithLines and layoutNextLine give equal
//   line objects, so a field one of them forgets shows;
// - lines cover the source forward without overlap, at a fixed width and at one that changes per line, and between lines
//   leave only collapsed spaces, a soft hyphen or ZWSP that doesn't break, a pre-wrap line feed, in Safari a U+2028 or
//   U+2029, or in Firefox a bidi control;
// - stepping leaves its start cursor as it was, the ranges a stream gives stay as they were, JSON copies of cursors and
//   ranges resume the same, and a text's materialized line passed back as a range gives the same line (a rich one's
//   type is no range's, its fragments having no cursors: an app passes its range back);
// - a visitor that edits the range it's given doesn't change the lines after it;
// - rich lines: a gap is the SPACE advance of the item whose white space made it, sign included, or in the Chromium
//   profile that less its kerning with the character beside it in that item, and never a box's; white space between
//   two fragments on a line makes a gap, but where a line feed lies between them or, in Firefox, where it joins a run
//   of white space (joinsWhiteSpaceRun), or where it is only what the profile takes out; an empty item keeps the other
//   items' indices; a `break: 'never'` item and a box stay whole; each fragment counts its item's extraWidth once; a
//   line is as wide as its fragments' gaps and widths together, or 0 if they add up to less; pre-wrap makes no gaps;
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
import type { PreparedRichInline, RichInlineBox, RichInlineCursor, RichInlineFragment, RichInlineItem, RichInlineLineRange, RichInlineOptions } from '../src/rich-inline.ts'
import { canvasFont, cursorOffsets, fragmentProblem, plainDisagreement, prepareOptions, richDisagreement, richItems, richOptions, unsupported } from './predict.ts'
import { createRng } from './sets/build.ts'
import { isRich, type Case } from './types.ts'

// Of a user agent the library reads the engine and whether it is a desktop browser's, never the browser's version
// (getLayoutEngine() and buildEngineProfile() in src/measurement.ts), so these don't follow harness/pins.json.
export const PROFILES = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
  unknown: '',
} as const
export type Profile = keyof typeof PROFILES
type Api = typeof import('../src/layout.ts') & typeof import('../src/rich-inline.ts')

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function standInWidth(text: string, font: string, letterSpacing: number, fontKerning: string): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) / 16
  let width = 0
  let previous = -1
  let previousAdvance = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    const advance = /[\p{M}\p{Cf}]/u.test(ch) ? 0 : code === 0x20 || code === 0x2028 ? 4 : 8
    width += advance
    if (fontKerning !== 'none' && previous >= 0 && (code === 0x2028) !== (previous === 0x2028)) width -= (code === 0x2028 ? previous : code) % 3 / 2
    if (advance === 8 && previousAdvance === 8) {
      const together = (previous * 31 + code) % 7
      if (together !== 6 || letterSpacing === 0) width -= together / 10
    }
    previous = code
    previousAdvance = advance
  }
  let count = 0
  // A spacing under Blink's unit, 1/65536 px, adds nothing in Chrome or Firefox, whose unit is 1/60 px: the library
  // measures letter-spaced text under such a spacing (LETTER_SPACED_SHAPING in src/measurement.ts).
  if (Math.abs(letterSpacing) >= 1 / 65536) for (const _ of graphemes.segment(text)) count++
  return width * size + count * letterSpacing
}

// measureText calls and the UTF-16 units submitted to them.
const measured = { calls: 0, units: 0 }
function installStandIn(profile: Profile): void {
  const spaced = profile === 'blink' || profile === 'gecko'
  const context = (): { font: string; fontKerning: string; letterSpacing?: string; measureText: (text: string) => { width: number } } => {
    const ctx = {
      font: '10px sans-serif',
      fontKerning: 'auto',
      measureText(text: string): { width: number } {
        measured.calls++
        measured.units += text.length
        return { width: standInWidth(text, ctx.font, spaced ? Number.parseFloat(ctx.letterSpacing!) : 0, ctx.fontKerning) }
      },
      ...(spaced ? { letterSpacing: '0px' } : {}),
    }
    return ctx
  }
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: PROFILES[profile] }, configurable: true })
  Reflect.set(globalThis, 'OffscreenCanvas', class { getContext(): ReturnType<typeof context> { return context() } })
}

// Seeded draws: `plain` cases from every set but the rich one and `rich` from it, parsing only the lines drawn, and
// leaving out what the library can't express and texts over 4,000 units, which the growth check covers. A count of
// Infinity takes every case, in the files' order, one at a time: all of them parsed at once hold 250 MB.
export function drawCases(dir: string, seed: string, plain: number, rich: number): Case[] {
  return [...drawnCases(dir, seed, plain, rich)]
}

function* drawnCases(dir: string, seed: string, plain: number, rich: number): Generator<Case> {
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
  const wanted = [plain, rich]
  for (let k = 0; k < 2; k++) {
    const pool = pools[k]!
    const every = wanted[k] === Infinity
    const taken = new Set<number>()
    for (let tries = 0, got = 0; got < wanted[k]! && tries < (every ? pool.length : 20 * wanted[k]!); tries++) {
      const at = every ? tries : rng.int(pool.length)
      if (taken.has(at)) continue
      taken.add(at)
      const [bytes, start] = pool[at]!
      const end = bytes.indexOf(10, start)
      const c = JSON.parse(bytes.toString('utf8', start, end < 0 ? bytes.length : end)) as Case
      let units = 0
      for (let i = 0; i < c.paragraph.runs.length; i++) units += c.paragraph.runs[i]!.text.length
      if (unsupported(c) !== null || units > 4000) continue
      yield c
      got++
    }
  }
}

// The first item whose collapsible white space lies between two fragments that follow each other on a line, in the
// items' texts: after the earlier fragment's text in its item, in an item between the two, or before the later one's
// text in its item; -1 without any, and where a line feed lies between them, which the segment break transformation
// can remove with the white space around it, as next to a ZWSP. An atomic item's own white space is none of the
// paragraph's. What the profile's analysis takes out of the text with nothing in its place is no white space either: a
// CR or FF in the Gecko profile, a CR in the WebKit profile. A CR before a line feed never gets this far, since a line
// feed between the fragments ends the search.
function whiteSpaceBetween(items: ReadonlyArray<RichInlineItem | RichInlineBox>, earlier: RichInlineFragment, later: RichInlineFragment, removed: RegExp | null): number {
  let holder = -1
  for (let index = earlier.itemIndex; index <= later.itemIndex; index++) {
    const item = items[index]!
    if (item.text === undefined || item.break === 'never') continue
    const text = item.text.slice(index === earlier.itemIndex ? earlier.sourceEnd : 0, index === later.itemIndex ? later.sourceStart : item.text.length)
    if (text.includes('\n')) return -1
    if (holder < 0 && COLLAPSIBLE.test(removed === null ? text : text.replace(removed, ''))) holder = index
  }
  return holder
}

// Whether the white space of item `gapItem` that lies before item `after` joins a run of white space in Firefox, where
// it takes no room and makes no gap. Firefox drops soft hyphens and bidi controls before it collapses white space, so
// white space collapses into a space or tab or line feed before it with only those characters between them, in one
// item or from the end of one into the start of the next with text; an atomic item and a box end the run
// (transformText in src/gecko-line-breaks.ts). That white space is the item's leading white space where it is before
// the item's own text, all of an item of only white space, and else its trailing white space, which starts after the
// last character that is neither white space nor a bidi control.
const COLLAPSIBLE = /[ \t\n\r\f]/
const COLLAPSIBLE_OR_BIDI_CONTROL = /[ \t\n\r\f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/
function joinsWhiteSpaceRun(items: ReadonlyArray<RichInlineItem | RichInlineBox>, gapItem: number, after: number): boolean {
  const text = items[gapItem]!.text!
  let leading = 0
  while (leading < text.length && COLLAPSIBLE.test(text[leading]!)) leading++
  let start = 0
  if (gapItem !== after && leading < text.length) {
    start = text.length
    for (let i = text.length - 1; i >= leading && COLLAPSIBLE_OR_BIDI_CONTROL.test(text[i]!); i--) if (COLLAPSIBLE.test(text[i]!)) start = i
  }
  let before = text.slice(0, start)
  for (let i = gapItem - 1; start === 0 && before === '' && i >= 0; i--) {
    const item = items[i]!
    if (item.text === undefined || item.break === 'never') return false
    before = item.text
  }
  return /[ \t\n][\u00AD\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]+$/.test(before)
}

type Failures = { list: string[]; counts: Record<string, number> }

export async function runInvariants(profile: Profile, lib: string, draws: { dir: string; seed: string; plain: number; rich: number }): Promise<{ cases: number; failures: Failures }> {
  installStandIn(profile)
  const api = { ...await import(join(lib, 'layout.ts')), ...await import(join(lib, 'rich-inline.ts')) } as Api
  const failures: Failures = { list: [], counts: {} }
  const fail = (check: string, label: string, detail: string): void => {
    failures.counts[check] = (failures.counts[check] ?? 0) + 1
    if (failures.list.length < 40) failures.list.push(`${check}: ${label}: ${detail}`)
  }
  const same = (a: unknown, b: unknown): boolean => Bun.deepEquals(a, b, true)
  const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  // Lines that cover `stream` forward without overlap, leaving between them only what may go unpainted there: in
  // Firefox bidi controls too, which it leaves out of its text runs, and in WebKit a U+2028 or U+2029, which its scan
  // makes a hard break in normal white space as a line feed is one in pre-wrap.
  const gecko = profile === 'gecko'
  const removed = gecko ? /[\r\f]/g : profile === 'webkit' ? /\r/g : null
  const unpaintedNormal = gecko ? /^[ \u00AD\u200B\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]*$/ : profile === 'webkit' ? /^[ \u00AD\u200B\u2028\u2029]*$/ : /^[ \u00AD\u200B]*$/
  const unpaintedPreWrap = gecko ? /^[\n\u00AD\u200B\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]*$/ : /^[\n\u00AD\u200B]*$/
  // The same in a rich item's own text, which white space hasn't been normalized in.
  const unpaintedSourceNormal = gecko ? /^[ \t\n\r\f\u00AD\u200B\u2028\u2029\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]*$/ : /^[ \t\n\r\f\u00AD\u200B\u2028\u2029]*$/
  const unpaintedSourcePreWrap = gecko ? /^[\n\r\f\u00AD\u200B\u2028\u2029\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]*$/ : /^[\n\r\f\u00AD\u200B\u2028\u2029]*$/
  const covers = (stream: string, spans: ReadonlyArray<[number, number]>, whiteSpace: 'normal' | 'pre-wrap', from = 0, source = false): string | null => {
    const unpainted = source ? (whiteSpace === 'normal' ? unpaintedSourceNormal : unpaintedSourcePreWrap) : whiteSpace === 'normal' ? unpaintedNormal : unpaintedPreWrap
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
      const offset = cursorOffsets(prepared.segments)
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

  const rich = (label: string, items: Array<RichInlineItem | RichInlineBox>, width: number, options: RichInlineOptions = {}): void => {
    const at = `${label} at ${width}`
    // Everything prepared first, so what follows asks Canvas nothing: the paragraph, the paragraph after an empty
    // item, and without extraWidth.
    const prepared = api.prepareRichInline(items, options)
    const whiteSpace = options.whiteSpace ?? 'normal'
    const atomic = items.map(item => item.text !== undefined && item.text !== '' && item.break === 'never')
    const shiftedPrepared = api.prepareRichInline([{ text: '', font: '16px Test' }, ...items], options)
    const extraOf = (item: RichInlineItem | RichInlineBox): number => item.text === undefined ? 0 : item.extraWidth ?? 0
    const extra = items.some(item => extraOf(item) !== 0)
    const withoutExtra = extra ? api.prepareRichInline(items.map(item => item.text === undefined ? item : { ...item, extraWidth: 0 }), options) : null
    let steps = 1
    for (let i = 0; i < items.length; i++) steps += items[i]!.text?.length ?? 1
    const walk = (p: PreparedRichInline, w: number): RichInlineLineRange[] => {
      const lines: RichInlineLineRange[] = []
      api.walkRichInlineLineRanges(p, w, line => { if (lines.push(line) > steps) throw new Error(`walkRichInlineLineRanges gives more than ${steps} lines`) })
      return lines
    }
    const calls = measured.calls
    try {
      const walked: RichInlineLineRange[] = []
      const count = api.walkRichInlineLineRanges(prepared, width, line => { if (walked.push(line) > steps) throw new Error(`walkRichInlineLineRanges gives more than ${steps} lines`) })
      const disagreement = richDisagreement(api, prepared, walked, count, width, steps)
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
        lines.push(range)
        cursor = { ...range.end }
      }
      // Each item's fragments cover its text, and each one's text is its item's between sourceStart and sourceEnd. A box
      // and an atomic item are one fragment each.
      const spans: Array<Array<[number, number]>> = items.map(() => [])
      const fragmentCounts = items.map(() => 0)
      for (let i = 0; i < lines.length; i++) {
        let occupied = 0
        let before: RichInlineFragment | null = null
        for (const f of api.materializeRichInlineLineRange(prepared, lines[i]!).fragments) {
          occupied += f.gapBefore + f.occupiedWidth
          // White space between two fragments makes a gap before the later one, or none where Firefox's run of
          // white space took it in.
          if (before !== null && whiteSpace !== 'pre-wrap' && f.gapItemIndex === -1) {
            const holder = whiteSpaceBetween(items, before, f, removed)
            if (holder >= 0 && !(gecko && joinsWhiteSpaceRun(items, holder, f.itemIndex))) fail('rich lines', at, `line ${i} has no gap before item ${f.itemIndex}, after item ${holder}'s white space`)
          }
          before = f
          const problem = fragmentProblem(items[f.itemIndex]!, f, whiteSpace)
          if (problem !== null) fail('rich lines', at, `line ${i}'s fragment of item ${f.itemIndex} ${problem}`)
          spans[f.itemIndex]!.push([f.sourceStart, f.sourceEnd])
          // A gap is the SPACE of the item whose white space made it. Nothing collapses in pre-wrap.
          if (options.whiteSpace === 'pre-wrap' && (f.gapBefore !== 0 || f.gapItemIndex !== -1)) fail('rich lines', at, `line ${i} has a gap of ${f.gapBefore} before item ${f.itemIndex} in pre-wrap`)
          if (f.gapItemIndex >= 0) {
            const gapItem = items[f.gapItemIndex]!
            if (gapItem.text === undefined) {
              fail('rich lines', at, `line ${i}'s gap before item ${f.itemIndex} is box ${f.gapItemIndex}'s, which holds no white space`)
            } else {
              // Firefox lays letter spacing out in whole app units, 1/60 px, rounded half away from zero
              // (readLetterSpacing in src/measurement.ts).
              const given = gapItem.letterSpacing ?? 0
              const spacing = gecko ? Math.sign(given) * Math.round(Math.abs(Math.fround(Math.fround(given) * 60))) / 60 : given
              const space = standInWidth(' ', gapItem.font, spacing, 'auto')
              // The Chromium profile's space takes its kerning with the character beside it in its own item,
              // the one after the white space that starts the item or before the white space that ends it,
              // where the profile kerns the two (getSpaceKerning in src/measurement.ts): a gap is the SPACE
              // or the SPACE less that kerning, as this Canvas gives it (standInWidth), and nothing between.
              let kerning = 0
              if (profile === 'blink' || profile === 'unknown') {
                const text = gapItem.text
                const step = f.gapItemIndex === f.itemIndex ? 1 : -1
                let beside = step === 1 ? 0 : text.length - 1
                while (beside >= 0 && beside < text.length && ' \t\n\r\f'.includes(text[beside]!)) beside += step
                if (beside >= 0 && beside < text.length) kerning = text.charCodeAt(beside) % 3 / 2 * Number(/(\d+(?:\.\d+)?)px/.exec(gapItem.font)?.[1] ?? 16) / 16
              }
              if (Math.abs(f.gapBefore - space) > 1e-6 && Math.abs(f.gapBefore - (space - kerning)) > 1e-6) fail('rich lines', at, `line ${i}'s gap before item ${f.itemIndex} is ${f.gapBefore}; item ${f.gapItemIndex}'s SPACE is ${space}, and ${space - kerning} with its kerning`)
            }
          }
          fragmentCounts[f.itemIndex]!++
          if (atomic[f.itemIndex]!) {
            const text = (items[f.itemIndex] as RichInlineItem).text
            if (text.slice(f.sourceStart, f.sourceEnd) !== text.trim()) fail('rich lines', at, `atomic item ${f.itemIndex} is split at ${f.sourceStart}-${f.sourceEnd}`)
          }
        }
        if (Math.abs(lines[i]!.width - Math.max(0, occupied)) > 1e-6) fail('rich lines', at, `line ${i} is ${lines[i]!.width} wide; its fragments' gaps and widths add up to ${occupied}`)
      }
      for (let k = 0; k < items.length; k++) {
        const text = items[k]!.text
        if ((text === undefined || atomic[k]!) && fragmentCounts[k] !== 1) fail('rich lines', at, `${text === undefined ? 'box' : 'atomic item'} ${k} is in ${fragmentCounts[k]} fragments`)
        if (text === undefined) continue
        const coverage = covers(text, spans[k]!, atomic[k]! ? 'normal' : whiteSpace, 0, true)
        if (coverage !== null) fail('coverage', `${at}, item ${k}`, coverage)
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
      // On one line, each fragment is its text's width plus its item's extraWidth, once, but where a pre-wrap tab's
      // stop, which counts from the line's start, moves with the extraWidth before it.
      if (withoutExtra !== null && !(options.whiteSpace === 'pre-wrap' && items.some(item => item.text?.includes('\t') === true))) {
        const withExtra = walk(prepared, Infinity)
        const without = walk(withoutExtra, Infinity)
        const a = withExtra.flatMap(line => line.fragments)
        const b = without.flatMap(line => line.fragments)
        for (let k = 0; k < Math.max(a.length, b.length); k++) {
          const extraWidth = extraOf(items[a[k]?.itemIndex ?? 0]!)
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
  let cases = 0
  type Held = { label: string; text: string; font: string; options: PrepareOptions; widths: number[]; handle: PreparedTextWithSegments; copy: PreparedTextWithSegments; fast: PreparedText; laidOut: string }
  // Held handles: the first drawn cases' and the fixed inputs'.
  const HELD = 120
  const held: Held[] = []
  const layOut = (h: { handle: PreparedTextWithSegments; fast: PreparedText; widths: number[] }): string => {
    const out = JSON.stringify(h.widths.map(w => [api.layout(h.fast, w, 20), api.layoutWithLines(h.handle, w, 20).lines]))
    return out
  }
  // A case's width, half and 1.5 times it, then 1 and Infinity, but for a paragraph an earlier case held at another
  // width (`repeated`), where those two would walk the same lines again: 16,674 paragraphs make the 70,453 cases, and
  // a run over all of them took 33 s of processor time with the repeats and 20 s without (2026-10-01).
  const widthsOf = (width: number, repeated: boolean): number[] => [width, Math.max(1, width / 2), width * 1.5, ...(repeated ? [] : [1, Infinity])]
  const plainInput = (label: string, text: string, font: string, options: PrepareOptions, widths: number[], lineHeight: number): void => {
    const handle = api.prepareWithSegments(text, font, options)
    const fast = api.prepare(text, font, options)
    for (let i = 0; i < widths.length; i++) plain(label, handle, fast, options.whiteSpace ?? 'normal', widths[i]!, lineHeight)
    if (held.length >= HELD && !label.startsWith('fixed')) return
    const h = { label, text, font, options, widths: [widths[0]!, 1], handle, copy: structuredClone(handle), fast }
    held.push({ ...h, laidOut: layOut(h) })
  }
  const paragraphs = new Set<string>()
  for (const c of drawnCases(draws.dir, draws.seed, draws.plain, draws.rich)) {
    const p = c.paragraph
    const paragraph = JSON.stringify({ ...p, width: 0 })
    const widths = widthsOf(p.width, paragraphs.has(paragraph))
    paragraphs.add(paragraph)
    // Each thousand cases a timer runs, since the watchdog kills a process that runs none for 30 s and every case takes
    // longer on a loaded machine, and the caches empty: with every case's widths kept, the process held 0.8 GB of the
    // watchdog's 1 GB, and holds up to 0.67 GB without.
    if (++cases % 1000 === 0) {
      await Bun.sleep(0)
      api.clearCache()
    }
    if (isRich(p.runs)) {
      const items = richItems(p.runs)
      for (let i = 0; i < widths.length; i++) rich(c.id, items, widths[i]!, richOptions(c))
    } else {
      plainInput(c.id, p.runs.map(run => run.text).join(''), canvasFont(p.runs[0]!.font), prepareOptions(c), widths, p.lineHeight)
    }
  }
  const FONT = '16px Test'
  // A mark after a word joiner, where Chrome and Firefox measure a fresh line's first graphemes apart (entry geometry).
  plainInput('fixed a WJ U+0301 bc', 'a\u2060\u0301bc ', FONT, { letterSpacing: -1 }, widthsOf(27, false), 20)
  plainInput('fixed a WJ U+0301 bc x16', 'a\u2060\u0301bc '.repeat(16), FONT, { letterSpacing: -1 }, widthsOf(27, false), 20)
  // A SPACE is 4px here: the gap's sign changes at letter spacing -4.
  for (const letterSpacing of [-10, -4.1, -4, -3.9, 0, 2]) rich(`fixed a gap at letter spacing ${letterSpacing}`, [{ text: 'x ', font: FONT, letterSpacing }, { text: 'y', font: FONT, letterSpacing }], Infinity)
  // White space after white space and a soft hyphen takes no room in Firefox, in the next item or in the same one, but
  // keeps it after a soft hyphen that starts its item.
  for (const texts of [['see', ' \u00AD', ' this word'], ['see \u00AD ', 'this word'], ['see ', '\u00AD ', 'this word']]) {
    for (const width of [30, Infinity]) rich('fixed white space after a soft hyphen', texts.map(text => ({ text, font: FONT })), width)
  }
  rich('fixed empty and blank items', ['', 'AB', ' ', 'CD', ''].map(text => ({ text, font: FONT })), 16.1)
  rich('fixed one item a line', ['A', 'B', 'C'].map(text => ({ text, font: FONT })), 8.1)
  const pill: RichInlineItem = { text: 'ABCD', font: FONT, break: 'never', extraWidth: 18 }
  rich('fixed a pill alone', [pill], 1)
  rich('fixed a pill between letters', [{ text: 'A', font: FONT }, pill, { text: 'B', font: FONT }], 50)
  // Boxes alone, beside text with and without spaces, of width 0 and wider than the line.
  const boxes: Array<RichInlineItem | RichInlineBox> = [{ width: 20 }, { text: 'AB ', font: FONT }, { width: 0 }, { width: 40 }, { text: ' CD', font: FONT }, { width: 12 }]
  for (const width of [1, 17, 30, 45, Infinity]) {
    rich('fixed boxes', boxes, width)
    rich('fixed boxes in pre-wrap', boxes, width, { whiteSpace: 'pre-wrap' })
  }
  // Pre-wrap spaces, tabs and newlines at item edges, in padded items and a chip, and a CRLF split across items.
  const preWrap: RichInlineItem[] = [
    { text: 'ab  ', font: FONT }, { text: '  cd\t', font: '12px Test', extraWidth: 6 }, { text: '\tef', font: FONT }, { text: '\n', font: FONT },
    { text: ' g h ', font: FONT, break: 'never', extraWidth: 10 }, { text: 'ij\r', font: FONT }, { text: '\n\nkl   ', font: FONT, extraWidth: 4 },
  ]
  for (const width of [1, 17, 30, 45, 70, Infinity]) rich('fixed pre-wrap white space at item edges', preWrap, width, { whiteSpace: 'pre-wrap' })

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
  return { cases, failures }
}

if (import.meta.main) {
  const flag = (name: string): string | undefined => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const profile = (flag('profile') ?? 'blink') as Profile
  if (!(profile in PROFILES)) throw new Error(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`)
  const start = performance.now()
  const count = (name: string, most: number): number => (flag(name) === 'all' ? Infinity : Number(flag(name) ?? most))
  const result = await runInvariants(profile, resolve(flag('lib') ?? join(import.meta.dir, '../src')), {
    dir: join(import.meta.dir, 'cases'), seed: flag('seed') ?? 'invariants', plain: count('draws', 500), rich: count('rich', 100),
  })
  console.log(JSON.stringify({ profile, cases: result.cases, failures: result.failures.list, counts: result.failures.counts, ms: Math.round(performance.now() - start) }))
}
