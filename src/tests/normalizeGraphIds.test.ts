import { normalizeGraphIds } from "../app/api/lib/analyzer/normalizeGraphIds";
import { FlowGraph } from "../app/api/lib/analyzer/types";
import { describe, it, expect } from "vitest";

describe("normalizeGraphIds", () => {
  it("generates unique IDs for parallel edges and preserves labels", () => {
    const graph = {
      nodes: [
        { id: "A", type: "if", line: 1, code: "condition" },
        { id: "B", type: "statement", line: 2, code: "execute()" },
      ],
      edges: [
        { id: "edge-true", from: "A", to: "B", label: "true" },
        { id: "edge-false", from: "A", to: "B", label: "false" },
      ],
    } as FlowGraph;

    const normalized = normalizeGraphIds(graph, "src/example.ts");

    expect(normalized.edges).toHaveLength(2);

    const edgeIds = normalized.edges.map((edge) => edge.id);

    expect(new Set(edgeIds).size).toBe(2);

    expect(normalized.edges.map((edge) => edge.label)).toEqual([
      "true",
      "false",
    ]);

    expect(normalized.edges[0].from).toBe(normalized.edges[1].from);
    expect(normalized.edges[0].to).toBe(normalized.edges[1].to);
  });
});
