import { describe, it } from "mocha";
import { assert } from "chai";
import { collectGlossary, findCollisions, formatGlossaryReport } from "../../src/domain/glossary.js";
import type { DomainConfig } from "../../src/domain/types.js";

function makeConfig(
  domains: DomainConfig["domains"],
  sharedSubdomains?: DomainConfig["sharedSubdomains"],
): DomainConfig {
  return { domains, sharedSubdomains };
}

describe("glossary", () => {
  describe("collectGlossary", () => {
    it("returns empty array when no domains have glossaries", () => {
      const config = makeConfig({
        Auth: { description: "Authentication" },
        Combat: { description: "Combat" },
      });
      assert.deepEqual(collectGlossary(config), []);
    });

    it("collects entries from domains", () => {
      const config = makeConfig({
        Auth: {
          description: "Authentication",
          glossary: { Hero: "A playable character" },
        },
        Combat: {
          description: "Combat",
          glossary: { Ability: "A combat skill" },
        },
      });
      const entries = collectGlossary(config);
      assert.equal(entries.length, 2);
      assert.deepEqual(entries[0], { term: "Hero", definition: "A playable character", domain: "Auth" });
      assert.deepEqual(entries[1], { term: "Ability", definition: "A combat skill", domain: "Combat" });
    });

    it("collects entries from sharedSubdomains", () => {
      const config = makeConfig(
        { Auth: { description: "Authentication" } },
        { Shared: { description: "Shared", glossary: { Token: "An auth token" } } },
      );
      const entries = collectGlossary(config);
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0], { term: "Token", definition: "An auth token", domain: "Shared" });
    });

    it("collects entries from both domains and sharedSubdomains", () => {
      const config = makeConfig(
        { Auth: { description: "Authentication", glossary: { Hero: "A playable character" } } },
        { Shared: { description: "Shared", glossary: { Token: "An auth token" } } },
      );
      const entries = collectGlossary(config);
      assert.equal(entries.length, 2);
    });
  });

  describe("findCollisions", () => {
    it("returns empty array when no entries", () => {
      assert.deepEqual(findCollisions([]), []);
    });

    it("returns empty array when all terms are unique", () => {
      const entries = [
        { term: "Hero", definition: "A playable character", domain: "Auth" },
        { term: "Ability", definition: "A combat skill", domain: "Combat" },
      ];
      assert.deepEqual(findCollisions(entries), []);
    });

    it("returns empty array when same term has same definition in two domains", () => {
      const entries = [
        { term: "Hero", definition: "A playable character", domain: "Auth" },
        { term: "Hero", definition: "A playable character", domain: "Combat" },
      ];
      assert.deepEqual(findCollisions(entries), []);
    });

    it("reports collision when same term has different definitions", () => {
      const entries = [
        { term: "Hero", definition: "A playable character", domain: "Auth" },
        { term: "Hero", definition: "A DC superhero", domain: "Combat" },
      ];
      const collisions = findCollisions(entries);
      assert.equal(collisions.length, 1);
      assert.equal(collisions[0].term, "Hero");
      assert.equal(collisions[0].entries.length, 2);
      assert.deepEqual(collisions[0].entries[0], { domain: "Auth", definition: "A playable character" });
      assert.deepEqual(collisions[0].entries[1], { domain: "Combat", definition: "A DC superhero" });
    });

    it("matches terms case-insensitively", () => {
      const entries = [
        { term: "Hero", definition: "A playable character", domain: "Auth" },
        { term: "hero", definition: "A DC superhero", domain: "Combat" },
      ];
      const collisions = findCollisions(entries);
      assert.equal(collisions.length, 1);
      assert.equal(collisions[0].term, "Hero"); // First occurrence's casing
    });

    it("does not report case-insensitive match with same definition", () => {
      const entries = [
        { term: "Hero", definition: "A playable character", domain: "Auth" },
        { term: "hero", definition: "A playable character", domain: "Combat" },
      ];
      assert.deepEqual(findCollisions(entries), []);
    });

    it("only reports terms that actually collide when multiple terms present", () => {
      const entries = [
        { term: "Hero", definition: "A playable character", domain: "Auth" },
        { term: "Hero", definition: "A DC superhero", domain: "Combat" },
        { term: "Ability", definition: "A combat skill", domain: "Combat" },
        { term: "Token", definition: "An auth token", domain: "Auth" },
        { term: "Token", definition: "An auth token", domain: "Shared" },
      ];
      const collisions = findCollisions(entries);
      assert.equal(collisions.length, 1);
      assert.equal(collisions[0].term, "Hero");
    });

    it("sorts collisions alphabetically by term", () => {
      const entries = [
        { term: "Zeal", definition: "Enthusiasm in combat", domain: "Combat" },
        { term: "Zeal", definition: "A combat stat", domain: "Stats" },
        { term: "Ability", definition: "A combat skill", domain: "Combat" },
        { term: "Ability", definition: "A power", domain: "Auth" },
      ];
      const collisions = findCollisions(entries);
      assert.equal(collisions.length, 2);
      assert.equal(collisions[0].term, "Ability");
      assert.equal(collisions[1].term, "Zeal");
    });
  });

  describe("formatGlossaryReport", () => {
    it("returns friendly message when no collisions", () => {
      assert.equal(formatGlossaryReport([]), "No glossary collisions found.");
    });

    it("includes collision count in header", () => {
      const collisions = [
        {
          term: "Hero",
          entries: [
            { domain: "Auth", definition: "A playable character" },
            { domain: "Combat", definition: "A DC superhero" },
          ],
        },
      ];
      const report = formatGlossaryReport(collisions);
      assert.include(report, "1 glossary collision(s) found:");
    });

    it("includes term name in output", () => {
      const collisions = [
        {
          term: "Hero",
          entries: [
            { domain: "Auth", definition: "A playable character" },
            { domain: "Combat", definition: "A DC superhero" },
          ],
        },
      ];
      const report = formatGlossaryReport(collisions);
      assert.include(report, "**Hero**");
    });

    it("includes domain names in output", () => {
      const collisions = [
        {
          term: "Hero",
          entries: [
            { domain: "Auth", definition: "A playable character" },
            { domain: "Combat", definition: "A DC superhero" },
          ],
        },
      ];
      const report = formatGlossaryReport(collisions);
      assert.include(report, "Auth");
      assert.include(report, "Combat");
    });

    it("includes all definitions in output", () => {
      const collisions = [
        {
          term: "Hero",
          entries: [
            { domain: "Auth", definition: "A playable character" },
            { domain: "Combat", definition: "A DC superhero" },
          ],
        },
      ];
      const report = formatGlossaryReport(collisions);
      assert.include(report, "A playable character");
      assert.include(report, "A DC superhero");
    });

    it("includes multiple collisions in output", () => {
      const collisions = [
        {
          term: "Ability",
          entries: [
            { domain: "Combat", definition: "A combat skill" },
            { domain: "Auth", definition: "A power" },
          ],
        },
        {
          term: "Hero",
          entries: [
            { domain: "Auth", definition: "A playable character" },
            { domain: "Combat", definition: "A DC superhero" },
          ],
        },
      ];
      const report = formatGlossaryReport(collisions);
      assert.include(report, "2 glossary collision(s) found:");
      assert.include(report, "**Ability**");
      assert.include(report, "**Hero**");
    });
  });
});
