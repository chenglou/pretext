import {
  materializeRichInlineLineRange,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineBox,
  type RichInlineItem,
} from '../../src/rich-inline.ts'

// Local layout model for this demo. It keeps the page readable and shows how
// the rich-text inline flow helper composes with caller-owned classes, fonts, and
// chrome widths. This is local userland structure on the public API.

export type TextStyleName = 'body' | 'link' | 'code'
export type ChipTone = 'mention' | 'status' | 'priority' | 'time' | 'count'
export type EmojiName = 'party' | 'sparkles'

export type RichInlineSpec =
  | { kind: 'text'; text: string; style: Exclude<TextStyleName, 'link'> }
  | { kind: 'text'; text: string; style: 'link'; href: string }
  | { kind: 'chip'; label: string; tone: ChipTone }
  // A custom emoji, as tall as the line, and an image, which can be taller: boxes, which Pretext
  // lays out by their width alone.
  | { kind: 'emoji'; name: EmojiName }
  | { kind: 'image'; label: string; width: number; height: number }

// A box as the note keeps it: Pretext reads only its width, the note's line heights its height, both
// of its element's margin box, and the painter its accessible name.
type NoteBox = RichInlineBox & { height: number; label: string }

type TextStyleModel = {
  className: string
  extraWidth: number
  font: string
}

export type PreparedRichInlineNote = {
  classNames: string[]
  direction: 'ltr' | 'rtl'
  flow: PreparedRichInline
  hrefs: Array<string | null>
  items: Array<RichInlineItem | NoteBox>
}

export type RichLineFragment =
  | {
    kind: 'text'
    className: string
    font: string
    gapItemIndex: number // the item whose collapsed space precedes it on its line, or -1
    href: string | null
    itemIndex: number
    text: string
  }
  | {
    kind: 'box'
    className: string
    gapItemIndex: number
    height: number
    itemIndex: number
    label: string
    width: number
  }

export type RichLine = {
  fragments: RichLineFragment[]
  height: number // LINE_HEIGHT, or the tallest box on the line where that is taller
  top: number
}

export type RichNoteLayout = {
  bodyWidth: number
  direction: 'ltr' | 'rtl'
  lineCount: number
  lines: RichLine[]
  noteBodyHeight: number
  noteWidth: number
}

// The page paints text with the fonts Pretext measured, so typography lives here
// and the CSS doesn't restate it.
export const BODY_FONT = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif'
export const CODE_FONT = '600 14px "SF Mono", ui-monospace, Menlo, Monaco, monospace'
export const CHIP_FONT = '700 12px "Helvetica Neue", Helvetica, Arial, sans-serif'

// Every line's CSS line-height. A box aligned to the line's top (vertical-align: top) makes its line
// as tall as the box where the box is taller, and moves nothing else on the line, so a line is as
// tall as LINE_HEIGHT and its tallest box.
export const LINE_HEIGHT = 34
// The card's side padding, which the page paints from here. The card's ring is
// an inset shadow, so the padding is all the width the card adds to the body.
export const NOTE_PADDING_X = 20
export const NARROW_NOTE_PADDING_X = 14
// The page's other narrow styles use the same media query. The page asks it
// instead of comparing clientWidth with 640: a media query counts a classic
// scrollbar and clientWidth doesn't, so the two would disagree by its width.
export const NARROW_VIEWPORT_QUERY = '(max-width: 640px)'
export const BODY_MIN_WIDTH = 260
export const BODY_DEFAULT_WIDTH = 516
export const BODY_MAX_WIDTH = 760
export const PAGE_MARGIN = 28
// A code span's and a chip's side padding, which the page paints from here. A
// chip's ring is an inset shadow, so the padding is all the width it adds.
export const CODE_PADDING_X = 7
export const CHIP_PADDING_X = 11
// A custom emoji paints EMOJI_SIZE square, centred in a box EMOJI_BOX_WIDTH wide and as tall as the
// line, so it never makes a line taller.
export const EMOJI_SIZE = 24
const EMOJI_BOX_WIDTH = 28
// A note takes the direction of its first strong character, the way HTML
// dir=auto reads text. Scripts stand in for bidi classes: letters of these
// right-to-left scripts, RLM and ALM count as right-to-left, and any other
// letter, spacing mark or LRM as left-to-right.
const STRONG_CHARACTER = /[\p{L}\p{Mc}\u200E\u200F\u061C]/u
const RIGHT_TO_LEFT_CHARACTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\u200F\u061C]/u

export const TEXT_STYLES = {
  body: {
    className: 'frag frag--body',
    extraWidth: 0,
    font: BODY_FONT,
  },
  code: {
    className: 'frag frag--code',
    extraWidth: CODE_PADDING_X * 2,
    font: CODE_FONT,
  },
  // Links keep the body weight; color and underline mark them.
  link: {
    className: 'frag frag--link',
    extraWidth: 0,
    font: BODY_FONT,
  },
} satisfies Record<TextStyleName, TextStyleModel>

export const CHIP_CLASS_NAMES = {
  count: 'frag chip chip--count',
  mention: 'frag chip chip--mention',
  priority: 'frag chip chip--priority',
  status: 'frag chip chip--status',
  time: 'frag chip chip--time',
} satisfies Record<ChipTone, string>

export const EMOJI_CLASS_NAMES = {
  party: 'box emoji emoji--party',
  sparkles: 'box emoji emoji--sparkles',
} satisfies Record<EmojiName, string>

const IMAGE_CLASS_NAME = 'box image'

export const DEFAULT_RICH_NOTE_SPECS: RichInlineSpec[] = [
  { kind: 'text', text: 'Ship ', style: 'body' },
  { kind: 'chip', label: '@maya', tone: 'mention' },
  { kind: 'text', text: "'s ", style: 'body' },
  { kind: 'text', text: 'rich-note', style: 'code' },
  { kind: 'text', text: ' card once ', style: 'body' },
  { kind: 'text', text: 'pre-wrap', style: 'code' },
  { kind: 'text', text: ' lands ', style: 'body' },
  { kind: 'emoji', name: 'party' },
  { kind: 'text', text: '. Status ', style: 'body' },
  { kind: 'chip', label: 'blocked', tone: 'status' },
  { kind: 'text', text: ' by ', style: 'body' },
  { kind: 'text', text: 'vertical text', style: 'link', href: 'https://x.com/_chenglou' },
  { kind: 'text', text: ' research, but 北京 copy and Arabic QA are both green ✅. Keep ', style: 'body' },
  { kind: 'chip', label: 'جاهز', tone: 'status' },
  { kind: 'text', text: ' for ', style: 'body' },
  { kind: 'text', text: 'Cmd+K', style: 'code' },
  { kind: 'text', text: ' docs; the review bundle now includes 中文 labels, عربي fallback, the new empty state ', style: 'body' },
  { kind: 'image', label: 'Empty state mock', width: 88, height: 56 },
  { kind: 'text', text: ' and one more launch pass 🚀 for ', style: 'body' },
  { kind: 'chip', label: 'Fri 2:30 PM', tone: 'time' },
  { kind: 'text', text: '. Keep ', style: 'body' },
  { kind: 'text', text: 'layoutNextLine()', style: 'code' },
  { kind: 'text', text: ' public, tag this ', style: 'body' },
  { kind: 'chip', label: 'P1', tone: 'priority' },
  { kind: 'text', text: ', keep ', style: 'body' },
  { kind: 'chip', label: '3 reviewers', tone: 'count' },
  { kind: 'text', text: ', and route feedback to ', style: 'body' },
  { kind: 'text', text: 'design sync', style: 'link', href: 'https://x.com/_chenglou' },
  { kind: 'emoji', name: 'sparkles' },
  { kind: 'text', text: '.', style: 'body' },
]

export function prepareRichInlineNote(
  specs: RichInlineSpec[] = DEFAULT_RICH_NOTE_SPECS,
): PreparedRichInlineNote {
  const classNames: string[] = []
  const hrefs: Array<string | null> = []
  const items: Array<RichInlineItem | NoteBox> = []
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index]!
    switch (spec.kind) {
      case 'text': {
        const style = TEXT_STYLES[spec.style]
        classNames.push(style.className)
        hrefs.push(spec.style === 'link' ? spec.href : null)
        items.push({ text: spec.text, font: style.font, extraWidth: style.extraWidth })
        break
      }
      case 'chip':
        classNames.push(CHIP_CLASS_NAMES[spec.tone])
        hrefs.push(null)
        items.push({ text: spec.label, font: CHIP_FONT, break: 'never', extraWidth: CHIP_PADDING_X * 2 })
        break
      case 'emoji':
        classNames.push(EMOJI_CLASS_NAMES[spec.name])
        hrefs.push(null)
        items.push({ width: EMOJI_BOX_WIDTH, height: LINE_HEIGHT, label: `:${spec.name}:` })
        break
      case 'image':
        classNames.push(IMAGE_CLASS_NAME)
        hrefs.push(null)
        items.push({ width: spec.width, height: spec.height, label: spec.label })
        break
    }
  }

  // The painter reads each item's font, and each box's size, from the items Pretext laid out.
  return {
    classNames,
    direction: resolveDirection(items),
    flow: prepareRichInline(items),
    hrefs,
    items,
  }
}

function resolveDirection(items: ReadonlyArray<RichInlineItem | NoteBox>): 'ltr' | 'rtl' {
  for (let index = 0; index < items.length; index++) {
    const text = items[index]!.text
    if (text === undefined) continue
    const strong = STRONG_CHARACTER.exec(text)
    if (strong !== null) return RIGHT_TO_LEFT_CHARACTER.test(strong[0]) ? 'rtl' : 'ltr'
  }
  return 'ltr'
}

// Each line with its top and height: LINE_HEIGHT, or its tallest box where that is taller.
export function layoutRichInlineItems(
  prepared: PreparedRichInlineNote,
  maxWidth: number,
): RichLine[] {
  const lines: RichLine[] = []
  let top = 0
  walkRichInlineLineRanges(prepared.flow, maxWidth, range => {
    const line = materializeRichInlineLineRange(prepared.flow, range)
    const fragments: RichLineFragment[] = []
    let height = LINE_HEIGHT
    for (let index = 0; index < line.fragments.length; index++) {
      const fragment = line.fragments[index]!
      const item = prepared.items[fragment.itemIndex]!
      const className = prepared.classNames[fragment.itemIndex]!
      if (item.text === undefined) {
        if (item.height > height) height = item.height
        fragments.push({ kind: 'box', className, gapItemIndex: fragment.gapItemIndex, height: item.height, itemIndex: fragment.itemIndex, label: item.label, width: item.width })
      } else {
        fragments.push({ kind: 'text', className, font: item.font, gapItemIndex: fragment.gapItemIndex, href: prepared.hrefs[fragment.itemIndex] ?? null, itemIndex: fragment.itemIndex, text: fragment.text })
      }
    }
    lines.push({ fragments, height, top })
    top += height
  })
  return lines
}

export function resolveRichNoteBodyWidth(
  viewportWidth: number,
  narrowViewport: boolean,
  requestedWidth: number,
): {
  bodyWidth: number
  maxBodyWidth: number
  notePaddingX: number
} {
  const notePaddingX = narrowViewport ? NARROW_NOTE_PADDING_X : NOTE_PADDING_X
  const maxBodyWidth = Math.max(
    BODY_MIN_WIDTH,
    Math.min(BODY_MAX_WIDTH, viewportWidth - PAGE_MARGIN * 2 - notePaddingX * 2),
  )
  return {
    bodyWidth: Math.max(BODY_MIN_WIDTH, Math.min(maxBodyWidth, requestedWidth)),
    maxBodyWidth,
    notePaddingX,
  }
}

export function layoutRichNote(
  prepared: PreparedRichInlineNote,
  bodyWidth: number,
  notePaddingX: number,
): RichNoteLayout {
  const lines = layoutRichInlineItems(prepared, bodyWidth)
  const last = lines[lines.length - 1]

  return {
    bodyWidth,
    direction: prepared.direction,
    lineCount: lines.length,
    lines,
    noteBodyHeight: last === undefined ? LINE_HEIGHT : last.top + last.height,
    noteWidth: bodyWidth + notePaddingX * 2,
  }
}
