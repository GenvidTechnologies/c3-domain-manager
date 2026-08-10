# ADR 0017: Script surface unification — one worklist definition for `list-uncategorized`

**Status:** Accepted
**Date:** 2026-08-10
**Issue:** #47 (anchor) — a non-script file under an allowlisted `scripts/` subdirectory
is reported by `list-uncategorized` but can never reach the generated index; also closes
#46 and #51

---

## Context

[[0016-authored-script-js-support]] named three divergences between `listUncategorized`
(`domainAnalysis.ts`) and `findScriptEntries` (`domainGenerator.ts`) as out of scope for
its `.ts`/`.js` fix, tracking each as its own issue:

- **B** (#51) — a granularity mismatch: `findScriptEntries` emits one collapsed directory
  entry for a nested non-layer `scripts/` subdirectory where `listUncategorized`
  enumerated individual files.
- **C** (#46) — a non-allowlisted `scripts/` subdirectory reachable by
  `findScriptEntries` (and therefore index-visible) but never walked by
  `listUncategorized`'s four-entry `scriptSubdirs` allowlist.
- **D** (#47) — a non-script file sitting under an allowlisted `scripts/` subdirectory,
  which `listUncategorized` reports (no extension filter there, by
  [[0013-editor-local-exclusion-list-uncategorized]] decision #4) while
  `findScriptEntries` never emits it, so the index can never contain it.

Each divergence, read in isolation, suggests a different fix direction — B and C both
read as "`listUncategorized` under-reports, make it walk more like `findScriptEntries`";
D reads the opposite way, "`listUncategorized` over-reports, make it walk more like
`findScriptEntries`'s extension filter." They cannot be resolved independently by a
single per-divergence rule, because B/C and D pull the two surfaces toward each other
from opposite sides.

The resolution is to stop asking "what should each surface report" and instead ask what
the surface is *for*:

> `list-uncategorized` is the worklist for the domain index. A path is reportable
> exactly when assigning it to a domain would change what the generated index contains.

This is neither of the two readings the originating issues offered independently —
"every file needing assignment" (which would make D's `data.json` reportable forever,
since assigning it *would* change... nothing, because the index has nowhere to put a
non-script file) or "script files not yet mapped" (which doesn't by itself explain why C
should widen or why B should collapse). It defines `list-uncategorized` *derivatively*,
in terms of the index it exists to complete, rather than stating an independent rule for
the command itself. Once stated this way, B, C, and D each fall out as a direct
consequence — B and C by widening `listUncategorized`'s walk to match the index's, D by
narrowing it to match the index's *filter*, in different directions from the same single
cause.

## Decision

**Delete `listUncategorized`'s independent `scripts/` walk; delegate to
`findScriptEntries`.**

1. `listUncategorized` (`domainAnalysis.ts`) no longer walks `scripts/` itself. It calls
   `findScriptEntries(project.scriptsDir, config)` — the exact enumeration
   `computeDomainData` uses to build `DomainData` — and reports whichever of its entries
   `classifyFile` returns `null` for. `collectScriptFiles`, `collectRootScriptFiles`,
   `suppressCompiledSiblings`, and the local `scriptSubdirs` allowlist literal are
   deleted from `domainAnalysis.ts` entirely; the `scriptSubdirs` allowlist as a concept
   (four hardcoded entries: `shared`, `c3-runtime`, `common`, `ts-defs`) no longer
   exists anywhere. This closes C directly: `findScriptEntries` walks all of `scripts/`,
   not four allowlisted names, so an unclaimed non-layer subdirectory like `other/` is
   now reported by both surfaces.
2. `findScriptEntries` gains config-awareness to fix B without regressing C's fix into a
   granularity mismatch of its own. A new `hasClaimBelow` predicate
   (`classification.ts`) reports whether some `*Dirs` array or `overrides` key in the
   config claims a path *strictly below* a given directory. `findScriptEntries` takes an
   optional `config` parameter and, at each non-layer directory it would otherwise
   collapse into one entry, descends into it instead when `hasClaimBelow` is true —
   because a claim below a directory can never be satisfied by a single collapsed entry
   for that whole directory. Before this fix, `scriptDirs: ["common/nested"]` produced
   real **data loss**: the collapsed `scripts/common/` entry classified as a unit,
   `common/nested` never matched anything, and the whole subtree silently landed in
   `unclassified` with no diagnostic. `hasClaimBelow` gates *descent*, not just
   *emission* — a claim below an editor-local directory (e.g. something claimed inside
   `scripts/ts-defs/uistate/`) still must not force entry into it, so the editor-local
   guard is checked first and short-circuits regardless of any claim below.
3. `classifyFile` (`classification.ts`) gains trailing-slash tolerance: a lookup path
   ending in `/` has the slash stripped before the override check and prefix match run.
   This lets both surfaces pass a `findScriptEntries` directory entry
   (`scripts/other/`) straight into `classifyFile` without a bespoke
   `.replace(/\/$/, "")` at each call site — `computeDomainData` already needed exactly
   that strip before this change; it is now redundant there and `classifyFile` is the
   single place the tolerance lives.

**This narrows, rather than supersedes, [[0013-editor-local-exclusion-list-uncategorized]]
decision #4.** Decision #4 states "no new extension filter is introduced," illustrated
with a stray non-`.json` file remaining a legitimate finding under an unclaimed
`eventSheets/` directory. That illustration is still true today — `eventSheets/` is
untouched by this change, and a stray non-`.json` file there is still reported. What
changed is narrower than the decision's own wording suggested: `scripts/` no longer has
an independent walk to apply an extension filter *to* — it has been deleted and replaced
by delegation to `findScriptEntries`, which has always applied `isScriptSourceName`.
Decision #4 now holds for the four non-`scripts/` sections (`eventSheets/`, `layouts/`,
`objectTypes/`, `families/`) rather than for all six original walk sites the decision was
written against.

**Measured per-section collector table**, current state:

| Section | Index collector | Filters non-`.json`? | D fires? |
|---|---|---|---|
| `eventSheets/` | `project.findAllEventSheets()` | yes | **yes** |
| `layouts/` | `project.findAllLayouts()` | no | no |
| `objectTypes/` | `project.findAllObjectTypes()` | no | no |
| `families/` | `project.findAllFamilies()` | yes | **yes** |
| `scripts/` | `findScriptEntries` (local) | yes | now delegated |

Divergence D's underlying condition — an index collector that filters extensions while
`classifyFile`'s corresponding walk does not — still exists at `eventSheets/` and
`families/`. This is deliberately out of scope here: the pattern is set by
**c3source's own per-section inconsistency** (`find_all_eventsheets_path` and the
`findAllFamilies` predicate both filter to `.json`; `find_all_layouts_path` and
`find_all_objectTypes_path` do not), a platform fact this repo does not own and is not
free to unify by itself. `scripts/` was different only because its collector
(`findScriptEntries`) has always been local code, not a c3source export — the one
section where this repo *could* close the D-shaped gap without touching upstream, so
this decision closes it there and only there.

**`descend` / dependency-floor note.** Deleting `collectRootScriptFiles` removed the
repo's only use of `find_all_files_path`'s `descend: () => false` parameter.
[[0013-editor-local-exclusion-list-uncategorized]] (Compromise — "`descend` was not
needed where the issue assumed") argued the `@genvidtech/c3source` `^1.9.0` floor was
"genuinely load-bearing" *because of* that `descend` usage. That reason no longer holds:
`findScriptEntries` never called `find_all_files_path` (it always used a hand-rolled
`fs.readdirSync` walk with its own recursion control), so `descend` was only ever used
at the one call site this ADR deletes. The `^1.9.0` floor is now carried solely by
`C3_TS_DEFS_FOLDER` (still consumed by `isReportableScriptDir`). Recorded explicitly so
a future reader auditing the floor does not conclude `descend` is still a reason for it
and, symmetrically, does not conclude the floor is ceremonial and drop it — it isn't;
`C3_TS_DEFS_FOLDER` alone still requires 1.9.0.

**ADR 0013's ts-defs/object-type mirroring deferral is superseded.** ADR 0013's
Consequences (the "Deferred" list) named "`ts-defs` object-type mirroring" — the idea
that `scripts/ts-defs/Player.d.ts` should inherit the domain of
`objectTypes/**/Player.json` — as a follow-up sized comparably to issue #26, needing its
own analysis and ADR. A since-closed issue took up exactly that mirroring idea — the
same issue [[0016-authored-script-js-support]] had (incorrectly) cited as divergence B's
own tracking number, corrected to #51 above — and its premise was empirically refuted:
measured across several real Construct 3 projects, `ts-defs/` emission is addon-keyed,
not object-type-keyed (thousands of object types, a couple dozen generated `.d.ts`
files per project) — there is no per-object-type `.d.ts` to mirror against. That issue
is closed on that basis. Divergence B itself is unrelated to mirroring and is fixed here
by `hasClaimBelow`. ADR 0013 itself is not edited — an
accepted ADR records the state faced at its date, not later revisions (the same
precedent [[0016-authored-script-js-support]] sets for its own `collectRootTsFiles`
rename note).

## Compromise — the lost D signal is accepted

Before this change, a stray non-script file under an allowlisted `scripts/` subdirectory
(the canonical case: `scripts/shared/data.json`) was reported by `list-uncategorized`.
After this change, it is reported by neither surface — the exact fix issue #47 required
(its acceptance criterion 2), and a deliberate loss of signal, not an oversight.

The trade is accepted because the signal being removed was actively harmful, not merely
redundant. `list-uncategorized`'s reported-but-unfixable status for `data.json` set up
the precise failure this repo already documents once: a user following the tool's advice
adds an `overrides` entry for the file, the file then leaves `list-uncategorized`
(exact-match overrides win first), the generated index never contains it because no
`scripts/` index collector emits non-script files, and `list-stale-overrides` can never
flag the now-dead entry because it only checks file existence, not whether the entry
does anything — manufacturing the exact inert-override hazard
[[0013-editor-local-exclusion-list-uncategorized]] documents (its own "Inert overrides
(accepted gap)" Consequence, and again in [[0016-authored-script-js-support]]'s
"Inert overrides, second instance"). Silence — nothing to map, because the definition of
`list-uncategorized` no longer calls a non-script file "worklist" — is a smaller cost
than manufacturing that hazard a third time.

**Cost:** a genuinely stray, misplaced non-script file dropped in `scripts/shared/`
(e.g. an accidentally-committed `.log` or a misfiled `.json` asset) now produces no
diagnostic anywhere in this tool. Nothing else in the tool's current surface catches
that case; it would need a separate, explicitly-scoped diagnostic to reintroduce it
without reintroducing the inert-override hazard above.

## Consequences

- **Both fixes narrow, not widen, the reported set relative to a naive per-divergence
  read.** C widens `list-uncategorized`'s walk (more paths reported); D narrows it
  (fewer paths reported); B changes granularity without changing the reported set's
  membership. Net effect on a real project depends on its `scripts/` layout — no single
  "count goes up/down" statement holds across all three.
- **This decision's outcome overlaps with both alternatives
  [[0013-editor-local-exclusion-list-uncategorized]] rejected**, at its `:238-245`
  ("Aligning `list-uncategorized`'s extension filter with what `computeDomainData`
  consumes") and `:247-250` ("Collapsing the `scriptSubdirs` allowlist"). ADR 0013 was
  not wrong to reject them *as stated*: at that point the two surfaces were two
  independent hand-rolled walks, and aligning or collapsing one in place would have
  produced a partial alignment that reads like a guarantee and isn't one — exactly ADR
  0013's stated objection. This decision reaches the same outward behavior by a
  different mechanism: deleting `listUncategorized`'s walk and delegating to
  `findScriptEntries`, so there is structurally one walk instead of two kept in sync by
  hand. The old objection doesn't apply to a single shared enumeration; it isn't being
  overruled, it's mooted by removing the thing it was an objection to.
- The `hasClaimBelow`-gated descent adds one more traversal cost per non-layer
  `scripts/` subdirectory (an array scan over the config's `*Dirs`/`overrides` entries),
  scoped to directories `findScriptEntries` would otherwise have collapsed into a single
  entry — bounded by `scripts/` subdirectory count, not file count.
- `findScriptEntries`'s public signature changed (`scriptsDir, config?, log?`), both new
  parameters optional and defaulted, so `computeDomainData`'s existing call and any
  external consumer passing only `scriptsDir` are unaffected.
- Regression coverage: `test/domain/scriptSurfaces.test.ts` pins full cross-surface
  agreement over a synthetic `scripts/` tree exercising every branch above (layer-dir
  recursion, `hasClaimBelow` descent, `ts-defs/` exemption, D's now-shared silence on
  `scripts/shared/data.json`, C's now-shared report of `scripts/other/`).

## Alternatives Considered

**Add a `.json`-suppression rule to `listUncategorized`'s old independent walk**,
targeted narrowly at D, instead of deleting the walk. Rejected: this would have fixed D
in isolation while leaving B and C as separate walk-level bugs to patch again by hand —
reintroducing exactly the "two walks kept in sync manually" structure this decision
removes, and reproducing the "partial alignment reads like a guarantee" objection ADR
0013 raised against the narrower version of this same idea.

**Widen `findScriptEntries` to emit non-script files too**, so `list-uncategorized`
could keep reporting D's case via the shared enumeration without delegation narrowing
it away. Rejected: `findScriptEntries`'s output feeds `computeDomainData`, which has no
representation for a non-script file in `DomainData.scripts` — emitting one there would
either require inventing an index concept for a file the index can never render, or
filtering it back out at the `computeDomainData` call site, reproducing two-walks-worth
of divergence risk one layer down.
