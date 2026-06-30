# ADR 0005: Adopt `validateForEditor` as a read-side editor-strictness diagnostic

**Status:** Accepted
**Date:** 2026-06-11
**Issue:** #13 (reframing #12) — adopt c3source 1.4.0 `validateForEditor`

> Recovered retroactively (2026-06-30) from commit `bc76696`,
> CLAUDE.md, and `docs/domain-architecture.md`.

---

## Context

`@genvidtech/c3source` 1.4.0 shipped `validateForEditor(sheet)` /
`EditorValidationIssue`, which checks a parsed event sheet against the structural
rules the C3 editor enforces on import (e.g. a `variable` event missing its
`comment` field, or a `group` event missing its `description`).

The originating issue (#12) framed this as a guard to run **"before write-out"** —
the implicit assumption being that `c3-domain-manager` writes or modifies C3
event sheets and should validate them before doing so. It does not.
`c3-domain-manager` only ever *reads* event sheets to analyze them; the only files
it writes are its own `extracted/` markdown index and (via MCP mutate tools) the
`domain-config.json`. There is no C3-sheet write site for a "before write-out"
guard to attach to. (This "verify the integration site the issue assumes actually
exists" lesson is now recorded in CLAUDE.md.)

## Decision

**Adopt `validateForEditor`, but as a read-side diagnostic — not a write
guard.** Add `validateEditorStrictness` / `formatEditorStrictnessReport`
(`src/domain/editorValidation.ts`) and expose them as the `validate-editor` CLI
subcommand and the MCP `READ_ONLY` "Validate Editor Strictness" tool.

The diagnostic re-walks `eventSheets/` fresh from disk (it does **not** consume
the cached `DomainData[]`), attributes each sheet to a domain via `classifyFile`,
runs `validateForEditor` per sheet, and returns issues grouped by sheet. Sheets
matching no domain are still validated and reported under `"(unclassified)"`. The
report surfaces sheets the C3 editor would refuse to import, so the user can fix
them in the editor.

## Alternatives Considered

**Implement the issue as written — a pre-write guard.** Rejected because the
premise is false: there is no C3-sheet write path in this tool. Forcing a guard
in would have meant inventing a write site that does not exist.

**Skip adoption entirely** (no write site ⇒ no use). Rejected: the validation
has clear standalone value as a read-side health check, independent of any write.
Reframing it as a diagnostic preserves the value without the bogus premise.

## Consequences

- `validate-editor` is the first read-side capability that intentionally does
  **not** read the cached domain index — it re-walks sheets from disk, so the MCP
  tool deliberately omits the stale-index warning that other read tools append
  (index freshness is irrelevant to its output).
- `editorValidation.ts` is independent of the `DomainData[]` pipeline that every
  other downstream module consumes; it shares only `classifyFile`.
- Continues the c3source-supersedes-local-logic pattern of
  [[0001-adopt-c3source-extractors]]; the file-discovery half of this walk is
  later migrated to the project handle in [[0008-adopt-openproject-option-a]]
  (via `hasEventSheets()` / `findAllEventSheets()`).
- Establishes the durable lesson — verify the integration site an issue assumes
  actually exists before building to its premise.
