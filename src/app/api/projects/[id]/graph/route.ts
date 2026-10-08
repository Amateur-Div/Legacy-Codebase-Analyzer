import { getFileGraph } from "@/app/api/lib/graph/graphStore";
import { authMiddleware } from "@/lib/auth-server";
import { NextRequest, NextResponse } from "next/server";

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isValidFilePath(filePath: string): boolean {
  if (!filePath) return false;

  if (filePath.startsWith("/")) return false;

  const segments = filePath.split("/");
  if (segments.includes("..")) return false;

  return true;
}

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  try {
    const { id: projectId } = await context.params;

    if (!projectId) {
      return NextResponse.json(
        { error: "Project ID is required" },
        { status: 400 },
      );
    }

    const rawFilePath = req.nextUrl.searchParams.get("filePath");

    if (!rawFilePath) {
      return NextResponse.json(
        {
          error: "filePath query parameter is required",
        },
        { status: 400 },
      );
    }

    console.log("id : ", projectId);
    console.log("File path : ", rawFilePath);

    const filePath = normalizeFilePath(rawFilePath);

    if (!isValidFilePath(filePath)) {
      return NextResponse.json(
        {
          error: "Invalid filePath",
        },
        { status: 400 },
      );
    }

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

    const graph = await getFileGraph(projectId, filePath, uid);

    if (!graph) {
      return NextResponse.json(
        {
          error: "Graph not found for selected file",
          projectId,
          filePath,
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        projectId,
        filePath,
        graph,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (err: any) {
    console.error("[graph-api] Failed to load file graph:", err);

    return NextResponse.json(
      {
        error: String(err?.message ?? err),
      },
      { status: 500 },
    );
  }
}
