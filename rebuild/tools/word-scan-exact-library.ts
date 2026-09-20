// The library with Gecko's word scan in mode 'exact' (src/engines/gecko/lines.ts wordScanState), for the function set's
// checks: bun rebuild/tests/function-set.ts plain --browser=firefox --library=rebuild/tools/word-scan-exact-library.ts
import { wordScanState } from '../src/engines/gecko/lines.ts'

wordScanState.mode = 'exact'
export * from '../src/index.ts'
