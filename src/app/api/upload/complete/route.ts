import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { head } from "@vercel/blob";

import { authMiddleware } from "@/lib/auth-server";
import clientPromise from "@/lib/mongoClient";

import { createJob } from "../../lib/jobs/jobManager";
import { loadJob } from "../../lib/jobs/jobStore";
import { jobQueue } from "../../lib/queue";

export const runtime = "nodejs";

const PROCESSING_LEASE_MS = 2 * 60 * 1000;

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("Authorization");

  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function getProjectName(fileName: string): string {
  return (
    fileName
      .replace(/\.zip$/i, "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .trim()
      .slice(0, 100) || "Untitled repository"
  );
}

export async function POST(req: NextRequest) {
  let claimedIntentId: string | null = null;
  let claimedJobId: string | null = null;

  try {
    const token = getBearerToken(req);

    if (!token) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const { uid } = await authMiddleware(token);

    if (!uid) {
      return NextResponse.json(
        { error: "Invalid authentication token" },
        { status: 401 },
      );
    }

    const body = await req.json();

    const uploadIntentId =
      typeof body.uploadIntentId === "string" ? body.uploadIntentId.trim() : "";

    if (!uploadIntentId) {
      return NextResponse.json(
        { error: "uploadIntentId is required" },
        { status: 400 },
      );
    }

    const db = (await clientPromise).db();
    const intents = db.collection("upload_intents");

    const intent = await intents.findOne({
      uploadIntentId,
      ownerId: uid,
    });

    if (!intent) {
      return NextResponse.json(
        { error: "Upload intent not found" },
        { status: 404 },
      );
    }

    if (intent.status === "completed" && intent.jobId) {
      return NextResponse.json({
        message: "Upload already completed",
        projectId: intent.projectId,
        jobId: intent.jobId,
      });
    }

    const now = new Date();

    if (intent.expiresAt <= now && intent.status !== "processing") {
      return NextResponse.json(
        { error: "Upload intent has expired. Please upload again." },
        { status: 410 },
      );
    }

    const blob = await head(intent.pathname);

    if (blob.pathname !== intent.pathname) {
      return NextResponse.json(
        { error: "Uploaded file does not match the upload intent" },
        { status: 400 },
      );
    }

    if (blob.size !== intent.expectedSize) {
      return NextResponse.json(
        { error: "Uploaded file size does not match the expected size" },
        { status: 400 },
      );
    }

    if (blob.contentType !== intent.contentType) {
      return NextResponse.json(
        { error: "Uploaded file content type is invalid" },
        { status: 400 },
      );
    }

    const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
    const stableJobId = intent.jobId || uuid();

    const claimed = await intents.findOneAndUpdate(
      {
        uploadIntentId,
        ownerId: uid,
        $or: [
          { status: "pending" },
          {
            status: "processing",
            processingAt: { $lt: staleBefore },
          },
        ],
      },
      {
        $set: {
          status: "processing",
          processingAt: now,
          jobId: stableJobId,
        },
      },
      { returnDocument: "after" },
    );

    const claimedIntent = claimed;

    if (!claimedIntent) {
      const latest = await intents.findOne({
        uploadIntentId,
        ownerId: uid,
      });

      if (latest?.status === "completed" && latest.jobId) {
        return NextResponse.json({
          message: "Upload already completed",
          projectId: latest.projectId,
          jobId: latest.jobId,
        });
      }

      return NextResponse.json(
        {
          error:
            "Upload completion is already being processed. Please retry shortly.",
        },
        { status: 409 },
      );
    }

    if (typeof claimedIntent.jobId !== "string" || !claimedIntent.jobId) {
      throw new Error("Upload intent is missing its stable job ID");
    }

    claimedIntentId = uploadIntentId;
    claimedJobId = stableJobId;

    const existingProject = await db.collection("projects").findOne({
      projectId: claimedIntent.projectId,
    });

    if (existingProject && existingProject.ownerId !== uid) {
      throw new Error("Project ownership validation failed");
    }

    await db.collection("projects").updateOne(
      {
        projectId: claimedIntent.projectId,
        ownerId: uid,
      },
      {
        $setOnInsert: {
          ownerId: uid,
          members: [uid],
          roles: { [uid]: "owner" },
          pendingInvites: [],
          projectName: getProjectName(claimedIntent.originalFileName),
          createdAt: new Date(),
          projectId: claimedIntent.projectId,

          blobPathname: claimedIntent.pathname,

          fileTree: null,
          packageInfo: null,
          entryPoints: [],
          tags: [],
          analysisComplete: false,
          activeAnalysisJobId: stableJobId,
        },
      },
      { upsert: true },
    );

    const activeJobClaim = await db.collection("projects").updateOne(
      {
        projectId: claimedIntent.projectId,
        ownerId: uid,
        $or: [
          { activeAnalysisJobId: { $exists: false } },
          { activeAnalysisJobId: stableJobId },
        ],
      },
      {
        $set: {
          activeAnalysisJobId: stableJobId,
        },
      },
    );

    if (activeJobClaim.matchedCount !== 1) {
      throw new Error(
        "Project is already associated with a different active analysis job",
      );
    }

    let job = await loadJob(stableJobId);

    if (!job) {
      job = await createJob(claimedIntent.projectId, uid, 0, stableJobId);
    }

    if (job.projectId !== claimedIntent.projectId || job.ownerId !== uid) {
      throw new Error("Existing job ownership or project validation failed");
    }

    await jobQueue.add(
      "analyze",
      { jobId: stableJobId },
      {
        jobId: stableJobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
        removeOnFail: false,
      },
    );

    await intents.updateOne(
      {
        uploadIntentId,
        ownerId: uid,
        status: "processing",
        jobId: claimedJobId,
      },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
        },
        $unset: {
          processingAt: "",
        },
      },
    );

    return NextResponse.json({
      message: "Upload completed successfully",
      projectId: claimedIntent.projectId,
      jobId: claimedJobId,
    });
  } catch (error) {
    console.error("[UPLOAD_COMPLETE_ERROR]", error);

    if (claimedIntentId && claimedJobId) {
      try {
        const db = (await clientPromise).db();

        await db.collection("upload_intents").updateOne(
          {
            uploadIntentId: claimedIntentId,
            status: "processing",
            jobId: claimedJobId,
          },
          {
            $set: {
              status: "pending",
              lastCompletionErrorAt: new Date(),
            },
            $unset: {
              processingAt: "",
            },
          },
        );
      } catch (recoveryError) {
        console.error("[UPLOAD_COMPLETE_RECOVERY_ERROR]", recoveryError);
      }
    }

    return NextResponse.json(
      { error: "Unable to complete the upload. Please retry." },
      { status: 500 },
    );
  }
}
