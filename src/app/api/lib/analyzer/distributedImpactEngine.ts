import { FileDependency } from "./fileDependecies";
import type { FlowGraph } from "./types";

export type DistributedFileGraph = {
  file: string;
  graph: FlowGraph;
};

export type DistributedIntelligenceInput = {
  fileGraphs: DistributedFileGraph[];
  fileIds: Set<string>;
  entryFileIds: Set<string>;
  candidateFileIds: Set<string>;
  dependencies: FileDependency[];
  apiCounts?: Map<string, number>;
};

export function findCircularFileDependencies(
  dependencies: FileDependency[],
  fileIds: Set<string>,
): string[][] {
  const adj = new Map<string, string[]>();

  for (const edge of dependencies) {
    if (edge.label !== "imports") continue;

    if (!fileIds.has(edge.from) || !fileIds.has(edge.to)) {
      continue;
    }

    if (!adj.has(edge.from)) {
      adj.set(edge.from, []);
    }

    adj.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]) {
    if (stack.has(node)) {
      const cycleStartIndex = path.indexOf(node);

      if (cycleStartIndex !== -1) {
        cycles.push([...path.slice(cycleStartIndex), node]);
      }

      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    stack.add(node);

    for (const next of adj.get(node) || []) {
      dfs(next, [...path, next]);
    }

    stack.delete(node);
  }

  for (const node of adj.keys()) {
    dfs(node, [node]);
  }

  return cycles;
}

export function findDeadFilesDistributed(input: {
  fileIds: Set<string>;
  entryFileIds: Set<string>;
  candidateFileIds: Set<string>;
  dependencies: FileDependency[];
}): string[] {
  const { fileIds, entryFileIds, candidateFileIds, dependencies } = input;

  if (entryFileIds.size === 0) {
    return [];
  }

  const importsFrom = new Map<string, string[]>();

  for (const edge of dependencies) {
    if (edge.label !== "imports") {
      continue;
    }

    if (!fileIds.has(edge.from) || !fileIds.has(edge.to)) {
      continue;
    }

    const existing = importsFrom.get(edge.from);

    if (existing) {
      existing.push(edge.to);
    } else {
      importsFrom.set(edge.from, [edge.to]);
    }
  }

  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const entryId of entryFileIds) {
    if (!fileIds.has(entryId)) {
      continue;
    }

    reachable.add(entryId);
    queue.push(entryId);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const next of importsFrom.get(current) ?? []) {
      if (reachable.has(next)) {
        continue;
      }

      reachable.add(next);
      queue.push(next);
    }
  }

  return Array.from(candidateFileIds).filter(
    (fileId) => fileIds.has(fileId) && !reachable.has(fileId),
  );
}

export function computeFileImportanceDistributed(input: {
  fileIds: Set<string>;
  dependencies: FileDependency[];
  apiCounts?: Map<string, number>;
}) {
  const {
    fileIds,
    dependencies,
    apiCounts = new Map<string, number>(),
  } = input;

  const importCounts = new Map<string, number>();

  for (const edge of dependencies) {
    if (edge.label !== "imports") {
      continue;
    }

    if (!fileIds.has(edge.from) || !fileIds.has(edge.to)) {
      continue;
    }

    importCounts.set(edge.to, (importCounts.get(edge.to) || 0) + 1);
  }

  const results: {
    fileId: string;
    score: number;
  }[] = [];

  for (const fileId of fileIds) {
    const importScore = (importCounts.get(fileId) || 0) * 3;

    const apiScore = (apiCounts.get(fileId) || 0) * 5;

    results.push({
      fileId,
      score: importScore + apiScore,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
