# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@CONVENTIONS.md

## What this is

`c3-domain-manager` analyzes Construct 3 projects through a domain-driven-design lens. It reads a `domain-config.json` from the *target* project's root (the current working directory, **not** this repo) and writes output to `extracted/` there, then produces a markdown domain index, health/coupling metrics, boundary validation, glossary collision checks, a context map, and editor-strictness diagnostics. Both locations are overridable: `--config <path>` selects the config file and `--extracted <path>` selects the output directory (use `none` for an ephemeral temp dir, auto-cleaned on exit); relative paths for both flags resolve against the project root. The same capabilities are exposed both as a CLI and as an MCP server (stdio); the MCP server receives the resolved locations via `startServer(loc)`.

Read `docs/domain-architecture.md` for the domain model concepts and the full `domain-config.json` schema.

## Commands

```bash
npm run build       # tsc → dist/, then inject a #!/usr/bin/env node shebang into dist/cli.js
npm test            # mocha + tsx over test/**/*.test.ts
npm run lint        # eslint, --max-warnings 0 (CI fails on any warning)
npm run typecheck   # tsc -p tsconfig.test.json --noEmit (type-checks src AND test)
```

Run a single test file: `npx mocha --timeout 5000 --import=tsx --require ./test/setup.ts test/domain/health.test.ts --exit`

Note: both local development and CI use `npm` for these script names. CI runs the shared `genvid-public-ci` Node gate (`.github/workflows/ci.yml`).

**Cutting a release:** see `docs/releasing.md`. In short — bump the version in `package.json` + `package-lock.json`, commit `chore: Release X.Y.Z`, push a lightweight `vX.Y.Z` tag; the tag push triggers `.github/workflows/publish.yml` (OIDC trusted publish to npm).

## Key dependencies

Two dependencies are published public packages on npm, installed normally via `npm install` (no special setup):

`@genvid/c3source` (floor `^1.4.0`) provides the Construct 3 file walkers (`find_all_eventsheets_path`, `find_all_layouts_path`), the `EventSheet`/`Layout`/`FunctionParameter` types, the typed event-tree extractors `extractFunctions(sheet)` and `extractIncludes(sheet)` (since 1.1.0) — we consume both instead of hand-rolling the walk — and (since 1.4.0) `validateForEditor(sheet)` / `EditorValidationIssue`, which checks a parsed event sheet against the structural rules the C3 editor enforces on import; `editorValidation.ts` calls this per sheet to build the editor-strictness report. `@genvid/mcp-utils` provides MCP plumbing (`ReadWriteLock`, `ExpectedChanges`, `exposeDocs`, `Logger`) and (since 0.3.0) the `loadProjectConfig(projectRoot, fileName, schema)` config loader plus its `isMcpError` guard — an async, never-throwing read+merge+zod-validate that returns either the typed config or a structured `CallToolResult` error — as well as the `paginatedContent` (paginated single-block response) and `READ_ONLY`/`REGENERATE`/`MUTATE` tool-annotation constants. Since 0.4.0 it also provides `mcpContent` (single-block result+footer helper) and `withMcpErrors` (wraps an async handler so thrown errors become `CallToolResult` errors; accepts an `onError` hook for side-effects on failure).

**When bumping `@genvid/mcp-utils`, audit `src/mcp/server.ts` for hand-rolled equivalents of its exported helpers** — the annotation constants, `mcpContent`, `paginatedContent`, and `withMcpErrors` all sat hand-rolled until the 0.4.0 bump adopted them (some had been available since 0.3.0). Verify a release's actual API against the packed types (`npm pack @genvid/mcp-utils@<version>` → `package/dist/*.d.ts`), not just the release notes.

**When bumping `@genvid/c3source`, check whether new exports supersede local C3-parsing logic** — c3source owns the Construct 3 platform facts, so its releases tend to ship primitives that retire hand-rolled equivalents here. `extractFunctions`/`extractIncludes` (1.1.0) retired the local `src/domain/extraction.ts` walk in 0.2.0; `validateForEditor` (1.4.0) was adopted as `editorValidation.ts`; and 1.4.0's event-var-reference primitives (`isEventVarReference`/`getEventVarReferenceName`/`EVENTVAR_REFERENCE_ACES`) remain un-adopted (a deferred dependency-graph enrichment). As with mcp-utils, treat the release notes as a hypothesis and verify the actual surface against the packed `.d.ts` — **and confirm the integration site the issue assumes actually exists** (issue #12 framed `validateForEditor` as a guard "before write-out," but this tool never writes C3 sheets, so it became a read-side diagnostic instead).

## TypeScript / module setup

- Pure ESM (`"type": "module"`), `NodeNext` resolution, Node >= 22. Relative imports **must** use `.js` extensions even though sources are `.ts`.
- **Reading the package's own files at runtime:** `process.cwd()` is the *target* Construct 3 project, **not** this package — `cli.ts`/`server.ts` set `PROJECT_ROOT = process.cwd()` for exactly that reason. To read a file shipped *with* `c3-domain-manager` itself (e.g. `package.json` for the CLI `--version`), resolve it relative to the compiled module via `path.dirname(fileURLToPath(import.meta.url))`, **never** `cwd`. The compiled entry is `dist/cli.js`, so the package root is one level up (`../package.json`). Yargs' own version auto-detection does *not* find it — wire `.version()` explicitly (this was the `--version: "unknown"` bug, issue #3).
- The package entry points (`main`/`types`/`exports`) point at the compiled `dist/*.js`/`*.d.ts` directly. Development never imports the package by its own name (tests use relative `.js` paths), so there's no dev/publish entry-point swap — `dist/` is built by `prepack` (and the CI gate) before anything consumes those paths. `publishConfig` holds only `{ "access": "public" }`.
- **Publish pitfall:** keep `main`/`types`/`exports` at the **top level** pointing at `./dist/...`; do **not** move them into `publishConfig`. npm 11.x no longer applies `publishConfig` field overrides for entry points — it would ship the top-level values and warn "Unknown publishConfig config", so a package that hides its `dist/` paths inside `publishConfig` publishes source-pointing entry points that are unresolvable under `NodeNext` (this class of bug broke `@genvid/c3source@0.3.0`, fixed in 0.3.1). Verify against the packed manifest (`npm pack`), not the dry-run notice alone.
- Two tsconfigs: `tsconfig.json` (composite, `src/` only, emits `dist/`) drives the build; `tsconfig.test.json` (`noEmit`, includes `test/`) drives `typecheck`.

## Architecture

The analysis core lives in `src/domain/` and is pure and I/O-light. The CLI (`src/cli.ts`) and the MCP server (`src/mcp/server.ts`) are thin adapters over it. Code shared *between* those two adapters lives in `src/adapters/` (e.g. `locations.ts` — the `resolveLocations` seam that resolves the config path, extracted-output dir, and ephemeral-temp behaviour from CLI flags / `startServer` options); it is deliberately **not** re-exported from the public API. `src/index.ts` is the public library API (re-exports everything in `src/domain/` only).

**Computation vs I/O split** — the key pattern in `domainGenerator.ts`:
- `computeDomainData(rootDir, config, log)` is the pure heart: walks the project, classifies files, parses event sheets, and resolves cross-domain dependencies, returning `{ domains: DomainData[], unclassified: string[] }` with no writes.
- `generateDomainIndex(...)` wraps it for I/O: it is **async** and takes `(rootDir, outDir, configDir, configFileName, log)`. It loads the config via the async throwing `loadConfig(configDir, configFileName)` (a thin wrapper over mcp-utils' `loadProjectConfig` that validates against `DomainConfigSchema` and throws a `loadProjectConfig(...)`-prefixed `Error` on failure, keeping MCP types out of the pure core), calls `computeDomainData`, then wipes and rewrites `extracted/domain-index/` (a master `index.md` plus one page per domain). The MCP server bypasses this wrapper and calls `loadProjectConfig` directly so its tool handlers can return the structured `CallToolResult` error verbatim. The config path is split into `configDir`/`configFileName` by `resolveLocations` so an absolute, outside-root `--config` still resolves (`path.join(configDir, configFileName) === configPath`).

**Classification** (`classification.ts`, `classifyFile`) decides which domain a file belongs to:
1. Exact-path `overrides` win first.
2. Otherwise the file's path (after stripping its file-type root `eventSheets/`|`layouts/`|`scripts/`) is matched against each domain's `*Dirs` arrays, **longest matching prefix wins**.
3. Both `domains` and `sharedSubdomains` participate in matching.
Files matching nothing become `unclassified`.

**Cross-domain dependencies** are derived from `include` events inside event sheets. The event-tree walk lives in `@genvid/c3source` (`extractIncludes`/`extractFunctions`, typed over the `EventSheetEvent` union); `domainGenerator.ts` calls them directly and maps the results onto our local `FunctionDef` via the small `extractFunctionDefs(sheet, sheetName)` seam (param-string formatting + `sourceSheet`/custom-ACE fields). `domainGenerator` then maps each included sheet back to its owning domain to build the `includesFrom` / `includedBy` graphs on each `DomainData`. (Before 0.2.0 this walk was hand-rolled in a local `src/domain/extraction.ts`, since retired.)

Downstream analysis modules all consume `DomainData[]`: `health.ts` (Ca/Ce/instability), `relationships.ts` (`validateBoundaries` — declared vs. observed deps), `glossary.ts` (cross-domain term collisions), `contextMap.ts` (text/Mermaid), `domainAnalysis.ts` (`listUncategorized`, `listStaleOverrides`, override validation). `formatting.ts` renders everything to markdown/text. `editorValidation.ts` (`validateEditorStrictness`, `formatEditorStrictnessReport`) is a read-side diagnostic that re-walks `eventSheets/` independently (it does not consume `DomainData[]`), attributes each sheet to a domain via `classifyFile`, calls `validateForEditor` per sheet, and returns issues grouped by sheet; unclassified sheets are still validated and reported under `"(unclassified)"`.

All domain types are defined in `src/domain/types.ts` (`DomainConfig`, `DomainDefinition`, `DomainData`, `Relationship`, `FunctionDef`). The config types (`DomainConfig`/`DomainDefinition`/`SharedSubdomainDefinition`/`Relationship`) are **schema-first**: `DomainConfigSchema` is the source of truth and the types are `z.infer` of it. The schemas are lenient — `.passthrough()` so unknown keys survive the load→mutate→write round-trip, with non-essential fields optional and `description` required.

### MCP server specifics (`src/mcp/server.ts`)

- Auto-generates the domain index on startup if `extracted/domain-index/` is absent.
- Holds mutable state behind a `ReadWriteLock`: a `txId` (monotonic) and a `domainDirty` flag. Mutate tools (`set-overrides`, `remove-overrides`) edit the target's `domain-config.json` and set `domainDirty`; their handlers are wrapped in `withMcpErrors` so any thrown error (e.g. a failed `fs.writeFileSync`) is returned as a `CallToolResult` error rather than crashing the server. An `onError` hook (`onWriteError`) bumps `txId` on write failure so the client knows to reconcile after a possibly-partial write. Successful mutate responses are built with `mcpContent(body, footer)` which appends the current `txId` as a trailing footer line. Read tools that depend on the index append a stale warning until `regenerate` clears it.
- Tools accept an optional `txId` for optimistic concurrency — a write is rejected if it doesn't match the server's current `txId` (read it via `get-state`).
- Tool annotations classify each tool as `READ_ONLY`, `REGENERATE`, or `MUTATE`.
- The `validate-editor` tool (`READ_ONLY`) intentionally does **not** append the stale-index warning: it re-walks event sheets fresh from disk and never reads the cached domain index, so index staleness is irrelevant to its output.

## Testing conventions

Tests use mocha + chai (`assert`) and run through `tsx` (no build needed). `test/setup.ts` is a mocha root-hook plugin that silences `console.log`/`console.debug` during each test (leaving `warn`/`error`) — diagnostic logging in the core is passed in as a `log`/`Logger` callback, so prefer that over global console output. Tests live under `test/domain/` mirroring `src/domain/`.

There is **no test harness for the MCP server** (`src/mcp/server.ts`): only `test/domain/` and `test/adapters/` are tested. Server-specific behaviour — tool-level `isMcpError`/`CallToolResult` propagation, the `domainConfigCache` invalidation on watcher events and self-writes, optimistic-concurrency `txId` rejection, the mutate-tool `withMcpErrors`/`onError` write-failure path (the `txId` bump on a failed write), and the `mcpContent`/`paginatedContent` response shapes (single-block output, stale-warning footer) — is currently covered only by `typecheck` plus the core-level tests of the functions each tool wraps (e.g. `loadConfig`'s error path in `test/domain/domainGenerator.test.ts`). Standing up a server harness (driving the registered tool callbacks against a temp project) is a known follow-up; account for it before relying on server-only logic being regression-tested. There is also no async-rejection helper (`chai-as-promised` is not installed) — assert on rejected promises with `try/catch` + `assert.include(err.message, ...)`.
