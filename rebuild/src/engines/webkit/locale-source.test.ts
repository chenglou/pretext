import { expect, test } from 'bun:test'
import { hasDelimiterDataOf, lineRulesOf, makeLocaleSource, primaryLanguageOf } from './locale-source.js'
import { lineRules } from './data.js'
import { makeFactory, computeFollowing } from './breaks.js'
import type { LineBreakMode } from './types.js'

test('one locale source supplies each demanded mode, language and delimiter settings once', () => {
  const name = 'ur-x-' + Array.from({ length: 128 }, () => 'abcd').join('-')
  const source = makeLocaleSource(name, 'en_US_POSIX')
  expect(source.rules).toEqual({})
  expect(source.language).toBeUndefined()
  expect(source.delimiterData).toBeUndefined()
  let nameReads = 0
  Object.defineProperty(source, 'name', { get: () => { nameReads++; return name } })
  const modes: LineBreakMode[] = ['Default', 'Loose', 'Normal', 'Strict']
  const settings = modes.map(mode => lineRulesOf(source, mode))
  for (let i = 0; i < 512; i++) {
    for (let m = 0; m < modes.length; m++) expect(lineRulesOf(source, modes[m]!)).toBe(settings[m]!)
    expect(primaryLanguageOf(source)).toBe('ur')
    expect(hasDelimiterDataOf(source)).toBe(true)
  }
  expect(nameReads).toBe(6)
  for (let m = 0; m < modes.length; m++) expect(settings[m]).toEqual(lineRules(name, modes[m]!, 'en_US_POSIX'))
})

test('empty and absent delimiter values are retained and standalone factory rules still agree', () => {
  for (const name of ['', 'xx', 'da', 'zh-Hant', 'ur']) {
    const source = makeLocaleSource(name, 'en_US_POSIX')
    const plain = makeFactory('“漢” กั', false, name, 'Strict', 'en_US_POSIX', { kind: 'unavailable' })
    const compiled = makeFactory('“漢” กั', false, name, 'Strict', 'en_US_POSIX', { kind: 'unavailable' }, source)
    expect(source.rules).toEqual({})
    expect(computeFollowing(compiled)).toEqual(computeFollowing(plain))
    const before = hasDelimiterDataOf(source)
    let reads = 0
    Object.defineProperty(source, 'name', { get: () => { reads++; return name } })
    for (let i = 0; i < 64; i++) expect(hasDelimiterDataOf(source)).toBe(before)
    expect(reads).toBe(0)
  }
})
