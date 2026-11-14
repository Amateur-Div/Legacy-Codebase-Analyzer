import clientPromise from "../../../../lib/mongoClient";
import type { CallGraphExtraction } from "../callGraphExtractor";
import type {
  CallGraphResolutionResult,
  ResolvedCallEdge,
} from "../callGraphResolver";

const COLLECTION = "file_call_graphs";

export type FileCallGraphInput = {
  filePath: string;
  sourceHash: string;
  graph: CallGraphExtraction;
};

export type StoredFileCallGraph = CallGraphExtraction & {
  projectId: string;
  ownerId: string;
  sourceHash: string;
  generatedAt: Date;
  edges: ResolvedCallEdge[];
  resolutionDiagnostics: CallGraphResolutionResult["diagnostics"];
};

let indexesPromise: Promise<void> | null = null;

async function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const client = await clientPromise;
      const collection = client.db().collection(COLLECTION);
      await collection.createIndex(
        { ownerId: 1, projectId: 1, filePath: 1 },
        { unique: true, name: "unique_owner_project_file_call_graph" },
      );
    })();
  }

  try {
    await indexesPromise;
  } catch (error) {
    indexesPromise = null;
    throw error;
  }
}

export async function saveFileCallGraphs(
  projectId: string,
  ownerId: string,
  records: FileCallGraphInput[],
) {
  if (!records.length) return;

  await ensureIndexes();
  const client = await clientPromise;
  const collection = client.db().collection(COLLECTION);
  const now = new Date();

  await collection.bulkWrite(
    records.map(({ filePath, sourceHash, graph }) => ({
      updateOne: {
        filter: { ownerId, projectId, filePath },
        update: {
          $setOnInsert: {
            ownerId,
            projectId,
            filePath,
            createdAt: now,
          },
          $set: {
            schemaVersion: graph.schemaVersion,
            sourceHash,
            symbols: graph.symbols,
            imports: graph.imports,
            exports: graph.exports,
            callSites: graph.callSites,
            diagnostics: graph.diagnostics,
            generatedAt: now,
            updatedAt: now,
          },
          $unset: {
            edges: "",
            resolutionDiagnostics: "",
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function getFileCallGraphs(
  projectId: string,
  ownerId: string,
): Promise<CallGraphExtraction[]> {
  await ensureIndexes();
  const client = await clientPromise;
  const docs = await client
    .db()
    .collection(COLLECTION)
    .find({ ownerId, projectId })
    .sort({ filePath: 1 })
    .toArray();

  return docs.map((doc) => ({
    schemaVersion: doc.schemaVersion,
    filePath: doc.filePath,
    symbols: doc.symbols ?? [],
    imports: doc.imports ?? [],
    exports: doc.exports ?? [],
    callSites: doc.callSites ?? [],
    diagnostics: doc.diagnostics ?? [],
  }));
}

export type ResolvedFileCallGraph = CallGraphExtraction & {
  edges: ResolvedCallEdge[];
  resolutionDiagnostics: CallGraphResolutionResult["diagnostics"];
};

export async function getFileCallGraphsByPaths(
  projectId: string,
  ownerId: string,
  filePaths: string[],
): Promise<ResolvedFileCallGraph[]> {
  const uniquePaths = [...new Set(filePaths)].filter(Boolean);
  if (!uniquePaths.length) return [];

  await ensureIndexes();
  const client = await clientPromise;
  const docs = await client
    .db()
    .collection(COLLECTION)
    .find({
      ownerId,
      projectId,
      filePath: { $in: uniquePaths },
    })
    .toArray();

  return docs.map((doc) => ({
    schemaVersion: doc.schemaVersion,
    filePath: doc.filePath,
    symbols: doc.symbols ?? [],
    imports: doc.imports ?? [],
    exports: doc.exports ?? [],
    callSites: doc.callSites ?? [],
    diagnostics: doc.diagnostics ?? [],
    edges: doc.edges ?? [],
    resolutionDiagnostics: doc.resolutionDiagnostics ?? [],
  }));
}

export async function saveResolvedFileCallGraphs(
  projectId: string,
  ownerId: string,
  result: CallGraphResolutionResult,
) {
  if (!result.files.length) return;

  await ensureIndexes();
  const client = await clientPromise;
  const collection = client.db().collection(COLLECTION);
  const now = new Date();

  await collection.bulkWrite(
    result.files.map((graph) => ({
      updateOne: {
        filter: { ownerId, projectId, filePath: graph.filePath },
        update: {
          $set: {
            schemaVersion: graph.schemaVersion,
            symbols: graph.symbols,
            imports: graph.imports,
            exports: graph.exports,
            callSites: graph.callSites,
            edges: result.edges.filter(
              (edge) => edge.fromFilePath === graph.filePath,
            ),
            diagnostics: graph.diagnostics,
            resolutionDiagnostics: result.diagnostics.filter(
              (diagnostic) => diagnostic.filePath === graph.filePath,
            ),
            resolvedAt: now,
            updatedAt: now,
          },
        },
      },
    })),
    { ordered: false },
  );
}

export async function deleteStaleFileCallGraphs(
  projectId: string,
  ownerId: string,
  activeFilePaths: string[],
) {
  await ensureIndexes();
  const client = await clientPromise;
  return client.db().collection(COLLECTION).deleteMany({
    ownerId,
    projectId,
    filePath: { $nin: activeFilePaths },
  });
}

export async function deleteFileCallGraphs(
  projectId: string,
  ownerId: string,
) {
  await ensureIndexes();
  const client = await clientPromise;
  return client.db().collection(COLLECTION).deleteMany({
    ownerId,
    projectId,
  });
}
