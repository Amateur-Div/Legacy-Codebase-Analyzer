import type { FlowEdge, FlowGraph, FlowNode } from "./types";
import type { FileDependency } from "./fileDependecies";

function detectLayer(filePath: string): string {
  const p = filePath.toLowerCase();

  if (p.includes("/controller")) return "controller";
  if (p.includes("/route")) return "controller";
  if (p.includes("/service")) return "service";
  if (p.includes("/repository")) return "repository";
  if (p.includes("/model")) return "model";
  if (p.includes("/schema")) return "model";
  if (p.includes("/util")) return "utility";
  if (p.includes("/helper")) return "utility";
  if (p.includes("/lib")) return "library";

  return "module";
}

export type GraphDegree = {
  inDegree: number;
  outDegree: number;
  totalDegree: number;
};

export type ProjectDegreeResult = {
  maxDegree: number;
  degrees: Map<string, GraphDegree>;
};

export type FileConnectivityMetrics = {
  fileId: string;
  filePath: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  score: number;
};

export function calculateProjectDegrees(
  fileGraphs: Array<{
    file: string;
    graph: FlowGraph;
  }>,
): ProjectDegreeResult {
  const degrees = new Map<string, GraphDegree>();

  const ensureNode = (id: string) => {
    if (!degrees.has(id)) {
      degrees.set(id, {
        inDegree: 0,
        outDegree: 0,
        totalDegree: 0,
      });
    }
  };

  const addEdge = (from: string, to: string) => {
    ensureNode(from);
    ensureNode(to);

    const source = degrees.get(from)!;
    const target = degrees.get(to)!;

    source.outDegree += 1;
    source.totalDegree += 1;

    target.inDegree += 1;
    target.totalDegree += 1;
  };

  for (const { graph } of fileGraphs) {
    for (const node of graph.nodes) {
      ensureNode(node.id);
    }

    for (const edge of graph.edges) {
      addEdge(edge.from, edge.to);
    }
  }

  let maxDegree = 0;

  for (const degree of degrees.values()) {
    if (degree.totalDegree > maxDegree) {
      maxDegree = degree.totalDegree;
    }
  }

  return {
    maxDegree,
    degrees,
  };
}

export function calculateFileConnectivityMetrics(
  dependencies: FileDependency[],
  fileIds: Set<string>,
): {
  maxDegree: number;
  metrics: FileConnectivityMetrics[];
} {
  const degrees = new Map<string, GraphDegree>();

  const ensureFile = (id: string) => {
    if (!fileIds.has(id)) return;

    if (!degrees.has(id)) {
      degrees.set(id, {
        inDegree: 0,
        outDegree: 0,
        totalDegree: 0,
      });
    }
  };

  for (const fileId of fileIds) {
    ensureFile(fileId);
  }

  for (const dependency of dependencies) {
    if (dependency.label !== "imports") {
      continue;
    }

    if (!fileIds.has(dependency.from) || !fileIds.has(dependency.to)) {
      continue;
    }

    ensureFile(dependency.from);
    ensureFile(dependency.to);

    const source = degrees.get(dependency.from)!;
    const target = degrees.get(dependency.to)!;

    source.outDegree += 1;
    source.totalDegree += 1;

    target.inDegree += 1;
    target.totalDegree += 1;
  }

  let maxDegree = 0;

  for (const degree of degrees.values()) {
    if (degree.totalDegree > maxDegree) {
      maxDegree = degree.totalDegree;
    }
  }

  const metrics = Array.from(fileIds).map((fileId) => {
    const degree = degrees.get(fileId) ?? {
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0,
    };

    return {
      fileId,
      filePath: fileId.startsWith("file::")
        ? fileId.slice("file::".length)
        : fileId,
      inDegree: degree.inDegree,
      outDegree: degree.outDegree,
      totalDegree: degree.totalDegree,
      score: maxDegree > 0 ? degree.totalDegree / maxDegree : 0,
    };
  });

  return {
    maxDegree,
    metrics,
  };
}

function estimateComplexity(node: FlowNode): number {
  if (!node.code) return 1;

  const code = node.code;
  let complexity = 1;

  const matchesIf = (code.match(/\bif\b/g) || []).length;
  const matchesFor = (code.match(/\bfor\b/g) || []).length;
  const matchesWhile = (code.match(/\bwhile\b/g) || []).length;
  const matchesSwitch = (code.match(/\bswitch\b/g) || []).length;
  const matchesTry = (code.match(/\btry\b/g) || []).length;
  const matchesReturn = (code.match(/\breturn\b/g) || []).length;

  complexity +=
    matchesIf * 1.5 +
    matchesFor * 1.4 +
    matchesWhile * 1.4 +
    matchesSwitch * 2 +
    matchesTry * 1.8 +
    Math.min(matchesReturn, 3) * 0.5;

  const nest = Math.max(
    0,
    (code.match(/{/g) || []).length - (code.match(/}/g) || []).length,
  );

  complexity += Math.max(0, Math.min(5, nest)) * 0.6;

  return Math.max(1, Math.round(complexity));
}

export function enrichFileGraphSemantics(
  graph: FlowGraph,
  maxDegree: number,
  projectDegrees: Map<string, GraphDegree>,
  filePath?: string,
  entryNodeIds: string[] = [],
): FlowGraph {
  const nodes = graph.nodes.map(
    (node) =>
      ({
        ...node,
        semantic: { ...(node.semantic || {}) },
        meta: { ...(node.meta || {}) },
      }) as FlowNode,
  );

  const edges = graph.edges.map((edge) => ({ ...edge }) as FlowEdge);

  const resolvedFilePath = filePath || graph.meta?.file || "";

  const fileMeta = {
    ...(graph.meta || {}),
    file: resolvedFilePath || graph.meta?.file,
    layer: resolvedFilePath ? detectLayer(resolvedFilePath) : graph.meta?.layer,
    entryNodeIds,
  };

  for (const node of nodes) {
    const degree = projectDegrees.get(node.id) ?? {
      inDegree: 0,
      outDegree: 0,
      totalDegree: 0,
    };

    const importance = maxDegree > 0 ? degree.totalDegree / maxDegree : 0;

    node.semantic = {
      ...(node.semantic || {}),
      importance,
      complexity: estimateComplexity(node),
      connectivity: {
        inDegree: degree.inDegree,
        outDegree: degree.outDegree,
        totalDegree: degree.totalDegree,
        score: importance,
      },
    };
  }

  return {
    nodes,
    edges,
    meta: fileMeta,
  };
}
