// Which string storage reaches Blink from a page's script, and what Blink does with it (specs/blink-RESULTS.md "String
// storage"). Blink takes a JS string as an 8-bit WTF string when V8 holds it in one byte (v8::String::IsOneByte,
// to_blink_string.cc:216-227), Canvas shapes an 8-bit string as one Latin segment and runs RunSegmenter over a 16-bit
// one (harfbuzz_shaper.cc:1072-1101), and a paragraph is segmented as soon as one of its text strings is stored in 16 bits
// (inline_items_builder.cc:725, inline_node.cc:1256-1266). Amiri shapes 13 brackets at 48px to 159.119873046875 as Latin
// and to 285.79193115234375 as Common, so a width names the storage Blink saw.
// - S1: which operations on a two-byte string make V8 hand Blink one byte afterwards. V8 internalizes a string used as a
//   key (Map, Set, a property name), an internalized string whose units fit is one-byte, and the looked-up string becomes
//   a ThinString of the internalized one's representation (builtins-collections-gen.cc:2590-2604, string-table.cc:398-427,
//   factory.cc:1239-1257 and :1293-1300, string.cc:164-166).
// - S2: which ways of building a Latin-1-only string give two bytes.
// - S3: one canvas answers a string and a word by whichever storage it shaped first; two canvases don't mix.
// - S4: the storage of a text node by how it was made, read from the paragraph's shaping.
// - S5: the library's own bundled module on a paragraph that holds 13 brackets under Arabic and under Latin: nothing
//   looks the measured string up on its way to measureText (src/measure/canvas.ts width; the Blink port keeps no memo), so
//   Canvas gets the two-byte slice the port built, and each storage has its contexts (engines/blink/shape.ts contextsOf),
//   so neither order of the two changes an answer, the first time or asked again.
// - S6: a Latin range of script-neutral characters with a space, in a font Canvas shapes whole: the 8-bit string with
//   U+0020 is the DOM's width, the 16-bit one with U+2028 isn't (engines/blink/shape.ts spacesStay).
// Every probe returns raw values and `checks`.
//
// Run under the browser lock (from the worktree):
//   python3 .artifacts/session/with-browser-lock.py blink-storage -- bun rebuild/probes/runner.ts --browser=chrome \
//     --probes=rebuild/probes/blink-storage.ts --out=.artifacts/probes/blink/storage --probe-timeout-ms=120000
import { join } from 'node:path'
import type { Probe } from './types.ts'

const LATIN = 159.119873046875
const COMMON = 285.79193115234375

// Shared by every page script: 13 brackets built at run time from codes, one-byte as String.fromCharCode gives them and
// two-byte as a slice of a two-byte string; a fresh canvas set up as the port's; and the storage a width names.
const PRELUDE = `
  const codes = [40,40,40,40,40,40,40,40,40,40,40,40,40]
  const one = () => String.fromCharCode(...codes)
  const two = () => ('\\u0100' + one()).slice(1)
  const font = 'normal 400 48px Amiri'
  const fresh = () => {
    const c = new OffscreenCanvas(1, 1).getContext('2d')
    c.lang = 'en'; c.font = font; c.letterSpacing = '0px'; c.wordSpacing = '0px'; c.fontKerning = 'auto'; c.textRendering = 'optimizeLegibility'; c.direction = 'ltr'
    return c
  }
  const W = s => fresh().measureText(s).width
  const storage = w => w === ${LATIN} ? 'one-byte' : w === ${COMMON} ? 'two-byte' : 'other ' + w
  const checks = []
  const expect = (name, measured, expected) => checks.push({ name, ok: measured === expected, expected, measured })
`

const KEYED = ['Map.get', 'Map.has', 'Map.set', 'Map.delete', 'Set.has', 'Set.add', 'property read', 'property write', 'in', 'Object.hasOwn', 'Symbol.for']
const UNKEYED = ['nothing', 'length and charCodeAt', 'codePointAt loop', '=== one-byte twin', '< one-byte twin', 'indexOf', 'includes', 'regex test', 'for of',
  'held in an array', 'held as a property value', 'held as a Map value', 'JSON.stringify', 'localeCompare', 'Intl.Segmenter', 'measured before', 'garbage between']

const S1 = `
  ${PRELUDE}
  const ops = {
    'nothing': s => {},
    'Map.get': s => { new Map().get(s) },
    'Map.has': s => { new Map().has(s) },
    'Map.set': s => { new Map().set(s, 1) },
    'Map.delete': s => { new Map().delete(s) },
    'Set.has': s => { new Set().has(s) },
    'Set.add': s => { new Set().add(s) },
    'property read': s => { ({})[s] },
    'property write': s => { const o = {}; o[s] = 1 },
    'in': s => { s in {} },
    'Object.hasOwn': s => { Object.hasOwn({}, s) },
    'Symbol.for': s => { Symbol.for(s) },
    'length and charCodeAt': s => { let n = 0; for (let i = 0; i < s.length; i++) n += s.charCodeAt(i); return n },
    'codePointAt loop': s => { let n = 0; for (let i = 0; i < s.length; i++) n += s.codePointAt(i); return n },
    '=== one-byte twin': s => s === one(),
    '< one-byte twin': s => s < one(),
    'indexOf': s => s.indexOf(')'),
    'includes': s => s.includes('(('),
    'regex test': s => /\\(+/.test(s),
    'for of': s => { let n = 0; for (const ch of s) n += ch.length; return n },
    'held in an array': s => { (globalThis.__held ??= []).push(s) },
    'held as a property value': s => { (globalThis.__held ??= []).push({ context: 0, text: s, width: 1 }) },
    'held as a Map value': s => { new Map().set(1, s) },
    'JSON.stringify': s => JSON.stringify(s),
    'localeCompare': s => s.localeCompare(one()),
    'Intl.Segmenter': s => [...new Intl.Segmenter('en', { granularity: 'word' }).segment(s)].length,
    'measured before': s => { W(s) },
    'garbage between': s => { let keep = []; for (let i = 0; i < 300; i++) { keep = []; for (let j = 0; j < 20000; j++) keep.push({ i, j, t: 'x' + j }) } return keep.length },
  }
  const out = { oneByte: W(one()), twoByte: W(two()), after: {} }
  expect('13 brackets built from codes are one-byte', storage(out.oneByte), 'one-byte')
  expect('their slice out of a two-byte string is two-byte', storage(out.twoByte), 'two-byte')
  for (const name of Object.keys(ops)) {
    const s = two()
    ops[name](s)
    out.after[name] = W(s)
  }
  for (const name of ${JSON.stringify(KEYED)}) expect('two-byte slice after ' + name, storage(out.after[name]), 'one-byte')
  for (const name of ${JSON.stringify(UNKEYED)}) expect('two-byte slice after ' + name, storage(out.after[name]), 'two-byte')
  // A string Blink took once is external; a key lookup afterwards still turns it into one byte for the next canvas.
  const s = two()
  out.measuredThenKeyed = [W(s), (new Map().get(s), W(s))]
  expect('a measured two-byte slice, looked up, then measured on another canvas', storage(out.measuredThenKeyed[1]), 'one-byte')
  // A key that is another string object with the same characters leaves the slice alone, whichever storage the key has.
  const t = two()
  new Map().get(one()); new Map().get('2' + t); new Map().get(t + '\\u0000')
  out.otherObjectKeyed = W(t)
  expect('two-byte slice after lookups of other strings that hold its characters', storage(out.otherObjectKeyed), 'two-byte')
  // Characters no literal of the page holds, so no one-byte internalized twin exists before the lookup.
  const rare = Array.from({ length: 13 }, (_, i) => '([{)]}'.charCodeAt((i * 7 + 3) % 6))
  const rareOne = () => String.fromCharCode(...rare)
  const rareTwo = () => ('\\u0100' + rareOne()).slice(1)
  const r = rareTwo()
  new Map().get(r)
  out.rare = { oneByte: W(rareOne()), twoByte: W(rareTwo()), twoByteAfterMapGet: W(r) }
  expect('supplementary: the rare brackets differ by storage', out.rare.oneByte !== out.rare.twoByte, true)
  expect('a two-byte slice without an internalized twin, after Map.get', out.rare.twoByteAfterMapGet, out.rare.oneByte)
  return { ...out, checks }
`

const S2 = `
  ${PRELUDE}
  const text = one()
  const wide14 = ('\\u0100' + text + '(').slice(1)
  const arabicSource = text + ' \\u0627\\u0628'
  const made = {
    'String.fromCharCode': [text, 'one-byte'],
    'literal': ['(((((((((((((', 'one-byte'],
    'slice(1) after U+0100': [('\\u0100' + text).slice(1), 'two-byte'],
    'substring(1) after U+0100': [('\\u0100' + text).substring(1), 'two-byte'],
    'slice(0, -1) before U+0100': [(text + '\\u0100').slice(0, -1), 'two-byte'],
    'slice of a two-byte slice': [wide14.slice(0, 13), 'two-byte'],
    'two-byte slice + empty string': [two() + '', 'two-byte'],
    'template of a two-byte slice': [\`\${two()}\`, 'two-byte'],
    'join of one two-byte slice': [[two()].join(''), 'two-byte'],
    'join of its characters': [Array.from(two()).join(''), 'one-byte'],
    'two one-byte halves concatenated': [text.slice(0, 7) + text.slice(7), 'one-byte'],
    'two short slices of a two-byte string concatenated': [('\\u0100' + text).slice(1, 8) + ('\\u0100' + text).slice(8), 'one-byte'],
    'split of a two-byte string at a space': [arabicSource.split(' ')[0], 'two-byte'],
    'regex match in a two-byte string': [/\\(+/.exec(arabicSource)[0], 'two-byte'],
    'JSON.parse of a one-byte source': [JSON.parse(JSON.stringify(text)), 'one-byte'],
    'JSON.parse of a two-byte source': [JSON.parse('["\\u0627", ' + JSON.stringify(text) + ']')[1], 'one-byte'],
    'JSON.parse of an escaped source': [JSON.parse('"\\\\u0028' + text.slice(1) + '"'), 'one-byte'],
    'TextDecoder of ASCII bytes': [new TextDecoder().decode(new TextEncoder().encode(text)), 'one-byte'],
    'normalize of a two-byte slice': [two().normalize('NFC'), null],
    'toLowerCase of a two-byte slice': [two().toLowerCase(), null],
    'replace without a match in a two-byte slice': [two().replace('x', 'y'), null],
    'padEnd of a two-byte slice': [two().padEnd(13), null],
  }
  const out = {}
  for (const name of Object.keys(made)) {
    const [s, expected] = made[name]
    if (s !== text) throw new Error(name + ' built other characters')
    out[name] = storage(W(s))
    if (expected !== null) expect(name, out[name], expected)
  }
  // A concatenation of two two-byte slices is a two-byte cons string, and flattening keeps its storage (String::Flatten
  // allocates by the cons string's own representation, string-inl.h:884-896): measured as built, and after charCodeAt
  // flattened it. 26 brackets, so the widths are their own.
  const cons = () => two() + two()
  const flattened = cons()
  flattened.charCodeAt(25)
  out.cons = { oneByte: W(text + text), asBuilt: W(cons()), flattened: W(flattened) }
  expect('a cons string of two two-byte slices is two-byte', out.cons.asBuilt !== out.cons.oneByte, true)
  expect('flattening a two-byte cons string keeps its storage', out.cons.flattened, out.cons.asBuilt)
  // The slice rule's threshold: 12 units are copied into one byte, 13 stay a slice of the two-byte string.
  const bracket = n => '('.repeat(n)
  out.threshold = {}
  for (const n of [11, 12, 13, 14]) out.threshold[n] = [W(bracket(n)), W(('\\u0100' + bracket(n)).slice(1))]
  expect('a 12-unit slice of a two-byte string is one-byte', out.threshold[12][0] === out.threshold[12][1], true)
  expect('a 13-unit slice of a two-byte string is two-byte', out.threshold[13][0] !== out.threshold[13][1], true)
  // Text the DOM hands back follows the node's storage.
  const node8 = document.createTextNode(text)
  const given = two()
  const node16 = document.createTextNode(given)
  const assigned = document.createTextNode('x')
  assigned.data = two()
  const data16 = node16.data
  out.fromDom = { data8: storage(W(node8.data)), given16: storage(W(given)), data16: storage(W(data16)), sameAsGiven: data16 === given, data16Again: storage(W(node16.data)),
    nodeValue16: storage(W(node16.nodeValue)), substringData16: storage(W(node16.substringData(0, 13))), assigned16: storage(W(assigned.data)), textContent16: storage(W(node16.textContent)) }
  expect('the data of a text node made from a one-byte string', out.fromDom.data8, 'one-byte')
  // The node keeps its 16 bits (S4), but what script reads back measures as one byte.
  expect('supplementary: the data read back from a text node made from a two-byte string', out.fromDom.data16, 'one-byte')
  expect('supplementary: the data read back from a text node assigned a two-byte string', out.fromDom.assigned16, 'one-byte')
  return { ...out, checks }
`

const S3 = `
  ${PRELUDE}
  const out = {}
  const a = fresh()
  out.oneByteFirst = [a.measureText(one()).width, a.measureText(two()).width, a.measureText(one()).width]
  const b = fresh()
  out.twoByteFirst = [b.measureText(two()).width, b.measureText(one()).width, b.measureText(two()).width]
  expect('one canvas, one-byte first: both answers', out.oneByteFirst.map(storage).join(), 'one-byte,one-byte,one-byte')
  expect('one canvas, two-byte first: both answers', out.twoByteFirst.map(storage).join(), 'two-byte,two-byte,two-byte')
  // A word of a longer string is cached alone where the font is shaped word by word (plain_text_node.cc:377-425; Amiri
  // isn't: its lookups hold the space glyph), under its characters and direction like a whole string
  // (frame_shape_cache.cc:45-65, 135-149). None of these fonts shapes five brackets differently as Latin and as Common
  // outside Amiri, so the values are raw: a word answering a string of the other storage is read from source alone.
  // U+0020 ends a Canvas word; the Arabic letter makes the string two-byte.
  out.word = {}
  for (const family of ['Amiri', '"Noto Naskh Arabic"', '"Geeza Pro"', '"Times New Roman"', 'Arial']) {
    const ctx = () => { const c = fresh(); c.font = 'normal 400 48px ' + family; return c }
    const short = '(((((', longer = '\u0627 ' + short
    const shortAlone = ctx().measureText(short).width, longerAlone = ctx().measureText(longer).width
    const c = ctx()
    c.measureText(longer)
    const shortAfterLonger = c.measureText(short).width
    const d = ctx()
    d.measureText(short)
    const longerAfterShort = d.measureText(longer).width
    out.word[family] = { shortAlone, longerAlone, shortAfterLonger, longerAfterShort }
  }
  expect('Amiri is shaped whole, so a word of its string answers nothing else', out.word.Amiri.shortAfterLonger === out.word.Amiri.shortAlone && out.word.Amiri.longerAfterShort === out.word.Amiri.longerAlone, true)
  // Two canvases of equal settings share nothing.
  const e = fresh(), f = fresh()
  out.apart = [e.measureText(one()).width, f.measureText(two()).width, e.measureText(one()).width, f.measureText(two()).width]
  expect('two canvases, one per storage', out.apart.map(storage).join(), 'one-byte,two-byte,one-byte,two-byte')
  return { ...out, checks }
`

// The paragraph is one nowrap block in Amiri; the width of the span around the 13 brackets names their script.
const S4 = `
  ${PRELUDE}
  // A block of its own per way: a block laid out again with equal text_content keeps its earlier script segments
  // whatever the storage (inline_node.cc:1231-1254).
  host.innerHTML = ''
  const widthOf = build => {
    const block = document.createElement('div')
    block.style.cssText = 'font: normal 400 48px Amiri; white-space: nowrap; width: max-content; text-rendering: optimizeLegibility'
    block.lang = 'en'
    host.append(block)
    const span = document.createElement('span')
    block.append(span)
    const width = (build(span, block) || span).getBoundingClientRect().width
    block.remove()
    return width
  }
  const near = (w, v) => Math.abs(w - v) < 0.05
  const script = w => near(w, ${LATIN}) ? 'Latin' : near(w, ${COMMON}) ? 'Common' : 'other ' + w
  const ways = {
    'createTextNode of a one-byte string': [s => s.append(document.createTextNode(one())), 'Latin'],
    'createTextNode of a two-byte slice': [s => s.append(document.createTextNode(two())), 'Common'],
    'createTextNode of a two-byte slice after a Map lookup': [s => { const t = two(); new Map().get(t); s.append(document.createTextNode(t)) }, 'Latin'],
    'textContent of a two-byte slice': [s => { s.textContent = two() }, 'Common'],
    'append of a two-byte slice': [s => { s.append(two()) }, 'Common'],
    'innerHTML of the characters': [s => { s.innerHTML = one() }, 'Latin'],
    'innerHTML of a two-byte slice': [s => { s.innerHTML = two() }, 'Latin'],
    'innerHTML beside an Arabic element, the parser\\'s nodes': [(s, b) => { b.innerHTML = '<span>' + one() + '</span><i>\\u0627</i>'; return b.firstChild }, null],
    'data assigned a two-byte slice': [s => { const n = document.createTextNode('x'); s.append(n); n.data = two() }, 'Common'],
    'appendData of a two-byte slice to an empty node': [s => { const n = document.createTextNode(''); s.append(n); n.appendData(two()) }, null],
    'deleteData of the wide character of a node': [s => { const n = document.createTextNode(one() + '\\u0100'); s.append(n); n.deleteData(13, 1) }, null],
    'splitText before the wide character of a node': [s => { const n = document.createTextNode(one() + '\\u0100'); s.append(n); n.splitText(13).remove() }, null],
    'a one-byte node beside a one-byte sibling': [(s, b) => { s.append(document.createTextNode(one())); const i = document.createElement('i'); i.textContent = 'abc'; b.append(i) }, 'Latin'],
    'a one-byte node beside a two-byte sibling of full stops': [(s, b) => { s.append(document.createTextNode(one())); const i = document.createElement('i'); i.append(document.createTextNode(('\\u0100' + '.............').slice(1))); b.append(i) }, 'Common'],
    'a one-byte node beside a one-byte sibling of full stops': [(s, b) => { s.append(document.createTextNode(one())); const i = document.createElement('i'); i.append(document.createTextNode('.............')); b.append(i) }, 'Latin'],
    'a one-byte node beside a sibling that holds U+FFFC alone': [(s, b) => { s.append(document.createTextNode(one())); const i = document.createElement('i'); i.append(document.createTextNode('\\ufffc')); b.append(i) }, 'Common'],
    'a one-byte node beside an inline-block': [(s, b) => { s.append(document.createTextNode(one())); const i = document.createElement('i'); i.style.cssText = 'display: inline-block; width: 10px; height: 10px'; b.append(i) }, 'Latin'],
    'a one-byte node beside a sibling that holds U+2014': [(s, b) => { s.append(document.createTextNode(one())); const i = document.createElement('i'); i.append(document.createTextNode('\\u2014')); b.append(i) }, 'Common'],
  }
  const out = {}
  for (const name of Object.keys(ways)) {
    const [build, expected] = ways[name]
    const width = widthOf(build)
    out[name] = { width, script: script(width) }
    if (expected !== null) expect(name, out[name].script, expected)
  }
  host.innerHTML = ''
  return { ...out, checks }
`

// The library's own module lays out a paragraph whose 13 brackets stand after an Arabic word and after a Latin one in one
// Amiri style, in both orders. The page notes what Canvas answered (the library keeps no log; the string passes through
// untouched): the brackets as a two-byte slice and as a one-byte string, each on a context of its storage, whichever was
// asked first, and every time either is asked again. A context's partition is the library's name for it, which the
// prepared paragraph's list of contexts keeps.
const S5 = `
  const lib = await import('data:text/javascript;base64,' + LIBRARY)
  const checks = []
  const expect = (name, measured, expected) => checks.push({ name, ok: measured === expected, expected, measured })
  const run = '(((((((((((((', arabic = '\\u0639\\u0631\\u0628\\u064a'
  const font = { family: 'Amiri', size: 48, weight: 400, style: 'normal', facts: lib.UNKNOWN_FONT_FACTS }
  const style = { font, letterSpacing: 0, wordSpacing: 0, whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'anywhere', lineBreak: 'auto', tabSize: 8 }
  const env = { engine: 'blink', build: lib.PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en', dictionaryBreaks: { kind: 'v8-break-iterator' } }
  // Each run of brackets is a shaping group of its own, after a span of another font size that gives it its script.
  const other = text => ({ ...style, font: { ...font, size: 40 }, kind: 'span', lang: null, inlineStart: lib.NO_BOX_EDGE, inlineEnd: lib.NO_BOX_EDGE, verticalAlign: 'baseline', children: [{ kind: 'text', text }] })
  const out = {}
  for (const [order, words] of [['two-byte first', [arabic, 'abc']], ['one-byte first', ['abc', arabic]]]) {
    const content = [other(words[0]), { kind: 'text', text: run }, other(words[1]), { kind: 'text', text: run }]
    const paragraph = { ...style, content, lineHeight: 60, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start' }
    const proto = OffscreenCanvasRenderingContext2D.prototype
    const measureText = proto.measureText
    const calls = []
    proto.measureText = function (text) {
      const metrics = measureText.call(this, text)
      calls.push({ ctx: this, text, width: metrics.width })
      return metrics
    }
    let prepared
    let lines = 0
    try {
      prepared = lib.prepare(paragraph, env, true)
      for (let start = lib.firstLine(prepared); start !== null; lines++) start = lib.fillLine(prepared, start, { width: 4000, left: 0, right: 0 }).next
    } finally {
      proto.measureText = measureText
    }
    const settingsOf = ctx => prepared.state.canvases.entries.find(context => context.ctx === ctx).settings
    const asks = calls.filter(call => call.text === run).map(call => ({ partition: settingsOf(call.ctx).partition, letterSpacing: settingsOf(call.ctx).letterSpacing, width: call.width }))
    out[order] = { asks, contexts: prepared.state.canvases.size, lines }
    const plain = asks.filter(ask => ask.letterSpacing === '0px')
    const partitions = [...new Set(plain.map(ask => ask.partition))]
    expect(order + ': the brackets are first asked in both storages, in this order', partitions.join(), order === 'two-byte first' ? '16bit,8bit' : '8bit,16bit')
    // Asked again, a context answers as it did the first time.
    for (const partition of partitions) {
      const widths = [...new Set(plain.filter(ask => ask.partition === partition).map(ask => ask.width))]
      expect(order + ': the ' + partition + ' context answers, every time', widths.length === 1 ? widths[0] : widths.join(), partition === '8bit' ? ${LATIN} : ${COMMON})
    }
  }
  return { ...out, checks }
`

// A Latin range of script-neutral characters with a space, as engines/blink/shape.ts spacesStay measures it: brackets,
// a space and brackets in Amiri, which Canvas shapes whole. The DOM shapes the text node's 8-bit text as one Latin
// segment; the 8-bit Canvas string with U+0020 gives that width at the zoomed size, the 16-bit one with U+2028 for the
// space is shaped as Common.
const S6 = `
  ${PRELUDE}
  host.innerHTML = ''
  const block = document.createElement('div')
  block.style.cssText = 'font: normal 400 48px Amiri; white-space: nowrap; width: max-content; text-rendering: optimizeLegibility'
  block.lang = 'en'
  const span = document.createElement('span')
  span.append(document.createTextNode('((((( ((((('))
  block.append(span)
  host.append(block)
  const dom = span.getBoundingClientRect().width
  block.remove()
  const zoom = devicePixelRatio
  const at = text => { const c = fresh(); c.font = 'normal 400 ' + 48 * zoom + 'px Amiri'; return c.measureText(text).width / zoom }
  const out = { dom, zoom, oneByteWithSpace: at('((((( ((((('), twoByteWithLineSeparator: at('(((((\\u2028((((('), oneByteNoSpace: at('((((((((((') }
  expect('the 8-bit string with U+0020 is the DOM width to a LayoutUnit', Math.abs(out.oneByteWithSpace - dom) <= 1 / 64, true)
  expect('the 16-bit string with U+2028 is shaped as Common, another width', Math.abs(out.twoByteWithLineSeparator - dom) > 10, true)
  return { ...out, checks }
`

function probe(id: string, source: string, note: string): Probe {
  return { id: `blink-storage ${id}`, spec: `blink-storage ${id.slice(0, 2)}`, pageLang: 'en', browsers: ['chrome'], fontFixtures: ['Amiri', 'Noto Naskh Arabic'], html: '<div id="t"></div>', observe: [{ kind: 'script', source }], note }
}

export default async function storageProbes(): Promise<Probe[]> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/index.ts')], format: 'esm', target: 'browser' })
  if (!built.success) throw new Error(`src/index.ts didn't bundle: ${built.logs.map(log => log.message).join('\n')}`)
  const library = Buffer.from(await built.outputs[0]!.text()).toString('base64')
  return [
    probe('S1 what makes a two-byte string one-byte', S1, 'A two-byte slice of 13 brackets after each operation, measured on a fresh canvas: a key lookup turns it into one byte, nothing else does.'),
    probe('S2 which ways of building give two bytes', S2, 'The storage Blink sees for 13 brackets built in each way.'),
    probe('S3 one canvas keeps the first shaping', S3, 'A string answers by the storage shaped first on a canvas; canvases share nothing.'),
    probe('S4 text node storage', S4, 'The script the DOM shapes 13 brackets under, by how their text node and its siblings were made.'),
    probe('S6 spaces stay in a Latin range of script-neutral characters', S6, 'The DOM width of brackets, a space and brackets in Amiri beside the 8-bit Canvas string with U+0020 and the 16-bit one with U+2028.'),
    probe('S5 the library asks the storage it built', `const LIBRARY = ${JSON.stringify(library)};\n${S5}`, 'The library\'s prepare and fillLine over a paragraph that holds 13 brackets under Arabic and under Latin, in both orders: the call log\'s widths.'),
  ]
}
