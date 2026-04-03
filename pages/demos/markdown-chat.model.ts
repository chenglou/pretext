import { marked, type Token, type Tokens } from 'marked'

import {
  layoutWithLines,
  measureNaturalWidth,
  prepareWithSegments,
  type LayoutLine,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'
import {
  measureInlineFlow,
  prepareInlineFlow,
  walkInlineFlowLines,
  type PreparedInlineFlow,
} from '../../src/inline-flow.ts'
import { BASE_MESSAGE_SPECS, type MarkdownChatSeed } from './markdown-chat.data.ts'

export const MIN_CHAT_WIDTH = 360
export const DEFAULT_CHAT_WIDTH = 640
export const MAX_CHAT_WIDTH = 860
export const TOTAL_MESSAGE_COUNT = 10_000
export const CHAT_VIEWPORT_HEIGHT = 560
export const OCCLUSION_BANNER_HEIGHT = 92
export const PAGE_MARGIN = 28
export const MESSAGE_SIDE_PADDING = 22

const CHAT_TOP_PADDING = OCCLUSION_BANNER_HEIGHT + 14
const CHAT_BOTTOM_PADDING = OCCLUSION_BANNER_HEIGHT + 10
const MESSAGE_GAP = 12
const BUBBLE_MAX_RATIO = 0.78
export const BUBBLE_PADDING_X = 16
const BUBBLE_PADDING_Y = 10
const BODY_LINE_HEIGHT = 24
const HEADING_ONE_LINE_HEIGHT = 30
const HEADING_TWO_LINE_HEIGHT = 28
const HARD_BREAK_GAP = 4
const BLOCK_GAP = 12
const RICH_BLOCK_GAP = 2
const LIST_ITEM_GAP = 4
const LIST_NESTING_INDENT = 18
const BLOCKQUOTE_INDENT = 18
const LIST_MARKER_GAP = 10
export const CODE_LINE_HEIGHT = 20
export const CODE_BLOCK_PADDING_X = 12
export const CODE_BLOCK_PADDING_Y = 8
const RULE_HEIGHT = 18
const RAIL_OFFSET = 5
const SANS_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const SERIF_FAMILY = '"Iowan Old Style", Georgia, "Times New Roman", serif'
const MONO_FAMILY = '"SF Mono", ui-monospace, Menlo, Monaco, monospace'
const INLINE_CODE_FONT = `600 13px ${MONO_FAMILY}`
const INLINE_CODE_EXTRA_WIDTH = 14
const IMAGE_FONT = `700 12px ${SANS_FAMILY}`
const IMAGE_EXTRA_WIDTH = 18
const MARKER_FONT = `600 12px ${MONO_FAMILY}`

type InlineVariant = 'body' | 'heading-1' | 'heading-2'

type MarkState = {
  bold: boolean
  italic: boolean
  strike: boolean
  href: string | null
}

type ParseContext = {
  listDepth: number
  quoteDepth: number
}

type InlinePiece = {
  breakMode: 'normal' | 'never'
  className: string
  extraWidth: number
  font: string
  href: string | null
  text: string
}

type PreparedBlockBase = {
  contentLeft: number
  marginTop: number
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  quoteRailLefts: number[]
}

type PreparedInlineBlock = PreparedBlockBase & {
  kind: 'inline'
  classNames: string[]
  flow: PreparedInlineFlow
  hrefs: Array<string | null>
  lineHeight: number
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

export type PreparedChatTemplate = {
  blocks: PreparedBlock[]
  role: 'assistant' | 'user'
}

export type ChatMessageInstance = {
  key: string
  role: 'assistant' | 'user'
  templateIndex: number
}

export type InlineFragmentLayout = {
  className: string
  href: string | null
  leadingGap: number
  text: string
}

type InlineBlockLayout = {
  contentLeft: number
  height: number
  kind: 'inline'
  lineHeight: number
  lines: Array<{
    fragments: InlineFragmentLayout[]
    width: number
  }>
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  quoteRailLefts: number[]
  top: number
  usedWidth: number
}

type CodeBlockLayout = {
  contentLeft: number
  height: number
  kind: 'code'
  lines: LayoutLine[]
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  quoteRailLefts: number[]
  top: number
  usedWidth: number
  width: number
}

type RuleBlockLayout = {
  contentLeft: number
  height: number
  kind: 'rule'
  markerClassName: string | null
  markerLeft: number | null
  markerText: string | null
  quoteRailLefts: number[]
  top: number
  width: number
}

export type BlockLayout = InlineBlockLayout | CodeBlockLayout | RuleBlockLayout

export type TemplateLayout = {
  blocks: BlockLayout[]
  bubbleHeight: number
  contentInsetX: number
  frameWidth: number
  role: 'assistant' | 'user'
  totalHeight: number
}

export type ConversationFrame = {
  chatWidth: number
  messageBottoms: number[]
  messageTops: number[]
  messages: ChatMessageInstance[]
  templateLayouts: TemplateLayout[]
  totalHeight: number
}

const EMPTY_MARK_STATE: MarkState = {
  bold: false,
  italic: false,
  strike: false,
  href: null,
}

const markerWidthCache = new Map<string, number>()

export function createPreparedChatTemplates(
  specs: readonly MarkdownChatSeed[] = BASE_MESSAGE_SPECS,
): PreparedChatTemplate[] {
  return specs.map(spec => ({
    blocks: parseMarkdownBlocks(spec.markdown),
    role: spec.role,
  }))
}

export function getMaxChatWidth(viewportWidth: number): number {
  return Math.max(240, Math.min(MAX_CHAT_WIDTH, viewportWidth - PAGE_MARGIN * 2))
}

export function buildConversationFrame(
  templates: readonly PreparedChatTemplate[],
  chatWidth: number,
): ConversationFrame {
  const messageCount = TOTAL_MESSAGE_COUNT
  const userFrameWidth = Math.max(240, Math.floor(chatWidth * BUBBLE_MAX_RATIO))
  const assistantFrameWidth = Math.max(120, chatWidth - MESSAGE_SIDE_PADDING * 2)
  const templateLayouts = templates.map(template => {
    const contentInsetX = template.role === 'assistant' ? 0 : BUBBLE_PADDING_X
    const frameWidth = template.role === 'assistant' ? assistantFrameWidth : userFrameWidth
    const contentWidth = Math.max(120, frameWidth - contentInsetX * 2)
    return layoutTemplate(template, frameWidth, contentWidth, contentInsetX)
  })
  const messages: ChatMessageInstance[] = new Array(messageCount)
  const messageTops: number[] = new Array(messageCount)
  const messageBottoms: number[] = new Array(messageCount)

  let y = CHAT_TOP_PADDING
  for (let ordinal = 0; ordinal < messageCount; ordinal++) {
    const templateIndex = ordinal % templates.length
    const layout = templateLayouts[templateIndex]!

    messages[ordinal] = {
      key: String(ordinal),
      role: templates[templateIndex]!.role,
      templateIndex,
    }
    messageTops[ordinal] = y
    y += layout.totalHeight
    messageBottoms[ordinal] = y
    y += MESSAGE_GAP
  }

  const totalHeight =
    messages.length === 0
      ? CHAT_TOP_PADDING + CHAT_BOTTOM_PADDING
      : y - MESSAGE_GAP + CHAT_BOTTOM_PADDING

  return {
    chatWidth,
    messageBottoms,
    messageTops,
    messages,
    templateLayouts,
    totalHeight,
  }
}

export function findVisibleRange(
  frame: ConversationFrame,
  scrollTop: number,
  viewportHeight: number,
  topOcclusionHeight: number,
  bottomOcclusionHeight: number,
): {
  end: number
  start: number
} {
  if (frame.messages.length === 0) return { start: 0, end: 0 }

  const minY = Math.max(0, scrollTop + topOcclusionHeight)
  const maxY = Math.max(minY, scrollTop + viewportHeight - bottomOcclusionHeight)
  let low = 0
  let high = frame.messageBottoms.length

  while (low < high) {
    const mid = (low + high) >> 1
    if (frame.messageBottoms[mid]! > minY) {
      high = mid
    } else {
      low = mid + 1
    }
  }
  const start = low

  low = start
  high = frame.messageTops.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (frame.messageTops[mid]! >= maxY) {
      high = mid
    } else {
      low = mid + 1
    }
  }

  return { start, end: low }
}

export function formatPixelCount(value: number): string {
  return `${Math.round(value).toLocaleString()}px`
}

function parseMarkdownBlocks(markdown: string): PreparedBlock[] {
  const tokens = marked.lexer(markdown, { gfm: true })
  return parseBlockTokens(tokens, { listDepth: 0, quoteDepth: 0 })
}

function parseBlockTokens(tokens: readonly Token[], ctx: ParseContext): PreparedBlock[] {
  const blocks: PreparedBlock[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!

    switch (token.type) {
      case 'space':
      case 'def': {
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
        appendBlockGroup(blocks, buildListBlocks(token as Tokens.List, ctx), BLOCK_GAP)
        continue
      }

      case 'blockquote': {
        appendBlockGroup(
          blocks,
          parseBlockTokens(token.tokens ?? [], {
            listDepth: ctx.listDepth,
            quoteDepth: ctx.quoteDepth + 1,
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

  return blocks
}

function buildListBlocks(token: Tokens.List, ctx: ParseContext): PreparedBlock[] {
  const blocks: PreparedBlock[] = []
  const itemCtx: ParseContext = {
    listDepth: ctx.listDepth + 1,
    quoteDepth: ctx.quoteDepth,
  }

  for (let index = 0; index < token.items.length; index++) {
    const item = token.items[index]!
    let itemBlocks = parseBlockTokens(item.tokens, itemCtx)
    if (itemBlocks.length === 0) {
      itemBlocks = buildPlainTextBlocks(item.text, 'body', itemCtx)
    }

    decorateListItemBlocks(itemBlocks, resolveListMarkerText(token, item, index), resolveListMarkerClassName(token, item))
    appendBlockGroup(blocks, itemBlocks, LIST_ITEM_GAP)
  }

  return blocks
}

function decorateListItemBlocks(
  blocks: PreparedBlock[],
  markerText: string,
  markerClassName: string,
): void {
  if (blocks.length === 0) return

  const markerArea = measureMarkerWidth(markerText) + LIST_MARKER_GAP
  for (let index = 0; index < blocks.length; index++) {
    blocks[index] = shiftBlock(blocks[index]!, markerArea)
  }

  const firstBlock = blocks[0]!
  blocks[0] = {
    ...firstBlock,
    markerClassName,
    markerLeft: firstBlock.contentLeft - markerArea,
    markerText,
  } satisfies PreparedBlock
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

  for (let index = 0; index < lines.length; index++) {
    const block = buildPreparedInlineBlock(lines[index]!, variant, ctx)
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
  ctx: ParseContext,
): PreparedInlineBlock | null {
  if (pieces.length === 0) return null

  return {
    ...createBlockBase(ctx),
    classNames: pieces.map(piece => piece.className),
    flow: prepareInlineFlow(pieces.map(piece => ({
      text: piece.text,
      font: piece.font,
      break: piece.breakMode,
      extraWidth: piece.extraWidth,
    }))),
    hrefs: pieces.map(piece => piece.href),
    kind: 'inline',
    lineHeight: lineHeightForVariant(variant),
  }
}

function buildCodeBlock(text: string, ctx: ParseContext): PreparedCodeBlock {
  return {
    ...createBlockBase(ctx),
    kind: 'code',
    lineHeight: CODE_LINE_HEIGHT,
    prepared: prepareWithSegments(stripSingleTrailingNewline(text), `500 13px ${MONO_FAMILY}`, {
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
  const listIndent = Math.max(0, ctx.listDepth - 1) * LIST_NESTING_INDENT
  const contentLeft = listIndent + ctx.quoteDepth * BLOCKQUOTE_INDENT
  const quoteRailLefts: number[] = []

  for (let depth = 0; depth < ctx.quoteDepth; depth++) {
    quoteRailLefts.push(listIndent + depth * BLOCKQUOTE_INDENT + RAIL_OFFSET)
  }

  return {
    contentLeft,
    marginTop: 0,
    markerClassName: null,
    markerLeft: null,
    markerText: null,
    quoteRailLefts,
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
          walk(token.tokens ?? [], { ...marks, href: token.href })
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
          pushPiece(createTextPiece(token.checked ? '[x] ' : '[ ] ', marks, variant))
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
    className: resolveTextClassName(variant, marks),
    extraWidth: 0,
    font: resolveTextFont(variant, marks),
    href: marks.href,
    text,
  }
}

function createCodePiece(text: string): InlinePiece | null {
  if (text.length === 0) return null

  return {
    breakMode: 'normal',
    className: 'frag frag--code',
    extraWidth: INLINE_CODE_EXTRA_WIDTH,
    font: INLINE_CODE_FONT,
    href: null,
    text,
  }
}

function createImagePiece(text: string): InlinePiece {
  return {
    breakMode: 'never',
    className: 'frag frag--chip',
    extraWidth: IMAGE_EXTRA_WIDTH,
    font: IMAGE_FONT,
    href: null,
    text: text.length > 0 ? text : 'image',
  }
}

function canMergeInlinePieces(a: InlinePiece, b: InlinePiece): boolean {
  return (
    a.breakMode === b.breakMode &&
    a.className === b.className &&
    a.extraWidth === b.extraWidth &&
    a.font === b.font &&
    a.href === b.href
  )
}

function resolveTextFont(variant: InlineVariant, marks: MarkState): string {
  const italicPrefix = marks.italic ? 'italic ' : ''

  switch (variant) {
    case 'heading-1': {
      const weight = marks.bold ? 800 : 700
      return `${italicPrefix}${weight} 22px ${SERIF_FAMILY}`
    }

    case 'heading-2': {
      const weight = marks.bold ? 800 : 700
      return `${italicPrefix}${weight} 18px ${SERIF_FAMILY}`
    }

    case 'body': {
      const weight = marks.bold ? 700 : marks.href === null ? 400 : 500
      return `${italicPrefix}${weight} 15px ${SANS_FAMILY}`
    }
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

function shiftBlock(block: PreparedBlock, delta: number): PreparedBlock {
  return {
    ...block,
    contentLeft: block.contentLeft + delta,
  } satisfies PreparedBlock
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

function layoutTemplate(
  template: PreparedChatTemplate,
  maxFrameWidth: number,
  maxContentWidth: number,
  contentInsetX: number,
): TemplateLayout {
  let y = BUBBLE_PADDING_Y
  const blocks: BlockLayout[] = []
  let usedContentWidth = 0

  for (let index = 0; index < template.blocks.length; index++) {
    const block = template.blocks[index]!
    y += block.marginTop
    const layout = layoutBlock(block, maxContentWidth, y)
    blocks.push(layout)
    y += layout.height
    usedContentWidth = Math.max(usedContentWidth, getUsedBlockWidth(layout))
  }

  const bubbleHeight = y + BUBBLE_PADDING_Y
  const frameWidth = template.role === 'assistant'
    ? maxFrameWidth
    : Math.min(maxFrameWidth, contentInsetX * 2 + Math.max(1, usedContentWidth))
  return {
    blocks,
    bubbleHeight,
    contentInsetX,
    frameWidth,
    role: template.role,
    totalHeight: bubbleHeight,
  }
}

function layoutBlock(
  block: PreparedBlock,
  contentWidth: number,
  top: number,
): BlockLayout {
  switch (block.kind) {
    case 'inline': {
      const lineWidth = Math.max(1, contentWidth - block.contentLeft)
      const lines: Array<{ fragments: InlineFragmentLayout[]; width: number }> = []
      let usedWidth = 0
      walkInlineFlowLines(block.flow, lineWidth, line => {
        usedWidth = Math.max(usedWidth, line.width)
        lines.push({
          fragments: line.fragments.map(fragment => ({
            className: block.classNames[fragment.itemIndex]!,
            href: block.hrefs[fragment.itemIndex] ?? null,
            leadingGap: fragment.gapBefore,
            text: fragment.text,
          })),
          width: line.width,
        })
      })
      const { height } = measureInlineFlow(block.flow, lineWidth, block.lineHeight)
      return {
        contentLeft: block.contentLeft,
        height,
        kind: 'inline',
        lineHeight: block.lineHeight,
        lines,
        markerClassName: block.markerClassName,
        markerLeft: block.markerLeft,
        markerText: block.markerText,
        quoteRailLefts: block.quoteRailLefts,
        top,
        usedWidth,
      }
    }

    case 'code': {
      const boxWidth = Math.max(1, contentWidth - block.contentLeft)
      const innerWidth = Math.max(1, boxWidth - CODE_BLOCK_PADDING_X * 2)
      const layout = layoutWithLines(block.prepared, innerWidth, block.lineHeight)
      const widestLine = layout.lines.reduce((max, line) => Math.max(max, line.width), 0)
      return {
        contentLeft: block.contentLeft,
        height: layout.height + CODE_BLOCK_PADDING_Y * 2,
        kind: 'code',
        lines: layout.lines,
        markerClassName: block.markerClassName,
        markerLeft: block.markerLeft,
        markerText: block.markerText,
        quoteRailLefts: block.quoteRailLefts,
        top,
        usedWidth: widestLine + CODE_BLOCK_PADDING_X * 2,
        width: widestLine + CODE_BLOCK_PADDING_X * 2,
      }
    }

    case 'rule': {
      return {
        contentLeft: block.contentLeft,
        height: block.height,
        kind: 'rule',
        markerClassName: block.markerClassName,
        markerLeft: block.markerLeft,
        markerText: block.markerText,
        quoteRailLefts: block.quoteRailLefts,
        top,
        width: Math.max(1, contentWidth - block.contentLeft),
      }
    }
  }
}

function getUsedBlockWidth(block: BlockLayout): number {
  switch (block.kind) {
    case 'inline':
      return block.contentLeft + block.usedWidth
    case 'code':
      return block.contentLeft + block.usedWidth
    case 'rule':
      return block.contentLeft + block.width
  }
}
