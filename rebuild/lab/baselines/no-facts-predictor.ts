// Facts-free predictor: predictor.ts with no supplied font facts.
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/no-facts-predictor.ts ...
// Every font of the case gets UNKNOWN_FONT_FACTS, so each engine uses the defaults src/model.ts documents for FontFacts,
// which Canvas measurement alone gives, and reports the named gaps. font-facts.ts and its table aren't imported, so they
// aren't in this predictor's bundle. Everything else is predictor-core.ts, which predictor.ts uses too: the environment,
// the given build and process languages, the paragraph as the library takes it, the painter and its limits.
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePredictor } from '../predictor-core.ts'

export const { predict, paint, limits } = makePredictor(() => UNKNOWN_FONT_FACTS)
