import { getFileGraph } from "@/app/api/lib/graph/graphStore";
import { authMiddleware } from "@/lib/auth-server";
import clientPromise from "@/lib/mongoClient";
import { NextRequest, NextResponse } from "next/server";

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isValidFilePath(filePath: string) {
  if (!filePath) return false;
  if (filePath.startsWith("/")) return false;

  const segments = filePath.split("/");

  if (segments.includes("..")) return false;

  return true;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await context.params;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing project ID" },
        { status: 400 },
      );
    }

    const rawFilePath = req.nextUrl.searchParams.get("filePath");

    if (!rawFilePath) {
      return NextResponse.json({ error: "Missing file path" }, { status: 400 });
    }

    const filePath = normalizeFilePath(rawFilePath);

    if (!isValidFilePath(filePath)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
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

    const client = await clientPromise;
    const db = client.db();

    const project = await db.collection("projects").findOne(
      {
        projectId,
        members: uid,
      },
      {
        projection: {
          ownerId: 1,
        },
      },
    );

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (typeof project.ownerId !== "string" || !project.ownerId) {
      console.error("GRAPH_PROJECT_OWNER_MISSING", { projectId });

      return NextResponse.json(
        { error: "Project owner information is unavailable" },
        { status: 500 },
      );
    }

    const graph = await getFileGraph(projectId, filePath, project.ownerId);

    if (!graph) {
      return NextResponse.json({ error: "Graph not found" }, { status: 404 });
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
    console.error("FILE_GRAPH_FETCH_ERROR", err);

    return NextResponse.json(
      { error: "Failed to fetch file graph" },
      { status: 500 },
    );
  }
}
