# ADR 0026: Close the `fs.watch` platform confound, route #68's fix upstream, and adopt it

**Status:** Accepted
**Date:** 2026-08-15 (confound measurement, upstream routing); 2026-08-16 (adoption)
**Issue:** #68 (the `txId` double-bump), #70 (the `FSWatcher` handle leak), and GenvidTechnologies/mcp-utils#12 (the upstream fix this record routed the work to, since shipped in mcp-utils 0.7.0)

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
primitive. This record discharges that investigation, routes the fix
upstream, and — now that upstream has shipped it — adopts it.

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

### 3. The fix was routed upstream, not fixed here

`ExpectedChanges.consume` is single-shot by upstream's contract
(`this.entries.delete(key)` on first match), and `OptimisticWatcher`
inherits the identical defect — its Layer 2 is the same `consume` call, and
it is byte-identical between mcp-utils 0.5.1 and 0.6.0. The defect
**reproduces in mcp-utils' own API with no consumer involved**: through the
real `OptimisticWatcher` with its real default `fs.watch` factory, 4/4 runs
on Windows, an external write gives `txIdDelta: 2` and an
`expect()`-registered self-write gives `txIdDelta: 1` (should be 0). So
every mcp-utils consumer on Windows has this bug — a local patch inside
`src/mcp/server.ts` would fix only this repo's symptom while leaving the
shared root cause in place for everyone else.

Filed as **GenvidTechnologies/mcp-utils#12**, proposing an `ObservedState`
content-fingerprint ledger — reframing the question from "which event is
this?" (unanswerable) to "does the file now hold something we haven't
accounted for?" (answerable from the file, with **no timing term**).
Prototype measured 4/4: external 2→1, self 1→0, second genuine external
change still bumps, deletion still bumps. Control: four *distinct* external
writes 200 ms apart produced **8 raw watch events → exactly 4 bumps**, 3/3
runs — only duplicates collapse.

### 4. Upstream shipped, and this repo adopted it

GenvidTechnologies/mcp-utils#12 is closed. **mcp-utils 0.7.0** shipped the
`ObservedState` content-fingerprint ledger as a third layer inside
`OptimisticWatcher`, defaulted on
(`options.observed === undefined ? new ObservedState() : options.observed`).

The standing `CLAUDE.md` rule to audit `src/mcp/server.ts` for hand-rolled
equivalents of mcp-utils exports is now discharged for `setupWatcher`:
this repo bumped its floor to `^0.7.0` and replaced the hand-rolled watcher
with `OptimisticWatcher` outright. Adoption shape, and the three points that
read as settled but needed checking against the packed API rather than
assumed:

- `writeDomainConfig` stays **synchronous**. `suppress<T>(fn: () =>
  Promise<T>)` is async-only, but `expect(filePath)` is a separate
  synchronous method, and upstream documents Layer 2 as existing precisely
  for events arriving *after* the suppress window closes — so the
  synchronous write path uses `expect()`, not `suppress()`. `regenerate`
  does use the async `suppress()`, since its handler is already async.
- `expected: ExpectedChanges` is a **required** option on
  `OptimisticWatcher` — adoption does **not** retire that import; the
  existing instance is passed in.
- `watchDirs` holds a single **file** path with an injected
  `watcherFactory`. `WatcherFactory = (dir, onEvent) => WatchHandle` treats
  its first argument as an opaque string, so watching one file through this
  option is within contract; the default factory would otherwise do
  `fs.watch(dir, { recursive: true })` against a directory.
- `suppressWatcherDepth` was **deleted** (6 occurrences) as provably dead —
  incremented and decremented synchronously around a synchronous write
  while `fs.watch` delivers asynchronously, so the depth was always 0 on
  arrival.
- The `OptimisticWatcher` constructor is pure (field assignment only, no fs
  access), so it is constructed unconditionally to own `txId` even when no
  config file exists, and only `start()`ed behind the existing
  `fs.existsSync(CONFIG_PATH)` guard.

Measured outcome, real server over stdio, 3/3 identical runs on Windows:

| | before | after |
|---|---|---|
| self-write `txId` delta | 2 | 1 |
| footer `txId` == state `txId` | false | true |
| replaying the footer `txId` | rejected | accepted |
| external-write `txId` delta | 2 | 1 |
| external-change warnings | 2 | 1 |

The last row doubles as the **dead-watcher control**: 1 rather than 0 proves
events are still delivered post-fix, which a passing test alone could not
distinguish from a watcher that had silently stopped firing.

### 5. #70 needed more than `stop()` — a corrected premise

The plan (and the issue) assumed adopting `OptimisticWatcher` would close
#70 because it has `stop()`. It did not. `shutdown()` does call
`watcher.stop()`, but `shutdown()` is wired only to `SIGINT`/`SIGTERM`, and
a client that disconnects by closing stdin raises neither — so `stop()` is
never reached on that path. Measured: the server was still running 8
seconds after stdin close both **before and after** adoption. The fix is
`unref()`ing the `FSWatcher` inside the `watcherFactory`; after that it
exits in **2539 ms**, against **2531 ms** for a no-config server where the
`existsSync` guard means no watch handle is ever created. That no-config arm
was the control that isolated the handle as the cause — same `unref` idiom
as the `purgeExpired` interval beside it. The obvious answer (`stop()` is
enough) was wrong, and only a direct timing measurement caught it.

### 6. Why a content hash, not `stat` (the rejected alternative)

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
  *third* repo, not a toggle — which is why the upstream fix's tests are
  made platform-independent by injectable seams instead.
- **Test-shape consequence, general lesson.** `test/mcpHarness.ts`'s
  `SELF_WRITE_OBSERVED_TXID_BUMPS` moved from `2` to `1`, and K3 stopped
  being observation-gated. An observation gate is correct while a platform
  divergence is real, and becomes a **liability** the moment it stops being
  real: a gate that asserts only when the bug appears is indistinguishable
  from one that never fires because the subject is dead, and it keeps
  passing either way — nothing detects that expiry on its own. K3's
  replacement is deliberately two-sided (absence of the spurious warning
  *and* an accepted replay of the footer `txId`) for exactly that reason,
  and it was falsified against the pre-fix server (1/1 failing) rather than
  assumed to be correct.

## Compromise

**What was rejected.** Fixing `ExpectedChanges.consume`/`OptimisticWatcher`
locally, inside `src/mcp/server.ts`, was rejected: the defect lived in
mcp-utils' shared primitive, reproduced with no consumer involved, and
affected every mcp-utils consumer on Windows — a local patch would have
fixed only this repo's symptom while leaving the shared root cause in place
for everyone else. A `stat`-based (`size:mtimeMs`) fingerprint was rejected
for the `ObservedState` proposal in favor of a content hash, per measurement
6 above: it silently swallows a genuine same-size write inside NTFS's ~1 ms
mtime tick, which is a real missed change rather than a cosmetic
over-count. Adopting `OptimisticWatcher` *ahead of* the fix was rejected at
the time this record was first drafted — it would have replaced a
known-broken local watcher with a known-broken shared one, for no gain; that
constraint is now moot, since the fix shipped before adoption happened.
Treating `stop()` alone as sufficient to close #70 was also rejected, once
measurement showed the process still running 8 seconds after stdin close
with `stop()` wired to `shutdown()` alone — `unref()` on the underlying
`FSWatcher` handle was required in addition.

**What was accepted.** The reconciliation of `OptimisticWatcher`'s
`watchDirs: string[]`/directory-recursive-by-default contract against this
repo's single-file watch was resolved via the `watcherFactory` injection
point rather than by watching a directory; and its async `suppress(fn)`
against `writeDomainConfig`'s synchronous write was resolved by using the
separate synchronous `expect()` method instead, leaving `suppress()` in use
only where the caller (`regenerate`) is already async.

## Consequences

- **#68 and #70 are both closed by this branch.** The double-bump is fixed
  via upstream's `ObservedState` ledger (adopted, not hand-rolled here), and
  the leaked `FSWatcher` handle is fixed via `unref()` in the injected
  `watcherFactory`.
- The `@genvidtech/mcp-utils` floor is now `^0.7.0`, load-bearing for
  `OptimisticWatcher` + `ObservedState` (see `package.json` and the stated
  floor and adoption chain in `CLAUDE.md`).
- `test/mcpHarness.ts`'s `SELF_WRITE_OBSERVED_TXID_BUMPS` is `1`; K3 is a
  regular (non-observation-gated) assertion covering both the self-write and
  external-write paths.
- `suppressWatcherDepth` is removed from `src/mcp/server.ts`; it was
  provably dead once `OptimisticWatcher` owns write suppression.
