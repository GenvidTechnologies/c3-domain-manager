# ADR 0001: Adopt `@genvid/c3source` 1.1.0 event-tree extractors; retire local `extraction.ts`

**Status:** Accepted
**Date:** 2026-06-02
**Issue:** #5 — adopt upstream extractors once c3source 1.1.0 ships them

> Recovered retroactively (2026-06-30) from commit `1fe2638` and the
> CLAUDE.md "When bumping `@genvidtech/c3source`" guidance. Numbered first
> because it is the earliest architectural decision in the project's history.

---

## Context

`c3-domain-manager` needs the exported function signatures and the include
edges out of each parsed event sheet. Originally this lived in a local
`src/domain/extraction.ts` that walked the C3 event tree by hand — stringly-typed
`eventType` checks and `as` casts over the raw event JSON — because the upstream
`@genvid/c3source` package did not yet expose typed extractors.

c3source 1.1.0 landed both upstream requests this had been waiting on: a typed
`extractFunctions(sheet)` over the `EventSheetEvent` union (upstream #23) and
`extractIncludes(sheet)` (upstream #24). c3source owns the Construct 3 platform
facts, so its typed extractors are authoritative where our hand-rolled walk was a
fragile re-derivation. Per the standing CLAUDE.md guidance ("when bumping
c3source, check whether new exports supersede local C3-parsing logic"), the bump
triggered an evaluation of whether to retire the local walk.

## Decision

**Delete `src/domain/extraction.ts` and consume c3source's typed extractors
directly.** `domainGenerator.ts` calls `extractFunctions` / `extractIncludes`
and maps the typed output onto our local types:

- `extractFunctionDefs(sheet, sheetName)` is retained as one small exported
  seam that maps c3source's `ExtractedFunction` → our `FunctionDef`
  (param-string formatting, `sourceSheet`, and the custom-ACE
  `objectClass`/`aceName` fields).
- Includes become `extractIncludes(sheet).map(r => r.includeSheet)`.
- `types.ts` re-exports c3source's `FunctionParameter` instead of defining a
  byte-identical local copy.

## Alternatives Considered

**Keep the hand-rolled walk.** Rejected: it duplicates platform knowledge that
c3source now owns and maintains, and the stringly-typed checks would silently rot
as the C3 event schema evolves. The typed extractors eliminate the `as` casts.

**Wrap c3source's extractors behind a local abstraction layer.** Rejected as
premature — only the thin `extractFunctionDefs` mapping seam is needed to bridge
to our `FunctionDef`; a broader abstraction would add indirection without a
second consumer to justify it.

## Consequences

- The local event-tree walk is gone; c3source is now the single source of truth
  for function and include extraction. This is the pattern later decisions follow
  (see [[0005-validateforeditor-read-side-diagnostic]] and
  [[0008-adopt-openproject-option-a]]): a c3source release ships a primitive that
  retires a hand-rolled equivalent here.
- Behaviour-preserving: the full suite (130 tests at the time) stayed green and
  generated output was unchanged.
- Removing the exported `extraction.ts` symbols is a public-API change. At 0.x a
  breaking removal takes a **minor** bump, so this shipped as 0.1.3 → 0.2.0
  (clarified in the release docs at the same time).
- `extractFunctionDefs` remains the one seam to maintain when c3source's
  `ExtractedFunction` shape changes.
