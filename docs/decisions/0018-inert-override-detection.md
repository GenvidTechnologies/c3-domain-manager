# ADR 0018: Inert override detection — a derivative, per-section predicate

**Status:** Accepted
**Date:** 2026-08-10
**Issue:** #36

---

## Context

`listStaleOverrides` only ever checked `fs.existsSync` on each `config.overrides`
key. That catches a key whose file was deleted or renamed, but not a key whose file
**exists** and yet can never be produced by any enumeration this tool performs — the
key sits in `domain-config.json`, the file sits on disk, and the override silently
does nothing. This class was already named, twice, as an accepted gap in prior
records: [[0013-editor-local-exclusion-list-uncategorized]]'s "Inert overrides
(accepted gap)" Consequence, and [[0016-authored-script-js-support]]'s "Inert
overrides, second instance." Both left it as a follow-up. This issue is that
follow-up.

The unifying definition:

> An override key is inert when no enumeration this tool performs can ever produce
> that path.

## Decision

Add a sibling function, `listInertOverrides(rootDir, config): Array<{ key: string;
reason: string }>`, in `src/domain/domainAnalysis.ts`. `listStaleOverrides` is
untouched. A key failing `fs.existsSync` is `listStaleOverrides`' job and is
filtered out of `listInertOverrides` first, so a key is never reported by both.

**The check is derivative of each section's walk rules, not one flat predicate** —
the same "derivative, not independent" principle
[[0017-script-surface-unification]] established for `list-uncategorized`: ask what
each section's walk actually admits, rather than stating an independent rule for
"inert" and hoping it agrees. That is what makes the traps below fall out of the
design instead of needing special cases.

Both surfaces — the `list-stale-overrides` CLI command and the identically-named
MCP tool — already call `listStaleOverrides`; both are extended to also call
`listInertOverrides` and print its results alongside the stale list, under the
same command name. No new command or tool is introduced.

### The four classes

1. **Editor-local paths** ([[0013-editor-local-exclusion-list-uncategorized]]) — a
   `*.uistate.json` basename, a `uistate/` or `ts-defs/` directory segment, or
   `tsconfig.json`.
2. **A `.js` suppressed as a compiled sibling**
   ([[0016-authored-script-js-support]]) — `X.js` where `X.ts` sits in the same
   directory.
3. **A non-script file under `scripts/`** ([[0017-script-surface-unification]]) —
   a basename failing `isScriptSourceName`.
4. **A key carrying a trailing slash** — added during planning; not in issue #36's
   original scope (see below for why it was pulled in anyway).

### Why class 4 was included despite being out of the issue's original scope

It is the cheapest of the four to detect (a pure key-shape test, zero filesystem
access) and the only one that **actively corrupts the index** rather than merely
doing nothing. `classifyFile` strips one trailing slash from *the walk's* path
before the `normalizedPath in config.overrides` lookup, so a key that itself ends
in `/` can never match. Meanwhile `hasClaimBelow` slices the key to `"other/"` and
tests `claim.startsWith(innerPath + "/")` — and `"other/".startsWith("other/")` is
true — so the key **does** register as a claim below `scripts/other`, forcing
`findScriptEntries` to descend instead of emitting one collapsed directory entry
(issue #51's mechanism, [[0017-script-surface-unification]]). The user gets a more
granular index with no domain applied. `validateOverrideKeys` does not catch it
either: the `scripts/` prefix is valid.

### The two traps, and why the derivative design handles them

- **`ts-defs/` is section-scoped.** The four non-script sections walk with
  c3source's default descend rule (`!isEditorLocalPath`), which rejects both
  `uistate/` and `ts-defs/`. But `scripts/` uses `isReportableScriptDir`, which
  deliberately **exempts** `ts-defs/` so generated typings stay indexable (ADR
  0013's compromise). So `scripts/ts-defs/Player.d.ts` is **live** while
  `objectTypes/ts-defs/x.json` is **inert**. A single global editor-local
  predicate would get this backwards.
- **The extension rule is `scripts/`-only.** The other four walks admit any
  extension, so a non-script file there is live. Classes 2 and 3 must never apply
  outside `scripts/`.

### Two mechanism notes worth recording

- c3source's `isEditorLocalPath(name)` takes a **bare path segment, not a path**.
  Class 1 therefore walks the key's segments rather than testing the whole key.
  Its `EDITOR_LOCAL_EXCLUSIONS` is `{ dirs: ["uistate","ts-defs"], fileSuffixes:
  [".uistate.json"], exactNames: ["tsconfig.json"] }`.
- Class 2 consumes `isCompiledSibling` fed a `readdirSync` listing of the key's
  parent directory, rather than hand-rolling an `fs.existsSync` on the `.ts`
  sibling — ADR 0013 #1's "consume the predicate, never re-derive it."

## Compromise

### Ordering constraints, each a real defect avoided

- **Class 4 is checked before any section-specific logic.** Otherwise a
  directory-shaped key feeds its own name into the basename checks and points
  `readdirSync` at the wrong directory.
- **Classes 2 and 3 are skipped for a key naming a real directory on disk.**
  `scripts/other` (no trailing slash) is **live** — `findScriptEntries` emits
  `scripts/other/` and `classifyFile` normalizes the slash off before matching.
  Without this guard, class 3 would test `isScriptSourceName("other")`, get
  false, and report a live key as inert. A regression test in
  `test/domain/domainAnalysis.test.ts` pairs `scripts/other/` (inert, class 4)
  against `scripts/other` — same directory, no trailing slash (live) — so the
  two land on opposite sides of the report.

### A known gap this record states honestly

A **directory-shaped override key under one of the four non-script sections** —
e.g. `"eventSheets/Login": "Auth"` where `eventSheets/Login/` is a real directory
— is **also inert and is NOT detected**. Those four walks emit files only, never
directory entries, so the key can never match. Measured with a throwaway synthetic
probe: `classifyFile` given a file path inside such a directory falls through the
`eventSheetDirs` prefix match unchanged, unaffected by the directory-shaped
`overrides` key, and lands unclassified; `listInertOverrides` returns `[]` for that
key. Contrast `scripts/other`, where the equivalent probe shows the key resolving
live — that liveness is exactly why the directory guard above exists, and why this
gap is not trivially closable by just deleting that guard.

Closing this gap means distinguishing "directory key under a section whose walk
emits directories" (`scripts/`, live) from "directory key under a section whose
walk does not" (the other four, inert) — a per-section capability the current
`FILE_TYPES` table does not encode. A follow-up issue is planned to close it; none
has been filed yet.

## Consequences

- `listStaleOverrides` and `listInertOverrides` are two functions with a shared
  contract (mutually exclusive on any given key) rather than one function
  returning a richer result — kept separate because their remedies differ: a
  stale key is fixed by removing or correcting it, an inert key is fixed by
  understanding *why* the walk it targets can't reach it, which is why
  `listInertOverrides` returns a `reason` string per key and `listStaleOverrides`
  does not.
- Both the CLI `list-stale-overrides` command and the MCP `list-stale-overrides`
  tool print the inert list alongside the stale list under the existing command
  name — no surface addition, so no allow-list update is needed on the
  `gvt-construct3` explorer side.
- Regression coverage lives in `test/domain/domainAnalysis.test.ts`'s
  `listInertOverrides` describe block, one test per class plus the
  directory-vs-trailing-slash pairing and the stale/inert mutual-exclusion case.

## Alternatives Considered

**Fold the check into `listStaleOverrides` itself**, returning a richer union
type instead of a new sibling function. Rejected: the two checks have different
costs (`fs.existsSync` alone vs. re-deriving each section's walk rules) and
different remedies, and every existing call site — CLI, MCP tool, tests predating
this issue — expects `listStaleOverrides`' `string[]` shape. Keeping it a `string[]`
and adding a new function is a strictly additive change; changing its return
shape is not.

**One flat predicate covering all inert cases**, rather than deriving each class
from its section's actual walk rule. Rejected for the same reason
[[0017-script-surface-unification]] rejected an independent `list-uncategorized`
rule: a flat predicate has no structural reason to track a walk rule that changes
later (e.g. if a future c3source release changes which sections filter
extensions), and the `ts-defs/` section-scoping trap above is exactly the kind of
case a flat predicate would get wrong silently.
