import type { DomainConfig, DomainData } from "./types.js";

/** Distinct domains this domain couples TO, via includes OR event-variable references. */
function outgoingCoupledDomains(domain: DomainData): string[] {
  return [...new Set([...domain.includesFrom.keys(), ...domain.referencesFrom.keys()])];
}

export interface BoundaryViolation {
  type: "undeclared" | "stale" | "forbidden";
  message: string;
  from?: string;
  to?: string;
}

export interface BoundaryReport {
  violations: BoundaryViolation[];
}

export function validateBoundaries(domains: DomainData[], config: DomainConfig, filterDomain?: string): BoundaryReport {
  const violations: BoundaryViolation[] = [];
  const relationships = config.relationships ?? [];
  const domainNames = new Set(domains.map((d) => d.name));
  const domainByName = new Map(domains.map((d) => [d.name, d]));

  // Check 1: Observed undeclared — for each domain, check that all cross-domain
  // includes or event-variable references have a relationship declared (in either direction).
  for (const domain of domains) {
    for (const targetDomain of outgoingCoupledDomains(domain)) {
      const covered = relationships.some(
        (r) => (r.from === targetDomain && r.to === domain.name) || (r.from === domain.name && r.to === targetDomain),
      );
      if (!covered) {
        const violation: BoundaryViolation = {
          type: "undeclared",
          message: `'${domain.name}' depends on '${targetDomain}' but no relationship is declared between them`,
          from: domain.name,
          to: targetDomain,
        };
        violations.push(violation);
      }
    }
  }

  // Check 2: Stale declared — relationships referencing non-existent domains.
  for (const rel of relationships) {
    const fromExists = domainNames.has(rel.from);
    const toExists = domainNames.has(rel.to);
    if (!fromExists || !toExists) {
      const unknowns = [!fromExists ? rel.from : null, !toExists ? rel.to : null].filter(Boolean).join(", ");
      violations.push({
        type: "stale",
        message: `Relationship (${rel.from} → ${rel.to}) references unknown domain(s): ${unknowns}`,
        from: rel.from,
        to: rel.to,
      });
    }
  }

  // Check 3: Forbidden — supporting/generic domains that depend on core domains.
  for (const domain of domains) {
    if (domain.strategy !== "supporting" && domain.strategy !== "generic") continue;
    for (const targetDomain of outgoingCoupledDomains(domain)) {
      const target = domainByName.get(targetDomain);
      if (target?.strategy === "core") {
        violations.push({
          type: "forbidden",
          message: `'${domain.strategy}' domain '${domain.name}' depends on core domain '${targetDomain}' — this indicates a boundary leak`,
          from: domain.name,
          to: targetDomain,
        });
      }
    }
  }

  // Apply filterDomain if provided.
  if (filterDomain !== undefined) {
    return {
      violations: violations.filter((v) => v.from === filterDomain || v.to === filterDomain),
    };
  }

  return { violations };
}

export function formatBoundaryReport(report: BoundaryReport): string {
  if (report.violations.length === 0) {
    return "No boundary violations found.";
  }

  const lines: string[] = [`${report.violations.length} boundary violation(s) found:`, ""];

  for (const v of report.violations) {
    lines.push(`[${v.type}] ${v.message}`);
  }

  return lines.join("\n");
}
