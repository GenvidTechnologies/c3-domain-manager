import { isEditorLocalPath, C3_TS_DEFS_FOLDER } from "@genvidtech/c3source";
import type { DomainConfig, DomainDefinition } from "./types.js";

/**
 * File type root directory, dir-array key, and directory-emission capability,
 * keyed by file type.
 *
 * `emitsDirectories` answers: can this section's walk ever produce a
 * *directory* entry (as opposed to only files)? Only `scripts/` can —
 * `findScriptEntries` collapses an unclaimed, non-layer directory into a
 * single `"scripts/<name>/"` entry. The other four sections walk via
 * `find_all_files_path`, which only ever yields files. `listInertOverrides`
 * uses this to decide whether a directory-shaped override key could ever be
 * produced by the section's walk at all, before asking whether it actually is.
 */
export const FILE_TYPES = {
  eventSheet: { root: "eventSheets/", dirKey: "eventSheetDirs", emitsDirectories: false },
  layout: { root: "layouts/", dirKey: "layoutDirs", emitsDirectories: false },
  script: { root: "scripts/", dirKey: "scriptDirs", emitsDirectories: true },
  objectType: { root: "objectTypes/", dirKey: "objectTypeDirs", emitsDirectories: false },
  family: { root: "families/", dirKey: "familyDirs", emitsDirectories: false },
} as const satisfies Record<
  string,
  { root: string; dirKey: keyof DomainDefinition; emitsDirectories: boolean }
>;

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
  // Tolerate a single trailing slash (directory entries, e.g. "scripts/other/")
  // so callers no longer have to strip it themselves before calling in.
  const normalizedPath = relativePath.endsWith("/") ? relativePath.slice(0, -1) : relativePath;

  // 1. Check overrides (exact match, highest priority)
  if (config.overrides && normalizedPath in config.overrides) {
    return config.overrides[normalizedPath];
  }

  // 2. Strip the file type root prefix to get the inner path
  const root = FILE_TYPES[fileType].root;
  if (!normalizedPath.startsWith(root)) {
    return null;
  }
  const innerPath = normalizedPath.slice(root.length); // e.g. "Login/LoginEvents.json"

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
 * True when some `*Dirs` entry or `overrides` key claims a path strictly BELOW
 * `innerPath` — i.e. emitting a single directory entry for `innerPath` would
 * swallow that claim. Checks domains, sharedSubdomains, and overrides.
 *
 * The `innerPath + "/"` anchoring matters: a bare `startsWith(innerPath)` would
 * wrongly match a sibling directory that merely shares `innerPath` as a string
 * prefix (e.g. "common2/x" against inner path "common") rather than one nested
 * strictly beneath it.
 */
export function hasClaimBelow(
  innerPath: string,
  fileType: "eventSheet" | "layout" | "script" | "objectType" | "family",
  config: DomainConfig,
): boolean {
  const { root, dirKey } = FILE_TYPES[fileType];
  const prefix = innerPath + "/";
  const claims: string[] = [];

  for (const domainDef of Object.values(config.domains)) {
    const dirs = domainDef[dirKey] as string[] | undefined;
    if (dirs) claims.push(...dirs);
  }

  if (config.sharedSubdomains) {
    for (const subdomainDef of Object.values(config.sharedSubdomains)) {
      const dirs = subdomainDef[dirKey] as string[] | undefined;
      if (dirs) claims.push(...dirs);
    }
  }

  if (config.overrides) {
    for (const key of Object.keys(config.overrides)) {
      if (key.startsWith(root)) claims.push(key.slice(root.length));
    }
  }

  return claims.some((claim) => claim.startsWith(prefix));
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
 * Section source extensions — the files the domain index can parse and
 * therefore represent: eventSheets/, layouts/, objectTypes/ and families/ are
 * all authored as .json, and computeDomainData reaches each one through a
 * JSON.parse. A file this rule rejects has no index representation, because
 * there is nothing downstream that could parse it. ADR 0020.
 *
 * ORDERING HAZARD — MUST run on a collector's *output*, never as a standalone
 * walk predicate. `Main.uistate.json` ends in .json and would be re-admitted
 * by this rule alone, re-introducing every editor-local artifact ADR 0013
 * removed. Editor-local exclusion is c3source's (isEditorLocalPath, applied
 * inside the collectors) and must run first. The collision is *actual* here,
 * where for isScriptSourceName above it is merely hypothetical — no editor-local
 * exclusion ends in .ts/.js today. Note that findScriptEntries does not rely on
 * that: it applies isEditorLocalPath unconditionally, because the non-collision
 * "was only ever an accident of c3source's current list, and that list is
 * c3source's to change" (domainGenerator.ts, the FILE branch of findScriptEntries;
 * ADR 0013 #1). The same reasoning applies with more force here, the difference
 * being that this rule has no walk of its own to guard — so the ordering above is
 * the whole of its protection.
 *
 * PLATFORM-ADJACENT, LOCAL BY DECISION: unlike SCRIPT_SOURCE_EXTENSIONS above
 * (a platform fact c3source doesn't export yet), this list is product policy,
 * not a platform fact — it is derived from what computeDomainData parses,
 * not from what C3 permits on disk. c3source deliberately keeps its four
 * section finders' extension policies inconsistent and filters at each parse
 * boundary instead (GenvidTechnologies/c3source#76 is the open question on
 * whether that's intentional; re-check this list when it resolves).
 */
export const SECTION_SOURCE_EXTENSIONS = [".json"] as const;

/** Takes a bare basename, the same contract as isScriptSourceName above. */
export function isSectionSourceName(name: string): boolean {
  return SECTION_SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
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

/**
 * A directory under scripts/ worth reporting as a classifiable entry.
 * Excludes C3-editor-local dirs (uistate/) — never project source, never a domain.
 * ts-defs/ is the deliberate exemption: it IS editor-generated, but this tool keeps
 * it walked and reported so a project can index its generated .d.ts files into a
 * domain via scriptDirs (see docs/decisions/0013-*.md). A naive
 * !isEditorLocalPath(name) would drop it, because EDITOR_LOCAL_EXCLUSIONS.dirs
 * contains "ts-defs".
 *
 * Two consumers: `findScriptEntries` (the scripts/ walk) and `listInertOverrides`
 * (override-key inertness).
 */
export function isReportableScriptDir(name: string): boolean {
  return !isEditorLocalPath(name) || name === C3_TS_DEFS_FOLDER;
}
