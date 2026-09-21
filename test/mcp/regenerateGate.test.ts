import { assert } from "chai";
import type { Harness } from "../mcpHarness.js";
import { startHarness, assertOk, assertToolError, textOf } from "../mcpHarness.js";

/**
 * The MCP `regenerate` tool's optional `maxUnclassified` gate (issue #81,
 * rows R12 and R14).
 *
 * Synthetic by necessity, not preference: both rows need a project with a
 * *known* unclassified count, and the canonical fixture's count is a property
 * of the upstream sample rather than of this test. The harness's default
 * config (`makeConfig({ Domain0: … })`) declares no `eventSheetDirs`, so a
 * single event sheet written under `eventSheets/` classifies into nothing and
 * the project has exactly one unclassified file.
 */

/** One event sheet that no `*Dirs` entry in the harness's default config claims. */
const STRAY_SHEET = { "eventSheets/stray/S.json": '{"name":"S","events":[]}\n' };

const GATE_NEEDLE = "Classification gate failed:";

describe("mcp server — regenerate classification gate", function () {
  describe("R12: the gate trips when asked to, and is absent when not", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness({ files: STRAY_SHEET });
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("regenerate { maxUnclassified: 0 } reports an error carrying both the generator log and the gate line", async function () {
      this.timeout(30_000);
      const res = await h.call("regenerate", { maxUnclassified: 0 });
      const text = assertToolError(res, GATE_NEEDLE);
      // The generator's own output is preserved alongside the verdict — the
      // gate line points at these `Unclassified:` lines rather than
      // reprinting the paths, so dropping them would strip the only place
      // the caller can see *which* files tripped it.
      assert.include(text, "Unclassified:");
      assert.include(text, "eventSheets/stray/S.json");
    });

    it("regenerate {} on the same project succeeds and says nothing about a gate", async function () {
      this.timeout(30_000);
      // The mutation control for the row above: without it, a `regenerate`
      // that errored unconditionally — or one whose text always carried the
      // gate line — would grade green. The default path is also what
      // `npm run verify:behaviour-preservation` drives against the pinned
      // pre-change commit, so "unchanged" here is load-bearing.
      const res = await h.call("regenerate", {});
      const text = assertOk(res);
      assert.notInclude(text, GATE_NEEDLE);
      assert.include(text, "Unclassified:");
    });
  });

  describe("R14: startup auto-generation never consults the gate", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      // `autoGenerate: true` is what makes this row mean anything: the
      // harness otherwise pre-creates `extracted/domain-index/` so the
      // server's existsSync guard skips `ensureDomainIndex` entirely, and a
      // path that never runs cannot demonstrate that it does not gate.
      h = await startHarness({ files: STRAY_SHEET, autoGenerate: true });
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("the server starts and answers get-state, and the same project still trips the gate on request", async function () {
      this.timeout(30_000);
      const stateText = assertOk(await h.call("get-state", {}));
      assert.include(stateText, "txId: ");

      // The control. Without it "startup succeeded" would be satisfied by a
      // project with nothing to trip on, proving only that the fixture is
      // clean. This call trips, so the clean startup means the auto-generation
      // path does not consult the gate — not that there was no breach.
      const res = await h.call("regenerate", { maxUnclassified: 0 });
      assert.strictEqual(res.isError, true, `expected the control call to trip the gate, got: ${textOf(res)}`);
      assert.include(textOf(res), GATE_NEEDLE);
    });
  });
});
