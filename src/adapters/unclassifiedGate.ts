/**
 * The classification-coverage gate (issue #81): pure primitives shared by the
 * CLI's `--max-unclassified` flag and the MCP server's `regenerate` tool.
 *
 * Deliberately values-in/values-out — no filesystem, no MCP types, no yargs
 * import — so both adapters can apply the *same* threshold rule and the rule
 * itself is unit-testable without standing either adapter up. It is also the
 * reason this module is not re-exported from `src/index.ts`: like its
 * `src/adapters/` siblings it is adapter plumbing, not part of the published
 * domain API (`src/index.ts` re-exports `src/domain/` only).
 */

/**
 * Process exit code the CLI uses when the gate trips.
 *
 * Deliberately **2**, not 1. This CLI already exits 1 for "the command
 * failed" — an unresolvable project root, a bad `--config` path, a config
 * that fails schema validation. A tripped coverage gate is a *successful*
 * analysis reporting a policy breach, and a CI consumer must be able to tell
 * the two apart: "your project has more unclassified files than you allow"
 * calls for editing `domain-config.json`, while "the tool could not run"
 * calls for fixing the invocation. Collapsing both onto 1 makes a broken
 * pipeline step indistinguishable from a real finding.
 */
export const UNCLASSIFIED_GATE_EXIT_CODE = 2;

/**
 * Whether `count` unclassified files breaches a `max` threshold.
 *
 * `max === undefined` disables the gate entirely — no threshold was
 * requested, so nothing can trip. The comparison is strictly `>`, making
 * `max` an *allowance* rather than a presence check: `max: 0` permits zero
 * unclassified files and trips at one, `max: 1` permits one and trips at
 * two. A `>=` here would make `max: 1` reject the very count it names.
 */
export function unclassifiedGateTripped(count: number, max: number | undefined): boolean {
  return max !== undefined && count > max;
}

function render(raw: unknown): string {
  if (typeof raw === "string") return JSON.stringify(raw);
  if (typeof raw === "symbol") return raw.toString();
  return String(raw);
}

/**
 * Validates the threshold value an adapter hands over, returning either the
 * accepted number or a ready-to-print error string.
 *
 * The parameter is `unknown` rather than `string` because of what yargs
 * actually delivers: the option is declared `type: "number"`, so
 * `--max-unclassified abc` reaches the handler **already coerced to the
 * number `NaN`** (`typeof` `"number"`), not as the string `"abc"`. A
 * signature typed `string` would therefore never see the failing case at
 * all. `unknown` also covers the MCP side, where the value arrives as
 * whatever the client put in the tool call's JSON.
 *
 * Rejects `NaN`, infinities, negatives, non-integers and any non-number;
 * accepts `0`, which is the meaningful "allow nothing" setting. The error
 * text names `--max-unclassified` so the CLI can print it verbatim.
 *
 * Note `undefined` is rejected, not treated as "gate off". Distinguishing an
 * absent flag from a present one is the caller's job, and it is genuinely
 * ambiguous on the CLI: yargs hands the handler `undefined` both when the
 * flag is omitted *and* when it is passed bare with no value, so a caller
 * that guards on `raw !== undefined` treats a bare flag as no flag. This
 * function only promises to validate a value that is present.
 */
export function parseMaxUnclassified(raw: unknown): { ok: number } | { error: string } {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    return {
      error: `--max-unclassified expects a non-negative integer, got: ${render(raw)}`,
    };
  }
  return { ok: raw };
}

/**
 * Renders the one-line failure message for a tripped gate.
 *
 * **Exactly one line, no newline characters.** It points at where the
 * offending paths already are instead of reprinting them: `computeDomainData`
 * emits one `Unclassified: <path>` line per file through its `log` callback
 * (stdout, under the CLI), and the generated `domain-index/index.md` lists
 * them all under its `## Unclassified Files` heading. Reprinting is not a
 * cosmetic concern — a real corpus project measured 1759 unclassified files,
 * so an exhaustive message would add 1759 lines to stderr and bury the
 * verdict it exists to deliver.
 */
export function formatUnclassifiedGateFailure(count: number, max: number): string {
  return (
    `[c3-domain-manager] Classification gate failed: ${count} unclassified file(s), ` +
    `--max-unclassified allows ${max}. The offending paths are listed as "Unclassified:" ` +
    `lines in this run's output, and under "## Unclassified Files" in the generated ` +
    `domain-index/index.md.`
  );
}
