# Corpora

Long-form text in the languages and punctuation systems apps lay out, checked in as clean source text.
`sources.json` names each file's source, language and license.

What reads them:
- the harness's real-usage sample (`harness/sets/sample.ts`), which draws paragraphs from every file but
  `mixed-app-text.txt`; so any edit to a file changes the sample, and a new draw must be recorded;
- the harness's census, book and smoke sets, taken once from these files, `mixed-app-text.txt` included;
- the bench's message families (`harness/bench/texts.ts`);
- the Markdown chat demo, which draws its generated messages from the English, Chinese, Arabic and Hindi files.
