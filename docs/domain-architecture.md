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

Declared relationships are checked by `validate-boundaries`. Observed dependencies (found in event sheet includes and event-variable references) that are not declared produce warnings.

### Validation

The config is validated against a lenient zod schema (`DomainConfigSchema`) when loaded. "Lenient" means unknown keys are **tolerated and preserved** (so extra fields you add survive a load→edit→write round-trip through the MCP `set-overrides`/`remove-overrides` tools) and non-essential fields are optional; only `domains` and each domain's `description` are required. A missing file, malformed JSON, or a schema violation produces a clear error prefixed `loadProjectConfig(domain-config.json): …` — from the CLI it aborts the command, and from the MCP server it is returned as a structured tool error.

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
  - Event-variable reference graph (cross-domain references to/from this domain, when present)
  - Cross-domain dependency summary

Commit `extracted/domain-index/` to version control so the index is always available without regenerating.

## Paths and locations

By default the tool scans `eventSheets/`, `layouts/`, and `scripts/` under the auto-detected C3 project root, reads `domain-config.json` from that root, and writes generated output to `extracted/` there. All three locations can be overridden:

| Flag | Default | Effect |
|------|---------|--------|
| `--project-dir <path>` | auto-detected (see below) | Sets the C3 project source root — the directory whose `eventSheets/`, `layouts/`, and `scripts/` are scanned. Relative paths resolve against the **current working directory**; absolute paths are used as-is. |
| `--config <path>` | `<project-root>/domain-config.json` | Selects the domain-config file. |
| `--extracted <path>` | `<project-root>/extracted` | Selects the domain-index output directory. |

Relative paths for `--config` and `--extracted` resolve against the **project root** (as set by `--project-dir` or auto-detection), never the package install directory. Absolute paths are used as-is. Operator-supplied paths are trusted — paths outside the project root are intentionally allowed.

**`--project-dir` resolution precedence** (highest to lowest):

1. **`--project-dir <path>`** — explicit flag. Relative resolves against the current working directory; absolute used as-is. No containment restriction — `../sibling` is valid.
2. **`C3_PROJECT_DIR` environment variable** — same resolution rules as the flag.
3. **Discovery** — the current directory and its immediate children (depth 1) are searched for a directory or file named `project.c3proj` (the Construct 3 project manifest). Exactly one match becomes the project root. Two or more matches produce an ambiguity error: the command prints it and exits non-zero, requiring the user to pass `--project-dir` explicitly. This is the intended behavior for a repository hosting multiple C3 projects.
4. **Fallback** — the current working directory (preserves prior behavior when no project marker is found).

This resolution is implemented by `resolveProjectRoot` in `src/adapters/locations.ts`, a thin wrapper over `@genvidtech/mcp-utils`'s `resolveRootFolder` that passes `PROJECT_MANIFEST_FILE` (from `@genvidtech/c3source`) as the discovery marker.

**Ephemeral mode** — pass `none` as the `--extracted` value to route output into a temporary directory that is automatically deleted when the command finishes (or when the MCP server shuts down on SIGINT/SIGTERM). This is useful as a no-side-effect validation pass: generation runs but leaves no files behind in the project tree.

When using the MCP server, the resolved locations are forwarded from the CLI `server` command via `startServer(loc: ResolvedLocations)`. The MCP server itself does not re-run discovery — the root is fixed at startup.

## Cross-domain coupling sources

Two independent sources contribute to the observed coupling graph between domains:

### Include coupling

Event sheets can include other event sheets using include events. When a sheet in domain A includes a sheet in domain B, that creates an include edge from A to B. The include graph is stored in `DomainData` as `includesFrom` (outgoing: A → B, payload = included sheet names) and `includedBy` (incoming: B ← A, same payload).

### Event-variable reference coupling

C3 event sheets can also reference event variables declared in other sheets via System ACEs. When a sheet in domain A references a variable that is declared in domain B, that creates a reference edge from A to B. The reference graph is stored as two sibling maps alongside the include maps: `referencesFrom` (outgoing: A → B, payload = variable names) and `referencedBy` (incoming: B ← A, same payload).

**Resolution policy:**

- **Global-scope approximation** — only top-level (sheet-root) `variable` events are indexed as declarations. C3 cross-sheet variable references require global variables, and root-level declarations are the global-scope approximation. Local variables declared inside groups or functions are deliberately excluded.
- **Attribute-to-all on collision** — if the same variable name is declared at the top level of sheets in multiple domains, a reference to that name creates an edge to every declaring domain.
- **Unresolved references produce no edge** — if the referenced variable name has no indexed (root-level) declaration anywhere in the project, the reference is silently ignored. There is no diagnostics bucket for unresolved names.
- **Same-domain references produce no edge** — consistent with include coupling, references resolved to the same domain as the referencing sheet are not recorded.

**Limitation:** only top-level declarations are indexed. Variables scoped inside a group or function block are not visible across sheets in C3, so excluding them is correct behaviour. A variable declared inside a block but referenced from another sheet would be unresolvable and fall into the "unresolved → no edge" path above.

No `domain-config.json` schema change is required — reference coupling is derived entirely from event sheet content and does not need configuration.

### How coupling surfaces in analysis

Both coupling sources are aggregated with **union semantics** across all downstream consumers:

- **Health metrics** (`computeHealth`) — Ca and Ce count the union of include-coupled and reference-coupled distinct domains, with overlap deduped (a domain that is both include-coupled and reference-coupled is counted only once).
- **Boundary validation** (`validateBoundaries`) — the undeclared-dependency and forbidden-direction checks operate over the union of include and reference target domains. A reference edge to an undeclared domain produces an `undeclared` violation exactly as an include edge would.
- **Context map** (`generateContextMap`) — reference coupling surfaces as a distinct `observed-ref` edge kind. In text format it appears as `[observed-ref]`; in Mermaid it renders as `-.->|var|`. Edge precedence is: declared > observed (include) > observed-ref. An include and a reference to the same domain pair produce only the higher-precedence edge.
- **Domain pages** (`formatDomainPage`) — the "Cross-Domain Dependencies" section gains two subsections: "Event-variable references from this domain" and "Event-variable references into this domain", rendered only when the respective map is non-empty.

## Health metrics

`domain-health` (MCP tool or library `computeHealth`) computes per-domain:

- **Ca (afferent coupling)** — how many other domains depend on this domain (via includes or event-variable references)
- **Ce (efferent coupling)** — how many domains this domain depends on (via includes or event-variable references)
- **Instability** — `Ce / (Ca + Ce)`, range 0–1. 0 is maximally stable (nothing it depends on can break it); 1 is maximally unstable (many dependencies, no dependents)

High instability in a core domain is a warning sign.

## Boundary validation

`validate-boundaries` (MCP tool or library `validateBoundaries`) checks:

- **Undeclared dependencies** — domain A includes sheets from domain B, or references event-variables declared in domain B, but no relationship is declared from A to B
- **Stale declarations** — a declared relationship has no corresponding observed dependency
- **Forbidden directions** — e.g. a `supporting` domain depending on a `core` domain

Filter to a single domain by passing the `domain` parameter.

## Glossary collision detection

Each domain can define a `glossary` map of terms to definitions. `glossary-check` collects all definitions across domains and reports terms that appear with different definitions in different domains. These collisions indicate shared language that may need alignment.

## Editor-strictness validation

`validate-editor` (CLI subcommand or MCP `READ_ONLY` tool "Validate Editor Strictness") checks whether the target project's event sheets are structurally valid from the C3 editor's perspective. It re-walks `eventSheets/` fresh from disk, attributes each sheet to a domain via `classifyFile`, and runs `@genvidtech/c3source`'s `validateForEditor` per sheet. Issues are grouped by sheet; sheets that match no domain classification are reported under `"(unclassified)"`.

This is a read-side diagnostic only. `c3-domain-manager` never writes or modifies event sheets — the report surfaces sheets the C3 editor would refuse to import (e.g. a `variable` event missing its `comment` field, or a `group` event missing its `description`) so you can fix them in the C3 editor.

Because it reads sheets directly from disk, the MCP tool does not append the stale-index warning that other read tools emit — index freshness is irrelevant to its output.

## Maintenance

- After adding or renaming files, run `c3-domain-manager list-uncategorized` to confirm coverage
- After deleting files, run `c3-domain-manager list-stale-overrides` to clean up orphaned override entries
- Regenerate the domain index after any `domain-config.json` change: `c3-domain-manager generate`
- To check event sheets for C3 editor compatibility: `c3-domain-manager validate-editor`
