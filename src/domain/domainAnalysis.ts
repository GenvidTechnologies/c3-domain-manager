import * as fs from "node:fs";
import * as path from "node:path";
import { openProject, find_all_files_path, isEditorLocalPath } from "@genvidtech/c3source";
import { classifyFile, VALID_PREFIXES } from "./classification.js";
import { findScriptEntries } from "./domainGenerator.js";
import type { DomainConfig } from "./types.js";

/**
 * Recursively collect absolute paths of C3 *source* files under a directory.
 * Skips C3-editor-local artifacts (*.uistate.json, uistate/ dirs, tsconfig.json)
 * via c3source's isEditorLocalPath — the single owner of that C3 platform fact.
 * Returns an empty array if the directory doesn't exist (find_all_files_path
 * throws ENOENT rather than tolerating an absent dir).
 */
function walkSource(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return find_all_files_path(dir, (name) => !isEditorLocalPath(name));
}

/**
 * classifyFile/overrides require section-rooted forward-slash paths; the
 * walker returns absolute native-separator ones. The /g flag matters on
 * Windows.
 */
const relativize = (baseDir: string) => (p: string) =>
  path.relative(baseDir, p).replace(/\\/g, "/");

/**
 * Recursively collect C3 *source* files under a directory, returning paths
 * relative to baseDir (forward-slash — the form classifyFile/overrides require).
 */
function collectSourceFiles(dir: string, baseDir: string): string[] {
  return walkSource(dir).map(relativize(baseDir));
}

/**
 * Scan eventSheets/, layouts/, scripts/, objectTypes/ and families/ and return the
 * paths classifyFile() returns null for (sorted).
 *
 * The four non-script sections are walked here per file. scripts/ is not: it delegates
 * to findScriptEntries, the same enumeration computeDomainData builds DomainData from,
 * so this command reports exactly what the generated index would leave unclassified
 * (ADR 0017). That means a scripts/ result may be a *directory* path with a trailing
 * slash, where the whole directory is attributed as a unit.
 */
export function listUncategorized(rootDir: string, config: DomainConfig): string[] {
  const uncategorized: string[] = [];
  const project = openProject(rootDir);

  // EventSheets
  const eventSheetFiles = collectSourceFiles(project.eventSheetsDir, rootDir);
  for (const file of eventSheetFiles) {
    if (classifyFile(file, "eventSheet", config) === null) {
      uncategorized.push(file);
    }
  }

  // Layouts
  const layoutFiles = collectSourceFiles(project.layoutsDir, rootDir);
  for (const file of layoutFiles) {
    if (classifyFile(file, "layout", config) === null) {
      uncategorized.push(file);
    }
  }

  // Scripts: delegate to findScriptEntries — the same enumeration domainGenerator
  // uses to build DomainData — so both readers agree on what scripts/ contains.
  for (const entry of findScriptEntries(project.scriptsDir, config)) {
    if (classifyFile(entry.relativePath, "script", config) === null) {
      uncategorized.push(entry.relativePath);
    }
  }

  // Object types
  const objectTypeFiles = collectSourceFiles(project.objectTypesDir, rootDir);
  for (const file of objectTypeFiles) {
    if (classifyFile(file, "objectType", config) === null) {
      uncategorized.push(file);
    }
  }

  // Families
  const familyFiles = collectSourceFiles(project.familiesDir, rootDir);
  for (const file of familyFiles) {
    if (classifyFile(file, "family", config) === null) {
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

/**
 * Validate override keys have a recognized path prefix.
 * Returns error strings for invalid keys. Empty array = all valid.
 */
export function validateOverrideKeys(keys: string[]): string[] {
  const errors: string[] = [];
  for (const key of keys) {
    if (!VALID_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      errors.push(`Invalid path prefix: '${key}' — must start with ${VALID_PREFIXES.join(", ")}`);
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
