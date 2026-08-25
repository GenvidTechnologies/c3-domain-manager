---
type: decision-record
---

# ADR 0027: Retire the `docs/` tier into the `wiki/` bundle

**Status:** Accepted
**Date:** 2026-08-25
**Issue:** #74 (canonical — the `@genvidtech/mcp-utils` 0.8.0 bump and the
`docs:///` resource-surface reshape), #75 (sibling — the `docs/` → `wiki/`
consolidation itself, no second checklist); GenvidTechnologies/construct3-chef#198
(the outage this record exists to avoid repeating)

---

## Context

Before this branch, the project carried a three-tier documentation layout:
this repo's `CLAUDE.md`, a `docs/` tree (31 tracked files, including the 26
ADRs), and a separately-stood-up `wiki/` (5 tracked files: `index.md`,
`log.md`, `wiki-schema.md`, plus two knowledge pages). `CLAUDE.md`'s own
"Documentation conventions" section described `wiki/` as "a third
documentation tier beyond this file and `docs/`", whose defining property is
that every claim states where it came from. Maintaining two prose tiers side
by side — one link-only (`docs/`) and one footnote-cited (`wiki/`) — is the
second-index drift trap `CLAUDE.md` already warns about for `docs/TOC.md`
itself, just one level up.

`@genvidtech/mcp-utils@0.8.0` (issue #74) gave `exposeDocs` a `{ docsDir,
recursive }` option, which is what makes the collapse safe to do now rather
than later. `GenvidTechnologies/construct3-chef#198` is the cautionary
precedent: chef retired `docs/` into `wiki/` and dropped `docs` from its
`package.json` `files` allow-list in the same commit, before its `mcp-utils`
pin carried a configurable `docsDir` — so the packed tarball shipped no
documentation directory at all, `docs:///` resources threw `ENOENT` on every
read, and it went undetected until someone tried to use it. Chef's stopgap
was a pack-time flattener; this repo's plan avoids needing one by landing the
`0.8.0` bump first (Task 1, independently valuable and already merged toward
this branch) and only then performing the move, with the real `docsDir`
option available from the start. Task 6 repoints both `exposeDocs`'s call
site and `package.json`'s `files` in one atomic commit specifically so this
repo cannot reproduce chef's break at the same seam.

This record is authored mid-plan, at Task 3: the `git mv` of all 30 files
into `wiki/`, the fold of `docs/TOC.md` into `wiki/index.md`, and this ADR's
own authorship already landed; the `exposeDocs`/`files` repoint is Task 6,
still ahead on this branch when this paragraph was written. The decision
below is the one locked before execution (`plan.md`'s "Locked decisions"),
not a retrospective of a finished migration.

## Decision

### 0. `docs/` is retired entirely; `wiki/` is now the documentation tier

```
wiki/  index.md · log.md · schema.md · <3 knowledge pages>
       reference/domain-architecture.md
       process/releasing.md · process/issue-triage.md
       decisions/0001..0027
raw/   unchanged, NOT shipped (see §1.2)
docs/  gone
```

`docs/TOC.md` is **folded into `wiki/index.md`**, not moved — a second index
over one corpus is the drift trap named in Context, in its purest form:
`docs/TOC.md`'s five sections were merged into `wiki/index.md`'s existing
sections (adding a `## Decision Records` heading and three others), so there
is exactly one bundle-root index going forward. Once Task 6 lands, the
bundle is served over MCP by `exposeDocs(server, __pkgDir, { docsDir: "wiki",
recursive: true })` and shipped via `package.json`'s `files` including
`"wiki"` in place of `"docs"`.

### 1. Three deliberate divergences from `construct3-chef`'s precedent

`construct3-chef` is this plugin ecosystem's other repo that has already
made this move, and its layout is the starting template (`plan.md`'s
"Locked decisions" #4, Option B). Three points diverge, each for a stated
reason:

1. **`wiki/schema.md`, not `wiki/wiki-schema.md`.** Upstream
   `GenvidTechnologies/claude-code-plugin-gvt-dev#385` ("maintain-wiki:
   prefer `<wikiDir>/schema.md` over `docs/wiki-schema.md` so the OKF bundle
   is self-describing", **OPEN** as of this record) proposes exactly this
   name. Following chef's `wiki-schema.md` now would mean a second move the
   moment #385 ships. `burbank-playfab` has already landed on `schema.md`
   independently, so this is convergence with a second sibling, not a
   one-off guess.
2. **`raw/` is NOT added to `files`.** `wiki/schema.md` itself states
   `<rawDir>/` is outside the OKF bundle; `raw/` here holds only its own
   `README.md`, zero captures; and, measured across the 3 knowledge pages'
   frontmatter, **zero** of their `sources[].resource` values name a
   `../raw/` path (all cite in-repo ADRs/issues directly — `CLAUDE.md`'s own
   rule that in-repo records are cited directly, never snapshotted into
   `raw/`). **Revisit trigger, falsifiable:** add `raw` to `files` the first
   time a `sources[].resource` value in any wiki page names a `../raw/`
   path — at that point a consumer receiving the bundle without `raw/`
   would hold a dangling citation, which is exactly what `wiki/schema.md`'s
   §6.1 tolerates for a *link* but not for provenance the page depends on.
3. **No `hygiene.excludePaths` entry for `wiki/decisions/`.** Chef excludes
   its ADR directory from the hygiene scanners; measured here (see §2 below),
   the 26 moved records contribute **0** broken-link and **0**
   retired-token findings under `docsRoot: "wiki"`. Copying chef's exclusion
   would only blind `scanBrokenLinks` and `scanRetiredTokens` to 26 files
   that are already clean — the records cite siblings via the path-free
   `[[NNNN-slug]]` form and cite retired paths in backticks, never as
   markdown links, so there is nothing there for either scanner to
   legitimately flag.

## The seven design questions

### Q1 — `wiki/log.md`'s append-only rule

`wiki/log.md`'s own preamble states the rule this move collides with: *"Add
newest first, never edit or remove a prior entry… If a past entry itself
needs correcting, add a new entry that says so; never edit or remove the old
one in place."* Its 8 dated-entry links target `../docs/decisions/*.md` —
measured directly against `docsRoot: "wiki"` via `scanBrokenLinks`, all 8
report broken (`wiki/log.md:22,23,26,28,29,33,35,38`), because `docs/` no
longer exists on disk.

**Resolution: do not edit them.** The rule's escape hatch — *add a new entry
that says so* — discharges the obligation without touching the old text. The
tempting reading, that a path relocation is "mechanical, not a correction"
and therefore exempt, is explicitly rejected: the rule says *never edit in
place*, full stop, with no carve-out for edits that feel safe. The entire
value of an append-only guarantee is that nobody has to adjudicate which
edits qualify as safe enough to make in place — the moment one exception is
granted, the guarantee is a judgment call instead of a rule. The 8 links
become correct-as-history: they document what `log.md` pointed at on the day
each entry was written, not what resolves today.

Two consequences follow, and this record states both rather than leaving
either implicit:

- **The preamble is not an entry.** It sits above the first `## YYYY-MM-DD`
  heading, so it is editable — the move's own log entry (added by Task 4a,
  not this record) is new content, not a correction to old content, and any
  stale `docs/wiki-schema.md` reference inside the preamble itself may be
  repointed freely.
- **`hygiene.excludePaths: ["wiki/log.md"]` is required**, or the audit
  carries these 8 broken-link warnings forever. `isExcluded` (in the
  plugin's `hygiene.mjs`) removes a listed file from **every** scanner it
  feeds, not just `scanBrokenLinks` — including the retired-token scan that
  ADR-0041 (in the `gvt-dev` plugin) deliberately routes into `<wikiDir>/`.
  That is a real, permanent narrowing of an automated check, bounded to one
  file whose entries are by design frozen prose about past ingest runs — a
  config diff alone does not explain why that narrowing is safe; this record
  does.

### Q2 — `scanBrokenLinks` and the bundle-absolute link form

Moving `docsRoot` to `wiki` (once `.gvt-agent.json`'s `paths` override is
wired, Task 5a) drags the scanner into the bundle for the first time, and
`scanBrokenLinks` resolves a leading `/` in a link target against **the repo
root**, not the bundle root (`absTarget = strippedTarget.startsWith('/') ?
join(repoRoot, strippedTarget.slice(1)) : …` in the plugin's `hygiene.mjs`).
The three knowledge pages use OKF §6.1's **bundle-absolute** form
(`/other-page.md`) for their `Related` links — measured directly, exactly
**4** findings on an otherwise untouched tree:

```
wiki/documentation-drift-modes.md:154 -> /upstream-dependency-routing.md
wiki/fs-watch-platform-behaviour.md:157 -> /upstream-dependency-routing.md
wiki/upstream-dependency-routing.md:151 -> /fs-watch-platform-behaviour.md
wiki/upstream-dependency-routing.md:154 -> /documentation-drift-modes.md
```

**Resolution: conform the links, not the scanner.** `wiki/schema.md` §6.1
permits both forms — bundle-absolute is only *recommended*, for the stated
reason that "it stays correct even if the linking page moves to a different
subdirectory within the bundle." That reason does not apply here: all three
knowledge pages stay at the bundle root permanently (§0's layout, and the
reason given in `plan.md` — `maintain-wiki` writes new pages flat to
`<wikiDir>/<topic-slug>.md`, so burying these three would desync the tool's
default write location from the layout on every future `ingest`). With
nothing to protect against a future move, there is no reason to pay the
resolution mismatch. **Project rule recorded here: this project uses
ordinary relative intra-wiki links** (`./other-page.md`), because with
`docsRoot = wikiDir` the repo's own `scanBrokenLinks` resolves a leading `/`
against the *repo* root — a form that is legal per §6.1 but is not what a
reader of these four links means.

The net effect is a coverage **gain**, not a regression: measured with
`docsRoot: "wiki"` and `hygiene.excludePaths: ["wiki/log.md"]`, the scanner's
candidate set is **35** files (36 tracked `wiki/**/*.md` minus `log.md`)
against **6** before the move (`docs/`'s non-ADR files plus `CLAUDE.md`,
since `docs/decisions/` sat in the scanner's own default exclude list) — the
26 ADRs are now reachable by `scanBrokenLinks` and `scanRetiredTokens` for
the first time, and both report 0 findings against them.

### Q3 — `scanOrphanedDocs`'s literal `TOC.md` read

`scanOrphanedDocs` reads `${docsRoot}/TOC.md` **literally** (`hygiene.mjs`:
`const tocContent = await safeReadFile(join(repoRoot, docsRoot,
'TOC.md'))`); if that file is absent it returns `[]` immediately — clean,
but only because it checked nothing. With `docsRoot: "wiki"` and no
`wiki/TOC.md` (this bundle's index is `wiki/index.md`), that is exactly what
happens — measured directly, `scanOrphanedDocs(repoRoot, { docsRoot: "wiki"
})` returns 0 findings against a corpus it never opened.

**Resolution: accept the loss, don't paper over it.** The check only ever
saw the same 5 non-ADR files `scanBrokenLinks` used to see before this move
— it never reached the 26 ADRs, since they were excluded from the candidate
set anyway. Manufacturing a `wiki/TOC.md` purely to feed this one scanner
would recreate the second-index problem this whole consolidation exists to
remove (Context, above). The real owner of this property post-move is
**`maintain-wiki`'s `lint` verb**: `wiki/schema.md`'s own "Decay / staleness
policy" section describes `lint` as flagging orphaned pages — "a page listed
in **no** index — neither `<wikiDir>/index.md` nor its own subdirectory's
`index.md`" — which understands the Option-B subdirectory layout (`wiki/
decisions/`, `wiki/reference/`, `wiki/process/` each own no separate
`index.md` in this repo, so membership is checked against the single
bundle-root `wiki/index.md`) in a way `scanOrphanedDocs` structurally cannot,
since it has no notion of subdirectories at all. This record deliberately
declines to write a local orphan-check script to fill the gap: that would be
a second implementation of a check that already has a named owner, the exact
shape the `scripts/` "one enumeration per section" rule in `CLAUDE.md`
warns against one level down, in code rather than in tooling.

### Q4 — `docs/wiki-schema.md` → `wiki/schema.md`, and the resurrection hazard

`maintain-wiki`'s own scaffold step (§0 of its skill body) resolves only
`wiki.wikiDir`/`wiki.rawDir` from `.gvt-agent.json` — it never consults
`.gvt-agent.json`'s `paths` overrides at all, and it probes the **literal**
path `docs/wiki-schema.md`, hardcoded in its `metadata.expects.files` and
repeated at every scaffold-decision point in its body; the plugin's
`practice-detect.mjs` hardcodes the same literal path independently. Under
`--non-interactive` (alias `--auto`), a missing `docs/wiki-schema.md` is
scaffolded **automatically** from the bundled template — silently recreating
a `docs/` directory holding a pristine, un-edited copy of the schema and
discarding every project-specific edit this repo's `wiki/schema.md` carries
(the OKF-pin table, the Option-B bundle-root note, the wiki-links section
above, none of which exist in the bundled template).

Four mitigations are recorded here, together, because no single one closes
the hazard on its own:

1. **The `schema.md` naming** (§1.1 above) closes this hazard entirely the
   moment `GenvidTechnologies/claude-code-plugin-gvt-dev#385` ships, since
   the scaffold probe would then check the same path this repo already
   uses.
2. **An operating rule in `CLAUDE.md`** (added in a later task on this
   branch, §1.1's sibling change): never run `maintain-wiki ingest
   --non-interactive`/`--auto` in this repo until gvt-dev#385 and #390 have
   shipped. Interactive `ingest` is safe — it *offers* the scaffold via
   `AskUserQuestion` rather than applying it silently — so the rule targets
   only the unattended path.
3. **Upstream comments** on both #385 and `GenvidTechnologies/claude-code-plugin-gvt-dev#390`
   ("propagate #385's schema-doc resolution to every hardcoded
   `docs/wiki-schema.md` site, including two behavioral ones"), registering
   this repo as a second consumer of the `schema.md` naming, alongside
   `burbank-playfab` — the same route-the-fix-upstream-then-adopt shape
   [[0026-fs-watch-platform-confound-and-upstream-routing]] used for #68's
   fix, applied here to a doc-scaffold hardcode rather than a shared runtime
   primitive.
4. **An acceptance tripwire** (issue #74's row B2) asserting `docs/` does
   not exist on disk — a resurrection by an unattended `maintain-wiki`
   `ingest` run would trip it on the next check, rather than sitting
   unnoticed until a genuinely new page collides with a stale template.

**Why the ADR-location move is safe and the schema-doc move is not — the
asymmetry that makes mitigation (2) necessary at all.** `create-adr`'s skill
body reads, verbatim: *"Read `CLAUDE.md`. If it declares an ADR location,
use that; otherwise use `docs/decisions/`."* `tech-writer`'s own body (the
agent authoring this record) carries the identical seam: *"If the consuming
repo's `CLAUDE.md` already names an ADR location, that takes precedence over
`docs/decisions/`."* Both skills check `CLAUDE.md` before falling back to
their hardcoded default, which is exactly why this repo's `docs/decisions/`
→ `wiki/decisions/` move (this branch, Task 3) needed no upstream issue and
no operating rule — the existing seam already routes around the hardcode.
`maintain-wiki` declares no such seam: `CLAUDE.md` does not appear anywhere
in its `metadata.expects`, and its scaffold-decision prose never mentions
consulting it. That absence is *why* a later task on this branch adds a
`## Documentation layout` section to `CLAUDE.md` — it is not read by
`maintain-wiki` today, but it is the one seam `create-adr` and `tech-writer`
already honor, and it stands ready for `maintain-wiki` to adopt the same
pattern once #385/#390 land.

### Q5 — `raw/` stays unshipped

Covered fully in §1, divergence 2: zero captures, zero citing
`sources[].resource` entries, and a falsifiable revisit trigger (the first
`../raw/` resource value in any wiki page's frontmatter). Repeated here only
to keep this record's seven-question structure complete and independently
navigable.

### Q6 — the `exposeDocs` test gap, and why it needs two checks

Before this branch, there was **no test anywhere** in this repo for
`exposeDocs`, the `docs:///` resource template, or `resources/list` — a
direct `grep` across `test/` for those three terms, before Task 2 added
`test/mcp/resources.test.ts`, returned nothing. Closing that gap takes two
distinct checks, not one, because they observe different failure surfaces:

- **A resource test** (now `test/mcp/resources.test.ts`, driven through the
  real MCP `Client` over `test/mcpHarness.ts`'s subprocess harness, [[0025-mcp-server-stdio-test-harness]]) proves
  the `docsDir`/`recursive` wiring is correct — that `resources/list`
  enumerates the bundle and `readResource` returns real content. It proves
  **nothing** about the tarball: the harness spawns the server from
  `src/cli.ts` directly, so `__pkgDir` resolves to the repo working tree,
  where `wiki/` is present regardless of what `package.json`'s `files`
  says.
- **`GenvidTechnologies/construct3-chef#198` was specifically a `files`
  allow-list failure** — the wiring was fine, the packed artifact was
  empty. No source-tree test, however thorough, can observe an allow-list
  omission; only a check against the packed manifest (`npm pack --dry-run
  --json`) can. Conversely, a packed-manifest check alone cannot observe a
  wiring defect like an omitted `recursive: true` — the files would ship
  correctly and still be unreachable through nested `docs:///` URIs.

Hence the acceptance checklist (issue #74) carries **three** rows for this
one gap, not one: `test/mcp/resources.test.ts` (D2/D3/D8/D9/D10, the wiring),
a packed-manifest membership check (D4/D6, "the served set and the published
set agree" — the exact invariant chef#198 violated), and D5, a **mutation
control** for D4 (remove `"wiki"` from `files`, confirm the check now reports
≥31 missing, restore) — because an empty-collection assertion proves nothing
on its own without having been seen to fail.

The measured stakes for the wiring half, recorded here because they motivate
why `recursive: true` is not optional: with `recursive: false`, `exposeDocs`
would serve only bundle-root-level names. Measured directly against this
tree's tracked `wiki/**/*.md` set, root-level names (matching
`wiki/[a-z0-9-]*\.md$`) are **6** of **36** tracked pages (`index`, `log`,
`schema`, and the 3 knowledge pages) — the remaining **30**, including all
27 records under `wiki/decisions/` (26 pre-existing plus this one) and the 3
pages under `wiki/reference/`/`wiki/process/`, would be silently unreachable
by URI. This repo's analogue of chef's own "4 of 45" measurement at the same
seam.

### Q7 — the downstream `releasing.md` step 8 obligation

`wiki/process/releasing.md` step 8's binding sentence, unconditional: *"Every
publish here therefore needs a follow-up issue there."* — "there" being
`GenvidTechnologies/claude-code-plugin-gvt-construct3`, which pins this
package and documents its MCP surface for the `c3-explorer`/`c3-implementer`
agents. The "MCP tool-surface change" clause that follows it in step 8 is an
**additional callout inside** that follow-up issue's body, not a condition
on whether the issue gets filed — so this move creates **no new
obligation**, only content for the existing one. The next publish's
follow-up issue (out of scope on this branch — see Consequences, G6) must
name the `docs:///` reshape — all 5 pre-existing URIs renamed
(`docs:///TOC` etc. become path-shaped, e.g. `docs:///reference/
domain-architecture`), 27 added under `wiki/decisions/` — and must state
explicitly that the `c3-explorer` `tools:` allow-list is **not** affected:
`resources/list` is a different MCP capability from `tools/list`, and this
move touches only the former.

## Also recorded

- **The accepted Practice Coverage regression.** The `gvt-dev` plugin's
  `audit-conventions` Practice Coverage report will show `Environment` move
  from `adopted` to `partial adoption` for the span this branch is on (the
  `docs/wiki-schema.md` hardcode driving Q4 above is exactly what that
  metric is measuring). This is **advisory only** — the report carries no
  findings and cannot affect the audit's exit code — and it **inverts** the
  moment gvt-dev#385 ships, back to `adopted`, with no further action needed
  in this repo.
- **What is deliberately NOT rewritten.** Two categories of existing prose
  keep naming retired `docs/` paths, on purpose: the historical body text
  inside the 26 pre-existing ADRs (a record documents state at decision
  time — "correcting" a path inside e.g. [[0020-section-source-extension-filter]] would falsify what
  that record actually said when it was written, the same carve-out
  `CLAUDE.md`'s citation conventions already grant `file:line` citations
  inside ADRs), and `wiki/log.md`'s 8 dated entries (Q1, above). Both are
  **citations of history**, not **live pointers that must resolve** — the
  distinction this record draws is between the two, not a blanket rule
  either way. This record's own historical prose above (chef's break,
  `docs/TOC.md`'s fold) is exempt from `CLAUDE.md`'s "cite retired `docs/`
  paths in backticks only" instruction in the sense that it's describing the
  past, but it still follows that instruction literally — every `docs/`
  path named above is backticked, never a markdown link, matching this
  record's own C1 constraint.
- **Frontmatter is owed; provenance re-authoring is not.** All 30 moved
  pages gained a non-empty `type:` key — the OKF format's only
  always-required key (`wiki/schema.md` §11.2) — during Task 3's move
  commit. `sources[]` is optional, and `wiki/schema.md`'s "Tolerated, never
  rejected" paragraph forbids a consumer rejecting a bundle over its
  absence; consistent with that, none of the 26 moved ADRs gained a
  `sources[]` block during the move, the same choice `construct3-chef` made
  for its own moved ADRs.

## Compromise

**What was rejected.**

- **Option A (flat layout)** — recommended by the design phase that preceded
  this plan — was declined in favor of Option B (chef's subdirectory shape:
  `reference/`, `process/`, `decisions/`), specifically so a future
  `wiki/<other-section>/` addition does not collide with the bundle-root
  namespace `maintain-wiki` writes new pages into.
- **Fixing `scanBrokenLinks` to understand bundle-absolute (`/page.md`)
  links against the bundle root, rather than the repo root**, was
  considered and rejected (Q2). The scanner's behavior — resolving a
  leading `/` against `repoRoot` — is arguably a plugin-side gap, but
  patching it is a cross-repo change with its own review cycle, while the
  four affected links have no genuine need for the bundle-absolute form in
  the first place (they name pages that never move). Conforming the links
  was strictly cheaper and just as correct.
- **Manufacturing a `wiki/TOC.md` to keep `scanOrphanedDocs` functioning**
  (Q3) was rejected: it would resurrect the exact two-index problem this
  whole record exists to close, to satisfy a check whose job is now owned
  by `maintain-wiki lint`.
- **"Correcting" `wiki/log.md`'s 8 dated links to their new targets** (Q1)
  was rejected on the file's own stated rule — append-only holds even for a
  change that looks purely mechanical, because the value of the guarantee
  depends on nobody making that judgment call.
- **Copying `construct3-chef`'s `wiki/decisions/` hygiene exclusion** (§1,
  divergence 3) was rejected: measured at 0 findings against the 26 records,
  the exclusion would trade real scanner coverage for a precedent that
  doesn't apply here.
- **Shipping `raw/` in `package.json`'s `files`** (§1, divergence 2 / Q5)
  was rejected for lack of anything inside it that any wiki page's
  `sources[]` actually cites — shipping an empty, uncited directory has no
  benefit and a small ongoing packaging cost.

**What was accepted.** The `wiki/schema.md` naming diverges from
`construct3-chef`'s `wiki-schema.md` ahead of the upstream change that will
make it the recommended default, accepting a short window where this repo's
naming is ahead of the shipped convention rather than matching a sibling
that will itself need to move. The Practice Coverage regression (Also
recorded, above) is accepted as advisory-only and self-reverting.

## Consequences

- `docs/` no longer exists as tracked content in this repo; `wiki/` (plus
  the unshipped `raw/`) is the sole documentation tier alongside
  `CLAUDE.md`.
- `wiki/index.md` is the single bundle-root index; `docs/TOC.md` is gone,
  not superseded by a second file.
- `.gvt-agent.json` needs four `paths` overrides (`docs/TOC.md` →
  `wiki/index.md`, plus the `docs/decisions/`, `wiki/schema.md`, and
  `issue-triage.md` equivalents) and a `hygiene: { excludePaths:
  ["wiki/log.md"] }` block — wired in a later task on this branch (Task 5a),
  not by this record directly.
- `src/mcp/server.ts`'s `exposeDocs` call and `package.json`'s `files` array
  both need to move together, in one commit (Task 6) — the exact atomicity
  constraint that would otherwise reproduce
  `GenvidTechnologies/construct3-chef#198`.
- A `## Documentation layout` section is owed in `CLAUDE.md` (a later task
  on this branch), mapping old `docs/` paths to their `wiki/` equivalents,
  and stating the `maintain-wiki --non-interactive` operating rule from Q4.
- The next publish of this package must file the downstream update-request
  issue described in Q7 — not yet due on this branch (no task here performs
  a publish).
- `GenvidTechnologies/claude-code-plugin-gvt-dev#385` and `#390` gain a
  comment registering this repo as a second consumer of the `<wikiDir>/
  schema.md` naming (best-effort, cross-repo, no local commit).
