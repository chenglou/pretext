// The citation and prose ledger (research/ARCHITECTURE-PLAN-2.md §7, check 6). A rewrite of rebuild/src must keep every
// source citation, probe name, spec reference, rule annotation and gap prose string the correctness line holds: the rows
// prove what the recorded sets execute, and nothing else proves that a comment naming line_breaker.cc:45-56, or the prose
// of a gap no recorded case raises, came through.
//
//   bun rebuild/tools/citations.ts check  [--root=<tree>|--at=<commit>] [--out=<report.json>]   # the one command; exit 1 on a loss
//   bun rebuild/tools/citations.ts record [--at=<commit>]                                       # writes citations/line.json
//   bun rebuild/tools/citations.ts accept --owner=shared|blink|webkit|gecko --reason=<text> (--match=<substring>|--all)
//   bun rebuild/tools/citations.ts diff <commit> <commit>                                       # the second against the first
//
// What it holds (citations/line.json, recorded once at the correctness line and never edited):
// - a multiset of tokens read from every comment and every string of rebuild/src: engine source citations with their
//   lines (`line_breaker.cc:3937-3955`, and `:245-252` after it as `line_breaker.cc:245-252`), engine source files named
//   without lines, qualified engine names (`LineInfo::ComputeWidth`), documents with their sections (`DESIGN.md §7`), bare
//   sections, repository and artifact paths, probe names (`gecko-port F8`), the short ids probes, specs and Unicode rules
//   go by (`F8`, `H8`, `LB30`), case ids, URLs, Unicode and CSS standards, and `// rule <id>` annotations;
// - every string and template literal with a space and a letter in it, outside tests and generated data: the gap details,
//   the painter's limit details and the error messages, with `${...}` cut to `${}`; and every literal that is a GapName
//   or a PainterLimitName, so a gap site that goes takes a count with it;
// - the sha256 of every file under a `generated/` folder, so moved data is the same data;
// - from tests/rules.json, the unit-test pointers that are stale at the line, so a new stale pointer shows.
// Counts are kept per scope (shared, blink, webkit, gecko) and apart for tests, but a token is lost only when its total
// over the scopes falls: a multiset, so a move passes, between files and between scopes (the moves are listed), and a
// deletion or a rewording fails. Tests count apart from the rest, so a citation that leaves the code isn't made up for by
// a test that names it.
//
// A loss that is meant (a comment about the string memo goes with the memo; five sites that raised one gap become one
// function) is accepted by name with a reason in citations/accepted-<owner>.json, one file an owner so parallel owners
// never edit the same file. An owner who moves a test updates its engine's pointers in tests/rules.json in the same commit.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const REPO = resolve(import.meta.dir, '../..')
const LEDGER_DIR = join(import.meta.dir, 'citations')
const LEDGER_PATH = join(LEDGER_DIR, 'line.json')
const FORMAT = 'pretext-citations/1'

const SCOPES = ['shared', 'blink', 'webkit', 'gecko'] as const
type Scope = typeof SCOPES[number]
const KINDS = ['source', 'file', 'symbol', 'doc', 'section', 'path', 'probe', 'id', 'case', 'url', 'standard', 'rule', 'prose', 'gap-name', 'limit-name', 'generated'] as const
type Kind = typeof KINDS[number]
type Where = 'code' | 'tests'

// One token's counts: per scope, outside tests and in them.
type Counts = Record<Where, Record<Scope, number>>
type Entry = { kind: Kind; token: string; counts: Counts }
export type Ledger = {
  format: typeof FORMAT
  commit: string
  // The members of GapName (src/model.ts) and PainterLimitName (src/paint.ts) at the line: a later tree is read with
  // these names wherever its types have moved.
  gapNames: string[]
  limitNames: string[]
  entries: Entry[]
  // tests/rules.json pointers of current rules whose test the tree doesn't hold.
  stalePointers: string[]
}
type Accepted = { kind: Kind; token: string; where: Where; count: number; reason: string }
export type Occurrence = { kind: Kind; token: string; where: Where; scope: Scope; file: string; line: number }

function fail(text: string): never {
  console.error(`[citations] ${text}`)
  finish(2)
}

function finish(code: number): never {
  for (let i = 0; i < scratch.length; i++) rmSync(scratch[i]!, { recursive: true, force: true })
  process.exit(code)
}

// ---- Reading a tree ----

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

function scopeOf(path: string): Scope {
  const match = /(?:^|\/)engines\/(blink|webkit|gecko)\//.exec(path)
  return match === null ? 'shared' : match[1] as Scope
}

// The tree of a commit, under a scratch folder that is removed when the command ends: rebuild/src and the registry.
const scratch: string[] = []
function treeAt(commit: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'citations-'))
  scratch.push(dir)
  const paths = ['rebuild/src']
  if (execFileSync('git', ['ls-tree', '--name-only', commit, 'rebuild/tests/rules.json'], { cwd: REPO, encoding: 'utf8' }).trim() !== '') paths.push('rebuild/tests/rules.json')
  const archive = execFileSync('git', ['archive', commit, ...paths], { cwd: REPO, maxBuffer: 1 << 30 })
  execFileSync('tar', ['-x', '-C', dir], { input: archive })
  return dir
}

// ---- Tokens of a comment block or a string ----

const SOURCE_EXTENSIONS = 'cc|cpp|h|hh|hpp|mm|rs|c|py|txt|idl|json5|yaml|tq|toml|tsv|dat|brk'
// A file with lines, or lines alone that continue the file before them: `, :245-252`, `and :1328-1330`, `, 100-101`.
const SOURCE = new RegExp(`([A-Za-z_][\\w+./-]*\\.[A-Za-z0-9]+):(\\d+(?:-\\d+)?)|(?<=[\\s(,;]):(\\d+(?:-\\d+)?)\\b|(?<=\\d, )(\\d+-\\d+)\\b`, 'g')
const FILE = new RegExp(`\\b[A-Za-z_][\\w+./-]*\\.(?:${SOURCE_EXTENSIONS})\\b(?!:\\d)`, 'g')
const SYMBOL = /\b[A-Za-z_]\w*(?:::[A-Za-z_~]\w*)+/g
// A document by its file name, and a section with the name before it: `specs/blink-canvas.md §1.5`, `blink-gaps §3.4`,
// `CSS 2.1 §9.5`. A section right after another (`DESIGN.md §1 and §2`, `§3.4-§3.5`) takes the same name.
const DOC = /[\w./-]+\.md\b/g
const SECTION = /(?:((?:[A-Z][A-Za-z]* ){1,3})?([^\s§]+) )?§(\w(?:[\w.]*\w)?)/g
const NOT_A_NAME = new Set(['and', 'or', 'to', 'see', 'in', 'of', 'the', 'by', 'at'])
const PATH = /(?:\.artifacts|rebuild|specs|research|data|probes|lab|tests|tools|facts|platform-bugs)\/[\w./-]*[\w-]/g
const PROBE = /\b([a-z]+(?:-[a-z0-9]+)+) ([A-Z]{1,2}\d{1,3}[a-z]?)\b|\bprobes-(?:chrome|safari|firefox)(?: correction \d+)?/g
const ID = /\b[A-Z]{1,2}\d{1,3}[a-z]?\b/g
const CASE = /\bc-[0-9a-f]{16}\b/g
const URL_PATTERN = /https?:\/\/[^\s)'"`>\]]+/g
const STANDARD = /\bU(?:AX|TS|TR) ?#?\d+|\bCSS (?:[A-Z][a-z]+ )*\d(?:\.\d)?\b|\bcss-[a-z]+-\d\b/g
// tests/coverage.ts reads the annotations with this pattern.
const RULE = /\/\/\s*rule\s+([a-z0-9-]+\/[a-z0-9./-]+)/g

export type Emit = (kind: Kind, token: string, offset: number) => void

export function blockTokens(text: string, emit: Emit): void {
  let file: string | null = null
  for (const match of text.matchAll(SOURCE)) {
    if (match[1] !== undefined) {
      file = match[1]
      emit('source', `${file}:${match[2]!}`, match.index)
    } else if (file !== null) {
      emit('source', `${file}:${match[3] ?? match[4]!}`, match.index)
    }
  }
  for (const match of text.matchAll(FILE)) emit('file', match[0], match.index)
  for (const match of text.matchAll(SYMBOL)) emit('symbol', match[0], match.index)
  for (const match of text.matchAll(DOC)) emit('doc', match[0], match.index)
  // The name the last section had, and where that section ended.
  let name: string | null = null
  let listEnd = -1
  for (const match of text.matchAll(SECTION)) {
    const before = (match[2] ?? '').replace(/^[(\[{"'`]+/, '')
    // A number is a version of the words before it: `CSS Text 3 §5.1`.
    if (/^[A-Za-z0-9][\w./-]*$/.test(before) && !NOT_A_NAME.has(before.toLowerCase())) name = /^[\d.]+$/.test(before) ? `${match[1] ?? ''}${before}` : before
    else if (match.index - listEnd > 6) name = null
    emit('section', name === null ? `§${match[3]!}` : `${name} §${match[3]!}`, match.index)
    listEnd = match.index + match[0].length
  }
  for (const match of text.matchAll(PATH)) if (!match[0].endsWith('.md')) emit('path', match[0], match.index)
  for (const match of text.matchAll(PROBE)) emit('probe', match[0], match.index)
  for (const match of text.matchAll(ID)) emit('id', match[0], match.index)
  for (const match of text.matchAll(CASE)) emit('case', match[0], match.index)
  for (const match of text.matchAll(URL_PATTERN)) emit('url', match[0], match.index)
  for (const match of text.matchAll(STANDARD)) emit('standard', match[0], match.index)
}

// ---- One file ----

function isProse(text: string): boolean {
  return text.includes(' ') && /[A-Za-z]/.test(text)
}

function fileOccurrences(root: string, path: string, names: { gap: ReadonlySet<string>; limit: ReadonlySet<string> }, out: Occurrence[]): void {
  const text = readFileSync(path, 'utf8')
  const file = relative(root, path)
  const scope = scopeOf(file)
  const where: Where = file.endsWith('.test.ts') ? 'tests' : 'code'
  const generated = /(?:^|\/)generated\//.test(file)
  if (generated) out.push({ kind: 'generated', token: createHash('sha256').update(text).digest('hex'), where, scope, file, line: 1 })
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const lineOf = (offset: number): number => source.getLineAndCharacterOfPosition(offset).line + 1
  const at = (offset: number): Pick<Occurrence, 'where' | 'scope' | 'file' | 'line'> => ({ where, scope, file, line: lineOf(offset) })

  const comments: Array<{ pos: number; end: number }> = []
  const seen = new Set<number>()
  const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
    if (ranges === undefined) return
    for (const range of ranges) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      comments.push({ pos: range.pos, end: range.end })
    }
  }
  // Every token, punctuation included: a comment is the trivia of the token after it or before it on its line.
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const specifier = ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))
      // Generated data holds its tables as strings of hundreds of thousands of units: its comments are read, its hash is
      // kept, and its strings are left alone.
      if (!specifier && !generated) {
        const value = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => '${}' + span.literal.text).join('') : node.text
        const here = at(node.getStart())
        blockTokens(value, (kind, token) => { out.push({ kind, token, ...here }) })
        if (where === 'code') {
          if (isProse(value)) out.push({ kind: 'prose', token: value, ...here })
          if (names.gap.has(value)) out.push({ kind: 'gap-name', token: value, ...here })
          if (names.limit.has(value)) out.push({ kind: 'limit-name', token: value, ...here })
        }
      }
    }
    const children = node.getChildren(source)
    if (children.length === 0) {
      collect(ts.getLeadingCommentRanges(text, node.getFullStart()))
      collect(ts.getTrailingCommentRanges(text, node.getEnd()))
    }
    for (let i = 0; i < children.length; i++) visit(children[i]!)
  }
  visit(source)
  comments.sort((a, b) => a.pos - b.pos)
  // Consecutive comment lines are one block, read without their markers and line ends, so a citation's lines or a
  // document's section can continue on the next line. `origin` maps the block's text back to the file.
  for (let i = 0; i < comments.length;) {
    let end = i + 1
    while (end < comments.length && /^[ \t]*\r?\n[ \t]*$/.test(text.slice(comments[end - 1]!.end, comments[end]!.pos))) end++
    let block = ''
    const origin: number[] = []
    for (let k = i; k < end; k++) {
      const raw = text.slice(comments[k]!.pos, comments[k]!.end)
      for (const match of raw.matchAll(RULE)) out.push({ kind: 'rule', token: match[1]!, ...at(comments[k]!.pos + match.index) })
      const lines = raw.split('\n')
      let offset = comments[k]!.pos
      for (let l = 0; l < lines.length; l++) {
        const marker = /^\s*(?:\/\/+|\/\*+|\*+\/?)?\s?/.exec(lines[l]!)![0].length
        const body = lines[l]!.slice(marker).replace(/\s*\*\/\s*$/, '')
        for (let c = 0; c < body.length; c++) origin.push(offset + marker + c)
        origin.push(offset + lines[l]!.length)
        block += `${body} `
        offset += lines[l]!.length + 1
      }
    }
    blockTokens(block, (kind, token, offset) => { out.push({ kind, token, ...at(origin[offset]!) }) })
    i = end
  }
}

// The members of an exported union of string literals.
function unionMembers(path: string, name: string): string[] {
  if (!existsSync(path)) return []
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const out: string[] = []
  source.forEachChild(node => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== name) return
    const visit = (type: ts.Node): void => {
      if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) out.push(type.literal.text)
      else type.forEachChild(visit)
    }
    visit(node.type)
  })
  return out
}

// ---- The registry's pointers ----

// tests/coverage.ts testPresent, under a root: 'path :: test name' is present when the file exists and holds the name, or
// each part of a 'describe block > test name'; a bare path when the file exists.
function pointerPresent(rebuild: string, entry: string): boolean {
  const separator = entry.indexOf(' :: ')
  const file = join(rebuild, separator === -1 ? entry : entry.slice(0, separator))
  if (!existsSync(file)) return false
  if (separator === -1) return true
  const name = entry.slice(separator + 4)
  const text = readFileSync(file, 'utf8')
  return text.includes(name) || name.split(' > ').every(part => text.includes(part))
}

function stalePointers(root: string): string[] {
  const path = join(root, 'rebuild/tests/rules.json')
  if (!existsSync(path)) return []
  const registry = JSON.parse(readFileSync(path, 'utf8')) as { rules: Array<{ id: string; status: string; tests: string[] }> }
  const out: string[] = []
  for (const rule of registry.rules) {
    if (rule.status !== 'current') continue
    for (const entry of rule.tests) if (!pointerPresent(join(root, 'rebuild'), entry)) out.push(`${rule.id} -> ${entry}`)
  }
  return out.sort()
}

// ---- A tree's occurrences, and their counts ----

function occurrencesOf(root: string, names: { gap: readonly string[]; limit: readonly string[] }): Occurrence[] {
  const src = join(root, 'rebuild/src')
  if (!existsSync(src)) fail(`${src} doesn't exist`)
  const sets = { gap: new Set(names.gap), limit: new Set(names.limit) }
  const out: Occurrence[] = []
  for (const path of sourceFiles(src)) fileOccurrences(src, path, sets, out)
  return out
}

const emptyCounts = (): Counts => ({ code: { shared: 0, blink: 0, webkit: 0, gecko: 0 }, tests: { shared: 0, blink: 0, webkit: 0, gecko: 0 } })
const keyOf = (kind: Kind, token: string): string => `${kind}\n${token}`
const total = (counts: Record<Scope, number>): number => counts.shared + counts.blink + counts.webkit + counts.gecko

export function countsOf(occurrences: readonly Occurrence[]): Map<string, Entry> {
  const out = new Map<string, Entry>()
  for (const value of occurrences) {
    let entry = out.get(keyOf(value.kind, value.token))
    if (entry === undefined) {
      entry = { kind: value.kind, token: value.token, counts: emptyCounts() }
      out.set(keyOf(value.kind, value.token), entry)
    }
    entry.counts[value.where][value.scope]++
  }
  return out
}

function ledgerOf(root: string, commit: string): Ledger {
  const gapNames = unionMembers(join(root, 'rebuild/src/model.ts'), 'GapName')
  const limitNames = unionMembers(join(root, 'rebuild/src/paint.ts'), 'PainterLimitName')
  const entries = [...countsOf(occurrencesOf(root, { gap: gapNames, limit: limitNames })).values()]
  entries.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0))
  return { format: FORMAT, commit, gapNames, limitNames, entries, stalePointers: stalePointers(root) }
}

// One entry a line, zero counts left out, so the file diffs by token.
function writeLedger(path: string, ledger: Ledger): void {
  const compact = (counts: Record<Scope, number>): Partial<Record<Scope, number>> => Object.fromEntries(SCOPES.filter(scope => counts[scope] > 0).map(scope => [scope, counts[scope]]))
  const lines = ledger.entries.map(entry => JSON.stringify([entry.kind, entry.token, compact(entry.counts.code), compact(entry.counts.tests)]))
  const head = { format: ledger.format, commit: ledger.commit, gapNames: ledger.gapNames, limitNames: ledger.limitNames, stalePointers: ledger.stalePointers }
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(head).slice(0, -1)},"entries":[\n${lines.join(',\n')}\n]}\n`)
}

function readLedger(path: string): Ledger {
  if (!existsSync(path)) fail(`${relative(REPO, path)} doesn't exist: record the ledger at the correctness line first`)
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Omit<Ledger, 'entries'> & { entries: Array<[Kind, string, Partial<Record<Scope, number>>, Partial<Record<Scope, number>>]> }
  if (raw.format !== FORMAT) fail(`${path}: format ${JSON.stringify(raw.format)}`)
  return { ...raw, entries: raw.entries.map(([kind, token, code, tests]) => ({ kind, token, counts: { code: { ...emptyCounts().code, ...code }, tests: { ...emptyCounts().tests, ...tests } } })) }
}

const acceptedPath = (owner: Scope): string => join(LEDGER_DIR, `accepted-${owner}.json`)

function readAccepted(): Accepted[] {
  const out: Accepted[] = []
  for (const owner of SCOPES) if (existsSync(acceptedPath(owner))) out.push(...JSON.parse(readFileSync(acceptedPath(owner), 'utf8')) as Accepted[])
  return out
}

// ---- Comparing ----

type Loss = { kind: Kind; token: string; where: Where; before: number; after: number; accepted: number; wasIn: Partial<Record<Scope, number>> }
type Report = {
  format: 'pretext-citations-check/1'
  ledgerCommit: string
  tokens: { before: number; after: number; added: number }
  losses: Loss[]
  acceptedLosses: number
  // Accepted entries the tree no longer needs: the token is back, or fewer went than the entry says.
  unusedAcceptances: Accepted[]
  // Tokens whose total holds while their scopes changed: moves between shared code and the engines.
  moved: Array<{ kind: Kind; token: string; where: Where; before: Partial<Record<Scope, number>>; after: Partial<Record<Scope, number>> }>
  newStalePointers: string[]
}

const nonZero = (counts: Record<Scope, number>): Partial<Record<Scope, number>> => Object.fromEntries(SCOPES.filter(scope => counts[scope] > 0).map(scope => [scope, counts[scope]]))

export function compare(ledger: Ledger, accepted: readonly Accepted[], now: Map<string, Entry>, staleNow: readonly string[]): Report {
  const report: Report = { format: 'pretext-citations-check/1', ledgerCommit: ledger.commit, tokens: { before: 0, after: 0, added: 0 }, losses: [], acceptedLosses: 0, unusedAcceptances: [], moved: [], newStalePointers: [] }
  const allowance = new Map<string, number>()
  for (const value of accepted) allowance.set(`${value.where}\n${keyOf(value.kind, value.token)}`, (allowance.get(`${value.where}\n${keyOf(value.kind, value.token)}`) ?? 0) + value.count)
  const used = new Map<string, number>()
  for (const entry of ledger.entries) {
    const current = now.get(keyOf(entry.kind, entry.token))?.counts ?? emptyCounts()
    for (const where of ['code', 'tests'] as const) {
      const before = total(entry.counts[where])
      const after = total(current[where])
      report.tokens.before += before
      if (after < before) {
        const allowed = Math.min(before - after, allowance.get(`${where}\n${keyOf(entry.kind, entry.token)}`) ?? 0)
        used.set(`${where}\n${keyOf(entry.kind, entry.token)}`, allowed)
        report.acceptedLosses += allowed
        if (after + allowed < before) report.losses.push({ kind: entry.kind, token: entry.token, where, before, after, accepted: allowed, wasIn: nonZero(entry.counts[where]) })
      } else if (before > 0 && SCOPES.some(scope => current[where][scope] < entry.counts[where][scope])) {
        report.moved.push({ kind: entry.kind, token: entry.token, where, before: nonZero(entry.counts[where]), after: nonZero(current[where]) })
      }
    }
  }
  const known = new Set(ledger.entries.map(entry => keyOf(entry.kind, entry.token)))
  for (const entry of now.values()) {
    const count = total(entry.counts.code) + total(entry.counts.tests)
    report.tokens.after += count
    if (!known.has(keyOf(entry.kind, entry.token))) report.tokens.added += count
  }
  for (const value of accepted) {
    const key = `${value.where}\n${keyOf(value.kind, value.token)}`
    const left = used.get(key) ?? 0
    if (left >= value.count) used.set(key, left - value.count)
    else report.unusedAcceptances.push(value)
  }
  const staleBefore = new Set(ledger.stalePointers)
  report.newStalePointers = staleNow.filter(pointer => !staleBefore.has(pointer))
  return report
}

const short = (token: string): string => (token.length > 140 ? `${token.slice(0, 137)}...` : token)

function print(report: Report, ledgerOccurrences: () => Occurrence[]): void {
  console.log(`[citations] against the ledger of ${report.ledgerCommit.slice(0, 12)}: ${report.tokens.before} tokens then, ${report.tokens.after} now (${report.tokens.added} of them new); ${report.losses.length} lost, ${report.acceptedLosses} losses accepted by name, ${report.moved.length} moved between scopes, ${report.newStalePointers.length} new stale test pointers`)
  if (report.losses.length > 0) {
    // Where each lost token stood at the line, from the ledger commit's own tree.
    const places = new Map<string, string[]>()
    for (const value of ledgerOccurrences()) {
      const list = places.get(`${value.where}\n${keyOf(value.kind, value.token)}`) ?? []
      list.push(`${value.file}:${value.line}`)
      places.set(`${value.where}\n${keyOf(value.kind, value.token)}`, list)
    }
    const byKind = new Map<Kind, Loss[]>()
    for (const loss of report.losses) byKind.set(loss.kind, [...(byKind.get(loss.kind) ?? []), loss])
    for (const [kind, losses] of byKind) {
      console.log(`  lost ${kind}: ${losses.length}`)
      for (const loss of losses.slice(0, 40)) {
        console.log(`    ${JSON.stringify(short(loss.token))} ${loss.where === 'tests' ? 'in tests ' : ''}${loss.before} -> ${loss.after}${loss.accepted > 0 ? ` (${loss.accepted} accepted)` : ''}; at the line: ${(places.get(`${loss.where}\n${keyOf(loss.kind, loss.token)}`) ?? []).join(', ')}`)
      }
      if (losses.length > 40) console.log(`    … ${losses.length - 40} more in the report`)
    }
  }
  for (const pointer of report.newStalePointers.slice(0, 40)) console.log(`  stale test pointer in tests/rules.json: ${pointer}`)
  for (const value of report.unusedAcceptances) console.log(`  accepted but not lost (remove the entry): ${value.kind} ${JSON.stringify(short(value.token))}`)
  if (report.moved.length > 0) {
    const flows = new Map<string, number>()
    for (const value of report.moved) {
      const key = `${JSON.stringify(value.before)} -> ${JSON.stringify(value.after)}`
      flows.set(key, (flows.get(key) ?? 0) + 1)
    }
    console.log('  moved between scopes (kept, listed for the reader):')
    for (const [flow, n] of [...flows].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(n).padStart(5)}  ${flow}`)
  }
}

// ---- Commands ----

const options = new Map<string, string>()
const flags = new Set<string>()
const positional: string[] = []

function treeRoot(): { root: string; commit: string } {
  const at = options.get('at')
  if (at !== undefined) return { root: treeAt(at), commit: execFileSync('git', ['rev-parse', at], { cwd: REPO, encoding: 'utf8' }).trim() }
  const root = resolve(options.get('root') ?? REPO)
  return { root, commit: `working tree of ${root}` }
}

function check(ledger: Ledger, accepted: readonly Accepted[], root: string): number {
  const now = countsOf(occurrencesOf(root, { gap: ledger.gapNames, limit: ledger.limitNames }))
  const report = compare(ledger, accepted, now, stalePointers(root))
  print(report, () => occurrencesOf(treeAt(ledger.commit), { gap: ledger.gapNames, limit: ledger.limitNames }))
  const out = options.get('out')
  if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify(report, null, 1)}\n`)
  return report.losses.length > 0 || report.newStalePointers.length > 0 ? 1 : 0
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  for (const raw of rest) {
    const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(raw)
    if (match === null) positional.push(raw)
    else if (match[2] === undefined) flags.add(match[1]!)
    else options.set(match[1]!, match[2])
  }
  switch (command) {
    case 'record': {
      if (existsSync(LEDGER_PATH) && !flags.has('force')) fail(`${relative(REPO, LEDGER_PATH)} exists. The ledger is the correctness line's: a meant loss is accepted by name (accept), and --force records it again`)
      const { root, commit } = treeRoot()
      if (options.get('at') === undefined) fail('record takes --at=<commit>: the ledger names the commit it was read from')
      const ledger = ledgerOf(root, commit)
      writeLedger(LEDGER_PATH, ledger)
      const perKind = KINDS.map(kind => `${kind} ${ledger.entries.filter(entry => entry.kind === kind).reduce((sum, entry) => sum + total(entry.counts.code) + total(entry.counts.tests), 0)}`)
      console.log(`[citations] recorded ${ledger.entries.length} distinct tokens of ${commit.slice(0, 12)} into ${relative(REPO, LEDGER_PATH)}: ${perKind.join(', ')}; ${ledger.stalePointers.length} stale test pointers`)
      finish(0)
    }
    case 'check': {
      finish(check(readLedger(resolve(options.get('ledger') ?? LEDGER_PATH)), readAccepted(), treeRoot().root))
    }
    case 'diff': {
      if (positional.length !== 2) fail('diff takes two commits')
      const before = treeAt(positional[0]!)
      const ledger = ledgerOf(before, execFileSync('git', ['rev-parse', positional[0]!], { cwd: REPO, encoding: 'utf8' }).trim())
      finish(check(ledger, [], treeAt(positional[1]!)))
    }
    case 'accept': {
      const owner = options.get('owner') as Scope | undefined
      const reason = options.get('reason') ?? ''
      if (owner === undefined || !SCOPES.includes(owner)) fail('--owner must be shared, blink, webkit or gecko')
      if (reason === '') fail('--reason=<why the loss is meant> is required')
      const matchText = options.get('match')
      if (matchText === undefined && !flags.has('all')) fail('--match=<substring of the token> or --all')
      const ledger = readLedger(LEDGER_PATH)
      const now = countsOf(occurrencesOf(treeRoot().root, { gap: ledger.gapNames, limit: ledger.limitNames }))
      const losses = compare(ledger, readAccepted(), now, []).losses.filter(loss => matchText === undefined || loss.token.includes(matchText))
      const path = acceptedPath(owner)
      const list = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Accepted[] : []
      for (const loss of losses) list.push({ kind: loss.kind, token: loss.token, where: loss.where, count: loss.before - loss.after - loss.accepted, reason })
      mkdirSync(LEDGER_DIR, { recursive: true })
      writeFileSync(path, `[\n${list.map(value => JSON.stringify(value)).join(',\n')}\n]\n`)
      console.log(`[citations] accepted ${losses.length} losses in ${relative(REPO, path)}`)
      finish(0)
    }
    default: fail('Usage: bun rebuild/tools/citations.ts check|record|accept|diff (the file comment has the options)')
  }
}
