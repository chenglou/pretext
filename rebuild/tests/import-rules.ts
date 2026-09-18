// Writes rebuild/tests/rules.json from the 2026-09-16 rule catalogue and rule-changes.json.
//   bun rebuild/tests/import-rules.ts [--catalogue=.artifacts/research-20260916/tentpoles/rules/rules.json] [--changes=rebuild/tests/rule-changes.json] [--check]
//
// rule-changes.json is where rules change: `added` declares a rule, `reclassified` replaces the fields it names (kind,
// statement, source, probes, tests, area, declaredBy) on any rule, from the catalogue or added, and entries for one rule
// apply in order; `removed` retires a rule. Catalogue first, then added, reclassified and removed.
//
// A registry edited by hand isn't lost. The registry keeps a hash of every rule as generated (`generated`), so the importer
// tells three versions of a rule apart: as last generated, as the file holds it now, and as the changes give it now.
// - The file's version equals the last generated one: the new generation replaces it.
// - Only the file's version moved (a hand edit), or the file has a rule no generation made: the importer writes it into
//   rule-changes.json, a reclassified entry with the fields that differ or an added entry, and says so.
// - Both moved and disagree, a generated rule was deleted by hand, or a hand edit touches a field no entry can carry (id,
//   engine, status, replacedBy, audit): it stops and names the rule. Nothing is written.
// A registry from before the hashes counts as hand-edited wherever it differs. --check writes nothing and exits 1 when the
// registry or rule-changes.json would change.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REGISTRY_PATH, type Registry, type RuleKind, type RuleRecord } from './registry.ts'

const REPO = resolve(import.meta.dir, '../..')
export type CatalogueRule = { id: string; engine: RuleRecord['engine']; area: string; kind: RuleKind; statement: string; source: string; probes: string[]; tests: string[]; audit: string | null }
const PATCHABLE = ['area', 'kind', 'statement', 'source', 'probes', 'tests'] as const
type Patch = Partial<Pick<RuleRecord, typeof PATCHABLE[number]>>
export type Changes = {
  note: string
  removed: Array<{ id: string; reason: string; replacedBy: string[] }>
  reclassified: Array<{ id: string } & Patch & { declaredBy?: string }>
  added: Array<Omit<RuleRecord, 'audit' | 'status' | 'replacedBy'>>
}

export function generate(rules: readonly CatalogueRule[], changes: Changes): RuleRecord[] {
  const byId = new Map<string, RuleRecord>()
  for (const rule of rules) {
    byId.set(rule.id, {
      id: rule.id, engine: rule.engine, area: rule.area, kind: rule.kind, statement: rule.statement, source: rule.source,
      probes: rule.probes, tests: rule.tests, audit: rule.audit, status: 'current', replacedBy: [], declaredBy: 'catalogue 2026-09-16',
    })
  }
  for (const added of changes.added) {
    if (byId.has(added.id)) throw new Error(`added ${added.id} is already a rule`)
    byId.set(added.id, { ...added, audit: null, status: 'current', replacedBy: [] })
  }
  for (const change of changes.reclassified) {
    const rule = byId.get(change.id)
    if (rule === undefined) throw new Error(`reclassified ${change.id} is neither in the catalogue nor added`)
    const { id: _id, ...fields } = change
    Object.assign(rule, fields)
  }
  for (const change of changes.removed) {
    const rule = byId.get(change.id)
    if (rule === undefined) throw new Error(`removed ${change.id} is neither in the catalogue nor added`)
    rule.status = 'removed'
    rule.replacedBy = change.replacedBy
    rule.statement = `${rule.statement} [removed: ${change.reason}]`
  }
  for (const rule of byId.values()) {
    for (const id of rule.replacedBy) if (!byId.has(id)) throw new Error(`${rule.id} is replaced by unknown ${id}`)
  }
  return [...byId.values()]
}

// A rule's fields in one order, so records written by hand compare with generated ones.
const FIELDS = ['id', 'engine', 'area', 'kind', 'statement', 'source', 'probes', 'tests', 'audit', 'status', 'replacedBy', 'declaredBy'] as const
function canonical(rule: RuleRecord): string {
  return JSON.stringify(FIELDS.map(name => rule[name]))
}

function hashOf(rule: RuleRecord): string {
  return createHash('sha256').update(canonical(rule)).digest('hex').slice(0, 16)
}

// rule-changes.json as it is kept: one entry per line.
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`
  if (typeof value === 'object' && value !== null) return `{ ${Object.entries(value).map(([name, field]) => `${JSON.stringify(name)}: ${inline(field)}`).join(', ')} }`
  return JSON.stringify(value)
}

export function formatChanges(changes: Changes): string {
  const list = (entries: readonly unknown[]): string => entries.length === 0 ? '[]' : `[\n${entries.map(entry => `    ${inline(entry)}`).join(',\n')}\n  ]`
  return `{\n  "note": ${JSON.stringify(changes.note)},\n  "removed": ${list(changes.removed)},\n  "reclassified": ${list(changes.reclassified)},\n  "added": ${list(changes.added)}\n}\n`
}

// Moves what was edited by hand in the registry into `changes` (see the header), and names what it can't.
export function adoptHandEdits(existing: Registry | null, rules: readonly CatalogueRule[], changes: Changes): { adopted: string[]; conflicts: string[] } {
  const base = existing?.generated ?? {}
  const generated = generate(rules, changes)
  const adopted: string[] = []
  const conflicts: string[] = []
  if (existing !== null) {
    const now = new Map(generated.map(rule => [rule.id, rule]))
    const inFile = new Set(existing.rules.map(rule => rule.id))
    for (const id of now.keys()) if (!inFile.has(id) && base[id] !== undefined) conflicts.push(`${id}: deleted from rules.json by hand; retire it with a removed entry instead`)
    for (const rule of existing.rules) {
      const next = now.get(rule.id)
      if (next !== undefined && canonical(next) === canonical(rule)) continue
      if (base[rule.id] !== undefined && hashOf(rule) === base[rule.id]) continue
      if (next === undefined) {
        if (base[rule.id] !== undefined) continue // generated before, and the changes dropped it since
        if (rule.status !== 'current' || rule.replacedBy.length > 0 || rule.audit !== null) {
          conflicts.push(`${rule.id}: added by hand with a status, replacement or audit note, which an added entry can't carry`)
          continue
        }
        const { audit: _audit, status: _status, replacedBy: _replacedBy, ...entry } = rule
        changes.added.push(entry)
        adopted.push(`${rule.id}: added by hand; now an added entry`)
        continue
      }
      if (base[rule.id] !== undefined && hashOf(next) !== base[rule.id]) {
        conflicts.push(`${rule.id}: edited by hand in rules.json and changed in rule-changes.json since the last import; keep one`)
        continue
      }
      const patch: Patch = {}
      for (const name of PATCHABLE) if (JSON.stringify(rule[name]) !== JSON.stringify(next[name])) Object.assign(patch, { [name]: rule[name] })
      if (canonical({ ...next, ...patch, declaredBy: rule.declaredBy }) !== canonical(rule)) {
        conflicts.push(`${rule.id}: the hand edit changes a field no reclassified entry carries (id, engine, status, replacedBy or audit)`)
        continue
      }
      changes.reclassified.push({ id: rule.id, ...patch, ...(rule.declaredBy === next.declaredBy ? {} : { declaredBy: rule.declaredBy }) })
      adopted.push(`${rule.id}: ${Object.keys(patch).join(', ') || 'declaredBy'} edited by hand; now a reclassified entry`)
    }
  }
  return { adopted, conflicts }
}

if (import.meta.main) {
  const args = new Map<string, string>()
  let check = false
  for (const arg of process.argv.slice(2)) {
    if (arg === '--check') {
      check = true
      continue
    }
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    args.set(match[1]!, match[2]!)
  }
  const cataloguePath = resolve(REPO, args.get('catalogue') ?? '.artifacts/research-20260916/tentpoles/rules/rules.json')
  const changesPath = resolve(REPO, args.get('changes') ?? 'rebuild/tests/rule-changes.json')
  const catalogue = (JSON.parse(readFileSync(cataloguePath, 'utf8')) as { generatedAt: string; rules: CatalogueRule[] })
  const changes = JSON.parse(readFileSync(changesPath, 'utf8')) as Changes
  const existing = existsSync(REGISTRY_PATH) ? JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry : null
  const { adopted, conflicts } = adoptHandEdits(existing, catalogue.rules, changes)
  if (conflicts.length > 0) {
    for (const conflict of conflicts) console.error(`[import-rules] ${conflict}`)
    process.exit(1)
  }
  const generated = generate(catalogue.rules, changes)
  const registry: Registry = {
    format: 'pretext-rules/1',
    note: `Generated by rebuild/tests/import-rules.ts from the catalogue of ${catalogue.generatedAt} and rule-changes.json; change rules there. ${changes.note}`,
    rules: generated,
    generated: Object.fromEntries(generated.map(rule => [rule.id, hashOf(rule)])),
  }
  const registryText = `${JSON.stringify(registry, null, 1)}\n`
  const changesText = formatChanges(changes)
  const registryMoves = !existsSync(REGISTRY_PATH) || readFileSync(REGISTRY_PATH, 'utf8') !== registryText
  const changesMove = readFileSync(changesPath, 'utf8') !== changesText
  for (const line of adopted) console.log(`[import-rules] ${line}`)
  if (check) {
    console.log(`[import-rules] rules.json ${registryMoves ? 'would change' : 'is current'}; rule-changes.json ${changesMove ? 'would change' : 'is current'}`)
    process.exit(registryMoves || changesMove ? 1 : 0)
  }
  if (changesMove) writeFileSync(changesPath, changesText)
  writeFileSync(REGISTRY_PATH, registryText)
  const current = generated.filter(rule => rule.status === 'current').length
  console.log(`${REGISTRY_PATH}: ${generated.length} rules, ${current} current, ${generated.length - current} removed; ${adopted.length} hand edits moved into ${changesPath}`)
}
