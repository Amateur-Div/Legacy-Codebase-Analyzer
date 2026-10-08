export interface FileDependency {
  id: string;
  from: string;
  to: string;
  label: "imports" | "brokenImport";
}

export interface MissingDependencyNode {
  id: string;
  type: "missing";
  name: string;
  file: string;
  meta: {
    broken: true;
  };
}

function normalizePath(p: string) {
  return p.replace(/\\/g, "/");
}

export function collectFileDependencies(fileTree: any[]): {
  dependencies: FileDependency[];
  missingNodes: MissingDependencyNode[];
} {
  const dependencies: FileDependency[] = [];
  const missingNodes: MissingDependencyNode[] = [];

  const visitedDependencies = new Set<string>();
  const visitedMissingNodes = new Set<string>();

  const collect = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "file" && node.fullPath) {
        const fromPath = normalizePath(node.fullPath);
        const fromId = `file::${fromPath}`;

        for (const resolvedPath of node.impact?.imports ?? []) {
          const toPath = normalizePath(resolvedPath);
          const toId = `file::${toPath}`;

          const id = `dep::${fromId}->${toId}`;

          if (!visitedDependencies.has(id)) {
            dependencies.push({
              id,
              from: fromId,
              to: toId,
              label: "imports",
            });

            visitedDependencies.add(id);
          }
        }

        for (const broken of node.impact?.brokenImports ?? []) {
          const id = `missing::${fromPath}::${broken.source}`;
          const edgeId = `broken::${fromId}->${id}`;

          if (!visitedMissingNodes.has(id)) {
            missingNodes.push({
              id,
              type: "missing",
              name: broken.source,
              file: fromPath,
              meta: { broken: true },
            });

            visitedMissingNodes.add(id);
          }

          if (!visitedDependencies.has(edgeId)) {
            dependencies.push({
              id: edgeId,
              from: fromId,
              to: id,
              label: "brokenImport",
            });

            visitedDependencies.add(edgeId);
          }
        }
      }

      if (node.children) {
        collect(node.children);
      }
    }
  };

  collect(fileTree);

  return { dependencies, missingNodes };
}
