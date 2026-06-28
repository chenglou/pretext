import { prepareWithSegments, layoutNextLine, type LayoutCursor, type PreparedTextWithSegments } from '../../src/layout.ts'

const STORY =
  'Once upon a time, a very hungry mouse crept through a quiet kitchen. ' +
  'His tiny nose twitched with the unmistakable scent of aged Gruyère. ' +
  'There, on the wooden counter, sat the most magnificent wedge of cheese ' +
  'he had ever seen — golden, dotted with perfect round holes, glowing like ' +
  'a small sun in the afternoon light. He froze. His whiskers quivered. His ' +
  'heart thumped like a tiny drum. Could this be real? He had dreamed of such ' +
  'a cheese every night, curled up in his little nest behind the baseboard. ' +
  'Round. Warm. Salty. Perfect. He took one careful step forward, then another. ' +
  'The cheese did not move. He took one deep breath and made a decision: ' +
  'today, at long last, the cheese would be his.'

// Gap between the right edge of the text and the left edge of the cheese
const CHEESE_GAP = 14
// Padding inside the panel (must match the CSS padding on .panel)
const PANEL_PADDING = 28
// Line height — must match the CSS on .text-layer (16px/26px)
const LINE_H = 26

type State = {
  scheduledRaf: number | null
  prepared: PreparedTextWithSegments | null
  preparedFont: string
}

const st: State = {
  scheduledRaf: null,
  prepared: null,
  preparedFont: '',
}

function getRequiredElement(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLElement)) throw new Error(`#${id} not found`)
  return el
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}

function boot(): void {
  const slider = getRequiredElement('cheese-slider')
  const scene = getRequiredElement('scene')
  const cheeseWrap = getRequiredElement('cheese-wrap')
  const textLayer = getRequiredElement('text-layer')
  const sizeLabel = getRequiredElement('cheese-size-label')

  if (!(slider instanceof HTMLInputElement)) return

  function scheduleRender(): void {
    if (st.scheduledRaf !== null) return
    st.scheduledRaf = requestAnimationFrame(() => {
      st.scheduledRaf = null
      render(slider, scene, cheeseWrap, textLayer, sizeLabel)
    })
  }

  slider.addEventListener('input', () => {
    sizeLabel.textContent = `${slider.value}px`
    scheduleRender()
  })

  window.addEventListener('resize', scheduleRender)

  document.fonts.ready.then(() => {
    scheduleRender()
  })

  scheduleRender()
}

function getFontString(el: HTMLElement): string {
  const styles = getComputedStyle(el)
  if (styles.font.length > 0) return styles.font
  return (
    `${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ` +
    `${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}`
  )
}

function getPrepared(font: string): PreparedTextWithSegments {
  if (st.prepared !== null && st.preparedFont === font) return st.prepared
  st.preparedFont = font
  st.prepared = prepareWithSegments(STORY, font)
  return st.prepared
}

function availableWidth(
  lineY: number,
  containerW: number,
  cheeseTop: number,
  cheeseBottom: number,
  cheeseLeft: number,
): number {
  const lineBottom = lineY + LINE_H
  if (lineY < cheeseBottom && lineBottom > cheeseTop) {
    // This line overlaps the cheese vertically — narrow it so text stays left of cheese
    return Math.max(60, cheeseLeft - CHEESE_GAP)
  }
  return containerW
}

function render(
  slider: HTMLInputElement,
  scene: HTMLElement,
  cheeseWrap: HTMLElement,
  textLayer: HTMLElement,
  sizeLabel: HTMLElement,
): void {
  const sceneRect = scene.getBoundingClientRect()
  const containerW = Math.floor(sceneRect.width) - PANEL_PADDING * 2
  if (containerW < 60) return

  const cheeseSize = Number(slider.value)
  sizeLabel.textContent = `${cheeseSize}px`

  // Cheese position relative to the text layer (top-right of the panel content area)
  const CHEESE_TOP = 0    // cheese starts at the top of the text area
  const cheeseBottom = CHEESE_TOP + cheeseSize
  const cheeseLeft = containerW - cheeseSize  // right-flush within the content area

  // Update the cheese element size (CSS custom property on the panel)
  scene.style.setProperty('--cheese-size', `${cheeseSize}px`)

  // Get the font from the text layer so Pretext uses the same face/size the browser renders
  const font = getFontString(textLayer)
  const prepared = getPrepared(font)

  // Walk lines with per-line widths using layoutNextLine()
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = 0
  const lines: Array<{ text: string; y: number; w: number }> = []

  while (true) {
    const w = availableWidth(y, containerW, CHEESE_TOP, cheeseBottom, cheeseLeft)
    const line = layoutNextLine(prepared, cursor, w)
    if (line === null) break
    lines.push({ text: line.text, y, w })
    cursor = line.end
    y += LINE_H
    if (y > 1200) break // safety cap
  }

  // Flush lines into DOM — reuse existing span elements where possible
  const children = textLayer.children
  const childArray = Array.from(children) as HTMLElement[]

  for (let i = 0; i < lines.length; i++) {
    const lineData = lines[i]!
    let el = childArray[i]
    if (!(el instanceof HTMLSpanElement)) {
      el = document.createElement('span')
      el.style.cssText =
        'display:block;position:absolute;left:0;white-space:nowrap;overflow:visible;'
      textLayer.appendChild(el)
      childArray.push(el)
    }
    el.textContent = lineData.text
    el.style.top = `${lineData.y}px`
    el.hidden = false
  }

  // Hide any extra spans from a previous render with more lines
  for (let i = lines.length; i < childArray.length; i++) {
    const el = childArray[i]
    if (el instanceof HTMLElement) el.hidden = true
  }

  // Size the text layer so the panel is tall enough
  const textHeight = y
  textLayer.style.height = `${textHeight}px`

  // Ensure the panel is tall enough to show text + mouse illustration
  const minPanelHeight = textHeight + PANEL_PADDING * 2 + 20
  scene.style.minHeight = `${Math.max(380, minPanelHeight)}px`
}
