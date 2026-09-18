// Small hand-built lab rows for the scorer's and the triage tool's tests: rects in CSS px on 20px lines, layouts with the
// fields the scorer reads, and expected observations by hand.
import type { BlinkEnvironment, GeckoEnvironment, WebKitEnvironment } from '../src/env.ts'
import type { BlinkLineGeometry, GeckoLineGeometry, WebKitLineGeometry } from '../src/model.ts'
import type { Expected, ExpectedObservation, ExpectedRect } from './observe/contract.ts'
import type {
  BlinkLine, BrowserKind, CodePointObservation, FontDecl, GeckoLine, LabRow, LineSlot, NativeObservation, PainterLine, Paragraph, RecordedLayout, Rect, TextRun, WebKitLine,
} from './types.ts'

export const arial: FontDecl = { family: 'Arial', size: 16, weight: 400, style: 'normal' }

export function paragraph(runs: Array<[text: string, node: TextRun['node']]>, overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    runs: runs.map(([text, node]) => ({ text, node, font: arial, letterSpacing: 0, wordSpacing: 0, lang: null })),
    font: arial, letterSpacing: 0, wordSpacing: 0, width: 200, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...overrides,
  }
}

// A native rect on line `line` (lines are 20px tall).
export const at = (x: number, width: number, line = 0): Rect => ({ x, y: line * 20, width, height: 20 })
export const predicted = (value: number): Expected => ({ state: 'predicted', value })
// An expected rect of engine line `line`, both values predicted unless given.
export const expect32 = (line: number, x: number | Expected, width: number | Expected): ExpectedRect => ({
  line, x: typeof x === 'number' ? predicted(x) : x, width: typeof width === 'number' ? predicted(width) : width,
})

export function points(text: string, rects: Rect[][]): CodePointObservation[] {
  const out: CodePointObservation[] = []
  for (let offset = 0; offset < text.length;) {
    const length = text.codePointAt(offset)! > 0xffff ? 2 : 1
    out.push({ offset, length, rects: rects[out.length]! })
    offset += length
  }
  if (out.length !== rects.length) throw new Error(`${rects.length} rect lists for ${out.length} code points`)
  return out
}

export function native(p: Paragraph, rects: Rect[][], runRects: Rect[][]): NativeObservation {
  return { fontsStatusBefore: 'loaded', fontsStatusAfter: 'loaded', rejectedStyles: [], height: 0, width: p.width, points: points(p.runs.map(run => run.text).join(''), rects), runRects }
}

export function observation(p: Paragraph, rects: ExpectedRect[][], nodes: ExpectedRect[][], unobservable: ExpectedObservation['unobservable'] = []): ExpectedObservation {
  const text = p.runs.map(run => run.text).join('')
  const codePoints = points(text, rects.map(() => [])).map((point, i) => ({ offset: point.offset, length: point.length, rects: rects[i]! }))
  return { codePoints, nodes, elements: [], unobservable }
}

export const blinkEnv: BlinkEnvironment = { engine: 'blink', build: '153.0.8010.48', devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, uiLanguage: null, dictionaryBreaks: { kind: 'unavailable' } }
export const webkitEnv: WebKitEnvironment = { engine: 'webkit', build: '22625.1.29.11.27', devicePixelRatio: 2, pageZoom: 1, pageLang: 'en', contentLanguage: null, preferredLanguages: null, icuDefaultLocale: null, dictionaryBreaks: { kind: 'unavailable' } }
export const geckoEnv: GeckoEnvironment = { engine: 'gecko', build: '156.0', devicePixelRatio: 2, pageLang: 'en', contentLanguage: null, regionalPrefsLocale: null, dictionaryBreaks: { kind: 'unavailable' } }

const FULL: LineSlot = { left: 0, right: 0 }

function engineLine<Geometry>(start: number, end: number, geometry: Geometry, hasLineBox = true): { start: number; end: number; fragments: []; hasLineBox: boolean; joinsNextLine: false; slot: LineSlot; indented: false; align: 'start'; geometry: Geometry; gaps: []; next: null } {
  return { start, end, fragments: [], hasLineBox, joinsNextLine: false, slot: FULL, indented: false, align: 'start', geometry, gaps: [], next: null }
}

// Blink lines by [start, end, width in raw LayoutUnits, hasLineBox], at layout zoom 2.
export function blink(lines: Array<[number, number, number, boolean?]>): RecordedLayout {
  const out: BlinkLine[] = lines.map(([start, end, width, hasLineBox]) => engineLine<BlinkLineGeometry>(start, end, {
    layoutZoom: 2, lineLeft: 0, lineRight: 0, availableWidth: 0, textIndent: 0, needsAccurateEndPosition: false, width, hangWidth: 0, alignOffset: 0, mapping: [], items: [],
  }, hasLineBox ?? true))
  return { engine: 'blink', env: blinkEnv, lines: out, belowFloats: [], gaps: [] }
}

export function webkit(lines: Array<[number, number, number]>): RecordedLayout {
  const out: WebKitLine[] = lines.map(([start, end, contentWidth]) => engineLine<WebKitLineGeometry>(start, end, {
    lineLeft: 0, contentEdgeOffset: 0, lineBoxWidth: 0, contentWidth, hangingWidth: 0, contentLogicalRight: contentWidth, alignmentOffset: 0, boxes: [],
  }))
  return { engine: 'webkit', env: webkitEnv, lines: out, belowFloats: [], gaps: [] }
}

export function gecko(lines: Array<[number, number, number]>): RecordedLayout {
  const out: GeckoLine[] = lines.map(([start, end, width]) => engineLine<GeckoLineGeometry>(start, end, {
    appUnitsPerDevPixel: 30, lineLeft: 0, availableWidth: 0, impactedByFloats: false, textIndent: 0, width, hang: 0, alignOffset: 0, frames: [],
  }))
  return { engine: 'gecko', env: geckoEnv, lines: out, belowFloats: [], gaps: [] }
}

export function row(browser: BrowserKind, p: Paragraph, observed: LabRow['native'], layout: RecordedLayout, expected: ExpectedObservation | { error: string }, painted: PainterLine[] | null = null): LabRow {
  return {
    id: 'c-test', family: 'test', browser,
    case: { id: 'c-test', family: 'test', origin: 'test', pageLang: 'en', paragraph: p },
    env: { userAgent: 'test', devicePixelRatio: 2, visualViewportScale: 1, pageLang: 'en', fontFixtures: [], innerWidth: 0, innerHeight: 0, outerWidth: 0, outerHeight: 0, visibilityState: 'visible', hasFocus: false },
    native: observed,
    prediction: { layout, measure: { contexts: 0, calls: 0, memoHits: 0 }, observation: expected },
    painter: painted === null ? null : { lines: painted },
    timings: { nativeMs: 0, predictMs: 0, observeMs: 0, paintMs: 0, painterObserveMs: 0 },
  }
}

// `ab cd` in one text node, broken after the space at DPR 2: `a` 1024 raw, `b` 976, the trimmed space a zero-width
// boundary rect at the item end, `c` 896, `d` 904.
export const abcd = paragraph([['ab cd', 'text']])
export const abcdNative = native(abcd,
  [[at(0, 8)], [at(8, 7.625)], [at(15.625, 0)], [at(0, 7, 1)], [at(7, 7.0625, 1)]],
  [[at(0, 15.625), at(0, 14.0625, 1)]])
export const abcdExpected = observation(abcd,
  [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(0, 15.625, 0)], [expect32(1, 0, 7)], [expect32(1, 7, 7.0625)]],
  [[expect32(0, 0, 15.625), expect32(1, 0, 14.0625)]])
export const abcdLayout = blink([[0, 3, 2000], [3, 5, 1800]])
// The same text laid out on one line: the line count fails against abcdNative.
export const abcdOneLine = blink([[0, 5, 4312]])
export const abcdOneLineExpected = observation(abcd, [[expect32(0, 0, 8)], [expect32(0, 8, 7.625)], [expect32(0, 15.625, 4)], [expect32(0, 19.625, 7)], [expect32(0, 26.625, 7.0625)]], [[expect32(0, 0, 33.6875)]])

// A row of main's predictor: line ranges alone, with its own native observation or skipped.
export function linesRow(base: LabRow, lines: Array<[number, number]>, observed: LabRow['native'] = base.native): LabRow {
  return { ...base, native: observed, prediction: { lines: lines.map(([start, end]) => ({ start, end, width: 0 })) }, painter: null }
}
