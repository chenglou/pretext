import data from './retained.json' with { type: 'json' }
import type { WrappingCase } from '../types.ts'

export type RetainedInput = Omit<WrappingCase, 'id' | 'width'>
type Options = Omit<RetainedInput, 'text' | 'parts' | 'origins' | 'family' | 'scope'> & { origins: number[]; scope?: 'supported' | 'research' }
type WidthSpan = number | { start: number; step: number; count: number }
type Source = ({ text: string; parts?: never } | { parts: string[]; text?: never }) & { widths: WidthSpan[] }
type Group = { family: string; codePoints?: number[]; options: Options[]; samples: Source[] }

function widthsFromSpans(spans: WidthSpan[]): number[] {
  const widths: number[] = []
  for (const span of spans) {
    if (typeof span === 'number') widths.push(span)
    else for (let i = 0; i < span.count; i++) widths.push(span.start + i * span.step)
  }
  return widths
}

// Literal captures share identical source/width lists across correlated option
// records. The only parameterized text uses U+FFF0 as the endpoint sweep's
// codepoint slot; it is replaced before the public input leaves this module.
export function visitRetained(visit: (input: RetainedInput, widths: number[]) => void): void {
  for (const group of data.groups as Group[]) {
    for (const options of group.options) {
      const { origins, ...settings } = options
      const originNames = origins.map(index => {
        const origin = data.origins[index]
        if (origin === undefined) throw new Error(`Invalid fixture origin ${index}`)
        return origin
      })
      for (const sample of group.samples) {
        const widths = widthsFromSpans(sample.widths)
        for (const width of widths) if (!Number.isFinite(width) || width < 0) throw new Error('Invalid fixture width')
        const source = sample.parts === undefined ? sample.text : sample.parts.join('')
        if (group.codePoints === undefined) {
          visit({ scope: 'supported', ...settings, family: group.family, origins: originNames, text: source,
            ...(sample.parts === undefined ? {} : { parts: sample.parts }) }, widths)
        } else {
          for (const codePoint of group.codePoints) {
            const character = String.fromCodePoint(codePoint)
            visit({ scope: 'supported', ...settings, family: group.family.replace('{code}', codePoint.toString(16).toUpperCase().padStart(4, '0')),
              origins: originNames, text: source.replaceAll('\uFFF0', character),
              ...(sample.parts === undefined ? {} : { parts: sample.parts.map(part => part.replaceAll('\uFFF0', character)) }) }, widths)
          }
        }
      }
    }
  }
  visitFollowingSpace(visit)
}

// The full following-space investigation varied paragraph prefix, control item,
// separator length, neighboring scripts and fonts. These are the original finite
// grammars and fixed widths, not newly measured substitutes for old thresholds.
function visitFollowingSpace(visit: (input: RetainedInput, widths: number[]) => void): void {
  const controls = ['', '\u200B', '\u200B\u200B', '\u200C', '\u200D', '\u2060', '\u00AD', '\r', '\f']
  for (const direction of ['ltr', 'rtl'] as const) {
    for (const font of ['16px Arial', '18px Times New Roman', '18px Georgia']) {
      const settings = { font, lineHeight: 24, whiteSpace: 'normal', wordBreak: 'normal', letterSpacing: 0, direction, scope: 'supported' } as const
      const contextOrigin = data.origins[direction === 'ltr' ? 20 : 21]!
      for (const [head, tail] of [['A', 'B'], ['AV', 'tail'], ['Wa', 'Z'], ['ffi', 'A'], ['آگ', 'ب'], ['بِبِ', 'ت'], ['אב', 'גד'], ['Aאב', 'B'], ['😀A', 'B']]) {
        for (const control of controls) for (const space of [' ', '  ', '\t']) {
          visit({ ...settings, family: 'following-space-context', origins: [contextOrigin], text: head! + control + space + tail! }, [1, 8, 12, 24, 48, 100])
        }
      }
      const scopeOrigin = data.origins[direction === 'ltr' ? 22 : 23]!
      for (const prefix of ['', '😀', 'אב ', 'ب ', 'X ', '😀 ']) {
        for (const [head, tail] of [['A', 'B'], ['A', 'אב'], ['A', 'ب'], ['آگ', 'ب'], ['آگ', 'A'], ['אב', 'גד'], ['אב', 'B'], ['A\u00ADV', 'B'], ['ب\u00ADب', 'ت']]) {
          for (const control of controls) for (const space of [' ', '  ']) {
            const parts = [prefix + head!, control, space, tail!]
            visit({ ...settings, family: 'following-space-scope', origins: [scopeOrigin], text: parts.join(''), parts }, [1, 12, 24, 48])
          }
        }
      }
    }
  }
}
