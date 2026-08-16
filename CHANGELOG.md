# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project is pre-1.0, so a **minor** bump is the breaking-change vehicle
(see `docs/releasing.md`).

## [Unreleased]

## [0.8.0] - 2026-08-16

### Fixed
- A single MCP self-write no longer double-bumps `txId`, so a client that
  replays the `txId` a mutate tool handed it is accepted rather than rejected
  on every write (#68/#71). External writes are fixed on the same path. Windows
  delivers two `fs.watch` events per `writeFileSync` while
  `ExpectedChanges.consume` was single-shot; the fix is upstream, in
  `@genvidtech/mcp-utils` 0.7.0's `OptimisticWatcher` Layer 3, adopted here.
  ADR 0026 records the platform measurement that closed ADR 0025's open
  node-version confound.
- The config-path `fs.watch` handle no longer keeps the server alive after its
  stdin closes, which previously orphaned a server process holding the project
  directory (#70/#71). Note `stop()` is *not* what fixes it — `shutdown()` is
  wired only to `SIGINT`/`SIGTERM`, so a stdin-close disconnect never reaches
  it; the handle is `unref`'d instead.

### Added
- Adopt `@genvidtech/c3source` 2.0.0's `isGeneratedScriptOutput` and
  `SCRIPT_SOURCE_EXTENSIONS`, retiring the local compiled-sibling detection
  they supersede (#48). A decision record (ADR 0021) documents why a separate
  compiled-output drift diagnostic was declined.
- Adopt `@genvidtech/c3source` 2.0.0's `isSectionItemName`, retiring the local
  section-extension predicate it supersedes (#60). A decision record
  (ADR 0022) documents the provenance split between upstream's platform fact
  and this repo's own parse-boundary policy.
- Flag inert override keys in `list-stale-overrides` (#36/#55).
- Detect inert directory-shaped override keys (#54/#56).
- `.js` script support via the authored-script rule (#39/#50).
- Add the canonical `construct3-sample` fixture with cross-domain coupling
  coverage (#41).
- Add issue-triage conventions; add Commit Format / Pull Request Format /
  Branching sections to `CLAUDE.md` (#42/#44).
- A subprocess-based MCP stdio test harness (`test/mcpHarness.ts`) driving the
  real server over its production CLI path with a real MCP `Client`, covering
  tool-level error propagation, cache invalidation, optimistic-concurrency
  rejection and the response shapes (#67/#69, ADR 0025).

### Changed
- Bump `@genvidtech/c3source` floor to `^2.0.0` (#48).
- Bump `@genvidtech/mcp-utils` floor to `^0.7.0` (#68) — load-bearing for
  `OptimisticWatcher` and `ObservedState`.
- Route `validateEditorStrictness`'s `eventSheets/` walk through
  `collectSectionFiles`, leaving one copy of the relative-POSIX idiom in
  `src/domain/` instead of two (#37/#66, ADR 0024).
- Delete `server.ts`'s seven dead module-init initializers (#65/#69).
- Decline a stray-file diagnostic built on c3source 2.0.0's `detectStrayFiles`,
  with explicit dispositions per section (#62/#64, ADR 0023).
- Unify the two `scripts/`-enumerating surfaces (#47/#53).
- Unify the section-source rule across both surfaces (#52/#58).
- Consolidate duplicated temp-project test helpers (#38/#43).
- Exclude C3-editor-local artifacts from `list-uncategorized` (#33/#40).
- Compiled-sibling suppression is now case-insensitive, matching upstream
  c3source 2.0.0 behaviour — a `Main.JS` alongside `main.ts` is now
  suppressed where it was previously emitted (#48).
- Two `CONVENTIONS.md` resyncs (gvt-dev 4.4.0, 4.5.0).

### Internal (no consumer-visible change)
- `isCompiledSibling` (#48), and `SECTION_SOURCE_EXTENSIONS` /
  `isSectionSourceName` (#60), were added and then removed again **entirely
  within this release cycle**, so no published version ever exported them.
  Upgrading 0.7.0 → 0.8.0 loses nothing: `0.7.0`'s `classification.d.ts`
  exported only `FILE_TYPES`, `VALID_PREFIXES` and `classifyFile`, verified
  against the published tarball. These were previously listed under `Removed`
  and marked **BREAKING**, which would have sent consumers auditing for
  removals their copy never had — the entries described churn between
  releases rather than a delta between them. `collectSectionFiles`'s optional
  `log` parameter was likewise never published.

  Recorded rather than deleted because the reasoning is still worth having:
  each removal was a deliberate, alias-free retirement in favour of an
  upstream c3source 2.0.0 primitive, and ADRs 0021 and 0022 document why.

## [0.7.0] - 2026-07-23

### Added
- Adopt c3source 1.8.0 addon attribution as an `addon-inventory` diagnostic
  (#25/#27).
- Per-domain addon attribution via `objectTypeDirs`/`familyDirs` (#26/#29).
- Expression-reference cross-domain coupling edge (#28/#31).
- Shared-kernel hub-exclusion/discount for coupling edges (#32).

## [0.6.2] - 2026-07-15

### Fixed
- Tolerate a missing `scripts/` directory in `findScriptEntries` (#23/#24).

## [0.6.1] - 2026-06-30

**First version ever published to npm.** (`0.6.0` was carried in `package.json`
history but never tagged and never published — see the note below.)

### Changed
- Migrate to `@genvidtech/c3source` 1.7.0 and adopt `openProject` for file
  discovery (#21).
- Migrate to `@genvidtech/mcp-utils` 0.5.1 (#20/#22).
- **Renamed the package from `@genvid/c3-domain-manager` to
  `@genvidtech/c3-domain-manager`**, and repointed package metadata at the
  `GenvidTechnologies` GitHub org.

### Note on the missing `v0.6.0`
`package.json` briefly carried version `0.6.0` under both the `@genvid` and
`@genvidtech` scopes, and a `chore: Release 0.6.0` commit exists in history,
but **no `v0.6.0` tag was ever created and no `0.6.0` was ever published**.
The provenance-signed publish for that version failed (npm `E422`) because
`package.json`'s `repository.url` still pointed at the pre-move
`genvid-holdings` org while the publish Action was already running under
`GenvidTechnologies`, following the GitHub org migration. A burned version is
never retried, so the release line jumps from the unpublished `0.6.0` work
directly to `0.6.1`.

## [0.5.0] - 2026-06-17

### Added
- `--project-dir` flag to set the Construct 3 project source root (#16/#17).

### Changed
- Make the downstream plugin version bump a standing release step.

## [0.4.0] - 2026-06-11

### Added
- Enrich the cross-domain dependency graph with event-variable references
  (#14/#15).
- Adopt `@genvid/c3source` 1.4.0 `validateForEditor` as an editor-strictness
  diagnostic (#13).

### Changed
- Upgrade `@genvid/mcp-utils` to 0.4.0 and adopt its helpers (#11).

### Docs
- Document the release version-bump process.

## [0.3.0] - 2026-06-03

### Added
- Configurable `domain-config` and `extracted`-output locations (#7/#8).
- Adopt `@genvid/mcp-utils` 0.3.0 `loadProjectConfig` (#9).

## [0.2.0] - 2026-06-02

### Changed
- Adopt c3source 1.1.0 extractors, retiring the local `extraction.ts`
  (#5/#6).

### Docs
- Document the cwd-vs-package-root rule and the release process.

## [0.1.3] - 2026-06-02

### Fixed
- Wire CLI `--version` to the package version (previously reported
  `"unknown"`).

## [0.1.2] - 2026-06-02

### Changed
- Bump `@genvid/c3source` to `^1.0.0`.

### Fixed
- Patch `serialize-javascript` (#4).

## [0.1.1] - 2026-05-31

### Changed
- Bump `@genvid/c3source` to `^0.4.0`.

## [0.1.0] - 2026-05-31

Initial release, versioned as `@genvid/c3-domain-manager` — this and every
version through `0.6.0` were tagged but **never published to npmjs.com** (see
the npm history note below).

### Added
- Initial release of the domain analysis CLI and MCP server.

### Changed
- Package renamed to `c3-domain-manager`; migrated to the public `@genvid`
  npm scope.
- Wired up package publishing through `genvid-public-ci`. Note this predates
  the move to npmjs.com trusted publishing — nothing from this era reached
  the public registry (see the npm history note below).

### Fixed
- CLI/CI fixes: 1Password credential injection, Azure credentials,
  `@types/node`, `--no-frozen-lockfile`.
- Tag/branch slug uploads and tag filters; `.tgz` CI artifact.
- Fix a stale command referenced in the MCP auto-generation failure message.

---

## Note on npm publish history

npm currently lists only four published versions of this package, all under
the `@genvidtech` scope: `0.0.1`, `0.6.1`, `0.6.2`, `0.7.0`.

- **`0.0.1` (2026-06-30) is not a real release.** It is an OIDC
  trusted-publishing bootstrap stub, published to establish the trusted
  publisher relationship before the first real release went out.
- **Nothing before `0.6.1` was ever published to npm** — every tagged
  version from `0.1.0` through `0.5.0`, plus the untagged `0.6.0` work.
  They existed only as `@genvid/*`-scoped `package.json` versions and, for
  `0.1.0`–`0.5.0`, git tags. `0.6.1` (2026-06-30), published under the
  renamed `@genvidtech` scope, is the first version that ever reached the
  npm registry.

There is also a stray unprefixed `0.1.0` tag (dated 2026-04-03, predating the
`v`-prefixed `v0.1.0` tag above) left over from before the tag naming
convention was adopted; it does not correspond to a separate release.

[Unreleased]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.5.0...v0.6.1
[0.5.0]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/GenvidTechnologies/c3-domain-manager/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/GenvidTechnologies/c3-domain-manager/releases/tag/v0.1.0
