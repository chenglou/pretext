// What `bun test --coverage` runs for coverage-map.ts: the replay of one shard of recorded cases, as replay.ts `work` runs it
// (the prediction, the observation port and the painter's limits), so bun's line coverage says which lines of rebuild/src
// the shard executed. Its name matches no test pattern, so `bun test rebuild` never picks it up.
import { test } from 'bun:test'
import { resolve } from 'node:path'
import { readShard, replayCase, type InputCase, type Predictor } from './replay.ts'
import { REPO } from './sets.ts'

test('replay one shard under coverage', async () => {
  const predictor = await import(resolve(REPO, process.env['COVERAGE_MAP_PREDICTOR']!)) as Predictor
  const inputs = readShard<InputCase>(process.env['COVERAGE_MAP_INPUTS']!)
  for (let i = 0; i < inputs.length; i++) replayCase(inputs[i]!, predictor)
}, 3_600_000)
