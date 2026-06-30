# ADR 0006: Add event-variable references as a second cross-domain coupling source

**Status:** Accepted
**Date:** 2026-06-11
**Issue:** #14 — enrich the cross-domain dependency graph

> Recovered retroactively (2026-06-30) from commit `cc8b5fd`,
> CLAUDE.md, and `docs/domain-architecture.md`.

---

## Context

Cross-domain coupling was derived from a single source: `include` events. When a
sheet in domain A includes a sheet in domain B, that is an include edge A → B
(the `includesFrom` / `includedBy` graphs). But C3 event sheets couple in a
second way the include graph misses entirely: a sheet can **reference an event
variable declared in another sheet** via System ACEs. Two domains can be coupled
through shared global variables without any include relationship between them.

c3source 1.4.0 also shipped the primitives needed to detect this:
`getEventVarReferenceName` / `EVENTVAR_REFERENCE_ACES`, plus the
`visitEvents` / `hasConditions` / `hasActions` tree-visitors.

## Decision

**Derive a second, sibling coupling source — event-variable references — and
aggregate it with include coupling under union semantics.**

- `extractEventVarDecls` indexes top-level (`variable`) declarations per domain;
  `extractEventVarRefs` collects System-ACE references via
  `getEventVarReferenceName` + the visitors. `computeDomainData` resolves each
  reference to its declaring domain(s) and builds `referencesFrom` /
  `referencedBy`, sibling to the include maps.

**Resolution policy:**

- **Global-scope approximation** — only top-level (sheet-root) `variable` events
  are indexed as declarations (C3 cross-sheet references require globals).
  Variables inside groups/functions are deliberately excluded.
- **Attribute-to-all on collision** — a name declared at the top level of
  multiple domains creates an edge to every declaring domain.
- **Unresolved references produce no edge** — a referenced name with no indexed
  declaration anywhere is silently ignored (no diagnostics bucket).
- **Same-domain references produce no edge** — consistent with include coupling.

No `domain-config.json` schema change is required — reference coupling is derived
entirely from sheet content.

## Alternatives Considered

**Fold references into the existing include edges.** Rejected: the two coupling
kinds have different meanings and different fixes, so they are kept distinct. The
context map renders references as a separate `observed-ref` edge kind
(`[observed-ref]` in text, `-.->|var|` in Mermaid), with precedence declared >
observed (include) > observed-ref.

**Track unresolved references in a diagnostics bucket.** Rejected as scope creep
for this issue — the "unresolved → no edge" path is simple and correct for the
coupling question; a diagnostics surface can come later if warranted.

**Index variables declared inside groups/functions too.** Rejected: those are
not visible across sheets in C3, so a cross-sheet reference to one is genuinely
unresolvable — excluding them is the correct behaviour, not a limitation to fix.

## Consequences

- Both coupling sources are aggregated with **union semantics** across every
  downstream consumer: health (Ca/Ce count the deduped union),
  `validateBoundaries` (a reference to an undeclared domain is an `undeclared`
  violation just like an include), the context map (the `observed-ref` edge
  kind), and domain pages (two new reference subsections).
- Reuses the c3source 1.4.0 primitives adopted alongside
  [[0005-validateforeditor-read-side-diagnostic]] — the same release supplied
  both the validator and these reference helpers.
- Full policy and aggregation are documented in `docs/domain-architecture.md`
  ("Cross-domain coupling sources").
