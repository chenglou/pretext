// Gecko's prepared paragraph and line state (Firefox 156.0). The Gecko port owns this file.
import type { Environment } from '../../env.js'
import type { Paragraph } from '../../model.js'

// One mapped flow: the transformed text of one text node inside one text run (specs/gecko-text.md §0.3, §6).
export type GeckoMappedFlow = {
  run: number
  // The flow's DOM range [start, end) into the concatenated run text.
  start: number
  end: number
  // Offset of the flow's first unit in its text run.
  textRunOffset: number
}

export type GeckoTextRun = {
  // Transformed characters of every flow in the run.
  text: string
  // Per transformed unit: its source offset, break flag (0 none, 1 normal, 3 emergency), cluster start, CharIsSpace.
  sourceOffsets: Int32Array
  breakFlags: Uint8Array
  clusterStarts: Uint8Array
  isSpace: Uint8Array
  // Integer app-unit advance per unit (ligature continuations 0), from Canvas unit totals (specs/gecko-canvas.md §2 A4).
  advances: Int32Array
  bidiLevel: number
}

export type GeckoPrepared = {
  paragraph: Paragraph
  env: Environment
  // max(1, round(60 / devicePixelRatio)) (specs/gecko-lines.md §2.1).
  appUnitsPerDevPixel: number
  flows: GeckoMappedFlow[]
  textRuns: GeckoTextRun[]
}

// Where the continuation frame starts (nsTextFrame.cpp:11253, :11523). No measured remainder carries over; a line's
// single redo with a forced break happens inside nextLine (specs/gecko-lines.md §4.1, §4.7).
export type GeckoLineStart = {
  engine: 'gecko'
  contentOffset: number
}

// The break the second pass of a line forces (nsBlockFrame.cpp:5170-5194). A line is laid out at most twice.
export type GeckoForcedBreak = { flow: number; offset: number }
