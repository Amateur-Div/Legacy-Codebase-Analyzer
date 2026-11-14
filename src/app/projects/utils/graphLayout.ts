import dagre from "dagre";
import { Node, Edge } from "reactflow";

export const NODE_W = 240;
export const NODE_H = 70;

export function getDagreGraph(nodes: Node[], edges: Edge[], direction = "TB") {
  const g = new dagre.graphlib.Graph({
    multigraph: true,
  });

  g.setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 90,
  });

  nodes.forEach((n) =>
    g.setNode(n.id, {
      width: NODE_W,
      height: NODE_H,
    }),
  );

  edges.forEach((e) => {
    if (e.source && e.target) {
      g.setEdge(
        e.source,
        e.target,
        {
          label: typeof e.label === "string" ? e.label : "",
        },
        e.id,
      );
    }
  });

  dagre.layout(g);

  return g;
}
