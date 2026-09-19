// Bidi data against the engines' own data, for every code point:
// - Blink's Bidi_Class and paired brackets against u_charDirection and u_getBidiPairedBracket of Homebrew icu4c 78.3,
//   whose bidi property data is byte-identical to Chrome 153's ICU 78.2 (specs/bidi.md §5.1);
// - WebKit's against the system libicucore, Safari 27's ICU on macOS 27;
// - Gecko's: the Bidi_Class Firefox reads from icu_properties 2.1.2 (the groundwork's props dump) equals ICU 78.2's, and
//   unicode-bidi's bracket table holds Unicode 17's pairs.
import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { BROWSER_ENGINES } from '../../tools/gen-shared.ts'
import { ICU_VERSIONS, buildIcuBidiOracle, runIcuBidiOracle, type IcuBuild } from '../../tools/icu-bidi-oracle.ts'
import { blinkBidiData } from '../engines/blink/data.js'
import { geckoBidiData } from '../engines/gecko/data.js'
import { webkitBidiData } from '../engines/webkit/data.js'
import type { EngineName } from '../env.js'
import { bidiClassOf, type BidiData } from './bidi.js'

const GROUNDWORK_GECKO_PROPS = resolve(BROWSER_ENGINES, 'pretext-emulation-20260915/runtime-parity/gecko/src/generated/gecko-props-data.ts')

const ORACLES: [EngineName, IcuBuild, BidiData][] = [['blink', 'icu4c-78', blinkBidiData], ['webkit', 'libicucore', webkitBidiData]]

for (let o = 0; o < ORACLES.length; o++) {
  const [engine, build, data] = ORACLES[o]!
  test(`${engine} Bidi_Class and paired brackets equal ${build}`, () => {
    const binary = buildIcuBidiOracle(build)
    expect(runIcuBidiOracle(binary, 'version', '').trim()).toBe(ICU_VERSIONS[build])
    const differences: string[] = []
    const icuBrackets: number[] = []
    const lines = runIcuBidiOracle(binary, 'classes', '').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const fields = lines[i]!.split(' ')
      switch (fields[0]) {
        case 'class': {
          const last = parseInt(fields[2]!, 16)
          const cls = Number(fields[3])
          for (let cp = parseInt(fields[1]!, 16); cp <= last; cp++) {
            if (bidiClassOf(data, cp) !== cls && differences.length < 10) differences.push(`U+${cp.toString(16)}: ${bidiClassOf(data, cp)}, ICU ${cls}`)
          }
          break
        }
        case 'bracket':
          icuBrackets.push(parseInt(fields[1]!, 16), parseInt(fields[2]!, 16))
          break
      }
    }
    expect(differences).toEqual([])
    const brackets: number[] = []
    for (let k = 0; k < data.brackets.length; k += 3) brackets.push(data.brackets[k]!, data.brackets[k + 1]!)
    expect(brackets).toEqual(icuBrackets)
  }, 120000)
}

test('icu_properties 2.1.2 Bidi_Class equals ICU 78.2 Bidi_Class', async () => {
  const props = await import(GROUNDWORK_GECKO_PROPS) as { bidiClassRanges: readonly number[] }
  const flat = props.bidiClassRanges
  const classOf = new Uint8Array(0x110000)
  let previousEnd = -1
  for (let i = 0; i < flat.length; i += 3) {
    const start = previousEnd + 1 + flat[i]!
    previousEnd = start + flat[i + 1]!
    classOf.fill(flat[i + 2]!, start, previousEnd + 1)
  }
  const data = geckoBidiData
  const differences: string[] = []
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    // The groundwork dump treats ASCII letters as L without a table lookup; the table holds the same values.
    if (bidiClassOf(data, cp) !== classOf[cp] && differences.length < 10) differences.push(`U+${cp.toString(16)}: ${bidiClassOf(data, cp)} vs ${classOf[cp]}`)
  }
  expect(differences).toEqual([])
}, 60000)

test('unicode-bidi 0.3.15 bracket pairs equal Unicode 17 pairs', () => {
  expect(geckoBidiData.brackets).toEqual(blinkBidiData.brackets)
})
