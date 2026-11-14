import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storedDoc: {} as any,
  updateOne: vi.fn(),
  bulkWrite: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn(),
  createIndex: vi.fn(),
  deleteMany: vi.fn(),
  collection: {
    updateOne: vi.fn(),
    bulkWrite: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    createIndex: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("../lib/mongoClient", () => ({
  default: Promise.resolve({
    db: () => ({
      collection: () => mocks.collection,
    }),
  }),
}));

import { getFileGraph, saveFileGraph } from "../app/api/lib/graph/graphStore";

describe("graphStore MongoDB persistence", () => {
  const projectId = "project-123";
  const ownerId = "owner-456";
  const filePath = "src/index.ts";

  const nodes = [
    { id: "node-A", label: "A" },
    { id: "node-B", label: "B" },
    { id: "node-C", label: "C" },
  ] as any[];

  const edges = [
    {
      id: "edge-unique-1",
      from: "node-A",
      to: "node-B",
      label: "calls",
    },
    {
      id: "edge-unique-2",
      from: "node-A",
      to: "node-B",
      label: "calls",
    },
    {
      id: "edge-unique-3",
      from: "node-B",
      to: "node-C",
      label: "imports",
    },
  ] as any[];

  const meta = {
    nodeCount: 3,
    edgeCount: 3,
    mode: "file",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storedDoc = {};

    mocks.collection.updateOne.mockImplementation(
      async (filter: any, update: any) => {
        mocks.storedDoc = {
          ...mocks.storedDoc,
          ...update.$setOnInsert,
          ...update.$set,
          ...filter,
        };
      },
    );

    mocks.collection.findOne.mockImplementation(async () => {
      return mocks.storedDoc.projectId ? mocks.storedDoc : null;
    });
  });

  it("saves compact edges with their original IDs and restores them on retrieval", async () => {
    await saveFileGraph(projectId, filePath, { nodes, edges, meta }, ownerId);

    expect(mocks.collection.updateOne).toHaveBeenCalledTimes(1);

    const [filter, update, options] = mocks.collection.updateOne.mock.calls[0];

    expect(filter).toEqual({ projectId, filePath });
    expect(options).toEqual({ upsert: true });

    expect(update.$set.edges).toEqual([
      {
        id: "edge-unique-1",
        from: 0,
        to: 1,
        label: "calls",
      },
      {
        id: "edge-unique-2",
        from: 0,
        to: 1,
        label: "calls",
      },
      {
        id: "edge-unique-3",
        from: 1,
        to: 2,
        label: "imports",
      },
    ]);

    const result = await getFileGraph(projectId, filePath, ownerId);

    expect(result).not.toBeNull();
    expect(result!.edges).toEqual(edges);
    expect(result!.nodes).toEqual(nodes);
    expect(result!.meta).toEqual(meta);
  });

  it("includes ownerId in the retrieval filter when provided", async () => {
    await saveFileGraph(projectId, filePath, { nodes, edges, meta }, ownerId);

    await getFileGraph(projectId, filePath, ownerId);

    expect(mocks.collection.findOne).toHaveBeenCalledWith({
      projectId,
      filePath,
      ownerId,
    });
  });

  it("returns null when no matching graph exists", async () => {
    mocks.collection.findOne.mockResolvedValueOnce(null);

    const result = await getFileGraph(projectId, filePath, ownerId);

    expect(result).toBeNull();
  });

  it("restores unique fallback IDs for legacy edges without stored IDs", async () => {
    mocks.storedDoc = {
      projectId,
      filePath,
      ownerId,
      nodes,
      edges: [
        { from: 0, to: 1, label: "calls" },
        { from: 0, to: 1, label: "calls" },
      ],
      meta,
    };

    const result = await getFileGraph(projectId, filePath, ownerId);

    expect(result!.edges).toEqual([
      {
        from: "node-A",
        to: "node-B",
        label: "calls",
        id: "node-A->node-B::0",
      },
      {
        from: "node-A",
        to: "node-B",
        label: "calls",
        id: "node-A->node-B::1",
      },
    ]);

    expect(result!.edges[0].id).not.toBe(result!.edges[1].id);
  });

  it("throws when stored edge indexes reference missing nodes", async () => {
    mocks.storedDoc = {
      projectId,
      filePath,
      ownerId,
      nodes,
      edges: [{ id: "invalid-edge", from: 0, to: 99 }],
      meta,
    };

    await expect(getFileGraph(projectId, filePath, ownerId)).rejects.toThrow(
      "Invalid stored edge indexes: 0 -> 99",
    );
  });
});
