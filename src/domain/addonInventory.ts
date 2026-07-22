import { openProject, getUsedAddons } from "@genvidtech/c3source";
import type { AddonAttribution, C3UsedAddon } from "@genvidtech/c3source";
import type { Logger } from "@genvidtech/mcp-utils";

export interface AddonInventoryReport {
  /** Addon attribution derived from every object type and family (project.collectAddonAttribution()). */
  attributions: AddonAttribution[];
  /** The manifest's declared usedAddons list (getUsedAddons(project.manifest())). */
  declared: C3UsedAddon[];
  /** Deduped union of every attribution's pluginId + behaviorIds + effectIds, sorted. */
  usedIds: string[];
  /** Declared addons whose id is never drawn on by any object type or family — a dead dependency. Sorted by id. */
  declaredButUnused: C3UsedAddon[];
  /** Used ids absent from the manifest's declared addons — manifest drift. Sorted. */
  usedButUndeclared: string[];
}

/**
 * Compute an addon-inventory report: cross-reference the manifest's declared
 * `usedAddons` against the addons actually drawn on by object types and families.
 *
 * Graceful-empty for attribution: if neither `objectTypes/` nor `families/` exists,
 * `attributions` is `[]` (collectAddonAttribution's own finders already return `[]`
 * for absent directories) and `log` is called with a note before proceeding.
 *
 * NOT graceful for the manifest: unlike editorValidation.ts, this function calls
 * `project.manifest()`, which reads and parses `project.c3proj`. That call
 * **throws** if `project.c3proj` is missing or malformed — this is a deliberate
 * divergence from the fully-graceful editor-strictness diagnostic, since an addon
 * inventory is meaningless without a manifest to cross-reference against.
 */
export function computeAddonInventory(rootDir: string, log: Logger = () => {}): AddonInventoryReport {
  const project = openProject(rootDir);

  if (!project.hasObjectTypes() && !project.hasFamilies()) {
    log(
      `addonInventory: neither objectTypes/ (${project.objectTypesDir}) nor families/ (${project.familiesDir}) found, attribution will be empty.`,
    );
  }

  const attributions = project.collectAddonAttribution();
  const declared = getUsedAddons(project.manifest());

  const usedIdSet = new Set<string>();
  for (const attribution of attributions) {
    usedIdSet.add(attribution.pluginId);
    for (const behaviorId of attribution.behaviorIds) {
      usedIdSet.add(behaviorId);
    }
    for (const effectId of attribution.effectIds) {
      usedIdSet.add(effectId);
    }
  }
  const usedIds = [...usedIdSet].sort();

  const declaredIds = new Set(declared.map((addon) => addon.id));

  const declaredButUnused = declared
    .filter((addon) => !usedIdSet.has(addon.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const usedButUndeclared = usedIds.filter((id) => !declaredIds.has(id));

  return { attributions, declared, usedIds, declaredButUnused, usedButUndeclared };
}

export function formatAddonInventoryReport(report: AddonInventoryReport): string {
  if (report.declaredButUnused.length === 0 && report.usedButUndeclared.length === 0) {
    return "No addon-inventory issues found.";
  }

  const lines: string[] = [
    `${report.declaredButUnused.length} declared-but-unused, ${report.usedButUndeclared.length} used-but-undeclared addon(s) found:`,
    "",
  ];

  if (report.declaredButUnused.length > 0) {
    lines.push("Declared but unused:");
    for (const addon of report.declaredButUnused) {
      lines.push(`  [${addon.type}] ${addon.id} (${addon.name})`);
    }
    lines.push("");
  }

  if (report.usedButUndeclared.length > 0) {
    lines.push("Used but undeclared:");
    for (const id of report.usedButUndeclared) {
      lines.push(`  ${id}`);
    }
    lines.push("");
  }

  lines.push("Attributions:");
  if (report.attributions.length === 0) {
    lines.push("  (none)");
  } else {
    for (const attribution of report.attributions) {
      const drawnOn = [attribution.pluginId, ...attribution.behaviorIds, ...attribution.effectIds];
      lines.push(`  ${attribution.name} [${attribution.source}]: ${drawnOn.join(", ")}`);
    }
  }

  return lines.join("\n").replace(/\n+$/, "");
}
