import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongoClient";
import path from "path";
import fs from "fs";
import {
  getProjectCachePath,
  touchCache,
} from "@/app/api/lib/cache/extractCache";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = req.nextUrl.searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "Missing file path" }, { status: 400 });
  }

  const db = (await clientPromise).db();

  const fileDoc = await db.collection("project_files").findOne({
    projectId: id,
    path: filePath,
  });

  if (fileDoc?.content) {
    return NextResponse.json({ content: fileDoc.content });
  }

  const cacheRoot = getProjectCachePath(id);
  const absPath = path.join(cacheRoot, "repo", filePath);

  if (fs.existsSync(absPath)) {
    touchCache(id);

    try {
      const content = fs.readFileSync(absPath, "utf-8");
      return NextResponse.json({ content });
    } catch {
      return NextResponse.json(
        { error: "Failed to read file from cache" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: "File not available in cache yet" },
    { status: 404 },
  );
}
