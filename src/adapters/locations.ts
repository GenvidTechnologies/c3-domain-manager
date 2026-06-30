import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveRootFolder, type ResolvedRoot } from "@genvidtech/mcp-utils";
import { PROJECT_MANIFEST_FILE } from "@genvidtech/c3source";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const NO_EXTRACTED = "none";

export interface LocationOptions {
  config?: string;
  extracted?: string;
  projectDir?: string;
}

export interface ResolvedLocations {
  projectRoot: string;
  configPath: string;
  configDir: string;
  configFileName: string;
  extractedDir: string;
  extractedEphemeral: boolean;
  configWatchKey: string;
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

export function resolveLocations(
  opts: LocationOptions,
  projectRoot: string,
  mkTempDir: () => string = () => fs.mkdtempSync(path.join(os.tmpdir(), "c3dm-extracted-")),
): ResolvedLocations {
  const configPath = opts.config
    ? path.resolve(projectRoot, opts.config)
    : path.join(projectRoot, "domain-config.json");

  let extractedDir: string;
  let extractedEphemeral: boolean;

  if (opts.extracted === NO_EXTRACTED) {
    extractedDir = mkTempDir();
    extractedEphemeral = true;
  } else if (opts.extracted) {
    extractedDir = path.resolve(projectRoot, opts.extracted);
    extractedEphemeral = false;
  } else {
    extractedDir = path.join(projectRoot, "extracted");
    extractedEphemeral = false;
  }

  const configWatchKey = toForwardSlash(path.resolve(configPath));

  return {
    projectRoot,
    configPath,
    configDir: path.dirname(configPath),
    configFileName: path.basename(configPath),
    extractedDir,
    extractedEphemeral,
    configWatchKey,
  };
}

export function resolveProjectRoot(
  opts: { projectDir?: string },
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRoot | CallToolResult {
  return resolveRootFolder(
    { explicit: opts.projectDir, envVar: "C3_PROJECT_DIR", marker: PROJECT_MANIFEST_FILE, cwd },
    env,
  );
}
