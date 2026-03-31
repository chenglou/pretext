# Measurement Host Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pretext` expose a host-config entrypoint for measurement so wrapper packages can bind non-browser measurement backends without changing the root browser API.

**Architecture:** Add a new `src/host.ts` entrypoint that exposes `createPretext(config)`, and implement host binding by routing the existing engine through a call-scoped measurement override in `src/measurement.ts`. Publish the advanced factory from a new package subpath so wrapper packages can opt in without changing normal user imports.

**Tech Stack:** TypeScript, Bun tests, package exports

---

### Task 1: Add a regression test for the advanced host seam

**Files:**
- Modify: `src/layout.test.ts`
- Test: `src/layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('createPretext binds prepare/layout to an injected measurement host', async () => {
  const hostState = {
    engineProfile: {
      lineFitEpsilon: 0.005,
      carryCJKAfterClosingQuote: false,
      preferPrefixWidthsForBreakableRuns: false,
      preferEarlySoftHyphenBreak: false,
    },
    cleared: 0,
  }

  const api = createPretext({
    measurement: {
      clearMeasurementCaches() {
        hostState.cleared++
      },
      getEngineProfile() {
        return hostState.engineProfile
      },
      getFontMeasurementState(font) {
        return { cache: new Map(), fontSize: parseFontSize(font), emojiCorrection: 0 }
      },
      getSegmentMetrics(seg) {
        return { width: measureWidth(seg, FONT), containsCJK: isWideCharacter(seg[0] ?? '') }
      },
      getCorrectedSegmentWidth(_seg, metrics) {
        return metrics.width
      },
      getSegmentGraphemeWidths() {
        return null
      },
      getSegmentGraphemePrefixWidths() {
        return null
      },
      textMayContainEmoji() {
        return false
      },
    },
  })

  const prepared = api.prepare('Hello world', FONT)
  expect(api.layout(prepared, 60, LINE_HEIGHT).lineCount).toBeGreaterThan(0)

  api.clearCache()
  expect(hostState.cleared).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/layout.test.ts`
Expected: FAIL because `createPretext` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// Add a new host entrypoint that exports createPretext(config)
// and wire clearCache() through the injected measurement host.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/layout.test.ts`
Expected: PASS for the new host-config test and no regressions in the existing invariant tests.

- [ ] **Step 5: Commit**

```bash
git add src/layout.test.ts src/host.ts src/measurement.ts package.json
git commit -m "feat: add measurement host-config entrypoint"
```

### Task 2: Add the host entrypoint and internal call-scoped measurement binding

**Files:**
- Create: `src/host.ts`
- Modify: `src/measurement.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a measurement host type and call-scoped override**

```ts
export function withMeasurementHost<T>(measurementHost: MeasurementHost, fn: () => T): T {
  const previousHost = measurementHostOverride
  measurementHostOverride = measurementHost
  try {
    return fn()
  } finally {
    measurementHostOverride = previousHost
  }
}
```

- [ ] **Step 2: Expose `createPretext(config)` from `src/host.ts`**

```ts
export function createPretext(config: PretextHostConfig): PretextHostApi {
  return {
    profilePrepare: bind(profilePrepare),
    prepare: bind(prepare),
    prepareWithSegments: bind(prepareWithSegments),
    layout: bind(layout),
    walkLineRanges: bind(walkLineRanges),
    layoutNextLine: bind(layoutNextLine),
    layoutWithLines: bind(layoutWithLines),
    clearCache: bind(clearCache),
    setLocale,
  }
}
```

- [ ] **Step 3: Keep the root browser package unchanged and export the advanced subpath**

```json
{
  "exports": {
    ".": {
      "types": "./dist/layout.d.ts",
      "import": "./dist/layout.js",
      "default": "./dist/layout.js"
    },
    "./host": {
      "types": "./dist/host.d.ts",
      "import": "./dist/host.js",
      "default": "./dist/host.js"
    }
  }
}
```

- [ ] **Step 4: Run typecheck and package build**

Run: `bun run check && bun run build:package`
Expected: exit 0, `dist/layout.*` and `dist/host.*` generated successfully.

- [ ] **Step 5: Commit**

```bash
git add package.json src/host.ts src/measurement.ts
git commit -m "feat: add measurement host-config entrypoint"
```

### Task 3: Verify browser-root behavior stays unchanged

**Files:**
- Modify: `src/layout.test.ts`
- Test: `src/layout.test.ts`

- [ ] **Step 1: Add one explicit browser-root smoke assertion**

```ts
test('root browser entrypoint still uses the browser measurement host', () => {
  const prepared = prepare('Hello world', FONT)
  const result = layout(prepared, 60, LINE_HEIGHT)
  expect(result.lineCount).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run tests to verify the root wrapper stays green**

Run: `bun test`
Expected: PASS with the existing 60 invariant tests plus the new host-config coverage.

- [ ] **Step 3: Run package smoke test**

Run: `bun run package-smoke-test`
Expected: exit 0, package entrypoints resolve correctly after the new export.

- [ ] **Step 4: Commit**

```bash
git add src/layout.test.ts
git commit -m "test: cover browser root and host-config entrypoints"
```

### Task 4: Record the deferred Lynx for Web follow-up

**Files:**
- Modify: `docs/superpowers/specs/2026-03-31-measurement-host-config-design.md`

- [ ] **Step 1: Keep the deferred web-platform note explicit**

```md
## Deferred Follow-Up

Implementing `lynx.getTextInfo` on Lynx for Web is a separate plan item.
This refactor only creates the seam that lets wrapper packages choose their
measurement backend.
```

- [ ] **Step 2: Final verification**

Run: `bun test && bun run check && bun run build:package && bun run package-smoke-test`
Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-03-31-measurement-host-config-design.md
git commit -m "docs: record deferred lynx web getTextInfo follow-up"
```
