import { describe, expect, test } from 'bun:test'
import type { Case, FontDecl, InlineStructure, Paragraph } from '../types.ts'
import { atomic, br, el, leaf, paragraph, span, text, treeParagraph, wbr } from './build.ts'
import { canonicalJson, makeCase, mergeCases, validateCase } from './case.ts'
import { POLICY_GENERATORS } from './policy.ts'
import { RUN_GENERATORS } from './runs.ts'
import { WS_GENERATORS } from './ws.ts'

const arial: FontDecl = { family: 'Arial', size: 16, weight: 400, style: 'normal' }

function hello(overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    runs: [{ text: 'Hello world', node: 'text', font: arial, letterSpacing: 0, wordSpacing: 0, lang: null }],
    font: arial, letterSpacing: 0, wordSpacing: 0, width: 80, lineHeight: 20, whiteSpace: 'normal', wordBreak: 'normal',
    overflowWrap: 'break-word', lineBreak: 'auto', tabSize: 8, direction: 'ltr', lang: 'en', ...overrides,
  }
}

const golden = (paragraph: Paragraph, extra: Partial<Case> = {}): Case => makeCase({ family: 'test/golden', origin: 'test', pageLang: 'en', paragraph, ...extra })

describe('case ids', () => {
  test('are pinned for a fixed case', () => {
    // Changing this value changes every case id; bump ID_VERSION in case.ts deliberately if the content model changes.
    expect(golden(hello()).id).toBe('c-a2cd3acfc1c95395')
  })

  test('ignore key order', () => {
    const reordered = JSON.parse(JSON.stringify(hello()), (_key, value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse())
    }) as Paragraph
    expect(Object.keys(reordered)[0]).toBe('lang')
    expect(golden(reordered).id).toBe(golden(hello()).id)
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}')
  })

  test('ignore metadata: family, origin and browser scope', () => {
    const id = golden(hello()).id
    expect(makeCase({ family: 'other/family', origin: 'elsewhere', pageLang: 'en', paragraph: hello(), browsers: ['safari'] }).id).toBe(id)
  })

  test('change with anything the browser lays out', () => {
    const id = golden(hello()).id
    const variants: Case[] = [
      golden(hello({ width: 81 })),
      golden(hello({ lang: 'ja' })),
      golden(hello({ lineBreak: 'strict' })),
      golden(hello({ runs: [{ text: 'Hello  world', node: 'text', font: arial, letterSpacing: 0, wordSpacing: 0, lang: null }] })),
      golden(hello({ runs: [{ text: 'Hello world', node: 'span', font: arial, letterSpacing: 0, wordSpacing: 0, lang: null }] })),
      golden(hello({ runs: [{ text: 'Hello world', node: 'span', font: arial, letterSpacing: 0, wordSpacing: 0, lang: '' }] })),
      makeCase({ family: 'test/golden', origin: 'test', pageLang: 'ja', paragraph: hello() }),
      makeCase({ family: 'test/golden', origin: 'test', pageLang: 'en', paragraph: hello(), fontFixtures: ['Amiri'] }),
    ]
    const ids = new Set(variants.map(value => value.id))
    expect(ids.size).toBe(variants.length)
    expect(ids.has(id)).toBe(false)
  })

  test('treat -0 as 0', () => {
    expect(golden(hello({ letterSpacing: -0, runs: [{ text: 'Hello world', node: 'text', font: arial, letterSpacing: -0, wordSpacing: 0, lang: null }] })).id).toBe(golden(hello()).id)
  })
})

describe('makeCase and validateCase', () => {
  test('normalize browser scopes and fixture fonts', () => {
    expect(makeCase({ family: 'f', origin: 'o', pageLang: 'en', paragraph: hello(), browsers: ['firefox', 'chrome', 'firefox'] }).browsers).toEqual(['chrome', 'firefox'])
    expect(makeCase({ family: 'f', origin: 'o', pageLang: 'en', paragraph: hello(), browsers: ['safari', 'firefox', 'chrome'] }).browsers).toBeUndefined()
    expect(makeCase({ family: 'f', origin: 'o', pageLang: 'en', paragraph: hello(), fontFixtures: [] }).fontFixtures).toBeUndefined()
    expect(() => makeCase({ family: 'f', origin: 'o', pageLang: 'en', paragraph: hello(), browsers: [] })).toThrow()
    expect(() => makeCase({ family: 'f', origin: 'o', pageLang: 'en', paragraph: hello(), fontFixtures: ['Comic Sans'] })).toThrow()
  })

  test('reject inconsistent paragraphs', () => {
    const bold = { ...arial, weight: 700 }
    expect(() => golden(hello({ runs: [{ text: 'x', node: 'text', font: bold, letterSpacing: 0, wordSpacing: 0, lang: null }] }))).toThrow()
    expect(() => golden(hello({ runs: [{ text: 'x', node: 'text', font: arial, letterSpacing: 0, wordSpacing: 0, lang: 'en' }] }))).toThrow()
    expect(() => golden(hello({ runs: [
      { text: 'x', node: 'text', font: arial, letterSpacing: 0, wordSpacing: 0, lang: null },
      { text: 'y', node: 'text', font: arial, letterSpacing: 0, wordSpacing: 0, lang: null },
    ] }))).toThrow()
    expect(() => golden(hello({ runs: [] }))).toThrow()
    expect(() => golden(hello({ lineHeight: 0 }))).toThrow()
    expect(() => golden(hello({ font: { ...arial, family: '"Arial"' } }))).toThrow()
    expect(() => makeCase({ family: 'f', origin: 'o', pageLang: '', paragraph: hello() })).toThrow()
    const tampered = { ...golden(hello()), id: 'c-0000000000000000' }
    expect(() => validateCase(tampered)).toThrow()
  })

  test('mergeCases folds duplicates', () => {
    const merged = mergeCases([
      makeCase({ family: 'a', origin: 'first', pageLang: 'en', paragraph: hello(), browsers: ['chrome'] }),
      makeCase({ family: 'b', origin: 'second', pageLang: 'en', paragraph: hello(), browsers: ['safari'] }),
      makeCase({ family: 'a', origin: 'third', pageLang: 'en', paragraph: hello({ width: 90 }) }),
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ family: 'a', origin: 'first; second', browsers: ['chrome', 'safari'] })
  })
})

describe('cases with inline structure', () => {
  const withWidth = (tree: { paragraph: Paragraph; inline: InlineStructure }): { paragraph: Paragraph; inline: InlineStructure } => ({ paragraph: { ...tree.paragraph, width: 80 }, inline: tree.inline })
  const treeCase = (tree: { paragraph: Paragraph; inline: InlineStructure }): Case => makeCase({ family: 'test/tree', origin: 'test', pageLang: 'en', ...withWidth(tree) })

  test('a flat tree carries no structure and keeps the flat id', () => {
    const tree = treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20 }, [leaf('Hello '), el({}, leaf('world'))]))
    const flat = makeCase({ family: 'test/flat', origin: 'test', pageLang: 'en', paragraph: { ...paragraph({ font: arial, lang: 'en', lineHeight: 20 }, [text('Hello '), span('world', arial)]), width: 80 } })
    expect(tree.inline).toBeUndefined()
    expect(tree.id).toBe(flat.id)
  })

  test('structure enters the id, and runs list the leaves', () => {
    const edged = treeParagraph({ font: arial, lang: 'en', lineHeight: 20 }, [leaf('Hello '), el({ end: { padding: 4 }, lang: 'fr' }, leaf('wor'), el({ letterSpacing: 1 }, leaf('ld'))), br(), atomic(10, 12), wbr(), leaf('!')])
    const value = treeCase(edged)
    expect(value.inline).toBeDefined()
    validateCase(value)
    expect(value.paragraph.runs.map(run => [run.text, run.node, run.lang, run.letterSpacing])).toEqual([['Hello ', 'text', null, 0], ['wor', 'span', 'fr', 0], ['ld', 'span', 'fr', 1], ['!', 'text', null, 0]])
    const ids = new Set([
      value.id,
      treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20 }, [leaf('Hello '), el({ end: { padding: 5 }, lang: 'fr' }, leaf('wor'), el({ letterSpacing: 1 }, leaf('ld'))), br(), atomic(10, 12), wbr(), leaf('!')])).id,
      treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20, textIndent: 3 }, [leaf('Hello world')])).id,
      treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20, textAlign: 'center' }, [leaf('Hello world')])).id,
      treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20, lineSlots: [{ left: 10, right: 0 }] }, [leaf('Hello world')])).id,
    ])
    expect(ids.size).toBe(5)
    expect(mergeCases([value, value])).toHaveLength(1)
    expect(mergeCases([value])[0]!.inline).toEqual(value.inline)
  })

  test('reject inconsistent structure', () => {
    expect(() => treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20 }, [leaf('a'), atomic(10, 21)]))).toThrow()
    expect(() => treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20.5, lineSlots: [{ left: 10, right: 0 }] }, [leaf('a b')]))).toThrow()
    expect(() => treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20, lineSlots: [{ left: 10, right: 0 }, { left: 0, right: 0 }] }, [leaf('a b')]))).toThrow()
    expect(() => treeCase(treeParagraph({ font: arial, lang: 'en', lineHeight: 20 }, [leaf('a'), el({ start: { padding: -1 } }, leaf('b'))]))).toThrow()
    const tree = withWidth(treeParagraph({ font: arial, lang: 'en', lineHeight: 20 }, [leaf('a'), br(), leaf('b')]))
    expect(() => makeCase({ family: 'f', origin: 'o', pageLang: 'en', paragraph: { ...tree.paragraph, runs: [tree.paragraph.runs[0]!] }, inline: tree.inline })).toThrow()
  })
})

describe('generated families', () => {
  const generators = [...RUN_GENERATORS, ...WS_GENERATORS, ...POLICY_GENERATORS]
  for (const generator of generators) {
    test(`${generator.family} is reproducible and valid`, () => {
      const first = generator.generate('test-seed')
      const second = generator.generate('test-seed')
      expect(second.map(value => JSON.stringify(value))).toEqual(first.map(value => JSON.stringify(value)))
      expect(first.length).toBeGreaterThanOrEqual(150)
      expect(first.length).toBeLessThanOrEqual(700)
      for (const value of first) {
        validateCase(value)
        expect(value.family).toBe(generator.family)
        expect(value.pageLang).not.toBe('')
        for (const run of value.paragraph.runs) {
          // No run boundary may fall inside a surrogate pair.
          expect(run.text.isWellFormed()).toBe(true)
          expect(run.font.size).toBeLessThanOrEqual(value.paragraph.lineHeight)
        }
      }
      const other = generator.generate('other-seed').map(value => value.id)
      const overlap = other.filter(id => first.some(value => value.id === id)).length
      expect(overlap).toBeLessThan(first.length / 2)
    })
  }

  test('split-word includes splits inside grapheme clusters', () => {
    const cases = RUN_GENERATORS.find(generator => generator.family === 'runs/split-word')!.generate('test-seed')
    expect(cases.some(value => value.origin.includes('in-cluster'))).toBe(true)
  })
})
