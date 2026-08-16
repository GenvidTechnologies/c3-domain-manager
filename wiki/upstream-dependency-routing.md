---
type: practice-note
title: Route a shared-primitive defect upstream, not around it
description: When a defect or a missing primitive sits inside a first-party dependency's shared code, route the fix to that dependency's own repo rather than patching around it locally — but verify the fix actually closes the symptom, not just the mechanism it targeted.
tags: [dependencies, mcp-utils, c3source, upstream, practice]
status: stable
stale_after: 2026-12-31
generated: { by: process:maintain-wiki, at: 2026-08-16T00:00:00Z }
sources:
  - id: adr0026
    resource: ../docs/decisions/0026-fs-watch-platform-confound-and-upstream-routing.md
    title: "ADR 0026: Close the fs.watch platform confound, route #68's fix upstream, and adopt it"
    last_modified: 2026-08-16
  - id: adr0026-issue68
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/68
    title: "Issue #68 — a self-write double-bumps txId via a second watcher event (Windows)"
  - id: adr0026-issue70
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/70
    title: "Issue #70 — the config fs.watch handle is never closed, orphaning the server after stdin close"
  - id: adr0021
    resource: ../docs/decisions/0021-decline-drift-diagnostic.md
    title: "ADR 0021: Decline a compiled-output drift diagnostic"
    last_modified: 2026-08-12
  - id: adr0021-issue
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/48
    title: "Issue #48 — spike: evaluate a compiled-output drift diagnostic"
  - id: adr0022
    resource: ../docs/decisions/0022-section-extension-provenance.md
    title: "ADR 0022: Section-extension provenance split"
    last_modified: 2026-08-13
  - id: adr0022-issue
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/60
    title: "Issue #60 — re-examine SECTION_SOURCE_EXTENSIONS now that c3source 2.0.0 unifies section finders"
---

# Route a shared-primitive defect upstream, not around it

## The routing decision, and why it wasn't a local patch

Issue #68 (a self-write double-bumping `txId` via a spurious second
`fs.watch` event on Windows) traced to `ExpectedChanges.consume` being
single-shot, a defect `OptimisticWatcher` inherited unchanged: "its Layer 2
is the same `consume` call, and it is byte-identical between mcp-utils 0.5.1
and 0.6.0. The defect **reproduces in mcp-utils' own API with no consumer
involved**"[^adr0026]. That reproducibility is what settled the venue: "every
mcp-utils consumer on Windows has this bug — a local patch inside
`src/mcp/server.ts` would fix only this repo's symptom while leaving the
shared root cause in place for everyone else"[^adr0026]. The fix was filed as
`GenvidTechnologies/mcp-utils#12`, "proposing an `ObservedState`
content-fingerprint ledger — reframing the question from 'which event is
this?' (unanswerable) to 'does the file now hold something we haven't
accounted for?' (answerable from the file, with **no timing term**)"[^adr0026].

## Turnaround is fast enough to be a near-term option

ADR 0026 dates the confound measurement and upstream routing to 2026-08-15
and the adoption of the shipped fix to 2026-08-16[^adr0026] — the fix landed
in `mcp-utils` and was pulled into this repo within roughly a day of being
routed. "Fix it upstream and wait" is therefore a near-term option on this
dependency, not an indefinite deferral, provided the issue body carries
enough evidence (the reproduction, the proposed mechanism, the measured
alternative) for the maintainers to act on directly.

## The audit-on-bump discipline that surfaces these

The `OptimisticWatcher` equivalence wasn't found by reading mcp-utils'
changelog — it was found by auditing a dependency bump against the
hand-rolled code it might supersede. ADR 0026 records this as the discharge
of a standing practice: auditing `setupWatcher` against `OptimisticWatcher`
"is now discharged... this repo bumped its floor to `^0.7.0` and replaced the
hand-rolled watcher with `OptimisticWatcher` outright"[^adr0026], and that
same audit is what discovered upstream's version carried the identical
`txId` double-bump defect, rather than being a clean replacement.

The same pattern recurs on the `c3source` dependency, by two different
mechanisms that reach the same destination without being the same thing.
`SCRIPT_SOURCE_EXTENSIONS` had been held locally "temporarily," with an
explicit note to re-check on the next bump; when `c3source#73` closed,
"[t]he trigger fired, the constant is now upstream-sourced. The prediction
came true; it was not overturned"[^adr0021] — a **deletion trigger** that
fired on its own. The companion section-extension question was different in
kind: ADR 0020 had framed `c3source#76` as "a prompt to re-examine the
design, not a deletion trigger... because at the time `#76` was still open
and its resolution direction unknown"[^adr0022]. It took a dedicated issue
(#60) to actually re-examine the question once `#76` resolved: "`#76`
resolved in the direction that retires the local pair, the same way `#73`'s
resolution retired `SCRIPT_SOURCE_EXTENSIONS`"[^adr0022]. Issue #60's own
body shows the mechanism at work — its "Keep" argument was built on a framing
("product policy, local by decision") that a later grep against the record
showed was never actually in the ADR it was attributed to[^adr0022-issue],
and the issue's own Acceptance Criteria records the correction directly:
"the phrase 'product policy, local by decision' is **not in ADR 0020** (0
grep hits)... So ADR 0022 vindicates ADR 0020 rather than overturning
it"[^adr0022-issue]. Same destination (retire the local artifact), two
different routes to get there (a trigger firing on its own vs. a question
that needed a dedicated issue to resolve) — worth keeping distinct rather
than treating one as a template for the other, since the next upstream
question may resolve either way.

## Verify the actual surface, not the release notes

Both routes above depended on reading the dependency's *actual* shipped code
rather than trusting a description of it. Adopting `OptimisticWatcher`
required checking "the three points that read as settled but needed checking
against the packed API rather than assumed"[^adr0026] — whether
`writeDomainConfig` could stay synchronous, whether `expected: ExpectedChanges`
was still a required constructor option, and how a single-file watch target
fit a directory-recursive-by-default contract. Issue #60's own Acceptance
Criteria records a parallel discipline applied to the *published package
name itself*: a version check had been written against the bare
`c3-domain-manager`, "which 404s on npm; the published name is
`@genvidtech/c3-domain-manager`"[^adr0022-issue] — corrected before being
relied on, with the criterion re-run against `npm view` on the corrected
name.

## The trap: adopting the right fix doesn't guarantee the symptom is gone

The most expensive lesson in this pair of records is that routing the fix
correctly and adopting it cleanly does not, by itself, prove the original
symptom is resolved. Issue #70 (the leaked `FSWatcher` handle keeping the
server alive after stdin close) was assumed to close automatically once
`OptimisticWatcher` was adopted, "because it has `stop()`"[^adr0026]. ADR
0026 records that this was wrong: "`shutdown()` does call `watcher.stop()`,
but `shutdown()` is wired only to `SIGINT`/`SIGTERM`, and a client that
disconnects by closing stdin raises neither — so `stop()` is never reached
on that path. Measured: the server was still running 8 seconds after stdin
close both **before and after** adoption"[^adr0026]. The actual fix was
`unref()`-ing the `FSWatcher` handle inside the injected `watcherFactory`;
"after that it exits in **2539 ms**, against **2531 ms** for a no-config
server where the `existsSync` guard means no watch handle is ever
created"[^adr0026] — the no-config arm serving as the control that isolated
the handle as the cause.

The general lesson the record draws is procedural: run the defect's own
reproduction, before and after the change, with a control arm that isolates
the cause — a green test suite (386 passing, unchanged in count, both before
and after this specific defect's fix) is not sufficient evidence that a
timing-dependent symptom like a lingering process handle has actually gone
away, because nothing in that suite exercised the stdin-close path the bug
lived on.

[^adr0026]: ADR 0026 — Close the `fs.watch` platform confound, route #68's
    fix upstream, and adopt it.
[^adr0021]: ADR 0021 — Decline a compiled-output drift diagnostic.
[^adr0022]: ADR 0022 — Section-extension provenance split.
[^adr0022-issue]: Issue #60 — re-examine `SECTION_SOURCE_EXTENSIONS` now that
    c3source 2.0.0 unifies all four section finders to `.json`.

## Related

- [fs.watch platform behaviour](/fs-watch-platform-behaviour.md) — the same
  #68/#70 investigation, from the angle of the platform-dependent behaviour
  the routed fix had to account for.
- [Documentation drift modes](/documentation-drift-modes.md) — both pages
  turn on the same discipline: trust the artifact you can inspect (packed
  types, a re-run grep) over a description of it (release notes, a gloss).
