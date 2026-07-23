# ADR 0012: Opt-in shared-kernel hub discount for cross-domain coupling edges

**Status:** Accepted
**Date:** 2026-07-23
**Issue:** #30 — mitigate shared-kernel-dominated coupling noise, fulfilling the mitigation deferred by issue #26 / ADR 0011

---

## Context

[[0011-expression-reference-coupling]] added expression (member) references as a
third coupling source, and flagged — but deliberately deferred — a
shared-kernel-dominance problem the two earlier sources already exhibited
undiscounted: a small set of shared-kernel singletons (analytics, localization,
input, cloud-API objects owned by a small shared subdomain) are referenced by
nearly every domain, producing a dense but low-information-density coupling
graph. A spike against the `burbank` corpus quantified this: the top-5
referenced objects (`RUM`, `I18N`, `Touch`, `CloudScriptWrapperJSON`,
`TitleData`) accounted for ~71% of resolved domain pairs, all pointing at
Core/Cloud shared subdomains. A diagnostic meant to surface *distinctive*
cross-domain relationships instead surfaces "everyone depends on the shared
kernel" three-quarters of the time — noise that drowns the boundary violations
and hub concentrations the tool exists to find.

ADR 0011 deferred a fix rather than rejecting one, on the grounds that adding a
filter only for the newest coupling source would break semantic symmetry
between the three. This ADR is that fix, applied uniformly across all three.

## Decision

**Add an opt-in `coupling` config block that discounts edges targeting a
configured "hub" domain set, applied uniformly across all three coupling
sources (include, event-variable reference, expression reference) and
consistently across every consumer, at consumption time.**

```jsonc
"coupling": {
  "discountSharedKernel": true,        // treat every isSharedSubdomain domain as a hub
  "hubDomains": ["Legacy/GlobalState"] // additional explicit DOMAIN names (not object/family names)
}
```

- The hub set is the union of every `isSharedSubdomain` domain (when
  `discountSharedKernel` is `true`) and the explicit `hubDomains` list.
- A single edge predicate governs discounting everywhere: an edge (source →
  target) is discounted iff `target ∈ hubDomains`. This is implemented once, in
  a pure module `src/domain/coupling.ts` (`computeHubDomains`,
  `activeOutgoingKeys`, `inboundDiscounted`), and consumed by every downstream
  reader rather than re-implemented per consumer.
- Discounting happens **at consumption time**, not resolution time: the raw
  resolved graph in `DomainData` (all six coupling maps —
  `includesFrom`/`includedBy`, `referencesFrom`/`referencedBy`,
  `expressionRefsFrom`/`expressionRefsBy`) is left fully intact. A test asserts
  the computed `DomainData` is deep-equal whether or not `coupling` is
  configured. No `DomainData` field was added.
- Absent a `coupling` block, output is byte-identical to before this ADR
  (fully backward compatible).

**Three semantic decisions govern how the discount applies, all confirmed with
the requester before implementation:**

1. **Boundary validation asymmetry.** In `validateBoundaries`
   (`relationships.ts`), an edge to a hub is discounted from the
   *undeclared*-dependency check — this is precisely the "everyone → Core
   undeclared" noise the discount exists to kill. The *forbidden*-direction
   check, however, still runs over the full, undiscounted graph: a real
   supporting/generic → core strategy violation must still fire even when the
   violating target happens to be a hub. Discounting that check too would let
   a genuine architectural leak hide behind the hub-discount opt-in.
2. **Detail page discounts, never excludes.** On a domain's detail page
   (`formatDomainPage` / `formatCrossDomainSection`), outgoing coupling to a
   hub is still **listed**, just tagged `(shared kernel)` — nothing is dropped
   from view. A domain that is itself a hub gets a note that its inbound
   coupling is discounted elsewhere (health Ca, the index Dependencies column,
   boundary validation, the context map) while its raw incoming edges remain
   fully enumerated on the page. This is the **one** surface where the full
   graph stays visible; every other surface hard-excludes the hub.
3. **Index-surface scope, and a terminology collision to avoid.**
   `formatDependencies` — the index page's "Dependencies" column — is in scope
   and excludes hub targets. `findCrossDomainHubs` — the index page's
   "Cross-Domain Hubs" section — is **out of scope and unchanged**: it is an
   unrelated structural degree-threshold diagnostic (a domain whose
   `includesFrom` spans ≥3 other domains and ≥5 total included sheets,
   surfacing orchestrator-style event sheets), not the config-driven
   `hubDomains` this ADR introduces. The two concepts share the word "hub" but
   nothing else — one is a config-declared shared-kernel discount, the other is
   an unconfigurable structural fan-out finder.

**Per-consumer effect:**

- **`health.ts computeHealth`** — a hub domain's Ca is 0 (all inbound edges
  discounted); every other domain's Ce is the union of its three `*From`
  targets minus hubs.
- **`relationships.ts validateBoundaries`** — undeclared-dependency check
  discounted, forbidden-direction check not (decision 1 above).
- **`contextMap.ts generateContextMap`** — observed/observed-ref/observed-expr
  edges targeting a hub are dropped, and a hub is omitted from a focus domain's
  1-hop neighbor set; declared relationships to a hub still render regardless.
- **`formatting.ts`** — the index page's Dependencies column excludes hubs; a
  domain page tags outgoing hub edges `(shared kernel)` and keeps listing them
  (decision 2 above).
- **MCP `domain-health` tool** — loads `domain-config.json` and applies the
  same hub set computed from it, so the CLI and MCP surfaces agree.

## Alternatives Considered

**Resolution-time exclusion** — never build the hub-targeting edges into
`DomainData` in the first place. Rejected: this destroys the raw graph and
would require new `DomainData` map fields (or mutating the existing ones) to
recover it, incurring the five-`makeDomain`-test-helper fan-out cost
(`CLAUDE.md` "Extending `DomainData`") for no benefit, and it bakes the opt-in
irreversibly into cached `DomainData` rather than leaving it a pure function of
config at read time.

**Degree-threshold auto-hub detection** — infer hub domains from coupling
degree instead of requiring explicit configuration. Rejected as a default:
threshold tuning is unstable across projects, it overlaps
`findCrossDomainHubs` (a different-purpose diagnostic, see decision 3 above),
and in the `burbank` corpus the dominating hubs already coincide with the
declared shared subdomains — `isSharedSubdomain` is a cleaner, zero-tuning
signal for the common case. The `coupling` block's shape does not preclude
adding an opt-in threshold later.

**Object-name (rather than domain-name) allowlist** for `hubDomains`. Rejected:
the include and event-variable coupling sources are keyed by domain, not by
object/family name — an object-name allowlist would have no meaning for two of
the three coupling sources. `hubDomains` names domains, consistent with how
`isSharedSubdomain` already designates domains as shared.

## Consequences

- `domain-config.json` gains an optional `coupling` block
  (`discountSharedKernel: boolean`, `hubDomains: string[]`), validated via a
  new lenient `CouplingOptionsSchema` on `DomainConfigSchema`.
- The three semantic decisions above (boundary asymmetry, detail-page
  discount-not-exclude, index-scope-only for `formatDependencies` with
  `findCrossDomainHubs` unchanged) are the load-bearing behavior of this
  feature and are also documented in `docs/domain-architecture.md`.
- No `DomainData` field was added — the five `makeDomain` test helpers
  (`CLAUDE.md` "Extending `DomainData`") are untouched by this change.
- Backward compatible: a project with no `coupling` block produces
  byte-identical output to before this ADR, verified by test.
- Cross-references: [[0011-expression-reference-coupling]] (the
  shared-kernel-dominance problem this fulfills the deferred mitigation for),
  [[0006-event-variable-reference-coupling]] (the parallel scope-discipline
  deferral this mirrors — deferring a diagnostics/mitigation concern to keep a
  single PR bisectable).
