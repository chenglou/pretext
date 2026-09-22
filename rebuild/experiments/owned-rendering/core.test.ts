import { expect, test } from 'bun:test'
import { count, layout, prepare, stripBidiControls, type OwnedItem } from './core.js'
const text = (value: string, font = '17px Arial'): OwnedItem => ({ kind: 'text', text: value, font })
const measure = (value: string) => [...stripBidiControls(value)].length * 10

test('chosen lines and counts use the same numeric walk without further measurements', () => {
  let calls = 0
  const p = prepare([text('AV fi one two three')], {}, value => { calls++; return measure(value) })
  const preparedCalls = calls
  for (const width of [0, 20, 40, 65, 100, 400]) {
    const lines = layout(p, width)
    expect(count(p, width)).toBe(lines.length)
    expect(lines.flatMap(l => l.fragments).map(f => f.text).join('').replaceAll(' ', '')).toBe('AVfionetwothree')
    for (const line of lines) {
      expect(line.fragments.reduce((sum, f) => sum + f.width, 0)).toBeCloseTo(line.width)
      for (let i = 1; i < line.fragments.length; i++) expect(line.fragments[i]!.x).toBeCloseTo(line.fragments[i - 1]!.x + line.fragments[i - 1]!.width)
    }
  }
  expect(calls).toBe(preparedCalls)
})
test('item edges isolate AV but do not create arbitrary wrap opportunities', () => {
  const p = prepare([text('A'), text('V')], {}, measure)
  expect(p.units.map(u => u.text)).toEqual(['A', 'V'])
  expect(count(p, 10)).toBe(1)
  expect(layout(p, 10)[0]!.width).toBe(20)
})
test('invalid grapheme boundaries reject before normalization', () => {
  expect(() => prepare([text('e'), text('\u0301')], {}, measure)).toThrow('grapheme')
  expect(() => prepare([text('👩\u200d'), text('💻')], {}, measure)).toThrow('grapheme')
})
test('grapheme-safe complex words need stronger item boundaries', () => {
  expect(() => prepare([text('ကျေ'), text('ာ်')], {}, measure)).toThrow('contextual')
  expect(() => prepare([text('س'), text('لام')], {}, measure)).toThrow('contextual')
  expect(() => prepare([text('سلام '), text('عالم')], {}, measure)).not.toThrow()
})
test('whole complex words overflow instead of silently changing shaping', () => {
  const p = prepare([text('سلام عالم')], { direction: 'rtl' }, measure)
  const lines = layout(p, 10)
  expect(lines.length).toBe(2)
  expect(lines.map(l => l.fragments.map(f => f.text).join(''))).toEqual(['سلام', 'عالم'])
})
test('mixed direction keeps whole graphemes and every visible source range', () => {
  const p = prepare([text('שלום (123) hello العربية')], { direction: 'rtl' }, measure)
  for (const width of [40, 100, 500]) {
    const fragments = layout(p, width).flatMap(l => l.fragments).sort((a, b) => a.start - b.start)
    expect(fragments.map(f => f.text).join('').replaceAll(' ', '')).toBe('שלום(123)helloالعربية')
    for (const f of fragments) { expect(p.boundaries).toContain(f.start); expect(p.boundaries).toContain(f.end) }
  }
})
test('whitespace normalizes once and retains the first space owner', () => {
  const p = prepare([text('one  '), text('\t two\nthree')], {}, measure)
  expect(p.text).toBe('one two three')
  expect(p.units.find(u => u.space)!.itemIndex).toBe(0)
})
test('fractional advances are summed before final positions', () => {
  const p = prepare([text('A'), text('V')], {}, () => 1 / 3)
  const line = layout(p, 1)[0]!
  expect(line.width).toBe(2 / 3)
  expect(line.fragments[1]!.x).toBe(1 / 3)
})
test('atomic mixed-direction text is one object with its own internal paragraph', () => {
  const p = prepare([text('שלום '), { kind: 'text', text: 'AV العربية (123)', font: '17px Arial', atomic: true, extraWidth: 12 }, text(' סוף')], { direction: 'rtl' }, measure)
  const lines = layout(p, 500)
  expect(lines[0]!.fragments.filter(f => f.itemIndex === 1).map(f => f.text)).toEqual(['AV العربية (123)'])
  expect(lines[0]!.fragments.find(f => f.itemIndex === 1)!.width).toBe(measure('AV العربية (123)') + 12)
})
