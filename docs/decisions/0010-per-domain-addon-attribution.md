# ADR 0010: Adopt per-domain addon attribution via an `objectTypeDirs`/`familyDirs` config dimension

**Status:** Accepted
**Date:** 2026-07-22
**Issue:** #26 — Pursue per-domain addon attribution + expression-reference coupling (c3source 1.8.0 Options 2 & 3)

---

## Context

Issue #26 is the explicitly-filed follow-up to
[[0009-addon-inventory-project-wide-diagnostic]], which adopted addon
attribution as a **project-wide** `addon-inventory` diagnostic and deferred
two richer adoptions "on scope, not viability." That ADR's T5 spike already
cleared the empirical blocker for one of them: substantial C3 projects
(`burbank`, `construct3-poc`) fold `objectTypes/` and `families/` into
domain-named subfolders reusing the same identifiers already declared in
`eventSheetDirs`/`layoutDirs`.

This PR adopts **Option 2** (per-domain addon attribution). **Option 3**
(expression-reference coupling) remains deferred to a further follow-up.

## Decision

**Add an opt-in `objectTypeDirs`/`familyDirs` classification dimension** so
object types and families classify into domains the same way
`eventSheets/`/`layouts/`/`scripts/` already do — longest-matching-prefix
wins, and both `domains` and `sharedSubdomains` participate.

`computeDomainData` discovers object types and families via the open
`C3Project` handle (`findAllObjectTypes()`/`findAllFamilies()`), classifies
each by path through the same `classifyFile` used for the other file types,
and attributes each to its owning domain using c3source's **pure per-file**
`attributeObjectType`/`attributeFamily` — **not** the project-wide
`collectAddonAttribution` (adopted in ADR 0009), which discards the per-file
path this per-domain resolution needs. Each domain gains an
`addons: AddonAttribution[]` field, surfaced as a per-domain "Addons used"
section in the generated domain-index pages.

As a preparatory step, the previously-duplicated file-type root/dir-key
triad (`FILE_TYPE_ROOTS`/`DIR_KEYS` in `classification.ts`, and
`VALID_PREFIXES` in `domainAnalysis.ts`) was unified into one `FILE_TYPES`
table (`{root, dirKey}` per file type), so adding the two new section kinds
happens in one place; `VALID_PREFIXES` is now derived from it.

Specific decisions and rationale:

- **`AddonAttribution[]` shape (per-file, richer) chosen over a flat
  `string[]` of addon ids** — it preserves per-object-type/family provenance
  for the domain-page rendering, and the pure per-file attribution functions
  hand us these objects directly. Project-wide deduplication into a flat id
  list stays `addon-inventory`'s job (ADR 0009); this field is not a
  replacement for it.
- **No new MCP tool.** Per-domain addons surface only through the
  domain-index pages and the existing `DomainData`-consuming tools. This
  deliberately avoids a `claude-code-plugin-gvt-construct3` c3-explorer
  allow-list follow-up — contrast ADR 0009, whose new `addon-inventory` tool
  needed exactly that follow-up.
- **`health.ts` coverage and cross-domain hub detection are left
  unchanged.** Object types and families are data, not behavioral files;
  folding them into coverage would silently flip existing domains' coverage
  numbers. This is an explicit non-change, not an oversight.
- **Graceful degradation preserved.** Flat or asset-kind projects with no
  `objectTypeDirs`/`familyDirs` declared — or with object types that don't
  match any declared dir — land in the existing flat `unclassified` list,
  never throw. `findAllObjectTypes()`/`findAllFamilies()` return `[]` for
  absent directories, consistent with the `openProject` robustness adopted
  in [[0008-adopt-openproject-option-a]]. Contrast the deliberate
  throw-on-missing-manifest exception ADR 0009 made for `addon-inventory` —
  this per-domain path stays fully graceful.
- **`openProject` per-function call preserved (ADR 0008 Option A).**
  `computeDomainData` keeps its `rootDir`-first signature; no `C3Project`
  handle is threaded through the public API.

## Alternatives Considered

**Build the `objectName` → domain index and ship Option 3 (expression-reference
coupling) in this PR too.** Rejected for blast radius: Option 3 fans out
across health/relationships/contextMap/formatting with an
unvalidated name-resolution heuristic, so keeping it separate keeps each PR
independently bisectable. The `objectNameIndex` seam this would require is
explicitly **not built** here, to keep Option 2 free of dead code — it is
now unblocked by Option 2's path-based object-type-to-domain classification
landing, and should be picked up by a follow-up issue.

## Consequences

- New opt-in config surface: `objectTypeDirs`/`familyDirs` on
  `DomainDefinitionSchema`. Existing configs without them behave identically
  — additive, backward-compatible.
- Domain-index pages gain a per-domain "Addons used" section; `DomainData`
  gains an additive `addons: AddonAttribution[]` field on the public API.
- The file-type root/dir-key triad is now single-sourced (`FILE_TYPES` in
  `classification.ts`), reducing drift risk for any future section kind.
- A follow-up issue should pursue **Option 3** (expression-reference
  coupling, mirroring the coupling-edge pattern of
  [[0006-event-variable-reference-coupling]]) — now unblocked by this PR's
  object-type-to-domain classification.
- Cross-references: [[0009-addon-inventory-project-wide-diagnostic]] (the
  project-wide diagnostic this refines at finer grain),
  [[0006-event-variable-reference-coupling]] (the coupling-edge pattern
  Option 3 will mirror), and [[0008-adopt-openproject-option-a]] (the
  `openProject` graceful-degradation pattern this decision preserves).
