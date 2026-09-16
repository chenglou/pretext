// The Gecko port's character properties (generated from ICU 78.2 ppucd.txt) against icu_properties 2.1.2's compiled data,
// the crate Firefox 156 vendors (specs/gecko-canvas.md §4.1), for every code point except surrogates (DESIGN.md §6.1).
// The groundwork's props-dump binary prints that data as JSON ranges [first, last, value]
// (pretext-emulation-20260915/runtime-parity/gecko/tools/props-dump). Not in the dump, so not checked here:
// Emoji_Presentation, Emoji_Modifier and Joining_Type.
import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { eastAsianWidths } from './generated/props.js'
import {
  generalCategory, isBidiMirrored, isDefaultIgnorable, isEmoji, openingMirror, packedProps, scriptExtensions, scriptOf,
} from './props.js'

const DUMP = resolve(homedir(), 'github/browser-engines/pretext-emulation-20260915/runtime-parity/gecko/tools/props-dump/target/release/props-dump')

// ICU4X's enum discriminants follow ICU's UCharCategory and UEastAsianWidth.
const GC = ['Cn', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'Mn', 'Me', 'Mc', 'Nd', 'Nl', 'No', 'Zs', 'Zl', 'Zp', 'Cc', 'Cf', 'Co', 'Cs', 'Pd', 'Ps', 'Pe', 'Pc', 'Po', 'Sm', 'Sc', 'Sk', 'So', 'Pi', 'Pf']
const EAW = ['N', 'A', 'H', 'F', 'Na', 'W']

type Ranges<T> = [number, number, T][]
type Dump = {
  generalCategory: Ranges<number>; eastAsianWidth: Ranges<number>; emoji: Ranges<boolean>; defaultIgnorable: Ranges<boolean>
  bidiMirrored: Ranges<boolean>; script: Ranges<string>; scriptExtensions: Ranges<string>; mirroringGlyph: [number, number][]
}

test('generated props equal icu_properties 2.1.2 for every code point', () => {
  const run = Bun.spawnSync([DUMP])
  expect(run.exitCode).toBe(0)
  const dump = JSON.parse(run.stdout.toString()) as Dump
  const mismatches: string[] = []
  const compare = <T>(name: string, ranges: Ranges<T>, port: (cp: number) => T): void => {
    for (let r = 0; r < ranges.length; r++) {
      const [first, last, value] = ranges[r]!
      for (let cp = first; cp <= last; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue
        const ours = port(cp)
        if (ours !== value && mismatches.length < 20) mismatches.push(`${name} U+${cp.toString(16).toUpperCase()}: ${String(ours)} vs ${String(value)}`)
      }
    }
  }
  compare('General_Category', dump.generalCategory.map(([a, b, v]) => [a, b, GC[v]!] as [number, number, string]), generalCategory)
  compare('East_Asian_Width', dump.eastAsianWidth.map(([a, b, v]) => [a, b, EAW[v]!] as [number, number, string]), cp => eastAsianWidths[(packedProps(cp) >> 5) & 7]!)
  compare('Emoji', dump.emoji, isEmoji)
  compare('Default_Ignorable_Code_Point', dump.defaultIgnorable, isDefaultIgnorable)
  compare('Bidi_Mirrored', dump.bidiMirrored, isBidiMirrored)
  compare('Script', dump.script, scriptOf)
  compare('Script_Extensions', dump.scriptExtensions, scriptExtensions)
  // The itemizer reads the mirror of opening punctuation from U+0F3A on (gfxScriptItemizer.cpp:60-243).
  const glyph = new Map<number, number>(dump.mirroringGlyph)
  for (let cp = 0x0f3a; cp <= 0x10ffff; cp++) {
    if (generalCategory(cp) !== 'Ps') continue
    const ours = openingMirror(cp)
    const theirs = glyph.get(cp) ?? cp
    if (ours !== theirs && mismatches.length < 20) mismatches.push(`Bidi_Mirroring_Glyph U+${cp.toString(16).toUpperCase()}: ${ours} vs ${theirs}`)
  }
  expect(mismatches).toEqual([])
})
