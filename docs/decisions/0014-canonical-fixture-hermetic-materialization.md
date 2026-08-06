# ADR 0014: Canonical `construct3-sample` fixture, hermetically materialized

**Status:** Accepted
**Date:** 2026-08-06
**Issue:** #34 — Include construct3-sample as a fixture

---

## Context

Every test in this repo built its C3 project on disk in a per-test
`fs.mkdtempSync` temp dir. That is fine for negative and edge cases — the test
author controls exactly what is present — but it meant nothing exercised a real
Construct 3 export, and the shape of a real project was only ever asserted
against the test author's model of it.

`GenvidTechnologies/construct3-sample` exists precisely to close that gap. It is
the canonical C3 reference project, consumed as a tag-pinned git submodule by
`c3source` and `construct3-chef`, and its own ADR 0001 names this repo as an
intended consumer. Its consumption contract is fixed: pin to a tag, materialize
a **gitignored** working fixture from it, never commit the canonical bytes into
the consumer.

Two facts about the sample at `v0.7.0` shaped this work.

**It could not exercise this tool's core capability.** Measured by running the
extractors against it, all three cross-domain coupling sources came back empty:

- zero `include` events existed anywhere in the project;
- the only expression-reference tokens were `Functions.*`, and `Functions` is
  the System functions object — never a classifiable object type, so
  `objectNameIndex` could never resolve one;
- `score` was declared at sheet root but read only inside a generic
  `compare-two-values` string, which `getEventVarReferenceName` does not
  recognise, while `temp` and `isActive` were declared inside groups and so out
  of scope for global-variable resolution.

`eventSheets/` and `layouts/` were also flat (`"subfolders": []`), so
classification could only reach them through exact-path `overrides` — the
directory-prefix path that `*Dirs` exists for was unreachable.

A fixture that cannot produce a single coupling edge would have added coverage
of file discovery and classification while leaving [[0006-event-variable-reference-coupling]],
[[0011-expression-reference-coupling]] and the include graph exactly as
untested against real data as before.

**It deliberately carries no editor-local state.** `project/.gitignore` excludes
`*.uistate.json` and `uistate/`, and the README lists them under "deliberately
not included". This matters because [[0013-editor-local-exclusion-list-uncategorized]]
is precisely about excluding those artifacts, and the obvious motivation for a
real-project fixture — "a hand-built temp dir does not naturally produce editor-local
files" — is therefore not something this fixture can satisfy.

## Decision

Vendor `construct3-sample` as a submodule at `test/fixtures/construct3-sample`,
**enrich it upstream first**, and materialize the fixture hermetically.

1. **Enrich upstream, then pin.** Rather than accept an un-exercisable fixture,
   `construct3-sample` gained folder structure and one instance of each
   cross-domain edge, released as **`v1.0.0`**. See "Enriching rather than
   accepting" below.
2. **Materialize from `git archive HEAD`**, unzipped in-process via `fflate`,
   into a gitignored `test/fixtures/canonical/` that is deleted and rebuilt on
   every run. Wired as `pretest`.
3. **CI checks the submodule out** via the shared node gate's `submodules`
   input; the prep script does not self-init.
4. **A missing fixture is a hard failure**, not a skip.
5. **The domain config lives in memory** (`test/fixtureHelpers.ts`), not as a
   file inside the fixture.
6. **`*.uistate.json` coverage stays with the synthetic tests.**

## Architecture

```
test/fixtures/construct3-sample/     submodule, pinned to v1.0.0 (canonical bytes)
        │
        │  git archive HEAD project  ── reads the object store, never the working tree
        ▼
test/fixtures/canonical/             gitignored, rebuilt by `pretest`, byte-identical
        ▲
        │  fixtureProjectPath()      ── single swap point (PROJECT_FIXTURE)
        │  FIXTURE_CONFIG            ── domain config, in memory
test/domain/*.test.ts                fixture-backed blocks alongside synthetic ones
```

`scripts/prep-fixture.mjs` is `.mjs` rather than `.ts` so it runs from both
PowerShell and bash without a loader — the same reasoning `construct3-chef`
records for its equivalent.

## Compromise — hermetic materialization, and why no parity script

`construct3-chef` copies the submodule's **working tree** (`fs.cpSync`) and adds
a four-assertion `verify-fixture-parity.mjs` as the oracle for the drift that
copy admits. This repo copies from `git archive HEAD` and ships **no** verify
script. The narrower justification matters, because "delete-then-rebuild removes
the drift" only retires three of chef's four assertions:

| chef assertion | retired here by |
|---|---|
| 1–2: no `*.uistate.json`, no `uistate/` | `git archive` reads tracked blobs; untracked files are invisible |
| 4: path-set + byte compare vs the submodule | the tree is a pure function of the pinned commit |
| 3: exactly N tracked overlay files | **not** hermeticity — retired instead by having no committed overlay at all (decision 5) |

The failure mode this prevents is not hypothetical, and it is wider than "a pin
bump removed a file". c3source's ADR 0019 records its CI going red because a
working-tree copy picked up 11 untracked `uistate` files present on a developer
machine and absent in CI. chef accumulated 14 such files across pins — files the
canonical repo has never tracked at any tag — and their damage was **not** a red
suite: they made two of chef's assertions pass *vacuously*.

This repo hit the same class of contamination during this very change. The
manual C3-editor round-trip (below) rewrote all 49 `ts-defs/*.d.ts` files to
CRLF in the submodule's working tree, with zero content change. A `cpSync`
materialization would have baked those bytes into the fixture, making it differ
between a machine that had opened the editor and CI. `git archive` did not see
them. The design was validated by the exact hazard it was chosen for, before the
first fixture-backed test existed.

## Compromise — enriching upstream rather than accepting the fixture as-is

Changing a shared, neutrally-owned fixture is not free, so the reasoning is
recorded rather than assumed.

**What was added** (`v0.7.0` → `v1.0.0`): `eventSheets/` and `layouts/` folded
into `Gameplay/` and `UI/` with `project.c3proj` synced in the same commit; a
cross-domain `include`; a cross-domain object-member expression reference
(`Sprite2.X`, read from `Gameplay` where `Sprite2` lives under
`objectTypes/images/`); and a cross-domain event-variable reference (`UI` gates
on `score`, declared at the root of `Gameplay`'s sheet).

`Templates Layout` was deliberately left at the `layouts/` root: it has no
assigned event sheet, so it is a genuine "belongs to no one domain" case, and it
keeps the root-level and unclassified paths covered. `temp` and `isActive` were
deliberately left group-scoped, so the *unresolved*-reference path stays covered
rather than being accidentally eliminated.

**Why upstream and not a local overlay.** construct3-sample's ADR 0001 draws its
boundary at **provenance**: it owns artifacts originating from the C3 editor or
the official SDK, never hand-authored data and never a consumer's own read
surface. Event sheets are squarely editor-provenance, so a local overlay
carrying them would have put consumer-authored project bytes in the one place
that contract forbids.

**Why `v1.0.0` and not a minor bump.** Upstream's semver rule makes **major** a
structural change that forces consumers to update their overlay or strip-list.
Foldering moves every event-sheet and layout path, so `construct3-chef` must
regenerate its 12-file `extracted/` golden before it can bump. A minor tag would
have signalled that bumping was free.

**Why siblings are not broken by it.** Verified, not assumed: `c3source` and
`construct3-chef` both pin `construct3-sample` at commit `b1ee72d1ee` via a
gitlink recorded in their own history. Upstream's `main` advancing, and a new
tag existing, change nothing either observes until each separately runs
`git submodule update` and commits a pin bump.

**On authoring method.** Upstream's protocol requires project JSON to come from
a C3 editor round-trip rather than being hand-authored, because a real editor
save completes half-authored data — and because c3source's parser types fields
the editor *requires* (`variable.comment`, `group.description`) as optional, so
a green automated gate does not prove the project loads. The edits here were
drafted programmatically and then **imported and re-saved in the Construct 3
editor (r49500)**, which is the round-trip that protocol asks for. The re-save
reproduced the project JSON byte-for-byte, which is the evidence that the draft
was faithful; had it not, the editor's normalisation would have been the
authority.

## Compromise — `*.uistate.json` is out of scope

The intuitive motivation for a real-project fixture is that a synthetic temp dir
does not naturally produce editor-local artifacts. That motivation does not
survive contact with this fixture, and the reason is not merely that upstream
excluded them.

Editor-local state is regenerated every time the project is opened and its
content carries no stable signal. Asserting against it would be asserting
against churn. It is also unreachable by construction here: hermetic
materialization reads tracked blobs, and these are gitignored upstream, so no
amount of fixture work would surface them.

[[0013-editor-local-exclusion-list-uncategorized]]'s exclusion path therefore
stays covered by the synthetic `mkdtemp` tests, which can hold that content
still and can construct the negative case. Concretely, the fixture-backed
`listUncategorized` test asserts the two files that *are* uncategorized and
explicitly does **not** assert that no `*.uistate.json` appears — the fixture has
none, so that assertion would pass without exercising the exclusion and would
keep passing if the exclusion were deleted. chef carries two live assertions of
exactly that shape.

## Compromise — CI input rather than a self-initialising prep script

chef's prep script self-inits its submodule, with an `insteadOf` rewrite gated on
`process.env.CI` because the shared gate checks out no submodules and CI has no
ssh key. Issue #34 originally recorded self-init as *required, not optional*.

That was false. The shared `node-gate.yml` **does** expose a `submodules` input
(added 2026-07-21), `c3source` already uses it, and `actions/checkout` performs
the ssh→https rewrite internally. Passing `submodules: recursive` is one line and
needs no workaround; chef's `-c url…insteadOf` exists only because
`actions/checkout` scopes that rewrite to a temporary global config its own
process tears down, which a later `pretest` step cannot inherit.

With checkout responsible for materialising the submodule, a missing submodule
at prep time is a genuine error rather than a state to paper over — which is what
makes the hard-fail below coherent rather than merely strict.

## Compromise — hard failure rather than a guarded skip

c3source's prep script prints a note and exits 0 when its submodule is absent,
and its fixture-dependent tests self-skip. This repo exits non-zero, and
`test/setup.ts` throws from a root `beforeAll` hook.

A silent skip converts "the fixture is missing" into "the suite passed" — the
same green-for-the-wrong-reason failure that vacuous assertions produce. chef
demonstrates the end state: two of its "integration" tests are gated on a path
that resolves outside its repository, so neither has executed once, and mocha
renders a permanently-skipped test identically to an intentionally pending one.

The guard was verified by deleting the fixture and running mocha directly. That
verification immediately earned itself: the hook was first written as
`mochaHooks.before`, which mocha's root-hook plugin API silently ignores (it
recognises only `beforeAll`/`beforeEach`/`afterAll`/`afterEach`), so the guard
never ran and a missing fixture surfaced as 11 raw `ENOENT`s. A guard that is
not tested is indistinguishable from one that does not fire.

## Consequences

**Coverage gained.** All three coupling-edge kinds now have fixture-backed
assertions against a real project, where previously none could exist:
`includesFrom` `Gameplay → UI`, `referencesFrom` `UI → Gameplay` via `score`,
and `expressionRefsFrom` `Gameplay → UI` via `Sprite2`. `computeAddonInventory`
is asserted against a real 13-addon manifest, including the two bundled custom
addons, and the canonical project is confirmed internally consistent (nothing
declared-but-unused, nothing used-but-undeclared).

**Additive.** No pre-existing `mkdtemp` test was modified; fixture-backed blocks
sit alongside them in the same files. Unifying the duplicated temp-project
helpers remains issue #38, which this unblocks by establishing the helper shape
it named as its blocker.

**`test/fixtures/` must stay out of lint and typecheck.** The fixture
materializes 56 `ts-defs/*.d.ts` plus two authored `.ts` files. C3 codegen uses
`var` and `Function`, which this repo's rules forbid at `--max-warnings 0`.
Because CI runs lint and typecheck *before* test, a clean first run passes while
any cached or repeat run fails — an intermittent whose cause is far from its
symptom. `.eslintrc.cjs` `ignorePatterns` and `tsconfig.test.json` `exclude`
guard it, and both were verified load-bearing rather than assumed.

**A pin bump requires re-capturing the assertions.** Every fixture-backed value
was captured by running the real function. A future `construct3-sample` bump
must repeat that rather than adjusting numbers to make tests pass. The protocol
is: bump the gitlink → `npm run fixture:prep` → re-capture. It is materially
shorter than chef's, which needs an unconditional `git clean` step and an
"expect verify to fail, that's normal" step after its editor import; hermetic
materialization removes both.

**No manual editor checkpoint is inherited.** chef requires one because it
authors project bytes that must load in the editor. This tool is read-only, so
it inherits load validity from the pinned tag. The checkpoint applies to
*producing* a `construct3-sample` release, not to consuming one.

**`fflate` is now a direct devDependency.** It was already present transitively
via `@genvidtech/c3source`; depending on it without declaring it would have been
a phantom dependency that a future c3source change could remove silently.

## Alternatives Considered

**Copy the submodule working tree, as `construct3-chef` does.** Rejected. It
admits contamination from untracked files and local modifications, cannot remove
leftovers, and therefore needs a parity script to detect drift it could have
prevented. The CRLF episode during this change is a concrete instance.

**`git archive` piped to the system `tar`.** Avoids declaring `fflate`, and both
GNU tar and bsdtar do resolve on the primary dev machine. Rejected on the
portability reasoning c3source records: depending on an external `tar` reachable
from an npm-spawned `node` on Windows is a worse trade than one small, already-
installed dependency.

**Accept `construct3-sample` at `v0.7.0`.** Rejected — see above; it would have
left the coupling analysis as untested against real data as before.

**Commit `domain-config.json` into the fixture.** Rejected. It would make the
materialized tree differ from canonical, requiring an exclusion in any future
integrity check — a hole in the very thing meant to detect holes. Every library
entry point already accepts a config object; only `generateDomainIndex`,
`loadConfig` and the CLI read one from disk, and no fixture-backed test needs
those.

**Per-test skip guards instead of a root hard failure.** Rejected — see the
hard-failure compromise above.

**Add authored `*.uistate.json` stubs to the fixture.** Rejected. c3source did
exactly this and records the cost: its ADR 0019, citing the trap its ADR 0018
identified, measures its own overlay stub at 66 bytes with a trailing newline
against C3's real 224-byte, tab-indented, no-trailing-newline output — "hermetic
is not the same as representative". Stubs would test the exclusion against a
shape the editor never produces, while contradicting upstream's provenance
boundary.
