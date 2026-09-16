// Styled-run families (prefix 'runs/'): paragraphs made of spans and bare text nodes whose styles
// differ at the run boundaries under test.

import type { Case, FontDecl, Paragraph } from '../types.ts'
import { emitter, font, paragraph, span, text, type Generator, type Part } from './build.ts'
import { createRng, type Rng } from './prng.ts'
import {
  codePointBoundaries, graphemeBoundaries, LATIN_FONTS, MIXED_FONTS, NUMBER_TEXTS, phrase, range, SCRIPT_INFO,
  spaceBoundaries, type Script,
} from './texts.ts'
import { estimateParagraphWidth, pickCjkWidths, pickWidths } from './widths.ts'

const SIZES = [12, 14, 16, 20, 24, 28, 32] as const

export function pickOverflowWrap(rng: Rng): Paragraph['overflowWrap'] {
  const r = rng.next()
  return r < 0.75 ? 'break-word' : r < 0.9 ? 'normal' : 'anywhere'
}

function pickWhiteSpace(rng: Rng, preWrapShare: number): Paragraph['whiteSpace'] {
  const r = rng.next()
  if (r < 1 - preWrapShare) return 'normal'
  return rng.pick(['pre-wrap', 'pre-wrap', 'break-spaces', 'pre-line'] as const)
}

function directionFor(rng: Rng, script: Script): Paragraph['direction'] {
  return SCRIPT_INFO[script].direction === 'rtl' && rng.chance(0.8) ? 'rtl' : 'ltr'
}

function sameFont(a: FontDecl, b: FontDecl): boolean {
  return a.family === b.family && a.size === b.size && a.weight === b.weight && a.style === b.style
}

const ALT_FAMILIES: Record<Script, readonly string[]> = {
  latin: LATIN_FONTS,
  ja: ['"Hiragino Sans"', '"Hiragino Mincho ProN"', '"PingFang SC"'],
  'zh-Hans': ['"PingFang SC"', '"Songti SC"', '"Hiragino Sans"'],
  'zh-Hant': ['"PingFang TC"', '"Songti SC"'],
  ko: ['"Apple SD Gothic Neo"', '"Hiragino Sans"'],
  ar: ['"Geeza Pro"', 'Arial', '"Times New Roman"'],
  he: ['Arial', '"Times New Roman"', '"Courier New"'],
  th: ['Thonburi', 'Arial'],
  hi: ['"Kohinoor Devanagari"', 'Arial'],
  emoji: ['Arial', '"Helvetica Neue"', 'Georgia'],
}

type VaryMode = 'weight' | 'size' | 'family' | 'mixed'

// A font that differs from `previous` along the chosen axis (or axes, for 'mixed').
function varyFont(rng: Rng, base: FontDecl, previous: FontDecl, mode: VaryMode, families: readonly string[]): FontDecl {
  for (let attempt = 0; attempt < 8; attempt++) {
    const all = mode === 'mixed'
    const weight = mode === 'weight' || (all && rng.chance(0.5)) ? (previous.weight >= 600 ? 400 : 700) : base.weight
    const size = mode === 'size' || (all && rng.chance(0.5)) ? rng.pick(SIZES) : base.size
    const family = mode === 'family' || (all && rng.chance(0.5)) ? rng.pick(families) : base.family
    const next = font(family, size, weight, rng.chance(0.08) ? 'italic' : 'normal')
    if (!sameFont(next, previous)) return next
  }
  return font(base.family, base.size === 16 ? 24 : 16, base.weight, base.style)
}

// Words split at code point boundaries, including boundaries inside grapheme clusters.
const SPLIT_WORDS: ReadonlyArray<readonly [Script, string]> = [
  ['latin', 'unbelievable'], ['latin', 'internationalization'], ['latin', 'office'], ['latin', 'efficient'],
  ['latin', 'AVATAR'], ['latin', 'Wikipedia'], ['latin', 'naïve'], ['latin', 'café'], ['latin', 'straße'],
  ['latin', 'x̣́yz'], ['latin', 'co­operation'], ['latin', 'fiﬁne'],
  ['ja', 'がっこう'], ['ja', 'コンピューター'], ['ja', 'がき'], ['zh-Hans', '中华人民共和国'],
  ['ko', '한국어'], ['ko', '한글'],
  ['ar', 'السلام'], ['ar', 'مستشفى'], ['ar', 'بِسْمِ'], ['he', 'שָׁלוֹם'],
  ['th', 'ภาษาไทย'], ['th', 'น้ำใจ'], ['hi', 'क्षत्रिय'], ['hi', 'हिन्दी'],
  ['emoji', '\u{1F469}‍\u{1F4BB}\u{1F468}\u{1F3FD}‍\u{1F52C}'], ['emoji', '\u{1F1EF}\u{1F1F5}\u{1F1EB}\u{1F1F7}'],
  ['emoji', '1️⃣❤️'], ['emoji', 'go\u{1F44D}\u{1F3FD}go'],
]

function splitWord(seed: string): Case[] {
  const family = 'runs/split-word'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (const [script, word] of SPLIT_WORDS) {
    const info = SCRIPT_INFO[script]
    const points = codePointBoundaries(word)
    const clusters = new Set(graphemeBoundaries(word))
    const inside = points.filter(point => !clusters.has(point))
    for (let variant = 0; variant < 4; variant++) {
      const base = font(rng.pick(info.fonts), rng.pick([14, 16, 18, 20, 24]))
      const pieces = points.length >= 2 && rng.chance(0.4) ? 3 : 2
      const cuts = new Set<number>()
      if (inside.length > 0 && rng.chance(0.5)) cuts.add(rng.pick(inside))
      while (cuts.size < Math.min(pieces - 1, points.length)) cuts.add(rng.pick(points))
      const offsets = [0, ...[...cuts].sort((a, b) => a - b), word.length]
      const mode = rng.pick(['weight', 'size', 'family', 'mixed'] as const)
      const wordParts: Part[] = []
      let previous = base
      for (let i = 0; i + 1 < offsets.length; i++) {
        const pieceFont = i === 0 && rng.chance(0.4) ? base : varyFont(rng, base, previous, mode, ALT_FAMILIES[script])
        wordParts.push(span(word.slice(offsets[i], offsets[i + 1]), pieceFont))
        previous = pieceFont
      }
      const separator = info.spaced ? ' ' : ''
      const parts: Part[] = []
      if (rng.chance(0.7)) parts.push(text(phrase(rng, script, 4, 30) + separator))
      parts.push(...wordParts)
      if (rng.chance(0.3)) parts.push(text(separator === '' ? '、' : separator), ...wordParts)
      if (rng.chance(0.7)) parts.push(text(separator + phrase(rng, script, 4, 40)))
      const p = paragraph({ font: base, lang: info.lang, direction: directionFor(rng, script), overflowWrap: pickOverflowWrap(rng) }, parts)
      const cutKinds = [...cuts].sort((a, b) => a - b).map(cut => (clusters.has(cut) ? 'grapheme' : 'in-cluster')).join(',')
      emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), 3, { narrowChance: 0.15 }), `mode=${mode} cuts=${cutKinds}`)
    }
  }
  return emit.cases
}

type SpaceMode = 'end' | 'start' | 'both' | 'node' | 'node-double' | 'span'

function spanAtSpace(seed: string): Case[] {
  const family = 'runs/span-at-space'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  const scripts: Script[] = ['latin', 'latin', 'latin', 'latin', 'ko', 'ar', 'he', 'hi', 'emoji']
  for (let shape = 0; shape < 120; shape++) {
    const script = rng.pick(scripts)
    const info = SCRIPT_INFO[script]
    let words: string[] = []
    for (let attempt = 0; attempt < 6 && words.length < 3; attempt++) words = phrase(rng, script, 30, 90).split(' ').filter(word => word !== '')
    if (words.length < 3) words = ['alpha', 'beta', 'gamma', 'delta']
    const base = font(rng.pick(info.fonts), rng.pick([14, 16, 18, 20]))
    const gaps = rng.sample(range(1, words.length), 1 + rng.int(Math.min(4, words.length - 1)))
    const modes = new Map<number, SpaceMode>()
    for (const gap of gaps) modes.set(gap, rng.pick(['end', 'start', 'both', 'node', 'node-double', 'span'] as const))
    const parts: Part[] = []
    const vary = rng.pick(['weight', 'size', 'family', 'mixed'] as const)
    let currentFont: FontDecl | null = rng.chance(0.3) ? null : varyFont(rng, base, base, vary, ALT_FAMILIES[script])
    let current = words[0]!
    const flush = (): void => {
      parts.push(currentFont === null ? text(current) : span(current, currentFont))
      currentFont = varyFont(rng, base, currentFont ?? base, vary, ALT_FAMILIES[script])
    }
    const labels: string[] = []
    for (let gap = 1; gap < words.length; gap++) {
      const mode = modes.get(gap)
      const word = words[gap]!
      if (mode === undefined) {
        current += ` ${word}`
        continue
      }
      labels.push(mode)
      switch (mode) {
        case 'end': current += ' '; flush(); current = word; break
        case 'start': flush(); current = ` ${word}`; break
        case 'both': current += ' '; flush(); current = ` ${word}`; break
        case 'node': flush(); parts.push(text(' ')); current = word; break
        case 'node-double': flush(); parts.push(text('  ')); current = word; break
        case 'span': flush(); parts.push(span(' ', varyFont(rng, base, base, 'size', ALT_FAMILIES[script]))); current = word; break
      }
    }
    parts.push(currentFont === null ? text(current) : span(current, currentFont))
    const p = paragraph({
      font: base, lang: info.lang, direction: directionFor(rng, script), whiteSpace: pickWhiteSpace(rng, 0.4), overflowWrap: pickOverflowWrap(rng),
    }, parts)
    emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), 3, { narrowChance: 0.05 }), `modes=${labels.join(',')}`)
  }
  return emit.cases
}

function mixedFontsSizes(seed: string): Case[] {
  const family = 'runs/mixed-fonts-sizes'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  for (let shape = 0; shape < 120; shape++) {
    const count = 3 + rng.int(6)
    const parts: Part[] = []
    let rtl = 0
    for (let i = 0; i < count; i++) {
      const [familyName, script] = rng.pick(MIXED_FONTS)
      const info = SCRIPT_INFO[script]
      if (info.direction === 'rtl') rtl++
      const size = rng.pick([10, 12, 13, 14, 16, 18, 20, 24, 28, 32] as const)
      const weight = rng.pick([400, 400, 400, 400, 700, 700, 300, 500] as const)
      const style = script === 'latin' && rng.chance(0.12) ? 'italic' : 'normal'
      if (i > 0 && rng.chance(0.7)) parts.push(text(' '))
      parts.push(span(phrase(rng, script, 2, 24), font(familyName, size, weight, style)))
    }
    const base = font(rng.pick(MIXED_FONTS)[0], 16)
    const direction = rtl * 2 > count && rng.chance(0.7) ? 'rtl' : rng.chance(0.1) ? 'rtl' : 'ltr'
    const p = paragraph({ font: base, lang: 'en', direction, overflowWrap: pickOverflowWrap(rng) }, parts)
    emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), 3, { narrowChance: 0.08 }), `runs=${count}`)
  }
  return emit.cases
}

function cutText(rng: Rng, value: string, script: Script, pieces: number): string[] {
  const spaced = SCRIPT_INFO[script].spaced
  const r = rng.next()
  const boundaries = spaced && r < 0.6 ? spaceBoundaries(value) : r < 0.85 ? graphemeBoundaries(value) : codePointBoundaries(value)
  const cuts = rng.sample(boundaries, pieces - 1).sort((a, b) => a - b)
  const out: string[] = []
  let from = 0
  for (const cut of cuts) {
    out.push(value.slice(from, cut))
    from = cut
  }
  out.push(value.slice(from))
  return out.filter(piece => piece !== '')
}

const LETTER_SPACINGS = [-3, -2, -1, -0.5, 0, 0.25, 0.5, 1, 2, 3, 5, 8] as const

function letterSpacingSpans(seed: string): Case[] {
  const family = 'runs/letter-spacing-spans'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  const scripts: Script[] = ['latin', 'latin', 'latin', 'latin', 'ja', 'zh-Hans', 'ko', 'ar', 'th', 'he', 'emoji']
  for (let shape = 0; shape < 120; shape++) {
    const script = rng.pick(scripts)
    const info = SCRIPT_INFO[script]
    const base = font(rng.pick(info.fonts), rng.pick([14, 16, 20, 24]))
    const paragraphSpacing = rng.pick([0, 0, 0, 1, -1, 2, 0.5] as const)
    const pieces = cutText(rng, phrase(rng, script, 20, 80), script, 2 + rng.int(4))
    const varySize = rng.chance(0.3)
    const parts: Part[] = pieces.map(piece => (rng.chance(0.2)
      ? text(piece)
      : span(piece, varySize ? font(base.family, rng.pick(SIZES)) : base, { letterSpacing: rng.pick(LETTER_SPACINGS) })))
    const p = paragraph({
      font: base, lang: info.lang, letterSpacing: paragraphSpacing, direction: directionFor(rng, script),
      whiteSpace: pickWhiteSpace(rng, 0.15), overflowWrap: pickOverflowWrap(rng),
    }, parts)
    const natural = estimateParagraphWidth(p)
    const widths = info.cjk && script !== 'ko' ? pickCjkWidths(rng, natural, base.size, 3, { narrowChance: 0.08 }) : pickWidths(rng, natural, 3, { narrowChance: 0.08 })
    emit.shape('en', p, widths)
  }
  return emit.cases
}

const WORD_SPACINGS = [-8, -4, -2, -1, 0, 1, 2, 4, 8, 16] as const

function wordSpacingSpans(seed: string): Case[] {
  const family = 'runs/word-spacing-spans'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  const scripts: Script[] = ['latin', 'latin', 'latin', 'latin', 'ko', 'ar', 'he', 'hi', 'emoji']
  for (let shape = 0; shape < 120; shape++) {
    const script = rng.pick(scripts)
    const info = SCRIPT_INFO[script]
    const whiteSpace = pickWhiteSpace(rng, 0.3)
    const separators = [' ', ' ', ' ', ' ', ' ', '　', ' ', ' ', ...(whiteSpace === 'normal' ? [] : ['\t'])]
    const spaceVariant = rng.chance(0.4)
    let value = phrase(rng, script, 30, 90)
    if (spaceVariant) value = value.replace(/ /g, () => rng.pick(separators))
    const base = font(rng.pick(info.fonts), rng.pick([14, 16, 18, 20]))
    const pieces = cutText(rng, value, script, 2 + rng.int(4))
    const parts: Part[] = pieces.map(piece => (rng.chance(0.2)
      ? text(piece)
      : span(piece, base, { wordSpacing: rng.pick(WORD_SPACINGS), ...(rng.chance(0.2) ? { letterSpacing: rng.pick([1, -1] as const) } : {}) })))
    const p = paragraph({
      font: base, lang: info.lang, wordSpacing: rng.pick([0, 0, 0, 2, -2, 6] as const), direction: directionFor(rng, script),
      whiteSpace, overflowWrap: pickOverflowWrap(rng),
    }, parts)
    emit.shape('en', p, pickWidths(rng, estimateParagraphWidth(p), 3, { narrowChance: 0.05 }), spaceVariant ? 'separators=mixed' : '')
  }
  return emit.cases
}

const LANG_TEXTS: Record<string, readonly string[]> = {
  ja: ['「こんにちは」と言った。', '“quote clusters” も確認してください。', 'ちょっと待って！ァィゥ、ーー。', '約3ヶ月、東京々〜。', '日本？ァア', '‘かな’かな'],
  'zh-Hans': ['他说“你好”，然后走了。', '《书名》：标点；符号……', '价格是¥12,800元（含税）。', '中文‘abc’中文'],
  'zh-Hant': ['「四叔」是一個講理學的老監生。', '他說：「你好嗎？」', '臺灣‧香港——澳門', '“繁體”與‘引號’'],
  ko: ['“안녕하세요!” 그녀가 말했다.', '했다.”라고 말했다.', '서울（종로구）', '‘한국어’ 문장'],
  en: ['He said “hello”—then left…', '‘Single’ and “double” quotes', 'CJK punctuation 「like this」、and this。', '“中文”and“日本語”'],
}
const SHARED_LANG_TEXTS = ['“中文”', '「日本語」', '“abc”中文', '中文“abc”中文', '…—', '‘かな’', '・', '〜', 'ー', '“한국어”', '‘’“”', '（注）'] as const
const LANGS = ['ja', 'zh-Hans', 'zh-Hant', 'ko', 'en'] as const
const LANG_FONTS: Record<string, string> = {
  ja: '"Hiragino Sans"', 'zh-Hans': '"PingFang SC"', 'zh-Hant': '"PingFang TC"', ko: '"Apple SD Gothic Neo"', en: 'Arial',
}

function langSpans(seed: string): Case[] {
  const family = 'runs/lang-spans'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  const families = [
    '"Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", Arial, sans-serif',
    '"Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", Arial, sans-serif',
    'Arial, "Hiragino Sans", sans-serif',
    '"PingFang SC", sans-serif',
    'sans-serif',
    'serif',
  ]
  for (let shape = 0; shape < 120; shape++) {
    const pageLang = rng.chance(0.8) ? 'en' : rng.pick(['ja', 'zh-Hans', 'ko'] as const)
    const paragraphLang = rng.pick(LANGS)
    const spanLangs = LANGS.filter(lang => lang !== paragraphLang && lang !== pageLang)
    const base = font(rng.pick(families), rng.pick([16, 18, 20]))
    const parts: Part[] = []
    const count = 2 + rng.int(4)
    const labels: string[] = []
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0 && rng.chance(0.8)) {
        parts.push(text(rng.pick(LANG_TEXTS[paragraphLang]!)))
        continue
      }
      const lang = rng.pick(spanLangs)
      labels.push(lang)
      const value = rng.chance(0.6) ? rng.pick(LANG_TEXTS[lang]!) : rng.pick(SHARED_LANG_TEXTS)
      const spanFont = rng.chance(0.7) ? base : font(LANG_FONTS[lang]!, base.size)
      parts.push(span(value, spanFont, { lang }))
    }
    const lineBreak = rng.chance(0.7) ? 'auto' : rng.pick(['strict', 'normal', 'loose'] as const)
    const p = paragraph({ font: base, lang: paragraphLang, lineBreak, wordBreak: rng.chance(0.1) ? 'keep-all' : 'normal', overflowWrap: pickOverflowWrap(rng) }, parts)
    emit.shape(pageLang, p, pickCjkWidths(rng, estimateParagraphWidth(p), base.size, 3, { narrowChance: 0.05 }), `spanLangs=${labels.join(',')}`)
  }
  return emit.cases
}

const BIDI_PUNCTUATION = ['،', '؟', '!', '.', ':', '«', '»', '(', ')', '—', '״'] as const

function bidiRuns(seed: string): Case[] {
  const family = 'runs/bidi-runs'
  const rng = createRng(`${seed}/${family}`)
  const emit = emitter(family, seed)
  type Kind = 'ar' | 'he' | 'latin' | 'number' | 'punct'
  for (let shape = 0; shape < 140; shape++) {
    const direction = rng.chance(0.5) ? 'rtl' : 'ltr'
    const rtlScript = rng.chance(0.6) ? 'ar' : 'he'
    const paragraphLang = rng.pick([rtlScript, rtlScript, 'en'] as const)
    const pageLang = rng.chance(0.7) ? 'en' : paragraphLang
    const base = paragraphLang === 'ar' ? font('"Geeza Pro"', rng.pick([16, 18, 20])) : font(rng.pick(['Arial', '"Times New Roman"']), rng.pick([16, 18, 20]))
    const count = 3 + rng.int(5)
    const kinds: Kind[] = [rtlScript, rng.pick(['latin', 'number'] as const)]
    while (kinds.length < count) kinds.push(rng.pick(['ar', 'he', 'latin', 'number', 'punct', rtlScript, rtlScript] as const))
    const order = rng.sample(kinds, kinds.length)
    const parts: Part[] = []
    for (let i = 0; i < order.length; i++) {
      const kind = order[i]!
      if (i > 0 && kind !== 'punct') {
        const r = rng.next()
        if (r < 0.7) parts.push(text(' '))
      }
      switch (kind) {
        case 'ar':
        case 'he': {
          const value = phrase(rng, kind, 3, 30)
          const scriptFont = kind === 'ar' ? font('"Geeza Pro"', rng.pick([14, 16, 20, 24])) : font(rng.pick(['Arial', '"Times New Roman"']), rng.pick([14, 16, 20, 24]))
          const words = value.split(' ')
          const first = words[0]!
          const points = codePointBoundaries(first)
          if (kind === 'ar' && points.length > 0 && rng.chance(0.3)) {
            // A word split across two spans with different weights: joining across the span boundary.
            const cut = rng.pick(points)
            parts.push(span(first.slice(0, cut), scriptFont), span(first.slice(cut) + (words.length > 1 ? ` ${words.slice(1).join(' ')}` : ''), font(scriptFont.family, scriptFont.size, 700)))
          } else {
            parts.push(span(value, scriptFont))
          }
          break
        }
        case 'latin':
          parts.push(span(phrase(rng, 'latin', 3, 24), font(rng.pick(['Arial', 'Georgia', '"Helvetica Neue"']), rng.pick([12, 16, 20, 28]))))
          break
        case 'number':
          parts.push(rng.chance(0.5) ? text(rng.pick(NUMBER_TEXTS)) : span(rng.pick([...NUMBER_TEXTS, '2026', '3.14', '(12)', '2026/03/10', '١٥٪']), font('Arial', rng.pick([14, 16, 20]))))
          break
        case 'punct':
          parts.push(text(rng.pick(BIDI_PUNCTUATION)))
          break
      }
    }
    const p = paragraph({ font: base, lang: paragraphLang, direction, overflowWrap: pickOverflowWrap(rng), whiteSpace: pickWhiteSpace(rng, 0.1) }, parts)
    emit.shape(pageLang, p, pickWidths(rng, estimateParagraphWidth(p), 3, { narrowChance: 0.05 }), `kinds=${order.join(',')}`)
  }
  return emit.cases
}

export const RUN_GENERATORS: readonly Generator[] = [
  { family: 'runs/split-word', generate: splitWord },
  { family: 'runs/span-at-space', generate: spanAtSpace },
  { family: 'runs/mixed-fonts-sizes', generate: mixedFontsSizes },
  { family: 'runs/letter-spacing-spans', generate: letterSpacingSpans },
  { family: 'runs/word-spacing-spans', generate: wordSpacingSpans },
  { family: 'runs/lang-spans', generate: langSpans },
  { family: 'runs/bidi-runs', generate: bidiRuns },
]
