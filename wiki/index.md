---
okf_version: "0.2"
---

<!-- `okf_version` is the ONLY frontmatter key permitted here (§8/§12) — this
     file is the bundle-root index (`wiki/index.md`, the OKF bundle root).
     A `wiki/<subdir>/index.md` carries NO frontmatter at all. -->

# Wiki Index

This is the wiki's table of contents — every page under `wiki/`, grouped under
section headings, one line each. `/gvt-dev:maintain-wiki` keeps this list
current: a new page is added here when it's created, and `lint` flags any page
listed in **no** index — here, or in a subdirectory's own `index.md`. Each
entry's description is the linked page's frontmatter `description`, so the
index and the page can't drift. See `docs/wiki-schema.md` for the page format
and maintenance rules.

## Testing & Platform

- [fs.watch platform behaviour and the test shapes it forces](fs-watch-platform-behaviour.md) — fs.watch fires 2 events per write on Windows (ReadDirectoryChangesW) and 1 on Linux (inotify), invariant across node majors — a platform confound CI structurally cannot see, closed by a 3x2 matrix, with an observation-gated test shape that expires the moment the divergence is fixed.

## Dependency Management

- [Route a shared-primitive defect upstream, not around it](upstream-dependency-routing.md) — When a defect or a missing primitive sits inside a first-party dependency's shared code, route the fix to that dependency's own repo rather than patching around it locally — but verify the fix actually closes the symptom, not just the mechanism it targeted.

## Documentation Practice

- [How a summary silently diverges from the record it summarizes](documentation-drift-modes.md) — Three distinct shapes of documentation drift measured in this repo's ADR history — a gloss that inverts a decision, a sibling ADR misattributing a mechanism, and a framing sentence that sends work down a premise the records themselves deny — and what checkable action closes each.
