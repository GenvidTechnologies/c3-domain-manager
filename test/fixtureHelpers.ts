import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { DomainConfig } from "../src/domain/types.js";

/**
 * The materialized fixture's directory name under test/fixtures/.
 *
 * Single swap point for the whole suite: no test may build a fixture path
 * itself. construct3-chef hardcodes its fixture name across 11 test files in
 * four different resolution styles, which makes a rename a repo-wide grep and
 * silently ties part of its suite to being run from the repo root.
 */
export const PROJECT_FIXTURE = "canonical";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures", PROJECT_FIXTURE);

/** Absolute path into the materialized fixture; no argument yields its root. */
export function fixtureProjectPath(rel = ""): string {
  return rel ? path.join(fixtureRoot, rel) : fixtureRoot;
}

/**
 * Throw unless the fixture has been materialized.
 *
 * Deliberately throws rather than offering tests a way to skip. A per-test
 * `if (!exists) this.skip()` guard reads as defensive but hides missing
 * coverage: construct3-chef has two "integration" tests gated on a path that
 * resolves outside its repo, so they have never executed once, and mocha
 * renders that identically to an intentionally pending test.
 *
 * `npm test` materializes the fixture via the `pretest` hook. Running mocha
 * directly bypasses that, which is exactly the case this catches.
 */
export function assertFixtureMaterialized(): void {
  if (!fs.existsSync(path.join(fixtureRoot, "project.c3proj"))) {
    throw new Error(
      `Canonical fixture not materialized at test/fixtures/${PROJECT_FIXTURE}/. ` +
        `Run \`npm run fixture:prep\` (or use \`npm test\` / \`npm run test:file\`, which do it for you).`,
    );
  }
}

/**
 * Domain config for the canonical fixture.
 *
 * Held in memory rather than written into the fixture, so the materialized
 * tree stays byte-identical to the canonical project. Every library entry
 * point takes a config object — only `generateDomainIndex`/`loadConfig` and
 * the CLI read one from disk — so nothing here needs a file.
 *
 * The two domains follow construct3-sample v1.0.0's `Gameplay/` and `UI/`
 * folders, and each of its three cross-domain edges is arranged to cross a
 * domain boundary under this mapping:
 *
 *   include         Event sheet 1 (Gameplay) -> Event sheet 2 (UI)
 *   expression ref  Event sheet 1 (Gameplay) -> Sprite2, in objectTypes/images/ (UI)
 *   event-var ref   Event sheet 2 (UI)       -> `score`, declared in Event sheet 1 (Gameplay)
 *
 * Two files are left deliberately unclassified so the uncategorized path has a
 * non-empty result to assert against:
 *
 *   layouts/Templates Layout.json  — sits at the layouts/ root and has no
 *                                    assigned event sheet, so it genuinely
 *                                    belongs to no one domain
 *   objectTypes/TextInput.json     — a root-level object type with no override
 */
export const FIXTURE_CONFIG: DomainConfig = {
  domains: {
    Gameplay: {
      description: "Core gameplay: score tracking, the game loop, and the tiled level surfaces.",
      eventSheetDirs: ["Gameplay"],
      layoutDirs: ["Gameplay"],
      objectTypeDirs: ["global", "tiles"],
      familyDirs: [],
      scriptDirs: ["ts-defs"],
    },
    UI: {
      description: "Presentation layer: navigation, text display, and sprite assets.",
      eventSheetDirs: ["UI"],
      layoutDirs: ["UI"],
      objectTypeDirs: ["images"],
      familyDirs: [],
      scriptDirs: [],
    },
  },
  overrides: {
    // Flat sections the enrichment deliberately left unfoldered. families/ has
    // no subfolders upstream, and these object types sit at the objectTypes/
    // root, so a directory prefix cannot reach them.
    "families/TextFamily.json": "UI",
    "families/LevelMaps.json": "Gameplay",
    "objectTypes/Text.json": "UI",
    "objectTypes/Text2.json": "UI",
    "objectTypes/NavButton.json": "UI",
    "scripts/main.ts": "Gameplay",
    "scripts/importsForEvents.ts": "Gameplay",
  },
};
