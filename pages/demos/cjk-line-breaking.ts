import { prepareWithSegments, layoutWithLines } from '../../src/layout.ts'
import { DEMO_TEXT, FONT, FONT_SIZE, LINE_HEIGHT, PADDING, RULE_GROUPS, UI, type Lang, type I18n, type RuleGroupEntry } from './cjk-line-breaking.data.ts'

// --- Constants ---

const PIXEL_RATIO = devicePixelRatio || 1
const INK = '#2a2520'
const HIGHLIGHT_BG = 'rgba(149, 95, 59, 0.25)'

// --- DOM ---

const dom = {
  title: document.querySelector('h1')!,
  intro: document.querySelector('.intro')!,
  langButton: document.getElementById('langButton') as HTMLButtonElement,
  slider: document.getElementById('slider') as HTMLInputElement,
  widthValue: document.getElementById('widthValue')!,
  autoToggle: document.getElementById('autoToggle') as HTMLInputElement,
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  rulesTitle: document.getElementById('rulesTitle')!,
  rulesDescription: document.getElementById('rulesDescription')!,
  ruleGroups: document.getElementById('ruleGroups')!,
}

// --- State ---

let lang: Lang = 'en'
let columnWidth = Number.parseInt(dom.slider.value, 10)
let activeEntry: RuleGroupEntry | null = null
let scheduledFrame: number | null = null
let prevCanvasWidth = 0
let prevCanvasHeight = 0

let autoAnimating = false
let autoDirection = 1
let autoLastTime = 0
let autoFractional = 0
const AUTO_MIN = Number.parseInt(dom.slider.min, 10)
const AUTO_MAX = Number.parseInt(dom.slider.max, 10)
const AUTO_PX_PER_SEC = 20

// --- Initialization ---

const ctx = dom.canvas.getContext('2d')!

await document.fonts.ready
const prepared = prepareWithSegments(DEMO_TEXT, FONT)
ctx.font = FONT
const fontMetrics = ctx.measureText('')
const fontAscent = fontMetrics.fontBoundingBoxAscent
const fontBoxHeight = fontAscent + fontMetrics.fontBoundingBoxDescent

// --- i18n ---

function t(pair: I18n): string { return pair[lang] }

// --- Render ---

function render(): void {
  const innerWidth = columnWidth - PADDING * 2
  if (innerWidth <= 0) return

  const { lines, height } = layoutWithLines(prepared, innerWidth, LINE_HEIGHT)

  const canvasHeight = height + PADDING * 2
  if (columnWidth !== prevCanvasWidth || canvasHeight !== prevCanvasHeight) {
    dom.canvas.width = columnWidth * PIXEL_RATIO
    dom.canvas.height = canvasHeight * PIXEL_RATIO
    dom.canvas.style.width = `${columnWidth}px`
    dom.canvas.style.height = `${canvasHeight}px`
    prevCanvasWidth = columnWidth
    prevCanvasHeight = canvasHeight
  }
  ctx.setTransform(PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, columnWidth, canvasHeight)
  ctx.font = FONT
  ctx.textBaseline = 'alphabetic'

  const { segments, widths } = prepared
  const highlight = activeEntry?.char ?? null
  for (let i = 0; i < lines.length; i++) {
    const { start, end } = lines[i]!
    const textY = PADDING + i * LINE_HEIGHT + FONT_SIZE
    let x = PADDING
    for (let s = start.segmentIndex; s < end.segmentIndex; s++) {
      const segment = segments[s]!
      const width = widths[s]!
      if (width === 0 || segment[0] === ' ') { x += width; continue }
      if (highlight !== null && segment.includes(highlight)) {
        ctx.fillStyle = HIGHLIGHT_BG
        ctx.fillRect(x, textY - fontAscent, width, fontBoxHeight)
      }
      ctx.fillStyle = INK
      ctx.fillText(segment, x, textY)
      x += width
    }
  }

  dom.widthValue.textContent = `${columnWidth}px`
  dom.slider.value = String(columnWidth)
}

function scheduleRender(): void {
  if (scheduledFrame !== null) return
  scheduledFrame = requestAnimationFrame(() => { scheduledFrame = null; render() })
}

// --- Event: slider ---

dom.slider.addEventListener('input', () => {
  columnWidth = Number.parseInt(dom.slider.value, 10)
  if (autoAnimating) { autoAnimating = false; dom.autoToggle.checked = false }
  scheduleRender()
})

// --- Event: auto animation ---

function autoTick(now: number): void {
  if (!autoAnimating) return
  const deltaTime = autoLastTime === 0 ? 16 : Math.min(now - autoLastTime, 50)
  autoLastTime = now
  autoFractional += autoDirection * AUTO_PX_PER_SEC * (deltaTime / 1000)
  const step = Math.trunc(autoFractional)
  if (step !== 0) {
    autoFractional -= step
    columnWidth = Math.max(AUTO_MIN, Math.min(AUTO_MAX, columnWidth + step))
    if (columnWidth >= AUTO_MAX) autoDirection = -1
    if (columnWidth <= AUTO_MIN) autoDirection = 1
    render()
  }
  if (autoAnimating) requestAnimationFrame(autoTick)
}

dom.autoToggle.addEventListener('change', () => {
  autoAnimating = dom.autoToggle.checked
  if (autoAnimating) { autoDirection = 1; autoLastTime = 0; autoFractional = 0; requestAnimationFrame(autoTick) }
})

// --- Event: lang toggle ---

function applyLang(): void {
  const ui = UI[lang]
  document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en'
  dom.title.textContent = ui.title
  dom.intro.textContent = ui.intro
  dom.rulesTitle.textContent = ui.rulesTitle
  dom.rulesDescription.textContent = ui.rulesDescription

  const en = lang === 'en' ? 'var(--color-accent)' : 'var(--color-muted)'
  const zh = lang === 'zh' ? 'var(--color-accent)' : 'var(--color-muted)'
  dom.langButton.innerHTML = `<span style="color:${en}">EN</span> <span style="color:var(--color-rule)">/</span> <span style="color:${zh}">中文</span>`
  dom.langButton.title = lang === 'zh' ? 'Switch to English' : '切换到中文'

  renderRuleGroups()
}

dom.langButton.addEventListener('click', () => { lang = lang === 'en' ? 'zh' : 'en'; applyLang() })

// --- Rule groups ---

let chips: { entry: RuleGroupEntry; element: HTMLButtonElement }[] = []

function renderRuleGroups(): void {
  dom.ruleGroups.replaceChildren()
  chips = []
  for (const group of RULE_GROUPS) {
    const section = document.createElement('div')
    section.className = 'rule-group'

    const title = document.createElement('div')
    title.className = 'rule-group-title'
    title.textContent = t(group.title)

    const description = document.createElement('p')
    description.className = 'rule-group-description'
    description.textContent = t(group.description)

    const grid = document.createElement('div')
    grid.className = 'rule-entries'
    for (const entry of group.entries) {
      const button = document.createElement('button')
      button.className = 'rule-chip'
      button.type = 'button'
      button.innerHTML = `<span class="rule-chip-char">${entry.char}</span><span class="rule-chip-code">U+${entry.unicode}</span><span class="rule-chip-name">${t(entry.name)}</span>`
      button.addEventListener('click', () => {
        activeEntry = activeEntry === entry ? null : entry
        for (const chip of chips) chip.element.classList.toggle('active', chip.entry === activeEntry)
        render()
      })
      chips.push({ entry, element: button })
      grid.appendChild(button)
    }

    section.append(title, description, grid)
    dom.ruleGroups.appendChild(section)
  }
}

// --- Init ---

applyLang()
render()
