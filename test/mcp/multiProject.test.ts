import { assert } from "chai";
import type { Harness } from "../mcpHarness.js";
import { startHarness, assertOk } from "../mcpHarness.js";
import { makeConfig } from "../domainModel.js";

/**
 * Smoke test for the multi-root harness shape introduced in F1.3 (issue
 * #77). Proves `startHarness({ projects: {...} })` actually drives a real
 * server hosting more than one project — both are reachable, `list-projects`
 * reports both ids, and a `project`-scoped call returns that project's own
 * data.
 *
 * Deliberately narrow: full cross-project isolation, lifecycle, and selector
 * coverage (rows S2, C1, C4, R21, R21-M, L1, L2, H2) are F1.5's job, not
 * this file's — this only proves the harness plumbing works end to end.
 */

describe("mcp server — multi-project harness smoke test", function () {
  let h: Harness;

  before(async function () {
    this.timeout(30_000);
    h = await startHarness({
      projects: {
        alpha: { config: makeConfig({ AlphaDomain: { description: "Alpha's domain" } }), autoGenerate: true },
        beta: { config: makeConfig({ BetaDomain: { description: "Beta's domain" } }), autoGenerate: true },
      },
    });
  });

  after(async function () {
    this.timeout(10_000);
    await h?.stop();
  });

  it("builds two distinguishable temp roots and config paths, keyed by id", function () {
    assert.hasAllKeys(h.roots, ["alpha", "beta"]);
    assert.hasAllKeys(h.configPaths, ["alpha", "beta"]);
    assert.notStrictEqual(h.roots.alpha, h.roots.beta);
    assert.notStrictEqual(h.configPaths.alpha, h.configPaths.beta);
  });

  it("throws from the single-project root/configPath accessors when N > 1", function () {
    assert.throws(() => h.root, /2 projects are registered/);
    assert.throws(() => h.configPath, /2 projects are registered/);
  });

  it("list-projects reports both registered ids and their roots", async function () {
    const res = await h.call("list-projects", {});
    const text = assertOk(res);
    const lines = text.split("\n");
    assert.include(lines, `alpha: ${h.roots.alpha}`);
    assert.include(lines, `beta: ${h.roots.beta}`);
  });

  it("a project-scoped call reaches the right project and only that one", async function () {
    const alphaRes = await h.call("read-domain-index", { project: "alpha" });
    const alphaText = assertOk(alphaRes);
    assert.include(alphaText, "AlphaDomain");
    assert.notInclude(alphaText, "BetaDomain");

    const betaRes = await h.call("read-domain-index", { project: "beta" });
    const betaText = assertOk(betaRes);
    assert.include(betaText, "BetaDomain");
    assert.notInclude(betaText, "AlphaDomain");
  });
});

/**
 * Regression leg for issue #77's multi-root discovery adoption (row M5): the
 * `server` handler's `resolveRoots` injection moved from `resolveRootOrExit`
 * (wrapped in a one-element array) to `resolveRootsOrExit`, calling
 * `resolveProjectRoots` under the hood. `startHarness()` with no `projects`
 * option spawns via `--project-dir <root>` exactly as before — an `explicit`
 * source, never `discovery` — so this proves that path still yields exactly
 * one registered project through the new plural resolver.
 */
describe("mcp server — single-project registration is unaffected by multi-root discovery", function () {
  let h: Harness;

  before(async function () {
    this.timeout(30_000);
    h = await startHarness();
  });

  after(async function () {
    this.timeout(10_000);
    await h?.stop();
  });

  it("list-projects reports exactly one project, rooted at h.root", async function () {
    const res = await h.call("list-projects", {});
    const text = assertOk(res);
    const lines = text.split("\n");
    assert.lengthOf(lines, 1);
    assert.equal(lines[0], `${lines[0].split(":")[0]}: ${h.root}`);
  });
});
