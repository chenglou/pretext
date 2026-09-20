// What one tree's Blink port asks Canvas, string by string, and what it answers, for a file of cases under the stand-in
// Canvas: a line per case and kind of paragraph (plain, inspected) with the number of questions and three hashes. Two
// trees' outputs are held against each other with diff: equal files mean the same strings on the same contexts in the
// same order, stored the same way, and the same fill results, pieces and inspections at every width.
//
//   bun build rebuild/tools/question-strings-dump.ts --target=node --outfile=<dump.mjs>      (in each tree)
//   node <dump.mjs> --cases=<cases.ndjson> [--config=no-facts|facts] [--inspect=no] [--widths=0,30,...] [--verbose=<case id>]
//
// Run by node, which is V8 as Chrome is, the second hash holds how V8 stores every string, one byte a unit or two
// (v8.serialize writes a string with a tag that says which): Canvas shapes the two kinds differently (shape.ts
// canvasString), and the stand-in Canvas doesn't, so a tree that builds the same characters another way shows here and
// nowhere else offline. Run by bun the second hash means nothing.
import { readFileSync } from 'node:fs'
import { serialize } from 'node:v8'
import { predict as predictNoFacts } from '../lab/baselines/no-facts-predictor.ts'
import { predict as predictFacts } from '../lab/predictor.ts'
import type { Case } from '../lab/types.ts'
import { fillLine, firstLine, inspectLine, linePieces, prepare } from '../src/index.ts'
import { installStandInCanvas } from './stand-in-canvas.ts'

const CHROME = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', env: { browser: 'chrome', build: '153.0.8010.50', languages: { engine: 'blink', uiLanguage: 'zh-CN' } } } as const

const options = new Map<string, string>()
for (const raw of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.*)$/s.exec(raw)
  if (match === null) throw new Error(`Unknown argument ${raw}`)
  options.set(match[1]!, match[2]!)
}
const predict = options.get('config') === 'facts' ? predictFacts : predictNoFacts
const widths = (options.get('widths') ?? '0,30,90,120,320,100000').split(',').map(Number)
const verbose = options.get('verbose')

let questions = 0
let asked = 0x811c9dc5
let stored = 0x811c9dc5
function fnv(h: number, text: string): number {
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return Math.imul(h ^ 0xffff, 0x01000193)
}

// Every context's measureText notes the question before the stand-in answers it.
type Context = { measureText: (text: string) => unknown; font: string; lang: string; letterSpacing: string; wordSpacing: string; fontKerning: string; textRendering: string; direction: string }
function noteQuestions(): void {
  const globals = globalThis as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext(kind: string): Context } }
  const Inner = globals.OffscreenCanvas
  globals.OffscreenCanvas = class {
    inner = new Inner(1, 1)
    getContext(kind: string): Context {
      const context = this.inner.getContext(kind)
      const measure = context.measureText.bind(context)
      context.measureText = (text: string) => {
        const settings = `${context.lang}|${context.font}|${context.letterSpacing}|${context.wordSpacing}|${context.fontKerning}|${context.textRendering}|${context.direction}`
        // The tag first: hashing reads the string, which must not change how it is stored before the tag is read.
        const tag = serialize(text)[2]!
        questions++
        asked = fnv(fnv(asked, settings), text)
        stored = Math.imul(stored ^ tag, 0x01000193)
        if (verbose !== undefined) console.log(JSON.stringify({ settings, text, units: text.length, tag: String.fromCharCode(tag) }))
        return measure(text)
      }
      return context
    }
  }
}

const cases: Case[] = []
for (const line of readFileSync(options.get('cases')!, 'utf8').split('\n')) if (line !== '') cases.push(JSON.parse(line) as Case)
for (let i = 0; i < cases.length; i++) {
  const c = cases[i]!
  if (verbose !== undefined && c.id !== verbose) continue
  const kinds = options.get('inspect') === 'no' ? [false] : [false, true]
  for (let k = 0; k < kinds.length; k++) {
    const inspect = kinds[k]!
    const standIn = installStandInCanvas({ userAgent: CHROME.userAgent, devicePixelRatio: 2, pageLang: c.pageLang })
    noteQuestions()
    questions = 0
    asked = 0x811c9dc5
    stored = 0x811c9dc5
    let results = 0x811c9dc5
    let lineCount = 0
    try {
      const prediction = predict(c, CHROME.env)
      if (!('layout' in prediction)) throw new Error(`the predictor gave no layout: ${JSON.stringify(prediction).slice(0, 200)}`)
      results = fnv(results, JSON.stringify(prediction.layout))
      const prepared = prepare(prediction.paragraph, prediction.layout.env, inspect)
      for (let w = 0; w < widths.length; w++) {
        for (let start = firstLine(prepared); start !== null;) {
          const filled = fillLine(prepared, start, { width: widths[w]!, left: 0, right: 0 })
          const pieces = filled.kind === 'line' ? linePieces(prepared, filled.line) : null
          const inspection = inspect ? inspectLine(prepared, filled.line) : null
          const text = JSON.stringify({ kind: filled.kind, line: filled.line, next: filled.next, pieces, inspection })
          if (verbose !== undefined) console.log(`width ${widths[w]}: ${text.slice(0, 2000)}`)
          results = fnv(results, text)
          lineCount++
          start = filled.next
        }
      }
      console.log(`${c.id}\t${inspect ? 'inspected' : 'plain'}\t${questions} questions\t${lineCount} lines\tasked ${asked >>> 0}\tstored ${stored >>> 0}\tresults ${results >>> 0}`)
    } catch (error) {
      console.log(`${c.id}\t${inspect ? 'inspected' : 'plain'}\t${questions} questions\tthrew ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}\tasked ${asked >>> 0}\tstored ${stored >>> 0}`)
    } finally {
      standIn.restore()
    }
  }
}
