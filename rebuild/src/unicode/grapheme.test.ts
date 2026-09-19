// Grapheme boundaries with each engine's data against GraphemeBreakTest-17.0.0.txt, the conformance file ICU 78's
// rbbitst runs (third_party/icu/source/test/testdata in the Chromium ICU pin). ICU4X passes the same file upstream.
import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { BROWSER_ENGINES } from '../../tools/gen-shared.ts'
import { forEachLine } from '../../tools/lines.ts'
import { blinkGraphemeRules } from '../engines/blink/data.js'
import { geckoGraphemeRules } from '../engines/gecko/data.js'
import { webkitGraphemeRules } from '../engines/webkit/data.js'
import type { EngineName } from '../env.js'
import { graphemeBoundaries, type GraphemeRules } from './grapheme.js'

const GRAPHEME_BREAK_TEST = resolve(BROWSER_ENGINES, 'chromium-152/src/third_party/icu/source/test/testdata/GraphemeBreakTest.txt')

const engines: [EngineName, GraphemeRules][] = [['blink', blinkGraphemeRules], ['webkit', webkitGraphemeRules], ['gecko', geckoGraphemeRules]]
for (let e = 0; e < engines.length; e++) {
  const [engine, rules] = engines[e]!
  test(`${engine} grapheme data passes GraphemeBreakTest-17.0.0`, async () => {
    let cases = 0
    const failures: string[] = []
    await forEachLine(GRAPHEME_BREAK_TEST, line => {
      const body = line.split('#')[0]!.trim()
      if (body.length === 0) return
      const tokens = body.split(/\s+/)
      let text = ''
      const expected: number[] = []
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!
        if (token === '÷') expected.push(text.length)
        else if (token !== '×') text += String.fromCodePoint(parseInt(token, 16))
      }
      cases++
      const actual = graphemeBoundaries(text, rules)
      if (actual.join(' ') !== expected.join(' ')) failures.push(`${body}: got ${actual.join(' ')}`)
    })
    expect(cases).toBeGreaterThan(700)
    expect(failures.slice(0, 10)).toEqual([])
  })
}
