import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ExpectedChanges, exposeDocs, loadProjectConfig, isMcpError, mcpContent, paginatedContent, withMcpErrors, READ_ONLY, REGENERATE, MUTATE } from "@genvidtech/mcp-utils";
import type { Logger } from "@genvidtech/mcp-utils";
import { formatDomainConfig } from "../domain/formatting.js";
import type { DomainConfigSection } from "../domain/formatting.js";
import type { DomainConfig } from "../domain/types.js";
import { collectGlossary, findCollisions, formatGlossaryReport } from "../domain/glossary.js";
import { validateBoundaries, formatBoundaryReport } from "../domain/relationships.js";
import { validateEditorStrictness, formatEditorStrictnessReport } from "../domain/editorValidation.js";
import { computeAddonInventory, formatAddonInventoryReport } from "../domain/addonInventory.js";
import { computeHealth, formatHealthReport } from "../domain/health.js";
import { generateContextMap } from "../domain/contextMap.js";
import { computeHubDomains } from "../domain/coupling.js";
import {
  listUncategorized,
  listStaleOverrides,
  listInertOverrides,
  collectValidDomainNames,
  validateOverrideKeys,
  validateOverrideValues,
} from "../domain/domainAnalysis.js";
import { generateDomainIndex, computeDomainData } from "../domain/domainGenerator.js";
import { resolveLocations, buildRegistry } from "../adapters/locations.js";
import { ProjectContext } from "../adapters/projectContext.js";
import { ProjectRegistry } from "../adapters/projectRegistry.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ShapeOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";

// Assigned by startServer() before any transport is connected and therefore
// before any registered tool callback can be dispatched (ADR 0025 L3).
let REGISTRY: ProjectRegistry<ProjectContext>;

const server = new McpServer(
  { name: "c3-domain-manager", version: "1.0.0" },
  { capabilities: { logging: {}, resources: {} } },
);

const __pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// `wiki/` is the OKF bundle root and the published documentation tier (ADR 0027).
// `recursive` is mandatory, not cosmetic. Measured against this tree: it
// serves 36 names with, and 6 without — so dropping it silently loses the
// 30 documents under `wiki/decisions/`, `wiki/reference/` and
// `wiki/process/`, leaving only the bundle-root files. `walkFiles` returns
// `[]` rather than throwing, so that loss surfaces as an empty resource,
// not an error (ADR 0027 Q6).
exposeDocs(server, __pkgDir, { docsDir: "wiki", recursive: true });

// Shared, server-wide `ExpectedChanges` — one instance regardless of how the
// registry actually serving this process gets built (the default parameter
// of startServer below, or the explicit registry cli.ts builds for
// --project-dir/--config/--extracted). Both paths inject this same instance
// into buildRegistry's `expected` option, which is what makes the shared
// purgeExpired interval near the bottom of this file purge the registry this
// server actually ends up serving rather than an orphaned private instance.
export const expectedChanges = new ExpectedChanges();

// ── Helpers ──────────────────────────────────────────────────────────────────

// Not exported directly (see the B1 grep contract this declaration is pinned
// by) — re-exported via the `export { emitLog }` statement below instead, so
// cli.ts can inject it into buildRegistry's `emit` option.
function emitLog(level: "debug" | "info" | "warning" | "error", message: string): void {
  server.sendLoggingMessage({ level, logger: "c3-domain-manager", data: message }).catch(() => {});
}
export { emitLog };

function isWithinDir(fullPath: string, dir: string): boolean {
  return fullPath.startsWith(dir + path.sep) || fullPath === dir;
}

function notFound(tool: string, hint: string): { content: { type: "text"; text: string }[]; isError: true } {
  return {
    content: [{ type: "text", text: `${tool}: ${hint}` }],
    isError: true,
  };
}

const PAGINATION_PARAMS = {
  offset: z.number().int().min(1).optional().describe("Start line (1-based). Omit to start from beginning."),
  limit: z.number().int().min(1).optional().describe("Max lines to return. Omit to return all."),
};

// Selector accepted by every per-project tool via registerProjectTool. Optional
// so a single-registered-project server keeps working with no client change;
// ProjectRegistry.resolve() is what rejects an omitted id when more than one
// project is registered.
const PROJECT_PARAM = z
  .string()
  .optional()
  .describe(
    "Which registered project to target, by id (see list-projects for known ids and roots). " +
      "Optional when exactly one project is registered; required to disambiguate when more than one is.",
  );

/**
 * Wraps `server.registerTool` for every tool that targets a single project:
 * resolves `args.project` against `REGISTRY` (outside any lock — see below),
 * then acquires exactly the one lock the tool needs on the resolved
 * `ProjectContext` before invoking `body`.
 *
 * `ReadWriteLock` has no owner tracking, no reentrancy, and is
 * write-preferring (`acquireRead` queues behind any pending write), so a
 * nested acquisition deadlocks in both directions. `body` must therefore
 * never itself acquire `ctx.rwlock` — this wrapper is the only place that
 * does.
 */
function registerProjectTool<S extends z.ZodRawShape = Record<string, never>>(
  name: string,
  cfg: {
    title: string;
    description: string;
    annotations: ToolAnnotations;
    inputSchema?: S;
  },
  mode: "read" | "write",
  body: (ctx: ProjectContext, args: ShapeOutput<S & { project: typeof PROJECT_PARAM }>) => Promise<CallToolResult>,
): void {
  const inputSchema = { ...(cfg.inputSchema ?? {}), project: PROJECT_PARAM } as S & { project: typeof PROJECT_PARAM };
  // The `as any` below is a single, narrow crossing: `registerTool`'s callback
  // type is a conditional type over its InputArgs generic (BaseToolCallback),
  // and a conditional type over a still-abstract, naked type parameter (S,
  // from this enclosing generic function) is a TS-known deferred/unresolved
  // type — it cannot be reduced to either branch, so no concrete function
  // value can ever be proven assignable to it while S remains abstract. The
  // runtime shape is correct by construction (inputSchema above is exactly
  // this callback's argument shape); only TS's inference through the SDK's
  // own conditional type is what can't be threaded here.
  const callback = async (args: ShapeOutput<S & { project: typeof PROJECT_PARAM }>) => {
    const ctx = REGISTRY.resolve(args.project);
    if (isMcpError(ctx)) return ctx;
    return mode === "read"
      ? ctx.rwlock.read(() => body(ctx, args))
      : ctx.rwlock.write(() => body(ctx, args));
  };
  server.registerTool(
    name,
    {
      title: cfg.title,
      description: cfg.description,
      annotations: cfg.annotations,
      inputSchema,
    },
    callback as any,
  );
}

// ── Tools ─────────────────────────────────────────────────────────────────────

registerProjectTool(
  "read-domain-index",
  {
    title: "Read Domain Index",
    description:
      "Read the domain index for a feature area. Without a domain, returns the master index listing all domains. With a domain name (e.g. 'Authentication'), returns that domain's detail page with functions, cross-domain dependencies, and include graphs.",
    annotations: READ_ONLY,
    inputSchema: {
      domain: z.string().optional().describe("Domain name (e.g. 'Authentication'). Omit for master index."),
      ...PAGINATION_PARAMS,
    },
  },
  "read",
  async (ctx, { domain, offset, limit }) => {
    const relPath = domain
      ? `domain-index/${domain}.md`
      : "domain-index/index.md";
    const text = ctx.readExtracted(relPath);
    if (text === null) {
      const indexText = ctx.readExtracted("domain-index/index.md");
      const hint = domain
        ? `No domain index found for '${domain}'. Available domains:\n${indexText ?? "(index not found)"}`
        : "domain-index/index.md not found. Run 'npm run generate-domain' to generate it.";
      return notFound("read-domain-index", hint);
    }
    return paginatedContent(text, { offset, limit }, ctx.staleFooter());
  },
);

registerProjectTool(
  "read-domain-config",
  {
    title: "Read Domain Config",
    description:
      "Read the raw domain-config.json structure. Returns domains, shared subdomains, and overrides " +
      "in a formatted text view. Use 'section' to filter to a specific part.",
    annotations: READ_ONLY,
    inputSchema: {
      section: z.enum(["domains", "sharedSubdomains", "overrides", "all"]).default("all")
        .describe("Which section to return (default: all)"),
    },
  },
  "read",
  async (ctx, { section }) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const text = formatDomainConfig(config, section as DomainConfigSection);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return notFound("read-domain-config", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

registerProjectTool(
  "list-uncategorized",
  {
    title: "List Uncategorized Files",
    description:
      "List project files (eventSheets, layouts, scripts) not covered by any domain mapping or override in domain-config.json. Useful for maintaining domain coverage.",
    annotations: READ_ONLY,
  },
  "read",
  async (ctx) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const uncategorized = listUncategorized(ctx.root, config);
      if (uncategorized.length === 0) {
        return { content: [{ type: "text", text: "All files are categorized." }] };
      }
      return {
        content: [
          {
            type: "text",
            text: `${uncategorized.length} uncategorized files:\n${uncategorized.join("\n")}`,
          },
        ],
      };
    } catch (e) {
      return notFound("list-uncategorized", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

registerProjectTool(
  "list-stale-overrides",
  {
    title: "List Stale Overrides",
    description:
      "List override entries in domain-config.json that are dead weight: either they point to files that no longer exist on disk (stale), or the file still exists but no walk can ever surface it, so the override can never take effect (inert). Both kinds should be removed to keep the domain config clean.",
    annotations: READ_ONLY,
  },
  "read",
  async (ctx) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const stale = listStaleOverrides(ctx.root, config);
      const inert = listInertOverrides(ctx.root, config);
      if (stale.length === 0 && inert.length === 0) {
        return { content: [{ type: "text", text: "No stale or inert overrides found." }] };
      }
      const sections: string[] = [];
      if (stale.length > 0) {
        sections.push(`${stale.length} stale overrides:\n${stale.join("\n")}`);
      }
      if (inert.length > 0) {
        sections.push(
          `${inert.length} inert overrides:\n${inert.map((i) => `${i.key}\n  ${i.reason}`).join("\n")}`,
        );
      }
      return {
        content: [
          {
            type: "text",
            text: sections.join("\n\n"),
          },
        ],
      };
    } catch (e) {
      return notFound("list-stale-overrides", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

registerProjectTool(
  "set-overrides",
  {
    title: "Set Domain Overrides",
    description:
      "Add or update overrides in domain-config.json. Each override maps a file path " +
      "(e.g. 'eventSheets/Foo.json') to a domain or subdomain name. The domain must exist in the config.",
    annotations: MUTATE,
    inputSchema: {
      overrides: z.record(z.string(), z.string())
        .describe("File path → domain/subdomain name"),
      txId: z.number().optional()
        .describe("Expected txId for optimistic concurrency — rejected if stale"),
    },
  },
  "write",
  async (ctx, { overrides: newOverrides, txId: expectedTxId }) =>
    withMcpErrors(async (): Promise<CallToolResult> => {
      if (expectedTxId !== undefined && expectedTxId !== ctx.watcher.txId) {
        return {
          content: [{ type: "text", text: `State changed: expected txId ${expectedTxId}, got ${ctx.watcher.txId}. Re-read state and retry.` }],
          isError: true,
        };
      }
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const validNames = collectValidDomainNames(config);
      const keyErrors = validateOverrideKeys(Object.keys(newOverrides));
      const valueErrors = validateOverrideValues(newOverrides, validNames);
      const errors = [...keyErrors, ...valueErrors];
      if (errors.length > 0) {
        return {
          content: [{ type: "text", text: `Validation failed:\n${errors.join("\n")}` }],
          isError: true,
        };
      }
      if (!config.overrides) config.overrides = {};
      const added: string[] = [];
      const updated: string[] = [];
      for (const [filePath, domain] of Object.entries(newOverrides)) {
        if (filePath in config.overrides) {
          updated.push(`${filePath}: ${config.overrides[filePath]} → ${domain}`);
        } else {
          added.push(`${filePath} → ${domain}`);
        }
        config.overrides[filePath] = domain;
      }
      ctx.writeDomainConfig(config);
      const parts: string[] = [];
      if (added.length > 0) parts.push(`Added ${added.length}:\n${added.join("\n")}`);
      if (updated.length > 0) parts.push(`Updated ${updated.length}:\n${updated.join("\n")}`);
      return mcpContent(parts.join("\n\n"), `txId: ${ctx.watcher.txId}`);
    }, { onError: ctx.onWriteError })(),
);

registerProjectTool(
  "remove-overrides",
  {
    title: "Remove Domain Overrides",
    description:
      "Remove overrides from domain-config.json by file path. " +
      "Non-existent keys are silently ignored. Use after list-stale-overrides to clean up.",
    annotations: MUTATE,
    inputSchema: {
      paths: z.array(z.string())
        .describe("File paths to remove from overrides"),
      txId: z.number().optional()
        .describe("Expected txId for optimistic concurrency — rejected if stale"),
    },
  },
  "write",
  async (ctx, { paths, txId: expectedTxId }) =>
    withMcpErrors(async (): Promise<CallToolResult> => {
      if (expectedTxId !== undefined && expectedTxId !== ctx.watcher.txId) {
        return {
          content: [{ type: "text", text: `State changed: expected txId ${expectedTxId}, got ${ctx.watcher.txId}. Re-read state and retry.` }],
          isError: true,
        };
      }
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      if (!config.overrides || Object.keys(config.overrides).length === 0) {
        return { content: [{ type: "text", text: "No overrides to remove." }] };
      }
      const removed: string[] = [];
      for (const p of paths) {
        if (p in config.overrides) {
          removed.push(`${p} (was: ${config.overrides[p]})`);
          delete config.overrides[p];
        }
      }
      if (removed.length === 0) {
        return { content: [{ type: "text", text: "None of the specified paths were in overrides." }] };
      }
      ctx.writeDomainConfig(config);
      return mcpContent(`Removed ${removed.length}:\n${removed.join("\n")}`, `txId: ${ctx.watcher.txId}`);
    }, { onError: ctx.onWriteError })(),
);

registerProjectTool(
  "regenerate",
  {
    title: "Regenerate Domain Index",
    description:
      "Run the domain index generator and update extracted/domain-index/. Clears the domainDirty flag. Use after external edits to domain-config.json or source files, or when domainDirty is true.",
    annotations: REGENERATE,
  },
  "write",
  async (ctx) => {
    const lines: string[] = [];
    const log: Logger = (...args) => lines.push(args.map(String).join(" "));
    try {
      await ctx.watcher.suppress(async () => {
        await generateDomainIndex(ctx.root, ctx.extractedDir, ctx.configDir, ctx.configFileName, log);
      });
      // Force a fresh recompute (never reuse a cached value here — that is
      // exactly what a regenerate is for) and record it, clearing domainDirty.
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      ctx.markRegenerated(computeDomainData(ctx.root, config));
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  },
);

registerProjectTool(
  "get-state",
  {
    title: "Get Server State",
    description:
      "Returns the current server state: txId (incremented on domain-config.json changes) and domainDirty (true if domain-config.json or source files changed since last regeneration).",
    annotations: READ_ONLY,
  },
  "read",
  async (ctx) => {
    return {
      content: [{ type: "text", text: `txId: ${ctx.watcher.txId}\ndomainDirty: ${ctx.domainDirty}` }],
    };
  },
);

registerProjectTool(
  "glossary-check",
  {
    title: "Check Glossary Collisions",
    description:
      "Check for glossary term collisions across domains. Reports terms that appear in multiple domains with different definitions.",
    annotations: READ_ONLY,
  },
  "read",
  async (ctx) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const entries = collectGlossary(config);
      const collisions = findCollisions(entries);
      const report = formatGlossaryReport(collisions);
      return { content: [{ type: "text", text: report }] };
    } catch (e) {
      return notFound("glossary-check", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

registerProjectTool(
  "validate-boundaries",
  {
    title: "Validate Domain Boundaries",
    description:
      "Validate domain boundaries by checking for undeclared cross-domain dependencies, stale relationship declarations, and forbidden dependency patterns (e.g., supporting domains depending on core domains).",
    annotations: READ_ONLY,
    inputSchema: {
      domain: z.string().optional().describe("Filter violations to a specific domain"),
    },
  },
  "read",
  async (ctx, { domain }) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const data = await ctx.getDomainData();
      if (isMcpError(data)) return data;
      const { domains } = data;
      const report = validateBoundaries(domains, config, domain);
      const text = formatBoundaryReport(report);
      return { content: [{ type: "text", text: ctx.appendStaleWarning(text) }] };
    } catch (e) {
      return notFound("validate-boundaries", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

// Deliberately omits the stale-index warning: this diagnostic re-walks event
// sheets fresh from disk and never reads the cached domain index, so index
// staleness is irrelevant to its output (see wiki/reference/domain-architecture.md).
registerProjectTool(
  "validate-editor",
  {
    title: "Validate Editor Strictness",
    description:
      "Report event sheets the C3 editor would reject on import (editor-strictness validation). Flags variable events missing a comment and group events missing a description — fields the C3 editor loader requires but the lenient parse types allow to be absent. Validates sheets fresh from disk, so its result is independent of domain-index staleness.",
    annotations: READ_ONLY,
  },
  "read",
  async (ctx) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const report = validateEditorStrictness(ctx.root, config);
      // No appendStaleWarning: this diagnostic re-walks sheets fresh and never
      // reads the cached domain index, so the index-staleness warning would mislead.
      return { content: [{ type: "text", text: formatEditorStrictnessReport(report) }] };
    } catch (e) {
      return notFound("validate-editor", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

// Deliberately omits the stale-index warning: this diagnostic derives addon
// attribution fresh from disk and never reads the cached domain index, so
// index staleness is irrelevant to its output (same reasoning as validate-editor).
registerProjectTool(
  "addon-inventory",
  {
    title: "Addon Inventory",
    description:
      "Report project-wide addon usage by cross-referencing the manifest's declared usedAddons against the addons each object type and family actually draws on. Flags declared-but-unused addons (a manifest entry nothing uses — a dead dependency) and used-but-undeclared addons (drawn on but absent from usedAddons — manifest drift). Derives attribution fresh from disk, so its result is independent of domain-index staleness.",
    annotations: READ_ONLY,
  },
  "read",
  async (ctx) => {
    try {
      const report = computeAddonInventory(ctx.root);
      // No appendStaleWarning: this diagnostic derives attribution fresh from
      // disk and never reads the cached domain index, so the index-staleness
      // warning would mislead (same reasoning as validate-editor).
      return { content: [{ type: "text", text: formatAddonInventoryReport(report) }] };
    } catch (e) {
      return notFound("addon-inventory", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

registerProjectTool(
  "domain-health",
  {
    title: "Domain Health Metrics",
    description:
      "Compute coupling and instability metrics for domains. Ca = afferent coupling (incoming dependencies), Ce = efferent coupling (outgoing dependencies), Instability = Ce/(Ca+Ce).",
    annotations: READ_ONLY,
    inputSchema: {
      domain: z.string().optional().describe("Compute metrics for a specific domain only"),
    },
  },
  "read",
  async (ctx, { domain: domainFilter }) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const data = await ctx.getDomainData();
      if (isMcpError(data)) return data;
      const { domains } = data;
      let targetDomains = domains;
      if (domainFilter) {
        targetDomains = domains.filter(d => d.name === domainFilter);
        if (targetDomains.length === 0) {
          return notFound("domain-health", `Domain '${domainFilter}' not found`);
        }
      }
      const hubDomains = computeHubDomains(domains, config);
      const results = targetDomains.map(d => ({ name: d.name, ...computeHealth(d, hubDomains) }));
      const text = formatHealthReport(results);
      return { content: [{ type: "text", text: ctx.appendStaleWarning(text) }] };
    } catch (e) {
      return notFound("domain-health", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

registerProjectTool(
  "context-map",
  {
    title: "Generate Context Map",
    description:
      "Generate a context map showing relationships between domains. Supports text and mermaid output formats. Use 'domain' parameter to focus on a single domain's neighborhood.",
    annotations: READ_ONLY,
    inputSchema: {
      format: z.enum(["text", "mermaid"]).describe("Output format"),
      domain: z.string().optional().describe("Focus on this domain's 1-hop neighborhood"),
      includeObserved: z.boolean().optional().default(true).describe("Include observed (undeclared) dependencies"),
    },
  },
  "read",
  async (ctx, { format, domain, includeObserved }) => {
    try {
      const config = await ctx.loadDomainConfig();
      if (isMcpError(config)) return config;
      const data = await ctx.getDomainData();
      if (isMcpError(data)) return data;
      const { domains } = data;
      const text = generateContextMap(domains, config, { format, domain, includeObserved });
      return { content: [{ type: "text", text: ctx.appendStaleWarning(text) }] };
    } catch (e) {
      return notFound("context-map", `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

// The one tool exempt from the `project` selector: it lists every registered
// project so a client can discover which id to pass to every other tool.
// Registered directly with server.registerTool, not through
// registerProjectTool. No txId — deliberately, so a client cannot mistake a
// listing snapshot for a reservation, and so a fourth token-emission site
// (besides set-overrides, remove-overrides, and the external-change watcher
// callback) is not created.
server.registerTool(
  "list-projects",
  {
    title: "List Registered Projects",
    description:
      "List every project registered with this server: its id (pass as `project` to any other tool to target it) and its resolved root directory. Useful to discover ids before calling a per-project tool when more than one project is registered.",
    annotations: READ_ONLY,
  },
  async () => {
    const ids = REGISTRY.ids();
    const lines = ids.map((id) => {
      const ctx = REGISTRY.resolve(id);
      if (isMcpError(ctx)) return `${id}: (error resolving project)`;
      return `${id}: ${ctx.root}`;
    });
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

async function ensureDomainIndex(ctx: ProjectContext): Promise<void> {
  const domainIndexPath = path.join(ctx.extractedDir, "domain-index");
  if (fs.existsSync(domainIndexPath)) return;
  console.error(`[c3-domain-manager] [${ctx.id}] domain-index not found — auto-generating...`);
  try {
    const log: Logger = (...args) => console.error(`[c3-domain-manager] [${ctx.id}]   ${args.map(String).join(" ")}`);
    await generateDomainIndex(ctx.root, ctx.extractedDir, ctx.configDir, ctx.configFileName, log);
    console.error(`[c3-domain-manager] [${ctx.id}] Auto-generation complete`);
  } catch (e) {
    console.error(`[c3-domain-manager] [${ctx.id}] Warning: auto-generation failed — ${e instanceof Error ? e.message : String(e)}`);
    console.error(`[c3-domain-manager] [${ctx.id}] Run 'npx c3-domain-manager generate' manually to generate domain index`);
  }
}

export async function startServer(
  registry: ProjectRegistry<ProjectContext> = buildRegistry(
    [{ root: resolveLocations({}, process.cwd()).projectRoot }],
    { emit: emitLog, expected: expectedChanges },
  ),
): Promise<void> {
  REGISTRY = registry;

  // computeDomainData is synchronous CPU work on a single-threaded runtime —
  // Promise.all here would buy nothing and would only add an interleaving.
  for (const id of REGISTRY.ids()) {
    const ctx = REGISTRY.resolve(id);
    if (isMcpError(ctx)) continue; // unreachable: id came from REGISTRY.ids()
    await ensureDomainIndex(ctx);
    console.error(`[c3-domain-manager] [${ctx.id}] Serving ${ctx.root}`);
    console.error(`[c3-domain-manager] [${ctx.id}] config: ${ctx.configPath}${ctx.extractedEphemeral ? " | extracted: ephemeral" : ""}`);
  }

  // Graceful shutdown — iterates every registered context.
  function shutdown() {
    console.error("[c3-domain-manager] Shutting down...");
    for (const id of REGISTRY.ids()) {
      const ctx = REGISTRY.resolve(id);
      if (isMcpError(ctx)) continue;
      ctx.stop();
    }
    server.close().catch(() => {});
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for (const id of REGISTRY.ids()) {
    const ctx = REGISTRY.resolve(id);
    if (isMcpError(ctx)) continue;
    ctx.start();
  }

  // Periodically purge expired entries from the shared expectedChanges — one
  // timer for the one shared instance, regardless of how many projects are
  // registered.
  setInterval(() => expectedChanges.purgeExpired(), 30_000).unref();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
