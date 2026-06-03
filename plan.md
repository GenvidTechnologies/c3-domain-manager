# Plan: Upgrade `@genvid/mcp-utils` 0.2.0 → 0.3.0 and adopt `loadProjectConfig`

## Goal

Move the `@genvid/mcp-utils` dependency to `0.3.0` and adopt its new
`loadProjectConfig` configuration API everywhere config is read (pure core, CLI,
and MCP server). Replace the unguarded `JSON.parse(...) as DomainConfig` casts
with schema-validated loads, make `DomainConfig` schema-first via zod, and keep
zero regression for existing `domain-config.json` files.

## Locked decisions (from analysis → design → checkpoints)

- **Scope:** adopt `loadProjectConfig` *everywhere*, including the pure core.
  `loadConfig` / `generateDomainIndex` become async; `computeDomainData` stays
  sync (it takes an already-loaded config). Accept the async ripple through the
  public library API (`src/index.ts`).
- **Error layering = Option 1A.** The core gets a thin *throwing* `loadConfig`
  wrapper (`if (isMcpError(cfg)) throw new Error(<text>)`) so core/CLI never see
  MCP types. The MCP server calls `loadProjectConfig` **directly** so it keeps
  the structured `CallToolResult` to return from tool handlers.
- **Schema-first, lenient.** `DomainConfig` etc. become `z.infer<typeof …Schema>`
  with `.passthrough()` and optional non-essential fields. `description` on
  `DomainDefinition` stays **required** (see scan gate in Task 2).
- **Path bridging = dir/basename split.** Add `configDir` / `configFileName` to
  `ResolvedLocations`; pass them to `loadProjectConfig(projectRoot=configDir,
  fileName=configFileName)`. `path.join(configDir, configFileName) === configPath`
  exactly, so absolute-outside-root `--config` keeps working. No `containedPaths`.
- **Caching:** keep `domainConfigCache`; cache **only on success** (never cache an
  `isMcpError` result). Watcher / self-write invalidation unchanged.

## New `loadProjectConfig` surface (0.3.0)

```ts
function loadProjectConfig<T>(
  projectRoot: string, fileName: string, schema: ZodType<T>,
  overrides?: Partial<T>, opts?: LoadConfigOpts<T>,
  readFile?: (p: string, enc: "utf-8") => Promise<string>
): Promise<T | CallToolResult>;          // async, never throws
function isMcpError(x: unknown): x is CallToolResult;
```

`fileName` is joined to `projectRoot`. On any failure (missing file / bad JSON /
schema / path-escape) it returns an `mcpError` `CallToolResult` (`isError:true`),
text prefixed `loadProjectConfig(<fileName>): …`. `readFile` is an injectable
test seam. zod is a peer dep `^3.23.0` (already a direct dep, installed 3.25.76).
The 0.2.0→0.3.0 export delta is exactly the one added `loadProjectConfig` line —
all existing imports are unchanged, so the bump alone is non-breaking.

## Branch

`feat/mcp-utils-0.3.0-config-api` (branch from `origin/main`).

---

## Tasks (each = one commit; P-steps before F-steps)

### Task P1 — Add `configDir`/`configFileName` to the locations seam
**Type:** P (pure addition, no behaviour change).
**Files:** `src/adapters/locations.ts`, `test/adapters/locations.test.ts`.
**Change:**
- Add `configDir: string` and `configFileName: string` to `ResolvedLocations`.
- In `resolveLocations`, populate `configDir = path.dirname(configPath)` and
  `configFileName = path.basename(configPath)` (computed from the already-resolved
  `configPath`; `configPath` stays for the watcher).
**Tests:** extend `test/adapters/locations.test.ts`:
- Default config: `configDir === projectRoot`, `configFileName === "domain-config.json"`.
- Relative `--config sub/dm.json`: join of the two equals the resolved `configPath`.
- Absolute-outside-root `--config`: `path.join(configDir, configFileName)` equals
  the absolute path (proves the bridge for the outside-root case — R8 groundwork).
**Gate:** `npm run lint && npm run typecheck && npm test`.
**Independently committable:** yes (no consumer reads the new fields yet).

### Task P2 — Schema-first `DomainConfig` (zod) in `types.ts`
**Type:** P (type derivation is structurally identical → no consumer changes).
**Files:** `src/domain/types.ts`. (Verify no other file needs edits — the full
suite is the proof.)
**Change:** replace the `Relationship`, `DomainConfig`, `DomainDefinition`,
`SharedSubdomainDefinition` interfaces with zod schemas and derive the types.
Match the *exact* current field set (read `types.ts:5-28`):
```ts
import { z } from "zod";

const RelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["shared-kernel","customer-supplier","conformist",
                "anti-corruption-layer","open-host-service"]),
  description: z.string().optional(),
}).passthrough();

const DomainDefinitionSchema = z.object({
  description: z.string(),                       // REQUIRED — see scan gate below
  eventSheetDirs: z.array(z.string()).optional(),
  layoutDirs: z.array(z.string()).optional(),
  scriptDirs: z.array(z.string()).optional(),
  strategy: z.enum(["core","supporting","generic"]).optional(),
  glossary: z.record(z.string(), z.string()).optional(),
}).passthrough();

const SharedSubdomainDefinitionSchema = DomainDefinitionSchema;

export const DomainConfigSchema = z.object({
  domains: z.record(z.string(), DomainDefinitionSchema),
  sharedSubdomains: z.record(z.string(), SharedSubdomainDefinitionSchema).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
  relationships: z.array(RelationshipSchema).optional(),
}).passthrough();

export type Relationship = z.infer<typeof RelationshipSchema>;
export type DomainDefinition = z.infer<typeof DomainDefinitionSchema>;
export type SharedSubdomainDefinition = z.infer<typeof SharedSubdomainDefinitionSchema>;
export type DomainConfig = z.infer<typeof DomainConfigSchema>;
```
`FunctionParameter` re-export and the `FunctionDef`/`DomainData` interfaces stay
hand-written (not config).

**`description` scan gate (do this before locking required):** all in-repo test
fixtures already set `description` (confirmed: `test/domain/*.ts`), and the repo
ships no real `domain-config.json` (those live in target projects). Docs declare
`description` required. → Keep `description: z.string()` (required). If, while
implementing, any fixture/sample is found omitting it, downgrade to
`z.string().default("")` instead.

**Tests:** the existing full suite must pass unchanged (it constructs many
`DomainConfig` literals and indexes `DomainConfig["domains"]`). No new test here;
P2's contract is "no consumer breaks."
**Gate:** `npm run lint && npm run typecheck && npm test && npm run build`
(build included because `src/index.ts` re-exports `types.ts` — confirm the new
`DomainConfigSchema` *value* export compiles into `dist`).
**Independently committable:** yes.
**Risk:** zod `.passthrough()` may add `& { [k: string]: unknown }` to the
inferred type. If `typecheck` surfaces breakages from that index signature,
**stop and escalate** (do not silently drop `.passthrough()` — it is required for
the write round-trip in Task F2/serverside to not clobber users' unknown keys).

### Task F1 — Bump dependency to 0.3.0
**Type:** F (dependency bump; non-breaking per export delta).
**Files:** `package.json`, `package-lock.json`.
**Change:** set `@genvid/mcp-utils` to `^0.3.0`; run `npm install` to refresh the
lockfile (resolved version + integrity). Keep `main`/`types`/`exports` top-level
(per CLAUDE.md publish pitfall).
**Tests:** none new.
**Gate:** `npm ci && npm run lint && npm run typecheck && npm test && npm run build`
all green (proves R1 — bump alone is non-breaking, since no code uses the new
export yet).
**Independently committable:** yes. **Ordering:** must land before F2 (F2 imports
`loadProjectConfig`).

### Task F2 — Adopt `loadProjectConfig` in the pure core
**Type:** F.
**Files:** `src/domain/domainGenerator.ts`.
**Change:**
- Import `{ loadProjectConfig, isMcpError }` from `@genvid/mcp-utils` and
  `{ DomainConfigSchema }` from `./types.js`.
- Rewrite `loadConfig` as the async throwing wrapper:
  ```ts
  export async function loadConfig(projectRoot: string, fileName: string): Promise<DomainConfig> {
    const cfg = await loadProjectConfig(projectRoot, fileName, DomainConfigSchema);
    if (isMcpError(cfg)) {
      const text = cfg.content?.map((c) => ("text" in c ? c.text : "")).join("\n")
        ?? "config load failed";
      throw new Error(text);
    }
    return cfg;
  }
  ```
  (Drops the manual `!config.domains` check — the schema enforces it now.)
- Make `generateDomainIndex` async: signature becomes
  `generateDomainIndex(rootDir, outDir, projectRoot, fileName, log?)` and it
  `await`s `loadConfig(projectRoot, fileName)`. The rest (rmSync/mkdirSync/writes)
  is unchanged.
**Tests:** add to `test/domain/domainGenerator.test.ts` (use the injectable
`readFile` seam so no disk I/O is needed — pass a custom `readFile` only if
testing `loadConfig` directly; otherwise write a temp config file):
- R3: a config with unknown extra top-level + per-domain keys loads and **retains**
  those keys (`.passthrough()`).
- R4: `loadConfig` rejects on malformed JSON; message contains `loadProjectConfig(`.
- R5: `loadConfig` rejects when `domains` is missing; message mentions `domains`.
**Gate:** `npm run lint && npm run typecheck && npm test && npm run build`.
**Ordering:** after F1. Will break callers' compile (cli.ts, server.ts) until F3
— acceptable mid-stack, but to keep each commit green, **F2 and F3 may be
squashed into one commit** if the typecheck gate can't pass independently (see
"Commit ordering" note).

### Task F3 — Wire the CLI to async `loadConfig`/`generateDomainIndex`
**Type:** F.
**Files:** `src/cli.ts`.
**Change:**
- `generate` handler → `async`; `await generateDomainIndex(loc.projectRoot,
  loc.extractedDir, loc.configDir, loc.configFileName, console.log)` inside the
  existing `try/finally` (ephemeral cleanup unchanged).
- `list-uncategorized` / `list-stale-overrides` handlers → `async`; replace
  `JSON.parse(readFileSync(loc.configPath,...)) as DomainConfig` with
  `const config = await loadConfig(loc.configDir, loc.configFileName);`. Drop the
  now-unused `readFileSync`/`DomainConfig` imports if no longer referenced (keep
  `readFileSync` — still used for `package.json` at `cli.ts:18`).
**Tests:** none new (CLI is a thin adapter; covered indirectly). Optionally a
smoke test that `generate` writes the index (R7) if a CLI harness exists.
**Gate:** `npm run lint && npm run typecheck && npm test && npm run build`.
**Ordering:** after F2.

### Task F4 — Wire the MCP server (raw helper + narrow at call sites)
**Type:** F.
**Files:** `src/mcp/server.ts`.
**Change:**
- Import `{ …, loadProjectConfig, isMcpError }` (add to the existing line 7) and
  `{ DomainConfigSchema }` from `../domain/types.js`. Import the `CallToolResult`
  type as needed for signatures.
- Add module-level `CONFIG_DIR` / `CONFIG_FILENAME`, set in `startServer` from
  `loc.configDir` / `loc.configFileName` (alongside the existing `CONFIG_PATH`).
- `loadDomainConfig` → async, returns `DomainConfig | CallToolResult`:
  ```ts
  async function loadDomainConfig(): Promise<DomainConfig | CallToolResult> {
    if (!domainConfigCache) {
      const cfg = await loadProjectConfig(CONFIG_DIR, CONFIG_FILENAME, DomainConfigSchema);
      if (isMcpError(cfg)) return cfg;     // do NOT cache
      domainConfigCache = cfg;
    }
    return domainConfigCache;
  }
  ```
- `getDomainData` → async, returns `ComputeDomainDataResult | CallToolResult`:
  `const config = await loadDomainConfig(); if (isMcpError(config)) return config;`
  then `computeDomainData`.
- Each tool handler that calls `loadDomainConfig()` (sites at ~188, 209, 240, 282,
  336, 422, 505) and each that calls `getDomainData()` (~448, 472, 506):
  `await` it and add `if (isMcpError(config)) return config;`. The existing
  `try/catch` blocks stay (they still guard `computeDomainData`/formatters), but
  the structured `loadProjectConfig` error now propagates verbatim rather than
  being reduced to `notFound(... e.message)`.
- `regenerate` (~373): `await generateDomainIndex(PROJECT_ROOT, EXTRACTED_DIR,
  CONFIG_DIR, CONFIG_FILENAME, log)`; the follow-up `loadDomainConfig()` →
  `await` + narrow before `computeDomainData`.
- `startServer` auto-generate (~548): `await generateDomainIndex(PROJECT_ROOT,
  EXTRACTED_DIR, CONFIG_DIR, CONFIG_FILENAME, log)` (already in an async fn; the
  surrounding try/catch still catches the thrown error from the wrapper — but note
  `generateDomainIndex` no longer *throws* on config errors at the server boundary
  because it calls the core wrapper, which DOES throw; keep the try/catch).
- `writeDomainConfig` stays sync; `domainConfigCache = config` self-write path
  unchanged (the mutated object still satisfies the lenient `.passthrough()`
  schema, so no re-validation needed — add a one-line comment noting this).
- Watcher invalidation (`domainConfigCache = null` at ~525) unchanged.
**Tests:** add MCP-level tests (or extend existing server/override tests):
- R6: pointing the server at a malformed config makes a read tool return
  `{ isError: true }` whose text contains the `loadProjectConfig(` prefix.
- R9: first `loadDomainConfig` on a broken file returns an error and leaves
  `domainConfigCache === null`; after the file is fixed, the next call succeeds.
- R10: `set-overrides` → `writeDomainConfig` sets the cache; a subsequent read
  returns the mutated config without re-reading disk (extend existing override
  tests).
**Gate:** `npm run lint && npm run typecheck && npm test && npm run build`.
**Ordering:** after F1 (and after F2 for the new `loadConfig`/`generateDomainIndex`
signatures). Independent of F3.

### Task F5 — Docs
**Type:** F (docs only).
**Files:** `README.md`, `CLAUDE.md`, `docs/domain-architecture.md`.
**Change:**
- `README.md:182` — update `generateDomainIndex(root, extracted, configPath, log)`
  → `generateDomainIndex(root, extracted, configDir, configFileName, log)` and note
  it is now async (returns `Promise<void>`).
- `CLAUDE.md` (Architecture / computation-vs-I/O section, ~`:47-48`) — update the
  `generateDomainIndex(...)` description for the new `(configDir, configFileName)`
  params + async return, and note `loadConfig` now validates via
  `DomainConfigSchema` and throws a `loadProjectConfig(...)`-prefixed error.
  Update the Key-dependencies blurb to mention `loadProjectConfig`/`isMcpError`.
- `docs/domain-architecture.md` — additive note: config is now validated against a
  lenient zod schema (`.passthrough()` tolerates unknown keys; non-essential fields
  optional; `description` required) and load failures are reported with the
  `loadProjectConfig(...)` prefix.
**Tests:** none. **Gate:** `npm run lint` (markdown unaffected; run full gate for
safety). **Ordering:** last.

---

## Commit ordering

`prep (plan.md) → P1 → P2 → F1 → F2(+F3+F4 wiring) → F5`.

P1 and P2 are independently green and land first. F1 (bump) is green on its own.
**F2 changes `loadConfig`/`generateDomainIndex` signatures, so the dependent
adapters (F3 CLI, F4 server) must compile against the new signatures for the
typecheck gate to pass.** If keeping each commit green is required (it is, per the
validator-after-each-task gate), land **F2 + F3 + F4 as one commit** (the
"adopt loadProjectConfig across core + adapters" commit), or stage F2 with
temporary call-site updates. Default: **one wiring commit** covering F2–F4, then
F5 docs. This keeps history at: `prep → P1 → P2 → F1 → F2–F4 wiring → F5 docs`.

## Risks

1. **`.passthrough()` inferred index signature** (Task P2) — may leak
   `[k: string]: unknown` into `DomainConfig` and ripple to consumers. Mitigation:
   typecheck gate on P2; escalate rather than dropping passthrough (needed for the
   write round-trip to preserve users' unknown keys).
2. **Sync→async ripple** — every load caller flips to `async`. All up-stack
   callers are already async (yargs handlers, rwlock callbacks, `startServer`), so
   the change is mechanical; the risk is a missed `await` (silent `Promise` where a
   value is expected). Mitigation: typecheck (`Promise<DomainConfig>` vs
   `DomainConfig` mismatches surface) + full test suite (R7 index-written check).
3. **Error-shape behaviour change at MCP boundary** — read tools now return the
   structured `loadProjectConfig(...)` error instead of `notFound(... e.message)`.
   This is an intended improvement but changes tool output text; update any test
   asserting the old `notFound` wording. (R6 covers the new shape.)
4. **Self-write re-validation skipped** — `writeDomainConfig` caches the mutated
   object without re-validating. Safe under the lenient schema; documented by a
   comment. If the schema is ever tightened, revisit.
5. **`description` required is stricter than the old cast** — mitigated by the scan
   gate (Task P2). Fallback: `.default("")`.

## Validation (per task + final)

Per-task gate: `npm run lint && npm run typecheck && npm test` (add `npm run build`
for P2/F1–F4 where exports/signatures change). Final: full gate + the
`genvid-dev:code-reviewer` pass; if it flags doc gaps, dispatch
`genvid-dev:tech-writer`.
