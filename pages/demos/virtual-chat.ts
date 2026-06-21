import { prepare, layout, type PreparedText } from '../../src/layout.ts'

// --- Data ---

const SNIPPETS: readonly string[] = [
  'hey', 'hi!', 'what\'s up', 'nm u?', 'lol', 'ok', 'sure', 'sounds good', 'haha', '👍',
  'omg that\'s hilarious 😂', 'wait what happened??', 'no way', 'seriously?', 'I can\'t believe it',
  'yeah I was thinking the same thing honestly', 'did you see that tweet about the new AI model?',
  'I just finished reading that book you recommended, it was actually really good',
  'btw do you know if the meeting tomorrow is at 10 or 11? I keep getting conflicting info from different people',
  'I\'ve been trying to fix this bug for three hours and I think I finally found it. Turns out it was a race condition in the event handler that only triggers when you resize the window while scrolling. Classic.',
  'The restaurant on 5th street has amazing ramen. We should go sometime this week if you\'re free. They close early on weekdays though so we\'d need to get there before 8.',
  'https://github.com/some/really-long-url/that-wraps?query=param&foo=bar',
  'Remember when we tried to deploy on Friday and everything broke? Good times 🙃',
  'Can you review my PR when you get a chance? It\'s the one that refactors the auth middleware. Not urgent but would be nice to get it merged before the sprint ends.',
  'I think the API is returning stale data. The cache TTL might be too aggressive. Let me check the config... yeah it\'s set to 24h which seems way too long for user preferences.',
  '春天到了，天气越来越暖和了！你那边怎么样？',
  'مرحبا! كيف حالك اليوم؟ أتمنى أن يكون يومك جميلا',
  'こんにちは！最近どうですか？新しいプロジェクトはうまくいっていますか？',
  'The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.',
  '🎉🎊🥳 Happy birthday!!! 🎂🎈🎁',
  'TL;DR: the whole backend needs to be rewritten because someone thought it was a good idea to store JSON in a TEXT column and parse it on every single request. Performance is abysmal. We need to migrate to a proper schema with indexed columns.',
]

const SENT_COLORS: readonly string[] = ['#1a4a8a', '#2a4a6a', '#1a3a6a', '#2a3a8a', '#1a4a7a']
const RECV_COLORS: readonly string[] = ['#2a2a2a', '#2a2a35', '#302a2a', '#2a302a', '#2d2a2a']

// --- Types ---

type Message = {
  text: string
  sent: boolean
  color: string
  sizeOffset: number
}

type DomCache = {
  scrollEl: HTMLElement
  contentEl: HTMLElement
  timingEl: HTMLElement
  modeToggle: HTMLInputElement
  domLabel: Element
  pretextLabel: Element
  widthSlider: HTMLInputElement
  widthValEl: HTMLElement
  fontSlider: HTMLInputElement
  fontValEl: HTMLElement
}

// --- Constants ---

const MSG_COUNT = 5000
const BUBBLE_PAD_V = 16 // 8 + 8 px vertical padding on .bubble
const BUBBLE_PAD_H = 24 // 12 + 12 px horizontal padding on .bubble
const MSG_PAD_V = 6     // 3 + 3 px vertical padding on .msg
const MSG_PAD_H = 32    // 16 + 16 px horizontal padding on .msg
const OVERSCAN = 5
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const FPS_WINDOW_MS = 400
const FPS_DISPLAY_MS = 1000

// --- Helpers ---

function fontStr(size: number): string {
  return `${size}px ${FONT_FAMILY}`
}

function lineH(size: number): number {
  return Math.round(size * 1.47)
}

function maxBubbleContentW(chatWidth: number): number {
  return Math.floor((chatWidth - MSG_PAD_H) * 0.75) - BUBBLE_PAD_H
}

function seededRandom(seed: number): () => number {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!
}

function getRequiredElement(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLElement)) throw new Error(`#${id} not found`)
  return el
}

function getRequiredInput(id: string): HTMLInputElement {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLInputElement)) throw new Error(`#${id} not found`)
  return el
}

function getRequiredBySelector(selector: string): Element {
  const el = document.querySelector(selector)
  if (el === null) throw new Error(`${selector} not found`)
  return el
}

// --- Message generation ---

function generateMessages(): Message[] {
  const rand = seededRandom(42)
  const msgs: Message[] = []
  for (let i = 0; i < MSG_COUNT; i++) {
    const partCount = Math.floor(rand() * 3) + 1
    let text = ''
    for (let p = 0; p < partCount; p++) {
      if (p > 0) text += ' '
      text += pick(SNIPPETS, rand)
    }
    const sent = rand() > 0.45
    msgs.push({
      text,
      sent,
      color: sent ? pick(SENT_COLORS, rand) : pick(RECV_COLORS, rand),
      sizeOffset: Math.floor(rand() * 6) - 2,
    })
  }
  return msgs
}

// --- Virtualizer ---

function renderVisible(
  dom: DomCache,
  messages: Message[],
  heights: Float64Array,
  offsets: Float64Array,
  totalH: number,
  baseFontSize: number,
  rendered: Map<number, HTMLElement>,
): void {
  dom.contentEl.style.height = totalH + 'px'
  const scrollTop = dom.scrollEl.scrollTop
  const viewH = dom.scrollEl.clientHeight

  // Binary search for first visible message
  let lo = 0
  let hi = MSG_COUNT - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid]! + heights[mid]! < scrollTop) lo = mid + 1
    else hi = mid
  }
  const first = Math.max(0, lo - OVERSCAN)
  let last = first
  while (last < MSG_COUNT - 1 && offsets[last]! < scrollTop + viewH) last++
  last = Math.min(MSG_COUNT - 1, last + OVERSCAN)

  // Evict off-screen elements
  const visible = new Set<number>()
  for (let i = first; i <= last; i++) visible.add(i)
  rendered.forEach((el, idx) => {
    if (!visible.has(idx)) { el.remove(); rendered.delete(idx) }
  })

  // Create newly visible elements
  const bubbleOuterW = maxBubbleContentW(dom.scrollEl.clientWidth) + BUBBLE_PAD_H
  for (let i = first; i <= last; i++) {
    if (rendered.has(i)) continue
    const m = messages[i]!
    const sz = baseFontSize + m.sizeOffset
    const el = document.createElement('div')
    el.className = `msg ${m.sent ? 'sent' : 'received'}`
    el.style.top = offsets[i]! + 'px'
    el.style.height = heights[i]! + 'px'
    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    bubble.style.cssText =
      `max-width:${bubbleOuterW}px;` +
      `background:${m.color};` +
      `font:${fontStr(sz)};` +
      `line-height:${lineH(sz)}px;` +
      `color:${m.sent ? '#e8f0fe' : '#e0e0e0'};`
    bubble.textContent = m.text
    el.appendChild(bubble)
    dom.contentEl.appendChild(el)
    rendered.set(i, el)
  }
}

// --- Measurement: Pretext ---

function measureWithPretext(
  messages: Message[],
  prepared: PreparedText[],
  chatWidth: number,
  baseFontSize: number,
  heights: Float64Array,
  offsets: Float64Array,
): { totalH: number; ms: number } {
  const maxW = maxBubbleContentW(chatWidth)
  const t0 = performance.now()
  let offset = 0
  for (let i = 0; i < MSG_COUNT; i++) {
    const sz = baseFontSize + messages[i]!.sizeOffset
    const h = layout(prepared[i]!, maxW, lineH(sz)).height + BUBBLE_PAD_V + MSG_PAD_V
    heights[i] = h
    offsets[i] = offset
    offset += h
  }
  return { totalH: offset, ms: performance.now() - t0 }
}

// --- Measurement: DOM ---

function measureWithDOM(
  messages: Message[],
  chatWidth: number,
  baseFontSize: number,
  heights: Float64Array,
  offsets: Float64Array,
): { totalH: number; ms: number } {
  const maxW = maxBubbleContentW(chatWidth)
  const t0 = performance.now()

  const container = document.createElement('div')
  container.style.cssText = `position:absolute;visibility:hidden;top:0;left:0;width:${chatWidth}px;`
  const els: HTMLElement[] = new Array(MSG_COUNT)

  for (let i = 0; i < MSG_COUNT; i++) {
    const m = messages[i]!
    const sz = baseFontSize + m.sizeOffset
    const el = document.createElement('div')
    el.style.cssText =
      `max-width:${maxW + BUBBLE_PAD_H}px;width:fit-content;` +
      `font:${fontStr(sz)};line-height:${lineH(sz)}px;` +
      `word-break:normal;overflow-wrap:break-word;white-space:normal;` +
      `padding:8px 12px;box-sizing:border-box;`
    el.textContent = m.text
    container.appendChild(el)
    els[i] = el
  }
  document.body.appendChild(container)

  let offset = 0
  for (let i = 0; i < MSG_COUNT; i++) {
    const h = els[i]!.offsetHeight + MSG_PAD_V
    heights[i] = h
    offsets[i] = offset
    offset += h
  }
  document.body.removeChild(container)

  return { totalH: offset, ms: performance.now() - t0 }
}

// --- FPS counter ---

function createFpsCounter() {
  let frames = 0
  let windowStart = performance.now()
  let display = ''
  return {
    tick(): void {
      frames++
      const now = performance.now()
      if (now - windowStart >= FPS_WINDOW_MS) {
        display = `${Math.round(frames / ((now - windowStart) / 1000))} fps`
        frames = 0
        windowStart = now
      }
    },
    get text(): string { return display },
  }
}

// --- Boot ---

const messages = generateMessages()

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}

function boot(): void {
  const dom: DomCache = {
    scrollEl: getRequiredElement('chat'),
    contentEl: getRequiredElement('chat-content'),
    timingEl: getRequiredElement('timing'),
    modeToggle: getRequiredInput('mode-toggle'),
    domLabel: getRequiredBySelector('.toggle-label.dom'),
    pretextLabel: getRequiredBySelector('.toggle-label.pretext'),
    widthSlider: getRequiredInput('width-slider'),
    widthValEl: getRequiredElement('width-val'),
    fontSlider: getRequiredInput('font-slider'),
    fontValEl: getRequiredElement('font-val'),
  }

  const viewportW = document.documentElement.clientWidth
  const initialWidth = Math.min(600, viewportW - 32)

  // Clamp slider range to viewport
  const sliderMax = Math.min(900, viewportW - 32)
  dom.widthSlider.max = String(sliderMax)
  dom.widthSlider.value = String(initialWidth)
  dom.widthValEl.textContent = initialWidth + 'px'

  const st = {
    baseFontSize: 15,
    chatWidth: initialWidth,
    usePretext: false,
    totalH: 0,
    preparedFontSize: -1,
  }

  const heights = new Float64Array(MSG_COUNT)
  const offsets = new Float64Array(MSG_COUNT)
  let prepared: PreparedText[] = []
  const rendered = new Map<number, HTMLElement>()
  const fps = createFpsCounter()
  let fpsResetTimer = 0
  let scheduledRaf: number | null = null

  dom.scrollEl.style.width = st.chatWidth + 'px'

  // --- Prepare ---

  function ensurePrepared(): number {
    if (st.preparedFontSize === st.baseFontSize) return 0
    const t0 = performance.now()
    prepared = new Array(MSG_COUNT)
    for (let i = 0; i < MSG_COUNT; i++) {
      const m = messages[i]!
      prepared[i] = prepare(m.text, fontStr(st.baseFontSize + m.sizeOffset))
    }
    st.preparedFontSize = st.baseFontSize
    return performance.now() - t0
  }

  // --- Update cycle ---

  function fullUpdate(fontChanged: boolean): void {
    let detail: string

    if (st.usePretext) {
      const prepMs = fontChanged ? ensurePrepared() : 0
      const result = measureWithPretext(messages, prepared, st.chatWidth, st.baseFontSize, heights, offsets)
      st.totalH = result.totalH
      detail = fontChanged && prepMs > 0
        ? `${prepMs.toFixed(1)}ms prepare + ${result.ms.toFixed(1)}ms layout`
        : `${result.ms.toFixed(1)}ms layout`
    } else {
      const result = measureWithDOM(messages, st.chatWidth, st.baseFontSize, heights, offsets)
      st.totalH = result.totalH
      detail = `${result.ms.toFixed(1)}ms measure`
    }

    rendered.forEach(el => el.remove())
    rendered.clear()
    renderVisible(dom, messages, heights, offsets, st.totalH, st.baseFontSize, rendered)

    fps.tick()
    dom.timingEl.textContent = fps.text ? `${detail}  ·  ${fps.text}` : detail
    clearTimeout(fpsResetTimer)
    fpsResetTimer = window.setTimeout(() => { dom.timingEl.textContent = detail }, FPS_DISPLAY_MS)
  }

  function scheduleRender(): void {
    if (scheduledRaf !== null) return
    scheduledRaf = requestAnimationFrame(() => {
      scheduledRaf = null
      if (st.totalH === 0) return
      renderVisible(dom, messages, heights, offsets, st.totalH, st.baseFontSize, rendered)
    })
  }

  // --- Toggle ---

  function syncToggleUI(): void {
    dom.domLabel.classList.toggle('active', !st.usePretext)
    dom.pretextLabel.classList.toggle('active', st.usePretext)
    dom.timingEl.classList.toggle('dom', !st.usePretext)
    dom.timingEl.classList.toggle('pretext', st.usePretext)
  }

  dom.modeToggle.addEventListener('change', () => {
    st.usePretext = dom.modeToggle.checked
    syncToggleUI()
    const scrollPct = dom.scrollEl.scrollTop / (st.totalH - dom.scrollEl.clientHeight || 1)
    fullUpdate(true)
    dom.scrollEl.scrollTop = scrollPct * (st.totalH - dom.scrollEl.clientHeight || 1)
  })

  // --- Sliders ---

  dom.widthSlider.addEventListener('input', () => {
    st.chatWidth = Number.parseInt(dom.widthSlider.value, 10)
    dom.widthValEl.textContent = st.chatWidth + 'px'
    dom.scrollEl.style.width = st.chatWidth + 'px'
    fullUpdate(false)
  })

  dom.fontSlider.addEventListener('input', () => {
    st.baseFontSize = Number.parseInt(dom.fontSlider.value, 10)
    dom.fontValEl.textContent = st.baseFontSize + 'px'
    fullUpdate(true)
  })

  dom.scrollEl.addEventListener('scroll', scheduleRender)

  // --- Init ---

  syncToggleUI()
  document.fonts.ready.then(() => fullUpdate(true))
}
