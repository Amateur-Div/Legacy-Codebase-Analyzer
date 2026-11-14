"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { getAuth } from "firebase/auth";
import { AlertCircle, ArrowUpRight, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { NODE_H, NODE_W, getDagreGraph } from "../utils/graphLayout";

type EntrySymbol = {
  id: string;
  name: string;
  kind: string;
  isExported: boolean;
  startLine: number;
};

type ExecutionNode = {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
};

type ExecutionEdge = {
  id: string;
  from: string;
  to: string;
  label: "calls";
  line: number;
  calleeText: string;
  confidence: "high";
  resolution: "same-file" | "imported";
};

type ExecutionFlowResponse = {
  root: {
    id: string;
    name: string;
    filePath: string;
    startLine: number;
  };
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  diagnostics: {
    unresolvedCalls: number;
    externalCalls: number;
    truncated: boolean;
  };
  limits: {
    depth: number;
    nodes: number;
    edges: number;
  };
};

type EntryPoint = {
  path: string;
  kind: string;
  framework?: string;
  score?: number;
  reasons: string[];
};

interface Props {
  projectId: string;
  fileTree: any[];
  onOpenSource: (filePath: string, line: number) => void;
}

function collectEntryPoints(nodes: any[], result: EntryPoint[] = []): EntryPoint[] {
  for (const node of nodes ?? []) {
    if (node?.type === "file" && node.fullPath && node.entry?.isLikelyEntry) {
      result.push({
        path: node.fullPath,
        kind: node.entry.kind ?? node.role ?? "framework",
        framework: node.entry.framework,
        score: node.entry.score,
        reasons: Array.isArray(node.entry.reasons) ? node.entry.reasons : [],
      });
    }
    if (Array.isArray(node?.children)) collectEntryPoints(node.children, result);
  }
  return result.sort(
    (a, b) =>
      (b.score ?? 0) - (a.score ?? 0) || a.path.localeCompare(b.path),
  );
}

export default function ExecutionFlowExplorer({
  projectId,
  fileTree,
  onOpenSource,
}: Props) {
  const entries = useMemo(() => collectEntryPoints(fileTree), [fileTree]);
  const [entryFile, setEntryFile] = useState("");
  const [symbols, setSymbols] = useState<EntrySymbol[]>([]);
  const [entrySymbolId, setEntrySymbolId] = useState("");
  const [depth, setDepth] = useState("2");
  const [flow, setFlow] = useState<ExecutionFlowResponse | null>(null);
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [loadingFlow, setLoadingFlow] = useState(false);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");

  useEffect(() => {
    if (!entryFile && entries.length) setEntryFile(entries[0].path);
  }, [entries, entryFile]);

  useEffect(() => {
    if (!entryFile || !projectId) {
      setSymbols([]);
      setEntrySymbolId("");
      setFlow(null);
      return;
    }

    const controller = new AbortController();
    const loadSymbols = async () => {
      setLoadingSymbols(true);
      setError("");
      setFlow(null);
      setSymbols([]);
      setEntrySymbolId("");

      try {
        const token = await getAuth().currentUser?.getIdToken();
        const params = new URLSearchParams({ entryFile });
        const response = await fetch(
          `/api/projects/${projectId}/execution-flow?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Unable to load entry symbols");

        if (!controller.signal.aborted) {
          const nextSymbols: EntrySymbol[] = data.availableSymbols ?? [];
          setSymbols(nextSymbols);
          const preferred =
            nextSymbols.find((symbol) => symbol.isExported) ?? nextSymbols[0];
          setEntrySymbolId(preferred?.id ?? "");
        }
      } catch (cause: any) {
        if (cause?.name !== "AbortError") {
          setError(cause?.message ?? "Unable to load entry symbols");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingSymbols(false);
      }
    };

    loadSymbols();
    return () => controller.abort();
  }, [entryFile, projectId]);

  const runFlow = async () => {
    if (!entryFile || !entrySymbolId) return;
    setLoadingFlow(true);
    setError("");
    setFlow(null);
    setSelectedNodeId("");

    try {
      const token = await getAuth().currentUser?.getIdToken();
      const params = new URLSearchParams({
        entryFile,
        entrySymbolId,
        depth,
        limit: "150",
      });
      const response = await fetch(
        `/api/projects/${projectId}/execution-flow?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Unable to build execution flow");
      setFlow(data);
    } catch (cause: any) {
      setError(cause?.message ?? "Unable to build execution flow");
    } finally {
      setLoadingFlow(false);
    }
  };

  const visualGraph = useMemo(() => {
    if (!flow?.nodes?.length) return { nodes: [] as Node[], edges: [] as Edge[] };

    const nodes: Node[] = flow.nodes.map((symbol) => ({
      id: symbol.id,
      type: "default",
      position: { x: 0, y: 0 },
      data: {
        label: symbol.name,
        filePath: symbol.filePath,
        startLine: symbol.startLine,
        kind: symbol.kind,
        exported: symbol.isExported,
      },
      style: {
        width: NODE_W,
        minHeight: NODE_H,
        borderRadius: 10,
        border: symbol.id === flow.root.id
          ? "2px solid hsl(var(--primary))"
          : "1px solid hsl(var(--border))",
        background: "hsl(var(--card))",
        color: "hsl(var(--card-foreground))",
        padding: 10,
        fontSize: 12,
        boxShadow: symbol.id === flow.root.id
          ? "0 0 0 3px hsl(var(--primary) / 0.12)"
          : "0 2px 5px rgba(0,0,0,0.05)",
      },
    }));

    const edges: Edge[] = flow.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: `line ${edge.line}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "hsl(var(--primary))", strokeWidth: 1.8 },
      labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      labelBgStyle: { fill: "hsl(var(--background))" },
    }));

    const layout = getDagreGraph(nodes, edges, "TB");
    return {
      nodes: nodes.map((node) => {
        const position = layout.node(node.id);
        return position
          ? {
              ...node,
              position: {
                x: position.x - NODE_W / 2,
                y: position.y - NODE_H / 2,
              },
            }
          : node;
      }),
      edges,
    };
  }, [flow]);

  const selectedNode = flow?.nodes.find((node) => node.id === selectedNodeId);
  const selectedIncoming = flow?.edges.filter((edge) => edge.to === selectedNodeId) ?? [];
  const selectedOutgoing = flow?.edges.filter((edge) => edge.from === selectedNodeId) ?? [];
  const selectedEntry = entries.find((entry) => entry.path === entryFile);

  if (!entries.length) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
        <GitBranch className="mb-3 h-8 w-8 text-muted-foreground" />
        <h3 className="font-semibold">No likely entry points detected</h3>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          The repository analyzer did not identify a supported framework, runtime, or CLI entry point. You can still inspect individual file control-flow graphs in the Graph view.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[600px] flex-col gap-4">
      <div className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_100px_auto] md:items-end">
        <label className="min-w-0 space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Entry point</span>
          <select
            value={entryFile}
            onChange={(event) => setEntryFile(event.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {entries.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.path} · {entry.kind}{entry.framework ? ` · ${entry.framework}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-0 space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Function / handler</span>
          <select
            value={entrySymbolId}
            onChange={(event) => {
              setEntrySymbolId(event.target.value);
              setFlow(null);
            }}
            disabled={loadingSymbols || symbols.length === 0}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50"
          >
            {symbols.length === 0 ? (
              <option value="">{loadingSymbols ? "Loading symbols…" : "No callable symbols found"}</option>
            ) : (
              symbols.map((symbol) => (
                <option key={symbol.id} value={symbol.id}>
                  {symbol.name} · {symbol.kind} · line {symbol.startLine}{symbol.isExported ? " · exported" : ""}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Depth</span>
          <select
            value={depth}
            onChange={(event) => {
              setDepth(event.target.value);
              setFlow(null);
            }}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={String(value)}>{value} levels</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={runFlow}
          disabled={!entrySymbolId || loadingFlow || loadingSymbols}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingFlow ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          Explore flow
        </button>

        {selectedEntry && (
          <div className="md:col-span-4">
            <p className="text-xs text-muted-foreground">
              {selectedEntry.framework ?? "Detected entry"} · confidence score {selectedEntry.score ?? "—"}
              {selectedEntry.reasons.length ? ` · ${selectedEntry.reasons.join(", ")}` : ""}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {flow && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border px-2.5 py-1">{flow.nodes.length} functions</span>
          <span className="rounded-full border px-2.5 py-1">{flow.edges.length} call relationships</span>
          {flow.diagnostics.unresolvedCalls > 0 && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/5 px-2.5 py-1 text-amber-700">
              {flow.diagnostics.unresolvedCalls} unresolved
            </span>
          )}
          {flow.diagnostics.externalCalls > 0 && (
            <span className="rounded-full border px-2.5 py-1 text-muted-foreground">
              {flow.diagnostics.externalCalls} external
            </span>
          )}
          {flow.diagnostics.truncated && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/5 px-2.5 py-1 text-amber-700">
              Result limited — narrow the entry point
            </span>
          )}
          <button
            type="button"
            onClick={runFlow}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      )}

      {flow ? (
        <div className="grid min-h-[460px] flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="relative min-h-[460px] overflow-hidden rounded-xl border bg-muted/10">
            <ReactFlow
              nodes={visualGraph.nodes}
              edges={visualGraph.edges}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              fitView
              minZoom={0.15}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
            >
              <Background color="hsl(var(--border))" gap={22} />
              <MiniMap pannable zoomable />
              <Controls showInteractive={false} />
            </ReactFlow>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border bg-background/90 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              Static call relationships · not runtime execution order
            </div>
          </div>

          <aside className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
            <div>
              <h3 className="text-sm font-semibold">Function details</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Select a node to inspect its source location and connected calls.
              </p>
            </div>

            {selectedNode ? (
              <>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="break-words text-sm font-semibold">{selectedNode.name}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {selectedNode.filePath}:{selectedNode.startLine}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selectedNode.kind}{selectedNode.isExported ? " · exported" : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenSource(selectedNode.filePath, selectedNode.startLine)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  Open source <ArrowUpRight className="h-4 w-4" />
                </button>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Called by ({selectedIncoming.length})
                  </p>
                  {selectedIncoming.slice(0, 8).map((edge) => {
                    const caller = flow.nodes.find((node) => node.id === edge.from);
                    return (
                      <p key={edge.id} className="break-all text-xs">
                        {caller?.name ?? "Unknown caller"} · line {edge.line}
                      </p>
                    );
                  })}
                  {selectedIncoming.length === 0 && (
                    <p className="text-xs text-muted-foreground">No callers in this explored flow.</p>
                  )}
                </div>

                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Calls ({selectedOutgoing.length})
                  </p>
                  {selectedOutgoing.slice(0, 8).map((edge) => (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => setSelectedNodeId(edge.to)}
                      className="block w-full break-all text-left text-xs text-primary hover:underline"
                    >
                      {edge.calleeText} · line {edge.line}
                    </button>
                  ))}
                  {selectedOutgoing.length === 0 && (
                    <p className="text-xs text-muted-foreground">No resolved outgoing calls in this flow.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                Click a function node in the graph to see its details.
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="flex min-h-[460px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/10 p-8 text-center">
          {loadingSymbols ? (
            <Loader2 className="mb-3 h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <GitBranch className="mb-3 h-7 w-7 text-muted-foreground" />
          )}
          <h3 className="font-semibold">
            {loadingSymbols ? "Inspecting entry point…" : "Explore how this entry point calls through the codebase"}
          </h3>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Choose a handler or function, then build a bounded graph of statically resolved calls. Click any function to inspect its location and navigate to source.
          </p>
        </div>
      )}
    </div>
  );
}
