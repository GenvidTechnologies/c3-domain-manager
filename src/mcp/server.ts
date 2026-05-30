import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ReadWriteLock, ExpectedChanges, paginateText, exposeDocs } from "@genvid/mcp-utils";
import type { Logger } from "@genvid/mcp-utils";
import { formatDomainConfig } from "../domain/formatting.js";
import type { DomainConfigSection } from "../domain/formatting.js";
import type { DomainConfig } from "../domain/types.js";
import { collectGlossary, findCollisions, formatGlossaryReport } from "../domain/glossary.js";
import { validateBoundaries, formatBoundaryReport } from "../domain/relationships.js";
import { computeHealth, formatHealthReport } from "../domain/health.js";
import { generateContextMap } from "../domain/contextMap.js";
import {
  listUncategorized,
  listStaleOverrides,
  collectValidDomainNames,
  validateOverrideKeys,
  validateOverrideValues,
} from "../domain/domainAnalysis.js";
import { generateDomainIndex, computeDomainData } from "../domain/domainGenerator.js";
import type { ComputeDomainDataResult } from "../domain/domainGenerator.js";

let PROJECT_ROOT = process.cwd();
let EXTRACTED_DIR = path.join(PROJECT_ROOT, "extracted");

const server = new McpServer(
  { name: "c3-domain-manager", version: "1.0.0" },
  { capabilities: { logging: {}, resources: {} } },
);

const __pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
exposeDocs(server, __pkgDir);

// ── Server State ─────────────────────────────────────────────────────────────

let txId = 0;
let domainDirty = false;
let suppressWatcherDepth = 0;
const rwlock = new ReadWriteLock();
const expectedChanges = new ExpectedChanges();
let domainConfigCache: DomainConfig | null = null;
let domainDataCache: ComputeDomainDataResult | null = null;

// ── Tool Annotations ─────────────────────────────────────────────────────────

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const REGENERATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
const MUTATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

function emitLog(level: "debug" | "info" | "warning" | "error", message: string): void {
  server.sendLoggingMessage({ level, logger: "c3-domain-manager", data: message }).catch(() => {});
}

function isWithinDir(fullPath: string, dir: string): boolean {
  return fullPath.startsWith(dir + path.sep) || fullPath === dir;
}

function readExtracted(relPath: string): string | null {
  const fullPath = path.resolve(path.join(EXTRACTED_DIR, relPath));
  if (!isWithinDir(fullPath, EXTRACTED_DIR)) return null;
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

function notFound(tool: string, hint: string): { content: { type: "text"; text: string }[]; isError: true } {
  return {
    content: [{ type: "text", text: `${tool}: ${hint}` }],
    isError: true,
  };
}

const STALE_WARNING = "\n\n[Warning: domain index may be stale — run regenerate to refresh]";

function appendStaleWarning(text: string): string {
  return domainDirty ? text + STALE_WARNING : text;
}

const PAGINATION_PARAMS = {
  offset: z.number().int().min(1).optional().describe("Start line (1-based). Omit to start from beginning."),
  limit: z.number().int().min(1).optional().describe("Max lines to return. Omit to return all."),
};

function paginatedResponse(
  text: string,
  offset: number | undefined,
  limit: number | undefined,
): { content: { type: "text"; text: string }[] } {
  const paginated = paginateText(text, { offset, limit });
  const content: { type: "text"; text: string }[] = [
    { type: "text", text: appendStaleWarning(paginated.text) },
  ];
  if (offset !== undefined || limit !== undefined) {
    const returnedLines = paginated.text === "" ? 0 : paginated.text.split("\n").length;
    const endLine = paginated.offset + Math.max(0, returnedLines - 1);
    content.push({ type: "text", text: `lines: ${paginated.offset}-${endLine} / ${paginated.totalLines}` });
  }
  return { content };
}

// ── Domain Config Cache ───────────────────────────────────────────────────────

function loadDomainConfig(): DomainConfig {
  if (!domainConfigCache) {
    const configPath = path.join(PROJECT_ROOT, "domain-config.json");
    domainConfigCache = JSON.parse(fs.readFileSync(configPath, "utf-8")) as DomainConfig;
  }
  return domainConfigCache;
}

function getDomainData(): ComputeDomainDataResult {
  if (!domainDataCache) {
    const config = loadDomainConfig();
    domainDataCache = computeDomainData(PROJECT_ROOT, config);
  }
  return domainDataCache;
}

function writeDomainConfig(config: DomainConfig): void {
  const configPath = path.join(PROJECT_ROOT, "domain-config.json");
  suppressWatcherDepth++;
  try {
    expectedChanges.add("domain-config.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t") + "\n", "utf-8");
  } finally {
    suppressWatcherDepth--;
  }
  domainConfigCache = config;
  txId++;
  domainDirty = true;
  emitLog("info", `domain-config.json updated (txId → ${txId})`);
}

// ── Tools ─────────────────────────────────────────────────────────────────────

server.registerTool(
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
  async ({ domain, offset, limit }) =>
    rwlock.read(async () => {
      const relPath = domain
        ? `domain-index/${domain}.md`
        : "domain-index/index.md";
      const text = readExtracted(relPath);
      if (text === null) {
        const indexText = readExtracted("domain-index/index.md");
        const hint = domain
          ? `No domain index found for '${domain}'. Available domains:\n${indexText ?? "(index not found)"}`
          : "domain-index/index.md not found. Run 'npm run generate-domain' to generate it.";
        return notFound("read-domain-index", hint);
      }
      return paginatedResponse(text, offset, limit);
    })
);

server.registerTool(
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
  async ({ section }) =>
    rwlock.read(async () => {
      try {
        const config = loadDomainConfig();
        const text = formatDomainConfig(config, section as DomainConfigSection);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return notFound("read-domain-config", `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
);

server.registerTool(
  "list-uncategorized",
  {
    title: "List Uncategorized Files",
    description:
      "List project files (eventSheets, layouts, scripts) not covered by any domain mapping or override in domain-config.json. Useful for maintaining domain coverage.",
    annotations: READ_ONLY,
    inputSchema: {},
  },
  async () =>
    rwlock.read(async () => {
      try {
        const config = loadDomainConfig();
        const uncategorized = listUncategorized(PROJECT_ROOT, config);
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
    })
);

server.registerTool(
  "list-stale-overrides",
  {
    title: "List Stale Overrides",
    description:
      "List override entries in domain-config.json that point to files that no longer exist on disk. These should be removed to keep the domain config clean.",
    annotations: READ_ONLY,
    inputSchema: {},
  },
  async () =>
    rwlock.read(async () => {
      try {
        const config = loadDomainConfig();
        const stale = listStaleOverrides(PROJECT_ROOT, config);
        if (stale.length === 0) {
          return { content: [{ type: "text", text: "No stale overrides found." }] };
        }
        return {
          content: [
            {
              type: "text",
              text: `${stale.length} stale overrides:\n${stale.join("\n")}`,
            },
          ],
        };
      } catch (e) {
        return notFound("list-stale-overrides", `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
);

server.registerTool(
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
  async ({ overrides: newOverrides, txId: expectedTxId }) =>
    rwlock.write(async () => {
      if (expectedTxId !== undefined && expectedTxId !== txId) {
        return {
          content: [{ type: "text", text: `State changed: expected txId ${expectedTxId}, got ${txId}. Re-read state and retry.` }],
          isError: true,
        };
      }
      const config = loadDomainConfig();
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
      writeDomainConfig(config);
      const parts: string[] = [];
      if (added.length > 0) parts.push(`Added ${added.length}:\n${added.join("\n")}`);
      if (updated.length > 0) parts.push(`Updated ${updated.length}:\n${updated.join("\n")}`);
      parts.push(`txId: ${txId}`);
      return { content: [{ type: "text", text: parts.join("\n\n") }] };
    })
);

server.registerTool(
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
  async ({ paths, txId: expectedTxId }) =>
    rwlock.write(async () => {
      if (expectedTxId !== undefined && expectedTxId !== txId) {
        return {
          content: [{ type: "text", text: `State changed: expected txId ${expectedTxId}, got ${txId}. Re-read state and retry.` }],
          isError: true,
        };
      }
      const config = loadDomainConfig();
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
      writeDomainConfig(config);
      return {
        content: [{ type: "text", text: `Removed ${removed.length}:\n${removed.join("\n")}\n\ntxId: ${txId}` }],
      };
    })
);

server.registerTool(
  "regenerate",
  {
    title: "Regenerate Domain Index",
    description:
      "Run the domain index generator and update extracted/domain-index/. Clears the domainDirty flag. Use after external edits to domain-config.json or source files, or when domainDirty is true.",
    annotations: REGENERATE,
    inputSchema: {},
  },
  async () =>
    rwlock.write(async () => {
      const lines: string[] = [];
      const log: Logger = (...args) => lines.push(args.map(String).join(" "));
      try {
        suppressWatcherDepth++;
        try {
          const configPath = path.join(PROJECT_ROOT, "domain-config.json");
          generateDomainIndex(PROJECT_ROOT, EXTRACTED_DIR, configPath, log);
        } finally {
          suppressWatcherDepth--;
        }
        // Populate domain data cache
        const config = loadDomainConfig();
        domainDataCache = computeDomainData(PROJECT_ROOT, config);
        domainDirty = false;
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    })
);

server.registerTool(
  "get-state",
  {
    title: "Get Server State",
    description:
      "Returns the current server state: txId (incremented on domain-config.json changes) and domainDirty (true if domain-config.json or source files changed since last regeneration).",
    annotations: READ_ONLY,
    inputSchema: {},
  },
  async () =>
    rwlock.read(async () => {
      return {
        content: [{ type: "text", text: `txId: ${txId}\ndomainDirty: ${domainDirty}` }],
      };
    })
);

server.registerTool(
  "glossary-check",
  {
    title: "Check Glossary Collisions",
    description:
      "Check for glossary term collisions across domains. Reports terms that appear in multiple domains with different definitions.",
    annotations: READ_ONLY,
    inputSchema: {},
  },
  async () =>
    rwlock.read(async () => {
      try {
        const config = loadDomainConfig();
        const entries = collectGlossary(config);
        const collisions = findCollisions(entries);
        const report = formatGlossaryReport(collisions);
        return { content: [{ type: "text", text: report }] };
      } catch (e) {
        return notFound("glossary-check", `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
);

server.registerTool(
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
  async ({ domain }) =>
    rwlock.read(async () => {
      try {
        const config = loadDomainConfig();
        const { domains } = getDomainData();
        const report = validateBoundaries(domains, config, domain);
        const text = formatBoundaryReport(report);
        return { content: [{ type: "text", text: appendStaleWarning(text) }] };
      } catch (e) {
        return notFound("validate-boundaries", `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
);

server.registerTool(
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
  async ({ domain: domainFilter }) =>
    rwlock.read(async () => {
      try {
        const { domains } = getDomainData();
        let targetDomains = domains;
        if (domainFilter) {
          targetDomains = domains.filter(d => d.name === domainFilter);
          if (targetDomains.length === 0) {
            return notFound("domain-health", `Domain '${domainFilter}' not found`);
          }
        }
        const results = targetDomains.map(d => ({ name: d.name, ...computeHealth(d) }));
        const text = formatHealthReport(results);
        return { content: [{ type: "text", text: appendStaleWarning(text) }] };
      } catch (e) {
        return notFound("domain-health", `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
);

server.registerTool(
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
  async ({ format, domain, includeObserved }) =>
    rwlock.read(async () => {
      try {
        const config = loadDomainConfig();
        const { domains } = getDomainData();
        const text = generateContextMap(domains, config, { format, domain, includeObserved });
        return { content: [{ type: "text", text: appendStaleWarning(text) }] };
      } catch (e) {
        return notFound("context-map", `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
);

// ── File Watcher ─────────────────────────────────────────────────────────────

function setupWatcher(): void {
  const configPath = path.join(PROJECT_ROOT, "domain-config.json");
  if (!fs.existsSync(configPath)) return;

  fs.watch(configPath, () => {
    if (suppressWatcherDepth > 0) return;
    const normalized = toForwardSlash("domain-config.json");
    if (expectedChanges.consume(normalized)) return;
    txId++;
    domainDirty = true;
    domainConfigCache = null;
    domainDataCache = null;
    emitLog("warning", `External change detected: domain-config.json (txId → ${txId})`);
  });

  // Periodically purge expired entries from expectedChanges
  setInterval(() => expectedChanges.purgeExpired(), 30_000).unref();
}

// ── Start ─────────────────────────────────────────────────────────────────────

export async function startServer(projectDir?: string): Promise<void> {
  if (projectDir) {
    PROJECT_ROOT = projectDir;
    EXTRACTED_DIR = path.join(PROJECT_ROOT, "extracted");
  }

  const domainIndexPath = path.join(EXTRACTED_DIR, "domain-index");
  if (!fs.existsSync(domainIndexPath)) {
    console.error(`[c3-domain-manager] domain-index not found — auto-generating...`);
    try {
      const log: Logger = (...args) => console.error(`[c3-domain-manager]   ${args.map(String).join(" ")}`);
      const configPath = path.join(PROJECT_ROOT, "domain-config.json");
      generateDomainIndex(PROJECT_ROOT, EXTRACTED_DIR, configPath, log);
      console.error(`[c3-domain-manager] Auto-generation complete`);
    } catch (e) {
      console.error(`[c3-domain-manager] Warning: auto-generation failed — ${e instanceof Error ? e.message : String(e)}`);
      console.error(`[c3-domain-manager] Run 'npx c3-domain-manager generate' manually to generate domain index`);
    }
  }
  console.error(`[c3-domain-manager] Starting server in ${PROJECT_ROOT}`);

  // Graceful shutdown
  function shutdown() {
    console.error("[c3-domain-manager] Shutting down...");
    server.close().catch(() => {});
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  setupWatcher();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
