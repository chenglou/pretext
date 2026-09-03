import { runPrepareWorkloads } from '../shared/prepare-workloads.js'
import { publishNavigationReport, publishNavigationPhase } from './report-utils.js'
const params = new URLSearchParams(location.search)
const requestId = params.get('requestId') ?? ''
const output = document.querySelector<HTMLPreElement>('#result')!
const button = document.querySelector<HTMLButtonElement>('#run')!
async function run(): Promise<void> {
  button.disabled = true
  output.textContent = 'Running…'
  publishNavigationPhase('measuring', requestId)
  try {
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const report = { status: 'ready', requestId, ...runPrepareWorkloads(), userAgent: navigator.userAgent, devicePixelRatio }
    output.textContent = JSON.stringify(report, null, 2)
    if (params.has('report')) publishNavigationReport(report)
  } catch (error) {
    const report = { status: 'error', requestId, message: String(error) }
    output.textContent = report.message
    if (params.has('report')) publishNavigationReport(report)
  } finally { button.disabled = false }
}
button.addEventListener('click', () => { void run() })
if (params.has('report')) void run()
