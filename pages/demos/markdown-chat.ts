import {
  buildConversationFrame,
  CODE_BLOCK_PADDING_X,
  CODE_BLOCK_PADDING_Y,
  CODE_LINE_HEIGHT,
  createPreparedChatTemplates,
  findVisibleRange,
  getMaxChatWidth,
  materializeTemplateLayout,
  MESSAGE_SIDE_PADDING,
  OCCLUSION_BANNER_HEIGHT,
  type BlockLayout,
  type ChatMessageInstance,
  type ConversationFrame,
  type InlineFragmentLayout,
  type TemplateFrame,
} from './markdown-chat.model.ts'

type State = {
  events: {
    toggleVisualization: boolean
  }
  frame: ConversationFrame | null
  isVisualizationOn: boolean
}

const domCache = {
  root: document.documentElement,
  shell: getRequiredElement('chat-shell'),
  viewport: getRequiredDiv('chat-viewport'),
  canvas: getRequiredDiv('chat-canvas'),
  toggleButton: getRequiredButton('virtualization-toggle'),
  rows: new Map<string, HTMLElement>(), // cache lifetime: on visibility changes
}

const templates = createPreparedChatTemplates()
const st: State = {
  events: {
    toggleVisualization: false,
  },
  frame: null,
  isVisualizationOn: false,
}

let scheduledRaf: number | null = null

domCache.root.style.setProperty('--message-side-padding', `${MESSAGE_SIDE_PADDING}px`)
domCache.root.style.setProperty('--occlusion-banner-height', `${OCCLUSION_BANNER_HEIGHT}px`)

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

  let isVisualizationOn = st.isVisualizationOn
  if (st.events.toggleVisualization) isVisualizationOn = !isVisualizationOn

  const chatWidth = getMaxChatWidth(viewportWidth)
  const previousFrame = st.frame
  const canReuseFrame = previousFrame !== null && previousFrame.chatWidth === chatWidth
  const frame = canReuseFrame
    ? previousFrame
    : buildConversationFrame(templates, chatWidth)
  const needsRelayout = !canReuseFrame

  const { start, end } = findVisibleRange(
    frame,
    scrollTop,
    viewportHeight,
    OCCLUSION_BANNER_HEIGHT,
    OCCLUSION_BANNER_HEIGHT,
  )

  st.frame = frame
  st.isVisualizationOn = isVisualizationOn
  st.events.toggleVisualization = false

  domCache.root.style.setProperty('--chat-width', `${frame.chatWidth}px`)
  domCache.shell.dataset['visualization'] = isVisualizationOn ? 'on' : 'off'
  domCache.canvas.style.height = `${frame.totalHeight}px`
  domCache.toggleButton.textContent = isVisualizationOn
    ? 'Hide virtualization mask'
    : 'Show virtualization mask'
  domCache.toggleButton.setAttribute('aria-pressed', String(isVisualizationOn))

  projectVisibleRows(frame, start, end, needsRelayout)
}

function projectVisibleRows(
  frame: ConversationFrame,
  start: number,
  end: number,
  needsRelayout: boolean,
): void {
  const visibleKeys = new Set<string>()

  for (let index = start; index < end; index++) {
    const message = frame.messages[index]!
    const key = message.key
    let node = domCache.rows.get(key)
    if (needsRelayout && node !== undefined) {
      node.remove()
      domCache.rows.delete(key)
      node = undefined
    }
    if (node === undefined) {
      node = createMessageNode(message)
      domCache.rows.set(key, node)
    }
    projectMessageNode(node, message.frame, message.top)
    visibleKeys.add(key)
    domCache.canvas.append(node)
  }

  for (const [key, node] of domCache.rows) {
    if (visibleKeys.has(key)) continue
    node.remove()
    domCache.rows.delete(key)
  }
}

function createMessageNode(message: ChatMessageInstance): HTMLElement {
  const layout = materializeTemplateLayout(message)
  const row = document.createElement('article')
  row.className = `msg msg--${layout.role}`

  const stack = document.createElement('div')
  stack.className = 'msg-stack'

  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'

  const inner = document.createElement('div')
  inner.className = 'msg-bubble-inner'

  for (let index = 0; index < layout.blocks.length; index++) {
    inner.append(renderBlock(layout.blocks[index]!, layout.contentInsetX))
  }

  bubble.append(inner)
  stack.append(bubble)
  row.append(stack)
  return row
}

function projectMessageNode(
  row: HTMLElement,
  frame: TemplateFrame,
  top: number,
): void {
  row.style.top = `${top}px`
  row.style.height = `${frame.totalHeight}px`

  const stack = row.firstElementChild
  if (!(stack instanceof HTMLDivElement)) throw new Error('Missing .msg-stack')
  stack.style.width = `${frame.frameWidth}px`

  const bubble = stack.firstElementChild
  if (!(bubble instanceof HTMLDivElement)) throw new Error('Missing .msg-bubble')

  const inner = bubble.firstElementChild
  if (!(inner instanceof HTMLDivElement)) throw new Error('Missing .msg-bubble-inner')
  inner.style.height = `${frame.bubbleHeight}px`
}

function renderBlock(block: BlockLayout, contentInsetX: number): HTMLElement {
  switch (block.kind) {
    case 'inline':
      return renderInlineBlock(block, contentInsetX)
    case 'code':
      return renderCodeBlock(block, contentInsetX)
    case 'rule':
      return renderRuleBlock(block, contentInsetX)
  }
}

function renderInlineBlock(
  block: Extract<BlockLayout, { kind: 'inline' }>,
  contentInsetX: number,
): HTMLElement {
  const wrapper = createBlockShell(block, 'block block--inline', contentInsetX)

  for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
    const line = block.lines[lineIndex]!
    const row = document.createElement('div')
    row.className = 'line-row'
    row.style.height = `${block.lineHeight}px`
    row.style.left = `${contentInsetX + block.contentLeft}px`
    row.style.top = `${lineIndex * block.lineHeight}px`

    for (let fragmentIndex = 0; fragmentIndex < line.fragments.length; fragmentIndex++) {
      row.append(renderInlineFragment(line.fragments[fragmentIndex]!))
    }
    wrapper.append(row)
  }

  return wrapper
}

function renderCodeBlock(
  block: Extract<BlockLayout, { kind: 'code' }>,
  contentInsetX: number,
): HTMLElement {
  const wrapper = createBlockShell(block, 'block block--code-shell', contentInsetX)

  const codeBox = document.createElement('div')
  codeBox.className = 'code-box'
  codeBox.style.left = `${contentInsetX + block.contentLeft}px`
  codeBox.style.width = `${block.width}px`
  codeBox.style.height = `${block.height}px`

  for (let lineIndex = 0; lineIndex < block.lines.length; lineIndex++) {
    const line = block.lines[lineIndex]!
    const row = document.createElement('div')
    row.className = 'code-line'
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
): HTMLElement {
  const wrapper = createBlockShell(block, 'block block--rule-shell', contentInsetX)
  const rule = document.createElement('div')
  rule.className = 'rule-line'
  rule.style.left = `${contentInsetX + block.contentLeft}px`
  rule.style.top = `${Math.floor(block.height / 2)}px`
  rule.style.width = `${block.width}px`
  wrapper.append(rule)
  return wrapper
}

function createBlockShell(
  block: BlockLayout,
  className: string,
  contentInsetX: number,
): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = className
  wrapper.style.top = `${block.top}px`
  wrapper.style.height = `${block.height}px`

  appendRails(wrapper, block, contentInsetX)
  appendMarker(wrapper, block, contentInsetX)
  return wrapper
}

function appendRails(wrapper: HTMLDivElement, block: BlockLayout, contentInsetX: number): void {
  for (let index = 0; index < block.quoteRailLefts.length; index++) {
    const rail = document.createElement('div')
    rail.className = 'quote-rail'
    rail.style.left = `${contentInsetX + block.quoteRailLefts[index]!}px`
    wrapper.append(rail)
  }
}

function appendMarker(
  wrapper: HTMLDivElement,
  block: BlockLayout,
  contentInsetX: number,
): void {
  if (block.markerText === null || block.markerLeft === null || block.markerClassName === null) return

  const marker = document.createElement('span')
  marker.className = block.markerClassName
  marker.style.left = `${contentInsetX + block.markerLeft}px`
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

  node.className = fragment.className
  if (fragment.leadingGap > 0) {
    node.style.marginLeft = `${fragment.leadingGap}px`
  }
  node.textContent = fragment.text

  if (node instanceof HTMLAnchorElement && fragment.href !== null) {
    node.href = fragment.href
    node.target = '_blank'
    node.rel = 'noreferrer'
  }

  return node
}
