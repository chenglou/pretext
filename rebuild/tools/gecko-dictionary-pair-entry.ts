// Bundled twice by gecko-dictionary-pair-probe.ts, with these imports pointed at each frozen tree.
import * as lib from '../src/index.ts'
import { icu4xLineBoundaries } from '../src/engines/gecko/linebreak.ts'
import type { Paragraph, InlineNode, FontDecl, BoxEdge } from '../src/model.ts'
import type { Prepared, Environment, Context } from '../src/index.ts'

type Part = { code: boolean; text: string }
function environment(): Environment {
  const detected = lib.detectEnvironment({ engine: 'gecko', build: null, contentLanguage: null, regionalPrefsLocale: null })
  if (detected.kind === 'unsupported') throw new Error(detected.reason)
  if (detected.env.engine !== 'gecko' || detected.env.dictionaryBreaks.kind !== 'intl-segmenter-word') throw new Error('native Gecko dictionary segmentation unavailable')
  return detected.env
}
function paragraphOf(parts: readonly Part[]): Paragraph {
  const font: FontDecl = { family: '"Helvetica Neue", "PingFang TC", "Geeza Pro", sans-serif', size: 16, weight: 400, style: 'normal', facts: lib.UNKNOWN_FONT_FACTS }
  const codeFont: FontDecl = { family: 'Menlo', size: 14, weight: 400, style: 'normal', facts: lib.UNKNOWN_FONT_FACTS }
  const text = { letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8 } as const
  const edge: BoxEdge = { margin: 0, border: 0, padding: 6 }
  const content: InlineNode[] = parts.map(part => part.code ? { ...text, kind: 'span', font: codeFont, lang: null, inlineStart: edge, inlineEnd: edge, verticalAlign: 'baseline', children: [{ kind: 'text', text: part.text }] } : { kind: 'text', text: part.text })
  return { ...text, font, content, lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
}
function fillAll(prepared: Prepared, width: number, detail: boolean): { lines: number; output: unknown[] } {
  let lines = 0
  const output: unknown[] = []
  for (let start = lib.firstLine(prepared); start !== null;) {
    const line = lib.fillLine(prepared, start, { width, left: 0, right: 0 })
    if (line.kind === 'below-floats') throw new Error('unrestricted slot refused')
    if (detail) output.push({ start: line.start, end: line.end, next: line.next, box: line.hasLineBox, pieces: lib.linePieces(prepared, line.line) })
    if (line.hasLineBox) lines++
    start = line.next
  }
  return { lines, output }
}
function scratch(paragraphs: readonly Paragraph[], env: Environment): number {
  const contexts: Context[] = []
  let lines = 0
  for (const p of paragraphs) lines += fillAll(lib.prepare(p, env, false, contexts), 320, false).lines
  return lines
}
function complete(p: Paragraph, env: Environment): unknown {
  const prepared = lib.prepare(p, env, true, [])
  if (prepared.engine !== 'gecko') throw new Error('wrong engine')
  return { breakFlags: [...prepared.state.breakFlags], outputs: [37, 320, 440].map(width => ({ width, ...fillAll(prepared, width, true) })), gaps: lib.paragraphGaps(prepared) }
}
function boundaries(text: string, dictionary = true): number[] {
  return icu4xLineBoundaries(text, { strictness: 'strict', wordOption: 'normal', jaZh: false }, dictionary ? { kind: 'intl-segmenter-word' } : { kind: 'unavailable' })
}
;(globalThis as unknown as { nativeDictionaryPairLib: unknown }).nativeDictionaryPairLib = { environment, paragraphOf, scratch, complete, boundaries }
