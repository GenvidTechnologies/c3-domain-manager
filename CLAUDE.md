# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@CONVENTIONS.md

## What this is

`c3-domain-manager` analyzes Construct 3 projects through a domain-driven-design lens. It reads a `domain-config.json` from the *target* project's root (the current working directory, **not** this repo), classifies the project's `eventSheets/`, `layouts/`, and `scripts/` files into named domains, then produces a markdown domain index, health/coupling metrics, boundary validation, glossary collision checks, and a context map. The same capabilities are exposed both as a CLI and as an MCP server (stdio).

Read `docs/domain-architecture.md` for the domain model concepts and the full `domain-config.json` schema.

## Commands

```bash
npm run build       # tsc → dist/, then inject a #!/usr/bin/env node shebang into dist/cli.js
npm test            # mocha + tsx over test/**/*.test.ts
npm run lint        # eslint, --max-warnings 0 (CI fails on any warning)
npm run typecheck   # tsc -p tsconfig.test.json --noEmit (type-checks src AND test)
```

Run a single test file: `npx mocha --timeout 5000 --import=tsx --require ./test/setup.ts test/domain/health.test.ts --exit`

Note: scripts are invoked with `npm` locally, but CI uses `pnpm` for the same script names.

## Key dependencies

Two dependencies are published public packages on npm, installed normally via `npm install` (no special setup):

`@genvid/c3source` provides the Construct 3 file walkers (`find_all_eventsheets_path`, `find_all_layouts_path`) and the `EventSheet`/`Layout` types. `@genvid/mcp-utils` provides MCP plumbing (`ReadWriteLock`, `ExpectedChanges`, `paginateText`, `exposeDocs`, `Logger`).

## TypeScript / module setup

- Pure ESM (`"type": "module"`), `NodeNext` resolution, Node >= 22. Relative imports **must** use `.js` extensions even though sources are `.ts`.
- In development the package entry points resolve to `src/*.ts` directly (run via `tsx`). `publishConfig` swaps `main`/`types`/`exports` over to the compiled `dist/*.js` at publish time — so the published artifact and the dev artifact differ.
- **Publish pitfall:** before shipping, verify the packed tarball's `package.json` has `exports`/`main`/`types` pointing at `./dist/...`, not `./src/*.ts`. `npm publish`/`npm pack` (npm ≥7) applies the `publishConfig` field overrides; `pnpm pack`/`pnpm publish` may *not* unless configured — and a package that ships dev `src/` paths while bundling only `dist/` is unresolvable under `NodeNext` (this is exactly what broke `@genvid/c3source@0.3.0`, fixed in 0.3.1).
- Two tsconfigs: `tsconfig.json` (composite, `src/` only, emits `dist/`) drives the build; `tsconfig.test.json` (`noEmit`, includes `test/`) drives `typecheck`.

## Architecture

The analysis core lives in `src/domain/` and is pure and I/O-light. The CLI (`src/cli.ts`) and the MCP server (`src/mcp/server.ts`) are thin adapters over it. `src/index.ts` is the public library API (re-exports everything in `src/domain/`).

**Computation vs I/O split** — the key pattern in `domainGenerator.ts`:
- `computeDomainData(rootDir, config, log)` is the pure heart: walks the project, classifies files, parses event sheets, and resolves cross-domain dependencies, returning `{ domains: DomainData[], unclassified: string[] }` with no writes.
- `generateDomainIndex(...)` wraps it for I/O: loads the config, calls `computeDomainData`, then wipes and rewrites `extracted/domain-index/` (a master `index.md` plus one page per domain).

**Classification** (`classification.ts`, `classifyFile`) decides which domain a file belongs to:
1. Exact-path `overrides` win first.
2. Otherwise the file's path (after stripping its file-type root `eventSheets/`|`layouts/`|`scripts/`) is matched against each domain's `*Dirs` arrays, **longest matching prefix wins**.
3. Both `domains` and `sharedSubdomains` participate in matching.
Files matching nothing become `unclassified`.

**Cross-domain dependencies** are derived from `include` events inside event sheets. `extraction.ts` recursively walks the event tree (`group`/`block`/`function-block`/`custom-ace-block` children) to pull out `include` targets and function/ACE definitions. `domainGenerator` then maps each included sheet back to its owning domain to build the `includesFrom` / `includedBy` graphs on each `DomainData`.

Downstream analysis modules all consume `DomainData[]`: `health.ts` (Ca/Ce/instability), `relationships.ts` (`validateBoundaries` — declared vs. observed deps), `glossary.ts` (cross-domain term collisions), `contextMap.ts` (text/Mermaid), `domainAnalysis.ts` (`listUncategorized`, `listStaleOverrides`, override validation). `formatting.ts` renders everything to markdown/text.

All domain types are defined in `src/domain/types.ts` (`DomainConfig`, `DomainDefinition`, `DomainData`, `Relationship`, `FunctionDef`).

### MCP server specifics (`src/mcp/server.ts`)

- Auto-generates the domain index on startup if `extracted/domain-index/` is absent.
- Holds mutable state behind a `ReadWriteLock`: a `txId` (monotonic) and a `domainDirty` flag. Mutate tools (`set-overrides`, `remove-overrides`) edit the target's `domain-config.json` and set `domainDirty`; read tools that depend on the index append a stale warning until `regenerate` clears it.
- Tools accept an optional `txId` for optimistic concurrency — a write is rejected if it doesn't match the server's current `txId` (read it via `get-state`).
- Tool annotations classify each tool as `READ_ONLY`, `REGENERATE`, or `MUTATE`.

## Testing conventions

Tests use mocha + chai (`expect`) and run through `tsx` (no build needed). `test/setup.ts` is a mocha root-hook plugin that silences `console.log`/`console.debug` during each test (leaving `warn`/`error`) — diagnostic logging in the core is passed in as a `log`/`Logger` callback, so prefer that over global console output. Tests live under `test/domain/` mirroring `src/domain/`.
