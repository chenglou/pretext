// Plain predictor: the count/range application path, with no supplied font facts.
//   bun rebuild/lab/run.ts --predictor=rebuild/lab/baselines/plain-predictor.ts ...
// It prepares without inspection and fills every source range through the same engine break decisions. It reads no
// painting output, matching a caller that needs only counts or ranges. Full lines/pieces remain independently covered
// by function-set.ts and the full-output proof; this native adapter checks the range API's own Canvas history.
import { UNKNOWN_FONT_FACTS } from '../../src/model.ts'
import { makePlainPredictor } from '../predictor-core.ts'

export const { predict, paint } = makePlainPredictor(() => UNKNOWN_FONT_FACTS, [], false, 'range')
