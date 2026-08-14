# ADR 0023: Decline a stray-file diagnostic

**Status:** Accepted
**Date:** 2026-08-13
**Issue:** #62 — decide whether to report stray files in C3 section directories, using c3source 2.0.0's `detectStrayFiles`; the candidate was first recorded in [[0020-section-source-extension-filter]] and re-noted in [[0022-section-extension-provenance]]

---

## Context

A **stray file** is a file under a C3 name-section root that is neither a
section item nor an editor-local artifact — an `eventSheets/notes.md`, an
`objectTypes/tiles/palette.png`, a `layouts/Level1.dsl.txt`.

This repo has now recorded the same candidate twice without designing it:

- [[0020-section-source-extension-filter]]'s Compromise section accepted, for
  the second time, that a file no section collector can represent produces no
  diagnostic — and named the follow-up: *"a dedicated 'stray files' diagnostic
  — a report of files a section collector drops that isn't gated on
  `overrides` the way class 3 is — may be worth its own issue at some point.
  Recorded here as a candidate, not designed here."* At that point **two**
  mitigations existed: `collectSectionFiles` logged every dropped file through
  its `log` callback, and `listInertOverrides`' class 3 flagged a config
  `overrides` entry naming a dropped file.
- [[0022-section-extension-provenance]] retired the local extension filter to
  c3source's audited `isSectionItemName`, which removed the drop branch and
  with it the drop logging — leaving **one** mitigation. That record named
  `detectStrayFiles` as *"the primitive a future #62-shaped issue should
  evaluate for the four non-script sections."*

Issue #62 is that evaluation. It is a decision issue, not a build issue: the
primitive exists, the floor is already `^2.0.0`, and nothing needs bumping.

### What upstream ships

`detectStrayFiles(projectDir: string): StrayFile[]` (c3source 2.0.0) is both a
free function and a `C3Project` method. Read from the packed
`dist/manifest.js` and `dist/manifest.d.ts` of the installed
`@genvidtech/c3source@2.0.0`:

- **Manifest-independent and handle-free.** It reads no `project.c3proj`,
  takes none, and needs no open project handle.
- `StrayFile = { section, folder, name, diskPath }`. It carries **no**
  `manifestPath`, and upstream's own doc calls that absence *"load-bearing,
  not an oversight"*: a stray has no manifest position and can never acquire
  one, so it is *"surfaced so a misfiled file is visible at all, never as a
  worklist item."*
- **Editor-local filtering is internal, on both axes** — the file predicate is
  `(f) => !isSectionItemName(f) && !isEditorLocalPath(f)`, and
  `find_all_files_path`'s default descent guard prunes `uistate/` and
  `ts-defs/` *directories*. Confirmed with a synthetic probe: `.uistate.json`,
  `uistate/` contents, `tsconfig.json` and `ts-defs/*.d.ts` are all absent
  from the output.
- **It owns its own `existsSync`** — a missing section directory is skipped,
  not reported, and does not throw. It is not blanket-safe, though: upstream
  documents that a filesystem failure inside `find_all_files_path` *will*
  propagate, and forbids wrapping the call in a `try`/`catch` that would hide
  it.
- Scope is `C3_SECTION_FOLDERS`, **seven** sections: `layouts`, `eventSheets`,
  `objectTypes`, `timelines`, `flowcharts`, `families`, `models3d`.
  `scripts/` is explicitly out of scope in upstream's own doc comment.
- Upstream describes it as *"The exact complement of
  `find_all_section_items_path` over the same walk: … the two functions'
  results are disjoint and their union is every non-editor-local file in that
  directory."*

### What is silent here today

- A stray in any of the four sections this tool models (`eventSheets/`,
  `layouts/`, `objectTypes/`, `families/`) is reported by **nothing**: it is
  absent from `collectSectionFiles`, from `listUncategorized`, and from
  `computeDomainData`'s `unclassified`.
- **A misfiled `.json` is already visible.** It is admitted by
  `collectSectionFiles` and reported by `listUncategorized`
  (`src/domain/domainAnalysis.ts:50-55`). So the genuinely silent set is only
  files that are **non-`.json` and non-editor-local** — narrower than "every
  file the collectors drop."
- `listInertOverrides`' class 3 (`src/domain/domainAnalysis.ts:241-278`) fires
  on a stray **only** when the operator already named it in `overrides`
  ([[0018-inert-override-detection]]).
- `grep -rni "timeline\|flowchart\|models3d" src/` returns **zero hits**.
  Those three of upstream's seven sections are never opened here at all — not
  only their strays but their *items* are invisible.

## Decision

**No stray-file diagnostic is built.** No new `src/domain/` module, no CLI
subcommand, no MCP tool, no README table change, no `gvt-construct3`
allow-list update. `detectStrayFiles`/`StrayFile` stay unadopted, and are
recorded in `CLAUDE.md`'s deferred-surface list as evaluated and declined.

The decline is grounded in measurement plus two category arguments, applied
per scope bucket below.

### Evidence

**Corpus** — 17 real Construct 3 projects, discovery anchored on
`project.c3proj` (anchoring on the marker file matters: a project's own
`extracted/` output tree shadows every section name and would silently fake
the result). For scale, [[0021-decline-drift-diagnostic]]'s scan of the
locally available projects, under the same anchoring, reached 15. The corpus is
machine-local and moves, so the figures below are a dated measurement, not a
constant — re-scan rather than citing them.

- **4,717** files under the seven name-section roots
- **4,403** admitted `.json` section items
- **314** editor-local artifacts, correctly excluded
- **0 genuine strays**, across all 17 projects and all seven sections
- **Positive control passed**: a synthetic project seeded with stray files
  returned them correctly, so the zeros measure the corpus, not a broken
  harness.

The residual sits entirely under `scripts/`, which the primitive does not
cover: **15** files invisible to this tool's surfaces — **9** `tsconfig.json`
(editor-local by design, [[0013-editor-local-exclusion-list-uncategorized]]),
**5** compiled `.js` siblings (the same pairs, same filenames, same two
projects already declined in [[0021-decline-drift-diagnostic]]), and **1**
`.gitkeep`. The net genuine stray population anywhere in the corpus is
**one `.gitkeep`**, under a section the primitive does not walk.

**Canonical fixture** — preferred over corpus figures wherever either would
do, because it is reproducible from the pinned `construct3-sample` `v1.0.0`
submodule tag: `timelines/` holds **4** items *counted recursively* (a
top-level listing shows only 3 entries; the fourth sits a level deeper, under
`transitions/Others/`), `flowcharts/` holds **1**, `models3d/` is absent,
`tilemapBrushes/objectTypes/tiles/Tilemap.brush.json` is present, and there
are **0** strays.

### Scope dispositions

Four buckets, each disposed of explicitly. The four are not declined for the
same reason, and collapsing them into one "no strays found" would lose that.

#### A — `eventSheets/`, `layouts/`, `objectTypes/`, `families/`

The four sections this tool models. Strays here are invisible, and
`detectStrayFiles` covers them exactly. **Declined on frequency and on
category:**

- *Frequency*: n = 0 across 17 projects and the fixture.
- *Category*: a stray is **unmappable by construction**. Upstream reaches
  that by manifest position — a name section keys its items on
  `<name>.json`, so a stray has none to acquire.
  [[0020-section-source-extension-filter]] reached the same conclusion by a
  different route: nothing downstream can represent the file, so no
  `overrides` entry could usefully change anything. Two arguments, one
  answer — do not read either as the other's.
  The operator's response to a reported stray is
  `git rm` or "move it somewhere else", never a `domain-config.json` edit.
  That puts it outside the definition [[0017-script-surface-unification]]
  gave `list-uncategorized` — a path is reportable exactly when assigning it
  to a domain would change what the index contains — so it could not join the
  existing worklist surface anyway; it would need its own.

#### B — `timelines/`, `flowcharts/`, `models3d/`

Three of upstream's seven that this tool never opens. Their strays *and* their
items are invisible, and no classification dimension exists for them.
**Declined on coherence:** reporting a stray `.md` in `timelines/` while the
tool cannot classify the fixture's 4 real timeline items would be a
diagnostic that reports only the noise in a section it otherwise ignores. The
report would be strictly misleading about the tool's coverage of that section.

Fixing that properly is a much larger project — a `timelineDirs` /
`flowchartDirs` classification dimension in the
[[0010-per-domain-addon-attribution]] shape (schema, classification,
`FILE_TYPES` row, enumeration, index rendering, both surfaces), justified by
demand for classifying those sections, not by stray reporting. Stray
reporting for B is downstream of that work, not a substitute for it.

#### C — `scripts/`

A partial gap, and the only bucket where the corpus holds anything at all.
Out of scope for the primitive: upstream scopes `scripts/` out in
`detectStrayFiles`' own doc comment, deliberately and in the same release,
because file-folder membership there is extension-agnostic — there is no
item-hood rule for a stray to violate. The local boundary is already recorded
by [[0021-decline-drift-diagnostic]] (`:101-103`), which noted exactly this
upstream scoping. The residual measured above (9 `tsconfig.json`, 5 compiled
siblings, 1 `.gitkeep`) is already dispositioned by
[[0013-editor-local-exclusion-list-uncategorized]] and
[[0021-decline-drift-diagnostic]]; only the `.gitkeep` is new, and it is one
file across 17 projects.

#### D — `tilemapBrushes/`

A real on-disk section present in the canonical fixture
(`tilemapBrushes/objectTypes/tiles/Tilemap.brush.json`) that appears in
**neither** this tool's four sections **nor** upstream's seven. Out of scope
here, and recorded rather than left implicit — an unexplained gap between two
enumerations is exactly the kind of thing that resurfaces as a surprise.

**Named open upstream question:** is `tilemapBrushes/` a name section
c3source intends to model (its contents are `.json`, nested under an
`objectTypes/` sub-tree, which is a different shape from the seven), or is it
deliberately outside `C3_SECTION_FOLDERS`? Filing that upstream is optional
and is **not** part of this work; a `tilemapBrushes` answer changes nothing
here while buckets A and B stand declined.

**Why `tilemapBrushes/` alone gets a bucket, and the fixture's other root
directories do not.** The canonical fixture also holds `addons/`, `icons/`
and `images/`, which likewise appear in neither enumeration — but unlike
`tilemapBrushes/`, upstream has already *explained* their absence rather than
merely omitted them: `rootFileFolders` categories are out of scope because
*"file-folder membership is extension-agnostic by design — there is no
item-hood rule for a stray to violate there"* (the same reason as bucket C),
and `images/` because it is *"a flat asset folder, not a name section, at
all."* An explained absence is not a gap. `tilemapBrushes/` is the only one
upstream's doc comment does not account for, which is precisely what makes it
worth recording.

## Compromise

**What was rejected.** The alternative was building the diagnostic — a small
`src/domain/` module wrapping `detectStrayFiles`, a CLI subcommand, a
`READ_ONLY` MCP tool (which also obliges a cross-repo allow-list update in
the `gvt-construct3` plugin), README tables, and a permanent claim-scope
obligation. Priced against n = 0 in the corpus and an operator action that is
never a config edit, that is a standing maintenance cost for a report that
would be empty in every project measured.

A narrower alternative — folding strays into `list-uncategorized` rather than
adding a surface — was rejected on the definition, not the cost:
[[0017-script-surface-unification]] defines that command derivatively as the
domain index's worklist, and a stray can never become index content. Adding
it would re-open exactly the surface divergence ADR 0017 exists to close.

**The accepted cost, stated plainly.** This decline does **not** restore the
drop-logging that [[0020-section-source-extension-filter]] counted as one of
two mitigations; [[0022-section-extension-provenance]] removed it and this
record does not bring it back. `listInertOverrides`' class 3 is now the
**only** mitigation, and it fires only when the operator has already named
the path in `overrides` — that is, only for someone who already suspected the
file was being ignored. An operator who has never thought about the file gets
nothing. That is a real reduction in coverage between ADR 0020's state and
today's, and it is accepted here rather than argued away.

**Both prior candidate notes are resolved by this record.**
[[0020-section-source-extension-filter]]'s "may be worth its own issue at
some point" and [[0022-section-extension-provenance]]'s "the primitive a
future #62-shaped issue should evaluate" are answered: evaluated, declined.
Neither record is edited — an accepted ADR records the state faced at its
date, not the state as later revised. That precedent was set by
[[0016-authored-script-js-support]] for itself and applied by
[[0021-decline-drift-diagnostic]] (`:138-143`), which left ADR 0016
untouched on exactly this reasoning. Resolution lives here, in
`docs/TOC.md`, and in the two pointers
this record's issue wired into `CLAUDE.md` and `docs/domain-architecture.md`.

## Consequences

- `detectStrayFiles`/`StrayFile` join `CLAUDE.md`'s c3source deferred-surface
  list as **evaluated and declined**, distinct from the entries deferred
  merely for lack of an integration site — the integration site exists here;
  the value does not.
- The silence documented in `docs/domain-architecture.md`'s stray-file
  paragraph is now marked as **decided**, not overlooked. That paragraph is
  the reading path that would otherwise produce a fourth raising of this
  candidate.
- No behaviour, dependency, test, or public API changes. The floor stays
  `^2.0.0`; no MCP tool surface changes, so no `gvt-construct3` allow-list
  issue is owed.
- `scripts/`'s residual stays where [[0021-decline-drift-diagnostic]] and
  [[0013-editor-local-exclusion-list-uncategorized]] already put it.

## If this is revisited

**This is a judgement about value and coherence, not about feasibility.** The
implementation is easy, and a revival should not spend time re-establishing
that:

- `detectStrayFiles` needs **no open project handle**, **no manifest read**,
  **no config**, and **no `existsSync` guard** (it owns one) — neither of the
  two obligations that had to stay local at every `find_all_files_path` call
  site before ADR 0020 applies here.
- It applies `isEditorLocalPath` **internally on both axes** (file predicate
  and directory descent), so a caller does not repeat the segment-walking
  contract that [[0018-inert-override-detection]] documents for
  `listInertOverrides`.
- It is the **exact complement** of the item walk the four modelled sections
  already use — disjoint by construction, never a contradicting view of the
  same set. It does traverse those directories a second time, but on the
  reasoning [[0022-section-extension-provenance]] recorded for
  `editorValidation.ts`'s independent `eventSheets/` re-walk, a second walk
  with no suppression rule to contradict is acceptable precedent; the failure
  [[0017-script-surface-unification]] exists to close (two walks disagreeing
  about one set) does not arise.
- A revival is therefore roughly: one small `src/domain/` module, its
  `export *` line in `src/index.ts`, a CLI subcommand, a `READ_ONLY` MCP tool
  plus the cross-repo allow-list update, and tests. Days, not weeks.

### Re-raise triggers

The candidate has now been raised three times ([[0020-section-source-extension-filter]]
→ [[0022-section-extension-provenance]] → #62). A bare "declined" invites a
fourth, so the conditions that would make it worth building are named here
and are objectively checkable:

1. **A classification dimension ships for any of `timelines/`,
   `flowcharts/`, `models3d/`** (a `timelineDirs`/`flowchartDirs`-style
   config key reaching `FILE_TYPES` and the index). Bucket B's coherence
   objection dies at that moment, and only bucket A's frequency argument
   remains.
2. **A corpus re-scan returns non-zero.** Re-run stray detection across the
   available projects, anchored on `project.c3proj`; any genuine stray in the
   seven sections falsifies the n = 0 premise. Re-measure rather than citing
   the figures above — the corpus moves.
3. **Upstream extends `detectStrayFiles`' scope** to `scripts/` or to
   `tilemapBrushes/`, or answers bucket D's open question by adding a section
   to `C3_SECTION_FOLDERS`. Check the packed `dist/manifest.d.ts` on any
   c3source bump; the current scope is the seven sections listed above.
4. **A real operator report** of a file silently ignored under one of the
   four modelled sections. Note that a misfiled `.json` is *already* reported
   by `listUncategorized`, so a report of that shape is not this trigger —
   only a non-`.json`, non-editor-local file is.

Absent one of those, the answer stays no, and this record is the citation.
