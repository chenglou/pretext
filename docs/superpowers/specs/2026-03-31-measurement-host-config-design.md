# Measurement Host Config Design

## Goal

Make `pretext` keep its current browser-first public API while allowing wrapper packages such as `lynx-pretext` to bind a different measurement implementation without forking the layout engine.

## Problem

Today `pretext` hard-binds browser canvas measurement in two places:

- `src/layout.ts` imports the browser `measurement.ts` module directly.
- `src/line-break.ts` imports `getEngineProfile()` from the same module directly.

That makes `lynx-pretext` copy large parts of `pretext` just to swap the measurement primitive from canvas to `lynx.getTextInfo()`. It also blocks an upstreamable host-config path because the current public package exports only the browser-bound entrypoint.

## Goals

- Keep the root `@chenglou/pretext` API unchanged for normal browser users.
- Add an advanced host-config entrypoint that wrapper packages can bind once.
- Avoid module-level mutable backend registration in the hot path.
- Keep the current layout semantics and performance characteristics for the browser build.
- Make the first host-config seam measurement-focused, but shaped so future host differences can grow under the same config object.

## Non-Goals

- Do not add runtime platform detection to the main package root.
- Do not implement `lynx.getTextInfo` on Lynx for Web in this change.
- Do not change the public `prepare()` / `layout()` signatures.

## Design

### 1. Add an advanced host entrypoint

Add a new exported subpath, tentatively `@chenglou/pretext/host`, that exposes:

- `createPretext(config: PretextHostConfig)`
- host-related types (`PretextHostConfig`, `MeasurementHost`, shared metric types)

The root package entrypoint remains browser-bound and unchanged.

`PretextHostConfig` starts as:

```ts
type PretextHostConfig = {
  measurement: MeasurementHost
}
```

This keeps room for future host-specific seams without forcing another API break.

### 2. Make the measurement seam mirror the existing module surface

Rather than inventing a new minimal interface and then translating both implementations into it, the host abstraction should mirror the current measurement module surface closely. That keeps the refactor smaller and lets both browser and Lynx implementations slot in naturally.

The host shape is:

```ts
type MeasurementHost = {
  clearMeasurementCaches(): void
  getSegmentMetrics(seg: string, cache: Map<string, SegmentMetrics>): SegmentMetrics
  getEngineProfile(): EngineProfile
  getCorrectedSegmentWidth(seg: string, metrics: SegmentMetrics, emojiCorrection: number): number
  getSegmentGraphemeWidths(
    seg: string,
    metrics: SegmentMetrics,
    cache: Map<string, SegmentMetrics>,
    emojiCorrection: number,
  ): number[] | null
  getSegmentGraphemePrefixWidths(
    seg: string,
    metrics: SegmentMetrics,
    cache: Map<string, SegmentMetrics>,
    emojiCorrection: number,
  ): number[] | null
  getFontMeasurementState(
    font: string,
    needsEmojiCorrection: boolean,
  ): {
    cache: Map<string, SegmentMetrics>
    fontSize: number
    emojiCorrection: number
  }
  textMayContainEmoji(text: string): boolean
}
```

### 3. Initial implementation: call-scoped measurement binding

The first implementation does not physically split `layout.ts` and `line-break.ts` into separate factories yet. Instead it introduces:

- `src/host.ts`
- an internal call-scoped measurement host override inside `src/measurement.ts`

`createPretext(config)` returns wrapper functions that execute the existing exported layout APIs inside `withMeasurementHost(config.measurement, ...)`.

That means:

- the root browser package keeps using the existing browser measurement implementation by default
- wrapper packages get a real explicit host-config entrypoint immediately
- the refactor stays small enough to land without moving two large core files at once

This is intentionally a first seam, not the final internal architecture. If upstream later wants a deeper cleanup, the current external `createPretext(config)` contract can stay stable while the internals move from dynamic binding to fully split factories.

### 4. Export strategy

Update `package.json` exports with a new subpath for the advanced factory. The root export remains the same.

That gives future wrappers two paths:

- today: `lynx-pretext` can import the host entrypoint explicitly
- later: upstream can decide whether it wants a first-party shell like `@chenglou/pretext/lynx`

### 5. Testing

Keep the current browser-root tests passing unchanged, then add one focused host-config test path:

- bind `createPretext()` to a deterministic fake measurement host
- verify `prepare()` / `layout()` still behave correctly through the advanced entrypoint
- verify cache clearing still resets both analysis caches and host measurement caches

The purpose is not to duplicate the whole test suite through two entrypoints; it is to prove that the new host seam is real and not accidentally still coupled to browser measurement internals.

## Trade-Offs

### Why not runtime backend detection?

Runtime detection would keep the short diff smaller, but it would hard-code host concerns into the root package and make future host differences harder to reason about. It also fails the requirement that wrappers should own host selection.

### Why is the initial implementation still using internal dynamic scope?

Because `line-break.ts` currently imports `getEngineProfile()` directly from `measurement.ts`, a full physical extraction would be a much larger move. The chosen implementation keeps the external API in the approved host-config shape while limiting the first diff to the measurement seam.

The important distinction from a plain global setter is that backend choice is explicit and call-scoped through `createPretext(config)`, not process-global initialization state.

## Migration Path

1. Land the host-config factory and call-scoped measurement binding in `pretext`.
2. Keep the root browser API unchanged.
3. Update `lynx-pretext` to consume the new host entrypoint instead of maintaining a deep fork.

## Deferred Follow-Up

The separate idea of implementing `lynx.getTextInfo` on Lynx for Web should stay as a later plan item. The likely direction is:

- width-only measurement can use browser canvas safely
- full `getTextInfo` parity for wrapping/content likely needs a second browser-specific layout strategy and should not block this host-config refactor
