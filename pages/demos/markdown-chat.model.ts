import { marked, type Token, type Tokens } from 'marked'

import {
  layout,
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
  type LayoutLine,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'
import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineLine,
} from '../../src/rich-inline.ts'
import { createMarkdownChatSpecs } from './markdown-chat.data.ts'

export const MAX_CHAT_WIDTH = 860
export const TOTAL_MESSAGE_COUNT = 10_000
export const OCCLUSION_BANNER_HEIGHT = 61
export const PAGE_MARGIN = 28
export const MESSAGE_SIDE_PADDING = 22

const COMPACT_OCCLUSION_BANNER_HEIGHT = 43
const COMPACT_OCCLUSION_VIEWPORT_HEIGHT = 460
const CHAT_TOP_PADDING_OFFSET = 14
const CHAT_BOTTOM_PADDING_OFFSET = 10
const MESSAGE_GAP = 12
const BUBBLE_MAX_RATIO = 0.78
export const BUBBLE_PADDING_X = 16
const BUBBLE_PADDING_Y = 10
const BODY_LINE_HEIGHT = 22
const HEADING_ONE_LINE_HEIGHT = 28
const HEADING_TWO_LINE_HEIGHT = 25
const HARD_BREAK_GAP = 4
const BLOCK_GAP = 12
const RICH_BLOCK_GAP = 2
const LIST_ITEM_GAP = 4
const LIST_NESTING_INDENT = 18
const BLOCKQUOTE_INDENT = 18
const LIST_MARKER_GAP = 10
export const CODE_LINE_HEIGHT = 18
export const CODE_BLOCK_PADDING_X = 12
export const CODE_BLOCK_PADDING_Y = 8
const RULE_HEIGHT = 18
const RAIL_OFFSET = 5
const SANS_FAMILY = 'Helvetica, Arial, sans-serif'
const SERIF_FAMILY = '"Iowan Old Style", Georgia, "Times New Roman", serif'
const MONO_FAMILY = '"SF Mono", ui-monospace, Menlo, Monaco, monospace'
const HEADING_LETTER_SPACING_EM = -0.01
// A paragraph takes the direction of its first strong character, the way HTML
// dir=auto reads text. Scripts stand in for bidi classes: letters of these
// right-to-left scripts, RLM and ALM count as right-to-left, and any other
// letter, spacing mark or LRM as left-to-right.
const STRONG_CHARACTER = /[\p{L}\p{Mc}\u200E\u200F\u061C]/u
const RIGHT_TO_LEFT_CHARACTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\u200F\u061C]/u

// The page paints text with the fonts and letter spacing Pretext measured, and
// pills with the side padding their widths count, so typography lives here and
// the CSS doesn't restate it.
export const MARKER_FONT_SIZE = 11
export const MARKER_FONT = `600 ${MARKER_FONT_SIZE}px ${MONO_FAMILY}`
export const CODE_FONT = `500 12px ${MONO_FAMILY}`
export const INLINE_CODE_PADDING_X = 6
export const IMAGE_PADDING_X = 7
const INLINE_CODE_STYLE: TextStyle = {
  className: 'frag frag--code',
  font: `600 12px ${MONO_FAMILY}`,
  letterSpacing: 0,
}
const IMAGE_STYLE: TextStyle = {
  className: 'frag frag--chip',
  font: `700 11px ${SANS_FAMILY}`,
  letterSpacing: 0,
}

type InlineVariant = 'body' | 'heading-1' | 'heading-2'

type MarkState = {
  bold: boolean
  italic: boolean
  strike: boolean
  href: string | null
}

export type TextStyle = {
  className: string
  font: string // Canvas font shorthand, painted as the CSS `font`
  letterSpacing: number // CSS px
}

// A quote paints a rail beside every block it holds, railLeft from the block's
// starting side.
type Quote = {
  railLeft: number
}

// Geometry of the enclosing lists and quotes, in the order they nest.
type ParseContext = {
  contentLeft: number
  listDepth: number
  quotes: Quote[]
}

type InlinePiece = {
  breakMode: 'normal' | 'never'
  extraWidth: number
  href: string | null
  style: TextStyle
  text: string
}

type PreparedBlockBase = {
  contentLeft: number
  direction: 'ltr' | 'rtl' | null // a code block or rule has none until inheritDirection
  marginTop: number
  marker: { left: number; text: string } | null // a list item's first block paints its marker
  quotes: Quote[]
}

type PreparedInlineBlock = PreparedBlockBase & {
  kind: 'inline'
  direction: 'ltr' | 'rtl'
  flow: PreparedRichInline
  hrefs: Array<string | null>
  lineHeight: number
  paragraphStyle: TextStyle // unmarked text, which sets each line's baseline
  // Per item, as hrefs, so a space made by an item holding only whitespace
  // paints in that item's style.
  styles: TextStyle[]
}

type PreparedCodeBlock = PreparedBlockBase & {
  kind: 'code'
  prepared: PreparedTextWithSegments
}

type PreparedRuleBlock = PreparedBlockBase & {
  kind: 'rule'
}

type PreparedBlock = PreparedInlineBlock | PreparedCodeBlock | PreparedRuleBlock

export type PreparedChatMessage = {
  blocks: PreparedBlock[]
  role: 'assistant' | 'user'
}

// A block placed in its message, its top from the bubble's top edge. A code
// block's width is its box's.
export type BlockLayout = {
  direction: 'ltr' | 'rtl'
  height: number
  top: number
} & (
  | { kind: 'inline'; block: PreparedInlineBlock; lines: RichInlineLine[] }
  | { kind: 'code'; block: PreparedCodeBlock; lines: LayoutLine[]; width: number }
  | { kind: 'rule'; block: PreparedRuleBlock }
)

export type QuoteRailLayout = {
  direction: 'ltr' | 'rtl'
  height: number
  left: number
  top: number
}

// The blocks, quote rails and bubble placement a visible message paints with.
// Its bubble height is the message's entry in ConversationLayout.heights.
export type MessageLayout = {
  blocks: BlockLayout[]
  contentInsetX: number
  left: number // from the chat's left edge
  rails: QuoteRailLayout[]
  width: number
}

// Every message's bubble height at one chat width, and its top, in typed
// arrays. Tops and totalHeight leave out the banners: the canvas puts the top
// banner's height above the messages and both banners' heights in its own, so
// a banner change needs no new pass. Only visible messages get a MessageLayout.
export type ConversationLayout = {
  chatWidth: number
  heights: Float64Array
  tops: Float64Array
  totalHeight: number
}

// A message, and how far its top sits below the top banner's edge, negative
// when the banner hides its top. Scrolling keeps it there across relayouts.
export type ScrollAnchor = {
  index: number
  offset: number
}

const EMPTY_MARK_STATE: MarkState = {
  bold: false,
  italic: false,
  strike: false,
  href: null,
}

function parseMarkdownHref(href: string | null | undefined): string | null {
  if (href === undefined || href === null) return null
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

const markerWidthCache = new Map<string, number>()

export function createPreparedChatMessages(): PreparedChatMessage[] {
  const specs = createMarkdownChatSpecs(TOTAL_MESSAGE_COUNT)
  const messages = new Array<PreparedChatMessage>(specs.length)
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index]!
    messages[index] = {
      blocks: parseMarkdownBlocks(spec.markdown),
      role: spec.role,
    }
  }
  return messages
}

export function getMaxChatWidth(viewportWidth: number): number {
  return Math.max(240, Math.min(MAX_CHAT_WIDTH, viewportWidth - PAGE_MARGIN * 2))
}

export function layoutConversation(
  preparedMessages: readonly PreparedChatMessage[],
  chatWidth: number,
): ConversationLayout {
  const heights = new Float64Array(preparedMessages.length)
  const tops = new Float64Array(preparedMessages.length)
  const assistantContentWidth = getMessageWidths('assistant', chatWidth).contentWidth
  const userContentWidth = getMessageWidths('user', chatWidth).contentWidth

  let y = CHAT_TOP_PADDING_OFFSET
  for (let ordinal = 0; ordinal < preparedMessages.length; ordinal++) {
    const preparedMessage = preparedMessages[ordinal]!
    const contentWidth = preparedMessage.role === 'assistant' ? assistantContentWidth : userContentWidth
    const height = measureMessageHeight(preparedMessage, contentWidth)
    heights[ordinal] = height
    tops[ordinal] = y
    y += height
    y += MESSAGE_GAP
  }

  const totalHeight = y - MESSAGE_GAP + CHAT_BOTTOM_PADDING_OFFSET

  return {
    chatWidth,
    heights,
    tops,
    totalHeight,
  }
}

export function getOcclusionBannerHeight(viewportHeight: number): number {
  return viewportHeight <= COMPACT_OCCLUSION_VIEWPORT_HEIGHT
    ? COMPACT_OCCLUSION_BANNER_HEIGHT
    : OCCLUSION_BANNER_HEIGHT
}

// The messages showing between the banners. A message's top in the canvas is
// the top banner's height plus its entry in tops, so the room below the top
// banner starts at scrollTop in tops.
export function findVisibleRange(
  conversation: ConversationLayout,
  scrollTop: number,
  viewportHeight: number,
  occlusionBannerHeight: number,
): {
  end: number
  start: number
} {
  const { heights, tops } = conversation
  const maxY = Math.max(scrollTop, scrollTop + viewportHeight - occlusionBannerHeight * 2)
  let low = 0
  let high = tops.length

  while (low < high) {
    const mid = (low + high) >> 1
    if (tops[mid]! + heights[mid]! > scrollTop) {
      high = mid
    } else {
      low = mid + 1
    }
  }
  const start = low

  low = start
  high = tops.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (tops[mid]! >= maxY) {
      high = mid
    } else {
      low = mid + 1
    }
  }

  return { start, end: low }
}

// The first message whose top shows between the banners at scrollTop. If no
// top shows, as when one tall message fills the room, the last message whose
// top is above the room, or the first message when there's none.
export function findScrollAnchor(
  conversation: ConversationLayout,
  scrollTop: number,
  viewportHeight: number,
  occlusionBannerHeight: number,
): ScrollAnchor {
  const { tops } = conversation
  let low = 0
  let high = tops.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (tops[mid]! >= scrollTop) {
      high = mid
    } else {
      low = mid + 1
    }
  }
  const maxY = scrollTop + viewportHeight - occlusionBannerHeight * 2
  const index = low < tops.length && tops[low]! < maxY ? low : Math.max(0, low - 1)
  return { index, offset: tops[index]! - scrollTop }
}

function parseMarkdownBlocks(markdown: string): PreparedBlock[] {
  const tokens = marked.lexer(markdown, { gfm: true })
  return parseBlockTokens(tokens, { contentLeft: 0, listDepth: 0, quotes: [] })
}

function parseBlockTokens(tokens: readonly Token[], ctx: ParseContext): PreparedBlock[] {
  const blocks: PreparedBlock[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!

    switch (token.type) {
      case 'space':
      case 'def':
      // A task item's checkbox is drawn as its list marker.
      case 'checkbox': {
        continue
      }

      case 'paragraph': {
        appendBlockGroup(blocks, buildInlineBlocks(token.tokens ?? [], 'body', ctx), BLOCK_GAP)
        continue
      }

      case 'heading': {
        appendBlockGroup(
          blocks,
          buildInlineBlocks(token.tokens ?? [], headingVariant(token.depth), ctx),
          BLOCK_GAP + 4,
        )
        continue
      }

      case 'code': {
        appendBlockGroup(blocks, [buildCodeBlock(token.text, ctx)], RICH_BLOCK_GAP)
        continue
      }

      case 'list': {
        // A nested list continues its parent item's rhythm.
        const gap = ctx.listDepth === 0 ? BLOCK_GAP : LIST_ITEM_GAP
        appendBlockGroup(blocks, buildListBlocks(token as Tokens.List, ctx), gap)
        continue
      }

      case 'blockquote': {
        appendBlockGroup(
          blocks,
          parseBlockTokens(token.tokens ?? [], {
            contentLeft: ctx.contentLeft + BLOCKQUOTE_INDENT,
            listDepth: ctx.listDepth,
            quotes: [...ctx.quotes, { railLeft: ctx.contentLeft + RAIL_OFFSET }],
          }),
          RICH_BLOCK_GAP,
        )
        continue
      }

      case 'hr': {
        appendBlockGroup(blocks, [buildRuleBlock(ctx)], BLOCK_GAP + 2)
        continue
      }

      case 'table': {
        appendBlockGroup(blocks, [buildCodeBlock(formatTable(token as Tokens.Table), ctx)], RICH_BLOCK_GAP)
        continue
      }

      case 'html': {
        const htmlText = token.text.trim().length > 0 ? token.text : token.raw
        const isPre = 'pre' in token && token.pre === true
        if (token.block || isPre) {
          appendBlockGroup(blocks, [buildCodeBlock(htmlText, ctx)], RICH_BLOCK_GAP)
        } else {
          appendBlockGroup(blocks, buildPlainTextBlocks(htmlText, ctx), BLOCK_GAP)
        }
        continue
      }

      case 'text': {
        if (Array.isArray(token.tokens) && token.tokens.length > 0) {
          appendBlockGroup(blocks, buildInlineBlocks(token.tokens, 'body', ctx), BLOCK_GAP)
        } else {
          appendBlockGroup(blocks, buildPlainTextBlocks(token.text, ctx), BLOCK_GAP)
        }
        continue
      }

      default: {
        const fallbackText = fallbackTextForToken(token)
        if (fallbackText.length > 0) {
          appendBlockGroup(blocks, buildPlainTextBlocks(fallbackText, ctx), BLOCK_GAP)
        }
      }
    }
  }

  inheritDirection(blocks)
  return blocks
}

function buildListBlocks(token: Tokens.List, ctx: ParseContext): PreparedBlock[] {
  const blocks: PreparedBlock[] = []
  // Top-level lists stay flush; a nested list steps in from its item's content.
  const markerLeft = ctx.contentLeft + (ctx.listDepth === 0 ? 0 : LIST_NESTING_INDENT)

  for (let index = 0; index < token.items.length; index++) {
    const item = token.items[index]!
    const markerText = resolveListMarkerText(token, item, index)
    const itemCtx: ParseContext = {
      contentLeft: markerLeft + measureMarkerWidth(markerText) + LIST_MARKER_GAP,
      listDepth: ctx.listDepth + 1,
      quotes: ctx.quotes,
    }
    let itemBlocks = parseBlockTokens(item.tokens, itemCtx)
    if (itemBlocks.length === 0) {
      itemBlocks = buildPlainTextBlocks(item.text, itemCtx)
    }
    if (itemBlocks.length === 0) continue

    itemBlocks[0]!.marker = { left: markerLeft, text: markerText }
    appendBlockGroup(blocks, itemBlocks, LIST_ITEM_GAP)
  }

  inheritDirection(blocks)
  return blocks
}

// A code block or rule has no text to read a direction from. It takes the
// direction of the first paragraph in its list item, list or quote, else in
// the enclosing one, out to the message.
function inheritDirection(blocks: PreparedBlock[]): void {
  let direction: 'ltr' | 'rtl' | null = null
  for (let index = 0; index < blocks.length && direction === null; index++) {
    direction = blocks[index]!.direction
  }
  if (direction === null) return
  for (let index = 0; index < blocks.length; index++) {
    blocks[index]!.direction ??= direction
  }
}

function buildPlainTextBlocks(text: string, ctx: ParseContext): PreparedBlock[] {
  const piece = createTextPiece(text, EMPTY_MARK_STATE, 'body')
  if (piece === null) return []
  return buildPreparedInlineBlocks([[piece]], 'body', ctx)
}

function buildInlineBlocks(
  tokens: readonly Token[],
  variant: InlineVariant,
  ctx: ParseContext,
): PreparedBlock[] {
  const lines = collectInlinePieceLines(tokens, variant)
  return buildPreparedInlineBlocks(lines, variant, ctx)
}

function buildPreparedInlineBlocks(
  lines: InlinePiece[][],
  variant: InlineVariant,
  ctx: ParseContext,
): PreparedBlock[] {
  const blocks: PreparedBlock[] = []
  // Hard breaks split a paragraph into blocks, but the paragraph has one direction.
  const direction = resolveDirection(lines)

  for (let index = 0; index < lines.length; index++) {
    const block = buildPreparedInlineBlock(lines[index]!, variant, direction, ctx)
    if (block === null) continue
    block.marginTop = blocks.length === 0 ? 0 : HARD_BREAK_GAP
    blocks.push(block)
  }

  return blocks
}

function buildPreparedInlineBlock(
  pieces: InlinePiece[],
  variant: InlineVariant,
  direction: 'ltr' | 'rtl',
  ctx: ParseContext,
): PreparedInlineBlock | null {
  if (pieces.length === 0) return null

  return {
    ...createBlockBase(ctx),
    direction,
    flow: prepareRichInline(pieces.map(piece => ({
      text: piece.text,
      font: piece.style.font,
      letterSpacing: piece.style.letterSpacing,
      break: piece.breakMode,
      extraWidth: piece.extraWidth,
    }))),
    hrefs: pieces.map(piece => piece.href),
    kind: 'inline',
    lineHeight: lineHeightForVariant(variant),
    paragraphStyle: resolveTextStyle(variant, EMPTY_MARK_STATE),
    styles: pieces.map(piece => piece.style),
  }
}

function resolveDirection(lines: readonly InlinePiece[][]): 'ltr' | 'rtl' {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const pieces = lines[lineIndex]!
    for (let index = 0; index < pieces.length; index++) {
      const strong = STRONG_CHARACTER.exec(pieces[index]!.text)
      if (strong !== null) return RIGHT_TO_LEFT_CHARACTER.test(strong[0]) ? 'rtl' : 'ltr'
    }
  }
  return 'ltr'
}

function buildCodeBlock(text: string, ctx: ParseContext): PreparedCodeBlock {
  return {
    ...createBlockBase(ctx),
    kind: 'code',
    prepared: prepareWithSegments(stripSingleTrailingNewline(text), CODE_FONT, {
      whiteSpace: 'pre-wrap',
    }),
  }
}

function buildRuleBlock(ctx: ParseContext): PreparedRuleBlock {
  return {
    ...createBlockBase(ctx),
    kind: 'rule',
  }
}

function createBlockBase(ctx: ParseContext): PreparedBlockBase {
  return {
    contentLeft: ctx.contentLeft,
    direction: null,
    marginTop: 0,
    marker: null,
    quotes: ctx.quotes,
  }
}

function collectInlinePieceLines(
  tokens: readonly Token[],
  variant: InlineVariant,
): InlinePiece[][] {
  const lines: InlinePiece[][] = [[]]

  function pushPiece(piece: InlinePiece | null): void {
    if (piece === null) return
    const line = lines[lines.length - 1]!
    const previous = line[line.length - 1]
    if (previous !== undefined && canMergeInlinePieces(previous, piece)) {
      previous.text += piece.text
      return
    }
    line.push(piece)
  }

  function walk(tokenList: readonly Token[], marks: MarkState): void {
    for (let index = 0; index < tokenList.length; index++) {
      const token = tokenList[index]!

      switch (token.type) {
        case 'text': {
          if (Array.isArray(token.tokens) && token.tokens.length > 0) {
            walk(token.tokens, marks)
          } else {
            pushPiece(createTextPiece(token.text, marks, variant))
          }
          continue
        }

        case 'escape': {
          pushPiece(createTextPiece(token.text, marks, variant))
          continue
        }

        case 'strong': {
          walk(token.tokens ?? [], { ...marks, bold: true })
          continue
        }

        case 'em': {
          walk(token.tokens ?? [], { ...marks, italic: true })
          continue
        }

        case 'del': {
          walk(token.tokens ?? [], { ...marks, strike: true })
          continue
        }

        case 'codespan': {
          pushPiece(createCodePiece(token.text))
          continue
        }

        case 'link': {
          walk(token.tokens ?? [], { ...marks, href: parseMarkdownHref(token.href) })
          continue
        }

        case 'image': {
          pushPiece(createImagePiece(token.text.length > 0 ? token.text : token.href))
          continue
        }

        case 'br': {
          lines.push([])
          continue
        }

        case 'checkbox': {
          continue
        }

        case 'html': {
          pushPiece(createTextPiece(token.text, marks, variant))
          continue
        }

        default: {
          const fallback = fallbackTextForToken(token)
          if (fallback.length > 0) {
            pushPiece(createTextPiece(fallback, marks, variant))
          }
        }
      }
    }
  }

  walk(tokens, EMPTY_MARK_STATE)

  while (lines.length > 0 && lines[lines.length - 1]!.length === 0) {
    lines.pop()
  }

  return lines
}

function createTextPiece(
  text: string,
  marks: MarkState,
  variant: InlineVariant,
): InlinePiece | null {
  if (text.length === 0) return null

  return {
    breakMode: 'normal',
    extraWidth: 0,
    href: marks.href,
    style: resolveTextStyle(variant, marks),
    text,
  }
}

function createCodePiece(text: string): InlinePiece | null {
  if (text.length === 0) return null

  return {
    breakMode: 'normal',
    extraWidth: INLINE_CODE_PADDING_X * 2,
    href: null,
    style: INLINE_CODE_STYLE,
    text,
  }
}

function createImagePiece(text: string): InlinePiece {
  return {
    breakMode: 'never',
    extraWidth: IMAGE_PADDING_X * 2,
    href: null,
    style: IMAGE_STYLE,
    text: text.length > 0 ? text : 'image',
  }
}

function canMergeInlinePieces(a: InlinePiece, b: InlinePiece): boolean {
  return (
    a.breakMode === b.breakMode &&
    a.extraWidth === b.extraWidth &&
    a.href === b.href &&
    a.style === b.style
  )
}

// One style object per variant and marks, so pieces in the same style merge.
const textStyles: Record<InlineVariant, Array<TextStyle | undefined>> = { body: [], 'heading-1': [], 'heading-2': [] }

function resolveTextStyle(variant: InlineVariant, marks: MarkState): TextStyle {
  const styles = textStyles[variant]
  const index = (marks.bold ? 8 : 0) + (marks.italic ? 4 : 0) + (marks.strike ? 2 : 0) + (marks.href === null ? 0 : 1)
  let style = styles[index]
  if (style === undefined) {
    style = createTextStyle(variant, marks)
    styles[index] = style
  }
  return style
}

function createTextStyle(variant: InlineVariant, marks: MarkState): TextStyle {
  // Bold and italic are in the font, so only links and deletions add a class.
  const className = `frag${marks.href === null ? '' : ' is-link'}${marks.strike ? ' is-del' : ''}`
  const italicPrefix = marks.italic ? 'italic ' : ''
  // Links keep the body weight; color and underline mark them.
  if (variant === 'body') {
    return { className, font: `${italicPrefix}${marks.bold ? 700 : 400} 14px ${SANS_FAMILY}`, letterSpacing: 0 }
  }
  // Headings are already bold, and bold text inside one keeps that weight.
  const size = variant === 'heading-1' ? 20 : 17
  return {
    className,
    font: `${italicPrefix}700 ${size}px ${SERIF_FAMILY}`,
    letterSpacing: size * HEADING_LETTER_SPACING_EM,
  }
}

function headingVariant(depth: number): InlineVariant {
  if (depth <= 1) return 'heading-1'
  if (depth === 2) return 'heading-2'
  return 'body'
}

function lineHeightForVariant(variant: InlineVariant): number {
  switch (variant) {
    case 'heading-1':
      return HEADING_ONE_LINE_HEIGHT
    case 'heading-2':
      return HEADING_TWO_LINE_HEIGHT
    case 'body':
      return BODY_LINE_HEIGHT
  }
}

function appendBlockGroup(
  target: PreparedBlock[],
  group: PreparedBlock[],
  firstMargin: number,
): void {
  if (group.length === 0) return
  group[0]!.marginTop = target.length === 0 ? 0 : firstMargin
  for (let index = 0; index < group.length; index++) target.push(group[index]!)
}

function resolveListMarkerText(
  list: Tokens.List,
  item: Tokens.ListItem,
  index: number,
): string {
  if (item.task) return item.checked ? '☑' : '☐'
  if (list.ordered) {
    const start = typeof list.start === 'number' ? list.start : 1
    return `${start + index}.`
  }
  return '•'
}

function measureMarkerWidth(text: string): number {
  const cached = markerWidthCache.get(text)
  if (cached !== undefined) return cached

  const width = measureNaturalWidth(prepareWithSegments(text, MARKER_FONT))
  markerWidthCache.set(text, width)
  return width
}

function fallbackTextForToken(token: Token): string {
  if ('text' in token && typeof token.text === 'string') return token.text
  return token.raw ?? ''
}

function formatTable(token: Tokens.Table): string {
  const header = token.header.map(cell => inlineTokensToPlainText(cell.tokens)).join(' | ')
  const divider = token.header.map(() => '---').join(' | ')
  const rows = token.rows.map(row => row.map(cell => inlineTokensToPlainText(cell.tokens)).join(' | '))
  return [header, divider, ...rows].join('\n')
}

function inlineTokensToPlainText(tokens: readonly Token[]): string {
  let text = ''
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        text += inlineTokensToPlainText(token.tokens ?? [])
        break
      case 'codespan':
      case 'escape':
      case 'text':
      case 'html':
      case 'image':
        text += token.text
        break
      case 'br':
        text += '\n'
        break
      default:
        text += fallbackTextForToken(token)
    }
  }
  return text
}

function stripSingleTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

type MessageWidths = {
  contentInsetX: number
  contentWidth: number // the width its blocks lay out in
  maxBubbleWidth: number
}

// An assistant message spans the lane. A user bubble is at most
// BUBBLE_MAX_RATIO of the chat wide, and its padding insets its content.
function getMessageWidths(role: PreparedChatMessage['role'], chatWidth: number): MessageWidths {
  const laneWidth = Math.max(120, chatWidth - MESSAGE_SIDE_PADDING * 2)
  const maxBubbleWidth = role === 'assistant'
    ? laneWidth
    : Math.min(laneWidth, Math.max(240, Math.floor(chatWidth * BUBBLE_MAX_RATIO)))
  const contentInsetX = role === 'assistant' ? 0 : BUBBLE_PADDING_X
  return { contentInsetX, contentWidth: Math.max(120, maxBubbleWidth - contentInsetX * 2), maxBubbleWidth }
}

// A message's bubble height, from line counts alone, so a width change builds
// no block objects. layoutMessage() places the blocks with the same top
// padding and block margins.
function measureMessageHeight(preparedMessage: PreparedChatMessage, contentWidth: number): number {
  let y = BUBBLE_PADDING_Y
  for (let index = 0; index < preparedMessage.blocks.length; index++) {
    const block = preparedMessage.blocks[index]!
    y += block.marginTop
    let lineCount = 0
    if (block.kind === 'inline') {
      lineCount = measureRichInlineStats(block.flow, getBlockLineWidth(block, contentWidth)).lineCount
    } else if (block.kind === 'code') {
      lineCount = layout(block.prepared, getBlockLineWidth(block, contentWidth), CODE_LINE_HEIGHT).lineCount
    }
    y += getBlockHeight(block, lineCount)
  }
  return y + BUBBLE_PADDING_Y
}

// The width a block's lines wrap at: past its indent, and for code, inside its
// box's padding.
function getBlockLineWidth(block: PreparedInlineBlock | PreparedCodeBlock, contentWidth: number): number {
  const width = Math.max(1, contentWidth - block.contentLeft)
  return block.kind === 'inline' ? width : Math.max(1, width - CODE_BLOCK_PADDING_X * 2)
}

// A block's height with lineCount lines at getBlockLineWidth(). A rule has no
// lines.
function getBlockHeight(block: PreparedBlock, lineCount: number): number {
  switch (block.kind) {
    case 'inline':
      return lineCount * block.lineHeight
    case 'code':
      return lineCount * CODE_LINE_HEIGHT + CODE_BLOCK_PADDING_Y * 2
    case 'rule':
      return RULE_HEIGHT
  }
}

// The blocks, quote rails and bubble placement a visible message paints with,
// from one walk over each block's lines.
//
// A quote's rail runs beside its blocks, from the top of the first to the
// bottom of the last, across the gaps between them. Each block starts from its
// own side, indented past every enclosing quote's rail, so a quote with blocks
// on both sides paints one rail per run of blocks on the same side. A quote's
// blocks are consecutive, so each block extends its quote's last rail, or opens
// a new one where the side changes.
export function layoutMessage(preparedMessage: PreparedChatMessage, chatWidth: number): MessageLayout {
  const { contentInsetX, contentWidth, maxBubbleWidth } = getMessageWidths(preparedMessage.role, chatWidth)
  const blocks: BlockLayout[] = []
  const rails: QuoteRailLayout[] = []
  const lastRails = new Map<Quote, QuoteRailLayout>()
  let y = BUBBLE_PADDING_Y
  let usedContentWidth = 0

  for (let index = 0; index < preparedMessage.blocks.length; index++) {
    const block = preparedMessage.blocks[index]!
    y += block.marginTop
    // A message with no paragraph at all is left-to-right.
    const direction = block.direction ?? 'ltr'
    let blockLayout: BlockLayout
    switch (block.kind) {
      case 'inline': {
        const lines: RichInlineLine[] = []
        let maxLineWidth = 0
        walkRichInlineLineRanges(block.flow, getBlockLineWidth(block, contentWidth), range => {
          lines.push(materializeRichInlineLineRange(block.flow, range))
          maxLineWidth = Math.max(maxLineWidth, range.width)
        })
        usedContentWidth = Math.max(usedContentWidth, block.contentLeft + maxLineWidth)
        blockLayout = { block, direction, height: getBlockHeight(block, lines.length), kind: 'inline', lines, top: y }
        break
      }
      case 'code': {
        const { lines } = layoutWithLines(block.prepared, getBlockLineWidth(block, contentWidth), CODE_LINE_HEIGHT)
        let maxLineWidth = 0
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          maxLineWidth = Math.max(maxLineWidth, lines[lineIndex]!.width)
        }
        const width = maxLineWidth + CODE_BLOCK_PADDING_X * 2
        usedContentWidth = Math.max(usedContentWidth, block.contentLeft + width)
        blockLayout = { block, direction, height: getBlockHeight(block, lines.length), kind: 'code', lines, top: y, width }
        break
      }
      case 'rule':
        // A rule has no width of its own. It stretches across the final bubble.
        usedContentWidth = Math.max(usedContentWidth, block.contentLeft)
        blockLayout = { block, direction, height: getBlockHeight(block, 0), kind: 'rule', top: y }
        break
    }
    blocks.push(blockLayout)

    for (let depth = 0; depth < block.quotes.length; depth++) {
      const quote = block.quotes[depth]!
      const rail = lastRails.get(quote)
      if (rail === undefined || rail.direction !== direction) {
        const opened = { direction, height: blockLayout.height, left: quote.railLeft, top: y }
        lastRails.set(quote, opened)
        rails.push(opened)
      } else {
        rail.height = y + blockLayout.height - rail.top
      }
    }
    y += blockLayout.height
  }

  const width = preparedMessage.role === 'assistant'
    ? maxBubbleWidth
    : Math.min(maxBubbleWidth, contentInsetX * 2 + Math.max(1, usedContentWidth))
  // An assistant bubble starts at the lane's left edge, a user bubble ends at its
  // right edge.
  const left = preparedMessage.role === 'assistant' ? MESSAGE_SIDE_PADDING : chatWidth - MESSAGE_SIDE_PADDING - width
  return { blocks, contentInsetX, left, rails, width }
}
