// The grapheme check (build.ts): findGraphemeEnds under the table the engine profile picks, and
// under the other table, against the runtime's own Intl.Segmenter, on:
// - every code point in contexts that tell the classes of the character rules apart;
// - every corpus paragraph and suite text, whole, and the segments prepareWithSegments() makes;
// - random strings of code points drawn from two to five random classes.
// page.ts runs it in a browser; offline.ts under Bun, or under Node once bundled.
import type { CharTable } from '../../src/generated/engine-break-data.ts'
import { findGraphemeEnds } from '../../src/graphemes.ts'
import { prepareWithSegments } from '../../src/layout.ts'
import { getEngineProfile } from '../../src/measurement.ts'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const buffer = new Int32Array(1 << 16)

function intlEnds(text: string): number[] {
  const ends: number[] = []
  for (const part of segmenter.segment(text)) ends.push(part.index + part.segment.length)
  return ends
}

// Whether both find the same ends; null when they do, else Intl.Segmenter's and ours.
function compare(table: CharTable, text: string, ends: number[]): [number[], number[]] | null {
  const scratch = text.length <= buffer.length ? buffer : new Int32Array(text.length)
  const count = findGraphemeEnds(table, text, 0, text.length, scratch)
  let same = count === ends.length
  for (let i = 0; same && i < count; i++) same = scratch[i] === ends[i]
  return same ? null : [ends, Array.from(scratch.subarray(0, count))]
}

type Section = { checked: number; differences: Record<string, number>; examples: unknown[] }

// Contexts around a code point X, as [before, after]: Prepend, CR, Hangul, emoji, InCB and
// regional indicator contexts, and X repeated.
const contexts: [string, string][] = [
  ['a', 'a'], ['', '\u0301'], ['\u0600', ''], ['\r', ''], ['\u1100', '\u1161'], ['', '\u11A8'], ['', '\u1161'],
  ['\u{1F600}', '\u200D\u{1F600}'], ['\u{1F600}\u200D', ''], ['\u0915', '\u0915'], ['\u0915', '\u094D\u0915'],
  ['\u0915\u094D', ''], ['\u{1F1E6}', ''], ['', 'XX'],
]

function hex(c: number): string {
  return c.toString(16).toUpperCase().padStart(4, '0')
}

export async function runGraphemeCheck(texts: readonly string[], fuzz: number, log: (line: string) => void): Promise<unknown> {
  const pause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
  const own = getEngineProfile().graphemeTable
  const tables: CharTable[] = own === 'apple/char' ? ['apple/char', 'chromium/char'] : ['chromium/char', 'apple/char']
  const sections: Record<string, Section> = {}
  const section = (name: string): Section => sections[name] ??= { checked: 0, differences: {}, examples: [] }
  const check = (name: string, text: string): void => {
    const s = section(name)
    s.checked++
    const ends = intlEnds(text)
    for (let t = 0; t < tables.length; t++) {
      const difference = compare(tables[t]!, text, ends)
      if (difference === null) continue
      s.differences[tables[t]!] = (s.differences[tables[t]!] ?? 0) + 1
      if (s.examples.length < 40) s.examples.push({ table: tables[t], text, intl: difference[0], ours: difference[1] })
    }
  }

  // Every code point in every context; differing code points as ranges per table.
  const differing: Record<string, number[]> = {}
  for (let c = 0; c <= 0x10ffff; c++) {
    const x = String.fromCodePoint(c)
    for (let k = 0; k < contexts.length; k++) {
      const [before, after] = contexts[k]!
      const text = before + x + (after === 'XX' ? x + x : after)
      const ends = intlEnds(text)
      for (let t = 0; t < tables.length; t++) {
        if (compare(tables[t]!, text, ends) === null) continue
        const list = differing[tables[t]!] ??= []
        if (list[list.length - 1] !== c) list.push(c)
      }
    }
    if ((c & 0xffff) === 0xffff) { log(`code points to U+${hex(c)}`); await pause() }
  }
  const ranges: Record<string, string[]> = {}
  for (const table of Object.keys(differing)) {
    const list = differing[table]!
    const out: string[] = []
    for (let i = 0; i < list.length; i++) {
      let k = i
      while (k + 1 < list.length && list[k + 1] === list[k]! + 1) k++
      out.push(k === i ? hex(list[i]!) : `${hex(list[i]!)}..${hex(list[k]!)}`)
      i = k
    }
    ranges[table] = out
  }
  const codePoints = { checked: 0x110000 * contexts.length, differingCodePoints: Object.fromEntries(Object.entries(differing).map(([t, l]) => [t, l.length])), ranges }

  // Texts, whole and as prepared segments.
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!
    check('texts', text)
    for (const whiteSpace of ['normal', 'pre-wrap'] as const) {
      const prepared = prepareWithSegments(text, '16px sans-serif', { whiteSpace })
      for (let s = 0; s < prepared.segments.length; s++) check('segments', prepared.segments[s]!)
    }
    if (i % 500 === 0) { log(`texts ${i}/${texts.length}`); await pause() }
  }

  // Random strings over the classes of the profile's table: code points go together when the
  // table gives them the same clusters in every context.
  const classes = new Map<string, number[]>()
  const signature = (c: number): string => {
    let key = ''
    const x = String.fromCodePoint(c)
    for (let k = 0; k < contexts.length; k++) {
      const [before, after] = contexts[k]!
      const text = before + x + (after === 'XX' ? x + x : after)
      const count = findGraphemeEnds(own, text, 0, text.length, buffer)
      key += `${buffer.subarray(0, count).join(',')};`
    }
    return key
  }
  for (let c = 0; c <= 0x10ffff; c++) {
    const key = signature(c)
    let members = classes.get(key)
    if (members === undefined) classes.set(key, members = [])
    members.push(c)
  }
  const members = [...classes.values()]
  let seed = 12345
  const random = (n: number): number => { seed = (seed * 48271) % 0x7fffffff; return seed % n }
  for (let t = 0; t < fuzz; t++) {
    const alphabet = Array.from({ length: 2 + random(4) }, () => members[random(members.length)]!)
    let text = ''
    for (let length = 1 + random(24); length > 0; length--) {
      const pool = alphabet[random(alphabet.length)]!
      text += String.fromCodePoint(pool[random(pool.length)]!)
    }
    check('random', text)
    if (t % 20_000 === 0) { log(`random ${t}/${fuzz}`); await pause() }
  }
  return { userAgent: navigator.userAgent, profileTable: own, classes: members.length, classSizes: members.map(m => m.length), codePoints, sections }
}
