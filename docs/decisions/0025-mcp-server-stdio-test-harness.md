# ADR 0025: MCP server stdio test harness

**Status:** Accepted
**Date:** 2026-08-15
**Issue:** #67 (build the harness) and #65 (the seven dead module-init initializers it clears the way to delete) — one branch, one ADR; #65 is the canonical target the branch is numbered after

---

## Context

`src/mcp/server.ts` exported only `startServer`. The `McpServer` instance was
a non-exported `const`, all 14 `registerTool` return values were discarded,
and every piece of mutable state (`txId`, `domainDirty`, the two caches,
`suppressWatcherDepth`) was module-private. `CLAUDE.md` recorded the
consequence plainly: server-specific behaviour — `isMcpError`/`CallToolResult`
propagation, `domainConfigCache` invalidation on both self-writes and watcher
events, optimistic-concurrency `txId` rejection, the mutate-tool
`withMcpErrors`/`onError` write-failure path, and the `mcpContent`/
`paginatedContent` response shapes — was covered only by `typecheck` plus the
core-level tests of the functions each tool wraps. No test exercised the
server itself.

Separately, issue #65 proposed deleting seven module-init bindings in
`server.ts` (`PROJECT_ROOT`, `EXTRACTED_DIR`, `CONFIG_PATH`, `CONFIG_DIR`,
`CONFIG_FILENAME`, `CONFIG_WATCH_KEY`, `EXTRACTED_EPHEMERAL`), each
initialized from `process.cwd()` at import time and unconditionally
overwritten by `startServer` before any tool could observe the original
value. [[0024-editor-validation-single-enumeration]]'s `## Excluded sites`
section had already named one of them (`CONFIG_WATCH_KEY`) as an
"unactioned follow-up, recorded but not filed," and stated plainly what the
deletion needed: "the MCP server test harness `CLAUDE.md` names as a known
follow-up, to confirm nothing observes the pre-overwrite value." This record
is that follow-up, filed and actioned.

## Decision

**Build the harness (Route 1: subprocess + real MCP `Client` over stdio),
then delete all seven initializers once the harness proves the deletion
output-neutral.**

### Route 1 vs. Route 2

Two routes were available:

- **Route 1 (adopted):** spawn the real server as a subprocess through its
  production CLI path (`process.execPath --import tsx src/cli.ts server
  --project-dir <tmp>`), connect a real `@modelcontextprotocol/sdk` `Client`
  over `StdioClientTransport`, and drive it exactly as any real MCP client
  would. Zero `src/mcp/server.ts` changes for the harness itself.
- **Route 2 (declined):** an in-process `InMemoryTransport`, driving the
  registered tool callbacks directly without a subprocess.

Route 2 was declined because it does not fit the code as it exists. With
`startServer` exporting nothing but itself, the `McpServer` a non-exported
`const`, and every `registerTool` return value discarded, Route 2 would first
require a lifecycle refactor to code that had no tests at all: export the
`McpServer` singleton, inject the transport instead of constructing
`StdioServerTransport` unconditionally, retain the `FSWatcher` handle so a
test can close it, make signal-handler registration skippable, and add a
state-reset entry point between test cases. None of that refactor is needed
to answer the question the harness exists to answer. Route 1 also structurally
sidesteps a Windows hazard: the only `fs.watch` handle capable of holding a
directory open lives in the child process, so `stop()` closing that process
before the harness removes the temp directory does the ordering Route 2 would
otherwise have to reproduce by hand.

### The corrected #65 trace

Issue #65's own text framed the safety argument as "the module-init values
are overwritten before tools are registered." That is backwards. All 14
`registerTool` calls execute at module init — strictly *before* `startServer`
runs at all, since they are top-level statements in the same module.
`startServer` overwrites the seven bindings, then calls `setupWatcher()`
(which is what creates the second reader — the `fs.watch` callback that reads
`CONFIG_WATCH_KEY`), and only as its last statement constructs the
`StdioServerTransport` and connects it. Nothing observes any pre-overwrite
value, but the reason is that **the only transport connection is the last
statement of `startServer`** — no registered callback can be dispatched until
that connection exists, and the watcher holding the second reader is not
created until the line immediately before it. Tool *registration* order is
irrelevant to the guarantee; transport *connection* order is what makes it
hold.

### Lifecycle and teardown

`startHarness()` spawns the child with `cwd` pinned to this repo's root
(resolved via `import.meta.url`, never the temp project directory) because
the child's own `--import tsx` resolves against its own `cwd`; the temp
project is reached only through `--project-dir`. `stderr` is piped rather
than inherited so the server's banner and startup lines don't splice into
mocha's own output. `stop()` is idempotent and strictly ordered:
`client.close()` (which closes the transport and awaits the child process
closing) → await the transport's own `onclose` signal → only then
`removeTempDir(root)`. That ordering exists because the child holds an
`fs.watch` handle on a file inside the temp directory; removing the directory
first is the Windows `EPERM`-on-delete hazard Route 1 already defuses
structurally, and the explicit await makes the defusal actual rather than
incidental. `transport.onclose` is wired before `client.connect(transport)`,
because the SDK's `Protocol.connect()` captures whatever `transport.onclose`
is at connect time — setting it after `connect()` would silently lose the
handler.

Costs were measured, not assumed: cold spawn including auto-generation of
`extracted/domain-index/` is 2285 ms; warm spawn (index already present but
regenerated) 2004 ms; warm spawn with the index pre-created (skipping
auto-generation via the same `existsSync` guard `startServer` itself uses,
`:628`) 1281 ms; a tool round-trip once connected is ~13 ms. Mocha's inline
`package.json` timeout is 5000 ms with no `.mocharc*` override, so every
spawning `before` hook sets `this.timeout(30_000)` — comfortably above the
measured cold-spawn cost, and raising the *hook* timeout rather than the
global `it` default, which governs a different phase.

### The `EISDIR` dead end and the chmod-plus-probe substitution

The write-failure suite (B4: the `withMcpErrors`/`onError` path) was planned
against `EISDIR` — replace `domain-config.json` with a directory of the same
name. Verified end-to-end and rejected: deleting the file to make room for
the directory fires the config-path `fs.watch` handler, which nulls
`domainConfigCache` the same as any other external change. `set-overrides`'s
own `loadDomainConfig()` call then re-reads from disk, finds a directory, and
returns a *read*-side `loadProjectConfig` error — never reaching
`writeDomainConfig()`'s write attempt at all. `isError` is `true`, but the
`write failed` notification never fires, which makes the result
indistinguishable from B1's already-covered read-side failure. Confirmed
deterministically, twice.

`chmod 0o444` gives the asymmetry B4 actually needs: it blocks only the write
half, leaving `loadDomainConfig()`'s read succeeding, so execution reaches
`writeDomainConfig()`'s `fs.writeFileSync`, which then hits `EPERM`. That
mechanism is itself uid-dependent, though, which is exactly the reason the
plan had originally steered away from it. Measured on Linux native ext4 (WSL
Debian):

| uid | Result |
|---|---|
| 1000 (non-root) | write blocked (`EACCES`) — the assertions hold |
| 0 (root) | write **succeeds** — `onWriteError` never fires |

Root bypasses the permission check entirely, so a hard assertion would go red
under a container running as root, for a reason unrelated to the code under
test. Rather than infer availability from `process.getuid?.()` — `undefined`
on Windows, where the read-only attribute blocks the write regardless, so a
uid check could not even express that platform — the `before` hook probes the
actual property the test depends on: it chmods the file, attempts a
throwaway write, and gates the `it` block on whether that write threw. If the
probe write succeeds, the mechanism is unavailable on this
platform/uid/filesystem and the test logs an explicit note and passes without
asserting `isError` or the notification. This is the same explicit-gate shape
the K3 test below uses for the `txId` double-bump.

### The `txId` double-bump: known-broken, not fixed here

Issue #68 (out of scope for this branch) is a bug: a single self-write
through `set-overrides`/`remove-overrides` sometimes fires more than one
`fs.watch` event, and `ExpectedChanges.consume` is single-shot, so the second
event is misclassified as an external change and `txId` is over-bumped.
Measured with a probe — create a file, `fs.watch` it, one
`fs.writeFileSync`, count callbacks over 500 ms:

| Platform | Node | Runs | events per write | double-bump |
|---|---|---|---|---|
| Linux native ext4 (WSL Debian) | v20.19.2 | 4/4 | 1 | does not reproduce |
| Linux native ext4 | v22.22.0 | 3/3 | 1 | does not reproduce |
| Windows | v24.11.1 | 4/4 | 2 | reproduces |

Run on native ext4, not `/mnt/c` — drvfs inotify semantics differ and would
not be representative. **The Node major version is confounded with the
platform in this measurement**: only Node 24 was available to test on
Windows, and only Node 20/22 under WSL, so the table cannot separate "this is
a Windows-specific `ReadDirectoryChangesW` behaviour" from "this is a Node-24
behaviour that happens to have only been run on Windows." Platform is the
likely cause — the repo's floor is Node 22, which gave one event on Linux —
but the confound is not eliminated, and a future investigation of #68 should
not treat this table as having settled which factor is responsible.

Given that, the bug is recorded rather than fixed on this branch, using
"Option A": platform-neutral assertions for the properties that hold either
way, plus one explicitly observation-gated test for the bug's own signature.
B2a asserts `txId` is *at least* the mutate tool's own footer value rather
than exactly equal to it, since the spurious event may have already landed by
the time a following `get-state` runs. B3 rejects a deliberately stale
`txId: 0` — stale under both the broken and the fixed behaviour on both
platforms — rather than the value a mutate tool actually handed back, which
would only be stale where the bug reproduces. K3 (`test/mcp/mutation.test.ts`)
is the one exception: it waits for the spurious `External change detected`
warning on a short deadline and asserts the full broken trajectory only if
that warning actually arrives; if it doesn't, it logs an explicit note and
passes without asserting anything about `txId`. Because CI is `ubuntu-latest`
with no OS matrix, K3's non-firing branch is the one CI takes today — a
platform-neutral test that cannot fail on the strength of platform alone,
which is the property that makes it safe to carry a known-broken assertion at
all. `SELF_WRITE_OBSERVED_TXID_BUMPS` in `test/mcpHarness.ts` is the single
constant both the harness and `mutation.test.ts` key on; when #68 lands, that
one constant flips and every dependent assertion follows.

### C4: two distinct claims about criterion 2, not one

Issue #65's criterion 2 asks that whatever confirms nothing reads the
pre-overwrite value be stated explicitly. Two things must be said in answer,
and they are separate claims: what the criterion asks for cannot be
established by a test, and what the harness *does* establish is something
else. Conflating them is exactly what would let a future reader re-open
criterion 2 on the grounds that "we have a harness now" — so they are set
down below as two paragraphs, not one paragraph doing two jobs.

**Criterion 2 — that nothing ever observed the pre-overwrite value — is
unpinnable by any test of any shape.** This was established by mutation, not
by inspection: `startServer`'s `CONFIG_WATCH_KEY = loc.configWatchKey`
assignment was deleted from the then-current tree, the real server driven
end-to-end over stdio against a temp project
exactly as the harness does today, and the observable behaviour was
byte-identical — the same `set-overrides` response, the same logging
notifications, the same `get-state` output. The structural reason a mutation
test *can* prove this negative here, where mutation testing usually can only
lower-bound a claim: both the pre-overwrite write path and the watcher's
read path consult the *same variable*, and the `fs.watch` callback discards
its own `filename` argument entirely, so `CONFIG_WATCH_KEY` is a pure
self-consistent token passed to `ExpectedChanges.add`/`.consume` — any string
value produces identical behaviour, because nothing external is ever compared
against it. No black-box test, from any transport, at any granularity, can
observe a difference that does not exist.

**Separately, the harness does guard a real regression class: an assignment
silently dropped from `startServer` in a future edit.** `tsc --strict`
provides no protection here — TypeScript performs no definite-assignment
analysis for a module-scope `let` read from inside a nested function, so a
future edit that drops one of `startServer`'s seven assignments (for example,
the `CONFIG_WATCH_KEY = loc.configWatchKey` line at `:624` itself) type-checks
clean with no definite-assignment diagnostic. This was confirmed twice: once
in isolation before the deletion, and again against the post-deletion tree
under `strict: true`. Where `tsc` is silent, the three `test/mcp/` suites are
not — a dropped assignment leaves the corresponding binding `undefined` at
first tool call, which the harness's read-only and mutation suites alike
would surface as a runtime failure, not a silent divergence.

These are different properties of different things. The first is about
whether *this specific value*, `CONFIG_WATCH_KEY`, could ever matter — it
provably cannot, so no test was ever owed for it. The second is about whether
*the general shape* of "delete an initializer, keep the assignment" is safe
to repeat — it is, but only because something now exercises the assignment
at runtime. The harness earns the second claim; it does not, and structurally
cannot, earn the first.

### C5: the ADR 0024 follow-up, filed and actioned

[[0024-editor-validation-single-enumeration]]'s `## Excluded sites` section
named `server.ts`'s `CONFIG_WATCH_KEY` module-init duplicate as an
"unactioned follow-up, recorded but not filed," and stated that its deletion
"needs the MCP server test harness `CLAUDE.md` names as a known follow-up, to
confirm nothing observes the pre-overwrite value," closing with "Worth a
separate issue; not filed here." That issue is #65, and this branch is the
action: the harness was built first, the mutation test above confirmed the
predicted safety, and the deletion landed.

The scope broadened along the way, from the one binding ADR 0024 named to all
seven module-init bindings in `server.ts:34-40`. That broadening was not
optional once the dependency structure was examined: `EXTRACTED_DIR` and
`CONFIG_PATH` derive from `PROJECT_ROOT`, and `CONFIG_DIR`, `CONFIG_FILENAME`,
and `CONFIG_WATCH_KEY` derive from `CONFIG_PATH`. They are a dependency
chain, not seven independent lines — deleting `CONFIG_WATCH_KEY` alone while
leaving the other six initialized from `process.cwd()` would have left the
same class of dead-initializer confusion in place for the other six, for no
reduction in risk, since the same mutation argument that clears
`CONFIG_WATCH_KEY` applies identically to each of them (`startServer`
overwrites every one before first use, on the same transport-connection
guarantee).

The deletion-not-unification treatment ADR 0024 prescribed for this site was
upheld: ADR 0024 explicitly distinguished `server.ts`'s `CONFIG_WATCH_KEY`
duplicate from the `editorValidation.ts` case it was itself resolving, saying
the right eventual treatment was deletion of the module-init duplicate, "not
unification with `collectSectionFiles` or any other seam." That is what
happened — the seven bindings were deleted outright and replaced with
explicitly-typed uninitialized declarations, not routed through any shared
resolution seam.

## Compromise

**What was rejected.** Route 2's in-process harness was priced and declined
above — it would have bought faster test execution (no subprocess spawn) at
the cost of a lifecycle refactor to code with zero prior test coverage,
undertaken for the harness's convenience rather than because the server
needed it. `EISDIR` was rejected for B4 once it was shown, empirically, not
to reach the code path the row exists to exercise.

**What was accepted.** Route 1's harness is black-box over stdio: it proves
behaviour through tool responses and logging notifications only, and cannot
observe module state (`txId`, `domainDirty`, the two caches,
`suppressWatcherDepth`) directly. Anything not reachable through one of the
14 registered tools is untested by this harness, by construction. The `txId`
double-bump (#68) is documented by K3's observation-gated test, not fixed —
on CI's `ubuntu-latest` platform, that test takes its non-asserting branch
today, so the suite's green status does not, by itself, mean the bug is
absent; it means the bug did not present on this run.

## Consequences

- `test/mcpHarness.ts`, `test/mcp/tools.test.ts`, `test/mcp/mutation.test.ts`,
  and `test/mcp/writeFailure.test.ts` are the first tests of any kind for
  `src/mcp/server.ts`. 386 tests pass across 17 files, unchanged in both
  counts across the deletion in the third branch commit — the before/after
  pair issue #65 asked for.
- `src/mcp/server.ts`'s seven module-init bindings are explicitly-typed
  uninitialized declarations (`: string` / `: boolean`), not initializer
  expressions. Explicit annotations are load-bearing, not stylistic: without
  an initializer there is nothing to infer from, so omitting the annotation
  would yield `any` and trip `--max-warnings 0`.
- `CLAUDE.md`'s "no test harness for the MCP server" claim is corrected to
  name what is and is not covered; see that file directly rather than this
  record for the current statement, per this repo's documentation
  conventions (a summary drifts, the primary source does not).
- Route 2 remains available as a future option if the lifecycle refactor it
  requires is ever independently justified; nothing here forecloses it, and
  nothing here undertakes it.

## Alternatives Considered

**Fix #68 as part of this branch**, since the harness makes the bug visible
for the first time. Rejected: #68 was filed and scoped separately during
planning, specifically to keep this branch's work — a harness plus a
seven-line deletion — from growing into a concurrency fix whose own
platform-specific verification (a real fix would need to be shown correct on
Windows, where it reproduces) is a different task with a different shape of
evidence than anything else on this branch.

**Add a Windows CI leg to observe #68 unconditionally**, rather than gating
K3 on observation. Rejected for the same reason
[[0024-editor-validation-single-enumeration]] declined it for a different
gap: `.github/workflows/ci.yml` delegates to a shared reusable workflow owned
by `GenvidTechnologies/public-github-actions` with a hardcoded
`runs-on: ubuntu-latest` and no OS matrix, so adding one is a cross-repo
change outside this issue's scope.

**Delete only `CONFIG_WATCH_KEY`**, the one binding ADR 0024 named. Rejected
per C5 above: the seven bindings are a dependency chain, and the same
transport-connection safety argument applies to all of them identically, so
there was no principled line to stop at after examining the dependency
structure.
