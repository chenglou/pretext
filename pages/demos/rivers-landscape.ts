// Prototype: a landscape drawn with typographic faults. The sun is a hole in the sky's
// text, each ray is a river (word spaces lined up across lines), and the hills are text
// set to a silhouette, so a summit is a line of one word. Every line is cut into cells
// by the rays and each cell is a small justified line, laid out again every frame.

import {
  layoutNextLineRange,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'

const FONT_SIZE = 10
const LINE_HEIGHT = 12
const BASELINE = 9
const FONT_FAMILY = 'Georgia, "Times New Roman", serif'
const SKY_FONT = `400 ${FONT_SIZE}px ${FONT_FAMILY}`
const FAR_FONT = `700 ${FONT_SIZE}px ${FONT_FAMILY}`
const NEAR_FONT = `700 ${FONT_SIZE}px ${FONT_FAMILY}`
const PAPER = '#f3ede2'
const FAR_COLOR = '#55784f'
const NEAR_COLOR = '#1b2118'

const MAX_SCENE_WIDTH = 960
const SCENE_ASPECT = 0.6
const MIN_CELL = [56, 20, 20] // px for each region; a narrower cell stays paper
// A cell's spare width goes to its word spaces up to MAX_STRETCH px each, then between
// letters up to MAX_TRACK px each, then to the spaces again.
const MAX_STRETCH = 1.5
const MAX_TRACK = 0.6
const RAY_GLOW = 30 // px from a ray's edge within which sky words turn gold
const RAY_COUNT = 8
const RAY_TURN = 0.035 // radians per second
const RAY_GAPS = [2.4, 5, 10, 15] // px at full strength
const RAY_GAP_LABELS = ['1 space', '½ em', '1 em', '1½ em']

const SKY = 0
const FAR = 1
const NEAR = 2
const NONE = 3
const REGION_PAD = [4, 2, 0]

const SKY_TEXT = repeat(
  'Light comes over the ridge before the sun does. It arrives as a thin gold seam along the far edge of the world, then loosens, and the whole sky begins to fill the way a room fills when a door is opened somewhere down the hall. Nothing in it hurries. The high air is cold and very clear, and each ray that crosses it is a straight road with no one on it yet. Swallows turn in the brightness and are lost and found again. A single cloud drifts east, lit from below, the color of the inside of a shell. By the time the first warmth reaches the valley the stars have gone out one by one, not all at once, like lamps in a town where people are waking. The day is not a thing that starts. It is a thing that was always on its way, and what we call morning is only the hour when we notice. Stand still long enough and the light will find you too, and lay one long bright hand across your shoulders, and move on. ',
  10,
)
const FAR_TEXT = repeat(
  'The far hills keep their own time. Pine and cedar hold the slope in a dark even weave, and under them the old stone waits as it has waited through ten thousand winters. Deer paths thread the ridge. A hawk hangs over the saddle where the wind comes through. Snow lingers in the north hollows long after the meadows have gone green, and the streams that leave it run cold and loud over the rocks, carrying the mountain down to the valley a grain at a time. ',
  8,
)
const NEAR_TEXT = repeat(
  'Here the ground is close and heavy and warm. Grass bends under its own seed. Clover, vetch, wild oat and thistle crowd the slope, and the soil beneath them is black and deep, turned by worms and roots and rain. A stone wall climbs the rise and stops for no reason anyone remembers. Sheep have worn the hillside into shallow steps. Crickets start up in the long shadow of the hedge, and the smell of cut hay drifts over the gate from the field below. ',
  8,
)

function repeat(text: string, times: number): string {
  let out = ''
  for (let i = 0; i < times; i++) out += text
  return out.trimEnd()
}

// Sky words go from slate to gold as they near the sun or a ray.
const SKY_COLORS: string[] = []
for (let i = 0; i < 16; i++) {
  const t = i / 15
  const r = Math.round(92 + (204 - 92) * t)
  const g = Math.round(124 + (136 - 124) * t)
  const b = Math.round(178 + (20 - 178) * t)
  SKY_COLORS.push(`rgb(${r},${g},${b})`)
}

type Run = { region: number, x0: number, x1: number }

// What depends on the scene's size alone.
type Scene = {
  width: number
  height: number
  rowCount: number
  sunX: number
  sunY: number
  sunRadius: number
  rows: Run[][]
  skyRowStarts: Int32Array // where each row's sky text starts when no ray crosses it
}

// `lit` is 1 when the cell's left edge is a ray's, 2 when its right edge is, 3 for both.
type Cells = { row: number[], x0: number[], x1: number[], lit: number[] }

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const playButton = document.getElementById('play') as HTMLButtonElement
const flowButton = document.getElementById('flow') as HTMLButtonElement
const gapButton = document.getElementById('gap') as HTMLButtonElement
const tintButton = document.getElementById('tint') as HTMLButtonElement
const glideButton = document.getElementById('glide') as HTMLButtonElement
const statsNode = document.getElementById('stats') as HTMLSpanElement

const skyPrepared = prepareWithSegments(SKY_TEXT, SKY_FONT)
const farPrepared = prepareWithSegments(FAR_TEXT, FAR_FONT)
const nearPrepared = prepareWithSegments(NEAR_TEXT, NEAR_FONT)

const params = new URLSearchParams(location.search)
const st = {
  playing: !params.has('t'),
  anchored: params.get('flow') !== '1',
  gapIndex: params.has('gap') ? Number(params.get('gap')) : 3,
  tinted: params.get('tint') !== '0',
  gliding: params.get('glide') !== '0',
  sunTime: params.has('t') ? Number(params.get('t')) : 0,
  lastNow: null as number | null,
  frameMs: 0,
  jumpRate: 0, // share of the sky's words that jump per second of turning
  jumpTime: 0, // seconds the rate has been averaged over
  events: { click: null as MouseEvent | null },
}

let scene: Scene | null = null
const cells: Cells[] = [
  { row: [], x0: [], x1: [], lit: [] },
  { row: [], x0: [], x1: [], lit: [] },
  { row: [], x0: [], x1: [], lit: [] },
]
const rayX0: number[] = []
const rayX1: number[] = []

// Where each sky word was painted last, to count the words a frame moves: a word jumps
// when it changes row, moves more than JUMP px along its row, or appears.
const JUMP = 2
const GLIDE_TIME = 0.14 // seconds for a gliding word to cover most of the way to its new place
const skyWordTargetX = new Float32Array(skyPrepared.segments.length)
const skyWordX = new Float32Array(skyPrepared.segments.length)
const skyWordRow = new Int16Array(skyPrepared.segments.length)
const skyWordFrame = new Int32Array(skyPrepared.segments.length)
let frame = 1
let jumped = 0
let glideShare = 1 // how far a word goes this frame toward where the layout puts it; 1 is all the way
let unsettled = false

function farHillTop(u: number, height: number): number {
  return height * (0.76 - 0.2 * bump(u, 0.24, 0.17) - 0.1 * bump(u, 0.84, 0.14))
}

function nearHillTop(u: number, height: number): number {
  return height * (0.93 - 0.12 * bump(u, 0.58, 0.22))
}

function bump(u: number, center: number, spread: number): number {
  const d = (u - center) / spread
  return Math.exp(-d * d)
}

function buildScene(width: number): Scene {
  const rowCount = Math.round((width * SCENE_ASPECT) / LINE_HEIGHT)
  const height = rowCount * LINE_HEIGHT
  const sunX = width * 0.56
  const sunY = height * 0.22
  const sunRadius = width * 0.058
  const holeRadius = sunRadius + 6
  const rows: Run[][] = []
  for (let row = 0; row < rowCount; row++) {
    const top = row * LINE_HEIGHT
    const mid = top + LINE_HEIGHT / 2
    // The row's ink sits between these; the sun's hole is tested against the nearer one.
    const inkY = Math.min(Math.max(sunY, top + 3), top + LINE_HEIGHT - 3)
    const runs: Run[] = []
    let runRegion = NONE
    let runStart = 0
    for (let x = 0; x <= width; x++) {
      let region = NONE
      if (x < width) {
        const u = (x + 0.5) / width
        const dx = x + 0.5 - sunX
        const dy = inkY - sunY
        if (mid > nearHillTop(u, height)) region = NEAR
        else if (mid > farHillTop(u, height)) region = FAR
        else if (dx * dx + dy * dy > holeRadius * holeRadius) region = SKY
      }
      if (region === runRegion) continue
      if (runRegion !== NONE) {
        const pad = REGION_PAD[runRegion]!
        const x0 = runStart === 0 ? 0 : runStart + pad
        const x1 = x === width ? width : x - pad
        if (x1 > x0) runs.push({ region: runRegion, x0, x1 })
      }
      runRegion = region
      runStart = x
    }
    rows.push(runs)
  }

  const built: Scene = { width, height, rowCount, sunX, sunY, sunRadius, rows, skyRowStarts: new Int32Array(rowCount) }
  collectCells(built, 0, 0)
  fillCells(null, skyPrepared, cells[SKY]!, null, built.skyRowStarts, built, false)
  return built
}

// Cuts each sky run where a ray crosses its row; the hills stop the rays. `gap` 0 leaves
// the rays out.
function collectCells(scene: Scene, gap: number, turn: number): void {
  for (let region = 0; region < 3; region++) {
    const list = cells[region]!
    list.row.length = 0
    list.x0.length = 0
    list.x1.length = 0
    list.lit.length = 0
  }
  for (let row = 0; row < scene.rowCount; row++) {
    const dy = row * LINE_HEIGHT + LINE_HEIGHT / 2 - scene.sunY
    rayX0.length = 0
    rayX1.length = 0
    if (gap > 0) {
      for (let ray = 0; ray < RAY_COUNT; ray++) {
        const angle = turn + (ray * 2 * Math.PI) / RAY_COUNT // from straight down
        const cos = Math.cos(angle)
        if (dy * cos <= 0) continue
        const along = dy / cos
        if (along < scene.sunRadius + 4) continue
        // A ray near the horizontal moves too far per row to read as one line, so it thins out.
        const steep = Math.abs(cos)
        const fade = smoothstep(0.38, 0.72, steep)
        const width = gap * fade * (0.75 + (0.5 * along) / scene.height)
        if (width < 1.5) continue
        const x = scene.sunX + dy * Math.tan(angle)
        let at = rayX0.length
        while (at > 0 && rayX0[at - 1]! > x - width / 2) at--
        rayX0.splice(at, 0, x - width / 2)
        rayX1.splice(at, 0, x + width / 2)
      }
    }
    const runs = scene.rows[row]!
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!
      const list = cells[run.region]!
      let x = run.x0
      let lit = 0
      if (run.region === SKY) {
        for (let ray = 0; ray < rayX0.length; ray++) {
          if (rayX1[ray]! <= x) continue
          if (rayX0[ray]! >= run.x1) break
          if (rayX0[ray]! > x) pushCell(list, row, x, rayX0[ray]!, lit | 2)
          x = Math.max(x, rayX1[ray]!)
          lit = 1
        }
      }
      if (x < run.x1) pushCell(list, row, x, run.x1, lit)
    }
  }
}

function pushCell(list: Cells, row: number, x0: number, x1: number, lit: number): void {
  list.row.push(row)
  list.x0.push(x0)
  list.x1.push(x1)
  list.lit.push(lit)
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

// Sets the text into the cells in reading order, each cell justified to both edges.
// With `rowStarts`, every row begins at its own place in the text and drops what the
// rays leave no room for, so a moving ray disturbs only the rows it crosses. With
// `record`, nothing is drawn and each row's start is written down. Returns the words set.
function fillCells(
  target: CanvasRenderingContext2D | null,
  prepared: PreparedTextWithSegments,
  list: Cells,
  rowStarts: Int32Array | null,
  record: Int32Array | null,
  scene: Scene,
  tinted: boolean,
): number {
  const segments = prepared.segments
  const kinds = prepared.kinds
  const widths = prepared.widths
  const minCell = MIN_CELL[prepared === skyPrepared ? SKY : FAR]!
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let prevRow = -1
  let words = 0
  for (let c = 0; c < list.row.length; c++) {
    const row = list.row[c]!
    if (row !== prevRow) {
      prevRow = row
      if (rowStarts !== null) cursor = { segmentIndex: rowStarts[row]!, graphemeIndex: 0 }
      if (record !== null) record[row] = cursor.segmentIndex
    }
    const x0 = list.x0[c]!
    const cellWidth = list.x1[c]! - x0
    if (cellWidth < minCell) continue
    const line = layoutNextLineRange(prepared, cellWidth, cursor)
    if (line === null) break
    // A word wider than the cell would be cut inside; leave the cell empty and keep the word.
    if (line.start.graphemeIndex !== 0 || line.end.graphemeIndex !== 0 || line.width > cellWidth) continue
    cursor = line.end
    let first = line.start.segmentIndex
    let last = line.end.segmentIndex - 1
    while (last >= first && kinds[last] !== 'text') last--
    while (first <= last && kinds[first] !== 'text') first++
    if (last < first) continue
    let gaps = 0
    let letters = 0
    for (let i = first; i <= last; i++) {
      if (kinds[i] === 'space') gaps++
      else letters += segments[i]!.length
    }
    words += gaps + 1
    if (target === null) continue

    const slack = cellWidth - line.width
    let stretch = 0
    let track = Math.min(MAX_TRACK, slack / letters)
    let x = x0
    if (gaps === 0) x += (slack - track * letters) / 2
    else {
      stretch = Math.min(MAX_STRETCH, slack / gaps)
      track = Math.min(MAX_TRACK, (slack - stretch * gaps) / letters)
      stretch = (slack - track * letters) / gaps
    }
    target.letterSpacing = `${track}px`
    const y = row * LINE_HEIGHT + BASELINE
    const lit = list.lit[c]!
    for (let i = first; i <= last; i++) {
      if (kinds[i] === 'space') {
        x += widths[i]! + stretch
        continue
      }
      const width = widths[i]! + track * segments[i]!.length
      if (prepared === skyPrepared) {
        const dx = x + width / 2 - scene.sunX
        const dy = y - scene.sunY
        let glow = 1 - (Math.sqrt(dx * dx + dy * dy) - scene.sunRadius) / (scene.width * 0.16)
        if (!tinted) glow = 0
        else if ((lit & 1) !== 0) glow = Math.max(glow, 0.8 * (1 - (x - x0) / RAY_GLOW))
        if (tinted && (lit & 2) !== 0) glow = Math.max(glow, 0.8 * (1 - (x0 + cellWidth - x - width) / RAY_GLOW))
        target.fillStyle = SKY_COLORS[Math.round(Math.min(1, Math.max(0, glow)) * 15)]!
        const seen = skyWordFrame[i] === frame - 1 && skyWordRow[i] === row
        if (!seen || Math.abs(skyWordTargetX[i]! - x) > JUMP) jumped++
        let paintX = x
        if (seen && glideShare < 1) {
          paintX = skyWordX[i]! + (x - skyWordX[i]!) * glideShare
          if (Math.abs(x - paintX) > 0.25) unsettled = true
        }
        skyWordTargetX[i] = x
        skyWordX[i] = paintX
        skyWordRow[i] = row
        skyWordFrame[i] = frame
        target.fillText(segments[i]!, paintX, y)
        x += width
        continue
      }
      target.fillText(segments[i]!, x, y)
      x += width
    }
  }
  return words
}

let scheduledRaf: number | null = null
function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderAndMaybeScheduleAnotherRender(now) {
    scheduledRaf = null
    if (render(now)) scheduleRender()
  })
}

window.addEventListener('resize', () => scheduleRender())
window.addEventListener('click', event => {
  st.events.click = event
  scheduleRender()
})

function render(now: number): boolean {
  // DOM reads
  const viewportWidth = document.documentElement.clientWidth
  const pixelRatio = window.devicePixelRatio

  // Inputs
  let playing = st.playing
  let anchored = st.anchored
  let gapIndex = st.gapIndex
  let tinted = st.tinted
  let gliding = st.gliding
  const click = st.events.click
  if (click !== null && click.target instanceof HTMLElement) {
    const action = click.target.dataset['action']
    if (action === 'play') playing = !playing
    if (action === 'flow') anchored = !anchored
    if (action === 'gap') gapIndex = (gapIndex + 1) % RAY_GAPS.length
    if (action === 'tint') tinted = !tinted
    if (action === 'glide') gliding = !gliding
  }

  // Animation tick
  let sunTime = st.sunTime
  const elapsed = st.lastNow !== null ? Math.min(100, now - st.lastNow) / 1000 : 0
  const step = playing ? elapsed : 0
  sunTime += step
  glideShare = gliding && elapsed > 0 ? 1 - Math.exp(-elapsed / GLIDE_TIME) : 1
  unsettled = false
  const modeChanged = anchored !== st.anchored || gapIndex !== st.gapIndex

  // Layout
  const width = Math.max(320, Math.min(MAX_SCENE_WIDTH, viewportWidth - 40))
  if (scene === null || scene.width !== width) scene = buildScene(width)
  const layoutStart = performance.now()
  collectCells(scene, RAY_GAPS[gapIndex]!, sunTime * RAY_TURN)
  const cellCount = cells[SKY]!.row.length + cells[FAR]!.row.length + cells[NEAR]!.row.length

  // Commit
  st.playing = playing
  st.anchored = anchored
  st.gapIndex = gapIndex
  st.tinted = tinted
  st.gliding = gliding
  st.sunTime = sunTime
  st.events.click = null

  // DOM writes
  const pixelWidth = Math.round(scene.width * pixelRatio)
  const pixelHeight = Math.round(scene.height * pixelRatio)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.width = `${scene.width}px`
    canvas.style.height = `${scene.height}px`
  }
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, scene.width, scene.height)
  ctx.textBaseline = 'alphabetic'
  ctx.font = SKY_FONT
  jumped = 0
  let words = fillCells(ctx, skyPrepared, cells[SKY]!, anchored ? scene.skyRowStarts : null, null, scene, tinted)
  frame++
  const moving = playing || unsettled
  st.lastNow = moving ? now : null
  if (modeChanged) st.jumpTime = 0
  else if (step > 0) {
    st.jumpRate = (st.jumpRate * st.jumpTime + jumped / words) / (st.jumpTime + step)
    st.jumpTime += step
  }
  ctx.font = FAR_FONT
  ctx.fillStyle = FAR_COLOR
  words += fillCells(ctx, farPrepared, cells[FAR]!, null, null, scene, false)
  ctx.font = NEAR_FONT
  ctx.fillStyle = NEAR_COLOR
  words += fillCells(ctx, nearPrepared, cells[NEAR]!, null, null, scene, false)
  const frameMs = performance.now() - layoutStart
  st.frameMs = st.frameMs === 0 ? frameMs : st.frameMs + (frameMs - st.frameMs) * 0.1

  playButton.textContent = playing ? 'Pause' : 'Play'
  flowButton.textContent = anchored ? 'Rows anchored' : 'Text flows'
  gapButton.textContent = `Ray: ${RAY_GAP_LABELS[gapIndex]!}`
  tintButton.textContent = tinted ? 'Gold tint on' : 'Gold tint off'
  glideButton.textContent = gliding ? 'Words glide' : 'Words snap'
  const jumps = st.jumpTime > 0 ? ` · ${(st.jumpRate * 100).toFixed(0)}% of sky words jump per second` : ''
  statsNode.textContent = `${cellCount} cells · ${words} words · ${st.frameMs.toFixed(1)} ms layout and paint${jumps}`

  return moving
}

scheduleRender()
