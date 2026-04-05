import {
  materializeRichInlineLineRange,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
} from '../../src/rich-inline.ts'

// Local layout model for this demo. It keeps the page readable and shows how
// the rich-text inline flow helper composes with caller-owned classes, fonts, and
// chrome widths. This is local userland structure, not a new core abstraction.

export type TextStyleName = 'body' | 'link' | 'code'
export type ChipTone = 'mention' | 'status' | 'priority' | 'time' | 'count'

export type RichInlineSpec =
  | { kind: 'text'; text: string; style: TextStyleName }
  | { kind: 'chip'; label: string; tone: ChipTone }

type TextStyleModel = {
  className: string
  extraWidth: number
  font: string
}

export type PreparedRichInlineNote = {
  classNames: string[]
  flow: PreparedRichInline
}

export type RichLineFragment = {
  className: string
  leadingGap: number
  text: string
}

export type RichLine = {
  fragments: RichLineFragment[]
}

export type RichNoteLayout = {
  bodyWidth: number
  lineCount: number
  lines: RichLine[]
  noteBodyHeight: number
  noteWidth: number
}

export const BODY_FONT = '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif'
export const LINK_FONT = '600 17px "Helvetica Neue", Helvetica, Arial, sans-serif'
export const CODE_FONT = '600 14px "SF Mono", ui-monospace, Menlo, Monaco, monospace'
export const CHIP_FONT = '700 12px "Helvetica Neue", Helvetica, Arial, sans-serif'

export const LINE_HEIGHT = 34
export const LAST_LINE_BLOCK_HEIGHT = 24
export const NOTE_SHELL_CHROME_X = 40
export const BODY_MIN_WIDTH = 260
export const BODY_DEFAULT_WIDTH = 516
export const BODY_MAX_WIDTH = 760
export const PAGE_MARGIN = 28
export const CHIP_CHROME_WIDTH = 22

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
  link: {
    className: 'frag frag--link',
    extraWidth: 0,
    font: LINK_FONT,
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
  { kind: 'text', text: 'vertical text', style: 'link' },
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
  { kind: 'text', text: 'design sync', style: 'link' },
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

  const flow = prepareRichInline(
    specs.map(spec => {
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
    }),
  )

  return { classNames, flow }
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
        leadingGap: fragment.gapBefore,
        text: fragment.text,
      })),
    })
  })
  return lines
}

export function resolveRichNoteBodyWidth(
  viewportWidth: number,
  requestedWidth: number,
): {
  bodyWidth: number
  maxBodyWidth: number
} {
  const maxBodyWidth = Math.max(
    BODY_MIN_WIDTH,
    Math.min(BODY_MAX_WIDTH, viewportWidth - PAGE_MARGIN * 2 - NOTE_SHELL_CHROME_X),
  )
  return {
    bodyWidth: Math.max(BODY_MIN_WIDTH, Math.min(maxBodyWidth, requestedWidth)),
    maxBodyWidth,
  }
}

export function layoutRichNote(
  prepared: PreparedRichInlineNote,
  bodyWidth: number,
): RichNoteLayout {
  const lines = layoutRichInlineItems(prepared, bodyWidth)
  const lineCount = lines.length

  return {
    bodyWidth,
    lineCount,
    lines,
    noteBodyHeight:
      lineCount === 0 ? LAST_LINE_BLOCK_HEIGHT : (lineCount - 1) * LINE_HEIGHT + LAST_LINE_BLOCK_HEIGHT,
    noteWidth: bodyWidth + NOTE_SHELL_CHROME_X,
  }
}
