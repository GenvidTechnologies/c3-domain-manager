import * as fs from "node:fs";
import path from "node:path";
import {
  find_all_eventsheets_path,
  find_all_layouts_path,
  extractFunctions,
  extractIncludes,
  visitEvents,
  hasConditions,
  hasActions,
  getEventVarReferenceName,
} from "@genvid/c3source";
import type { EventSheet, EventSheetEvent, Layout, FunctionParameter } from "@genvid/c3source";
import { classifyFile } from "./classification.js";
import { formatDomainIndex as formatDomainIndexPage, formatDomainPage } from "./formatting.js";
import type { DomainConfig, DomainData, FunctionDef } from "./types.js";
import { DomainConfigSchema } from "./types.js";
import { loadProjectConfig, isMcpError } from "@genvid/mcp-utils";
import type { Logger } from "@genvid/mcp-utils";

/** Format function parameters as "name: type, name2: type2". */
function formatParams(params: FunctionParameter[]): string {
  return params.map((p) => `${p.name}: ${p.type}`).join(", ");
}

/**
 * Map c3source's typed `ExtractedFunction` list for a sheet onto our `FunctionDef`
 * shape: format params to a string, stamp the source sheet, and surface the
 * custom-ACE `objectClass`/`aceName` that `formatting.ts` renders.
 */
export function extractFunctionDefs(sheet: EventSheet, sheetName: string): FunctionDef[] {
  return extractFunctions(sheet).map((f) => ({
    name: f.name,
    params: formatParams(f.params),
    returnType: f.returnType,
    sourceSheet: sheetName,
    objectClass: f.objectClass,
    aceName: f.kind === "custom-ace" ? f.name : undefined,
  }));
}

/**
 * Top-level (sheet-root ≈ global-scope) event-variable declaration names for a sheet.
 * Only root-level `variable` events are indexed — cross-sheet references in C3 require
 * global variables, so root-level declarations are the global-scope approximation.
 */
export function extractEventVarDecls(sheet: EventSheet): string[] {
  return sheet.events
    .filter((e): e is Extract<EventSheetEvent, { eventType: "variable" }> => e.eventType === "variable")
    .map((e) => e.name);
}

/**
 * Deduped event-variable names referenced by System ACEs anywhere in a sheet's event tree.
 * Walks every condition and action via `visitEvents`, applying c3source's
 * `getEventVarReferenceName` (which gates on `objectClass === "System"`).
 */
export function extractEventVarRefs(sheet: EventSheet): string[] {
  const names = new Set<string>();
  visitEvents(sheet.events, (event) => {
    if (hasConditions(event)) {
      for (const cond of event.conditions) {
        const name = getEventVarReferenceName(cond);
        if (name !== null) names.add(name);
      }
    }
    if (hasActions(event)) {
      for (const action of event.actions) {
        const name = getEventVarReferenceName(action);
        if (name !== null) names.add(name);
      }
    }
  });
  return [...names];
}

export async function loadConfig(projectRoot: string, fileName: string): Promise<DomainConfig> {
  const cfg = await loadProjectConfig(projectRoot, fileName, DomainConfigSchema);
  if (isMcpError(cfg)) {
    const text =
      cfg.content?.map((c) => ("text" in c ? c.text : "")).join("\n") ?? "config load failed";
    throw new Error(text);
  }
  return cfg;
}

/** Directories that are structural layers, not domain-relevant. Recurse into them. */
const LAYER_DIRS = ["shared", "c3-runtime"];

export function findScriptEntries(rootDir: string): Array<{ relativePath: string; isDirectory: boolean }> {
  const scriptsDir = path.join(rootDir, "scripts");
  const entries: Array<{ relativePath: string; isDirectory: boolean }> = [];

  function scanDir(dir: string, prefix: string) {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const fullPath = path.join(dir, name);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        if (LAYER_DIRS.includes(name)) {
          // Recurse into layer dirs — enumerate their children instead
          scanDir(fullPath, `${prefix}${name}/`);
        } else {
          entries.push({ relativePath: `scripts/${prefix}${name}/`, isDirectory: true });
        }
      } else if (stats.isFile() && name.endsWith(".ts")) {
        entries.push({ relativePath: `scripts/${prefix}${name}`, isDirectory: false });
      }
    }
  }

  scanDir(scriptsDir, "");
  return entries;
}

export interface ComputeDomainDataResult {
  domains: DomainData[];
  unclassified: string[];
}

export function computeDomainData(
  rootDir: string,
  config: DomainConfig,
  log: Logger = () => {},
): ComputeDomainDataResult {
  // Find all files
  const eventSheetPaths = find_all_eventsheets_path(path.join(rootDir, "eventSheets"));
  const layoutPaths = find_all_layouts_path(path.join(rootDir, "layouts"));
  const scriptEntries = findScriptEntries(rootDir);

  log(
    `Found ${eventSheetPaths.length} eventSheets, ${layoutPaths.length} layouts, ${scriptEntries.length} script entries.`,
  );

  // Classify all files
  const domainDataMap = new Map<string, DomainData>();
  const unclassified: string[] = [];

  // Initialize domain data for all configured domains
  for (const [name, def] of Object.entries(config.domains)) {
    domainDataMap.set(name, {
      name,
      description: def.description,
      eventSheets: [],
      layouts: [],
      scripts: [],
      functions: [],
      includesFrom: new Map(),
      includedBy: new Map(),
      referencesFrom: new Map(),
      referencedBy: new Map(),
      strategy: def.strategy,
    });
  }

  // Initialize domain data for shared subdomains
  if (config.sharedSubdomains) {
    for (const [name, def] of Object.entries(config.sharedSubdomains)) {
      domainDataMap.set(name, {
        name,
        description: def.description,
        eventSheets: [],
        layouts: [],
        scripts: [],
        functions: [],
        includesFrom: new Map(),
        includedBy: new Map(),
        referencesFrom: new Map(),
        referencedBy: new Map(),
        isSharedSubdomain: true,
        strategy: def.strategy,
      });
    }
  }

  // Classify and parse eventSheets
  const sheetDomainLookup = new Map<string, string>(); // sheetName → domainName
  const rawIncludes = new Map<string, string[]>(); // domainName → raw include sheet names
  const varDeclIndex = new Map<string, Set<string>>(); // variable name → set of declaring domains
  const rawRefs = new Map<string, string[]>(); // domainName → referenced variable names (raw)

  for (const sheetPath of eventSheetPaths) {
    const relPath = path.relative(rootDir, sheetPath).replace(/\\/g, "/");

    const domain = classifyFile(relPath, "eventSheet", config);

    if (!domain) {
      unclassified.push(relPath);
      log(`  Unclassified: ${relPath}`);
      continue;
    }

    const domainData = domainDataMap.get(domain)!;

    // Determine directory within eventSheets/
    const innerPath = relPath.replace(/^eventSheets\//, "");
    const dirParts = innerPath.split("/");
    const directory = dirParts.length > 1 ? dirParts.slice(0, -1).join("/") : "";

    domainData.eventSheets.push({ path: relPath, directory });

    // Parse eventSheet for includes and functions
    const content = fs.readFileSync(sheetPath, "utf-8");
    const sheet: EventSheet = JSON.parse(content);
    const sheetName = innerPath.replace(/\.json$/, "");

    sheetDomainLookup.set(sheet.name, domain);

    // Extract functions
    const funcs = extractFunctionDefs(sheet, sheetName);
    domainData.functions.push(...funcs);

    // Extract includes (will be resolved to cross-domain deps later)
    const includes = extractIncludes(sheet).map((r) => r.includeSheet);
    if (includes.length > 0) {
      const existing = rawIncludes.get(domain) ?? [];
      existing.push(...includes);
      rawIncludes.set(domain, existing);
    }

    // Index top-level variable declarations: variable name → declaring domains
    for (const varName of extractEventVarDecls(sheet)) {
      if (!varDeclIndex.has(varName)) varDeclIndex.set(varName, new Set());
      varDeclIndex.get(varName)!.add(domain);
    }

    // Accumulate event-variable references for cross-domain resolution later
    const refs = extractEventVarRefs(sheet);
    if (refs.length > 0) {
      const existing = rawRefs.get(domain) ?? [];
      existing.push(...refs);
      rawRefs.set(domain, existing);
    }
  }

  // Classify layouts
  for (const layoutPath of layoutPaths) {
    const relPath = path.relative(rootDir, layoutPath).replace(/\\/g, "/");
    const domain = classifyFile(relPath, "layout", config);

    if (!domain) {
      unclassified.push(relPath);
      log(`  Unclassified: ${relPath}`);
      continue;
    }

    const domainData = domainDataMap.get(domain)!;

    // Read layout to get eventSheet reference
    const content = fs.readFileSync(layoutPath, "utf-8");
    const layout: Layout = JSON.parse(content);
    const eventSheet = (layout as Record<string, unknown>).eventSheet as string || "";
    const eventSheetDomain = eventSheet ? (sheetDomainLookup.get(eventSheet) ?? "") : "";

    domainData.layouts.push({ path: relPath, eventSheet, eventSheetDomain });
  }

  // Classify scripts
  for (const entry of scriptEntries) {
    const lookupPath = entry.isDirectory
      ? entry.relativePath.replace(/\/$/, "")
      : entry.relativePath;
    const domain = classifyFile(lookupPath, "script", config);
    if (domain) {
      domainDataMap.get(domain)!.scripts.push({ path: entry.relativePath, isDirectory: entry.isDirectory });
    } else {
      unclassified.push(entry.relativePath);
      log(`  Unclassified: ${entry.relativePath}`);
    }
  }

  // Resolve cross-domain dependencies from includes
  for (const [domainName, domainData] of domainDataMap) {
    const raw = rawIncludes.get(domainName) ?? [];

    for (const includedSheetName of raw) {
      const targetDomain = sheetDomainLookup.get(includedSheetName);
      if (targetDomain && targetDomain !== domainName) {
        // Add to includesFrom
        if (!domainData.includesFrom.has(targetDomain)) {
          domainData.includesFrom.set(targetDomain, []);
        }
        const list = domainData.includesFrom.get(targetDomain)!;
        if (!list.includes(includedSheetName)) {
          list.push(includedSheetName);
        }

        // Add to target's includedBy
        const targetData = domainDataMap.get(targetDomain);
        if (targetData) {
          if (!targetData.includedBy.has(domainName)) {
            targetData.includedBy.set(domainName, []);
          }
          const targetList = targetData.includedBy.get(domainName)!;
          if (!targetList.includes(includedSheetName)) {
            targetList.push(includedSheetName);
          }
        }
      }
    }
  }

  // Resolve cross-domain dependencies from event-variable references.
  // A reference resolves to EVERY domain that declares a top-level variable of that
  // name (attribute-to-all on collision); same-domain and unresolved names are skipped.
  for (const [domainName, domainData] of domainDataMap) {
    const refs = rawRefs.get(domainName) ?? [];
    for (const varName of refs) {
      const declaringDomains = varDeclIndex.get(varName);
      if (!declaringDomains) continue; // unresolved — no global declaration
      for (const targetDomain of declaringDomains) {
        if (targetDomain === domainName) continue; // same-domain — not cross-domain
        // referencesFrom: domainName → targetDomain (var names)
        if (!domainData.referencesFrom.has(targetDomain)) domainData.referencesFrom.set(targetDomain, []);
        const out = domainData.referencesFrom.get(targetDomain)!;
        if (!out.includes(varName)) out.push(varName);
        // referencedBy on the target
        const targetData = domainDataMap.get(targetDomain);
        if (targetData) {
          if (!targetData.referencedBy.has(domainName)) targetData.referencedBy.set(domainName, []);
          const inc = targetData.referencedBy.get(domainName)!;
          if (!inc.includes(varName)) inc.push(varName);
        }
      }
    }
  }

  // Sort domains by name for consistent output
  const domains = Array.from(domainDataMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return { domains, unclassified };
}

export async function generateDomainIndex(
  rootDir: string,
  outDir: string,
  projectRoot: string,
  fileName: string,
  log: Logger = console.log,
): Promise<void> {
  const config = await loadConfig(projectRoot, fileName);
  const domainIndexDir = path.join(outDir, "domain-index");

  const { domains, unclassified } = computeDomainData(rootDir, config, log);

  // Clean domain-index/ directory
  fs.rmSync(domainIndexDir, { recursive: true, force: true });
  fs.mkdirSync(domainIndexDir, { recursive: true });

  // Generate master index
  const indexContent = formatDomainIndexPage(domains, unclassified);
  fs.writeFileSync(path.join(domainIndexDir, "index.md"), indexContent);

  // Generate per-domain pages
  for (const domain of domains) {
    const pageContent = formatDomainPage(domain);
    // Sanitize domain name for filename (e.g., "Watch/Story" → "Watch-Story")
    const safeFileName = domain.name.replace(/\//g, "-");
    fs.writeFileSync(path.join(domainIndexDir, `${safeFileName}.md`), pageContent);
  }

  log(`Generated domain index with ${domains.length} domains in ${domainIndexDir}`);
  if (unclassified.length > 0) {
    log(`  ${unclassified.length} unclassified files!`);
  } else {
    log("  All files classified.");
  }
}
