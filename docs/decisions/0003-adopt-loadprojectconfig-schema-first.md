# ADR 0003: Adopt `@genvid/mcp-utils` 0.3.0 `loadProjectConfig`; make `DomainConfig` schema-first

**Status:** Accepted
**Date:** 2026-06-03
**Issue:** #9 — adopt the mcp-utils 0.3.0 configuration API

> Recovered retroactively (2026-06-30) from commit `99f01f2`.

---

## Context

Config loading was three unguarded `JSON.parse(...) as DomainConfig` casts — one
each in the pure core, the CLI, and the MCP server. A missing file, malformed
JSON, a schema violation, or a path escape produced an opaque parse throw, and
the `as DomainConfig` cast asserted a shape the loader never actually checked.
The `DomainConfig` family was also a set of hand-written TypeScript interfaces
kept in sync with the runtime expectations by hand.

`@genvid/mcp-utils` 0.3.0 shipped `loadProjectConfig(projectRoot, fileName,
schema)` — an async, never-throwing read+merge+zod-validate that returns either
the typed config or a structured `CallToolResult` error — plus its `isMcpError`
guard. This builds directly on the resolution seam from
[[0002-configurable-locations-adapters-seam]].

## Decision

**Adopt `loadProjectConfig` everywhere config is read, and make `DomainConfig`
schema-first.**

1. **Schema-first types.** Replace the `DomainConfig` / `DomainDefinition` /
   `SharedSubdomainDefinition` / `Relationship` interfaces with lenient zod
   schemas; export `DomainConfigSchema` as the single source of truth and derive
   the types via `z.infer`. Schemas use `.passthrough()` so unknown keys survive
   the MCP server's load→mutate→write round-trip; non-essential fields are
   optional; `description` stays required. The derived types are structurally
   identical to the old interfaces, so all consumers compile unchanged.

2. **Keep MCP types out of the pure core.** The core's `loadConfig(configDir,
   configFileName)` becomes an **async throwing wrapper** around
   `loadProjectConfig` that throws on `isMcpError` (prefixed
   `loadProjectConfig(…)`), so the pure core never surfaces `CallToolResult`.
   `generateDomainIndex` becomes async.

3. **Server calls `loadProjectConfig` directly** so its tool handlers can return
   the structured `CallToolResult` error verbatim; its caches store only on
   success. `configDir`/`configFileName` (added to `ResolvedLocations`) thread
   the resolved location through — `path.join(configDir, configFileName)` always
   equals the absolute `configPath`, preserving the outside-root `--config` case.

## Alternatives Considered

**Have the pure core return `CallToolResult` too.** Rejected: it would leak the
MCP error type into the public library API and into the CLI, which has no use for
a `CallToolResult`. The throwing wrapper keeps the core MCP-agnostic while the
server still gets the structured error by calling `loadProjectConfig` directly.

**Keep hand-written interfaces, validate separately.** Rejected: two sources of
truth (the interface and a parallel validator) inevitably drift. Deriving the
types from the schema makes the validator authoritative for free.

## Consequences

- Config errors (missing file, bad JSON, schema violation, path escape) now
  produce a clear, structured `loadProjectConfig(domain-config.json): …` error
  instead of an opaque parse throw — aborting the CLI command or returning a
  structured MCP tool error.
- The lenient `.passthrough()` schema is what makes the MCP mutate tools safe:
  extra config keys survive a `set-overrides`/`remove-overrides` round-trip.
- `generateDomainIndex` and the affected CLI handlers become async.
- This is the first mcp-utils helper adoption; the pattern of "verify the packed
  `.d.ts`, not the release notes" continues in
  [[0004-adopt-mcp-utils-0.4.0-helpers]].
