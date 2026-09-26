// The bench's arithmetic and texts, offline. The test name says what a change's author would see if it went wrong.
import { describe, expect, test } from 'bun:test'
import { verdict } from './report.ts'
import { documents } from './run.ts'
import { familyText, MESSAGE_FAMILIES, units } from './texts.ts'

describe('the verdict', () => {
  test('a row is slower or faster only outside the band in every session: one noisy session would call a change', () => {
    expect(verdict([{ candidate: 1.2, control: 1.02 }, { candidate: 1.15, control: 0.99 }], 0.05)).toBe('slower')
    expect(verdict([{ candidate: 0.8, control: 1.02 }, { candidate: 0.85, control: 0.99 }], 0.05)).toBe('faster')
    expect(verdict([{ candidate: 1.2, control: 1.02 }, { candidate: 1.03, control: 0.99 }], 0.05)).toBe('within noise')
    expect(verdict([], 0)).toBe('within noise')
  })

  test('a session\'s band is the larger of its control\'s drift and the row\'s floor: a noisy document would call noise a change', () => {
    // The control drifted 12%: a 10% change in that session is noise.
    expect(verdict([{ candidate: 1.1, control: 1.12 }], 0.03)).toBe('within noise')
    expect(verdict([{ candidate: 1.1, control: 0.88 }], 0.03)).toBe('within noise')
    // A tight control leaves the row's floor.
    expect(verdict([{ candidate: 1.04, control: 1.0 }], 0.05)).toBe('within noise')
    expect(verdict([{ candidate: 1.06, control: 1.0 }], 0.05)).toBe('slower')
  })
})

describe('the texts', () => {
  const docs = documents(['new', 'fresh', 'rich'], 'bench-test', false)

  test('the rows that time new text never prepare a message twice: a warm cache would read as a faster library', () => {
    for (const family of MESSAGE_FAMILIES) {
      if (family === 'mixed') continue // its messages may end with an emoji the text doesn't hold
      const text = familyText(family)
      let at = 0
      for (const d of docs.filter(x => x.family === family || (x.row === 'rich' && family === 'latin'))) {
        const messages = d.fresh !== undefined ? d.fresh.batches.flat() : d.ops.filter(op => op.batches !== undefined).flatMap(op => op.batches!.flat().map(m => (typeof m === 'string' ? m : (m as Array<{ text: string }>).map(item => item.text).join(''))))
        for (const m of messages) {
          const found = text.indexOf(m, at)
          expect(found).toBeGreaterThanOrEqual(at)
          at = found + m.length
        }
      }
    }
  })

  test('each family\'s new batches hold the same units: a longer batch would read as a slower library', () => {
    for (const d of docs) {
      const sizes = d.fresh !== undefined ? d.fresh.batches.map(units) : d.ops[0]!.batchUnits!
      // One unit more where a cut would split a surrogate pair.
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
      if (d.row === 'new' && d.family !== 'labels') expect(Math.min(...sizes)).toBeGreaterThan(200)
    }
  })
})
