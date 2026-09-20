// The review's timing of the Gecko port's free fixes in pinned Firefox, by other methods than tools/prof-probe.ts, on the
// same loops (tools/prof-entry.ts) and the same messages (bench/cases.ts buildChat).
// - `pairs`: prof-probe.ts lets every checkout take turns inside ONE page. Here every checkout gets a FRESH page in every
//   round, a document of its own that the runner loads by reloading, so no checkout runs beside another's compiled code,
//   garbage or kept contexts. A round is one page per checkout of PROF_TREES, forward on even rounds and backward on odd
//   ones; a pair is one round's two pages. A page warms up over the first 1,000 messages of each set, then times
//   PROF_PASSES passes from scratch of each set (one list of contexts a pass, count mode, 320 px) and the resize case
//   once a set (prepared and filled at 320 px untimed, then 260, 380 and 440 px timed). A page's number for a scenario is
//   its fastest pass.
// - `repeat`: the browser's share by a method prof-probe.ts doesn't have. A Canvas that asks the real one every question
//   k times (and reads each answer's width) makes a pass cost `own + k * calls`: the slope over k = 1, 2, 3 is what the
//   pass's calls cost in the browser, with nothing recorded and nothing replayed. It counts what grows with the calls
//   (measureText, the width read, a TextMetrics object to free) and misses whatever a first ask costs more than a repeat,
//   so it is a lower bound where the stand-in's difference is an upper one. One page per checkout of PROF_REPEAT_TREES,
//   the modes (the real Canvas as it is, k = 1, 2, 3) taking turns round by round.
//
//   PROF_TREES="base=<checkout>,head=<checkout>" PROF_REPEAT_TREES=base PROF_SECTIONS=pairs,repeat PROF_ROUNDS=12 \
//   python3 .artifacts/session/with-browser-lock.py <job> --browser=all --exclusive -- \
//     bun rebuild/probes/runner.ts --browser=firefox --probes=rebuild/tools/prof-critic-probe.ts --out=<dir> \
//       --probe-timeout-ms=600000 --stall-ms=600000
// A checkout needs rebuild/src and rebuild/tools/prof-entry.ts. PROF_SETS=mix,latin, PROF_MESSAGES=10000, PROF_PASSES=2,
// PROF_REPEAT_ROUNDS=12. `bun rebuild/tools/prof-critic-probe.ts <out>/firefox-probes.json` prints the summary.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Probe } from '../probes/types.ts'
import { buildChat } from '../bench/cases.ts'

const PAIRS_BODY = String.raw`
const lib = globalThis.prof;
const sets = Object.keys(SETS);
const WIDTHS = [260, 380, 440];
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const env = lib.environment();
const paragraphs = {};
for (const set of sets) paragraphs[set] = SETS[set].map((message) => lib.paragraphOf(message.parts));
const out = { section: 'pairs', label: CONFIG.label, round: CONFIG.round, userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, messages: CONFIG.messages, rows: [] };
for (const set of sets) lib.scratch(paragraphs[set].slice(0, 1000), env, 320);
for (let pass = 0; pass < CONFIG.passes; pass++) {
  for (const set of sets) {
    await pause();
    const t0 = performance.now();
    const lines = lib.scratch(paragraphs[set], env, 320);
    out.rows.push({ scenario: 'scratch', set, pass, ms: performance.now() - t0, lines });
  }
}
for (const set of sets) {
  const prepared = lib.prepareAll(paragraphs[set], env, 320);
  await pause();
  const t0 = performance.now();
  const lines = lib.relayout(prepared, WIDTHS);
  out.rows.push({ scenario: 'resize', set, pass: 0, ms: performance.now() - t0, lines });
}
return out;
`

const REPEAT_BODY = String.raw`
const lib = globalThis.prof;
const Real = globalThis.OffscreenCanvas;
const sets = Object.keys(SETS);
const WIDTHS = [260, 380, 440];
const ATTRIBUTES = ['lang', 'font', 'letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering', 'direction'];
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
let calls = 0;
// A Canvas whose contexts ask the real one every question k times; the library reads the last answer.
function repeating(k) {
  class Context {
    constructor() { this.real = new Real(1, 1).getContext('2d'); }
    measureText(text) {
      calls++;
      let sum = 0;
      for (let i = 1; i < k; i++) sum += this.real.measureText(text).width;
      return this.real.measureText(text);
    }
  }
  for (const name of ATTRIBUTES) Object.defineProperty(Context.prototype, name, { set(value) { this.real[name] = value; } });
  globalThis.OffscreenCanvas = class { getContext() { return new Context(); } };
}
const env = lib.environment();
const paragraphs = {};
for (const set of sets) paragraphs[set] = SETS[set].map((message) => lib.paragraphOf(message.parts));
const out = { section: 'repeat', label: CONFIG.label, userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, messages: CONFIG.messages, rows: [] };
const modes = [0, 1, 2, 3];
for (const k of modes) for (const set of sets) {
  if (k > 0) repeating(k);
  lib.scratch(paragraphs[set].slice(0, 1000), env, 320);
  lib.realCanvas();
}
for (let round = 0; round < CONFIG.rounds; round++) {
  for (let m = 0; m < modes.length; m++) {
    const k = modes[(round % 2 === 0 ? m + round : modes.length * CONFIG.rounds - m - round) % modes.length];
    for (const set of sets) {
      if (k > 0) repeating(k);
      await pause();
      calls = 0;
      let t0 = performance.now();
      let lines = lib.scratch(paragraphs[set], env, 320);
      out.rows.push({ scenario: 'scratch', set, k, round, ms: performance.now() - t0, lines, calls });
      if (round < CONFIG.resizeRounds) {
        const prepared = lib.prepareAll(paragraphs[set], env, 320);
        await pause();
        calls = 0;
        t0 = performance.now();
        lines = lib.relayout(prepared, WIDTHS);
        out.rows.push({ scenario: 'resize', set, k, round, ms: performance.now() - t0, lines, calls });
      }
      lib.realCanvas();
    }
  }
}
return out;
`

type Tree = { label: string; path: string }

function treesOf(value: string): Tree[] {
  const out: Tree[] = []
  const entries = value.split(',').filter(entry => entry !== '')
  for (let i = 0; i < entries.length; i++) {
    const at = entries[i]!.indexOf('=')
    out.push({ label: entries[i]!.slice(0, at), path: entries[i]!.slice(at + 1) })
  }
  return out
}

export default async function criticProbes(): Promise<Probe[]> {
  const here = resolve(import.meta.dir, '../..')
  const trees = treesOf(process.env['PROF_TREES'] ?? `head=${here}`)
  const repeatLabels = (process.env['PROF_REPEAT_TREES'] ?? trees[0]!.label).split(',')
  const sections = (process.env['PROF_SECTIONS'] ?? 'pairs,repeat').split(',')
  const rounds = Number(process.env['PROF_ROUNDS'] ?? '12')
  const messages = Number(process.env['PROF_MESSAGES'] ?? '10000')
  const bundles = new Map<string, string>()
  for (let i = 0; i < trees.length; i++) {
    const built = await Bun.build({ entrypoints: [join(trees[i]!.path, 'rebuild/tools/prof-entry.ts')], target: 'browser', format: 'iife', minify: false })
    if (!built.success) throw new Error(`bundling ${trees[i]!.path} failed: ${built.logs.join('\n')}`)
    bundles.set(trees[i]!.label, await built.outputs[0]!.text())
  }
  const sets: Record<string, unknown> = {}
  const names = (process.env['PROF_SETS'] ?? 'mix,latin').split(',')
  for (let i = 0; i < names.length; i++) sets[names[i]!] = buildChat(names[i] as 'mix' | 'latin', messages)
  const data = `const SETS = ${JSON.stringify(sets)};\n`
  const probes: Probe[] = []
  const page = (id: string, label: string, config: unknown, body: string): void => {
    probes.push({
      id, spec: 'the profiling phase\'s review: a checkout\'s chat passes in a page of its own', pageLang: 'en', html: '<div></div>',
      observe: [{ kind: 'script', source: `${bundles.get(label)!}\n${data}const CONFIG = ${JSON.stringify(config)};\n${body}` }],
      browsers: ['firefox'],
    })
  }
  if (sections.includes('pairs')) {
    for (let round = 0; round < rounds; round++) {
      for (let k = 0; k < trees.length; k++) {
        const tree = trees[round % 2 === 0 ? k : trees.length - 1 - k]!
        page(`pairs r${String(round).padStart(2, '0')} ${tree.label}`, tree.label, { label: tree.label, round, messages, passes: Number(process.env['PROF_PASSES'] ?? '2') }, PAIRS_BODY)
      }
    }
  }
  if (sections.includes('repeat')) {
    for (let i = 0; i < repeatLabels.length; i++) {
      const config = { label: repeatLabels[i]!, messages, rounds: Number(process.env['PROF_REPEAT_ROUNDS'] ?? '12'), resizeRounds: Number(process.env['PROF_REPEAT_RESIZE_ROUNDS'] ?? '6') }
      page(`repeat ${repeatLabels[i]!}`, repeatLabels[i]!, config, REPEAT_BODY)
    }
  }
  return probes
}

// ---- The summary of a run's output ----

type PairsRow = { scenario: string; set: string; pass: number; ms: number; lines: number }
type RepeatRow = { scenario: string; set: string; k: number; round: number; ms: number; lines: number; calls: number }
type PairsPage = { section: 'pairs'; label: string; round: number; messages: number; rows: PairsRow[] }
type RepeatPage = { section: 'repeat'; label: string; messages: number; rows: RepeatRow[] }

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
const fixed = (value: number, digits: number): string => value.toFixed(digits)

// Every script observation's value in the runner's output, whatever wraps it.
function pagesOf(value: unknown, out: Array<PairsPage | RepeatPage>): void {
  if (typeof value !== 'object' || value === null) return
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) pagesOf(value[i], out); return }
  const record = value as Record<string, unknown>
  if ((record['section'] === 'pairs' || record['section'] === 'repeat') && Array.isArray(record['rows'])) { out.push(record as unknown as PairsPage | RepeatPage); return }
  const keys = Object.keys(record)
  for (let i = 0; i < keys.length; i++) pagesOf(record[keys[i]!], out)
}

function summary(path: string): void {
  const pages: Array<PairsPage | RepeatPage> = []
  pagesOf(JSON.parse(readFileSync(path, 'utf8')), pages)
  const pairs: PairsPage[] = []
  const repeats: RepeatPage[] = []
  for (let i = 0; i < pages.length; i++) { const p = pages[i]!; if (p.section === 'pairs') pairs.push(p); else repeats.push(p) }
  if (pairs.length > 0) {
    const messages = pairs[0]!.messages
    const labels: string[] = []
    for (let i = 0; i < pairs.length; i++) if (!labels.includes(pairs[i]!.label)) labels.push(pairs[i]!.label)
    // A page's number for a scenario and a set: its fastest pass.
    const best = (label: string, round: number, scenario: string, set: string): number | null => {
      let found: number | null = null
      for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i]!
        if (p.label !== label || p.round !== round) continue
        for (let r = 0; r < p.rows.length; r++) if (p.rows[r]!.scenario === scenario && p.rows[r]!.set === set && (found === null || p.rows[r]!.ms < found)) found = p.rows[r]!.ms
      }
      return found
    }
    let rounds = 0
    for (let i = 0; i < pairs.length; i++) rounds = Math.max(rounds, pairs[i]!.round + 1)
    console.log(`PAIRS: fresh pages, ${rounds} rounds, ${messages} messages; ms per pass (resize: per 3 widths), a page's fastest pass; medians over the rounds`)
    for (const scenario of ['scratch', 'resize']) for (const set of ['latin', 'mix']) {
      const line: string[] = []
      for (let l = 0; l < labels.length; l++) {
        const values: number[] = []
        for (let round = 0; round < rounds; round++) { const v = best(labels[l]!, round, scenario, set); if (v !== null) values.push(v) }
        if (values.length > 0) line.push(`${labels[l]!} ${fixed(median(values), 1)} [${fixed(Math.min(...values), 1)}..${fixed(Math.max(...values), 1)}]`)
      }
      console.log(`  ${scenario} ${set}: ${line.join('; ')}`)
    }
    console.log('  pair differences (later minus earlier checkout), us a message (resize: a message of 3 layouts): median [smallest..largest], rounds where the later one is faster')
    const compare = (a: string, b: string): void => {
      for (const scenario of ['scratch', 'resize']) for (const set of ['latin', 'mix']) {
        const differences: number[] = []
        for (let round = 0; round < rounds; round++) {
          const x = best(a, round, scenario, set)
          const y = best(b, round, scenario, set)
          if (x !== null && y !== null) differences.push((y - x) * 1000 / messages)
        }
        if (differences.length === 0) continue
        let faster = 0
        for (let i = 0; i < differences.length; i++) if (differences[i]! < 0) faster++
        console.log(`  ${a} -> ${b}  ${scenario} ${set}: ${fixed(median(differences), 2)} [${fixed(Math.min(...differences), 2)}..${fixed(Math.max(...differences), 2)}]  ${faster}/${differences.length}`)
      }
    }
    for (let l = 1; l < labels.length; l++) compare(labels[l - 1]!, labels[l]!)
    if (labels.length > 2) for (let l = 2; l < labels.length; l++) compare(labels[0]!, labels[l]!)
  }
  for (let i = 0; i < repeats.length; i++) {
    const page = repeats[i]!
    console.log(`REPEAT (${page.label}): every question asked k times; ms per ${page.messages} messages, medians over the rounds`)
    for (const scenario of ['scratch', 'resize']) for (const set of ['latin', 'mix']) {
      const at = (k: number): number[] => page.rows.filter(row => row.scenario === scenario && row.set === set && row.k === k).map(row => row.ms)
      if (at(0).length === 0) continue
      const calls = page.rows.find(row => row.scenario === scenario && row.set === set && row.k === 1)!.calls
      const t = [median(at(0)), median(at(1)), median(at(2)), median(at(3))]
      // Per round, so that a slow stretch of the machine falls on every k of a round.
      const rounds = Math.min(at(1).length, at(3).length)
      const slopes: number[] = []
      for (let r = 0; r < rounds; r++) slopes.push((at(3)[r]! - at(1)[r]!) / 2)
      const slope = median(slopes)
      console.log(`  ${scenario} ${set}: real ${fixed(t[0]!, 1)}; k=1 ${fixed(t[1]!, 1)}, k=2 ${fixed(t[2]!, 1)}, k=3 ${fixed(t[3]!, 1)}; steps ${fixed(t[2]! - t[1]!, 1)} and ${fixed(t[3]! - t[2]!, 1)}; slope ${fixed(slope, 1)} [${fixed(Math.min(...slopes), 1)}..${fixed(Math.max(...slopes), 1)}] ms = ${fixed(100 * slope / t[0]!, 1)}% of the real pass; ${calls} calls, ${fixed(slope * 1e6 / calls, 0)} ns a call; own JS by this method ${fixed(t[0]! - slope, 1)} ms`)
    }
  }
}

if (import.meta.main) summary(resolve(process.argv[2]!))
