import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Subprocess harness for the **non-`server`** CLI subcommands: spawns the real
 * `src/cli.ts` through `tsx`, lets it run to completion, and captures its exit
 * code plus both output streams.
 *
 * This is the repo's first *spawning* harness for a subcommand that terminates
 * on its own. (`test/cliProjectFlags.test.ts` already tests CLI helpers, but by
 * importing the exported functions — it never spawns anything.) Spawning is
 * what makes the process **exit code** observable at all: `process.exit` is the
 * production surface a shell or CI step actually reads, and no in-process unit
 * test can assert on it.
 *
 * **This module must never import `fixtureHelpers`.** Its callers build
 * throwaway synthetic projects (`syntheticProject.js` + `domainModel.js`),
 * because the cases a CLI-exit-code suite needs are mostly *negative* ones the
 * canonical fixture cannot express — most of all "a project with **no**
 * unclassified files", which is the passing side of every gate assertion. A
 * fixture-seeded run would assert about the fixture's own classification
 * instead, and would keep passing if the behaviour under test were deleted.
 * Same rule, and the same reason, as `syntheticProject.ts` (CLAUDE.md "Testing
 * conventions", ADR 0014).
 *
 * **Deliberately not consolidated with `test/mcp/rootFallbackWarning.test.ts`,
 * which spawns the CLI too.** The two have mutually exclusive termination
 * policies: that test drives `server`, a long-lived process that is *supposed*
 * to keep running, so it treats a child exit as a **failure** and kills the
 * child itself once it has seen the line it wants. This harness drives
 * subcommands that run to completion, so it treats the child exit as the
 * **success** signal and is the only thing that resolves the promise. One
 * function cannot carry both policies, so do not merge them — and do not
 * rewrite that test onto this harness.
 */

/** Terminal outcome of one CLI spawn. */
export interface CliResult {
  /**
   * The child's exit code, or `null` when it was terminated by a signal
   * (node reports `null` for the code in that case). Assert on it with
   * `assert.strictEqual(res.code, 2)` — never a truthiness test, which would
   * conflate a clean `0` with a signalled `null`, and would read a gate
   * failure (`2`) as indistinguishable from any other non-zero code.
   */
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunCliOpts {
  /**
   * Working directory for the child. Defaults to this repo's root, which is
   * also the only value that generally works: the child's `--import tsx` and
   * its `src/cli.ts` argument are both resolved against the child's own cwd.
   * Select the *project* with `--project-dir <root>` rather than by moving
   * cwd (this is exactly what `test/mcpHarness.ts` does).
   */
  cwd?: string;
  /**
   * Redirects the child's `os.tmpdir()` by setting all three of `TMPDIR`
   * (honoured on Linux/CI), `TEMP` and `TMP` (honoured on Windows) — measured:
   * a spawned node child does pick these up. Used to observe what a run leaves
   * in the system temp dir, e.g. whether an ephemeral `--extracted none`
   * directory (`c3dm-extracted-*`, `src/adapters/locations.ts`) was cleaned up.
   * Applied *after* `env`, so it wins over an explicit `TMPDIR`/`TEMP`/`TMP`
   * passed there.
   */
  tmpRoot?: string;
  /** Extra environment for the child, merged **over** `process.env` (not replacing it). */
  env?: NodeJS.ProcessEnv;
}

/** Repo root: derived from this module's own location, never from `process.cwd()`. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Run `src/cli.ts <...args>` to completion and resolve with its outcome.
 *
 * **Never rejects on a non-zero exit** — the exit code *is* the assertion
 * subject here, so throwing on it would make every interesting case
 * unobservable. The single rejection path is a spawn-level `error` (the child
 * never started), which is an infrastructure fault rather than a CLI result.
 *
 * Resolves on `close` rather than `exit`, so both captured streams are flushed
 * before the caller sees them.
 */
export function runCli(args: string[], opts: RunCliOpts = {}): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
  if (opts.tmpRoot !== undefined) {
    env.TMPDIR = opts.tmpRoot;
    env.TEMP = opts.tmpRoot;
    env.TMP = opts.tmpRoot;
  }

  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: opts.cwd ?? REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
