# Security Policy

## Overview

Pretext is a pure JavaScript/TypeScript library for multiline text measurement and layout. It runs entirely client-side — no servers, no data transmission, no authentication. This document describes the security posture of the project, which versions receive security updates, and how to responsibly disclose vulnerabilities.

---

## Supported Versions

Only the latest minor release of the current major version receives security patches. Older versions are unsupported and will not receive backports.

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x (latest) | :white_check_mark: |
| < 0.0.x (older patches) | :x: |

> **Note:** Pretext is currently pre-1.0. The API is stabilizing. Security fixes will always be released as patch versions (e.g., `0.0.x`). We strongly recommend always pinning to the latest published version on npm.

---

## Threat Model

Pretext is a **rendering and measurement library**. It does not:

- Make network requests
- Access the filesystem
- Store or transmit user data
- Require authentication or secrets
- Execute arbitrary user-supplied code paths in a privileged context

Security concerns most applicable to this library include:

- **Cross-Site Scripting (XSS):** If consumers of the library pass unsanitized user input into Pretext's text measurement APIs and then render those results as raw HTML, XSS may occur in the consuming application. **Pretext itself does not render HTML from input strings** — it measures text. However, consumers should always sanitize any user-supplied content before passing it through rendering pipelines.
- **Prototype Pollution:** Malicious input objects could attempt to pollute the prototype chain via crafted arguments. Maintainers should audit all object-merging code paths.
- **Dependency Supply Chain:** As with all npm packages, compromised transitive dependencies could introduce malicious code. See the [Supply Chain](#supply-chain-security) section below.
- **ReDoS (Regular Expression Denial of Service):** If any regex-based text processing is added in future, care must be taken to avoid catastrophic backtracking.

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub Issues.**

If you discover a security vulnerability in Pretext, please report it privately so it can be assessed and patched before public disclosure.

### How to Report

1. **GitHub Private Security Advisory (preferred):**  
   Use GitHub's built-in private reporting:  
   [https://github.com/chenglou/pretext/security/advisories/new](https://github.com/chenglou/pretext/security/advisories/new)

2. **Email (fallback):**  
   If you prefer email, contact the maintainer directly. Look up the commit email via git log or the npm package metadata for `@chenglou/pretext`.

### What to Include

A good vulnerability report should contain:

- A clear description of the vulnerability and its potential impact
- The affected version(s) of `@chenglou/pretext`
- A minimal reproducible proof-of-concept (PoC), ideally as a self-contained script or CodeSandbox link
- Steps to reproduce the issue consistently
- Any suggested mitigations or patches (optional but very welcome)

---

## Response Timeline

We aim to follow these response SLAs after receiving a valid report:

| Stage | Target Timeline |
|---|---|
| Initial acknowledgement | Within **72 hours** |
| Severity assessment | Within **5 business days** |
| Patch development begins | Within **10 business days** for High/Critical |
| Patch release & advisory published | Within **30 days** of confirmed vulnerability |

If you do not receive acknowledgement within 72 hours, please follow up — reports can occasionally land in spam.

---

## Severity Classification

We use the [CVSS v3.1](https://www.first.org/cvss/v3.1/specification-document) scoring system as a reference for severity classification:

| Severity | CVSS Score | Examples in Context |
|---|---|---|
| **Critical** | 9.0 – 10.0 | RCE or full sandbox escape via library input |
| **High** | 7.0 – 8.9 | XSS exploitable via normal library usage |
| **Medium** | 4.0 – 6.9 | Prototype pollution, logic bypass |
| **Low** | 0.1 – 3.9 | Minor information leakage, ReDoS with negligible impact |
| **Informational** | N/A | Best-practice improvements, no direct exploitability |

---

## Disclosure Policy

Pretext follows a **coordinated disclosure** model:

1. Reporter submits vulnerability privately.
2. Maintainer confirms receipt and triages severity.
3. A fix is developed and tested in a private branch.
4. A patch version is published to npm.
5. A GitHub Security Advisory (CVE if applicable) is published.
6. Reporter is credited in the advisory (unless they prefer anonymity).

We ask reporters to allow us the response timeline above before any public disclosure. We will not pursue legal action against security researchers who act in good faith and follow this policy.

---

## Supply Chain Security

- **Published package:** `@chenglou/pretext` on npm. Always verify you are installing from the official npm registry.
- **Integrity:** Use `npm ci` (or `bun install --frozen-lockfile`) to ensure lockfile integrity in production builds.
- **Checksum verification:** The npm lockfile pins exact resolved versions with integrity hashes. Do not disable integrity checking.
- **No postinstall scripts:** Pretext does not use `postinstall` or other lifecycle scripts that execute code on install.
- **Minimal dependencies:** The library aims to have minimal or zero runtime dependencies, reducing supply chain attack surface.

To verify the published package matches the source:

```bash
# Install and inspect the published tarball
npm pack @chenglou/pretext
tar -tzf chenglou-pretext-*.tgz
```

---

## Security Best Practices for Consumers

If you are using Pretext in your application, follow these guidelines:

1. **Sanitize all user input** before passing text into layout or measurement APIs.
2. **Do not render measurement metadata as raw HTML.** Pretext returns numeric and structured data — treat it as such.
3. **Keep Pretext updated.** Subscribe to releases via GitHub's Watch → Custom → Releases feature.
4. **Lock your dependency versions** using a lockfile (`package-lock.json`, `bun.lock`, `yarn.lock`).
5. **Audit your dependency tree** periodically with `npm audit` or equivalent.
6. **Use Subresource Integrity (SRI)** if loading Pretext from a CDN in a browser context.

---

## Acknowledgements

We thank all security researchers who responsibly disclose vulnerabilities to us. Confirmed reporters will be credited in the relevant GitHub Security Advisory unless anonymity is requested.

---

## Contact

For non-security bugs and feature requests, please use [GitHub Issues](https://github.com/chenglou/pretext/issues).  
For security issues, use the **private advisory channel** described above.

---

*This security policy was last reviewed: April 2026.*
