// Embedding levels of one left-to-right paragraph, as Firefox resolves them to split text
// runs. Firefox builds intl/components with USE_RUST_UNICODE_BIDI (intl/components/src/Bidi.h:13),
// which runs servo/unicode-bidi at git rev ca612daf (third_party/rust/unicode-bidi,
// Cargo.lock:8433-8439) with ICU4X Bidi_Class data. This ports what
// ParagraphBidiInfo::new_with_data_source + visual_runs return as levels, cited as file:line
// in that crate's src/. Quirks kept on purpose: iter_backwards_from walks earlier level runs
// forwards (prepare.rs:257-273), and bracket pairs come from the crate's own Unicode 15 table
// (char_data/tables.rs:519, data_source.rs:44-46), not from BidiBrackets 17.
//
// Pretext takes no paragraph direction, so the paragraph level is always 0. Classes use
// ICU4C numbering (icu_properties BidiClass::to_icu4c_value).

import { geckoBidiClassRangesPacked, geckoBidiPairsPacked } from './generated/engine-break-data.js'
import { unpackUint32Table } from './line-breaks.js'

const L = 0, R = 1, EN = 2, ES = 3, ET = 4, AN = 5, CS = 6, B = 7, S = 8, WS = 9, ON = 10, LRE = 11,
  LRO = 12, AL = 13, RLE = 14, RLO = 15, PDF = 16, NSM = 17, BN = 18, FSI = 19, LRI = 20, RLI = 21, PDI = 22

const MAX_DEPTH = 125 // level.rs:42-46

// Bidi_Class below U+10000 per code unit, and the ranges above it, filled on first use.
// The ranges are flat [start - previous end - 1, end - start, class] triples of classes
// other than L.
let bidiBmp: Uint8Array | null = null
let astralStarts: number[] | null = null
let astralEnds: number[] | null = null
let astralClasses: number[] | null = null

function bidiClassOf(cp: number): number {
  if (bidiBmp === null) {
    const geckoBidiClassRanges = unpackUint32Table(geckoBidiClassRangesPacked)
    bidiBmp = new Uint8Array(0x10000)
    astralStarts = []
    astralEnds = []
    astralClasses = []
    let previousEnd = -1
    for (let i = 0; i < geckoBidiClassRanges.length; i += 3) {
      const start = previousEnd + 1 + geckoBidiClassRanges[i]!
      previousEnd = start + geckoBidiClassRanges[i + 1]!
      const value = geckoBidiClassRanges[i + 2]!
      if (start < 0x10000) bidiBmp.fill(value, start, Math.min(previousEnd + 1, 0x10000))
      if (previousEnd >= 0x10000) {
        astralStarts.push(Math.max(start, 0x10000))
        astralEnds.push(previousEnd)
        astralClasses.push(value)
      }
    }
  }
  if (cp < 0x10000) return bidiBmp[cp]!
  let lo = 0
  let hi = astralStarts!.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < astralStarts![mid]!) hi = mid - 1
    else if (cp > astralEnds![mid]!) lo = mid + 1
    else return astralClasses![mid]!
  }
  return L
}

// TextSource::char_at for [u16] (utf16.rs): a valid pair is one char of length 2, the low half of a
// valid pair has no char (-1), any other surrogate reads as U+FFFD. Packed as char | length << 21.
function charAt(text: Uint16Array, index: number): number {
  const c = text[index]!
  if ((c & 0xf800) !== 0xd800) return c | (1 << 21)
  if ((c & 0xfc00) === 0xdc00 && index > 0 && (text[index - 1]! & 0xfc00) === 0xd800) return -1
  if ((c & 0xfc00) === 0xd800 && index + 1 < text.length && (text[index + 1]! & 0xfc00) === 0xdc00) {
    return (((c & 0x3ff) << 10) + (text[index + 1]! & 0x3ff) + 0x10000) | (2 << 21)
  }
  return 0xfffd | (1 << 21)
}
const charOf = (packed: number) => packed & 0x1fffff
const lenOf = (packed: number) => packed >> 21

const removedByX9 = (c: number) => c === RLE || c === LRE || c === RLO || c === LRO || c === PDF || c === BN // prepare.rs:308-310
const isNI = (c: number) => c === B || c === S || c === WS || c === ON || c === FSI || c === LRI || c === RLI || c === PDI // implicit.rs:604-606
const levelClass = (level: number) => (level & 1) === 1 ? R : L // level.rs:189-195

type Run = [number, number]
type Sequence = { runs: Run[], sos: number, eos: number }

// IsolatingRunSequence::iter_forwards_from (prepare.rs:239-252). `visit` returns true to stop.
function walkForwards(seq: Sequence, pos: number, runIndex: number, visit: (i: number) => boolean): void {
  for (let i = pos; i < seq.runs[runIndex]![1]; i++) if (visit(i)) return
  for (let r = runIndex + 1; r < seq.runs.length; r++) {
    const run = seq.runs[r]!
    for (let i = run[0]; i < run[1]; i++) if (visit(i)) return
  }
}

// iter_backwards_from (prepare.rs:257-273): the current run backwards, then earlier runs in reverse
// order, each walked forwards.
function walkBackwards(seq: Sequence, pos: number, runIndex: number, visit: (i: number) => boolean): void {
  for (let i = pos - 1; i >= seq.runs[runIndex]![0]; i--) if (visit(i)) return
  for (let r = runIndex - 1; r >= 0; r--) {
    const run = seq.runs[r]!
    for (let i = run[0]; i < run[1]; i++) if (visit(i)) return
  }
}

// Levels after rule L1 for one paragraph at level 0.
export function getParagraphLevels(text: Uint16Array): Uint8Array {
  const n = text.length
  const original = new Uint8Array(n)
  const levels = new Uint8Array(n)
  if (n === 0) return levels

  // compute_initial_info with split_paragraphs None and a given paragraph level (lib.rs:304-452).
  let isPureLtr = true
  let hasIsolateControls = false
  const isolateStack: number[] = []
  for (let i = 0; i < n;) {
    const packed = charAt(text, i)
    const len = lenOf(packed)
    const cls = bidiClassOf(charOf(packed))
    for (let j = 0; j < len; j++) original[i + j] = cls
    if (cls === L || cls === R || cls === AL) {
      if (cls !== L) isPureLtr = false
      const top = isolateStack.length > 0 ? isolateStack[isolateStack.length - 1]! : -1
      if (top >= 0 && original[top] === FSI) original[top] = cls === L ? LRI : RLI // X5c
    } else if (cls === AN || cls === LRE || cls === RLE || cls === LRO || cls === RLO) {
      isPureLtr = false
    } else if (cls === RLI || cls === LRI || cls === FSI) {
      isPureLtr = false
      hasIsolateControls = true
      isolateStack.push(i)
    } else if (cls === PDI) {
      isolateStack.pop()
    }
    i += len
  }

  // compute_bidi_info_for_para (lib.rs:1084-1135).
  if (isPureLtr) return applyL1(text, original, levels)
  const processing = original.slice()

  // explicit::compute (explicit.rs:34-215). Status: 0 neutral, 1 RTL override, 2 LTR override, 3 isolate.
  const stackLevel: number[] = [0]
  const stackStatus: number[] = [0]
  let overflowIsolate = 0, overflowEmbedding = 0, validIsolate = 0
  let runLevel = 0, runStart = 0
  const runs: Run[] = []
  for (let i = 0; i < n;) {
    const len = lenOf(charAt(text, i))
    const top = stackLevel.length - 1
    const lastLevel = stackLevel[top]!, lastStatus = stackStatus[top]!
    const cls = original[i]!
    if (cls === RLE || cls === LRE || cls === RLO || cls === LRO || cls === RLI || cls === LRI || cls === FSI) {
      levels[i] = lastLevel
      const isIsolate = cls === RLI || cls === LRI || cls === FSI
      if (isIsolate) {
        if (lastStatus === 1) processing[i] = R
        else if (lastStatus === 2) processing[i] = L
      }
      const rtl = cls === RLE || cls === RLO || cls === RLI // char_data/mod.rs is_rtl
      const newLevel = rtl ? (lastLevel + 1) | 1 : (lastLevel + 2) & ~1 // level.rs:170-181
      if (newLevel <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
        stackLevel.push(newLevel)
        stackStatus.push(cls === RLO ? 1 : cls === LRO ? 2 : isIsolate ? 3 : 0)
        if (isIsolate) validIsolate++
        else levels[i] = newLevel
      } else if (isIsolate) {
        overflowIsolate++
      } else if (overflowIsolate === 0) {
        overflowEmbedding++
      }
      if (!isIsolate) processing[i] = BN
    } else if (cls === PDI) {
      if (overflowIsolate > 0) {
        overflowIsolate--
      } else if (validIsolate > 0) {
        overflowEmbedding = 0
        while (stackLevel.length > 0) {
          stackLevel.pop()
          if (stackStatus.pop() === 3) break
        }
        validIsolate--
      }
      const t = stackLevel.length - 1
      levels[i] = stackLevel[t]!
      if (stackStatus[t] === 1) processing[i] = R
      else if (stackStatus[t] === 2) processing[i] = L
    } else if (cls === PDF) {
      if (overflowIsolate > 0) {
        // nothing
      } else if (overflowEmbedding > 0) {
        overflowEmbedding--
      } else if (lastStatus !== 3 && stackLevel.length >= 2) {
        stackLevel.pop()
        stackStatus.pop()
      }
      levels[i] = stackLevel[stackLevel.length - 1]!
      processing[i] = BN
    } else if (cls !== B) {
      levels[i] = lastLevel
      if (cls !== BN) {
        if (lastStatus === 1) processing[i] = R
        else if (lastStatus === 2) processing[i] = L
      }
    }
    for (let j = 1; j < len; j++) { levels[i + j] = levels[i]!; processing[i + j] = processing[i]! }
    if (i === 0) {
      runLevel = levels[i]!
    } else if (!removedByX9(cls) && levels[i] !== runLevel) {
      runs.push([runStart, i])
      runLevel = levels[i]!
      runStart = i
    }
    i += len
  }
  if (n > runStart) runs.push([runStart, n])

  // prepare::isolating_run_sequences (prepare.rs:54-233).
  const sequences: Sequence[] = []
  const predLevelOf = (start: number) => {
    for (let k = start - 1; k >= 0; k--) if (!removedByX9(original[k]!)) return levels[k]!
    return 0
  }
  const succLevelOf = (end: number) => {
    for (let k = end; k < n; k++) if (!removedByX9(original[k]!)) return levels[k]!
    return 0
  }
  if (!hasIsolateControls) {
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!
      let first = -1, last = -1
      for (let k = run[0]; k < run[1]; k++) if (!removedByX9(original[k]!)) { first = k; break }
      for (let k = run[1] - 1; k >= run[0]; k--) if (!removedByX9(original[k]!)) { last = k; break }
      const seqLevel = levels[first >= 0 ? first : run[0]]!
      const endLevel = levels[last >= 0 ? last : run[1] - 1]!
      sequences.push({
        runs: [run],
        sos: levelClass(Math.max(seqLevel, predLevelOf(run[0]))),
        eos: levelClass(Math.max(endLevel, succLevelOf(run[1]))),
      })
    }
  } else {
    const found: Run[][] = []
    const stack: Run[][] = [[]]
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!
      const startClass = original[run[0]]!
      let endClass = startClass
      for (let k = run[1] - 1; k >= run[0]; k--) if (!removedByX9(original[k]!)) { endClass = original[k]!; break }
      const sequence = startClass === PDI && stack.length > 1 ? stack.pop()! : []
      sequence.push(run)
      if (endClass === RLI || endClass === LRI || endClass === FSI) stack.push(sequence)
      else found.push(sequence)
    }
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k]!.length > 0) found.push(stack[k]!)
    for (let f = 0; f < found.length; f++) {
      const seqRuns = found[f]!
      const seq: Sequence = { runs: seqRuns, sos: L, eos: L }
      const startOfSeq = seqRuns[0]![0]
      const endOfSeq = seqRuns[seqRuns.length - 1]![1]
      let seqIndex = startOfSeq
      walkForwards(seq, startOfSeq, 0, k => { if (removedByX9(original[k]!)) return false; seqIndex = k; return true })
      let endIndex = endOfSeq - 1
      walkBackwards(seq, endOfSeq, seqRuns.length - 1, k => { if (removedByX9(original[k]!)) return false; endIndex = k; return true })
      let lastNonRemoved = BN
      for (let k = endOfSeq - 1; k >= 0; k--) if (!removedByX9(original[k]!)) { lastNonRemoved = original[k]!; break }
      const succLevel = lastNonRemoved === RLI || lastNonRemoved === LRI || lastNonRemoved === FSI ? 0 : succLevelOf(endOfSeq)
      seq.sos = levelClass(Math.max(levels[seqIndex]!, predLevelOf(startOfSeq)))
      seq.eos = levelClass(Math.max(levels[endIndex]!, succLevel))
      sequences.push(seq)
    }
  }

  for (let s = 0; s < sequences.length; s++) {
    resolveWeak(text, sequences[s]!, processing)
    resolveNeutral(text, sequences[s]!, levels, original, processing)
  }

  // implicit::resolve_levels (implicit.rs:582-598).
  for (let i = 0; i < n; i++) {
    const rtl = (levels[i]! & 1) === 1
    const c = processing[i]!
    if (!rtl && (c === AN || c === EN)) levels[i] = levels[i]! + 2
    else if ((!rtl && c === R) || (rtl && (c === L || c === EN || c === AN))) levels[i] = levels[i]! + 1
  }
  // assign_levels_to_removed_chars (lib.rs:1264-1270).
  for (let i = 0; i < n; i++) if (removedByX9(original[i]!)) levels[i] = i > 0 ? levels[i - 1]! : 0

  return applyL1(text, original, levels)
}

// reorder_levels over the whole paragraph as one line (lib.rs:1146-1204), as visual_runs does
// (utf16.rs ParagraphBidiInfo::visual_runs -> reordered_levels).
function applyL1(text: Uint16Array, original: Uint8Array, levels: Uint8Array): Uint8Array {
  let resetFrom = 0
  let resetTo = -1
  let prevLevel = 0
  for (let i = 0; i < text.length;) {
    const len = lenOf(charAt(text, i))
    const c = original[i]!
    if (c === B || c === S) {
      resetTo = i + len
      if (resetFrom < 0) resetFrom = i
    } else if (c === WS || c === FSI || c === LRI || c === RLI || c === PDI) {
      if (resetFrom < 0) resetFrom = i
    } else if (c === RLE || c === LRE || c === RLO || c === LRO || c === PDF || c === BN) {
      if (resetFrom < 0) resetFrom = i
      levels[i] = prevLevel
    } else {
      resetFrom = -1
    }
    if (resetFrom >= 0 && resetTo >= 0) {
      levels.fill(0, resetFrom, resetTo)
      resetFrom = -1
      resetTo = -1
    }
    prevLevel = levels[i]!
    i += len
  }
  if (resetFrom >= 0) levels.fill(0, resetFrom)
  return levels
}

// implicit::resolve_weak (implicit.rs:27-252).
function resolveWeak(text: Uint16Array, seq: Sequence, pc: Uint8Array): void {
  let prevBeforeW4 = seq.sos
  let prevBeforeW5 = seq.sos
  let prevBeforeW1 = seq.sos
  let lastStrongIsAl = false
  const etRun: number[] = []
  const bnRun: number[] = []
  const toON = (idx: number) => { if (pc[idx] !== BN) return true; pc[idx] = ON; return false }
  for (let runIndex = 0; runIndex < seq.runs.length; runIndex++) {
    const run = seq.runs[runIndex]!
    for (let i = run[0]; i < run[1]; i++) {
      if (pc[i] === BN) { bnRun.push(i); continue }
      let w2Class = pc[i]!
      if (pc[i] === NSM) { // W1
        const p = prevBeforeW1
        pc[i] = p === RLI || p === LRI || p === FSI || p === PDI ? ON : p
        w2Class = pc[i]!
      }
      prevBeforeW1 = pc[i]!
      if (pc[i] === EN) { // W2
        if (lastStrongIsAl) pc[i] = AN
      } else if (pc[i] === AL) { // W3
        pc[i] = R
      }
      if (w2Class === L || w2Class === R) lastStrongIsAl = false
      else if (w2Class === AL) lastStrongIsAl = true
      const classBeforeW456 = pc[i]!
      const c = pc[i]!
      if (c === EN) { // W5
        for (let k = 0; k < etRun.length; k++) pc[etRun[k]!] = EN
        etRun.length = 0
      } else if (c === ES || c === CS) { // W4, W6 separators
        const packed = charAt(text, i)
        if (packed >= 0) {
          const charLen = lenOf(packed)
          let nextClass = seq.eos
          walkForwards(seq, i + charLen, runIndex, j => { if (removedByX9(pc[j]!)) return false; nextClass = pc[j]!; return true })
          if (nextClass === EN && lastStrongIsAl) nextClass = AN
          pc[i] = prevBeforeW4 === EN && nextClass === EN ? EN : prevBeforeW4 === AN && c === CS && nextClass === AN ? AN : ON
          if (pc[i] === ON) {
            walkBackwards(seq, i, runIndex, toON)
            walkForwards(seq, i + charLen, runIndex, toON)
          }
        } else {
          pc[i] = pc[i - 1]!
        }
      } else if (c === ET) { // W5
        if (prevBeforeW5 === EN) {
          pc[i] = EN
        } else {
          for (let k = 0; k < bnRun.length; k++) etRun.push(bnRun[k]!)
          etRun.push(i)
        }
      }
      // Emptying an empty array still costs a property write, so only nonempty runs are reset.
      if (bnRun.length !== 0) bnRun.length = 0
      prevBeforeW5 = pc[i]!
      if (prevBeforeW5 !== ET && etRun.length !== 0) { // W6 terminators
        for (let k = 0; k < etRun.length; k++) pc[etRun[k]!] = ON
        etRun.length = 0
      }
      prevBeforeW4 = classBeforeW456
    }
  }
  for (let k = 0; k < etRun.length; k++) pc[etRun[k]!] = ON
  // W7
  let lastStrongIsL = seq.sos === L
  for (let r = 0; r < seq.runs.length; r++) {
    const run = seq.runs[r]!
    for (let i = run[0]; i < run[1]; i++) {
      const c = pc[i]!
      if (c === EN && lastStrongIsL) pc[i] = L
      else if (c === L) lastStrongIsL = true
      else if (c === R || c === AL) lastStrongIsL = false
    }
  }
}

// unicode-bidi's bracket pairs as flat [opening, closing, normalized opening or 0] triples,
// unpacked on first use.
let bidiPairs: Uint32Array | null = null

// char_data::bidi_matched_opening_bracket (char_data/mod.rs:44-56): [opening, isOpen] or null.
function matchedOpeningBracket(c: number): [number, boolean] | null {
  const geckoBidiPairs = bidiPairs ??= unpackUint32Table(geckoBidiPairsPacked)
  for (let k = 0; k < geckoBidiPairs.length; k += 3) {
    const open = geckoBidiPairs[k]!, close = geckoBidiPairs[k + 1]!, normalized = geckoBidiPairs[k + 2]!
    if (open === c || close === c) return [normalized !== 0 ? normalized : open, open === c]
  }
  return null
}

// implicit::resolve_neutral (implicit.rs:263-486) with identify_bracket_pairs (:504-574).
function resolveNeutral(text: Uint16Array, seq: Sequence, levels: Uint8Array, original: Uint8Array, pc: Uint8Array): void {
  const e = levelClass(levels[seq.runs[0]![0]]!)
  const notE = e === L ? R : L

  const pairs: { start: number, end: number, startRun: number, endRun: number }[] = []
  const stack: [number, number, number][] = []
  for (let runIndex = 0; runIndex < seq.runs.length; runIndex++) {
    const run = seq.runs[runIndex]!
    for (let i = run[0]; i < run[1];) {
      // char_indices over text[run] (subrange): pairs decode inside the run only.
      const c0 = text[i]!
      let ch = c0, len = 1
      if ((c0 & 0xfc00) === 0xd800 && i + 1 < run[1] && (text[i + 1]! & 0xfc00) === 0xdc00) {
        ch = ((c0 & 0x3ff) << 10) + (text[i + 1]! & 0x3ff) + 0x10000
        len = 2
      } else if ((c0 & 0xf800) === 0xd800) {
        ch = 0xfffd
      }
      const at = i
      i += len
      if (pc[at] !== ON) continue
      const matched = matchedOpeningBracket(ch)
      if (matched === null) continue
      if (matched[1]) {
        if (stack.length >= 63) break
        stack.push([matched[0], at, runIndex])
      } else {
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k]![0] === matched[0]) {
            pairs.push({ start: stack[k]![1], end: at, startRun: stack[k]![2], endRun: runIndex })
            stack.length = k
            break
          }
        }
      }
    }
  }
  pairs.sort((a, b) => a.start - b.start)

  const charLenAt = (index: number) => {
    const packed = charAt(text, index)
    return packed < 0 ? 1 : lenOf(packed)
  }
  for (let p = 0; p < pairs.length; p++) { // N0
    const pair = pairs[p]!
    let foundE = false
    let foundNotE = false
    let classToSet = -1
    const startLen = charLenAt(pair.start)
    walkForwards(seq, pair.start + startLen, pair.startRun, k => {
      if (k >= pair.end) return true
      const c = pc[k]!
      if (c === e) foundE = true
      else if (c === notE) foundNotE = true
      else if (c === EN || c === AN) { if (e === L) foundNotE = true; else foundE = true }
      return foundE
    })
    if (foundE) {
      classToSet = e
    } else if (foundNotE) {
      let previousStrong = seq.sos
      walkBackwards(seq, pair.start, pair.startRun, k => {
        const c = pc[k]!
        if (c !== L && c !== R && c !== EN && c !== AN) return false
        previousStrong = c
        return true
      })
      if (previousStrong === EN || previousStrong === AN) previousStrong = R
      classToSet = previousStrong
    }
    if (classToSet >= 0) {
      const set = classToSet
      const endLen = charLenAt(pair.end)
      for (let k = pair.start; k < pair.start + startLen; k++) pc[k] = set
      for (let k = pair.end; k < pair.end + endLen; k++) pc[k] = set
      walkBackwards(seq, pair.start, pair.startRun, k => { if (pc[k] !== BN) return true; pc[k] = set; return false })
      const nsm = (k: number) => { if (original[k] !== NSM && pc[k] !== BN) return true; pc[k] = set; return false }
      walkForwards(seq, pair.start + startLen, pair.startRun, nsm)
      walkForwards(seq, pair.end + endLen, pair.endRun, nsm)
    }
  }

  // N1 and N2: runs of NI (and BN) take the class of their strong neighbours, else e.
  let prevClass = seq.sos
  let niStart = -1
  const niRun: number[] = []
  const rOrNumber = (c: number) => c === R || c === AN || c === EN
  const settle = (nextClass: number) => {
    const newClass = prevClass === L && nextClass === L ? L : rOrNumber(prevClass) && rOrNumber(nextClass) ? R : e
    for (let k = 0; k < niRun.length; k++) pc[niRun[k]!] = newClass
    niRun.length = 0
    niStart = -1
  }
  for (let r = 0; r < seq.runs.length; r++) {
    const run = seq.runs[r]!
    for (let i = run[0]; i < run[1]; i++) {
      const c = pc[i]!
      if (isNI(c) || c === BN) {
        if (niStart < 0) niStart = i
        niRun.push(i)
        continue
      }
      if (niStart >= 0) settle(c)
      prevClass = c
    }
  }
  if (niStart >= 0) settle(seq.eos)
}
