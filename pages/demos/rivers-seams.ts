// Prototype: a picture drawn by rivers alone. The page holds two plain paragraphs, the sky
// and the sea, wrapped by the browser with every word space at its natural width. The
// words are chosen so that on each line a space sits where a seam of the picture crosses
// it: the rays, the island's flanks, the sun's path on the water. The horizon is the gap
// between the two paragraphs.
//
// The text is a chain of short sentences, a subject then a predicate, each drawn from a
// pool. Pretext gives every word's width, so a line is a sum of known widths and the
// solver can search the pool for the chain whose spaces land on the seams.

import { layoutWithLines, prepareWithSegments } from '../../src/layout.ts'

const params = new URLSearchParams(location.search)
// Verdana's full stop and word space are both wide, so a sentence's end leaves a gap
// about two thirds of the line height: rivers of them read at a glance.
const FONT_FAMILY = params.get('font') ?? 'Verdana'
const FONT_SIZE = Number(params.get('size') ?? 10)
const LINE_HEIGHT = Number(params.get('lh') ?? FONT_SIZE + 1)
const FONT = `${params.get('weight') ?? 400} ${FONT_SIZE}px ${FONT_FAMILY}`
const INK = '#1d1c1a'

const MAX_SCENE_WIDTH = 960
const SCENE_STEP = 80 // the scene's width moves in these steps, since each width is solved anew
const SCENE_ASPECT = 0.62
const SEAM_Y = 0.55 // where in a line's height a seam is taken to cross it
const MIN_SEPARATION = 30 // px; two seams closer than this on one line can't both get a space

const SUBJECT = 0
const PREDICATE = 1
const SUBJECTS = [
  'The tide', 'A gull', 'The island', 'The far shore', 'Morning', 'The sea', 'Salt wind', 'The lighthouse',
  'A white sail', 'The horizon', 'Light', 'The old harbor', 'A cormorant', 'The reef', 'Each wave', 'The sun',
  'The water', 'A fishing boat', 'The cliff', 'Foam', 'The long swell', 'A heron', 'The bay', 'Kelp',
  'The channel', 'A bell buoy', 'The headland', 'Mist', 'The current', 'A single cloud', 'The whole coast',
  'Sea fog', 'The rock', 'A low wind', 'The pier', 'Daybreak', 'The lagoon', 'A seal', 'The breakwater', 'Spray',
  'The anchor chain', 'A tern', 'The open ocean', 'Dawn', 'The shoal', 'An oar', 'The gray water', 'Nothing',
  'Everything', 'The air', 'A far bell', 'The mooring', 'One star', 'The wet sand', 'A wake', 'The strait',
]
const PREDICATES = [
  'turns.', 'waits for the light.', 'drifts east.', 'holds its breath.', 'rises out of the dark.',
  'keeps to the north.', 'leans into the wind.', 'comes in slowly.', 'shines.', 'goes quiet.',
  'breaks over the stones.', 'remembers the night.', 'climbs the sky.', 'moves without a sound.',
  'is older than the charts.', 'rests on the water.', 'opens like a hand.', 'follows the shore.',
  'glitters and is gone.', 'wakes.', 'pulls at the rope.', 'answers the bell.', 'lies flat and silver.',
  'stands alone.', 'returns with the tide.', 'gathers along the rocks.', 'is nearly gold now.',
  'sinks and lifts again.', 'listens.', 'crosses the bar at dawn.', 'runs clear to the bottom.',
  'has no edge today.', 'burns off by noon.', 'carries the smell of rain.', 'slides under the keel.',
  'circles once and settles.', 'looks back at the land.', 'fades into the glare.', 'trembles in the heat.',
  'points toward home.', 'falls away to the south.', 'begins again.', 'says nothing at all.', 'grows warm.',
  'sleeps in the shallows.', 'bends where the river meets it.', 'catches fire for a moment.', 'lets go.',
  'is still.', 'will not hurry.', 'has been here all night.', 'slips past.', 'takes the color of tin.',
  'draws a line and erases it.', 'is where it was.', 'stays.',
]

type Fragment = { kind: number, words: string[], widths: number[] }
type SolvedRow = { words: string[], xs: number[], widths: number[] }
type Seams = { sky: number[][], sea: number[][], path: string }
type Scene = {
  width: number
  skyText: string
  seaText: string
  path: string
  stats: string
}

// Solver costs. A seam costs nothing when a sentence's end sits on it, since the full stop
// and the space after it make the widest natural gap.
const BIN = 0.25 // px; one chain is kept per stretch of this width a sentence can start in
const EDGE = 1 // px; a word that ends this close to the line's edge could wrap either way, so no chain uses one
const TOLERANCE = 0.5 // px a space's center may miss a seam by, for a cost of 1
const MISS = 30 // cost of a seam that lands on a word
const INTERNAL = 1.5 // cost of meeting a seam with a space inside a sentence
const RAG = 0.004 // cost per px squared of the white a line leaves at its end
const LAST_RAG = 0.02 // the same, for a paragraph's last line

const fragments: Fragment[] = []
const fragmentsOfKind: number[][] = [[], []]
let spaceWidth = 0
addFragments(SUBJECTS, SUBJECT)
addFragments(PREDICATES, PREDICATE)

function addFragments(texts: string[], kind: number): void {
  for (let t = 0; t < texts.length; t++) {
    const prepared = prepareWithSegments(texts[t]!, FONT)
    const words: string[] = []
    const widths: number[] = []
    let word = ''
    let width = 0
    for (let i = 0; i <= prepared.segments.length; i++) {
      if (i < prepared.segments.length && prepared.kinds[i] !== 'space') {
        word += prepared.segments[i]!
        width += prepared.widths[i]!
        continue
      }
      if (i < prepared.segments.length) spaceWidth = prepared.widths[i]!
      if (word !== '') {
        words.push(word)
        widths.push(width)
      }
      word = ''
      width = 0
    }
    fragmentsOfKind[kind]!.push(fragments.length)
    fragments.push({ kind, words, widths })
  }
}

function lowbias32(n: number): number {
  n = Math.imul((n >>> 16) ^ n, 0x21f0aaad)
  n = Math.imul((n >>> 15) ^ n, 0xd35a2d97)
  return (n >>> 15) ^ n
}

function hash3(a: number, b: number, c: number): number {
  return (lowbias32(lowbias32(lowbias32(a) ^ b) ^ c) >>> 0) / 0x100000000
}

function hitCost(miss: number): number {
  const scaled = miss / TOLERANCE
  return Math.min(MISS, scaled * scaled)
}

// What the seams crossing a word, or the space after it, cost. Each such seam is met by
// the nearer of the spaces on the word's two sides. A word that ends its line has the
// line's remaining white after it, which meets any seam.
function wordCost(
  seams: number[],
  x: number,
  width: number,
  hasSpaceBefore: boolean,
  stopBefore: boolean,
  stopAfter: boolean,
  endsLine: boolean,
): number {
  const end = x + width
  let cost = 0
  for (let i = 0; i < seams.length; i++) {
    const seam = seams[i]!
    if (seam < x) continue
    if (seam >= end + spaceWidth) break
    let best = endsLine
      ? hitCost(Math.max(0, end - seam))
      : hitCost(Math.abs(seam - (end + spaceWidth / 2))) + (stopAfter ? 0 : INTERNAL)
    if (hasSpaceBefore) {
      best = Math.min(best, hitCost(seam - (x - spaceWidth / 2)) + (stopBefore ? 0 : INTERNAL))
    }
    cost += best
  }
  return cost
}

// Picks one paragraph's sentences, a line at a time. `seams[r]` holds where the seams
// cross line r. A line's chains are searched from left to right: a state is where the
// next sentence part starts and which kind it is, and the cheapest chain to each state is
// kept. The line ends at the first word that doesn't fit, as the browser's wrapping ends
// it, and the rest of that sentence opens the next line, so the cost of a chain's last
// part counts the next line's seams too.
function solveParagraph(seams: number[][], width: number, seed: number): SolvedRow[] {
  const binCount = Math.ceil((width + spaceWidth + EDGE) / BIN) + 2
  const cost = new Float64Array(binCount * 2)
  const startX = new Float64Array(binCount * 2)
  const lineEndGain = new Float64Array(binCount * 2) // what the state's last word saves if it ends the line
  const backState = new Int32Array(binCount * 2)
  const backFragment = new Int32Array(binCount * 2)
  const lastUsedRow = new Int32Array(fragments.length).fill(-100)
  const repeatCost = new Float64Array(fragments.length)
  const noSeams: number[] = []
  const rows: SolvedRow[] = []
  let prefixWords: string[] = []
  let prefixWidths: number[] = []
  let kindAfterPrefix = SUBJECT

  for (let r = 0; r < seams.length; r++) {
    const rowSeams = seams[r]!
    const nextSeams = r + 1 < seams.length ? seams[r + 1]! : noSeams
    const isLast = r === seams.length - 1
    for (let f = 0; f < fragments.length; f++) {
      const since = r - lastUsedRow[f]!
      repeatCost[f] = since <= 1 ? 4 : since <= 3 ? 1.5 : since <= 6 ? 0.4 : 0
    }

    const row: SolvedRow = { words: prefixWords, xs: [], widths: prefixWidths }
    let x = 0
    for (let k = 0; k < prefixWidths.length; k++) {
      row.xs.push(x)
      x += prefixWidths[k]! + spaceWidth
    }
    cost.fill(Infinity)
    const firstState = Math.floor(x / BIN) * 2 + kindAfterPrefix
    cost[firstState] = 0
    startX[firstState] = x
    lineEndGain[firstState] = 0
    backState[firstState] = -1

    let bestCost = Infinity
    let bestState = -1
    let bestFragment = -1
    let bestPlaced = 0
    // A sentence part moves a chain right by more than a bin, so one pass in order is enough.
    for (let state = firstState; state < binCount * 2; state++) {
      const stateCost = cost[state]!
      if (stateCost === Infinity) continue
      const kind = state & 1
      const x0 = startX[state]!
      if (isLast && kind === SUBJECT && x0 > 0) {
        const white = width - (x0 - spaceWidth)
        const total = stateCost - lineEndGain[state]! + LAST_RAG * white * white
        if (total < bestCost) {
          bestCost = total
          bestState = state
          bestFragment = -1
        }
      }
      // The part of this kind the chain used last, two steps back: "Kelp turns. Kelp shines." reads badly.
      const before = backState[state]!
      const justUsed = before !== -1 && backState[before]! !== -1 ? backFragment[before]! : -1
      const candidates = fragmentsOfKind[kind]!
      for (let c = 0; c < candidates.length; c++) {
        const f = candidates[c]!
        const widths = fragments[f]!.widths
        const count = widths.length
        let total = stateCost + repeatCost[f]! + (f === justUsed ? 4 : 0) + hash3(seed + r, state, f) * 0.02
        let at = x0
        let placed = 0
        let lastCost = 0
        let ambiguous = false
        for (; placed < count; placed++) {
          const wordWidth = widths[placed]!
          if (at + wordWidth > width - EDGE) {
            ambiguous = at + wordWidth <= width + EDGE
            break
          }
          lastCost = wordCost(rowSeams, at, wordWidth, at > 0, placed === 0 && kind === SUBJECT, placed === count - 1 && kind === PREDICATE, false)
          total += lastCost
          at += wordWidth + spaceWidth
        }
        if (ambiguous) continue

        if (placed === count) {
          const next = Math.floor(at / BIN) * 2 + (1 - kind)
          if (total >= cost[next]!) continue
          const lastWidth = widths[count - 1]!
          const lastAt = at - spaceWidth - lastWidth
          cost[next] = total
          startX[next] = at
          lineEndGain[next] = lastCost - wordCost(rowSeams, lastAt, lastWidth, lastAt > 0, count === 1 && kind === SUBJECT, kind === PREDICATE, true)
          backState[next] = state
          backFragment[next] = f
          continue
        }
        if (isLast) continue

        // The line ends inside this part, or just before it.
        if (placed === 0) total -= lineEndGain[state]!
        else {
          const lastWidth = widths[placed - 1]!
          const lastAt = at - spaceWidth - lastWidth
          total += wordCost(rowSeams, lastAt, lastWidth, lastAt > 0, placed === 1 && kind === SUBJECT, false, true) - lastCost
        }
        const white = width - (at - spaceWidth)
        total += RAG * white * white
        let nextAt = 0
        for (let k = placed; k < count; k++) {
          total += wordCost(nextSeams, nextAt, widths[k]!, nextAt > 0, false, k === count - 1 && kind === PREDICATE, false)
          nextAt += widths[k]! + spaceWidth
        }
        if (total < bestCost) {
          bestCost = total
          bestState = state
          bestFragment = f
          bestPlaced = placed
        }
      }
    }

    // Walk the best chain back to the line's start, then lay its words out.
    const chain: number[] = []
    if (bestState === -1) bestState = firstState // no chain fits; the line keeps what it opened with
    for (let state = bestState; backState[state]! !== -1; state = backState[state]!) chain.push(backFragment[state]!)
    x = startX[firstState]!
    for (let c = chain.length - 1; c >= 0; c--) {
      const fragment = fragments[chain[c]!]!
      lastUsedRow[chain[c]!] = r
      for (let k = 0; k < fragment.words.length; k++) {
        row.words.push(fragment.words[k]!)
        row.xs.push(x)
        row.widths.push(fragment.widths[k]!)
        x += fragment.widths[k]! + spaceWidth
      }
    }
    prefixWords = []
    prefixWidths = []
    if (bestFragment !== -1) {
      const fragment = fragments[bestFragment]!
      lastUsedRow[bestFragment] = r
      for (let k = 0; k < fragment.words.length; k++) {
        if (k >= bestPlaced) {
          prefixWords.push(fragment.words[k]!)
          prefixWidths.push(fragment.widths[k]!)
          continue
        }
        row.words.push(fragment.words[k]!)
        row.xs.push(x)
        row.widths.push(fragment.widths[k]!)
        x += fragment.widths[k]! + spaceWidth
      }
      kindAfterPrefix = 1 - fragment.kind
    }
    rows.push(row)
  }
  return rows
}

// Where each seam crosses each line. The sun sits on the horizon; rays fan up from it,
// the island's two flanks meet at its peak, and under the horizon run the sun's path and
// the island's reflection.
function buildSeams(width: number, rowCount: number, horizonRow: number): Seams {
  const sky: number[][] = []
  const sea: number[][] = []
  for (let r = 0; r < horizonRow; r++) sky.push([])
  for (let r = horizonRow + 1; r < rowCount; r++) sea.push([])
  let path = ''
  const horizonY = (horizonRow + 0.5) * LINE_HEIGHT
  const sunX = width * 0.63
  const peakX = width * 0.2
  const islandHeight = horizonY * 0.64
  const leftSlope = Math.tan((24 * Math.PI) / 180)
  const rightSlope = Math.tan((20 * Math.PI) / 180)

  // Adds one seam, a point per line it crosses, skipping a line where an earlier seam is too near.
  function addSeam(xAt: (y: number) => number | null): void {
    let drawing = false
    for (let r = 0; r < rowCount; r++) {
      if (r === horizonRow) {
        drawing = false
        continue
      }
      const y = (r + SEAM_Y) * LINE_HEIGHT
      const x = xAt(y)
      const list = r < horizonRow ? sky[r]! : sea[r - horizonRow - 1]!
      let free = x !== null && x > 8 && x < width - 8
      for (let i = 0; free && i < list.length; i++) free = Math.abs(list[i]! - x!) >= MIN_SEPARATION
      if (!free) {
        drawing = false
        continue
      }
      list.push(x!)
      path += `${drawing ? 'L' : 'M'}${x!.toFixed(1)} ${y.toFixed(1)}`
      drawing = true
    }
  }

  const peakY = horizonY - islandHeight
  // Near the peak the flanks are too close for two spaces, so one seam runs down the middle.
  addSeam(y => {
    const below = y - peakY
    if (y > horizonY || below < 0 || below * (leftSlope + rightSlope) >= MIN_SEPARATION) return null
    return peakX + (below * (rightSlope - leftSlope)) / 2
  })
  addSeam(y => (y > peakY && y < horizonY ? peakX - (y - peakY) * leftSlope : null))
  addSeam(y => (y > peakY && y < horizonY ? peakX + (y - peakY) * rightSlope : null))
  // The island's reflection closes to a point under the horizon.
  const reflection = islandHeight * 0.6
  addSeam(y => (y > horizonY && y < horizonY + reflection ? peakX - (horizonY + reflection - y) * leftSlope : null))
  addSeam(y => (y > horizonY && y < horizonY + reflection ? peakX + (horizonY + reflection - y) * rightSlope : null))

  // Rays, the long ones first so the short ones give way near the sun.
  const rayAngles = [0, 24, -24, 48, -48, 12, -12, 36, -36]
  for (let i = 0; i < rayAngles.length; i++) {
    const angle = (rayAngles[i]! * Math.PI) / 180
    const reach = horizonY * (i < 5 ? 0.24 : 0.5)
    addSeam(y => {
      const up = horizonY - y
      if (up / Math.cos(angle) < reach) return null
      const x = sunX + up * Math.tan(angle)
      // A ray stops behind the island.
      const below = y - peakY
      if (below > 0 && x > peakX - below * leftSlope - 12 && x < peakX + below * rightSlope + 12) return null
      return x
    })
  }

  // The sun's path on the water: one line straight down, two shorter beside it.
  addSeam(y => (y > horizonY ? sunX : null))
  addSeam(y => (y > horizonY + LINE_HEIGHT * 2 && y < horizonY + LINE_HEIGHT * 8 ? sunX - 38 - (y - horizonY) * 0.08 : null))
  addSeam(y => (y > horizonY + LINE_HEIGHT * 4 && y < horizonY + LINE_HEIGHT * 11 ? sunX + 36 + (y - horizonY) * 0.08 : null))

  for (let r = 0; r < sky.length; r++) sky[r]!.sort((a, b) => a - b)
  for (let r = 0; r < sea.length; r++) sea[r]!.sort((a, b) => a - b)
  return { sky, sea, path }
}

function joinRows(rows: SolvedRow[]): string {
  let text = ''
  for (let r = 0; r < rows.length; r++) {
    for (let k = 0; k < rows[r]!.words.length; k++) text += (text === '' ? '' : ' ') + rows[r]!.words[k]!
  }
  return text
}

// Whether Pretext wraps the finished paragraph into the lines the solver planned.
function wrapsAsPlanned(text: string, rows: SolvedRow[], width: number): boolean {
  const lines = layoutWithLines(prepareWithSegments(text, FONT), width, LINE_HEIGHT).lines
  if (lines.length !== rows.length) return false
  for (let r = 0; r < rows.length; r++) {
    if (lines[r]!.text.trim() !== rows[r]!.words.join(' ')) return false
  }
  return true
}

// Counts the seam crossings a space meets within `within` px of its center.
function countMet(rows: SolvedRow[], seams: number[][], within: number): number {
  let met = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const lineEnd = row.xs[row.xs.length - 1]! + row.widths[row.widths.length - 1]!
    for (let i = 0; i < seams[r]!.length; i++) {
      const seam = seams[r]![i]!
      let miss = seam >= lineEnd ? 0 : Infinity
      for (let k = 1; k < row.xs.length; k++) miss = Math.min(miss, Math.abs(seam - (row.xs[k]! - spaceWidth / 2)))
      if (miss <= within) met++
    }
  }
  return met
}

function buildScene(width: number): Scene {
  const start = performance.now()
  const rowCount = Math.round((width * SCENE_ASPECT) / LINE_HEIGHT)
  const horizonRow = Math.round(rowCount * 0.62)
  const seams = buildSeams(width, rowCount, horizonRow)
  const skyRows = solveParagraph(seams.sky, width, 1)
  const seaRows = solveParagraph(seams.sea, width, 1000)
  const skyText = joinRows(skyRows)
  const seaText = joinRows(seaRows)
  const solveMs = performance.now() - start

  let crossings = 0
  for (let r = 0; r < seams.sky.length; r++) crossings += seams.sky[r]!.length
  for (let r = 0; r < seams.sea.length; r++) crossings += seams.sea[r]!.length
  const exact = countMet(skyRows, seams.sky, TOLERANCE) + countMet(seaRows, seams.sea, TOLERANCE)
  const inSpace = countMet(skyRows, seams.sky, spaceWidth / 2) + countMet(seaRows, seams.sea, spaceWidth / 2)
  const planned = wrapsAsPlanned(skyText, skyRows, width) && wrapsAsPlanned(seaText, seaRows, width)
  const stats =
    `${rowCount - 1} lines of ${FONT} · ${crossings} seam crossings: ${exact} within ${TOLERANCE}px of a space's center, ` +
    `${inSpace} inside a space · solved in ${Math.round(solveMs)} ms · ` +
    (planned ? 'Pretext wraps both paragraphs into the planned lines' : 'Pretext wraps the paragraphs differently from the plan')
  return { width, skyText, seaText, path: seams.path, stats }
}

const sceneNode = document.getElementById('scene') as HTMLDivElement
const skyNode = document.getElementById('sky') as HTMLParagraphElement
const seaNode = document.getElementById('sea') as HTMLParagraphElement
const seamsNode = document.getElementById('seams') as unknown as SVGSVGElement
const seamPathNode = document.getElementById('seam-path') as unknown as SVGPathElement
const seamsButton = document.getElementById('seams-button') as HTMLButtonElement
const statsNode = document.getElementById('stats') as HTMLSpanElement

const st = {
  seamsShown: params.get('seams') === '1',
  events: { click: null as MouseEvent | null },
}
let scene: Scene | null = null

let scheduledRaf: number | null = null
function scheduleRender(): void {
  if (scheduledRaf !== null) return
  scheduledRaf = requestAnimationFrame(function renderAndMaybeScheduleAnotherRender() {
    scheduledRaf = null
    render()
  })
}

window.addEventListener('resize', () => scheduleRender())
window.addEventListener('click', event => {
  st.events.click = event
  scheduleRender()
})

function render(): void {
  // DOM reads
  const viewportWidth = document.documentElement.clientWidth

  // Inputs
  let seamsShown = st.seamsShown
  const click = st.events.click
  if (click !== null && click.target instanceof HTMLElement && click.target.dataset['action'] === 'seams') seamsShown = !seamsShown

  // Layout
  const fitting = Math.floor((viewportWidth - 40) / SCENE_STEP) * SCENE_STEP
  const width = Math.max(SCENE_STEP * 4, Math.min(MAX_SCENE_WIDTH, fitting))
  const sceneChanged = scene === null || scene.width !== width
  if (scene === null || scene.width !== width) scene = buildScene(width)

  // Commit
  st.seamsShown = seamsShown
  st.events.click = null

  // DOM writes
  if (sceneChanged) {
    sceneNode.style.width = `${width}px`
    for (const node of [skyNode, seaNode]) {
      node.style.font = FONT
      node.style.lineHeight = `${LINE_HEIGHT}px`
      node.style.color = INK
    }
    seaNode.style.marginTop = `${LINE_HEIGHT}px`
    skyNode.textContent = scene.skyText
    seaNode.textContent = scene.seaText
    seamPathNode.setAttribute('d', scene.path)
    seamPathNode.style.strokeWidth = `${spaceWidth}px`
    statsNode.textContent = scene.stats
  }
  seamsNode.style.display = seamsShown ? 'block' : 'none'
  seamsButton.textContent = seamsShown ? 'Hide seams' : 'Show seams'
}

scheduleRender()
