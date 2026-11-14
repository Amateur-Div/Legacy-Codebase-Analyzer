import { NextRequest, NextResponse } from "next/server";
import { authMiddleware } from "@/lib/auth-server";
import { assertProjectAccess } from "@/app/api/lib/projectAccess";
import { getAdminFirestore } from "@/lib/firebase-admin";

interface MemberProfile {
  uid: string;
  name: string | null;
  email: string | null;
  role: string;
}

const VALID_ROLES = new Set(["owner", "editor", "viewer"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing project ID" },
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
      const user = await authMiddleware(token);

      if (!user?.uid) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      uid = user.uid;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const project = await assertProjectAccess(projectId, uid, "viewer");

    const memberUids: string[] = Array.isArray(project.members)
      ? [
          ...new Set(
            project.members.filter(
              (member: unknown): member is string =>
                typeof member === "string" && member.trim().length > 0,
            ),
          ),
        ]
      : [];

    if (memberUids.length === 0) {
      return NextResponse.json({
        projectId,
        members: [],
      });
    }

    const roles = project.roles ?? {};
    const adminDb = getAdminFirestore();

    const userRefs = memberUids.map((memberUid) =>
      adminDb.collection("users").doc(memberUid),
    );

    const userDocs = await adminDb.getAll(...userRefs);

    const members: MemberProfile[] = userDocs.map((userDoc, index) => {
      const memberUid = memberUids[index];
      const profile = userDoc.exists ? userDoc.data() : undefined;

      const storedRole = roles[memberUid];
      const role = VALID_ROLES.has(storedRole)
        ? storedRole
        : memberUid === project.ownerId
          ? "owner"
          : "viewer";

      return {
        uid: memberUid,
        name: typeof profile?.name === "string" ? profile.name : null,
        email: typeof profile?.email === "string" ? profile.email : null,
        role,
      };
    });

    return NextResponse.json(
      {
        projectId,
        members,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    console.error("[PROJECT_MEMBERS_FETCH_ERROR]", error);

    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error.status === 403 || error.status === 404)
        ? error.status
        : 500;

    return NextResponse.json(
      {
        error:
          status === 403
            ? "You do not have access to this project"
            : status === 404
              ? "Project not found"
              : "Failed to fetch project members",
      },
      { status },
    );
  }
}
