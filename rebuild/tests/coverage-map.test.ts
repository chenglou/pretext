// The coverage map's reading of bun's lcov records (coverage-map.ts): what never ran, and nothing that only looks so.
import { describe, expect, test } from 'bun:test'
import { addLcov, engineMap, fileLines, neverRan, type Coverage } from './coverage-map.ts'

const FILE = 'rebuild/src/engines/webkit/sample.ts'
const SOURCE = [
  /*  1 */ 'export function placed(width: number, margin: number): number {',
  /*  2 */ '  let left = width',
  /*  3 */ '  // Do not let a negative margin make the content shorter.',
  /*  4 */ '  if (margin < 0) {',
  /*  5 */ '    left = left + margin',
  /*  6 */ '  }',
  /*  7 */ '  return left',
  /*  8 */ '}',
  /*  9 */ '',
  /* 10 */ 'export function tabStop(position: number): number {',
  /* 11 */ '  // Float32 sums in source order.',
  /* 12 */ '  return Math.fround(position + 8)',
  /* 13 */ '}',
  /* 14 */ '',
  /* 15 */ 'export const TABLE = [1, 2, 3]',
].join('\n')
const linesOf = (): ReturnType<typeof fileLines> => fileLines(FILE, SOURCE)
const record = (lines: Array<[number, number]>): string => `TN:\nSF:${FILE}\n${lines.map(([line, hits]) => `DA:${line},${hits}`).join('\n')}\nend_of_record\n`
// A shard that called placed() with margins of 0 or more: bun lists its lines with code, and all of tabStop()'s span.
const CALLED = record([[1, 9], [2, 9], [4, 9], [5, 0], [6, 3], [7, 9], [10, 1], [11, 0], [12, 0], [13, 0], [15, 1]])
// A shard that called neither function: both spans whole, comments too, and bun's stray count near the end of a function
// it only made.
const IDLE = record([[1, 1], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 4], [8, 0], [10, 1], [11, 0], [12, 0], [13, 0], [15, 1]])
// A shard with a negative margin.
const NEGATIVE = record([[1, 2], [2, 2], [4, 2], [5, 2], [6, 2], [7, 2], [10, 1], [11, 0], [12, 0], [13, 0], [15, 1]])

function mapOf(...shards: string[]): ReturnType<typeof neverRan> {
  const coverage: Coverage = new Map()
  for (const shard of shards) addLcov(coverage, shard, linesOf)
  return neverRan(coverage.get(FILE)!, linesOf())
}

describe('the coverage map', () => {
  test('a branch no shard took is listed by its lines with code, and a function no shard called by its body', () => {
    // bun counts the making of a function on its first line, so that line ran.
    expect(mapOf(CALLED, IDLE)).toEqual([
      { from: 5, to: 5, lines: 1, function: 'placed' },
      { from: 12, to: 12, lines: 1, function: 'tabStop' },
    ])
  })

  test('the comment lines bun lists for a function a shard never called never count', () => {
    // Line 3 (a comment) is measured by IDLE alone and run by nobody; line 8 (a closing brace) the same.
    expect(mapOf(IDLE, CALLED).map(range => range.from)).toEqual([5, 12])
    expect(mapOf(IDLE, CALLED, NEGATIVE).map(range => range.from)).toEqual([12])
  })

  test('a line that ran in any shard ran, in whatever order the shards come', () => {
    expect(mapOf(NEGATIVE, CALLED)).toEqual(mapOf(CALLED, NEGATIVE))
    expect(mapOf(NEGATIVE).map(range => `${range.from}-${range.to}`)).toEqual(['12-12'])
  })

  test('an engine\'s map holds its own folder and the shared files, not another engine\'s folder', () => {
    const coverage: Coverage = new Map()
    addLcov(coverage, CALLED, linesOf)
    const files = [FILE, 'rebuild/src/engines/blink/other.ts', 'rebuild/src/content.ts']
    const map = engineMap('webkit', coverage, file => (file === FILE ? SOURCE : 'export const x = 1\n'), linesOf, files)
    expect(Object.keys(map.files)).toEqual([FILE, 'rebuild/src/content.ts'])
    expect(map.files['rebuild/src/content.ts']).toEqual({ neverLoaded: true })
    expect(map.files[FILE]).toMatchObject({ neverRan: 2, ranges: [{ from: 5, source: 'left = left + margin' }, { from: 12, to: 12, function: 'tabStop' }] })
  })
})
