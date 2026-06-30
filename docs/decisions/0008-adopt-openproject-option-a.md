# ADR 0008: Adopt `C3Project`/`openProject` for C3 file discovery (Option A)

**Status:** Accepted
**Date:** 2026-06-29
**Issue:** #19 — migrate `@genvid/c3source` → `@genvidtech/c3source` 1.7.0

---

## Context

`c3-domain-manager` discovers C3 source files by hardcoding section-folder joins
(`path.join(rootDir, "eventSheets")`, `path.join(rootDir, "layouts")`,
`path.join(rootDir, "scripts")`) in `src/domain/domainGenerator.ts`
(`computeDomainData`, `findScriptEntries`), `src/domain/editorValidation.ts`,
and `src/domain/domainAnalysis.ts` (`listUncategorized`), then — for the
discovery path — calling the free functions `find_all_eventsheets_path` /
`find_all_layouts_path`.

The `@genvidtech/c3source` 1.7.0 bump completes the `C3Project` handle's section
coverage. `openProject(root): C3Project` exposes canonical section dirs
(`eventSheetsDir`, `layoutsDir`, `scriptsDir`, …) and
`findAllEventSheets()` / `findAllLayouts()` / `findAllScripts()` walkers,
centralizing the C3-folder facts that were previously hand-rolled here.
Per the standing guidance in `CLAUDE.md` ("when bumping c3source, check whether
new exports supersede local C3-parsing logic"), this bump triggered a formal
evaluation of three adoption options.

## Decision

**Option A — call `openProject(rootDir)` locally at the top of each pure
function** (`computeDomainData`, `validateEditorStrictness`, and
`listUncategorized`) and use `project.findAllEventSheets()` /
`project.findAllLayouts()` / `project.scriptsDir` (the discovery path), or the
`project.eventSheetsDir` / `layoutsDir` / `scriptsDir` directory fields where a
function does its own walk (`listUncategorized`'s `collectFiles`). The pure
functions keep their existing `rootDir`-first signatures and their position on
the `src/index.ts` public surface is unchanged.

## Alternatives Considered

**Option B — thread a `C3Project` handle through the public API.**
Change `computeDomainData` / `validateEditorStrictness` to accept a `C3Project`
instead of `rootDir`. Rejected: exposes a dependency type on the pure-core public
surface (`src/index.ts` re-exports these) and ripples into `generateDomainIndex`,
`cli.ts`, `server.ts`, and every test — large blast radius for thin gain.

**Option C — adopt only the dir-path constants, keep free `find_all_*` functions.**
Use `project.eventSheetsDir` etc. as inputs but keep the existing free-function
walkers. Rejected: keeps two import styles, forgoes the missing-dir robustness of
the handle's walkers, and offers almost no improvement over the status quo.

## Consequences

- Removes all hardcoded C3 section-folder name literals from this repo; the folder
  facts now live in `c3source`. (`listUncategorized`'s swap is purely cosmetic —
  its `collectFiles`/`collectRootTsFiles` walkers already return `[]` on a missing
  dir, so only the discovery path in `computeDomainData` gains the behavioural fix
  below.)
- **Behavioral improvement (deliberate):** a project missing `eventSheets/` or
  `layouts/` previously caused `computeDomainData` to throw `ENOENT`;
  `findAllEventSheets()` / `findAllLayouts()` return `[]` instead, so analysis
  continues gracefully. Pinned by new tests. `editorValidation` preserves its
  existing skip-log via `project.hasEventSheets()`.
- **Scope limit — `findScriptEntries` is not replaced:** `project.findAllScripts()`
  returns a flat list of `.ts` paths without the `{relativePath, isDirectory}`
  directory entries and `LAYER_DIRS` recursion that classification depends on.
  Only its input narrows to `project.scriptsDir`; it still throws on a missing
  `scripts/` dir (unchanged).
- `findScriptEntries`'s narrowed signature (`rootDir` → `scriptsDir`) is a
  public-API change with no known external consumers; noted for release notes.
- **Deferred — `comparisonSymbol`/`COMPARISON_OPERATORS` (also new in 1.7.0):**
  no integration site exists today (this repo renders no condition/comparison
  params), so adoption is deferred to a future measurement spike if a real
  diagnostic warrants it.
