import { createServer as createHttpServer } from 'node:http'
import { getAvailablePort } from './browser-automation.ts'

export async function startPostedReportServer<T extends { requestId?: string }>(expectedRequestId: string): Promise<{
  endpoint: string
  waitForReport: (timeoutMs?: number | null) => Promise<T>
  close: () => void
}> {
  const port = await getAvailablePort()
  let resolveReport: ((report: T) => void) | null = null
  let rejectReport: ((error: Error) => void) | null = null
  const reportPromise = new Promise<T>((resolve, reject) => {
    resolveReport = resolve
    rejectReport = reject
  })

  const server = createHttpServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*')
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      res.statusCode = 204
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 404
      res.end()
      return
    }

    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      try {
        const report = JSON.parse(body) as T
        if (report.requestId === expectedRequestId) {
          resolveReport?.(report)
        }
        res.statusCode = 204
        res.end()
      } catch (error) {
        res.statusCode = 400
        res.end(error instanceof Error ? error.message : String(error))
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return {
    endpoint: `http://127.0.0.1:${port}/report`,
    async waitForReport(timeoutMs: number | null = 120_000): Promise<T> {
      if (timeoutMs === null) {
        return await reportPromise
      }
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Timed out waiting for posted report'))
        }, timeoutMs)

        reportPromise.then(
          report => {
            clearTimeout(timer)
            resolve(report)
          },
          error => {
            clearTimeout(timer)
            reject(error)
          },
        )
      })
    },
    close() {
      server.close()
      rejectReport?.(new Error('Report server closed before report arrived'))
    },
  }
}
