import * as fs from "node:fs";
import * as path from "node:path";
import {
  openProject,
  find_all_files_path,
  isEditorLocalPath,
  C3_TS_DEFS_FOLDER,
} from "@genvidtech/c3source";
import {
  classifyFile,
  VALID_PREFIXES,
  isScriptSourceName,
  isCompiledSibling,
} from "./classification.js";
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

/** Clause 1, applied over absolute paths: drop each X.js whose X.ts sibling sits in
 *  the SAME directory. Sets are built per-dirname — a flat set would cross-suppress. */
function suppressCompiledSiblings(absPaths: string[]): string[] {
  const byDir = new Map<string, Set<string>>();
  for (const p of absPaths) {
    const dir = path.dirname(p);
    let names = byDir.get(dir);
    if (!names) byDir.set(dir, (names = new Set()));
    names.add(path.basename(p));
  }
  return absPaths.filter(
    (p) => !isCompiledSibling(path.basename(p), byDir.get(path.dirname(p))!),
  );
}

/** Script-subdirectory variant of collectSourceFiles. Same walk and the SAME
 *  no-extension-filter policy (ADR 0013 #4 — a stray .md under scripts/common/ is
 *  still a legitimate "unmapped file here" finding), plus clause 1. Deliberately
 *  does NOT apply clause 2; see ADR 0016's "divergence D" consequence. */
function collectScriptFiles(dir: string, baseDir: string): string[] {
  return suppressCompiledSiblings(walkSource(dir)).map(relativize(baseDir));
}

/**
 * Collect root-level script files in a directory (non-recursive), returning paths
 * relative to baseDir. `descend: () => false` expresses the non-recursion: the
 * allowlisted script subdirs are walked separately below, and recursing here would
 * both double-report them and pull in non-allowlisted subdirs.
 *
 * Applies BOTH clauses of the authored-script rule (ADR 0016): .ts|.js admission,
 * then compiled-sibling suppression. The sibling test cannot live in the predicate —
 * find_all_files_path hands it a bare basename with no directory context — so it is
 * a post-filter over the absolute paths the walk returns.
 */
function collectRootScriptFiles(dir: string, baseDir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found = find_all_files_path(
    dir,
    (name) => isScriptSourceName(name) && !isEditorLocalPath(name),
    () => false,
  );
  return suppressCompiledSiblings(found).map(relativize(baseDir));
}

/**
 * Scan eventSheets/, layouts/, and scripts/ directories and return files
 * that classifyFile() returns null for (sorted).
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

  // Scripts: walk shared/, c3-runtime/, common/, ts-defs/ + root-level .ts files
  // ts-defs/ is C3-generated but deliberately walked and reported: a project can
  // index its generated .d.ts files into a domain via scriptDirs (see ADR 0013).
  const scriptSubdirs = ["shared", "c3-runtime", "common", C3_TS_DEFS_FOLDER];
  for (const subdir of scriptSubdirs) {
    const files = collectScriptFiles(path.join(project.scriptsDir, subdir), rootDir);
    for (const file of files) {
      if (classifyFile(file, "script", config) === null) {
        uncategorized.push(file);
      }
    }
  }

  // Root-level script files in scripts/
  const rootScriptFiles = collectRootScriptFiles(project.scriptsDir, rootDir);
  for (const file of rootScriptFiles) {
    if (classifyFile(file, "script", config) === null) {
      uncategorized.push(file);
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
