# ADR 0020: Filter section files to `.json` at the parse boundary

**Status:** Accepted
**Date:** 2026-08-12
**Issue:** #52 — `generate` can crash on a non-`.json` stray under `layouts/`/`objectTypes/`; related: #57

---

## Context

[[0019-walk-decides-directory-liveness]] recorded, as an explicit non-goal,
whether the four non-script section index collectors are consistent about
filtering non-`.json` extensions, citing
[[0017-script-surface-unification]]'s measured table: `eventSheets/` and
`families/` filter to `.json`, `layouts/` and `objectTypes/` don't. It framed
that inconsistency as blocked on the upstream question
`GenvidTechnologies/c3source#76` (whether the asymmetry is intentional) and
left #52 out of scope.

`GenvidTechnologies/c3source#76` is still open. But the question it asks —
should c3source's four section finders agree on filtering extensions — turns
out not to be the question that decides #52. Installed `@genvidtech/c3source`
1.9.0 has already, independently of #76, settled how a **consumer** of a
permissive finder should behave: every site in c3source's own `dist/` that
reads a `layouts/`/`objectTypes/`-shaped tree filters to `.json` at the point
it parses, not by narrowing the finder. `layouts.js`'s
`visit_layers_in_layouts`/`visit_instances_in_layouts` do
`find_all_layouts_path(...).filter((p) => p.endsWith(".json"))`, each
commented "filter to `.json` here, at the parse boundary, rather than
narrowing `find_all_layouts_path`'s documented contract"; `project.js`'s
`collectAddonAttribution` applies the identical `.filter((p) =>
p.endsWith(".json"))` to `findAllObjectTypes()` before `JSON.parse`, commented
"find_all_objectTypes_path filters only on `!isEditorLocalPath` … Filter to
`.json` here, at the parse boundary, rather than narrowing the finder's
documented contract"; and `references.js`'s `readSourceDocs` docstring states
the rule generally: mirror `find_all_files_path(dir, (f) =>
f.endsWith(".json") && !isEditorLocalPath(f))`, "NOT `find_all_layouts_path` /
`find_all_objectTypes_path` — those filter on `!isEditorLocalPath(file)` alone
with no `.json` check, so a stray non-JSON file under a section directory
would reach `JSON.parse` and crash." This repo's own `computeDomainData` and
`listUncategorized` parse every `layouts/`/`objectTypes/` path
`C3Project.findAllLayouts()`/`findAllObjectTypes()` returns exactly the same
way — and, measured against installed 1.9.0, had **zero** `.endsWith(".json")`
guards anywhere in `src/` doing it (a positive control confirms the search
itself works: `dist/project.js` alone has 5 such hits). A stray non-`.json`
file sitting in a claimed `layoutDirs`/`objectTypeDirs` directory reached
`JSON.parse` unguarded and crashed `generate`. Reproduced by watching it fail:
with the fix stashed, `does not crash on a non-.json stray in a claimed
layoutDirs/objectTypeDirs directory` (`domainGenerator.test.ts`) fails with
`SyntaxError: Unexpected token 'o'`.

Corpus impact of adopting the filter is zero: no non-`.json` file exists under
any of the four section directories in the canonical fixture, in a large
domain-foldered reference project (2,249 files across the four sections,
including 1,673 object types), or in a smaller domain-foldered project (115
files). The filter costs nothing observed and prevents a real crash.

### Decision #4 of [[0013-editor-local-exclusion-list-uncategorized]], reconciled

ADR 0013's decision #4 made two claims, and
[[0017-script-surface-unification]] (`:89-99`) narrowed only one of them
without saying so:

- **The rule** — "no new extension filter is introduced," scoping that fix to
  editor-local artifacts, not extensions.
- **The illustration** — "a stray non-`.json` file sitting in an unclaimed
  `eventSheets/` directory remains a legitimate 'unmapped file here' signal."

ADR 0017 said the illustration "is still true today," a statement of what
*happens*, while shipping the definition that now governs it: "a path is
reportable exactly when assigning it to a domain would change what the
generated index contains." Under that definition a non-`.json` file under an
*unclaimed* section directory is not reportable either — assigning it to a
domain cannot change the index, because no section collector will ever emit
it. ADR 0017 never reconciled the two; that unreconciled deferral is this
issue.

**This decision supersedes decision #4's rule, for the four sections ADR 0017
narrowed it to, and retires its illustration.** This is a new extension
filter reaching `list-uncategorized`'s user-visible output, not merely an
internal parse guard — say so plainly rather than softening it. Decision #4
was a scoping clause on a defect fix (issue #33 was about editor-local
artifacts; #4 said "don't also touch extensions while you're in here") that
carried an illustrative desirability claim alongside it. ADR 0017's later,
more general worklist definition falsifies that claim on its own terms; #4's
rule was correctly scoped to its own issue and is honoured by not having been
touched until a definition existed that required revisiting it.

## Decision

**Filter the four non-script section walks to `.json` at the boundary where
this tool consumes them for parsing — adopting c3source's own documented
convention, not inventing a new one.**

`SECTION_SOURCE_EXTENSIONS` / `isSectionSourceName` (`classification.ts`)
name the rule; `collectSectionFiles(project, fileType, rootDir, log)` applies
it: it calls the matching `SECTION_COLLECTORS[fileType]` (`findAllEventSheets`
/ `findAllLayouts` / `findAllObjectTypes` / `findAllFamilies`), relativizes
each path, and drops anything `isSectionSourceName` rejects, logging every
drop by relative path. `computeDomainData` and `listUncategorized` both
delegate their four section walks to it, so the filter and the crash fix are
the same change, not two.

`list-uncategorized`'s narrowing is not a second decision layered on top —
it is what [[0017-script-surface-unification]]'s derivative worklist
definition does to this one automatically. If the generated index can only
ever contain a file its collector parses, then a `.json`-rejected file cannot
change what the index contains, and `list-uncategorized`, defined
derivatively from the index, stops reporting it for exactly that reason.

### This does not wait on `GenvidTechnologies/c3source#76`

`GenvidTechnologies/c3source#76` asks whether c3source's per-section
extension-filtering asymmetry (`findAllEventSheets`/`findAllFamilies` filter
to `.json`; `findAllLayouts`/`findAllObjectTypes` don't) is intentional. It
remains open, and this decision does not resolve it — nor does it need to,
because the decision is correct under every possible resolution:

- If the four finders stay as they are, the local filter is exactly what
  prevents the crash — the state observed today.
- If `findAllLayouts`/`findAllObjectTypes` are narrowed upstream to match
  `findAllEventSheets`/`findAllFamilies`, `isSectionSourceName` becomes a
  harmless no-op at those two sections — everything the walk yields already
  passes it.
- If `findAllEventSheets`/`findAllFamilies` are instead widened upstream to
  match the permissive two, the local filter is the only thing left holding
  the line against the same crash reappearing at `eventSheets/`/`families/`.

`#76`'s answer changes which of these three states is current; it changes
nothing about whether this repo should filter at its own parse boundary in
the meantime. `#76` stays open and unrelated to this record's closure.

**Measured per-section table.** Verified against installed
`@genvidtech/c3source@1.9.0`; "D fires?" names
[[0017-script-surface-unification]]'s divergence D (an index collector that
filters extensions while `classifyFile`'s corresponding walk did not) —
before this change, D could only *fire* (produce a spurious
`list-uncategorized` report) at the two sections whose collector already
filtered, and could only *crash* `generate` at the two that didn't:

| Section | Collector | Filters `.json` upstream? | D fired (before)? | Could crash `generate` (before)? |
|---|---|---|---|---|
| `eventSheets/` | `findAllEventSheets` | yes | **yes** | no |
| `layouts/` | `findAllLayouts` | no | no | **yes** |
| `objectTypes/` | `findAllObjectTypes` | no | no | **yes** |
| `families/` | `findAllFamilies` | yes | **yes** | no |

After this change, all four columns collapse to the same answer at every
section: the local `.json` filter now runs downstream of every collector, so
D cannot fire anywhere (a non-`.json` stray is dropped before
`list-uncategorized` sees it) and none can crash `generate` (dropped before
`JSON.parse`).

The sharpest fact in the table is the inverse relationship it shows in the
"before" state: the two sections where D fired (`eventSheets/`, `families/`)
are exactly the two that were already parse-safe, and the two sections that
could crash (`layouts/`, `objectTypes/`) are exactly the two where D never
had the chance to fire. One upstream asymmetry, two opposite-facing local
symptoms.

## Consequences

- **Two tests are inverted, a documented behaviour change, not a silent
  one.** `list-uncategorized`'s `R-D2` case (`domainAnalysis.test.ts`) is
  renamed from "the four non-script section walks still report a stray file
  individually" to "… admit only `.json` section source, dropping a
  non-`.json` stray beside it," and now asserts the four sections drop their
  stray while still reporting the `.json` positive control beside it.
  `listInertOverrides`' `AC5` case is renamed from "does not report a
  non-script-extension file under one of the other four sections" to
  "reports a non-section-source-extension file under one of the other four
  sections" — class 3 (`isSectionSourceName`) is no longer `scripts/`-only;
  every section now dispatches to its own admission rule (authored-script
  source for `scripts/`, section source for the other four), so an override
  on a non-`.json` file under `eventSheets/`/`layouts/`/`objectTypes/`/
  `families/` is now flagged inert the same way a non-authored-script
  override already was under `scripts/`.
- **Behaviour also changes at `layouts/`/`objectTypes/`**, not only at the
  two sections named in the issue title — `computeDomainData`'s
  `unclassified` list narrows there too: a non-`.json` stray under an
  unclaimed `layouts/`/`objectTypes/` directory used to land in
  `unclassified`, and now is silently dropped before classification is
  attempted, the same narrowing decision #4 accepted at `eventSheets/`.
- A guard test pins filter **order**, not just the extension check in
  isolation: `Main.uistate.json` ends in `.json`, so `isSectionSourceName`
  taken alone would re-admit it. Safety depends on `collectSectionFiles`
  running downstream of a `C3Project` collector that already applied
  `isEditorLocalPath` — pinned by `guards the section-source filter ORDER,
  not just uistate exclusion` (`domainAnalysis.test.ts`).
- [[0019-walk-decides-directory-liveness]] (`:124-131`) said #52 "is blocked
  on the upstream question `GenvidTechnologies/c3source#76` … and stays out
  of scope here." **That framing is superseded — #52 is not blocked on
  `#76`,** for the reason above. ADR 0019 itself is not edited: an accepted
  ADR records the state faced at its date, the same precedent
  [[0017-script-surface-unification]] sets for ADR 0013's own superseded
  deferral note. Two accepted records must not sit in silent contradiction,
  so this one names the supersession directly instead of leaving a reader to
  notice the gap.
- Related: issue #57, filed for the `layouts/`/`objectTypes/` parse crash
  specifically, so the crash has its own searchable record independent of
  #52's broader extension-consistency question. Both are closed by this PR.

## Compromise — a genuinely misfiled asset now produces no diagnostic

A stray non-`.json` file dropped directly in a section directory (an
accidentally-committed `.png` in `objectTypes/`, a stray `.txt` in
`layouts/`) now produces no diagnostic anywhere in this tool — neither
`list-uncategorized` nor `generate`'s `unclassified` list will ever mention
it, because `collectSectionFiles` drops it before either surface sees it.

This is the **second** time this repo accepts that exact cost.
[[0017-script-surface-unification]] (`:172-176`) accepted it first, for
`scripts/`: a non-script file under an allowlisted `scripts/` subdirectory
also produces no diagnostic, for the identically-shaped reason (nothing
downstream can represent it, so reporting it would set up the same
dead-override hazard ADR 0013 and ADR 0016 both already document).

Two mitigations exist now that did not when ADR 0017 accepted the cost the
first time: `collectSectionFiles` logs every dropped file, by relative path,
through its `log` callback — silent to the CLI/MCP output but visible to
anyone running with logging enabled — and `listInertOverrides`' class 3
(generalized by this change to all five sections) flags the case where a
config `overrides` entry names the dropped file directly, so an operator who
already tried to map it gets told the entry is inert rather than being left
to wonder why the file never appears in the index.

Accepting this cost a second time, on a different section family, is itself
a signal: a dedicated "stray files" diagnostic — a report of files a section
collector drops that isn't gated on `overrides` the way class 3 is — may be
worth its own issue at some point. Recorded here as a candidate, not
designed here.

## Alternatives Considered

**Wait for `GenvidTechnologies/c3source#76` to resolve before changing
anything.** Rejected: the crash is a defect today, `#76` asks a question
about c3source's *finder* design that this decision does not need answered,
and the "correct under every resolution" analysis above shows waiting buys
nothing — the parse-boundary filter is right regardless of how `#76`
resolves.

**Ask c3source to narrow `findAllLayouts`/`findAllObjectTypes` to `.json`
upstream, instead of filtering locally.** Rejected as the immediate fix: it
would leave this tool crashing on every currently-installed `^1.9.0` until a
new c3source release ships and this repo bumps its floor to it — an
unnecessary wait for a one-line local guard that is also what c3source's own
`dist/` code already does at every comparable site. Nothing here forecloses
filing that upstream request separately; `#76` already tracks the underlying
question.

**Scope the filter to `layouts/`/`objectTypes/` only**, leaving
`eventSheets/`/`families/`'s existing upstream `.json` filter as the sole
guard there and not touching `list-uncategorized`'s reporting at those two
sections. Rejected: it would fix the crash but leave decision #4's
illustration standing exactly where ADR 0017 left it — silently
contradicted by ADR 0017's own worklist definition — reproducing the
unreconciled state this record exists to close, just at two sections instead
of four.
