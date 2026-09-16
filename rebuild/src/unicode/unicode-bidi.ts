// Embedding levels of one bidi paragraph after rule L1, over the paragraph as one line, as servo/unicode-bidi 0.3.15
// resolves them for Firefox 156 (specs/bidi.md §5.2). Gecko splits frames where the level changes (specs/gecko-text.md §4).
// Blink and WebKit run ICU instead: unicode/ubidi.ts.
//
// The resolver ports the groundwork's runtime-parity/gecko/src/bidi-levels.ts, a port of the crate at git rev ca612daf
// (`ParagraphBidiInfo::new_with_data_source` + `visual_runs`), cited as file:line in that crate's src/. It keeps the
// crate's behaviour where it departs from ICU (specs/bidi.md §5.3):
// - no paragraph split at class B (Gecko replaces B and S with spaces before resolving, nsBidiPresUtils.cpp:861-875);
// - full levels for text with no RTL content, where ICU returns the paragraph level;
// - removed characters (X9) take the previous character's level (lib.rs:1264-1270);
// - bracket candidates are brackets whose processing class is ON, the opening stack stops at 63, and an NSM after a
//   changed bracket follows it;
// - iter_backwards_from walks earlier level runs forwards (prepare.rs:257-273), so N0's context search finds the first
//   strong character of the nearest earlier run that has one.
import { AL, AN, B, BN, CS, EN, ES, ET, FSI, L, LRE, LRI, LRO, NSM, ON, PDF, PDI, R, RLE, RLI, RLO, S, WS, bidiClassOf, type BidiData, type ParagraphDirection } from './bidi.js'

export type UnicodeBidiParagraph = {
  // The paragraph embedding level: from the direction, or from the first strong character for 'auto'.
  level: number
  // One level per UTF-16 code unit. Characters removed by rule X9 take the level of the character before them.
  levels: Uint8Array
}

const MAX_DEPTH = 125 // level.rs:42-46

// TextSource::char_at for [u16] (utf16.rs): a valid pair is one char of length 2, the low half of a valid pair has no
// char (-1), any other surrogate reads as U+FFFD. Packed as char | length << 21.
function charAt(text: string, index: number): number {
  const c = text.charCodeAt(index)
  if ((c & 0xf800) !== 0xd800) return c | (1 << 21)
  if ((c & 0xfc00) === 0xdc00 && index > 0 && (text.charCodeAt(index - 1) & 0xfc00) === 0xd800) return -1
  if ((c & 0xfc00) === 0xd800 && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
    return (((c & 0x3ff) << 10) + (text.charCodeAt(index + 1) & 0x3ff) + 0x10000) | (2 << 21)
  }
  return 0xfffd | (1 << 21)
}
const charOf = (packed: number) => packed & 0x1fffff
const lenOf = (packed: number) => packed >> 21

const removedByX9 = (c: number) => c === RLE || c === LRE || c === RLO || c === LRO || c === PDF || c === BN // prepare.rs:308-310
const isNI = (c: number) => c === B || c === S || c === WS || c === ON || c === FSI || c === LRI || c === RLI || c === PDI // implicit.rs:604-606
const levelClass = (level: number) => (level & 1) === 1 ? R : L // level.rs:189-195

type Run = [number, number]
type Sequence = { runs: Run[]; sos: number; eos: number }

// IsolatingRunSequence::iter_forwards_from (prepare.rs:239-252). `visit` returns true to stop.
function walkForwards(seq: Sequence, pos: number, runIndex: number, visit: (i: number) => boolean): void {
  for (let i = pos; i < seq.runs[runIndex]![1]; i++) if (visit(i)) return
  for (let r = runIndex + 1; r < seq.runs.length; r++) {
    const run = seq.runs[r]!
    for (let i = run[0]; i < run[1]; i++) if (visit(i)) return
  }
}

// iter_backwards_from (prepare.rs:257-273): the current run backwards, then earlier runs in reverse order, each walked
// forwards.
function walkBackwards(seq: Sequence, pos: number, runIndex: number, visit: (i: number) => boolean): void {
  for (let i = pos - 1; i >= seq.runs[runIndex]![0]; i--) if (visit(i)) return
  for (let r = runIndex - 1; r >= 0; r--) {
    const run = seq.runs[r]!
    for (let i = run[0]; i < run[1]; i++) if (visit(i)) return
  }
}

// P2 and P3: the first L, R or AL outside isolates decides; none gives 0 (lib.rs:304-452 with para_level None).
function firstStrongLevel(text: string, data: BidiData): number {
  let isolates = 0
  for (let i = 0; i < text.length;) {
    const packed = charAt(text, i)
    const len = packed < 0 ? 1 : lenOf(packed)
    if (packed >= 0) {
      const cls = bidiClassOf(data, charOf(packed))
      if (cls === LRI || cls === RLI || cls === FSI) isolates++
      else if (cls === PDI) { if (isolates > 0) isolates-- }
      else if (isolates === 0 && cls === L) return 0
      else if (isolates === 0 && (cls === R || cls === AL)) return 1
    }
    i += len
  }
  return 0
}

export function resolveUnicodeBidi(text: string, direction: ParagraphDirection, data: BidiData): UnicodeBidiParagraph {
  let paraLevel: number
  switch (direction) {
    case 'ltr': paraLevel = 0; break
    case 'rtl': paraLevel = 1; break
    case 'auto': paraLevel = firstStrongLevel(text, data); break
  }
  const n = text.length
  const original = new Uint8Array(n)
  const levels = new Uint8Array(n).fill(paraLevel)
  if (n === 0) return { level: paraLevel, levels }

  // compute_initial_info with a given paragraph level (lib.rs:304-452).
  let isPureLtr = true
  let hasIsolateControls = false
  const isolateStack: number[] = []
  for (let i = 0; i < n;) {
    const packed = charAt(text, i)
    const len = lenOf(packed)
    const cls = bidiClassOf(data, charOf(packed))
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
  if (paraLevel === 0 && isPureLtr) return { level: paraLevel, levels: applyL1(text, original, levels, paraLevel) }
  const processing = Uint8Array.from(original)

  // explicit::compute (explicit.rs:34-215). Status: 0 neutral, 1 RTL override, 2 LTR override, 3 isolate.
  const stackLevel: number[] = [paraLevel]
  const stackStatus: number[] = [0]
  let overflowIsolate = 0
  let overflowEmbedding = 0
  let validIsolate = 0
  let runLevel = 0
  let runStart = 0
  const runs: Run[] = []
  for (let i = 0; i < n;) {
    const len = lenOf(charAt(text, i))
    const top = stackLevel.length - 1
    const lastLevel = stackLevel[top]!
    const lastStatus = stackStatus[top]!
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
    return paraLevel
  }
  const succLevelOf = (end: number) => {
    for (let k = end; k < n; k++) if (!removedByX9(original[k]!)) return levels[k]!
    return paraLevel
  }
  if (!hasIsolateControls) {
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r]!
      let first = -1
      let last = -1
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
      const succLevel = lastNonRemoved === RLI || lastNonRemoved === LRI || lastNonRemoved === FSI ? paraLevel : succLevelOf(endOfSeq)
      seq.sos = levelClass(Math.max(levels[seqIndex]!, predLevelOf(startOfSeq)))
      seq.eos = levelClass(Math.max(levels[endIndex]!, succLevel))
      sequences.push(seq)
    }
  }

  for (let s = 0; s < sequences.length; s++) {
    resolveWeak(text, sequences[s]!, processing)
    resolveNeutral(text, sequences[s]!, levels, original, processing, data.brackets)
  }

  // implicit::resolve_levels (implicit.rs:582-598).
  for (let i = 0; i < n; i++) {
    const rtl = (levels[i]! & 1) === 1
    const c = processing[i]!
    if (!rtl && (c === AN || c === EN)) levels[i] = levels[i]! + 2
    else if ((!rtl && c === R) || (rtl && (c === L || c === EN || c === AN))) levels[i] = levels[i]! + 1
  }
  // assign_levels_to_removed_chars (lib.rs:1264-1270).
  for (let i = 0; i < n; i++) if (removedByX9(original[i]!)) levels[i] = i > 0 ? levels[i - 1]! : paraLevel

  return { level: paraLevel, levels: applyL1(text, original, levels, paraLevel) }
}

// reorder_levels over the whole paragraph as one line (lib.rs:1146-1204), as visual_runs does.
function applyL1(text: string, original: Uint8Array, levels: Uint8Array, paraLevel: number): Uint8Array {
  let resetFrom = 0
  let resetTo = -1
  let prevLevel = paraLevel
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
      for (let k = resetFrom; k < resetTo; k++) levels[k] = paraLevel
      resetFrom = -1
      resetTo = -1
    }
    prevLevel = levels[i]!
    i += len
  }
  if (resetFrom >= 0) for (let k = resetFrom; k < text.length; k++) levels[k] = paraLevel
  return levels
}

// implicit::resolve_weak (implicit.rs:27-252).
function resolveWeak(text: string, seq: Sequence, pc: Uint8Array): void {
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
      bnRun.length = 0
      prevBeforeW5 = pc[i]!
      if (prevBeforeW5 !== ET) { // W6 terminators
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

// char_data::bidi_matched_opening_bracket (char_data/mod.rs:44-56): [canonical opening, isOpen] or null.
function matchedOpeningBracket(brackets: readonly number[], c: number): [number, boolean] | null {
  for (let k = 0; k < brackets.length; k += 3) {
    const open = brackets[k]!
    const close = brackets[k + 1]!
    const canonical = brackets[k + 2]!
    if (open === c || close === c) return [canonical !== 0 ? canonical : open, open === c]
  }
  return null
}

// implicit::resolve_neutral (implicit.rs:263-486) with identify_bracket_pairs (:504-574).
function resolveNeutral(text: string, seq: Sequence, levels: Uint8Array, original: Uint8Array, pc: Uint8Array, brackets: readonly number[]): void {
  const e = levelClass(levels[seq.runs[0]![0]]!)
  const notE = e === L ? R : L

  const pairs: { start: number; end: number; startRun: number; endRun: number }[] = []
  const stack: [number, number, number][] = []
  for (let runIndex = 0; runIndex < seq.runs.length; runIndex++) {
    const run = seq.runs[runIndex]!
    for (let i = run[0]; i < run[1];) {
      // char_indices over text[run] (subrange): pairs decode inside the run only.
      const c0 = text.charCodeAt(i)
      let ch = c0
      let len = 1
      if ((c0 & 0xfc00) === 0xd800 && i + 1 < run[1] && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        ch = ((c0 & 0x3ff) << 10) + (text.charCodeAt(i + 1) & 0x3ff) + 0x10000
        len = 2
      } else if ((c0 & 0xf800) === 0xd800) {
        ch = 0xfffd
      }
      const at = i
      i += len
      if (pc[at] !== ON) continue
      const matched = matchedOpeningBracket(brackets, ch)
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
