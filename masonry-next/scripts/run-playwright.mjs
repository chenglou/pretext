import net from 'node:net'
import { spawn } from 'node:child_process'

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine an open port for Playwright'))
        return
      }

      server.close(error => {
        if (error) reject(error)
        else resolve(String(address.port))
      })
    })
  })
}

const port = await getFreePort()
const child = spawn('./node_modules/.bin/playwright', ['test'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_TEST_PORT: port,
  },
})

child.on('exit', code => {
  process.exit(code ?? 1)
})
