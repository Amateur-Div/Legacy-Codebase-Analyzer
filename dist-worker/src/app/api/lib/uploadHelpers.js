"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractHighlights = extractHighlights;
exports.isBinaryFile = isBinaryFile;
exports.calculateRepositoryInsights = calculateRepositoryInsights;
exports.detectPackageManager = detectPackageManager;
exports.detectTags = detectTags;
exports.buildFileTree = buildFileTree;
const babelParser = __importStar(require("@babel/parser"));
const language_1 = require("./language");
const extractStructureBable_1 = require("./extractStructureBable");
const fileRoleClassifier_1 = require("./analyzer/fileRoleClassifier");
const MAX_FILE_SIZE_BYTES = 1024 * 1024;
function extractHighlights(code) {
    const ast = babelParser.parse(code, {
        sourceType: "unambiguous",
        plugins: ["jsx", "typescript", "decorators-legacy"],
        attachComment: true,
    });
    const todos = [];
    const fixmes = [];
    const notes = [];
    const comments = (ast.comments || []).map((c) => c.value.trim());
    comments.forEach((comment) => {
        const content = comment.toLowerCase();
        if (content.includes("todo"))
            todos.push(comment);
        if (content.includes("fixme"))
            fixmes.push(comment);
        if (content.includes("note"))
            notes.push(comment);
    });
    return { todos, fixmes, notes };
}
function isBinaryFile(buffer) {
    return buffer.includes(0);
}
const CATEGORY_MAP = {
    ts: "code",
    tsx: "code",
    js: "code",
    jsx: "code",
    json: "config",
    yaml: "config",
    yml: "config",
    env: "config",
    toml: "config",
    ini: "config",
    md: "docs",
    mdx: "docs",
    svg: "asset",
    png: "asset",
    jpg: "asset",
    jpeg: "asset",
    gif: "asset",
    webp: "asset",
    dockerfile: "infra",
    tf: "infra",
    sh: "script",
    bat: "script",
    graphql: "schema",
    gql: "schema",
    prisma: "schema",
    proto: "schema",
};
function getCategory(extension) {
    return CATEGORY_MAP[extension] || "other";
}
function getExtension(fileName) {
    var _a;
    const ext = (_a = fileName.split(".").pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    if (!ext || ext === fileName.toLowerCase()) {
        return "unknown";
    }
    return ext;
}
function calculateRepositoryInsights(tree) {
    let totalLOC = 0;
    let totalFiles = 0;
    let totalFolders = 0;
    let largestFile = {
        name: "",
        loc: 0,
    };
    const compositionMap = {};
    const walk = (nodes) => {
        for (const node of nodes) {
            if (node.type === "folder") {
                totalFolders++;
                if (node.children) {
                    walk(node.children);
                }
                continue;
            }
            totalFiles++;
            const loc = node.loc || 0;
            totalLOC += loc;
            if (loc > largestFile.loc) {
                largestFile = {
                    name: node.name,
                    loc,
                };
            }
            const extension = getExtension(node.name);
            const category = getCategory(extension);
            if (!compositionMap[extension]) {
                compositionMap[extension] = {
                    extension,
                    category,
                    files: 0,
                    loc: 0,
                };
            }
            compositionMap[extension].files += 1;
            if (category === "code" ||
                category === "docs" ||
                category === "schema" ||
                category === "script") {
                compositionMap[extension].loc += loc;
            }
        }
    };
    walk(tree);
    const composition = Object.values(compositionMap)
        .map((entry) => ({
        ...entry,
        filePercent: totalFiles > 0
            ? Number(((entry.files / totalFiles) * 100).toFixed(1))
            : 0,
        locPercent: totalLOC > 0 ? Number(((entry.loc / totalLOC) * 100).toFixed(1)) : 0,
    }))
        .sort((a, b) => {
        if (b.loc !== a.loc) {
            return b.loc - a.loc;
        }
        return b.files - a.files;
    });
    return {
        totalLOC,
        totalFiles,
        totalFolders,
        largestFile,
        repositoryComposition: composition,
    };
}
function detectPackageManager(files) {
    if (files.some((file) => file.endsWith("pnpm-lock.yaml"))) {
        return "pnpm";
    }
    if (files.some((file) => file.endsWith("yarn.lock"))) {
        return "yarn";
    }
    if (files.some((file) => file.endsWith("package-lock.json"))) {
        return "npm";
    }
    return "unknown";
}
function detectTags(packageInfo, fileTree) {
    const tags = new Set();
    const deps = Object.keys({
        ...packageInfo === null || packageInfo === void 0 ? void 0 : packageInfo.dependencies,
        ...packageInfo === null || packageInfo === void 0 ? void 0 : packageInfo.devDependencies,
    }).map((d) => d.toLowerCase());
    const filenames = [];
    const walk = (nodes) => {
        for (const node of nodes) {
            if (node.type === "file") {
                filenames.push(node.name.toLowerCase());
            }
            else if (node.children) {
                walk(node.children);
            }
        }
    };
    walk(fileTree);
    const techMap = {
        react: ["react", "react-dom"],
        nextjs: ["next"],
        express: ["express"],
        nestjs: ["@nestjs/core"],
        mongodb: ["mongodb", "mongoose"],
        firebase: ["firebase", "firebase-admin"],
        prisma: ["prisma"],
        tailwind: ["tailwindcss"],
        redux: ["redux", "@reduxjs/toolkit"],
        typescript: ["typescript"],
    };
    for (const [tag, matchers] of Object.entries(techMap)) {
        if (matchers.some((m) => deps.some((d) => d.includes(m)))) {
            tags.add(tag);
        }
    }
    if (filenames.includes("tailwind.config.js") ||
        filenames.includes("tailwind.config.ts")) {
        tags.add("tailwind");
    }
    if (filenames.includes("tsconfig.json")) {
        tags.add("typescript");
    }
    if (filenames.includes("docker-compose.yml")) {
        tags.add("docker");
    }
    return Array.from(tags);
}
async function buildFileTree(files, readFile) {
    var _a;
    const tree = [];
    for (const file of files) {
        if (file.includes(".spec.") ||
            file.includes(".test.") ||
            file.includes("/e2e/") ||
            file.includes("/__tests__/")) {
            continue;
        }
        const normalizedFile = file.replace(/\\/g, "/").replace(/\/$/, "");
        const parts = normalizedFile.split("/").filter(Boolean);
        let current = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile = i === parts.length - 1;
            const fullPath = parts.slice(0, i + 1).join("/");
            let existing = current.find((item) => item.name === part);
            if (!existing) {
                let size;
                let loc;
                let highlights;
                let imports = [];
                let functions = [];
                let classes = [];
                let components = [];
                let exports = [];
                let blocks = [];
                let apis = [];
                let schemas = [];
                let classification = (0, fileRoleClassifier_1.classifyRepositoryFile)(file, "");
                if (isFile) {
                    try {
                        const result = await readFile(fullPath, MAX_FILE_SIZE_BYTES);
                        size = result.size;
                        const buffer = result.buffer;
                        if (buffer && !isBinaryFile(buffer)) {
                            const content = buffer.toString("utf-8");
                            loc = content.split("\n").length;
                            classification = (0, fileRoleClassifier_1.classifyRepositoryFile)(file, content);
                            const ext = (_a = part.split(".").pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase();
                            if (["js", "ts", "jsx", "tsx"].includes(ext || "")) {
                                highlights = extractHighlights(content);
                                const symbols = (0, extractStructureBable_1.extractStructureBabel)(fullPath, content);
                                imports = symbols.imports;
                                functions = symbols.functions;
                                classes = symbols.classes;
                                components = symbols.components;
                                exports = symbols.exports;
                                apis = symbols.apis;
                                schemas = symbols.schemas;
                                blocks = symbols.blocks;
                            }
                        }
                    }
                    catch (error) {
                        console.warn("Failed to read repository file:", fullPath, error);
                    }
                }
                const language = (0, language_1.detectLanguage)(fullPath);
                const languageColor = (0, language_1.getLanguageColor)(language);
                existing = {
                    name: part,
                    type: isFile ? "file" : "folder",
                    fullPath: isFile ? fullPath : undefined,
                    size,
                    loc,
                    language,
                    languageColor,
                    imports,
                    highlights,
                    functions,
                    classes,
                    blocks,
                    components,
                    exports,
                    apis,
                    schemas,
                    role: classification.role,
                    entry: classification.entry,
                    children: isFile ? undefined : [],
                };
                current.push(existing);
            }
            if (!isFile) {
                current = existing.children;
            }
        }
    }
    return tree;
}
