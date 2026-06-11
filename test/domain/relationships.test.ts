import { describe, it } from "mocha";
import { assert } from "chai";
import { validateBoundaries, formatBoundaryReport } from "../../src/domain/relationships.js";
import type { DomainData, DomainConfig } from "../../src/domain/types.js";

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
    strategy: opts?.strategy,
  };
}

function makeConfig(relationships?: DomainConfig["relationships"]): DomainConfig {
  return { domains: {}, relationships };
}

describe("relationships", () => {
  describe("validateBoundaries", () => {
    it("no relationships config, no cross-domain includes → no violations", () => {
      const domains = [makeDomain("Auth"), makeDomain("Combat")];
      const config = makeConfig();
      const report = validateBoundaries(domains, config);
      assert.deepEqual(report.violations, []);
    });

    it("no cross-domain includes, relationships declared → no violations", () => {
      const domains = [makeDomain("Auth"), makeDomain("Combat")];
      const config = makeConfig([{ from: "Combat", to: "Auth", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.deepEqual(report.violations, []);
    });

    it("domain A includes domain B, no relationship declared → undeclared violation", () => {
      const domains = [
        makeDomain("Auth", { includesFrom: new Map([["Combat", ["Combat/Sheet.json"]]]) }),
        makeDomain("Combat"),
      ];
      const config = makeConfig();
      const report = validateBoundaries(domains, config);
      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].type, "undeclared");
      assert.include(report.violations[0].message, "Auth");
      assert.include(report.violations[0].message, "Combat");
    });

    it("domain A includes domain B, relationship {from: B, to: A} exists → no violation", () => {
      const domains = [
        makeDomain("Auth", { includesFrom: new Map([["Combat", ["Combat/Sheet.json"]]]) }),
        makeDomain("Combat"),
      ];
      // B is supplier (from), A is customer (to)
      const config = makeConfig([{ from: "Combat", to: "Auth", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.deepEqual(report.violations, []);
    });

    it("domain A includes domain B, relationship {from: A, to: B} exists → no violation", () => {
      const domains = [
        makeDomain("Auth", { includesFrom: new Map([["Combat", ["Combat/Sheet.json"]]]) }),
        makeDomain("Combat"),
      ];
      // check both directions
      const config = makeConfig([{ from: "Auth", to: "Combat", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.deepEqual(report.violations, []);
    });

    it("stale relationship references non-existent domain → stale violation", () => {
      const domains = [makeDomain("Auth"), makeDomain("Combat")];
      const config = makeConfig([{ from: "Auth", to: "NonExistent", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].type, "stale");
      assert.include(report.violations[0].message, "NonExistent");
    });

    it("stale relationship where both domains are non-existent → stale violation", () => {
      const domains = [makeDomain("Auth")];
      const config = makeConfig([{ from: "Missing1", to: "Missing2", type: "shared-kernel" }]);
      const report = validateBoundaries(domains, config);
      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].type, "stale");
    });

    it("supporting domain includes core domain → forbidden violation", () => {
      const domains = [
        makeDomain("Support", {
          strategy: "supporting",
          includesFrom: new Map([["Core", ["Core/Sheet.json"]]]),
        }),
        makeDomain("Core", { strategy: "core" }),
      ];
      const config = makeConfig([{ from: "Core", to: "Support", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].type, "forbidden");
      assert.include(report.violations[0].message, "Support");
      assert.include(report.violations[0].message, "Core");
    });

    it("generic domain includes core domain → forbidden violation", () => {
      const domains = [
        makeDomain("Generic", {
          strategy: "generic",
          includesFrom: new Map([["Core", ["Core/Sheet.json"]]]),
        }),
        makeDomain("Core", { strategy: "core" }),
      ];
      const config = makeConfig([{ from: "Core", to: "Generic", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].type, "forbidden");
    });

    it("core domain includes supporting domain → NOT forbidden", () => {
      const domains = [
        makeDomain("Core", {
          strategy: "core",
          includesFrom: new Map([["Support", ["Support/Sheet.json"]]]),
        }),
        makeDomain("Support", { strategy: "supporting" }),
      ];
      const config = makeConfig([{ from: "Support", to: "Core", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      const forbidden = report.violations.filter((v) => v.type === "forbidden");
      assert.deepEqual(forbidden, []);
    });

    it("reference edge to undeclared domain → undeclared violation", () => {
      const domains = [makeDomain("A", { referencesFrom: new Map([["B", ["score"]]]) }), makeDomain("B")];
      const config = makeConfig();
      const report = validateBoundaries(domains, config);
      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].type, "undeclared");
      assert.equal(report.violations[0].from, "A");
      assert.equal(report.violations[0].to, "B");
    });

    it("reference edge covered by a declared relationship → no violation", () => {
      const domains = [makeDomain("A", { referencesFrom: new Map([["B", ["score"]]]) }), makeDomain("B")];
      const config = makeConfig([{ from: "A", to: "B", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.deepEqual(report.violations, []);
    });

    it("include + reference to same target → single undeclared violation", () => {
      const domains = [
        makeDomain("A", {
          includesFrom: new Map([["B", ["B/Sheet.json"]]]),
          referencesFrom: new Map([["B", ["score"]]]),
        }),
        makeDomain("B"),
      ];
      const config = makeConfig();
      const report = validateBoundaries(domains, config);
      const undeclared = report.violations.filter((v) => v.type === "undeclared");
      assert.equal(undeclared.length, 1);
      assert.equal(undeclared[0].from, "A");
      assert.equal(undeclared[0].to, "B");
    });

    it("supporting domain references core domain via reference edge → forbidden violation", () => {
      const domains = [
        makeDomain("Support", {
          strategy: "supporting",
          referencesFrom: new Map([["Core", ["health"]]]),
        }),
        makeDomain("Core", { strategy: "core" }),
      ];
      const config = makeConfig([{ from: "Core", to: "Support", type: "customer-supplier" }]);
      const report = validateBoundaries(domains, config);
      assert.equal(report.violations.length, 1);
      assert.equal(report.violations[0].type, "forbidden");
      assert.include(report.violations[0].message, "Support");
      assert.include(report.violations[0].message, "Core");
    });

    it("filterDomain returns only that domain's violations", () => {
      const domains = [
        makeDomain("Auth", { includesFrom: new Map([["Combat", ["Combat/Sheet.json"]]]) }),
        makeDomain("Combat", { includesFrom: new Map([["Auth", ["Auth/Sheet.json"]]]) }),
        makeDomain("Inventory"),
      ];
      const config = makeConfig();
      const report = validateBoundaries(domains, config, "Auth");
      assert.ok(report.violations.length > 0);
      for (const v of report.violations) {
        const involvesDomain = v.from === "Auth" || v.to === "Auth";
        assert.isTrue(involvesDomain, `Violation should involve Auth: ${v.message}`);
      }
    });

    it("filterDomain excludes violations from other domains", () => {
      const domains = [
        makeDomain("Auth", { includesFrom: new Map([["Combat", ["Combat/Sheet.json"]]]) }),
        makeDomain("Combat"),
        makeDomain("Inventory"),
      ];
      const config = makeConfig();
      const authReport = validateBoundaries(domains, config, "Auth");
      const inventoryReport = validateBoundaries(domains, config, "Inventory");
      // Auth has an undeclared dep on Combat, so Auth filter returns that
      assert.equal(authReport.violations.length, 1);
      // Inventory has no cross-domain includes, so no violations
      assert.equal(inventoryReport.violations.length, 0);
    });
  });

  describe("formatBoundaryReport", () => {
    it("no violations → 'No boundary violations found.'", () => {
      const result = formatBoundaryReport({ violations: [] });
      assert.equal(result, "No boundary violations found.");
    });

    it("includes violation count in header when violations exist", () => {
      const report = {
        violations: [
          {
            type: "undeclared" as const,
            message: "Auth depends on Combat but no relationship declared",
            from: "Auth",
            to: "Combat",
          },
        ],
      };
      const text = formatBoundaryReport(report);
      assert.include(text, "1");
      assert.include(text, "violation");
    });

    it("includes violation type and message in output", () => {
      const report = {
        violations: [
          {
            type: "undeclared" as const,
            message: "Auth depends on Combat but no relationship declared",
            from: "Auth",
            to: "Combat",
          },
          { type: "stale" as const, message: "Relationship references unknown domain: Ghost" },
          {
            type: "forbidden" as const,
            message: "Supporting domain 'Support' depends on core domain 'Core'",
            from: "Support",
            to: "Core",
          },
        ],
      };
      const text = formatBoundaryReport(report);
      assert.include(text, "undeclared");
      assert.include(text, "stale");
      assert.include(text, "forbidden");
      assert.include(text, "Auth depends on Combat");
      assert.include(text, "Ghost");
      assert.include(text, "Support");
    });
  });
});
