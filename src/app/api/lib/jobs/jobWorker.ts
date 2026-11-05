import path from "path";
import clientPromise from "../../../../lib/mongoClient";
import { saveJob } from "./jobStore";
import { instrumentExecutionBabel } from "../instrumentExecutionBabel";
import { normalizeGraphIds } from "../analyzer/normalizeGraphIds";
import { attachCrossFileImpact } from "../buildCrossFileImpactMap";
import { detectLanguage } from "../language";
import {
  deleteStaleFileGraphs,
  getFileGraphs,
  saveFileGraphs,
} from "../graph/graphStore";
import {
  buildFileTree,
  calculateRepositoryInsights,
  detectTags,
} from "../uploadHelpers";
import {
  createModuleResolverConfig,
  type ModuleResolverConfig,
} from "../analyzer/moduleResolverConfig";
import { isDeadFileCandidateRole } from "../analyzer/fileRoleClassifier";
import {
  computeFileImportanceDistributed,
  findCircularFileDependencies,
  findDeadFilesDistributed,
} from "../analyzer/distributedImpactEngine";
import { summarizeFileGraphs } from "../analyzer/fileGraphSummary";
import { collectFileDependencies } from "../analyzer/fileDependecies";
import {
  calculateFileConnectivityMetrics,
  calculateProjectDegrees,
  enrichFileGraphSemantics,
} from "../analyzer/enrichFileGraphSemantics";
import { ProjectDependencyAnalysis } from "../analyzer/types";
import { downloadRepositoryArchive } from "./repositoryArchive";
import { createRepositoryReader, RepositoryReader } from "./repositoryReader";

const CHUNK_SIZE = 50;

function isBinaryFile(buffer: Buffer) {
  return buffer.includes(0);
}

function isGraphSupportedFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  return [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext);
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

interface ActiveRepository {
  reader: RepositoryReader;
  cleanupArchive: () => Promise<void>;
}

const activeRepositories = new Map<string, ActiveRepository>();
const repositoryReaderPromises = new Map<string, Promise<RepositoryReader>>();

async function getRepositoryReader(
  job: any,
  db: any,
): Promise<RepositoryReader> {
  const existing = activeRepositories.get(job.id);

  if (existing) {
    return existing.reader;
  }

  const inFlight = repositoryReaderPromises.get(job.id);

  if (inFlight) {
    return inFlight;
  }

  const initializationPromise = (async () => {
    const project = await db.collection("projects").findOne({
      projectId: job.projectId,
      ownerId: job.ownerId,
    });

    const blobPathname = project?.blobPathname;

    if (
      typeof blobPathname !== "string" ||
      !blobPathname.startsWith("repository-uploads/")
    ) {
      throw new Error("Project repository Blob pathname is missing");
    }

    const archiveBuffer = await downloadRepositoryArchive(blobPathname);

    try {
      const reader = await createRepositoryReader(archiveBuffer, {
        ignoredDirectories: IGNORE_DIRS,
      });

      activeRepositories.set(job.id, {
        reader,
        cleanupArchive: async () => {},
      });

      return reader;
    } catch (error) {
      archiveBuffer.fill(0);
      throw error;
    }
  })();

  repositoryReaderPromises.set(job.id, initializationPromise);

  try {
    return await initializationPromise;
  } finally {
    if (repositoryReaderPromises.get(job.id) === initializationPromise) {
      repositoryReaderPromises.delete(job.id);
    }
  }
}

export async function cleanupRepositoryReader(jobId: string): Promise<void> {
  const active = activeRepositories.get(jobId);

  if (!active) return;

  activeRepositories.delete(jobId);

  try {
    await active.reader.close();
  } finally {
    await active.cleanupArchive();
  }
}

function withTimeout(promise: any, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms),
    ),
  ]);
}

function normalizeFilePath(value: string) {
  return value.replace(/\\/g, "/");
}

function collectFileAnalysisScopes(fileTree: any[]) {
  const entryFileIds = new Set<string>();
  const candidateFileIds = new Set<string>();

  const collect = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "file" && node.fullPath) {
        const normalizedPath = normalizeFilePath(node.fullPath);
        const fileId = `file::${normalizedPath}`;

        if (node.entry?.isLikelyEntry && node.entry?.kind !== "cli") {
          entryFileIds.add(fileId);
        }

        if (isDeadFileCandidateRole(node.role)) {
          candidateFileIds.add(fileId);
        }
      }

      if (Array.isArray(node.children)) {
        collect(node.children);
      }
    }
  };

  collect(fileTree);

  return {
    entryFileIds,
    candidateFileIds,
  };
}

function collectFileUniverse(fileTree: any[]) {
  const fileIds = new Set<string>();
  const filePaths = new Set<string>();

  const collect = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "file" && node.fullPath) {
        const normalizedPath = normalizeFilePath(node.fullPath);

        filePaths.add(normalizedPath);
        fileIds.add(`file::${normalizedPath}`);
      }

      if (Array.isArray(node.children)) {
        collect(node.children);
      }
    }
  };

  collect(fileTree);

  return {
    fileIds,
    filePaths,
  };
}

export class StaleAnalysisJobError extends Error {
  constructor(jobId: string) {
    super(`Analysis job is no longer active: ${jobId}`);
    this.name = "StaleAnalysisJobError";
  }
}

async function assertActiveAnalysisJob(job: {
  id: string;
  projectId: string;
  ownerId: string;
}) {
  const db = (await clientPromise).db();

  const project = await db.collection("projects").findOne(
    {
      projectId: job.projectId,
      ownerId: job.ownerId,
      activeAnalysisJobId: job.id,
    },
    {
      projection: { _id: 1 },
    },
  );

  if (!project) {
    throw new StaleAnalysisJobError(job.id);
  }
}

export async function runJobStep(job: any) {
  if (job.status === "done") return;

  await assertActiveAnalysisJob(job);

  const db = (await clientPromise).db();

  if (job.step === "initializing" || !job.step) {
    const reader = await getRepositoryReader(job, db);

    await saveJob({
      id: job.id,
      step: "scan",
      status: "running",
      progress: 2,
      totalFiles: reader.files.length,
      message: "Repository archive ready",
    });

    return;
  }

  if (job.step === "scan") {
    const reader = await getRepositoryReader(job, db);

    if (!job.scanFiles) {
      const scanFiles = reader.files;

      await saveJob({
        id: job.id,
        scanFiles,
        scanCursor: 0,
        totalFiles: scanFiles.length,
        progress: 5,
        message: "Scanning repository",
      });

      return;
    }

    await saveJob({
      id: job.id,
      step: "metadata",
      progress: 8,
      message: "Scan complete",
    });

    return;
  }

  if (job.step === "metadata") {
    const reader = await getRepositoryReader(job, db);

    const allFiles: string[] = job.scanFiles || [];

    let resolverConfig: ModuleResolverConfig = {
      baseUrl: "",
      paths: [],
    };

    const MAX_METADATA_FILE_BYTES = 1024 * 1024;

    const tsconfigPath = allFiles.find(
      (file: string) =>
        file === "tsconfig.json" || file.endsWith("/tsconfig.json"),
    );

    if (tsconfigPath) {
      try {
        const result = await reader.readFile(
          tsconfigPath,
          MAX_METADATA_FILE_BYTES,
        );

        if (result.buffer) {
          const parsed = JSON.parse(result.buffer.toString("utf-8"));
          resolverConfig = createModuleResolverConfig(parsed);
        }
      } catch (error) {
        console.warn("[metadata] Unable to parse tsconfig.json:", error);
      }
    }

    const fileTree = await buildFileTree(
      allFiles,
      async (relativePath, maxBytes) => {
        return reader.readFile(relativePath, maxBytes);
      },
    );

    const insights = calculateRepositoryInsights(fileTree);

    let packageInfo = null;

    const pkgPath = allFiles.find((file: string) =>
      file.endsWith("package.json"),
    );

    if (pkgPath) {
      try {
        const result = await reader.readFile(pkgPath, MAX_METADATA_FILE_BYTES);

        if (result.buffer) {
          const parsed = JSON.parse(result.buffer.toString("utf-8"));

          packageInfo = {
            name: parsed.name,
            version: parsed.version,
            scripts: parsed.scripts || {},
            dependencies: parsed.dependencies || {},
            devDependencies: parsed.devDependencies || {},
          };
        }
      } catch (error) {
        console.warn("[metadata] Unable to parse package.json:", error);
      }
    }

    const entryPoints: string[] = [];

    const walkTree = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.type === "file" && node.entry?.isLikelyEntry) {
          entryPoints.push(node.fullPath);
        }

        if (node.children) {
          walkTree(node.children);
        }
      }
    };

    walkTree(fileTree);

    const tags = detectTags(packageInfo, fileTree);

    const metadataUpdate = await db.collection("projects").updateOne(
      {
        projectId: job.projectId,
        ownerId: job.ownerId,
        activeAnalysisJobId: job.id,
      },
      {
        $set: {
          fileTree,
          insights,
          packageInfo,
          entryPoints,
          tags,
          resolverConfig,
        },
      },
    );

    if (metadataUpdate.matchedCount !== 1) {
      throw new Error("Project metadata write was rejected");
    }

    await saveJob({
      id: job.id,
      step: "file-analysis",
      cursor: 0,
      progress: 12,
      message: "Metadata extracted",
    });

    return;
  }

  if (job.step === "file-analysis") {
    const reader = await getRepositoryReader(job, db);

    const cursor = job.cursor ?? 0;
    const files: string[] = job.scanFiles || [];

    const project = await db.collection("projects").findOne({
      projectId: job.projectId,
    });

    const fileTree = project?.fileTree || [];

    const fileMetadataMap = new Map();

    function flattenTree(nodes: any[]) {
      for (const node of nodes) {
        if (node.type === "file" && node.fullPath) {
          fileMetadataMap.set(node.fullPath, {
            functions: node.functions || [],
            classes: node.classes || [],
            imports: node.imports || [],
            exports: node.exports || [],
            components: node.components || [],
          });
        }

        if (node.children) {
          flattenTree(node.children);
        }
      }
    }

    flattenTree(fileTree);

    const slice = files.slice(cursor, cursor + CHUNK_SIZE);
    const MAX_DB_FILE_SIZE = 100 * 1024;
    const MAX_ANALYSIS_FILE_BYTES = 1024 * 1024;
    const PARALLEL = 5;

    for (let i = 0; i < slice.length; i += PARALLEL) {
      const batch = slice.slice(i, i + PARALLEL);

      const results = await Promise.all(
        batch.map(async (relPath: string) => {
          const fileMeta = fileMetadataMap.get(relPath);

          let content = "";
          let size = 0;

          try {
            const result = await reader.readFile(
              relPath,
              MAX_ANALYSIS_FILE_BYTES,
            );

            size = result.size;

            if (result.buffer && !isBinaryFile(result.buffer)) {
              content = result.buffer.toString("utf-8");
            }
          } catch (error) {
            console.warn(
              "[file-analysis] Unable to read file:",
              relPath,
              error,
            );
            return null;
          }

          let graph: any = { nodes: [], edges: [] };

          try {
            if (isGraphSupportedFile(relPath) && content) {
              const result = await withTimeout(
                instrumentExecutionBabel(content),
                5000,
              );

              if (result?.nodes && result?.edges) {
                graph = normalizeGraphIds(result, relPath);
              }
            }
          } catch {}

          return {
            relPath,
            size,
            content,
            graph,
            functions: fileMeta?.functions || [],
            classes: fileMeta?.classes || [],
            imports: fileMeta?.imports || [],
            exports: fileMeta?.exports || [],
            components: fileMeta?.components || [],
          };
        }),
      );

      const docs = results.filter(Boolean).map((r: any) => {
        const update: Record<string, any> = {
          $set: {
            projectId: job.projectId,
            path: r.relPath,
            size: r.size,
            language: detectLanguage(r.relPath),
            isCode: isGraphSupportedFile(r.relPath),
            functions: r.functions,
            classes: r.classes,
            imports: r.imports,
            exports: r.exports,
            components: r.components,
          },
        };

        if (r.size <= MAX_DB_FILE_SIZE) {
          update.$set.content = r.content;
        } else {
          update.$unset = {
            content: "",
          };
        }

        return {
          updateOne: {
            filter: {
              projectId: job.projectId,
              path: r.relPath,
            },
            update,
            upsert: true,
          },
        };
      });

      if (docs.length) {
        await db.collection("project_files").bulkWrite(docs);
      }

      const fileGraphDocs = results
        .filter(
          (r: any): r is NonNullable<typeof r> =>
            Boolean(r) && isGraphSupportedFile(r.relPath),
        )
        .map((r: any) => ({
          filePath: r.relPath,
          nodes: r.graph?.nodes ?? [],
          edges: r.graph?.edges ?? [],
          meta: {
            file: r.relPath,
            nodeCount: r.graph?.nodes?.length ?? 0,
            edgeCount: r.graph?.edges?.length ?? 0,
            mode: "execution",
            generatedAt: new Date(),
          },
        }));

      if (fileGraphDocs.length) {
        await saveFileGraphs(job.projectId, fileGraphDocs, job.ownerId);
      }
    }

    const newCursor = Math.min(cursor + CHUNK_SIZE, files.length);

    const total = files.length;
    const progress = total === 0 ? 60 : Math.round((newCursor / total) * 60);

    if (newCursor >= total) {
      const activeFilePaths = files.filter(isGraphSupportedFile);
      await deleteStaleFileGraphs(job.projectId, activeFilePaths, job.ownerId);
    }

    await saveJob({
      id: job.id,
      cursor: newCursor,
      progress,
      step: newCursor >= total ? "enrich" : "file-analysis",
      message: `Analyzed ${newCursor}/${total}`,
    });

    return;
  }

  if (job.step === "enrich") {
    const project = await db.collection("projects").findOne({
      projectId: job.projectId,
      ownerId: job.ownerId,
    });

    if (!project) {
      throw new Error("Project not found or ownership validation failed");
    }

    const fileTree = project?.fileTree || [];

    const resolverConfig = project?.resolverConfig ?? {};

    attachCrossFileImpact(fileTree, resolverConfig);

    const fileTreeUpdate = await db.collection("projects").updateOne(
      {
        projectId: job.projectId,
        ownerId: job.ownerId,
        activeAnalysisJobId: job.id,
      },
      {
        $set: {
          fileTree,
        },
      },
    );

    if (fileTreeUpdate.matchedCount !== 1) {
      throw new Error("Unable to update project file tree");
    }

    const storedFileGraphs = await getFileGraphs(job.projectId, job.ownerId);

    const fileGraphs = storedFileGraphs.map((doc: any) => ({
      file: doc.filePath,
      graph: {
        nodes: doc.nodes ?? [],
        edges: doc.edges ?? [],
        meta: doc.meta ?? {},
      },
    }));

    console.log("[enrich] Loaded file graphs:", {
      files: fileGraphs.length,
    });

    const { dependencies, missingNodes } = collectFileDependencies(fileTree);

    console.log("[enrich] Project dependencies:", {
      dependencies: dependencies.length,
      missingNodes: missingNodes.length,
    });

    const summaries = summarizeFileGraphs(fileGraphs);

    const summariesByFile = new Map(
      summaries.map((summary) => [summary.file, summary]),
    );

    const { fileIds } = collectFileUniverse(fileTree);

    const { maxDegree, degrees } = calculateProjectDegrees(fileGraphs);

    console.log("[enrich] Execution degree summary:", {
      maxDegree,
      degreeNodes: degrees.size,
    });

    const { maxDegree: maxFileDegree, metrics: fileConnectivityMetrics } =
      calculateFileConnectivityMetrics(dependencies, fileIds);

    console.log("[enrich] File connectivity summary:", {
      maxFileDegree,
      files: fileConnectivityMetrics.length,
    });

    const { entryFileIds, candidateFileIds } =
      collectFileAnalysisScopes(fileTree);

    const distributedCircularDeps = findCircularFileDependencies(
      dependencies,
      fileIds,
    );

    const distributedDeadFiles = findDeadFilesDistributed({
      fileIds,
      entryFileIds,
      candidateFileIds,
      dependencies,
    });

    const distributedImportance = computeFileImportanceDistributed({
      fileIds,
      dependencies,
      apiCounts: new Map(),
    }).slice(0, 20);

    const executionNodeCount = fileGraphs.reduce(
      (total, { graph }) => total + (graph.nodes?.length ?? 0),
      0,
    );

    const executionEdgeCount = fileGraphs.reduce(
      (total, { graph }) => total + (graph.edges?.length ?? 0),
      0,
    );

    const dependencyCount = dependencies.filter(
      (dependency) => dependency.label === "imports",
    ).length;

    const dependencyAnalysis: ProjectDependencyAnalysis = {
      version: 2,
      generatedAt: new Date(),

      stats: {
        fileCount: fileIds.size,
        executionNodeCount,
        executionEdgeCount,
        dependencyCount,
        missingDependencyCount: missingNodes.length,
      },

      fileMetrics: fileConnectivityMetrics,

      intelligence: {
        deadFiles: distributedDeadFiles,
        circularDependencies: distributedCircularDeps,
        importanceRanking: distributedImportance,
      },
    };

    const enrichedFileGraphs = fileGraphs.map(({ file, graph }) => {
      const summary = summariesByFile.get(file);

      const enriched = enrichFileGraphSemantics(
        graph,
        maxDegree,
        degrees,
        file,
        summary?.entryNodeIds ?? [],
      );

      return {
        filePath: file,
        nodes: enriched.nodes,
        edges: enriched.edges,
        meta: {
          ...(graph.meta || {}),
          ...(enriched.meta || {}),
          nodeCount: enriched.nodes.length,
          edgeCount: enriched.edges.length,
          mode: graph.meta?.mode ?? "execution",
          generatedAt: new Date(),
        },
      };
    });

    if (enrichedFileGraphs.length) {
      await saveFileGraphs(job.projectId, enrichedFileGraphs, job.ownerId);
    }

    console.log("[enrich] Saved enriched file graphs:", {
      files: enrichedFileGraphs.length,
    });

    const dependencyUpdate = await db.collection("projects").updateOne(
      {
        projectId: job.projectId,
        ownerId: job.ownerId,
      },
      {
        $set: {
          dependencyAnalysis,
        },
      },
    );

    if (dependencyUpdate.matchedCount !== 1) {
      throw new Error("Unable to save project dependency analysis");
    }

    console.log("[intelligence] Distributed:", {
      deadFiles: distributedDeadFiles.length,
      circularDependencies: distributedCircularDeps.length,
      importanceRanking: distributedImportance.length,
    });

    await saveJob({
      ...job,
      step: "save",
      progress: 90,
      message: "Enriched file graphs",
    });

    return;
  }

  if (job.step === "save") {
    const projectUpdate = await db.collection("projects").updateOne(
      {
        projectId: job.projectId,
        ownerId: job.ownerId,
        activeAnalysisJobId: job.id,
      },
      {
        $set: {
          analysisComplete: true,
        },
      },
    );

    if (projectUpdate.matchedCount !== 1) {
      throw new Error("Unable to finalize project analysis");
    }

    await saveJob({
      id: job.id,
      status: "done",
      step: "done",
      progress: 100,
      message: "Completed",
    });

    await cleanupRepositoryReader(job.id);

    return;
  }

  throw new Error(`Unsupported analysis job step: ${job.step}`);
}
