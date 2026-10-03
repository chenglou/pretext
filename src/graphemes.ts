// Grapheme clusters as each engine's Intl.Segmenter finds them: ICU's character rules
// (char.brk) as Chrome and libicucore ship them, which scripts/generate-engine-break-data.ts
// writes to src/generated/engine-break-data.ts. Firefox's ICU4X data gives the same clusters
// as Chrome's table, which the generator checks, so Firefox takes Chrome's. The rules are
// Unicode 17's and don't follow a browser to another version (RESEARCH.md, Decisions Log,
// 2026-09-24).
//
// Firefox finds clusters in its text run, which leaves out soft hyphens and bidi controls
// (IsDiscardable, nsTextFrameUtils.cpp:32-49). So the Gecko profile's table, 'gecko/char', runs
// Chrome's rules past them: one goes with the cluster before it, or at the start with the one
// after it, and text of only such characters holds no cluster.

import type { CharTable } from './generated/engine-break-data.js'
import { getBreakRules, getClass, START_STATE, type BreakRules } from './line-breaks.js'

const CLUSTER_END = 0x80

export type GraphemeTable = CharTable | 'gecko/char'

type GraphemeRules = {
  readonly rules: BreakRules
  // The next state for each state and category, from the start state's row where
  // CLUSTER_END is set: a cluster ends before the code point.
  readonly transitions: Uint8Array
  // In the Gecko profile's table, the category of what its text run leaves out, all of it in the
  // rules' Control category; -1 in the others.
  readonly skipped: number
}

// ICU's handleNext (rbbi.cpp:779-952) ends a cluster at the last accepting position before
// its forward table stops. In the character rules every state but the start state accepts,
// except a look-ahead state after a regional indicator pair, whose only way in records its
// position one code point back; the generator checks both. So a cluster ends right before the
// code point whose transition stops or enters that state, and the next cluster starts at that
// code point from the start state. One pass over the text finds every cluster.
function parseGraphemeRules(table: GraphemeTable): GraphemeRules {
  const rules = getBreakRules(table === 'gecko/char' ? 'chromium/char' : table)
  const width = rules.rowWidth
  const rows = rules.rows
  const states = rows.length / width
  const transitions = new Uint8Array(states * rules.catCount)
  for (let state = 0; state < states; state++) {
    for (let category = 0; category < rules.catCount; category++) {
      const next = rows[state * width + 3 + category]!
      transitions[state * rules.catCount + category] = next === 0 || rows[next * width]! > 1
        ? CLUSTER_END | rows[START_STATE * width + 3 + category]!
        : next
    }
  }
  return { rules, transitions, skipped: table === 'gecko/char' ? getClass(rules.classes, 0x00ad) : -1 }
}

const graphemeRules: Partial<Record<GraphemeTable, GraphemeRules>> = {}

// nsBidiUtils.h:84-90
export function isBidiControl(cp: number): boolean {
  return ((cp & 0xff00) === 0x2000 && ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || (cp & ~1) === 0x200e)) ||
    cp === 0x061c
}

// The number of grapheme clusters in text[start, end), read as if the text began at `start`
// and ended at `end`. Unless `ends` is null, writes where each cluster ends to it from index
// 0; it needs room for end - start values.
export function findGraphemeEnds(table: GraphemeTable, text: string, start: number, end: number, ends: Int32Array | null): number {
  const { rules, transitions, skipped } = graphemeRules[table] ?? (graphemeRules[table] = parseGraphemeRules(table))
  const catCount = rules.catCount
  let state = START_STATE
  let count = 0
  for (let i = start; i < end;) {
    let c = text.charCodeAt(i)
    let next = i + 1
    if ((c & 0xfc00) === 0xd800 && next < end) {
      const trail = text.charCodeAt(next)
      if ((trail & 0xfc00) === 0xdc00) { next++; c = ((c - 0xd800) << 10) + trail - 0xdc00 + 0x10000 }
    }
    const category = getClass(rules.classes, c)
    if (category === skipped && (c === 0x00ad || isBidiControl(c))) {
      i = next
      continue
    }
    // The start state takes every code point without CLUSTER_END, so none is set at `start`.
    const transition = transitions[state * catCount + category]!
    if ((transition & CLUSTER_END) !== 0) {
      if (ends !== null) ends[count] = i
      count++
    }
    state = transition & ~CLUSTER_END
    i = next
  }
  // Every code point takes the state to an accepting one, never the start state, which the
  // generator checks, so a cluster is open here once one was read.
  if (state !== START_STATE) {
    if (ends !== null) ends[count] = end
    count++
  }
  return count
}
