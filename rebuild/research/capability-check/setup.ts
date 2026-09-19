// Shared by the capability-check scripts (research scratch, unmerged): three environments, four paragraphs, and the
// stand-in Canvas of tools/stand-in-canvas.ts with its question counter. Nothing here says anything about a browser: the
// stand-in's widths are a fixed function of the context and the string. What the scripts show is which calls exist, what
// they return, and how many Canvas questions each step asks.
import { NO_BOX_EDGE, PINNED_BUILDS, UNKNOWN_FONT_FACTS, fillLine, firstLine, prepare, type Environment, type FillResult, type FontDecl, type InlineElement, type InlineNode, type LineSlot, type LineStart, type OverflowWrap, type Paragraph, type Prepared } from '../../src/index.ts'
import { installStandInCanvas, type Asked, type StandIn } from '../../tools/stand-in-canvas.ts'

export type EngineName = Environment['engine']
export const ENGINES: readonly EngineName[] = ['blink', 'webkit', 'gecko']

const AGENTS: Record<EngineName, string> = {
  blink: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  gecko: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0',
}

// A Retina Mac at browser zoom 1: Blink's layout zoom is 2, so its LayoutUnits count 1/128 of a CSS px.
export const DPR = 2

export function envOf(engine: EngineName, pageLang: string): Environment {
  switch (engine) {
    case 'blink': return { engine, build: PINNED_BUILDS.blink, devicePixelRatio: DPR, pageLang, contentLanguage: null, uiLanguage: 'en-US', dictionaryBreaks: { kind: 'v8-break-iterator' } }
    case 'webkit': return { engine, build: PINNED_BUILDS.webkit, devicePixelRatio: DPR, pageZoom: 1, pageLang, contentLanguage: null, preferredLanguages: ['en-US'], icuDefaultLocale: 'en_US_POSIX', dictionaryBreaks: { kind: 'intl-segmenter-word' } }
    case 'gecko': return { engine, build: PINNED_BUILDS.gecko, devicePixelRatio: DPR, pageLang, contentLanguage: null, regionalPrefsLocale: 'en-us', dictionaryBreaks: { kind: 'intl-segmenter-word' } }
  }
}

export function standInFor(engine: EngineName, pageLang: string): StandIn {
  return installStandInCanvas({ userAgent: AGENTS[engine], devicePixelRatio: DPR, pageLang })
}

const font = (family: string, size: number, weight = 400): FontDecl => ({ family, size, weight, style: 'normal', facts: UNKNOWN_FONT_FACTS })

// `--wrap=normal` on a script's command line lays the samples out with overflow-wrap: normal; the default is break-word,
// which is what main's demos mean (a word wider than the line breaks inside).
const WRAP: OverflowWrap = process.argv.includes('--wrap=normal') ? 'normal' : 'break-word'

function block(content: InlineNode[], f: FontDecl, overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    content, font: f, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: WRAP, lineBreak: 'auto', tabSize: 8,
    lang: 'en', direction: 'ltr', lineHeight: Math.round(f.size * 1.5), textIndent: 0, textAlign: 'start', ...overrides,
  }
}

function span(p: Paragraph, children: InlineNode[], overrides: Partial<InlineElement> = {}): InlineElement {
  return {
    font: p.font, letterSpacing: p.letterSpacing, wordSpacing: p.wordSpacing, whiteSpace: p.whiteSpace, wordBreak: p.wordBreak, overflowWrap: p.overflowWrap,
    lineBreak: p.lineBreak, tabSize: p.tabSize, kind: 'span', lang: null, inlineStart: NO_BOX_EDGE, inlineEnd: NO_BOX_EDGE, verticalAlign: 'baseline', children, ...overrides,
  }
}

const LATIN = 'The quick brown fox jumps over the lazy dog, and a well-known pneumonoultramicroscopicsilicovolcanoconiosis case follows. '
  + 'Officials confirmed the office affiliate filed its final findings, while traffic flowed past the waffle shop. '
  + 'A line ends where the next word no longer fits; the rest moves down and the measure starts again from there.'
const CJK = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。'
  + '吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。'
const ARABIC = 'في البدء كانت الكلمة، ثم جاءت الكتابة فحفظت ما قاله الناس عبر القرون. يقرأ القارئ السطر من اليمين إلى اليسار، '
  + 'وينتقل إلى السطر التالي عندما تضيق المساحة عن الكلمة القادمة، وهكذا حتى نهاية الفقرة.'

export type Sample = { name: string; paragraph: Paragraph; text: string }

// The concatenation of a tree's text leaves: what source offsets count.
export function sourceText(nodes: readonly InlineNode[]): string {
  let out = ''
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.kind === 'text') out += node.text
    else if (node.kind === 'span') out += sourceText(node.children)
  }
  return out
}

export function samples(): Sample[] {
  const body = font('"Helvetica Neue", Arial, sans-serif', 16)
  const latin = block([{ kind: 'text', text: LATIN }], body)
  const cjk = block([{ kind: 'text', text: CJK }], font('"Hiragino Sans", sans-serif', 16), { lang: 'ja' })
  const arabic = block([{ kind: 'text', text: ARABIC }], font('"Geeza Pro", serif', 18), { lang: 'ar', direction: 'rtl' })
  // A note with a bold span, a link with padding and a border, a chip as an atomic inline, and a <br>.
  const rich = block([], body)
  rich.content = [
    { kind: 'text', text: 'Ship the ' },
    span(rich, [{ kind: 'text', text: 'line breaker' }], { font: font(body.family, 16, 700) }),
    { kind: 'text', text: ' before Friday; see ' },
    span(rich, [{ kind: 'text', text: 'the tracking issue' }], { inlineStart: { margin: 0, border: 1, padding: 4 }, inlineEnd: { margin: 0, border: 1, padding: 4 } }),
    { kind: 'text', text: ' and ping ' },
    { kind: 'atomic', width: 64, height: 20, marginInlineStart: 2, marginInlineEnd: 2 },
    { kind: 'text', text: ' when the office affiliate has signed off.' },
    { kind: 'br' },
    { kind: 'text', text: 'Second paragraph line after a forced break, long enough to wrap at the widths the scripts try.' },
  ]
  const all = [{ name: 'latin', paragraph: latin }, { name: 'cjk', paragraph: cjk }, { name: 'arabic', paragraph: arabic }, { name: 'spans', paragraph: rich }]
  return all.map(s => ({ ...s, text: sourceText(s.paragraph.content) }))
}

export const fullSlot = (width: number): LineSlot => ({ width, left: 0, right: 0 })

// Every line of a prepared paragraph at one width, fills alone: what a count needs.
export function fillAll(prepared: Prepared, width: number): Extract<FillResult, { kind: 'line' }>[] {
  const out: Extract<FillResult, { kind: 'line' }>[] = []
  const slot = fullSlot(width)
  for (let start: LineStart | null = firstLine(prepared); start !== null;) {
    const result = fillLine(prepared, start, slot)
    if (result.kind !== 'line') throw new Error('a slot without insets refused a line')
    out.push(result)
    start = result.next
  }
  return out
}

export const ranges = (lines: readonly { start: number; end: number }[]): string => lines.map(line => `${line.start}-${line.end}`).join(' ')

export function delta(after: Asked, before: Asked): Asked {
  return { calls: after.calls - before.calls, distinct: after.distinct - before.distinct, contexts: after.contexts - before.contexts, characters: after.characters - before.characters }
}

// Runs `body` per engine and sample with the stand-in installed, and restores the globals after each.
export function forEach(body: (engine: EngineName, sample: Sample, env: Environment, standIn: StandIn) => void): void {
  const all = samples()
  for (let e = 0; e < ENGINES.length; e++) {
    for (let s = 0; s < all.length; s++) {
      const engine = ENGINES[e]!
      const sample = all[s]!
      const standIn = standInFor(engine, sample.paragraph.lang)
      try {
        body(engine, sample, envOf(engine, sample.paragraph.lang), standIn)
      } finally {
        standIn.restore()
      }
    }
  }
}

export { prepare }
