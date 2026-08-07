import { describe, it } from "mocha";
import { assert } from "chai";
import { isScriptSourceName, isCompiledSibling } from "../../src/domain/classification.js";

describe("isScriptSourceName", () => {
  it("admits .ts files", () => {
    assert.isTrue(isScriptSourceName("a.ts"));
  });

  it("admits .js files", () => {
    assert.isTrue(isScriptSourceName("a.js"));
  });

  it("rejects .json files", () => {
    assert.isFalse(isScriptSourceName("a.json"));
  });

  it("rejects non-script files", () => {
    assert.isFalse(isScriptSourceName("README.md"));
  });

  it("admits .d.ts files (it ends in .ts)", () => {
    assert.isTrue(isScriptSourceName("Player.d.ts"));
  });
});

describe("isCompiledSibling", () => {
  it("suppresses a .js with a same-basename .ts sibling", () => {
    assert.isTrue(isCompiledSibling("a.js", new Set(["a.ts"])));
  });

  it("does not suppress a .js without a matching .ts sibling — clause 1 is per-directory", () => {
    assert.isFalse(isCompiledSibling("a.js", new Set(["b.ts"])));
  });

  it("does not treat a .d.ts as a suppressor", () => {
    assert.isFalse(isCompiledSibling("Player.js", new Set(["Player.d.ts"])));
  });

  it("never suppresses a .ts file", () => {
    assert.isFalse(isCompiledSibling("a.ts", new Set(["a.ts", "a.js"])));
  });
});
