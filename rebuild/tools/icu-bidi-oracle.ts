// Builds and runs tools/icu-bidi-oracle.c, ICU's own ubidi, for the bidi tests under src/unicode.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { REBUILD } from './gen-shared.ts'

export type IcuBuild =
  // Homebrew icu4c@78, upstream ICU 78.3: its bidi code and data are byte-identical to Chrome 153's ICU 78.2
  // (specs/bidi.md §5.1).
  | 'icu4c-78'
  // The system libicucore: Safari 27's ICU on macOS 27.
  | 'libicucore'

export const ICU_VERSIONS: Record<IcuBuild, string> = { 'icu4c-78': '78.3', libicucore: '78.1' }

const ICU4C_78 = '/opt/homebrew/opt/icu4c@78'

export function buildIcuBidiOracle(build: IcuBuild): string {
  const binary = join(mkdtempSync(join(tmpdir(), 'icu-bidi-oracle-')), build)
  let link: string[]
  switch (build) {
    case 'icu4c-78':
      link = [`-I${ICU4C_78}/include`, `-L${ICU4C_78}/lib`, '-licuuc', '-licudata']
      break
    case 'libicucore':
      link = ['-DU_DISABLE_RENAMING=1', `-I${ICU4C_78}/include`, '-licucore']
      break
  }
  const result = Bun.spawnSync(['clang', '-std=c11', '-O2', '-Wall', resolve(REBUILD, 'tools/icu-bidi-oracle.c'), ...link, '-o', binary])
  if (result.exitCode !== 0) throw new Error(`building the ${build} oracle failed:\n${result.stderr.toString()}`)
  return binary
}

export function runIcuBidiOracle(binary: string, mode: 'version' | 'classes' | 'levels', input: string): string {
  const result = Bun.spawnSync([binary, mode], { stdin: Buffer.from(input) })
  if (result.exitCode !== 0) throw new Error(`${binary} ${mode} failed:\n${result.stderr.toString()}`)
  return result.stdout.toString()
}
