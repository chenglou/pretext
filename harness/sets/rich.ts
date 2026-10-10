// Rich-inline templates: paragraphs of spans, which the adapter lays out with rich-inline (one item per run, a chip as
// `break: 'never'`, padding as `extraWidth`), before widths.ts finds where each browser's lines change. main's
// same-font inline items (its rich-boundaries family and #210's rich witnesses) were taken once as `rich/main/*` cases,
// which `make.ts cut` keeps. Every group of templates from the fifth below on, and each addition to one, was cut on its
// own, since the earlier templates' widths were searched in older browser builds. The templates:
// - the shapes of main's engine facts about rich items (src/layout.test.ts:893, 966, 2604, 2642, 3649, and 3695, whose
//   shapes are 2604's);
// - filed reports: #177 (punctuation split across items), #120 (CJK in rich mode), #171 (a bold first letter), #323 (a
//   soft hyphen in the item after a bold word);
// - styles changing at run boundaries (weight, size, family, italic, letter spacing) over src/test-data.ts's texts, as
//   the rebuild's runs families do, and spaces at span edges;
// - chips and code spans as the demos write them: an atomic mention chip with padding, and inline code with padding
//   that can break (pages/demos/rich-note.model.ts, markdown-chat.model.ts);
// - items that continue the line before them instead of starting one (#369), each shape beside a neighbour: a soft
//   hyphen that starts an item after other text, after an ideograph or emoji, before a combining mark or after a space,
//   two soft hyphens that start an item, a line separator in an item or after a collapsed space before one, and one
//   before a lone carriage return and a space that end its item (#459), where the WebKit profile ends the line too,
//   before an item that starts with a second separator, since Safari gives the carriage return the line between the
//   two, which Pretext has only between two hard breaks (ENGINE_FOLLOWUPS.md, White space and controls); an item
//   holding only a soft hyphen between a break and a run that continues it, or after a collapsed space, a newline next
//   to a ZWSP in another item, and a soft hyphen after a space in an item that continues a run from an earlier item,
//   which Chrome breaks at the space (ENGINE_FOLLOWUPS.md); white space after such an item's soft hyphen, white space
//   between an item's soft hyphens, and an item that starts with white space and soft hyphens, whose soft hyphen after
//   the white space Firefox drops; a run of white space that goes on across items past the soft hyphens and bidi
//   controls Firefox drops, one that a soft hyphen starting an item ends, and a ZWSP after white space and soft hyphens
//   where a line starts; a run that a right-to-left mark after its white space ends where one at the white space's bidi
//   level doesn't, one that text after it ends, an atomic item whose leading white space collapses into one, a soft
//   hyphen after no white space, which opens none, and a ZWSP after soft hyphens where a line starts after a wrap; the
//   levels Firefox reads there, which rich inline doesn't resolve (ENGINE_FOLLOWUPS.md): the paragraph's, at each
//   item's offset, of every character the run goes past against the white space before them, with a newline as a space;
//   a soft hyphen that ends an item before a bidi control that starts the next, at the paragraph's start, after a space
//   in the item or a collapsed one before it, which Firefox's scan of the joined text takes as text, and after other
//   text; a padded span that starts with a line separator after a word, before which WebKit's check at an item boundary
//   gives no break (getWebKitBreakBetweenItems in src/line-breaks.ts), so a line that can't fit its padding breaks the
//   word (hardBreakItemRetreat in src/measurement.ts); a soft hyphen that starts an item in 16px Inter, whose U+2010 is
//   narrower than its hyphen-minus, so the line that ends there shows which hyphen the profile measures
//   (hyphenFromPrimaryFont in src/measurement.ts);
// - a line that ends at a space inside an item under negative letter spacing, whose next line the browsers start after
//   the space, beside a break at the collapsed space between items;
// - keep-all paragraphs: a Korean chat message with a mention chip, a bold run inside a word and a code span a particle
//   follows, beside the same message without keep-all; a mention chip inside a Korean word; and Japanese whose bold run
//   ends with a full stop, after which WebKit's check at an item boundary finds no break where one text node breaks
//   (getWebKitBreakBetweenItems in src/line-breaks.ts);
// - pre-wrap paragraphs: preserved spaces at an item's end and start and over three fonts, which hang across the style
//   change, and before a padded span's end and after its start; line feeds at an item's end and start, a blank line
//   across items and a carriage return that ends an item before a line feed that starts the next; a line feed inside a
//   padded span and one that starts a padded span; spaces before a line feed in the next item and at the paragraph's
//   end; tabs after a wider bold span and split across items, and after and inside padded code spans in prose, whose
//   stops count from the line's start; and chips beside preserved spaces and holding their own; a chip before a line
//   feed and one before spaces, which stay on its line however far it overflows, and a padded span that starts with a
//   line feed after a word, whose line breaks the word where the padding doesn't fit (hardBreakItemRetreat in
//   src/measurement.ts); that span after a word whose last letter is a bold span of its own, which moves with it, a
//   padded span of only a line feed, whose end edge Safari fits too, and a padded span that starts with a line feed or
//   spaces after a chip, whose opening each engine fits its way (paddedOpeningFit in src/measurement.ts); a padded span
//   of only spaces after a chip, which Chrome keeps on the chip's line however far it overflows, one of spaces and a
//   line feed, whose end edge Safari fits too, and a padded span that starts with a line feed or spaces after a word
//   that ends with spaces, whose opening Chrome's line takes with no padding, and before whose line feed, where its
//   padding doesn't fit, Safari keeps the spaces that fit and Firefox all but the last (hardBreakItemRetreat); a chip
//   before preserved spaces split across spans, which all stay on its line however far it overflows, before text and
//   before the paragraph's own text that starts with more of them, and before a tab, which Firefox doesn't hang and
//   moves to the next line with them;
// - boxes (RichInlineBox): custom emoji at the line height between words with spaces on both sides, before punctuation
//   and at the paragraph's end; boxes inside words, of width 0 and beside U+00A0; adjacent boxes, a box wider than most
//   widths and one taller than the line; a box inside a keep-all Korean word; in pre-wrap, preserved spaces split
//   across items after a box, which stay on its line, a line feed and a tab after one; and a box of width 0 past a
//   line's end, after a space that doesn't fit and after a box wider than the line, which Chrome and Safari move to the
//   next line and Firefox keeps unless text comes right after it, not after a space (setEmptyObjectFacts
//   in src/rich-inline.ts), and two of them after a pre-wrap space that hangs, which Firefox has inside the line;
// - shapes whose rule only a unit test held: a padded code span alone in its paragraph, which the adapter still lays
//   out with rich-inline, for its padding; in pre-wrap, a box about as wide as the words after it before preserved
//   spaces that start their item, which stay on its line however far it overflows; and a Korean message under keep-all
//   and pre-wrap together, with preserved spaces, a line feed, and a bold word whose ending follows it inside a line, a
//   break between items that only keep-all forbids. The ending is longer than the bold word, so the width the cut takes
//   well inside a layout is one where the word fits the line above and its ending doesn't;
// - fullwidth punctuation at an item's edge: a pair of marks that a bold span's edge splits, a closing mark before a
//   full stop and a colon before an opening bracket, which Chrome's text-spacing-trim halts as in one text node; and a
//   bold span that ends with a closing bracket before a space and a Latin word, where Chrome doesn't halt the bracket
//   at a line's end, since no break comes right after it. The word doesn't break, so the cut reaches the width where
//   the bracket stops fitting whole. And a bold span that ends with a closing bracket before a letter, where Chrome
//   keeps the bracket halted and the line goes on after it, and before a period, where it halts the bracket only on a
//   line it lays out again between graphemes (itemEndHalts in src/line-break.ts). Each is three or four characters, so
//   that the three widest changes the cut takes are the ones around the halt;
// - a soft hyphen whose hyphen doesn't fit after a break between two text segments, to which Chrome's line returns
//   (unfitHyphenRetreat in src/measurement.ts; #433): the break right after a `-` at an item's edge, inside a bold
//   word, and between two ideographs at an item's edge, each before a syllable long enough that a width the cut takes
//   inside a layout is one where the text before the soft hyphen fits and its hyphen doesn't; and #433's rich row, a
//   box and a padded span that holds such a word, where Chrome keeps a hyphen that fits without the span's end edge and
//   rich inline, which counts that edge, returns (ENGINE_FOLLOWUPS.md, Line edges);
// - a lone carriage return at an item's edge in normal white space, which Safari and Firefox give no room: one that ends
//   a span of Cyrillic before a span of Latin, where Safari breaks the word between letters and one text node breaks
//   after the carriage return (getWebKitParagraphBreaks in src/analysis.ts), one that ends a span before a bold 20px
//   span, one that is a span of its own, and one that ends a span before a bold 20px span that starts with a space,
//   which Safari and Firefox draw in the bold span's font and Chrome, to which a carriage return is white space, in
//   the first span's (alignToSource in src/analysis.ts; ENGINE_FOLLOWUPS.md, White space and controls); and a line
//   separator that ends a span before the paragraph's last span, of one space, at which Safari's line ends
//   (mapSourceLineBreaks in src/analysis.ts), right after a word and after a space: there the cut takes the width at
//   which the word fits and the space doesn't, where Safari's line, the space hung, still ends at the separator and no
//   second line follows;
// - paragraphs narrower than 1px in boxes narrower than 1px, which a browser lays out as it lays out any other, and
//   rich inline's line functions at the width given: `ii` in 1px Arial in a span before an empty span, a
//   paragraph of one item, which the adapter writes with rich-inline for the empty span and whose lines are its
//   text's; two items with a collapsed space between them; two boxes 0.5px wide; a ZWSP in an item of its own before
//   a 0.5px box, which holds a line where the box doesn't fit after it; and in pre-wrap a preserved space, which
//   hangs, before a word that breaks between its letters. Each is searched from 0px, by its own widths, where the
//   search starts every other template at 1px. The cut pins no case at 0px itself, where each template's lines are
//   those of its narrowest case. In Firefox the pre-wrap one's cases at 0.001px, which Firefox lays out in a box of no
//   width, and at 0.032px pin the same three lines: Firefox clips a space that hangs to the box, the recorder lists
//   none clipped to nothing, and the search took that for a change of lines. None holds a padded span or a chip, whose
//   edges and width the browsers fit their own ways at every size (ENGINE_FOLLOWUPS.md, Rich-inline item edges);
// - a bidi control that starts an item between two spaces, the first ending the item before it, after a word that fits
//   its line where that space doesn't: Firefox keeps the word on that line where text follows the second space in its
//   own item, the control's or the next one where the control is an item alone, in pre-wrap too, and its line goes back
//   to its last break, the word going down, where the second space ends its item; the Gecko profile gives the control
//   no break, so its line goes back at every such control (ENGINE_FOLLOWUPS.md, Rich-inline item edges). Each is one
//   earlier word and one later, so that two of the three widest changes the cut takes are the widths where the word
//   before the control comes to fit;
// - characters of no width, a tab and U+3000 at an item's edge where a browser's lines aren't rich inline's
//   (ENGINE_FOLLOWUPS.md, Rich-inline item edges), each shape with a neighbour whose lines rich inline has, and each
//   short, so that the three widest changes the cut takes reach the width where the shape shows:
//   - a ZWSP in an item of its own right after a space, as an editor's placeholder for the caret: where the text before
//     the space fits its line and the space doesn't, all three browsers start the next line with the ZWSP, which holds
//     it though it shows nothing, and the text walkers hang the ZWSP with the space; the same in pre-wrap, where
//     Firefox keeps the ZWSP on the space's line; a ZWSP that starts a bold item after such a space, which holds the
//     next line alone where the word after it doesn't fit beside it; and a ZWSP right after a word, which stays on the
//     word's line;
//   - a padded item of only a ZWSP, as an empty code span that an editor keeps open: Chrome and Safari keep it on a
//     line only where both its edges fit, and rich inline wherever its start edge does (getOpeningFit in
//     src/rich-inline.ts), after a space, and right after a word that follows a one-letter word, so that a width the
//     cut takes inside a layout is one where only the end edge doesn't fit; a padded item of a space and a ZWSP, which
//     all three browsers move to the next line where it doesn't fit whole; and a padded item that starts with a ZWSP
//     and goes on, whose opening stays on the line where its start edge fits in Chrome and Safari and where both edges
//     do in Firefox, as in each profile (paddedOpeningFit in src/measurement.ts);
//   - after a mention chip wider than its line, an item that starts with a bidi isolate, as text an app isolates, or
//     with ZWNJ, before a word wider than the line too: Chrome starts the next line with the character and the word's
//     first letters, as Firefox does with ZWNJ, and the one scan of the joined text breaks after the character, which
//     takes a line alone; and the isolate after a chip narrower than the word, which stays on the chip's line wherever
//     the chip fits;
//   - a padded item that starts with ZWNJ inside a word, as a highlight that starts there, where a line cuts the word
//     right after the ZWNJ: every line of the item carries its padding in Firefox and Chrome, and the line that starts
//     after the ZWNJ carries none in rich inline (insideExtras in src/line-break.ts), so it holds a letter more; and
//     the same item without the ZWNJ, whose lines all carry it. In Chrome both templates also have other lines than
//     rich inline's where a line ends inside the padded item, which Chrome fits without the item's end edge;
//   - in pre-wrap, a padded item of only a bidi control: a box as wide as its padding where it stands in Firefox, where
//     the Gecko profile, which has no segment for a character Firefox drops, puts the padding on the word after it; and
//     the control with that word's first letter in the padded item, whose padding is on the letter;
//   - a padded item that starts with a soft hyphen, as a styled run that starts at a syllable of text hyphenated ahead
//     of time: a line that ends at that soft hyphen holds the item's start edge in Chrome and Safari and both edges in
//     Firefox, and no padding in rich inline, which puts an item's extraWidth on its first segment that takes room; a
//     padded `a` after `a a`, short enough that the cut takes a width where the hyphen fits and the start edge doesn't,
//     a longer word, whose one such case is at the edge of the browser's change, and the soft hyphen at the end of the
//     item before the padded one, where the hyphen's line holds no padding in any browser;
//   - in pre-wrap, a space and a ZWSP that end an item before an item that starts with a space: Firefox starts the next
//     line with the ZWSP where the first space hangs, so the second space starts that line, and the paragraph carries
//     the run of hanging spaces past the ZWSP; and the same without the ZWSP, where both spaces hang. Each starts with
//     one more word, which gives the line an earlier break, so that the cut takes the width where the word before the
//     ZWSP comes to fit;
//   - in pre-wrap, a padded item that starts with a tab, or with a space and a tab: Firefox gives no break inside a run
//     of spaces and tabs and none between a span's start edge and its first content, so the span stays whole where it
//     starts a line and takes the word before it down where the tab doesn't fit, and rich inline gives such an item a
//     start edge of its own, a segment a line can end after (getOpeningFit); a padded item of a space, a tab and a
//     letter after three words, inline code of a tab and `end` alone in a paragraph of its own font, whose tab stops
//     are the paragraph's, and the first without its padding;
//   - a U+3000 that ends an item before an item that starts with a bidi control, as Japanese that ends with a
//     full-width space before a mark: where the text before the U+3000 fits its line and the U+3000 doesn't, Firefox,
//     which drops the control, hangs it, and Chrome hangs it and starts the next line with the control. In rich inline
//     no line can end between the two, and the last ideograph goes down with them: in both profiles where the control
//     ends the paragraph, and in the Blink profile where text follows it (addIdeographicSpaceHangs in src/prepare.ts);
//     and the text right after the U+3000, before which the Blink and Gecko profiles hang it;
// - shapes at an item's edge where the one analysis of the joined text gives every browser's lines (RESEARCH.md, Rich
//   Inline As One Paragraph): an item that starts with a bidi isolate right after a dash, and with ZWNJ right after an
//   ideograph, where Chrome's and Firefox's line ends after the joined text and the word after it stays whole, and
//   Safari, which gives no break at such an item's start, goes back to an earlier break or cuts the word; an item that
//   starts with a hyphen before an Arabic word, right after a letter, whose word is one segment measured with its
//   letters joined, after one letter so that a width the cut takes inside a layout holds the word joined and not its
//   letters apart; a chip of only a soft hyphen between two spaces, a box as wide as its padding beside which both
//   spaces show; a padded item of only a soft hyphen after a space and before a hyphen, where no scan makes the soft
//   hyphen a break and the item takes its padding; a ZWSP that ends a bold item inside a Korean sentence under
//   keep-all, at which the line can end (getWebKitBreakBetweenItems in src/line-breaks.ts); in pre-wrap a tab in an
//   item of its own after an item that ends with a space, which Firefox, with no break inside a run of spaces and tabs,
//   takes to the next line with the word before the space; and a left-to-right mark in an item of its own that ends the
//   paragraph after a space, which gets no line in Firefox, which drops it, and the next line in Chrome and Safari
//   where the space doesn't fit.
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
const COURIER = font('"Courier New"', 16)

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
    ['separator-before-carriage-return', ['first\u{2028}\r ', '\u{2028}second line']],
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
  // A soft hyphen that starts an item in Inter, whose U+2010 is narrower than its hyphen-minus: the line that ends there
  // paints the hyphen that the same text in one item paints.
  out.push(template('continued/soft-hyphen-start', 'a soft hyphen that starts an item, in a font whose U+2010 is narrower than its hyphen-minus (src/layout.test.ts, a chosen soft hyphen measures as the hyphen the engine paints)', { ...INTER, size: 16 }, ['foo trans', item('\u{AD}atlantic', { ...INTER, size: 16 })]))
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
  const empty = box(0, 20, ARIAL)
  const boxes: ReadonlyArray<readonly [string, CssFont, readonly Part[], string, Paragraph['wordBreak'], Paragraph['whiteSpace']]> = [
    ['between-words', ARIAL, ['Thanks ', emoji, ' for the review', emoji, ', merging now ', emoji], 'en', 'normal', 'normal'],
    ['inside-words', ARIAL, ['inter', box(0, 18, ARIAL), 'national', box(18, 18, ARIAL), 'ization and\u{A0}', box(18, 18, ARIAL), '\u{A0}more'], 'en', 'normal', 'normal'],
    ['adjacent-and-wide', ARIAL, [box(40, 20, ARIAL), box(40, 20, ARIAL), ' a photo ', box(260, 120, ARIAL), ' and after it'], 'en', 'normal', 'normal'],
    ['keep-all', KOREAN, ['안녕하세요', box(20, 20, KOREAN), '님, 반가워요 ', box(20, 20, KOREAN), '오늘'], 'ko', 'keep-all', 'normal'],
    ['pre-wrap', ARIAL, [box(60, 20, ARIAL), '  ', span(' ', BOLD(ARIAL)), 'next words', box(30, 40, ARIAL), '\n', emoji, '\tgo'], 'en', 'normal', 'pre-wrap'],
    ['width-0', ARIAL, ['Thanks for the review ', empty, 'again'], 'en', 'normal', 'normal'],
    ['width-0', ARIAL, ['Thanks for the review ', empty, ' again'], 'en', 'normal', 'normal'],
    ['width-0', ARIAL, [box(260, 120, ARIAL), empty, 'caption'], 'en', 'normal', 'normal'],
    ['width-0', ARIAL, ['Thanks for the review ', empty, empty, 'again'], 'en', 'normal', 'pre-wrap'],
    ['pre-wrap', ARIAL, [box(76, 20, ARIAL), '   next words'], 'en', 'normal', 'pre-wrap'],
  ]
  for (let i = 0; i < boxes.length; i++) {
    const [family, base, parts, lang, wordBreak, whiteSpace] = boxes[i]!
    out.push(template(`boxes/${family}`, 'boxes as an app writes an image or custom emoji, an empty inline-block of its width (#201; src/layout.test.ts, rich-inline invariants)', base, parts, lang, wordBreak, whiteSpace))
  }
  out.push(template('code-spans', 'inline code with padding, alone in its paragraph (src/layout.test.ts, rich-inline invariants)', HELVETICA, [span('git commit --amend --no-edit', CODE, { padding: 7 })]))
  out.push(template('keep-all/pre-wrap', 'word-break: keep-all and white-space: pre-wrap together on the paragraph (src/layout.test.ts, rich-inline invariants)', KOREAN,
    ['민수 씨,  오늘 ', span('회의', BOLD(KOREAN)), '에서는\n세 가지를  정합니다'], 'ko', 'keep-all', 'pre-wrap'))
  const edges: ReadonlyArray<readonly [string, readonly Part[]]> = [
    ['punctuation-pair', ['これは', span('「引用」', BOLD(JAPANESE)), '。と言った']],
    ['punctuation-pair', [span('注意：', BOLD(JAPANESE)), '「これは引用」です']],
    ['closing-mark', ['まず', span('「設定」', BOLD(JAPANESE)), ' Settings']],
    ['closing-mark', [span('設定」', BOLD(JAPANESE)), 'i']],
    ['closing-mark', [span('字」', BOLD(JAPANESE)), '.字']],
  ]
  for (let i = 0; i < edges.length; i++) {
    const [family, parts] = edges[i]!
    out.push(template(`item-edges/${family}`, 'fullwidth punctuation at an item\'s edge (src/layout.test.ts, layout invariants)', JAPANESE, parts, 'ja'))
  }
  const label = font('Georgia', 10)
  const returns: ReadonlyArray<readonly [string, CssFont, readonly Part[], string]> = [
    ['item-edge-after-hyphen', ARIAL, [item('x ab-'), item('cd\u{AD}efgh')], 'en'],
    ['bold-word', ARIAL, ['x ', span('ab-cd\u{AD}efgh', BOLD(ARIAL))], 'en'],
    ['item-edge-between-ideographs', JAPANESE, [item('x 日本', JAPANESE), item('語\u{AD}abcdefg', JAPANESE)], 'ja'],
    ['padded-span', label, [box(13, 13, label), span('Bitte die Nebenrollen-Ta\u{AD}kes vor', label, { padding: 2.5 })], 'en'],
  ]
  for (let i = 0; i < returns.length; i++) {
    const [family, base, parts, lang] = returns[i]!
    out.push(template(`soft-hyphen-return/${family}`, 'a soft hyphen whose hyphen doesn\'t fit after a break between two text segments (#433; src/layout.test.ts, Blink returns an unfit soft hyphen to the latest earlier break that leaves room for the hyphen)', base, parts, lang))
  }
  const controls: ReadonlyArray<readonly [string, readonly TextRun[], string?]> = [
    ['carriage-return', [item('бв\r'), item('cd ef')]],
    ['carriage-return', [item('see\r'), span('this word', BOLD({ ...ARIAL, size: 20 }))]],
    ['carriage-return', [item('see'), item('\r'), item('this word')]],
    ['separator-before-space', [item('abc\u{2028}'), item(' ')]],
    ['carriage-return', [item('see\r'), span(' this word', BOLD({ ...ARIAL, size: 20 }))], 'white space right after a carriage return that ends a rich item is the next item\'s in the WebKit and Gecko profiles'],
    ['separator-before-space', [item('abc \u{2028}'), item(' ')]],
  ]
  for (let i = 0; i < controls.length; i++) {
    const [family, parts, test = 'a carriage return in a rich paragraph is what its text has in one item'] = controls[i]!
    out.push(template(`item-edges/${family}`, `a lone carriage return, or a line separator before white space, at an item's edge in normal white space (src/layout.test.ts, ${test})`, ARIAL, parts))
  }
  // Paragraphs narrower than 1px: an `i` of 1px Arial is 0.22px wide. Their own widths start the search at 0px.
  const tiny = font('Arial', 1)
  const narrow: ReadonlyArray<readonly [string, readonly TextRun[], Paragraph['whiteSpace']?]> = [
    ['one-item', [span('ii', tiny), item('')]],
    ['items', [span('i', tiny), span(' i', ITALIC(tiny))]],
    ['boxes', [box(0.5, 20, ARIAL), box(0.5, 20, ARIAL)]],
    ['zero-width', [item('\u{200B}'), box(0.5, 20, ARIAL)]],
    ['pre-wrap', [span(' ', tiny), span('ii', tiny)], 'pre-wrap'],
  ]
  for (let i = 0; i < narrow.length; i++) {
    const [family, parts, whiteSpace] = narrow[i]!
    out.push({ ...template(`under-1px/${family}`, 'a paragraph narrower than 1px in a box narrower than 1px (src/layout.test.ts, a rich paragraph lays out at the width given under 1px, and at 0 under 0)', ARIAL, parts, 'en', 'normal', whiteSpace), widths: [0, 0.5] })
  }
  // The header's last three entries: each family's origin, then its templates.
  const chip = (text: string): TextRun => span(text, CHIP, { atomic: true, padding: 11 })
  const padded = (text: string, padding: number, f: CssFont = ARIAL): TextRun => span(text, f, { padding })
  const gap = '(ENGINE_FOLLOWUPS.md, Rich-inline item edges)'
  const design = '(RESEARCH.md, Rich Inline As One Paragraph)'
  const origins: Record<string, string> = {
    'item-edges/bidi-control-between-spaces': `a bidi control that starts an item between two spaces ${gap}`,
    'item-edges/zwsp-after-space': `a ZWSP that is an item, or starts one, right after a space ${gap}`,
    'item-edges/padded-zwsp': `a padded item that holds only a ZWSP, or starts with one ${gap}`,
    'item-edges/control-after-chip': `an item that starts with a bidi isolate or ZWNJ after a chip ${gap}`,
    'item-edges/padded-joiner-start': `a padded item that starts with ZWNJ inside a word ${gap}`,
    'pre-wrap/padded-bidi-control': `white-space: pre-wrap, a padded item of only a bidi control ${gap}`,
    'item-edges/padded-soft-hyphen-start': `a padded item that starts with a soft hyphen ${gap}`,
    'pre-wrap/zwsp-ends-hanging-spaces': `white-space: pre-wrap, a space and a ZWSP that end an item before an item that starts with a space ${gap}`,
    'pre-wrap/tab-starts-padded-item': `white-space: pre-wrap, a padded item that starts with a tab ${gap}`,
    'item-edges/ideographic-space-before-control': `a U+3000 that ends an item before an item that starts with a bidi control ${gap}`,
    'item-edges/control-starts-item': `an item that starts with a bidi isolate or ZWNJ right after another item's text ${design}`,
    'item-edges/hyphen-starts-item': `an item that starts with a hyphen before an Arabic word, right after another item's letter ${design}`,
    'item-edges/invisible-chip': `a chip of only a soft hyphen ${design}`,
    'item-edges/padded-soft-hyphen-item': `a padded item of only a soft hyphen ${design}`,
    'keep-all/zwsp-ends-item': `word-break: keep-all, a ZWSP that ends an item ${design}`,
    'pre-wrap/tab-item-after-space': `white-space: pre-wrap, a tab in an item of its own after an item that ends with a space ${design}`,
    'item-edges/bidi-control-ends-paragraph': `a paragraph that ends with an item of only a bidi control, after a space ${design}`,
  }
  const atEdges: ReadonlyArray<readonly [string, CssFont, readonly TextRun[], string?, Paragraph['wordBreak']?, Paragraph['whiteSpace']?]> = [
    ['item-edges/bidi-control-between-spaces', ARIAL, [item('aa see '), item('\u{200E} this')]],
    ['item-edges/bidi-control-between-spaces', ARIAL, [item('aa see '), item('\u{200E}'), item(' this')]],
    ['item-edges/bidi-control-between-spaces', ARIAL, [item('aa see '), item('\u{200E} '), item('this')]],
    ['item-edges/bidi-control-between-spaces', ARIAL, [item('aa see '), item('\u{200E} this')], 'en', 'normal', 'pre-wrap'],
    ['item-edges/zwsp-after-space', ARIAL, [item('Hello world '), item('\u{200B}')]],
    ['item-edges/zwsp-after-space', ARIAL, [item('Hello world '), item('\u{200B}')], 'en', 'normal', 'pre-wrap'],
    ['item-edges/zwsp-after-space', ARIAL, [item('Dear '), span('\u{200B}friends', BOLD(ARIAL))]],
    ['item-edges/zwsp-after-space', ARIAL, [item('Hello world'), item('\u{200B}')]],
    ['item-edges/padded-zwsp', ARIAL, [item('click here '), padded('\u{200B}', 4)]],
    ['item-edges/padded-zwsp', HELVETICA, [item('I typed', HELVETICA), padded('\u{200B}', 7, CODE)]],
    ['item-edges/padded-zwsp', ARIAL, [item('on'), padded(' \u{200B}', 4)]],
    ['item-edges/padded-zwsp', ARIAL, [item('Tag:'), padded('\u{200B}NEW', 4)]],
    ['item-edges/control-after-chip', HELVETICA, [chip('@international-team'), item('\u{2068}documentation\u{2069}', HELVETICA)]],
    ['item-edges/control-after-chip', HELVETICA, [chip('@international-team'), item('\u{200C}documentation', HELVETICA)]],
    ['item-edges/control-after-chip', HELVETICA, [chip('@bob'), item('\u{2068}documentation\u{2069}', HELVETICA)]],
    ['item-edges/padded-joiner-start', ARIAL, [item('inter'), padded('\u{200C}operability', 4)]],
    ['item-edges/padded-joiner-start', ARIAL, [item('inter'), padded('operability', 4)]],
    ['pre-wrap/padded-bidi-control', ARIAL, [item('a '), padded('\u{200E}', 6), item('bbbb cc')], 'en', 'normal', 'pre-wrap'],
    ['pre-wrap/padded-bidi-control', ARIAL, [item('a '), padded('\u{200E}b', 6), item('bbb cc')], 'en', 'normal', 'pre-wrap'],
    ['item-edges/padded-soft-hyphen-start', ARIAL, [item('a a'), padded('\u{AD}a', 4)]],
    ['item-edges/padded-soft-hyphen-start', ARIAL, [item('see photo'), padded('\u{AD}graphy', 5)]],
    ['item-edges/padded-soft-hyphen-start', ARIAL, [item('a a\u{AD}'), padded('a', 4)]],
    ['pre-wrap/zwsp-ends-hanging-spaces', ARIAL, [item('Please wait \u{200B}'), item(' now')], 'en', 'normal', 'pre-wrap'],
    ['pre-wrap/zwsp-ends-hanging-spaces', ARIAL, [item('Please wait '), item(' now')], 'en', 'normal', 'pre-wrap'],
    ['pre-wrap/tab-starts-padded-item', ARIAL, [item('a b c'), padded(' \td', 4)], 'en', 'normal', 'pre-wrap'],
    ['pre-wrap/tab-starts-padded-item', COURIER, [padded('\tend', 4, COURIER)], 'en', 'normal', 'pre-wrap'],
    ['pre-wrap/tab-starts-padded-item', ARIAL, [item('a b c'), item(' \td')], 'en', 'normal', 'pre-wrap'],
    ['item-edges/ideographic-space-before-control', JAPANESE, [item('東京都\u{3000}', JAPANESE), item('\u{200E}', JAPANESE)], 'ja'],
    ['item-edges/ideographic-space-before-control', JAPANESE, [item('大阪市\u{3000}', JAPANESE), item('\u{200F}', JAPANESE), item('次', JAPANESE)], 'ja'],
    ['item-edges/ideographic-space-before-control', JAPANESE, [item('大阪市\u{3000}', JAPANESE), item('次', JAPANESE)], 'ja'],
    ['item-edges/control-starts-item', ARIAL, [item('posted\u{2014}'), item('\u{2068}Dana\u{2069} today')]],
    ['item-edges/control-starts-item', JAPANESE, [item('東', JAPANESE), item('\u{200C}on', JAPANESE)], 'ja'],
    ['item-edges/hyphen-starts-item', ARIAL, [item('e'), item('-\u{643}\u{62A}\u{627}\u{628}')], 'ar'],
    ['item-edges/invisible-chip', HELVETICA, [item('some text ', HELVETICA), chip('\u{AD}'), item(' more text', HELVETICA)]],
    ['item-edges/padded-soft-hyphen-item', ARIAL, [item('see '), padded('\u{AD}', 4), item('-saw')]],
    ['keep-all/zwsp-ends-item', KOREAN, [span('안녕하세요\u{200B}', BOLD(KOREAN)), item('세계에서 한국어', KOREAN)], 'ko', 'keep-all'],
    ['pre-wrap/tab-item-after-space', ARIAL, [item('one two '), item('\t'), item('three')], 'en', 'normal', 'pre-wrap'],
    ['item-edges/bidi-control-ends-paragraph', ARIAL, [item('Hello again '), item('\u{200E}')]],
  ]
  for (let i = 0; i < atEdges.length; i++) {
    const [family, base, parts, lang, wordBreak, whiteSpace] = atEdges[i]!
    out.push(template(family, origins[family]!, base, parts, lang, wordBreak, whiteSpace))
  }
  return out
}
