// No expected value, threshold width or verdict comes from rebuild/src (research/TEST-ARCHITECTURE.md §0 rule 1). The
// test tooling, the lab's observer, scorer, gate and case generators, the observation ports and the probes may import from
// rebuild/src only the shared contract: types from src/model.ts and src/env.ts, and data constants from them that aren't
// functions (UNKNOWN_FONT_FACTS, PINNED_BUILDS). The prediction adapter lab/predictor.ts is the one exemption.
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const REBUILD = resolve(import.meta.dir, '..')
const SRC = join(REBUILD, 'src')
const CONTRACT = new Set([join(SRC, 'model.ts'), join(SRC, 'env.ts')])
const CHECKED_DIRS = ['tests', 'lab', 'probes']
const EXEMPT = new Set([join(REBUILD, 'lab/predictor.ts')])

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
