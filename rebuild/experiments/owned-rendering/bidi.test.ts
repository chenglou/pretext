import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { webkitGraphemeRules } from '../../src/engines/webkit/data.js'
import { graphemeBoundaries } from '../../src/unicode/grapheme.js'
import type { ParagraphDirection } from '../../src/unicode/bidi.js'
import { prepareBidi, visualRuns, type BidiRun } from './bidi.js'

// Independent native oracle for the part being prototyped: ICU resolves the
// entire input, creates each requested line with ubidi_setLine, then returns its
// visual index map. This also catches line-end L1 and lost paragraph context.
// Materialize line levels first: ICU getRuns otherwise ORs the old odd bit onto
// its trailing-whitespace run and cannot clear it for an LTR paragraph. We own
// line-end behavior here and deliberately apply L1 rather than inherit that bug.
// The tests compare offsets, not DOM glyph order: UAX #9 L3/actual shaping remains
// the painter's responsibility. No browser is launched here.
const ORACLE = String.raw`
#include <stdio.h>
#include <stdlib.h>
#include <unicode/ubidi.h>
static char input[1 << 20];
static UChar text[1 << 17];
static int32_t map[1 << 17];
int main(void) {
  UBiDi *para = ubidi_open(), *line = ubidi_open();
  while (fgets(input, sizeof input, stdin)) {
    char *p = input;
    long direction = strtol(p, &p, 10); p++;
    int32_t start = (int32_t)strtol(p, &p, 10); p++;
    int32_t end = (int32_t)strtol(p, &p, 10); p++;
    int32_t length = 0;
    while (*p && *p != '\n') {
      text[length++] = (UChar)strtol(p, &p, 16);
      while (*p == ' ') p++;
    }
    UErrorCode e = U_ZERO_ERROR;
    ubidi_setPara(para, text, length, (UBiDiLevel)direction, NULL, &e);
    ubidi_setLine(para, start, end, line, &e);
    /* Materialize line-end L1 before getRuns builds its direction flags. */
    ubidi_getLevels(line, &e);
    ubidi_getVisualMap(line, map, &e);
    if (U_FAILURE(e)) {
      fprintf(stderr, "%s\n", u_errorName(e));
      return 1;
    }
    for (int32_t i = 0; i < end - start; i++) {
      printf(i ? " %d" : "%d", map[i] + start);
    }
    printf("\n");
  }
  ubidi_close(line);
  ubidi_close(para);
  return 0;
}
`
let oracle: string
beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'owned-bidi-oracle-'))
  oracle = join(directory, 'oracle')
  const build = Bun.spawnSync([
    'clang', '-std=c11', '-O2', '-Wall', '-x', 'c', '-',
    '-I/opt/homebrew/opt/icu4c@78/include', '-L/opt/homebrew/opt/icu4c@78/lib',
    '-licuuc', '-licudata', '-o', oracle,
  ], { stdin: Buffer.from(ORACLE) })
  if (build.exitCode !== 0) throw new Error(build.stderr.toString())
})

type LineCase = { text: string; direction: ParagraphDirection; start: number; end: number }

// Expands runs only in tests, for comparison with ICU's code-unit index map.
// Production painting does not reverse strings.
function indexes(runs: readonly BidiRun[]): number[] {
  const out: number[] = []
  for (const run of runs) {
    if (run.direction === 'ltr') {
      for (let i = run.start; i < run.end; i++) out.push(i)
    } else {
      for (let i = run.end - 1; i >= run.start; i--) out.push(i)
    }
  }
  return out
}

function compareNative(cases: readonly LineCase[]): void {
  const input: string[] = []
  const actual: number[][] = []
  for (const c of cases) {
    const units: string[] = []
    for (let i = 0; i < c.text.length; i++) units.push(c.text.charCodeAt(i).toString(16))
    input.push(`${c.direction === 'auto' ? 254 : c.direction === 'rtl' ? 1 : 0};${c.start};${c.end};${units.join(' ')}`)
    actual.push(indexes(visualRuns(prepareBidi(c.text, c.direction), c.start, c.end)))
  }
  const result = Bun.spawnSync([oracle], { stdin: Buffer.from(input.join('\n') + '\n') })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  const lines = result.stdout.toString().trimEnd().split('\n')
  expect(lines.length).toBe(cases.length)
  const failures: { c: LineCase; expected: number[]; actual: number[] }[] = []
  for (let i = 0; i < cases.length; i++) {
    const expected = lines[i]!.split(' ').map(Number)
    if (JSON.stringify(actual[i]) !== JSON.stringify(expected) && failures.length < 10) {
      failures.push({ c: cases[i]!, expected, actual: actual[i]! })
    }
  }
  expect(failures).toEqual([])
}

// Recorded Unicode examples, copied without deriving expected order from our
// helper: ICU's BidiCharacterTest-6.3.0.txt, "Examples from Section 3.3.5",
// followed by its Arabic/European digit cases. This set intentionally avoids
// the known ICU-versus-UAX paragraph-resolver disagreements already tested by
// src/unicode/ubidi.test.ts.
const FIXTURES = [
  '05D0 05D1 0028 05D2 05D3 005B 0026 0065 0066 005D 002E 0029 0067 0068;0;0;1 1 0 1 1 0 0 0 0 0 0 0 0 0;1 0 2 4 3 5 6 7 8 9 10 11 12 13',
  '05D0 05D1 0028 05D2 05D3 005B 0026 0065 0066 005D 002E 0029 0067 0068;1;1;1 1 1 1 1 1 1 2 2 1 1 1 2 2;12 13 11 10 9 7 8 6 5 4 3 2 1 0',
  '0061 0062 0063 0020 0028 0064 0065 0066 0020 0627 0628 062C 0029 0020 05D0 05D1 05D2;0;0;0 0 0 0 0 0 0 0 0 1 1 1 0 0 1 1 1;0 1 2 3 4 5 6 7 8 11 10 9 12 13 16 15 14',
  '0061 0062 0063 0020 0028 0064 0065 0066 0020 0627 0628 062C 0029 0020 05D0 05D1 05D2;1;1;2 2 2 1 1 2 2 2 1 1 1 1 1 1 1 1 1;16 15 14 13 12 11 10 9 8 5 6 7 4 3 0 1 2',
  '05D0 05D1 05D2 0020 0028 0064 0065 0066 0020 0627 0628 062C 0029 0020 0061 0062 0063;0;0;1 1 1 0 0 0 0 0 0 1 1 1 0 0 0 0 0;2 1 0 3 4 5 6 7 8 11 10 9 12 13 14 15 16',
  '05D0 05D1 05D2 0020 0028 0064 0065 0066 0020 0627 0628 062C 0029 0020 0061 0062 0063;1;1;1 1 1 1 1 2 2 2 1 1 1 1 1 1 2 2 2;14 15 16 13 12 11 10 9 8 5 6 7 4 3 2 1 0',
  '0061 0062 0063 0020 0028 0627 0628 062C 0020 0064 0065 0066 0029 0020 05D0 05D1 05D2;0;0;0 0 0 0 0 1 1 1 0 0 0 0 0 0 1 1 1;0 1 2 3 4 7 6 5 8 9 10 11 12 13 16 15 14',
  '0061 0062 0063 0020 0028 0627 0628 062C 0020 0064 0065 0066 0029 0020 05D0 05D1 05D2;1;1;2 2 2 1 1 1 1 1 1 2 2 2 1 1 1 1 1;16 15 14 13 12 9 10 11 8 7 6 5 4 3 0 1 2',
  '05D0 05D1 05D2 0020 0028 0627 0628 062C 0020 0064 0065 0066 0029 0020 0061 0062 0063;0;0;1 1 1 0 0 1 1 1 0 0 0 0 0 0 0 0 0;2 1 0 3 4 7 6 5 8 9 10 11 12 13 14 15 16',
  '05D0 05D1 05D2 0020 0028 0627 0628 062C 0020 0064 0065 0066 0029 0020 0061 0062 0063;1;1;1 1 1 1 1 1 1 1 1 2 2 2 1 1 2 2 2;14 15 16 13 12 9 10 11 8 7 6 5 4 3 2 1 0',
  '0627 0628 062C 0020 0062 006F 006F 006B 0028 0073 0029;0;0;1 1 1 0 0 0 0 0 0 0 0;2 1 0 3 4 5 6 7 8 9 10',
  '0627 0628 062C 0020 0062 006F 006F 006B 0028 0073 0029;1;1;1 1 1 1 2 2 2 2 2 2 2;4 5 6 7 8 9 10 3 2 1 0',
  '062A 0031 002F 0032;2;1;1 2 2 2;1 2 3 0',
  '062A 0031 002F 0032;0;0;1 2 2 2;1 2 3 0',
  '062A 0031 002F 0032;1;1;1 2 2 2;1 2 3 0',
  '05D0 0020 0031 002D 0032;0;0;1 1 2 2 2;2 3 4 1 0',
]

describe('shared owned-rendering bidi', () => {
  test('recorded Unicode visual orders, levels and base directions', () => {
    for (const fixture of FIXTURES) {
      const fields = fixture.split(';')
      const text = String.fromCodePoint(...fields[0]!.split(' ').map(h => parseInt(h, 16)))
      const direction = fields[1] === '0' ? 'ltr' : fields[1] === '1' ? 'rtl' : 'auto'
      const p = prepareBidi(text, direction)
      expect(p.baseLevel).toBe(Number(fields[2]))
      expect(Array.from(p.levels)).toEqual(fields[3]!.split(' ').map(Number))
      expect(indexes(visualRuns(p, 0, text.length))).toEqual(fields[4]!.split(' ').map(Number))
    }
  })

  test('line-end L1 resets whitespace while preserving the paragraph levels', () => {
    const p = prepareBidi('a אב   גד', 'ltr')
    const original = Uint8Array.from(p.levels)
    expect(visualRuns(p, 0, 7)).toEqual([
      { start: 0, end: 2, level: 0, direction: 'ltr' },
      { start: 2, end: 4, level: 1, direction: 'rtl' },
      { start: 4, end: 7, level: 0, direction: 'ltr' },
    ])
    expect(p.levels).toEqual(original)
    const rtl = prepareBidi('אב abc   def', 'rtl')
    expect(visualRuns(rtl, 0, 9)).toEqual([
      { start: 6, end: 9, level: 1, direction: 'rtl' },
      { start: 3, end: 6, level: 2, direction: 'ltr' },
      { start: 0, end: 3, level: 1, direction: 'rtl' },
    ])
  })

  test('auto-direction ignores isolate contents and resolves each paragraph', () => {
    expect(prepareBidi('\u2067אב\u2069 abc').baseLevel).toBe(0)
    const p = prepareBidi('abc\nאב  \n123')
    expect(p.paragraphs).toEqual([
      { start: 0, end: 4, level: 0 },
      { start: 4, end: 9, level: 1 },
      { start: 9, end: 12, level: 0 },
    ])
    expect(() => visualRuns(p, 0, 5)).toThrow('paragraph boundary')
    expect(visualRuns(p, 4, 9).every(r => r.direction === 'rtl')).toBe(true)
  })

  test('native line oracle: isolates, embeddings, numbers, controls and separators', () => {
    const texts = [
      'abc אבג (123) xyz',
      'אבג 12,345.6 / abc',
      'a \u2067אב xyz גד\u2069 z',
      '\u202eabc (123)\u202c xyz',
      'a\u202bאב\u202a12\u202cגד\u202c z',
      'a אב\tגד',
      'אב \u200e 12\u200f abc\u061c',
      'a\nאב \r\nx\u2029גד',
      'א\u2066x [12]\u2069(ב)',
      'א😀\u{1d6c1}ב',
      'a(b)\u0301 אב',
      'a ب\u200d',
    ]
    const cases: LineCase[] = []
    for (const text of texts) {
      for (const direction of ['ltr', 'rtl', 'auto'] as const) {
        const p = prepareBidi(text, direction)
        for (const paragraph of p.paragraphs) {
          cases.push({ text, direction, start: paragraph.start, end: paragraph.end })
          const positions = [paragraph.start]
          for (let i = paragraph.start; i < paragraph.end;) {
            i += text.codePointAt(i)! > 0xffff ? 2 : 1
            positions.push(i)
          }
          // Different widths can expose a line inside an open isolate/embedding.
          for (let i = 1; i < positions.length; i++) {
            cases.push({ text, direction, start: paragraph.start, end: positions[i]! })
            cases.push({ text, direction, start: positions[i - 1]!, end: paragraph.end })
          }
        }
      }
    }
    compareNative(cases)
  })

  test('native line oracle: seeded varied-class text and arbitrary code-point line edges', () => {
    const pool = [
      'A', 'b', 'א', 'ב', 'ب', 'ت', '(', ')', '[', ']', '.', '-', '1', '2',
      '١', '۲', ' ', '\t', '\u00a0', '\u200a', '\u202a', '\u202b', '\u202d',
      '\u202e', '\u202c', '\u2066', '\u2067', '\u2068', '\u2069', '\u0301',
      '\u200d', '\u200c', '😀', '\u{1d6c1}', '\u061c', '\u200e', '\u200f',
    ]
    let seed = 0x71b1d19
    const random = (limit: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % limit
    }
    const cases: LineCase[] = []
    for (let trial = 0; trial < 1000; trial++) {
      let text = ''
      const offsets = [0]
      const length = 1 + random(48)
      for (let i = 0; i < length; i++) {
        text += pool[random(pool.length)]!
        offsets.push(text.length)
      }
      for (const direction of ['ltr', 'rtl', 'auto'] as const) {
        cases.push({ text, direction, start: 0, end: text.length })
        const a = random(length)
        const b = a + 1 + random(length - a)
        cases.push({ text, direction, start: offsets[a]!, end: offsets[b]! })
      }
    }
    compareNative(cases)
  })

  test('keeps a bracket and its combining mark together despite ICU’s known quirk', () => {
    const text = 'a(b)\u0301'
    const boundaries = graphemeBoundaries(text, webkitGraphemeRules)
    const p = prepareBidi(text, 'rtl', boundaries)
    expect(Array.from(p.originalLevels)).toEqual([2, 2, 2, 2, 1])
    expect(Array.from(p.levels)).toEqual([2, 2, 2, 2, 2])
    expect(visualRuns(p, 0, text.length)).toEqual([
      { start: 0, end: 5, level: 2, direction: 'ltr' },
    ])
    expect(() => visualRuns(p, 0, 4)).toThrow('split a grapheme')
  })

  test('keeps joining controls and emoji sequences inside their graphemes', () => {
    for (const text of ['a ب\u200d', 'א👨‍👩‍👧‍👦x', 'a e\u0301 אב']) {
      const boundaries = graphemeBoundaries(text, webkitGraphemeRules)
      const p = prepareBidi(text, 'ltr', boundaries)
      for (const run of visualRuns(p, 0, text.length)) {
        expect(boundaries.includes(run.start)).toBe(true)
        expect(boundaries.includes(run.end)).toBe(true)
      }
    }
    const p = prepareBidi('a ب\u200d', 'ltr', [0, 1, 2, 4])
    expect(visualRuns(p, 0, 4)).toEqual([
      { start: 0, end: 2, level: 0, direction: 'ltr' },
      { start: 2, end: 4, level: 1, direction: 'rtl' },
    ])
  })

  test('rejects invalid ranges and code-point/grapheme splits; handles empty lines', () => {
    expect(prepareBidi('', 'rtl').baseLevel).toBe(1)
    expect(visualRuns(prepareBidi(''), 0, 0)).toEqual([])
    const p = prepareBidi('a😀b')
    expect(() => visualRuns(p, -1, 2)).toThrow('Invalid bidi line range')
    expect(() => visualRuns(p, 3, 2)).toThrow('Invalid bidi line range')
    expect(() => visualRuns(p, 0, 2)).toThrow('split a code point')
    expect(visualRuns(p, 1, 1)).toEqual([])
    expect(() => prepareBidi('😀', 'auto', [0, 1, 2])).toThrow('Invalid grapheme boundary')
    expect(() => prepareBidi('abc', 'auto', [0, 2])).toThrow('cover the full text')
  })
})
