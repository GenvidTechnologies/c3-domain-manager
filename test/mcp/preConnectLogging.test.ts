import { assert } from "chai";
import * as fs from "node:fs";
import type { Harness } from "../mcpHarness.js";
import { startHarness } from "../mcpHarness.js";
import { makeConfig } from "../domainModel.js";
import type { DomainConfig } from "../../src/domain/types.js";
import { deriveProjectId } from "../../src/adapters/locations.js";

/**
 * Pre-connect log fallback (issue #86, ADR 0031). Log lines emitted before
 * `server.connect` (the watcher's start/baseline lines) have no client to
 * notify, so `emitLog` must write them to stderr; after connect they must go
 * only through logging notifications.
 */

async function waitForStderr(h: Harness, pred: (s: string) => boolean, ms = 2000): Promise<string> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const s = h.stderr();
    if (pred(s)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  return h.stderr();
}

describe("mcp server — pre-connect logging fallback", function () {
  let h: Harness;

  before(async function () {
    this.timeout(30_000);
    h = await startHarness();
  });

  after(async function () {
    this.timeout(10_000);
    await h?.stop();
  });

  it("R1: the watcher's baseline line reaches the child's stderr", async function () {
    const id = deriveProjectId(h.root);
    const needle = `[${id}] OptimisticWatcher baseline:`;
    const stderr = await waitForStderr(h, (s) => s.includes(needle));
    assert.include(stderr, needle, `captured stderr was: ${JSON.stringify(stderr)}`);
  });

  it("R2: a post-connect external write is a logging notification, not a stderr line", async function () {
    const externalConfig: DomainConfig = makeConfig({
      Domain0: { description: "Single synthetic domain" },
      DomainExternal: { description: "written outside the server" },
    });
    fs.writeFileSync(h.configPath, JSON.stringify(externalConfig, null, "\t") + "\n", "utf-8");

    await h.waitForNote((n) => n.level === "warning" && String(n.data).includes("External change detected"), 3000);

    // The child's stderr is a separate pipe from the stdout carrying the
    // notification, so a duplicate line can land after the note does. Give it
    // a bounded window to appear before asserting it did not; reading stderr
    // immediately passed even against an emitLog that always wrote stderr.
    const stderr = await waitForStderr(h, (s) => s.includes("External change detected"), 1000);
    assert.notInclude(stderr, "External change detected", `captured stderr was: ${JSON.stringify(stderr)}`);
  });
});
