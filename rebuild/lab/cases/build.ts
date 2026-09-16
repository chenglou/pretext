// Builders shared by the generated families: fonts, paragraphs from parts, and a per-family emitter
// that turns one paragraph shape into cases at several widths.

import type { Case, FontDecl, Paragraph, TextRun } from '../types.ts'
import { makeCase } from './case.ts'
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
