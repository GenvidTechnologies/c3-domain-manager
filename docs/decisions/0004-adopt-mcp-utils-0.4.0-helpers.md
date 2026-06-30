# ADR 0004: Adopt `@genvid/mcp-utils` 0.4.0 server helpers; harden mutate writes

**Status:** Accepted
**Date:** 2026-06-09
**Issue:** #10 / #11 — upgrade mcp-utils to 0.4.0 and adopt its helpers

> Recovered retroactively (2026-06-30) from commit `66debb4`.

---

## Context

`src/mcp/server.ts` had grown hand-rolled equivalents of plumbing that
`@genvid/mcp-utils` already exported (some since 0.3.0, adopted only now): local
`READ_ONLY`/`REGENERATE`/`MUTATE` annotation objects, a local
`paginatedResponse` helper, and ad-hoc result+footer string assembly. More
seriously, the `set-overrides` and `remove-overrides` handlers had **no
try/catch around their write path**: a failed `fs.writeFileSync` propagated
uncaught out of the tool callback instead of returning a `CallToolResult` error,
and a partial write left `txId` un-bumped while the on-disk file had changed —
and the watcher swallows its own event via `expectedChanges` — so the client
would never learn to reconcile.

mcp-utils 0.4.0 is additive/drop-in and provides `mcpContent` (single-block
result+footer), `withMcpErrors` (wraps an async handler so thrown errors become
`CallToolResult` errors, with an `onError` hook), and surfaces the annotation
constants and `paginatedContent` already present since 0.3.0.

## Decision

**Bump to `^0.4.0` and adopt the library helpers, replacing the hand-rolled
equivalents; wrap the mutate handlers in `withMcpErrors` with an `onError` txId
bump.**

- Drop the local annotation objects → import `READ_ONLY`/`REGENERATE`/`MUTATE`.
- `set-overrides`/`remove-overrides` build responses with `mcpContent(body,
  \`txId: ${txId}\`)`.
- `read-domain-index` uses `paginatedContent`; the stale-index warning rides as
  its trailing footer.
- Wrap both mutate handlers in `withMcpErrors` with an `onWriteError` hook that
  **bumps `txId` and logs** on write failure, so a failed write (a) returns a
  proper error result and (b) forces the client to re-read. The early-return
  validation paths (txId mismatch, override validation, empty input) return
  `isError` without throwing, so they correctly bypass `onError`. `regenerate`
  keeps its existing try/catch and is left unwrapped.

The issue's proposed `{prefix}` adoption was **dropped**: verification showed
`loadConfig` unwraps rather than produces errors, so it has no valid target.

## Alternatives Considered

**Keep the hand-rolled helpers.** Rejected: they had silently sat as duplicates
of the library's exports, and the dedup removes a maintenance burden. The
annotation constants in particular must match the library's shapes exactly.

**Add a bespoke try/catch to each mutate handler instead of `withMcpErrors`.**
Rejected: `withMcpErrors` standardizes the thrown-error → `CallToolResult`
conversion and gives the `onError` side-effect hook for free; bespoke try/catch
would re-implement it inconsistently across the two handlers.

## Consequences

- Observable response-shape deltas (no server test harness guards these):
  `read-domain-index` collapses from two content blocks to one; the stale-index
  warning moves into the paginated footer; the mutate `txId:` line now hugs the
  body with a single newline instead of a blank line. All intentional.
- A failed mutate write now returns an error result **and** bumps `txId` so the
  client reconciles. Known residual gap: the in-memory config is mutated before
  the write, so on failure the cache can still diverge from disk — out of scope;
  the txId bump at least signals reconciliation.
- Reinforces the standing rule (recorded in CLAUDE.md from this issue's retro):
  when bumping mcp-utils, audit the server for hand-rolled equivalents and verify
  the API against the packed types, not the release notes — the same discipline
  applied in [[0003-adopt-loadprojectconfig-schema-first]].
