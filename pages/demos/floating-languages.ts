import { prepare, layout, prepareWithSegments, walkLineRanges, type PreparedText, type PreparedTextWithSegments } from '../../src/layout.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScriptFamily = 'cjk' | 'arabic' | 'indic' | 'thai-sea' | 'european' | 'emoji' | 'mixed'
type PhysicsMode = 'float' | 'orbit' | 'gravity'

type Phrase = {
  lang: string
  label: string
  text: string
  font: string
  family: ScriptFamily
}

type Bubble = {
  phrase: Phrase
  prepared: PreparedText
  preparedRich: PreparedTextWithSegments
  x: number
  y: number
  vx: number
  vy: number
  width: number
  height: number
  tightWidth: number
  lineCount: number
  el: HTMLDivElement
  active: boolean
  orbitAngle: number
  orbitRadius: number
  animating: boolean
  animWidth: number
  animDir: 1 | -1
  animStartTime: number
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  r: number
  g: number
  b: number
  size: number
}

// ---------------------------------------------------------------------------
// Color map per script family (r, g, b)
// ---------------------------------------------------------------------------

const familyColors: Record<ScriptFamily, [number, number, number]> = {
  cjk: [255, 195, 0],
  arabic: [0, 210, 180],
  indic: [255, 120, 90],
  'thai-sea': [80, 220, 120],
  european: [176, 138, 255],
  emoji: [255, 200, 60],
  mixed: [220, 160, 255],
}

// ---------------------------------------------------------------------------
// Phrase data
// ---------------------------------------------------------------------------

const defaultFont = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'

const phrases: Phrase[] = [
  { lang: 'ko', label: 'Korean', text: '안녕하세요! 오늘 날씨가 참 좋네요.', font: '15px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', family: 'cjk' },
  { lang: 'ko', label: 'Korean', text: '커피 한 잔 할래요?', font: '15px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', family: 'cjk' },
  { lang: 'ko', label: 'Korean', text: '주말에 뭐 해요?', font: '15px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', family: 'cjk' },
  { lang: 'ja', label: 'Japanese', text: 'おはようございます！今日もいい天気ですね。', font: '15px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', family: 'cjk' },
  { lang: 'ja', label: 'Japanese', text: 'お腹すいた、ラーメン食べに行こう！', font: '15px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', family: 'cjk' },
  { lang: 'ja', label: 'Japanese', text: 'ありがとうございます。', font: '15px "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif', family: 'cjk' },
  { lang: 'zh', label: 'Chinese', text: '你好！今天天气真不错。', font: '15px "PingFang SC", "Microsoft YaHei", sans-serif', family: 'cjk' },
  { lang: 'zh', label: 'Chinese', text: '一起去吃火锅吧！', font: '15px "PingFang SC", "Microsoft YaHei", sans-serif', family: 'cjk' },
  { lang: 'zh', label: 'Chinese', text: '谢谢你的帮助。', font: '15px "PingFang SC", "Microsoft YaHei", sans-serif', family: 'cjk' },
  { lang: 'ar', label: 'Arabic', text: 'مرحبًا! كيف حالك اليوم؟', font: '15px "Geeza Pro", "Noto Naskh Arabic", sans-serif', family: 'arabic' },
  { lang: 'ar', label: 'Arabic', text: 'الطقس جميل اليوم.', font: '15px "Geeza Pro", "Noto Naskh Arabic", sans-serif', family: 'arabic' },
  { lang: 'th', label: 'Thai', text: 'สวัสดีครับ วันนี้อากาศดีจังเลย', font: '15px "Thonburi", "Noto Sans Thai", sans-serif', family: 'thai-sea' },
  { lang: 'th', label: 'Thai', text: 'ไปกินข้าวด้วยกันไหม?', font: '15px "Thonburi", "Noto Sans Thai", sans-serif', family: 'thai-sea' },
  { lang: 'hi', label: 'Hindi', text: 'नमस्ते! आज मौसम बहुत अच्छा है।', font: '15px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif', family: 'indic' },
  { lang: 'hi', label: 'Hindi', text: 'क्या हाल है?', font: '15px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif', family: 'indic' },
  { lang: 'en', label: 'English', text: 'Hey, how are you doing today?', font: defaultFont, family: 'european' },
  { lang: 'en', label: 'English', text: "Let's grab coffee sometime!", font: defaultFont, family: 'european' },
  { lang: 'en', label: 'English', text: 'The weather is beautiful today.', font: defaultFont, family: 'european' },
  { lang: 'es', label: 'Spanish', text: '¡Hola! ¿Cómo estás hoy?', font: defaultFont, family: 'european' },
  { lang: 'es', label: 'Spanish', text: '¡Vamos a tomar algo!', font: defaultFont, family: 'european' },
  { lang: 'fr', label: 'French', text: 'Bonjour ! Comment ça va ?', font: defaultFont, family: 'european' },
  { lang: 'fr', label: 'French', text: "Il fait beau aujourd'hui.", font: defaultFont, family: 'european' },
  { lang: 'de', label: 'German', text: 'Guten Tag! Wie geht es Ihnen?', font: defaultFont, family: 'european' },
  { lang: 'pt', label: 'Portuguese', text: 'Olá! Tudo bem com você?', font: defaultFont, family: 'european' },
  { lang: 'ru', label: 'Russian', text: 'Привет! Как у тебя дела?', font: defaultFont, family: 'european' },
  { lang: 'emoji', label: 'Emoji', text: '🌍🌸 Hello World! 🚀✨', font: defaultFont, family: 'emoji' },
  { lang: 'mixed', label: 'Mixed', text: 'AGI 春天到了 🌸 بدأت الرحلة', font: defaultFont, family: 'mixed' },
]

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const scene = document.getElementById('scene')!
const bubbleCountEl = document.getElementById('bubble-count')!
const fpsCounterEl = document.getElementById('fps-counter')!
const canvas = document.getElementById('canvas-bg') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const userInput = document.getElementById('user-input') as HTMLInputElement
const addBtn = document.getElementById('add-btn') as HTMLButtonElement

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const bubbles: Bubble[] = []
const particles: Particle[] = []
let activeBubble: Bubble | null = null
let mouseX = -1000
let mouseY = -1000
let physicsMode: PhysicsMode = 'float'
let globalTime = 0
let lastFrameTime = performance.now()
let frameCount = 0
let lastFpsUpdate = performance.now()
let displayFps = 0

// ---------------------------------------------------------------------------
// Script detection for user input
// ---------------------------------------------------------------------------

function detectScript(text: string): { lang: string; label: string; family: ScriptFamily } {
  const cjk = /[\u3000-\u9fff\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/
  const arabic = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/
  const devanagari = /[\u0900-\u097f]/
  const thai = /[\u0e00-\u0e7f]/
  const cyrillic = /[\u0400-\u04ff]/
  const hangul = /[\uac00-\ud7af\u1100-\u11ff]/
  const hiragana = /[\u3040-\u309f]/
  const emoji = /[\u{1f300}-\u{1f9ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/u

  if (hangul.test(text)) return { lang: 'ko', label: 'Korean', family: 'cjk' }
  if (hiragana.test(text)) return { lang: 'ja', label: 'Japanese', family: 'cjk' }
  if (cjk.test(text)) return { lang: 'zh', label: 'Chinese', family: 'cjk' }
  if (arabic.test(text)) return { lang: 'ar', label: 'Arabic', family: 'arabic' }
  if (devanagari.test(text)) return { lang: 'hi', label: 'Hindi', family: 'indic' }
  if (thai.test(text)) return { lang: 'th', label: 'Thai', family: 'thai-sea' }
  if (cyrillic.test(text)) return { lang: 'ru', label: 'Russian', family: 'european' }
  if (emoji.test(text)) return { lang: 'emoji', label: 'Emoji', family: 'emoji' }
  return { lang: 'en', label: 'Custom', family: 'european' }
}

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------

function initCanvas(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function spawnParticles(cx: number, cy: number, color: [number, number, number], count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 1 + Math.random() * 3
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      maxLife: 0.6 + Math.random() * 0.6,
      r: color[0],
      g: color[1],
      b: color[2],
      size: 2 + Math.random() * 3,
    })
  }
}

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!
    p.x += p.vx * dt * 60
    p.y += p.vy * dt * 60
    p.vy += 0.02
    p.life -= dt / p.maxLife
    if (p.life <= 0) {
      particles.splice(i, 1)
    }
  }
}

function drawParticles(): void {
  for (const p of particles) {
    const alpha = Math.max(0, p.life) * 0.8
    ctx.globalAlpha = alpha
    ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ---------------------------------------------------------------------------
// Background drawing
// ---------------------------------------------------------------------------

function drawBackground(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  ctx.clearRect(0, 0, w, h)

  for (const bubble of bubbles) {
    const color = familyColors[bubble.phrase.family]
    const intensity = bubble.active ? 0.15 : 0.03
    const radius = bubble.active ? 120 : 60
    const bcx = bubble.x + bubble.width / 2
    const bcy = bubble.y + bubble.height / 2
    const gradient = ctx.createRadialGradient(bcx, bcy, 0, bcx, bcy, radius)
    gradient.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${intensity})`)
    gradient.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(bcx - radius, bcy - radius, radius * 2, radius * 2)
  }

  ctx.lineWidth = 1
  for (let i = 0; i < bubbles.length; i++) {
    for (let j = i + 1; j < bubbles.length; j++) {
      const a = bubbles[i]!
      const b = bubbles[j]!
      const dx = (a.x + a.width / 2) - (b.x + b.width / 2)
      const dy = (a.y + a.height / 2) - (b.y + b.height / 2)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 200) {
        const alpha = 0.06 * (1 - dist / 200)
        const sameFamily = a.phrase.family === b.phrase.family
        const color = sameFamily ? familyColors[a.phrase.family] : [176, 138, 255] as [number, number, number]
        ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${sameFamily ? alpha * 2 : alpha})`
        ctx.beginPath()
        ctx.moveTo(a.x + a.width / 2, a.y + a.height / 2)
        ctx.lineTo(b.x + b.width / 2, b.y + b.height / 2)
        ctx.stroke()
      }
    }
  }

  drawParticles()
}

// ---------------------------------------------------------------------------
// Bubble creation & measurement
// ---------------------------------------------------------------------------

function createBubbleElement(phrase: Phrase): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'bubble'
  el.dataset['family'] = phrase.family

  const langLabel = document.createElement('span')
  langLabel.className = 'lang-label'
  langLabel.textContent = phrase.label

  const textSpan = document.createElement('span')
  textSpan.className = 'text'
  textSpan.textContent = phrase.text
  textSpan.style.font = phrase.font

  const meta = document.createElement('span')
  meta.className = 'meta'

  el.appendChild(langLabel)
  el.appendChild(textSpan)
  el.appendChild(meta)

  return el
}

function measureBubble(bubble: Bubble, maxWidth: number): void {
  const lineHeight = 21
  const metrics = layout(bubble.prepared, maxWidth, lineHeight)
  bubble.lineCount = metrics.lineCount
  bubble.height = metrics.height + 38

  let widestLine = 0
  walkLineRanges(bubble.preparedRich, maxWidth, line => {
    if (line.width > widestLine) widestLine = line.width
  })
  bubble.tightWidth = Math.ceil(widestLine) + 32
  bubble.width = bubble.tightWidth
}

function makeBubble(phrase: Phrase, x: number, y: number): Bubble {
  const prepared = prepare(phrase.text, phrase.font)
  const preparedRich = prepareWithSegments(phrase.text, phrase.font)
  const el = createBubbleElement(phrase)

  const bubble: Bubble = {
    phrase,
    prepared,
    preparedRich,
    x,
    y,
    vx: (Math.random() - 0.5) * 0.6,
    vy: (Math.random() - 0.5) * 0.6,
    width: 200,
    height: 50,
    tightWidth: 200,
    lineCount: 1,
    el,
    active: false,
    orbitAngle: Math.random() * Math.PI * 2,
    orbitRadius: 100 + Math.random() * 200,
    animating: false,
    animWidth: 280,
    animDir: -1,
    animStartTime: 0,
  }

  measureBubble(bubble, 280)
  return bubble
}

function initBubbles(): void {
  const w = window.innerWidth
  const h = window.innerHeight

  for (const phrase of phrases) {
    const bubble = makeBubble(phrase, Math.random() * (w - 200), Math.random() * (h - 60))
    scene.appendChild(bubble.el)
    bubbles.push(bubble)
  }

  bubbleCountEl.textContent = String(bubbles.length)
}

// ---------------------------------------------------------------------------
// Width animation (feature 2)
// ---------------------------------------------------------------------------

const ANIM_DURATION = 2.4
const ANIM_MIN_WIDTH = 60
const ANIM_MAX_WIDTH = 320

function startWidthAnimation(bubble: Bubble, now: number): void {
  bubble.animating = true
  bubble.animStartTime = now
  bubble.animDir = -1
  bubble.animWidth = bubble.tightWidth
  bubble.el.classList.add('animating')
}

function stopWidthAnimation(bubble: Bubble): void {
  bubble.animating = false
  bubble.el.classList.remove('animating')
  measureBubble(bubble, 280)
  const textEl = bubble.el.querySelector('.text') as HTMLSpanElement
  textEl.style.width = ''
}

function tickWidthAnimation(bubble: Bubble, now: number): void {
  const elapsed = now - bubble.animStartTime
  const t = (elapsed % ANIM_DURATION) / ANIM_DURATION
  const ping = t < 0.5 ? t * 2 : 2 - t * 2
  const eased = ping * ping * (3 - 2 * ping)

  const prevLineCount = bubble.lineCount
  const animW = ANIM_MIN_WIDTH + (ANIM_MAX_WIDTH - ANIM_MIN_WIDTH) * eased
  bubble.animWidth = animW

  const lineHeight = 21
  const metrics = layout(bubble.prepared, animW, lineHeight)
  bubble.lineCount = metrics.lineCount
  bubble.height = metrics.height + 38

  let widestLine = 0
  walkLineRanges(bubble.preparedRich, animW, line => {
    if (line.width > widestLine) widestLine = line.width
  })
  bubble.width = Math.ceil(widestLine) + 32

  const textEl = bubble.el.querySelector('.text') as HTMLSpanElement
  textEl.style.width = `${Math.ceil(animW)}px`

  if (prevLineCount !== bubble.lineCount) {
    const color = familyColors[bubble.phrase.family]
    spawnParticles(
      bubble.x + bubble.width / 2,
      bubble.y + bubble.height / 2,
      color,
      12,
    )
  }

  updateMetaText(bubble)
}

// ---------------------------------------------------------------------------
// Meta text
// ---------------------------------------------------------------------------

function updateMetaText(bubble: Bubble): void {
  const meta = bubble.el.querySelector('.meta') as HTMLSpanElement
  if (meta !== null) {
    const w = bubble.animating ? Math.round(bubble.animWidth) : bubble.width
    meta.textContent = `${bubble.lineCount} line${bubble.lineCount > 1 ? 's' : ''} · w:${w} h:${Math.round(bubble.height)}px · ${bubble.phrase.label}`
  }
}

// ---------------------------------------------------------------------------
// Physics modes
// ---------------------------------------------------------------------------

function updatePhysicsFloat(bubble: Bubble, dt: number, w: number, h: number): void {
  const cx = bubble.x + bubble.width / 2
  const cy = bubble.y + bubble.height / 2
  const dx = cx - mouseX
  const dy = cy - mouseY
  const distSq = dx * dx + dy * dy
  const repelRadius = 120

  if (distSq < repelRadius * repelRadius && distSq > 0.01) {
    const dist = Math.sqrt(distSq)
    const force = (1 - dist / repelRadius) * 0.3
    bubble.vx += (dx / dist) * force
    bubble.vy += (dy / dist) * force
  }

  bubble.x += bubble.vx * dt * 60
  bubble.y += bubble.vy * dt * 60
  bubble.vx *= 0.998
  bubble.vy *= 0.998

  const speed = Math.sqrt(bubble.vx * bubble.vx + bubble.vy * bubble.vy)
  if (speed < 0.1) {
    bubble.vx += (Math.random() - 0.5) * 0.04
    bubble.vy += (Math.random() - 0.5) * 0.04
  }

  bounceEdges(bubble, w, h)
}

function updatePhysicsOrbit(_bubble: Bubble, dt: number, w: number, h: number, index: number): void {
  const centerX = w / 2
  const centerY = h / 2
  _bubble.orbitAngle += dt * (0.15 + index * 0.005)
  const targetX = centerX + Math.cos(_bubble.orbitAngle) * _bubble.orbitRadius - _bubble.width / 2
  const targetY = centerY + Math.sin(_bubble.orbitAngle) * _bubble.orbitRadius * 0.6 - _bubble.height / 2
  _bubble.x += (targetX - _bubble.x) * 0.03
  _bubble.y += (targetY - _bubble.y) * 0.03
  _bubble.vx = 0
  _bubble.vy = 0
}

function updatePhysicsGravity(bubble: Bubble, dt: number, w: number, h: number): void {
  bubble.vy += 2 * dt

  const cx = bubble.x + bubble.width / 2
  const cy = bubble.y + bubble.height / 2
  const dx = cx - mouseX
  const dy = cy - mouseY
  const distSq = dx * dx + dy * dy
  const repelRadius = 150
  if (distSq < repelRadius * repelRadius && distSq > 0.01) {
    const dist = Math.sqrt(distSq)
    const force = (1 - dist / repelRadius) * 0.8
    bubble.vx += (dx / dist) * force
    bubble.vy += (dy / dist) * force
  }

  bubble.x += bubble.vx * dt * 60
  bubble.y += bubble.vy * dt * 60
  bubble.vx *= 0.98

  if (bubble.y + bubble.height > h) {
    bubble.y = h - bubble.height
    bubble.vy = -Math.abs(bubble.vy) * 0.5
    if (Math.abs(bubble.vy) < 0.3) bubble.vy = 0
  }

  bounceEdges(bubble, w, h)
}

function bounceEdges(bubble: Bubble, w: number, h: number): void {
  if (bubble.x < 0) { bubble.x = 0; bubble.vx = Math.abs(bubble.vx) * 0.8 }
  if (bubble.y < 0) { bubble.y = 0; bubble.vy = Math.abs(bubble.vy) * 0.8 }
  if (bubble.x + bubble.width > w) { bubble.x = w - bubble.width; bubble.vx = -Math.abs(bubble.vx) * 0.8 }
  if (bubble.y + bubble.height > h) { bubble.y = h - bubble.height; bubble.vy = -Math.abs(bubble.vy) * 0.8 }
}

function handleBubbleCollisions(): void {
  for (let i = 0; i < bubbles.length; i++) {
    const a = bubbles[i]!
    const acx = a.x + a.width / 2
    const acy = a.y + a.height / 2
    for (let j = i + 1; j < bubbles.length; j++) {
      const b = bubbles[j]!
      const dx = acx - (b.x + b.width / 2)
      const dy = acy - (b.y + b.height / 2)
      const minDist = (a.width + b.width) / 2 * 0.6
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < minDist && dist > 0.01) {
        const push = (1 - dist / minDist) * 0.05
        const nx = dx / dist
        const ny = dy / dist
        a.vx += nx * push
        a.vy += ny * push
        b.vx -= nx * push
        b.vy -= ny * push
      }
    }
  }
}

function updatePhysics(dt: number): void {
  const w = window.innerWidth
  const h = window.innerHeight

  for (let i = 0; i < bubbles.length; i++) {
    const bubble = bubbles[i]!
    switch (physicsMode) {
      case 'float': updatePhysicsFloat(bubble, dt, w, h); break
      case 'orbit': updatePhysicsOrbit(bubble, dt, w, h, i); break
      case 'gravity': updatePhysicsGravity(bubble, dt, w, h); break
    }
  }

  if (physicsMode !== 'orbit') handleBubbleCollisions()
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderBubbles(): void {
  for (const bubble of bubbles) {
    const scale = bubble.active ? 1.08 : 1
    bubble.el.style.transform = `translate(${Math.round(bubble.x)}px, ${Math.round(bubble.y)}px) scale(${scale})`
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function animate(now: number): void {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05)
  lastFrameTime = now
  globalTime = now

  frameCount++
  if (now - lastFpsUpdate >= 1000) {
    displayFps = frameCount
    frameCount = 0
    lastFpsUpdate = now
    fpsCounterEl.textContent = String(displayFps)
  }

  for (const bubble of bubbles) {
    if (bubble.animating) tickWidthAnimation(bubble, now / 1000)
  }

  updatePhysics(dt)
  updateParticles(dt)
  renderBubbles()
  drawBackground()
  requestAnimationFrame(animate)
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------

const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-btn'))
for (const btn of modeButtons) {
  btn.addEventListener('click', () => {
    const mode = btn.dataset['mode'] as PhysicsMode | undefined
    if (mode === undefined) return
    physicsMode = mode
    for (const b of modeButtons) b.classList.remove('selected')
    btn.classList.add('selected')

    if (mode === 'gravity') {
      for (const bubble of bubbles) {
        bubble.vy = -1 - Math.random() * 2
      }
    }
  })
}

// ---------------------------------------------------------------------------
// User input (feature 3)
// ---------------------------------------------------------------------------

function addUserBubble(text: string): void {
  const trimmed = text.trim()
  if (trimmed.length === 0) return

  const detected = detectScript(trimmed)
  const phrase: Phrase = {
    lang: detected.lang,
    label: detected.label,
    text: trimmed,
    font: defaultFont,
    family: detected.family,
  }

  const w = window.innerWidth
  const h = window.innerHeight
  const bubble = makeBubble(phrase, w / 2 - 100, h * 0.6)
  bubble.vy = -2 - Math.random()
  bubble.vx = (Math.random() - 0.5) * 2

  scene.appendChild(bubble.el)
  bubbles.push(bubble)
  bubbleCountEl.textContent = String(bubbles.length)

  const color = familyColors[phrase.family]
  spawnParticles(bubble.x + bubble.width / 2, bubble.y + bubble.height / 2, color, 20)
}

userInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    addUserBubble(userInput.value)
    userInput.value = ''
  }
})

addBtn.addEventListener('click', () => {
  addUserBubble(userInput.value)
  userInput.value = ''
  userInput.focus()
})

// ---------------------------------------------------------------------------
// Click handling — width animation toggle
// ---------------------------------------------------------------------------

scene.addEventListener('mousemove', event => {
  mouseX = event.clientX
  mouseY = event.clientY
})

scene.addEventListener('mouseleave', () => {
  mouseX = -1000
  mouseY = -1000
})

scene.addEventListener('click', event => {
  const target = event.target as Element
  const bubbleEl = target.closest('.bubble') as HTMLDivElement | null
  if (bubbleEl === null) {
    if (activeBubble !== null) {
      if (activeBubble.animating) stopWidthAnimation(activeBubble)
      activeBubble.el.classList.remove('active')
      activeBubble.active = false
      activeBubble = null
    }
    return
  }

  for (const bubble of bubbles) {
    if (bubble.el === bubbleEl) {
      if (activeBubble !== null && activeBubble !== bubble) {
        if (activeBubble.animating) stopWidthAnimation(activeBubble)
        activeBubble.el.classList.remove('active')
        activeBubble.active = false
      }
      if (bubble.active) {
        if (bubble.animating) stopWidthAnimation(bubble)
        bubble.el.classList.remove('active')
        bubble.active = false
        activeBubble = null
      } else {
        bubble.el.classList.add('active')
        bubble.active = true
        activeBubble = bubble
        startWidthAnimation(bubble, globalTime / 1000)
        updateMetaText(bubble)
        const color = familyColors[bubble.phrase.family]
        spawnParticles(bubble.x + bubble.width / 2, bubble.y + bubble.height / 2, color, 16)
      }
      break
    }
  }
})

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  initCanvas()
})

document.fonts.ready.then(() => {
  initCanvas()
  initBubbles()
  requestAnimationFrame(animate)
})
