// The page side of tools/word-scan-probe.ts: one library as an application runs it, behind a few functions the probe's
// script calls. The probe bundles it once per library, with the imports below pointed at that library's source folder, so
// one document holds the library with Gecko's word scan and the library without it. Nothing here measures time.
import { detectEnvironment, fillLine, firstLine, prepare, type Environment, type Prepared } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type Direction, type FontDecl, type InlineNode, type OverflowWrap, type Paragraph } from '../src/model.ts'

type Part = { code: boolean; text: string }

function environment(): Environment {
  const detected = detectEnvironment({ engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  return detected.env
}

// bench/page.ts chatInputs: no font facts supplied. The bench's overflow-wrap is break-word.
function chatParagraph(parts: readonly Part[], overflowWrap: OverflowWrap): Paragraph {
  const font: FontDecl = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap, lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: 6 }
  const content: InlineNode[] = []
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!
    if (part.code) content.push({ ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] })
    else content.push({ kind: 'text', text: part.text })
  }
  return { ...text, font, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}

// One text in one font family, under overflow-wrap: break-word.
function fontParagraph(family: string, size: number, text: string, lang: string, direction: Direction): Paragraph {
  return {
    font: { family, size, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal',
    wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, content: [{ kind: 'text', text }], lang, direction,
    lineHeight: 2 * size, textIndent: 0, textAlign: 'start',
  }
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

// From scratch: every message prepared and filled, nothing kept across messages.
function scratch(paragraphs: readonly Paragraph[], env: Environment, width: number): number {
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) lines += fillAll(prepare(paragraphs[i]!, env, false), width)
  return lines
}

function prepareAll(paragraphs: readonly Paragraph[], env: Environment, width: number): Prepared[] {
  const out: Prepared[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    out.push(prepare(paragraphs[i]!, env, false))
    fillAll(out[i]!, width)
  }
  return out
}

function relayout(prepared: readonly Prepared[], widths: readonly number[]): number {
  let lines = 0
  for (let w = 0; w < widths.length; w++) for (let i = 0; i < prepared.length; i++) lines += fillAll(prepared[i]!, widths[w]!)
  return lines
}

// Every line's range of a paragraph prepared anew, at each width.
function ranges(paragraph: Paragraph, env: Environment, widths: readonly number[]): string[] {
  const out: string[] = []
  for (let w = 0; w < widths.length; w++) {
    const prepared = prepare(paragraph, env, false)
    let text = ''
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width: widths[w]!, left: 0, right: 0 })
      if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
      text += `${filled.start}-${filled.end} `
      start = filled.next
    }
    out.push(text)
  }
  return out
}

// A hash of every line's range of kept paragraphs over some widths, for holding two libraries against each other.
function rangesHash(prepared: readonly Prepared[], widths: readonly number[]): number {
  let hash = 0
  for (let w = 0; w < widths.length; w++) {
    for (let i = 0; i < prepared.length; i++) {
      for (let start = firstLine(prepared[i]!); start !== null;) {
        const filled = fillLine(prepared[i]!, start, { width: widths[w]!, left: 0, right: 0 })
        if (filled.kind === 'line') hash = (Math.imul(hash, 31) + filled.start * 7 + filled.end) | 0
        start = filled.next
      }
    }
  }
  return hash
}

(globalThis as unknown as { wordScanProbe: unknown }).wordScanProbe = { environment, chatParagraph, fontParagraph, scratch, prepareAll, relayout, ranges, rangesHash }
