import { describe, it, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveLocations, resolveProjectRoot, NO_EXTRACTED } from "../../src/adapters/locations.js";
import { ExpectedChanges, isMcpError } from "@genvidtech/mcp-utils";

// Use a deterministic project root that is always absolute and works cross-platform.
const root = path.resolve(os.tmpdir(), "c3dm-test-proj");

describe("resolveLocations", () => {
  describe("configPath", () => {
    it("defaults to <projectRoot>/domain-config.json", () => {
      const loc = resolveLocations({}, root);
      assert.equal(loc.configPath, path.join(root, "domain-config.json"));
    });

    it("rebases a relative config path onto projectRoot", () => {
      const loc = resolveLocations({ config: "sub/c.json" }, root);
      assert.equal(loc.configPath, path.resolve(root, "sub/c.json"));
    });

    it("keeps an absolute config path unchanged", () => {
      const absPath = path.resolve(root, "abs.json");
      const loc = resolveLocations({ config: absPath }, root);
      assert.equal(loc.configPath, absPath);
    });
  });

  describe("extractedDir", () => {
    it("defaults to <projectRoot>/extracted and sets extractedEphemeral=false", () => {
      const loc = resolveLocations({}, root);
      assert.equal(loc.extractedDir, path.join(root, "extracted"));
      assert.equal(loc.extractedEphemeral, false);
    });

    it("rebases a relative extracted path onto projectRoot", () => {
      const loc = resolveLocations({ extracted: "out/domain" }, root);
      assert.equal(loc.extractedDir, path.resolve(root, "out/domain"));
      assert.equal(loc.extractedEphemeral, false);
    });

    it("keeps an absolute extracted path unchanged", () => {
      const absExtracted = path.resolve(root, "my-extracted");
      const loc = resolveLocations({ extracted: absExtracted }, root);
      assert.equal(loc.extractedDir, absExtracted);
      assert.equal(loc.extractedEphemeral, false);
    });
  });

  describe("NO_EXTRACTED sentinel (ephemeral mode)", () => {
    it("calls mkTempDir exactly once and sets extractedEphemeral=true", () => {
      const fakeDir = path.resolve(os.tmpdir(), "c3dm-fake-temp");
      let callCount = 0;
      const mkTempDir = () => {
        callCount++;
        return fakeDir;
      };

      const loc = resolveLocations({ extracted: NO_EXTRACTED }, root, mkTempDir);

      assert.equal(callCount, 1);
      assert.equal(loc.extractedDir, fakeDir);
      assert.equal(loc.extractedEphemeral, true);
    });

    it("does NOT call mkTempDir for default (no extracted option)", () => {
      const mkTempDir = () => {
        throw new Error("mkTempDir should not be called");
      };
      assert.doesNotThrow(() => resolveLocations({}, root, mkTempDir));
    });

    it("does NOT call mkTempDir for a custom path", () => {
      const mkTempDir = () => {
        throw new Error("mkTempDir should not be called");
      };
      assert.doesNotThrow(() => resolveLocations({ extracted: "some/path" }, root, mkTempDir));
    });
  });

  describe("configWatchKey", () => {
    it("is an absolute path (path.isAbsolute)", () => {
      const loc = resolveLocations({}, root);
      // The watch key, after stripping forward slashes converted from backslashes,
      // should still be absolute. On Windows it will start with e.g. "C:/..."
      // We verify by checking the original configPath is absolute.
      assert.isTrue(path.isAbsolute(loc.configPath));
    });

    it("contains no backslashes", () => {
      const loc = resolveLocations({}, root);
      assert.notInclude(loc.configWatchKey, "\\");
    });

    it("contains no backslashes when config is a Windows-style path", () => {
      // Simulate a config with backslashes (as produced by path.resolve on Windows)
      // by using an absolute path that path.resolve would normalize
      const loc = resolveLocations({ config: "sub\\deep\\config.json" }, root);
      assert.notInclude(loc.configWatchKey, "\\");
    });

    it("add === consume round-trip with ExpectedChanges (same key used for both)", () => {
      const absConfig = path.resolve(root, "custom-config.json");
      const loc = resolveLocations({ config: absConfig }, root);
      const ec = new ExpectedChanges();
      ec.add(loc.configWatchKey);
      assert.equal(ec.consume(loc.configWatchKey), true);
    });

    it("distinct configs produce distinct configWatchKeys", () => {
      const loc1 = resolveLocations({ config: "a.json" }, root);
      const loc2 = resolveLocations({ config: "b.json" }, root);
      assert.notEqual(loc1.configWatchKey, loc2.configWatchKey);
    });

    it("configWatchKey matches configPath with backslashes replaced by forward slashes", () => {
      const loc = resolveLocations({}, root);
      const expected = loc.configPath.replace(/\\/g, "/");
      assert.equal(loc.configWatchKey, expected);
    });
  });

  describe("projectRoot is preserved as-is", () => {
    it("resolveLocations returns the same projectRoot that was passed in", () => {
      const loc = resolveLocations({}, root);
      assert.equal(loc.projectRoot, root);
    });
  });

  describe("configDir and configFileName", () => {
    it("default config: configDir equals projectRoot and configFileName equals domain-config.json", () => {
      const loc = resolveLocations({}, root);
      assert.equal(loc.configDir, root);
      assert.equal(loc.configFileName, "domain-config.json");
    });

    it("relative --config: join of configDir and configFileName equals configPath", () => {
      const loc = resolveLocations({ config: "sub/dm.json" }, root);
      assert.equal(path.join(loc.configDir, loc.configFileName), loc.configPath);
    });

    it("absolute --config outside projectRoot: join of configDir and configFileName equals configPath", () => {
      const outsideRoot = path.resolve(os.tmpdir(), "other-project", "custom.json");
      const loc = resolveLocations({ config: outsideRoot }, root);
      assert.equal(path.join(loc.configDir, loc.configFileName), loc.configPath);
    });
  });
});

describe("resolveProjectRoot", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("explicit relative projectDir resolves against cwd and returns source: explicit", () => {
    const cwd = path.resolve(os.tmpdir(), "c3dm-pr-cwd");
    const result = resolveProjectRoot({ projectDir: "subproject" }, cwd, {});
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, path.resolve(cwd, "subproject"));
    assert.equal(resolved.source, "explicit");
  });

  it("explicit absolute projectDir is returned unchanged and returns source: explicit", () => {
    const absPath = path.resolve(os.tmpdir(), "my-c3-project");
    const result = resolveProjectRoot({ projectDir: absPath }, os.tmpdir(), {});
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, absPath);
    assert.equal(resolved.source, "explicit");
  });

  it("no explicit, C3_PROJECT_DIR set in env (relative) resolves against cwd and returns source: env", () => {
    const cwd = path.resolve(os.tmpdir(), "c3dm-pr-cwd2");
    const result = resolveProjectRoot({}, cwd, { C3_PROJECT_DIR: "envsubdir" });
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, path.resolve(cwd, "envsubdir"));
    assert.equal(resolved.source, "env");
  });

  it("explicit wins over C3_PROJECT_DIR env var", () => {
    const cwd = path.resolve(os.tmpdir(), "c3dm-pr-cwd3");
    const result = resolveProjectRoot({ projectDir: "explicit-dir" }, cwd, { C3_PROJECT_DIR: "env-dir" });
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, path.resolve(cwd, "explicit-dir"));
    assert.equal(resolved.source, "explicit");
  });

  it("discovery: single child with project.c3proj returns that child with source: discovery", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-pr-"));
    const childDir = path.join(tmpDir, "myproject");
    fs.mkdirSync(childDir);
    fs.writeFileSync(path.join(childDir, "project.c3proj"), "");

    const result = resolveProjectRoot({}, tmpDir, {});
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, childDir);
    assert.equal(resolved.source, "discovery");
  });

  it("discovery: project.c3proj in cwd itself returns cwd with source: discovery", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-pr-"));
    fs.writeFileSync(path.join(tmpDir, "project.c3proj"), "");

    const result = resolveProjectRoot({}, tmpDir, {});
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, tmpDir);
    assert.equal(resolved.source, "discovery");
  });

  it("0 markers under cwd returns cwd with source: cwd", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-pr-"));
    const result = resolveProjectRoot({}, tmpDir, {});
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, tmpDir);
    assert.equal(resolved.source, "cwd");
  });

  it("two child dirs each with project.c3proj returns an isMcpError (ambiguous)", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-pr-"));
    const childA = path.join(tmpDir, "projectA");
    const childB = path.join(tmpDir, "projectB");
    fs.mkdirSync(childA);
    fs.mkdirSync(childB);
    fs.writeFileSync(path.join(childA, "project.c3proj"), "");
    fs.writeFileSync(path.join(childB, "project.c3proj"), "");

    const result = resolveProjectRoot({}, tmpDir, {});
    assert.isTrue(isMcpError(result));
  });
});
