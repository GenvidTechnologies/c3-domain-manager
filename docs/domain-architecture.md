# Domain Architecture

How to organize a Construct 3 project into domains, configure classification, and use the analysis tools.

## Overview

A domain in this context is a named grouping of source files (event sheets, layouts, scripts) that map to a coherent user-facing feature area. Grouping files this way makes it easier to:

- Find where a change should be made
- Measure coupling between features
- Enforce architectural boundaries

The groupings are declared in `domain-config.json` at the project root. The `c3-domain-manager` package reads this file to classify files, generate a browsable index, and run health and boundary checks.

## Primary domains vs shared subdomains

**Primary domains** represent distinct user experiences — each one owns a vertical slice of the product. Examples: Authentication, Gameplay, Shop & Economy.

**Shared subdomains** contain code that is genuinely reused across multiple primary domains. Examples: UI Components, Chat, Analytics.

A shared subdomain is worth defining only when both conditions hold:

1. Multiple domains include the same event sheets, layouts, or scripts
2. Knowing the subdomain actually narrows down where to look for a change

If different domains implement the same concept independently (e.g. each domain has its own reward screen), a shared subdomain would not help — the concept is not shared at the code level.

## domain-config.json structure

```json
{
  "domains": {
    "Authentication": {
      "description": "Login, device binding, user profile",
      "strategy": "supporting",
      "eventSheetDirs": ["Login", "Profile"],
      "layoutDirs": ["Login"],
      "scriptDirs": ["Auth"],
      "glossary": {
        "session": "An authenticated user session with a backend token"
      }
    }
  },
  "sharedSubdomains": {
    "UI Components": {
      "description": "Reusable UI widgets used across domains",
      "scriptDirs": ["UI"]
    }
  },
  "overrides": {
    "eventSheets/Shared/ChatEvents.json": "Watch Content"
  },
  "relationships": [
    {
      "from": "Gameplay",
      "to": "Authentication",
      "type": "conformist",
      "description": "Gameplay reads the authenticated user ID without influencing Auth"
    }
  ]
}
```

### domains

Each entry under `domains` is a primary domain. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | One-line summary of what this domain covers |
| `strategy` | `"core"` \| `"supporting"` \| `"generic"` | DDD strategic classification (optional) |
| `eventSheetDirs` | string[] | Subdirectories of `eventSheets/` owned by this domain |
| `layoutDirs` | string[] | Subdirectories of `layouts/` owned by this domain |
| `scriptDirs` | string[] | Subdirectories of `scripts/` owned by this domain |
| `glossary` | Record<string, string> | Domain-specific term definitions (optional) |

### sharedSubdomains

Same structure as `domains`. Entries here are flagged as shared in the generated index and health reports.

### overrides

A flat map of `relativePath → domainName`. Overrides take precedence over directory-based classification. Use them for files that live in a directory owned by one domain but logically belong to another.

Paths are relative to the project root, using forward slashes: `eventSheets/Shared/Chat.json`.

### relationships

Optional. Declares the expected integration patterns between domains using DDD relationship types:

| Type | Meaning |
|------|---------|
| `shared-kernel` | Both teams share a subset of code and coordinate changes |
| `customer-supplier` | Downstream team (customer) depends on upstream team (supplier) |
| `conformist` | Downstream conforms to upstream's model without influence |
| `anti-corruption-layer` | Downstream translates upstream's model through an adapter |
| `open-host-service` | Upstream publishes a stable protocol for any consumer |

Declared relationships are checked by `validate-boundaries`. Observed dependencies (found in event sheet includes) that are not declared produce warnings.

## File classification rules

Files are classified in two steps:

1. **Exact override** — if the file's relative path appears in `overrides`, that domain wins. This has highest priority.
2. **Directory prefix** — the file's path (stripped of the file-type root, e.g. `eventSheets/`) is matched against `eventSheetDirs` / `layoutDirs` / `scriptDirs`. The longest matching prefix wins, allowing nested directories to override parent directories.

File type roots:

| File type | Root directory |
|-----------|----------------|
| `eventSheet` | `eventSheets/` |
| `layout` | `layouts/` |
| `script` | `scripts/` |

Example: a file at `eventSheets/Battle/Skills/ActiveSkills.json` with config `eventSheetDirs: ["Battle"]` matches `Battle/` and is classified under that domain. If a second domain declares `eventSheetDirs: ["Battle/Skills"]`, the longer prefix wins and the file goes to the second domain.

Files that match no rule are "uncategorized". Run `c3-domain-manager list-uncategorized` to find them.

## Strategic classification

The optional `strategy` field on a domain or subdomain marks its DDD strategic role:

- **core** — competitive differentiator; invest heavily, do not outsource
- **supporting** — necessary but not differentiating; can be built with standard solutions
- **generic** — commodity capability; prefer off-the-shelf solutions

`validate-boundaries` uses this to enforce direction rules. For example, a `supporting` domain should not depend on a `core` domain (that would invert the dependency direction).

## Generated domain index

Running `c3-domain-manager generate` (or `regenerate` via MCP) writes files to `extracted/domain-index/`:

- `index.md` — master index listing all domains with file counts and descriptions
- `<DomainName>.md` — per-domain page with:
  - File lists (event sheets, layouts, scripts)
  - Exported function signatures extracted from event sheets
  - Include graph (which sheets include which, within and across domains)
  - Cross-domain dependency summary

Commit `extracted/domain-index/` to version control so the index is always available without regenerating.

## Paths and locations

By default the tool reads `domain-config.json` from the target project root (your current working directory) and writes generated output to `extracted/` there. Both can be overridden:

| Flag | Default | Effect |
|------|---------|--------|
| `--config <path>` | `<project-root>/domain-config.json` | Selects the domain-config file. |
| `--extracted <path>` | `<project-root>/extracted` | Selects the domain-index output directory. |

Relative paths for both flags resolve against the **target project root** (the process working directory), never the package install directory. Absolute paths are used as-is. Operator-supplied paths are trusted — paths outside the project root are intentionally allowed.

**Ephemeral mode** — pass `none` as the `--extracted` value to route output into a temporary directory that is automatically deleted when the command finishes (or when the MCP server shuts down on SIGINT/SIGTERM). This is useful as a no-side-effect validation pass: generation runs but leaves no files behind in the project tree.

When using the MCP server, the resolved locations are forwarded from the CLI `server` command via `startServer(loc: ResolvedLocations)`. There are no environment variables.

## Health metrics

`domain-health` (MCP tool or library `computeHealth`) computes per-domain:

- **Ca (afferent coupling)** — how many other domains depend on this domain
- **Ce (efferent coupling)** — how many domains this domain depends on
- **Instability** — `Ce / (Ca + Ce)`, range 0–1. 0 is maximally stable (nothing it depends on can break it); 1 is maximally unstable (many dependencies, no dependents)

High instability in a core domain is a warning sign.

## Boundary validation

`validate-boundaries` (MCP tool or library `validateBoundaries`) checks:

- **Undeclared dependencies** — domain A includes sheets from domain B, but no relationship is declared from A to B
- **Stale declarations** — a declared relationship has no corresponding observed dependency
- **Forbidden directions** — e.g. a `supporting` domain depending on a `core` domain

Filter to a single domain by passing the `domain` parameter.

## Glossary collision detection

Each domain can define a `glossary` map of terms to definitions. `glossary-check` collects all definitions across domains and reports terms that appear with different definitions in different domains. These collisions indicate shared language that may need alignment.

## Maintenance

- After adding or renaming files, run `c3-domain-manager list-uncategorized` to confirm coverage
- After deleting files, run `c3-domain-manager list-stale-overrides` to clean up orphaned override entries
- Regenerate the domain index after any `domain-config.json` change: `c3-domain-manager generate`
