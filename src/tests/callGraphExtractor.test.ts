import { describe, expect, it } from "vitest";
import { extractCallGraphBabel } from "../app/api/lib/callGraphExtractor";

describe("extractCallGraphBabel", () => {
  it("creates stable, location-based identities for same-named nested functions", () => {
    const result = extractCallGraphBabel(
      "src/services/user.ts",
      `
        function outer() {
          function save() {}
          function nested() {
            function save() {}
            save();
          }
          save();
        }
      `,
    );

    const saves = result.symbols.filter((symbol) => symbol.name === "save");
    expect(saves).toHaveLength(2);
    expect(new Set(saves.map((symbol) => symbol.id)).size).toBe(2);
    expect(saves[0].id).toContain("src/services/user.ts::function::");
    expect(result.callSites.filter((call) => call.calleeText === "save")).toHaveLength(2);
  });

  it("resolves local function and arrow-function calls through lexical bindings", () => {
    const result = extractCallGraphBabel(
      "src/services/user.ts",
      `
        function persist() {}
        const validate = () => {};
        export function createUser() {
          persist();
          validate();
        }
      `,
    );

    const calls = result.callSites.filter((call) =>
      ["persist", "validate"].includes(call.calleeText),
    );

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.resolution === "local")).toBe(true);
    expect(calls.every((call) => Boolean(call.targetSymbolId))).toBe(true);
    expect(result.exports.some((entry) => entry.exportedName === "createUser")).toBe(true);
  });

  it("records named aliases, default imports and namespace imports without guessing targets", () => {
    const result = extractCallGraphBabel(
      "src/routes/users.ts",
      `
        import { createUser as makeUser } from "../services/user";
        import UserService from "../services/userService";
        import * as audit from "../services/audit";
        export async function POST() {
          await makeUser();
          UserService();
          audit.write();
        }
      `,
    );

    const calls = result.callSites;
    expect(calls.find((call) => call.calleeText === "makeUser")?.importedBinding)
      .toMatchObject({ source: "../services/user", localName: "makeUser", importedName: "createUser", kind: "named" });
    expect(calls.find((call) => call.calleeText === "UserService")?.importedBinding)
      .toMatchObject({ importedName: "default", kind: "default" });
    expect(calls.find((call) => call.calleeText === "audit.write")?.importedBinding)
      .toMatchObject({ importedName: "write", kind: "namespace" });
    expect(calls.every((call) => call.resolution === "imported")).toBe(true);
    expect(calls.every((call) => !call.targetSymbolId)).toBe(true);
  });

  it("captures source evidence and reports dynamic calls without inventing targets", () => {
    const result = extractCallGraphBabel(
      "src/worker.ts",
      `
        export function run(handler: any) {
          handler();
          object[key]();
        }
      `,
    );

    expect(result.callSites).toHaveLength(2);
    expect(result.callSites[0]).toMatchObject({
      callerSymbolId: result.symbols[0].id,
      calleeText: "handler",
      line: 3,
      resolution: "unresolved",
    });
    expect(result.callSites[1].calleeKind).toBe("member");
    expect(result.callSites[1].resolution).toBe("unresolved");
  });

  it("returns diagnostics for invalid source and an empty result for empty files", () => {
    const invalid = extractCallGraphBabel("src/broken.ts", "function {");
    expect(invalid.diagnostics).toHaveLength(1);
    expect(invalid.diagnostics[0].kind).toBe("parse-error");

    const empty = extractCallGraphBabel("src/empty.ts", " ");
    expect(empty.symbols).toEqual([]);
    expect(empty.callSites).toEqual([]);
  });
});
