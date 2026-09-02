import { describe, it } from "mocha";
import { assert } from "chai";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Row M8's behavioral leg (issue #77 multi-root discovery adoption): when
 * `server` is invoked with no `--project-dir`/`--project`/`C3_PROJECT_DIR`
 * and discovery finds no `project.c3proj` marker anywhere, `resolveRootsOrExit`
 * (`src/cli.ts`) prints exactly one `[c3-domain-manager] Warning:` line naming
 * the fallback before falling back to `source: "cwd"`. This is CLI-only
 * behavior — `resolveProjectRoots` itself (`src/adapters/locations.ts`) stays
 * side-effect-free by design (see its class-level note), so it cannot be
 * observed through a unit test; the registry-shape half of row M8 ("the
 * registry is exactly [cwd] with one derived id") is covered instead by
 * `test/adapters/locations.test.ts`'s "0 markers under cwd" case, which
 * exercises `resolveProjectRoots` directly.
 *
 * Spawns the real CLI (not `test/mcpHarness.ts`, which always injects
 * `--project-dir`/`--project` and therefore never reaches the discovery/cwd
 * branch) with `cwd` set to this repo's own root — which structurally has no
 * `project.c3proj` (see CLAUDE.md's "Agent Dispatch Guide" section) — so
 * discovery legitimately comes up empty and the cwd fallback fires for real.
 * `ctx.root` ends up being the repo root itself, but this is side-effect-free:
 * `generateDomainIndex` calls the throwing `loadConfig` before any write
 * (`fs.rmSync`/`fs.mkdirSync` of `extracted/domain-index/`), and this repo has
 * no `domain-config.json`, so auto-generation fails fast with a caught,
 * logged warning and never touches the filesystem.
 */
describe("cli server — cwd-fallback discovery warning (row M8)", function () {
  it("prints exactly one Warning naming the cwd fallback before serving", function () {
    this.timeout(15_000);
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

    return new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "server"], {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "pipe"],
      });

      let stderr = "";
      let settled = false;

      function finish(fn: () => void): void {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        fn();
      }

      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
        if (/\[c3-domain-manager\] Warning: no project\.c3proj marker found/.test(stderr)) {
          finish(() => {
            try {
              const warnings =
                stderr.match(/\[c3-domain-manager\] Warning: no project\.c3proj marker found[^\n]*/g) ?? [];
              assert.equal(
                warnings.length,
                1,
                `expected exactly one cwd-fallback warning line, got: ${JSON.stringify(warnings)}`,
              );
              resolve();
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        }
      });

      child.on("error", (err) => finish(() => reject(err)));
      child.on("exit", () => {
        finish(() =>
          reject(new Error(`child exited before the expected warning appeared — stderr so far: ${stderr}`)),
        );
      });
    });
  });
});
