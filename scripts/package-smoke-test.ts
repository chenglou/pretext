import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const keepTemp = process.argv.includes('--keep-temp')
const tempRoot = await mkdtemp(path.join(tmpdir(), 'pretext-package-smoke-'))
let succeeded = false

try {
  const tarballPath = await packPackage()
  await smokeJavaScriptEsm(tarballPath)
  await smokeTypeScript(tarballPath)
  succeeded = true
  console.log(`Package smoke test passed: ${tarballPath}`)
} catch (error) {
  console.error(`Package smoke test failed. Temp files kept at ${tempRoot}`)
  throw error
} finally {
  if (!keepTemp && succeeded) {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function packPackage(): Promise<string> {
  const packDir = path.join(tempRoot, 'pack')
  await mkdir(packDir, { recursive: true })

  run(['npm', 'pack', '--pack-destination', packDir], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const entries = await readdir(packDir)
  const tarballs = entries.filter(entry => entry.endsWith('.tgz'))
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${packDir}, found ${tarballs.length}`)
  }
  return path.join(packDir, tarballs[0]!)
}

async function smokeJavaScriptEsm(tarballPath: string): Promise<void> {
  const projectDir = path.join(tempRoot, 'js-esm')
  await createProject(projectDir, {
    name: 'pretext-package-smoke-js-esm',
    private: true,
    type: 'module',
  })

  await installTarball(projectDir, tarballPath)
  await writeFile(
    path.join(projectDir, 'index.js'),
    [
      "import * as pretext from '@chenglou/pretext'",
      "if (typeof pretext.prepare !== 'function') throw new Error('prepare export missing')",
      "if (typeof pretext.layout !== 'function') throw new Error('layout export missing')",
      "console.log('js-esm ok')",
      '',
    ].join('\n'),
  )

  run(['node', 'index.js'], {
    cwd: projectDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

async function smokeTypeScript(tarballPath: string): Promise<void> {
  const projectDir = path.join(tempRoot, 'ts')
  await createProject(projectDir, {
    name: 'pretext-package-smoke-ts',
    private: true,
    type: 'module',
  })

  await installTarball(projectDir, tarballPath)
  await writeFile(
    path.join(projectDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'esnext',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['index.ts'],
    }, null, 2) + '\n',
  )

  await writeFile(
    path.join(projectDir, 'index.ts'),
    [
      "import { layout, prepare } from '@chenglou/pretext'",
      "const prepared = prepare('hello', '16px Inter')",
      "const keepAllPrepared = prepare('안녕하세요 세계', '16px Inter', { wordBreak: 'keep-all' })",
      'const result = layout(prepared, 100, 20)',
      'const keepAllResult = layout(keepAllPrepared, 100, 20)',
      'result.height satisfies number',
      'keepAllResult.lineCount satisfies number',
      '',
    ].join('\n'),
  )

  run([path.join(root, 'node_modules', '.bin', tscBinaryName()), '-p', 'tsconfig.json'], {
    cwd: projectDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await writeFile(
    path.join(projectDir, 'index.ts'),
    [
      "import { layout, prepare } from '@chenglou/pretext'",
      "const prepared = prepare('hello', '16px Inter')",
      "const width = '100'",
      'layout(prepared, width, 20)',
      '',
    ].join('\n'),
  )

  const badCompile = run(
    [path.join(root, 'node_modules', '.bin', tscBinaryName()), '-p', 'tsconfig.json'],
    {
      cwd: projectDir,
      stdout: 'pipe',
      stderr: 'pipe',
      allowFailure: true,
    },
  )

  if (badCompile.exitCode === 0) {
    throw new Error('Expected TypeScript consumer misuse to fail, but it compiled successfully.')
  }

  const combinedOutput = `${badCompile.stdout}${badCompile.stderr}`
  if (
    !combinedOutput.includes("Argument of type 'string' is not assignable to parameter of type 'number'.") &&
    !combinedOutput.includes("Type 'string' is not assignable to type 'number'.")
  ) {
    throw new Error(`Unexpected TypeScript consumer error output:\n${combinedOutput}`)
  }

  console.log('ts ok')
}

async function createProject(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

async function installTarball(projectDir: string, tarballPath: string): Promise<void> {
  run(['npm', 'install', '--ignore-scripts', '--no-package-lock', tarballPath], {
    cwd: projectDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

function tscBinaryName(): string {
  return process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
}

function run(
  cmd: string[],
  options: {
    cwd: string
    stdout: 'inherit' | 'pipe'
    stderr: 'inherit' | 'pipe'
    allowFailure?: boolean
  },
): { exitCode: number, stdout: string, stderr: string } {
  const result = Bun.spawnSync(cmd, {
    cwd: options.cwd,
    stdout: options.stdout,
    stderr: options.stderr,
  })

  const stdout = options.stdout === 'pipe' ? new TextDecoder().decode(result.stdout) : ''
  const stderr = options.stderr === 'pipe' ? new TextDecoder().decode(result.stderr) : ''

  if (!options.allowFailure && result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${cmd.join(' ')}`)
  }

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
  }
}
