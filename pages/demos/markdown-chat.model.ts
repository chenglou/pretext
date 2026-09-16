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
import { createMarkdownChatSpecs, type MarkdownChatSeed } from './markdown-chat.data.ts'

export const MAX_CHAT_WIDTH = 860
export const TOTAL_MESSAGE_COUNT = 10_000
// History loads and unloads in chunks of this many messages. Preparing chunks is
// most of a frame's work, and it grows with the messages prepared. In Chrome on
// an M5 Max, a first visit that loads a chunk and mounts every row on screen
// takes 2.8 ms at the median and 4.7 ms at the 99th percentile with 24 messages,
// against 4.1 and 8.0 ms with 50. At the widest chat, 24 messages are at least
// about 1,900 px tall.
const HISTORY_CHUNK_SIZE = 24
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
// a banner change needs no new pass. Only visible messages get a MessageLayout.
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

// A message's top where the first message's top sits with the chat scrolled to
// its top: 14 px below the top banner's edge. A jump puts its message there.
export function getMessageTopAnchor(ordinal: number): ScrollAnchor {
  return { offset: CHAT_TOP_PADDING_OFFSET, ordinal }
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

export function createChatHistory(): MarkdownChatSeed[] {
  return createMarkdownChatSpecs(TOTAL_MESSAGE_COUNT)
}

// A window holding the chunks with the first and last messages kept, one more
// chunk on either side, and the loaded chunks touching those. Missing chunks are
// prepared, so a jump far from the loaded chunks prepares the ones around its
// message and none between. A window whose chunks or chat width change is a new
// object, laid out again. Before the first frame there's no window.
export function loadHistoryChunks(
  history: readonly MarkdownChatSeed[],
  historyWindow: HistoryWindow | null,
  firstKeptOrdinal: number,
  lastKeptOrdinal: number,
  chatWidth: number,
): HistoryWindow {
  const firstWantedChunk = Math.max(0, Math.floor(firstKeptOrdinal / HISTORY_CHUNK_SIZE) - 1)
  const lastWantedChunk = Math.min(
    Math.ceil(history.length / HISTORY_CHUNK_SIZE) - 1,
    Math.floor(lastKeptOrdinal / HISTORY_CHUNK_SIZE) + 1,
  )
  const loadedMessages = historyWindow === null ? [] : historyWindow.messages
  const firstLoadedChunk = historyWindow === null ? 0 : historyWindow.firstOrdinal / HISTORY_CHUNK_SIZE
  const lastLoadedChunk = firstLoadedChunk + Math.ceil(loadedMessages.length / HISTORY_CHUNK_SIZE) - 1
  let firstChunk = firstWantedChunk
  let lastChunk = lastWantedChunk
  if (firstLoadedChunk <= lastWantedChunk + 1 && lastLoadedChunk >= firstWantedChunk - 1) {
    firstChunk = Math.min(firstChunk, firstLoadedChunk)
    lastChunk = Math.max(lastChunk, lastLoadedChunk)
  }
  if (
    historyWindow !== null &&
    historyWindow.layout.chatWidth === chatWidth &&
    firstChunk === firstLoadedChunk &&
    lastChunk === lastLoadedChunk
  ) {
    return historyWindow
  }

  const messages: PreparedChatMessage[] = []
  for (let chunk = firstChunk; chunk <= lastChunk; chunk++) {
    const start = chunk * HISTORY_CHUNK_SIZE
    const end = Math.min(history.length, start + HISTORY_CHUNK_SIZE)
    if (chunk >= firstLoadedChunk && chunk <= lastLoadedChunk) {
      const loadedStart = start - firstLoadedChunk * HISTORY_CHUNK_SIZE
      for (let index = loadedStart; index < loadedStart + end - start; index++) {
        messages.push(loadedMessages[index]!)
      }
    } else {
      for (let ordinal = start; ordinal < end; ordinal++) {
        const spec = history[ordinal]!
        messages.push({ blocks: parseMarkdownBlocks(spec.markdown), role: spec.role })
      }
    }
  }
  return { firstOrdinal: firstChunk * HISTORY_CHUNK_SIZE, layout: layoutConversation(messages, chatWidth), messages }
}

// While the window holds more than HISTORY_WINDOW_CHUNKS, drops its first or last
// chunk, whichever is farther from the kept messages, unless that chunk holds
// kept messages or is next to one that does. A window that drops a chunk is a new
// object, laid out again.
export function dropHistoryChunks(
  historyWindow: HistoryWindow,
  firstKeptOrdinal: number,
  lastKeptOrdinal: number,
): HistoryWindow {
  const firstKeptChunk = Math.floor(firstKeptOrdinal / HISTORY_CHUNK_SIZE)
  const lastKeptChunk = Math.floor(lastKeptOrdinal / HISTORY_CHUNK_SIZE)
  const firstLoadedChunk = historyWindow.firstOrdinal / HISTORY_CHUNK_SIZE
  const lastLoadedChunk = firstLoadedChunk + Math.ceil(historyWindow.messages.length / HISTORY_CHUNK_SIZE) - 1
  let firstChunk = firstLoadedChunk
  let lastChunk = lastLoadedChunk
  while (
    lastChunk - firstChunk + 1 > HISTORY_WINDOW_CHUNKS &&
    (firstChunk < firstKeptChunk - 1 || lastChunk > lastKeptChunk + 1)
  ) {
    if (firstKeptChunk - firstChunk > lastChunk - lastKeptChunk) {
      firstChunk++
    } else {
      lastChunk--
    }
  }
  if (firstChunk === firstLoadedChunk && lastChunk === lastLoadedChunk) return historyWindow

  const messages = historyWindow.messages.slice(
    (firstChunk - firstLoadedChunk) * HISTORY_CHUNK_SIZE,
    (lastChunk - firstLoadedChunk + 1) * HISTORY_CHUNK_SIZE,
  )
  return {
    firstOrdinal: firstChunk * HISTORY_CHUNK_SIZE,
    layout: layoutConversation(messages, historyWindow.layout.chatWidth),
    messages,
  }
}

// Where a frame with historyWindow laid out leaves the scroll position: where it
// read it, even past an end while it bounces, unless this layout moved the anchor
// from where the last frame put it in anchoredWindow. Then the anchored message's
// top goes back to its distance below the top banner, or the end anchor to the
// canvas's end. Loading or dropping a chunk above moves it; a new width can too.
// With no anchoredWindow, before the first frame or after a jump, the anchor has
// no place yet, so it goes there. The browser keeps a scroll inside the canvas.
export function findFrameScrollTop(
  historyWindow: HistoryWindow,
  anchoredWindow: HistoryWindow | null,
  scrollAnchor: ScrollAnchor | 'end',
  scrollTop: number,
  previousEndScrollTop: number, // the end's scroll position in the last frame
  viewportHeight: number,
  occlusionBannerHeight: number,
): number {
  const { firstOrdinal, layout } = historyWindow
  if (scrollAnchor === 'end') {
    const endScrollTop = layout.totalHeight + occlusionBannerHeight * 2 - viewportHeight
    return anchoredWindow === null || endScrollTop !== previousEndScrollTop ? endScrollTop : scrollTop
  }
  const top = layout.tops[scrollAnchor.ordinal - firstOrdinal]!
  if (anchoredWindow !== null && top === anchoredWindow.layout.tops[scrollAnchor.ordinal - anchoredWindow.firstOrdinal]) {
    return scrollTop
  }
  return top - scrollAnchor.offset
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

// The messages showing between the banners, by ordinal, with the window
// scrolled to scrollTop kept between 0 and the canvas's end. The browser keeps a
// scroll there, and a bounce past an end shows no message the end doesn't. A
// message's top in the canvas is the top banner's height plus its entry in tops,
// so the room below the top banner starts at that position in tops.
export function findVisibleRange(
  historyWindow: HistoryWindow,
  scrollTop: number,
  viewportHeight: number,
  occlusionBannerHeight: number,
): {
  end: number
  start: number
} {
  const { heights, tops, totalHeight } = historyWindow.layout
  const shownTop = Math.max(0, Math.min(totalHeight + occlusionBannerHeight * 2 - viewportHeight, scrollTop))
  const maxY = Math.max(shownTop, shownTop + viewportHeight - occlusionBannerHeight * 2)
  let low = 0
  let high = tops.length

  while (low < high) {
    const mid = (low + high) >> 1
    if (tops[mid]! + heights[mid]! > shownTop) {
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

  return { start: historyWindow.firstOrdinal + start, end: historyWindow.firstOrdinal + low }
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
