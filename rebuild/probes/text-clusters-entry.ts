// What probes/text-clusters.ts runs in the page: the library's prepare, the Blink port's positions and cluster tables, and
// the lab's adapter from a case to the paragraph the library takes, with the lab's font facts and without them.
export { layoutInput } from '../lab/predictor-core.ts'
export { fontFactsFor } from '../lab/font-facts.ts'
export { detectEnvironment } from '../src/env.ts'
export { prepare } from '../src/index.ts'
export { hasTextClusters } from '../src/measure/canvas.ts'
export { UNKNOWN_FONT_FACTS } from '../src/model.ts'
export { groupPrefix16, isClusterBoundary, toldClusterStart, toldPrefix16 } from '../src/engines/blink/shape.ts'
