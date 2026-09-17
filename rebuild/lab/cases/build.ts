// Builders shared by the generated families: fonts, paragraphs from parts, and a per-family emitter
// that turns one paragraph shape into cases at several widths.

import type { BoxEdge } from '../../src/model.ts'
import type { Case, FontDecl, InlineNode, InlineStructure, LineSlot, Paragraph, TextRun } from '../types.ts'
import { leafRuns, makeCase } from './case.ts'
import { canonicalFontFamily } from './font.ts'

export type Generator = { family: string; generate(seed: string): Case[] }

export function font(family: string, size: number, weight = 400, style: FontDecl['style'] = 'normal'): FontDecl {
  return { family: canonicalFontFamily(family), size, weight, style }
}

export type SpanOptions = { letterSpacing?: number; wordSpacing?: number; lang?: string | null }

export type Part =
  | { node: 'text'; text: string }
  | { node: 'span'; text: string; font: FontDecl; options: SpanOptions }

export function text(value: string): Part {
  return { node: 'text', text: value }
}

export function span(value: string, spanFont: FontDecl, options: SpanOptions = {}): Part {
  return { node: 'span', text: value, font: spanFont, options }
}

export type ParagraphSpec = {
  font: FontDecl
  lang: string
  letterSpacing?: number
  wordSpacing?: number
  lineHeight?: number
  whiteSpace?: Paragraph['whiteSpace']
  wordBreak?: Paragraph['wordBreak']
  overflowWrap?: Paragraph['overflowWrap']
  lineBreak?: Paragraph['lineBreak']
  tabSize?: number
  direction?: Paragraph['direction']
}

// Spans without explicit spacing inherit the paragraph's, as CSS would. Adjacent bare text parts merge
// (the DOM would lay them out as one text) and empty bare text parts are dropped. The default line
// height is twice the largest font size, so every run fits.
export function paragraph(spec: ParagraphSpec, parts: readonly Part[]): Paragraph {
  const letterSpacing = spec.letterSpacing ?? 0
  const wordSpacing = spec.wordSpacing ?? 0
  const runs: TextRun[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.node === 'text') {
      if (part.text === '') continue
      const last = runs[runs.length - 1]
      if (last !== undefined && last.node === 'text') {
        last.text += part.text
        continue
      }
      runs.push({ text: part.text, node: 'text', font: spec.font, letterSpacing, wordSpacing, lang: null })
    } else {
      runs.push({
        text: part.text, node: 'span', font: part.font,
        letterSpacing: part.options.letterSpacing ?? letterSpacing,
        wordSpacing: part.options.wordSpacing ?? wordSpacing,
        lang: part.options.lang ?? null,
      })
    }
  }
  let maxSize = spec.font.size
  for (let i = 0; i < runs.length; i++) maxSize = Math.max(maxSize, runs[i]!.font.size)
  return {
    runs, font: spec.font, letterSpacing, wordSpacing, width: 0,
    lineHeight: spec.lineHeight ?? Math.ceil(maxSize * 2),
    whiteSpace: spec.whiteSpace ?? 'normal',
    wordBreak: spec.wordBreak ?? 'normal',
    overflowWrap: spec.overflowWrap ?? 'normal',
    lineBreak: spec.lineBreak ?? 'auto',
    tabSize: spec.tabSize ?? 8,
    direction: spec.direction ?? 'ltr',
    lang: spec.lang,
  }
}

// ---- Inline structure (DESIGN.md §1.1, §2.9; §8.3 stage 5) ----

// A span's own styles and attributes; what it doesn't set it inherits from its parent, as CSS would.
export type SpanSpec = SpanOptions & {
  font?: FontDecl
  whiteSpace?: Paragraph['whiteSpace']
  wordBreak?: Paragraph['wordBreak']
  overflowWrap?: Paragraph['overflowWrap']
  lineBreak?: Paragraph['lineBreak']
  tabSize?: number
  start?: Partial<BoxEdge>
  end?: Partial<BoxEdge>
  verticalAlign?: 'baseline' | '0px'
}

export type TreePart =
  | { kind: 'text'; text: string }
  | { kind: 'span'; spec: SpanSpec; children: readonly TreePart[] }
  | { kind: 'atomic'; width: number; height: number; marginInlineStart: number; marginInlineEnd: number }
  | { kind: 'br' }
  | { kind: 'wbr' }

export function leaf(value: string): TreePart {
  return { kind: 'text', text: value }
}

export function el(spec: SpanSpec, ...children: TreePart[]): TreePart {
  return { kind: 'span', spec, children }
}

export function atomic(width: number, height: number, marginInlineStart = 0, marginInlineEnd = 0): TreePart {
  return { kind: 'atomic', width, height, marginInlineStart, marginInlineEnd }
}

export function br(): TreePart {
  return { kind: 'br' }
}

export function wbr(): TreePart {
  return { kind: 'wbr' }
}

export type BlockSpec = ParagraphSpec & { textIndent?: number; textAlign?: InlineStructure['textAlign']; lineSlots?: readonly LineSlot[] }

type ResolvedStyle = Pick<Paragraph, 'font' | 'letterSpacing' | 'wordSpacing' | 'whiteSpace' | 'wordBreak' | 'overflowWrap' | 'lineBreak' | 'tabSize'>

// A paragraph with inline structure. Every span carries its computed styles written out, and adjacent text leaves stay
// separate DOM text nodes. The default line height is twice the largest font size in the tree, rounded up to a whole px.
// makeCase drops the structure when it's flat.
export function treeParagraph(spec: BlockSpec, parts: readonly TreePart[]): { paragraph: Paragraph; inline: InlineStructure } {
  const block: ResolvedStyle = {
    font: spec.font, letterSpacing: spec.letterSpacing ?? 0, wordSpacing: spec.wordSpacing ?? 0, whiteSpace: spec.whiteSpace ?? 'normal',
    wordBreak: spec.wordBreak ?? 'normal', overflowWrap: spec.overflowWrap ?? 'normal', lineBreak: spec.lineBreak ?? 'auto', tabSize: spec.tabSize ?? 8,
  }
  let maxSize = spec.font.size
  const edge = (value: Partial<BoxEdge> | undefined): BoxEdge => ({ margin: value?.margin ?? 0, border: value?.border ?? 0, padding: value?.padding ?? 0 })
  const resolve = (list: readonly TreePart[], parent: ResolvedStyle): InlineNode[] => {
    const out: InlineNode[] = []
    for (let i = 0; i < list.length; i++) {
      const part = list[i]!
      switch (part.kind) {
        case 'text': out.push({ kind: 'text', text: part.text }); break
        case 'span': {
          const s = part.spec
          const style: ResolvedStyle = {
            font: s.font ?? parent.font, letterSpacing: s.letterSpacing ?? parent.letterSpacing, wordSpacing: s.wordSpacing ?? parent.wordSpacing,
            whiteSpace: s.whiteSpace ?? parent.whiteSpace, wordBreak: s.wordBreak ?? parent.wordBreak, overflowWrap: s.overflowWrap ?? parent.overflowWrap,
            lineBreak: s.lineBreak ?? parent.lineBreak, tabSize: s.tabSize ?? parent.tabSize,
          }
          maxSize = Math.max(maxSize, style.font.size)
          out.push({ kind: 'span', ...style, lang: s.lang ?? null, inlineStart: edge(s.start), inlineEnd: edge(s.end), verticalAlign: s.verticalAlign ?? 'baseline', children: resolve(part.children, style) })
          break
        }
        case 'atomic': out.push({ kind: 'atomic', width: part.width, height: part.height, marginInlineStart: part.marginInlineStart, marginInlineEnd: part.marginInlineEnd }); break
        case 'br': out.push({ kind: 'br' }); break
        case 'wbr': out.push({ kind: 'wbr' }); break
      }
    }
    return out
  }
  const content = resolve(parts, block)
  const paragraph: Paragraph = { runs: [], ...block, width: 0, lineHeight: spec.lineHeight ?? Math.ceil(maxSize * 2), direction: spec.direction ?? 'ltr', lang: spec.lang }
  paragraph.runs = leafRuns(paragraph, content)
  return { paragraph, inline: { content, textIndent: spec.textIndent ?? 0, textAlign: spec.textAlign ?? 'start', lineSlots: [...(spec.lineSlots ?? [])] } }
}

export type Emitter = {
  readonly cases: Case[]
  // One paragraph shape at each distinct width. `note` lands in the origin for diagnosis.
  shape(pageLang: string, base: Paragraph, widths: readonly number[], note?: string): void
}

export function emitter(family: string, seed: string): Emitter {
  const cases: Case[] = []
  let shape = 0
  return {
    cases,
    shape(pageLang, base, widths, note = '') {
      shape++
      const seen = new Set<number>()
      for (let i = 0; i < widths.length; i++) {
        const width = widths[i]!
        if (seen.has(width)) continue
        seen.add(width)
        cases.push(makeCase({
          family, origin: `generator=${family} seed=${seed} shape=${shape}${note === '' ? '' : ` ${note}`}`,
          pageLang, paragraph: { ...base, width },
        }))
      }
    },
  }
}
