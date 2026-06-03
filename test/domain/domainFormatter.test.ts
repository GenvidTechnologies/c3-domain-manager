import { describe, it } from "mocha";
import { assert } from "chai";
import { classifyFile } from "../../src/domain/classification.js";
import { extractFunctionDefs } from "../../src/domain/domainGenerator.js";
import { extractIncludes } from "@genvid/c3source";
import type { EventSheet, EventSheetEvent } from "@genvid/c3source";
import { formatDomainIndex, formatDomainPage } from "../../src/domain/formatting.js";
import type { DomainConfig, DomainData, FunctionDef } from "../../src/domain/types.js";

/** Wrap a fixture event array into a minimal EventSheet for the c3source extractors. */
function makeSheet(name: string, events: unknown[]): EventSheet {
  return { name, sid: 0, events: events as EventSheetEvent[] };
}

/** Included sheet names for a fixture event array, via c3source's extractIncludes. */
function includeNames(events: unknown[]): string[] {
  return extractIncludes(makeSheet("Fixture", events)).map((r) => r.includeSheet);
}

/** Helper to create a minimal DomainConfig. */
function makeConfig(domains: DomainConfig["domains"], overrides?: DomainConfig["overrides"]): DomainConfig {
  return { domains, overrides };
}

/** Helper to create a DomainData with sensible defaults. */
function makeDomain(name: string, opts?: Partial<DomainData>): DomainData {
  return {
    name,
    description: opts?.description ?? "",
    eventSheets: opts?.eventSheets ?? [],
    layouts: opts?.layouts ?? [],
    scripts: opts?.scripts ?? [],
    functions: opts?.functions ?? [],
    includesFrom: opts?.includesFrom ?? new Map(),
    includedBy: opts?.includedBy ?? new Map(),
  };
}

describe("domainFormatter", () => {
  describe("classifyFile", () => {
    it("override takes priority over directory mapping", () => {
      const config = makeConfig(
        {
          Auth: {
            description: "Authentication",
            eventSheetDirs: ["Login"],
          },
        },
        { "eventSheets/Login/SpecialEvents.json": "SpecialDomain" },
      );
      const result = classifyFile("eventSheets/Login/SpecialEvents.json", "eventSheet", config);
      assert.equal(result, "SpecialDomain");
    });

    it("directory mapping matches first segment", () => {
      const config = makeConfig({
        Auth: {
          description: "Authentication",
          eventSheetDirs: ["Login"],
        },
      });
      const result = classifyFile("eventSheets/Login/LoginEvents.json", "eventSheet", config);
      assert.equal(result, "Auth");
    });

    it("nested directory path matches correctly", () => {
      const config = makeConfig({
        Shop: {
          description: "Shop features",
          eventSheetDirs: ["Main Menu/Shop"],
        },
      });
      const result = classifyFile("eventSheets/Main Menu/Shop/ShopEvents.json", "eventSheet", config);
      assert.equal(result, "Shop");
    });

    it("longest prefix wins when multiple dirs could match", () => {
      const config = makeConfig({
        MainMenu: {
          description: "Main menu",
          eventSheetDirs: ["Main Menu"],
        },
        Shop: {
          description: "Shop features",
          eventSheetDirs: ["Main Menu/Shop"],
        },
      });
      const result = classifyFile("eventSheets/Main Menu/Shop/ShopEvents.json", "eventSheet", config);
      assert.equal(result, "Shop");
    });

    it("unmatched file returns null", () => {
      const config = makeConfig({
        Auth: {
          description: "Authentication",
          eventSheetDirs: ["Login"],
        },
      });
      const result = classifyFile("eventSheets/UnknownDir/SomeSheet.json", "eventSheet", config);
      assert.isNull(result);
    });

    it("classifies layout files using layoutDirs", () => {
      const config = makeConfig({
        Levels: {
          description: "Game levels",
          layoutDirs: ["Levels"],
        },
      });
      const result = classifyFile("layouts/Levels/Level1Layout.json", "layout", config);
      assert.equal(result, "Levels");
    });

    it("classifies script files using scriptDirs", () => {
      const config = makeConfig({
        Skills: {
          description: "Skills system",
          scriptDirs: ["Skills"],
        },
      });
      const result = classifyFile("scripts/Skills/Skills.ts", "script", config);
      assert.equal(result, "Skills");
    });

    it("classifies exact directory name match for scripts", () => {
      const config = makeConfig({
        Skills: {
          description: "Skills system",
          scriptDirs: ["Skills"],
        },
      });
      const result = classifyFile("scripts/Skills", "script", config);
      assert.equal(result, "Skills");
    });
  });

  describe("extractIncludes (c3source) → include names", () => {
    it("returns included sheet names from event array", () => {
      const events = [
        { eventType: "include", includeSheet: "Login/LoginEvents" },
        { eventType: "include", includeSheet: "Goals/GoalEvents" },
      ];
      const result = includeNames(events);
      assert.deepEqual(result, ["Login/LoginEvents", "Goals/GoalEvents"]);
    });

    it("skips non-include events", () => {
      const events = [
        { eventType: "comment", text: "Setup" },
        { eventType: "include", includeSheet: "Login/LoginEvents" },
        {
          eventType: "block",
          conditions: [],
          actions: [],
          sid: 1,
        },
      ];
      const result = includeNames(events);
      assert.deepEqual(result, ["Login/LoginEvents"]);
    });

    it("returns empty for no includes", () => {
      const events = [
        { eventType: "comment", text: "No includes here" },
        {
          eventType: "variable",
          name: "x",
          type: "number",
          initialValue: "0",
          isStatic: false,
          isConstant: false,
          sid: 1,
        },
      ];
      const result = includeNames(events);
      assert.deepEqual(result, []);
    });

    it("finds includes nested inside groups", () => {
      const events = [
        {
          eventType: "group",
          title: "Outer",
          disabled: false,
          isActiveOnStart: true,
          sid: 1,
          children: [{ eventType: "include", includeSheet: "Nested/Sheet" }],
        },
      ];
      const result = includeNames(events);
      assert.deepEqual(result, ["Nested/Sheet"]);
    });
  });

  describe("extractFunctionDefs", () => {
    it("extracts function-block with params and return type", () => {
      const events = [
        {
          eventType: "function-block",
          functionName: "getScore",
          functionReturnType: "number",
          functionCopyPicked: false,
          functionIsAsync: false,
          functionParameters: [
            { name: "level", type: "number", initialValue: "1", sid: 10 },
            { name: "name", type: "string", initialValue: '""', sid: 11 },
          ],
          conditions: [],
          actions: [],
          sid: 100,
        },
      ];
      const result = extractFunctionDefs(makeSheet("Scoring/ScoreEvents", events), "Scoring/ScoreEvents");
      assert.lengthOf(result, 1);
      assert.equal(result[0].name, "getScore");
      assert.equal(result[0].params, "level: number, name: string");
      assert.equal(result[0].returnType, "number");
      assert.equal(result[0].sourceSheet, "Scoring/ScoreEvents");
      assert.isUndefined(result[0].objectClass);
      assert.isUndefined(result[0].aceName);
    });

    it("extracts custom-ace-block with objectClass", () => {
      const events = [
        {
          eventType: "custom-ace-block",
          aceType: "condition",
          aceName: "IsReady",
          objectClass: "MyPlugin",
          functionReturnType: "boolean",
          functionCopyPicked: false,
          functionIsAsync: false,
          functionParameters: [{ name: "id", type: "number", initialValue: "0", sid: 20 }],
          conditions: [],
          actions: [],
          sid: 200,
        },
      ];
      const result = extractFunctionDefs(makeSheet("Plugins/PluginEvents", events), "Plugins/PluginEvents");
      assert.lengthOf(result, 1);
      assert.equal(result[0].name, "IsReady");
      assert.equal(result[0].params, "id: number");
      assert.equal(result[0].returnType, "boolean");
      assert.equal(result[0].objectClass, "MyPlugin");
      assert.equal(result[0].aceName, "IsReady");
      assert.equal(result[0].sourceSheet, "Plugins/PluginEvents");
    });

    it("finds functions nested inside groups", () => {
      const events = [
        {
          eventType: "group",
          title: "Utilities",
          disabled: false,
          isActiveOnStart: true,
          sid: 1,
          children: [
            {
              eventType: "function-block",
              functionName: "helperFunc",
              functionReturnType: "none",
              functionCopyPicked: false,
              functionIsAsync: false,
              functionParameters: [],
              conditions: [],
              actions: [],
              sid: 300,
            },
          ],
        },
      ];
      const result = extractFunctionDefs(makeSheet("Utils/UtilEvents", events), "Utils/UtilEvents");
      assert.lengthOf(result, 1);
      assert.equal(result[0].name, "helperFunc");
      assert.equal(result[0].params, "");
      assert.equal(result[0].returnType, "none");
    });

    it("returns empty for no functions", () => {
      const events = [
        { eventType: "comment", text: "No functions" },
        {
          eventType: "block",
          conditions: [],
          actions: [],
          sid: 1,
        },
      ];
      const result = extractFunctionDefs(makeSheet("Empty/Sheet", events), "Empty/Sheet");
      assert.deepEqual(result, []);
    });
  });

  describe("formatDomainIndex", () => {
    it("table with domain counts and dependencies", () => {
      const authDomain = makeDomain("Authentication", {
        description: "Login, device binding",
        eventSheets: [
          { path: "eventSheets/Login/LoginEvents.json", directory: "Login" },
          { path: "eventSheets/Login/DeviceEvents.json", directory: "Login" },
        ],
        layouts: [
          { path: "layouts/Login/LoginLayout.json", eventSheet: "LoginEvents", eventSheetDomain: "Authentication" },
        ],
        scripts: [{ path: "scripts/Auth/", isDirectory: true }],
        includesFrom: new Map([["Core", ["CoreUtils"]]]),
      });
      const coreDomain = makeDomain("Core", {
        description: "Core infrastructure",
        eventSheets: [{ path: "eventSheets/Core/CoreUtils.json", directory: "Core" }],
        layouts: [],
        scripts: [
          { path: "scripts/utils.ts", isDirectory: false },
          { path: "scripts/helpers.ts", isDirectory: false },
        ],
      });

      const result = formatDomainIndex([authDomain, coreDomain], []);
      assert.include(result, "# C3 Domain Index");
      assert.include(result, "## Domains");
      // Table header
      assert.include(result, "| Domain | Description | EventSheets | Layouts | Scripts | Dependencies |");
      // Auth row
      assert.include(result, "Authentication");
      assert.include(result, "Login, device binding");
      assert.include(result, "2"); // eventSheets
      assert.include(result, "1"); // layouts
      assert.include(result, "1 dir"); // scripts
      assert.include(result, "Core"); // dependency
      // Core row
      assert.include(result, "Core infrastructure");
      assert.include(result, "2 files"); // scripts
      // "All files classified." when no unclassified
      assert.include(result, "All files classified.");
    });

    it("shows cross-domain hubs", () => {
      const hubDomain = makeDomain("Core", {
        description: "Core hub",
        eventSheets: [{ path: "eventSheets/UserCharacterEvents.json", directory: "" }],
      });
      // Simulate UserCharacterEvents including 5+ sheets from 3+ domains
      // We need the includesFrom to reflect this
      hubDomain.includesFrom = new Map([
        ["Auth", ["LoginEvents", "DeviceEvents"]],
        ["Combat", ["CombatEvents", "EnemyEvents"]],
        ["UI", ["UIEvents"]],
      ]);

      // The hub detection is based on eventSheets that include many sheets spanning many domains
      // We pass this info through the data; formatDomainIndex detects hubs from domain data
      // Actually, cross-domain hub detection requires knowing which sheet includes what.
      // Let's build a more realistic test:
      const domains = [hubDomain];
      const result = formatDomainIndex(domains, []);
      // The cross-domain hubs section should appear
      assert.include(result, "## Cross-Domain Hubs");
    });

    it("shows unclassified files section when non-empty", () => {
      const domain = makeDomain("Auth", {
        description: "Authentication",
        eventSheets: [{ path: "eventSheets/Login/LoginEvents.json", directory: "Login" }],
      });
      const unclassified = ["eventSheets/Orphan/OrphanEvents.json", "layouts/Unknown/UnknownLayout.json"];
      const result = formatDomainIndex([domain], unclassified);
      assert.include(result, "## Unclassified Files (2)");
      assert.include(result, "eventSheets/Orphan/OrphanEvents.json");
      assert.include(result, "layouts/Unknown/UnknownLayout.json");
    });
  });

  describe("formatDomainPage", () => {
    it("eventSheets grouped by directory then root", () => {
      const domain = makeDomain("Auth", {
        description: "Authentication and login",
        eventSheets: [
          { path: "eventSheets/Login/LoginEvents.json", directory: "Login" },
          { path: "eventSheets/Login/DeviceEvents.json", directory: "Login" },
          { path: "eventSheets/AuthRoot.json", directory: "" },
        ],
      });
      const result = formatDomainPage(domain);
      assert.include(result, "# Auth");
      assert.include(result, "Authentication and login");
      assert.include(result, "## EventSheets (3)");
      assert.include(result, "### Login/ (2)");
      assert.include(result, "- LoginEvents.json");
      assert.include(result, "- DeviceEvents.json");
      assert.include(result, "### Root (1)");
      assert.include(result, "- AuthRoot.json");
      // Verify Login comes before Root (alphabetical, Root last)
      const loginIdx = result.indexOf("### Login/");
      const rootIdx = result.indexOf("### Root");
      assert.isAbove(rootIdx, loginIdx);
    });

    it("functions grouped by source eventSheet", () => {
      const funcs: FunctionDef[] = [
        {
          name: "getScore",
          params: "level: number, name: string",
          returnType: "number",
          sourceSheet: "Scoring/ScoreEvents",
        },
        {
          name: "resetScore",
          params: "",
          returnType: "none",
          sourceSheet: "Scoring/ScoreEvents",
        },
        {
          name: "IsReady",
          params: "id: number",
          returnType: "boolean",
          sourceSheet: "Plugins/PluginEvents",
          objectClass: "MyPlugin",
          aceName: "IsReady",
        },
      ];
      const domain = makeDomain("Scoring", {
        description: "Scoring system",
        functions: funcs,
      });
      const result = formatDomainPage(domain);
      assert.include(result, "## Functions (3)");
      assert.include(result, "### Scoring/ScoreEvents");
      assert.include(result, "- getScore(level: number, name: string) → number");
      assert.include(result, "- resetScore() → none");
      assert.include(result, "### Plugins/PluginEvents");
      assert.include(result, "- MyPlugin.IsReady(id: number) → boolean");
    });

    it("layouts with cross-domain eventSheet annotation", () => {
      const domain = makeDomain("Levels", {
        description: "Game levels",
        layouts: [
          {
            path: "layouts/Levels/Level1Layout.json",
            eventSheet: "UserCharacterEvents",
            eventSheetDomain: "Core",
          },
          {
            path: "layouts/Levels/Level2Layout.json",
            eventSheet: "UserCharacterEvents",
            eventSheetDomain: "Levels",
          },
        ],
      });
      const result = formatDomainPage(domain);
      assert.include(result, "## Layouts (2)");
      assert.include(result, "layouts/Levels/Level1Layout.json → UserCharacterEvents (cross-domain: Core)");
      assert.include(result, "layouts/Levels/Level2Layout.json → UserCharacterEvents");
      // The non-cross-domain one should NOT have the annotation
      const line2 = result.split("\n").find((l) => l.includes("Level2Layout") && l.includes("→"));
      assert.isOk(line2);
      assert.notInclude(line2!, "cross-domain");
    });

    it("scripts split into directories and files", () => {
      const domain = makeDomain("Combat", {
        description: "Combat system",
        scripts: [
          { path: "scripts/Combat/", isDirectory: true },
          { path: "scripts/Enemies/", isDirectory: true },
          { path: "scripts/combatUtils.ts", isDirectory: false },
        ],
      });
      const result = formatDomainPage(domain);
      assert.include(result, "## Scripts");
      assert.include(result, "### Directories");
      assert.include(result, "- scripts/Combat/");
      assert.include(result, "- scripts/Enemies/");
      assert.include(result, "### Files");
      assert.include(result, "- scripts/combatUtils.ts");
    });

    it("cross-domain dependencies", () => {
      const domain = makeDomain("Auth", {
        description: "Authentication",
        includesFrom: new Map([
          ["Core", ["CoreUtils", "SystemEvents"]],
          ["UI", ["HeaderEvents"]],
        ]),
        includedBy: new Map([["Combat", ["CombatEvents"]]]),
      });
      const result = formatDomainPage(domain);
      assert.include(result, "## Cross-Domain Dependencies");
      assert.include(result, "### Includes from this domain");
      assert.include(result, "Core");
      assert.include(result, "2 sheets");
      assert.include(result, "CoreUtils");
      assert.include(result, "SystemEvents");
      assert.include(result, "### Includes into this domain");
      assert.include(result, "Combat");
    });

    it("empty sections show header with count 0", () => {
      const domain = makeDomain("Empty", {
        description: "An empty domain",
      });
      const result = formatDomainPage(domain);
      assert.include(result, "## EventSheets (0)");
      assert.include(result, "## Functions (0)");
      assert.include(result, "## Layouts (0)");
    });

    it("truncates includesFrom with more than 5 sheets", () => {
      const domain = makeDomain("Hub", {
        description: "Hub domain",
        includesFrom: new Map([["Big", ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]]]),
      });
      const result = formatDomainPage(domain);
      assert.include(result, "...");
      // Should show 5 sheets, then "..."
      assert.include(result, "S1");
      assert.include(result, "S5");
    });
  });

  describe("integration", () => {
    it("full integration test with multi-domain data", () => {
      // Build up realistic multi-domain data
      const authDomain = makeDomain("Authentication", {
        description: "Login, device binding, Epic, age check",
        eventSheets: [
          { path: "eventSheets/Login/LoginEvents.json", directory: "Login" },
          { path: "eventSheets/Login/DeviceEvents.json", directory: "Login" },
          { path: "eventSheets/Login/AgeCheckEvents.json", directory: "Login" },
        ],
        layouts: [
          {
            path: "layouts/Login/LoginLayout.json",
            eventSheet: "LoginEvents",
            eventSheetDomain: "Authentication",
          },
        ],
        scripts: [{ path: "scripts/Auth/", isDirectory: true }],
        functions: [
          {
            name: "handleLogin",
            params: "userId: string",
            returnType: "none",
            sourceSheet: "Login/LoginEvents",
          },
        ],
        includesFrom: new Map([["Core", ["CoreUtils"]]]),
        includedBy: new Map(),
      });

      const coreDomain = makeDomain("Core", {
        description: "Core infrastructure and utilities",
        eventSheets: [
          { path: "eventSheets/Core/CoreUtils.json", directory: "Core" },
          { path: "eventSheets/Core/SystemEvents.json", directory: "Core" },
        ],
        layouts: [],
        scripts: [{ path: "scripts/utils.ts", isDirectory: false }],
        functions: [],
        includedBy: new Map([["Authentication", ["LoginEvents"]]]),
      });

      // Test formatDomainIndex
      const index = formatDomainIndex([authDomain, coreDomain], []);
      assert.include(index, "# C3 Domain Index");
      assert.include(index, "Authentication");
      assert.include(index, "Core");
      assert.include(index, "All files classified.");

      // Test formatDomainPage for Auth
      const authPage = formatDomainPage(authDomain);
      assert.include(authPage, "# Authentication");
      assert.include(authPage, "## EventSheets (3)");
      assert.include(authPage, "### Login/ (3)");
      assert.include(authPage, "## Functions (1)");
      assert.include(authPage, "- handleLogin(userId: string) → none");
      assert.include(authPage, "## Layouts (1)");
      assert.include(authPage, "## Cross-Domain Dependencies");

      // Test formatDomainPage for Core
      const corePage = formatDomainPage(coreDomain);
      assert.include(corePage, "# Core");
      assert.include(corePage, "## EventSheets (2)");
      assert.include(corePage, "## Layouts (0)");
      assert.include(corePage, "### Includes into this domain");

      // Test classifyFile with a config
      const config = makeConfig({
        Authentication: {
          description: "Login",
          eventSheetDirs: ["Login"],
          layoutDirs: ["Login"],
          scriptDirs: ["Auth"],
        },
        Core: {
          description: "Core",
          eventSheetDirs: ["Core"],
          scriptDirs: [],
        },
      });
      assert.equal(classifyFile("eventSheets/Login/LoginEvents.json", "eventSheet", config), "Authentication");
      assert.equal(classifyFile("eventSheets/Core/CoreUtils.json", "eventSheet", config), "Core");
      assert.isNull(classifyFile("eventSheets/Unknown/Thing.json", "eventSheet", config));

      // Test extractIncludes
      const events = [
        { eventType: "include", includeSheet: "Login/LoginEvents" },
        { eventType: "comment", text: "A comment" },
        {
          eventType: "group",
          title: "G",
          disabled: false,
          isActiveOnStart: true,
          sid: 1,
          children: [{ eventType: "include", includeSheet: "Core/CoreUtils" }],
        },
      ];
      const includes = includeNames(events);
      assert.deepEqual(includes, ["Login/LoginEvents", "Core/CoreUtils"]);

      // Test extractFunctions
      const funcEvents = [
        {
          eventType: "function-block",
          functionName: "doThing",
          functionReturnType: "string",
          functionCopyPicked: false,
          functionIsAsync: true,
          functionParameters: [{ name: "x", type: "number", initialValue: "0", sid: 1 }],
          conditions: [],
          actions: [],
          sid: 10,
        },
        {
          eventType: "custom-ace-block",
          aceType: "action",
          aceName: "Fire",
          objectClass: "Weapon",
          functionReturnType: "none",
          functionCopyPicked: false,
          functionIsAsync: false,
          functionParameters: [],
          conditions: [],
          actions: [],
          sid: 20,
        },
      ];
      const funcs = extractFunctionDefs(makeSheet("Combat/WeaponEvents", funcEvents), "Combat/WeaponEvents");
      assert.lengthOf(funcs, 2);
      assert.equal(funcs[0].name, "doThing");
      assert.equal(funcs[0].params, "x: number");
      assert.equal(funcs[1].name, "Fire");
      assert.equal(funcs[1].objectClass, "Weapon");
      assert.equal(funcs[1].aceName, "Fire");
    });
  });
});
