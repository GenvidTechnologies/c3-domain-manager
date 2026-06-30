#!/usr/bin/env node

import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { generateDomainIndex, loadConfig } from "./domain/domainGenerator.js";
import { listUncategorized, listStaleOverrides } from "./domain/domainAnalysis.js";
import { validateEditorStrictness, formatEditorStrictnessReport } from "./domain/editorValidation.js";
import { resolveLocations, resolveProjectRoot } from "./adapters/locations.js";
import { isMcpError } from "@genvidtech/mcp-utils";

function resolveRootOrExit(projectDir: string | undefined): string {
  const rooted = resolveProjectRoot({ projectDir });
  if (isMcpError(rooted)) {
    const msg = (rooted.content ?? [])
      .map((c) => (typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .join("\n")
      .trim();
    console.error(msg || "Failed to resolve project root.");
    process.exit(1);
  }
  return rooted.path;
}

// Resolve this package's own package.json relative to the compiled module
// (dist/cli.js → ../package.json), NOT process.cwd() which is the target project.
const PKG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const { version: PKG_VERSION } = JSON.parse(readFileSync(PKG_PATH, "utf-8")) as { version: string };

yargs(hideBin(process.argv))
  .command(
    "server",
    "Start the c3-domain-manager MCP server",
    () => {},
    async (argv) => {
      const projectRoot = resolveRootOrExit(argv["project-dir"] as string | undefined);
      const loc = resolveLocations({ config: argv.config as string | undefined, extracted: argv.extracted as string | undefined }, projectRoot);
      const { startServer } = await import("./mcp/server.js");
      await startServer(loc);
    },
  )
  .command(
    "generate",
    "Generate domain index",
    () => {},
    async (argv) => {
      const projectRoot = resolveRootOrExit(argv["project-dir"] as string | undefined);
      const loc = resolveLocations({ config: argv.config as string | undefined, extracted: argv.extracted as string | undefined }, projectRoot);
      try {
        await generateDomainIndex(loc.projectRoot, loc.extractedDir, loc.configDir, loc.configFileName, console.log);
      } finally {
        if (loc.extractedEphemeral) {
          rmSync(loc.extractedDir, { recursive: true, force: true });
        }
      }
    },
  )
  .command(
    "list-uncategorized",
    "List files not mapped to any domain in domain-config.json",
    () => {},
    async (argv) => {
      const projectRoot = resolveRootOrExit(argv["project-dir"] as string | undefined);
      const loc = resolveLocations({ config: argv.config as string | undefined }, projectRoot);
      const config = await loadConfig(loc.configDir, loc.configFileName);
      const files = listUncategorized(loc.projectRoot, config);
      if (files.length === 0) {
        console.log("All files are categorized.");
      } else {
        console.log(`${files.length} uncategorized file(s):\n`);
        for (const f of files) console.log(f);
      }
    },
  )
  .command(
    "list-stale-overrides",
    "List stale file overrides in domain-config.json",
    () => {},
    async (argv) => {
      const projectRoot = resolveRootOrExit(argv["project-dir"] as string | undefined);
      const loc = resolveLocations({ config: argv.config as string | undefined }, projectRoot);
      const config = await loadConfig(loc.configDir, loc.configFileName);
      const stale = listStaleOverrides(loc.projectRoot, config);
      if (stale.length === 0) {
        console.log("No stale overrides.");
      } else {
        console.log(`${stale.length} stale override(s):\n`);
        for (const s of stale) console.log(s);
      }
    },
  )
  .command(
    "validate-editor",
    "Report event sheets the C3 editor would reject (editor-strictness validation)",
    () => {},
    async (argv) => {
      const projectRoot = resolveRootOrExit(argv["project-dir"] as string | undefined);
      const loc = resolveLocations({ config: argv.config as string | undefined }, projectRoot);
      const config = await loadConfig(loc.configDir, loc.configFileName);
      const report = validateEditorStrictness(loc.projectRoot, config);
      console.log(formatEditorStrictnessReport(report));
    },
  )
  .option("project-dir", {
    type: "string",
    describe:
      "Path to the C3 project root to analyze (default: auto-detected — the current directory or an immediate child containing project.c3proj, else the current directory). Honors the C3_PROJECT_DIR env var. Relative paths resolve from the current directory.",
  })
  .option("config", {
    type: "string",
    describe:
      "Path to domain-config.json (default: <project-root>/domain-config.json). Relative paths resolve from the project root; absolute paths are used as-is.",
  })
  .option("extracted", {
    type: "string",
    describe:
      'Output directory for the generated domain index (default: <project-root>/extracted). Use "none" for an ephemeral temp dir auto-cleaned on exit.',
  })
  .demandCommand(1, "Please specify a subcommand. Use --help for available commands.")
  .strict()
  .version(PKG_VERSION)
  .help()
  .parse();
