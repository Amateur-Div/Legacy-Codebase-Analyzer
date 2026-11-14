import { describe, it, expect } from "vitest";

import {
  compactEdgesForStorage,
  restoreEdgeIds,
} from "../app/api/lib/graph/graphStore";

import type {
  FlowNode,
  FlowEdge,
  StoredFlowEdge,
} from "../app/api/lib/analyzer/types";

import { vi } from "vitest";

vi.mock("../lib/mongoClient", () => ({
  default: Promise.resolve(null),
}));

describe("graphStore edge persistence", () => {
  const nodes: FlowNode[] = [
    {
      id: "node-a",
      type: "function",
      line: 1,
      code: "function A() {}",
    },
    {
      id: "node-b",
      type: "function",
      line: 5,
      code: "function B() {}",
    },
  ];

  describe("compactEdgesForStorage", () => {
    it("preserves edge IDs when compacting edges", () => {
      const edges: FlowEdge[] = [
        {
          id: "edge-a-b",
          from: "node-a",
          to: "node-b",
          label: "calls",
        },
      ];

      const compacted = compactEdgesForStorage(nodes, edges);

      expect(compacted).toEqual([
        {
          id: "edge-a-b",
          from: 0,
          to: 1,
          label: "calls",
        },
      ]);
    });

    it("preserves distinct IDs for parallel edges", () => {
      const edges: FlowEdge[] = [
        {
          id: "edge-a-b-1",
          from: "node-a",
          to: "node-b",
          label: "calls",
        },
        {
          id: "edge-a-b-2",
          from: "node-a",
          to: "node-b",
          label: "depends on",
        },
      ];

      const compacted = compactEdgesForStorage(nodes, edges);

      expect(compacted).toHaveLength(2);
      expect(compacted[0].id).toBe("edge-a-b-1");
      expect(compacted[1].id).toBe("edge-a-b-2");

      expect(compacted[0].from).toBe(compacted[1].from);
      expect(compacted[0].to).toBe(compacted[1].to);
    });

    it("throws when an edge references a node that does not exist", () => {
      const edges: FlowEdge[] = [
        {
          id: "invalid-edge",
          from: "missing-node",
          to: "node-b",
          label: "calls",
        },
      ];

      expect(() => compactEdgesForStorage(nodes, edges)).toThrow();
    });
  });

  describe("restoreEdgeIds", () => {
    it("restores original node IDs and preserves edge IDs", () => {
      const compactedEdges: StoredFlowEdge[] = [
        {
          id: "edge-a-b",
          from: 0,
          to: 1,
          label: "calls",
        },
      ];

      const restored = restoreEdgeIds(compactedEdges, nodes);

      expect(restored).toEqual([
        {
          id: "edge-a-b",
          from: "node-a",
          to: "node-b",
          label: "calls",
        },
      ]);
    });

    it("restores parallel edges without ID collisions", () => {
      const compactedEdges: StoredFlowEdge[] = [
        {
          id: "edge-a-b-1",
          from: 0,
          to: 1,
          label: "calls",
        },
        {
          id: "edge-a-b-2",
          from: 0,
          to: 1,
          label: "depends on",
        },
      ];

      const restored = restoreEdgeIds(compactedEdges, nodes);

      expect(restored).toHaveLength(2);

      expect(restored[0].id).toBe("edge-a-b-1");
      expect(restored[1].id).toBe("edge-a-b-2");

      expect(restored[0].id).not.toBe(restored[1].id);
    });

    it("generates unique fallback IDs for legacy edges without IDs", () => {
      const legacyEdges = [
        {
          from: 0,
          to: 1,
          label: "calls",
        },
        {
          from: 0,
          to: 1,
          label: "depends on",
        },
      ] as StoredFlowEdge[];

      const restored = restoreEdgeIds(legacyEdges, nodes);

      expect(restored).toHaveLength(2);

      expect(restored[0].id).toBeTruthy();
      expect(restored[1].id).toBeTruthy();

      expect(restored[0].id).not.toBe(restored[1].id);
    });

    it("throws when a stored edge references an invalid node index", () => {
      const invalidEdges: StoredFlowEdge[] = [
        {
          id: "invalid-edge",
          from: 0,
          to: 99,
          label: "calls",
        },
      ];

      expect(() => restoreEdgeIds(invalidEdges, nodes)).toThrow();
    });
  });
});
