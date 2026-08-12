import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import { openProject } from "@genvidtech/c3source";
import { isSectionSourceName, collectSectionFiles } from "../../src/domain/classification.js";
import { createFile, makeTempDir, removeTempDir } from "../syntheticProject.js";

describe("isSectionSourceName", () => {
  it("admits .json files", () => {
    assert.isTrue(isSectionSourceName("a.json"));
  });

  it("rejects .ts files", () => {
    assert.isFalse(isSectionSourceName("a.ts"));
  });

  it("rejects .md files", () => {
    assert.isFalse(isSectionSourceName("README.md"));
  });

  it("rejects extensionless names", () => {
    assert.isFalse(isSectionSourceName("README"));
  });
});

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

  it("drops a non-.json file under objectTypes/ and logs its relative path", () => {
    createFile(tmpDir, "objectTypes/notes.txt", "hello");
    const logMessages: string[] = [];
    const project = openProject(tmpDir);

    const result = collectSectionFiles(project, "objectType", tmpDir, (msg) => logMessages.push(String(msg)));

    assert.deepEqual(result, []);
    assert.deepEqual(logMessages, ["  Dropped non-section-source file: objectTypes/notes.txt"]);
  });

  it("drops an editor-local .uistate.json file via c3source's own collector, never reaching isSectionSourceName", () => {
    createFile(tmpDir, "eventSheets/Main.uistate.json", "{}");
    const logMessages: string[] = [];
    const project = openProject(tmpDir);

    const result = collectSectionFiles(project, "eventSheet", tmpDir, (msg) => logMessages.push(String(msg)));

    // Main.uistate.json ends in ".json", so isSectionSourceName alone would
    // ADMIT it (see ADR 0020's ordering hazard). Its absence here therefore
    // proves c3source's findAllEventSheets dropped it first. The empty log
    // confirms the same thing from the other side: our own filter only ever
    // logs a file it drops (see the previous test), and it logs nothing for
    // this one — it never got a chance to make that call.
    assert.deepEqual(result, []);
    assert.deepEqual(logMessages, []);
  });
});
