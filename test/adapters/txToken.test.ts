import { describe, it } from "mocha";
import { assert } from "chai";
import { formatTxToken, parseTxToken, compareTxToken, isValidProjectId } from "@genvidtech/mcp-utils";

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
    it("parses a well-formed token into { projectId, n }", () => {
      assert.deepStrictEqual(parseTxToken("alpha:3"), { projectId: "alpha", n: 3 });
    });

    it("returns null, and does not throw, on malformed input", () => {
      assert.strictEqual(parseTxToken("garbage"), null);
    });

    it("returns null on non-string input, and does not throw", () => {
      // Cast past the type system: a stale-write guard must survive a
      // client that ignores the wire type, not just a well-typed caller.
      assert.strictEqual(parseTxToken(undefined as unknown as string), null);
    });

    it("returns null on a token with more than one delimiter (ids cannot contain ':', so the shape is unambiguous)", () => {
      assert.strictEqual(parseTxToken("a:b:c"), null);
    });

    it("returns null on a non-canonical counter with a leading zero", () => {
      assert.strictEqual(parseTxToken("alpha:03"), null);
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
