// Rich-inline templates: paragraphs of spans, which the adapter lays out with rich-inline (one item per run, a chip as
// `break: 'never'`, padding as `extraWidth`), before widths.ts finds where each browser's lines change.
// - main's same-font inline items (its rich-boundaries family and #210's rich witnesses), from catalog.ts;
// - the shapes of main's engine facts about rich items (src/layout.test.ts:893, 966, 2604, 2642, 3649, and 3695, whose
//   shapes are 2604's);
// - filed reports: #177 (punctuation split across items), #120 (CJK in rich mode), #171 (a bold first letter), #323 (a
//   soft hyphen in the item after a bold word);
// - styles changing at run boundaries (weight, size, family, italic, letter spacing) over the accuracy texts, as the
//   rebuild's runs families do, and spaces at span edges;
// - chips and code spans as the demos write them: an atomic mention chip with padding, and inline code with padding
//   that can break (pages/demos/rich-note.model.ts, markdown-chat.model.ts).
import { TEXTS } from '../../src/test-data.ts'
import type { CssFont, TextRun } from '../types.ts'
import { codePoints, createRng, font, paragraph, span } from './build.ts'
import type { Template } from './widths.ts'

const ARIAL = font('Arial', 16)
const HELVETICA = font('"Helvetica Neue"', 15)
const INTER = font('Inter', 14)
const GEORGIA = font('Georgia', 17)
const BOLD = (f: CssFont): CssFont => ({ ...f, weight: 700 })
const ITALIC = (f: CssFont): CssFont => ({ ...f, style: 'italic' })
const CODE = font('"SF Mono", ui-monospace, Menlo, Monaco, monospace', 12, 600)
const CHIP = font('"Helvetica Neue", Helvetica, Arial, sans-serif', 12, 700)

type Part = string | TextRun

function template(family: string, origin: string, base: CssFont, parts: readonly Part[], lang = 'en'): Template {
  const direction = lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr'
  return { family: `rich/${family}`, origin, pageLang: lang, widths: [], grid: true, paragraph: paragraph({ font: base, lang, direction }, parts) }
}

// A span in the base font: an inline element whose style doesn't change, as main's same-font items are.
const item = (text: string, f: CssFont = ARIAL): TextRun => span(text, f)

export function richTemplates(fromMain: readonly Template[]): Template[] {
  const out: Template[] = fromMain.map(t => ({ ...t, family: `rich/${t.family}` }))
  const facts: ReadonlyArray<readonly [string, readonly string[], string?]> = [
    ['893', [' \u{200B}\u{301}ab', 'c']], ['893', ['x', '\t\u{200B}\u{301}ab']],
    ['966', ['ab\u{85}', 'cd']], ['966', ['ab foo', '\u{85}b']],
    ['2604', ['see (', 'docs', ') now please']], ['2604', ['We like ', 'Pretext', '\'s speed a lot']], ['2604', ['now 50', '% faster than before']],
    ['2604', ['中文中文', '。日本語'], 'zh'], ['2604', ['ちょっと待', 'ってください'], 'ja'], ['2604', ['he said \u{201C}hello', '\u{201D} and left']],
    ['2604', ['a xxxx', '，b']], ['2642', ['T', 'po\u{AD}d']], ['3649', ['ความสวยง', 'ามของธรรมชาติ'], 'th'], ['3649', ['မြန်မာဘာသ', 'ာသည်လှပသည်'], 'my'],
  ]
  for (let i = 0; i < facts.length; i++) {
    const [line, parts, lang] = facts[i]!
    out.push(template(`facts/layout.test.ts:${line}`, `src/layout.test.ts:${line}`, ARIAL, parts.map(part => item(part)), lang))
  }
  for (const parts of [['Hello', ',', ' world again'], ['a word', '.', ' Next'], ['(', 'docs', ') here'], ['state-', 'of-the-art tools'], ['中文', '，', '中文中文'], ['"', 'quoted', '" text']]) {
    out.push(template('reported/#177', 'github.com/chenglou/pretext/issues/177: punctuation split across adjacent items', ARIAL, parts.map(part => item(part)), /[一-龥]/.test(parts[0]!) ? 'zh' : 'en'))
  }
  out.push(template('reported/#120', 'github.com/chenglou/pretext/issues/120: CJK fragments in rich mode', HELVETICA,
    ['这是一段', span('粗体文字', BOLD(HELVETICA)), '和', span('inline code', CODE, { padding: 6 }), '混排的中文句子。'], 'zh'))
  for (const [first, rest] of [['P', 'retext lays out text'], ['T', 'he quick brown fox'], ['中', '文排版测试']] as const) {
    out.push(template('reported/#171', 'github.com/chenglou/pretext/issues/171: a bold first letter then the rest of the word', GEORGIA, [span(first, BOLD(GEORGIA)), span(rest, GEORGIA)], /[一-龥]/.test(first) ? 'zh' : 'en'))
  }
  for (const text of ['na\u{AD}tion\u{AD}al', 'po\u{AD}d']) {
    out.push(template('reported/#323', 'github.com/chenglou/pretext/issues/323: a soft hyphen in the item after a bold word', ARIAL, ['the ', span('inter', BOLD(ARIAL)), text]))
  }
  // Spaces at span edges.
  for (const [a, b] of [['hello ', 'world'], ['hello', ' world'], ['hello ', ' world'], ['hello  ', 'world'], ['hello', '\u{A0}world'], ['hello\u{200B}', 'world']] as const) {
    out.push(template('span-edges', 'spaces and breaks at the edge of a bold span', ARIAL, [a, span(b, BOLD(ARIAL)), ' and more words']))
  }
  // Styles that change at run boundaries, over the accuracy texts (src/test-data.ts).
  const rng = createRng('harness-rich-runs')
  const bases = [ARIAL, HELVETICA, INTER, GEORGIA]
  for (let i = 0; i < TEXTS.length; i++) {
    const text = TEXTS[i]!.text
    if (text.trim().length < 12) continue
    for (let variant = 0; variant < 3; variant++) {
      const base = rng.pick(bases)
      const cuts = new Set<number>()
      const chars = codePoints(text)
      const points = chars.length
      while (cuts.size < 1 + rng.int(3)) cuts.add(1 + rng.int(points - 1))
      const offsets = [0, ...[...cuts].sort((x, y) => x - y), points]
      const parts: Part[] = []
      for (let k = 0; k + 1 < offsets.length; k++) {
        const piece = chars.slice(offsets[k], offsets[k + 1]).join('')
        const style = rng.pick(['bold', 'italic', 'size', 'family', 'spacing', 'plain'] as const)
        switch (style) {
          case 'bold': parts.push(span(piece, BOLD(base))); break
          case 'italic': parts.push(span(piece, ITALIC(base))); break
          case 'size': parts.push(span(piece, { ...base, size: rng.pick([12, 13, 18, 20, 24]) })); break
          case 'family': parts.push(span(piece, { ...base, family: rng.pick(['Georgia', '"Courier New"', 'Verdana', '"Times New Roman"']) })); break
          case 'spacing': parts.push(span(piece, base, { letterSpacing: rng.pick([-0.5, 1, 2]) })); break
          case 'plain': parts.push(piece); break
        }
      }
      const lang = /[\u{600}-\u{6FF}]/u.test(text) ? 'ar' : /[\u{5D0}-\u{5EA}]/u.test(text) ? 'he' : /[一-龥]/.test(text) ? 'zh' : /[ぁ-ヿ]/.test(text) ? 'ja' : /[가-힣]/.test(text) ? 'ko' : /[\u{E00}-\u{E7F}]/u.test(text) ? 'th' : 'en'
      out.push(template('runs', `src/test-data.ts ${TEXTS[i]!.label}, split into styled runs`, base, parts, lang))
    }
  }
  // Chips and code spans in chat-like sentences.
  const sentences: ReadonlyArray<readonly [string, string, string]> = [
    ['Thanks ', '@alice', ' for the review, merging now'], ['cc ', '@bob.smith', ' can you take a look at this before Friday?'],
    ['Run ', 'bun run check', ' before you push'], ['The ', 'layout()', ' call is the hot path, keep it free of string work'],
    ['見てください ', '@田中', ' さんのコメント'], ['Use ', 'prepareWithSegments(text, font)', ' for line ranges'],
    ['Deployed to ', 'https://example.com/app', ' just now'], ['', '@everyone', ' standup moved to 10:30'],
  ]
  for (let i = 0; i < sentences.length; i++) {
    const [before, middle, after] = sentences[i]!
    const chip = middle.startsWith('@')
    const run = chip ? span(middle, CHIP, { atomic: true, padding: 11 }) : span(middle, CODE, { padding: 7 })
    const lang = /[ぁ-ヿ一-龥]/.test(before) ? 'ja' : 'en'
    out.push(template(chip ? 'chips' : 'code-spans', chip ? 'an atomic mention chip with padding (pages/demos/rich-note.model.ts)' : 'inline code with padding (pages/demos/rich-note.model.ts)',
      HELVETICA, [...(before === '' ? [] : [before]), run, after], lang))
  }
  return out
}
