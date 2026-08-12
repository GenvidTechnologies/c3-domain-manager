# Releasing

How to cut a new release of `@genvidtech/c3-domain-manager`. Routine releases are
fully self-service — this repo is already wired for OIDC **trusted publishing**,
so there is no npm token to manage and nothing in the `publish-npm-package` skill
to re-run (that skill is one-time setup, not per-release).

## TL;DR

```bash
# 1. Land all release content on main first (the tag publishes whatever main points at).
# 2. Bump the version (patch for fixes, minor for features) — updates all 3 spots, no commit/tag:
npm version X.Y.Z --no-git-tag-version
# 3. Move CHANGELOG.md's "## [Unreleased]" under a "## [X.Y.Z] - YYYY-MM-DD" heading,
#    open a fresh empty Unreleased, and update the link refs at the foot of the file.
#    A "### Removed" entry marked BREAKING means step 2 had to be a MINOR (pre-1.0 rule).
# 4. Commit + tag + push:
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: Release X.Y.Z"     # see message shape below
git tag vX.Y.Z                            # lightweight tag — matches recent convention
git push origin main
git push origin vX.Y.Z                    # this push triggers the publish workflow
# 5. After it publishes: file the downstream plugin update request (step 8).
```

## Step by step

1. **Bump the version.** Choose the bump per semver — patch (`0.1.2 → 0.1.3`) for a
   bug fix, minor for a backward-compatible feature. **At `0.x`, a breaking change to
   the public API takes a minor bump even when the work is a bug fix** — removing or
   renaming an exported function/type (anything re-exported from `src/index.ts`) is
   the pre-1.0 "breaking" signal. Example: `0.1.3 → 0.2.0` for issue #5, which fixed
   the extraction by retiring the public `extractIncludes`/`extractFunctions` exports.
   Run `npm version X.Y.Z --no-git-tag-version` — it updates all **three** spots and
   makes **no commit and no tag**, so you keep control of the message and tag style
   below:
   - `package.json` → `"version"`
   - `package-lock.json` → the top-level `"version"`
   - `package-lock.json` → `packages."".version` (the root package entry, ~line 9)

   (You can edit the three spots by hand instead, but that risks missing the second
   `package-lock.json` spot; the flag-driven bump is safer. See the note below.)

2. **Move the `CHANGELOG.md` `## Unreleased` section under a version heading.**
   Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, open a fresh empty
   `## [Unreleased]` above it, and add the two link-reference lines at the foot of
   the file (`[Unreleased]` now compares `vX.Y.Z...HEAD`; `[X.Y.Z]` compares
   `vW.V.U...vX.Y.Z`). The changelog is committed **in the same `chore: Release`
   commit** as the version bump, so the tag points at a tree whose changelog already
   describes the release.

   **This step is also where the version choice gets sanity-checked**, because
   `## Unreleased` is where a breaking change was recorded when it landed. A
   `### Removed` entry marked BREAKING means step 1's bump must be a **minor**, per
   the pre-1.0 rule above — the changelog is the durable record of that, since the
   PR that caused it is long merged by release time. (Example: the `isCompiledSibling`
   removal in #48 is recorded exactly this way, and forces a minor on the next
   release.)

3. **Commit** with the project's release-commit shape — a `chore: Release X.Y.Z`
   subject, a short body summarising what the release contains (issue refs welcome),
   and the standard co-author trailer:

   ```
   chore: Release 0.1.3

   Patch release fixing `--version` reporting "unknown" instead of the
   package version (#3).

   Co-Authored-By: <current model> <noreply@anthropic.com>
   ```

4. **Tag.** Use a **lightweight** tag matching the recent convention
   (`v0.1.1`, `v0.1.2`, `v0.1.3` are lightweight; only the original `v0.1.0` was
   annotated):

   ```bash
   git tag vX.Y.Z
   ```

5. **Push the commit, then the tag.** The tag is what triggers publishing:

   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

6. **Watch the publish.** The tag push fires `.github/workflows/publish.yml`
   (trigger: `push` on `v*.*.*`). It runs the shared `public-github-actions` node-gate,
   then publishes to npm via OIDC trusted publishing (automatic provenance, no
   stored token). Confirm:

   ```bash
   gh run list --workflow Publish --limit 1
   npm view @genvidtech/c3-domain-manager version   # should show the new version as latest
   ```

7. **Smoke-check the CLI version** (catches the class of bug that motivated this doc):

   ```bash
   npx -y @genvidtech/c3-domain-manager@X.Y.Z --version   # prints X.Y.Z, not "unknown"
   ```

8. **File the downstream plugin update request.** The `gvt-construct3` plugin
   (`GenvidTechnologies/claude-code-plugin-gvt-construct3`) **pins** this package in
   `plugin/.claude-plugin/plugin.json` (`mcpServers.c3-domain-manager`, e.g.
   `@genvidtech/c3-domain-manager@0.3.0`) and references the pinned version in its
   `c3-explorer` / `c3-implementer` agent docs. Every publish here therefore needs a
   follow-up issue there to bump the pin and reconcile the tool surface. Open one with
   `gh issue create --repo GenvidTechnologies/claude-code-plugin-gvt-construct3`, and call out
   any **MCP tool-surface change** (a tool added/renamed/removed) — that repo runs
   `docs/tool-surface-reconciliation.md` and updates the `c3-explorer` `tools:`
   allow-list off it. Example: 0.4.0 added the `validate-editor` READ_ONLY tool, so the
   request flagged it for the allow-list (issue
   [#12](https://github.com/GenvidTechnologies/claude-code-plugin-gvt-construct3/issues/12)).

## Notes & gotchas

- **`process.cwd()` is the target project, not this package.** The CLI reads its
  own version from `package.json` resolved via `import.meta.url`. If you add files
  the published CLI must read at runtime, resolve them relative to the module, never
  `cwd`. See the "TypeScript / module setup" section in `CLAUDE.md`.
- **Why `npm version --no-git-tag-version` and not a bare `npm version`?** A bare
  `npm version patch` bumps all three spots but *also* makes a commit (default message
  `X.Y.Z`) and an **annotated** tag — neither matches the `chore: Release X.Y.Z` +
  lightweight-tag + co-author-trailer convention. The `--no-git-tag-version` flag keeps
  the correct three-spot bump while making no commit and no tag, so you commit and
  lightweight-tag by hand (steps 3–4) to match the convention. Hand-editing the three
  spots also works but risks missing the second `package-lock.json` spot
  (`packages."".version`).
- **If the version bump already landed with the feature/fix branch**, the release step
  is just *tag the merge commit* — there's no need for a separate `chore: Release X.Y.Z`
  commit. The tag publishes whatever `main` points at, and `main` already carries the
  bumped version. (This is how issue #5 shipped: `package.json`/`package-lock.json` were
  bumped to `0.2.0` in the fix branch, so releasing it is a one-step `git tag v0.2.0`.)
- **A republish of an already-published version is rejected by npm.** If the publish
  workflow fails *after* the version was published, bump to the next patch rather than
  retrying the same version.
- **Publish entry-point pitfall:** keep `main`/`types`/`exports` at the top level of
  `package.json` pointing at `./dist/...`; do not move them into `publishConfig`
  (see the "Publish pitfall" note in `CLAUDE.md`). Verify against `npm pack` if in doubt.
