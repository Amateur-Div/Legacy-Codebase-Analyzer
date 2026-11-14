import { getFileCallGraphsByPaths } from "@/app/api/lib/graph/fileCallGraphStore";
import type { ResolvedCallEdge } from "@/app/api/lib/callGraphResolver";
import { authMiddleware } from "@/lib/auth-server";
import clientPromise from "@/lib/mongoClient";
import { NextRequest, NextResponse } from "next/server";

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isValidFilePath(filePath: string): boolean {
  if (!filePath || filePath.startsWith("/")) return false;
  if (filePath.includes("\0")) return false;
  return !filePath.split("/").some((segment) => segment === ".." || segment === "");
}

function parseBoundedInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await context.params;
    if (!projectId) {
      return NextResponse.json({ error: "Missing project ID" }, { status: 400 });
    }

    const rawEntryFile = req.nextUrl.searchParams.get("entryFile");
    const entrySymbolName = req.nextUrl.searchParams.get("entrySymbol");
    const entrySymbolId = req.nextUrl.searchParams.get("entrySymbolId");

    if (!rawEntryFile || (!entrySymbolName && !entrySymbolId)) {
      return NextResponse.json(
        { error: "entryFile and entrySymbol (or entrySymbolId) are required" },
        { status: 400 },
      );
    }

    const entryFile = normalizeFilePath(rawEntryFile);
    if (!isValidFilePath(entryFile)) {
      return NextResponse.json({ error: "Invalid entry file path" }, { status: 400 });
    }

    const maxDepth = parseBoundedInteger(
      req.nextUrl.searchParams.get("depth"),
      2,
      1,
      5,
    );
    const maxNodes = parseBoundedInteger(
      req.nextUrl.searchParams.get("limit"),
      150,
      1,
      150,
    );
    const maxEdges = Math.min(300, maxNodes * 2);

    const authorization = req.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : null;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let uid: string;
    try {
      const auth = await authMiddleware(token);
      if (!auth?.uid) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      uid = auth.uid;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const client = await clientPromise;
    const db = client.db();
    const project = await db.collection("projects").findOne(
      { projectId, members: uid },
      { projection: { ownerId: 1 } },
    );

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (typeof project.ownerId !== "string" || !project.ownerId) {
      return NextResponse.json(
        { error: "Project owner information is unavailable" },
        { status: 500 },
      );
    }

    const fileRecord = await db.collection("project_files").findOne(
      { projectId, path: entryFile },
      { projection: { _id: 1 } },
    );
    if (!fileRecord) {
      return NextResponse.json({ error: "Entry file not found" }, { status: 404 });
    }

    const rootGraphs = await getFileCallGraphsByPaths(
      projectId,
      project.ownerId,
      [entryFile],
    );
    const rootGraph = rootGraphs[0];
    if (!rootGraph) {
      return NextResponse.json(
        { error: "Call graph is not available for this file. Re-analyze the repository." },
        { status: 404 },
      );
    }

    const matchingSymbols = entrySymbolId
      ? rootGraph.symbols.filter((symbol) => symbol.id === entrySymbolId)
      : rootGraph.symbols.filter((symbol) => symbol.name === entrySymbolName);
    const preferredSymbols =
      matchingSymbols.length > 1
        ? matchingSymbols.filter((symbol) => symbol.isExported)
        : matchingSymbols;
    const rootSymbol =
      preferredSymbols.length === 1 ? preferredSymbols[0] : undefined;

    if (!rootSymbol) {
      return NextResponse.json(
        {
          error:
            matchingSymbols.length > 1
              ? "Entry symbol name is ambiguous; select a specific symbol ID"
              : "Entry symbol not found in the selected file",
          availableSymbols: rootGraph.symbols.map((symbol) => ({
            id: symbol.id,
            name: symbol.name,
            kind: symbol.kind,
            isExported: symbol.isExported,
            startLine: symbol.startLine,
          })),
        },
        { status: matchingSymbols.length > 1 ? 409 : 404 },
      );
    }

    const graphsByPath = new Map(rootGraphs.map((graph) => [graph.filePath, graph]));
    const nodes = new Map<string, {
      id: string;
      name: string;
      kind: string;
      filePath: string;
      startLine: number;
      endLine: number;
      isExported: boolean;
    }>();
    const edges: Array<{
      id: string;
      from: string;
      to: string;
      label: "calls";
      line: number;
      calleeText: string;
      confidence: "high";
      resolution: "same-file" | "imported";
    }> = [];
    const visited = new Set<string>([rootSymbol.id]);
    const diagnostics = {
      unresolvedCalls: 0,
      externalCalls: 0,
      truncated: false,
    };

    const addNode = (symbol: (typeof rootGraph.symbols)[number]) => {
      if (nodes.has(symbol.id)) return true;
      if (nodes.size >= maxNodes) {
        diagnostics.truncated = true;
        return false;
      }
      nodes.set(symbol.id, {
        id: symbol.id,
        name: symbol.name,
        kind: symbol.kind,
        filePath: symbol.filePath,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        isExported: symbol.isExported,
      });
      return true;
    };

    addNode(rootSymbol);

    let frontier = [{
      symbolId: rootSymbol.id,
      filePath: rootGraph.filePath,
      depth: 0,
    }];

    while (frontier.length > 0 && !diagnostics.truncated) {
      const candidates: Array<{
        edge: ResolvedCallEdge;
        depth: number;
      }> = [];

      for (const current of frontier) {
        if (current.depth >= maxDepth) continue;
        const graph = graphsByPath.get(current.filePath);
        if (!graph) continue;

        const unresolvedCallIds = new Set(
          graph.resolutionDiagnostics
            .filter((diagnostic) => diagnostic.kind !== "external-module")
            .map((diagnostic) => diagnostic.callSiteId),
        );
        diagnostics.unresolvedCalls += graph.callSites.filter(
          (call) =>
            call.callerSymbolId === current.symbolId &&
            (call.resolution === "unresolved" ||
              call.resolution === "dynamic" ||
              unresolvedCallIds.has(call.id)),
        ).length;
        const externalCallIds = new Set(
          graph.resolutionDiagnostics
            .filter((diagnostic) => diagnostic.kind === "external-module")
            .map((diagnostic) => diagnostic.callSiteId),
        );
        diagnostics.externalCalls += graph.callSites.filter(
          (call) =>
            call.callerSymbolId === current.symbolId &&
            externalCallIds.has(call.id),
        ).length;

        for (const edge of graph.edges) {
          if (edge.fromSymbolId !== current.symbolId) continue;
          if (edges.length + candidates.length >= maxEdges) {
            diagnostics.truncated = true;
            break;
          }
          candidates.push({ edge, depth: current.depth + 1 });
        }
        if (diagnostics.truncated) break;
      }

      if (!candidates.length) break;

      const allMissingPaths = [...new Set(
        candidates
          .map(({ edge }) => edge.toFilePath)
          .filter((filePath) => filePath && !graphsByPath.has(filePath)),
      )];
      if (allMissingPaths.length > maxNodes) {
        diagnostics.truncated = true;
      }
      const missingPaths = allMissingPaths.slice(0, maxNodes);

      if (missingPaths.length) {
        const nextGraphs = await getFileCallGraphsByPaths(
          projectId,
          project.ownerId,
          missingPaths,
        );
        for (const graph of nextGraphs) graphsByPath.set(graph.filePath, graph);
      }

      const nextFrontier: typeof frontier = [];
      for (const { edge, depth } of candidates) {
        const targetGraph = graphsByPath.get(edge.toFilePath);
        const targetSymbol = targetGraph?.symbols.find(
          (symbol) => symbol.id === edge.toSymbolId,
        );

        if (!targetSymbol) {
          diagnostics.unresolvedCalls += 1;
          continue;
        }

        if (!addNode(targetSymbol)) break;

        edges.push({
          id: edge.id,
          from: edge.fromSymbolId,
          to: edge.toSymbolId,
          label: "calls",
          line: edge.line,
          calleeText: edge.calleeText,
          confidence: edge.confidence,
          resolution: edge.resolution,
        });

        if (!visited.has(targetSymbol.id)) {
          visited.add(targetSymbol.id);
          nextFrontier.push({
            symbolId: targetSymbol.id,
            filePath: targetSymbol.filePath,
            depth,
          });
        }
      }

      frontier = nextFrontier;
    }

    return NextResponse.json(
      {
        projectId,
        root: {
          id: rootSymbol.id,
          name: rootSymbol.name,
          filePath: rootSymbol.filePath,
          startLine: rootSymbol.startLine,
        },
        nodes: [...nodes.values()],
        edges,
        diagnostics,
        limits: { depth: maxDepth, nodes: maxNodes, edges: maxEdges },
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    console.error("EXECUTION_FLOW_FETCH_ERROR", error);
    return NextResponse.json(
      { error: "Failed to fetch execution flow" },
      { status: 500 },
    );
  }
}
