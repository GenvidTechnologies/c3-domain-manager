# ADR 0016: The authored-script rule — `.js` support with compiled-sibling suppression

**Status:** Accepted
**Date:** 2026-08-07
**Issue:** #39

---

## Context

Construct 3 supports both `.ts` and `.js` scripts, but the tool's two
script-enumerating surfaces each looked only at `.ts` — and disagreed about
*how*. `listUncategorized`'s script-subdir walk applied no extension filter at
all (only `isEditorLocalPath`), so a stray `.js` there was reported as unmapped
work; `findScriptEntries` filtered `.ts` at every file position, so that same
`.js` never appeared in the generated domain index. A file could be reported
as needing an `overrides` entry and then never show up mapped anywhere.

Measured against three projects, characteristics only:

| Corpus | C3 release | Manifest declares | `.js` on disk |
|---|---|---|---|
| canonical fixture | r49500 | 2 `.ts` (`application/typescript`) | 0 |
| a large domain-foldered project | r47604 | 127 `.ts` | 0 |
| a smaller project | r39700 | 3 `.js` (`application/javascript`) | 3, all with `.ts` siblings, all gitignored |

Four divergences exist between the two surfaces. This ADR closes **A** (the
`.ts`/`.js` extension gap). The other three are out of scope and tracked
separately: **B** — a granularity mismatch where `findScriptEntries` emits one
directory entry for a nested non-layer dir where `listUncategorized`
enumerates individual files (issue #51, pre-existing); **C** — a
non-allowlisted `scripts/` subdirectory reported by `findScriptEntries` but
never walked by `listUncategorized`'s four-entry `scriptSubdirs` allowlist
(issue #46); **D** — a non-script file under an allowlisted script subdir,
which `listUncategorized` still reports (no extension filter there, by ADR
0013 decision #4) while `findScriptEntries` never emits it (issue #47).
[[0013-editor-local-exclusion-list-uncategorized]] named full `.js` support as
its own follow-up rather than fixing it inline.

## Decision

Both surfaces now apply one authored-script rule, in two clauses with
deliberately different scopes.

1. **A script file is what a human maintains, not what C3 loads.** The
   load-bearing argument is release-inversion: which member of a `.ts`/`.js`
   pair `project.c3proj` declares changes with the editor release — r39700
   declares the compiled `.js`, r47604+ declares the `.ts` — so a
   manifest-driven definition of "script" would make the domain index churn on
   an editor upgrade with nothing human-authored actually changed. Reading
   `project.c3proj` was considered and rejected for exactly this reason (see
   Alternatives Considered).
2. **The two-clause rule, and why the clauses' scopes differ.** Clause 1
   (compiled-sibling suppression: drop `X.js` when a same-basename `X.ts` sits
   in the same directory) applies everywhere either surface enumerates script
   files — applied anywhere less than universally, the surfaces re-diverge.
   Clause 2 (`.ts`/`.js` admission) applies *only* where an extension filter
   already existed, because
   [[0013-editor-local-exclusion-list-uncategorized]] decision #4 forbids
   introducing a new one — so the script-subdir walk keeps reporting a stray
   `.md` as a legitimate unmapped-file finding (this is divergence D, above).
3. **Both predicates live in `classification.ts`, not a new module.**
   `CLAUDE.md` requires a new `src/domain/*.ts` module to be re-exported from
   `src/index.ts` — the same objection ADR 0013 raised against a
   `src/domain/c3walk.ts` — which would publish an internal predicate on the
   public API for two internal call sites. `classification.ts` is already
   public, already a leaf (it imports only `types.js`), and already imported
   by both call sites. This sidesteps issue #37's unresolved private-helpers
   question rather than depending on its resolution.
4. **`SCRIPT_SOURCE_EXTENSIONS` is a platform fact, temporarily local.**
   c3source owns C3 platform facts, but 1.9.0 exports no script-extension
   constant (`findAllScripts` hardcodes `.ts` and excludes `.d.ts`). Upstream
   request filed as `GenvidTechnologies/c3source#73`; re-check on the next
   bump. Placed in ADR 0013's three-layer architecture: the extension list is
   a platform fact (candidate for c3source); the two-clause rule is product
   policy (this repo, this ADR); the walk-site glue is unchanged. Note
   `isCompiledSibling` is **permanently** local regardless of the c3source
   bump outcome — "is this `.js` worth mapping into a domain" is this tool's
   policy, not a platform fact.
5. **`findScriptEntries` gains an unconditional `!isEditorLocalPath(name)`** at
   the file branch, retiring the old "no editor-local name ends in `.ts`"
   redundancy argument. Behaviour-neutral today — no `EDITOR_LOCAL_EXCLUSIONS`
   member ends in `.js` either — but that redundancy was only ever an accident
   of c3source's current exclusion list, and that list is c3source's to
   change: consume the predicate, never re-derive which suffixes it holds
   ([[0013-editor-local-exclusion-list-uncategorized]] decision #1). This is
   the **file** branch specifically — the **directory** branch keeps
   `isReportableScriptDir`, which exempts `ts-defs/`; swapping it for a bare
   `isEditorLocalPath` there would silently stop generated typings being
   indexable.
6. **`findScriptEntries` is still not a `find_all_files_path` adoption.** Its
   signature and directory-entry granularity are unchanged, and it remains
   public API.

## Compromise — the hand-edited-`.js` counterexample

The r39700 project ships a 12-line `importsForEvents.js` exporting
`makeUUID()` and `shouldDoAutoLogin()`, present in no `.ts` file at HEAD or
anywhere in that project's git history; its other two `.js` files *are*
faithful compiler output with real `.ts` siblings. Clause 1 **drops it** from
both surfaces — a file a human wrote, indistinguishable in shape from tsc
output. Defended on four points:

- The file is gitignored, so reporting it would advise an `overrides` key
  pointing at a path a fresh clone doesn't have — manufacturing the exact
  inert-override hazard [[0013-editor-local-exclusion-list-uncategorized]]
  documents.
- It is a real defect, but domain mapping is the wrong channel for it. The
  correct remedy is a compiled-output content-drift diagnostic (issue #48);
  telling a user to map a file that `tsc` is about to overwrite is worse
  advice than saying nothing.
- The heuristic errs safely: it hides a file rather than inventing one.
- The cost is bounded and one `git grep` away from detection.

## Compromise — the change is a corpus-wide no-op

All three corpus projects produce byte-identical `list-uncategorized` and
domain-index output before and after this change: every `.js` in the corpus
has a `.ts` sibling and is suppressed by clause 1. The *admission* branch (a
`.js` with no `.ts` sibling) has **no real-data witness** anywhere in the
corpus and is exercised synthetically only. No corpus project has a `.js` file
in a `scripts/` subdirectory at all. Stated plainly so a future reader does
not mistake the green suite for real-world validation of the admit path.

## Consequences

- Rows newly **appear** in `list-uncategorized`/the domain index (an
  unpaired, sibling-less `.js`) *and* rows newly **disappear** (a `.js` with a
  `.ts` sibling, on the surface that previously reported it unfiltered) in the
  same change — the mirror image of
  [[0013-editor-local-exclusion-list-uncategorized]]'s "Nothing newly
  appears." Call out in release notes.
- **Known remaining divergence C** (issue #46, pinned by a regression test) —
  a non-allowlisted `scripts/` subdirectory; not an extension problem.
  **Superseded by [[0017-script-surface-unification]]**
- **Known remaining divergence D** (issue #47, pinned by a regression test) —
  a non-script file under an allowlisted script subdir; follows directly from
  [[0013-editor-local-exclusion-list-uncategorized]] decision #4.
  **Superseded by [[0017-script-surface-unification]]**
- **Divergence B** (granularity) is unaffected and stays tracked as issue #51.
  **Superseded by [[0017-script-surface-unification]]**
- **Inert overrides, second instance.** An `overrides` key on a `.js` that
  clause 1 now suppresses is permanently dead — same class of hazard as
  [[0013-editor-local-exclusion-list-uncategorized]]'s entry, zero corpus
  occurrences observed. Relates to the un-suppression follow-up (issue #49)
  and issue #36.
- `collectRootTsFiles` was renamed to `collectRootScriptFiles`. The references
  to the old name in [[0008-adopt-openproject-option-a]] and
  [[0013-editor-local-exclusion-list-uncategorized]] are historical and are
  left as-is — an accepted ADR records the state faced at its date, not the
  state as later revised.

## Alternatives Considered

**Manifest-driven `rootFileFolders.script`** — read which extension
`project.c3proj` declares and admit only that one. Rejected: release-inversion
(see Decision #1) makes this actively wrong across an editor upgrade; roughly
eleven of the existing synthetic tests build projects with no `project.c3proj`
at all, so the graceful (extension-agnostic) fallback path would be the only
one ever exercised; and it does not fix divergence A on its own, since the two
surfaces would still need to agree on how to read the manifest.

**A `scripts/tsconfig.json` presence probe**, admitting `.js` only when no
`tsconfig.json` sits alongside it. Rejected as vacuous: all three corpus
projects have a `scripts/tsconfig.json`, including the JS-authored one, so
this would admit zero `.js` files anywhere in the corpus. It would also need
an explicit `fs.existsSync` guard, since `tsconfig.json` has been editor-local
and excluded from the walk since issue #33.

**A config opt-in `scriptExtensions` field.** Deferred, not designed out —
zero corpus users want anything other than `[".ts", ".js"]` today, and adding
it later is cheap because clause 2 is a single predicate
(`isScriptSourceName`) to parameterize.

**`overrides`-aware un-suppression** — letting an explicit `overrides` entry
override clause 1's suppression for a specific hand-edited `.js`. Deferred to
issue #49; blocked here by the constraint that neither `isCompiledSibling` nor
`findScriptEntries`'s signature take a `DomainConfig`, and threading one
through is a larger, separable change.
