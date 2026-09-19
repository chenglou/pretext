// ScriptRunIterator (script_run_iterator.cc at Chrome 153) with ICU 78.2's script data. RunSegmenter takes its script
// runs from it (run_segmenter.cc:46-72) for a 16-bit text_content (inline_node.cc:1256-1290) and for every 16-bit string
// Canvas shapes (harfbuzz_shaper.cc:1080-1101); an 8-bit string is one Latin segment in both (:1072-1077). HarfBuzz shapes
// each run with its script, and letter spacing skips cursive runs (shape_result.cc:977-1024). The fast path through
// GetSafeToExtendExistingRun (:293-372) only skips characters the slow path would merge, so it isn't ported.
import { blinkBidiData } from './data.js'
import {
  USCRIPT_BOPOMOFO, USCRIPT_COMMON, USCRIPT_HAN, USCRIPT_HIRAGANA, USCRIPT_INHERITED, USCRIPT_INVALID_CODE, USCRIPT_KATAKANA,
  USCRIPT_KATAKANA_OR_HIRAGANA, USCRIPT_LATIN, isEastAsianWide, pairedBracketType, scriptExtensionsOf, scriptOf,
} from './props.js'

// script_run_iterator.h:67.
const MAX_BRACKETS = 32
const BRACKET_OPEN = 1
const BRACKET_CLOSE = 2

function swap(list: number[], i: number, j: number): void {
  const t = list[i]!
  list[i] = list[j]!
  list[j] = t
}

// ICUScriptData::GetScripts (:133-229), with GetScriptForOpenType collapsing Katakana into Hiragana (:27-37).
function getScripts(ch: number): number[] {
  let primary = scriptOf(ch)
  if (primary === USCRIPT_KATAKANA || primary === USCRIPT_KATAKANA_OR_HIRAGANA) primary = USCRIPT_HIRAGANA
  if (primary === USCRIPT_HIRAGANA) return [USCRIPT_HIRAGANA]
  const dst = scriptExtensionsOf(ch).slice()
  if (primary === dst[0]) return dst
  if (primary !== USCRIPT_INHERITED && primary !== USCRIPT_COMMON && primary !== USCRIPT_INVALID_CODE) {
    const it = dst.indexOf(primary, 1)
    if (it < 0) {
      dst.push(primary)
      swap(dst, 0, dst.length - 1)
    } else {
      swap(dst, 0, it)
    }
    return dst
  }
  if (primary === USCRIPT_COMMON) {
    if (dst.length === 1) {
      dst.unshift(primary)
      return dst
    }
    for (let i = 1; i < dst.length; i++) if (dst[0] === USCRIPT_LATIN || dst[i]! < dst[0]!) swap(dst, 0, i)
    return dst
  }
  dst.push(dst[0]!)
  dst[0] = primary
  for (let i = 2; i < dst.length; i++) if (dst[1] === USCRIPT_LATIN || dst[i]! < dst[1]!) swap(dst, 1, i)
  return dst
}

// IsHanScript (:39-42).
function isHanScript(script: number): boolean {
  return script === USCRIPT_HAN || script === USCRIPT_HIRAGANA || script === USCRIPT_BOPOMOFO
}

// u_getBidiPairedBracket (Bidi_Paired_Bracket), from the [opening, closing, canonical opening] triples.
function pairedBracket(ch: number): number {
  const triples = blinkBidiData.brackets
  for (let i = 0; i < triples.length; i += 3) {
    if (triples[i] === ch) return triples[i + 1]!
    if (triples[i + 1] === ch) return triples[i]!
  }
  return ch
}

class ScriptRunIterator {
  readonly text: string
  currentSet: number[] = []
  nextSet: number[] = []
  aheadSet: number[] = []
  aheadCharacter = 0
  aheadPos = 0
  commonPreferred = USCRIPT_COMMON
  brackets: { ch: number; script: number }[] = []
  fixupDepth = 0

  constructor(text: string) {
    this.text = text
    if (text.length > 0) {
      // Primed with Common so that the first MergeSets takes the first character's scripts (:250-262).
      this.currentSet = [USCRIPT_COMMON]
      this.nextCodePoint()
      this.aheadSet = getScripts(this.aheadCharacter)
    }
  }

  // U16_NEXT over the text from aheadPos.
  nextCodePoint(): void {
    const text = this.text
    const c = text.charCodeAt(this.aheadPos)
    if ((c & 0xfc00) === 0xd800 && this.aheadPos + 1 < text.length && (text.charCodeAt(this.aheadPos + 1) & 0xfc00) === 0xdc00) {
      this.aheadCharacter = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(this.aheadPos + 1) - 0xdc00)
      this.aheadPos += 2
    } else {
      this.aheadCharacter = c
      this.aheadPos += 1
    }
  }

  // Consume (:266-352): the next run's limit and script, or null at the end.
  consume(): { limit: number; script: number } | null {
    if (this.currentSet.length === 0) return null
    for (;;) {
      if (this.aheadPos > this.text.length) break
      const pos = this.aheadPos - (this.aheadCharacter >= 0x10000 ? 2 : 1)
      const ch = this.aheadCharacter
      this.fetch()
      const pairedType = pairedBracketType(ch)
      switch (pairedType) {
        case BRACKET_OPEN: this.openBracket(ch); break
        case BRACKET_CLOSE: this.closeBracket(ch); break
      }
      if (!this.mergeSets()) {
        const script = this.resolveCurrentScript()
        // An open bracket belongs to the next run (:283-286).
        this.fixupStack(script, pairedType === BRACKET_OPEN)
        this.currentSet = this.nextSet.slice()
        return { limit: pos, script }
      }
    }
    const script = this.resolveCurrentScript()
    this.currentSet = []
    return { limit: this.text.length, script }
  }

  // Fetch (:566-582) after the position and character were read.
  fetch(): void {
    const t = this.nextSet
    this.nextSet = this.aheadSet
    this.aheadSet = t
    if (this.aheadPos === this.text.length) {
      this.aheadPos++
      return
    }
    this.fetchNextCharacter()
  }

  // FetchNextCharacter (:584-606): an inherited character with other scripts hands them to a preceding Common one.
  fetchNextCharacter(): void {
    this.nextCodePoint()
    this.aheadSet = getScripts(this.aheadCharacter)
    if (this.aheadSet[0] === USCRIPT_INHERITED && this.aheadSet.length > 1) {
      if (this.nextSet[0] === USCRIPT_COMMON) this.nextSet = this.aheadSet.slice(1)
      this.aheadSet = [this.aheadSet[0]!]
    }
  }

  // OpenBracket (:354-364) with FixScriptsByEastAsianWidth (:80-113).
  openBracket(ch: number): void {
    if (this.brackets.length === MAX_BRACKETS) {
      this.brackets.shift()
      if (this.fixupDepth === MAX_BRACKETS) this.fixupDepth--
    }
    if (this.nextSet.length === 1 && this.nextSet[0] === USCRIPT_COMMON && isEastAsianWide(ch)) {
      this.nextSet = scriptExtensionsOf(0x300c).slice()
    }
    this.brackets.push({ ch, script: USCRIPT_COMMON })
    this.fixupDepth++
  }

  // CloseBracket (:366-403). The matched open bracket stays on the stack; only newer ones are popped.
  closeBracket(ch: number): void {
    if (this.brackets.length === 0) return
    const target = pairedBracket(ch)
    for (let i = this.brackets.length - 1; i >= 0; i--) {
      if (this.brackets[i]!.ch !== target) continue
      let script = this.brackets[i]!.script
      if (isHanScript(script)) {
        for (let k = 0; k < this.currentSet.length; k++) {
          if (isHanScript(this.currentSet[k]!)) {
            script = this.currentSet[k]!
            break
          }
        }
      }
      if (script !== USCRIPT_COMMON) this.nextSet = [script]
      const numPopped = this.brackets.length - 1 - i
      this.brackets.length -= numPopped
      this.fixupDepth = Math.max(0, this.fixupDepth - numPopped)
      return
    }
  }

  // MergeSets (:405-495).
  mergeSets(): boolean {
    const current = this.currentSet
    const next = this.nextSet
    if (next.length === 0 || current.length === 0) return false
    let priority = current[0]!
    if (next[0]! <= USCRIPT_INHERITED) {
      if (next.length === 2 && priority <= USCRIPT_INHERITED && this.commonPreferred === USCRIPT_COMMON) this.commonPreferred = next[1]!
      return true
    }
    if (priority <= USCRIPT_INHERITED) {
      this.currentSet = next.slice()
      return true
    }
    let havePriority = next.includes(priority)
    if (current.length === 1) return havePriority
    let nextIt = 0
    if (!havePriority) {
      priority = next[nextIt++]!
      havePriority = current.indexOf(priority, 1) >= 0
    }
    const written: number[] = []
    if (havePriority) written.push(priority)
    if (nextIt !== next.length) {
      for (let c = 1; c < current.length; c++) if (next.indexOf(current[c]!, nextIt) >= 0) written.push(current[c]!)
    }
    if (written.length === 0) return false
    this.currentSet = written
    return true
  }

  // FixupStack (:505-527).
  fixupStack(resolved: number, excludeLast: boolean): void {
    let count = this.fixupDepth
    if (count <= 0) return
    if (count > this.brackets.length) count = this.brackets.length
    let i = this.brackets.length - 1
    if (excludeLast) {
      i--
      count--
      this.fixupDepth = 1
    } else {
      this.fixupDepth = 0
    }
    for (; count > 0; i--, count--) this.brackets[i]!.script = resolved
  }

  // ResolveCurrentScript (:608-611).
  resolveCurrentScript(): number {
    const result = this.currentSet[0]!
    return result === USCRIPT_COMMON ? this.commonPreferred : result
  }
}

// The runs of a 16-bit text as [limit, script] pairs, limits in code units.
export function scriptRuns(text: string): number[] {
  const out: number[] = []
  const iterator = new ScriptRunIterator(text)
  for (let run = iterator.consume(); run !== null; run = iterator.consume()) out.push(run.limit, run.script)
  return out
}

// The run script of every code unit of a 16-bit text.
export function scriptsPerUnit(text: string): Uint8Array {
  const scripts = new Uint8Array(text.length)
  const runs = scriptRuns(text)
  let start = 0
  for (let i = 0; i < runs.length; i += 2) {
    scripts.fill(runs[i + 1]!, start, runs[i]!)
    start = runs[i]!
  }
  return scripts
}
