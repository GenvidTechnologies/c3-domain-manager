import { describe, it } from "mocha";
import { assert } from "chai";
import { computeHubDomains, activeOutgoingKeys, inboundDiscounted } from "../../src/domain/coupling.js";
import { computeHealth } from "../../src/domain/health.js";
import { validateBoundaries } from "../../src/domain/relationships.js";
import { generateContextMap } from "../../src/domain/contextMap.js";
import { formatDomainIndex, formatDomainPage } from "../../src/domain/formatting.js";
import type { DomainConfig, DomainData } from "../../src/domain/types.js";

function makeDomain(name: string, isSharedSubdomain?: boolean): DomainData {
  return {
    name,
    description: "",
    eventSheets: [],
    layouts: [],
    scripts: [],
    functions: [],
    includesFrom: new Map(),
    includedBy: new Map(),
    referencesFrom: new Map(),
    referencedBy: new Map(),
    expressionRefsFrom: new Map(),
    expressionRefsBy: new Map(),
    addons: [],
    isSharedSubdomain,
  };
}

function makeDomainOpts(name: string, opts?: Partial<DomainData>): DomainData {
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
    expressionRefsFrom: opts?.expressionRefsFrom ?? new Map(),
    expressionRefsBy: opts?.expressionRefsBy ?? new Map(),
    addons: opts?.addons ?? [],
    strategy: opts?.strategy,
    isSharedSubdomain: opts?.isSharedSubdomain,
  };
}

describe("coupling", () => {
  describe("computeHubDomains", () => {
    it("returns an empty set when config.coupling is absent", () => {
      const domains = [makeDomain("A"), makeDomain("B", true)];
      const config: DomainConfig = { domains: {} };
      const hubs = computeHubDomains(domains, config);
      assert.equal(hubs.size, 0);
    });

    it("returns exactly the shared-subdomain names when discountSharedKernel is true", () => {
      const domains = [makeDomain("A"), makeDomain("Kernel1", true), makeDomain("B"), makeDomain("Kernel2", true)];
      const config: DomainConfig = { domains: {}, coupling: { discountSharedKernel: true } };
      const hubs = computeHubDomains(domains, config);
      assert.deepEqual([...hubs].sort(), ["Kernel1", "Kernel2"]);
    });

    it("returns exactly the explicit hubDomains when discountSharedKernel is false/absent", () => {
      const domains = [makeDomain("A"), makeDomain("Kernel1", true)];
      const config: DomainConfig = { domains: {}, coupling: { hubDomains: ["X", "Y"] } };
      const hubs = computeHubDomains(domains, config);
      assert.deepEqual([...hubs].sort(), ["X", "Y"]);
    });

    it("unions shared-subdomain names and explicit hubDomains, deduped", () => {
      const domains = [makeDomain("Kernel1", true), makeDomain("Kernel2", true), makeDomain("A")];
      const config: DomainConfig = {
        domains: {},
        coupling: { discountSharedKernel: true, hubDomains: ["Kernel2", "Z"] },
      };
      const hubs = computeHubDomains(domains, config);
      assert.deepEqual([...hubs].sort(), ["Kernel1", "Kernel2", "Z"]);
    });
  });

  describe("activeOutgoingKeys", () => {
    it("returns all keys when the hub set is empty", () => {
      const keys = activeOutgoingKeys(["A", "B", "C"], new Set());
      assert.deepEqual(keys, ["A", "B", "C"]);
    });

    it("filters out keys that are in the hub set (array input)", () => {
      const keys = activeOutgoingKeys(["A", "B", "C"], new Set(["B"]));
      assert.deepEqual(keys, ["A", "C"]);
    });

    it("accepts a Map keys() iterator", () => {
      const map = new Map([
        ["A", 1],
        ["B", 2],
        ["C", 3],
      ]);
      const keys = activeOutgoingKeys(map.keys(), new Set(["A"]));
      assert.deepEqual(keys, ["B", "C"]);
    });
  });

  describe("inboundDiscounted", () => {
    it("returns true when name is in hubs", () => {
      assert.isTrue(inboundDiscounted("A", new Set(["A", "B"])));
    });

    it("returns false when name is not in hubs", () => {
      assert.isFalse(inboundDiscounted("C", new Set(["A", "B"])));
    });

    it("returns false for an empty hub set", () => {
      assert.isFalse(inboundDiscounted("A", new Set()));
    });
  });

  describe("cross-consumer consistency (issue #30 hub discount, R3 + forbidden-asymmetry)", () => {
    // Shared fixture: Core is a shared-kernel hub (core strategy + isSharedSubdomain,
    // discounted via config.coupling.discountSharedKernel). Feature is a supporting
    // domain with an OBSERVED (includesFrom) edge to Core, and no declared relationship
    // between them — so the undeclared-vs-forbidden asymmetry is exercised on the same edge.
    const core = makeDomainOpts("Core", {
      strategy: "core",
      isSharedSubdomain: true,
      includedBy: new Map([["Feature", ["Core/Sheet.json"]]]),
    });
    const feature = makeDomainOpts("Feature", {
      strategy: "supporting",
      includesFrom: new Map([["Core", ["Core/Sheet.json"]]]),
    });
    const domains = [core, feature];
    const config: DomainConfig = { domains: {}, coupling: { discountSharedKernel: true } };
    const hubs = computeHubDomains(domains, config);

    it("computeHubDomains treats Core as a hub", () => {
      assert.deepEqual([...hubs], ["Core"]);
    });

    it("computeHealth: Core's inbound coupling is discounted (ca=0)", () => {
      const metrics = computeHealth(core, hubs);
      assert.equal(metrics.ca, 0);
    });

    it("generateContextMap: omits the observed Feature→Core edge and drops Core from Feature's 1-hop neighbors", () => {
      const fullText = generateContextMap(domains, config, { format: "text", includeObserved: true });
      assert.notInclude(fullText, "[observed]");
      assert.notInclude(fullText, "→ Core");

      const focusedText = generateContextMap(domains, config, { format: "text", domain: "Feature" });
      assert.include(focusedText, "Feature");
      assert.notInclude(focusedText, "Core");
    });

    it("formatDomainIndex: Feature's Dependencies column omits Core", () => {
      const index = formatDomainIndex(domains, [], hubs);
      const featureRow = index.split("\n").find((line) => line.includes("[Feature]"));
      assert.isDefined(featureRow);
      assert.notInclude(featureRow!, "Core");
    });

    it("formatDomainPage: Feature's page still lists Core but tags it (shared kernel)", () => {
      const page = formatDomainPage(feature, hubs);
      assert.include(page, "→ Core");
      assert.include(page, "(shared kernel)");
    });

    it("validateBoundaries: no undeclared violation for Feature→Core, but a forbidden violation fires", () => {
      const report = validateBoundaries(domains, config);
      const undeclared = report.violations.filter((v) => v.type === "undeclared" && v.from === "Feature" && v.to === "Core");
      const forbidden = report.violations.filter((v) => v.type === "forbidden" && v.from === "Feature" && v.to === "Core");
      assert.equal(undeclared.length, 0);
      assert.equal(forbidden.length, 1);
    });
  });
});
