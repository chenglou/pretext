// A check on the store study's short questions, not a test: the study counted its word facts on the bench's messages,
// which are 10,000 random slices of a few texts, so a word met once is met again. Here every unit of a source text is
// used once, as in tools/store-real-text.ts (the same cutting, copied), and the facts are counted as messages accumulate.
// No Canvas and no engine: a fact is a string the recipe would measure.
//
//   bun rebuild/tools/store-word-facts.ts --set=ascii-once|languages-once|bench-latin|bench-mix [--count=N] [--out=<report.json>]
//
// A word is what stands between two U+0020 of a message. Its fact, as the study proposes for Blink, is the word with the
// spaces beside it as it stands in the text (the first word has none before it, the last none after it). The upper bound
// counts all four forms of each word (alone, a space before, after, both), which a line edge can ask for.
// Tallied per block of messages: words a message, facts new to the page, and apart from them
// - long words (over 16 units: a URL, or text of a script written without spaces), which the study leaves on today's path;
// - words with no character of a script of their own (digits, punctuation, emoji), whose shaping takes its script from
//   the text around them, so a fact measured out of its run may not be the run's.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CHAT_LENGTH_CLASSES, buildChat, chatText } from '../bench/cases.ts'

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const set = options.get('set') ?? 'ascii-once'

// ---- The messages (tools/store-real-text.ts) ----

const CORPORA = resolve(import.meta.dir, '../../corpora')
const NO_SPACES = ['zh', 'ja']

function flow(id: string): string {
  const parts = readFileSync(join(CORPORA, `${id}.txt`), 'utf8').split(/\n\s*\n/)
  const kept: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.replace(/\s+/g, ' ').trim()
    if (part !== '' && !/^[-{]/.test(part)) kept.push(part)
  }
  return kept.join(NO_SPACES.includes(id.slice(0, 2)) ? '' : ' ')
}

function toAscii(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, ' - ').replace(/–/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[^ -~]/g, '')
}

let state = 12345
const random = (): number => {
  state = (Math.imul(state, 1103515245) + 12345) >>> 0
  return state / 4294967296
}

function nextLength(): number {
  const r = random()
  let lengths = CHAT_LENGTH_CLASSES[CHAT_LENGTH_CLASSES.length - 1]!
  for (let i = 0, edge = 0; i < CHAT_LENGTH_CLASSES.length; i++) {
    edge += CHAT_LENGTH_CLASSES[i]!.share
    if (r < edge) {
      lengths = CHAT_LENGTH_CLASSES[i]!
      break
    }
  }
  return lengths.min + Math.floor(random() * (lengths.max - lengths.min + 1))
}

function cutOnce(source: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < source.length) {
    let end = Math.min(source.length, at + nextLength())
    if (end < source.length) {
      const space = source.lastIndexOf(' ', end)
      if (space > at + 4) end = space
      else if (source.charCodeAt(end - 1) >= 0xd800 && source.charCodeAt(end - 1) < 0xdc00) end++
    }
    const text = source.slice(at, end).trim()
    if (text !== '') out.push(text)
    at = end
  }
  return out
}

function messagesOf(name: string): string[] {
  switch (name) {
    case 'ascii-once': return cutOnce(toAscii(flow('en-gatsby-opening')))
    case 'languages-once': {
      const ids = readdirSync(CORPORA).filter(file => file.endsWith('.txt') && file !== 'mixed-app-text.txt' && file !== 'ar-risalat-al-ghufran-part-1.txt').map(file => file.slice(0, -4)).sort()
      const lists = ids.map(id => cutOnce(flow(id)))
      const out: string[] = []
      for (let round = 0, more = true; more; round++) {
        more = false
        for (let i = 0; i < lists.length; i++) {
          if (round >= lists[i]!.length) continue
          out.push(lists[i]![round]!)
          more = true
        }
      }
      return out
    }
    case 'bench-latin': return buildChat('latin', Number(options.get('count') ?? 10000)).map(chatText)
    case 'bench-mix': return buildChat('mix', Number(options.get('count') ?? 10000)).map(chatText)
    default: throw new Error(`Unknown set ${name}`)
  }
}

const all = messagesOf(set)
const messages = options.get('count') === undefined ? all : all.slice(0, Number(options.get('count')))

// ---- The tally ----

const LONG = 16
const NO_SCRIPT = /^[\p{Script=Common}\p{Script=Inherited}]+$/u
const EDGES = [100, 500, 1000, 2500, 5000, 10000]

type Block = { messages: number; words: number; shortWords: number; newAsItStands: number; newOfFourForms: number; longWords: number; newLongWords: number; longUnits: number; noScript: number; newNoScript: number }
const newBlock = (): Block => ({ messages: 0, words: 0, shortWords: 0, newAsItStands: 0, newOfFourForms: 0, longWords: 0, newLongWords: 0, longUnits: 0, noScript: 0, newNoScript: 0 })

const facts = new Set<string>()
const words = new Set<string>()
const longs = new Set<string>()
const blocks: Array<{ to: number; block: Block }> = []
let block = newBlock()
let factUnits = 0

for (let m = 0; m < messages.length; m++) {
  const parts = messages[m]!.split(' ')
  block.messages++
  for (let i = 0; i < parts.length; i++) {
    const word = parts[i]!
    if (word === '') continue
    block.words++
    if (word.length > LONG) {
      block.longWords++
      block.longUnits += word.length
      if (!longs.has(word)) {
        longs.add(word)
        block.newLongWords++
      }
      continue
    }
    block.shortWords++
    const fact = `${i > 0 ? ' ' : ''}${word}${i + 1 < parts.length ? ' ' : ''}`
    const noScript = NO_SCRIPT.test(word)
    if (noScript) block.noScript++
    if (!facts.has(fact)) {
      facts.add(fact)
      factUnits += fact.length
      block.newAsItStands++
      if (noScript) block.newNoScript++
    }
    if (!words.has(word)) {
      words.add(word)
      block.newOfFourForms += 4
    }
  }
  if (EDGES.includes(m + 1) || m + 1 === messages.length) {
    blocks.push({ to: m + 1, block })
    block = newBlock()
  }
}

const per = (n: number, over: number): number => Math.round(100 * n / over) / 100
const report = {
  set, messages: messages.length, longWordOver: LONG,
  storedAfterAll: { factsAsTheyStand: facts.size, units: factUnits, distinctShortWords: words.size, distinctLongWords: longs.size },
  blocks: blocks.map(({ to, block: b }, i) => ({
    messages: `${(blocks[i - 1]?.to ?? 0) + 1} to ${to}`,
    wordsPerMessage: per(b.words, b.messages),
    shortWordsPerMessage: per(b.shortWords, b.messages),
    newFactsAsTheyStandPerMessage: per(b.newAsItStands, b.messages),
    newFactsOfFourFormsPerMessage: per(b.newOfFourForms, b.messages),
    shareOfShortWordsMetBefore: per(b.shortWords - b.newAsItStands, b.shortWords),
    longWordsPerMessage: per(b.longWords, b.messages),
    newLongWordsPerMessage: per(b.newLongWords, b.messages),
    longWordUnitsPerMessage: per(b.longUnits, b.messages),
    wordsWithNoScriptPerMessage: per(b.noScript, b.messages),
    newWordsWithNoScriptPerMessage: per(b.newNoScript, b.messages),
  })),
}
const text = `${JSON.stringify(report, null, 1)}\n`
if (options.get('out') !== undefined) writeFileSync(resolve(options.get('out')!), text)
else process.stdout.write(text)
