import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { computeDomainData, loadConfig, extractEventVarDecls, extractEventVarRefs } from "../../src/domain/domainGenerator.js";
import type { DomainConfig } from "../../src/domain/types.js";
import type { EventSheet } from "@genvid/c3source";

/** Create a file (and its parent directories) in the temp dir. */
function createFile(rootDir: string, relativePath: string, content = ""): void {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/** Create a minimal valid eventSheet JSON file. */
function eventSheetJson(name: string): string {
  return JSON.stringify({ name, events: [], sid: 1 });
}

/** Create a minimal valid layout JSON file. */
function layoutJson(name: string, eventSheet = ""): string {
  return JSON.stringify({ name, layers: [], eventSheet });
}

describe("computeDomainData", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "domainGenerator-"));
    // Create required directories so find functions don't throw
    fs.mkdirSync(path.join(tmpDir, "eventSheets"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "layouts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "scripts"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies an eventSheet into the correct domain", () => {
    createFile(
      tmpDir,
      "eventSheets/Login/LoginEvents.json",
      eventSheetJson("Login/LoginEvents"),
    );

    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      },
    };

    const result = computeDomainData(tmpDir, config);

    assert.equal(result.domains.length, 1);
    assert.equal(result.domains[0].name, "Auth");
    assert.equal(result.domains[0].eventSheets.length, 1);
    assert.equal(result.domains[0].eventSheets[0].path, "eventSheets/Login/LoginEvents.json");
    assert.deepEqual(result.unclassified, []);
  });

  it("returns empty arrays for empty directories", () => {
    // Directories created in beforeEach — no files added

    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth" },
      },
    };

    const result = computeDomainData(tmpDir, config);

    assert.equal(result.domains.length, 1);
    assert.equal(result.domains[0].name, "Auth");
    assert.equal(result.domains[0].eventSheets.length, 0);
    assert.equal(result.domains[0].layouts.length, 0);
    assert.equal(result.domains[0].scripts.length, 0);
    assert.deepEqual(result.unclassified, []);
  });

  it("puts unclassified files in unclassified array", () => {
    createFile(
      tmpDir,
      "eventSheets/Unknown/Foo.json",
      eventSheetJson("Unknown/Foo"),
    );

    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      },
    };

    const result = computeDomainData(tmpDir, config);

    assert.equal(result.domains.length, 1);
    assert.equal(result.domains[0].eventSheets.length, 0);
    assert.equal(result.unclassified.length, 1);
    assert.include(result.unclassified[0], "eventSheets/Unknown/Foo.json");
  });

  it("returns domains sorted by name", () => {
    const config: DomainConfig = {
      domains: {
        Zebra: { description: "Zebra domain" },
        Alpha: { description: "Alpha domain" },
        Middle: { description: "Middle domain" },
      },
    };

    const result = computeDomainData(tmpDir, config);

    assert.equal(result.domains.length, 3);
    assert.equal(result.domains[0].name, "Alpha");
    assert.equal(result.domains[1].name, "Middle");
    assert.equal(result.domains[2].name, "Zebra");
  });

  it("classifies a layout into the correct domain", () => {
    createFile(
      tmpDir,
      "layouts/Login/LoginLayout.json",
      layoutJson("LoginLayout"),
    );

    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth", layoutDirs: ["Login"] },
      },
    };

    const result = computeDomainData(tmpDir, config);

    assert.equal(result.domains[0].layouts.length, 1);
    assert.equal(result.domains[0].layouts[0].path, "layouts/Login/LoginLayout.json");
    assert.deepEqual(result.unclassified, []);
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadConfig-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // R3: unknown keys at top level and inside a domain def are preserved (.passthrough())
  it("R3: retains unknown top-level and per-domain keys (passthrough)", async () => {
    const configObj = {
      unknownTopLevel: "kept",
      domains: {
        Auth: { description: "Auth", unknownDomainKey: 42 },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "domain-config.json"),
      JSON.stringify(configObj),
      "utf-8",
    );

    const result = await loadConfig(tmpDir, "domain-config.json");

    assert.equal((result as Record<string, unknown>)["unknownTopLevel"], "kept");
    assert.equal(
      (result.domains["Auth"] as Record<string, unknown>)["unknownDomainKey"],
      42,
    );
  });

  // R4: malformed JSON causes rejection; error message contains "loadProjectConfig("
  it("R4: rejects on malformed JSON with loadProjectConfig( prefix", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "domain-config.json"),
      "{ not valid json",
      "utf-8",
    );

    let caught: Error | undefined;
    try {
      await loadConfig(tmpDir, "domain-config.json");
    } catch (e) {
      caught = e as Error;
    }

    assert.isDefined(caught, "loadConfig should have thrown");
    assert.include(caught!.message, "loadProjectConfig(");
  });

  // R5: missing `domains` field causes rejection; error message mentions "domains"
  it("R5: rejects when domains field is missing, message mentions domains", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "domain-config.json"),
      JSON.stringify({}),
      "utf-8",
    );

    let caught: Error | undefined;
    try {
      await loadConfig(tmpDir, "domain-config.json");
    } catch (e) {
      caught = e as Error;
    }

    assert.isDefined(caught, "loadConfig should have thrown");
    assert.include(caught!.message, "domains");
  });
});

describe("extractEventVarDecls", () => {
  it("returns names of root-level variable events", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        { eventType: "variable", name: "score", type: "number", initialValue: "0", isStatic: false, isConstant: false, sid: 10 },
        { eventType: "variable", name: "lives", type: "number", initialValue: "3", isStatic: false, isConstant: false, sid: 11 },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarDecls(sheet);

    assert.deepEqual(result, ["score", "lives"]);
  });

  it("returns [] for a sheet with no variable events", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        { eventType: "block", conditions: [], actions: [], sid: 20 },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarDecls(sheet);

    assert.deepEqual(result, []);
  });

  it("does NOT pick up variable events nested inside a group", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "group",
          name: "MyGroup",
          sid: 30,
          children: [
            { eventType: "variable", name: "nested", type: "number", initialValue: "0", isStatic: false, isConstant: false, sid: 31 },
          ],
        },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarDecls(sheet);

    // Only root-level variables are indexed; the nested one is not returned
    assert.deepEqual(result, []);
  });
});

describe("extractEventVarRefs", () => {
  it("collects a var name from a System compare-eventvar condition", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 100,
          conditions: [
            { id: "compare-eventvar", objectClass: "System", sid: 101, parameters: { variable: "score" } },
          ],
          actions: [],
        },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarRefs(sheet);

    assert.deepEqual(result, ["score"]);
  });

  it("collects a var name from a System set-eventvar-value action", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 200,
          conditions: [],
          actions: [
            { id: "set-eventvar-value", objectClass: "System", sid: 201, parameters: { variable: "lives" } },
          ],
        },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarRefs(sheet);

    assert.deepEqual(result, ["lives"]);
  });

  it("dedupes a var name referenced twice", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 300,
          conditions: [
            { id: "compare-eventvar", objectClass: "System", sid: 301, parameters: { variable: "score" } },
          ],
          actions: [
            { id: "set-eventvar-value", objectClass: "System", sid: 302, parameters: { variable: "score" } },
          ],
        },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarRefs(sheet);

    assert.deepEqual(result, ["score"]);
  });

  it("ignores a non-System ACE with an eventvar id", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 400,
          conditions: [
            { id: "compare-eventvar", objectClass: "Sprite", sid: 401, parameters: { variable: "score" } },
          ],
          actions: [],
        },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarRefs(sheet);

    assert.deepEqual(result, []);
  });

  it("ignores an ACE whose id is not an eventvar id", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 500,
          conditions: [
            { id: "on-start-of-layout", objectClass: "System", sid: 501, parameters: {} },
          ],
          actions: [],
        },
      ],
    } as unknown as EventSheet;

    const result = extractEventVarRefs(sheet);

    assert.deepEqual(result, []);
  });

  it("returns [] for an empty sheet", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [],
    } as unknown as EventSheet;

    const result = extractEventVarRefs(sheet);

    assert.deepEqual(result, []);
  });
});
