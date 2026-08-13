# Documentation Index

<!--
Genvid plugin skills consult this index to find your project's docs.
Each entry should be a one-line description.
-->

## Project context

- `domain-architecture.md` — the domain model concepts and the full `domain-config.json` schema

## Operations

- `releasing.md` — how to cut a new release (version bump, tag convention, OIDC publish via `publish.yml`)

## Process

- `issue-triage.md` — issue-triage conventions (flat GitHub label set): categories, required fields, duplicate/dependency policy, and the `gh` mutation recipes

## Decision Records

Architecture Decision Records, numbered chronologically by when the decision was made.

- `decisions/0001-adopt-c3source-extractors.md` — retire local `extraction.ts`; consume c3source 1.1.0 `extractFunctions`/`extractIncludes` (issue #5)
- `decisions/0002-configurable-locations-adapters-seam.md` — make the config path and extracted-output dir overridable via a pure `src/adapters/locations.ts` resolution seam (issue #7)
- `decisions/0003-adopt-loadprojectconfig-schema-first.md` — adopt mcp-utils 0.3.0 `loadProjectConfig`; make `DomainConfig` schema-first via `DomainConfigSchema` (issue #9)
- `decisions/0004-adopt-mcp-utils-0.4.0-helpers.md` — adopt mcp-utils 0.4.0 `mcpContent`/`paginatedContent`/`withMcpErrors` + annotation constants; harden mutate writes (issue #11)
- `decisions/0005-validateforeditor-read-side-diagnostic.md` — adopt c3source 1.4.0 `validateForEditor` as a read-side diagnostic, reframing #12's "before write-out" premise (issue #13)
- `decisions/0006-event-variable-reference-coupling.md` — add event-variable references as a second cross-domain coupling source aggregated under union semantics (issue #14)
- `decisions/0007-project-dir-resolverootfolder.md` — add `--project-dir` via mcp-utils 0.5.0 `resolveRootFolder` instead of hand-rolling root discovery (issue #16)
- `decisions/0008-adopt-openproject-option-a.md` — adopt `C3Project`/`openProject` for C3 file discovery in place of hardcoded section-folder joins (Option A: local-open in pure functions; issue #19)
- `decisions/0009-addon-inventory-project-wide-diagnostic.md` — adopt c3source 1.8.0 addon attribution as a project-wide read-side `addon-inventory` diagnostic; defer per-domain attribution and expression-reference coupling (issue #25)
- `decisions/0010-per-domain-addon-attribution.md` — adopt per-domain addon attribution via a new `objectTypeDirs`/`familyDirs` classification dimension; defer expression-reference coupling (issue #26)
- `decisions/0011-expression-reference-coupling.md` — add expression (member) references as a third cross-domain coupling source, fulfilling issue #26's deferral (issue #28)
- `decisions/0012-coupling-hub-discount.md` — opt-in `coupling` config block that discounts shared-kernel hub coupling edges, uniformly across all three sources and every consumer, fulfilling issue #28's deferral (issue #30)
- `decisions/0013-editor-local-exclusion-list-uncategorized.md` — delegate `list-uncategorized`'s file walk to c3source 1.9.0 `find_all_files_path`/`isEditorLocalPath`, excluding `*.uistate.json`/`uistate/`/`tsconfig.json` while keeping `ts-defs/` reportable (issue #33)
- `decisions/0014-canonical-fixture-hermetic-materialization.md` — vendor `construct3-sample` as a tag-pinned submodule, enrich it upstream to `v1.0.0` so cross-domain coupling has material at all, and materialize it hermetically from `git archive HEAD` (issue #34)
- `decisions/0015-shared-test-helper-modules.md` — generalize `fixtureHelpers.ts`'s flat, concern-named module shape into a convention; consolidate temp-dir, config, and domain-data test builders into `syntheticProject.ts`/`domainModel.ts` (issue #38)
- `decisions/0016-authored-script-js-support.md` — the authored-script rule: admit `.ts`/`.js` scripts on both enumerating surfaces, suppressing a `.js` with a same-directory `.ts` sibling as compiled output (issue #39)
- `decisions/0017-script-surface-unification.md` — delegate `list-uncategorized`'s `scripts/` walk to `findScriptEntries`, defining the command derivatively as the domain index's worklist (issues #47, #46, #51)
- `decisions/0018-inert-override-detection.md` — add `listInertOverrides`, a per-section-derivative check for override keys that exist on disk but that no walk can ever produce (issue #36)
- `decisions/0019-walk-decides-directory-liveness.md` — a per-section table only gates whether a directory-shaped override key can be asked about; the walk itself decides liveness (issue #54)
- `decisions/0020-section-source-extension-filter.md` — filter the four non-script section walks to `.json` at the parse boundary, closing a `generate` crash and reconciling ADR 0013 decision #4 with ADR 0017's worklist definition (issue #52)
- `decisions/0021-decline-drift-diagnostic.md` — decline a compiled-output drift diagnostic, here or upstream, after measuring three candidate mechanisms against a widened corpus (issue #48)
- `decisions/0022-section-extension-provenance.md` — retire the local section-extension constant/predicate to c3source 2.0.0's audited `isSectionItemName`, correcting a `CLAUDE.md` gloss that had misattributed the `.json` list's provenance to ADR 0020 (issue #60)
