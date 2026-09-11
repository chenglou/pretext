import chrome from '../accuracy/chrome.json'
import safari from '../accuracy/safari.json'
import firefox from '../accuracy/firefox.json'

type Snapshot = {
  total: number
  matchCount: number
  mismatchCount: number
  generatedAt: string
  environments: Array<{ userAgent: string; dpr: number }>
  mismatches: Array<{ id: string; label: string; font: string; width: number; actual: number; predicted: number; diff: number }>
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const root = document.getElementById('root')!
for (const [browser, snapshot] of Object.entries<Snapshot>({ chrome, safari, firefox })) {
  const section = document.createElement('section')
  section.innerHTML = `<h2>${browser}</h2>
    <div class="summary"><span class="big">${snapshot.matchCount}/${snapshot.total}</span> match
    <span class="sep">|</span>${snapshot.mismatchCount} mismatches</div>
    <p class="sub">${escapeHtml(snapshot.environments[0]!.userAgent)} · DPR ${snapshot.environments[0]!.dpr}<br>${escapeHtml(snapshot.generatedAt)}</p>`
  if (snapshot.mismatches.length > 0) {
    section.innerHTML += `<table><tr><th>Case</th><th>Font</th><th>Width</th><th>Actual</th><th>Predicted</th></tr>${snapshot.mismatches.map(row =>
      `<tr><td class="text">${escapeHtml(row.label)}<br>${row.id}</td><td class="text">${escapeHtml(row.font)}</td><td>${row.width}px</td><td>${row.actual}px</td><td>${row.predicted}px</td></tr>`,
    ).join('')}</table>`
  }
  root.append(section)
}
