import { resolveModule } from "../app/api/lib/buildCrossFileImpactMap";
import { describe, it, expect } from "vitest";

describe("resolveModule - extension collisions", () => {
  const repoRoot = "repo";

  it("resolves explicit .ts imports to the exact file", () => {
    const fileLookup = new Map([
      ["repo/src/utils.ts", "repo/src/utils.ts"],
      ["repo/src/utils.tsx", "repo/src/utils.tsx"],
    ]);

    const result = resolveModule(
      "repo/src/index.ts",
      "./utils.ts",
      fileLookup,
      repoRoot,
    );

    expect(result).toEqual({
      kind: "internal",
      path: "repo/src/utils.ts",
      source: "./utils.ts",
    });
  });

  it("resolves explicit .tsx imports to the exact file", () => {
    const fileLookup = new Map([
      ["repo/src/utils.ts", "repo/src/utils.ts"],
      ["repo/src/utils.tsx", "repo/src/utils.tsx"],
    ]);

    const result = resolveModule(
      "repo/src/index.ts",
      "./utils.tsx",
      fileLookup,
      repoRoot,
    );

    expect(result).toEqual({
      kind: "internal",
      path: "repo/src/utils.tsx",
      source: "./utils.tsx",
    });
  });

  it("resolves extensionless imports using extension priority", () => {
    const fileLookup = new Map([
      ["repo/src/utils.ts", "repo/src/utils.ts"],
      ["repo/src/utils.tsx", "repo/src/utils.tsx"],
    ]);

    const result = resolveModule(
      "repo/src/index.ts",
      "./utils",
      fileLookup,
      repoRoot,
    );

    expect(result).toEqual({
      kind: "internal",
      path: "repo/src/utils.ts",
      source: "./utils",
    });
  });

  it("does not resolve to the last inserted extensionless collision", () => {
    const fileLookup = new Map([
      ["repo/src/utils.ts", "repo/src/utils.ts"],
      ["repo/src/utils.tsx", "repo/src/utils.tsx"],
    ]);

    const result = resolveModule(
      "repo/src/index.ts",
      "./utils.ts",
      fileLookup,
      repoRoot,
    );

    expect(result.kind).toBe("internal");

    if (result.kind === "internal") {
      expect(result.path).toBe("repo/src/utils.ts");
    }
  });
});
