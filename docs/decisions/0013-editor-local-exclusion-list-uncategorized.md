# ADR 0013: Editor-local exclusion in `list-uncategorized` and `findScriptEntries`

**Status:** Accepted
**Date:** 2026-08-05
**Issue:** #33 — `list-uncategorized` reports C3-editor-local artifacts as unmapped work

---

## Context

`listUncategorized` is the tool's primary "is my domain map complete?" surface
(CLI `list-uncategorized`, MCP tool `list-uncategorized`). It walked six
section sites (`eventSheets/`, `layouts/`, `scripts/` root and subdirs,
`objectTypes/`, `families/`) with two hand-rolled recursive `readdirSync`
helpers that applied no editor-local filter, so `*.uistate.json`, files under
`uistate/`, and `tsconfig.json` reached `classifyFile`, returned `null`, and
were reported as work to map.

The contamination is narrower than it looks: `classifyFile` matches on
directory prefix, so an editor-local file inside a *claimed* directory is
absorbed and never surfaces — false positives appear only in **unclaimed**
subtrees, exactly what this command exists to enumerate. Measured against two
real Construct 3 projects during design: one (a large domain-foldered project,
C3 r47604) has 245 `.uistate.json` files but zero appear in its report — all of
its `eventSheets/` and `layouts/` directories are claimed; a second (r39700)
has 19. Neither exhibits the `uistate/` **directory** form of the exclusion —
that form is hardening against a newer C3 editor behavior (r487+, a fact
c3source owns) rather than an observed symptom.

`@genvidtech/c3source` already owns this platform fact:
`EDITOR_LOCAL_EXCLUSIONS`/`isEditorLocalPath` (since 1.8.0) and the generic
`find_all_files_path` walker. The 1.9.0 bump additionally exports
`C3_TS_DEFS_FOLDER` and a caller-controlled `descend` parameter on
`find_all_files_path`. Per `CLAUDE.md`'s standing guidance ("when bumping
c3source, check whether new exports supersede local logic"), this is the
sixth such adoption after ADRs [[0001-adopt-c3source-extractors]],
[[0005-validateforeditor-read-side-diagnostic]],
[[0008-adopt-openproject-option-a]],
[[0009-addon-inventory-project-wide-diagnostic]] /
[[0010-per-domain-addon-attribution]], and
[[0011-expression-reference-coupling]].

## Decision

Delegate both walks to c3source; keep only genuinely local glue.

1. `domainAnalysis.ts`'s two private helpers (`collectSourceFiles`,
   `collectRootTsFiles`) are rewritten over `find_all_files_path` with a
   `!isEditorLocalPath(name)` predicate. The exclusion rule is **consumed,
   never re-encoded** — no editor-local literal appears anywhere in `src/`.
2. Two things `find_all_files_path` does not provide are re-established
   locally, once per helper: a missing-directory guard (the walker throws
   `ENOENT`; ADR 0008 / issue #23 require `[]` instead), and
   `path.relative(baseDir, p).replace(/\\/g, "/")` (the walker returns
   absolute native-separator paths; `classifyFile` and `overrides` require
   section-rooted forward-slash paths).
3. No new `src/domain/` module — both helpers stay private to
   `domainAnalysis.ts`; the public API (`src/index.ts`) is unchanged.
4. No new extension filter is introduced. The change is scoped to
   editor-local artifacts, not to extensions — a stray non-`.json` file
   sitting in an unclaimed `eventSheets/` directory remains a legitimate
   "unmapped file here" signal.
5. `scripts/ts-defs/` stays walked and reported, classifying via
   `scriptDirs` like any other script subdirectory — see the first
   Compromise below. The existing `scriptSubdirs` allowlist is unchanged
   except that its `"ts-defs"` literal becomes `C3_TS_DEFS_FOLDER`.
6. `domainGenerator.ts`'s `findScriptEntries` gains a named predicate,
   `isReportableScriptDir(name) = !isEditorLocalPath(name) || name ===
   C3_TS_DEFS_FOLDER`, applied where it previously reported every
   subdirectory unconditionally. This is the same editor-local rule as (1),
   applied at the second of the two hand-rolled walk sites in this repo.

## Architecture

Three layers, one owner each:

- **C3 platform fact → c3source.** Which basenames are editor-local, and how
  a section tree is recursed. This is versioned against C3 editor releases;
  we consume `isEditorLocalPath`, `find_all_files_path`, and
  `C3_TS_DEFS_FOLDER` rather than re-deriving them.
- **Tool glue → this repo.** Path normalization to `classifyFile`'s contract,
  and missing-directory tolerance. These are consequences of *this tool's*
  input contract, not of the C3 platform.
- **Product policy → this repo, this ADR.** Which editor-generated
  directories this tool nonetheless chooses to report (`ts-defs/`), and
  which `scripts/` subdirectories it scans at all (the existing allowlist).

The third layer is why a blanket `!isEditorLocalPath` predicate is wrong at
two of the six sites: c3source correctly classifies `ts-defs/` as
editor-local, but this tool deliberately disagrees about *reporting* it.
That disagreement is product policy, and it belongs here, not upstream.

## Compromise — `ts-defs/` is editor-local AND reportable

`isEditorLocalPath("ts-defs")` is `true`, yet real projects
(`burbank`'s `Core.scriptDirs`) declare `"ts-defs"` as a script directory to
index into a domain, and removing that support would make 87 generated
`.d.ts` files appear as uncategorized. Rather than treat that declaration as
a workaround to eliminate, this decision **elevates it to the supported way
of indexing generated typings into a domain** — most `.d.ts` files mirror an
object type, and having them indexed is useful.

The tool therefore splits c3source's single predicate into two questions —
*"is this C3 source?"* (no) and *"should this tool report it?"* (yes,
deliberately) — and answers them differently for exactly one directory name.

**Cost:** `isReportableScriptDir` is a local exception to an upstream rule.
A future c3source release that changes `EDITOR_LOCAL_EXCLUSIONS.dirs` will
not automatically stay correct here — it needs to be re-checked against this
exemption on the next bump. It is guarded by a direct unit test precisely
because a well-meaning simplification to `!isEditorLocalPath(name)` alone
would silently drop `ts-defs/` from the report.

## Compromise — `descend` was not needed where the issue assumed

Issue #33's framing assumed caller-controlled descent (new in c3source 1.9.0)
was the mechanism required to keep `ts-defs/` reachable under an
editor-local filter. Measured against the packed 1.9.0 build,
`find_all_files_path` applies `descend` only to *sub*directories encountered
during the walk — it is never consulted for the walk's own `dir` argument.
Because the existing `scriptSubdirs` allowlist survives unchanged and passes
`scripts/ts-defs` as the walk's **root**, that directory is entered by
construction; the default `descend` then correctly prunes any `uistate/`
nested inside it.

Keeping the default `descend` is strictly better than overriding it:
c3source documents that overriding `descend` disables inherited editor-local
classification for the entered subtree, so an override here would have made
this tool's own predicate the *only* filter inside `ts-defs/`, and
`scripts/ts-defs/uistate/*.d.ts` would have been (re-)reported — the exact
defect this ADR fixes, reintroduced one directory level deeper.

`descend` **is** used once in this change — as `() => false` on the
`scripts/` root scan, to express non-recursion (the four allowlisted script
subdirectories, including `ts-defs`, are walked separately, and recursing at
the root would both double-report them and pull in non-allowlisted
subdirectories). So the `^1.9.0` floor remains genuinely load-bearing — for
a different reason than issue #33 assumed. Recorded here so a future reader
does not conclude the version bump was ceremonial.

## Consequences

- No `*.uistate.json`, `uistate/**`, or `tsconfig.json` appears in
  `list-uncategorized` output at any of the six section sites. On
  fully-claimed projects (burbank) the reported count is unchanged; on
  projects with unclaimed subtrees, the false-positive reduction is roughly
  2–3x.
- **Nothing newly appears.** No extension filter was added; no file that was
  previously reported became classified as a side effect of this change.
- `generate` / the domain index are unaffected except that a stray
  `scripts/uistate/` directory no longer surfaces as a bogus unclassified
  entry via `findScriptEntries` (a latent case, unobserved in the corpus).
- **Free on the c3source bump, user-visible:** `validateForEditor` (adopted
  in [[0005-validateforeditor-read-side-diagnostic]]) gains a
  `custom-ace-name-required` rule in 1.9.0. `EditorValidationIssue.rule` is
  a plain `string`, so this is not a type change, and no fixture in this
  repo exercises a `custom-ace-block` without an `aceName`. A real project
  with such a block will now report it via `validate-editor` — call out in
  release notes.
- **Known accepted limitation — `.js` root scripts.** Construct 3 supports
  both `.ts` and `.js` scripts, but `listUncategorized`'s root-script
  collector and `findScriptEntries` both filter on `.ts` only, so a
  JS-authored project's root scripts are invisible to `list-uncategorized`
  and absent from the generated domain index. This predates this ADR and is
  accepted rather than fixed here; full `.js` script support is tracked as a
  follow-up issue.
- **Inert overrides (accepted gap).** An `overrides` entry keyed on a path
  that is now excluded (e.g. a `.uistate.json` file) becomes permanently
  dead: `list-uncategorized` will never re-surface it, and
  `list-stale-overrides` only checks file existence, not editor-local
  status, so it won't flag the entry either. Zero occurrences were found
  across burbank's 13 overrides. Release notes should advise removing any
  such entries; teaching `list-stale-overrides` to flag editor-local keys is
  a follow-up issue.
- **Symlink semantics changed at all six walk sites.** The previous
  hand-rolled walk used `Dirent.isDirectory()` (does not follow symlinks);
  `find_all_files_path` uses `statSync` internally (follows symlinks; a
  broken symlink now throws instead of being silently skipped). C3
  folder-projects ship no symlinks in the corpus observed, and
  `computeDomainData` has carried this same exposure since
  [[0008-adopt-openproject-option-a]] — this change aligns
  `listUncategorized` with that existing behavior rather than diverging from
  it.
- **Deliberately not unified:** the `path.relative(...).replace(/\\/g,
  "/")` idiom now appears independently in `editorValidation.ts`,
  `domainGenerator.ts` (three call sites), and both helpers in
  `domainAnalysis.ts`. Extracting a shared helper would require a new
  `src/domain/` module, which `CLAUDE.md`'s re-export rule would push onto
  the public API for a one-line idiom with no semantic content that can
  drift. Deferred to a follow-up issue; revisit if a third *module* (not
  just a third call site) needs the seam.
- **`findScriptEntries` is still not a `find_all_files_path` adoption** —
  reaffirming the scope limit already recorded in
  [[0008-adopt-openproject-option-a]]. `find_all_files_path` returns files
  only, while `findScriptEntries` deliberately emits `{relativePath,
  isDirectory}` directory entries that `domainGenerator.ts` classifies
  directly. Its fix here is the name-level `isReportableScriptDir` guard,
  not a walker swap; this ADR does not reopen that earlier rejection.
- **Deferred — the four opt-in c3source 1.9.0 extras not adopted here**, for
  lack of an integration site (the same standard applied in
  [[0007-project-dir-resolverootfolder]] and reaffirmed in
  [[0008-adopt-openproject-option-a]]):
  - `detectReferenceIntegrity` and the four `detect*Issues` diagnostics —
    no consumer in this repo today.
  - The manifest write surface (`serializeProjectManifest` /
    `writeProjectManifest` / `C3Project.writeManifest()`) — this tool never
    writes project manifests.
  - `ManifestDrift.degraded` — its drift detection has no reachable trigger
    from `src/` as currently structured.
  - `manifestTolerant()`, which does have a real call site
    (`addonInventory.ts`), but swapping to it is a behavior change about how
    a malformed manifest is handled, not part of this defect fix — deferred
    to its own issue.
  - Also deferred: `ts-defs` object-type mirroring — the idea that
    `scripts/ts-defs/Player.d.ts` should inherit the domain of
    `objectTypes/**/Player.json`, falling back to `scriptDirs` only when no
    matching object type exists. Sized comparably to issue #26 /
    [[0010-per-domain-addon-attribution]]; needs its own analysis and ADR.

## Alternatives Considered

**Adopt the `C3Project` named collectors** (e.g. `findAllScripts()`) instead
of `find_all_files_path` directly. Rejected: `findAllScripts`'s predicate
excludes `.d.ts` files, which would drop every `ts-defs/` file and directly
contradict the first Compromise above; its non-`sub` form recurses over all
of `scripts/`, which would break the existing non-recursion invariant on the
root scan. It also covers only four of the six walk sites here (no
`objectTypes/`/`families/` collector) and would import c3source's
per-collector extension-filter inconsistency as an invisible, per-section
answer to a question this ADR answers explicitly.

**A new `src/domain/c3walk.ts` module** shared by both hand-rolled walk
sites. Rejected: `CLAUDE.md` requires every new `src/domain/*.ts` module to
be re-exported from `src/index.ts`, which would publish an internal file-walk
utility on the public API for a single internal consumer.

**Aligning `list-uncategorized`'s extension filter with what
`computeDomainData` consumes.** Rejected: the two commands already diverge
structurally — `listUncategorized` scans four allowlisted script
subdirectories while `computeDomainData`/`findScriptEntries` walks all of
`scripts/` and emits directory entries — so matching extensions would
produce a partial alignment that reads like a guarantee and isn't one. It
would also suppress a genuine finding: a stray non-`.json` file sitting in a
section directory.

**Collapsing the `scriptSubdirs` allowlist** to something broader or
config-driven. Rejected as out of scope for this fix: the allowlist has zero
observed corpus impact and its current behavior is explicitly pinned by
existing tests.
