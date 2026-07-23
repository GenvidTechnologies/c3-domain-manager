# ADR 0011: Add expression (member) references as a third cross-domain coupling source

**Status:** Accepted
**Date:** 2026-07-23
**Issue:** #28 — pursue expression-reference coupling (c3source 1.8.0 "Option 3"), deferred by issue #26 / ADR 0010

---

## Context

Cross-domain coupling had two sources: `include` events (ADR history predates this
file) and event-variable references
([[0006-event-variable-reference-coupling]]). [[0010-per-domain-addon-attribution]]
then added the `objectTypeDirs`/`familyDirs` classification dimension so object
types and families classify into domains the same way event sheets, layouts, and
scripts already do — but it explicitly deferred building the `objectName` →
domain index and the "Option 3" (expression-reference coupling) it would enable,
for blast-radius reasons: Option 3 fans out across
health/relationships/contextMap/formatting, so keeping it in a separate PR keeps
each independently bisectable.

c3source 1.8.0 also ships `extractExpressionReferences`, which parses raw ACE
parameter expression strings and returns `reference` tokens carrying an
`objectName` (and, for behavior-qualified expressions, a `behaviorName`) for every
object-type/family/behavior member access a condition or action makes. Combined
with ADR 0010's classification dimension, the missing piece — a name → domain
index — is now buildable, unblocking Option 3.

## Decision

**Derive a third, sibling coupling source — expression (member) references — and
aggregate it with include and event-variable-reference coupling under the same
union semantics.**

- `extractExpressionRefs(sheet)` walks every condition and every non-script
  action (script actions hold TypeScript, not C3 expressions, and are skipped
  via `isScriptAction`) and runs `extractExpressionReferences` over each string
  ACE parameter value, collecting the deduped `objectName` of every `reference`
  token.
- `computeDomainData` builds an `objectNameIndex` (object-type name / family name
  → declaring domain(s)) from the same object-type and family classification
  loops ADR 0010 introduced, then resolves each raw member reference to its
  declaring domain(s), populating sibling `expressionRefsFrom`/`expressionRefsBy`
  maps on `DomainData` alongside `includesFrom`/`includedBy` and
  `referencesFrom`/`referencedBy`. This fits the wider system the same way ADR
  0006's edge did: a third pure-function extraction step feeding the same
  `computeDomainData` resolution pass, consumed identically by every downstream
  `DomainData` reader.

**Resolution policy** — identical in shape to ADR 0006's event-variable policy:

- **Depends on the `objectTypeDirs`/`familyDirs` classification dimension** —
  resolution looks up each referenced name in `objectNameIndex`. Unlike the
  event-variable source's global-scope approximation, this source needs no
  separate heuristic of its own — it reuses ADR 0010's classification directly.
- **Attribute-to-all on collision** — a name classified into multiple domains
  creates an edge to every declaring domain.
- **Unresolved references produce no edge** — a referenced name absent from
  `objectNameIndex` (a system/built-in object, or an object type/family the
  project never classified) is silently ignored, exactly as an unresolved
  event-variable name is.
- **Same-domain references produce no edge** — consistent with the other two
  sources.
- **Family references resolve to the family's own domain**, never to its member
  object types — a family classifies (and is indexed in `objectNameIndex`) under
  its own name.
- **Behavior-qualified references join on `objectName` only** — a reference such
  as `Object.Behavior.member` resolves via `objectName`; `behaviorName` plays no
  role in resolution.

**Inert until configured** — a project whose `domain-config.json` declares no
`objectTypeDirs`/`familyDirs` has an empty `objectNameIndex`, so no expression
edges resolve at all, even if its event sheets contain many member references.
This is intended opt-in behavior, identical in spirit to ADR 0010's own
addon-attribution opt-in, not a defect. It was reconfirmed against a real
project: a hypothetical migrated `burbank` config with no `objectTypeDirs`
yields zero expression edges, correctly.

## Alternatives Considered

**Ship a hub-exclusion / shared-kernel-discount filter alongside this edge**, to
counter an observed pattern where shared-kernel singletons (analytics/
localization/input/cloud-API objects owned by a small shared subdomain) are
referenced by nearly every domain, producing a dense but low-information-density
coupling graph. Deferred to a follow-up: this is the same "everyone depends on
the shared kernel" pattern the two existing edge kinds already exhibit
undiscounted, so adding a filter only for the newest source would break semantic
symmetry between the three. Mirrors ADR 0006's deferral of an
unresolved-references diagnostics bucket for the same reason — scope discipline
over completeness within a single PR.

**Fan a family reference out to all of the family's member object types**, on the
theory that a family reference is "really" a reference to whichever member is
active at runtime. Rejected: this manufactures false coupling. The family's own
domain is the correct, and only, resolution target for a reference to the family
name.

## Consequences

- `DomainData` gains a third sibling edge-map pair, `expressionRefsFrom`/
  `expressionRefsBy`, additive to the existing four coupling maps.
- All three coupling sources are aggregated under union semantics everywhere
  coupling is consumed: `health.ts` (Ca/Ce dedupe across all three), the
  boundary-validation undeclared/forbidden checks in `relationships.ts`,
  `contextMap.ts` (a fourth edge kind, `observed-expr` / `-.->|expr|`, with
  precedence `declared > observed (include) > observed-ref (event-variable) >
  observed-expr (member reference)`, plus 1-hop neighbor inclusion), and
  `formatting.ts` (two new domain-page subsections, "Member references from this
  domain" / "Member references into this domain").
- The source is **inert until a project opts into `objectTypeDirs`/`familyDirs`**
  (ADR 0010) — no schema change beyond what ADR 0010 already added.
- **Shared-kernel hub dominance is a known, accepted characteristic** of this
  edge kind: resolved edges concentrate heavily on shared-kernel singletons
  nearly every domain touches. A hub-exclusion mitigation is deferred, not
  rejected — see Alternatives Considered.
- No new MCP tool or CLI subcommand — this rides the existing
  `DomainData`-consuming surfaces, same as ADR 0006.
- c3source 1.8.0's `comparisonSymbol`/`COMPARISON_OPERATORS` and the
  `.c3addon`-package layer (`readAddonPackage`/`parseAcesModel`/etc.) remain out
  of scope — unrelated exports from the same release, not integration sites this
  work touches.
- Full policy and aggregation are documented in `docs/domain-architecture.md`
  ("Cross-domain coupling sources" → "Expression (member) reference coupling").
- Cross-references: [[0006-event-variable-reference-coupling]] (the coupling-edge
  pattern this mirrors), [[0010-per-domain-addon-attribution]] (the
  classification dimension and deferred `objectNameIndex` seam this fulfills).
