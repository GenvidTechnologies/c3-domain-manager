import { describe, it } from "mocha";
import { assert } from "chai";
import { formatDomainIndex, formatDomainPage, formatDomainConfig } from "../../src/domain/formatting.js";
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
    strategy: opts?.strategy,
  };
}

describe("formatting — strategy classification", () => {
  describe("formatDomainIndex — backward compat (no strategy)", () => {
    it("shows single ## Domains header when no domains have strategy", () => {
      const domains = [
        makeDomain("Alpha", { description: "Alpha domain" }),
        makeDomain("Beta", { description: "Beta domain" }),
      ];
      const result = formatDomainIndex(domains, []);
      assert.include(result, "## Domains");
      // Should NOT show grouped subsections
      assert.notInclude(result, "### Core Domains");
      assert.notInclude(result, "### Supporting Domains");
      assert.notInclude(result, "### Generic Domains");
      assert.notInclude(result, "### Unclassified Domains");
    });
  });

  describe("formatDomainIndex — grouped by strategy", () => {
    it("shows grouped subsections when at least one domain has strategy", () => {
      const domains = [
        makeDomain("CoreDomain", { description: "Core stuff", strategy: "core" }),
        makeDomain("SupportDomain", { description: "Support stuff", strategy: "supporting" }),
        makeDomain("GenericDomain", { description: "Generic stuff", strategy: "generic" }),
        makeDomain("UnclassifiedDomain", { description: "No strategy" }),
      ];
      const result = formatDomainIndex(domains, []);
      assert.include(result, "## Domains");
      assert.include(result, "### Core Domains");
      assert.include(result, "### Supporting Domains");
      assert.include(result, "### Generic Domains");
      assert.include(result, "### Unclassified Domains");
    });

    it("groups appear in order: Core, Supporting, Generic, Unclassified", () => {
      const domains = [
        makeDomain("Zebra", { description: "Z", strategy: "generic" }),
        makeDomain("Apple", { description: "A", strategy: "core" }),
        makeDomain("Middle", { description: "M", strategy: "supporting" }),
        makeDomain("Orphan", { description: "O" }),
      ];
      const result = formatDomainIndex(domains, []);
      const coreIdx = result.indexOf("### Core Domains");
      const supportIdx = result.indexOf("### Supporting Domains");
      const genericIdx = result.indexOf("### Generic Domains");
      const unclassIdx = result.indexOf("### Unclassified Domains");
      assert.isAbove(supportIdx, coreIdx);
      assert.isAbove(genericIdx, supportIdx);
      assert.isAbove(unclassIdx, genericIdx);
    });

    it("domains sorted alphabetically within each group", () => {
      const domains = [
        makeDomain("Zeta", { description: "Z", strategy: "core" }),
        makeDomain("Alpha", { description: "A", strategy: "core" }),
        makeDomain("Mu", { description: "M", strategy: "core" }),
      ];
      const result = formatDomainIndex(domains, []);
      const alphaIdx = result.indexOf("Alpha");
      const muIdx = result.indexOf("Mu");
      const zetaIdx = result.indexOf("Zeta");
      assert.isAbove(muIdx, alphaIdx);
      assert.isAbove(zetaIdx, muIdx);
    });

    it("only shows groups that have at least one domain", () => {
      const domains = [
        makeDomain("CoreDomain", { description: "Core", strategy: "core" }),
        makeDomain("GenericDomain", { description: "Generic", strategy: "generic" }),
        // No supporting, no unclassified
      ];
      const result = formatDomainIndex(domains, []);
      assert.include(result, "### Core Domains");
      assert.notInclude(result, "### Supporting Domains");
      assert.include(result, "### Generic Domains");
      assert.notInclude(result, "### Unclassified Domains");
    });

    it("shared subdomains are not affected by strategy grouping", () => {
      const domains = [
        makeDomain("CoreDomain", { description: "Core", strategy: "core" }),
        { ...makeDomain("SharedSub", { description: "Shared" }), isSharedSubdomain: true },
      ];
      const result = formatDomainIndex(domains, []);
      assert.include(result, "## Shared Subdomains");
      // SharedSub should appear in Shared Subdomains, not Core Domains
      const coreSection = result.substring(result.indexOf("### Core Domains"), result.indexOf("## Shared Subdomains"));
      assert.notInclude(coreSection, "SharedSub");
    });
  });

  describe("formatDomainPage — strategy field", () => {
    it("includes Strategy line when strategy is set", () => {
      const domain = makeDomain("MyDomain", {
        description: "A core domain",
        strategy: "core",
      });
      const result = formatDomainPage(domain);
      assert.include(result, "**Strategy:** core");
    });

    it("includes correct strategy value for supporting", () => {
      const domain = makeDomain("MyDomain", {
        description: "A supporting domain",
        strategy: "supporting",
      });
      const result = formatDomainPage(domain);
      assert.include(result, "**Strategy:** supporting");
    });

    it("does not include Strategy line when strategy is not set", () => {
      const domain = makeDomain("MyDomain", {
        description: "An unclassified domain",
      });
      const result = formatDomainPage(domain);
      assert.notInclude(result, "**Strategy:**");
    });

    it("Strategy appears after description", () => {
      const domain = makeDomain("MyDomain", {
        description: "Description text",
        strategy: "generic",
      });
      const result = formatDomainPage(domain);
      const descIdx = result.indexOf("Description text");
      const stratIdx = result.indexOf("**Strategy:** generic");
      assert.isAbove(stratIdx, descIdx);
    });
  });

  describe("formatDomainConfig domains section — strategy field", () => {
    it("includes Strategy line when domain has strategy", () => {
      const config: DomainConfig = {
        domains: {
          MyDomain: {
            description: "A core domain",
            strategy: "core",
          },
        },
      };
      const result = formatDomainConfig(config, "domains");
      assert.include(result, "Strategy: core");
    });

    it("does not include Strategy line when domain has no strategy", () => {
      const config: DomainConfig = {
        domains: {
          MyDomain: {
            description: "No strategy domain",
          },
        },
      };
      const result = formatDomainConfig(config, "domains");
      assert.notInclude(result, "Strategy:");
    });
  });
});
