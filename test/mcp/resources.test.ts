import { assert } from "chai";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { Harness } from "../mcpHarness.js";
import { startHarness } from "../mcpHarness.js";

/**
 * Pins the `exposeDocs` resource surface (`docs:///` listing + read) against
 * the post-move `wiki/` bundle shape — plan.md Task 2, acceptance rows D2,
 * D3, D8, D9, D10.
 *
 * INTENTIONALLY RED until Task 6 repoints `src/mcp/server.ts` at
 * `exposeDocs(server, __pkgDir, { docsDir: "wiki", recursive: true })`: D2,
 * D3, D9 and D10 fail against today's `{ docsDir: "docs", recursive: false }`
 * wiring — either the resource is entirely absent (the `wiki/reference` /
 * `wiki/process` / `wiki/decisions` subdirectories don't exist until Task 3)
 * or, for the one path that DOES exist today (`docs:///decisions/0026-...`
 * would require descending into `docs/decisions/`), the server's
 * non-recursive `exposeDocs` refuses a nested name by shape before any
 * lookup happens. D8 passes throughout: `docs:///readme` is served from
 * `packageDir`, not `docsDir`, so it is unaffected by the move.
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
