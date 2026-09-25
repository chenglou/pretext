# Corpora

Starter long-form stress corpora for browser-layout experiments.

These files are checked in so we have stable canaries when probing languages and
punctuation systems beyond the current 7680-case browser sweep. The main corpus
set is wired into `/corpus` and the long-form rows on `/benchmark`; the checked-in
`step=10` snapshots are the compact source of truth for current results. The
Markdown chat demo also draws generated message text from the English, Chinese,
Arabic and Hindi files, so those four ship in the npm package with the demos.

Machine-readable metadata lives in `sources.json`.

Machine-readable corpus status lives in [chrome-step10.json](chrome-step10.json),
[safari-step10.json](safari-step10.json) and [firefox-step10.json](firefox-step10.json).
"step=10" means the `300..900` sweep.
Mismatch taxonomy and steering vocabulary live in `TAXONOMY.md`.

The corpus page is also available locally at `/corpus?id=<corpus-id>`.
