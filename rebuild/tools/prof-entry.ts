// The page side of tools/prof-probe.ts: the chat benchmark's loops over the library as an application runs it, with three
// Canvases to run them on. The real one. A recording one, which asks the real one and keeps every answer in call order.
// And a stand-in, which answers the n-th call with the n-th recorded answer and does nothing else: no shaping, no lookup
// by string, so a pass over it is the library's own JavaScript alone. The library asks the same questions in the same
// order on every pass (it keeps nothing across paragraphs but the caller's list of contexts, which every pass starts
// empty), and the stand-in's checked form throws where a call's string isn't as long as the recorded one's.
// tools/prof-bun.ts runs the same loops under bun over an exported recording.
import { detectEnvironment, fillLine, firstLine, prepare, type Environment, type GivenFacts, type Prepared } from '../src/index.ts'
import type { Context } from '../src/measure/canvas.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'

type Part = { code: boolean; text: string }

function environment(): Environment {
  const given: GivenFacts = { engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null }
  const detected = detectEnvironment(given)
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

// bench/page.ts chatInputs: no font facts supplied.
function paragraphOf(parts: readonly Part[]): Paragraph {
  const font: FontDecl = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: 6 }
  const content: InlineNode[] = []
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}

function fillAll(prepared: Prepared, width: number): number {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
    if (filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

// From scratch, one list of contexts a pass: how a page that lays its messages out from nothing calls the library.
function scratch(paragraphs: readonly Paragraph[], env: Environment, width: number): number {
  const contexts: Context[] = []
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) lines += fillAll(prepare(paragraphs[i]!, env, false, contexts), width)
  return lines
}

// prepare alone, which a recording of it counts the questions of; the fill's are the rest of `scratch`'s.
function prepareOnly(paragraphs: readonly Paragraph[], env: Environment): void {
  const contexts: Context[] = []
  for (let i = 0; i < paragraphs.length; i++) prepare(paragraphs[i]!, env, false, contexts)
}

// The same pass with a timer between prepare and the fill of every message. Two timer reads a message, none a Canvas call.
function scratchPhases(paragraphs: readonly Paragraph[], env: Environment, width: number): { prepareMs: number; fillMs: number; lines: number } {
  const contexts: Context[] = []
  let lines = 0
  let prepareMs = 0
  let fillMs = 0
  let t0 = performance.now()
  for (let i = 0; i < paragraphs.length; i++) {
    const prepared = prepare(paragraphs[i]!, env, false, contexts)
    const t1 = performance.now()
    lines += fillAll(prepared, width)
    const t2 = performance.now()
    prepareMs += t1 - t0
    fillMs += t2 - t1
    t0 = t2
  }
  return { prepareMs, fillMs, lines }
}

// Prepared, filled at `width` and kept: what the resize case starts from. It asks what `scratch` asks.
function prepareAll(paragraphs: readonly Paragraph[], env: Environment, width: number): Prepared[] {
  const contexts: Context[] = []
  const out: Prepared[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    out.push(prepare(paragraphs[i]!, env, false, contexts))
    fillAll(out[i]!, width)
  }
  return out
}

function relayout(prepared: readonly Prepared[], widths: readonly number[]): number {
  let lines = 0
  for (let w = 0; w < widths.length; w++) for (let i = 0; i < prepared.length; i++) lines += fillAll(prepared[i]!, widths[w]!)
  return lines
}

// ---- The three Canvases ----

const ATTRIBUTES = ['lang', 'font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const
type Real = OffscreenCanvasRenderingContext2D
const RealCanvas = globalThis.OffscreenCanvas

// A recording: per call its context, its string's length, the three numbers the library reads of an answer and whether
// it read the ink box; per context the attributes assigned to it, in order. `texts` only where a replay on the real
// Canvas needs them.
// `hash` runs over every call's context and string (FNV-1a), so two recordings with one hash asked the same questions in
// the same order.
type Recording = {
  context: number[]; length: number[]; width: number[]; left: number[]; right: number[]; readsBox: number[]
  texts: string[] | null
  settings: Array<Array<[string, string]>>
  hash: number
}

function recordingCanvas(recording: Recording): void {
  class RecordingContext {
    real = new RealCanvas(1, 1).getContext('2d') as Real
    id = recording.settings.push([]) - 1
    measureText(text: string): unknown {
      const m = this.real.measureText(text)
      const i = recording.context.push(this.id) - 1
      let h = Math.imul(recording.hash ^ this.id, 0x01000193)
      for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193)
      recording.hash = h
      recording.length.push(text.length)
      recording.width.push(m.width)
      recording.left.push(m.actualBoundingBoxLeft)
      recording.right.push(m.actualBoundingBoxRight)
      recording.readsBox.push(0)
      if (recording.texts !== null) recording.texts.push(text)
      return { width: m.width, actualBoundingBoxRight: m.actualBoundingBoxRight, get actualBoundingBoxLeft() { recording.readsBox[i] = 1; return m.actualBoundingBoxLeft } }
    }
  }
  for (let a = 0; a < ATTRIBUTES.length; a++) {
    const name = ATTRIBUTES[a]!
    Object.defineProperty(RecordingContext.prototype, name, {
      set(this: RecordingContext, value: string) { recording.settings[this.id]!.push([name, value]); (this.real as unknown as Record<string, string>)[name] = value },
    })
  }
  install(class { getContext(): unknown { return new RecordingContext() } })
}

// The stand-in's answers: a recording as typed arrays, and the next call's index. One answer object serves every call,
// since the library reads an answer's numbers at once and keeps none (measure/canvas.ts width, bounds).
type Answers = { length: Uint32Array; width: Float64Array; left: Float64Array; right: Float64Array }
let answers: Answers = { length: new Uint32Array(0), width: new Float64Array(0), left: new Float64Array(0), right: new Float64Array(0) }
let cursor = 0
const answer = { width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }

class StandInContext {
  lang = ''; font = ''; letterSpacing = ''; wordSpacing = ''; fontKerning = ''; textRendering = ''; direction = ''
  measureText(_text: string): unknown {
    const i = cursor++
    answer.width = answers.width[i]!
    answer.actualBoundingBoxLeft = answers.left[i]!
    answer.actualBoundingBoxRight = answers.right[i]!
    return answer
  }
}

class CheckedStandInContext extends StandInContext {
  override measureText(text: string): unknown {
    if (cursor >= answers.length.length || answers.length[cursor] !== text.length) throw new Error(`call ${cursor} asks a string of ${text.length} units; the recording has ${answers.length[cursor]}`)
    return super.measureText(text)
  }
}

function install(canvas: unknown): void {
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = canvas
}

function standInCanvas(from: Answers, checked: boolean): void {
  answers = from
  cursor = 0
  install(checked ? class { getContext(): unknown { return new CheckedStandInContext() } } : class { getContext(): unknown { return new StandInContext() } })
}

function realCanvas(): void {
  install(RealCanvas)
}

function answersOf(recording: Recording): Answers {
  return { length: Uint32Array.from(recording.length), width: Float64Array.from(recording.width), left: Float64Array.from(recording.left), right: Float64Array.from(recording.right) }
}

function newRecording(texts: boolean): Recording {
  return { context: [], length: [], width: [], left: [], right: [], readsBox: [], texts: texts ? [] : null, settings: [], hash: 0x811c9dc5 | 0 }
}

// A recording's calls alone on the real Canvas: its contexts made and set as they were, then every string measured in its
// context in call order, the ink box read where the library read it. The browser's share without the library. The calls
// before `from` run untimed (the resize case's prepare and first fill).
function canvasOnly(recording: Recording, from: number): { contextsMs: number; measureMs: number; sum: number } {
  const texts = recording.texts!
  const t0 = performance.now()
  const contexts: Real[] = []
  for (let c = 0; c < recording.settings.length; c++) {
    const ctx = new RealCanvas(1, 1).getContext('2d') as Real
    const settings = recording.settings[c]!
    for (let s = 0; s < settings.length; s++) (ctx as unknown as Record<string, string>)[settings[s]![0]] = settings[s]![1]
    contexts.push(ctx)
  }
  const contextsMs = performance.now() - t0
  let sum = 0
  for (let i = 0; i < from; i++) sum += contexts[recording.context[i]!]!.measureText(texts[i]!).width
  const t1 = performance.now()
  for (let i = from; i < texts.length; i++) {
    const m = contexts[recording.context[i]!]!.measureText(texts[i]!)
    sum += m.width
    if (recording.readsBox[i] === 1) sum += m.actualBoundingBoxLeft + m.actualBoundingBoxRight
  }
  return { contextsMs, measureMs: performance.now() - t1, sum }
}

(globalThis as unknown as { prof: unknown }).prof = {
  environment, paragraphOf, scratch, prepareOnly, scratchPhases, prepareAll, relayout,
  newRecording, recordingCanvas, standInCanvas, realCanvas, answersOf, canvasOnly,
}
