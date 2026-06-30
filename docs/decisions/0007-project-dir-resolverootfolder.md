# ADR 0007: Add `--project-dir` via `@genvid/mcp-utils` 0.5.0 `resolveRootFolder`

**Status:** Accepted
**Date:** 2026-06-17
**Issue:** #16 — set the C3 project source root explicitly

> Recovered retroactively (2026-06-30) from commit `a2130aa`,
> CLAUDE.md, and `docs/domain-architecture.md`.

---

## Context

The C3 project source root — the directory whose `eventSheets/`, `layouts/`, and
`scripts/` are scanned — was effectively `process.cwd()`. There was no way to
point the tool at a sibling directory, and no way to disambiguate a repository
that hosts more than one C3 project. The issue asked to add a `--project-dir`
flag and, implicitly, to hand-roll the root-discovery logic (explicit path → env
var → marker-file search → cwd fallback).

While scoping it, `@genvid/mcp-utils` 0.5.0 turned out to ship exactly that
resolver: `resolveRootFolder` resolves a project root from an explicit path, an
env var, or `project.c3proj` marker discovery, returning `ResolvedRoot |
CallToolResult` and never throwing. This is the inverse of the usual lesson — the
issue said "hand-roll Y," but a dependency bump already provided Y. (`project.c3proj`
itself comes from `@genvidtech/c3source`'s `PROJECT_MANIFEST_FILE`, exported since
1.5.0.)

## Decision

**Add `--project-dir` (and `C3_PROJECT_DIR`), implemented as `resolveProjectRoot`
in `src/adapters/locations.ts` — a thin wrapper over mcp-utils'
`resolveRootFolder`** passing `PROJECT_MANIFEST_FILE` as the discovery marker
rather than hand-rolling the resolution.

Resolution precedence (highest to lowest):

1. `--project-dir <path>` — relative resolves against the **current working
   directory**, absolute used as-is, no containment restriction (`../sibling` is
   valid).
2. `C3_PROJECT_DIR` env var — same rules.
3. Discovery — the current dir and its immediate children (depth 1) are searched
   for a `project.c3proj` marker. Exactly one match becomes the root; two or more
   matches print an ambiguity error and exit non-zero (the intended behaviour for
   a repo hosting multiple C3 projects).
4. Fallback — the current working directory (preserves prior behaviour).

The MCP server does **not** re-run discovery; the root is fixed at `startServer`
time. Note `--project-dir` resolves relative to **cwd**, whereas `--config`/
`--extracted` resolve relative to the project root (per
[[0002-configurable-locations-adapters-seam]]).

## Alternatives Considered

**Hand-roll the resolution as the issue framed it.** Rejected once
`resolveRootFolder` was found: it provides the same precedence chain, the
never-throw `ResolvedRoot | CallToolResult` contract, and the marker search —
adopting it avoids duplicating root-discovery logic that mcp-utils now owns. This
is the standing "verify whether a dep bump already ships the primitive" discipline
applied in reverse.

**Silently pick the first match on ambiguity.** Rejected: a repo with multiple
C3 projects is a real configuration the tool should not guess at — erroring and
requiring an explicit `--project-dir` is safer than analyzing the wrong project.

## Consequences

- `resolveProjectRoot` joins `resolveLocations` in the `src/adapters/` shared
  layer; the new root feeds the existing location resolution unchanged.
- Adopting `resolveRootFolder` is what raised the mcp-utils floor to `^0.5.0`.
- Full precedence table and the cwd-vs-project-root resolution distinction are
  documented in `docs/domain-architecture.md` ("Paths and locations").
