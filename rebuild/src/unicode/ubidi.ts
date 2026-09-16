// ICU ubidi_setPara, the bidi resolver Chrome 153 (ICU 78.2) and Safari 27 (macOS 27 libicucore 78.1) run over a
// paragraph with default options: UBIDI_REORDER_DEFAULT, no reordering options, no class callback, no context, levels
// computed from the text (specs/bidi.md §5.1). A port of icu4c/source/common/ubidi.cpp at release-78.2, cited as
// ubidi.cpp:line; ubidi.cpp, ubidiln.cpp and ubidiimp.h are byte-identical in 78.3. src/unicode/ubidi.test.ts compares
// every output with ubidi_setPara linked from Homebrew icu4c 78.3 and from the system libicucore.
//
// Left out because neither engine reaches it: the other reordering modes and their state tables, insert points,
// UBIDI_OPTION_STREAMING and _REMOVE_CONTROLS, ubidi_setContext, orderParagraphsLTR, caller-supplied levels.
//
// Where ICU differs from UAX #9 and from unicode/unicode-bidi.ts (specs/bidi.md §5.3), all by construction here:
// - each class-B character ends a paragraph and resets the explicit stack; CR directly before LF doesn't;
// - text that isn't mixed gets the paragraph level everywhere (directionFromFlags, before and after explicit levels);
// - removed characters (BN, LRE, RLE, LRO, RLO, PDF) take the next character's level (adjustWSLevels);
// - brackets pair during explicit processing: under an override they still pair, keep their N0 class and lose the
//   override; there is no 63-opening limit; an NSM after a changed closing bracket stays neutral;
// - an isolate initiator or PDI under an override keeps no override class (levels[i] = NO_OVERRIDE, :1222, :1282), and
//   level runs split where only the override bit changes, which gives the four isolate-after-embedding results of
//   specs/bidi.md §7.3.
import { AL, AN, B, BN, CS, EN, ES, ET, FSI, L, LRE, LRI, LRO, NSM, ON, PDF, PDI, R, RLE, RLI, RLO, S, WS, bidiClassOf, type BidiData, type ParagraphDirection } from './bidi.js'

export type IcuBidiParagraph = {
  // ubidi_getDirection. Blink turns bidi off when the result isn't mixed and the base direction is LTR
  // (inline_node.cc:1355-1359).
  direction: 'ltr' | 'rtl' | 'mixed'
  // ubidi_getParagraphByIndex: each paragraph ends after a class-B character (CR LF once) or at the text end. With
  // 'auto', every paragraph finds its own level (P2, P3).
  paragraphs: { end: number; level: number }[]
  // ubidi_getLevels: one level per UTF-16 code unit. ubidi_getLogicalRun's runs are the maximal runs of equal levels.
  levels: Uint8Array
}

// ubidiimp.h:44-60
const ENL = 23 // EN after W7
const ENR = 24 // EN not subject to W7

const LEVEL_OVERRIDE = 0x80 // UBIDI_LEVEL_OVERRIDE
const MAX_EXPLICIT_LEVEL = 125 // UBIDI_MAX_EXPLICIT_LEVEL
const DEFAULT_LTR = 0xfe // UBIDI_DEFAULT_LTR
const ISOLATE = 0x100 // ubidiimp.h:123
const CR = 0x0d
const LF = 0x0a

const DIRECTION_LTR = 0
const DIRECTION_RTL = 1
const DIRECTION_MIXED = 2

// ubidiimp.h:78-112
const flag = (dirProp: number): number => 1 << dirProp
const MASK_LTR = flag(L) | flag(EN) | flag(ENL) | flag(ENR) | flag(AN) | flag(LRE) | flag(LRO) | flag(LRI)
const MASK_RTL = flag(R) | flag(AL) | flag(RLE) | flag(RLO) | flag(RLI)
const MASK_EXPLICIT = flag(LRE) | flag(LRO) | flag(RLE) | flag(RLO) | flag(PDF)
const MASK_ISO = flag(LRI) | flag(RLI) | flag(FSI) | flag(PDI)
const MASK_BN_EXPLICIT = flag(BN) | MASK_EXPLICIT
const MASK_B_S = flag(B) | flag(S)
const MASK_WS = MASK_B_S | flag(WS) | MASK_BN_EXPLICIT | MASK_ISO
const MASK_POSSIBLE_N = flag(ON) | flag(CS) | flag(ES) | flag(ET) | MASK_WS
const MASK_EMBEDDING = flag(NSM) | MASK_POSSIBLE_N
// ubidi.cpp:112-120
const flagLR = (level: number): number => flag((level & 1) === 0 ? L : R)
const flagE = (level: number): number => flag((level & 1) === 0 ? LRE : RLE)
const flagO = (level: number): number => flag((level & 1) === 0 ? LRO : RLO)
const noOverride = (level: number): number => level & ~LEVEL_OVERRIDE

type Para = { limit: number; level: number }
type Isolate = { startON: number; start1: number; state: number; stateImp: number }

// The UBiDi fields setPara reads and writes (ubidiimp.h:270-400).
type Ubidi = {
  text: string
  data: BidiData
  dirProps: Uint8Array
  levels: Uint8Array
  // The explicit level, or after getDirProps the first paragraph's level when defaultParaLevel.
  paraLevel: number
  defaultParaLevel: boolean
  paras: Para[]
  flags: number
  // DIRPROP_FLAG_MULTI_RUNS
  multiRuns: boolean
  isolateCount: number
  isolates: Isolate[]
}

// GET_PARALEVEL (ubidiimp.h:128-130) and ubidi_getParaLevelAtIndex (ubidi.cpp:643-652).
function paraLevelAt(u: Ubidi, index: number): number {
  if (!u.defaultParaLevel || index < u.paras[0]!.limit) return u.paraLevel
  let i = 0
  while (i < u.paras.length && index >= u.paras[i]!.limit) i++
  return u.paras[Math.min(i, u.paras.length - 1)]!.level
}

// getDirProps states (ubidi.cpp:447-452).
const NOT_SEEKING_STRONG = 0
const SEEKING_STRONG_FOR_PARA = 1
const SEEKING_STRONG_FOR_FSI = 2
const LOOKING_FOR_PDI = 3

// getDirProps (ubidi.cpp:427-640): classes, flags, paragraphs and their levels, FSI resolved to LRI or RLI.
function getDirProps(u: Ubidi): void {
  const { text, dirProps } = u
  const length = text.length
  const isDefaultLevel = u.defaultParaLevel
  const defaultParaLevel = u.paraLevel & 1
  const isolateStartStack = new Int32Array(MAX_EXPLICIT_LEVEL + 1)
  const previousStateStack = new Uint8Array(MAX_EXPLICIT_LEVEL + 1)
  let stackLast = -1
  let flags = 0
  let state: number
  if (isDefaultLevel) {
    u.paras[0]!.level = defaultParaLevel
    state = SEEKING_STRONG_FOR_PARA
  } else {
    u.paras[0]!.level = u.paraLevel
    state = NOT_SEEKING_STRONG
  }
  for (let i = 0; i < length;) {
    // U16_NEXT
    let uchar = text.charCodeAt(i++)
    if ((uchar & 0xfc00) === 0xd800 && i < length && (text.charCodeAt(i) & 0xfc00) === 0xdc00) {
      uchar = 0x10000 + ((uchar - 0xd800) << 10) + (text.charCodeAt(i++) - 0xdc00)
    }
    const dirProp = bidiClassOf(u.data, uchar)
    flags |= flag(dirProp)
    dirProps[i - 1] = dirProp
    if (uchar > 0xffff) {
      // The lead surrogate's class is BN.
      flags |= flag(BN)
      dirProps[i - 2] = BN
    }
    const para = u.paras[u.paras.length - 1]!
    switch (dirProp) {
      case L:
        if (state === SEEKING_STRONG_FOR_PARA) {
          para.level = 0
          state = NOT_SEEKING_STRONG
        } else if (state === SEEKING_STRONG_FOR_FSI) {
          if (stackLast <= MAX_EXPLICIT_LEVEL) flags |= flag(LRI)
          state = LOOKING_FOR_PDI
        }
        break
      case R:
      case AL:
        if (state === SEEKING_STRONG_FOR_PARA) {
          para.level = 1
          state = NOT_SEEKING_STRONG
        } else if (state === SEEKING_STRONG_FOR_FSI) {
          if (stackLast <= MAX_EXPLICIT_LEVEL) {
            dirProps[isolateStartStack[stackLast]!] = RLI
            flags |= flag(RLI)
          }
          state = LOOKING_FOR_PDI
        }
        break
      case FSI:
      case LRI:
      case RLI:
        stackLast++
        if (stackLast <= MAX_EXPLICIT_LEVEL) {
          isolateStartStack[stackLast] = i - 1
          previousStateStack[stackLast] = state
        }
        if (dirProp === FSI) {
          dirProps[i - 1] = LRI
          state = SEEKING_STRONG_FOR_FSI
        } else {
          state = LOOKING_FOR_PDI
        }
        break
      case PDI:
        if (state === SEEKING_STRONG_FOR_FSI && stackLast <= MAX_EXPLICIT_LEVEL) flags |= flag(LRI)
        if (stackLast >= 0) {
          if (stackLast <= MAX_EXPLICIT_LEVEL) state = previousStateStack[stackLast]!
          stackLast--
        }
        break
      case B:
        if (i < length && uchar === CR && text.charCodeAt(i) === LF) break
        para.limit = i
        if (i < length) {
          u.paras.push({ limit: 0, level: isDefaultLevel ? defaultParaLevel : u.paraLevel })
          state = isDefaultLevel ? SEEKING_STRONG_FOR_PARA : NOT_SEEKING_STRONG
          stackLast = -1
        }
        break
    }
  }
  // Still-open isolates: resolve the innermost unresolved FSI to LRI.
  if (stackLast > MAX_EXPLICIT_LEVEL) {
    stackLast = MAX_EXPLICIT_LEVEL
    state = SEEKING_STRONG_FOR_FSI
  }
  while (stackLast >= 0) {
    if (state === SEEKING_STRONG_FOR_FSI) {
      flags |= flag(LRI)
      break
    }
    state = previousStateStack[stackLast]!
    stackLast--
  }
  u.paras[u.paras.length - 1]!.limit = length
  if (isDefaultLevel) u.paraLevel = u.paras[0]!.level
  for (let i = 0; i < u.paras.length; i++) flags |= flagLR(u.paras[i]!.level)
  u.flags = flags
}

// ---- Paired brackets (ubidi.cpp:654-1002) ----

// Opening (ubidiimp.h:158-165). match: the closing character, or -position of the closing bracket for an unstable N0c
// pair, or 0 once neutralized.
type Opening = { position: number; match: number; contextPos: number; flags: number; contextDir: number }
// IsoRun (ubidiimp.h:167-175): openings [start, limit) of one isolate level. ICU stores start and limit as uint16, which
// only a paragraph with more than 65,535 pending openings would overflow.
type IsoRun = { contextPos: number; start: number; limit: number; level: number; lastStrong: number; lastBase: number; contextDir: number }
type BracketData = { openings: Opening[]; isoRuns: IsoRun[]; isoRunLast: number }

const FOUND_L = flag(L)
const FOUND_R = flag(R)

// bracketInit (ubidi.cpp:670-690)
function bracketInit(u: Ubidi): BracketData {
  const level = paraLevelAt(u, 0)
  const t = level & 1
  return { openings: [], isoRuns: [{ contextPos: 0, start: 0, limit: 0, level, lastStrong: t, lastBase: t, contextDir: t }], isoRunLast: 0 }
}

// bracketProcessB (ubidi.cpp:693-701): paragraph boundary.
function bracketProcessB(bd: BracketData, level: number): void {
  bd.isoRunLast = 0
  const run = bd.isoRuns[0]!
  run.limit = 0
  run.level = level
  run.lastStrong = run.lastBase = level & 1
  run.contextDir = level & 1
  run.contextPos = 0
}

// bracketProcessBoundary (ubidi.cpp:703-718): LRE, LRO, RLE, RLO, PDF.
function bracketProcessBoundary(u: Ubidi, bd: BracketData, lastCcPos: number, contextLevel: number, embeddingLevel: number): void {
  const run = bd.isoRuns[bd.isoRunLast]!
  if (flag(u.dirProps[lastCcPos]!) & MASK_ISO) return // after an isolate
  if (noOverride(embeddingLevel) > noOverride(contextLevel)) contextLevel = embeddingLevel // not a PDF
  run.limit = run.start
  run.level = embeddingLevel
  run.lastStrong = run.lastBase = contextLevel & 1
  run.contextDir = contextLevel & 1
  run.contextPos = lastCcPos
}

// bracketProcessLRI_RLI (ubidi.cpp:720-734)
function bracketProcessIsolate(bd: BracketData, level: number): void {
  const run = bd.isoRuns[bd.isoRunLast]!
  run.lastBase = ON
  const lastLimit = run.limit
  bd.isoRunLast++
  bd.isoRuns[bd.isoRunLast] = { contextPos: 0, start: lastLimit, limit: lastLimit, level, lastStrong: level & 1, lastBase: level & 1, contextDir: level & 1 }
}

// bracketProcessPDI (ubidi.cpp:736-743)
function bracketProcessPDI(bd: BracketData): void {
  bd.isoRunLast--
  bd.isoRuns[bd.isoRunLast]!.lastBase = ON
}

// bracketAddOpening (ubidi.cpp:745-768)
function bracketAddOpening(bd: BracketData, match: number, position: number): void {
  const run = bd.isoRuns[bd.isoRunLast]!
  bd.openings[run.limit] = { position, match, contextPos: run.contextPos, flags: 0, contextDir: run.contextDir }
  run.limit++
}

// fixN0c (ubidi.cpp:770-795): change N0c1 to N0c2 when a preceding bracket is assigned the embedding level.
function fixN0c(u: Ubidi, bd: BracketData, openingIndex: number, newPropPosition: number, newProp: number): void {
  const run = bd.isoRuns[bd.isoRunLast]!
  for (let k = openingIndex + 1; k < run.limit; k++) {
    const q = bd.openings[k]!
    if (q.match >= 0) continue // not an N0c match
    if (newPropPosition < q.contextPos) break
    if (newPropPosition >= q.position) continue
    if (newProp === q.contextDir) break
    const openingPosition = q.position
    u.dirProps[openingPosition] = newProp
    const closingPosition = -q.match
    u.dirProps[closingPosition] = newProp
    q.match = 0 // prevent further changes
    fixN0c(u, bd, k, openingPosition, newProp)
    fixN0c(u, bd, k, closingPosition, newProp)
  }
}

// bracketProcessClosing (ubidi.cpp:797-873): L or R for N0b and N0c, ON for N0d.
function bracketProcessClosing(u: Ubidi, bd: BracketData, openIdx: number, position: number): number {
  const run = bd.isoRuns[bd.isoRunLast]!
  const opening = bd.openings[openIdx]!
  const direction = run.level & 1
  let stable = true
  let newProp: number
  if ((direction === 0 && (opening.flags & FOUND_L) !== 0) || (direction === 1 && (opening.flags & FOUND_R) !== 0)) { // N0b
    newProp = direction
  } else if ((opening.flags & (FOUND_L | FOUND_R)) !== 0) { // N0c
    // Stable if there is no containing pair, or in conditions too complicated to check.
    stable = openIdx === run.start
    newProp = direction !== opening.contextDir ? opening.contextDir : direction // N0c1 : N0c2
  } else { // N0d: forget this and any brackets nested within this pair
    run.limit = openIdx
    return ON
  }
  u.dirProps[opening.position] = newProp
  u.dirProps[position] = newProp
  fixN0c(u, bd, openIdx, opening.position, newProp)
  if (stable) {
    run.limit = openIdx // forget any brackets nested within this pair
    while (run.limit > run.start && bd.openings[run.limit - 1]!.position === opening.position) run.limit-- // lower synonyms
  } else {
    opening.match = -position
    for (let k = openIdx - 1; k >= run.start && bd.openings[k]!.position === opening.position; k--) bd.openings[k]!.match = 0
    for (let k = openIdx + 1; k < run.limit; k++) {
      const q = bd.openings[k]!
      if (q.position >= position) break
      if (q.match > 0) q.match = 0
    }
  }
  return newProp
}

// u_getBidiPairedBracket of an opening bracket (Bidi_Paired_Bracket_Type=Open), or -1 for any other code unit.
function closingBracketOf(data: BidiData, c: number): number {
  const brackets = data.brackets
  for (let k = 0; k < brackets.length; k += 3) if (brackets[k] === c) return brackets[k + 1]!
  return -1
}

// bracketProcessChar (ubidi.cpp:875-1002): strong characters, digits and bracket candidates.
function bracketProcessChar(u: Ubidi, bd: BracketData, position: number): void {
  const run = bd.isoRuns[bd.isoRunLast]!
  const dirProps = u.dirProps
  const dirProp = dirProps[position]!
  let newProp: number
  if (dirProp === ON) {
    // The code unit itself: a supplementary character's trail surrogate matches nothing.
    let c = u.text.charCodeAt(position)
    for (let idx = run.limit - 1; idx >= run.start; idx--) {
      if (bd.openings[idx]!.match !== c) continue
      newProp = bracketProcessClosing(u, bd, idx, position)
      if (newProp === ON) { // N0d
        c = 0 // prevent handling as an opening
        break
      }
      run.lastBase = ON
      run.contextDir = newProp
      run.contextPos = position
      const level = u.levels[position]!
      if ((level & LEVEL_OVERRIDE) !== 0) { // X4, X5
        newProp = level & 1
        run.lastStrong = newProp
        const f = flag(newProp)
        for (let i = run.start; i < idx; i++) bd.openings[i]!.flags |= f
        u.levels[position] = level & ~LEVEL_OVERRIDE // matching brackets are not overridden by LRO/RLO
      }
      u.levels[bd.openings[idx]!.position]! &= ~LEVEL_OVERRIDE
      return
    }
    const match = c === 0 ? -1 : closingBracketOf(u.data, c)
    if (match >= 0) {
      // Synonyms: U+2329/U+232A and U+3008/U+3009 match each other.
      if (match === 0x232a) bracketAddOpening(bd, 0x3009, position)
      else if (match === 0x3009) bracketAddOpening(bd, 0x232a, position)
      bracketAddOpening(bd, match, position)
    }
  }
  const level = u.levels[position]!
  if ((level & LEVEL_OVERRIDE) !== 0) { // X4, X5
    newProp = level & 1
    if (dirProp !== S && dirProp !== WS && dirProp !== ON) dirProps[position] = newProp
    run.lastBase = newProp
    run.lastStrong = newProp
    run.contextDir = newProp
    run.contextPos = position
  } else if (dirProp === L || dirProp === R || dirProp === AL) {
    newProp = dirProp === L ? L : R
    run.lastBase = dirProp
    run.lastStrong = dirProp
    run.contextDir = newProp
    run.contextPos = position
  } else if (dirProp === EN) {
    run.lastBase = EN
    if (run.lastStrong === L) {
      newProp = L // W7
      dirProps[position] = ENL
      run.contextDir = L
      run.contextPos = position
    } else {
      newProp = R // N0
      dirProps[position] = run.lastStrong === AL ? AN : ENR // W2
      run.contextDir = R
      run.contextPos = position
    }
  } else if (dirProp === AN) {
    newProp = R // N0
    run.lastBase = AN
    run.contextDir = R
    run.contextPos = position
  } else if (dirProp === NSM) {
    // After ON, the NSM stays ON even if that ON is a bracket later changed to L or R.
    newProp = run.lastBase
    if (newProp === ON) dirProps[position] = newProp
  } else {
    newProp = dirProp
    run.lastBase = dirProp
  }
  if (newProp === L || newProp === R || newProp === AL) {
    const f = flag(newProp === L ? L : R)
    for (let i = run.start; i < run.limit; i++) if (position > bd.openings[i]!.position) bd.openings[i]!.flags |= f
  }
}

// ---- Explicit levels (ubidi.cpp:1004-1333) ----

// directionFromFlags (ubidi.cpp:1007-1018): text with AN and neutrals is mixed, because some neutrals may become RTL.
function directionFromFlags(flags: number): number {
  if ((flags & MASK_RTL) === 0 && ((flags & flag(AN)) === 0 || (flags & MASK_POSSIBLE_N) === 0)) return DIRECTION_LTR
  if ((flags & MASK_LTR) === 0) return DIRECTION_RTL
  return DIRECTION_MIXED
}

// resolveExplicitLevels (ubidi.cpp:1071-1333): X1-X9 with bracket processing, recomputing the flags.
function resolveExplicitLevels(u: Ubidi): number {
  const { dirProps, levels, text } = u
  const length = text.length
  let flags = u.flags
  let level = paraLevelAt(u, 0)
  const direction = directionFromFlags(flags)
  if (direction !== DIRECTION_MIXED) return direction // levels don't matter; trailingWSStart becomes 0
  if ((flags & (MASK_EXPLICIT | MASK_ISO)) === 0) {
    // No embeddings: every level is its paragraph's, but brackets still pair.
    const bd = bracketInit(u)
    for (let p = 0; p < u.paras.length; p++) {
      const start = p === 0 ? 0 : u.paras[p - 1]!.limit
      const limit = u.paras[p]!.limit
      level = u.paras[p]!.level
      for (let i = start; i < limit; i++) {
        levels[i] = level
        const dirProp = dirProps[i]!
        if (dirProp === BN) continue
        if (dirProp === B) {
          if (i + 1 < length && !(text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF)) bracketProcessB(bd, level)
          continue
        }
        bracketProcessChar(u, bd, i)
      }
    }
    return direction
  }

  // Both levels may carry LEVEL_OVERRIDE.
  let embeddingLevel = level
  let previousLevel = level // for regular (not CC) characters
  let lastCcPos = 0 // index of the last effective LRx, RLx, PDx
  // Embedding levels of the open entries; isolate entries have ISOLATE added.
  const stack = new Uint16Array(MAX_EXPLICIT_LEVEL + 2)
  let stackLast = 0
  let overflowIsolateCount = 0
  let overflowEmbeddingCount = 0
  let validIsolateCount = 0
  const bd = bracketInit(u)
  stack[0] = level
  flags = 0
  for (let i = 0; i < length; i++) {
    const dirProp = dirProps[i]!
    switch (dirProp) {
      case LRE:
      case RLE:
      case LRO:
      case RLO: { // X2-X5
        flags |= flag(BN)
        levels[i] = previousLevel
        const newLevel = dirProp === LRE || dirProp === LRO
          ? (embeddingLevel + 2) & ~(LEVEL_OVERRIDE | 1) // least greater even level
          : (noOverride(embeddingLevel) + 1) | 1 // least greater odd level
        if (newLevel <= MAX_EXPLICIT_LEVEL && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
          lastCcPos = i
          embeddingLevel = newLevel
          if (dirProp === LRO || dirProp === RLO) embeddingLevel |= LEVEL_OVERRIDE
          stackLast++
          stack[stackLast] = embeddingLevel
        } else if (overflowIsolateCount === 0) {
          overflowEmbeddingCount++
        }
        break
      }
      case PDF: // X7
        flags |= flag(BN)
        levels[i] = previousLevel
        if (overflowIsolateCount !== 0) break
        if (overflowEmbeddingCount !== 0) {
          overflowEmbeddingCount--
          break
        }
        if (stackLast > 0 && stack[stackLast]! < ISOLATE) { // not an isolate entry
          lastCcPos = i
          stackLast--
          embeddingLevel = stack[stackLast]! & 0xff // static_cast<UBiDiLevel> drops ISOLATE
        }
        break
      case LRI:
      case RLI: { // X5a, X5b
        flags |= flag(ON) | flagLR(embeddingLevel)
        levels[i] = noOverride(embeddingLevel)
        if (noOverride(embeddingLevel) !== noOverride(previousLevel)) {
          bracketProcessBoundary(u, bd, lastCcPos, previousLevel, embeddingLevel)
          u.multiRuns = true
        }
        previousLevel = embeddingLevel
        const newLevel = dirProp === LRI
          ? (embeddingLevel + 2) & ~(LEVEL_OVERRIDE | 1)
          : (noOverride(embeddingLevel) + 1) | 1
        if (newLevel <= MAX_EXPLICIT_LEVEL && overflowIsolateCount === 0 && overflowEmbeddingCount === 0) {
          flags |= flag(dirProp)
          lastCcPos = i
          validIsolateCount++
          embeddingLevel = newLevel
          stackLast++
          stack[stackLast] = embeddingLevel + ISOLATE
          bracketProcessIsolate(bd, embeddingLevel)
        } else {
          dirProps[i] = WS // adjustWSLevels handles it
          overflowIsolateCount++
        }
        break
      }
      case PDI: // X6a
        if (noOverride(embeddingLevel) !== noOverride(previousLevel)) {
          bracketProcessBoundary(u, bd, lastCcPos, previousLevel, embeddingLevel)
          u.multiRuns = true
        }
        if (overflowIsolateCount !== 0) {
          overflowIsolateCount--
          dirProps[i] = WS
        } else if (validIsolateCount !== 0) {
          flags |= flag(PDI)
          lastCcPos = i
          overflowEmbeddingCount = 0
          while (stack[stackLast]! < ISOLATE) stackLast-- // pop embedding entries up to the last isolate entry
          stackLast-- // and that entry too
          validIsolateCount--
          bracketProcessPDI(bd)
        } else {
          dirProps[i] = WS
        }
        embeddingLevel = stack[stackLast]! & 0xff
        flags |= flag(ON) | flagLR(embeddingLevel)
        previousLevel = embeddingLevel
        levels[i] = noOverride(embeddingLevel)
        break
      case B:
        flags |= flag(B)
        levels[i] = paraLevelAt(u, i)
        if (i + 1 < length) {
          if (text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF) break // skip CR when followed by LF
          overflowEmbeddingCount = overflowIsolateCount = 0
          validIsolateCount = 0
          stackLast = 0
          previousLevel = embeddingLevel = paraLevelAt(u, i + 1)
          stack[0] = embeddingLevel
          bracketProcessB(bd, embeddingLevel)
        }
        break
      case BN:
        // Removed by X9; adjustWSLevels sets the final level.
        levels[i] = previousLevel
        flags |= flag(BN)
        break
      default:
        if (noOverride(embeddingLevel) !== noOverride(previousLevel)) {
          bracketProcessBoundary(u, bd, lastCcPos, previousLevel, embeddingLevel)
          u.multiRuns = true
          flags |= (embeddingLevel & LEVEL_OVERRIDE) !== 0 ? flagO(embeddingLevel) : flagE(embeddingLevel)
        }
        previousLevel = embeddingLevel
        levels[i] = embeddingLevel
        bracketProcessChar(u, bd, i)
        flags |= flag(dirProps[i]!) // bracketProcessChar may have changed the class
        break
    }
  }
  if ((flags & MASK_EMBEDDING) !== 0) flags |= flagLR(u.paraLevel)
  u.flags = flags
  return directionFromFlags(flags)
}

// ---- Implicit levels (ubidi.cpp:1437-1615, 1827-2278), default reordering mode ----

// groupProp (ubidi.cpp:1437-1441): L R EN ES ET AN CS B S WS ON LRE LRO AL RLE RLO PDF NSM BN FSI LRI RLI PDI ENL ENR
const GROUP_PROP = [0, 1, 2, 7, 8, 3, 9, 6, 5, 4, 4, 10, 10, 12, 10, 10, 10, 11, 10, 4, 4, 4, 4, 13, 14]
const DIRPROP_ON = 4 // reduced dirProp (ubidi.cpp:1442)

// impTabProps (ubidi.cpp:1479-1506): a cell is newState + (action << 5); column 15 is the reduced property of the run.
const p = (action: number, newState: number): number => newState + (action << 5)
const IMP_TAB_PROPS: readonly (readonly number[])[] = [
  /*                     L ,      R ,     EN ,     AN ,     ON ,      S ,      B ,     ES ,     ET ,     CS ,     BN ,    NSM ,     AL ,    ENL ,    ENR , Res */
  /* 0 Init        */ [   1 ,      2 ,      4 ,      5 ,      7 ,     15 ,     17 ,      7 ,      9 ,      7 ,      0 ,      7 ,      3 ,     18 ,     21 , 4],
  /* 1 L           */ [   1 , p(1,2), p(1,4), p(1,5), p(1,7), p(1,15), p(1,17), p(1,7), p(1,9), p(1,7),      1 ,      1 , p(1,3), p(1,18), p(1,21), 0],
  /* 2 R           */ [p(1,1),     2 , p(1,4), p(1,5), p(1,7), p(1,15), p(1,17), p(1,7), p(1,9), p(1,7),      2 ,      2 , p(1,3), p(1,18), p(1,21), 1],
  /* 3 AL          */ [p(1,1), p(1,2), p(1,6), p(1,6), p(1,8), p(1,16), p(1,17), p(1,8), p(1,8), p(1,8),      3 ,      3 ,      3 , p(1,18), p(1,21), 1],
  /* 4 EN          */ [p(1,1), p(1,2),     4 , p(1,5), p(1,7), p(1,15), p(1,17), p(2,10),    11 , p(2,10),     4 ,      4 , p(1,3),     18 ,     21 , 2],
  /* 5 AN          */ [p(1,1), p(1,2), p(1,4),     5 , p(1,7), p(1,15), p(1,17), p(1,7), p(1,9), p(2,12),     5 ,      5 , p(1,3), p(1,18), p(1,21), 3],
  /* 6 AL:EN/AN    */ [p(1,1), p(1,2),     6 ,     6 , p(1,8), p(1,16), p(1,17), p(1,8), p(1,8), p(2,13),     6 ,      6 , p(1,3),     18 ,     21 , 3],
  /* 7 ON          */ [p(1,1), p(1,2), p(1,4), p(1,5),     7 , p(1,15), p(1,17),     7 , p(2,14),     7 ,      7 ,      7 , p(1,3), p(1,18), p(1,21), 4],
  /* 8 AL:ON       */ [p(1,1), p(1,2), p(1,6), p(1,6),     8 , p(1,16), p(1,17),     8 ,     8 ,      8 ,      8 ,      8 , p(1,3), p(1,18), p(1,21), 4],
  /* 9 ET          */ [p(1,1), p(1,2),     4 , p(1,5),     7 , p(1,15), p(1,17),     7 ,     9 ,      7 ,      9 ,      9 , p(1,3),     18 ,     21 , 4],
  /*10 EN+ES/CS    */ [p(3,1), p(3,2),     4 , p(3,5), p(4,7), p(3,15), p(3,17), p(4,7), p(4,14), p(4,7),     10 , p(4,7), p(3,3),     18 ,     21 , 2],
  /*11 EN+ET       */ [p(1,1), p(1,2),     4 , p(1,5), p(1,7), p(1,15), p(1,17), p(1,7),    11 , p(1,7),     11 ,     11 , p(1,3),     18 ,     21 , 2],
  /*12 AN+CS       */ [p(3,1), p(3,2), p(3,4),     5 , p(4,7), p(3,15), p(3,17), p(4,7), p(4,14), p(4,7),     12 , p(4,7), p(3,3), p(3,18), p(3,21), 3],
  /*13 AL:EN/AN+CS */ [p(3,1), p(3,2),     6 ,     6 , p(4,8), p(3,16), p(3,17), p(4,8), p(4,8), p(4,8),     13 , p(4,8), p(3,3),     18 ,     21 , 3],
  /*14 ON+ET       */ [p(1,1), p(1,2), p(4,4), p(1,5),     7 , p(1,15), p(1,17),     7 ,    14 ,      7 ,     14 ,     14 , p(1,3), p(4,18), p(4,21), 4],
  /*15 S           */ [p(1,1), p(1,2), p(1,4), p(1,5), p(1,7),     15 , p(1,17), p(1,7), p(1,9), p(1,7),     15 , p(1,7), p(1,3), p(1,18), p(1,21), 5],
  /*16 AL:S        */ [p(1,1), p(1,2), p(1,6), p(1,6), p(1,8),     16 , p(1,17), p(1,8), p(1,8), p(1,8),     16 , p(1,8), p(1,3), p(1,18), p(1,21), 5],
  /*17 B           */ [p(1,1), p(1,2), p(1,4), p(1,5), p(1,7), p(1,15),     17 , p(1,7), p(1,9), p(1,7),     17 , p(1,7), p(1,3), p(1,18), p(1,21), 6],
  /*18 ENL         */ [p(1,1), p(1,2),    18 , p(1,5), p(1,7), p(1,15), p(1,17), p(2,19),    20 , p(2,19),     18 ,     18 , p(1,3),     18 ,     21 , 0],
  /*19 ENL+ES/CS   */ [p(3,1), p(3,2),    18 , p(3,5), p(4,7), p(3,15), p(3,17), p(4,7), p(4,14), p(4,7),     19 , p(4,7), p(3,3),     18 ,     21 , 0],
  /*20 ENL+ET      */ [p(1,1), p(1,2),    18 , p(1,5), p(1,7), p(1,15), p(1,17), p(1,7),    20 , p(1,7),     20 ,     20 , p(1,3),     18 ,     21 , 0],
  /*21 ENR         */ [p(1,1), p(1,2),    21 , p(1,5), p(1,7), p(1,15), p(1,17), p(2,22),    23 , p(2,22),     21 ,     21 , p(1,3),     18 ,     21 , 3],
  /*22 ENR+ES/CS   */ [p(3,1), p(3,2),    21 , p(3,5), p(4,7), p(3,15), p(3,17), p(4,7), p(4,14), p(4,7),     22 , p(4,7), p(3,3),     18 ,     21 , 3],
  /*23 ENR+ET      */ [p(1,1), p(1,2),    21 , p(1,5), p(1,7), p(1,15), p(1,17), p(1,7),    23 , p(1,7),     23 ,     23 , p(1,3),     18 ,     21 , 3],
]

// impTabL_DEFAULT and impTabR_DEFAULT (ubidi.cpp:1586-1611): a cell is newState + (action << 4); column 7 is the level
// to add. impAct0 maps actions to themselves.
const s = (action: number, newState: number): number => newState + (action << 4)
const IMP_TAB_L: readonly (readonly number[])[] = [
  /*                L ,      R ,     EN ,     AN ,     ON ,      S ,      B , Res */
  /* 0 init    */ [ 0 ,      1 ,      0 ,      2 ,      0 ,      0 ,      0 , 0],
  /* 1 R       */ [ 0 ,      1 ,      3 ,      3 , s(1,4), s(1,4),      0 , 1],
  /* 2 AN      */ [ 0 ,      1 ,      0 ,      2 , s(1,5), s(1,5),      0 , 2],
  /* 3 R+EN/AN */ [ 0 ,      1 ,      3 ,      3 , s(1,4), s(1,4),      0 , 2],
  /* 4 R+ON    */ [ 0 , s(2,1), s(3,3), s(3,3),      4 ,      4 ,      0 , 0],
  /* 5 AN+ON   */ [ 0 , s(2,1),      0 , s(3,2),      5 ,      5 ,      0 , 0],
]
const IMP_TAB_R: readonly (readonly number[])[] = [
  /*                L ,      R ,     EN ,     AN ,     ON ,      S ,      B , Res */
  /* 0 init    */ [ 1 ,      0 ,      2 ,      2 ,      0 ,      0 ,      0 , 0],
  /* 1 L       */ [ 1 ,      0 ,      1 ,      3 , s(1,4), s(1,4),      0 , 1],
  /* 2 EN/AN   */ [ 1 ,      0 ,      2 ,      2 ,      0 ,      0 ,      0 , 1],
  /* 3 L+AN    */ [ 1 ,      0 ,      1 ,      3 ,      5 ,      5 ,      0 , 1],
  /* 4 L+ON    */ [s(2,1),   0 , s(2,1),      3 ,      4 ,      4 ,      0 , 0],
  /* 5 L+AN+ON */ [ 1 ,      0 ,      1 ,      3 ,      5 ,      5 ,      0 , 0],
]

// LevState (ubidiimp.h / ubidi.cpp:1775-1783), without the fields only the inverse modes use.
type LevState = { table: readonly (readonly number[])[]; startON: number; state: number; runStart: number; runLevel: number }

// setLevelsOutsideIsolates (ubidi.cpp:1827-1842)
function setLevelsOutsideIsolates(u: Ubidi, start: number, limit: number, level: number): void {
  let isolateCount = 0
  for (let k = start; k < limit; k++) {
    const dirProp = u.dirProps[k]!
    if (dirProp === PDI) isolateCount--
    if (isolateCount === 0) u.levels[k] = level
    if (dirProp === LRI || dirProp === RLI) isolateCount++
  }
}

// processPropertySeq (ubidi.cpp:1859-2063) with the actions impTab_DEFAULT uses (1-3).
function processPropertySeq(u: Ubidi, ls: LevState, prop: number, start: number, limit: number): void {
  const start0 = start
  const cell = ls.table[ls.state]![prop]!
  ls.state = cell & 0x0f
  const action = cell >> 4
  const addLevel = ls.table[ls.state]![7]!
  switch (action) {
    case 0:
      break
    case 1: // init ON seq
      ls.startON = start0
      break
    case 2: // prepend ON seq to current seq
      start = ls.startON
      break
    case 3: // EN/AN after R+ON
      setLevelsOutsideIsolates(u, ls.startON, start0, ls.runLevel + 1)
      break
  }
  if (addLevel !== 0 || start < start0) {
    const level = ls.runLevel + addLevel
    if (start >= ls.runStart) {
      for (let k = start; k < limit; k++) u.levels[k] = level
    } else {
      setLevelsOutsideIsolates(u, start, limit, level)
    }
  }
}

// resolveImplicitLevels (ubidi.cpp:2124-2278): W1-W7, N0-N2 (brackets were resolved already) and I1-I2 over one level
// run, resuming after an isolate from saved state.
function resolveImplicitLevels(u: Ubidi, start: number, limit: number, sor: number, eor: number): void {
  const dirProps = u.dirProps
  const runLevel = u.levels[start]!
  const ls: LevState = { table: (runLevel & 1) === 0 ? IMP_TAB_L : IMP_TAB_R, startON: -1, state: 0, runStart: start, runLevel }
  let start1: number
  let stateImp: number
  if (dirProps[start] === PDI && u.isolateCount >= 0) {
    const isolate = u.isolates[u.isolateCount]!
    ls.startON = isolate.startON
    start1 = isolate.start1
    stateImp = isolate.stateImp
    ls.state = isolate.state
    u.isolateCount--
  } else {
    start1 = start
    stateImp = dirProps[start] === NSM ? 1 + sor : 0
    processPropertySeq(u, ls, sor, start, start)
  }
  let start2 = start
  for (let i = start; i <= limit; i++) {
    let gprop: number
    if (i >= limit) {
      let k = limit - 1
      while (k > start && (flag(dirProps[k]!) & MASK_BN_EXPLICIT) !== 0) k--
      const dirProp = dirProps[k]!
      if (dirProp === LRI || dirProp === RLI) break // no forced closing for a sequence ending with LRI/RLI
      gprop = eor
    } else {
      const prop = dirProps[i]!
      if (prop === B) u.isolateCount = -1 // current isolates stack entry == none
      gprop = GROUP_PROP[prop]!
    }
    const oldStateImp = stateImp
    const cell = IMP_TAB_PROPS[oldStateImp]![gprop]!
    stateImp = cell & 0x1f
    let actionImp = cell >> 5
    if (i === limit && actionImp === 0) actionImp = 1 // process the last sequence
    if (actionImp !== 0) {
      const resProp = IMP_TAB_PROPS[oldStateImp]![15]!
      switch (actionImp) {
        case 1: // process current seq1, init new seq1
          processPropertySeq(u, ls, resProp, start1, i)
          start1 = i
          break
        case 2: // init new seq2
          start2 = i
          break
        case 3: // process seq1, process seq2, init new seq1
          processPropertySeq(u, ls, resProp, start1, start2)
          processPropertySeq(u, ls, DIRPROP_ON, start2, i)
          start1 = i
          break
        case 4: // process seq1, set seq1=seq2, init new seq2
          processPropertySeq(u, ls, resProp, start1, start2)
          start1 = start2
          start2 = i
          break
      }
    }
  }
  // The last character that isn't BN or LRE/RLE/LRO/RLO/PDF.
  let last = limit - 1
  while (last > start && (flag(dirProps[last]!) & MASK_BN_EXPLICIT) !== 0) last--
  const dirProp = dirProps[last]!
  if ((dirProp === LRI || dirProp === RLI) && limit < u.text.length) {
    u.isolateCount++
    u.isolates[u.isolateCount] = { stateImp, state: ls.state, start1, startON: ls.startON }
  } else {
    processPropertySeq(u, ls, eor, limit, limit)
  }
}

// adjustWSLevels (ubidi.cpp:2288-2325): L1 at the text end and before B and S, and removed characters take the next
// character's level.
function adjustWSLevels(u: Ubidi, trailingWSStart: number): void {
  if ((u.flags & MASK_WS) === 0) return
  const { dirProps, levels } = u
  let i = trailingWSStart
  while (i > 0) {
    // A sequence of WS and BN before the end or before B/S gets the paragraph level.
    while (i > 0 && (flag(dirProps[--i]!) & MASK_WS) !== 0) levels[i] = paraLevelAt(u, i)
    // BN takes the next character's level until B/S, which restarts the loop above.
    while (i > 0) {
      const f = flag(dirProps[--i]!)
      if ((f & MASK_BN_EXPLICIT) !== 0) {
        levels[i] = levels[i + 1]!
      } else if ((f & MASK_B_S) !== 0) {
        levels[i] = paraLevelAt(u, i)
        break
      }
    }
  }
}

// ubidi_setPara (ubidi.cpp:2553-2855), then ubidi_getDirection, ubidi_getParagraphByIndex and ubidi_getLevels.
export function resolveIcuBidi(text: string, direction: ParagraphDirection, data: BidiData): IcuBidiParagraph {
  let paraLevel: number
  switch (direction) {
    case 'ltr': paraLevel = 0; break
    case 'rtl': paraLevel = 1; break
    case 'auto': paraLevel = DEFAULT_LTR; break
  }
  const length = text.length
  if (length === 0) return { direction: (paraLevel & 1) === 0 ? 'ltr' : 'rtl', paragraphs: [], levels: new Uint8Array(0) }
  const u: Ubidi = {
    text, data, dirProps: new Uint8Array(length), levels: new Uint8Array(length), paraLevel, defaultParaLevel: paraLevel === DEFAULT_LTR,
    paras: [{ limit: 0, level: 0 }], flags: 0, multiRuns: false, isolateCount: -1, isolates: [],
  }
  getDirProps(u)
  const resolved = resolveExplicitLevels(u)
  const { dirProps, levels } = u
  u.isolateCount = -1
  if (resolved === DIRECTION_MIXED) {
    if (u.paras.length <= 1 && !u.multiRuns) {
      // No significant explicit codes: the paragraph is one run (X10).
      resolveImplicitLevels(u, 0, length, paraLevelAt(u, 0) & 1, paraLevelAt(u, length - 1) & 1)
    } else {
      // sor, eor: start and end types of each same-level run. Level runs split where the override bit changes too.
      let level = paraLevelAt(u, 0)
      let nextLevel = levels[0]!
      let eor = level < nextLevel ? nextLevel & 1 : level & 1
      let limit = 0
      do {
        const start = limit
        level = nextLevel
        const sor = start > 0 && dirProps[start - 1] === B ? paraLevelAt(u, start) & 1 : eor
        while (++limit < length && (levels[limit] === level || (flag(dirProps[limit]!) & MASK_BN_EXPLICIT) !== 0)) {}
        nextLevel = limit < length ? levels[limit]! : paraLevelAt(u, length - 1)
        eor = noOverride(level) < noOverride(nextLevel) ? nextLevel & 1 : level & 1
        if ((level & LEVEL_OVERRIDE) === 0) {
          resolveImplicitLevels(u, start, limit, sor, eor)
        } else {
          for (let k = start; k < limit; k++) levels[k]! &= ~LEVEL_OVERRIDE
        }
      } while (limit < length)
    }
    adjustWSLevels(u, length)
  } else {
    // ubidi_getLevels with trailingWSStart 0: every level is the (first) paragraph level.
    levels.fill(u.paraLevel)
  }
  const paragraphs: IcuBidiParagraph['paragraphs'] = []
  for (let i = 0; i < u.paras.length; i++) paragraphs.push({ end: u.paras[i]!.limit, level: u.paras[i]!.level })
  let out: IcuBidiParagraph['direction']
  switch (resolved) {
    case DIRECTION_LTR: out = 'ltr'; break
    case DIRECTION_RTL: out = 'rtl'; break
    default: out = 'mixed'; break
  }
  return { direction: out, paragraphs, levels }
}
