# ADR 0002: Configurable config/extracted locations via a `src/adapters` resolution seam

**Status:** Accepted
**Date:** 2026-06-03
**Issue:** #7 — make the domain-config path and extracted-output dir overridable

> Recovered retroactively (2026-06-30) from commit `64554bd`.

---

## Context

The tool originally hardcoded its paths: `domain-config.json` and `extracted/`
were always resolved as `path.join(PROJECT_ROOT, …)`. The MCP server recomputed
`path.join(PROJECT_ROOT, "domain-config.json")` inline in five places. This
blocked legitimate uses — a config file living outside the project root, a
custom output directory, or a no-side-effect validation pass that writes nothing
into the project tree.

Both the CLI and the MCP server need the same resolution logic, so the question
was not only *what* to make configurable but *where* the resolution should live
so the two adapters share one implementation without leaking it onto the public
library API.

## Decision

**Introduce a pure `src/adapters/locations.ts` seam — `resolveLocations(opts,
projectRoot)` returning a `ResolvedLocations`** — that resolves the
domain-config path, the extracted-output directory, and the ephemeral-temp
behaviour from CLI flags / `startServer` options. Add two global CLI flags
(`--config`, `--extracted`) and thread the server through a single
`CONFIG_PATH`/`CONFIG_WATCH_KEY` set once at `startServer` time.

Resolution rules:

- **Absolute operator paths pass through; relative paths rebase to the project
  root.** Operator-supplied paths are trusted — paths outside the project root
  are intentionally allowed.
- **`--extracted none`** routes generation into an ephemeral `os.tmpdir()`
  directory, removed in a `finally` (CLI) or the shutdown handler (server).
- `configWatchKey` is the forward-slash-normalized absolute config path, used by
  the server's `ExpectedChanges` self-write suppression on both add and consume,
  so it stays correct for a custom config name/location.

The `src/adapters/` layer holds code shared *between* the CLI and MCP adapters
and is **deliberately not re-exported** from the public library API
(`src/index.ts`).

## Alternatives Considered

**Put the resolution helpers in `src/domain/` (the pure core).** Rejected:
location resolution is adapter concern (CLI flags / server options), not domain
analysis. Placing it in the core would either pollute the public API surface or
force the pure functions to know about CLI/server option shapes.

**Duplicate the resolution in each adapter.** Rejected: the watch-key
normalization and the ephemeral-temp lifecycle are subtle enough that two copies
would drift. A single tested seam (16 unit tests, including a real
`ExpectedChanges` add/consume round-trip) is the safer factoring.

## Consequences

- A new architectural layer, `src/adapters/`, is established for
  CLI↔server-shared code that should not be public. Later decisions extend it —
  see [[0003-adopt-loadprojectconfig-schema-first]] (the `configDir`/
  `configFileName` split lives here) and
  [[0007-project-dir-resolverootfolder]] (`resolveProjectRoot` joins it).
- The server's five inline `path.join` recomputations collapse to one
  module-level `CONFIG_PATH`; ephemeral extracted dirs are cleaned up on
  shutdown.
- The explicit `.version(PKG_VERSION)` yargs wiring (the issue #3 guard) is left
  untouched by this change.
