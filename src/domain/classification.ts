import path from "node:path";
import {
  isEditorLocalPath,
  C3_TS_DEFS_FOLDER,
  SCRIPT_SOURCE_EXTENSIONS,
} from "@genvidtech/c3source";
import type { C3Project } from "@genvidtech/c3source";
import type { DomainConfig, DomainDefinition } from "./types.js";

/**
 * File type root directory, dir-array key, and directory-emission capability,
 * keyed by file type.
 *
 * `emitsDirectories` answers: can this section's walk ever produce a
 * *directory* entry (as opposed to only files)? Only `scripts/` can —
 * `findScriptEntries` collapses an unclaimed, non-layer directory into a
 * single `"scripts/<name>/"` entry. The other four sections go through
 * `collectSectionFiles`, whose `C3Project.findAll*` collectors only ever
 * yield files (ADR 0020, ADR 0022; before that they walked `find_all_files_path`
 * directly — same conclusion, different route). `listInertOverrides` uses
 * this to decide whether a directory-shaped override key could ever be
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
 * it admits both and disambiguates a .ts/.js pair with isGeneratedScriptOutput
 * (from @genvidtech/c3source, replacing the formerly-local same-purpose
 * predicate this module used to define). ADR 0016.
 *
 * UPSTREAM-SOURCED as of c3source 2.0.0 (issue #48): this used to be a platform
 * fact held locally only because c3source had not exported it yet — that was
 * this repo's own stated retire-trigger (CLAUDE.md), and it has now fired.
 * Re-exported here rather than imported directly at each call site so the
 * published API surface (`src/index.ts` re-exports this module) stays stable.
 */
export { SCRIPT_SOURCE_EXTENSIONS };

/**
 * Clause 2 — extension admission. Takes a bare basename, the form
 * `findScriptEntries` has at the point it decides (no directory context there).
 *
 * DELIBERATELY NOT c3source's same-named `isScriptSourceName` (available since
 * 2.0.0): upstream's excludes `.d.ts`, ours must admit it — dropping `.d.ts`
 * here would silently stop ADR 0013's `ts-defs/` exemption working, since a
 * generated typing file would no longer be indexable via `scriptDirs`. The
 * divergence is pinned by a cross-library test in
 * `test/domain/scriptSurfaces.test.ts` (asserts local(`.d.ts`) === true and
 * upstream(`.d.ts`) === false side by side), so re-adopting upstream's version
 * fails a test instead of silently regressing.
 */
export function isScriptSourceName(name: string): boolean {
  return SCRIPT_SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
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

/**
 * The four non-script section walks, keyed by file type, as the collector
 * FUNCTION itself — not a static field describing the collector, the way
 * `FILE_TYPES.emitsDirectories` describes `scripts/`'s walk.
 *
 * ADR 0019's failure mode was a static table that *claims* a fact about a
 * walk and can be plausibly wrong (three ways, measured, in that issue). A
 * table that IS the walk cannot be plausibly wrong in the same way — a
 * mis-wired entry here fails the cross-section agreement test immediately,
 * rather than silently drifting from what `C3Project` actually does. This
 * also keeps `FILE_TYPES` (public API via `src/index.ts`) from re-encoding
 * c3source's per-section predicates locally, which would go stale on a
 * c3source bump with nothing here to notice.
 *
 * `scripts/` is deliberately absent: its enumeration is `findScriptEntries`
 * (`domainGenerator.ts`, ADR 0017), which must emit directory entries that
 * these collectors cannot produce. `SectionFileType` excludes "script", so
 * asking `collectSectionFiles` for it is a compile-time error, not a runtime
 * gap.
 */
const SECTION_COLLECTORS = {
  eventSheet: (p: C3Project) => p.findAllEventSheets(),
  layout: (p: C3Project) => p.findAllLayouts(),
  objectType: (p: C3Project) => p.findAllObjectTypes(),
  family: (p: C3Project) => p.findAllFamilies(),
} as const;

export type SectionFileType = keyof typeof SECTION_COLLECTORS;

/**
 * Walk one of the four non-script sections via `SECTION_COLLECTORS` and
 * relativize each result to `rootDir`. No filter: as of c3source 2.0.0 every
 * `C3Project.findAll*` collector already admits only `.json` name-section
 * items and excludes editor-local artifacts before this function ever sees
 * the result, so there is nothing left here to reject. ADR 0022.
 *
 * This is now a three-line function, and a reasonable question is whether it
 * should just be inlined at each call site. Three reasons it stays:
 *
 * 1. It is the **single enumeration** for all four sections (ADR 0017,
 *    ADR 0020). Inlining would give each of the eight call sites its own
 *    copy of the walk, re-opening the per-section divergences those ADRs
 *    exist to close.
 * 2. It owns the relativize idiom, `path.relative(rootDir, p).replace(/\\/g, "/")`
 *    — the `g` flag is load-bearing on Windows: without it only the first
 *    backslash converts, and the failure is silent (wrong domain
 *    assignments, no exception). See issue #37. Inlining would duplicate
 *    that idiom, and its easy-to-drop flag, across eight sites instead of
 *    one.
 * 3. It deliberately carries no directory-existence check: c3source's
 *    `findInSection` (the shared helper behind every `C3Project.findAll*`
 *    method) already returns `[]` for an absent section directory, so an
 *    absent `eventSheets/`/`layouts/`/`objectTypes/`/`families/` yields an
 *    empty result here rather than throwing. Adding one back would be
 *    redundant, not defensive — an easy "helpful" regression to reintroduce
 *    if this function is inlined and re-derived from scratch.
 */
export function collectSectionFiles(
  project: C3Project,
  fileType: SectionFileType,
  rootDir: string,
): string[] {
  const absolutePaths = SECTION_COLLECTORS[fileType](project);
  return absolutePaths.map((absolutePath) =>
    path.relative(rootDir, absolutePath).replace(/\\/g, "/"),
  );
}
