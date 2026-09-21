// The probe runner can finish successfully with an observation error; make that a failing job.
import { readFileSync, writeFileSync } from 'node:fs'
import type { ProbeOutput } from '../probes/types.ts'
const path = process.argv[2]
if (path === undefined) throw new Error('usage: bun gecko-dictionary-pair-check.ts <firefox-probes.json>')
const output = JSON.parse(readFileSync(path, 'utf8')) as ProbeOutput
if (output.status !== 'ok' || output.errors.length > 0 || output.totals.probesWithErrors > 0 || output.totals.observationErrors > 0) throw new Error('native pair runner/probe/observation failed')
const result = output.results.find(row => row.id === 'gecko dictionary D1')?.result
if (result === undefined || result === null || result.errors.length > 0) throw new Error('native pair result missing or failed')
const observation = result.observations.find(row => row.kind === 'script')
if (observation === undefined || 'error' in observation || observation.kind !== 'script' || !('value' in observation)) throw new Error('native pair script result missing or failed')
type Focus = { hasFocus: boolean; visibilityState: string }
type Cell = { round: number; label: string; focusBefore: Focus; focusAfter: Focus }
type Row = Cell & { set: string; usPerMessage: number }
type LongRow = Cell & { language: string; units: number; usPerCall: number }
const value = observation.value as { userAgent: string; verification: Array<{ set: string; exact: boolean; messages: number }>; longVerification: Array<{ exact: boolean }>; paired: Array<{ set: string; baseUs: number; headUs: number; pairedSavingUs: number; pairedPositive: number; pairs: number }>; config: { rounds: number; foreground: boolean }; rows: Row[]; longRows: LongRow[] }
if (!/\bFirefox\//.test(value.userAgent) || value.verification.length !== 5 || value.longVerification.length !== 6) throw new Error('native Firefox/full scope result missing')
if (!value.verification.every(row => row.exact) || !value.longVerification.every(row => row.exact)) throw new Error('native equivalence not proved')
if (value.rows.length !== value.config.rounds * 10 || value.longRows.length !== value.config.rounds * 6) throw new Error('native timing rows incomplete')
const focusSamples = [...value.rows, ...value.longRows].flatMap(row => [row.focusBefore, row.focusAfter])
const allFocusedVisible = focusSamples.every(state => state.hasFocus && state.visibilityState === 'visible')
if (value.config.foreground && (!output.foreground || !allFocusedVisible)) throw new Error('foreground timing lacks focus/visibility evidence')
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const longPaired = ['th', 'my', 'km'].map(language => {
  const rows = value.longRows.filter(row => row.language === language)
  const base = rows.filter(row => row.label === 'base'), head = rows.filter(row => row.label === 'head')
  const savings: number[] = []
  for (let round = 0; round < value.config.rounds; round++) {
    const a = base.filter(row => row.round === round), b = head.filter(row => row.round === round)
    if (a.length !== 1 || b.length !== 1) throw new Error('native long timing pair missing or duplicated')
    savings.push(a[0]!.usPerCall - b[0]!.usPerCall)
  }
  const baseUs = median(base.map(row => row.usPerCall)), headUs = median(head.map(row => row.usPerCall))
  const pairedSavingUs = median(savings)
  return { language, units: base[0]!.units, baseUs, headUs, pairedSavingUs, pairedSavingPercentOfBase: 100 * pairedSavingUs / baseUs, pairedPositive: savings.filter(n => n > 0).length, pairs: savings.length, savings }
})
const summary = {
  verified: value.verification, longVerified: value.longVerification,
  focus: { required: value.config.foreground, cells: focusSamples.length / 2, samples: focusSamples.length, allFocusedVisible },
  paired: value.paired.map(row => ({ ...row, pairedSavingPercentOfBase: 100 * row.pairedSavingUs / row.baseUs })),
  longPaired,
}
writeFileSync(path.replace(/\.json$/, '-summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
