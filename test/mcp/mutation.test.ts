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

  describe("K3: #68 one self-write, one txId bump", function () {
    // #68 is FIXED — this asserts the correct trajectory UNCONDITIONALLY.
    //
    // It used to be observation-gated: it awaited the spurious "External
    // change detected" warning and asserted the broken trajectory only if
    // that warning arrived, logging a note and passing otherwise. That shape
    // was right while the bug was live and Windows-only, but it is actively
    // harmful now — a gate that asserts only when the bug appears is
    // indistinguishable from a gate that never fires because the watcher is
    // dead, so it would pass just as happily against a server that had
    // stopped delivering events at all. The whole point of the fix is that
    // the trajectory is now the same on both platforms, so there is nothing
    // left to gate on.
    //
    // Note the assertions below are deliberately two-sided: the absence of
    // the spurious warning is checked (the fix), AND the replay is checked to
    // be ACCEPTED (the contract #68 actually broke). Absence alone would pass
    // against a dead watcher; the accepted replay plus B2b's external-change
    // coverage is what rules that out.
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("one self-write advances txId by exactly SELF_WRITE_OBSERVED_TXID_BUMPS, and the handed-back txId stays valid", async function () {
      const setRes = await h.call("set-overrides", {
        overrides: { "eventSheets/alpha/x.json": "Domain0" },
      });
      assertOk(setRes);
      const footerTxId = txIdOf(setRes);

      // No spurious external-change warning for a write the server made
      // itself. Waiting for the absence costs the full deadline, which is
      // why it is 1500ms rather than the harness default — long enough that
      // Windows' second event (measured 0.2-0.9ms after the first) would
      // certainly have landed.
      let spurious = true;
      try {
        await h.waitForNote(
          (n) => n.level === "warning" && /External change detected/.test(String(n.data)),
          1500,
        );
      } catch {
        spurious = false;
      }
      assert.isFalse(spurious, "a self-write must not be reported as an external change");

      // The footer the client was handed is the server's current txId — not
      // one behind it, which is what the double-bump used to produce.
      const stateRes = await h.call("get-state", {});
      assert.strictEqual(stateTxId(assertOk(stateRes)), footerTxId);
      assert.strictEqual(footerTxId, SELF_WRITE_OBSERVED_TXID_BUMPS);

      // The contract #68 actually broke: a client that takes the txId a
      // mutate tool handed back and passes it on its next write must be
      // ACCEPTED. This previously failed on every write.
      const acceptRes = await h.call("set-overrides", {
        overrides: { "eventSheets/beta/y.json": "Domain0" },
        txId: footerTxId,
      });
      assertOk(acceptRes);
    });
  });
});
