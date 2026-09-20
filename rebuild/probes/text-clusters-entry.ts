// What probes/text-clusters.ts runs in the page: the library's prepare, the Blink port's positions and cluster tables, and
// the lab's adapter from a case to the paragraph the library takes, with the lab's font facts and without them.
import { fontFactsFor } from '../lab/font-facts.ts'
import { layoutInput } from '../lab/predictor-core.ts'
import { groupPrefix16, isClusterBoundary, toldClusterStart, toldPrefix16 } from '../src/engines/blink/shape.ts'
import { detectEnvironment } from '../src/env.ts'
import { prepare } from '../src/index.ts'
import { hasTextClusters } from '../src/measure/canvas.ts'
import { UNKNOWN_FONT_FACTS } from '../src/model.ts'

// One object, since the bundler drops a constant that is only exported again.
export const library = { layoutInput, fontFactsFor, detectEnvironment, prepare, hasTextClusters, unknownFontFacts: UNKNOWN_FONT_FACTS, groupPrefix16, isClusterBoundary, toldClusterStart, toldPrefix16 }
