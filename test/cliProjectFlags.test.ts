import { describe, it } from "mocha";
import { assert } from "chai";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseProjectFlagValue,
  assertRelativeOverride,
  buildServerProjectSpecs,
} from "../src/cliProjectFlags.js";
import { buildRegistry } from "../src/adapters/locations.js";
import type { EmitFn } from "../src/adapters/projectContext.js";

const noopEmit: EmitFn = () => {};

describe("parseProjectFlagValue", () => {
  it("splits an explicit id=path override", () => {
    assert.deepEqual(parseProjectFlagValue("alpha=../game-a"), { id: "alpha", root: "../game-a" });
  });

  it("treats a bare path (no '=') as root-only, leaving id undefined", () => {
    assert.deepEqual(parseProjectFlagValue("../game-a"), { root: "../game-a" });
  });

  it("treats a value starting with '=' as root-only too (empty id is not a real override)", () => {
    assert.deepEqual(parseProjectFlagValue("=../game-a"), { root: "=../game-a" });
  });
});

describe("assertRelativeOverride", () => {
  it("is a no-op at projectCount <= 1, absolute values included", () => {
    assert.doesNotThrow(() => assertRelativeOverride("config", path.resolve(os.tmpdir(), "abs.json"), 1));
    assert.doesNotThrow(() => assertRelativeOverride("extracted", path.resolve(os.tmpdir(), "out"), 1));
  });

  it("accepts a relative value at projectCount > 1", () => {
    assert.doesNotThrow(() => assertRelativeOverride("config", "sub/domain-config.json", 2));
  });

  it("accepts an undefined value at projectCount > 1", () => {
    assert.doesNotThrow(() => assertRelativeOverride("config", undefined, 2));
  });

  it("accepts the 'none' sentinel for --extracted at projectCount > 1", () => {
    assert.doesNotThrow(() => assertRelativeOverride("extracted", "none", 2));
  });

  it("rejects an absolute --config at projectCount > 1, naming the flag", () => {
    const abs = path.resolve(os.tmpdir(), "shared-config.json");
    try {
      assertRelativeOverride("config", abs, 2);
      assert.fail("expected assertRelativeOverride to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.include(message, "--config");
      assert.include(message, abs);
    }
  });

  it("rejects an absolute --extracted at projectCount > 1, naming the flag", () => {
    const abs = path.resolve(os.tmpdir(), "shared-extracted");
    try {
      assertRelativeOverride("extracted", abs, 3);
      assert.fail("expected assertRelativeOverride to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.include(message, "--extracted");
      assert.include(message, abs);
    }
  });
});

describe("buildServerProjectSpecs", () => {
  it("builds two specs from two --project values, never calling resolveRoots", () => {
    let calls = 0;
    const specs = buildServerProjectSpecs({
      projectValues: ["alpha=../game-a", "beta=../game-b"],
      resolveRoots: () => {
        calls++;
        return ["/should-not-be-used"];
      },
      config: undefined,
      extracted: undefined,
    });
    assert.equal(calls, 0);
    assert.deepEqual(specs, [
      { id: "alpha", root: "../game-a", config: undefined, extracted: undefined },
      { id: "beta", root: "../game-b", config: undefined, extracted: undefined },
    ]);
  });

  it("two --project values flow through buildRegistry into two entries with the expected ids and roots", () => {
    const rootA = path.join(os.tmpdir(), "c3dm-cli-flag-a", "game-a");
    const rootB = path.join(os.tmpdir(), "c3dm-cli-flag-b", "game-b");
    const specs = buildServerProjectSpecs({
      projectValues: [`alpha=${rootA}`, `beta=${rootB}`],
      resolveRoots: () => {
        throw new Error("should not be called");
      },
      config: undefined,
      extracted: undefined,
    });
    const registry = buildRegistry(specs, { emit: noopEmit });
    assert.deepEqual(registry.ids(), ["alpha", "beta"]);
  });

  it("a bare --project path (no id) derives its id from the basename, same as --project-dir alone", () => {
    const root = path.join(os.tmpdir(), "c3dm-cli-flag-bare", "game-c");
    const specs = buildServerProjectSpecs({
      projectValues: [root],
      resolveRoots: () => {
        throw new Error("should not be called");
      },
      config: undefined,
      extracted: undefined,
    });
    assert.deepEqual(specs, [{ root, config: undefined, extracted: undefined }]);
    const registry = buildRegistry(specs, { emit: noopEmit });
    assert.deepEqual(registry.ids(), ["game-c"]);
  });

  it("with no --project values, builds a single spec around resolveRoots()'s result", () => {
    const root = path.join(os.tmpdir(), "c3dm-cli-flag-single", "game-d");
    let calls = 0;
    const specs = buildServerProjectSpecs({
      projectValues: [],
      resolveRoots: () => {
        calls++;
        return [root];
      },
      config: undefined,
      extracted: undefined,
    });
    assert.equal(calls, 1);
    assert.deepEqual(specs, [{ root, config: undefined, extracted: undefined }]);
    const registry = buildRegistry(specs, { emit: noopEmit });
    assert.deepEqual(registry.ids(), ["game-d"]);
  });

  it("rejects an absolute --config when more than one --project is given", () => {
    const abs = path.resolve(os.tmpdir(), "shared-config.json");
    assert.throws(
      () =>
        buildServerProjectSpecs({
          projectValues: ["alpha=../game-a", "beta=../game-b"],
          resolveRoots: () => {
            throw new Error("should not be called");
          },
          config: abs,
          extracted: undefined,
        }),
      /--config/,
    );
  });

  it("accepts a relative --config when more than one --project is given, applied to every spec", () => {
    const specs = buildServerProjectSpecs({
      projectValues: ["alpha=../game-a", "beta=../game-b"],
      resolveRoots: () => {
        throw new Error("should not be called");
      },
      config: "sub/domain-config.json",
      extracted: undefined,
    });
    assert.equal(specs.length, 2);
    for (const spec of specs) {
      assert.equal(spec.config, "sub/domain-config.json");
    }
  });

  it("accepts an absolute --config with no --project values (single-root, N=1 carve-out)", () => {
    const root = path.join(os.tmpdir(), "c3dm-cli-flag-single-abs", "game-e");
    const abs = path.resolve(os.tmpdir(), "abs-config.json");
    const specs = buildServerProjectSpecs({
      projectValues: [],
      resolveRoots: () => [root],
      config: abs,
      extracted: undefined,
    });
    assert.deepEqual(specs, [{ root, config: abs, extracted: undefined }]);
  });

  it("R1: rejects an absolute --config with no --project values when resolveRoots yields two roots", () => {
    const rootA = path.join(os.tmpdir(), "c3dm-cli-flag-multi-abs", "game-f");
    const rootB = path.join(os.tmpdir(), "c3dm-cli-flag-multi-abs", "game-g");
    const abs = path.resolve(os.tmpdir(), "abs-config.json");
    assert.throws(
      () =>
        buildServerProjectSpecs({
          projectValues: [],
          resolveRoots: () => [rootA, rootB],
          config: abs,
          extracted: undefined,
        }),
      /--config/,
    );
  });
});
