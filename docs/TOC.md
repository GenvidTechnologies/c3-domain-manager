# Documentation Index

<!--
Genvid plugin skills consult this index to find your project's docs.
Each entry should be a one-line description.
-->

## Project context

- `domain-architecture.md` — the domain model concepts and the full `domain-config.json` schema

## Operations

- `releasing.md` — how to cut a new release (version bump, tag convention, OIDC publish via `publish.yml`)

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
