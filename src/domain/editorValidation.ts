import * as fs from "node:fs";
import * as path from "node:path";
import { openProject, validateForEditor } from "@genvidtech/c3source";
import type { EventSheet, EditorValidationIssue } from "@genvidtech/c3source";
import type { Logger } from "@genvid/mcp-utils";
import { classifyFile } from "./classification.js";
import type { DomainConfig } from "./types.js";

export interface EditorStrictnessSheetReport {
  /** Relative POSIX path, e.g. "eventSheets/Login/LoginEvents.json". */
  sheet: string;
  /** Owning domain name from classifyFile, or "(unclassified)". */
  domain: string;
  /** Issues from c3source's validateForEditor for this sheet. */
  issues: EditorValidationIssue[];
}

export interface EditorStrictnessReport {
  /** Only sheets that HAVE at least one issue, sorted by sheet path. */
  sheets: EditorStrictnessSheetReport[];
  totalIssues: number;
}

export function validateEditorStrictness(
  rootDir: string,
  config: DomainConfig,
  log: Logger = () => {},
): EditorStrictnessReport {
  const project = openProject(rootDir);
  if (!project.hasEventSheets()) {
    log(`editorValidation: eventSheets/ dir not found at ${project.eventSheetsDir}, skipping.`);
    return { sheets: [], totalIssues: 0 };
  }
  const sheetPaths = project.findAllEventSheets();

  const results: EditorStrictnessSheetReport[] = [];

  for (const sheetPath of sheetPaths) {
    const relPath = path.relative(rootDir, sheetPath).replace(/\\/g, "/");
    const domainName = classifyFile(relPath, "eventSheet", config) ?? "(unclassified)";

    const content = fs.readFileSync(sheetPath, "utf-8");
    const sheet: EventSheet = JSON.parse(content) as EventSheet;

    const issues = validateForEditor(sheet);
    if (issues.length > 0) {
      results.push({ sheet: relPath, domain: domainName, issues });
    }
  }

  results.sort((a, b) => a.sheet.localeCompare(b.sheet));

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

  return { sheets: results, totalIssues };
}

export function formatEditorStrictnessReport(report: EditorStrictnessReport): string {
  if (report.totalIssues === 0) {
    return "No editor-strictness issues found.";
  }

  const lines: string[] = [`${report.totalIssues} editor-strictness issue(s) found:`, ""];

  for (const sheetReport of report.sheets) {
    lines.push(`${sheetReport.sheet} [${sheetReport.domain}]`);
    for (const issue of sheetReport.issues) {
      lines.push(`  [${issue.rule}] ${issue.path}: ${issue.message}`);
    }
  }

  return lines.join("\n");
}
