import { describe, it } from "mocha";
import { assert } from "chai";
import { isSectionSourceName } from "../../src/domain/classification.js";

describe("isSectionSourceName", () => {
  it("admits .json files", () => {
    assert.isTrue(isSectionSourceName("a.json"));
  });

  it("rejects .ts files", () => {
    assert.isFalse(isSectionSourceName("a.ts"));
  });

  it("rejects .md files", () => {
    assert.isFalse(isSectionSourceName("README.md"));
  });

  it("rejects extensionless names", () => {
    assert.isFalse(isSectionSourceName("README"));
  });
});
