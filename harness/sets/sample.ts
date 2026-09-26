// The real-usage sample: paragraphs drawn in proportion to how often apps lay them out, from weights.json, with a
// fixed seed. A draw picks a surface (chat, AI replies, cards, documents, UI, editorial pages), a script by that
// surface's mix, a text from the pools below, the style settings apps use, and a width from a device, its viewport
// and the app's rule for that surface. Then every group that needs watching, rare as it is, is topped up to
// `minimumPerGroup` draws, drawn the same way but kept only when they fall in the group, and each draw is weighted back
// to its real share: with N first draws, m_g extra draws for group g and P(g) the group's share of first draws (from a
// pilot of 100,000), a draw weighs (N + sum m_g) / (N + sum over its groups of m_g / P(g)).
//
// Text pools, all in the repo, with their sources and licenses in weights.json's `pools`:
// - corpora/*.txt, literature from Wikisource and Project Gutenberg: documents and editorial pages as they are, and cut
//   to chat lengths as stand-ins;
// - Chromium 152's translated UI strings (data/ui-strings.json): UI labels and headings, and stand-ins in scripts no
//   corpus has;
// - pages/demos/masonry/shower-thoughts.json: cards, and English chat cut to chat lengths;
// - the markdown-chat demo's generated messages (pages/demos/markdown-chat.data.ts): AI replies, block by block, as the
//   demo lays them out;
// - table cells made from the shapes filed reports use (#210, #212, #214, #225, #334).
// No chat that users wrote is here: the public sets whose licenses allow it (WildChat-1M, OpenAssistant) aren't
// downloaded yet. So every chat draw, and every draw whose script has no real text for its surface, is marked as a
// stand-in, and the check prints their share.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marked, type Token } from 'marked'
import { createMarkdownChatSpecs } from '../../pages/demos/markdown-chat.data.ts'
import type { Case, Paragraph, TextRun } from '../types.ts'
import { codePoints, createRng, font, makeCase, paragraph, span, textOf, type Rng } from './build.ts'

type Source = string
type Weighted<T> = Array<[T, number, Source]>
type Rate = [number, Source]
type SurfaceName = 'chat' | 'ai' | 'cards' | 'documents' | 'ui' | 'editorial'
const SCRIPTS = ['en', 'latin', 'zh', 'ja', 'ko', 'cyrillic', 'arabic', 'indic', 'thai', 'sea', 'hebrew', 'other'] as const
type Script = (typeof SCRIPTS)[number]
type WidthRule = 'bubble' | 'lane' | 'card' | 'document' | 'ui' | 'editorial'

type SurfaceWeights = {
  scripts: 'chat' | 'ai' | 'web'
  mixedScripts: Rate
  length?: Weighted<string>
  emoji?: Rate
  url?: Rate
  longWord?: Rate
  newline?: Rate
  bold?: Rate
  mention?: Rate
  inlineCode?: Rate
  blocks?: Weighted<'paragraph' | 'list-item' | 'heading' | 'code'>
  kinds?: Weighted<string>
  whiteSpace: Weighted<'normal' | 'pre-wrap'>
  sizes: Weighted<number>
  width: WidthRule
}

// A chat's text width: on a phone, a share of the viewport less padding; on a desktop, by one app's rule,
// min(max, share * min(column, viewport - sidebar)) - padding.
type AppRule = { column: number; sidebar: number; share: number; max: number; padding: number }
type ChatRule = { phone: [number, number]; phonePadding: number; desktop: Weighted<AppRule> }

type Weights = {
  seed: string
  draws: number
  minimumPerGroup: number
  sources: Record<string, string>
  surfaces: Weighted<SurfaceName>
  scripts: Record<'chat' | 'ai' | 'web', Weighted<Script>>
  surface: Record<SurfaceName, SurfaceWeights>
  fonts: {
    kinds: Record<'latin' | 'cjk' | 'arabic' | 'other', Weighted<'web' | 'named' | 'windows' | 'system-ui'>>
    web: Weighted<string>
    webArabic: Weighted<string>
    named: Record<string, Weighted<string>>
    windows: Record<'latin' | 'zh' | 'ja' | 'ko' | 'other', Weighted<string>>
    systemUi: Weighted<string>
  }
  settings: {
    breakAll: Rate
    keepAll: Partial<Record<Script, Rate>>
    letterSpacing: Rate
    letterSpacingValues: Weighted<number>
    pageLanguage: Weighted<'same' | 'none' | 'english'>
  }
  widths: {
    device: Weighted<'mobile' | 'desktop' | 'tablet'>
    mobile: Weighted<number>
    desktop: Weighted<number>
    tablet: Weighted<number>
    rules: {
      bubble: ChatRule
      lane: ChatRule
      card: { twoColumns: number; phonePadding: number; desktop: [number, number] }
      document: { cell: [number, number]; phonePadding: number; desktop: [number, number] }
      ui: { label: [number, number]; phonePadding: number; desktopHeading: [number, number] }
      editorial: { phonePadding: number; desktop: [number, number] }
    }
  }
}

const ROOT = join(import.meta.dir, '../..')
const WEIGHTS = JSON.parse(readFileSync(join(import.meta.dir, 'weights.json'), 'utf8')) as Weights

// Every source names a key of `sources`, a guess, or a file in the repo.
function checkSources(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    const last = value[value.length - 1]
    if (value.length >= 2 && typeof last === 'string' && typeof value[value.length - 2] === 'number') {
      const key = /^([A-Z0-9]+)(?::|$)/.exec(last)?.[1]
      const file = /^([\w./-]+\.\w+)(?::|$)/.exec(last)?.[1]
      const known = key !== undefined ? WEIGHTS.sources[key] !== undefined : file !== undefined ? existsSync(join(ROOT, file)) : /^guess\b/.test(last)
      if (!known) throw new Error(`weights.json ${path}: unknown source "${last}"`)
    }
    for (let i = 0; i < value.length; i++) checkSources(value[i], `${path}[${i}]`)
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k !== 'sources') checkSources(v, `${path}.${k}`)
  }
}
checkSources(WEIGHTS, '')

function pick<T>(rng: Rng, list: Weighted<T>): T {
  let total = 0
  for (let i = 0; i < list.length; i++) total += list[i]![1]
  let at = rng.next() * total
  for (let i = 0; i < list.length; i++) {
    at -= list[i]![1]
    if (at < 0) return list[i]![0]
  }
  return list[list.length - 1]![0]
}

const happens = (rng: Rng, rate: Rate | undefined): boolean => rate !== undefined && rng.next() * 100 < rate[0]
const between = (rng: Rng, [low, high]: readonly [number, number]): number => low + rng.next() * (high - low)

// ---- Text pools ----

// A text and the list it was drawn from, so a text joined to reach a length continues in the same language and source.
type Text = { text: string; lang: string; from: string; pool: readonly Text[] }

const UNSPACED: ReadonlySet<Script> = new Set(['zh', 'ja', 'thai', 'sea'])
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

type Corpus = { id: string; lang: string; paragraphs: Text[]; sentences: Text[] }

function corpusScript(lang: string): Script {
  switch (lang) {
    case 'en': return 'en'
    case 'zh': return 'zh'
    case 'ja': return 'ja'
    case 'ko': return 'ko'
    case 'ar': case 'ur': return 'arabic'
    case 'hi': return 'indic'
    case 'th': return 'thai'
    case 'km': case 'my': return 'sea'
    case 'he': return 'hebrew'
    default: throw new Error(`No script for corpus language ${lang}`)
  }
}

function loadPools(): { corpora: Map<Script, Corpus[]>; ui: Map<Script, Text[]>; shower: Text[]; blocks: Map<string, Block[]> } {
  const sources = JSON.parse(readFileSync(join(ROOT, 'corpora/sources.json'), 'utf8')) as Array<{ id: string; language: string }>
  const corpora = new Map<Script, Corpus[]>()
  for (let i = 0; i < sources.length; i++) {
    const meta = sources[i]!
    if (meta.language === 'mul') continue
    const raw = readFileSync(join(ROOT, `corpora/${meta.id}.txt`), 'utf8')
    // corpora/sources.json names each file's source.
    const from = `corpora/${meta.id}.txt`
    const lines = raw.split('\n')
    const paragraphs: Text[] = []
    const sentences: Text[] = []
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l]!.trim()
      if (line.length < 20 || line.length > 3000) continue
      paragraphs.push({ text: line, lang: meta.language, from: `${from} line ${l + 1}`, pool: paragraphs })
      const parts = line.split(/(?<=[.!?。！？।؟។။])\s*/u)
      for (let s = 0; s < parts.length; s++) if (parts[s]!.length >= 2) sentences.push({ text: parts[s]!, lang: meta.language, from: `${from} line ${l + 1}`, pool: sentences })
    }
    const script = corpusScript(meta.language)
    let list = corpora.get(script)
    if (list === undefined) corpora.set(script, list = [])
    list.push({ id: meta.id, lang: meta.language, paragraphs, sentences })
  }
  const uiData = JSON.parse(readFileSync(join(import.meta.dir, 'data/ui-strings.json'), 'utf8')) as { scripts: Record<string, Script>; strings: Record<string, string[]> }
  const ui = new Map<Script, Text[]>()
  for (const [locale, strings] of Object.entries(uiData.strings)) {
    const script = uiData.scripts[locale]!
    let list = ui.get(script)
    if (list === undefined) ui.set(script, list = [])
    const lang = locale === 'iw' ? 'he' : locale === 'en-GB' ? 'en' : locale
    const texts: Text[] = []
    for (let i = 0; i < strings.length; i++) texts.push({ text: strings[i]!, lang, from: `harness/sets/data/ui-strings.json ${locale} #${i}`, pool: texts })
    list.push(...texts)
  }
  const showerData = JSON.parse(readFileSync(join(ROOT, 'pages/demos/masonry/shower-thoughts.json'), 'utf8')) as string[]
  const shower: Text[] = []
  for (let i = 0; i < showerData.length; i++) shower.push({ text: showerData[i]!, lang: 'en', from: `pages/demos/masonry/shower-thoughts.json #${i}`, pool: shower })
  return { corpora, ui, shower, blocks: demoBlocks() }
}

// ---- The markdown-chat demo's replies, as its blocks ----

type Piece = { text: string; style: 'body' | 'bold' | 'italic' | 'bold-italic' | 'code' | 'link' | 'image' }
type Block = { kind: 'paragraph' | 'list-item' | 'heading' | 'code'; pieces: Piece[]; depth: number; from: string }

function inlinePieces(tokens: readonly Token[], style: Piece['style'], out: Piece[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    switch (token.type) {
      case 'strong': inlinePieces(token.tokens ?? [], style === 'italic' ? 'bold-italic' : 'bold', out); break
      case 'em': inlinePieces(token.tokens ?? [], style === 'bold' ? 'bold-italic' : 'italic', out); break
      case 'codespan': out.push({ text: (token as { text: string }).text, style: 'code' }); break
      case 'link': case 'del': inlinePieces(token.tokens ?? [], token.type === 'link' ? 'link' : style, out); break
      case 'image': out.push({ text: (token as { text: string }).text || 'image', style: 'image' }); break
      case 'br': out.push({ text: '\n', style }); break
      default: {
        const nested = (token as { tokens?: Token[] }).tokens
        if (nested !== undefined && nested.length > 0) inlinePieces(nested, style, out)
        else out.push({ text: (token as { text?: string }).text ?? token.raw, style })
      }
    }
  }
}

function demoBlocks(): Map<string, Block[]> {
  const byKind = new Map<string, Block[]>()
  const add = (input: Block): void => {
    let block = input
    if (block.pieces.map(piece => piece.text).join('').trim() === '') return
    // Neighbouring pieces in one style are one item, as the demo merges them (links stay apart: each has its own href).
    const merged: Piece[] = []
    for (let i = 0; i < block.pieces.length; i++) {
      const piece = block.pieces[i]!
      const previous = merged[merged.length - 1]
      if (previous !== undefined && previous.style === piece.style && piece.style !== 'link' && piece.style !== 'image' && piece.style !== 'code') previous.text += piece.text
      else merged.push({ ...piece })
    }
    block = { ...block, pieces: merged }
    let list = byKind.get(block.kind)
    if (list === undefined) byKind.set(block.kind, list = [])
    list.push(block)
  }
  const specs = createMarkdownChatSpecs(2000)
  const visit = (tokens: readonly Token[], from: string): void => {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      switch (token.type) {
        case 'paragraph': case 'heading': {
          const pieces: Piece[] = []
          inlinePieces(token.tokens ?? [], 'body', pieces)
          // A hard break starts a block of its own, as in the demo.
          let current: Piece[] = []
          for (let p = 0; p <= pieces.length; p++) {
            if (p === pieces.length || pieces[p]!.text === '\n') {
              add({ kind: token.type, pieces: current, depth: (token as { depth?: number }).depth ?? 0, from })
              current = []
            } else current.push(pieces[p]!)
          }
          break
        }
        case 'list':
          for (const item of (token as { items: Array<{ tokens: Token[] }> }).items) {
            const pieces: Piece[] = []
            inlinePieces(item.tokens, 'body', pieces)
            add({ kind: 'list-item', pieces: pieces.filter(piece => piece.text !== '\n'), depth: 0, from })
          }
          break
        case 'code': add({ kind: 'code', pieces: [{ text: (token as { text: string }).text, style: 'body' }], depth: 0, from }); break
        case 'blockquote': visit(token.tokens ?? [], from); break
        default: break
      }
    }
  }
  for (let i = 0; i < specs.length; i++) if (specs[i]!.role === 'assistant') visit(marked.lexer(specs[i]!.markdown, { gfm: true }), `pages/demos/markdown-chat.data.ts createMarkdownChatSpecs(2000) #${i}`)
  return byKind
}

// ---- Building texts ----

// A text cut to at most `length` units: at the last space before it in spaced scripts, else between graphemes.
function cutTo(text: string, length: number, spaced: boolean): string {
  if (text.length <= length) return text
  if (spaced) {
    const space = text.lastIndexOf(' ', length)
    if (space > length / 3) return text.slice(0, space)
  }
  let end = 0
  for (const g of graphemes.segment(text)) {
    if (g.index + g.segment.length > length) break
    end = g.index + g.segment.length
  }
  return text.slice(0, Math.max(end, 1))
}

// A drawn text before its style: plain text (or a demo reply's block, which carries its own styles), where it came from,
// and what was done to it.
type Built = { text: string; block: Block | null; lang: string; from: string; standIn: string | null; kind: string; decorations: string[]; mixed: boolean }

function realOrStandIn(pools: ReturnType<typeof loadPools>, script: Script, rng: Rng, prefer: 'sentence' | 'paragraph'): Text {
  const corpora = pools.corpora.get(script)
  const ui = pools.ui.get(script)
  if (corpora !== undefined && (ui === undefined || rng.chance(0.7))) {
    const corpus = rng.pick(corpora)
    return rng.pick(prefer === 'sentence' ? corpus.sentences : corpus.paragraphs)
  }
  if (ui === undefined) throw new Error(`No text for script ${script}`)
  return rng.pick(ui)
}

// Joins texts from the first one's list until the text reaches `min` units, then cuts it to `max`.
function toLength(first: Text, min: number, max: number, spaced: boolean, rng: Rng): Text {
  let text = first.text
  let tries = 0
  while (text.length < min && tries++ < 50) text += (spaced ? ' ' : '') + rng.pick(first.pool).text
  const target = Math.max(min, Math.min(max, Math.round(between(rng, [min, max]))))
  return { ...first, text: cutTo(text, target, spaced) }
}

const EMOJI = ['\u{1F602}', '\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F60A}', '\u{1F64F}', '\u{1F62D}', '\u{1F525}', '\u{1F44D}\u{1F3FD}', '\u{1F469}\u{200D}\u{1F4BB}', '\u{1F1EF}\u{1F1F5}', '\u{2705}', '\u{1F389}', '\u{1F605}', '\u{1F914}', '\u{1F440}', '\u{1F4AF}', '1\u{FE0F}\u{20E3}', '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}']
const URLS = ['https://example.com/reports/q3?lang=ar&mode=full', 'https://github.com/chenglou/pretext/issues/210', 'www.example.org/docs/getting-started', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.super-long-domain-name.com/api/v1/tracking/xyz12345987654321', 'https://docs.google.com/document/d/1a2B3c4D5e6F7g8H9i0J/edit']
const LONG_WORDS = ['Supercalifragilisticexpialidocious', 'noooooooooooooooooooooooooooooooo', '0x8f3a9c2e7b1d4f6a8c0e2b4d6f8a0c2e', 'node_modules/@types/react/index.d.ts', 'hahahahahahahahahahahahahahahahaha', 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf']
const MENTIONS = ['@alice', '@bob.smith', '@everyone', '@\u{7530}\u{4E2D}', '@mohammed']

// Inserts a word at a random word boundary (spaced scripts) or grapheme boundary.
function insert(rng: Rng, text: string, word: string, spaced: boolean): string {
  if (spaced) {
    const spaces: number[] = []
    for (let i = 0; i < text.length; i++) if (text[i] === ' ') spaces.push(i)
    if (spaces.length === 0 || rng.chance(0.4)) return `${text} ${word}`
    const at = rng.pick(spaces)
    return `${text.slice(0, at)} ${word}${text.slice(at)}`
  }
  const cuts: number[] = []
  for (const g of graphemes.segment(text)) cuts.push(g.index)
  const at = rng.pick([...cuts, text.length])
  return `${text.slice(0, at)}${word}${text.slice(at)}`
}

const OTHER_WORDS: Readonly<Record<string, string>> = { zh: '北京', ja: '東京', ko: '서울', cyrillic: 'Москва', arabic: 'مرحبا', hebrew: 'שלום', indic: 'नमस्ते', thai: 'สวัสดี', en: 'OK' }

function build(pools: ReturnType<typeof loadPools>, surface: SurfaceName, script: Script, w: SurfaceWeights, rng: Rng): Built {
  const spaced = !UNSPACED.has(script)
  const decorations: string[] = []
  let kind = 'text'
  let standIn: string | null = null
  let text: Text
  let rich: Block | null = null
  switch (surface) {
    case 'chat': {
      const [min, max] = pick(rng, w.length!).split('-').map(Number) as [number, number]
      const first = script === 'en' ? rng.pick(pools.shower) : realOrStandIn(pools, script, rng, 'sentence')
      text = toLength(first, min, max, spaced, rng)
      standIn = `${script === 'en' ? 'shower thoughts' : 'real text'} cut or joined to ${min}-${max} units`
      if (happens(rng, w.newline)) {
        text = { ...text, text: `${text.text}\n${cutTo(rng.pick(first.pool).text, 60, spaced)}` }
        decorations.push('newline')
      }
      if (happens(rng, w.emoji)) {
        text = { ...text, text: rng.chance(0.6) ? `${text.text} ${rng.pick(EMOJI)}` : insert(rng, text.text, rng.pick(EMOJI), spaced) }
        decorations.push('emoji')
      }
      if (happens(rng, w.url)) {
        text = { ...text, text: insert(rng, text.text, rng.pick(URLS), true) }
        decorations.push('url')
      }
      if (happens(rng, w.longWord)) {
        text = { ...text, text: insert(rng, text.text, rng.pick(LONG_WORDS), true) }
        decorations.push('long word')
      }
      break
    }
    case 'ai': {
      kind = pick(rng, w.blocks!)
      const blocks = pools.blocks.get(kind)!
      if (script === 'en' || kind === 'code') {
        rich = rng.pick(blocks)
        text = { text: '', lang: 'en', from: rich.from, pool: [] }
        standIn = 'the markdown-chat demo\'s generated reply'
      } else {
        const first = realOrStandIn(pools, script, rng, kind === 'paragraph' ? 'paragraph' : 'sentence')
        text = kind === 'heading' ? { ...first, text: cutTo(first.text, 60, spaced) } : toLength(first, kind === 'paragraph' ? 100 : 20, kind === 'paragraph' ? 1500 : 300, spaced, rng)
        standIn = 'real text in the place of a reply'
      }
      break
    }
    case 'cards':
      if (script === 'en') text = rng.pick(pools.shower)
      else {
        text = toLength(realOrStandIn(pools, script, rng, 'sentence'), 60, 300, spaced, rng)
        standIn = 'real text in the place of a card'
      }
      break
    case 'documents': {
      kind = pick(rng, w.kinds!)
      if (kind === 'table-cell') {
        text = { text: tableCell(rng, script), lang: script === 'zh' ? 'zh' : script === 'ja' ? 'ja' : script === 'ko' ? 'ko' : 'en', from: 'a table cell in the shapes of #210, #212, #214, #225 and #334', pool: [] }
        standIn = 'generated'
        break
      }
      text = pools.corpora.has(script) ? realOrStandIn(pools, script, rng, 'paragraph') : toLength(realOrStandIn(pools, script, rng, 'sentence'), 100, 800, spaced, rng)
      if (!pools.corpora.has(script)) standIn = 'UI strings joined into a paragraph'
      if (kind === 'soft-hyphens') {
        text = { ...text, text: softHyphens(text.text) }
        standIn = 'soft hyphens inserted every few letters of long words'
      }
      break
    }
    case 'ui': {
      kind = pick(rng, w.kinds!)
      const ui = pools.ui.get(script)!
      text = rng.pick(ui)
      if (kind === 'heading') text = { ...text, text: cutTo(text.text, 80, spaced) }
      break
    }
    case 'editorial':
      text = pools.corpora.has(script) ? realOrStandIn(pools, script, rng, 'paragraph') : toLength(realOrStandIn(pools, script, rng, 'sentence'), 200, 1500, spaced, rng)
      if (!pools.corpora.has(script)) standIn = 'UI strings joined into a paragraph'
      break
  }
  const mixed = happens(rng, w.mixedScripts)
  if (mixed && rich === null) {
    const other = script === 'en' || script === 'latin' ? rng.pick(['zh', 'ja', 'ko', 'cyrillic', 'arabic', 'hebrew', 'indic', 'thai']) : 'en'
    text = { ...text, text: insert(rng, text.text, OTHER_WORDS[other]!, spaced) }
    standIn ??= 'a word of another script inserted'
  }
  // Rich spans in chat: a bold word, a mention chip, a code span.
  if (surface === 'chat') {
    if (happens(rng, w.bold)) decorations.push('bold')
    else if (happens(rng, w.mention)) decorations.push('mention')
    else if (happens(rng, w.inlineCode)) decorations.push('code')
  }
  return { text: text.text, block: rich, lang: text.lang, from: text.from, standIn, kind, decorations, mixed: mixed && rich === null }
}

function softHyphens(text: string): string {
  return text.replace(/\p{L}{8,}/gu, word => {
    let out = ''
    const letters = codePoints(word)
    for (let i = 0; i < letters.length; i++) out += (i >= 3 && i <= letters.length - 3 && i % 3 === 0 ? '\u{AD}' : '') + letters[i]
    return out
  })
}

function tableCell(rng: Rng, script: Script): string {
  const n = (digits: number): string => String(rng.int(10 ** digits)).padStart(digits, '0')
  const shapes: Array<() => string> = [
    () => `-0.${n(3)}`, () => `≥-${rng.int(500)}nA`, () => `2025-${n(2)}-${n(2)} ${n(2)}:${n(2)}:${n(2)}`, () => `${rng.int(99)},${n(3)}.${n(2)}€`,
    () => `(${rng.int(99)}.${n(1)})%`, () => `¥${rng.int(9)},${n(3)}`, () => `TKT-${n(5)}`, () => `v${rng.int(9)}.${rng.int(20)}.${rng.int(20)}`,
    () => `192.168.${rng.int(255)}.${rng.int(255)}`, () => `+1 (415) 555-${n(4)}`, () => 'user@example.com', () => 'N/A', () => `${rng.int(99)}.${n(1)} kg`,
    () => `\u{2212}${rng.int(40)} °C`, () => `2026-09-${n(2)}T${n(2)}:${n(2)}Z`, () => `$${rng.int(9)},${n(3)}.${n(2)}`, () => `${rng.int(9)}.${rng.int(9)}e-${rng.int(9)}`,
    () => `SKU-${n(6)}-XL`, () => `${n(2)}:${n(2)}-${n(2)}:${n(2)}`, () => `Q${1 + rng.int(4)} 2026`, () => `#${n(6)}`,
  ]
  const cjk: Array<() => string> = [
    () => '{测试内容.csjg.ysjcxxnr.ypbh}', () => '(试验前-试验后)/试验前', () => `温度-${rng.int(30)}度`, () => `${2020 + rng.int(7)}年${1 + rng.int(12)}月${1 + rng.int(28)}日`,
    () => `甲乙丙.first_week_voltage}户`, () => `₩${rng.int(99)},${n(3)}`, () => `令和${1 + rng.int(8)}年`,
  ]
  return (script === 'zh' || script === 'ja' || script === 'ko') && rng.chance(0.6) ? rng.pick(cjk)() : rng.pick(shapes)()
}

// ---- Style and width ----

function fontGroup(script: Script): 'latin' | 'cjk' | 'arabic' | 'other' {
  switch (script) {
    case 'en': case 'latin': return 'latin'
    case 'zh': case 'ja': case 'ko': return 'cjk'
    case 'arabic': return 'arabic'
    default: return 'other'
  }
}

function familyFor(rng: Rng, script: Script, lang: string, kind: string, mixed: boolean): string {
  const f = WEIGHTS.fonts
  switch (kind) {
    case 'web': return pick(rng, fontGroup(script) === 'arabic' ? f.webArabic : f.web)
    case 'system-ui': return pick(rng, f.systemUi)
    case 'windows': return pick(rng, f.windows[script === 'zh' || script === 'ja' || script === 'ko' ? script : fontGroup(script) === 'latin' ? 'latin' : 'other'])
    default: {
      if (mixed) return pick(rng, f.named['mixed']!)
      const key = script === 'arabic' ? (lang === 'ur' ? 'urdu' : 'arabic') : script === 'latin' || script === 'cyrillic' || script === 'other' ? 'en' : script
      return pick(rng, f.named[key]!)
    }
  }
}

function widthFor(rng: Rng, rule: WidthRule, kind: string): number {
  const r = WEIGHTS.widths.rules
  const device = pick(rng, WEIGHTS.widths.device)
  const viewport = pick(rng, WEIGHTS.widths[device])
  const phone = device !== 'desktop'
  let width: number
  switch (rule) {
    case 'bubble': case 'lane': {
      const chat = r[rule]
      if (phone) width = viewport * between(rng, chat.phone) - chat.phonePadding
      else {
        const app = pick(rng, chat.desktop)
        width = Math.min(app.max, app.share * Math.min(app.column, viewport - app.sidebar)) - app.padding
      }
      break
    }
    case 'card': width = phone ? (rng.next() * 100 < r.card.twoColumns ? (viewport - 48) / 2 - r.card.phonePadding : viewport - 2 * r.card.phonePadding) : between(rng, r.card.desktop); break
    case 'document': width = kind === 'table-cell' ? between(rng, r.document.cell) : phone ? viewport - r.document.phonePadding : between(rng, r.document.desktop); break
    case 'ui': width = kind === 'label' ? between(rng, r.ui.label) : phone ? viewport - r.ui.phonePadding : between(rng, r.ui.desktopHeading); break
    case 'editorial': width = phone ? viewport - r.editorial.phonePadding : between(rng, r.editorial.desktop); break
  }
  return Math.round(width * 100) / 100
}

const RTL = /^[^\p{L}]*[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u
const CODE_FONT = font('"SF Mono", ui-monospace, Menlo, Monaco, monospace', 12, 500)
const INLINE_CODE = font('"SF Mono", ui-monospace, Menlo, Monaco, monospace', 12, 600)
const CHIP = font('Helvetica, Arial, sans-serif', 11, 700)
const HEADING = '"Iowan Old Style", Georgia, "Times New Roman", serif'

// ---- One draw ----

type Draw = { surface: SurfaceName; script: Script; kind: string; paragraph: Paragraph; pageLang: string; fontKind: string; mixed: boolean; standIn: string | null; origin: string }

function draw(pools: ReturnType<typeof loadPools>, rng: Rng): Draw {
  const surface = pick(rng, WEIGHTS.surfaces)
  const w = WEIGHTS.surface[surface]
  const script = pick(rng, WEIGHTS.scripts[w.scripts])
  const built = build(pools, surface, script, w, rng)
  const s = WEIGHTS.settings
  const fontKind = pick(rng, WEIGHTS.fonts.kinds[fontGroup(script)])
  const size = pick(rng, w.sizes)
  let base = font(familyFor(rng, script, built.lang, fontKind, built.mixed), size)
  let whiteSpace: Paragraph['whiteSpace'] = pick(rng, w.whiteSpace)
  let letterSpacing = happens(rng, s.letterSpacing) ? pick(rng, s.letterSpacingValues) : 0
  let runs: Array<string | TextRun> = [built.text]
  if (built.block !== null) {
    const block = built.block
    if (block.kind === 'code') {
      base = CODE_FONT
      whiteSpace = 'pre-wrap'
      runs = [block.pieces[0]!.text]
    } else {
      if (block.kind === 'heading' && block.depth <= 2) {
        base = font(HEADING, block.depth <= 1 ? 20 : 17, 700)
        letterSpacing = Math.round(base.size * -0.01 * 100) / 100
      }
      runs = []
      for (let i = 0; i < block.pieces.length; i++) {
        const piece = block.pieces[i]!
        switch (piece.style) {
          case 'body': runs.push(piece.text); break
          case 'bold': runs.push(span(piece.text, { ...base, weight: 700 }, { letterSpacing })); break
          case 'italic': runs.push(span(piece.text, { ...base, style: 'italic' }, { letterSpacing })); break
          case 'bold-italic': runs.push(span(piece.text, { ...base, weight: 700, style: 'italic' }, { letterSpacing })); break
          case 'link': runs.push(span(piece.text, base, { letterSpacing })); break
          case 'code': runs.push(span(piece.text, INLINE_CODE, { padding: 6 })); break
          case 'image': runs.push(span(piece.text, CHIP, { atomic: true, padding: 7 })); break
        }
      }
    }
  } else if (built.decorations.includes('bold') || built.decorations.includes('mention') || built.decorations.includes('code')) {
    const text = built.text
    const space = text.indexOf(' ')
    const [head, tail] = space < 0 ? [text, ''] : [text.slice(0, space), text.slice(space)]
    if (built.decorations.includes('bold')) runs = [span(head, { ...base, weight: 700 }, { letterSpacing }), tail]
    else if (built.decorations.includes('mention')) runs = [span(rng.pick(MENTIONS), CHIP, { atomic: true, padding: 11 }), ` ${text}`]
    else runs = [head, span(rng.pick(['layout()', 'bun run check', 'npm i', 'git push']), INLINE_CODE, { padding: 7 }), tail]
  }
  if (runs.length > 0 && typeof runs[runs.length - 1] === 'string' && runs[runs.length - 1] === '') runs.pop()
  const text = runs.map(run => (typeof run === 'string' ? run : run.text)).join('')
  const wordBreak: Paragraph['wordBreak'] = happens(rng, s.breakAll) ? 'break-all' : happens(rng, s.keepAll[script]) ? 'keep-all' : 'normal'
  const language = pick(rng, s.pageLanguage)
  const lang = language === 'same' ? built.lang : language === 'none' ? '' : 'en'
  const p = paragraph({
    font: base, lang, width: widthFor(rng, w.width, built.kind), lineHeight: Math.round(base.size * 1.4), letterSpacing,
    whiteSpace, wordBreak, direction: RTL.test(text) ? 'rtl' : 'ltr',
  }, runs)
  const origin = `${built.from}${built.decorations.length === 0 ? '' : `; with ${built.decorations.join(', ')}`}${built.standIn === null ? '' : `; stand-in: ${built.standIn}`}`
  return { surface, script, kind: built.kind, paragraph: p, pageLang: lang, fontKind, mixed: built.mixed, standIn: built.standIn, origin }
}

// ---- Groups and weights ----

const LONG_RUN = /[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Lao}]{30,}/u
const GROUPS: ReadonlyArray<readonly [string, (d: Draw, text: string) => boolean]> = [
  ['word-break break-all', d => d.paragraph.wordBreak === 'break-all'],
  ['pre-wrap with newlines', (d, text) => d.paragraph.whiteSpace === 'pre-wrap' && text.includes('\n')],
  ['URLs and long words', (_, text) => /https?:\/\/|www\./.test(text) || LONG_RUN.test(text)],
  ['keep-all Korean', d => d.script === 'ko' && d.paragraph.wordBreak === 'keep-all'],
  ['soft hyphens in documents', (d, text) => d.surface === 'documents' && text.includes('\u{AD}')],
  ['Windows-only font lists', d => d.fontKind === 'windows'],
  ['letter spacing', d => d.paragraph.letterSpacing !== 0],
  ['mixed scripts', d => d.mixed],
  ['table cells', d => d.kind === 'table-cell'],
  ...SCRIPTS.map(script => [`script ${script}`, (d: Draw) => d.script === script] as const),
]

function groupsOf(d: Draw): number[] {
  const text = textOf(d.paragraph)
  const out: number[] = []
  for (let g = 0; g < GROUPS.length; g++) if (GROUPS[g]![1](d, text)) out.push(g)
  return out
}

export type SampleOptions = { draws: number; minimum: number; pilot: number }
export type SampleGroup = { name: string; share: number; first: number; extra: number; weighted: number }
export type Sample = { cases: Case[]; groups: SampleGroup[]; draws: number; standIn: number; widths: number[] }

const WIDTH_BANDS = [150, 200, 340, 600, Infinity] as const

// The draw with `options` (the checked-in sample uses weights.json's numbers and a pilot of 100,000). Each group's
// `weighted` is the summed weight of its draws, which should come back to its `share` of first draws.
export function drawSample(options: SampleOptions): Sample {
  const pools = loadPools()
  const n = options.draws
  const pilotRng = createRng(`${WEIGHTS.seed}/pilot`)
  const share = new Float64Array(GROUPS.length)
  for (let i = 0; i < options.pilot; i++) for (const g of groupsOf(draw(pools, pilotRng))) share[g]! += 1 / options.pilot
  const rng = createRng(WEIGHTS.seed)
  const draws: Array<{ d: Draw; groups: number[]; stratum: string }> = []
  const count = new Int32Array(GROUPS.length)
  for (let i = 0; i < n; i++) {
    const d = draw(pools, rng)
    const groups = groupsOf(d)
    for (const g of groups) count[g]!++
    draws.push({ d, groups, stratum: 'first draws' })
  }
  const extra = new Int32Array(GROUPS.length)
  for (let g = 0; g < GROUPS.length; g++) {
    if (count[g]! >= options.minimum) continue
    if (share[g] === 0) throw new Error(`The pilot drew nothing in group ${GROUPS[g]![0]}`)
    const groupRng = createRng(`${WEIGHTS.seed}/${GROUPS[g]![0]}`)
    for (let tries = 0; extra[g]! < options.minimum - count[g]!; tries++) {
      if (tries > 20_000_000) throw new Error(`Group ${GROUPS[g]![0]} is too rare to top up`)
      const d = draw(pools, groupRng)
      const groups = groupsOf(d)
      if (!groups.includes(g)) continue
      extra[g]!++
      draws.push({ d, groups, stratum: `extra: ${GROUPS[g]![0]}` })
    }
  }
  let m = 0
  for (let g = 0; g < GROUPS.length; g++) m += extra[g]!
  const raw: number[] = []
  let total = 0
  for (let i = 0; i < draws.length; i++) {
    let denominator = n
    for (const g of draws[i]!.groups) if (extra[g]! > 0) denominator += extra[g]! / share[g]!
    raw.push((n + m) / denominator)
    total += raw[i]!
  }
  const byId = new Map<string, Case>()
  const weighted = new Float64Array(GROUPS.length)
  const widths = WIDTH_BANDS.map(() => 0)
  let standIn = 0
  for (let i = 0; i < draws.length; i++) {
    const { d, groups, stratum } = draws[i]!
    const weight = raw[i]! / total
    for (const g of groups) weighted[g]! += weight
    widths[WIDTH_BANDS.findIndex(band => d.paragraph.width < band)]! += weight
    if (d.standIn !== null) standIn += weight
    const c = makeCase('sample', {
      family: `sample/${d.surface}/${d.kind}/${d.script}`, origin: d.origin, pageLang: d.pageLang, paragraph: d.paragraph,
      sample: { group: stratum, weight: Number(weight.toPrecision(6)), ...(d.standIn === null ? {} : { standIn: true }) },
    })
    // The same input drawn twice is one case with both draws' weight.
    const previous = byId.get(c.id)
    if (previous === undefined) byId.set(c.id, c)
    else previous.sample = { ...previous.sample!, weight: Number((previous.sample!.weight + weight).toPrecision(6)) }
  }
  const out: SampleGroup[] = []
  for (let g = 0; g < GROUPS.length; g++) out.push({ name: GROUPS[g]![0], share: share[g]!, first: count[g]!, extra: extra[g]!, weighted: weighted[g]! })
  return { cases: [...byId.values()], groups: out, draws: draws.length, standIn, widths }
}

// The checked-in draw: weights.json's numbers and a pilot of 100,000.
export function checkedInSample(): Sample {
  return drawSample({ draws: WEIGHTS.draws, minimum: WEIGHTS.minimumPerGroup, pilot: 100_000 })
}

export function sampleReport(sample: Sample): string[] {
  const w = sample.widths
  const out = [
    `sample: ${sample.draws} draws (${WEIGHTS.draws} first, ${sample.draws - WEIGHTS.draws} to reach ${WEIGHTS.minimumPerGroup} per group); stand-ins ${pct(sample.standIn)} of the weight`,
    `  widths by weight: <150 ${pct(w[0]!)}, 150-200 ${pct(w[1]!)}, 200-340 ${pct(w[2]!)}, 340-600 ${pct(w[3]!)}, >=600 ${pct(w[4]!)} (the calibration's guess: 5, 5, 45, 25, 20)`,
  ]
  for (let g = 0; g < sample.groups.length; g++) {
    const group = sample.groups[g]!
    out.push(`  ${group.name}: ${pct(group.share)} of paragraphs, weighted back to ${pct(group.weighted)}; ${group.first} first draws + ${group.extra} extra`)
  }
  return out
}

const pct = (x: number): string => `${(100 * x).toFixed(2)}%`
