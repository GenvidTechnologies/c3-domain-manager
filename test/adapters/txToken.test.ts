import { describe, it } from "mocha";
import { assert } from "chai";
import { formatTxToken, parseTxToken, compareTxToken, isValidProjectId, type TxTokenParseResult, type TxTokenParseFailure } from "@genvidtech/mcp-utils";

/**
 * Pins the `<projectId>:<n>` wire format this repo publishes (README.md's
 * `txId` documentation; `server.ts` mints and compares every `txId` through
 * `formatTxToken`/`compareTxToken`; `mcpHarness.ts`'s `matchTxTokenLine`
 * parses it independently — see issue #77 row X7). The codec itself now
 * lives upstream in `@genvidtech/mcp-utils`, so nothing else in this repo
 * exercises the format directly: without this suite, an upstream minor that
 * changed the delimiter or relaxed the counter's validation would first
 * surface at a client holding an incompatible token, not here. This is
 * asserting *our* contract, not re-testing someone else's library — the
 * codec's implementation happening to live in a dependency doesn't change
 * whose format it is.
 *
 * Since mcp-utils 0.10.0, `parseTxToken` answers with a discriminated result
 * — `{ ok: true, projectId, n }` on success, `{ ok: false, reason }` on
 * rejection — where it used to answer with the parsed pair `| null`. So each
 * rejection below pins its specific `reason`, not merely the fact of
 * rejection. That is the same contract argument one level down: this server
 * renders those reasons into the user-visible error a rejected `txId`
 * produces, so an upstream relabel — `"alpha:03"` moving from
 * `invalid-counter-shape` to `counter-out-of-range`, say — would change this
 * server's output, not just an internal enum of someone else's.
 */

describe("txToken codec (@genvidtech/mcp-utils)", () => {
  describe("formatTxToken", () => {
    it("formats <projectId>:<n>, byte-exact — the delimiter is the contract", () => {
      assert.strictEqual(formatTxToken("alpha", 3), "alpha:3");
    });

    it("accepts a zero counter", () => {
      assert.strictEqual(formatTxToken("alpha", 0), "alpha:0");
    });

    it("throws on a projectId containing the delimiter", () => {
      assert.throws(() => formatTxToken("a:b", 1), TypeError);
    });

    it("throws on a negative counter", () => {
      assert.throws(() => formatTxToken("alpha", -1), TypeError);
    });

    it("throws on a non-safe-integer counter", () => {
      assert.throws(() => formatTxToken("alpha", Number.MAX_SAFE_INTEGER + 1), TypeError);
    });
  });

  describe("parseTxToken", () => {
    // Asserts the rejection arm and hands back its `reason`. `assert.isFalse`
    // already throws on a success arm, so the `throw` is unreachable at
    // runtime — it is there to discharge the union for TypeScript, which
    // cannot narrow from a chai assertion.
    const failureReason = (result: TxTokenParseResult): TxTokenParseFailure => {
      assert.isFalse(result.ok, "expected the token to be rejected");
      if (result.ok) throw new Error("unreachable");
      return result.reason;
    };

    it("parses a well-formed token into the { ok: true, projectId, n } arm", () => {
      assert.deepStrictEqual(parseTxToken("alpha:3"), { ok: true, projectId: "alpha", n: 3 });
    });

    it("rejects malformed input as `no-separator`, and does not throw", () => {
      assert.strictEqual(failureReason(parseTxToken("garbage")), "no-separator");
    });

    it("rejects non-string input as `not-a-string`, and does not throw", () => {
      // Cast past the type system: a stale-write guard must survive a
      // client that ignores the wire type, not just a well-typed caller.
      assert.strictEqual(failureReason(parseTxToken(undefined as unknown as string)), "not-a-string");
    });

    it("rejects a token with more than one delimiter as `invalid-counter-shape` (ids cannot contain ':', so the shape is unambiguous)", () => {
      assert.strictEqual(failureReason(parseTxToken("a:b:c")), "invalid-counter-shape");
    });

    it("rejects a non-canonical counter with a leading zero as `invalid-counter-shape`", () => {
      assert.strictEqual(failureReason(parseTxToken("alpha:03")), "invalid-counter-shape");
    });
  });

  describe("compareTxToken", () => {
    it("returns false on a projectId/n mismatch", () => {
      assert.strictEqual(compareTxToken("alpha:3", "beta", 3), false);
    });

    it("returns true on a matching token", () => {
      assert.strictEqual(compareTxToken("alpha:3", "alpha", 3), true);
    });

    it("returns false, not a throw, when the token itself is malformed — a stale-write guard must reject it, not crash", () => {
      assert.strictEqual(compareTxToken("garbage", "alpha", 3), false);
    });
  });

  describe("isValidProjectId", () => {
    it("rejects the empty string", () => {
      assert.strictEqual(isValidProjectId(""), false);
    });

    it("rejects an id containing whitespace", () => {
      assert.strictEqual(isValidProjectId("a b"), false);
    });

    it("rejects an id containing the delimiter", () => {
      assert.strictEqual(isValidProjectId("a:b"), false);
    });
  });
});
