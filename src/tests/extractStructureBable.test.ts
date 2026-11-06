import { extractStructureBabel } from "../app/api/lib/extractStructureBable";
import { describe, it, expect } from "vitest";

describe("extractStructureBabel - import extraction", () => {
  it.each([
    {
      name: "ES module import",
      code: `import utils from "./utils";`,
      expected: ["./utils"],
    },
    {
      name: "named re-export",
      code: `export { helper } from "./utils";`,
      expected: ["./utils"],
    },
    {
      name: "wildcard re-export",
      code: `export * from "./utils";`,
      expected: ["./utils"],
    },
    {
      name: "default re-export",
      code: `export { default } from "./utils";`,
      expected: ["./utils"],
    },
    {
      name: "CommonJS require",
      code: `const utils = require("./utils");`,
      expected: ["./utils"],
    },
    {
      name: "dynamic import",
      code: `const utils = import("./utils");`,
      expected: ["./utils"],
    },
    {
      name: "external package import",
      code: `import React from "react";`,
      expected: ["react"],
    },
  ])("$name", ({ code, expected }) => {
    const result = extractStructureBabel("/src/module.ts", code);

    expect(result.imports.map((item) => item.name)).toEqual(expected);
  });

  it("deduplicates imports with the same source", () => {
    const code = `
import utils from "./utils";
export { helper } from "./utils";
export * from "./utils";
`;

    const result = extractStructureBabel("/src/module.ts", code);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].name).toBe("./utils");
  });

  it("preserves import ID and source line number", () => {
    const code = `
import React from "react";
import utils from "./utils";
`;

    const result = extractStructureBabel("/src/module.ts", code);

    expect(result.imports).toHaveLength(2);

    expect(result.imports[0]).toMatchObject({
      id: "import:/src/module.ts:react",
      name: "react",
      start: 2,
    });

    expect(result.imports[1]).toMatchObject({
      id: "import:/src/module.ts:./utils",
      name: "./utils",
      start: 3,
    });
  });

  it("returns an empty imports array for a file without imports", () => {
    const result = extractStructureBabel("/src/module.ts", `const value = 10;`);

    expect(result.imports).toEqual([]);
  });

  it("returns an empty result for an empty file", () => {
    const result = extractStructureBabel("/src/module.ts", "");

    expect(result.imports).toEqual([]);
  });

  it("skips test files", () => {
    const result = extractStructureBabel(
      "/src/module.test.ts",
      `import utils from "./utils";`,
    );

    expect(result.imports).toEqual([]);
  });

  it("does not detect imports from comments or strings", () => {
    const code = `
      // import utils from "./comment";
      const text = 'require("./string")';
    `;

    const result = extractStructureBabel("/src/module.ts", code);

    expect(result.imports).toEqual([]);
  });
});
