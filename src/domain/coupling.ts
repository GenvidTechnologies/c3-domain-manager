import type { DomainConfig, DomainData } from "./types.js";

/**
 * The set of domain names treated as shared-kernel "hubs" whose inbound
 * coupling is discounted. Empty unless the config opts in via `coupling`.
 * Union of: every isSharedSubdomain domain (when discountSharedKernel is set)
 * plus any explicitly listed coupling.hubDomains (which need not be shared).
 */
export function computeHubDomains(domains: DomainData[], config: DomainConfig): Set<string> {
  const opts = config.coupling;
  if (!opts) return new Set();
  const hubs = new Set<string>();
  if (opts.discountSharedKernel) {
    for (const d of domains) if (d.isSharedSubdomain) hubs.add(d.name);
  }
  for (const name of opts.hubDomains ?? []) hubs.add(name);
  return hubs;
}

/** Outgoing coupling-map keys (target domain names) with hub targets removed. */
export function activeOutgoingKeys(keys: Iterable<string>, hubs: Set<string>): string[] {
  return [...keys].filter((k) => !hubs.has(k));
}

/** True when this domain's inbound coupling is discounted (it is itself a hub). */
export function inboundDiscounted(name: string, hubs: Set<string>): boolean {
  return hubs.has(name);
}
