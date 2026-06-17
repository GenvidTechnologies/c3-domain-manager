# c3-domain-manager

Domain-driven design analysis for Construct 3 projects. Classifies source files into domains, parses event sheet dependencies, and provides health and boundary validation — all driven by a single `domain-config.json` file.

## What it does

- **File classification** — maps `eventSheets/`, `layouts/`, and `scripts/` files to named domains using directory patterns and per-file overrides
- **Domain index generation** — writes markdown pages to `extracted/domain-index/` with per-domain file lists, function signatures, and include graphs
- **Health metrics** — computes coupling (Ca/Ce) and instability scores for each domain
- **Boundary validation** — detects undeclared cross-domain dependencies and forbidden dependency directions
- **Glossary collision detection** — flags terms defined differently across domains
- **Context map** — generates text or Mermaid diagrams of inter-domain relationships
- **Editor-strictness validation** — reports event sheets the C3 editor would refuse to import (e.g. missing required fields on `variable` or `group` events)
- **MCP server** — exposes all of the above as Model Context Protocol tools for AI agents

## Requirements

- Node.js >= 22
- A Construct 3 project with `eventSheets/`, `layouts/`, and `scripts/` directories
- A `domain-config.json` at the project root (see [docs/domain-architecture.md](docs/domain-architecture.md))

## Installation

Install from npm:

```bash
npm install @genvid/c3-domain-manager
```

Or run the CLI without installing:

```bash
npx @genvid/c3-domain-manager generate
```

## Quick start

### 1. Create domain-config.json

At the root of your Construct 3 project:

```json
{
  "domains": {
    "Authentication": {
      "description": "Login, device binding, user profile",
      "eventSheetDirs": ["Login", "Profile"],
      "layoutDirs": ["Login"],
      "scriptDirs": ["Auth"]
    },
    "Gameplay": {
      "description": "Battle loop, enemies, skills",
      "eventSheetDirs": ["Battle", "Enemies"],
      "layoutDirs": ["Levels"],
      "scriptDirs": ["Battle", "Skills"]
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
  }
}
```

### 2. Generate the domain index

Run from your project root:

```bash
npx @genvid/c3-domain-manager generate
```

This writes markdown pages to `extracted/domain-index/`.

### 3. Check coverage

```bash
npx @genvid/c3-domain-manager list-uncategorized
```

Lists files not covered by any domain mapping.

## CLI reference

Run any subcommand with `--help` for full usage.

| Subcommand | Description |
|------------|-------------|
| `generate` | Generate domain index at `extracted/domain-index/` |
| `list-uncategorized` | List files not mapped to any domain |
| `list-stale-overrides` | List override entries pointing to non-existent files |
| `validate-editor` | Report event sheets the C3 editor would reject (editor-strictness validation) |
| `server` | Start the MCP server (stdio transport) |

All subcommands share three global options:

| Option | Default | Description |
|--------|---------|-------------|
| `--project-dir <path>` | auto-detected | C3 project source root (`eventSheets/`, `layouts/`, `scripts/`). Auto-detected from a `project.c3proj` marker in the current dir or an immediate child; also honoured via the `C3_PROJECT_DIR` env var. Relative paths resolve from the current directory. |
| `--config <path>` | `<project-root>/domain-config.json` | Path to `domain-config.json`. Relative paths resolve from the project root. |
| `--extracted <path>` | `<project-root>/extracted` | Output directory for the generated domain index. Pass `none` for an ephemeral temp dir auto-cleaned on exit. |

See [docs/domain-architecture.md](docs/domain-architecture.md#paths-and-locations) for the full `--project-dir` resolution precedence (flag > `C3_PROJECT_DIR` > `project.c3proj` discovery > cwd).

## MCP server

The MCP server exposes 13 tools over stdio, suitable for use with Claude or any MCP-compatible client.

### Starting the server

```bash
npx @genvid/c3-domain-manager server
```

Or in an MCP client config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "c3-domain-manager": {
      "command": "npx",
      "args": ["@genvid/c3-domain-manager", "server"],
      "cwd": "/path/to/your/c3-project"
    }
  }
}
```

The server auto-generates the domain index on startup if `extracted/domain-index/` does not exist.

### Available tools

**Read tools** (no side effects)

| Tool | Description |
|------|-------------|
| `read-domain-index` | Read the master index or a named domain's detail page. Supports `offset`/`limit` pagination. |
| `read-domain-config` | Read `domain-config.json` in formatted text. Filter by `section`: `domains`, `sharedSubdomains`, `overrides`, or `all`. |
| `list-uncategorized` | List files with no domain assignment. |
| `list-stale-overrides` | List override entries whose files no longer exist on disk. |
| `get-state` | Return current `txId` and `domainDirty` flag. |
| `glossary-check` | Report glossary terms that are defined differently across domains. |
| `validate-boundaries` | Report undeclared cross-domain dependencies and forbidden dependency directions. |
| `domain-health` | Compute Ca, Ce, and instability metrics per domain. |
| `context-map` | Generate a context map in `text` or `mermaid` format. |
| `validate-editor` | Report event sheets the C3 editor would reject. Re-walks sheets fresh from disk; never reads the cached domain index. |

**Mutate tools** (modify `domain-config.json`)

| Tool | Description |
|------|-------------|
| `set-overrides` | Add or update file-to-domain override entries. Accepts optional `txId` for optimistic concurrency. |
| `remove-overrides` | Remove override entries by file path. |

**Regenerate tools**

| Tool | Description |
|------|-------------|
| `regenerate` | Re-run the domain index generator and clear the `domainDirty` flag. |

### Stale index warning

If `domain-config.json` changes while the server is running, mutate tools mark the index as dirty. Read tools that depend on the index append a warning: `[Warning: domain index may be stale — run regenerate to refresh]`. Call `regenerate` to clear it.

### Optimistic concurrency

`set-overrides` and `remove-overrides` accept an optional `txId`. If provided, the write is rejected when the server's current `txId` does not match. Use `get-state` to read the current `txId` before a write sequence.

## Library API

Import directly in TypeScript:

```typescript
import {
  classifyFile,
  generateDomainIndex,
  computeDomainData,
  listUncategorized,
  listStaleOverrides,
  validateEditorStrictness,
  formatEditorStrictnessReport,
} from "@genvid/c3-domain-manager";
```

Key exports from `src/index.ts`:

| Export | Module | Description |
|--------|--------|-------------|
| `classifyFile(path, fileType, config)` | `classification` | Classify one file path into a domain name |
| `generateDomainIndex(root, extracted, configDir, configFileName, log)` → `Promise` | `domainGenerator` | Async I/O entry point — validates config via `DomainConfigSchema`, writes index |
| `computeDomainData(root, config)` | `domainGenerator` | Pure computation — returns `DomainData[]` without I/O |
| `listUncategorized(root, config)` | `domainAnalysis` | Return file paths not covered by the config |
| `listStaleOverrides(root, config)` | `domainAnalysis` | Return override keys whose files are missing |
| `collectGlossary(config)` | `glossary` | Collect all glossary entries across domains |
| `findCollisions(entries)` | `glossary` | Find terms with conflicting definitions |
| `validateBoundaries(domains, config, filter?)` | `relationships` | Check declared vs observed dependencies |
| `computeHealth(domain)` | `health` | Ca, Ce, instability for one `DomainData` |
| `generateContextMap(domains, config, opts)` | `contextMap` | Produce text or Mermaid context map |
| `validateEditorStrictness(root, config, log?)` | `editorValidation` | Re-walk event sheets and return issues grouped by sheet |
| `formatEditorStrictnessReport(report)` | `editorValidation` | Render an `EditorStrictnessReport` to text |

Type definitions are in `src/domain/types.ts`: `DomainConfig`, `DomainDefinition`, `SharedSubdomainDefinition`, `DomainData`, `Relationship`, `FunctionDef`. Editor-validation types (`EditorStrictnessReport`, `EditorStrictnessSheetReport`) are in `src/domain/editorValidation.ts`.

## Further reading

- [docs/domain-architecture.md](docs/domain-architecture.md) — domain model concepts, configuration schema, classification rules
