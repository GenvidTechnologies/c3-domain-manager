# Releasing

How to cut a new release of `@genvid/c3-domain-manager`. Routine releases are
fully self-service — this repo is already wired for OIDC **trusted publishing**,
so there is no npm token to manage and nothing in the `publish-npm-package` skill
to re-run (that skill is one-time setup, not per-release).

## TL;DR

```bash
# 1. Land all release content on main first (the tag publishes whatever main points at).
# 2. Bump the version (patch for fixes, minor for features) in BOTH files, 3 spots total:
#      package.json        → "version"
#      package-lock.json    → top-level "version" AND packages."".version
# 3. Commit + tag + push:
git add package.json package-lock.json
git commit -m "chore: Release X.Y.Z"     # see message shape below
git tag vX.Y.Z                            # lightweight tag — matches recent convention
git push origin main
git push origin vX.Y.Z                    # this push triggers the publish workflow
```

## Step by step

1. **Bump the version.** Choose the bump per semver — patch (`0.1.2 → 0.1.3`) for a
   bug fix, minor for a backward-compatible feature. Update **three** locations
   (a bare `npm version` would do this, but see the note below on why we do it by hand):
   - `package.json` → `"version"`
   - `package-lock.json` → the top-level `"version"`
   - `package-lock.json` → `packages."".version` (the root package entry, ~line 9)

2. **Commit** with the project's release-commit shape — a `chore: Release X.Y.Z`
   subject, a short body summarising what the release contains (issue refs welcome),
   and the standard co-author trailer:

   ```
   chore: Release 0.1.3

   Patch release fixing `--version` reporting "unknown" instead of the
   package version (#3).

   Co-Authored-By: <current model> <noreply@anthropic.com>
   ```

3. **Tag.** Use a **lightweight** tag matching the recent convention
   (`v0.1.1`, `v0.1.2`, `v0.1.3` are lightweight; only the original `v0.1.0` was
   annotated):

   ```bash
   git tag vX.Y.Z
   ```

4. **Push the commit, then the tag.** The tag is what triggers publishing:

   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

5. **Watch the publish.** The tag push fires `.github/workflows/publish.yml`
   (trigger: `push` on `v*.*.*`). It runs the shared `genvid-public-ci` node-gate,
   then publishes to npm via OIDC trusted publishing (automatic provenance, no
   stored token). Confirm:

   ```bash
   gh run list --workflow Publish --limit 1
   npm view @genvid/c3-domain-manager version   # should show the new version as latest
   ```

6. **Smoke-check the CLI version** (catches the class of bug that motivated this doc):

   ```bash
   npx -y @genvid/c3-domain-manager@X.Y.Z --version   # prints X.Y.Z, not "unknown"
   ```

## Notes & gotchas

- **`process.cwd()` is the target project, not this package.** The CLI reads its
  own version from `package.json` resolved via `import.meta.url`. If you add files
  the published CLI must read at runtime, resolve them relative to the module, never
  `cwd`. See the "TypeScript / module setup" section in `CLAUDE.md`.
- **Why bump by hand instead of `npm version`?** `npm version patch` would bump all
  three spots and tag, but its default commit message (`X.Y.Z`) and tag (annotated)
  don't match the `chore: Release X.Y.Z` + lightweight-tag + co-author-trailer
  convention. Doing it by hand keeps the history consistent. If you prefer the tool:
  `npm version patch -m "chore: Release %s"` gets the message but still creates an
  annotated tag and omits the trailer.
- **A republish of an already-published version is rejected by npm.** If the publish
  workflow fails *after* the version was published, bump to the next patch rather than
  retrying the same version.
- **Publish entry-point pitfall:** keep `main`/`types`/`exports` at the top level of
  `package.json` pointing at `./dist/...`; do not move them into `publishConfig`
  (see the "Publish pitfall" note in `CLAUDE.md`). Verify against `npm pack` if in doubt.
