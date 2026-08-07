import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { computeAddonInventory, formatAddonInventoryReport } from "../../src/domain/addonInventory.js";
import { fixtureProjectPath } from "../fixtureHelpers.js";
import { createFile, makeObjectType, makeFamily } from "../syntheticProject.js";

/**
 * Build a minimal-but-valid C3ProjectManifest JSON string, with the given
 * `usedAddons` entries. Shape verified against a real project.c3proj
 * (construct3-chef's sample fixture) and c3source's manifest.d.ts.
 */
function makeMinimalManifest(usedAddons: unknown[]): string {
  const emptyNameFolder = { items: [], subfolders: [] };
  const emptyFileFolder = { items: [], subfolders: [] };
  return JSON.stringify({
    projectFormatVersion: 1,
    savedWithRelease: 48703,
    name: "addon-inventory-test",
    runtime: "c3",
    usedAddons,
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
  });
}

describe("addonInventory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "addonInventory-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("computeAddonInventory", () => {
    it("reports a declared addon that no object type or family draws on", () => {
      createFile(
        tmpDir,
        "project.c3proj",
        makeMinimalManifest([{ type: "plugin", id: "Sprite", name: "Sprite", author: "Scirra", bundled: false }]),
      );
      createFile(tmpDir, "objectTypes/Text.json", makeObjectType("Text", "Text"));

      const report = computeAddonInventory(tmpDir);

      assert.equal(report.declaredButUnused.length, 1);
      assert.equal(report.declaredButUnused[0].id, "Sprite");
      assert.equal(report.usedButUndeclared.length, 1, "Text is drawn on but not declared");
      assert.deepEqual(report.usedButUndeclared, ["Text"]);
    });

    it("reports an object type's plugin-id absent from usedAddons as usedButUndeclared", () => {
      createFile(tmpDir, "project.c3proj", makeMinimalManifest([]));
      createFile(tmpDir, "objectTypes/Sprite.json", makeObjectType("Sprite", "Sprite", ["Timer"]));

      const report = computeAddonInventory(tmpDir);

      assert.include(report.usedButUndeclared, "Sprite");
      assert.include(report.usedButUndeclared, "Timer");
      assert.equal(report.declaredButUnused.length, 0);
    });

    it("computes usedIds as a sorted, deduped union across object types and families", () => {
      createFile(tmpDir, "project.c3proj", makeMinimalManifest([]));
      createFile(tmpDir, "objectTypes/Sprite.json", makeObjectType("Sprite", "Sprite", ["Timer"], ["burn"]));
      createFile(tmpDir, "objectTypes/Text.json", makeObjectType("Text", "Text", ["Timer"]));
      createFile(tmpDir, "families/TextFamily.json", makeFamily("TextFamily", "Text", ["Text"], [], ["burn"]));

      const report = computeAddonInventory(tmpDir);

      assert.deepEqual(report.usedIds, ["Sprite", "Text", "Timer", "burn"]);
    });

    it("is graceful when neither objectTypes/ nor families/ exist, and logs a note", () => {
      createFile(tmpDir, "project.c3proj", makeMinimalManifest([]));

      const logMessages: unknown[] = [];
      const logSpy = (...args: unknown[]) => {
        logMessages.push(args[0]);
      };

      let report;
      assert.doesNotThrow(() => {
        report = computeAddonInventory(tmpDir, logSpy);
      });

      assert.deepEqual(report!.attributions, []);
      assert.isTrue(
        logMessages.some((msg) => typeof msg === "string" && msg.includes("objectTypes")),
        `Expected log to contain 'objectTypes', got: ${JSON.stringify(logMessages)}`,
      );
    });

    it("throws when project.c3proj is missing", () => {
      // No project.c3proj at all
      assert.throws(() => computeAddonInventory(tmpDir));
    });

    it("throws when project.c3proj is malformed", () => {
      createFile(tmpDir, "project.c3proj", "{ not valid json");
      assert.throws(() => computeAddonInventory(tmpDir));
    });
  });

  describe("formatAddonInventoryReport", () => {
    it("returns 'No addon-inventory issues found.' when there are no issues", () => {
      const report = {
        attributions: [],
        declared: [],
        usedIds: [],
        declaredButUnused: [],
        usedButUndeclared: [],
      };
      assert.equal(formatAddonInventoryReport(report), "No addon-inventory issues found.");
    });

    it("includes offending addon ids and counts in the formatted output", () => {
      createFile(
        tmpDir,
        "project.c3proj",
        makeMinimalManifest([{ type: "plugin", id: "Sprite", name: "Sprite", author: "Scirra", bundled: false }]),
      );
      createFile(tmpDir, "objectTypes/Text.json", makeObjectType("Text", "Text"));

      const report = computeAddonInventory(tmpDir);
      const formatted = formatAddonInventoryReport(report);

      assert.include(formatted, "Sprite");
      assert.include(formatted, "Text");
      assert.include(formatted, "1 declared-but-unused");
      assert.include(formatted, "1 used-but-undeclared");
    });
  });
});

describe("computeAddonInventory — canonical fixture", () => {
  // Runs against the real construct3-sample project materialized by `pretest`,
  // rather than a synthetic manifest. Values below were captured by running the
  // function, not derived by reading project.c3proj.
  //
  // No fixture-exists guard here on purpose: test/setup.ts asserts materialization
  // once per run and throws. A per-test skip would hide missing coverage.
  const root = fixtureProjectPath();

  it("cross-references the real manifest against real object types", () => {
    const report = computeAddonInventory(root, () => {});

    assert.equal(report.declared.length, 13, "project.c3proj declares 13 addons");
    assert.equal(report.attributions.length, 14, "12 object types + 2 families draw on addons");
    assert.deepEqual(report.usedIds, [
      "Button",
      "Json",
      "MyCompany_MyBehavior",
      "MyCompany_MyEffect",
      "NinePatch",
      "Persist",
      "Sprite",
      "Text",
      "TextBox",
      "TiledBg",
      "Tilemap",
      "Timer",
      "burn",
    ]);
  });

  it("finds the canonical project internally consistent", () => {
    const report = computeAddonInventory(root, () => {});

    // Every declared addon is drawn on by something, and nothing draws on an
    // undeclared one. This is a stronger claim than "does not crash": it is the
    // property that makes the fixture a useful baseline, so a future pin bump
    // that breaks it should fail here rather than silently widen the diff.
    assert.deepEqual(report.declaredButUnused, [], "no declared addon goes unused");
    assert.deepEqual(report.usedButUndeclared, [], "no addon is used without being declared");
  });

  it("attributes the two bundled custom addons", () => {
    const report = computeAddonInventory(root, () => {});

    // The bundled behavior and effect are the interesting case: they are
    // project-local rather than Scirra built-ins.
    assert.include(report.usedIds, "MyCompany_MyBehavior");
    assert.include(report.usedIds, "MyCompany_MyEffect");
  });
});
