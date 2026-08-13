import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import { openProject } from "@genvidtech/c3source";
import { collectSectionFiles } from "../../src/domain/classification.js";
import { listUncategorized } from "../../src/domain/domainAnalysis.js";
import { computeDomainData } from "../../src/domain/domainGenerator.js";
import { createFile, makeTempDir, removeTempDir } from "../syntheticProject.js";
import { makeConfig } from "../domainModel.js";

describe("collectSectionFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("collectSectionFiles-");
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("admits a .json event sheet as a root-relative forward-slash path", () => {
    createFile(tmpDir, "eventSheets/Login/Main.json", "{}");
    const project = openProject(tmpDir);

    const result = collectSectionFiles(project, "eventSheet", tmpDir);

    assert.deepEqual(result, ["eventSheets/Login/Main.json"]);
  });

  it("drops a non-.json file under objectTypes/ via c3source's own collector", () => {
    createFile(tmpDir, "objectTypes/notes.txt", "hello");
    createFile(tmpDir, "objectTypes/Real.json", "{}");
    const project = openProject(tmpDir);

    const result = collectSectionFiles(project, "objectType", tmpDir);

    // Real.json is the positive control: an explicit kept-list identity,
    // not bare emptiness, so this test can't pass just as well if the
    // collector silently dropped everything. c3source 2.0.0 narrowed
    // find_all_objectTypes_path (and find_all_layouts_path) to .json,
    // joining eventSheets and families, so notes.txt never reaches
    // collectSectionFiles at all — the drop happens entirely inside
    // c3source's collector.
    assert.deepEqual(result, ["objectTypes/Real.json"]);
  });

  it("drops an editor-local .uistate.json file via c3source's own collector", () => {
    createFile(tmpDir, "eventSheets/Main.uistate.json", "{}");
    createFile(tmpDir, "eventSheets/Main.json", "{}");
    const project = openProject(tmpDir);

    const result = collectSectionFiles(project, "eventSheet", tmpDir);

    // Main.uistate.json ends in ".json", so an extension-only rule would
    // ADMIT it back in (the ordering hazard ADR 0020/ADR 0022 describe).
    // Its absence from the explicit kept-list here proves c3source's
    // findAllEventSheets applies isEditorLocalPath before this function
    // ever sees the result. Main.json is the positive control, proving the
    // collector kept the real sheet rather than dropping the whole
    // directory.
    assert.deepEqual(result, ["eventSheets/Main.json"]);
  });
});

// --- Cross-surface agreement (issue #52) ------------------------------------
//
// `listUncategorized` and `computeDomainData` both now delegate their
// eventSheets/, layouts/, objectTypes/ and families/ walks to
// `collectSectionFiles` (the same enumeration for both readers), so the two
// surfaces agree over the whole four-section tree by construction — the
// structural sibling of "listUncategorized vs findScriptEntries" above, for
// the four non-script sections instead of scripts/ (ADR 0017 covers
// scripts/; this covers the other four).
const SECTION_ROOTS = ["eventSheets/", "layouts/", "objectTypes/", "families/"];

function filterToSections(paths: string[]): string[] {
  return paths.filter((p) => SECTION_ROOTS.some((root) => p.startsWith(root))).sort();
}

describe("listUncategorized vs computeDomainData — four-section cross-surface agreement", () => {
  let tmpDir: string;

  // A domain config that classifies nothing (no *Dirs at all), so
  // listUncategorized's *unclassified* output is directly comparable to
  // computeDomainData's *unclassified* output.
  const config = makeConfig({
    Placeholder: { description: "claims nothing — no *Dirs" },
  });

  beforeEach(() => {
    tmpDir = makeTempDir("sectionSurfaces-agreement-");

    // One admitted (.json) and one dropped (non-.json) file per section, all
    // in directories the config above does not claim.
    createFile(tmpDir, "eventSheets/Foo/Main.json", "{}");
    createFile(tmpDir, "eventSheets/Foo/notes.txt", "hello");
    createFile(tmpDir, "layouts/Bar/Level.json", "{}");
    createFile(tmpDir, "layouts/Bar/readme.md", "hello");
    createFile(tmpDir, "objectTypes/Baz/Player.json", "{}");
    createFile(tmpDir, "objectTypes/Baz/data.xml", "hello");
    createFile(tmpDir, "families/Qux/Enemies.json", "{}");
    createFile(tmpDir, "families/Qux/notes.md", "hello");
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  it("agree over the whole four-section tree, and agree on the right answer", () => {
    const uncategorizedSections = filterToSections(listUncategorized(tmpDir, config));
    const { unclassified } = computeDomainData(tmpDir, config);
    const unclassifiedSections = filterToSections(unclassified);

    // The literal below is load-bearing, not redundant with the surface
    // comparison above: two empty arrays would `deepEqual` each other just
    // as well as two correct ones, so without this literal the test would
    // keep passing if BOTH walks silently dropped every admitted file (e.g.
    // collectSectionFiles wired to the wrong section, or never called at
    // all). Asserting against an explicit expected array is what catches
    // that failure mode, not just a divergence between the two readers.
    const expected = [
      "eventSheets/Foo/Main.json",
      "families/Qux/Enemies.json",
      "layouts/Bar/Level.json",
      "objectTypes/Baz/Player.json",
    ];

    assert.deepEqual(uncategorizedSections, unclassifiedSections);
    assert.deepEqual(unclassifiedSections, expected);

    // The dropped non-.json file per section must be absent from both.
    const droppedFiles = [
      "eventSheets/Foo/notes.txt",
      "layouts/Bar/readme.md",
      "objectTypes/Baz/data.xml",
      "families/Qux/notes.md",
    ];
    for (const dropped of droppedFiles) {
      assert.notInclude(listUncategorized(tmpDir, config), dropped);
      assert.notInclude(computeDomainData(tmpDir, config).unclassified, dropped);
    }
  });
});
