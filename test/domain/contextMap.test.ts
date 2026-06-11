import { describe, it } from "mocha";
import { assert } from "chai";
import { generateContextMap } from "../../src/domain/contextMap.js";
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
  };
}

function makeConfig(relationships?: DomainConfig["relationships"]): DomainConfig {
  return { domains: {}, relationships };
}

describe("contextMap", () => {
  describe("generateContextMap - mermaid format", () => {
    it("empty domain set → just 'graph LR'", () => {
      const result = generateContextMap([], makeConfig(), { format: "mermaid" });
      assert.equal(result.trim(), "graph LR");
    });

    it("two domains with declared customer-supplier → contains -->|C/S|", () => {
      const domains = [
        makeDomain("Authentication"),
        makeDomain("Shop"),
      ];
      const config = makeConfig([{ from: "Authentication", to: "Shop", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "mermaid" });
      assert.include(result, "graph LR");
      assert.include(result, '-->|C/S|');
      assert.include(result, "Authentication");
      assert.include(result, "Shop");
    });

    it("shared-kernel relationship → ==SK==>", () => {
      const domains = [makeDomain("A"), makeDomain("B")];
      const config = makeConfig([{ from: "A", to: "B", type: "shared-kernel" }]);
      const result = generateContextMap(domains, config, { format: "mermaid" });
      assert.include(result, "==SK==>");
    });

    it("conformist relationship → -->|CF|", () => {
      const domains = [makeDomain("A"), makeDomain("B")];
      const config = makeConfig([{ from: "A", to: "B", type: "conformist" }]);
      const result = generateContextMap(domains, config, { format: "mermaid" });
      assert.include(result, "-->|CF|");
    });

    it("anti-corruption-layer relationship → -->|ACL|", () => {
      const domains = [makeDomain("A"), makeDomain("B")];
      const config = makeConfig([{ from: "A", to: "B", type: "anti-corruption-layer" }]);
      const result = generateContextMap(domains, config, { format: "mermaid" });
      assert.include(result, "-->|ACL|");
    });

    it("open-host-service relationship → -->|OHS|", () => {
      const domains = [makeDomain("A"), makeDomain("B")];
      const config = makeConfig([{ from: "A", to: "B", type: "open-host-service" }]);
      const result = generateContextMap(domains, config, { format: "mermaid" });
      assert.include(result, "-->|OHS|");
    });

    it("observed (undeclared) dependency → dashed arrow -.->" , () => {
      const domains = [
        makeDomain("Core", { includedBy: new Map([["Auth", ["Auth/Sheet.json"]]]) }),
        makeDomain("Auth", { includesFrom: new Map([["Core", ["Core/Sheet.json"]]]) }),
      ];
      const config = makeConfig();
      const result = generateContextMap(domains, config, { format: "mermaid", includeObserved: true });
      assert.include(result, "graph LR");
      assert.include(result, "-.->"); // dashed arrow for observed
      assert.notInclude(result, "-->|");  // no declared relationship arrow
    });

    it("includeObserved: false → no dashed arrows for undeclared deps", () => {
      const domains = [
        makeDomain("Core"),
        makeDomain("Auth", { includesFrom: new Map([["Core", ["Core/Sheet.json"]]]) }),
      ];
      const config = makeConfig();
      const result = generateContextMap(domains, config, { format: "mermaid", includeObserved: false });
      assert.notInclude(result, "-.->"); // no dashed arrow
    });

    it("domain names with special chars are quoted in mermaid", () => {
      const domains = [
        makeDomain("Shop & Economy"),
        makeDomain("Authentication"),
      ];
      const config = makeConfig([{ from: "Authentication", to: "Shop & Economy", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "mermaid" });
      assert.include(result, '"Shop & Economy"');
    });

    it("domain filter with 1-hop → only adjacent domains included", () => {
      const domains = [
        makeDomain("Authentication", { includesFrom: new Map([["Core", ["Core/Sheet.json"]]]) }),
        makeDomain("Core"),
        makeDomain("Unrelated"),
      ];
      const config = makeConfig([{ from: "Core", to: "Authentication", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "mermaid", domain: "Authentication" });
      assert.include(result, "Authentication");
      assert.include(result, "Core");
      assert.notInclude(result, "Unrelated");
    });

    it("domain filter with no match → treats as empty neighborhood", () => {
      const domains = [makeDomain("Auth"), makeDomain("Core")];
      const config = makeConfig();
      const result = generateContextMap(domains, config, { format: "mermaid", domain: "NonExistent" });
      assert.equal(result.trim(), "graph LR");
    });

    it("includeObserved defaults to true when not specified", () => {
      const domains = [
        makeDomain("Core"),
        makeDomain("Auth", { includesFrom: new Map([["Core", ["Core/Sheet.json"]]]) }),
      ];
      const config = makeConfig();
      // no includeObserved param — should default to true
      const result = generateContextMap(domains, config, { format: "mermaid" });
      assert.include(result, "-.->"); // dashed arrow appears by default
    });

    it("domain without special chars is not quoted", () => {
      const domains = [makeDomain("Auth"), makeDomain("Core")];
      const config = makeConfig([{ from: "Auth", to: "Core", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "mermaid" });
      // Auth and Core are plain identifiers, should not be quoted
      assert.notInclude(result, '"Auth"');
      assert.notInclude(result, '"Core"');
    });
  });

  describe("generateContextMap - text format", () => {
    it("empty domain set → 'Context Map:\\n\\nNo domains.'", () => {
      const result = generateContextMap([], makeConfig(), { format: "text" });
      assert.equal(result, "Context Map:\n\nNo domains.");
    });

    it("text format contains 'Context Map:' header", () => {
      const domains = [makeDomain("Auth")];
      const result = generateContextMap(domains, makeConfig(), { format: "text" });
      assert.include(result, "Context Map:");
    });

    it("text format does not contain mermaid syntax", () => {
      const domains = [makeDomain("Auth"), makeDomain("Core")];
      const config = makeConfig([{ from: "Core", to: "Auth", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "text" });
      assert.notInclude(result, "graph LR");
      assert.notInclude(result, "==SK==>");
      assert.notInclude(result, "-.->"); // no mermaid arrow
    });

    it("text format shows outgoing → with type label", () => {
      const domains = [
        makeDomain("Authentication"),
        makeDomain("Shop"),
      ];
      const config = makeConfig([{ from: "Authentication", to: "Shop", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "text" });
      assert.include(result, "Authentication");
      assert.include(result, "→ Shop [customer-supplier]");
    });

    it("text format shows incoming ← with type label", () => {
      const domains = [
        makeDomain("Authentication"),
        makeDomain("Shop"),
      ];
      const config = makeConfig([{ from: "Authentication", to: "Shop", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "text" });
      assert.include(result, "← Authentication [customer-supplier]");
    });

    it("text format shows [observed] for undeclared deps", () => {
      const domains = [
        makeDomain("Core"),
        makeDomain("Auth", { includesFrom: new Map([["Core", ["Core/Sheet.json"]]]) }),
      ];
      const config = makeConfig();
      const result = generateContextMap(domains, config, { format: "text", includeObserved: true });
      assert.include(result, "[observed]");
    });

    it("text format domain filter limits output", () => {
      const domains = [
        makeDomain("Auth"),
        makeDomain("Core"),
        makeDomain("Unrelated"),
      ];
      const config = makeConfig([{ from: "Core", to: "Auth", type: "customer-supplier" }]);
      const result = generateContextMap(domains, config, { format: "text", domain: "Auth" });
      assert.include(result, "Auth");
      assert.include(result, "Core");
      assert.notInclude(result, "Unrelated");
    });
  });
});
