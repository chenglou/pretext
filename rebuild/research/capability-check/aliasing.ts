// The two properties research/INCREMENTAL-API-READING.md §4 asks to keep: a line start is small plain data that doesn't
// depend on the prepared object, and nothing handed to the application aliases prepared data.
//   bun rebuild/research/capability-check/aliasing.ts
// Every object reachable from the prepared paragraph's state is collected (the caller's own paragraph and environment left
// out), and then each thing the function set hands out is walked for an object that is also in that set: a fill result's
// `next`, the rest of the fill result without its decided line, a line's pieces, and the decided line itself, which is the
// engine's own record and documented as such. It prints how many shared objects each holds and the path of the first.
import { fillLine, firstLine, linePieces, type LineStart, type Prepared } from '../../src/index.ts'
import { forEach, fullSlot, prepare } from './setup.ts'

function reachable(root: unknown, skip: Set<unknown>): Set<unknown> {
  const seen = new Set<unknown>()
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value !== 'object' || value === null || seen.has(value) || skip.has(value)) continue
    seen.add(value)
    if (ArrayBuffer.isView(value)) continue
    if (value instanceof Map) { for (const [k, v] of value) stack.push(k, v); continue }
    if (value instanceof Set) { for (const v of value) stack.push(v); continue }
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) stack.push((value as Record<string, unknown>)[keys[i]!])
  }
  return seen
}

function shared(value: unknown, owned: Set<unknown>, path: string, found: string[], seen: Set<unknown>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  if (owned.has(value)) { found.push(path); return }
  if (ArrayBuffer.isView(value)) return
  const keys = Object.keys(value)
  for (let i = 0; i < keys.length; i++) shared((value as Record<string, unknown>)[keys[i]!], owned, `${path}.${keys[i]}`, found, seen)
}

const totals = new Map<string, { objects: number; first: string | null; bytes: number }>()

forEach((engine, sample, env) => {
  const prepared: Prepared = prepare(sample.paragraph, env, false)
  const callers = reachable(sample.paragraph, new Set())
  for (const v of reachable(env, new Set())) callers.add(v)
  const owned = reachable(prepared.state, callers)
  for (let start: LineStart | null = firstLine(prepared); start !== null;) {
    const result = fillLine(prepared, start, fullSlot(320))
    if (result.kind !== 'line') throw new Error('refused')
    const { line, next, ...rest } = result
    const handed: Array<[string, unknown]> = [['next', next], ['fill result without line', rest], ['pieces', linePieces(prepared, line)], ['decided line', line]]
    for (let h = 0; h < handed.length; h++) {
      const [name, value] = handed[h]!
      const found: string[] = []
      shared(value, owned, name, found, new Set())
      const key = `${engine} ${name}`
      const total = totals.get(key) ?? { objects: 0, first: null, bytes: 0 }
      total.objects += found.length
      if (total.first === null && found.length > 0) total.first = found[0]!
      if (name === 'next' && next !== null) total.bytes = Math.max(total.bytes, JSON.stringify(next).length)
      totals.set(key, total)
    }
    start = next
  }
})

for (const [key, total] of totals) {
  console.log(`${key.padEnd(34)} shares ${String(total.objects).padStart(4)} objects with the prepared paragraph${total.first === null ? '' : `, first at ${total.first}`}${total.bytes > 0 ? ` | largest start as JSON: ${total.bytes} bytes` : ''}`)
}
