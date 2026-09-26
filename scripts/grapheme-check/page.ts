// The grapheme check's page (build.ts), which posts check.ts's result to run.ts.
import { createBrowserEnvironmentGuard } from '../../shared/browser-environment.ts'
import { runGraphemeCheck } from './check.ts'

const params = new URLSearchParams(location.search)
const status = document.getElementById('status')!
const post = (body: unknown): Promise<Response> => fetch('/report', { method: 'POST', body: JSON.stringify(body) })
const guard = createBrowserEnvironmentGuard('correctness')
try {
  const texts = await (await fetch('./texts.json')).json() as string[]
  const result = await runGraphemeCheck(texts, Number(params.get('fuzz') ?? 200_000), line => { status.textContent += `${line}\n` })
  guard.assertStable()
  await post({ status: 'ready', requestId: params.get('requestId'), environment: guard.report(), result })
  status.textContent += 'posted\n'
} catch (error) {
  await post({ status: 'error', requestId: params.get('requestId'), message: String(error), environment: guard.report() })
  status.textContent += `error: ${String(error)}\n`
} finally {
  guard.dispose()
}
