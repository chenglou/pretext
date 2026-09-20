// The library behind tools/measuretext-cost-body.ts's R1: the chat benchmark's messages laid out from scratch with one
// kept list of Canvas contexts, as bench/page.ts's "page keeps both" does. Bundled by the probe module and the shell
// driver; nothing here measures time.
import { detectEnvironment, fillLine, firstLine, prepare, type Context, type Environment, type GivenFacts } from '../src/index.ts'
import { UNKNOWN_FONT_FACTS, type BoxEdge, type FontDecl, type InlineNode, type Paragraph } from '../src/model.ts'

type Part = { code: boolean; text: string }

function environment(): Environment {
  const given: GivenFacts = { engine: 'blink', build: null, contentLanguage: null, uiLanguage: null }
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

function scratchKept(paragraphs: readonly Paragraph[], env: Environment, width: number): number {
  const contexts: Context[] = []
  let lines = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const prepared = prepare(paragraphs[i]!, env, false, contexts)
    for (let start = firstLine(prepared); start !== null;) {
      const filled = fillLine(prepared, start, { width, left: 0, right: 0 })
      if (filled.kind === 'below-floats') throw new Error('a slot without insets moved its line below floats')
      if (filled.hasLineBox) lines++
      start = filled.next
    }
  }
  return lines
}

(globalThis as unknown as { measureTextCost: unknown }).measureTextCost = { environment, paragraphOf, scratchKept }
