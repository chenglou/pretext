// The DOM-first system-ui cache-order probe of blink-probes.ts, alone in a fresh browser, so its DOM widths are laid out
// before any Canvas system-ui measurement exists in the renderer's font cache.
import probes, { SYSUI_DOM_FIRST_PROBE_IDS } from './blink-probes.ts'
import type { Probe } from './types.ts'

export default async function sysuiDomFirstProbes(): Promise<Probe[]> {
  const all = await probes()
  return all.filter(probe => SYSUI_DOM_FIRST_PROBE_IDS.includes(probe.id))
}
