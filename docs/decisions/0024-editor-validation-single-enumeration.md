# ADR 0024: `editorValidation.ts` routes through the single `eventSheets/` enumeration

**Status:** Accepted
**Date:** 2026-08-14
**Issue:** #37 (rescoped) — unify `editorValidation.ts`'s independent `eventSheets/` walk with `collectSectionFiles`

---

## Context

`validateEditorStrictness` (`src/domain/editorValidation.ts`) hand-relativized
its own `project.findAllEventSheets()` walk —
`path.relative(rootDir, p).replace(/\\/g, "/")` — carrying the last living
copy of that idiom outside `classification.ts`, and the last un-tested
`g`-flag site in `src/`. It now enumerates through the shared
`collectSectionFiles(project, "eventSheet", rootDir)` seam and re-joins with
`path.join(rootDir, relPath)` for the read, the same abs→rel→abs shape
`computeDomainData` already uses at its four parse sites. `hasEventSheets()`
is kept, re-commented as redundant for correctness (`findInSection` already
returns `[]` for an absent section dir) but load-bearing for its log line,
the skip signal [[0008-adopt-openproject-option-a]] preserves.
`test/domain/editorValidation.test.ts` is untouched — its 13 tests staying
byte-identical is the output-neutrality gate, alongside a structural argument
(below) for why no dimension of the report could move.

A new contract test in `test/domain/sectionSurfaces.test.ts` pins the `g`
flag by feeding `collectSectionFiles` a synthesised native-separator collector
result directly, bypassing the filesystem — see "The CI constraint" below for
why that had to be the shape of the test.

This record exists because two prior accepted records made statements this
change bears on, and the boundary between "closed by this work" and "left
standing" is not obvious from either record read alone.

## Decision

**Unify for idiom locality, not for correctness.** Both the old and new code
made the identical `project.findAllEventSheets()` call
(`SECTION_COLLECTORS.eventSheet` in `classification.ts` *is* that call), every
admission rule (`.json` via `isSectionItemName`, editor-local exclusion) runs
inside c3source upstream of both walks, and the report is sorted by `sheet`
regardless of enumeration order. No output dimension could move. What moved
is that `src/domain/` now has exactly one copy of the
`path.relative(...).replace(/\\/g, "/")` idiom instead of two.

## Supersedes

[[0022-section-extension-provenance]]'s `## Consequences` section (`:284-294`)
carries a bullet titled *"`editorValidation.ts`'s asymmetry is closed by
construction, and deliberately not touched here"* — a consequence-scoped
statement of intent that this repo would leave `editorValidation.ts`'s
independent walk alone. This work supersedes that statement of intent: the
walk **is** touched here, on this branch.

**This does not touch ADR 0022's `## Decision`** (`:46`), which retired the
local `SECTION_SOURCE_EXTENSIONS`/`isSectionSourceName` pair in favor of
c3source 2.0.0's audited `isSectionItemName`. That decision is about *which
extension is admitted at a section boundary* and is entirely untouched by
this work — this record only changes *how many times* `eventSheets/` is
walked, not what either walk admits. A reader must not come away thinking the
extension-provenance work was reversed.

Applying ADR 0022's own four-label disposition vocabulary (`:155`) to itself:

- **Superseded:** the `## Consequences` "deliberately not touched here"
  statement of intent, above.
- **Fulfilled, not superseded:** nothing in ADR 0022 predicted this
  unification; there is no forward-looking claim of ADR 0022's that this
  record fulfills.
- **Left standing:** ADR 0022's `## Decision` (the extension-provenance
  split itself), its `## Provenance` section, its `## Case sensitivity`
  section, and every other claim in the record not naming
  `editorValidation.ts`.
- **Amended by fact:** none — this is a direct supersession of one
  named statement, not an indirect correction discovered elsewhere.

Per the precedent [[0020-section-source-extension-filter]] set at its
`:190-198` (an accepted ADR records the state faced at its date; supersession
is always a forward reference from the newer record), ADR 0022 itself is left
unedited.

## A misattribution, corrected

ADR 0022 (`:288-289`) quotes the holding *"it walks `eventSheets/`, which has
no suppression rule to contradict, so it re-walks the *same* set"* and
attributes it to [[0017-script-surface-unification]]. That attribution is
wrong. Verified this session:

- `grep -cF "editorValidation" docs/decisions/0017-script-surface-unification.md`
  → **0**. ADR 0017 never mentions `editorValidation.ts`.
- `grep -cF "editorValidation" docs/decisions/0021-decline-drift-diagnostic.md`
  → **1**, at line 186, and the quoted sentence appears there verbatim
  (`:186-189`, in ADR 0021's `## If this is revisited` §1).
- `grep -rn "suppression rule" docs/decisions/` returns four hits: ADR
  0017:211 (an unrelated `.json`-suppression proposal in its Alternatives
  Considered, about a different walk entirely — `scripts/`, not
  `eventSheets/`), ADR 0021:186-188 (the origin), and ADR 0022:288-289 and
  ADR 0023:286 (both restatements).

**The misattribution is confined to ADR 0022 — [[0023-decline-stray-file-diagnostic]]
is clean**, and it is worth saying so explicitly, because the natural
assumption is that a mis-citation propagates down the chain. ADR 0023:284-288
makes two citations and both are accurate: it credits
[[0022-section-extension-provenance]] with the reasoning that record
*recorded* — which ADR 0022 did, by restating it — and it credits
[[0017-script-surface-unification]] only with "the failure … exists to close
(two walks disagreeing about one set)", which is genuinely ADR 0017's
subject. At no point does ADR 0023 attribute the "no suppression rule to
contradict" holding to ADR 0017. The chain is two records deep, not three.

The true owner is **[[0021-decline-drift-diagnostic]]**, not ADR 0017. This
is a further instance of the sibling-paraphrase failure mode `CLAUDE.md`'s
"Documentation conventions" section already documents (its second bullet,
on ADR-to-ADR paraphrase): two records reaching the same conclusion by
different routes is the common case, and citing a sibling's *conclusion* is
safe while restating *which record reached it* is not, without checking. The
practical cost is that a reader following ADR 0022's citation lands on a
record ([[0017-script-surface-unification]]) that never said it — and,
because ADR 0022 pairs the citation with a verbatim quotation, the landing
reads as a failed search rather than as a wrong pointer.

## The principle survives — it loses its exemplar, not its force

[[0021-decline-drift-diagnostic]]'s actual concern, correctly read from its
own text, is **contradiction**: a second walk of a section is dangerous
specifically when it can *disagree* with the first about which files belong
to the set — which requires one walk to apply a suppression rule the other
doesn't. Its `scripts/` example is exactly that shape: `findScriptEntries`
suppresses a compiled `.js` sibling; a hypothetical second `scripts/` walk
for a drift diagnostic would not, so the two would disagree about the same
set.

That contradiction cannot arise between `editorValidation.ts` and
`collectSectionFiles` at `eventSheets/`, and the reason is **structural, not
empirical**: `SECTION_COLLECTORS.eventSheet` in `classification.ts` **is**
`(p) => p.findAllEventSheets()` — the identical call
`editorValidation.ts` was already making before this branch — and every
admission rule (`.json` via `isSectionItemName`, editor-local exclusion via
`isEditorLocalPath`) is composed inside c3source's
`find_all_section_items_path`, upstream of both call sites. There was never
a second *view* of the set to disagree, only a second *idiom* for relativizing
paths it already agreed with.

**Therefore: this work does not overturn ADR 0021's principle.** What was
actually removed here is a duplicated, droppable-`g` regex — an idiom-locality
hazard, categorically distinct from ADR 0021's set-disagreement hazard.
`eventSheets/` loses its status as the one `src/` exemplar of "a second
read-side walk with no suppression rule to contradict is acceptable
precedent" — but the precedent itself is not repudiated, only unexemplified.
A future reader auditing "which sections have exactly one enumeration" will
now find `eventSheets/` clean and could wrongly infer the ADR 0021 precedent
was struck down; it wasn't. It simply has no `src/` instance left to point
at, until or unless a future diagnostic (see ADR 0023's revival note below)
re-establishes one.

**This establishes a second, independent reason to prefer a single
enumeration per section: idiom locality**, distinct from ADR 0021's
set-contradiction reason. ADR 0023's revival guidance (below) does not
currently account for this second reason, because it did not exist when ADR
0023 was written.

## ADR 0023's decline stands

[[0023-decline-stray-file-diagnostic]]'s `editorValidation` reference sits at
`:282-288`, under its `## If this is revisited` heading (`:267`) — revival
guidance for a future stray-file diagnostic, not part of its actual decline.
The decline itself lives in `## Decision` (`:86`), `### Evidence` (`:96`),
`### Scope dispositions` (`:130`), and `### Re-raise triggers` (`:293`), none
of which mention `editorValidation.ts`. So the declined stray-file diagnostic
is **not** newly questionable by anything in this record.

What this record owes that future revival: a stray-file diagnostic remains
structurally safe on the same grounds as before (disjoint set from the item
walk, so no contradiction) — but should it ever be built, it should route any
path relativization through the single existing idiom (`classification.ts`'s
`path.relative(...).replace(/\\/g, "/")`, now the only copy in `src/domain/`)
rather than re-copying it into a third site. That is the second reason
applying forward, not a reversal of ADR 0023's first.

## Issue #37's stated blocker is dissolved, not decided

Issue #37 framed its blocker as: does `CLAUDE.md`'s "every `src/domain/`
module is public API" rule get a private-helpers exception, or does the seam
live somewhere else? [[0020-section-source-extension-filter]] had already
answered "somewhere else" — the seam is `classification.ts`, an
already-public module. This work creates **no shared helper at all**: the
consolidation removes the second copy of the idiom rather than extracting a
common one out of two remaining copies, so the private-helpers question is
never reached here. It **stays open** for whoever next needs it.
[[0016-authored-script-js-support]] (`:68`) — *"this sidesteps issue #37's
unresolved private-helpers question rather than depending on its
resolution"* — still stands, unamended.

**Extraction was considered and rejected as the mechanism for the `g`-flag
test**, for a reason specific to this consolidation: after routing
`editorValidation.ts` through `collectSectionFiles`, there is exactly one
relativize call site left (inside `collectSectionFiles` itself). A
hypothetical `toRelPosix` helper extracted out of it would have exactly one
caller, and a unit test of the helper in isolation would not prove
`collectSectionFiles` actually calls it — it would test a symbol, not the
enumeration itself. The chosen contract test instead exercises
the real exported `collectSectionFiles` function directly, with a synthesised
collector result standing in for the filesystem.

## The CI constraint

`.github/workflows/ci.yml` delegates its `gate` job to
`GenvidTechnologies/public-github-actions/.github/workflows/node-gate.yml@main`,
whose only runner line is `runs-on: ubuntu-latest` — no OS matrix, no
strategy block (fetched and grepped this session). On POSIX, `path.relative`
never emits a backslash, so `.replace(/\\/g, "/")` is a no-op there and no
filesystem-driven test — real or synthetic temp-dir walk alike — can observe
whether the `g` flag is present. The pre-existing coverage at both the old
`editorValidation.ts` site and `classification.ts` was therefore incidental:
correct only on a Windows developer machine, silent everywhere CI runs.

The new `sectionSurfaces.test.ts` contract test closes that gap by feeding
`collectSectionFiles` a stubbed `findAllEventSheets` result carrying two
backslashes directly, bypassing the filesystem so CI can observe the flag
regardless of the runner's OS.

**Considered and deferred: adding a Windows CI leg.** That would close the
gap for real (a genuine filesystem walk producing backslashes, observed by
CI), rather than relying on a synthesised input. Not done here:
`node-gate.yml` is a shared reusable workflow owned by another repo
(`GenvidTechnologies/public-github-actions`) with a hardcoded runner, so
adding an OS matrix is a cross-repo change outside this issue's scope. Worth
raising there if the synthesised-input contract test is ever judged
insufficient.

## Excluded sites: `locations.ts` and `server.ts`

`src/adapters/locations.ts`'s `toForwardSlash` helper (`:26-28`) and
`src/mcp/server.ts`'s `CONFIG_WATCH_KEY` normalization (`:39`) both stay out
of scope for this consolidation. Three reasons, recorded so neither is
re-proposed as a fourth site to route through `collectSectionFiles`:

1. **Different idiom.** Both are a bare `.replace(/\\/g, "/")` applied to an
   already-absolute path, to build a watch key for `ExpectedChanges`. Neither
   involves `path.relative`, a section root, or `classifyFile` — there is no
   relative-path idiom here to unify, only a coincidentally similar regex.
2. **Layering.** `src/domain/` is the pure core; `src/adapters/` sits above
   it (per `CLAUDE.md`'s Architecture section). Routing either site through
   `collectSectionFiles` would require a `domain → adapters` import, inverting
   that layering. There are zero such imports today, and this work adds none.
3. **No gap to close.** `test/adapters/locations.test.ts` (`:98-103`) already
   feeds `resolveLocations({ config: "sub\\deep\\config.json" }, root)` and
   asserts `notInclude(loc.configWatchKey, "\\")` — a test that already fails
   on `ubuntu-latest` if `toForwardSlash`'s `g` flag were dropped. Measured
   this session: unlike the `editorValidation.ts`/`classification.ts` pair
   above, this site's coverage was never CI-blind.

**Unactioned follow-up, recorded but not filed:** `src/mcp/server.ts`'s
module-init `CONFIG_WATCH_KEY` (`:39`) is overwritten during server startup
at `:620` by `loc.configWatchKey` — the value that already went through the
covered `toForwardSlash` in `locations.ts`. The right eventual treatment is
therefore **deletion** of the module-init duplicate, not unification with
`collectSectionFiles` or any other seam. That deletion needs the MCP server
test harness `CLAUDE.md` names as a known follow-up, to confirm nothing
observes the pre-overwrite value. Worth a separate issue; not filed here.

## Consequences

- `src/domain/editorValidation.ts` has one fewer `path.relative` call site;
  `src/domain/classification.ts` is now the sole owner of the relativize
  idiom in `src/domain/`.
- `test/domain/editorValidation.test.ts` is unchanged — output-neutral by
  construction (identical upstream call, identical admission rules,
  order-independent sort), not merely by passing test.
- No public API change: `collectSectionFiles` was already exported and
  consumed elsewhere; `editorValidation.ts` gains an import, nothing more.
- The `#37` citation in `classification.ts`'s docstring is reframed (not
  removed) to record that this is now the only copy of the idiom, and to
  point at the CI-blindness argument above rather than leaving the citation
  as an open concern.
- The private-helpers question issue #37 originally raised stays open,
  unresolved by this work, per the section above.

## Alternatives Considered

**Extract a shared `toRelPosix(rootDir, absPath)` helper** used by both
`collectSectionFiles` and (were `locations.ts`/`server.ts` in scope) the two
excluded sites. Rejected for the reason given above: after this
consolidation there is exactly one relativize call site in `src/domain/`, so
an extracted helper would have one caller and its own unit test would not
prove the real seam was exercised. Extending it to `locations.ts`/`server.ts`
was rejected separately, for the layering and different-idiom reasons in
"Excluded sites" above.

**Leave `editorValidation.ts`'s independent walk alone**, per ADR 0022's
`## Consequences` statement of intent. Rejected: that statement was scoped
to ADR 0022's own change (an extension-provenance removal, not a
walk-count question) and never argued the independent walk should stay
forever — it argued only that ADR 0022 itself would not be the record to
touch it. This record is that later touch, on idiom-locality grounds
distinct from ADR 0022's extension-provenance concern.
