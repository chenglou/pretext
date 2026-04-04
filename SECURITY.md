# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Pretext, please report it privately through GitHub's private vulnerability reporting flow:

<https://github.com/chenglou/pretext/security/advisories/new>

Please do not open a public GitHub issue for sensitive reports.

When possible, include:

- A short description of the issue and why it matters
- Affected version(s)
- Reproduction steps or a small proof of concept
- Any suggested fix or mitigation

I will review reports on a best-effort basis and coordinate a fix before any public disclosure.

## Supported Versions

Security fixes, when needed, will be made against the latest published version of `@chenglou/pretext`.

## Scope

Pretext is a client-side text layout library. The most relevant reports are issues that could affect consumers using the package in real applications, for example:

- Unexpected code execution paths
- Vulnerabilities introduced by published package contents
- Denial-of-service style behavior from malicious inputs

For non-security bugs or feature requests, please use public GitHub issues instead.
