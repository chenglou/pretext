// Prototype: a landscape hatched in rivers. The page holds one plain paragraph, wrapped by
// the browser with every word space at its natural width, and every one of those spaces
// lies on a line of a drawing: rays fanning down from a sun above the page, an island's
// flanks and ridges, the waves of the sea. No outline is drawn. As in an engraving, a
// region shows by the direction of its hatching, so the horizon is where the straight
// rays stop and the wavy lines start.
//
// On each row the drawing's lines cut the width into cells, and one word goes in each
// cell. The text is a chain of short sentences from a small grammar, so each cell has
// many words to choose from; Pretext gives every word's width, and the solver picks the
// chain whose words fill the cells.

import { layoutWithLines, prepareWithSegments } from '../../src/layout.ts'

const params = new URLSearchParams(location.search)
// Verdana's word space is wide, about a third of the line height, so a gap repeated row
// under row reads as a line.
const FONT_FAMILY = params.get('font') ?? 'Verdana'
const FONT_SIZE = Number(params.get('size') ?? 10)
const LINE_HEIGHT = Number(params.get('lh') ?? FONT_SIZE + 1)
const FONT = `${params.get('weight') ?? 400} ${FONT_SIZE}px ${FONT_FAMILY}`
const INK = '#1f1d1a'

const MAX_SCENE_WIDTH = 960
const SCENE_STEP = 80 // the scene's width moves in these steps, since each width is solved anew
const SCENE_ASPECT = 0.62
const SEAM_Y = 0.55 // where in a row's height a line of the drawing is taken to cross it

// The drawing, in px at FONT_SIZE 10 and scaled with it.
const UNIT = FONT_SIZE / 10
const MIN_GAP = 21 * UNIT // two lines closer than this on a row leave no room for a word; the lesser one gives way
const MAX_CELL = 78 * UNIT // a wider cell gets a line of its own down the middle, since few words are that long
const LEFT_CLEAR = 22 * UNIT // room for a row's first word
const RIGHT_CLEAR = 30 * UNIT // room for a row's last word
const RAY_GAP = 25 * UNIT // between two rays on the top row
const ISLAND_GAP = 54 * UNIT // between two hatch lines on an island: wider than the sky's, so the island is darker
const ISLAND_LEAN = 0.45 // px an island's hatch line moves sideways per px down, against the lean of the rays beside it
const WAVE_GAP = 37 * UNIT // between two wave lines far from the sun's path
const WAVE_GAP_LIT = 24 * UNIT // and under the sun, where the water glitters
const WAVE_SWING = 6 * UNIT // how far a wave line swings to each side
const WAVE_ROWS = 7 // rows from one swing to the next
const REFLECTION = 0.6 // an island's reflection is this tall, against the island

// The sentences: "Pale gulls wheel over wet rooftops." and every shorter cut of that
// shape, down to "Rain."; a comma may carry a sentence on into another clause. Any word
// of a kind can stand in any place of that kind, but a subject takes only the verbs of
// its own class, so gulls wheel and tides ebb and no reef walks.
const ADJECTIVES = [
  'wet', 'dim', 'low', 'old', 'red', 'far', 'dry', 'wan', 'pale', 'slow', 'cold', 'gray', 'dark', 'soft', 'calm',
  'bare', 'deep', 'thin', 'tall', 'wide', 'late', 'lone', 'warm', 'blue', 'gold', 'worn', 'wild', 'idle', 'iron',
  'open', 'still', 'quiet', 'heavy', 'empty', 'early', 'faint', 'broad', 'steep', 'sheer', 'smooth', 'rough',
  'bright', 'tired', 'loose', 'amber', 'ashen', 'misty', 'rusty', 'salty', 'sandy', 'stony', 'windy', 'glassy',
  'mossy', 'briny', 'foggy', 'chalky', 'silver', 'golden', 'hollow', 'narrow', 'sunken', 'hidden', 'bitter',
  'gentle', 'copper', 'drowsy', 'tarred', 'brittle', 'tender', 'ancient', 'crooked', 'patient', 'distant',
  'painted', 'tangled', 'immense', 'drifting', 'sleeping', 'restless', 'nameless', 'solitary', 'wordless',
  'enormous', 'luminous', 'weathered', 'forgotten', 'unhurried', 'wandering', 'trembling', 'colorless',
  'flickering', 'glittering', 'shimmering', 'breathless', 'motionless', 'unfinished', 'numberless', 'transparent',
  'innumerable', 'incandescent', 'imperceptible',
]
// Plural nouns by class, and each class's verbs.
const SUBJECTS = [
  ['gulls', 'terns', 'herons', 'crows', 'owls', 'moths', 'swallows', 'sparrows', 'seabirds', 'cormorants'],
  ['seas', 'bays', 'tides', 'waves', 'coves', 'pools', 'swells', 'rivers', 'eddies', 'streams', 'ripples', 'currents',
    'channels', 'shallows', 'breakers', 'tidepools'],
  ['lamps', 'stars', 'fires', 'sparks', 'embers', 'candles', 'beacons', 'windows', 'lanterns', 'lighthouses',
    'reflections', 'constellations'],
  ['oars', 'nets', 'boats', 'sails', 'hulls', 'masts', 'keels', 'ropes', 'bells', 'buoys', 'flags', 'barges',
    'skiffs', 'ferries', 'anchors', 'moorings', 'trawlers'],
  ['roofs', 'hills', 'rocks', 'reefs', 'dunes', 'piers', 'docks', 'walls', 'paths', 'gates', 'cliffs', 'shoals',
    'shells', 'stones', 'fields', 'spires', 'towers', 'islands', 'harbors', 'meadows', 'pebbles', 'jetties',
    'bridges', 'horizons', 'rooftops', 'villages', 'orchards', 'sandbars', 'headlands', 'promontories', 'archipelagos'],
  ['days', 'hours', 'years', 'songs', 'names', 'winds', 'mists', 'nights', 'dreams', 'clouds', 'voices', 'echoes',
    'shadows', 'mornings', 'evenings', 'footprints'],
  ['elms', 'oaks', 'firs', 'pines', 'reeds', 'ferns', 'vines', 'weeds', 'grasses', 'willows'],
  ['crabs', 'seals', 'divers', 'sailors', 'children', 'swimmers', 'fishermen'],
]
const VERBS_FOR = [
  ['dip', 'cry', 'soar', 'dive', 'call', 'turn', 'wait', 'rise', 'fall', 'pass', 'sing', 'wheel', 'glide', 'hover',
    'drift', 'sleep', 'climb', 'circle', 'settle', 'gather', 'return', 'vanish', 'linger', 'wander', 'scatter',
    'descend', 'hesitate', 'disappear'],
  ['ebb', 'run', 'rise', 'fall', 'flow', 'pour', 'turn', 'roll', 'toss', 'sigh', 'hush', 'wait', 'surge', 'swell',
    'break', 'crash', 'spill', 'sleep', 'gleam', 'gather', 'return', 'darken', 'murmur', 'settle', 'unfold',
    'shiver', 'shimmer', 'glitter', 'whisper', 'glisten', 'breathe', 'tremble', 'brighten', 'dissolve'],
  ['dim', 'glow', 'burn', 'fade', 'wake', 'wait', 'sway', 'hang', 'rise', 'fall', 'sink', 'shine', 'gleam', 'flare',
    'blaze', 'drift', 'float', 'hover', 'gather', 'vanish', 'darken', 'linger', 'shiver', 'flicker', 'tremble',
    'shimmer', 'glitter', 'smolder', 'scatter', 'brighten', 'dissolve', 'hesitate', 'disappear'],
  ['dip', 'nod', 'hum', 'sway', 'rock', 'lean', 'wait', 'rest', 'turn', 'toss', 'roll', 'lift', 'pass', 'slip',
    'hang', 'sink', 'rise', 'fall', 'drift', 'float', 'sleep', 'glide', 'slide', 'creak', 'gather', 'return',
    'vanish', 'linger', 'wander', 'darken', 'scatter', 'tremble', 'glisten', 'hesitate'],
  ['lie', 'wait', 'fade', 'rise', 'rest', 'glow', 'lean', 'hush', 'burn', 'wake', 'stand', 'sleep', 'dream', 'gleam',
    'climb', 'kneel', 'darken', 'remain', 'listen', 'vanish', 'linger', 'unfold', 'stretch', 'descend', 'glisten',
    'shimmer', 'smolder', 'tremble', 'breathe', 'dissolve', 'brighten', 'disappear'],
  ['go', 'run', 'pass', 'fade', 'turn', 'rise', 'fall', 'wait', 'hush', 'slip', 'drift', 'sleep', 'slide', 'creep',
    'crawl', 'gather', 'return', 'linger', 'vanish', 'unfold', 'remain', 'wander', 'murmur', 'settle', 'darken',
    'unravel', 'scatter', 'whisper', 'stretch', 'dissolve', 'brighten', 'hesitate', 'disappear'],
  ['nod', 'hum', 'sway', 'bend', 'lean', 'wait', 'rest', 'wake', 'sigh', 'rise', 'sleep', 'stand', 'dream', 'listen',
    'shiver', 'darken', 'linger', 'tremble', 'whisper', 'stretch', 'glisten', 'breathe'],
  ['hum', 'swim', 'rest', 'wake', 'yawn', 'sing', 'walk', 'wait', 'pass', 'turn', 'sigh', 'crawl', 'dance', 'kneel',
    'stand', 'dream', 'sleep', 'climb', 'wander', 'gather', 'listen', 'return', 'linger', 'vanish', 'descend',
    'scatter', 'whisper', 'hesitate'],
]
const PREPOSITIONS = [
  'on', 'in', 'at', 'by', 'over', 'past', 'into', 'near', 'upon', 'under', 'along', 'above', 'below', 'among', 'after',
  'beyond', 'across', 'behind', 'toward', 'beside', 'around', 'before', 'through', 'between', 'against', 'beneath',
  'without',
]
// Nouns that take no verb here: they end a clause, or are a sentence.
const MASS = [
  'rain', 'salt', 'dusk', 'dawn', 'mist', 'fog', 'foam', 'kelp', 'tar', 'rust', 'ash', 'dew', 'hail', 'snow', 'wind',
  'sand', 'noon', 'light', 'slate', 'smoke', 'spray', 'brine', 'night', 'summer', 'winter', 'silence', 'thunder',
  'weather', 'morning', 'evening', 'nothing', 'daylight', 'sunlight', 'seawater', 'distance', 'tomorrow', 'moonlight',
  'driftwood', 'starlight', 'yesterday', 'everything',
]

// Where a sentence stands after a word, which is what the next word may be.
const AT_START = 0 // a sentence opens: an adjective, a plural, or a mass noun alone
const AFTER_OPENING_ADJECTIVE = 1 // "Pale": a plural or a mass noun follows
const AFTER_VERB = 2 // "Pale gulls wheel": a preposition follows
const AFTER_PREPOSITION = 3 // "... over": an adjective, a plural or a mass noun follows
const AFTER_CLOSING_ADJECTIVE = 4 // "... over wet": a plural or a mass noun follows
const AT_CLAUSE = 5 // after a comma: an adjective or a plural opens the next clause
const AFTER_CLAUSE_ADJECTIVE = 6 // "..., pale": a plural follows
const AFTER_SUBJECT = 7 // and one more place per class after it: "Pale gulls", a verb of the class follows
const PLACE_COUNT = AFTER_SUBJECT + SUBJECTS.length

// What a form adds to a chain's cost, so the text runs in sentences more than in fragments.
const STOP_COST = 0.4
const COMMA_COST = 0.2
const FRAGMENT_COST = 0.8 // a sentence with no verb: "Rain.", "Pale gulls."

// The words in every form a place allows, as parallel lists: the word as set, its width,
// which word it is, the place it leaves the sentence at, and its cost.
const formText: string[] = []
const formWidth: number[] = []
const formWord: number[] = []
const formNext: number[] = []
const formCost: number[] = []
const formsAt: number[][] = [] // for each place, the forms it allows, narrowest first
for (let place = 0; place < PLACE_COUNT; place++) formsAt.push([])
const measured = new Map<string, number>()
const wordIds = new Map<string, number>()
const spaceWidth = measureWord('a a') - 2 * measureWord('a')

function measureWord(text: string): number {
  let width = measured.get(text)
  if (width !== undefined) return width
  const prepared = prepareWithSegments(text, FONT)
  width = 0
  for (let i = 0; i < prepared.segments.length; i++) width += prepared.widths[i]!
  measured.set(text, width)
  return width
}

function addForm(place: number, text: string, word: string, next: number, cost: number): void {
  let id = wordIds.get(word)
  if (id === undefined) {
    id = wordIds.size
    wordIds.set(word, id)
  }
  formsAt[place]!.push(formText.length)
  formText.push(text)
  formWidth.push(measureWord(text))
  formWord.push(id)
  formNext.push(next)
  formCost.push(cost)
}

function capitalized(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1)
}

// A noun after a preposition ends its clause, with a full stop or a comma.
function addClosingForms(noun: string): void {
  for (let place = AFTER_PREPOSITION; place <= AFTER_CLOSING_ADJECTIVE; place++) {
    addForm(place, `${noun}.`, noun, AT_START, STOP_COST)
    addForm(place, `${noun},`, noun, AT_CLAUSE, COMMA_COST)
  }
}

for (let i = 0; i < ADJECTIVES.length; i++) {
  const adjective = ADJECTIVES[i]!
  addForm(AT_START, capitalized(adjective), adjective, AFTER_OPENING_ADJECTIVE, 0)
  addForm(AFTER_PREPOSITION, adjective, adjective, AFTER_CLOSING_ADJECTIVE, 0)
  addForm(AT_CLAUSE, adjective, adjective, AFTER_CLAUSE_ADJECTIVE, 0)
}
for (let c = 0; c < SUBJECTS.length; c++) {
  for (let i = 0; i < SUBJECTS[c]!.length; i++) {
    const noun = SUBJECTS[c]![i]!
    addForm(AT_START, capitalized(noun), noun, AFTER_SUBJECT + c, 0)
    addForm(AFTER_OPENING_ADJECTIVE, noun, noun, AFTER_SUBJECT + c, 0)
    addForm(AFTER_OPENING_ADJECTIVE, `${noun}.`, noun, AT_START, STOP_COST + FRAGMENT_COST)
    addForm(AT_CLAUSE, noun, noun, AFTER_SUBJECT + c, 0)
    addForm(AFTER_CLAUSE_ADJECTIVE, noun, noun, AFTER_SUBJECT + c, 0)
    addClosingForms(noun)
  }
  for (let i = 0; i < VERBS_FOR[c]!.length; i++) {
    const verb = VERBS_FOR[c]![i]!
    addForm(AFTER_SUBJECT + c, verb, verb, AFTER_VERB, 0)
    addForm(AFTER_SUBJECT + c, `${verb}.`, verb, AT_START, STOP_COST)
    addForm(AFTER_SUBJECT + c, `${verb},`, verb, AT_CLAUSE, COMMA_COST)
  }
}
for (let i = 0; i < MASS.length; i++) {
  const noun = MASS[i]!
  addForm(AT_START, `${capitalized(noun)}.`, noun, AT_START, STOP_COST + FRAGMENT_COST)
  addForm(AFTER_OPENING_ADJECTIVE, `${noun}.`, noun, AT_START, STOP_COST + FRAGMENT_COST)
  addClosingForms(noun)
}
for (let i = 0; i < PREPOSITIONS.length; i++) addForm(AFTER_VERB, PREPOSITIONS[i]!, PREPOSITIONS[i]!, AFTER_PREPOSITION, 0)
for (let place = 0; place < PLACE_COUNT; place++) formsAt[place]!.sort((a, b) => formWidth[a]! - formWidth[b]!)
const wordCount = wordIds.size
const SET_WORDS = Math.ceil(wordCount / 32) // 32-bit words in a set of words

// The first of a place's forms at least `width` wide.
function firstFormFrom(forms: number[], width: number): number {
  let lo = 0
  let hi = forms.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (formWidth[forms[mid]!]! < width) lo = mid + 1
    else hi = mid
  }
  return lo
}

function lowbias32(n: number): number {
  n = Math.imul((n >>> 16) ^ n, 0x21f0aaad)
  n = Math.imul((n >>> 15) ^ n, 0xd35a2d97)
  return (n >>> 15) ^ n
}

function hash3(a: number, b: number, c: number): number {
  return (lowbias32(lowbias32(lowbias32(a) ^ b) ^ c) >>> 0) / 0x100000000
}

// Solver costs and bounds.
const EDGE = 1 // px; a word that ends this close to the row's edge could wrap either way, so no row uses one
const TOLERANCE = 0.5 // px a space's center may miss its line by, for a cost of 1
const DRIFT_STEPS = 21 // a row's chains are kept apart by how far off its line the next space would sit, in this many steps
const DRIFTS = [2, 5, 12, 40] // px a space may sit off its line; a row no chain fills is tried again at the next
const RAG = 0.01 // cost per px squared of the white a row leaves at its end
const MAX_CELLS = 96
const NODE_COUNT = PLACE_COUNT * DRIFT_STEPS

const nodeCost = new Float64Array(MAX_CELLS * NODE_COUNT)
const nodeDrift = new Float64Array(MAX_CELLS * NODE_COUNT)
const nodeBack = new Int32Array(MAX_CELLS * NODE_COUNT)
const nodeForm = new Int32Array(MAX_CELLS * NODE_COUNT)
const nodeHeld = new Uint32Array(MAX_CELLS * NODE_COUNT * SET_WORDS)

type SolvedRow = { words: string[], gaps: number[], place: number, white: number, drift: number }

// Picks one row's words. `lines` holds where the drawing's lines cross the row; a word
// goes between each two, so the row has one more word than lines. The search goes cell
// by cell: a node is the sentence's place and how far off its line the last space sits,
// and the cheapest chain to each node is kept, with the set of words it holds so none
// comes twice in a row. The first word is wider than `firstOver`, the room the row above
// left, or the browser would have set it up there. The last word leaves less room than
// `nextFirstAtLeast`, the narrowest the next row's first word can be, for the same reason.
function solveRow(
  lines: number[],
  width: number,
  row: number,
  startPlace: number,
  firstOver: number,
  nextFirstAtLeast: number,
  isLast: boolean,
  maxDrift: number,
  wordCost: Float64Array,
): SolvedRow | null {
  const cells = lines.length
  const mid = (DRIFT_STEPS - 1) / 2
  nodeCost.fill(Infinity, 0, (cells + 1) * NODE_COUNT)
  const first = startPlace * DRIFT_STEPS + mid
  nodeCost[first] = 0
  nodeDrift[first] = 0
  for (let w = 0; w < SET_WORDS; w++) nodeHeld[first * SET_WORDS + w] = 0

  for (let cell = 0; cell < cells; cell++) {
    const wordStart = cell === 0 ? 0 : lines[cell - 1]! + spaceWidth / 2
    const nextStart = lines[cell]! + spaceWidth / 2
    for (let n = 0; n < NODE_COUNT; n++) {
      const node = cell * NODE_COUNT + n
      const cost = nodeCost[node]!
      if (cost === Infinity) continue
      const forms = formsAt[Math.floor(n / DRIFT_STEPS)]!
      const want = nextStart - (wordStart + nodeDrift[node]!) - spaceWidth
      for (let i = firstFormFrom(forms, want - maxDrift); i < forms.length; i++) {
        const form = forms[i]!
        const drift = formWidth[form]! - want
        if (drift > maxDrift) break
        if (cell === 0 && formWidth[form]! <= firstOver) continue
        const word = formWord[form]!
        if ((nodeHeld[node * SET_WORDS + (word >>> 5)]! & (1 << (word & 31))) !== 0) continue
        const scaled = drift / TOLERANCE
        const total = cost + scaled * scaled + wordCost[word]! + formCost[form]! + hash3(row * MAX_CELLS + cell, n, form) * 0.05
        const step = Math.round(mid + (drift / maxDrift) * mid)
        const next = (cell + 1) * NODE_COUNT + formNext[form]! * DRIFT_STEPS + step
        if (total >= nodeCost[next]!) continue
        nodeCost[next] = total
        nodeDrift[next] = drift
        nodeBack[next] = node
        nodeForm[next] = form
        for (let w = 0; w < SET_WORDS; w++) nodeHeld[next * SET_WORDS + w] = nodeHeld[node * SET_WORDS + w]!
        nodeHeld[next * SET_WORDS + (word >>> 5)]! |= 1 << (word & 31)
      }
    }
  }

  // The last word runs to the row's ragged end.
  const lastStart = cells === 0 ? 0 : lines[cells - 1]! + spaceWidth / 2
  let bestCost = Infinity
  let bestNode = -1
  let bestForm = -1
  for (let n = 0; n < NODE_COUNT; n++) {
    const node = cells * NODE_COUNT + n
    const cost = nodeCost[node]!
    if (cost === Infinity) continue
    const forms = formsAt[Math.floor(n / DRIFT_STEPS)]!
    const start = lastStart + nodeDrift[node]!
    const over = isLast ? 0 : width + EDGE - spaceWidth - nextFirstAtLeast - start
    for (let i = firstFormFrom(forms, over); i < forms.length; i++) {
      const form = forms[i]!
      const formW = formWidth[form]!
      if (start + formW > width - EDGE) break
      if (formW <= over || (cells === 0 && formW <= firstOver)) continue
      if (isLast && formNext[form]! !== AT_START) continue
      const word = formWord[form]!
      if ((nodeHeld[node * SET_WORDS + (word >>> 5)]! & (1 << (word & 31))) !== 0) continue
      const white = width - (start + formW)
      const total = cost + RAG * white * white + wordCost[word]! + formCost[form]! + hash3(row * MAX_CELLS + cells, n, form) * 0.05
      if (total >= bestCost) continue
      bestCost = total
      bestNode = node
      bestForm = form
    }
  }
  if (bestNode === -1) return null

  const forms: number[] = [bestForm]
  for (let node = bestNode, cell = cells; cell > 0; cell--, node = nodeBack[node]!) forms.push(nodeForm[node]!)
  const solved: SolvedRow = { words: [], gaps: [], place: formNext[bestForm]!, white: 0, drift: 0 }
  let x = 0
  for (let i = forms.length - 1; i >= 0; i--) {
    const form = forms[i]!
    if (x > 0) {
      const gap = x - spaceWidth / 2
      solved.gaps.push(gap)
      solved.drift = Math.max(solved.drift, Math.abs(gap - lines[solved.gaps.length - 1]!))
    }
    solved.words.push(formText[form]!)
    wordCost[formWord[form]!] = -1 // marks the word as used on this row, for the caller
    x += formWidth[form]! + spaceWidth
  }
  solved.white = width - (x - spaceWidth)
  return solved
}

type Drawing = { rows: number[][], path: string, filled: number }

// Where the drawing's lines cross each row. Each line is a function from a row's y to an
// x, or to nothing where the line isn't. On a row, lines are taken in order of rank, and
// a line too close to one already taken gives way.
function buildDrawing(width: number, rowCount: number): Drawing {
  const height = rowCount * LINE_HEIGHT
  const horizonRow = Math.round(rowCount * 0.62)
  const horizonY = horizonRow * LINE_HEIGHT
  const sunX = width * 0.57
  const sunY = -height * 1.15 // high above the page, so the rays at its corners stay steep enough to read

  type Island = { peakX: number, peakY: number, left: number, right: number }
  const islands: Island[] = [
    { peakX: width * 0.25, peakY: height * 0.17, left: 0.5, right: 0.42 },
    { peakX: width * 0.86, peakY: height * 0.43, left: 0.5, right: 0.4 },
  ]
  // A flank falls away from the peak, steep at the top and less so at the foot.
  function flank(island: Island, y: number, side: number): number {
    const fall = (y - island.peakY) / (horizonY - island.peakY)
    const reach = (horizonY - island.peakY) * (side < 0 ? island.left : island.right)
    return island.peakX + side * reach * (0.55 * fall + 0.45 * fall * fall)
  }

  const lines: ((y: number) => number | null)[][] = [[], [], []] // by rank
  for (let i = 0; i < islands.length; i++) {
    const island = islands[i]!
    const onIsland = (y: number) => y > island.peakY && y < horizonY
    lines[0]!.push(y => (onIsland(y) ? flank(island, y, -1) : null))
    lines[0]!.push(y => (onIsland(y) ? flank(island, y, 1) : null))
    // An island is hatched in parallel lines that lean against the rays around it, as an
    // engraver turns the hatching to set one plane off from the next.
    const lean = island.peakX < sunX ? ISLAND_LEAN : -ISLAND_LEAN
    const reach = (horizonY - island.peakY) * (1 + ISLAND_LEAN)
    for (let offset = -reach; offset < reach; offset += ISLAND_GAP) {
      lines[1]!.push(y => {
        if (!onIsland(y)) return null
        const x = island.peakX + offset + (y - island.peakY) * lean
        return x > flank(island, y, -1) && x < flank(island, y, 1) ? x : null
      })
    }
  }
  // Rays fan down from the sun and stop at the horizon, or behind an island.
  const raySlope = RAY_GAP / -sunY
  const rayCount = Math.ceil(width / RAY_GAP) + 2
  for (let k = -rayCount; k <= rayCount; k++) {
    lines[2]!.push(y => {
      if (y > horizonY) return null
      const x = sunX + (y - sunY) * k * raySlope
      for (let i = 0; i < islands.length; i++) {
        const island = islands[i]!
        if (y > island.peakY && x > flank(island, y, -1) - MIN_GAP / 2 && x < flank(island, y, 1) + MIN_GAP / 2) return null
      }
      return x
    })
  }
  // Wave lines run down the sea, closer together under the sun. An island's reflection, its
  // shape upside down and shortened, takes every other line out, so the water is darker there.
  for (let x0 = WAVE_GAP / 2, j = 0; x0 < width; j++) {
    const base = x0
    const phase = j * 0.7
    const reflected = j % 2 === 1
    lines[1]!.push(y => {
      if (y <= horizonY) return null
      const mirrored = horizonY - (y - horizonY) / REFLECTION
      for (let i = 0; reflected && i < islands.length; i++) {
        const island = islands[i]!
        if (mirrored > island.peakY && base > flank(island, mirrored, -1) && base < flank(island, mirrored, 1)) return null
      }
      return base + WAVE_SWING * Math.sin(((y - horizonY) * 2 * Math.PI) / (WAVE_ROWS * LINE_HEIGHT) + phase)
    })
    const fromSun = (x0 - sunX) / (width * 0.1)
    x0 += WAVE_GAP - (WAVE_GAP - WAVE_GAP_LIT) * Math.exp(-fromSun * fromSun)
  }

  const rows: number[][] = []
  const paths: string[] = []
  const lastRowOf: number[] = []
  let filled = 0
  for (let rank = 0, id = 0; rank < lines.length; rank++) {
    for (let i = 0; i < lines[rank]!.length; i++, id++) {
      paths.push('')
      lastRowOf.push(-2)
    }
  }
  for (let r = 0; r < rowCount; r++) {
    const y = (r + SEAM_Y) * LINE_HEIGHT
    const taken: number[] = []
    for (let rank = 0, id = 0; rank < lines.length; rank++) {
      for (let i = 0; i < lines[rank]!.length; i++, id++) {
        const x = lines[rank]![i]!(y)
        let free = x !== null && x >= LEFT_CLEAR && x <= width - RIGHT_CLEAR
        for (let t = 0; free && t < taken.length; t++) free = Math.abs(taken[t]! - x!) >= MIN_GAP
        if (!free) continue
        taken.push(x!)
        paths[id] += `${lastRowOf[id] === r - 1 ? 'L' : 'M'}${x!.toFixed(1)} ${y.toFixed(1)}`
        lastRowOf[id] = r
      }
    }
    taken.sort((a, b) => a - b)
    // A cell too wide for any word gets lines of its own.
    const row: number[] = []
    for (let t = 0; t <= taken.length; t++) {
      const from = t === 0 ? 0 : taken[t - 1]!
      const to = t === taken.length ? width : taken[t]!
      const parts = Math.ceil((to - from) / MAX_CELL)
      for (let p = 1; p < parts; p++, filled++) row.push(from + ((to - from) * p) / parts)
      if (t < taken.length) row.push(to)
    }
    rows.push(row)
  }
  return { rows, path: paths.join(''), filled }
}

type Scene = { width: number, text: string, path: string, pathWidth: number, stats: string }

function buildScene(width: number): Scene {
  const start = performance.now()
  const rowCount = Math.round((width * SCENE_ASPECT) / LINE_HEIGHT)
  const drawing = buildDrawing(width, rowCount)

  const lastUsedRow = new Int32Array(wordCount).fill(-100)
  const wordCost = new Float64Array(wordCount)
  const rows: SolvedRow[] = []
  let place = AT_START
  let firstOver = 0
  let text = ''
  let loosened = 0
  for (let r = 0; r < rowCount; r++) {
    const lines = drawing.rows[r]!
    const nextLines = r + 1 < rowCount ? drawing.rows[r + 1]! : lines
    let solved: SolvedRow | null = null
    for (let attempt = 0; solved === null && attempt < DRIFTS.length; attempt++) {
      for (let w = 0; w < wordCount; w++) {
        const since = r - lastUsedRow[w]!
        wordCost[w] = since <= 1 ? 6 : since <= 4 ? 2 : since <= 10 ? 0.5 : 0
      }
      // The next row's first word is at least its first cell less the most a space may sit off its line.
      const nextFirstAtLeast = nextLines[0]! - spaceWidth / 2 - DRIFTS[0]!
      solved = solveRow(lines, width, r, place, firstOver, nextFirstAtLeast, r === rowCount - 1, DRIFTS[attempt]!, wordCost)
      if (solved !== null && attempt > 0) loosened++
    }
    if (solved === null) break
    for (let w = 0; w < wordCount; w++) if (wordCost[w] === -1) lastUsedRow[w] = r
    rows.push(solved)
    place = solved.place
    firstOver = solved.white - spaceWidth + EDGE
    text += (r === 0 ? '' : ' ') + solved.words.join(' ')
  }
  const solveMs = performance.now() - start

  // Whether Pretext wraps the finished paragraph into the rows the solver planned.
  const wrapped = layoutWithLines(prepareWithSegments(text, FONT), width, LINE_HEIGHT).lines
  let planned = wrapped.length === rows.length && rows.length === rowCount
  for (let r = 0; planned && r < rows.length; r++) planned = wrapped[r]!.text.trim() === rows[r]!.words.join(' ')

  let spaces = 0
  let close = 0
  for (let r = 0; r < rows.length; r++) {
    for (let g = 0; g < rows[r]!.gaps.length; g++, spaces++) {
      if (Math.abs(rows[r]!.gaps[g]! - drawing.rows[r]![g]!) <= TOLERANCE) close++
    }
  }
  const stats =
    `${rows.length} lines of ${FONT} · ${spaces} word spaces, each on a line of the drawing: ${close} within ` +
    `${TOLERANCE}px of it, ${drawing.filled} on a line added to split a cell too wide for a word · ` +
    `${loosened} rows needed slack · solved in ${Math.round(solveMs)} ms · ` +
    (planned ? 'Pretext wraps the paragraph into the planned lines' : 'Pretext wraps the paragraph differently from the plan')
  return { width, text, path: drawing.path, pathWidth: spaceWidth, stats }
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
  seamsButton.textContent = seamsShown ? 'Hide the drawing' : 'Show the drawing'
}

scheduleRender()
