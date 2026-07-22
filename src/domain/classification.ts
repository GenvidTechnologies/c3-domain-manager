import type { DomainConfig, DomainDefinition } from "./types.js";

/** File type root directory and dir-array key, keyed by file type. */
export const FILE_TYPES = {
  eventSheet: { root: "eventSheets/", dirKey: "eventSheetDirs" },
  layout: { root: "layouts/", dirKey: "layoutDirs" },
  script: { root: "scripts/", dirKey: "scriptDirs" },
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
  fileType: "eventSheet" | "layout" | "script",
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
