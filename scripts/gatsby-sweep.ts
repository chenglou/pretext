import { spawnSync } from 'node:child_process'

const forwardedArgs = process.argv.slice(2).filter(arg => arg !== '--all' && !arg.startsWith('--id='))

const result = spawnSync(
  'bun',
  ['run', 'scripts/corpus-sweep.ts', '--id=en-gatsby-opening', ...forwardedArgs],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(process.env['GATSBY_CHECK_BROWSER'] === undefined
        ? {}
        : { CORPUS_CHECK_BROWSER: process.env['GATSBY_CHECK_BROWSER'] }),
      ...(process.env['GATSBY_CHECK_PORT'] === undefined
        ? {}
        : { CORPUS_CHECK_PORT: process.env['GATSBY_CHECK_PORT'] }),
      ...(process.env['GATSBY_CHECK_TIMEOUT_MS'] === undefined
        ? {}
        : { CORPUS_CHECK_TIMEOUT_MS: process.env['GATSBY_CHECK_TIMEOUT_MS'] }),
    },
    encoding: 'utf8',
  },
)

if (result.stdout.length > 0) process.stdout.write(result.stdout)
if (result.stderr.length > 0) process.stderr.write(result.stderr)

if (result.error !== undefined) {
  throw result.error
}

process.exit(result.status ?? 1)
