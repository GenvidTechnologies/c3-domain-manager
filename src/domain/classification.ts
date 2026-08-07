import type { DomainConfig, DomainDefinition } from "./types.js";

/** File type root directory and dir-array key, keyed by file type. */
export const FILE_TYPES = {
  eventSheet: { root: "eventSheets/", dirKey: "eventSheetDirs" },
  layout: { root: "layouts/", dirKey: "layoutDirs" },
  script: { root: "scripts/", dirKey: "scriptDirs" },
  objectType: { root: "objectTypes/", dirKey: "objectTypeDirs" },
  family: { root: "families/", dirKey: "familyDirs" },
} as const satisfies Record<string, { root: string; dirKey: keyof DomainDefinition }>;

/** Valid path-prefix roots, derived from FILE_TYPES (insertion order preserved). */
export const VALID_PREFIXES = Object.values(FILE_TYPES).map((t) => t.root);

/**
 * Classify a file into a domain by checking overrides first, then directory arrays.
 * Checks both domains and sharedSubdomains.
 * Returns the domain name or null if unclassified.
 */
export function classifyFile(
  relativePath: string,
  fileType: "eventSheet" | "layout" | "script" | "objectType" | "family",
  config: DomainConfig,
): string | null {
  // 1. Check overrides (exact match, highest priority)
  if (config.overrides && relativePath in config.overrides) {
    return config.overrides[relativePath];
  }

  // 2. Strip the file type root prefix to get the inner path
  const root = FILE_TYPES[fileType].root;
  if (!relativePath.startsWith(root)) {
    return null;
  }
  const innerPath = relativePath.slice(root.length); // e.g. "Login/LoginEvents.json"

  // 3. Check domain directory arrays — longest prefix wins
  const dirKey = FILE_TYPES[fileType].dirKey;
  let bestMatch: string | null = null;
  let bestLength = -1;

  // Check regular domains
  for (const [domainName, domainDef] of Object.entries(config.domains)) {
    const dirs = domainDef[dirKey] as string[] | undefined;
    if (!dirs) continue;

    for (const dir of dirs) {
      // dir is relative to the file type root, e.g. "Login" or "Main Menu/Shop"
      // Match innerPath that starts with dir + "/" (file inside dir)
      // or exactly equals dir (directory entry without trailing slash)
      const prefix = dir + "/";
      if ((innerPath.startsWith(prefix) || innerPath === dir) && dir.length > bestLength) {
        bestMatch = domainName;
        bestLength = dir.length;
      }
    }
  }

  // Check shared subdomains
  if (config.sharedSubdomains) {
    for (const [subdomainName, subdomainDef] of Object.entries(config.sharedSubdomains)) {
      const dirs = subdomainDef[dirKey] as string[] | undefined;
      if (!dirs) continue;

      for (const dir of dirs) {
        const prefix = dir + "/";
        if ((innerPath.startsWith(prefix) || innerPath === dir) && dir.length > bestLength) {
          bestMatch = subdomainName;
          bestLength = dir.length;
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Script source extensions. Construct 3 supports both; which one C3 *loads* is a
 * function of the editor release (r39700 projects declare the compiled .js in
 * project.c3proj, r47604+ declare the .ts). This tool maps *authored source*, so
 * it admits both and disambiguates a .ts/.js pair with isCompiledSibling. ADR 0016.
 *
 * PLATFORM FACT, TEMPORARILY LOCAL: c3source owns C3 platform facts, but 1.9.0
 * exports no script-extension constant (findAllScripts hardcodes .ts and excludes
 * .d.ts). Re-check on the next c3source bump; upstream issue filed.
 */
export const SCRIPT_SOURCE_EXTENSIONS = [".ts", ".js"] as const;

/** Clause 2 — extension admission. Takes a bare basename, the form
 *  find_all_files_path's predicate receives (no directory context available there). */
export function isScriptSourceName(name: string): boolean {
  return SCRIPT_SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Clause 1 — compiled-sibling suppression. True when `name` is a .js whose
 * same-basename .ts sibling exists in the same directory: it is tsc output of a
 * file we already report (or is indistinguishable from it — see ADR 0016's
 * compromise on hand-edited output).
 *
 * Pure by construction: takes the sibling basenames rather than touching the
 * filesystem, so both walk sites feed it a listing they already have and the
 * rule is unit-testable with no temp dir.
 *
 * `siblingNames` MUST be scoped to ONE directory. A set spanning directories
 * would let scripts/shared/a.ts suppress scripts/common/a.js.
 *
 * Note `.d.ts` is deliberately NOT a suppressor: Player.d.ts is a declaration,
 * not the authored source of Player.js, so Player.js stays reported.
 */
export function isCompiledSibling(name: string, siblingNames: ReadonlySet<string>): boolean {
  return name.endsWith(".js") && siblingNames.has(name.slice(0, -".js".length) + ".ts");
}
