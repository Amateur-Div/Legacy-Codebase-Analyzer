import { describe, expect, it } from "vitest";
import { extractCallGraphBabel } from "../app/api/lib/callGraphExtractor";
import { resolveCallGraph } from "../app/api/lib/callGraphResolver";

describe("resolveCallGraph", () => {
  it("resolves same-file calls and named aliased imports to exact exported symbols", () => {
    const service = extractCallGraphBabel(
      "repo/src/services/user.ts",
      `
        export function createUser() {}
        export const removeUser = () => {};
      `,
    );
    const route = extractCallGraphBabel(
      "repo/src/routes/users.ts",
      `
        import { createUser as makeUser } from "../services/user";
        export function POST() {
          makeUser();
        }
      `,
    );

    const result = resolveCallGraph([service, route], { repoRoot: "repo" });
    const edge = result.edges.find((item) => item.calleeText === "makeUser");
    const target = service.symbols.find((symbol) => symbol.name === "createUser");

    expect(edge).toMatchObject({
      fromFilePath: "repo/src/routes/users.ts",
      toFilePath: "repo/src/services/user.ts",
      resolution: "imported",
      confidence: "high",
    });
    expect(edge?.toSymbolId).toBe(target?.id);
    expect(result.files[1].callSites.find((call) => call.calleeText === "makeUser"))
      .toMatchObject({ resolution: "resolved-import", targetSymbolId: target?.id });
  });

  it("resolves default and namespace imports", () => {
    const service = extractCallGraphBabel(
      "repo/src/services/audit.ts",
      `
        export default function AuditService() {}
        export function write() {}
      `,
    );
    const route = extractCallGraphBabel(
      "repo/src/routes/audit.ts",
      `
        import AuditService from "../services/audit";
        import * as audit from "../services/audit";
        export function POST() {
          AuditService();
          audit.write();
        }
      `,
    );

    const result = resolveCallGraph([service, route], { repoRoot: "repo" });
    const targets = result.edges.map((edge) => edge.toSymbolId);
    expect(targets).toContain(service.symbols.find((s) => s.name === "AuditService")?.id);
    expect(targets).toContain(service.symbols.find((s) => s.name === "write")?.id);
    expect(result.diagnostics).toEqual([]);
  });

  it("follows direct re-exports and reports unresolved exports rather than guessing", () => {
    const service = extractCallGraphBabel(
      "repo/src/services/user.ts",
      `export function createUser() {}`,
    );
    const barrel = extractCallGraphBabel(
      "repo/src/services/index.ts",
      `export { createUser as addUser } from "./user";`,
    );
    const route = extractCallGraphBabel(
      "repo/src/routes/users.ts",
      `
        import { addUser, missing } from "../services";
        export function POST() {
          addUser();
          missing();
        }
      `,
    );

    const result = resolveCallGraph([service, barrel, route], { repoRoot: "repo" });
    const resolved = result.edges.find((edge) => edge.calleeText === "addUser");
    expect(resolved?.toFilePath).toBe("repo/src/services/user.ts");
    expect(result.diagnostics.some((item) => item.kind === "unresolved-export")).toBe(true);
  });


  it("labels package calls as external instead of treating them as unresolved repository edges", () => {
    const graph = extractCallGraphBabel(
      "repo/src/worker.ts",
      `
        import { debounce } from "lodash";
        export function run() {
          debounce(() => {}, 10);
        }
      `,
    );

    const result = resolveCallGraph([graph], { repoRoot: "repo" });
    expect(result.edges).toEqual([]);
    expect(result.diagnostics.some((item) => item.kind === "external-module")).toBe(true);
    expect(result.diagnostics.some((item) => item.kind === "unresolved-module")).toBe(false);
  });

  it("terminates safely when re-export chains contain a cycle", () => {
    const first = extractCallGraphBabel(
      "repo/src/first.ts",
      `export { run } from "./second";`,
    );
    const second = extractCallGraphBabel(
      "repo/src/second.ts",
      `export { run } from "./first";`,
    );
    const entry = extractCallGraphBabel(
      "repo/src/entry.ts",
      `
        import { run } from "./first";
        export function start() {
          run();
        }
      `,
    );

    const result = resolveCallGraph([first, second, entry], { repoRoot: "repo" });
    expect(result.edges).toEqual([]);
    expect(result.diagnostics.some((item) => item.kind === "unresolved-export")).toBe(true);
  });

  it("does not emit edges for calls without a statically resolved target", () => {
    const graph = extractCallGraphBabel(
      "repo/src/worker.ts",
      `export function run(handler: any) { handler(); }`,
    );
    const result = resolveCallGraph([graph], { repoRoot: "repo" });
    expect(result.edges).toEqual([]);
  });
});
