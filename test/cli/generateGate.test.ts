import { describe, it, before, after } from "mocha";
import { assert } from "chai";
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
});
