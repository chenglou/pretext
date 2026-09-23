// tools/cut-fonts-probe.ts with the audit's knockout switches on in the head tree (research/REQUIREMENTS-AUDIT.md): the
// base checkout (CUT_TREE_A, unchanged library) and the scratch checkout with the switches (CUT_TREE_B) lay the probe's
// texts out in every installed family, and their cuts, positions and lines are compared. The base tree has no switches,
// so the page-wide flag reaches the head alone.
//   CUT_KO=<name>[+<name>] CUT_TREE_A=<base> CUT_TREE_B=<scratch tree> CUT_FONTS=<families.json> \
//     bun rebuild/probes/runner.ts --browser=chrome --probes=rebuild/tools/audit/cut-fonts-ko-probe.ts --out=<dir> ...
import cutFontsProbes from '../cut-fonts-probe.ts'
import type { Probe } from '../../probes/types.ts'

export default async function cutFontsKnockoutProbes(): Promise<Probe[]> {
  const names = (process.env['CUT_KO'] ?? '').split('+').filter(n => n !== '')
  if (names.length === 0) throw new Error('CUT_KO names the knockout switches')
  const flags: Record<string, boolean> = {}
  for (const name of names) flags[name] = true
  const set = `globalThis.__auditKO = ${JSON.stringify(flags)};\n`
  const probes = await cutFontsProbes()
  return probes.map(p => ({ ...p, id: `${p.id} ${names.join('+')}`, observe: p.observe.map(o => typeof o === 'object' && o !== null && 'kind' in o && o.kind === 'script' ? { ...o, source: set + o.source } : o) }))
}
