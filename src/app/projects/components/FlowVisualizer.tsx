"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Position,
  MarkerType,
  Node,
  NodeTypes,
  OnInit,
  ReactFlowInstance,
} from "reactflow";

import "reactflow/dist/style.css";

import { NODE_H, NODE_W, getDagreGraph } from "../utils/graphLayout";
import { FlowGraph } from "@/app/api/lib/analyzer/types";

import {
  collectReachable,
  normalizePath,
  normalizeType,
} from "../utils/graphHelpers";

import { typeColors } from "../utils/graphStyles";
import CustomNode from "./graph/CustomNode";
import { buildVisualNodes } from "../utils/buildVisualNodes";
import GraphToolbar from "./graph/GraphToolbar";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { getAuth } from "firebase/auth";

type GraphMode = "full" | "disabled";

interface Props {
  selectedPath: string | null;
  id: any;
  graphData: FlowGraph;
  setGraphData: any;
  selectedFileNode: any;
}

const nodeTypes: NodeTypes = {
  custom: CustomNode,
  root: CustomNode,
  file: CustomNode,
  function: CustomNode,
  "fn-entry": CustomNode,
  if: CustomNode,
  "if-true": CustomNode,
  "if-false": CustomNode,
  loop: CustomNode,
  "loop-body": CustomNode,
  "after-loop": CustomNode,
  statement: CustomNode,
  trycatch: CustomNode,
  error: CustomNode,
};

export default function FlowVisualizer({
  selectedPath,
  id,
  graphData,
  setGraphData,
  selectedFileNode,
}: Props) {
  const [heatmapMode, setHeatmapMode] = useState<
    "none" | "complexity" | "importance"
  >("none");

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [showVisualizer, setShowVisualizer] = useState(true);
  const [hideDeadCode, setHideDeadCode] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  const selectedFile = selectedFileNode?.fullPath || null;

  useEffect(() => {
    if (!id || !selectedPath) {
      setGraphData({
        nodes: [],
        edges: [],
      });
      return;
    }

    const controller = new AbortController();

    const fetchGraphData = async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken();

        const res = await fetch(
          `/api/projects/${id}/graph?filePath=${encodeURIComponent(
            selectedPath,
          )}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          },
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error ?? "Failed to load file graph.");
        }

        if (!controller.signal.aborted) {
          setGraphData(data?.graph ?? { nodes: [], edges: [] });
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;

        console.error("Failed to load file graph:", err);
      }
    };

    fetchGraphData();

    return () => controller.abort();
  }, [id, selectedPath, setGraphData]);

  useEffect(() => {
    setSelectedNode(null);
    setFilterType(null);
  }, [selectedFile]);

  const scopedGraph = useMemo(() => {
    if (!selectedFile || !graphData?.nodes?.length) {
      return {
        nodes: [],
        edges: [],
      };
    }

    const normalizedSelectedFile = normalizePath(selectedFile);

    const graphMetaFile = normalizePath(graphData.meta?.file);

    const fileNodes = graphData.nodes.filter((node: any) => {
      const nodeFile = normalizePath(node.file);

      if (nodeFile === normalizedSelectedFile) {
        return true;
      }

      if (!node.file && graphMetaFile === normalizedSelectedFile) {
        return true;
      }

      return false;
    });

    const nodeIds = new Set(fileNodes.map((node: any) => node.id));

    const fileEdges = (graphData.edges ?? []).filter(
      (edge: any) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
    );

    return {
      nodes: fileNodes.map((node: any) => ({
        id: node.id,
        type: "custom",
        position: { x: 0, y: 0 },
        data: {
          raw: node,
        },
        draggable: false,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      })),

      edges: fileEdges.map((edge: any) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
      })),
    };
  }, [graphData, selectedFile]);

  const nodeCount = scopedGraph.nodes.length;
  const edgeCount = scopedGraph.edges.length;

  const graphMode: GraphMode = useMemo(
    () => (nodeCount > 1300 || edgeCount > 2500 ? "disabled" : "full"),
    [nodeCount, edgeCount],
  );

  const resetGraphState = useCallback(() => {
    setHeatmapMode("none");
    setFilterType(null);
    setSelectedNode(null);
  }, []);

  const focusedFunctionId = useMemo(() => {
    if (selectedNode && selectedNode.data?.raw?.type === "function") {
      return selectedNode.id;
    }

    return null;
  }, [selectedNode]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const colorBySemantic = useCallback(
    (node: any) => {
      const semantic = node.semantic ?? {};

      if (heatmapMode === "complexity") {
        const complexity = semantic.complexity ?? 1;

        if (complexity >= 8) return "#7f1d1d";
        if (complexity >= 5) return "#c2410c";
        if (complexity >= 3) return "#f59e0b";

        return "#fde68a";
      }

      if (heatmapMode === "importance") {
        const importance = semantic.importance ?? 0;

        if (importance > 0.75) return "#065f46";
        if (importance > 0.4) return "#10b981";
        if (importance > 0.15) return "#34d399";

        return "#bbf7d0";
      }

      return typeColors[node.type] || "#fff";
    },
    [heatmapMode],
  );

  const layoutedGraph = useMemo(() => {
    if (graphMode !== "full") {
      return scopedGraph;
    }

    if (!scopedGraph.nodes.length) {
      return scopedGraph;
    }

    const graph = getDagreGraph(scopedGraph.nodes, scopedGraph.edges, "TB");

    return {
      nodes: scopedGraph.nodes.map((node) => {
        const position = graph.node(node.id);

        if (!position) {
          return node;
        }

        return {
          ...node,
          position: {
            x: position.x - NODE_W / 2,
            y: position.y - NODE_H / 2,
          },
        };
      }),

      edges: scopedGraph.edges,
    };
  }, [scopedGraph, graphMode]);

  const adjacency = useMemo(() => {
    const forward = new Map<string, string[]>();
    const backward = new Map<string, string[]>();

    for (const edge of layoutedGraph.edges) {
      const source = String(edge.source);
      const target = String(edge.target);

      if (!forward.has(source)) {
        forward.set(source, []);
      }

      if (!backward.has(target)) {
        backward.set(target, []);
      }

      forward.get(source)!.push(target);
      backward.get(target)!.push(source);
    }

    return {
      forward,
      backward,
    };
  }, [layoutedGraph]);

  const functionFocusedNodes = useMemo(() => {
    if (!focusedFunctionId) {
      return null;
    }

    return collectReachable(focusedFunctionId, adjacency.forward);
  }, [focusedFunctionId, adjacency]);

  const highlightedNodes = useMemo(() => {
    if (!selectedNode) {
      return null;
    }

    const forwardSet = collectReachable(selectedNode.id, adjacency.forward);

    const backwardSet = collectReachable(selectedNode.id, adjacency.backward);

    return new Set([...Array.from(forwardSet), ...Array.from(backwardSet)]);
  }, [selectedNode, adjacency]);

  const visualNodes = useMemo(() => {
    return buildVisualNodes({
      nodes: layoutedGraph.nodes,
      filterType,
      selectedNode,
      highlightedNodes,
      hideDeadCode,
      functionFocusedNodes,
      normalizeType,
      colorBySemantic,
    });
  }, [
    layoutedGraph,
    filterType,
    selectedNode,
    highlightedNodes,
    hideDeadCode,
    functionFocusedNodes,
    colorBySemantic,
  ]);

  const visualEdges = useMemo(() => {
    const hasSelection = !!selectedNode;

    return layoutedGraph.edges.map((edge) => {
      const isOnPath =
        !hasSelection ||
        (highlightedNodes &&
          highlightedNodes.has(String(edge.source)) &&
          highlightedNodes.has(String(edge.target)));

      return {
        ...edge,

        style: {
          stroke: isOnPath ? "#2563EB" : "#9CA3AF",
          strokeWidth: isOnPath ? 2.5 : 1.2,
          opacity: isOnPath ? 1 : 0.4,
        },

        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
      };
    });
  }, [layoutedGraph, highlightedNodes, selectedNode]);

  const onInit: OnInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;

    requestAnimationFrame(() => {
      instance.fitView({
        padding: 0.2,
      });
    });
  }, []);

  useEffect(() => {
    if (!rfInstanceRef.current || !visualNodes.length) {
      return;
    }

    requestAnimationFrame(() => {
      rfInstanceRef.current?.fitView({
        padding: 0.2,
      });
    });
  }, [selectedFile, visualNodes.length]);

  if (!selectedFileNode) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-muted-foreground">
          Select a file to explore Code Flow Visualization.
        </p>
      </div>
    );
  }

  if (!graphData || !graphData.nodes?.length) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">
          Execution graph is not available yet.
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          Select another file or wait for the file-level graph to finish
          loading.
        </p>
      </div>
    );
  }

  if (!scopedGraph.nodes.length) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">
          No execution nodes found for this file.
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          This file may not contain executable code or its graph may still be
          loading.
        </p>
      </div>
    );
  }

  if (graphMode === "disabled") {
    return (
      <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-6">
        <h3 className="mb-2 font-semibold text-yellow-800">
          ⚠ Execution graph too large
        </h3>

        <p className="text-sm text-yellow-700">
          This file contains <b>{nodeCount}</b> execution nodes and{" "}
          <b>{edgeCount}</b> edges.
        </p>

        <p className="mt-2 text-sm text-yellow-700">
          Rendering this file-level execution graph may freeze your browser. Use
          Code Outline and Cross-File Impact for deeper navigation.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div
        className="flex cursor-pointer select-none items-center justify-between rounded-t-xl border border-gray-200 bg-gray-100 px-4 py-2"
        onClick={() => setShowVisualizer((value) => !value)}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          Code Flow Visualization
        </h2>

        <span className="text-sm text-gray-500">
          {showVisualizer ? <ChevronUp /> : <ChevronDown />}
        </span>
      </div>

      <div
        className={`w-full overflow-hidden rounded-b-xl border-x border-b border-gray-200 transition-all duration-300 ease-in-out ${
          showVisualizer
            ? "h-[65vh] sm:h-[70vh] md:h-[75vh] lg:h-[80vh] xl:h-[85vh]"
            : "h-0"
        }`}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-muted/20">
          <GraphToolbar
            heatmapMode={heatmapMode}
            setHeatmapMode={setHeatmapMode}
            filterType={filterType}
            setFilterType={setFilterType}
            hideDeadCode={hideDeadCode}
            setHideDeadCode={setHideDeadCode}
            showLegend={showLegend}
            setShowLegend={setShowLegend}
            resetGraphState={resetGraphState}
          />

          <div className="relative h-full min-h-0 w-full flex-1 overflow-hidden">
            <ReactFlow
              nodes={visualNodes}
              edges={visualEdges}
              onInit={onInit}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              panOnScroll
              zoomOnPinch
              panOnDrag
              fitView
              style={{
                background: "hsl(var(--background))",
                height: "100%",
                width: "100%",
              }}
            >
              <Background color="#e0e0e0" gap={20} />

              <MiniMap
                nodeColor={(node: Node) =>
                  (node.data?.color as string) || "#ccc"
                }
                style={{
                  borderRadius: 12,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                }}
                zoomable
                pannable
                maskColor="rgba(0, 0, 0, .08)"
              />

              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>

            {showLegend && (
              <div className="absolute right-3 top-3 z-50 max-h-[calc(100%-24px)] w-[min(260px,calc(100%-24px))] overflow-y-auto rounded-xl border bg-white p-3 text-xs text-gray-700 shadow-xl">
                <div className="flex items-center justify-between border-b pb-3">
                  <h3 className="text-sm font-semibold">Graph Legend</h3>

                  <button
                    type="button"
                    onClick={() => setShowLegend(false)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Close graph legend"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-full bg-green-500" />
                    <span>Function</span>
                    <span>— entry & body</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-full bg-blue-500" />
                    <span>If / Branch</span>
                    <span>— conditional paths</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-full bg-purple-500" />
                    <span>Loop</span>
                    <span>— iterative flow</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="size-3 rounded-full border border-gray-300 bg-white" />
                    <span>Statement</span>
                    <span>— linear execution</span>
                  </div>
                </div>

                <hr className="my-2" />

                <div>
                  <b>Heatmap</b>
                  <div>• Darker = higher complexity / importance</div>
                </div>

                <hr className="my-2" />

                <div>
                  <b>Faded nodes</b>
                  <div>• Filtered out</div>
                  <div>• Dead / unreachable</div>
                  <div>• Outside execution path</div>
                </div>

                <hr className="my-2" />

                <div>
                  <b>Edges</b>
                  <div>• Solid → execution order</div>
                  <div>• Branch → true / false</div>
                  <div>• Loop-back → iteration</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
