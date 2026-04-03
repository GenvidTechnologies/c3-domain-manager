import type { DomainConfig } from "./types.js";

export interface GlossaryEntry {
  term: string;
  definition: string;
  domain: string;
}

export interface CollisionReport {
  term: string;
  entries: Array<{ domain: string; definition: string }>;
}

/** Collect all glossary entries from domain config. */
export function collectGlossary(config: DomainConfig): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];

  for (const [name, def] of Object.entries(config.domains)) {
    if (def.glossary) {
      for (const [term, definition] of Object.entries(def.glossary)) {
        entries.push({ term, definition, domain: name });
      }
    }
  }

  if (config.sharedSubdomains) {
    for (const [name, def] of Object.entries(config.sharedSubdomains)) {
      if (def.glossary) {
        for (const [term, definition] of Object.entries(def.glossary)) {
          entries.push({ term, definition, domain: name });
        }
      }
    }
  }

  return entries;
}

/** Find terms that appear in multiple domains with different definitions. */
export function findCollisions(entries: GlossaryEntry[]): CollisionReport[] {
  // Group by lowercase term
  const groups = new Map<string, GlossaryEntry[]>();
  for (const entry of entries) {
    const key = entry.term.toLowerCase();
    const existing = groups.get(key) ?? [];
    existing.push(entry);
    groups.set(key, existing);
  }

  const collisions: CollisionReport[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Check if there are different definitions
    const uniqueDefs = new Set(group.map(e => e.definition));
    if (uniqueDefs.size < 2) continue; // Same definition everywhere — not a collision

    collisions.push({
      term: group[0].term, // Use first occurrence's casing
      entries: group.map(e => ({ domain: e.domain, definition: e.definition })),
    });
  }

  return collisions.sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()));
}

/** Format collision report as human-readable text. */
export function formatGlossaryReport(collisions: CollisionReport[]): string {
  if (collisions.length === 0) {
    return "No glossary collisions found.";
  }

  const lines: string[] = [`${collisions.length} glossary collision(s) found:`, ""];
  for (const collision of collisions) {
    lines.push(`**${collision.term}**`);
    for (const entry of collision.entries) {
      lines.push(`  - ${entry.domain}: ${entry.definition}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
