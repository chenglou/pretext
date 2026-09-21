// The two native workflows seal their runtime trees, acceptance helpers and the font bytes run.ts serves.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type FileSeal = { path: string; sha256: string }
export function sealFiles(paths: readonly string[]): FileSeal[] {
  return [...new Set(paths.map(path => resolve(path)))].sort().map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }))
}
export function sealNativeSources(root: string, main: boolean, acceptance: readonly string[], webkitHost: boolean): FileSeal[] {
  const files = acceptance.map(path => resolve(root, path))
  function visit(path: string) {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name)
      if (statSync(file).isDirectory()) visit(file)
      else if (/\.(?:[cm]?[jt]sx?|json)$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name)) files.push(file)
    }
  }
  for (const tree of ['rebuild/src', 'rebuild/lab', ...(main ? ['src'] : [])]) visit(join(root, tree))
  // FONTS_DIR and FONT_FIXTURES in rebuild/lab/run.ts: the manifest and each declared asset are actual runtime inputs.
  const fonts = join(root, 'tests/wrapping/fonts'), manifest = join(fonts, 'fonts.json')
  files.push(manifest)
  for (const fixture of JSON.parse(readFileSync(manifest, 'utf8')) as Array<{ file: string }>) files.push(join(fonts, fixture.file))
  if (webkitHost) files.push(join(root, '.artifacts/webkit-host/webkit-host'))
  files.push(join(root, 'scripts/browser-automation.ts'), join(root, 'shared/navigation-state.ts'), join(root, 'package.json'), join(root, 'tsconfig.json'), import.meta.path)
  return sealFiles(files)
}
export function verifyFileSeals(expected: readonly FileSeal[], actual: readonly FileSeal[], label: string): void {
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) if (expected[i]?.path !== actual[i]?.path || expected[i]?.sha256 !== actual[i]?.sha256) throw new Error(`${label} changed during workflow: ${expected[i]?.path ?? actual[i]?.path}`)
}
