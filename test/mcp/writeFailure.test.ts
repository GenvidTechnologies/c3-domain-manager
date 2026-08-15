import { assert } from "chai";
import * as fs from "node:fs";
import type { Harness } from "../mcpHarness.js";
import { startHarness, assertOk } from "../mcpHarness.js";

/**
 * B4: withMcpErrors/onError write-failure path.
 *
 * Own spawn, deliberately: the scenario deliberately corrupts
 * domain-config.json's writability, which cannot be shared with any other
 * suite — every other suite in this file's siblings needs a real, writable
 * config file.
 *
 * NOT via EISDIR (replacing the file with a directory), despite that being
 * the route named in the plan. Verified end-to-end and it does not reach
 * writeDomainConfig() at all: deleting/replacing domain-config.json fires
 * the config-path fs.watch handler (server.ts:598-606), which nulls
 * domainConfigCache — same as any other external change to that path — so
 * set-overrides's own loadDomainConfig() call re-reads from disk, finds a
 * directory where a file should be, and returns the loadProjectConfig error
 * from THAT read, never reaching writeDomainConfig()'s write attempt (so no
 * "write failed" notification ever fires). This is indistinguishable from
 * B1's already-covered read-side failure — confirmed by running it: isError
 * is true, but waitForNote(/write failed/) times out every time.
 *
 * Using chmod (read-only) instead: it fails ONLY the write half, not the
 * read half, which is exactly the asymmetry writeDomainConfig()'s error path
 * needs to be reachable at all — loadDomainConfig()'s disk read of a
 * read-only file still succeeds (repopulating the cache if the watcher's
 * attribute-change event nulled it, which does fire — measured 1 event, not
 * the write-side double-fire — but is harmless here either way), and only
 * THEN does writeDomainConfig()'s fs.writeFileSync hit EPERM. Confirmed by a
 * standalone probe on this machine: fs.writeFileSync against a 0o444 file
 * throws `EPERM: operation not permitted`. The test's *shape* (isError plus
 * the write-failed notification) survives; only the corruption mechanism and
 * errno differ from the plan's EISDIR hypothesis.
 *
 * chmod's own write-block is itself uid-dependent, though, and that turned
 * out to matter — measured on WSL Debian ext4:
 *
 * | Context           | uid  | Result                                        |
 * |--------------------|------|-----------------------------------------------|
 * | Linux non-root      | 1000 | write blocked (EACCES) → the assertions hold  |
 * | Linux **root**      | 0    | write SUCCEEDS → onWriteError never fires     |
 *
 * Root bypasses the permission check entirely, so a hard assertion here
 * would go red under a container that happens to run as root — for a reason
 * that has nothing to do with the code under test. GitHub-hosted
 * `ubuntu-latest` runs as `runner` (non-root) today, so this currently
 * passes on the shared gate, but that gate lives in a different repo
 * (`GenvidTechnologies/public-github-actions`) and isn't this repo's to pin.
 * Rather than infer availability from `process.getuid?.()` (undefined on
 * Windows, where the read-only attribute blocks the write regardless — a
 * uid check alone couldn't even express that case), the `before` hook below
 * PROBES the actual property this test depends on: it chmods the file and
 * attempts a throwaway write. If the probe write succeeds, the mechanism is
 * unavailable on this platform/uid/filesystem and the `it` block logs an
 * explicit note and passes without asserting isError or the notification —
 * the same explicit-gate shape `mutation.test.ts`'s K3 test uses for the
 * #68 double-bump. If the probe write fails, the `it` block asserts the
 * real behaviour, same as before.
 */
describe("mcp server — write failure (B4)", function () {
  let h: Harness;
  let writeBlocked = false;

  before(async function () {
    this.timeout(30_000);
    h = await startHarness();
    // Populate domainConfigCache via a read tool before corrupting the
    // file's writability. Not strictly load-bearing for this mechanism
    // (chmod leaves the file readable, so loadDomainConfig() would succeed
    // fresh from disk regardless), but kept for parity with the row's
    // "populate cache" precondition and to document that the write failure
    // is independent of whether the cache was pre-warmed.
    assertOk(await h.call("read-domain-config", {}));

    const originalContent = fs.readFileSync(h.configPath, "utf-8");
    fs.chmodSync(h.configPath, 0o444);

    // Probe rather than infer: attempt the exact write server.ts's own
    // writeDomainConfig() performs (fs.writeFileSync against the now
    // read-only path), so this test depends on the actual property rather
    // than a uid proxy for it. If the probe write succeeds, chmod didn't
    // actually block the write on this platform/uid/filesystem, and
    // asserting a failure below would be asserting something false.
    try {
      fs.writeFileSync(h.configPath, originalContent, "utf-8");
      writeBlocked = false;
    } catch {
      writeBlocked = true;
    }
  });

  after(async function () {
    this.timeout(10_000);
    // Restore writability before teardown removes the temp dir — a leftover
    // read-only file can make removeTempDir's recursive rmSync fail on
    // Windows.
    try {
      fs.chmodSync(h.configPath, 0o666);
    } catch {
      /* best-effort — the path may already be gone */
    }
    await h?.stop();
  });

  it("set-overrides against a read-only config file returns isError and emits a write-failed notification", async function () {
    if (!writeBlocked) {
      // console.warn, not .log/.debug: test/setup.ts silences the latter two.
      console.warn(
        "config path is still writable after chmod (uid 0 or a permissive filesystem); skipping the write-failure assertions",
      );
      return;
    }

    const res = await h.call("set-overrides", {
      overrides: { "eventSheets/alpha/x.json": "Domain0" },
    });
    assert.strictEqual(res.isError, true);

    // Not an absolute txId: the chmod itself may fire a watcher event on top
    // of onWriteError's own bump. The notification is what proves onError
    // fired at all.
    await h.waitForNote(
      (n) => n.level === "error" && /write failed/.test(String(n.data)),
      2000,
    );
  });
});
