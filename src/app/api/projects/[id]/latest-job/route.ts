import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongoClient";
import { authMiddleware } from "@/lib/auth-server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = req.nextUrl.searchParams.get("token") || "";
    const { uid } = await authMiddleware(token);

    const { id: projectId } = await params;

    const db = (await clientPromise).db();

    const job = await db
      .collection("jobs")
      .find({ projectId, ownerId: uid })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    if (!job || job.length === 0) {
      return NextResponse.json(null);
    }

    return NextResponse.json(job[0]);
  } catch (err) {
    console.error("[LATEST_JOB_ERROR]", err);
    return NextResponse.json(
      { error: "Failed to fetch latest job" },
      { status: 500 },
    );
  }
}
