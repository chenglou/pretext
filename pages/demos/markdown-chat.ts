import {
  CODE_BLOCK_PADDING_X,
  CODE_BLOCK_PADDING_Y,
  CODE_FONT,
  CODE_LINE_HEIGHT,
  createChatHistory,
  dropHistoryChunks,
  findAnchoredScrollTop,
  findScrollAnchor,
  findVisibleRange,
  getMaxChatWidth,
  getMessageTopAnchor,
  getOcclusionBannerHeight,
  layoutMessageFrame,
  loadHistoryChunks,
  MARKER_FONT,
  materializeMessageBlocks,
  materializeQuoteRails,
  MESSAGE_SIDE_PADDING,
  OCCLUSION_BANNER_HEIGHT,
  type BlockLayout,
  type HistoryWindow,
  type MessageFrame,
  type PreparedChatMessage,
  type QuoteRailLayout,
  type ScrollAnchor,
  type TextStyle,
} from './markdown-chat.model.ts'

type State = {
  events: {
    jumpKey: 'first' | 'last' | null // the last key pressed this frame that jumps to the history's first or last message
    navigated: boolean // the page opened or its URL's fragment changed
    toggleVisualization: boolean
  }
  historyWindow: HistoryWindow | null // laid out as the screen shows it; null before the first frame
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
  events: {
    jumpKey: null,
    navigated: true,
    toggleVisualization: false,
  },
  historyWindow: null,
  isVisualizationOn: false,
  scrollAnchor: getMessageTopAnchor(0),
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
// The browser's Home and End, and Command-Up and Command-Down on a Mac, scroll to
// an end of the scroll range, which holds only the loaded chunks. These jump to
// the history's first and last messages instead.
window.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.shiftKey) return
  if (event.metaKey ? event.key === 'ArrowUp' : event.key === 'Home') {
    st.events.jumpKey = 'first'
  } else if (event.metaKey ? event.key === 'ArrowDown' : event.key === 'End') {
    st.events.jumpKey = 'last'
  } else {
    return
  }
  event.preventDefault()
  scheduleRender()
})
window.addEventListener('hashchange', () => {
  st.events.navigated = true
  scheduleRender()
})

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
  const hash = location.hash
  const occlusionBannerHeight = getOcclusionBannerHeight(viewportHeight)
  const isCompactOcclusionChrome = occlusionBannerHeight < OCCLUSION_BANNER_HEIGHT

  let isVisualizationOn = st.isVisualizationOn
  if (st.events.toggleVisualization) isVisualizationOn = !isVisualizationOn

  // A jump: a key to the first or last message, else the message the URL links
  // to when the page opens or the link changes.
  let jumpOrdinal = st.events.navigated ? parseMessageLink(hash, history.length) : null
  switch (st.events.jumpKey) {
    case 'first':
      jumpOrdinal = 0
      break
    case 'last':
      jumpOrdinal = history.length - 1
      break
    case null:
      break
  }

  const chatWidth = getMaxChatWidth(viewportWidth)
  const previousWindow = st.historyWindow

  // A jump anchors its message's top where the first message's top sits at the
  // top of the chat. Otherwise st.scrollTop is where the last frame left the
  // scroll position, so any other value is the user's scroll: anchor the first
  // message whose top shows below the top banner, in the layout they scrolled.
  // Otherwise, or before the first layout, keep the anchor. Either way, scroll so
  // its top keeps its distance below the banner, within the range, so loading or
  // unloading a chunk above doesn't move what's shown.
  let scrollAnchor = st.scrollAnchor
  if (jumpOrdinal !== null) {
    scrollAnchor = getMessageTopAnchor(jumpOrdinal)
  } else if (previousWindow !== null && scrollTop !== st.scrollTop) {
    scrollAnchor = findScrollAnchor(previousWindow, scrollTop, viewportHeight, occlusionBannerHeight)
  }
  // The window keeps the anchor, which the scroll below needs, and unless the
  // frame jumps, what the screen shows: the last frame's layout, scrolled to
  // scrollTop. Then it loads what the screen shows once scrolled, until it holds
  // all of that, so the frame shows every message after a jump, a new width or a
  // taller room. It drops chunks only then, so it never drops one it has to
  // prepare again.
  let firstKeptOrdinal = scrollAnchor.ordinal
  let lastKeptOrdinal = scrollAnchor.ordinal
  if (jumpOrdinal === null && previousWindow !== null) {
    const shown = findVisibleRange(previousWindow.layout, scrollTop, viewportHeight, occlusionBannerHeight)
    firstKeptOrdinal = Math.min(firstKeptOrdinal, previousWindow.firstOrdinal + shown.start)
    lastKeptOrdinal = Math.max(lastKeptOrdinal, previousWindow.firstOrdinal + shown.end - 1)
  }
  let historyWindow = loadHistoryChunks(history, previousWindow, firstKeptOrdinal, lastKeptOrdinal, chatWidth)
  for (;;) {
    const shown = findVisibleRange(
      historyWindow.layout,
      findAnchoredScrollTop(historyWindow, history.length, scrollAnchor, viewportHeight, occlusionBannerHeight),
      viewportHeight,
      occlusionBannerHeight,
    )
    firstKeptOrdinal = Math.min(firstKeptOrdinal, historyWindow.firstOrdinal + shown.start)
    lastKeptOrdinal = Math.max(lastKeptOrdinal, historyWindow.firstOrdinal + shown.end - 1)
    const loadedWindow = loadHistoryChunks(history, historyWindow, firstKeptOrdinal, lastKeptOrdinal, chatWidth)
    if (loadedWindow === historyWindow) break
    historyWindow = loadedWindow
  }
  historyWindow = dropHistoryChunks(historyWindow, firstKeptOrdinal, lastKeptOrdinal)
  const conversation = historyWindow.layout
  // A mounted row keeps its contents when only the window changes.
  const needsRelayout = previousWindow === null || previousWindow.layout.chatWidth !== chatWidth
  const canvasHeight = conversation.totalHeight + occlusionBannerHeight * 2
  const adjustedScrollTop = findAnchoredScrollTop(
    historyWindow,
    history.length,
    scrollAnchor,
    viewportHeight,
    occlusionBannerHeight,
  )

  const { start, end } = findVisibleRange(conversation, adjustedScrollTop, viewportHeight, occlusionBannerHeight)
  const visibleFrames = new Array<MessageFrame>(end - start)
  for (let index = start; index < end; index++) {
    visibleFrames[index - start] = layoutMessageFrame(historyWindow.messages[index]!, chatWidth)
  }

  st.historyWindow = historyWindow
  st.isVisualizationOn = isVisualizationOn
  st.scrollAnchor = scrollAnchor
  st.events.jumpKey = null
  st.events.navigated = false
  st.events.toggleVisualization = false

  domCache.root.style.setProperty('--chat-width', `${chatWidth}px`)
  domCache.root.style.setProperty('--chat-viewport-width', `${viewportWidth}px`)
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

  projectVisibleRows(historyWindow, occlusionBannerHeight, visibleFrames, start, end, needsRelayout)

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

// A link to a message is #message-<n>, counting from 1. Other fragments, and
// messages past the history's end, link to none.
function parseMessageLink(hash: string, messageCount: number): number | null {
  const match = /^#message-([1-9]\d*)$/.exec(hash)
  if (match === null) return null
  const ordinal = Number(match[1]) - 1
  return ordinal < messageCount ? ordinal : null
}

// start and end index the window's messages. Rows are cached by ordinal, so a
// row stays mounted while chunks load and unload around it.
function projectVisibleRows(
  historyWindow: HistoryWindow,
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
      const cachedRow = projectRow(historyWindow, occlusionBannerHeight, frame, ordinal, needsRelayout)
      if (cachedRow.row.parentNode === null) domCache.canvas.append(cachedRow.row)
    }
  } else {
    let anchorRow = domCache.rows[overlapStart]?.row ?? null
    for (let ordinal = overlapStart - 1; ordinal >= startOrdinal; ordinal--) {
      const frame = visibleFrames[ordinal - startOrdinal]!
      const cachedRow = projectRow(historyWindow, occlusionBannerHeight, frame, ordinal, needsRelayout)
      if (anchorRow === null) {
        if (cachedRow.row.parentNode === null) domCache.canvas.append(cachedRow.row)
      } else if (cachedRow.row.parentNode !== domCache.canvas || cachedRow.row.nextSibling !== anchorRow) {
        domCache.canvas.insertBefore(cachedRow.row, anchorRow)
      }
      anchorRow = cachedRow.row
    }

    for (let ordinal = overlapStart; ordinal < overlapEnd; ordinal++) {
      const frame = visibleFrames[ordinal - startOrdinal]!
      projectRow(historyWindow, occlusionBannerHeight, frame, ordinal, needsRelayout)
    }

    for (let ordinal = overlapEnd; ordinal < endOrdinal; ordinal++) {
      const frame = visibleFrames[ordinal - startOrdinal]!
      const cachedRow = projectRow(historyWindow, occlusionBannerHeight, frame, ordinal, needsRelayout)
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
  occlusionBannerHeight: number,
  frame: MessageFrame,
  ordinal: number,
  needsRelayout: boolean,
): CachedRow {
  const { heights, tops } = historyWindow.layout
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
  projectMessageNode(cachedRow, frame, occlusionBannerHeight + tops[index]!, heights[index]!)
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
    // The paragraph style sets the baseline.
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
      const node = renderInlineFragment(fragment.style, fragment.href, fragment.text)
      // A collapsed space paints inside the element of the item whose font
      // measured it: this fragment's, the previous fragment's, or, for an item
      // holding only whitespace, an element of its own.
      const gapItemIndex = fragment.gapItemIndex
      if (gapItemIndex === fragment.itemIndex) {
        node.prepend(' ')
      } else if (gapItemIndex >= 0 && gapItemIndex === line.fragments[fragmentIndex - 1]?.itemIndex) {
        row.lastElementChild!.append(' ')
      } else if (gapItemIndex >= 0) {
        row.append(renderInlineFragment(block.styles[gapItemIndex]!, block.hrefs[gapItemIndex] ?? null, ' '))
      }
      row.append(node)
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

function renderInlineFragment(style: TextStyle, href: string | null, text: string): HTMLElement {
  const node = href === null
    ? document.createElement('span')
    : document.createElement('a')

  node.className = style.className
  applyTextStyle(node, style)
  node.textContent = text

  if (node instanceof HTMLAnchorElement && href !== null) {
    node.href = href
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
