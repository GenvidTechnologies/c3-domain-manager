---
type: reference
title: fs.watch platform behaviour and the test shapes it forces
description: fs.watch fires 2 events per write on Windows (ReadDirectoryChangesW) and 1 on Linux (inotify), invariant across node majors — a platform confound CI structurally cannot see, closed by a 3x2 matrix, with an observation-gated test shape that expires the moment the divergence is fixed.
tags: [fs.watch, windows, ci, testing, mcp-utils]
status: stable
stale_after: 2027-08-16
generated: { by: process:maintain-wiki, at: 2026-08-16T00:00:00Z }
sources:
  - id: adr0026
    resource: ../docs/decisions/0026-fs-watch-platform-confound-and-upstream-routing.md
    title: "ADR 0026: Close the fs.watch platform confound, route #68's fix upstream, and adopt it"
    last_modified: 2026-08-16
  - id: adr0026-issue
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/68
    title: "Issue #68 — a self-write double-bumps txId via a second watcher event (Windows)"
  - id: adr0026-issue70
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/70
    title: "Issue #70 — the config fs.watch handle is never closed, orphaning the server after stdin close"
  - id: adr0025
    resource: ../docs/decisions/0025-mcp-server-stdio-test-harness.md
    title: "ADR 0025: MCP server stdio test harness"
    last_modified: 2026-08-15
  - id: adr0025-issue
    resource: https://github.com/GenvidTechnologies/c3-domain-manager/issues/67
    title: "Issue #67 — test: add an MCP server test harness over stdio"
---

# fs.watch platform behaviour and the test shapes it forces

## The event-count split

A single `fs.writeFileSync` against a watched file produces a different number
of `fs.watch` callbacks depending on platform. Measured with a 3×2 matrix, 24
runs, 4 per cell (create a file, `fs.watch` it, perform one write, count
callbacks over 500 ms)[^adr0026]:

| Platform / FS | Node | Events per write |
|---|---|---|
| Windows 11, NTFS | v24.11.1 / v22.21.1 / v20.17.0 | 2 |
| WSL Debian, native ext4 | v25.6.1 / v22.22.0 / v20.19.2 | 1 |

The split is "perfectly separated by platform, invariant across three node
majors on each side"[^adr0026]. The record concludes the cause is the
platform mechanism — `ReadDirectoryChangesW` on Windows versus inotify on
Linux — "not the node version"[^adr0026]. The Linux runs were deliberately
taken on native ext4, not `/mnt/c`, because "drvfs inotify semantics differ
and would not be representative"[^adr0026].

## How the confound was closed

The split above wasn't always known to be platform-caused. An earlier
measurement in ADR 0025 ran the same probe and got the same 1-Linux/2-Windows split, but "only Node 24
was available to test on Windows, and only Node 20/22 under WSL, so the table
cannot separate 'this is a Windows-specific `ReadDirectoryChangesW` behaviour'
from 'this is a Node-24 behaviour that happens to have only been run on
Windows'"[^adr0025]. That record stated explicitly that "a future
investigation of #68 should not treat this table as having settled which
factor is responsible"[^adr0025], and ADR 0025's own compromise section
accepted the resulting test as **known-broken, not fixed**, on that branch.

ADR 0026 is that future investigation. It closed the confound by testing
three node majors on *each* platform rather than one per platform — the 3×2
matrix above. The methodological point worth carrying forward: "WSL Debian's
*default* node is v20.19.2 — the very version the original measurement used —
so a naive 'check what WSL offers' would have concluded the confound was
unclosable; it was closable via `nvm`-installed versions"[^adr0026]. Closing a
confound like this one is a matter of deliberately varying the axis that was
previously held fixed by circumstance, not of accepting whatever a default
toolchain happens to offer.

Scope also expanded once the confound closed: the external-write path
(a `fs.watch` event arriving from outside the process, not from the server's
own write) double-bumps too, "through a **different** code path" than the
self-write path ADR 0025 measured[^adr0026]. The governing semantic the
record adopts as a result: "`txId` counts logical changes, not watcher
events"[^adr0026].

## The chmod / uid finding, and why to probe rather than infer

A related platform-dependent finding, from the same investigation, concerns a
write-failure test built on `chmod 0o444`. Measured on Linux native ext4 (WSL
Debian)[^adr0025]:

| uid | Result |
|---|---|
| 1000 (non-root) | write blocked (`EACCES`) — the assertions hold |
| 0 (root) | write **succeeds** — the failure path never fires |

"Root bypasses the permission check entirely, so a hard assertion would go
red under a container running as root, for a reason unrelated to the code
under test"[^adr0025]. The record explicitly rejects inferring availability
from a proxy — `process.getuid?.()` — because that proxy is `undefined` on
Windows, "where the read-only attribute blocks the write regardless, so a uid
check could not even express that platform"[^adr0025]. Instead, "the `before`
hook probes the actual property the test depends on: it chmods the file,
attempts a throwaway write, and gates the `it` block on whether that write
threw"[^adr0025]. If the probe write succeeds, the mechanism is unavailable
on this platform/uid/filesystem and the test logs an explicit note and
passes without asserting anything.

The general shape: when a test depends on a platform-shaped runtime property,
gate on **observing** that property directly, not on a stand-in for it that
may not even be expressible on every platform the test could run on.

## The observation-gated test shape, and its expiry condition

ADR 0025 records the deliberate handling of a known, unfixed platform bug:
"platform-neutral assertions for the properties that hold either way, plus
one explicitly observation-gated test for the bug's own signature"[^adr0025].
That one test — K3 in `test/mcp/mutation.test.ts` at the time — "waits for
the spurious `External change detected` warning on a short deadline and
asserts the full broken trajectory only if that warning actually
arrives; if it doesn't, it logs an explicit note and passes without asserting
anything about `txId`"[^adr0025]. Because CI runs `ubuntu-latest` with no OS
matrix, "K3's non-firing branch is the one CI takes today — a platform-neutral
test that cannot fail on the strength of platform alone, which is the
property that makes it safe to carry a known-broken assertion at
all"[^adr0025].

Once the underlying bug (issue #68) was fixed upstream and adopted, ADR 0026
records the shape's expiry directly: "An observation gate is correct while a
platform divergence is real, and becomes a **liability** the moment it stops
being real: a gate that asserts only when the bug appears is indistinguishable
from one that never fires because the subject is dead, and it keeps passing
either way — nothing detects that expiry on its own"[^adr0026]. K3's
replacement was made "deliberately two-sided (absence of the spurious
warning *and* an accepted replay of the footer `txId`) for exactly that
reason, and it was falsified against the pre-fix server (1/1 failing) rather
than assumed to be correct"[^adr0026].

So an observation-gated test is a *temporary* shape tied to a *real* platform
divergence, not a permanent pattern for platform-shaped behaviour in general —
once the divergence closes, the gate must be replaced with an assertion that
can actually fail, or it silently stops testing anything.

## Why this matters structurally

Both records anchor the whole discussion in one CI fact. ADR 0026 states it
plainly: "the shared `public-github-actions` `node-gate.yml:17` is
`runs-on: ubuntu-latest` with **no OS input at all**. A Windows leg is
therefore a change to a *third* repo, not a toggle — which is why the
upstream fix's tests are made platform-independent by injectable seams
instead"[^adr0026]. ADR 0025 makes the same point about the specific test
this drove: "Because CI is `ubuntu-latest` with no OS matrix, K3's non-firing
branch is the one CI takes today"[^adr0025]. Any Windows-only behaviour is,
by construction, invisible to the automated gate this project runs on every
push — it can only be found by deliberately measuring on the platform that
exhibits it, which is exactly what both records above did.

[^adr0026]: ADR 0026 — Close the `fs.watch` platform confound, route #68's
    fix upstream, and adopt it.
[^adr0025]: ADR 0025 — MCP server stdio test harness.

## Related

- [Upstream dependency routing](/upstream-dependency-routing.md) — the same
  #68/#70 investigation this page describes is also the exemplar for routing
  a shared-primitive defect upstream rather than patching it locally.
