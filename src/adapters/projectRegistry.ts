import { mcpError } from "@genvidtech/mcp-utils";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * A generic, in-memory `id -> T` registry used to select among several
 * registered projects by an opaque string id.
 *
 * This module imports no `node:path`, `node:fs`, or `@genvidtech/c3source` —
 * `T` is a bare type parameter and `resolve()` is nothing more than a
 * `Map.get`. That is what makes the security property structural rather
 * than a check: a path-shaped selector (`"../other"`, `"C:/tmp"`, `"./x"`)
 * cannot become an arbitrary-read surface, because this module has no
 * filesystem to reach in the first place — there is nothing here that ever
 * resolves, joins, or opens a path. Keep it that way: the moment `T` is
 * pinned to a concrete type (e.g. `ProjectContext`), a type-only import of
 * that type is easy to add without noticing it erases at compile time,
 * which would make a bare import-count check unable to tell the two cases
 * apart.
 */
export class ProjectRegistry<T> {
  readonly #map: Map<string, T>;

  constructor(entries: Map<string, T> | Iterable<readonly [string, T]>) {
    this.#map = entries instanceof Map ? entries : new Map(entries);
  }

  /** The ids of every registered project, in insertion order. */
  ids(): string[] {
    return [...this.#map.keys()];
  }

  /**
   * Resolves `id` to its registered value.
   *
   * - `id === undefined`: returns the sole registered value if exactly one
   *   project is registered; otherwise returns an error naming every known
   *   id (selection is never silently defaulted among multiple projects).
   * - `id` given but not registered: returns an error naming every known id.
   * - `id` given and registered: returns the registered value.
   */
  resolve(id?: string): T | CallToolResult {
    if (id === undefined) {
      if (this.#map.size === 1) return this.#map.values().next().value!;
      return mcpError(new Error(`project is required: ${this.#map.size} projects are registered`), [
        `Known ids: ${this.ids().join(", ")}`,
      ]);
    }
    const hit = this.#map.get(id);
    if (hit) return hit;
    return mcpError(new Error(`unknown project '${id}'`), [`Known ids: ${this.ids().join(", ")}`]);
  }
}
