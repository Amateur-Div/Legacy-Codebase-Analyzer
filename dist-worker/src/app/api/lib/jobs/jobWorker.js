"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runJobStep = runJobStep;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const mongoClient_1 = __importDefault(require("../../../../lib/mongoClient"));
const jobStore_1 = require("./jobStore");
const instrumentExecutionBabel_1 = require("../instrumentExecutionBabel");
const normalizeGraphIds_1 = require("../analyzer/normalizeGraphIds");
const buildCrossFileImpactMap_1 = require("../buildCrossFileImpactMap");
const language_1 = require("../language");
const graphStore_1 = require("../graph/graphStore");
const uploadHelpers_1 = require("../uploadHelpers");
const extractCache_1 = require("../cache/extractCache");
const moduleResolverConfig_1 = require("../analyzer/moduleResolverConfig");
const fileRoleClassifier_1 = require("../analyzer/fileRoleClassifier");
const distributedImpactEngine_1 = require("../analyzer/distributedImpactEngine");
const fileGraphSummary_1 = require("../analyzer/fileGraphSummary");
const fileDependecies_1 = require("../analyzer/fileDependecies");
const enrichFileGraphSemantics_1 = require("../analyzer/enrichFileGraphSemantics");
const CHUNK_SIZE = 50;
function isBinaryFile(buffer) {
    return buffer.includes(0);
}
function isGraphSupportedFile(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
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
function walkDir(root) {
    const results = [];
    function walk(dir) {
        for (const item of fs_1.default.readdirSync(dir)) {
            if (IGNORE_DIRS.has(item))
                continue;
            const full = path_1.default.join(dir, item);
            const stat = fs_1.default.statSync(full);
            if (stat.isDirectory()) {
                walk(full);
            }
            else {
                results.push(full);
            }
        }
    }
    walk(root);
    return results;
}
function withTimeout(promise, ms = 5000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms)),
    ]);
}
function normalizeFilePath(value) {
    return value.replace(/\\/g, "/");
}
function collectFileAnalysisScopes(fileTree) {
    const entryFileIds = new Set();
    const candidateFileIds = new Set();
    const collect = (nodes) => {
        var _a, _b;
        for (const node of nodes) {
            if (node.type === "file" && node.fullPath) {
                const normalizedPath = normalizeFilePath(node.fullPath);
                const fileId = `file::${normalizedPath}`;
                if (((_a = node.entry) === null || _a === void 0 ? void 0 : _a.isLikelyEntry) && ((_b = node.entry) === null || _b === void 0 ? void 0 : _b.kind) !== "cli") {
                    entryFileIds.add(fileId);
                }
                if ((0, fileRoleClassifier_1.isDeadFileCandidateRole)(node.role)) {
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
function collectFileUniverse(fileTree) {
    const fileIds = new Set();
    const filePaths = new Set();
    const collect = (nodes) => {
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
async function runJobStep(job) {
    var _a, _b;
    if (job.status === "done")
        return;
    const db = (await mongoClient_1.default).db();
    if (!job.extractedPath) {
        const project = await db
            .collection("projects")
            .findOne({ projectId: job.projectId });
        (0, extractCache_1.ensureCacheRoot)();
        const root = (0, extractCache_1.getProjectCachePath)(job.projectId);
        fs_1.default.mkdirSync(root, { recursive: true });
        const extractRoot = path_1.default.join(root, "repo");
        (0, extractCache_1.touchCache)(job.projectId);
        fs_1.default.mkdirSync(extractRoot, { recursive: true });
        const zipPath = project === null || project === void 0 ? void 0 : project.uploadPath;
        let lastSize = -1;
        let stableCount = 0;
        for (let i = 0; i < 60; i++) {
            if (zipPath && fs_1.default.existsSync(zipPath)) {
                const size = fs_1.default.statSync(zipPath).size;
                if (size === lastSize) {
                    stableCount++;
                    if (stableCount >= 3)
                        break;
                }
                else {
                    stableCount = 0;
                    lastSize = size;
                }
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        if (!zipPath || !fs_1.default.existsSync(zipPath)) {
            throw new Error("zip not ready");
        }
        new adm_zip_1.default(zipPath).extractAllTo(extractRoot, true);
        (0, extractCache_1.cleanOldCache)();
        await (0, jobStore_1.saveJob)({
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
        const root = path_1.default.join(job.extractedPath, "repo");
        if (!job.scanFiles) {
            const scanFiles = walkDir(root);
            await (0, jobStore_1.saveJob)({
                id: job.id,
                scanFiles,
                scanCursor: 0,
                totalFiles: scanFiles.length,
                progress: 5,
                message: "Scanning repository",
            });
            return;
        }
        await (0, jobStore_1.saveJob)({
            id: job.id,
            step: "metadata",
            progress: 8,
            message: "Scan complete",
        });
        return;
    }
    if (job.step === "metadata") {
        const root = path_1.default.join(job.extractedPath, "repo");
        const allFiles = job.scanFiles.map((abs) => path_1.default.relative(root, abs).split(path_1.default.sep).join("/"));
        let resolverConfig = {
            baseUrl: "",
            paths: [],
        };
        const tsconfigPath = allFiles.find((file) => file === "tsconfig.json" || file.endsWith("/tsconfig.json"));
        if (tsconfigPath) {
            try {
                const abs = path_1.default.join(root, tsconfigPath);
                const parsed = JSON.parse(fs_1.default.readFileSync(abs, "utf-8"));
                resolverConfig = (0, moduleResolverConfig_1.createModuleResolverConfig)(parsed);
            }
            catch { }
        }
        const fileTree = await (0, uploadHelpers_1.buildFileTree)(allFiles, root);
        const insights = (0, uploadHelpers_1.calculateRepositoryInsights)(fileTree);
        let packageInfo = null;
        const pkgPath = allFiles.find((f) => f.endsWith("package.json"));
        if (pkgPath) {
            try {
                const abs = path_1.default.join(root, pkgPath);
                const parsed = JSON.parse(fs_1.default.readFileSync(abs, "utf-8"));
                packageInfo = {
                    name: parsed.name,
                    version: parsed.version,
                    scripts: parsed.scripts || {},
                    dependencies: parsed.dependencies || {},
                    devDependencies: parsed.devDependencies || {},
                };
            }
            catch { }
        }
        const entryPoints = [];
        const walkTree = (nodes) => {
            for (const n of nodes) {
                if (n.type === "file" && n.entry.isLikelyEntry) {
                    entryPoints.push(n.fullPath);
                }
                if (n.children)
                    walkTree(n.children);
            }
        };
        walkTree(fileTree);
        const tags = (0, uploadHelpers_1.detectTags)(packageInfo, fileTree);
        await db.collection("projects").updateOne({ projectId: job.projectId }, {
            $set: {
                fileTree,
                insights,
                packageInfo,
                entryPoints,
                tags,
                resolverConfig,
            },
        });
        await (0, jobStore_1.saveJob)({
            id: job.id,
            step: "file-analysis",
            cursor: 0,
            progress: 12,
            message: "Metadata extracted",
        });
        return;
    }
    if (job.step === "file-analysis") {
        const cursor = (_a = job.cursor) !== null && _a !== void 0 ? _a : 0;
        const files = job.scanFiles || [];
        const project = await db.collection("projects").findOne({
            projectId: job.projectId,
        });
        const fileTree = (project === null || project === void 0 ? void 0 : project.fileTree) || [];
        const fileMetadataMap = new Map();
        function flattenTree(nodes) {
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
            const results = await Promise.all(batch.map(async (absPath) => {
                const relPath = path_1.default
                    .relative(path_1.default.join(job.extractedPath, "repo"), absPath)
                    .split(path_1.default.sep)
                    .join("/");
                const fileMeta = fileMetadataMap.get(relPath);
                let content = "";
                try {
                    const buf = fs_1.default.readFileSync(absPath);
                    if (!isBinaryFile(buf)) {
                        content = buf.toString("utf-8");
                    }
                }
                catch { }
                let stat;
                try {
                    stat = fs_1.default.statSync(absPath);
                }
                catch {
                    return null;
                }
                let graph = { nodes: [], edges: [] };
                try {
                    if (isGraphSupportedFile(absPath)) {
                        const result = await withTimeout((0, instrumentExecutionBabel_1.instrumentExecutionBabel)(content), 5000);
                        if ((result === null || result === void 0 ? void 0 : result.nodes) && (result === null || result === void 0 ? void 0 : result.edges)) {
                            graph = (0, normalizeGraphIds_1.normalizeGraphIds)(result, relPath);
                        }
                    }
                }
                catch { }
                return {
                    relPath,
                    stat,
                    content,
                    absPath,
                    graph,
                    functions: (fileMeta === null || fileMeta === void 0 ? void 0 : fileMeta.functions) || [],
                    classes: (fileMeta === null || fileMeta === void 0 ? void 0 : fileMeta.classes) || [],
                    imports: (fileMeta === null || fileMeta === void 0 ? void 0 : fileMeta.imports) || [],
                    exports: (fileMeta === null || fileMeta === void 0 ? void 0 : fileMeta.exports) || [],
                    components: (fileMeta === null || fileMeta === void 0 ? void 0 : fileMeta.components) || [],
                };
            }));
            const docs = results.filter(Boolean).map((r) => ({
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
                            language: (0, language_1.detectLanguage)(r.relPath),
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
                .filter((r) => Boolean(r) && isGraphSupportedFile(r.relPath))
                .map((r) => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                return ({
                    filePath: r.relPath,
                    nodes: (_b = (_a = r.graph) === null || _a === void 0 ? void 0 : _a.nodes) !== null && _b !== void 0 ? _b : [],
                    edges: (_d = (_c = r.graph) === null || _c === void 0 ? void 0 : _c.edges) !== null && _d !== void 0 ? _d : [],
                    meta: {
                        file: r.relPath,
                        nodeCount: (_g = (_f = (_e = r.graph) === null || _e === void 0 ? void 0 : _e.nodes) === null || _f === void 0 ? void 0 : _f.length) !== null && _g !== void 0 ? _g : 0,
                        edgeCount: (_k = (_j = (_h = r.graph) === null || _h === void 0 ? void 0 : _h.edges) === null || _j === void 0 ? void 0 : _j.length) !== null && _k !== void 0 ? _k : 0,
                        mode: "execution",
                        generatedAt: new Date(),
                    },
                });
            });
            if (fileGraphDocs.length) {
                await (0, graphStore_1.saveFileGraphs)(job.projectId, fileGraphDocs, job.ownerId);
            }
        }
        const newCursor = Math.min(cursor + CHUNK_SIZE, files.length);
        const total = files.length;
        const progress = total === 0 ? 60 : Math.round((newCursor / total) * 60);
        if (newCursor >= total) {
            const activeFilePaths = files
                .map((absPath) => path_1.default
                .relative(path_1.default.join(job.extractedPath, "repo"), absPath)
                .split(path_1.default.sep)
                .join("/"))
                .filter(isGraphSupportedFile);
            await (0, graphStore_1.deleteStaleFileGraphs)(job.projectId, activeFilePaths, job.ownerId);
        }
        await (0, jobStore_1.saveJob)({
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
        const fileTree = (project === null || project === void 0 ? void 0 : project.fileTree) || [];
        const resolverConfig = (_b = project === null || project === void 0 ? void 0 : project.resolverConfig) !== null && _b !== void 0 ? _b : {};
        (0, buildCrossFileImpactMap_1.attachCrossFileImpact)(fileTree, resolverConfig);
        await db.collection("projects").updateOne({
            projectId: job.projectId,
            members: job.ownerId,
        }, {
            $set: {
                fileTree,
            },
        });
        const storedFileGraphs = await (0, graphStore_1.getFileGraphs)(job.projectId, job.ownerId);
        const fileGraphs = storedFileGraphs.map((doc) => {
            var _a, _b, _c;
            return ({
                file: doc.filePath,
                graph: {
                    nodes: (_a = doc.nodes) !== null && _a !== void 0 ? _a : [],
                    edges: (_b = doc.edges) !== null && _b !== void 0 ? _b : [],
                    meta: (_c = doc.meta) !== null && _c !== void 0 ? _c : {},
                },
            });
        });
        console.log("[enrich] Loaded file graphs:", {
            files: fileGraphs.length,
        });
        const { dependencies, missingNodes } = (0, fileDependecies_1.collectFileDependencies)(fileTree);
        console.log("[enrich] Project dependencies:", {
            dependencies: dependencies.length,
            missingNodes: missingNodes.length,
        });
        const summaries = (0, fileGraphSummary_1.summarizeFileGraphs)(fileGraphs);
        const summariesByFile = new Map(summaries.map((summary) => [summary.file, summary]));
        const { fileIds } = collectFileUniverse(fileTree);
        const { maxDegree, degrees } = (0, enrichFileGraphSemantics_1.calculateProjectDegrees)(fileGraphs);
        console.log("[enrich] Execution degree summary:", {
            maxDegree,
            degreeNodes: degrees.size,
        });
        const { maxDegree: maxFileDegree, metrics: fileConnectivityMetrics } = (0, enrichFileGraphSemantics_1.calculateFileConnectivityMetrics)(dependencies, fileIds);
        console.log("[enrich] File connectivity summary:", {
            maxFileDegree,
            files: fileConnectivityMetrics.length,
        });
        const { entryFileIds, candidateFileIds } = collectFileAnalysisScopes(fileTree);
        const distributedCircularDeps = (0, distributedImpactEngine_1.findCircularFileDependencies)(dependencies, fileIds);
        const distributedDeadFiles = (0, distributedImpactEngine_1.findDeadFilesDistributed)({
            fileIds,
            entryFileIds,
            candidateFileIds,
            dependencies,
        });
        const distributedImportance = (0, distributedImpactEngine_1.computeFileImportanceDistributed)({
            fileIds,
            dependencies,
            apiCounts: new Map(),
        }).slice(0, 20);
        const executionNodeCount = fileGraphs.reduce((total, { graph }) => { var _a, _b; return total + ((_b = (_a = graph.nodes) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0); }, 0);
        const executionEdgeCount = fileGraphs.reduce((total, { graph }) => { var _a, _b; return total + ((_b = (_a = graph.edges) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0); }, 0);
        const dependencyCount = dependencies.filter((dependency) => dependency.label === "imports").length;
        const dependencyAnalysis = {
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
            var _a, _b, _c;
            const summary = summariesByFile.get(file);
            const enriched = (0, enrichFileGraphSemantics_1.enrichFileGraphSemantics)(graph, maxDegree, degrees, file, (_a = summary === null || summary === void 0 ? void 0 : summary.entryNodeIds) !== null && _a !== void 0 ? _a : []);
            return {
                filePath: file,
                nodes: enriched.nodes,
                edges: enriched.edges,
                meta: {
                    ...(graph.meta || {}),
                    ...(enriched.meta || {}),
                    nodeCount: enriched.nodes.length,
                    edgeCount: enriched.edges.length,
                    mode: (_c = (_b = graph.meta) === null || _b === void 0 ? void 0 : _b.mode) !== null && _c !== void 0 ? _c : "execution",
                    generatedAt: new Date(),
                },
            };
        });
        if (enrichedFileGraphs.length) {
            await (0, graphStore_1.saveFileGraphs)(job.projectId, enrichedFileGraphs, job.ownerId);
        }
        console.log("[enrich] Saved enriched file graphs:", {
            files: enrichedFileGraphs.length,
        });
        await db.collection("projects").updateOne({
            projectId: job.projectId,
        }, {
            $set: {
                dependencyAnalysis,
            },
        });
        console.log("[intelligence] Distributed:", {
            deadFiles: distributedDeadFiles.length,
            circularDependencies: distributedCircularDeps.length,
            importanceRanking: distributedImportance.length,
        });
        await (0, jobStore_1.saveJob)({
            ...job,
            step: "save",
            progress: 90,
            message: "Enriched file graphs",
        });
        return;
    }
    if (job.step === "save") {
        await (0, jobStore_1.saveJob)({
            ...job,
            status: "done",
            step: "done",
            progress: 100,
            message: "Completed",
        });
        await db.collection("projects").updateOne({ projectId: job.projectId }, {
            $set: {
                analysisComplete: true,
            },
        });
        return;
    }
}
