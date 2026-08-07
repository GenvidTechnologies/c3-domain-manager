import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Shared helpers for building *synthetic* C3 project trees in temp dirs.
 *
 * **This module must never import `fixtureHelpers.js`.**
 *
 * It is the counterpart to that module, not a replacement for it — the two
 * halves of the suite are deliberately kept apart (see CLAUDE.md "Testing
 * conventions" and ADR 0014). Synthetic tests exist precisely to express
 * *negative* cases the canonical fixture can never contain (e.g. editor-local
 * names like `*.uistate.json`, files at arbitrary paths, malformed JSON), so
 * seeding a temp dir from the fixture would turn those negative assertions
 * into assertions about the fixture instead, silently defeating their purpose.
 *
 * Imports `node:fs`/`node:os`/`node:path` only: nothing from `src/`, and
 * nothing from `mocha` (no hooks are registered here — each test file wires
 * its own `beforeEach`/`afterEach` around `makeTempDir`/`removeTempDir`).
 */

/** Create a file (and its parent directories) under `baseDir`. */
export function createFile(baseDir: string, relativePath: string, content = ""): void {
  // `content` defaults to `""` because the vast majority of call sites only
  // care that the file exists (e.g. for classification/discovery tests) and
  // don't need real content — 49 existing call sites pass just two arguments.
  const fullPath = path.join(baseDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/**
 * Create a fresh temp directory for a test suite.
 *
 * `prefix` is required (no default) so that a leaked temp dir (e.g. a
 * missed `removeTempDir` in a failed `afterEach`) stays traceable back to
 * the suite that leaked it, rather than collapsing into an anonymous name.
 *
 * Deliberately does NOT pre-create `eventSheets/`/`layouts/`/`scripts/`:
 * the `findScriptEntries` suite asserts on the exact set of entries
 * returned for a directory, so a pre-created section dir would change that
 * output out from under the test. Callers create whatever section dirs
 * their scenario needs via `createFile`.
 */
export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Recursively remove a temp directory created by `makeTempDir`. */
export function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Build a minimal-but-valid object-type JSON string for addon-attribution
 * tests. Copied verbatim from `addonInventory.test.ts` (byte-identical to
 * the copy in `domainGenerator.test.ts`) — do not change field names,
 * ordering, or default values.
 */
export function makeObjectType(
  name: string,
  pluginId: string,
  behaviorIds: string[] = [],
  effectIds: string[] = [],
): string {
  return JSON.stringify({
    name,
    "plugin-id": pluginId,
    sid: 1,
    instanceVariables: [],
    behaviorTypes: behaviorIds.map((behaviorId) => ({ behaviorId, name: behaviorId, sid: 1 })),
    effectTypes: effectIds.map((effectId) => ({ effectId, name: effectId })),
  });
}

/**
 * Build a minimal-but-valid family JSON string for addon-attribution tests.
 * Copied verbatim from `addonInventory.test.ts` (byte-identical to the copy
 * in `domainGenerator.test.ts`) — do not change field names, ordering, or
 * default values.
 */
export function makeFamily(
  name: string,
  pluginId: string,
  members: string[],
  behaviorIds: string[] = [],
  effectIds: string[] = [],
): string {
  return JSON.stringify({
    name,
    "plugin-id": pluginId,
    sid: 1,
    instanceVariables: [],
    behaviorTypes: behaviorIds.map((behaviorId) => ({ behaviorId, name: behaviorId, sid: 1 })),
    effectTypes: effectIds.map((effectId) => ({ effectId, name: effectId })),
    members,
  });
}
