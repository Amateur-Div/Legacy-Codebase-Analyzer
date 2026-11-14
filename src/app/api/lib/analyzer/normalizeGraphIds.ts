import type { FlowGraph, FlowNode, FlowEdge } from "./types";

export function normalizeGraphIds(g: FlowGraph, filePath: string) {
  let counter = 0;
  const mapping = new Map<string, string>();

  const nodes: FlowNode[] = g.nodes.map((n) => {
    const localId = `${filePath}::${n.type}::${counter++}`;
    mapping.set(n.id, localId);
    return { ...n, id: localId, file: filePath };
  });

  let edgeCounter = 0;

  const edges: FlowEdge[] = g.edges
    .map((e: any) => {
      const from = mapping.get(e.from);
      const to = mapping.get(e.to);

      if (!from || !to) return null;

      return {
        id: `${from}->${to}::${edgeCounter++}`,
        from,
        to,
        label: e.label,
      } as FlowEdge;
    })
    .filter(Boolean) as FlowEdge[];

  return { nodes, edges } as FlowGraph;
}
