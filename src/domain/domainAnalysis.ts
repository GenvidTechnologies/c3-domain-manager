import * as fs from "node:fs";
import * as path from "node:path";
import { openProject } from "@genvidtech/c3source";
import { classifyFile } from "./classification.js";
import type { DomainConfig } from "./types.js";

/**
 * Recursively collect all files under a directory, returning paths relative to baseDir.
 * Returns an empty array if the directory doesn't exist.
 */
function collectFiles(dir: string, baseDir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, baseDir));
    } else {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return results;
}

/**
 * Collect root-level .ts files in a directory (non-recursive).
 * Returns paths relative to baseDir.
 */
function collectRootTsFiles(dir: string, baseDir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.relative(baseDir, path.join(dir, e.name)).replace(/\\/g, "/"));
}

/**
 * Scan eventSheets/, layouts/, and scripts/ directories and return files
 * that classifyFile() returns null for (sorted).
 */
export function listUncategorized(rootDir: string, config: DomainConfig): string[] {
  const uncategorized: string[] = [];
  const project = openProject(rootDir);

  // EventSheets
  const eventSheetFiles = collectFiles(project.eventSheetsDir, rootDir);
  for (const file of eventSheetFiles) {
    if (classifyFile(file, "eventSheet", config) === null) {
      uncategorized.push(file);
    }
  }

  // Layouts
  const layoutFiles = collectFiles(project.layoutsDir, rootDir);
  for (const file of layoutFiles) {
    if (classifyFile(file, "layout", config) === null) {
      uncategorized.push(file);
    }
  }

  // Scripts: walk shared/, c3-runtime/, common/, ts-defs/ + root-level .ts files
  const scriptSubdirs = ["shared", "c3-runtime", "common", "ts-defs"];
  for (const subdir of scriptSubdirs) {
    const files = collectFiles(path.join(project.scriptsDir, subdir), rootDir);
    for (const file of files) {
      if (classifyFile(file, "script", config) === null) {
        uncategorized.push(file);
      }
    }
  }

  // Root-level .ts files in scripts/
  const rootTsFiles = collectRootTsFiles(project.scriptsDir, rootDir);
  for (const file of rootTsFiles) {
    if (classifyFile(file, "script", config) === null) {
      uncategorized.push(file);
    }
  }

  return uncategorized.sort();
}

/**
 * Check each key in config.overrides — return keys that point to non-existent files (sorted).
 */
export function listStaleOverrides(rootDir: string, config: DomainConfig): string[] {
  if (!config.overrides) return [];

  const stale: string[] = [];
  for (const key of Object.keys(config.overrides)) {
    const fullPath = path.join(rootDir, key);
    if (!fs.existsSync(fullPath)) {
      stale.push(key);
    }
  }

  return stale.sort();
}

/**
 * Collect all valid domain and subdomain names from the config.
 */
export function collectValidDomainNames(config: DomainConfig): Set<string> {
  const names = new Set<string>();
  for (const key of Object.keys(config.domains)) {
    names.add(key);
  }
  for (const key of Object.keys(config.sharedSubdomains ?? {})) {
    names.add(key);
  }
  return names;
}

const VALID_PREFIXES = ["eventSheets/", "layouts/", "scripts/"];

/**
 * Validate override keys have a recognized path prefix.
 * Returns error strings for invalid keys. Empty array = all valid.
 */
export function validateOverrideKeys(keys: string[]): string[] {
  const errors: string[] = [];
  for (const key of keys) {
    if (!VALID_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      errors.push(
        `Invalid path prefix: '${key}' — must start with eventSheets/, layouts/, or scripts/`,
      );
    }
  }
  return errors;
}

/**
 * Validate override values are known domain/subdomain names.
 * Returns error strings for invalid values. Empty array = all valid.
 */
export function validateOverrideValues(
  entries: Record<string, string>,
  validNames: Set<string>,
): string[] {
  const errors: string[] = [];
  const sortedNames = Array.from(validNames).sort();
  const suggestion =
    sortedNames.length <= 5
      ? sortedNames.join(", ")
      : sortedNames.slice(0, 5).join(", ") + ", ...";

  for (const [filePath, domainName] of Object.entries(entries)) {
    if (!validNames.has(domainName)) {
      errors.push(
        `Unknown domain '${domainName}' for path '${filePath}' — valid names: ${suggestion}`,
      );
    }
  }
  return errors;
}
