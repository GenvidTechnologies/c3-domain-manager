---
okf_version: "0.2"
---

<!-- `okf_version` is the ONLY frontmatter key permitted here (§8/§12) — this
     file is the bundle-root index (`wiki/index.md`, the OKF bundle root).
     A `wiki/<subdir>/index.md` carries NO frontmatter at all. -->

# Wiki Index

This is the wiki's table of contents — every page under `wiki/`, grouped under
section headings, one line each. `/gvt-dev:maintain-wiki` keeps this list
current: a new page is added here when it's created, and `lint` flags any page
listed in **no** index — here, or in a subdirectory's own `index.md`. Each
entry's description is the linked page's frontmatter `description`, so the
index and the page can't drift. See `schema.md` for the page format
and maintenance rules.

## Project context

- `reference/domain-architecture.md` — the domain model concepts and the full `domain-config.json` schema

## Operations

- `process/releasing.md` — how to cut a new release (version bump, tag convention, OIDC publish via `publish.yml`)

## Knowledge Base

- `schema.md` — maintenance schema for the three-tier LLM-wiki (`raw/` captures → `wiki/` pages → this schema): page format, create-vs-update lifecycle, `raw/` immutability, and the staleness policy

## Process

- `process/issue-triage.md` — issue-triage conventions (flat GitHub label set): categories, required fields, duplicate/dependency policy, and the `gh` mutation recipes

## Testing & Platform

- [fs.watch platform behaviour and the test shapes it forces](fs-watch-platform-behaviour.md) — fs.watch fires 2 events per write on Windows (ReadDirectoryChangesW) and 1 on Linux (inotify), invariant across node majors — a platform confound CI structurally cannot see, closed by a 3x2 matrix, with an observation-gated test shape that expires the moment the divergence is fixed.

## Dependency Management

- [Route a shared-primitive defect upstream, not around it](upstream-dependency-routing.md) — When a defect or a missing primitive sits inside a first-party dependency's shared code, route the fix to that dependency's own repo rather than patching around it locally — but verify the fix actually closes the symptom, not just the mechanism it targeted.

## Documentation Practice

- [How a summary silently diverges from the record it summarizes](documentation-drift-modes.md) — Three distinct shapes of documentation drift measured in this repo's ADR history — a gloss that inverts a decision, a sibling ADR misattributing a mechanism, and a framing sentence that sends work down a premise the records themselves deny — and what checkable action closes each.

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
- `decisions/0023-decline-stray-file-diagnostic.md` — decline a stray-file diagnostic built on c3source 2.0.0's `detectStrayFiles`, with explicit dispositions for the four modelled sections, the three unmodelled ones, `scripts/`, and `tilemapBrushes/` (issue #62)
- `decisions/0024-editor-validation-single-enumeration.md` — route `editorValidation.ts`'s `eventSheets/` walk through `collectSectionFiles` for idiom locality, scoping a supersession of ADR 0022 and correcting a misattributed ADR 0021 citation (issue #37)
- `decisions/0025-mcp-server-stdio-test-harness.md` — add a subprocess-based MCP stdio test harness, then delete `server.ts`'s seven dead module-init initializers once the harness proves the deletion output-neutral, fulfilling ADR 0024's deferred follow-up (issues #67, #65)
- `decisions/0026-fs-watch-platform-confound-and-upstream-routing.md` — close ADR 0025's node-version/platform confound, widen the `txId` double-bump to both watch paths, route the fix to mcp-utils rather than patching locally, then adopt the resulting 0.7.0 `OptimisticWatcher` — including why `stop()` alone did not close the watcher leak (issues #68, #70)
- `decisions/0027-retire-docs-tier-into-the-wiki-bundle.md` — retire `docs/` entirely into the `wiki/` OKF bundle atop mcp-utils 0.8.0's configurable `exposeDocs`, fold `docs/TOC.md` into `wiki/index.md`, and resolve the append-only-log, scanner-coverage, and schema-doc-resurrection hazards the move creates (issue #75)
- `decisions/0028-mcp-server-multi-project-support.md` — host several C3 project roots over one MCP server process via a `ProjectRegistry<ProjectContext>` selector seam, a composite `<projectId>:<n>` txId token extracted upstream into mcp-utils and shared with `construct3-chef#95`, and a reversed decline of marker-based multi-root discovery once mcp-utils shipped `resolveRootFolders` (issue #77)
