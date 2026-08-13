# ADR 0022: Section-extension provenance split

**Status:** Accepted
**Date:** 2026-08-13
**Issue:** #60 — re-examine `SECTION_SOURCE_EXTENSIONS`/`isSectionSourceName` now that c3source 2.0.0 filters `.json` upstream at all four non-script sections; filed as a consequence of [[0021-decline-drift-diagnostic]]

---

## Context

[[0021-decline-drift-diagnostic]] observed that c3source 2.0.0 unified all
four non-script section finders (`findAllEventSheets`, `findAllLayouts`,
`findAllObjectTypes`, `findAllFamilies`) to filter to `.json` upstream —
answering `GenvidTechnologies/c3source#76` — and that this made
`SECTION_SOURCE_EXTENSIONS`/`isSectionSourceName` (`classification.ts`)
unreachable in practice: nothing non-`.json` ever survives the four
collectors to reach the local filter. It filed #60 to decide whether to
keep, retire, or simplify the local rule, deliberately not resolving that
question in the same record.

**Measured evidence, re-run against the installed `@genvidtech/c3source@2.0.0`
before this record was written** (re-runnable: build a `C3Project` over a
throwaway directory via `openProject`, call `collectSectionFiles` for each of
the four sections, and separately compare the retired local predicate against
upstream's `isSectionItemName` over a fixed basename list):

- **0 drop-branch firings** across a 16-file four-section synthetic covering
  `.json`, `.JSON`, `.txt`, `.png`, `.md`, `.xml`, a directory named
  `nested.json/`, `Main.uistate.json`, `tsconfig.json`, a file under
  `uistate/`, and a file under `ts-defs/`. There is no local drop branch left
  to fire at all — `collectSectionFiles` was reduced to a pure
  relativize-and-map in the same commit that produced this evidence — so this
  restates the corpus-level premise [[0020-section-source-extension-filter]]
  already measured (zero non-`.json` files across the canonical fixture and
  two real domain-foldered projects) directly against today's code, rather
  than re-deriving it.
- **0 predicate disagreements** over 12 basenames (`a.json`, `A.JSON`,
  `a.Json`, `weird.JsOn`, `.json`, `x.json.txt`, `foo.jsonx`, `README`,
  `Main.uistate.json`, `tsconfig.json`, `a.ts`, `nested.json`), comparing the
  retired local rule (`SECTION_SOURCE_EXTENSIONS = [".json"]`,
  `isSectionSourceName(name) = name.endsWith(ext)`) against upstream's
  `isSectionItemName`. They agree on every case, including
  `Main.uistate.json` → `true` for both — extension-hood alone says nothing
  about editor-local provenance, for either predicate.

## Decision

**Split the local section-extension artifact into three pieces, and give
each its own disposition, rather than treating "keep or retire" as one
question:**

| Artifact | Disposition |
|---|---|
| `SECTION_SOURCE_EXTENSIONS` | **Removed**, and deliberately **not** re-exported. Upstream's `C3_SECTION_ITEM_EXTENSION` is a string literal (`".json"`) where the retired local constant was an array (`[".json"] as const`); a bare re-export would change the published shape, and the array shape asserted an extensibility (room for a second admitted extension) that upstream's own audit denies — C3's editor bundle writes every name-section item as exactly one extension. |
| `isSectionSourceName` | **Removed.** Its one live caller, `listInertOverrides`'s class 3 (`src/domain/domainAnalysis.ts`), now imports `isSectionItemName` from `@genvidtech/c3source` directly. |
| `collectSectionFiles`'s drop branch, its `log` line, the `log` parameter, and the `Logger` import | **Removed** — unreachable, not merely redundant: all four `C3Project.findAll*` collectors it wraps already reach `find_all_section_items_path` upstream, so no path can arrive at the drop branch to trigger it. `collectSectionFiles` is now a three-line relativize-and-map. |

Landed in `8500da5`, alongside the removal of the walk-level ORDER guard test
(superseded by a relocated `listInertOverrides` guard that can actually fail)
and retargeting of the collector/stray tests that had asserted the now-gone
log plumbing. **Zero user-visible output change** — `computeDomainData` over
the canonical fixture dumps to the same 4858 bytes before and after (the
`CLAUDE.md`-prescribed neutrality method: a scratchpad dump of
`computeDomainData(fixtureProjectPath(), FIXTURE_CONFIG, () => {})`, diffed
against the pre-change tree — not the CLI, which would need a
`domain-config.json` written into the fixture, mutating the thing being
measured). This is a provenance and legibility change; nothing here fixes a
defect.

## Provenance — two propositions that shared one value

Two propositions were sharing the constant `.json`, and only one of them was
ever this repo's to decide:

| Proposition | Owner |
|---|---|
| "Every C3 name-section item is written to disk as `.json`" | **c3source** — platform fact, AUDITED against C3's editor bundle (`projectResources.js`), corroborated by a project corpus (c3source's `docs/domain-fact-audit.md`) |
| "A file the domain index cannot parse has no index representation, so it is not reportable work" | **this repo** — product policy, and it **stands unchanged** |

The list's *value* was never this tool's to choose: if C3 ever admitted
`.jsonc`, this tool would follow, not diverge. What *is* this tool's
decision — and what this record does not touch — is the rule that a file the
index cannot parse is not worklist material. That rule lives on, just
without a redundant local restatement of the value it filters on.

**The framing "product policy, local by decision" is not [[0020-section-source-extension-filter]]'s own
text.** Grepping that record for "product policy" or "local by decision"
returns zero hits. The phrase originated as a `CLAUDE.md` gloss (and a
matching `classification.ts` docstring, since deleted) summarizing ADR 0020
— and the gloss drifted from the record it was summarizing. ADR 0020's own
Decision section reads:

> **Filter the four non-script section walks to `.json` at the boundary
> where this tool consumes them for parsing — adopting c3source's own
> documented convention, not inventing a new one.**

That is the opposite of "local by decision." ADR 0020 explicitly framed the
`.json` value as upstream's convention, adopted at a local parse boundary
because, at 1.9.0, c3source's own collectors did not yet enforce it
consistently. **This record does not overturn ADR 0020 — it vindicates it,**
and corrects the `CLAUDE.md`/docstring gloss that had drifted from it. That
drift is exactly the kind of decay `CLAUDE.md` documents elsewhere: its
`FILE_TYPES`/`emitsDirectories` sentence cited the wrong reason for a
still-correct value for one release cycle, with nothing to catch it because
the *value* stayed right. Here the *value* (`.json`) also stayed right across
the drift — only the stated *ownership* of that value was wrong, and this
record is the correction.

Upstream's own `C3_SECTION_ITEM_EXTENSION` docstring is explicit about who
owns the policy it encodes: **"AUDITED — C3's own editor bundle saves every
name-section item as `folder + name + \".json\"`"**, and its companion
`isSectionItemName` documents itself as testing "item-hood only" — one of
three separate axes (item-hood, provenance, reachability) upstream now names
explicitly, with provenance and reachability assigned to `isEditorLocalPath`
and `find_all_files_path`'s `descend` parameter respectively. c3source is the
single owner of the name-section item policy; this repo consumes it rather
than restating it.

## The measured absence of divergence, and the script-side contrast

The script side of this same repo keeps a local predicate
(`isScriptSourceName`) deliberately, alongside an upstream equivalent of the
same name — because the two **genuinely diverge**: upstream's version
excludes `.d.ts`, and this tool's version must admit it to keep
[[0013-editor-local-exclusion-list-uncategorized]]'s `ts-defs/` exemption
indexable. That divergence is pinned by a cross-library test in
`test/domain/scriptSurfaces.test.ts` that asserts the two predicates
disagree on `.d.ts`, specifically so a future re-adoption of upstream's
version fails a test instead of silently regressing.

**The section side has no such divergence to protect.** The measured figures
above show the retired local predicate and upstream's `isSectionItemName`
agreeing on every one of 12 tested basenames, including the one case
`.json`-endsWith alone gets wrong for provenance purposes
(`Main.uistate.json`) — and both predicates get it "wrong" identically,
because neither one is the provenance check; that job belongs to
`isEditorLocalPath` in both the retired local rule's contract and upstream's.
So "keep it local" here could not borrow the script side's defence (a real,
tested divergence), and "adopt upstream" cannot be sold as fixing anything —
it is a pure provenance move, changing who states a fact both sides already
agreed on.

**The script-side asymmetry, in the repo's own terms:**
[[0016-authored-script-js-support]] called the script-extension list *"a
platform fact, temporarily local"* — a retire-trigger that fired when
`GenvidTechnologies/c3source#73` closed and [[0021-decline-drift-diagnostic]]
adopted the result. [[0020-section-source-extension-filter]]'s framing made
`GenvidTechnologies/c3source#76` *"a prompt to re-examine the design, not a
deletion trigger"* — a deliberately softer commitment, because at the time
`#76` was still open and its resolution direction unknown. This record is
that re-examination, answered: `#76` resolved in the direction that retires
the local pair, the same way `#73`'s resolution retired
`SCRIPT_SOURCE_EXTENSIONS`.

## Supersedes

- **Superseded:** the `CLAUDE.md`/`classification.ts`-docstring **gloss**
  "product policy, local by decision," as applied to
  `SECTION_SOURCE_EXTENSIONS`/`isSectionSourceName`. This is a correction to
  a summary, not to [[0020-section-source-extension-filter]] itself — that
  record's own Decision text is left standing, see below.
- **Fulfilled, not superseded:** [[0020-section-source-extension-filter]]'s
  prediction, made under `#76`'s three possible resolutions, that *"if
  `findAllLayouts`/`findAllObjectTypes` are narrowed upstream to match
  `findAllEventSheets`/`findAllFamilies`, `isSectionSourceName` becomes a
  harmless no-op at those two sections."* That came true — and, as of 2.0.0,
  at **all four** sections, not only the two named. The prediction was
  right; this record is the action taken once it came true, not a reversal
  of it.
- **Left standing:** the parse-boundary decision itself (filtering `.json`
  still happens, now entirely inside the audited upstream collectors instead
  of one layer downstream); [[0017-script-surface-unification]]'s worklist
  derivation (`list-uncategorized` reports exactly what assigning a file to a
  domain would change); the reconciliation of
  [[0013-editor-local-exclusion-list-uncategorized]] decision #4 that
  [[0020-section-source-extension-filter]] performed; that record's measured
  per-section table (a historical account of the pre-2.0.0 asymmetry, correct
  as a record of that date); and the ordering hazard — now relocated (see
  below) but still true.
- **Amended by fact:** [[0020-section-source-extension-filter]]'s Compromise
  section named **two** mitigations for accepting that a genuinely misfiled
  asset produces no diagnostic: `collectSectionFiles`'s drop-logging, and
  `listInertOverrides`' class 3. The drop-logging is now **removed**, not
  merely dead code kept for its own sake — it had no path left to execute.
  **One** mitigation remains: `listInertOverrides`' class 3, which still
  flags the case where a config `overrides` entry names a file no walk will
  ever produce.

## The ordering hazard, relocated and corrected

Both `8500da5`'s deleted `isSectionSourceName` docstring and the walk-level
test it guarded asserted an ORDERING HAZARD: `Main.uistate.json` ends in
`.json`, so an extension-only rule taken alone would re-admit it, and safety
depended on running downstream of a collector that already applied
`isEditorLocalPath`.

A first draft of the replacement comment at `listInertOverrides`' class 3
carried that same claim forward unmodified, asserting the editor-local check
**must run first** at that call site or `isSectionItemName` would admit the
key. **Falsification during implementation proved that specific claim false
at that call site.** Class 3 only ever *reports* a rejected extension — it
never admits-and-exits — so swapping the two checks still routes a
`.uistate.json` key through to the editor-local check and produces the same
`C3-editor-local artifact` reason either way (verified by moving the check
and re-running the test; it still failed for a different, correct reason:
deleting the check entirely, not merely reordering it).

**What is actually load-bearing is that the editor-local check *exists*, not
that it runs in a particular order relative to class 3.** Delete it (rather
than reorder it) and `isSectionItemName` admits the key on its own, class 3
stays silent because the key now passes admission, and the override key
**vanishes from `listInertOverrides`' output entirely** rather than being
reported with the wrong reason. Measured: deleting the check drops the
`Main.uistate.json` key from the report and fails the relocated ORDER-guard
assertion in `test/domain/domainAnalysis.test.ts`.

**The ordering contract itself is real — but it is a property of the
predicate composition, not of this call site.** Upstream's own
`isSectionItemName` docstring names item-hood, provenance
(`isEditorLocalPath`), and reachability (`find_all_files_path`'s `descend`)
as three separate axes tested by three separate predicates, and
`find_all_section_items_path` composes all three in the correct order
*inside c3source*, ahead of any call site here ever seeing a result. The
walk-level guard test this record's code change deleted is superseded by
that composition, not merely moved — `listInertOverrides`' relocated guard
exists to pin what remains locally load-bearing (a config `overrides` entry
naming a `.uistate.json` file gets the right *reason string*, not a silent
disappearance), not to re-prove an ordering contract that now lives entirely
upstream.

## What is not adopted, and why

Upstream's `C3_SECTION_ITEM_EXTENSION` (the constant) is not re-exported
from `classification.ts`, unlike `SCRIPT_SOURCE_EXTENSIONS` above it in the
same file. The shapes differ: upstream's is a bare string literal
(`".json"`), where the retired local constant was a single-element array
(`[".json"] as const`). A bare re-export under the old name would silently
change the published type from `readonly [".json"]` to `".json"` — a
breaking shape change hiding inside what would otherwise look like a
rename. Nothing in this tool's `src/` code consumed the array shape for its
own sake (no site ever needed to iterate more than one extension), so there
is no local reason to keep an array-shaped wrapper around a single-value
upstream constant. The removal is a clean one: no local re-export of either
form.

## Case sensitivity

Both the retired local predicate and upstream's `isSectionItemName` are
**case-sensitive**, and this behaviour is unchanged by the swap — a
`.JSON` file is rejected by both, pinned by the T3 case-sensitivity
assertion added to `listInertOverrides`' tests ahead of this removal.
Upstream documents this as **deliberate**, but is explicit that it is a
narrower claim than the script side's case-insensitivity: *"C3's
lowercasing-before-testing rule is audited for script extensions but
unverified for `.json`; matching case-insensitively here would silently
widen every name-section finder built on this predicate."* This repo now
inherits that same deliberately-narrower guarantee rather than asserting a
wider one of its own. The T3 test is what would fail, loudly, if a future
c3source release widened `isSectionItemName` to match case-insensitively —
turning a silent behaviour change into a failing test instead of a silent
output change.

## Consequences

- **Public-API removal, riding an already-queued minor bump.**
  `SECTION_SOURCE_EXTENSIONS` and `isSectionSourceName` are removed from
  `src/index.ts`'s re-export of `classification.ts`, and
  `collectSectionFiles`'s optional `log` parameter is dropped from its
  signature. No deprecated alias is provided. This does not by itself force
  a new minor version — [[0021-decline-drift-diagnostic]]'s `isCompiledSibling`
  removal already requires one, and this removal rides that same queued
  bump rather than requiring a second one.
- **Belt-and-suspenders becomes a single alarm, and the alarm is named.**
  Before this change, an upstream widening of the four collectors back to a
  more permissive extension policy would have been silently absorbed by the
  still-present local filter — belt and suspenders. After this change, that
  same event has exactly one place it will be caught:
  `test/domain/sectionSurfaces.test.ts`'s `collectSectionFiles` identity
  assertions and `test/domain/domainAnalysis.test.ts`'s four-section
  agreement coverage, which assert explicit kept-lists rather than bare
  emptiness. A future c3source release that re-admits a non-`.json` file at
  any of the four sections fails one of those tests loudly, rather than
  being silently absorbed by a filter that no longer exists.
- **`editorValidation.ts`'s asymmetry is closed by construction, and
  deliberately not touched here.** `editorValidation.ts` re-walks
  `eventSheets/` independently of `collectSectionFiles`, calling
  `validateForEditor` per sheet — a second walk of the same section, but one
  [[0017-script-surface-unification]] already treats as acceptable precedent
  ("it walks `eventSheets/`, which has no suppression rule to contradict, so
  it re-walks the *same* set"). Nothing about that changes here: this record
  only removes an extension filter, it does not touch which walks exist.
  Recorded so a future reader auditing "which sections have exactly one
  enumeration" does not mistake this record's silence on
  `editorValidation.ts` for an oversight.
- **The #62 mitigation loss.** [[0020-section-source-extension-filter]]'s
  Compromise section named a candidate follow-up: "a dedicated 'stray files'
  diagnostic — a report of files a section collector drops that isn't gated
  on `overrides` the way class 3 is." With the drop-logging removed, that
  candidate's cheapest possible starting point (reading the log stream) no
  longer exists. c3source 2.0.0's `detectStrayFiles` — noted in
  [[0021-decline-drift-diagnostic]]'s Venue section as explicitly scoping
  `scripts/` *out* of its own coverage, which is a different section family
  than the one this record addresses — is the primitive a future #62-shaped
  issue should evaluate for the four non-script sections. Not designed here;
  recorded as the natural starting point for whoever picks that up.
- **`GenvidTechnologies/c3source#76`'s loop is closed.**
  [[0020-section-source-extension-filter]] tracked `#76` as an open upstream
  question this repo's local filter did not need answered to be correct
  under any resolution. c3source 2.0.0 answered it (unifying all four
  finders to filter `.json`), and this record is the local action taken now
  that the answer is in: the question that motivated the local filter's
  continued existence is settled, and the local filter is retired
  accordingly.

## Alternatives Considered

**Keep `SECTION_SOURCE_EXTENSIONS`/`isSectionSourceName` as a permanent
belt-and-suspenders guard, unreachable or not.** Rejected: an untestable
filter decays silently — [[0020-section-source-extension-filter]]'s own
retired docstring said as much ("an unreachable filter cannot be tested, and
an untestable rule decays silently"). Keeping code whose only proof of
correctness is "it can never run" is a worse position than removing it and
trusting a test suite that fails loudly if the upstream guarantee it depends
on is ever narrowed.

**Re-export `C3_SECTION_ITEM_EXTENSION` under the old `SECTION_SOURCE_EXTENSIONS`
name, preserving the published symbol.** Rejected: the array-vs-string shape
mismatch (see "What is not adopted, and why" above) would make the
re-exported symbol type-incompatible with the removed one, so any consumer
code written against the old array shape would still break — the
compatibility this alternative buys is illusory.

**Leave the drop-logging in `collectSectionFiles` even after removing the
filter it logged, on the theory that it is harmless dead code.** Rejected:
`collectSectionFiles`'s new docstring exists specifically to explain why the
function survives at three lines instead of being inlined; a `log`
parameter with nothing left to log would be exactly the kind of loose end
that docstring argues against leaving behind, and it would cost every one of
the function's eight call sites an unused argument to pass or elide.
