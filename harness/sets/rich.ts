// Rich-inline templates: paragraphs of spans, which the adapter lays out with rich-inline (one item per run, a chip as
// `break: 'never'`, padding as `extraWidth`), before widths.ts finds where each browser's lines change. main's same-font
// inline items (its rich-boundaries family and #210's rich witnesses) were taken once as `rich/main/*` cases, which
// `make.ts cut` keeps. The templates:
// - the shapes of main's engine facts about rich items (src/layout.test.ts:893, 966, 2604, 2642, 3649, and 3695, whose
//   shapes are 2604's);
// - filed reports: #177 (punctuation split across items), #120 (CJK in rich mode), #171 (a bold first letter), #323 (a
//   soft hyphen in the item after a bold word);
// - styles changing at run boundaries (weight, size, family, italic, letter spacing) over src/test-data.ts's texts, as
//   the rebuild's runs families do, and spaces at span edges;
// - chips and code spans as the demos write them: an atomic mention chip with padding, and inline code with padding
//   that can break (pages/demos/rich-note.model.ts, markdown-chat.model.ts);
// - the shapes whose lines changed when items began to continue the line instead of starting one, each beside a
//   neighbour, cut on their own since the other templates' widths were searched in older browser builds: a soft hyphen
//   that starts an item after other text, after an ideograph or emoji, before a combining mark or after a space, two
//   soft hyphens that start an item, and a line separator in an item or after a collapsed space before one; then, cut
//   on their own too, an item holding only a soft hyphen between a break and a run that continues it, or after a
//   collapsed space, a newline next to a ZWSP in another item, and a soft hyphen after a space in an item that
//   continues a run from an earlier item, which Chrome breaks at the space (ENGINE_FOLLOWUPS.md); and, cut on their
//   own too, white space after such an item's soft hyphen, white space between an item's soft hyphens, and an item
//   that starts with white space and soft hyphens, whose soft hyphen after the white space Firefox drops; and, cut on
//   their own too, a run of white space that goes on across items past the soft hyphens and bidi controls Firefox
//   drops, one that a soft hyphen starting an item ends, and a ZWSP after white space and soft hyphens where a line
//   starts; and, cut on their own too, a run that a right-to-left mark after its white space ends where one at the white
//   space's bidi level doesn't, one that text after it ends, an atomic item whose leading white space collapses into
//   one, a soft hyphen after no white space, which opens none, and a ZWSP after soft hyphens where a line starts after
//   a wrap; and, cut on their own too, the levels that rule reads: the paragraph's, at each item's offset, of every
//   character the run goes past against the white space before them, with a newline as a space; and, cut on their own
//   too, a soft hyphen that ends an item before a bidi control that starts the next, at the paragraph's start, after a
//   space in the item or a collapsed one before it, which Firefox's scan of the joined text takes as text, and after
//   other text; and, cut on its own too, a padded span that starts with a line separator after a word, before which
//   WebKit's check at an item boundary gives no break (getWebKitBreakBetweenItems in src/line-breaks.ts), so Safari's
//   line that can't fit its padding breaks the word, which rich inline doesn't model (ENGINE_FOLLOWUPS.md);
// - cut on their own too, a line that ends at a space inside an item under negative letter spacing, whose next line the
//   browsers start after the space, beside a break at the collapsed space between items;
// - keep-all paragraphs, cut on their own: a Korean chat message with a mention chip, a bold run inside a word and a
//   code span a particle follows, beside the same message without keep-all; a mention chip inside a Korean word; and
//   Japanese whose bold run ends with a full stop, after which WebKit's check at an item boundary finds no break where
//   one text node breaks (getWebKitBreakBetweenItems in src/line-breaks.ts);
// - pre-wrap paragraphs, cut on their own: preserved spaces at an item's end and start and over three fonts, which hang
//   across the style change, and before a padded span's end and after its start; line feeds at an item's end and start,
//   a blank line across items and a carriage return that ends an item before a line feed that starts the next; a line
//   feed inside a padded span and one that starts a padded span; spaces before a line feed in the next item and at the
//   paragraph's end; tabs after a wider bold span and split across items, and after and inside padded code spans in
//   prose, whose stops count from the line's start; and chips beside preserved spaces and holding their own; then, cut on
//   their own too, a chip before a line feed and one before spaces, which stay on its line however far it overflows,
//   and a padded span that starts with a line feed after a word, whose line Firefox and Safari break inside the word
//   where the padding doesn't fit; and, cut on their own too, that span after a word whose last letter is a bold span
//   of its own, which moves with it, a padded span of only a line feed, whose end edge Safari fits too, and a padded
//   span that starts with a line feed or spaces after a chip, whose opening each engine fits its way; and, cut on
//   their own too, a padded span of only spaces after a chip, which Chrome keeps on the chip's line however far it
//   overflows, one of spaces and a line feed, whose end edge Safari fits too, and a padded span that starts with a line
//   feed or spaces after a word that ends with spaces, whose opening Chrome's line takes with no padding, and before
//   whose line feed, where its padding doesn't fit, Safari keeps the spaces that fit and Firefox all but the last
//   (these padded openings record what the engines do, where rich inline takes the ordinary fit of the span's whole
//   padding: ENGINE_FOLLOWUPS.md, Rich-inline item edges); and, cut on their own too, a
//   chip before preserved spaces split across spans, which all stay on its line however far it overflows, before text
//   and before the paragraph's own text that starts with more of them, and before a tab, which Firefox doesn't hang and
//   moves to the next line with them;
// - boxes (RichInlineBox), cut on their own: custom emoji at the line height between words with spaces on both sides,
//   before punctuation and at the paragraph's end; boxes inside words, of width 0 and beside U+00A0; adjacent boxes, a
//   box wider than most widths and one taller than the line; a box inside a keep-all Korean word; and in pre-wrap,
//   preserved spaces split across items after a box, which stay on its line, a line feed and a tab after one.
import { TEXTS } from '../../src/test-data.ts'
import type { CssFont, Paragraph, TextRun } from '../types.ts'
import { box, codePoints, createRng, font, paragraph, span } from './build.ts'
import type { Template } from './widths.ts'

const ARIAL = font('Arial', 16)
const HELVETICA = font('"Helvetica Neue"', 15)
const INTER = font('Inter', 14)
const GEORGIA = font('Georgia', 17)
const BOLD = (f: CssFont): CssFont => ({ ...f, weight: 700 })
const ITALIC = (f: CssFont): CssFont => ({ ...f, style: 'italic' })
const CODE = font('"SF Mono", ui-monospace, Menlo, Monaco, monospace', 12, 600)
const CHIP = font('"Helvetica Neue", Helvetica, Arial, sans-serif', 12, 700)
const KOREAN = font('"Apple SD Gothic Neo", "Malgun Gothic", sans-serif', 15)
const KOREAN_CHIP = font('"Apple SD Gothic Neo", "Malgun Gothic", sans-serif', 12)
const JAPANESE = font('"Hiragino Sans"', 16)

type Part = string | TextRun

function template(family: string, origin: string, base: CssFont, parts: readonly Part[], lang = 'en', wordBreak: Paragraph['wordBreak'] = 'normal', whiteSpace: Paragraph['whiteSpace'] = 'normal'): Template {
  const direction = lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr'
  return { family: `rich/${family}`, origin, pageLang: lang, widths: [], grid: true, paragraph: paragraph({ font: base, lang, direction, wordBreak, whiteSpace }, parts) }
}

// A span in the base font: an inline element whose style doesn't change, as main's same-font items are.
const item = (text: string, f: CssFont = ARIAL): TextRun => span(text, f)

export function richTemplates(): Template[] {
  const out: Template[] = []
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
  // Styles that change at run boundaries, over src/test-data.ts's texts.
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
  const continued: ReadonlyArray<readonly [string, readonly Part[], string?]> = [
    ['soft-hyphen-start', ['Pre', '\u{AD}text lays out text']], ['soft-hyphen-start', ['na', '\u{AD}tion', 'al parks']],
    ['soft-hyphen-after-ideograph', ['漢字', '\u{AD}ab', 'cd'], 'zh'], ['soft-hyphen-after-ideograph', ['\u{1F60A}', '\u{AD}ab cd']],
    ['soft-hyphen-before-mark', ['abc', '\u{AD}\u{301}def ghi']],
    ['two-soft-hyphens', ['文文', '\u{AD}\u{AD}ab'], 'zh'], ['two-soft-hyphens', ['hello', '\u{AD}\u{AD}world again']],
    ['soft-hyphen-after-space', ['see', ' \u{AD}this', 'word']], ['soft-hyphen-after-space', ['中', ' \u{AD}حبا', 'cd']],
    ['separator', ['first\u{2028}', 'second line']], ['separator', ['hello ', '\u{2028}world']],
    ['consumed-soft-hyphen', ['text\u{200B}', '\u{AD}', '\u{2013}more words']], ['consumed-soft-hyphen', ['中文\u{200B}中\u{200B}', '\u{AD}', '-'], 'zh'],
    ['space-before-consumed-item', ['word ', '\u{AD}', 'more text here']], ['space-before-consumed-item', ['see', ' \u{AD}', 'this word']],
    ['segment-break-by-zwsp', ['ab\u{200B}', '\n\u{AD}\ncd ef']], ['segment-break-by-zwsp', ['word\n', '\u{200B}next words']],
    ['soft-hyphen-after-space-in-run', ['中文a', 'b \u{AD}cd ef'], 'zh'],
    ['space-before-consumed-item', ['see', ' \u{AD} ', 'this word']],
    ['space-between-consumed-soft-hyphens', ['ab', ' \u{AD} \u{AD}', 'cd ef gh']], ['space-between-consumed-soft-hyphens', ['this word', ' \u{AD} \u{AD}', '\u{3002}more text'], 'zh'],
    ['soft-hyphen-break-at-line-start', ['ab', ' \u{AD} \u{AD}xyzw more']],
    ['white-space-run-across-items', ['see', ' \u{AD}', ' this word']], ['white-space-run-across-items', ['Hi,', ' \u{AD}', ' \u{AD}', 'this word']],
    ['white-space-run-across-items', ['see \u{AD}', ' this word']], ['white-space-run-across-items', ['see', ' \u{200E}', ' this word']],
    ['soft-hyphen-ends-white-space-run', ['see ', '\u{AD} ', 'this word']], ['soft-hyphen-ends-white-space-run', ['see', '\u{AD} \u{AD}', 'this word']],
    ['zwsp-after-discarded-soft-hyphens', [' \u{AD} \u{AD}\u{200B}', 'textword']], ['zwsp-after-discarded-soft-hyphens', ['ab', ' \u{AD} \u{AD}\u{200B}', 'textword']],
    ['zwsp-after-discarded-soft-hyphens', [' \u{AD}', ' \u{AD}\u{200B}', 'textword']],
    ['bidi-level-ends-white-space-run', ['see \u{200F}', ' this']], ['bidi-level-ends-white-space-run', ['see \u{61C}', ' this word']],
    ['bidi-level-ends-white-space-run', ['see \u{202B}', ' this']], ['bidi-level-ends-white-space-run', ['\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{200F}', ' this']],
    ['text-ends-white-space-run', ['see \u{AD}', 'x', ' this']], ['soft-hyphen-after-no-space', ['see\u{AD}', ' this']],
    ['atomic-item-in-white-space-run', ['see \u{AD}', span(' chip', ARIAL, { atomic: true }), ' this word']],
    ['zwsp-after-discarded-soft-hyphens', ['\u{300D} \u{AD}', '\u{AD}\u{200B}', '42']],
    ['bidi-level-of-the-paragraph', ['\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{200F}\u{AD}', ' 42 more']],
    ['bidi-level-of-the-white-space', ['\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{200E}', span(' chip', ARIAL, { atomic: true }), ' this more']],
    ['bidi-level-of-the-white-space', ['\u{5E9}\u{5DC}\u{5D5}\u{5DD} \u{200E}\u{AD}', span(' chip', ARIAL, { atomic: true }), ' this more']],
    ['bidi-level-at-the-item-offset', ['ab ', 'see \u{200F}', ' this more']], ['bidi-level-at-the-item-offset', ['ab ', 'see \u{200F}\u{AD}', ' this more']],
    ['bidi-level-of-every-dropped-character', ['(q) \u{AD}\u{200F}', ' this more']], ['bidi-level-of-every-dropped-character', ['(q) \u{AD}\u{200F}\u{AD}', ' this more']],
    ['bidi-level-of-a-newline', ['\u{202D}\u{AD}', '\u{628}\u{628}\n\u{61C}', span(' \u{AD}more', ARIAL, { atomic: true })], 'ar'],
    ['bidi-level-of-a-newline', ['\u{202D}\u{AD}', '\u{628}\u{628}\n\u{61C}\u{AD}', span(' \u{AD}more', ARIAL, { atomic: true })], 'ar'],
    ['soft-hyphen-before-bidi-control', ['\u{AD}', '\u{202B}more words']], ['soft-hyphen-before-bidi-control', ['see \u{AD}', '\u{2066}this word']],
    ['soft-hyphen-before-bidi-control', ['word ', '\u{AD}', '\u{200F}more text']], ['soft-hyphen-before-bidi-control', ['see', '\u{AD}', '\u{2066}this word']],
    ['separator-starts-padded-item', ['Unbreakable', span('\u{2028}next line', CODE, { padding: 20 }), ' after']],
  ]
  for (let i = 0; i < continued.length; i++) {
    const [family, parts, lang] = continued[i]!
    out.push(template(`continued/${family}`, 'items that continue the line before them (src/layout.test.ts, rich-inline invariants)', ARIAL, parts.map(part => typeof part === 'string' ? item(part) : part), lang))
  }
  // A line that ends at a space inside an item under negative letter spacing, at −1 as for large headings and at −0.08 as
  // Signal Desktop sets Inter, and beside them a break at the collapsed space between items, at −0.2.
  const tight: ReadonlyArray<readonly [CssFont, number, readonly string[]]> = [
    [ARIAL, -1, ['zz ', 'ab cd']], [INTER, -0.08, ['I also want code ', 'fences, quotes and lists']], [HELVETICA, -0.2, ['The quick ', 'brown', ' fox jumps']],
  ]
  for (let i = 0; i < tight.length; i++) {
    const [f, letterSpacing, parts] = tight[i]!
    out.push(template('negative-letter-spacing', 'a line that ends at a space inside an item under negative letter spacing (src/layout.test.ts)', f, parts.map(part => span(part, f, { letterSpacing }))))
  }
  const message: Part[] = ['민수 씨, ', span('@지훈', BOLD(KOREAN_CHIP), { atomic: true, padding: 11 }), ' 오늘 ', span('회의', BOLD(KOREAN)), '는 세 시에 시작합니다. 자료는 ', span('notes.md', CODE, { padding: 7 }), '에 있어요']
  const keepAll: ReadonlyArray<readonly [string, CssFont, readonly Part[], string, Paragraph['wordBreak']]> = [
    ['chat', KOREAN, message, 'ko', 'keep-all'], ['chat', KOREAN, message, 'ko', 'normal'],
    ['chip-in-word', KOREAN, ['안녕하세요', span('@민수', BOLD(KOREAN_CHIP), { atomic: true, padding: 11 }), '님, 반가워요'], 'ko', 'keep-all'],
    ['stop-ends-item', JAPANESE, ['日本語の', span('テキストです。', BOLD(JAPANESE)), span('次の文', ITALIC(JAPANESE)), 'は続きます'], 'ja', 'keep-all'],
  ]
  for (let i = 0; i < keepAll.length; i++) {
    const [family, base, parts, lang, wordBreak] = keepAll[i]!
    out.push(template(`keep-all/${family}`, `word-break: ${wordBreak} on the paragraph, as a chat message sets it (src/layout.test.ts, rich-inline invariants)`, base, parts, lang, wordBreak))
  }
  const preWrap: ReadonlyArray<readonly [string, CssFont, readonly Part[]]> = [
    ['spaces-across-items', ARIAL, ['Ship it   ', span('today', BOLD(ARIAL)), ' and', span('  ', { ...ARIAL, size: 12 }), span('   then', { ...ARIAL, size: 22 }), ' more words after that']],
    ['spaces-at-padded-edges', HELVETICA, ['Run ', span('bun test   ', CODE, { padding: 7 }), 'before', span('   you push', CODE, { padding: 7 }), ' it now']],
    ['line-feeds-across-items', ARIAL, ['\nFirst line\n', span('second', BOLD(ARIAL)), ' line of', span('\nthird\r', BOLD(ARIAL)), '\n\nfifth line ends\n']],
    ['line-feeds-in-padded-items', HELVETICA, ['See ', span('let a = 1\nlet b', CODE, { padding: 7 }), ' and some words', span('\nnext line', CODE, { padding: 20 }), ' after it']],
    ['spaces-before-line-feed', ARIAL, ['Some words here   ', span('\nnext line', BOLD(ARIAL)), ' ends here', span('      ', BOLD(ARIAL))]],
    ['tabs-across-items', ARIAL, [span('Name', BOLD({ ...ARIAL, size: 20 })), '\tvalue\t', span('\tcol two', BOLD(ARIAL)), '\tmore text here']],
    ['tabs-in-padded-code', HELVETICA, [span('key', CODE, { padding: 7 }), '\tvalue with ', span('if (a)\treturn b', CODE, { padding: 7 }), ' in the code']],
    ['chips-beside-spaces', HELVETICA, ['Thanks  ', span('@alice', CHIP, { atomic: true, padding: 11 }), '  for the review', span(' @bob ', CHIP, { atomic: true, padding: 11 }), ' too']],
    ['chip-before-line-feed', HELVETICA, ['Ping ', span('@alice', CHIP, { atomic: true, padding: 11 }), '\n', span('@bob', CHIP, { atomic: true, padding: 11 }), '  please look at this']],
    ['line-feed-starts-padded-item', HELVETICA, ['Unbreakable', span('\nnext line', CODE, { padding: 20 }), ' after']],
    ['line-feed-starts-padded-item', HELVETICA, ['Unbreakabl', span('e', BOLD(HELVETICA)), span('\nnext line', CODE, { padding: 20 }), ' after']],
    ['line-feed-starts-padded-item', HELVETICA, ['Unbreakable', span('\n', CODE, { padding: 20 }), 'tail text']],
    ['padded-span-after-chip', HELVETICA, ['Ping ', span('@alice', CHIP, { atomic: true, padding: 11 }), span('\nnext line', CODE, { padding: 20 }), ' after']],
    ['padded-span-after-chip', HELVETICA, ['Ping ', span('@alice', CHIP, { atomic: true, padding: 11 }), span('  spaced code', CODE, { padding: 12 }), ' after']],
    ['padded-span-after-chip', HELVETICA, ['Ping ', span('@alice', CHIP, { atomic: true, padding: 11 }), span('  ', CODE, { padding: 12 }), 'next words']],
    ['padded-span-after-chip', HELVETICA, ['Ping ', span('@alice', CHIP, { atomic: true, padding: 11 }), span('  \n', CODE, { padding: 12 }), 'next words']],
    ['line-feed-starts-padded-item', HELVETICA, ['Unbreakable   ', span('\nnext line', CODE, { padding: 20 }), ' after']],
    ['spaces-at-padded-edges', HELVETICA, ['Unbreakable   ', span('  spaced code', CODE, { padding: 20 }), ' after']],
    ['chip-before-split-spaces', HELVETICA, ['Ping ', span('@alice', CHIP, { atomic: true, padding: 11 }), ' ', span('  ', BOLD(HELVETICA)), 'next words']],
    ['chip-before-split-spaces', HELVETICA, [span('@alice', CHIP, { atomic: true, padding: 11 }), span(' ', BOLD(HELVETICA)), '  next words']],
    ['chip-before-split-spaces', HELVETICA, ['Ping ', span('@alice', CHIP, { atomic: true, padding: 11 }), ' ', span('  \t', BOLD(HELVETICA)), 'next words']],
  ]
  for (let i = 0; i < preWrap.length; i++) {
    const [family, base, parts] = preWrap[i]!
    out.push(template(`pre-wrap/${family}`, 'white-space: pre-wrap on the paragraph, as an editor sets it (#173; src/layout.test.ts, rich-inline invariants)', base, parts, 'en', 'normal', 'pre-wrap'))
  }
  // Boxes as apps write them: an image, a custom emoji or a badge, an empty inline-block of its width (#201).
  const emoji = box(20, 20, ARIAL)
  const boxes: ReadonlyArray<readonly [string, CssFont, readonly Part[], string, Paragraph['wordBreak'], Paragraph['whiteSpace']]> = [
    ['between-words', ARIAL, ['Thanks ', emoji, ' for the review', emoji, ', merging now ', emoji], 'en', 'normal', 'normal'],
    ['inside-words', ARIAL, ['inter', box(0, 18, ARIAL), 'national', box(18, 18, ARIAL), 'ization and\u{A0}', box(18, 18, ARIAL), '\u{A0}more'], 'en', 'normal', 'normal'],
    ['adjacent-and-wide', ARIAL, [box(40, 20, ARIAL), box(40, 20, ARIAL), ' a photo ', box(260, 120, ARIAL), ' and after it'], 'en', 'normal', 'normal'],
    ['keep-all', KOREAN, ['안녕하세요', box(20, 20, KOREAN), '님, 반가워요 ', box(20, 20, KOREAN), '오늘'], 'ko', 'keep-all', 'normal'],
    ['pre-wrap', ARIAL, [box(60, 20, ARIAL), '  ', span(' ', BOLD(ARIAL)), 'next words', box(30, 40, ARIAL), '\n', emoji, '\tgo'], 'en', 'normal', 'pre-wrap'],
  ]
  for (let i = 0; i < boxes.length; i++) {
    const [family, base, parts, lang, wordBreak, whiteSpace] = boxes[i]!
    out.push(template(`boxes/${family}`, 'boxes as an app writes an image or custom emoji, an empty inline-block of its width (#201; src/layout.test.ts, rich-inline invariants)', base, parts, lang, wordBreak, whiteSpace))
  }
  return out
}
