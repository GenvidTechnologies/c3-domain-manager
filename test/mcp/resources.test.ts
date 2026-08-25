import { assert } from "chai";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { Harness } from "../mcpHarness.js";
import { startHarness } from "../mcpHarness.js";

/**
 * Pins the `exposeDocs` resource surface (`docs:///` listing + read) against
 * the `wiki/` bundle shape — issue #74, acceptance rows D2, D3, D8, D9, D10;
 * see `wiki/decisions/0027-retire-docs-tier-into-the-wiki-bundle.md`.
 *
 * Written to fail first, and green only once `src/mcp/server.ts` calls
 * `exposeDocs(server, __pkgDir, { docsDir: "wiki", recursive: true })`.
 *
 * D8 passes regardless of that wiring: `docs:///readme` is a static resource
 * resolved from `packageDir`, not from `docsDir`.
 *
 * D9 and D10 are deliberately mutually controlling. D10 is a zero-hit
 * assertion over an enumerated set of the five pre-move URIs, and on its own
 * it is satisfied just as well by a resource serving *nothing* as by a
 * completed reshape — which is not a hypothetical: while `docsDir` still
 * pointed at a `docs/` directory that had already been removed, `walkFiles`
 * returned `[]` for the missing directory without erroring and the server
 * served zero templated documents, passing D10 vacuously. D9 requires those
 * same five documents to be readable under their new URIs, so the pair keeps
 * "the reshape succeeded" distinguishable from "the list is empty". Grade
 * D10 only alongside a green D9.
 *
 * That silent-empty-resource shape is the failure this file exists to catch:
 * it is what `GenvidTechnologies/construct3-chef#198` shipped undetected, and
 * nothing in lint, typecheck, or the rest of the suite observes it.
 */

/** Extracts the text of the first content block, failing loudly if it isn't a text block. */
function firstText(contents: ReadResourceResult["contents"]): string {
  const first = contents[0];
  assert.exists(first, "expected at least one resource content block");
  if (!("text" in first!) || typeof first!.text !== "string") {
    assert.fail(`expected a text resource content block, got: ${JSON.stringify(first)}`);
  }
  return first!.text;
}

describe("mcp server — resources (exposeDocs surface)", function () {
  let h: Harness;

  before(async function () {
    this.timeout(30_000);
    h = await startHarness();
  });

  after(async function () {
    this.timeout(10_000);
    await h?.stop();
  });

  it("D2: resources/list has >=31 entries and includes docs:///decisions/0026-fs-watch-platform-confound-and-upstream-routing", async function () {
    const { resources } = await h.client.listResources();
    assert.isAtLeast(resources.length, 31);
    const uris = resources.map((r) => r.uri);
    assert.include(uris, "docs:///decisions/0026-fs-watch-platform-confound-and-upstream-routing");
  });

  it("D3: reading that same decisions URI returns non-empty text", async function () {
    const { contents } = await h.client.readResource({
      uri: "docs:///decisions/0026-fs-watch-platform-confound-and-upstream-routing",
    });
    assert.isAbove(firstText(contents).length, 0);
  });

  it("D8: docs:///readme reads non-empty text (served from packageDir, unaffected by the move)", async function () {
    const { contents } = await h.client.readResource({ uri: "docs:///readme" });
    assert.isAbove(firstText(contents).length, 0);
  });

  it("D9: docs:///process/releasing and docs:///reference/domain-architecture read non-empty, and the list contains docs:///process/issue-triage and docs:///schema", async function () {
    const releasing = await h.client.readResource({ uri: "docs:///process/releasing" });
    assert.isAbove(firstText(releasing.contents).length, 0);

    const domainArchitecture = await h.client.readResource({ uri: "docs:///reference/domain-architecture" });
    assert.isAbove(firstText(domainArchitecture.contents).length, 0);

    const { resources } = await h.client.listResources();
    const uris = resources.map((r) => r.uri);
    assert.include(uris, "docs:///process/issue-triage");
    assert.include(uris, "docs:///schema");
  });

  it("D10: resources/list contains none of the 5 pre-move URIs (D9's equivalents above are the positive control)", async function () {
    const { resources } = await h.client.listResources();
    const uris = resources.map((r) => r.uri);
    const preMoveUris = [
      "docs:///TOC",
      "docs:///domain-architecture",
      "docs:///issue-triage",
      "docs:///releasing",
      "docs:///wiki-schema",
    ];
    for (const uri of preMoveUris) {
      assert.notInclude(uris, uri, `expected ${uri} to be gone post-move`);
    }
  });
});
