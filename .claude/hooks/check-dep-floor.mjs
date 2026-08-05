#!/usr/bin/env node
/**
 * PostToolUse hook — warn when a `@genvidtech/*` dependency version in
 * package.json is no longer the floor stated in CLAUDE.md.
 *
 * CLAUDE.md documents each key dependency's floor in prose ("(floor `^1.9.0`)")
 * and records *why* that floor is load-bearing in its "When bumping …" chain.
 * Both are documentation, so they drift silently: a bump that touches only
 * package.json leaves CLAUDE.md asserting a version the code no longer needs.
 * That happened in issue #33 and was caught only at code review.
 *
 * This is a REMINDER, never a gate — it always exits 0. A missing file, bad
 * JSON, or any unexpected error is silently ignored: a doc-drift nudge must
 * never break an edit.
 *
 * Reads the PostToolUse payload on stdin; emits the documented hook JSON on
 * stdout (`systemMessage` for the user, `additionalContext` for the model).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root — this script lives at <root>/.claude/hooks/. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    return; // not JSON — nothing to do
  }

  const file =
    payload?.tool_input?.file_path ?? payload?.tool_response?.filePath ?? "";
  if (path.basename(file) !== "package.json") return;

  // Only the repo's own manifest — never a dependency's or a fixture's.
  if (path.resolve(file) !== path.join(ROOT, "package.json")) return;

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const claudeMd = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");

  // CLAUDE.md states floors only for the @genvidtech packages; the rest
  // (zod, yargs, the MCP SDK) are deliberately undocumented there.
  const drifted = Object.entries(pkg.dependencies ?? {})
    .filter(([name]) => name.startsWith("@genvidtech/"))
    .filter(([, range]) => !claudeMd.includes(range));

  if (drifted.length === 0) return;

  const list = drifted.map(([name, range]) => `${name}@${range}`).join(", ");
  const msg =
    `CLAUDE.md does not mention ${list}. Bumping a key dependency is a ` +
    `two-place change: update the stated floor in CLAUDE.md's "Key dependencies" ` +
    `section AND add the adoption to its "When bumping …" chain, in this same ` +
    `commit — so the reason the new floor is load-bearing is recorded, not just ` +
    `the number.`;

  process.stdout.write(
    JSON.stringify({
      systemMessage: `Dependency floor drift: ${msg}`,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: msg,
      },
    }),
  );
}

try {
  main();
} catch {
  // Never fail an edit over a documentation reminder.
}
process.exit(0);
