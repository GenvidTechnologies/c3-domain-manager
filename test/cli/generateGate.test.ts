import { describe, it, before, after } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import { runCli } from "../cliHarness.js";
import { createFile, makeTempDir, removeTempDir } from "../syntheticProject.js";
import { makeConfig } from "../domainModel.js";

/** Minimal valid event-sheet JSON — same shape the `domainGenerator` suite uses. */
function eventSheetJson(name: string): string {
  return JSON.stringify({ name, events: [], sid: 1 });
}

/**
 * Baseline lock on **today's** `generate` behaviour, captured before the
 * unclassified gate has any CLI surface (issue #81).
 *
 * The point of asserting the *current* exit 0 is that it is the behaviour the
 * gate must leave alone: a run with no threshold flag reports its unclassified
 * count and still succeeds, so wiring the flag must not turn every existing
 * caller's build red. Recorded as a spawn rather than a unit test because the
 * process exit code is the thing under contract, and only a real child process
 * has one.
 *
 * Synthetic, not fixture-backed: the project is built to contain exactly one
 * unclassified event sheet, a count the canonical fixture does not have and
 * would not hold still at (CLAUDE.md "Testing conventions", ADR 0014).
 *
 * The suite now also holds the gate's own cases, which lean on that same
 * count of one: `--max-unclassified 0` trips on it and `--max-unclassified 1`
 * allows it, which is what pins the comparison as an *allowance* (`>`) rather
 * than a presence check. The first test stays exactly as captured — its exit
 * 0 is the no-flag behaviour the gate must leave alone.
 */
describe("cli generate — unclassified baseline (issue #81)", function () {
  // One spawn measured at ~1.9s against mocha's 5000ms default, which leaves
  // no headroom on a loaded machine or a cold `tsx` cache.
  this.timeout(30_000);

  let projectRoot: string;

  before(() => {
    projectRoot = makeTempDir("cli-generate-gate-");
    createFile(projectRoot, "eventSheets/Unknown/Foo.json", eventSheetJson("Unknown/Foo"));
    createFile(
      projectRoot,
      "domain-config.json",
      JSON.stringify(makeConfig({ Auth: { description: "Auth", eventSheetDirs: ["Login"] } }), null, "\t") + "\n",
    );
  });

  after(() => {
    removeTempDir(projectRoot);
  });

  it("exits 0 and reports the unclassified count when no threshold is requested", async () => {
    // `--extracted none` sends the generated index to an ephemeral temp dir
    // the CLI cleans up itself, so the run leaves the project tree untouched.
    const res = await runCli(["generate", "--project-dir", projectRoot, "--extracted", "none"]);

    assert.strictEqual(res.code, 0, `expected exit 0, got ${res.code} — stderr: ${res.stderr}`);
    assert.include(res.stdout, "1 unclassified files!");
  });

  it("exits 2 when the one unclassified file breaches --max-unclassified 0", async () => {
    const res = await runCli([
      "generate",
      "--project-dir",
      projectRoot,
      "--extracted",
      "none",
      "--max-unclassified",
      "0",
    ]);

    // 2, not 1: a tripped gate is a successful analysis reporting a policy
    // breach, which a CI step must be able to tell apart from "the tool could
    // not run" (`UNCLASSIFIED_GATE_EXIT_CODE`, src/adapters/unclassifiedGate.ts).
    assert.strictEqual(res.code, 2, `expected exit 2, got ${res.code} — stderr: ${res.stderr}`);
  });

  it("exits 0 when --max-unclassified 1 allows the one unclassified file", async () => {
    const res = await runCli([
      "generate",
      "--project-dir",
      projectRoot,
      "--extracted",
      "none",
      "--max-unclassified",
      "1",
    ]);

    // The threshold names an allowance, so the count it names is permitted:
    // a `>=` comparison would reject the very number the caller allowed.
    assert.strictEqual(res.code, 0, `expected exit 0, got ${res.code} — stderr: ${res.stderr}`);
    // And the run is otherwise unchanged — the count is still reported.
    assert.include(res.stdout, "1 unclassified files!");
  });

  it("reports a tripped gate as one stderr line, with no usage block and no stack trace", async () => {
    // Same command as the exit-2 case above; this test reads what it *said*
    // rather than what it returned.
    const res = await runCli([
      "generate",
      "--project-dir",
      projectRoot,
      "--extracted",
      "none",
      "--max-unclassified",
      "0",
    ]);

    assert.include(res.stderr, "Classification gate failed:");
    // A yargs usage dump would mean the failure went through argument
    // validation instead of the gate; a stack frame would mean it escaped as
    // an unhandled throw. Both would bury the verdict in noise.
    assert.notInclude(res.stderr, "Options:");
    assert.notInclude(res.stderr, "    at ");
  });

  it("still removes the ephemeral --extracted none temp dir when the gate trips", async () => {
    // `process.exit` does not run pending `finally` blocks, so a gate failure
    // raised inside the handler's try would skip the cleanup and leak a
    // directory on every tripped run. A fresh, empty temp root makes any
    // survivor visible.
    const tmpRoot = makeTempDir("cli-generate-gate-tmp-");
    try {
      assert.deepStrictEqual(fs.readdirSync(tmpRoot), [], "tmpRoot must start empty");

      const res = await runCli(
        ["generate", "--project-dir", projectRoot, "--extracted", "none", "--max-unclassified", "0"],
        { tmpRoot },
      );

      assert.strictEqual(res.code, 2, `expected exit 2, got ${res.code} — stderr: ${res.stderr}`);

      // Positive control, and not optional: without it a zero count below is
      // equally consistent with "the ephemeral dir was never created inside
      // the directory being counted", which would make the assertion pass
      // while proving nothing. The generator logs its output path, so this
      // confirms the dir really was created under `tmpRoot` first.
      const generatedLines = res.stdout.split("\n").filter((l) => l.includes("Generated domain index with"));
      assert.lengthOf(generatedLines, 1, `expected one "Generated domain index with" line — stdout: ${res.stdout}`);
      assert.include(generatedLines.join("\n"), tmpRoot);

      const leftovers = fs.readdirSync(tmpRoot).filter((n) => n.startsWith("c3dm-extracted-"));
      assert.deepStrictEqual(leftovers, [], `ephemeral extracted dir(s) leaked: ${leftovers.join(", ")}`);
    } finally {
      removeTempDir(tmpRoot);
    }
  });

  it("rejects a bare --max-unclassified instead of silently disabling the gate", async () => {
    // With `type: "number"` alone, yargs hands the handler `undefined` for a
    // bare flag — indistinguishable from the flag being absent, so the gate
    // would turn itself off and the run would report success. `requiresArg`
    // is what makes yargs refuse the invocation instead.
    const res = await runCli(["generate", "--project-dir", projectRoot, "--extracted", "none", "--max-unclassified"]);

    assert.notStrictEqual(res.code, 0, `expected a non-zero exit, got ${res.code} — stdout: ${res.stdout}`);
    assert.include(res.stderr, "Not enough arguments following: max-unclassified");
  });

  it("exits 1 on a non-numeric --max-unclassified", async () => {
    // yargs coerces `abc` to the *number* `NaN`, and `count > NaN` is false —
    // so without the handler's own validation this run would exit 0 with the
    // gate silently inert. 1, not 2: a bad threshold is a bad invocation, not
    // a breached policy.
    const res = await runCli([
      "generate",
      "--project-dir",
      projectRoot,
      "--extracted",
      "none",
      "--max-unclassified",
      "abc",
    ]);

    assert.strictEqual(res.code, 1, `expected exit 1, got ${res.code} — stderr: ${res.stderr}`);
    assert.include(res.stderr, "--max-unclassified");
  });
});
