// Who may know whom (research/ARCHITECTURE-PLAN-2.md §7 check 8).
//
// 1. No expected value, threshold width or verdict comes from rebuild/src (research/TEST-ARCHITECTURE.md §0 rule 1). The
//    test tooling, the lab's observer, scorer, gate and case generators, the observation ports and the probes may import
//    from rebuild/src only the shared contract: types from src/model.ts and src/env.ts, and data constants from them that
//    aren't functions (UNKNOWN_FONT_FACTS, PINNED_BUILDS); and, as types only, each engine's geometry
//    (src/engines/<engine>/geometry.ts, which step 1's S2 makes from model.ts). The prediction adapter
//    lab/predictor-core.ts is the one exemption: the lab's predictors (lab/predictor.ts, lab/baselines/no-facts-predictor.ts)
//    are made from it and import nothing else from rebuild/src but contract constants. tests/replay.ts and
//    tests/function-set.ts load a predictor, and the second the library's function set, by path when they run: they compare
//    the library with itself and hold no expected value (rebuild/TESTS.md §11).
// 2. The shared layer names no engine (§5.4): outside comments, a file of rebuild/src that isn't under engines/, and isn't
//    index.ts (the one dispatch) or env.ts (whose serialized shape is part of the row), holds no import path containing
//    `engines/`, no string literal 'blink', 'webkit' or 'gecko', and no identifier containing one of those names.
//    src/measure/ is shared like the rest. Test files are left out: a shared algorithm is tested with an engine's data.
//    SHARED_FILES_THAT_NAME_ENGINES lists the files that don't hold yet, with their count of such mentions at the
//    correctness line: a count may only fall, the list may only shrink, and an entry that no longer matches its file fails
//    too, so the list is what is left to do (S2 leaves paint.ts; step 3 empties it).
// 3. An engine imports no other engine.
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import * as ts from 'typescript'

const REBUILD = resolve(import.meta.dir, '..')
const SRC = join(REBUILD, 'src')
const ENGINES = ['blink', 'webkit', 'gecko']
const GEOMETRY = new Set(ENGINES.map(engine => join(SRC, 'engines', engine, 'geometry.ts')))
const CONTRACT = new Set([join(SRC, 'model.ts'), join(SRC, 'env.ts'), ...GEOMETRY])
const CHECKED_DIRS = ['tests', 'lab', 'probes']
const EXEMPT = new Set([join(REBUILD, 'lab/predictor-core.ts')])

function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

type Import = { typeOnly: boolean; names: Array<{ name: string; typeOnly: boolean }>; target: string }

// import/export ... from '...' statements, with the named bindings when there are braces.
function importsOf(source: string, from: string): Import[] {
  const out: Import[] = []
  const pattern = /^\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const specifier = match[3]!
    if (!specifier.startsWith('.')) continue
    const names: Import['names'] = []
    const braces = /\{([\s\S]*)\}/.exec(match[2]!)
    if (braces !== null) {
      for (const part of braces[1]!.split(',')) {
        const trimmed = part.trim()
        if (trimmed === '') continue
        const typeOnly = trimmed.startsWith('type ')
        names.push({ name: trimmed.replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim(), typeOnly })
      }
    } else if (match[1] === undefined) {
      names.push({ name: '*', typeOnly: false })
    }
    out.push({ typeOnly: match[1] !== undefined, names, target: resolve(dirname(from), specifier) })
  }
  return out
}

describe('independence from rebuild/src', () => {
  test('checked files import only the shared contract from rebuild/src', async () => {
    const problems: string[] = []
    for (const dir of CHECKED_DIRS) {
      if (!existsSync(join(REBUILD, dir))) continue
      for (const path of files(join(REBUILD, dir))) {
        if (EXEMPT.has(path)) continue
        for (const value of importsOf(readFileSync(path, 'utf8'), path)) {
          if (!value.target.startsWith(`${SRC}/`)) continue
          const where = `${relative(REBUILD, path)} imports ${relative(REBUILD, value.target)}`
          if (!CONTRACT.has(value.target)) {
            problems.push(`${where}: engine or library logic`)
            continue
          }
          if (value.typeOnly) continue
          if (GEOMETRY.has(value.target)) {
            for (const { name, typeOnly } of value.names) if (!typeOnly) problems.push(`${where}: ${name} isn't imported as a type; an engine's geometry is types only`)
            continue
          }
          const module = await import(value.target) as Record<string, unknown>
          for (const { name, typeOnly } of value.names) {
            if (typeOnly) continue
            if (name === '*' || typeof module[name] === 'function') problems.push(`${where}: value ${name} is logic`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })
})

// Mentions at the correctness line (af50a11). Lower a count as mentions go; drop an entry when its file holds none.
const SHARED_FILES_THAT_NAME_ENGINES: Record<string, number> = {
  'breaks/generated/blink-break-tables.ts': 11,
  'breaks/generated/gecko-break-data.ts': 2,
  'breaks/generated/webkit-break-tables.ts': 15,
  'breaks/tables.ts': 38,
  'measure/canvas-checks.ts': 3,
  'measure/font-checks.ts': 10,
  'model.ts': 70,
  'paint.ts': 53,
  'unicode/bidi.ts': 3,
  'unicode/grapheme.ts': 9,
}
const ENGINE_NAME = /blink|webkit|gecko/i

// What rule 2 forbids in a source text, each with its line; comments never count, since the parser drops them.
function engineMentions(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const at = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text.includes('engines/')) out.push(`line ${at(node)}: imports ${node.moduleSpecifier.text}`)
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ENGINES.includes(node.text)) {
      out.push(`line ${at(node)}: the string '${node.text}'`)
    } else if (ts.isIdentifier(node) && ENGINE_NAME.test(node.text)) {
      out.push(`line ${at(node)}: the identifier ${node.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

describe('the shared layer names no engine', () => {
  test('a shared file mentions an engine only where the list says it still does, as often and no more', () => {
    const problems: string[] = []
    const found = new Set<string>()
    for (const path of files(SRC)) {
      const name = relative(SRC, path)
      if (name.startsWith('engines/') || name === 'index.ts' || name === 'env.ts' || name.endsWith('.test.ts')) continue
      const mentions = engineMentions(path, readFileSync(path, 'utf8'))
      const listed = SHARED_FILES_THAT_NAME_ENGINES[name]
      if (mentions.length > 0) found.add(name)
      if (listed === undefined) {
        if (mentions.length > 0) problems.push(`src/${name} names an engine (${mentions.length}): ${mentions.slice(0, 5).join('; ')}`)
      } else if (mentions.length > listed) {
        problems.push(`src/${name} names an engine ${mentions.length} times, ${mentions.length - listed} more than the ${listed} listed: ${mentions.slice(0, 5).join('; ')} ...`)
      } else if (mentions.length < listed) {
        problems.push(`src/${name} names an engine ${mentions.length} times, fewer than the ${listed} listed: ${mentions.length === 0 ? 'drop its entry' : `lower its count to ${mentions.length}`}`)
      }
    }
    for (const name of Object.keys(SHARED_FILES_THAT_NAME_ENGINES)) if (!found.has(name) && !existsSync(join(SRC, name))) problems.push(`src/${name} is listed and gone: drop its entry`)
    expect(problems).toEqual([])
  })

  test('the rule reads code, not comments, and catches an import, a string and an identifier', () => {
    expect(engineMentions('a.ts', "// Blink's LineInfo (line_info.cc), like WebKit's\n/* gecko */ export const x = 'a blink of an eye'\n")).toEqual([])
    expect(engineMentions('a.ts', "import type { BlinkItem } from './engines/blink/types.js'\nexport function f(engine: string): boolean { return engine === 'webkit' }\nexport const geckoRounds = true\n")).toEqual([
      "line 1: imports ./engines/blink/types.js", 'line 1: the identifier BlinkItem', "line 2: the string 'webkit'", 'line 3: the identifier geckoRounds',
    ])
  })
})

describe('engines stay apart', () => {
  test('an engine imports no other engine', () => {
    const problems: string[] = []
    for (const engine of ENGINES) {
      for (const path of files(join(SRC, 'engines', engine))) {
        for (const value of importsOf(readFileSync(path, 'utf8'), path)) {
          for (const other of ENGINES) {
            if (other !== engine && value.target.startsWith(`${join(SRC, 'engines', other)}/`)) problems.push(`${relative(REBUILD, path)} imports ${relative(REBUILD, value.target)}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  test('the import scan sees an import of another engine', () => {
    const from = join(SRC, 'engines/webkit/lines.ts')
    expect(importsOf("import { shape } from '../blink/shape.js'\n", from).map(value => value.target)).toEqual([join(SRC, 'engines/blink/shape.js')])
  })
})
