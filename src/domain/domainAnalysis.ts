import * as fs from "node:fs";
import * as path from "node:path";
import { openProject, isEditorLocalPath } from "@genvidtech/c3source";
import {
  classifyFile,
  VALID_PREFIXES,
  FILE_TYPES,
  isScriptSourceName,
  isSectionSourceName,
  isCompiledSibling,
  isReportableScriptDir,
  collectSectionFiles,
} from "./classification.js";
import { findScriptEntries } from "./domainGenerator.js";
import type { DomainConfig } from "./types.js";

/**
 * Scan eventSheets/, layouts/, scripts/, objectTypes/ and families/ and return the
 * paths classifyFile() returns null for (sorted).
 *
 * The four non-script sections are all enumerated through the one shared
 * `collectSectionFiles` seam (classification.ts), which admits only section
 * *source* (`.json`) — `list-uncategorized` is the worklist for the domain
 * index, and a file the index can't parse has no index representation to
 * gain by being reported here (ADR 0020). scripts/ is not: it delegates to
 * findScriptEntries, the same enumeration computeDomainData builds
 * DomainData from, so this command reports exactly what the generated index
 * would leave unclassified (ADR 0017). That means a scripts/ result may be a
 * *directory* path with a trailing slash, where the whole directory is
 * attributed as a unit.
 */
export function listUncategorized(rootDir: string, config: DomainConfig): string[] {
  const uncategorized: string[] = [];
  const project = openProject(rootDir);

  // EventSheets
  const eventSheetFiles = collectSectionFiles(project, "eventSheet", rootDir);
  for (const file of eventSheetFiles) {
    if (classifyFile(file, "eventSheet", config) === null) {
      uncategorized.push(file);
    }
  }

  // Layouts
  const layoutFiles = collectSectionFiles(project, "layout", rootDir);
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
  const objectTypeFiles = collectSectionFiles(project, "objectType", rootDir);
  for (const file of objectTypeFiles) {
    if (classifyFile(file, "objectType", config) === null) {
      uncategorized.push(file);
    }
  }

  // Families
  const familyFiles = collectSectionFiles(project, "family", rootDir);
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
 * predicate — five distinct reasons a key can be inert:
 *
 *   1. Editor-local (section-aware): a path segment the section's walk never
 *      descends into or admits (`uistate/`, `*.uistate.json`, `tsconfig.json`,
 *      and — outside `scripts/` only — `ts-defs/`; `scripts/` deliberately
 *      keeps `ts-defs/` walked, ADR 0013).
 *   2. Compiled sibling (`scripts/` only): a `.js` whose same-basename `.ts`
 *      sits beside it — `findScriptEntries` suppresses it (ADR 0016).
 *   3. Non-source extension (all five sections): the basename fails the
 *      section's admission rule — `scripts/` admits authored script source
 *      (`.ts`/`.js`, ADR 0016); the other four admit section source
 *      (`.json`, ADR 0020), the format `computeDomainData` can parse into
 *      the domain index.
 *   4. Trailing slash: `classifyFile` normalizes a walk's directory-entry
 *      path before matching overrides, so a key that itself carries the
 *      slash can never match.
 *   5. Directory-shaped key (no trailing slash): `emitsDirectories` (from
 *      `FILE_TYPES`) says whether the section's walk can ever produce a
 *      directory entry at all — `eventSheets/`, `layouts/`, `objectTypes/`,
 *      and `families/` never can, so any directory-shaped key under them is
 *      inert outright. `scripts/` can, but only for a directory
 *      `findScriptEntries` actually collapses into a single entry — a
 *      structural layer directory (`LAYER_DIRS`) or one the config claims
 *      strictly below (`hasClaimBelow`) is recursed into instead, so a key
 *      naming it is inert too.
 */
export function listInertOverrides(
  rootDir: string,
  config: DomainConfig,
): Array<{ key: string; reason: string }> {
  if (!config.overrides) return [];

  const results: Array<{ key: string; reason: string }> = [];
  const fileTypeKeys = Object.keys(FILE_TYPES) as Array<keyof typeof FILE_TYPES>;
  // Computed lazily, at most once, the first time a directory-shaped key
  // under scripts/ is encountered — findScriptEntries re-walks the whole
  // scripts/ tree, so it's not worth paying for when no such key exists.
  let emittedScriptPaths: Set<string> | undefined;

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

    // Class 5 — directory-shaped key (no trailing slash). emitsDirectories
    // decides whether the section's walk could ever produce a directory
    // entry at all; for scripts/, the walk itself then decides whether THIS
    // directory is one it actually collapses into an entry.
    const isDirectory = fs.statSync(fullPath).isDirectory();
    if (isDirectory) {
      if (!FILE_TYPES[fileType].emitsDirectories) {
        results.push({
          key,
          reason:
            `'${key}' names a directory, but the ${root} walk only ever emits files, never ` +
            `directory entries, so this key can never be produced — classify this directory ` +
            `with a '*Dirs' entry (e.g. '${FILE_TYPES[fileType].dirKey}: ["${innerPath}"]') ` +
            `instead of an exact-path override.`,
        });
      } else {
        if (!emittedScriptPaths) {
          emittedScriptPaths = new Set(
            findScriptEntries(path.join(rootDir, FILE_TYPES.script.root), config).map(
              (entry) => entry.relativePath,
            ),
          );
        }
        if (!emittedScriptPaths.has(`${key}/`)) {
          results.push({
            key,
            reason:
              `'${key}' names a directory, but the scripts/ walk does not emit it as a ` +
              `classifiable directory entry — it either recurses into it (a structural layer ` +
              `directory, or a path the config claims strictly below it) or excludes it, so ` +
              `this key can never be produced.`,
          });
        }
      }
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

    // Class 3 — non-source extension, all five sections. A directory-shaped
    // key already `continue`d above in the class-5 branch, so a key that
    // reaches here is guaranteed to name a file.
    const admits = fileType === "script" ? isScriptSourceName : isSectionSourceName;
    if (!admits(basename)) {
      results.push({
        key,
        reason:
          fileType === "script"
            ? `'${basename}' has no .ts or .js extension; the scripts/ walk only admits ` +
              `authored script source, so this key can never be produced.`
            : `'${basename}' has no .json extension; the ${root} walk only admits section ` +
              `source — the format the domain index can parse — so this key can never be ` +
              `produced.`,
      });
      continue;
    }

    // Class 2 — compiled sibling, scripts/ only, files only.
    if (fileType === "script") {
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
