// Probe verdicts as versioned browser facts (TEST-ARCHITECTURE.md §4). A facts file holds one engine build's facts,
// rebuild/facts/<engine>/<engine build>.ndjson, one record per fact and scope.
//
//   bun rebuild/tests/facts.ts extract --output=<probes.json> --engine=blink|webkit|gecko --out=<file> [--build=<engine build>] [--scope=name=value,...]
//   bun rebuild/tests/facts.ts merge --inputs=<file>[,...] --out=<file>
//   bun rebuild/tests/facts.ts diff --before=<file> --after=<file> [--match-scope=name,...] [--out=<report.json>]
//   bun rebuild/tests/facts.ts release --previous=<file> --inputs=<file>[,...] --out=<file> [--report=<report.json>]
//
// extract: every decisive check of a probe output becomes a fact. Blink and Gecko probes return `checks` (name, ok,
// expected, measured, and in Blink a DPR the check applies at); Gecko adds `pre`, preconditions whose failure makes the
// probe's checks precondition-failed; WebKit probes return one `ok`. A check at another DPR than the run's is outside the
// run's scope and isn't evaluated. The build comes from the output (the probe runner records it) or from --build for
// outputs recorded before it did, and the record says which.
// diff: by fact and scope. Unchanged facts carry holdsIn forward; a verdict flip or a missing fact exits 1; changed
// decisive values and new facts are reported. --match-scope compares on those scope fields only, to diff two browsers of one
// engine (webkit-host against Safari).
// release: diff the previous build's file against a new build's merged extracts, and write the new file with holdsIn
// carried forward.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProbeOutput } from '../probes/types.ts'
import { readNdjson, writeNdjson } from './derive.ts'

export const FACT_FORMAT = 'pretext-fact/1'
export type FactVerdict = 'holds' | 'fails' | 'undecided' | 'precondition-failed' | 'errored'
export type Scope = Record<string, string | number>

export type FactRecord = {
  format: typeof FACT_FORMAT
  // `<probe id> :: <check name>`. Provisional: check names still carry measured values in some probes, so a fact can
  // change id between DPRs (research/TEST-ARCHITECTURE.md §4.2).
  fact: string
  // The probe's spec label ('blink-lines H2'), which registry rules cite.
  spec: string
  scope: Scope
  verdict: FactVerdict
  // What the verdict reads: the check's expected and measured values, or a single-verdict probe's raw value.
  decisive: unknown
  // Checks named 'supplementary: …' are shown, never decisive for a rule.
  supplementary: boolean
  probeSha256: string
  env: { engine: string; build: string; buildSource: 'output' | 'given'; os: string | null; userAgent: string }
  observedAt: string
  run: string
  // Builds this fact held in, carried forward by release.
  holdsIn: string[]
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function scopeKey(scope: Scope, fields: readonly string[] | null): string {
  const keys = (fields ?? Object.keys(scope)).slice().sort()
  return keys.map(key => `${key}=${scope[key] ?? ''}`).join(',')
}

type Check = { name: unknown; ok: unknown; expected?: unknown; measured?: unknown; dpr?: unknown }

function verdictOf(ok: unknown): FactVerdict {
  return ok === true ? 'holds' : ok === false ? 'fails' : 'undecided'
}

export function extractFacts(output: ProbeOutput & { build?: { engine: string; os: string } }, run: string, engine: string, givenBuild: string | null, extraScope: Scope): FactRecord[] {
  const build = output.build?.engine ?? givenBuild
  if (build === null) throw new Error(`${run}: the output records no build; pass --build`)
  const env0 = output.envs[0]
  const dpr = env0?.devicePixelRatio ?? 0
  const env = { engine, build, buildSource: output.build === undefined ? 'given' as const : 'output' as const, os: output.build?.os ?? null, userAgent: env0?.userAgent ?? '' }
  const scope: Scope = { browser: output.browser, dpr, ...extraScope }
  const out: FactRecord[] = []
  const record = (entry: ProbeOutput['results'][number], check: string, verdict: FactVerdict, decisive: unknown): void => {
    out.push({
      format: FACT_FORMAT, fact: `${entry.id} :: ${check}`, spec: entry.spec, scope, verdict, decisive, supplementary: check.startsWith('supplementary:'),
      probeSha256: sha256(entry.probe), env, observedAt: output.startedAt, run, holdsIn: verdict === 'holds' ? [build] : [],
    })
  }
  for (const entry of output.results) {
    const result = entry.result
    if (result === null || result.errors.length > 0) {
      record(entry, '(probe)', 'errored', result === null ? 'not observed' : result.errors)
      continue
    }
    const names = new Map<string, number>()
    const unique = (name: string): string => {
      const n = names.get(name) ?? 0
      names.set(name, n + 1)
      return n === 0 ? name : `${name}#${n}`
    }
    for (const observation of result.observations) {
      if ('error' in observation) {
        record(entry, `(${observation.kind})`, 'errored', observation.error)
        continue
      }
      if (observation.kind !== 'script') continue
      const value = observation.value as Record<string, unknown> | null
      if (value === null || typeof value !== 'object') continue
      const pre = Array.isArray(value['pre']) ? value['pre'] as Check[] : []
      const preFailed = pre.some(check => check.ok !== true)
      for (const check of pre) record(entry, unique(`pre: ${String(check.name)}`), verdictOf(check.ok), { expected: check.expected, measured: check.measured })
      if (Array.isArray(value['checks'])) {
        for (const check of value['checks'] as Check[]) {
          if (typeof check.dpr === 'number' && check.dpr !== dpr) continue
          record(entry, unique(String(check.name)), preFailed ? 'precondition-failed' : verdictOf(check.ok), { expected: check.expected, measured: check.measured })
        }
      } else if ('ok' in value) {
        const { ok, ...raw } = value
        record(entry, unique('ok'), verdictOf(ok), raw)
      }
    }
  }
  return out
}

export function mergeFacts(inputs: readonly FactRecord[][]): FactRecord[] {
  const byKey = new Map<string, FactRecord>()
  for (const list of inputs) {
    for (const fact of list) {
      const key = `${fact.fact}\n${scopeKey(fact.scope, null)}`
      if (byKey.has(key)) throw new Error(`fact ${fact.fact} appears twice in scope ${scopeKey(fact.scope, null)}; give the runs distinct --scope values`)
      byKey.set(key, fact)
    }
  }
  return [...byKey.values()].sort((a, b) => (a.fact < b.fact ? -1 : a.fact > b.fact ? 1 : scopeKey(a.scope, null) < scopeKey(b.scope, null) ? -1 : 1))
}

export type FactsDiff = {
  compared: number
  unchanged: number
  decisiveChanged: Array<{ fact: string; scope: string; verdict: FactVerdict; before: unknown; after: unknown }>
  flips: Array<{ fact: string; scope: string; before: FactVerdict; after: FactVerdict; decisiveBefore: unknown; decisiveAfter: unknown }>
  missing: string[]
  added: string[]
}

export function diffFacts(before: readonly FactRecord[], after: readonly FactRecord[], matchScope: readonly string[] | null): FactsDiff {
  const key = (fact: FactRecord): string => `${fact.fact}\n${scopeKey(fact.scope, matchScope)}`
  const afterByKey = new Map(after.map(fact => [key(fact), fact]))
  const beforeKeys = new Set(before.map(key))
  const diff: FactsDiff = { compared: 0, unchanged: 0, decisiveChanged: [], flips: [], missing: [], added: [] }
  for (const a of before) {
    const b = afterByKey.get(key(a))
    const scope = scopeKey(a.scope, matchScope)
    if (b === undefined) {
      diff.missing.push(`${a.fact} [${scope}]`)
      continue
    }
    diff.compared++
    if (a.verdict !== b.verdict) diff.flips.push({ fact: a.fact, scope, before: a.verdict, after: b.verdict, decisiveBefore: a.decisive, decisiveAfter: b.decisive })
    else if (sha256(a.decisive) !== sha256(b.decisive)) diff.decisiveChanged.push({ fact: a.fact, scope, verdict: a.verdict, before: a.decisive, after: b.decisive })
    else diff.unchanged++
  }
  for (const b of after) if (!beforeKeys.has(key(b))) diff.added.push(`${b.fact} [${scopeKey(b.scope, matchScope)}]`)
  return diff
}

// The new build's facts with holdsIn carried forward from the previous file where the verdict still holds.
export function carryForward(previous: readonly FactRecord[], next: readonly FactRecord[]): FactRecord[] {
  const byKey = new Map(previous.map(fact => [`${fact.fact}\n${scopeKey(fact.scope, null)}`, fact]))
  return next.map(fact => {
    const old = byKey.get(`${fact.fact}\n${scopeKey(fact.scope, null)}`)
    if (old === undefined || fact.verdict !== 'holds' || old.verdict !== 'holds') return fact
    return { ...fact, holdsIn: [...new Set([...old.holdsIn, ...fact.holdsIn])] }
  })
}

function summarize(diff: FactsDiff): string {
  return `compared ${diff.compared}: unchanged ${diff.unchanged}, decisive values changed ${diff.decisiveChanged.length}, verdict flips ${diff.flips.length}; missing ${diff.missing.length}, new ${diff.added.length}`
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  const args = new Map(rest.map(arg => {
    const match = /^--([a-z-]+)=(.*)$/s.exec(arg)
    if (match === null) throw new Error(`Unknown argument ${arg}`)
    return [match[1]!, match[2]!] as const
  }))
  const need = (name: string): string => {
    const value = args.get(name)
    if (value === undefined) throw new Error(`--${name} is required`)
    return value
  }
  const list = (name: string): string[] => need(name).split(',').filter(part => part !== '')
  switch (command) {
    case 'extract': {
      const outputPath = resolve(need('output'))
      const scope: Scope = {}
      for (const part of (args.get('scope') ?? '').split(',').filter(value => value !== '')) {
        const [name, value] = part.split('=')
        if (name === undefined || value === undefined) throw new Error(`--scope ${part}: expected name=value`)
        scope[name] = Number.isFinite(Number(value)) ? Number(value) : value
      }
      const facts = extractFacts(JSON.parse(readFileSync(outputPath, 'utf8')) as ProbeOutput, outputPath, need('engine'), args.get('build') ?? null, scope)
      writeNdjson(resolve(need('out')), facts)
      const counts: Record<string, number> = {}
      for (const fact of facts) counts[fact.verdict] = (counts[fact.verdict] ?? 0) + 1
      console.log(`${need('out')}: ${facts.length} facts ${JSON.stringify(counts)}`)
      break
    }
    case 'merge': {
      const merged = mergeFacts(list('inputs').map(path => readNdjson<FactRecord>(resolve(path))))
      writeNdjson(resolve(need('out')), merged)
      console.log(`${need('out')}: ${merged.length} facts`)
      break
    }
    case 'diff': {
      const matchScope = args.get('match-scope')
      const diff = diffFacts(readNdjson<FactRecord>(resolve(need('before'))), readNdjson<FactRecord>(resolve(need('after'))), matchScope === undefined ? null : matchScope.split(','))
      if (args.get('out') !== undefined) writeFileSync(resolve(need('out')), `${JSON.stringify(diff, null, 1)}\n`)
      console.log(summarize(diff))
      for (const flip of diff.flips.slice(0, 20)) console.log(`  flip ${flip.fact} [${flip.scope}]: ${flip.before} -> ${flip.after}`)
      process.exit(diff.flips.length > 0 || diff.missing.length > 0 ? 1 : 0)
      break
    }
    case 'release': {
      const previous = readNdjson<FactRecord>(resolve(need('previous')))
      const next = carryForward(previous, mergeFacts(list('inputs').map(path => readNdjson<FactRecord>(resolve(path)))))
      const diff = diffFacts(previous, next, null)
      writeNdjson(resolve(need('out')), next)
      if (args.get('report') !== undefined) writeFileSync(resolve(need('report')), `${JSON.stringify(diff, null, 1)}\n`)
      console.log(`${need('out')}: ${next.length} facts; against ${need('previous')}: ${summarize(diff)}`)
      for (const flip of diff.flips.slice(0, 20)) console.log(`  flip ${flip.fact} [${flip.scope}]: ${flip.before} -> ${flip.after}`)
      process.exit(diff.flips.length > 0 || diff.missing.length > 0 ? 1 : 0)
      break
    }
    default:
      throw new Error('Usage: bun rebuild/tests/facts.ts extract|merge|diff|release ...')
  }
}
