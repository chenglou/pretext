import { createServer as createHttpServer } from 'node:http'

export async function startPostedReportServer<T extends { requestId?: string }>(expectedRequestId: string): Promise<{
  endpoint: string
  waitForReport: (timeoutMs?: number | null) => Promise<T>
  close: () => Promise<void>
}> {
  let resolveReport: ((report: T) => void) | null = null
  let rejectReport: ((error: Error) => void) | null = null
  const reportPromise = new Promise<T>((resolve, reject) => {
    resolveReport = resolve
    rejectReport = reject
  })
  // A startup error may close this server before waitForReport is called.
  // Callers still receive the rejection when they do await the report.
  void reportPromise.catch(() => {})

  const server = createHttpServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*')
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      res.statusCode = 204
      res.end()
      return
    }

    if (req.method !== 'POST' || req.url !== '/report') {
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
        if (report.requestId !== expectedRequestId) {
          res.statusCode = 409
          res.end('Unexpected report request')
          return
        }
        res.statusCode = 204
        res.once('finish', () => resolveReport?.(report))
        res.end()
      } catch (error) {
        res.statusCode = 400
        res.end(error instanceof Error ? error.message : String(error))
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Report server has no TCP address')
  let closePromise: Promise<void> | null = null

  return {
    endpoint: `http://127.0.0.1:${address.port}/report`,
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
      closePromise ??= new Promise<void>((resolve, reject) => {
        rejectReport?.(new Error('Report server closed before report arrived'))
        server.close(error => { if (error) reject(error); else resolve() })
        server.closeAllConnections()
      })
      return closePromise
    },
  }
}
