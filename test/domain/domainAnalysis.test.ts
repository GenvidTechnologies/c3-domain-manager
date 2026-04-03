import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  listUncategorized,
  listStaleOverrides,
  collectValidDomainNames,
  validateOverrideKeys,
  validateOverrideValues,
} from "../../src/domain/domainAnalysis.js";
import type { DomainConfig } from "../../src/domain/types.js";

/** Create a minimal DomainConfig for testing. */
function makeConfig(
  domains: DomainConfig["domains"],
  overrides?: DomainConfig["overrides"],
  sharedSubdomains?: DomainConfig["sharedSubdomains"],
): DomainConfig {
  return { domains, overrides, sharedSubdomains };
}

/** Create a file (and its parent directories) in the temp dir. */
function createFile(rootDir: string, relativePath: string, content = ""): void {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe("domainAnalysis", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "domainAnalysis-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("listStaleOverrides", () => {
    it("returns empty when all overrides exist", () => {
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json");
      createFile(tmpDir, "layouts/Main/MainLayout.json");

      const config = makeConfig(
        { Auth: { description: "Auth", eventSheetDirs: ["Login"] } },
        {
          "eventSheets/Login/LoginEvents.json": "Auth",
          "layouts/Main/MainLayout.json": "Navigation",
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
          "eventSheets/Login/LoginEvents.json": "Auth",
          "eventSheets/Deleted/OldSheet.json": "Legacy",
          "layouts/Missing/Layout.json": "Gone",
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

      const config = makeConfig({ Auth: { description: "Auth" } }, { "eventSheets/Misc/SpecialEvents.json": "Auth" });

      const result = listUncategorized(tmpDir, config);
      assert.deepEqual(result, []);
    });

    it("classifies files via shared subdomains", () => {
      createFile(tmpDir, "eventSheets/Chat/ChatEvents.json");

      const config = makeConfig({ Auth: { description: "Auth" } }, undefined, {
        Chat: {
          description: "Chat system",
          eventSheetDirs: ["Chat"],
        },
      });

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

    it("does not recurse into non-standard script subdirectories", () => {
      // Files in scripts/SomeOtherDir/ should NOT be scanned
      createFile(tmpDir, "scripts/SomeOtherDir/foo.ts");
      // Files in scripts/shared/ SHOULD be scanned
      createFile(tmpDir, "scripts/shared/utils/helper.ts");

      const config = makeConfig({
        Core: { description: "Core", scriptDirs: ["shared/utils"] },
      });

      const result = listUncategorized(tmpDir, config);
      // Only shared/utils/helper.ts is scanned (and classified). SomeOtherDir is ignored.
      assert.deepEqual(result, []);
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
  it("accepts eventSheets/, layouts/, scripts/ prefixes", () => {
    const result = validateOverrideKeys([
      "eventSheets/Login/Login.json",
      "layouts/Main/Main.json",
      "scripts/shared/auth/login.ts",
    ]);
    assert.deepEqual(result, []);
  });

  it("rejects paths without valid prefix", () => {
    const result = validateOverrideKeys(["foo/bar.json", "objectTypes/Hero.json"]);
    assert.equal(result.length, 2);
    assert.include(result[0], "Invalid path prefix: 'foo/bar.json'");
    assert.include(result[1], "Invalid path prefix: 'objectTypes/Hero.json'");
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
