#!/usr/bin/env node
/**
 * Scan a corpus of real Construct 3 projects and report the authored-script
 * population: `.ts`/`.js` sibling pairs, orphan `.js` (no `.ts` sibling), and
 * per-project totals.
 *
 * Why this exists: several decisions here rest on "how many X are there really,
 * across real projects" — ADR 0009 (addon inventory), ADR 0016 (the
 * authored-script rule), ADR 0021 (declining a drift diagnostic). Each of those
 * re-derived the same population by hand. The numbers are only meaningful when
 * measured, and they move as the corpus does, so re-running beats citing a
 * figure from a record written months ago.
 *
 * The corpus is machine-local and deliberately NOT hardcoded — `CLAUDE.md`'s
 * documentation convention forbids committing machine-local paths, and no two
 * checkouts have the same corpus anyway. Supply roots explicitly:
 *
 *   C3_CORPUS_ROOTS="/path/to/repos" npm run corpus:scan
 *   npm run corpus:scan -- /path/to/repos /path/to/one-project
 *
 * A root may be either a single C3 project or a directory containing several.
 * Separate multiple roots in the env var with `;` (or `,`).
 *
 * **Discovery anchors on `project.c3proj`, and that is load-bearing.** A C3
 * project's own `extracted/` output tree contains directories named
 * `eventSheets/`, `layouts/`, `scripts/` … so a scan that keys off directory
 * names alone silently counts generated output as source and fakes its own
 * results. Descent also skips `node_modules/`, `.git/`, `extracted/` and
 * `html5/` (a C3 export, which ships its own `scripts/`).
 */
import fs from "node:fs";
import path from "node:path";

const MANIFEST = "project.c3proj";
const SKIP_DIRS = new Set(["node_modules", ".git", "extracted", "html5", "dist"]);
/** Max depth to search below a root for a project manifest. */
const DISCOVERY_DEPTH = 3;

function parseRoots() {
  const fromArgs = process.argv.slice(2);
  if (fromArgs.length > 0) return fromArgs;
  const env = process.env.C3_CORPUS_ROOTS;
  if (env) return env.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Every directory at or below `dir` (to DISCOVERY_DEPTH) holding a project manifest. */
function findProjects(dir, depth = 0, found = []) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return found;
  if (fs.existsSync(path.join(dir, MANIFEST))) {
    found.push(dir);
    return found; // don't descend into a project looking for nested ones
  }
  if (depth >= DISCOVERY_DEPTH) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    findProjects(path.join(dir, entry.name), depth + 1, found);
  }
  return found;
}

/** Every file below `dir`, as a POSIX path relative to `base`. */
function walkFiles(dir, base, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable dir is not a scan failure
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(full, base, out);
    } else {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** The C3 release this project was last saved with, if the manifest exposes it. */
function savedWithRelease(projectDir) {
  try {
    const raw = fs.readFileSync(path.join(projectDir, MANIFEST), "utf8");
    const m = raw.match(/"savedWithRelease"\s*:\s*(\d+)/);
    return m ? `r${m[1]}` : "r?";
  } catch {
    return "r?";
  }
}

function scanProject(projectDir) {
  const scriptsDir = path.join(projectDir, "scripts");
  const hasScripts = fs.existsSync(scriptsDir);
  const files = hasScripts ? walkFiles(scriptsDir, scriptsDir) : [];

  // Authored .ts excludes .d.ts — generated typings are not authored source.
  const ts = files.filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
  const js = files.filter((f) => f.endsWith(".js"));

  // Sibling pairing is per-directory by basename, matching the compiled-sibling
  // rule (c3source's isGeneratedScriptOutput): scripts/a/x.ts does NOT pair with
  // scripts/b/x.js. Comparing full relative paths gives exactly that scoping.
  const tsStems = new Set(ts.map((f) => f.slice(0, -".ts".length)));
  const pairs = js.filter((f) => tsStems.has(f.slice(0, -".js".length)));
  const orphans = js.filter((f) => !tsStems.has(f.slice(0, -".js".length)));

  return { projectDir, release: savedWithRelease(projectDir), hasScripts, ts, js, pairs, orphans };
}

const roots = parseRoots();
if (roots.length === 0) {
  console.error("No corpus roots given.\n");
  console.error("  C3_CORPUS_ROOTS=\"<dir>[;<dir>...]\" npm run corpus:scan");
  console.error("  npm run corpus:scan -- <dir> [<dir>...]\n");
  console.error("A root may be a single C3 project or a directory containing several.");
  process.exit(2);
}

const projects = [...new Set(roots.flatMap((r) => findProjects(path.resolve(r))))].sort();
if (projects.length === 0) {
  console.error(`No ${MANIFEST} found under: ${roots.join(", ")}`);
  process.exit(1);
}

const results = projects.map(scanProject);
const sum = (fn) => results.reduce((n, r) => n + fn(r), 0);

console.log(`Scanned ${results.length} project(s), anchored on ${MANIFEST}.\n`);
for (const r of results) {
  const name = path.basename(r.projectDir);
  if (!r.hasScripts) {
    console.log(`  ${name} (${r.release}) — no scripts/`);
    continue;
  }
  console.log(
    `  ${name} (${r.release}) — ${r.ts.length} authored .ts, ${r.js.length} .js, ` +
      `${r.pairs.length} pair(s), ${r.orphans.length} orphan(s)`,
  );
  for (const p of r.pairs) console.log(`      pair:   scripts/${p}`);
  for (const o of r.orphans) console.log(`      orphan: scripts/${o}`);
}

// Duplicate checkouts of the same upstream project are common in a real corpus
// — the canonical construct3-sample appears under this repo's fixtures and
// inside sibling tool repos. They inflate whole-corpus totals while telling you
// nothing new, so flag them rather than silently double-counting. Fingerprint on
// what a duplicate shares: same directory name, same C3 release, same file
// counts. This is a heuristic and is reported, never applied silently.
const seen = new Map();
for (const r of results) {
  const key = `${path.basename(r.projectDir)}|${r.release}|${r.ts.length}|${r.js.length}`;
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(r);
}
const dupGroups = [...seen.values()].filter((g) => g.length > 1);

console.log(
  "\n" +
    JSON.stringify(
      {
        projectsScanned: results.length,
        withScriptsDir: results.filter((r) => r.hasScripts).length,
        totalAuthoredTs: sum((r) => r.ts.length),
        totalJs: sum((r) => r.js.length),
        siblingPairs: sum((r) => r.pairs.length),
        orphanJs: sum((r) => r.orphans.length),
        likelyDuplicateCheckouts: dupGroups.reduce((n, g) => n + g.length - 1, 0),
      },
      null,
      2,
    ),
);

if (dupGroups.length > 0) {
  console.log(
    "\nLikely duplicate checkouts of the same upstream project — these inflate" +
      "\nthe whole-corpus totals above. Decide per question whether to count them" +
      "\nonce (population of distinct projects) or as found (files on this disk):",
  );
  for (const g of dupGroups) {
    console.log(`  ${path.basename(g[0].projectDir)} (${g[0].release}) ×${g.length}`);
  }
}

console.log(
  "\nCite these by project characteristic (release, shape), never by path —" +
    "\nsee CLAUDE.md's documentation conventions.",
);
