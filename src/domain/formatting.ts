import type { DomainConfig, DomainData, FunctionDef } from "./types.js";

// --- Formatting ---

/**
 * Format the domain index page (master overview of all domains).
 */
export function formatDomainIndex(domains: DomainData[], unclassified: string[]): string {
  const lines: string[] = [];

  // Count totals
  const totalEventSheets = domains.reduce((sum, d) => sum + d.eventSheets.length, 0);
  const totalLayouts = domains.reduce((sum, d) => sum + d.layouts.length, 0);
  const totalScripts = domains.reduce((sum, d) => sum + d.scripts.length, 0);

  lines.push("# C3 Domain Index");
  lines.push("");
  lines.push(`Files: ${totalEventSheets} eventSheets, ${totalLayouts} layouts, ${totalScripts} scripts`);
  lines.push("");

  // Separate regular domains from shared subdomains
  const regularDomains = domains.filter((d) => !d.isSharedSubdomain);
  const sharedSubdomains = domains.filter((d) => d.isSharedSubdomain);

  // Domains table
  lines.push("## Domains");
  lines.push("");

  const strategyGroups = [
    { label: "Core Domains", domains: regularDomains.filter((d) => d.strategy === "core") },
    { label: "Supporting Domains", domains: regularDomains.filter((d) => d.strategy === "supporting") },
    { label: "Generic Domains", domains: regularDomains.filter((d) => d.strategy === "generic") },
    { label: "Unclassified Domains", domains: regularDomains.filter((d) => !d.strategy) },
  ];

  const allUnclassified = regularDomains.every((d) => !d.strategy);

  if (allUnclassified) {
    // Backward compat: single flat table
    lines.push("| Domain | Description | EventSheets | Layouts | Scripts | Dependencies |");
    lines.push("| --- | --- | --- | --- | --- | --- |");

    for (const domain of regularDomains) {
      const scriptsStr = formatScriptsCount(domain.scripts);
      const deps = formatDependencies(domain.includesFrom);
      const safeFileName = domain.name.replace(/\//g, "-");
      lines.push(
        `| [${domain.name}](${safeFileName}.md) | ${domain.description} | ${domain.eventSheets.length} | ${domain.layouts.length} | ${scriptsStr} | ${deps} |`,
      );
    }

    lines.push("");
  } else {
    // Grouped by strategy
    for (const group of strategyGroups) {
      if (group.domains.length === 0) continue;

      const sorted = [...group.domains].sort((a, b) => a.name.localeCompare(b.name));
      lines.push(`### ${group.label}`);
      lines.push("");
      lines.push("| Domain | Description | EventSheets | Layouts | Scripts | Dependencies |");
      lines.push("| --- | --- | --- | --- | --- | --- |");

      for (const domain of sorted) {
        const scriptsStr = formatScriptsCount(domain.scripts);
        const deps = formatDependencies(domain.includesFrom);
        const safeFileName = domain.name.replace(/\//g, "-");
        lines.push(
          `| [${domain.name}](${safeFileName}.md) | ${domain.description} | ${domain.eventSheets.length} | ${domain.layouts.length} | ${scriptsStr} | ${deps} |`,
        );
      }

      lines.push("");
    }
  }

  // Shared Subdomains table
  if (sharedSubdomains.length > 0) {
    lines.push("## Shared Subdomains");
    lines.push("");
    lines.push("| Subdomain | Description | EventSheets | Layouts | Scripts |");
    lines.push("| --- | --- | --- | --- | --- |");

    for (const subdomain of sharedSubdomains) {
      const scriptsStr = formatScriptsCount(subdomain.scripts);
      const safeFileName = subdomain.name.replace(/\//g, "-");
      lines.push(
        `| [${subdomain.name}](${safeFileName}.md) | ${subdomain.description} | ${subdomain.eventSheets.length} | ${subdomain.layouts.length} | ${scriptsStr} |`,
      );
    }

    lines.push("");
  }

  // Cross-domain hubs
  lines.push("## Cross-Domain Hubs");
  lines.push("");
  const hubs = findCrossDomainHubs(domains);
  if (hubs.length === 0) {
    lines.push("No cross-domain hubs detected.");
  } else {
    for (const hub of hubs) {
      lines.push(`- **${hub.sheetName}** (${hub.domainName}): includes ${hub.totalSheets} sheets from ${hub.domainNames.join(", ")}`);
    }
  }
  lines.push("");

  // Unclassified files
  if (unclassified.length === 0) {
    lines.push("## Unclassified Files");
    lines.push("");
    lines.push("All files classified.");
  } else {
    lines.push(`## Unclassified Files (${unclassified.length})`);
    lines.push("");
    for (const file of unclassified) {
      lines.push(`- ${file}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatScriptsCount(scripts: Array<{ path: string; isDirectory: boolean }>): string {
  const dirs = scripts.filter((s) => s.isDirectory).length;
  const files = scripts.filter((s) => !s.isDirectory).length;
  const parts: string[] = [];
  if (dirs > 0) parts.push(`${dirs} ${dirs === 1 ? "dir" : "dirs"}`);
  if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
  return parts.length > 0 ? parts.join(", ") : "0";
}

function formatDependencies(includesFrom: Map<string, string[]>): string {
  if (includesFrom.size === 0) return "";
  const domainNames = Array.from(includesFrom.keys()).sort();
  return "\u2192 " + domainNames.join(", ");
}

interface CrossDomainHub {
  sheetName: string;
  domainName: string;
  totalSheets: number;
  domainNames: string[];
}

function findCrossDomainHubs(domains: DomainData[]): CrossDomainHub[] {
  const hubs: CrossDomainHub[] = [];

  for (const domain of domains) {
    if (domain.includesFrom.size < 3) continue;

    // Count total included sheets across all domains
    let totalSheets = 0;
    const domainNames: string[] = [];
    for (const [domainName, sheets] of domain.includesFrom) {
      totalSheets += sheets.length;
      domainNames.push(domainName);
    }

    if (totalSheets >= 5 && domainNames.length >= 3) {
      // Find the eventSheet that's likely the hub (use first eventSheet as representative)
      const sheetName = domain.eventSheets.length > 0
        ? extractFileName(domain.eventSheets[0].path)
        : domain.name;
      hubs.push({
        sheetName,
        domainName: domain.name,
        totalSheets,
        domainNames: domainNames.sort(),
      });
    }
  }

  return hubs.sort((a, b) => a.domainName.localeCompare(b.domainName));
}

function extractFileName(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  return fileName.replace(/\.json$/, "");
}

/**
 * Format a single domain's detail page.
 */
export function formatDomainPage(domain: DomainData): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${domain.name}`);
  lines.push("");
  lines.push(domain.description);
  lines.push("");

  if (domain.strategy) {
    lines.push(`**Strategy:** ${domain.strategy}`);
    lines.push("");
  }

  // EventSheets section
  formatEventSheetsSection(domain, lines);

  // Functions section
  formatFunctionsSection(domain, lines);

  // Layouts section
  formatLayoutsSection(domain, lines);

  // Scripts section
  formatScriptsSection(domain, lines);

  // Cross-Domain Dependencies
  formatCrossDomainSection(domain, lines);

  return lines.join("\n");
}

function formatEventSheetsSection(domain: DomainData, lines: string[]): void {
  lines.push(`## EventSheets (${domain.eventSheets.length})`);
  lines.push("");

  if (domain.eventSheets.length === 0) return;

  // Group by directory
  const groups = new Map<string, string[]>();
  for (const sheet of domain.eventSheets) {
    const dir = sheet.directory || "";
    const existing = groups.get(dir) ?? [];
    const fileName = sheet.path.split("/").pop() ?? sheet.path;
    existing.push(fileName);
    groups.set(dir, existing);
  }

  // Sort groups: alphabetical, with "" (Root) last
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });

  for (const dir of sortedKeys) {
    const files = groups.get(dir)!.sort();
    const label = dir === "" ? "Root" : `${dir}/`;
    lines.push(`### ${label} (${files.length})`);
    for (const file of files) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }
}

function formatFunctionsSection(domain: DomainData, lines: string[]): void {
  lines.push(`## Functions (${domain.functions.length})`);
  lines.push("");

  if (domain.functions.length === 0) return;

  // Group by sourceSheet
  const groups = new Map<string, FunctionDef[]>();
  for (const func of domain.functions) {
    const existing = groups.get(func.sourceSheet) ?? [];
    existing.push(func);
    groups.set(func.sourceSheet, existing);
  }

  const sortedKeys = Array.from(groups.keys()).sort();
  for (const sheet of sortedKeys) {
    const funcs = groups.get(sheet)!.sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`### ${sheet}`);
    for (const func of funcs) {
      if (func.objectClass) {
        lines.push(`- ${func.objectClass}.${func.aceName}(${func.params}) \u2192 ${func.returnType}`);
      } else {
        lines.push(`- ${func.name}(${func.params}) \u2192 ${func.returnType}`);
      }
    }
    lines.push("");
  }
}

function formatLayoutsSection(domain: DomainData, lines: string[]): void {
  lines.push(`## Layouts (${domain.layouts.length})`);
  lines.push("");

  if (domain.layouts.length === 0) return;

  const sortedLayouts = [...domain.layouts].sort((a, b) => a.path.localeCompare(b.path));
  for (const layout of sortedLayouts) {
    let line = `- ${layout.path} \u2192 ${layout.eventSheet}`;
    if (layout.eventSheetDomain !== domain.name) {
      line += ` (cross-domain: ${layout.eventSheetDomain})`;
    }
    lines.push(line);
  }
  lines.push("");
}

function formatScriptsSection(domain: DomainData, lines: string[]): void {
  lines.push("## Scripts");
  lines.push("");

  if (domain.scripts.length === 0) return;

  const dirs = domain.scripts.filter((s) => s.isDirectory).sort((a, b) => a.path.localeCompare(b.path));
  const files = domain.scripts.filter((s) => !s.isDirectory).sort((a, b) => a.path.localeCompare(b.path));

  if (dirs.length > 0) {
    lines.push("### Directories");
    for (const dir of dirs) {
      lines.push(`- ${dir.path}`);
    }
    lines.push("");
  }

  if (files.length > 0) {
    lines.push("### Files");
    for (const file of files) {
      lines.push(`- ${file.path}`);
    }
    lines.push("");
  }
}

// --- DomainConfig Formatting ---

export type DomainConfigSection = "domains" | "sharedSubdomains" | "overrides" | "all";

/**
 * Format a DomainConfig into human-readable text.
 * When section is "all", all three sections are concatenated with blank line separators.
 */
export function formatDomainConfig(config: DomainConfig, section: DomainConfigSection = "all"): string {
  if (section === "domains") return formatDomainsSection(config);
  if (section === "sharedSubdomains") return formatSharedSubdomainsSection(config);
  if (section === "overrides") return formatOverridesSection(config);

  // "all"
  const parts = [
    formatDomainsSection(config),
    formatSharedSubdomainsSection(config),
    formatOverridesSection(config),
  ];
  return parts.join("\n");
}

function formatDomainsSection(config: DomainConfig): string {
  const lines: string[] = [];
  const entries = Object.entries(config.domains).sort(([a], [b]) => a.localeCompare(b));

  lines.push(`## Domains (${entries.length})`);

  for (const [name, def] of entries) {
    lines.push("");
    lines.push(name);
    lines.push(`  Description: ${def.description}`);
    if (def.strategy) {
      lines.push(`  Strategy: ${def.strategy}`);
    }
    if (def.eventSheetDirs && def.eventSheetDirs.length > 0) {
      lines.push(`  eventSheetDirs: ${def.eventSheetDirs.join(", ")}`);
    }
    if (def.layoutDirs && def.layoutDirs.length > 0) {
      lines.push(`  layoutDirs: ${def.layoutDirs.join(", ")}`);
    }
    if (def.scriptDirs && def.scriptDirs.length > 0) {
      lines.push(`  scriptDirs: ${def.scriptDirs.join(", ")}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatSharedSubdomainsSection(config: DomainConfig): string {
  const lines: string[] = [];
  const entries = Object.entries(config.sharedSubdomains ?? {}).sort(([a], [b]) => a.localeCompare(b));

  lines.push(`## Shared Subdomains (${entries.length})`);

  for (const [name, def] of entries) {
    lines.push("");
    lines.push(name);
    lines.push(`  Description: ${def.description}`);
    if (def.eventSheetDirs && def.eventSheetDirs.length > 0) {
      lines.push(`  eventSheetDirs: ${def.eventSheetDirs.join(", ")}`);
    }
    if (def.layoutDirs && def.layoutDirs.length > 0) {
      lines.push(`  layoutDirs: ${def.layoutDirs.join(", ")}`);
    }
    if (def.scriptDirs && def.scriptDirs.length > 0) {
      lines.push(`  scriptDirs: ${def.scriptDirs.join(", ")}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatOverridesSection(config: DomainConfig): string {
  const lines: string[] = [];
  const entries = Object.entries(config.overrides ?? {}).sort(([a], [b]) => a.localeCompare(b));

  lines.push(`## Overrides (${entries.length})`);
  lines.push("");

  for (const [filePath, domain] of entries) {
    lines.push(`${filePath} -> ${domain}`);
  }

  lines.push("");
  return lines.join("\n");
}

function formatCrossDomainSection(domain: DomainData, lines: string[]): void {
  lines.push("## Cross-Domain Dependencies");
  lines.push("");

  // Includes from this domain (outgoing)
  lines.push("### Includes from this domain");
  if (domain.includesFrom.size === 0) {
    lines.push("None.");
  } else {
    const sortedDomains = Array.from(domain.includesFrom.keys()).sort();
    for (const targetDomain of sortedDomains) {
      const sheets = [...domain.includesFrom.get(targetDomain)!].sort();
      const count = sheets.length;
      let sheetList: string;
      if (sheets.length > 5) {
        sheetList = sheets.slice(0, 5).join(", ") + ", ...";
      } else {
        sheetList = sheets.join(", ");
      }
      lines.push(`- \u2192 ${targetDomain} (${count} ${count === 1 ? "sheet" : "sheets"}): ${sheetList}`);
    }
  }
  lines.push("");

  // Includes into this domain (incoming)
  lines.push("### Includes into this domain");
  if (domain.includedBy.size === 0) {
    lines.push("None.");
  } else {
    const sortedDomains = Array.from(domain.includedBy.keys()).sort();
    for (const sourceDomain of sortedDomains) {
      const sheets = [...domain.includedBy.get(sourceDomain)!].sort();
      let sheetList: string;
      if (sheets.length > 5) {
        sheetList = sheets.slice(0, 5).join(", ") + ", ...";
      } else {
        sheetList = sheets.join(", ");
      }
      lines.push(`- \u2190 ${sourceDomain}: ${sheetList}`);
    }
  }
  lines.push("");

  // Event-variable references from this domain (outgoing) \u2014 only when present
  if (domain.referencesFrom.size > 0) {
    lines.push("### Event-variable references from this domain");
    const sortedDomains = Array.from(domain.referencesFrom.keys()).sort();
    for (const targetDomain of sortedDomains) {
      const vars = [...domain.referencesFrom.get(targetDomain)!].sort();
      const count = vars.length;
      const varList = vars.length > 5 ? vars.slice(0, 5).join(", ") + ", ..." : vars.join(", ");
      lines.push(`- \u2192 ${targetDomain} (${count} ${count === 1 ? "variable" : "variables"}): ${varList}`);
    }
    lines.push("");
  }

  // Event-variable references into this domain (incoming) \u2014 only when present
  if (domain.referencedBy.size > 0) {
    lines.push("### Event-variable references into this domain");
    const sortedDomains = Array.from(domain.referencedBy.keys()).sort();
    for (const sourceDomain of sortedDomains) {
      const vars = [...domain.referencedBy.get(sourceDomain)!].sort();
      const varList = vars.length > 5 ? vars.slice(0, 5).join(", ") + ", ..." : vars.join(", ");
      lines.push(`- \u2190 ${sourceDomain}: ${varList}`);
    }
    lines.push("");
  }
}
