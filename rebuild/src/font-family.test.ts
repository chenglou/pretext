// The one parser of a font-family list (font-family.ts), on the lists the four parsers it replaced read four ways: the font
// checks' (quote-aware, no hex escapes), Blink's (the text before the first comma), WebKit's (split at every comma, one
// quote stripped at each end) and Gecko's (the scan kept here). Each test says what the old parsers did. What the engines
// do with the names is theirs: the last tests read each port's classification of the same lists.
// rebuild/probes/font-family-syntax.ts asks the browsers' own CSS parsers about the same lists.
import { describe, expect, test } from 'bun:test'
import { parseFamilyList } from './engines/gecko/fonts.ts'
import { familyNames } from './engines/webkit/fonts.ts'
import { listedFamilies } from './font-family.ts'

const NBSP = String.fromCharCode(0xa0)
const names = (list: string): Array<[string, boolean]> => listedFamilies(list).map(family => [family.name, family.quoted])

describe('a font-family list as CSS syntax', () => {
  test('the lists the recorded cases hold read as every old parser read them', () => {
    expect(listedFamilies('"Helvetica Neue", Helvetica, Arial, sans-serif')).toEqual([
      { quoted: true, name: 'Helvetica Neue', css: '"Helvetica Neue"' },
      { quoted: false, name: 'Helvetica', css: 'Helvetica', identifiers: ['Helvetica'] },
      { quoted: false, name: 'Arial', css: 'Arial', identifiers: ['Arial'] },
      { quoted: false, name: 'sans-serif', css: 'sans-serif', identifiers: ['sans-serif'] },
    ])
    expect(names('Times New Roman')).toEqual([['Times New Roman', false]])
    expect(names('-apple-system')).toEqual([['-apple-system', false]])
  })

  // Old: the font checks and Gecko kept the name whole. Blink took `"Probe` as the first family, unquoted. WebKit made two
  // unquoted families, `probe` and `comma"`, and gave Canvas the list joined again with ', ', so `'Probe,Comma'` became another
  // family name.
  test('a comma inside a string stays in the name', () => {
    expect(names('"Probe, Comma", monospace')).toEqual([['Probe, Comma', true], ['monospace', false]])
    expect(listedFamilies("'Probe,Comma' , monospace")[0]).toEqual({ quoted: true, name: 'Probe,Comma', css: "'Probe,Comma'" })
  })

  // Old: Gecko alone resolved escapes. The font checks dropped the backslash and kept the hex digits (`m6fnospace`), and
  // kept an unquoted name's escapes as written; Blink and WebKit kept them as written everywhere, so an escaped keyword
  // wasn't the keyword to them.
  test('escapes are resolved before a name is read, in strings and in identifiers', () => {
    expect(names('m\\6fnospace')).toEqual([['monospace', false]])
    expect(names('m\\6f nospace')).toEqual([['monospace', false]])
    expect(names('"m\\6fnospace"')).toEqual([['monospace', true]])
    expect(names('system\\-ui')).toEqual([['system-ui', false]])
    expect(names('"Courier\\20New"')).toEqual([['Courier New', true]])
    expect(names('"Probe \\"No\\" Such Family"')).toEqual([['Probe "No" Such Family', true]])
    expect(names('"a\\0 b\\110000 c\\d800 d"')).toEqual([['a�b�c�d', true]])
  })

  // Old: Gecko kept the identifiers apart, which its FamilyName syntax reads; the others had no such list.
  test('an escaped space is inside an identifier, a plain one between two', () => {
    expect(listedFamilies('Courier\\ New')).toEqual([{ quoted: false, name: 'Courier New', css: 'Courier\\ New', identifiers: ['Courier New'] }])
    expect(listedFamilies('Courier New')).toEqual([{ quoted: false, name: 'Courier New', css: 'Courier New', identifiers: ['Courier', 'New'] }])
  })

  // Old: the font checks and Gecko joined identifiers with one space. Blink and WebKit kept the white space as written, so
  // `Courier    New` wasn't WebKit's `courier new`.
  test('identifiers join with single spaces, whatever white space is between them and around the commas', () => {
    expect(names('Courier    New')).toEqual([['Courier New', false]])
    expect(names('Courier\t\nNew')).toEqual([['Courier New', false]])
    expect(listedFamilies('  "Courier New"  ,  monospace  ').map(family => family.css)).toEqual(['"Courier New"', 'monospace'])
    expect(names('"Probe No Such Family","Courier New"')).toEqual([['Probe No Such Family', true], ['Courier New', true]])
  })

  // Old: every parser took U+00A0 for white space (String.prototype.trim and the regular expressions' \s), and Gecko's made
  // two identifiers of it. CSS white space is the space, the tab and the newlines.
  test('U+00A0 is part of an identifier', () => {
    expect(listedFamilies(`Courier${NBSP}New`)).toEqual([{ quoted: false, name: `Courier${NBSP}New`, css: `Courier${NBSP}New`, identifiers: [`Courier${NBSP}New`] }])
  })

  // Old: every parser kept the case, and so does this one: comparing names is each engine's own (the last tests).
  test('case is kept', () => {
    expect(names('MONOSPACE, System-UI, "courier NEW"')).toEqual([['MONOSPACE', false], ['System-UI', false], ['courier NEW', true]])
  })

  // Old: the font checks found no family at all; Blink and WebKit took `"Courier New` for an unquoted name; Gecko read the
  // string. CSS ends an unclosed string at the end of the input.
  test('an unclosed string runs to the end, and an escaped newline or a last backslash adds nothing to a string', () => {
    expect(listedFamilies('"Courier New')).toEqual([{ quoted: true, name: 'Courier New', css: '"Courier New' }])
    expect(names('"Courier \\\nNew"')).toEqual([['Courier New', true]])
    expect(names('"Courier New\\')).toEqual([['Courier New', true]])
  })

  // Old: the font checks skipped an empty family; WebKit and Gecko listed a family with an empty name; Blink read the first
  // family alone. After a string, Gecko skipped one character and read on, and the others took the rest into the name. CSS
  // rejects all of these whole, so no page can set them.
  test('a list CSS rejects throws: an empty family, a comma at the end, anything but a comma after a string', () => {
    expect(() => listedFamilies('"Courier New",,monospace')).toThrow('isn\'t a list of family names')
    expect(() => listedFamilies('"Courier New",')).toThrow('isn\'t a list of family names')
    expect(() => listedFamilies('"Courier New" bold')).toThrow('isn\'t a list of family names')
    expect(() => listedFamilies('')).toThrow('isn\'t a list of family names')
  })
})

describe('what each port makes of the same lists', () => {
  test('WebKit lowercases the names and keeps each family as the list writes it', () => {
    expect(familyNames('"Probe,Comma", MONOSPACE')).toEqual([{ css: '"Probe,Comma"', name: 'probe,comma', quoted: true }, { css: 'MONOSPACE', name: 'monospace', quoted: false }])
    expect(familyNames('Courier    New, s\\65rif, "s\\65rif"')).toEqual([
      { css: 'Courier    New', name: 'courier new', quoted: false }, { css: 's\\65rif', name: 'serif', quoted: false }, { css: '"s\\65rif"', name: 'serif', quoted: true },
    ])
  })

  test('Gecko\'s generics are unquoted single identifiers in any case, and an identifier that holds a space makes the syntax quoted', () => {
    expect(parseFamilyList('MONOSPACE, m\\6fnospace, "monospace", Courier\\ New, Courier New')).toEqual([
      { kind: 'generic', name: 'monospace' }, { kind: 'generic', name: 'monospace' }, { kind: 'named', name: 'monospace', syntax: 'quoted' },
      { kind: 'named', name: 'Courier New', syntax: 'quoted' }, { kind: 'named', name: 'Courier New', syntax: 'identifiers' },
    ])
  })
})
