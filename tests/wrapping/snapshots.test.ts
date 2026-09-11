import { expect, test } from 'bun:test'
import { createSnapshots } from './snapshots.ts'
import type { BrowserEnvironment } from './types.ts'

function environment(dpr = 2): BrowserEnvironment {
  const state = { dpr, visualViewportScale: 1, innerWidth: 1200, innerHeight: 800, outerWidth: 1200, outerHeight: 900,
    screenX: 0, screenY: 0, screenWidth: 2560, screenHeight: 1440, screenAvailWidth: 2560, screenAvailHeight: 1400,
    visibility: 'visible' as const, focused: true, language: 'en', direction: 'ltr' }
  return { context: { kind: 'fixtures' }, userAgent: 'test', dpr, locale: 'en', visibility: 'visible', focused: true, fonts: [],
    measurement: { userAgent: 'test', start: state, end: state, changes: [] } }
}

test('snapshot contexts cannot mix scales or ambiguous duplicate captures', () => {
  const snapshots = createSnapshots()
  snapshots.addEnvironment('chrome', 'ltr', environment())
  expect(() => snapshots.addEnvironment('chrome', 'rtl', environment(1))).toThrow('Incompatible chrome')
  expect(() => snapshots.addEnvironment('chrome', 'ltr', environment())).toThrow('Duplicate chrome')
  snapshots.addEnvironment('chrome', 'rtl', environment())
  snapshots.addEnvironment('safari', 'ltr', environment(1))
})

test('an invalid measurement interval cannot enter checked-in snapshots', () => {
  const changed = environment()
  changed.measurement.changes.push({ field: 'dpr', value: 1, evidence: 'snapshot' })
  expect(() => createSnapshots().addEnvironment('chrome', 'ltr', changed)).toThrow('Invalid chrome snapshot')
})
