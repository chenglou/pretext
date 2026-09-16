// Trivial probes that exercise every runner path: env with and without <html lang>, lines, boxes, ranges, setup text
// the parser can't carry, the four canvas kinds, shared contexts, lang changes, animation frames, a fixture web font
// in the page and the worker, and shared versus fresh documents. Not hypotheses; they validate the runner.
import type { Probe } from './types.ts'

const spec = 'runner smoke'

const probes: Probe[] = [
  { id: 'smoke/env', spec, pageLang: 'en', observe: [{ kind: 'env', families: ['Arial', 'Helvetica Neue', 'Hiragino Sans', 'No Such Family 7f3a'] }] },
  {
    id: 'smoke/env-no-lang', spec, pageLang: null, note: 'About a missing lang: the page must have no lang attribute.',
    observe: ['env', { kind: 'script', source: 'return { hasLang: document.documentElement.hasAttribute("lang") }' }],
  },
  { id: 'smoke/lines-wrap', spec, pageLang: 'en', html: '<div style="font:16px/20px Arial;width:60px">hello world foo</div>', observe: ['lines', 'boxWidth'] },
  { id: 'smoke/lines-bold-edge', spec, pageLang: 'en', html: '<div style="font:16px/20px Arial;width:1px"><b>foo</b>bar baz</div>', observe: ['lines'] },
  {
    id: 'smoke/box-spans', spec, pageLang: 'en',
    html: '<div style="font:24px Arial;white-space:nowrap"><span id="av">AV</span> <span id="a">A</span><span id="v">V</span></div>',
    observe: [{ kind: 'boxWidth', selectors: ['#av', '#a', '#v', 'span'] }],
  },
  { id: 'smoke/range-pre', spec, pageLang: 'en', html: '<div style="font:16px/20px Arial;white-space:pre">Hello world</div>', observe: ['rangeWidth'] },
  {
    id: 'smoke/setup-cr', spec, pageLang: 'en', html: '<div style="font:16px/20px Arial;width:1px">x</div>',
    setup: 'element.firstChild.data = "a\\rb"',
    canvas: [{ kind: 'offscreen', font: '16px Arial', text: 'a\rb' }, { kind: 'offscreen', font: '16px Arial', text: 'a b' }],
    observe: ['lines', 'rangeWidth', 'canvasWidths'],
  },
  {
    id: 'smoke/canvas-offscreen', spec, pageLang: 'en',
    canvas: [
      { kind: 'offscreen', font: '16px Arial', text: 'Hello world' },
      { kind: 'offscreen', font: '16px Arial', text: 'a\fb' },
      { kind: 'offscreen', font: '13.33px Arial', letterSpacing: '10%', text: 'ab' },
    ],
    observe: ['canvasWidths'],
  },
  {
    id: 'smoke/canvas-element-style', spec, pageLang: 'en',
    canvas: [
      { kind: 'element', elementStyle: 'letter-spacing:5px', font: '40px Arial', text: 'abc' },
      { kind: 'offscreen', font: '40px Arial', text: 'abc' },
    ],
    observe: ['canvasWidths'],
  },
  {
    id: 'smoke/canvas-shared-order', spec, pageLang: 'en',
    canvas: [
      { kind: 'offscreen', context: 'A', font: '16px Arial', wordSpacing: '10px', text: ' x' },
      { kind: 'offscreen', context: 'A', text: 'x y' },
      { kind: 'offscreen', context: 'B', font: '16px Arial', wordSpacing: '10px', text: 'x y' },
      { kind: 'offscreen', context: 'B', text: ' x' },
    ],
    observe: ['canvasWidths'],
  },
  {
    id: 'smoke/canvas-worker-transferred', spec, pageLang: 'en',
    canvas: [
      { kind: 'worker', font: '32px serif', text: 'Hello, world' },
      { kind: 'transferred', elementLang: 'ja', font: '32px serif', text: 'Hello, world' },
      { kind: 'offscreen', font: '32px serif', text: 'Hello, world' },
    ],
    observe: ['canvasWidths'],
  },
  {
    id: 'smoke/canvas-lang-frames', spec, pageLang: 'en',
    canvas: [
      { kind: 'element', context: 'E', font: '32px serif', text: 'Hello, world' },
      { kind: 'element', context: 'E', pageLang: 'ja', text: 'Hello, world' },
      { kind: 'element', context: 'E', frames: 2, text: 'Hello, world' },
    ],
    observe: ['canvasWidths', { kind: 'script', source: 'return document.documentElement.getAttribute("lang")' }],
  },
  {
    id: 'smoke/fixture-amiri', spec, pageLang: 'en', fontFixtures: ['Amiri'],
    html: '<div style="font:16px/30px Amiri;white-space:pre">(ب)</div>',
    canvas: [{ kind: 'offscreen', font: '16px Amiri', text: ')' }, { kind: 'worker', font: '16px Amiri', text: ')' }],
    observe: ['rangeWidth', 'canvasWidths', { kind: 'env', families: ['Amiri'] }],
  },
  { id: 'smoke/shared-doc-1', spec, pageLang: 'en', document: 'smoke-shared', observe: [{ kind: 'script', source: 'window.smokeMarker = (window.smokeMarker ?? 0) + 1; return window.smokeMarker' }] },
  { id: 'smoke/shared-doc-2', spec, pageLang: 'en', document: 'smoke-shared', note: 'Expect 2: same document as shared-doc-1.', observe: [{ kind: 'script', source: 'window.smokeMarker = (window.smokeMarker ?? 0) + 1; return window.smokeMarker' }] },
  { id: 'smoke/fresh-doc', spec, pageLang: 'en', note: 'Expect 1: a fresh document.', observe: [{ kind: 'script', source: 'window.smokeMarker = (window.smokeMarker ?? 0) + 1; return window.smokeMarker' }] },
]

export default probes
