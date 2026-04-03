import type { FunctionParameter, FunctionDef } from "./types.js";

/**
 * Traverse the events array (recursively into children, groups) looking for
 * `eventType: "include"` events. Return the `includeSheet` values.
 */
export function extractIncludes(events: unknown[]): string[] {
  const results: string[] = [];

  for (const event of events) {
    const e = event as Record<string, unknown>;
    if (e.eventType === "include") {
      results.push(e.includeSheet as string);
    } else if (e.eventType === "group") {
      const children = (e.children ?? []) as unknown[];
      results.push(...extractIncludes(children));
    } else if (e.eventType === "block" || e.eventType === "function-block" || e.eventType === "custom-ace-block") {
      const children = (e.children ?? []) as unknown[];
      if (children.length > 0) {
        results.push(...extractIncludes(children));
      }
    }
  }

  return results;
}

/**
 * Format function parameters as "name: type, name2: type2".
 */
function formatParams(params: FunctionParameter[]): string {
  return params.map((p) => `${p.name}: ${p.type}`).join(", ");
}

/**
 * Traverse the events array (recursively into children, groups) looking for
 * function-block and custom-ace-block events. Return FunctionDef array.
 */
export function extractFunctions(events: unknown[], sheetName: string): FunctionDef[] {
  const results: FunctionDef[] = [];

  for (const event of events) {
    const e = event as Record<string, unknown>;

    if (e.eventType === "function-block") {
      const params = (e.functionParameters ?? []) as FunctionParameter[];
      results.push({
        name: e.functionName as string,
        params: formatParams(params),
        returnType: e.functionReturnType as string,
        sourceSheet: sheetName,
      });
      // Recurse into children
      const children = (e.children ?? []) as unknown[];
      if (children.length > 0) {
        results.push(...extractFunctions(children, sheetName));
      }
    } else if (e.eventType === "custom-ace-block") {
      const params = (e.functionParameters ?? []) as FunctionParameter[];
      results.push({
        name: e.aceName as string,
        params: formatParams(params),
        returnType: e.functionReturnType as string,
        sourceSheet: sheetName,
        objectClass: e.objectClass as string,
        aceName: e.aceName as string,
      });
      // Recurse into children
      const children = (e.children ?? []) as unknown[];
      if (children.length > 0) {
        results.push(...extractFunctions(children, sheetName));
      }
    } else if (e.eventType === "group") {
      const children = (e.children ?? []) as unknown[];
      results.push(...extractFunctions(children, sheetName));
    } else if (e.eventType === "block") {
      const children = (e.children ?? []) as unknown[];
      if (children.length > 0) {
        results.push(...extractFunctions(children, sheetName));
      }
    }
  }

  return results;
}
