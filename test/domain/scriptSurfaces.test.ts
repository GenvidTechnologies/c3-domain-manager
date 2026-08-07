import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as path from "node:path";
import {
  isScriptSourceName,
  isCompiledSibling,
  classifyFile,
} from "../../src/domain/classification.js";
import { listUncategorized } from "../../src/domain/domainAnalysis.js";
import { findScriptEntries } from "../../src/domain/domainGenerator.js";
import { createFile, makeTempDir, removeTempDir } from "../syntheticProject.js";
import { makeConfig } from "../domainModel.js";

describe("isScriptSourceName", () => {
  it("admits .ts files", () => {
    assert.isTrue(isScriptSourceName("a.ts"));
  });

  it("admits .js files", () => {
    assert.isTrue(isScriptSourceName("a.js"));
  });

  it("rejects .json files", () => {
    assert.isFalse(isScriptSourceName("a.json"));
  });

  it("rejects non-script files", () => {
    assert.isFalse(isScriptSourceName("README.md"));
  });

  it("admits .d.ts files (it ends in .ts)", () => {
    assert.isTrue(isScriptSourceName("Player.d.ts"));
  });
});

describe("isCompiledSibling", () => {
  it("suppresses a .js with a same-basename .ts sibling", () => {
    assert.isTrue(isCompiledSibling("a.js", new Set(["a.ts"])));
  });

  it("does not suppress a .js without a matching .ts sibling — clause 1 is per-directory", () => {
    assert.isFalse(isCompiledSibling("a.js", new Set(["b.ts"])));
  });

  it("does not treat a .d.ts as a suppressor", () => {
    assert.isFalse(isCompiledSibling("Player.js", new Set(["Player.d.ts"])));
  });

  it("never suppresses a .ts file", () => {
    assert.isFalse(isCompiledSibling("a.ts", new Set(["a.ts", "a.js"])));
  });
});

// --- Cross-surface agreement (issue #39) -----------------------------------
//
// This block is deliberately RED. `listUncategorized` (domainAnalysis.ts) and
// `findScriptEntries` (domainGenerator.ts) disagree about .js script files:
// `listUncategorized`'s scriptSubdirs walk applies no extension filter, while
// `findScriptEntries` only ever pushes a file entry for names ending in ".ts".
// A later task fixes that divergence and turns this block green — do not
// "fix" it by editing src/ here; it exists to pin the bug and prove the test
// can actually detect it (TDD falsifiability gate).
describe("listUncategorized vs findScriptEntries — cross-surface agreement (issue #39)", () => {
  let tmpDir: string;
  let scriptsDir: string;

  // A domain config that classifies nothing (no scriptDirs at all), so
  // listUncategorized's *unclassified* output is directly comparable to
  // findScriptEntries' *all-entries* output — see subtlety (a) in the task.
  const config = makeConfig({
    Placeholder: { description: "claims nothing — no scriptDirs" },
  });

  beforeEach(() => {
    tmpDir = makeTempDir("scriptSurfaces-agreement-");
    scriptsDir = path.join(tmpDir, "scripts");

    // A compiled pair at the scripts/ root.
    createFile(tmpDir, "scripts/main.ts");
    createFile(tmpDir, "scripts/main.js");
    // Root-only .js, no .ts sibling.
    createFile(tmpDir, "scripts/onlyjs.js");
    // A compiled pair inside a layer dir.
    createFile(tmpDir, "scripts/shared/a.ts");
    createFile(tmpDir, "scripts/shared/a.js");
    // Layer-dir-only .js, no .ts sibling.
    createFile(tmpDir, "scripts/shared/onlyjs.js");
    // Another layer dir, same compiled-pair shape.
    createFile(tmpDir, "scripts/c3-runtime/c.ts");
    createFile(tmpDir, "scripts/c3-runtime/c.js");
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("assumption: the config classifies no scripts/ path (required for the two surfaces to be comparable)", () => {
    assert.isNull(classifyFile("scripts/main.ts", "script", config));
    assert.isNull(classifyFile("scripts/shared/a.ts", "script", config));
    assert.isNull(classifyFile("scripts/c3-runtime/c.ts", "script", config));
  });

  it("agrees with findScriptEntries over the .ts/.js file overlap region", () => {
    // Restricted to the overlap region on purpose, not out of laziness: a
    // nested non-layer dir (e.g. scripts/shared/sub/b.ts) makes
    // findScriptEntries emit a single *directory* entry ("scripts/shared/sub/")
    // where listUncategorized enumerates individual files instead — a known
    // granularity divergence tracked by issue #35, out of scope for this
    // .js/.ts agreement test. Do not widen this filter to "fix" that.
    const OVERLAP_REGION = /^scripts\/(?:(?:shared|c3-runtime)\/)*[^/]+$/;
    const isScriptFileName = (p: string) => p.endsWith(".ts") || p.endsWith(".js");

    const uncategorized = listUncategorized(tmpDir, config)
      .filter((p) => OVERLAP_REGION.test(p) && isScriptFileName(p))
      .sort();

    const entries = findScriptEntries(scriptsDir)
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.relativePath)
      .filter((p) => OVERLAP_REGION.test(p) && isScriptFileName(p))
      .sort();

    assert.deepEqual(uncategorized, entries);
  });
});

// --- Authored-script rule, wired end-to-end (issue #39 / ADR 0016) ---------

describe("authored-script rule — both surfaces (issue #39)", () => {
  let tmpDir: string;
  let scriptsDir: string;

  const config = makeConfig({
    Placeholder: { description: "claims nothing — no scriptDirs" },
  });

  beforeEach(() => {
    tmpDir = makeTempDir("scriptSurfaces-rule-");
    scriptsDir = path.join(tmpDir, "scripts");
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("AC #2 — suppresses .js compiled siblings at the root and inside a layer dir, keeps both .ts", () => {
    createFile(tmpDir, "scripts/main.ts");
    createFile(tmpDir, "scripts/main.js");
    createFile(tmpDir, "scripts/shared/a.ts");
    createFile(tmpDir, "scripts/shared/a.js");

    const uncategorized = listUncategorized(tmpDir, config);
    assert.notInclude(uncategorized, "scripts/main.js");
    assert.notInclude(uncategorized, "scripts/shared/a.js");
    assert.include(uncategorized, "scripts/main.ts");
    assert.include(uncategorized, "scripts/shared/a.ts");

    const entries = findScriptEntries(scriptsDir)
      .filter((e) => !e.isDirectory)
      .map((e) => e.relativePath);
    assert.notInclude(entries, "scripts/main.js");
    assert.notInclude(entries, "scripts/shared/a.js");
    assert.include(entries, "scripts/main.ts");
    assert.include(entries, "scripts/shared/a.ts");
  });

  it("AC #3 — admits .js files with no .ts sibling, at the root and inside layer dirs", () => {
    createFile(tmpDir, "scripts/shared/onlyjs.js");
    createFile(tmpDir, "scripts/c3-runtime/c.js");

    const entries = findScriptEntries(scriptsDir).filter((e) => !e.isDirectory);
    assert.deepInclude(entries, { relativePath: "scripts/shared/onlyjs.js", isDirectory: false });
    assert.deepInclude(entries, {
      relativePath: "scripts/c3-runtime/c.js",
      isDirectory: false,
    });

    const uncategorized = listUncategorized(tmpDir, config);
    assert.include(uncategorized, "scripts/shared/onlyjs.js");
    assert.include(uncategorized, "scripts/c3-runtime/c.js");
  });

  it("AC #4 — a project with no .ts at all is fully reported via .js admission", () => {
    createFile(tmpDir, "scripts/game.js");
    createFile(tmpDir, "scripts/shared/net.js");

    const uncategorized = listUncategorized(tmpDir, config);
    assert.deepEqual(uncategorized, ["scripts/game.js", "scripts/shared/net.js"]);

    const entries = findScriptEntries(scriptsDir)
      .filter((e) => !e.isDirectory)
      .map((e) => e.relativePath)
      .sort();
    assert.deepEqual(entries, ["scripts/game.js", "scripts/shared/net.js"]);
  });

  it("clause 1 is per-directory — a same-named .js in a sibling dir is NOT suppressed", () => {
    createFile(tmpDir, "scripts/shared/a.ts");
    createFile(tmpDir, "scripts/common/a.js");
    // Deliberately no scripts/common/a.ts.

    const uncategorized = listUncategorized(tmpDir, config);
    assert.include(uncategorized, "scripts/common/a.js");
  });

  it(".d.ts is not a compiled-sibling suppressor", () => {
    createFile(tmpDir, "scripts/ts-defs/Player.d.ts");
    createFile(tmpDir, "scripts/ts-defs/Player.js");

    const uncategorized = listUncategorized(tmpDir, config);
    assert.include(uncategorized, "scripts/ts-defs/Player.js");
  });

  // Pinned divergence D (ADR 0016): collectScriptFiles (listUncategorized's
  // scriptSubdirs walk) applies no extension filter at all — by design, per
  // ADR 0013 decision #4, so a stray non-script file under scripts/shared/
  // still surfaces as an "unmapped file here" finding. findScriptEntries only
  // ever emits script-source entries, so a non-script file is invisible to
  // it. This is a decision, not a bug.
  it("pinned divergence D — a non-script file under scripts/shared/ is reported by listUncategorized but not findScriptEntries", () => {
    createFile(tmpDir, "scripts/shared/data.json");

    const uncategorized = listUncategorized(tmpDir, config);
    assert.include(uncategorized, "scripts/shared/data.json");

    const entries = findScriptEntries(scriptsDir)
      .filter((e) => !e.isDirectory)
      .map((e) => e.relativePath);
    assert.notInclude(entries, "scripts/shared/data.json");
  });
});
