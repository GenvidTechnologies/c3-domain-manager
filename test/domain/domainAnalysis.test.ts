import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  listUncategorized,
  listStaleOverrides,
  listInertOverrides,
  collectValidDomainNames,
  validateOverrideKeys,
  validateOverrideValues,
} from "../../src/domain/domainAnalysis.js";
import type { DomainConfig } from "../../src/domain/types.js";
import { computeDomainData } from "../../src/domain/domainGenerator.js";
import { fixtureProjectPath, FIXTURE_CONFIG } from "../fixtureHelpers.js";
import { createFile, makeTempDir, removeTempDir } from "../syntheticProject.js";
import { makeConfig } from "../domainModel.js";

describe("domainAnalysis", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("domainAnalysis-");
  });

  afterEach(() => {
    removeTempDir(tmpDir);
  });

  describe("listStaleOverrides", () => {
    it("returns empty when all overrides exist", () => {
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json");
      createFile(tmpDir, "layouts/Main/MainLayout.json");

      const config = makeConfig(
        { Auth: { description: "Auth", eventSheetDirs: ["Login"] } },
        {
          overrides: {
            "eventSheets/Login/LoginEvents.json": "Auth",
            "layouts/Main/MainLayout.json": "Navigation",
          },
        },
      );

      const result = listStaleOverrides(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("returns stale entries when files don't exist", () => {
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        {
          overrides: {
            "eventSheets/Login/LoginEvents.json": "Auth",
            "eventSheets/Deleted/OldSheet.json": "Legacy",
            "layouts/Missing/Layout.json": "Gone",
          },
        },
      );

      const result = listStaleOverrides(tmpDir, config);
      assert.deepEqual(result, ["eventSheets/Deleted/OldSheet.json", "layouts/Missing/Layout.json"]);
    });

    it("returns empty when no overrides in config", () => {
      const config = makeConfig({ Auth: { description: "Auth" } });
      const result = listStaleOverrides(tmpDir, config);
      assert.deepEqual(result, []);
    });
  });

  describe("listInertOverrides", () => {
    it("AC1 — reports editor-local shapes under a non-script section (uistate suffix, uistate/ dir, ts-defs/ dir, tsconfig.json)", () => {
      createFile(tmpDir, "eventSheets/Orphan/OrphanEvents.uistate.json");
      createFile(tmpDir, "eventSheets/Orphan/uistate/Ghost.json");
      createFile(tmpDir, "eventSheets/Orphan/ts-defs/Types.json");
      createFile(tmpDir, "eventSheets/Orphan/tsconfig.json");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        {
          overrides: {
            "eventSheets/Orphan/OrphanEvents.uistate.json": "Auth",
            "eventSheets/Orphan/uistate/Ghost.json": "Auth",
            "eventSheets/Orphan/ts-defs/Types.json": "Auth",
            "eventSheets/Orphan/tsconfig.json": "Auth",
          },
        },
      );

      const result = listInertOverrides(tmpDir, config);
      const keys = result.map((r) => r.key).sort();
      assert.deepEqual(keys, [
        "eventSheets/Orphan/OrphanEvents.uistate.json",
        "eventSheets/Orphan/ts-defs/Types.json",
        "eventSheets/Orphan/tsconfig.json",
        "eventSheets/Orphan/uistate/Ghost.json",
      ]);
      for (const entry of result) {
        assert.isString(entry.reason);
        assert.isAbove(entry.reason.length, 0);
      }
    });

    it("AC2 — the ts-defs/ exemption is section-scoped: exempt under scripts/, not exempt under objectTypes/", () => {
      createFile(tmpDir, "scripts/ts-defs/Player.d.ts");
      createFile(tmpDir, "objectTypes/ts-defs/x.json");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        {
          overrides: {
            "scripts/ts-defs/Player.d.ts": "Auth",
            "objectTypes/ts-defs/x.json": "Auth",
          },
        },
      );

      const result = listInertOverrides(tmpDir, config);
      const keys = result.map((r) => r.key);
      assert.notInclude(keys, "scripts/ts-defs/Player.d.ts");
      assert.include(keys, "objectTypes/ts-defs/x.json");
    });

    it("AC3 — reports a .js compiled-sibling override, but not a standalone .js with no .ts sibling", () => {
      createFile(tmpDir, "scripts/X.js");
      createFile(tmpDir, "scripts/X.ts");
      createFile(tmpDir, "scripts/Y.js");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        {
          overrides: {
            "scripts/X.js": "Auth",
            "scripts/Y.js": "Auth",
          },
        },
      );

      const result = listInertOverrides(tmpDir, config);
      const keys = result.map((r) => r.key);
      assert.include(keys, "scripts/X.js");
      assert.notInclude(keys, "scripts/Y.js");
    });

    it("AC4 — reports a non-source-extension file under scripts/", () => {
      createFile(tmpDir, "scripts/shared/data.json");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "scripts/shared/data.json": "Auth" } },
      );

      const result = listInertOverrides(tmpDir, config);
      assert.deepEqual(
        result.map((r) => r.key),
        ["scripts/shared/data.json"],
      );
    });

    it("AC5 — does not report a non-script-extension file under one of the other four sections", () => {
      createFile(tmpDir, "layouts/Main/notes.txt");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "layouts/Main/notes.txt": "Auth" } },
      );

      const result = listInertOverrides(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("AC6 — reports a trailing-slash key naming a real directory", () => {
      createFile(tmpDir, "scripts/other/foo.ts");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "scripts/other/": "Auth" } },
      );

      const result = listInertOverrides(tmpDir, config);
      assert.deepEqual(
        result.map((r) => r.key),
        ["scripts/other/"],
      );
    });

    it("regression guard — a directory key WITHOUT a trailing slash is live, not inert", () => {
      createFile(tmpDir, "scripts/other/foo.ts");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "scripts/other": "Auth" } },
      );

      const result = listInertOverrides(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("AC7 — a key missing from disk AND editor-local in shape is reported by listStaleOverrides, never by listInertOverrides", () => {
      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "eventSheets/Orphan/uistate/Ghost.json": "Auth" } },
      );

      const stale = listStaleOverrides(tmpDir, config);
      const inert = listInertOverrides(tmpDir, config);

      assert.deepEqual(stale, ["eventSheets/Orphan/uistate/Ghost.json"]);
      assert.deepEqual(inert, []);
    });

    it("returns empty when no overrides in config", () => {
      const config = makeConfig({ Auth: { description: "Auth" } });
      const result = listInertOverrides(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("AC8 — reports a directory-shaped key (no trailing slash) under a non-script section, in both eventSheets/ and families/", () => {
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json");
      createFile(tmpDir, "families/Enemies/Goblin.json");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        {
          overrides: {
            "eventSheets/Login": "Auth",
            "families/Enemies": "Auth",
          },
        },
      );

      const result = listInertOverrides(tmpDir, config);
      const keys = result.map((r) => r.key);
      // Neither eventSheets/ nor families/ ever collapses a directory into a
      // single walk entry the way findScriptEntries does for scripts/ — so a
      // directory-shaped key here can never be produced and must be inert.
      assert.include(keys, "eventSheets/Login");
      assert.include(keys, "families/Enemies");
    });

    it("AC9 — scripts/ts-defs (no trailing slash) is NOT reported — false-positive guard", () => {
      createFile(tmpDir, "scripts/ts-defs/Player.d.ts");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "scripts/ts-defs": "Auth" } },
      );

      const result = listInertOverrides(tmpDir, config);
      const keys = result.map((r) => r.key);
      // This key is genuinely live: findScriptEntries emits a collapsed
      // "scripts/ts-defs/" directory entry because isReportableScriptDir
      // exempts ts-defs, and classifyFile strips the trailing slash from that
      // walk output before matching it against overrides — so the
      // no-trailing-slash key "scripts/ts-defs" does match.
      assert.notInclude(keys, "scripts/ts-defs");
    });

    it("AC10 — scripts/shared (a LAYER_DIRS entry, no trailing slash) is inert", () => {
      createFile(tmpDir, "scripts/shared/util.ts");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "scripts/shared": "Auth" } },
      );

      const result = listInertOverrides(tmpDir, config);
      const keys = result.map((r) => r.key);
      // "shared" is a LAYER_DIRS entry, so findScriptEntries recurses into it
      // and emits "scripts/shared/util.ts" — it never emits a collapsed
      // "scripts/shared/" directory entry, so this key can never be produced.
      assert.include(keys, "scripts/shared");
    });

    it("AC11 — scripts/claimed (config claims strictly below it, no trailing slash) is inert", () => {
      createFile(tmpDir, "scripts/claimed/deep/a.ts");

      const config = makeConfig(
        { Auth: { description: "Auth", scriptDirs: ["claimed/deep"] } },
        { overrides: { "scripts/claimed": "Auth" } },
      );

      const result = listInertOverrides(tmpDir, config);
      const keys = result.map((r) => r.key);
      // The config claims "claimed/deep", strictly below "claimed" — hasClaimBelow
      // forces findScriptEntries to descend, so the walk emits
      // "scripts/claimed/deep/" and never a collapsed "scripts/claimed/" entry.
      assert.include(keys, "scripts/claimed");
    });
  });

  describe("listUncategorized", () => {
    it("returns empty when all files are classified", () => {
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json");
      createFile(tmpDir, "layouts/Login/LoginLayout.json");
      createFile(tmpDir, "scripts/shared/auth/login.ts");

      const config = makeConfig({
        Auth: {
          description: "Auth",
          eventSheetDirs: ["Login"],
          layoutDirs: ["Login"],
          scriptDirs: ["shared/auth"],
        },
      });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("returns uncategorized files", () => {
      // Classified files
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json");
      // Uncategorized files
      createFile(tmpDir, "eventSheets/Orphan/OrphanEvents.json");
      createFile(tmpDir, "layouts/Unknown/SomeLayout.json");

      const config = makeConfig({
        Auth: {
          description: "Auth",
          eventSheetDirs: ["Login"],
        },
      });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, ["eventSheets/Orphan/OrphanEvents.json", "layouts/Unknown/SomeLayout.json"]);
    });

    it("handles missing directories gracefully", () => {
      // Don't create any directories — all three source dirs are missing
      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("classifies files via overrides", () => {
      createFile(tmpDir, "eventSheets/Misc/SpecialEvents.json");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        { overrides: { "eventSheets/Misc/SpecialEvents.json": "Auth" } },
      );

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("classifies files via shared subdomains", () => {
      createFile(tmpDir, "eventSheets/Chat/ChatEvents.json");

      const config = makeConfig(
        { Auth: { description: "Auth" } },
        {
          sharedSubdomains: {
            Chat: {
              description: "Chat system",
              eventSheetDirs: ["Chat"],
            },
          },
        },
      );

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("picks up root-level script files", () => {
      createFile(tmpDir, "scripts/main.ts");
      createFile(tmpDir, "scripts/importsForEvents.ts");

      const config = makeConfig({
        Auth: { description: "Auth" },
      });

      // Root-level scripts are uncategorized since no scriptDirs match
      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, ["scripts/importsForEvents.ts", "scripts/main.ts"]);
    });

    it("reports an unclaimed non-standard script subdirectory as a collapsed directory entry", () => {
      // Files in scripts/SomeOtherDir/ collapse to a single directory entry —
      // findScriptEntries has no allowlist, so nothing below it is claimed.
      createFile(tmpDir, "scripts/SomeOtherDir/foo.ts");
      // Files in scripts/shared/ ARE scanned (a LAYER_DIRS entry) and classified.
      createFile(tmpDir, "scripts/shared/utils/helper.ts");

      const config = makeConfig({
        Core: { description: "Core", scriptDirs: ["shared/utils"] },
      });

      const result = listUncategorized(tmpDir, config);
      // shared/utils/helper.ts is classified. SomeOtherDir/ is unclaimed, so it
      // collapses to a single directory entry (see ADR 0017).
      assert.deepEqual(result, ["scripts/SomeOtherDir/"]);
    });

    it("returns uncategorized object types and families", () => {
      createFile(tmpDir, "objectTypes/Battle/Hero.json");
      createFile(tmpDir, "objectTypes/Orphan/Widget.json");
      createFile(tmpDir, "families/Battle/Units.json");
      createFile(tmpDir, "families/Orphan/Loose.json");

      const config = makeConfig({
        Battle: {
          description: "Battle",
          objectTypeDirs: ["Battle"],
          familyDirs: ["Battle"],
        },
      });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, ["families/Orphan/Loose.json", "objectTypes/Orphan/Widget.json"]);
    });

    it("does not report editor-local artifacts in unclaimed directories (issue #33)", () => {
      // Claimed — sanity check that Login is unaffected.
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json");

      // Unclaimed — real content files should be reported, editor-local
      // siblings (.uistate.json / uistate/) should not.
      createFile(tmpDir, "eventSheets/Orphan/OrphanEvents.json");
      createFile(tmpDir, "eventSheets/Orphan/OrphanEvents.uistate.json");
      createFile(tmpDir, "eventSheets/Orphan/uistate/Orphan.json");
      createFile(tmpDir, "layouts/Orphan/OrphanLayout.json");
      createFile(tmpDir, "layouts/Orphan/OrphanLayout.uistate.json");
      createFile(tmpDir, "objectTypes/Orphan/Widget.json");
      createFile(tmpDir, "objectTypes/Orphan/Widget.uistate.json");
      createFile(tmpDir, "objectTypes/Orphan/uistate/Widget.json");
      createFile(tmpDir, "families/Orphan/Loose.json");
      createFile(tmpDir, "families/Orphan/Loose.uistate.json");

      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, [
        "eventSheets/Orphan/OrphanEvents.json",
        "families/Orphan/Loose.json",
        "layouts/Orphan/OrphanLayout.json",
        "objectTypes/Orphan/Widget.json",
      ]);
    });

    it("reports ts-defs source files but not their editor-local artifacts (issue #33)", () => {
      createFile(tmpDir, "scripts/ts-defs/Player.d.ts");
      createFile(tmpDir, "scripts/ts-defs/objects.d.ts");
      createFile(tmpDir, "scripts/ts-defs/uistate/x.d.ts");
      createFile(tmpDir, "scripts/ts-defs/tsconfig.json");
      createFile(tmpDir, "scripts/tsconfig.json");
      createFile(tmpDir, "scripts/main.ts");
      // scripts/main.js is suppressed because scripts/main.ts sits beside it
      // in the same directory (compiled-sibling suppression, ADR 0016 clause
      // 1) -- not because of a .ts-only filter, which no longer exists.
      // scripts/onlyjs.js has no .ts sibling, so it IS reported: it exercises
      // the new .js admission (ADR 0016 clause 2). scripts/ts-defs/** is
      // deliberately walked and reported.
      createFile(tmpDir, "scripts/main.js");
      createFile(tmpDir, "scripts/onlyjs.js");

      const config = makeConfig({
        Auth: { description: "Auth" },
      });

      const result = listUncategorized(tmpDir, config);
      // ts-defs/ is unclaimed here (no scriptDirs at all), so its two files
      // collapse to a single directory entry (see ADR 0017).
      assert.deepEqual(result, ["scripts/main.ts", "scripts/onlyjs.js", "scripts/ts-defs/"]);
    });

    it("still classifies ts-defs into a domain that claims it in scriptDirs (issue #33)", () => {
      createFile(tmpDir, "scripts/ts-defs/Player.d.ts");
      createFile(tmpDir, "scripts/ts-defs/objects.d.ts");
      createFile(tmpDir, "scripts/ts-defs/uistate/x.d.ts");
      createFile(tmpDir, "scripts/ts-defs/tsconfig.json");
      createFile(tmpDir, "scripts/tsconfig.json");
      createFile(tmpDir, "scripts/main.ts");
      createFile(tmpDir, "scripts/main.js");
      createFile(tmpDir, "scripts/onlyjs.js");

      const config = makeConfig({
        Core: { description: "Core", scriptDirs: ["ts-defs"] },
      });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, ["scripts/main.ts", "scripts/onlyjs.js"]);
    });

    it("R-D2 — the four non-script section walks still report a stray file individually, unaffected by the scripts/ delegation", () => {
      createFile(tmpDir, "eventSheets/Orphan/notes.md");
      createFile(tmpDir, "families/Orphan/notes.md");
      createFile(tmpDir, "layouts/Orphan/r.txt");
      createFile(tmpDir, "objectTypes/Orphan/i.png");

      const config = makeConfig({
        Auth: { description: "Auth" },
      });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, [
        "eventSheets/Orphan/notes.md",
        "families/Orphan/notes.md",
        "layouts/Orphan/r.txt",
        "objectTypes/Orphan/i.png",
      ]);
    });
  });
});

describe("collectValidDomainNames", () => {
  it("returns domain and subdomain names", () => {
    const config: DomainConfig = {
      domains: { Auth: { description: "Auth" }, Battle: { description: "Battle" } },
      sharedSubdomains: { Chat: { description: "Chat" } },
    };

    const result = collectValidDomainNames(config);
    assert.isTrue(result.has("Auth"));
    assert.isTrue(result.has("Battle"));
    assert.isTrue(result.has("Chat"));
    assert.equal(result.size, 3);
  });

  it("handles config with no sharedSubdomains", () => {
    const config: DomainConfig = { domains: { Auth: { description: "Auth" } } };

    const result = collectValidDomainNames(config);
    assert.isTrue(result.has("Auth"));
    assert.equal(result.size, 1);
  });
});

describe("validateOverrideKeys", () => {
  it("accepts eventSheets/, layouts/, scripts/, objectTypes/, families/ prefixes", () => {
    const result = validateOverrideKeys([
      "eventSheets/Login/Login.json",
      "layouts/Main/Main.json",
      "scripts/shared/auth/login.ts",
      "objectTypes/Battle/Hero.json",
      "families/Battle/Units.json",
    ]);
    assert.deepEqual(result, []);
  });

  it("rejects paths without valid prefix", () => {
    const result = validateOverrideKeys(["foo/bar.json"]);
    assert.equal(result.length, 1);
    assert.include(result[0], "Invalid path prefix: 'foo/bar.json'");
  });

  it("returns empty array for all-valid keys", () => {
    const result = validateOverrideKeys(["eventSheets/Misc/Special.json"]);
    assert.deepEqual(result, []);
  });
});

describe("validateOverrideValues", () => {
  it("accepts known domain names", () => {
    const validNames = new Set(["Auth", "Battle"]);
    const result = validateOverrideValues(
      { "eventSheets/Login/Login.json": "Auth" },
      validNames,
    );
    assert.deepEqual(result, []);
  });

  it("accepts known subdomain names", () => {
    const validNames = new Set(["Auth", "Chat"]);
    const result = validateOverrideValues(
      { "eventSheets/Chat/Chat.json": "Chat" },
      validNames,
    );
    assert.deepEqual(result, []);
  });

  it("rejects unknown names with suggestion", () => {
    const validNames = new Set(["Auth", "Battle", "Chat", "Inventory", "Navigation"]);
    const result = validateOverrideValues(
      { "eventSheets/Foo/Foo.json": "FakeDomain" },
      validNames,
    );
    assert.equal(result.length, 1);
    assert.include(result[0], "Unknown domain 'FakeDomain'");
    assert.include(result[0], "eventSheets/Foo/Foo.json");
    assert.include(result[0], "Auth");
  });

  it("appends '...' when more than 5 valid names exist", () => {
    const validNames = new Set(["Auth", "Battle", "Chat", "Inventory", "Navigation", "Profile"]);
    const result = validateOverrideValues(
      { "eventSheets/Foo/Foo.json": "FakeDomain" },
      validNames,
    );
    assert.equal(result.length, 1);
    assert.include(result[0], "...");
  });

  it("returns empty array for all-valid values", () => {
    const validNames = new Set(["Auth"]);
    const result = validateOverrideValues(
      { "eventSheets/Login/Login.json": "Auth" },
      validNames,
    );
    assert.deepEqual(result, []);
  });
});

describe("listUncategorized — canonical fixture", () => {
  const root = fixtureProjectPath();

  it("reports exactly the two deliberately-unclassified files", () => {
    const result = listUncategorized(root, FIXTURE_CONFIG);

    assert.deepEqual(result, ["layouts/Templates Layout.json", "objectTypes/TextInput.json"]);
  });

  it("does not report scripts/tsconfig.json, and classifies ts-defs/ as a directory entry on Gameplay", () => {
    // tsconfig.json never reaches classifyFile at all: the root-scripts walk
    // filters to .ts|.js, and isEditorLocalPath excludes it by name.
    const result = listUncategorized(root, FIXTURE_CONFIG);
    assert.notInclude(result, "scripts/tsconfig.json");
    assert.isFalse(
      result.some((p) => p.startsWith("scripts/")),
      "nothing scripts/-rooted is left uncategorized in the fixture",
    );

    // Positive assertion (ADR 0014 — don't assert the absence of something the
    // fixture never had): ts-defs/ is claimed as a unit by Gameplay's
    // scriptDirs: ["ts-defs"], so findScriptEntries collapses it to a single
    // directory entry rather than descending, and computeDomainData attributes
    // that entry to Gameplay.
    const { domains } = computeDomainData(root, FIXTURE_CONFIG);
    const gameplay = domains.find((d) => d.name === "Gameplay");
    assert.isDefined(gameplay);
    assert.deepInclude(gameplay!.scripts, { path: "scripts/ts-defs/", isDirectory: true });
  });

  // Deliberately NOT asserted here: that no *.uistate.json or uistate/ path
  // appears. The canonical project has never tracked any -- upstream gitignores
  // them, because the editor rewrites them on every open and their content
  // carries no signal -- so such an assertion would pass without exercising the
  // exclusion at all, and would keep passing if the exclusion were deleted.
  // That coverage belongs to the synthetic temp-dir tests above, which can
  // actually construct the negative case.
});
