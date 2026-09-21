import { beforeAll, describe, expect, test } from 'bun:test'
import { PINNED_BUILDS, type BlinkEnvironment } from '../../env.js'
import { UNKNOWN_FONT_FACTS, type Paragraph } from '../../model.js'
import { createContextPool } from '../../measure/canvas.js'
import { paragraphGaps, prepare } from './index.js'
import { OffsetRuns } from './offset-runs.js'
import { clusterEndAfter, clusterStartAtOrBefore, isClusterBoundary, sliceEdge } from './shape.js'

class Context {
  font = '16px Mono'; lang = ''; letterSpacing = '0px'; wordSpacing = '0px'
  fontKerning = 'auto'; textRendering = 'auto'; direction = 'ltr'
  measureText(text: string): { width: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number } {
    return { width: text.length, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }
  }
}
beforeAll(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { getContext(): Context { return new Context() } }
})
const env: BlinkEnvironment = {
  engine: 'blink', build: PINNED_BUILDS.blink, devicePixelRatio: 1, pageLang: 'en', contentLanguage: null, uiLanguage: 'en',
  dictionaryBreaks: { kind: 'unavailable' },
}
function paragraph(text: string): Paragraph {
  return {
    font: { family: 'Mono', size: 16, weight: 400, style: 'normal', facts: UNKNOWN_FONT_FACTS }, letterSpacing: 0, wordSpacing: 0,
    whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
    content: [{ kind: 'text', text }], lineHeight: 20, direction: 'ltr', lang: 'en', textIndent: 0, textAlign: 'start',
  }
}

describe('blink fixed source and cluster runs', () => {
  test('runs report the extent of the original membership across empty, dense and separated input', () => {
    let seed = 923744
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (let c = 0; c < 32; c++) {
      const membership = Array.from({ length: c * 7 }, (_, k) => c % 3 === 0 || c % 3 === 1 ? c % 3 === 0 && k > 0 : random() < 0.5)
      const runs = new OffsetRuns(membership.length, k => membership[k]!)
      for (let k = 0; k < membership.length; k++) {
        if (!membership[k]) continue
        let start = k, end = k + 1
        while (start > 0 && membership[start - 1]) start--
        while (end < membership.length && membership[end]) end++
        expect([runs.start(k), runs.end(k)]).toEqual([start, end])
      }
    }
  })

  test('a long mark cluster respects shaping-call and item edges inside the global cluster', () => {
    const text = 'a' + '\u0301'.repeat(8191)
    const p = prepare(paragraph(text), env, false, createContextPool())
    for (const k of [1, 4095, 4096, 8191]) {
      expect(clusterStartAtOrBefore(p, k, 0)).toBe(0)
      expect(clusterStartAtOrBefore(p, k, 4096)).toBe(Math.min(k, 4096))
      expect(clusterEndAfter(p, k - 1, text.length)).toBe(text.length)
      expect(clusterEndAfter(p, k - 1, 4096)).toBe(Math.max(k, 4096))
      expect(sliceEdge(p, k, 0, text.length)).toBe(text.length)
      expect(sliceEdge(p, k, 4096, 8191)).toBe(k <= 4096 || k >= 8191 ? k : 8191)
    }
    expect(sliceEdge(p, 0, 0, text.length)).toBe(0)
    expect(sliceEdge(p, text.length, 0, text.length)).toBe(text.length)
  })

  test('the fixed cluster runs include ligatures supplied by the font declaration', () => {
    const input = paragraph('fi x')
    input.font = { ...input.font, facts: { ...UNKNOWN_FONT_FACTS, fonts: [{
      family: 'Mono', realizes: true, coverage: [0, 0x10ffff], spacingInputs: null, scriptLookups: null,
      ligatures: { complete: true, languageSystems: [], patterns: [{
        positions: [['f'], ['i']], exact: true, spaced: true, everyContext: true, acrossMark: true,
      }] },
    }] } }
    const p = prepare(input, env, false, createContextPool())
    expect(p.graphemeStarts[1]).toBe(1)
    expect(isClusterBoundary(p, 1)).toBe(false)
    expect(clusterStartAtOrBefore(p, 1, 0)).toBe(0)
    expect(clusterEndAfter(p, 0, p.text.length)).toBe(2)
    expect(sliceEdge(p, 1, 0, p.text.length)).toBe(2)
  })

  test('split fonts inside one long grapheme report the full original source range', () => {
    const input = paragraph('')
    input.content = Array.from({ length: 128 }, (_, i) => ({
      kind: 'span', font: { ...input.font, family: 'Face' + i }, letterSpacing: 0, wordSpacing: 0,
      whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', tabSize: 8,
      lang: 'en', inlineStart: { margin: 0, border: 0, padding: 0 }, inlineEnd: { margin: 0, border: 0, padding: 0 },
      verticalAlign: 'baseline', children: [{ kind: 'text', text: i === 0 ? 'a' : '\u0301' }],
    }))
    const p = prepare(input, env, true, createContextPool())
    const gaps = paragraphGaps(p).filter(g => g.gap === 'font-fallback' && g.detail === 'a shaping-group edge inside a grapheme cluster')
    expect(gaps.length).toBe(127)
    for (const gap of gaps) expect(gap.at).toEqual({ start: 0, end: 128 })
  })
})
