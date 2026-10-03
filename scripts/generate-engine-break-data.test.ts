// The module the library ships against the engine files: importing the generator reads scripts/engine-data/ and runs
// its own checks without writing, and the library unpacks src/generated/engine-break-data.ts.
import '../harness/watchdog.ts'
import { expect, test } from 'bun:test'
import type { ClassMap, RuleTable } from '../src/generated/engine-break-data.ts'
import { getBreakRules, getClass, unpackClasses, unpackClassRuns } from '../src/line-breaks.ts'
import { engineClassMaps, engineRuleTables } from './generate-engine-break-data.ts'

test('every code point has its engine\'s class in every class map', () => {
  const maps = Object.keys(engineClassMaps) as ClassMap[]
  expect(maps.length).toBe(9)
  for (let m = 0; m < maps.length; m++) {
    const classes = engineClassMaps[maps[m]!]!
    const table = unpackClasses(maps[m]!)
    const differing: number[] = []
    for (let c = 0; c < 0x110000; c++) if (getClass(table, c) !== classes[c]) differing.push(c)
    expect({ map: maps[m], differing }).toEqual({ map: maps[m], differing: [] })
  }
})

test('every rule table has its engine\'s sizes and state rows', () => {
  const tables = Object.keys(engineRuleTables) as RuleTable[]
  expect(tables.length).toBe(7)
  for (let t = 0; t < tables.length; t++) {
    const compiled = engineRuleTables[tables[t]!]!
    const rules = getBreakRules(tables[t]!)
    expect([tables[t], rules.catCount, rules.dictCategoriesStart, rules.lookAheadResultsSize, rules.rowWidth, rules.rows.length])
      .toEqual([tables[t]!, compiled.catCount, compiled.dictCategoriesStart, compiled.lookAheadResultsSize, compiled.rowWidth, compiled.rows.length])
    const differing: number[] = []
    for (let i = 0; i < compiled.rows.length; i++) if (rules.rows[i] !== compiled.rows[i]) differing.push(i)
    expect({ table: tables[t], differing }).toEqual({ table: tables[t], differing: [] })
  }
})

test('a run list that doesn\'t end at U+10FFFF throws, an empty one included', () => {
  const remap = new Uint8Array(1)
  expect(() => unpackClassRuns(new Int32Array(0), remap, 1)).toThrow()
  expect(() => unpackClassRuns(Int32Array.of(0x10fffe, 0), remap, 1)).toThrow()
  expect(getClass(unpackClassRuns(Int32Array.of(0x10ffff, 0), remap, 1), 0x10ffff)).toBe(0)
})
