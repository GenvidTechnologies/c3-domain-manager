import * as fs from "node:fs";
import * as path from "node:path";
import { ReadWriteLock, ExpectedChanges, OptimisticWatcher, loadProjectConfig, isMcpError } from "@genvidtech/mcp-utils";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { DomainConfig } from "../domain/types.js";
import { DomainConfigSchema } from "../domain/types.js";
import { computeDomainData } from "../domain/domainGenerator.js";
import type { ComputeDomainDataResult } from "../domain/domainGenerator.js";
import type { ResolvedLocations } from "./locations.js";

/**
 * Holds one project's mutable MCP-server state, migrated off the module-level
 * singletons `src/mcp/server.ts` used to assign in `startServer(loc)` (issue
 * #77, multi-project support). Deliberately does NOT import
 * `src/adapters/projectRegistry.ts` — the registry holds *this* class, not
 * the other way around.
 *
 * Owns exactly the state that used to live as `server.ts` module-level `let`s
 * plus the per-project locks/caches (`domainDirty`, `ReadWriteLock`,
 * `OptimisticWatcher`, `domainConfigCache`, `domainDataCache`), and the six
 * state-reading helpers that operate on it: `readExtracted`,
 * `appendStaleWarning`, `staleFooter`, `loadDomainConfig`, `getDomainData`,
 * `writeDomainConfig`. Tool registration, `regenerate`'s orchestration, and
 * the rest of `server.ts`'s wiring stay where they are — this class is
 * migrated state and behaviour, not a rewrite of the server.
 *
 * Every call into `src/domain/` keeps that module's existing `rootDir`-first
 * signature (`computeDomainData(this.root, config)`), per ADR 0008 — a
 * project handle is deliberately never threaded through the pure core.
 */

export type LogLevel = "debug" | "info" | "warning" | "error";

/** Emits a log message for this project. Injected so `server.ts` keeps sole ownership of `emitLog`/the shared `McpServer` — see the class-level note on log prefixing. */
export type EmitFn = (level: LogLevel, message: string) => void;

const STALE_WARNING_LINE = "[Warning: domain index may be stale — run regenerate to refresh]";
const STALE_WARNING = "\n\n" + STALE_WARNING_LINE;

function isWithinDir(fullPath: string, dir: string): boolean {
  return fullPath.startsWith(dir + path.sep) || fullPath === dir;
}

export interface ProjectContextOptions {
  /** Identifies this project among others; prefixed onto every emitted log message. */
  id: string;
  loc: ResolvedLocations;
  /**
   * The server-wide log sink (e.g. a wrapper over `McpServer.sendLoggingMessage`).
   * `ProjectContext` never constructs its own emitter — only prefixes what it's given.
   */
  emit: EmitFn;
  /**
   * Shared, server-wide `ExpectedChanges` registry — injected, not owned.
   * `ProjectContext` deliberately does NOT construct its own: two per-project
   * instances would not actually solve the duplicate-`configPath` case (each
   * watcher's `expect()` only clears its own registry, so a shared file
   * watched by two contexts would still report a spurious external change),
   * and the registry's R9 distinct-`configPath` validation is what makes a
   * single shared instance safe (`add`/`consume`/`remove` are synchronous
   * `Map` operations with no `await` — see ADR 0028).
   */
  expected: ExpectedChanges;
}

export class ProjectContext {
  readonly #id: string;
  readonly #root: string;
  readonly #extractedDir: string;
  readonly #configPath: string;
  readonly #configDir: string;
  readonly #configFileName: string;
  readonly #configWatchKey: string;
  readonly #extractedEphemeral: boolean;

  readonly #emit: EmitFn;
  readonly #rwlock: ReadWriteLock;
  readonly #expectedChanges: ExpectedChanges;
  readonly #watcher: OptimisticWatcher;

  #domainDirty = false;
  #domainConfigCache: DomainConfig | null = null;
  #domainDataCache: ComputeDomainDataResult | null = null;

  constructor(opts: ProjectContextOptions) {
    this.#id = opts.id;
    this.#root = opts.loc.projectRoot;
    this.#extractedDir = opts.loc.extractedDir;
    this.#configPath = opts.loc.configPath;
    this.#configDir = opts.loc.configDir;
    this.#configFileName = opts.loc.configFileName;
    this.#configWatchKey = opts.loc.configWatchKey;
    this.#extractedEphemeral = opts.loc.extractedEphemeral;
    this.#emit = opts.emit;
    this.#expectedChanges = opts.expected;

    this.#rwlock = new ReadWriteLock();

    // Constructed unconditionally — the constructor performs no filesystem
    // access — so txId always has an owner, even when domain-config.json
    // doesn't yet exist on disk; start() below decides whether to actually
    // start it. watchDirs names the config file itself (not a directory): the
    // watcherFactory below watches that single file and reports every event
    // under the canonical configWatchKey, which is the exact key expect()
    // stores, so Layer-2 suppression matches (ADR 0026).
    this.#watcher = new OptimisticWatcher({
      watchDirs: [this.#configPath],
      expected: this.#expectedChanges,
      watcherFactory: (p, onEvent) => {
        const w = fs.watch(p, () => onEvent(this.#configWatchKey));
        // unref, or this handle alone keeps the process alive after stdin
        // closes (#70). stop() is reached only via SIGINT/SIGTERM in
        // server.ts's shutdown(); a client that disconnects by closing
        // stdin raises neither, so the handle must not keep the process
        // alive on its own (ADR 0026).
        w.unref();
        return { close: () => w.close() };
      },
      onExternalChange: () => {
        this.#domainDirty = true;
        this.#domainConfigCache = null;
        this.#domainDataCache = null;
        this.#log("warning", `External change detected: domain-config.json (txId → ${this.#watcher.txId})`);
      },
    });
  }

  get id(): string {
    return this.#id;
  }

  get root(): string {
    return this.#root;
  }

  get extractedDir(): string {
    return this.#extractedDir;
  }

  get configPath(): string {
    return this.#configPath;
  }

  get configDir(): string {
    return this.#configDir;
  }

  get configFileName(): string {
    return this.#configFileName;
  }

  get configWatchKey(): string {
    return this.#configWatchKey;
  }

  get extractedEphemeral(): boolean {
    return this.#extractedEphemeral;
  }

  get domainDirty(): boolean {
    return this.#domainDirty;
  }

  get rwlock(): ReadWriteLock {
    return this.#rwlock;
  }

  get watcher(): OptimisticWatcher {
    return this.#watcher;
  }

  /** Emits a message via the injected `emit`, prefixed `[id] ` so a black-box test (ADR 0025) can tell which project a log line came from. */
  #log(level: LogLevel, message: string): void {
    this.#emit(level, `[${this.#id}] ${message}`);
  }

  readExtracted(relPath: string): string | null {
    const fullPath = path.resolve(path.join(this.#extractedDir, relPath));
    if (!isWithinDir(fullPath, this.#extractedDir)) return null;
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8");
  }

  appendStaleWarning(text: string): string {
    return this.#domainDirty ? text + STALE_WARNING : text;
  }

  // Footer for paginatedContent on index reads: the stale warning rides as a
  // trailing footer line (omitted entirely when the index is fresh).
  staleFooter(): (() => string) | undefined {
    return this.#domainDirty ? () => STALE_WARNING_LINE : undefined;
  }

  async loadDomainConfig(): Promise<DomainConfig | CallToolResult> {
    if (!this.#domainConfigCache) {
      const cfg = await loadProjectConfig(this.#configDir, this.#configFileName, DomainConfigSchema);
      if (isMcpError(cfg)) return cfg; // do NOT cache transient errors
      this.#domainConfigCache = cfg;
    }
    return this.#domainConfigCache;
  }

  async getDomainData(): Promise<ComputeDomainDataResult | CallToolResult> {
    if (!this.#domainDataCache) {
      const config = await this.loadDomainConfig();
      if (isMcpError(config)) return config;
      this.#domainDataCache = computeDomainData(this.#root, config);
    }
    return this.#domainDataCache;
  }

  // Stays SYNCHRONOUS: OptimisticWatcher.suppress() is async-only, so this
  // uses the separate synchronous expect() instead. Layer 2 exists precisely
  // for a watcher event arriving after a suppress window would have closed
  // (ADR 0026) — there is no suppress window here to close.
  writeDomainConfig(config: DomainConfig): void {
    this.#watcher.expect(this.#configWatchKey);
    fs.writeFileSync(this.#configPath, JSON.stringify(config, null, "\t") + "\n", "utf-8");
    // Caching the mutated object without re-validation is safe: the lenient
    // .passthrough() schema still accepts it, and we own the mutation.
    // domainDataCache is deliberately NOT invalidated here — the stale
    // warning (appendStaleWarning/staleFooter) is the mitigation, not a
    // full cache flush; regenerate is what refreshes domainDataCache.
    this.#domainConfigCache = config;
    this.#watcher.bump();
    this.#domainDirty = true;
    this.#log("info", `domain-config.json updated (txId → ${this.#watcher.txId})`);
  }

  // onError hook for the mutate tools: a write that throws (e.g. a failed
  // fs.writeFileSync) leaves txId un-bumped while the on-disk file may have
  // changed — and the watcher swallows its own event via expectedChanges — so
  // the client would never learn to reconcile. Bumping txId here forces a
  // re-read. Bound (arrow-function field) so it can be passed as a bare
  // reference (e.g. withMcpErrors's onError) without losing `this`.
  onWriteError = (err: unknown): void => {
    this.#watcher.bump();
    this.#log("error", `domain-config.json write failed (txId → ${this.#watcher.txId}): ${err instanceof Error ? err.message : String(err)}`);
  };

  start(): void {
    if (fs.existsSync(this.#configPath)) this.#watcher.start();
    // No purge-interval timer here: `#expectedChanges` is shared/injected, not
    // owned, so purging it is the owner's (server.ts's) responsibility — it
    // already runs its own `setInterval(() => expectedChanges.purgeExpired(),
    // 30_000).unref()`, and a second per-context timer purging the same
    // shared registry would be redundant.
  }

  stop(): void {
    this.#watcher.stop();
    if (this.#extractedEphemeral) {
      try {
        fs.rmSync(this.#extractedDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}
