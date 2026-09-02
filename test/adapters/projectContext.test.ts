import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { ProjectContext } from "../../src/adapters/projectContext.js";
import type { EmitFn, LogLevel } from "../../src/adapters/projectContext.js";
import { resolveLocations, NO_EXTRACTED } from "../../src/adapters/locations.js";
import { makeTempDir, removeTempDir, createFile } from "../syntheticProject.js";
import { ExpectedChanges, isMcpError } from "@genvidtech/mcp-utils";
import type { DomainConfig } from "../../src/domain/types.js";

/** A minimal-but-schema-valid domain-config.json body. */
function configBody(domainDescription = "d0"): DomainConfig {
  return { domains: { Domain0: { description: domainDescription } } };
}

/**
 * Poll `predicate` until it returns true, or throw once `timeoutMs` elapses.
 *
 * Deliberately NOT a fixed sleep-then-check-or-skip: a fixed wait followed by
 * an `if (...) { assert ... } else { console.warn(...) }` fallback is
 * indistinguishable, when green, from a watcher that never fires at all — the
 * "did the event arrive" question is not platform-shaped (ADR 0026 documents
 * the platform divergence as *event count*, 1 vs 2, never *whether* an event
 * arrives), so there is nothing to gate here. A timed-out poll throws, and
 * that failure is the point: it makes a dead watcher loud instead of letting
 * the test quietly pass around it.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 3000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("ProjectContext", () => {
  let tmpDir: string;
  let logs: { level: LogLevel; message: string }[];
  let emit: EmitFn;
  let expected: ExpectedChanges;
  let ctx: ProjectContext;

  beforeEach(() => {
    tmpDir = makeTempDir("c3dm-projectcontext-");
    logs = [];
    emit = (level, message) => logs.push({ level, message });
    // Shared/injected, not owned — matches production, where the server
    // constructs one ExpectedChanges and hands it to every ProjectContext.
    expected = new ExpectedChanges();
    const loc = resolveLocations({}, tmpDir);
    ctx = new ProjectContext({ id: "proj-a", loc, emit, expected });
  });

  afterEach(() => {
    ctx.stop();
    removeTempDir(tmpDir);
  });

  describe("immutable identity fields", () => {
    it("exposes id/root/extractedDir/configPath matching the resolved locations", () => {
      const loc = resolveLocations({}, tmpDir);
      assert.equal(ctx.id, "proj-a");
      assert.equal(ctx.root, loc.projectRoot);
      assert.equal(ctx.extractedDir, loc.extractedDir);
      assert.equal(ctx.configPath, loc.configPath);
      assert.equal(ctx.configDir, loc.configDir);
      assert.equal(ctx.configFileName, loc.configFileName);
      assert.equal(ctx.configWatchKey, loc.configWatchKey);
      assert.equal(ctx.extractedEphemeral, loc.extractedEphemeral);
    });

    it("assigning to id/root/extractedDir/configPath throws (getter-only accessors)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyCtx = ctx as any;
      assert.throws(() => { anyCtx.id = "other"; });
      assert.throws(() => { anyCtx.root = "/somewhere/else"; });
      assert.throws(() => { anyCtx.extractedDir = "/somewhere/else"; });
      assert.throws(() => { anyCtx.configPath = "/somewhere/else"; });
    });
  });

  describe("readExtracted", () => {
    it("returns null when the file does not exist", () => {
      assert.isNull(ctx.readExtracted("domain-index/index.md"));
    });

    it("returns file contents when present under extractedDir", () => {
      createFile(ctx.extractedDir, "domain-index/index.md", "# Index\n");
      assert.equal(ctx.readExtracted("domain-index/index.md"), "# Index\n");
    });

    it("returns null for a path that escapes extractedDir", () => {
      // Write a real file just outside extractedDir, then try to read it via "..".
      const outsidePath = path.join(path.dirname(ctx.extractedDir), "secret.txt");
      fs.writeFileSync(outsidePath, "secret");
      try {
        assert.isNull(ctx.readExtracted("../secret.txt"));
      } finally {
        fs.rmSync(outsidePath, { force: true });
      }
    });
  });

  describe("appendStaleWarning / staleFooter", () => {
    it("is a no-op before any write (domainDirty starts false)", () => {
      assert.isFalse(ctx.domainDirty);
      assert.equal(ctx.appendStaleWarning("body"), "body");
      assert.isUndefined(ctx.staleFooter());
    });

    it("appends the stale warning and returns a footer once domainDirty is set (via writeDomainConfig)", () => {
      ctx.writeDomainConfig(configBody());
      assert.isTrue(ctx.domainDirty);
      assert.include(ctx.appendStaleWarning("body"), "domain index may be stale");
      const footer = ctx.staleFooter();
      assert.isFunction(footer);
      assert.include(footer!(), "domain index may be stale");
    });
  });

  describe("loadDomainConfig", () => {
    it("loads and parses domain-config.json", async () => {
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody("hello")));
      const result = await ctx.loadDomainConfig();
      assert.isFalse(isMcpError(result));
      const cfg = result as DomainConfig;
      assert.equal(cfg.domains.Domain0.description, "hello");
    });

    it("returns an isMcpError result for a missing config file", async () => {
      const result = await ctx.loadDomainConfig();
      assert.isTrue(isMcpError(result));
    });

    it("caches the parsed config — a later on-disk edit is not observed until re-constructed", async () => {
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody("first")));
      const first = await ctx.loadDomainConfig();
      assert.isFalse(isMcpError(first));

      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody("second")));
      const second = await ctx.loadDomainConfig();
      assert.strictEqual(second, first);
      assert.equal((second as DomainConfig).domains.Domain0.description, "first");
    });
  });

  describe("getDomainData", () => {
    it("computes domain data from the project root using the loaded config", async () => {
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody()));
      createFile(tmpDir, "eventSheets/Foo.json", "{}");
      const result = await ctx.getDomainData();
      assert.isFalse(isMcpError(result));
      const { domains } = result as { domains: { name: string }[] };
      assert.isArray(domains);
      assert.isTrue(domains.some((d) => d.name === "Domain0"));
    });

    it("propagates a config load error instead of computing", async () => {
      const result = await ctx.getDomainData();
      assert.isTrue(isMcpError(result));
    });

    it("caches the computed result across calls", async () => {
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody()));
      const first = await ctx.getDomainData();
      const second = await ctx.getDomainData();
      assert.strictEqual(second, first);
    });
  });

  describe("writeDomainConfig", () => {
    it("is synchronous (returns void, not a Promise)", () => {
      const returned = ctx.writeDomainConfig(configBody());
      assert.isUndefined(returned);
    });

    it("writes the file to disk, bumps txId, and sets domainDirty", () => {
      const txIdBefore = ctx.watcher.txId;
      ctx.writeDomainConfig(configBody("written"));
      assert.equal(ctx.watcher.txId, txIdBefore + 1);
      assert.isTrue(ctx.domainDirty);
      const onDisk = JSON.parse(fs.readFileSync(ctx.configPath, "utf-8")) as DomainConfig;
      assert.equal(onDisk.domains.Domain0.description, "written");
    });

    it("updates the config cache to the written object without touching the domain-data cache", async () => {
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody("original")));
      await ctx.getDomainData(); // populate both caches
      const dataBefore = await ctx.getDomainData();

      ctx.writeDomainConfig(configBody("updated"));
      const cfgAfter = await ctx.loadDomainConfig();
      assert.equal((cfgAfter as DomainConfig).domains.Domain0.description, "updated");

      // domainDataCache is deliberately NOT invalidated by writeDomainConfig —
      // the stale warning is the mitigation, not a cache flush (ADR 0026 asymmetry).
      const dataAfter = await ctx.getDomainData();
      assert.strictEqual(dataAfter, dataBefore);
    });

    it("emits an info log prefixed with this context's id", () => {
      ctx.writeDomainConfig(configBody());
      const infoLogs = logs.filter((l) => l.level === "info");
      assert.isAtLeast(infoLogs.length, 1);
      assert.match(infoLogs[0].message, /^\[proj-a\] domain-config\.json updated/);
    });
  });

  describe("onWriteError", () => {
    it("bumps txId and emits an error log prefixed with this context's id", () => {
      const txIdBefore = ctx.watcher.txId;
      ctx.onWriteError(new Error("disk full"));
      assert.equal(ctx.watcher.txId, txIdBefore + 1);
      const errorLogs = logs.filter((l) => l.level === "error");
      assert.equal(errorLogs.length, 1);
      assert.match(errorLogs[0].message, /^\[proj-a\] domain-config\.json write failed.*disk full/);
    });

    it("is bindable as a bare function reference (does not depend on call-site `this`)", () => {
      const bare = ctx.onWriteError;
      assert.doesNotThrow(() => bare(new Error("boom")));
    });
  });

  describe("start/stop lifecycle", () => {
    it("start() does not throw when domain-config.json does not yet exist", () => {
      assert.doesNotThrow(() => ctx.start());
    });

    it("start() then stop() does not throw once domain-config.json exists", () => {
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody()));
      assert.doesNotThrow(() => ctx.start());
      assert.doesNotThrow(() => ctx.stop());
    });

    it("stop() removes extractedDir when extractedEphemeral is true", () => {
      const loc = resolveLocations({ extracted: NO_EXTRACTED }, tmpDir);
      const ephemeralCtx = new ProjectContext({ id: "proj-ephemeral", loc, emit, expected });
      try {
        assert.isTrue(fs.existsSync(ephemeralCtx.extractedDir));
        ephemeralCtx.start();
        ephemeralCtx.stop();
        assert.isFalse(fs.existsSync(ephemeralCtx.extractedDir));
      } finally {
        ephemeralCtx.stop();
      }
    });

    it("stop() leaves extractedDir alone when extractedEphemeral is false", () => {
      assert.isFalse(ctx.extractedEphemeral);
      fs.mkdirSync(ctx.extractedDir, { recursive: true });
      ctx.start();
      ctx.stop();
      assert.isTrue(fs.existsSync(ctx.extractedDir));
    });
  });

  describe("external change detection (onExternalChange)", () => {
    it("marks domainDirty, clears caches, and logs a [id]-prefixed warning on an external write", async function () {
      this.timeout(5000);
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody("before")));
      await ctx.loadDomainConfig(); // populate the cache so we can observe invalidation
      ctx.start();

      // Perform a write the context did NOT call writeDomainConfig for — i.e.
      // an "external" change, the same shape as another process editing the file.
      fs.writeFileSync(ctx.configPath, JSON.stringify(configBody("after")), "utf-8");

      // Poll rather than gate: whether the event arrives at all is not
      // platform-shaped (only its count is, per ADR 0026), so a timeout here
      // is a real failure, not a skip.
      await waitUntil(() => ctx.domainDirty);

      const warnLogs = logs.filter((l) => l.level === "warning");
      assert.isAtLeast(warnLogs.length, 1);
      assert.match(warnLogs[0].message, /^\[proj-a\] External change detected/);
      const reloaded = await ctx.loadDomainConfig();
      assert.equal((reloaded as DomainConfig).domains.Domain0.description, "after");
    });
  });

  describe("shared ExpectedChanges across distinct configPaths", () => {
    it("a self-write on one context does not leak an external-change warning into a sibling context, and the sibling still detects its own external write", async function () {
      this.timeout(5000);
      createFile(tmpDir, "domain-config.json", JSON.stringify(configBody("a-before")));
      createFile(tmpDir, "domain-config-b.json", JSON.stringify(configBody("b-before")));

      const locB = resolveLocations({ config: "domain-config-b.json" }, tmpDir);
      const ctxB = new ProjectContext({ id: "proj-b", loc: locB, emit, expected });

      try {
        await ctx.loadDomainConfig();
        await ctxB.loadDomainConfig();
        ctx.start();
        ctxB.start();

        // A self-write on A, registered against the shared `expected`
        // registry under A's own configWatchKey. B watches a distinct path
        // ([locB.configPath]), so nothing about this write is even visible
        // to B's watcher — the shared registry keys strictly by path.
        ctx.writeDomainConfig(configBody("a-after"));

        // A genuine external write to B's file — not routed through B's
        // writeDomainConfig, so B's watcher should classify it as external.
        fs.writeFileSync(ctxB.configPath, JSON.stringify(configBody("b-after")), "utf-8");

        // Proof-of-life first: wait until B's watcher actually fires. If it
        // never does, this throws and fails the test loudly — a dead watcher
        // must not read as "isolation held" (same reasoning as the
        // single-context test above; this is the R21 shape).
        await waitUntil(() => ctxB.domainDirty);

        const bWarnings = logs.filter(
          (l) => l.level === "warning" && l.message.startsWith("[proj-b] External change detected"),
        );
        assert.isAtLeast(bWarnings.length, 1);
        const bReloaded = await ctxB.loadDomainConfig();
        assert.equal((bReloaded as DomainConfig).domains.Domain0.description, "b-after");

        // Only meaningful now that B has proven the watcher is alive: A's
        // silence here is isolation through the shared registry, not
        // inactivity of a dead subject.
        const aExternalWarnings = logs.filter(
          (l) => l.level === "warning" && l.message.startsWith("[proj-a] External change detected"),
        );
        assert.equal(aExternalWarnings.length, 0);
      } finally {
        ctxB.stop();
      }
    });
  });
});
