// The page side of tools/positions-probe.ts: tools/positions-study.ts's chat pass in a real browser, over the library as
// an application runs it. Bundled by the probe module with the study's source transform.
import { detectEnvironment, fillLine, firstLine, prepare, type Prepared } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'
import { makeStudy, type Pass } from './positions-study-core.ts'

type Message = { kind: string; parts: Array<{ code: boolean; text: string }> }

// bench/page.ts chatInputs: no font facts supplied.
function paragraphOf(message: Message): Paragraph {
  const font: FontDecl = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: 6 }
  const content: InlineNode[] = []
  for (let k = 0; k < message.parts.length; k++) {
    const part = message.parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}

function fillAll(prepared: Prepared, width: number): number {
  let lines = 0
  for (let start = firstLine(prepared); start !== null;) {
    const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
    if (filled.kind === 'line' && filled.hasLineBox) lines++
    start = filled.next
  }
  return lines
}

const SETTINGS = ['font', 'lang', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'] as const

// One set: every message from scratch at `width`, then kept and filled at the other widths, and at those once more. Run
// twice: with plain counters, which is what the bench counts, and with the study's tally, which reads a stack per call.
function run(messages: readonly Message[], width: number, otherWidths: readonly number[]): unknown {
  const detected = detectEnvironment({ engine: 'blink', build: null, contentLanguage: null, uiLanguage: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  const env = detected.env
  const proto = OffscreenCanvasRenderingContext2D.prototype
  const real = proto.measureText
  const paragraphs = messages.map(paragraphOf)
  const pass = (onPass: (pass: Pass) => void, onParagraph: (kind: string) => void): number => {
    let lines = 0
    for (let i = 0; i < paragraphs.length; i++) {
      onParagraph(messages[i]!.kind)
      const prepared = prepare(paragraphs[i]!, env, false)
      lines += fillAll(prepared, width)
      for (let again = 0; again < 2; again++) {
        for (let w = 0; w < otherWidths.length; w++) {
          onPass(again === 0 ? 'new-width' : 'met-width')
          lines += fillAll(prepared, otherWidths[w]!)
        }
      }
    }
    return lines
  }
  const counts: Record<string, number> = { scratch: 0, 'new-width': 0, 'met-width': 0 }
  let current: Pass = 'scratch'
  proto.measureText = function (text: string): TextMetrics {
    counts[current]!++
    return real.call(this, text)
  }
  let lines = 0
  try {
    lines = pass(next => { current = next }, () => { current = 'scratch' })
  } finally {
    proto.measureText = real
  }
  const study = makeStudy()
  ;(globalThis as unknown as { positionsStudy: unknown }).positionsStudy = study.hooks
  ;(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 2000
  const keys = new WeakMap<object, string>()
  proto.measureText = function (text: string): TextMetrics {
    let key = keys.get(this)
    if (key === undefined) {
      key = ''
      const settings = this as unknown as Record<string, string>
      for (let i = 0; i < SETTINGS.length; i++) key += `${settings[SETTINGS[i]!]}|`
      keys.set(this, key)
    }
    study.call(this, key, text, new Error().stack ?? '')
    return real.call(this, text)
  }
  let studiedLines = 0
  try {
    studiedLines = pass(next => study.pass(next), kind => study.paragraph(kind))
  } finally {
    proto.measureText = real
    ;(globalThis as unknown as { positionsStudy: unknown }).positionsStudy = undefined
  }
  const n = paragraphs.length
  return {
    messages: n, lines, studiedLines,
    callsPerMessageFromScratch: counts['scratch']! / n, callsPerLayoutAtANewWidth: counts['new-width']! / (n * otherWidths.length), callsPerLayoutAtAWidthMetBefore: counts['met-width']! / (n * otherWidths.length),
    study: study.report(),
  }
}

(globalThis as unknown as { positionsProbe: unknown }).positionsProbe = { run }
