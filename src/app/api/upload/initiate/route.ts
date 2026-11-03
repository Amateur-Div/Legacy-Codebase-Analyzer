import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { issueSignedToken, presignUrl } from "@vercel/blob";

import { authMiddleware } from "@/lib/auth-server";
import clientPromise from "@/lib/mongoClient";

export const runtime = "nodejs";

const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

const ZIP_CONTENT_TYPE = "application/zip";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("Authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();

  return token || null;
}

export async function POST(req: NextRequest) {
  let uploadIntentId: string | null = null;

  try {
    const token = getBearerToken(req);

    if (!token) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const { uid } = await authMiddleware(token);

    if (!uid) {
      return NextResponse.json(
        { error: "Invalid authentication." },
        { status: 401 },
      );
    }

    const body = await req.json();

    const fileName =
      typeof body.fileName === "string" ? body.fileName.trim() : "";

    const fileSize = body.fileSize;

    if (!fileName || !fileName.toLowerCase().endsWith(".zip")) {
      return NextResponse.json(
        { error: "Only ZIP files are supported." },
        { status: 400 },
      );
    }

    if (
      typeof fileSize !== "number" ||
      !Number.isSafeInteger(fileSize) ||
      fileSize <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid file size." },
        { status: 400 },
      );
    }

    if (fileSize > MAX_ZIP_SIZE) {
      return NextResponse.json(
        {
          error: "Repository ZIP exceeds the maximum supported size of 100 MB.",
        },
        { status: 413 },
      );
    }

    const projectId = uuid();
    uploadIntentId = uuid();

    const pathname = `repository-uploads/${projectId}.zip`;

    const now = Date.now();
    const validUntil = now + UPLOAD_URL_TTL_MS;

    const db = (await clientPromise).db();

    await db.collection("upload_intents").insertOne({
      uploadIntentId,
      projectId,
      ownerId: uid,
      pathname,
      originalFileName: fileName,
      expectedSize: fileSize,
      contentType: ZIP_CONTENT_TYPE,
      status: "pending",
      createdAt: new Date(now),
      expiresAt: new Date(validUntil),
    });

    const signedToken = await issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [ZIP_CONTENT_TYPE],
      maximumSizeInBytes: MAX_ZIP_SIZE,
    });

    const { presignedUrl } = await presignUrl(signedToken, {
      pathname,
      operation: "put",
      validUntil,
      access: "private",
      addRandomSuffix: false,
    });

    return NextResponse.json({
      uploadIntentId,
      projectId,
      uploadUrl: presignedUrl,
      expiresAt: new Date(validUntil).toISOString(),
    });
  } catch (error) {
    console.error("[UPLOAD_INITIATE_ERROR]", error);

    if (uploadIntentId) {
      try {
        const db = (await clientPromise).db();

        await db.collection("upload_intents").deleteOne({
          uploadIntentId,
          status: "pending",
        });
      } catch (cleanupError) {
        console.error("[UPLOAD_INTENT_CLEANUP_ERROR]", cleanupError);
      }
    }

    return NextResponse.json(
      { error: "Unable to initialize repository upload." },
      { status: 500 },
    );
  }
}
