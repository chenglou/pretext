import {
  materializeRichInlineLineRange,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineItem,
} from '../../src/rich-inline.ts'

// Local layout model for this demo. It keeps the page readable and shows how
// the rich-text inline flow helper composes with caller-owned classes, fonts, and
// chrome widths. This is local userland structure, not a new core abstraction.

export type TextStyleName = 'body' | 'link' | 'code'
export type ChipTone = 'mention' | 'status' | 'priority' | 'time' | 'count'

export type RichInlineSpec =
  | { kind: 'text'; text: string; style: Exclude<TextStyleName, 'link'> }
  | { kind: 'text'; text: string; style: 'link'; href: string }
  | { kind: 'chip'; label: string; tone: ChipTone }

type TextStyleModel = {
  className: string
  extraWidth: number
  font: string
}

export type PreparedRichInlineNote = {
  classNames: string[]
  direction: 'ltr' | 'rtl'
  flow: PreparedRichInline
  fonts: string[]
  hrefs: Array<string | null>
}

export type RichLineFragment = {
  className: string
  font: string
  gapItemIndex: number // the item whose collapsed space precedes it on its line, or -1
  href: string | null
  itemIndex: number
  text: string
}

export type RichLine = {
  fragments: RichLineFragment[]
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

export const LINE_HEIGHT = 34
export const LAST_LINE_BLOCK_HEIGHT = 24
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
export const CHIP_CHROME_WIDTH = 22
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
    extraWidth: 14,
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

export const DEFAULT_RICH_NOTE_SPECS: RichInlineSpec[] = [
  { kind: 'text', text: 'Ship ', style: 'body' },
  { kind: 'chip', label: '@maya', tone: 'mention' },
  { kind: 'text', text: "'s ", style: 'body' },
  { kind: 'text', text: 'rich-note', style: 'code' },
  { kind: 'text', text: ' card once ', style: 'body' },
  { kind: 'text', text: 'pre-wrap', style: 'code' },
  { kind: 'text', text: ' lands. Status ', style: 'body' },
  { kind: 'chip', label: 'blocked', tone: 'status' },
  { kind: 'text', text: ' by ', style: 'body' },
  { kind: 'text', text: 'vertical text', style: 'link', href: 'https://x.com/_chenglou' },
  { kind: 'text', text: ' research, but 北京 copy and Arabic QA are both green ✅. Keep ', style: 'body' },
  { kind: 'chip', label: 'جاهز', tone: 'status' },
  { kind: 'text', text: ' for ', style: 'body' },
  { kind: 'text', text: 'Cmd+K', style: 'code' },
  { kind: 'text', text: ' docs; the review bundle now includes 中文 labels, عربي fallback, and one more launch pass 🚀 for ', style: 'body' },
  { kind: 'chip', label: 'Fri 2:30 PM', tone: 'time' },
  { kind: 'text', text: '. Keep ', style: 'body' },
  { kind: 'text', text: 'layoutNextLine()', style: 'code' },
  { kind: 'text', text: ' public, tag this ', style: 'body' },
  { kind: 'chip', label: 'P1', tone: 'priority' },
  { kind: 'text', text: ', keep ', style: 'body' },
  { kind: 'chip', label: '3 reviewers', tone: 'count' },
  { kind: 'text', text: ', and route feedback to ', style: 'body' },
  { kind: 'text', text: 'design sync', style: 'link', href: 'https://x.com/_chenglou' },
  { kind: 'text', text: '.', style: 'body' },
]

export function prepareRichInlineNote(
  specs: RichInlineSpec[] = DEFAULT_RICH_NOTE_SPECS,
): PreparedRichInlineNote {
  const classNames = specs.map(spec =>
    spec.kind === 'chip'
      ? CHIP_CLASS_NAMES[spec.tone]
      : TEXT_STYLES[spec.style].className,
  )
  const hrefs = specs.map(spec =>
    spec.kind === 'text' && spec.style === 'link' ? spec.href : null,
  )

  const items: RichInlineItem[] = specs.map(spec => {
    if (spec.kind === 'chip') {
      return {
        text: spec.label,
        font: CHIP_FONT,
        break: 'never' as const,
        extraWidth: CHIP_CHROME_WIDTH,
      }
    }

    const style = TEXT_STYLES[spec.style]
    return {
      text: spec.text,
      font: style.font,
      extraWidth: style.extraWidth,
    }
  })

  // The painter reads each item's font from the items Pretext measured.
  return {
    classNames,
    direction: resolveDirection(items),
    flow: prepareRichInline(items),
    fonts: items.map(item => item.font),
    hrefs,
  }
}

function resolveDirection(items: readonly RichInlineItem[]): 'ltr' | 'rtl' {
  for (let index = 0; index < items.length; index++) {
    const strong = STRONG_CHARACTER.exec(items[index]!.text)
    if (strong !== null) return RIGHT_TO_LEFT_CHARACTER.test(strong[0]) ? 'rtl' : 'ltr'
  }
  return 'ltr'
}

export function layoutRichInlineItems(
  prepared: PreparedRichInlineNote,
  maxWidth: number,
): RichLine[] {
  const lines: RichLine[] = []
  walkRichInlineLineRanges(prepared.flow, maxWidth, range => {
    const line = materializeRichInlineLineRange(prepared.flow, range)
    lines.push({
      fragments: line.fragments.map(fragment => ({
        className: prepared.classNames[fragment.itemIndex]!,
        font: prepared.fonts[fragment.itemIndex]!,
        gapItemIndex: fragment.gapItemIndex,
        href: prepared.hrefs[fragment.itemIndex] ?? null,
        itemIndex: fragment.itemIndex,
        text: fragment.text,
      })),
    })
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
  const lineCount = lines.length

  return {
    bodyWidth,
    direction: prepared.direction,
    lineCount,
    lines,
    noteBodyHeight:
      lineCount === 0 ? LAST_LINE_BLOCK_HEIGHT : (lineCount - 1) * LINE_HEIGHT + LAST_LINE_BLOCK_HEIGHT,
    noteWidth: bodyWidth + notePaddingX * 2,
  }
}
