import * as fs from "node:fs";
import * as path from "node:path";
import { openProject, validateForEditor } from "@genvidtech/c3source";
import type { EventSheet, EditorValidationIssue } from "@genvidtech/c3source";
import type { Logger } from "@genvidtech/mcp-utils";
import { classifyFile, collectSectionFiles } from "./classification.js";
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
  // This guard's return value is now redundant for correctness:
  // collectSectionFiles goes through C3Project.findAllEventSheets, whose
  // shared findInSection already returns [] for an absent eventSheets/ dir,
  // so an absent section would yield the same empty report without it.
  // It survives for its log line — the skip signal ADR 0008 deliberately
  // preserves — pinned by editorValidation.test.ts. Do NOT add an
  // fs.existsSync guard here or anywhere else in this function: that would
  // be redundant, not defensive (ADR 0020 removed exactly that from
  // collectSectionFiles; re-deriving it is a known regression trap).
  if (!project.hasEventSheets()) {
    log(`editorValidation: eventSheets/ dir not found at ${project.eventSheetsDir}, skipping.`);
    return { sheets: [], totalIssues: 0 };
  }
  // One enumeration per section (ADR 0017/0020/0024): route through the
  // shared collectSectionFiles seam instead of hand-relativizing this
  // walk's own copy of project.findAllEventSheets().
  const relPaths = collectSectionFiles(project, "eventSheet", rootDir);

  const results: EditorStrictnessSheetReport[] = [];

  for (const relPath of relPaths) {
    const domainName = classifyFile(relPath, "eventSheet", config) ?? "(unclassified)";

    const content = fs.readFileSync(path.join(rootDir, relPath), "utf-8");
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
