import path from "node:path";
import {
  isEditorLocalPath,
  C3_TS_DEFS_FOLDER,
  SCRIPT_SOURCE_EXTENSIONS,
} from "@genvidtech/c3source";
import type { C3Project } from "@genvidtech/c3source";
import type { Logger } from "@genvidtech/mcp-utils";
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
 * yield files (ADR 0020; before that they walked `find_all_files_path`
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
 * Walk one of the four non-script sections via `SECTION_COLLECTORS`,
 * relativize each result to `rootDir`, and drop anything `isSectionSourceName`
 * rejects.
 *
 * The relativize idiom is `path.relative(rootDir, p).replace(/\\/g, "/")` —
 * the `g` flag is load-bearing on Windows: without it only the first
 * backslash converts, and the failure is silent (wrong domain assignments,
 * no exception). See issue #37.
 *
 * No `fs.existsSync` guard: c3source's `findInSection` (the shared helper
 * behind every `C3Project.findAll*` method) already returns `[]` for an
 * absent section directory, so an absent `eventSheets/`/`layouts/`/
 * `objectTypes/`/`families/` yields an empty result here rather than
 * throwing.
 *
 * Every dropped file is logged by relative path — the mitigation for the
 * accepted cost of `isSectionSourceName` silently discarding a genuinely
 * misfiled asset.
 */
export function collectSectionFiles(
  project: C3Project,
  fileType: SectionFileType,
  rootDir: string,
  log: Logger = () => {},
): string[] {
  const absolutePaths = SECTION_COLLECTORS[fileType](project);
  const kept: string[] = [];

  for (const absolutePath of absolutePaths) {
    const relPath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
    if (isSectionSourceName(path.basename(relPath))) {
      kept.push(relPath);
    } else {
      log(`  Dropped non-section-source file: ${relPath}`);
    }
  }

  return kept;
}
