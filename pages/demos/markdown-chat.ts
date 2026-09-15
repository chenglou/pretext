import {
  CODE_BLOCK_PADDING_X,
  CODE_BLOCK_PADDING_Y,
  CODE_FONT,
  CODE_LINE_HEIGHT,
  createChatHistory,
  createHistoryWindow,
  findShownMessages,
  findVisibleRange,
  getMaxChatWidth,
  getOcclusionBannerHeight,
  layoutConversation,
  layoutMessageFrame,
  MARKER_FONT,
  materializeMessageBlocks,
  materializeQuoteRails,
  MESSAGE_SIDE_PADDING,
  moveHistoryWindow,
  OCCLUSION_BANNER_HEIGHT,
  TOP_SCROLL_ANCHOR,
  type BlockLayout,
  type ConversationLayout,
  type HistoryWindow,
  type InlineFragmentLayout,
  type MessageFrame,
  type PreparedChatMessage,
  type QuoteRailLayout,
  type ScrollAnchor,
  type TextStyle,
} from './markdown-chat.model.ts'

type State = {
  conversation: ConversationLayout | null // historyWindow's layout, as the screen shows it
  events: {
    toggleVisualization: boolean
  }
  historyWindow: HistoryWindow
  isVisualizationOn: boolean
  scrollAnchor: ScrollAnchor
  scrollTop: number // where the last frame left the scroll position, as read back
}

type CachedRow = {
  bubble: HTMLDivElement
  row: HTMLElement
}

const domCache = {
  root: document.documentElement,
  shell: getRequiredElement('chat-shell'),
  viewport: getRequiredDiv('chat-viewport'),
  canvas: getRequiredDiv('chat-canvas'),
  toggleButton: getRequiredButton('virtualization-toggle'),
  rows: [] as Array<CachedRow | undefined>, // by message ordinal; cache lifetime: on visibility changes
  mountedStart: 0, // an ordinal; cache lifetime: on visibility changes
  mountedEnd: 0, // an ordinal; cache lifetime: on visibility changes
}

const history = createChatHistory()
const st: State = {
  conversation: null,
  events: {
    toggleVisualization: false,
  },
  historyWindow: createHistoryWindow(TOP_SCROLL_ANCHOR.ordinal),
  isVisualizationOn: false,
  scrollAnchor: TOP_SCROLL_ANCHOR,
  scrollTop: 0,
}

let scheduledRaf: number | null = null

domCache.root.style.setProperty('--message-side-padding', `${MESSAGE_SIDE_PADDING}px`)
domCache.root.style.setProperty('--marker-font', MARKER_FONT)
domCache.root.style.setProperty('--code-font', CODE_FONT)

domCache.toggleButton.addEventListener('click', () => {
  st.events.toggleVisualization = true
  scheduleRender()
})

domCache.viewport.addEventListener('scroll', scheduleRender, { passive: true })
window.addEventListener('resize', scheduleRender)

await document.fonts.ready
scheduleRender()

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`Missing div #${id}`)
  return element
}

function getRequiredElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`Missing element #${id}`)
  return element
}

function getRequiredButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button #${id}`)
  return element
}

function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderMarkdownChatFrame() {
    scheduledRaf = null
    render()
  })
}

function render(): void {
  const viewportWidth = domCache.viewport.clientWidth
  const viewportHeight = domCache.viewport.clientHeight
  const scrollTop = domCache.viewport.scrollTop
  const occlusionBannerHeight = getOcclusionBannerHeight(viewportHeight)
  const isCompactOcclusionChrome = occlusionBannerHeight < OCCLUSION_BANNER_HEIGHT

  let isVisualizationOn = st.isVisualizationOn
  if (st.events.toggleVisualization) isVisualizationOn = !isVisualizationOn

  const chatWidth = getMaxChatWidth(viewportWidth)
  const previousWindow = st.historyWindow
  const previousConversation = st.conversation

  // The screen shows the last frame's layout, scrolled to scrollTop. Before the
  // first layout it shows nothing, and the window loads around the anchor.
  const shown = previousConversation === null
    ? { anchor: st.scrollAnchor, lastOrdinal: st.scrollAnchor.ordinal }
    : findShownMessages(previousWindow, previousConversation, scrollTop, viewportHeight, occlusionBannerHeight)
  // st.scrollTop is where the last frame left the scroll position, so any other
  // value is the user's scroll: anchor the first message showing below the top
  // banner, in the layout they scrolled. Otherwise keep the anchor. Either way,
  // scroll so its top keeps its distance below the banner, within the range, so
  // loading or unloading a chunk above doesn't move what's shown.
  const scrollAnchor = scrollTop === st.scrollTop ? st.scrollAnchor : shown.anchor
  const historyWindow = moveHistoryWindow(history, previousWindow, shown.anchor.ordinal, shown.lastOrdinal)
  const canReuseConversation =
    previousConversation !== null &&
    previousConversation.chatWidth === chatWidth &&
    historyWindow === previousWindow
  const conversation = canReuseConversation
    ? previousConversation
    : layoutConversation(historyWindow.messages, chatWidth)
  // A mounted row keeps its contents when only the window changes.
  const needsRelayout = previousConversation === null || previousConversation.chatWidth !== chatWidth

  const canvasHeight = conversation.totalHeight + occlusionBannerHeight * 2
  const adjustedScrollTop = Math.min(
    Math.max(0, canvasHeight - viewportHeight),
    Math.max(0, conversation.tops[scrollAnchor.ordinal - historyWindow.firstOrdinal]! - scrollAnchor.offset),
  )

  const { start, end } = findVisibleRange(conversation, adjustedScrollTop, viewportHeight, occlusionBannerHeight)
  const visibleFrames = new Array<MessageFrame>(end - start)
  for (let index = start; index < end; index++) {
    visibleFrames[index - start] = layoutMessageFrame(historyWindow.messages[index]!, chatWidth)
  }

  st.conversation = conversation
  st.historyWindow = historyWindow
  st.isVisualizationOn = isVisualizationOn
  st.scrollAnchor = scrollAnchor
  st.events.toggleVisualization = false

  domCache.root.style.setProperty('--chat-width', `${chatWidth}px`)
  domCache.root.style.setProperty('--occlusion-banner-height', `${occlusionBannerHeight}px`)
  domCache.root.style.setProperty('--occlusion-banner-padding-block', isCompactOcclusionChrome ? '6px' : '12px')
  domCache.root.style.setProperty('--virtualization-toggle-padding-block', isCompactOcclusionChrome ? '8px' : '10px')
  domCache.root.style.setProperty('--virtualization-toggle-padding-inline', isCompactOcclusionChrome ? '12px' : '14px')
  domCache.root.style.setProperty('--virtualization-toggle-font-size', isCompactOcclusionChrome ? '11px' : '12px')
  domCache.shell.dataset['visualization'] = isVisualizationOn ? 'on' : 'off'
  // The canvas takes its height before the scroll below, which the browser
  // would otherwise clamp to the old height.
  domCache.canvas.style.height = `${canvasHeight}px`
  domCache.toggleButton.textContent = isVisualizationOn
    ? 'Hide virtualization mask'
    : 'Show virtualization mask'
  domCache.toggleButton.setAttribute('aria-pressed', String(isVisualizationOn))

  projectVisibleRows(historyWindow, conversation, occlusionBannerHeight, visibleFrames, start, end, needsRelayout)

  // The last effect. Browsers round scrollTop, so store the position read back,
  // not the one asked for, or the next frame would take it for a user scroll.
  // The read forces layout, so nothing touches the DOM after it.
  if (adjustedScrollTop === scrollTop) {
    st.scrollTop = scrollTop
  } else {
    domCache.viewport.scrollTo({ top: adjustedScrollTop, behavior: 'instant' })
    st.scrollTop = domCache.viewport.scrollTop
  }
}

// start and end index the window's messages. Rows are cached by ordinal, so a
// row stays mounted while chunks load and unload around it.
function projectVisibleRows(
  historyWindow: HistoryWindow,
  conversation: ConversationLayout,
  occlusionBannerHeight: number,
  visibleFrames: readonly MessageFrame[],
  start: number,
  end: number,
  needsRelayout: boolean,
): void {
  const startOrdinal = historyWindow.firstOrdinal + start
  const endOrdinal = historyWindow.firstOrdinal + end
  const previousStart = domCache.mountedStart
  const previousEnd = domCache.mountedEnd
  const overlapStart = Math.max(startOrdinal, previousStart)
  const overlapEnd = Math.min(endOrdinal, previousEnd)

  for (let ordinal = previousStart; ordinal < Math.min(previousEnd, startOrdinal); ordinal++) {
    const node = domCache.rows[ordinal]
    if (node === undefined) continue
    node.row.remove()
    domCache.rows[ordinal] = undefined
  }

  for (let ordinal = Math.max(previousStart, endOrdinal); ordinal < previousEnd; ordinal++) {
    const node = domCache.rows[ordinal]
    if (node === undefined) continue
    node.row.remove()
    domCache.rows[ordinal] = undefined
  }

  if (overlapStart >= overlapEnd) {
    for (let ordinal = startOrdinal; ordinal < endOrdinal; ordinal++) {
      const frame = visibleFrames[ordinal - startOrdinal]!
      const cachedRow = projectRow(historyWindow, conversation, occlusionBannerHeight, frame, ordinal, needsRelayout)
      if (cachedRow.row.parentNode === null) domCache.canvas.append(cachedRow.row)
    }
  } else {
    let anchorRow = domCache.rows[overlapStart]?.row ?? null
    for (let ordinal = overlapStart - 1; ordinal >= startOrdinal; ordinal--) {
      const frame = visibleFrames[ordinal - startOrdinal]!
      const cachedRow = projectRow(historyWindow, conversation, occlusionBannerHeight, frame, ordinal, needsRelayout)
      if (anchorRow === null) {
        if (cachedRow.row.parentNode === null) domCache.canvas.append(cachedRow.row)
      } else if (cachedRow.row.parentNode !== domCache.canvas || cachedRow.row.nextSibling !== anchorRow) {
        domCache.canvas.insertBefore(cachedRow.row, anchorRow)
      }
      anchorRow = cachedRow.row
    }

    for (let ordinal = overlapStart; ordinal < overlapEnd; ordinal++) {
      const frame = visibleFrames[ordinal - startOrdinal]!
      projectRow(historyWindow, conversation, occlusionBannerHeight, frame, ordinal, needsRelayout)
    }

    for (let ordinal = overlapEnd; ordinal < endOrdinal; ordinal++) {
      const frame = visibleFrames[ordinal - startOrdinal]!
      const cachedRow = projectRow(historyWindow, conversation, occlusionBannerHeight, frame, ordinal, needsRelayout)
      if (cachedRow.row.parentNode === null) domCache.canvas.append(cachedRow.row)
    }
  }

  domCache.mountedStart = startOrdinal
  domCache.mountedEnd = endOrdinal
}

// Gives a new row its contents, and a mounted one new contents when the chat
// width changed, then places it.
function projectRow(
  historyWindow: HistoryWindow,
  conversation: ConversationLayout,
  occlusionBannerHeight: number,
  frame: MessageFrame,
  ordinal: number,
  needsRelayout: boolean,
): CachedRow {
  const index = ordinal - historyWindow.firstOrdinal
  const preparedMessage = historyWindow.messages[index]!
  let cachedRow = domCache.rows[ordinal]
  if (cachedRow === undefined) {
    cachedRow = createMessageShell(preparedMessage.role)
    domCache.rows[ordinal] = cachedRow
    renderMessageContents(cachedRow.bubble, preparedMessage, frame)
  } else if (needsRelayout) {
    renderMessageContents(cachedRow.bubble, preparedMessage, frame)
  }
  projectMessageNode(cachedRow, frame, occlusionBannerHeight + conversation.tops[index]!, conversation.heights[index]!)
  return cachedRow
}

function createMessageShell(role: PreparedChatMessage['role']): CachedRow {
  const row = document.createElement('article')
  row.className = `msg msg--${role}`

  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'

  row.append(bubble)
  return { bubble, row }
}

function renderMessageContents(
  bubble: HTMLDivElement,
  preparedMessage: PreparedChatMessage,
  frame: MessageFrame,
): void {
  const fragment = document.createDocumentFragment()
  const rails = materializeQuoteRails(preparedMessage, frame)
  for (let index = 0; index < rails.length; index++) {
    fragment.append(renderQuoteRail(rails[index]!, frame.contentInsetX))
  }
  const blocks = materializeMessageBlocks(preparedMessage, frame)
  for (let index = 0; index < blocks.length; index++) {
    fragment.append(renderBlock(blocks[index]!, frame.contentInsetX))
  }
  bubble.replaceChildren(fragment)
}

function projectMessageNode(
  cachedRow: CachedRow,
  frame: MessageFrame,
  top: number,
  height: number,
): void {
  cachedRow.row.style.top = `${top}px`
  cachedRow.row.style.height = `${height}px`
  cachedRow.bubble.style.width = `${frame.frameWidth}px`
  cachedRow.bubble.style.height = `${height}px`
}

function renderBlock(block: BlockLayout, contentInsetX: number): HTMLElement {
  // A right-to-left block starts its indent and marker from the right.
  const start = block.direction === 'rtl' ? 'right' : 'left'
  switch (block.kind) {
    case 'inline':
      return renderInlineBlock(block, contentInsetX, start)
    case 'code':
      return renderCodeBlock(block, contentInsetX, start)
    case 'rule':
      return renderRuleBlock(block, contentInsetX, start)
  }
}

function renderInlineBlock(
  block: Extract<BlockLayout, { kind: 'inline' }>,
  contentInsetX: number,
  start: 'left' | 'right',
): HTMLElement {
  const wrapper = createBlockShell(block, 'block block--inline', contentInsetX, start)

  for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
    const line = block.lines[lineIndex]!
    // Each Pretext line is one line box, so the browser orders its bidi runs.
    // The paragraph style sets the baseline and paints the collapsed spaces.
    const row = document.createElement('div')
    row.className = 'inline-line'
    row.dir = block.direction
    applyTextStyle(row, block.paragraphStyle)
    row.style.lineHeight = `${block.lineHeight}px`
    row.style[start] = `${contentInsetX + block.contentLeft}px`
    row.style.top = `${lineIndex * block.lineHeight}px`
    row.style.width = `${block.width}px`

    for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex++) {
      const fragment = line.fragments[fragmentIndex]!
      if (fragment.spaceBefore) row.append(' ')
      row.append(renderInlineFragment(fragment))
    }
    wrapper.append(row)
  }

  return wrapper
}

function renderCodeBlock(
  block: Extract<BlockLayout, { kind: 'code' }>,
  contentInsetX: number,
  start: 'left' | 'right',
): HTMLElement {
  const wrapper = createBlockShell(block, 'block block--code-shell', contentInsetX, start)

  const codeBox = document.createElement('div')
  codeBox.className = 'code-box'
  codeBox.style[start] = `${contentInsetX + block.contentLeft}px`
  codeBox.style.width = `${block.width}px`
  codeBox.style.height = `${block.height}px`

  for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
    const line = block.lines[lineIndex]!
    const row = document.createElement('div')
    row.className = 'code-line'
    // Code reads left to right inside its box, whichever side the box starts from.
    row.style.left = `${CODE_BLOCK_PADDING_X}px`
    row.style.top = `${CODE_BLOCK_PADDING_Y + lineIndex * CODE_LINE_HEIGHT}px`
    row.textContent = line.text
    codeBox.append(row)
  }

  wrapper.append(codeBox)
  return wrapper
}

function renderRuleBlock(
  block: Extract<BlockLayout, { kind: 'rule' }>,
  contentInsetX: number,
  start: 'left' | 'right',
): HTMLElement {
  const wrapper = createBlockShell(block, 'block block--rule-shell', contentInsetX, start)
  const rule = document.createElement('div')
  rule.className = 'rule-line'
  rule.style[start] = `${contentInsetX + block.contentLeft}px`
  rule.style.top = `${Math.floor(block.height / 2)}px`
  rule.style.width = `${block.width}px`
  wrapper.append(rule)
  return wrapper
}

function createBlockShell(
  block: BlockLayout,
  className: string,
  contentInsetX: number,
  start: 'left' | 'right',
): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = className
  wrapper.style.top = `${block.top}px`
  wrapper.style.height = `${block.height}px`

  appendMarker(wrapper, block, contentInsetX, start)
  return wrapper
}

// A rail starts from the side of the blocks it runs beside.
function renderQuoteRail(rail: QuoteRailLayout, contentInsetX: number): HTMLElement {
  const node = document.createElement('div')
  node.className = 'quote-rail'
  node.style[rail.direction === 'rtl' ? 'right' : 'left'] = `${contentInsetX + rail.left}px`
  node.style.top = `${rail.top}px`
  node.style.height = `${rail.height}px`
  return node
}

function appendMarker(
  wrapper: HTMLDivElement,
  block: BlockLayout,
  contentInsetX: number,
  start: 'left' | 'right',
): void {
  if (block.markerText === null || block.markerLeft === null || block.markerClassName === null) return

  const marker = document.createElement('span')
  marker.className = block.markerClassName
  marker.dir = block.direction
  marker.style[start] = `${contentInsetX + block.markerLeft}px`
  marker.style.top = `${markerTop(block)}px`
  marker.textContent = block.markerText
  wrapper.append(marker)
}

function markerTop(block: BlockLayout): number {
  switch (block.kind) {
    case 'code':
      return CODE_BLOCK_PADDING_Y
    case 'inline':
      return Math.max(0, Math.round((block.lineHeight - 12) / 2))
    case 'rule':
      return 0
  }
}

function renderInlineFragment(fragment: InlineFragmentLayout): HTMLElement {
  const node = fragment.href === null
    ? document.createElement('span')
    : document.createElement('a')

  node.className = fragment.style.className
  applyTextStyle(node, fragment.style)
  node.textContent = fragment.text

  if (node instanceof HTMLAnchorElement && fragment.href !== null) {
    node.href = fragment.href
    node.target = '_blank'
    node.rel = 'noreferrer'
  }

  return node
}

// Paint with the font and letter spacing the line was measured with. Letter
// spacing is always set, since a fragment would otherwise inherit its row's.
function applyTextStyle(node: HTMLElement, style: TextStyle): void {
  node.style.setProperty('--font', style.font)
  node.style.letterSpacing = `${style.letterSpacing}px`
}
