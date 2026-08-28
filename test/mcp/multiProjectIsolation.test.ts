import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { assert } from "chai";
import type { Harness } from "../mcpHarness.js";
import { startHarness, assertOk, textOf } from "../mcpHarness.js";
import { makeConfig } from "../domainModel.js";
import { deriveProjectId } from "../../src/adapters/locations.js";

/**
 * F1.5 (issue #77): the seven pledged multi-project integration rows — S2,
 * C1, C4, R21 (+ its R21-M mutation control), L1, L2, H2.
 *
 * Deliberately a separate file from `multiProject.test.ts` (that file's own
 * docstring reserves these rows for "F1.5's job, not this file's" — it stays
 * the narrow harness-plumbing smoke test).
 *
 * The two mutation controls named in the acceptance rows (C4, R21-M) are NOT
 * encoded here as permanent, self-injecting test code — they are a one-time
 * verification procedure performed during implementation (inject, grep,
 * observe red, revert, confirm `git diff` empty) and are not part of the
 * standing suite.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Extra required args (beyond `project`) each per-project tool needs to pass
 * MCP SDK-side zod validation and actually reach `registerProjectTool`'s
 * callback — a tool with a missing required field never reaches
 * `REGISTRY.resolve`; the SDK rejects it as a protocol-level `McpError`
 * instead of the domain-level `CallToolResult` error under test here. Every
 * tool not listed has no required field besides the injected `project`.
 */
const EXTRA_ARGS: Record<string, Record<string, unknown>> = {
  "set-overrides": { overrides: {} },
  "remove-overrides": { paths: [] },
  "context-map": { format: "text" },
};

/**
 * Every tool registered via `registerProjectTool` — i.e. every tool except
 * `list-projects` (S4's sole explicit exemption). A static list, deliberately
 * NOT re-derived from `client.listTools()` here: C1 below is the row that
 * derives the live set (so a registry regression can't drift unnoticed
 * relative to source); S2 and C4 reuse a fixed list because they also need
 * per-tool extra-argument knowledge (`EXTRA_ARGS` above) that a live walk
 * doesn't supply either.
 */
const PER_PROJECT_TOOLS = [
  "read-domain-index",
  "read-domain-config",
  "list-uncategorized",
  "list-stale-overrides",
  "set-overrides",
  "remove-overrides",
  "regenerate",
  "get-state",
  "glossary-check",
  "validate-boundaries",
  "validate-editor",
  "addon-inventory",
  "domain-health",
  "context-map",
];

/** `get-state`'s text is `txId: N\ndomainDirty: bool` — extract the `txId:` line. */
function stateTxId(text: string): number {
  const match = /^txId: (\d+)$/m.exec(text);
  if (!match) {
    assert.fail(`get-state text did not carry a txId line: ${JSON.stringify(text)}`);
  }
  return Number(match![1]);
}

/**
 * Probes whether THIS platform delivers a `SIGTERM` sent via
 * `process.kill(pid, "SIGTERM")` to a Node child's own `process.on("SIGTERM",
 * ...)` handler at all — independent of `c3-domain-manager`'s own code.
 *
 * Spawns a throwaway `node -e` child that installs a SIGTERM handler writing
 * a sentinel file then exiting, waits for it to signal readiness over
 * stdout, sends it a real SIGTERM, and checks whether the sentinel was
 * written. Returns `true` only if the handler demonstrably ran.
 *
 * This exists so L2 below can gate on the PRECONDITION (can this platform
 * deliver the signal at all) rather than the OUTCOME (did the ephemeral
 * dirs get removed) — see L2's own comment for why that distinction is
 * load-bearing: gating on the outcome makes a genuinely broken cleanup
 * indistinguishable from an unreachable platform, on the one platform where
 * the row could actually catch a regression.
 */
async function probeSignalDelivery(): Promise<boolean> {
  const sentinel = path.join(os.tmpdir(), `c3dm-sigterm-probe-${process.pid}-${Date.now()}`);
  const script =
    `process.on("SIGTERM", () => { require("fs").writeFileSync(${JSON.stringify(sentinel)}, "ok"); process.exit(0); });` +
    `console.log("READY");` +
    `setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("probeSignalDelivery: child never signalled READY")), 5000);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf-8").includes("READY")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assert.isNotNull(child.pid, "probeSignalDelivery: child has no pid");
    process.kill(child.pid!, "SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      // Safety timeout only — does not affect the return value below, which
      // is decided purely by whether the sentinel exists.
      setTimeout(resolve, 2000).unref();
    });
    return fs.existsSync(sentinel);
  } finally {
    try {
      child.kill();
    } catch {
      /* already dead, or this platform can't signal it either — best-effort */
    }
    try {
      fs.rmSync(sentinel, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

describe("mcp server — multi-project integration (F1.5)", function () {
  describe("C1: every tool accepts the selector", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("client.listTools() enumerates 15 tools (parser positive control — baseline was 14 before list-projects)", async function () {
      const { tools } = await h.client.listTools();
      assert.strictEqual(tools.length, 15);
    });

    it("every tool's inputSchema declares `project`, except the sole exemption list-projects", async function () {
      const { tools } = await h.client.listTools();
      // Re-assert non-vacuous enumeration at this test's own call site too —
      // a registry silently enumerating nothing must not pass this loop by
      // having nothing to iterate.
      assert.isAtLeast(tools.length, 1);
      const EXEMPT = ["list-projects"];
      for (const tool of tools) {
        if (EXEMPT.includes(tool.name)) continue;
        const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
        assert.exists(schema?.properties?.project, `${tool.name}: inputSchema.properties.project is not defined`);
      }
    });
  });

  describe("S2: omission never silently defaults", function () {
    describe("two-project harness — every tool called without `project` errors, naming both ids", function () {
      let h: Harness;

      before(async function () {
        this.timeout(30_000);
        h = await startHarness({
          projects: {
            alpha: { config: makeConfig({ AlphaDomain: { description: "Alpha's domain" } }) },
            beta: { config: makeConfig({ BetaDomain: { description: "Beta's domain" } }) },
          },
        });
      });

      after(async function () {
        this.timeout(10_000);
        await h?.stop();
      });

      it("every per-project tool omitting `project` returns isError naming both alpha and beta", async function () {
        this.timeout(30_000);
        for (const name of PER_PROJECT_TOOLS) {
          const args = EXTRA_ARGS[name] ?? {};
          const res = await h.call(name, args);
          const text = textOf(res);
          assert.strictEqual(res.isError, true, `${name}: expected isError true, got: ${text}`);
          assert.include(text, "alpha", `${name}: response did not name 'alpha' — ${text}`);
          assert.include(text, "beta", `${name}: response did not name 'beta' — ${text}`);
        }
      });
    });

    describe("one-project harness — omitting `project` is byte-identical to naming the derived id explicitly", function () {
      let h: Harness;

      before(async function () {
        this.timeout(30_000);
        h = await startHarness({ autoGenerate: true });
      });

      after(async function () {
        this.timeout(10_000);
        await h?.stop();
      });

      it("read-only + no-op tools return identical text whether `project` is omitted or given explicitly", async function () {
        this.timeout(30_000);
        const id = deriveProjectId(h.root);
        // set-overrides is excluded here — it is never idempotent (every
        // call bumps txId into the response footer), so a second call in
        // the SAME harness can never be byte-identical to the first
        // regardless of selector-omission correctness. It gets its own,
        // genuinely comparable check below instead.
        const IDEMPOTENT_TOOLS = PER_PROJECT_TOOLS.filter((name) => name !== "set-overrides");
        for (const name of IDEMPOTENT_TOOLS) {
          // remove-overrides: a path never present in (empty) overrides hits
          // the tool's own no-op early return ("No overrides to remove.")
          // both times — genuinely idempotent, not faked.
          const args = name === "remove-overrides" ? { paths: ["nonexistent/path.json"] } : (EXTRA_ARGS[name] ?? {});
          const omitted = textOf(await h.call(name, args));
          const explicit = textOf(await h.call(name, { ...args, project: id }));
          assert.strictEqual(omitted, explicit, `${name}: omitted-project vs explicit-'${id}' text diverged`);
        }
      });

      it("set-overrides returns identical text across two freshly-built single-project harnesses, one omitted, one explicit", async function () {
        this.timeout(30_000);
        const config = makeConfig({ Domain0: { description: "Single synthetic domain" } });
        const hA = await startHarness({ config });
        const hB = await startHarness({ config });
        try {
          const idB = deriveProjectId(hB.root);
          const overrides = { "eventSheets/x.json": "Domain0" };
          const textA = textOf(await hA.call("set-overrides", { overrides }));
          const textB = textOf(await hB.call("set-overrides", { overrides, project: idB }));
          assert.strictEqual(textA, textB);
        } finally {
          await hA.stop();
          await hB.stop();
        }
      });
    });
  });

  describe("C4: exactly one lock acquisition per call (no deadlock)", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness();
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    // Deliberately no `this.timeout(...)` override — this row relies on the
    // suite's default 5000ms mocha timeout (package.json's `--timeout 5000`)
    // to turn a deadlock into a failure rather than an indefinite hang.
    it("every MUTATE/REGENERATE-annotated handler resolves without hanging", async function () {
      const { tools } = await h.client.listTools();
      const writers = tools.filter((t) => t.annotations?.readOnlyHint === false);
      // Positive control: a registry that silently enumerated nothing must
      // not pass this loop by having nothing to iterate.
      assert.isAtLeast(writers.length, 1);
      for (const tool of writers) {
        const args = EXTRA_ARGS[tool.name] ?? {};
        const res = await h.call(tool.name, args);
        assert.exists(res, `${tool.name}: call() did not resolve`);
      }
    });
  });

  describe("R21: cross-project cache isolation, designed to be able to fail", function () {
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

    it("an external write to beta invalidates only beta; alpha's dirty flag, txId, and pre-write token are untouched", async function () {
      this.timeout(10_000);
      // Warm both caches so the isolation check below actually exercises
      // cache invalidation rather than a first-ever read.
      assertOk(await h.call("read-domain-config", { project: "alpha" }));
      assertOk(await h.call("read-domain-config", { project: "beta" }));

      const alphaTxIdBefore = stateTxId(assertOk(await h.call("get-state", { project: "alpha" })));

      const betaExternalConfig = makeConfig({
        BetaDomain: { description: "Beta's domain" },
        DomainExternal: { description: "written outside the server" },
      });
      fs.writeFileSync(h.configPaths.beta, JSON.stringify(betaExternalConfig, null, "\t") + "\n", "utf-8");

      // (i) Proves the watcher fired for BETA specifically — without this,
      // steps (iii)-(iv) would pass vacuously (alpha untouched because
      // NOTHING happened at all, not because isolation held).
      await h.waitForNote(
        (n) => n.level === "warning" && /^\[beta\] External change detected/.test(String(n.data)),
      );

      // (ii) beta WAS invalidated and reflects the external write.
      const betaText = assertOk(await h.call("read-domain-config", { project: "beta", section: "domains" }));
      assert.include(betaText, "DomainExternal");

      // (iii) alpha untouched: not dirty, same txId as before the write.
      const alphaStateAfter = assertOk(await h.call("get-state", { project: "alpha" }));
      assert.include(alphaStateAfter, "domainDirty: false");
      assert.strictEqual(stateTxId(alphaStateAfter), alphaTxIdBefore);

      // (iv) alpha's pre-write token is still accepted for a write.
      assertOk(
        await h.call("set-overrides", {
          project: "alpha",
          overrides: { "eventSheets/x.json": "AlphaDomain" },
          txId: alphaTxIdBefore,
        }),
      );
    });
  });

  describe("H2: log messages identify the project", function () {
    let h: Harness;

    before(async function () {
      this.timeout(30_000);
      h = await startHarness({
        projects: {
          alpha: { config: makeConfig({ AlphaDomain: { description: "Alpha's domain" } }) },
          beta: { config: makeConfig({ BetaDomain: { description: "Beta's domain" } }) },
        },
      });
    });

    after(async function () {
      this.timeout(10_000);
      await h?.stop();
    });

    it("an external write to beta is logged [beta]-prefixed, never [alpha]-prefixed", async function () {
      this.timeout(10_000);
      const betaExternalConfig = makeConfig({
        BetaDomain: { description: "Beta's domain" },
        DomainExternal: { description: "written outside the server" },
      });
      fs.writeFileSync(h.configPaths.beta, JSON.stringify(betaExternalConfig, null, "\t") + "\n", "utf-8");

      await h.waitForNote((n) => /^\[beta\] /.test(String(n.data)));

      // Positive control: the notification channel is alive at all — a dead
      // logging channel would make the absence check below pass vacuously.
      assert.isAtLeast(h.notifications.length, 1);

      const alphaLeak = h.notifications.some((n) => /^\[alpha\] External change detected/.test(String(n.data)));
      assert.isFalse(alphaLeak, "beta's external write must never be logged under alpha's id");
    });
  });

  describe("L1: lifecycle per project", function () {
    it("startup banner names both projects; the child exits promptly (not via client.close()'s own SIGTERM fallback) after stdin close", async function () {
      this.timeout(30_000);
      const h = await startHarness({
        projects: {
          alpha: { config: makeConfig({ AlphaDomain: { description: "Alpha's domain" } }) },
          beta: { config: makeConfig({ BetaDomain: { description: "Beta's domain" } }) },
        },
      });
      const banner = h.stderr();
      assert.match(banner, /\[alpha\] Serving/);
      assert.match(banner, /\[beta\] Serving/);

      // h.stop() closes the client (stdin end), not SIGINT — shutdown() is
      // wired only to SIGINT/SIGTERM, so this exercises exactly the path
      // that must rely on every FSWatcher + the shared purgeExpired interval
      // being unref'd rather than an explicit handler running.
      //
      // StdioClientTransport.close() races a 2s internal SIGTERM fallback if
      // the child hasn't exited on its own by then, so a bare "did it
      // resolve" assertion can't tell a clean unref'd exit apart from a
      // forced kill. Measuring elapsed time can: a pure event-loop drain
      // completes in well under a second; anything needing the fallback
      // takes >= ~2000ms. 1800ms leaves margin under that threshold without
      // being tight enough to flake on ordinary process-teardown cost.
      const start = Date.now();
      await h.stop();
      const elapsed = Date.now() - start;
      assert.isBelow(
        elapsed,
        1800,
        `stop() took ${elapsed}ms — suggests client.close()'s own 2s SIGTERM fallback fired rather than a natural unref'd exit`,
      );
    });

    it("structural check: projectContext.ts + server.ts call .unref() at least twice combined", function () {
      const ctxSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "adapters", "projectContext.ts"), "utf-8");
      const serverSrc = fs.readFileSync(path.join(REPO_ROOT, "src", "mcp", "server.ts"), "utf-8");
      const count = (ctxSrc.match(/\.unref\(\)/g)?.length ?? 0) + (serverSrc.match(/\.unref\(\)/g)?.length ?? 0);
      assert.isAtLeast(count, 2);
    });
  });

  describe("L2: ephemeral extracted/ cleanup is per project", function () {
    let signalsDelivered: boolean;

    before(async function () {
      this.timeout(10_000);
      // Gates on the PRECONDITION, not the OUTCOME — see
      // probeSignalDelivery's own docstring. Computed once here, entirely
      // independent of the server under test: a throwaway node child, not
      // c3-domain-manager, is what proves whether this platform can deliver
      // SIGTERM to a handler at all. Gating the `it` below on the outcome
      // instead (did the dirs disappear?) would make a genuinely broken
      // ctx.stop() cleanup on a platform that DOES deliver the signal take
      // the same "skip" branch as a platform that structurally cannot
      // deliver it — silent on the one platform where the row could ever
      // catch a real regression. Gating on this precondition means the
      // assertion below is unconditional wherever the mechanism is provably
      // reachable, and silent only where it provably is not.
      signalsDelivered = await probeSignalDelivery();
    });

    it("two projects started with --extracted none produce two distinct temp dirs, cleaned up on shutdown", async function () {
      this.timeout(30_000);
      const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("c3dm-extracted-")));

      const h = await startHarness({
        projects: {
          alpha: { config: makeConfig({ AlphaDomain: { description: "Alpha's domain" } }) },
          beta: { config: makeConfig({ BetaDomain: { description: "Beta's domain" } }) },
        },
        extracted: "none",
      });

      let fullPaths: string[] = [];
      try {
        const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("c3dm-extracted-"));
        const newDirs = after.filter((n) => !before.has(n));
        assert.strictEqual(newDirs.length, 2, `expected 2 new ephemeral extracted dirs, got: ${JSON.stringify(newDirs)}`);
        fullPaths = newDirs.map((n) => path.join(os.tmpdir(), n));
        for (const p of fullPaths) assert.isTrue(fs.existsSync(p), `${p} should exist before shutdown`);

        assert.isNotNull(h.pid);
        process.kill(h.pid!, "SIGTERM");
        await h.stop(); // resolves once the child's own 'close' event fires, however it actually exits

        if (signalsDelivered) {
          // Unconditional — no outcome branch. If ctx.stop()'s fs.rmSync
          // cleanup is broken, this fails loudly, which is the whole point
          // of the row.
          for (const p of fullPaths) assert.isFalse(fs.existsSync(p), `${p} should be gone after SIGTERM`);
        } else {
          // Measured via probeSignalDelivery's throwaway child above (not
          // inferred from process.platform): this platform does not deliver
          // POSIX signals to a Node child's own handler at all —
          // process.kill(pid, "SIGTERM") (and ChildProcess#kill(), used by
          // StdioClientTransport.close()'s own fallback) unconditionally
          // terminates the target via TerminateProcess without ever running
          // process.on("SIGTERM", ...), so server.ts's shutdown() (and
          // therefore ctx.stop()'s cleanup) never runs on this machine. This
          // is a structural platform boundary, not a timing race — same
          // shape as writeFailure.test.ts's B4 chmod probe.
          console.warn(
            "L2: probeSignalDelivery found this platform does not deliver SIGTERM to a Node child process's " +
              "own handler — skipping the cleanup assertion; only the two-distinct-dirs creation above is " +
              "asserted unconditionally.",
          );
        }
      } finally {
        await h.stop(); // no-op if already stopped
        // Best-effort: if SIGTERM was a hard kill on this platform, the
        // ephemeral dirs were never cleaned up by the server itself — remove
        // them here so a leaked temp dir doesn't accumulate across runs.
        for (const p of fullPaths) {
          try {
            fs.rmSync(p, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        }
      }
    });
  });
});
