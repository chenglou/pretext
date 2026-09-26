// The justification demo's model under a stand-in Canvas, at every other column width the slider offers: the optimal
// column never paints a line wider than the column, and each painted column's lines keep the source text in order.
// Before #40 the optimal column fit candidates to spacing it didn't paint and overflowed.
import { running } from '../../harness/watchdog.ts'
import { afterAll, beforeAll, expect, test } from 'bun:test'

class Context {
  font = ''
  measureText(text: string): { width: number } {
    let width = 0
    for (const ch of text) width += ch === ' ' ? 4.2 : 5 + (ch.codePointAt(0)! % 5)
    return { width }
  }
}

const saved = { document: Reflect.get(globalThis, 'document') as unknown, OffscreenCanvas: Reflect.get(globalThis, 'OffscreenCanvas') as unknown }
beforeAll(() => {
  // The demo's model streams lines until layoutNextLine ends, so a library that never ends it runs away here.
  running('pages/demos/justification-comparison.model.test.ts')
  Reflect.set(globalThis, 'OffscreenCanvas', class { getContext(): Context { return new Context() } })
  // A page language of its own makes the library measure with this Canvas; the model measures with the page's.
  Reflect.set(globalThis, 'document', { documentElement: { lang: 'en-x-justification' }, body: null, createElement: () => ({ getContext: () => new Context() }) })
})
afterAll(() => {
  running('')
  for (const name of ['document', 'OffscreenCanvas'] as const) {
    if (saved[name] === undefined) Reflect.deleteProperty(globalThis, name)
    else Reflect.set(globalThis, name, saved[name])
  }
})

test('the optimal column fits every line it paints, and the painted columns keep the source (#40)', async () => {
  const { buildDemoFrame, createDemoResources } = await import('./justification-comparison.model.ts')
  const { PARAGRAPHS } = await import('./justification-comparison.data.ts')
  const resources = createDemoResources()
  const failures: string[] = []
  for (let colWidth = 200; colWidth <= 600; colWidth += 2) {
    const frame = buildDemoFrame(resources, { colWidth, showIndicators: true })
    for (const name of ['hyphen', 'optimal'] as const) {
      for (let p = 0; p < frame[name].paragraphs.length; p++) {
        const source = PARAGRAPHS[p]!
        let offset = 0
        for (const line of frame[name].paragraphs[p]!) {
          // The painter's advances, with the spaces it chose.
          let painted = 0
          let text = ''
          for (const segment of line.segments) {
            painted += segment.kind === 'space' && line.spacing.kind === 'justified' ? line.spacing.width : segment.width
            text += segment.kind === 'space' ? ' ' : segment.text
          }
          if (name === 'optimal' && painted > line.maxWidth + 0.01) failures.push(`${name} ${colWidth}px: ${painted} past ${line.maxWidth}: ${text}`)
          if (line.trailingMarker === 'soft-hyphen' && line.ending === 'wrap') text = text.slice(0, -1)
          if (source.slice(offset, offset + text.length) !== text) failures.push(`${name} ${colWidth}px: paragraph ${p} at ${offset} paints ${JSON.stringify(text)}`)
          offset += text.length
          // Spaces taken at a line boundary aren't painted.
          while (source[offset] === ' ') offset++
        }
        if (offset !== source.length) failures.push(`${name} ${colWidth}px: paragraph ${p} ends at ${offset} of ${source.length}`)
      }
    }
  }
  expect(failures).toEqual([])
})
