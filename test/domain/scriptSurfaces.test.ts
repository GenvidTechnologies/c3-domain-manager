import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as path from "node:path";
import {
  isGeneratedScriptOutput,
  isScriptSourceName as upstreamIsScriptSourceName,
} from "@genvidtech/c3source";
import {
  isScriptSourceName,
  classifyFile,
  hasClaimBelow,
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

describe("isGeneratedScriptOutput (from @genvidtech/c3source, replacing local isCompiledSibling)", () => {
  it("suppresses a .js with a same-basename .ts sibling", () => {
    assert.isTrue(isGeneratedScriptOutput("a.js", new Set(["a.ts"])));
  });

  it("does not suppress a .js without a matching .ts sibling — clause 1 is per-directory", () => {
    assert.isFalse(isGeneratedScriptOutput("a.js", new Set(["b.ts"])));
  });

  it("does not treat a .d.ts as a suppressor (cross-library pin — upstream agrees)", () => {
    assert.isFalse(isGeneratedScriptOutput("Player.js", new Set(["Player.d.ts"])));
  });

  it("never suppresses a .ts file", () => {
    assert.isFalse(isGeneratedScriptOutput("a.ts", new Set(["a.ts", "a.js"])));
  });

  it("compares extensions case-insensitively (the one behaviour delta vs. the retired local predicate)", () => {
    assert.isTrue(isGeneratedScriptOutput("Main.JS", new Set(["main.ts"])));
  });
});

// Divergence-pinning: c3source's own isScriptSourceName (available since 2.0.0)
// excludes .d.ts, but this repo's isScriptSourceName deliberately admits it — a
// generated typing under scripts/ts-defs/ must stay indexable via scriptDirs
// (ADR 0013's ts-defs/ exemption). If a future change "adopts" upstream's
// version in place of the local one, this test fails instead of the exemption
// silently regressing.
describe("isScriptSourceName — deliberate divergence from upstream on .d.ts (ADR 0013)", () => {
  it("local admits .d.ts, upstream rejects it", () => {
    assert.isTrue(isScriptSourceName("Player.d.ts"));
    assert.isFalse(upstreamIsScriptSourceName("Player.d.ts"));
  });
});

describe("hasClaimBelow", () => {
  it("R-P1 — a claim strictly below innerPath returns true", () => {
    const config = makeConfig({
      A: { description: "d", scriptDirs: ["common/nested"] },
    });
    assert.isTrue(hasClaimBelow("common", "script", config));
  });

  it("R-P2 — a claim exactly at innerPath (claimed as a unit, not below) returns false", () => {
    const config = makeConfig({
      A: { description: "d", scriptDirs: ["ts-defs"] },
    });
    assert.isFalse(hasClaimBelow("ts-defs", "script", config));
  });

  it("R-P3 — a sibling directory that merely shares innerPath as a string prefix is excluded (anchoring bug guard)", () => {
    const config = makeConfig({
      A: { description: "d", scriptDirs: ["common2/x"] },
    });
    assert.isFalse(hasClaimBelow("common", "script", config));
  });

  it("R-P4 — reads sharedSubdomains and overrides, not just domains", () => {
    const viaSharedSubdomains = makeConfig(
      { A: { description: "d" } },
      { sharedSubdomains: { S: { description: "d", scriptDirs: ["common/nested"] } } },
    );
    assert.isTrue(hasClaimBelow("common", "script", viaSharedSubdomains));

    const viaOverrides = makeConfig(
      { A: { description: "d" } },
      { overrides: { "scripts/common/nested/y.ts": "A" } },
    );
    assert.isTrue(hasClaimBelow("common", "script", viaOverrides));
  });
});

// --- Cross-surface agreement (ADR 0017) -------------------------------------
//
// `listUncategorized` now delegates its scripts/ walk to `findScriptEntries`
// (the same enumeration `computeDomainData` uses), so the two surfaces agree
// by construction over the whole scripts/ tree — not just the .ts/.js file
// overlap region a prior version of this block used to carve out (see
// issue #51).
describe("listUncategorized vs findScriptEntries — full cross-surface agreement", () => {
  let tmpDir: string;
  let scriptsDir: string;

  // A domain config that classifies nothing (no scriptDirs at all), so
  // listUncategorized's *unclassified* output is directly comparable to
  // findScriptEntries' *all-entries* output.
  const config = makeConfig({
    Placeholder: { description: "claims nothing — no scriptDirs" },
  });

  beforeEach(() => {
    tmpDir = makeTempDir("scriptSurfaces-agreement-");
    scriptsDir = path.join(tmpDir, "scripts");

    createFile(tmpDir, "scripts/root.ts");
    createFile(tmpDir, "scripts/readme.md");
    createFile(tmpDir, "scripts/shared/a.ts");
    createFile(tmpDir, "scripts/shared/data.json");
    createFile(tmpDir, "scripts/shared/sub/b.ts");
    createFile(tmpDir, "scripts/shared/sub/deep/c.ts");
    createFile(tmpDir, "scripts/common/x.ts");
    createFile(tmpDir, "scripts/common/notes.md");
    createFile(tmpDir, "scripts/common/nested/y.ts");
    createFile(tmpDir, "scripts/c3-runtime/r.ts");
    createFile(tmpDir, "scripts/other/o.ts");
    createFile(tmpDir, "scripts/other/data.json");
    createFile(tmpDir, "scripts/other/deeper/p.ts");
    createFile(tmpDir, "scripts/ts-defs/objects.d.ts");
    createFile(tmpDir, "scripts/ts-defs/runtime/IRuntime.d.ts");
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("agree over the whole scripts/ tree, including collapsed directory entries", () => {
    const uncategorizedScripts = listUncategorized(tmpDir, config)
      .filter((p) => p.startsWith("scripts/"))
      .sort();
    const entryPaths = findScriptEntries(scriptsDir, config)
      .map((entry) => entry.relativePath)
      .sort();

    const expected = [
      "scripts/c3-runtime/r.ts",
      "scripts/common/",
      "scripts/other/",
      "scripts/root.ts",
      "scripts/shared/a.ts",
      "scripts/shared/sub/",
      "scripts/ts-defs/",
    ];

    assert.deepEqual(uncategorizedScripts, entryPaths);
    assert.deepEqual(entryPaths, expected);
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
    createFile(tmpDir, "scripts/c3-runtime/a.js");
    // Deliberately no scripts/c3-runtime/a.ts. Both dirs are LAYER_DIRS entries
    // (recursed, file-level granularity), so the file-level check stays observable.

    const uncategorized = listUncategorized(tmpDir, config);
    assert.include(uncategorized, "scripts/c3-runtime/a.js");
  });

  it(".d.ts is not a compiled-sibling suppressor", () => {
    createFile(tmpDir, "scripts/shared/Player.d.ts");
    createFile(tmpDir, "scripts/shared/Player.js");

    const uncategorized = listUncategorized(tmpDir, config);
    assert.include(uncategorized, "scripts/shared/Player.js");
  });

  // R-D1 (ADR 0017 supersedes pinned divergence D): now that listUncategorized
  // delegates its scripts/ walk to findScriptEntries, a non-script file is
  // invisible to BOTH surfaces rather than being an "unmapped file here"
  // finding unique to listUncategorized. scripts/shared/a.ts is a positive
  // control proving the walk under scripts/shared/ actually ran.
  it("R-D1 — a non-script file under scripts/shared/ is reported by neither surface", () => {
    createFile(tmpDir, "scripts/shared/data.json");
    createFile(tmpDir, "scripts/shared/a.ts");

    const uncategorized = listUncategorized(tmpDir, config);
    assert.notInclude(uncategorized, "scripts/shared/data.json");
    assert.include(uncategorized, "scripts/shared/a.ts");

    const entries = findScriptEntries(scriptsDir)
      .filter((e) => !e.isDirectory)
      .map((e) => e.relativePath);
    assert.notInclude(entries, "scripts/shared/data.json");
    assert.include(entries, "scripts/shared/a.ts");
  });

  // R-C1 (ADR 0017 supersedes pinned divergence C, issue #46): listUncategorized
  // no longer hand-rolls a four-entry scripts/ subdirectory allowlist — it
  // delegates to findScriptEntries, which walks the whole scripts/ tree — so
  // an unclaimed non-layer subdirectory is now reported by both surfaces.
  it("R-C1 — an unclaimed non-layer scripts/ subdirectory is reported by both surfaces", () => {
    createFile(tmpDir, "scripts/other/o.ts");

    const entries = findScriptEntries(scriptsDir, config);
    assert.deepInclude(entries, { relativePath: "scripts/other/", isDirectory: true });

    const uncategorized = listUncategorized(tmpDir, config);
    assert.include(uncategorized, "scripts/other/");
  });
});
