import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  computeDomainData,
  loadConfig,
  generateDomainIndex,
  extractEventVarDecls,
  extractEventVarRefs,
  extractExpressionRefs,
} from "../../src/domain/domainGenerator.js";
import type { DomainConfig, DomainData } from "../../src/domain/types.js";
import type { EventSheet } from "@genvidtech/c3source";

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

/** Create a minimal valid ObjectType JSON file (shape mirrors addonInventory.test.ts). */
function makeObjectType(name: string, pluginId: string, behaviorIds: string[] = [], effectIds: string[] = []): string {
  return JSON.stringify({
    name,
    "plugin-id": pluginId,
    sid: 1,
    instanceVariables: [],
    behaviorTypes: behaviorIds.map((behaviorId) => ({ behaviorId, name: behaviorId, sid: 1 })),
    effectTypes: effectIds.map((effectId) => ({ effectId, name: effectId })),
  });
}

/** Create a minimal valid Family JSON file (shape mirrors addonInventory.test.ts). */
function makeFamily(
  name: string,
  pluginId: string,
  members: string[],
  behaviorIds: string[] = [],
  effectIds: string[] = [],
): string {
  return JSON.stringify({
    name,
    "plugin-id": pluginId,
    sid: 1,
    instanceVariables: [],
    behaviorTypes: behaviorIds.map((behaviorId) => ({ behaviorId, name: behaviorId, sid: 1 })),
    effectTypes: effectIds.map((effectId) => ({ effectId, name: effectId })),
    members,
  });
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

  it("cross-domain reference creates an edge in referencesFrom and referencedBy", () => {
    // Domain B declares variable "score"; domain A references it
    createFile(
      tmpDir,
      "eventSheets/GameLogic/GameLogic.json",
      JSON.stringify({
        name: "GameLogic/GameLogic",
        sid: 1,
        events: [
          { eventType: "variable", name: "score", type: "number", initialValue: "0", isStatic: false, isConstant: false, sid: 10 },
        ],
      }),
    );
    createFile(
      tmpDir,
      "eventSheets/UI/UIEvents.json",
      JSON.stringify({
        name: "UI/UIEvents",
        sid: 2,
        events: [
          {
            eventType: "block",
            sid: 20,
            conditions: [
              { id: "compare-eventvar", objectClass: "System", sid: 21, parameters: { variable: "score" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        GameDomain: { description: "Game", eventSheetDirs: ["GameLogic"] },
        UIDomain: { description: "UI", eventSheetDirs: ["UI"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const gameDomain = result.domains.find((d) => d.name === "GameDomain")!;
    const uiDomain = result.domains.find((d) => d.name === "UIDomain")!;

    assert.isTrue(uiDomain.referencesFrom.has("GameDomain"), "UIDomain.referencesFrom should have GameDomain");
    assert.deepEqual(uiDomain.referencesFrom.get("GameDomain"), ["score"]);
    assert.isTrue(gameDomain.referencedBy.has("UIDomain"), "GameDomain.referencedBy should have UIDomain");
    assert.deepEqual(gameDomain.referencedBy.get("UIDomain"), ["score"]);
  });

  it("collision attributes the reference to all declaring domains", () => {
    // Both domain B and domain C declare "score"; domain A references it → edges to both
    createFile(
      tmpDir,
      "eventSheets/DomainB/Events.json",
      JSON.stringify({
        name: "DomainB/Events",
        sid: 1,
        events: [
          { eventType: "variable", name: "score", type: "number", initialValue: "0", isStatic: false, isConstant: false, sid: 10 },
        ],
      }),
    );
    createFile(
      tmpDir,
      "eventSheets/DomainC/Events.json",
      JSON.stringify({
        name: "DomainC/Events",
        sid: 2,
        events: [
          { eventType: "variable", name: "score", type: "number", initialValue: "0", isStatic: false, isConstant: false, sid: 20 },
        ],
      }),
    );
    createFile(
      tmpDir,
      "eventSheets/DomainA/Events.json",
      JSON.stringify({
        name: "DomainA/Events",
        sid: 3,
        events: [
          {
            eventType: "block",
            sid: 30,
            conditions: [
              { id: "compare-eventvar", objectClass: "System", sid: 31, parameters: { variable: "score" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", eventSheetDirs: ["DomainA"] },
        DomainB: { description: "B", eventSheetDirs: ["DomainB"] },
        DomainC: { description: "C", eventSheetDirs: ["DomainC"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainA = result.domains.find((d) => d.name === "DomainA")!;

    assert.isTrue(domainA.referencesFrom.has("DomainB"), "DomainA.referencesFrom should have DomainB");
    assert.isTrue(domainA.referencesFrom.has("DomainC"), "DomainA.referencesFrom should have DomainC");
    assert.deepEqual(domainA.referencesFrom.get("DomainB"), ["score"]);
    assert.deepEqual(domainA.referencesFrom.get("DomainC"), ["score"]);
  });

  it("unresolved variable reference produces no edge", () => {
    // Domain A references "ghost" which is declared nowhere
    createFile(
      tmpDir,
      "eventSheets/DomainA/Events.json",
      JSON.stringify({
        name: "DomainA/Events",
        sid: 1,
        events: [
          {
            eventType: "block",
            sid: 10,
            conditions: [
              { id: "compare-eventvar", objectClass: "System", sid: 11, parameters: { variable: "ghost" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", eventSheetDirs: ["DomainA"] },
        DomainB: { description: "B", eventSheetDirs: ["DomainB"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainA = result.domains.find((d) => d.name === "DomainA")!;

    assert.equal(domainA.referencesFrom.size, 0, "no edge for unresolved variable");
  });

  it("same-domain declare-and-reference produces no edge", () => {
    // A single domain both declares and references "score"
    createFile(
      tmpDir,
      "eventSheets/DomainA/Events.json",
      JSON.stringify({
        name: "DomainA/Events",
        sid: 1,
        events: [
          { eventType: "variable", name: "score", type: "number", initialValue: "0", isStatic: false, isConstant: false, sid: 10 },
          {
            eventType: "block",
            sid: 20,
            conditions: [
              { id: "compare-eventvar", objectClass: "System", sid: 21, parameters: { variable: "score" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", eventSheetDirs: ["DomainA"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainA = result.domains.find((d) => d.name === "DomainA")!;

    assert.equal(domainA.referencesFrom.size, 0, "same-domain ref produces no edge");
    assert.equal(domainA.referencedBy.size, 0, "same-domain ref produces no referencedBy edge");
  });

  it("does not throw and returns empty eventSheets when eventSheets/ dir is absent", () => {
    // Delete the eventSheets/ dir that beforeEach created — layouts/ and scripts/ still exist
    fs.rmSync(path.join(tmpDir, "eventSheets"), { recursive: true, force: true });

    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      },
    };

    let result: ReturnType<typeof computeDomainData> | undefined;
    assert.doesNotThrow(() => {
      result = computeDomainData(tmpDir, config);
    });
    assert.isDefined(result);
    for (const domain of result!.domains) {
      assert.equal(domain.eventSheets.length, 0, `${domain.name} should have no eventSheets`);
    }
  });

  it("does not throw and returns empty layouts when layouts/ dir is absent", () => {
    // Delete the layouts/ dir that beforeEach created — eventSheets/ and scripts/ still exist
    fs.rmSync(path.join(tmpDir, "layouts"), { recursive: true, force: true });

    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth", layoutDirs: ["MainMenu"] },
      },
    };

    let result: ReturnType<typeof computeDomainData> | undefined;
    assert.doesNotThrow(() => {
      result = computeDomainData(tmpDir, config);
    });
    assert.isDefined(result);
    for (const domain of result!.domains) {
      assert.equal(domain.layouts.length, 0, `${domain.name} should have no layouts`);
    }
  });

  it("does not throw and returns empty scripts when scripts/ dir is absent", () => {
    // Delete the scripts/ dir that beforeEach created — eventSheets/ and layouts/ still exist
    fs.rmSync(path.join(tmpDir, "scripts"), { recursive: true, force: true });

    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth", scriptDirs: ["Login"] },
      },
    };

    let result: ReturnType<typeof computeDomainData> | undefined;
    assert.doesNotThrow(() => {
      result = computeDomainData(tmpDir, config);
    });
    assert.isDefined(result);
    for (const domain of result!.domains) {
      assert.equal(domain.scripts.length, 0, `${domain.name} should have no scripts`);
    }
  });

  it("duplicate references across sheets are deduped in the edge payload", () => {
    // Domain A has two sheets both referencing "score"; domain B declares it — payload is ["score"] (length 1)
    createFile(
      tmpDir,
      "eventSheets/DomainB/Events.json",
      JSON.stringify({
        name: "DomainB/Events",
        sid: 1,
        events: [
          { eventType: "variable", name: "score", type: "number", initialValue: "0", isStatic: false, isConstant: false, sid: 10 },
        ],
      }),
    );
    createFile(
      tmpDir,
      "eventSheets/DomainA/Sheet1.json",
      JSON.stringify({
        name: "DomainA/Sheet1",
        sid: 2,
        events: [
          {
            eventType: "block",
            sid: 20,
            conditions: [
              { id: "compare-eventvar", objectClass: "System", sid: 21, parameters: { variable: "score" } },
            ],
            actions: [],
          },
        ],
      }),
    );
    createFile(
      tmpDir,
      "eventSheets/DomainA/Sheet2.json",
      JSON.stringify({
        name: "DomainA/Sheet2",
        sid: 3,
        events: [
          {
            eventType: "block",
            sid: 30,
            conditions: [
              { id: "compare-eventvar", objectClass: "System", sid: 31, parameters: { variable: "score" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", eventSheetDirs: ["DomainA"] },
        DomainB: { description: "B", eventSheetDirs: ["DomainB"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainA = result.domains.find((d) => d.name === "DomainA")!;

    assert.isTrue(domainA.referencesFrom.has("DomainB"));
    const payload = domainA.referencesFrom.get("DomainB")!;
    assert.equal(payload.length, 1, "deduplicated to a single entry");
    assert.deepEqual(payload, ["score"]);
  });

  it("attributes an object type under a domain's objectTypeDirs into that domain's addons", () => {
    createFile(
      tmpDir,
      "objectTypes/Battle/Hero.json",
      makeObjectType("Hero", "Sprite", ["Timer"]),
    );

    const config: DomainConfig = {
      domains: {
        Battle: { description: "Battle", objectTypeDirs: ["Battle"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const battle = result.domains.find((d) => d.name === "Battle")!;

    assert.equal(battle.addons.length, 1);
    assert.equal(battle.addons[0].name, "Hero");
    assert.equal(battle.addons[0].source, "objectType");
    assert.equal(battle.addons[0].pluginId, "Sprite");
    assert.deepEqual(result.unclassified, []);
  });

  it("attributes a family under a domain's familyDirs into that domain's addons", () => {
    createFile(
      tmpDir,
      "families/Battle/Units.json",
      makeFamily("Units", "Sprite", ["Hero"]),
    );

    const config: DomainConfig = {
      domains: {
        Battle: { description: "Battle", familyDirs: ["Battle"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const battle = result.domains.find((d) => d.name === "Battle")!;

    assert.equal(battle.addons.length, 1);
    assert.equal(battle.addons[0].name, "Units");
    assert.equal(battle.addons[0].source, "family");
    assert.equal(battle.addons[0].pluginId, "Sprite");
    assert.deepEqual(result.unclassified, []);
  });

  it("is graceful when neither objectTypes/ nor families/ exist — every domain's addons is []", () => {
    // beforeEach only creates eventSheets/, layouts/, scripts/ — objectTypes/ and families/ are absent
    const config: DomainConfig = {
      domains: {
        Auth: { description: "Auth" },
        Battle: { description: "Battle", objectTypeDirs: ["Battle"], familyDirs: ["Battle"] },
      },
    };

    let result: ReturnType<typeof computeDomainData> | undefined;
    assert.doesNotThrow(() => {
      result = computeDomainData(tmpDir, config);
    });
    assert.isDefined(result);
    for (const domain of result!.domains) {
      assert.deepEqual(domain.addons, [], `${domain.name} should have no addons`);
    }
  });

  it("an object type under no matching objectTypeDirs lands in unclassified, not in any domain's addons", () => {
    createFile(
      tmpDir,
      "objectTypes/Orphan/Widget.json",
      makeObjectType("Widget", "Sprite"),
    );

    const config: DomainConfig = {
      domains: {
        Battle: { description: "Battle", objectTypeDirs: ["Battle"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const battle = result.domains.find((d) => d.name === "Battle")!;

    assert.deepEqual(battle.addons, []);
    assert.equal(result.unclassified.length, 1);
    assert.include(result.unclassified[0], "objectTypes/Orphan/Widget.json");
  });

  // R7: an object type in domain A, referenced by an event sheet in domain B,
  // creates an expressionRefsFrom/expressionRefsBy edge in both directions.
  it("R7: cross-domain expression reference creates an edge in expressionRefsFrom and expressionRefsBy", () => {
    createFile(tmpDir, "objectTypes/DomainA/Player.json", makeObjectType("Player", "Sprite"));
    createFile(
      tmpDir,
      "eventSheets/DomainB/Events.json",
      JSON.stringify({
        name: "DomainB/Events",
        sid: 1,
        events: [
          {
            eventType: "block",
            sid: 10,
            conditions: [
              { id: "compare-instance-variable", objectClass: "Sprite", sid: 11, parameters: { value: "Player.Health" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", objectTypeDirs: ["DomainA"] },
        DomainB: { description: "B", eventSheetDirs: ["DomainB"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainA = result.domains.find((d) => d.name === "DomainA")!;
    const domainB = result.domains.find((d) => d.name === "DomainB")!;

    assert.isTrue(domainB.expressionRefsFrom.has("DomainA"), "DomainB.expressionRefsFrom should have DomainA");
    assert.deepEqual(domainB.expressionRefsFrom.get("DomainA"), ["Player"]);
    assert.isTrue(domainA.expressionRefsBy.has("DomainB"), "DomainA.expressionRefsBy should have DomainB");
    assert.deepEqual(domainA.expressionRefsBy.get("DomainB"), ["Player"]);
  });

  // R8: same-domain object-type-and-reference produces no expressionRefs edge.
  it("R8: same-domain expression reference produces no edge", () => {
    createFile(tmpDir, "objectTypes/DomainA/Player.json", makeObjectType("Player", "Sprite"));
    createFile(
      tmpDir,
      "eventSheets/DomainA/Events.json",
      JSON.stringify({
        name: "DomainA/Events",
        sid: 1,
        events: [
          {
            eventType: "block",
            sid: 10,
            conditions: [
              { id: "compare-instance-variable", objectClass: "Sprite", sid: 11, parameters: { value: "Player.Health" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", objectTypeDirs: ["DomainA"], eventSheetDirs: ["DomainA"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainA = result.domains.find((d) => d.name === "DomainA")!;

    assert.equal(domainA.expressionRefsFrom.size, 0, "same-domain expression ref produces no edge");
    assert.equal(domainA.expressionRefsBy.size, 0, "same-domain expression ref produces no referencedBy edge");
  });

  // R9: a reference to an unclassified/unknown object name produces no edge.
  it("R9: unresolved expression reference produces no edge", () => {
    createFile(
      tmpDir,
      "eventSheets/DomainA/Events.json",
      JSON.stringify({
        name: "DomainA/Events",
        sid: 1,
        events: [
          {
            eventType: "block",
            sid: 10,
            conditions: [
              { id: "compare-instance-variable", objectClass: "Sprite", sid: 11, parameters: { value: "Keyboard.member" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", eventSheetDirs: ["DomainA"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainA = result.domains.find((d) => d.name === "DomainA")!;

    assert.equal(domainA.expressionRefsFrom.size, 0, "no edge for unresolved object name");
  });

  // R10: collision — two object types both named "Player" classified into A and C —
  // attributes the reference to both declaring domains.
  it("R10: collision attributes the expression reference to all declaring domains", () => {
    createFile(tmpDir, "objectTypes/DomainA/Player.json", makeObjectType("Player", "Sprite"));
    createFile(tmpDir, "objectTypes/DomainC/Player.json", makeObjectType("Player", "Sprite"));
    createFile(
      tmpDir,
      "eventSheets/DomainB/Events.json",
      JSON.stringify({
        name: "DomainB/Events",
        sid: 1,
        events: [
          {
            eventType: "block",
            sid: 10,
            conditions: [
              { id: "compare-instance-variable", objectClass: "Sprite", sid: 11, parameters: { value: "Player.x" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", objectTypeDirs: ["DomainA"] },
        DomainB: { description: "B", eventSheetDirs: ["DomainB"] },
        DomainC: { description: "C", objectTypeDirs: ["DomainC"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainB = result.domains.find((d) => d.name === "DomainB")!;

    assert.isTrue(domainB.expressionRefsFrom.has("DomainA"), "DomainB.expressionRefsFrom should have DomainA");
    assert.isTrue(domainB.expressionRefsFrom.has("DomainC"), "DomainB.expressionRefsFrom should have DomainC");
    assert.deepEqual(domainB.expressionRefsFrom.get("DomainA"), ["Player"]);
    assert.deepEqual(domainB.expressionRefsFrom.get("DomainC"), ["Player"]);
  });

  // R11: a family reference resolves to the family's OWN domain, not its members' domain.
  it("R11: a family reference resolves to the family's own domain, not the members' domain", () => {
    createFile(tmpDir, "families/DomainA/Enemies.json", makeFamily("Enemies", "Sprite", ["Goblin"]));
    createFile(tmpDir, "objectTypes/DomainB/Goblin.json", makeObjectType("Goblin", "Sprite"));
    createFile(
      tmpDir,
      "eventSheets/DomainC/Events.json",
      JSON.stringify({
        name: "DomainC/Events",
        sid: 1,
        events: [
          {
            eventType: "block",
            sid: 10,
            conditions: [
              { id: "compare-instance-variable", objectClass: "Sprite", sid: 11, parameters: { value: "Enemies.Speed" } },
            ],
            actions: [],
          },
        ],
      }),
    );

    const config: DomainConfig = {
      domains: {
        DomainA: { description: "A", familyDirs: ["DomainA"] },
        DomainB: { description: "B", objectTypeDirs: ["DomainB"] },
        DomainC: { description: "C", eventSheetDirs: ["DomainC"] },
      },
    };

    const result = computeDomainData(tmpDir, config);
    const domainC = result.domains.find((d) => d.name === "DomainC")!;

    assert.isTrue(domainC.expressionRefsFrom.has("DomainA"), "DomainC.expressionRefsFrom should have DomainA (family's own domain)");
    assert.deepEqual(domainC.expressionRefsFrom.get("DomainA"), ["Enemies"]);
    assert.isFalse(domainC.expressionRefsFrom.has("DomainB"), "DomainC.expressionRefsFrom should NOT have DomainB (members' domain)");
  });
});

describe("generateDomainIndex", () => {
  let tmpDir: string;
  let outDir: string;

  const COUPLING_MAP_KEYS = [
    "includesFrom",
    "includedBy",
    "referencesFrom",
    "referencedBy",
    "expressionRefsFrom",
    "expressionRefsBy",
  ] as const;

  function sortedEntries(m: Map<string, string[]>): Array<[string, string[]]> {
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  /** Assert every one of the six coupling-edge maps is identical between two DomainData for the same domain. */
  function assertCouplingMapsEqual(a: DomainData, b: DomainData): void {
    for (const key of COUPLING_MAP_KEYS) {
      assert.deepEqual(
        sortedEntries(a[key]),
        sortedEntries(b[key]),
        `${a.name}.${key} should be identical regardless of the coupling config`,
      );
    }
  }

  function writeConfig(configObj: unknown): void {
    fs.writeFileSync(path.join(tmpDir, "domain-config.json"), JSON.stringify(configObj), "utf-8");
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "generateDomainIndex-"));
    outDir = path.join(tmpDir, "extracted");

    // Core declares an eventSheet; UI includes it — a hub coupling edge to discount.
    createFile(tmpDir, "eventSheets/Core/CoreEvents.json", eventSheetJson("Core/CoreEvents"));
    createFile(
      tmpDir,
      "eventSheets/UI/UIEvents.json",
      JSON.stringify({
        name: "UI/UIEvents",
        sid: 1,
        events: [{ eventType: "include", includeSheet: "Core/CoreEvents" }],
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discounts a hub domain end-to-end: excluded from the index Dependencies column, tagged on the detail page", async () => {
    writeConfig({
      domains: {
        Core: { description: "Core", eventSheetDirs: ["Core"] },
        UI: { description: "UI", eventSheetDirs: ["UI"] },
      },
      coupling: { hubDomains: ["Core"] },
    });

    await generateDomainIndex(tmpDir, outDir, tmpDir, "domain-config.json", () => {});

    const indexContent = fs.readFileSync(path.join(outDir, "domain-index", "index.md"), "utf-8");
    const uiLine = indexContent.split("\n").find((l) => l.startsWith("| [UI]"));
    assert.isDefined(uiLine, "UI row should exist in the master index");
    assert.notInclude(uiLine!, "Core", "hub domain excluded from the index Dependencies column");

    const uiPage = fs.readFileSync(path.join(outDir, "domain-index", "UI.md"), "utf-8");
    assert.include(uiPage, "(shared kernel)", "UI detail page tags the hub dependency as a shared kernel");
  });

  // R4: the discount is consumption-time only — computeDomainData's raw coupling
  // graph must be byte-for-byte the same whether or not a `coupling` block is present.
  it("R4: raw coupling maps are unchanged whether or not a coupling block is present", () => {
    const configWithCoupling: DomainConfig = {
      domains: {
        Core: { description: "Core", eventSheetDirs: ["Core"] },
        UI: { description: "UI", eventSheetDirs: ["UI"] },
      },
      coupling: { hubDomains: ["Core"] },
    };
    const configWithoutCoupling: DomainConfig = {
      domains: {
        Core: { description: "Core", eventSheetDirs: ["Core"] },
        UI: { description: "UI", eventSheetDirs: ["UI"] },
      },
    };

    const withCoupling = computeDomainData(tmpDir, configWithCoupling);
    const withoutCoupling = computeDomainData(tmpDir, configWithoutCoupling);

    for (const domainName of ["Core", "UI"]) {
      const a = withCoupling.domains.find((d) => d.name === domainName)!;
      const b = withoutCoupling.domains.find((d) => d.name === domainName)!;
      assertCouplingMapsEqual(a, b);
    }
  });

  it("logs a Discounting message only when the hub-domain set is non-empty", async () => {
    writeConfig({
      domains: {
        Core: { description: "Core", eventSheetDirs: ["Core"] },
        UI: { description: "UI", eventSheetDirs: ["UI"] },
      },
      coupling: { hubDomains: ["Core"] },
    });
    const logsWithHub: string[] = [];
    await generateDomainIndex(tmpDir, outDir, tmpDir, "domain-config.json", (...args: unknown[]) =>
      logsWithHub.push(String(args[0])),
    );
    assert.isTrue(
      logsWithHub.some((l) => l.includes("Discounting 1 hub domain(s): Core")),
      "expected a Discounting log line naming the hub domain",
    );

    fs.rmSync(outDir, { recursive: true, force: true });
    writeConfig({
      domains: {
        Core: { description: "Core", eventSheetDirs: ["Core"] },
        UI: { description: "UI", eventSheetDirs: ["UI"] },
      },
    });
    const logsWithoutHub: string[] = [];
    await generateDomainIndex(tmpDir, outDir, tmpDir, "domain-config.json", (...args: unknown[]) =>
      logsWithoutHub.push(String(args[0])),
    );
    assert.isFalse(
      logsWithoutHub.some((l) => l.includes("Discounting")),
      "no Discounting log line when there is no coupling block",
    );
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

  // R6: objectTypeDirs/familyDirs round-trip unchanged, including passthrough of unknown keys
  it("R6: retains objectTypeDirs and familyDirs on a domain (passthrough)", async () => {
    const configObj = {
      domains: {
        Battle: {
          description: "Battle system",
          objectTypeDirs: ["Battle", "Battle/Hero"],
          familyDirs: ["Battle"],
          unknownDomainKey: "kept",
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "domain-config.json"),
      JSON.stringify(configObj),
      "utf-8",
    );

    const result = await loadConfig(tmpDir, "domain-config.json");

    assert.deepEqual(result.domains["Battle"]!.objectTypeDirs, ["Battle", "Battle/Hero"]);
    assert.deepEqual(result.domains["Battle"]!.familyDirs, ["Battle"]);
    assert.equal(
      (result.domains["Battle"] as Record<string, unknown>)["unknownDomainKey"],
      "kept",
    );
  });

  // R12: coupling block round-trips, including passthrough of an unknown nested key
  it("R12: retains coupling.discountSharedKernel and coupling.hubDomains (passthrough)", async () => {
    const configObj = {
      domains: {
        Core: { description: "Core" },
      },
      coupling: {
        discountSharedKernel: true,
        hubDomains: ["Core"],
        unknownKey: "kept",
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "domain-config.json"),
      JSON.stringify(configObj),
      "utf-8",
    );

    const result = await loadConfig(tmpDir, "domain-config.json");

    assert.equal(result.coupling?.discountSharedKernel, true);
    assert.deepEqual(result.coupling?.hubDomains, ["Core"]);
    assert.equal(
      (result.coupling as Record<string, unknown>)["unknownKey"],
      "kept",
    );
  });

  // R13: malformed coupling.hubDomains (not an array) causes rejection with loadProjectConfig( prefix
  it("R13: rejects when coupling.hubDomains is malformed", async () => {
    const configObj = {
      domains: {
        Core: { description: "Core" },
      },
      coupling: {
        hubDomains: "not-an-array",
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, "domain-config.json"),
      JSON.stringify(configObj),
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

describe("extractExpressionRefs", () => {
  it("collects an object name from a plain member-reference condition param", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 100,
          conditions: [
            { id: "compare-instance-variable", objectClass: "Sprite", sid: 101, parameters: { value: "Player.Health" } },
          ],
          actions: [],
        },
      ],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, ["Player"]);
  });

  it("collects the object name (not the behavior name) from a behavior-prefixed reference", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 200,
          conditions: [],
          actions: [
            {
              id: "set-value",
              objectClass: "Sprite",
              sid: 201,
              parameters: { value: "Player.Platform.VectorX" },
            },
          ],
        },
      ],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, ["Player"]);
  });

  it("collects a family-name-shaped reference without distinguishing it from an object", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 300,
          conditions: [
            { id: "compare-instance-variable", objectClass: "Sprite", sid: 301, parameters: { value: "Enemies.Speed" } },
          ],
          actions: [],
        },
      ],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, ["Enemies"]);
  });

  it("ignores a member-reference-shaped string inside a quoted string literal", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 400,
          conditions: [
            {
              id: "compare-instance-variable",
              objectClass: "Sprite",
              sid: 401,
              parameters: { value: '"Player.Health is low"' },
            },
          ],
          actions: [],
        },
      ],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, []);
  });

  it("ignores a systemFunction call and a bare variable (no reference token)", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 500,
          conditions: [
            { id: "compare-instance-variable", objectClass: "Sprite", sid: 501, parameters: { value: "int(dt)" } },
          ],
          actions: [
            { id: "set-value", objectClass: "Sprite", sid: 502, parameters: { value: "foo" } },
          ],
        },
      ],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, []);
  });

  it("skips a script action entirely (TypeScript, not a C3 expression)", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 600,
          conditions: [],
          actions: [
            { type: "script", language: "typescript", script: ["runtime.objects.Foo.x = 1;"] },
          ],
        },
      ],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, []);
  });

  it("dedupes an object name referenced twice across different events/params", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [
        {
          eventType: "block",
          sid: 700,
          conditions: [
            { id: "compare-instance-variable", objectClass: "Sprite", sid: 701, parameters: { value: "Player.Health" } },
          ],
          actions: [
            { id: "set-value", objectClass: "Sprite", sid: 702, parameters: { value: "Player.Score" } },
          ],
        },
      ],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, ["Player"]);
  });

  it("returns [] for an empty sheet", () => {
    const sheet = {
      name: "TestSheet",
      sid: 1,
      events: [],
    } as unknown as EventSheet;

    const result = extractExpressionRefs(sheet);

    assert.deepEqual(result, []);
  });
});
