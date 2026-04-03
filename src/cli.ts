#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { generateDomainIndex } from "./domain/domainGenerator.js";
import { listUncategorized, listStaleOverrides } from "./domain/domainAnalysis.js";
import type { DomainConfig } from "./domain/types.js";

const PROJECT_ROOT = process.cwd();
const EXTRACTED_DIR = path.join(PROJECT_ROOT, "extracted");
const CONFIG_PATH = path.join(PROJECT_ROOT, "domain-config.json");

yargs(hideBin(process.argv))
  .command(
    "server",
    "Start the domain-manager MCP server",
    () => {},
    async () => {
      const { startServer } = await import("./mcp/server.js");
      await startServer(PROJECT_ROOT);
    },
  )
  .command(
    "generate",
    "Generate domain index",
    () => {},
    () => {
      generateDomainIndex(PROJECT_ROOT, EXTRACTED_DIR, CONFIG_PATH, console.log);
    },
  )
  .command(
    "list-uncategorized",
    "List files not mapped to any domain in domain-config.json",
    () => {},
    () => {
      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as DomainConfig;
      const files = listUncategorized(PROJECT_ROOT, config);
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
    () => {
      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as DomainConfig;
      const stale = listStaleOverrides(PROJECT_ROOT, config);
      if (stale.length === 0) {
        console.log("No stale overrides.");
      } else {
        console.log(`${stale.length} stale override(s):\n`);
        for (const s of stale) console.log(s);
      }
    },
  )
  .demandCommand(1, "Please specify a subcommand. Use --help for available commands.")
  .strict()
  .help()
  .parse();
