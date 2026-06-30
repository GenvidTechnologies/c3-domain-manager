import { describe, it, beforeEach, afterEach } from "mocha";
import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { validateEditorStrictness, formatEditorStrictnessReport } from "../../src/domain/editorValidation.js";
import type { DomainConfig } from "../../src/domain/types.js";

/** Create a minimal DomainConfig for testing. */
function makeConfig(
  domains: DomainConfig["domains"],
  overrides?: DomainConfig["overrides"],
  sharedSubdomains?: DomainConfig["sharedSubdomains"],
): DomainConfig {
  return { domains, overrides, sharedSubdomains };
}

/** Create a file (and its parent directories) in the temp dir. */
function createFile(rootDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe("editorValidation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editorValidation-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("validateEditorStrictness", () => {
    it("reports a sheet with a variable missing comment (classified domain)", () => {
      // A variable event without a comment — triggers eventvar-comment-required
      const sheetContent = JSON.stringify({
        name: "LoginEvents",
        sid: 1,
        events: [
          {
            eventType: "variable",
            name: "score",
            type: "number",
            initialValue: "0",
            isStatic: false,
            isConstant: false,
            sid: 2,
          },
        ],
      });
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json", sheetContent);

      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const report = validateEditorStrictness(tmpDir, config);

      assert.equal(report.sheets.length, 1, "should have 1 sheet with issues");
      assert.equal(report.totalIssues, 1, "should have 1 total issue");
      assert.equal(report.sheets[0].sheet, "eventSheets/Login/LoginEvents.json");
      assert.equal(report.sheets[0].domain, "Auth");
      assert.equal(report.sheets[0].issues.length, 1);
      assert.equal(report.sheets[0].issues[0].rule, "eventvar-comment-required");
    });

    it("returns empty report for a fully clean sheet (variable with empty-string comment passes)", () => {
      // A variable event with comment: "" — should PASS (empty string is allowed)
      const sheetContent = JSON.stringify({
        name: "LoginEvents",
        sid: 1,
        events: [
          {
            eventType: "variable",
            name: "score",
            type: "number",
            initialValue: "0",
            comment: "",
            isStatic: false,
            isConstant: false,
            sid: 2,
          },
        ],
      });
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json", sheetContent);

      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const report = validateEditorStrictness(tmpDir, config);

      assert.equal(report.sheets.length, 0, "should have 0 sheets with issues");
      assert.equal(report.totalIssues, 0, "should have 0 total issues");
    });

    it("marks unclassified sheet with domain '(unclassified)' when it has issues", () => {
      // Sheet in a dir not matched by any domain config
      const sheetContent = JSON.stringify({
        name: "OrphanEvents",
        sid: 1,
        events: [
          {
            eventType: "variable",
            name: "count",
            type: "number",
            initialValue: "0",
            isStatic: false,
            isConstant: false,
            sid: 2,
          },
        ],
      });
      createFile(tmpDir, "eventSheets/Orphan/OrphanEvents.json", sheetContent);

      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const report = validateEditorStrictness(tmpDir, config);

      assert.equal(report.sheets.length, 1, "should have 1 sheet with issues");
      assert.equal(report.sheets[0].domain, "(unclassified)");
      assert.equal(report.sheets[0].sheet, "eventSheets/Orphan/OrphanEvents.json");
      assert.equal(report.sheets[0].issues[0].rule, "eventvar-comment-required");
      assert.equal(report.totalIssues, 1);
    });

    it("returns an empty report when eventSheets/ directory is missing (no throw)", () => {
      // No eventSheets/ dir at all
      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      let report;
      assert.doesNotThrow(() => {
        report = validateEditorStrictness(tmpDir, config);
      });
      assert.equal(report!.sheets.length, 0);
      assert.equal(report!.totalIssues, 0);
    });

    it("calls log with a message containing 'eventSheets' when eventSheets/ dir is absent", () => {
      // No eventSheets/ dir — log spy should capture the skip message
      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const logMessages: unknown[] = [];
      const logSpy = (...args: unknown[]) => { logMessages.push(args[0]); };

      validateEditorStrictness(tmpDir, config, logSpy);

      assert.isTrue(
        logMessages.some((msg) => typeof msg === "string" && msg.includes("eventSheets")),
        `Expected log to contain 'eventSheets', got: ${JSON.stringify(logMessages)}`,
      );
    });

    it("only includes sheets with issues, sorted by sheet path", () => {
      // Two sheets: one clean, one with issues
      const cleanSheet = JSON.stringify({
        name: "CleanEvents",
        sid: 10,
        events: [
          {
            eventType: "variable",
            name: "x",
            type: "number",
            initialValue: "0",
            comment: "ok",
            isStatic: false,
            isConstant: false,
            sid: 11,
          },
        ],
      });
      const dirtySheet = JSON.stringify({
        name: "DirtyEvents",
        sid: 20,
        events: [
          {
            eventType: "variable",
            name: "y",
            type: "number",
            initialValue: "0",
            isStatic: false,
            isConstant: false,
            sid: 21,
          },
        ],
      });
      createFile(tmpDir, "eventSheets/Alpha/CleanEvents.json", cleanSheet);
      createFile(tmpDir, "eventSheets/Beta/DirtyEvents.json", dirtySheet);

      const config = makeConfig({
        Domain: { description: "Domain", eventSheetDirs: ["Alpha", "Beta"] },
      });

      const report = validateEditorStrictness(tmpDir, config);

      assert.equal(report.sheets.length, 1, "only dirty sheet should appear");
      assert.equal(report.sheets[0].sheet, "eventSheets/Beta/DirtyEvents.json");
      assert.equal(report.totalIssues, 1);
    });

    it("sorts multiple issue sheets by sheet path ascending", () => {
      const makeSheet = (name: string, sid: number) =>
        JSON.stringify({
          name,
          sid,
          events: [
            {
              eventType: "variable",
              name: "n",
              type: "number",
              initialValue: "0",
              isStatic: false,
              isConstant: false,
              sid: sid + 1,
            },
          ],
        });
      createFile(tmpDir, "eventSheets/Z/ZEvents.json", makeSheet("ZEvents", 30));
      createFile(tmpDir, "eventSheets/A/AEvents.json", makeSheet("AEvents", 40));

      const config = makeConfig({
        Domain: { description: "Domain", eventSheetDirs: ["A", "Z"] },
      });

      const report = validateEditorStrictness(tmpDir, config);

      assert.equal(report.sheets.length, 2);
      assert.equal(report.sheets[0].sheet, "eventSheets/A/AEvents.json");
      assert.equal(report.sheets[1].sheet, "eventSheets/Z/ZEvents.json");
    });
  });

  describe("formatEditorStrictnessReport", () => {
    it("returns 'No editor-strictness issues found.' when totalIssues is 0", () => {
      const report = { sheets: [], totalIssues: 0 };
      const result = formatEditorStrictnessReport(report);
      assert.equal(result, "No editor-strictness issues found.");
    });

    it("includes the sheet path and rule id in formatted output", () => {
      const sheetContent = JSON.stringify({
        name: "LoginEvents",
        sid: 1,
        events: [
          {
            eventType: "variable",
            name: "score",
            type: "number",
            initialValue: "0",
            isStatic: false,
            isConstant: false,
            sid: 2,
          },
        ],
      });
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json", sheetContent);

      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const report = validateEditorStrictness(tmpDir, config);
      const formatted = formatEditorStrictnessReport(report);

      assert.include(formatted, "eventSheets/Login/LoginEvents.json");
      assert.include(formatted, "eventvar-comment-required");
    });

    it("includes total issue count in the header line", () => {
      const sheetContent = JSON.stringify({
        name: "LoginEvents",
        sid: 1,
        events: [
          {
            eventType: "variable",
            name: "score",
            type: "number",
            initialValue: "0",
            isStatic: false,
            isConstant: false,
            sid: 2,
          },
          {
            eventType: "variable",
            name: "lives",
            type: "number",
            initialValue: "3",
            isStatic: false,
            isConstant: false,
            sid: 3,
          },
        ],
      });
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json", sheetContent);

      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const report = validateEditorStrictness(tmpDir, config);
      assert.equal(report.totalIssues, 2);

      const formatted = formatEditorStrictnessReport(report);
      assert.include(formatted, "2");
    });

    it("includes the domain name in the sheet header line", () => {
      const sheetContent = JSON.stringify({
        name: "LoginEvents",
        sid: 1,
        events: [
          {
            eventType: "variable",
            name: "score",
            type: "number",
            initialValue: "0",
            isStatic: false,
            isConstant: false,
            sid: 2,
          },
        ],
      });
      createFile(tmpDir, "eventSheets/Login/LoginEvents.json", sheetContent);

      const config = makeConfig({
        Auth: { description: "Auth", eventSheetDirs: ["Login"] },
      });

      const report = validateEditorStrictness(tmpDir, config);
      const formatted = formatEditorStrictnessReport(report);

      assert.include(formatted, "Auth");
    });
  });
});
