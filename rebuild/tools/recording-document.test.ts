// The recording document of the painter differential: what it keeps of a painting, and that it refuses what it can't keep.
import { describe, expect, test } from 'bun:test'
import { RecordingDocument, UnmodelledDom, recordedPainting } from './recording-document.ts'

describe('the recording document', () => {
  test('keeps properties, attributes and style declarations in the order they were set, and the tree', () => {
    const doc = new RecordingDocument()
    const div = doc.createElement('div') as unknown as HTMLDivElement
    div.style.margin = '0'
    div.style.setProperty('margin-inline-start', '2px')
    div.style.letterSpacing = '1px'
    div.lang = 'en'
    div.setAttribute('dir', 'rtl')
    const span = div.appendChild(doc.createElement('span') as unknown as HTMLSpanElement)
    span.append('a', doc.createElement('br') as unknown as HTMLBRElement)
    expect(recordedPainting([div])).toEqual([[{
      node: 'element', tag: 'div', set: [['lang', 'en'], ['@dir', 'rtl']], style: [['margin', '0'], ['margin-inline-start', '2px'], ['letter-spacing', '1px']],
      children: [{ node: 'element', tag: 'span', set: [], style: [], children: [{ node: 'text', made: 'a', edits: [], data: 'a' }, { node: 'element', tag: 'br', set: [], style: [], children: [] }] }],
    }]])
    expect(div.style.letterSpacing).toBe('1px')
    expect((span as unknown as { parentNode: unknown }).parentNode).toBe(div)
  })

  test('two orders of the same declarations serialize differently: a shorthand after its longhand wins', () => {
    const paint = (first: string, second: string): string => {
      const element = new RecordingDocument().createElement('div') as unknown as HTMLElement
      element.style.setProperty(first, '1px')
      element.style.setProperty(second, '1px')
      return JSON.stringify(recordedPainting([element]))
    }
    expect(paint('margin', 'margin-left')).not.toBe(paint('margin-left', 'margin'))
  })

  test('keeps how a text node was made: the same characters through deleteData are another node (src/paint.ts textNode)', () => {
    const doc = new RecordingDocument()
    const plain = doc.createTextNode('ab')
    const cut = doc.createTextNode('abĀ')
    cut.deleteData(2, 1)
    expect(cut.data).toBe(plain.data)
    expect(recordedPainting([cut])).toEqual([[{ node: 'text', made: 'abĀ', edits: ['deleteData(2,1)'], data: 'ab' }]])
    expect(JSON.stringify(recordedPainting([cut]))).not.toBe(JSON.stringify(recordedPainting([plain])))
  })

  test('a painter that uses DOM this file doesn\'t model fails by name instead of going unrecorded', () => {
    const element = new RecordingDocument().createElement('div') as unknown as HTMLElement
    expect(() => element.classList).toThrow(UnmodelledDom)
    expect(() => { (element as unknown as { parentNode: unknown }).parentNode = null }).toThrow(UnmodelledDom)
    expect(() => recordedPainting([{}])).toThrow(UnmodelledDom)
  })
})
