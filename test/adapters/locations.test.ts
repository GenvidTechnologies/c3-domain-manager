import { describe, it, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  resolveLocations,
  resolveProjectRoot,
  resolveProjectRoots,
  NO_EXTRACTED,
  deriveProjectId,
  deriveUniqueProjectIds,
  buildRegistry,
} from "../../src/adapters/locations.js";
import { ExpectedChanges, isMcpError, type ResolvedRoot, type ResolvedRoots } from "@genvidtech/mcp-utils";
import { makeTempDir, removeTempDir } from "../syntheticProject.js";
import { buildServerProjectSpecs } from "../../src/cliProjectFlags.js";
import type { EmitFn } from "../../src/adapters/projectContext.js";

const noopEmit: EmitFn = () => {};

/** Temporarily replaces console.error, capturing every call's joined args as a string. */
function captureConsoleError<T>(fn: () => T): { result: T; messages: string[] } {
  const original = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  try {
    return { result: fn(), messages };
  } finally {
    console.error = original;
  }
}

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
      removeTempDir(tmpDir);
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
    tmpDir = makeTempDir("c3dm-pr-");
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
    tmpDir = makeTempDir("c3dm-pr-");
    fs.writeFileSync(path.join(tmpDir, "project.c3proj"), "");

    const result = resolveProjectRoot({}, tmpDir, {});
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, tmpDir);
    assert.equal(resolved.source, "discovery");
  });

  it("0 markers under cwd returns cwd with source: cwd", () => {
    tmpDir = makeTempDir("c3dm-pr-");
    const result = resolveProjectRoot({}, tmpDir, {});
    assert.isFalse(isMcpError(result));
    const resolved = result as { path: string; source: string };
    assert.equal(resolved.path, tmpDir);
    assert.equal(resolved.source, "cwd");
  });

  it("two child dirs each with project.c3proj returns an isMcpError (ambiguous)", () => {
    tmpDir = makeTempDir("c3dm-pr-");
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

describe("resolveProjectRoots", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      removeTempDir(tmpDir);
      tmpDir = undefined;
    }
  });

  // M5: single-marker discovery agrees with the singular resolver's own result.
  it("single child marker: one path, equal to resolveProjectRoot's own result, both source: discovery", () => {
    tmpDir = makeTempDir("c3dm-prs-single-");
    const childDir = path.join(tmpDir, "myproject");
    fs.mkdirSync(childDir);
    fs.writeFileSync(path.join(childDir, "project.c3proj"), "");

    const plural = resolveProjectRoots({}, tmpDir, {});
    assert.isFalse(isMcpError(plural));
    const pluralResolved = plural as ResolvedRoots;
    assert.equal(pluralResolved.paths.length, 1);
    assert.equal(pluralResolved.source, "discovery");

    const singular = resolveProjectRoot({}, tmpDir, {});
    assert.isFalse(isMcpError(singular));
    const singularResolved = singular as ResolvedRoot;
    assert.equal(singularResolved.source, "discovery");
    assert.equal(pluralResolved.paths[0], singularResolved.path);
  });

  // M4: three sibling markers succeed as a discovery set, feed buildRegistry
  // and buildServerProjectSpecs cleanly, while the singular still errors on
  // the identical directory (positive control proving genuine divergence).
  it("three sibling markers: plural succeeds with 3 paths; singular still errors (ambiguous); flows through buildRegistry and buildServerProjectSpecs", () => {
    tmpDir = makeTempDir("c3dm-prs-triple-");
    for (const name of ["alpha", "beta", "gamma"]) {
      const child = path.join(tmpDir, name);
      fs.mkdirSync(child);
      fs.writeFileSync(path.join(child, "project.c3proj"), "");
    }

    const plural = resolveProjectRoots({}, tmpDir, {});
    assert.isFalse(isMcpError(plural));
    const pluralResolved = plural as ResolvedRoots;
    assert.equal(pluralResolved.source, "discovery");
    assert.equal(pluralResolved.paths.length, 3);

    // Positive control on the identical directory: the singular still errors.
    const singular = resolveProjectRoot({}, tmpDir, {});
    assert.isTrue(isMcpError(singular));

    const registry = buildRegistry(
      pluralResolved.paths.map((root) => ({ root })),
      { emit: noopEmit },
    );
    assert.equal(registry.ids().length, 3);
    assert.equal(new Set(registry.ids()).size, 3);

    const specs = buildServerProjectSpecs({
      projectValues: [],
      resolveRoots: () => pluralResolved.paths,
      config: undefined,
      extracted: undefined,
    });
    assert.equal(specs.length, 3);
  });

  // M7: ascending sort regardless of directory-creation/readdir order.
  it("sorts discovered paths ascending regardless of creation order", () => {
    tmpDir = makeTempDir("c3dm-prs-order-");
    for (const name of ["c", "a", "b"]) {
      const child = path.join(tmpDir, name);
      fs.mkdirSync(child);
      fs.writeFileSync(path.join(child, "project.c3proj"), "");
    }

    const plural = resolveProjectRoots({}, tmpDir, {});
    assert.isFalse(isMcpError(plural));
    const paths = (plural as ResolvedRoots).paths;
    const expectedSorted = [...paths].sort();
    assert.deepEqual(paths, expectedSorted);

    const registry = buildRegistry(
      paths.map((root) => ({ root })),
      { emit: noopEmit },
    );
    assert.deepEqual(registry.ids(), ["a", "b", "c"]);
  });

  // M8 (registry half — the stderr-warning half is CLI-only and covered by
  // test/mcp/rootFallbackWarning.test.ts, which spawns the real CLI): 0
  // markers under cwd falls back to source: "cwd" with exactly one path,
  // unchanged from resolveProjectRoot's own cwd fallback.
  it("0 markers under cwd: falls back to source: cwd with exactly one path", () => {
    tmpDir = makeTempDir("c3dm-prs-cwd-");
    const plural = resolveProjectRoots({}, tmpDir, {});
    assert.isFalse(isMcpError(plural));
    const pluralResolved = plural as ResolvedRoots;
    assert.equal(pluralResolved.source, "cwd");
    assert.deepEqual(pluralResolved.paths, [tmpDir]);

    const registry = buildRegistry(
      pluralResolved.paths.map((root) => ({ root })),
      { emit: noopEmit },
    );
    assert.equal(registry.ids().length, 1);
  });

  // M6: three immediate siblings have distinct basenames at searchDepth 1, so
  // the -2 collision branch must not fire and no warning is emitted.
  it("three sibling discovered roots derive three unsuffixed lowercase ids, no collision warning", () => {
    tmpDir = makeTempDir("c3dm-prs-noclash-");
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const child = path.join(tmpDir, name);
      fs.mkdirSync(child);
      fs.writeFileSync(path.join(child, "project.c3proj"), "");
    }

    const plural = resolveProjectRoots({}, tmpDir, {});
    assert.isFalse(isMcpError(plural));
    const paths = (plural as ResolvedRoots).paths;
    assert.equal(paths.length, 3);

    const { result: registry, messages } = captureConsoleError(() =>
      buildRegistry(
        paths.map((root) => ({ root })),
        { emit: noopEmit },
      ),
    );
    assert.deepEqual(registry.ids(), ["alpha", "beta", "gamma"]);
    assert.isEmpty(messages);
  });

  // M6 case-collision leg: `Game/` + `game/` colliding to one id (`game`,
  // `game-2`) plus the warning — gated on OBSERVING that both directories
  // actually persisted as distinct entries, never on process.platform. On a
  // filesystem that folds the two names (case-insensitive), the second
  // mkdirSync either throws EEXIST or silently lands on the same inode, so
  // this probes both directly rather than inferring from the OS.
  it("case-collision leg: Game/ + game/ collide to game/game-2 with a warning, when this filesystem actually keeps both", () => {
    tmpDir = makeTempDir("c3dm-prs-case-");
    const dirUpper = path.join(tmpDir, "Game");
    fs.mkdirSync(dirUpper);
    fs.writeFileSync(path.join(dirUpper, "project.c3proj"), "");

    const dirLower = path.join(tmpDir, "game");
    let bothCreated = true;
    try {
      fs.mkdirSync(dirLower);
      fs.writeFileSync(path.join(dirLower, "project.c3proj"), "");
    } catch {
      bothCreated = false;
    }

    const entries = fs.readdirSync(tmpDir);
    if (!bothCreated || entries.length < 2) {
      // console.warn, not .log/.debug: test/setup.ts silences the latter two.
      console.warn(
        `case-collision leg skipped — this filesystem folds 'Game' and 'game' into one entry (entries: ${JSON.stringify(entries)})`,
      );
      return;
    }

    const plural = resolveProjectRoots({}, tmpDir, {});
    assert.isFalse(isMcpError(plural));
    const paths = (plural as ResolvedRoots).paths;
    assert.equal(paths.length, 2);

    const { result: registry, messages } = captureConsoleError(() =>
      buildRegistry(
        paths.map((root) => ({ root })),
        { emit: noopEmit },
      ),
    );
    assert.deepEqual(registry.ids(), ["game", "game-2"]);
    assert.isTrue(
      messages.some((m) => m.includes("game")),
      `expected a stderr warning naming the 'game' collision, got: ${JSON.stringify(messages)}`,
    );
  });
});

describe("deriveProjectId", () => {
  it("derives from a relative path with a parent segment", () => {
    assert.equal(deriveProjectId("../game-a"), "game-a");
  });

  it("lowercases and hyphenates whitespace in a bare name", () => {
    assert.equal(deriveProjectId("Game A"), "game-a");
  });
});

describe("deriveUniqueProjectIds", () => {
  it("assigns each root's derived id when there is no collision", () => {
    const ids = deriveUniqueProjectIds([
      path.join(os.tmpdir(), "one", "game-a"),
      path.join(os.tmpdir(), "two", "game-b"),
    ]);
    assert.deepEqual(ids, ["game-a", "game-b"]);
  });

  it("resolves a basename collision as base, base-2 (order-stable) and warns on stderr", () => {
    const rootA = path.join(os.tmpdir(), "c3dm-dup-a", "sample");
    const rootB = path.join(os.tmpdir(), "c3dm-dup-b", "sample");

    const { result: ids, messages } = captureConsoleError(() => deriveUniqueProjectIds([rootA, rootB]));

    assert.deepEqual(ids, ["sample", "sample-2"]);
    assert.isTrue(
      messages.some((m) => m.includes("sample")),
      `expected a stderr warning naming the 'sample' collision, got: ${JSON.stringify(messages)}`,
    );
  });
});

describe("buildRegistry", () => {
  it("derives ids from roots when no explicit id is given", () => {
    const registry = buildRegistry(
      [
        { root: path.join(os.tmpdir(), "c3dm-br-1", "game-a") },
        { root: path.join(os.tmpdir(), "c3dm-br-1", "game-b") },
      ],
      { emit: noopEmit },
    );
    assert.deepEqual(registry.ids(), ["game-a", "game-b"]);
  });

  it("an explicit id overrides derivation from the root", () => {
    const registry = buildRegistry(
      [{ root: path.join(os.tmpdir(), "c3dm-br-2", "x"), id: "alpha" }],
      { emit: noopEmit },
    );
    assert.deepEqual(registry.ids(), ["alpha"]);
    const ctx = registry.resolve("alpha");
    assert.isFalse(isMcpError(ctx));
  });

  it("rejects two --project entries at the same directory (same default configPath)", () => {
    const sameRoot = path.join(os.tmpdir(), "c3dm-br-3", "sample");
    assert.throws(
      () => buildRegistry([{ root: sameRoot }, { root: sameRoot }], { emit: noopEmit }),
      /duplicate configPath/,
    );
    try {
      buildRegistry([{ root: sameRoot }, { root: sameRoot }], { emit: noopEmit });
      assert.fail("expected buildRegistry to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Two entries at the same directory derive distinct ids (sample, sample-2) —
      // the rejection is on configPath, and must still name both of those ids.
      assert.include(message, "sample");
      assert.include(message, "sample-2");
    }
  });

  it("rejects two distinct roots forced onto one configPath via a shared absolute --config", () => {
    const rootA = path.join(os.tmpdir(), "c3dm-br-4", "alpha-root");
    const rootB = path.join(os.tmpdir(), "c3dm-br-4", "beta-root");
    const sharedConfig = path.join(os.tmpdir(), "c3dm-br-4", "shared-config.json");

    try {
      buildRegistry(
        [
          { root: rootA, id: "alpha", config: sharedConfig },
          { root: rootB, id: "beta", config: sharedConfig },
        ],
        { emit: noopEmit },
      );
      assert.fail("expected buildRegistry to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      assert.include(message, "duplicate configPath");
      assert.include(message, "alpha");
      assert.include(message, "beta");
    }
  });

  it("rejects two specs that explicitly collide on the same id", () => {
    assert.throws(
      () =>
        buildRegistry(
          [
            { root: path.join(os.tmpdir(), "c3dm-br-5", "a"), id: "alpha" },
            { root: path.join(os.tmpdir(), "c3dm-br-5", "b"), id: "alpha" },
          ],
          { emit: noopEmit },
        ),
      /duplicate project id 'alpha'/,
    );
  });
});
