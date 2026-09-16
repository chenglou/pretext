// The system-ui probes of blink-probes.ts, run in a fresh browser with the cache-order probe first, so its Canvas widths
// are taken before any DOM system-ui text exists in the renderer's font cache.
import probes, { SYSUI_PROBE_IDS } from './blink-probes.ts'
import type { Probe } from './types.ts'

export default async function sysuiProbes(): Promise<Probe[]> {
  const all = await probes()
  const selected: Probe[] = []
  for (let i = 0; i < SYSUI_PROBE_IDS.length; i++) {
    const found = all.find(probe => probe.id === SYSUI_PROBE_IDS[i])
    if (found === undefined) throw new Error(`Missing probe ${SYSUI_PROBE_IDS[i]}`)
    selected.push(found)
  }
  return selected
}
