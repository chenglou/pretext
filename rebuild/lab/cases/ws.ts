// White space and control families (prefix 'ws/'): controls under every white-space value,
// white-space-only bare text nodes around spans, and trailing spaces before a span edge near the
// wrapping width.

import type { Case, FontDecl, Paragraph } from '../types.ts'
import { emitter, font, paragraph, span, text, type Generator, type Part } from './build.ts'
import { createRng, type Rng } from './prng.ts'
import { pickOverflowWrap } from './runs.ts'
import { LATIN_FONTS, phrase, SCRIPT_INFO } from './texts.ts'
import { estimateParagraphWidth, estimateTextWidth, pickWidths, sweepWidths } from './widths.ts'

export const WHITE_SPACES: readonly Paragraph['whiteSpace'][] = ['normal', 'pre', 'pre-wrap', 'pre-line', 'nowrap', 'break-spaces']

const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['CR', '\r'], ['FF', '\f'], ['VT', '\v'], ['TAB', '\t'], ['LF', '\n'], ['CRLF', '\r\n'], ['NBSP', ' '],
  ['ZWSP', '​'], ['WJ', '⁠'], ['SHY', '­'], ['SPACES', ' '],
]

const SENTENCES = ['alpha beta gamma delta epsilon zeta', 'The quick brown fox jumps over the lazy dog', 'extraordinary internationalization tests', 'a b c d e f g h i j'] as const

type Template = (rng: Rng, c: string, words: string[], a: FontDecl, b: FontDecl) => Part[]

const joinRest = (words: string[], from: number): string => words.slice(from).join(' ')

const TEMPLATES: ReadonlyArray<readonly [string, Template]> = [
  ['between', (rng, c, words) => {
    const gaps = new Set(rng.sample(words.map((_, i) => i).slice(1), Math.min(2, words.length - 1)))
    return [text(words.map((word, i) => (i === 0 ? word : `${gaps.has(i) ? c : ' '}${word}`)).join(''))]
  }],
  ['start', (_rng, c, words) => [text(c + words.join(' '))]],
  ['end', (_rng, c, words) => [text(words.join(' ') + c)]],
  ['double', (_rng, c, words) => [text(words[0]! + c + c + joinRest(words, 1))]],
  ['around-space', (_rng, c, words) => [text(`${words[0]!} ${c} ${joinRest(words, 1)}`)]],
  ['in-word', (_rng, c, words) => [text(`extra${c}ordinary ${words.join(' ')}`)]],
  ['cjk', (_rng, c, _words, _a, b) => [span(`中文${c}中文字符${c}日本語テキスト${c}한국어`, font('"Hiragino Sans"', b.size))]],
  ['zwsp-adjacent', (rng, c, words) => [text(rng.chance(0.5) ? `${words[0]!}​${c}${joinRest(words, 1)}` : `${words[0]!}${c}​${joinRest(words, 1)}`)]],
  ['only', (rng, c) => [text(c.repeat(1 + rng.int(3)))]],
  ['span-edge', (_rng, c, words, a, b) => [span(words[0]! + c, a), span(c + joinRest(words, 1), b)]],
  ['text-node', (_rng, c, words, a, b) => [span(words[0]!, a), text(c), span(joinRest(words, 1), b)]],
]

function controls(seed: string): Case[] {
  const family = 'ws/controls'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (const [label, control] of CONTROLS) {
    for (const whiteSpace of WHITE_SPACES) {
      for (const [templateName, template] of rng.sample(TEMPLATES, 6)) {
        const c = label === 'SPACES' ? ' '.repeat(2 + rng.int(4)) : control
        const base = label === 'TAB' && rng.chance(0.5) ? font('"Courier New"', 16) : font(rng.pick(['Arial', 'Arial', 'Georgia', 'Menlo']), rng.pick([14, 16, 18]))
        const a = font(rng.pick(LATIN_FONTS), rng.pick([12, 16, 24]))
        const b = font(rng.pick(LATIN_FONTS), rng.pick([14, 20, 28]))
        const words = rng.pick(SENTENCES).split(' ')
        const p = paragraph({
          font: base, lang: 'en', whiteSpace, overflowWrap: pickOverflowWrap(rng),
          tabSize: label === 'TAB' ? rng.pick([8, 8, 4, 2, 0, 3] as const) : 8,
        }, template(rng, c, words, a, b))
        const wraps = whiteSpace !== 'pre' && whiteSpace !== 'nowrap'
        const widths = pickWidths(rng, estimateParagraphWidth(p), wraps && rng.chance(0.3) ? 2 : 1, { narrowChance: wraps ? 0.1 : 0 })
        emit.shape('en', p, widths, `control=${label} template=${templateName}`)
      }
    }
  }
  return emit.cases
}

const WS_NODES: ReadonlyArray<readonly [string, string]> = [
  ['SP', ' '], ['SP3', '   '], ['TAB', '\t'], ['LF', '\n'], ['LF2', '\n\n'], ['SP-LF-SP', ' \n '], ['CRLF', '\r\n'],
  ['TAB-SP-TAB', '\t \t'], ['FF', '\f'], ['CR', '\r'],
]

type Structure = 'start' | 'end' | 'between' | 'all' | 'ws-span' | 'adjacent'

function textNodes(seed: string): Case[] {
  const family = 'ws/text-nodes'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  const structures: Structure[] = ['start', 'end', 'between', 'all', 'ws-span', 'adjacent']
  for (const whiteSpace of WHITE_SPACES) {
    for (let shape = 0; shape < 36; shape++) {
      const structure = structures[shape % structures.length]!
      const [label, ws] = rng.pick(WS_NODES)
      const script = rng.chance(0.2) ? 'ja' : 'latin'
      const info = SCRIPT_INFO[script]
      const base = font(rng.pick(info.fonts), 16)
      const words = (): Part => span(phrase(rng, script, 3, 18), font(rng.pick(info.fonts), rng.pick([12, 16, 20, 28]), rng.pick([400, 700] as const)))
      let parts: Part[]
      switch (structure) {
        case 'start': parts = [text(ws), words(), text(' '), words()]; break
        case 'end': parts = [words(), text(' '), words(), text(ws)]; break
        case 'between': parts = [words(), text(ws), words(), text(ws), words()]; break
        case 'all': parts = [text(ws), words(), text(ws), words(), text(ws)]; break
        case 'ws-span': parts = [words(), span(ws, font(base.family, 28)), words()]; break
        case 'adjacent': parts = [words(), text(ws), span('', base), text(ws), words()]; break
      }
      const p = paragraph({ font: base, lang: info.lang, whiteSpace, overflowWrap: pickOverflowWrap(rng) }, parts)
      const wraps = whiteSpace !== 'pre' && whiteSpace !== 'nowrap'
      emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), wraps && rng.chance(0.4) ? 2 : 1, { narrowChance: 0.05 }), `structure=${structure} node=${label}`)
    }
  }
  return emit.cases
}

const TRAILERS: ReadonlyArray<readonly [string, string]> = [
  ['SP', ' '], ['SP', ' '], ['SP2', '  '], ['NBSP', ' '], ['IDEOGRAPHIC', '　'], ['TAB', '\t'], ['SP-ZWSP', ' ​'], ['EN', ' '],
]

function trailingSpaceEdge(seed: string): Case[] {
  const family = 'ws/trailing-space-edge'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (let shape = 0; shape < 56; shape++) {
    const whiteSpace = rng.pick(['normal', 'normal', 'pre-wrap', 'break-spaces', 'pre-line'] as const)
    const [label, trailer] = rng.pick(TRAILERS)
    const script = rng.chance(0.2) ? 'ja' : 'latin'
    const info = SCRIPT_INFO[script]
    const a = font(rng.pick(info.fonts), rng.pick([14, 16, 20, 24]))
    let b = font(rng.pick(info.fonts), rng.pick([12, 16, 18, 28]), rng.pick([400, 700] as const))
    if (b.family === a.family && b.size === a.size && b.weight === a.weight) b = font(b.family, b.size + 4, b.weight)
    const first = phrase(rng, script, 6, 28)
    const second = phrase(rng, script, 4, 28)
    const asNode = rng.chance(0.25)
    const leading = rng.chance(0.2) ? ' ' : ''
    const parts: Part[] = asNode
      ? [span(first, a), text(trailer), span(leading + second, b)]
      : [span(first + trailer, a), span(leading + second, b)]
    const p = paragraph({ font: font('Arial', 16), lang: info.lang, whiteSpace, overflowWrap: pickOverflowWrap(rng) }, parts)
    const threshold = estimateTextWidth(first, a)
    emit.shape('en', p, sweepWidths(rng, threshold, 5, 0.8, 1.2), `trailer=${label}${asNode ? ' node' : ''}${leading === '' ? '' : ' leading-space'}`)
  }
  return emit.cases
}

export const WS_GENERATORS: readonly Generator[] = [
  { family: 'ws/controls', generate: controls },
  { family: 'ws/text-nodes', generate: textNodes },
  { family: 'ws/trailing-space-edge', generate: trailingSpaceEdge },
]
