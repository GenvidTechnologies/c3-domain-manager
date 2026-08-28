#!/usr/bin/env node
// verify-behaviour-preservation.mjs — issue #77 acceptance rows A3 / A3-M.
//
// Proves the mcp-server registry rewrite (task group F1) changed nothing
// observable at N=1: it drives the 11 read-side tools that emit no `txId`
// (read-domain-index, read-domain-config, list-uncategorized,
// list-stale-overrides, regenerate, glossary-check, validate-boundaries,
// validate-editor, addon-inventory, domain-health, context-map) against a
// detached worktree checked out at `8dc593e` (pre-rewrite `main`) and against
// the current working tree, over a fresh synthetic project each, and asserts
// their output is byte-identical after normalizing only the incidental
// per-run project-root path.
//
// Deliberately NOT a mocha test / not wired into `npm test`: it clones a
// second checkout and runs `npm ci` in it, which is slow and
// network-dependent — exactly the kind of on-demand, re-runnable-but-not-
// hermetic verification `npm run corpus:scan` already established a place
// for in this repo (see CLAUDE.md "Commands"). Anchoring "before" to a commit
// rather than a consumed snapshot keeps this row re-runnable after merge —
// there is no fixture to go stale.
//
// Usage:
//   npm run verify:behaviour-preservation            # A3
//   npm run verify:behaviour-preservation -- --mutant # A3-M (see below)
//
// A3-M injects a one-line mutation into `src/adapters/locations.ts`'s
// `resolveLocations` (the default `extractedDir` branch, `"extracted"` ->
// `"extracted-MUTANT"`) before running the working-tree side, to prove this
// comparison can actually detect a real behavioural change (an empty diff is
// unfalsifiable on its own — a broken comparison and a correct one both
// produce no difference). The `regenerate` tool's log line embeds
// `extractedDir` ("Generated domain index with N domains in <path>"), so the
// mutated run's `regenerate` output differs from the unmutated baseline even
// after root-path normalization. This script does not apply the mutation
// itself (that would defeat the point of grep-confirming the injection
// landed before reading the run) — see the operator's own manual A3-M
// procedure recorded in the task's report.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE_COMMIT = "8dc593e";

const TOOLS = [
  ["read-domain-index", {}],
  ["read-domain-config", {}],
  ["list-uncategorized", {}],
  ["list-stale-overrides", {}],
  ["regenerate", {}],
  ["glossary-check", {}],
  ["validate-boundaries", {}],
  ["validate-editor", {}],
  ["addon-inventory", {}],
  ["domain-health", {}],
  ["context-map", { format: "text" }],
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Build one shared synthetic project shape, deterministic across both sides. */
function buildProject(root) {
  const write = (rel, content) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  write(
    "domain-config.json",
    JSON.stringify(
      {
        domains: {
          Alpha: { description: "Alpha domain", eventSheetDirs: ["alpha"], layoutDirs: ["alpha"] },
          Beta: { description: "Beta domain", eventSheetDirs: ["beta"] },
        },
        overrides: { "eventSheets/stale/missing.json": "Alpha" },
        relationships: [{ from: "Beta", to: "Alpha", type: "customer-supplier" }],
      },
      null,
      "\t",
    ) + "\n",
  );

  write("eventSheets/alpha/A1.json", JSON.stringify({ name: "alpha/A1", events: [], sid: 1 }));
  write("eventSheets/beta/B1.json", JSON.stringify({ name: "beta/B1", events: [], sid: 1 }));
  // Deliberately unclassified — exercises list-uncategorized non-trivially.
  write("eventSheets/gamma/G1.json", JSON.stringify({ name: "gamma/G1", events: [], sid: 1 }));
  write("layouts/alpha/L1.json", JSON.stringify({ name: "alpha/L1", layers: [], eventSheet: "alpha/A1" }));

  // Minimal-but-valid manifest (shape mirrors test/domain/addonInventory.test.ts's
  // makeMinimalManifest) so addon-inventory takes its real path instead of
  // erroring on a missing project.c3proj.
  const emptyNameFolder = { items: [], subfolders: [] };
  const emptyFileFolder = { items: [], subfolders: [] };
  write(
    "project.c3proj",
    JSON.stringify({
      projectFormatVersion: 1,
      savedWithRelease: 48703,
      name: "a3-behaviour-preservation",
      runtime: "c3",
      usedAddons: [],
      objectTypes: emptyNameFolder,
      layouts: emptyNameFolder,
      eventSheets: emptyNameFolder,
      timelines: emptyNameFolder,
      flowcharts: emptyNameFolder,
      families: emptyNameFolder,
      models3d: emptyNameFolder,
      containers: [],
      rootFileFolders: {
        script: emptyFileFolder,
        sound: emptyFileFolder,
        music: emptyFileFolder,
        video: emptyFileFolder,
        font: emptyFileFolder,
        icon: emptyFileFolder,
        general: emptyFileFolder,
      },
      properties: {},
    }),
  );
}

async function runTools(cwd, projectRoot) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts", "server", "--project-dir", projectRoot],
    cwd,
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {}); // drain so the child never blocks on a full pipe

  const client = new Client({ name: "verify-behaviour-preservation", version: "0.0.0" });
  await client.connect(transport);

  const out = {};
  try {
    for (const [name, args] of TOOLS) {
      const res = await client.callTool({ name, arguments: args }, CallToolResultSchema);
      out[name] = (res.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }
  } finally {
    await client.close();
  }
  return out;
}

/**
 * Strips the run's own project-root absolute path (incidental — a fresh temp
 * dir per side) while leaving everything after it intact. That "everything
 * after" is exactly what A3-M's mutation lands in (`extracted` vs
 * `extracted-MUTANT`), so this must not swallow more than the root itself.
 */
function stripRoot(text, root) {
  const forward = root.replace(/\\/g, "/");
  return text.split(root).join("<ROOT>").split(forward).join("<ROOT>");
}

async function main() {
  const mutant = process.argv.includes("--mutant");

  console.log(`[verify] adding a detached worktree at ${BASE_COMMIT}...`);
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-a3-worktree-"));
  fs.rmdirSync(worktreeDir); // `git worktree add` requires the target to not exist yet.
  execFileSync("git", ["worktree", "add", "--detach", worktreeDir, BASE_COMMIT], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  let anyDiff = false;
  try {
    console.log("[verify] npm ci in the worktree (network + slow — this is why this script is not part of `npm test`)...");
    // Windows can't execFileSync a .cmd shim without a shell (EINVAL); pass
    // the whole command as one string so shell:true has nothing to
    // mis-concatenate (avoids node's DEP0190 array+shell warning too).
    execFileSync(process.platform === "win32" ? "npm.cmd ci" : "npm ci", { cwd: worktreeDir, stdio: "inherit", shell: true });

    const oldRoot = fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-a3-old-"));
    const newRoot = fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-a3-new-"));
    try {
      buildProject(oldRoot);
      buildProject(newRoot);

      console.log(`[verify] running the 11 tools against the old (${BASE_COMMIT}) server...`);
      const oldOut = await runTools(worktreeDir, oldRoot);

      console.log(`[verify] running the 11 tools against the working-tree server${mutant ? " (--mutant)" : ""}...`);
      const newOut = await runTools(repoRoot, newRoot);

      for (const [name] of TOOLS) {
        const a = stripRoot(oldOut[name] ?? "", oldRoot);
        const b = stripRoot(newOut[name] ?? "", newRoot);
        if (a !== b) {
          anyDiff = true;
          console.log(`\n[verify] DIFFERS: ${name}`);
          console.log(`--- old (${BASE_COMMIT}) ---\n${a}`);
          console.log(`--- new (working tree) ---\n${b}`);
        } else {
          console.log(`[verify] identical: ${name}`);
        }
      }
    } finally {
      fs.rmSync(oldRoot, { recursive: true, force: true });
      fs.rmSync(newRoot, { recursive: true, force: true });
    }

    if (mutant) {
      if (!anyDiff) {
        console.error("\n[verify] A3-M FAILED: the mutation produced no observable difference — the comparison, not the code, is what's being measured.");
        process.exitCode = 1;
      } else {
        console.log("\n[verify] A3-M: mutation control confirmed — a real difference was observed, as expected.");
      }
    } else {
      if (anyDiff) {
        console.error("\n[verify] A3 FAILED: behaviour is not preserved at N=1.");
        process.exitCode = 1;
      } else {
        console.log("\n[verify] A3 PASSED: all 11 tools produced identical output.");
      }
    }
  } finally {
    console.log("[verify] removing the worktree...");
    execFileSync("git", ["worktree", "remove", "--force", worktreeDir], { cwd: repoRoot, stdio: "inherit" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
