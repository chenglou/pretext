import type { BrowserCompletion, BrowserConfig, BrowserProgress, CaseResult } from '../tests/wrapping/types.ts'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a transport object')
  return value as Record<string, unknown>
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

// One collector belongs to one document, from configuration through its final
// report. Row writes finish before their sequence is acknowledged or completed.
export function createWrappingTransport(
  config: BrowserConfig,
  url: string,
  onRows: (rows: CaseResult[]) => Promise<void>,
  onProgress: (progress: BrowserProgress) => void,
) {
  let finish!: (completion: BrowserCompletion) => void
  const completed = new Promise<BrowserCompletion>(resolve => { finish = resolve })
  let state: 'open' | 'writing' | 'finished' = 'open'
  let sequence = 0
  let rowCount = 0
  let total: number | undefined

  function complete(completion: BrowserCompletion): void {
    state = 'finished'
    finish(completion)
  }

  return {
    completed,
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url)
      if (path.pathname === '/config') {
        if (request.method !== 'GET') return new Response('GET required', { status: 405 })
        if (path.searchParams.get('request') !== config.requestId || state !== 'open') return new Response('Inactive request', { status: 409 })
        return Response.json(config)
      }
      if (request.method !== 'POST') return new Response('POST required', { status: 405 })
      let data: Record<string, unknown>
      try { data = object(await request.json()) } catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), { status: 400 })
      }
      if (data['requestId'] !== config.requestId || state !== 'open') return new Response('Inactive request', { status: 409 })
      try {
        switch (path.pathname) {
          case '/rows': {
            if (data['sequence'] !== sequence) return new Response(`Expected batch ${sequence}`, { status: 409 })
            const rows = data['rows']
            if (!Array.isArray(rows) || rows.length === 0) throw new Error('Expected a nonempty row batch')
            state = 'writing'
            await onRows(rows as CaseResult[])
            rowCount += rows.length
            sequence++
            state = 'open'
            return new Response('ok')
          }
          case '/progress': {
            const reported = data['completed'], expected = data['total']
            if (!count(reported) || !count(expected) || reported !== rowCount || expected < reported || (total !== undefined && total !== expected)) throw new Error('Progress does not match received rows')
            total = expected
            onProgress({ requestId: config.requestId, completed: reported, total: expected })
            return new Response('ok')
          }
          case '/report': {
            const report = object(data['report'])
            if (data['url'] !== url) throw new Error(`Report URL does not match the requested page: ${String(data['url'])}`)
            switch (report['status']) {
              case 'ready':
                if (!count(report['rowCount']) || report['rowCount'] !== rowCount || (total !== undefined && total !== rowCount)) throw new Error('Final report does not match received rows')
                break
              case 'error':
                if (typeof report['message'] !== 'string') throw new Error('Missing browser failure message')
                break
              default: throw new Error('Unknown browser report status')
            }
            complete({ requestId: config.requestId, url, report: report as BrowserCompletion['report'] })
            return new Response('ok')
          }
          default: return new Response('Not found', { status: 404 })
        }
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error)
        complete({ requestId: config.requestId, url, report: { status: 'error', message: `Wrapping transport: ${message}` } })
        return new Response(message, { status: 400 })
      }
    },
  }
}
