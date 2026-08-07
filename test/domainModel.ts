import type { DomainConfig, DomainData } from "../src/domain/types.js";

/**
 * Shared test-model builders for `DomainConfig`/`DomainData` literals.
 *
 * Consolidates the seven hand-rolled `makeDomain`/config-builder variants
 * that previously lived one per spec file (`test/domain/coupling.test.ts`
 * and siblings) into a single source of truth (issue #38).
 */

/**
 * Build a minimal `DomainConfig`, defaulting `domains` to `{}`.
 *
 * `extras` covers every other top-level key (`overrides`, `relationships`,
 * `coupling`, `sharedSubdomains`, ...) as named properties rather than
 * positional arguments. The four incompatible positional signatures this
 * replaces disagreed on argument order and meaning — most conspicuously,
 * `glossary.test.ts`'s old helper took `sharedSubdomains` in the slot the
 * others used for `overrides`. Named keys on `extras` make that confusion
 * impossible.
 *
 * `{ domains, ...extras }` omits any key not supplied, rather than setting
 * it to `undefined`. This is safe: every optional `DomainConfig` key is read
 * via `?? default` or a truthiness guard across `src/`, never via `in` /
 * `Object.keys(config)` / `hasOwnProperty` — even `classification.ts`'s `in`
 * check is guarded by `config.overrides &&` first — so an omitted key and an
 * explicit `undefined` are indistinguishable to every reader.
 */
export function makeConfig(
  domains: DomainConfig["domains"] = {},
  extras?: Partial<Omit<DomainConfig, "domains">>,
): DomainConfig {
  return { domains, ...extras };
}

/**
 * Build a `DomainData` fixture, defaulting every field.
 *
 * Deliberately enumerates every `DomainData` field by hand rather than
 * spreading a real `computeDomainData()` result — that is what makes `tsc`
 * fail here (not silently pass) when `DomainData` gains a new non-optional
 * field, which is the entire point of consolidating this helper into one
 * place: a single literal to update instead of five.
 *
 * `strategy`/`isSharedSubdomain` are always written (as `opts?.x`, so still
 * `undefined` unless supplied) rather than omitted, unlike three of the
 * variants this replaces. That is also safe and, in fact, more faithful to
 * production: every reader of these two fields (`formatting.ts`,
 * `relationships.ts`, `coupling.ts`) does a value read, never a presence
 * check, and `computeDomainData`'s own `domainGenerator.ts` writes
 * `strategy: def.strategy` unconditionally. `tsconfig.json` has `strict:
 * true` but not `exactOptionalPropertyTypes`, so assigning `undefined`
 * type-checks.
 */
export function makeDomain(name: string, opts?: Partial<DomainData>): DomainData {
  return {
    name,
    description: opts?.description ?? "",
    eventSheets: opts?.eventSheets ?? [],
    layouts: opts?.layouts ?? [],
    scripts: opts?.scripts ?? [],
    functions: opts?.functions ?? [],
    includesFrom: opts?.includesFrom ?? new Map(),
    includedBy: opts?.includedBy ?? new Map(),
    referencesFrom: opts?.referencesFrom ?? new Map(),
    referencedBy: opts?.referencedBy ?? new Map(),
    expressionRefsFrom: opts?.expressionRefsFrom ?? new Map(),
    expressionRefsBy: opts?.expressionRefsBy ?? new Map(),
    addons: opts?.addons ?? [],
    strategy: opts?.strategy,
    isSharedSubdomain: opts?.isSharedSubdomain,
  };
}
