import { describe, it, expect } from "vitest";
import type { Node, Edge } from "reactflow";
import { getDagreGraph } from "../app/projects/utils/graphLayout";

describe("getDagreGraph", () => {
  it("preserves parallel edges between the same nodes", () => {
    const nodes: Node[] = [
      { id: "A", position: { x: 0, y: 0 }, data: {} },
      { id: "B", position: { x: 0, y: 0 }, data: {} },
    ];

    const edges: Edge[] = [
      {
        id: "edge-true",
        source: "A",
        target: "B",
        label: "true",
      },
      {
        id: "edge-false",
        source: "A",
        target: "B",
        label: "false",
      },
    ];

    const graph = getDagreGraph(nodes, edges);

    const graphEdges = graph
      .edges()
      .filter((edge) => edge.v === "A" && edge.w === "B");

    expect(graphEdges).toHaveLength(2);

    expect(graphEdges.map((edge) => edge.name)).toContain("edge-true");
    expect(graphEdges.map((edge) => edge.name)).toContain("edge-false");
  });
});
