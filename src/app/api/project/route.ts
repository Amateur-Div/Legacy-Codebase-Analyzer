import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "bson";
import { authMiddleware } from "@/lib/auth-server";
import clientPromise from "@/lib/mongoClient";

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    const token = req.headers.get("Authorization")?.split("Bearer ")[1];
    const { uid } = await authMiddleware(token);

    const client = await clientPromise;
    const db = client.db();
    const project = await db
      .collection("projects")
      .findOne({ _id: new ObjectId(id), members: uid });

    if (!project)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    console.log();

    return NextResponse.json({
      _id: project._id.toString(),
      projectName: project.projectName,
      fileTree: project.fileTree,
      insights: project.insights,
      members: project.members,
      projectId: project.projectId,
      packageInfo: project.packageInfo,
      entryPoints: project.entryPoints,
      impactMap: project.impactMap,
      stats: project.stats ?? null,
      tags: project.tags ?? [],
      jobId: project.jobId,
      analysisComplete: project.analysisComplete,
      dependencyAnalysis: project.dependencyAnalysis || {},
    });
  } catch (err) {
    console.error("PROJECT_FETCH_ERROR", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    const token = req.headers.get("Authorization")?.split("Bearer ")[1];
    const { uid } = await authMiddleware(token);

    const client = await clientPromise;
    const db = client.db();

    const project = await db.collection("projects").findOne({
      _id: new ObjectId(id),
      ownerId: uid,
    });

    if (!project)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.collection("projects").deleteOne({ _id: new ObjectId(id) });

    await db.collection("graphs").deleteOne({ projectId: project?.projectId });

    await db.collection("jobs").deleteOne({ projectId: project?.projectId });

    await db.collection("comments").deleteMany({ projectId: id });

    await db
      .collection("project_files")
      .deleteMany({ projectId: project?.projectId });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PROJECT_DELETE_ERROR", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const token = req.headers.get("Authorization")?.split("Bearer ")[1];
    const { uid } = await authMiddleware(token);

    const body = await req.json();
    const { id, newName, tags } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing ID" }, { status: 400 });
    }
    const updateFields: any = {};
    if (typeof newName === "string" && newName.trim() !== "") {
      updateFields.projectName = newName.trim();
    }
    if (Array.isArray(tags)) {
      updateFields.tags = tags;
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();

    const result = await db
      .collection("projects")
      .updateOne(
        { _id: new ObjectId(id), ownerId: uid },
        { $set: updateFields },
      );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PROJECT_PATCH_ERROR", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
