---
type: decision-record
---

# ADR 0032: Align this repo's own walks and override checks to the c3source 4.0.0 link policy

**Status:** Accepted
**Date:** 2026-11-05
**Issue:** #95 — adopt `@genvidtech/c3source` 4.0.0 (upstream
`GenvidTechnologies/c3source#114`); shipped together with #94, the
`@genvidtech/mcp-utils` 0.13.0 bump

---

## Context

c3source 4.0.0 changed its disk walks. Every walk classifies entries with
`lstatSync`, so a symbolic link or junction below a walk root is neither
followed nor returned, and a walk root that is itself a link is still followed.
A dangling link no longer makes a walk throw. The upstream record is
[c3source ADR 0037](https://github.com/GenvidTechnologies/c3source/blob/v4.0.0/wiki/decisions/0037-link-safe-disk-walks.md),
filed as `GenvidTechnologies/c3source#114`. In this repo the change reaches
four sections for free: `eventSheets/`, `layouts/`, `objectTypes/` and
`families/` are enumerated by `collectSectionFiles` over `C3Project.findAll*`.

Two paths here did not move with it:

- `findScriptEntries`, the hand-rolled `scripts/` walk, classified entries with
  `statSync`. It followed links below `scripts/`, and it threw `ENOENT` on a
  dangling link.
- `listStaleOverrides` and `listInertOverrides` test an override key with
  `existsSync` and walk rules. Both follow links. A key reached through a link
  was therefore reported as neither stale nor inert, yet no walk can produce it,
  so the override never applied.

Without a change, `scripts/` would follow links that the other four sections
skip. That is the divergence between sections that the one-enumeration rule in
`CLAUDE.md` exists to prevent.

## Decision

All five sections share one link policy: no walk follows or returns a link below
a section root, and a section root that is itself a link is followed.

- **`findScriptEntries` classifies with `lstatSync`.** A link is neither a file
  nor a directory, so it is dropped. A dangling link no longer throws.
- **`listInertOverrides` gains a sixth reason, link.** It checks each path
  segment strictly below the section root with `lstatSync` and reports the first
  link found. The check runs before the other reasons, and the root itself is not
  checked. A `.` or empty segment names no new entry and is skipped, so it cannot
  turn a root that is a link into a link below the root; a `..` segment leaves
  the section and ends the check.
- **`listStaleOverrides` is unchanged.** A dangling link fails `existsSync`, so
  a key through one stays stale. The two lists remain disjoint.

## Alternatives Considered

- **Bump + align locally** — chosen.
- **Bump + file follow-up** — "Smallest PR." Rejected: leaves two link policies
  across the five sections, the divergence class `CLAUDE.md`'s one-enumeration
  rule exists to prevent.
- **Bump only** — "Do what the issues ask". Rejected for the same reason, with
  no tracked follow-up.

## Compromise

The sixth inert reason costs one `lstatSync` per segment of every override key.
An unreadable segment stops the walk of that key and leaves it to the other
reasons, so a key is never reported as a link on a guess.

## Consequences

- **No observed output changes today.** A scan of a local corpus (6 projects,
  2,784 section files) found 0 links. On the canonical fixture, the output of
  `computeDomainData` plus `listUncategorized` was byte-identical before and
  after the bump (5,371 bytes each), and an added override gave a non-empty diff
  on the base side, so the comparison could see a change.
- **Tests create real links** and are observation-gated: they log a note and
  pass where the filesystem refuses to create a link. On Windows,
  `lstatSync().isSymbolicLink()` was true for a junction, a directory symlink, a
  file symlink and a dangling junction.
- **The new tests discriminate.** With `findScriptEntries` mutated back to
  `statSync`, 3 of its 73 tests failed on their assertions (the directory, file
  and dangling-link cases). With the link reason in `listInertOverrides`
  disabled, 8 of its 56 tests failed. The details are in issue #94.
- The adoption record for the bump is in
  `wiki/reference/key-dependencies.md`.
