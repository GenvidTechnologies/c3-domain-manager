import { describe, it } from "mocha";
import { assert } from "chai";
import * as path from "node:path";
import * as os from "node:os";
import { resolveLocations, NO_EXTRACTED } from "../../src/adapters/locations.js";
import { ExpectedChanges } from "@genvid/mcp-utils";

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
});
