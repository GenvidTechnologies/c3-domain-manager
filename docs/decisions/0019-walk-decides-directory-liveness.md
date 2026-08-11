# ADR 0019: The walk, not a static table, decides directory-key liveness

**Status:** Accepted
**Date:** 2026-08-10
**Issue:** #54

---

## Context

[[0018-inert-override-detection]] shipped `listInertOverrides` with four
classes and honestly recorded a known gap: a directory-shaped override key
under one of the four non-script sections (`eventSheets/`, `layouts/`,
`objectTypes/`, `families/`) is inert but was not detected. It named the
prescribed fix — a per-section capability the current `FILE_TYPES` table did
not encode — and filed issue #54 to add it.

During issue #54's planning, probes against `main` @ `174803e` (the commit
0018 shipped on) surfaced three further defects in the same predicate, none
of them named in the issue, all measured with the same throwaway synthetic
probe rather than hypothesized:

- `scripts/ts-defs` was reported inert, but is genuinely **live**:
  `isReportableScriptDir` exempts `ts-defs/` (0018's own "two traps" section,
  citing ADR 0013's compromise), so `findScriptEntries` does emit a collapsed
  `scripts/ts-defs/` entry. A **false positive** — the predicate told a user
  a working override was dead.
- `scripts/shared` was not reported, though it is inert: `shared` is one of
  `findScriptEntries`' structural layer directories, so the walk recurses
  into it and never emits a collapsed `scripts/shared/` entry.
- `scripts/claimed` was not reported, though it is inert: with
  `scriptDirs: ["claimed/deep"]` configured, `hasClaimBelow` forces the walk
  to descend past `scripts/claimed` instead of collapsing it to one entry.

Measured before -> after (same probe both times):

```
eventSheets/Login    not reported -> reported      (the gap #54 was filed for)
scripts/ts-defs      reported     -> not reported  (false positive removed)
scripts/shared       not reported -> reported      (LAYER_DIRS)
scripts/claimed      not reported -> reported      (hasClaimBelow)
scripts/other        not reported -> not reported  (live; regression guard)
```

These three findings **refute issue #54's premise that a directory-shaped
key under `scripts/` is simply live.** A static per-section table — even one
enriched with the `emitsDirectories` capability the issue proposed — cannot
answer the `scripts/` question at all, because liveness there is a property
of the walk's actual descent decisions, not of the section as a whole.

## Decision

Split the question the class asks in two, rather than answering it with one
table lookup.

`FILE_TYPES[fileType].emitsDirectories` (new boolean field, `classification.ts`)
gates whether the question is even **askable** for a section: can this
section's walk ever produce a directory entry at all? `eventSheets/`,
`layouts/`, `objectTypes/`, and `families/` walk via `collectSourceFiles` /
`find_all_files_path`, which yields files only, never directories — so
`emitsDirectories` is `false` for all four, and a directory-shaped key under
any of them is unconditionally inert. This is the part of issue #54's
prescription that was correct, and it is sufficient on its own for these four
sections: a flat per-section boolean is an exact model of "this walk cannot
emit a directory," because none of them has a competing per-directory rule
that could make the boolean wrong for one particular directory.

For a section where `emitsDirectories` is `true` — currently only
`scripts/` — the table cannot say more; the walk itself has to answer. When
`listInertOverrides` reaches a directory-shaped key under such a section, it
calls `findScriptEntries` (lazily — see Compromise) and tests set
membership: the key is live iff the walk actually emits `<key>/` as a
collapsed directory entry. `findScriptEntries` makes that per-directory
decision from three independent rules — `isReportableScriptDir`'s `ts-defs/`
exemption, structural layer-directory recursion, and `hasClaimBelow`-forced
descent — none of which a flat per-section boolean can represent. A table
extended to cover them would need a fourth dimension it doesn't have, and
even then would have to re-derive the same three rules `findScriptEntries`
already encodes, doubling the place they can drift apart.

This is [[0018-inert-override-detection]]'s own thesis — "the check is
derivative of each section's walk rules, not one flat predicate," itself
inherited from [[0017-script-surface-unification]] — applied to
directory-shaped keys as literally as it was already applied to editor-local
paths and script extensions. 0018 approximated that thesis with a static
table for this one class; this record replaces the approximation with the
walk itself, for the one section where the table cannot be enough.

## Compromise

**The lazy single walk, and its cost.** Asking the walk means re-running
`findScriptEntries` over the whole `scripts/` tree — the same enumeration
`computeDomainData` uses to build `DomainData`. `listInertOverrides` pays
that cost lazily, memoized in an `emittedScriptPaths` set built on first use,
so it runs at most once per `listInertOverrides` call, and only when a
directory-shaped key under an `emitsDirectories` section is actually present
in `config.overrides`. A config with no such key pays nothing beyond the
existing four classes.

**Reason-string trade-off.** The new class-5 branch is checked before
class 1's basename `isEditorLocalPath` test (0018's amended Compromise
section records why that ordering is load-bearing). A key like
`eventSheets/x/uistate` — a directory whose basename is itself editor-local
— now gets class 5's directory reason ("names a directory, but the
eventSheets/ walk only ever emits files…") rather than the more specific
class-1 editor-local reason. Both are true of the key; class 5 is the more
fundamental of the two (the section cannot emit *any* directory, editor-local
or not), so this is not a regression — noted here so a future reader diffing
reason strings doesn't mistake the change for one.

**The `fileType === "script"` count stays at 2** — issue #54's AC 4. The new
class-5 branch `continue`s before reaching the classes-2/3 block, so it adds
no new occurrence of that check.

## Consequences

- `listInertOverrides`'s directory-shaped-key detection is now correct for
  all five sections instead of four (0018's gap) and no longer produces the
  `scripts/ts-defs` false positive. `scripts/shared` and `scripts/claimed`
  are now reported.
- The `scripts/` walk is consulted through the same `findScriptEntries`
  import `domainAnalysis.ts` already had from `domainGenerator.ts` (0018 /
  [[0017-script-surface-unification]]) — no new module edge.
- **Does not foreclose issue #52.** #52 asks whether the four non-script
  sections' index collectors are consistent about filtering non-`.json`
  extensions ([[0017-script-surface-unification]]'s measured per-section
  table: `eventSheets/`/`families/` filter, `layouts/`/`objectTypes/` don't)
  — a different per-section fact from `emitsDirectories`, and one this record
  does not touch. #52 is blocked on the upstream question
  `GenvidTechnologies/c3source#76` (whether that inconsistency is
  intentional) and stays out of scope here.
- Regression coverage: the four cases in the before/after table above are
  each a test in `test/domain/domainAnalysis.test.ts`'s `listInertOverrides`
  describe block (`scripts/other` already covered by 0018's own guard test).

## Alternatives Considered

**A per-section static table with one boolean per section**, as issue #54
originally proposed. Rejected: the three `scripts/`-only defects above show a
single section-level boolean cannot represent per-directory descent rules
like structural layer-directory recursion or `hasClaimBelow`-forced descent —
it would have closed the gap the issue was filed for while shipping a new
false positive (`scripts/ts-defs`) and leaving two further gaps
(`scripts/shared`, `scripts/claimed`) undetected.

**Widening the table to a two-dimensional structure** (section x directory
rule) instead of consulting the walk. Rejected: `findScriptEntries` already
encodes exactly those per-directory rules to build `DomainData`; a second
table restating them would be a second place for the same three rules to
drift apart, the identical risk [[0017-script-surface-unification]] rejected
when it deleted `listUncategorized`'s independent `scripts/` walk in favor of
delegation.
