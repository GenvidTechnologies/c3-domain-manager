# ADR 0026: Close the `fs.watch` platform confound and route #68's fix upstream

**Status:** Accepted
**Date:** 2026-08-15
**Issue:** #68 (the `txId` double-bump) and GenvidTechnologies/mcp-utils#12 (the upstream fix proposal this record routes the work to)

---

## Context

[[0025-mcp-server-stdio-test-harness]] recorded a 3-row table measuring
`fs.watch` events-per-write on Linux and Windows and stated explicitly: "The
Node major version is confounded with the platform in this measurement... a
future investigation of #68 should not treat this table as having settled
which factor is responsible." That table also only covered the self-write
path (`Layer 2`, `ExpectedChanges.consume`), leaving the external-write path
unmeasured, and it did not investigate whether the bug's root cause was
`server.ts`-local or lived one level down, in mcp-utils' own watcher
primitive. This record discharges that deferred investigation.

## Decision

### 1. The node-version/platform confound is closed

A 3×2 matrix, **24 runs, 4 per cell**. Probe: create a file, `fs.watch` it,
perform one `fs.writeFileSync`, count callbacks over 500 ms.

| Platform / FS | Node | Runs | Events per write |
|---|---|---|---|
| Windows 11, NTFS | v24.11.1 | 4/4 | 2 |
| Windows 11, NTFS | v22.21.1 | 4/4 | 2 |
| Windows 11, NTFS | v20.17.0 | 4/4 | 2 |
| WSL Debian, native ext4 | v25.6.1 | 4/4 | 1 |
| WSL Debian, native ext4 | v22.22.0 | 4/4 | 1 |
| WSL Debian, native ext4 | v20.19.2 | 4/4 | 1 |

Perfectly separated by platform, invariant across three node majors on each
side. Cause is the platform mechanism (`ReadDirectoryChangesW` vs inotify),
**not** the node version. Linux runs were on native ext4, not `/mnt/c`
(drvfs inotify semantics differ and would not be representative). Note the
methodological point worth recording: WSL Debian's *default* node is
v20.19.2 — the very version the original measurement used — so a naive
"check what WSL offers" would have concluded the confound was unclosable; it
was closable via `nvm`-installed versions.

This ADR **supersedes ADR 0025's table**, which is not edited in place.

### 2. Scope expands to both paths

The external-write path double-bumps too: `txId` +2 and **two**
`External change detected` warnings for one external write, measured through
the real server. Same root cause (two OS events for one logical change,
nothing coalesces) but a **different code path** — Layer 2 is not involved
at all. Governing semantic adopted: **`txId` counts logical changes, not
watcher events.**

### 3. The fix lands upstream, not here

`ExpectedChanges.consume` is single-shot by upstream's contract
(`this.entries.delete(key)` on first match), and `OptimisticWatcher`
inherits the identical defect — its Layer 2 is the same `consume` call, and
it is byte-identical between mcp-utils 0.5.1 and 0.6.0. The defect
**reproduces in mcp-utils' own API with no consumer involved**: through the
real `OptimisticWatcher` with its real default `fs.watch` factory, 4/4 runs
on Windows, an external write gives `txIdDelta: 2` and an
`expect()`-registered self-write gives `txIdDelta: 1` (should be 0). So
every mcp-utils consumer on Windows has this bug.

Filed as **GenvidTechnologies/mcp-utils#12**, proposing an `ObservedState`
content-fingerprint ledger — reframing the question from "which event is
this?" (unanswerable) to "does the file now hold something we haven't
accounted for?" (answerable from the file, with **no timing term**).
Prototype measured 4/4: external 2→1, self 1→0, second genuine external
change still bumps, deletion still bumps. Control: four *distinct* external
writes 200 ms apart produced **8 raw watch events → exactly 4 bumps**, 3/3
runs — only duplicates collapse.

### 4. `OptimisticWatcher` adoption is deferred

The standing `CLAUDE.md` rule to audit `src/mcp/server.ts` for hand-rolled
equivalents of mcp-utils exports is now **discharged for `setupWatcher`**:
`OptimisticWatcher` *is* its upstream equivalent, and had never been audited
against it. Outcome: adoption **deferred** until the fixed version ships, so
adoption and the floor bump land together rather than adopting a still-broken
watcher. Two contract mismatches to reconcile at adoption time: it takes
`watchDirs: string[]` with a default factory doing
`fs.watch(dir, { recursive: true })`, whereas this repo watches a single
**file**; and its `suppress(fn)` is **async** where `writeDomainConfig` is
synchronous. Also recorded: mcp-utils 0.6.0 differs from 0.5.1 in
`walkFiles` **only**, which this repo does not import — the bump is inert
here.

### 5. Why a content hash, not `stat` (the rejected alternative)

The obvious cheap fingerprint was measured and **rejected**. On NTFS, over
two *distinct* writes of equal size: `size:mtimeMs` collided **54/60 at a
0 ms gap** (173/200 in a tight loop), and **0/60 at gaps ≥1 ms**. NTFS
mtime granularity is ~1 ms despite sub-millisecond precision in the reported
value, so a stat fingerprint silently swallows a genuine same-size write
inside that tick — a real missed change, the sharp failure mode. Content
hashing collided **0/50** on the identical case, at 105.6 µs @ 2 KB /
190.3 µs @ 32 KB / 577.9 µs @ 512 KB per event. Worth recording because the
unsound option is the one that looks obviously sufficient.

### Also recorded

- Neither `eventType`, `filename`, `size` nor `mtimeMs` discriminates the
  duplicate — byte-identical on every field, `mtimeMs` to sub-ms precision;
  inter-event gap 0.2–0.9 ms. This answers an open question ADR 0025 and
  issue #68 both left standing.
- Why upstream never caught it: its real-`fs.watch` smoke test asserts
  `expect(externalCalls.length).to.be.greaterThan(0)` rather than `=== 1`
  (`test/optimisticWatcher.test.ts:312` in mcp-utils), and its CI is
  Linux-only.
- **CI consequence, stronger than previously recorded:** the shared
  `public-github-actions` `node-gate.yml:17` is `runs-on: ubuntu-latest`
  with **no OS input at all**. A Windows leg is therefore a change to a
  *third* repo, not a toggle — which is why the upstream proposal's tests
  are made platform-independent by injectable seams instead.
- The `FSWatcher` leak split out as **#70** (this repo) — confirmed defect,
  isolated symptom: with a config present the server survives stdin close
  by 6s+; with no config, so `src/mcp/server.ts:600`'s `existsSync` guard
  skips watcher creation, it exits 0. Same binary, one variable.

## Compromise

**What was rejected.** Fixing `ExpectedChanges.consume`/`OptimisticWatcher`
locally, inside `src/mcp/server.ts`, was rejected: the defect lives in
mcp-utils' shared primitive, reproduces with no consumer involved, and
affects every mcp-utils consumer on Windows — a local patch here would fix
only this repo's symptom while leaving the shared root cause in place for
everyone else. A `stat`-based (`size:mtimeMs`) fingerprint was rejected for
the `ObservedState` proposal in favor of a content hash, per measurement 5
above: it silently swallows a genuine same-size write inside NTFS's ~1 ms
mtime tick, which is a real missed change rather than a cosmetic
over-count. Adopting `OptimisticWatcher` now, ahead of the fix, was
rejected — it would replace a known-broken local watcher with a
known-broken shared one, for no gain.

**What was accepted.** #68 stays open and unfixed on this branch; the work
here is measurement and routing, not remediation. The reconciliation of
`OptimisticWatcher`'s `watchDirs: string[]`/directory-recursive contract
against this repo's single-file watch, and its async `suppress(fn)` against
`writeDomainConfig`'s synchronous write, is deferred to adoption time rather
than resolved now.

## Consequences

- **#68 remains open.** This branch records and routes; it does not fix.
  `test/mcpHarness.ts`'s `SELF_WRITE_OBSERVED_TXID_BUMPS` stays at `2` and
  the `KNOWN-BROKEN` observation-gated test stays as-is.
- When mcp-utils ships the fix: bump the floor (a two-place change —
  `package.json` **and** the stated floor in `CLAUDE.md`, plus an entry in
  the "When bumping `@genvidtech/mcp-utils`…" chain), add the ~two-line
  `ObservedState` guard, flip the constant to `1`, and close #68 and #70.
