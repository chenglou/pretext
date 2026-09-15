import { prepareWithSegments } from '../../src/layout.ts'

const COLS = 50
const ROWS = 28
const FONT_SIZE = 14
const LINE_HEIGHT = 16
const TARGET_ROW_W = 440
const ART_PADDING = 14
const PROP_FAMILY = 'Georgia, Palatino, "Times New Roman", serif'
const FIELD_OVERSAMPLE = 2
const FIELD_COLS = COLS * FIELD_OVERSAMPLE
const FIELD_ROWS = ROWS * FIELD_OVERSAMPLE
const CANVAS_W = 220
const CANVAS_H = Math.round(CANVAS_W * ((ROWS * LINE_HEIGHT) / TARGET_ROW_W))
const FIELD_SCALE_X = FIELD_COLS / CANVAS_W
const FIELD_SCALE_Y = FIELD_ROWS / CANVAS_H
const PARTICLE_N = 120
const SPRITE_R = 14
const ATTRACTOR_R = 12
const LARGE_ATTRACTOR_R = 30
const ATTRACTOR_FORCE_1 = 0.22
const ATTRACTOR_FORCE_2 = 0.05
const FIELD_DECAY = 0.82
const CHARSET = ' .,:;!+-=*#@%&abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const WEIGHTS = [300, 500, 800] as const
const STYLES = ['normal', 'italic'] as const

type FontStyleVariant = typeof STYLES[number]

type PaletteEntry = {
  char: string
  weight: number
  style: FontStyleVariant
  font: string
  width: number
  brightness: number
}

type BrightnessEntry = {
  monoChar: string
  propHtml: string
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
}

type FieldStamp = {
  radiusX: number
  radiusY: number
  sizeX: number
  sizeY: number
  values: Float32Array
}

type RowNodes = {
  monoNode: HTMLDivElement
  propNode: HTMLDivElement
}

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

const brightnessCanvas = document.createElement('canvas')
brightnessCanvas.width = 28
brightnessCanvas.height = 28
const brightnessContext = brightnessCanvas.getContext('2d', { willReadFrequently: true })
if (brightnessContext === null) throw new Error('brightness context not available')
const bCtx = brightnessContext

function estimateBrightness(ch: string, font: string): number {
  const size = 28
  bCtx.clearRect(0, 0, size, size)
  bCtx.font = font
  bCtx.fillStyle = '#fff'
  bCtx.textBaseline = 'middle'
  bCtx.fillText(ch, 1, size / 2)
  const data = bCtx.getImageData(0, 0, size, size).data
  let sum = 0
  for (let index = 3; index < data.length; index += 4) sum += data[index]!
  return sum / (255 * size * size)
}

function measureWidth(ch: string, font: string): number {
  const prepared = prepareWithSegments(ch, font)
  return prepared.widths.length > 0 ? prepared.widths[0]! : 0
}

const palette: PaletteEntry[] = []
for (const style of STYLES) {
  for (const weight of WEIGHTS) {
    const font = `${style === 'italic' ? 'italic ' : ''}${weight} ${FONT_SIZE}px ${PROP_FAMILY}`
    for (const ch of CHARSET) {
      if (ch === ' ') continue
      const width = measureWidth(ch, font)
      if (width <= 0) continue
      const brightness = estimateBrightness(ch, font)
      palette.push({ char: ch, weight, style, font, width, brightness })
    }
  }
}

const maxBrightness = Math.max(...palette.map(entry => entry.brightness))
if (maxBrightness > 0) {
  for (let index = 0; index < palette.length; index++) {
    palette[index]!.brightness /= maxBrightness
  }
}
palette.sort((a, b) => a.brightness - b.brightness)
const targetCellW = TARGET_ROW_W / COLS

function findBest(targetBrightness: number): PaletteEntry {
  let lo = 0
  let hi = palette.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (palette[mid]!.brightness < targetBrightness) lo = mid + 1
    else hi = mid
  }

  let bestScore = Infinity
  let best = palette[lo]!
  const start = Math.max(0, lo - 15)
  const end = Math.min(palette.length, lo + 15)
  for (let index = start; index < end; index++) {
    const entry = palette[index]!
    const brightnessError = Math.abs(entry.brightness - targetBrightness) * 2.5
    const widthError = Math.abs(entry.width - targetCellW) / targetCellW
    const score = brightnessError + widthError
    if (score < bestScore) {
      bestScore = score
      best = entry
    }
  }
  return best
}

const MONO_RAMP = ' .`-_:,;^=+/|)\\!?0oOQ#%@'
const brightnessLookup: BrightnessEntry[] = []
for (let brightnessByte = 0; brightnessByte < 256; brightnessByte++) {
  const brightness = brightnessByte / 255
  const monoChar = MONO_RAMP[Math.min(MONO_RAMP.length - 1, (brightness * MONO_RAMP.length) | 0)]!
  if (brightness < 0.03) {
    brightnessLookup.push({ monoChar, propHtml: ' ' })
    continue
  }

  const match = findBest(brightness)
  const alphaIndex = Math.max(1, Math.min(10, Math.round(brightness * 10)))
  brightnessLookup.push({
    monoChar,
    propHtml: `<span class="${wCls(match.weight, match.style)} a${alphaIndex}">${esc(match.char)}</span>`,
  })
}

const particles: Particle[] = []
for (let index = 0; index < PARTICLE_N; index++) {
  const angle = Math.random() * Math.PI * 2
  const radius = Math.random() * 40 + 20
  particles.push({
    x: CANVAS_W / 2 + Math.cos(angle) * radius,
    y: CANVAS_H / 2 + Math.sin(angle) * radius,
    vx: (Math.random() - 0.5) * 0.8,
    vy: (Math.random() - 0.5) * 0.8,
  })
}

const simulationCanvas = document.createElement('canvas')
simulationCanvas.width = CANVAS_W
simulationCanvas.height = CANVAS_H
simulationCanvas.className = 'source-canvas'
const simulationContext = simulationCanvas.getContext('2d', { willReadFrequently: true })
if (simulationContext === null) throw new Error('simulation context not available')
const sCtx = simulationContext
const brightnessField = new Float32Array(FIELD_COLS * FIELD_ROWS)

const spriteCache = new Map<number, HTMLCanvasElement>()

function getSpriteCanvas(radius: number): HTMLCanvasElement {
  const cached = spriteCache.get(radius)
  if (cached !== undefined) return cached

  const canvas = document.createElement('canvas')
  canvas.width = radius * 2
  canvas.height = radius * 2
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('sprite context not available')
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius)
  gradient.addColorStop(0, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.15)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, radius * 2, radius * 2)
  spriteCache.set(radius, canvas)
  return canvas
}

function spriteAlphaAt(normalizedDistance: number): number {
  if (normalizedDistance >= 1) return 0
  if (normalizedDistance <= 0.35) return 0.45 + (0.15 - 0.45) * (normalizedDistance / 0.35)
  return 0.15 * (1 - (normalizedDistance - 0.35) / 0.65)
}

function createFieldStamp(radiusPx: number): FieldStamp {
  const fieldRadiusX = radiusPx * FIELD_SCALE_X
  const fieldRadiusY = radiusPx * FIELD_SCALE_Y
  const radiusX = Math.ceil(fieldRadiusX)
  const radiusY = Math.ceil(fieldRadiusY)
  const sizeX = radiusX * 2 + 1
  const sizeY = radiusY * 2 + 1
  const values = new Float32Array(sizeX * sizeY)
  for (let y = -radiusY; y <= radiusY; y++) {
    for (let x = -radiusX; x <= radiusX; x++) {
      const normalizedDistance = Math.sqrt((x / fieldRadiusX) ** 2 + (y / fieldRadiusY) ** 2)
      values[(y + radiusY) * sizeX + x + radiusX] = spriteAlphaAt(normalizedDistance)
    }
  }
  return { radiusX, radiusY, sizeX, sizeY, values }
}

function splatFieldStamp(centerX: number, centerY: number, stamp: FieldStamp): void {
  const gridCenterX = Math.round(centerX * FIELD_SCALE_X)
  const gridCenterY = Math.round(centerY * FIELD_SCALE_Y)
  for (let y = -stamp.radiusY; y <= stamp.radiusY; y++) {
    const gridY = gridCenterY + y
    if (gridY < 0 || gridY >= FIELD_ROWS) continue
    const fieldRowOffset = gridY * FIELD_COLS
    const stampRowOffset = (y + stamp.radiusY) * stamp.sizeX
    for (let x = -stamp.radiusX; x <= stamp.radiusX; x++) {
      const gridX = gridCenterX + x
      if (gridX < 0 || gridX >= FIELD_COLS) continue
      const stampValue = stamp.values[stampRowOffset + x + stamp.radiusX]!
      if (stampValue === 0) continue
      const fieldIndex = fieldRowOffset + gridX
      brightnessField[fieldIndex] = Math.min(1, brightnessField[fieldIndex]! + stampValue)
    }
  }
}

const particleFieldStamp = createFieldStamp(SPRITE_R)
const largeAttractorFieldStamp = createFieldStamp(LARGE_ATTRACTOR_R)
const smallAttractorFieldStamp = createFieldStamp(ATTRACTOR_R)

// The art boxes hold rows aimed at TARGET_ROW_W and ROWS * LINE_HEIGHT tall,
// inside ART_PADDING, so the model hands the page those sizes.
const rootStyle = document.documentElement.style
rootStyle.setProperty('--art-width', `${TARGET_ROW_W}px`)
rootStyle.setProperty('--art-height', `${ROWS * LINE_HEIGHT}px`)
rootStyle.setProperty('--art-padding', `${ART_PADDING}px`)

const sourceBox = getRequiredDiv('source-box')
sourceBox.appendChild(simulationCanvas)
const propBox = getRequiredDiv('prop-box')
const monoBox = getRequiredDiv('mono-box')
const rows: RowNodes[] = []
for (let row = 0; row < ROWS; row++) {
  const proportionalRow = document.createElement('div')
  proportionalRow.className = 'art-row'
  proportionalRow.style.height = proportionalRow.style.lineHeight = `${LINE_HEIGHT}px`
  propBox.appendChild(proportionalRow)

  const monoRow = document.createElement('div')
  monoRow.className = 'art-row'
  monoRow.style.height = monoRow.style.lineHeight = `${LINE_HEIGHT}px`
  monoBox.appendChild(monoRow)
  rows.push({
    monoNode: monoRow,
    propNode: proportionalRow,
  })
}

function esc(ch: string): string {
  if (ch === '<') return '&lt;'
  if (ch === '>') return '&gt;'
  if (ch === '&') return '&amp;'
  if (ch === '"') return '&quot;'
  return ch
}

function wCls(weight: number, style: FontStyleVariant): string {
  const weightClass = weight === 300 ? 'w3' : weight === 500 ? 'w5' : 'w8'
  return style === 'italic' ? `${weightClass} it` : weightClass
}

function render(now: number): void {
  const attractor1X = Math.cos(now * 0.0007) * CANVAS_W * 0.25 + CANVAS_W / 2
  const attractor1Y = Math.sin(now * 0.0011) * CANVAS_H * 0.3 + CANVAS_H / 2
  const attractor2X = Math.cos(now * 0.0013 + Math.PI) * CANVAS_W * 0.2 + CANVAS_W / 2
  const attractor2Y = Math.sin(now * 0.0009 + Math.PI) * CANVAS_H * 0.25 + CANVAS_H / 2

  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index]!
    const d1x = attractor1X - particle.x
    const d1y = attractor1Y - particle.y
    const d2x = attractor2X - particle.x
    const d2y = attractor2Y - particle.y
    const dist1 = d1x * d1x + d1y * d1y
    const dist2 = d2x * d2x + d2y * d2y
    const ax = dist1 < dist2 ? d1x : d2x
    const ay = dist1 < dist2 ? d1y : d2y
    const dist = Math.sqrt(Math.min(dist1, dist2)) + 1

    const force = dist1 < dist2 ? ATTRACTOR_FORCE_1 : ATTRACTOR_FORCE_2
    particle.vx += ax / dist * force
    particle.vy += ay / dist * force
    particle.vx += (Math.random() - 0.5) * 0.25
    particle.vy += (Math.random() - 0.5) * 0.25
    particle.vx *= 0.97
    particle.vy *= 0.97
    particle.x += particle.vx
    particle.y += particle.vy

    if (particle.x < -SPRITE_R) particle.x += CANVAS_W + SPRITE_R * 2
    if (particle.x > CANVAS_W + SPRITE_R) particle.x -= CANVAS_W + SPRITE_R * 2
    if (particle.y < -SPRITE_R) particle.y += CANVAS_H + SPRITE_R * 2
    if (particle.y > CANVAS_H + SPRITE_R) particle.y -= CANVAS_H + SPRITE_R * 2
  }

  sCtx.fillStyle = 'rgba(0,0,0,0.18)'
  sCtx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  sCtx.globalCompositeOperation = 'lighter'
  const particleSprite = getSpriteCanvas(SPRITE_R)
  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index]!
    sCtx.drawImage(particleSprite, particle.x - SPRITE_R, particle.y - SPRITE_R)
  }
  sCtx.drawImage(getSpriteCanvas(LARGE_ATTRACTOR_R), attractor1X - LARGE_ATTRACTOR_R, attractor1Y - LARGE_ATTRACTOR_R)
  sCtx.drawImage(getSpriteCanvas(ATTRACTOR_R), attractor2X - ATTRACTOR_R, attractor2Y - ATTRACTOR_R)
  sCtx.globalCompositeOperation = 'source-over'

  for (let index = 0; index < brightnessField.length; index++) {
    brightnessField[index] = brightnessField[index]! * FIELD_DECAY
  }
  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index]!
    splatFieldStamp(particle.x, particle.y, particleFieldStamp)
  }
  splatFieldStamp(attractor1X, attractor1Y, largeAttractorFieldStamp)
  splatFieldStamp(attractor2X, attractor2Y, smallAttractorFieldStamp)

  for (let row = 0; row < ROWS; row++) {
    let propHtml = ''
    let monoText = ''
    const fieldRowStart = row * FIELD_OVERSAMPLE * FIELD_COLS
    for (let col = 0; col < COLS; col++) {
      const fieldColStart = col * FIELD_OVERSAMPLE
      let brightness = 0
      for (let sampleY = 0; sampleY < FIELD_OVERSAMPLE; sampleY++) {
        const sampleRowOffset = fieldRowStart + sampleY * FIELD_COLS + fieldColStart
        for (let sampleX = 0; sampleX < FIELD_OVERSAMPLE; sampleX++) {
          brightness += brightnessField[sampleRowOffset + sampleX]!
        }
      }
      const brightnessByte = Math.min(255, ((brightness / (FIELD_OVERSAMPLE * FIELD_OVERSAMPLE)) * 255) | 0)
      const entry = brightnessLookup[brightnessByte]!
      propHtml += entry.propHtml
      monoText += entry.monoChar
    }
    const rowNodes = rows[row]!
    rowNodes.propNode.innerHTML = propHtml
    rowNodes.monoNode.textContent = monoText
  }

  requestAnimationFrame(render)
}

requestAnimationFrame(render)
