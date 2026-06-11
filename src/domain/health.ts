import type { DomainData } from "./types.js";

export interface HealthMetrics {
  ca: number; // afferent coupling — distinct domains coupled to this one via includes OR event-variable references
  ce: number; // efferent coupling — distinct domains this domain depends on via includes OR event-variable references
  instability: number; // Ce / (Ca + Ce), 0 when Ca + Ce = 0
  coverage: number; // 1 if domain has any files, 0 otherwise
}

/** Compute health metrics for a single domain. */
export function computeHealth(domain: DomainData): HealthMetrics {
  const ce = new Set([...domain.includesFrom.keys(), ...domain.referencesFrom.keys()]).size;
  const ca = new Set([...domain.includedBy.keys(), ...domain.referencedBy.keys()]).size;
  const instability = ca + ce === 0 ? 0 : ce / (ca + ce);
  const coverage =
    domain.eventSheets.length + domain.layouts.length + domain.scripts.length > 0 ? 1 : 0;
  return { ca, ce, instability, coverage };
}

/** Format health report as a text table. */
export function formatHealthReport(results: Array<{ name: string } & HealthMetrics>): string {
  if (results.length === 0) return "No domains to report on.";

  const lines: string[] = [];
  lines.push("| Domain | Ca | Ce | Instability | Coverage |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`| ${r.name} | ${r.ca} | ${r.ce} | ${r.instability.toFixed(2)} | ${r.coverage} |`);
  }

  return lines.join("\n");
}
