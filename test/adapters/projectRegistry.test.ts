import { describe, it } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import { ProjectRegistry } from "../../src/adapters/projectRegistry.js";
import { isMcpError } from "@genvidtech/mcp-utils";

// Duck-typed values, deliberately never constructed through ProjectContext:
// the point of this suite is that ProjectRegistry<T> is agnostic to what T
// is, so registering plain object literals is what proves the registry
// itself carries no filesystem dependency.
const alpha = { label: "alpha-project" };
const beta = { label: "beta-project" };

describe("ProjectRegistry", () => {
  describe("single registration", () => {
    const registry = new ProjectRegistry(new Map([["alpha", alpha]]));

    it("resolve(undefined) at size 1 returns the sole value", () => {
      assert.strictEqual(registry.resolve(undefined), alpha);
    });

    it("resolve('alpha') returns the alpha value", () => {
      assert.strictEqual(registry.resolve("alpha"), alpha);
    });

    for (const selector of ["../other", "C:/tmp", "./x"]) {
      it(`resolve(${JSON.stringify(selector)}) — a path-shaped selector is never an id — returns an mcp error naming known ids`, () => {
        const result = registry.resolve(selector);
        assert.isTrue(isMcpError(result));
        const text = JSON.stringify(result);
        assert.include(text, "alpha");
      });
    }
  });

  describe("multiple registrations", () => {
    const registry = new ProjectRegistry(
      new Map([
        ["alpha", alpha],
        ["beta", beta],
      ]),
    );

    it("resolve(undefined) at size 2 returns an mcp error naming both ids", () => {
      const result = registry.resolve(undefined);
      assert.isTrue(isMcpError(result));
      const text = JSON.stringify(result);
      assert.include(text, "alpha");
      assert.include(text, "beta");
    });

    it("resolve('alpha') still returns the alpha value", () => {
      assert.strictEqual(registry.resolve("alpha"), alpha);
    });

    it("resolve('beta') returns the beta value", () => {
      assert.strictEqual(registry.resolve("beta"), beta);
    });

    it("resolve('unknown-id') returns an mcp error naming both known ids (same enumerating path as omitted id)", () => {
      const result = registry.resolve("unknown-id");
      assert.isTrue(isMcpError(result));
      const text = JSON.stringify(result);
      assert.include(text, "alpha");
      assert.include(text, "beta");
    });
  });

  describe("ids()", () => {
    it("returns registered ids in insertion order", () => {
      const registry = new ProjectRegistry(
        new Map([
          ["alpha", alpha],
          ["beta", beta],
        ]),
      );
      assert.deepEqual(registry.ids(), ["alpha", "beta"]);
    });
  });

  describe("structural companion — no filesystem-shaped runtime import", () => {
    it("imports no node:path, node:fs, or c3source at the top level", () => {
      // Anchored on the import *position* (line start), not a bare token
      // count: the module's JSDoc deliberately names all three forbidden
      // imports to document their absence, so counting occurrences of the
      // bare strings anywhere in the file would report a false failure
      // against a correct implementation (the doc comment itself contains
      // the tokens). Anchoring the regex to `^import ` only matches actual
      // import statements.
      const source = fs.readFileSync(
        new URL("../../src/adapters/projectRegistry.ts", import.meta.url),
        "utf8",
      );
      const forbidden = /^import .*(node:path|node:fs|c3source)/m;
      const matches = source.match(new RegExp(forbidden, "gm")) ?? [];
      assert.equal(matches.length, 0);
    });
  });
});
