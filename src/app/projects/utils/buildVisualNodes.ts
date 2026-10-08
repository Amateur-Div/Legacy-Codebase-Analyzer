import { Node } from "reactflow";

interface BuildVisualNodesProps {
  nodes: Node[];
  filterType: string | null;
  selectedNode: Node | null;
  highlightedNodes: Set<string> | null;
  hideDeadCode: boolean;
  functionFocusedNodes: Set<string> | null;
  normalizeType: (type: string) => string;
  colorBySemantic: (node: any) => string;
}

export function buildVisualNodes({
  nodes,
  filterType,
  selectedNode,
  highlightedNodes,
  hideDeadCode,
  functionFocusedNodes,
  normalizeType,
  colorBySemantic,
}: BuildVisualNodesProps): Node[] {
  return nodes.map((node) => {
    const raw = node.data?.raw ?? {};

    const matchesFilter = !filterType || normalizeType(raw.type) === filterType;

    const isHighlighted = !selectedNode || highlightedNodes?.has(node.id);

    const isFocused = selectedNode?.id === node.id;

    const isDead = raw.semantic?.dead === true;

    const fadedByDead = hideDeadCode && isDead;

    const fadedByFunctionFocus =
      !!functionFocusedNodes && !functionFocusedNodes.has(node.id);

    const color = colorBySemantic(raw);

    let label: string;

    if (raw.type === "root") {
      label = "🔷 Execution Root";
    } else if (raw.type === "function") {
      label = `🟢 Function: ${raw.name ?? "anonymous"}`;
    } else if (raw.type === "if") {
      label = `🔀 ${raw.name ?? "Condition"}`;
    } else if (raw.type === "loop") {
      label = `🔁 ${raw.name ?? "Loop"}`;
    } else if (raw.type === "trycatch") {
      label = `⚠ ${raw.name ?? "Try / Catch"}`;
    } else {
      label = (raw.code ?? raw.name ?? raw.type ?? "").toString().slice(0, 60);
    }

    return {
      ...node,
      data: {
        ...node.data,
        label,
        color,
        border: isFocused ? "2px solid #2563eb" : "1px solid #ccc",
        fadedByFilter: !matchesFilter,
        fadedByHighlight: !isHighlighted,
        fadedByDead,
        fadedByFunctionFocus,
        focused: isFocused,
        architectureDeadOpacity: 1,
        graphScope: "file",
      },
    };
  });
}
