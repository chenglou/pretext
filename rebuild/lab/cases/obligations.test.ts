import { describe, expect, test } from 'bun:test'
import { labRequirement, ObligationImport, obligationGroup } from './obligations.ts'
import { SuiteImport } from './suite.ts'

const base = {
  id: 'wrap-0000000000000001', family: 'pre-wrap', scope: 'supported', origins: ['maintained/pre-wrap/hanging spaces'], text: 'foo   bar',
  font: '18px serif', width: 40, lineHeight: 32, whiteSpace: 'pre-wrap', wordBreak: 'normal', letterSpacing: 0, direction: 'ltr',
  context: { kind: 'installed', lang: 'en' }, lang: 'en', browsers: ['chrome', 'safari'], required: ['height', 'lineCount'],
}

describe('obligationGroup', () => {
  test('follows main origins for genuine obligations', () => {
    expect(obligationGroup(['accuracy/Latin update'])).toEqual({ group: 'accuracy', label: 'accuracy/Latin update', canary: false })
    expect(obligationGroup(['maintained/keep-all/mixed latin plus cjk'])?.group).toBe('keep-all')
    expect(obligationGroup(['issue/#210-#211', 'reported-reproduction/#210-rich'])?.group).toBe('reported/#210-rich')
    expect(obligationGroup(['policy-matrix/control', 'issue/#208'])?.group).toBe('reported/#208')
    expect(obligationGroup(['observer-controls/quote-marker'])?.group).toBe('safari-paint')
    expect(obligationGroup(['emergency-graphemes'])?.group).toBe('emergency-graphemes')
    expect(obligationGroup(['corpora/en-gatsby-opening'])).toEqual({ group: 'corpus', label: 'corpora/en-gatsby-opening', canary: true })
  })

  test("leaves main's pins and research observations to the ordinary suite", () => {
    for (const origins of [
      ['maintained/entry-geometry'], ['maintained/standalone-zwsp'], ['maintained/space-kerning/control-in-another-paragraph'],
      ['maintained/space-after-overflow'], ['issue/#210-#211', 'rich-admission/exact-fit'], ['observer-controls'],
      ['maintained/kinsoku-units/cluster/stop'], ['focused-20260905/admission-probe/source-origin-v2-detail-chrome.json'],
    ]) expect(obligationGroup(origins)).toBeNull()
  })
})

describe('labRequirement', () => {
  const none = { expectedText: false, emergencyGraphemes: false }
  test('maps main metrics onto the lab metrics of each variant', () => {
    expect(labRequirement({ ...none, required: ['height', 'lineCount', 'source', 'api'] }, 'text')).toEqual(['lineCount', 'breaks'])
    expect(labRequirement({ ...none, required: ['height', 'lineCount', 'widths', 'hyphen'] }, 'text')).toEqual(['lineCount', 'breaks', 'widths'])
    expect(labRequirement({ ...none, required: ['richHeight'] }, 'text')).toEqual([])
    expect(labRequirement({ ...none, required: ['richHeight', 'height'] }, 'items')).toEqual(['lineCount'])
    expect(labRequirement({ ...none, required: ['api'] }, 'text')).toEqual([])
    expect(labRequirement({ required: ['height', 'api'], expectedText: true, emergencyGraphemes: false }, 'text')).toEqual(['lineCount', 'breaks'])
    expect(labRequirement({ required: [], expectedText: false, emergencyGraphemes: true }, 'text')).toEqual(['lineCount', 'breaks'])
    expect(() => labRequirement({ ...none, required: ['height', 'shape'] }, 'text')).toThrow('Unknown main metric')
  })
})

describe('ObligationImport', () => {
  test("keeps the suite import's case id, and requires metrics only in browsers whose rows carried the input", () => {
    const obligations = new ObligationImport()
    obligations.add(base, 'chrome')
    obligations.add(base, 'safari')
    obligations.add({ ...base, browsers: ['safari'] }, 'firefox')
    const suite = new SuiteImport()
    suite.add(base)
    const [value, ...rest] = obligations.cases()
    expect(rest).toEqual([])
    expect(value!.id).toBe(suite.entries()[0]!.id)
    expect(value!.family).toBe('obligations/pre-wrap')
    expect(value!.browsers).toEqual(['chrome', 'safari'])
    expect(value!.paragraph).toEqual(suite.materialize(value!.id).paragraph)
    expect(value!.origin).toBe('main tests/wrapping maintained/pre-wrap/hanging spaces (wrap-0000000000000001); main requires height,lineCount; lab requires chrome:lineCount safari:lineCount')
    expect(obligations.table()).toEqual({
      groups: { 'pre-wrap': { cases: 1, requiredPairs: { chrome: 1, safari: 1 } } },
      required: { [value!.id]: { chrome: ['lineCount'], safari: ['lineCount'] } },
    })
  })

  test('a rich witness becomes only its span-per-part case', () => {
    const obligations = new ObligationImport()
    obligations.add({
      ...base, family: 'reported/#210-#211', origins: ['issue/#210-#211', 'reported-reproduction/#210-rich'], text: '​hello', parts: ['​', 'hello'],
      nativeItems: true, font: '16px Arial', whiteSpace: 'normal', browsers: undefined, required: ['richHeight'],
    }, 'firefox')
    const cases = obligations.cases()
    expect(cases).toHaveLength(1)
    expect(cases[0]!.paragraph.runs.map(run => [run.node, run.text])).toEqual([['span', '​'], ['span', 'hello']])
    expect(cases[0]!.browsers).toEqual(['firefox'])
    expect(cases[0]!.origin).toContain('(span per part)')
  })

  test('inputs without a lab metric add nothing, and corpora are canaries that require nothing', () => {
    const obligations = new ObligationImport()
    obligations.add({ ...base, required: ['api'] }, 'chrome')
    obligations.add({ ...base, origins: ['maintained/entry-geometry'] }, 'chrome')
    expect(obligations.cases()).toEqual([])
    obligations.add({ ...base, origins: ['corpora/en-gatsby-opening'], required: undefined, browsers: undefined, whiteSpace: 'normal' }, 'safari')
    const [canary] = obligations.cases()
    expect(canary!.family).toBe('obligations/corpus')
    expect(canary!.browsers).toEqual(['safari'])
    expect(canary!.origin.endsWith('lab requires nothing (canary)')).toBe(true)
    expect(obligations.table().required).toEqual({})
  })
})
