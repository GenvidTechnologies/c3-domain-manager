import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  resolveRootFolder,
  resolveRootFolders,
  ExpectedChanges,
  isValidProjectId,
  isMcpError,
  type ResolvedRoot,
  type ResolvedRoots,
} from "@genvidtech/mcp-utils";
import { PROJECT_MANIFEST_FILE } from "@genvidtech/c3source";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ProjectContext, type EmitFn } from "./projectContext.js";
import { ProjectRegistry } from "./projectRegistry.js";

export const NO_EXTRACTED = "none";

export interface LocationOptions {
  config?: string;
  extracted?: string;
  projectDir?: string;
}

export interface ResolvedLocations {
  projectRoot: string;
  configPath: string;
  configDir: string;
  configFileName: string;
  extractedDir: string;
  extractedEphemeral: boolean;
  configWatchKey: string;
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

export function resolveLocations(
  opts: LocationOptions,
  projectRoot: string,
  mkTempDir: () => string = () => fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-extracted-")),
): ResolvedLocations {
  const configPath = opts.config
    ? path.resolve(projectRoot, opts.config)
    : path.join(projectRoot, "domain-config.json");

  let extractedDir: string;
  let extractedEphemeral: boolean;

  if (opts.extracted === NO_EXTRACTED) {
    extractedDir = mkTempDir();
    extractedEphemeral = true;
  } else if (opts.extracted) {
    extractedDir = path.resolve(projectRoot, opts.extracted);
    extractedEphemeral = false;
  } else {
    extractedDir = path.join(projectRoot, "extracted");
    extractedEphemeral = false;
  }

  const configWatchKey = toForwardSlash(path.resolve(configPath));

  return {
    projectRoot,
    configPath,
    configDir: path.dirname(configPath),
    configFileName: path.basename(configPath),
    extractedDir,
    extractedEphemeral,
    configWatchKey,
  };
}

export function resolveProjectRoot(
  opts: { projectDir?: string },
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRoot | CallToolResult {
  return resolveRootFolder(
    { explicit: opts.projectDir, envVar: "C3_PROJECT_DIR", marker: PROJECT_MANIFEST_FILE, cwd },
    env,
  );
}

/**
 * Plural sibling of `resolveProjectRoot` — a thin wrapper over mcp-utils'
 * `resolveRootFolders`, passing `PROJECT_MANIFEST_FILE` as the discovery
 * marker exactly as the singular does (issue #77's `server`-only multi-root
 * discovery). Unlike the singular, ambiguous discovery (two or more sibling
 * directories each containing the marker) is a **success** carrying every
 * candidate, not an `mcpError` — see `resolveRootFolders`' own docs for the
 * full precedence chain and never-throws contract.
 *
 * `resolveRootFolders` does not itself sort `paths` — matches are collected
 * in `readdirSync` entry order, which is not a portable guarantee. This
 * wrapper sorts them before returning, so registry order (and therefore
 * `deriveUniqueProjectIds`'s collision-resolution order, downstream in
 * `buildRegistry`) is deterministic regardless of filesystem/platform entry
 * order. A no-op for `explicit`/`env`/`cwd`, which always resolve to exactly
 * one path; only `source: "discovery"` can carry more than one.
 */
export function resolveProjectRoots(
  opts: { projectDir?: string },
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRoots | CallToolResult {
  const result = resolveRootFolders(
    { explicit: opts.projectDir, envVar: "C3_PROJECT_DIR", marker: PROJECT_MANIFEST_FILE, cwd },
    env,
  );
  if (isMcpError(result)) return result;
  return { ...result, paths: [...result.paths].sort() };
}

/**
 * Derives a stable project id from a root path: its final path segment,
 * lowercased, with runs of whitespace collapsed to a single hyphen.
 *
 * `../game-a` -> `game-a`; `Game A` -> `game-a`. Mirrors the derivation rule
 * in `GenvidTechnologies/construct3-chef#95` (issue #77's sibling) so an
 * agent driving both MCP servers over the same roots sees the same ids from
 * each.
 *
 * Deliberately does NOT itself reject a colon or any other character in the
 * result — that validation is `isValidProjectId`, requested upstream in
 * `GenvidTechnologies/mcp-utils#19` and shipped in 0.9.0. It is applied to
 * every derived (and explicit) id at `buildRegistry` construction time
 * below, alongside the composite txId codec (issue #77, ADR 0028), not here:
 * this function's contract is a pure string transform, not a validator.
 */
export function deriveProjectId(root: string): string {
  return path.basename(root).trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Applies `deriveProjectId` across N roots and resolves basename collisions
 * by appending `-2`, `-3`, ... in encounter order — the first root with a
 * given basename keeps the bare id (order-stable). Each renamed entry also
 * emits a warning to stderr naming the collision, so an id shift is never
 * silent.
 *
 * Used only for specs lacking an explicit id override (see `buildRegistry`
 * below): an explicit id is taken verbatim and is never renamed by this
 * function — two specs that explicitly collide on the same id are a
 * `buildRegistry`-level rejection, not something this function papers over.
 */
export function deriveUniqueProjectIds(roots: string[]): string[] {
  const seenCounts = new Map<string, number>();
  return roots.map((root) => {
    const base = deriveProjectId(root);
    const occurrence = (seenCounts.get(base) ?? 0) + 1;
    seenCounts.set(base, occurrence);
    if (occurrence === 1) return base;
    const id = `${base}-${occurrence}`;
    console.error(
      `[c3-domain-manager] Warning: project id '${base}' derived from more than one root (latest: '${root}') — using '${id}' instead`,
    );
    return id;
  });
}

/**
 * One project entry as parsed from the CLI's repeatable `--project` flag
 * (the `alpha=../x` override form) or from a single-project invocation's
 * `--project-dir`. `id` is the explicit-override half of that syntax;
 * parsing `alpha=../x` into `{ root: "../x", id: "alpha" }` is a later task,
 * not this module's concern — `buildRegistry` takes the pair as
 * already-separated data. `config`/`extracted` mirror `LocationOptions` so a
 * per-project override (e.g. `--config` shared across two roots) can be
 * expressed the same way a single-project invocation already does.
 */
export interface ProjectSpec {
  root: string;
  id?: string;
  config?: string;
  extracted?: string;
}

export interface BuildRegistryOptions {
  /** Server-wide log sink, forwarded to every constructed `ProjectContext`. */
  emit: EmitFn;
  /**
   * The shared `ExpectedChanges` instance to distribute to every constructed
   * `ProjectContext`. Optional so a standalone caller (e.g. a test) can omit
   * it and get a private instance; `src/mcp/server.ts` always supplies its
   * own module-level instance here, since that is also what its shared
   * `purgeExpired` interval runs against — the two must be the same object
   * for the interval to purge the registry it actually built.
   */
  expected?: ExpectedChanges;
  /** Forwarded to `resolveLocations`'s `mkTempDir` injection point (tests only). */
  mkTempDir?: () => string;
}

/**
 * Builds the server-wide project registry: derives or accepts each spec's
 * id, constructs one `ProjectContext` per spec — all sharing a single
 * `ExpectedChanges` (see `ProjectContextOptions.expected`'s class-level note
 * for why a shared instance, not one per project, is what makes the
 * duplicate-`configPath` guard below meaningful) — and returns a populated
 * `ProjectRegistry`.
 *
 * Performs exactly three validations here (issue #77 acceptance row S4):
 *   - every id (derived or explicit) is checked against `isValidProjectId`
 *     and rejected if invalid — in practice this means it contains a colon
 *     (which would collide with the composite txId token's `<projectId>:<n>`
 *     separator), whitespace, or is empty; see `deriveProjectId`'s note.
 *   - duplicate ids (after derivation) are rejected.
 *   - duplicate `configPath`s are rejected, naming both projects' ids. This
 *     is the case that actually arises in practice: two `--project` entries
 *     at the same directory (both resolving to the same default
 *     `<root>/domain-config.json`), or two distinct roots forced onto one
 *     file via a shared absolute `--config` override. Either way, two
 *     `ProjectContext`s watching and writing the same file would cross-
 *     consume each other's `ExpectedChanges` suppression entries.
 */
export function buildRegistry(specs: ProjectSpec[], opts: BuildRegistryOptions): ProjectRegistry<ProjectContext> {
  const absRoots = specs.map((spec) => path.resolve(spec.root));

  // Derive ids only for specs lacking an explicit override; an explicit id
  // is used verbatim (see the class-level note on ProjectSpec/deriveUniqueProjectIds).
  const needsDerivation: number[] = [];
  specs.forEach((spec, i) => {
    if (spec.id === undefined) needsDerivation.push(i);
  });
  const derivedIds = deriveUniqueProjectIds(needsDerivation.map((i) => absRoots[i]));

  const ids = specs.map((spec) => spec.id ?? "");
  needsDerivation.forEach((specIndex, k) => {
    ids[specIndex] = derivedIds[k];
  });

  for (const id of ids) {
    if (!isValidProjectId(id)) {
      throw new Error(
        `invalid project id '${id}': must be non-empty, with no ':' and no whitespace ` +
          `(':' collides with the composite txId token's '<projectId>:<n>' separator)`,
      );
    }
  }

  const idOwner = new Map<string, number>(); // id -> owning spec index
  ids.forEach((id, i) => {
    const prior = idOwner.get(id);
    if (prior !== undefined) {
      throw new Error(`duplicate project id '${id}': both '${specs[prior].root}' and '${specs[i].root}' resolve to it`);
    }
    idOwner.set(id, i);
  });

  const expected = opts.expected ?? new ExpectedChanges();
  const configPathOwner = new Map<string, string>(); // configPath -> owning id
  const entries: Array<[string, ProjectContext]> = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const id = ids[i];
    const loc = resolveLocations({ config: spec.config, extracted: spec.extracted }, absRoots[i], opts.mkTempDir);

    const priorId = configPathOwner.get(loc.configPath);
    if (priorId !== undefined) {
      throw new Error(`duplicate configPath '${loc.configPath}': shared by projects '${priorId}' and '${id}'`);
    }
    configPathOwner.set(loc.configPath, id);

    entries.push([id, new ProjectContext({ id, loc, emit: opts.emit, expected })]);
  }

  return new ProjectRegistry<ProjectContext>(entries);
}
