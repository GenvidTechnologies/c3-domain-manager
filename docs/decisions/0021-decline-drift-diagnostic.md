# ADR 0021: Decline a compiled-output drift diagnostic

**Status:** Accepted
**Date:** 2026-08-12
**Issue:** #48

---

## Context

ADR 0016's compromise section named a real defect: an r39700 compile-in-place
project's `scripts/` folder ships a hand-edited `.js` alongside a `.ts`
sibling whose content could not have produced it. Clause 1's compiled-sibling
suppression (`isCompiledSibling`, since retired — see Supersedes) drops the
file from both enumerating surfaces, on the grounds that a file `tsc` is
about to overwrite is worse to advise mapping than to say nothing about.
That ADR filed the correct remedy as issue #48: a diagnostic that flags
content drift between a `.ts` and its `.js` — orphaned from what compiling
the `.ts` would actually produce — rather than silently dropping the pair.

Issue #48 was scoped as a spike: measure candidate mechanisms against a
wider corpus than ADR 0016's single witness project, and decide whether to
build.

## Decision

**No drift diagnostic is built, here or upstream.** All three candidate
mechanisms were measured against a widened corpus and rejected.

**Drift definition D1** (the one this record adopts): drift = the `.js`
carries authored content that no compilation of its `.ts` sibling could
produce — content a `tsc` run would destroy. A byte-identical copy is *not*
drift under D1: nothing is lost by regenerating it. **D2** (the rejected
alternative): drift = the `.js` is not literal `tsc` output. D2 is
attractive because it's mechanical, but it flags reformatting noise as
drift — see the `tsc`-diff row below, where D2 collapses to "flags exactly
what `tsc` would rewrite," which is circular: it is not a definition of
drift, it restates the mechanism.

### Corpus

15 local C3 projects, each anchored on its own `project.c3proj` (anchoring
on the marker file matters — a corpus project's own `extracted/` output
tree shadows every section name and silently fakes results); 9 have
`scripts/`.

- 140 authored `.ts`, 5 `.js`, **5 sibling pairs across 2 projects**, **0
  orphan `.js` at any depth**.
- Issue #48 assumed "3 pairs in 1 project" (ADR 0016's corpus). A second
  project with pairs exists — an r40702 addon sample — so the population is
  wider than the issue knew.
- The r40702 pairs are **byte-identical** copies of their `.ts` (md5 match),
  **tracked in git, not gitignored**. ADR 0016's "the file is gitignored"
  defence of clause 1 does **not** generalize to this project.
- The witness (the r39700 compile-in-place project ADR 0016 already named —
  its `scripts/tsconfig.json` sets no `outDir`, so `tsc` would emit in
  place) ships a 12-line `importsForEvents.js` exporting `makeUUID()` and
  `shouldDoAutoLogin()` that appear in no `.ts`. Its `.ts` sibling holds
  only a comment header and one import.
- **The witness is unreachable outside a working tree:** a fresh clone of
  that project contains no `.js` under `scripts/` at all (`/scripts/*.js`
  is gitignored).
- **Its symbols have no call site** in any event sheet at HEAD, and
  `git log -S` finds them nowhere in that project's history. The drifted
  content is dead code even in the working tree — though it did reach a
  generated HTML5 export at some point.

### Mechanism results, under D1

| mechanism | flags | D1 precision / recall | D2 |
|---|---|---|---|
| exported-symbol comparison | 1 | **1.00 / 1.00** (1 TP, 0 FP) | P 1.00, R 0.33 |
| run `tsc` and diff | 3 | **0.33** (2 FP, formatting-only: tabs vs spaces, blank-line collapse, `async runtime =>` reparenthesized) | P 1.00, R 1.00 — circular, it *is* the definition |
| timestamps (working tree) | 5 | **0.20** | P 0.60 |
| timestamps (fresh clone) | 0 | **recall 0.00** — git does not preserve mtimes; `.js` sorts first on checkout | 0.00 |

Two operational costs the issue never priced: the witness project's own
`tsc` configuration emits **in place** (no `outDir`), which would have this
tool write a `.js` into the project it analyzes — and this tool has never
written a C3 source file (see the `CLAUDE.md` deferral note on the c3source
manifest-write surface). And `tsc` errors without C3's `ts-defs/` typings
on hand, which this repo does not vendor.

**Honest limit — do not overclaim on revival.** Exported-symbol
comparison's recall of 1.00 rests on **n = 1 true positive**. It cannot
detect a hand-edit *inside* an existing function body (only a whole added
or removed export), and the corpus contains no such instance to test
against — so its recall is **unmeasured**, not measured-perfect. A future
revival must not cite "100% recall" without that qualifier.

## Venue

Neither here nor upstream. Grounded in shape, not category:

- c3source has **no JS/TS parsing capability at any version** — its sole
  runtime dependency is `fflate`.
- The `detectReferenceIntegrity` family issue #48 nominated as the natural
  neighbour is entirely **JSON cross-reference** work over `SourceDoc<T>`;
  `ReferenceIssueKind` is unchanged in 2.0.0. Nothing in it reads a `.ts` or
  `.js` byte.
- 2.0.0's brand-new **`detectStrayFiles`** explicitly scopes `scripts/`
  **out**, in its own doc comment — upstream drew this boundary
  deliberately, in the very release under discussion.
- Building it here was priced and rejected: a new public `src/domain/`
  module, a CLI subcommand, a `READ_ONLY` MCP tool (which also obliges a
  cross-repo allow-list update in the `gvt-construct3` plugin), three
  README tables, and a permanent claim-scope obligation — for a strictly
  narrower answer than an existing upstream primitive already gives (next
  paragraph).

**The better-targeted primitive, worth recording for a future reader:**
c3source's `detectManifestDrift` (available since 1.9.0, still unadopted
here) covers `rootFileFolders.script`. Run against the witness's fresh
clone it reports `missing: importsForEvents.js, main.js, YouTube.js` — the
manifest declares three gitignored files, so a clean clone cannot be opened
in that C3 release. That is the *actionable* defect in the witness
project, reached with no new mechanism invented.

## Supersedes

[[0016-authored-script-js-support]] decision #4 made two claims. They
resolve **oppositely**, and dropping the whole decision loses the fulfilled
half:

- **Superseded:** *"`isCompiledSibling` is **permanently** local regardless
  of the c3source bump outcome — 'is this `.js` worth mapping into a
  domain' is this tool's policy, not a platform fact."* This is now false.
  c3source 2.0.0's `isGeneratedScriptOutput` documents the rule as *"C3's
  own rule, not a heuristic"* — C3 only auto-adopts a `.js` into the
  `script`/`general` folders when no same-basename `.ts` sits alongside it
  — and states that c3source issue #73's "Note on scope" mischaracterized
  it as consumer policy. Adopted in #48; the local predicate is removed.
- **Fulfilled, not superseded:** *"`SCRIPT_SOURCE_EXTENSIONS` is a platform
  fact, temporarily local… re-check on the next c3source bump."* That is
  exactly what happened. The trigger fired, the constant is now
  upstream-sourced. The prediction came true; it was not overturned.

`docs/decisions/0016-authored-script-js-support.md` is left unedited — an
accepted ADR records the state faced at its date, not the state as later
revised. That is the precedent ADR 0016 set for itself, when it left the
stale `collectRootTsFiles` references in
[[0008-adopt-openproject-option-a]] and
[[0013-editor-local-exclusion-list-uncategorized]] as-is after renaming it.

## Compromise

The alternative to declining was building the exported-symbol comparator —
the only mechanism that scored well under D1. Rejected anyway: n = 1 true
positive is not enough evidence to commit a permanent claim-scope
obligation (a new module, CLI surface, MCP tool, and cross-repo allow-list
entry) against, especially once `detectManifestDrift` already surfaces the
one actionable defect in the corpus with zero new code. Timestamp-based
detection was rejected outright — it depends on mtimes git does not
preserve, so it silently degrades to recall 0 on any fresh clone, which is
exactly how this tool is normally run. Running `tsc` and diffing was
rejected as circular under D2 and noisy (2 of 3 flags formatting-only)
under D1, plus the two operational costs above (in-place emission risk,
missing `ts-defs/` typings).

## Consequences

- **Issue #49** (`overrides`-aware un-suppression for a hand-edited `.js`)
  closes as **not-planned**, on the *second* clause of its Acceptance
  Criterion 1: a real drift case does exist (the witness project), but
  nobody wants it mapped — it has no call site, is gitignored, is absent
  from a fresh clone, and its project is not domain-mapped at all. Do not
  record this as "no real drift case exists"; that premise is false. The
  case exists and is simply not worth building for.
- **Issue #60** is filed: `SECTION_SOURCE_EXTENSIONS`
  (`src/domain/classification.ts`) is now unreachable in practice, because
  c3source 2.0.0 unified all four section finders to filter `.json`
  upstream (answering `GenvidTechnologies/c3source#76`), so nothing
  non-`.json` ever survives to reach the local filter. #60 is the
  re-examination of whether to keep, retire, or simplify that rule — not
  resolved by this record.
- No new `src/domain/` module, CLI subcommand, or MCP tool is added; no
  README table changes; no `gvt-construct3` allow-list update is needed.

## If this is revisited

Two things a revival should not have to rediscover, plus one thing it
should not re-measure:

1. **A drift check must not open a second `scripts/` walk.** ADR
   0017/0020 established one enumeration per section;
   `findScriptEntries` is `scripts/`'s. `editorValidation.ts` is precedent
   for a read-side diagnostic re-walking a section — but it walks
   `eventSheets/`, which has no suppression rule to contradict, so it
   re-walks the *same* set. A `scripts/` drift check must see exactly the
   files `findScriptEntries` deliberately suppresses, so a second walk
   would be a *contradicting* view — the precise failure ADR 0017 exists
   to close.
2. **The cheap seam, deliberately not built.** `findScriptEntries` already
   computes the suppression decision inside its walk, so the suppressed
   set is a byproduct — exposing it is additive and adds no second
   enumeration (e.g. widening the returned element to carry an optional
   `suppressed: "compiled-sibling"` marker). Recording this is what makes
   this decline a judgement about **value**, not about **feasibility**. It
   is also the seam issue #49 would have needed, had it been planned.
3. **If a mechanism is ever chosen: regex, not the TypeScript compiler
   API.** Exported-symbol comparison was implemented twice — once via
   `ts.createSourceFile` plus a modifier walk, once as a ~5-line anchored
   regex — and the two **implementations of that one mechanism** agreed on
   all 5 corpus pairs, including the true positive. (They agree with each
   other; they do not agree with `tsc`-and-diff, which flags 3 of 5 — see
   the mechanism table above.) Since `typescript` is a devDependency, not a
   runtime one, promoting a large compiler dependency to runtime for a
   ~30-line check is disqualifying on its own. Record this so a revival does
   not re-run the comparison.
