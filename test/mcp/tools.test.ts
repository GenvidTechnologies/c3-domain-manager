import * as fs from "node:fs";
import { assert } from "chai";
import type { Harness } from "../mcpHarness.js";
import { startHarness, assertOk, assertToolError } from "../mcpHarness.js";
import { makeConfig } from "../domainModel.js";

/**
 * Read-only MCP tool suite (rows B1, B5a, B5b, B6). Never calls a mutate
 * tool (`set-overrides`/`remove-overrides`) and never edits
 * `domain-config.json` externally, so `txId` stays 0 in every group below.
 *
 * B5a and B5b are each covered only by their read-tool half here — the
 * `txId:` footer half of B5a, and the "stale-warning-after-a-mutate" half of
 * B5b, both require an actual mutation and are covered by
 * `test/mcp/mutation.test.ts` instead.
 */

describe("mcp server — read-only tools", function () {
  describe("B1: isMcpError/CallToolResult propagation on a missing config", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
      // `read-domain-index` (the tool literally named in the acceptance
      // criterion) never calls loadDomainConfig() — it only reads a
      // pre-generated extracted/domain-index/*.md file, so it structurally
      // cannot surface a loadProjectConfig error. `read-domain-config` is the
      // tool that actually exercises the isMcpError propagation the row
      // describes (it calls loadDomainConfig() directly and returns the
      // CallToolResult verbatim); using it here instead.
      fs.unlinkSync(h.configPath);
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("read-domain-config returns isError true, text naming loadProjectConfig", async function () {
      const res = await h.call("read-domain-config", {});
      const text = assertToolError(res, "loadProjectConfig");
      assert.include(text, "domain-config.json");
    });
  });

  describe("B6: all 14 tools registered and reachable", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("client.listTools() returns 14 tools", async function () {
      const { tools } = await h.client.listTools();
      assert.strictEqual(tools.length, 14);
    });
  });

  describe("B5a: mcpContent single-block shape (read-tool half)", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("get-state returns exactly one text content block", async function () {
      const res = await h.call("get-state", {});
      assertOk(res);
      assert.strictEqual(res.content.length, 1);
      assert.strictEqual(res.content[0]?.type, "text");
    });
  });

  describe("B5b: paginatedContent truncation (read-tool half)", function () {
    // Measured (scratchpad probe against computeDomainData + formatDomainIndex
    // directly): a 3-domain synthetic config produces an index.md of 20 total
    // lines (1 domain: 18, 2: 19, 3: 20) — comfortably more than `limit: 2`,
    // so pagination here is genuinely observed, not an accidental no-op.
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      const config = makeConfig({
        Domain0: { description: "d0" },
        Domain1: { description: "d1" },
        Domain2: { description: "d2" },
      });
      h = await startHarness({ config, autoGenerate: true });
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("read-domain-index {limit: 2} returns 1 block truncated to <=2 body lines", async function () {
      const res = await h.call("read-domain-index", { limit: 2 });
      const text = assertOk(res);
      assert.strictEqual(res.content.length, 1);
      assert.strictEqual(res.content[0]?.type, "text");

      // Split off the trailing pagination range footer ("lines: a-b / total")
      // before counting body lines — the footer isn't page content.
      const footerMatch = /\n?lines: \d+(?:-\d+)? \/ \d+$/.exec(text);
      assert.exists(footerMatch, `expected a pagination range footer in: ${JSON.stringify(text)}`);
      const body = text.slice(0, footerMatch!.index).replace(/\n+$/, "");
      const bodyLines = body.length === 0 ? [] : body.split("\n");
      assert.isAtMost(bodyLines.length, 2);
    });

    it("a fresh (non-dirty) index carries no stale-warning footer", async function () {
      const res = await h.call("read-domain-index", {});
      const text = assertOk(res);
      assert.notInclude(text, "[Warning: domain index may be stale");
    });
  });
});
