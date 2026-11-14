import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongoClient";
import { authMiddleware } from "@/lib/auth-server";
import { assertProjectAccess } from "@/app/api/lib/projectAccess";
import { ObjectId } from "bson";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const user = await authMiddleware(token);

  await assertProjectAccess(projectId, user.uid, "owner");

  const { targetUid, role } = await req.json();

  if (!targetUid || !["viewer", "editor"].includes(role)) {
    return NextResponse.json({ error: "Invalid role update" }, { status: 400 });
  }

  const db = (await clientPromise).db();

  await db
    .collection("projects")
    .updateOne(
      { _id: new ObjectId(projectId) },
      { $set: { [`roles.${targetUid}`]: role } },
    );

  return NextResponse.json({ ok: true, updated: { targetUid, role } });
}
