// The stand-in Canvas (stand-in-canvas.ts): its widths behave where the ports' recipes look, and the three ports lay the
// hand-written smoke cases out on it through the lab's predictor, the same way twice.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as predictor from '../lab/baselines/no-facts-predictor.ts'
import type { PageFacts } from '../lab/measurements.ts'
import type { BrowserKind, Case } from '../lab/types.ts'
import { PINNED_BUILDS } from '../src/env.ts'
import { installStandIn } from './stand-in-canvas.ts'

const PAGES: Array<{ browser: BrowserKind; build: string; env: PageFacts }> = [
  { browser: 'chrome', build: PINNED_BUILDS.blink, env: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', devicePixelRatio: 2, pageLang: 'en' } },
  { browser: 'webkit-host', build: PINNED_BUILDS.webkit, env: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15', devicePixelRatio: 2, pageLang: 'en' } },
  { browser: 'firefox', build: PINNED_BUILDS.gecko, env: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0', devicePixelRatio: 2, pageLang: 'en' } },
]

function measure(env: PageFacts, settings: Record<string, string>, text: string): number {
  const standIn = installStandIn(env)
  try {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')! as unknown as Record<string, string> & { measureText(text: string): { width: number } }
    for (const [name, value] of Object.entries(settings)) ctx[name] = value
    return ctx.measureText(text).width
  } finally {
    standIn.restore()
  }
}

describe('the stand-in Canvas', () => {
  const chrome = PAGES[0]!.env
  const firefox = PAGES[2]!.env
  const font = { font: 'normal 400 16px Arial' }

  test('the same question has the same answer, and another font another one', () => {
    expect(measure(chrome, font, 'The quick brown fox')).toBe(measure(chrome, font, 'The quick brown fox'))
    expect(measure(chrome, font, 'The quick brown fox')).not.toBe(measure(chrome, { font: 'normal 400 16px Georgia' }, 'The quick brown fox'))
    expect(measure(chrome, { font: 'normal 400 32px Arial' }, 'fox')).toBeGreaterThan(measure(chrome, font, 'fox'))
  })

  test('a string isn\'t the sum of its parts: pairs kern, and fi is a ligature until letter spacing turns it off', () => {
    const text = 'WAVE To AVAIL Yours'
    let parts = 0
    for (const ch of text) parts += measure(chrome, font, ch)
    expect(measure(chrome, font, text)).not.toBe(parts)
    expect(measure(chrome, { ...font, fontKerning: 'none' }, text)).toBe(parts)
    expect(measure(chrome, { ...font, fontKerning: 'none' }, 'fi')).toBeLessThan(measure(chrome, { ...font, fontKerning: 'none' }, 'f') + measure(chrome, { ...font, fontKerning: 'none' }, 'i'))
  })

  test('U+200D changes a letter\'s width on either side of it, and has none alone', () => {
    const arabic = { font: 'normal 400 16px "Geeza Pro"' }
    expect(measure(chrome, arabic, '‍')).toBe(0)
    let differs = 0
    for (const letter of ['ب', 'ت', 'س', 'م', 'ه', 'ي']) {
      if (measure(chrome, arabic, `${letter}‍`) !== measure(chrome, arabic, letter)) differs++
      if (measure(chrome, arabic, `‍${letter}`) !== measure(chrome, arabic, letter)) differs++
    }
    expect(differs).toBeGreaterThan(6)
  })

  test('letter spacing adds to every character: 1/64 px exactly in Blink\'s recipe, nothing at 0.001px in Gecko\'s', () => {
    const text = 'nnnnnnnnnnnnnnnn'
    expect(measure(chrome, { ...font, letterSpacing: '0.015625px' }, text) - measure(chrome, font, text)).toBe(16 / 64)
    expect(measure(firefox, { ...font, letterSpacing: '0.001px' }, text)).toBe(measure(firefox, font, text))
    expect(measure(chrome, { ...font, letterSpacing: '2px' }, text) - measure(chrome, font, text)).toBe(32)
    expect(measure(chrome, { ...font, wordSpacing: '3px' }, 'a b c') - measure(chrome, font, 'a b c')).toBe(6)
  })

  test('the three ports lay the smoke cases out on it, the same way twice', () => {
    const cases = readFileSync(join(import.meta.dir, '../lab/smoke-cases.ndjson'), 'utf8').split('\n').filter(line => line !== '').map(line => JSON.parse(line) as Case)
    for (const page of PAGES) {
      let lines = 0
      for (const c of cases) {
        if (c.browsers !== undefined && !c.browsers.includes(page.browser)) continue
        const runs: string[] = []
        for (let k = 0; k < 2; k++) {
          const standIn = installStandIn({ ...page.env, pageLang: c.pageLang })
          try {
            const hook = predictor.predict(c, { browser: page.browser, build: page.build, languages: null })
            if (!('layout' in hook)) throw new Error(`${page.browser} ${c.id}: ${JSON.stringify(hook)}`)
            const { measure: _measure, ...layout } = hook.layout
            runs.push(JSON.stringify(layout))
            lines += hook.layout.lines.length
            expect(standIn.asked).toBeGreaterThan(0)
          } finally {
            standIn.restore()
          }
        }
        expect(runs[0]).toBe(runs[1]!)
      }
      expect(lines).toBeGreaterThan(50)
    }
  })
})
