import * as babelParser from "@babel/parser";
import { detectLanguage, getLanguageColor } from "./language";
import { extractStructureBabel } from "./extractStructureBable";
import { classifyRepositoryFile } from "./analyzer/fileRoleClassifier";

const MAX_FILE_SIZE_BYTES = 1024 * 1024;

type FileNode = {
  type: "file" | "folder";
  name: string;
  loc?: number;
  children?: FileNode[];
};

type CompositionEntry = {
  extension: string;
  category: string;
  files: number;
  loc: number;
  filePercent: number;
  locPercent: number;
};

export function extractHighlights(code: string) {
  const ast = babelParser.parse(code, {
    sourceType: "unambiguous",
    plugins: ["jsx", "typescript", "decorators-legacy"],
    attachComment: true,
  });

  const todos: string[] = [];
  const fixmes: string[] = [];
  const notes: string[] = [];

  const comments = (ast.comments || []).map((c) => c.value.trim());

  comments.forEach((comment) => {
    const content = comment.toLowerCase();
    if (content.includes("todo")) todos.push(comment);
    if (content.includes("fixme")) fixmes.push(comment);
    if (content.includes("note")) notes.push(comment);
  });

  return { todos, fixmes, notes };
}

export function isBinaryFile(buffer: Buffer) {
  return buffer.includes(0);
}

const CATEGORY_MAP: Record<string, string> = {
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

function getCategory(extension: string) {
  return CATEGORY_MAP[extension] || "other";
}

function getExtension(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (!ext || ext === fileName.toLowerCase()) {
    return "unknown";
  }

  return ext;
}

export function calculateRepositoryInsights(tree: FileNode[]) {
  let totalLOC = 0;
  let totalFiles = 0;
  let totalFolders = 0;

  let largestFile = {
    name: "",
    loc: 0,
  };

  const compositionMap: Record<
    string,
    {
      extension: string;
      category: string;
      files: number;
      loc: number;
    }
  > = {};

  const walk = (nodes: FileNode[]) => {
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

      if (
        category === "code" ||
        category === "docs" ||
        category === "schema" ||
        category === "script"
      ) {
        compositionMap[extension].loc += loc;
      }
    }
  };

  walk(tree);

  const composition: CompositionEntry[] = Object.values(compositionMap)
    .map((entry) => ({
      ...entry,

      filePercent:
        totalFiles > 0
          ? Number(((entry.files / totalFiles) * 100).toFixed(1))
          : 0,

      locPercent:
        totalLOC > 0 ? Number(((entry.loc / totalLOC) * 100).toFixed(1)) : 0,
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

export function detectPackageManager(files: string[]): string {
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

export function detectTags(packageInfo: any, fileTree: any[]): string[] {
  const tags = new Set<string>();

  const deps = Object.keys({
    ...packageInfo?.dependencies,
    ...packageInfo?.devDependencies,
  }).map((d) => d.toLowerCase());

  const filenames: string[] = [];

  const walk = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "file") {
        filenames.push(node.name.toLowerCase());
      } else if (node.children) {
        walk(node.children);
      }
    }
  };

  walk(fileTree);

  const techMap: Record<string, string[]> = {
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

  if (
    filenames.includes("tailwind.config.js") ||
    filenames.includes("tailwind.config.ts")
  ) {
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

export type RepositoryFileReadResult = {
  size: number;
  buffer?: Buffer;
};

export type RepositoryFileReader = (
  relativePath: string,
  maxBytes: number,
) => Promise<RepositoryFileReadResult>;

export async function buildFileTree(
  files: string[],
  readFile: RepositoryFileReader,
) {
  const tree: any[] = [];

  for (const file of files) {
    if (
      file.includes(".spec.") ||
      file.includes(".test.") ||
      file.includes("/e2e/") ||
      file.includes("/__tests__/")
    ) {
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
        let size: number | undefined;
        let loc: number | undefined;
        let highlights;

        let imports: any[] = [];
        let functions: any[] = [];
        let classes: any[] = [];
        let components: any[] = [];
        let exports: any[] = [];
        let blocks: any[] = [];
        let apis: any[] = [];
        let schemas: any[] = [];

        let classification = classifyRepositoryFile(file, "");

        if (isFile) {
          try {
            const result = await readFile(fullPath, MAX_FILE_SIZE_BYTES);

            size = result.size;

            const buffer = result.buffer;

            if (buffer && !isBinaryFile(buffer)) {
              const content = buffer.toString("utf-8");

              loc = content.split("\n").length;

              classification = classifyRepositoryFile(file, content);

              const ext = part.split(".").pop()?.toLowerCase();

              if (["js", "ts", "jsx", "tsx"].includes(ext || "")) {
                highlights = extractHighlights(content);

                const symbols = extractStructureBabel(fullPath, content);

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
          } catch (error) {
            console.warn("Failed to read repository file:", fullPath, error);
          }
        }

        const language = detectLanguage(fullPath);
        const languageColor = getLanguageColor(language);

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
        current = existing.children!;
      }
    }
  }

  return tree;
}
