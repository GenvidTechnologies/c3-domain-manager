# ADR 0009: Adopt addon attribution as a project-wide `addon-inventory` diagnostic

**Status:** Accepted
**Date:** 2026-07-21
**Issue:** #25 — bump `@genvidtech/c3source` to 1.8.0

---

## Context

`@genvidtech/c3source` 1.8.0 shipped two new API families relevant to this
tool: addon attribution (`collectAddonAttribution` /
`attributeObjectType` / `attributeFamily`, `C3Project.collectAddonAttribution()`,
`getUsedAddons`) and expression-reference extraction
(`extractExpressionReferences`). CLAUDE.md's standing guidance is to check
whether new c3source exports supersede local logic or have an integration site
here.

Addon attribution has a clear integration site: it derives, per object type
and family, which addon plugin/behaviors/effects it draws on, and
`getUsedAddons` reads the manifest's declared `usedAddons` list. Diffing the
two surfaces a dead dependency (declared but nothing uses it) and manifest
drift (used but never declared) — a project-wide health check with no
dependency on `domain-config.json` or the classification pipeline.

Expression-reference extraction and per-domain addon attribution were also
evaluated (see Alternatives) but both require net-new project surface this
issue does not have scope for.

## Decision

**Adopt addon attribution as a project-wide, read-side `addon-inventory`
diagnostic**, cloning the `editorValidation.ts` template established in
[[0005-validateforeditor-read-side-diagnostic]]: a pure function
(`computeAddonInventory`, `src/domain/addonInventory.ts`) exposed as the
`addon-inventory` CLI subcommand and the MCP `READ_ONLY` "Addon Inventory"
tool. It does not consume `DomainData[]` and takes no `domain-config.json` —
addons aren't scoped to a domain, so there is nothing here for the config to
narrow.

`computeAddonInventory(rootDir, log?)` opens the project via `openProject`,
calls `project.collectAddonAttribution()` for the attribution list, and
`getUsedAddons(project.manifest())` for the declared list; it diffs them into
`declaredButUnused` and `usedButUndeclared`, alongside the raw `attributions`
and deduped `usedIds`.

**Deliberate divergence from `editorValidation.ts`:** unlike the fully-graceful
editor-strictness diagnostic, `computeAddonInventory` calls
`project.manifest()`, which **throws** if `project.c3proj` is missing or
malformed. This is intentional — an addon inventory is meaningless without a
manifest to cross-reference the attribution against, so there is no useful
graceful-empty result to fall back to (contrast attribution itself, which
*is* graceful-empty when `objectTypes/`/`families/` are both absent, since
`collectAddonAttribution`'s own finders already return `[]` for missing
directories).

## Alternatives Considered

**Option 2 — per-domain addon attribution.** Deferred, but not for lack of
viability. A spike (issue #25, task T5) checked the empirical assumption
underlying it — do real C3 projects fold `objectTypes/` into domain-named
subfolders the way `eventSheets/`/`layouts/`/`scripts/` already do? **Finding:
yes, for substantial projects.** `burbank` (1,673 object-type files) folders
both `objectTypes/` and `families/` by domain, reusing the *same* domain
identifiers already declared in its `domain-config.json`
(`eventSheetDirs`/`layoutDirs`); `construct3-poc` (77 files) corroborates.
Tutorial/addon-demo samples (`chef`, `c3-tutorial`) are flat or organized by
asset kind instead, but those aren't this tool's target audience.

So Option 2 would produce a genuinely populated dimension, not an empty one —
the deferral is scope, not viability. It requires net-new project surface: a
new `objectTypeDirs`/`familyDirs` config dimension in
`DomainDefinitionSchema` plus `classification.ts` support (today
classification covers only `eventSheets/`/`layouts/`/`scripts/`). That's out
of scope for a dependency-bump issue. Two caveats worth recording honestly:
the domain-foldering evidence rests mainly on Genvid-authored projects
(possibly house style, not proven industry-universal), and flat/asset-kind
projects would land everything in `"(unclassified)"`, the same
graceful-degradation the tool already applies to unclassified event sheets.

**Option 3 — expression-reference coupling edge.** Deferred alongside Option
2. `extractExpressionReferences` could add a third cross-domain coupling edge
(object/behavior member references) alongside the existing include and
event-variable edges (see
[[0006-event-variable-reference-coupling]]), but it strictly depends on
Option 2's object-type-to-domain mapping (to resolve an `objectName` to a
domain) plus a net-new raw-param-string walk. There is no standalone
integration site for it without Option 2 landing first.

## Consequences

- New `addon-inventory` capability: CLI subcommand and MCP `READ_ONLY` tool.
  The diff surfaces dead dependencies (declared-but-unused) and manifest
  drift (used-but-undeclared), plus the raw attribution listing.
- `addon-inventory` is the second diagnostic (after `validate-editor`) that
  derives its result fresh from disk and is independent of domain-index
  staleness; its MCP tool likewise omits the stale-index warning other read
  tools append.
- Unlike every other diagnostic in this tool, `addon-inventory` can throw on
  a missing/malformed `project.c3proj` rather than degrade gracefully — a
  deliberate, documented exception to the graceful-empty pattern established
  in [[0008-adopt-openproject-option-a]].
- A follow-up issue should be filed to pursue Options 2 and 3 — the new
  `objectTypeDirs`/`familyDirs` config dimension, its `classification.ts`
  support, and the per-domain attribution/expression-coupling features — now
  that the empirical foldering blocker is cleared.
- The downstream `claude-code-plugin-gvt-construct3` c3-explorer allow-list
  pins this package's MCP tool surface; the next publish needs a follow-up
  update-request issue there to add `addon-inventory`.
