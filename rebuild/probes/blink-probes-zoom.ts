// The subset of blink-probes.ts that the zoom runs repeat: forced DPR 3.5 (--chrome-args=--force-device-scale-factor=3.5)
// and emulated DPR 2 (--chrome-args=--force-device-scale-factor=1 --chrome-emulate-dsf=2).
import probes, { ZOOM_PROBE_IDS } from './blink-probes.ts'
import type { Probe } from './types.ts'

export default async function zoomProbes(): Promise<Probe[]> {
  const all = await probes()
  return all.filter(probe => ZOOM_PROBE_IDS.includes(probe.id))
}
