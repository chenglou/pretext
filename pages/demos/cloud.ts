// Prototype: a cloud drawn in rivers. The page holds one plain paragraph, wrapped by the
// browser with every word space at its natural width. The cloud's stroke is a band of
// short words: where it crosses a line of text, a space sits on each of its edges with one
// short word between, and where it runs along a line, that line has a run of short words
// there. So the band is lighter than the long words around it, and its edges line up
// into rivers. Everywhere else the spaces are kept from lining up, as in ordinary text.
//
// The text is a chain of short sentences from a small grammar, so each place has many
// words to choose from; Pretext gives every word's width, and the solver picks the chain
// whose spaces fall where the drawing asks.

import { layoutWithLines, prepareWithSegments } from '../../src/layout.ts'

const params = new URLSearchParams(location.search)
// Kalam, a handwriting face, has a word space nearly as wide as its average letter, where
// text faces stop near two thirds: short words set in it are looser, so the two textures
// differ more. The spacing below was tuned on Verdana at 10px, whose letters are as wide
// as Kalam's at 12.2px; the page sets Kalam at 9.8px with the spacing at 0.8 of that, since
// smaller type gives the shape more words to be drawn with. Another family comes from the
// address: `font`, `size`, `lh`, and `web=1` if it is a Google Fonts one.
const DEFAULT_FONT = !params.has('font')
const FONT_FAMILY = params.get('font') ?? 'Kalam'
const FONT_SIZE = Number(params.get('size') ?? (DEFAULT_FONT ? 9.8 : 10))
const LINE_HEIGHT = Number(params.get('lh') ?? (DEFAULT_FONT ? 12 : FONT_SIZE + 1))
const FONT = `${params.get('weight') ?? 400} ${FONT_SIZE}px "${FONT_FAMILY}"`
const INK = '#1f1d1a'
// The family is fetched from Google Fonts before anything is measured.
if (params.has('web') ? params.get('web') === '1' : DEFAULT_FONT) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${FONT_FAMILY.replace(/ /g, '+')}&display=swap`
  document.head.appendChild(link)
  await new Promise(resolve => {
    link.onload = resolve
    link.onerror = resolve
  })
  await document.fonts.load(FONT, 'The quick brown fox.')
}

const FILLED_DEFAULT = params.get('fill') !== '0'
const DENSE_DEFAULT = params.get('dense') !== '0'
const SWIRL_DEFAULT = params.get('shape') === 'swirl'
const SIDEWAYS_DEFAULT = params.has('side') ? params.get('side') === '1' : !FILLED_DEFAULT
const MAX_SCENE_WIDTH = 960
const SCENE_STEP = 80 // the scene's width moves in these steps, since each width is solved anew

// The cloud: a traced stroke as cubic Béziers in a 474 by 320 frame, and the box its ink
// fills. (Traced from a reference image for this prototype; to be redrawn before it ships.)
const CLOUD_PATHS = [
  'M212.0 141.0C207.8 139.8 203.5 137.9 199.0 138.4C169.6 141.7 165.4 186.6 194.0 198.6C201.7 201.8 209.9 201.9 218.0 200.9C268.8 194.5 278.7 127.8 245.0 96.0C217.7 70.2 168.8 72.0 142.0 97.6C129.0 109.9 131.9 119.3 126.1 126.9C122.9 131.0 117.0 132.2 113.0 135.6C96.4 149.5 94.6 177.1 105.6 195.0C111.3 204.3 121.0 212.1 132.0 213.8C136.1 214.4 140.4 213.7 144.0 216.1C147.9 218.7 148.2 223.1 150.0 227.0C157.0 241.9 174.0 252.3 190.0 254.8C269.9 267.0 285.0 176.9 370.0 180.4C373.7 180.6 378.1 178.0 381.5 178.7C382.4 178.9 383.1 179.9 384.0 180.0',
  'M267.0 147.0C305.3 144.2 319.9 132.7 358.0 154.3C368.1 160.1 375.1 166.0 379.0 177.0',
]
const CLOUD_BOX = [96, 74, 386, 257] // left, top, right, bottom

// Spacing, in px at FONT_SIZE 10 and scaled with it.
const UNIT = Number(params.get('unit') ?? (DEFAULT_FONT ? 0.8 : FONT_SIZE / 10))
const MIN_GAP = 21 * UNIT // two spaces closer than this on a line leave no room for a word
const BAND = 22.5 * UNIT // the stroke's width: between the spaces on its two edges, with a three-letter word between
const LIGHT_GAP = 24 * UNIT // between spaces inside a filled shape: three- and four-letter words
// The spiral's width when the cloud is filled. A ribbon reads as dark only if a long word
// fits across it, so it is far wider than the traced stroke.
const RIBBON = Number(params.get('ribbon') ?? 82) * UNIT
const GROUND_GAP = Number(params.get('ground') ?? 46) * UNIT // between spaces off the stroke, on average
const MAX_CELL = 78 * UNIT // a wider stretch gets a space of its own, since few words are that long
const LEFT_CLEAR = 22 * UNIT // room for a line's first word
const RIGHT_CLEAR = 30 * UNIT // room for a line's last word
const MARGIN = 0.07 // of the scene's width, around the cloud

// The sentences: "Pale gulls wheel over wet rooftops." and every shorter cut of that
// shape, down to "Rain."; a comma may carry a sentence on into another clause. Any word
// of a kind can stand in any place of that kind, but a subject takes only the verbs of
// its own class, so gulls wheel and tides ebb and no reef walks.
const ADJECTIVES = [
  'wet', 'dim', 'low', 'old', 'red', 'far', 'dry', 'wan', 'shy', 'raw', 'new', 'icy', 'hot', 'big', 'sad', 'odd', 'pale',
  'long', 'high', 'near', 'pink', 'rosy', 'hazy', 'cool', 'keen', 'vast', 'bold', 'dull', 'fine', 'fair', 'mild', 'rare',
  'rich', 'ripe', 'safe', 'tame', 'tiny', 'true', 'weak', 'wise', 'wavy', 'slow', 'cold', 'gray', 'dark', 'soft', 'calm',
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
  ['gulls', 'terns', 'herons', 'crows', 'owls', 'jays', 'swans', 'larks', 'moths', 'swallows', 'sparrows', 'seabirds', 'cormorants'],
  ['seas', 'bays', 'tides', 'waves', 'coves', 'pools', 'rills', 'fords', 'swells', 'rivers', 'eddies', 'streams', 'ripples', 'currents',
    'channels', 'shallows', 'breakers', 'tidepools'],
  ['suns', 'rays', 'lamps', 'stars', 'moons', 'fires', 'sparks', 'embers', 'candles', 'beacons', 'windows', 'lanterns', 'lighthouses',
    'reflections', 'constellations'],
  ['oars', 'nets', 'tugs', 'jibs', 'rafts', 'prows', 'decks', 'boats', 'sails', 'hulls', 'masts', 'keels', 'ropes', 'bells',
    'buoys', 'flags', 'barges',
    'skiffs', 'ferries', 'anchors', 'moorings', 'trawlers'],
  ['cays', 'bars', 'capes', 'isles', 'crags', 'peaks', 'roofs', 'hills', 'rocks', 'reefs', 'dunes', 'piers', 'docks',
    'walls', 'paths', 'gates', 'cliffs', 'shoals',
    'shells', 'stones', 'fields', 'spires', 'towers', 'islands', 'harbors', 'meadows', 'pebbles', 'jetties',
    'bridges', 'horizons', 'rooftops', 'villages', 'orchards', 'sandbars', 'headlands', 'promontories', 'archipelagos'],
  ['days', 'eras', 'ages', 'hours', 'years', 'songs', 'names', 'winds', 'mists', 'nights', 'dreams', 'clouds', 'voices', 'echoes',
    'shadows', 'mornings', 'evenings', 'footprints'],
  ['elms', 'oaks', 'firs', 'yews', 'figs', 'buds', 'pines', 'reeds', 'ferns', 'vines', 'weeds', 'grasses', 'willows'],
  ['eels', 'bats', 'bees', 'men', 'boys', 'girls', 'crabs', 'seals', 'divers', 'sailors', 'children', 'swimmers', 'fishermen'],
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
  'rain', 'salt', 'dusk', 'dawn', 'mist', 'fog', 'foam', 'kelp', 'tar', 'rust', 'ash', 'dew', 'ice', 'air', 'sky', 'sun',
  'hail', 'snow', 'wind',
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

// The joined sky: short words run together into one unbroken word of any length, so a
// stretch of sky has no space in it. Between two of them sits a zero-width space, which
// shows nothing and takes no room but lets the browser break the line there, which is how
// the sky runs on from one line to the next. (`join=hyphen` in the address joins them
// with hyphens instead, which leave small gaps.)
const JOINER = params.get('join') === 'hyphen' ? '-' : '\u200B'
const pieces: string[] = []
for (let i = 0; i < ADJECTIVES.length; i++) if (ADJECTIVES[i]!.length <= 7) pieces.push(ADJECTIVES[i]!)
for (let i = 0; i < MASS.length; i++) if (!pieces.includes(MASS[i]!)) pieces.push(MASS[i]!)
const pieceWidth = pieces.map(piece => measureWord(piece)) // alone
const pieceJoinedWidth = pieces.map(piece => measureWord(piece + JOINER)) // with what joins it to the next
const piecesByWidth = pieces.map((_, i) => i).sort((a, b) => pieceWidth[a]! - pieceWidth[b]!)
const piecesByJoinedWidth = pieces.map((_, i) => i).sort((a, b) => pieceJoinedWidth[a]! - pieceJoinedWidth[b]!)
const CHAIN_FINISH = 1.6 * pieceJoinedWidth[piecesByJoinedWidth[pieces.length - 1]!]! // room left for the last one or two pieces
const CHAIN_END_WHITE = 3 // px a joined word stops short of the line's end: less than any piece, more than a rounding

// Strings pieces into a joined word `target` px wide. `joined` leaves a joiner at its end,
// for one that runs on to the next line. Pieces are taken unevenly until one or two more
// will finish it, and those are the one or the pair whose widths come closest.
function fillChain(target: number, joined: boolean, seed: number): { text: string, width: number } {
  let text = ''
  let width = 0
  let previous = -1
  for (let k = 0; target - width > CHAIN_FINISH; k++) {
    const piece = Math.floor(hash3(seed, k, 11) * pieces.length)
    if (piece === previous) continue
    previous = piece
    text += pieces[piece]! + JOINER
    width += pieceJoinedWidth[piece]!
  }
  const room = target - width
  const lastWidths = joined ? pieceJoinedWidth : pieceWidth
  const lastOrder = joined ? piecesByJoinedWidth : piecesByWidth
  let best = Infinity
  let first = -1
  let last = -1
  for (let a = -1; a < pieces.length; a++) {
    if (a === previous) continue
    const rest = a === -1 ? room : room - pieceJoinedWidth[a]!
    let lo = 0
    let hi = lastOrder.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (lastWidths[lastOrder[mid]!]! < rest) lo = mid + 1
      else hi = mid
    }
    for (let i = Math.max(0, lo - 1); i <= Math.min(lastOrder.length - 1, lo); i++) {
      const b = lastOrder[i]!
      const miss = Math.abs(rest - lastWidths[b]!)
      if (b === a || miss >= best) continue
      best = miss
      first = a
      last = b
    }
  }
  if (first !== -1) {
    text += pieces[first]! + JOINER
    width += pieceJoinedWidth[first]!
  }
  return { text: text + pieces[last]! + (joined ? JOINER : ''), width: width + lastWidths[last]! }
}

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
const TOLERANCE = 0.8 // px a space's center may miss its place by, for a cost of 1
const DRIFT_STEPS = 21 // a row's chains are kept apart by how far off its line the next space would sit, in this many steps
const DRIFTS = [2.5, 5, 12, 40] // px a space may sit off the stroke; a line no chain fills is tried again at the next
const LOOSE_DRIFT = 10 // px a space among the long words may sit from where it was put
const LIGHT_DRIFT = 3 // and a space among the short words of a filled shape
const RAG = 0.01 // cost per px squared of the white a row leaves at its end
const MAX_CELLS = 96
const NODE_COUNT = PLACE_COUNT * DRIFT_STEPS

const nodeCost = new Float64Array(MAX_CELLS * NODE_COUNT)
const nodeDrift = new Float64Array(MAX_CELLS * NODE_COUNT)
const nodeBack = new Int32Array(MAX_CELLS * NODE_COUNT)
const nodeForm = new Int32Array(MAX_CELLS * NODE_COUNT)
const nodeHeld = new Uint32Array(MAX_CELLS * NODE_COUNT * SET_WORDS)

type SolvedRow = { words: string[], gaps: number[], place: number, white: number, drift: number, joinsNext: boolean }

// Picks one line's words. `lines` holds where its spaces should sit and `slack` how many
// px each may move, 0 for a space the drawing places exactly; a word goes between each
// two, so the line has one more word than spaces. The search goes cell
// by cell: a node is the sentence's place and how far off its line the last space sits,
// and the cheapest chain to each node is kept, with the set of words it holds so none
// comes twice in a row. The first word is wider than `firstOver`, the room the row above
// left, or the browser would have set it up there. The last word leaves less room than
// `nextFirstAtLeast`, the narrowest the next row's first word can be, for the same reason.
function solveRow(
  lines: number[],
  slack: number[],
  chain: boolean[] | null,
  nextOpensJoined: boolean,
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
    if (chain !== null && chain[cell]!) {
      // A joined word fills its stretch whatever came before, so the next space sits true.
      for (let n = 0; n < NODE_COUNT; n++) {
        const node = cell * NODE_COUNT + n
        const next = (cell + 1) * NODE_COUNT + Math.floor(n / DRIFT_STEPS) * DRIFT_STEPS + mid
        if (nodeCost[node]! >= nodeCost[next]!) continue
        nodeCost[next] = nodeCost[node]!
        nodeDrift[next] = 0
        nodeBack[next] = node
        nodeForm[next] = -1
        for (let w = 0; w < SET_WORDS; w++) nodeHeld[next * SET_WORDS + w] = nodeHeld[node * SET_WORDS + w]!
      }
      continue
    }
    const wordStart = cell === 0 ? 0 : lines[cell - 1]! + spaceWidth / 2
    const nextStart = lines[cell]! + spaceWidth / 2
    for (let n = 0; n < NODE_COUNT; n++) {
      const node = cell * NODE_COUNT + n
      const cost = nodeCost[node]!
      if (cost === Infinity) continue
      const forms = formsAt[Math.floor(n / DRIFT_STEPS)]!
      const want = nextStart - (wordStart + nodeDrift[node]!) - spaceWidth
      const reach = Math.max(slack[cell]!, maxDrift)
      const tolerance = slack[cell]! > 0 ? slack[cell]! * 0.7 : TOLERANCE
      for (let i = firstFormFrom(forms, want - reach); i < forms.length; i++) {
        const form = forms[i]!
        const drift = formWidth[form]! - want
        if (drift > reach) break
        if (cell === 0 && formWidth[form]! <= firstOver) continue
        const word = formWord[form]!
        if ((nodeHeld[node * SET_WORDS + (word >>> 5)]! & (1 << (word & 31))) !== 0) continue
        const scaled = drift / tolerance
        const total = cost + scaled * scaled + wordCost[word]! + formCost[form]! + hash3(row * MAX_CELLS + cell, n, form) * 0.05
        const step = Math.round(mid + (drift / reach) * mid)
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
  const endsJoined = chain !== null && chain[cells]!
  let bestCost = Infinity
  let bestNode = -1
  let bestForm = -1
  let bestPlace = 0
  for (let n = 0; n < NODE_COUNT; n++) {
    const node = cells * NODE_COUNT + n
    const cost = nodeCost[node]!
    if (cost === Infinity) continue
    if (endsJoined) {
      if (cost >= bestCost) continue
      bestCost = cost
      bestNode = node
      bestPlace = Math.floor(n / DRIFT_STEPS)
      continue
    }
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
      bestPlace = formNext[form]!
    }
  }
  if (bestNode === -1) return null

  const forms: number[] = [bestForm]
  for (let node = bestNode, cell = cells; cell > 0; cell--, node = nodeBack[node]!) forms.push(nodeForm[node]!)
  const solved: SolvedRow = { words: [], gaps: [], place: bestPlace, white: 0, drift: 0, joinsNext: false }
  let x = 0
  for (let i = forms.length - 1, cell = 0; i >= 0; i--, cell++) {
    const form = forms[i]!
    if (x > 0) {
      const gap = x - spaceWidth / 2
      solved.gaps.push(gap)
      if (slack[solved.gaps.length - 1]! === 0) solved.drift = Math.max(solved.drift, Math.abs(gap - lines[solved.gaps.length - 1]!))
    }
    if (form === -1) {
      // A joined word runs to the next space the drawing places, or to the line's end, where
      // it carries on to the next line if that one opens with a joined word too.
      const end = cell === cells ? width - CHAIN_END_WHITE : lines[cell]! - spaceWidth / 2
      solved.joinsNext = cell === cells && !isLast && nextOpensJoined
      const filled = fillChain(end - x, solved.joinsNext, row * MAX_CELLS + cell)
      solved.words.push(filled.text)
      x += filled.width + spaceWidth
      continue
    }
    solved.words.push(formText[form]!)
    wordCost[formWord[form]!] = -1 // marks the word as used on this row, for the caller
    x += formWidth[form]! + spaceWidth
  }
  solved.white = width - (x - spaceWidth)
  return solved
}

function hash2(a: number, b: number): number {
  return (lowbias32(lowbias32(a) ^ b) >>> 0) / 0x100000000
}

type Drawing = {
  rows: number[][] // for each line of text, where its spaces should sit, along the line
  slack: number[][] // how far each may move; 0 for one the drawing places exactly
  chain: (boolean[] | null)[] // with a joined sky, which of the line's words are joined ones; one more than its spaces
  inline: number // a line's length
  sceneWidth: number
  sceneHeight: number
  path: string // the cloud's stroke, in the scene's px
}

type Space = { at: number, slack: number }

// Where each line of text's spaces go. Upright, lines run across the scene and stack down
// it; sideways, they run up it and stack from left to right. Drawn as a stroke, the cloud
// is a band of short words along its curve. Filled, it is a body of short words in a sky
// of long ones, with the spiral a ribbon of sky cut into it: nothing is outlined, and the
// shape shows where the two textures meet. With `dense`, the sky's long words give way to
// joined ones with no space in them. With `swirl`, the shape is not the traced cloud but
// one thick arm winding out from a center, made for what this way of drawing can show.
function buildDrawing(width: number, sideways: boolean, filled: boolean, dense: boolean, swirl: boolean): Drawing {
  const margin = width * MARGIN
  const boxWidth = CLOUD_BOX[2]! - CLOUD_BOX[0]!
  const boxHeight = CLOUD_BOX[3]! - CLOUD_BOX[1]!
  const scale = (width - 2 * margin) / boxWidth
  const rawHeight = boxHeight * scale + 2 * margin
  const lineCount = Math.round((sideways ? width : rawHeight) / LINE_HEIGHT)
  const sceneWidth = sideways ? lineCount * LINE_HEIGHT : width
  const sceneHeight = sideways ? Math.round(rawHeight) : lineCount * LINE_HEIGHT
  const inline = sideways ? sceneHeight : sceneWidth
  const offsetX = (sceneWidth - boxWidth * scale) / 2 - CLOUD_BOX[0]! * scale
  const offsetY = (sceneHeight - boxHeight * scale) / 2 - CLOUD_BOX[1]! * scale

  // Follow each curve. For the stroke: every stretch a curve spends inside one line of
  // text gets a space half a band before it and one half a band after, with more between
  // at about a band apart if the stretch is long. For the fill: keep the curves as points,
  // each a place along a line of text and a place across the lines.
  const stroke: number[][] = []
  for (let line = 0; line < lineCount; line++) stroke.push([])
  const curves: number[][] = []
  let path = ''
  let runLine = -1
  let runMin = 0
  let runMax = 0
  function endRun(): void {
    if (runLine >= 0 && runLine < lineCount) {
      const from = runMin - BAND / 2
      const length = runMax - runMin + BAND
      let count = Math.round(length / BAND) + 1
      while (count > 2 && length / (count - 1) < MIN_GAP) count--
      for (let i = 0; i < count; i++) stroke[runLine]!.push(from + (length * i) / (count - 1))
    }
    runLine = -1
  }
  for (let p = 0; p < CLOUD_PATHS.length; p++) {
    const numbers = CLOUD_PATHS[p]!.match(/-?[\d.]+/g)!.map(Number)
    for (let i = 0; i < numbers.length; i += 2) {
      numbers[i] = numbers[i]! * scale + offsetX
      numbers[i + 1] = numbers[i + 1]! * scale + offsetY
    }
    const curve: number[] = []
    path += `M${numbers[0]!.toFixed(1)} ${numbers[1]!.toFixed(1)}`
    for (let i = 2; i < numbers.length; i += 6) {
      const x0 = numbers[i - 2]!, y0 = numbers[i - 1]!
      const x1 = numbers[i]!, y1 = numbers[i + 1]!
      const x2 = numbers[i + 2]!, y2 = numbers[i + 3]!
      const x3 = numbers[i + 4]!, y3 = numbers[i + 5]!
      path += `C${x1.toFixed(1)} ${y1.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} ${x3.toFixed(1)} ${y3.toFixed(1)}`
      for (let step = 0; step <= 600; step++) {
        const t = step / 600
        const u = 1 - t
        const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3
        const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
        const across = sideways ? x : y
        const along = sideways ? sceneHeight - y : x
        if (step % 10 === 0) curve.push(along, across)
        const line = Math.floor(across / LINE_HEIGHT)
        if (line !== runLine) {
          endRun()
          runLine = line
          runMin = along
          runMax = along
        }
        runMin = Math.min(runMin, along)
        runMax = Math.max(runMax, along)
      }
    }
    endRun()
    curves.push(curve)
  }

  // The filled cloud's parts. The first curve runs from the spiral's inner end out to the
  // head's outline and on to the tail's tip; the second, the tail's upper edge, leaves it
  // where the spiral becomes the outline. So the body is the first curve from that point
  // on, closed by the second, and the spiral is the first curve up to it.
  const main = curves[0]!
  const tail = curves[1]!
  let joint = 0
  for (let i = 0, nearest = Infinity; i < main.length; i += 2) {
    const d = Math.hypot(main[i]! - tail[0]!, main[i + 1]! - tail[1]!)
    if (d < nearest) {
      nearest = d
      joint = i
    }
  }
  const body = main.slice(joint)
  for (let i = tail.length - 2; i >= 0; i -= 2) body.push(tail[i]!, tail[i + 1]!)

  // The swirl, as points along the middle of its arm, each with the arm's half width
  // there: the arm, a tail that sweeps away from its outer end and tapers, and lobes
  // along its outer rim.
  const band: number[] = [] // along, across, half width, for each point
  if (swirl) {
    path = ''
    const centerX = sceneWidth * 0.4
    const centerY = sceneHeight * 0.5
    const inner = sceneHeight * 0.05
    const outer = sceneHeight * 0.37
    const total = 1.6 * 2 * Math.PI // the arm's turns, as an angle
    const half = ((outer - inner) / 1.6) * 0.32
    const addPoint = (x: number, y: number, halfWidth: number, drawn: boolean): void => {
      band.push(sideways ? sceneHeight - y : x, sideways ? x : y, halfWidth)
      if (drawn) path += `${path === '' ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    }
    // The arm ends at the bottom, heading right.
    for (let t = 0; t <= total; t += 0.02) {
      const radius = inner + ((outer - inner) * t) / total
      const angle = Math.PI / 2 + total - t
      addPoint(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle), half, true)
    }
    const endX = centerX
    const endY = centerY + outer
    const tipX = sceneWidth * 0.95
    const tipY = sceneHeight * 0.42
    for (let t = 0.02; t <= 1; t += 0.02) {
      const u = 1 - t
      const x = u * u * u * endX + 3 * u * u * t * (endX + sceneWidth * 0.24) + 3 * u * t * t * (tipX - sceneWidth * 0.1) + t * t * t * tipX
      const y = u * u * u * endY + 3 * u * u * t * endY + 3 * u * t * t * (tipY + sceneHeight * 0.2) + t * t * t * tipY
      addPoint(x, y, half * u + 1, true)
    }
    const lobes = [0.95, 1.22, 1.5, 1.78] // where on the rim, in half turns from the right
    for (let i = 0; i < lobes.length; i++) {
      const angle = lobes[i]! * Math.PI
      const radius = inner + ((outer - inner) * (total - (angle - Math.PI / 2))) / total + half * 0.8
      addPoint(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle), half * 1.2, false)
    }
  }

  const rows: number[][] = []
  const slack: number[][] = []
  const chain: (boolean[] | null)[] = []
  const STEP = 0.5 // px between the places a line is sampled at, for the fill
  const light = new Uint8Array(Math.ceil(inline / STEP) + 1)
  for (let line = 0; line < lineCount; line++) {
    const spaces: Space[] = []
    if (!filled) {
      const onStroke: number[] = []
      for (let i = 0; i < stroke[line]!.length; i++) {
        const at = stroke[line]![i]!
        let free = at >= LEFT_CLEAR && at <= inline - RIGHT_CLEAR
        for (let t = 0; free && t < onStroke.length; t++) free = Math.abs(onStroke[t]! - at) >= MIN_GAP
        if (free) onStroke.push(at)
      }
      for (let i = 0; i < onStroke.length; i++) spaces.push({ at: onStroke[i]!, slack: 0 })
      // Off the stroke, spaces fall at uneven steps from an uneven start, so they don't line
      // up from one line of text to the next.
      for (let at = LEFT_CLEAR + hash2(line, 7) * GROUND_GAP, k = 0; at <= inline - RIGHT_CLEAR; k++) {
        let free = true
        for (let t = 0; free && t < onStroke.length; t++) free = Math.abs(onStroke[t]! - at) >= MIN_GAP * 1.15
        if (free) spaces.push({ at, slack: LOOSE_DRIFT })
        at += GROUND_GAP * (0.7 + 0.6 * hash2(line, 100 + k))
      }
    } else {
      // Which stretches of this line lie in the body and off the spiral's ribbon.
      const across = (line + 0.5) * LINE_HEIGHT
      const crossings: number[] = []
      for (let i = 0; i < body.length; i += 2) {
        const j = (i + 2) % body.length
        if (body[i + 1]! > across !== body[j + 1]! > across) {
          crossings.push(body[i]! + ((across - body[i + 1]!) / (body[j + 1]! - body[i + 1]!)) * (body[j]! - body[i]!))
        }
      }
      crossings.sort((a, b) => a - b)
      light.fill(0)
      for (let sample = 0; swirl && sample * STEP <= inline; sample++) {
        let onArm = false
        for (let i = 0; !onArm && i < band.length; i += 3) {
          const du = band[i]! - sample * STEP
          const dv = band[i + 1]! - across
          onArm = du * du + dv * dv < band[i + 2]! * band[i + 2]!
        }
        light[sample] = onArm ? 1 : 0
      }
      for (let c = 0; !swirl && c + 1 < crossings.length; c += 2) {
        for (let sample = Math.ceil(crossings[c]! / STEP); sample * STEP <= crossings[c + 1]!; sample++) {
          let onRibbon = false
          for (let i = 0; !onRibbon && i <= joint; i += 2) {
            const du = main[i]! - sample * STEP
            const dv = main[i + 1]! - across
            onRibbon = du * du + dv * dv < (RIBBON / 2) * (RIBBON / 2)
          }
          light[sample] = onRibbon ? 0 : 1
        }
      }
      // Stretches, with one too short for a word taking its neighbors' texture.
      const runs: { from: number, to: number, light: boolean }[] = []
      for (let sample = 0, from = 0; sample <= light.length; sample++) {
        if (sample < light.length && light[sample] === light[from]) continue
        const run = { from: from * STEP, to: Math.min(inline, sample * STEP), light: light[from] === 1 }
        const last = runs[runs.length - 1]
        if (last !== undefined && (run.to - run.from < MIN_GAP || last.light === run.light)) last.to = run.to
        else runs.push(run)
        from = sample
      }
      if (dense) {
        // Each stretch of sky is one joined word; the shape's stretches are as before.
        const row: number[] = []
        const rowSlack: number[] = []
        const rowChain: boolean[] = []
        for (let r = 0; r < runs.length; r++) {
          const run = runs[r]!
          if (r > 0) {
            row.push(run.from)
            rowSlack.push(0)
          }
          const cells = run.light ? Math.max(1, Math.round((run.to - run.from) / LIGHT_GAP)) : 1
          for (let i = 1; i < cells; i++) {
            row.push(run.from + ((run.to - run.from) * i) / cells)
            rowSlack.push(LIGHT_DRIFT)
          }
          for (let i = 0; i < cells; i++) rowChain.push(!run.light)
        }
        rows.push(row)
        slack.push(rowSlack)
        chain.push(rowChain)
        continue
      }
      for (let r = 0; r < runs.length; r++) {
        const run = runs[r]!
        if (r > 0) spaces.push({ at: run.from, slack: 0 }) // the edge itself
        const length = run.to - run.from
        if (run.light) {
          // Short words, evenly, so their spaces follow the shape's two edges.
          const cells = Math.max(1, Math.round(length / LIGHT_GAP))
          for (let i = 1; i < cells; i++) spaces.push({ at: run.from + (length * i) / cells, slack: LIGHT_DRIFT })
        } else {
          // Long words at uneven steps, so their spaces don't line up.
          let at = run.from + (r === 0 ? LEFT_CLEAR : 0) + GROUND_GAP * (0.55 + 0.6 * hash2(line, 300 + r))
          for (let k = 0; at < run.to - MIN_GAP * 1.2; k++) {
            spaces.push({ at, slack: LOOSE_DRIFT })
            at += GROUND_GAP * (0.7 + 0.6 * hash2(line, 400 + r * 37 + k))
          }
        }
      }
    }

    spaces.sort((a, b) => a.at - b.at)
    const kept: Space[] = []
    for (let i = 0; i < spaces.length; i++) {
      const space = spaces[i]!
      if (space.at < LEFT_CLEAR || space.at > inline - RIGHT_CLEAR) continue
      const last = kept[kept.length - 1]
      if (last === undefined || space.at - last.at >= MIN_GAP * 0.9) kept.push(space)
      else if (space.slack < last.slack) kept[kept.length - 1] = space // the more exact of two too close wins
    }
    const row: number[] = []
    const rowSlack: number[] = []
    for (let t = 0; t <= kept.length; t++) {
      const from = t === 0 ? 0 : kept[t - 1]!.at
      const to = t === kept.length ? inline : kept[t]!.at
      const parts = Math.ceil((to - from) / MAX_CELL)
      for (let part = 1; part < parts; part++) {
        row.push(from + ((to - from) * part) / parts)
        rowSlack.push(LOOSE_DRIFT)
      }
      if (t < kept.length) {
        row.push(to)
        rowSlack.push(kept[t]!.slack)
      }
    }
    rows.push(row)
    slack.push(rowSlack)
    chain.push(null)
  }
  return { rows, slack, chain, inline, sceneWidth, sceneHeight, path }
}

type Scene = {
  width: number
  sideways: boolean
  filled: boolean
  dense: boolean
  swirl: boolean
  sceneWidth: number
  sceneHeight: number
  inline: number
  text: string
  path: string
  stats: string
}

function buildScene(width: number, sideways: boolean, filled: boolean, dense: boolean, swirl: boolean): Scene {
  const start = performance.now()
  const drawing = buildDrawing(width, sideways, filled, filled && dense, filled && swirl)
  const rowCount = drawing.rows.length

  const lastUsedRow = new Int32Array(wordCount).fill(-100)
  const wordCost = new Float64Array(wordCount)
  const rows: SolvedRow[] = []
  let place = AT_START
  let firstOver = 0
  let text = ''
  let joined = false // whether the line before ended on a joined word that runs on
  let loosened = 0
  for (let r = 0; r < rowCount; r++) {
    const lines = drawing.rows[r]!
    const next = r + 1 < rowCount ? r + 1 : r
    let solved: SolvedRow | null = null
    for (let attempt = 0; solved === null && attempt < DRIFTS.length; attempt++) {
      for (let w = 0; w < wordCount; w++) {
        const since = r - lastUsedRow[w]!
        wordCost[w] = since <= 1 ? 6 : since <= 4 ? 2 : since <= 10 ? 0.5 : 0
      }
      // The next line's first word is at least its first cell less the most its space may move.
      const nextFirstAtLeast = drawing.rows[next]![0]! - spaceWidth / 2 - Math.max(drawing.slack[next]![0]!, DRIFTS[0]!)
      const nextChain = drawing.chain[next]
      solved = solveRow(lines, drawing.slack[r]!, drawing.chain[r]!, nextChain !== null && nextChain !== undefined && nextChain[0]!, drawing.inline, r, place, firstOver, nextFirstAtLeast, r === rowCount - 1, DRIFTS[attempt]!, wordCost)
      if (solved !== null && attempt > 0) loosened++
    }
    if (solved === null) break
    for (let w = 0; w < wordCount; w++) if (wordCost[w] === -1) lastUsedRow[w] = r
    rows.push(solved)
    place = solved.place
    firstOver = solved.white - spaceWidth + EDGE
    text += (r === 0 || joined ? '' : ' ') + solved.words.join(' ')
    joined = solved.joinsNext
  }
  const solveMs = performance.now() - start

  // Whether Pretext wraps the finished paragraph into the lines the solver planned.
  const wrapped = layoutWithLines(prepareWithSegments(text, FONT), drawing.inline, LINE_HEIGHT).lines
  let planned = wrapped.length === rows.length && rows.length === rowCount
  const shown = (text: string): string => text.replace(/\u200B/g, '').trim()
  for (let r = 0; planned && r < rows.length; r++) planned = shown(wrapped[r]!.text) === shown(rows[r]!.words.join(' '))

  let onStroke = 0
  let close = 0
  let spaces = 0
  for (let r = 0; r < rows.length; r++) {
    for (let g = 0; g < rows[r]!.gaps.length; g++, spaces++) {
      if (drawing.slack[r]![g]! > 0) continue
      onStroke++
      if (Math.abs(rows[r]!.gaps[g]! - drawing.rows[r]![g]!) <= TOLERANCE) close++
    }
  }
  const stats =
    `${rows.length} lines of ${FONT}, ${sideways ? 'on their side' : 'upright'} · ${spaces} word spaces, ${onStroke} of them on ` +
    `${filled ? 'an edge' : 'the stroke'}: ${close} within ${TOLERANCE}px of it · ${loosened} lines needed slack · solved in ${Math.round(solveMs)} ms · ` +
    (planned ? 'Pretext wraps the paragraph into the planned lines' : 'Pretext wraps the paragraph differently from the plan')
  return {
    width, sideways, filled, dense, swirl, sceneWidth: drawing.sceneWidth, sceneHeight: drawing.sceneHeight, inline: drawing.inline, text,
    path: drawing.path, stats,
  }
}

const sceneNode = document.getElementById('scene') as HTMLDivElement
const textNode = document.getElementById('text') as HTMLParagraphElement
const seamsNode = document.getElementById('seams') as unknown as SVGSVGElement
const seamPathNode = document.getElementById('seam-path') as unknown as SVGPathElement
const seamsButton = document.getElementById('seams-button') as HTMLButtonElement
const sideButton = document.getElementById('side-button') as HTMLButtonElement
const fillButton = document.getElementById('fill-button') as HTMLButtonElement
const denseButton = document.getElementById('dense-button') as HTMLButtonElement
const shapeButton = document.getElementById('shape-button') as HTMLButtonElement
const statsNode = document.getElementById('stats') as HTMLSpanElement

const st = {
  seamsShown: params.get('seams') === '1',
  sideways: SIDEWAYS_DEFAULT,
  filled: FILLED_DEFAULT,
  dense: DENSE_DEFAULT,
  swirl: SWIRL_DEFAULT,
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
  let sideways = st.sideways
  let filled = st.filled
  let dense = st.dense
  let swirl = st.swirl
  const click = st.events.click
  if (click !== null && click.target instanceof HTMLElement) {
    if (click.target.dataset['action'] === 'seams') seamsShown = !seamsShown
    if (click.target.dataset['action'] === 'side') sideways = !sideways
    if (click.target.dataset['action'] === 'fill') filled = !filled
    if (click.target.dataset['action'] === 'dense') dense = !dense
    if (click.target.dataset['action'] === 'shape') swirl = !swirl
  }

  // Layout
  const fitting = Math.floor((viewportWidth - 40) / SCENE_STEP) * SCENE_STEP
  const width = Math.max(SCENE_STEP * 4, Math.min(MAX_SCENE_WIDTH, fitting))
  const sceneChanged =
    scene === null || scene.width !== width || scene.sideways !== sideways || scene.filled !== filled ||
    scene.dense !== dense || scene.swirl !== swirl
  if (
    scene === null || scene.width !== width || scene.sideways !== sideways || scene.filled !== filled ||
    scene.dense !== dense || scene.swirl !== swirl
  ) scene = buildScene(width, sideways, filled, dense, swirl)

  // Commit
  st.seamsShown = seamsShown
  st.sideways = sideways
  st.filled = filled
  st.dense = dense
  st.swirl = swirl
  st.events.click = null

  // DOM writes
  if (sceneChanged) {
    sceneNode.style.width = `${scene.sceneWidth}px`
    sceneNode.style.height = `${scene.sceneHeight}px`
    textNode.style.width = `${scene.inline}px`
    textNode.style.font = FONT
    textNode.style.lineHeight = `${LINE_HEIGHT}px`
    textNode.style.color = INK
    // Sideways, the paragraph is an ordinary one turned a quarter turn, to read from the bottom up.
    textNode.style.transform = sideways ? `translateY(${scene.sceneHeight}px) rotate(-90deg)` : 'none'
    textNode.textContent = scene.text
    seamPathNode.setAttribute('d', scene.path)
    seamPathNode.style.strokeWidth = `${spaceWidth}px`
    statsNode.textContent = scene.stats
  }
  seamsNode.style.display = seamsShown ? 'block' : 'none'
  seamsButton.textContent = seamsShown ? 'Hide the drawing' : 'Show the drawing'
  sideButton.textContent = sideways ? 'Text on its side' : 'Text upright'
  fillButton.textContent = filled ? 'Shape filled' : 'Shape as a stroke'
  denseButton.textContent = dense ? 'Sky in joined words' : 'Sky in long words'
  shapeButton.textContent = swirl ? 'Swirl' : 'Traced cloud'
}

scheduleRender()
