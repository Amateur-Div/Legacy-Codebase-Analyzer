import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
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
  cleanOldCache,
  ensureCacheRoot,
  getProjectCachePath,
  touchCache,
} from "../cache/extractCache";
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

function walkDir(root: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    for (const item of fs.readdirSync(dir)) {
      if (IGNORE_DIRS.has(item)) continue;

      const full = path.join(dir, item);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        walk(full);
      } else {
        results.push(full);
      }
    }
  }

  walk(root);
  return results;
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

export async function runJobStep(job: any) {
  if (job.status === "done") return;

  const db = (await clientPromise).db();

  if (!job.extractedPath) {
    const project = await db
      .collection("projects")
      .findOne({ projectId: job.projectId });

    ensureCacheRoot();

    const root = getProjectCachePath(job.projectId);

    fs.mkdirSync(root, { recursive: true });

    const extractRoot = path.join(root, "repo");

    touchCache(job.projectId);

    fs.mkdirSync(extractRoot, { recursive: true });

    const zipPath = project?.uploadPath;

    let lastSize = -1;
    let stableCount = 0;

    for (let i = 0; i < 60; i++) {
      if (zipPath && fs.existsSync(zipPath)) {
        const size = fs.statSync(zipPath).size;

        if (size === lastSize) {
          stableCount++;

          if (stableCount >= 3) break;
        } else {
          stableCount = 0;
          lastSize = size;
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    if (!zipPath || !fs.existsSync(zipPath)) {
      throw new Error("zip not ready");
    }

    new AdmZip(zipPath).extractAllTo(extractRoot, true);

    cleanOldCache();

    await saveJob({
      id: job.id,
      extractedPath: root,
      step: "scan",
      status: "running",
      progress: 2,
      message: "Repository extracted",
    });

    return;
  }

  if (job.step === "scan") {
    const root = path.join(job.extractedPath, "repo");

    if (!job.scanFiles) {
      const scanFiles = walkDir(root);

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
    const root = path.join(job.extractedPath, "repo");

    const allFiles = job.scanFiles.map((abs: string) =>
      path.relative(root, abs).split(path.sep).join("/"),
    );

    let resolverConfig: ModuleResolverConfig = {
      baseUrl: "",
      paths: [],
    };

    const tsconfigPath = allFiles.find(
      (file: string) =>
        file === "tsconfig.json" || file.endsWith("/tsconfig.json"),
    );

    if (tsconfigPath) {
      try {
        const abs = path.join(root, tsconfigPath);
        const parsed = JSON.parse(fs.readFileSync(abs, "utf-8"));

        resolverConfig = createModuleResolverConfig(parsed);
      } catch {}
    }

    const fileTree = await buildFileTree(allFiles, root);
    const insights = calculateRepositoryInsights(fileTree);

    let packageInfo = null;

    const pkgPath = allFiles.find((f: string) => f.endsWith("package.json"));

    if (pkgPath) {
      try {
        const abs = path.join(root, pkgPath);
        const parsed = JSON.parse(fs.readFileSync(abs, "utf-8"));

        packageInfo = {
          name: parsed.name,
          version: parsed.version,
          scripts: parsed.scripts || {},
          dependencies: parsed.dependencies || {},
          devDependencies: parsed.devDependencies || {},
        };
      } catch {}
    }

    const entryPoints: string[] = [];

    const walkTree = (nodes: any[]) => {
      for (const n of nodes) {
        if (n.type === "file" && n.entry.isLikelyEntry) {
          entryPoints.push(n.fullPath);
        }
        if (n.children) walkTree(n.children);
      }
    };

    walkTree(fileTree);

    const tags = detectTags(packageInfo, fileTree);

    await db.collection("projects").updateOne(
      { projectId: job.projectId },
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
    const cursor = job.cursor ?? 0;

    const files = job.scanFiles || [];
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
    const PARALLEL = 5;

    for (let i = 0; i < slice.length; i += PARALLEL) {
      const batch = slice.slice(i, i + PARALLEL);

      const results = await Promise.all(
        batch.map(async (absPath: any) => {
          const relPath = path
            .relative(path.join(job.extractedPath, "repo"), absPath)
            .split(path.sep)
            .join("/");

          const fileMeta = fileMetadataMap.get(relPath);

          let content = "";

          try {
            const buf = fs.readFileSync(absPath);
            if (!isBinaryFile(buf)) {
              content = buf.toString("utf-8");
            }
          } catch {}

          let stat;
          try {
            stat = fs.statSync(absPath);
          } catch {
            return null;
          }

          let graph: any = { nodes: [], edges: [] };

          try {
            if (isGraphSupportedFile(absPath)) {
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
            stat,
            content,
            absPath,
            graph,
            functions: fileMeta?.functions || [],
            classes: fileMeta?.classes || [],
            imports: fileMeta?.imports || [],
            exports: fileMeta?.exports || [],
            components: fileMeta?.components || [],
          };
        }),
      );

      const docs = results.filter(Boolean).map((r: any) => ({
        updateOne: {
          filter: {
            projectId: job.projectId,
            path: r.relPath,
          },
          update: {
            $set: {
              projectId: job.projectId,
              path: r.relPath,
              size: r.stat.size,
              language: detectLanguage(r.relPath),
              isCode: isGraphSupportedFile(r.relPath),
              content: r.stat.size <= MAX_DB_FILE_SIZE ? r.content : undefined,
              functions: r.functions,
              classes: r.classes,
              imports: r.imports,
              exports: r.exports,
              components: r.components,
            },
          },
          upsert: true,
        },
      }));

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
      const activeFilePaths = files
        .map((absPath: string) =>
          path
            .relative(path.join(job.extractedPath, "repo"), absPath)
            .split(path.sep)
            .join("/"),
        )
        .filter(isGraphSupportedFile);

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
      members: job.ownerId,
    });

    const fileTree = project?.fileTree || [];

    const resolverConfig = project?.resolverConfig ?? {};

    attachCrossFileImpact(fileTree, resolverConfig);

    await db.collection("projects").updateOne(
      {
        projectId: job.projectId,
        members: job.ownerId,
      },
      {
        $set: {
          fileTree,
        },
      },
    );

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

    await db.collection("projects").updateOne(
      {
        projectId: job.projectId,
      },
      {
        $set: {
          dependencyAnalysis,
        },
      },
    );

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
    await saveJob({
      ...job,
      status: "done",
      step: "done",
      progress: 100,
      message: "Completed",
    });

    await db.collection("projects").updateOne(
      { projectId: job.projectId },
      {
        $set: {
          analysisComplete: true,
        },
      },
    );

    return;
  }
}
