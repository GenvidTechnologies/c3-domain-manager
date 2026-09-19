import { describe, it } from "mocha";
import { assert } from "chai";
import {
  UNCLASSIFIED_GATE_EXIT_CODE,
  unclassifiedGateTripped,
  parseMaxUnclassified,
  formatUnclassifiedGateFailure,
} from "../../src/adapters/unclassifiedGate.js";

/**
 * Pins the classification-coverage gate's rule (issue #81) while it is still
 * unwired: nothing in `src/` calls this module yet — the CLI flag and the MCP
 * tool parameter land in later commits — so this suite is the only thing
 * holding the threshold semantics, the exit code and the one-line message
 * shape. Each of those is a contract a CI consumer reads, not an internal
 * detail: an exit code that collapses onto 1, an off-by-one that turns an
 * allowance into a presence check, or a message that grows a newline all
 * change observable behaviour without changing any adapter.
 */

describe("unclassifiedGate", () => {
  describe("UNCLASSIFIED_GATE_EXIT_CODE", () => {
    it("is 2, distinct from the 1 this CLI already uses for a failed invocation", () => {
      assert.strictEqual(UNCLASSIFIED_GATE_EXIT_CODE, 2);
      assert.notStrictEqual(UNCLASSIFIED_GATE_EXIT_CODE, 1);
    });
  });

  describe("unclassifiedGateTripped", () => {
    it("never trips when max is undefined — an unrequested gate is off, at any count", () => {
      assert.strictEqual(unclassifiedGateTripped(0, undefined), false);
      assert.strictEqual(unclassifiedGateTripped(1, undefined), false);
      assert.strictEqual(unclassifiedGateTripped(1759, undefined), false);
    });

    it("does not trip at max 0 with a count of 0", () => {
      assert.strictEqual(unclassifiedGateTripped(0, 0), false);
    });

    it("trips at max 0 with a count of 1", () => {
      assert.strictEqual(unclassifiedGateTripped(1, 0), true);
    });

    // The row that proves `>` and not `>=`: max 1 names an allowance of one
    // unclassified file, so a count of exactly 1 must pass. A presence check
    // (or a `>=`) would fail this while passing every other row here.
    it("does not trip at max 1 with a count of 1 — max is a threshold, not a presence check", () => {
      assert.strictEqual(unclassifiedGateTripped(1, 1), false);
    });

    it("trips at max 1 with a count of 2", () => {
      assert.strictEqual(unclassifiedGateTripped(2, 1), true);
    });
  });

  describe("parseMaxUnclassified", () => {
    // Discharges the union for TypeScript, which cannot narrow from a chai
    // assertion; the `throw` is unreachable once the assert has passed.
    const errorOf = (result: { ok: number } | { error: string }): string => {
      assert.property(result, "error", "expected the value to be rejected");
      if (!("error" in result)) throw new Error("unreachable");
      return result.error;
    };

    // yargs declares the option `type: "number"`, so `--max-unclassified abc`
    // reaches the handler already coerced to the *number* NaN — this is the
    // real shape of the bad-input case, not a string.
    it("rejects NaN, the shape yargs' number coercion produces for a non-numeric argument", () => {
      assert.include(errorOf(parseMaxUnclassified(NaN)), "--max-unclassified");
    });

    it("rejects a negative threshold", () => {
      assert.include(errorOf(parseMaxUnclassified(-1)), "--max-unclassified");
    });

    it("rejects a non-integer threshold", () => {
      assert.include(errorOf(parseMaxUnclassified(1.5)), "--max-unclassified");
    });

    it("accepts 0 — the meaningful 'allow nothing' setting, not an absent value", () => {
      assert.deepStrictEqual(parseMaxUnclassified(0), { ok: 0 });
    });

    it("accepts a positive integer", () => {
      assert.deepStrictEqual(parseMaxUnclassified(12), { ok: 12 });
    });
  });

  describe("formatUnclassifiedGateFailure", () => {
    const msg = formatUnclassifiedGateFailure(1759, 0);

    it("starts with the [c3-domain-manager] prefix the CLI's other warnings use", () => {
      assert.isTrue(msg.startsWith("[c3-domain-manager] "), `message was: ${msg}`);
    });

    it("names the failure", () => {
      assert.include(msg, "Classification gate failed:");
    });

    it("names both the count and the threshold", () => {
      assert.include(msg, "1759");
      assert.include(msg, "0");
    });

    // The one-line property is the point: it keeps a CI failure readable, and
    // it is what stops the message from reprinting the offending paths — which
    // `computeDomainData` already logged, 1759 of them in the measured case.
    it("contains no newline character", () => {
      assert.notInclude(msg, "\n");
      assert.notInclude(msg, "\r");
    });

    it("says where the offending paths can be found, without reprinting them", () => {
      assert.include(msg, "Unclassified:");
      assert.include(msg, "## Unclassified Files");
    });
  });
});
