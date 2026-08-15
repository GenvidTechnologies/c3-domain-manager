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
 * --project-dir <root>`) over a real MCP `Client` connected via stdio, so
 * every assertion exercises the server exactly as a real MCP client would.
 *
 * **Synthetic-only.** This module must never import the canonical-fixture
 * helper module — it builds throwaway C3 projects in per-test temp dirs via
 * `syntheticProject.js` and `domainModel.js`, the same as any other synthetic
 * test.
 */

export interface HarnessOpts {
  /** Domain config written to `<root>/domain-config.json`. Default: a single synthetic domain. */
  config?: DomainConfig;
  /** Extra files created under the temp root, keyed by path relative to it. */
  files?: Record<string, string>;
  /**
   * Whether to let the server auto-generate `extracted/domain-index/` on
   * startup (the real `:624` `existsSync` guard in `server.ts`). Default
   * `false`: the harness pre-creates an empty `extracted/domain-index/` so
   * startup skips auto-generation entirely — the largest single time lever
   * (~750ms) for suites that don't need a populated index. Pass `true` when
   * the test needs `read-domain-index` (or anything depending on the
   * generated index) to actually return content.
   */
  autoGenerate?: boolean;
}

/** One captured `notifications/message` (logging) notification from the server. */
export interface LogNote {
  level: string;
  logger?: string;
  data: unknown;
}

export interface Harness {
  readonly client: Client;
  readonly root: string;
  readonly configPath: string;
  readonly notifications: readonly LogNote[];
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  waitForNote(pred: (n: LogNote) => boolean, ms?: number): Promise<LogNote>;
  stop(): Promise<void>;
  /** Captured child stderr so far (the server's banner + startup log lines). */
  stderr(): string;
}

interface Waiter {
  pred: (n: LogNote) => boolean;
  resolve: (n: LogNote) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_WAIT_MS = 2000;

export async function startHarness(opts: HarnessOpts = {}): Promise<Harness> {
  const root = makeTempDir("mcp-harness-");
  const config: DomainConfig = opts.config ?? makeConfig({ Domain0: { description: "Single synthetic domain" } });
  const configPath = path.join(root, "domain-config.json");
  createFile(root, "domain-config.json", JSON.stringify(config, null, "\t") + "\n");

  for (const [relPath, content] of Object.entries(opts.files ?? {})) {
    createFile(root, relPath, content);
  }

  const autoGenerate = opts.autoGenerate ?? false;
  if (!autoGenerate) {
    // Pre-create the domain-index dir so the `:624` existsSync guard in
    // startServer skips auto-generation on this spawn entirely.
    fs.mkdirSync(path.join(root, "extracted", "domain-index"), { recursive: true });
  }

  // The child's `--import tsx` resolves against ITS OWN cwd, so cwd must be
  // this repo's root — never `root` (the temp C3 project), which is reached
  // only through `--project-dir`.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts", "server", "--project-dir", root],
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
    // only then remove the temp dir. Removing it while the child still holds
    // an fs.watch on a file inside it is the failure mode this prevents.
    await client.close();
    await childExited;
    removeTempDir(root);
  }

  return {
    client,
    root,
    configPath,
    notifications,
    call,
    waitForNote,
    stop,
    stderr: () => Buffer.concat(stderrChunks).toString("utf-8"),
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
 * Observed number of txId bumps produced by ONE self-write through
 * set-overrides/remove-overrides. Correct value is 1. It is 2 because
 * fs.writeFileSync fires >1 watcher event for a single write while
 * ExpectedChanges.consume is single-shot, so event 2 is misclassified
 * external. Windows-only — measured 1 event on Linux ext4 (node 20 and 22),
 * 2 on Windows (node 24). KNOWN-BROKEN — see #68. When #68 lands, set this
 * to 1 and every dependent assertion follows.
 */
export const SELF_WRITE_OBSERVED_TXID_BUMPS = 2;
