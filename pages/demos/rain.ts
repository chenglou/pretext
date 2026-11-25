// Prototype: rain drawn by rivers alone. The page holds one plain paragraph, wrapped by
// the browser with every word space at its natural width. Its lines are chosen so that
// spaces line up, row under row, into slanted streaks.
//
// The text is a litany: the parts of a rain poem, which can come in any order. Pretext
// gives every word's width, so a row is a sum of known widths, and the solver searches
// the pool for the order whose spaces land on the streaks.

import { layoutWithLines, prepareWithSegments } from '../../src/layout.ts'

const params = new URLSearchParams(location.search)
// Verdana's full stop and word space are both wide, so a sentence's end leaves a gap
// about two thirds of the line height: rivers of them read at a glance.
const FONT_FAMILY = params.get('font') ?? 'Verdana'
const FONT_SIZE = Number(params.get('size') ?? 10)
const LINE_HEIGHT = Number(params.get('lh') ?? FONT_SIZE + 1)
const FONT = `${params.get('weight') ?? 400} ${FONT_SIZE}px ${FONT_FAMILY}`
const INK = '#20262a'

const MAX_SCENE_WIDTH = 960
const SCENE_STEP = 80 // the scene's width moves in these steps, since each width is solved anew
const SCENE_ASPECT = 0.62
const SEAM_Y = 0.55 // where in a row's height a streak is taken to cross it

// The rain. Every streak leans the same way, so two on one row keep their distance.
const SLANT = Math.tan(((Number(params.get('slant') ?? 10)) * Math.PI) / 180) // px a streak moves left per px it falls
const TRACK_GAP = Number(params.get('gap') ?? 84) // px between the lines streaks fall along
const TRACK_JITTER = 12 // px a line may sit off its even place, either way
const STREAK_ROWS = [6, 16] // a streak's length in rows, from and up to
const PAUSE_ROWS = [2, 7] // the rows between two streaks on one line
// A row opens with the words the row above had no room for, so the solver can't place a
// space near its left edge; no streak comes within this many px of it.
const LEFT_CLEAR = 96
const RIGHT_CLEAR = 24

const OPENER = 'It is raining.'
const CLOSER = 'on this page' // after "Rain", or after a comma
const ON = [
  'the tin roof', 'the plum tree', 'the bicycle left in the yard', 'the river, which has no use for it', 'the ferry',
  "the nine o'clock ferry", 'the church steps', 'the market awnings', 'your shoulders', 'the back of your hand',
  'the windshield', 'the dog, who does not mind', 'the laundry nobody brought in', 'the garden chairs', 'the tomatoes',
  "the neighbor's ladder", 'the road to the coast', 'the names on the war memorial', 'the schoolyard', 'the last bus',
  'the cranes at the harbor', 'the slate', 'the skylight', 'the telephone wires', 'the crows on the wires',
  'the sea, as if it needed more', 'the chalk drawings', "the newspaper over someone's head", 'the umbrellas',
  'the black umbrellas', 'the canal', 'the lock gates', 'the towpath', 'the allotments', 'the cabbages',
  'the greenhouse glass', 'the unfinished house', 'the scaffolding', "the statue's bronze hat", 'the pigeons',
  'the fountain, which keeps going anyway', 'the café tables', 'the folded chairs', 'the tram lines', 'the cobbles',
  'the bridge', 'both sides of the bridge', 'the heron', 'the reeds', 'the rowboats turned over for winter',
  'the tennis court', 'the empty pool', 'the swings', 'the old graves', 'the hayfield', 'the cut hay', 'the sheep',
  'the stone wall', 'the gate', 'the letterbox', 'the letter in your pocket', 'the map', 'the trailhead', 'the tent',
  'the cold fire ring', 'the pines', 'the birches', 'the ferns', 'the moss', 'the mountain, somewhere in the cloud',
  'the pass', 'the border post', 'the train window', 'the tracks', 'the freight yard', 'the platform', 'the suitcase',
  'the wedding', 'the funeral', 'the parade', 'the flags', 'the stadium', 'the motorway', 'the tollbooth',
  'the truck stop', 'the diner sign', 'the motel pool', 'the cornfields', 'the silo', 'the water tower',
  'the dry riverbed', 'the desert, briefly', 'the salt flats', 'the dunes', 'the tide pools', 'the lighthouse',
  'the pier', 'the nets', 'the gulls', 'the deck', 'the windowsill', 'the glass', 'this window', 'the roof again',
  'the porch light', 'the open book', 'the hospital car park', 'the night shift going home', 'the bakery at four',
  'the first tram', 'the fig tree', 'the vines', 'the terraces', 'the well', 'the quarry', 'the kiln',
  'the lake, ring after ring', 'the jetty', 'the oars', 'the far bank', 'the weir', 'the mill', 'the orchard',
  'the windfalls', 'the beehives', 'the wheat', 'the scarecrow', 'the crossroads', 'the shrine', 'the bell',
]
const IN = [
  'the gutters', 'the downspout', 'the rain barrel', 'the collar of your coat', 'your shoes', 'your hair',
  'the streetlight', 'the headlights', 'the tire tracks', 'the potholes', 'the birdbath', 'the wheelbarrow',
  "the dog's bowl", 'the footprints', 'the furrows', 'the trees', 'the forecast', 'the mountains', 'the next valley',
  'the night', 'the afternoon', 'the small hours', 'the song on the radio', 'the old stories', 'the mind',
]
const ALONE = [
  'All night.', 'All morning.', 'Listen.', 'Still raining.', 'And again.', 'Rain.', 'More rain.', 'It keeps on.',
  'No wind.', 'Nobody minds.', 'Somebody sleeps.', 'A door closes.', 'Then harder.', 'Then less.', 'Soft now.',
  'Steady.', 'It does not stop.', 'Count the seconds.', 'Thunder, far off.', 'Here too.', 'Everywhere.',
  'Nowhere to be.', 'Stay in.', 'Let it.', 'Hours of it.', 'So.', 'Yes.', 'Hush.',
]

// A sentence part in one of its forms: its words as set, and their widths.
type Form = { words: string[], widths: number[] }
type SolvedRow = { words: string[], xs: number[], widths: number[] }
type Scene = { width: number, text: string, path: string, pathWidth: number, stats: string }

// Solver costs. A streak costs nothing on a row where a sentence's end sits on it, since
// the full stop and the space after it make the widest natural gap. Between streaks the
// litany runs on with commas, so the wide gaps are the streaks' alone.
const BIN = Number(params.get('bin') ?? 0.5) // px; one chain is kept per stretch of this width a part can start in
const EDGE = 1 // px; a word that ends this close to the row's edge could wrap either way, so no chain uses one
const TOLERANCE = 0.5 // px a space's center may miss a streak by, for a cost of 1
const MISS = 30 // cost of a streak that lands on a word
const INTERNAL = 2 // cost of meeting a streak with a space inside a part
const COMMA_HIT = 1 // cost of meeting a streak with the space after a part's comma
const OFF_STOP = 2 // cost of a sentence's end that sits on no streak: a wide gap where the picture has none
const OFF_STOP_REACH = 1 // px from a streak within which a sentence's end counts as on it
const ALONE_COST = 2 // cost of a sentence from ALONE; they are short, so a chain would lean on them
const RAG = 0.004 // cost per px squared of the white a row leaves at its end
const LAST_RAG = 0.02 // the same, for the paragraph's last row

// A part opens a sentence ("Rain on the tin roof") or carries one on ("on the tin roof"),
// and ends it with a full stop or hands it on with a comma. How a part ends is how the
// next one opens, so the two share their numbers.
const OPENS = 0 // 1 carries a sentence on
const STOP = 0 // 1 hands the sentence on with a comma
const GAP_COST = [0, COMMA_HIT] // what meeting a streak costs after a STOP and after a COMMA

let spaceWidth = 0
const unitCount = ON.length + IN.length + ALONE.length
const forms: (Form | null)[] = [] // a unit's four forms at [unit * 4 + opening * 2 + ending]; null where it has none
for (let i = 0; i < ON.length; i++) addForms(`on ${ON[i]!}`)
for (let i = 0; i < IN.length; i++) addForms(`in ${IN[i]!}`)
for (let i = 0; i < ALONE.length; i++) forms.push(measure(ALONE[i]!), null, null, null)
const opener = measure(OPENER)
const closers = [measure(`Rain ${CLOSER}.`), measure(`${CLOSER}.`)] // by how the sentence before left off
const SET_WORDS = Math.ceil(unitCount / 32) // 32-bit words in a set of units

function addForms(body: string): void {
  forms.push(measure(`Rain ${body}.`), measure(`Rain ${body},`), measure(`${body}.`), measure(`${body},`))
}

function measure(text: string): Form {
  const prepared = prepareWithSegments(text, FONT)
  const form: Form = { words: [], widths: [] }
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
      form.words.push(word)
      form.widths.push(width)
    }
    word = ''
    width = 0
  }
  return form
}

function lowbias32(n: number): number {
  n = Math.imul((n >>> 16) ^ n, 0x21f0aaad)
  n = Math.imul((n >>> 15) ^ n, 0xd35a2d97)
  return (n >>> 15) ^ n
}

function hash2(a: number, b: number): number {
  return (lowbias32(lowbias32(a) ^ b) >>> 0) / 0x100000000
}

function hash3(a: number, b: number, c: number): number {
  return (lowbias32(lowbias32(lowbias32(a) ^ b) ^ c) >>> 0) / 0x100000000
}

function hitCost(miss: number): number {
  const scaled = miss / TOLERANCE
  return Math.min(MISS, scaled * scaled)
}

// What the streaks crossing a word, or the space after it, cost. Each such streak is met
// by the nearer of the spaces on the word's two sides, at that space's own cost. A word
// that ends its row has the row's remaining white after it, which meets any streak.
function wordCost(
  seams: number[],
  x: number,
  width: number,
  hasSpaceBefore: boolean,
  beforeCost: number,
  afterCost: number,
  endsRow: boolean,
): number {
  const end = x + width
  let cost = 0
  for (let i = 0; i < seams.length; i++) {
    const seam = seams[i]!
    if (seam < x) continue
    if (seam >= end + spaceWidth) break
    let best = endsRow ? hitCost(Math.max(0, end - seam)) : hitCost(Math.abs(seam - (end + spaceWidth / 2))) + afterCost
    if (hasSpaceBefore) best = Math.min(best, hitCost(seam - (x - spaceWidth / 2)) + beforeCost)
    cost += best
  }
  return cost
}

function offStreakCost(seams: number[], stopCenter: number): number {
  for (let i = 0; i < seams.length; i++) {
    if (Math.abs(seams[i]! - stopCenter) <= OFF_STOP_REACH) return 0
  }
  return OFF_STOP
}

// Picks the paragraph's parts, a row at a time. `seams[r]` holds where the streaks cross
// row r. A row's chains are searched from left to right: a state is where the next part
// starts and whether it opens a sentence, and the cheapest chain to each state is kept,
// with the set of units it holds so none comes twice in a row. The row ends at the first
// word that doesn't fit, as the browser's wrapping ends it, and the rest of that part
// opens the next row, so the cost of a chain's last part counts the next row's streaks too.
function solve(seams: number[][], width: number): SolvedRow[] {
  const stateCount = (Math.ceil((width + spaceWidth + EDGE) / BIN) + 2) * 2
  const cost = new Float64Array(stateCount)
  const startX = new Float64Array(stateCount)
  const rowEndGain = new Float64Array(stateCount) // what the state's last word saves if it ends the row
  const backState = new Int32Array(stateCount)
  const backForm = new Int32Array(stateCount)
  const held = new Uint32Array(stateCount * SET_WORDS)
  const lastUsedRow = new Int32Array(unitCount).fill(-100)
  const unitCost = new Float64Array(unitCount)
  const noSeams: number[] = []
  const rows: SolvedRow[] = []
  let prefixWords = opener.words.slice()
  let prefixWidths = opener.widths.slice()
  let prefixUnit = -1
  let openingAfterPrefix = OPENS

  for (let r = 0; r < seams.length; r++) {
    const rowSeams = seams[r]!
    const nextSeams = r + 1 < seams.length ? seams[r + 1]! : noSeams
    const isLast = r === seams.length - 1
    for (let u = 0; u < unitCount; u++) {
      const since = r - lastUsedRow[u]!
      unitCost[u] = (since <= 3 ? 8 : since <= 8 ? 2 : since <= 14 ? 0.5 : 0) + (u >= ON.length + IN.length ? ALONE_COST : 0)
    }

    const row: SolvedRow = { words: prefixWords, xs: [], widths: prefixWidths }
    let x = 0
    for (let k = 0; k < prefixWidths.length; k++) {
      row.xs.push(x)
      x += prefixWidths[k]! + spaceWidth
    }
    cost.fill(Infinity)
    const firstState = Math.floor(x / BIN) * 2 + openingAfterPrefix
    cost[firstState] = 0
    startX[firstState] = x
    rowEndGain[firstState] = 0
    backState[firstState] = -1
    for (let w = 0; w < SET_WORDS; w++) held[firstState * SET_WORDS + w] = 0
    if (prefixUnit !== -1) held[firstState * SET_WORDS + (prefixUnit >>> 5)] = 1 << (prefixUnit & 31)

    let bestCost = Infinity
    let bestState = -1
    let bestForm: Form | null = null
    let bestFormIndex = -1
    let bestPlaced = 0
    // A part moves a chain right by more than a bin, so one pass in order is enough.
    for (let state = firstState; state < stateCount; state++) {
      const stateCost = cost[state]!
      if (stateCost === Infinity) continue
      const opening = state & 1
      const x0 = startX[state]!

      if (isLast) {
        // The paragraph ends with the closing words, whole.
        const closer = closers[opening]!
        let total = stateCost
        let at = x0
        let fits = true
        for (let k = 0; fits && k < closer.widths.length; k++) {
          const wordWidth = closer.widths[k]!
          fits = at + wordWidth <= width - EDGE
          total += wordCost(rowSeams, at, wordWidth, at > 0, k === 0 ? GAP_COST[opening]! : INTERNAL, 0, k === closer.widths.length - 1)
          at += wordWidth + spaceWidth
        }
        const white = width - (at - spaceWidth)
        total += LAST_RAG * white * white
        if (fits && total < bestCost) {
          bestCost = total
          bestState = state
          bestForm = closer
          bestFormIndex = -1
          bestPlaced = closer.widths.length
        }
      }

      for (let u = 0; u < unitCount; u++) {
        if ((held[state * SET_WORDS + (u >>> 5)]! & (1 << (u & 31))) !== 0) continue
        for (let ending = 0; ending < 2; ending++) {
          const formIndex = u * 4 + opening * 2 + ending
          const form = forms[formIndex] ?? null
          if (form === null) continue
          const widths = form.widths
          const count = widths.length
          let total = stateCost + unitCost[u]! + hash3(r, state, formIndex) * 0.02
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
            lastCost = wordCost(
              rowSeams, at, wordWidth, at > 0,
              placed === 0 ? GAP_COST[opening]! : INTERNAL,
              placed === count - 1 ? GAP_COST[ending]! : INTERNAL,
              false,
            )
            total += lastCost
            at += wordWidth + spaceWidth
          }
          if (ambiguous) continue

          if (placed === count) {
            const next = Math.floor(at / BIN) * 2 + ending
            const offStreak = ending === STOP ? offStreakCost(rowSeams, at - spaceWidth / 2) : 0
            total += offStreak
            if (total >= cost[next]!) continue
            const lastWidth = widths[count - 1]!
            const lastAt = at - spaceWidth - lastWidth
            const lastBefore = count === 1 ? GAP_COST[opening]! : INTERNAL
            cost[next] = total
            startX[next] = at
            rowEndGain[next] = offStreak + lastCost - wordCost(rowSeams, lastAt, lastWidth, lastAt > 0, lastBefore, 0, true)
            backState[next] = state
            backForm[next] = formIndex
            for (let w = 0; w < SET_WORDS; w++) held[next * SET_WORDS + w] = held[state * SET_WORDS + w]!
            held[next * SET_WORDS + (u >>> 5)]! |= 1 << (u & 31)
            continue
          }
          if (isLast) continue

          // The row ends inside this part, or just before it.
          if (placed === 0) total -= rowEndGain[state]!
          else {
            const lastWidth = widths[placed - 1]!
            const lastAt = at - spaceWidth - lastWidth
            const lastBefore = placed === 1 ? GAP_COST[opening]! : INTERNAL
            total += wordCost(rowSeams, lastAt, lastWidth, lastAt > 0, lastBefore, 0, true) - lastCost
          }
          const white = width - (at - spaceWidth)
          total += RAG * white * white
          let nextAt = 0
          for (let k = placed; k < count; k++) {
            total += wordCost(nextSeams, nextAt, widths[k]!, nextAt > 0, INTERNAL, k === count - 1 ? GAP_COST[ending]! : INTERNAL, false)
            nextAt += widths[k]! + spaceWidth
          }
          if (ending === STOP) total += offStreakCost(nextSeams, nextAt - spaceWidth / 2)
          if (total < bestCost) {
            bestCost = total
            bestState = state
            bestForm = form
            bestFormIndex = formIndex
            bestPlaced = placed
          }
        }
      }
    }

    // Walk the best chain back to the row's start, then lay its words out.
    const chain: number[] = []
    if (bestState === -1) bestState = firstState // no chain fits; the row keeps what it opened with
    for (let state = bestState; backState[state]! !== -1; state = backState[state]!) chain.push(backForm[state]!)
    x = startX[firstState]!
    for (let c = chain.length - 1; c >= 0; c--) {
      const form = forms[chain[c]!]!
      lastUsedRow[chain[c]! >> 2] = r
      for (let k = 0; k < form.words.length; k++) {
        row.words.push(form.words[k]!)
        row.xs.push(x)
        row.widths.push(form.widths[k]!)
        x += form.widths[k]! + spaceWidth
      }
    }
    prefixWords = []
    prefixWidths = []
    prefixUnit = -1
    if (bestForm !== null) {
      if (bestFormIndex !== -1) {
        lastUsedRow[bestFormIndex >> 2] = r
        prefixUnit = bestFormIndex >> 2
        openingAfterPrefix = bestFormIndex & 1
      }
      for (let k = 0; k < bestForm.words.length; k++) {
        if (k >= bestPlaced) {
          prefixWords.push(bestForm.words[k]!)
          prefixWidths.push(bestForm.widths[k]!)
          continue
        }
        row.words.push(bestForm.words[k]!)
        row.xs.push(x)
        row.widths.push(bestForm.widths[k]!)
        x += bestForm.widths[k]! + spaceWidth
      }
    }
    rows.push(row)
  }
  return rows
}

// Where each streak crosses each row. Streaks fall along evenly spread parallel lines,
// each line a run of streaks and pauses.
function buildRain(width: number, rowCount: number): { seams: number[][], path: string } {
  const seams: number[][] = []
  for (let r = 0; r < rowCount; r++) seams.push([])
  let path = ''
  const height = rowCount * LINE_HEIGHT
  const trackCount = Math.ceil((width + height * SLANT) / TRACK_GAP)
  for (let track = 0; track < trackCount; track++) {
    const top = (track + 0.5) * TRACK_GAP + (hash2(track, 1) * 2 - 1) * TRACK_JITTER // the line's x at the scene's top
    let row = -Math.floor(hash2(track, 2) * (STREAK_ROWS[1]! + PAUSE_ROWS[1]!))
    for (let streak = 0; row < rowCount; streak++) {
      const length = STREAK_ROWS[0]! + Math.floor(hash3(track, streak, 3) * (STREAK_ROWS[1]! - STREAK_ROWS[0]! + 1))
      let drawing = false
      let lastX = 0
      let lastY = 0
      for (let r = Math.max(0, row); r < Math.min(rowCount, row + length); r++) {
        const y = (r + SEAM_Y) * LINE_HEIGHT
        const x = top - y * SLANT
        if (x < LEFT_CLEAR || x > width - RIGHT_CLEAR) continue
        seams[r]!.push(x)
        if (!drawing) path += `M${x.toFixed(1)} ${y.toFixed(1)}`
        drawing = true
        lastX = x
        lastY = y
      }
      if (drawing) path += `L${lastX.toFixed(1)} ${lastY.toFixed(1)}`
      row += length + PAUSE_ROWS[0]! + Math.floor(hash3(track, streak, 4) * (PAUSE_ROWS[1]! - PAUSE_ROWS[0]! + 1))
    }
  }
  for (let r = 0; r < rowCount; r++) seams[r]!.sort((a, b) => a - b)
  return { seams, path }
}

// Counts the streak crossings a space meets within `within` px of its center.
function countMet(rows: SolvedRow[], seams: number[][], within: number): number {
  let met = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const rowEnd = row.xs[row.xs.length - 1]! + row.widths[row.widths.length - 1]!
    for (let i = 0; i < seams[r]!.length; i++) {
      const seam = seams[r]![i]!
      let miss = seam >= rowEnd ? 0 : Infinity
      for (let k = 1; k < row.xs.length; k++) miss = Math.min(miss, Math.abs(seam - (row.xs[k]! - spaceWidth / 2)))
      if (miss <= within) met++
    }
  }
  return met
}

function buildScene(width: number): Scene {
  const start = performance.now()
  const rowCount = Math.round((width * SCENE_ASPECT) / LINE_HEIGHT)
  const rain = buildRain(width, rowCount)
  const rows = solve(rain.seams, width)
  let text = ''
  for (let r = 0; r < rows.length; r++) {
    for (let k = 0; k < rows[r]!.words.length; k++) text += (text === '' ? '' : ' ') + rows[r]!.words[k]!
  }
  const solveMs = performance.now() - start

  // Whether Pretext wraps the finished paragraph into the rows the solver planned.
  const lines = layoutWithLines(prepareWithSegments(text, FONT), width, LINE_HEIGHT).lines
  let planned = lines.length === rows.length
  for (let r = 0; planned && r < rows.length; r++) planned = lines[r]!.text.trim() === rows[r]!.words.join(' ')

  let crossings = 0
  for (let r = 0; r < rain.seams.length; r++) crossings += rain.seams[r]!.length
  const stats =
    `${rowCount} lines of ${FONT} · ${crossings} streak crossings: ${countMet(rows, rain.seams, TOLERANCE)} within ` +
    `${TOLERANCE}px of a space's center, ${countMet(rows, rain.seams, spaceWidth / 2)} inside a space · ` +
    `solved in ${Math.round(solveMs)} ms · ` +
    (planned ? 'Pretext wraps the paragraph into the planned lines' : 'Pretext wraps the paragraph differently from the plan')
  return { width, text, path: rain.path, pathWidth: spaceWidth, stats }
}

const sceneNode = document.getElementById('scene') as HTMLDivElement
const textNode = document.getElementById('text') as HTMLParagraphElement
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
    textNode.style.font = FONT
    textNode.style.lineHeight = `${LINE_HEIGHT}px`
    textNode.style.color = INK
    textNode.textContent = scene.text
    seamPathNode.setAttribute('d', scene.path)
    seamPathNode.style.strokeWidth = `${scene.pathWidth}px`
    statsNode.textContent = scene.stats
  }
  seamsNode.style.display = seamsShown ? 'block' : 'none'
  seamsButton.textContent = seamsShown ? 'Hide streaks' : 'Show streaks'
}

scheduleRender()
