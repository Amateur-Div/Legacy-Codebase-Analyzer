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

  const { targetUid } = await req.json();

  if (!targetUid) {
    return NextResponse.json({ error: "Missing targetUid" }, { status: 400 });
  }

  if (targetUid === user.uid) {
    return NextResponse.json(
      { error: "Owner cannot remove themselves" },
      { status: 400 },
    );
  }

  const db = (await clientPromise).db();

  await db.collection("projects").updateOne(
    { _id: new ObjectId(projectId) },
    {
      $pull: { members: targetUid } as any,
      $unset: { [`roles.${targetUid}`]: "" },
    },
  );

  return NextResponse.json({ ok: true, removed: targetUid });
}
