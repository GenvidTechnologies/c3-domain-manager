import * as fs from "node:fs";
import path from "node:path";
import { find_all_eventsheets_path, find_all_layouts_path } from "@genvid/c3source";
import type { EventSheet, Layout } from "@genvid/c3source";
import { classifyFile } from "./classification.js";
import { extractIncludes, extractFunctions } from "./extraction.js";
import { formatDomainIndex as formatDomainIndexPage, formatDomainPage } from "./formatting.js";
import type { DomainConfig, DomainData } from "./types.js";
import type { Logger } from "@genvid/mcp-utils";

export function loadConfig(configPath: string): DomainConfig {
  const content = fs.readFileSync(configPath, "utf-8");
  const config: DomainConfig = JSON.parse(content);

  if (!config.domains || typeof config.domains !== "object") {
    throw new Error("domain-config.json must have a 'domains' object");
  }

  return config;
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
        isSharedSubdomain: true,
        strategy: def.strategy,
      });
    }
  }

  // Classify and parse eventSheets
  const sheetDomainLookup = new Map<string, string>(); // sheetName → domainName
  const rawIncludes = new Map<string, string[]>(); // domainName → raw include sheet names

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
    const funcs = extractFunctions(sheet.events, sheetName);
    domainData.functions.push(...funcs);

    // Extract includes (will be resolved to cross-domain deps later)
    const includes = extractIncludes(sheet.events);
    if (includes.length > 0) {
      const existing = rawIncludes.get(domain) ?? [];
      existing.push(...includes);
      rawIncludes.set(domain, existing);
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

  // Sort domains by name for consistent output
  const domains = Array.from(domainDataMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return { domains, unclassified };
}

export function generateDomainIndex(rootDir: string, outDir: string, configPath: string, log: Logger = console.log) {
  const config = loadConfig(configPath);
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
