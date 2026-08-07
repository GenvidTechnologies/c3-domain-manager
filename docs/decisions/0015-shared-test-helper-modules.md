# ADR 0015: Shared test-helper modules, flat and concern-named

**Status:** Accepted
**Date:** 2026-08-07
**Issue:** #38 — Consolidate duplicated test helpers

---

## Context

Five kinds of duplication had accumulated in `test/`: temp-dir lifecycle
(`makeTempDir`/`removeTempDir` and their `fs.rmSync` inlining), file creation
(`createFile`), object/family JSON builders (`makeObjectType`/`makeFamily`),
`DomainConfig` construction (`makeConfig`, in four mutually incompatible
positional forms), and `DomainData` construction (`makeDomain`, in seven
hand-rolled variants across six files — `coupling.test.ts` alone held two,
added by issue #30 after the count first got written into `CLAUDE.md`, which
made that count stale the moment it landed).

[[0014-canonical-fixture-hermetic-materialization]] had already established one
instance of the shape this generalizes: `test/fixtureHelpers.ts`, a flat,
concern-named module directly under `test/`, holding only the canonical-fixture
surface. That ADR's Consequences section named consolidating the *other*
duplicated helpers as issue #38, unblocked by the helper shape it established.
This record generalizes that shape into a convention and records the two new
modules that apply it.

## Decision

**Shared test code lives in flat, concern-named modules directly under
`test/`, never a kind-named `helpers.ts`/`utils.ts`.** The criterion is "name
it for the concern, not the kind" — a kind-named module becomes an unbounded
dumping ground and tells a reader nothing at the import site. Three modules
now follow it:

- `test/fixtureHelpers.ts` — the canonical fixture (ADR 0014).
- `test/syntheticProject.ts` — throwaway C3 project trees: `createFile`,
  `makeTempDir`, `removeTempDir`, `makeObjectType`, `makeFamily`.
- `test/domainModel.ts` — in-memory `DomainConfig`/`DomainData` literals:
  `makeConfig`, `makeDomain`.

All three are siblings of `test/setup.ts`, named-export only, and carry no
`.test.` infix so the mocha glob does not collect them as spec files.

### The module split criterion

`syntheticProject.ts` and `domainModel.ts` were split on a sharp, mechanical
line rather than a judgment call: `syntheticProject.ts` imports `node:fs` (and
`node:os`/`node:path`); `domainModel.ts` imports nothing but types from
`src/domain/types.js`. A type-only import is erased at compile time, so
`domainModel.ts` adds no load-order coupling to the `--require`'d
`test/setup.ts`. The criterion is self-enforcing — a future addition to either
module either touches the filesystem or it doesn't, with no ambiguous middle.

### The structural synthetic/fixture invariant

`syntheticProject.ts` must never import `fixtureHelpers.js`. This is stated as
an invariant, not a preference, because it is the mechanism that keeps ADR
0014's synthetic/fixture split real rather than nominal: synthetic tests exist
to express *negative* cases the canonical fixture can never contain (editor-local
names like `*.uistate.json`, malformed JSON, files at arbitrary paths), and
seeding a temp dir from the fixture would turn those negative assertions into
assertions about the fixture instead — silently defeating their purpose. The
invariant is recorded in `syntheticProject.ts`'s own module header, and the
import block of each test file's helper imports now doubles as an at-a-glance
marker of which kind of test a `describe` block belongs to.

### Key-presence verification

Both new builders change how absent keys are represented relative to some of
the helpers they replace, and both changes were verified free before shipping
rather than assumed free.

`makeConfig`'s body is `{ domains, ...extras }`, which *omits* a key entirely
when the caller doesn't supply it. Some of the old per-file helpers instead
always wrote every key, leaving unsupplied ones present with value `undefined`.
Every optional `DomainConfig` key read anywhere in `src/` is read via `??
default` or a truthiness guard, never `in` / `Object.keys` / `hasOwnProperty` —
`classification.ts:26`'s one `in` check is itself guarded by `config.overrides
&&` first — so an omitted key and an explicit `undefined` are indistinguishable
to every reader. `tsconfig.json` has `strict: true` but not
`exactOptionalPropertyTypes`, so the assignment also type-checks.

`makeDomain` always writes `strategy` and `isSharedSubdomain` (as `opts?.x`,
so still `undefined` unless supplied), where three of the seven variants it
replaces omitted them. This direction was checked the same way and is, in
fact, the more faithful shape: every reader of those two fields in `src/`
(`formatting.ts`, `relationships.ts`, `coupling.ts`) does a value read, never a
presence check, and `computeDomainData` itself (`domainGenerator.ts:227,249`)
emits `strategy: def.strategy` unconditionally — so the three omitting
variants were the ones diverging from production shape, not the shared helper.

## Compromise — alternatives rejected

**A hook-registering `useTempDir()` getter**, returning a function that reads
the current suite's temp dir instead of a `let tmpDir` variable set in
`beforeEach`. Rejected at a measured **198** `tmpDir` references that would
have to become `tmpDir()` call sites, and because it would force `import {
beforeEach } from "mocha"` into a helper module — breaking the one property
`fixtureHelpers.ts` deliberately holds: it registers nothing with mocha itself,
and `test/setup.ts` calls *into* it rather than the reverse. Plain
`makeTempDir`/`removeTempDir` functions, called from each file's own
`beforeEach`/`afterEach`, keep that property.

**A full options-object `makeConfig(opts?: Partial<DomainConfig>)`**, folding
`domains` itself into the options bag rather than keeping it a first
positional parameter. Rejected at a measured **65** call-site edits against
**32** for the hybrid `makeConfig(domains = {}, extras?)` form that shipped,
for no semantic gain — `domains` is supplied at nearly every call site, so
making it positional-with-default costs fewer edits than making it a named key
of an options object, and the named-`extras` half already eliminates the
positional-argument-order hazard that motivated the change (see below).

## Two analysis errors caught during implementation

Recorded because both are about the *method* that caught them, not just the
outcome.

**"`makeConfig`'s group-A third parameter is dead"** was the planning-time
conclusion, reached by grepping the word `sharedSubdomains` per file. It was
wrong: `domainAnalysis.test.ts:142` called the old helper *positionally* —
`makeConfig({ Auth: ... }, undefined, { Chat: ... })` — a call site that never
spells the parameter name. A grep for a parameter's *name* cannot see a
positional argument that omits it. The call belonged to "classifies files via
shared subdomains", which would have inverted silently had the third
positional argument been mapped to `overrides` instead of `sharedSubdomains`
during the mechanical rewrite. It was converted to `{ sharedSubdomains: ... }`
and confirmed green by test name, not just by the suite passing.

**`CLAUDE.md`'s "five test files hand-roll a `makeDomain`" figure** was stale
before this issue started: `coupling.test.ts` (issue #30) added two more
definitions after that sentence was written, making the true count seven
definitions across six files. The drift mechanism is the point, not the
number — a prose count of code sites has no gate keeping it honest, so it will
recur wherever a similar count is written down. `CLAUDE.md`'s replacement
paragraph (see below) states the current cost instead of a historical count,
for exactly this reason.

## Compromise — three acceptance criteria amended mid-implementation

Recorded as a lesson about command-shaped criteria, not as an embarrassment —
all three amendments are in the issue #38 body.

- **R16** ("no fixture seeding from a synthetic helper") was originally
  verified by `grep "fixtureHelpers"` returning 0 matches in
  `syntheticProject.ts`. That grep also matched the module's own header
  comment, which *names* `fixtureHelpers.js` as the forbidden import (see
  "structural synthetic/fixture invariant" above) — prose evidence of
  compliance, not an absence of the violation. The first implementation pass
  degraded the comment to satisfy the letter of the check.
- **R15** ("canonical-fixture describes untouched") similarly matched
  `syntheticProject.ts`'s own doc-comment prose rather than the described
  code.
- **R11** ("no direct temp-dir lifecycle outside the shared helper") matched
  four `fs.rmSync` calls that remain inside `it()` bodies in
  `domainGenerator.test.ts`. Those are not lifecycle: they delete a
  *subdirectory* of the suite's temp dir as an arrange step for "directory is
  absent" test cases, not a suite-level create/destroy.

**The general lesson: a grep-shaped criterion tests a string, not the
property it stands in for; when it over-matches, narrow the check to the
mechanism the property actually depends on, rather than degrading the code to
satisfy the letter of the check.** All three criteria were narrowed
accordingly and the narrowed wording is recorded in the issue body rather than
here.

## Note on ADR 0012

[[0012-coupling-hub-discount]] still reads "the five `makeDomain` test
helpers" (its Alternatives Considered and Consequences sections). That is not
an error to fix: ADRs in this repo are historical, describing the state faced
at the time the decision was made, and five was in fact the wrong count even
then (see "two analysis errors" above) — but correcting it retroactively would
misrepresent what ADR 0012's author actually had in front of them. Leave it as
written.

## Consequences

- Six local `makeDomain`/`makeConfig`/`createFile`/`makeObjectType`/
  `makeFamily`/temp-dir-lifecycle definitions are gone from `test/domain/` and
  `test/adapters/`, replaced by imports from `test/syntheticProject.ts` and
  `test/domainModel.ts`.
- Extending `DomainData` with a new non-optional field now requires editing
  exactly one literal (`test/domainModel.ts`'s `makeDomain`), not up to seven.
- `CLAUDE.md`'s testing-conventions section names all three helper modules
  immediately after the `fixtureHelpers.ts` paragraph, and its "Extending
  `DomainData`" paragraph states the current one-module cost instead of a
  historical file count.
- Cross-references: [[0014-canonical-fixture-hermetic-materialization]] (the
  precedent this generalizes, and the source of the synthetic/fixture
  invariant `syntheticProject.ts` enforces).
