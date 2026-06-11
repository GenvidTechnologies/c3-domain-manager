import { describe, it } from "mocha";
import { assert } from "chai";
import { computeHealth, formatHealthReport } from "../../src/domain/health.js";
import type { DomainData } from "../../src/domain/types.js";

function makeDomain(name: string, opts?: Partial<DomainData>): DomainData {
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
  };
}

describe("health", () => {
  describe("computeHealth", () => {
    it("returns Ca=0, Ce=0, Instability=0 for domain with no dependencies", () => {
      const domain = makeDomain("Empty");
      const metrics = computeHealth(domain);
      assert.equal(metrics.ca, 0);
      assert.equal(metrics.ce, 0);
      assert.equal(metrics.instability, 0);
    });

    it("returns Ca=3, Ce=0, Instability=0 for domain with 3 incoming and 0 outgoing", () => {
      const domain = makeDomain("Stable", {
        includedBy: new Map([
          ["DomainA", ["sheet1"]],
          ["DomainB", ["sheet2"]],
          ["DomainC", ["sheet3"]],
        ]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ca, 3);
      assert.equal(metrics.ce, 0);
      assert.equal(metrics.instability, 0);
    });

    it("returns Ca=0, Ce=2, Instability=1 for domain with 0 incoming and 2 outgoing", () => {
      const domain = makeDomain("Unstable", {
        includesFrom: new Map([
          ["DomainA", ["sheet1"]],
          ["DomainB", ["sheet2"]],
        ]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ca, 0);
      assert.equal(metrics.ce, 2);
      assert.equal(metrics.instability, 1);
    });

    it("returns Instability=0.6 for domain with Ca=2 and Ce=3", () => {
      const domain = makeDomain("Mixed", {
        includedBy: new Map([
          ["DomainA", ["sheet1"]],
          ["DomainB", ["sheet2"]],
        ]),
        includesFrom: new Map([
          ["DomainC", ["sheet3"]],
          ["DomainD", ["sheet4"]],
          ["DomainE", ["sheet5"]],
        ]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ca, 2);
      assert.equal(metrics.ce, 3);
      assert.approximately(metrics.instability, 0.6, 0.001);
    });

    it("returns coverage=1 for domain with eventSheets", () => {
      const domain = makeDomain("WithFiles", {
        eventSheets: [{ path: "eventSheets/Foo.json", directory: "eventSheets" }],
      });
      assert.equal(computeHealth(domain).coverage, 1);
    });

    it("returns coverage=1 for domain with layouts", () => {
      const domain = makeDomain("WithLayouts", {
        layouts: [{ path: "layouts/Foo.json", eventSheet: "Foo", eventSheetDomain: "WithLayouts" }],
      });
      assert.equal(computeHealth(domain).coverage, 1);
    });

    it("returns coverage=1 for domain with scripts", () => {
      const domain = makeDomain("WithScripts", {
        scripts: [{ path: "scripts/foo.ts", isDirectory: false }],
      });
      assert.equal(computeHealth(domain).coverage, 1);
    });

    it("returns coverage=0 for domain with no files", () => {
      const domain = makeDomain("NoFiles");
      assert.equal(computeHealth(domain).coverage, 0);
    });

    it("reference-only Ce=1 when referencesFrom has one entry and includesFrom is empty", () => {
      const domain = makeDomain("RefOnly", {
        referencesFrom: new Map([["B", ["score"]]]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ce, 1);
      assert.equal(metrics.ca, 0);
    });

    it("reference-only Ca=1 when referencedBy has one entry and includedBy is empty", () => {
      const domain = makeDomain("RefOnlyCa", {
        referencedBy: new Map([["A", ["x"]]]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ca, 1);
      assert.equal(metrics.ce, 0);
    });

    it("union dedup: Ce=1 when domain both includesFrom B and referencesFrom B", () => {
      const domain = makeDomain("Overlap", {
        includesFrom: new Map([["B", ["sheet1"]]]),
        referencesFrom: new Map([["B", ["score"]]]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ce, 1);
    });

    it("disjoint union: Ce=2 when includesFrom B and referencesFrom C", () => {
      const domain = makeDomain("Disjoint", {
        includesFrom: new Map([["B", ["sheet1"]]]),
        referencesFrom: new Map([["C", ["health"]]]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ce, 2);
    });

    it("instability reflects union-based ce/ca: Ce=2 Ca=1 yields Instability=2/3", () => {
      // include-only would give Ce=1; adding a ref to a new domain bumps Ce to 2
      const domain = makeDomain("UnionInstability", {
        includesFrom: new Map([["B", ["sheet1"]]]),
        referencesFrom: new Map([["C", ["score"]]]),
        referencedBy: new Map([["A", ["x"]]]),
      });
      const metrics = computeHealth(domain);
      assert.equal(metrics.ce, 2);
      assert.equal(metrics.ca, 1);
      assert.approximately(metrics.instability, 2 / 3, 0.001);
    });
  });

  describe("formatHealthReport", () => {
    it("returns friendly message for empty array", () => {
      assert.equal(formatHealthReport([]), "No domains to report on.");
    });

    it("returns table with header and one row for a single domain", () => {
      const results = [{ name: "Auth", ca: 2, ce: 1, instability: 0.33, coverage: 1 }];
      const report = formatHealthReport(results);
      assert.include(report, "| Domain | Ca | Ce | Instability | Coverage |");
      assert.include(report, "| --- | --- | --- | --- | --- |");
      assert.include(report, "| Auth |");
    });

    it("formats instability to 2 decimal places", () => {
      const results = [{ name: "Auth", ca: 2, ce: 3, instability: 0.6, coverage: 1 }];
      const report = formatHealthReport(results);
      assert.include(report, "0.60");
    });

    it("sorts domains alphabetically in output", () => {
      const results = [
        { name: "Zeal", ca: 0, ce: 0, instability: 0, coverage: 1 },
        { name: "Auth", ca: 0, ce: 0, instability: 0, coverage: 1 },
        { name: "Combat", ca: 0, ce: 0, instability: 0, coverage: 0 },
      ];
      const report = formatHealthReport(results);
      const authIndex = report.indexOf("| Auth |");
      const combatIndex = report.indexOf("| Combat |");
      const zealIndex = report.indexOf("| Zeal |");
      assert.isTrue(authIndex < combatIndex, "Auth should come before Combat");
      assert.isTrue(combatIndex < zealIndex, "Combat should come before Zeal");
    });

    it("includes all domains in the table", () => {
      const results = [
        { name: "Auth", ca: 1, ce: 0, instability: 0, coverage: 1 },
        { name: "Combat", ca: 0, ce: 1, instability: 1, coverage: 1 },
      ];
      const report = formatHealthReport(results);
      assert.include(report, "| Auth |");
      assert.include(report, "| Combat |");
    });
  });
});
