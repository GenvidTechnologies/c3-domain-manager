import path from "node:path";
import { NO_EXTRACTED, type ProjectSpec } from "./adapters/locations.js";

/**
 * Parses one `--project <value>` occurrence for the `server` subcommand.
 * Accepts the `<id>=<path>` explicit-override form or a bare path. A bare
 * path (no `=`, or a value that starts with `=`) yields `{ root: value }`
 * with `id` left undefined, so `buildRegistry`'s existing
 * derive-from-basename fallback (`deriveUniqueProjectIds`) assigns the id —
 * the same fallback the single-root `--project-dir`-only invocation already
 * relies on, so a bare `--project ../game-a` and `--project-dir ../game-a`
 * derive identically.
 */
export function parseProjectFlagValue(value: string): { id?: string; root: string } {
  const eq = value.indexOf("=");
  if (eq <= 0) return { root: value };
  return { id: value.slice(0, eq), root: value.slice(eq + 1) };
}

/**
 * Rejects an absolute `--config`/`--extracted` value once more than one
 * project is registered — two projects sharing one absolute path is
 * `buildRegistry`'s duplicate-configPath rejection (issue #77 acceptance row
 * S4), surfaced here as a clear, early CLI error naming the offending flag
 * rather than a registry-construction one. This does not replace
 * `buildRegistry`'s own check, which stays the real guarantee.
 *
 * A no-op at `projectCount <= 1` (today's single-root behaviour, absolute
 * values included — the N=1 carve-out) and for the `--extracted none`
 * ephemeral-dir sentinel, which is not a path at all.
 */
export function assertRelativeOverride(
  flag: "config" | "extracted",
  value: string | undefined,
  projectCount: number,
): void {
  if (projectCount <= 1) return;
  if (value === undefined) return;
  if (flag === "extracted" && value === NO_EXTRACTED) return;
  if (path.isAbsolute(value)) {
    const target = flag === "config" ? "domain-config.json" : "extracted output directory";
    throw new Error(
      `--${flag} must be a relative path when more than one --project is registered (got absolute path '${value}'). ` +
        `An absolute --${flag} would force all ${projectCount} projects to share one ${target}. ` +
        `Use a relative path — it resolves against each project's own root — or omit --${flag} to use each project's default.`,
    );
  }
}

/**
 * Builds the `server` subcommand's project specs from the repeatable
 * `--project` flag plus the shared `--config`/`--extracted` overrides.
 *
 * When one or more `--project` values are given, they define the registry
 * entirely: each is parsed via `parseProjectFlagValue` and `resolveSingleRoot`
 * is never called, so the ADR 0007 `--project-dir`/`C3_PROJECT_DIR`/
 * `project.c3proj`-discovery chain — which can exit the process on failure —
 * is not invoked when the caller has already named explicit roots.
 * Otherwise a single spec is built around `resolveSingleRoot()`'s result
 * (that chain), unchanged from before this flag existed.
 *
 * `config`/`extracted` are attached to every spec verbatim; `buildRegistry`
 * -> `resolveLocations` rebases a relative value against each spec's own
 * root, so passing the same relative string to N specs already produces N
 * per-project paths with no extra plumbing here. An absolute value is
 * rejected by `assertRelativeOverride` once `projectValues.length > 1`.
 */
export function buildServerProjectSpecs(opts: {
  projectValues: string[];
  resolveSingleRoot: () => string;
  config?: string;
  extracted?: string;
}): ProjectSpec[] {
  const { projectValues, resolveSingleRoot, config, extracted } = opts;
  if (projectValues.length === 0) {
    return [{ root: resolveSingleRoot(), config, extracted }];
  }
  assertRelativeOverride("config", config, projectValues.length);
  assertRelativeOverride("extracted", extracted, projectValues.length);
  return projectValues.map((value) => ({ ...parseProjectFlagValue(value), config, extracted }));
}
