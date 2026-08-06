#!/usr/bin/env node
// prep-fixture.mjs — materialize the canonical C3 test fixture from the
// `construct3-sample` submodule.
//
// Hermetic by construction: the fixture is a pure function of the pinned
// commit. Two properties get us there, and both matter.
//
//   1. `git archive HEAD` reads tracked blobs out of the object store, never
//      the submodule's working tree. So a locally-modified tracked file, an
//      untracked file the C3 editor dropped in (it writes *.uistate.json and
//      uistate/ dirs on every open), and a checkout with core.autocrlf=true
//      are all invisible here. A working-tree copy has none of that immunity:
//      it is how c3source's CI went red, materializing 11 untracked uistate
//      files that were present on a developer machine and absent in CI.
//   2. The output dir is deleted first, so nothing survives across runs. A
//      copy-only materialization accumulates leftovers indefinitely — not just
//      from a pin that removed a file, but from anything that ever touched the
//      tree. construct3-chef carried 14 stale uistate files this way, and they
//      did not fail its tests; they made two of its assertions pass vacuously.
//
// Together those remove the whole class of drift that would otherwise need a
// parity/verify script to detect, which is why this repo has none.
//
// Wired as the `pretest` hook, so a plain `npm test` materializes the fixture.
// Unlike construct3-chef's equivalent this does NOT self-init the submodule:
// CI passes `submodules: recursive` to the shared node gate, and
// actions/checkout does the ssh->https rewrite internally. A missing submodule
// is therefore a real error here, not a state to paper over — see the guards.

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRepo = path.join(repoRoot, "test", "fixtures", "construct3-sample");
const sourceDir = path.join(sourceRepo, "project");
const outputDir = path.join(repoRoot, "test", "fixtures", "canonical");

/**
 * Fail loudly rather than skipping. c3source's equivalent prints a note and
 * exits 0 so its fixture-backed tests self-skip; we deliberately do not. A
 * silent skip turns "the fixture is missing" into "the suite passed", which is
 * the same green-for-the-wrong-reason failure the hermetic materialization
 * above exists to prevent.
 */
function fail(reason) {
  console.error(`[prep-fixture] ${reason}`);
  console.error("[prep-fixture] Run: git submodule update --init");
  process.exit(1);
}

// Guard 1 — the submodule is present and carries a C3 project.
if (!existsSync(path.join(sourceDir, "project.c3proj"))) {
  fail("construct3-sample submodule is not checked out (no project/project.c3proj).");
}

// Guard 2 — it is a real git checkout, not a bare directory. `git archive`
// needs the object store, so a present-but-not-a-repo dir would fail later
// with a far less obvious message.
try {
  execFileSync("git", ["-C", sourceRepo, "rev-parse", "--git-dir"], { stdio: "pipe" });
} catch {
  fail("construct3-sample is present but is not a git repository.");
}

rmSync(outputDir, { recursive: true, force: true });

// --format=zip rather than tar: fflate reads it in-process, so there is no
// dependency on an external tar binary being reachable from an npm-spawned
// node on Windows.
const archive = execFileSync("git", ["-C", sourceRepo, "archive", "--format=zip", "HEAD", "project"], {
  maxBuffer: 1 << 28,
});

const entries = unzipSync(new Uint8Array(archive));
let count = 0;
for (const [name, bytes] of Object.entries(entries)) {
  if (name.endsWith("/")) continue; // zip directory entry
  const rel = name.replace(/^project\//, "");
  const dest = path.join(outputDir, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  // Written byte-for-byte — never re-serialized. The C3 export's exact bytes
  // (tab indentation, no trailing newline) are what the fixture asserts against.
  writeFileSync(dest, bytes);
  count++;
}

// Record which pin produced this tree. Cheap, and it turns a confusing
// assertion failure after a pin bump into an obvious one.
let pin;
try {
  pin = execFileSync("git", ["-C", sourceRepo, "describe", "--tags", "--exact-match"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  pin = execFileSync("git", ["-C", sourceRepo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

console.log(`[prep-fixture] materialized construct3-sample@${pin} — ${count} files -> test/fixtures/canonical/`);
