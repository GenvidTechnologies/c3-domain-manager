import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assert } from "chai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DomainConfig } from "../src/domain/types.js";
import { createFile, makeTempDir, removeTempDir } from "./syntheticProject.js";
import { makeConfig } from "./domainModel.js";

/**
 * Subprocess-based MCP stdio test harness for `src/mcp/server.ts`.
 *
 * The server exports only `startServer` and holds all state (the `McpServer`
 * instance, `txId`, `domainDirty`, caches, ...) in module-private bindings —
 * there is no in-process test-reachable surface. This harness drives the
 * *real* server through its production CLI path (`src/cli.ts server
 * --project-dir <root>` for one project, or `server --project <id>=<root>`
 * repeated for N) over a real MCP `Client` connected via stdio, so every
 * assertion exercises the server exactly as a real MCP client would.
 *
 * **Synthetic-only.** This module must never import the canonical-fixture
 * helper module — it builds throwaway C3 projects in per-test temp dirs via
 * `syntheticProject.js` and `domainModel.js`, the same as any other synthetic
 * test.
 */

/** Per-project options, shared by the single-project shorthand and the multi-project `projects` map. */
export interface ProjectOpts {
  /** Domain config written to `<root>/domain-config.json`. Default: a single synthetic domain. */
  config?: DomainConfig;
  /** Extra files created under the temp root, keyed by path relative to it. */
  files?: Record<string, string>;
  /**
   * Whether to let the server auto-generate `extracted/domain-index/` on
   * startup (`startServer`'s bare `existsSync` guard on the domain-index
   * directory, in `server.ts`). Default
   * `false`: the harness pre-creates an empty `extracted/domain-index/` so
   * startup skips auto-generation entirely — the largest single time lever
   * (~750ms) for suites that don't need a populated index. Pass `true` when
   * the test needs `read-domain-index` (or anything depending on the
   * generated index) to actually return content.
   */
  autoGenerate?: boolean;
}

export interface HarnessOpts extends ProjectOpts {
  /**
   * Multi-project shape: id -> per-project opts. When given, the harness
   * builds one temp root per id (via `makeTempDir`, given a
   * `"mcp-harness-<id>-"` prefix),
   * writes one `domain-config.json` each, and spawns the server with N
   * `--project <id>=<root>` arguments — the CLI's registry-defining form
   * (`buildServerProjectSpecs`). `--project-dir` is never passed in this mode.
   *
   * Omitted (the default): behaves exactly as before this option existed —
   * one project spawned via `--project-dir <root>`, using the top-level
   * `config`/`files`/`autoGenerate` shorthand (inherited from `ProjectOpts`
   * above). Its id is derived by the server from the temp dir's basename and
   * is never asserted on here, since `PROJECT_PARAM` is optional whenever
   * exactly one project is registered. Mutually exclusive with `projects` in
   * practice — the CLI itself only honours one shape at a time
   * (`buildServerProjectSpecs` ignores `--project-dir` once any `--project`
   * is given), so supplying both here is a caller bug, not a supported mix.
   */
  projects?: Record<string, ProjectOpts>;
  /**
   * Forwarded verbatim as a single shared `--extracted <value>` CLI flag —
   * mirrors the CLI's own shape (`buildServerProjectSpecs` attaches one
   * `extracted` value to every project spec; there is no per-project
   * override). Used by issue #77's L2 row to pass `NO_EXTRACTED` ("none") so
   * every registered project gets its own ephemeral temp dir instead of the
   * harness's usual pre-created `<root>/extracted/domain-index/`. Omitted
   * (the default): no `--extracted` flag is passed at all, unchanged from
   * before this option existed.
   */
  extracted?: string;
}

/** One captured `notifications/message` (logging) notification from the server. */
export interface LogNote {
  level: string;
  logger?: string;
  data: unknown;
}

export interface Harness {
  readonly client: Client;
  /**
   * The sole project's root / config path. Throws if more than one project
   * is registered — use `roots`/`configPaths` instead once N > 1. This is a
   * convenience for the (overwhelmingly common) single-project case, not a
   * silent "first project" pick: this exact class of ambiguity is what
   * issue #77 exists to eliminate, so the harness must not model it either.
   */
  readonly root: string;
  readonly configPath: string;
  /** Every registered project's root, keyed by id. */
  readonly roots: Record<string, string>;
  /** Every registered project's `domain-config.json` path, keyed by id. */
  readonly configPaths: Record<string, string>;
  readonly notifications: readonly LogNote[];
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  waitForNote(pred: (n: LogNote) => boolean, ms?: number): Promise<LogNote>;
  stop(): Promise<void>;
  /** Captured child stderr so far (the server's banner + startup log lines). */
  stderr(): string;
  /**
   * The spawned child process's OS pid, or `null` before the transport has
   * started (never the case once `startHarness` has resolved). Exposed so a
   * test can signal the child directly (e.g. `process.kill(h.pid!,
   * "SIGTERM")`) — issue #77's L2 row needs a real `SIGTERM`, distinct from
   * `stop()`'s stdin-close-then-fallback path (see `Harness.stop`'s ordering
   * note and L1's docstring for why the two are not interchangeable).
   */
  readonly pid: number | null;
}

interface Waiter {
  pred: (n: LogNote) => boolean;
  resolve: (n: LogNote) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_WAIT_MS = 2000;

/**
 * Materializes one project's temp root: writes `domain-config.json`, any
 * extra `files`, and (unless `autoGenerate`) a pre-created empty
 * `extracted/domain-index/` so the server's startup auto-generation guard is
 * a no-op. Shared by both the single-project shorthand and the multi-project
 * `projects` map below — the only difference between them is which CLI flag
 * (`--project-dir` vs `--project <id>=<root>`) the caller wires the result
 * into.
 */
function buildProjectRoot(prefix: string, opts: ProjectOpts): { root: string; configPath: string } {
  const root = makeTempDir(prefix);
  const config: DomainConfig = opts.config ?? makeConfig({ Domain0: { description: "Single synthetic domain" } });
  const configPath = path.join(root, "domain-config.json");
  createFile(root, "domain-config.json", JSON.stringify(config, null, "\t") + "\n");

  for (const [relPath, content] of Object.entries(opts.files ?? {})) {
    createFile(root, relPath, content);
  }

  const autoGenerate = opts.autoGenerate ?? false;
  if (!autoGenerate) {
    // Pre-create the domain-index dir so startServer's bare existsSync guard
    // skips auto-generation on this spawn entirely.
    fs.mkdirSync(path.join(root, "extracted", "domain-index"), { recursive: true });
  }
  return { root, configPath };
}

/**
 * Returns the sole entry of a single-project record, or throws if more than
 * one project is registered. Backs `Harness.root`/`Harness.configPath` — see
 * their docstrings for why this throws rather than picking the first entry.
 */
function soleValue(record: Record<string, string>, accessor: string): string {
  const entries = Object.entries(record);
  if (entries.length !== 1) {
    const ids = entries.map(([id]) => id).join(", ");
    throw new Error(
      `Harness.${accessor}: ${entries.length} projects are registered (${ids}) — use Harness.${accessor}s instead of the single-project accessor`,
    );
  }
  return entries[0][1];
}

export async function startHarness(opts: HarnessOpts = {}): Promise<Harness> {
  // Multi-project shape (`opts.projects`) defines the registry entirely, via
  // N `--project <id>=<root>` args. Omitted: the original single-project
  // shape, spawned via `--project-dir <root>` exactly as before this option
  // existed — required for the suites that predate multi-project support.
  const multi = opts.projects !== undefined;
  const projectEntries: [string, ProjectOpts][] = multi
    ? Object.entries(opts.projects!)
    : [["default", { config: opts.config, files: opts.files, autoGenerate: opts.autoGenerate }]];

  const roots: Record<string, string> = {};
  const configPaths: Record<string, string> = {};
  const serverArgs: string[] = ["--import", "tsx", "src/cli.ts", "server"];

  for (const [id, projectOpts] of projectEntries) {
    // Distinguishable prefixes (issue #77 requirement): a leaked temp dir
    // from a multi-project suite stays traceable back to which project id
    // leaked it, not just that "a" mcp-harness dir leaked.
    const prefix = multi ? `mcp-harness-${id}-` : "mcp-harness-";
    const built = buildProjectRoot(prefix, projectOpts);
    roots[id] = built.root;
    configPaths[id] = built.configPath;
    if (multi) {
      serverArgs.push("--project", `${id}=${built.root}`);
    }
  }
  if (!multi) {
    serverArgs.push("--project-dir", roots["default"]);
  }
  if (opts.extracted !== undefined) {
    serverArgs.push("--extracted", opts.extracted);
  }

  // The child's `--import tsx` resolves against ITS OWN cwd, so cwd must be
  // this repo's root — never a project root, which is reached only through
  // `--project-dir`/`--project`.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: serverArgs,
    cwd: repoRoot,
    stderr: "pipe",
  });

  // `transport.stderr` is a PassThrough stream available immediately (even
  // before `start()`), specifically so early output isn't lost.
  const stderrChunks: Buffer[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  let resolveChildExited!: () => void;
  const childExited = new Promise<void>((resolve) => {
    resolveChildExited = resolve;
  });
  // Must be set BEFORE client.connect(transport): Protocol.connect() captures
  // whatever `transport.onclose` is at connect time and wraps it, so setting
  // this after connect would silently lose our handler.
  transport.onclose = () => resolveChildExited();

  const client = new Client({ name: "mcp-harness", version: "0.0.0" });

  const notifications: LogNote[] = [];
  const waiters: Waiter[] = [];

  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const note: LogNote = {
      level: notification.params.level,
      logger: notification.params.logger,
      data: notification.params.data,
    };
    notifications.push(note);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (waiter.pred(note)) {
        clearTimeout(waiter.timer);
        waiters.splice(i, 1);
        waiter.resolve(note);
      }
    }
  });

  await client.connect(transport);

  let stopped = false;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    // The SDK's declared callTool() return type is a union (one branch has no
    // `content` at all — the task/task-result compatibility branch). Passing
    // CallToolResultSchema validates the *runtime* shape but does not narrow
    // the *static* return type, so every caller in this repo must go through
    // this one cast rather than re-deriving it at each call site.
    const res = await client.callTool({ name, arguments: args }, CallToolResultSchema);
    return res as unknown as CallToolResult;
  }

  function waitForNote(pred: (n: LogNote) => boolean, ms = DEFAULT_WAIT_MS): Promise<LogNote> {
    const existing = notifications.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise<LogNote>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        const seen = notifications.map((n) => `${n.level}:${String(n.data)}`).join(" | ") || "(none)";
        reject(new Error(`waitForNote: no matching notification within ${ms}ms — captured so far: ${seen}`));
      }, ms);
      waiters.push({ pred, resolve, timer });
    });
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    // Ordered: close the client (which closes the transport and awaits the
    // child process closing) → await the transport's own onclose signal →
    // only then remove every temp root. Removing one while the child still
    // holds an fs.watch on a file inside it is the failure mode this
    // prevents (ADR 0025) — N-fold here, since the child watches every
    // registered project's config path.
    await client.close();
    await childExited;
    for (const root of Object.values(roots)) {
      removeTempDir(root);
    }
  }

  return {
    client,
    get root() {
      return soleValue(roots, "root");
    },
    get configPath() {
      return soleValue(configPaths, "configPath");
    },
    roots,
    configPaths,
    notifications,
    call,
    waitForNote,
    stop,
    stderr: () => Buffer.concat(stderrChunks).toString("utf-8"),
    get pid() {
      return transport.pid;
    },
  };
}

export function textOf(res: CallToolResult): string {
  if (!("content" in res) || !Array.isArray(res.content)) {
    assert.fail("tool result carried no content array (compatibility shape?)");
  }
  return res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Asserts the result is not an error (`isError` is `undefined` on success, never `false`) and returns its text. */
export function assertOk(res: CallToolResult): string {
  assert.notStrictEqual(res.isError, true, `expected a successful result, got: ${textOf(res)}`);
  return textOf(res);
}

/** Asserts the result is an error whose text includes `needle`, and returns the text. */
export function assertToolError(res: CallToolResult, needle: string): string {
  const text = textOf(res);
  assert.strictEqual(res.isError, true, `expected isError === true, got text: ${text}`);
  assert.include(text, needle);
  return text;
}

/**
 * Extracts the `txId` from a mutate tool's `mcpContent` footer. Anchors on
 * the LAST line specifically: the body above it can contain arbitrary
 * override file paths, and a loose `/txId: (\d+)/` search across the whole
 * text could match one of those instead of the actual footer.
 */
export function txIdOf(res: CallToolResult): number {
  const text = textOf(res);
  const lines = text.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  const match = /^txId: (\d+)$/.exec(lastLine);
  if (!match) {
    assert.fail(`txIdOf: last line did not match /^txId: \\d+$/ — got: ${JSON.stringify(lastLine)}`);
  }
  return Number(match[1]);
}

/**
 * Number of txId bumps produced by ONE self-write through
 * set-overrides/remove-overrides. One logical change, one bump — on every
 * platform.
 *
 * This was 2 on Windows until #68 was fixed: fs.writeFileSync delivers two
 * fs.watch events there for a single write (platform-determined, measured
 * invariant across three node majors — see ADR 0026), and
 * ExpectedChanges.consume is single-shot, so the second event was
 * misclassified as external. mcp-utils 0.7.0's OptimisticWatcher adds a
 * content-fingerprint Layer 3 that answers "does the file hold something we
 * haven't accounted for?" — a question with no timing term — which collapses
 * the duplicate without a window to tune.
 *
 * Kept as a named constant rather than an inline 1: it is the single point
 * every dependent assertion keys on, and it names *why* the number is what
 * it is. Measured after the fix: 1, on 3/3 runs against the real server.
 */
export const SELF_WRITE_OBSERVED_TXID_BUMPS = 1;
