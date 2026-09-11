import { expect, test } from 'bun:test'
import { generateCases } from './cases.ts'
import { retainedBehaviors } from './fixtures/ordinary.ts'
import { corpusSources, corpusTexts } from './fixtures/corpora.ts'

const measure = (text: string): number => Array.from(text).length * 8
const full = generateCases(measure, { schedule: 'full', browser: 'chrome' })
const ordinary = generateCases(measure, { schedule: 'ordinary', browser: 'chrome' })

test('ordinary selection preserves every selected input and assertion from full', () => {
  const byId = new Map(full.map(input => [input.id, input]))
  expect(ordinary.every(input => JSON.stringify(input) === JSON.stringify(byId.get(input.id)))).toBe(true)
  for (const behavior of retainedBehaviors) {
    expect(ordinary.some(input => input.origins.includes(`behavior/${behavior.name}`))).toBe(true)
  }
  const exactFailures = [
    'wrap-5123bf2f598e26a1', 'wrap-d100ee2cf3c97c9a',
    'wrap-2b6f9266db70279a', 'wrap-6105332e62b94a66', 'wrap-823be6eee953932a', 'wrap-bda3c13d83daf4d9', 'wrap-d78e14de15388078',
    'wrap-0009f27388ac48cb', 'wrap-7b35ea2805898130', 'wrap-9e7f9fc3b16596fd', 'wrap-d99156a6195657d4',
  ]
  expect(exactFailures.every(id => ordinary.some(input => input.id === id))).toBe(true)
  for (let index = 0; index < 65; index++) {
    const character = String.fromCodePoint(index < 32 ? index : index + 95)
    expect(ordinary.some(input => input.text === `a\u00ADb${character}b` && input.font === '16px Arial' && input.width === 12)).toBe(true)
  }
})

test('family filtering preserves merged contracts and historical aliases', () => {
  const filtered = generateCases(measure, { schedule: 'ordinary', browser: 'chrome', family: 'issue/#208' })
  expect(filtered.length).toBe(6)
  for (const input of filtered) {
    expect(input.origins).toContain('policy-matrix/control')
    expect(input).toEqual(ordinary.find(row => row.id === input.id)!)
  }
})

test('ordinary includes complete maintained grids and the original oracle defaults', () => {
  expect(ordinary.filter(input => input.origins.some(origin => origin.startsWith('accuracy/')))).toHaveLength(7680)
  expect(ordinary.filter(input => input.origins.some(origin => origin.startsWith('corpora/')))).toHaveLength(1098)

  const hanging = ordinary.find(input => input.origins.includes('maintained/pre-wrap/hanging spaces'))!
  expect({ whiteSpace: hanging.whiteSpace, width: hanging.width, lang: hanging.lang, context: hanging.context, lineMethod: hanging.lineMethod, required: hanging.required })
    .toEqual({ whiteSpace: 'pre-wrap', width: 40, lang: 'en', context: { kind: 'installed', lang: 'en' }, lineMethod: 'span', required: ['height', 'lineCount'] })
  const keepAll = ordinary.find(input => input.origins.includes('maintained/keep-all/mixed latin plus cjk'))!
  expect(keepAll.wordBreak).toBe('keep-all')
  expect(keepAll.required).toContain('breaks')
  expect(keepAll.heightMode).toBe('exact')

  const corpus = ordinary.find(input => input.origins.includes('corpora/en-gatsby-opening'))!
  expect(corpus.text).toBe(corpusTexts['en-gatsby-opening']!)
  expect(corpus.nativeSource).toBe('normalized')
  expect(corpus.width).toBe((corpusSources.find(source => source.id === 'en-gatsby-opening')!.min_width ?? 300) - 80)
  expect(corpus.heightMode).toBe('corpus')
  expect(corpus.context).toEqual({ kind: 'installed', lang: 'en' })
  expect(ordinary.find(input => input.id === 'wrap-5123bf2f598e26a1')!.context).toBeUndefined()
})

test('boundary and rich reproductions are required while flat source-progress reports stay observed', () => {
  const exact = ordinary.filter(input => input.origins.some(origin => /^reported-reproduction\/#\d+$/.test(origin)))
  expect(exact.map(input => ({ text: input.text, font: input.font, width: input.width, lineHeight: input.lineHeight, whiteSpace: input.whiteSpace }))).toEqual([
    { text: '\u200B≤100nA\u200B', font: '12px Calibri, sans-serif', width: 25, lineHeight: 20.96, whiteSpace: 'pre-wrap' },
    { text: '\u200B', font: '12px Calibri, sans-serif', width: 25, lineHeight: 20.96, whiteSpace: 'pre-wrap' },
    { text: '-0.475', font: '16px Arial, sans-serif', width: 40.1, lineHeight: 20, whiteSpace: 'normal' },
    { text: '≥-100nA', font: '16px Arial, sans-serif', width: 48.1, lineHeight: 20, whiteSpace: 'normal' },
    { text: '(试验前-试验后)/试验前', font: '20px Arial', width: 32.1, lineHeight: 28, whiteSpace: 'pre-wrap' },
  ])
  for (const input of exact) {
    expect(input.context).toEqual({ kind: 'installed', lang: 'en' })
    if (input.origins.includes('reported-reproduction/#210')) {
      expect(input.required).toBeUndefined()
    } else {
      expect(input.required).toContain('height')
      expect(input.required).toContain('api')
    }
  }
  const rich = ordinary.filter(input => input.nativeItems === true)
  expect(rich).toHaveLength(14)
  expect(rich.every(input => input.parts?.join('') === input.text)).toBe(true)
  for (const input of rich) expect(input.required).toEqual(['richHeight'])
  expect(ordinary.filter(input => input.origins.includes('issue/#208')).every(input => input.required?.includes('source'))).toBe(true)
  expect(ordinary.some(input => input.text === '\u200B≤100nA\u200B' && input.font === '12px Arial' && input.width === 105)).toBe(true)
})
