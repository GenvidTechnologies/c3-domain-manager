# Wiki Log

Record of every `ingest` run: what changed, why, and which `raw/` source drove
it, grouped under `## YYYY-MM-DD` date headings (ISO 8601) with the **newest
date group first**. Entries are prose bullets, e.g. `* **Update**: …`,
`* **Creation**: …`, `* **Deprecation**: …` — the leading bold word is a
convention, not a requirement.

**Add newest first, never edit or remove a prior entry.** "Newest first" means
a new entry (and, if today isn't already the top group, a new `## YYYY-MM-DD`
heading) is *prepended* above everything else — the insertion point moves from
the bottom to the top, but prepending never touches a prior entry's text, so
the append-only guarantee holds exactly as before. If a past entry itself needs
correcting, add a new entry that says so; never edit or remove the old one in
place. See `docs/wiki-schema.md` for the full maintenance schema.

## 2026-08-16

* **Creation**: `fs-watch-platform-behaviour.md` — first ingest of the wiki.
  No `raw/` capture drove this page (this run's sources are in-repo ADRs and
  GitHub issues, cited directly rather than snapshotted); drawn from
  [ADR 0026](../docs/decisions/0026-fs-watch-platform-confound-and-upstream-routing.md)
  and [ADR 0025](../docs/decisions/0025-mcp-server-stdio-test-harness.md),
  plus issues #67, #68, #70.
* **Creation**: `upstream-dependency-routing.md` — first ingest. Drawn from
  [ADR 0026](../docs/decisions/0026-fs-watch-platform-confound-and-upstream-routing.md)
  (the mcp-utils#12 routing and 0.7.0 adoption) and
  [ADR 0021](../docs/decisions/0021-decline-drift-diagnostic.md) /
  [ADR 0022](../docs/decisions/0022-section-extension-provenance.md) (the
  c3source `#73`/`#76` deletion-trigger-vs-prompt pattern), plus issues #68,
  #70, #48, #60.
* **Creation**: `documentation-drift-modes.md` — first ingest. Drawn from
  [ADR 0022](../docs/decisions/0022-section-extension-provenance.md) (a gloss
  that inverted ADR 0020's own decision, caught by grep),
  [ADR 0023](../docs/decisions/0023-decline-stray-file-diagnostic.md) (the
  record that stayed clean of the misattribution ADR 0024 later found in
  ADR 0022), and
  [ADR 0024](../docs/decisions/0024-editor-validation-single-enumeration.md)
  (both the sibling-ADR misattribution and the framing sentence that opened
  issue #37 on a premise three accepted records deny), plus issues #60, #62,
  #37.
