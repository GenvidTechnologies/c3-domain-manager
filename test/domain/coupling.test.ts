import { describe, it } from "mocha";
import { assert } from "chai";
import { computeHubDomains, activeOutgoingKeys, inboundDiscounted } from "../../src/domain/coupling.js";
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
});
