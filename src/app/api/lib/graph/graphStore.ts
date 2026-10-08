import clientPromise from "../../../../lib/mongoClient";
import { FlowEdge, FlowNode, StoredFlowEdge } from "../analyzer/types";

const FILE_GRAPH_COLLECTION = "file_graphs";

export interface FileGraphRecord {
  projectId: string;
  ownerId?: string;
  filePath: string;
  nodes: any[];
  edges: any[];
  meta: {
    nodeCount: number;
    edgeCount: number;
    mode: string | null;
    generatedAt: Date;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export async function ensureFileGraphIndexes() {
  const client = await clientPromise;
  const db = client.db();

  const fileGraphs = db.collection(FILE_GRAPH_COLLECTION);

  await fileGraphs.createIndex(
    { projectId: 1, filePath: 1 },
    {
      unique: true,
      name: "unique_project_file_graph",
    },
  );

  await fileGraphs.createIndex(
    { ownerId: 1, projectId: 1 },
    {
      name: "owner_project_file_graphs",
    },
  );
}

function compactEdgesForStorage(
  nodes: FlowNode[],
  edges: FlowEdge[],
): StoredFlowEdge[] {
  const nodeIndexById = new Map<string, number>();

  nodes.forEach((node, index) => {
    nodeIndexById.set(node.id, index);
  });

  return edges.map(({ from, to, label }) => {
    const fromIndex = nodeIndexById.get(from);
    const toIndex = nodeIndexById.get(to);

    if (fromIndex === undefined || toIndex === undefined) {
      throw new Error(`Invalid file graph edge reference: ${from} -> ${to}`);
    }

    return {
      from: fromIndex,
      to: toIndex,
      ...(label !== undefined ? { label } : {}),
    };
  });
}

function restoreEdgeIds(
  edges: StoredFlowEdge[],
  nodes: FlowNode[],
): FlowEdge[] {
  return edges.map((edge) => {
    const fromNode = nodes[edge.from];
    const toNode = nodes[edge.to];

    if (!fromNode || !toNode) {
      throw new Error(
        `Invalid stored edge indexes: ${edge.from} -> ${edge.to}`,
      );
    }

    return {
      ...edge,
      from: fromNode.id,
      to: toNode.id,
      id: `${fromNode.id}->${toNode.id}`,
    };
  });
}

export async function saveFileGraph(
  projectId: string,
  filePath: string,
  graph: Pick<FileGraphRecord, "nodes" | "edges" | "meta">,
  ownerId?: string,
) {
  const client = await clientPromise;
  const db = client.db();
  const col = db.collection(FILE_GRAPH_COLLECTION);

  const now = new Date();

  await col.updateOne(
    { projectId, filePath },
    {
      $setOnInsert: {
        projectId,
        filePath,
        createdAt: now,
      },
      $set: {
        ownerId,
        nodes: graph.nodes,
        edges: compactEdgesForStorage(graph.nodes, graph.edges),
        meta: graph.meta,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

export async function saveFileGraphs(
  projectId: string,
  graphs: Array<Pick<FileGraphRecord, "filePath" | "nodes" | "edges" | "meta">>,
  ownerId?: string,
) {
  if (graphs.length === 0) return;

  const client = await clientPromise;
  const db = client.db();
  const col = db.collection(FILE_GRAPH_COLLECTION);
  const now = new Date();

  const operations = graphs.map((graph) => ({
    updateOne: {
      filter: {
        projectId,
        filePath: graph.filePath,
      },
      update: {
        $setOnInsert: {
          projectId,
          filePath: graph.filePath,
          createdAt: now,
        },
        $set: {
          ownerId,
          nodes: graph.nodes,
          edges: compactEdgesForStorage(graph.nodes, graph.edges),
          meta: graph.meta,
          updatedAt: now,
        },
      },
      upsert: true,
    },
  }));

  await col.bulkWrite(operations, { ordered: false });
}

export async function getFileGraph(
  projectId: string,
  filePath: string,
  ownerId?: string,
) {
  const client = await clientPromise;
  const db = client.db();

  const filter: Record<string, any> = { projectId, filePath };

  if (ownerId) {
    filter.ownerId = ownerId;
  }

  const doc = await db.collection(FILE_GRAPH_COLLECTION).findOne(filter);

  if (!doc) {
    return null;
  }

  return {
    ...doc,
    edges: restoreEdgeIds(doc.edges ?? [], doc.nodes ?? []),
  };
}

export async function getFileGraphs(projectId: string, ownerId?: string) {
  const client = await clientPromise;
  const db = client.db();

  const filter: Record<string, any> = { projectId };

  if (ownerId) {
    filter.ownerId = ownerId;
  }

  const docs = await db
    .collection(FILE_GRAPH_COLLECTION)
    .find(filter)
    .sort({ filePath: 1 })
    .toArray();

  return docs.map((doc) => ({
    ...doc,
    edges: restoreEdgeIds(doc.edges ?? [], doc.nodes ?? []),
  }));
}

export async function deleteFileGraphs(projectId: string, ownerId?: string) {
  const client = await clientPromise;
  const db = client.db();

  const filter: Record<string, any> = { projectId };

  if (ownerId) {
    filter.ownerId = ownerId;
  }

  return db.collection(FILE_GRAPH_COLLECTION).deleteMany(filter);
}

export async function deleteStaleFileGraphs(
  projectId: string,
  activeFilePaths: string[],
  ownerId?: string,
) {
  const client = await clientPromise;
  const db = client.db();

  const filter: Record<string, any> = {
    projectId,
    filePath: { $nin: activeFilePaths },
  };

  if (ownerId) {
    filter.ownerId = ownerId;
  }

  return db.collection(FILE_GRAPH_COLLECTION).deleteMany(filter);
}
