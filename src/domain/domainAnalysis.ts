import * as fs from "node:fs";
import * as path from "node:path";
import { openProject, find_all_files_path, isEditorLocalPath } from "@genvidtech/c3source";
import {
  classifyFile,
  VALID_PREFIXES,
  FILE_TYPES,
  isScriptSourceName,
  isCompiledSibling,
  isReportableScriptDir,
} from "./classification.js";
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
 * Check each key in config.overrides — return keys that point to files that DO
 * exist on disk, but that no enumeration this tool performs can ever produce
 * (so the override can never take effect). Keys that fail `fs.existsSync` are
 * `listStaleOverrides`' job and are filtered out here first, so a key is
 * never reported by both functions.
 *
 * The check is derivative of each section's walk rules, not one flat
 * predicate — four distinct reasons a key can be inert:
 *
 *   1. Editor-local (section-aware): a path segment the section's walk never
 *      descends into or admits (`uistate/`, `*.uistate.json`, `tsconfig.json`,
 *      and — outside `scripts/` only — `ts-defs/`; `scripts/` deliberately
 *      keeps `ts-defs/` walked, ADR 0013).
 *   2. Compiled sibling (`scripts/` only): a `.js` whose same-basename `.ts`
 *      sits beside it — `findScriptEntries` suppresses it (ADR 0016).
 *   3. Non-source extension (`scripts/` only): the basename isn't `.ts`/`.js`
 *      — the other four sections admit any extension, so this class never
 *      applies to them.
 *   4. Trailing slash: `classifyFile` normalizes a walk's directory-entry
 *      path before matching overrides, so a key that itself carries the
 *      slash can never match.
 */
export function listInertOverrides(
  rootDir: string,
  config: DomainConfig,
): Array<{ key: string; reason: string }> {
  if (!config.overrides) return [];

  const results: Array<{ key: string; reason: string }> = [];
  const fileTypeKeys = Object.keys(FILE_TYPES) as Array<keyof typeof FILE_TYPES>;

  for (const key of Object.keys(config.overrides)) {
    const fullPath = path.join(rootDir, key);
    if (!fs.existsSync(fullPath)) continue; // Missing keys are listStaleOverrides' job.

    // Class 4 — trailing slash. Checked first, before any section-specific
    // logic: a directory-shaped key must not feed its own name into the
    // basename checks below.
    if (key.endsWith("/")) {
      results.push({
        key,
        reason:
          "Key carries a trailing slash; classifyFile strips one trailing slash from a " +
          "walk's directory-entry path before matching overrides, so a key that itself " +
          "ends in '/' can never match — remove the trailing slash.",
      });
      continue;
    }

    // Resolve the section from the key's prefix. An unrecognized prefix is
    // validateOverrideKeys' business, not this function's — skip silently.
    const fileType = fileTypeKeys.find((t) => key.startsWith(FILE_TYPES[t].root));
    if (!fileType) continue;

    const root = FILE_TYPES[fileType].root;
    const innerPath = key.slice(root.length);
    const segments = innerPath.split("/");
    const basename = segments[segments.length - 1];
    const dirSegments = segments.slice(0, -1);

    // Class 1 — editor-local, section-aware. Directory segments: scripts/
    // exempts ts-defs/ (isReportableScriptDir); the other four sections don't
    // (isEditorLocalPath). Basename: isEditorLocalPath in all five sections.
    const inertDirSegment = dirSegments.find((seg) =>
      fileType === "script" ? !isReportableScriptDir(seg) : isEditorLocalPath(seg),
    );
    if (inertDirSegment !== undefined) {
      results.push({
        key,
        reason:
          `Directory segment '${inertDirSegment}' is a C3-editor-local artifact that the ` +
          `${root} walk never descends into, so this key can never be produced.`,
      });
      continue;
    }

    if (isEditorLocalPath(basename)) {
      results.push({
        key,
        reason:
          `'${basename}' is a C3-editor-local artifact (uistate output, or tsconfig.json) ` +
          `that the ${root} walk always excludes, so this key can never be produced.`,
      });
      continue;
    }

    // Classes 2 and 3 — scripts/ only, files only. A key naming a real
    // directory on disk is live (findScriptEntries collapses it to a single
    // directory entry), so these file-only rules must not apply to it.
    if (fileType === "script" && !fs.statSync(fullPath).isDirectory()) {
      if (!isScriptSourceName(basename)) {
        results.push({
          key,
          reason:
            `'${basename}' has no .ts or .js extension; the scripts/ walk only admits ` +
            `authored script source, so this key can never be produced.`,
        });
        continue;
      }

      const siblingNames = new Set(fs.readdirSync(path.dirname(fullPath)));
      if (isCompiledSibling(basename, siblingNames)) {
        results.push({
          key,
          reason:
            `'${basename}' is compiled output of a co-located .ts file with the same ` +
            `basename; the scripts/ walk suppresses the compiled sibling, so this key can ` +
            `never be produced.`,
        });
        continue;
      }
    }
  }

  return results.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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
