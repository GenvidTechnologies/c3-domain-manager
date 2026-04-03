import type { DomainConfig, DomainData, Relationship } from "./types.js";

export interface ContextMapOptions {
  format: "text" | "mermaid";
  domain?: string;
  includeObserved?: boolean;
}

// Special characters that require quoting in mermaid node IDs
function needsQuoting(name: string): boolean {
  return /[\s&()/\\,.'"]/.test(name);
}

function mermaidId(name: string): string {
  return needsQuoting(name) ? `"${name}"` : name;
}

type RelationshipType = Relationship["type"];

function toMermaidArrow(type: RelationshipType): string {
  switch (type) {
    case "shared-kernel":
      return "==SK==>";
    case "customer-supplier":
      return "-->|C/S|";
    case "conformist":
      return "-->|CF|";
    case "anti-corruption-layer":
      return "-->|ACL|";
    case "open-host-service":
      return "-->|OHS|";
  }
}

interface Edge {
  from: string;
  to: string;
  type: RelationshipType | "observed";
}

function collectIncludedDomains(
  domains: DomainData[],
  config: DomainConfig,
  focusDomain: string | undefined,
): Set<string> {
  const domainByName = new Map(domains.map((d) => [d.name, d]));

  if (focusDomain === undefined) {
    return new Set(domains.map((d) => d.name));
  }

  const focus = domainByName.get(focusDomain);
  if (!focus) return new Set();

  const included = new Set<string>();
  included.add(focusDomain);

  // 1-hop neighbors via includesFrom (outgoing deps from domain data)
  for (const neighbor of focus.includesFrom.keys()) {
    included.add(neighbor);
  }

  // 1-hop neighbors via includedBy (incoming deps from domain data)
  for (const neighbor of focus.includedBy.keys()) {
    included.add(neighbor);
  }

  // 1-hop neighbors via declared relationships
  for (const rel of config.relationships ?? []) {
    if (rel.from === focusDomain) included.add(rel.to);
    if (rel.to === focusDomain) included.add(rel.from);
  }

  return included;
}

function collectEdges(
  domains: DomainData[],
  config: DomainConfig,
  includedNames: Set<string>,
  includeObserved: boolean,
): Edge[] {
  const edges: Edge[] = [];
  const relationships = config.relationships ?? [];

  // Add declared relationships between included domains
  for (const rel of relationships) {
    if (includedNames.has(rel.from) && includedNames.has(rel.to)) {
      edges.push({ from: rel.from, to: rel.to, type: rel.type });
    }
  }

  if (!includeObserved) return edges;

  // Build a set of pairs already covered by declared relationships
  const declaredPairs = new Set<string>();
  for (const rel of relationships) {
    declaredPairs.add(`${rel.from}::${rel.to}`);
    declaredPairs.add(`${rel.to}::${rel.from}`);
  }

  // Add observed edges: domain.includesFrom entries not covered by any declared relationship
  for (const domain of domains) {
    if (!includedNames.has(domain.name)) continue;
    for (const targetDomain of domain.includesFrom.keys()) {
      if (!includedNames.has(targetDomain)) continue;
      const pairKey = `${domain.name}::${targetDomain}`;
      if (!declaredPairs.has(pairKey)) {
        edges.push({ from: domain.name, to: targetDomain, type: "observed" });
      }
    }
  }

  return edges;
}

function formatMermaid(includedNames: Set<string>, edges: Edge[]): string {
  if (edges.length === 0) {
    return "graph LR";
  }

  const lines: string[] = ["graph LR"];
  for (const edge of edges) {
    const fromId = mermaidId(edge.from);
    const toId = mermaidId(edge.to);
    if (edge.type === "observed") {
      lines.push(`  ${fromId} -.-> ${toId}`);
    } else {
      const arrow = toMermaidArrow(edge.type);
      lines.push(`  ${fromId} ${arrow} ${toId}`);
    }
  }

  return lines.join("\n");
}

function formatText(
  domains: DomainData[],
  includedNames: Set<string>,
  edges: Edge[],
): string {
  const includedDomains = domains.filter((d) => includedNames.has(d.name));

  if (includedDomains.length === 0) {
    return "Context Map:\n\nNo domains.";
  }

  const lines: string[] = ["Context Map:", ""];

  // Build adjacency for outgoing and incoming per domain
  // outgoing: from → to
  // incoming: to → from
  type RelEntry = { neighbor: string; type: RelationshipType | "observed" };
  const outgoing = new Map<string, RelEntry[]>();
  const incoming = new Map<string, RelEntry[]>();

  for (const name of includedNames) {
    outgoing.set(name, []);
    incoming.set(name, []);
  }

  for (const edge of edges) {
    outgoing.get(edge.from)?.push({ neighbor: edge.to, type: edge.type });
    incoming.get(edge.to)?.push({ neighbor: edge.from, type: edge.type });
  }

  for (const domain of includedDomains) {
    lines.push(domain.name);
    const outs = outgoing.get(domain.name) ?? [];
    const ins = incoming.get(domain.name) ?? [];

    for (const entry of outs) {
      lines.push(`  → ${entry.neighbor} [${entry.type}]`);
    }
    for (const entry of ins) {
      lines.push(`  ← ${entry.neighbor} [${entry.type}]`);
    }

    lines.push("");
  }

  // Remove trailing empty line
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

export function generateContextMap(
  domains: DomainData[],
  config: DomainConfig,
  opts: ContextMapOptions,
): string {
  const includeObserved = opts.includeObserved ?? true;
  const includedNames = collectIncludedDomains(domains, config, opts.domain);
  const edges = collectEdges(domains, config, includedNames, includeObserved);

  if (opts.format === "mermaid") {
    return formatMermaid(includedNames, edges);
  }

  return formatText(domains, includedNames, edges);
}
