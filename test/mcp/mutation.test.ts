import { assert } from "chai";
import * as fs from "node:fs";
import type { Harness } from "../mcpHarness.js";
import { startHarness, assertOk, assertToolError, txIdOf, SELF_WRITE_OBSERVED_TXID_BUMPS } from "../mcpHarness.js";
import { makeConfig } from "../domainModel.js";
import type { DomainConfig } from "../../src/domain/types.js";

/**
 * Mutation-trajectory MCP tool suite (rows B2a, B2b, B3), plus the K3
 * observation-gated bug-signature test for the #68 txId double-bump.
 *
 * Each describe block below owns its own harness, so a mutation's ordered,
 * monotonic txId trajectory is scoped to that one block and never crosses a
 * `describe` — no block depends on another's state.
 */

/**
 * `get-state`'s text is `txId: N\ndomainDirty: bool` — `domainDirty` is the
 * LAST line, so `txIdOf` (which anchors on the last line for the mutate
 * footer shape) doesn't apply here. Extract the `txId:` line directly.
 */
function stateTxId(text: string): number {
  const match = /^txId: (\d+)$/m.exec(text);
  if (!match) {
    assert.fail(`get-state text did not carry a txId line: ${JSON.stringify(text)}`);
  }
  return Number(match![1]);
}

describe("mcp server — mutation trajectory", function () {
  describe("B2a: domainConfigCache reflects a self-write without a disk re-read", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("set-overrides then read-domain-config returns the new override; get-state shows domainDirty", async function () {
      const setRes = await h.call("set-overrides", {
        overrides: { "eventSheets/alpha/x.json": "Domain0" },
      });
      assertOk(setRes);
      const footerTxId = txIdOf(setRes);

      const readRes = await h.call("read-domain-config", { section: "overrides" });
      const readText = assertOk(readRes);
      assert.include(readText, "eventSheets/alpha/x.json");
      assert.include(readText, "Domain0");

      const stateRes = await h.call("get-state", {});
      const stateText = assertOk(stateRes);
      assert.include(stateText, "domainDirty: true");
      // >= rather than == : on a platform where the watcher's spurious
      // second event has already landed by the time get-state runs, the
      // observed txId can be ahead of the footer's — see #68.
      assert.isAtLeast(stateTxId(stateText), footerTxId);
    });
  });

  describe("B2b: domainConfigCache invalidation on an external watcher event", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
      // Populate the cache from disk before the external write below, so the
      // assertion actually exercises invalidation rather than a first-ever
      // read that would happen to return the new content regardless.
      assertOk(await h.call("read-domain-config", {}));
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("external write fires External change detected, then read-domain-config reflects it", async function () {
      const externalConfig: DomainConfig = makeConfig({
        Domain0: { description: "Single synthetic domain" },
        DomainExternal: { description: "written outside the server" },
      });
      fs.writeFileSync(h.configPath, JSON.stringify(externalConfig, null, "\t") + "\n", "utf-8");

      await h.waitForNote(
        (n) => n.level === "warning" && /External change detected/.test(String(n.data)),
        2000,
      );

      const readRes = await h.call("read-domain-config", { section: "domains" });
      const readText = assertOk(readRes);
      assert.include(readText, "DomainExternal");
    });
  });

  describe("B3: optimistic-concurrency txId rejection (platform-neutral)", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
      // Bump txId at least once before the stale-txId assertion — the row
      // only requires ">= 1 bump", not a specific starting value.
      assertOk(await h.call("set-overrides", { overrides: { "eventSheets/alpha/x.json": "Domain0" } }));
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("set-overrides with a deliberately stale txId 0 is rejected", async function () {
      const res = await h.call("set-overrides", {
        overrides: { "eventSheets/beta/y.json": "Domain0" },
        txId: 0,
      });
      // txId 0 is stale under BOTH the broken and the fixed behaviour — the
      // real txId is >= 1 either way after the before-hook's bump. That is
      // what keeps this row valid on both platforms, unlike a test that
      // passes back the handed-back txId (see K3, which does that on
      // purpose to encode the broken trajectory).
      assertToolError(res, "State changed: expected txId 0");
    });
  });

  describe("K3: #68 double-bump observation-gated bug signature", function () {
    // KNOWN-BROKEN — see #68. A single self-write through set-overrides
    // fires >1 fs.watch event on Windows (measured 4/4 runs), so the
    // watcher's external-change branch misfires once per write, over-bumping
    // txId. Measured NOT to reproduce on Linux ext4 (WSL, node 20/22) — see
    // SELF_WRITE_OBSERVED_TXID_BUMPS in mcpHarness.ts, which is the single
    // constant this test (and #68 itself, once fixed) is keyed on.
    //
    // This test must pass on BOTH platforms: it awaits the spurious
    // "External change detected" warning on a short deadline, and only
    // asserts the broken trajectory if that warning actually arrives. If it
    // doesn't, the platform didn't double-fire (either genuinely fixed, or
    // this platform's fs.watch never over-delivers), and the test logs a
    // note and passes without asserting anything about txId.
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("a self-write's spurious second watcher bump, if observed, matches SELF_WRITE_OBSERVED_TXID_BUMPS", async function () {
      const setRes = await h.call("set-overrides", {
        overrides: { "eventSheets/alpha/x.json": "Domain0" },
      });
      assertOk(setRes);
      const footerTxId = txIdOf(setRes);

      let fired = true;
      try {
        await h.waitForNote(
          (n) => n.level === "warning" && /External change detected/.test(String(n.data)),
          1500,
        );
      } catch {
        fired = false;
      }

      if (!fired) {
        // console.warn, not .log/.debug: test/setup.ts silences the latter two.
        console.warn("K3: platform did not double-fire; skipping broken-trajectory assertions (see #68)");
        return;
      }

      // Broken trajectory: the synchronous write bumps txId to exactly 1 —
      // one less than the full observed count, since the footer is read
      // before the watcher's spurious extra bump(s) land.
      assert.strictEqual(footerTxId, SELF_WRITE_OBSERVED_TXID_BUMPS - 1);

      const stateRes = await h.call("get-state", {});
      const stateText = assertOk(stateRes);
      assert.strictEqual(stateTxId(stateText), SELF_WRITE_OBSERVED_TXID_BUMPS);

      // The client's handed-back txId is now stale on the server (the
      // watcher already bumped past it) — passing it back is rejected. This
      // is the double-bump's observable consequence for a caller doing
      // optimistic concurrency correctly.
      const rejectRes = await h.call("set-overrides", {
        overrides: { "eventSheets/beta/y.json": "Domain0" },
        txId: footerTxId,
      });
      assertToolError(rejectRes, `State changed: expected txId ${footerTxId}`);
    });
  });
});
