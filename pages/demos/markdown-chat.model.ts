import { marked, type Token, type Tokens } from 'marked'

import {
  layout,
  layoutWithLines,
  measureLineStats,
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
} from '../../src/rich-inline.ts'
import { createMarkdownChatSpecs, type MarkdownChatSeed } from './markdown-chat.data.ts'

export const MAX_CHAT_WIDTH = 860
export const TOTAL_MESSAGE_COUNT = 10_000
// History loads and unloads in chunks of this many messages. Preparing a chunk
// is the most work a frame does: in Chrome on an M5 Max, 50 messages load within
// a 120 Hz frame, and twice as many take twice as long.
const HISTORY_CHUNK_SIZE = 50
// The most chunks loaded at once, unless the chunks on screen and one on either
// side need more. While every chunk is taller than the room between the banners,
// the screen shows at most two chunks, so the window wants at most four. With
// fewer, the screen's edge crossing a chunk boundary back and forth would load
// and drop the same chunk each time.
const HISTORY_WINDOW_CHUNKS = 4
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
const INLINE_CODE_EXTRA_WIDTH = 12
const IMAGE_EXTRA_WIDTH = 14
// A paragraph takes the direction of its first strong character, the way HTML
// dir=auto reads text. Scripts stand in for bidi classes: letters of these
// right-to-left scripts, RLM and ALM count as right-to-left, and any other
// letter, spacing mark or LRM as left-to-right.
const STRONG_CHARACTER = /[\p{L}\p{Mc}\u200E\u200F\u061C]/u
const RIGHT_TO_LEFT_CHARACTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\u200F\u061C]/u

// The page paints text with the fonts and letter spacing Pretext measured, so
// typography lives here and the CSS doesn't restate it.
export const MARKER_FONT = `600 11px ${MONO_FAMILY}`
export const CODE_FONT = `500 12px ${MONO_FAMILY}`
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
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  quotes: Quote[]
}

type PreparedInlineBlock = PreparedBlockBase & {
  kind: 'inline'
  direction: 'ltr' | 'rtl'
  flow: PreparedRichInline
  hrefs: Array<string | null>
  lineHeight: number
  paragraphStyle: TextStyle // unmarked text, which sets each line's baseline
  styles: TextStyle[]
}

type PreparedCodeBlock = PreparedBlockBase & {
  kind: 'code'
  lineHeight: number
  prepared: PreparedTextWithSegments
}

type PreparedRuleBlock = PreparedBlockBase & {
  kind: 'rule'
  height: number
}

type PreparedBlock = PreparedInlineBlock | PreparedCodeBlock | PreparedRuleBlock

export type PreparedChatMessage = {
  blocks: PreparedBlock[]
  role: 'assistant' | 'user'
}

export type InlineFragmentLayout = {
  gapItemIndex: number // the item whose collapsed space precedes it on its line, or -1
  href: string | null
  itemIndex: number
  style: TextStyle
  text: string
}

type BlockFrameBase = {
  contentLeft: number
  height: number
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  top: number
}

type InlineBlockFrame = BlockFrameBase & {
  kind: 'inline'
  lineHeight: number
  usedWidth: number
}

type CodeBlockFrame = BlockFrameBase & {
  kind: 'code'
  lineHeight: number
  width: number
}

type RuleBlockFrame = BlockFrameBase & {
  kind: 'rule'
}

type BlockFrame = InlineBlockFrame | CodeBlockFrame | RuleBlockFrame

type InlineBlockLayout = {
  contentLeft: number
  direction: 'ltr' | 'rtl'
  height: number
  hrefs: Array<string | null>
  kind: 'inline'
  lineHeight: number
  lines: Array<{
    fragments: InlineFragmentLayout[]
  }>
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  paragraphStyle: TextStyle
  // Per item, as hrefs, so a space made by an item holding only whitespace
  // paints in that item's style.
  styles: TextStyle[]
  top: number
  width: number
}

type CodeBlockLayout = {
  contentLeft: number
  direction: 'ltr' | 'rtl'
  height: number
  kind: 'code'
  lines: LayoutLine[]
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  top: number
  width: number
}

type RuleBlockLayout = {
  contentLeft: number
  direction: 'ltr' | 'rtl'
  height: number
  kind: 'rule'
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  top: number
  width: number
}

export type BlockLayout = InlineBlockLayout | CodeBlockLayout | RuleBlockLayout

export type QuoteRailLayout = {
  direction: 'ltr' | 'rtl'
  height: number
  left: number
  top: number
}

export type MessageFrame = {
  blocks: BlockFrame[]
  contentInsetX: number
  frameWidth: number
  layoutContentWidth: number
}

// The loaded part of the history: whole chunks in order, starting with the
// chunk whose first message is at firstOrdinal, and their layout. Only these
// messages are prepared and laid out, and the scroll area holds only them.
export type HistoryWindow = {
  firstOrdinal: number
  layout: ConversationLayout
  messages: PreparedChatMessage[]
}

// Every message's bubble height at one chat width, and its top, in typed
// arrays. Tops and totalHeight leave out the banners: the canvas puts the top
// banner's height above the messages and both banners' heights in its own, so
// a banner change needs no new pass. Only visible messages get a MessageFrame.
export type ConversationLayout = {
  chatWidth: number
  heights: Float64Array
  tops: Float64Array
  totalHeight: number
}

// A message, by its ordinal in the history, and how far its top sits below the
// top banner's edge, negative when the banner hides its top. Scrolling keeps it
// there across relayouts, loads and unloads.
export type ScrollAnchor = {
  offset: number
  ordinal: number
}

// The chat scrolled to its top.
export const TOP_SCROLL_ANCHOR: ScrollAnchor = { offset: CHAT_TOP_PADDING_OFFSET, ordinal: 0 }

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

export function createChatHistory(): MarkdownChatSeed[] {
  return createMarkdownChatSpecs(TOTAL_MESSAGE_COUNT)
}

// The chunks holding the first and last messages kept stay loaded, with one
// more chunk on either side. The window grows toward those, then, while it holds
// more than HISTORY_WINDOW_CHUNKS, drops its first or last chunk, whichever is
// farther from the kept ones, unless that chunk is one of those. Kept messages
// are loaded ones, so once anything has been shown, a move loads at most one
// chunk on either side. A window whose
// chunks or chat width change is a new object, laid out again. Before the first
// frame there's no window, and it loads around the kept messages.
export function moveHistoryWindow(
  history: readonly MarkdownChatSeed[],
  historyWindow: HistoryWindow | null,
  firstKeptOrdinal: number,
  lastKeptOrdinal: number,
  chatWidth: number,
): HistoryWindow {
  const firstKeptChunk = Math.floor(firstKeptOrdinal / HISTORY_CHUNK_SIZE)
  const lastKeptChunk = Math.floor(lastKeptOrdinal / HISTORY_CHUNK_SIZE)
  const firstWantedChunk = Math.max(0, firstKeptChunk - 1)
  const lastWantedChunk = Math.min(Math.ceil(history.length / HISTORY_CHUNK_SIZE) - 1, lastKeptChunk + 1)
  let messages: PreparedChatMessage[] = historyWindow === null ? [] : historyWindow.messages
  let firstChunk = historyWindow === null ? firstKeptChunk : historyWindow.firstOrdinal / HISTORY_CHUNK_SIZE
  let lastChunk = Math.ceil((firstChunk * HISTORY_CHUNK_SIZE + messages.length) / HISTORY_CHUNK_SIZE) - 1
  if (
    historyWindow !== null &&
    historyWindow.layout.chatWidth === chatWidth &&
    firstChunk <= firstWantedChunk &&
    lastChunk >= lastWantedChunk
  ) {
    return historyWindow
  }

  for (; firstChunk > firstWantedChunk; firstChunk--) {
    messages = prepareHistoryChunk(history, firstChunk - 1).concat(messages)
  }
  for (; lastChunk < lastWantedChunk; lastChunk++) {
    messages = messages.concat(prepareHistoryChunk(history, lastChunk + 1))
  }
  while (
    lastChunk - firstChunk + 1 > HISTORY_WINDOW_CHUNKS &&
    (firstChunk < firstWantedChunk || lastChunk > lastWantedChunk)
  ) {
    if (firstKeptChunk - firstChunk > lastChunk - lastKeptChunk) {
      messages = messages.slice(HISTORY_CHUNK_SIZE)
      firstChunk++
    } else {
      messages = messages.slice(0, (lastChunk - firstChunk) * HISTORY_CHUNK_SIZE)
      lastChunk--
    }
  }
  return { firstOrdinal: firstChunk * HISTORY_CHUNK_SIZE, layout: layoutConversation(messages, chatWidth), messages }
}

function prepareHistoryChunk(history: readonly MarkdownChatSeed[], chunk: number): PreparedChatMessage[] {
  const start = chunk * HISTORY_CHUNK_SIZE
  const end = Math.min(history.length, start + HISTORY_CHUNK_SIZE)
  const messages = new Array<PreparedChatMessage>(end - start)
  for (let ordinal = start; ordinal < end; ordinal++) {
    const spec = history[ordinal]!
    messages[ordinal - start] = {
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

  const totalHeight =
    preparedMessages.length === 0
      ? CHAT_TOP_PADDING_OFFSET + CHAT_BOTTOM_PADDING_OFFSET
      : y - MESSAGE_GAP + CHAT_BOTTOM_PADDING_OFFSET

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

// The first message whose top shows between the banners when the window is
// scrolled to scrollTop. If no top shows, as when one tall message fills the
// room, the last message whose top is above the room, or the window's first
// message when there's none.
export function findScrollAnchor(
  historyWindow: HistoryWindow,
  scrollTop: number,
  viewportHeight: number,
  occlusionBannerHeight: number,
): ScrollAnchor {
  const { tops } = historyWindow.layout
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
  return { offset: tops[index]! - scrollTop, ordinal: historyWindow.firstOrdinal + index }
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
          appendBlockGroup(blocks, buildPlainTextBlocks(htmlText, 'body', ctx), BLOCK_GAP)
        }
        continue
      }

      case 'text': {
        if (Array.isArray(token.tokens) && token.tokens.length > 0) {
          appendBlockGroup(blocks, buildInlineBlocks(token.tokens, 'body', ctx), BLOCK_GAP)
        } else {
          appendBlockGroup(blocks, buildPlainTextBlocks(token.text, 'body', ctx), BLOCK_GAP)
        }
        continue
      }

      default: {
        const fallbackText = fallbackTextForToken(token)
        if (fallbackText.length > 0) {
          appendBlockGroup(blocks, buildPlainTextBlocks(fallbackText, 'body', ctx), BLOCK_GAP)
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
      itemBlocks = buildPlainTextBlocks(item.text, 'body', itemCtx)
    }
    if (itemBlocks.length === 0) continue

    itemBlocks[0] = {
      ...itemBlocks[0]!,
      markerClassName: resolveListMarkerClassName(token, item),
      markerLeft,
      markerText,
    } satisfies PreparedBlock
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

function buildPlainTextBlocks(
  text: string,
  variant: InlineVariant,
  ctx: ParseContext,
): PreparedBlock[] {
  const piece = createTextPiece(text, EMPTY_MARK_STATE, variant)
  if (piece === null) return []
  return buildPreparedInlineBlocks([[piece]], variant, ctx)
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
    blocks.push({
      ...block,
      marginTop: blocks.length === 0 ? 0 : HARD_BREAK_GAP,
    } satisfies PreparedBlock)
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
    lineHeight: CODE_LINE_HEIGHT,
    prepared: prepareWithSegments(stripSingleTrailingNewline(text), CODE_FONT, {
      whiteSpace: 'pre-wrap',
    }),
  }
}

function buildRuleBlock(ctx: ParseContext): PreparedRuleBlock {
  return {
    ...createBlockBase(ctx),
    height: RULE_HEIGHT,
    kind: 'rule',
  }
}

function createBlockBase(ctx: ParseContext): PreparedBlockBase {
  return {
    contentLeft: ctx.contentLeft,
    direction: null,
    marginTop: 0,
    markerClassName: null,
    markerLeft: null,
    markerText: null,
    quotes: ctx.quotes,
  }
}

function collectInlinePieceLines(
  tokens: readonly Token[],
  variant: InlineVariant,
): InlinePiece[][] {
  const lines: InlinePiece[][] = [[]]

  function currentLine(): InlinePiece[] {
    return lines[lines.length - 1]!
  }

  function pushLineBreak(): void {
    lines.push([])
  }

  function pushPiece(piece: InlinePiece | null): void {
    if (piece === null) return
    const line = currentLine()
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
          pushLineBreak()
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
    extraWidth: INLINE_CODE_EXTRA_WIDTH,
    href: null,
    style: INLINE_CODE_STYLE,
    text,
  }
}

function createImagePiece(text: string): InlinePiece {
  return {
    breakMode: 'never',
    extraWidth: IMAGE_EXTRA_WIDTH,
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

const textStyleCache = new Map<string, TextStyle>()

function resolveTextStyle(variant: InlineVariant, marks: MarkState): TextStyle {
  const className = resolveTextClassName(variant, marks)
  let style = textStyleCache.get(className)
  if (style === undefined) {
    style = createTextStyle(className, variant, marks)
    textStyleCache.set(className, style)
  }
  return style
}

function createTextStyle(className: string, variant: InlineVariant, marks: MarkState): TextStyle {
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

function resolveTextClassName(variant: InlineVariant, marks: MarkState): string {
  let className = 'frag'

  switch (variant) {
    case 'heading-1':
      className += ' frag--heading-1'
      break
    case 'heading-2':
      className += ' frag--heading-2'
      break
    case 'body':
      className += ' frag--body'
      break
  }

  if (marks.href !== null) className += ' is-link'
  if (marks.bold) className += ' is-strong'
  if (marks.italic) className += ' is-em'
  if (marks.strike) className += ' is-del'
  return className
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

  for (let index = 0; index < group.length; index++) {
    const block = group[index]!
    target.push({
      ...block,
      marginTop: index === 0 ? (target.length === 0 ? 0 : firstMargin) : block.marginTop,
    } satisfies PreparedBlock)
  }
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

function resolveListMarkerClassName(
  list: Tokens.List,
  item: Tokens.ListItem,
): string {
  if (item.task) return 'block-marker block-marker--task'
  return list.ordered
    ? 'block-marker block-marker--ordered'
    : 'block-marker block-marker--bullet'
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
        text += token.text
        break
      case 'br':
        text += '\n'
        break
      case 'image':
        text += token.text
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
  maxFrameWidth: number
}

// An assistant message spans the lane. A user bubble is at most
// BUBBLE_MAX_RATIO of the chat wide, and its padding insets its content.
function getMessageWidths(role: PreparedChatMessage['role'], chatWidth: number): MessageWidths {
  const laneWidth = Math.max(120, chatWidth - MESSAGE_SIDE_PADDING * 2)
  const maxFrameWidth = role === 'assistant'
    ? laneWidth
    : Math.min(laneWidth, Math.max(240, Math.floor(chatWidth * BUBBLE_MAX_RATIO)))
  const contentInsetX = role === 'assistant' ? 0 : BUBBLE_PADDING_X
  return { contentInsetX, contentWidth: Math.max(120, maxFrameWidth - contentInsetX * 2), maxFrameWidth }
}

// A message's bubble height, from line counts alone, so a width change builds
// no block objects. layoutMessageFrame() places the blocks with the same top
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
      lineCount = layout(block.prepared, getBlockLineWidth(block, contentWidth), block.lineHeight).lineCount
    }
    y += getBlockHeight(block, lineCount)
  }
  return y + BUBBLE_PADDING_Y
}

// The blocks and bubble width a visible message paints with. Its bubble height
// is the message's entry in ConversationLayout.heights.
export function layoutMessageFrame(preparedMessage: PreparedChatMessage, chatWidth: number): MessageFrame {
  const { contentInsetX, contentWidth, maxFrameWidth } = getMessageWidths(preparedMessage.role, chatWidth)
  let y = BUBBLE_PADDING_Y
  const blocks: BlockFrame[] = []
  let usedContentWidth = 0

  for (let index = 0; index < preparedMessage.blocks.length; index++) {
    const block = preparedMessage.blocks[index]!
    y += block.marginTop
    const blockFrame = layoutBlockFrame(block, contentWidth, y)
    blocks.push(blockFrame)
    y += blockFrame.height
    usedContentWidth = Math.max(usedContentWidth, getUsedBlockWidth(blockFrame))
  }

  const frameWidth = preparedMessage.role === 'assistant'
    ? maxFrameWidth
    : Math.min(maxFrameWidth, contentInsetX * 2 + Math.max(1, usedContentWidth))
  return {
    blocks,
    contentInsetX,
    frameWidth,
    layoutContentWidth: contentWidth,
  }
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
      return lineCount * block.lineHeight + CODE_BLOCK_PADDING_Y * 2
    case 'rule':
      return block.height
  }
}

function layoutBlockFrame(
  block: PreparedBlock,
  contentWidth: number,
  top: number,
): BlockFrame {
  switch (block.kind) {
    case 'inline': {
      const { lineCount, maxLineWidth } = measureRichInlineStats(block.flow, getBlockLineWidth(block, contentWidth))
      return {
        contentLeft: block.contentLeft,
        height: getBlockHeight(block, lineCount),
        kind: 'inline',
        lineHeight: block.lineHeight,
        markerClassName: block.markerClassName,
        markerLeft: block.markerLeft,
        markerText: block.markerText,
        top,
        usedWidth: maxLineWidth,
      }
    }

    case 'code': {
      const { lineCount, maxLineWidth } = measureLineStats(block.prepared, getBlockLineWidth(block, contentWidth))
      return {
        contentLeft: block.contentLeft,
        height: getBlockHeight(block, lineCount),
        kind: 'code',
        lineHeight: block.lineHeight,
        markerClassName: block.markerClassName,
        markerLeft: block.markerLeft,
        markerText: block.markerText,
        top,
        width: maxLineWidth + CODE_BLOCK_PADDING_X * 2,
      }
    }

    case 'rule': {
      return {
        contentLeft: block.contentLeft,
        height: getBlockHeight(block, 0),
        kind: 'rule',
        markerClassName: block.markerClassName,
        markerLeft: block.markerLeft,
        markerText: block.markerText,
        top,
      }
    }
  }
}

function getUsedBlockWidth(block: BlockFrame): number {
  switch (block.kind) {
    case 'inline':
      return block.contentLeft + block.usedWidth
    case 'code':
      return block.contentLeft + block.width
    case 'rule':
      // A rule has no width of its own. It stretches across the final bubble.
      return block.contentLeft
  }
}

export function materializeMessageBlocks(preparedMessage: PreparedChatMessage, frame: MessageFrame): BlockLayout[] {
  const bubbleContentWidth = frame.frameWidth - frame.contentInsetX * 2
  return preparedMessage.blocks.map((block, index) =>
    materializeBlockLayout(block, frame.blocks[index]!, frame.layoutContentWidth, bubbleContentWidth),
  )
}

// A quote's rail runs beside its blocks, from the top of the first to the
// bottom of the last, across the gaps between them. Each block starts from its
// own side, indented past every enclosing quote's rail, so a quote with blocks
// on both sides paints one rail per run of blocks on the same side. A quote's
// blocks are consecutive, so each block extends its quote's last rail, or opens
// a new one where the side changes.
export function materializeQuoteRails(preparedMessage: PreparedChatMessage, frame: MessageFrame): QuoteRailLayout[] {
  const rails: QuoteRailLayout[] = []
  const lastRails = new Map<Quote, QuoteRailLayout>()
  const { blocks } = preparedMessage
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    const blockFrame = frame.blocks[index]!
    // A message with no paragraph at all is left-to-right.
    const direction = block.direction ?? 'ltr'
    for (let depth = 0; depth < block.quotes.length; depth++) {
      const quote = block.quotes[depth]!
      const rail = lastRails.get(quote)
      if (rail === undefined || rail.direction !== direction) {
        const opened = { direction, height: blockFrame.height, left: quote.railLeft, top: blockFrame.top }
        lastRails.set(quote, opened)
        rails.push(opened)
      } else {
        rail.height = blockFrame.top + blockFrame.height - rail.top
      }
    }
  }
  return rails
}

function materializeBlockLayout(
  block: PreparedBlock,
  frame: BlockFrame,
  contentWidth: number,
  bubbleContentWidth: number,
): BlockLayout {
  switch (frame.kind) {
    case 'inline': {
      if (block.kind !== 'inline') throw new Error('Inline block/frame mismatch')
      const lines: InlineBlockLayout['lines'] = []
      walkRichInlineLineRanges(block.flow, getBlockLineWidth(block, contentWidth), range => {
        const line = materializeRichInlineLineRange(block.flow, range)
        lines.push({
          fragments: line.fragments.map(fragment => ({
            gapItemIndex: fragment.gapItemIndex,
            href: block.hrefs[fragment.itemIndex] ?? null,
            itemIndex: fragment.itemIndex,
            style: block.styles[fragment.itemIndex]!,
            text: fragment.text,
          })),
        })
      })

      return {
        contentLeft: frame.contentLeft,
        direction: block.direction,
        height: frame.height,
        hrefs: block.hrefs,
        kind: 'inline',
        lineHeight: frame.lineHeight,
        lines,
        markerClassName: frame.markerClassName,
        markerLeft: frame.markerLeft,
        markerText: frame.markerText,
        paragraphStyle: block.paragraphStyle,
        styles: block.styles,
        top: frame.top,
        // Rows span the final bubble, so they stay inside a shrinkwrapped one.
        width: Math.max(1, bubbleContentWidth - frame.contentLeft),
      }
    }

    case 'code': {
      if (block.kind !== 'code') throw new Error('Code block/frame mismatch')
      const { lines } = layoutWithLines(block.prepared, getBlockLineWidth(block, contentWidth), frame.lineHeight)
      return {
        contentLeft: frame.contentLeft,
        // A message with no paragraph at all is left-to-right.
        direction: block.direction ?? 'ltr',
        height: frame.height,
        kind: 'code',
        lines,
        markerClassName: frame.markerClassName,
        markerLeft: frame.markerLeft,
        markerText: frame.markerText,
        top: frame.top,
        width: frame.width,
      }
    }

    case 'rule': {
      if (block.kind !== 'rule') throw new Error('Rule block/frame mismatch')
      return {
        contentLeft: frame.contentLeft,
        direction: block.direction ?? 'ltr',
        height: frame.height,
        kind: 'rule',
        markerClassName: frame.markerClassName,
        markerLeft: frame.markerLeft,
        markerText: frame.markerText,
        top: frame.top,
        width: Math.max(1, bubbleContentWidth - frame.contentLeft),
      }
    }
  }
}
