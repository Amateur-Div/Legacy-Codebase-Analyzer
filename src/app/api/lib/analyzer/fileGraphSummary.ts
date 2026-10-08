import type { FlowGraph } from "./types";

export interface FileGraphSummary {
  file: string;
  entryNodeIds: string[];
  nodeCount: number;
  edgeCount: number;
}

export function summarizeFileGraphs(
  fileGraphs: Array<{
    file: string;
    graph: FlowGraph;
  }>,
): FileGraphSummary[] {
  return fileGraphs.map(({ file, graph }) => {
    const incoming = new Set<string>();

    for (const edge of graph.edges) {
      incoming.add(edge.to);
    }

    const entryNodeIds = graph.nodes
      .filter((node) => !incoming.has(node.id))
      .map((node) => node.id);

    return {
      file,
      entryNodeIds,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    };
  });
}
