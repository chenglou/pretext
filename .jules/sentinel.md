## 2025-02-14 - Fix XSS in benchmark error handling
**Vulnerability:** XSS vulnerability in `pages/benchmark.ts` due to injecting unsanitized error messages directly into the DOM using `root.innerHTML = \`<p>${message}</p>\``.
**Learning:** Exception messages can contain arbitrary strings that, when manipulated or leaked via DOM rendering mechanisms like `innerHTML`, result in Cross-Site Scripting vulnerabilities.
**Prevention:** Always sanitize dynamic strings using an `escapeHtml` function before injecting them with `innerHTML`, or alternatively, use `textContent` when dealing purely with text.
