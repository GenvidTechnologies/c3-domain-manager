---
type: decision-record
---

# ADR 0028: MCP server multi-project support

**Status:** Accepted
**Date:** 2026-09-01
**Issue:** #77 — host more than one C3 project root over the MCP server; the sibling of `GenvidTechnologies/construct3-chef#95`, which the two servers ship together with inside the `gvt-construct3` plugin

---

## Context

### The single-root prerequisite had already shipped

Issue #16 closed with `startServer` receiving a `ResolvedLocations` whose
`projectRoot` came from `resolveProjectRoot` — precedence `--project-dir` >
`C3_PROJECT_DIR` > `project.c3proj` discovery > cwd
([[0007-project-dir-resolverootfolder]]). That made a *nested* project
reachable; it did not make *two* projects reachable in the same server
process. [[0002-configurable-locations-adapters-seam]]'s `resolveLocations`
seam is what made this issue tractable at all: it already returns a
per-project value object (`projectRoot`, `configPath`, `configDir`,
`configFileName`, `extractedDir`, `extractedEphemeral`, `configWatchKey`), so
multi-project support could be built as "a registry of that value object plus
its per-project runtime state" rather than as a hand-rolled multi-root
structure.

### Where this repo differs from `construct3-chef#95`

Three structural differences shaped the design, each cutting a different way:

1. **No module-level `C3Project` handle.** Per
   [[0008-adopt-openproject-option-a]] (Option A), every consumer of C3 file
   discovery calls `openProject(rootDir)` itself
   (`domainGenerator.ts`/`domainAnalysis.ts`/`editorValidation.ts`/
   `addonInventory.ts`) rather than the server holding one handle beside a
   root. There is no stale-handle pair to keep atomic — a smaller state seam
   than chef's.
2. **Two caches chef does not have.** `domainConfigCache`, `domainDataCache`,
   and the `domainDirty` flag the stale-index warning rides on are all
   per-project by nature, and the external-write watcher clears both caches
   at once. A registry that lets one project's external write clear another
   project's caches produces a plausible *wrong* answer, not an error — the
   highest-risk axis, and the one designed first rather than last (see
   acceptance row R21).
3. **No dynamically registered tools.** All of this server's 15 tools are
   static; chef's per-project `op-*` tool scaffolding and its namespace-
   collision handling have no counterpart here.

## Decision

### Per-project state lives on `ProjectContext`; selection lives on a generic `ProjectRegistry<T>`

Every module-level binding in `src/mcp/server.ts` that was per-project
(`PROJECT_ROOT`, `EXTRACTED_DIR`, the four config-path fields, the ephemeral
flag, `domainDirty`, the `ReadWriteLock`, the watcher, both caches) moved onto
`src/adapters/projectContext.ts`'s `ProjectContext` — one instance per
registered project, holding `root`/`extractedDir`/`configPath`/`id` as
`#private` getter-only fields (immutable by construction) plus the six
methods that used to close over module state
(`readExtracted`/`appendStaleWarning`/`staleFooter`/`loadDomainConfig`/
`getDomainData`/`writeDomainConfig`) and the lifecycle pair
`start()`/`stop()`. `writeDomainConfig` stays **synchronous** — the watcher's
`suppress()` is async-only, so it calls the synchronous `expect()` instead,
per [[0026-fs-watch-platform-confound-and-upstream-routing]]'s point that
`expect()` exists precisely for events arriving after a suppress window
closes — and it updates `domainConfigCache` without clearing
`domainDataCache`, preserving the existing asymmetry the stale-index warning
depends on rather than "tidying" it into invalidating everything.

Selection is `src/adapters/projectRegistry.ts`'s `ProjectRegistry<T>`, generic
in `T` by deliberate choice: the module imports no `node:path`, `node:fs`, or
`@genvidtech/c3source`, so it never mentions `ProjectContext` at all.
`resolve(id?)` is nothing more than a `Map.get`. Every call into
`src/domain/` from either adapter class keeps its exact current
`rootDir`-first signature — `computeDomainData(ctx.root, config)`,
`listUncategorized(ctx.root, config)`, and so on, with `ctx.root` standing
where the module-level `PROJECT_ROOT` constant stood before — so
[[0008-adopt-openproject-option-a]]'s rejected Option B (threading a
`C3Project` handle through the public API) is not reintroduced by a different
route: `src/index.ts` is unchanged and no file under `src/domain/` imports
from `src/adapters/`.

### The selector is an id, never a path

A path-valued `project` parameter would turn all 14 project-scoped tools into
an arbitrary-filesystem-read surface. `ProjectRegistry<T>`'s genericity makes
the alternative structural rather than a check that could be bypassed: since
the module never imports a filesystem primitive, a path-shaped selector such
as `"../other"` or `"C:/tmp"` is simply a `Map` miss, resolved through the
same unknown-id error every other bad selector takes. A concrete registry
would have needed `import type { ProjectContext }`, and a bare import-count
check cannot distinguish an erased type-only import from a runtime one — the
generic sidesteps that ambiguity entirely rather than arguing around it.

### Omission resolves to the sole project at N = 1; N > 1 returns the enumerating error

`ProjectRegistry.resolve(id?)`: an omitted `id` at exactly one registered
project returns that project; at more than one, it returns an `mcpError`
naming every known id. An unknown `id` takes the identical error path, so
there is one error site rather than two. Three considerations settled this
rather than a stylistic preference: every existing client that never sends
`project` keeps working byte-identically at N = 1 (row S2); the input schema
stays uniform, since zod cannot express "required iff the runtime registry
has more than one entry," so a conditionally-required field would only be
enforced by hand in the handler anyway; and the N > 1 omission error and the
unknown-id error are legitimately the same error, not two that happen to look
alike.

### Exactly one lock acquisition per call, inside `registerProjectTool`

`ReadWriteLock` (from `@genvidtech/mcp-utils`) has no owner tracking, no
reentrancy, and is write-preferring — `acquireRead` queues behind any pending
write, verified against the shipped `rwlock.js` — so a nested acquisition
deadlocks in both directions, not only write-inside-write. `registerTool`'s
14 project-scoped call sites (13 pre-existing project.c3proj-scoped tools plus
the ones added by this issue) previously each took `rwlock` directly; that
discipline now lives in exactly one place, `registerProjectTool`, which
resolves the selector against `REGISTRY` *outside* any lock — so an unknown
project errors without ever taking one — then acquires `ctx.rwlock.read` or
`ctx.rwlock.write` exactly once before invoking the tool body. `body` itself
must never acquire `ctx.rwlock`. This was mutation-proved, not merely argued:
injecting a second `ctx.rwlock.read` around the registry resolution inside
`registerProjectTool` timed out every write-mode tool identically, confirming
the reentrancy hazard is real rather than theoretical, then was reverted.

### `list-projects` is exempt from the selector and never emits a `txId`

`list-projects` is registered directly through `server.registerTool`, not
through `registerProjectTool` — the one tool with no `project` selector,
since its whole purpose is letting a client discover which ids exist. It
reports each registered id and its resolved root, and **deliberately no
`txId`**: a listing is a snapshot, not a reservation, and giving it one would
add a fourth token-emission site (beside `set-overrides`, `remove-overrides`,
and the external-change watcher's log line) inviting a client to treat a
listing as if it pinned a value that can move before the client acts on it.

### The composite `<projectId>:<n>` token, and why a shared counter fails

A bare per-project integer `txId` is ambiguous the moment more than one
project exists: a client holding `txId: 12` cannot say which project's
counter it names, so the optimistic-concurrency check in `set-overrides`/
`remove-overrides` could accept a token minted for one project against
another whenever their counters happened to coincide — a stale-write guard
that silently stops guarding, exactly at a mutation. The chosen design is
**N watchers, N counters, a composite `<projectId>:<n>` token** — one
`OptimisticWatcher` per `ProjectContext` rather than one shared watcher with
either a bare shared counter or a union token whose `<n>` is a global
counter.

Two facts, read out of the packed runtime of `@genvidtech/mcp-utils@0.8.0`'s
`OptimisticWatcher` (behavioural claims a `.d.ts` cannot express), ruled out
sharing one watcher across projects:

- **`start()` is all-or-nothing across `watchDirs`.** It early-returns once
  any handle exists, then iterates every entry calling the injected
  `watcherFactory` with no per-directory `try`/`catch`. `fs.watch` throws
  `ENOENT` on a non-existent path — which is why this server's watch start
  is guarded with `fs.existsSync(configPath)` per project. Under one shared
  watcher over N config files that guard cannot be expressed: either
  `watchDirs` is pre-filtered at construction, and a project whose
  `domain-config.json` is created *later* is never watched (no second
  `start()` runs, since `handles.length > 0` makes it a no-op); or it isn't,
  and one missing config throws out of `start()` after installing handles
  for the projects ahead of it, leaving a watcher that can never restart.
  Under N watchers, the existing per-project `existsSync` guard is unchanged
  and one missing config affects exactly that one project.
- **`suppressDepth` is per-instance, and its Layer-1 `suppress` *seals* the
  events it drops.** `handleEvent`'s first branch is `if
  (this.suppressDepth > 0) { this.observed?.record(filename); return; }` —
  `record()` writes the path's content fingerprint into the `ObservedState`
  ledger, sealing it (the class's own JSDoc word) as *accounted for*. Under a
  single shared watcher, `regenerate` on project A — which wraps
  `generateDomainIndex` in `watcher.suppress(...)` — suppresses events for
  *every* project for the duration of that call, and a genuine external
  write to project B arriving in that window is not merely dropped: it is
  recorded as accounted-for, so the content-fingerprint ledger (Layer 3)
  cannot recover it afterward either. Project B's caches stay warm with
  pre-write content and its `domainDirty` flag stays `false` — silent
  cross-project staleness, a plausible wrong answer rather than an error,
  which is precisely the failure class this issue names as the one to design
  out first.

A third shape — one shared watcher with a composite token whose `<n>` is the
single global counter — was rejected outright: it pays the wire-breaking
change of moving `txId` from `z.number()` to `z.string()` *and* keeps both
defects above, while making the token merely look per-project.

### Cross-repo route: the token codec moves upstream; id derivation stays local

The codec — `formatTxToken`, `parseTxToken`, `compareTxToken`,
`isValidProjectId` — was requested upstream
(`GenvidTechnologies/mcp-utils#19`) and shipped in mcp-utils 0.9.0, consumed
here rather than re-implemented. Project-id *derivation*
(`deriveProjectId`/`deriveUniqueProjectIds` in `src/adapters/locations.ts`)
stayed local. The two were decided differently because they fail
differently:

- **Token-format drift fails silently and dangerously.** A delimiter or
  comparison difference between this server and `construct3-chef`'s would
  make a stale-write guard accept a token it should reject, and nothing
  would surface that until data was already wrong.
- **Id-derivation drift fails loudly and harmlessly.** If chef derived
  `game-a` where this repo derives `gamea` from the same directory, an agent
  calling `list-projects` on both servers would see two different id lists
  for the same roots immediately, before any write — a visible mismatch, not
  a silent one.

Only the first needed a shared *implementation*; the second is adequately
pinned by both repos' records specifying the same derivation rule. Sending
derivation upstream too would also have cost real sequencing: the registry
construction work needed derivation immediately, and would otherwise have
blocked on the external release landing.

**The `construct3-chef#95`/[[0026-fs-watch-platform-confound-and-upstream-routing]]
precedent does not support this the way it is usually cited, and the
distinction is worth recording precisely because the two look alike.** ADR
0026 routed the `fs.watch` double-bump fix upstream because the root cause —
`ExpectedChanges.consume` being single-shot — lived in code mcp-utils
**already owned**; a local patch would have fixed only this repo's symptom
while leaving the shared defect in place for every other mcp-utils consumer
on Windows. This decision is a different kind of ask: mcp-utils owned no
token codec before this issue: extracting one is a request for **new shared
surface**, not a fix to an existing shared defect. Route 2 is right here for
its own reason, stated above — a token-format divergence between two servers
one agent can drive in the same turn fails silently at the comparison, not
loudly at the call — not because it repeats ADR 0026's argument.

The default reading at design time was the opposite: the composite format is
ten characters of specification (`<projectId>:<n>`, delimiter `:`), so a
written-down contract between the two repos' own records looked sufficient
without a shared implementation (Route 1). Route 2 was chosen instead because
"looked sufficient" is exactly the kind of claim a silent failure mode
punishes; a wire contract two independently-maintained implementations must
each reproduce byte-for-byte is safer as one shared symbol than as two
descriptions of the same symbol.

### `ExpectedChanges` stays shared — a per-project option was considered and declined

Per-project `ExpectedChanges` instances were considered, to give each
project's write-suppression bookkeeping the same isolation as its cache. They
were declined: a per-project instance does not fix the actual collision case
— two `ProjectContext`s watching the same file (two `--project` entries at
one directory, or two roots forced onto one file via a shared absolute
`--config`) would each register write-suppression against their own
instance, so project A's self-write would go unconsumed by project B's
instance and B would report a spurious external change for A's write. Only
changing the *symptom*, not the cause. The actual fix is `buildRegistry`'s
distinct-`configPath` validation (acceptance row S4): with two projects
provably never sharing a config path, a single shared `ExpectedChanges`
instance is safe, since `add`/`consume`/`remove` are synchronous `Map`
operations with no `await` between them — and it costs one `purgeExpired`
timer instead of N. This is a **per-project → shared demotion**, arrived at
by examining what the per-project instinct was actually protecting against
rather than assuming isolation was automatically the safer default.

### Multi-root discovery: declined on evidence, then adopted when the evidence changed

At design time, auto-populating the registry from `project.c3proj` marker
discovery (rather than requiring an explicit `--project` per root) was
**declined**, and declined on a specific, falsifiable premise: the only
discovery API available was `resolveRootFolder`, which returns an `mcpError`
on two or more marker matches, and `mcpError` flattens its candidate list
into the error text — so the matching roots were not structurally
recoverable from that return value. Every route to them was one this repo had
already rejected on the record: scraping the flattened error string (which
`construct3-chef#95` also declines explicitly), or re-implementing marker
discovery locally, which is exactly
[[0002-configurable-locations-adapters-seam]]'s rejected "duplicate the
resolution in each adapter."

`@genvidtech/mcp-utils@0.9.0` then shipped `resolveRootFolders`, returning
`{ paths: string[]; source }` over the identical precedence chain, where two
or more matches is a **success** carrying every candidate rather than an
error. The decline's sole premise stopped holding, and the decision was
reversed within this same issue: `src/adapters/locations.ts`'s
`resolveProjectRoots` wraps `resolveRootFolders` (sorting its result, since
the upstream walk carries no sort of its own and directory order is not a
portable guarantee), and the `server` subcommand now registers every
discovered root rather than requiring one to be named explicitly.

**The reversal itself is not what is worth recording — its cause is.** No
argument changed between the decline and the adoption. A decision that was
correct when it was written became wrong days later because a dependency
released, and this repo has no mechanism that observes that on its own —
`CLAUDE.md` states the general form of this gap plainly: *"Nothing here
detects that a release has happened — run `npm view <pkg> dist-tags` before
trusting any version claim in this file."* This is not the first time that
gap has bitten: the same file once asserted c3source 1.9.0 was latest, and
`c3source#73` unreleased, for some time after c3source 2.0.0 had already
shipped the very things that trigger had been waiting for. The generalizable
lesson recorded here is narrower than "recheck dependencies": **a decline
that rests solely on an upstream API's current shape should be written down
with that premise named explicitly**, so the next reader (or the same reader,
days later) knows the one fact to re-check rather than having to re-derive
the whole argument from scratch. `resolveRootFolder`'s error-flattening
behaviour was exactly that premise, and naming it is what let the reversal
happen inside the same issue rather than as a rediscovery later.

**What is *not* being reversed.**
[[0007-project-dir-resolverootfolder]] rejected an alternative it stated as:

> **Silently pick the first match on ambiguity.** Rejected: a repo with
> multiple C3 projects is a real configuration the tool should not guess at —
> erroring and requiring an explicit `--project-dir` is safer than analyzing
> the wrong project.

Registering every discovered candidate is **not** that alternative. Picking
the first match commits to one project without telling the caller which one
was chosen or that others existed; registering every candidate commits to
none of them — at N > 1 an omitted `project` selector still returns the
enumerating error (see "Omission resolves..." above), so the wrong project is
never analysed silently under either the CLI's single-root ambiguity error or
the server's N-root registration. ADR 0007's stated safety property — no
guessing among ambiguous roots — is preserved by construction here, not
overridden. Accordingly, ADR 0007's decision item 3 is amended in place
(marked directly in that record) to scope its ambiguity-error behaviour to
the five single-root CLI subcommands, which are untouched: `resolveProjectRoot`
and its ambiguity error keep exactly their prior behaviour there, and only
the `server` subcommand's discovery path moved to the plural
`resolveProjectRoots`.

## Alternatives Considered

**Shared counter across all projects (one watcher, bare integer `txId`).**
Rejected — see "The composite token, and why a shared counter fails" above
for both verified reasons (the `existsSync` start guard becomes
inexpressible; `suppress()`'s sealing makes cross-project staleness
unrecoverable even by the content-fingerprint layer).

**A union token whose `<n>` is a single global counter shared by every
project.** Rejected — it still pays the wire-breaking `z.number()` →
`z.string()` change while keeping both of the shared-watcher defects above; a
composite-*looking* token is not a composite-*behaving* one.

**A path-valued `project` selector.** Rejected as an arbitrary-filesystem-read
surface; see "The selector is an id, never a path" above.

**"First registered" as the default when `project` is omitted.** Rejected
outright as strictly worse than the status quo: at N = 1 today, omission is
unambiguous by construction; silently defaulting to whichever project
happened to register first at N > 1 is precisely the hazard this issue opens
with — an agent that selected `beta` for the sibling server's tools and
omitted the selector here would receive `alpha`'s answers, silently.

**`list-projects` reporting a `txId`.** Rejected: a listing is not a
reservation, and reporting one would add a fourth token-emission site
inviting a client to treat a snapshot as something it can safely replay
later.

**Scraping `resolveRootFolder`'s flattened ambiguity-error text to recover
the candidate roots.** Rejected as the route to multi-root discovery before
`resolveRootFolders` shipped — `construct3-chef#95` declines the identical
approach explicitly, for the same reason: an error string is not a
structured contract, and a future wording change would silently break the
scrape.

**Re-implementing `project.c3proj` marker discovery locally**, instead of
depending on an upstream discovery primitive. Rejected as
[[0002-configurable-locations-adapters-seam]]'s already-rejected "duplicate
the resolution in each adapter" — the marker-search rules are subtle enough
(depth-1 children, precedence against the explicit flag and the env var) that
two independent copies would drift.

**Per-project `ExpectedChanges` instances.** Considered and declined; see
"`ExpectedChanges` stays shared" above.

**Writing the token codec locally in this repo (Route 1), leaving each
server's format pinned only by matching prose in each repo's own records.**
Rejected in favor of Route 2 (a shared upstream implementation); see
"Cross-repo route" above for why the ADR 0026 precedent does not itself
settle this question, and what does.

## Compromise

**What was accepted.** This server is black-box per project in the same
sense [[0025-mcp-server-stdio-test-harness]] already established for the
single-project server: acceptance evidence runs through the 15 registered
tools and logging notifications, never directly against `ProjectContext`
state. Cross-project cache isolation (row R21) is asserted through that same
black-box surface — waiting on the changed project's own external-change
notification before asserting anything about the untouched one — rather than
by inspecting either project's cache object directly. Multi-root discovery
via `resolveProjectRoots` is `server`-only; the five single-root CLI
subcommands keep `resolveProjectRoot`'s ambiguity error unchanged, so a
repository hosting several C3 projects still gets an explicit, non-guessing
error from every CLI subcommand other than `server`.

**What was rejected.** Every item in "Alternatives Considered" above. Beyond
those: cross-project aggregation (one domain index, health report, or
coupling graph spanning several roots) was excluded from this issue on
purpose, not by oversight — cross-domain coupling edges *between* projects
have no defined meaning today, so that would need its own analysis semantics
and its own record, not a corner of this one. Lazy per-project startup
generation (rather than the existing eager, per-project generation before
`server.connect`) was also declined: it would add a per-project
"initialized?" state, a race two concurrent first calls would have to
serialize on, and a latency spike landing inside a tool call an agent is
blocked on — worse than a slower handshake a client already tolerates, and
`Promise.all` across projects would not help, since `computeDomainData` is
synchronous CPU work on a single-threaded runtime.

## Consequences

- `src/mcp/server.ts` moves from one long-lived single-project singleton to
  an N-project server: 15 tools (`list-projects` added), all but
  `list-projects` accepting an optional `project` selector, registered
  through the single `registerProjectTool` wrapper.
- The `txId` wire format is a breaking change: both `set-overrides` and
  `remove-overrides` move their `txId` field from `z.number()` to
  `z.string()`, carrying the composite `<projectId>:<n>` token. Any client
  holding a bare-integer token from before this release must re-fetch via
  `get-state` or `list-projects`.
- The `@genvidtech/mcp-utils` floor moves to `^0.9.0`, load-bearing for both
  adoptions landed in this issue: the token codec
  (`formatTxToken`/`parseTxToken`/`compareTxToken`/`isValidProjectId`) and
  `resolveRootFolders` (the `server` subcommand's plural discovery).
- A release carrying this moves every tool's input schema and the `txId`
  wire format, so it needs the usual downstream update-request issue against
  `GenvidTechnologies/claude-code-plugin-gvt-construct3` (exact-pin bump plus
  a tool-surface reconciliation for the `c3-explorer` allow-list), and it
  should land in step with `construct3-chef#95` so the plugin never ships one
  project-aware MCP server beside one that is not.
- [[0007-project-dir-resolverootfolder]]'s decision item 3 is amended in
  place (see "What is not being reversed" above) rather than superseded
  wholesale: its ambiguity-error behaviour continues to govern the five
  single-root CLI subcommands unchanged.
